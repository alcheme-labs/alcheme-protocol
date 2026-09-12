'use client';

import type { Alcheme } from '@alcheme/sdk';
import { PublicKey } from '@solana/web3.js';
import { resolveNodeRoute } from './nodeRouting.ts';
import { authenticatedApiFetchJson } from './fetch.ts';
import { waitForIndexedSlot, waitForSignatureSlot } from './sync.ts';
import {
    signCircleSettingsEnvelope,
    type CircleSettingsEnvelopeAuth,
    normalizeMembershipPolicyEnvelopePayload,
} from '../circles/settingsEnvelope.ts';
import {
    getBrowserOnlyMockUnsupportedError,
    isBrowserOnlyMockWallet,
} from '../testing/browserOnlyMockPolicy.ts';
import type { AppLocale } from '../../i18n/config.ts';

type FetchLike = typeof fetch;

interface MembershipApiRequestOptions {
    fetchImpl?: FetchLike;
    locale?: AppLocale;
}

export type CircleType = 'Open' | 'Closed' | 'Secret';
export type JoinRequirement = 'Free' | 'ApprovalRequired' | 'TokenGated' | 'InviteOnly';

export type CircleJoinState =
    | 'joined'
    | 'can_join'
    | 'approval_required'
    | 'invite_required'
    | 'insufficient_crystals'
    | 'pending'
    | 'banned'
    | 'left'
    | 'guest';

export interface CircleMembershipPolicy {
    joinRequirement: JoinRequirement;
    circleType: CircleType;
    minCrystals: number;
    requiresApproval: boolean;
    requiresInvite: boolean;
}

export interface CircleMembershipView {
    role: 'Owner' | 'Admin' | 'Moderator' | 'Member';
    status: 'Active' | 'Banned' | 'Left';
    identityLevel: 'Visitor' | 'Initiate' | 'Member' | 'Elder';
    joinedAt: string;
}

export interface CircleMembershipSnapshot {
    authenticated: boolean;
    circleId: number;
    policy: CircleMembershipPolicy;
    joinState: CircleJoinState;
    membership: CircleMembershipView | null;
    pendingRequest?: {
        id: number;
        status: 'Pending';
        createdAt: string;
    } | null;
    userCrystals: number;
    missingCrystals: number;
}

export type CircleIdentityMessagingMode = 'dust_only' | 'formal';

export interface CircleIdentityThresholds {
    initiateMessages: number;
    memberCitations: number;
    elderPercentile: number;
    inactivityDays: number;
}

export interface CircleIdentityStatus {
    authenticated: boolean;
    circleId: number;
    currentLevel: 'Visitor' | 'Initiate' | 'Member' | 'Elder';
    nextLevel: 'Visitor' | 'Initiate' | 'Member' | 'Elder' | null;
    messagingMode: CircleIdentityMessagingMode;
    hint: string;
    thresholds: CircleIdentityThresholds;
    transition?: {
        from: 'Visitor' | 'Initiate' | 'Member' | 'Elder';
        to: 'Visitor' | 'Initiate' | 'Member' | 'Elder';
        reason: string | null;
    } | null;
    recentTransition?: {
        from: 'Visitor' | 'Initiate' | 'Member' | 'Elder';
        to: 'Visitor' | 'Initiate' | 'Member' | 'Elder';
        reason: string | null;
        changedAt: string | null;
    } | null;
    history?: Array<{
        from: 'Visitor' | 'Initiate' | 'Member' | 'Elder';
        to: 'Visitor' | 'Initiate' | 'Member' | 'Elder';
        reason: string | null;
        changedAt: string;
    }>;
    progress: {
        messageCount: number;
        citationCount: number;
        reputationScore: number;
        reputationPercentile: number | null;
        daysSinceActive: number | null;
    };
}

export interface CircleInviteRecord {
    id: number;
    code: string;
    inviteeUserId: number | null;
    inviteeHandle: string | null;
    status: 'Active' | 'Accepted' | 'Expired' | 'Revoked';
    expiresAt: string | null;
    createdAt: string;
}

export type ManagedCircleMemberRole = 'Member' | 'Moderator';

export interface CircleJoinPolicyUpdateAuth extends CircleSettingsEnvelopeAuth {}

async function fetchJsonOrThrow(
    input: RequestInfo | URL,
    init?: RequestInit,
    options: MembershipApiRequestOptions = {},
): Promise<any> {
    return authenticatedApiFetchJson(input, {
        init,
        fetchImpl: options.fetchImpl,
        locale: options.locale,
    });
}

