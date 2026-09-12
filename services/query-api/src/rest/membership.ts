import crypto from 'crypto';
import { Router } from 'express';
import {
    CircleInviteStatus,
    CircleJoinRequestStatus,
    CircleMembershipEventType,
    CircleType,
    JoinRequirement,
    MemberRole,
    MemberStatus,
    type Prisma,
    type PrismaClient,
} from '@prisma/client';
import { Redis } from 'ioredis';
import {
    evaluateMembershipJoinDecision,
    resolveCircleJoinPolicy,
} from '../services/membership/engine';
import { promoteMemberDustMessagesAfterJoinProjection } from '../services/discussion/membershipDustPromotion';
import { publishDiscussionRealtimeEvent } from '../services/discussion/realtime';
import { issueMembershipAdmissionGrant } from '../services/membership/admission';
import {
    AuthActorError,
    requireAuthenticatedActor,
    requireCircleActorForAuthActor,
    resolveAuthenticatedActor,
} from '../services/auth/actor';
import {
    requireCircleManagerForActor,
    requireCircleOwnerForActor,
    sendAuthActorError,
} from '../services/auth/actorPermissions';
import {
    evaluateIdentity,
    getReputationPercentile,
    getUserCircleStats,
} from '../identity/machine';
import {
    IdentityLevel,
    getIdentityNotificationMode,
    getThresholds,
} from '../identity/thresholds';
import { buildIdentityHint, buildVisitorDustHint } from '../identity/copy';
import { resolveRequestLocale } from '../i18n/locale';
import {
    createCircleMemberRemovalGovernanceCase,
    normalizeManagedMemberRole,
    validateCircleMemberRemoval,
    validateCircleMemberRoleChange,
} from '../services/membership/governance';
import {
    GovernanceCaseIntakeError,
    projectGovernanceCase,
} from '../services/governance/governanceCase';
import { GovernanceCaseTemplateError } from '../services/governance/governanceCaseTemplate';
import { verifyEd25519SignatureBase64 } from '../services/offchainDiscussion';
import {
    buildCircleSettingsSigningMessage,
    buildCircleSettingsSigningPayload,
    buildStoredCircleSettingsEnvelopeSection,
    isCircleSettingsSignatureFresh,
    parseCircleSettingsSignedMessage,
    persistCircleSettingsEnvelopeSection,
    resolveProjectedCircleSettings,
} from '../services/policy/settingsEnvelope';
import {
    applyCircleMembershipPolicySetting,
    buildMembershipPolicyGovernancePayload,
    resolveMembershipPolicySetting,
    CircleSettingsWriteError,
} from '../services/policy/postCreateSettings';
import {
    CIRCLE_POLICY_MEMBERSHIP_UPDATE_ACTION_TYPE,
    evaluateCirclePolicyGovernance,
} from '../services/governance/circlePolicyGovernance';
import {
    createPrismaGovernanceEngineStore,
    recordExecutionReceipt,
} from '../services/governance/policyEngine';

function parseCircleId(raw: string): number | null {
    const parsed = Number(raw);
    if (!Number.isFinite(parsed) || parsed <= 0) return null;
    return parsed;
}

function parsePositiveEnvInt(value: string | undefined, fallback: number): number {
    if (value === undefined) return fallback;
    const parsed = Number.parseInt(value, 10);
    if (!Number.isFinite(parsed) || parsed <= 0) return fallback;
    return parsed;
}

async function publishPromotedDustMessageRefreshes(
    redis: Redis,
    input: Awaited<ReturnType<typeof promoteMemberDustMessagesAfterJoinProjection>> & { circleId: number },
): Promise<void> {
    for (const message of input.messages) {
        await publishDiscussionRealtimeEvent(redis, {
            circleId: input.circleId,
            envelopeId: message.envelopeId,
            latestLamport: message.lamport ?? input.latestLamport,
            reason: 'message_refresh_required',
        });
    }
}

function randomInviteCode(): string {
    return crypto.randomBytes(18).toString('base64url');
}

function toPolicyPayload(circle: {
    joinRequirement: JoinRequirement;
    circleType: CircleType;
    minCrystals: number;
}) {
    const policy = resolveCircleJoinPolicy(circle);
    return {
        joinRequirement: policy.joinRequirement,
        circleType: policy.circleType,
        minCrystals: policy.minCrystals,
        requiresApproval:
            policy.joinRequirement === JoinRequirement.ApprovalRequired || policy.circleType === CircleType.Closed,
        requiresInvite:
            policy.joinRequirement === JoinRequirement.InviteOnly || policy.circleType === CircleType.Secret,
    };
}

function buildCreatorMembershipPayload(circleCreatedAt: Date | null | undefined) {
    return {
        role: MemberRole.Owner,
        status: MemberStatus.Active,
        identityLevel: 'Member',
        joinedAt: circleCreatedAt || new Date(),
    };
}

function resolveNextIdentityLevel(level: IdentityLevel): IdentityLevel | null {
    if (level === IdentityLevel.Visitor) return IdentityLevel.Initiate;
    if (level === IdentityLevel.Initiate) return IdentityLevel.Member;
    if (level === IdentityLevel.Member) return IdentityLevel.Elder;
    return null;
}

function parseIdentityLevelValue(value: unknown): IdentityLevel | null {
    if (value === IdentityLevel.Visitor) return IdentityLevel.Visitor;
    if (value === IdentityLevel.Initiate) return IdentityLevel.Initiate;
    if (value === IdentityLevel.Member) return IdentityLevel.Member;
    if (value === IdentityLevel.Elder) return IdentityLevel.Elder;
    return null;
}

function parseIdentityTransitionMetadata(
    metadata: Prisma.JsonValue | null | undefined,
): { from: IdentityLevel; to: IdentityLevel } | null {
    if (!metadata || typeof metadata !== 'object' || Array.isArray(metadata)) return null;
    const record = metadata as Record<string, unknown>;
    const from = parseIdentityLevelValue(record.fromLevel);
    const to = parseIdentityLevelValue(record.toLevel);
    if (!from || !to) return null;
    return { from, to };
}

function mapIdentityTransitionEvent(
    event: {
        reason: string | null;
        metadata: Prisma.JsonValue | null;
        createdAt: Date;
    },
): {
    from: IdentityLevel;
    to: IdentityLevel;
    reason: string | null;
    changedAt: Date;
} | null {
    const transitionMeta = parseIdentityTransitionMetadata(event.metadata);
    if (!transitionMeta) return null;
    return {
        from: transitionMeta.from,
        to: transitionMeta.to,
        reason: event.reason ?? null,
        changedAt: event.createdAt,
    };
}

const RECENT_IDENTITY_TRANSITION_WINDOW_MS = 24 * 60 * 60 * 1000;

function resolveRecentIdentityTransition(
    history: Array<{
        from: IdentityLevel;
        to: IdentityLevel;
        reason: string | null;
        changedAt: Date;
    }>,
    now: Date = new Date(),
): {
    from: IdentityLevel;
    to: IdentityLevel;
    reason: string | null;
    changedAt: Date;
} | null {
    const latest = history[0];
    if (!latest) return null;

    const changedAtMs = latest.changedAt.getTime();
    if (!Number.isFinite(changedAtMs)) return null;
    if (now.getTime() - changedAtMs > RECENT_IDENTITY_TRANSITION_WINDOW_MS) {
        return null;
    }

    return {
        from: latest.from,
        to: latest.to,
        reason: latest.reason,
        changedAt: latest.changedAt,
    };
}

function mapAccessTypeToPolicy(accessType: string | null): {
    joinRequirement: JoinRequirement;
    circleType?: CircleType;
} | null {
    const normalized = String(accessType || '').trim().toLowerCase();
    if (!normalized) return null;
    if (normalized === 'free') {
        return { joinRequirement: JoinRequirement.Free, circleType: CircleType.Open };
    }
    if (normalized === 'crystal') {
        return { joinRequirement: JoinRequirement.TokenGated, circleType: CircleType.Open };
    }
    if (normalized === 'invite') {
        return { joinRequirement: JoinRequirement.InviteOnly, circleType: CircleType.Closed };
    }
    if (normalized === 'approval') {
        return { joinRequirement: JoinRequirement.ApprovalRequired, circleType: CircleType.Closed };
    }
    return null;
}

