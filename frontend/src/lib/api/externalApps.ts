import { getQueryApiBaseUrl } from "../config/queryApiBase";
import { apiFetch, authenticatedApiFetch } from "./fetch";

export interface ExternalAppDiscoveryItem {
  id: string;
  name: string;
  registryStatus: string;
  discoveryStatus: string;
  managedNodePolicy: string;
  manifestHash?: string | null;
  capabilitySummary?: {
    sourceMaterialSubmission: string;
    knowledgeContext: string;
    voice: string;
    transcriptRecap: string;
  } | null;
  trustScore?: string | null;
  riskScore?: string | null;
  communityBackingLevel?: string | null;
  updatedAt?: string | null;
  stabilityProjection?: ExternalAppStabilityProjection | null;
  storeProjection?: ExternalAppStoreProjection | null;
}

export interface ExternalAppCircleBinding {
  id: string;
  externalAppId: string;
  circleId: number;
  bindingKind: "primary" | "attached";
  status: "pending" | "active" | "superseded" | "revoked";
  environment: string;
  effectiveAt?: string | null;
  supersededAt?: string | null;
  revokedAt?: string | null;
  source?: string | null;
  createdAt?: string | null;
  updatedAt?: string | null;
}

export interface CircleExternalAppBindingRecord {
  id: string;
  appId: string;
  appName: string | null;
  appStatus: string | null;
  circleId: number;
  bindingKind: "primary" | "attached" | string;
  status: "active" | "pending" | "superseded" | "revoked" | string;
  governanceRequestId: string | null;
  effectiveAt: string | null;
  createdAt: string | null;
}

export interface CircleExternalAppBindingReadFailure {
  status: number;
  code: string;
  reason: string | null;
  recoverable: boolean;
}

export class CircleExternalAppBindingReadError extends Error {
  readonly status: number;
  readonly code: string;
  readonly reason: string | null;
  readonly recoverable: boolean;

  constructor(failure: CircleExternalAppBindingReadFailure) {
    super(failure.code);
    this.name = "CircleExternalAppBindingReadError";
    this.status = failure.status;
    this.code = failure.code;
    this.reason = failure.reason;
    this.recoverable = failure.recoverable;
  }
}

export interface ExternalProgramDeveloperDashboardReadFailure {
  status: number;
  code: string;
  reason: string | null;
  recoverable: boolean;
}

export class ExternalProgramDeveloperDashboardReadError extends Error {
  readonly status: number;
  readonly code: string;
  readonly reason: string | null;
  readonly recoverable: boolean;

  constructor(failure: ExternalProgramDeveloperDashboardReadFailure) {
    super(failure.code);
    this.name = "ExternalProgramDeveloperDashboardReadError";
    this.status = failure.status;
    this.code = failure.code;
    this.reason = failure.reason;
    this.recoverable = failure.recoverable;
  }
}

export interface ExternalAppDetail {
  app: ExternalAppDiscoveryItem & {
    status?: string;
    environment?: string;
  };
  primaryCircle: ExternalAppCircleBinding | null;
  attachedCircles: ExternalAppCircleBinding[];
  reviewCircle: {
    circleId: number;
  } | null;
  circleBindings: ExternalAppCircleBinding[];
  publicStatus?: ExternalProgramPublicStatusSummary | null;
}

export interface ExternalProgramPublicStatusSummary {
  registrationStatus: string;
  registryStatus: string;
  discoveryStatus: string;
  productionReviewStatus: string;
  primaryCircleId: number | null;
  sourceMaterialMode: string;
  trustProjectionStatus: string;
  nextAction: string;
}

