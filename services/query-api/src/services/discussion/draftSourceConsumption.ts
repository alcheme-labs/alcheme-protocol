import crypto from 'node:crypto';

import {
    isDiscussionForwardProjectionMessageKind,
    normalizeDiscussionMessageKind,
} from './discussionMessageKinds';

export type DiscussionDraftSourceKind = 'auto_draft' | 'manual_selection';
export type DiscussionDraftSourceCarrier = 'circle_discussion' | 'communication_message';
export type DiscussionDraftSourceClaimStatus = 'pending' | 'succeeded' | 'failed';

export type DiscussionDraftSourceClaimResult =
    | {
        status: 'claimed';
        claimId: number | bigint;
        claimToken: string;
        claimedUntil: Date;
        attemptCount: number;
    }
    | {
        status: 'pending';
        claimId: number | bigint;
        claimedUntil: Date | null;
        attemptCount: number;
    }
    | {
        status: 'succeeded';
        claimId: number | bigint;
        draftPostId: number | null;
    };

export interface DiscussionDraftSourceMessageRef {
    envelopeId: string;
    lamport: bigint;
}

interface DraftSourceMessageCandidate {
    envelopeId?: string | null;
    senderPubkey?: string | null;
    messageKind?: string | null;
    payloadText?: string | null;
    payloadHash?: string | null;
    signatureVerified?: boolean | null;
    authMode?: string | null;
    clientTimestamp?: Date | null;
    deleted?: boolean | null;
    isEphemeral?: boolean | null;
    ephemeral?: boolean | null;
    relevanceStatus?: string | null;
    focusLabel?: string | null;
}

interface DraftSourceClaimRow {
    id: number | bigint;
    circleId: number;
    sourceMessagesDigest: string;
    status: string;
    draftPostId: number | null;
    claimToken: string | null;
    claimedUntil: Date | null;
    attemptCount: number;
}

const MANUAL_DRAFT_SOURCE_EXCLUDED_MESSAGE_KINDS = new Set([
    'draft_candidate_notice',
    'governance_notice',
    'announcement_notice',
]);

// Keep this list aligned with discussion-draft-trigger.ts until Part 2 moves
// automatic trigger reads onto this helper directly.
const AUTO_DRAFT_SOURCE_EXCLUDED_MESSAGE_KINDS = new Set([
    'draft_candidate_notice',
    'governance_notice',
    'source_material_notice',
    'interaction_result_notice',
]);

function normalizeSourceMessageIds(sourceMessageIds: readonly unknown[]): string[] {
    return sourceMessageIds
        .map((item) => String(item || '').trim())
        .filter((item) => item.length > 0);
}

function normalizeRelevanceStatus(value: unknown): string {
    return String(value || '').trim().toLowerCase();
}

function getClaimDelegate(prisma: any) {
    const delegate = prisma?.discussionDraftSourceClaim;
    if (!delegate) {
        throw new Error('discussion_draft_source_claim_delegate_missing');
    }
    return delegate;
}

function getStateDelegate(prisma: any) {
    const delegate = prisma?.discussionDraftSourceState;
    if (!delegate) {
        throw new Error('discussion_draft_source_state_delegate_missing');
    }
    return delegate;
}

function getConsumptionDelegate(prisma: any) {
    const delegate = prisma?.discussionDraftSourceMessageConsumption;
    if (!delegate) {
        throw new Error('discussion_draft_source_message_consumption_delegate_missing');
    }
    return delegate;
}

function claimUniqueWhere(
    circleId: number,
    sourceCarrier: DiscussionDraftSourceCarrier,
    sourceMessagesDigest: string,
) {
    return {
        circleId_sourceCarrier_sourceMessagesDigest: {
            circleId,
            sourceCarrier,
            sourceMessagesDigest,
        },
    };
}

function isExpired(claimedUntil: Date | null | undefined, now: Date): boolean {
    return !claimedUntil || claimedUntil.getTime() <= now.getTime();
}

export function computeDiscussionDraftSourceDigest(sourceMessageIds: string[]): string {
    return crypto
        .createHash('sha256')
        .update(normalizeSourceMessageIds(sourceMessageIds).join('|'))
        .digest('hex');
}

