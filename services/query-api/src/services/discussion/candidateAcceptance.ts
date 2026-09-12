import crypto from 'node:crypto';
import { Prisma, type PrismaClient } from '@prisma/client';
import type { Redis } from 'ioredis';

import {
    DiscussionInitialDraftError,
    generateInitialDiscussionDraft,
} from '../../ai/discussion-initial-draft';
import { createDraftAnchorBatch } from '../draftAnchor';
import {
    createDraftVersionSnapshot,
    updateDraftVersionSnapshotSourceEvidence,
} from '../draftLifecycle/versionSnapshots';
import { buildDiscussionRoomKey } from '../offchainDiscussion';
import type { CircleActor } from '../auth/actor';
import {
    DISCUSSION_SEMANTIC_FACETS,
    type AuthorAnnotationKind,
    type SemanticFacet,
} from './analysis/types';
import {
    claimDraftCandidateGenerationAttempt,
    computeDraftCandidateSourceDigest,
    markDraftCandidateGenerationFailed,
    markDraftCandidateGenerationSucceeded,
} from './candidateGenerationAttempts';
import {
    publishDraftCandidateSystemNotices,
    type DraftCandidateSourceScope,
} from './systemNoticeProducer';
import {
    claimDiscussionDraftSource,
    completeDiscussionDraftSourceClaim,
    computeDiscussionDraftSourceDigest,
    doesSourceCoverCompleteEligibleInterval,
    failDiscussionDraftSourceClaim,
    listConsumedDiscussionDraftSourceEnvelopeIds,
    loadDiscussionDraftSourceState,
    loadManualDiscussionDraftSourceMessages,
    type DiscussionDraftSourceCarrier,
} from './draftSourceConsumption';
import {
    CommunicationDraftSourceError,
    loadAuthorizedCommunicationDraftSources,
} from './communicationDraftSources';
import { ContributionGrantAuthorizationError } from '../communication/contributionGrant';

type PrismaLike = PrismaClient | Prisma.TransactionClient;

interface CandidateNoticeRow {
    metadata: Prisma.JsonValue | null;
}

type CandidateState =
    | 'open'
    | 'pending'
    | 'proposal_active'
    | 'accepted'
    | 'generation_failed'
    | 'rejected'
    | 'expired'
    | 'cancelled';

interface DraftCandidateNoticeRecord {
    candidateId: string;
    state: CandidateState;
    summary: string | null;
    sourceMessageIds: string[];
    sourceCarrier: DiscussionDraftSourceCarrier;
    sourceMaterialIds: number[];
    sourceRoomKey: string | null;
    sourceSemanticFacets: SemanticFacet[];
    sourceAuthorAnnotations: AuthorAnnotationKind[];
    lastProposalId: string | null;
    draftPostId: number | null;
}

interface PersistedCandidateAcceptanceRecord {
    draftPostId: number;
}

export class DraftCandidateAcceptanceError extends Error {
    statusCode: number;
    code: string;

    constructor(input: { statusCode: number; code: string; message: string }) {
        super(input.message);
        this.name = 'DraftCandidateAcceptanceError';
        this.statusCode = input.statusCode;
        this.code = input.code;
    }
}

export interface AcceptDraftCandidateInput {
    circleId: number;
    candidateId: string;
    actor: CircleActor | null | undefined;
    redis?: Pick<Redis, 'publish'> | null;
}

export interface CreateDraftFromManualDiscussionSelectionInput {
    circleId: number;
    sourceCarrier?: DiscussionDraftSourceCarrier;
    sourceMessageIds?: string[];
    sourceMaterialIds?: number[];
    sourceScope?: DraftCandidateSourceScope | null;
    actor: CircleActor | null | undefined;
    redis?: Pick<Redis, 'publish'> | null;
}

export interface CancelDraftCandidateInput {
    circleId: number;
    candidateId: string;
    actor: CircleActor | null | undefined;
    redis?: Pick<Redis, 'publish'> | null;
}

export interface AcceptDraftCandidateResult {
    status: 'created' | 'existing' | 'pending' | 'generation_failed';
    candidateId: string;
    draftPostId?: number;
    created: boolean;
    ghostDraftGenerationId?: number | null;
    attemptId?: number;
    claimedUntil?: Date;
    canRetry?: boolean;
    draftGenerationError?: string;
    sourceConsumption?: {
        sourceCarrier?: DiscussionDraftSourceCarrier;
        sourceMaterialIds?: number[];
        sourceMessagesDigest: string;
        sourceMessageIds: string[];
        filteredSourceMessageIds?: string[];
        partialOverlapSourceMessageIds?: string[];
        blocking: boolean;
        advanceAutoCursor?: boolean;
    };
}

export interface CancelDraftCandidateResult {
    status: 'cancelled';
    candidateId: string;
    cancelled: true;
}

