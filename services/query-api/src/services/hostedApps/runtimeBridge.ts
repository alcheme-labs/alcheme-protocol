import { randomUUID } from "node:crypto";

import { getHostedAppCapabilityDefinition } from "./capabilityCatalog";
import {
  buildApprovedCircleSummaryResult,
  buildApprovedKnowledgeContextResult,
  buildMembershipStatusResult,
} from "./approvedContextCapabilities";
import {
  applyDataReleaseProfile,
  formatDataReleaseProfileRef,
  resolveCapabilityDataReleaseProfile,
} from "./dataReleaseProfiles";
import { digestJson } from "./digest";
import {
  assertGovernanceOperationRegistered,
  buildHostedAppGovernanceOperationRegistry,
} from "./governanceOperations";
import { assertGovernanceDecisionCanExecute } from "./governanceReceipts";
import {
  assertNativeActionExecutionAllowed,
  buildNativeDraftCreatePreview,
  createHostedAppNativeActionDependencies,
  executeHostedAppNativeAction,
  type HostedAppNativeActionActor,
  type HostedAppNativeActionDependencies,
} from "./nativeActions";
import { buildAccessReceipt, buildActionReceipt } from "./receipts";
import { assertHostedAppReleaseRuntimeGate } from "./runtimeReleaseGates";
import { buildSignatureIntentPreview } from "./signatureProxy";
import { assertUserConsentAllowsCapability } from "./userConsent";
import {
  createHostedAppGovernanceProposalDependencies,
  resolveCurrentHostedAppGovernanceProposerRole,
  type HostedAppGovernanceProposalDependencies,
} from './governanceProposal';

const MIGRATED_MISSING_STATE_PRECONDITION_DIGEST =
  "sha256:0000000000000000000000000000000000000000000000000000000000000000";

type ApprovedKnowledgeContextSourceMaterial = {
  id: number;
  digest: string;
  approvedSummary: string;
  visibility: string;
};

export interface HostedAppCapabilityQueryInput {
  appId: string;
  circleId: number;
  releaseId: string;
  manifestHash: string;
  capabilityId: string;
  params: Record<string, unknown>;
  userPubkey?: string | null;
  userId?: number | null;
}

export async function handleHostedAppCapabilityQuery(
  prisma: any,
  input: HostedAppCapabilityQueryInput,
): Promise<{ ok: true; capabilityId: string; data: unknown; receipt: ReturnType<typeof buildAccessReceipt> }> {
  const capability = getHostedAppCapabilityDefinition(input.capabilityId);
  if (!capability) {
    throw new Error("hosted_app_capability_unknown");
  }
  const { trust, installation } = await assertHostedAppReleaseRuntimeGate(prisma, {
    appId: input.appId,
    circleId: input.circleId,
    manifestHash: input.manifestHash,
    releaseId: input.releaseId,
    userPubkey: input.userPubkey ?? "",
    requestedCapability: input.capabilityId,
  });
  if (!trust.allowedCapabilities.includes(input.capabilityId)) {
    throw new Error("hosted_app_capability_not_trusted");
  }
  if (!installation.allowedCapabilities.includes(input.capabilityId)) {
    throw new Error("hosted_app_capability_not_installed");
  }
  const consentReceipt = capability.requiredUserConsent === "none"
    ? null
    : await loadUserConsentReceipt(prisma, {
      appId: input.appId,
      circleId: input.circleId,
      userPubkey: input.userPubkey ?? "",
      capabilityId: input.capabilityId,
    });
  assertUserConsentAllowsCapability({
    capabilityId: input.capabilityId,
    requiredUserConsent: capability.requiredUserConsent,
    consentReceipt,
  });

  const rawData = await buildCapabilityData(prisma, input);
  const dataReleaseProfile = resolveCapabilityDataReleaseProfile(input.capabilityId);
  if (
    capability.dataReleaseProfileId &&
    capability.dataReleaseProfileId !== dataReleaseProfile.profileId
  ) {
    throw new Error("hosted_app_data_release_profile_mismatch");
  }
  const data = applyDataReleaseProfile({
    profile: dataReleaseProfile,
    payload: asRecordPayload(rawData),
    traceId: resolveDataReleaseTraceId(rawData, input),
  });
  const receipt = buildAccessReceipt({
    appId: input.appId,
    releaseId: input.releaseId,
    manifestHash: input.manifestHash,
    circleId: input.circleId,
    userPubkey: input.userPubkey ?? null,
    capabilityId: input.capabilityId,
    capabilityVersion: capability.implementationVersion,
    policyEpoch: capability.policyEpoch,
    requestParams: input.params,
    returnedData: data,
    redactionProfile: "none",
    dataReleaseProfile: formatDataReleaseProfileRef(dataReleaseProfile),
    decision: "allowed",
  });
  await prisma.hostedAppAccessReceipt.create({ data: mapAccessReceiptForPrisma(receipt) });

  return { ok: true, capabilityId: input.capabilityId, data, receipt };
}

