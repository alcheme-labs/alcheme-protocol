/**
 * Settler — 结算编排器
 *
 * 完整的结算流程:
 * 1. 从链上读取未结算的 Ledger + Entry + Reference
 * 2. 构建引用图
 * 3. 运行 PageRank 计算 authority scores
 * 4. 运行反作弊检测
 * 5. 对每个未结算 Ledger 的每条 Entry 调用链上 settle_reputation
 * 6. 将结果写入数据库
 */

import { PublicKey } from '@solana/web3.js';
import * as anchor from '@coral-xyz/anchor';
import { createLogger, format, transports, Logger } from 'winston';

import { CitationGraph, CrystalOwnerMap } from './graph';
import { PageRank, PageRankConfig, DEFAULT_PAGERANK_CONFIG } from './pagerank';
import { AntiGamingPipeline, AntiGamingThresholds, DEFAULT_THRESHOLDS } from './anti-gaming';
import { ChainReader, LedgerRecord } from './data/chain-reader';
import { DbWriter, AuthorityScoreRow, SettlementHistoryRow } from './data/db-writer';
import {
    IdentityResolver,
} from './identity-resolver';

// ==================== 配置 ====================

export interface SettlerConfig {
    pageRank: Partial<PageRankConfig>;
    antiGaming: Partial<AntiGamingThresholds>;
    /** 是否写入 DB (为 false 时仅执行 dry-run) */
    writeToDb: boolean;
    /** 是否执行链上结算 (为 false 时仅计算分数) */
    executeOnChain: boolean;
}

export const DEFAULT_SETTLER_CONFIG: SettlerConfig = {
    pageRank: DEFAULT_PAGERANK_CONFIG,
    antiGaming: DEFAULT_THRESHOLDS,
    writeToDb: true,
    executeOnChain: true,
};

// ==================== 结果 ====================

export interface SettlementResult {
    epoch: number;
    /** 处理的 Crystal 数 */
    crystalsProcessed: number;
    /** 结算的 Entry 数 */
    entriesSettled: number;
    /** 被反作弊过滤的用户数 */
    blockedUsers: number;
    /** 反作弊标记数 */
    antiGamingFlags: number;
    /** PageRank 是否收敛 */
    pageRankConverged: boolean;
    /** 错误列表 */
    errors: string[];
}

export interface SettlerRuntimeBindings {
    identityRegistryName: string;
}

// ==================== Settler ====================

export class Settler {
    private chainReader: ChainReader;
    private dbWriter: DbWriter | null;
    private ceProgram: anchor.Program;
    private irProgram: anchor.Program;
    private rfProgram: anchor.Program;
    private admin: anchor.web3.Keypair;
    private config: SettlerConfig;
    private logger: Logger;
    private identityResolver: IdentityResolver | null;

    constructor(
        chainReader: ChainReader,
        dbWriter: DbWriter | null,
        ceProgram: anchor.Program,
        irProgram: anchor.Program,
        rfProgram: anchor.Program,
        admin: anchor.web3.Keypair,
        config: Partial<SettlerConfig> = {},
        runtimeBindings?: SettlerRuntimeBindings,
        logLevel: string = 'info',
    ) {
        this.chainReader = chainReader;
        this.dbWriter = dbWriter;
        this.ceProgram = ceProgram;
        this.irProgram = irProgram;
        this.rfProgram = rfProgram;
        this.admin = admin;
        this.config = { ...DEFAULT_SETTLER_CONFIG, ...config };
        this.logger = createLogger({
            level: logLevel,
            format: format.combine(
                format.timestamp(),
                format.printf(({ timestamp, level, message }) =>
                    `${timestamp} [Settler] ${level}: ${message}`
                ),
            ),
            transports: [new transports.Console()],
        });
        const identityConnection = this.irProgram?.provider?.connection;
        const requiresIdentityResolution = !!(dbWriter && identityConnection && this.irProgram?.programId);
        if (requiresIdentityResolution && !runtimeBindings?.identityRegistryName) {
            throw new Error('Settler runtime bindings require identityRegistryName when identity resolution is enabled');
        }
        this.identityResolver = requiresIdentityResolution
            ? new IdentityResolver(
                dbWriter!,
                identityConnection!,
                this.irProgram.programId,
                runtimeBindings!.identityRegistryName,
                logLevel,
            )
            : null;
    }