export interface ExternalProgramRuntimeCapabilities {
  productName: "External Program";
  apiBasePath: "/api/v1/external-apps";
  claimContract: {
    version: string;
    payloadEncoding: string;
    signatureEncoding: string;
    signingInput: string;
    maxTtlSec: number;
    nonceReplayRequired: boolean;
    summaryDigest: string;
    serverKeyLifecycle: {
      persisted: boolean;
      productionStable: boolean;
      requiredForProduction: boolean;
      unavailableReason: string | null;
    };
    claims: Record<
      string,
      {
        required: boolean;
        authMode: string;
        claimContractVersion: string;
        maxTtlSec: number;
        nonceReplayRequired: boolean;
        payloadEncoding: string;
        signatureEncoding: string;
        signingInput: string;
      }
    >;
  };
  roomDefaults: {
    roomType: string;
    capabilities: Record<string, boolean>;
  };
  sourceMaterials: {
    mode: string;
    privateSidecarRequired: boolean;
    availableOnThisNode: boolean;
    unavailableError: string | null;
  };
  voice: {
    mode: string;
    healthEndpoint: string;
    requireProviderHealth: boolean;
    provider: string;
    publicUrl: string | null;
    tokenTtlSec: number | null;
    defaultTtlSec: number | null;
    error: string | null;
  };
  registry: {
    mode: string;
  };
  errorContractVersion: string;
}

export interface ExternalProgramIntegrationStatus {
  appId: string;
  visibility: "public_safe";
  registration: {
    exists: true;
    status: string;
    environment: string;
    registryStatus: string;
    discoveryStatus: string;
    managedNodePolicy: string;
    manifestHash: string | null;
    updatedAt: string | null;
  };
  circleBinding: {
    required: true;
    primaryCircleId: number | null;
    activeCount: number;
    pendingCount: number;
  };
  runtime: {
    capabilities: ExternalProgramRuntimeCapabilities;
    appCapabilitySummary: {
      sourceMaterialSubmission: string;
      knowledgeContext: string;
      voice: string;
      transcriptRecap: string;
    };
    serverKeyLifecycle: {
      ready: boolean;
      required: boolean;
      activeKeyVersion: string | null;
      activeKeyCount: number;
      graceKeyCount: number;
      revokedKeyCount: number;
      nextAction: string;
    };
  };
  productionReview: {
    status: string;
    request: {
      state: string;
      policyEpochId: string;
      openedAt: string | null;
      resolvedAt: string | null;
      decision: string | null;
      executionStatus: string | null;
      executionErrorCode: string | null;
    } | null;
  };
  sourceMaterials: ExternalProgramRuntimeCapabilities["sourceMaterials"];
  trust: {
    registryMode: string;
    chainTrusted: boolean;
    registryAnchor: {
      registryStatus: string | null;
      finalityStatus: string | null;
      receiptFinalityStatus: string | null;
    } | null;
    stabilityProjection: ExternalAppStabilityProjection;
    storeProjection: {
      listingState: string;
      categoryTags: string[];
      rankingScore: number;
      rankingFallbackMode: boolean;
      featuredState: string;
      continuityLabels: string[];
      updatedAt: string;
    };
  };
  errors: Array<{ code: string; severity: string }>;
  nextAction: string;
}

export interface ExternalProgramErrorContract {
  version: string;
  errors: Array<{
    code: string;
    category: string;
    retryable: boolean;
    developerAction: string;
    userCopyKey: string;
    httpStatus: number;
  }>;
}

export interface ExternalProgramCapabilityProvisioningStatus {
  requested: boolean;
  status: string;
  mode: string;
  healthStatus: string | null;
  healthCheckedAt: string | null;
  failureCode: string | null;
  runtimeBaseUrl?: string | null;
}

export interface ExternalProgramProvisioningStatus {
  sourceMaterials: ExternalProgramCapabilityProvisioningStatus;
  voice: ExternalProgramCapabilityProvisioningStatus;
}

export interface ExternalProgramDeveloperAppSummary {
  appId: string;
  name: string;
  environment: string;
  status: string;
  registryStatus: string;
  discoveryStatus: string;
  nextAction: string;
  productionReviewStatus: string;
  activeKeyVersion: string | null;
  provisioning: ExternalProgramProvisioningStatus;
  errors: Array<{ code: string; severity: string }>;
  updatedAt: string | null;
}

