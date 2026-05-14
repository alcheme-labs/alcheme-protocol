import crypto from "crypto";

import { Prisma, type PrismaClient } from "@prisma/client";

import type { GovernanceStrategyResult } from "./strategies/types";

export type GovernanceDecisionValue =
  | "accepted"
  | "rejected"
  | "expired"
  | "cancelled";

export interface GovernanceDecisionInput {
  requestId: string;
  decision: GovernanceDecisionValue;
  reason: string;
  tally: Record<string, unknown>;
  decidedAt: string;
  executableFrom: string | null;
  executableUntil: string | null;
}

export interface GovernanceDecisionRecord extends GovernanceDecisionInput {
  decisionDigest: string;
  issuerSignature?: string | null;
}

export interface GovernanceScopeRef {
  type: string;
  ref: string;
}

export interface GovernanceActionRecord {
  type: string;
  targetType: string;
  targetRef: string;
  payload: Record<string, unknown>;
  idempotencyKey: string;
}

export interface GovernanceEligibleActor {
  pubkey: string;
  role?: string | null;
  weight: string;
  source: string;
}

export interface GovernanceRequestRecord {
  id: string;
  policyId: string;
  policyVersionId: string;
  policyVersion: number;
  ruleId: string;
  scopeType: string;
  scopeRef: string;
  actionType: string;
  targetType: string;
  targetRef: string;
  payload: Record<string, unknown>;
  idempotencyKey: string;
  proposerPubkey: string;
  state: "active" | "accepted" | "rejected" | "expired" | "cancelled";
  openedAt: Date;
  expiresAt?: Date | null;
  resolvedAt?: Date | null;
}

export interface GovernanceSnapshotRecord {
  id: string;
  requestId: string;
  eligibleActors: GovernanceEligibleActor[];
  sourceDigest: string;
  createdAt: Date;
}

export interface GovernanceSignalRecord {
  id: string;
  requestId: string;
  signalType: string;
  actorPubkey?: string | null;
  value: string;
  weight: string;
  evidence?: Record<string, unknown> | null;
  signature?: string | null;
  signedMessage?: string | null;
  externalClaimNonce?: string | null;
  createdAt: Date;
}

export interface GovernanceExecutionReceiptRecord {
  id: string;
  requestId: string;
  actionType: string;
  executorModule: string;
  executionStatus: "executed" | "failed" | "skipped";
  executionRef?: string | null;
  errorCode?: string | null;
  idempotencyKey: string;
  executedAt: Date;
}

export interface GovernanceEngineStore {
  saveDecision(
    decision: GovernanceDecisionRecord,
  ): Promise<GovernanceDecisionRecord>;
  getExecutionReceiptByMarker(input: {
    requestId: string;
    executorModule: string;
    idempotencyKey: string;
  }): Promise<GovernanceExecutionReceiptRecord | null>;
  saveExecutionReceipt(
    receipt: GovernanceExecutionReceiptRecord,
  ): Promise<GovernanceExecutionReceiptRecord>;
}

export interface GovernanceRequestStore {
  saveRequest(
    request: GovernanceRequestRecord,
  ): Promise<GovernanceRequestRecord>;
  saveSnapshot(
    snapshot: GovernanceSnapshotRecord,
  ): Promise<GovernanceSnapshotRecord>;
  saveSignal(signal: GovernanceSignalRecord): Promise<GovernanceSignalRecord>;
}

type GovernancePrisma = Pick<
  PrismaClient,
  "governanceDecision" | "governanceRequest" | "governanceExecutionReceipt"
>;

