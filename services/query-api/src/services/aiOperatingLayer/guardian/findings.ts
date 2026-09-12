import crypto from 'crypto';

import { createAiProposalArtifact } from '../proposals';
import type {
    GuardianFindingCandidate,
    GuardianFindingStatus,
    GuardianFindingView,
} from './types';

type GuardianFindingAction = 'ack' | 'dismiss' | 'snooze';

interface PersistOptions {
    now?: Date;
}

interface GuardianFindingActionInput {
    findingId: string;
    actorUserId: number | null;
    action: GuardianFindingAction;
    reason?: string | null;
    snoozeUntil?: Date | string | null;
}

export async function persistGuardianFindingCandidate(
    prisma: any,
    candidate: GuardianFindingCandidate,
    options: PersistOptions = {},
): Promise<{
    status: 'created' | 'deduped';
    finding: GuardianFindingView;
}> {
    const now = options.now ?? new Date();
    const existing = typeof prisma?.guardianFinding?.findUnique === 'function'
        ? await prisma.guardianFinding.findUnique({
            where: { dedupeKey: candidate.dedupeKey },
        })
        : null;

    if (existing && isInCooldown(existing, now)) {
        await createFindingEvent(prisma, {
            findingId: existing.id,
            eventType: 'deduped',
            actorUserId: candidate.ownerUserId,
            eventPayload: {
                dedupeKey: candidate.dedupeKey,
                cooldownUntil: serializeDate(existing.cooldownUntil),
            },
        });
        return {
            status: 'deduped',
            finding: toGuardianFindingView(existing),
        };
    }

    if (existing) {
        const refreshed = await prisma.guardianFinding.update({
            where: { id: existing.id },
            data: {
                ownerUserId: candidate.ownerUserId,
                circleId: candidate.circleId,
                findingKind: candidate.findingKind,
                level: candidate.level,
                riskLevel: candidate.riskLevel,
                severity: candidate.severity,
                status: 'open',
                title: candidate.title,
                summary: candidate.summary,
                explanation: candidate.explanation,
                evidenceRefs: candidate.evidenceRefs,
                suggestedAction: sanitizeSuggestedAction(candidate.suggestedAction),
                sourceDigest: candidate.sourceDigest,
                ruleVersion: candidate.ruleVersion,
                modelProfile: candidate.modelProfile,
                cooldownUntil: candidate.cooldownUntil,
                notificationStatus: 'skipped',
                notificationError: null,
                convertedProposalId: null,
            },
        });
        await createFindingEvent(prisma, {
            findingId: refreshed.id,
            eventType: 'refreshed',
            actorUserId: candidate.ownerUserId,
            eventPayload: {
                previousStatus: existing.status,
                dedupeKey: candidate.dedupeKey,
                level: candidate.level,
                findingKind: candidate.findingKind,
                notificationPolicy: candidate.notificationPolicy,
            },
        });
        return {
            status: 'created',
            finding: toGuardianFindingView(refreshed),
        };
    }

    const finding = await prisma.guardianFinding.create({
        data: {
            id: `guardian_${digest(`${candidate.dedupeKey}:${now.toISOString()}`).slice(0, 24)}`,
            ownerUserId: candidate.ownerUserId,
            circleId: candidate.circleId,
            findingKind: candidate.findingKind,
            level: candidate.level,
            riskLevel: candidate.riskLevel,
            severity: candidate.severity,
            status: 'open',
            title: candidate.title,
            summary: candidate.summary,
            explanation: candidate.explanation,
            evidenceRefs: candidate.evidenceRefs,
            suggestedAction: sanitizeSuggestedAction(candidate.suggestedAction),
            sourceDigest: candidate.sourceDigest,
            dedupeKey: candidate.dedupeKey,
            ruleVersion: candidate.ruleVersion,
            modelProfile: candidate.modelProfile,
            cooldownUntil: candidate.cooldownUntil,
            notificationStatus: candidate.notificationPolicy === 'none' ? 'skipped' : 'skipped',
            notificationError: null,
            convertedProposalId: null,
        },
    });

    await createFindingEvent(prisma, {
        findingId: finding.id,
        eventType: 'created',
        actorUserId: candidate.ownerUserId,
        eventPayload: {
            level: candidate.level,
            findingKind: candidate.findingKind,
            notificationPolicy: candidate.notificationPolicy,
        },
    });

    return {
        status: 'created',
        finding: toGuardianFindingView(finding),
    };
}

