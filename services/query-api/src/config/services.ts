/**
 * Service Configuration — "builtin first, external override"
 *
 * Each module runs inside query-api by default.
 * Set mode='external' + externalUrl to redirect to a user-hosted service.
 * Frontend reads NEXT_PUBLIC_* env vars to know where to connect.
 */

import { loadAiRuntimeConfig } from "./ai";
import {
  assertStrongPublicSecret,
  isExplicitFalse,
  isPublicHardeningRequired,
  resolveJwtSecret,
} from "./jwtSecret";
import {
  resolveContributionAssessmentAiProviderConfig,
  type ContributionAssessmentAiProviderConfig,
} from "../services/contributionAssessment/privacyProfile";
import {
  publicNodeSafeApis,
  sidecarOwnedApis,
  type NodeApiSurface,
} from "./apiSurfaceRegistry";

export interface ServiceEndpoint {
  mode: "builtin" | "external";
  externalUrl?: string;
}

export interface AiGatewayAvailability {
  available: boolean;
  reason: "ok" | "missing_gateway_url" | "frontend_dev_server_gateway";
}

export type IdentityNotificationMode = "all" | "promotion_only" | "none";
export type QueryApiRuntimeRole = "PUBLIC_NODE" | "PRIVATE_SIDECAR";
export type QueryApiBackgroundMode =
  | "api_only"
  | "worker"
  | "scheduler"
  | "all";
export type QueryApiDeploymentProfile =
  | "managed_default"
  | "sovereign_private"
  | "public_node_only";
export type SidecarAuthMode = "session_cookie";
export type SidecarProxyMode = "none" | "ephemeral_same_origin";
export type CrystalMintAdapterMode = "mock_chain" | "token2022_local";
export type ContributionAssessmentProviderMode = "disabled" | "mock" | "ai";
export type ContributionAssessmentRolloutMode = "legacy" | "shadow" | "enforce";
export interface QueryApiRuntimeConfig {
  runtimeRole: QueryApiRuntimeRole;
  backgroundMode: QueryApiBackgroundMode;
  backgroundServices: QueryApiBackgroundServicesConfig;
  deploymentProfile: QueryApiDeploymentProfile;
  publicBaseUrl: string | null;
  sidecarBaseUrl: string | null;
  sidecarDiscoverable: boolean;
  sidecarAuthMode: SidecarAuthMode;
  sidecarProxyMode: SidecarProxyMode;
  publicNodeSafeApis: NodeApiSurface[];
  sidecarOwnedApis: NodeApiSurface[];
  hostedOnlyExceptions: string[];
  publicHardeningRequired: boolean;
  hostedAppRuntimeEnabled: boolean;
  hostedAppRequireChainTrustRoot: boolean;
}

export interface QueryApiBackgroundServicesConfig {
  aiJobWorker: boolean;
  singletonSchedulers: boolean;
}

export interface IdentityCirclePolicy {
  initiateMessages?: number;
  memberCitations?: number;
  elderPercentile?: number;
  inactivityDays?: number;
  notificationMode?: IdentityNotificationMode;
}

export interface CrystalMintRuntimeConfig {
  adapterMode: CrystalMintAdapterMode;
  rpcUrl: string | null;
  authoritySecret: string | null;
  masterOwnerPubkey: string | null;
  metadataBaseUrl: string | null;
}

export interface ContributionAssessmentRuntimeConfig {
  rolloutMode: ContributionAssessmentRolloutMode;
  providerMode: ContributionAssessmentProviderMode;
  aiProvider: ContributionAssessmentAiProviderConfig | null;
}

const VALID_IDENTITY_NOTIFICATION_MODES: IdentityNotificationMode[] = [
  "all",
  "promotion_only",
  "none",
];

const VALID_RUNTIME_ROLES: QueryApiRuntimeRole[] = [
  "PUBLIC_NODE",
  "PRIVATE_SIDECAR",
];

const VALID_BACKGROUND_MODES: QueryApiBackgroundMode[] = [
  "api_only",
  "worker",
  "scheduler",
  "all",
];