export function isManualDiscussionDraftSourceEligible(message: DraftSourceMessageCandidate): boolean {
    const envelopeId = String(message.envelopeId || '').trim();
    if (!envelopeId) return false;
    if (isDiscussionForwardProjectionMessageKind(message.messageKind)) return false;
    if (MANUAL_DRAFT_SOURCE_EXCLUDED_MESSAGE_KINDS.has(normalizeDiscussionMessageKind(message.messageKind))) return false;
    if (message.deleted === true) return false;
    if (message.isEphemeral === true || message.ephemeral === true) return false;
    if (!String(message.payloadText || '').trim()) return false;
    const relevanceStatus = normalizeRelevanceStatus(message.relevanceStatus);
    return !relevanceStatus || relevanceStatus === 'ready';
}

export function isAutoDiscussionDraftSourceEligible(message: DraftSourceMessageCandidate): boolean {
    if (isDiscussionForwardProjectionMessageKind(message.messageKind)) return false;
    if (AUTO_DRAFT_SOURCE_EXCLUDED_MESSAGE_KINDS.has(normalizeDiscussionMessageKind(message.messageKind))) return false;
    if (message.deleted === true) return false;
    if (message.isEphemeral === true || message.ephemeral === true) return false;
    const relevanceStatus = normalizeRelevanceStatus(message.relevanceStatus);
    return (!relevanceStatus || relevanceStatus === 'ready')
        && normalizeRelevanceStatus(message.focusLabel) !== 'off_topic';
}

export async function loadManualDiscussionDraftSourceMessages(prisma: any, input: {
    circleId: number;
    sourceMessageIds: string[];
}): Promise<{
    sourceMessages: Array<DraftSourceMessageCandidate & DiscussionDraftSourceMessageRef>;
    filteredSourceMessageIds: string[];
}> {
    const requestedIds = normalizeSourceMessageIds(input.sourceMessageIds);
    if (requestedIds.length === 0) {
        return {
            sourceMessages: [],
            filteredSourceMessageIds: [],
        };
    }

    const rows = await prisma.circleDiscussionMessage.findMany({
        where: {
            circleId: input.circleId,
            envelopeId: { in: requestedIds },
        },
        select: {
            envelopeId: true,
            lamport: true,
            senderPubkey: true,
            messageKind: true,
            payloadText: true,
            payloadHash: true,
            signatureVerified: true,
            authMode: true,
            clientTimestamp: true,
            deleted: true,
            isEphemeral: true,
            relevanceStatus: true,
        },
        orderBy: [
            { lamport: 'asc' },
            { id: 'asc' },
        ],
    });

    const foundIds = new Set(rows.map((row: { envelopeId: string }) => row.envelopeId));
    const sourceMessages = rows.filter(isManualDiscussionDraftSourceEligible);
    const sourceIds = new Set(sourceMessages.map((row: { envelopeId: string }) => row.envelopeId));
    const filteredSourceMessageIds = requestedIds.filter((id) => !foundIds.has(id) || !sourceIds.has(id));

    return {
        sourceMessages,
        filteredSourceMessageIds,
    };
}

export async function loadDiscussionDraftSourceState(prisma: any, circleId: number) {
    return getStateDelegate(prisma).findUnique({
        where: { circleId },
    });
}

export async function listConsumedDiscussionDraftSourceEnvelopeIds(prisma: any, input: {
    circleId: number;
    envelopeIds: string[];
    sourceCarrier?: DiscussionDraftSourceCarrier;
}): Promise<string[]> {
    const envelopeIds = normalizeSourceMessageIds(input.envelopeIds);
    if (envelopeIds.length === 0) return [];
    const rows = await getConsumptionDelegate(prisma).findMany({
        where: {
            circleId: input.circleId,
            sourceCarrier: input.sourceCarrier ?? 'circle_discussion',
            envelopeId: { in: envelopeIds },
        },
        select: {
            envelopeId: true,
        },
    });
    return Array.from(new Set(rows.map((row: { envelopeId: string }) => row.envelopeId)));
}

