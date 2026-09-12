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
    loadKnowledgeRelationshipCoverageAuditContext,
    persistKnowledgeRelationshipCoverageAuditContext,
} from './context';
import {
    buildCooldownBucket,
    buildCooldownUntil,
    buildKnowledgeRelationshipProposalIdempotency,
    buildProposalExpiry,
    createKnowledgeRelationshipLabelCatalogProposal,
    notifyKnowledgeRelationshipLabelProposalOperators,
} from './proposals';
import { parseKnowledgeRelationshipCoverageAuditOutput } from './schema';
import {
    KNOWLEDGE_RELATIONSHIP_LABEL_COVERAGE_AUDIT_TASK_TYPE,
    type KnowledgeRelationshipCoverageRecommendation,
} from './types';

export function isKnowledgeRelationshipCoverageAuditEnabled(env: NodeJS.ProcessEnv = process.env): boolean {
    return String(env.AI_KNOWLEDGE_RELATIONSHIP_LABEL_COVERAGE_AUDIT_ENABLED ?? 'true')
        .trim()
        .toLowerCase() !== 'false';
}

export async function enqueueKnowledgeRelationshipCoverageAudit(input: {
    prisma: any;
    circleId?: number | null;
    now?: Date;
}): Promise<{
    jobId: number | null;
    contextCapsuleId: string;
    sourceDigest: string;
    contextDigest: string;
} | null> {
    if (!isKnowledgeRelationshipCoverageAuditEnabled()) return null;
    const context = await persistKnowledgeRelationshipCoverageAuditContext({
        prisma: input.prisma,
        circleId: input.circleId,
        now: input.now,
    });
    const scope = context.payload.scope;
    const job = await enqueueAiJob(input.prisma, {
        jobType: 'knowledge_relationship_label_coverage_audit',
        taskType: KNOWLEDGE_RELATIONSHIP_LABEL_COVERAGE_AUDIT_TASK_TYPE,
        taskCatalogVersion: 'v1',
        contextCapsuleId: context.capsuleId,
        dedupeKey: `knowledge_relationship_label_coverage_audit:${scope.type}:${scope.circleId ?? 'system'}:${context.contextDigest}`,
        scopeType: scope.type === 'circle' ? 'circle' : 'system',
        scopeCircleId: scope.circleId,
        requestedByUserId: null,
        maxAttempts: 2,
        payload: {
            scopeType: scope.type,
            circleId: scope.circleId,
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

export async function processKnowledgeRelationshipCoverageAuditJob(
    prisma: any,
    input: {
        job: AiJobRecord;
    },
): Promise<Record<string, unknown>> {
    const expectedCircleId = Number(input.job.scopeCircleId ?? input.job.payload?.circleId ?? 0);
    const context = await loadKnowledgeRelationshipCoverageAuditContext(prisma, {
        contextCapsuleId: input.job.contextCapsuleId,
        expectedCircleId: Number.isFinite(expectedCircleId) && expectedCircleId > 0 ? expectedCircleId : null,
    });
    assertJobDigestMatchesContext(input.job, context);
    const promptMetadata = getPromptMetadata('knowledge-relationship-label-coverage-audit');

    if (!isKnowledgeRelationshipCoverageAuditEnabled()) {
        return {
            status: 'disabled',
            taskType: KNOWLEDGE_RELATIONSHIP_LABEL_COVERAGE_AUDIT_TASK_TYPE,
            scope: context.payload.scope,
            proposalArtifactIds: [],
            fallbackUsed: true,
            failureCode: 'knowledge_relationship_coverage_audit_disabled',
            modelProfile: null,
            promptVersion: promptMetadata.promptVersion,
            sourceDigest: context.sourceDigest,
        };
    }

    let modelProfile: string | null = null;
    let recommendations: KnowledgeRelationshipCoverageRecommendation[] = [];
    let coverageSummary = '';
    try {
        const capability = await callAiCapability({
            taskType: KNOWLEDGE_RELATIONSHIP_LABEL_COVERAGE_AUDIT_TASK_TYPE,
            capability: 'text.structure',
            privacyProfile: 'public_protocol',
            runtimeRole: 'PUBLIC_NODE',
            input: {
                systemPrompt: getSystemPrompt('knowledge-relationship-label-coverage-audit'),
                prompt: buildCoverageAuditUserPrompt(context.payload),
                responseFormat: {
                    type: 'json',
                    name: 'knowledge_relationship_label_coverage_audit',
                    schema: getPromptSchema('knowledge-relationship-label-coverage-audit') ?? undefined,
                },
                temperature: 0.1,
                maxOutputTokens: 800,
            },
        });
        modelProfile = capability.model;
        const output = parseKnowledgeRelationshipCoverageAuditOutput({
            rawText: capability.output.text,
            activeLabelKeys: context.payload.activeLabelCatalog.map((item) => item.key),
        });
        recommendations = output.recommendations.filter((item) => item.action !== 'no_change');
        coverageSummary = output.coverageSummary;
    } catch (error) {
        throwAiGenerationFailure(error);
    }

    const proposalArtifactIds: string[] = [];
    const notificationStatuses: string[] = [];
    const now = new Date();
    for (const recommendation of recommendations) {
        const cooldownBucket = buildCooldownBucket(
            now,
            `${context.payload.scope.type}:${context.payload.scope.circleId ?? 'system'}`,
        );
        const proposal = await createKnowledgeRelationshipLabelCatalogProposal(prisma, {
            taskType: KNOWLEDGE_RELATIONSHIP_LABEL_COVERAGE_AUDIT_TASK_TYPE,
            subjectType: 'knowledge_relationship_label_catalog',
            subjectId: context.payload.scope.circleId
                ? `circle:${context.payload.scope.circleId}`
                : 'system',
            idempotencyKey: buildKnowledgeRelationshipProposalIdempotency({
                taskType: KNOWLEDGE_RELATIONSHIP_LABEL_COVERAGE_AUDIT_TASK_TYPE,
                subjectId: context.payload.scope.circleId
                    ? `circle:${context.payload.scope.circleId}`
                    : 'system',
                sourceDigest: context.sourceDigest,
                proposalKey: buildRecommendationKey(recommendation),
                cooldownBucket,
            }),
            sourceDigest: context.sourceDigest,
            contextCapsuleId: context.capsuleId,
            evidenceRefs: context.evidenceRefs,
            modelProfile,
            promptVersion: promptMetadata.promptVersion,
            explanation: recommendation.reason || coverageSummary,
            recommendation,
            cooldownBucket,
            cooldownUntil: buildCooldownUntil(now),
            expiresAt: buildProposalExpiry(now),
        });
        if (typeof proposal?.id === 'string') {
            proposalArtifactIds.push(proposal.id);
            if ((proposal as any).deduped) {
                continue;
            }
            const notification = await notifyKnowledgeRelationshipLabelProposalOperators(prisma, {
                proposalId: proposal.id,
                title: `Knowledge label coverage proposal: ${recommendation.action}`,
                summary: recommendation.reason || coverageSummary,
            });
            notificationStatuses.push(notification.status);
        }
    }

    return {
        status: recommendations.length > 0 ? 'proposal_ready' : 'no_change',
        taskType: KNOWLEDGE_RELATIONSHIP_LABEL_COVERAGE_AUDIT_TASK_TYPE,
        scope: context.payload.scope,
        recommendationCount: recommendations.length,
        proposalArtifactIds,
        notificationStatuses,
        fallbackUsed: false,
        failureCode: null,
        modelProfile,
        promptVersion: promptMetadata.promptVersion,
        sourceDigest: context.sourceDigest,
    };
}

function buildCoverageAuditUserPrompt(
    payload: Awaited<ReturnType<typeof loadKnowledgeRelationshipCoverageAuditContext>>['payload'],
): string {
    return JSON.stringify({
        task: KNOWLEDGE_RELATIONSHIP_LABEL_COVERAGE_AUDIT_TASK_TYPE,
        scope: payload.scope,
        activeLabelCatalog: payload.activeLabelCatalog,
        assignmentStats: payload.assignmentStats,
        recentAssignmentSamples: payload.recentAssignmentSamples,
        instructions: {
            proposeCatalogChangesOnly: true,
            doNotActivateLabels: true,
            operatorReviewRequired: true,
            preferNoChangeWhenCurrentCatalogCoversTheObservedAssignments: true,
        },
    });
}

function buildRecommendationKey(recommendation: KnowledgeRelationshipCoverageRecommendation): string {
    return [
        recommendation.action,
        recommendation.labelKey ?? '',
        recommendation.proposedLabel?.key ?? '',
        recommendation.reason,
    ].join(':');
}

function assertJobDigestMatchesContext(
    job: AiJobRecord,
    context: Awaited<ReturnType<typeof loadKnowledgeRelationshipCoverageAuditContext>>,
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

function normalizeString(value: unknown): string {
    return typeof value === 'string' ? value.trim() : '';
}
