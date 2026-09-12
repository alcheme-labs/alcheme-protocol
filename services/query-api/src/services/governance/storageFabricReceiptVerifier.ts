import { GovernanceCaseWorkflowError } from './governanceCaseWorkflow';

export const STORAGE_FABRIC_PROVIDER_ADMISSION_ACTION_TYPE =
  'storage_fabric.authorize_provider_admission';

export interface StorageFabricReceiptVerificationInput {
  caseId: string;
  requestId: string;
  decisionDigest: string;
  targetRef: string;
  expectedProviderResourceRef: string;
  expectedCredentialJwsDigest: string;
  expectedOperationPayloadDigest: string;
  expectedStatePreconditionDigest: string;
  expectedExecutionWindow: {
    validFrom: string;
    expiresAt: string;
  };
  evidence: ReadonlyArray<{
    kind: 'external_receipt' | 'verification_record' | 'artifact';
    ref: string;
    digest: string;
  }>;
}

/**
 * Alcheme-owned normalized binding returned only after an Adapter has checked
 * Storage Fabric's authoritative projection. This is deliberately not the
 * Storage Fabric wire DTO: SF still owns its route, schema and projection
 * digest canonicalization.
 */
export interface VerifiedStorageFabricProviderAdmissionBinding {
  schemaVersion: 'ProviderAdmissionExecutionReadback/v1';
  verificationDecisionId: string;
  credentialJwsDigest: string;
  mandateId: string;
  mandateDigest: string;
  operation: 'provider_admission';
  operationPayloadDigest: string;
  statePreconditionDigest: string;
  providerResourceRef: string;
  conformanceRunId: string;
  idempotencyKey: string;
  providerAdmissionReceiptRef: string;
  providerAdmissionReceiptDigest: string;
  beforeStateDigest: string;
  afterStateDigest: string;
  providerStatus: 'experimental';
  settlementState: 'holdback_only';
  network: 'solana:devnet';
  projectionDigest: string;
  executedAt: string;
}

export interface StorageFabricReceiptVerifier {
  verifyProviderAdmissionExecution(
    input: StorageFabricReceiptVerificationInput,
  ): Promise<VerifiedStorageFabricProviderAdmissionBinding>;
}

function requiredText(value: unknown, code: string): string {
  const normalized = typeof value === 'string' ? value.trim() : '';
  if (!normalized || normalized.length > 256) {
    throw new GovernanceCaseWorkflowError(409, code);
  }
  return normalized;
}

function requiredDigest(value: unknown, code: string): string {
  const normalized = typeof value === 'string' ? value.trim().toLowerCase() : '';
  if (!/^(?:sha256:)?[a-f0-9]{64}$/.test(normalized)) {
    throw new GovernanceCaseWorkflowError(409, code);
  }
  return normalized.startsWith('sha256:') ? normalized : `sha256:${normalized}`;
}

export function normalizeVerifiedStorageFabricProviderAdmissionBinding(
  value: VerifiedStorageFabricProviderAdmissionBinding,
): VerifiedStorageFabricProviderAdmissionBinding {
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    throw new GovernanceCaseWorkflowError(
      409,
      'governance_manual_execution_authoritative_readback_invalid',
    );
  }
  if (value.schemaVersion !== 'ProviderAdmissionExecutionReadback/v1') {
    throw new GovernanceCaseWorkflowError(
      409,
      'governance_manual_execution_authoritative_readback_invalid',
    );
  }
  if (value.providerStatus !== 'experimental' || value.settlementState !== 'holdback_only') {
    throw new GovernanceCaseWorkflowError(
      409,
      'governance_manual_execution_authoritative_state_mismatch',
    );
  }
  if (value.network !== 'solana:devnet') {
    throw new GovernanceCaseWorkflowError(
      409,
      'governance_manual_execution_authoritative_network_mismatch',
    );
  }
  if (value.operation !== 'provider_admission') {
    throw new GovernanceCaseWorkflowError(
      409,
      'governance_manual_execution_authoritative_operation_mismatch',
    );
  }
  const executedAt = requiredText(
    value.executedAt,
    'governance_manual_execution_authoritative_readback_invalid',
  );
  if (!Number.isFinite(Date.parse(executedAt))) {
    throw new GovernanceCaseWorkflowError(
      409,
      'governance_manual_execution_authoritative_readback_invalid',
    );
  }
  return {
    schemaVersion: 'ProviderAdmissionExecutionReadback/v1',
    verificationDecisionId: requiredText(
      value.verificationDecisionId,
      'governance_manual_execution_authoritative_readback_invalid',
    ),
    credentialJwsDigest: requiredDigest(
      value.credentialJwsDigest,
      'governance_manual_execution_authoritative_readback_invalid',
    ),
    mandateId: requiredText(
      value.mandateId,
      'governance_manual_execution_authoritative_readback_invalid',
    ),
    mandateDigest: requiredDigest(
      value.mandateDigest,
      'governance_manual_execution_authoritative_readback_invalid',
    ),
    operation: 'provider_admission',
    operationPayloadDigest: requiredDigest(
      value.operationPayloadDigest,
      'governance_manual_execution_authoritative_readback_invalid',
    ),
    statePreconditionDigest: requiredDigest(
      value.statePreconditionDigest,
      'governance_manual_execution_authoritative_readback_invalid',
    ),
    providerResourceRef: requiredText(
      value.providerResourceRef,
      'governance_manual_execution_authoritative_readback_invalid',
    ),
    conformanceRunId: requiredText(
      value.conformanceRunId,
      'governance_manual_execution_authoritative_readback_invalid',
    ),
    idempotencyKey: requiredText(
      value.idempotencyKey,
      'governance_manual_execution_authoritative_readback_invalid',
    ),
    providerAdmissionReceiptRef: requiredText(
      value.providerAdmissionReceiptRef,
      'governance_manual_execution_authoritative_readback_invalid',
    ),
    providerAdmissionReceiptDigest: requiredDigest(
      value.providerAdmissionReceiptDigest,
      'governance_manual_execution_authoritative_readback_invalid',
    ),
    beforeStateDigest: requiredDigest(
      value.beforeStateDigest,
      'governance_manual_execution_authoritative_readback_invalid',
    ),
    afterStateDigest: requiredDigest(
      value.afterStateDigest,
      'governance_manual_execution_authoritative_readback_invalid',
    ),
    providerStatus: 'experimental',
    settlementState: 'holdback_only',
    network: 'solana:devnet',
    projectionDigest: requiredDigest(
      value.projectionDigest,
      'governance_manual_execution_authoritative_readback_invalid',
    ),
    executedAt: new Date(executedAt).toISOString(),
  };
}
