import { PublicKey } from '@solana/web3.js';
import { adaptProtocolEvent } from '../src/core-event-adapter';
import { LedgerBuilder } from '../src/ledger-builder';
import {
    ContributionSourceEvent,
    ContributionRole,
    DEFAULT_ROLE_WEIGHTS,
    ProtocolEvent,
    ProtocolEventType,
    ReferenceType,
    REFERENCE_WEIGHTS,
} from '../src/types';

describe('LedgerBuilder', () => {
    let builder: LedgerBuilder;

    function asContributionSourceEvent(event: ProtocolEvent): ContributionSourceEvent {
        const adapted = adaptProtocolEvent(event);
        expect(adapted).not.toBeNull();
        return adapted!;
    }

    beforeEach(() => {
        builder = new LedgerBuilder(undefined, 'error'); // suppress logs
    });

    describe('buildLedger', () => {
        it('应正确生成包含所有四种角色的账本', async () => {
            const crystalId = PublicKey.unique();
            const author1 = PublicKey.unique();
            const author2 = PublicKey.unique();
            const discussant1 = PublicKey.unique();
            const reviewer1 = PublicKey.unique();
            const targetCrystal = PublicKey.unique();
            const citedAuthor = PublicKey.unique();

            const event: ProtocolEvent = {
                type: ProtocolEventType.ContentStatusChanged,
                timestamp: Date.now(),
                slot: 12345,
                data: {
                    content_id: crystalId.toBase58(),
                    new_status: 'CRYSTAL',
                    creator: author1.toBase58(),
                    authors: [
                        { user_id: author1.toBase58(), edit_count: 3 },
                        { user_id: author2.toBase58(), edit_count: 1 },
                    ],
                    discussants: [
                        { user_id: discussant1.toBase58(), event_count: 5 },
                        { user_id: author1.toBase58(), event_count: 2 }, // 也是 author，应被排除
                    ],
                    reviewers: [
                        { user_id: reviewer1.toBase58() },
                    ],
                    references: [
                        {
                            target_crystal_id: targetCrystal.toBase58(),
                            ref_type: 'Citation',
                            original_author: citedAuthor.toBase58(),
                        },
                    ],
                },
            };

            const result = await builder.buildLedger(asContributionSourceEvent(event));

            expect(result).not.toBeNull();
            expect(result!.crystalId.equals(crystalId)).toBe(true);

            // 应有 5 条贡献: 2 author + 1 discussant + 1 reviewer + 1 cited
            expect(result!.contributions.length).toBe(5);

            // 验证 Authors
            const authors = result!.contributions.filter(c => c.role === ContributionRole.Author);
            expect(authors.length).toBe(2);
            // author1 编辑 3/4, author2 编辑 1/4
            const author1Entry = authors.find(a => a.contributor.equals(author1));
            expect(author1Entry).toBeDefined();
            expect(author1Entry!.weight).toBeCloseTo(0.50 * (3 / 4), 4);
            const author2Entry = authors.find(a => a.contributor.equals(author2));
            expect(author2Entry!.weight).toBeCloseTo(0.50 * (1 / 4), 4);

            // 验证 Discussant (排除了 author1)
            const discussants = result!.contributions.filter(c => c.role === ContributionRole.Discussant);
            expect(discussants.length).toBe(1);
            expect(discussants[0].contributor.equals(discussant1)).toBe(true);
            expect(discussants[0].weight).toBeCloseTo(0.25, 4);

            // 验证 Reviewer
            const reviewers = result!.contributions.filter(c => c.role === ContributionRole.Reviewer);
            expect(reviewers.length).toBe(1);
            expect(reviewers[0].weight).toBeCloseTo(0.20, 4);

            // 验证 Cited
            const cited = result!.contributions.filter(c => c.role === ContributionRole.Cited);
            expect(cited.length).toBe(1);
            expect(cited[0].weight).toBeCloseTo(0.05, 4);

            // 验证 References
            expect(result!.references.length).toBe(1);
            expect(result!.references[0].refType).toBe(ReferenceType.Citation);

            // 验证总权重接近 1.0
            expect(result!.totalWeight).toBeCloseTo(1.0, 2);
        });

        it('应跳过非 ContentStatusChanged 事件', async () => {
            const result = await builder.buildLedger({
                type: 'UnsupportedContributionSourceEvent' as any,
                timestamp: Date.now(),
                slot: 100,
                data: {
                    content_id: PublicKey.unique().toBase58(),
                },
            });
            expect(result).toBeNull();
        });

        it('应跳过非 CRYSTAL 状态变更', async () => {
            const event: ProtocolEvent = {
                type: ProtocolEventType.ContentStatusChanged,
                timestamp: Date.now(),
                slot: 100,
                data: { new_status: 'ALLOY', content_id: PublicKey.unique().toBase58() },
            };

            expect(adaptProtocolEvent(event)).toBeNull();
        });

        it('应回退使用 creator 当没有 authors 数据时', async () => {
            const crystalId = PublicKey.unique();
            const creator = PublicKey.unique();

            const event: ProtocolEvent = {
                type: ProtocolEventType.ContentStatusChanged,
                timestamp: Date.now(),
                slot: 100,
                data: {
                    content_id: crystalId.toBase58(),
                    new_status: 'CRYSTAL',
                    creator: creator.toBase58(),
                },
            };

            const result = await builder.buildLedger(asContributionSourceEvent(event));
            expect(result).not.toBeNull();
            expect(result!.contributions.length).toBe(1);
            expect(result!.contributions[0].role).toBe(ContributionRole.Author);
            expect(result!.contributions[0].contributor.equals(creator)).toBe(true);
            expect(result!.contributions[0].weight).toBeCloseTo(0.50, 4);
        });

        it('应正确处理多种引用类型的权重', async () => {
            const crystalId = PublicKey.unique();
            const creator = PublicKey.unique();
            const target1 = PublicKey.unique();
            const target2 = PublicKey.unique();
            const cited1 = PublicKey.unique();
            const cited2 = PublicKey.unique();

            const event: ProtocolEvent = {
                type: ProtocolEventType.ContentStatusChanged,
                timestamp: Date.now(),
                slot: 100,
                data: {
                    content_id: crystalId.toBase58(),
                    new_status: 'CRYSTAL',
                    creator: creator.toBase58(),
                    references: [
                        {
                            target_crystal_id: target1.toBase58(),
                            ref_type: 'Import',
                            original_author: cited1.toBase58(),
                        },
                        {
                            target_crystal_id: target2.toBase58(),
                            ref_type: 'Mention',
                            original_author: cited2.toBase58(),
                        },
                    ],
                },
            };

            const result = await builder.buildLedger(asContributionSourceEvent(event));
            expect(result).not.toBeNull();

            const refs = result!.references;
            expect(refs.length).toBe(2);

            // Cited 条目: Import 权重 1.0 / 1.1 总, Mention 权重 0.1 / 1.1 总
            const citedEntries = result!.contributions.filter(c => c.role === ContributionRole.Cited);
            expect(citedEntries.length).toBe(2);

            const importCited = citedEntries.find(c => c.contributor.equals(cited1));
            expect(importCited).toBeDefined();
            expect(importCited!.weight).toBeCloseTo(0.05 * (1.0 / 1.1), 4);

            const mentionCited = citedEntries.find(c => c.contributor.equals(cited2));
            expect(mentionCited).toBeDefined();
            expect(mentionCited!.weight).toBeCloseTo(0.05 * (0.1 / 1.1), 4);
        });
    });

    describe('自定义角色权重', () => {
        it('应使用自定义权重覆盖默认权重', async () => {
            const customBuilder = new LedgerBuilder(
                { [ContributionRole.Author]: 0.70, [ContributionRole.Reviewer]: 0.10 },
                'error',
            );

            const crystalId = PublicKey.unique();
            const author = PublicKey.unique();
            const reviewer = PublicKey.unique();

            const event: ProtocolEvent = {
                type: ProtocolEventType.ContentStatusChanged,
                timestamp: Date.now(),
                slot: 100,
                data: {
                    content_id: crystalId.toBase58(),
                    new_status: 'CRYSTAL',
                    authors: [{ user_id: author.toBase58(), edit_count: 1 }],
                    reviewers: [{ user_id: reviewer.toBase58() }],
                },
            };

            const result = await customBuilder.buildLedger(asContributionSourceEvent(event));
            expect(result).not.toBeNull();

            const authorEntry = result!.contributions.find(c => c.role === ContributionRole.Author);
            expect(authorEntry!.weight).toBeCloseTo(0.70, 4);

            const reviewerEntry = result!.contributions.find(c => c.role === ContributionRole.Reviewer);
            expect(reviewerEntry!.weight).toBeCloseTo(0.10, 4);
        });
    });
});

