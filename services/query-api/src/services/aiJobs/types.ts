import type { Prisma, PrismaClient } from "@prisma/client";
import type { Redis } from "ioredis";

export type PrismaLike = PrismaClient | Prisma.TransactionClient;

export type AiJobType =
  | "ghost_draft_generate"
  | "discussion_trigger_evaluate"
  | "discussion_message_analyze"
  | "discussion_circle_reanalyze"
  | "voice_recap_generate"
  | "crystal_asset_issue";
export type AiJobScopeType = "draft" | "circle" | "system";
export type AiJobStatus = "queued" | "running" | "succeeded" | "failed";

export interface AiJobRecord {
  id: number;
  jobType: AiJobType;
  dedupeKey: string | null;
  scopeType: AiJobScopeType;
  scopeDraftPostId: number | null;
  scopeCircleId: number | null;
  requestedByUserId: number | null;
  status: AiJobStatus;
  attempts: number;
  maxAttempts: number;
  availableAt: Date;
  claimedAt: Date | null;
  completedAt: Date | null;
  workerId: string | null;
  claimToken: string | null;
  payload: Record<string, unknown> | null;
  result: Record<string, unknown> | null;
  lastErrorCode: string | null;
  lastErrorMessage: string | null;
  createdAt: Date;
  updatedAt: Date;
}

export type AiJobView = Omit<AiJobRecord, "claimToken">;

export interface EnqueueAiJobInput {
  jobType: AiJobType;
  dedupeKey?: string | null;
  scopeType: AiJobScopeType;
  scopeDraftPostId?: number | null;
  scopeCircleId?: number | null;
  requestedByUserId?: number | null;
  maxAttempts?: number;
  availableAt?: Date;
  payload?: Record<string, unknown> | null;
}

export interface ClaimAiJobInput {
  workerId: string;
  now?: Date;
  jobTypes?: AiJobType[];
  batchSize?: number;
  leaseMs?: number;
}

export interface CompleteAiJobInput {
  jobId: number;
  claimToken: string;
  result?: Record<string, unknown> | null;
  now?: Date;
}

export interface FailAiJobInput {
  jobId: number;
  claimToken: string;
  error: {
    code?: string | null;
    message: string;
  };
  now?: Date;
}

export interface AiJobHandlerContext {
  job: AiJobRecord;
  prisma: PrismaLike;
  redis?: Redis;
}

export type AiJobHandler = (
  context: AiJobHandlerContext,
) => Promise<Record<string, unknown> | null | void>;
export type AiJobHandlerMap = Partial<Record<AiJobType, AiJobHandler>>;
