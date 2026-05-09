import crypto from "crypto";

import type {
  AiJobRecord,
  ClaimAiJobInput,
  CompleteAiJobInput,
  EnqueueAiJobInput,
  FailAiJobInput,
  PrismaLike,
} from "./types";
import { loadAiJobById, toAiJobRecord } from "./readModel";
import { publishAiJobStreamEvent } from "./stream";

const DEFAULT_MAX_ATTEMPTS = 3;
const DEFAULT_BATCH_SIZE = 10;
const DEFAULT_CLAIM_LEASE_MS = 60_000;
const DISCUSSION_TRIGGER_JOB_TYPE = "discussion_trigger_evaluate";
const DISCUSSION_ANALYZE_JOB_TYPE = "discussion_message_analyze";
const AI_JOB_TYPES = [
  "ghost_draft_generate",
  DISCUSSION_TRIGGER_JOB_TYPE,
  DISCUSSION_ANALYZE_JOB_TYPE,
  "discussion_circle_reanalyze",
  "voice_recap_generate",
  "crystal_asset_issue",
] as const;

function compareExistingClaimOrder(
  left: { availableAt: Date; id: number },
  right: { availableAt: Date; id: number },
): number {
  const availableDiff =
    left.availableAt.getTime() - right.availableAt.getTime();
  if (availableDiff !== 0) return availableDiff;
  return left.id - right.id;
}

export function getAiJobClaimLeaseMs(): number {
  const parsed = Number(
    process.env.AI_JOB_CLAIM_LEASE_MS || DEFAULT_CLAIM_LEASE_MS,
  );
  if (!Number.isFinite(parsed) || parsed <= 0) return DEFAULT_CLAIM_LEASE_MS;
  return Math.max(1_000, Math.floor(parsed));
}

export function computeAiJobBackoffMs(attempt: number): number {
  const normalized = Math.max(1, attempt);
  return Math.min(60_000, 1_000 * 2 ** (normalized - 1));
}

export async function requeueStaleAiJobs(
  prisma: PrismaLike,
  input: {
    now?: Date;
    leaseMs?: number;
  } = {},
): Promise<number> {
  const prismaAny = prisma as any;
  const now = input.now ?? new Date();
  const leaseMs = Math.max(
    1_000,
    Number(input.leaseMs ?? getAiJobClaimLeaseMs()),
  );
  const staleBefore = new Date(now.getTime() - leaseMs);

  const staleJobs = await prismaAny.aiJob.findMany({
    where: {
      status: "running",
      claimedAt: { lte: staleBefore },
    },
  });
  const terminalIds = (Array.isArray(staleJobs) ? staleJobs : [])
    .filter(
      (row) =>
        Number(row.attempts || 0) >=
        Number(row.maxAttempts || DEFAULT_MAX_ATTEMPTS),
    )
    .map((row) => Number(row.id))
    .filter((value) => Number.isFinite(value) && value > 0);
  const retryableIds = (Array.isArray(staleJobs) ? staleJobs : [])
    .filter(
      (row) =>
        Number(row.attempts || 0) <
        Number(row.maxAttempts || DEFAULT_MAX_ATTEMPTS),
    )
    .map((row) => Number(row.id))
    .filter((value) => Number.isFinite(value) && value > 0);

  const terminal =
    terminalIds.length > 0
      ? await prismaAny.aiJob.updateMany({
          where: {
            id: { in: terminalIds },
            status: "running",
            claimedAt: { lte: staleBefore },
          },
          data: {
            status: "failed",
            claimedAt: null,
            completedAt: now,
            workerId: null,
            claimToken: null,
            dedupeKey: null,
            lastErrorCode: "ai_job_worker_expired",
            lastErrorMessage: "ai job worker lease expired before completion",
            updatedAt: now,
          },
        })
      : { count: 0 };

  const retryable =
    retryableIds.length > 0
      ? await prismaAny.aiJob.updateMany({
          where: {
            id: { in: retryableIds },
            status: "running",
            claimedAt: { lte: staleBefore },
          },
          data: {
            status: "queued",
            availableAt: now,
            claimedAt: null,
            workerId: null,
            claimToken: null,
            lastErrorCode: "ai_job_worker_expired",
            lastErrorMessage: "ai job worker lease expired before completion",
            updatedAt: now,
          },
        })
      : { count: 0 };

  return Number(terminal?.count || 0) + Number(retryable?.count || 0);
}