async function logMembershipEvent(
    prisma: PrismaClient | Prisma.TransactionClient,
    input: {
        circleId: number;
        userId: number;
        actorUserId?: number | null;
        eventType: CircleMembershipEventType;
        roleBefore?: MemberRole | null;
        roleAfter?: MemberRole | null;
        statusBefore?: MemberStatus | null;
        statusAfter?: MemberStatus | null;
        joinRequestId?: number | null;
        inviteId?: number | null;
        reason?: string | null;
        metadata?: Prisma.InputJsonValue | null;
    },
): Promise<void> {
    await prisma.circleMembershipEvent.create({
        data: {
            circleId: input.circleId,
            userId: input.userId,
            actorUserId: input.actorUserId ?? null,
            eventType: input.eventType,
            roleBefore: input.roleBefore ?? null,
            roleAfter: input.roleAfter ?? null,
            statusBefore: input.statusBefore ?? null,
            statusAfter: input.statusAfter ?? null,
            joinRequestId: input.joinRequestId ?? null,
            inviteId: input.inviteId ?? null,
            reason: input.reason ?? null,
            ...(input.metadata ? { metadata: input.metadata } : {}),
        },
    });
}

class CircleInviteRequestError extends Error {
    constructor(
        readonly statusCode: number,
        readonly code: string,
    ) {
        super(code);
    }
}

function buildWalletFinalizationShim(input: {
    circleId: number;
    userId: number;
    action: 'leave' | 'update_role' | 'remove_member';
    role?: MemberRole;
    currentRole?: MemberRole;
}) {
    return {
        ok: true,
        circleId: input.circleId,
        userId: input.userId,
        requiresWalletFinalization: true,
        finalization: {
            action: input.action,
            userId: input.userId,
            ...(input.role ? { role: input.role } : {}),
            ...(input.currentRole ? { currentRole: input.currentRole } : {}),
        },
    };
}