export const queryHostedAppCapability = handleHostedAppCapabilityQuery;

export async function handleHostedAppActionIntent(
  prisma: any,
  input: {
    appId: string;
    circleId: number;
    releaseId: string;
    manifestHash: string;
    actionId: string;
    payload: Record<string, unknown>;
    confirmedPreviewDigest?: string | null;
    userPubkey: string;
    actorUserId?: number | null;
    actor?: HostedAppNativeActionActor | null;
    nativeActionDependencies?: HostedAppNativeActionDependencies;
    governanceProposalDependencies?: HostedAppGovernanceProposalDependencies;
    nodeEnv?: string;
  },
): Promise<{
  ok: true;
  receipt: ReturnType<typeof buildActionReceipt>;
  nativeResultRef?: string | null;
}> {
  if (
    input.actionId !== "create_draft_intent" &&
    input.actionId !== "request_governance_proposal_intent" &&
    input.actionId !== "request_signature_intent"
  ) {
    throw new Error("hosted_app_action_not_implemented");
  }
  const capability = getHostedAppCapabilityDefinition(input.actionId);
  if (!capability) throw new Error("hosted_app_capability_unknown");

  const runtimeGateInput = {
    appId: input.appId,
    circleId: input.circleId,
    manifestHash: input.manifestHash,
    releaseId: input.releaseId,
    userPubkey: input.userPubkey,
    requestedCapability: input.actionId,
  };
  const { trust, installation } = await assertHostedAppReleaseRuntimeGate(prisma, runtimeGateInput);
  if (!trust.allowedCapabilities.includes(input.actionId)) {
    throw new Error("hosted_app_action_not_trusted");
  }
  if (!installation.allowedCapabilities.includes(input.actionId)) {
    throw new Error("hosted_app_action_not_installed");
  }

  const actionPayload = buildActionPayload(input);
  const resolvedLifecyclePolicyDigest = input.actionId === "request_governance_proposal_intent"
    ? await resolveGovernanceOperationLifecyclePolicyDigest(prisma, {
      appId: input.appId,
      operationId: String(actionPayload.operationId || ""),
    })
    : null;
  const preview = buildActionPreview(input.actionId, actionPayload, {
    circleId: input.circleId,
    userPubkey: input.userPubkey,
    resolvedLifecyclePolicyDigest,
  });
  const previewDigest = digestJson(preview);
  const nodeEnv = input.nodeEnv ?? process.env.NODE_ENV ?? "development";
  const now = new Date();
  if (isConfirmedPreviewDigestRequired(input.actionId, nodeEnv) && !input.confirmedPreviewDigest) {
    throw new Error("hosted_app_action_preview_confirmation_required");
  }
  if (input.confirmedPreviewDigest && input.confirmedPreviewDigest !== previewDigest) {
    throw new Error("hosted_app_action_preview_mismatch");
  }
  const governanceReceipt = await assertActionCirclePolicySatisfied(prisma, {
    requiredCirclePolicy: capability.requiredCirclePolicy,
    appId: input.appId,
    releaseId: input.releaseId,
    circleId: input.circleId,
    actionId: input.actionId,
    payloadDigest: previewDigest,
    now,
  });
  await assertActionGovernanceExecutionChainGate(prisma, runtimeGateInput, governanceReceipt);
  if (nodeEnv === 'production' && input.actionId === 'request_governance_proposal_intent') {
    if (typeof prisma?.$transaction !== 'function') {
      throw new Error('hosted_app_governance_proposal_transaction_required');
    }
    const operationId = requiredString(
      actionPayload.operationId,
      'hosted_app_governance_operation_required',
    );
    const operationVersion = requiredString(
      actionPayload.operationVersion ?? 'v1',
      'hosted_app_governance_operation_version_required',
    );
    const governedPayload = asRecordPayload(actionPayload.payload);
    const proposerUserId = Number(input.actorUserId);
    if (!Number.isSafeInteger(proposerUserId) || proposerUserId <= 0) {
      throw new Error('hosted_app_governance_proposer_identity_required');
    }
    const proposalDependencies = input.governanceProposalDependencies
      ?? createHostedAppGovernanceProposalDependencies();
    return prisma.$transaction(async (tx: any) => {
      const proposerRole = await resolveCurrentHostedAppGovernanceProposerRole(tx, {
        targetCircleId: input.circleId,
        proposerUserId,
      });
      const proposal = await proposalDependencies.openGovernanceProposal(tx, {
        actionType: operationId,
        operationVersion,
        targetCircleId: input.circleId,
        payload: governedPayload,
        proposerPubkey: input.userPubkey,
        proposerRole,
        appId: input.appId,
        releaseId: input.releaseId,
        manifestHash: input.manifestHash,
        now,
      });
      const receipt = buildActionReceipt({
        receiptId: randomUUID(),
        appId: input.appId,
        releaseId: input.releaseId,
        manifestHash: input.manifestHash,
        circleId: input.circleId,
        userPubkey: input.userPubkey,
        actionId: input.actionId,
        capabilityId: input.actionId,
        capabilityVersion: capability.implementationVersion,
        policyEpoch: capability.policyEpoch,
        payload: actionPayload,
        preview,
        executionTargetRef: 'alcheme_native:governance_case',
        nativeResultRef: proposal.caseId,
        decision: 'executed',
        redactionProfile: 'payload_digest_only',
      });
      await persistActionReceiptWithGovernance(tx, governanceReceipt, receipt);
      return { ok: true as const, receipt, nativeResultRef: proposal.caseId };
    });
  }
  const usesProductionNativeAdapter =
    nodeEnv === "production" && input.actionId === "create_draft_intent";
  let executionTargetRef = input.actionId === "request_governance_proposal_intent"
    ? "alcheme_native:governance_proposal_preview"
    : input.actionId === "request_signature_intent"
      ? "alcheme_native:wallet_signature"
      : "dry_run:create_draft_intent";
  let nativeResultRef: string | null = null;
  const signatureDigest = input.actionId === "request_signature_intent"
    ? requiredString(actionPayload.signatureDigest, "hosted_app_signature_digest_required")
    : null;
  const actionReceiptId = randomUUID();

  if (usesProductionNativeAdapter) {
    if (!input.actor) {
      throw new Error("hosted_app_native_action_actor_required");
    }
    const nativeResult = await executeHostedAppNativeAction(
      prisma,
      {
        actionId: input.actionId,
        payload: actionPayload,
        circleId: input.circleId,
        actor: input.actor,
        confirmedPreviewDigest: input.confirmedPreviewDigest,
        expectedPreviewDigest: previewDigest,
      },
      input.nativeActionDependencies ?? createHostedAppNativeActionDependencies(prisma),
    );
    executionTargetRef = nativeResult.executionTargetRef;
    nativeResultRef = nativeResult.nativeResultRef;
  }

  assertNativeActionExecutionAllowed({
    actionId: input.actionId,
    executionTargetRef,
    nodeEnv,
  });

  const receipt = buildActionReceipt({
    receiptId: actionReceiptId,
    appId: input.appId,
    releaseId: input.releaseId,
    manifestHash: input.manifestHash,
    circleId: input.circleId,
    userPubkey: input.userPubkey,
    actionId: input.actionId,
    capabilityId: input.actionId,
    capabilityVersion: capability.implementationVersion,
    policyEpoch: capability.policyEpoch,
    payload: actionPayload,
    preview,
    signatureDigest,
    executionTargetRef,
    nativeResultRef,
    decision: "executed",
    redactionProfile: input.actionId === "request_signature_intent"
      ? "signature_digest_only"
      : "payload_digest_only",
  });
  await persistActionReceiptWithGovernance(prisma, governanceReceipt, receipt);

  return { ok: true, receipt, nativeResultRef };
}