const VALID_DEPLOYMENT_PROFILES: QueryApiDeploymentProfile[] = [
  "managed_default",
  "sovereign_private",
  "public_node_only",
];

const VALID_SIDECAR_PROXY_MODES: SidecarProxyMode[] = [
  "none",
  "ephemeral_same_origin",
];

const VALID_CONTRIBUTION_ASSESSMENT_PROVIDER_MODES: ContributionAssessmentProviderMode[] =
  ["disabled", "mock", "ai"];

const VALID_CONTRIBUTION_ASSESSMENT_ROLLOUT_MODES: ContributionAssessmentRolloutMode[] =
  ["legacy", "shadow", "enforce"];
function parseBoundedInteger(
  raw: unknown,
  input: { min: number; max?: number },
): number | null {
  const parsed =
    typeof raw === "number"
      ? Math.trunc(raw)
      : typeof raw === "string" && /^-?\d+$/.test(raw.trim())
        ? parseInt(raw.trim(), 10)
        : Number.NaN;
  if (!Number.isFinite(parsed)) return null;
  if (parsed < input.min) return null;
  if (typeof input.max === "number" && parsed > input.max) return null;
  return parsed;
}

export function parseIdentityNotificationMode(
  raw: string | undefined,
  fallback: IdentityNotificationMode = "all",
): IdentityNotificationMode {
  const normalized = parseOptionalIdentityNotificationMode(raw);
  if (normalized) return normalized;
  return fallback;
}

function parseRuntimeRole(
  raw: string | undefined,
  fallback: QueryApiRuntimeRole = "PRIVATE_SIDECAR",
  options: { hardeningRequired?: boolean } = {},
): QueryApiRuntimeRole {
  const hardeningRequired = options.hardeningRequired === true;
  if (typeof raw !== "string" || !raw.trim()) {
    if (hardeningRequired) {
      throw new Error("query_api_runtime_role_required");
    }
    return fallback;
  }
  const normalized = raw.trim().toUpperCase() as QueryApiRuntimeRole;
  if (VALID_RUNTIME_ROLES.includes(normalized)) {
    return normalized;
  }
  if (hardeningRequired) {
    throw new Error("query_api_runtime_role_invalid");
  }
  return fallback;
}

function parseBackgroundMode(
  raw: string | undefined,
  fallback: QueryApiBackgroundMode,
  options: { hardeningRequired?: boolean } = {},
): QueryApiBackgroundMode {
  if (typeof raw !== "string" || !raw.trim()) {
    return fallback;
  }
  const normalized = raw.trim().toLowerCase() as QueryApiBackgroundMode;
  if (VALID_BACKGROUND_MODES.includes(normalized)) return normalized;
  if (options.hardeningRequired === true) {
    throw new Error("query_api_background_mode_invalid");
  }
  return fallback;
}

function resolveDefaultBackgroundMode(): QueryApiBackgroundMode {
  return "all";
}

function toBackgroundServices(
  mode: QueryApiBackgroundMode,
): QueryApiBackgroundServicesConfig {
  return {
    aiJobWorker: mode === "worker" || mode === "all",
    singletonSchedulers: mode === "scheduler" || mode === "all",
  };
}

function parseDeploymentProfile(
  raw: string | undefined,
  fallback: QueryApiDeploymentProfile = "managed_default",
): QueryApiDeploymentProfile {
  if (typeof raw !== "string") return fallback;
  const normalized = raw.trim().toLowerCase() as QueryApiDeploymentProfile;
  return VALID_DEPLOYMENT_PROFILES.includes(normalized) ? normalized : fallback;
}

function parseDiscussionAuthMode(
  raw: string | undefined,
): "session_token" | "wallet_per_message" {
  const normalized = String(raw || "session_token")
    .trim()
    .toLowerCase();
  if (normalized === "session_token" || normalized === "wallet_per_message") {
    return normalized;
  }
  throw new Error("discussion_auth_mode_invalid");
}

