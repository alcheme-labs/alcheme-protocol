import { createHash, randomUUID } from "node:crypto";
import fs from "node:fs";
import path from "node:path";

import { BorshAccountsCoder, type Idl } from "@coral-xyz/anchor";
import { Connection, PublicKey } from "@solana/web3.js";

import {
  createPrismaGovernanceEngineStore,
  recordExecutionReceipt,
} from "../governance/policyEngine";
import type {
  ExternalAppChainReceiptPayload,
  ExternalAppChainRegistrationPayload,
  ExternalAppChainServerKeyRotationPayload,
  ExternalAppRegistryAdapter,
  ExternalAppRegistryEvidence,
} from "./chainRegistryAdapter";
import {
  createExternalAppRegistryAdapter,
  loadExternalAppRegistryConfigFromEnv,
} from "./chainRegistryAdapter";
import { quarantineSandboxCircleBindingsForEnvironmentUpgrade } from "./sandboxCircleBindingAuthority";

export type RegistryChainAttemptStage =
  | "registration"
  | "receipt"
  | "server_key_rotation";

export type RegistryChainFinalizedStateClassification =
  | "desired_exact"
  | "frozen_pre_state"
  | "conflict_or_advanced"
  | "account_missing";

export interface RegistryChainAttemptRecord {
  id: string;
  requestId: string;
  actionType: string;
  attemptKey: string;
  stage: RegistryChainAttemptStage;
  status: "quoted" | "broadcasting" | "submitted" | "reconciled" | "failed";
  attemptVersion?: number;
  metadataVersion?: number;
  intentDigest: string;
  txSignature?: string | null;
  recordPda?: string | null;
  chainStateSlot?: bigint | number | null;
  receiptDigest?: string | null;
  cluster?: string | null;
  claimToken?: string | null;
  claimExpiresAt?: Date | null;
  errorCode?: string | null;
  metadata?: Record<string, unknown> | null;
}

type RegistryChainAttemptPrisma = {
  externalAppRegistryChainAttempt: {
    upsert?(input: unknown): Promise<RegistryChainAttemptRecord>;
    findFirst?(input: unknown): Promise<RegistryChainAttemptRecord | null>;
    update(input: unknown): Promise<unknown>;
    updateMany?(input: unknown): Promise<{ count?: number }>;
  };
  externalApp?: { update(input: unknown): Promise<unknown> };
  externalAppRegistryAnchor?: { upsert(input: unknown): Promise<unknown> };
  $transaction?<T>(callback: (tx: any) => Promise<T>): Promise<T>;
  $queryRawUnsafe?<T extends Record<string, unknown> = { now: Date | string }>(
    query: string,
    ...values: unknown[]
  ): Promise<T[]>;
};

type RegistryChainAttemptRecoverySubmitter = Partial<
  Pick<
    ExternalAppRegistryAdapter,
    | "anchorExternalAppRegistration"
    | "anchorExecutionReceipt"
    | "rotateServerKey"
  >
>;

const REGISTRY_CHAIN_BROADCAST_PERSIST_MARGIN_MS = 30_000;
const REGISTRY_CHAIN_BROADCAST_STRICT_FENCE_MS = 1;
const REGISTRY_CHAIN_BROADCAST_LEASE_MAX_MS = 600_000;

export function resolveRegistryChainBroadcastLeaseMs(
  env: NodeJS.ProcessEnv = process.env,
): number {
  const rawSignerTimeout =
    env.EXTERNAL_APP_REGISTRY_AUTHORITY_SIGNER_TIMEOUT_MS;
  const signerTimeoutMs =
    rawSignerTimeout === undefined || rawSignerTimeout === ""
      ? 240_000
      : Number(rawSignerTimeout);
  if (
    !Number.isSafeInteger(signerTimeoutMs) ||
    signerTimeoutMs < 250 ||
    signerTimeoutMs > 360_000
  ) {
    throw new Error(
      "external_app_registry_authority_signer_timeout_invalid",
    );
  }
  const readbackTimeoutMs = registryChainReadbackTimeoutMs(env);
  const leaseMs =
    signerTimeoutMs +
    2 * readbackTimeoutMs +
    REGISTRY_CHAIN_BROADCAST_PERSIST_MARGIN_MS +
    REGISTRY_CHAIN_BROADCAST_STRICT_FENCE_MS;
  if (
    !Number.isSafeInteger(leaseMs) ||
    leaseMs > REGISTRY_CHAIN_BROADCAST_LEASE_MAX_MS
  ) {
    throw new Error("external_app_registry_chain_broadcast_lease_invalid");
  }
  return leaseMs;
}

export function buildRegistryChainAttemptKey(input: {
  requestId: string;
  actionType: string;
  stage: RegistryChainAttemptStage;
  intentDigest: string;
}): string {
  return createHash("sha256")
    .update(
      [input.requestId, input.actionType, input.stage, input.intentDigest].join(
        "\0",
      ),
    )
    .digest("hex");
}

export async function claimRegistryChainAttemptForBroadcast(
  prisma: RegistryChainAttemptPrisma,
  attempt: Pick<
    RegistryChainAttemptRecord,
    "id" | "status" | "claimToken" | "claimExpiresAt"
  >,
  input: {
    now?: Date;
    leaseMs?: number;
    claimToken?: string;
  } = {},
): Promise<boolean> {
  const claimToken =
    input.claimToken ??
    createHash("sha256")
      .update(`external_app_registry_claim\0${attempt.id}\0${randomUUID()}`)
      .digest("hex");
  if (input.leaseMs !== undefined && process.env.NODE_ENV !== "test") {
    throw new Error(
      "external_app_registry_chain_attempt_custom_lease_test_only",
    );
  }
  const leaseMs =
    input.leaseMs === undefined
      ? resolveRegistryChainBroadcastLeaseMs()
      : Math.max(
          5_000,
          Math.min(input.leaseMs, REGISTRY_CHAIN_BROADCAST_LEASE_MAX_MS),
        );
  if (input.now && process.env.NODE_ENV !== "test") {
    throw new Error(
      "external_app_registry_chain_attempt_injected_clock_test_only",
    );
  }
  if (!input.now && typeof prisma.$queryRawUnsafe === "function") {
    const claimed = await prisma.$queryRawUnsafe<{
      claimExpiresAt: Date | string;
    }>(
      `UPDATE "external_app_registry_chain_attempts"
       SET "status" = 'broadcasting',
           "claim_token" = $2,
           "claim_expires_at" = clock_timestamp() + ($3::integer * INTERVAL '1 millisecond'),
           "error_code" = NULL,
           "updated_at" = clock_timestamp()
       WHERE "id" = $1
         AND "tx_signature" IS NULL
         AND (
           ("status" = 'quoted' AND "claim_token" IS NULL AND "claim_expires_at" IS NULL)
           OR ("status" = 'broadcasting' AND "claim_expires_at" <= clock_timestamp())
         )
       RETURNING "claim_expires_at" AS "claimExpiresAt"`,
      attempt.id,
      claimToken,
      leaseMs,
    );
    if (claimed.length !== 1) return false;
    const claimExpiresAt =
      claimed[0].claimExpiresAt instanceof Date
        ? claimed[0].claimExpiresAt
        : new Date(String(claimed[0].claimExpiresAt));
    if (!Number.isFinite(claimExpiresAt.getTime())) {
      throw new Error("external_app_registry_chain_attempt_db_clock_invalid");
    }
    attempt.status = "broadcasting";
    attempt.claimToken = claimToken;
    attempt.claimExpiresAt = claimExpiresAt;
    return true;
  }
  if (process.env.NODE_ENV !== "test") {
    throw new Error("external_app_registry_chain_attempt_db_clock_required");
  }
  if (typeof prisma.externalAppRegistryChainAttempt.updateMany !== "function") {
    throw new Error("external_app_registry_chain_attempt_cas_required");
  }
  const now = input.now ?? new Date();
  const claimExpiresAt = new Date(now.getTime() + leaseMs);
  const claimed = await prisma.externalAppRegistryChainAttempt.updateMany({
    where: {
      id: attempt.id,
      txSignature: null,
      OR: [
        { status: "quoted", claimToken: null, claimExpiresAt: null },
        { status: "broadcasting", claimExpiresAt: { lte: now } },
      ],
    },
    data: {
      status: "broadcasting",
      claimToken,
      claimExpiresAt,
      errorCode: null,
    },
  });
  if (claimed.count === 1) {
    attempt.status = "broadcasting";
    attempt.claimToken = claimToken;
    attempt.claimExpiresAt = claimExpiresAt;
    return true;
  }
  return false;
}