type CreatedDraftTransactionResult =
    | {
        status: 'existing';
        candidateId: string;
        draftPostId: number;
        created: false;
    }
    | {
        status: 'created';
        candidateId: string;
        draftPostId: number;
        created: true;
        creatorId: number;
        summary: string;
        sourceMessageIds: string[];
        sourceCarrier: DiscussionDraftSourceCarrier;
        sourceMaterialIds: number[];
        sourceRoomKey: string | null;
        sourceSemanticFacets: SemanticFacet[];
        sourceAuthorAnnotations: AuthorAnnotationKind[];
    };

const MANUAL_DISCUSSION_SOURCE_MESSAGE_LIMIT = 20;

function isRecord(value: unknown): value is Record<string, unknown> {
    return Boolean(value) && typeof value === 'object' && !Array.isArray(value);
}

function normalizeState(value: unknown): CandidateState | null {
    const normalized = typeof value === 'string' ? value.trim().toLowerCase() : '';
    if (
        normalized === 'open'
        || normalized === 'pending'
        || normalized === 'proposal_active'
        || normalized === 'accepted'
        || normalized === 'generation_failed'
        || normalized === 'rejected'
        || normalized === 'expired'
        || normalized === 'cancelled'
    ) {
        return normalized;
    }
    return null;
}

function normalizeStringArray(value: unknown): string[] {
    if (!Array.isArray(value)) return [];
    const seen = new Set<string>();
    for (const item of value) {
        const normalized = typeof item === 'string' ? item.trim() : '';
        if (!normalized || seen.has(normalized)) continue;
        seen.add(normalized);
    }
    return Array.from(seen);
}

function normalizePositiveIntArray(value: unknown): number[] {
    if (!Array.isArray(value)) return [];
    const seen = new Set<number>();
    for (const item of value) {
        const normalized = Number(item);
        if (!Number.isSafeInteger(normalized) || normalized <= 0 || seen.has(normalized)) continue;
        seen.add(normalized);
    }
    return Array.from(seen);
}

function publishCandidateNotices(
    prisma: PrismaClient,
    input: Parameters<typeof publishDraftCandidateSystemNotices>[1],
    redis?: Pick<Redis, 'publish'> | null,
) {
    return redis
        ? publishDraftCandidateSystemNotices(prisma, input, redis)
        : publishDraftCandidateSystemNotices(prisma, input);
}

function normalizeSemanticFacets(value: unknown): SemanticFacet[] {
    const normalized = normalizeStringArray(value);
    return DISCUSSION_SEMANTIC_FACETS.filter((label) => normalized.includes(label));
}

function normalizeAuthorAnnotations(value: unknown): AuthorAnnotationKind[] {
    const allowed: AuthorAnnotationKind[] = ['fact', 'explanation', 'emotion'];
    const normalized = normalizeStringArray(value);
    return allowed.filter((label) => normalized.includes(label));
}

function normalizePositiveInt(value: unknown): number | null {
    if (typeof value !== 'number' || !Number.isInteger(value) || value <= 0) return null;
    return value;
}

function assertDraftCandidateManagerActor(input: {
    actor: CircleActor | null | undefined;
    circleId: number;
    forbiddenMessage: string;
}): CircleActor {
    if (!input.actor) {
        throw new DraftCandidateAcceptanceError({
            statusCode: 401,
            code: 'authentication_required',
            message: 'authentication is required',
        });
    }
    if (input.actor.circle.id !== input.circleId) {
        throw new DraftCandidateAcceptanceError({
            statusCode: 403,
            code: 'candidate_generation_forbidden',
            message: input.forbiddenMessage,
        });
    }
    if (!['Owner', 'Admin', 'Moderator'].includes(input.actor.membership.role)) {
        throw new DraftCandidateAcceptanceError({
            statusCode: 403,
            code: 'candidate_generation_forbidden',
            message: input.forbiddenMessage,
        });
    }
    return input.actor;
}

function normalizeNonEmptyString(value: unknown): string | null {
    if (typeof value !== 'string') return null;
    const normalized = value.trim();
    return normalized ? normalized : null;
}