function parseSidecarProxyMode(
  raw: string | undefined,
  fallback: SidecarProxyMode = "none",
): SidecarProxyMode {
  if (typeof raw !== "string") return fallback;
  const normalized = raw.trim().toLowerCase() as SidecarProxyMode;
  return VALID_SIDECAR_PROXY_MODES.includes(normalized) ? normalized : fallback;
}

function parseHostedAppRuntimeEnabled(raw: string | undefined): boolean {
  return (
    String(raw || "")
      .trim()
      .toLowerCase() === "true"
  );
}

export function isRouteAProviderAdmissionCredentialEnabled(
  env: NodeJS.ProcessEnv = process.env,
): boolean {
  return String(
    env.GOVERNANCE_PROVIDER_ADMISSION_CREDENTIAL_ISSUANCE_ENABLED || "",
  ).trim().toLowerCase() === "true";
}

export function isRouteAProviderAdmissionCredentialRequireChainAnchors(
  env: NodeJS.ProcessEnv = process.env,
): boolean {
  const raw = String(
    env.GOVERNANCE_PROVIDER_ADMISSION_CREDENTIAL_REQUIRE_CHAIN_ANCHORS ?? "true",
  )
    .trim()
    .toLowerCase();
  return raw !== "false";
}

export function parseHostedAppRequireChainTrustRoot(
  env: NodeJS.ProcessEnv = process.env,
  input: {
    hostedAppRuntimeEnabled?: boolean;
    publicHardeningRequired?: boolean;
  } = {},
): boolean {
  const raw = String(env.HOSTED_APP_REQUIRE_CHAIN_TRUST_ROOT || "")
    .trim()
    .toLowerCase();
  const enabled =
    input.hostedAppRuntimeEnabled ??
    parseHostedAppRuntimeEnabled(env.HOSTED_APP_RUNTIME_ENABLED);
  const hardened =
    input.publicHardeningRequired ?? isPublicHardeningRequired(env);
  const productionLike =
    hardened ||
    String(env.NODE_ENV || "")
      .trim()
      .toLowerCase() === "production";

  if (raw === "true") return true;
  if (raw === "false") {
    if (productionLike && enabled) {
      throw new Error("hosted_app_chain_trust_root_required");
    }
    return false;
  }
  if (productionLike && enabled) {
    throw new Error("hosted_app_chain_trust_root_required");
  }
  return false;
}

function parseOptionalIdentityNotificationMode(
  raw: unknown,
): IdentityNotificationMode | undefined {
  if (typeof raw !== "string") return undefined;
  const normalized = raw.trim().toLowerCase() as IdentityNotificationMode;
  return VALID_IDENTITY_NOTIFICATION_MODES.includes(normalized)
    ? normalized
    : undefined;
}

function parseIdentityCirclePolicy(raw: unknown): IdentityCirclePolicy | null {
  if (!raw || typeof raw !== "object" || Array.isArray(raw)) return null;
  const policy = raw as Record<string, unknown>;
  const initiateMessages = parseBoundedInteger(policy.initiateMessages, {
    min: 1,
  });
  const memberCitations = parseBoundedInteger(policy.memberCitations, {
    min: 0,
  });
  const elderPercentile = parseBoundedInteger(policy.elderPercentile, {
    min: 1,
    max: 100,
  });
  const inactivityDays = parseBoundedInteger(policy.inactivityDays, { min: 1 });
  const notificationMode = parseOptionalIdentityNotificationMode(
    policy.notificationMode,
  );

  const hasFields =
    initiateMessages !== null ||
    memberCitations !== null ||
    elderPercentile !== null ||
    inactivityDays !== null ||
    notificationMode !== undefined;
  if (!hasFields) return null;

  return {
    ...(initiateMessages !== null ? { initiateMessages } : {}),
    ...(memberCitations !== null ? { memberCitations } : {}),
    ...(elderPercentile !== null ? { elderPercentile } : {}),
    ...(inactivityDays !== null ? { inactivityDays } : {}),
    ...(notificationMode ? { notificationMode } : {}),
  };
}

