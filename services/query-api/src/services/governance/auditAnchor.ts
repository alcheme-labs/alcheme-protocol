import {
  sha256Hex,
  stableStringify,
} from "../settlement/proofPackage";
import type { AnchorPayload } from "../settlement/types";

export interface GovernanceAuditDigestSet {
  requestId: string;
  requestDigest: string;
  policyVersionDigest: string | null;
  eligibilitySnapshotDigest: string | null;
  signalRoot: string | null;
  decisionDigest: string | null;
  executionReceiptDigests: string[];
}

export interface GovernanceAuditAnchorPackage {
  digestSet: GovernanceAuditDigestSet;
  canonicalJson: string;
  payloadHash: string;
  anchorPayload: AnchorPayload;
  memoText: string;
}

function asRecord(value: unknown): Record<string, unknown> {
  return value && typeof value === "object" && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : {};
}

function normalizeDate(value: unknown): string | null {
  if (!value) return null;
  if (value instanceof Date) return value.toISOString();
  return String(value);
}

function digest(value: unknown): string {
  return sha256Hex(stableStringify(value));
}

export function computeGovernanceRequestAuditDigest(request: {
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
  payload: unknown;
  idempotencyKey: string;
  proposerPubkey: string;
  state: string;
  openedAt: Date | string;
  expiresAt?: Date | string | null;
}): string {
  return digest({
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
    payload: asRecord(request.payload),
    idempotencyKey: request.idempotencyKey,
    proposerPubkey: request.proposerPubkey,
    state: request.state,
    openedAt: normalizeDate(request.openedAt),
    expiresAt: normalizeDate(request.expiresAt),
  });
}

export function computeGovernanceSignalRoot(signals: Array<{
  id: string;
  requestId: string;
  signalType: string;
  actorPubkey?: string | null;
  value: string;
  weight: string;
  evidence?: unknown;
  signature?: string | null;
  signedMessage?: string | null;
  externalClaimNonce?: string | null;
  createdAt: Date | string;
}>): string | null {
  if (signals.length === 0) return null;
  const normalized = signals
    .map((signal) => ({
      id: signal.id,
      requestId: signal.requestId,
      signalType: signal.signalType,
      actorPubkey: signal.actorPubkey ?? null,
      value: signal.value,
      weight: signal.weight,
      evidence: asRecord(signal.evidence),
      signature: signal.signature ?? null,
      signedMessage: signal.signedMessage ?? null,
      externalClaimNonce: signal.externalClaimNonce ?? null,
      createdAt: normalizeDate(signal.createdAt),
    }))
    .sort((left, right) => left.id.localeCompare(right.id));
  return digest(normalized);
}

export function computeGovernanceExecutionReceiptDigest(receipt: {
  id: string;
  requestId: string;
  actionType: string;
  executorModule: string;
  executionStatus: string;
  executionRef?: string | null;
  errorCode?: string | null;
  idempotencyKey: string;
  executedAt: Date | string;
}): string {
  return digest({
    id: receipt.id,
    requestId: receipt.requestId,
    actionType: receipt.actionType,
    executorModule: receipt.executorModule,
    executionStatus: receipt.executionStatus,
    executionRef: receipt.executionRef ?? null,
    errorCode: receipt.errorCode ?? null,
    idempotencyKey: receipt.idempotencyKey,
    executedAt: normalizeDate(receipt.executedAt),
  });
}

export function buildGovernanceAuditDigestSet(input: {
  request: Parameters<typeof computeGovernanceRequestAuditDigest>[0] & {
    policyVersionRecord?: { configDigest?: string | null } | null;
  };
  snapshot?: { sourceDigest?: string | null } | null;
  signals?: Parameters<typeof computeGovernanceSignalRoot>[0];
  decision?: { decisionDigest?: string | null } | null;
  receipts?: Array<Parameters<typeof computeGovernanceExecutionReceiptDigest>[0]>;
}): GovernanceAuditDigestSet {
  return {
    requestId: input.request.id,
    requestDigest: computeGovernanceRequestAuditDigest(input.request),
    policyVersionDigest: input.request.policyVersionRecord?.configDigest ?? null,
    eligibilitySnapshotDigest: input.snapshot?.sourceDigest ?? null,
    signalRoot: computeGovernanceSignalRoot(input.signals ?? []),
    decisionDigest: input.decision?.decisionDigest ?? null,
    executionReceiptDigests: (input.receipts ?? [])
      .map(computeGovernanceExecutionReceiptDigest)
      .sort(),
  };
}

export function buildGovernanceAuditAnchorPackage(input: {
  request: {
    id: string;
    scopeType: string;
    scopeRef: string;
    actionType: string;
  };
  digestSet: GovernanceAuditDigestSet;
  generatedAt?: Date | string;
  memoPrefix?: string;
}): GovernanceAuditAnchorPackage {
  const generatedAt = normalizeDate(input.generatedAt) ?? new Date().toISOString();
  const canonical = {
    version: 1,
    anchorType: "governance_audit",
    requestId: input.request.id,
    scopeType: input.request.scopeType,
    scopeRef: input.request.scopeRef,
    actionType: input.request.actionType,
    digestSet: input.digestSet,
    generatedAt,
  };
  const canonicalJson = stableStringify(canonical);
  const payloadHash = sha256Hex(canonicalJson);
  const anchorPayload: AnchorPayload = {
    version: 1,
    anchorType: "governance_audit",
    sourceId: `governance_request:${input.request.id}`,
    sourceScope: `${input.request.scopeType}:${input.request.scopeRef}`,
    payloadHash,
    generatedAt,
    canonicalJson,
  };
  const memoPrefix = input.memoPrefix ?? "alcheme-governance-audit:v1:";
  const memoText = `${memoPrefix}${stableStringify({
    actionType: input.request.actionType,
    payloadHash,
    requestId: input.request.id,
    signalRoot: input.digestSet.signalRoot,
    v: 1,
  })}`;

  return {
    digestSet: input.digestSet,
    canonicalJson,
    payloadHash,
    anchorPayload,
    memoText,
  };
}
