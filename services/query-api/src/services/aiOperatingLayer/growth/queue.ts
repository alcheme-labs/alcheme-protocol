import crypto from 'crypto';

import { enqueueAiJob } from '../../aiJobs/runtime';
import {
    createOrReuseCircleEvolutionProposal,
    createPendingCircleEvolutionProposal,
} from './proposals';
import type {
    CircleEvolutionProposalView,
    CircleGrowthSignalSnapshot,
} from './types';

export type QueueCircleGrowthAdvisorResult =
    | {
        ok: true;
        status: 'no_signal';
        signalId: string;
        proposal: CircleEvolutionProposalView;
    }
    | {
        ok: true;
        status: 'queued';
        signalId: string;
        proposalId: string;
        jobId: number;
        contextCapsuleId: string;
    }
    | {
        ok: true;
        status: 'deduped';
        signalId: string;
        proposalId: string;
        proposal: CircleEvolutionProposalView;
    };

export async function queueCircleGrowthAdvisorProposal(
    prisma: any,
    input: {
        signal: CircleGrowthSignalSnapshot;
        actorUserId: number | null;
        now?: Date;
    },
): Promise<QueueCircleGrowthAdvisorResult> {
    const now = input.now ?? new Date();
    await persistCircleGrowthSignal(prisma, input.signal);

    if (input.signal.status === 'no_signal') {
        const created = await createOrReuseCircleEvolutionProposal(prisma, {
            signal: input.signal,
            recommendedStage: 'no_signal',
            explanation: 'Circle Growth Advisor could not produce a recommendation because mandatory signals are missing.',
            configDiff: [],
            now,
        });
        return {
            ok: true,
            status: 'no_signal',
            signalId: input.signal.id,
            proposal: created.proposal,
        };
    }

    const pending = await createPendingCircleEvolutionProposal(prisma, {
        signal: input.signal,
        now,
    });
    if (pending.status === 'deduped') {
        return {
            ok: true,
            status: 'deduped',
            signalId: input.signal.id,
            proposalId: pending.proposal.id,
            proposal: pending.proposal,
        };
    }

    const contextCapsuleId = await persistCircleGrowthContextCapsule(prisma, {
        signal: input.signal,
        actorUserId: input.actorUserId,
        proposalId: pending.proposal.id,
        now,
    });
    await prisma.circleGrowthSignal.update({
        where: { id: input.signal.id },
        data: { contextCapsuleId },
    });
    const job = await enqueueAiJob(prisma, {
        jobType: 'circle_growth_advisor_generate',
        taskType: 'circle.growth_advisor.v1',
        taskCatalogVersion: 'v1',
        contextCapsuleId,
        dedupeKey: `circle-growth-advisor:${pending.proposal.id}`,
        scopeType: 'circle',
        scopeCircleId: input.signal.circleId,
        requestedByUserId: input.actorUserId,
        payload: {
            proposalId: pending.proposal.id,
            signalId: input.signal.id,
        },
    });
    await prisma.circleEvolutionProposal.update({
        where: { id: pending.proposal.id },
        data: { aiJobId: job.id },
    });

    return {
        ok: true,
        status: 'queued',
        signalId: input.signal.id,
        proposalId: pending.proposal.id,
        jobId: job.id,
        contextCapsuleId,
    };
}

async function persistCircleGrowthSignal(
    prisma: any,
    signal: CircleGrowthSignalSnapshot,
): Promise<void> {
    await prisma.circleGrowthSignal.create({
        data: {
            id: signal.id,
            circleId: signal.circleId,
            requestedByUserId: signal.requestedByUserId,
            triggerSource: signal.triggerSource,
            status: signal.status,
            currentSignals: signal.currentSignals,
            counterSignals: signal.counterSignals,
            missingSignals: signal.missingSignals,
            metrics: signal.metrics,
            cognitiveMapProjection: signal.cognitiveMapProjection,
            evidenceRefs: signal.evidenceRefs,
            sourceDigest: signal.sourceDigest,
            lookbackStartedAt: signal.lookbackStartedAt,
            lookbackEndedAt: signal.lookbackEndedAt,
            contextCapsuleId: null,
        },
    });
}

async function persistCircleGrowthContextCapsule(
    prisma: any,
    input: {
        signal: CircleGrowthSignalSnapshot;
        actorUserId: number | null;
        proposalId: string;
        now: Date;
    },
): Promise<string> {
    const contextCapsuleId = buildContextCapsuleId(input.proposalId, input.signal.id);
    const contextPayload = {
        kind: 'circle_growth_advisor.v1',
        circleId: input.signal.circleId,
        proposalId: input.proposalId,
        signalId: input.signal.id,
        signalStatus: input.signal.status,
    };
    await prisma.aiContextCapsule.upsert({
        where: { id: contextCapsuleId },
        create: {
            id: contextCapsuleId,
            taskType: 'circle.growth_advisor.v1',
            subjectType: 'circle',
            subjectId: String(input.signal.circleId),
            actorUserId: input.actorUserId,
            visibility: 'member_visible',
            runtimeRole: 'PUBLIC_NODE',
            sourceDigest: input.signal.sourceDigest,
            contextDigest: digestJson(contextPayload),
            sourceRefs: input.signal.evidenceRefs,
            contextPayload,
            excerptPolicy: {
                mode: 'metadata_only',
                redaction: 'circle_growth_advisor_v1',
            },
            redactionReport: [],
            tokenBudget: {
                maxInputTokens: 1500,
                maxOutputTokens: 1000,
                maxEvidenceRefs: 20,
            },
            privatePlaintextMode: 'member_visible',
            cacheKey: `circle_growth:${input.signal.circleId}:${input.signal.sourceDigest}`,
            expiresAt: new Date(input.now.getTime() + 30 * 60_000),
        },
        update: {
            sourceDigest: input.signal.sourceDigest,
            contextDigest: digestJson(contextPayload),
            sourceRefs: input.signal.evidenceRefs,
            contextPayload,
            expiresAt: new Date(input.now.getTime() + 30 * 60_000),
        },
    });
    return contextCapsuleId;
}

function buildContextCapsuleId(proposalId: string, signalId: string): string {
    return `ctx_growth_${digestJson(`${proposalId}:${signalId}`).slice(0, 24)}`;
}

function digestJson(value: unknown): string {
    return crypto.createHash('sha256').update(JSON.stringify(value ?? null)).digest('hex');
}
