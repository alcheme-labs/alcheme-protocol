import crypto from 'crypto';

import type {
    NeutralEvaluationAppealStatus,
    NeutralEvaluationReviewStatus,
    NeutralEvaluationStatus,
    NeutralEvaluationSubjectType,
    NeutralEvaluationVisibility,
} from './types';

const BLOCKED_PUBLIC_KEYS = new Set([
    'rawText',
    'rawPrompt',
    'privateText',
    'sourceExcerpt',
    'providerRawResponse',
    'providerTrace',
    'rankingAction',
    'reputationScore',
    'permissionChange',
    'contributorWeight',
    'receiptWeight',
    'proofPackageHash',
    'signature',
]);

export function buildEvaluationArtifactId(): string {
    return `eval_${crypto.randomUUID().replace(/-/g, '').slice(0, 24)}`;
}

export async function createEvaluationArtifact(prisma: any, input: {
    id?: string;
    circleId: number;
    subjectType: NeutralEvaluationSubjectType;
    subjectId: string;
    authorUserId?: number | null;
    requestedByUserId?: number | null;
    status: NeutralEvaluationStatus;
    visibility?: NeutralEvaluationVisibility;
    reviewStatus?: NeutralEvaluationReviewStatus;
    appealStatus?: NeutralEvaluationAppealStatus;
    transcriptReviewStatus?: string | null;
    transcriptSourceMaterialId?: number | null;
    summary?: string;
    claims?: unknown[];
    evidenceSummary?: unknown[];
    evidenceRefs?: unknown[];
    assumptions?: unknown[];
    evidenceGaps?: unknown[];
    counterpoints?: unknown[];
    verifiableNextSteps?: unknown[];
    neutralWordingSuggestion?: string;
    confidence?: string;
    limitations?: unknown[];
    sourceDigest: string;
    subjectSnapshot?: Record<string, unknown>;
    contextCapsuleId?: string | null;
    aiJobId?: number | null;
    modelProfile?: string | null;
    promptVersion?: string | null;
    outputSchemaVersion?: string;
    failureCode?: string | null;
}) {
    const data = sanitizePublicJson({
        id: input.id ?? buildEvaluationArtifactId(),
        circleId: input.circleId,
        subjectType: input.subjectType,
        subjectId: String(input.subjectId),
        authorUserId: input.authorUserId ?? null,
        requestedByUserId: input.requestedByUserId ?? null,
        status: input.status,
        visibility: input.visibility ?? 'private',
        reviewStatus: input.reviewStatus ?? 'unreviewed',
        appealStatus: input.appealStatus ?? 'none',
        transcriptReviewStatus: input.transcriptReviewStatus ?? null,
        transcriptSourceMaterialId: input.transcriptSourceMaterialId ?? null,
        summary: input.summary ?? '',
        claims: input.claims ?? [],
        evidenceSummary: input.evidenceSummary ?? [],
        evidenceRefs: input.evidenceRefs ?? [],
        assumptions: input.assumptions ?? [],
        evidenceGaps: input.evidenceGaps ?? [],
        counterpoints: input.counterpoints ?? [],
        verifiableNextSteps: input.verifiableNextSteps ?? [],
        neutralWordingSuggestion: input.neutralWordingSuggestion ?? '',
        confidence: input.confidence ?? 'low',
        limitations: input.limitations ?? [],
        sourceDigest: input.sourceDigest,
        subjectSnapshot: input.subjectSnapshot ?? {},
        contextCapsuleId: input.contextCapsuleId ?? null,
        aiJobId: input.aiJobId ?? null,
        modelProfile: input.modelProfile ?? null,
        promptVersion: input.promptVersion ?? null,
        outputSchemaVersion: input.outputSchemaVersion ?? 'v1',
        failureCode: input.failureCode ?? null,
    }) as Record<string, unknown>;
    if (typeof prisma?.evaluationArtifact?.create !== 'function') return data;
    return prisma.evaluationArtifact.create({ data });
}

export async function updateEvaluationArtifact(prisma: any, artifactId: string, data: Record<string, unknown>) {
    const safeData = sanitizePublicJson(data) as Record<string, unknown>;
    if (typeof prisma?.evaluationArtifact?.update !== 'function') {
        return { id: artifactId, ...safeData };
    }
    return prisma.evaluationArtifact.update({
        where: { id: artifactId },
        data: safeData,
    });
}