function isConfirmedPreviewDigestRequired(actionId: string, nodeEnv: string): boolean {
  return actionId === "request_signature_intent" ||
    actionId === "request_governance_proposal_intent" ||
    nodeEnv === "production";
}

function buildActionPayload(input: {
  appId: string;
  releaseId: string;
  manifestHash: string;
  circleId: number;
  userPubkey: string;
  actionId: string;
  payload: Record<string, unknown>;
}) {
  if (input.actionId !== "request_signature_intent") {
    return input.payload;
  }
  return {
    ...input.payload,
    appId: input.appId,
    releaseId: input.releaseId,
    manifestHash: input.manifestHash,
    circleId: input.circleId,
    userPubkey: input.userPubkey,
    signer: input.payload.signer ?? input.userPubkey,
  };
}

function buildActionPreview(
  actionId: string,
  payload: Record<string, unknown>,
  context: { circleId: number; userPubkey: string; resolvedLifecyclePolicyDigest?: string | null },
) {
  if (actionId === "request_governance_proposal_intent") {
    const operationId = String(payload.operationId || "");
    const operationVersion = String(payload.operationVersion || "v1");
    assertGovernanceOperationRegistered({
      operationId,
      operationVersion,
      registeredOperations: buildHostedAppGovernanceOperationRegistry(),
      payload: payload.payload,
      resolvedLifecyclePolicyDigest: context.resolvedLifecyclePolicyDigest,
    });
    return {
      actionId,
      operationId,
      operationVersion,
      payloadDigest: digestJson(payload.payload ?? {}),
      executionTargetRef: String(payload.executionTargetRef || operationId),
      lifecyclePolicyDigest: context.resolvedLifecyclePolicyDigest,
    };
  }
  if (actionId === "request_signature_intent") {
    return buildSignatureIntentPreview({
      purpose: String(payload.purpose || ""),
      humanReadableSummary: typeof payload.humanReadableSummary === "string"
        ? payload.humanReadableSummary
        : undefined,
      chainId: String(payload.chainId || ""),
      programOrContract: String(payload.programOrContract || ""),
      method: String(payload.method || ""),
      accounts: normalizeStringList(payload.accounts),
      amount: typeof payload.amount === "string" ? payload.amount : undefined,
      spender: typeof payload.spender === "string" ? payload.spender : null,
      typedDataDomain: typeof payload.typedDataDomain === "string" ? payload.typedDataDomain : null,
      typedPayload: payload.typedPayload,
      simulationResultDigest: String(payload.simulationResultDigest || ""),
      riskExplanation: String(payload.riskExplanation || ""),
      payloadDigest: String(payload.payloadDigest || ""),
      previewDigest: String(payload.previewDigest || ""),
      replayDomain: String(payload.replayDomain || ""),
      nonce: String(payload.nonce || ""),
      appId: String(payload.appId || ""),
      releaseId: String(payload.releaseId || ""),
      manifestHash: String(payload.manifestHash || ""),
      circleId: Number(payload.circleId || 0),
      userPubkey: String(payload.userPubkey || ""),
      riskLevel: String(payload.riskLevel || ""),
      signer: String(payload.signer || ""),
      expiresAt: String(payload.expiresAt || ""),
    }).preview;
  }
  return buildNativeDraftCreatePreview({
    title: String(payload.title || "").trim(),
    body: String(payload.body || ""),
    circleId: context.circleId,
    authorPubkey: context.userPubkey,
  }).preview;
}

