import type { Prisma, PrismaClient } from '@prisma/client';
import { ensureDefaultKnowledgeRelationshipAssignment } from './knowledgeRelationshipLabels';
import { enqueueKnowledgeRelationshipLabelClassification } from './knowledgeRelationshipLabelAi/classifier';
import { loadDraftVersionSnapshot } from './draftLifecycle/versionSnapshots';
import { hashCanonicalGovernanceValue } from './governance/canonicalCodec';

type PrismaLike = PrismaClient | Prisma.TransactionClient;

export class CrystallizationBindingError extends Error {
    constructor(
        public readonly code: string,
        public readonly statusCode: number,
        message?: string,
        public readonly details: Record<string, unknown> | null = null,
    ) {
        super(message || code);
        this.name = 'CrystallizationBindingError';
    }
}

export type KnowledgePublicationOrigin = {
    schemaVersion: 1;
    kind: 'ordinary_collaboration' | 'governance_case_outcome';
    draftPostId: number;
    draftVersion: number;
    snapshotDigest: string;
    routingReceiptDigest: string;
    caseId: string | null;
    requestId: string | null;
    decisionDigest: string | null;
    executionReceiptId: string | null;
    executionStatus: 'not_applicable' | 'executed';
    outcome: 'ordinary' | 'accepted';
    governanceHome: { type: 'circle'; ref: string };
    targetCircleId: number;
    committeeCircleId: number | null;
    submittedByPubkey: string;
    submitAuthoritySemantics: 'legacy_author';
};