export async function renewAiJobLease(
  prisma: PrismaLike,
  input: {
    jobId: number;
    claimToken: string;
    now?: Date;
  },
): Promise<boolean> {
  const prismaAny = prisma as any;
  const now = input.now ?? new Date();
  const updated = await prismaAny.aiJob.updateMany({
    where: {
      id: input.jobId,
      status: "running",
      claimToken: input.claimToken,
    },
    data: {
      claimedAt: now,
      updatedAt: now,
    },
  });
  return Number(updated?.count || 0) === 1;
}

export async function enqueueAiJob(
  prisma: PrismaLike,
  input: EnqueueAiJobInput,
): Promise<AiJobRecord> {
  const prismaAny = prisma as any;

  if (input.dedupeKey) {
    const existing = await prismaAny.aiJob.findUnique({
      where: { dedupeKey: input.dedupeKey },
    });
    if (existing) {
      return toAiJobRecord(existing);
    }
  }

  try {
    const created = await prismaAny.aiJob.create({
      data: {
        jobType: input.jobType,
        dedupeKey: input.dedupeKey || null,
        scopeType: input.scopeType,
        scopeDraftPostId: input.scopeDraftPostId ?? null,
        scopeCircleId: input.scopeCircleId ?? null,
        requestedByUserId: input.requestedByUserId ?? null,
        status: "queued",
        attempts: 0,
        maxAttempts: Math.max(
          1,
          Number(input.maxAttempts ?? DEFAULT_MAX_ATTEMPTS),
        ),
        availableAt: input.availableAt ?? new Date(),
        payloadJson: input.payload || null,
        resultJson: null,
        lastErrorCode: null,
        lastErrorMessage: null,
      },
    });
    const record = toAiJobRecord(created);
    publishAiJobStreamEvent(record);
    return record;
  } catch (error: any) {
    if (input.dedupeKey && error?.code === "P2002") {
      const existing = await prismaAny.aiJob.findUnique({
        where: { dedupeKey: input.dedupeKey },
      });
      if (existing) {
        return toAiJobRecord(existing);
      }
    }
    throw error;
  }
}