async function resolveGovernanceOperationLifecyclePolicyDigest(
  prisma: any,
  input: { appId: string; operationId: string },
): Promise<string | null> {
  const namespace = input.operationId.split(".")[0]?.trim();
  if (!namespace || !prisma?.hostedAppScopeBinding?.findFirst) return null;
  const binding = await prisma.hostedAppScopeBinding.findFirst({
    where: { appId: input.appId, namespace },
    orderBy: { updatedAt: "desc" },
  });
  if (!binding) return null;
  const bindingDigest = String(binding.scopeAuthorityLifecyclePolicyDigest || "").trim();
  const policyId = String(binding.scopeAuthorityLifecyclePolicyId || "").trim();
  const policyVersion = String(binding.scopeAuthorityLifecyclePolicyVersion || "").trim();
  if (!bindingDigest || !policyId || !policyVersion) return null;
  if (!prisma?.hostedAppScopeAuthorityLifecyclePolicy?.findUnique) {
    throw new Error("hosted_app_scope_authority_policy_registry_unavailable");
  }

  const policy = await prisma.hostedAppScopeAuthorityLifecyclePolicy.findUnique({
    where: {
      policyId_policyVersion: { policyId, policyVersion },
    },
  });
  if (!policy?.policyDigest) return null;
  const policyDigest = String(policy.policyDigest).trim();
  if (policyDigest !== bindingDigest) {
    throw new Error("hosted_app_scope_authority_policy_digest_stale");
  }
  return policyDigest;
}

