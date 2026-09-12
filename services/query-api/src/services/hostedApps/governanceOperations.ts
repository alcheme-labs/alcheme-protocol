import { randomUUID } from "node:crypto";
import Ajv from "ajv";

import { digestJson } from "./digest";
import {
  assertScopeAuthorityLifecyclePolicyDigestFresh,
  isHighRiskOperation,
  type HostedAppOperationRiskLevel,
} from "./scopeAuthorityLifecycle";

export interface GovernanceOperationDefinition {
  operationId: string;
  namespace: string;
  operationVersion: string;
  subjectRefField?: string;
  payloadSchema?: Record<string, unknown>;
  quorum?: number;
  timelockSeconds?: number;
  riskLevel?: HostedAppOperationRiskLevel;
  lifecyclePolicyDigest?: string;
  credentialType?: string;
}

export const EXAMPLE_STORAGE_FABRIC_OPERATIONS = [
  "storage_fabric.propose_phase_transition",
  "storage_fabric.authorize_provider_admission",
  "storage_fabric.authorize_budget_release",
  "storage_fabric.authorize_token_activation",
  "storage_fabric.authorize_contract_upgrade",
  "storage_fabric.authorize_emergency_hold",
] as const;

const ajv = new Ajv();

export function assertGovernanceOperationRegistered(input: {
  operationId: string;
  operationVersion: string;
  registeredOperations: GovernanceOperationDefinition[];
  payload?: unknown;
  resolvedLifecyclePolicyDigest?: string | null;
}): GovernanceOperationDefinition {
  const operation = input.registeredOperations.find(
    (candidate) =>
      candidate.operationId === input.operationId &&
      candidate.operationVersion === input.operationVersion,
  );
  if (!operation) {
    throw new Error("hosted_app_governance_operation_unregistered");
  }
  if (operation.payloadSchema) {
    const validate = ajv.compile(operation.payloadSchema);
    if (!validate(input.payload ?? {})) {
      throw new Error("hosted_app_governance_operation_payload_invalid");
    }
  }
  if (isHighRiskOperation(operation.riskLevel)) {
    assertScopeAuthorityLifecyclePolicyDigestFresh({
      expectedLifecyclePolicyDigest: operation.lifecyclePolicyDigest,
      resolvedLifecyclePolicyDigest: input.resolvedLifecyclePolicyDigest,
    });
  }
  return operation;
}

export function assertOperationPackChangeAllowed(input: {
  changeType: string;
  previous: { quorum: number; timelockSeconds: number };
  next: { quorum: number; timelockSeconds: number };
  metaGovernanceApproved: boolean;
}): void {
  if (
    (input.next.quorum < input.previous.quorum ||
      input.next.timelockSeconds < input.previous.timelockSeconds) &&
    !input.metaGovernanceApproved
  ) {
    throw new Error("hosted_app_operation_pack_meta_governance_required");
  }
}

export function buildOperationPackChangeReceipt(input: {
  namespace: string;
  previousVersion: string;
  nextVersion: string;
  before: unknown;
  after: unknown;
  approvalReceiptRef: string;
  effectiveAt: string;
}) {
  const beforeDigest = digestJson(input.before);
  const afterDigest = digestJson(input.after);
  const base = {
    receiptId: randomUUID(),
    receiptType: "hosted_app_operation_pack_change",
    namespace: input.namespace,
    previousVersion: input.previousVersion,
    nextVersion: input.nextVersion,
    beforeDigest,
    afterDigest,
    approvalReceiptRef: input.approvalReceiptRef,
    effectiveAt: input.effectiveAt,
  };
  return { ...base, receiptDigest: digestJson(base) };
}

export function buildHostedAppGovernanceOperationRegistry(): GovernanceOperationDefinition[] {
  return EXAMPLE_STORAGE_FABRIC_OPERATIONS.map((operationId) => ({
    operationId,
    namespace: "storage_fabric",
    operationVersion: "v1",
    subjectRefField: storageFabricSubjectRefField(operationId),
    payloadSchema: buildStorageFabricPayloadSchema(operationId),
    quorum: 5,
    timelockSeconds: 86_400,
    riskLevel: "high",
    lifecyclePolicyDigest: "sha256:storage-fabric-operation-pack-v1",
  }));
}

// Compatibility export for existing fixtures and callers. Runtime governance
// code should depend on the hosted-app operation registry, not on one tenant's
// demo name.
export const buildExampleStorageFabricOperationRegistry =
  buildHostedAppGovernanceOperationRegistry;

function storageFabricSubjectRefField(
  operationId: typeof EXAMPLE_STORAGE_FABRIC_OPERATIONS[number],
): string {
  const fields: Record<typeof EXAMPLE_STORAGE_FABRIC_OPERATIONS[number], string> = {
    "storage_fabric.propose_phase_transition": "projectId",
    "storage_fabric.authorize_provider_admission": "providerId",
    "storage_fabric.authorize_budget_release": "budgetId",
    "storage_fabric.authorize_token_activation": "tokenMint",
    "storage_fabric.authorize_contract_upgrade": "contractRef",
    "storage_fabric.authorize_emergency_hold": "affectedScopeRef",
  };
  return fields[operationId];
}

function buildStorageFabricPayloadSchema(
  operationId: typeof EXAMPLE_STORAGE_FABRIC_OPERATIONS[number],
): Record<string, unknown> {
  const common = {
    executionTargetRef: { type: "string", minLength: 1 },
    policyDigest: { type: "string", pattern: "^sha256:" },
  };
  const schemas: Record<typeof EXAMPLE_STORAGE_FABRIC_OPERATIONS[number], Record<string, unknown>> = {
    "storage_fabric.propose_phase_transition": {
      projectId: { type: "string", minLength: 1 },
      fromPhase: { type: "string", minLength: 1 },
      toPhase: { type: "string", minLength: 1 },
    },
    "storage_fabric.authorize_provider_admission": {
      providerId: { type: "string", minLength: 1 },
      providerPubkey: { type: "string", minLength: 1 },
      capacityCommitmentDigest: { type: "string", pattern: "^sha256:" },
    },
    "storage_fabric.authorize_budget_release": {
      budgetId: { type: "string", minLength: 1 },
      amount: { type: "string", minLength: 1 },
      currency: { type: "string", minLength: 1 },
      recipientRef: { type: "string", minLength: 1 },
      quoteDigest: { type: "string", pattern: "^sha256:" },
    },
    "storage_fabric.authorize_token_activation": {
      tokenMint: { type: "string", minLength: 1 },
      activationPolicyDigest: { type: "string", pattern: "^sha256:" },
    },
    "storage_fabric.authorize_contract_upgrade": {
      contractRef: { type: "string", minLength: 1 },
      currentVersion: { type: "string", minLength: 1 },
      targetVersion: { type: "string", minLength: 1 },
      upgradePlanDigest: { type: "string", pattern: "^sha256:" },
    },
    "storage_fabric.authorize_emergency_hold": {
      holdReasonCode: { type: "string", minLength: 1 },
      affectedScopeRef: { type: "string", minLength: 1 },
    },
  };
  const properties = {
    ...common,
    ...schemas[operationId],
  };
  return {
    type: "object",
    additionalProperties: false,
    required: Object.keys(properties),
    properties,
  };
}
