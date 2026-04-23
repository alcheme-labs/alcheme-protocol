import { type Page, type Route } from '@playwright/test';

const NOW = new Date('2026-03-09T10:00:00.000Z').toISOString();

const ALL_CIRCLES = [
    {
        __typename: 'Circle',
        id: 101,
        name: '协议研究所',
        description: '围绕协议、知识结构与治理机制展开讨论。',
        avatarUri: null,
        circleType: 'Open',
        level: 0,
        knowledgeCount: 12,
        genesisMode: 'BLANK',
        kind: 'main',
        mode: 'knowledge',
        minCrystals: 0,
        parentCircleId: null,
        stats: { __typename: 'CircleStats', members: 48, posts: 21 },
        creator: {
            __typename: 'User',
            id: 1,
            handle: 'owner',
            pubkey: 'owner_pubkey',
            displayName: 'Owner',
        },
        createdAt: NOW,
    },
    {
        __typename: 'Circle',
        id: 102,
        name: '公共广场',
        description: '用于公开观点流转与社区对话。',
        avatarUri: null,
        circleType: 'Open',
        level: 0,
        knowledgeCount: 4,
        genesisMode: 'BLANK',
        kind: 'main',
        mode: 'social',
        minCrystals: 0,
        parentCircleId: null,
        stats: { __typename: 'CircleStats', members: 128, posts: 64 },
        creator: {
            __typename: 'User',
            id: 1,
            handle: 'owner',
            pubkey: 'owner_pubkey',
            displayName: 'Owner',
        },
        createdAt: NOW,
    },
];

const NOTIFICATIONS = [
    {
        __typename: 'Notification',
        id: 301,
        type: 'draft',
        title: '草稿待完善',
        body: '协议研究所里有一篇草稿等待继续打磨',
        sourceType: 'discussion_trigger',
        sourceId: '101',
        circleId: 101,
        read: false,
        createdAt: NOW,
    },
    {
        __typename: 'Notification',
        id: 302,
        type: 'highlight',
        title: '有新的高亮',
        body: '公共广场出现了一条值得继续跟进的讨论',
        sourceType: 'discussion_message',
        sourceId: 'msg_302',
        circleId: 102,
        read: true,
        createdAt: NOW,
    },
];

const HOME_KNOWLEDGE = {
    __typename: 'Knowledge',
    id: 601,
    knowledgeId: 'knowledge_1',
    onChainAddress: 'knowledge_onchain_1',
    title: '知识晶体需要独立热度模型',
    description: '把讨论热度与知识热度分离，能避免短期噪声污染结晶质量。',
    ipfsCid: null,
    contentHash: 'hash_knowledge_1',
    version: 1,
    contributorsRoot: 'contributors_root_1',
    contributorsCount: 1,
    contributors: [
        {
            __typename: 'KnowledgeContributor',
            handle: 'alice',
            pubkey: 'alice_pubkey',
            role: 'Author',
            weight: 1,
            authorType: 'HUMAN',
            authorityScore: 1,
            reputationDelta: 0,
            settledAt: NOW,
            sourceType: 'SNAPSHOT',
            sourceDraftPostId: 901,
            sourceAnchorId: 'anchor_knowledge_1',
            sourcePayloadHash: null,
            sourceSummaryHash: 'summary_hash_1',
            sourceMessagesDigest: 'messages_digest_1',
        },
    ],
    author: {
        __typename: 'User',
        id: 701,
        handle: 'alice',
        pubkey: 'alice_pubkey',
        displayName: 'Alice',
        avatarUri: null,
    },
    circle: {
        __typename: 'Circle',
        id: 101,
        name: '协议研究所',
    },
    sourceCircle: {
        __typename: 'Circle',
        id: 101,
        name: '协议研究所',
    },
    stats: {
        __typename: 'KnowledgeStats',
        qualityScore: 92,
        citationCount: 3,
        viewCount: 128,
        heatScore: 34,
    },
    references: [],
    citedBy: [],
    versionTimeline: [],
    crystalParams: {
        __typename: 'CrystalParams',
        seed: '0xa1b2c3d4',
        hue: 42,
        facets: 8,
    },
    createdAt: NOW,
    updatedAt: NOW,
};

