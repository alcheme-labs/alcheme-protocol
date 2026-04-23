/**
 * Settler 结算编排器测试
 *
 * 使用 mock 的 ChainReader 和 DbWriter，验证:
 * 1. 无待结算 Ledger 时直接返回
 * 2. 正确计算 authority score 并传递
 * 3. 封锁用户被跳过
 * 4. 错误处理与恢复
 */

import { Settler, SettlerConfig } from '../src/settler';
import { ChainReader, LedgerRecord, EntryRecord } from '../src/data/chain-reader';
import { DbWriter } from '../src/data/db-writer';
import { PublicKey, Keypair } from '@solana/web3.js';
import { DEFAULT_IDENTITY_REGISTRY_NAME, deriveIdentityRegistryPda, deriveUserIdentityPda } from '../src/identity-resolver';
import fs from 'node:fs';
import path from 'node:path';

// ==================== Mock 类 ====================

class MockChainReader {
    constructor(
        private _references: any[] = [],
        private _ledgers: LedgerRecord[] = [],
        private _entries: Map<string, EntryRecord[]> = new Map(),
    ) { }

    async fetchAllReferences() { return this._references; }
    async fetchUnsettledLedgers() { return this._ledgers; }
    async fetchEntriesForCrystals() { return this._entries; }

    static toContributionRecords(entries: EntryRecord[]) {
        return entries.map(e => ({
            crystalId: e.crystalId,
            contributor: e.contributor,
            role: e.role,
            weight: e.weight,
        }));
    }
}

class MockDbWriter {
    public writtenScores: any[] = [];
    public writtenFlags: any[] = [];
    public writtenHistory: any[] = [];
    public handles = new Map<string, string>();

    async writeAuthorityScores(scores: any[]) { this.writtenScores.push(...scores); }
    async writeAntiGamingFlags(flags: any[]) { this.writtenFlags.push(...flags); }
    async writeSettlementHistory(rows: any[]) { this.writtenHistory.push(...rows); }
    async getCurrentEpoch() { return 1; }
    async findUserHandleByPubkey(pubkey: string) { return this.handles.get(pubkey) ?? null; }
    async close() { }
}

// ==================== 测试 ====================

