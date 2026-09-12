import { getPromptMetadata, getPromptSchema, getSystemPrompt, renderPromptVariables } from '../../../ai/prompts/registry';
import { callAiCapability } from '../capabilities/adapter';
import { buildContextCapsule, persistContextCapsule } from '../contextFabric';
import { createProposalForTrendPromptCache } from '../proposals';
import { loadTrendPromptConfig } from './config';
import { collectTrendReceipts, evidenceRefsFromTrendReceipts } from './manualSnapshotConnector';
import {
    buildPromptCacheKey,
    buildTrendPromptId,
    normalizeCommunityType,
    normalizeLocale,
    normalizeMode,
    sanitizePublicIntent,
    sha256,
} from './normalization';
import { parseProviderTrendPromptOutput, validateTrendPromptPayload } from './promptSchema';
import type {
    TrendFailureCode,
    TrendPlacePromptPayload,
    TrendPlacePromptSuggestion,
    TrendPromptInput,
} from './types';
import { TREND_PLACE_PROMPT_TASK_TYPE } from './types';

export type PrepareTrendPromptResult =
    | {
        status: 'queued';
        promptId: string;
        cacheKey: string;
        cache: any;
    }
    | {
        status: 'ready' | 'fallback' | 'failed' | 'pending';
        promptId: string;
        prompt: TrendPlacePromptPayload;
        cache: any;
    };

export async function prepareTrendPromptRequest(
    prisma: any,
    input: TrendPromptInput,
): Promise<PrepareTrendPromptResult> {
    const normalized = normalizeInput(input);
    const config = loadTrendPromptConfig();
    const now = new Date();
    const intent = sanitizePublicIntent(normalized);
    if (!intent.ok && intent.reason === 'empty') {
        throw new Error('invalid_place_prompt_input');
    }

    const query = {
        display: intent.displayQuery,
        digest: intent.digest,
    };
    const sourceDigest = sha256(`prepare:${query.digest}`);
    const cacheKey = buildPromptCacheKey({
        requestedByUserId: normalized.requestedByUserId,
        sanitizedIntentDigest: query.digest,
        locale: normalized.locale,
        communityType: normalized.communityType ?? null,
        mode: normalized.mode ?? null,
        sourceDigest,
    });
    const promptId = buildTrendPromptId({
        requestedByUserId: normalized.requestedByUserId,
        cacheKey,
    });

    if (!intent.ok) {
        const payload = buildFailedPayload({
            query,
            sourceDigest,
            failureCode: 'permission_denied',
        });
        const cache = await upsertPromptCache(prisma, {
            id: promptId,
            requestedByUserId: normalized.requestedByUserId,
            cacheKey,
            inputDigest: sha256(JSON.stringify(normalized)),
            sanitizedIntentDigest: query.digest,
            sourceDigest,
            status: 'failed',
            failureCode: 'permission_denied',
            payload,
            expiresAt: null,
        });
        return { status: 'failed', promptId, prompt: payload, cache };
    }

    if (!config.promptsEnabled) {
        const payload = buildFallbackPayload({
            input: normalized,
            query,
            failureCode: 'trend_disabled',
            sourceDigest,
            expiresAt: new Date(now.getTime() + config.fallbackTtlMs),
        });
        const cache = await upsertPromptCache(prisma, {
            id: promptId,
            requestedByUserId: normalized.requestedByUserId,
            cacheKey,
            inputDigest: sha256(JSON.stringify(normalized)),
            sanitizedIntentDigest: query.digest,
            sourceDigest,
            status: 'fallback',
            failureCode: 'trend_disabled',
            payload,
            expiresAt: payload.expiresAt,
        });
        return { status: 'fallback', promptId, prompt: payload, cache };
    }

    const existing = await findPromptCacheByUserAndCacheKey(prisma, {
        requestedByUserId: normalized.requestedByUserId,
        cacheKey,
    });
    if (existing?.payload && ['ready', 'fallback', 'failed', 'pending'].includes(String(existing.status))) {
        return resolveExistingPromptCacheForPost(prisma, existing, {
            cacheKey,
            query,
            normalized,
            sourceDigest,
            config,
            now,
        });
    }

    const pendingPayload = buildPendingPayload({
        query,
        sourceDigest,
        expiresAt: new Date(now.getTime() + config.pendingTtlMs),
    });
    const cache = await upsertPromptCache(prisma, {
        id: promptId,
        requestedByUserId: normalized.requestedByUserId,
        cacheKey,
        inputDigest: sha256(JSON.stringify(normalized)),
        sanitizedIntentDigest: query.digest,
        sourceDigest,
        status: 'pending',
        failureCode: null,
        payload: pendingPayload,
        expiresAt: pendingPayload.expiresAt,
    });
    return {
        status: 'queued',
        promptId,
        cacheKey,
        cache,
    };
}