    /**
     * 执行一个完整的结算周期
     */
    async runEpoch(): Promise<SettlementResult> {
        const result: SettlementResult = {
            epoch: 0,
            crystalsProcessed: 0,
            entriesSettled: 0,
            blockedUsers: 0,
            antiGamingFlags: 0,
            pageRankConverged: false,
            errors: [],
        };

        try {
            // Step 1: 读取链上数据
            this.logger.info('=== 结算周期开始 ===');

            const references = await this.chainReader.fetchAllReferences();
            const unsettledLedgers = await this.chainReader.fetchUnsettledLedgers();

            if (unsettledLedgers.length === 0) {
                this.logger.info('无待结算 Ledger，跳过');
                return result;
            }

            const crystalIds = unsettledLedgers.map(l => new PublicKey(l.crystalId));
            const entriesByLedger = await this.chainReader.fetchEntriesForCrystals(crystalIds);

            this.logger.info(
                `链上数据: ${references.length} 条引用, ` +
                `${unsettledLedgers.length} 个待结算 Ledger`
            );

            // Step 2: 构建引用图
            const graph = new CitationGraph(this.logger.level);

            // 简化的 crystal → owner 映射 (从 Entry 中推断)
            const crystalOwners: CrystalOwnerMap = new Map();
            for (const [crystalId, entries] of entriesByLedger) {
                const author = entries.find(e => e.role === 'Author');
                if (author) {
                    crystalOwners.set(crystalId, author.contributor);
                }
            }

            graph.build(references, crystalOwners);

            // Step 3: PageRank
            const pageRank = new PageRank(this.config.pageRank, this.logger.level);
            const prResult = pageRank.compute(graph);
            result.pageRankConverged = prResult.converged;

            // 归一化到 [0, 1]
            const normalizedScores = PageRank.normalize(prResult.scores);

            // Step 4: 反作弊
            const allContributions = [];
            for (const entries of entriesByLedger.values()) {
                allContributions.push(...ChainReader.toContributionRecords(entries));
            }

            const antiGaming = new AntiGamingPipeline(this.config.antiGaming, this.logger.level);
            const agResult = antiGaming.run(references, allContributions, crystalOwners);

            result.antiGamingFlags = agResult.flags.length;
            result.blockedUsers = agResult.blockedUsers.size;

            // Step 5: 获取 epoch
            const epoch = this.dbWriter ? await this.dbWriter.getCurrentEpoch() : 1;
            result.epoch = epoch;

            // Step 6: 写入 authority scores
            if (this.config.writeToDb && this.dbWriter) {
                const scoreRows: AuthorityScoreRow[] = [];
                for (const [crystalId, score] of normalizedScores) {
                    scoreRows.push({ crystalId, score, epoch });
                }
                await this.dbWriter.writeAuthorityScores(scoreRows);
                await this.dbWriter.writeAntiGamingFlags(agResult.flags);
            }

            // Step 7: 执行链上结算
            if (this.config.executeOnChain) {
                await this.settleOnChain(
                    unsettledLedgers,
                    entriesByLedger,
                    normalizedScores,
                    agResult.blockedUsers,
                    result,
                    epoch,
                );
            }

            result.crystalsProcessed = unsettledLedgers.length;
            this.logger.info(
                `=== 结算周期完成 (epoch=${epoch}) ===\n` +
                `   Crystals: ${result.crystalsProcessed}\n` +
                `   Entries settled: ${result.entriesSettled}\n` +
                `   Blocked users: ${result.blockedUsers}\n` +
                `   Errors: ${result.errors.length}`
            );

        } catch (err) {
            const errMsg = `结算周期异常: ${err}`;
            this.logger.error(errMsg);
            result.errors.push(errMsg);
        }

        return result;
    }

