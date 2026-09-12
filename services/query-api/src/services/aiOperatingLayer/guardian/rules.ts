import crypto from 'crypto';

import { buildEvidenceRefFromSourceMaterial } from '../evidenceLedger';
import type { GuardianFindingCandidate, GuardianFindingLevel } from './types';

export const GUARDIAN_SOURCE_REVIEW_RULE_VERSION = 'guardian-source-review-backlog-v1';

const OBSERVE_COOLDOWN_HOURS = 24;
const NOTIFY_COOLDOWN_HOURS = 72;
const PROPOSE_COOLDOWN_HOURS = 24 * 7;

interface SourceReviewMaterial {
    id: number | string;
    circleId?: number | string | null;
    name?: string | null;
    contentDigest?: string | null;
    lifecycleStatus?: string | null;
    evidencePrivacyClass?: string | null;
    visibilityScope?: string | null;
    originType?: string | null;
    originRef?: string | null;
    createdAt?: Date | string | null;
}

interface EvaluateSourceReviewBacklogInput {
    circleId: number;
    ownerUserId?: number | null;
    materials: SourceReviewMaterial[];
    now?: Date;
}

export function evaluateSourceReviewBacklog(
    input: EvaluateSourceReviewBacklogInput,
): GuardianFindingCandidate | null {
    const materials = input.materials.filter((material) =>
        Number(material.circleId ?? input.circleId) === input.circleId,
    );
    if (materials.length === 0) return null;

    const now = input.now ?? new Date();
    const oldestCreatedAt = materials
        .map((material) => normalizeDate(material.createdAt))
        .filter((date): date is Date => Boolean(date))
        .sort((left, right) => left.getTime() - right.getTime())[0] ?? now;
    const oldestAgeHours = Math.max(0, Math.floor((now.getTime() - oldestCreatedAt.getTime()) / 3_600_000));
    const level = resolveBacklogLevel({
        pendingCount: materials.length,
        oldestAgeHours,
    });
    const evidenceRefs = materials
        .slice(0, 10)
        .map((material) => buildEvidenceRefFromSourceMaterial({
            id: material.id,
            contentDigest: normalizeDigest(material.contentDigest),
            name: material.name,
            lifecycleStatus: material.lifecycleStatus ?? 'review_pending',
            evidencePrivacyClass: material.evidencePrivacyClass ?? 'reviewer_only',
            visibilityScope: material.visibilityScope ?? 'reviewers',
            originType: material.originType,
            originRef: material.originRef,
        }));
    const sourceDigest = digest(JSON.stringify(evidenceRefs.map((ref) => ({
        sourceType: ref.sourceType,
        sourceId: ref.sourceId,
        digest: ref.digest,
        visibility: ref.visibility,
    }))));
    const suggestedAction = buildSuggestedAction(level, input.circleId);
    const cooldownUntil = new Date(now.getTime() + cooldownHoursForLevel(level) * 3_600_000);

    return {
        ownerUserId: input.ownerUserId ?? null,
        circleId: input.circleId,
        findingKind: 'source_review_backlog',
        level,
        riskLevel: level === 'propose' ? 'medium' : 'low',
        severity: level === 'propose' ? 'high' : level === 'notify' ? 'medium' : 'info',
        title: 'Source review queue needs attention',
        summary: `${materials.length} source material${materials.length === 1 ? '' : 's'} waiting for review.`,
        explanation: `Oldest source review item has waited ${oldestAgeHours} hour${oldestAgeHours === 1 ? '' : 's'}.`,
        evidenceRefs,
        suggestedAction,
        sourceDigest,
        dedupeKey: `guardian:source_review_backlog:${input.circleId}:${level}:${sourceDigest}`,
        ruleVersion: GUARDIAN_SOURCE_REVIEW_RULE_VERSION,
        modelProfile: null,
        cooldownUntil,
        notificationPolicy: level === 'observe' ? 'none' : 'ops',
    };
}

function resolveBacklogLevel(input: {
    pendingCount: number;
    oldestAgeHours: number;
}): GuardianFindingLevel {
    if (input.pendingCount >= 7 || input.oldestAgeHours >= 168) return 'propose';
    if (input.pendingCount >= 3 || input.oldestAgeHours >= 72) return 'notify';
    return 'observe';
}

function buildSuggestedAction(level: GuardianFindingLevel, circleId: number) {
    if (level === 'observe') {
        return {
            kind: 'watch_source_material_review_queue',
            labelKey: 'guardian.findings.actions.watchSourceMaterials',
            target: {
                type: 'circle_source_materials',
                circleId,
            },
            requiresConfirmation: false,
            forbiddenDirectEffects: [
                'source_material_accept',
                'source_material_reject',
                'source_material_redact',
                'circle_settings_write',
                'external_notify',
            ],
        };
    }

    if (level === 'notify') {
        return {
            kind: 'notify_source_material_review_backlog',
            labelKey: 'guardian.findings.actions.notifySourceMaterials',
            target: {
                type: 'circle_source_materials',
                circleId,
            },
            requiresConfirmation: true,
            forbiddenDirectEffects: [
                'source_material_accept',
                'source_material_reject',
                'source_material_redact',
                'circle_settings_write',
                'external_notify',
            ],
        };
    }

    return {
        kind: 'open_source_material_review_queue',
        labelKey: 'guardian.findings.actions.reviewSourceMaterials',
        target: {
            type: 'circle_source_materials',
            circleId,
        },
        requiresConfirmation: true,
        forbiddenDirectEffects: [
            'source_material_accept',
            'source_material_reject',
            'source_material_redact',
            'circle_settings_write',
            'external_notify',
        ],
    };
}

function cooldownHoursForLevel(level: GuardianFindingLevel): number {
    if (level === 'propose') return PROPOSE_COOLDOWN_HOURS;
    if (level === 'notify') return NOTIFY_COOLDOWN_HOURS;
    return OBSERVE_COOLDOWN_HOURS;
}

function normalizeDate(value: Date | string | null | undefined): Date | null {
    if (value instanceof Date) return value;
    if (typeof value === 'string' && value.trim()) {
        const parsed = new Date(value);
        return Number.isNaN(parsed.getTime()) ? null : parsed;
    }
    return null;
}

function normalizeDigest(value: unknown): string {
    const text = typeof value === 'string' ? value : '';
    if (/^[a-f0-9]{64}$/i.test(text)) return text;
    return digest(String(text || 'missing_source_material_digest'));
}

function digest(value: string): string {
    return crypto.createHash('sha256').update(value).digest('hex');
}