export async function attachTrendPromptJob(
    prisma: any,
    input: {
        promptId: string;
        requestedByUserId: number;
        aiJobId: number;
    },
): Promise<void> {
    if (typeof prisma?.trendPromptCache?.updateMany !== 'function') return;
    await prisma.trendPromptCache.updateMany({
        where: {
            id: input.promptId,
            requestedByUserId: input.requestedByUserId,
        },
        data: {
            aiJobId: input.aiJobId,
        },
    });
}

async function resolveExistingPromptCacheForPost(
    prisma: any,
    existing: any,
    input: {
        cacheKey: string;
        query: { display: string; digest: string };
        normalized: TrendPromptInput;
        sourceDigest: string;
        config: ReturnType<typeof loadTrendPromptConfig>;
        now: Date;
    },
): Promise<PrepareTrendPromptResult> {
    const status = String(existing.status || '');
    const promptId = String(existing.id);
    const payload = normalizePayload(existing.payload);
    const expiresAt = toDate(existing.expiresAt ?? existing.expires_at ?? payload?.expiresAt);
    const expired = Boolean(expiresAt && expiresAt.getTime() <= input.now.getTime());

    if (status === 'pending') {
        const aiJobId = Number(existing.aiJobId ?? existing.ai_job_id ?? 0);
        const job = aiJobId > 0 && typeof prisma?.aiJob?.findUnique === 'function'
            ? await prisma.aiJob.findUnique({ where: { id: aiJobId } })
            : null;
        const jobStatus = String(job?.status || '');
        if (jobStatus === 'failed' || jobStatus === 'succeeded') {
            const failedPayload = buildFailedPayload({
                query: payload.query ?? input.query,
                sourceDigest: payload.sourceDigest ?? input.sourceDigest,
                failureCode: 'provider_failed',
            });
            const cache = await updatePromptCacheById(prisma, promptId, input.normalized.requestedByUserId, {
                status: 'failed',
                failureCode: 'provider_failed',
                payload: failedPayload,
                expiresAt: null,
                aiJobId,
            });
            return {
                status: 'failed',
                promptId,
                prompt: normalizePayload(cache?.payload ?? failedPayload),
                cache: cache ?? existing,
            };
        }

        if (!aiJobId || expired) {
            const pendingPayload = buildPendingPayload({
                query: payload.query ?? input.query,
                sourceDigest: payload.sourceDigest ?? input.sourceDigest,
                expiresAt: new Date(input.now.getTime() + input.config.pendingTtlMs),
            });
            const cache = await updatePromptCacheById(prisma, promptId, input.normalized.requestedByUserId, {
                status: 'pending',
                failureCode: null,
                payload: pendingPayload,
                expiresAt: pendingPayload.expiresAt,
                aiJobId: null,
            });
            return {
                status: 'queued',
                promptId,
                cacheKey: input.cacheKey,
                cache: cache ?? existing,
            };
        }

        return {
            status: 'pending',
            promptId,
            prompt: payload,
            cache: existing,
        };
    }

    if ((status === 'ready' || status === 'fallback') && expired) {
        const fallbackPayload = buildFallbackPayload({
            input: input.normalized,
            query: payload.query ?? input.query,
            sourceDigest: payload.sourceDigest
                ?? String(existing.sourceDigest ?? existing.source_digest ?? input.sourceDigest),
            failureCode: 'stale_trend_cache',
            expiresAt: new Date(input.now.getTime() + input.config.fallbackTtlMs),
            evidenceRefs: payload.evidenceRefs ?? [],
        });
        const cache = await updatePromptCacheById(prisma, promptId, input.normalized.requestedByUserId, {
            status: 'fallback',
            failureCode: 'stale_trend_cache',
            payload: fallbackPayload,
            expiresAt: fallbackPayload.expiresAt,
        });
        return {
            status: 'fallback',
            promptId,
            prompt: normalizePayload(cache?.payload ?? fallbackPayload),
            cache: cache ?? existing,
        };
    }

    return {
        status: status === 'ready' ? 'ready' : status === 'failed' ? 'failed' : 'fallback',
        promptId,
        prompt: payload,
        cache: existing,
    };
}

