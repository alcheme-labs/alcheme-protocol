import crypto from 'crypto';

import {
    buildContextCapsule,
    persistContextCapsule,
} from '../contextFabric';
import type { EvidenceRef } from '../types';
import { loadSettingsTextAssistConfig } from './config';
import {
    getSettingsTextFieldPolicy,
    normalizeSettingsTextValue,
} from './fieldPolicy';
import type {
    SettingsTextAssistContextPayload,
    SettingsTextAssistField,
    SettingsTextAssistSubjectType,
} from './types';

export const SETTINGS_TEXT_ASSIST_POLICY_VERSION = 'v1';

export interface PersistSettingsTextAssistContextInput {
    prisma: any;
    subjectType: SettingsTextAssistSubjectType;
    subjectId: string;
    field: SettingsTextAssistField;
    requestedByUserId: number;
    locale: 'en' | 'zh' | 'fr' | 'es';
    userIntent: unknown;
    currentValue: unknown;
    surroundingValues?: unknown;
    now?: Date;
}

export interface LoadedSettingsTextAssistContext {
    capsuleId: string;
    taskType: 'settings.field_text_suggestion.v1';
    subjectType: SettingsTextAssistSubjectType;
    subjectId: string;
    actorUserId: number | null;
    sourceDigest: string;
    contextDigest: string;
    evidenceRefs: EvidenceRef[];
    payload: SettingsTextAssistContextPayload;
    expiresAt: Date | null;
}

export async function persistSettingsTextAssistContext(
    input: PersistSettingsTextAssistContextInput,
): Promise<{
    capsuleId: string;
    contextDigest: string;
    sourceDigest: string;
    payload: SettingsTextAssistContextPayload;
}> {
    const policy = getSettingsTextFieldPolicy(input.field);
    if (!policy || policy.subjectType !== input.subjectType) {
        throw new Error('settings_text_context_field_mismatch');
    }

    const config = loadSettingsTextAssistConfig();
    const intentText = sanitizeIntent(input.userIntent, config.maxIntentChars);
    const payload: SettingsTextAssistContextPayload = {
        kind: 'settings_text_assist.v1',
        field: input.field,
        locale: input.locale,
        sanitizedIntent: {
            text: intentText,
            digest: digestJson(intentText),
        },
        currentValue: normalizeSettingsTextValue(input.field, input.currentValue),
        surroundingValues: sanitizeSurroundingValues(input.surroundingValues),
        fieldPolicyVersion: SETTINGS_TEXT_ASSIST_POLICY_VERSION,
    };

    const capsule = buildContextCapsule({
        taskType: 'settings.field_text_suggestion.v1',
        subjectType: input.subjectType,
        subjectId: input.subjectId,
        actorUserId: input.requestedByUserId,
        visibility: 'member_visible',
        runtimeRole: 'PUBLIC_NODE',
        evidenceRefs: [],
        contextPayload: payload as unknown as Record<string, unknown>,
        excerptPolicy: {
            mode: 'metadata_only',
            redaction: 'settings_text_assist_v1',
        },
        tokenBudget: {
            maxInputTokens: 700,
            maxOutputTokens: 300,
            maxEvidenceRefs: 0,
        },
        privatePlaintextMode: 'member_visible',
    });

    if (!capsule.ok) {
        throw new Error(`settings_text_context_rejected:${capsule.error}`);
    }

    await persistContextCapsule(input.prisma, capsule.capsule, {
        cacheKey: `settings_text_assist:${input.subjectType}:${input.subjectId}:${input.field}:${payload.sanitizedIntent.digest}`,
        expiresAt: new Date((input.now ?? new Date()).getTime() + config.contextTtlMs),
    });

    return {
        capsuleId: capsule.capsule.id,
        contextDigest: capsule.capsule.contextDigest,
        sourceDigest: capsule.capsule.sourceDigest,
        payload,
    };
}

export async function loadSettingsTextAssistContext(
    prisma: any,
    input: {
        contextCapsuleId: string | null | undefined;
        expectedSubjectType?: string | null;
        expectedSubjectId?: string | null;
        expectedActorUserId?: number | null;
        now?: Date;
    },
): Promise<LoadedSettingsTextAssistContext> {
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
    if (String(row.taskType || '') !== 'settings.field_text_suggestion.v1') {
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
    const sourceRefs = Array.isArray(row.sourceRefs)
        ? row.sourceRefs as EvidenceRef[]
        : Array.isArray(row.source_refs)
            ? row.source_refs as EvidenceRef[]
            : [];
    return {
        capsuleId: contextCapsuleId,
        taskType: 'settings.field_text_suggestion.v1',
        subjectType: String(row.subjectType || row.subject_type || '') as SettingsTextAssistSubjectType,
        subjectId: String(row.subjectId || row.subject_id || ''),
        actorUserId: row.actorUserId === null || row.actorUserId === undefined
            ? null
            : Number(row.actorUserId),
        sourceDigest: String(row.sourceDigest || row.source_digest || ''),
        contextDigest: String(row.contextDigest || row.context_digest || ''),
        evidenceRefs: sourceRefs,
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

function normalizeContextPayload(value: unknown): SettingsTextAssistContextPayload | null {
    if (!value || typeof value !== 'object' || Array.isArray(value)) return null;
    const record = value as Record<string, unknown>;
    if (record.kind !== 'settings_text_assist.v1') return null;
    const field = String(record.field || '').trim() as SettingsTextAssistField;
    const policy = getSettingsTextFieldPolicy(field);
    if (!policy) return null;
    const sanitizedIntent = record.sanitizedIntent && typeof record.sanitizedIntent === 'object' && !Array.isArray(record.sanitizedIntent)
        ? record.sanitizedIntent as Record<string, unknown>
        : {};
    return {
        kind: 'settings_text_assist.v1',
        field,
        locale: normalizeLocale(record.locale),
        sanitizedIntent: {
            text: String(sanitizedIntent.text ?? '').slice(0, 500),
            digest: normalizeHexDigest(String(sanitizedIntent.digest ?? '')),
        },
        currentValue: normalizeSettingsTextValue(field, record.currentValue),
        surroundingValues: sanitizeSurroundingValues(record.surroundingValues),
        fieldPolicyVersion: String(record.fieldPolicyVersion || SETTINGS_TEXT_ASSIST_POLICY_VERSION),
    };
}

function sanitizeIntent(value: unknown, maxChars: number): string {
    const text = String(value ?? '')
        .replace(/\s+/g, ' ')
        .trim();
    return text.slice(0, Math.max(1, maxChars));
}

function sanitizeSurroundingValues(value: unknown): Record<string, string> {
    if (!value || typeof value !== 'object' || Array.isArray(value)) return {};
    const output: Record<string, string> = {};
    const allowedKeys = new Set([
        'displayName',
        'bio',
        'alias',
        'circleName',
        'circleDescription',
    ]);
    for (const [key, raw] of Object.entries(value as Record<string, unknown>)) {
        if (!allowedKeys.has(key)) continue;
        const text = String(raw ?? '').replace(/\s+/g, ' ').trim().slice(0, 180);
        if (text) output[key] = text;
    }
    return output;
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
