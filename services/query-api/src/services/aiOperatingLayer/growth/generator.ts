import {
    getPromptMetadata,
    getPromptSchema,
    getSystemPrompt,
} from '../../../ai/prompts/registry';
import { callAiCapability } from '../capabilities/adapter';
import { loadCircleGrowthAdvisorConfig } from './config';
import { attachGuardianFindingToCircleEvolutionProposal } from './proposals';
import { parseCircleGrowthAdvisorModelOutput } from './schema';
import {
    CIRCLE_GROWTH_SCHEMA_VERSION,
    CIRCLE_GROWTH_TASK_TYPE,
    type CircleGrowthSignalSnapshot,
} from './types';
import type { AiJobRecord } from '../../aiJobs/types';

export async function processCircleGrowthAdvisorJob(
    prisma: any,
    input: {
        job: AiJobRecord;
    },
): Promise<Record<string, unknown>> {
    const config = loadCircleGrowthAdvisorConfig();
    const proposalId = typeof input.job.payload?.proposalId === 'string'
        ? input.job.payload.proposalId.trim()
        : '';
    const signalId = typeof input.job.payload?.signalId === 'string'
        ? input.job.payload.signalId.trim()
        : '';
    if (!proposalId || !signalId) throw new Error('invalid_circle_growth_job_payload');

    const [proposal, signal] = await Promise.all([
        loadProposal(prisma, proposalId),
        loadSignal(prisma, signalId),
    ]);
    if (!isCurrentPendingProposalForJob(proposal, signal, input.job)) {
        await createProposalEvent(prisma, {
            proposalId,
            eventType: 'stale_job_skipped',
            actorUserId: input.job.requestedByUserId,
            eventPayload: {
                currentStatus: String(proposal.status || ''),
                proposalSignalId: String(proposal.signalId || ''),
                jobSignalId: signalId,
                jobContextCapsuleId: input.job.contextCapsuleId ?? null,
                signalContextCapsuleId: signal.contextCapsuleId ?? null,
            },
        });
        return {
            proposalId,
            signalId,
            status: 'stale',
            currentStatus: String(proposal.status || ''),
        };
    }

    if (!config.enabled) {
        await markProposalFailed(prisma, proposalId, 'circle_growth_advisor_disabled');
        await createProposalEvent(prisma, {
            proposalId,
            eventType: 'disabled',
            actorUserId: input.job.requestedByUserId,
            eventPayload: {
                failureCode: 'circle_growth_advisor_disabled',
            },
        });
        return {
            proposalId,
            signalId,
            taskType: CIRCLE_GROWTH_TASK_TYPE,
            taskCatalogVersion: input.job.taskCatalogVersion ?? 'v1',
            status: 'disabled',
            failureCode: 'circle_growth_advisor_disabled',
        };
    }

    const context = await loadContextCapsule(prisma, input.job.contextCapsuleId);
    if (!context) {
        await markProposalFailed(prisma, proposalId, 'circle_growth_context_not_found');
        throw new Error('circle_growth_context_not_found');
    }

    if (signal.status === 'no_signal') {
        await prisma.circleEvolutionProposal.update({
            where: { id: proposal.id },
            data: {
                status: 'no_signal',
                failureCode: 'growth_missing_signal',
                missingSignals: signal.missingSignals,
                currentSignals: [],
                counterSignals: signal.counterSignals,
                evidenceRefs: signal.evidenceRefs,
                sourceDigest: signal.sourceDigest,
                metricsSnapshot: signal.metrics,
                cognitiveMapProjection: signal.cognitiveMapProjection,
            },
        });
        await createProposalEvent(prisma, {
            proposalId,
            eventType: 'no_signal',
            actorUserId: input.job.requestedByUserId,
            eventPayload: {
                missingSignals: signal.missingSignals,
            },
        });
        return {
            proposalId,
            signalId,
            status: 'no_signal',
            failureCode: 'growth_missing_signal',
        };
    }

    const promptMetadata = getPromptMetadata('circle-growth-advisor');
    let modelProfile: string | null = null;
    try {
        const capability = await callAiCapability({
            taskType: CIRCLE_GROWTH_TASK_TYPE,
            capability: 'text.structure',
            privacyProfile: 'public_protocol',
            runtimeRole: 'PUBLIC_NODE',
            input: {
                systemPrompt: getSystemPrompt('circle-growth-advisor'),
                prompt: buildUserPrompt(signal),
                responseFormat: {
                    type: 'json',
                    name: 'circle_growth_advisor',
                    schema: getPromptSchema('circle-growth-advisor') ?? undefined,
                },
                temperature: 0.1,
                maxOutputTokens: 1000,
            },
        });
        modelProfile = capability.model;
        const parsed = parseCircleGrowthAdvisorModelOutput({
            rawText: String(capability.output.text || ''),
            signal,
            maxChanges: config.maxConfigChanges,
        });
        const updatedProposal = await prisma.circleEvolutionProposal.update({
            where: { id: proposal.id },
            data: {
                status: 'ready',
                recommendedStage: parsed.recommendedStage,
                explanation: parsed.explanation,
                configDiff: parsed.configDiff,
                currentSignals: signal.currentSignals,
                counterSignals: signal.counterSignals,
                missingSignals: signal.missingSignals,
                metricsSnapshot: signal.metrics,
                cognitiveMapProjection: signal.cognitiveMapProjection,
                evidenceRefs: signal.evidenceRefs.filter((ref) =>
                    parsed.evidenceRefIds.length === 0
                    || parsed.evidenceRefIds.includes(`${ref.sourceType}:${ref.sourceId}`),
                ),
                sourceDigest: signal.sourceDigest,
                failureCode: null,
                failureMessage: null,
                modelProfile,
                promptVersion: promptMetadata.promptVersion,
                outputSchemaVersion: CIRCLE_GROWTH_SCHEMA_VERSION,
            },
        });
        await attachGuardianFindingToCircleEvolutionProposal(prisma, {
            proposal: updatedProposal,
            signal,
            recommendedStage: parsed.recommendedStage,
            explanation: parsed.explanation,
            configDiff: parsed.configDiff,
            modelProfile,
        });
        await createProposalEvent(prisma, {
            proposalId,
            eventType: 'generated',
            actorUserId: input.job.requestedByUserId,
            eventPayload: {
                recommendedStage: parsed.recommendedStage,
                riskLevel: maxRisk(parsed.configDiff),
            },
        });
        return {
            proposalId,
            signalId,
            status: 'ready',
            recommendedStage: parsed.recommendedStage,
            affectedFields: parsed.configDiff.map((change) => change.field),
            failureCode: null,
        };
    } catch (error) {
        const failureCode = error instanceof Error && error.message === 'invalid_model_output'
            ? 'invalid_model_output'
            : 'provider_failed';
        await prisma.circleEvolutionProposal.update({
            where: { id: proposal.id },
            data: {
                status: 'failed',
                failureCode,
                failureMessage: failureCode,
                configDiff: [],
                currentSignals: signal.currentSignals,
                counterSignals: signal.counterSignals,
                missingSignals: signal.missingSignals,
                metricsSnapshot: signal.metrics,
                cognitiveMapProjection: signal.cognitiveMapProjection,
                evidenceRefs: signal.evidenceRefs,
                sourceDigest: signal.sourceDigest,
                modelProfile,
                promptVersion: promptMetadata.promptVersion,
                outputSchemaVersion: CIRCLE_GROWTH_SCHEMA_VERSION,
            },
        });
        await createProposalEvent(prisma, {
            proposalId,
            eventType: 'failed',
            actorUserId: input.job.requestedByUserId,
            eventPayload: { failureCode },
        });
        return {
            proposalId,
            signalId,
            status: 'failed',
            failureCode,
        };
    }
}

