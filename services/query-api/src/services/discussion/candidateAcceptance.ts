import crypto from 'node:crypto';
import { Prisma, type PrismaClient } from '@prisma/client';

import {
    DiscussionInitialDraftError,
    generateInitialDiscussionDraft,
} from '../../ai/discussion-initial-draft';
import { createDraftAnchorBatch } from '../draftAnchor';
import {
    createDraftVersionSnapshot,
    updateDraftVersionSnapshotSourceEvidence,
} from '../draftLifecycle/versionSnapshots';
import { requireCircleManagerRole } from '../membership/checks';
import { buildDiscussionRoomKey } from '../offchainDiscussion';
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
import { publishDraftCandidateSystemNotices } from './systemNoticeProducer';

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
    userId: number | null | undefined;
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
        sourceSemanticFacets: SemanticFacet[];
        sourceAuthorAnnotations: AuthorAnnotationKind[];
    };

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
        sourceSemanticFacets: normalizeSemanticFacets(
            metadata.sourceSemanticFacets ?? metadata.sourceDiscussionLabels,
        ),
        sourceAuthorAnnotations: normalizeAuthorAnnotations(metadata.sourceAuthorAnnotations),
        lastProposalId: typeof metadata.lastProposalId === 'string' && metadata.lastProposalId.trim()
            ? metadata.lastProposalId.trim()
            : null,
        draftPostId: normalizePositiveInt(metadata.draftPostId),
    };
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
    if (!input.userId) {
        throw new DraftCandidateAcceptanceError({
            statusCode: 401,
            code: 'authentication_required',
            message: 'authentication is required',
        });
    }
    const userId = input.userId;

    const canManage = await requireCircleManagerRole(prisma, {
        circleId: input.circleId,
        userId,
        allowModerator: true,
    });
    if (!canManage) {
        throw new DraftCandidateAcceptanceError({
            statusCode: 403,
            code: 'candidate_generation_forbidden',
            message: 'only circle managers can generate a draft from a candidate',
        });
    }

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
            await publishDraftCandidateSystemNotices(prisma, {
                circleId: input.circleId,
                summary: notice.summary || '',
                sourceMessageIds: notice.sourceMessageIds,
                sourceSemanticFacets: notice.sourceSemanticFacets,
                sourceAuthorAnnotations: notice.sourceAuthorAnnotations,
                draftPostId: null,
                triggerReason: 'manual_candidate_acceptance_pending',
                candidateStateOverride: 'pending',
                draftGenerationStatus: 'pending',
            });
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

    const initialDraft = await generateInitialDiscussionDraft(prisma, {
        circleId: input.circleId,
        circleName: circle.name,
        circleDescription: circle.description,
        sourceMessageIds: notice.sourceMessageIds,
    }).catch((error) => {
        if (error instanceof DraftCandidateAcceptanceError) throw error;
        if (error instanceof DiscussionInitialDraftError) {
            return {
                error,
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
            await publishDraftCandidateSystemNotices(prisma, {
                circleId: input.circleId,
                summary: notice.summary || '',
                sourceMessageIds: notice.sourceMessageIds,
                sourceSemanticFacets: notice.sourceSemanticFacets,
                sourceAuthorAnnotations: notice.sourceAuthorAnnotations,
                draftPostId: null,
                triggerReason: 'manual_candidate_acceptance_failed',
                candidateStateOverride: 'generation_failed',
                draftGenerationError: generationError.code,
            });
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
                sourceDigest: initialDraft.sourceDigest,
                providerMode: initialDraft.generationMetadata.providerMode,
                model: initialDraft.generationMetadata.model,
                promptAsset: initialDraft.generationMetadata.promptAsset,
                promptVersion: initialDraft.generationMetadata.promptVersion,
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
                roomKey: buildDiscussionRoomKey(input.circleId),
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
            await publishDraftCandidateSystemNotices(prisma, {
                circleId: input.circleId,
                summary: createdDraft.summary || '',
                sourceMessageIds: createdDraft.sourceMessageIds,
                sourceSemanticFacets: createdDraft.sourceSemanticFacets,
                sourceAuthorAnnotations: createdDraft.sourceAuthorAnnotations,
                draftPostId: createdDraft.draftPostId,
                triggerReason: 'manual_candidate_acceptance',
            });
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