async function fetchMembershipJsonOrThrow(
    pathname: string,
    init: RequestInit,
    options: MembershipApiRequestOptions = {},
): Promise<any> {
    const route = await resolveNodeRoute('membership', {
        fetchImpl: options.fetchImpl,
    });
    return fetchJsonOrThrow(`${route.urlBase}${pathname}`, init, options);
}

async function waitForMembershipIndexerProjection(sdk: Alcheme, signature: string): Promise<void> {
    const signatureSlot = await waitForSignatureSlot(sdk.connection, signature, {
        timeoutMs: 30_000,
        pollMs: 1_500,
    });
    if (typeof signatureSlot !== 'number' || signatureSlot <= 0) {
        throw new Error('membership_signature_slot_timeout');
    }
    const indexed = await waitForIndexedSlot(signatureSlot, {
        timeoutMs: 45_000,
        pollMs: 1_500,
    });
    if (!indexed.ok && indexed.reason !== 'degraded') {
        throw new Error(`membership_projection_${indexed.reason}`);
    }

    // A global projection can remain degraded because of historical failed
    // slots even after this membership's slot has been indexed. In that case
    // the scoped Active-membership readback below is the completion authority.
    // Unknown completeness, staleness, and timeouts remain fail-closed.
}

async function waitForMembershipReadback(circleId: number): Promise<void> {
    const deadline = Date.now() + 45_000;
    while (Date.now() < deadline) {
        try {
            const snapshot = await fetchCircleMembershipState(circleId);
            if (
                snapshot?.joinState === 'joined'
                && snapshot?.membership?.status === 'Active'
            ) {
                return;
            }
        } catch {
            // The query surface may briefly be unavailable while its canonical
            // indexer projection catches up. The bounded readback below remains
            // the completion authority for this client operation.
        }
        await new Promise((resolve) => setTimeout(resolve, 1_500));
    }
    throw new Error('membership_projection_readback_timeout');
}

function requireMembershipSdk(sdk?: Alcheme | null): Alcheme {
    if (!sdk) {
        throw new Error('wallet_finalization_required');
    }
    return sdk;
}

function parseTargetPubkey(raw: string): PublicKey {
    try {
        return new PublicKey(String(raw || '').trim());
    } catch {
        throw new Error('invalid_member_pubkey');
    }
}

export async function fetchCircleMembershipState(
    circleId: number,
    options: MembershipApiRequestOptions = {},
): Promise<CircleMembershipSnapshot> {
    const route = await resolveNodeRoute('membership', {
        fetchImpl: options.fetchImpl,
    });
    const baseUrl = route.urlBase;
    return fetchJsonOrThrow(`${baseUrl}/api/v1/membership/circles/${circleId}/me`, {
        method: 'GET',
        cache: 'no-store',
    }, options);
}

export async function fetchCircleIdentityStatus(
    circleId: number,
    options: MembershipApiRequestOptions = {},
): Promise<CircleIdentityStatus> {
    const route = await resolveNodeRoute('membership', {
        fetchImpl: options.fetchImpl,
    });
    const baseUrl = route.urlBase;
    return fetchJsonOrThrow(`${baseUrl}/api/v1/membership/circles/${circleId}/identity-status`, {
        method: 'GET',
        cache: 'no-store',
    }, options);
}

export async function joinCircle(
    circleId: number,
    input?: { inviteCode?: string; message?: string },
    sdk?: Alcheme | null,
): Promise<{
    ok: boolean;
    joinState: CircleJoinState;
    requestId?: number | null;
    alreadyMember?: boolean;
}> {
    const response = await fetchMembershipJsonOrThrow(`/api/v1/membership/circles/${circleId}/join`, {
        method: 'POST',
        headers: {
            'Content-Type': 'application/json',
        },
        body: JSON.stringify({
            inviteCode: input?.inviteCode || undefined,
            message: input?.message || undefined,
        }),
    });

    if (response?.joinState !== 'can_join' || !response?.finalization) {
        return response;
    }

    const isE2EMockMode = isBrowserOnlyMockWallet();
    const finalization = response.finalization as
        | { action: 'reactivate_existing' }
        | {
            action: 'claim_membership';
            grant: {
                role: 'Member';
                kind: 'Open' | 'Invite' | 'Approval';
                artifactId: number;
                issuedAt: string;
                expiresAt: string;
                issuerKeyId: string;
                issuedSignature: string;
            };
        };

    if (isE2EMockMode) {
        throw new Error(getBrowserOnlyMockUnsupportedError('join_circle'));
    } else {
        const activeSdk = requireMembershipSdk(sdk);
        const signature = finalization.action === 'reactivate_existing'
            ? await activeSdk.circles.joinCircle(circleId)
            : await activeSdk.circles.claimCircleMembership({
                circleId,
                role: finalization.grant.role,
                kind: finalization.grant.kind,
                artifactId: finalization.grant.artifactId,
                issuedAt: finalization.grant.issuedAt,
                expiresAt: finalization.grant.expiresAt,
                issuerKeyId: finalization.grant.issuerKeyId,
                issuedSignature: finalization.grant.issuedSignature,
            });

        await waitForMembershipIndexerProjection(activeSdk, signature);
        await waitForMembershipReadback(circleId);
    }

    return {
        ok: true,
        circleId,
        joinState: 'joined',
    } as any;
}

