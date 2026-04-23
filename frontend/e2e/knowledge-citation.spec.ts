import { test, expect, type Page, type Route } from '@playwright/test';

async function installKnowledgeGraphqlMocks(page: Page) {
    await page.route('**/graphql', async (route: Route) => {
        const payload = route.request().postDataJSON() as {
            operationName?: string;
            query?: string;
            variables?: Record<string, unknown>;
        } | null;
        const operationName = payload?.operationName || '';
        const queryText = payload?.query || '';

        if (operationName === 'GetKnowledge' || queryText.includes('query GetKnowledge(')) {
            await route.fulfill({
                status: 200,
                contentType: 'application/json',
                body: JSON.stringify({
                    data: {
                        knowledge: {
                            id: 31,
                            knowledgeId: 'kn_demo_31',
                            onChainAddress: 'KNDemoOnChain11111111111111111111111111111',
                            title: '链上知识如何保持可审计演化',
                            description: '这是一枚已经完成结晶的知识主题。',
                            ipfsCid: 'bafybeigdemo',
                            contentHash: 'content-hash-demo',
                            version: 3,
                            contributorsRoot: 'root-demo',
                            contributorsCount: 2,
                            contributors: [],
                            author: {
                                id: 1,
                                handle: 'taiyi',
                                pubkey: 'taiyi_pubkey',
                                displayName: 'Taiyi',
                                avatarUri: null,
                            },
                            circle: {
                                id: 7,
                                name: 'Protocol Lab',
                            },
                            sourceCircle: {
                                id: 7,
                                name: 'Protocol Lab',
                            },
                            stats: {
                                qualityScore: 86,
                                citationCount: 4,
                                viewCount: 18,
                                heatScore: 27,
                            },
                            references: [],
                            citedBy: [],
                            versionTimeline: [
                                {
                                    id: 'kv_3',
                                    eventType: 'published',
                                    version: 3,
                                    actorPubkey: 'taiyi_pubkey',
                                    actorHandle: 'taiyi',
                                    contributorsCount: 2,
                                    contributorsRoot: 'root-demo',
                                    sourceEventTimestamp: new Date('2026-02-24T10:00:00.000Z').toISOString(),
                                    eventAt: new Date('2026-02-24T10:00:00.000Z').toISOString(),
                                    createdAt: new Date('2026-02-24T10:00:00.000Z').toISOString(),
                                },
                            ],
                            crystalParams: {
                                seed: 31,
                                hue: 42,
                                facets: 5,
                            },
                            createdAt: new Date('2026-02-24T10:00:00.000Z').toISOString(),
                            updatedAt: new Date('2026-02-24T10:00:00.000Z').toISOString(),
                        },
                    },
                }),
            });
            return;
        }

        if (operationName === 'GetKnowledgeByOnChainAddress' || queryText.includes('query GetKnowledgeByOnChainAddress(')) {
            await route.fulfill({
                status: 200,
                contentType: 'application/json',
                body: JSON.stringify({
                    data: {
                        knowledgeByOnChainAddress: null,
                    },
                }),
            });
            return;
        }

        if (operationName === 'GetMyKnowledge' || queryText.includes('query GetMyKnowledge(')) {
            await route.fulfill({
                status: 200,
                contentType: 'application/json',
                body: JSON.stringify({
                    data: {
                        myKnowledge: [
                            {
                                id: 31,
                                knowledgeId: 'kn_demo_31',
                                onChainAddress: 'KNDemoOnChain11111111111111111111111111111',
                                title: '链上知识如何保持可审计演化',
                                description: '当前目标晶体，不应出现在 source 选择里。',
                                version: 3,
                                contributorsCount: 2,
                                circle: {
                                    id: 7,
                                    name: 'Protocol Lab',
                                },
                                stats: {
                                    qualityScore: 86,
                                    citationCount: 4,
                                    viewCount: 18,
                                    heatScore: 27,
                                },
                                references: [],
                                citedBy: [],
                                versionTimeline: [
                                    {
                                        id: 'kv_self_3',
                                        eventType: 'published',
                                        version: 3,
                                        actorPubkey: 'taiyi_pubkey',
                                        actorHandle: 'taiyi',
                                        contributorsCount: 2,
                                        contributorsRoot: 'root-demo',
                                        sourceEventTimestamp: new Date('2026-02-24T10:00:00.000Z').toISOString(),
                                        eventAt: new Date('2026-02-24T10:00:00.000Z').toISOString(),
                                        createdAt: new Date('2026-02-24T10:00:00.000Z').toISOString(),
                                    },
                                ],
                                crystalParams: null,
                                createdAt: new Date('2026-02-24T10:00:00.000Z').toISOString(),
                                updatedAt: new Date('2026-02-24T10:00:00.000Z').toISOString(),
                            },
                            {
                                id: 99,
                                knowledgeId: 'kn_source_99',
                                onChainAddress: 'KNSourceOnChain999999999999999999999999999',
                                title: '可作为引用源的另一枚晶体',
                                description: '这是我的另一枚晶体。',
                                version: 1,
                                contributorsCount: 1,
                                circle: {
                                    id: 7,
                                    name: 'Protocol Lab',
                                },
                                stats: {
                                    qualityScore: 71,
                                    citationCount: 2,
                                    viewCount: 7,
                                    heatScore: 9,
                                },
                                references: [],
                                citedBy: [],
                                versionTimeline: [
                                    {
                                        id: 'kv_source_1',
                                        eventType: 'published',
                                        version: 1,
                                        actorPubkey: 'taiyi_pubkey',
                                        actorHandle: 'taiyi',
                                        contributorsCount: 1,
                                        contributorsRoot: 'root-source',
                                        sourceEventTimestamp: new Date('2026-02-26T10:00:00.000Z').toISOString(),
                                        eventAt: new Date('2026-02-26T10:00:00.000Z').toISOString(),
                                        createdAt: new Date('2026-02-26T10:00:00.000Z').toISOString(),
                                    },
                                ],
                                crystalParams: null,
                                createdAt: new Date('2026-02-26T10:00:00.000Z').toISOString(),
                                updatedAt: new Date('2026-02-26T10:00:00.000Z').toISOString(),
                            },
                        ],
                    },
                }),
            });
            return;
        }

        await route.continue();
    });
}

test.describe('Knowledge Citation', () => {
    test('knowledge detail can open citation picker and excludes the current crystal from source choices', async ({ page }) => {
        await installKnowledgeGraphqlMocks(page);

        await page.goto('/knowledge/kn_demo_31?action=cite');

        await expect(page.getByRole('heading', { name: '引用这枚晶体' })).toBeVisible();
        await expect(page.getByText('选择你自己的另一枚晶体，建立明确的引用关系。')).toBeVisible();
        await expect(page.getByRole('button', { name: '可作为引用源的另一枚晶体' })).toBeVisible();
        await expect(page.getByRole('button', { name: '链上知识如何保持可审计演化' })).toHaveCount(0);
    });
});