export async function applyGuardianFindingAction(
    prisma: any,
    input: GuardianFindingActionInput,
): Promise<GuardianFindingView> {
    const existing = await loadFindingById(prisma, input.findingId);
    ensureNotGrowthLifecycleOwned(existing);
    ensureFindingOpen(existing);
    const reason = normalizeReason(input.reason);
    const eventPayload: Record<string, unknown> = {};
    let status: GuardianFindingStatus;
    const data: Record<string, unknown> = {};

    if (input.action === 'ack') {
        status = 'acknowledged';
    } else if (input.action === 'dismiss') {
        if (!reason) throw new Error('guardian_finding_dismiss_reason_required');
        status = 'dismissed';
        eventPayload.reason = reason;
    } else {
        const snoozeUntil = normalizeDate(input.snoozeUntil);
        if (!snoozeUntil) throw new Error('guardian_finding_snooze_until_required');
        status = 'snoozed';
        data.cooldownUntil = snoozeUntil;
        if (reason) eventPayload.reason = reason;
        eventPayload.snoozeUntil = snoozeUntil.toISOString();
    }

    const updated = await prisma.guardianFinding.update({
        where: { id: existing.id },
        data: {
            ...data,
            status,
        },
    });
    await createFindingEvent(prisma, {
        findingId: updated.id,
        eventType: input.action === 'ack'
            ? 'acknowledged'
            : input.action === 'dismiss'
                ? 'dismissed'
                : 'snoozed',
        actorUserId: input.actorUserId,
        eventPayload,
    });
    return toGuardianFindingView(updated);
}

export async function convertGuardianFindingToProposal(
    prisma: any,
    input: {
        findingId: string;
        actorUserId: number | null;
        now?: Date;
    },
) {
    const finding = await loadFindingById(prisma, input.findingId);
    ensureNotGrowthLifecycleOwned(finding);
    ensureFindingOpen(finding);
    if (finding.level !== 'propose' || finding.convertedProposalId) {
        throw guardianFindingError('guardian_finding_convert_requires_open_propose');
    }
    const proposedDiff = {
        findingId: finding.id,
        findingKind: finding.findingKind,
        level: finding.level,
        riskLevel: finding.riskLevel,
        severity: finding.severity,
        suggestedAction: sanitizeSuggestedAction(finding.suggestedAction),
        evidenceRefCount: Array.isArray(finding.evidenceRefs) ? finding.evidenceRefs.length : 0,
    };
    const proposal = await createAiProposalArtifact(prisma, {
        taskType: 'guardian.finding.watch.v1',
        subjectType: 'guardian_finding',
        subjectId: finding.id,
        createdByUserId: input.actorUserId,
        idempotencyKey: `guardian.finding.watch.v1:${finding.id}:convert`,
        sourceDigest: finding.sourceDigest,
        evidenceRefs: Array.isArray(finding.evidenceRefs) ? finding.evidenceRefs : [],
        contextCapsuleId: null,
        modelProfile: finding.modelProfile ?? null,
        promptVersion: finding.ruleVersion,
        outputSchemaVersion: 'v1',
        riskLevel: finding.riskLevel,
        proposedAction: 'guardian.finding.convert_to_proposal',
        proposedDiff,
        explanation: finding.explanation,
        validationErrors: [],
        reviewRequired: true,
        domainArtifactType: 'guardian_finding',
        domainArtifactId: finding.id,
        domainStatus: 'converted',
        applyTarget: {
            type: 'guardian_inbox_handoff',
            owner: 'services/query-api/src/services/aiOperatingLayer/guardian/proposals.ts',
        },
        expiresAt: null,
    });

    const updated = await prisma.guardianFinding.update({
        where: { id: finding.id },
        data: {
            status: 'converted',
            convertedProposalId: proposal.id,
        },
    });
    await createFindingEvent(prisma, {
        findingId: updated.id,
        eventType: 'converted_to_proposal',
        actorUserId: input.actorUserId,
        eventPayload: {
            proposalId: proposal.id,
        },
    });
    return proposal;
}

async function loadFindingById(prisma: any, findingId: string): Promise<any> {
    const finding = await prisma.guardianFinding.findUnique({
        where: { id: findingId },
    });
    if (!finding) throw new Error('guardian_finding_not_found');
    return finding;
}

function ensureFindingOpen(finding: any): void {
    if (finding?.status !== 'open') {
        throw guardianFindingError('guardian_finding_must_be_open');
    }
}

