import crypto from "crypto";

import { Prisma, type PrismaClient } from "@prisma/client";

import { canonicalSolanaPublicKeyString } from "../identity/solanaPublicKey";
import type { GovernanceStrategyResult } from "./strategies/types";
import {
  buildNativeGovernanceCaseForRequest,
  type GovernanceCaseRecord,
  type NativeGovernanceCaseTemplate,
} from './governanceCase';
import { initialGovernanceCaseWorkflowData } from './governanceCaseWorkflow';
import { hashCanonicalGovernanceValue } from './canonicalCodec';
import {
  evaluateFrozenNativeGovernanceMechanism,
  resolveFrozenNativeGovernanceMechanism,
} from './nativeGovernanceMechanism';
import { isCurrentGovernanceCaseFrozenEvidencePolicy } from './governanceEvidenceShare';
import {
  resolveGovernanceCaseBlockerContract,
  type GovernanceCaseBlockerCode,
} from './governanceCaseBlocker';

export type GovernanceDecisionValue =
  | "accepted"
  | "rejected"
  | "expired"
  | "cancelled";

export const GOVERNANCE_REQUEST_DEFAULT_TTL_SECONDS = 72 * 60 * 60;

export interface GovernanceDecisionInput {
  requestId: string;
  envelopeVersion?: 2 | null;
  requestDigest?: string | null;
  payloadDigest?: string | null;
  policyDigest?: string | null;
  snapshotDigest?: string | null;
  decision: GovernanceDecisionValue;
  reason: string;
  tally: Record<string, unknown>;
  decidedAt: string;
  executableFrom: string | null;
  executableUntil: string | null;
  executionMode?: "legacy_action_checkpoint" | "stage_decision_only" | "provider_bound_action" | null;
  executionModeDigest?: string | null;
  compatibilityBundleVersion?: string | null;
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
  creditBudget?: number | null;
}

export interface GovernanceRequestRecord {
  id: string;
  homeIdentityBindingId?: string | null;
  invocationId?: string | null;
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
  executionMode?: "legacy_action_checkpoint" | "stage_decision_only" | "provider_bound_action" | null;
  caseRef?: string | null;
  stageRef?: string | null;
  compatibilityBundleVersion?: string | null;
  executionModeDigest?: string | null;
  executionAuthorizationStatus?: string | null;
  executionAuthorizationReason?: string | null;
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
  envelopeVersion?: number | null;
  envelopeDomain?: string | null;
  envelopeNetwork?: string | null;
  walletSignalNonce?: string | null;
  envelopeExpiresAt?: Date | null;
  payloadDigest?: string | null;
  policyDigest?: string | null;
  snapshotDigest?: string | null;
  envelopeDigest?: string | null;
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
  decisionDigest?: string | null;
  idempotencyKey: string;
  executionMode?: "legacy_action_checkpoint" | "stage_decision_only" | "provider_bound_action" | null;
  executionModeDigest?: string | null;
  compatibilityBundleVersion?: string | null;
  executionEvidence?: Record<string, unknown> | null;
  executionEvidenceDigest?: string | null;
  executedAt: Date;
}

export interface GovernanceExecutionCaseBlockerInput {
  code: GovernanceCaseBlockerCode;
}

export interface GovernanceEngineStore {
  getExecutionReceiptByMarker(input: {
    requestId: string;
    executorModule: string;
    idempotencyKey: string;
  }): Promise<GovernanceExecutionReceiptRecord | null>;
  saveExecutionReceipt(
    receipt: GovernanceExecutionReceiptRecord,
    caseBlocker?: GovernanceExecutionCaseBlockerInput | null,
  ): Promise<GovernanceExecutionReceiptRecord>;
  ensureExecutionCaseBlocker?(
    receipt: GovernanceExecutionReceiptRecord,
    caseBlocker: GovernanceExecutionCaseBlockerInput,
  ): Promise<void>;
}

export interface GovernanceRequestStore {
  openRequestWithSnapshot(
    request: GovernanceRequestRecord,
    snapshot: GovernanceSnapshotRecord,
    governanceCase?: GovernanceCaseRecord | null,
  ): Promise<{
    request: GovernanceRequestRecord;
    snapshot: GovernanceSnapshotRecord;
  }>;
  saveSignal(signal: GovernanceSignalRecord): Promise<GovernanceSignalRecord>;
}

function canonicalizeGovernanceEligibleActors(
  actors: GovernanceEligibleActor[],
): GovernanceEligibleActor[] {
  return actors.map((actor) => {
    const pubkey = canonicalSolanaPublicKeyString(actor.pubkey);
    if (!pubkey) {
      throw new Error("invalid_governance_snapshot_actor_pubkey");
    }
    return { ...actor, pubkey };
  });
}

function canonicalizeGovernanceSignalActor(
  actorPubkey: string | null | undefined,
): string | null | undefined {
  if (actorPubkey == null) return actorPubkey;
  const canonical = canonicalSolanaPublicKeyString(actorPubkey);
  if (!canonical) {
    throw new Error("invalid_governance_signal_actor_pubkey");
  }
  return canonical;
}

type GovernancePrisma = Pick<
  PrismaClient,
  "governanceExecutionReceipt" | "governanceCase" | "governanceCaseBlocker"
> & {
  $transaction?: <T>(operation: (tx: GovernancePrisma) => Promise<T>) => Promise<T>;
};

export function createPrismaGovernanceEngineStore(
  prisma: GovernancePrisma,
): GovernanceEngineStore {
  return {
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
    async saveExecutionReceipt(receipt, caseBlocker) {
      const persist = async (client: GovernancePrisma) => {
        const saved = await client.governanceExecutionReceipt.create({
          data: {
            id: receipt.id,
            requestId: receipt.requestId,
            actionType: receipt.actionType,
            executorModule: receipt.executorModule,
            executionStatus: receipt.executionStatus,
            executionRef: receipt.executionRef ?? null,
            errorCode: receipt.errorCode ?? null,
            decisionDigest: receipt.decisionDigest ?? null,
            idempotencyKey: receipt.idempotencyKey,
            executionMode: receipt.executionMode ?? null,
            executionModeDigest: receipt.executionModeDigest ?? null,
            compatibilityBundleVersion: receipt.compatibilityBundleVersion ?? null,
            executionEvidence: receipt.executionEvidence
              ? receipt.executionEvidence as Prisma.InputJsonValue
              : Prisma.DbNull,
            executionEvidenceDigest: receipt.executionEvidenceDigest ?? null,
            executedAt: receipt.executedAt,
          },
        }) as GovernanceExecutionReceiptRecord;
        if (caseBlocker) {
          await persistGovernanceExecutionCaseBlocker(client, saved, caseBlocker);
        }
        return saved;
      };
      if (caseBlocker) {
        if (typeof prisma.$transaction !== "function") {
          throw new Error("governance_case_blocker_atomic_transaction_required");
        }
        return prisma.$transaction((tx) => persist(tx));
      }
      return persist(prisma);
    },
    async ensureExecutionCaseBlocker(receipt, caseBlocker) {
      const persist = (client: GovernancePrisma) =>
        persistGovernanceExecutionCaseBlocker(client, receipt, caseBlocker);
      if (typeof prisma.$transaction === "function") {
        await prisma.$transaction((tx) => persist(tx));
        return;
      }
      await persist(prisma);
    },
  };
}

