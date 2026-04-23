import { PublicKey, SystemProgram } from '@solana/web3.js';
import * as anchor from '@coral-xyz/anchor';
import { createLogger, format, transports, Logger } from 'winston';
import {
    LedgerBuildResult,
    PendingContribution,
    PendingReference,
    ContributionRole,
    ReferenceType,
} from './types';

// ==================== Anchor 枚举映射 ====================

/** 将 TypeScript ContributionRole 映射为 Anchor IDL 枚举对象 */
function toAnchorRole(role: ContributionRole): object {
    switch (role) {
        case ContributionRole.Author: return { author: {} };
        case ContributionRole.Discussant: return { discussant: {} };
        case ContributionRole.Reviewer: return { reviewer: {} };
        case ContributionRole.Cited: return { cited: {} };
    }
}

/** 将 TypeScript ReferenceType 映射为 Anchor IDL 枚举对象 */
function toAnchorRefType(refType: ReferenceType): object {
    switch (refType) {
        case ReferenceType.Import: return { import: {} };
        case ReferenceType.Citation: return { citation: {} };
        case ReferenceType.Mention: return { mention: {} };
        case ReferenceType.ForkOrigin: return { forkOrigin: {} };
    }
}

// ==================== 配置 ====================

export interface SubmitterConfig {
    /** 交易失败时最大重试次数 */
    maxRetries: number;
    /** 初始重试延迟 (ms)，指数递增 */
    retryBaseDelayMs: number;
    /** 日志级别 */
    logLevel: string;
}

export const DEFAULT_SUBMITTER_CONFIG: SubmitterConfig = {
    maxRetries: 3,
    retryBaseDelayMs: 1000,
    logLevel: 'info',
};

// ==================== Submitter ====================

/**
 * Submitter — 将贡献账本提交到链上 contribution-engine 程序
 *
 * 使用 Anchor SDK 调用链上指令：
 * 1. 创建账本 (create_ledger)
 * 2. 批量记录贡献 (record_contribution × N)
 * 3. 添加引用关系 (add_reference × N)
 * 4. 关闭账本 (close_ledger)
 */
export class Submitter {
    private program: anchor.Program;
    private authority: anchor.web3.Keypair;
    private config: SubmitterConfig;
    private logger: Logger;

    constructor(
        program: anchor.Program,
        authority: anchor.web3.Keypair,
        config: Partial<SubmitterConfig> = {},
    ) {
        this.program = program;
        this.authority = authority;
        this.config = { ...DEFAULT_SUBMITTER_CONFIG, ...config };
        this.logger = createLogger({
            level: this.config.logLevel,
            format: format.combine(
                format.timestamp(),
                format.printf(({ timestamp, level, message }) =>
                    `${timestamp} [Submitter] ${level}: ${message}`
                ),
            ),
            transports: [new transports.Console()],
        });

        this.logger.info(`钱包: ${this.authority.publicKey.toBase58()}`);
        this.logger.info(`程序: ${this.program.programId.toBase58()}`);
    }