function ensureNotGrowthLifecycleOwned(finding: any): void {
    if (finding?.findingKind === 'circle_growth_opportunity') {
        throw guardianFindingError('guardian_finding_growth_lifecycle_owned');
    }
}

function guardianFindingError(message: string): Error {
    return new Error(message);
}

async function createFindingEvent(
    prisma: any,
    input: {
        findingId: string;
        eventType: string;
        actorUserId?: number | null;
        eventPayload?: Record<string, unknown>;
    },
): Promise<void> {
    if (typeof prisma?.guardianFindingEvent?.create !== 'function') return;
    await prisma.guardianFindingEvent.create({
        data: {
            findingId: input.findingId,
            eventType: input.eventType,
            actorUserId: input.actorUserId ?? null,
            eventPayload: input.eventPayload ?? {},
        },
    });
}

function toGuardianFindingView(row: any): GuardianFindingView {
    return {
        id: String(row.id),
        ownerUserId: normalizeNullableNumber(row.ownerUserId),
        circleId: Number(row.circleId),
        findingKind: String(row.findingKind),
        level: row.level,
        riskLevel: row.riskLevel,
        severity: row.severity,
        status: row.status,
        title: String(row.title),
        summary: String(row.summary),
        explanation: String(row.explanation ?? ''),
        evidenceRefs: Array.isArray(row.evidenceRefs) ? row.evidenceRefs : [],
        suggestedAction: sanitizeSuggestedAction(row.suggestedAction),
        sourceDigest: String(row.sourceDigest),
        dedupeKey: String(row.dedupeKey),
        ruleVersion: String(row.ruleVersion),
        modelProfile: typeof row.modelProfile === 'string' ? row.modelProfile : null,
        cooldownUntil: normalizeDate(row.cooldownUntil),
        notificationStatus: row.notificationStatus ?? 'skipped',
        notificationError: typeof row.notificationError === 'string' ? row.notificationError : null,
        convertedProposalId: typeof row.convertedProposalId === 'string' ? row.convertedProposalId : null,
        createdAt: normalizeDate(row.createdAt) ?? new Date(0),
        updatedAt: normalizeDate(row.updatedAt) ?? new Date(0),
    };
}

function isInCooldown(row: any, now: Date): boolean {
    const cooldownUntil = normalizeDate(row.cooldownUntil);
    if (!cooldownUntil) return false;
    return cooldownUntil.getTime() > now.getTime();
}

function sanitizeSuggestedAction(value: unknown): any {
    if (!value || typeof value !== 'object' || Array.isArray(value)) {
        return {
            kind: 'unknown',
            requiresConfirmation: true,
        };
    }
    return removeForbiddenFields(value as Record<string, unknown>);
}

function removeForbiddenFields(value: unknown): unknown {
    if (!value || typeof value !== 'object') return value;
    if (Array.isArray(value)) {
        return value
            .filter((item) => !isForbiddenEffect(item))
            .map((item) => removeForbiddenFields(item));
    }
    const output: Record<string, unknown> = {};
    for (const [key, nested] of Object.entries(value as Record<string, unknown>)) {
        if (['rawText', 'rawPrompt', 'providerRawResponse', 'sourceExcerpt', 'privateText'].includes(key)) {
            continue;
        }
        if (key === 'forbiddenDirectEffects') continue;
        output[key] = removeForbiddenFields(nested);
    }
    return output;
}

function isForbiddenEffect(value: unknown): boolean {
    return typeof value === 'string' && [
        'source_material_accept',
        'source_material_reject',
        'source_material_redact',
        'circle_settings_write',
        'external_notify',
    ].includes(value);
}

function normalizeReason(value: unknown): string | null {
    if (typeof value !== 'string') return null;
    const trimmed = value.trim();
    return trimmed ? trimmed.slice(0, 500) : null;
}

function normalizeNullableNumber(value: unknown): number | null {
    const parsed = Number(value);
    return Number.isFinite(parsed) && parsed > 0 ? parsed : null;
}

function normalizeDate(value: Date | string | null | undefined): Date | null {
    if (value instanceof Date) return value;
    if (typeof value === 'string' && value.trim()) {
        const parsed = new Date(value);
        return Number.isNaN(parsed.getTime()) ? null : parsed;
    }
    return null;
}

function serializeDate(value: unknown): string | null {
    const date = normalizeDate(value as Date | string | null | undefined);
    return date ? date.toISOString() : null;
}

function digest(value: string): string {
    return crypto.createHash('sha256').update(value).digest('hex');
}
