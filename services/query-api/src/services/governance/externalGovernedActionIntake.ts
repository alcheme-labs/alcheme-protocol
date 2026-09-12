import { createHash } from 'node:crypto';

import {
  isExternalActionCandidatePickerEnabled,
} from './externalGovernedActionFlags';
import {
  createStorageFabricProviderAdmissionCandidateClientFromRuntime,
  ProviderAdmissionCandidateClientError,
  type StorageFabricProviderAdmissionCandidateClient,
} from './storageFabricProviderAdmissionCandidateClient';
import { createStorageFabricProviderAdmissionAdapter } from './storageFabricProviderAdmissionIntakeAdapter';
import { createExternalAppPrimaryCircleBindingAdapter } from './externalAppPrimaryCircleBindingIntakeAdapter';
import {
  ExternalGovernedActionIntakeError,
  type GovernedActionIntakeAdapter,
  type PreparedGovernedActionIntent,
  type VerifiedProducerContext,
} from './externalGovernedActionIntakeTypes';

export type {
  CanonicalIntent,
  GovernedActionEffect,
  GovernedActionIntakeAdapter,
  IntakeAdapterContext,
  NativeActionPreview,
  PreparedGovernedActionIntent,
  PublicSafeCandidatePage,
  VerifiedProducerContext,
} from './externalGovernedActionIntakeTypes';
export { ExternalGovernedActionIntakeError } from './externalGovernedActionIntakeTypes';
export { createStorageFabricProviderAdmissionAdapter } from './storageFabricProviderAdmissionIntakeAdapter';
export { createExternalAppPrimaryCircleBindingAdapter } from './externalAppPrimaryCircleBindingIntakeAdapter';

export type ExternalGovernedActionIntake = {
  prepareIntent(input: {
    confirmingActorSession: { actorPubkey: string; actorRole: string };
    verifiedProducerContext: VerifiedProducerContext;
    externalAppId?: string | null;
    circleId: number;
    actionType: string;
    candidateRef: string;
    expectedSnapshotVersion: string;
    expectedSnapshotDigest: string;
    rationale: string;
    clientIntentId?: string | null;
  }): Promise<PreparedGovernedActionIntent>;
  confirmAndOpenCase<T extends { caseId: string; replayed: boolean } = {
    caseId: string;
    replayed: boolean;
  }>(input: {
    confirmingActorSession: { actorPubkey: string; actorRole: string };
    verifiedProducerContext: VerifiedProducerContext;
    preparation: PreparedGovernedActionIntent;
    confirmedPreviewDigest: string;
    idempotencyKey: string;
    openCase: (facts: {
      actionType: string;
      subjectType: string;
      subjectRef: string;
      requestedActionPayload: Record<string, unknown>;
      statePrecondition: Record<string, unknown> | null;
      requestedDecision: string;
      idempotencyKey: string;
      candidateProvenance: {
        candidateRef: string;
        snapshotVersion: string;
        snapshotDigest: string;
        expiresAt: string | null;
        connectorTrustProfile: string | null;
      };
    }) => Promise<T>;
  }): Promise<T>;
  getAdapter(actionType: string): GovernedActionIntakeAdapter | null;
  listRegisteredActionTypes(): string[];
};