    /**
     * 执行链上 settle_reputation 调用
     */
    private async settleOnChain(
        ledgers: LedgerRecord[],
        entriesByLedger: Map<string, import('./data/chain-reader').EntryRecord[]>,
        scores: Map<string, number>,
        blockedUsers: Set<string>,
        result: SettlementResult,
        epoch: number,
    ): Promise<void> {
        const settlementHistory: SettlementHistoryRow[] = [];

        // PDA 推导
        const [configPda] = PublicKey.findProgramAddressSync(
            [Buffer.from('config')],
            this.ceProgram.programId,
        );

        const [extensionRegistryPda] = PublicKey.findProgramAddressSync(
            [Buffer.from('extension_registry')],
            this.rfProgram.programId,
        );

        for (const ledger of ledgers) {
            const crystalId = new PublicKey(ledger.crystalId);
            const authorityScore = scores.get(ledger.crystalId) ?? 0.5; // 默认 0.5
            const entries = entriesByLedger.get(ledger.crystalId) || [];

            for (const entry of entries) {
                // 跳过被封锁用户
                if (blockedUsers.has(entry.contributor)) {
                    this.logger.warn(`跳过封锁用户 ${entry.contributor.slice(0, 8)}...`);
                    continue;
                }

                try {
                    const [ledgerPda] = PublicKey.findProgramAddressSync(
                        [Buffer.from('ledger'), crystalId.toBuffer()],
                        this.ceProgram.programId,
                    );
                    const contributor = new PublicKey(entry.contributor);
                    const [entryPda] = PublicKey.findProgramAddressSync(
                        [Buffer.from('entry'), crystalId.toBuffer(), contributor.toBuffer()],
                        this.ceProgram.programId,
                    );

                    // 查找 UserIdentity PDA (需要链上 handle → identity 映射)
                    // MVP: 假设 UserIdentity PDA 通过 contributor 可推导
                    // 生产环境应从 DB 或链上查询
                    // 这里我们尝试链上查询 identity-registry
                    const resolvedIdentity = this.identityResolver
                        ? await this.identityResolver.resolveContributor(contributor)
                        : null;
                    if (!resolvedIdentity) {
                        this.logger.warn(
                            `无法解析 contributor 对应 identity: contributor=${entry.contributor.slice(0, 8)}..., 跳过`
                        );
                        continue;
                    }

                    const tx = await (this.ceProgram.methods as any)
                        .settleReputation(authorityScore)
                        .accounts({
                            config: configPda,
                            ledger: ledgerPda,
                            entry: entryPda,
                            userIdentity: resolvedIdentity.userIdentityPda,
                            identityRegistry: resolvedIdentity.identityRegistryPda,
                            callerProgram: this.ceProgram.programId,
                            extensionRegistry: extensionRegistryPda,
                            identityRegistryProgram: this.irProgram.programId,
                            admin: this.admin.publicKey,
                        })
                        .signers([this.admin])
                        .rpc();

                    const reputationDelta = entry.weight * authorityScore;

                    settlementHistory.push({
                        crystalId: ledger.crystalId,
                        contributorPubkey: entry.contributor,
                        contributionRole: entry.role,
                        contributionWeight: entry.weight,
                        authorityScore,
                        reputationDelta,
                        txSignature: tx,
                    });

                    result.entriesSettled++;
                    this.logger.debug(
                        `结算成功: crystal=${ledger.crystalId.slice(0, 8)}, ` +
                        `contributor=${entry.contributor.slice(0, 8)}, ` +
                        `delta=${reputationDelta.toFixed(4)}, tx=${tx.slice(0, 12)}...`
                    );
                } catch (err) {
                    const errMsg = `结算失败: crystal=${ledger.crystalId.slice(0, 8)}, ` +
                        `contributor=${entry.contributor.slice(0, 8)}: ${err}`;
                    this.logger.error(errMsg);
                    result.errors.push(errMsg);
                }
            }
        }

        // 写入结算历史
        if (this.config.writeToDb && this.dbWriter && settlementHistory.length > 0) {
            await this.dbWriter.writeSettlementHistory(settlementHistory);
        }
    }
}