export interface ExternalProgramDeveloperDashboard {
  ownerPubkey: string;
  apps: ExternalProgramDeveloperAppSummary[];
}

export interface SandboxExternalProgramRegistrationRequest {
  manifest: {
    version: "1";
    appId: string;
    name: string;
    homeUrl: string;
    ownerWallet: string;
    serverPublicKey: string;
    allowedOrigins: string[];
    capabilities: string[];
    platforms?: Record<string, unknown>;
    callbacks?: Record<string, unknown>;
    policy?: Record<string, unknown>;
  };
  ownerAssertion: {
    payload: string;
    signature: string;
  };
  serverKeyProof: {
    payload: string;
    signature: string;
  };
}

export interface SandboxExternalProgramRegistrationResponse {
  ok: true;
  registration: {
    app: {
      id: string;
      name: string;
      status: string;
      environment: string;
      registryStatus: string;
      discoveryStatus: string;
      managedNodePolicy: string;
      ownerPubkey: string;
      manifestHash: string;
      allowedOrigins: string[];
    };
    nextAction: "bind_primary_circle";
    audit: {
      source: "self_service_sandbox";
      manifestHash: string;
      ownerAssertionNonce: string;
      serverKeyProofNonce: string;
      registeredAt: string;
    };
  };
}

export interface ExternalAppStabilityProjection {
  registryStatus?: string;
  policyEpochId: string;
  challengeState: string;
  projectionStatus: string;
  publicLabels: string[];
  riskScore: number;
  trustScore: number;
  supportSignalLevel: number;
  supportIndependenceScore: number;
  rollout?: {
    exposed?: boolean;
    bucket?: number;
    exposureBasisPoints?: number;
    cohort?: string;
  } | null;
  bondState?: {
    ownerBonded?: boolean;
    activeChallengeBonded?: boolean;
    activeChallengeCount?: number;
  } | null;
  bondDispositionState?: {
    state?: string;
    activeCaseCount?: number;
    riskDisclaimerAccepted?: boolean;
    riskDisclaimerRequired?: boolean;
    hasActiveLockedAmount?: boolean;
    hasRoutedAmount?: boolean;
  } | null;
  governanceState?: {
    captureReviewStatus?: string;
    projectionDisputeStatus?: string;
    emergencyHoldStatus?: string;
    highImpactActionsPaused?: boolean;
    labels?: string[];
  } | null;
}

export interface ExternalAppStoreProjection {
  listingState: string;
  categoryTags: string[];
  rankingScore: number;
  rankingFallbackMode: boolean;
  featuredState: string;
  continuityLabels: string[];
  updatedAt: string;
}

export interface ExternalAppDiscoveryQuery {
  q?: string;
  category?: string;
  sort?: "latest" | "featured" | "trending";
}

export async function listExternalAppDiscovery(
  query: ExternalAppDiscoveryQuery = {},
  options: { signal?: AbortSignal } = {},
): Promise<ExternalAppDiscoveryItem[]> {
  const params = new URLSearchParams();
  if (query.q) params.set("q", query.q);
  if (query.category) params.set("category", query.category);
  if (query.sort) params.set("sort", query.sort);
  const suffix = params.toString() ? `?${params.toString()}` : "";
  const response = await apiFetch(
    `${getQueryApiBaseUrl()}/api/v1/external-apps/discovery${suffix}`,
    {
      init: { cache: "no-store", signal: options.signal },
    },
  );
  if (!response.ok) {
    throw new Error(`external_app_discovery_failed:${response.status}`);
  }
  const data = await response.json().catch(() => null);
  if (!isRecord(data) || !Array.isArray(data.apps) || !data.apps.every(isExternalAppDiscoveryItem)) {
    throw new Error("external_app_discovery_invalid_response");
  }
  return data.apps;
}

