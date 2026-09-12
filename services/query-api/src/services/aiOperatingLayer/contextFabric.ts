import crypto from 'crypto';

import type {
    AiRuntimeRole,
    ContextCapsule,
    EvidenceRef,
} from './types';
import { validateEvidenceRefs } from './evidenceLedger';

const SAFE_EXCERPT_POLICY_KEYS = new Set([
    'mode',
    'maxExcerptChars',
    'maxEvidenceRefs',
    'includeDirectQuotes',
    'redaction',
    'chunkStrategy',
    'citationStyle',
]);

const SAFE_TOKEN_BUDGET_KEYS = new Set([
    'maxInputTokens',
    'maxOutputTokens',
    'maxEvidenceRefs',
    'maxExcerptChars',
    'reservedOutputTokens',
    'truncate',
]);

interface BuildContextCapsuleInput {
    taskType: string;
    subjectType: string;
    subjectId: string;
    actorUserId?: number | null;
    visibility: string;
    runtimeRole: AiRuntimeRole;
    evidenceRefs: EvidenceRef[];
    contextPayload?: Record<string, unknown>;
    excerptPolicy?: Record<string, unknown>;
    tokenBudget?: Record<string, unknown>;
    privatePlaintextMode?: string;
}

export function buildContextCapsule(input: BuildContextCapsuleInput): {
    ok: true;
    capsule: ContextCapsule;
} | {
    ok: false;
    error:
        | 'private_sidecar_required'
        | 'invalid_source_ref'
        | 'digest_mismatch'
        | 'unsafe_excerpt_policy'
        | 'unsafe_token_budget';
} {
    if (
        (input.visibility === 'private_plaintext' || input.privatePlaintextMode === 'private_plaintext') &&
        input.runtimeRole !== 'PRIVATE_SIDECAR'
    ) {
        return {
            ok: false,
            error: 'private_sidecar_required',
        };
    }

    const validation = validateEvidenceRefs(input.evidenceRefs);
    if (!validation.ok) {
        return {
            ok: false,
            error: validation.reasonCode,
        };
    }

    const excerptPolicy = sanitizeExcerptPolicy(input.excerptPolicy ?? {});
    if (!excerptPolicy.ok) {
        return {
            ok: false,
            error: 'unsafe_excerpt_policy',
        };
    }
    const tokenBudget = sanitizeTokenBudget(input.tokenBudget ?? {});
    if (!tokenBudget.ok) {
        return {
            ok: false,
            error: 'unsafe_token_budget',
        };
    }

    const sourceDigest = digestJson(input.evidenceRefs.map((ref) => ({
        sourceType: ref.sourceType,
        sourceId: ref.sourceId,
        digest: ref.digest,
        visibility: ref.visibility,
    })));
    const contextDigest = digestJson({
        taskType: input.taskType,
        subjectType: input.subjectType,
        subjectId: input.subjectId,
        sourceDigest,
        contextPayload: input.contextPayload ?? {},
        excerptPolicy: excerptPolicy.value,
    });

    return {
        ok: true,
        capsule: {
            id: `ctx_${contextDigest.slice(0, 24)}`,
            taskType: input.taskType,
            subjectType: input.subjectType,
            subjectId: input.subjectId,
            actorUserId: input.actorUserId ?? null,
            visibility: input.visibility,
            runtimeRole: input.runtimeRole,
            sourceDigest,
            contextDigest,
            sourceRefs: input.evidenceRefs,
            contextPayload: input.contextPayload ?? {},
            excerptPolicy: excerptPolicy.value,
            redactionReport: [],
            tokenBudget: tokenBudget.value,
            privatePlaintextMode: input.privatePlaintextMode ?? input.visibility,
            createdAt: new Date().toISOString(),
        },
    };
}

export async function persistContextCapsule(
    prisma: any,
    capsule: ContextCapsule,
    input: {
        cacheKey?: string | null;
        expiresAt?: Date | string | null;
    } = {},
) {
    const data = {
        id: capsule.id,
        taskType: capsule.taskType,
        subjectType: capsule.subjectType,
        subjectId: capsule.subjectId,
        actorUserId: capsule.actorUserId,
        visibility: capsule.visibility,
        runtimeRole: capsule.runtimeRole,
        sourceDigest: capsule.sourceDigest,
        contextDigest: capsule.contextDigest,
        sourceRefs: capsule.sourceRefs,
        contextPayload: capsule.contextPayload ?? {},
        excerptPolicy: capsule.excerptPolicy,
        redactionReport: capsule.redactionReport,
        tokenBudget: capsule.tokenBudget,
        privatePlaintextMode: capsule.privatePlaintextMode,
        cacheKey: input.cacheKey ?? null,
        expiresAt: normalizeDateInput(input.expiresAt),
    };

    if (typeof prisma?.aiContextCapsule?.upsert === 'function') {
        return prisma.aiContextCapsule.upsert({
            where: { id: capsule.id },
            create: data,
            update: {
                sourceRefs: data.sourceRefs,
                contextPayload: data.contextPayload,
                excerptPolicy: data.excerptPolicy,
                redactionReport: data.redactionReport,
                tokenBudget: data.tokenBudget,
                cacheKey: data.cacheKey,
                expiresAt: data.expiresAt,
            },
        });
    }

    return data;
}

function sanitizeTokenBudget(input: Record<string, unknown>): {
    ok: true;
    value: Record<string, unknown>;
} | {
    ok: false;
} {
    const output: Record<string, unknown> = {};
    for (const [key, value] of Object.entries(input)) {
        if (!SAFE_TOKEN_BUDGET_KEYS.has(key)) return { ok: false };
        if (typeof value === 'number') {
            if (!Number.isFinite(value) || value < 0) return { ok: false };
            output[key] = Math.trunc(value);
            continue;
        }
        if (typeof value === 'boolean') {
            output[key] = value;
            continue;
        }
        return { ok: false };
    }
    return {
        ok: true,
        value: output,
    };
}

function sanitizeExcerptPolicy(input: Record<string, unknown>): {
    ok: true;
    value: Record<string, unknown>;
} | {
    ok: false;
} {
    const output: Record<string, unknown> = {};
    for (const [key, value] of Object.entries(input)) {
        if (!SAFE_EXCERPT_POLICY_KEYS.has(key)) return { ok: false };
        if (!isSafePolicyValue(value)) return { ok: false };
        output[key] = value;
    }
    return {
        ok: true,
        value: output,
    };
}

function isSafePolicyValue(value: unknown): boolean {
    if (value === null) return true;
    if (typeof value === 'boolean') return true;
    if (typeof value === 'number') return Number.isFinite(value);
    if (typeof value === 'string') return /^[a-z0-9_.:-]{1,80}$/i.test(value);
    if (Array.isArray(value)) return value.every(isSafePolicyValue);
    if (typeof value === 'object') {
        return Object.entries(value as Record<string, unknown>).every(([key, nested]) =>
            SAFE_EXCERPT_POLICY_KEYS.has(key) && isSafePolicyValue(nested),
        );
    }
    return false;
}

function digestJson(value: unknown): string {
    return crypto
        .createHash('sha256')
        .update(JSON.stringify(value))
        .digest('hex');
}

function normalizeDateInput(value: Date | string | null | undefined): Date | null {
    if (value instanceof Date) return value;
    if (typeof value === 'string' && value.trim()) {
        const parsed = new Date(value);
        return Number.isNaN(parsed.getTime()) ? null : parsed;
    }
    return null;
}
