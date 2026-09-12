import { loadTrendPromptConfig } from './config';
import { buildFallbackPayload } from './generator';
import type { TrendPlacePromptPayload, TrendPromptCacheView } from './types';
import { TREND_PLACE_PROMPT_TASK_TYPE } from './types';

export async function loadTrendPromptView(
    prisma: any,
    input: {
        promptId: string;
        requestedByUserId: number;
        now?: Date;
    },
): Promise<TrendPromptCacheView | null> {
    const row = await findPromptCache(prisma, input.promptId);
    if (!row) return null;
    if (Number(row.requestedByUserId ?? row.requested_by_user_id) !== input.requestedByUserId) return null;
    const reconciled = await reconcilePendingTrendPrompt(prisma, row, {
        now: input.now ?? new Date(),
    });
    return toTrendPromptView(reconciled ?? row);
}

export async function reconcilePendingTrendPrompt(
    prisma: any,
    row: any,
    input: {
        now?: Date;
    } = {},
): Promise<any> {
    const status = String(row.status || '');
    const now = input.now ?? new Date();
    const expiresAt = toDate(row.expiresAt ?? row.expires_at);
    if (status !== 'pending') {
        if ((status === 'ready' || status === 'fallback') && expiresAt && expiresAt.getTime() <= now.getTime()) {
            return updateExpiredAsFallback(prisma, row, now);
        }
        return row;
    }
    const config = loadTrendPromptConfig();
    if (!config.promptsEnabled) {
        return updatePendingAsFallback(prisma, row, 'trend_disabled', now);
    }
    const jobId = Number(row.aiJobId ?? row.ai_job_id ?? 0);
    const job = jobId > 0 && typeof prisma?.aiJob?.findUnique === 'function'
        ? await prisma.aiJob.findUnique({ where: { id: jobId } })
        : null;
    if (job && String(job.status) === 'failed') {
        return updatePromptCache(prisma, row, {
            status: 'failed',
            failureCode: 'provider_failed',
            payload: buildFailedFromExisting(row, 'provider_failed'),
            expiresAt: null,
        });
    }
    if (expiresAt && expiresAt.getTime() <= now.getTime()) {
        return updatePromptCache(prisma, row, {
            status: 'expired',
            failureCode: 'provider_failed',
            expiresAt: now,
        });
    }
    return row;
}

async function updateExpiredAsFallback(
    prisma: any,
    row: any,
    now: Date,
): Promise<any> {
    const existingPayload = normalizePayload(row.payload);
    const payload = existingPayload ?? {
        query: {
            display: '',
            digest: '',
        },
        sourceDigest: String(row.sourceDigest ?? row.source_digest ?? ''),
    };
    const fallback = buildFallbackPayload({
        input: {
            placeSeed: payload.query.display || 'New circle',
            locale: 'en',
            communityType: null,
            mode: 'social',
            requestedByUserId: Number(row.requestedByUserId ?? row.requested_by_user_id),
        },
        query: payload.query,
        sourceDigest: payload.sourceDigest,
        failureCode: 'stale_trend_cache',
        expiresAt: new Date(now.getTime() + loadTrendPromptConfig().fallbackTtlMs),
        evidenceRefs: existingPayload?.evidenceRefs ?? [],
    });
    return updatePromptCache(prisma, row, {
        status: 'fallback',
        failureCode: 'stale_trend_cache',
        payload: fallback,
        expiresAt: fallback.expiresAt ? new Date(fallback.expiresAt) : null,
    });
}

export function toTrendPromptView(row: any): TrendPromptCacheView {
    const payload = normalizePayload(row.payload ?? row.payloadJson ?? row.payload_json);
    return {
        id: String(row.id),
        promptId: String(row.id),
        cacheKey: String(row.cacheKey ?? row.cache_key ?? ''),
        taskType: TREND_PLACE_PROMPT_TASK_TYPE,
        requestedByUserId: Number(row.requestedByUserId ?? row.requested_by_user_id),
        status: normalizeStatus(row.status),
        failureCode: row.failureCode ?? row.failure_code ?? payload?.failureCode ?? null,
        aiJobId: nullableNumber(row.aiJobId ?? row.ai_job_id),
        proposalArtifactId: row.proposalArtifactId ?? row.proposal_artifact_id ?? null,
        expiresAt: serializeDate(row.expiresAt ?? row.expires_at),
        createdAt: serializeDate(row.createdAt ?? row.created_at),
        updatedAt: serializeDate(row.updatedAt ?? row.updated_at),
        prompt: payload,
    };
}

