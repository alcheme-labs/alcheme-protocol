import crypto from 'crypto';

import { createProposalForConfigurationCopilot } from '../proposals';
import { persistGuardianFindingCandidate } from '../guardian/findings';
import { loadCircleGrowthAdvisorConfig } from './config';
import type {
    CircleEvolutionConfigChange,
    CircleEvolutionProposalView,
    CircleGrowthSignalSnapshot,
} from './types';

interface CreateOrReuseInput {
    signal: CircleGrowthSignalSnapshot;
    recommendedStage: string;
    explanation: string;
    configDiff: CircleEvolutionConfigChange[];
    modelProfile?: string | null;
    promptVersion?: string | null;
    now?: Date;
}

interface LifecycleInput {
    proposalId: string;
    actorUserId: number | null;
}

interface AttachGuardianFindingInput {
    proposal: any;
    signal: CircleGrowthSignalSnapshot;
    recommendedStage: string;
    explanation: string;
    configDiff: CircleEvolutionConfigChange[];
    modelProfile?: string | null;
    now?: Date;
}

export async function createOrReuseCircleEvolutionProposal(
    prisma: any,
    input: CreateOrReuseInput,
): Promise<{
    status: 'created' | 'deduped';
    proposal: CircleEvolutionProposalView;
}> {
    const now = input.now ?? new Date();
    const config = loadCircleGrowthAdvisorConfig();
    const dedupeKey = buildProposalDedupeKey({
        circleId: input.signal.circleId,
        recommendedStage: input.recommendedStage,
        sourceDigest: input.signal.sourceDigest,
        configDiff: input.configDiff,
    });
    const existing = await findProposalByDedupeKey(prisma, dedupeKey);
    if (existing && isInCooldown(existing, now)) {
        await createProposalEvent(prisma, {
            proposalId: existing.id,
            eventType: 'deduped',
            actorUserId: input.signal.requestedByUserId,
            eventPayload: {
                dedupeKey,
                cooldownUntil: serializeDate(existing.cooldownUntil),
            },
        });
        return {
            status: 'deduped',
            proposal: toProposalView(existing),
        };
    }

    const cooldownUntil = new Date(now.getTime() + config.cooldownDays * 24 * 3_600_000);
    const id = `growth_prop_${digest(`${dedupeKey}:${now.toISOString()}`).slice(0, 24)}`;
    const status = input.signal.status === 'no_signal' ? 'no_signal' : 'ready';

    const proposal = await prisma.circleEvolutionProposal.create({
        data: {
            id,
            circleId: input.signal.circleId,
            signalId: input.signal.id,
            status,
            recommendedStage: status === 'ready' ? normalizeText(input.recommendedStage, 64) : null,
            explanation: normalizeText(input.explanation, 2000),
            configDiff: input.configDiff,
            currentSignals: input.signal.currentSignals,
            counterSignals: input.signal.counterSignals,
            missingSignals: input.signal.missingSignals,
            metricsSnapshot: input.signal.metrics,
            cognitiveMapProjection: input.signal.cognitiveMapProjection,
            evidenceRefs: input.signal.evidenceRefs,
            sourceDigest: input.signal.sourceDigest,
            dedupeKey,
            failureCode: status === 'no_signal' ? 'growth_missing_signal' : null,
            failureMessage: null,
            rejectReason: null,
            cooldownUntil,
            guardianFindingId: null,
            configurationProposalId: null,
            aiJobId: null,
            modelProfile: input.modelProfile ?? null,
            promptVersion: input.promptVersion ?? null,
            outputSchemaVersion: 'v1',
            createdByUserId: input.signal.requestedByUserId,
            convertedByUserId: null,
            rejectedByUserId: null,
            snoozedByUserId: null,
        },
    });

    await createProposalEvent(prisma, {
        proposalId: proposal.id,
        eventType: 'created',
        actorUserId: input.signal.requestedByUserId,
        eventPayload: {
            status,
            triggerSource: input.signal.triggerSource,
        },
    });

    let output = proposal;
    if (status === 'ready') {
        output = await attachGuardianFindingToCircleEvolutionProposal(prisma, {
            proposal,
            signal: input.signal,
            recommendedStage: input.recommendedStage,
            explanation: input.explanation,
            configDiff: input.configDiff,
            modelProfile: input.modelProfile ?? null,
            now,
        });
    }

    return {
        status: 'created',
        proposal: toProposalView(output),
    };
}