async function persistGovernanceExecutionCaseBlocker(
  prisma: GovernancePrisma,
  receipt: GovernanceExecutionReceiptRecord,
  blocker: GovernanceExecutionCaseBlockerInput,
): Promise<void> {
  const contract = resolveGovernanceCaseBlockerContract(blocker.code, receipt.errorCode);
  if (receipt.executionStatus !== "failed" || !contract) {
    throw new Error("governance_case_blocker_execution_fact_mismatch");
  }
  const governanceCase = await prisma.governanceCase.findUnique({
    where: { primaryRequestId: receipt.requestId },
    select: {
      id: true,
      primaryRequestId: true,
      primaryRequest: {
        select: {
          state: true,
          decision: { select: { decision: true, decisionDigest: true } },
        },
      },
    },
  });
  if (
    !governanceCase
    || governanceCase.primaryRequestId !== receipt.requestId
    || governanceCase.primaryRequest?.state !== "accepted"
    || governanceCase.primaryRequest?.decision?.decision !== "accepted"
    || governanceCase.primaryRequest?.decision?.decisionDigest !== receipt.decisionDigest
  ) {
    throw new Error("governance_case_blocker_accepted_decision_required");
  }
  const scopeRef = `execution-receipt:${receipt.id}`;
  const id = `case-blocker:${hashCanonicalGovernanceValue(
    "alcheme.governance.case-blocker-id",
    { caseId: governanceCase.id, code: blocker.code, scopeRef },
  )}`;
  const facts = {
    id,
    caseId: governanceCase.id,
    code: blocker.code,
    scope: "execution",
    scopeRef,
    status: "open",
    owner: "original_decision_authority",
    sla: "governed_resolution_required_no_implicit_deadline",
    resumeState: contract.resumeState,
    resolutionRequirement: contract.resolutionRequirement,
    evidenceReceiptId: receipt.id,
    openedAt: receipt.executedAt,
    closedAt: null,
  };
  const persisted = await prisma.governanceCaseBlocker.upsert({
    where: {
      caseId_code_scopeRef: {
        caseId: governanceCase.id,
        code: blocker.code,
        scopeRef,
      },
    },
    create: facts,
    update: {},
  });
  if (
    persisted.id !== facts.id
    || persisted.caseId !== facts.caseId
    || persisted.code !== facts.code
    || persisted.scope !== facts.scope
    || persisted.scopeRef !== facts.scopeRef
    || persisted.status !== facts.status
    || persisted.owner !== facts.owner
    || persisted.sla !== facts.sla
    || persisted.resumeState !== facts.resumeState
    || persisted.resolutionRequirement !== facts.resolutionRequirement
    || persisted.evidenceReceiptId !== facts.evidenceReceiptId
    || persisted.openedAt.getTime() !== facts.openedAt.getTime()
    || persisted.closedAt !== null
  ) {
    throw new Error("governance_case_blocker_replay_mismatch");
  }
}


type GovernanceRequestPrisma = Pick<
  PrismaClient,
  "governanceRequest" | "governanceSnapshot" | "governanceSignal" | "governanceCase"
> & {
  $transaction?: <T>(
    operation: (tx: GovernanceRequestPrisma) => Promise<T>,
    options?: { maxWait?: number; timeout?: number },
  ) => Promise<T>;
};

export function createPrismaGovernanceRequestStore(
  prisma: GovernanceRequestPrisma,
): GovernanceRequestStore {
  return {
    async openRequestWithSnapshot(request, snapshot, governanceCase) {
      const eligibleActors = canonicalizeGovernanceEligibleActors(
        snapshot.eligibleActors,
      );
      const canonicalSnapshot = { ...snapshot, eligibleActors };
      const persist = (client: GovernanceRequestPrisma) =>
        persistGovernanceRequestWithSnapshot(
          client,
          request,
          canonicalSnapshot,
          governanceCase ?? null,
        );
      if (typeof prisma.$transaction !== "function") return persist(prisma);
      try {
        return await prisma.$transaction((tx) => persist(tx), {
          maxWait: 5_000,
          timeout: 15_000,
        });
      } catch (error) {
        if (!isUniqueConstraintError(error)) throw error;
        return persist(prisma);
      }
    },
    async saveSignal(signal) {
      const actorPubkey = canonicalizeGovernanceSignalActor(signal.actorPubkey);
      const canonicalSignal = { ...signal, actorPubkey };
      try {
        return await prisma.governanceSignal.create({
          data: {
            id: signal.id,
            requestId: signal.requestId,
            signalType: signal.signalType,
            actorPubkey: actorPubkey ?? null,
            value: signal.value,
            weight: signal.weight,
            evidence: signal.evidence
              ? (signal.evidence as Prisma.InputJsonValue)
              : undefined,
            signature: signal.signature ?? null,
            signedMessage: signal.signedMessage ?? null,
            externalClaimNonce: signal.externalClaimNonce ?? null,
            envelopeVersion: signal.envelopeVersion ?? null,
            envelopeDomain: signal.envelopeDomain ?? null,
            envelopeNetwork: signal.envelopeNetwork ?? null,
            walletSignalNonce: signal.walletSignalNonce ?? null,
            envelopeExpiresAt: signal.envelopeExpiresAt ?? null,
            payloadDigest: signal.payloadDigest ?? null,
            policyDigest: signal.policyDigest ?? null,
            snapshotDigest: signal.snapshotDigest ?? null,
            envelopeDigest: signal.envelopeDigest ?? null,
            createdAt: signal.createdAt,
          },
        }) as GovernanceSignalRecord;
      } catch (error) {
        if (!isUniqueConstraintError(error)) throw error;
        const existing = await findExistingGovernanceSignal(
          prisma,
          canonicalSignal,
        );
        if (!existing) throw error;
        if (!governanceSignalsRepresentSameDelivery(existing, canonicalSignal)) {
          throw new Error("governance_signal_duplicate_mismatch");
        }
        return existing;
      }
    },
  };
}

async function findExistingGovernanceSignal(
  prisma: GovernanceRequestPrisma,
  signal: GovernanceSignalRecord,
): Promise<GovernanceSignalRecord | null> {
  if (signal.actorPubkey != null) {
    return prisma.governanceSignal.findUnique({
      where: {
        requestId_actorPubkey_signalType: {
          requestId: signal.requestId,
          actorPubkey: signal.actorPubkey,
          signalType: signal.signalType,
        },
      },
    }) as Promise<GovernanceSignalRecord | null>;
  }
  if (signal.externalClaimNonce) {
    return prisma.governanceSignal.findUnique({
      where: { externalClaimNonce: signal.externalClaimNonce },
    }) as Promise<GovernanceSignalRecord | null>;
  }
  return null;
}