export async function persistQuotedAttempt(
  prisma: RegistryChainAttemptPrisma,
  input: Omit<RegistryChainAttemptRecord, "id" | "attemptKey" | "status"> & {
    metadata?: Record<string, unknown> | null;
  },
): Promise<RegistryChainAttemptRecord> {
  const attemptKey = buildRegistryChainAttemptKey(input);
  const record = {
    id: `external_app_registry_attempt:${attemptKey}`,
    requestId: input.requestId,
    actionType: input.actionType,
    attemptKey,
    stage: input.stage,
    status: "quoted" as const,
    attemptVersion: 1,
    metadataVersion: 1,
    intentDigest: input.intentDigest,
    txSignature: input.txSignature ?? null,
    recordPda:
      input.recordPda ?? deriveRecordPdaFromAttemptMetadata(input.metadata),
    chainStateSlot: input.chainStateSlot ?? null,
    receiptDigest: input.receiptDigest ?? null,
    cluster: input.cluster ?? null,
    claimToken: null,
    claimExpiresAt: null,
    errorCode: input.errorCode ?? null,
    metadata: freezeAttemptMetadata(input),
  };
  if (!prisma.externalAppRegistryChainAttempt.upsert) {
    throw new Error("external_app_registry_chain_attempt_persistence_required");
  }
  return prisma.externalAppRegistryChainAttempt.upsert({
    where: { attemptKey },
    create: record,
    update: {},
  });
}

export async function markAttemptSubmitted(
  prisma: RegistryChainAttemptPrisma,
  attempt: Pick<
    RegistryChainAttemptRecord,
    "id" | "status" | "metadata" | "recordPda" | "claimToken"
  >,
  input: {
    txSignature?: string | null;
    recordPda?: string | null;
    chainStateSlot?: bigint | number | null;
    receiptDigest?: string | null;
    cluster?: string | null;
    metadata?: Record<string, unknown> | null;
  },
) {
  const data = {
    status: "submitted" as const,
    txSignature: input.txSignature ?? null,
    recordPda: input.recordPda ?? attemptRecordPda(attempt),
    chainStateSlot: input.chainStateSlot ?? null,
    receiptDigest: input.receiptDigest ?? null,
    cluster: input.cluster ?? null,
    ...(input.metadata === undefined
      ? {}
      : {
          metadata: preserveFrozenAttemptMetadata(
            attempt.metadata,
            input.metadata,
          ),
        }),
    errorCode: null as string | null,
    claimToken: null as string | null,
    claimExpiresAt: null as Date | null,
  };
  if (!input.txSignature && input.chainStateSlot === undefined) {
    throw new Error(
      "external_app_registry_chain_attempt_chain_evidence_required",
    );
  }
  if (typeof prisma.externalAppRegistryChainAttempt.updateMany !== "function") {
    throw new Error("external_app_registry_chain_attempt_cas_required");
  }
  let transitioned: { count?: number };
  try {
    transitioned = await prisma.externalAppRegistryChainAttempt.updateMany({
      where: {
        id: attempt.id,
        status: "broadcasting",
        txSignature: null,
        claimToken: attempt.claimToken,
      },
      data,
    });
  } catch {
    throw new Error(
      "external_app_registry_chain_attempt_submission_persistence_failed",
    );
  }
  if (transitioned.count !== 1) {
    throw new Error("external_app_registry_chain_attempt_stale_state");
  }
  Object.assign(attempt, data);
  return attempt;
}

export async function markAttemptFailed(
  prisma: RegistryChainAttemptPrisma,
  attempt: Pick<RegistryChainAttemptRecord, "id">,
  errorCode: string,
) {
  if (typeof prisma.externalAppRegistryChainAttempt.updateMany !== "function") {
    throw new Error("external_app_registry_chain_attempt_cas_required");
  }
  const failed = await prisma.externalAppRegistryChainAttempt.updateMany({
    where: {
      id: attempt.id,
      status: { in: ["quoted", "broadcasting", "submitted"] },
    },
    data: {
      status: "failed",
      errorCode: normalizeAttemptErrorCode(errorCode),
      claimToken: null,
      claimExpiresAt: null,
    },
  });
  if (failed.count !== 1) {
    throw new Error("external_app_registry_chain_attempt_stale_state");
  }
  return failed;
}

export async function markAttemptReconciled(
  prisma: RegistryChainAttemptPrisma,
  attempt: Pick<RegistryChainAttemptRecord, "id">,
) {
  if (typeof prisma.externalAppRegistryChainAttempt.updateMany !== "function") {
    throw new Error("external_app_registry_chain_attempt_cas_required");
  }
  const reconciled = await prisma.externalAppRegistryChainAttempt.updateMany({
    where: { id: attempt.id, status: "submitted" },
    data: {
      status: "reconciled",
      errorCode: null,
      claimToken: null,
      claimExpiresAt: null,
    },
  });
  if (reconciled.count !== 1) {
    throw new Error("external_app_registry_chain_attempt_stale_state");
  }
  return reconciled;
}

