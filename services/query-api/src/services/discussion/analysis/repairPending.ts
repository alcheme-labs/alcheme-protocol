import { Prisma, type PrismaClient } from '@prisma/client';

import { runSingletonTask } from '../../runtime/queryRuntimeTaskState';
import { sqlTimestampWithoutTimeZone } from '../../../utils/sqlTimestamp';
import { enqueueDiscussionMessageAnalyzeJob } from './enqueue';

interface PendingDiscussionAnalysisRow {
    envelopeId: string;
    circleId: number;
    requestedByUserId: number | null;
    existingJobId: number | null;
}

export interface RepairPendingDiscussionAnalysisOptions {
    circleId?: number;
    limit?: number;
    olderThanMs?: number;
    failedJobCooldownMs?: number;
    now?: Date;
}

export interface RepairPendingDiscussionAnalysisResult {
    scanned: string[];
    enqueued: string[];
    skippedExistingJob: string[];
    failed: Array<{ envelopeId: string; error: string }>;
}

interface PendingDiscussionAnalysisRepairSchedulerOptions {
    ownerId?: string;
    intervalMs?: number;
}

type StartPendingDiscussionAnalysisRepairOptions =
    RepairPendingDiscussionAnalysisOptions
    & PendingDiscussionAnalysisRepairSchedulerOptions;

let repairTimer: ReturnType<typeof setInterval> | null = null;
let repairInFlight = false;

function normalizeLimit(value: unknown): number {
    const parsed = Number(value);
    if (!Number.isFinite(parsed)) return 100;
    return Math.min(500, Math.max(1, Math.trunc(parsed)));
}

function normalizeOlderThanMs(value: unknown): number {
    const parsed = Number(value);
    if (!Number.isFinite(parsed)) return 5_000;
    return Math.max(0, Math.trunc(parsed));
}

function normalizeFailedJobCooldownMs(value: unknown): number {
    const parsed = Number(value);
    if (!Number.isFinite(parsed)) return 10 * 60_000;
    return Math.max(0, Math.trunc(parsed));
}

export async function repairPendingDiscussionAnalysisJobs(
    prisma: PrismaClient,
    options: RepairPendingDiscussionAnalysisOptions = {},
): Promise<RepairPendingDiscussionAnalysisResult> {
    const limit = normalizeLimit(options.limit);
    const olderThanMs = normalizeOlderThanMs(options.olderThanMs);
    const now = options.now ?? new Date();
    const cutoff = new Date(now.getTime() - olderThanMs);
    const failedJobCooldownMs = normalizeFailedJobCooldownMs(options.failedJobCooldownMs);
    const failedJobCutoff = new Date(now.getTime() - failedJobCooldownMs);
    const circleFilter = typeof options.circleId === 'number' && Number.isFinite(options.circleId) && options.circleId > 0
        ? Prisma.sql`AND m.circle_id = ${Math.trunc(options.circleId)}`
        : Prisma.empty;

    const rows = await prisma.$queryRaw<PendingDiscussionAnalysisRow[]>(Prisma.sql`
        SELECT
            m.envelope_id AS "envelopeId",
            m.circle_id AS "circleId",
            u.id AS "requestedByUserId",
            j.id AS "existingJobId"
        FROM circle_discussion_messages m
        LEFT JOIN users u
          ON u.pubkey = m.sender_pubkey
        LEFT JOIN LATERAL (
            SELECT id
            FROM ai_jobs j
            WHERE j.job_type = 'discussion_message_analyze'
              AND (
                j.status IN ('queued', 'running')
                OR (
                    j.status = 'failed'
                    AND j.updated_at >= ${sqlTimestampWithoutTimeZone(failedJobCutoff)}
                )
              )
              AND (
                j.dedupe_key = CONCAT('discussion_message_analyze:', m.envelope_id)
                OR j.payload_json->>'envelopeId' = m.envelope_id
              )
            ORDER BY j.id DESC
            LIMIT 1
        ) j ON TRUE
        WHERE m.relevance_status = 'pending'
          AND COALESCE(m.deleted, FALSE) = FALSE
          AND m.created_at <= ${sqlTimestampWithoutTimeZone(cutoff)}
          ${circleFilter}
        ORDER BY m.created_at ASC
        LIMIT ${limit}
    `);

    const result: RepairPendingDiscussionAnalysisResult = {
        scanned: [],
        enqueued: [],
        skippedExistingJob: [],
        failed: [],
    };

    for (const row of rows) {
        result.scanned.push(row.envelopeId);
        if (row.existingJobId) {
            result.skippedExistingJob.push(row.envelopeId);
            continue;
        }
        try {
            await enqueueDiscussionMessageAnalyzeJob(prisma, {
                envelopeId: row.envelopeId,
                circleId: row.circleId,
                requestedByUserId: row.requestedByUserId,
            });
            result.enqueued.push(row.envelopeId);
        } catch (error) {
            result.failed.push({
                envelopeId: row.envelopeId,
                error: error instanceof Error ? error.message : String(error),
            });
        }
    }

    return result;
}

export function startPendingDiscussionAnalysisRepair(
    prisma: PrismaClient,
    options: StartPendingDiscussionAnalysisRepairOptions = {},
): void {
    stopPendingDiscussionAnalysisRepair();
    const {
        ownerId: configuredOwnerId,
        intervalMs: configuredIntervalMs,
        ...repairOptions
    } = options;
    const ownerId = configuredOwnerId || `query-api:${process.pid}`;
    const intervalMs = Math.max(
        1_000,
        Math.trunc(Number(configuredIntervalMs ?? process.env.DISCUSSION_ANALYSIS_REPAIR_INTERVAL_MS ?? 60_000)),
    );
    const run = () => {
        if (repairInFlight) return;
        repairInFlight = true;
        void runSingletonTask(prisma, {
            taskKey: 'pending_discussion_analysis',
            ownerId,
            leaseMs: Math.max(intervalMs * 4, 60_000),
            minIntervalMs: Math.max(1_000, Math.floor(intervalMs * 0.8)),
        }, async () => {
            await repairPendingDiscussionAnalysisJobs(prisma, repairOptions);
        })
            .catch((error) => {
                const message = error instanceof Error ? error.message : String(error);
                console.warn(`discussion analysis repair failed: ${message}`);
            })
            .finally(() => {
                repairInFlight = false;
            });
    };
    run();
    repairTimer = setInterval(run, intervalMs);
}

export function stopPendingDiscussionAnalysisRepair(): void {
    if (!repairTimer) return;
    clearInterval(repairTimer);
    repairTimer = null;
}