    /**
     * 提交完整贡献账本到链上
     */
    async submitLedger(result: LedgerBuildResult): Promise<SubmitResult> {
        const crystalId = result.crystalId;
        this.logger.info(`开始提交账本: crystal=${crystalId.toBase58()}`);

        const submitResult: SubmitResult = {
            crystalId,
            ledgerCreated: false,
            contributionsRecorded: 0,
            referencesAdded: 0,
            ledgerClosed: false,
            txSignatures: [],
            errors: [],
        };

        try {
            // Step 1: 创建账本
            const createTx = await this.createLedger(crystalId);
            submitResult.ledgerCreated = true;
            submitResult.txSignatures.push(createTx);
            this.logger.info(`账本已创建: crystal=${crystalId.toBase58()}, tx=${createTx.slice(0, 12)}...`);

            // Step 2: 批量记录贡献
            for (const contribution of result.contributions) {
                try {
                    const tx = await this.recordContribution(contribution);
                    submitResult.contributionsRecorded++;
                    submitResult.txSignatures.push(tx);
                } catch (err) {
                    const errMsg = `记录贡献失败: contributor=${contribution.contributor.toBase58()}, error=${err}`;
                    this.logger.error(errMsg);
                    submitResult.errors.push(errMsg);
                }
            }
            this.logger.info(`贡献已记录: ${submitResult.contributionsRecorded}/${result.contributions.length}`);

            // Step 3: 添加引用关系
            for (const ref of result.references) {
                try {
                    const tx = await this.addReference(ref);
                    submitResult.referencesAdded++;
                    submitResult.txSignatures.push(tx);
                } catch (err) {
                    const errMsg = `添加引用失败: ${ref.sourceId.toBase58()} -> ${ref.targetId.toBase58()}, error=${err}`;
                    this.logger.error(errMsg);
                    submitResult.errors.push(errMsg);
                }
            }
            this.logger.info(`引用已添加: ${submitResult.referencesAdded}/${result.references.length}`);

            // Step 4: 关闭账本
            const closeTx = await this.closeLedger(crystalId);
            submitResult.ledgerClosed = true;
            submitResult.txSignatures.push(closeTx);
            this.logger.info(`账本已关闭: crystal=${crystalId.toBase58()}, tx=${closeTx.slice(0, 12)}...`);

        } catch (err) {
            const errMsg = `提交账本失败: ${err}`;
            this.logger.error(errMsg);
            submitResult.errors.push(errMsg);
        }

        return submitResult;
    }

    // ==================== PDA 推导 ====================

    private findConfigPda(): [PublicKey, number] {
        return PublicKey.findProgramAddressSync(
            [Buffer.from('config')],
            this.program.programId,
        );
    }

    private findLedgerPda(crystalId: PublicKey): [PublicKey, number] {
        return PublicKey.findProgramAddressSync(
            [Buffer.from('ledger'), crystalId.toBuffer()],
            this.program.programId,
        );
    }

    private findEntryPda(crystalId: PublicKey, contributor: PublicKey): [PublicKey, number] {
        return PublicKey.findProgramAddressSync(
            [Buffer.from('entry'), crystalId.toBuffer(), contributor.toBuffer()],
            this.program.programId,
        );
    }

    private findReferencePda(sourceId: PublicKey, targetId: PublicKey): [PublicKey, number] {
        return PublicKey.findProgramAddressSync(
            [Buffer.from('ref'), sourceId.toBuffer(), targetId.toBuffer()],
            this.program.programId,
        );
    }

    // ==================== 链上指令调用 ====================

    /**
     * 创建贡献账本 PDA
     * IDL: create_ledger(crystal_id: Pubkey)
     * Accounts: config, ledger, authority, system_program
     */
    private async createLedger(crystalId: PublicKey): Promise<string> {
        const [configPda] = this.findConfigPda();
        const [ledgerPda] = this.findLedgerPda(crystalId);

        this.logger.debug(`create_ledger: config=${configPda.toBase58()}, ledger=${ledgerPda.toBase58()}`);

        return this.sendWithRetry(() =>
            (this.program.methods as any)
                .createLedger(crystalId)
                .accounts({
                    config: configPda,
                    ledger: ledgerPda,
                    authority: this.authority.publicKey,
                    systemProgram: SystemProgram.programId,
                })
                .signers([this.authority])
                .rpc()
        );
    }

    /**
     * 记录单条贡献
     * IDL: record_contribution(role: ContributionRole, weight: f64)
     * Accounts: config, ledger, entry, contributor, authority, system_program
     */
    private async recordContribution(contribution: PendingContribution): Promise<string> {
        const [configPda] = this.findConfigPda();
        const [ledgerPda] = this.findLedgerPda(contribution.crystalId);
        const [entryPda] = this.findEntryPda(contribution.crystalId, contribution.contributor);

        this.logger.debug(
            `record_contribution: entry=${entryPda.toBase58()}, ` +
            `role=${contribution.role}, weight=${contribution.weight.toFixed(4)}`
        );

        return this.sendWithRetry(() =>
            (this.program.methods as any)
                .recordContribution(
                    toAnchorRole(contribution.role),
                    contribution.weight,
                )
                .accounts({
                    config: configPda,
                    ledger: ledgerPda,
                    entry: entryPda,
                    contributor: contribution.contributor,
                    authority: this.authority.publicKey,
                    systemProgram: SystemProgram.programId,
                })
                .signers([this.authority])
                .rpc()
        );
    }