function governanceSignalsRepresentSameDelivery(
  left: GovernanceSignalRecord,
  right: GovernanceSignalRecord,
): boolean {
  return stableJsonStringify({
    requestId: left.requestId,
    signalType: left.signalType,
    actorPubkey: left.actorPubkey ?? null,
    value: left.value,
    weight: left.weight,
    evidence: left.evidence ?? null,
    signature: left.signature ?? null,
    signedMessage: left.signedMessage ?? null,
    externalClaimNonce: left.externalClaimNonce ?? null,
    envelopeVersion: left.envelopeVersion ?? null,
    envelopeDomain: left.envelopeDomain ?? null,
    envelopeNetwork: left.envelopeNetwork ?? null,
    walletSignalNonce: left.walletSignalNonce ?? null,
    envelopeExpiresAt: left.envelopeExpiresAt?.toISOString() ?? null,
    payloadDigest: left.payloadDigest ?? null,
    policyDigest: left.policyDigest ?? null,
    snapshotDigest: left.snapshotDigest ?? null,
    envelopeDigest: left.envelopeDigest ?? null,
  }) === stableJsonStringify({
    requestId: right.requestId,
    signalType: right.signalType,
    actorPubkey: right.actorPubkey ?? null,
    value: right.value,
    weight: right.weight,
    evidence: right.evidence ?? null,
    signature: right.signature ?? null,
    signedMessage: right.signedMessage ?? null,
    externalClaimNonce: right.externalClaimNonce ?? null,
    envelopeVersion: right.envelopeVersion ?? null,
    envelopeDomain: right.envelopeDomain ?? null,
    envelopeNetwork: right.envelopeNetwork ?? null,
    walletSignalNonce: right.walletSignalNonce ?? null,
    envelopeExpiresAt: right.envelopeExpiresAt?.toISOString() ?? null,
    payloadDigest: right.payloadDigest ?? null,
    policyDigest: right.policyDigest ?? null,
    snapshotDigest: right.snapshotDigest ?? null,
    envelopeDigest: right.envelopeDigest ?? null,
  });
}

async function persistGovernanceRequestWithSnapshot(
  prisma: GovernanceRequestPrisma,
  request: GovernanceRequestRecord,
  snapshot: GovernanceSnapshotRecord,
  governanceCase: GovernanceCaseRecord | null,
): Promise<{
  request: GovernanceRequestRecord;
  snapshot: GovernanceSnapshotRecord;
}> {
  const findFirst = (prisma.governanceRequest as any).findFirst;
  const existing = typeof findFirst === "function"
    ? await findFirst.call(prisma.governanceRequest, {
        where: {
          OR: [
            { id: request.id },
            {
              scopeType: request.scopeType,
              scopeRef: request.scopeRef,
              actionType: request.actionType,
              idempotencyKey: request.idempotencyKey,
            },
          ],
        },
        include: { snapshot: true, governanceCase: true },
      })
    : null;
  if (existing) {
    return resolveExistingGovernanceRequestPair(
      existing,
      request,
      snapshot,
      governanceCase,
    );
  }
  const savedRequest = await prisma.governanceRequest.create({
    data: {
      id: request.id,
      homeIdentityBindingId: request.homeIdentityBindingId ?? null,
      invocationId: request.invocationId ?? null,
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
      executionMode: request.executionMode ?? null,
      caseRef: request.caseRef ?? null,
      stageRef: request.stageRef ?? null,
      compatibilityBundleVersion: request.compatibilityBundleVersion ?? null,
      executionModeDigest: request.executionModeDigest ?? null,
      executionAuthorizationStatus: request.executionAuthorizationStatus ?? null,
      executionAuthorizationReason: request.executionAuthorizationReason ?? null,
      state: request.state,
      openedAt: request.openedAt,
      expiresAt: request.expiresAt ?? null,
      resolvedAt: request.resolvedAt ?? null,
    },
  }) as unknown as GovernanceRequestRecord;
  const savedSnapshot = await prisma.governanceSnapshot.create({
    data: {
      id: snapshot.id,
      requestId: snapshot.requestId,
      eligibleActors: snapshot.eligibleActors as unknown as Prisma.InputJsonValue,
      sourceDigest: snapshot.sourceDigest,
      createdAt: snapshot.createdAt,
    },
  }) as unknown as GovernanceSnapshotRecord;
  if (governanceCase) {
    await prisma.governanceCase.create({
      data: {
        id: governanceCase.id,
        homeIdentityBindingId: governanceCase.homeIdentityBindingId,
        primaryRequestId: governanceCase.primaryRequestId,
        invocationId: governanceCase.invocationId,
        originKind: governanceCase.originKind,
        originRef: governanceCase.originRef,
        subjectType: governanceCase.subjectType,
        subjectRef: governanceCase.subjectRef,
        title: governanceCase.title,
        requestedDecision: governanceCase.requestedDecision,
        requestedActionPayload: request.payload as Prisma.InputJsonValue,
        caseType: governanceCase.caseType,
        templateSelection: governanceCase.templateSelection as unknown as Prisma.InputJsonValue,
        templateSelectionDigest: governanceCase.templateSelectionDigest,
        profileBindingId: governanceCase.profileBindingId,
        actionContractVersionId: governanceCase.actionContractVersionId,
        decisionStagePlan: governanceCase.decisionStagePlan
          ? governanceCase.decisionStagePlan as Prisma.InputJsonValue
          : Prisma.DbNull,
        decisionStagePlanDigest: governanceCase.decisionStagePlanDigest ?? null,
        decisionOutcome: governanceCase.decisionOutcome ?? null,
        ...initialGovernanceCaseWorkflowData({
          caseId: governanceCase.id,
          phase: governanceCase.casePhase,
          coordinatorPubkey: governanceCase.openedByPubkey ?? request.proposerPubkey,
          openedAt: governanceCase.openedAt,
        }),
        idempotencyKey: governanceCase.idempotencyKey,
        openedByPubkey: governanceCase.openedByPubkey,
        sourceMessageIds: governanceCase.sourceMessageIds,
        sourceUrl: governanceCase.sourceUrl,
        openedAt: governanceCase.openedAt,
      },
    });
  }
  return { request: savedRequest, snapshot: savedSnapshot };
}

function resolveExistingGovernanceRequestPair(
  existing: GovernanceRequestRecord & {
    snapshot?: GovernanceSnapshotRecord | null;
    governanceCase?: GovernanceCaseRecord | null;
  },
  request: GovernanceRequestRecord,
  snapshot: GovernanceSnapshotRecord,
  governanceCase: GovernanceCaseRecord | null,
): {
  request: GovernanceRequestRecord;
  snapshot: GovernanceSnapshotRecord;
} {
  if (!existing.snapshot) {
    throw new Error("governance_request_snapshot_missing");
  }
  if (governanceCase && existing.governanceCase?.id !== governanceCase.id) {
    throw new Error("governance_request_case_missing");
  }
  if (!governanceRequestImmutableFieldsEqual(existing, request)) {
    throw new Error("governance_request_immutable_mismatch");
  }
  if (
    existing.snapshot.id !== snapshot.id
    || existing.snapshot.requestId !== snapshot.requestId
    || existing.snapshot.sourceDigest !== snapshot.sourceDigest
    || stableJsonStringify(existing.snapshot.eligibleActors)
      !== stableJsonStringify(snapshot.eligibleActors)
    || dateTime(existing.snapshot.createdAt) !== dateTime(snapshot.createdAt)
  ) {
    throw new Error("governance_request_snapshot_mismatch");
  }
  return { request: existing, snapshot: existing.snapshot };
}