export function createPrismaGovernanceEngineStore(
  prisma: GovernancePrisma,
): GovernanceEngineStore {
  return {
    async saveDecision(decision) {
      const saved = await prisma.governanceDecision.upsert({
        where: { requestId: decision.requestId },
        create: {
          requestId: decision.requestId,
          decision: decision.decision,
          reason: decision.reason,
          tally: decision.tally as Prisma.InputJsonValue,
          decidedAt: new Date(decision.decidedAt),
          executableFrom: decision.executableFrom
            ? new Date(decision.executableFrom)
            : null,
          executableUntil: decision.executableUntil
            ? new Date(decision.executableUntil)
            : null,
          decisionDigest: decision.decisionDigest,
          issuerSignature: decision.issuerSignature ?? null,
        },
        update: {
          decision: decision.decision,
          reason: decision.reason,
          tally: decision.tally as Prisma.InputJsonValue,
          decidedAt: new Date(decision.decidedAt),
          executableFrom: decision.executableFrom
            ? new Date(decision.executableFrom)
            : null,
          executableUntil: decision.executableUntil
            ? new Date(decision.executableUntil)
            : null,
          decisionDigest: decision.decisionDigest,
          issuerSignature: decision.issuerSignature ?? null,
        },
      });
      await prisma.governanceRequest.update({
        where: { id: decision.requestId },
        data: {
          state: decision.decision,
          resolvedAt: new Date(decision.decidedAt),
        },
      });
      return {
        requestId: saved.requestId,
        decision: saved.decision as GovernanceDecisionValue,
        reason: saved.reason,
        tally: asRecord(saved.tally),
        decidedAt: saved.decidedAt.toISOString(),
        executableFrom: saved.executableFrom?.toISOString() ?? null,
        executableUntil: saved.executableUntil?.toISOString() ?? null,
        decisionDigest: saved.decisionDigest,
        issuerSignature: saved.issuerSignature,
      };
    },
    async getExecutionReceiptByMarker(input) {
      return prisma.governanceExecutionReceipt.findUnique({
        where: {
          requestId_executorModule_idempotencyKey: {
            requestId: input.requestId,
            executorModule: input.executorModule,
            idempotencyKey: input.idempotencyKey,
          },
        },
      }) as Promise<GovernanceExecutionReceiptRecord | null>;
    },
    async saveExecutionReceipt(receipt) {
      return prisma.governanceExecutionReceipt.create({
        data: {
          id: receipt.id,
          requestId: receipt.requestId,
          actionType: receipt.actionType,
          executorModule: receipt.executorModule,
          executionStatus: receipt.executionStatus,
          executionRef: receipt.executionRef ?? null,
          errorCode: receipt.errorCode ?? null,
          idempotencyKey: receipt.idempotencyKey,
          executedAt: receipt.executedAt,
        },
      }) as Promise<GovernanceExecutionReceiptRecord>;
    },
  };
}

type GovernanceRequestPrisma = Pick<
  PrismaClient,
  "governanceRequest" | "governanceSnapshot" | "governanceSignal"
>;

export function createPrismaGovernanceRequestStore(
  prisma: GovernanceRequestPrisma,
): GovernanceRequestStore {
  return {
    async saveRequest(request) {
      return prisma.governanceRequest.create({
        data: {
          id: request.id,
          policyId: request.policyId,
          policyVersionId: request.policyVersionId,
          policyVersion: request.policyVersion,
          ruleId: request.ruleId,
          scopeType: request.scopeType,
          scopeRef: request.scopeRef,
          actionType: request.actionType,
          targetType: request.targetType,
          targetRef: request.targetRef,
          payload: request.payload as Prisma.InputJsonValue,
          idempotencyKey: request.idempotencyKey,
          proposerPubkey: request.proposerPubkey,
          state: request.state,
          openedAt: request.openedAt,
          expiresAt: request.expiresAt ?? null,
          resolvedAt: request.resolvedAt ?? null,
        },
      }) as Promise<GovernanceRequestRecord>;
    },
    async saveSnapshot(snapshot) {
      return prisma.governanceSnapshot.create({
        data: {
          id: snapshot.id,
          requestId: snapshot.requestId,
          eligibleActors: snapshot.eligibleActors as unknown as Prisma.InputJsonValue,
          sourceDigest: snapshot.sourceDigest,
          createdAt: snapshot.createdAt,
        },
      }) as unknown as Promise<GovernanceSnapshotRecord>;
    },
    async saveSignal(signal) {
      return prisma.governanceSignal.create({
        data: {
          id: signal.id,
          requestId: signal.requestId,
          signalType: signal.signalType,
          actorPubkey: signal.actorPubkey ?? null,
          value: signal.value,
          weight: signal.weight,
          evidence: signal.evidence
            ? (signal.evidence as Prisma.InputJsonValue)
            : undefined,
          signature: signal.signature ?? null,
          signedMessage: signal.signedMessage ?? null,
          externalClaimNonce: signal.externalClaimNonce ?? null,
          createdAt: signal.createdAt,
        },
      }) as Promise<GovernanceSignalRecord>;
    },
  };
}

export function computeGovernanceDecisionDigest(
  input: GovernanceDecisionInput,
): string {
  return crypto
    .createHash("sha256")
    .update(stableJsonStringify(input))
    .digest("hex");
}