describe('Settler 结算编排器', () => {
    const keypair = Keypair.generate();
    const settlerSource = fs.readFileSync(
        path.join(__dirname, '..', 'src', 'settler.ts'),
        'utf8',
    );

    function createSettler(
        chainReader: MockChainReader,
        dbWriter: MockDbWriter,
        configOverrides: Partial<SettlerConfig> = {},
    ): Settler {
        const config: SettlerConfig = {
            pageRank: {},
            antiGaming: {},
            writeToDb: true,
            executeOnChain: false, // 默认不执行链上操作 (无 program mock)
            ...configOverrides,
        };

        // 使用 null program 因为我们不执行链上操作
        return new Settler(
            chainReader as any,
            dbWriter as any,
            null as any, // ceProgram
            null as any, // irProgram
            null as any, // rfProgram
            keypair,
            config,
            undefined,
            'error',
        );
    }

    // ==================== 无待结算 Ledger ====================

    describe('无待结算 Ledger', () => {
        it('直接返回空结果', async () => {
            const reader = new MockChainReader();
            const writer = new MockDbWriter();
            const settler = createSettler(reader, writer);

            const result = await settler.runEpoch();

            expect(result.crystalsProcessed).toBe(0);
            expect(result.entriesSettled).toBe(0);
            expect(result.errors.length).toBe(0);
        });
    });

    // ==================== PageRank 计算 ====================

    describe('PageRank 计算', () => {
        it('正确计算 authority scores 并写入 DB', async () => {
            const crystalA = Keypair.generate().publicKey.toString();
            const crystalB = Keypair.generate().publicKey.toString();

            const reader = new MockChainReader(
                // References: A→B
                [{
                    sourceId: crystalA,
                    targetId: crystalB,
                    refType: 'Citation',
                    weight: 0.5,
                    creator: 'user1',
                    createdAt: Math.floor(Date.now() / 1000),
                }],
                // Ledgers: A 待结算
                [{
                    address: 'ledger1',
                    crystalId: crystalA,
                    totalContributors: 1,
                    closed: true,
                    totalWeight: 0.5,
                    reputationSettled: false,
                    createdAt: Math.floor(Date.now() / 1000),
                }],
                // Entries
                new Map([[crystalA, [{
                    address: 'entry1',
                    crystalId: crystalA,
                    contributor: 'contributor1',
                    role: 'Author',
                    weight: 0.5,
                    recordedAt: Math.floor(Date.now() / 1000),
                }]]]),
            );

            const writer = new MockDbWriter();
            const settler = createSettler(reader, writer);

            const result = await settler.runEpoch();

            expect(result.crystalsProcessed).toBe(1);
            expect(result.pageRankConverged).toBe(true);
            expect(result.epoch).toBe(1);

            // authority scores 应该被写入
            expect(writer.writtenScores.length).toBeGreaterThan(0);
            // 每个 Crystal 都有一个 score entry
            const crystalAScore = writer.writtenScores.find(
                (s: any) => s.crystalId === crystalA
            );
            expect(crystalAScore).toBeDefined();
            expect(crystalAScore.score).toBeGreaterThan(0);
        });
    });

    // ==================== 反作弊标记 ====================

    describe('反作弊标记', () => {
        it('幽灵贡献被过滤', async () => {
            const crystal = Keypair.generate().publicKey.toString();

            const reader = new MockChainReader(
                [],
                [{
                    address: 'ledger1',
                    crystalId: crystal,
                    totalContributors: 2,
                    closed: true,
                    totalWeight: 0.51,
                    reputationSettled: false,
                    createdAt: Math.floor(Date.now() / 1000),
                }],
                new Map([[crystal, [
                    {
                        address: 'entry1',
                        crystalId: crystal,
                        contributor: 'alice',
                        role: 'Author',
                        weight: 0.5,
                        recordedAt: Math.floor(Date.now() / 1000),
                    },
                    {
                        address: 'entry2',
                        crystalId: crystal,
                        contributor: 'bob',
                        role: 'Discussant',
                        weight: 0.001, // 幽灵贡献
                        recordedAt: Math.floor(Date.now() / 1000),
                    },
                ]]]),
            );

            const writer = new MockDbWriter();
            const settler = createSettler(reader, writer);

            const result = await settler.runEpoch();

            // 应该有 anti-gaming 标记
            expect(result.antiGamingFlags).toBeGreaterThan(0);
            expect(writer.writtenFlags.length).toBeGreaterThan(0);
        });
    });

    // ==================== Dry-run 模式 ====================

    describe('Dry-run 模式', () => {
        it('writeToDb=false 时不写入数据库', async () => {
            const reader = new MockChainReader(
                [],
                [{
                    address: 'ledger1',
                    crystalId: Keypair.generate().publicKey.toString(),
                    totalContributors: 1,
                    closed: true,
                    totalWeight: 0.5,
                    reputationSettled: false,
                    createdAt: Math.floor(Date.now() / 1000),
                }],
                new Map(),
            );

            const writer = new MockDbWriter();
            const settler = createSettler(reader, writer, { writeToDb: false });

            await settler.runEpoch();

            expect(writer.writtenScores.length).toBe(0);
            expect(writer.writtenFlags.length).toBe(0);
            expect(writer.writtenHistory.length).toBe(0);
        });
    });

    // ==================== 封锁用户跳过 ====================

    describe('封锁用户在链上结算时被跳过', () => {
        it('spam 用户的 entry 不会调用 settleReputation', async () => {
            const crystal = Keypair.generate().publicKey.toString();
            const spammer = Keypair.generate().publicKey.toString();
            const normalUser = Keypair.generate().publicKey.toString();

            // 制造 >50 条 spam 引用
            const spamRefs: any[] = [];
            for (let i = 0; i < 51; i++) {
                spamRefs.push({
                    sourceId: `src${i}`,
                    targetId: `tgt${i}`,
                    refType: 'Citation',
                    weight: 0.5,
                    creator: spammer,
                    createdAt: Math.floor(Date.now() / 1000),
                });
            }

            const reader = new MockChainReader(
                spamRefs,
                [{
                    address: 'ledger1',
                    crystalId: crystal,
                    totalContributors: 2,
                    closed: true,
                    totalWeight: 1.0,
                    reputationSettled: false,
                    createdAt: Math.floor(Date.now() / 1000),
                }],
                new Map([[crystal, [
                    {
                        address: 'entry_spammer',
                        crystalId: crystal,
                        contributor: spammer,
                        role: 'Author',
                        weight: 0.5,
                        recordedAt: Math.floor(Date.now() / 1000),
                    },
                    {
                        address: 'entry_normal',
                        crystalId: crystal,
                        contributor: normalUser,
                        role: 'Reviewer',
                        weight: 0.3,
                        recordedAt: Math.floor(Date.now() / 1000),
                    },
                ]]]),
            );

            // Mock ceProgram — settleReputation 方法链
            let settleCallCount = 0;
            const settledContributors: string[] = [];

            const mockCeProgram = {
                programId: Keypair.generate().publicKey,
                methods: {
                    settleReputation: () => ({
                        accounts: () => ({
                            signers: () => ({
                                rpc: async () => {
                                    settleCallCount++;
                                    return 'mock_tx_signature';
                                },
                            }),
                        }),
                    }),
                },
                account: {},
            };

            // Mock irProgram — 返回 null 使 findUserIdentityPda 返回 null
            // 这样两个用户 都 不会执行链上调用
            // 我们真正要验证的是 spammer 被 skip (在 blockedUsers check 之前不会走到 PDA 查找)
            // 而 normal_user 会尝试 PDA 查找但找不到 → 也跳过
            const mockIrProgram = {
                programId: Keypair.generate().publicKey,
                account: {
                    userIdentityAccount: {
                        all: async () => [],
                        fetch: async () => null,
                    },
                },
            };

            const mockRfProgram = {
                programId: Keypair.generate().publicKey,
            };

            const config: SettlerConfig = {
                pageRank: {},
                antiGaming: {},
                writeToDb: true,
                executeOnChain: true,
            };

            const settler = new Settler(
                reader as any,
                new MockDbWriter() as any,
                mockCeProgram as any,
                mockIrProgram as any,
                mockRfProgram as any,
                keypair,
                config,
                undefined,
                'error',
            );

            const result = await settler.runEpoch();

            // spammer 应该被封锁 (>50 条引用 → critical)
            expect(result.blockedUsers).toBe(1);

            // settleReputation 不应该被调用
            // (spammer → blocked skip, normal_user → PDA not found → skip)
            expect(settleCallCount).toBe(0);
            expect(result.entriesSettled).toBe(0);
        });
    });

    // ==================== 链上结算错误 ====================

    describe('链上 settle 失败时错误被记录', () => {
        it('rpc() 抛出异常时 error 被捕获到 result.errors', async () => {
            const crystal = Keypair.generate().publicKey.toString();
            const contributor = Keypair.generate().publicKey.toString();
            const mockIrProgramId = Keypair.generate().publicKey;
            const contributorHandle = 'alice';
            const identityRegistryPk = deriveIdentityRegistryPda(
                mockIrProgramId,
                DEFAULT_IDENTITY_REGISTRY_NAME,
            );
            const userIdentityPk = deriveUserIdentityPda(
                mockIrProgramId,
                identityRegistryPk,
                contributorHandle,
            );

            const reader = new MockChainReader(
                [],
                [{
                    address: 'ledger1',
                    crystalId: crystal,
                    totalContributors: 1,
                    closed: true,
                    totalWeight: 0.5,
                    reputationSettled: false,
                    createdAt: Math.floor(Date.now() / 1000),
                }],
                new Map([[crystal, [{
                    address: 'entry1',
                    crystalId: crystal,
                    contributor,
                    role: 'Author',
                    weight: 0.5,
                    recordedAt: Math.floor(Date.now() / 1000),
                }]]]),
            );

            // Mock ceProgram — rpc() 会抛出错误
            const mockCeProgram = {
                programId: Keypair.generate().publicKey,
                methods: {
                    settleReputation: () => ({
                        accounts: () => ({
                            signers: () => ({
                                rpc: async () => {
                                    throw new Error('Transaction simulation failed: InstructionError');
                                },
                            }),
                        }),
                    }),
                },
            };

            const mockIrProgram = {
                programId: mockIrProgramId,
                provider: {
                    connection: {
                        getAccountInfo: jest
                            .fn()
                            .mockResolvedValueOnce({ executable: false })
                            .mockResolvedValueOnce({ executable: false }),
                    },
                },
            };

            const mockRfProgram = {
                programId: Keypair.generate().publicKey,
            };

            const config: SettlerConfig = {
                pageRank: {},
                antiGaming: {},
                writeToDb: true,
                executeOnChain: true,
            };

            const writer = new MockDbWriter();
            writer.handles.set(contributor, contributorHandle);
            const settler = new Settler(
                reader as any,
                writer as any,
                mockCeProgram as any,
                mockIrProgram as any,
                mockRfProgram as any,
                keypair,
                config,
                { identityRegistryName: DEFAULT_IDENTITY_REGISTRY_NAME },
                'error',
            );

            const result = await settler.runEpoch();

            // 应该有错误
            expect(result.errors.length).toBeGreaterThan(0);
            // 错误信息应该包含 contributor 信息
            expect(result.errors[0]).toContain('结算失败');
            expect(result.errors[0]).toContain('InstructionError');
            // entry 不应该被计为已结算
            expect(result.entriesSettled).toBe(0);
            // 但 crystal 仍然被处理了
            expect(result.crystalsProcessed).toBe(1);
            // settlement history 不应该有记录 (因为失败了)
            expect(writer.writtenHistory.length).toBe(0);
        });
    });

    describe('identity resolution architecture guard', () => {
        it('does not retain full userIdentityAccount scans in production settler path', () => {
            expect(settlerSource).not.toContain('userIdentityAccount.all()');
            expect(settlerSource).not.toContain('findUserIdentityPda(');
            expect(settlerSource).not.toContain('findIdentityRegistryPda(');
        });

        it('passes the effective identity registry name into the resolver runtime binding', () => {
            const customRegistryName = 'custom_identity_registry';
            const mockIrProgram = {
                programId: Keypair.generate().publicKey,
                provider: {
                    connection: {
                        getAccountInfo: jest.fn(),
                    },
                },
            };

            const settler = new Settler(
                new MockChainReader() as any,
                new MockDbWriter() as any,
                {} as any,
                mockIrProgram as any,
                { programId: Keypair.generate().publicKey } as any,
                keypair,
                {
                    pageRank: {},
                    antiGaming: {},
                    writeToDb: true,
                    executeOnChain: false,
                },
                { identityRegistryName: customRegistryName },
                'error',
            );

            expect((settler as any).identityResolver).not.toBeNull();
            expect((settler as any).identityResolver.registryName).toBe(customRegistryName);
        });
    });
});
