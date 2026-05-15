import { randomUUID } from "node:crypto";

import type { GovernanceEngineStore } from "../governance/policyEngine";
import { recordExecutionReceipt } from "../governance/policyEngine";
import { computeGovernanceExecutionReceiptDigest } from "../governance/auditAnchor";
import {
  normalizeCapabilityPolicyMap,
  normalizeExternalAppDiscoveryStatus,
  normalizeManagedNodePolicy,
} from "./validation";
import { computeManifestHash, normalizeExternalAppManifest } from "./manifest";
import { extractSolanaOwnerPubkey } from "./ownerAssertion";
import {
  appIdHash,
  externalAppExecutionIntentDigest,
  manifestHashToBytes32Hex,
  normalizeHash32Hex,
  ownerAssertionHash,
  policyStateDigest,
  serverKeyHash,
} from "./chainRegistryDigest";
import type {
  ExternalAppChainRegistrationPayload,
  ExternalAppRegistryAdapter,
  ExternalAppRegistryEvidence,
} from "./chainRegistryAdapter";

type ExternalAppAction =
  | "external_app_register"
  | "approve_store_listing"
  | "approve_managed_node_quota"
  | "downgrade_discovery_status"
  | "limit_capability"
  | "emergency_hold";

const EXTERNAL_APP_ACTIONS = new Set<ExternalAppAction>([
  "external_app_register",
  "approve_store_listing",
  "approve_managed_node_quota",
  "downgrade_discovery_status",
  "limit_capability",
  "emergency_hold",
]);

export interface ExternalAppDecisionRequest {
  id: string;
  actionType: string;
  targetRef: string;
  payload: Record<string, unknown>;
}

