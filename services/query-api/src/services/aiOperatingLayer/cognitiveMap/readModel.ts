import type {
    CircleCognitiveMapAiOutput,
    CircleCognitiveMapJobResult,
} from './types';

export interface CircleCognitiveMapAiView {
    circleId: number;
    sourceDigest: string | null;
    jobId: number | null;
    status: 'missing' | 'queued' | 'running' | 'ready' | 'failed';
    output: CircleCognitiveMapAiOutput | null;
    failureCode: string | null;
    modelProfile: string | null;
    promptVersion: string | null;
    generatedAt: string | null;
}

export async function readCircleCognitiveMapAiByDedupeKey(
    prisma: any,
    input: {
        circleId: number;
        dedupeKey: string;
    },
): Promise<CircleCognitiveMapAiView> {
    const job = typeof prisma?.aiJob?.findUnique === 'function'
        ? await prisma.aiJob.findUnique({ where: { dedupeKey: input.dedupeKey } })
        : null;
    if (!job) return emptyView(input.circleId, 'missing', null, null);
    const jobId = Number(job.id);
    if (job.status === 'queued' || job.status === 'running') {
        return emptyView(input.circleId, job.status, Number.isFinite(jobId) ? jobId : null, null);
    }
    if (job.status === 'failed') {
        return emptyView(
            input.circleId,
            'failed',
            Number.isFinite(jobId) ? jobId : null,
            String(job.lastErrorCode || 'ai_job_failed'),
        );
    }
    const result = normalizeResult(job.resultJson ?? job.result_json ?? job.result);
    if (!result || result.circleId !== input.circleId) {
        return emptyView(input.circleId, 'failed', Number.isFinite(jobId) ? jobId : null, 'invalid_result');
    }
    return {
        circleId: input.circleId,
        sourceDigest: result.sourceDigest,
        jobId: Number.isFinite(jobId) ? jobId : null,
        status: 'ready',
        output: result.output,
        failureCode: result.failureCode,
        modelProfile: result.modelProfile,
        promptVersion: result.promptVersion,
        generatedAt: result.generatedAt,
    };
}

export function buildCircleCognitiveMapDedupeKey(input: {
    circleId: number;
    contextDigest: string;
}): string {
    return [
        'circle_cognitive_map_explain',
        input.circleId,
        input.contextDigest.slice(0, 32),
    ].join(':');
}

function normalizeResult(value: unknown): CircleCognitiveMapJobResult | null {
    if (!value || typeof value !== 'object' || Array.isArray(value)) return null;
    const record = value as Partial<CircleCognitiveMapJobResult>;
    const circleId = Number(record.circleId);
    if (!Number.isFinite(circleId) || circleId <= 0 || !record.output) return null;
    return {
        taskType: 'circle.cognitive_map_explain.v1',
        taskCatalogVersion: String(record.taskCatalogVersion || 'v1'),
        schemaVersion: 'v1',
        status: record.status === 'disabled' || record.status === 'fallback' ? record.status : 'ready',
        circleId: Math.trunc(circleId),
        sourceDigest: String(record.sourceDigest || ''),
        output: record.output,
        fallbackUsed: Boolean(record.fallbackUsed),
        failureCode: typeof record.failureCode === 'string' ? record.failureCode : null,
        modelProfile: typeof record.modelProfile === 'string' ? record.modelProfile : null,
        promptVersion: typeof record.promptVersion === 'string' ? record.promptVersion : null,
        generatedAt: typeof record.generatedAt === 'string' ? record.generatedAt : '',
    };
}

function emptyView(
    circleId: number,
    status: CircleCognitiveMapAiView['status'],
    jobId: number | null,
    failureCode: string | null,
): CircleCognitiveMapAiView {
    return {
        circleId,
        sourceDigest: null,
        jobId,
        status,
        output: null,
        failureCode,
        modelProfile: null,
        promptVersion: null,
        generatedAt: null,
    };
}