export async function claimNextAiJob(
  prisma: PrismaLike,
  input: ClaimAiJobInput,
): Promise<AiJobRecord | null> {
  const prismaAny = prisma as any;
  const now = input.now ?? new Date();
  await requeueStaleAiJobs(prisma, {
    now,
    leaseMs: input.leaseMs,
  });

  const requestedJobTypes = input.jobTypes?.length
    ? input.jobTypes
    : [...AI_JOB_TYPES];
  const nonDiscussionJobTypes = requestedJobTypes.filter(
    (jobType) =>
      jobType !== DISCUSSION_TRIGGER_JOB_TYPE &&
      jobType !== DISCUSSION_ANALYZE_JOB_TYPE,
  );

  const baseWhere = {
    status: "queued",
    availableAt: { lte: now },
  } as const;

  const [nonDiscussionCandidate, triggerCandidate, analyzeCandidate] =
    await Promise.all([
      nonDiscussionJobTypes.length > 0
        ? prismaAny.aiJob
            .findMany({
              where: {
                ...baseWhere,
                jobType: { in: nonDiscussionJobTypes },
              },
              orderBy: [{ availableAt: "asc" }, { id: "asc" }],
              take: 1,
            })
            .then((rows: any[]) => rows[0] ?? null)
        : Promise.resolve(null),
      requestedJobTypes.includes(DISCUSSION_TRIGGER_JOB_TYPE as any)
        ? prismaAny.aiJob
            .findMany({
              where: {
                ...baseWhere,
                jobType: DISCUSSION_TRIGGER_JOB_TYPE,
              },
              orderBy: [{ availableAt: "asc" }, { id: "asc" }],
              take: 1,
            })
            .then((rows: any[]) => rows[0] ?? null)
        : Promise.resolve(null),
      requestedJobTypes.includes(DISCUSSION_ANALYZE_JOB_TYPE as any)
        ? prismaAny.aiJob
            .findMany({
              where: {
                ...baseWhere,
                jobType: DISCUSSION_ANALYZE_JOB_TYPE,
              },
              orderBy: [{ availableAt: "asc" }, { id: "asc" }],
              take: 1,
            })
            .then((rows: any[]) => rows[0] ?? null)
        : Promise.resolve(null),
    ]);

  const discussionCandidate = triggerCandidate || analyzeCandidate;
  const candidates = [nonDiscussionCandidate, discussionCandidate]
    .filter(Boolean)
    .sort((left: any, right: any) =>
      compareExistingClaimOrder(
        {
          availableAt: new Date(left.availableAt),
          id: Number(left.id),
        },
        {
          availableAt: new Date(right.availableAt),
          id: Number(right.id),
        },
      ),
    );

  for (const candidate of Array.isArray(candidates) ? candidates : []) {
    const claimToken = crypto.randomUUID();
    const claimed = await prismaAny.aiJob.updateMany({
      where: {
        id: Number(candidate.id),
        status: "queued",
        claimToken: null,
      },
      data: {
        status: "running",
        claimedAt: now,
        workerId: input.workerId,
        claimToken,
        attempts: { increment: 1 },
        updatedAt: now,
      },
    });
    if (Number(claimed?.count || 0) !== 1) continue;

    const row = await prismaAny.aiJob.findUnique({
      where: { id: Number(candidate.id) },
    });
    if (row) {
      const record = toAiJobRecord(row);
      publishAiJobStreamEvent(record);
      return record;
    }
  }

  return null;
}

export async function completeAiJob(
  prisma: PrismaLike,
  input: CompleteAiJobInput,
): Promise<AiJobRecord | null> {
  const prismaAny = prisma as any;
  const now = input.now ?? new Date();
  const updated = await prismaAny.aiJob.updateMany({
    where: {
      id: input.jobId,
      claimToken: input.claimToken,
    },
    data: {
      status: "succeeded",
      resultJson: input.result || null,
      claimedAt: null,
      completedAt: now,
      workerId: null,
      claimToken: null,
      dedupeKey: null,
      lastErrorCode: null,
      lastErrorMessage: null,
      updatedAt: now,
    },
  });
  if (Number(updated?.count || 0) !== 1) {
    return null;
  }
  const record = await loadAiJobById(prisma, input.jobId);
  if (record) {
    publishAiJobStreamEvent(record);
  }
  return record;
}

export async function failAiJob(
  prisma: PrismaLike,
  input: FailAiJobInput,
): Promise<AiJobRecord | null> {
  const prismaAny = prisma as any;
  const now = input.now ?? new Date();
  const current = await loadAiJobById(prisma, input.jobId);
  if (!current) return null;

  const retryable = current.attempts < current.maxAttempts;
  const updated = await prismaAny.aiJob.updateMany({
    where: {
      id: input.jobId,
      claimToken: input.claimToken,
    },
    data: {
      status: retryable ? "queued" : "failed",
      availableAt: retryable
        ? new Date(now.getTime() + computeAiJobBackoffMs(current.attempts))
        : current.availableAt,
      claimedAt: null,
      completedAt: retryable ? null : now,
      workerId: null,
      claimToken: null,
      dedupeKey: retryable ? current.dedupeKey : null,
      lastErrorCode: input.error.code || "ai_job_failed",
      lastErrorMessage: input.error.message,
      updatedAt: now,
    },
  });
  if (Number(updated?.count || 0) !== 1) {
    return null;
  }
  const record = await loadAiJobById(prisma, input.jobId);
  if (record) {
    publishAiJobStreamEvent(record);
  }
  return record;
}