export async function executeExternalAppDecision(input: {
  prisma: {
    externalApp: {
      update(input: unknown): Promise<unknown>;
    };
    externalAppRegistryAnchor?: {
      upsert(input: unknown): Promise<unknown>;
    };
  };
  governanceStore: GovernanceEngineStore;
  request: ExternalAppDecisionRequest;
  decision: { decision: string; decisionDigest?: string | null };
  now: Date;
  chainRegistry?: ExternalAppRegistryAdapter;
}) {
  const receiptBase = {
    id: randomUUID(),
    requestId: input.request.id,
    actionType: input.request.actionType,
    executorModule: "external_app",
    executionRef: input.request.targetRef,
    idempotencyKey: `${input.request.id}:external_app`,
    executedAt: input.now,
  };

  if (input.decision.decision !== "accepted") {
    return recordExecutionReceipt(input.governanceStore, {
      ...receiptBase,
      executionStatus: "skipped",
      errorCode: "decision_not_accepted",
    });
  }

  if (!EXTERNAL_APP_ACTIONS.has(input.request.actionType as ExternalAppAction)) {
    return recordExecutionReceipt(input.governanceStore, {
      ...receiptBase,
      executionStatus: "failed",
      errorCode: "unsupported_external_app_action_type",
    });
  }

  const actionType = input.request.actionType as ExternalAppAction;
  const data: Record<string, unknown> = {};
  let chainRegistrationPayload: ExternalAppChainRegistrationPayload | null = null;
  let chainRegistrationEvidence: ExternalAppRegistryEvidence | null = null;
  if (actionType === "approve_store_listing" || actionType === "downgrade_discovery_status") {
    data.discoveryStatus = normalizeExternalAppDiscoveryStatus(
      input.request.payload.discoveryStatus,
    );
  }
  if (actionType === "approve_managed_node_quota" || actionType === "emergency_hold") {
    data.managedNodePolicy = normalizeManagedNodePolicy(
      input.request.payload.managedNodePolicy,
    );
  }
  if (actionType === "approve_managed_node_quota" && input.request.payload.quotaPolicy) {
    data.quotaPolicy = input.request.payload.quotaPolicy;
  }
  if (actionType === "limit_capability") {
    data.capabilityPolicies = normalizeCapabilityPolicyMap(
      input.request.payload.capabilityPolicies,
    );
  }
  if (actionType === "external_app_register") {
    data.registryStatus = "active";
    data.status = "active";
    if (input.request.payload.manifest) {
      let manifest;
      try {
        manifest = normalizeExternalAppManifest(input.request.payload.manifest);
        const manifestHash = computeManifestHash(manifest);
        if (manifestHash !== String(input.request.payload.manifestHash || "")) {
          throw new Error("external_app_manifest_hash_mismatch");
        }
      } catch {
        return recordExecutionReceipt(input.governanceStore, {
          ...receiptBase,
          executionStatus: "failed",
          errorCode: "invalid_external_app_manifest",
        });
      }
      const manifestHash = computeManifestHash(manifest);
      if (input.chainRegistry) {
        const manifestHashHex = manifestHashToBytes32Hex(manifestHash);
        const ownerAssertion = normalizeOwnerAssertion(input.request.payload.ownerAssertion);
        const decisionDigest = normalizeDecisionDigest(input);
        const reviewPolicyDigest = policyStateDigest({
          reviewCircleId: input.request.payload.reviewCircleId ?? null,
          reviewPolicyId: input.request.payload.reviewPolicyId ?? null,
          reviewPolicyVersionId: input.request.payload.reviewPolicyVersionId ?? null,
          reviewPolicyVersion: input.request.payload.reviewPolicyVersion ?? null,
        });
        const policyDigest = policyStateDigest({
          allowedOrigins: manifest.allowedOrigins,
          capabilities: manifest.capabilities,
          managedNodePolicy: input.request.payload.managedNodePolicy ?? null,
          manifestPolicy: manifest.policy ?? null,
        });
        const appHash = appIdHash(input.request.targetRef);
        const executionIntentDigest = externalAppExecutionIntentDigest({
          actionType,
          appId: input.request.targetRef,
          appIdHash: appHash,
          decisionDigest,
          manifestHash: manifestHashHex,
          requestId: input.request.id,
        });
        chainRegistrationPayload = {
          externalAppId: input.request.targetRef,
          appIdHash: appHash,
          ownerPubkey: extractSolanaOwnerPubkey(manifest.ownerWallet),
          serverKeyHash: serverKeyHash(manifest.serverPublicKey),
          manifestHashHex,
          ownerAssertionHash: ownerAssertionHash(
            ownerAssertion.payload,
            ownerAssertion.signature,
          ),
          policyStateDigest: policyDigest,
          reviewCircleId: Number(input.request.payload.reviewCircleId ?? 0),
          reviewPolicyDigest,
          decisionDigest,
          executionIntentDigest,
        };
        try {
          chainRegistrationEvidence =
            await input.chainRegistry.anchorExternalAppRegistration(chainRegistrationPayload);
        } catch (error) {
          return recordExecutionReceipt(input.governanceStore, {
            ...receiptBase,
            executionStatus: "failed",
            errorCode: (error as Error).message || "external_app_registry_registration_failed",
          });
        }
      }
      data.name = manifest.name;
      data.ownerPubkey = extractSolanaOwnerPubkey(manifest.ownerWallet);
      data.serverPublicKey = manifest.serverPublicKey;
      data.claimAuthMode = "server_ed25519";
      data.allowedOrigins = manifest.allowedOrigins;
      data.config = { manifest };
      data.environment = "mainnet_production";
      data.manifestHash = manifestHash;
      data.revokedAt = null;
    }
  }

  await input.prisma.externalApp.update({
    where: { id: input.request.targetRef },
    data,
  });

  if (chainRegistrationPayload && chainRegistrationEvidence?.status === "submitted") {
    await safeUpsertExternalAppRegistryAnchor(input.prisma, {
      payload: chainRegistrationPayload,
      evidence: chainRegistrationEvidence,
      registryStatus: "active",
      stage: "registration",
    });
  }

  const executionReceipt = await recordExecutionReceipt(input.governanceStore, {
    ...receiptBase,
    executionStatus: "executed",
    errorCode: null,
  });

  if (
    chainRegistrationPayload &&
    chainRegistrationEvidence?.status === "submitted" &&
    input.chainRegistry
  ) {
    const receiptDigest = computeGovernanceExecutionReceiptDigest(executionReceipt);
    try {
      const receiptEvidence = await input.chainRegistry.anchorExecutionReceipt({
        externalAppId: chainRegistrationPayload.externalAppId,
        appIdHash: chainRegistrationPayload.appIdHash,
        executionReceiptDigest: receiptDigest,
      });
      if (receiptEvidence.status === "submitted") {
        await safeUpsertExternalAppRegistryAnchor(input.prisma, {
          payload: chainRegistrationPayload,
          evidence: chainRegistrationEvidence,
          receiptDigest,
          receiptEvidence,
          registryStatus: "active",
          stage: "receipt",
        });
      }
    } catch (error) {
      if (chainRegistrationEvidence.mode === "required") {
        await input.prisma.externalApp.update({
          where: { id: input.request.targetRef },
          data: { status: "inactive", registryStatus: "pending" },
        });
      }
    }
  }

  return executionReceipt;
}