function governanceRequestImmutableFieldsEqual(
  left: GovernanceRequestRecord,
  right: GovernanceRequestRecord,
): boolean {
  return stableJsonStringify({
    id: left.id,
    homeIdentityBindingId: left.homeIdentityBindingId ?? null,
    invocationId: left.invocationId ?? null,
    policyId: left.policyId,
    policyVersionId: left.policyVersionId,
    policyVersion: left.policyVersion,
    ruleId: left.ruleId,
    scopeType: left.scopeType,
    scopeRef: left.scopeRef,
    actionType: left.actionType,
    targetType: left.targetType,
    targetRef: left.targetRef,
    payload: left.payload,
    idempotencyKey: left.idempotencyKey,
    proposerPubkey: left.proposerPubkey,
    executionMode: left.executionMode ?? null,
    caseRef: left.caseRef ?? null,
    stageRef: left.stageRef ?? null,
    compatibilityBundleVersion: left.compatibilityBundleVersion ?? null,
    executionModeDigest: left.executionModeDigest ?? null,
    executionAuthorizationStatus: left.executionAuthorizationStatus ?? null,
    executionAuthorizationReason: left.executionAuthorizationReason ?? null,
    openedAt: dateTime(left.openedAt),
    expiresAt: dateTime(left.expiresAt),
  }) === stableJsonStringify({
    id: right.id,
    homeIdentityBindingId: right.homeIdentityBindingId ?? null,
    invocationId: right.invocationId ?? null,
    policyId: right.policyId,
    policyVersionId: right.policyVersionId,
    policyVersion: right.policyVersion,
    ruleId: right.ruleId,
    scopeType: right.scopeType,
    scopeRef: right.scopeRef,
    actionType: right.actionType,
    targetType: right.targetType,
    targetRef: right.targetRef,
    payload: right.payload,
    idempotencyKey: right.idempotencyKey,
    proposerPubkey: right.proposerPubkey,
    executionMode: right.executionMode ?? null,
    caseRef: right.caseRef ?? null,
    stageRef: right.stageRef ?? null,
    compatibilityBundleVersion: right.compatibilityBundleVersion ?? null,
    executionModeDigest: right.executionModeDigest ?? null,
    executionAuthorizationStatus: right.executionAuthorizationStatus ?? null,
    executionAuthorizationReason: right.executionAuthorizationReason ?? null,
    openedAt: dateTime(right.openedAt),
    expiresAt: dateTime(right.expiresAt),
  });
}

function dateTime(value: Date | string | null | undefined): string | null {
  if (value == null) return null;
  const parsed = value instanceof Date ? value : new Date(value);
  return Number.isNaN(parsed.getTime()) ? null : parsed.toISOString();
}

export function computeGovernanceDecisionDigest(
  input: GovernanceDecisionInput,
): string {
  return crypto
    .createHash("sha256")
    .update(stableJsonStringify(input))
    .digest("hex");
}

export function computeGovernanceDecisionEnvelopeV2Digests(request: any): {
  envelopeVersion: 2;
  requestDigest: string;
  payloadDigest: string;
  policyDigest: string;
  snapshotDigest: string;
} {
  const payloadDigest = hashCanonicalGovernanceValue(
    "alcheme.governance.action-payload",
    asRecord(request?.payload),
  );
  const policyDigest = String(request?.policyVersionRecord?.configDigest ?? "");
  const snapshotDigest = String(request?.snapshot?.sourceDigest ?? "");
  if (!/^[a-f0-9]{64}$/.test(policyDigest)) {
    throw new Error("governance_decision_policy_digest_required");
  }
  if (!/^[a-f0-9]{64}$/.test(snapshotDigest)) {
    throw new Error("governance_decision_snapshot_digest_required");
  }
  const requestDigest = hashCanonicalGovernanceValue(
    "alcheme.governance.request-envelope-v2",
    {
      id: String(request?.id ?? ""),
      policyId: String(request?.policyId ?? ""),
      policyVersionId: String(request?.policyVersionId ?? ""),
      policyVersion: Number(request?.policyVersion),
      ruleId: String(request?.ruleId ?? ""),
      scopeType: String(request?.scopeType ?? ""),
      scopeRef: String(request?.scopeRef ?? ""),
      actionType: String(request?.actionType ?? ""),
      targetType: String(request?.targetType ?? ""),
      targetRef: String(request?.targetRef ?? ""),
      idempotencyKey: String(request?.idempotencyKey ?? ""),
      proposerPubkey: String(request?.proposerPubkey ?? ""),
      openedAt: dateTime(request?.openedAt),
      expiresAt: dateTime(request?.expiresAt),
      executionMode: request?.executionMode ?? null,
      caseRef: request?.caseRef ?? null,
      stageRef: request?.stageRef ?? null,
      compatibilityBundleVersion: request?.compatibilityBundleVersion ?? null,
      executionModeDigest: request?.executionModeDigest ?? null,
      payloadDigest,
      policyDigest,
      snapshotDigest,
    },
  );
  return {
    envelopeVersion: 2,
    requestDigest,
    payloadDigest,
    policyDigest,
    snapshotDigest,
  };
}

export function computeGovernancePolicyRulesDigest(rules: unknown): string {
  return crypto
    .createHash("sha256")
    .update(stableJsonStringify(rules))
    .digest("hex");
}