async function assertActionCirclePolicySatisfied(
  prisma: any,
  input: {
    requiredCirclePolicy: string;
    appId: string;
    releaseId: string;
    circleId: number;
    actionId: string;
    payloadDigest: string;
    now: Date;
  },
): Promise<{
  id: string;
  executionNonce: string;
  replayDomain: string;
} | null> {
  if (input.requiredCirclePolicy !== "governance_required") return null;
  if (!prisma?.hostedAppGovernanceDecisionReceipt?.findFirst) {
    throw new Error("hosted_app_governance_policy_required");
  }
  const executionTargetRef = buildHostedAppGovernanceExecutionTargetRef(input);
  const receipt = await prisma.hostedAppGovernanceDecisionReceipt.findFirst({
    where: {
      operationId: "hosted_app.capability_execution",
      decision: "approved",
      payloadDigest: input.payloadDigest,
      executionTargetRef,
      expiresAt: { gt: input.now },
    },
    orderBy: { createdAt: "desc" },
  });
  if (!receipt) {
    throw new Error("hosted_app_governance_policy_required");
  }
  assertGovernanceDecisionCanExecute({
    receipt: {
      decision: String(receipt.decision || ""),
      validFrom: toIsoString(receipt.validFrom),
      expiresAt: toIsoString(receipt.expiresAt),
      executionNonce: String(receipt.executionNonce || ""),
      payloadDigest: String(receipt.payloadDigest || ""),
      executionTargetRef: String(receipt.executionTargetRef || ""),
    },
    request: {
      payloadDigest: input.payloadDigest,
      executionTargetRef,
    },
    consumedNonces: String(receipt.executionId || "").trim()
      ? [String(receipt.executionNonce || "")]
      : [],
    now: input.now.toISOString(),
  });
  const statePreconditionDigest = String(receipt.statePreconditionDigest || "").trim();
  if (!statePreconditionDigest || statePreconditionDigest === MIGRATED_MISSING_STATE_PRECONDITION_DIGEST) {
    throw new Error("hosted_app_governance_state_precondition_required");
  }
  const receiptId = String(receipt.id || "").trim();
  if (!receiptId) {
    throw new Error("hosted_app_governance_policy_required");
  }
  return {
    id: receiptId,
    executionNonce: String(receipt.executionNonce || ""),
    replayDomain: String(receipt.replayDomain || ""),
  };
}

async function assertActionGovernanceExecutionChainGate(
  prisma: any,
  runtimeGateInput: {
    appId: string;
    circleId: number;
    releaseId: string;
    manifestHash: string;
    userPubkey: string;
    requestedCapability: string;
  },
  governanceReceipt: { id: string; executionNonce: string; replayDomain: string } | null,
): Promise<void> {
  if (!governanceReceipt) return;
  const replayDomain = requiredString(
    governanceReceipt.replayDomain,
    "hosted_app_governance_replay_domain_required",
  );
  const executionNonce = requiredString(
    governanceReceipt.executionNonce,
    "hosted_app_governance_execution_nonce_required",
  );
  await assertHostedAppReleaseRuntimeGate(prisma, {
    ...runtimeGateInput,
    governanceReplayDomainHash: digestJson({ replayDomain }),
    governanceExecutionNonceHash: digestJson({ executionNonce }),
  });
}

