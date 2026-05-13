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
    resolveUserCrystalBalance,
} from '../services/membership/engine';
import { issueMembershipAdmissionGrant } from '../services/membership/admission';
import {
    hasActiveCircleMembership,
    parseAuthUserIdFromRequest,
    requireCircleManagerRole,
    requireCircleOwnerRole,
} from '../services/membership/checks';
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
    normalizeManagedMemberRole,
    validateCircleMemberRemoval,
    validateCircleMemberRoleChange,
} from '../services/membership/governance';
import { verifyEd25519SignatureBase64 } from '../services/offchainDiscussion';
import {
    buildCircleSettingsSigningMessage,
    buildCircleSettingsSigningPayload,
    buildStoredCircleSettingsEnvelopeSection,
    isCircleSettingsSignatureFresh,
    parseCircleSettingsSignedMessage,
    persistCircleSettingsEnvelopeSection,
    resolveCircleSettingsActorUserId,
    resolveProjectedCircleSettings,
} from '../services/policy/settingsEnvelope';

function parseCircleId(raw: string): number | null {
    const parsed = Number(raw);
    if (!Number.isFinite(parsed) || parsed <= 0) return null;
    return parsed;
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
    prisma: PrismaClient,
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

            const userId = parseAuthUserIdFromRequest(req as any);
            if (!userId) {
                return res.json({
                    authenticated: false,
                    circleId,
                    policy: toPolicyPayload(projectedPolicy),
                    joinState: 'guest',
                    membership: null,
                    userCrystals: 0,
                    missingCrystals: Math.max(0, Number(projectedPolicy.minCrystals || 0)),
                });
            }

            const [user, membership, pendingRequest, approvedRequest, userCrystals] = await Promise.all([
                prisma.user.findUnique({
                    where: { id: userId },
                    select: {
                        id: true,
                        handle: true,
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
                resolveUserCrystalBalance(prisma, userId, circleId),
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
                userCrystals,
                hasActiveMembership: membership?.status === MemberStatus.Active,
                hasPendingRequest: !!pendingRequest,
                isBanned: membership?.status === MemberStatus.Banned,
                hasValidInvite: hasValidInvite || !!approvedRequest,
            });

            if (circle.creatorId === userId) {
                return res.json({
                    authenticated: true,
                    circleId,
                    policy: toPolicyPayload(projectedPolicy),
                    joinState: 'joined',
                    membership: buildCreatorMembershipPayload(circle.createdAt),
                    pendingRequest: null,
                    userCrystals: Math.max(0, userCrystals),
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
            const authUserId = parseAuthUserIdFromRequest(req as any);
            if (!authUserId) {
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

            const userId = parseAuthUserIdFromRequest(req as any);
            if (!userId) {
                return res.status(401).json({ error: 'authentication_required' });
            }

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

            const actor = await prisma.user.findUnique({
                where: { id: userId },
                select: {
                    id: true,
                    handle: true,
                    pubkey: true,
                },
            });
            if (!actor) {
                return res.status(401).json({ error: 'auth_user_not_found' });
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
            const [membership, pendingRequest, userCrystals] = await Promise.all([
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
                resolveUserCrystalBalance(prisma, userId, circleId),
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
                userCrystals,
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

            if (decision.state === 'insufficient_crystals') {
                return res.status(403).json({
                    error: 'insufficient_crystals',
                    joinState: decision.state,
                    minCrystals: decision.minCrystals,
                    userCrystals: decision.userCrystals,
                    missingCrystals: decision.missingCrystals,
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

            const userId = parseAuthUserIdFromRequest(req as any);
            if (!userId) {
                return res.status(401).json({ error: 'authentication_required' });
            }

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

            const actorUserId = parseAuthUserIdFromRequest(req as any);
            if (!actorUserId) {
                return res.status(401).json({ error: 'authentication_required' });
            }

            const canManage = await requireCircleManagerRole(prisma, {
                circleId,
                userId: actorUserId,
                allowModerator: true,
            });
            if (!canManage) {
                return res.status(403).json({ error: 'forbidden' });
            }

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

            const actorUserId = parseAuthUserIdFromRequest(req as any);
            if (!actorUserId) {
                return res.status(401).json({ error: 'authentication_required' });
            }

            const canManage = await requireCircleManagerRole(prisma, {
                circleId,
                userId: actorUserId,
                allowModerator: true,
            });
            if (!canManage) {
                return res.status(403).json({ error: 'forbidden' });
            }

            const inviteeHandle = typeof req.body?.inviteeHandle === 'string'
                ? req.body.inviteeHandle.trim()
                : '';
            const inviteeUserIdRaw = Number(req.body?.inviteeUserId);
            const inviteeUserId = Number.isFinite(inviteeUserIdRaw) && inviteeUserIdRaw > 0
                ? inviteeUserIdRaw
                : null;
            const expiresInHoursRaw = Number(req.body?.expiresInHours);
            const expiresInHours = Number.isFinite(expiresInHoursRaw) && expiresInHoursRaw > 0
                ? Math.min(24 * 30, Math.floor(expiresInHoursRaw))
                : 72;

            let resolvedInviteeUserId = inviteeUserId;
            if (!resolvedInviteeUserId && inviteeHandle) {
                const target = await prisma.user.findUnique({
                    where: { handle: inviteeHandle },
                    select: { id: true },
                });
                resolvedInviteeUserId = target?.id ?? null;
            }

            if (resolvedInviteeUserId) {
                const existingMembership = await prisma.circleMember.findUnique({
                    where: {
                        circleId_userId: {
                            circleId,
                            userId: resolvedInviteeUserId,
                        },
                    },
                    select: {
                        status: true,
                    },
                });
                if (existingMembership?.status === MemberStatus.Active) {
                    return res.status(409).json({ error: 'invitee_already_member' });
                }
            }

            const now = new Date();
            const inviteConflictOr: Prisma.CircleInviteWhereInput[] = [];
            if (resolvedInviteeUserId) {
                inviteConflictOr.push({ inviteeUserId: resolvedInviteeUserId });
            }
            if (inviteeHandle) {
                inviteConflictOr.push({ inviteeHandle });
            }
            if (inviteConflictOr.length > 0) {
                const existingInvite = await prisma.circleInvite.findFirst({
                    where: {
                        circleId,
                        status: CircleInviteStatus.Active,
                        AND: [
                            {
                                OR: inviteConflictOr,
                            },
                            {
                                OR: [
                                    { expiresAt: null },
                                    { expiresAt: { gt: now } },
                                ],
                            },
                        ],
                    },
                    select: {
                        id: true,
                    },
                });
                if (existingInvite) {
                    return res.status(409).json({ error: 'active_invite_exists' });
                }
            }

            const invite = await prisma.circleInvite.create({
                data: {
                    circleId,
                    inviterId: actorUserId,
                    inviteeUserId: resolvedInviteeUserId,
                    inviteeHandle: inviteeHandle || null,
                    code: randomInviteCode(),
                    status: CircleInviteStatus.Active,
                    note: typeof req.body?.note === 'string' ? req.body.note.trim() : null,
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

            await logMembershipEvent(prisma, {
                circleId,
                userId: resolvedInviteeUserId ?? actorUserId,
                actorUserId,
                eventType: CircleMembershipEventType.InviteCreated,
                inviteId: invite.id,
                metadata: {
                    inviteeHandle: invite.inviteeHandle,
                },
            });

            return res.json({
                ok: true,
                circleId,
                invite,
            });
        } catch (error) {
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

            const actorUserId = parseAuthUserIdFromRequest(req as any);
            if (!actorUserId) {
                return res.status(401).json({ error: 'authentication_required' });
            }

            const actorIsOwner = await requireCircleOwnerRole(prisma, {
                circleId,
                userId: actorUserId,
            });
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

            const actorUserId = parseAuthUserIdFromRequest(req as any);
            if (!actorUserId) {
                return res.status(401).json({ error: 'authentication_required' });
            }

            const actorIsOwner = await requireCircleOwnerRole(prisma, {
                circleId,
                userId: actorUserId,
            });

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

            return res.status(202).json(buildWalletFinalizationShim({
                circleId,
                userId: targetUserId,
                action: 'remove_member',
                currentRole: membership.role,
            }));
        } catch (error) {
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
            const currentCircle = await prisma.circle.findUnique({
                where: { id: circleId },
                select: {
                    joinRequirement: true,
                    circleType: true,
                    minCrystals: true,
                },
            });
            if (!currentCircle) {
                return res.status(404).json({ error: 'circle_not_found' });
            }
            const nextJoinRequirement = joinRequirement ?? currentCircle.joinRequirement;
            const nextCircleType = circleType ?? currentCircle.circleType;
            const currentMinCrystals = Number(currentCircle.minCrystals || 0);
            const hasMinCrystalsInput = Object.prototype.hasOwnProperty.call(req.body ?? {}, 'minCrystals');
            const requestedMinCrystals = hasMinCrystalsInput
                ? Math.max(0, Math.min(0xffff, Math.floor(Number(req.body.minCrystals))))
                : nextJoinRequirement === JoinRequirement.TokenGated
                    ? currentMinCrystals
                    : 0;
            if (!Number.isFinite(requestedMinCrystals)) {
                return res.status(400).json({ error: 'invalid_min_crystals' });
            }
            if (nextJoinRequirement === JoinRequirement.TokenGated && requestedMinCrystals < 1) {
                return res.status(400).json({ error: 'token_gate_min_crystals_required' });
            }
            if (nextJoinRequirement !== JoinRequirement.TokenGated && requestedMinCrystals !== 0) {
                return res.status(400).json({ error: 'min_crystals_requires_token_gate' });
            }
            if (requestedMinCrystals !== currentMinCrystals) {
                return res.status(409).json({
                    error: 'min_crystals_projection_mismatch',
                    expected: requestedMinCrystals,
                    actual: currentMinCrystals,
                });
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
                    joinRequirement: nextJoinRequirement,
                    circleType: nextCircleType,
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
            const actorUserId = await resolveCircleSettingsActorUserId(prisma, circleId, actorPubkey);
            if (!actorUserId) {
                return res.status(403).json({ error: 'forbidden' });
            }
            const canManage = await requireCircleManagerRole(prisma, {
                circleId,
                userId: actorUserId,
            });
            if (!canManage) {
                return res.status(403).json({ error: 'forbidden' });
            }

            const updated = await prisma.circle.update({
                where: { id: circleId },
                data: {
                    ...(joinRequirement ? { joinRequirement } : {}),
                    ...(circleType ? { circleType } : {}),
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

            return res.json({
                ok: true,
                circleId,
                policy: toPolicyPayload(updated),
            });
        } catch (error) {
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
            const actorUserId = parseAuthUserIdFromRequest(req as any);
            if (!actorUserId) {
                return res.status(401).json({ error: 'authentication_required' });
            }
            const canManage = await requireCircleManagerRole(prisma, {
                circleId,
                userId: actorUserId,
                allowModerator: true,
            });
            if (!canManage) {
                return res.status(403).json({ error: 'forbidden' });
            }

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
            const actorUserId = parseAuthUserIdFromRequest(req as any);
            if (!actorUserId) {
                return res.status(401).json({ error: 'authentication_required' });
            }
            const canManage = await requireCircleManagerRole(prisma, {
                circleId,
                userId: actorUserId,
                allowModerator: true,
            });
            if (!canManage) {
                return res.status(403).json({ error: 'forbidden' });
            }

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
            const userId = parseAuthUserIdFromRequest(req as any);
            if (!userId) {
                return res.status(401).json({ error: 'authentication_required' });
            }
            const isMember = await hasActiveCircleMembership(prisma, { circleId, userId });
            return res.json({ ok: true, circleId, userId, isMember });
        } catch (error) {
            next(error);
        }
    });

    return router;
}