async function loadProposal(prisma: any, proposalId: string): Promise<any> {
    const proposal = await prisma.circleEvolutionProposal.findUnique({
        where: { id: proposalId },
    });
    if (!proposal) throw new Error('circle_growth_proposal_not_found');
    return proposal;
}

async function loadSignal(prisma: any, signalId: string): Promise<CircleGrowthSignalSnapshot> {
    const row = await prisma.circleGrowthSignal.findUnique({
        where: { id: signalId },
    });
    if (!row) throw new Error('circle_growth_signal_not_found');
    return {
        id: String(row.id),
        circleId: Number(row.circleId),
        requestedByUserId: normalizeNullableNumber(row.requestedByUserId),
        triggerSource: row.triggerSource === 'watcher' ? 'watcher' : 'manual',
        status: row.status === 'no_signal' ? 'no_signal' : 'ready',
        currentSignals: Array.isArray(row.currentSignals) ? row.currentSignals : [],
        counterSignals: Array.isArray(row.counterSignals) ? row.counterSignals : [],
        missingSignals: Array.isArray(row.missingSignals) ? row.missingSignals : [],
        metrics: isRecord(row.metrics) ? row.metrics : {},
        cognitiveMapProjection: isRecord(row.cognitiveMapProjection) ? row.cognitiveMapProjection : {},
        evidenceRefs: Array.isArray(row.evidenceRefs) ? row.evidenceRefs : [],
        sourceDigest: String(row.sourceDigest || ''),
        lookbackStartedAt: normalizeDate(row.lookbackStartedAt) ?? new Date(0),
        lookbackEndedAt: normalizeDate(row.lookbackEndedAt) ?? new Date(0),
        contextCapsuleId: typeof row.contextCapsuleId === 'string' ? row.contextCapsuleId : null,
        createdAt: normalizeDate(row.createdAt) ?? new Date(0),
    };
}

