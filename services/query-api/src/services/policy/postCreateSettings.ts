import {
    CircleType,
    JoinRequirement,
    type PrismaClient,
} from '@prisma/client';
import type { Redis } from 'ioredis';
import { AuthActorError, requireCircleManagerActor } from '../auth/actor';
import { resolveCircleGhostSettings, upsertCircleGhostSettings } from '../../ai/ghost/circle-settings';
import {
    buildStoredCircleSettingsEnvelopeSection,
    ensureCircleSettingsEnvelopeStorage,
    loadCircleSettingsEnvelope,
    persistCirclePostCreateBootstrap,
    type CirclePostCreateSettingsPayload,
    type CircleSettingsGhostPayload,
} from './settingsEnvelope';
import { persistCircleSettingsEnvelopeSection } from './settingsEnvelope';
import {
    resolveCirclePolicyProfile,
    serializeCirclePolicyProfile,
    upsertCircleDraftLifecycleTemplate,
    upsertCircleDraftWorkflowPolicy,
} from './profile';
import { reconcileActiveDraftWorkflowStates } from '../draftLifecycle/workflowState';
import type {
    DraftLifecycleTemplatePatch,
    DraftWorkflowPolicyPatch,
} from './types';
import {
    CIRCLE_POLICY_GENESIS_UPDATE_ACTION_TYPE,
    CIRCLE_POLICY_GHOST_UPDATE_ACTION_TYPE,
    CIRCLE_POLICY_DRAFT_LIFECYCLE_UPDATE_ACTION_TYPE,
    CIRCLE_POLICY_MEMBERSHIP_UPDATE_ACTION_TYPE,
    CIRCLE_POLICY_METADATA_UPDATE_ACTION_TYPE,
    CIRCLE_POLICY_PROFILE_UPDATE_ACTION_TYPE,
    evaluateCirclePolicyGovernance,
    executeCirclePolicyDirectOperation,
} from '../governance/circlePolicyGovernance';
import { invalidateDiscussionTopicProfileCache } from '../discussion/topicProfile';

export interface CircleSettingsAuditContext {
    signedMessage: string;
    signature: string;
    clientTimestamp: string;
    nonce: string;
    anchor?: Record<string, unknown> | null;
}

export interface CircleSettingsActorContext {
    actorPubkey: string;
    actorUserId?: number | null;
}

export class CircleSettingsWriteError extends Error {
    constructor(
        public readonly statusCode: number,
        public readonly body: Record<string, unknown>,
    ) {
        super(String(body.error || 'circle_settings_write_failed'));
    }
}

const DEFAULT_POST_CREATE_BOOTSTRAP_WINDOW_MS = 24 * 60 * 60 * 1000;

function postCreateBootstrapWindowMs(): number {
    const configured = Number(process.env.CIRCLE_POST_CREATE_BOOTSTRAP_WINDOW_MS);
    return Number.isFinite(configured) && configured >= 60_000
        ? Math.floor(configured)
        : DEFAULT_POST_CREATE_BOOTSTRAP_WINDOW_MS;
}

function hasPostCreateSettingsFields(patch: CirclePostCreateSettingsPayload): boolean {
    return [
        'description',
        'ghostSettings',
        'genesisMode',
        'joinPolicy',
        'draftLifecycleTemplate',
        'draftWorkflowPolicy',
    ].some((field) => Object.prototype.hasOwnProperty.call(patch, field));
}

/**
 * Authorizes exactly one wallet-signed initialization batch for a new Circle.
 * The gate deliberately closes once any setting, member, or governance binding
 * exists; ordinary settings routes keep their normal governance requirements.
 */
