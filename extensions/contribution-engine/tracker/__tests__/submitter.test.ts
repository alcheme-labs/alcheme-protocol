/**
 * Submitter 链上提交测试
 *
 * 使用 mock 的 Anchor Program，验证:
 * 1. Happy path: 完整账本提交 (create → record × N → add_reference × N → close)
 * 2. 部分失败: 某条 record_contribution 失败，其余成功
 * 3. 创建失败: create_ledger 异常时整个流程中止
 * 4. 重试逻辑: 可重试错误触发自动重试
 */

import { Submitter, SubmitResult, SubmitterConfig } from '../src/submitter';
import { ContributionRole, ReferenceType, LedgerBuildResult } from '../src/types';
import { Keypair, PublicKey } from '@solana/web3.js';

// ==================== Mock Program ====================

function createMockProgram(overrides: {
    createLedger?: () => Promise<string>;
    recordContribution?: () => Promise<string>;
    addReference?: () => Promise<string>;
    closeLedger?: () => Promise<string>;
} = {}): any {
    const defaultRpc = async () => 'mock_tx_' + Math.random().toString(36).slice(2, 8);

    return {
        programId: Keypair.generate().publicKey,
        methods: {
            createLedger: () => ({
                accounts: () => ({
                    signers: () => ({
                        rpc: overrides.createLedger ?? defaultRpc,
                    }),
                }),
            }),
            recordContribution: () => ({
                accounts: () => ({
                    signers: () => ({
                        rpc: overrides.recordContribution ?? defaultRpc,
                    }),
                }),
            }),
            addReference: () => ({
                accounts: () => ({
                    signers: () => ({
                        rpc: overrides.addReference ?? defaultRpc,
                    }),
                }),
            }),
            closeLedger: () => ({
                accounts: () => ({
                    signers: () => ({
                        rpc: overrides.closeLedger ?? defaultRpc,
                    }),
                }),
            }),
        },
    };
}

// ==================== Helper ====================

function buildLedger(opts: {
    numContributions?: number;
    numReferences?: number;
} = {}): LedgerBuildResult {
    const crystalId = Keypair.generate().publicKey;
    const contributions = [];
    const references = [];

    const roles = [ContributionRole.Author, ContributionRole.Discussant, ContributionRole.Reviewer, ContributionRole.Cited];
    for (let i = 0; i < (opts.numContributions ?? 2); i++) {
        contributions.push({
            crystalId,
            contributor: Keypair.generate().publicKey,
            role: roles[i % roles.length],
            weight: 0.5 / (opts.numContributions ?? 2),
        });
    }

    const refTypes = [ReferenceType.Import, ReferenceType.Citation, ReferenceType.Mention, ReferenceType.ForkOrigin];
    for (let i = 0; i < (opts.numReferences ?? 1); i++) {
        references.push({
            sourceId: crystalId,
            targetId: Keypair.generate().publicKey,
            refType: refTypes[i % refTypes.length],
        });
    }

    return {
        crystalId,
        contributions,
        references,
        totalWeight: contributions.reduce((sum, c) => sum + c.weight, 0),
    };
}

const TEST_CONFIG: Partial<SubmitterConfig> = {
    logLevel: 'error',
    maxRetries: 2,
    retryBaseDelayMs: 10, // 快速重试以加速测试
};

// ==================== 测试 ====================

