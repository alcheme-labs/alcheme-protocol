import { enqueueAiJob } from '../../aiJobs/runtime';
import {
    loadNodeRuntimeConfig,
} from '../../../config/services';
import {
    buildContextCapsule,
    persistContextCapsule,
} from '../contextFabric';
import {
    createEvaluationArtifact,
    serializeEvaluationArtifact,
    updateEvaluationArtifact,
} from './artifacts';
import {
    selectNeutralEvaluationSubjectEvidence,
} from './subjects';
import {
    NEUTRAL_EVALUATION_MAX_OUTPUT_TOKENS,
    NEUTRAL_EVALUATION_SCHEMA_VERSION,
    NEUTRAL_EVALUATION_TASK_TYPE,
    type NeutralEvaluationSubjectType,
} from './types';

export type QueueNeutralEvaluationResult =
    | {
        ok: true;
        status: 'queued';
        artifactId: string;
        jobId: number;
        contextCapsuleId: string;
    }
    | {
        ok: true;
        status: 'no_source' | 'blocked_transcript_review';
        artifactId: string;
        artifact: Record<string, unknown>;
    };

export async function queueNeutralEvaluation(
    prisma: any,
    input: {
        circleId: number;
        subjectType: NeutralEvaluationSubjectType;
        subjectId: string;
        authorUserId?: number | null;
        requestedByUserId?: number | null;
        locale?: string;
        now?: Date;
    },
): Promise<QueueNeutralEvaluationResult> {
    const now = input.now ?? new Date();
    const selection = await selectNeutralEvaluationSubjectEvidence(prisma, {
        circleId: input.circleId,
        subjectType: input.subjectType,
        subjectId: input.subjectId,
        includeProviderContext: false,
    });
    const authorUserId = selection.authorUserId ?? input.authorUserId ?? null;
    const baseArtifact = await createEvaluationArtifact(prisma, {
        circleId: input.circleId,
        subjectType: input.subjectType,
        subjectId: String(input.subjectId),
        authorUserId,
        requestedByUserId: input.requestedByUserId ?? null,
        status: selection.status === 'ready' ? 'pending' : selection.status,
        visibility: 'private',
        reviewStatus: 'unreviewed',
        appealStatus: 'none',
        transcriptReviewStatus: selection.status === 'blocked_transcript_review'
            ? String(selection.subjectSnapshot.lifecycleStatus || 'review_pending')
            : null,
        transcriptSourceMaterialId: input.subjectType === 'source_material'
            ? Number(input.subjectId)
            : null,
        evidenceRefs: selection.evidenceRefs,
        sourceDigest: selection.sourceDigest,
        subjectSnapshot: selection.subjectSnapshot,
        failureCode: selection.status === 'ready' ? null : selection.blockReason ?? 'no_accessible_source',
        outputSchemaVersion: NEUTRAL_EVALUATION_SCHEMA_VERSION,
    });

    const artifactId = String(baseArtifact.id);
    if (selection.status !== 'ready') {
        return {
            ok: true,
            status: selection.status,
            artifactId,
            artifact: serializeEvaluationArtifact(baseArtifact),
        };
    }

    const runtime = loadNodeRuntimeConfig();
    const context = buildContextCapsule({
        taskType: NEUTRAL_EVALUATION_TASK_TYPE,
        subjectType: input.subjectType,
        subjectId: String(input.subjectId),
        actorUserId: input.requestedByUserId ?? null,
        visibility: 'member_visible',
        runtimeRole: runtime.runtimeRole,
        evidenceRefs: selection.evidenceRefs,
        contextPayload: {
            kind: 'evaluation_neutral.v1',
            artifactId,
            circleId: input.circleId,
            subjectType: input.subjectType,
            subjectId: String(input.subjectId),
            sourceDigest: selection.sourceDigest,
            locale: normalizeLocale(input.locale),
        },
        excerptPolicy: {
            mode: 'metadata_only',
            redaction: 'neutral_evaluation_v1',
            citationStyle: 'evaluation_panel',
        },
        tokenBudget: {
            maxInputTokens: 4000,
            maxOutputTokens: NEUTRAL_EVALUATION_MAX_OUTPUT_TOKENS,
            maxEvidenceRefs: 8,
            maxExcerptChars: 2200,
        },
        privatePlaintextMode: selection.requiresPrivatePlaintext ? 'private_plaintext' : 'member_visible',
    });
    if (!context.ok) {
        await updateEvaluationArtifact(prisma, artifactId, {
            status: 'failed',
            failureCode: `context_rejected_${context.error}`,
        });
        throw new Error(`neutral_evaluation_context_rejected:${context.error}`);
    }

    await persistContextCapsule(prisma, context.capsule, {
        cacheKey: `neutral_evaluation:${artifactId}`,
        expiresAt: new Date(now.getTime() + 24 * 3_600_000),
    });
    await updateEvaluationArtifact(prisma, artifactId, {
        contextCapsuleId: context.capsule.id,
    });
    const job = await enqueueAiJob(prisma, {
        jobType: 'neutral_evaluation_generate',
        taskType: NEUTRAL_EVALUATION_TASK_TYPE,
        taskCatalogVersion: 'v1',
        contextCapsuleId: context.capsule.id,
        dedupeKey: `neutral_evaluation:${artifactId}`,
        scopeType: 'circle',
        scopeCircleId: input.circleId,
        requestedByUserId: input.requestedByUserId ?? null,
        payload: {
            artifactId,
            circleId: input.circleId,
            subjectType: input.subjectType,
            subjectId: String(input.subjectId),
            outputSchemaVersion: NEUTRAL_EVALUATION_SCHEMA_VERSION,
        },
    });
    await updateEvaluationArtifact(prisma, artifactId, {
        aiJobId: job.id,
    });

    return {
        ok: true,
        status: 'queued',
        artifactId,
        jobId: job.id,
        contextCapsuleId: context.capsule.id,
    };
}

function normalizeLocale(value: unknown): string {
    const normalized = String(value || '').trim().toLowerCase().split(/[-_]/)[0];
    return ['en', 'zh', 'fr', 'es'].includes(normalized) ? normalized : 'en';
}
