import type { AiJobRecord } from '../../aiJobs/types';
import { SOURCE_MATERIAL_REVIEW_QUEUE_STATUSES } from '../../sourceMaterials/lifecycle';
import { persistGuardianFindingCandidate } from './findings';
import {
    notifyGuardianFindingRecipients,
    parseOpsAlertEmails,
    recordGuardianFindingNotificationFailure,
    sendGuardianOpsAlertEmail,
    type GuardianOpsAlertEmail,
} from './notifications';
import { evaluateSourceReviewBacklog } from './rules';

interface ProcessGuardianFindingJobInput {
    job: AiJobRecord;
}

export async function processGuardianFindingJob(
    prisma: any,
    input: ProcessGuardianFindingJobInput,
): Promise<{
    status: 'disabled' | 'processed' | 'no_signal';
    createdCount: number;
    dedupedCount: number;
    notifiedCount: number;
    failedNotificationCount: number;
    findingIds: string[];
}> {
    if (!isGuardianEnabled()) {
        return emptyResult('disabled');
    }

    const circleId = Number(input.job.scopeCircleId ?? input.job.payload?.circleId ?? 0);
    if (!Number.isFinite(circleId) || circleId <= 0) {
        throw new Error('invalid_guardian_finding_job_payload');
    }

    return runGuardianFindingScan(prisma, {
        circleId,
        requestedByUserId: normalizeUserId(input.job.requestedByUserId),
        now: new Date(),
    });
}

export async function runGuardianFindingScan(
    prisma: any,
    input: {
        circleId: number;
        requestedByUserId?: number | null;
        now?: Date;
        sendOpsEmail?: (email: GuardianOpsAlertEmail) => Promise<void>;
    },
): Promise<{
    status: 'processed' | 'no_signal';
    createdCount: number;
    dedupedCount: number;
    notifiedCount: number;
    failedNotificationCount: number;
    findingIds: string[];
}> {
    const now = input.now ?? new Date();
    const materials = await listReviewQueueMaterialMetadata(prisma, input.circleId);
    const candidate = evaluateSourceReviewBacklog({
        circleId: input.circleId,
        ownerUserId: input.requestedByUserId ?? null,
        materials,
        now,
    });
    if (!candidate) return emptyResult('no_signal');

    const persisted = await persistGuardianFindingCandidate(prisma, candidate, { now });
    const findingIds = [persisted.finding.id];
    let notifiedCount = 0;
    let failedNotificationCount = 0;

    if (persisted.status === 'created' && candidate.notificationPolicy === 'ops') {
        try {
            const notification = await notifyGuardianFindingRecipients(prisma, {
                findingId: persisted.finding.id,
                circleId: input.circleId,
                level: candidate.level,
                title: candidate.title,
                summary: candidate.summary,
                opsEmails: parseOpsAlertEmails(process.env.OPS_ALERT_EMAILS),
                sendEmail: input.sendOpsEmail ?? sendGuardianOpsAlertEmail,
            });
            if (notification.status === 'sent') notifiedCount = notification.recipientCount;
            if (notification.status === 'failed') failedNotificationCount = 1;
        } catch (error) {
            await recordGuardianFindingNotificationFailure(prisma, {
                findingId: persisted.finding.id,
                error,
            });
            failedNotificationCount = 1;
        }
    }

    return {
        status: 'processed',
        createdCount: persisted.status === 'created' ? 1 : 0,
        dedupedCount: persisted.status === 'deduped' ? 1 : 0,
        notifiedCount,
        failedNotificationCount,
        findingIds,
    };
}

export async function listGuardianCandidateCircleIds(
    prisma: any,
    input: {
        limit?: number;
    } = {},
): Promise<number[]> {
    if (typeof prisma?.sourceMaterial?.findMany !== 'function') return [];
    const rows = await prisma.sourceMaterial.findMany({
        where: {
            lifecycleStatus: {
                in: SOURCE_MATERIAL_REVIEW_QUEUE_STATUSES,
            },
        },
        distinct: ['circleId'],
        select: {
            circleId: true,
        },
        orderBy: {
            createdAt: 'asc',
        },
        take: Math.max(1, Math.min(100, Number(input.limit ?? 25))),
    });
    return rows
        .map((row: any) => Number(row.circleId))
        .filter((value: number) => Number.isFinite(value) && value > 0);
}

async function listReviewQueueMaterialMetadata(prisma: any, circleId: number) {
    if (typeof prisma?.sourceMaterial?.findMany !== 'function') return [];
    return prisma.sourceMaterial.findMany({
        where: {
            circleId,
            lifecycleStatus: {
                in: SOURCE_MATERIAL_REVIEW_QUEUE_STATUSES,
            },
        },
        select: {
            id: true,
            circleId: true,
            name: true,
            contentDigest: true,
            lifecycleStatus: true,
            evidencePrivacyClass: true,
            visibilityScope: true,
            originType: true,
            originRef: true,
            createdAt: true,
        },
        orderBy: {
            createdAt: 'asc',
        },
        take: 25,
    });
}

function isGuardianEnabled(): boolean {
    const normalized = String(process.env.AI_GUARDIAN_ENABLED ?? 'true').trim().toLowerCase();
    return normalized !== 'false' && normalized !== '0' && normalized !== 'off';
}

function normalizeUserId(value: unknown): number | null {
    const parsed = Number(value);
    return Number.isFinite(parsed) && parsed > 0 ? parsed : null;
}

function emptyResult<TStatus extends 'disabled' | 'no_signal'>(status: TStatus) {
    return {
        status,
        createdCount: 0,
        dedupedCount: 0,
        notifiedCount: 0,
        failedNotificationCount: 0,
        findingIds: [],
    };
}
