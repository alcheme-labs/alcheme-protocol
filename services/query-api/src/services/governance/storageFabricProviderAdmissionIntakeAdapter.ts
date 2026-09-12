import { STORAGE_FABRIC_PROVIDER_ADMISSION_ACTION_TYPE } from './governanceCaseActionComposition';
import {
  ExternalGovernedActionIntakeError,
  type CanonicalIntent,
  type GovernedActionEffect,
  type GovernedActionIntakeAdapter,
  type NativeActionPreview,
  type PublicSafeCandidatePage,
} from './externalGovernedActionIntakeTypes';
import {
  createStorageFabricProviderAdmissionCandidateClientFromRuntime,
  type DerivedProviderAdmissionIntent,
  type PublicSafeProviderAdmissionCandidatePage,
  type StorageFabricProviderAdmissionCandidateClient,
} from './storageFabricProviderAdmissionCandidateClient';

export function createStorageFabricProviderAdmissionAdapter(input?: {
  candidateClient?: StorageFabricProviderAdmissionCandidateClient | null;
}): GovernedActionIntakeAdapter {
  const effect: GovernedActionEffect = {
    kind: 'external_authoritative',
    credentialProfileRef: 'storage-fabric-provider-admission-route-a-v1',
    readbackProfileRef: 'storage-fabric-provider-admission-route-a-v1',
  };
  return {
    actionType: STORAGE_FABRIC_PROVIDER_ADMISSION_ACTION_TYPE,
    effect,
    async listCandidates(context) {
      void context;
      const client = requireCandidateClient(input?.candidateClient);
      const page = await client.listCandidates();
      return projectProviderAdmissionPage(page);
    },
    async resolveCanonicalIntent(
      context,
      candidateRef,
      expectedSnapshotVersion,
      expectedSnapshotDigest,
    ) {
      void context;
      const client = requireCandidateClient(input?.candidateClient);
      const derived = await client.resolveCanonicalIntent({
        candidateRef,
        expectedSnapshotVersion,
        expectedSnapshotDigest,
      });
      const preview = projectProviderAdmissionPreview(derived);
      return {
        actionType: STORAGE_FABRIC_PROVIDER_ADMISSION_ACTION_TYPE,
        effect,
        subjectType: derived.subjectType,
        subjectRef: derived.subjectRef,
        operationPayload: derived.operationPayload,
        statePrecondition: derived.statePrecondition,
        snapshotVersion: derived.snapshotVersion,
        snapshotDigest: derived.snapshotDigest,
        expiresAt: derived.expiresAt,
        connectorTrustProfile: derived.connectorTrustProfile,
        preview,
      };
    },
    projectNativePreview(intent: CanonicalIntent) {
      return intent.preview;
    },
  };
}

function requireCandidateClient(
  client: StorageFabricProviderAdmissionCandidateClient | null | undefined,
): StorageFabricProviderAdmissionCandidateClient {
  const resolved = client ?? createStorageFabricProviderAdmissionCandidateClientFromRuntime();
  if (!resolved) {
    throw new ExternalGovernedActionIntakeError(503, 'provider_admission_candidate_unavailable');
  }
  return resolved;
}

function projectProviderAdmissionPage(
  page: PublicSafeProviderAdmissionCandidatePage,
): PublicSafeCandidatePage {
  return {
    actionType: STORAGE_FABRIC_PROVIDER_ADMISSION_ACTION_TYPE,
    items: page.items.map((item) => ({
      candidateRef: item.candidateRef,
      displayName: item.displayName,
      statusSummary: item.statusSummary,
      capacitySummary: item.capacitySummary,
      policySummary: item.policySummary,
      snapshotVersion: item.snapshotVersion,
      snapshotDigest: item.snapshotDigest,
      expiresAt: item.expiresAt,
    })),
    nextCursor: page.nextCursor,
  };
}

function projectProviderAdmissionPreview(
  derived: DerivedProviderAdmissionIntent,
): NativeActionPreview {
  return {
    title: 'Authorize provider admission',
    summary: `Authorize provider ${derived.subjectRef} from authoritative candidate snapshot.`,
    displayName: derived.subjectRef,
    statusSummary: 'eligible',
    technicalDetailsCollapsed: true,
  };
}
