/**
 * ChainReader — 从链上读取 Reference, Ledger, Entry 账户数据
 *
 * 使用 Anchor SDK 的 account fetching + getProgramAccounts
 * 来读取 contribution-engine 和 identity-registry 的状态。
 */

import { Connection, PublicKey } from '@solana/web3.js';
import * as anchor from '@coral-xyz/anchor';
import { createLogger, format, transports, Logger } from 'winston';
import { ReferenceRecord, ReferenceTypeEnum } from '../graph';
import { ContributionRecord } from '../anti-gaming/ghost-contribution';

// ==================== 链上账户数据 ====================

/** 链上 ContributionLedger 的 off-chain 表示 */
export interface LedgerRecord {
    address: string;
    crystalId: string;
    totalContributors: number;
    closed: boolean;
    totalWeight: number;
    reputationSettled: boolean;
    createdAt: number;
}

/** 链上 ContributionEntry 的 off-chain 表示 */
export interface EntryRecord {
    address: string;
    crystalId: string;
    contributor: string;
    role: string;
    weight: number;
    recordedAt: number;
}

// ==================== ChainReader ====================

export class ChainReader {
    private connection: Connection;
    private ceProgram: anchor.Program;
    private logger: Logger;

    constructor(
        connection: Connection,
        ceProgram: anchor.Program,
        logLevel: string = 'info',
    ) {
        this.connection = connection;
        this.ceProgram = ceProgram;
        this.logger = createLogger({
            level: logLevel,
            format: format.combine(
                format.timestamp(),
                format.printf(({ timestamp, level, message }) =>
                    `${timestamp} [ChainReader] ${level}: ${message}`
                ),
            ),
            transports: [new transports.Console()],
        });
    }

    /**
     * 读取所有 Reference 账户
     */
    async fetchAllReferences(): Promise<ReferenceRecord[]> {
        this.logger.info('读取所有 Reference 账户...');

        try {
            const accounts = await (this.ceProgram.account as any).reference.all();

            const references: ReferenceRecord[] = accounts.map((acc: any) => {
                const data = acc.account;
                return {
                    sourceId: data.sourceId.toString(),
                    targetId: data.targetId.toString(),
                    refType: this.parseReferenceType(data.refType),
                    weight: data.weight,
                    creator: data.creator.toString(),
                    createdAt: data.createdAt.toNumber(),
                };
            });

            this.logger.info(`读取到 ${references.length} 条引用`);
            return references;
        } catch (err) {
            this.logger.error(`读取 Reference 失败: ${err}`);
            return [];
        }
    }

    /**
     * 读取所有已关闭且未结算的 Ledger
     */
    async fetchUnsettledLedgers(): Promise<LedgerRecord[]> {
        this.logger.info('读取未结算 Ledger...');

        try {
            const allLedgers = await (this.ceProgram.account as any).contributionLedger.all();

            const unsettled = allLedgers
                .filter((acc: any) => acc.account.closed && !acc.account.reputationSettled)
                .map((acc: any) => ({
                    address: acc.publicKey.toString(),
                    crystalId: acc.account.crystalId.toString(),
                    totalContributors: acc.account.totalContributors,
                    closed: acc.account.closed,
                    totalWeight: acc.account.totalWeight,
                    reputationSettled: acc.account.reputationSettled,
                    createdAt: acc.account.createdAt.toNumber(),
                }));

            this.logger.info(`找到 ${unsettled.length} 个待结算 Ledger (总计 ${allLedgers.length} 个)`);
            return unsettled;
        } catch (err) {
            this.logger.error(`读取 Ledger 失败: ${err}`);
            return [];
        }
    }

    /**
     * 读取指定 Crystal 的所有 Entry
     */
    async fetchEntriesForCrystal(crystalId: PublicKey): Promise<EntryRecord[]> {
        try {
            const allEntries = await (this.ceProgram.account as any).contributionEntry.all();

            const entries = allEntries
                .filter((acc: any) => acc.account.crystalId.equals(crystalId))
                .map((acc: any) => ({
                    address: acc.publicKey.toString(),
                    crystalId: acc.account.crystalId.toString(),
                    contributor: acc.account.contributor.toString(),
                    role: this.parseRole(acc.account.role),
                    weight: acc.account.weight,
                    recordedAt: acc.account.recordedAt.toNumber(),
                }));

            return entries;
        } catch (err) {
            this.logger.error(`读取 Entry 失败 (crystal=${crystalId.toString().slice(0, 8)}): ${err}`);
            return [];
        }
    }

    /**
     * 批量读取多个 Crystal 的 Entry
     */
    async fetchEntriesForCrystals(crystalIds: PublicKey[]): Promise<Map<string, EntryRecord[]>> {
        this.logger.info(`批量读取 ${crystalIds.length} 个 Crystal 的 Entry...`);

        try {
            const allEntries = await (this.ceProgram.account as any).contributionEntry.all();
            const crystalIdSet = new Set(crystalIds.map(id => id.toString()));
            const result = new Map<string, EntryRecord[]>();

            for (const crystalId of crystalIds) {
                result.set(crystalId.toString(), []);
            }

            for (const acc of allEntries) {
                const crystalId = acc.account.crystalId.toString();
                if (crystalIdSet.has(crystalId)) {
                    result.get(crystalId)!.push({
                        address: acc.publicKey.toString(),
                        crystalId,
                        contributor: acc.account.contributor.toString(),
                        role: this.parseRole(acc.account.role),
                        weight: acc.account.weight,
                        recordedAt: acc.account.recordedAt.toNumber(),
                    });
                }
            }

            this.logger.info(`批量 Entry 读取完成`);
            return result;
        } catch (err) {
            this.logger.error(`批量读取 Entry 失败: ${err}`);
            return new Map();
        }
    }

    /**
     * 将 EntryRecord 转换为 ContributionRecord (用于 anti-gaming pipeline)
     */
    static toContributionRecords(entries: EntryRecord[]): ContributionRecord[] {
        return entries.map(e => ({
            crystalId: e.crystalId,
            contributor: e.contributor,
            role: e.role,
            weight: e.weight,
        }));
    }

    // ==================== 私有辅助 ====================

    private parseReferenceType(onChainType: any): ReferenceTypeEnum {
        if (onChainType.import) return ReferenceTypeEnum.Import;
        if (onChainType.citation) return ReferenceTypeEnum.Citation;
        if (onChainType.mention) return ReferenceTypeEnum.Mention;
        if (onChainType.forkOrigin) return ReferenceTypeEnum.ForkOrigin;
        return ReferenceTypeEnum.Mention; // fallback
    }

    private parseRole(onChainRole: any): string {
        if (onChainRole.author) return 'Author';
        if (onChainRole.discussant) return 'Discussant';
        if (onChainRole.reviewer) return 'Reviewer';
        if (onChainRole.cited) return 'Cited';
        return 'Unknown';
    }
}