async function markActionCirclePolicyConsumed(
  prisma: any,
  receipt: { id: string; executionNonce: string } | null,
  actionReceiptId: string,
): Promise<void> {
  if (!receipt) return;
  const governanceReceipts = prisma?.hostedAppGovernanceDecisionReceipt;
  if (typeof governanceReceipts?.updateMany === "function") {
    const result = await governanceReceipts.updateMany({
      where: {
        id: receipt.id,
        executionId: null,
      },
      data: {
        executionId: actionReceiptId,
      },
    });
    if (Number(result?.count ?? 0) !== 1) {
      throw new Error("hosted_app_governance_receipt_replayed");
    }
    return;
  }
  throw new Error("hosted_app_governance_policy_consume_unavailable");
}

async function persistActionReceiptWithGovernance(
  prisma: any,
  governanceReceipt: { id: string; executionNonce: string } | null,
  receipt: ReturnType<typeof buildActionReceipt>,
): Promise<void> {
  const data = mapActionReceiptForPrisma(receipt);
  if (governanceReceipt && typeof prisma?.$transaction === "function") {
    await prisma.$transaction(async (tx: any) => {
      await markActionCirclePolicyConsumed(tx, governanceReceipt, receipt.receiptId);
      await tx.hostedAppActionReceipt.create({ data });
    });
    return;
  }
  await markActionCirclePolicyConsumed(prisma, governanceReceipt, receipt.receiptId);
  await prisma.hostedAppActionReceipt.create({ data });
}

function buildHostedAppGovernanceExecutionTargetRef(input: {
  appId: string;
  releaseId: string;
  actionId: string;
}): string {
  return `hosted-app:${input.appId}:${input.releaseId}:${input.actionId}`;
}

function toIsoString(value: unknown): string {
  if (value instanceof Date) return value.toISOString();
  return String(value || "");
}

function requiredString(value: unknown, errorCode: string): string {
  if (typeof value === "string" && value.trim()) return value.trim();
  throw new Error(errorCode);
}

function normalizeStringList(value: unknown): string[] {
  if (!Array.isArray(value)) return [];
  return value.map((entry) => String(entry).trim()).filter(Boolean);
}

async function buildCapabilityData(prisma: any, input: {
  appId: string;
  releaseId: string;
  circleId: number;
  userPubkey?: string | null;
  userId?: number | null;
  capabilityId: string;
  params?: Record<string, unknown>;
}): Promise<unknown> {
  if (input.capabilityId === "read_app_session") {
    return {
      appId: input.appId,
      releaseId: input.releaseId,
      circleId: input.circleId,
      userPubkey: input.userPubkey ?? null,
    };
  }
  if (input.capabilityId === "read_current_circle_public_profile") {
    const circle = typeof prisma?.circle?.findUnique === "function"
      ? await prisma.circle.findUnique({
        where: { id: input.circleId },
        select: { id: true, name: true, description: true, membersCount: true },
      })
      : null;
    return {
      circleId: input.circleId,
      name: typeof circle?.name === "string" ? circle.name : null,
      description: typeof circle?.description === "string" ? circle.description : null,
      memberCount: Number.isFinite(Number(circle?.membersCount)) ? Number(circle.membersCount) : null,
    };
  }
  if (input.capabilityId === "read_my_circle_membership_status") {
    const membership = await loadCircleMembershipStatus(prisma, {
      circleId: input.circleId,
      userId: input.userId,
      userPubkey: input.userPubkey ?? "",
    });
    return buildMembershipStatusResult({
      circleId: input.circleId,
      userPubkey: input.userPubkey ?? "",
      membershipStatus: membership.membershipStatus,
      role: membership.role,
    });
  }
  if (input.capabilityId === "read_approved_circle_summary") {
    const summary = await loadApprovedCircleSummary(prisma, input.circleId);
    return buildApprovedCircleSummaryResult({
      circleId: input.circleId,
      summaryDigest: summary.summaryDigest,
      summaryText: summary.summaryText,
      approvalReceiptRef: summary.approvalReceiptRef,
    });
  }
  if (input.capabilityId === "read_approved_knowledge_context") {
    const sourceMaterials: ApprovedKnowledgeContextSourceMaterial[] =
      await loadApprovedKnowledgeContextSourceMaterials(prisma, {
      circleId: input.circleId,
      limit: Number(input.params?.limit || 20),
    });
    return buildApprovedKnowledgeContextResult({
      circleId: input.circleId,
      sourceMaterials,
      traceId: buildApprovedContextTraceId({
        appId: input.appId,
        releaseId: input.releaseId,
        circleId: input.circleId,
        sourceMaterialIds: sourceMaterials.map((source) => source.id),
      }),
    });
  }
  throw new Error("hosted_app_capability_not_implemented");
}