export async function processTrendPromptJob(
    prisma: any,
    input: TrendPromptInput & {
        promptId: string;
        aiJobId?: number | null;
    },
): Promise<{
    promptId: string;
    proposalArtifactId: string | null;
    status: string;
    failureCode: string | null;
}> {
    const normalized = normalizeInput(input);
    const config = loadTrendPromptConfig();
    const intent = sanitizePublicIntent(normalized);
    if (!intent.ok) {
        const query = {
            display: intent.displayQuery,
            digest: intent.digest,
        };
        const payload = buildFailedPayload({
            query,
            sourceDigest: sha256(`permission_denied:${query.digest}`),
            failureCode: 'permission_denied',
        });
        const cache = await updatePromptCacheById(prisma, input.promptId, normalized.requestedByUserId, {
            status: 'failed',
            failureCode: 'permission_denied',
            payload,
            expiresAt: null,
            aiJobId: input.aiJobId ?? null,
        });
        return {
            promptId: input.promptId,
            proposalArtifactId: cache?.proposalArtifactId ?? null,
            status: 'failed',
            failureCode: 'permission_denied',
        };
    }

    const query = {
        display: intent.displayQuery,
        digest: intent.digest,
    };

    const budgetExceeded = await isDailyBudgetExceeded(prisma, normalized.requestedByUserId, config.userDailyLimit);
    if (budgetExceeded) {
        return persistFallbackResult(prisma, normalized, {
            promptId: input.promptId,
            aiJobId: input.aiJobId ?? null,
            query,
            sourceDigest: sha256(`budget_exceeded:${query.digest}`),
            failureCode: 'budget_exceeded',
            expiresAt: new Date(Date.now() + config.fallbackTtlMs),
        });
    }

    const receiptResult = await collectTrendReceipts(prisma, {
        query: query.display.slice(0, config.maxInputChars),
        queryDigest: query.digest,
    });
    if (receiptResult.status !== 'fresh') {
        return persistFallbackResult(prisma, normalized, {
            promptId: input.promptId,
            aiJobId: input.aiJobId ?? null,
            query,
            sourceDigest: receiptResult.sourceDigest,
            failureCode: receiptResult.status,
            expiresAt: new Date(Date.now() + config.fallbackTtlMs),
        });
    }

    const receipts = receiptResult.receipts.slice(0, config.maxReceipts);
    const evidenceRefs = evidenceRefsFromTrendReceipts(receipts);
    const trendEvidenceRefs = evidenceRefs as TrendPlacePromptPayload['evidenceRefs'];
    const capsuleResult = buildContextCapsule({
        taskType: TREND_PLACE_PROMPT_TASK_TYPE,
        subjectType: 'place_prompt',
        subjectId: input.promptId,
        actorUserId: normalized.requestedByUserId,
        visibility: 'public',
        runtimeRole: 'PUBLIC_NODE',
        evidenceRefs,
        excerptPolicy: {
            mode: 'digest_only',
            redaction: 'public_aggregate',
            maxEvidenceRefs: config.maxReceipts,
        },
        tokenBudget: {
            maxInputTokens: config.maxInputChars,
            maxOutputTokens: 500,
            maxEvidenceRefs: config.maxReceipts,
        },
        privatePlaintextMode: 'public',
    });
    if (!capsuleResult.ok) {
        return persistFallbackResult(prisma, normalized, {
            promptId: input.promptId,
            aiJobId: input.aiJobId ?? null,
            query,
            sourceDigest: receiptResult.sourceDigest,
            failureCode: 'validator_rejected',
            expiresAt: new Date(Date.now() + config.fallbackTtlMs),
        });
    }
    await persistContextCapsule(prisma, capsuleResult.capsule, {
        cacheKey: input.promptId,
        expiresAt: new Date(Date.now() + config.readyTtlMs),
    });

    if (!config.providerEnabled) {
        return persistFallbackResult(prisma, normalized, {
            promptId: input.promptId,
            aiJobId: input.aiJobId ?? null,
            query,
            sourceDigest: receiptResult.sourceDigest,
            failureCode: 'provider_failed',
            expiresAt: new Date(Date.now() + config.fallbackTtlMs),
            evidenceRefs: trendEvidenceRefs,
            contextCapsuleId: capsuleResult.capsule.id,
        });
    }

    try {
        const prompt = renderPromptVariables(getSystemPrompt('trend-place-prompt'), {
            locale: normalized.locale,
            communityType: normalized.communityType ?? 'community',
            mode: normalized.mode ?? 'social',
            publicIntent: intent.intent,
            trendReceipts: receipts.map((receipt) => `- ${receipt.summary}`).join('\n'),
        });
        const capability = await callAiCapability({
            taskType: TREND_PLACE_PROMPT_TASK_TYPE,
            capability: 'text.structure',
            privacyProfile: 'public_protocol',
            runtimeRole: 'PUBLIC_NODE',
            input: {
                systemPrompt: prompt,
                prompt: JSON.stringify({
                    locale: normalized.locale,
                    publicIntent: intent.intent,
                    communityType: normalized.communityType,
                    mode: normalized.mode,
                    evidenceRefIds: evidenceRefs.map((ref) => ref.sourceId),
                    receiptSummaries: receipts.map((receipt) => ({
                        id: receipt.id,
                        summary: receipt.summary,
                        confidence: receipt.confidence,
                        expiresAt: receipt.expiresAt,
                    })),
                }),
                responseFormat: {
                    type: 'json',
                    schema: getPromptSchema('trend-place-prompt') ?? undefined,
                    name: 'trend_place_prompt',
                },
                maxOutputTokens: 500,
                temperature: 0.2,
            },
        });
        const parsed = parseProviderTrendPromptOutput(String(capability.output.text || ''), {
            generatedAt: new Date().toISOString(),
            expiresAt: new Date(Date.now() + config.readyTtlMs).toISOString(),
            query,
            confidence: averageConfidence(receipts),
            sourceDigest: receiptResult.sourceDigest,
            evidenceRefs: trendEvidenceRefs,
        });
        if (!parsed.ok) {
            return persistFallbackResult(prisma, normalized, {
                promptId: input.promptId,
                aiJobId: input.aiJobId ?? null,
                query,
                sourceDigest: receiptResult.sourceDigest,
                failureCode: 'validator_rejected',
                expiresAt: new Date(Date.now() + config.fallbackTtlMs),
                evidenceRefs: trendEvidenceRefs,
                contextCapsuleId: capsuleResult.capsule.id,
            });
        }
        const promptMetadata = getPromptMetadata('trend-place-prompt');
        const cache = await updatePromptCacheById(prisma, input.promptId, normalized.requestedByUserId, {
            status: 'ready',
            failureCode: null,
            sourceDigest: receiptResult.sourceDigest,
            payload: parsed.payload,
            expiresAt: parsed.payload.expiresAt,
            contextCapsuleId: capsuleResult.capsule.id,
            aiJobId: input.aiJobId ?? null,
        });
        const proposal = await createTrendProposalEnvelope(prisma, {
            cache: cache ?? {
                id: input.promptId,
                requestedByUserId: normalized.requestedByUserId,
                sourceDigest: receiptResult.sourceDigest,
                contextCapsuleId: capsuleResult.capsule.id,
                payload: parsed.payload,
                status: 'ready',
                expiresAt: parsed.payload.expiresAt,
            },
            modelProfile: capability.model,
            promptVersion: promptMetadata.promptVersion,
        });
        await updatePromptCacheById(prisma, input.promptId, normalized.requestedByUserId, {
            proposalArtifactId: proposal?.id ?? null,
        });
        return {
            promptId: input.promptId,
            proposalArtifactId: proposal?.id ?? null,
            status: 'ready',
            failureCode: null,
        };
    } catch {
        return persistFallbackResult(prisma, normalized, {
            promptId: input.promptId,
            aiJobId: input.aiJobId ?? null,
            query,
            sourceDigest: receiptResult.sourceDigest,
            failureCode: 'provider_failed',
            expiresAt: new Date(Date.now() + config.fallbackTtlMs),
            evidenceRefs: trendEvidenceRefs,
            contextCapsuleId: capsuleResult.capsule.id,
        });
    }
}