export async function getExternalAppDetail(
  appId: string,
): Promise<ExternalAppDetail> {
  const response = await apiFetch(
    `${getQueryApiBaseUrl()}/api/v1/external-apps/${encodeURIComponent(appId)}`,
    {
      init: { cache: "no-store" },
    },
  );
  if (!response.ok) {
    throw new Error(`external_app_detail_failed:${response.status}`);
  }
  const data = await response.json().catch(() => null);
  if (!isExternalAppDetail(data, appId)) {
    throw new Error("external_app_detail_invalid_response");
  }
  return data;
}

function isExternalAppDiscoveryItem(value: unknown): value is ExternalAppDiscoveryItem {
  if (!isRecord(value)) return false;
  return hasText(value.id)
    && hasText(value.name)
    && hasText(value.registryStatus)
    && hasText(value.discoveryStatus)
    && hasText(value.managedNodePolicy)
    && isOptionalStabilityProjection(value.stabilityProjection)
    && isOptionalStoreProjection(value.storeProjection);
}

function isExternalAppDetail(value: unknown, expectedAppId: string): value is ExternalAppDetail {
  if (!isRecord(value) || !isExternalAppDiscoveryItem(value.app)) return false;
  if (value.app.id !== expectedAppId) return false;
  if (!isNullableExternalAppBinding(value.primaryCircle, expectedAppId)) return false;
  if (!Array.isArray(value.attachedCircles)
    || !value.attachedCircles.every((binding) => isExternalAppBinding(binding, expectedAppId))) {
    return false;
  }
  if (!Array.isArray(value.circleBindings)
    || !value.circleBindings.every((binding) => isExternalAppBinding(binding, expectedAppId))) {
    return false;
  }
  if (value.reviewCircle !== null && (
    !isRecord(value.reviewCircle)
    || !Number.isInteger(value.reviewCircle.circleId)
    || Number(value.reviewCircle.circleId) <= 0
  )) {
    return false;
  }
  return isOptionalPublicStatus(value.publicStatus);
}

function isOptionalStabilityProjection(value: unknown): boolean {
  if (value === undefined || value === null) return true;
  if (!isRecord(value)
    || !hasText(value.projectionStatus)
    || !Array.isArray(value.publicLabels)
    || !value.publicLabels.every((label) => typeof label === "string")
    || typeof value.riskScore !== "number"
    || !Number.isFinite(value.riskScore)
    || typeof value.trustScore !== "number"
    || !Number.isFinite(value.trustScore)) {
    return false;
  }
  if (value.rollout !== undefined && value.rollout !== null) {
    if (!isRecord(value.rollout)) return false;
    if (value.rollout.exposureBasisPoints !== undefined
      && (typeof value.rollout.exposureBasisPoints !== "number"
        || !Number.isFinite(value.rollout.exposureBasisPoints))) {
      return false;
    }
  }
  if (value.bondDispositionState !== undefined && value.bondDispositionState !== null) {
    if (!isRecord(value.bondDispositionState)) return false;
    if (value.bondDispositionState.state !== undefined
      && typeof value.bondDispositionState.state !== "string") return false;
    if (value.bondDispositionState.hasActiveLockedAmount !== undefined
      && typeof value.bondDispositionState.hasActiveLockedAmount !== "boolean") return false;
  }
  if (value.governanceState !== undefined && value.governanceState !== null) {
    if (!isRecord(value.governanceState)) return false;
    if (value.governanceState.labels !== undefined
      && (!Array.isArray(value.governanceState.labels)
        || !value.governanceState.labels.every((label) => typeof label === "string"))) {
      return false;
    }
    if (value.governanceState.highImpactActionsPaused !== undefined
      && typeof value.governanceState.highImpactActionsPaused !== "boolean") return false;
  }
  return true;
}

function isOptionalStoreProjection(value: unknown): boolean {
  if (value === undefined || value === null) return true;
  return isRecord(value)
    && hasText(value.listingState)
    && Array.isArray(value.continuityLabels)
    && value.continuityLabels.every((label) => typeof label === "string");
}

