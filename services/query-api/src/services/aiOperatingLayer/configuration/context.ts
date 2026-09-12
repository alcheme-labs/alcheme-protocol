import crypto from 'crypto';

import {
    buildContextCapsule,
    persistContextCapsule,
} from '../contextFabric';
import type { EvidenceRef } from '../types';
import {
    CONFIGURATION_FIELD_POLICY_VERSION,
    normalizeConfigurationSnapshot,
} from './fieldPolicy';
import { loadConfigurationCopilotConfig } from './config';
import type {
    ConfigurationCopilotContextPayload,
    ConfigurationCopilotEntrypoint,
    ConfigurationCopilotInteractionMode,
    ConfigurationCopilotSubjectType,
} from './types';

export interface PersistConfigurationContextInput {
    prisma: any;
    entrypoint: ConfigurationCopilotEntrypoint;
    subjectType: ConfigurationCopilotSubjectType;
    subjectId: string;
    requestedByUserId: number;
    locale: 'en' | 'zh' | 'fr' | 'es';
    userIntent: unknown;
    currentSnapshot: unknown;
    targetFields?: string[];
    interactionMode?: ConfigurationCopilotInteractionMode;
    evidenceRefs?: EvidenceRef[];
    sourceMaterialRefs?: EvidenceRef[];
    trendRefs?: EvidenceRef[];
    now?: Date;
}

export interface LoadedConfigurationContext {
    capsuleId: string;
    taskType: 'configuration.copilot.v1';
    subjectType: ConfigurationCopilotSubjectType;
    subjectId: string;
    actorUserId: number | null;
    sourceDigest: string;
    contextDigest: string;
    evidenceRefs: EvidenceRef[];
    payload: ConfigurationCopilotContextPayload;
    expiresAt: Date | null;
}

export async function persistConfigurationCopilotContext(
    input: PersistConfigurationContextInput,
): Promise<{
    capsuleId: string;
    contextDigest: string;
    sourceDigest: string;
    payload: ConfigurationCopilotContextPayload;
}> {
    const config = loadConfigurationCopilotConfig();
    const intentText = sanitizeIntent(input.userIntent, config.maxIntentChars);
    const normalizedSnapshot = normalizeConfigurationSnapshot(input.entrypoint, input.currentSnapshot);
    const evidenceRefs = [
        ...(input.evidenceRefs ?? []),
        ...(input.trendRefs ?? []),
        ...(input.sourceMaterialRefs ?? []),
    ];
    const payload: ConfigurationCopilotContextPayload = {
        kind: 'configuration_copilot.v1',
        entrypoint: input.entrypoint,
        locale: input.locale,
        sanitizedIntent: {
            text: intentText,
            digest: digestJson(intentText),
        },
        normalizedSnapshot,
        fieldPolicyVersion: CONFIGURATION_FIELD_POLICY_VERSION,
        targetFields: normalizeTargetFields(input.targetFields),
        interactionMode: input.interactionMode ?? 'full_panel',
        trendRefs: input.trendRefs ?? [],
        sourceMaterialRefs: input.sourceMaterialRefs ?? [],
    };

    const capsule = buildContextCapsule({
        taskType: 'configuration.copilot.v1',
        subjectType: input.subjectType,
        subjectId: input.subjectId,
        actorUserId: input.requestedByUserId,
        visibility: 'member_visible',
        runtimeRole: 'PUBLIC_NODE',
        evidenceRefs,
        contextPayload: payload as unknown as Record<string, unknown>,
        excerptPolicy: {
            mode: 'metadata_only',
            redaction: 'configuration_copilot_v1',
        },
        tokenBudget: {
            maxInputTokens: 2000,
            maxOutputTokens: 1000,
            maxEvidenceRefs: 12,
        },
        privatePlaintextMode: 'member_visible',
    });

    if (!capsule.ok) {
        throw new Error(`configuration_context_rejected:${capsule.error}`);
    }

    await persistContextCapsule(input.prisma, capsule.capsule, {
        cacheKey: `configuration_copilot:${input.subjectType}:${input.subjectId}:${payload.sanitizedIntent.digest}`,
        expiresAt: new Date((input.now ?? new Date()).getTime() + config.contextTtlMs),
    });

    return {
        capsuleId: capsule.capsule.id,
        contextDigest: capsule.capsule.contextDigest,
        sourceDigest: capsule.capsule.sourceDigest,
        payload,
    };
}