    /**
     * 添加引用关系
     * IDL: add_reference(ref_type: ReferenceType)
     * Accounts: config, reference, source_content, target_content, authority, system_program
     */
    private async addReference(ref: PendingReference): Promise<string> {
        const [configPda] = this.findConfigPda();
        const [referencePda] = this.findReferencePda(ref.sourceId, ref.targetId);

        this.logger.debug(
            `add_reference: ref=${referencePda.toBase58()}, type=${ref.refType}`
        );

        return this.sendWithRetry(() =>
            (this.program.methods as any)
                .addReference(
                    toAnchorRefType(ref.refType),
                )
                .accounts({
                    config: configPda,
                    reference: referencePda,
                    sourceContent: ref.sourceId,
                    targetContent: ref.targetId,
                    authority: this.authority.publicKey,
                    systemProgram: SystemProgram.programId,
                })
                .signers([this.authority])
                .rpc()
        );
    }

    /**
     * 关闭账本
     * IDL: close_ledger()
     * Accounts: config, ledger, admin (signer, relation: config)
     */
    private async closeLedger(crystalId: PublicKey): Promise<string> {
        const [configPda] = this.findConfigPda();
        const [ledgerPda] = this.findLedgerPda(crystalId);

        this.logger.debug(`close_ledger: ledger=${ledgerPda.toBase58()}`);

        return this.sendWithRetry(() =>
            (this.program.methods as any)
                .closeLedger()
                .accounts({
                    config: configPda,
                    ledger: ledgerPda,
                    admin: this.authority.publicKey,
                })
                .signers([this.authority])
                .rpc()
        );
    }

    // ==================== 重试逻辑 ====================

    /**
     * 带指数退避的重试包装器
     * 遇到可重试错误（网络、blockhash 过期等）时自动重试
     */
    private async sendWithRetry(fn: () => Promise<string>): Promise<string> {
        let lastError: Error | null = null;

        for (let attempt = 0; attempt < this.config.maxRetries; attempt++) {
            try {
                return await fn();
            } catch (err: any) {
                lastError = err;

                if (!this.isRetryable(err) || attempt === this.config.maxRetries - 1) {
                    throw err;
                }

                const delay = this.config.retryBaseDelayMs * Math.pow(2, attempt);
                this.logger.warn(
                    `交易失败 (attempt ${attempt + 1}/${this.config.maxRetries}), ` +
                    `${delay}ms 后重试: ${err.message || err}`
                );
                await this.sleep(delay);
            }
        }

        throw lastError!;
    }

    /** 判断错误是否可重试 */
    private isRetryable(err: any): boolean {
        const msg = (err.message || String(err)).toLowerCase();
        return (
            msg.includes('blockhash not found') ||
            msg.includes('blockhash has expired') ||
            msg.includes('network error') ||
            msg.includes('timeout') ||
            msg.includes('429') ||        // rate limit
            msg.includes('502') ||        // bad gateway
            msg.includes('503') ||        // service unavailable
            msg.includes('econnrefused') ||
            msg.includes('econnreset')
        );
    }

    private sleep(ms: number): Promise<void> {
        return new Promise(resolve => setTimeout(resolve, ms));
    }
}

// ==================== 结果类型 ====================

export interface SubmitResult {
    crystalId: PublicKey;
    ledgerCreated: boolean;
    contributionsRecorded: number;
    referencesAdded: number;
    ledgerClosed: boolean;
    /** 所有成功交易的签名列表 */
    txSignatures: string[];
    errors: string[];
}
