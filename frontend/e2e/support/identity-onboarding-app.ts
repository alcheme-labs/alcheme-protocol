import { type Page, type Route } from '@playwright/test';

const NOW = new Date('2026-03-09T10:00:00.000Z').toISOString();

type SessionLoginMode = 'auto' | 'server_error';
const DEFAULT_WALLET_PUBKEY = '11111111111111111111111111111111';

interface IdentityOnboardingMockOptions {
    initialRegistered?: boolean;
    initialRegisteredPubkeys?: string[];
    initialJoinedCircleIds?: number[];
    initialJoinedCircleIdsByWallet?: Record<string, number[]>;
    identityRecentTransition?: {
        from: 'Visitor' | 'Initiate' | 'Member' | 'Elder';
        to: 'Visitor' | 'Initiate' | 'Member' | 'Elder';
        reason: string;
        changedAt: string;
    } | null;
    membershipJoinMode?: 'direct' | 'claim_open' | 'claim_invite' | 'claim_approval';
    sessionLoginMode?: SessionLoginMode;
    forceSessionMeUnauthenticated?: boolean;
    sessionMeDelayMs?: number;
    sessionLoginDelayMs?: number;
    ghostSettingsDelayMs?: number;
    e2eRegisterIdentityError?: string;
}

function json(body: unknown, status = 200) {
    return {
        status,
        contentType: 'application/json',
        body: JSON.stringify(body),
    };
}