export async function reconcileExternalAppRegistryChainAttempt(
  prisma: RegistryChainAttemptPrisma,
  attempt: RegistryChainAttemptRecord,
  chainRegistry?: {
    readback?(
      attempt: RegistryChainAttemptRecord,
    ): Promise<Record<string, unknown> | null>;
  },
): Promise<Awaited<ReturnType<typeof recordExecutionReceipt>> | null> {
  if (attempt.status !== "submitted") {
    return null;
  }
  if (!chainRegistry?.readback) {
    throw new Error("external_app_registry_chain_readback_required");
  }
  const readback = await chainRegistry.readback(attempt);
  if (!readback) {
    throw new Error("external_app_registry_chain_readback_required");
  }
  if (!isFinalizedChainReadback(readback)) {
    throw new Error("external_app_registry_chain_readback_not_finalized");
  }
  const stateClassification = finalizedStateClassification(readback);
  if (!stateClassification) {
    throw new Error(
      "external_app_registry_chain_readback_classification_required",
    );
  }
  if (stateClassification !== "desired_exact") {
    throw new Error(
      stateClassification === "conflict_or_advanced"
        ? "external_app_registry_chain_readback_conflict_requires_repair"
        : `external_app_registry_chain_readback_${stateClassification}`,
    );
  }
  const chainStateSlot = Number(readback.chainStateSlot);
  const readbackRecordPda = stringField(readback.recordPda);
  const expectedRecordPda = attemptRecordPda(attempt);
  if (
    readback.chainStateVerified !== true ||
    !Number.isSafeInteger(chainStateSlot) ||
    chainStateSlot < 0 ||
    !readbackRecordPda ||
    (expectedRecordPda && expectedRecordPda !== readbackRecordPda)
  ) {
    throw new Error(
      "external_app_registry_chain_readback_account_proof_required",
    );
  }
  await assertFinalizedRegistryRecordFresh(prisma, readback);

  const metadata = objectField(attempt.metadata);
  const frozen = objectField(metadata.frozen);
  const targetRef =
    stringField(frozen.targetRef) ?? stringField(metadata.targetRef);
  const receiptBase =
    Object.keys(objectField(frozen.receiptBase)).length > 0
      ? objectField(frozen.receiptBase)
      : objectField(metadata.receiptBase);
  const localRegistration = objectField(metadata.registration);
  const localRotation = objectField(metadata.rotation);
  const registration = objectField(readback.registration);
  const rotation = objectField(readback.rotation);
  const registrationPayload = (
    Object.keys(objectField(frozen.registrationPayload)).length > 0
      ? objectField(frozen.registrationPayload)
      : objectField(localRegistration.payload)
  ) as ExternalAppChainRegistrationPayload;
  const registrationEvidence = objectField(
    registration.evidence,
  ) as ExternalAppRegistryEvidence;
  const rotationPayload =
    Object.keys(objectField(frozen.rotationPayload)).length > 0
      ? objectField(frozen.rotationPayload)
      : objectField(localRotation.payload);
  const rotationEvidence = objectField(
    rotation.evidence,
  ) as ExternalAppRegistryEvidence;
  const hasRegistration = !!(
    registrationPayload.externalAppId &&
    (registrationEvidence.txSignature ||
      (registrationEvidence as any).chainStateVerified === true)
  );
  const hasRotation = !!(
    rotationPayload.externalAppId &&
    (rotationEvidence.txSignature ||
      (rotationEvidence as any).chainStateVerified === true)
  );
  if (!targetRef || !receiptBase || (!hasRegistration && !hasRotation)) {
    throw new Error("external_app_registry_chain_attempt_facts_incomplete");
  }

  const appData =
    Object.keys(objectField(frozen.appData)).length > 0
      ? objectField(frozen.appData)
      : objectField(metadata.appData);
  const receipt = objectField(readback.receipt);
  const receiptEvidence = objectField(
    receipt.evidence,
  ) as ExternalAppRegistryEvidence | null;
  // Receipt-stage and post-rotation receipt attempts require receipt-anchor evidence.
  if (
    (attempt.stage === "receipt" || attempt.receiptDigest) &&
    !receiptEvidence?.txSignature &&
    (receiptEvidence as any)?.chainStateVerified !== true
  ) {
    throw new Error(
      "external_app_registry_chain_attempt_receipt_evidence_required",
    );
  }
  const serverKeyUpsert =
    metadata.serverKeyUpsert ?? frozen.serverKeyUpsert ?? null;
  const previousServerKeyUpdate =
    metadata.previousServerKeyUpdate ?? frozen.previousServerKeyUpdate ?? null;
  const terminalLocalPersist =
    attempt.stage === "receipt" ||
    (attempt.stage === "server_key_rotation" && !!receiptEvidence?.txSignature);
  const durableReadbackMetadata = preserveFrozenAttemptMetadata(
    attempt.metadata,
    metadataWithReadbackEvidence(attempt.metadata, readback),
  );
  const execute = async (
    tx: any,
  ): Promise<{
    applied: boolean;
    receipt: Awaited<ReturnType<typeof recordExecutionReceipt>> | null;
  }> => {
    if (typeof tx.externalAppRegistryChainAttempt?.updateMany !== "function") {
      throw new Error("external_app_registry_chain_attempt_cas_required");
    }
    const claimed = await tx.externalAppRegistryChainAttempt.updateMany({
      where: { id: attempt.id, status: "submitted" },
      data: {
        status: "reconciled",
        recordPda: readbackRecordPda,
        chainStateSlot,
        metadata: durableReadbackMetadata,
        errorCode: null,
        claimToken: null,
        claimExpiresAt: null,
      },
    });
    if (claimed.count !== 1) {
      const current =
        typeof tx.externalAppRegistryChainAttempt.findUnique === "function"
          ? await tx.externalAppRegistryChainAttempt.findUnique({
              where: { id: attempt.id },
              select: { status: true },
            })
          : null;
      if (current?.status === "reconciled") {
        return { applied: false, receipt: null };
      }
      throw new Error("external_app_registry_chain_attempt_stale_state");
    }
    if (terminalLocalPersist) {
      // A finalized receipt is the terminal proof for the same frozen
      // registration/rotation request. Close its submitted prerequisite in the
      // same transaction so a later sweep cannot misclassify the now-advanced
      // account as an unrelated conflict.
      await tx.externalAppRegistryChainAttempt.updateMany({
        where: {
          requestId: attempt.requestId,
          id: { not: attempt.id },
          status: "submitted",
          stage: { in: ["registration", "server_key_rotation"] },
        },
        data: {
          status: "reconciled",
          recordPda: readbackRecordPda,
          chainStateSlot,
          errorCode: null,
          claimToken: null,
          claimExpiresAt: null,
        },
      });
    }
    if (terminalLocalPersist && Object.keys(appData).length > 0) {
      await tx.externalApp.update({ where: { id: targetRef }, data: appData });
      // Match sync persist path: quarantine only on explicit production upgrade.
      if (String(appData.environment || "") === "mainnet_production") {
        await quarantineSandboxCircleBindingsForEnvironmentUpgrade(tx, {
          externalAppId: targetRef,
          authorityNow: new Date(String(receiptBase.executedAt)),
          reason: "app_environment_upgraded_from_registry_reconciliation",
        });
      }
    }
    if (hasRegistration && registrationPayload && registrationEvidence) {
      await upsertExternalAppRegistryAnchor(tx, {
        payload: registrationPayload,
        evidence: registrationEvidence,
        receiptDigest: attempt.receiptDigest ?? undefined,
        receiptEvidence: terminalLocalPersist ? receiptEvidence : null,
        registryStatus: terminalLocalPersist ? "active" : "pending",
      });
    }
    if (hasRotation && rotationPayload && rotationEvidence) {
      if (typeof tx.externalAppRegistryAnchor?.update !== "function") {
        throw new Error("external_app_registry_anchor_update_unavailable");
      }
      await tx.externalAppRegistryAnchor.update({
        where: { externalAppId: String(rotationPayload.externalAppId) },
        data: {
          serverKeyHash: rotationPayload.serverKeyHash,
          decisionDigest: rotationPayload.decisionDigest,
          executionIntentDigest: rotationPayload.executionIntentDigest,
          executionReceiptDigest: attempt.receiptDigest,
          txSignature: rotationEvidence.txSignature,
          receiptTxSignature: receiptEvidence?.txSignature ?? null,
          registryStatus: terminalLocalPersist ? "active" : "pending",
          finalityStatus: chainFinality(readback),
          receiptFinalityStatus: receiptEvidence
            ? chainFinality(readback)
            : "pending",
          cluster: receiptEvidence?.cluster ?? rotationEvidence.cluster ?? null,
        },
      });
    }
    if (terminalLocalPersist && serverKeyUpsert) {
      await tx.externalAppServerKey?.upsert(serverKeyUpsert);
    }
    if (terminalLocalPersist && previousServerKeyUpdate) {
      await tx.externalAppServerKey?.updateMany(previousServerKeyUpdate);
    }
    let receipt: Awaited<ReturnType<typeof recordExecutionReceipt>> | null =
      null;
    if (terminalLocalPersist) {
      receipt = await recordExecutionReceipt(
        createPrismaGovernanceEngineStore(tx),
        {
          ...receiptBase,
          executedAt: new Date(String(receiptBase.executedAt)),
          executionStatus: "executed",
          errorCode: null,
          executionEvidence: null,
        } as any,
      );
    }
    return { applied: true, receipt };
  };
  if (typeof prisma.$transaction !== "function") {
    throw new Error("external_app_registry_chain_attempt_transaction_required");
  }
  const result = await prisma.$transaction(execute);
  if (result.applied) {
    attempt.status = "reconciled";
    attempt.recordPda = readbackRecordPda;
    attempt.chainStateSlot = chainStateSlot;
    attempt.metadata = durableReadbackMetadata;
  }
  return result.receipt;
}

export function createRegistryChainAttemptRecoverySubmitterFromEnv(
  env: NodeJS.ProcessEnv = process.env,
): RegistryChainAttemptRecoverySubmitter {
  return createExternalAppRegistryAdapter(
    loadExternalAppRegistryConfigFromEnv(env),
  );
}

