import {
    getPromptMetadata,
    getPromptSchema,
    getSystemPrompt,
} from '../../ai/prompts/registry';
import type { AiJobRecord } from '../aiJobs/types';
import { enqueueAiJob } from '../aiJobs/runtime';
import { callAiCapability } from '../aiOperatingLayer/capabilities/adapter';
import { throwAiGenerationFailure } from '../aiOperatingLayer/generationFailure';
import {
    assignKnowledgeRelationshipLabel,
    DEFAULT_KNOWLEDGE_RELATIONSHIP_LABEL_KEY,
} from '../knowledgeRelationshipLabels';
import {
    persistKnowledgeRelationshipLabelClassificationContext,
    loadKnowledgeRelationshipLabelClassificationContext,
} from './context';
import {
    buildCooldownBucket,
    buildCooldownUntil,
    buildKnowledgeRelationshipProposalIdempotency,
    buildProposalExpiry,
    createKnowledgeRelationshipLabelCatalogProposal,
    notifyKnowledgeRelationshipLabelProposalOperators,
} from './proposals';
import {
    buildFallbackKnowledgeRelationshipLabelDecision,
    parseKnowledgeRelationshipLabelDecision,
} from './schema';
import {
    KNOWLEDGE_RELATIONSHIP_LABEL_CLASSIFY_TASK_TYPE,
    KNOWLEDGE_RELATIONSHIP_LABEL_MIN_CONFIDENCE,
    type KnowledgeRelationshipLabelDecision,
} from './types';

export function isKnowledgeRelationshipLabelAiEnabled(env: NodeJS.ProcessEnv = process.env): boolean {
    return String(env.AI_KNOWLEDGE_RELATIONSHIP_LABEL_AI_ENABLED ?? 'true')
        .trim()
        .toLowerCase() !== 'false';
}

export async function enqueueKnowledgeRelationshipLabelClassification(input: {
    prisma: any;
    knowledgeId: string;
    sourceDraftId?: string | null;
    now?: Date;
}): Promise<{
    jobId: number | null;
    contextCapsuleId: string;
    sourceDigest: string;
    contextDigest: string;
} | null> {
    if (!isKnowledgeRelationshipLabelAiEnabled()) return null;
    const context = await persistKnowledgeRelationshipLabelClassificationContext({
        prisma: input.prisma,
        knowledgeId: input.knowledgeId,
        sourceDraftId: input.sourceDraftId,
        now: input.now,
    });
    const job = await enqueueAiJob(input.prisma, {
        jobType: 'knowledge_relationship_label_classify',
        taskType: KNOWLEDGE_RELATIONSHIP_LABEL_CLASSIFY_TASK_TYPE,
        taskCatalogVersion: 'v1',
        contextCapsuleId: context.capsuleId,
        dedupeKey: `knowledge_relationship_label_classify:${input.knowledgeId}:${context.contextDigest}`,
        scopeType: 'circle',
        scopeCircleId: context.payload.circleId,
        requestedByUserId: null,
        maxAttempts: 2,
        payload: {
            knowledgeId: input.knowledgeId,
            sourceDigest: context.sourceDigest,
            contextDigest: context.contextDigest,
        },
    });
    return {
        jobId: Number.isFinite(Number(job?.id)) ? Number(job.id) : null,
        contextCapsuleId: context.capsuleId,
        sourceDigest: context.sourceDigest,
        contextDigest: context.contextDigest,
    };
}