export async function isCirclePostCreateBootstrapEligible(
    prisma: PrismaClient,
    input: {
        circleId: number;
        actorUserId: number | null | undefined;
        actorPubkey: string;
        patch: CirclePostCreateSettingsPayload;
        now?: Date;
    },
): Promise<boolean> {
    if (!hasPostCreateSettingsFields(input.patch) || typeof input.actorUserId !== 'number') {
        return false;
    }
    const client = prisma as any;
    if (
        typeof client.circle?.findUnique !== 'function'
        || typeof client.circleMember?.count !== 'function'
        || typeof client.circleGovernanceBinding?.findFirst !== 'function'
        || typeof client.governanceHomeIdentityBinding?.findUnique !== 'function'
    ) {
        return false;
    }
    const circle = await client.circle.findUnique({
        where: { id: input.circleId },
        select: {
            id: true,
            creatorId: true,
            creator: { select: { pubkey: true } },
            description: true,
            genesisMode: true,
            joinRequirement: true,
            circleType: true,
            minCrystals: true,
            createdAt: true,
        },
    });
    if (
        !circle
        || Number(circle.creatorId) !== input.actorUserId
        || String(circle.creator?.pubkey || '') !== input.actorPubkey
        || circle.description !== null
        || (circle.genesisMode !== null && circle.genesisMode !== 'BLANK')
        || circle.joinRequirement !== JoinRequirement.Free
        || circle.circleType !== CircleType.Open
        || Number(circle.minCrystals || 0) !== (
            input.patch.joinPolicy?.accessType === 'crystal'
                ? Math.max(1, Math.min(0xffff, Math.floor(Number(input.patch.joinPolicy.minCrystals || 1))))
                : 0
        )
    ) {
        return false;
    }
    const createdAt = new Date(circle.createdAt).getTime();
    const now = (input.now ?? new Date(Date.now())).getTime();
    if (!Number.isFinite(createdAt) || now < createdAt || now - createdAt > postCreateBootstrapWindowMs()) {
        return false;
    }
    const [otherActiveMembers, existingBinding, home, envelope] = await Promise.all([
        client.circleMember.count({
            where: {
                circleId: input.circleId,
                status: 'Active',
                userId: { not: input.actorUserId },
            },
        }),
        client.circleGovernanceBinding.findFirst({
            where: { targetCircleId: input.circleId },
            select: { id: true },
        }),
        client.governanceHomeIdentityBinding.findUnique({
            where: { id: `governance-home-circle-${input.circleId}-v1` },
            include: { activationState: true },
        }),
        loadCircleSettingsEnvelope(prisma, input.circleId),
    ]);
    if (
        Number(otherActiveMembers) !== 0
        || existingBinding
        || !home
        || home.homeType !== 'circle'
        || String(home.homeRef) !== String(input.circleId)
        || home.status !== 'inactive'
        || home.activationState?.state !== 'bootstrap_pending'
        || envelope?.postCreateBootstrap
        || Object.keys(envelope?.sections ?? {}).length > 0
    ) {
        return false;
    }
    return true;
}

export async function authorizeCircleSettingsWrite(
    req: unknown,
    prisma: PrismaClient,
    input: {
        circleId: number;
        actorPubkey: string;
    },
): Promise<CircleSettingsActorContext> {
    const actor = await requireCircleManagerActor(req, prisma as any, {
        circleId: input.circleId,
        requireSessionCookie: true,
    });
    if (actor.pubkey !== input.actorPubkey) {
        throw new AuthActorError(
            403,
            'actor_pubkey_mismatch',
            'actorPubkey must match authenticated session actor',
            'actor_pubkey_mismatch',
            true,
        );
    }
    return {
        actorPubkey: actor.pubkey,
        actorUserId: actor.userId,
    };
}

function normalizeMinCrystals(value: unknown): number {
    const parsed = Number(value ?? 0);
    return Number.isFinite(parsed)
        ? Math.max(0, Math.min(0xffff, Math.floor(parsed)))
        : Number.NaN;
}

function mapAccessTypeToPolicy(accessType: string): {
    joinRequirement: JoinRequirement;
    circleType: CircleType;
} | null {
    if (accessType === 'free') {
        return {
            joinRequirement: JoinRequirement.Free,
            circleType: CircleType.Open,
        };
    }
    if (accessType === 'crystal') {
        return {
            joinRequirement: JoinRequirement.TokenGated,
            circleType: CircleType.Open,
        };
    }
    if (accessType === 'invite') {
        return {
            joinRequirement: JoinRequirement.InviteOnly,
            circleType: CircleType.Closed,
        };
    }
    if (accessType === 'approval') {
        return {
            joinRequirement: JoinRequirement.ApprovalRequired,
            circleType: CircleType.Closed,
        };
    }
    return null;
}

