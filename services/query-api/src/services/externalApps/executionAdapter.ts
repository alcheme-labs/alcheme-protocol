import { createHash } from "node:crypto";

import type { GovernanceEngineStore } from "../governance/policyEngine";
import {
  createPrismaGovernanceEngineStore,
  recordExecutionReceipt,
} from "../governance/policyEngine";
import { computeGovernanceExecutionReceiptDigest } from "../governance/auditAnchor";
import {
  normalizeCapabilityPolicyMap,
  normalizeExternalAppDiscoveryStatus,
  normalizeManagedNodePolicy,
} from "./validation";
import { computeManifestHash, normalizeExternalAppManifest } from "./manifest";
import {
  extractSolanaOwnerPubkey,
  verifyExternalAppKeyOperationOwnerAssertion,
} from "./ownerAssertion";
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
  ExternalAppChainServerKeyRotationPayload,
  ExternalAppRegistryAdapter,
  ExternalAppRegistryEvidence,
} from "./chainRegistryAdapter";
import { parseExternalAppRegistryMode } from "./chainRegistryAdapter";
import {
  buildInitialExternalAppServerKeyUpsert,
  buildRotatedExternalAppServerKeyUpsert,
} from "./serverKeyLifecycle";
import { quarantineSandboxCircleBindingsForEnvironmentUpgrade } from "./sandboxCircleBindingAuthority";
import {
  normalizeProvisioningCapability,
  normalizeProvisioningStatus,
} from "./provisioning";
import { requirePrivateSidecarSurface } from "../../config/services";
import { persistExternalAppAppealResolutionOutputArtifact } from "../governance/decisionOutputArtifact";
import {
  claimRegistryChainAttemptForBroadcast,
  createRegistryChainAttemptReadbackFromEnv,
  isRegistryChainReadbackRepairRequiredError,
  markAttemptFailed,
  markAttemptReconciled,
  markAttemptSubmitted,
  persistQuotedAttempt,
  reconcileExternalAppRegistryChainAttempt,
  type RegistryChainAttemptRecord,
} from "./registryChainAttempt";

type ExternalAppAction =
  | "external_app_register"
  | "external_app_server_key_rotate"
  | "external_app_server_key_revoke"
  | "external_app_provisioning_grant"
  | "external_app_provisioning_revoke"
  | "approve_store_listing"
  | "approve_managed_node_quota"
  | "downgrade_discovery_status"
  | "external_app_appeal_resolution"
  | "limit_capability"
  | "emergency_hold";

const EXTERNAL_APP_ACTIONS = new Set<ExternalAppAction>([
  "external_app_register",
  "external_app_server_key_rotate",
  "external_app_server_key_revoke",
  "external_app_provisioning_grant",
  "external_app_provisioning_revoke",
  "approve_store_listing",
  "approve_managed_node_quota",
  "downgrade_discovery_status",
  "external_app_appeal_resolution",
  "limit_capability",
  "emergency_hold",
]);

const MAX_PROVISIONING_RECORD_ID_LENGTH = 128;
const DISCOVERY_RESTRICTION_RANK = new Map([
  ["listed", 0],
  ["unlisted", 1],
  ["limited", 2],
  ["hidden", 3],
  ["delisted", 4],
]);

interface ProvisioningGrantUpsertInput {
  where: unknown;
  create: Record<string, unknown>;
  update: Record<string, unknown>;
}

interface ProvisioningEventCreateInput {
  data: Record<string, unknown>;
}

export interface ExternalAppDecisionRequest {
  id: string;
  actionType: string;
  targetRef: string;
  payload: Record<string, unknown>;
}

type ExternalAppExecutionChainRegistry = Pick<
  ExternalAppRegistryAdapter,
  "anchorExternalAppRegistration" | "anchorExecutionReceipt"
> &
  Partial<Pick<ExternalAppRegistryAdapter, "rotateServerKey">> & {
    readback?: (
      attempt: RegistryChainAttemptRecord,
    ) => Promise<Record<string, unknown> | null>;
  };