describe('Submitter 链上提交', () => {
    const authority = Keypair.generate();

    // ==================== Happy Path ====================

    describe('Happy Path: 完整账本提交', () => {
        it('成功提交包含多条贡献和引用的账本', async () => {
            const program = createMockProgram();
            const submitter = new Submitter(program, authority, TEST_CONFIG);

            const ledger = buildLedger({ numContributions: 3, numReferences: 2 });
            const result = await submitter.submitLedger(ledger);

            expect(result.ledgerCreated).toBe(true);
            expect(result.contributionsRecorded).toBe(3);
            expect(result.referencesAdded).toBe(2);
            expect(result.ledgerClosed).toBe(true);
            expect(result.errors).toHaveLength(0);
            // 1 create + 3 record + 2 add_ref + 1 close = 7 tx
            expect(result.txSignatures).toHaveLength(7);
        });

        it('空贡献和引用时仅创建和关闭账本', async () => {
            const program = createMockProgram();
            const submitter = new Submitter(program, authority, TEST_CONFIG);

            const ledger = buildLedger({ numContributions: 0, numReferences: 0 });
            const result = await submitter.submitLedger(ledger);

            expect(result.ledgerCreated).toBe(true);
            expect(result.contributionsRecorded).toBe(0);
            expect(result.referencesAdded).toBe(0);
            expect(result.ledgerClosed).toBe(true);
            expect(result.errors).toHaveLength(0);
            // 1 create + 1 close = 2 tx
            expect(result.txSignatures).toHaveLength(2);
        });
    });

    // ==================== 部分失败 ====================

    describe('部分失败: 某些贡献记录失败', () => {
        it('第二条 recordContribution 失败，其余成功', async () => {
            let callCount = 0;
            const program = createMockProgram({
                recordContribution: async () => {
                    callCount++;
                    if (callCount === 2) {
                        throw new Error('InstructionError: ContributionExists');
                    }
                    return 'tx_record_' + callCount;
                },
            });

            const submitter = new Submitter(program, authority, TEST_CONFIG);
            const ledger = buildLedger({ numContributions: 3 });
            const result = await submitter.submitLedger(ledger);

            // 2 of 3 succeed
            expect(result.contributionsRecorded).toBe(2);
            expect(result.ledgerCreated).toBe(true);
            expect(result.ledgerClosed).toBe(true);
            expect(result.errors).toHaveLength(1);
            expect(result.errors[0]).toContain('ContributionExists');
        });

        it('addReference 失败不影响账本关闭', async () => {
            const program = createMockProgram({
                addReference: async () => {
                    throw new Error('ReferenceExists');
                },
            });

            const submitter = new Submitter(program, authority, TEST_CONFIG);
            const ledger = buildLedger({ numContributions: 1, numReferences: 2 });
            const result = await submitter.submitLedger(ledger);

            expect(result.referencesAdded).toBe(0);
            expect(result.errors).toHaveLength(2);
            expect(result.ledgerClosed).toBe(true);
        });
    });

    // ==================== 创建失败 ====================

    describe('创建失败: create_ledger 异常', () => {
        it('create_ledger 失败时整个流程中止', async () => {
            const program = createMockProgram({
                createLedger: async () => {
                    throw new Error('LedgerAlreadyExists');
                },
            });

            const submitter = new Submitter(program, authority, TEST_CONFIG);
            const ledger = buildLedger({ numContributions: 2, numReferences: 1 });
            const result = await submitter.submitLedger(ledger);

            expect(result.ledgerCreated).toBe(false);
            expect(result.contributionsRecorded).toBe(0);
            expect(result.referencesAdded).toBe(0);
            expect(result.ledgerClosed).toBe(false);
            expect(result.errors).toHaveLength(1);
            expect(result.errors[0]).toContain('LedgerAlreadyExists');
        });

        it('closeLedger 失败被捕获到 errors', async () => {
            const program = createMockProgram({
                closeLedger: async () => {
                    throw new Error('LedgerNotFound');
                },
            });

            const submitter = new Submitter(program, authority, TEST_CONFIG);
            const ledger = buildLedger({ numContributions: 1 });
            const result = await submitter.submitLedger(ledger);

            expect(result.ledgerCreated).toBe(true);
            expect(result.contributionsRecorded).toBe(1);
            expect(result.ledgerClosed).toBe(false);
            expect(result.errors).toHaveLength(1);
            expect(result.errors[0]).toContain('LedgerNotFound');
        });
    });

    // ==================== 重试逻辑 ====================

    describe('重试逻辑', () => {
        it('网络错误时自动重试并最终成功', async () => {
            let attempts = 0;
            const program = createMockProgram({
                createLedger: async () => {
                    attempts++;
                    if (attempts === 1) {
                        throw new Error('network error: ECONNRESET');
                    }
                    return 'tx_retry_success';
                },
            });

            const submitter = new Submitter(program, authority, TEST_CONFIG);
            const ledger = buildLedger({ numContributions: 0, numReferences: 0 });
            const result = await submitter.submitLedger(ledger);

            expect(result.ledgerCreated).toBe(true);
            expect(result.errors).toHaveLength(0);
            expect(attempts).toBe(2); // 第一次失败 + 第二次成功
        });

        it('blockhash 过期时重试', async () => {
            let attempts = 0;
            const program = createMockProgram({
                recordContribution: async () => {
                    attempts++;
                    if (attempts <= 1) {
                        throw new Error('Blockhash not found');
                    }
                    return 'tx_blockhash_retry';
                },
            });

            const submitter = new Submitter(program, authority, TEST_CONFIG);
            const ledger = buildLedger({ numContributions: 1, numReferences: 0 });
            const result = await submitter.submitLedger(ledger);

            expect(result.contributionsRecorded).toBe(1);
            expect(attempts).toBe(2);
        });

        it('不可重试错误不会重试', async () => {
            let attempts = 0;
            const program = createMockProgram({
                createLedger: async () => {
                    attempts++;
                    throw new Error('InstructionError: InvalidRole');
                },
            });

            const submitter = new Submitter(program, authority, TEST_CONFIG);
            const ledger = buildLedger({ numContributions: 0, numReferences: 0 });
            const result = await submitter.submitLedger(ledger);

            expect(result.ledgerCreated).toBe(false);
            expect(attempts).toBe(1); // 不重试
        });

        it('超过最大重试次数后抛出最后一个错误', async () => {
            let attempts = 0;
            const program = createMockProgram({
                createLedger: async () => {
                    attempts++;
                    throw new Error('network error: timeout');
                },
            });

            const submitter = new Submitter(program, authority, TEST_CONFIG);
            const ledger = buildLedger({ numContributions: 0, numReferences: 0 });
            const result = await submitter.submitLedger(ledger);

            expect(result.ledgerCreated).toBe(false);
            expect(attempts).toBe(2); // maxRetries = 2
            expect(result.errors[0]).toContain('timeout');
        });
    });

    // ==================== SubmitResult 结构 ====================

    describe('SubmitResult 结构', () => {
        it('crystalId 正确传递', async () => {
            const program = createMockProgram();
            const submitter = new Submitter(program, authority, TEST_CONFIG);

            const ledger = buildLedger();
            const result = await submitter.submitLedger(ledger);

            expect(result.crystalId.equals(ledger.crystalId)).toBe(true);
        });

        it('txSignatures 只包含成功的交易', async () => {
            let callCount = 0;
            const program = createMockProgram({
                recordContribution: async () => {
                    callCount++;
                    if (callCount === 1) throw new Error('first fails');
                    return 'tx_success_' + callCount;
                },
            });

            const submitter = new Submitter(program, authority, TEST_CONFIG);
            const ledger = buildLedger({ numContributions: 2, numReferences: 0 });
            const result = await submitter.submitLedger(ledger);

            // 1 create + 1 successful record + 1 close = 3 tx
            expect(result.contributionsRecorded).toBe(1);
            expect(result.txSignatures).toHaveLength(3);
        });
    });
});