export async function applyCircleMetadataSetting(
    prisma: PrismaClient,
    redis: Redis | null,
    input: CircleSettingsActorContext & {
        circleId: number;
        description: string | null;
        audit: CircleSettingsAuditContext;
        deferCacheInvalidation?: boolean;
    },
): Promise<{
    id: number;
    name: string;
    description: string | null;
}> {
    const updated = await prisma.circle.update({
        where: { id: input.circleId },
        data: { description: input.description },
        select: {
            id: true,
            name: true,
            description: true,
        },
    });

    await persistCircleSettingsEnvelopeSection(prisma, {
        circleId: input.circleId,
        actorUserId: input.actorUserId ?? null,
        section: buildStoredCircleSettingsEnvelopeSection({
            settingKind: 'circle_metadata',
            payload: {
                description: updated.description,
            },
            actorPubkey: input.actorPubkey,
            signedMessage: input.audit.signedMessage,
            signature: input.audit.signature,
            clientTimestamp: input.audit.clientTimestamp,
            nonce: input.audit.nonce,
            anchor: input.audit.anchor ?? null,
        }),
    });

    if (!input.deferCacheInvalidation) {
        await invalidateCircleMetadataSettingCaches(redis, input.circleId);
    }
    return updated;
}

export async function invalidateCircleMetadataSettingCaches(
    redis: Redis | null,
    circleId: number,
): Promise<void> {
    if (typeof (redis as any)?.del === 'function') {
        await (redis as any).del(`circle:${circleId}`);
    }
    invalidateDiscussionTopicProfileCache(circleId);
}

export async function applyCircleGhostSetting(
    prisma: PrismaClient,
    input: CircleSettingsActorContext & {
        circleId: number;
        patch: CircleSettingsGhostPayload;
        audit: CircleSettingsAuditContext;
        ghostConfig: unknown;
    },
): Promise<Record<string, unknown>> {
    const savedPatch = await upsertCircleGhostSettings(prisma, input.circleId, input.patch as any);
    const effective = resolveCircleGhostSettings(input.ghostConfig as any, savedPatch);
    await persistCircleSettingsEnvelopeSection(prisma, {
        circleId: input.circleId,
        actorUserId: input.actorUserId ?? null,
        section: buildStoredCircleSettingsEnvelopeSection({
            settingKind: 'ghost_settings',
            payload: effective as unknown as Record<string, unknown>,
            actorPubkey: input.actorPubkey,
            signedMessage: input.audit.signedMessage,
            signature: input.audit.signature,
            clientTimestamp: input.audit.clientTimestamp,
            nonce: input.audit.nonce,
            anchor: input.audit.anchor ?? null,
        }),
    });
    return effective as unknown as Record<string, unknown>;
}

export async function applyCircleGenesisSetting(
    prisma: PrismaClient,
    input: CircleSettingsActorContext & {
        circleId: number;
        genesisMode: 'BLANK' | 'SEEDED';
        audit: CircleSettingsAuditContext;
    },
): Promise<{ id: number; genesisMode: string | null }> {
    const updated = await prisma.circle.update({
        where: { id: input.circleId },
        data: { genesisMode: input.genesisMode },
        select: { id: true, genesisMode: true },
    });
    await persistCircleSettingsEnvelopeSection(prisma, {
        circleId: input.circleId,
        actorUserId: input.actorUserId ?? null,
        section: buildStoredCircleSettingsEnvelopeSection({
            settingKind: 'genesis_mode',
            payload: {
                genesisMode: updated.genesisMode,
            },
            actorPubkey: input.actorPubkey,
            signedMessage: input.audit.signedMessage,
            signature: input.audit.signature,
            clientTimestamp: input.audit.clientTimestamp,
            nonce: input.audit.nonce,
            anchor: input.audit.anchor ?? null,
        }),
    });
    return updated;
}

export interface ResolvedMembershipPolicySetting {
    joinRequirement: JoinRequirement;
    circleType: CircleType;
    minCrystals: number;
    currentMinCrystals: number;
}