export function assertGovernanceRequestFrozenFacts(request: any): void {
  if (!['stage_decision_only', 'provider_bound_action'].includes(request?.executionMode)) return;
  const snapshot = request.snapshot;
  const policyVersion = request.policyVersionRecord;
  const invocation = request.invocation;
  const governanceCase = request.governanceCase;
  if (!snapshot || !policyVersion || !invocation || !governanceCase) {
    throw new Error("governance_request_frozen_facts_required");
  }
  if (
    policyVersion.id !== request.policyVersionId
    || policyVersion.policyId !== request.policyId
    || policyVersion.version !== request.policyVersion
    || computeGovernancePolicyRulesDigest(policyVersion.rules) !== policyVersion.configDigest
  ) {
    throw new Error("governance_request_policy_frozen_facts_mismatch");
  }
  const eligibleActors = canonicalizeGovernanceEligibleActors(
    Array.isArray(snapshot.eligibleActors) ? snapshot.eligibleActors : [],
  );
  const expectedSnapshotDigest = computeGovernanceSnapshotDigest({
    requestId: request.id,
    eligibleActors,
    action: {
      type: request.actionType,
      targetType: request.targetType,
      targetRef: request.targetRef,
      payload: asRecord(request.payload),
      idempotencyKey: request.idempotencyKey,
    },
    scope: { type: request.scopeType, ref: request.scopeRef },
  });
  if (snapshot.requestId !== request.id || snapshot.sourceDigest !== expectedSnapshotDigest) {
    throw new Error("governance_request_snapshot_frozen_facts_mismatch");
  }
  const expectedPayloadDigest = hashCanonicalGovernanceValue(
    "alcheme.governance.action-payload",
    asRecord(request.payload),
  );
  if (invocation.id !== request.invocationId || invocation.payloadDigest !== expectedPayloadDigest) {
    throw new Error("governance_request_payload_frozen_facts_mismatch");
  }
  if (
    invocation.subjectType !== request.targetType
    || invocation.subjectRef !== request.targetRef
    || invocation.contractVersion?.actionType !== request.actionType
  ) {
    throw new Error("governance_request_action_frozen_facts_mismatch");
  }
  if (
    governanceCase.id !== request.caseRef
    || governanceCase.primaryRequestId !== request.id
    || governanceCase.invocationId !== request.invocationId
    || !governanceCase.decisionStagePlan
    || hashCanonicalGovernanceValue(
      "alcheme.governance.case-decision-stage-plan",
      governanceCase.decisionStagePlan,
    ) !== governanceCase.decisionStagePlanDigest
  ) {
    throw new Error("governance_request_provider_frozen_facts_mismatch");
  }
  const planEvidencePolicy = governanceCase.decisionStagePlan.evidencePolicy;
  const payloadEvidencePolicy = asRecord(request.payload).evidencePolicy;
  if (
    !isCurrentGovernanceCaseFrozenEvidencePolicy(planEvidencePolicy)
    || !isCurrentGovernanceCaseFrozenEvidencePolicy(payloadEvidencePolicy)
    || hashCanonicalGovernanceValue(
      "alcheme.governance.case-frozen-evidence-policy",
      planEvidencePolicy,
    ) !== hashCanonicalGovernanceValue(
      "alcheme.governance.case-frozen-evidence-policy",
      payloadEvidencePolicy,
    )
  ) {
    throw new Error("governance_request_evidence_policy_frozen_facts_mismatch");
  }
  const decisionInput = asRecord(governanceCase.decisionStagePlan.decisionInput);
  if (decisionInput.kind === 'native_invocation_action') {
    if (decisionInput.payloadDigest !== expectedPayloadDigest) {
      throw new Error('governance_request_decision_input_frozen_facts_mismatch');
    }
  } else if (decisionInput.kind === 'reviewed_brief') {
    if (decisionInput.snapshotDigest !== governanceCase.briefSnapshotDigest) {
      throw new Error('governance_request_decision_input_frozen_facts_mismatch');
    }
  } else {
    throw new Error('governance_request_decision_input_frozen_facts_mismatch');
  }
  const approvalStage = Array.isArray(governanceCase.decisionStagePlan.stages)
    ? governanceCase.decisionStagePlan.stages.find((stage: any) => stage?.purpose === "approval")
    : null;
  const mechanism = resolveFrozenNativeGovernanceMechanism(request);
  const expectedProviderVersion = mechanism.kind === 'quadratic_voice_credits'
    ? `quadratic-voice-credits:${request.policyVersionId}`
    : mechanism.kind === 'quadratic_funding'
      ? `quadratic-funding:${request.policyVersionId}`
      : `committee-member-threshold:${request.policyVersionId}`;
  if (
    approvalStage?.stageRef !== request.stageRef
    || approvalStage?.decisionRef?.type !== "governance_request"
    || approvalStage?.decisionRef?.ref !== request.id
    || approvalStage?.provider?.type !== "alcheme_internal"
    || approvalStage?.provider?.version !== expectedProviderVersion
  ) {
    throw new Error("governance_request_provider_frozen_facts_mismatch");
  }
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
    homeIdentityBindingId?: string | null;
    invocationId?: string | null;
    policyId: string;
    policyVersionId: string;
    policyVersion: number;
    ruleId: string;
    scope: GovernanceScopeRef;
    action: GovernanceActionRecord;
    proposerPubkey: string;
    executionMode?: "legacy_action_checkpoint" | "stage_decision_only" | "provider_bound_action" | null;
    caseRef?: string | null;
    stageRef?: string | null;
    compatibilityBundleVersion?: string | null;
    executionModeDigest?: string | null;
    executionAuthorizationStatus?: string | null;
    executionAuthorizationReason?: string | null;
    eligibleActors: GovernanceEligibleActor[];
    openedAt: Date;
    expiresAt?: Date | null;
    caseTemplate?: NativeGovernanceCaseTemplate | null;
    attachToExistingCase?: boolean;
  },
): Promise<GovernanceRequestRecord & { snapshot: GovernanceSnapshotRecord }> {
  const eligibleActors = canonicalizeGovernanceEligibleActors(
    input.eligibleActors,
  );
  const request: GovernanceRequestRecord = {
    id: input.id,
    homeIdentityBindingId: input.homeIdentityBindingId ?? null,
    invocationId: input.invocationId ?? null,
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
    executionMode: input.executionMode ?? null,
    caseRef: input.caseRef ?? null,
    stageRef: input.stageRef ?? null,
    compatibilityBundleVersion: input.compatibilityBundleVersion ?? null,
    executionModeDigest: input.executionModeDigest ?? null,
    executionAuthorizationStatus: input.executionAuthorizationStatus ?? null,
    executionAuthorizationReason: input.executionAuthorizationReason ?? null,
    state: "active",
    openedAt: input.openedAt,
    expiresAt: input.expiresAt
      ?? new Date(input.openedAt.getTime() + GOVERNANCE_REQUEST_DEFAULT_TTL_SECONDS * 1_000),
    resolvedAt: null,
  };
  const snapshot: GovernanceSnapshotRecord = {
    id: `${input.id}:snapshot`,
    requestId: input.id,
    eligibleActors,
    sourceDigest: computeGovernanceSnapshotDigest({
      requestId: input.id,
      eligibleActors,
      action: input.action,
      scope: input.scope,
    }),
    createdAt: input.openedAt,
  };

  if (request.homeIdentityBindingId && request.invocationId && !input.caseTemplate) {
    if (
      (request.executionMode !== 'stage_decision_only'
        && request.executionMode !== 'provider_bound_action')
      || !request.caseRef
      || !request.stageRef
      || request.compatibilityBundleVersion !== null
      || input.attachToExistingCase !== true
    ) {
      throw new Error('governance_case_template_selection_required');
    }
  }
  const governanceCase = input.caseTemplate
    ? buildNativeGovernanceCaseForRequest(request, input.caseTemplate)
    : null;
  if (governanceCase) {
    request.caseRef = governanceCase.id;
  }

  const saved = await store.openRequestWithSnapshot(
    request,
    snapshot,
    governanceCase,
  );
  return { ...saved.request, snapshot: saved.snapshot };
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
  const actorPubkey = canonicalizeGovernanceSignalActor(input.actorPubkey);
  return store.saveSignal({ ...input, actorPubkey });
}

type GovernanceSignalConvergencePrisma = Pick<
  PrismaClient,
  | "$transaction"
  | "governanceRequest"
  | "governanceSnapshot"
  | "governanceSignal"
  | "governanceDecision"
>;