export async function resolveKnowledgePublicationOrigin(
    prisma: PrismaLike,
    draftPostId: number,
): Promise<{ origin: KnowledgePublicationOrigin; digest: string }> {
    const workflow = await prisma.draftWorkflowState.findUnique({
        where: { draftPostId },
        select: {
            documentStatus: true,
            currentSnapshotVersion: true,
            crystallizationPolicyProfileDigest: true,
        },
    });
    if (!workflow || workflow.documentStatus !== 'crystallization_active') {
        throw new CrystallizationBindingError(
            'draft_not_ready_for_crystallization_execution',
            409,
            'Knowledge publication requires the current Draft crystallization lifecycle',
        );
    }
    const snapshot = await loadDraftVersionSnapshot(prisma as PrismaClient, {
        draftPostId,
        draftVersion: workflow.currentSnapshotVersion,
    });
    const receipt = snapshot?.crystallizationRoutingReceipt;
    if (
        !snapshot
        || !receipt
        || receipt.draftPostId !== draftPostId
        || receipt.draftVersion !== workflow.currentSnapshotVersion
        || receipt.snapshotContentHash !== snapshot.contentHash
        || receipt.policyProfileDigest !== workflow.crystallizationPolicyProfileDigest
    ) {
        throw new CrystallizationBindingError(
            'crystallization_routing_receipt_required',
            409,
            'Knowledge publication requires the canonical Draft routing receipt',
        );
    }
    const actorUserId = Number(receipt.actorUserId);
    const [draft, submitter] = await Promise.all([
        prisma.post.findUnique({
            where: { id: draftPostId },
            select: { circleId: true },
        }),
        Number.isInteger(actorUserId) && actorUserId > 0
            ? prisma.user.findUnique({
                where: { id: actorUserId },
                select: { pubkey: true },
            })
            : Promise.resolve(null),
    ]);
    const targetCircleId = Number(draft?.circleId);
    const submittedByPubkey = String(submitter?.pubkey || '').trim();
    if (!Number.isInteger(targetCircleId) || targetCircleId <= 0 || !submittedByPubkey) {
        throw new CrystallizationBindingError(
            'knowledge_publication_attribution_unavailable',
            409,
            'Knowledge publication requires a Circle Governance Home and submit authority',
        );
    }
    const attribution = {
        governanceHome: { type: 'circle' as const, ref: String(targetCircleId) },
        targetCircleId,
        submittedByPubkey,
        submitAuthoritySemantics: 'legacy_author' as const,
    };

    let origin: KnowledgePublicationOrigin;
    if (receipt.path === 'ordinary_knowledge') {
        if (receipt.actionIntent !== 'none' || receipt.humanConfirmed !== true) {
            throw new CrystallizationBindingError(
                'crystallization_routing_receipt_required',
                409,
                'ordinary Knowledge publication requires explicit no-action confirmation',
            );
        }
        origin = {
            schemaVersion: 1,
            kind: 'ordinary_collaboration',
            draftPostId,
            draftVersion: snapshot.draftVersion,
            snapshotDigest: snapshot.contentHash,
            routingReceiptDigest: receipt.receiptDigest,
            caseId: null,
            requestId: null,
            decisionDigest: null,
            executionReceiptId: null,
            executionStatus: 'not_applicable',
            outcome: 'ordinary',
            ...attribution,
            committeeCircleId: null,
        };
    } else {
        const request = await prisma.governanceRequest.findUnique({
            where: { id: receipt.requestId },
            include: {
                governanceCase: {
                    include: {
                        homeIdentityBinding: {
                            select: { homeType: true, homeRef: true },
                        },
                    },
                },
                decision: true,
                receipts: {
                    where: {
                        executorModule: 'draft_governance',
                        executionStatus: 'executed',
                    },
                    orderBy: { executedAt: 'desc' },
                },
            },
        });
        const proposal = await prisma.revisionDirectionProposal.findUnique({
            where: { revisionProposalId: receipt.targetRef },
        });
        const decision = request?.decision;
        const execution = request?.receipts?.[0] ?? null;
        const governanceCase = request?.governanceCase;
        const committeeCircleId = Number(request?.scopeRef);
        if (
            !request
            || request.state !== 'accepted'
            || request.id !== receipt.requestId
            || request.caseRef !== receipt.caseId
            || request.actionType !== receipt.actionType
            || request.targetType !== receipt.targetType
            || request.targetRef !== receipt.targetRef
            || !governanceCase
            || governanceCase.id !== receipt.caseId
            || governanceCase.primaryRequestId !== request.id
            || governanceCase.briefDraftPostId !== draftPostId
            || governanceCase.briefDraftVersion !== snapshot.draftVersion
            || governanceCase.briefSnapshotDigest !== snapshot.contentHash
            || governanceCase.homeIdentityBinding?.homeType !== 'circle'
            || governanceCase.homeIdentityBinding.homeRef !== String(targetCircleId)
            || request.scopeType !== 'circle_governance_committee'
            || !Number.isInteger(committeeCircleId)
            || committeeCircleId <= 0
            || !decision
            || decision.decision !== 'accepted'
            || !execution
            || execution.actionType !== receipt.actionType
            || execution.executionRef !== receipt.targetRef
            || execution.decisionDigest !== decision.decisionDigest
            || !proposal
            || proposal.status !== 'accepted'
            || proposal.governanceRequestId !== request.id
            || proposal.draftPostId !== draftPostId
            || proposal.draftVersion !== snapshot.draftVersion
        ) {
            throw new CrystallizationBindingError(
                'governed_knowledge_outcome_not_accepted',
                409,
                'governed Knowledge publication requires a Case-linked accepted Request decision and executed effect',
            );
        }
        origin = {
            schemaVersion: 1,
            kind: 'governance_case_outcome',
            draftPostId,
            draftVersion: snapshot.draftVersion,
            snapshotDigest: snapshot.contentHash,
            routingReceiptDigest: receipt.receiptDigest,
            caseId: governanceCase.id,
            requestId: request.id,
            decisionDigest: decision.decisionDigest,
            executionReceiptId: execution.id,
            executionStatus: 'executed',
            outcome: 'accepted',
            ...attribution,
            committeeCircleId,
        };
    }
    return {
        origin,
        digest: hashCanonicalGovernanceValue(
            'alcheme.knowledge.publication-origin.v1',
            origin,
        ),
    };
}

async function syncRelationshipAssignmentSourceDraft(
    prisma: PrismaLike,
    input: {
        knowledgeId: string;
        draftPostId: number;
    },
): Promise<void> {
    await ensureDefaultKnowledgeRelationshipAssignment(prisma, {
        knowledgeId: input.knowledgeId,
        sourceDraftId: `post:${input.draftPostId}`,
    });
    await enqueueRelationshipLabelClassificationBestEffort(prisma, {
        knowledgeId: input.knowledgeId,
        sourceDraftId: `post:${input.draftPostId}`,
    });
}

async function enqueueRelationshipLabelClassificationBestEffort(
    prisma: PrismaLike,
    input: {
        knowledgeId: string;
        sourceDraftId: string;
    },
): Promise<void> {
    try {
        await enqueueKnowledgeRelationshipLabelClassification({
            prisma,
            knowledgeId: input.knowledgeId,
            sourceDraftId: input.sourceDraftId,
        });
    } catch (error) {
        console.warn('[knowledge relationship label AI] enqueue skipped', {
            knowledgeId: input.knowledgeId,
            reason: error instanceof Error ? error.message : String(error),
        });
    }
}