export async function executeExternalAppDecision(input: {
  prisma: ExternalAppDecisionPrisma;
  governanceStore: GovernanceEngineStore;
  request: ExternalAppDecisionRequest;
  decision: { decision: string; decisionDigest?: string | null };
  now: Date;
  chainRegistry?: ExternalAppExecutionChainRegistry;
  createReceiptId?: () => string;
  receiptIdempotencyKey?: string;
}) {
  const decisionDigest = normalizeDecisionDigest(input);
  const receiptBase = {
    id:
      input.createReceiptId?.() ??
      buildDeterministicExternalAppReceiptId({
        requestId: input.request.id,
        actionType: input.request.actionType,
        decisionDigest,
      }),
    requestId: input.request.id,
    actionType: input.request.actionType,
    executorModule: "external_app",
    executionRef: input.request.targetRef,
    decisionDigest,
    idempotencyKey:
      input.receiptIdempotencyKey ??
      `${input.request.actionType}:${input.request.targetRef}`,
    executedAt: input.now,
  };

  if (input.decision.decision !== "accepted") {
    return recordExternalAppExecutionReceipt(
      input.governanceStore,
      receiptBase,
      {
        executionStatus: "skipped",
        errorCode: "decision_not_accepted",
      },
    );
  }

  const recovered = await recoverSubmittedRegistryAttemptsBeforeResubmit({
    prisma: input.prisma,
    governanceStore: input.governanceStore,
    requestId: input.request.id,
    receiptBase,
    chainRegistry: input.chainRegistry,
  });
  if (recovered) return recovered;

  if (
    !EXTERNAL_APP_ACTIONS.has(input.request.actionType as ExternalAppAction)
  ) {
    return recordExternalAppExecutionReceipt(
      input.governanceStore,
      receiptBase,
      {
        executionStatus: "failed",
        errorCode: "unsupported_external_app_action_type",
      },
    );
  }

  const actionType = input.request.actionType as ExternalAppAction;
  const data: Record<string, unknown> = {};
  let chainRegistrationPayload: ExternalAppChainRegistrationPayload | null =
    null;
  let chainRegistrationEvidence: ExternalAppRegistryEvidence | null = null;
  let chainReceiptEvidence: ExternalAppRegistryEvidence | null = null;
  let acceptedManifestHash: string | null = null;
  let acceptedManifestServerPublicKey: string | null = null;
  let serverKeyUpsert: unknown | null = null;
  let previousServerKeyUpdate: unknown | null = null;
  let serverKeyRevocationUpdate: unknown | null = null;
  let chainServerKeyRotationPayload: ExternalAppChainServerKeyRotationPayload | null =
    null;
  let chainServerKeyRotationEvidence: ExternalAppRegistryEvidence | null = null;
  const submittedChainAttempts: RegistryChainAttemptRecord[] = [];
  let registryAnchorRotationProjection: {
    payload: ExternalAppChainServerKeyRotationPayload;
    evidence: ExternalAppRegistryEvidence;
    receiptDigest: string;
    receiptEvidence: ExternalAppRegistryEvidence;
  } | null = null;
  let pendingRegistryAnchorUpsert: {
    payload: ExternalAppChainRegistrationPayload;
    evidence: ExternalAppRegistryEvidence;
    receiptDigest?: string;
    receiptEvidence?: ExternalAppRegistryEvidence;
    registryStatus: string;
    stage: "registration" | "receipt";
  } | null = null;
  let provisioningGrantUpsert: ProvisioningGrantUpsertInput | null = null;
  let provisioningEventCreate: ProvisioningEventCreateInput | null = null;
  if (actionType === "approve_store_listing") {
    data.discoveryStatus = normalizeExternalAppDiscoveryStatus(
      input.request.payload.discoveryStatus,
    );
  }
  if (actionType === "downgrade_discovery_status") {
    const app = await loadExternalAppForExecution(input.prisma, {
      externalAppId: input.request.targetRef,
    });
    const previousDiscoveryStatus = normalizeExternalAppDiscoveryStatus(
      input.request.payload.previousDiscoveryStatus,
    );
    const discoveryStatus = normalizeExternalAppDiscoveryStatus(
      input.request.payload.discoveryStatus,
    );
    if (
      input.request.payload.environment !== "sandbox" ||
      app?.environment !== "sandbox" ||
      app.discoveryStatus !== previousDiscoveryStatus ||
      previousDiscoveryStatus === discoveryStatus
    ) {
      return recordExternalAppExecutionReceipt(
        input.governanceStore,
        receiptBase,
        {
          executionStatus: "failed",
          errorCode: "external_app_discovery_state_mismatch",
        },
      );
    }
    data.discoveryStatus = discoveryStatus;
  }
  let appealResolutionEvidence: Record<string, unknown> | null = null;
  if (actionType === "external_app_appeal_resolution") {
    const originalExecutionReceiptId = normalizeRequiredString(
      input.request.payload.originalExecutionReceiptId,
      "external_app_appeal_original_receipt_required",
    );
    const originalRequestId = normalizeRequiredString(
      input.request.payload.originalRequestId,
      "external_app_appeal_original_request_required",
    );
    const originalDecisionDigest = normalizeRequiredString(
      input.request.payload.originalDecisionDigest,
      "external_app_appeal_original_decision_required",
    );
    const originalInvocationId = normalizeRequiredString(
      input.request.payload.originalInvocationId,
      "external_app_appeal_original_invocation_required",
    );
    if (
      input.request.payload.kind !== "external_app_appeal_resolution" ||
      input.request.payload.environment !== "sandbox" ||
      input.request.payload.originalActionType !==
        "downgrade_discovery_status" ||
      input.request.payload.requestedResolution !== "independent_review" ||
      !["modify", "revoke"].includes(
        String(input.request.payload.requestedOutcome),
      ) ||
      !/^[a-f0-9]{64}$/.test(originalDecisionDigest) ||
      !/^[a-f0-9]{64}$/.test(
        String(input.request.payload.originalEffectDigest ?? ""),
      ) ||
      !/^[a-f0-9]{64}$/.test(
        String(input.request.payload.evidenceDigest ?? ""),
      ) ||
      !originalExecutionReceiptId ||
      !originalRequestId
    ) {
      return recordExternalAppExecutionReceipt(
        input.governanceStore,
        receiptBase,
        {
          executionStatus: "failed",
          errorCode: "external_app_appeal_contract_mismatch",
        },
      );
    }
    const app = await loadExternalAppForExecution(input.prisma, {
      externalAppId: input.request.targetRef,
    });
    const previousDiscoveryStatus = normalizeExternalAppDiscoveryStatus(
      input.request.payload.previousDiscoveryStatus,
    );
    const discoveryStatus = normalizeExternalAppDiscoveryStatus(
      input.request.payload.discoveryStatus,
    );
    const requestedOutcome = String(input.request.payload.requestedOutcome);
    const resultingDiscoveryStatus =
      requestedOutcome === "revoke"
        ? previousDiscoveryStatus
        : normalizeExternalAppDiscoveryStatus(
            input.request.payload.modifiedDiscoveryStatus,
          );
    const previousRank = DISCOVERY_RESTRICTION_RANK.get(
      previousDiscoveryStatus,
    );
    const currentRank = DISCOVERY_RESTRICTION_RANK.get(discoveryStatus);
    const resultingRank = DISCOVERY_RESTRICTION_RANK.get(
      resultingDiscoveryStatus,
    );
    const validOutcome =
      requestedOutcome === "revoke"
        ? resultingDiscoveryStatus === previousDiscoveryStatus
        : previousRank !== undefined &&
          currentRank !== undefined &&
          resultingRank !== undefined &&
          resultingRank > previousRank &&
          resultingRank < currentRank;
    if (
      app?.environment !== "sandbox" ||
      app.discoveryStatus !== discoveryStatus ||
      resultingDiscoveryStatus === discoveryStatus ||
      !validOutcome
    ) {
      return recordExternalAppExecutionReceipt(
        input.governanceStore,
        receiptBase,
        {
          executionStatus: "failed",
          errorCode: "external_app_appeal_effect_state_mismatch",
        },
      );
    }
    data.discoveryStatus = resultingDiscoveryStatus;
    appealResolutionEvidence = {
      kind: "external_app_appeal_resolution",
      environment: "sandbox",
      outcome: requestedOutcome,
      requestedOutcome,
      modifiedDiscoveryStatus:
        requestedOutcome === "modify" ? resultingDiscoveryStatus : null,
      originalInvocationId,
      originalRequestId,
      originalExecutionReceiptId,
      originalDecisionDigest,
      originalEffectDigest: input.request.payload.originalEffectDigest,
      appellantPubkey: input.request.payload.appellantPubkey,
      evidenceDigest: input.request.payload.evidenceDigest,
      previousDiscoveryStatus,
      discoveryStatus,
      resultingDiscoveryStatus,
      resolutionDecisionDigest: decisionDigest,
      executionReceiptId: receiptBase.id,
    };
  }
  if (
    actionType === "approve_managed_node_quota" ||
    actionType === "emergency_hold"
  ) {
    data.managedNodePolicy = normalizeManagedNodePolicy(
      input.request.payload.managedNodePolicy,
    );
  }
  if (
    actionType === "approve_managed_node_quota" &&
    input.request.payload.quotaPolicy
  ) {
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
    if (!input.request.payload.manifest) {
      return recordExternalAppExecutionReceipt(
        input.governanceStore,
        receiptBase,
        {
          executionStatus: "failed",
          errorCode: "invalid_external_app_manifest",
        },
      );
    }
    if (input.request.payload.manifest) {
      let manifest;
      try {
        manifest = normalizeExternalAppManifest(input.request.payload.manifest);
        const manifestHash = computeManifestHash(manifest);
        if (manifestHash !== String(input.request.payload.manifestHash || "")) {
          throw new Error("external_app_manifest_hash_mismatch");
        }
      } catch {
        return recordExternalAppExecutionReceipt(
          input.governanceStore,
          receiptBase,
          {
            executionStatus: "failed",
            errorCode: "invalid_external_app_manifest",
          },
        );
      }
      const manifestHash = computeManifestHash(manifest);
      acceptedManifestHash = manifestHash;
      acceptedManifestServerPublicKey = manifest.serverPublicKey;
      const currentApp = await loadExternalAppForExecution(input.prisma, {
        externalAppId: input.request.targetRef,
      });
      const currentServerPublicKey = isActiveProductionExternalApp(currentApp)
        ? currentApp?.serverPublicKey
        : null;
      if (
        currentServerPublicKey &&
        currentServerPublicKey !== manifest.serverPublicKey
      ) {
        return recordExternalAppExecutionReceipt(
          input.governanceStore,
          receiptBase,
          {
            executionStatus: "failed",
            errorCode: "external_app_server_key_rotation_required",
          },
        );
      }
      if (!input.chainRegistry) {
        return recordExternalAppExecutionReceipt(
          input.governanceStore,
          receiptBase,
          {
            executionStatus: "failed",
            errorCode: "external_app_registry_anchor_required",
          },
        );
      }
      if (input.chainRegistry) {
        const manifestHashHex = manifestHashToBytes32Hex(manifestHash);
        const ownerAssertion = normalizeOwnerAssertion(
          input.request.payload.ownerAssertion,
        );
        const decisionDigest = normalizeDecisionDigest(input);
        const reviewPolicyDigest = policyStateDigest({
          reviewCircleId: input.request.payload.reviewCircleId ?? null,
          reviewPolicyId: input.request.payload.reviewPolicyId ?? null,
          reviewPolicyVersionId:
            input.request.payload.reviewPolicyVersionId ?? null,
          reviewPolicyVersion:
            input.request.payload.reviewPolicyVersion ?? null,
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
        const priorRegistration = await findRecoverableRegistryAttempt(
          input.prisma,
          {
            requestId: input.request.id,
            stage: "registration",
          },
        );
        let registrationAttempt = priorRegistration;
        if (
          (priorRegistration?.txSignature ||
            priorRegistration?.chainStateSlot != null) &&
          priorRegistration.metadata
        ) {
          const priorMeta = priorRegistration.metadata as Record<
            string,
            unknown
          >;
          const frozen = (
            priorMeta.frozen && typeof priorMeta.frozen === "object"
              ? priorMeta.frozen
              : {}
          ) as Record<string, unknown>;
          const priorEvidence = (frozen.registrationEvidence ||
            (priorMeta.registration as any)?.evidence) as
            | ExternalAppRegistryEvidence
            | undefined;
          const priorPayload = (frozen.registrationPayload ||
            (priorMeta.registration as any)?.payload) as
            | ExternalAppChainRegistrationPayload
            | undefined;
          if (
            priorEvidence &&
            (priorEvidence.txSignature ||
              (priorEvidence as any)?.chainStateVerified === true) &&
            priorPayload?.externalAppId
          ) {
            chainRegistrationEvidence = priorEvidence;
            chainRegistrationPayload = priorPayload;
            submittedChainAttempts.push(priorRegistration);
          }
        }
        if (!chainRegistrationEvidence) {
          registrationAttempt = await persistRegistryChainAttempt(
            input.prisma,
            {
              requestId: input.request.id,
              actionType,
              stage: "registration",
              intentDigest: executionIntentDigest,
              metadata: {
                targetRef: input.request.targetRef,
                registration: { payload: chainRegistrationPayload },
                receiptBase,
              },
            },
          );
          if (
            registrationAttempt &&
            !(await claimRegistryChainAttemptForBroadcast(
              input.prisma as any,
              registrationAttempt,
            ))
          ) {
            return recordExternalAppExecutionReceipt(
              input.governanceStore,
              receiptBase,
              {
                executionStatus: "failed",
                errorCode:
                  "external_app_registry_chain_attempt_broadcast_ambiguous",
              },
            );
          }
          try {
            chainRegistrationEvidence =
              await input.chainRegistry.anchorExternalAppRegistration(
                chainRegistrationPayload,
              );
          } catch (error) {
            return recordExternalAppExecutionReceipt(
              input.governanceStore,
              receiptBase,
              {
                executionStatus: "failed",
                errorCode: normalizeExternalAppExecutionErrorCode(
                  (error as Error).message,
                  "external_app_registry_registration_failed",
                ),
              },
            );
          }
          if (
            shouldFailClosedMissingRegistryEvidence(chainRegistrationEvidence)
          ) {
            return recordExternalAppExecutionReceipt(
              input.governanceStore,
              receiptBase,
              {
                executionStatus: "failed",
                errorCode: registryEvidenceErrorCode(
                  chainRegistrationEvidence,
                  "external_app_registry_anchor_required",
                ),
              },
            );
          }
          if (registrationAttempt) {
            try {
              await markAttemptSubmitted(
                input.prisma as any,
                registrationAttempt,
                {
                  txSignature: chainRegistrationEvidence.txSignature,
                  cluster: chainRegistrationEvidence.cluster,
                  metadata: {
                    targetRef: input.request.targetRef,
                    appData: data,
                    registration: {
                      payload: chainRegistrationPayload,
                      evidence: chainRegistrationEvidence,
                    },
                    receiptBase,
                  },
                },
              );
            } catch {
              return recordAttemptSubmissionPersistenceFailure({
                governanceStore: input.governanceStore,
                receiptBase,
                stage: "registration",
                attempt: registrationAttempt,
                txSignature: chainRegistrationEvidence.txSignature,
                cluster: chainRegistrationEvidence.cluster,
                recordPda: chainRegistrationEvidence.recordPda,
                metadata: {
                  registration: {
                    payload: chainRegistrationPayload,
                    evidence: chainRegistrationEvidence,
                  },
                  receiptBase,
                  targetRef: input.request.targetRef,
                  appData: data,
                },
              });
            }
            submittedChainAttempts.push(registrationAttempt);
          }
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

  if (actionType === "external_app_server_key_rotate") {
    const newServerPublicKey = normalizeRequiredString(
      input.request.payload.newServerPublicKey,
      "external_app_server_public_key_required",
    );
    if (!input.chainRegistry?.rotateServerKey) {
      return recordExternalAppExecutionReceipt(
        input.governanceStore,
        receiptBase,
        {
          executionStatus: "failed",
          errorCode: "external_app_registry_anchor_required",
        },
      );
    }
    const previousKeyVersion = normalizeOptionalString(
      input.request.payload.previousKeyVersion,
    );
    if (!previousKeyVersion) {
      return recordExternalAppExecutionReceipt(
        input.governanceStore,
        receiptBase,
        {
          executionStatus: "failed",
          errorCode: "external_app_server_key_version_required",
        },
      );
    }
    const previousKey = await loadExternalAppServerKeyForOperation(
      input.prisma,
      {
        externalAppId: input.request.targetRef,
        keyVersion: previousKeyVersion,
      },
    );
    if (!previousKey) {
      return recordExternalAppExecutionReceipt(
        input.governanceStore,
        receiptBase,
        {
          executionStatus: "failed",
          errorCode: "external_app_server_key_not_found",
        },
      );
    }
    if (previousKey.status !== "active") {
      return recordExternalAppExecutionReceipt(
        input.governanceStore,
        receiptBase,
        {
          executionStatus: "failed",
          errorCode: "external_app_previous_server_key_not_active",
        },
      );
    }
    const previousKeyGraceUntilString = normalizeOptionalString(
      input.request.payload.previousKeyGraceUntil,
    );
    const previousKeyGraceUntil = normalizeOptionalDate(
      previousKeyGraceUntilString,
    );
    const nextServerKeyHash = serverKeyHash(newServerPublicKey);
    const keyOperationIdempotencyKey = buildKeyOperationIdempotencyKey({
      externalAppId: input.request.targetRef,
      actionType,
      keyMaterialRef: nextServerKeyHash,
      payloadIdempotencyKey: input.request.payload.idempotencyKey,
    });
    const ownerAssertionError =
      await verifyKeyOperationOwnerAssertionForExecution(input.prisma, {
        externalAppId: input.request.targetRef,
        actionType,
        audience: "alcheme:external-app-server-key-rotation",
        newServerPublicKeyHash: nextServerKeyHash,
        previousKeyVersion,
        previousKeyGraceUntil: previousKeyGraceUntilString,
        keyVersion: null,
        idempotencyKey: keyOperationIdempotencyKey,
        ownerAssertion: input.request.payload.ownerAssertion,
        now: input.now,
      });
    if (ownerAssertionError) {
      return recordExternalAppExecutionReceipt(
        input.governanceStore,
        receiptBase,
        {
          executionStatus: "failed",
          errorCode: ownerAssertionError,
        },
      );
    }
    previousServerKeyUpdate = {
      where: {
        externalAppId: input.request.targetRef,
        keyVersion: previousKeyVersion,
        status: "active",
      },
      data: previousKeyGraceUntil
        ? {
            status: "grace",
            graceUntil: previousKeyGraceUntil,
            rotationReceiptId: receiptBase.id,
          }
        : {
            status: "revoked",
            revokedAt: input.now,
            rotationReceiptId: receiptBase.id,
          },
    };
    const appHash = appIdHash(input.request.targetRef);
    const decisionDigest = normalizeDecisionDigest(input);
    const executionIntentDigest = externalAppExecutionIntentDigest({
      actionType,
      appId: input.request.targetRef,
      appIdHash: appHash,
      requestId: input.request.id,
      serverKeyHash: nextServerKeyHash,
      previousKeyVersion: input.request.payload.previousKeyVersion ?? null,
      idempotencyKey: keyOperationIdempotencyKey,
    });
    chainServerKeyRotationPayload = {
      externalAppId: input.request.targetRef,
      appIdHash: appHash,
      expectedServerKeyHash: normalizeHash32Hex(
        normalizeRequiredString(
          input.request.payload.expectedServerKeyHash,
          "external_app_registry_expected_server_key_hash",
        ),
        "external_app_registry_expected_server_key_hash",
      ),
      expectedDecisionDigest: normalizeHash32Hex(
        normalizeRequiredString(
          input.request.payload.expectedDecisionDigest,
          "external_app_registry_expected_decision_digest",
        ),
        "external_app_registry_expected_decision_digest",
      ),
      expectedExecutionIntentDigest: normalizeHash32Hex(
        normalizeRequiredString(
          input.request.payload.expectedExecutionIntentDigest,
          "external_app_registry_expected_execution_intent_digest",
        ),
        "external_app_registry_expected_execution_intent_digest",
      ),
      serverKeyHash: nextServerKeyHash,
      decisionDigest,
      executionIntentDigest,
    };
    const priorRotation = await findRecoverableRegistryAttempt(input.prisma, {
      requestId: input.request.id,
      stage: "server_key_rotation",
    });
    let rotationAttempt = priorRotation;
    if (
      (priorRotation?.txSignature || priorRotation?.chainStateSlot != null) &&
      priorRotation.metadata
    ) {
      const priorMeta = priorRotation.metadata as Record<string, unknown>;
      const frozen = (
        priorMeta.frozen && typeof priorMeta.frozen === "object"
          ? priorMeta.frozen
          : {}
      ) as Record<string, unknown>;
      const priorEvidence = (frozen.rotationEvidence ||
        (priorMeta.rotation as any)?.evidence) as
        | ExternalAppRegistryEvidence
        | undefined;
      const priorPayload = (frozen.rotationPayload ||
        (priorMeta.rotation as any)?.payload) as
        | ExternalAppChainServerKeyRotationPayload
        | undefined;
      if (
        priorEvidence &&
        (priorEvidence.txSignature ||
          (priorEvidence as any)?.chainStateVerified === true) &&
        priorPayload?.externalAppId
      ) {
        chainServerKeyRotationEvidence = priorEvidence;
        chainServerKeyRotationPayload = priorPayload;
        submittedChainAttempts.push(priorRotation);
      }
    }
    if (!chainServerKeyRotationEvidence) {
      rotationAttempt = await persistRegistryChainAttempt(input.prisma, {
        requestId: input.request.id,
        actionType,
        stage: "server_key_rotation",
        intentDigest: executionIntentDigest,
        metadata: {
          targetRef: input.request.targetRef,
          rotation: { payload: chainServerKeyRotationPayload },
          receiptBase,
        },
      });
      if (
        rotationAttempt &&
        !(await claimRegistryChainAttemptForBroadcast(
          input.prisma as any,
          rotationAttempt,
        ))
      ) {
        return recordExternalAppExecutionReceipt(
          input.governanceStore,
          receiptBase,
          {
            executionStatus: "failed",
            errorCode:
              "external_app_registry_chain_attempt_broadcast_ambiguous",
          },
        );
      }
      try {
        chainServerKeyRotationEvidence =
          await input.chainRegistry.rotateServerKey(
            chainServerKeyRotationPayload,
          );
      } catch (error) {
        return recordExternalAppExecutionReceipt(
          input.governanceStore,
          receiptBase,
          {
            executionStatus: "failed",
            errorCode: normalizeExternalAppExecutionErrorCode(
              (error as Error).message,
              "external_app_registry_rotation_failed",
            ),
          },
        );
      }
      if (
        shouldFailClosedMissingRegistryEvidence(chainServerKeyRotationEvidence)
      ) {
        return recordExternalAppExecutionReceipt(
          input.governanceStore,
          receiptBase,
          {
            executionStatus: "failed",
            errorCode: registryEvidenceErrorCode(
              chainServerKeyRotationEvidence,
              "external_app_registry_anchor_required",
            ),
          },
        );
      }
    }
    data.serverPublicKey = newServerPublicKey;
    serverKeyUpsert = buildRotatedExternalAppServerKeyUpsert({
      externalAppId: input.request.targetRef,
      serverPublicKey: newServerPublicKey,
      executedAt: input.now,
      executionReceiptId: receiptBase.id,
      requestId: input.request.id,
      actionType,
      registryTxSignature: chainServerKeyRotationEvidence.txSignature ?? null,
      idempotencyKey: keyOperationIdempotencyKey,
    });
    if (rotationAttempt && !submittedChainAttempts.includes(rotationAttempt)) {
      try {
        await markAttemptSubmitted(input.prisma as any, rotationAttempt, {
          txSignature: chainServerKeyRotationEvidence.txSignature,
          cluster: chainServerKeyRotationEvidence.cluster,
          metadata: {
            targetRef: input.request.targetRef,
            appData: data,
            rotation: {
              payload: chainServerKeyRotationPayload,
              evidence: chainServerKeyRotationEvidence,
            },
            serverKeyUpsert,
            previousServerKeyUpdate,
            receiptBase,
          },
        });
      } catch {
        return recordAttemptSubmissionPersistenceFailure({
          governanceStore: input.governanceStore,
          receiptBase,
          stage: "server_key_rotation",
          attempt: rotationAttempt,
          txSignature: chainServerKeyRotationEvidence.txSignature,
          cluster: chainServerKeyRotationEvidence.cluster,
          recordPda: chainServerKeyRotationEvidence.recordPda,
          metadata: {
            rotation: {
              payload: chainServerKeyRotationPayload,
              evidence: chainServerKeyRotationEvidence,
            },
            serverKeyUpsert,
            previousServerKeyUpdate,
            receiptBase,
            targetRef: input.request.targetRef,
            appData: data,
          },
        });
      }
      submittedChainAttempts.push(rotationAttempt);
    }
  }

  if (actionType === "external_app_server_key_revoke") {
    const keyVersion = normalizeRequiredString(
      input.request.payload.keyVersion,
      "external_app_server_key_version_required",
    );
    const key = await loadExternalAppServerKeyForOperation(input.prisma, {
      externalAppId: input.request.targetRef,
      keyVersion,
    });
    if (!key) {
      return recordExternalAppExecutionReceipt(
        input.governanceStore,
        receiptBase,
        {
          executionStatus: "failed",
          errorCode: "external_app_server_key_not_found",
        },
      );
    }
    const keyOperationIdempotencyKey = buildKeyOperationIdempotencyKey({
      externalAppId: input.request.targetRef,
      actionType,
      keyMaterialRef: keyVersion,
      payloadIdempotencyKey: input.request.payload.idempotencyKey,
    });
    const ownerAssertionError =
      await verifyKeyOperationOwnerAssertionForExecution(input.prisma, {
        externalAppId: input.request.targetRef,
        actionType,
        audience: "alcheme:external-app-server-key-revocation",
        newServerPublicKeyHash: null,
        previousKeyVersion: null,
        previousKeyGraceUntil: null,
        keyVersion,
        idempotencyKey: keyOperationIdempotencyKey,
        ownerAssertion: input.request.payload.ownerAssertion,
        now: input.now,
      });
    if (ownerAssertionError) {
      return recordExternalAppExecutionReceipt(
        input.governanceStore,
        receiptBase,
        {
          executionStatus: "failed",
          errorCode: ownerAssertionError,
        },
      );
    }
    serverKeyRevocationUpdate = {
      where: {
        externalAppId: input.request.targetRef,
        keyVersion,
        status: { not: "revoked" },
      },
      data: {
        status: "revoked",
        revokedAt: input.now,
        rotationReceiptId: receiptBase.id,
        auditMetadata: {
          source: "server_key_revocation_governance_execution",
          actionType,
          requestId: input.request.id,
          reason: input.request.payload.reason ?? null,
          idempotencyKey: keyOperationIdempotencyKey,
        },
      },
    };
  }

  if (
    actionType === "external_app_provisioning_grant" ||
    actionType === "external_app_provisioning_revoke"
  ) {
    const sidecarGate = requirePrivateSidecarSurface(
      "external_program_operator",
    );
    if (!sidecarGate.ok) {
      return recordExternalAppExecutionReceipt(
        input.governanceStore,
        receiptBase,
        {
          executionStatus: "failed",
          errorCode: sidecarGate.error,
        },
      );
    }
    let provisioning;
    try {
      provisioning = buildProvisioningMutation({
        actionType,
        externalAppId: input.request.targetRef,
        payload: input.request.payload,
        requestId: input.request.id,
        decisionDigest: normalizeProvisioningDecisionDigest(input, actionType),
        executionReceiptId: receiptBase.id,
        now: input.now,
      });
    } catch (error) {
      return recordExternalAppExecutionReceipt(
        input.governanceStore,
        receiptBase,
        {
          executionStatus: "failed",
          errorCode:
            error instanceof Error
              ? error.message
              : "external_app_provisioning_invalid",
        },
      );
    }
    provisioningGrantUpsert = provisioning.grantUpsert;
    provisioningEventCreate = provisioning.eventCreate;
  }

  if (
    chainRegistrationPayload &&
    chainRegistrationEvidence?.status === "submitted"
  ) {
    // Stage only — persist with App/receipt in one transaction.
    pendingRegistryAnchorUpsert = {
      payload: chainRegistrationPayload,
      evidence: chainRegistrationEvidence,
      registryStatus: "active",
      stage: "registration",
    };
  }

  const pendingExecutionReceipt = {
    ...receiptBase,
    executionStatus: "executed" as const,
    errorCode: null,
  };

  if (
    chainRegistrationPayload &&
    chainRegistrationEvidence?.status === "submitted" &&
    input.chainRegistry
  ) {
    const receiptDigest = computeGovernanceExecutionReceiptDigest(
      pendingExecutionReceipt,
    );
    const receiptAttempt = await persistRegistryChainAttempt(input.prisma, {
      requestId: input.request.id,
      actionType,
      stage: "receipt",
      intentDigest: receiptDigest,
      receiptDigest,
      metadata: {
        targetRef: input.request.targetRef,
        appData: data,
        registration: {
          payload: chainRegistrationPayload,
          evidence: chainRegistrationEvidence,
        },
        receiptBase,
      },
    });
    if (
      receiptAttempt &&
      !(await claimRegistryChainAttemptForBroadcast(
        input.prisma as any,
        receiptAttempt,
      ))
    ) {
      return recordExternalAppExecutionReceipt(
        input.governanceStore,
        receiptBase,
        {
          executionStatus: "failed",
          errorCode: "external_app_registry_chain_attempt_broadcast_ambiguous",
        },
      );
    }
    try {
      const receiptEvidence = await input.chainRegistry.anchorExecutionReceipt({
        externalAppId: chainRegistrationPayload.externalAppId,
        appIdHash: chainRegistrationPayload.appIdHash,
        expectedDecisionDigest: chainRegistrationPayload.decisionDigest,
        expectedExecutionIntentDigest:
          chainRegistrationPayload.executionIntentDigest,
        executionReceiptDigest: receiptDigest,
      });
      chainReceiptEvidence = receiptEvidence;
      if (shouldFailClosedMissingRegistryEvidence(receiptEvidence)) {
        return recordExternalAppExecutionReceipt(
          input.governanceStore,
          receiptBase,
          {
            executionStatus: "failed",
            errorCode: registryEvidenceErrorCode(
              receiptEvidence,
              "external_app_registry_receipt_anchor_required",
            ),
          },
        );
      }
      if (receiptEvidence.status === "submitted") {
        if (
          acceptedManifestHash &&
          acceptedManifestServerPublicKey &&
          !serverKeyUpsert
        ) {
          serverKeyUpsert = buildInitialExternalAppServerKeyUpsert({
            externalAppId: chainRegistrationPayload.externalAppId,
            manifestHash: acceptedManifestHash,
            serverPublicKey: acceptedManifestServerPublicKey,
            executedAt: input.now,
            executionReceiptId: receiptBase.id,
            requestId: input.request.id,
            actionType,
            registryTxSignature: chainRegistrationEvidence.txSignature ?? null,
            receiptTxSignature: receiptEvidence.txSignature ?? null,
          });
        }
        if (receiptAttempt) {
          try {
            await markAttemptSubmitted(input.prisma as any, receiptAttempt, {
              txSignature: receiptEvidence.txSignature,
              receiptDigest,
              cluster: receiptEvidence.cluster,
              metadata: {
                targetRef: input.request.targetRef,
                appData: data,
                registration: {
                  payload: chainRegistrationPayload,
                  evidence: chainRegistrationEvidence,
                },
                receipt: { evidence: receiptEvidence },
                serverKeyUpsert,
                receiptBase,
              },
            });
          } catch {
            return recordAttemptSubmissionPersistenceFailure({
              governanceStore: input.governanceStore,
              receiptBase,
              stage: "receipt",
              attempt: receiptAttempt,
              txSignature: receiptEvidence.txSignature,
              cluster: receiptEvidence.cluster,
              recordPda: receiptEvidence.recordPda,
              metadata: {
                registration: {
                  payload: chainRegistrationPayload,
                  evidence: chainRegistrationEvidence,
                },
                receipt: { evidence: receiptEvidence },
                serverKeyUpsert,
                receiptBase,
                targetRef: input.request.targetRef,
                appData: data,
              },
            });
          }
          submittedChainAttempts.push(receiptAttempt);
        }
        pendingRegistryAnchorUpsert = {
          payload: chainRegistrationPayload,
          evidence: chainRegistrationEvidence,
          receiptDigest,
          receiptEvidence,
          registryStatus: "active",
          stage: "receipt",
        };
      }
    } catch (error) {
      if (chainRegistrationEvidence.mode === "required") {
        return recordExternalAppExecutionReceipt(
          input.governanceStore,
          receiptBase,
          {
            executionStatus: "failed",
            errorCode: normalizeExternalAppExecutionErrorCode(
              (error as Error).message,
              "external_app_registry_receipt_anchor_failed",
            ),
          },
        );
      }
    }
  }

  if (
    !serverKeyUpsert &&
    chainRegistrationPayload &&
    chainRegistrationEvidence?.status === "submitted" &&
    chainReceiptEvidence?.status === "submitted" &&
    acceptedManifestHash &&
    acceptedManifestServerPublicKey
  ) {
    serverKeyUpsert = buildInitialExternalAppServerKeyUpsert({
      externalAppId: chainRegistrationPayload.externalAppId,
      manifestHash: acceptedManifestHash,
      serverPublicKey: acceptedManifestServerPublicKey,
      executedAt: input.now,
      executionReceiptId: receiptBase.id,
      requestId: input.request.id,
      actionType,
      registryTxSignature: chainRegistrationEvidence.txSignature ?? null,
      receiptTxSignature: chainReceiptEvidence.txSignature ?? null,
    });
  }

  if (
    chainServerKeyRotationPayload &&
    chainServerKeyRotationEvidence?.status === "submitted" &&
    input.chainRegistry
  ) {
    const receiptDigest = computeGovernanceExecutionReceiptDigest(
      pendingExecutionReceipt,
    );
    const receiptAttempt = await persistRegistryChainAttempt(input.prisma, {
      requestId: input.request.id,
      actionType,
      stage: "receipt",
      intentDigest: receiptDigest,
      receiptDigest,
      metadata: {
        targetRef: input.request.targetRef,
        appData: data,
        rotation: {
          payload: chainServerKeyRotationPayload,
          evidence: chainServerKeyRotationEvidence,
        },
        receiptBase,
      },
    });
    if (
      receiptAttempt &&
      !(await claimRegistryChainAttemptForBroadcast(
        input.prisma as any,
        receiptAttempt,
      ))
    ) {
      return recordExternalAppExecutionReceipt(
        input.governanceStore,
        receiptBase,
        {
          executionStatus: "failed",
          errorCode: "external_app_registry_chain_attempt_broadcast_ambiguous",
        },
      );
    }
    try {
      const receiptEvidence = await input.chainRegistry.anchorExecutionReceipt({
        externalAppId: chainServerKeyRotationPayload.externalAppId,
        appIdHash: chainServerKeyRotationPayload.appIdHash,
        expectedDecisionDigest: chainServerKeyRotationPayload.decisionDigest,
        expectedExecutionIntentDigest:
          chainServerKeyRotationPayload.executionIntentDigest,
        executionReceiptDigest: receiptDigest,
      });
      if (shouldFailClosedMissingRegistryEvidence(receiptEvidence)) {
        return recordExternalAppExecutionReceipt(
          input.governanceStore,
          receiptBase,
          {
            executionStatus: "failed",
            errorCode: registryEvidenceErrorCode(
              receiptEvidence,
              "external_app_registry_receipt_anchor_required",
            ),
          },
        );
      }
      const newServerPublicKey = normalizeRequiredString(
        input.request.payload.newServerPublicKey,
        "external_app_server_public_key_required",
      );
      serverKeyUpsert = buildRotatedExternalAppServerKeyUpsert({
        externalAppId: input.request.targetRef,
        serverPublicKey: newServerPublicKey,
        executedAt: input.now,
        executionReceiptId: receiptBase.id,
        requestId: input.request.id,
        actionType,
        registryTxSignature: chainServerKeyRotationEvidence.txSignature ?? null,
        receiptTxSignature: receiptEvidence.txSignature ?? null,
        idempotencyKey: buildKeyOperationIdempotencyKey({
          externalAppId: input.request.targetRef,
          actionType: "external_app_server_key_rotate",
          keyMaterialRef: chainServerKeyRotationPayload.serverKeyHash,
          payloadIdempotencyKey: input.request.payload.idempotencyKey,
        }),
      });
      if (receiptAttempt) {
        try {
          await markAttemptSubmitted(input.prisma as any, receiptAttempt, {
            txSignature: receiptEvidence.txSignature,
            receiptDigest,
            cluster: receiptEvidence.cluster,
            metadata: {
              targetRef: input.request.targetRef,
              appData: data,
              rotation: {
                payload: chainServerKeyRotationPayload,
                evidence: chainServerKeyRotationEvidence,
              },
              receipt: { evidence: receiptEvidence },
              serverKeyUpsert,
              previousServerKeyUpdate,
              receiptBase,
            },
          });
        } catch {
          return recordAttemptSubmissionPersistenceFailure({
            governanceStore: input.governanceStore,
            receiptBase,
            stage: "receipt",
            attempt: receiptAttempt,
            txSignature: receiptEvidence.txSignature,
            cluster: receiptEvidence.cluster,
            recordPda: receiptEvidence.recordPda,
            metadata: {
              rotation: {
                payload: chainServerKeyRotationPayload,
                evidence: chainServerKeyRotationEvidence,
              },
              receipt: { evidence: receiptEvidence },
              serverKeyUpsert,
              previousServerKeyUpdate,
              receiptBase,
              targetRef: input.request.targetRef,
              appData: data,
            },
          });
        }
        submittedChainAttempts.push(receiptAttempt);
      }
      registryAnchorRotationProjection = {
        payload: chainServerKeyRotationPayload,
        evidence: chainServerKeyRotationEvidence,
        receiptDigest,
        receiptEvidence,
      };
    } catch (error) {
      return recordExternalAppExecutionReceipt(
        input.governanceStore,
        receiptBase,
        {
          executionStatus: "failed",
          errorCode: normalizeExternalAppExecutionErrorCode(
            (error as Error).message,
            "external_app_registry_receipt_anchor_failed",
          ),
        },
      );
    }
  }

  const requiredRegistryEvidence = [
    chainRegistrationEvidence,
    chainReceiptEvidence,
    chainServerKeyRotationEvidence,
    registryAnchorRotationProjection?.receiptEvidence ?? null,
  ].some(
    (evidence) =>
      evidence?.mode === "required" && evidence.status === "submitted",
  );
  if (requiredRegistryEvidence) {
    // A successful RPC submission is not an authoritative effect. Required
    // mode materializes App/Anchor/key/receipt facts only after the finalized
    // account decoder has proven the exact frozen decision, intent and receipt.
    const finalized = await recoverSubmittedRegistryAttemptsBeforeResubmit({
      prisma: input.prisma,
      governanceStore: input.governanceStore,
      requestId: input.request.id,
      receiptBase,
      chainRegistry: input.chainRegistry,
    });
    if (finalized) return finalized;
    return recordExternalAppExecutionReceipt(
      input.governanceStore,
      receiptBase,
      {
        executionStatus: "failed",
        errorCode: "external_app_registry_chain_readback_pending",
        executionEvidence: {
          retryable: true,
          submittedAttemptIds: submittedChainAttempts.map(
            (attempt) => attempt.id,
          ),
        },
      },
    );
  }

  try {
    const receipt = await persistExternalAppMutationAndReceipt({
      prisma: input.prisma,
      governanceStore: input.governanceStore,
      targetRef: input.request.targetRef,
      data,
      receiptBase,
      executionStatus: "executed",
      errorCode: null,
      serverKeyUpsert,
      previousServerKeyUpdate,
      serverKeyRevocationUpdate,
      provisioningGrantUpsert,
      provisioningEventCreate,
      appealResolutionEvidence,
      pendingRegistryAnchorUpsert,
      registryAnchorRotationProjection,
    });
    for (const attempt of submittedChainAttempts) {
      try {
        await markAttemptReconciled(input.prisma as any, attempt);
      } catch {
        // The completed local transaction remains authoritative; restart recovery
        // can safely re-run an idempotent submitted attempt.
      }
    }
    return receipt;
  } catch (error) {
    if (submittedChainAttempts.length === 0) throw error;
    return recordExternalAppExecutionReceipt(
      input.governanceStore,
      receiptBase,
      {
        executionStatus: "failed",
        errorCode: "external_app_local_persist_failed",
      },
    );
  }
}

interface ExternalAppDecisionPrisma {
  externalApp: {
    findUnique?(input: unknown): Promise<ExternalAppExecutionAppRecord | null>;
    update(input: unknown): Promise<unknown>;
  };
  externalAppServerKey?: {
    findFirst?(input: unknown): Promise<{ status: string } | null>;
    upsert(input: unknown): Promise<unknown>;
    updateMany(input: unknown): Promise<{ count?: number } | unknown>;
  };
  externalAppRegistryAnchor?: {
    upsert(input: unknown): Promise<unknown>;
    update?(input: unknown): Promise<unknown>;
  };
  externalAppRegistryChainAttempt?: {
    upsert(input: unknown): Promise<RegistryChainAttemptRecord>;
    update(input: unknown): Promise<unknown>;
    updateMany?(input: unknown): Promise<{ count?: number }>;
    findMany?(input: unknown): Promise<RegistryChainAttemptRecord[]>;
    findFirst?(input: unknown): Promise<RegistryChainAttemptRecord | null>;
  };
  externalAppProvisioningGrant?: {
    upsert(input: unknown): Promise<unknown>;
  };
  externalAppProvisioningEvent?: {
    create(input: unknown): Promise<unknown>;
  };
  governanceExecutionReceipt?: {
    findUnique(input: unknown): Promise<unknown>;
    create?(input: unknown): Promise<unknown>;
  };
  $transaction?<T>(
    callback: (tx: ExternalAppDecisionTransactionPrisma) => Promise<T>,
  ): Promise<T>;
}

async function recoverSubmittedRegistryAttemptsBeforeResubmit(input: {
  prisma: ExternalAppDecisionPrisma;
  governanceStore: GovernanceEngineStore;
  requestId: string;
  receiptBase: {
    id: string;
    requestId: string;
    actionType: string;
    executorModule: string;
    executionRef: string;
    decisionDigest: string;
    idempotencyKey: string;
    executedAt: Date;
  };
  chainRegistry?: ExternalAppExecutionChainRegistry;
}): Promise<Awaited<
  ReturnType<typeof recordExternalAppExecutionReceipt>
> | null> {
  const findMany = input.prisma.externalAppRegistryChainAttempt?.findMany;
  if (typeof findMany !== "function") return null;

  const attempts = await findMany({
    where: {
      requestId: input.requestId,
      OR: [
        {
          status: "submitted",
          OR: [
            { txSignature: { not: null } },
            { chainStateSlot: { not: null } },
          ],
        },
        { status: "broadcasting", txSignature: null },
      ],
      NOT: {
        errorCode: "external_app_registry_chain_readback_tx_failed",
      },
    },
    orderBy: { updatedAt: "asc" },
    take: 10,
  });
  if (!attempts.length) return null;
  const orderedAttempts = [...attempts].sort(
    (left, right) =>
      (right.stage === "receipt" ? 1 : 0) - (left.stage === "receipt" ? 1 : 0),
  );
  const chainRegistry = input.chainRegistry?.readback
    ? input.chainRegistry
    : createRegistryChainAttemptReadbackFromEnv();
  for (const attempt of orderedAttempts) {
    if (attempt.status === "broadcasting") {
      // A send may have succeeded before the DB could store its signature.
      // Never infer the signature from a failure receipt and never rebroadcast.
      // The lease-aware cron verifies the finalized record PDA post-state.
      return recordExternalAppExecutionReceipt(
        input.governanceStore,
        input.receiptBase,
        {
          executionStatus: "failed",
          errorCode: "external_app_registry_chain_readback_pending",
          executionEvidence: {
            attemptId: attempt.id,
            stage: attempt.stage,
            txSignature: null,
            readbackError:
              "external_app_registry_chain_broadcast_recovery_pending",
            retryable: true,
          },
        },
      );
    }
    try {
      const terminalReceipt = await reconcileExternalAppRegistryChainAttempt(
        input.prisma as any,
        attempt,
        chainRegistry,
      );
      if (terminalReceipt) return terminalReceipt;
    } catch (error) {
      const code = error instanceof Error ? error.message : String(error || "");
      if (code === "external_app_registry_chain_readback_tx_failed") {
        try {
          await markAttemptFailed(input.prisma as any, attempt, code);
        } catch {
          // Keep attempting on later retries.
        }
        return recordExternalAppExecutionReceipt(
          input.governanceStore,
          {
            ...input.receiptBase,
          },
          {
            executionStatus: "failed",
            errorCode: "external_app_registry_chain_readback_tx_failed",
          },
        );
      }
      if (isRegistryChainReadbackRepairRequiredError(code)) {
        const repairCode =
          "external_app_registry_chain_readback_conflict_requires_repair";
        try {
          await markAttemptFailed(input.prisma as any, attempt, repairCode);
        } catch {
          // The cron owns the same terminal repair transition if this CAS loses.
        }
        return recordExternalAppExecutionReceipt(
          input.governanceStore,
          input.receiptBase,
          {
            executionStatus: "failed",
            errorCode: repairCode,
            executionEvidence: {
              attemptId: attempt.id,
              stage: attempt.stage,
              txSignature: attempt.txSignature ?? null,
              readbackError: code,
              retryable: false,
              requiresRepair: true,
            },
          },
        );
      }
      // A submitted transaction with incomplete/transient readback is an active
      // recovery barrier. Do not advance to, or rebroadcast, any later stage.
      return recordExternalAppExecutionReceipt(
        input.governanceStore,
        input.receiptBase,
        {
          executionStatus: "failed",
          errorCode: "external_app_registry_chain_readback_pending",
          executionEvidence: {
            attemptId: attempt.id,
            stage: attempt.stage,
            txSignature: attempt.txSignature ?? null,
            readbackError: code,
            retryable: true,
          },
        },
      );
    }
  }
  const existing =
    typeof input.prisma.governanceExecutionReceipt?.findUnique === "function"
      ? await input.prisma.governanceExecutionReceipt.findUnique({
          where: { id: input.receiptBase.id },
        })
      : null;
  if (
    existing &&
    String((existing as any).executionStatus || "") === "executed"
  ) {
    return existing as any;
  }
  // Registration/rotation may be on-chain while receipt stage is still missing.
  // Return null so the caller can continue without re-submitting completed stages.
  return null;
}

function recordAttemptSubmissionPersistenceFailure(input: {
  governanceStore: GovernanceEngineStore;
  receiptBase: {
    id: string;
    requestId: string;
    actionType: string;
    executorModule: string;
    executionRef: string;
    decisionDigest: string;
    idempotencyKey: string;
    executedAt: Date;
  };
  stage: RegistryChainAttemptRecord["stage"];
  attempt: RegistryChainAttemptRecord;
  txSignature?: string | null;
  cluster?: string | null;
  recordPda?: string | null;
  metadata: Record<string, unknown>;
}) {
  return recordExternalAppExecutionReceipt(
    input.governanceStore,
    input.receiptBase,
    {
      executionStatus: "failed",
      errorCode:
        "external_app_registry_chain_attempt_submission_persistence_failed",
      executionEvidence: canonicalExternalAppExecutionEvidence({
        chainSubmissionPersistenceFailed: true,
        stage: input.stage,
        attemptId: input.attempt.id,
        txSignature: input.txSignature ?? null,
        cluster: input.cluster ?? null,
        recordPda: input.recordPda ?? null,
        ...input.metadata,
      }),
    },
  );
}

function canonicalExternalAppExecutionEvidence(
  value: Record<string, unknown>,
): Record<string, unknown> {
  return JSON.parse(JSON.stringify(value)) as Record<string, unknown>;
}

async function findRecoverableRegistryAttempt(
  prisma: ExternalAppDecisionPrisma,
  input: { requestId: string; stage: RegistryChainAttemptRecord["stage"] },
): Promise<RegistryChainAttemptRecord | null> {
  const findFirst = prisma.externalAppRegistryChainAttempt?.findFirst;
  if (typeof findFirst !== "function") return null;
  return findFirst({
    where: {
      requestId: input.requestId,
      stage: input.stage,
      NOT: {
        errorCode: "external_app_registry_chain_readback_tx_failed",
      },
      OR: [
        { status: "broadcasting" },
        { status: "submitted" },
        { status: "reconciled" },
      ],
    },
    orderBy: { updatedAt: "desc" },
  });
}

async function persistRegistryChainAttempt(
  prisma: ExternalAppDecisionPrisma,
  input: Parameters<typeof persistQuotedAttempt>[1],
): Promise<RegistryChainAttemptRecord | null> {
  const registryMode = parseExternalAppRegistryMode(
    process.env.EXTERNAL_APP_REGISTRY_MODE,
  );
  if (!prisma.externalAppRegistryChainAttempt) {
    // Any mode that can submit on-chain must keep a durable attempt for recovery.
    if (registryMode === "required" || registryMode === "optional") {
      throw new Error(
        "external_app_registry_chain_attempt_persistence_required",
      );
    }
    return null;
  }
  return persistQuotedAttempt(prisma as any, input);
}

export async function reconcileSubmittedExternalAppRegistryChainAttempt(
  prisma: ExternalAppDecisionPrisma,
  attempt: RegistryChainAttemptRecord,
  chainRegistry?: ExternalAppExecutionChainRegistry,
): Promise<void> {
  await reconcileExternalAppRegistryChainAttempt(
    prisma as any,
    attempt,
    chainRegistry,
  );
}

interface ExternalAppDecisionTransactionPrisma {
  externalApp: {
    findUnique?(input: unknown): Promise<ExternalAppExecutionAppRecord | null>;
    update(input: unknown): Promise<unknown>;
  };
  externalAppServerKey?: {
    findFirst?(input: unknown): Promise<{ status: string } | null>;
    upsert(input: unknown): Promise<unknown>;
    updateMany(input: unknown): Promise<{ count?: number } | unknown>;
  };
  externalAppRegistryAnchor?: {
    upsert(input: unknown): Promise<unknown>;
    update?(input: unknown): Promise<unknown>;
  };
  externalAppProvisioningGrant?: {
    upsert(input: unknown): Promise<unknown>;
  };
  externalAppProvisioningEvent?: {
    create(input: unknown): Promise<unknown>;
  };
  governanceExecutionReceipt: {
    findUnique(input: unknown): Promise<unknown>;
    create(input: unknown): Promise<unknown>;
  };
  governanceCase?: {
    findUnique(
      input: unknown,
    ): Promise<{ id: string; subjectType: string; subjectRef: string } | null>;
  };
  decisionOutputArtifact?: {
    findUnique(input: unknown): Promise<unknown>;
    create(input: unknown): Promise<unknown>;
  };
}

interface ExternalAppExecutionAppRecord {
  ownerPubkey?: string | null;
  serverPublicKey?: string | null;
  status?: string | null;
  registryStatus?: string | null;
  environment?: string | null;
  discoveryStatus?: string | null;
}

async function loadExternalAppForExecution(
  prisma: ExternalAppDecisionPrisma,
  input: { externalAppId: string },
): Promise<ExternalAppExecutionAppRecord | null> {
  if (typeof prisma.externalApp.findUnique !== "function") return null;
  return prisma.externalApp.findUnique({
    where: { id: input.externalAppId },
    select: {
      ownerPubkey: true,
      serverPublicKey: true,
      status: true,
      registryStatus: true,
      environment: true,
      discoveryStatus: true,
    },
  });
}

function isActiveProductionExternalApp(
  app: ExternalAppExecutionAppRecord | null,
): boolean {
  return (
    app?.status === "active" &&
    app.registryStatus === "active" &&
    app.environment === "mainnet_production"
  );
}

function buildKeyOperationIdempotencyKey(input: {
  externalAppId: string;
  actionType:
    | "external_app_server_key_rotate"
    | "external_app_server_key_revoke";
  keyMaterialRef: string;
  payloadIdempotencyKey: unknown;
}): string {
  return (
    normalizeOptionalString(input.payloadIdempotencyKey) ??
    [input.externalAppId, input.actionType, input.keyMaterialRef].join(":")
  );
}

function buildDeterministicExternalAppReceiptId(input: {
  requestId: string;
  actionType: string;
  decisionDigest: string;
}): string {
  const digest = createHash("sha256")
    .update(
      [input.requestId, input.actionType, input.decisionDigest].join("\0"),
    )
    .digest("hex");
  return `external_app_receipt:${digest}`;
}

function buildDeterministicExternalAppFailureMarker(input: {
  receiptId: string;
  requestId: string;
  actionType: string;
  decisionDigest: string;
  idempotencyKey: string;
  errorCode: string;
}): { id: string; idempotencyKey: string } {
  const digest = createHash("sha256")
    .update(
      [
        input.receiptId,
        input.requestId,
        input.actionType,
        input.decisionDigest,
        input.idempotencyKey,
        input.errorCode,
      ].join("\0"),
    )
    .digest("hex");
  return {
    id: `external_app_failure_receipt:${digest}`,
    idempotencyKey: `external_app_failure:${digest}`,
  };
}

function normalizeProvisioningDecisionDigest(
  input: {
    request: ExternalAppDecisionRequest;
    decision: { decision: string; decisionDigest?: string | null };
    now: Date;
  },
  actionType:
    | "external_app_provisioning_grant"
    | "external_app_provisioning_revoke",
): string {
  const environment = normalizeRequiredString(
    input.request.payload.environment,
    "external_app_provisioning_environment_required",
  );
  if (actionType === "external_app_provisioning_grant") {
    normalizeProvisioningStatusForMutation(input.request.payload.status);
  }
  if (
    environment === "mainnet_production" &&
    !normalizeOptionalString(input.decision.decisionDigest)
  ) {
    throw new Error("external_app_provisioning_decision_digest_required");
  }
  return normalizeDecisionDigest(input);
}

function normalizeProvisioningStatusForMutation(
  value: unknown,
): NonNullable<ReturnType<typeof normalizeProvisioningStatus>> {
  const raw = normalizeOptionalString(value);
  if (!raw) return "approved";
  const status = normalizeProvisioningStatus(raw);
  if (!status) {
    throw new Error("external_app_provisioning_status_invalid");
  }
  return status;
}

function normalizeOptionalProvisioningRecordId(
  value: unknown,
  errorCode: string,
): string | null {
  const normalized = normalizeOptionalString(value);
  if (!normalized) return null;
  if (normalized.length > MAX_PROVISIONING_RECORD_ID_LENGTH) {
    throw new Error(errorCode);
  }
  return normalized;
}

function buildProvisioningRecordId(
  prefix: "epg" | "epe",
  parts: unknown[],
): string {
  const hash = createHash("sha256");
  for (const part of parts) {
    const value = String(part ?? "");
    hash.update(String(value.length));
    hash.update(":");
    hash.update(value);
    hash.update("\0");
  }
  return `${prefix}_${hash.digest("hex")}`;
}

function withProvisioningEventGrantId(
  eventCreate: ProvisioningEventCreateInput,
  grantRecord: unknown,
): ProvisioningEventCreateInput {
  const grantId =
    grantRecord && typeof grantRecord === "object"
      ? normalizeOptionalString((grantRecord as { id?: unknown }).id)
      : null;
  if (!grantId) return eventCreate;
  return {
    ...eventCreate,
    data: {
      ...eventCreate.data,
      grantId,
    },
  };
}

async function verifyKeyOperationOwnerAssertionForExecution(
  prisma: ExternalAppDecisionPrisma,
  input: {
    externalAppId: string;
    actionType:
      | "external_app_server_key_rotate"
      | "external_app_server_key_revoke";
    audience:
      | "alcheme:external-app-server-key-rotation"
      | "alcheme:external-app-server-key-revocation";
    newServerPublicKeyHash: string | null;
    previousKeyVersion: string | null;
    previousKeyGraceUntil: string | null;
    keyVersion: string | null;
    idempotencyKey: string;
    ownerAssertion: unknown;
    now: Date;
  },
): Promise<string | null> {
  try {
    const app = await loadExternalAppForExecution(prisma, {
      externalAppId: input.externalAppId,
    });
    if (!app?.ownerPubkey) {
      throw new Error("external_app_not_found");
    }
    verifyExternalAppKeyOperationOwnerAssertion({
      assertion: normalizeOwnerAssertion(input.ownerAssertion),
      expected: {
        appId: input.externalAppId,
        ownerPubkey: app.ownerPubkey,
        audience: input.audience,
        action: input.actionType,
        newServerPublicKeyHash: input.newServerPublicKeyHash,
        previousKeyVersion: input.previousKeyVersion,
        previousKeyGraceUntil: input.previousKeyGraceUntil,
        keyVersion: input.keyVersion,
        idempotencyKey: input.idempotencyKey,
      },
      now: input.now,
    });
    return null;
  } catch (error) {
    return normalizeExternalAppExecutionErrorCode(
      error instanceof Error ? error.message : String(error),
      "external_app_owner_assertion_mismatch",
    );
  }
}

function buildProvisioningMutation(input: {
  actionType:
    | "external_app_provisioning_grant"
    | "external_app_provisioning_revoke";
  externalAppId: string;
  payload: Record<string, unknown>;
  requestId: string;
  decisionDigest: string;
  executionReceiptId: string;
  now: Date;
}): {
  grantUpsert: ProvisioningGrantUpsertInput;
  eventCreate: ProvisioningEventCreateInput;
} {
  const capability = normalizeProvisioningCapability(input.payload.capability);
  if (!capability) {
    throw new Error("external_app_provisioning_capability_invalid");
  }
  const environment = normalizeRequiredString(
    input.payload.environment,
    "external_app_provisioning_environment_required",
  );
  const status =
    input.actionType === "external_app_provisioning_revoke"
      ? "revoked"
      : normalizeProvisioningStatusForMutation(input.payload.status);
  const grantId =
    normalizeOptionalProvisioningRecordId(
      input.payload.grantId,
      "external_app_provisioning_grant_id_invalid",
    ) ??
    buildProvisioningRecordId("epg", [
      input.externalAppId,
      environment,
      capability,
    ]);
  const provider = normalizeOptionalString(input.payload.provider);
  const runtimeBaseUrl = normalizeOptionalString(input.payload.runtimeBaseUrl);
  const failureCode = normalizeOptionalString(input.payload.failureCode);
  const reasonCode =
    normalizeOptionalString(input.payload.reasonCode) ??
    (input.actionType === "external_app_provisioning_revoke"
      ? "governed_revoke"
      : "governed_grant");
  const commonGrantData = {
    status,
    provider,
    runtimeBaseUrl,
    failureCode,
    governanceRequestId: input.requestId,
    sourceDecisionDigest: input.decisionDigest,
    sourceExecutionReceiptId: input.executionReceiptId,
    operatorOverrideReason: null,
    metadata: normalizePlainObject(input.payload.metadata),
    updatedAt: input.now,
  };
  return {
    grantUpsert: {
      where: {
        externalAppId_environment_capability: {
          externalAppId: input.externalAppId,
          environment,
          capability,
        },
      },
      create: {
        id: grantId,
        externalAppId: input.externalAppId,
        environment,
        capability,
        requestedByPubkey: normalizeOptionalString(
          input.payload.requestedByPubkey,
        ),
        approvedByPubkey: null,
        revokedByPubkey: null,
        healthStatus: normalizeOptionalString(input.payload.healthStatus),
        healthCheckedAt: normalizeOptionalDate(
          input.payload.healthCheckedAt,
          "invalid_external_app_provisioning_health_checked_at",
        ),
        expiresAt: normalizeOptionalDate(
          input.payload.expiresAt,
          "invalid_external_app_provisioning_expires_at",
        ),
        createdAt: input.now,
        ...commonGrantData,
      },
      update: {
        approvedByPubkey: null,
        revokedByPubkey: null,
        healthStatus: normalizeOptionalString(input.payload.healthStatus),
        healthCheckedAt: normalizeOptionalDate(
          input.payload.healthCheckedAt,
          "invalid_external_app_provisioning_health_checked_at",
        ),
        expiresAt: normalizeOptionalDate(
          input.payload.expiresAt,
          "invalid_external_app_provisioning_expires_at",
        ),
        ...commonGrantData,
      },
    },
    eventCreate: {
      data: {
        id:
          normalizeOptionalProvisioningRecordId(
            input.payload.eventId,
            "external_app_provisioning_event_id_invalid",
          ) ??
          buildProvisioningRecordId("epe", [
            grantId,
            input.actionType,
            input.requestId,
            input.executionReceiptId,
          ]),
        grantId,
        externalAppId: input.externalAppId,
        eventType: input.actionType,
        actorPubkey: null,
        status,
        reasonCode,
        metadata: {
          requestId: input.requestId,
          decisionDigest: input.decisionDigest,
          executionReceiptId: input.executionReceiptId,
        },
      },
    },
  };
}

function normalizeOwnerAssertion(value: unknown): {
  payload: string;
  signature: string;
} {
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

function normalizeRequiredString(value: unknown, errorCode: string): string {
  const normalized = String(value || "").trim();
  if (!normalized) throw new Error(errorCode);
  return normalized;
}

function normalizeOptionalString(value: unknown): string | null {
  const normalized = String(value || "").trim();
  return normalized ? normalized : null;
}

function normalizeOptionalDate(
  value: unknown,
  errorCode = "invalid_external_app_server_key_grace_until",
): Date | null {
  if (value == null || value === "") return null;
  const date = value instanceof Date ? value : new Date(String(value));
  if (!Number.isFinite(date.getTime())) {
    throw new Error(errorCode);
  }
  return date;
}

function normalizePlainObject(value: unknown): Record<string, unknown> | null {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    return null;
  }
  return value as Record<string, unknown>;
}

function recordExternalAppExecutionReceipt(
  governanceStore: GovernanceEngineStore,
  receiptBase: {
    id: string;
    requestId: string;
    actionType: string;
    executorModule: string;
    executionRef: string;
    decisionDigest: string;
    idempotencyKey: string;
    executedAt: Date;
  },
  input: {
    executionStatus: "executed" | "failed" | "skipped";
    errorCode: string | null;
    executionEvidence?: Record<string, unknown> | null;
  },
) {
  const errorCode = input.errorCode
    ? normalizeExternalAppExecutionErrorCode(
        input.errorCode,
        "external_app_execution_failed",
      )
    : null;
  const failureMarker =
    input.executionStatus === "failed" && errorCode
      ? buildDeterministicExternalAppFailureMarker({
          receiptId: receiptBase.id,
          requestId: receiptBase.requestId,
          actionType: receiptBase.actionType,
          decisionDigest: receiptBase.decisionDigest,
          idempotencyKey: receiptBase.idempotencyKey,
          errorCode,
        })
      : null;
  return recordExecutionReceipt(governanceStore, {
    ...receiptBase,
    ...(failureMarker ?? {}),
    executionStatus: input.executionStatus,
    errorCode,
    executionEvidence: input.executionEvidence ?? null,
  });
}

async function persistExternalAppMutationAndReceipt(input: {
  prisma: ExternalAppDecisionPrisma;
  governanceStore: GovernanceEngineStore;
  targetRef: string;
  data: Record<string, unknown>;
  receiptBase: {
    id: string;
    requestId: string;
    actionType: string;
    executorModule: string;
    executionRef: string;
    decisionDigest: string;
    idempotencyKey: string;
    executedAt: Date;
  };
  executionStatus: "executed";
  errorCode: null;
  serverKeyUpsert?: unknown | null;
  previousServerKeyUpdate?: unknown | null;
  serverKeyRevocationUpdate?: unknown | null;
  provisioningGrantUpsert?: ProvisioningGrantUpsertInput | null;
  provisioningEventCreate?: ProvisioningEventCreateInput | null;
  appealResolutionEvidence?: Record<string, unknown> | null;
  pendingRegistryAnchorUpsert?: {
    payload: ExternalAppChainRegistrationPayload;
    evidence: ExternalAppRegistryEvidence;
    receiptDigest?: string;
    receiptEvidence?: ExternalAppRegistryEvidence;
    registryStatus: string;
    stage: "registration" | "receipt";
  } | null;
  registryAnchorRotationProjection?: {
    payload: ExternalAppChainServerKeyRotationPayload;
    evidence: ExternalAppRegistryEvidence;
    receiptDigest: string;
    receiptEvidence: ExternalAppRegistryEvidence;
  } | null;
}) {
  const hasProvisioningMutation =
    !!input.provisioningGrantUpsert || !!input.provisioningEventCreate;
  const hasRegistryAnchorMutation =
    !!input.pendingRegistryAnchorUpsert ||
    !!input.registryAnchorRotationProjection;
  if (
    (hasProvisioningMutation ||
      !!input.appealResolutionEvidence ||
      hasRegistryAnchorMutation) &&
    typeof input.prisma.$transaction !== "function"
  ) {
    return recordExternalAppExecutionReceipt(
      input.governanceStore,
      input.receiptBase,
      {
        executionStatus: "failed",
        errorCode: input.appealResolutionEvidence
          ? "external_app_appeal_resolution_transaction_required"
          : hasRegistryAnchorMutation
            ? "external_app_registry_anchor_transaction_required"
            : "external_app_provisioning_transaction_required",
      },
    );
  }

  if (typeof input.prisma.$transaction === "function") {
    return input.prisma.$transaction(async (tx) => {
      if (Object.keys(input.data).length > 0) {
        await tx.externalApp.update({
          where: { id: input.targetRef },
          data: input.data,
        });
        if (
          String((input.data as any).environment || "") === "mainnet_production"
        ) {
          await quarantineSandboxCircleBindingsForEnvironmentUpgrade(tx, {
            externalAppId: input.targetRef,
            authorityNow: input.receiptBase.executedAt,
            reason: "app_environment_upgraded_to_mainnet_production",
          });
        }
      }
      if (input.serverKeyUpsert) {
        await tx.externalAppServerKey?.upsert(input.serverKeyUpsert);
      }
      if (input.previousServerKeyUpdate) {
        assertSingleRowUpdated(
          await tx.externalAppServerKey?.updateMany(
            input.previousServerKeyUpdate,
          ),
          "external_app_server_key_update_conflict",
        );
      }
      if (input.serverKeyRevocationUpdate) {
        assertSingleRowUpdated(
          await tx.externalAppServerKey?.updateMany(
            input.serverKeyRevocationUpdate,
          ),
          "external_app_server_key_update_conflict",
        );
      }
      if (input.pendingRegistryAnchorUpsert) {
        await upsertExternalAppRegistryAnchor(
          tx,
          input.pendingRegistryAnchorUpsert,
        );
      }
      if (input.registryAnchorRotationProjection) {
        await updateExternalAppRegistryAnchorRotation(tx, {
          ...input.registryAnchorRotationProjection,
          stage: "server_key_rotation",
        });
      }
      const provisioningGrantRecord = input.provisioningGrantUpsert
        ? await tx.externalAppProvisioningGrant?.upsert(
            input.provisioningGrantUpsert,
          )
        : null;
      if (input.provisioningEventCreate) {
        await tx.externalAppProvisioningEvent?.create(
          withProvisioningEventGrantId(
            input.provisioningEventCreate,
            provisioningGrantRecord,
          ),
        );
      }
      const receipt = await recordExternalAppExecutionReceipt(
        createPrismaGovernanceEngineStore(tx as any),
        input.receiptBase,
        {
          executionStatus: input.executionStatus,
          errorCode: input.errorCode,
          executionEvidence: input.appealResolutionEvidence,
        },
      );
      if (input.appealResolutionEvidence) {
        const governanceCase = await tx.governanceCase?.findUnique({
          where: { primaryRequestId: input.receiptBase.requestId },
          select: { id: true, subjectType: true, subjectRef: true },
        });
        if (!governanceCase || !tx.decisionOutputArtifact) {
          throw new Error("external_app_appeal_resolution_case_required");
        }
        await persistExternalAppAppealResolutionOutputArtifact(tx, {
          governanceCase,
          request: {
            id: input.receiptBase.requestId,
            actionType: input.receiptBase.actionType,
            targetType: "external_app",
            targetRef: input.targetRef,
            payload: input.appealResolutionEvidence,
          },
          decision: {
            decision: "accepted",
            decisionDigest: input.receiptBase.decisionDigest,
          },
          executionReceiptId: receipt.id,
          now: input.receiptBase.executedAt,
        });
      }
      return receipt;
    });
  }

  if (Object.keys(input.data).length > 0) {
    await input.prisma.externalApp.update({
      where: { id: input.targetRef },
      data: input.data,
    });
  }
  if (input.serverKeyUpsert) {
    await input.prisma.externalAppServerKey?.upsert(input.serverKeyUpsert);
  }
  if (input.previousServerKeyUpdate) {
    assertSingleRowUpdated(
      await input.prisma.externalAppServerKey?.updateMany(
        input.previousServerKeyUpdate,
      ),
      "external_app_server_key_update_conflict",
    );
  }
  if (input.serverKeyRevocationUpdate) {
    assertSingleRowUpdated(
      await input.prisma.externalAppServerKey?.updateMany(
        input.serverKeyRevocationUpdate,
      ),
      "external_app_server_key_update_conflict",
    );
  }
  const provisioningGrantRecord = input.provisioningGrantUpsert
    ? await input.prisma.externalAppProvisioningGrant?.upsert(
        input.provisioningGrantUpsert,
      )
    : null;
  if (input.provisioningEventCreate) {
    await input.prisma.externalAppProvisioningEvent?.create(
      withProvisioningEventGrantId(
        input.provisioningEventCreate,
        provisioningGrantRecord,
      ),
    );
  }
  return recordExternalAppExecutionReceipt(
    input.governanceStore,
    input.receiptBase,
    {
      executionStatus: input.executionStatus,
      errorCode: input.errorCode,
    },
  );
}

function isUsableSubmittedRegistryEvidence(
  evidence: ExternalAppRegistryEvidence | null,
): evidence is ExternalAppRegistryEvidence & {
  mode: "required" | "optional";
  status: "submitted";
} {
  return (
    (evidence?.mode === "required" || evidence?.mode === "optional") &&
    evidence.status === "submitted"
  );
}

function shouldFailClosedMissingRegistryEvidence(
  evidence: ExternalAppRegistryEvidence | null,
): boolean {
  if (isUsableSubmittedRegistryEvidence(evidence)) return false;
  // optional+skipped: continue local-only; required/disabled mismatch still fail-closed.
  if (
    parseExternalAppRegistryMode(process.env.EXTERNAL_APP_REGISTRY_MODE) ===
      "optional" &&
    evidence?.status === "skipped"
  ) {
    return false;
  }
  return true;
}

function registryEvidenceErrorCode(
  evidence: ExternalAppRegistryEvidence | null,
  fallback: string,
): string {
  const reason = String(evidence?.reason || "").trim();
  return normalizeExternalAppExecutionErrorCode(reason, fallback);
}

async function loadExternalAppServerKeyForOperation(
  prisma: ExternalAppDecisionPrisma,
  input: { externalAppId: string; keyVersion: string },
): Promise<{ status: string } | null> {
  if (typeof prisma.externalAppServerKey?.findFirst !== "function") {
    return null;
  }
  const key = await prisma.externalAppServerKey.findFirst({
    where: {
      externalAppId: input.externalAppId,
      keyVersion: input.keyVersion,
    },
    select: {
      status: true,
    },
  });
  return key ? { status: String(key.status || "") } : null;
}

function assertSingleRowUpdated(
  result: { count?: number } | unknown,
  errorCode: string,
): void {
  if (
    !result ||
    typeof result !== "object" ||
    (result as { count?: number }).count !== 1
  ) {
    throw new Error(errorCode);
  }
}

async function updateExternalAppRegistryAnchorRotation(
  prisma: {
    externalAppRegistryAnchor?: {
      update?(input: unknown): Promise<unknown>;
    };
  },
  input: {
    payload: ExternalAppChainServerKeyRotationPayload;
    evidence: ExternalAppRegistryEvidence;
    receiptDigest: string;
    receiptEvidence: ExternalAppRegistryEvidence;
    stage: "server_key_rotation";
  },
) {
  if (typeof prisma.externalAppRegistryAnchor?.update !== "function") {
    throw new Error("external_app_registry_anchor_update_unavailable");
  }
  await prisma.externalAppRegistryAnchor.update({
    where: { externalAppId: input.payload.externalAppId },
    data: {
      serverKeyHash: input.payload.serverKeyHash,
      decisionDigest: input.payload.decisionDigest,
      executionIntentDigest: input.payload.executionIntentDigest,
      executionReceiptDigest: input.receiptDigest,
      txSignature: input.evidence.txSignature,
      receiptTxSignature: input.receiptEvidence.txSignature,
      registryStatus: "active",
      finalityStatus: "submitted",
      receiptFinalityStatus: "submitted",
      cluster: input.receiptEvidence.cluster ?? input.evidence.cluster ?? null,
    },
  });
}

async function safeUpdateExternalAppRegistryAnchorRotation(
  prisma: {
    externalAppRegistryAnchor?: {
      update?(input: unknown): Promise<unknown>;
    };
  },
  input: {
    payload: ExternalAppChainServerKeyRotationPayload;
    evidence: ExternalAppRegistryEvidence;
    receiptDigest: string;
    receiptEvidence: ExternalAppRegistryEvidence;
    stage: "server_key_rotation";
  },
) {
  try {
    await updateExternalAppRegistryAnchorRotation(prisma, input);
  } catch (error) {
    console.warn("[external-app-registry] local projection update failed", {
      stage: input.stage,
      externalAppId: input.payload.externalAppId,
      appIdHash: input.payload.appIdHash,
      error: error instanceof Error ? error.message : String(error),
    });
  }
}

function normalizeExternalAppExecutionErrorCode(
  value: unknown,
  fallback: string,
): string {
  const raw = String(value || "").trim();
  if (/^external_app_registry_signer_failed(?::\d+)?$/.test(raw)) {
    return "external_app_registry_signer_failed";
  }
  if (/^[a-z0-9_]+$/.test(raw)) {
    if (raw.length <= 64) return raw;
    const digest = createHash("sha256").update(raw).digest("hex");
    return `external_app_error:${digest.slice(0, 45)}`;
  }
  return fallback;
}

function normalizeDecisionDigest(input: {
  request: ExternalAppDecisionRequest;
  decision: { decision: string; decisionDigest?: string | null };
  now: Date;
}): string {
  if (input.decision.decisionDigest) {
    return normalizeHash32Hex(
      input.decision.decisionDigest,
      "external_app_registry_decision_digest",
    );
  }
  throw new Error("external_app_governance_decision_digest_required");
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
      finalityStatus:
        input.evidence.status === "submitted" ? "submitted" : "pending",
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
      finalityStatus:
        input.evidence.status === "submitted" ? "submitted" : "pending",
      receiptTxSignature: input.receiptEvidence?.txSignature,
      receiptFinalityStatus:
        input.receiptEvidence?.status === "submitted" ? "submitted" : "pending",
    },
  });
}
