import type {
    AnchoredSuggestionDecision,
    AnchoredSuggestionJobResult,
} from './types';

export interface AnchoredSuggestionDecisionView {
    circleId: number;
    sourceDigest: string | null;
    jobId: number | null;
    status: 'missing' | 'queued' | 'running' | 'ready' | 'failed';
    decisions: AnchoredSuggestionDecision[];
    failureCode: string | null;
}

interface NormalizedAnchoredSuggestionJobResult {
    taskType: AnchoredSuggestionJobResult['taskType'];
    taskCatalogVersion: string;
    schemaVersion: AnchoredSuggestionJobResult['schemaVersion'];
    status: 'ready' | 'legacy_fallback' | 'legacy_disabled' | 'legacy_no_candidates' | 'invalid_status';
    circleId: number;
    sourceDigest: string;
    decisions: AnchoredSuggestionDecision[];
    fallbackUsed: boolean;
    failureCode: string | null;
    modelProfile: string | null;
    promptVersion: string | null;
}

export async function readAnchoredSuggestionDecisionsByDedupeKey(
    prisma: any,
    input: {
        circleId: number;
        dedupeKey: string;
    },
): Promise<AnchoredSuggestionDecisionView> {
    const job = typeof prisma?.aiJob?.findUnique === 'function'
        ? await prisma.aiJob.findUnique({ where: { dedupeKey: input.dedupeKey } })
        : null;
    if (!job) {
        return emptyView(input.circleId, 'missing', null, null);
    }
    return viewFromJob(job, input.circleId);
}

export async function readAnchoredSuggestionDecisionsByContextCapsuleId(
    prisma: any,
    input: {
        circleId: number;
        contextCapsuleId: string;
    },
): Promise<AnchoredSuggestionDecisionView> {
    const contextCapsuleId = String(input.contextCapsuleId || '').trim();
    if (!contextCapsuleId || typeof prisma?.aiJob?.findMany !== 'function') {
        return emptyView(input.circleId, 'missing', null, null);
    }
    const jobs = await prisma.aiJob.findMany({
        where: {
            jobType: 'anchored_interaction_suggestion_judge',
            contextCapsuleId,
            scopeCircleId: input.circleId,
            status: {
                in: ['queued', 'running', 'succeeded'],
            },
        },
        orderBy: [
            { completedAt: 'desc' },
            { updatedAt: 'desc' },
            { id: 'desc' },
        ],
        take: 1,
    });
    const job = Array.isArray(jobs) ? jobs[0] : null;
    if (!job) {
        return emptyView(input.circleId, 'missing', null, null);
    }
    return viewFromJob(job, input.circleId);
}

export function buildAnchoredSuggestionDedupeKey(input: {
    circleId: number;
    sourceDigest: string;
    locale: string;
}): string {
    return [
        'anchored_interaction_suggestion_judge',
        input.circleId,
        normalizeLocaleKey(input.locale),
        normalizeDigestKey(input.sourceDigest),
    ].join(':');
}

function viewFromJob(
    job: any,
    circleId: number,
): AnchoredSuggestionDecisionView {
    const jobId = Number(job.id);
    if (job.status === 'queued' || job.status === 'running') {
        return emptyView(circleId, job.status, Number.isFinite(jobId) ? jobId : null, null);
    }
    if (job.status === 'failed') {
        return emptyView(
            circleId,
            'failed',
            Number.isFinite(jobId) ? jobId : null,
            String(job.lastErrorCode || 'ai_job_failed'),
        );
    }
    const result = normalizeResult(job.resultJson ?? job.result_json ?? job.result);
    if (!result || result.circleId !== circleId) {
        return emptyView(circleId, 'failed', Number.isFinite(jobId) ? jobId : null, 'invalid_result');
    }
    if (result.status !== 'ready' || result.fallbackUsed) {
        return emptyView(
            circleId,
            'failed',
            Number.isFinite(jobId) ? jobId : null,
            result.failureCode || result.status || 'ai_result_not_ready',
        );
    }
    return {
        circleId,
        sourceDigest: result.sourceDigest,
        jobId: Number.isFinite(jobId) ? jobId : null,
        status: 'ready',
        decisions: result.decisions,
        failureCode: result.failureCode,
    };
}

function normalizeResult(value: unknown): NormalizedAnchoredSuggestionJobResult | null {
    if (!value || typeof value !== 'object' || Array.isArray(value)) return null;
    const record = value as Partial<AnchoredSuggestionJobResult>;
    const circleId = Number(record.circleId);
    if (!Number.isFinite(circleId) || circleId <= 0) return null;
    return {
        taskType: 'anchored.interaction_suggestion_judge.v1',
        taskCatalogVersion: String(record.taskCatalogVersion || 'v1'),
        schemaVersion: 'v1',
        status: normalizeResultStatus((record as { status?: unknown }).status),
        circleId: Math.trunc(circleId),
        sourceDigest: String(record.sourceDigest || ''),
        decisions: Array.isArray(record.decisions)
            ? record.decisions.filter(isDecision)
            : [],
        fallbackUsed: Boolean(record.fallbackUsed),
        failureCode: typeof record.failureCode === 'string' ? record.failureCode : null,
        modelProfile: typeof record.modelProfile === 'string' ? record.modelProfile : null,
        promptVersion: typeof record.promptVersion === 'string' ? record.promptVersion : null,
    };
}

function normalizeResultStatus(value: unknown): NormalizedAnchoredSuggestionJobResult['status'] {
    if (value === 'ready') return 'ready';
    if (value === 'fallback') return 'legacy_fallback';
    if (value === 'disabled') return 'legacy_disabled';
    if (value === 'no_candidates') return 'legacy_no_candidates';
    return 'invalid_status';
}

function isDecision(value: unknown): value is AnchoredSuggestionDecision {
    if (!value || typeof value !== 'object' || Array.isArray(value)) return false;
    const record = value as AnchoredSuggestionDecision;
    return typeof record.envelopeId === 'string'
        && typeof record.shouldSuggest === 'boolean'
        && (record.suggestedType === 'signup'
            || record.suggestedType === 'poll'
            || record.suggestedType === 'challenge'
            || record.suggestedType === 'none')
        && typeof record.importanceScore === 'number'
        && typeof record.actionabilityScore === 'number'
        && typeof record.discussionAdvancementScore === 'number'
        && typeof record.confidence === 'number';
}

function emptyView(
    circleId: number,
    status: AnchoredSuggestionDecisionView['status'],
    jobId: number | null,
    failureCode: string | null,
): AnchoredSuggestionDecisionView {
    return {
        circleId,
        sourceDigest: null,
        jobId,
        status,
        decisions: [],
        failureCode,
    };
}

function normalizeDigestKey(value: unknown): string {
    const text = typeof value === 'string' ? value.trim().toLowerCase() : '';
    return /^[a-f0-9]{64}$/.test(text) ? text.slice(0, 32) : 'missing_source_digest';
}

function normalizeLocaleKey(value: unknown): string {
    const text = typeof value === 'string' ? value.trim().toLowerCase() : '';
    return /^[a-z]{2,8}$/.test(text) ? text : 'und';
}