function json(body: unknown, status = 200) {
    return {
        status,
        contentType: 'application/json',
        body: JSON.stringify(body),
    };
}

function readOperation(route: Route): {
    operationName: string;
    queryText: string;
    variables: Record<string, unknown>;
} {
    const payload = route.request().postDataJSON() as
        | {
              operationName?: string;
              query?: string;
              variables?: Record<string, unknown>;
          }
        | null;

    return {
        operationName: payload?.operationName || '',
        queryText: payload?.query || '',
        variables: payload?.variables || {},
    };
}

export async function installSmokeAppMocks(page: Page) {
    await page.route('**/graphql', async (route: Route) => {
        const { operationName, queryText, variables } = readOperation(route);

        if (operationName === 'GetPublicFlow' || queryText.includes('query GetPublicFlow')) {
            await route.fulfill(
                json({
                    data: {
                        publicFlow: [
                            {
                                __typename: 'PublicFlowItem',
                                id: 'pf_discussion_1',
                                kind: 'Discussion',
                                sourceId: 'post_1',
                                title: '链上身份如何做最小可信同步',
                                excerpt: '把钱包连接、身份注册和圈层准入拆成三层，可以减少耦合。',
                                circleId: 101,
                                circleName: '协议研究所',
                                circleLevel: 0,
                                authorHandle: 'taiyi',
                                authorPubkey: 'taiyi_pubkey',
                                score: 0.91,
                                featuredReason: '高质量讨论',
                                createdAt: NOW,
                            },
                            {
                                __typename: 'PublicFlowItem',
                                id: 'pf_crystal_1',
                                kind: 'Crystal',
                                sourceId: 'knowledge_1',
                                title: '知识晶体需要独立热度模型',
                                excerpt: '把讨论热度与知识热度分离，能避免短期噪声污染结晶质量。',
                                circleId: 101,
                                circleName: '协议研究所',
                                circleLevel: 0,
                                authorHandle: 'alice',
                                authorPubkey: 'alice_pubkey',
                                score: 0.88,
                                featuredReason: '最新结晶',
                                createdAt: NOW,
                            },
                        ],
                    },
                }),
            );
            return;
        }

        if (operationName === 'GetFollowingFlow' || queryText.includes('query GetFollowingFlow')) {
            await route.fulfill(
                json({
                    data: {
                        followingFlow: [
                            {
                                __typename: 'Post',
                                id: 201,
                                contentId: 'follow_post_1',
                                text: '关注流会优先展示你持续跟踪的话题。',
                                contentType: 'Post',
                                tags: [],
                                status: 'Published',
                                visibility: 'Public',
                                relevanceScore: null,
                                liked: false,
                                repostOfAddress: null,
                                repostOf: null,
                                stats: {
                                    __typename: 'PostStats',
                                    likes: 2,
                                    reposts: 0,
                                    replies: 1,
                                    views: 14,
                                    heatScore: 12,
                                },
                                author: {
                                    __typename: 'User',
                                    id: 9,
                                    handle: 'followed_author',
                                    pubkey: 'followed_author_pubkey',
                                    displayName: 'Followed Author',
                                    avatarUri: null,
                                    reputationScore: 55,
                                },
                                circle: {
                                    __typename: 'Circle',
                                    id: 102,
                                    name: '公共广场',
                                },
                                createdAt: NOW,
                                updatedAt: NOW,
                            },
                        ],
                    },
                }),
            );
            return;
        }

        if (operationName === 'GetAllCircles' || queryText.includes('query GetAllCircles')) {
            await route.fulfill(
                json({
                    data: {
                        allCircles: ALL_CIRCLES,
                    },
                }),
            );
            return;
        }

        if (operationName === 'GetMyCircles' || queryText.includes('query GetMyCircles')) {
            await route.fulfill(
                json({
                    data: {
                        myCircles: ALL_CIRCLES,
                    },
                }),
            );
            return;
        }

        if (operationName === 'GetNotifications' || queryText.includes('query GetNotifications')) {
            await route.fulfill(
                json({
                    data: {
                        myNotifications: NOTIFICATIONS,
                    },
                }),
            );
            return;
        }

        if (operationName === 'MarkNotificationsRead' || queryText.includes('mutation MarkNotificationsRead')) {
            await route.fulfill(
                json({
                    data: {
                        markNotificationsRead: true,
                    },
                }),
            );
            return;
        }

        if (operationName === 'GetMe' || queryText.includes('query GetMe')) {
            await route.fulfill(
                json({
                    data: {
                        me: {
                            __typename: 'User',
                            id: 501,
                            handle: 'alchemist',
                            pubkey: 'alchemist_pubkey',
                            displayName: 'The Alchemist',
                            bio: '把噪声炼成结构化知识。',
                            avatarUri: null,
                            reputationScore: 87.4,
                            stats: {
                                __typename: 'UserStats',
                                followers: 12,
                                following: 7,
                                posts: 18,
                                circles: 3,
                            },
                            totem: {
                                __typename: 'Totem',
                                stage: 'radiant',
                                crystalCount: 5,
                                citationCount: 8,
                                circleCount: 3,
                                dustFactor: 0.18,
                                lastActiveAt: NOW,
                            },
                            createdAt: NOW,
                        },
                    },
                }),
            );
            return;
        }

        if (operationName === 'GetMyKnowledge' || queryText.includes('query GetMyKnowledge')) {
            await route.fulfill(
                json({
                    data: {
                        myKnowledge: [],
                    },
                }),
            );
            return;
        }

        if (operationName === 'GetKnowledge' || queryText.includes('query GetKnowledge')) {
            const knowledgeId = String(variables.knowledgeId || '');
            await route.fulfill(
                json({
                    data: {
                        knowledge: knowledgeId === HOME_KNOWLEDGE.knowledgeId ? HOME_KNOWLEDGE : null,
                    },
                }),
            );
            return;
        }

        if (
            operationName === 'GetKnowledgeByOnChainAddress'
            || queryText.includes('query GetKnowledgeByOnChainAddress')
        ) {
            const onChainAddress = String(variables.onChainAddress || '');
            await route.fulfill(
                json({
                    data: {
                        knowledgeByOnChainAddress:
                            onChainAddress === HOME_KNOWLEDGE.onChainAddress ? HOME_KNOWLEDGE : null,
                    },
                }),
            );
            return;
        }

        if (operationName === 'UpdateUser' || queryText.includes('mutation UpdateUser')) {
            await route.fulfill(
                json({
                    data: {
                        updateUser: {
                            __typename: 'User',
                            id: 501,
                        },
                    },
                }),
            );
            return;
        }

        if (operationName === 'SearchCircles' || queryText.includes('query SearchCircles')) {
            await route.fulfill(
                json({
                    data: {
                        searchCircles: ALL_CIRCLES,
                    },
                }),
            );
            return;
        }

        if (operationName === 'SearchPosts' || queryText.includes('query SearchPosts')) {
            await route.fulfill(
                json({
                    data: {
                        searchPosts: [],
                    },
                }),
            );
            return;
        }

        await route.fulfill(json({ data: {} }));
    });

    await page.route('**/api/v1/extensions/capabilities', async (route: Route) => {
        await route.fulfill(
            json({
                generatedAt: NOW,
                manifestSource: 'configured',
                manifestReason: null,
                consistency: {
                    indexerId: 'smoke-test-indexer',
                    readCommitment: 'processed',
                    indexedSlot: 123,
                    stale: false,
                },
                skippedManifests: [],
                capabilities: [
                    {
                        extensionId: 'contribution-engine',
                        displayName: '贡献引擎',
                        programId: 'ContributionEngine111111111111111111111111',
                        version: '0.1.0',
                        parserVersion: '0.1.0',
                        status: 'active',
                        reason: null,
                        sdkPackage: '@alcheme/contribution-engine',
                        requiredPermissions: ['contribution:write'],
                        tags: ['contribution'],
                        runtime: {
                            registered: true,
                            enabled: true,
                            permissions: ['contribution:write'],
                            source: 'chain',
                            registrationStatus: 'registered_enabled',
                            reason: null,
                        },
                        indexedSlot: 123,
                        stale: false,
                    },
                ],
            }),
        );
    });
}