export async function resolveMembershipPolicySetting(
    prisma: PrismaClient,
    input: {
        circleId: number;
        accessType?: 'free' | 'crystal' | 'invite' | 'approval';
        joinRequirement?: JoinRequirement | null;
        circleType?: CircleType | null;
        minCrystals?: number;
    },
): Promise<ResolvedMembershipPolicySetting> {
    const currentCircle = await prisma.circle.findUnique({
        where: { id: input.circleId },
        select: {
            joinRequirement: true,
            circleType: true,
            minCrystals: true,
        },
    });
    if (!currentCircle) {
        throw new CircleSettingsWriteError(404, { error: 'circle_not_found' });
    }
    const mappedByAccessType = input.accessType
        ? mapAccessTypeToPolicy(input.accessType)
        : null;
    const nextJoinRequirement = mappedByAccessType?.joinRequirement
        ?? input.joinRequirement
        ?? currentCircle.joinRequirement;
    const nextCircleType = mappedByAccessType?.circleType
        ?? input.circleType
        ?? currentCircle.circleType;
    const currentMinCrystals = Number(currentCircle.minCrystals || 0);
    const requestedMinCrystals = Object.prototype.hasOwnProperty.call(input, 'minCrystals')
        ? normalizeMinCrystals(input.minCrystals)
        : nextJoinRequirement === JoinRequirement.TokenGated
            ? currentMinCrystals
            : 0;
    if (!Number.isFinite(requestedMinCrystals)) {
        throw new CircleSettingsWriteError(400, { error: 'invalid_min_crystals' });
    }
    if (nextJoinRequirement === JoinRequirement.TokenGated && requestedMinCrystals < 1) {
        throw new CircleSettingsWriteError(400, { error: 'token_gate_min_crystals_required' });
    }
    if (nextJoinRequirement !== JoinRequirement.TokenGated && requestedMinCrystals !== 0) {
        throw new CircleSettingsWriteError(400, { error: 'min_crystals_requires_token_gate' });
    }
    return {
        joinRequirement: nextJoinRequirement,
        circleType: nextCircleType,
        minCrystals: requestedMinCrystals,
        currentMinCrystals,
    };
}

export function buildMembershipPolicyGovernancePayload(input: ResolvedMembershipPolicySetting) {
    return {
        joinRequirement: input.joinRequirement,
        circleType: input.circleType,
        minCrystals: input.minCrystals,
        settingKind: 'membership_policy',
        executionDomain: input.minCrystals !== input.currentMinCrystals ? 'hybrid' : 'off_chain',
        chainStatus: input.minCrystals !== input.currentMinCrystals ? 'requires_wallet_finalization' : 'not_required',
    };
}

export async function applyCircleMembershipPolicySetting(
    prisma: PrismaClient,
    redis: Redis | null,
    input: CircleSettingsActorContext & {
        circleId: number;
        policy: ResolvedMembershipPolicySetting;
        audit: CircleSettingsAuditContext;
        deferCacheInvalidation?: boolean;
    },
): Promise<{
    id: number;
    joinRequirement: JoinRequirement;
    circleType: CircleType;
    minCrystals: number;
}> {
    const updated = await prisma.circle.update({
        where: { id: input.circleId },
        data: {
            joinRequirement: input.policy.joinRequirement,
            circleType: input.policy.circleType,
            minCrystals: input.policy.minCrystals,
        },
        select: {
            id: true,
            joinRequirement: true,
            circleType: true,
            minCrystals: true,
        },
    });
    await persistCircleSettingsEnvelopeSection(prisma, {
        circleId: input.circleId,
        actorUserId: input.actorUserId ?? null,
        section: buildStoredCircleSettingsEnvelopeSection({
            settingKind: 'membership_policy',
            payload: {
                joinRequirement: updated.joinRequirement,
                circleType: updated.circleType,
                minCrystals: input.policy.minCrystals,
            },
            actorPubkey: input.actorPubkey,
            signedMessage: input.audit.signedMessage,
            signature: input.audit.signature,
            clientTimestamp: input.audit.clientTimestamp,
            nonce: input.audit.nonce,
            anchor: input.audit.anchor ?? null,
        }),
    });
    if (!input.deferCacheInvalidation && typeof (redis as any)?.del === 'function') {
        await (redis as any).del(`circle:${input.circleId}`);
    }
    return updated;
}