function parseCandidateNotice(metadata: unknown): DraftCandidateNoticeRecord | null {
    if (!isRecord(metadata)) return null;
    const candidateId = typeof metadata.candidateId === 'string' ? metadata.candidateId.trim() : '';
    const state = normalizeState(metadata.state);
    if (!candidateId || !state) return null;

    return {
        candidateId,
        state,
        summary: typeof metadata.summary === 'string' && metadata.summary.trim()
            ? metadata.summary.trim()
            : null,
        sourceMessageIds: normalizeStringArray(metadata.sourceMessageIds),
        sourceCarrier: metadata.sourceCarrier === 'communication_message'
            ? 'communication_message'
            : 'circle_discussion',
        sourceMaterialIds: metadata.sourceCarrier === 'communication_message'
            ? normalizePositiveIntArray(metadata.sourceMaterialIds)
            : [],
        sourceRoomKey: metadata.sourceCarrier === 'communication_message'
            ? normalizeNonEmptyString(metadata.sourceRoomKey)
            : null,
        sourceSemanticFacets: normalizeSemanticFacets(
            metadata.sourceSemanticFacets ?? metadata.sourceDiscussionLabels,
        ),
        sourceAuthorAnnotations: normalizeAuthorAnnotations(metadata.sourceAuthorAnnotations),
        lastProposalId: normalizeNonEmptyString(metadata.lastRequestId)
            ?? normalizeNonEmptyString(metadata.lastProposalId),
        draftPostId: normalizePositiveInt(metadata.draftPostId),
    };
}

function candidateNoticeSourceExtension(notice: DraftCandidateNoticeRecord) {
    return notice.sourceCarrier === 'communication_message'
        ? {
            sourceCarrier: notice.sourceCarrier,
            sourceMaterialIds: notice.sourceMaterialIds,
            sourceRoomKey: notice.sourceRoomKey,
        }
        : {};
}

async function loadLatestCandidateNotice(
    prisma: PrismaLike,
    input: { circleId: number; candidateId: string },
): Promise<DraftCandidateNoticeRecord | null> {
    const rows = await prisma.$queryRaw<CandidateNoticeRow[]>(Prisma.sql`
        SELECT metadata
        FROM circle_discussion_messages
        WHERE circle_id = ${input.circleId}
          AND deleted = FALSE
          AND message_kind IN ('draft_candidate_notice', 'governance_notice')
          AND metadata->>'candidateId' = ${input.candidateId}
        ORDER BY created_at DESC, lamport DESC
        LIMIT 1
    `);
    return rows[0] ? parseCandidateNotice(rows[0].metadata) : null;
}

async function loadPersistedCandidateAcceptance(
    prisma: PrismaLike,
    input: { circleId: number; candidateId: string },
): Promise<PersistedCandidateAcceptanceRecord | null> {
    const row = await prisma.draftCandidateAcceptance.findUnique({
        where: {
            circleId_candidateId: {
                circleId: input.circleId,
                candidateId: input.candidateId,
            },
        },
        select: {
            draftPostId: true,
        },
    });
    return row ? { draftPostId: row.draftPostId } : null;
}

async function createCandidateSeedDraft(
    prisma: PrismaLike,
    input: {
        contentId: string;
        authorId: number;
        circleId: number;
        text: string;
        onChainAddress: string;
    },
): Promise<{ id: number }> {
    const draftPost = await prisma.post.create({
        data: {
            contentId: input.contentId,
            authorId: input.authorId,
            text: input.text,
            contentType: 'ai/discussion-draft',
            circleId: input.circleId,
            status: 'Draft' as any,
            visibility: 'CircleOnly' as any,
            onChainAddress: input.onChainAddress,
            lastSyncedSlot: BigInt(0),
        },
        select: { id: true },
    });

    await createDraftVersionSnapshot(prisma, {
        draftPostId: draftPost.id,
        draftVersion: 1,
        contentSnapshot: input.text,
        createdFromState: 'drafting',
        createdBy: input.authorId,
    });

    return draftPost;
}

async function acquireCandidateAcceptanceLock(
    prisma: PrismaLike,
    input: { circleId: number; candidateId: string },
): Promise<void> {
    await prisma.$executeRaw`
        SELECT pg_advisory_xact_lock(
            CAST(${input.circleId} AS integer),
            hashtext(${input.candidateId})::integer
        )
    `;
}

