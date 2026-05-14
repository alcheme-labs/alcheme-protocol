import { randomUUID } from "node:crypto";

import type { GovernanceEngineStore } from "../governance/policyEngine";
import { recordExecutionReceipt } from "../governance/policyEngine";
import {
  normalizeCapabilityPolicyMap,
  normalizeExternalAppDiscoveryStatus,
  normalizeManagedNodePolicy,
} from "./validation";
import { computeManifestHash, normalizeExternalAppManifest } from "./manifest";
import { extractSolanaOwnerPubkey } from "./ownerAssertion";

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
  };
  governanceStore: GovernanceEngineStore;
  request: ExternalAppDecisionRequest;
  decision: { decision: string };
  now: Date;
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
      data.name = manifest.name;
      data.ownerPubkey = extractSolanaOwnerPubkey(manifest.ownerWallet);
      data.serverPublicKey = manifest.serverPublicKey;
      data.claimAuthMode = "server_ed25519";
      data.allowedOrigins = manifest.allowedOrigins;
      data.config = { manifest };
      data.environment = "mainnet_production";
      data.manifestHash = computeManifestHash(manifest);
      data.revokedAt = null;
    }
  }

  await input.prisma.externalApp.update({
    where: { id: input.request.targetRef },
    data,
  });

  return recordExecutionReceipt(input.governanceStore, {
    ...receiptBase,
    executionStatus: "executed",
    errorCode: null,
  });
}