export async function markTrendPromptFailed(
    prisma: any,
    input: {
        promptId: string;
        requestedByUserId: number;
        aiJobId?: number | null;
        failureCode?: TrendFailureCode;
    },
) {
    const payload = buildFailedPayload({
        query: {
            display: '',
            digest: sha256(`failed:${input.promptId}`),
        },
        sourceDigest: sha256(`failed:${input.promptId}`),
        failureCode: input.failureCode ?? 'provider_failed',
    });
    return updatePromptCacheById(prisma, input.promptId, input.requestedByUserId, {
        status: 'failed',
        failureCode: input.failureCode ?? 'provider_failed',
        payload,
        aiJobId: input.aiJobId ?? null,
        expiresAt: null,
    });
}

export function buildFallbackPayload(input: {
    input: TrendPromptInput;
    query: { display: string; digest: string };
    sourceDigest: string;
    failureCode: Exclude<TrendFailureCode, 'permission_denied'>;
    expiresAt: Date;
    evidenceRefs?: TrendPlacePromptPayload['evidenceRefs'];
}): TrendPlacePromptPayload {
    const place = input.input.placeSeed.trim() || 'New circle';
    const communityType = normalizeCommunityType(input.input.communityType) ?? 'community';
    const mode = normalizeMode(input.input.mode) ?? 'social';
    const suggestions: TrendPlacePromptSuggestion[] = [
        {
            id: 'fallback_1',
            title: 'Clear invitation',
            namePatch: place.slice(0, 72),
            descriptionPatch: `A ${communityType} for people to gather around ${place} with a clear shared rhythm.`,
            promptText: `Invite members to describe what ${place} should help them remember, coordinate, or build together.`,
            rationale: 'Works without external trend evidence and keeps the user in control.',
            confidence: 0.35,
            evidenceRefIds: [],
        },
        {
            id: 'fallback_2',
            title: mode === 'knowledge' ? 'Knowledge focus' : 'Social focus',
            namePatch: null,
            descriptionPatch: mode === 'knowledge'
                ? `A knowledge space for collecting useful context, source-backed notes, and decisions around ${place}.`
                : `A social space for recurring conversation, introductions, and lightweight coordination around ${place}.`,
            promptText: `Start with a short founding note about why ${place} matters now.`,
            rationale: 'Adapts to the selected circle mode without claiming trend support.',
            confidence: 0.35,
            evidenceRefIds: [],
        },
        {
            id: 'fallback_3',
            title: 'First conversation seed',
            namePatch: null,
            descriptionPatch: `A place to turn scattered interest in ${place} into shared memory, prompts, and next steps.`,
            promptText: `Ask early members what should be preserved, discussed, and revisited first.`,
            rationale: 'Provides a usable first prompt while external trend evidence is unavailable.',
            confidence: 0.35,
            evidenceRefIds: [],
        },
    ];
    return {
        status: 'fallback',
        failureCode: input.failureCode,
        generatedAt: new Date().toISOString(),
        expiresAt: input.expiresAt.toISOString(),
        query: input.query,
        confidence: 0.35,
        sourceDigest: input.sourceDigest,
        suggestions,
        evidenceRefs: input.evidenceRefs ?? [],
    };
}