export async function claimDiscussionDraftSource(prisma: any, input: {
    circleId: number;
    sourceCarrier?: DiscussionDraftSourceCarrier;
    sourceMessagesDigest: string;
    sourceMessageIds: string[];
    sourceKind: DiscussionDraftSourceKind;
    sourceFromLamport?: bigint | null;
    sourceToLamport?: bigint | null;
    claimToken: string;
    claimedUntil: Date;
    now?: Date;
}): Promise<DiscussionDraftSourceClaimResult> {
    const delegate = getClaimDelegate(prisma);
    const now = input.now ?? new Date();
    const sourceCarrier = input.sourceCarrier ?? 'circle_discussion';
    const existing = await delegate.findUnique({
        where: claimUniqueWhere(input.circleId, sourceCarrier, input.sourceMessagesDigest),
    }) as DraftSourceClaimRow | null;

    if (existing?.status === 'succeeded') {
        return {
            status: 'succeeded',
            claimId: existing.id,
            draftPostId: existing.draftPostId ?? null,
        };
    }

    if (existing?.status === 'pending' && !isExpired(existing.claimedUntil, now)) {
        return {
            status: 'pending',
            claimId: existing.id,
            claimedUntil: existing.claimedUntil,
            attemptCount: existing.attemptCount,
        };
    }

    const data = {
        status: 'pending' satisfies DiscussionDraftSourceClaimStatus,
        draftPostId: null,
        claimToken: input.claimToken,
        claimedUntil: input.claimedUntil,
        attemptCount: (existing?.attemptCount ?? 0) + 1,
        sourceMessageIds: normalizeSourceMessageIds(input.sourceMessageIds),
        sourceFromLamport: input.sourceFromLamport ?? null,
        sourceToLamport: input.sourceToLamport ?? null,
        sourceKind: input.sourceKind,
        failureReason: null,
    };

    const row = existing
        ? await delegate.update({
            where: claimUniqueWhere(input.circleId, sourceCarrier, input.sourceMessagesDigest),
            data,
        })
        : await delegate.create({
            data: {
                circleId: input.circleId,
                sourceCarrier,
                sourceMessagesDigest: input.sourceMessagesDigest,
                ...data,
            },
        });

    return {
        status: 'claimed',
        claimId: row.id,
        claimToken: row.claimToken,
        claimedUntil: row.claimedUntil,
        attemptCount: row.attemptCount,
    };
}