export async function applyCirclePolicyProfileSetting(
    prisma: PrismaClient,
    input: CircleSettingsActorContext & {
        circleId: number;
        lifecyclePatch?: DraftLifecycleTemplatePatch | null;
        workflowPatch?: DraftWorkflowPolicyPatch | null;
        audit: CircleSettingsAuditContext;
    },
) {
    const actorUserId = input.actorUserId;
    if (typeof actorUserId !== 'number') {
        throw new CircleSettingsWriteError(403, { error: 'circle_settings_actor_user_required' });
    }
    let profile = await resolveCirclePolicyProfile(prisma, input.circleId);
    if (input.lifecyclePatch) {
        profile = await upsertCircleDraftLifecycleTemplate(prisma, {
            circleId: input.circleId,
            actorUserId,
            patch: input.lifecyclePatch,
        });
        await reconcileActiveDraftWorkflowStates(prisma, {
            circleId: input.circleId,
            template: profile.draftLifecycleTemplate,
            now: new Date(),
        });
    }
    if (input.workflowPatch) {
        profile = await upsertCircleDraftWorkflowPolicy(prisma, {
            circleId: input.circleId,
            actorUserId,
            patch: input.workflowPatch,
        });
    }
    await persistCircleSettingsEnvelopeSection(prisma, {
        circleId: input.circleId,
        actorUserId: input.actorUserId ?? null,
        section: buildStoredCircleSettingsEnvelopeSection({
            settingKind: 'policy_profile',
            payload: {
                draftLifecycleTemplate: profile.draftLifecycleTemplate,
                draftWorkflowPolicy: profile.draftWorkflowPolicy,
                forkPolicy: profile.forkPolicy,
            },
            actorPubkey: input.actorPubkey,
            signedMessage: input.audit.signedMessage,
            signature: input.audit.signature,
            clientTimestamp: input.audit.clientTimestamp,
            nonce: input.audit.nonce,
            anchor: input.audit.anchor ?? null,
        }),
    });
    return profile;
}

function firstGovernanceResponse(governance: Awaited<ReturnType<typeof evaluateCirclePolicyGovernance>>) {
    if (governance.status === 'requires_governance') {
        return {
            statusCode: 202,
            body: {
                ...governance,
                appliedFields: [],
            },
        };
    }
    if (governance.status === 'denied') {
        return {
            statusCode: 403,
            body: {
                error: governance.error,
                appliedFields: [],
            },
        };
    }
    return null;
}

async function runPostCreateSettingsWriteTransaction<T>(
    prisma: PrismaClient,
    write: (client: PrismaClient) => Promise<T>,
): Promise<T> {
    const transaction = (prisma as any).$transaction;
    if (typeof transaction !== 'function') {
        return write(prisma);
    }
    return transaction.call(prisma, async (tx: PrismaClient) => write(tx));
}

async function invalidatePostCreateSettingsCaches(
    redis: Redis | null,
    input: {
        circleId: number;
        circleCache: boolean;
        discussionTopicProfile: boolean;
    },
): Promise<void> {
    if (input.circleCache && typeof (redis as any)?.del === 'function') {
        await (redis as any).del(`circle:${input.circleId}`);
    }
    if (input.discussionTopicProfile) {
        invalidateDiscussionTopicProfileCache(input.circleId);
    }
}