export function createExternalGovernedActionIntake(input?: {
  adapters?: GovernedActionIntakeAdapter[];
  candidateClient?: StorageFabricProviderAdmissionCandidateClient | null;
}): ExternalGovernedActionIntake {
  const adapters = input?.adapters ?? [
    createStorageFabricProviderAdmissionAdapter({
      candidateClient: input?.candidateClient
        ?? createStorageFabricProviderAdmissionCandidateClientFromRuntime()
        ?? null,
    }),
    createExternalAppPrimaryCircleBindingAdapter(),
  ];
  const byAction = new Map(adapters.map((adapter) => [adapter.actionType, adapter]));
  return {
    getAdapter(actionType) {
      return byAction.get(actionType) ?? null;
    },
    listRegisteredActionTypes() {
      return [...byAction.keys()];
    },
    async prepareIntent(request) {
      const adapter = byAction.get(request.actionType);
      if (!adapter) {
        throw new ExternalGovernedActionIntakeError(404, 'governed_action_intake_adapter_unavailable');
      }
      assertProducerContext(request.verifiedProducerContext);
      const resolved = await adapter.resolveCanonicalIntent(
        {
          confirmingActorSession: request.confirmingActorSession,
          verifiedProducerContext: request.verifiedProducerContext,
          externalAppId: request.externalAppId,
          circleId: request.circleId,
        },
        request.candidateRef,
        request.expectedSnapshotVersion,
        request.expectedSnapshotDigest,
      );
      const rationale = requiredRationale(request.rationale);
      const preparation: PreparedGovernedActionIntent = {
        preparationDigest: '',
        actionType: resolved.actionType,
        effect: resolved.effect,
        preview: adapter.projectNativePreview(resolved),
        candidateRef: request.candidateRef,
        expectedSnapshotVersion: request.expectedSnapshotVersion,
        expectedSnapshotDigest: normalizeHexDigest(request.expectedSnapshotDigest),
        subjectType: resolved.subjectType,
        subjectRef: resolved.subjectRef,
        operationPayload: resolved.operationPayload,
        statePrecondition: resolved.statePrecondition,
        rationale,
      };
      preparation.preparationDigest = hashPreparation(preparation);
      return preparation;
    },
    async confirmAndOpenCase(request) {
      assertProducerContext(request.verifiedProducerContext);
      if (request.confirmingActorSession.actorPubkey.trim().length < 1) {
        throw new ExternalGovernedActionIntakeError(401, 'governance_case_actor_required');
      }
      const recomputed = hashPreparation(request.preparation);
      if (
        recomputed !== request.preparation.preparationDigest
        || recomputed !== request.confirmedPreviewDigest
      ) {
        throw new ExternalGovernedActionIntakeError(409, 'governed_action_preparation_digest_mismatch');
      }
      const adapter = byAction.get(request.preparation.actionType);
      if (!adapter) {
        throw new ExternalGovernedActionIntakeError(404, 'governed_action_intake_adapter_unavailable');
      }
      if (adapter.effect.kind !== request.preparation.effect.kind) {
        throw new ExternalGovernedActionIntakeError(409, 'governed_action_effect_kind_mismatch');
      }
      const preparationPayload = request.preparation.operationPayload
        && typeof request.preparation.operationPayload === 'object'
        && !Array.isArray(request.preparation.operationPayload)
        ? request.preparation.operationPayload
        : {};
      const resolved = await adapter.resolveCanonicalIntent(
        {
          confirmingActorSession: request.confirmingActorSession,
          verifiedProducerContext: request.verifiedProducerContext,
          externalAppId: typeof preparationPayload.externalAppId === 'string'
            ? preparationPayload.externalAppId
            : null,
          circleId: Number(
            typeof preparationPayload.circleId === 'number'
              ? preparationPayload.circleId
              : 0,
          ) || 0,
        },
        request.preparation.candidateRef,
        request.preparation.expectedSnapshotVersion,
        request.preparation.expectedSnapshotDigest,
      );
      if (
        resolved.actionType !== request.preparation.actionType
        || resolved.subjectType !== request.preparation.subjectType
        || resolved.effect.kind !== request.preparation.effect.kind
      ) {
        throw new ExternalGovernedActionIntakeError(409, 'governed_action_preparation_digest_mismatch');
      }
      return request.openCase({
        actionType: resolved.actionType,
        subjectType: resolved.subjectType,
        subjectRef: resolved.subjectRef,
        requestedActionPayload: resolved.operationPayload,
        statePrecondition: resolved.statePrecondition,
        requestedDecision: request.preparation.rationale,
        idempotencyKey: request.idempotencyKey,
        candidateProvenance: {
          candidateRef: request.preparation.candidateRef,
          snapshotVersion: String(
            resolved.snapshotVersion || request.preparation.expectedSnapshotVersion,
          ),
          snapshotDigest: normalizeHexDigest(
            resolved.snapshotDigest || request.preparation.expectedSnapshotDigest,
          ),
          expiresAt: typeof resolved.expiresAt === 'string' ? resolved.expiresAt : null,
          connectorTrustProfile: typeof resolved.connectorTrustProfile === 'string'
            ? resolved.connectorTrustProfile
            : null,
        },
      });
    },
  };
}