export async function attachGuardianFindingToCircleEvolutionProposal(
    prisma: any,
    input: AttachGuardianFindingInput,
): Promise<any> {
    const now = input.now ?? new Date();
    const config = loadCircleGrowthAdvisorConfig();
    const cooldownUntil = normalizeDate(input.proposal.cooldownUntil)
        ?? new Date(now.getTime() + config.cooldownDays * 24 * 3_600_000);
    const dedupeKey = typeof input.proposal.dedupeKey === 'string' && input.proposal.dedupeKey.trim()
        ? input.proposal.dedupeKey
        : buildProposalDedupeKey({
            circleId: input.signal.circleId,
            recommendedStage: input.recommendedStage,
            sourceDigest: input.signal.sourceDigest,
            configDiff: input.configDiff,
        });
    const guardian = await persistGuardianFindingCandidate(prisma, {
        ownerUserId: input.signal.requestedByUserId,
        circleId: input.signal.circleId,
        findingKind: 'circle_growth_opportunity',
        level: 'propose',
        riskLevel: maxRisk(input.configDiff),
        severity: input.signal.counterSignals.some((signal) => signal.severity === 'critical')
            ? 'high'
            : 'medium',
        title: 'Circle growth opportunity',
        summary: input.explanation || 'Growth Advisor found a circle evolution opportunity.',
        explanation: input.explanation || '',
        evidenceRefs: input.signal.evidenceRefs,
        suggestedAction: {
            kind: 'review_circle_growth_proposal',
            labelKey: 'guardian.circleGrowth.review',
            target: {
                type: 'circle_growth_proposal',
                proposalId: input.proposal.id,
                circleId: input.signal.circleId,
                recommendedStage: input.recommendedStage,
                currentSignals: input.signal.currentSignals,
                counterSignals: input.signal.counterSignals,
            },
            requiresConfirmation: true,
            forbiddenDirectEffects: [
                'circle_settings_write',
                'circle_create_child',
                'governance_template_write',
                'permission_change',
                'mode_switch',
                'external_notify',
            ],
        },
        sourceDigest: input.signal.sourceDigest,
        dedupeKey: `guardian:growth:${dedupeKey}`,
        ruleVersion: 'circle-growth-advisor-v1',
        modelProfile: input.modelProfile ?? null,
        cooldownUntil,
        notificationPolicy: 'none',
    }, { now });
    return prisma.circleEvolutionProposal.update({
        where: { id: input.proposal.id },
        data: { guardianFindingId: guardian.finding.id },
    });
}

export async function createPendingCircleEvolutionProposal(
    prisma: any,
    input: {
        signal: CircleGrowthSignalSnapshot;
        now?: Date;
    },
): Promise<{
    status: 'created' | 'deduped';
    proposal: CircleEvolutionProposalView;
}> {
    const now = input.now ?? new Date();
    const config = loadCircleGrowthAdvisorConfig();
    const dedupeKey = buildProposalDedupeKey({
        circleId: input.signal.circleId,
        recommendedStage: 'pending',
        sourceDigest: input.signal.sourceDigest,
        configDiff: [],
    });
    const existing = await findProposalByDedupeKey(prisma, dedupeKey);
    if (existing && isInCooldown(existing, now)) {
        await createProposalEvent(prisma, {
            proposalId: existing.id,
            eventType: 'deduped',
            actorUserId: input.signal.requestedByUserId,
            eventPayload: {
                dedupeKey,
                cooldownUntil: serializeDate(existing.cooldownUntil),
            },
        });
        return {
            status: 'deduped',
            proposal: toProposalView(existing),
        };
    }

    const row = await prisma.circleEvolutionProposal.create({
        data: {
            id: `growth_prop_${digest(`${dedupeKey}:${now.toISOString()}`).slice(0, 24)}`,
            circleId: input.signal.circleId,
            signalId: input.signal.id,
            status: 'pending',
            recommendedStage: null,
            explanation: '',
            configDiff: [],
            currentSignals: input.signal.currentSignals,
            counterSignals: input.signal.counterSignals,
            missingSignals: input.signal.missingSignals,
            metricsSnapshot: input.signal.metrics,
            cognitiveMapProjection: input.signal.cognitiveMapProjection,
            evidenceRefs: input.signal.evidenceRefs,
            sourceDigest: input.signal.sourceDigest,
            dedupeKey,
            failureCode: null,
            failureMessage: null,
            rejectReason: null,
            cooldownUntil: new Date(now.getTime() + config.cooldownDays * 24 * 3_600_000),
            guardianFindingId: null,
            configurationProposalId: null,
            aiJobId: null,
            modelProfile: null,
            promptVersion: null,
            outputSchemaVersion: 'v1',
            createdByUserId: input.signal.requestedByUserId,
            convertedByUserId: null,
            rejectedByUserId: null,
            snoozedByUserId: null,
        },
    });
    await createProposalEvent(prisma, {
        proposalId: row.id,
        eventType: 'queued',
        actorUserId: input.signal.requestedByUserId,
        eventPayload: {
            triggerSource: input.signal.triggerSource,
        },
    });
    return {
        status: 'created',
        proposal: toProposalView(row),
    };
}