export async function recordAndResolveGovernanceSignalAtomically(
  prisma: GovernanceSignalConvergencePrisma,
  input: {
    requestId: string;
    signal: GovernanceSignalRecord;
    now: Date;
    evaluate(args: {
      request: any;
      eligibleActors: GovernanceEligibleActor[];
      signals: GovernanceSignalRecord[];
    }): GovernanceStrategyResult;
    replacementPolicy?: {
      mode: "not_allowed";
      deadline: "request_expires_at";
    };
    onTerminal?(args: {
      tx: any;
      request: any;
      decision: GovernanceDecisionRecord;
      now: Date;
    }): Promise<void>;
  },
): Promise<{
  request: any;
  signal: GovernanceSignalRecord;
  decision: GovernanceDecisionRecord | null;
  duplicate: boolean;
}> {
  return prisma.$transaction(async (tx) => {
    const locked = await tx.$queryRaw<Array<{ id: string }>>(Prisma.sql`
      SELECT "id"
      FROM "governance_requests"
      WHERE "id" = ${input.requestId}
      FOR UPDATE
    `);
    if (locked.length !== 1) {
      throw new Error("governance_request_not_found");
    }
    const request = await tx.governanceRequest.findUnique({
      where: { id: input.requestId },
      include: {
        policyVersionRecord: true,
        snapshot: true,
        signals: { orderBy: [{ createdAt: "asc" }, { id: "asc" }] },
        decision: true,
        invocation: {
          select: {
            id: true,
            payloadDigest: true,
            subjectType: true,
            subjectRef: true,
            contractVersion: { select: { actionType: true } },
          },
        },
        governanceCase: {
          select: {
            id: true,
            primaryRequestId: true,
            invocationId: true,
            briefSnapshotDigest: true,
            decisionStagePlan: true,
            decisionStagePlanDigest: true,
            templateSelection: true,
          },
        },
      },
    }) as any;
    if (!request) {
      throw new Error("governance_request_not_found");
    }
    const eligibleActors = canonicalizeGovernanceEligibleActors(
      Array.isArray(request.snapshot?.eligibleActors)
        ? request.snapshot.eligibleActors
        : [],
    );
    assertGovernanceRequestFrozenFacts(request);
    const actorPubkey = canonicalizeGovernanceSignalActor(input.signal.actorPubkey);
    const canonicalSignal = { ...input.signal, actorPubkey };
    const existingSignal = (request.signals ?? []).find((signal: any) =>
      signal.signalType === canonicalSignal.signalType
      && signal.actorPubkey === canonicalSignal.actorPubkey
    ) as GovernanceSignalRecord | undefined;

    if (request.state !== "active") {
      if (
        existingSignal
        && request.decision
        && governanceSignalsRepresentSameDelivery(existingSignal, canonicalSignal)
      ) {
        const decision = normalizeGovernanceDecisionRecord(request.decision);
        await input.onTerminal?.({ tx, request, decision, now: input.now });
        return {
          request,
          signal: existingSignal,
          decision,
          duplicate: true,
        };
      }
      throw new Error("governance_request_not_active");
    }
    if (request.decision) {
      throw new Error("governance_request_decision_state_mismatch");
    }
    if (request.expiresAt && request.expiresAt.getTime() <= input.now.getTime()) {
      throw new Error("governance_request_expired");
    }
    if (!eligibleActors.some((actor) => actor.pubkey === actorPubkey)) {
      throw new Error("governance_signal_actor_not_eligible");
    }

    if (
      existingSignal
      && !governanceSignalsRepresentSameDelivery(existingSignal, canonicalSignal)
    ) {
      if (!input.replacementPolicy || input.replacementPolicy.mode === "not_allowed") {
        throw new Error("governance_signal_replacement_not_allowed");
      }
      throw new Error("governance_vote_replacement_policy_unsupported");
    }
    const signal = existingSignal ?? await recordGovernanceSignal(
      createPrismaGovernanceRequestStore(tx as any),
      canonicalSignal,
    );
    const duplicate = !!existingSignal || signal.id !== canonicalSignal.id;
    const signals = duplicate
      ? request.signals as GovernanceSignalRecord[]
      : [...request.signals as GovernanceSignalRecord[], signal];
    const result = ['stage_decision_only', 'provider_bound_action'].includes(request.executionMode)
      ? evaluateFrozenNativeGovernanceMechanism({ request, eligibleActors, signals })
      : input.evaluate({ request, eligibleActors, signals });
    if (result.state === "active") {
      return { request, signal, decision: null, duplicate };
    }

    const executionWindow = resolveAcceptedProviderAdmissionExecutionWindow({
      request,
      result,
      now: input.now,
    });
    const decision = buildGovernanceDecisionRecord({
      request,
      executionMode: request.executionMode ?? null,
      executionModeDigest: request.executionModeDigest ?? null,
      compatibilityBundleVersion: request.compatibilityBundleVersion ?? null,
      result,
      now: input.now,
      executableFrom: executionWindow?.executableFrom,
      executableUntil: executionWindow?.executableUntil,
    });
    const saved = await tx.governanceDecision.create({
      data: governanceDecisionWriteData(decision),
    });
    const transitioned = await tx.governanceRequest.updateMany({
      where: { id: input.requestId, state: "active" },
      data: {
        state: decision.decision,
        resolvedAt: new Date(decision.decidedAt),
      },
    });
    if (transitioned.count !== 1) {
      throw new Error("governance_request_terminal_transition_conflict");
    }
    const resolvedRequest = {
      ...request,
      state: decision.decision,
      resolvedAt: new Date(decision.decidedAt),
    };
    await input.onTerminal?.({ tx, request: resolvedRequest, decision, now: input.now });
    return {
      request: resolvedRequest,
      signal,
      decision: normalizeGovernanceDecisionRecord(saved),
      duplicate,
    };
  });
}

export async function expireGovernanceRequestAtomically(
  prisma: GovernanceSignalConvergencePrisma,
  input: {
    requestId: string;
    now: Date;
    onTerminal?(args: {
      tx: any;
      request: any;
      decision: GovernanceDecisionRecord;
      now: Date;
    }): Promise<void>;
    evaluate(args: {
      request: any;
      eligibleActors: GovernanceEligibleActor[];
      signals: GovernanceSignalRecord[];
    }): GovernanceStrategyResult;
    allowAllEligibleTerminal?: boolean;
  },
): Promise<{ request: any; decision: GovernanceDecisionRecord; replayed: boolean }> {
  return prisma.$transaction(async (tx) => {
    const locked = await tx.$queryRaw<Array<{ id: string }>>(Prisma.sql`
      SELECT "id"
      FROM "governance_requests"
      WHERE "id" = ${input.requestId}
      FOR UPDATE
    `);
    if (locked.length !== 1) throw new Error('governance_request_not_found');
    const request = await tx.governanceRequest.findUnique({
      where: { id: input.requestId },
      include: {
        policyVersionRecord: true,
        snapshot: true,
        signals: { orderBy: [{ createdAt: 'asc' }, { id: 'asc' }] },
        decision: true,
        invocation: {
          select: {
            id: true,
            payloadDigest: true,
            subjectType: true,
            subjectRef: true,
            contractVersion: { select: { actionType: true } },
          },
        },
        governanceCase: {
          select: {
            id: true,
            primaryRequestId: true,
            invocationId: true,
            briefSnapshotDigest: true,
            decisionStagePlan: true,
            decisionStagePlanDigest: true,
          },
        },
      },
    }) as any;
    if (!request) throw new Error('governance_request_not_found');
    assertGovernanceRequestFrozenFacts(request);
    if (request.decision) {
      const decision = normalizeGovernanceDecisionRecord(request.decision);
      if (decision.decision !== 'expired' || request.state !== 'expired') {
        throw new Error('governance_request_not_active');
      }
      await input.onTerminal?.({ tx, request, decision, now: input.now });
      return { request, decision, replayed: true };
    }
    if (request.state !== 'active') throw new Error('governance_request_not_active');
    if (!request.expiresAt) {
      throw new Error('governance_request_deadline_required');
    }
    const deadlineExpired = request.expiresAt.getTime() <= input.now.getTime();
    const eligibleActors = canonicalizeGovernanceEligibleActors(
      Array.isArray(request.snapshot?.eligibleActors) ? request.snapshot.eligibleActors : [],
    );
    const signals = Array.isArray(request.signals) ? request.signals : [];
    const result = ['stage_decision_only', 'provider_bound_action'].includes(request.executionMode)
      ? evaluateFrozenNativeGovernanceMechanism({ request, eligibleActors, signals })
      : input.evaluate({ request, eligibleActors, signals });
    const allEligibleTerminal = input.allowAllEligibleTerminal === true
      && result.state === 'active'
      && allEligibleActorsHaveTerminalSignals(result);
    if (!deadlineExpired && !allEligibleTerminal) {
      throw new Error('governance_request_not_expired');
    }
    const terminalReason = deadlineExpired
      ? 'governance_request_deadline_expired'
      : 'governance_request_all_eligible_voted_without_threshold';
    const decisionInput: GovernanceDecisionInput = {
      requestId: input.requestId,
      ...computeGovernanceDecisionEnvelopeV2Digests(request),
      decision: 'expired',
      reason: terminalReason,
      tally: result.tally ?? {},
      decidedAt: input.now.toISOString(),
      executableFrom: null,
      executableUntil: null,
      ...(request.executionMode ? {
        executionMode: request.executionMode,
        executionModeDigest: request.executionModeDigest ?? null,
        compatibilityBundleVersion: request.compatibilityBundleVersion ?? null,
      } : {}),
    };
    const decision: GovernanceDecisionRecord = {
      ...decisionInput,
      decisionDigest: computeGovernanceDecisionDigest(decisionInput),
    };
    const saved = await tx.governanceDecision.create({ data: governanceDecisionWriteData(decision) });
    const transitioned = await tx.governanceRequest.updateMany({
      where: { id: input.requestId, state: 'active' },
      data: { state: 'expired', resolvedAt: input.now },
    });
    if (transitioned.count !== 1) throw new Error('governance_request_terminal_transition_conflict');
    const resolvedRequest = { ...request, state: 'expired', resolvedAt: input.now };
    await input.onTerminal?.({ tx, request: resolvedRequest, decision, now: input.now });
    return {
      request: resolvedRequest,
      decision: normalizeGovernanceDecisionRecord(saved),
      replayed: false,
    };
  });
}

