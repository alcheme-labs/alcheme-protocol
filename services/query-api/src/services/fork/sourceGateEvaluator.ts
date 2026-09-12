import {
    CircleInviteStatus,
    CircleJoinRequestStatus,
    CircleType,
    JoinRequirement,
    MemberStatus,
    type PrismaClient,
} from '@prisma/client';

import {
    evaluateMembershipJoinDecision,
    resolveCircleJoinPolicy,
} from '../membership/engine';
import { resolveProjectedCircleSettings } from '../policy/settingsEnvelope';
import { createPrismaForkContextStore } from './contextStore';
import type { ForkSourceGateSnapshot } from './contextTypes';

// Projection-only helper. Do not use this module as request authorization.
export type ForkReferenceExpansionMode = 'summary' | 'full_source';

export type ForkReferenceExpansionStatus =
    | 'allowed'
    | 'released_summary'
    | 'source_gate_required'
    | 'sealed'
    | 'revoked';

export interface ForkReferenceExpansionInput {
    targetCircleId: number;
    sourceCircleId: number;
    viewerUserId: number;
    sourceGateSnapshot: ForkSourceGateSnapshot;
    releaseId?: string | null;
    requestedMode: ForkReferenceExpansionMode;
}

export interface ForkReferenceExpansionDecision {
    allowed: boolean;
    status: ForkReferenceExpansionStatus;
    reason: string;
    canReadReleasedSummary: boolean;
    canExpandFullSource: boolean;
    sourceGateSnapshot: ForkSourceGateSnapshot;
    currentGate: {
        joinRequirement: string;
        circleType: string;
        minCrystals: number;
        userCrystals: number;
        membershipState: string;
    } | null;
}

interface SourceCircleRow {
    id: number;
    creatorId: number;
    joinRequirement: JoinRequirement;
    circleType: CircleType;
    minCrystals: number;
}

interface ViewerSourceFacts {
    sourceCircle: SourceCircleRow;
    isSourceCreator: boolean;
    hasActiveSourceMembership: boolean;
    hasPendingRequest: boolean;
    isBanned: boolean;
    hasValidSourceGrant: boolean;
}

function asPositiveInteger(value: unknown): number | null {
    const parsed = Number(value);
    return Number.isInteger(parsed) && parsed > 0 ? parsed : null;
}

function isActiveReleaseAudienceForSummary(value: string | null | undefined): boolean {
    return value === 'target_circle'
        || value === 'public'
        || value === 'summary_only'
        || value === 'full_source';
}

function releaseMatchesReference(
    input: ForkReferenceExpansionInput,
    release: {
        sourceCircleId: number;
        targetCircleId: number | null;
    },
): boolean {
    return release.sourceCircleId === input.sourceCircleId
        && (
            release.targetCircleId === null
            || release.targetCircleId === input.targetCircleId
        );
}

function isSourceGateSealed(snapshot: ForkSourceGateSnapshot): boolean {
    return snapshot.entitlementType === 'invite'
        || snapshot.joinRequirement === JoinRequirement.InviteOnly
        || snapshot.circleType === CircleType.Secret;
}

function isSourceGateCrystalBound(snapshot: ForkSourceGateSnapshot): boolean {
    return snapshot.entitlementType === 'crystal_balance'
        || Number(snapshot.requiredCrystalCount ?? 0) > 0;
}

function deniedDecision(
    input: ForkReferenceExpansionInput,
    status: Exclude<ForkReferenceExpansionStatus, 'allowed' | 'released_summary'>,
    reason: string,
    currentGate: ForkReferenceExpansionDecision['currentGate'] = null,
): ForkReferenceExpansionDecision {
    return {
        allowed: false,
        status,
        reason,
        canReadReleasedSummary: false,
        canExpandFullSource: false,
        sourceGateSnapshot: input.sourceGateSnapshot,
        currentGate,
    };
}