export async function acceptDraftCandidateIntoDraft(
    prisma: PrismaClient,
    input: AcceptDraftCandidateInput,
): Promise<AcceptDraftCandidateResult> {
    const actor = assertDraftCandidateManagerActor({
        actor: input.actor,
        circleId: input.circleId,
        forbiddenMessage: 'only circle managers can generate a draft from a candidate',
    });
    const userId = actor.userId;

    const existingAcceptance = await loadPersistedCandidateAcceptance(prisma, {
        circleId: input.circleId,
        candidateId: input.candidateId,
    });
    if (existingAcceptance) {
        return {
            status: 'existing',
            candidateId: input.candidateId,
            draftPostId: existingAcceptance.draftPostId,
            created: false,
            ghostDraftGenerationId: null,
        };
    }

    const circle = await prisma.circle.findUnique({
        where: { id: input.circleId },
        select: { id: true, name: true, description: true, creatorId: true },
    });
    if (!circle) {
        throw new DraftCandidateAcceptanceError({
            statusCode: 404,
            code: 'circle_not_found',
            message: 'circle not found',
        });
    }

    const notice = await loadLatestCandidateNotice(prisma, {
        circleId: input.circleId,
        candidateId: input.candidateId,
    });
    if (!notice) {
        throw new DraftCandidateAcceptanceError({
            statusCode: 404,
            code: 'draft_candidate_not_found',
            message: 'draft candidate not found',
        });
    }

    if (notice.state === 'accepted' && notice.draftPostId) {
        return {
            status: 'existing',
            candidateId: notice.candidateId,
            draftPostId: notice.draftPostId,
            created: false,
            ghostDraftGenerationId: null,
        };
    }

    if (notice.state !== 'open' && notice.state !== 'pending' && notice.state !== 'generation_failed') {
        throw new DraftCandidateAcceptanceError({
            statusCode: 409,
            code: 'draft_candidate_not_ready',
            message: `draft candidate is in state ${notice.state}`,
        });
    }

    if (notice.sourceMessageIds.length === 0) {
        throw new DraftCandidateAcceptanceError({
            statusCode: 409,
            code: 'draft_candidate_missing_sources',
            message: 'draft candidate has no source messages',
        });
    }
    if (
        notice.sourceCarrier === 'communication_message'
        && (notice.sourceMaterialIds.length !== notice.sourceMessageIds.length || !notice.sourceRoomKey)
    ) {
        throw new DraftCandidateAcceptanceError({
            statusCode: 409,
            code: 'draft_candidate_missing_source_materials',
            message: 'authorized communication draft candidate is missing source material evidence',
        });
    }

    const sourceMessagesDigest = computeDraftCandidateSourceDigest(notice.sourceMessageIds);
    const claim = await claimDraftCandidateGenerationAttempt(prisma, {
        circleId: input.circleId,
        candidateId: notice.candidateId,
        sourceMessagesDigest,
        sourceMessageIds: notice.sourceMessageIds,
        sourceSemanticFacets: notice.sourceSemanticFacets,
        sourceAuthorAnnotations: notice.sourceAuthorAnnotations,
        lastProposalId: notice.lastProposalId,
        summaryMethod: null,
        attemptedByUserId: userId,
    });

    if (claim.status === 'succeeded') {
        return {
            status: 'existing',
            candidateId: notice.candidateId,
            draftPostId: claim.draftPostId,
            created: false,
            ghostDraftGenerationId: null,
        };
    }

    if (claim.status === 'pending') {
        try {
            await publishCandidateNotices(prisma, {
                circleId: input.circleId,
                summary: notice.summary || '',
                sourceMessageIds: notice.sourceMessageIds,
                ...candidateNoticeSourceExtension(notice),
                sourceSemanticFacets: notice.sourceSemanticFacets,
                sourceAuthorAnnotations: notice.sourceAuthorAnnotations,
                draftPostId: null,
                triggerReason: 'manual_candidate_acceptance_pending',
                candidateStateOverride: 'pending',
                draftGenerationStatus: 'pending',
            }, input.redis);
        } catch (error) {
            const message = error instanceof Error ? error.message : String(error);
            console.warn(`candidate acceptance: failed to publish pending notice (${message})`);
        }
        return {
            status: 'pending',
            candidateId: notice.candidateId,
            attemptId: claim.attemptId,
            claimedUntil: claim.claimedUntil,
            created: false,
        };
    }

    let communicationSources: Awaited<ReturnType<typeof loadAuthorizedCommunicationDraftSources>> | null = null;
    const initialDraft = await (async () => {
        if (notice.sourceCarrier === 'communication_message') {
            communicationSources = await loadAuthorizedCommunicationDraftSources(prisma, {
                circleId: input.circleId,
                sourceMaterialIds: notice.sourceMaterialIds,
            });
            if (
                communicationSources.roomKey !== notice.sourceRoomKey
                || communicationSources.sourceMessageIds.length !== notice.sourceMessageIds.length
                || communicationSources.sourceMessageIds.some((id, index) => id !== notice.sourceMessageIds[index])
            ) {
                throw new CommunicationDraftSourceError('draft_candidate_source_evidence_mismatch');
            }
        }
        return generateInitialDiscussionDraft(prisma, {
            circleId: input.circleId,
            requestedByUserId: userId,
            circleName: circle.name,
            circleDescription: circle.description,
            sourceMessageIds: notice.sourceMessageIds,
            ...(communicationSources ? { sourceMessages: communicationSources.sourceMessages } : {}),
        });
    })().catch((error) => {
        if (error instanceof DraftCandidateAcceptanceError) throw error;
        if (error instanceof DiscussionInitialDraftError) {
            return {
                error,
            };
        }
        if (error instanceof CommunicationDraftSourceError || error instanceof ContributionGrantAuthorizationError) {
            return {
                error: new DiscussionInitialDraftError({
                    code: error.code,
                    message: error.message,
                    retryable: false,
                }),
            };
        }
        return {
            error: new DiscussionInitialDraftError({
                code: 'initial_draft_generation_failed',
                message: error instanceof Error ? error.message : String(error || ''),
            }),
        };
    });

    if ('error' in initialDraft) {
        const generationError = initialDraft.error;
        await markDraftCandidateGenerationFailed(prisma, {
            attemptId: claim.attemptId,
            claimToken: claim.claimToken,
            draftGenerationError: generationError.code,
            draftGenerationDiagnostics: {
                ...generationError.diagnostics,
                message: generationError.message,
            },
        });
        try {
            await publishCandidateNotices(prisma, {
                circleId: input.circleId,
                summary: notice.summary || '',
                sourceMessageIds: notice.sourceMessageIds,
                ...candidateNoticeSourceExtension(notice),
                sourceSemanticFacets: notice.sourceSemanticFacets,
                sourceAuthorAnnotations: notice.sourceAuthorAnnotations,
                draftPostId: null,
                triggerReason: 'manual_candidate_acceptance_failed',
                candidateStateOverride: 'generation_failed',
                draftGenerationError: generationError.code,
            }, input.redis);
        } catch (error) {
            const message = error instanceof Error ? error.message : String(error);
            console.warn(`candidate acceptance: failed to publish generation_failed notice (${message})`);
        }
        return {
            status: 'generation_failed',
            candidateId: notice.candidateId,
            canRetry: generationError.retryable,
            draftGenerationError: generationError.code,
            created: false,
        };
    }

    const createdDraft = await prisma.$transaction<CreatedDraftTransactionResult>(async (tx) => {
        await acquireCandidateAcceptanceLock(tx, {
            circleId: input.circleId,
            candidateId: input.candidateId,
        });

        const existingAfterLock = await loadPersistedCandidateAcceptance(tx, {
            circleId: input.circleId,
            candidateId: input.candidateId,
        });
        if (existingAfterLock) {
            return {
                status: 'existing',
                candidateId: input.candidateId,
                draftPostId: existingAfterLock.draftPostId,
                created: false,
            };
        }

        const contentId = `candidate-draft:${input.circleId}:${Date.now()}:${crypto.randomBytes(6).toString('hex')}`;
        const onChainAddress = `offchain_candidate_${crypto.randomBytes(16).toString('hex')}`.slice(0, 44);
        const draftPost = await createCandidateSeedDraft(tx, {
            contentId,
            authorId: circle.creatorId,
            circleId: input.circleId,
            text: initialDraft.draftText,
            onChainAddress,
        });

        if (notice.sourceCarrier === 'communication_message') {
            const bound = await tx.sourceMaterial.updateMany({
                where: {
                    id: { in: notice.sourceMaterialIds },
                    circleId: input.circleId,
                    originType: 'communication_message',
                    externalAppId: communicationSources!.externalAppId,
                    roomKey: notice.sourceRoomKey,
                    draftPostId: null,
                    lifecycleStatus: 'accepted_to_plaza',
                },
                data: {
                    draftPostId: draftPost.id,
                    lifecycleStatus: 'used_in_draft',
                },
            });
            if (bound.count !== notice.sourceMaterialIds.length) {
                throw new DraftCandidateAcceptanceError({
                    statusCode: 409,
                    code: 'draft_candidate_source_binding_conflict',
                    message: 'one or more authorized communication sources changed before draft commit',
                });
            }
        }

        await tx.draftCandidateAcceptance.create({
            data: {
                circleId: input.circleId,
                candidateId: notice.candidateId,
                draftPostId: draftPost.id,
                acceptedByUserId: userId,
            },
        });

        const successRecorded = await markDraftCandidateGenerationSucceeded(tx, {
            attemptId: claim.attemptId,
            claimToken: claim.claimToken,
            draftPostId: draftPost.id,
            draftGenerationMethod: 'llm',
            draftGenerationDiagnostics: {
                ...initialDraft.generationMetadata,
                rawFinishReason: initialDraft.rawFinishReason,
            },
        });
        if (!successRecorded) {
            throw new DraftCandidateAcceptanceError({
                statusCode: 409,
                code: 'draft_candidate_generation_claim_lost',
                message: 'draft candidate generation claim was lost before the draft could be committed',
            });
        }

        return {
            status: 'created',
            candidateId: notice.candidateId,
            draftPostId: draftPost.id,
            created: true,
            creatorId: circle.creatorId,
            summary: notice.summary || '',
            sourceMessageIds: notice.sourceMessageIds,
            sourceCarrier: notice.sourceCarrier,
            sourceMaterialIds: notice.sourceMaterialIds,
            sourceRoomKey: notice.sourceRoomKey,
            sourceSemanticFacets: notice.sourceSemanticFacets,
            sourceAuthorAnnotations: notice.sourceAuthorAnnotations,
        };
    });

    if (createdDraft.created) {
        try {
            const anchor = await createDraftAnchorBatch({
                prisma,
                circleId: input.circleId,
                draftPostId: createdDraft.draftPostId,
                roomKey: createdDraft.sourceCarrier === 'communication_message'
                    ? createdDraft.sourceRoomKey!
                    : buildDiscussionRoomKey(input.circleId),
                triggerReason: 'manual_candidate_acceptance',
                summaryText: createdDraft.summary || initialDraft.title,
                summaryMethod: 'llm',
                messages: initialDraft.sourceMessages.map((message) => ({
                    envelopeId: message.envelopeId,
                    payloadHash: message.payloadHash,
                    lamport: message.lamport,
                    senderPubkey: message.senderPubkey,
                    createdAt: message.createdAt,
                    semanticScore: message.semanticScore,
                    relevanceMethod: message.relevanceMethod || 'rule',
                })),
            });

            await updateDraftVersionSnapshotSourceEvidence(prisma, {
                draftPostId: createdDraft.draftPostId,
                draftVersion: 1,
                sourceSummaryHash: anchor.summaryHash,
                sourceMessagesDigest: anchor.messagesDigest,
            });

            if (anchor.txSignature) {
                await prisma.post.update({
                    where: { id: createdDraft.draftPostId },
                    data: {
                        storageUri: `solana://tx/${anchor.txSignature}`,
                    },
                });
            }
        } catch (error) {
            const message = error instanceof Error ? error.message : String(error);
            console.warn(`candidate acceptance: failed to anchor source evidence (${message})`);
        }

        try {
            await publishCandidateNotices(prisma, {
                circleId: input.circleId,
                summary: createdDraft.summary || '',
                sourceMessageIds: createdDraft.sourceMessageIds,
                ...(createdDraft.sourceCarrier === 'communication_message'
                    ? {
                        sourceCarrier: createdDraft.sourceCarrier,
                        sourceMaterialIds: createdDraft.sourceMaterialIds,
                        sourceRoomKey: createdDraft.sourceRoomKey,
                    }
                    : {}),
                sourceSemanticFacets: createdDraft.sourceSemanticFacets,
                sourceAuthorAnnotations: createdDraft.sourceAuthorAnnotations,
                draftPostId: createdDraft.draftPostId,
                triggerReason: 'manual_candidate_acceptance',
            }, input.redis);
        } catch (error) {
            const message = error instanceof Error ? error.message : String(error);
            console.warn(`candidate acceptance: failed to publish accepted notice (${message})`);
        }
    }

    return {
        status: createdDraft.status,
        candidateId: createdDraft.candidateId,
        draftPostId: createdDraft.draftPostId,
        created: createdDraft.created,
        ghostDraftGenerationId: null,
    };
}