async function loadUserConsentReceipt(
  prisma: any,
  input: {
    appId: string;
    circleId: number;
    userPubkey: string;
    capabilityId: string;
  },
) {
  if (!prisma?.hostedAppUserConsent?.findUnique) return null;
  return prisma.hostedAppUserConsent.findUnique({
    where: {
      appId_circleId_userPubkey_capabilityId: {
        appId: input.appId,
        circleId: input.circleId,
        userPubkey: input.userPubkey,
        capabilityId: input.capabilityId,
      },
    },
  });
}

async function loadCircleMembershipStatus(
  prisma: any,
  input: { circleId: number; userId?: number | null; userPubkey: string },
) {
  let userId = Number(input.userId || 0);
  if ((!Number.isFinite(userId) || userId <= 0) && typeof prisma?.user?.findUnique === "function") {
    const user = await prisma.user.findUnique({
      where: { pubkey: input.userPubkey },
      select: { id: true },
    });
    userId = Number(user?.id || 0);
  }
  if (!Number.isFinite(userId) || userId <= 0 || typeof prisma?.circleMember?.findUnique !== "function") {
    return { membershipStatus: "unknown", role: "unknown" };
  }
  const membership = await prisma.circleMember.findUnique({
    where: { circleId_userId: { circleId: input.circleId, userId: Math.trunc(userId) } },
    select: { role: true, status: true },
  });
  if (!membership) return { membershipStatus: "not_member", role: "none" };
  return {
    membershipStatus: String(membership.status || "unknown"),
    role: String(membership.role || "unknown"),
  };
}

async function loadApprovedCircleSummary(prisma: any, circleId: number) {
  const fallback = {
    summaryDigest: "sha256:summary-unavailable",
    summaryText: "",
    approvalReceiptRef: "approval:unavailable",
  };
  if (typeof prisma?.circleSummarySnapshot?.findFirst !== "function") return fallback;
  const snapshot = await prisma.circleSummarySnapshot.findFirst({
    where: { circleId },
    orderBy: [{ version: "desc" }],
    select: {
      summaryId: true,
      issueMap: true,
      generatedAt: true,
      generationMetadata: true,
    },
  });
  if (!snapshot) return fallback;
  const summaryText = JSON.stringify(snapshot.issueMap ?? []);
  return {
    summaryDigest: digestJson({
      summaryId: snapshot.summaryId,
      issueMap: snapshot.issueMap ?? [],
      generatedAt: snapshot.generatedAt ?? null,
    }),
    summaryText,
    approvalReceiptRef: typeof snapshot.summaryId === "string"
      ? snapshot.summaryId
      : "approval:circle-summary-snapshot",
  };
}