describe('Types', () => {
    describe('DEFAULT_ROLE_WEIGHTS', () => {
        it('权重总和应为 1.0', () => {
            const sum = Object.values(DEFAULT_ROLE_WEIGHTS).reduce((a, b) => a + b, 0);
            expect(sum).toBeCloseTo(1.0, 10);
        });

        it('Author 权重应为 0.50', () => {
            expect(DEFAULT_ROLE_WEIGHTS[ContributionRole.Author]).toBe(0.50);
        });

        it('Discussant 权重应为 0.25', () => {
            expect(DEFAULT_ROLE_WEIGHTS[ContributionRole.Discussant]).toBe(0.25);
        });

        it('Reviewer 权重应为 0.20', () => {
            expect(DEFAULT_ROLE_WEIGHTS[ContributionRole.Reviewer]).toBe(0.20);
        });

        it('Cited 权重应为 0.05', () => {
            expect(DEFAULT_ROLE_WEIGHTS[ContributionRole.Cited]).toBe(0.05);
        });
    });

    describe('REFERENCE_WEIGHTS', () => {
        it('Import 权重应为 1.0', () => {
            expect(REFERENCE_WEIGHTS[ReferenceType.Import]).toBe(1.0);
        });

        it('Citation 权重应为 0.5', () => {
            expect(REFERENCE_WEIGHTS[ReferenceType.Citation]).toBe(0.5);
        });

        it('Mention 权重应为 0.1', () => {
            expect(REFERENCE_WEIGHTS[ReferenceType.Mention]).toBe(0.1);
        });

        it('ForkOrigin 权重应为 0.0', () => {
            expect(REFERENCE_WEIGHTS[ReferenceType.ForkOrigin]).toBe(0.0);
        });
    });
});