export function parseIdentityPolicyByCircle(
  raw: string | undefined,
): Record<number, IdentityCirclePolicy> {
  if (!raw || !raw.trim()) return {};
  try {
    const parsed = JSON.parse(raw);
    if (!parsed || typeof parsed !== "object" || Array.isArray(parsed))
      return {};
    const result: Record<number, IdentityCirclePolicy> = {};
    for (const [key, value] of Object.entries(
      parsed as Record<string, unknown>,
    )) {
      const circleId = parseBoundedInteger(key, { min: 1 });
      if (circleId === null) continue;
      const policy = parseIdentityCirclePolicy(value);
      if (!policy) continue;
      result[circleId] = policy;
    }
    return result;
  } catch {
    return {};
  }
}

export function loadNodeRuntimeConfig(
  env: NodeJS.ProcessEnv = process.env,
): QueryApiRuntimeConfig {
  const publicHardeningRequired = isPublicHardeningRequired(env);
  const runtimeRole = parseRuntimeRole(
    env.QUERY_API_RUNTIME_ROLE,
    "PRIVATE_SIDECAR",
    {
      hardeningRequired: publicHardeningRequired,
    },
  );
  const backgroundMode = parseBackgroundMode(
    env.QUERY_API_BACKGROUND_MODE,
    resolveDefaultBackgroundMode(),
    { hardeningRequired: publicHardeningRequired },
  );
  if (
    publicHardeningRequired &&
    runtimeRole === "PUBLIC_NODE" &&
    (typeof env.QUERY_API_BACKGROUND_MODE !== "string" ||
      !env.QUERY_API_BACKGROUND_MODE.trim())
  ) {
    throw new Error("query_api_background_mode_required_for_public_node");
  }
  if (
    publicHardeningRequired &&
    runtimeRole === "PUBLIC_NODE" &&
    backgroundMode !== "api_only"
  ) {
    throw new Error("query_api_background_mode_public_node_unsafe");
  }
  const backgroundServices = toBackgroundServices(backgroundMode);
  const deploymentProfile = parseDeploymentProfile(
    env.QUERY_API_DEPLOYMENT_PROFILE,
  );
  const publicBaseUrl =
    String(env.QUERY_API_PUBLIC_BASE_URL || "").trim() || null;
  const sidecarBaseUrl =
    String(env.QUERY_API_SIDECAR_BASE_URL || "").trim() || null;
  const sidecarAuthMode: SidecarAuthMode = "session_cookie";
  const sidecarProxyMode = parseSidecarProxyMode(
    env.QUERY_API_SIDECAR_PROXY_MODE,
  );
  const hostedAppRuntimeEnabled = parseHostedAppRuntimeEnabled(
    env.HOSTED_APP_RUNTIME_ENABLED,
  );
  const hostedAppRequireChainTrustRoot = parseHostedAppRequireChainTrustRoot(
    env,
    {
      hostedAppRuntimeEnabled,
      publicHardeningRequired,
    },
  );
  const discussionAuthMode = parseDiscussionAuthMode(env.DISCUSSION_AUTH_MODE);
  if (publicHardeningRequired) {
    resolveJwtSecret(env, { publicHardeningRequired });
    assertStrongPublicSecret({
      value: env.INTERNAL_API_TOKEN,
      requiredError: "internal_api_token_required",
      insecureDefaultError: "internal_api_token_insecure_default",
      tooShortError: "internal_api_token_too_short",
    });
    if (isExplicitFalse(env.AUTH_SESSION_REQUIRE_SIGNATURE)) {
      throw new Error("auth_session_signature_required");
    }
    if (discussionAuthMode !== "session_token") {
      throw new Error("discussion_session_token_auth_mode_required");
    }
    if (isExplicitFalse(env.DISCUSSION_REQUIRE_SESSION_TOKEN)) {
      throw new Error("discussion_session_token_required");
    }
    if (isExplicitFalse(env.REQUIRE_DISCUSSION_SIGNATURES)) {
      throw new Error("discussion_signatures_required");
    }
    const collabAuthMode = String(env.COLLAB_AUTH_MODE || "strict")
      .trim()
      .toLowerCase();
    if (collabAuthMode !== "strict") {
      throw new Error("collab_strict_auth_required");
    }
  }
  return {
    runtimeRole,
    backgroundMode,
    backgroundServices,
    deploymentProfile,
    publicBaseUrl,
    sidecarBaseUrl,
    sidecarDiscoverable: runtimeRole === "PUBLIC_NODE" && !!sidecarBaseUrl,
    sidecarAuthMode,
    sidecarProxyMode,
    publicNodeSafeApis: [...publicNodeSafeApis],
    sidecarOwnedApis: [...sidecarOwnedApis],
    publicHardeningRequired,
    hostedAppRuntimeEnabled,
    hostedAppRequireChainTrustRoot,
    hostedOnlyExceptions: [
      "draft_working_copy",
      "temporary_edit_grants",
      "storage_upload",
    ],
  };
}