/** Restart recovery: converge submitted or expired broadcasting attempts. */
export async function reconcileSubmittedExternalAppRegistryChainAttempts(
  prisma: RegistryChainAttemptPrisma & {
    externalAppRegistryChainAttempt: {
      findMany(input: unknown): Promise<RegistryChainAttemptRecord[]>;
      findFirst?(input: unknown): Promise<RegistryChainAttemptRecord | null>;
      upsert?(input: unknown): Promise<RegistryChainAttemptRecord>;
      update(input: unknown): Promise<unknown>;
    };
  },
  input?: {
    limit?: number;
    now?: Date;
    chainRegistry?: {
      readback?(
        attempt: RegistryChainAttemptRecord,
      ): Promise<Record<string, unknown> | null>;
    };
    submitter?: RegistryChainAttemptRecoverySubmitter;
  },
): Promise<{ scanned: number; reconciled: number; failed: number }> {
  const limit = Math.max(1, Math.min(Number(input?.limit ?? 20), 100));
  if (typeof prisma.externalAppRegistryChainAttempt.findMany !== "function") {
    return { scanned: 0, reconciled: 0, failed: 0 };
  }
  const recoveryNow = await registryChainRecoveryNow(prisma, input?.now);
  const attempts = await prisma.externalAppRegistryChainAttempt.findMany({
    where: {
      OR: [
        {
          status: "submitted",
          OR: [
            { txSignature: { not: null } },
            { chainStateSlot: { not: null } },
          ],
        },
        {
          status: "broadcasting",
          txSignature: null,
          claimExpiresAt: { lte: recoveryNow },
        },
      ],
    },
    orderBy: { updatedAt: "asc" },
    take: limit,
  });
  const recoveryAttempts = [...attempts];
  const recoveryAttemptIds = new Set(
    recoveryAttempts.map((attempt) => attempt.id),
  );
  const terminalReceiptBarriers = new Set<string>();
  for (const prerequisite of attempts) {
    if (prerequisite.stage === "receipt") continue;
    let sibling = recoveryAttempts.find((candidate) =>
      isExactActiveTerminalReceiptSibling(prerequisite, candidate),
    );
    if (
      !sibling &&
      typeof prisma.externalAppRegistryChainAttempt.findFirst === "function"
    ) {
      const candidate = await prisma.externalAppRegistryChainAttempt.findFirst({
        where: {
          requestId: prerequisite.requestId,
          actionType: prerequisite.actionType,
          stage: "receipt",
          status: { in: ["broadcasting", "submitted"] },
          receiptDigest: { not: null },
        },
        orderBy: { updatedAt: "desc" },
      });
      if (
        candidate &&
        isExactActiveTerminalReceiptSibling(prerequisite, candidate)
      ) {
        sibling = candidate;
      }
    }
    if (!sibling) continue;
    terminalReceiptBarriers.add(registryAttemptRequestActionKey(prerequisite));
    if (!recoveryAttemptIds.has(sibling.id)) {
      recoveryAttempts.push(sibling);
      recoveryAttemptIds.add(sibling.id);
    }
  }
  const orderedAttempts = recoveryAttempts.sort(
    (left, right) =>
      attemptStageRecoveryPriority(right.stage) -
      attemptStageRecoveryPriority(left.stage),
  );
  let reconciled = 0;
  let failed = 0;
  const reconciledRequestIds = new Set<string>();
  for (const attempt of orderedAttempts) {
    if (reconciledRequestIds.has(attempt.requestId)) continue;
    if (
      attempt.stage !== "receipt" &&
      terminalReceiptBarriers.has(registryAttemptRequestActionKey(attempt))
    ) {
      continue;
    }
    try {
      let recoveredReadback: Record<string, unknown> | null = null;
      if (attempt.status === "broadcasting") {
        const claimed = await claimRegistryChainAttemptForBroadcast(
          prisma,
          attempt,
          {},
        );
        if (!claimed) continue;
        if (!input?.chainRegistry?.readback) {
          throw new Error("external_app_registry_chain_readback_required");
        }
        try {
          recoveredReadback = await input.chainRegistry.readback(attempt);
        } catch (error) {
          const code = normalizeAttemptErrorCode(error);
          if (
            attempt.stage === "registration" &&
            code === "external_app_registry_chain_readback_account_missing"
          ) {
            if (
              await rejectExpiredRegistryChainAttemptReplay(
                prisma,
                attempt,
                null,
              )
            ) {
              failed += 1;
              continue;
            }
            await resubmitAndMarkRegistryChainAttempt(
              prisma,
              attempt,
              input.submitter,
            );
            continue;
          }
          if (
            code === "external_app_registry_chain_readback_account_missing" ||
            code === "external_app_registry_chain_readback_record_mismatch"
          ) {
            await markAttemptFailed(
              prisma,
              attempt,
              "external_app_registry_chain_readback_conflict_requires_repair",
            );
            failed += 1;
            continue;
          }
          throw error;
        }
        const stateClassification =
          finalizedStateClassification(recoveredReadback);
        if (
          recoveredReadback &&
          isFinalizedChainReadback(recoveredReadback) &&
          !stateClassification
        ) {
          throw new Error(
            "external_app_registry_chain_readback_classification_required",
          );
        }
        if (stateClassification === "frozen_pre_state") {
          if (attempt.stage === "registration") {
            await markAttemptFailed(
              prisma,
              attempt,
              "external_app_registry_chain_readback_conflict_requires_repair",
            );
            failed += 1;
            continue;
          }
          if (
            await rejectExpiredRegistryChainAttemptReplay(
              prisma,
              attempt,
              recoveredReadback,
            )
          ) {
            failed += 1;
            continue;
          }
          await resubmitAndMarkRegistryChainAttempt(
            prisma,
            attempt,
            input.submitter,
          );
          // The replay is only a new submission. Finalized exact readback on a
          // later sweep remains the sole authority for local reconciliation.
          continue;
        }
        if (
          stateClassification === "account_missing" &&
          attempt.stage === "registration"
        ) {
          if (
            await rejectExpiredRegistryChainAttemptReplay(
              prisma,
              attempt,
              recoveredReadback,
            )
          ) {
            failed += 1;
            continue;
          }
          await resubmitAndMarkRegistryChainAttempt(
            prisma,
            attempt,
            input.submitter,
          );
          continue;
        }
        if (
          stateClassification === "conflict_or_advanced" ||
          stateClassification === "account_missing"
        ) {
          await markAttemptFailed(
            prisma,
            attempt,
            "external_app_registry_chain_readback_conflict_requires_repair",
          );
          failed += 1;
          continue;
        }
        if (
          !recoveredReadback ||
          !isFinalizedChainReadback(recoveredReadback)
        ) {
          throw new Error("external_app_registry_chain_readback_not_finalized");
        }
        const chainStateSlot = Number(recoveredReadback.chainStateSlot);
        const recordPda =
          stringField(recoveredReadback.recordPda) ?? attemptRecordPda(attempt);
        if (
          recoveredReadback.chainStateVerified !== true ||
          !Number.isSafeInteger(chainStateSlot) ||
          chainStateSlot < 0 ||
          !recordPda
        ) {
          throw new Error(
            "external_app_registry_chain_readback_account_proof_required",
          );
        }
        await markAttemptSubmitted(prisma, attempt, {
          recordPda,
          chainStateSlot,
          receiptDigest: attempt.receiptDigest,
          cluster: attempt.cluster,
          metadata: metadataWithReadbackEvidence(
            attempt.metadata,
            recoveredReadback,
          ),
        });
      }
      const terminalReceipt = await reconcileExternalAppRegistryChainAttempt(
        prisma,
        attempt,
        recoveredReadback
          ? { readback: async () => recoveredReadback }
          : input?.chainRegistry,
      );
      reconciled += 1;
      if (terminalReceipt) reconciledRequestIds.add(attempt.requestId);
    } catch (error) {
      failed += 1;
      const code = normalizeAttemptErrorCode(error);
      // A broadcasting recovery owns only a fenced replay lease. Signer/RPC
      // failures and ambiguous chain state stay retryable; never turn them into
      // a terminal local fact and never create a replacement intent.
      if (attempt.status === "broadcasting") {
        continue;
      }
      if (isRegistryChainReadbackRepairRequiredError(code)) {
        try {
          await markAttemptFailed(
            prisma,
            attempt,
            "external_app_registry_chain_readback_conflict_requires_repair",
          );
        } catch {
          // Next sweep can retry the terminal repair mark.
        }
        continue;
      }
      // Transient / incomplete readback must stay retryable.
      // On-chain tx failure is terminal and must not be reused as success evidence.
      if (code === "external_app_registry_chain_readback_tx_failed") {
        try {
          await markAttemptFailed(prisma, attempt, code);
        } catch {
          // Next sweep can retry the failure mark.
        }
        continue;
      }
      if (
        code ===
          "external_app_registry_chain_attempt_receipt_evidence_required" ||
        code === "external_app_registry_chain_attempt_facts_incomplete" ||
        code === "external_app_registry_chain_readback_required" ||
        code === "external_app_registry_chain_readback_not_finalized" ||
        code === "external_app_registry_chain_readback_rpc_required" ||
        code === "external_app_registry_chain_readback_account_missing" ||
        code === "external_app_registry_chain_readback_tx_mismatch" ||
        (code.startsWith("external_app_registry_chain_readback_") &&
          code !== "external_app_registry_chain_readback_tx_failed")
      ) {
        continue;
      }
      try {
        await markAttemptFailed(prisma, attempt, code);
      } catch {
        // Keep submitted for the next sweep if failure persistence itself fails.
      }
    }
  }
  return { scanned: attempts.length, reconciled, failed };
}

async function registryChainRecoveryNow(
  prisma: RegistryChainAttemptPrisma,
  injectedNow?: Date,
): Promise<Date> {
  if (injectedNow) {
    if (process.env.NODE_ENV !== "test") {
      throw new Error(
        "external_app_registry_chain_attempt_injected_clock_test_only",
      );
    }
    return new Date(injectedNow);
  }
  if (typeof prisma.$queryRawUnsafe === "function") {
    const rows = await prisma.$queryRawUnsafe(
      `SELECT clock_timestamp() AS "now"`,
    );
    const value = rows?.[0]?.now;
    const now = value instanceof Date ? value : new Date(String(value ?? ""));
    if (Number.isFinite(now.getTime())) return now;
    throw new Error("external_app_registry_chain_attempt_db_clock_invalid");
  }
  if (process.env.NODE_ENV !== "test") {
    throw new Error("external_app_registry_chain_attempt_db_clock_required");
  }
  return new Date();
}

export function isRegistryChainReadbackRepairRequiredError(
  code: string,
): boolean {
  return (
    code === "external_app_registry_chain_readback_account_missing" ||
    code === "external_app_registry_chain_readback_frozen_pre_state" ||
    code === "external_app_registry_chain_readback_conflict_requires_repair" ||
    code === "external_app_registry_chain_readback_expired_requires_repair"
  );
}

function attemptStageRecoveryPriority(
  stage: RegistryChainAttemptStage,
): number {
  return stage === "receipt" ? 2 : 1;
}

function registryAttemptRequestActionKey(
  attempt: Pick<RegistryChainAttemptRecord, "requestId" | "actionType">,
): string {
  return `${attempt.requestId}\0${attempt.actionType}`;
}

function isExactActiveTerminalReceiptSibling(
  prerequisite: RegistryChainAttemptRecord,
  candidate: RegistryChainAttemptRecord,
): boolean {
  if (
    candidate.stage !== "receipt" ||
    (candidate.status !== "broadcasting" && candidate.status !== "submitted") ||
    candidate.requestId !== prerequisite.requestId ||
    candidate.actionType !== prerequisite.actionType
  ) {
    return false;
  }
  const payload = frozenReceiptPayload(candidate);
  const prerequisiteIntentDigest = normalizedHex32(prerequisite.intentDigest);
  const receiptDigest = normalizedHex32(candidate.receiptDigest);
  const candidateIntentDigest = normalizedHex32(candidate.intentDigest);
  const expectedExecutionIntentDigest = normalizedHex32(
    payload?.expectedExecutionIntentDigest,
  );
  const frozenExecutionReceiptDigest = normalizedHex32(
    payload?.executionReceiptDigest,
  );
  const prerequisiteRecordPda = attemptRecordPda(prerequisite);
  const receiptRecordPda = attemptRecordPda(candidate);
  return !!(
    prerequisiteIntentDigest &&
    receiptDigest &&
    candidateIntentDigest &&
    expectedExecutionIntentDigest === prerequisiteIntentDigest &&
    frozenExecutionReceiptDigest === receiptDigest &&
    candidateIntentDigest === receiptDigest &&
    (!prerequisiteRecordPda ||
      !receiptRecordPda ||
      prerequisiteRecordPda === receiptRecordPda)
  );
}