export function buildFailedPayload(input: {
    query: { display: string; digest: string };
    sourceDigest: string;
    failureCode: TrendFailureCode;
}): TrendPlacePromptPayload {
    return {
        status: 'failed',
        failureCode: input.failureCode,
        generatedAt: new Date().toISOString(),
        expiresAt: null,
        query: input.query,
        confidence: 0,
        sourceDigest: input.sourceDigest,
        suggestions: [],
        evidenceRefs: [],
    };
}

function buildPendingPayload(input: {
    query: { display: string; digest: string };
    sourceDigest: string;
    expiresAt: Date;
}): TrendPlacePromptPayload {
    return {
        status: 'pending',
        failureCode: null,
        generatedAt: null,
        expiresAt: input.expiresAt.toISOString(),
        query: input.query,
        confidence: 0,
        sourceDigest: input.sourceDigest,
        suggestions: [],
        evidenceRefs: [],
    };
}

async function persistFallbackResult(
    prisma: any,
    normalized: TrendPromptInput,
    input: {
        promptId: string;
        aiJobId: number | null;
        query: { display: string; digest: string };
        sourceDigest: string;
        failureCode: Exclude<TrendFailureCode, 'permission_denied'>;
        expiresAt: Date;
        evidenceRefs?: TrendPlacePromptPayload['evidenceRefs'];
        contextCapsuleId?: string | null;
    },
) {
    const payload = buildFallbackPayload({
        input: normalized,
        query: input.query,
        sourceDigest: input.sourceDigest,
        failureCode: input.failureCode,
        expiresAt: input.expiresAt,
        evidenceRefs: input.evidenceRefs,
    });
    const validation = validateTrendPromptPayload(payload);
    const finalPayload = validation.ok ? validation.payload : payload;
    const cache = await updatePromptCacheById(prisma, input.promptId, normalized.requestedByUserId, {
        status: 'fallback',
        failureCode: input.failureCode,
        sourceDigest: input.sourceDigest,
        payload: finalPayload,
        expiresAt: finalPayload.expiresAt,
        contextCapsuleId: input.contextCapsuleId ?? null,
        aiJobId: input.aiJobId,
    });
    const proposal = await createTrendProposalEnvelope(prisma, {
        cache: cache ?? {
            id: input.promptId,
            requestedByUserId: normalized.requestedByUserId,
            sourceDigest: input.sourceDigest,
            contextCapsuleId: input.contextCapsuleId ?? null,
            payload: finalPayload,
            status: 'fallback',
            failureCode: input.failureCode,
            expiresAt: finalPayload.expiresAt,
        },
        promptVersion: getPromptMetadata('trend-place-prompt').promptVersion,
    });
    await updatePromptCacheById(prisma, input.promptId, normalized.requestedByUserId, {
        proposalArtifactId: proposal?.id ?? null,
    });
    return {
        promptId: input.promptId,
        proposalArtifactId: proposal?.id ?? null,
        status: 'fallback',
        failureCode: input.failureCode,
    };
}