export async function rejectCircleEvolutionProposal(
    prisma: any,
    input: LifecycleInput & { reason: string },
): Promise<CircleEvolutionProposalView> {
    const reason = normalizeText(input.reason, 500);
    if (!reason) throw new Error('growth_reject_reason_required');
    return runGrowthLifecycleTransaction(prisma, async (tx) => {
        const proposal = await loadProposal(tx, input.proposalId);
        const updated = await tx.circleEvolutionProposal.update({
            where: { id: proposal.id },
            data: {
                status: 'rejected',
                rejectReason: reason,
                rejectedByUserId: input.actorUserId,
            },
        });
        await createProposalEvent(tx, {
            proposalId: proposal.id,
            eventType: 'rejected',
            actorUserId: input.actorUserId,
            eventPayload: { reason },
        });
        await mirrorGuardianStatus(tx, proposal, {
            status: 'dismissed',
            eventType: 'dismissed',
            actorUserId: input.actorUserId,
            eventPayload: { reason, source: 'circle_growth_advisor' },
        });
        return toProposalView(updated);
    });
}

export async function snoozeCircleEvolutionProposal(
    prisma: any,
    input: LifecycleInput & {
        snoozeUntil: Date | string;
        reason?: string | null;
    },
): Promise<CircleEvolutionProposalView> {
    const snoozeUntil = normalizeDate(input.snoozeUntil);
    if (!snoozeUntil) throw new Error('growth_snooze_until_required');
    const reason = normalizeText(input.reason, 500);
    return runGrowthLifecycleTransaction(prisma, async (tx) => {
        const proposal = await loadProposal(tx, input.proposalId);
        const updated = await tx.circleEvolutionProposal.update({
            where: { id: proposal.id },
            data: {
                status: 'snoozed',
                cooldownUntil: snoozeUntil,
                snoozedByUserId: input.actorUserId,
            },
        });
        await createProposalEvent(tx, {
            proposalId: proposal.id,
            eventType: 'snoozed',
            actorUserId: input.actorUserId,
            eventPayload: {
                reason: reason || null,
                snoozeUntil: snoozeUntil.toISOString(),
            },
        });
        await mirrorGuardianStatus(tx, proposal, {
            status: 'snoozed',
            eventType: 'snoozed',
            actorUserId: input.actorUserId,
            eventPayload: {
                reason: reason || null,
                snoozeUntil: snoozeUntil.toISOString(),
                source: 'circle_growth_advisor',
            },
            data: { cooldownUntil: snoozeUntil },
        });
        return toProposalView(updated);
    });
}