async function assertFinalizedRegistryRecordFresh(
  prisma: RegistryChainAttemptPrisma,
  readback: Record<string, unknown>,
): Promise<void> {
  const rawExpiresAt = readback.recordExpiresAt;
  if (rawExpiresAt === undefined || rawExpiresAt === null) {
    if (process.env.NODE_ENV === "test") return;
    throw new Error(
      "external_app_registry_chain_readback_expiry_proof_required",
    );
  }
  const expiresAt = decodedInteger(rawExpiresAt);
  if (expiresAt === 0n) return;
  const authorityNow = await registryChainRecoveryNow(prisma);
  if (expiresAt <= BigInt(Math.floor(authorityNow.getTime() / 1000))) {
    throw new Error(
      "external_app_registry_chain_readback_expired_requires_repair",
    );
  }
}

async function rejectExpiredRegistryChainAttemptReplay(
  prisma: RegistryChainAttemptPrisma,
  attempt: RegistryChainAttemptRecord,
  readback: Record<string, unknown> | null,
): Promise<boolean> {
  try {
    if (
      readback &&
      finalizedStateClassification(readback) !== "account_missing"
    ) {
      await assertFinalizedRegistryRecordFresh(prisma, readback);
      return false;
    }
    const metadata = objectField(attempt.metadata);
    const frozen = objectField(metadata.frozen);
    const registrationPayload =
      Object.keys(objectField(frozen.registrationPayload)).length > 0
        ? objectField(frozen.registrationPayload)
        : objectField(objectField(metadata.registration).payload);
    const expiresAt = unixSeconds(registrationPayload.expiresAt);
    if (expiresAt === 0n) return false;
    const authorityNow = await registryChainRecoveryNow(prisma);
    if (expiresAt <= BigInt(Math.floor(authorityNow.getTime() / 1000))) {
      throw new Error(
        "external_app_registry_chain_readback_expired_requires_repair",
      );
    }
    return false;
  } catch (error) {
    const code = normalizeAttemptErrorCode(error);
    if (
      code !== "external_app_registry_chain_readback_expired_requires_repair"
    ) {
      throw error;
    }
    await markAttemptFailed(prisma, attempt, code);
    return true;
  }
}

function finalizedStateClassification(
  readback: Record<string, unknown> | null,
): RegistryChainFinalizedStateClassification | null {
  const value = stringField(readback?.stateClassification);
  return value === "desired_exact" ||
    value === "frozen_pre_state" ||
    value === "conflict_or_advanced" ||
    value === "account_missing"
    ? value
    : null;
}

async function resubmitAndMarkRegistryChainAttempt(
  prisma: RegistryChainAttemptPrisma,
  attempt: RegistryChainAttemptRecord,
  submitter: RegistryChainAttemptRecoverySubmitter | undefined,
): Promise<void> {
  const evidence = await resubmitFrozenRegistryChainAttempt(attempt, submitter);
  await markAttemptSubmitted(prisma, attempt, {
    txSignature: evidence.txSignature,
    recordPda: evidence.recordPda,
    receiptDigest: attempt.receiptDigest,
    cluster: evidence.cluster ?? attempt.cluster,
    metadata: metadataWithResubmissionEvidence(
      attempt.metadata,
      attempt.stage,
      evidence,
    ),
  });
}

async function resubmitFrozenRegistryChainAttempt(
  attempt: RegistryChainAttemptRecord,
  submitter: RegistryChainAttemptRecoverySubmitter | undefined,
): Promise<ExternalAppRegistryEvidence> {
  const frozen = objectField(objectField(attempt.metadata).frozen);
  let evidence: ExternalAppRegistryEvidence;
  if (attempt.stage === "registration") {
    const payload = objectField(
      frozen.registrationPayload,
    ) as ExternalAppChainRegistrationPayload;
    if (!submitter?.anchorExternalAppRegistration || !payload.externalAppId) {
      throw new Error(
        "external_app_registry_chain_attempt_recovery_submitter_required",
      );
    }
    evidence = await submitter.anchorExternalAppRegistration(payload);
  } else if (attempt.stage === "server_key_rotation") {
    const payload = objectField(
      frozen.rotationPayload,
    ) as ExternalAppChainServerKeyRotationPayload;
    if (!submitter?.rotateServerKey || !payload.externalAppId) {
      throw new Error(
        "external_app_registry_chain_attempt_recovery_submitter_required",
      );
    }
    evidence = await submitter.rotateServerKey(payload);
  } else {
    const payload = frozenReceiptPayload(attempt);
    if (!submitter?.anchorExecutionReceipt || !payload) {
      throw new Error(
        "external_app_registry_chain_attempt_recovery_submitter_required",
      );
    }
    evidence = await submitter.anchorExecutionReceipt(payload);
  }
  const txSignature = stringField(evidence.txSignature);
  const recordPda = stringField(evidence.recordPda);
  const expectedRecordPda = attemptRecordPda(attempt);
  if (
    evidence.status !== "submitted" ||
    !txSignature ||
    !recordPda ||
    (expectedRecordPda && recordPda !== expectedRecordPda)
  ) {
    throw new Error(
      "external_app_registry_chain_attempt_recovery_evidence_invalid",
    );
  }
  return { ...evidence, txSignature, recordPda };
}

function frozenReceiptPayload(
  attempt: RegistryChainAttemptRecord,
): ExternalAppChainReceiptPayload | null {
  const metadata = objectField(attempt.metadata);
  const frozen = objectField(metadata.frozen);
  const stored = objectField(frozen.receiptPayload);
  if (Object.keys(stored).length > 0) {
    return stored as ExternalAppChainReceiptPayload;
  }
  // Earlier attempts froze the same immutable components separately. Keep
  // them recoverable without consulting mutable request/application state.
  const rotation =
    Object.keys(objectField(frozen.rotationPayload)).length > 0
      ? objectField(frozen.rotationPayload)
      : objectField(objectField(metadata.rotation).payload);
  const registration =
    Object.keys(objectField(frozen.registrationPayload)).length > 0
      ? objectField(frozen.registrationPayload)
      : objectField(objectField(metadata.registration).payload);
  const source = Object.keys(rotation).length > 0 ? rotation : registration;
  const executionReceiptDigest =
    stringField(frozen.receiptDigest) ?? stringField(attempt.receiptDigest);
  const externalAppId = stringField(source.externalAppId);
  const appIdHash = normalizedHex32(source.appIdHash);
  const expectedDecisionDigest = normalizedHex32(source.decisionDigest);
  const expectedExecutionIntentDigest = normalizedHex32(
    source.executionIntentDigest,
  );
  if (
    !externalAppId ||
    !appIdHash ||
    !expectedDecisionDigest ||
    !expectedExecutionIntentDigest ||
    !normalizedHex32(executionReceiptDigest)
  )
    return null;
  return {
    externalAppId,
    appIdHash,
    expectedDecisionDigest,
    expectedExecutionIntentDigest,
    executionReceiptDigest: executionReceiptDigest!,
  };
}

function metadataWithResubmissionEvidence(
  metadata: Record<string, unknown> | null | undefined,
  stage: RegistryChainAttemptStage,
  evidence: ExternalAppRegistryEvidence,
): Record<string, unknown> {
  const next = { ...objectField(metadata) };
  const key = stage === "server_key_rotation" ? "rotation" : stage;
  next[key] = {
    ...objectField(next[key]),
    evidence,
  };
  return next;
}

function metadataWithReadbackEvidence(
  metadata: Record<string, unknown> | null | undefined,
  readback: Record<string, unknown>,
): Record<string, unknown> {
  const next = { ...objectField(metadata) };
  for (const key of ["registration", "rotation", "receipt"] as const) {
    const evidence = objectField(objectField(readback[key]).evidence);
    if (Object.keys(evidence).length === 0) continue;
    next[key] = {
      ...objectField(next[key]),
      evidence: {
        ...evidence,
        finalityStatus: evidence.status,
        status: "submitted",
      },
    };
  }
  return next;
}

function normalizeAttemptErrorCode(error: unknown): string {
  const raw = error instanceof Error ? error.message : String(error || "");
  if (/^[a-z0-9_]+$/.test(raw)) return raw.slice(0, 96);
  return "external_app_registry_chain_attempt_reconcile_failed";
}

function objectField(value: unknown): Record<string, any> {
  return value && typeof value === "object" && !Array.isArray(value)
    ? (value as Record<string, any>)
    : {};
}

function stringField(value: unknown): string | null {
  const normalized = String(value ?? "").trim();
  return normalized || null;
}