function isOptionalPublicStatus(value: unknown): boolean {
  if (value === undefined || value === null) return true;
  if (!isRecord(value)) return false;
  for (const key of [
    "registrationStatus",
    "registryStatus",
    "discoveryStatus",
    "productionReviewStatus",
    "sourceMaterialMode",
    "trustProjectionStatus",
    "nextAction",
  ]) {
    if (!hasText(value[key])) return false;
  }
  return value.primaryCircleId === null
    || (Number.isInteger(value.primaryCircleId) && Number(value.primaryCircleId) > 0);
}

function isNullableExternalAppBinding(value: unknown, expectedAppId: string): boolean {
  return value === null || isExternalAppBinding(value, expectedAppId);
}

function isExternalAppBinding(value: unknown, expectedAppId: string): boolean {
  if (!isRecord(value)) return false;
  return hasText(value.id)
    && value.externalAppId === expectedAppId
    && Number.isInteger(value.circleId)
    && Number(value.circleId) > 0
    && (value.bindingKind === "primary" || value.bindingKind === "attached")
    && ["pending", "active", "superseded", "revoked"].includes(String(value.status));
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === "object" && !Array.isArray(value);
}

function hasText(value: unknown): value is string {
  return typeof value === "string" && Boolean(value.trim());
}

export async function getExternalProgramRuntimeCapabilities(): Promise<ExternalProgramRuntimeCapabilities> {
  const response = await apiFetch(
    `${getQueryApiBaseUrl()}/api/v1/external-apps/runtime-capabilities`,
    {
      init: { cache: "no-store" },
    },
  );
  if (!response.ok) {
    throw new Error(
      `external_program_runtime_capabilities_failed:${response.status}`,
    );
  }
  return (await response.json()) as ExternalProgramRuntimeCapabilities;
}

export async function getExternalProgramErrorContract(): Promise<ExternalProgramErrorContract> {
  const response = await apiFetch(
    `${getQueryApiBaseUrl()}/api/v1/external-apps/error-contract`,
    {
      init: { cache: "no-store" },
    },
  );
  if (!response.ok) {
    throw new Error(
      `external_program_error_contract_failed:${response.status}`,
    );
  }
  return (await response.json()) as ExternalProgramErrorContract;
}

export async function getExternalAppIntegrationStatus(
  appId: string,
): Promise<ExternalProgramIntegrationStatus> {
  const response = await apiFetch(
    `${getQueryApiBaseUrl()}/api/v1/external-apps/${encodeURIComponent(appId)}/integration-status`,
    {
      init: { cache: "no-store" },
    },
  );
  if (!response.ok) {
    throw new Error(
      `external_app_integration_status_failed:${response.status}`,
    );
  }
  return (await response.json()) as ExternalProgramIntegrationStatus;
}

export async function getExternalProgramDeveloperDashboard(): Promise<ExternalProgramDeveloperDashboard> {
  const response = await authenticatedApiFetch(
    `${getQueryApiBaseUrl()}/api/v1/external-apps/developer/mine`,
    {
      init: { cache: "no-store" },
    },
  );
  if (!response.ok) {
    const body = await response.json().catch(() => null);
    const code = typeof body?.code === "string"
      ? body.code
      : typeof body?.error === "string"
        ? body.error
        : `external_program_developer_dashboard_failed:${response.status}`;
    throw new ExternalProgramDeveloperDashboardReadError({
      status: response.status,
      code,
      reason: typeof body?.reason === "string" ? body.reason : null,
      recoverable: typeof body?.recoverable === "boolean"
        ? body.recoverable
        : response.status === 409 || response.status === 429 || response.status >= 500,
    });
  }
  const body = await response.json().catch(() => null);
  if (
    !body
    || typeof body !== "object"
    || typeof body.ownerPubkey !== "string"
    || !Array.isArray(body.apps)
    || !body.apps.every((item: unknown) => (
      Boolean(item)
      && typeof item === "object"
      && !Array.isArray(item)
      && typeof (item as Record<string, unknown>).appId === "string"
      && Boolean(String((item as Record<string, unknown>).appId).trim())
    ))
  ) {
    throw new ExternalProgramDeveloperDashboardReadError({
      status: 502,
      code: "external_program_developer_dashboard_invalid_response",
      reason: "invalid_response",
      recoverable: true,
    });
  }
  return body as ExternalProgramDeveloperDashboard;
}