export async function convertCircleEvolutionProposal(
    prisma: any,
    input: LifecycleInput,
): Promise<CircleEvolutionProposalView> {
    return runGrowthLifecycleTransaction(prisma, async (tx) => {
        const proposal = await loadProposal(tx, input.proposalId);
        if (!['ready', 'snoozed'].includes(String(proposal.status))) {
            throw new Error('growth_not_convertible');
        }
        const configurationProposal = await createProposalForConfigurationCopilot(tx, {
            subjectType: 'circle',
            subjectId: String(proposal.circleId),
            createdByUserId: input.actorUserId,
            contextCapsuleId: null,
            sourceDigest: proposal.sourceDigest,
            evidenceRefs: Array.isArray(proposal.evidenceRefs) ? proposal.evidenceRefs : [],
            entrypoint: 'circle_settings',
            proposal: {
                reason: proposal.explanation || 'Circle Growth Advisor conversion.',
                riskLevel: maxRisk(Array.isArray(proposal.configDiff) ? proposal.configDiff : []),
                affectedFields: (Array.isArray(proposal.configDiff) ? proposal.configDiff : [])
                    .map((change: any) => String(change.field || '').trim())
                    .filter(Boolean),
                configDiff: Array.isArray(proposal.configDiff) ? proposal.configDiff : [],
                validationErrors: [],
            },
            modelProfile: proposal.modelProfile ?? null,
            promptVersion: proposal.promptVersion ?? 'v1',
            expiresAt: proposal.cooldownUntil ?? null,
        });
        const configurationProposalId = typeof configurationProposal?.id === 'string'
            ? configurationProposal.id
            : null;
        const updated = await tx.circleEvolutionProposal.update({
            where: { id: proposal.id },
            data: {
                status: 'converted',
                configurationProposalId,
                convertedByUserId: input.actorUserId,
            },
        });
        await createProposalEvent(tx, {
            proposalId: proposal.id,
            eventType: 'converted',
            actorUserId: input.actorUserId,
            eventPayload: { configurationProposalId },
        });
        await mirrorGuardianStatus(tx, proposal, {
            status: 'converted',
            eventType: 'converted_to_proposal',
            actorUserId: input.actorUserId,
            eventPayload: {
                configurationProposalId,
                source: 'circle_growth_advisor',
            },
            data: { convertedProposalId: configurationProposalId },
        });
        return toProposalView(updated);
    });
}

export function toProposalView(row: any): CircleEvolutionProposalView {
    return {
        id: String(row.id),
        circleId: Number(row.circleId),
        signalId: typeof row.signalId === 'string' ? row.signalId : null,
        status: row.status,
        recommendedStage: typeof row.recommendedStage === 'string' ? row.recommendedStage : null,
        explanation: String(row.explanation ?? ''),
        configDiff: Array.isArray(row.configDiff) ? row.configDiff : [],
        currentSignals: Array.isArray(row.currentSignals) ? row.currentSignals : [],
        counterSignals: Array.isArray(row.counterSignals) ? row.counterSignals : [],
        missingSignals: Array.isArray(row.missingSignals) ? row.missingSignals : [],
        metricsSnapshot: isRecord(row.metricsSnapshot) ? row.metricsSnapshot : {},
        cognitiveMapProjection: isRecord(row.cognitiveMapProjection) ? row.cognitiveMapProjection : {},
        evidenceRefs: Array.isArray(row.evidenceRefs) ? row.evidenceRefs : [],
        sourceDigest: String(row.sourceDigest ?? ''),
        dedupeKey: String(row.dedupeKey ?? ''),
        failureCode: typeof row.failureCode === 'string' ? row.failureCode : null,
        failureMessage: typeof row.failureMessage === 'string' ? row.failureMessage : null,
        rejectReason: typeof row.rejectReason === 'string' ? row.rejectReason : null,
        cooldownUntil: normalizeDate(row.cooldownUntil),
        guardianFindingId: typeof row.guardianFindingId === 'string' ? row.guardianFindingId : null,
        configurationProposalId: typeof row.configurationProposalId === 'string' ? row.configurationProposalId : null,
        aiJobId: Number.isFinite(Number(row.aiJobId)) ? Number(row.aiJobId) : null,
        modelProfile: typeof row.modelProfile === 'string' ? row.modelProfile : null,
        promptVersion: typeof row.promptVersion === 'string' ? row.promptVersion : null,
        outputSchemaVersion: String(row.outputSchemaVersion || 'v1'),
        createdByUserId: Number.isFinite(Number(row.createdByUserId)) ? Number(row.createdByUserId) : null,
        convertedByUserId: Number.isFinite(Number(row.convertedByUserId)) ? Number(row.convertedByUserId) : null,
        rejectedByUserId: Number.isFinite(Number(row.rejectedByUserId)) ? Number(row.rejectedByUserId) : null,
        snoozedByUserId: Number.isFinite(Number(row.snoozedByUserId)) ? Number(row.snoozedByUserId) : null,
        createdAt: normalizeDate(row.createdAt) ?? new Date(0),
        updatedAt: normalizeDate(row.updatedAt) ?? new Date(0),
    };
}

