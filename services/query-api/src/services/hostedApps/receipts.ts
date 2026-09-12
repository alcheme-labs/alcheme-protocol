import { randomUUID } from "node:crypto";

import { digestJson } from "./digest";
import type { HostedAppActionDecision, HostedAppDecision } from "./types";

export function buildAccessReceipt(input: {
  appId: string;
  releaseId: string;
  manifestHash: string;
  circleId: number;
  userPubkey?: string | null;
  capabilityId: string;
  capabilityVersion: string;
  policyEpoch: number;
  requestParams: unknown;
  returnedData?: unknown;
  redactionProfile: string;
  dataReleaseProfile: string;
  decision: HostedAppDecision;
  denialReason?: string;
}) {
  const base = {
    receiptId: randomUUID(),
    appId: input.appId,
    releaseId: input.releaseId,
    manifestHash: input.manifestHash,
    circleId: input.circleId,
    userPubkey: input.userPubkey ?? null,
    capabilityId: input.capabilityId,
    capabilityVersion: input.capabilityVersion,
    policyEpoch: input.policyEpoch,
    requestParamsDigest: digestJson(input.requestParams),
    returnedDataDigest: input.returnedData === undefined ? null : digestJson(input.returnedData),
    redactionProfile: input.redactionProfile,
    dataReleaseProfile: input.dataReleaseProfile,
    decision: input.decision,
    denialReason: input.denialReason ?? null,
    issuedAt: new Date().toISOString(),
  };

  return { ...base, receiptDigest: digestJson(base) };
}

export function buildActionReceipt(input: {
  receiptId?: string;
  appId: string;
  releaseId: string;
  manifestHash: string;
  circleId: number;
  userPubkey: string;
  actionId: string;
  capabilityId: string;
  capabilityVersion: string;
  policyEpoch: number;
  payload: unknown;
  preview: unknown;
  signatureDigest?: string | null;
  executionTargetRef?: string | null;
  nativeResultRef?: string | null;
  decision: HostedAppActionDecision;
  redactionProfile: string;
  errorCode?: string | null;
}) {
  const base = {
    receiptId: input.receiptId ?? randomUUID(),
    appId: input.appId,
    releaseId: input.releaseId,
    manifestHash: input.manifestHash,
    circleId: input.circleId,
    userPubkey: input.userPubkey,
    actionId: input.actionId,
    capabilityId: input.capabilityId,
    capabilityVersion: input.capabilityVersion,
    policyEpoch: input.policyEpoch,
    payloadDigest: digestJson(input.payload),
    previewDigest: digestJson(input.preview),
    signatureDigest: input.signatureDigest ?? null,
    executionTargetRef: input.executionTargetRef ?? null,
    nativeResultRef: input.nativeResultRef ?? null,
    decision: input.decision,
    redactionProfile: input.redactionProfile,
    executedAt: input.decision === "executed" ? new Date().toISOString() : null,
    errorCode: input.errorCode ?? null,
  };

  return { ...base, receiptDigest: digestJson(base) };
}
