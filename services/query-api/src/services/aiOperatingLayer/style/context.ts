import crypto from 'crypto';

import {
    buildContextCapsule,
    persistContextCapsule,
} from '../contextFabric';
import type { EvidenceRef } from '../types';
import { loadStyleAdvisorConfig } from './config';
import type {
    StyleAdvisorContextPayload,
    StyleAdvisorScope,
    StyleSubjectType,
} from './types';
import {
    STYLE_TOKEN_POLICY_VERSION,
    normalizeStylePreferenceParts,
} from './validator';

export interface PersistStyleAdvisorContextInput {
    prisma: any;
    scope: StyleAdvisorScope;
    subjectType: StyleSubjectType;
    subjectId: string;
    requestedByUserId: number;
    locale: 'en' | 'zh' | 'fr' | 'es';
    userIntent: unknown;
    currentPreference: unknown;
    lifeFeelSignals?: unknown;
    publicCircleSnapshot?: unknown;
    now?: Date;
}

export interface LoadedStyleAdvisorContext {
    capsuleId: string;
    taskType: 'style.life_feel_advisor.v1';
    subjectType: StyleSubjectType;
    subjectId: string;
    actorUserId: number | null;
    sourceDigest: string;
    contextDigest: string;
    evidenceRefs: EvidenceRef[];
    payload: StyleAdvisorContextPayload;
    expiresAt: Date | null;
}

export async function persistStyleAdvisorContext(
    input: PersistStyleAdvisorContextInput,
): Promise<{
    capsuleId: string;
    contextDigest: string;
    sourceDigest: string;
    payload: StyleAdvisorContextPayload;
}> {
    const config = loadStyleAdvisorConfig();
    const intentText = sanitizeIntent(input.userIntent, config.maxIntentChars);
    const normalizedPreference = normalizeStylePreferenceParts(input.currentPreference);
    const payload: StyleAdvisorContextPayload = {
        kind: 'style_life_feel_advisor.v1',
        scope: input.scope,
        locale: input.locale,
        sanitizedIntent: {
            text: intentText,
            digest: digestJson(intentText),
        },
        currentPreference: normalizedPreference,
        lifeFeelSignals: sanitizeSignals(input.lifeFeelSignals),
        publicCircleSnapshot: input.scope === 'circle'
            ? sanitizePublicCircleSnapshot(input.publicCircleSnapshot)
            : null,
        tokenPolicyVersion: STYLE_TOKEN_POLICY_VERSION,
        evidenceRefs: [],
    };

    const capsule = buildContextCapsule({
        taskType: 'style.life_feel_advisor.v1',
        subjectType: input.subjectType,
        subjectId: input.subjectId,
        actorUserId: input.requestedByUserId,
        visibility: input.scope === 'circle' ? 'member_visible' : 'member_visible',
        runtimeRole: 'PUBLIC_NODE',
        evidenceRefs: [],
        contextPayload: payload as unknown as Record<string, unknown>,
        excerptPolicy: {
            mode: 'metadata_only',
            redaction: 'style_life_feel_advisor_v1',
        },
        tokenBudget: {
            maxInputTokens: 1200,
            maxOutputTokens: 700,
            maxEvidenceRefs: 0,
        },
        privatePlaintextMode: 'member_visible',
    });

    if (!capsule.ok) {
        throw new Error(`style_context_rejected:${capsule.error}`);
    }

    await persistContextCapsule(input.prisma, capsule.capsule, {
        cacheKey: `style_life_feel:${input.subjectType}:${input.subjectId}:${payload.sanitizedIntent.digest}`,
        expiresAt: new Date((input.now ?? new Date()).getTime() + config.contextTtlMs),
    });

    return {
        capsuleId: capsule.capsule.id,
        contextDigest: capsule.capsule.contextDigest,
        sourceDigest: capsule.capsule.sourceDigest,
        payload,
    };
}