export async function cancelDraftCandidate(
    prisma: PrismaClient,
    input: CancelDraftCandidateInput,
): Promise<CancelDraftCandidateResult> {
    assertDraftCandidateManagerActor({
        actor: input.actor,
        circleId: input.circleId,
        forbiddenMessage: 'only circle managers can cancel a draft candidate',
    });

    const existingAcceptance = await loadPersistedCandidateAcceptance(prisma, {
        circleId: input.circleId,
        candidateId: input.candidateId,
    });
    if (existingAcceptance) {
        throw new DraftCandidateAcceptanceError({
            statusCode: 409,
            code: 'draft_candidate_not_ready',
            message: 'accepted draft candidates cannot be cancelled',
        });
    }

    const notice = await loadLatestCandidateNotice(prisma, {
        circleId: input.circleId,
        candidateId: input.candidateId,
    });
    if (!notice) {
        throw new DraftCandidateAcceptanceError({
            statusCode: 404,
            code: 'draft_candidate_not_found',
            message: 'draft candidate not found',
        });
    }

    if (notice.state === 'cancelled') {
        return {
            status: 'cancelled',
            candidateId: notice.candidateId,
            cancelled: true,
        };
    }

    const cancellableStates: CandidateState[] = ['open', 'pending', 'proposal_active', 'generation_failed'];
    if (!cancellableStates.includes(notice.state) || notice.draftPostId) {
        throw new DraftCandidateAcceptanceError({
            statusCode: 409,
            code: 'draft_candidate_not_ready',
            message: `draft candidate is in state ${notice.state}`,
        });
    }

    await publishCandidateNotices(prisma, {
        circleId: input.circleId,
        summary: notice.summary || '',
        sourceMessageIds: notice.sourceMessageIds,
        ...candidateNoticeSourceExtension(notice),
        sourceSemanticFacets: notice.sourceSemanticFacets,
        sourceAuthorAnnotations: notice.sourceAuthorAnnotations,
        draftPostId: null,
        triggerReason: 'manual_candidate_cancel',
        candidateStateOverride: 'cancelled',
        draftGenerationStatus: 'cancelled',
    }, input.redis);

    return {
        status: 'cancelled',
        candidateId: notice.candidateId,
        cancelled: true,
    };
}