export async function cancelGovernanceRequestAtomically(
  prisma: GovernanceSignalConvergencePrisma,
  input: {
    requestId: string;
    reason: string;
    now: Date;
    authorize(args: { tx: any; request: any }): Promise<void>;
    evaluate(args: {
      request: any;
      eligibleActors: GovernanceEligibleActor[];
      signals: GovernanceSignalRecord[];
    }): GovernanceStrategyResult;
    onTerminal?(args: {
      tx: any;
      request: any;
      decision: GovernanceDecisionRecord;
      now: Date;
    }): Promise<void>;
  },
): Promise<{ request: any; decision: GovernanceDecisionRecord; replayed: boolean }> {
  const reason = input.reason.trim();
  if (!reason || reason.length > 128) throw new Error('governance_request_cancel_reason_invalid');
  return prisma.$transaction(async (tx) => {
    const locked = await tx.$queryRaw<Array<{ id: string }>>(Prisma.sql`
      SELECT "id"
      FROM "governance_requests"
      WHERE "id" = ${input.requestId}
      FOR UPDATE
    `);
    if (locked.length !== 1) throw new Error('governance_request_not_found');
    const request = await tx.governanceRequest.findUnique({
      where: { id: input.requestId },
      include: {
        policyVersionRecord: true,
        snapshot: true,
        signals: { orderBy: [{ createdAt: 'asc' }, { id: 'asc' }] },
        decision: true,
        invocation: {
          select: {
            id: true,
            payloadDigest: true,
            subjectType: true,
            subjectRef: true,
            contractVersion: { select: { actionType: true } },
          },
        },
        governanceCase: {
          include: { responsibilities: true },
        },
      },
    }) as any;
    if (!request) throw new Error('governance_request_not_found');
    await input.authorize({ tx, request });
    assertGovernanceRequestFrozenFacts(request);
    if (request.decision) {
      const decision = normalizeGovernanceDecisionRecord(request.decision);
      if (request.state !== 'cancelled' || decision.decision !== 'cancelled') {
        throw new Error('governance_request_not_active');
      }
      await input.onTerminal?.({ tx, request, decision, now: input.now });
      return { request, decision, replayed: true };
    }
    if (request.state !== 'active') throw new Error('governance_request_not_active');
    if (request.expiresAt && new Date(request.expiresAt).getTime() <= input.now.getTime()) {
      throw new Error('governance_request_expired');
    }
    const eligibleActors = canonicalizeGovernanceEligibleActors(
      Array.isArray(request.snapshot?.eligibleActors) ? request.snapshot.eligibleActors : [],
    );
    const signals = Array.isArray(request.signals) ? request.signals : [];
    const result = ['stage_decision_only', 'provider_bound_action'].includes(request.executionMode)
      ? evaluateFrozenNativeGovernanceMechanism({ request, eligibleActors, signals })
      : input.evaluate({ request, eligibleActors, signals });
    const decisionInput: GovernanceDecisionInput = {
      requestId: input.requestId,
      ...computeGovernanceDecisionEnvelopeV2Digests(request),
      decision: 'cancelled',
      reason,
      tally: result.tally ?? {},
      decidedAt: input.now.toISOString(),
      executableFrom: null,
      executableUntil: null,
      ...(request.executionMode ? {
        executionMode: request.executionMode,
        executionModeDigest: request.executionModeDigest ?? null,
        compatibilityBundleVersion: request.compatibilityBundleVersion ?? null,
      } : {}),
    };
    const decision: GovernanceDecisionRecord = {
      ...decisionInput,
      decisionDigest: computeGovernanceDecisionDigest(decisionInput),
    };
    const saved = await tx.governanceDecision.create({ data: governanceDecisionWriteData(decision) });
    const transitioned = await tx.governanceRequest.updateMany({
      where: { id: input.requestId, state: 'active' },
      data: { state: 'cancelled', resolvedAt: input.now },
    });
    if (transitioned.count !== 1) throw new Error('governance_request_terminal_transition_conflict');
    const resolvedRequest = { ...request, state: 'cancelled', resolvedAt: input.now };
    await input.onTerminal?.({ tx, request: resolvedRequest, decision, now: input.now });
    return {
      request: resolvedRequest,
      decision: normalizeGovernanceDecisionRecord(saved),
      replayed: false,
    };
  });
}

function resolveAcceptedProviderAdmissionExecutionWindow(input: {
  request: any;
  result: GovernanceStrategyResult;
  now: Date;
}): { executableFrom: Date; executableUntil: Date } | null {
  if (
    input.result.state !== 'accepted'
    || String(input.request.actionType || '') !== 'storage_fabric.authorize_provider_admission'
  ) {
    return null;
  }
  const authority = input.request.governanceCase?.templateSelection?.actionAuthority;
  const untilRaw = authority?.effectiveUntil
    ?? authority?.authorityPolicyBinding?.effectiveUntil
    ?? null;
  const executableUntil = untilRaw ? new Date(untilRaw) : null;
  if (
    !executableUntil
    || !Number.isFinite(executableUntil.getTime())
    || executableUntil.getTime() <= input.now.getTime()
  ) {
    throw new Error('governance_decision_execution_window_invalid');
  }
  return {
    executableFrom: input.now,
    executableUntil,
  };
}