async function loadViewerSourceFacts(
    prisma: PrismaClient,
    input: ForkReferenceExpansionInput,
): Promise<ViewerSourceFacts> {
    const sourceCircle = await prisma.circle.findUnique({
        where: { id: input.sourceCircleId },
        select: {
            id: true,
            creatorId: true,
            joinRequirement: true,
            circleType: true,
            minCrystals: true,
        },
    }) as SourceCircleRow | null;
    if (!sourceCircle) {
        throw new Error('source_circle_not_found');
    }

    const [user, membership, pendingRequest, approvedRequest] = await Promise.all([
        prisma.user.findUnique({
            where: { id: input.viewerUserId },
            select: { handle: true },
        }),
        prisma.circleMember.findUnique({
            where: {
                circleId_userId: {
                    circleId: input.sourceCircleId,
                    userId: input.viewerUserId,
                },
            },
            select: { status: true },
        }),
        prisma.circleJoinRequest.findFirst({
            where: {
                circleId: input.sourceCircleId,
                userId: input.viewerUserId,
                status: CircleJoinRequestStatus.Pending,
            },
            orderBy: { createdAt: 'desc' },
            select: { id: true },
        }),
        prisma.circleJoinRequest.findFirst({
            where: {
                circleId: input.sourceCircleId,
                userId: input.viewerUserId,
                status: CircleJoinRequestStatus.Approved,
            },
            orderBy: { reviewedAt: 'desc' },
            select: { id: true },
        }),
    ]);

    const invite = await prisma.circleInvite.findFirst({
        where: {
            circleId: input.sourceCircleId,
            OR: [
                { status: CircleInviteStatus.Active, inviteeUserId: input.viewerUserId },
                ...(user?.handle
                    ? [{ status: CircleInviteStatus.Active, inviteeHandle: user.handle }]
                    : []),
                { status: CircleInviteStatus.Accepted, acceptedById: input.viewerUserId },
            ],
        },
        orderBy: { createdAt: 'desc' },
        select: {
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
                && invite.acceptedById === input.viewerUserId
            )
        )
    );

    return {
        sourceCircle,
        isSourceCreator: sourceCircle.creatorId === input.viewerUserId,
        hasActiveSourceMembership: membership?.status === MemberStatus.Active,
        hasPendingRequest: !!pendingRequest,
        isBanned: membership?.status === MemberStatus.Banned,
        hasValidSourceGrant: hasValidInvite || !!approvedRequest,
    };
}

function evaluateSnapshotGate(
    input: ForkReferenceExpansionInput,
    facts: ViewerSourceFacts,
): { allowed: boolean; status: Exclude<ForkReferenceExpansionStatus, 'allowed' | 'released_summary'>; reason: string } {
    if (facts.isSourceCreator) {
        return { allowed: true, status: 'source_gate_required', reason: 'source_creator' };
    }

    if (input.sourceGateSnapshot.entitlementType === 'none' && !isSourceGateSealed(input.sourceGateSnapshot)) {
        return { allowed: true, status: 'source_gate_required', reason: 'snapshot_public' };
    }

    if (isSourceGateSealed(input.sourceGateSnapshot)) {
        const hasSourceSideAccess = facts.hasActiveSourceMembership || facts.hasValidSourceGrant;
        return hasSourceSideAccess
            ? { allowed: true, status: 'sealed', reason: 'snapshot_invite_or_membership_satisfied' }
            : { allowed: false, status: 'sealed', reason: 'snapshot_invite_or_private_source_required' };
    }

    if (isSourceGateCrystalBound(input.sourceGateSnapshot)) {
        const hasSourceSideAccess = facts.hasActiveSourceMembership || facts.hasValidSourceGrant;
        return hasSourceSideAccess
            ? { allowed: true, status: 'source_gate_required', reason: 'snapshot_legacy_crystal_gate_migrated_to_source_grant' }
            : { allowed: false, status: 'source_gate_required', reason: 'snapshot_legacy_crystal_gate_requires_source_grant' };
    }

    if (
        input.sourceGateSnapshot.entitlementType === 'membership'
        || input.sourceGateSnapshot.entitlementType === 'manager_approval'
        || input.sourceGateSnapshot.entitlementType === 'governance_approval'
    ) {
        const hasSourceSideAccess = facts.hasActiveSourceMembership || facts.hasValidSourceGrant;
        return hasSourceSideAccess
            ? { allowed: true, status: 'source_gate_required', reason: 'snapshot_source_grant_satisfied' }
            : { allowed: false, status: 'source_gate_required', reason: 'snapshot_source_grant_required' };
    }

    return {
        allowed: false,
        status: 'source_gate_required',
        reason: 'snapshot_external_proof_not_supported',
    };
}