export async function processKnowledgeRelationshipLabelClassificationJob(
    prisma: any,
    input: {
        job: AiJobRecord;
    },
): Promise<Record<string, unknown>> {
    const knowledgeId = normalizeString(input.job.payload?.knowledgeId ?? input.job.scopeDraftPostId);
    if (!knowledgeId) {
        throw new Error('invalid_knowledge_relationship_label_classify_job_payload');
    }
    const context = await loadKnowledgeRelationshipLabelClassificationContext(prisma, {
        contextCapsuleId: input.job.contextCapsuleId,
        expectedKnowledgeId: knowledgeId,
    });
    assertJobDigestMatchesContext(input.job, context);

    const promptMetadata = getPromptMetadata('knowledge-relationship-label-classifier');
    let modelProfile: string | null = null;
    let failureCode: string | null = null;
    let decision: KnowledgeRelationshipLabelDecision;

    if (!isKnowledgeRelationshipLabelAiEnabled()) {
        decision = buildFallbackKnowledgeRelationshipLabelDecision('knowledge relationship label AI is disabled');
        failureCode = 'knowledge_relationship_label_ai_disabled';
    } else {
        try {
            const capability = await callAiCapability({
                taskType: KNOWLEDGE_RELATIONSHIP_LABEL_CLASSIFY_TASK_TYPE,
                capability: 'text.structure',
                privacyProfile: 'public_protocol',
                runtimeRole: 'PUBLIC_NODE',
                input: {
                    systemPrompt: getSystemPrompt('knowledge-relationship-label-classifier'),
                    prompt: buildClassifierUserPrompt(context.payload),
                    responseFormat: {
                        type: 'json',
                        name: 'knowledge_relationship_label_classifier',
                        schema: getPromptSchema('knowledge-relationship-label-classifier') ?? undefined,
                    },
                    temperature: 0.1,
                    maxOutputTokens: 500,
                },
            });
            modelProfile = capability.model;
            decision = parseKnowledgeRelationshipLabelDecision({
                rawText: capability.output.text,
                activeLabelKeys: context.payload.activeLabelCatalog.map((item) => item.key),
                allowedSourceKnowledgeIds: context.payload.sourceKnowledge.map((item) => item.knowledgeId),
            });
        } catch (error) {
            throwAiGenerationFailure(error);
        }
    }

    const canApplyActiveLabel =
        !decision.needsHumanReview
        && !decision.proposedNewLabel
        && decision.confidence >= KNOWLEDGE_RELATIONSHIP_LABEL_MIN_CONFIDENCE
        && context.payload.activeLabelCatalog.some((label) => label.key === decision.labelKey);

    if (canApplyActiveLabel) {
        const assignment = await assignKnowledgeRelationshipLabel(prisma, {
            knowledgeId: context.payload.knowledge.knowledgeId,
            labelKey: decision.labelKey,
            sourceKnowledgeIds: decision.sourceKnowledgeIds,
            sourceDraftId: context.payload.sourceDraft.sourceDraftId,
            assignedBy: 'ai_classifier',
            confidence: decision.confidence,
            onlyIfDefaultOriginal: true,
        });
        return {
            status: assignment.updated ? 'assigned' : 'skipped',
            taskType: KNOWLEDGE_RELATIONSHIP_LABEL_CLASSIFY_TASK_TYPE,
            knowledgeId: context.payload.knowledge.knowledgeId,
            labelKey: decision.labelKey,
            confidence: decision.confidence,
            sourceKnowledgeIds: decision.sourceKnowledgeIds,
            assignmentUpdated: assignment.updated,
            skippedReason: assignment.updated ? null : assignment.reason,
            fallbackUsed: false,
            failureCode,
            modelProfile,
            promptVersion: promptMetadata.promptVersion,
            sourceDigest: context.sourceDigest,
        };
    }

    let proposalArtifactId: string | null = null;
    let notificationStatus: string | null = null;
    if (decision.proposedNewLabel) {
        const now = new Date();
        const cooldownBucket = buildCooldownBucket(now, `knowledge:${context.payload.knowledge.knowledgeId}`);
        const proposal = await createKnowledgeRelationshipLabelCatalogProposal(prisma, {
            taskType: KNOWLEDGE_RELATIONSHIP_LABEL_CLASSIFY_TASK_TYPE,
            subjectType: 'knowledge',
            subjectId: context.payload.knowledge.knowledgeId,
            idempotencyKey: buildKnowledgeRelationshipProposalIdempotency({
                taskType: KNOWLEDGE_RELATIONSHIP_LABEL_CLASSIFY_TASK_TYPE,
                subjectId: context.payload.knowledge.knowledgeId,
                sourceDigest: context.sourceDigest,
                proposalKey: decision.proposedNewLabel.key,
                cooldownBucket,
            }),
            sourceDigest: context.sourceDigest,
            contextCapsuleId: context.capsuleId,
            evidenceRefs: context.evidenceRefs,
            modelProfile,
            promptVersion: promptMetadata.promptVersion,
            explanation: decision.shortReason,
            decision,
            cooldownBucket,
            cooldownUntil: buildCooldownUntil(now),
            expiresAt: buildProposalExpiry(now),
        });
        proposalArtifactId = typeof proposal?.id === 'string' ? proposal.id : null;
        if (proposalArtifactId && !(proposal as any).deduped) {
            const notification = await notifyKnowledgeRelationshipLabelProposalOperators(prisma, {
                proposalId: proposalArtifactId,
                title: `Knowledge label proposal: ${decision.proposedNewLabel.displayName}`,
                summary: decision.shortReason,
            });
            notificationStatus = notification.status;
        }
    }

    return {
        status: decision.proposedNewLabel ? 'proposal_ready' : 'fallback_original',
        taskType: KNOWLEDGE_RELATIONSHIP_LABEL_CLASSIFY_TASK_TYPE,
        knowledgeId: context.payload.knowledge.knowledgeId,
        labelKey: DEFAULT_KNOWLEDGE_RELATIONSHIP_LABEL_KEY,
        proposedLabelKey: decision.proposedNewLabel?.key ?? null,
        confidence: decision.confidence,
        fallbackUsed: true,
        failureCode,
        proposalArtifactId,
        notificationStatus,
        modelProfile,
        promptVersion: promptMetadata.promptVersion,
        sourceDigest: context.sourceDigest,
    };
}