export function computeGovernanceSnapshotDigest(input: {
  requestId: string;
  eligibleActors: GovernanceEligibleActor[];
  action: GovernanceActionRecord;
  scope: GovernanceScopeRef;
}): string {
  return crypto
    .createHash("sha256")
    .update(stableJsonStringify(input))
    .digest("hex");
}

export async function openGovernanceRequest(
  store: GovernanceRequestStore,
  input: {
    id: string;
    policyId: string;
    policyVersionId: string;
    policyVersion: number;
    ruleId: string;
    scope: GovernanceScopeRef;
    action: GovernanceActionRecord;
    proposerPubkey: string;
    eligibleActors: GovernanceEligibleActor[];
    openedAt: Date;
    expiresAt?: Date | null;
  },
): Promise<GovernanceRequestRecord & { snapshot: GovernanceSnapshotRecord }> {
  const request: GovernanceRequestRecord = {
    id: input.id,
    policyId: input.policyId,
    policyVersionId: input.policyVersionId,
    policyVersion: input.policyVersion,
    ruleId: input.ruleId,
    scopeType: input.scope.type,
    scopeRef: input.scope.ref,
    actionType: input.action.type,
    targetType: input.action.targetType,
    targetRef: input.action.targetRef,
    payload: input.action.payload,
    idempotencyKey: input.action.idempotencyKey,
    proposerPubkey: input.proposerPubkey,
    state: "active",
    openedAt: input.openedAt,
    expiresAt: input.expiresAt ?? null,
    resolvedAt: null,
  };
  const snapshot: GovernanceSnapshotRecord = {
    id: `${input.id}:snapshot`,
    requestId: input.id,
    eligibleActors: input.eligibleActors,
    sourceDigest: computeGovernanceSnapshotDigest({
      requestId: input.id,
      eligibleActors: input.eligibleActors,
      action: input.action,
      scope: input.scope,
    }),
    createdAt: input.openedAt,
  };

  await store.saveRequest(request);
  await store.saveSnapshot(snapshot);
  return { ...request, snapshot };
}

export function assertGovernanceSignalAuthenticated(
  signal: GovernanceSignalRecord,
): void {
  if (!signal.signature && !signal.externalClaimNonce) {
    throw new Error("governance_signal_auth_required");
  }
}

export async function recordGovernanceSignal(
  store: GovernanceRequestStore,
  input: GovernanceSignalRecord,
): Promise<GovernanceSignalRecord> {
  assertGovernanceSignalAuthenticated(input);
  return store.saveSignal(input);
}

export async function resolveGovernanceRequest(
  store: GovernanceEngineStore,
  input: {
    requestId: string;
    result: GovernanceStrategyResult;
    now: Date;
    executableFrom?: Date | null;
    executableUntil?: Date | null;
  },
): Promise<GovernanceDecisionRecord> {
  const decision: GovernanceDecisionValue =
    input.result.state === "accepted"
      ? "accepted"
      : input.result.state === "rejected"
        ? "rejected"
        : "expired";
  const decisionInput: GovernanceDecisionInput = {
    requestId: input.requestId,
    decision,
    reason: input.result.reason,
    tally: input.result.tally ?? {},
    decidedAt: input.now.toISOString(),
    executableFrom: input.executableFrom?.toISOString() ?? null,
    executableUntil: input.executableUntil?.toISOString() ?? null,
  };

  return store.saveDecision({
    ...decisionInput,
    decisionDigest: computeGovernanceDecisionDigest(decisionInput),
  });
}

export async function recordExecutionReceipt(
  store: GovernanceEngineStore,
  input: GovernanceExecutionReceiptRecord,
): Promise<GovernanceExecutionReceiptRecord> {
  const existing = await store.getExecutionReceiptByMarker({
    requestId: input.requestId,
    executorModule: input.executorModule,
    idempotencyKey: input.idempotencyKey,
  });
  if (existing) return existing;
  return store.saveExecutionReceipt(input);
}

function stableJsonStringify(value: unknown): string {
  if (value === null || typeof value !== "object") {
    return JSON.stringify(value);
  }
  if (Array.isArray(value)) {
    return `[${value.map((item) => stableJsonStringify(item)).join(",")}]`;
  }
  const record = value as Record<string, unknown>;
  return `{${Object.keys(record)
    .sort()
    .map((key) => `${JSON.stringify(key)}:${stableJsonStringify(record[key])}`)
    .join(",")}}`;
}

function asRecord(value: unknown): Record<string, unknown> {
  return value && typeof value === "object" && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : {};
}