function freezeAttemptMetadata(
  input: Omit<RegistryChainAttemptRecord, "id" | "attemptKey" | "status"> & {
    metadata?: Record<string, unknown> | null;
  },
): Record<string, unknown> | null {
  if (!input.metadata) return null;
  const metadata = { ...input.metadata };
  const receiptBase = objectField(metadata.receiptBase);
  const registration = objectField(metadata.registration);
  const rotation = objectField(metadata.rotation);
  const receipt = objectField(metadata.receipt);
  const receiptPayload =
    input.stage === "receipt"
      ? buildFrozenReceiptPayload(
          Object.keys(objectField(rotation.payload)).length > 0
            ? objectField(rotation.payload)
            : objectField(registration.payload),
          input.receiptDigest,
        )
      : {};
  metadata.frozen = {
    ...objectField(metadata.frozen),
    receiptId: stringField(receiptBase.id),
    decisionDigest: stringField(receiptBase.decisionDigest),
    intentDigest: input.intentDigest,
    receiptDigest: input.receiptDigest ?? null,
    recordPda: chainRecordPda(metadata),
    registrationPayload: objectField(registration.payload),
    registrationEvidence: objectField(registration.evidence),
    rotationPayload: objectField(rotation.payload),
    rotationEvidence: objectField(rotation.evidence),
    receiptPayload,
    receiptEvidence: objectField(receipt.evidence),
    appData: objectField(metadata.appData),
    receiptBase,
    targetRef: stringField(metadata.targetRef),
    serverKeyUpsert: metadata.serverKeyUpsert ?? null,
    previousServerKeyUpdate: metadata.previousServerKeyUpdate ?? null,
  };
  return metadata;
}

function preserveFrozenAttemptMetadata(
  existing: Record<string, unknown> | null | undefined,
  next: Record<string, unknown> | null,
): Record<string, unknown> | null {
  if (!next) return next;
  const frozen = objectField(existing?.frozen);
  const nextFrozen = objectField(next.frozen);
  // First-write wins for chain evidence snapshots.
  return {
    ...next,
    frozen: {
      ...nextFrozen,
      ...frozen,
      receiptDigest: frozen.receiptDigest ?? nextFrozen.receiptDigest ?? null,
      recordPda:
        frozen.recordPda ?? nextFrozen.recordPda ?? chainRecordPda(next),
      registrationPayload:
        Object.keys(objectField(frozen.registrationPayload)).length > 0
          ? frozen.registrationPayload
          : nextFrozen.registrationPayload,
      registrationEvidence:
        Object.keys(objectField(frozen.registrationEvidence)).length > 0
          ? frozen.registrationEvidence
          : nextFrozen.registrationEvidence,
      rotationPayload:
        Object.keys(objectField(frozen.rotationPayload)).length > 0
          ? frozen.rotationPayload
          : nextFrozen.rotationPayload,
      rotationEvidence:
        Object.keys(objectField(frozen.rotationEvidence)).length > 0
          ? frozen.rotationEvidence
          : nextFrozen.rotationEvidence,
      receiptPayload:
        Object.keys(objectField(frozen.receiptPayload)).length > 0
          ? frozen.receiptPayload
          : nextFrozen.receiptPayload,
      receiptEvidence:
        Object.keys(objectField(frozen.receiptEvidence)).length > 0
          ? frozen.receiptEvidence
          : nextFrozen.receiptEvidence,
      // Upserts are often known only after receipt broadcast; allow first non-null win.
      serverKeyUpsert:
        frozen.serverKeyUpsert ?? nextFrozen.serverKeyUpsert ?? null,
      previousServerKeyUpdate:
        frozen.previousServerKeyUpdate ??
        nextFrozen.previousServerKeyUpdate ??
        null,
    },
  };
}

function buildFrozenReceiptPayload(
  source: Record<string, unknown>,
  receiptDigest: string | null | undefined,
): ExternalAppChainReceiptPayload | Record<string, never> {
  const externalAppId = stringField(source.externalAppId);
  const appIdHash = normalizedHex32(source.appIdHash);
  const expectedDecisionDigest = normalizedHex32(source.decisionDigest);
  const expectedExecutionIntentDigest = normalizedHex32(
    source.executionIntentDigest,
  );
  const executionReceiptDigest = normalizedHex32(receiptDigest);
  if (
    !externalAppId ||
    !appIdHash ||
    !expectedDecisionDigest ||
    !expectedExecutionIntentDigest ||
    !executionReceiptDigest
  )
    return {};
  return {
    externalAppId,
    appIdHash,
    expectedDecisionDigest,
    expectedExecutionIntentDigest,
    executionReceiptDigest,
  };
}

function chainRecordPda(metadata: Record<string, unknown>): string | null {
  for (const value of [
    objectField(objectField(metadata.registration).evidence).recordPda,
    objectField(objectField(metadata.rotation).evidence).recordPda,
    objectField(objectField(metadata.receipt).evidence).recordPda,
  ]) {
    const recordPda = stringField(value);
    if (recordPda) return recordPda;
  }
  return null;
}

function attemptRecordPda(
  attempt: Pick<RegistryChainAttemptRecord, "recordPda" | "metadata">,
): string | null {
  return (
    stringField(attempt.recordPda) ??
    chainRecordPda(objectField(attempt.metadata))
  );
}

function deriveRecordPdaFromAttemptMetadata(
  metadata: Record<string, unknown> | null | undefined,
  env: NodeJS.ProcessEnv = process.env,
): string | null {
  const config = loadExternalAppRegistryConfigFromEnv(env);
  if (!config.programId || !metadata) return null;
  const registrationPayload = objectField(
    objectField(metadata.registration).payload,
  );
  const rotationPayload = objectField(objectField(metadata.rotation).payload);
  const payload =
    Object.keys(rotationPayload).length > 0
      ? rotationPayload
      : registrationPayload;
  const appIdHash = normalizedHex32(payload.appIdHash);
  if (!appIdHash) return null;
  return PublicKey.findProgramAddressSync(
    [Buffer.from("external_app"), Buffer.from(appIdHash, "hex")],
    new PublicKey(config.programId),
  )[0].toBase58();
}

function isFinalizedChainReadback(readback: Record<string, unknown>): boolean {
  const status = String(
    readback.status ?? readback.finalityStatus ?? readback.commitment ?? "",
  ).toLowerCase();
  return status === "finalized";
}

function chainFinality(
  readback: Record<string, unknown>,
): "confirmed" | "finalized" {
  return String(
    readback.status ?? readback.finalityStatus ?? readback.commitment,
  ).toLowerCase() === "finalized"
    ? "finalized"
    : "confirmed";
}