function buildClassifierUserPrompt(
    payload: Awaited<ReturnType<typeof loadKnowledgeRelationshipLabelClassificationContext>>['payload'],
): string {
    return JSON.stringify({
        task: KNOWLEDGE_RELATIONSHIP_LABEL_CLASSIFY_TASK_TYPE,
        knowledge: payload.knowledge,
        sourceDraft: payload.sourceDraft,
        sourceKnowledge: payload.sourceKnowledge,
        acceptedIssues: payload.acceptedIssues,
        evidenceSummary: payload.evidenceSummary,
        activeLabelCatalog: payload.activeLabelCatalog,
        instructions: {
            chooseOnlyActiveLabelKey: true,
            fallbackLabelKey: DEFAULT_KNOWLEDGE_RELATIONSHIP_LABEL_KEY,
            proposeNewLabelOnlyWhenCatalogIsInsufficient: true,
            doNotMutateKnowledgeOrCatalog: true,
        },
    });
}

function normalizeString(value: unknown): string {
    return typeof value === 'string' ? value.trim() : '';
}

function assertJobDigestMatchesContext(
    job: AiJobRecord,
    context: Awaited<ReturnType<typeof loadKnowledgeRelationshipLabelClassificationContext>>,
): void {
    const sourceDigest = normalizeString(job.payload?.sourceDigest);
    if (!sourceDigest) {
        throw new Error('context_capsule_source_digest_required');
    }
    if (sourceDigest && sourceDigest !== context.sourceDigest) {
        throw new Error('context_capsule_source_digest_mismatch');
    }
    const contextDigest = normalizeString(job.payload?.contextDigest);
    if (!contextDigest) {
        throw new Error('context_capsule_context_digest_required');
    }
    if (contextDigest && contextDigest !== context.contextDigest) {
        throw new Error('context_capsule_context_digest_mismatch');
    }
}