async function findPromptCache(prisma: any, promptId: string): Promise<any | null> {
    if (typeof prisma?.trendPromptCache?.findUnique === 'function') {
        return prisma.trendPromptCache.findUnique({ where: { id: promptId } });
    }
    if (typeof prisma?.trendPromptCache?.findFirst === 'function') {
        return prisma.trendPromptCache.findFirst({ where: { id: promptId } });
    }
    return null;
}

async function updatePendingAsFallback(
    prisma: any,
    row: any,
    failureCode: 'trend_disabled',
    now: Date,
): Promise<any> {
    const payload = normalizePayload(row.payload) ?? {
        query: {
            display: '',
            digest: '',
        },
        sourceDigest: String(row.sourceDigest ?? row.source_digest ?? ''),
    };
    const fallback = buildFallbackPayload({
        input: {
            placeSeed: payload.query.display || 'New circle',
            locale: 'en',
            communityType: null,
            mode: 'social',
            requestedByUserId: Number(row.requestedByUserId ?? row.requested_by_user_id),
        },
        query: payload.query,
        sourceDigest: payload.sourceDigest,
        failureCode,
        expiresAt: new Date(now.getTime() + loadTrendPromptConfig().fallbackTtlMs),
    });
    return updatePromptCache(prisma, row, {
        status: 'fallback',
        failureCode,
        payload: fallback,
        expiresAt: fallback.expiresAt ? new Date(fallback.expiresAt) : null,
    });
}

async function updatePromptCache(
    prisma: any,
    row: any,
    data: Record<string, unknown>,
): Promise<any> {
    if (typeof prisma?.trendPromptCache?.update === 'function') {
        return prisma.trendPromptCache.update({
            where: { id: row.id },
            data,
        });
    }
    if (typeof prisma?.trendPromptCache?.updateMany === 'function') {
        await prisma.trendPromptCache.updateMany({
            where: { id: row.id },
            data,
        });
    }
    return {
        ...row,
        ...data,
    };
}

function buildFailedFromExisting(
    row: any,
    failureCode: 'provider_failed',
): TrendPlacePromptPayload {
    const payload = normalizePayload(row.payload);
    return {
        status: 'failed',
        failureCode,
        generatedAt: new Date().toISOString(),
        expiresAt: null,
        query: payload?.query ?? {
            display: '',
            digest: '',
        },
        confidence: 0,
        sourceDigest: payload?.sourceDigest ?? String(row.sourceDigest ?? row.source_digest ?? ''),
        suggestions: [],
        evidenceRefs: [],
    };
}

function normalizePayload(value: unknown): TrendPlacePromptPayload | null {
    if (!value || typeof value !== 'object' || Array.isArray(value)) return null;
    return value as TrendPlacePromptPayload;
}

function normalizeStatus(value: unknown): TrendPromptCacheView['status'] {
    const status = String(value || '');
    return status === 'ready'
        || status === 'fallback'
        || status === 'failed'
        || status === 'expired'
        ? status
        : 'pending';
}

function nullableNumber(value: unknown): number | null {
    const parsed = Number(value);
    return Number.isFinite(parsed) && parsed > 0 ? parsed : null;
}

function toDate(value: unknown): Date | null {
    if (value instanceof Date) return value;
    if (typeof value === 'string' && value.trim()) {
        const parsed = new Date(value);
        return Number.isNaN(parsed.getTime()) ? null : parsed;
    }
    return null;
}

function serializeDate(value: unknown): string | null {
    const date = toDate(value);
    return date ? date.toISOString() : null;
}