export async function leaveCircle(
    circleId: number,
    sdk?: Alcheme | null,
): Promise<{ ok: boolean; status: 'Left' }> {
    const response = await fetchMembershipJsonOrThrow(`/api/v1/membership/circles/${circleId}/leave`, {
        method: 'POST',
        headers: {
            'Content-Type': 'application/json',
        },
        body: JSON.stringify({}),
    });

    if (response?.requiresWalletFinalization) {
        if (isBrowserOnlyMockWallet()) {
            throw new Error(getBrowserOnlyMockUnsupportedError('leave_circle'));
        } else {
            const activeSdk = requireMembershipSdk(sdk);
            const signature = await activeSdk.circles.leaveCircle(circleId);
            await waitForMembershipIndexerProjection(activeSdk, signature);
        }
    }

    return { ok: true, status: 'Left' };
}

export async function updateCircleJoinPolicy(
    circleId: number,
    input: {
        accessType?: 'free' | 'crystal' | 'invite' | 'approval';
        joinRequirement?: JoinRequirement;
        circleType?: CircleType;
        minCrystals?: number;
    },
    auth: CircleJoinPolicyUpdateAuth,
): Promise<{
    status?: 'executed';
    ok: boolean;
    circleId: number;
    policy: CircleMembershipPolicy;
} | {
    status: 'requires_governance';
    actionType: string;
    request: Record<string, unknown>;
}> {
    if (!auth?.actorPubkey || !auth.signMessage) {
        throw new Error('circle settings auth missing');
    }
    const normalizedByAccessType = input.accessType === 'free'
        ? { joinRequirement: 'Free' as const, circleType: 'Open' as const }
        : input.accessType === 'crystal'
            ? { joinRequirement: 'TokenGated' as const, circleType: 'Open' as const }
            : input.accessType === 'invite'
                ? { joinRequirement: 'InviteOnly' as const, circleType: 'Closed' as const }
                : input.accessType === 'approval'
                    ? { joinRequirement: 'ApprovalRequired' as const, circleType: 'Closed' as const }
                    : null;
    const normalizedJoinRequirement = normalizedByAccessType?.joinRequirement
        ?? input.joinRequirement
        ?? 'Free';
    const normalizedCircleType = normalizedByAccessType?.circleType
        ?? input.circleType
        ?? 'Open';
    const { signedMessage, signature } = await signCircleSettingsEnvelope({
        circleId,
        settingKind: 'membership_policy',
        payload: normalizeMembershipPolicyEnvelopePayload({
            joinRequirement: normalizedJoinRequirement,
            circleType: normalizedCircleType,
            minCrystals: input.minCrystals,
        }),
        auth,
    });
    const route = await resolveNodeRoute('membership');
    const baseUrl = route.urlBase;
    return fetchJsonOrThrow(`${baseUrl}/api/v1/membership/circles/${circleId}/policy`, {
        method: 'PUT',
        headers: {
            'Content-Type': 'application/json',
        },
        body: JSON.stringify({
            ...input,
            actorPubkey: auth.actorPubkey,
            signedMessage,
            signature,
        }),
    });
}