export function membershipRouter(prisma: PrismaClient, redis: Redis): Router {
    const router = Router();

    async function resolveOptionalMembershipActor(req: any) {
        return resolveAuthenticatedActor(req, prisma, { requireSessionCookie: true });
    }

    async function requireMembershipActor(req: any) {
        return requireAuthenticatedActor(req, prisma, { requireSessionCookie: true });
    }

    async function requireMembershipManager(
        req: any,
        circleId: number,
        options: { allowModerator?: boolean } = {},
    ) {
        const actor = await requireMembershipActor(req);
        await requireCircleManagerForActor(prisma, {
            actor,
            circleId,
            allowModerator: options.allowModerator,
        });
        return actor;
    }

    async function requireMembershipOwner(req: any, circleId: number) {
        const actor = await requireMembershipActor(req);
        await requireCircleOwnerForActor(prisma, { actor, circleId });
        return actor;
    }

    async function requireSignedMembershipManager(req: any, circleId: number, actorPubkey: string) {
        const actor = await requireMembershipActor(req);
        if (actor.pubkey !== actorPubkey) {
            throw new AuthActorError(
                403,
                'actor_pubkey_session_mismatch',
                'actorPubkey must match authenticated session actor',
                'actor_pubkey_session_mismatch',
                true,
            );
        }
        await requireCircleManagerForActor(prisma, { actor, circleId });
        return actor;
    }
    const visitorDustTtlSec = parsePositiveEnvInt(process.env.DISCUSSION_VISITOR_DUST_TTL_SEC, 24 * 60 * 60);

    // GET /api/v1/membership/circles/:id/me
    router.get('/circles/:id/me', async (req, res, next) => {
        try {
            const circleId = parseCircleId(req.params.id);
            if (!circleId) {
                return res.status(400).json({ error: 'invalid_circle_id' });
            }
            const circle = await prisma.circle.findUnique({
                where: { id: circleId },
                select: {
                    id: true,
                    joinRequirement: true,
                    circleType: true,
                    minCrystals: true,
                    creatorId: true,
                    createdAt: true,
                },
            });
            if (!circle) {
                return res.status(404).json({ error: 'circle_not_found' });
            }
            const projectedPolicy = await resolveProjectedCircleSettings(prisma, circle);

            const actor = await resolveOptionalMembershipActor(req);
            if (!actor) {
                return res.json({
                    authenticated: false,
                    circleId,
                    policy: toPolicyPayload(projectedPolicy),
                    joinState: 'guest',
                    membership: null,
                    userCrystals: 0,
                    missingCrystals: 0,
                });
            }
            const userId = actor.userId;

            const [user, membership, pendingRequest, approvedRequest] = await Promise.all([
                prisma.user.findUnique({
                    where: { id: userId },
                    select: {
                        id: true,
                        handle: true,
                        pubkey: true,
                    },
                }),
                prisma.circleMember.findUnique({
                    where: {
                        circleId_userId: {
                            circleId,
                            userId,
                        },
                    },
                }),
                prisma.circleJoinRequest.findFirst({
                    where: {
                        circleId,
                        userId,
                        status: CircleJoinRequestStatus.Pending,
                    },
                    orderBy: { createdAt: 'desc' },
                    select: { id: true, status: true, createdAt: true },
                }),
                prisma.circleJoinRequest.findFirst({
                    where: {
                        circleId,
                        userId,
                        status: CircleJoinRequestStatus.Approved,
                    },
                    orderBy: { reviewedAt: 'desc' },
                    select: { id: true },
                }),
            ]);

            const invite = pendingRequest
                ? null
                : await prisma.circleInvite.findFirst({
                    where: {
                        circleId,
                        OR: [
                            { status: CircleInviteStatus.Active, inviteeUserId: userId },
                            ...(user?.handle
                                ? [{ status: CircleInviteStatus.Active, inviteeHandle: user.handle }]
                                : []),
                            { status: CircleInviteStatus.Accepted, acceptedById: userId },
                        ],
                    },
                    orderBy: { createdAt: 'desc' },
                    select: {
                        id: true,
                        status: true,
                        acceptedById: true,
                        expiresAt: true,
                    },
                });
            const hasValidInvite = !!(
                invite
                && (!invite.expiresAt || invite.expiresAt.getTime() > Date.now())
                && (
                    invite.status === CircleInviteStatus.Active
                    || (
                        invite.status === CircleInviteStatus.Accepted
                        && invite.acceptedById === userId
                    )
                )
            );

            const decision = evaluateMembershipJoinDecision({
                policy: resolveCircleJoinPolicy(projectedPolicy),
                hasActiveMembership: membership?.status === MemberStatus.Active,
                hasPendingRequest: !!pendingRequest,
                isBanned: membership?.status === MemberStatus.Banned,
                hasValidInvite: hasValidInvite || !!approvedRequest,
            });

            if (membership?.status === MemberStatus.Active && user?.pubkey) {
                try {
                    const promotion = await promoteMemberDustMessagesAfterJoinProjection(prisma, {
                        circleId,
                        senderPubkey: user.pubkey,
                        visitorDustTtlSec,
                    });
                    await publishPromotedDustMessageRefreshes(redis, {
                        ...promotion,
                        circleId,
                    });
                } catch (error) {
                    const message = error instanceof Error ? error.message : String(error);
                    console.warn(`membership dust promotion failed for circle ${circleId}: ${message}`);
                }
            }

            if (circle.creatorId === userId) {
                return res.json({
                    authenticated: true,
                    circleId,
                    policy: toPolicyPayload(projectedPolicy),
                    joinState: 'joined',
                    membership: buildCreatorMembershipPayload(circle.createdAt),
                    pendingRequest: null,
                    userCrystals: 0,
                    missingCrystals: 0,
                });
            }

            return res.json({
                authenticated: true,
                circleId,
                policy: toPolicyPayload(projectedPolicy),
                joinState: decision.state,
                membership: membership
                    ? {
                        role: membership.role,
                        status: membership.status,
                        identityLevel: membership.identityLevel,
                        joinedAt: membership.joinedAt,
                    }
                    : null,
                pendingRequest,
                userCrystals: decision.userCrystals,
                missingCrystals: decision.missingCrystals,
            });
        } catch (error) {
            if (sendAuthActorError(res, error)) return;
            next(error);
        }
    });

    // GET /api/v1/membership/circles/:id/identity-status
    router.get('/circles/:id/identity-status', async (req, res, next) => {
        try {
            const circleId = parseCircleId(req.params.id);
            if (!circleId) {
                return res.status(400).json({ error: 'invalid_circle_id' });
            }
            const locale = resolveRequestLocale({
                requestedLocale: (req.query?.locale as string | string[] | undefined)
                    ?? (typeof req.header === 'function' ? req.header('x-alcheme-locale') : undefined),
                acceptLanguage: req.headers?.['accept-language'],
            });

            const circle = await prisma.circle.findUnique({
                where: { id: circleId },
                select: {
                    id: true,
                    creatorId: true,
                    createdAt: true,
                },
            });
            if (!circle) {
                return res.status(404).json({ error: 'circle_not_found' });
            }

            const thresholds = getThresholds(null, circleId);
            const notificationMode = getIdentityNotificationMode(circleId, null);
            const actor = await resolveOptionalMembershipActor(req);
            if (!actor) {
                return res.json({
                    authenticated: false,
                    circleId,
                    currentLevel: IdentityLevel.Visitor,
                    nextLevel: null,
                    messagingMode: 'dust_only',
                    hint: buildVisitorDustHint(locale),
                    thresholds,
                    policy: {
                        notificationMode,
                    },
                    progress: {
                        messageCount: 0,
                        citationCount: 0,
                        reputationScore: 0,
                        reputationPercentile: null,
                        daysSinceActive: null,
                    },
                });
            }
            const authUserId = actor.userId;

            const [user, membership] = await Promise.all([
                prisma.user.findUnique({
                    where: { id: authUserId },
                    select: {
                        id: true,
                        pubkey: true,
                        reputationScore: true,
                    },
                }),
                prisma.circleMember.findUnique({
                    where: {
                        circleId_userId: {
                            circleId,
                            userId: authUserId,
                        },
                    },
                    select: {
                        role: true,
                        status: true,
                        identityLevel: true,
                        joinedAt: true,
                    },
                }),
            ]);

            if (!user) {
                return res.status(401).json({ error: 'auth_user_not_found' });
            }

            const isCreator = circle.creatorId === authUserId;
            const isActiveMember = membership?.status === MemberStatus.Active;
            if (!isCreator && !isActiveMember) {
                const dustRows = await prisma.$queryRaw<Array<{ count: number }>>`
                    SELECT COUNT(*)::INT AS "count"
                    FROM circle_discussion_messages
                    WHERE circle_id = ${circleId}
                      AND sender_pubkey = ${user.pubkey}
                      AND is_ephemeral = TRUE
                      AND (expires_at IS NULL OR expires_at > NOW())
                `;
                const visitorMessageCount = Number(dustRows[0]?.count ?? 0);

                return res.json({
                    authenticated: true,
                    circleId,
                    currentLevel: IdentityLevel.Visitor,
                    nextLevel: null,
                    messagingMode: 'dust_only',
                    hint: buildVisitorDustHint(locale),
                    thresholds,
                    policy: {
                        notificationMode,
                    },
                    progress: {
                        messageCount: visitorMessageCount,
                        citationCount: 0,
                        reputationScore: Number(user.reputationScore ?? 0),
                        reputationPercentile: null,
                        daysSinceActive: null,
                    },
                });
            }

            const currentLevel = (
                isCreator
                    ? (membership?.identityLevel as IdentityLevel | null) ?? IdentityLevel.Member
                    : (membership?.identityLevel as IdentityLevel | null) ?? IdentityLevel.Visitor
            ) as IdentityLevel;
            if (isActiveMember) {
                try {
                    const promotion = await promoteMemberDustMessagesAfterJoinProjection(prisma, {
                        circleId,
                        senderPubkey: user.pubkey,
                        visitorDustTtlSec,
                    });
                    await publishPromotedDustMessageRefreshes(redis, {
                        ...promotion,
                        circleId,
                    });
                } catch (error) {
                    const message = error instanceof Error ? error.message : String(error);
                    console.warn(`identity dust promotion failed for circle ${circleId}: ${message}`);
                }
            }
            const [stats, reputationPercentile, identityEvents] = await Promise.all([
                getUserCircleStats(prisma, authUserId, circleId),
                getReputationPercentile(prisma, authUserId, circleId),
                prisma.circleMembershipEvent.findMany({
                    where: {
                        circleId,
                        userId: authUserId,
                        eventType: CircleMembershipEventType.IdentityChanged,
                    },
                    orderBy: { createdAt: 'desc' },
                    take: 5,
                    select: {
                        reason: true,
                        metadata: true,
                        createdAt: true,
                    },
                }),
            ]);
            const evaluation = evaluateIdentity(
                stats,
                currentLevel,
                thresholds,
                reputationPercentile,
            );
            const nextLevel = resolveNextIdentityLevel(currentLevel);
            const daysSinceActive = stats.lastActiveAt
                ? Math.max(0, Math.floor((Date.now() - stats.lastActiveAt.getTime()) / (24 * 60 * 60 * 1000)))
                : null;
            const transition = evaluation.changed
                ? {
                    from: evaluation.previousLevel,
                    to: evaluation.newLevel,
                    reason: evaluation.reason ?? null,
                }
                : null;
            const history = identityEvents
                .map(mapIdentityTransitionEvent)
                .filter((item): item is NonNullable<typeof item> => Boolean(item));
            const recentTransition = resolveRecentIdentityTransition(history);

            return res.json({
                authenticated: true,
                circleId,
                currentLevel,
                nextLevel,
                messagingMode: 'formal',
                hint: buildIdentityHint({
                    currentLevel,
                    nextLevel,
                    thresholds,
                    messageCount: stats.messageCount,
                    citationCount: stats.citationCount,
                    reputationPercentile,
                    latestEvaluationReason: evaluation.reason ?? null,
                    locale,
                }),
                thresholds,
                policy: {
                    notificationMode,
                },
                transition,
                recentTransition,
                history,
                progress: {
                    messageCount: stats.messageCount,
                    citationCount: stats.citationCount,
                    reputationScore: Number(stats.reputationScore ?? 0),
                    reputationPercentile,
                    daysSinceActive,
                },
            });
        } catch (error) {
            if (sendAuthActorError(res, error)) return;
            next(error);
        }
    });

    // POST /api/v1/membership/circles/:id/join
    router.post('/circles/:id/join', async (req, res, next) => {
        try {
            const circleId = parseCircleId(req.params.id);
            if (!circleId) {
                return res.status(400).json({ error: 'invalid_circle_id' });
            }

            const actor = await requireMembershipActor(req);
            const userId = actor.userId;

            const circle = await prisma.circle.findUnique({
                where: { id: circleId },
                select: {
                    id: true,
                    joinRequirement: true,
                    circleType: true,
                    minCrystals: true,
                    creatorId: true,
                    lifecycleStatus: true,
                },
            });
            if (!circle) {
                return res.status(404).json({ error: 'circle_not_found' });
            }
            if (circle.lifecycleStatus === 'Archived') {
                return res.status(409).json({ error: 'circle_archived' });
            }
            if (circle.lifecycleStatus !== 'Active') {
                return res.status(409).json({ error: 'circle_not_active' });
            }

            if (circle.creatorId === userId) {
                return res.json({
                    ok: true,
                    circleId,
                    joinState: 'joined',
                    alreadyMember: true,
                    membership: {
                        role: MemberRole.Owner,
                        status: MemberStatus.Active,
                        identityLevel: 'Member',
                    },
                });
            }

            const inviteCode = typeof req.body?.inviteCode === 'string' ? req.body.inviteCode.trim() : '';
            const requestMessage = typeof req.body?.message === 'string' ? req.body.message.trim() : '';
            const [membership, pendingRequest] = await Promise.all([
                prisma.circleMember.findUnique({
                    where: {
                        circleId_userId: {
                            circleId,
                            userId,
                        },
                    },
                }),
                prisma.circleJoinRequest.findFirst({
                    where: {
                        circleId,
                        userId,
                        status: CircleJoinRequestStatus.Pending,
                    },
                    orderBy: { createdAt: 'desc' },
                    select: { id: true, createdAt: true },
                }),
            ]);

            let invite = null as null | { id: number; code: string; status: CircleInviteStatus };
            if (inviteCode) {
                const inviteRecord = await prisma.circleInvite.findUnique({
                    where: { code: inviteCode },
                    select: {
                        id: true,
                        code: true,
                        circleId: true,
                        status: true,
                        acceptedById: true,
                        inviteeUserId: true,
                        inviteeHandle: true,
                        expiresAt: true,
                    },
                });
                const inviteMatchesActor = !!inviteRecord
                    && (!inviteRecord.inviteeUserId || inviteRecord.inviteeUserId === userId)
                    && (!inviteRecord.inviteeHandle || inviteRecord.inviteeHandle === actor.handle);
                const acceptedInviteClaimedByActor = !!inviteRecord
                    && inviteRecord.status === CircleInviteStatus.Accepted
                    && inviteRecord.acceptedById === userId;
                if (
                    inviteRecord
                    && inviteRecord.circleId === circleId
                    && (!inviteRecord.expiresAt || inviteRecord.expiresAt.getTime() > Date.now())
                    && (
                        (inviteRecord.status === CircleInviteStatus.Active && inviteMatchesActor)
                        || acceptedInviteClaimedByActor
                    )
                ) {
                    invite = {
                        id: inviteRecord.id,
                        code: inviteRecord.code,
                        status: inviteRecord.status,
                    };
                }
            } else {
                const targetedInvite = await prisma.circleInvite.findFirst({
                    where: {
                        circleId,
                        OR: [
                            {
                                status: CircleInviteStatus.Active,
                                OR: [
                                    { inviteeUserId: userId },
                                    actor.handle ? { inviteeHandle: actor.handle } : undefined,
                                ].filter(Boolean) as any,
                            },
                            {
                                status: CircleInviteStatus.Accepted,
                                acceptedById: userId,
                            },
                        ].filter(Boolean) as any,
                    },
                    orderBy: { createdAt: 'desc' },
                    select: {
                        id: true,
                        code: true,
                        status: true,
                        acceptedById: true,
                        expiresAt: true,
                    },
                });
                if (
                    targetedInvite
                    && (!targetedInvite.expiresAt || targetedInvite.expiresAt.getTime() > Date.now())
                    && (
                        targetedInvite.status === CircleInviteStatus.Active
                        || (
                            targetedInvite.status === CircleInviteStatus.Accepted
                            && targetedInvite.acceptedById === userId
                        )
                    )
                ) {
                    invite = {
                        id: targetedInvite.id,
                        code: targetedInvite.code,
                        status: targetedInvite.status,
                    };
                }
            }

            const approvedRequest = pendingRequest
                ? null
                : await prisma.circleJoinRequest.findFirst({
                    where: {
                        circleId,
                        userId,
                        status: CircleJoinRequestStatus.Approved,
                    },
                    orderBy: { reviewedAt: 'desc' },
                    select: { id: true },
                });
            const projectedPolicy = await resolveProjectedCircleSettings(prisma, circle);

            const decision = evaluateMembershipJoinDecision({
                policy: resolveCircleJoinPolicy(projectedPolicy),
                hasActiveMembership: membership?.status === MemberStatus.Active,
                hasPendingRequest: !!pendingRequest,
                isBanned: membership?.status === MemberStatus.Banned,
                hasValidInvite: !!invite || !!approvedRequest,
            });

            if (decision.state === 'joined') {
                return res.json({
                    ok: true,
                    circleId,
                    joinState: 'joined',
                    alreadyMember: true,
                });
            }

            if (decision.state === 'banned') {
                return res.status(403).json({
                    error: 'membership_banned',
                    joinState: decision.state,
                });
            }

            if (decision.state === 'invite_required') {
                return res.status(403).json({
                    error: 'invite_required',
                    joinState: decision.state,
                });
            }

            if (decision.state === 'pending') {
                return res.status(202).json({
                    ok: true,
                    circleId,
                    joinState: 'pending',
                    requestId: pendingRequest?.id ?? null,
                });
            }

            if (decision.state === 'approval_required') {
                const request = pendingRequest
                    ? await prisma.circleJoinRequest.findUnique({ where: { id: pendingRequest.id } })
                    : await prisma.circleJoinRequest.create({
                        data: {
                            circleId,
                            userId,
                            status: CircleJoinRequestStatus.Pending,
                            requestMessage: requestMessage || null,
                        },
                    });

                if (request && !pendingRequest) {
                    await logMembershipEvent(prisma, {
                        circleId,
                        userId,
                        actorUserId: userId,
                        eventType: CircleMembershipEventType.JoinRequested,
                        statusBefore: membership?.status ?? null,
                        statusAfter: null,
                        joinRequestId: request.id,
                        reason: requestMessage || null,
                    });
                }

                return res.status(202).json({
                    ok: true,
                    circleId,
                    joinState: 'pending',
                    requestId: request?.id ?? null,
                });
            }

            if (invite?.status === CircleInviteStatus.Active) {
                await prisma.circleInvite.update({
                    where: { id: invite.id },
                    data: {
                        status: CircleInviteStatus.Accepted,
                        acceptedById: userId,
                        acceptedAt: new Date(),
                    },
                });
                await logMembershipEvent(prisma, {
                    circleId,
                    userId,
                    actorUserId: userId,
                    eventType: CircleMembershipEventType.InviteAccepted,
                    statusBefore: membership?.status ?? null,
                    statusAfter: membership?.status ?? null,
                    inviteId: invite.id,
                });
            }
            if (membership) {
                return res.json({
                    ok: true,
                    circleId,
                    joinState: 'can_join',
                    finalization: {
                        action: 'reactivate_existing',
                    },
                });
            }

            // Query API decides the join policy; on-chain finalization only
            // checks that the grant was signed by a trusted attestor.
            const grant = issueMembershipAdmissionGrant({
                circleId,
                memberPubkey: actor.pubkey,
                kind: invite ? 'Invite' : approvedRequest ? 'Approval' : 'Open',
                artifactId: invite?.id ?? approvedRequest?.id ?? 0,
            });

            return res.json({
                ok: true,
                circleId,
                joinState: 'can_join',
                finalization: {
                    action: 'claim_membership',
                    grant,
                },
            });
        } catch (error) {
            if (sendAuthActorError(res, error)) return;
            next(error);
        }
    });

    // POST /api/v1/membership/circles/:id/leave
    router.post('/circles/:id/leave', async (req, res, next) => {
        try {
            const circleId = parseCircleId(req.params.id);
            if (!circleId) {
                return res.status(400).json({ error: 'invalid_circle_id' });
            }

            const actor = await requireMembershipActor(req);
            const userId = actor.userId;

            const membership = await prisma.circleMember.findUnique({
                where: {
                    circleId_userId: {
                        circleId,
                        userId,
                    },
                },
            });
            if (!membership || membership.status !== MemberStatus.Active) {
                return res.status(404).json({ error: 'active_membership_not_found' });
            }
            if (membership.role === 'Owner') {
                return res.status(400).json({ error: 'owner_cannot_leave_circle' });
            }

            return res.status(202).json(buildWalletFinalizationShim({
                circleId,
                userId,
                action: 'leave',
            }));
        } catch (error) {
            if (sendAuthActorError(res, error)) return;
            next(error);
        }
    });

    // POST /api/v1/membership/circles/:id/join-requests/:requestId/approve
    router.post('/circles/:id/join-requests/:requestId/approve', async (req, res, next) => {
        try {
            const circleId = parseCircleId(req.params.id);
            const requestId = Number(req.params.requestId);
            if (!circleId || !Number.isFinite(requestId) || requestId <= 0) {
                return res.status(400).json({ error: 'invalid_request' });
            }

            const actor = await requireMembershipManager(req, circleId, { allowModerator: true });
            const actorUserId = actor.userId;

            const request = await prisma.circleJoinRequest.findUnique({
                where: { id: requestId },
                select: {
                    id: true,
                    circleId: true,
                    userId: true,
                    status: true,
                },
            });
            if (!request || request.circleId !== circleId) {
                return res.status(404).json({ error: 'join_request_not_found' });
            }
            if (request.status !== CircleJoinRequestStatus.Pending) {
                return res.status(409).json({ error: 'join_request_not_pending' });
            }

            await prisma.circleJoinRequest.update({
                where: { id: request.id },
                data: {
                    status: CircleJoinRequestStatus.Approved,
                    reviewedById: actorUserId,
                    reviewedAt: new Date(),
                    decisionReason: typeof req.body?.reason === 'string' ? req.body.reason.trim() : null,
                },
            });

            await logMembershipEvent(prisma, {
                circleId,
                userId: request.userId,
                actorUserId,
                eventType: CircleMembershipEventType.JoinApproved,
                statusBefore: null,
                statusAfter: null,
                joinRequestId: request.id,
            });

            return res.json({
                ok: true,
                circleId,
                requestId: request.id,
                status: CircleJoinRequestStatus.Approved,
                finalizationPending: true,
            });
        } catch (error) {
            if (sendAuthActorError(res, error)) return;
            next(error);
        }
    });

    // POST /api/v1/membership/circles/:id/invites
    router.post('/circles/:id/invites', async (req, res, next) => {
        try {
            const circleId = parseCircleId(req.params.id);
            if (!circleId) {
                return res.status(400).json({ error: 'invalid_circle_id' });
            }

            const actor = await requireMembershipManager(req, circleId, { allowModerator: true });
            const actorUserId = actor.userId;
            const inviteeHandle = typeof req.body?.inviteeHandle === 'string'
                ? req.body.inviteeHandle.trim()
                : '';
            const hasInviteeUserId = req.body?.inviteeUserId !== undefined
                && req.body?.inviteeUserId !== null
                && req.body?.inviteeUserId !== '';
            const inviteeUserIdRaw = Number(req.body?.inviteeUserId);
            if (hasInviteeUserId && (!Number.isSafeInteger(inviteeUserIdRaw) || inviteeUserIdRaw <= 0)) {
                return res.status(400).json({ error: 'invalid_invitee_user_id' });
            }
            const inviteeUserId = hasInviteeUserId
                ? inviteeUserIdRaw
                : null;
            const expiresInHoursRaw = Number(req.body?.expiresInHours);
            const expiresInHours = Number.isFinite(expiresInHoursRaw) && expiresInHoursRaw > 0
                ? Math.min(24 * 30, Math.floor(expiresInHoursRaw))
                : 72;
            const note = typeof req.body?.note === 'string' ? req.body.note.trim() : null;

            const invite = await prisma.$transaction(async (tx) => {
                const inviteTargetCircle = await tx.circle.findUnique({
                    where: { id: circleId },
                    select: {
                        kind: true,
                        parentCircleId: true,
                    },
                });
                if (!inviteTargetCircle) {
                    throw new CircleInviteRequestError(404, 'circle_not_found');
                }

                let resolvedInvitee = inviteeUserId
                    ? await tx.user.findUnique({
                        where: { id: inviteeUserId },
                        select: { id: true, handle: true },
                    })
                    : inviteeHandle
                        ? await tx.user.findUnique({
                            where: { handle: inviteeHandle },
                            select: { id: true, handle: true },
                        })
                        : null;

                if (inviteeUserId && !resolvedInvitee) {
                    throw new CircleInviteRequestError(404, 'invitee_user_not_found');
                }
                if (resolvedInvitee && inviteeHandle && resolvedInvitee.handle !== inviteeHandle) {
                    throw new CircleInviteRequestError(409, 'invitee_identity_mismatch');
                }

                const initialLockKey = resolvedInvitee
                    ? `circle-invite:${circleId}:user:${resolvedInvitee.id}`
                    : inviteeHandle
                        ? `circle-invite:${circleId}:handle:${inviteeHandle}`
                        : null;
                if (initialLockKey) {
                    await tx.$executeRawUnsafe(
                        'SELECT pg_advisory_xact_lock(hashtext($1))',
                        initialLockKey,
                    );
                }

                if (inviteeUserId) {
                    resolvedInvitee = await tx.user.findUnique({
                        where: { id: inviteeUserId },
                        select: { id: true, handle: true },
                    });
                    if (!resolvedInvitee) {
                        throw new CircleInviteRequestError(404, 'invitee_user_not_found');
                    }
                    if (inviteeHandle && resolvedInvitee.handle !== inviteeHandle) {
                        throw new CircleInviteRequestError(409, 'invitee_identity_mismatch');
                    }
                } else if (inviteeHandle) {
                    const lockedInvitee = await tx.user.findUnique({
                        where: { handle: inviteeHandle },
                        select: { id: true, handle: true },
                    });
                    if (!resolvedInvitee && lockedInvitee) {
                        await tx.$executeRawUnsafe(
                            'SELECT pg_advisory_xact_lock(hashtext($1))',
                            `circle-invite:${circleId}:user:${lockedInvitee.id}`,
                        );
                    }
                    resolvedInvitee = lockedInvitee;
                }

                const resolvedInviteeUserId = resolvedInvitee?.id ?? null;
                if (resolvedInviteeUserId) {
                    const existingMembership = await tx.circleMember.findUnique({
                        where: {
                            circleId_userId: {
                                circleId,
                                userId: resolvedInviteeUserId,
                            },
                        },
                        select: { status: true },
                    });
                    if (existingMembership?.status === MemberStatus.Active) {
                        throw new CircleInviteRequestError(409, 'invitee_already_member');
                    }
                }

                if (String(inviteTargetCircle.kind || '').trim().toLowerCase() === 'auxiliary') {
                    const parentCircleId = Number(inviteTargetCircle.parentCircleId);
                    if (!Number.isSafeInteger(parentCircleId) || parentCircleId <= 0) {
                        throw new CircleInviteRequestError(409, 'auxiliary_circle_parent_required');
                    }
                    if (!resolvedInviteeUserId) {
                        throw new CircleInviteRequestError(403, 'auxiliary_invitee_parent_membership_required');
                    }
                    const parentMembership = await tx.circleMember.findUnique({
                        where: {
                            circleId_userId: {
                                circleId: parentCircleId,
                                userId: resolvedInviteeUserId,
                            },
                        },
                        select: { status: true },
                    });
                    if (parentMembership?.status !== MemberStatus.Active) {
                        throw new CircleInviteRequestError(403, 'auxiliary_invitee_parent_membership_required');
                    }
                }

                const inviteConflictOr: Prisma.CircleInviteWhereInput[] = [];
                if (resolvedInviteeUserId) {
                    inviteConflictOr.push({ inviteeUserId: resolvedInviteeUserId });
                    if (resolvedInvitee?.handle) {
                        inviteConflictOr.push({ inviteeHandle: resolvedInvitee.handle });
                    }
                } else if (inviteeHandle) {
                    inviteConflictOr.push({ inviteeHandle });
                }
                if (inviteConflictOr.length > 0) {
                    const existingInvite = await tx.circleInvite.findFirst({
                        where: {
                            circleId,
                            status: CircleInviteStatus.Active,
                            AND: [
                                { OR: inviteConflictOr },
                                {
                                    OR: [
                                        { expiresAt: null },
                                        { expiresAt: { gt: new Date() } },
                                    ],
                                },
                            ],
                        },
                        select: { id: true },
                    });
                    if (existingInvite) {
                        throw new CircleInviteRequestError(409, 'active_invite_exists');
                    }
                }

                const createdInvite = await tx.circleInvite.create({
                    data: {
                        circleId,
                        inviterId: actorUserId,
                        inviteeUserId: resolvedInviteeUserId,
                        inviteeHandle: inviteeHandle || null,
                        code: randomInviteCode(),
                        status: CircleInviteStatus.Active,
                        note,
                        expiresAt: new Date(Date.now() + expiresInHours * 60 * 60 * 1000),
                    },
                    select: {
                        id: true,
                        code: true,
                        inviteeUserId: true,
                        inviteeHandle: true,
                        status: true,
                        expiresAt: true,
                        createdAt: true,
                    },
                });

                await logMembershipEvent(tx, {
                    circleId,
                    userId: resolvedInviteeUserId ?? actorUserId,
                    actorUserId,
                    eventType: CircleMembershipEventType.InviteCreated,
                    inviteId: createdInvite.id,
                    metadata: {
                        inviteeHandle: createdInvite.inviteeHandle,
                    },
                });

                if (resolvedInviteeUserId) {
                    await tx.notification.create({
                        data: {
                            userId: resolvedInviteeUserId,
                            type: 'invite',
                            title: 'membership.invited',
                            body: null,
                            metadata: {
                                messageKey: 'membership.invited',
                                params: {},
                            },
                            sourceType: 'circle_invite',
                            sourceId: String(createdInvite.id),
                            circleId,
                        },
                    });
                }

                return createdInvite;
            });

            return res.json({
                ok: true,
                circleId,
                invite,
            });
        } catch (error) {
            if (error instanceof CircleInviteRequestError) {
                return res.status(error.statusCode).json({ error: error.code });
            }
            if (sendAuthActorError(res, error)) return;
            next(error);
        }
    });

    // PUT /api/v1/membership/circles/:id/members/:userId/role
    router.put('/circles/:id/members/:userId/role', async (req, res, next) => {
        try {
            const circleId = parseCircleId(req.params.id);
            const targetUserId = parseCircleId(req.params.userId);
            if (!circleId || !targetUserId) {
                return res.status(400).json({ error: 'invalid_member_target' });
            }

            const actor = await requireMembershipOwner(req, circleId);
            const actorUserId = actor.userId;
            const actorIsOwner = true;
            const nextRole = normalizeManagedMemberRole(req.body?.role);
            if (!nextRole) {
                return res.status(400).json({ error: 'invalid_target_role' });
            }

            const membership = await prisma.circleMember.findUnique({
                where: {
                    circleId_userId: {
                        circleId,
                        userId: targetUserId,
                    },
                },
            });
            if (!membership || membership.status !== MemberStatus.Active) {
                return res.status(404).json({ error: 'active_membership_not_found' });
            }

            const decision = validateCircleMemberRoleChange({
                actorUserId,
                targetUserId,
                actorIsOwner,
                targetRole: membership.role,
                nextRole,
            });
            if (!decision.allowed) {
                return res.status(decision.statusCode).json({ error: decision.error, message: decision.message });
            }

            if (membership.role === nextRole) {
                return res.json({
                    ok: true,
                    circleId,
                    membership: {
                        userId: membership.userId,
                        role: membership.role,
                        status: membership.status,
                    },
                    changed: false,
                });
            }

            return res.status(202).json(buildWalletFinalizationShim({
                circleId,
                userId: targetUserId,
                action: 'update_role',
                role: nextRole,
                currentRole: membership.role,
            }));
        } catch (error) {
            if (sendAuthActorError(res, error)) return;
            next(error);
        }
    });

    // POST /api/v1/membership/circles/:id/members/:userId/remove
    router.post('/circles/:id/members/:userId/remove', async (req, res, next) => {
        try {
            const circleId = parseCircleId(req.params.id);
            const targetUserId = parseCircleId(req.params.userId);
            if (!circleId || !targetUserId) {
                return res.status(400).json({ error: 'invalid_member_target' });
            }

            const actor = await requireMembershipOwner(req, circleId);
            const actorUserId = actor.userId;
            const actorIsOwner = true;

            const membership = await prisma.circleMember.findUnique({
                where: {
                    circleId_userId: {
                        circleId,
                        userId: targetUserId,
                    },
                },
                select: {
                    id: true,
                    userId: true,
                    role: true,
                    status: true,
                    onChainAddress: true,
                    lastSyncedSlot: true,
                    user: { select: { pubkey: true } },
                },
            });
            if (!membership || membership.status !== MemberStatus.Active) {
                return res.status(404).json({ error: 'active_membership_not_found' });
            }

            const decision = validateCircleMemberRemoval({
                actorUserId,
                targetUserId,
                actorIsOwner,
                targetRole: membership.role,
            });
            if (!decision.allowed) {
                return res.status(decision.statusCode).json({ error: decision.error, message: decision.message });
            }

            const result = await createCircleMemberRemovalGovernanceCase(prisma, {
                circleId,
                actorPubkey: actor.pubkey,
                actorRole: MemberRole.Owner,
                targetMembership: {
                    id: membership.id,
                    userId: membership.userId,
                    role: membership.role,
                    status: membership.status,
                    membershipAccount: membership.onChainAddress,
                    userPubkey: membership.user.pubkey,
                    lastSyncedSlot: membership.lastSyncedSlot,
                },
                publicReason: req.body?.reason,
            });
            return res.status(202).json({
                ok: true,
                circleId,
                userId: targetUserId,
                governanceRequired: true,
                requiresWalletFinalization: false,
                replayed: result.replayed,
                case: projectGovernanceCase(result.governanceCase, null, {
                    includePrivateOriginRefs: true,
                    workflowAudience: 'operator',
                    viewerPubkey: actor.pubkey,
                }),
            });
        } catch (error) {
            if (sendAuthActorError(res, error)) return;
            if (error instanceof GovernanceCaseIntakeError || error instanceof GovernanceCaseTemplateError) {
                res.status(error.statusCode).json({ error: error.code });
                return;
            }
            if (error instanceof Error && error.message === 'circle_member_removal_reason_required') {
                res.status(400).json({ error: error.message });
                return;
            }
            next(error);
        }
    });

    // PUT /api/v1/membership/circles/:id/policy
    router.put('/circles/:id/policy', async (req, res, next) => {
        try {
            const circleId = parseCircleId(req.params.id);
            if (!circleId) {
                return res.status(400).json({ error: 'invalid_circle_id' });
            }

            const mappedByAccessType = mapAccessTypeToPolicy(
                typeof req.body?.accessType === 'string' ? req.body.accessType : null,
            );
            const joinRequirementRaw = typeof req.body?.joinRequirement === 'string'
                ? req.body.joinRequirement
                : null;
            const circleTypeRaw = typeof req.body?.circleType === 'string'
                ? req.body.circleType
                : null;

            const joinRequirement = mappedByAccessType?.joinRequirement
                ?? (joinRequirementRaw && Object.values(JoinRequirement).includes(joinRequirementRaw as JoinRequirement)
                    ? (joinRequirementRaw as JoinRequirement)
                    : null);
            const circleType = mappedByAccessType?.circleType
                ?? (circleTypeRaw && Object.values(CircleType).includes(circleTypeRaw as CircleType)
                    ? (circleTypeRaw as CircleType)
                    : null);

            if (!joinRequirement && !circleType) {
                return res.status(400).json({ error: 'no_policy_change_requested' });
            }
            const membershipPolicyInput: {
                circleId: number;
                joinRequirement?: JoinRequirement | null;
                circleType?: CircleType | null;
                minCrystals?: number;
            } = {
                circleId,
                joinRequirement,
                circleType,
            };
            if (Object.prototype.hasOwnProperty.call(req.body ?? {}, 'minCrystals')) {
                membershipPolicyInput.minCrystals = Number(req.body.minCrystals);
            }
            let resolvedPolicy;
            try {
                resolvedPolicy = await resolveMembershipPolicySetting(prisma, membershipPolicyInput);
            } catch (error) {
                if (error instanceof CircleSettingsWriteError) {
                    return res.status(error.statusCode).json(error.body);
                }
                throw error;
            }
            const actorPubkey = typeof req.body?.actorPubkey === 'string'
                ? req.body.actorPubkey.trim()
                : '';
            const signedMessage = typeof req.body?.signedMessage === 'string'
                ? req.body.signedMessage
                : '';
            const signature = typeof req.body?.signature === 'string'
                ? req.body.signature
                : '';
            const signedPayload = parseCircleSettingsSignedMessage(signedMessage);
            if (!actorPubkey || !signedMessage || !signature || !signedPayload) {
                return res.status(401).json({ error: 'circle_settings_auth_required' });
            }
            if (
                signedPayload.circleId !== circleId
                || signedPayload.actorPubkey !== actorPubkey
                || signedPayload.settingKind !== 'membership_policy'
            ) {
                return res.status(400).json({ error: 'circle_settings_signature_payload_mismatch' });
            }
            if (!verifyEd25519SignatureBase64({
                senderPubkey: actorPubkey,
                message: signedMessage,
                signatureBase64: signature,
            })) {
                return res.status(401).json({ error: 'invalid_circle_settings_signature' });
            }
            const expectedPayload = buildCircleSettingsSigningPayload({
                circleId,
                    actorPubkey,
                    settingKind: 'membership_policy',
                    payload: {
                        joinRequirement: resolvedPolicy.joinRequirement,
                        circleType: resolvedPolicy.circleType,
                        minCrystals: resolvedPolicy.minCrystals,
                    },
                    clientTimestamp: signedPayload.clientTimestamp,
                    nonce: signedPayload.nonce,
                anchor: signedPayload.anchor ?? null,
            });
            if (buildCircleSettingsSigningMessage(expectedPayload) !== signedMessage) {
                return res.status(400).json({ error: 'circle_settings_signature_payload_mismatch' });
            }
            if (!isCircleSettingsSignatureFresh({
                clientTimestamp: signedPayload.clientTimestamp,
                windowMs: Number(process.env.CIRCLE_SETTINGS_SIGNATURE_WINDOW_MS || '300000'),
            })) {
                return res.status(401).json({ error: 'circle_settings_signature_expired' });
            }
            const nonceStored = typeof (redis as any)?.set === 'function'
                ? await (redis as any).set(
                    `circle_settings:membership_policy:${circleId}:${actorPubkey}:${signedPayload.nonce}`,
                    '1',
                    'EX',
                    Math.max(60, Number(process.env.CIRCLE_SETTINGS_NONCE_TTL_SEC || '600')),
                    'NX',
                )
                : 'OK';
            if (nonceStored !== 'OK') {
                return res.status(409).json({ error: 'circle_settings_replay_detected' });
            }
            const actor = await requireSignedMembershipManager(req, circleId, actorPubkey);
            const actorUserId = actor.userId;

            const governance = await evaluateCirclePolicyGovernance(prisma, {
                circleId,
                actionType: CIRCLE_POLICY_MEMBERSHIP_UPDATE_ACTION_TYPE,
                actorPubkey,
                directAllowed: true,
                payload: buildMembershipPolicyGovernancePayload(resolvedPolicy),
            });
            if (governance.status === 'requires_governance') {
                return res.status(202).json(governance);
            }
            if (governance.status === 'denied') {
                return res.status(403).json({ error: governance.error });
            }

            const updated = await applyCircleMembershipPolicySetting(prisma, redis, {
                circleId,
                actorUserId,
                actorPubkey,
                policy: resolvedPolicy,
                audit: {
                    signedMessage,
                    signature,
                    clientTimestamp: signedPayload.clientTimestamp,
                    nonce: signedPayload.nonce,
                    anchor: signedPayload.anchor ?? null,
                },
            });

            return res.json({
                ok: true,
                circleId,
                policy: toPolicyPayload(updated),
            });
        } catch (error) {
            if (sendAuthActorError(res, error)) return;
            next(error);
        }
    });

    // PUT /api/v1/membership/circles/:id/policy/governance-finalize
    router.put('/circles/:id/policy/governance-finalize', async (req, res, next) => {
        try {
            const circleId = parseCircleId(req.params.id);
            if (!circleId) {
                return res.status(400).json({ error: 'invalid_circle_id' });
            }
            const governanceRequestId = typeof req.body?.governanceRequestId === 'string'
                ? req.body.governanceRequestId.trim()
                : '';
            if (!governanceRequestId) {
                return res.status(400).json({ error: 'governance_request_id_required' });
            }

            const joinRequirementRaw = typeof req.body?.joinRequirement === 'string'
                ? req.body.joinRequirement
                : null;
            const circleTypeRaw = typeof req.body?.circleType === 'string'
                ? req.body.circleType
                : null;
            const joinRequirement = joinRequirementRaw && Object.values(JoinRequirement).includes(joinRequirementRaw as JoinRequirement)
                ? (joinRequirementRaw as JoinRequirement)
                : null;
            const circleType = circleTypeRaw && Object.values(CircleType).includes(circleTypeRaw as CircleType)
                ? (circleTypeRaw as CircleType)
                : null;
            const requestedMinCrystals = Math.max(0, Math.min(0xffff, Math.floor(Number(req.body?.minCrystals))));
            if (!joinRequirement || !circleType || !Number.isFinite(requestedMinCrystals)) {
                return res.status(400).json({ error: 'invalid_membership_policy_payload' });
            }
            if (joinRequirement === JoinRequirement.TokenGated && requestedMinCrystals < 1) {
                return res.status(400).json({ error: 'token_gate_min_crystals_required' });
            }
            if (joinRequirement !== JoinRequirement.TokenGated && requestedMinCrystals !== 0) {
                return res.status(400).json({ error: 'min_crystals_requires_token_gate' });
            }

            const actorPubkey = typeof req.body?.actorPubkey === 'string'
                ? req.body.actorPubkey.trim()
                : '';
            const signedMessage = typeof req.body?.signedMessage === 'string'
                ? req.body.signedMessage
                : '';
            const signature = typeof req.body?.signature === 'string'
                ? req.body.signature
                : '';
            const signedPayload = parseCircleSettingsSignedMessage(signedMessage);
            if (!actorPubkey || !signedMessage || !signature || !signedPayload) {
                return res.status(401).json({ error: 'circle_settings_auth_required' });
            }
            if (
                signedPayload.circleId !== circleId
                || signedPayload.actorPubkey !== actorPubkey
                || signedPayload.settingKind !== 'membership_policy'
            ) {
                return res.status(400).json({ error: 'circle_settings_signature_payload_mismatch' });
            }
            if (!verifyEd25519SignatureBase64({
                senderPubkey: actorPubkey,
                message: signedMessage,
                signatureBase64: signature,
            })) {
                return res.status(401).json({ error: 'invalid_circle_settings_signature' });
            }
            const expectedPayload = buildCircleSettingsSigningPayload({
                circleId,
                actorPubkey,
                settingKind: 'membership_policy',
                payload: {
                    joinRequirement,
                    circleType,
                    minCrystals: requestedMinCrystals,
                },
                clientTimestamp: signedPayload.clientTimestamp,
                nonce: signedPayload.nonce,
                anchor: signedPayload.anchor ?? null,
            });
            if (buildCircleSettingsSigningMessage(expectedPayload) !== signedMessage) {
                return res.status(400).json({ error: 'circle_settings_signature_payload_mismatch' });
            }
            if (!isCircleSettingsSignatureFresh({
                clientTimestamp: signedPayload.clientTimestamp,
                windowMs: Number(process.env.CIRCLE_SETTINGS_SIGNATURE_WINDOW_MS || '300000'),
            })) {
                return res.status(401).json({ error: 'circle_settings_signature_expired' });
            }
            const nonceStored = typeof (redis as any)?.set === 'function'
                ? await (redis as any).set(
                    `circle_settings:membership_policy_finalize:${circleId}:${actorPubkey}:${signedPayload.nonce}`,
                    '1',
                    'EX',
                    Math.max(60, Number(process.env.CIRCLE_SETTINGS_NONCE_TTL_SEC || '600')),
                    'NX',
                )
                : 'OK';
            if (nonceStored !== 'OK') {
                return res.status(409).json({ error: 'circle_settings_replay_detected' });
            }

            const actor = await requireSignedMembershipManager(req, circleId, actorPubkey);
            const actorUserId = actor.userId;

            const request = await (prisma as any).governanceRequest.findUnique({
                where: { id: governanceRequestId },
                include: { decision: true },
            });
            if (!request) {
                return res.status(404).json({ error: 'governance_request_not_found' });
            }
            if (
                request.state !== 'accepted'
                || request.decision?.decision !== 'accepted'
                || request.actionType !== CIRCLE_POLICY_MEMBERSHIP_UPDATE_ACTION_TYPE
                || request.targetType !== 'circle'
                || String(request.targetRef) !== String(circleId)
            ) {
                return res.status(409).json({ error: 'governance_request_not_executable' });
            }
            const decisionDigest = String(request.decision.decisionDigest ?? '');
            if (!/^[a-f0-9]{64}$/.test(decisionDigest)) {
                return res.status(409).json({ error: 'governance_decision_digest_required' });
            }
            const requestPayload = request.payload && typeof request.payload === 'object'
                ? request.payload as Record<string, unknown>
                : {};
            if (
                requestPayload.joinRequirement !== joinRequirement
                || requestPayload.circleType !== circleType
                || Number(requestPayload.minCrystals) !== requestedMinCrystals
            ) {
                return res.status(409).json({ error: 'governance_request_payload_mismatch' });
            }

            const currentCircle = await prisma.circle.findUnique({
                where: { id: circleId },
                select: {
                    minCrystals: true,
                },
            });
            if (!currentCircle) {
                return res.status(404).json({ error: 'circle_not_found' });
            }
            if (
                requestPayload.chainStatus === 'requires_wallet_finalization'
                && Number(currentCircle.minCrystals || 0) !== requestedMinCrystals
            ) {
                return res.status(409).json({ error: 'circle_min_crystals_projection_required' });
            }

            const updated = await prisma.circle.update({
                where: { id: circleId },
                data: {
                    joinRequirement,
                    circleType,
                    minCrystals: requestedMinCrystals,
                },
                select: {
                    id: true,
                    joinRequirement: true,
                    circleType: true,
                    minCrystals: true,
                },
            });
            await persistCircleSettingsEnvelopeSection(prisma, {
                circleId,
                actorUserId,
                section: buildStoredCircleSettingsEnvelopeSection({
                    settingKind: 'membership_policy',
                    payload: {
                        joinRequirement: updated.joinRequirement,
                        circleType: updated.circleType,
                        minCrystals: requestedMinCrystals,
                    },
                    actorPubkey,
                    signedMessage,
                    signature,
                    clientTimestamp: signedPayload.clientTimestamp,
                    nonce: signedPayload.nonce,
                    anchor: signedPayload.anchor ?? null,
                }),
            });
            if (typeof (redis as any)?.del === 'function') {
                await (redis as any).del(`circle:${circleId}`);
            }
            await recordExecutionReceipt(
                createPrismaGovernanceEngineStore(prisma as any),
                {
                    id: crypto.randomUUID(),
                    requestId: governanceRequestId,
                    actionType: CIRCLE_POLICY_MEMBERSHIP_UPDATE_ACTION_TYPE,
                    executorModule: 'circle_policy',
                    executionStatus: 'executed',
                    executionRef: String(circleId),
                    decisionDigest,
                    idempotencyKey: `${CIRCLE_POLICY_MEMBERSHIP_UPDATE_ACTION_TYPE}:${circleId}:wallet-finalized`,
                    executedAt: new Date(),
                },
            );

            return res.json({
                ok: true,
                status: 'executed',
                governanceRequestId,
                circleId,
                policy: toPolicyPayload(updated),
            });
        } catch (error) {
            if (sendAuthActorError(res, error)) return;
            next(error);
        }
    });

    // GET /api/v1/membership/circles/:id/join-requests
    router.get('/circles/:id/join-requests', async (req, res, next) => {
        try {
            const circleId = parseCircleId(req.params.id);
            if (!circleId) {
                return res.status(400).json({ error: 'invalid_circle_id' });
            }
            await requireMembershipManager(req, circleId, { allowModerator: true });

            const statusRaw = typeof req.query.status === 'string' ? req.query.status : '';
            const status = Object.values(CircleJoinRequestStatus).includes(statusRaw as CircleJoinRequestStatus)
                ? (statusRaw as CircleJoinRequestStatus)
                : CircleJoinRequestStatus.Pending;
            const limitRaw = Number(req.query.limit);
            const limit = Number.isFinite(limitRaw) && limitRaw > 0 ? Math.min(100, Math.floor(limitRaw)) : 30;

            const requests = await prisma.circleJoinRequest.findMany({
                where: {
                    circleId,
                    status,
                },
                orderBy: { createdAt: 'desc' },
                take: limit,
                include: {
                    user: {
                        select: {
                            id: true,
                            handle: true,
                            displayName: true,
                            avatarUri: true,
                        },
                    },
                },
            });

            return res.json({
                ok: true,
                circleId,
                status,
                requests,
            });
        } catch (error) {
            if (sendAuthActorError(res, error)) return;
            next(error);
        }
    });

    // GET /api/v1/membership/circles/:id/invites
    router.get('/circles/:id/invites', async (req, res, next) => {
        try {
            const circleId = parseCircleId(req.params.id);
            if (!circleId) {
                return res.status(400).json({ error: 'invalid_circle_id' });
            }
            await requireMembershipManager(req, circleId, { allowModerator: true });

            const statusRaw = typeof req.query.status === 'string' ? req.query.status : '';
            const status = Object.values(CircleInviteStatus).includes(statusRaw as CircleInviteStatus)
                ? (statusRaw as CircleInviteStatus)
                : CircleInviteStatus.Active;
            const limitRaw = Number(req.query.limit);
            const limit = Number.isFinite(limitRaw) && limitRaw > 0 ? Math.min(100, Math.floor(limitRaw)) : 30;

            const invites = await prisma.circleInvite.findMany({
                where: {
                    circleId,
                    status,
                },
                orderBy: { createdAt: 'desc' },
                take: limit,
            });

            return res.json({
                ok: true,
                circleId,
                status,
                invites,
            });
        } catch (error) {
            if (sendAuthActorError(res, error)) return;
            next(error);
        }
    });

    // Guard endpoint for other services to verify active membership quickly.
    router.get('/circles/:id/is-member', async (req, res, next) => {
        try {
            const circleId = parseCircleId(req.params.id);
            if (!circleId) {
                return res.status(400).json({ error: 'invalid_circle_id' });
            }
            const actor = await requireMembershipActor(req);
            let isMember = true;
            try {
                await requireCircleActorForAuthActor(actor, prisma, {
                    circleId,
                    action: 'public.read',
                    requireMemberChainPresence: false,
                });
            } catch (error) {
                if (error instanceof AuthActorError && error.code === 'circle_membership_required') {
                    isMember = false;
                } else {
                    throw error;
                }
            }
            const userId = actor.userId;
            return res.json({ ok: true, circleId, userId, isMember });
        } catch (error) {
            if (sendAuthActorError(res, error)) return;
            next(error);
        }
    });

    return router;
}