export async function completeDiscussionDraftSourceClaim(prisma: any, input: {
    circleId: number;
    sourceCarrier?: DiscussionDraftSourceCarrier;
    sourceMessagesDigest: string;
    claimToken: string;
    draftPostId: number;
    sourceKind: DiscussionDraftSourceKind;
    sourceMessages: DiscussionDraftSourceMessageRef[];
    advanceAutoCursor: boolean;
    autoSourceFromLamport?: bigint | null;
    autoSourceToLamport?: bigint | null;
}) {
    const claimDelegate = getClaimDelegate(prisma);
    const sourceCarrier = input.sourceCarrier ?? 'circle_discussion';
    const existing = await claimDelegate.findUnique({
        where: claimUniqueWhere(input.circleId, sourceCarrier, input.sourceMessagesDigest),
    }) as DraftSourceClaimRow | null;

    if (!existing) {
        throw new Error('discussion_draft_source_claim_not_found');
    }
    if (existing.status !== 'succeeded' && existing.claimToken !== input.claimToken) {
        throw new Error('discussion_draft_source_claim_token_mismatch');
    }

    const sourceMessageIds = normalizeSourceMessageIds(input.sourceMessages.map((message) => message.envelopeId));
    const claim = existing.status === 'succeeded'
        ? existing
        : await claimDelegate.update({
            where: claimUniqueWhere(input.circleId, sourceCarrier, input.sourceMessagesDigest),
            data: {
                status: 'succeeded' satisfies DiscussionDraftSourceClaimStatus,
                draftPostId: input.draftPostId,
                sourceMessageIds,
                sourceFromLamport: input.autoSourceFromLamport ?? input.sourceMessages[0]?.lamport ?? null,
                sourceToLamport: input.autoSourceToLamport ?? input.sourceMessages[input.sourceMessages.length - 1]?.lamport ?? null,
                sourceKind: input.sourceKind,
                failureReason: null,
            },
        });

    if (input.sourceMessages.length > 0) {
        await getConsumptionDelegate(prisma).createMany({
            data: input.sourceMessages.map((message) => ({
                circleId: input.circleId,
                sourceCarrier,
                envelopeId: message.envelopeId,
                lamport: message.lamport,
                draftPostId: input.draftPostId,
                sourceMessagesDigest: input.sourceMessagesDigest,
                sourceKind: input.sourceKind,
            })),
            skipDuplicates: true,
        });
    }

    if (input.advanceAutoCursor) {
        const lastAdvancedBy = input.sourceKind === 'auto_draft'
            ? 'auto_draft'
            : 'manual_selection_complete_interval';
        const stateData = {
            lastAutoDraftPostId: input.draftPostId,
            lastAutoSourceFromLamport: input.autoSourceFromLamport ?? input.sourceMessages[0]?.lamport ?? null,
            lastAutoSourceToLamport: input.autoSourceToLamport ?? input.sourceMessages[input.sourceMessages.length - 1]?.lamport ?? null,
            lastAutoSourceMessagesDigest: input.sourceMessagesDigest,
            lastAutoSourceMessageCount: sourceMessageIds.length,
            lastAutoSourceMessageIds: sourceMessageIds,
            lastAdvancedBy,
        };
        await getStateDelegate(prisma).upsert({
            where: { circleId: input.circleId },
            create: {
                circleId: input.circleId,
                ...stateData,
            },
            update: stateData,
        });
    }

    return claim;
}

export async function failDiscussionDraftSourceClaim(prisma: any, input: {
    circleId: number;
    sourceCarrier?: DiscussionDraftSourceCarrier;
    sourceMessagesDigest: string;
    claimToken: string;
    failureReason: string;
}) {
    const delegate = getClaimDelegate(prisma);
    const sourceCarrier = input.sourceCarrier ?? 'circle_discussion';
    const existing = await delegate.findUnique({
        where: claimUniqueWhere(input.circleId, sourceCarrier, input.sourceMessagesDigest),
    }) as DraftSourceClaimRow | null;
    if (!existing) return null;
    if (existing.status === 'succeeded') return existing;
    if (existing.claimToken !== input.claimToken) {
        throw new Error('discussion_draft_source_claim_token_mismatch');
    }
    return delegate.update({
        where: claimUniqueWhere(input.circleId, sourceCarrier, input.sourceMessagesDigest),
        data: {
            status: 'failed' satisfies DiscussionDraftSourceClaimStatus,
            failureReason: String(input.failureReason || 'generation_failed').slice(0, 128),
        },
    });
}

export async function doesSourceCoverCompleteEligibleInterval(prisma: any, input: {
    circleId: number;
    sourceMessageIds: string[];
    lastAutoSourceToLamport: bigint | null;
    sourceToLamport: bigint;
}): Promise<boolean> {
    const selectedIds = new Set(normalizeSourceMessageIds(input.sourceMessageIds));
    const rows = await prisma.circleDiscussionMessage.findMany({
        where: {
            circleId: input.circleId,
            lamport: {
                gt: input.lastAutoSourceToLamport ?? BigInt(0),
                lte: input.sourceToLamport,
            },
        },
        select: {
            envelopeId: true,
            messageKind: true,
            payloadText: true,
            deleted: true,
            isEphemeral: true,
            relevanceStatus: true,
            focusLabel: true,
            lamport: true,
        },
        orderBy: [
            { lamport: 'asc' },
            { id: 'asc' },
        ],
    });

    const requiredIds = rows
        .filter(isAutoDiscussionDraftSourceEligible)
        .map((row: { envelopeId: string }) => row.envelopeId);

    return requiredIds.every((envelopeId: string) => selectedIds.has(envelopeId));
}