export async function finalizeGovernedCircleJoinPolicy(
    circleId: number,
    input: {
        governanceRequestId: string;
        accessType?: 'free' | 'crystal' | 'invite' | 'approval';
        joinRequirement?: JoinRequirement;
        circleType?: CircleType;
        minCrystals?: number;
    },
    auth: CircleJoinPolicyUpdateAuth,
): Promise<{
    ok: boolean;
    status: 'executed';
    governanceRequestId: string;
    circleId: number;
    policy: CircleMembershipPolicy;
}> {
    if (!auth?.actorPubkey || !auth.signMessage) {
        throw new Error('circle settings auth missing');
    }
    const normalizedByAccessType = input.accessType === 'free'
        ? { joinRequirement: 'Free' as const, circleType: 'Open' as const }
        : input.accessType === 'crystal'
            ? { joinRequirement: 'TokenGated' as const, circleType: 'Open' as const }
            : input.accessType === 'invite'
                ? { joinRequirement: 'InviteOnly' as const, circleType: 'Closed' as const }
                : input.accessType === 'approval'
                    ? { joinRequirement: 'ApprovalRequired' as const, circleType: 'Closed' as const }
                    : null;
    const normalizedJoinRequirement = normalizedByAccessType?.joinRequirement
        ?? input.joinRequirement
        ?? 'Free';
    const normalizedCircleType = normalizedByAccessType?.circleType
        ?? input.circleType
        ?? 'Open';
    const minCrystals = input.minCrystals ?? 0;
    const { signedMessage, signature } = await signCircleSettingsEnvelope({
        circleId,
        settingKind: 'membership_policy',
        payload: normalizeMembershipPolicyEnvelopePayload({
            joinRequirement: normalizedJoinRequirement,
            circleType: normalizedCircleType,
            minCrystals,
        }),
        auth,
    });
    const route = await resolveNodeRoute('membership');
    const baseUrl = route.urlBase;
    return fetchJsonOrThrow(`${baseUrl}/api/v1/membership/circles/${circleId}/policy/governance-finalize`, {
        method: 'PUT',
        headers: {
            'Content-Type': 'application/json',
        },
        body: JSON.stringify({
            ...input,
            joinRequirement: normalizedJoinRequirement,
            circleType: normalizedCircleType,
            minCrystals,
            actorPubkey: auth.actorPubkey,
            signedMessage,
            signature,
        }),
    });
}

export async function createCircleInvite(
    circleId: number,
    input: {
        inviteeHandle?: string;
        inviteeUserId?: number;
        note?: string;
        expiresInHours?: number;
    },
): Promise<{
    ok: boolean;
    circleId: number;
    invite: CircleInviteRecord;
}> {
    return fetchMembershipJsonOrThrow(`/api/v1/membership/circles/${circleId}/invites`, {
        method: 'POST',
        headers: {
            'Content-Type': 'application/json',
        },
        body: JSON.stringify({
            inviteeHandle: input.inviteeHandle || undefined,
            inviteeUserId: input.inviteeUserId || undefined,
            note: input.note || undefined,
            expiresInHours: input.expiresInHours || undefined,
        }),
    });
}

export async function updateCircleMemberRole(
    circleId: number,
    userId: number,
    role: ManagedCircleMemberRole,
    targetPubkey: string,
    sdk?: Alcheme | null,
): Promise<{
    ok: boolean;
    circleId: number;
    changed: boolean;
    membership: {
        userId: number;
        role: ManagedCircleMemberRole | 'Owner' | 'Admin';
        status: 'Active' | 'Banned' | 'Left';
    };
}> {
    const response = await fetchMembershipJsonOrThrow(`/api/v1/membership/circles/${circleId}/members/${userId}/role`, {
        method: 'PUT',
        headers: {
            'Content-Type': 'application/json',
        },
        body: JSON.stringify({
            role,
        }),
    });

    if (response?.changed === false && response?.membership) {
        return response;
    }

    if (response?.requiresWalletFinalization) {
        if (isBrowserOnlyMockWallet()) {
            throw new Error(getBrowserOnlyMockUnsupportedError('update_member_role'));
        } else {
            const activeSdk = requireMembershipSdk(sdk);
            const signature = await activeSdk.circles.updateCircleMemberRole(
                circleId,
                parseTargetPubkey(targetPubkey),
                role,
            );
            await waitForMembershipIndexerProjection(activeSdk, signature);
        }
    }

    return {
        ok: true,
        circleId,
        changed: true,
        membership: {
            userId,
            role,
            status: 'Active',
        },
    };
}

export async function removeCircleMember(
    circleId: number,
    userId: number,
    reason: string,
): Promise<{
    ok: boolean;
    circleId: number;
    userId: number;
    status: 'governance_pending';
    case: { id: string; canonicalUrl: string };
}> {
    const response = await fetchMembershipJsonOrThrow(`/api/v1/membership/circles/${circleId}/members/${userId}/remove`, {
        method: 'POST',
        headers: {
            'Content-Type': 'application/json',
        },
        body: JSON.stringify({ reason }),
    });
    if (
        response?.governanceRequired !== true
        || response?.requiresWalletFinalization !== false
        || !response?.case?.id
        || !response?.case?.canonicalUrl
    ) {
        throw new Error('circle_member_removal_governance_case_required');
    }

    return {
        ok: true,
        circleId,
        userId,
        status: 'governance_pending',
        case: {
            id: String(response.case.id),
            canonicalUrl: String(response.case.canonicalUrl),
        },
    };
}