export async function registerSandboxExternalProgram(
  input: SandboxExternalProgramRegistrationRequest,
): Promise<SandboxExternalProgramRegistrationResponse> {
  const response = await apiFetch(
    `${getQueryApiBaseUrl()}/api/v1/external-apps/sandbox-registrations`,
    {
      init: {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(input),
      },
    },
  );
  const body = await response.json().catch(() => null);
  if (!response.ok) {
    const code = typeof body?.error === "string"
      ? body.error
      : `external_program_sandbox_registration_failed:${response.status}`;
    throw new Error(code);
  }
  return body as SandboxExternalProgramRegistrationResponse;
}

export async function fetchCircleExternalAppBindings(
  circleId: number,
): Promise<CircleExternalAppBindingRecord[]> {
  try {
    return await fetchCircleExternalAppBindingsStrict(circleId);
  } catch (error) {
    if (
      error instanceof CircleExternalAppBindingReadError &&
      (error.status === 401 || error.status === 403 || error.status === 404)
    ) {
      return [];
    }
    throw error;
  }
}

export async function fetchCircleExternalAppBindingsStrict(
  circleId: number,
): Promise<CircleExternalAppBindingRecord[]> {
  const response = await authenticatedApiFetch(
    `${getQueryApiBaseUrl()}/api/v1/external-apps/circle-bindings/by-circle/${circleId}`,
    {
      init: {
        cache: "no-store",
      },
    },
  );
  if (!response.ok) {
    const body = await response.json().catch(() => null);
    const code = typeof body?.code === "string"
      ? body.code
      : typeof body?.error === "string"
        ? body.error
        : `circle_external_app_bindings_failed:${response.status}`;
    throw new CircleExternalAppBindingReadError({
      status: response.status,
      code,
      reason: typeof body?.reason === "string" ? body.reason : null,
      recoverable: typeof body?.recoverable === "boolean"
        ? body.recoverable
        : response.status === 409 || response.status === 503,
    });
  }
  const data = await response.json().catch(() => null);
  if (!data || typeof data !== "object" || !Array.isArray(data.bindings)) {
    throw invalidCircleExternalAppBindingResponse("bindings_array_missing");
  }
  return data.bindings.map((item: unknown, index: number) => {
    const binding = normalizeCircleExternalAppBinding(item);
    if (
      !binding.id.trim()
      || !binding.appId.trim()
      || binding.circleId !== circleId
      || !["primary", "attached"].includes(binding.bindingKind)
      || !["active", "pending"].includes(binding.status)
    ) {
      throw invalidCircleExternalAppBindingResponse(`invalid_binding_${index}`);
    }
    return binding;
  });
}

function normalizeCircleExternalAppBinding(
  item: unknown,
): CircleExternalAppBindingRecord {
  const record = item && typeof item === "object" && !Array.isArray(item)
    ? item as Record<string, unknown>
    : {};
  return {
    id: String(record.id || ""),
    appId: String(record.appId || record.externalAppId || ""),
    appName: record.appName == null ? null : String(record.appName),
    appStatus: record.appStatus == null ? null : String(record.appStatus),
    circleId: Number(record.circleId),
    bindingKind: String(record.bindingKind || ""),
    status: String(record.status || ""),
    governanceRequestId:
      record.governanceRequestId == null
        ? null
        : String(record.governanceRequestId),
    effectiveAt: record.effectiveAt == null ? null : String(record.effectiveAt),
    createdAt: record.createdAt == null ? null : String(record.createdAt),
  };
}

function invalidCircleExternalAppBindingResponse(
  reason: string,
): CircleExternalAppBindingReadError {
  return new CircleExternalAppBindingReadError({
    status: 502,
    code: "circle_external_app_bindings_invalid_response",
    reason,
    recoverable: true,
  });
}