async function loadContextCapsule(prisma: any, contextCapsuleId: string | null | undefined): Promise<any | null> {
    if (!contextCapsuleId || typeof prisma?.aiContextCapsule?.findUnique !== 'function') return null;
    return prisma.aiContextCapsule.findUnique({
        where: { id: contextCapsuleId },
    });
}

async function markProposalFailed(prisma: any, proposalId: string, failureCode: string): Promise<void> {
    if (typeof prisma?.circleEvolutionProposal?.update !== 'function') return;
    await prisma.circleEvolutionProposal.update({
        where: { id: proposalId },
        data: {
            status: 'failed',
            failureCode,
            failureMessage: failureCode,
        },
    });
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

function buildUserPrompt(signal: CircleGrowthSignalSnapshot): string {
    return JSON.stringify({
        circleId: signal.circleId,
        currentSignals: signal.currentSignals,
        counterSignals: signal.counterSignals,
        missingSignals: signal.missingSignals,
        metrics: signal.metrics,
        cognitiveMapProjection: signal.cognitiveMapProjection,
        evidenceRefIds: signal.evidenceRefs.map((ref) => `${ref.sourceType}:${ref.sourceId}`),
        constraints: {
            proposalOnly: true,
            forbidDirectApply: true,
            allowedConfigEntrypoint: 'circle_settings',
        },
    });
}

function isCurrentPendingProposalForJob(proposal: any, signal: CircleGrowthSignalSnapshot, job: AiJobRecord): boolean {
    if (String(proposal.status) !== 'pending') return false;
    if (String(proposal.signalId || '') !== signal.id) return false;
    if (signal.contextCapsuleId && job.contextCapsuleId && signal.contextCapsuleId !== job.contextCapsuleId) {
        return false;
    }
    return true;
}

function maxRisk(changes: unknown[]): 'low' | 'medium' | 'high' {
    if (changes.some((change: any) => change?.riskLevel === 'high')) return 'high';
    if (changes.some((change: any) => change?.riskLevel === 'medium')) return 'medium';
    return 'low';
}

function normalizeNullableNumber(value: unknown): number | null {
    const parsed = Number(value);
    return Number.isFinite(parsed) && parsed > 0 ? parsed : null;
}

function normalizeDate(value: unknown): Date | null {
    if (value instanceof Date && !Number.isNaN(value.getTime())) return value;
    if (typeof value === 'string' || typeof value === 'number') {
        const date = new Date(value);
        return Number.isNaN(date.getTime()) ? null : date;
    }
    return null;
}

function isRecord(value: unknown): value is Record<string, unknown> {
    return Boolean(value && typeof value === 'object' && !Array.isArray(value));
}
