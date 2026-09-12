import { randomUUID } from "node:crypto";

import { digestJson } from "./digest";
import {
  validateSignatureIntent,
  type SignatureIntentInput,
} from "./signatureIntent";

export function buildSignatureIntentPreview(input: SignatureIntentInput) {
  validateSignatureIntent(input);
  const preview = {
    actionId: "request_signature_intent",
    purpose: input.purpose,
    chainId: input.chainId,
    programOrContract: input.programOrContract,
    method: input.method,
    accounts: input.accounts ?? [],
    amount: input.amount ?? null,
    spender: input.spender ?? null,
    typedDataDomain: input.typedDataDomain ?? null,
    simulationResultDigest: input.simulationResultDigest,
    riskExplanation: input.riskExplanation,
    payloadDigest: input.payloadDigest,
    previewDigest: input.previewDigest,
    replayDomain: input.replayDomain,
    nonce: input.nonce,
    appId: input.appId,
    releaseId: input.releaseId,
    manifestHash: input.manifestHash,
    circleId: input.circleId,
    userPubkey: input.userPubkey,
    riskLevel: input.riskLevel,
    signer: input.signer,
    expiresAt: input.expiresAt,
  };
  return { preview, previewDigest: digestJson(preview) };
}

export function buildSignatureActionReceipt(input: {
  appId: string;
  releaseId: string;
  manifestHash: string;
  circleId: number;
  userPubkey: string;
  actionId: string;
  capabilityVersion: string;
  policyEpoch: number;
  payloadDigest: string;
  previewDigest: string;
  signatureDigest: string;
}) {
  const base = {
    receiptId: randomUUID(),
    appId: input.appId,
    releaseId: input.releaseId,
    manifestHash: input.manifestHash,
    circleId: input.circleId,
    userPubkey: input.userPubkey,
    actionId: input.actionId,
    capabilityId: input.actionId,
    capabilityVersion: input.capabilityVersion,
    policyEpoch: input.policyEpoch,
    payloadDigest: input.payloadDigest,
    previewDigest: input.previewDigest,
    signatureDigest: input.signatureDigest,
    executionTargetRef: "alcheme_native:wallet_signature",
    nativeResultRef: null,
    decision: "executed",
    redactionProfile: "signature_digest_only",
    executedAt: new Date().toISOString(),
    errorCode: null,
  };
  return { ...base, receiptDigest: digestJson(base) };
}