export function loadCrystalMintRuntimeConfig(
  env: NodeJS.ProcessEnv = process.env,
): CrystalMintRuntimeConfig {
  const rpcUrl = String(env.CRYSTAL_MINT_RPC_URL || "").trim() || null;
  const authoritySecret =
    String(env.CRYSTAL_MINT_AUTHORITY_SECRET || "").trim() || null;
  const masterOwnerPubkey =
    String(env.CRYSTAL_MASTER_OWNER_PUBKEY || "").trim() || null;
  const metadataBaseUrl =
    String(env.CRYSTAL_METADATA_BASE_URL || "").trim() || null;
  const isProduction =
    String(env.NODE_ENV || "")
      .trim()
      .toLowerCase() === "production";
  const hasRealMintCredentials = !!(rpcUrl && authoritySecret);
  if (isProduction && !hasRealMintCredentials) {
    throw new Error("crystal_mint_credentials_required");
  }
  const adapterMode: CrystalMintAdapterMode = hasRealMintCredentials
    ? "token2022_local"
    : "mock_chain";

  return {
    adapterMode,
    rpcUrl,
    authoritySecret,
    masterOwnerPubkey,
    metadataBaseUrl,
  };
}

export function parseContributionAssessmentProviderMode(
  raw: string | undefined,
  fallback: ContributionAssessmentProviderMode = "disabled",
  env: NodeJS.ProcessEnv = process.env,
): {
  providerMode: ContributionAssessmentProviderMode;
  aiProvider: ContributionAssessmentAiProviderConfig | null;
} {
  if (typeof raw !== "string" || !raw.trim()) {
    return {
      providerMode: fallback,
      aiProvider: null,
    };
  }
  const normalized = raw.trim().toLowerCase();
  if (normalized === "ai") {
    const aiConfig = resolveContributionAssessmentAiProviderConfig(env);
    if (!aiConfig.ok) throw new Error(aiConfig.error);
    return {
      providerMode: "ai",
      aiProvider: aiConfig.config,
    };
  }
  if (
    VALID_CONTRIBUTION_ASSESSMENT_PROVIDER_MODES.includes(
      normalized as ContributionAssessmentProviderMode,
    )
  ) {
    return {
      providerMode: normalized as ContributionAssessmentProviderMode,
      aiProvider: null,
    };
  }
  if (
    normalized === "legacy" ||
    normalized === "shadow" ||
    normalized === "enforce"
  ) {
    return {
      providerMode: fallback,
      aiProvider: null,
    };
  }
  throw new Error("invalid_contribution_assessment_provider_mode");
}

export function parseContributionAssessmentRolloutMode(
  raw: string | undefined,
  fallback: ContributionAssessmentRolloutMode = "shadow",
): ContributionAssessmentRolloutMode {
  if (typeof raw !== "string" || !raw.trim()) return fallback;
  const normalized = raw.trim().toLowerCase();
  if (
    VALID_CONTRIBUTION_ASSESSMENT_ROLLOUT_MODES.includes(
      normalized as ContributionAssessmentRolloutMode,
    )
  ) {
    return normalized as ContributionAssessmentRolloutMode;
  }
  throw new Error("invalid_contribution_assessment_mode");
}