export async function createDraftFromManualDiscussionSelection(
    prisma: PrismaClient,
    input: CreateDraftFromManualDiscussionSelectionInput,
): Promise<AcceptDraftCandidateResult> {
    const actor = assertDraftCandidateManagerActor({
        actor: input.actor,
        circleId: input.circleId,
        forbiddenMessage: 'only circle managers can generate a draft from discussion messages',
    });

    const sourceCarrier = input.sourceCarrier === 'communication_message'
        ? 'communication_message'
        : 'circle_discussion';
    const sourceMaterialIds = normalizePositiveIntArray(input.sourceMaterialIds)
        .slice(-MANUAL_DISCUSSION_SOURCE_MESSAGE_LIMIT);
    let sourceRoomKey: string | null = null;
    let filteredSourceMessageIds: string[] = [];
    let selectedSourceMessages: Array<{ envelopeId: string; lamport: bigint }>;
    if (sourceCarrier === 'communication_message') {
        let loaded;
        try {
            loaded = await loadAuthorizedCommunicationDraftSources(prisma, {
                circleId: input.circleId,
                sourceMaterialIds,
            });
        } catch (error) {
            if (error instanceof CommunicationDraftSourceError || error instanceof ContributionGrantAuthorizationError) {
                throw new DraftCandidateAcceptanceError({
                    statusCode: error.statusCode,
                    code: error.code,
                    message: error.message,
                });
            }
            throw error;
        }
        sourceRoomKey = loaded.roomKey;
        selectedSourceMessages = loaded.sourceMessages.map((message) => ({
            envelopeId: message.envelopeId,
            lamport: message.lamport,
        }));
    } else {
        const sourceMessageIds = normalizeStringArray(input.sourceMessageIds)
            .slice(-MANUAL_DISCUSSION_SOURCE_MESSAGE_LIMIT);
        if (sourceMessageIds.length === 0) {
            throw new DraftCandidateAcceptanceError({
                statusCode: 400,
                code: 'draft_candidate_missing_sources',
                message: 'select at least one discussion message before generating a draft',
            });
        }
        const loadedSource = await loadManualDiscussionDraftSourceMessages(prisma, {
            circleId: input.circleId,
            sourceMessageIds,
        });
        filteredSourceMessageIds = loadedSource.filteredSourceMessageIds;
        selectedSourceMessages = loadedSource.sourceMessages.map((message) => ({
            envelopeId: message.envelopeId,
            lamport: message.lamport,
        }));
    }
    const selectedSourceMessageIds = selectedSourceMessages.map((message) => message.envelopeId);
    if (selectedSourceMessageIds.length === 0) {
        throw new DraftCandidateAcceptanceError({
            statusCode: 400,
            code: 'draft_candidate_missing_sources',
            message: 'select at least one discussion message that can be used for draft generation',
        });
    }

    const sourceMessagesDigest = computeDiscussionDraftSourceDigest(selectedSourceMessageIds);
    const sourceFromLamport = selectedSourceMessages[0]?.lamport ?? null;
    const sourceToLamport = selectedSourceMessages[selectedSourceMessages.length - 1]?.lamport ?? null;
    const sourceClaimToken = crypto.randomBytes(18).toString('hex');
    const sourceClaim = await claimDiscussionDraftSource(prisma, {
        circleId: input.circleId,
        ...(sourceCarrier === 'communication_message' ? { sourceCarrier } : {}),
        sourceMessagesDigest,
        sourceMessageIds: selectedSourceMessageIds,
        sourceKind: 'manual_selection',
        sourceFromLamport,
        sourceToLamport,
        claimToken: sourceClaimToken,
        claimedUntil: new Date(Date.now() + 120000),
    });
    const manualCandidateId = sourceCarrier === 'communication_message'
        ? `manual_source:communication_message:${sourceMessagesDigest.slice(0, 16)}`
        : `manual_source:${sourceMessagesDigest.slice(0, 16)}`;

    if (sourceClaim.status === 'succeeded') {
        return {
            status: 'existing',
            candidateId: manualCandidateId,
            ...(sourceClaim.draftPostId ? { draftPostId: sourceClaim.draftPostId } : {}),
            created: false,
            ghostDraftGenerationId: null,
            sourceConsumption: {
                ...(sourceCarrier === 'communication_message' ? { sourceCarrier, sourceMaterialIds } : {}),
                sourceMessagesDigest,
                sourceMessageIds: selectedSourceMessageIds,
                filteredSourceMessageIds,
                blocking: true,
            },
        };
    }

    if (sourceClaim.status === 'pending') {
        return {
            status: 'pending',
            candidateId: manualCandidateId,
            claimedUntil: sourceClaim.claimedUntil ?? undefined,
            created: false,
            sourceConsumption: {
                ...(sourceCarrier === 'communication_message' ? { sourceCarrier, sourceMaterialIds } : {}),
                sourceMessagesDigest,
                sourceMessageIds: selectedSourceMessageIds,
                filteredSourceMessageIds,
                blocking: true,
            },
        };
    }

    const sourceCount = selectedSourceMessageIds.length;
    const notice = await publishCandidateNotices(prisma, {
        circleId: input.circleId,
        summary: sourceCarrier === 'communication_message'
            ? `Manual draft request from ${sourceCount} authorized communication message${sourceCount === 1 ? '' : 's'}.`
            : `Manual draft request from ${sourceCount} discussion message${sourceCount === 1 ? '' : 's'}.`,
        sourceMessageIds: selectedSourceMessageIds,
        ...(sourceCarrier === 'communication_message'
            ? { sourceCarrier, sourceMaterialIds, sourceRoomKey }
            : {}),
        sourceSemanticFacets: [],
        sourceAuthorAnnotations: [],
        draftPostId: null,
        triggerReason: 'manual_discussion_selection',
        sourceScope: input.sourceScope,
    }, input.redis);
    if (!notice?.candidateId) {
        throw new DraftCandidateAcceptanceError({
            statusCode: 500,
            code: 'draft_candidate_notice_failed',
            message: 'failed to prepare manual discussion draft candidate',
        });
    }

    let draftPostIdForSourceClaim: number | null = null;
    try {
        const result = await acceptDraftCandidateIntoDraft(prisma, {
            circleId: input.circleId,
            candidateId: notice.candidateId,
            actor,
            redis: input.redis,
        });

        if ((result.status === 'created' || result.status === 'existing') && result.draftPostId) {
            draftPostIdForSourceClaim = result.draftPostId;
            const sourceState = sourceCarrier === 'circle_discussion'
                ? await loadDiscussionDraftSourceState(prisma, input.circleId)
                : null;
            const advanceAutoCursor = sourceCarrier === 'circle_discussion' && sourceToLamport
                ? await doesSourceCoverCompleteEligibleInterval(prisma, {
                    circleId: input.circleId,
                    sourceMessageIds: selectedSourceMessageIds,
                    lastAutoSourceToLamport: sourceState?.lastAutoSourceToLamport ?? null,
                    sourceToLamport,
                })
                : false;
            const partialOverlapSourceMessageIds = await listConsumedDiscussionDraftSourceEnvelopeIds(prisma, {
                circleId: input.circleId,
                ...(sourceCarrier === 'communication_message' ? { sourceCarrier } : {}),
                envelopeIds: selectedSourceMessageIds,
            });
            const completion = await completeDiscussionDraftSourceClaim(prisma, {
                circleId: input.circleId,
                ...(sourceCarrier === 'communication_message' ? { sourceCarrier } : {}),
                sourceMessagesDigest,
                claimToken: sourceClaim.claimToken,
                draftPostId: result.draftPostId,
                sourceKind: 'manual_selection',
                sourceMessages: selectedSourceMessages,
                advanceAutoCursor,
                autoSourceFromLamport: sourceFromLamport,
                autoSourceToLamport: sourceToLamport,
            }) as { partialOverlapSourceMessageIds?: string[] } | null;

            return {
                ...result,
                sourceConsumption: {
                    ...(sourceCarrier === 'communication_message' ? { sourceCarrier, sourceMaterialIds } : {}),
                    sourceMessagesDigest,
                    sourceMessageIds: selectedSourceMessageIds,
                    filteredSourceMessageIds,
                    partialOverlapSourceMessageIds:
                        completion?.partialOverlapSourceMessageIds ?? partialOverlapSourceMessageIds,
                    blocking: false,
                    advanceAutoCursor,
                },
            };
        }

        if (result.status === 'generation_failed') {
            await failDiscussionDraftSourceClaim(prisma, {
                circleId: input.circleId,
                ...(sourceCarrier === 'communication_message' ? { sourceCarrier } : {}),
                sourceMessagesDigest,
                claimToken: sourceClaim.claimToken,
                failureReason: result.draftGenerationError ?? 'generation_failed',
            });
        }

        return result;
    } catch (error) {
        if (!draftPostIdForSourceClaim) {
            try {
                await failDiscussionDraftSourceClaim(prisma, {
                    circleId: input.circleId,
                    ...(sourceCarrier === 'communication_message' ? { sourceCarrier } : {}),
                    sourceMessagesDigest,
                    claimToken: sourceClaim.claimToken,
                    failureReason: error instanceof Error ? error.message : String(error || 'manual_selection_failed'),
                });
            } catch (claimError) {
                const message = claimError instanceof Error ? claimError.message : String(claimError);
                console.warn(`candidate acceptance: failed to mark manual source claim failed (${message})`);
            }
        }
        throw error;
    }
}