describe('Config', () => {
    it('应加载默认配置', () => {
        process.env.CONTRIBUTION_ENGINE_PROGRAM_ID = '2Nu27qEettMe6v1uqb1Gz2LB38pfEM8u4ioVKA8xkWd8';
        process.env.IDENTITY_REGISTRY_PROGRAM_ID = 'DLsVvqx1Rbc6M5Fw7xfJKPT2qxFxqCzuCjkB93cYALyH';
        process.env.REGISTRY_FACTORY_PROGRAM_ID = 'AYrzTqFdxpiH3VhCBzLsJQtzFqjoSRKYUvk29d797AQC';
        process.env.EVENT_EMITTER_PROGRAM_ID = 'C5sXkSqdvD7wnMYAPZdJJcMgqLH3HwUBkCjfabMBz1vy';

        // 使用 require 而非 import 以避免 dotenv 副作用
        const { loadConfig } = require('../src/config');
        const config = loadConfig();

        expect(config.rpcUrl).toBe('http://127.0.0.1:8899');
        expect(config.wsUrl).toBe('ws://127.0.0.1:8900');
        expect(config.programId).toBe('2Nu27qEettMe6v1uqb1Gz2LB38pfEM8u4ioVKA8xkWd8');
        expect(config.pollIntervalMs).toBe(5000);
        expect(config.logLevel).toBe('info');
    });
});