export function loadContributionAssessmentRuntimeConfig(
  env: NodeJS.ProcessEnv = process.env,
): ContributionAssessmentRuntimeConfig {
  const provider = parseContributionAssessmentProviderMode(
    env.CONTRIBUTION_ASSESSMENT_PROVIDER_MODE,
    "disabled",
    env,
  );
  return {
    rolloutMode: parseContributionAssessmentRolloutMode(
      env.CONTRIBUTION_ASSESSMENT_MODE,
    ),
    providerMode: provider.providerMode,
    aiProvider: provider.aiProvider,
  };
}

export function requirePrivateSidecarSurface(
  surface: Extract<
    NodeApiSurface,
    | "auth_session"
    | "source_materials"
    | "profile_avatar"
    | "seeded"
    | "discussion_runtime"
    | "collab"
    | "ghost_draft_private"
    | "governance_execution"
    | "external_program_operator"
    | "hosted_apps_runtime"
  >,
):
  | { ok: true }
  | {
      ok: false;
      statusCode: 409;
      error: "private_sidecar_required";
      route: typeof surface;
    } {
  const runtime = loadNodeRuntimeConfig();
  if (runtime.runtimeRole === "PRIVATE_SIDECAR") {
    return { ok: true };
  }

  return {
    ok: false,
    statusCode: 409,
    error: "private_sidecar_required",
    route: surface,
  };
}

export function assessBuiltinAiGatewayAvailability(
  gatewayUrl: string | null | undefined,
): AiGatewayAvailability {
  const normalized = String(gatewayUrl || "").trim();
  if (!normalized) {
    return {
      available: false,
      reason: "missing_gateway_url",
    };
  }

  try {
    const parsed = new URL(normalized);
    const isLoopback =
      parsed.hostname === "localhost" || parsed.hostname === "127.0.0.1";
    const isFrontendDevPort = parsed.port === "3000";
    if (isLoopback && isFrontendDevPort) {
      return {
        available: false,
        reason: "frontend_dev_server_gateway",
      };
    }
  } catch {
    return {
      available: false,
      reason: "missing_gateway_url",
    };
  }

  return {
    available: true,
    reason: "ok",
  };
}

export const serviceConfig = {
  /** Yjs collaborative editing WebSocket */
  collab: {
    mode: (process.env.COLLAB_MODE || "builtin") as "builtin" | "external",
    externalUrl: process.env.COLLAB_EXTERNAL_URL,
  } satisfies ServiceEndpoint,

  /** AI services (Ghost Draft + Message Scoring) */
  ai: loadAiRuntimeConfig(),

  /** Draft contribution assessment runtime */
  contributionAssessment: loadContributionAssessmentRuntimeConfig(),

  /** Identity thresholds (Circle-level overridable) */
  identity: {
    /** Messages required for Visitor → Initiate */
    initiateThreshold: parseInt(
      process.env.IDENTITY_INITIATE_MESSAGES || "3",
      10,
    ),
    /** Citations required for Initiate → Member */
    memberCitations: parseInt(process.env.IDENTITY_MEMBER_CITATIONS || "2", 10),
    /** Reputation top X% for Member → Elder */
    elderPercentile: parseInt(
      process.env.IDENTITY_ELDER_PERCENTILE || "10",
      10,
    ),
    /** Days of inactivity before demotion */
    inactivityDays: parseInt(process.env.IDENTITY_INACTIVITY_DAYS || "30", 10),
    /** Notification policy for identity transitions */
    notificationMode: parseIdentityNotificationMode(
      process.env.IDENTITY_NOTIFICATION_MODE,
    ),
    /** Optional per-circle overrides, keyed by circleId */
    circlePolicies: parseIdentityPolicyByCircle(
      process.env.IDENTITY_POLICY_BY_CIRCLE_JSON,
    ),
  },
};