export async function loadStyleAdvisorContext(
    prisma: any,
    input: {
        contextCapsuleId: string | null | undefined;
        expectedSubjectType?: string | null;
        expectedSubjectId?: string | null;
        expectedActorUserId?: number | null;
        now?: Date;
    },
): Promise<LoadedStyleAdvisorContext> {
    const contextCapsuleId = String(input.contextCapsuleId || '').trim();
    if (!contextCapsuleId) {
        throw new Error('missing_context_capsule');
    }
    const row = typeof prisma?.aiContextCapsule?.findUnique === 'function'
        ? await prisma.aiContextCapsule.findUnique({ where: { id: contextCapsuleId } })
        : null;
    if (!row) {
        throw new Error('missing_context_capsule');
    }
    if (String(row.taskType || '') !== 'style.life_feel_advisor.v1') {
        throw new Error('context_capsule_task_mismatch');
    }
    if (input.expectedSubjectType && String(row.subjectType || '') !== input.expectedSubjectType) {
        throw new Error('context_capsule_subject_mismatch');
    }
    if (input.expectedSubjectId && String(row.subjectId || '') !== input.expectedSubjectId) {
        throw new Error('context_capsule_subject_mismatch');
    }
    if (
        input.expectedActorUserId &&
        Number(row.actorUserId ?? 0) !== Number(input.expectedActorUserId)
    ) {
        throw new Error('context_capsule_actor_mismatch');
    }
    const expiresAt = row.expiresAt instanceof Date
        ? row.expiresAt
        : row.expiresAt
            ? new Date(String(row.expiresAt))
            : null;
    if (expiresAt && expiresAt.getTime() < (input.now ?? new Date()).getTime()) {
        throw new Error('context_capsule_expired');
    }
    const payload = normalizeContextPayload(row.contextPayload ?? row.context_payload);
    if (!payload) {
        throw new Error('context_capsule_payload_invalid');
    }
    return {
        capsuleId: contextCapsuleId,
        taskType: 'style.life_feel_advisor.v1',
        subjectType: String(row.subjectType || row.subject_type || '') as StyleSubjectType,
        subjectId: String(row.subjectId || row.subject_id || ''),
        actorUserId: row.actorUserId === null || row.actorUserId === undefined
            ? null
            : Number(row.actorUserId),
        sourceDigest: String(row.sourceDigest || row.source_digest || ''),
        contextDigest: String(row.contextDigest || row.context_digest || ''),
        evidenceRefs: [],
        payload,
        expiresAt,
    };
}

export function normalizeLocale(value: unknown): 'en' | 'zh' | 'fr' | 'es' {
    const normalized = String(value || '').trim().toLowerCase().split(/[-_]/)[0];
    return normalized === 'zh' || normalized === 'fr' || normalized === 'es'
        ? normalized
        : 'en';
}

function normalizeContextPayload(value: unknown): StyleAdvisorContextPayload | null {
    if (!value || typeof value !== 'object' || Array.isArray(value)) return null;
    const record = value as Record<string, unknown>;
    if (record.kind !== 'style_life_feel_advisor.v1') return null;
    const scope = record.scope === 'circle' || record.scope === 'session_preview'
        ? record.scope
        : 'personal';
    const locale = normalizeLocale(record.locale);
    const sanitizedIntent = record.sanitizedIntent && typeof record.sanitizedIntent === 'object' && !Array.isArray(record.sanitizedIntent)
        ? record.sanitizedIntent as Record<string, unknown>
        : {};
    const currentPreference = normalizeStylePreferenceParts(record.currentPreference);
    return {
        kind: 'style_life_feel_advisor.v1',
        scope,
        locale,
        sanitizedIntent: {
            text: String(sanitizedIntent.text ?? '').slice(0, 900),
            digest: normalizeHexDigest(String(sanitizedIntent.digest ?? '')),
        },
        currentPreference,
        lifeFeelSignals: sanitizeSignals(record.lifeFeelSignals),
        publicCircleSnapshot: scope === 'circle'
            ? sanitizePublicCircleSnapshot(record.publicCircleSnapshot)
            : null,
        tokenPolicyVersion: String(record.tokenPolicyVersion || STYLE_TOKEN_POLICY_VERSION),
        evidenceRefs: [],
    };
}

function sanitizeIntent(value: unknown, maxChars: number): string {
    const text = String(value ?? '')
        .replace(/\s+/g, ' ')
        .trim();
    return text.slice(0, Math.max(1, maxChars));
}

function sanitizeSignals(value: unknown): Record<string, unknown> {
    if (!value || typeof value !== 'object' || Array.isArray(value)) return {};
    const record = value as Record<string, unknown>;
    const output: Record<string, unknown> = {};
    ['activityLevel', 'readingDensity', 'recentInteractionTone'].forEach((key) => {
        const raw = record[key];
        if (typeof raw === 'string') {
            const text = raw.replace(/\s+/g, ' ').trim().slice(0, 80);
            if (text) output[key] = text;
        } else if (typeof raw === 'number' && Number.isFinite(raw)) {
            output[key] = Math.max(0, Math.min(10, Number(raw)));
        }
    });
    return output;
}

function sanitizePublicCircleSnapshot(value: unknown): Record<string, unknown> | null {
    if (!value || typeof value !== 'object' || Array.isArray(value)) return null;
    const record = value as Record<string, unknown>;
    const output: Record<string, unknown> = {};
    ['name', 'description', 'communityType', 'mode'].forEach((key) => {
        const text = String(record[key] ?? '').replace(/\s+/g, ' ').trim();
        if (text) output[key] = text.slice(0, key === 'description' ? 240 : 80);
    });
    return Object.keys(output).length > 0 ? output : null;
}

function normalizeHexDigest(value: string): string {
    return /^[a-f0-9]{64}$/i.test(value)
        ? value.toLowerCase()
        : digestJson(value || 'missing_digest');
}

function digestJson(value: unknown): string {
    return crypto
        .createHash('sha256')
        .update(JSON.stringify(value))
        .digest('hex');
}