export async function getEvaluationArtifact(prisma: any, artifactId: string) {
    if (typeof prisma?.evaluationArtifact?.findUnique !== 'function') return null;
    return prisma.evaluationArtifact.findUnique({
        where: { id: artifactId },
    });
}

export async function listEvaluationArtifacts(prisma: any, input: {
    circleId: number;
    subjectType?: string | null;
    subjectId?: string | null;
    actorUserId?: number | null;
    publicOnly?: boolean;
    limit?: number;
}) {
    if (typeof prisma?.evaluationArtifact?.findMany !== 'function') return [];
    return prisma.evaluationArtifact.findMany({
        where: {
            circleId: input.circleId,
            ...(input.subjectType ? { subjectType: input.subjectType } : {}),
            ...(input.subjectId ? { subjectId: input.subjectId } : {}),
            ...(input.publicOnly
                ? { visibility: 'public', status: 'ready' }
                : input.actorUserId
                    ? { OR: [{ requestedByUserId: input.actorUserId }, { authorUserId: input.actorUserId }, { visibility: 'public' }] }
                    : { visibility: 'public', status: 'ready' }),
        },
        orderBy: [{ createdAt: 'desc' }, { id: 'desc' }],
        take: Math.max(1, Math.min(50, Math.trunc(input.limit ?? 20))),
    });
}

export async function publishEvaluationArtifact(prisma: any, input: {
    artifactId: string;
    actorUserId: number | null;
    confirmationText: unknown;
    now?: Date;
}) {
    if (String(input.confirmationText || '').trim().toLowerCase() !== 'publish evaluation') {
        throw new Error('evaluation_publish_confirmation_required');
    }
    const artifact = await getEvaluationArtifact(prisma, input.artifactId);
    if (!artifact) throw withStatus('evaluation_artifact_not_found', 404);
    if (artifact.status !== 'ready') throw withStatus('evaluation_not_publishable', 409);
    const now = input.now ?? new Date();
    const updated = await updateEvaluationArtifact(prisma, input.artifactId, {
        visibility: 'public',
        publishedAt: now,
        withdrawnAt: null,
    });
    await createReviewEvent(prisma, {
        artifactId: input.artifactId,
        actorUserId: input.actorUserId,
        eventType: 'published',
        reviewStatus: artifact.reviewStatus ?? 'unreviewed',
        eventPayload: { confirmationText: 'publish evaluation' },
    });
    return updated;
}

export async function retractEvaluationArtifact(prisma: any, input: {
    artifactId: string;
    actorUserId: number | null;
    reason?: unknown;
    now?: Date;
}) {
    const artifact = await getEvaluationArtifact(prisma, input.artifactId);
    if (!artifact) throw withStatus('evaluation_artifact_not_found', 404);
    const now = input.now ?? new Date();
    const updated = await updateEvaluationArtifact(prisma, input.artifactId, {
        visibility: 'retracted',
        withdrawnAt: now,
    });
    await createReviewEvent(prisma, {
        artifactId: input.artifactId,
        actorUserId: input.actorUserId,
        eventType: 'retracted',
        reviewStatus: artifact.reviewStatus ?? 'unreviewed',
        eventPayload: { reason: String(input.reason || '').trim().slice(0, 500) },
    });
    return updated;
}

export async function submitEvaluationAppeal(prisma: any, input: {
    artifactId: string;
    actorUserId: number | null;
    appealText: unknown;
}) {
    const appealText = String(input.appealText || '').trim();
    if (appealText.length < 2) throw new Error('evaluation_appeal_text_required');
    const data = {
        artifactId: input.artifactId,
        actorUserId: input.actorUserId,
        status: 'open',
        appealText: appealText.slice(0, 2000),
        resolutionText: null,
        resolvedByUserId: null,
        resolvedAt: null,
        eventPayload: {},
    };
    const appeal = typeof prisma?.evaluationAppeal?.create === 'function'
        ? await prisma.evaluationAppeal.create({ data })
        : data;
    await updateEvaluationArtifact(prisma, input.artifactId, {
        appealStatus: 'open',
    });
    return appeal;
}