function normalizeInput(input: TrendPromptInput): TrendPromptInput {
    return {
        promptId: input.promptId,
        placeSeed: String(input.placeSeed || '').trim(),
        locale: normalizeLocale(input.locale),
        communityType: normalizeCommunityType(input.communityType),
        mode: normalizeMode(input.mode),
        requestedByUserId: Number(input.requestedByUserId),
    };
}

async function findPromptCacheByUserAndCacheKey(
    prisma: any,
    input: {
        requestedByUserId: number;
        cacheKey: string;
    },
) {
    if (typeof prisma?.trendPromptCache?.findFirst === 'function') {
        return prisma.trendPromptCache.findFirst({
            where: {
                requestedByUserId: input.requestedByUserId,
                cacheKey: input.cacheKey,
            },
        });
    }
    if (typeof prisma?.trendPromptCache?.findUnique === 'function') {
        return prisma.trendPromptCache.findUnique({
            where: {
                requestedByUserId_cacheKey: {
                    requestedByUserId: input.requestedByUserId,
                    cacheKey: input.cacheKey,
                },
            },
        });
    }
    return null;
}

async function upsertPromptCache(
    prisma: any,
    input: {
        id: string;
        requestedByUserId: number;
        cacheKey: string;
        inputDigest: string;
        sanitizedIntentDigest: string;
        sourceDigest: string;
        status: string;
        failureCode: string | null;
        payload: TrendPlacePromptPayload;
        expiresAt: string | null;
    },
) {
    const data = {
        id: input.id,
        cacheKey: input.cacheKey,
        taskType: TREND_PLACE_PROMPT_TASK_TYPE,
        requestedByUserId: input.requestedByUserId,
        inputDigest: input.inputDigest,
        sanitizedIntentDigest: input.sanitizedIntentDigest,
        sourceDigest: input.sourceDigest,
        status: input.status,
        failureCode: input.failureCode,
        proposalArtifactId: null,
        contextCapsuleId: null,
        aiJobId: null,
        payload: input.payload,
        expiresAt: normalizeDateInput(input.expiresAt),
    };
    if (typeof prisma?.trendPromptCache?.upsert === 'function') {
        return prisma.trendPromptCache.upsert({
            where: {
                requestedByUserId_cacheKey: {
                    requestedByUserId: input.requestedByUserId,
                    cacheKey: input.cacheKey,
                },
            },
            create: data,
            update: {
                status: data.status,
                failureCode: data.failureCode,
                payload: data.payload,
                expiresAt: data.expiresAt,
                sourceDigest: data.sourceDigest,
            },
        });
    }
    return data;
}