export async function resolveProviderAdmissionCreateFactsAsync(input: {
  candidateRef?: string | null;
  expectedSnapshotVersion?: string | null;
  expectedSnapshotDigest?: string | null;
  requestedActionPayload?: Record<string, unknown> | null;
  statePrecondition?: Record<string, unknown> | null;
  rationale?: string | null;
  requestedDecision: string;
  candidateClient?: StorageFabricProviderAdmissionCandidateClient | null;
  env?: NodeJS.ProcessEnv;
}): Promise<{
  subjectType: 'external_provider';
  subjectRef: string;
  requestedActionPayload: Record<string, unknown>;
  statePrecondition: Record<string, unknown>;
  requestedDecision: string;
}> {
  const env = input.env ?? process.env;
  if (!isExternalActionCandidatePickerEnabled(env)) {
    throw new ExternalGovernedActionIntakeError(404, 'provider_admission_candidate_picker_disabled');
  }
  if (hasClientMachineFieldOverrides(input.requestedActionPayload, input.statePrecondition)) {
    throw new ExternalGovernedActionIntakeError(
      400,
      'provider_admission_machine_field_override_rejected',
    );
  }
  const candidateRef = String(input.candidateRef || '').trim();
  const expectedSnapshotVersion = String(input.expectedSnapshotVersion || '').trim();
  const expectedSnapshotDigest = String(input.expectedSnapshotDigest || '').trim();
  if (!candidateRef || !expectedSnapshotVersion || !expectedSnapshotDigest) {
    throw new ExternalGovernedActionIntakeError(400, 'provider_admission_candidate_ref_required');
  }
  const client = input.candidateClient
    ?? createStorageFabricProviderAdmissionCandidateClientFromRuntime({ env });
  if (!client) {
    throw new ExternalGovernedActionIntakeError(503, 'provider_admission_candidate_unavailable');
  }
  const derived = await client.resolveCanonicalIntent({
    candidateRef,
    expectedSnapshotVersion,
    expectedSnapshotDigest,
  });
  return {
    subjectType: 'external_provider',
    subjectRef: derived.subjectRef,
    requestedActionPayload: derived.operationPayload,
    statePrecondition: derived.statePrecondition,
    requestedDecision: requiredRationale(input.rationale || input.requestedDecision),
  };
}

export function mapIntakeErrorToIntakeError(error: unknown): ExternalGovernedActionIntakeError | null {
  if (error instanceof ExternalGovernedActionIntakeError) return error;
  if (error instanceof ProviderAdmissionCandidateClientError) {
    return new ExternalGovernedActionIntakeError(error.statusCode, error.code);
  }
  return null;
}

export function hasClientMachineFieldOverrides(
  payload: Record<string, unknown> | null | undefined,
  state: Record<string, unknown> | null | undefined,
): boolean {
  if (state && Object.keys(state).length > 0) return true;
  if (!payload || Object.keys(payload).length === 0) return false;
  const machineKeys = [
    'providerId',
    'providerPubkey',
    'capacityCommitmentDigest',
    'executionTargetRef',
    'policyDigest',
    'operationPayload',
    'statePrecondition',
  ];
  return machineKeys.some((key) => key in payload);
}

function assertProducerContext(context: VerifiedProducerContext): void {
  if (context.kind === 'native_user') {
    if (!context.actorPubkey.trim()) {
      throw new ExternalGovernedActionIntakeError(401, 'governance_case_actor_required');
    }
    return;
  }
  if (context.kind === 'route_a_server_intent' || context.kind === 'hosted_app_session') {
    throw new ExternalGovernedActionIntakeError(409, 'governed_action_producer_blocked');
  }
  throw new ExternalGovernedActionIntakeError(400, 'governed_action_producer_invalid');
}

function requiredRationale(value: unknown): string {
  const text = String(value ?? '').trim();
  if (text.length < 10 || text.length > 2000) {
    throw new ExternalGovernedActionIntakeError(400, 'governance_case_requested_decision_required');
  }
  return text;
}

function hashPreparation(preparation: PreparedGovernedActionIntent): string {
  const material = {
    actionType: preparation.actionType,
    effect: preparation.effect,
    preview: preparation.preview,
    candidateRef: preparation.candidateRef,
    expectedSnapshotVersion: preparation.expectedSnapshotVersion,
    expectedSnapshotDigest: preparation.expectedSnapshotDigest,
    subjectType: preparation.subjectType,
    subjectRef: preparation.subjectRef,
    operationPayload: preparation.operationPayload,
    statePrecondition: preparation.statePrecondition,
    rationale: preparation.rationale,
  };
  return createHash('sha256')
    .update(stableJson(material), 'utf8')
    .digest('hex');
}

function stableJson(value: unknown): string {
  if (value === null || typeof value !== 'object') return JSON.stringify(value);
  if (Array.isArray(value)) return `[${value.map(stableJson).join(',')}]`;
  const record = value as Record<string, unknown>;
  return `{${Object.keys(record).sort()
    .map((key) => `${JSON.stringify(key)}:${stableJson(record[key])}`)
    .join(',')}}`;
}

function normalizeHexDigest(value: unknown): string {
  const normalized = String(value ?? '').trim().toLowerCase().replace(/^sha256:/, '');
  if (!/^[a-f0-9]{64}$/.test(normalized)) {
    throw new ExternalGovernedActionIntakeError(400, 'provider_admission_candidate_snapshot_invalid');
  }
  return normalized;
}