export async function evaluateForkReferenceExpansion(
    prisma: PrismaClient,
    input: ForkReferenceExpansionInput,
): Promise<ForkReferenceExpansionDecision> {
    const targetCircleId = asPositiveInteger(input.targetCircleId);
    const sourceCircleId = asPositiveInteger(input.sourceCircleId);
    const viewerUserId = asPositiveInteger(input.viewerUserId);
    if (!targetCircleId || !sourceCircleId || !viewerUserId) {
        throw new Error('invalid_fork_reference_expansion_input');
    }

    if (input.releaseId) {
        const release = await createPrismaForkContextStore(prisma).getActiveReleaseById(input.releaseId);
        if (
            input.requestedMode === 'summary'
            && release
            && releaseMatchesReference(input, release)
            && isActiveReleaseAudienceForSummary(release.releaseAudience)
        ) {
            return {
                allowed: true,
                status: 'released_summary',
                reason: 'active_release_summary',
                canReadReleasedSummary: true,
                canExpandFullSource: false,
                sourceGateSnapshot: input.sourceGateSnapshot,
                currentGate: null,
            };
        }
    }

    if (input.requestedMode === 'summary') {
        return deniedDecision(
            input,
            isSourceGateSealed(input.sourceGateSnapshot) ? 'sealed' : 'source_gate_required',
            'active_release_summary_required',
        );
    }

    const facts = await loadViewerSourceFacts(prisma, input);
    const projectedPolicy = await resolveProjectedCircleSettings(prisma, facts.sourceCircle);
    const policy = resolveCircleJoinPolicy(projectedPolicy);
    const membershipDecision = evaluateMembershipJoinDecision({
        policy,
        hasActiveMembership: facts.hasActiveSourceMembership,
        hasPendingRequest: facts.hasPendingRequest,
        isBanned: facts.isBanned,
        hasValidInvite: facts.hasValidSourceGrant,
    });
    const currentGate = {
        joinRequirement: policy.joinRequirement,
        circleType: policy.circleType,
        minCrystals: policy.minCrystals,
        userCrystals: membershipDecision.userCrystals,
        membershipState: facts.isSourceCreator ? 'source_creator' : membershipDecision.state,
    };

    const snapshotDecision = evaluateSnapshotGate(input, facts);
    if (!snapshotDecision.allowed) {
        return deniedDecision(input, snapshotDecision.status, snapshotDecision.reason, currentGate);
    }

    const currentAllowsExpansion = facts.isSourceCreator
        || membershipDecision.state === 'joined'
        || membershipDecision.state === 'can_join';
    if (!currentAllowsExpansion) {
        return deniedDecision(
            input,
            membershipDecision.state === 'invite_required' ? 'sealed' : 'source_gate_required',
            `current_source_${membershipDecision.state}`,
            currentGate,
        );
    }

    return {
        allowed: true,
        status: 'allowed',
        reason: 'snapshot_and_current_source_gate_satisfied',
        canReadReleasedSummary: false,
        canExpandFullSource: true,
        sourceGateSnapshot: input.sourceGateSnapshot,
        currentGate,
    };
}