async function loadApprovedKnowledgeContextSourceMaterials(
  prisma: any,
  input: { circleId: number; limit: number },
) {
  if (typeof prisma?.sourceMaterial?.findMany !== "function") return [];
  const take = Number.isFinite(input.limit) && input.limit > 0
    ? Math.min(Math.trunc(input.limit), 20)
    : 20;
  const rows = await prisma.sourceMaterial.findMany({
    where: {
      circleId: input.circleId,
      lifecycleStatus: { in: ["accepted_to_plaza", "used_in_draft", "crystallized"] },
      evidencePrivacyClass: { notIn: ["reviewer_only", "sealed", "redacted"] },
    },
    orderBy: [{ updatedAt: "desc" }, { id: "desc" }],
    take,
    select: {
      id: true,
      contentDigest: true,
      summaryText: true,
      evidencePrivacyClass: true,
      visibilityScope: true,
      reviewDecisionDigest: true,
    },
  });
  return rows
    .map((row: any) => ({
      id: Number(row.id || 0),
      digest: normalizeDigestRef(row.contentDigest),
      approvedSummary: String(row.summaryText || ""),
      visibility: String(row.visibilityScope || row.evidencePrivacyClass || "circle"),
    }))
    .filter((entry: { id: number; digest: string; approvedSummary: string }) =>
      entry.id > 0 && entry.digest && entry.approvedSummary,
    );
}

function normalizeDigestRef(value: unknown): string {
  const digest = String(value || "").trim();
  if (!digest) return "";
  return digest.startsWith("sha256:") ? digest : `sha256:${digest}`;
}

function buildApprovedContextTraceId(input: {
  appId: string;
  releaseId: string;
  circleId: number;
  sourceMaterialIds: number[];
}): string {
  return `hosted-context:${input.appId}:${input.circleId}:${digestJson({
    releaseId: input.releaseId,
    sourceMaterialIds: input.sourceMaterialIds,
  })}`;
}

function asRecordPayload(value: unknown): Record<string, unknown> {
  if (value && typeof value === "object" && !Array.isArray(value)) {
    return value as Record<string, unknown>;
  }
  return { value };
}

function resolveDataReleaseTraceId(
  rawData: unknown,
  input: {
    appId: string;
    releaseId: string;
    circleId: number;
    capabilityId: string;
  },
): string {
  if (
    rawData &&
    typeof rawData === "object" &&
    !Array.isArray(rawData) &&
    typeof (rawData as Record<string, unknown>).traceId === "string"
  ) {
    return (rawData as Record<string, string>).traceId;
  }
  return `hosted-capability:${input.appId}:${input.releaseId}:${input.circleId}:${input.capabilityId}`;
}

function mapAccessReceiptForPrisma(receipt: ReturnType<typeof buildAccessReceipt>) {
  return {
    id: receipt.receiptId,
    appId: receipt.appId,
    releaseId: receipt.releaseId,
    manifestHash: receipt.manifestHash,
    circleId: receipt.circleId,
    userPubkey: receipt.userPubkey,
    capabilityId: receipt.capabilityId,
    capabilityVersion: receipt.capabilityVersion,
    policyEpoch: receipt.policyEpoch,
    requestParamsDigest: receipt.requestParamsDigest,
    returnedDataDigest: receipt.returnedDataDigest,
    redactionProfile: receipt.redactionProfile,
    dataReleaseProfile: receipt.dataReleaseProfile,
    decision: receipt.decision,
    denialReason: receipt.denialReason,
    receiptDigest: receipt.receiptDigest,
    issuedAt: new Date(receipt.issuedAt),
    expiresAt: null,
  };
}

function mapActionReceiptForPrisma(receipt: ReturnType<typeof buildActionReceipt>) {
  return {
    id: receipt.receiptId,
    appId: receipt.appId,
    releaseId: receipt.releaseId,
    manifestHash: receipt.manifestHash,
    circleId: receipt.circleId,
    userPubkey: receipt.userPubkey,
    actionId: receipt.actionId,
    capabilityId: receipt.capabilityId,
    capabilityVersion: receipt.capabilityVersion,
    policyEpoch: receipt.policyEpoch,
    payloadDigest: receipt.payloadDigest,
    previewDigest: receipt.previewDigest,
    signatureDigest: receipt.signatureDigest,
    executionTargetRef: receipt.executionTargetRef,
    nativeResultRef: receipt.nativeResultRef,
    decision: receipt.decision,
    redactionProfile: receipt.redactionProfile,
    errorCode: receipt.errorCode,
    receiptDigest: receipt.receiptDigest,
    executedAt: receipt.executedAt ? new Date(receipt.executedAt) : null,
  };
}