/** Authoritative chain readback: finalized signature plus exact finalized account state. */
export function createRegistryChainAttemptReadbackFromEnv(
  env: NodeJS.ProcessEnv = process.env,
  deps?: {
    connection?: {
      getSignatureStatuses(
        signatures: string[],
        config?: { searchTransactionHistory?: boolean },
        signal?: AbortSignal,
      ): Promise<{
        value: Array<{
          err: unknown;
          confirmationStatus?: string | null;
        } | null>;
      }>;
      getAccountInfoAndContext(
        publicKey: PublicKey,
        commitment: "finalized",
        signal?: AbortSignal,
      ): Promise<{
        context: { slot: number };
        value: { data: Buffer; owner: PublicKey } | null;
      }>;
    };
    rpcFetch?: (
      input: Parameters<typeof globalThis.fetch>[0],
      init?: Parameters<typeof globalThis.fetch>[1],
    ) => ReturnType<typeof globalThis.fetch>;
  },
): {
  readback(
    attempt: RegistryChainAttemptRecord,
  ): Promise<Record<string, unknown> | null>;
} {
  const config = loadExternalAppRegistryConfigFromEnv(env);
  const readbackTimeoutMs = registryChainReadbackTimeoutMs(env);
  const hasConnection = !!deps?.connection || !!config.rpcUrl;
  const connectionForSignal = (signal: AbortSignal) => {
    if (deps?.connection) return deps.connection;
    if (!config.rpcUrl) return null;
    const rpcFetch = deps?.rpcFetch ?? globalThis.fetch;
    return new Connection(config.rpcUrl, {
      commitment: "confirmed",
      // web3.js does not expose AbortSignal on these read methods. Bind each
      // per-call controller into its actual HTTP transport instead.
      fetch: ((resource: unknown, init?: Record<string, unknown>) =>
        rpcFetch(resource as any, {
          ...(init as any),
          signal,
        })) as any,
    });
  };
  const programId = config.programId ? new PublicKey(config.programId) : null;
  const coder = programId
    ? new BorshAccountsCoder(loadRegistryReadbackIdl(config.idlPath, programId))
    : null;

  return {
    async readback(attempt) {
      const txSignature = String(attempt.txSignature || "").trim();
      if (!hasConnection) {
        throw new Error("external_app_registry_chain_readback_rpc_required");
      }
      if (!programId || !coder) {
        throw new Error(
          "external_app_registry_chain_readback_program_required",
        );
      }
      let confirmation = "finalized";
      if (txSignature) {
        const statuses = await withRegistryChainReadbackTimeout(
          (signal) =>
            connectionForSignal(signal)!.getSignatureStatuses(
              [txSignature],
              { searchTransactionHistory: true },
              signal,
            ),
          readbackTimeoutMs,
        );
        const txStatus = statuses.value[0];
        if (!txStatus) return null;
        if (txStatus.err) {
          throw new Error("external_app_registry_chain_readback_tx_failed");
        }
        confirmation = String(txStatus.confirmationStatus || "").toLowerCase();
        if (confirmation !== "confirmed" && confirmation !== "finalized") {
          return {
            status: confirmation || "processed",
          };
        }
        // A confirmed transaction is not enough to materialize local state.
        if (confirmation !== "finalized") {
          return { status: confirmation, finalityStatus: confirmation };
        }
      }
      const metadata = objectField(attempt.metadata);
      const frozen = objectField(metadata.frozen);
      // Prefer first-write frozen evidence; never invent from post-hoc mutable fields alone.
      const registrationEvidence =
        Object.keys(objectField(frozen.registrationEvidence)).length > 0
          ? objectField(frozen.registrationEvidence)
          : objectField(objectField(metadata.registration).evidence);
      const rotationEvidence =
        Object.keys(objectField(frozen.rotationEvidence)).length > 0
          ? objectField(frozen.rotationEvidence)
          : objectField(objectField(metadata.rotation).evidence);
      const receiptEvidence =
        Object.keys(objectField(frozen.receiptEvidence)).length > 0
          ? objectField(frozen.receiptEvidence)
          : objectField(objectField(metadata.receipt).evidence);
      const evidenceTx = String(
        registrationEvidence.txSignature ||
          rotationEvidence.txSignature ||
          receiptEvidence.txSignature ||
          "",
      ).trim();
      if (
        evidenceTx &&
        evidenceTx !== txSignature &&
        attempt.stage !== "receipt"
      ) {
        // Receipt-stage attempts may confirm receipt tx while registration evidence keeps prior tx.
        if (
          String(receiptEvidence.txSignature || "").trim() !== txSignature &&
          String(rotationEvidence.txSignature || "").trim() !== txSignature &&
          String(registrationEvidence.txSignature || "").trim() !== txSignature
        ) {
          throw new Error("external_app_registry_chain_readback_tx_mismatch");
        }
      }
      const registrationPayload =
        Object.keys(objectField(frozen.registrationPayload)).length > 0
          ? objectField(frozen.registrationPayload)
          : objectField(objectField(metadata.registration).payload);
      const rotationPayload =
        Object.keys(objectField(frozen.rotationPayload)).length > 0
          ? objectField(frozen.rotationPayload)
          : objectField(objectField(metadata.rotation).payload);
      const expectedPayload =
        Object.keys(rotationPayload).length > 0
          ? rotationPayload
          : registrationPayload;
      const appIdHash = normalizedHex32(expectedPayload.appIdHash);
      if (!appIdHash) {
        throw new Error("external_app_registry_chain_attempt_facts_incomplete");
      }
      const expectedRecordPda = PublicKey.findProgramAddressSync(
        [Buffer.from("external_app"), Buffer.from(appIdHash, "hex")],
        programId,
      )[0];
      const frozenRecordPda =
        stringField(attempt.recordPda) ??
        stringField(frozen.recordPda) ??
        chainRecordPda(metadata);
      if (frozenRecordPda && frozenRecordPda !== expectedRecordPda.toBase58()) {
        throw new Error("external_app_registry_chain_readback_pda_mismatch");
      }
      const accountResponse = await withRegistryChainReadbackTimeout(
        (signal) => {
          const connection = connectionForSignal(signal);
          if (
            !connection ||
            typeof connection.getAccountInfoAndContext !== "function"
          ) {
            throw new Error(
              "external_app_registry_chain_readback_account_rpc_required",
            );
          }
          return connection.getAccountInfoAndContext(
            expectedRecordPda,
            "finalized",
            signal,
          );
        },
        readbackTimeoutMs,
      );
      const account = accountResponse.value;
      if (!account) {
        return {
          status: confirmation,
          finalityStatus: confirmation,
          stateClassification: "account_missing",
          accountAbsenceVerified: true,
          chainStateSlot: accountResponse.context.slot,
          recordPda: expectedRecordPda.toBase58(),
        };
      }
      if (!account.owner.equals(programId)) {
        throw new Error("external_app_registry_chain_readback_owner_mismatch");
      }
      let decoded: Record<string, unknown>;
      try {
        decoded = coder.decodeAny(account.data) as Record<string, unknown>;
      } catch {
        throw new Error(
          "external_app_registry_chain_readback_account_decode_failed",
        );
      }
      const stateClassification = classifyRegistryRecordReadback({
        attempt,
        decoded,
        registrationPayload,
        rotationPayload,
        receiptPayload: objectField(frozenReceiptPayload(attempt)),
        receiptDigest:
          stringField(frozen.receiptDigest) ?? attempt.receiptDigest ?? null,
      });
      const classifiedReadback = {
        status: confirmation,
        finalityStatus: confirmation,
        stateClassification,
        chainStateVerified: true,
        chainStateSlot: accountResponse.context.slot,
        recordPda: expectedRecordPda.toBase58(),
        recordExpiresAt: decodedInteger(
          decoded.expiresAt ?? decoded.expires_at,
        ).toString(),
      };
      if (stateClassification !== "desired_exact") {
        return classifiedReadback;
      }
      const verifiedEvidence = {
        status: confirmation,
        mode: "required",
        recordPda: expectedRecordPda.toBase58(),
        chainStateVerified: true,
        chainStateSlot: accountResponse.context.slot,
      };
      return {
        ...classifiedReadback,
        registration:
          Object.keys(registrationPayload).length > 0
            ? {
                evidence: {
                  ...registrationEvidence,
                  ...verifiedEvidence,
                  ...(registrationEvidence.txSignature
                    ? { txSignature: registrationEvidence.txSignature }
                    : {}),
                  mode: registrationEvidence.mode || verifiedEvidence.mode,
                },
              }
            : undefined,
        rotation:
          Object.keys(rotationPayload).length > 0
            ? {
                evidence: {
                  ...rotationEvidence,
                  ...verifiedEvidence,
                  ...(rotationEvidence.txSignature
                    ? { txSignature: rotationEvidence.txSignature }
                    : {}),
                  mode: rotationEvidence.mode || verifiedEvidence.mode,
                },
              }
            : undefined,
        receipt:
          attempt.stage === "receipt" || !!attempt.receiptDigest
            ? {
                evidence: {
                  ...receiptEvidence,
                  ...verifiedEvidence,
                  ...(receiptEvidence.txSignature
                    ? { txSignature: receiptEvidence.txSignature }
                    : {}),
                  mode: receiptEvidence.mode || verifiedEvidence.mode,
                },
              }
            : undefined,
      };
    },
  };
}

function registryChainReadbackTimeoutMs(env: NodeJS.ProcessEnv): number {
  const raw = env.EXTERNAL_APP_REGISTRY_CHAIN_READBACK_TIMEOUT_MS;
  const timeoutMs = raw === undefined || raw === "" ? 10_000 : Number(raw);
  // The broadcast lease is derived from the signer deadline plus two readback
  // budgets and a persistence margin, so no single bounded RPC can outlive it.
  if (
    !Number.isSafeInteger(timeoutMs) ||
    timeoutMs < 250 ||
    timeoutMs > 20_000
  ) {
    throw new Error("external_app_registry_chain_readback_timeout_invalid");
  }
  return timeoutMs;
}

async function withRegistryChainReadbackTimeout<T>(
  operation: (signal: AbortSignal) => Promise<T>,
  timeoutMs: number,
): Promise<T> {
  const controller = new AbortController();
  let timeout: NodeJS.Timeout | null = null;
  let timedOut = false;
  try {
    return await Promise.race([
      Promise.resolve().then(() => operation(controller.signal)),
      new Promise<never>((_resolve, reject) => {
        timeout = setTimeout(() => {
          timedOut = true;
          controller.abort();
          reject(new Error("external_app_registry_chain_readback_timeout"));
        }, timeoutMs);
      }),
    ]);
  } catch (error) {
    if (timedOut) {
      throw new Error("external_app_registry_chain_readback_timeout");
    }
    throw error;
  } finally {
    if (timeout) clearTimeout(timeout);
  }
}

function loadRegistryReadbackIdl(
  configuredPath: string | undefined,
  programId: PublicKey,
): Idl {
  const idlPath =
    configuredPath ||
    path.resolve(
      __dirname,
      "../../../../../target/idl/external_app_registry.json",
    );
  if (!fs.existsSync(idlPath)) {
    throw new Error("external_app_registry_chain_readback_idl_missing");
  }
  return {
    ...(JSON.parse(fs.readFileSync(idlPath, "utf8")) as Record<
      string,
      unknown
    >),
    address: programId.toBase58(),
  } as Idl;
}