function buildGovernanceDecisionRecord(input: {
  request: any;
  result: GovernanceStrategyResult;
  now: Date;
  executableFrom?: Date | null;
  executableUntil?: Date | null;
  executionMode?: "legacy_action_checkpoint" | "stage_decision_only" | "provider_bound_action" | null;
  executionModeDigest?: string | null;
  compatibilityBundleVersion?: string | null;
}): GovernanceDecisionRecord {
  const decision: GovernanceDecisionValue = input.result.state === "accepted"
    ? "accepted"
    : input.result.state === "rejected"
      ? "rejected"
      : "expired";
  const decisionInput: GovernanceDecisionInput = {
    requestId: input.request.id,
    ...computeGovernanceDecisionEnvelopeV2Digests(input.request),
    decision,
    reason: input.result.reason,
    tally: input.result.tally ?? {},
    decidedAt: input.now.toISOString(),
    executableFrom: input.executableFrom?.toISOString() ?? null,
    executableUntil: input.executableUntil?.toISOString() ?? null,
    ...(input.executionMode ? {
      executionMode: input.executionMode,
      executionModeDigest: input.executionModeDigest ?? null,
      compatibilityBundleVersion: input.compatibilityBundleVersion ?? null,
    } : {}),
  };
  return {
    ...decisionInput,
    decisionDigest: computeGovernanceDecisionDigest(decisionInput),
  };
}

function governanceDecisionWriteData(decision: GovernanceDecisionRecord) {
  return {
    requestId: decision.requestId,
    envelopeVersion: decision.envelopeVersion ?? null,
    requestDigest: decision.requestDigest ?? null,
    payloadDigest: decision.payloadDigest ?? null,
    policyDigest: decision.policyDigest ?? null,
    snapshotDigest: decision.snapshotDigest ?? null,
    decision: decision.decision,
    reason: decision.reason,
    tally: decision.tally as Prisma.InputJsonValue,
    decidedAt: new Date(decision.decidedAt),
    executableFrom: decision.executableFrom ? new Date(decision.executableFrom) : null,
    executableUntil: decision.executableUntil ? new Date(decision.executableUntil) : null,
    decisionDigest: decision.decisionDigest,
    issuerSignature: decision.issuerSignature ?? null,
    executionMode: decision.executionMode ?? null,
    executionModeDigest: decision.executionModeDigest ?? null,
    compatibilityBundleVersion: decision.compatibilityBundleVersion ?? null,
  };
}

function normalizeGovernanceDecisionRecord(value: any): GovernanceDecisionRecord {
  return {
    requestId: value.requestId,
    envelopeVersion: value.envelopeVersion ?? null,
    requestDigest: value.requestDigest ?? null,
    payloadDigest: value.payloadDigest ?? null,
    policyDigest: value.policyDigest ?? null,
    snapshotDigest: value.snapshotDigest ?? null,
    decision: value.decision,
    reason: value.reason,
    tally: asRecord(value.tally),
    decidedAt: dateTime(value.decidedAt)!,
    executableFrom: dateTime(value.executableFrom),
    executableUntil: dateTime(value.executableUntil),
    decisionDigest: value.decisionDigest,
    issuerSignature: value.issuerSignature ?? null,
    executionMode: value.executionMode ?? null,
    executionModeDigest: value.executionModeDigest ?? null,
    compatibilityBundleVersion: value.compatibilityBundleVersion ?? null,
  };
}

export async function recordExecutionReceipt(
  store: GovernanceEngineStore,
  input: GovernanceExecutionReceiptRecord,
  options: { caseBlocker?: GovernanceExecutionCaseBlockerInput | null } = {},
): Promise<GovernanceExecutionReceiptRecord> {
  if (!/^[a-f0-9]{64}$/.test(input.decisionDigest ?? "")) {
    throw new Error("governance_execution_receipt_decision_digest_required");
  }
  const executionEvidence = input.executionEvidence ?? null;
  const executionEvidenceDigest = executionEvidence
    ? hashCanonicalGovernanceValue(
        'alcheme.governance.execution-receipt-evidence',
        executionEvidence,
      )
    : null;
  if (
    input.executionEvidenceDigest != null
    && input.executionEvidenceDigest !== executionEvidenceDigest
  ) {
    throw new Error('governance_execution_receipt_evidence_digest_mismatch');
  }
  const normalizedInput = {
    ...input,
    executionEvidence,
    executionEvidenceDigest,
  };
  const marker = {
    requestId: input.requestId,
    executorModule: input.executorModule,
    idempotencyKey: input.idempotencyKey,
  };
  const existing = await store.getExecutionReceiptByMarker(marker);
  if (existing) {
    if (
      existing.decisionDigest
      && existing.decisionDigest !== input.decisionDigest
    ) {
      throw new Error("governance_execution_receipt_decision_digest_mismatch");
    }
    if ((existing.executionEvidenceDigest ?? null) !== executionEvidenceDigest) {
      throw new Error('governance_execution_receipt_evidence_digest_mismatch');
    }
    if (options.caseBlocker) {
      if (!store.ensureExecutionCaseBlocker) {
        throw new Error('governance_case_blocker_persistence_required');
      }
      await store.ensureExecutionCaseBlocker(existing, options.caseBlocker);
    }
    return existing;
  }
  try {
    if (options.caseBlocker && !store.ensureExecutionCaseBlocker) {
      throw new Error('governance_case_blocker_persistence_required');
    }
    return await store.saveExecutionReceipt(normalizedInput, options.caseBlocker ?? null);
  } catch (error) {
    if (!isUniqueConstraintError(error)) {
      throw error;
    }
    const raced = await store.getExecutionReceiptByMarker(marker);
    if (raced) {
      if (
        raced.decisionDigest
        && raced.decisionDigest !== input.decisionDigest
      ) {
        throw new Error("governance_execution_receipt_decision_digest_mismatch");
      }
      if ((raced.executionEvidenceDigest ?? null) !== executionEvidenceDigest) {
        throw new Error('governance_execution_receipt_evidence_digest_mismatch');
      }
      if (options.caseBlocker) {
        if (!store.ensureExecutionCaseBlocker) {
          throw new Error('governance_case_blocker_persistence_required');
        }
        await store.ensureExecutionCaseBlocker(raced, options.caseBlocker);
      }
      return raced;
    }
    throw error;
  }
}

function isUniqueConstraintError(error: unknown): boolean {
  return !!(
    error &&
    typeof error === "object" &&
    "code" in error &&
    String((error as { code?: unknown }).code) === "P2002"
  );
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

function allEligibleActorsHaveTerminalSignals(result: GovernanceStrategyResult): boolean {
  const tally = asRecord(result.tally);
  const quorum = asRecord(tally.quorum);
  const tie = asRecord(tally.tie);
  const eligible = Number(tally.eligible);
  const participation = Number(
    quorum.participation ?? tally.participation ?? tally.submitted,
  );
  return Number.isSafeInteger(eligible)
    && eligible > 0
    && Number.isSafeInteger(participation)
    && participation === eligible
    && tie.status !== 'tied';
}