export async function loadConfigurationCopilotContext(
    prisma: any,
    input: {
        contextCapsuleId: string | null | undefined;
        expectedSubjectType?: string | null;
        expectedSubjectId?: string | null;
        expectedActorUserId?: number | null;
        now?: Date;
    },
): Promise<LoadedConfigurationContext> {
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
    if (String(row.taskType || '') !== 'configuration.copilot.v1') {
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
        taskType: 'configuration.copilot.v1',
        subjectType: String(row.subjectType || row.subject_type || '') as ConfigurationCopilotSubjectType,
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

export function buildSourceMaterialEvidenceRef(input: {
    materialId: number;
    contentDigest: string;
    visibility: 'public' | 'member_visible' | 'reviewer_only' | 'sealed' | 'redacted';
    circleId: number;
    name?: string | null;
    lifecycleStatus?: string | null;
    capturedAt?: Date;
}): EvidenceRef {
    const capturedAt = input.capturedAt ?? new Date();
    return {
        sourceType: 'source_material',
        sourceId: String(input.materialId),
        digest: normalizeHexDigest(input.contentDigest || `source_material:${input.materialId}`),
        visibility: input.visibility,
        locator: {
            type: 'source_material',
            ref: `source_material:${input.materialId}`,
        },
        permissionSnapshot: {
            circleId: input.circleId,
            lifecycleStatus: input.lifecycleStatus ?? null,
            metadataOnly: true,
            name: input.name ?? null,
        },
        capturedAt: capturedAt.toISOString(),
        expiresAt: null,
    };
}

function normalizeContextPayload(value: unknown): ConfigurationCopilotContextPayload | null {
    if (!value || typeof value !== 'object' || Array.isArray(value)) return null;
    const record = value as Record<string, unknown>;
    if (record.kind !== 'configuration_copilot.v1') return null;
    if (record.entrypoint !== 'create_circle' && record.entrypoint !== 'circle_settings' && record.entrypoint !== 'fork_create') return null;
    const locale = normalizeLocale(record.locale);
    const sanitizedIntent = record.sanitizedIntent && typeof record.sanitizedIntent === 'object' && !Array.isArray(record.sanitizedIntent)
        ? record.sanitizedIntent as Record<string, unknown>
        : null;
    const normalizedSnapshot = record.normalizedSnapshot && typeof record.normalizedSnapshot === 'object' && !Array.isArray(record.normalizedSnapshot)
        ? record.normalizedSnapshot as Record<string, unknown>
        : {};
    return {
        kind: 'configuration_copilot.v1',
        entrypoint: record.entrypoint,
        locale,
        sanitizedIntent: {
            text: String(sanitizedIntent?.text ?? '').slice(0, 1200),
            digest: normalizeHexDigest(String(sanitizedIntent?.digest ?? '')),
        },
        normalizedSnapshot,
        fieldPolicyVersion: String(record.fieldPolicyVersion || CONFIGURATION_FIELD_POLICY_VERSION),
        targetFields: normalizeTargetFields(record.targetFields),
        interactionMode: normalizeInteractionMode(record.interactionMode),
        trendRefs: Array.isArray(record.trendRefs) ? record.trendRefs as EvidenceRef[] : [],
        sourceMaterialRefs: Array.isArray(record.sourceMaterialRefs) ? record.sourceMaterialRefs as EvidenceRef[] : [],
    };
}

function sanitizeIntent(value: unknown, maxChars: number): string {
    const text = String(value ?? '')
        .replace(/\s+/g, ' ')
        .trim();
    return text.slice(0, Math.max(1, maxChars));
}

function normalizeHexDigest(value: string): string {
    return /^[a-f0-9]{64}$/i.test(value)
        ? value.toLowerCase()
        : digestJson(value || 'missing_digest');
}

function normalizeTargetFields(value: unknown): string[] {
    if (!Array.isArray(value)) return [];
    return Array.from(new Set(
        value
            .map((item) => String(item || '').trim())
            .filter(Boolean),
    )).slice(0, 40);
}

function normalizeInteractionMode(value: unknown): ConfigurationCopilotInteractionMode {
    if (value === 'field_inline' || value === 'section_diff' || value === 'full_panel') {
        return value;
    }
    return 'full_panel';
}

function digestJson(value: unknown): string {
    return crypto
        .createHash('sha256')
        .update(JSON.stringify(value))
        .digest('hex');
}