async function updatePromptCacheById(
    prisma: any,
    promptId: string,
    requestedByUserId: number,
    data: Record<string, unknown>,
) {
    const normalized = { ...data };
    if (Object.prototype.hasOwnProperty.call(normalized, 'expiresAt')) {
        normalized.expiresAt = normalizeDateInput(data.expiresAt as any);
    }
    if (typeof prisma?.trendPromptCache?.updateMany === 'function') {
        await prisma.trendPromptCache.updateMany({
            where: {
                id: promptId,
                requestedByUserId,
            },
            data: normalized,
        });
    }
    if (typeof prisma?.trendPromptCache?.findUnique === 'function') {
        return prisma.trendPromptCache.findUnique({ where: { id: promptId } });
    }
    return {
        id: promptId,
        requestedByUserId,
        ...normalized,
    };
}

async function isDailyBudgetExceeded(
    prisma: any,
    requestedByUserId: number,
    userDailyLimit: number,
): Promise<boolean> {
    if (userDailyLimit <= 0) return true;
    if (typeof prisma?.trendPromptCache?.count !== 'function') return false;
    const start = new Date();
    start.setUTCHours(0, 0, 0, 0);
    const count = await prisma.trendPromptCache.count({
        where: {
            requestedByUserId,
            taskType: TREND_PLACE_PROMPT_TASK_TYPE,
            createdAt: {
                gte: start,
            },
        },
    });
    return Number(count || 0) >= userDailyLimit;
}

function normalizePayload(value: unknown): TrendPlacePromptPayload {
    const validation = validateTrendPromptPayload(value);
    if (validation.ok) return validation.payload;
    return value as TrendPlacePromptPayload;
}

function averageConfidence(receipts: Array<{ confidence: number }>): number {
    if (!receipts.length) return 0.5;
    return receipts.reduce((sum, receipt) => sum + receipt.confidence, 0) / receipts.length;
}

type AiOperatingLayerEnvelopeMode = 'off' | 'dry_run' | 'write';

function resolveAiOperatingLayerEnvelopeMode(): AiOperatingLayerEnvelopeMode {
    const normalized = String(process.env.AI_OPERATING_LAYER_ENVELOPE_MODE || 'write')
        .trim()
        .toLowerCase();
    return normalized === 'off' || normalized === 'dry_run' || normalized === 'write'
        ? normalized
        : 'write';
}

function canWriteProposalEnvelope(prisma: any): boolean {
    return typeof prisma?.aiProposalArtifact?.upsert === 'function';
}

async function createTrendProposalEnvelope(
    prisma: any,
    input: Parameters<typeof createProposalForTrendPromptCache>[1],
) {
    if (resolveAiOperatingLayerEnvelopeMode() !== 'write') return null;
    if (!canWriteProposalEnvelope(prisma)) return null;
    try {
        return await createProposalForTrendPromptCache(prisma, input);
    } catch {
        return null;
    }
}

function normalizeDateInput(value: Date | string | null | undefined): Date | null {
    if (value instanceof Date) return value;
    if (typeof value === 'string' && value.trim()) {
        const parsed = new Date(value);
        return Number.isNaN(parsed.getTime()) ? null : parsed;
    }
    return null;
}

function toDate(value: unknown): Date | null {
    if (value instanceof Date) return value;
    if (typeof value === 'string' && value.trim()) {
        const parsed = new Date(value);
        return Number.isNaN(parsed.getTime()) ? null : parsed;
    }
    return null;
}