export async function applyCirclePostCreateSettings(
    prisma: PrismaClient,
    redis: Redis | null,
    input: {
        req: unknown;
        circleId: number;
        actorPubkey: string;
        patch: CirclePostCreateSettingsPayload;
        audit: CircleSettingsAuditContext;
        ghostConfig: unknown;
    },
): Promise<{
    statusCode: number;
    body: Record<string, unknown>;
}> {
    const actor = await authorizeCircleSettingsWrite(input.req, prisma, {
        circleId: input.circleId,
        actorPubkey: input.actorPubkey,
    });
    const initialBootstrapEligible = await isCirclePostCreateBootstrapEligible(prisma, {
        circleId: input.circleId,
        actorUserId: actor.actorUserId,
        actorPubkey: input.actorPubkey,
        patch: input.patch,
    });
    const appliedFields: string[] = [];
    const details: Record<string, unknown> = {};
    const governanceResponses: Array<{ statusCode: number; body: Record<string, unknown> }> = [];

    let membershipPolicy: ResolvedMembershipPolicySetting | null = null;
    let metadataDirectPayload: Record<string, unknown> | null = null;
    if (Object.prototype.hasOwnProperty.call(input.patch, 'description')) {
        const description = input.patch.description ?? null;
        metadataDirectPayload = {
            description,
            settingKind: 'circle_metadata',
            signedMessage: input.audit.signedMessage,
            signature: input.audit.signature,
            clientTimestamp: input.audit.clientTimestamp,
            nonce: input.audit.nonce,
            anchor: input.audit.anchor ?? null,
            executionDomain: 'off_chain',
            chainStatus: 'not_required',
        };
        const governance = initialBootstrapEligible ? null : await evaluateCirclePolicyGovernance(prisma, {
            circleId: input.circleId,
            actionType: CIRCLE_POLICY_METADATA_UPDATE_ACTION_TYPE,
            actorPubkey: input.actorPubkey,
            directAllowed: true,
            payload: metadataDirectPayload,
        });
        const response = governance ? firstGovernanceResponse(governance) : null;
        if (response) governanceResponses.push(response);
    }

    if (input.patch.ghostSettings) {
        const governance = initialBootstrapEligible ? null : await evaluateCirclePolicyGovernance(prisma, {
            circleId: input.circleId,
            actionType: CIRCLE_POLICY_GHOST_UPDATE_ACTION_TYPE,
            actorPubkey: input.actorPubkey,
            directAllowed: true,
            payload: {
                ...input.patch.ghostSettings,
                settingKind: 'ghost_settings',
                executionDomain: 'off_chain',
                chainStatus: 'not_required',
            },
        });
        const response = governance ? firstGovernanceResponse(governance) : null;
        if (response) governanceResponses.push(response);
    }

    if (input.patch.genesisMode) {
        const governance = initialBootstrapEligible ? null : await evaluateCirclePolicyGovernance(prisma, {
            circleId: input.circleId,
            actionType: CIRCLE_POLICY_GENESIS_UPDATE_ACTION_TYPE,
            actorPubkey: input.actorPubkey,
            directAllowed: true,
            payload: {
                genesisMode: input.patch.genesisMode,
                settingKind: 'genesis_mode',
                executionDomain: 'off_chain',
                chainStatus: 'not_required',
            },
        });
        const response = governance ? firstGovernanceResponse(governance) : null;
        if (response) governanceResponses.push(response);
    }

    if (input.patch.joinPolicy) {
        const membershipPolicyInput: {
            circleId: number;
            accessType?: 'free' | 'crystal' | 'invite' | 'approval';
            minCrystals?: number;
        } = {
            circleId: input.circleId,
            accessType: input.patch.joinPolicy.accessType,
        };
        if (Object.prototype.hasOwnProperty.call(input.patch.joinPolicy, 'minCrystals')) {
            membershipPolicyInput.minCrystals = input.patch.joinPolicy.minCrystals;
        }
        membershipPolicy = await resolveMembershipPolicySetting(prisma, membershipPolicyInput);
        const governance = initialBootstrapEligible ? null : await evaluateCirclePolicyGovernance(prisma, {
            circleId: input.circleId,
            actionType: CIRCLE_POLICY_MEMBERSHIP_UPDATE_ACTION_TYPE,
            actorPubkey: input.actorPubkey,
            directAllowed: true,
            payload: buildMembershipPolicyGovernancePayload(membershipPolicy),
        });
        const response = governance ? firstGovernanceResponse(governance) : null;
        if (response) governanceResponses.push(response);
    }

    const lifecycleOnlyPatch = Boolean(
        input.patch.draftLifecycleTemplate && !input.patch.draftWorkflowPolicy,
    );
    if (input.patch.draftLifecycleTemplate || input.patch.draftWorkflowPolicy) {
        const actionType = lifecycleOnlyPatch
            ? CIRCLE_POLICY_DRAFT_LIFECYCLE_UPDATE_ACTION_TYPE
            : CIRCLE_POLICY_PROFILE_UPDATE_ACTION_TYPE;
        const governance = initialBootstrapEligible ? null : await evaluateCirclePolicyGovernance(prisma, {
            circleId: input.circleId,
            actionType,
            actorPubkey: input.actorPubkey,
            directAllowed: lifecycleOnlyPatch,
            payload: {
                ...(input.patch.draftLifecycleTemplate
                    ? { draftLifecycleTemplate: input.patch.draftLifecycleTemplate }
                    : {}),
                ...(input.patch.draftWorkflowPolicy
                    ? { draftWorkflowPolicy: input.patch.draftWorkflowPolicy }
                    : {}),
                settingKind: 'policy_profile',
                executionDomain: 'off_chain',
                chainStatus: 'not_required',
            },
        });
        const response = governance ? firstGovernanceResponse(governance) : null;
        if (response) governanceResponses.push(response);
    }

    if (governanceResponses.length > 0) {
        return governanceResponses[0];
    }

    const deferredInvalidation = {
        circleCache: false,
        discussionTopicProfile: false,
    };
    await ensureCircleSettingsEnvelopeStorage(prisma);
    await runPostCreateSettingsWriteTransaction(prisma, async (writeClient) => {
        if (initialBootstrapEligible) {
            const lock = (writeClient as any).$executeRawUnsafe;
            if (typeof lock !== 'function') {
                throw new CircleSettingsWriteError(503, {
                    error: 'circle_post_create_bootstrap_transaction_lock_required',
                });
            }
            await lock.call(
                writeClient,
                'SELECT pg_advisory_xact_lock(hashtext($1))',
                `circle-post-create-bootstrap:${input.circleId}`,
            );
            const stillEligible = await isCirclePostCreateBootstrapEligible(writeClient, {
                circleId: input.circleId,
                actorUserId: actor.actorUserId,
                actorPubkey: input.actorPubkey,
                patch: input.patch,
            });
            if (!stillEligible) {
                throw new CircleSettingsWriteError(409, {
                    error: 'circle_post_create_bootstrap_no_longer_available',
                });
            }

            if (metadataDirectPayload) {
                details.metadata = await applyCircleMetadataSetting(writeClient, redis, {
                    ...actor,
                    circleId: input.circleId,
                    description: input.patch.description ?? null,
                    audit: input.audit,
                    deferCacheInvalidation: true,
                });
                deferredInvalidation.circleCache = true;
                deferredInvalidation.discussionTopicProfile = true;
                appliedFields.push('description');
            }
            if (input.patch.ghostSettings) {
                details.ghostSettings = await applyCircleGhostSetting(writeClient, {
                    ...actor,
                    circleId: input.circleId,
                    patch: input.patch.ghostSettings,
                    audit: input.audit,
                    ghostConfig: input.ghostConfig,
                });
                appliedFields.push('ghostSettings');
            }
            if (input.patch.genesisMode) {
                const genesis = await applyCircleGenesisSetting(writeClient, {
                    ...actor,
                    circleId: input.circleId,
                    genesisMode: input.patch.genesisMode,
                    audit: input.audit,
                });
                details.genesisMode = genesis.genesisMode;
                appliedFields.push('genesisMode');
            }
            if (membershipPolicy) {
                details.joinPolicy = await applyCircleMembershipPolicySetting(writeClient, redis, {
                    ...actor,
                    circleId: input.circleId,
                    policy: membershipPolicy,
                    audit: input.audit,
                    deferCacheInvalidation: true,
                });
                deferredInvalidation.circleCache = true;
                appliedFields.push('joinPolicy');
            }
            if (input.patch.draftLifecycleTemplate || input.patch.draftWorkflowPolicy) {
                details.policyProfile = serializeCirclePolicyProfile(await applyCirclePolicyProfileSetting(writeClient, {
                    ...actor,
                    circleId: input.circleId,
                    lifecyclePatch: input.patch.draftLifecycleTemplate
                        ? input.patch.draftLifecycleTemplate as DraftLifecycleTemplatePatch
                        : null,
                    workflowPatch: input.patch.draftWorkflowPolicy
                        ? input.patch.draftWorkflowPolicy as DraftWorkflowPolicyPatch
                        : null,
                    audit: input.audit,
                }));
                if (input.patch.draftLifecycleTemplate) appliedFields.push('draftLifecycleTemplate');
                if (input.patch.draftWorkflowPolicy) appliedFields.push('draftWorkflowPolicy');
            }
            details.postCreateBootstrap = await persistCirclePostCreateBootstrap(writeClient, {
                circleId: input.circleId,
                actorUserId: actor.actorUserId,
                audit: {
                    actorPubkey: input.actorPubkey,
                    ...input.audit,
                },
            });
            return;
        }

        if (metadataDirectPayload) {
            const operation = await executeCirclePolicyDirectOperation(writeClient, {
                circleId: input.circleId,
                actionType: CIRCLE_POLICY_METADATA_UPDATE_ACTION_TYPE,
                actorPubkey: input.actorPubkey,
                payload: metadataDirectPayload,
                reasonCode: 'circle_manager_wallet_signed_metadata_update',
                idempotencyKey: `${CIRCLE_POLICY_METADATA_UPDATE_ACTION_TYPE}:${input.circleId}:${input.audit.nonce}`,
                transactionClient: true,
                execute: async (client) => ({
                    result: await applyCircleMetadataSetting(client, redis, {
                        ...actor,
                        circleId: input.circleId,
                        description: input.patch.description ?? null,
                        audit: input.audit,
                        deferCacheInvalidation: true,
                    }),
                    executionRef: `circle:${input.circleId}:metadata`,
                }),
                readback: async (client) => {
                    const current = await client.circle.findUnique({
                        where: { id: input.circleId },
                        select: { id: true, name: true, description: true },
                    });
                    if (!current) throw new Error('circle_metadata_readback_missing');
                    return current;
                },
            });
            deferredInvalidation.circleCache = true;
            deferredInvalidation.discussionTopicProfile = true;
            appliedFields.push('description');
            details.metadata = operation.result;
            details.metadataOperationReceipt = operation.receipt;
        }

        if (input.patch.ghostSettings) {
            const settings = await applyCircleGhostSetting(writeClient, {
                ...actor,
                circleId: input.circleId,
                patch: input.patch.ghostSettings,
                audit: input.audit,
                ghostConfig: input.ghostConfig,
            });
            appliedFields.push('ghostSettings');
            details.ghostSettings = settings;
        }

        if (input.patch.genesisMode) {
            const genesis = await applyCircleGenesisSetting(writeClient, {
                ...actor,
                circleId: input.circleId,
                genesisMode: input.patch.genesisMode,
                audit: input.audit,
            });
            appliedFields.push('genesisMode');
            details.genesisMode = genesis.genesisMode;
        }

        if (membershipPolicy) {
            const policy = await applyCircleMembershipPolicySetting(writeClient, redis, {
                ...actor,
                circleId: input.circleId,
                policy: membershipPolicy,
                audit: input.audit,
                deferCacheInvalidation: true,
            });
            deferredInvalidation.circleCache = true;
            appliedFields.push('joinPolicy');
            details.joinPolicy = policy;
        }

        if (input.patch.draftLifecycleTemplate || input.patch.draftWorkflowPolicy) {
            if (!lifecycleOnlyPatch) {
                throw new CircleSettingsWriteError(409, {
                    error: 'circle_policy_profile_governance_required',
                });
            }
            const lifecyclePatch = input.patch.draftLifecycleTemplate as DraftLifecycleTemplatePatch;
            const governancePayload = {
                draftLifecycleTemplate: lifecyclePatch,
                settingKind: 'policy_profile',
                executionDomain: 'off_chain',
                chainStatus: 'not_required',
            };
            const operation = await executeCirclePolicyDirectOperation(writeClient, {
                circleId: input.circleId,
                actionType: CIRCLE_POLICY_DRAFT_LIFECYCLE_UPDATE_ACTION_TYPE,
                actorPubkey: input.actorPubkey,
                payload: governancePayload,
                reasonCode: 'circle_manager_wallet_signed_draft_lifecycle_update',
                idempotencyKey: `${CIRCLE_POLICY_DRAFT_LIFECYCLE_UPDATE_ACTION_TYPE}:${input.circleId}:${input.audit.nonce}`,
                transactionClient: true,
                execute: async (client) => ({
                    result: serializeCirclePolicyProfile(await applyCirclePolicyProfileSetting(client, {
                        ...actor,
                        circleId: input.circleId,
                        lifecyclePatch,
                        audit: input.audit,
                    })),
                    executionRef: `circle:${input.circleId}:policy-profile`,
                }),
                readback: async (client) => serializeCirclePolicyProfile(
                    await resolveCirclePolicyProfile(client, input.circleId),
                ),
            });
            appliedFields.push('draftLifecycleTemplate');
            details.policyProfile = operation.result;
            details.policyProfileOperationReceipt = operation.receipt;
        }
    });
    await invalidatePostCreateSettingsCaches(redis, {
        circleId: input.circleId,
        ...deferredInvalidation,
    });

    return {
        statusCode: 200,
        body: {
            ok: true,
            circleId: input.circleId,
            appliedFields,
            details,
        },
    };
}