async function loadProposal(prisma: any, proposalId: string): Promise<any> {
    const proposal = await prisma.circleEvolutionProposal.findUnique({
        where: { id: proposalId },
    });
    if (!proposal) throw new Error('growth_proposal_not_found');
    return proposal;
}

async function findProposalByDedupeKey(prisma: any, dedupeKey: string): Promise<any | null> {
    if (typeof prisma?.circleEvolutionProposal?.findUnique !== 'function') return null;
    return prisma.circleEvolutionProposal.findUnique({ where: { dedupeKey } });
}

async function createProposalEvent(
    prisma: any,
    input: {
        proposalId: string;
        eventType: string;
        actorUserId?: number | null;
        eventPayload?: Record<string, unknown>;
    },
): Promise<void> {
    if (typeof prisma?.circleEvolutionProposalEvent?.create !== 'function') return;
    await prisma.circleEvolutionProposalEvent.create({
        data: {
            proposalId: input.proposalId,
            eventType: input.eventType,
            actorUserId: input.actorUserId ?? null,
            eventPayload: input.eventPayload ?? {},
        },
    });
}

async function mirrorGuardianStatus(
    prisma: any,
    proposal: any,
    input: {
        status: string;
        eventType: string;
        actorUserId?: number | null;
        eventPayload?: Record<string, unknown>;
        data?: Record<string, unknown>;
    },
): Promise<void> {
    const guardianFindingId = typeof proposal.guardianFindingId === 'string'
        ? proposal.guardianFindingId
        : null;
    if (!guardianFindingId || typeof prisma?.guardianFinding?.update !== 'function') return;
    await prisma.guardianFinding.update({
        where: { id: guardianFindingId },
        data: {
            ...(input.data ?? {}),
            status: input.status,
        },
    });
    if (typeof prisma?.guardianFindingEvent?.create === 'function') {
        await prisma.guardianFindingEvent.create({
            data: {
                findingId: guardianFindingId,
                eventType: input.eventType,
                actorUserId: input.actorUserId ?? null,
                eventPayload: input.eventPayload ?? {},
            },
        });
    }
}

async function runGrowthLifecycleTransaction<T>(
    prisma: any,
    callback: (tx: any) => Promise<T>,
): Promise<T> {
    if (typeof prisma?.$transaction === 'function') {
        return prisma.$transaction(async (tx: any) => callback(tx));
    }
    return callback(prisma);
}

function buildProposalDedupeKey(input: {
    circleId: number;
    recommendedStage: string;
    sourceDigest: string;
    configDiff: unknown;
}): string {
    return [
        'circle_growth',
        input.circleId,
        normalizeText(input.recommendedStage, 64) || 'no_stage',
        input.sourceDigest,
        digest(JSON.stringify(input.configDiff ?? [])),
    ].join(':');
}

function isInCooldown(row: any, now: Date): boolean {
    const cooldownUntil = normalizeDate(row.cooldownUntil);
    return Boolean(cooldownUntil && cooldownUntil.getTime() > now.getTime());
}

function maxRisk(changes: unknown): 'low' | 'medium' | 'high' {
    const items = Array.isArray(changes) ? changes : [];
    if (items.some((change: any) => change?.riskLevel === 'high')) return 'high';
    if (items.some((change: any) => change?.riskLevel === 'medium')) return 'medium';
    return 'low';
}

function normalizeText(value: unknown, max: number): string {
    return String(value || '').trim().slice(0, max);
}

function normalizeDate(value: unknown): Date | null {
    if (value instanceof Date && !Number.isNaN(value.getTime())) return value;
    if (typeof value === 'string' || typeof value === 'number') {
        const date = new Date(value);
        return Number.isNaN(date.getTime()) ? null : date;
    }
    return null;
}

function serializeDate(value: unknown): string | null {
    return normalizeDate(value)?.toISOString() ?? null;
}

function digest(value: string): string {
    return crypto.createHash('sha256').update(value).digest('hex');
}

function isRecord(value: unknown): value is Record<string, unknown> {
    return Boolean(value && typeof value === 'object' && !Array.isArray(value));
}