export async function submitEvaluationReview(prisma: any, input: {
    artifactId: string;
    actorUserId: number | null;
    reviewStatus: unknown;
    note?: unknown;
}) {
    const reviewStatus = input.reviewStatus === 'flagged' ? 'flagged' : 'reviewed';
    const event = await createReviewEvent(prisma, {
        artifactId: input.artifactId,
        actorUserId: input.actorUserId,
        eventType: 'reviewed',
        reviewStatus,
        eventPayload: { note: String(input.note || '').trim().slice(0, 1000) },
    });
    await updateEvaluationArtifact(prisma, input.artifactId, {
        reviewStatus,
    });
    return event;
}

async function createReviewEvent(prisma: any, input: {
    artifactId: string;
    actorUserId: number | null;
    eventType: string;
    reviewStatus: string;
    eventPayload: Record<string, unknown>;
}) {
    const data = sanitizePublicJson({
        artifactId: input.artifactId,
        actorUserId: input.actorUserId,
        eventType: input.eventType,
        reviewStatus: input.reviewStatus,
        eventPayload: input.eventPayload,
    });
    if (typeof prisma?.evaluationReview?.create !== 'function') return data;
    return prisma.evaluationReview.create({ data });
}

export function serializeEvaluationArtifact(row: any): Record<string, unknown> {
    return sanitizePublicJson({
        id: String(row.id),
        circleId: Number(row.circleId),
        subjectType: String(row.subjectType),
        subjectId: String(row.subjectId),
        authorUserId: row.authorUserId ?? null,
        requestedByUserId: row.requestedByUserId ?? null,
        status: String(row.status || ''),
        visibility: String(row.visibility || 'private'),
        reviewStatus: String(row.reviewStatus || 'unreviewed'),
        appealStatus: String(row.appealStatus || 'none'),
        transcriptReviewStatus: row.transcriptReviewStatus ?? null,
        transcriptSourceMaterialId: row.transcriptSourceMaterialId ?? null,
        summary: String(row.summary || ''),
        claims: Array.isArray(row.claims) ? row.claims : [],
        evidenceSummary: Array.isArray(row.evidenceSummary) ? row.evidenceSummary : [],
        evidenceRefs: Array.isArray(row.evidenceRefs) ? row.evidenceRefs : [],
        assumptions: Array.isArray(row.assumptions) ? row.assumptions : [],
        evidenceGaps: Array.isArray(row.evidenceGaps) ? row.evidenceGaps : [],
        counterpoints: Array.isArray(row.counterpoints) ? row.counterpoints : [],
        verifiableNextSteps: Array.isArray(row.verifiableNextSteps) ? row.verifiableNextSteps : [],
        neutralWordingSuggestion: String(row.neutralWordingSuggestion || ''),
        confidence: String(row.confidence || 'low'),
        limitations: Array.isArray(row.limitations) ? row.limitations : [],
        sourceDigest: String(row.sourceDigest || ''),
        failureCode: row.failureCode ?? null,
        aiJobId: row.aiJobId ?? null,
        modelProfile: row.modelProfile ?? null,
        promptVersion: row.promptVersion ?? null,
        outputSchemaVersion: row.outputSchemaVersion ?? 'v1',
        publishedAt: serializeDate(row.publishedAt),
        withdrawnAt: serializeDate(row.withdrawnAt),
        expiresAt: serializeDate(row.expiresAt),
        createdAt: serializeDate(row.createdAt),
        updatedAt: serializeDate(row.updatedAt),
    }) as Record<string, unknown>;
}

function sanitizePublicJson(value: unknown): unknown {
    if (!value || typeof value !== 'object') return value;
    if (value instanceof Date) return value;
    if (Array.isArray(value)) return value.map(sanitizePublicJson);
    const output: Record<string, unknown> = {};
    for (const [key, nested] of Object.entries(value as Record<string, unknown>)) {
        if (BLOCKED_PUBLIC_KEYS.has(key)) continue;
        output[key] = sanitizePublicJson(nested);
    }
    return output;
}

function withStatus(message: string, statusCode: number): Error & { statusCode?: number } {
    const error = new Error(message) as Error & { statusCode?: number };
    error.statusCode = statusCode;
    return error;
}

function serializeDate(value: unknown): string | null {
    if (value instanceof Date) return value.toISOString();
    if (typeof value === 'string' && value.trim()) return value;
    return null;
}