export async function bindKnowledgeToDraftSource(
    prisma: PrismaLike,
    input: {
        draftPostId: number;
        knowledgeOnChainAddress: string;
    },
) {
    const draft = await prisma.post.findUnique({
        where: { id: input.draftPostId },
        select: {
            id: true,
            circleId: true,
            contentId: true,
            heatScore: true,
        },
    });
    if (!draft) {
        throw new CrystallizationBindingError('draft_not_found', 404, 'draft not found');
    }
    if (!draft.circleId) {
        throw new CrystallizationBindingError('draft_circle_required', 409, 'draft must be circle-bound');
    }
    if (!draft.contentId) {
        throw new CrystallizationBindingError('draft_content_id_missing', 409, 'draft content id is missing');
    }

    const knowledge = await prisma.knowledge.findUnique({
        where: { onChainAddress: input.knowledgeOnChainAddress },
        select: {
            id: true,
            knowledgeId: true,
            circleId: true,
            sourceContentId: true,
            publicationOrigin: true,
            publicationOriginDigest: true,
            heatScore: true,
            author: { select: { pubkey: true } },
        },
    });
    if (!knowledge) {
        throw new CrystallizationBindingError(
            'knowledge_not_indexed',
            409,
            'knowledge is not indexed yet',
            {
                knowledgeOnChainAddress: input.knowledgeOnChainAddress,
                projectionHint: 'knowledge row missing or indexed under fallback address; run chain projection audit',
            },
        );
    }
    if (knowledge.circleId !== draft.circleId) {
        throw new CrystallizationBindingError('knowledge_circle_mismatch', 409, 'draft and knowledge circle mismatch');
    }
    if (knowledge.sourceContentId && knowledge.sourceContentId !== draft.contentId) {
        throw new CrystallizationBindingError('knowledge_source_conflict', 409, 'knowledge is already bound to another draft source');
    }
    const publication = await resolveKnowledgePublicationOrigin(prisma, input.draftPostId);
    if (String(knowledge.author?.pubkey || '').trim() !== publication.origin.submittedByPubkey) {
        throw new CrystallizationBindingError(
            'knowledge_submit_authority_mismatch',
            409,
            'the indexed legacy author must match the frozen Knowledge submit authority',
        );
    }
    if (
        knowledge.publicationOriginDigest
        && knowledge.publicationOriginDigest !== publication.digest
    ) {
        throw new CrystallizationBindingError(
            'knowledge_publication_origin_conflict',
            409,
            'knowledge is already bound to a different publication origin',
        );
    }

    if (knowledge.sourceContentId === draft.contentId) {
        if (!knowledge.publicationOriginDigest) {
            await prisma.knowledge.update({
                where: { id: knowledge.id },
                data: {
                    publicationOrigin: publication.origin as unknown as Prisma.InputJsonValue,
                    publicationOriginDigest: publication.digest,
                },
            });
        }
        await syncRelationshipAssignmentSourceDraft(prisma, {
            knowledgeId: knowledge.knowledgeId,
            draftPostId: draft.id,
        });
        return {
            knowledgeId: knowledge.knowledgeId,
            sourceContentId: draft.contentId,
            sourceDraftHeatScore: Number(draft.heatScore ?? 0),
            knowledgeHeatScore: Number(knowledge.heatScore ?? 0),
            created: false,
            publicationOrigin: publication.origin,
            publicationOriginDigest: publication.digest,
        };
    }

    const knowledgeHeatScore = Number(knowledge.heatScore ?? 0);
    const seededHeatScore = knowledgeHeatScore > 0
        ? knowledgeHeatScore
        : Number(draft.heatScore ?? 0);

    const updated = await prisma.knowledge.update({
        where: { id: knowledge.id },
        data: {
            sourceContentId: draft.contentId,
            publicationOrigin: publication.origin as unknown as Prisma.InputJsonValue,
            publicationOriginDigest: publication.digest,
            heatScore: seededHeatScore,
        },
        select: {
            id: true,
            knowledgeId: true,
            sourceContentId: true,
            heatScore: true,
        },
    });

    await syncRelationshipAssignmentSourceDraft(prisma, {
        knowledgeId: updated.knowledgeId,
        draftPostId: draft.id,
    });

    return {
        knowledgeId: updated.knowledgeId,
        sourceContentId: updated.sourceContentId,
        sourceDraftHeatScore: Number(draft.heatScore ?? 0),
        knowledgeHeatScore: Number(updated.heatScore ?? 0),
        created: true,
        publicationOrigin: publication.origin,
        publicationOriginDigest: publication.digest,
    };
}