function sleep(ms: number) {
    return new Promise((resolve) => setTimeout(resolve, ms));
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

export async function installIdentityOnboardingMocks(
    page: Page,
    options?: IdentityOnboardingMockOptions,
) {
    const initialRegisteredPubkeys = new Set<string>(
        options?.initialRegisteredPubkeys
            ?? (options?.initialRegistered ? [DEFAULT_WALLET_PUBKEY] : []),
    );
    const registeredWallets = new Set<string>(initialRegisteredPubkeys);
    const handlesByWallet = new Map<string, string>();
    registeredWallets.forEach((pubkey) => {
        handlesByWallet.set(pubkey, 'alchemist');
    });
    const joinedCircleIdsByWallet = new Map<string, Set<number>>();
    if ((options?.initialJoinedCircleIds?.length || 0) > 0) {
        joinedCircleIdsByWallet.set(DEFAULT_WALLET_PUBKEY, new Set(options?.initialJoinedCircleIds));
    }
    Object.entries(options?.initialJoinedCircleIdsByWallet || {}).forEach(([pubkey, circleIds]) => {
        joinedCircleIdsByWallet.set(pubkey, new Set(circleIds));
    });
    let activeSessionPubkey: string | null = null;
    let ghostSettingsState = {
        summaryUseLLM: false,
        draftTriggerMode: 'notify_only',
        triggerSummaryUseLLM: false,
        triggerGenerateComment: true,
    };
    let syncStatusSlot = 880_000;
    let profileState = {
        displayName: 'The Alchemist',
        bio: '把噪声炼成结构化知识。',
    };

    function isAuthenticated() {
        return Boolean(activeSessionPubkey);
    }

    function resolveHandle(pubkey: string | null): string {
        if (!pubkey) return 'alchemist';
        return handlesByWallet.get(pubkey) || 'alchemist';
    }

    function activeJoinedCircleIds() {
        if (!activeSessionPubkey) return new Set<number>();
        const existing = joinedCircleIdsByWallet.get(activeSessionPubkey);
        if (existing) return existing;
        const next = new Set<number>();
        joinedCircleIdsByWallet.set(activeSessionPubkey, next);
        return next;
    }

    function resolveClaimMembershipKind(circleId: number): 'Open' | 'Invite' | 'Approval' | null {
        if (circleId !== 246) return null;
        switch (options?.membershipJoinMode) {
            case 'claim_open':
                return 'Open';
            case 'claim_invite':
                return 'Invite';
            case 'claim_approval':
                return 'Approval';
            default:
                return null;
        }
    }

    function membershipSnapshot(circleId: number) {
        const joinedCircleIds = activeJoinedCircleIds();
        return {
            authenticated: isAuthenticated(),
            circleId,
            policy: {
                joinRequirement: 'Free',
                circleType: 'Open',
                minCrystals: 0,
                requiresApproval: false,
                requiresInvite: false,
            },
            joinState: joinedCircleIds.has(circleId)
                ? 'joined'
                : isAuthenticated()
                    ? 'can_join'
                    : 'guest',
            membership: joinedCircleIds.has(circleId)
                ? {
                    role: 'Member',
                    status: 'Active',
                    identityLevel: 'Initiate',
                    joinedAt: NOW,
                }
                : null,
            userCrystals: 0,
            missingCrystals: 0,
        };
    }

    function identityStatus(circleId: number) {
        const joinedCircleIds = activeJoinedCircleIds();
        const joined = joinedCircleIds.has(circleId);
        const recentTransition = joined ? (options?.identityRecentTransition ?? null) : null;
        return {
            authenticated: isAuthenticated(),
            circleId,
            currentLevel: joined ? 'Initiate' : 'Visitor',
            nextLevel: joined ? 'Member' : 'Initiate',
            messagingMode: joined ? 'formal' : 'dust_only',
            hint: joined
                ? '已获得 0 次引用，达到 2 次可晋升为成员。'
                : '未加入圈层前，你的发言仍是烟尘消息。',
            thresholds: {
                initiateMessages: 5,
                memberCitations: 2,
                elderPercentile: 10,
                inactivityDays: 30,
            },
            progress: {
                messageCount: 0,
                citationCount: 0,
                reputationScore: 0,
                reputationPercentile: null,
                daysSinceActive: null,
            },
            recentTransition,
            history: recentTransition ? [recentTransition] : [],
        };
    }

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
                                circleId: 246,
                                circleName: '测试圈层',
                                circleLevel: 0,
                                authorHandle: 'taiyi',
                                authorPubkey: 'taiyi_pubkey',
                                score: 0.91,
                                featuredReason: '高质量讨论',
                                createdAt: NOW,
                            },
                        ],
                    },
                }),
            );
            return;
        }

        if (operationName === 'GetFollowingFlow' || queryText.includes('query GetFollowingFlow')) {
            await route.fulfill(json({ data: { followingFlow: [] } }));
            return;
        }

        if (operationName === 'GetAllCircles' || queryText.includes('query GetAllCircles')) {
            await route.fulfill(
                json({
                    data: {
                        allCircles: [
                            {
                                __typename: 'Circle',
                                id: 246,
                                name: '测试圈层',
                                description: '用于身份 onboarding e2e。',
                                avatarUri: null,
                                circleType: 'Open',
                                level: 0,
                                knowledgeCount: 0,
                                genesisMode: 'BLANK',
                                kind: 'main',
                                mode: 'social',
                                minCrystals: 0,
                                parentCircleId: null,
                                stats: { __typename: 'CircleStats', members: 8, posts: 4 },
                                creator: {
                                    __typename: 'User',
                                    id: 1,
                                    handle: 'owner',
                                    pubkey: 'owner_pubkey',
                                    displayName: 'Owner',
                                },
                                createdAt: NOW,
                            },
                        ],
                    },
                }),
            );
            return;
        }

        if (operationName === 'GetMe' || queryText.includes('query GetMe')) {
            await route.fulfill(
                json({
                    data: {
                        me: activeSessionPubkey && registeredWallets.has(activeSessionPubkey)
                            ? {
                                __typename: 'User',
                                id: 501,
                                handle: resolveHandle(activeSessionPubkey),
                                pubkey: activeSessionPubkey,
                                displayName: profileState.displayName,
                                bio: profileState.bio,
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
                            }
                            : null,
                    },
                }),
            );
            return;
        }

        if (operationName === 'GetMyKnowledge' || queryText.includes('query GetMyKnowledge')) {
            await route.fulfill(json({ data: { myKnowledge: [] } }));
            return;
        }

        if (operationName === 'UpdateUser' || queryText.includes('mutation UpdateUser')) {
            const input = payloadInput(variables);
            if (typeof input.displayName === 'string' && input.displayName.trim()) {
                profileState.displayName = input.displayName.trim();
            }
            if (typeof input.bio === 'string') {
                profileState.bio = input.bio.trim();
            }
            await route.fulfill(json({
                data: {
                    updateUser: {
                        __typename: 'User',
                        id: 501,
                        displayName: profileState.displayName,
                        bio: profileState.bio,
                    },
                },
            }));
            return;
        }

        if (operationName === 'GetCircle' || queryText.includes('query GetCircle(')) {
            const circleId = Number(variables.id ?? 246);
            await route.fulfill(
                json({
                    data: {
                        circle: {
                            __typename: 'Circle',
                            id: circleId,
                            name: '测试圈层',
                            description: '用于身份 onboarding e2e。',
                            avatarUri: null,
                            circleType: 'Open',
                            level: 0,
                            knowledgeCount: 0,
                            genesisMode: 'BLANK',
                            kind: 'main',
                            mode: 'social',
                            minCrystals: 0,
                            parentCircleId: null,
                            stats: { __typename: 'CircleStats', members: 8, posts: 4 },
                            creator: {
                                __typename: 'User',
                                id: 1,
                                handle: 'owner',
                                pubkey: 'owner_pubkey',
                                displayName: 'Owner',
                            },
                            createdAt: NOW,
                            members: [],
                            posts: [],
                        },
                        circleDescendants: [],
                    },
                }),
            );
            return;
        }

        if (operationName === 'GetCirclePosts' || queryText.includes('query GetCirclePosts')) {
            await route.fulfill(
                json({
                    data: {
                        circle: {
                            __typename: 'Circle',
                            id: 246,
                            posts: [],
                        },
                    },
                }),
            );
            return;
        }

        if (operationName === 'GetCircleDrafts' || queryText.includes('query GetCircleDrafts')) {
            await route.fulfill(json({ data: { circleDrafts: [] } }));
            return;
        }

        if (operationName === 'GetKnowledgeByCircle' || queryText.includes('query GetKnowledgeByCircle')) {
            await route.fulfill(json({ data: { knowledgeByCircle: [] } }));
            return;
        }

        if (operationName === 'GetNotifications' || queryText.includes('query GetNotifications')) {
            await route.fulfill(json({ data: { myNotifications: [] } }));
            return;
        }

        if (operationName === 'MarkNotificationsRead' || queryText.includes('mutation MarkNotificationsRead')) {
            await route.fulfill(json({ data: { markNotificationsRead: true } }));
            return;
        }

        await route.fulfill(json({ data: {} }));
    });

    await page.route('**/api/v1/auth/session/me', async (route: Route) => {
        if (options?.sessionMeDelayMs) {
            await sleep(options.sessionMeDelayMs);
        }
        await route.fulfill(
            json(
                activeSessionPubkey && !options?.forceSessionMeUnauthenticated
                    ? {
                        authenticated: true,
                        user: {
                            id: 501,
                            pubkey: activeSessionPubkey,
                            handle: resolveHandle(activeSessionPubkey),
                            displayName: 'The Alchemist',
                            avatarUri: null,
                            createdAt: NOW,
                        },
                    }
                    : { authenticated: false },
            ),
        );
    });

    await page.route('**/api/v1/auth/session/nonce**', async (route: Route) => {
        const publicKey = new URL(route.request().url()).searchParams.get('publicKey') || DEFAULT_WALLET_PUBKEY;
        await route.fulfill(
            json({
                ok: true,
                publicKey,
                nonce: 'nonce_1',
                message: `alcheme-auth-session:{"v":1,"action":"session_login","publicKey":"${publicKey}","nonce":"nonce_1","clientTimestamp":"2026-03-09T10:00:00.000Z"}`,
                expiresInSec: 300,
            }),
        );
    });

    await page.route('**/api/v1/auth/session/login', async (route: Route) => {
        const body = route.request().postDataJSON() as { publicKey?: string } | null;
        const publicKey = String(body?.publicKey || DEFAULT_WALLET_PUBKEY);
        if (options?.sessionLoginDelayMs) {
            await sleep(options.sessionLoginDelayMs);
        }
        if (options?.sessionLoginMode === 'server_error') {
            await route.fulfill(
                json({
                    error: 'session unavailable',
                }, 500),
            );
            return;
        }

        if (!registeredWallets.has(publicKey)) {
            await route.fulfill(
                json({
                    code: 'identity_not_registered',
                    error: 'User not registered. Please register on-chain first.',
                }, 401),
            );
            return;
        }

        activeSessionPubkey = publicKey;

        await route.fulfill(
            json({
                ok: true,
                authenticated: true,
                user: {
                    id: 501,
                    pubkey: publicKey,
                    handle: resolveHandle(publicKey),
                    displayName: 'The Alchemist',
                    avatarUri: null,
                    createdAt: NOW,
                },
                expiresAt: NOW,
            }),
        );
    });

    await page.route('**/api/v1/membership/circles/*/me', async (route: Route) => {
        const circleId = Number(new URL(route.request().url()).pathname.split('/')[5] || '246');
        await route.fulfill(json(membershipSnapshot(circleId)));
    });

    await page.route('**/api/v1/membership/circles/*/identity-status', async (route: Route) => {
        const circleId = Number(new URL(route.request().url()).pathname.split('/')[5] || '246');
        await route.fulfill(json(identityStatus(circleId)));
    });

    await page.route('**/api/v1/membership/circles/*/join', async (route: Route) => {
        const circleId = Number(new URL(route.request().url()).pathname.split('/')[5] || '246');
        const claimKind = resolveClaimMembershipKind(circleId);
        if (claimKind) {
            await route.fulfill(
                json({
                    ok: true,
                    joinState: 'can_join',
                    finalization: {
                        action: 'claim_membership',
                        grant: {
                            role: 'Member',
                            kind: claimKind,
                            artifactId: claimKind === 'Invite' ? 9001 : claimKind === 'Approval' ? 9002 : 9000,
                            issuedAt: NOW,
                            expiresAt: new Date('2026-03-10T10:00:00.000Z').toISOString(),
                            issuerKeyId: DEFAULT_WALLET_PUBKEY,
                            issuedSignature: DEFAULT_WALLET_PUBKEY.repeat(2),
                        },
                    },
                }),
            );
            return;
        }
        activeJoinedCircleIds().add(circleId);
        await route.fulfill(
            json({
                ok: true,
                joinState: 'joined',
                alreadyMember: false,
            }),
        );
    });

    await page.route('**/api/v1/testing/e2e/finalize-membership', async (route: Route) => {
        const body = route.request().postDataJSON() as
            | {
                circleId?: number;
                action?: 'reactivate_existing' | 'claim_membership';
                kind?: 'Open' | 'Invite' | 'Approval';
            }
            | null;
        const circleId = Number(body?.circleId || 246);
        activeJoinedCircleIds().add(circleId);
        syncStatusSlot += 10;
        await route.fulfill(
            json({
                ok: true,
                signature: `e2e_membership_${body?.action || 'claim_membership'}_${body?.kind || 'direct'}_${circleId}`,
                signatureSlot: syncStatusSlot,
            }),
        );
    });

    await page.route('**/sync/status', async (route: Route) => {
        await route.fulfill(
            json({
                indexerId: 'identity-onboarding-e2e',
                readCommitment: 'confirmed',
                indexedSlot: syncStatusSlot,
                stale: false,
                generatedAt: NOW,
                offchain: null,
                offchainPeers: [],
            }),
        );
    });

    await page.route('**/api/v1/circles/*/ghost-settings', async (route: Route) => {
        const circleId = Number(new URL(route.request().url()).pathname.split('/')[4] || '246');
        if (route.request().method() === 'PUT') {
            const body = route.request().postDataJSON() as Record<string, unknown> | null;
            ghostSettingsState = {
                ...ghostSettingsState,
                summaryUseLLM: typeof body?.summaryUseLLM === 'boolean' ? body.summaryUseLLM : ghostSettingsState.summaryUseLLM,
                draftTriggerMode: body && Object.prototype.hasOwnProperty.call(body, 'draftTriggerMode')
                    ? (body.draftTriggerMode === 'auto_draft' ? 'auto_draft' : 'notify_only')
                    : ghostSettingsState.draftTriggerMode,
                triggerSummaryUseLLM: typeof body?.triggerSummaryUseLLM === 'boolean' ? body.triggerSummaryUseLLM : ghostSettingsState.triggerSummaryUseLLM,
                triggerGenerateComment: ghostSettingsState.triggerGenerateComment,
            };
            await route.fulfill(
                json({
                    circleId,
                    source: 'circle',
                    settings: ghostSettingsState,
                }),
            );
            return;
        }
        if (options?.ghostSettingsDelayMs) {
            await sleep(options.ghostSettingsDelayMs);
        }
        await route.fulfill(
            json({
                circleId,
                source: 'global_default',
                settings: ghostSettingsState,
            }),
        );
    });

    await page.route('**/api/v1/discussion/circles/*/messages**', async (route: Route) => {
        const circleId = Number(new URL(route.request().url()).pathname.split('/')[5] || '246');
        await route.fulfill(
            json({
                circleId,
                roomKey: `circle:${circleId}`,
                count: 0,
                watermark: null,
                messages: [],
            }),
        );
    });

    await page.route('**/api/v1/discussion/sessions', async (route: Route) => {
        await route.fulfill(
            json({
                ok: true,
                sessionId: 'discussion_session_1',
                scope: 'circle:246',
                token: 'discussion_session_token',
                senderPubkey: activeSessionPubkey || DEFAULT_WALLET_PUBKEY,
                expiresAt: NOW,
                discussionAccessToken: 'discussion_session_token',
            }),
        );
    });

    await page.route('**/api/v1/discussion/sessions/*/refresh', async (route: Route) => {
        await route.fulfill(
            json({
                ok: true,
                sessionId: 'discussion_session_1',
                scope: 'circle:246',
                senderPubkey: activeSessionPubkey || DEFAULT_WALLET_PUBKEY,
                expiresAt: NOW,
                discussionAccessToken: 'discussion_session_token',
                refreshed: true,
            }),
        );
    });

    await page.route('**/api/v1/auth/session/logout', async (route: Route) => {
        activeSessionPubkey = null;
        await route.fulfill(json({ ok: true }));
    });

    await page.route('**/api/v1/testing/e2e/register-identity', async (route: Route) => {
        if (options?.e2eRegisterIdentityError) {
            await route.fulfill(
                json({
                    error: options.e2eRegisterIdentityError,
                }, 500),
            );
            return;
        }
        const body = route.request().postDataJSON() as { handle?: string; publicKey?: string } | null;
        const publicKey = String(body?.publicKey || DEFAULT_WALLET_PUBKEY);
        registeredWallets.add(publicKey);
        handlesByWallet.set(publicKey, body?.handle || 'alchemist');
        await route.fulfill(
            json({
                ok: true,
                signature: 'e2e_identity_signature',
            }),
        );
    });

    await page.route('**/api/v1/extensions/capabilities', async (route: Route) => {
        await route.fulfill(
            json({
                generatedAt: NOW,
                manifestSource: 'configured',
                manifestReason: null,
                consistency: {
                    indexerId: 'identity-onboarding-e2e',
                    readCommitment: 'processed',
                    indexedSlot: 123,
                    stale: false,
                },
                skippedManifests: [],
                capabilities: [],
            }),
        );
    });
}

function payloadInput(variables: Record<string, unknown>) {
    const raw = variables.input;
    if (raw && typeof raw === 'object') {
        return raw as Record<string, unknown>;
    }
    return {};
}