function normalizeOwnerAssertion(value: unknown): { payload: string; signature: string } {
  if (!value || typeof value !== "object") {
    throw new Error("external_app_owner_assertion_required");
  }
  const record = value as Record<string, unknown>;
  if (!record.payload || !record.signature) {
    throw new Error("external_app_owner_assertion_required");
  }
  return {
    payload: String(record.payload),
    signature: String(record.signature),
  };
}

function normalizeDecisionDigest(input: {
  request: ExternalAppDecisionRequest;
  decision: { decision: string; decisionDigest?: string | null };
  now: Date;
}): string {
  if (input.decision.decisionDigest) {
    return normalizeHash32Hex(input.decision.decisionDigest, "external_app_registry_decision_digest");
  }
  return externalAppExecutionIntentDigest({
    domain: "alcheme:external-app-decision-fallback:v2",
    requestId: input.request.id,
    decision: input.decision.decision,
    decidedAt: input.now.toISOString(),
  });
}

async function safeUpsertExternalAppRegistryAnchor(
  prisma: {
    externalAppRegistryAnchor?: {
      upsert(input: unknown): Promise<unknown>;
    };
  },
  input: {
    payload: ExternalAppChainRegistrationPayload;
    evidence: ExternalAppRegistryEvidence;
    receiptDigest?: string;
    receiptEvidence?: ExternalAppRegistryEvidence;
    registryStatus: string;
    stage: "registration" | "receipt";
  },
) {
  try {
    await upsertExternalAppRegistryAnchor(prisma, input);
  } catch (error) {
    console.warn("[external-app-registry] local projection upsert failed", {
      stage: input.stage,
      externalAppId: input.payload.externalAppId,
      appIdHash: input.payload.appIdHash,
      error: error instanceof Error ? error.message : String(error),
    });
  }
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
    receiptEvidence?: ExternalAppRegistryEvidence;
    registryStatus: string;
  },
) {
  if (!prisma.externalAppRegistryAnchor) return;
  await prisma.externalAppRegistryAnchor.upsert({
    where: { appIdHash: input.payload.appIdHash },
    create: {
      id: `external_app_registry:${input.payload.externalAppId}`,
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
      finalityStatus: input.evidence.status === "submitted" ? "submitted" : "pending",
      receiptTxSignature: input.receiptEvidence?.txSignature,
      receiptFinalityStatus:
        input.receiptEvidence?.status === "submitted" ? "submitted" : "pending",
    },
    update: {
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
      finalityStatus: input.evidence.status === "submitted" ? "submitted" : "pending",
      receiptTxSignature: input.receiptEvidence?.txSignature,
      receiptFinalityStatus:
        input.receiptEvidence?.status === "submitted" ? "submitted" : "pending",
    },
  });
}