function classifyRegistryRecordReadback(input: {
  attempt: RegistryChainAttemptRecord;
  decoded: Record<string, unknown>;
  registrationPayload: Record<string, unknown>;
  rotationPayload: Record<string, unknown>;
  receiptPayload: Record<string, unknown>;
  receiptDigest: string | null;
}): Exclude<RegistryChainFinalizedStateClassification, "account_missing"> {
  const read = (snake: string, camel: string) =>
    input.decoded[camel] ?? input.decoded[snake];
  const matchesHex = (snake: string, camel: string, expected: unknown) => {
    const expectedHex = normalizedHex32(expected);
    return !!expectedHex && decodedHex32(read(snake, camel)) === expectedHex;
  };
  const expected =
    Object.keys(input.rotationPayload).length > 0
      ? input.rotationPayload
      : input.registrationPayload;
  const expectedAppIdHash =
    input.attempt.stage === "receipt"
      ? input.receiptPayload.appIdHash
      : expected.appIdHash;
  const version = Number(read("version", "version"));
  const status = decodedRegistryStatus(
    read("registry_status", "registryStatus"),
  );
  const expiresAt = decodedInteger(read("expires_at", "expiresAt"));
  const receiptDigest = decodedHex32(
    read("execution_receipt_digest", "executionReceiptDigest"),
  );
  if (
    version !== 2 ||
    status !== "active" ||
    !matchesHex("app_id_hash", "appIdHash", expectedAppIdHash)
  ) {
    return "conflict_or_advanced";
  }

  const registrationStateMatches =
    Object.keys(input.registrationPayload).length > 0 &&
    String(
      (read("owner", "owner") as { toBase58?: () => string })?.toBase58?.() ??
        read("owner", "owner"),
    ) === String(input.registrationPayload.ownerPubkey ?? "") &&
    matchesHex(
      "server_key_hash",
      "serverKeyHash",
      input.registrationPayload.serverKeyHash,
    ) &&
    matchesHex(
      "manifest_hash",
      "manifestHash",
      input.registrationPayload.manifestHashHex,
    ) &&
    matchesHex(
      "owner_assertion_hash",
      "ownerAssertionHash",
      input.registrationPayload.ownerAssertionHash,
    ) &&
    matchesHex(
      "policy_state_digest",
      "policyStateDigest",
      input.registrationPayload.policyStateDigest,
    ) &&
    Number(read("review_circle_id", "reviewCircleId")) ===
      Number(input.registrationPayload.reviewCircleId) &&
    matchesHex(
      "review_policy_digest",
      "reviewPolicyDigest",
      input.registrationPayload.reviewPolicyDigest,
    ) &&
    matchesHex(
      "decision_digest",
      "decisionDigest",
      input.registrationPayload.decisionDigest,
    ) &&
    matchesHex(
      "execution_intent_digest",
      "executionIntentDigest",
      input.registrationPayload.executionIntentDigest,
    ) &&
    expiresAt === unixSeconds(input.registrationPayload.expiresAt);

  const rotationStateMatches =
    Object.keys(input.rotationPayload).length > 0 &&
    matchesHex(
      "server_key_hash",
      "serverKeyHash",
      input.rotationPayload.serverKeyHash,
    ) &&
    matchesHex(
      "decision_digest",
      "decisionDigest",
      input.rotationPayload.decisionDigest,
    ) &&
    matchesHex(
      "execution_intent_digest",
      "executionIntentDigest",
      input.rotationPayload.executionIntentDigest,
    );

  if (input.attempt.stage === "registration") {
    if (!registrationStateMatches || receiptDigest !== null) {
      return "conflict_or_advanced";
    }
    return "desired_exact";
  } else if (input.attempt.stage === "server_key_rotation") {
    const completeDesired = rotationStateMatches && receiptDigest === null;
    if (completeDesired) return "desired_exact";
    const exactPreState =
      matchesHex(
        "server_key_hash",
        "serverKeyHash",
        input.rotationPayload.expectedServerKeyHash,
      ) &&
      matchesHex(
        "decision_digest",
        "decisionDigest",
        input.rotationPayload.expectedDecisionDigest,
      ) &&
      matchesHex(
        "execution_intent_digest",
        "executionIntentDigest",
        input.rotationPayload.expectedExecutionIntentDigest,
      );
    return exactPreState ? "frozen_pre_state" : "conflict_or_advanced";
  }
  const exactReceiptOwner =
    matchesHex(
      "decision_digest",
      "decisionDigest",
      input.receiptPayload.expectedDecisionDigest,
    ) &&
    matchesHex(
      "execution_intent_digest",
      "executionIntentDigest",
      input.receiptPayload.expectedExecutionIntentDigest,
    );
  const frozenReceiptDigest = normalizedHex32(
    input.receiptPayload.executionReceiptDigest,
  );
  const exactEffectState =
    Object.keys(input.rotationPayload).length > 0
      ? rotationStateMatches
      : registrationStateMatches;
  if (
    exactEffectState &&
    exactReceiptOwner &&
    frozenReceiptDigest === normalizedHex32(input.receiptDigest) &&
    receiptDigest === frozenReceiptDigest
  ) {
    return "desired_exact";
  }
  return exactEffectState && exactReceiptOwner && receiptDigest === null
    ? "frozen_pre_state"
    : "conflict_or_advanced";
}

function normalizedHex32(value: unknown): string | null {
  const normalized = String(value ?? "")
    .trim()
    .toLowerCase();
  return /^[0-9a-f]{64}$/.test(normalized) ? normalized : null;
}

function decodedHex32(value: unknown): string | null {
  if (Buffer.isBuffer(value)) return value.toString("hex");
  if (value instanceof Uint8Array) return Buffer.from(value).toString("hex");
  if (Array.isArray(value)) return Buffer.from(value).toString("hex");
  return normalizedHex32(value);
}

function decodedRegistryStatus(value: unknown): string | null {
  if (typeof value === "string") return value.toLowerCase();
  const key =
    value && typeof value === "object"
      ? Object.keys(value as Record<string, unknown>)[0]
      : null;
  return key ? key.toLowerCase() : null;
}

function decodedInteger(value: unknown): bigint {
  if (typeof value === "bigint") return value;
  if (typeof value === "number") return BigInt(value);
  if (
    value &&
    typeof (value as { toString?: () => string }).toString === "function"
  ) {
    return BigInt((value as { toString(): string }).toString());
  }
  throw new Error("external_app_registry_chain_readback_account_decode_failed");
}

function unixSeconds(value: unknown): bigint {
  if (value === undefined || value === null || value === "") return 0n;
  if (typeof value === "number") return BigInt(Math.floor(value));
  if (value instanceof Date) return BigInt(Math.floor(value.getTime() / 1000));
  const timestamp = new Date(String(value)).getTime();
  if (!Number.isFinite(timestamp)) {
    throw new Error("external_app_registry_chain_readback_record_mismatch");
  }
  return BigInt(Math.floor(timestamp / 1000));
}

async function upsertExternalAppRegistryAnchor(
  prisma: {
    externalAppRegistryAnchor?: {
      upsert(input: unknown): Promise<unknown>;
    };
  },
  input: {
    payload: ExternalAppChainRegistrationPayload;
    evidence: ExternalAppRegistryEvidence;
    receiptDigest?: string;
    receiptEvidence?: ExternalAppRegistryEvidence | null;
    registryStatus: string;
  },
) {
  if (!prisma.externalAppRegistryAnchor) {
    throw new Error("external_app_registry_anchor_upsert_unavailable");
  }
  const data = {
    externalAppId: input.payload.externalAppId,
    appIdHash: input.payload.appIdHash,
    recordPda: input.evidence.recordPda || input.payload.appIdHash,
    ownerPubkey: input.payload.ownerPubkey,
    serverKeyHash: input.payload.serverKeyHash,
    manifestHash: input.payload.manifestHashHex,
    ownerAssertionHash: input.payload.ownerAssertionHash,
    policyStateDigest: input.payload.policyStateDigest,
    reviewCircleId: input.payload.reviewCircleId,
    reviewPolicyDigest: input.payload.reviewPolicyDigest,
    decisionDigest: input.payload.decisionDigest,
    executionIntentDigest: input.payload.executionIntentDigest,
    executionReceiptDigest: input.receiptDigest,
    registryStatus: input.registryStatus,
    txSignature: input.evidence.txSignature,
    cluster: input.evidence.cluster,
    // This helper is only called after reconcileExternalAppRegistryChainAttempt
    // has rejected every non-finalized readback. Persist the authority level
    // actually proved by that gate; do not downgrade it to "confirmed".
    finalityStatus: "finalized",
    receiptTxSignature: input.receiptEvidence?.txSignature,
    receiptFinalityStatus: input.receiptEvidence ? "finalized" : "pending",
  };
  await prisma.externalAppRegistryAnchor.upsert({
    where: { appIdHash: input.payload.appIdHash },
    create: {
      id: `external_app_registry:${input.payload.externalAppId}`,
      ...data,
    },
    update: data,
  });
}
