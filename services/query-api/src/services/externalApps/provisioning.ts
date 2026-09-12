export const EXTERNAL_APP_PROVISIONING_CAPABILITIES = [
  "source_material_private_sidecar",
  "voice_livekit_sandbox",
] as const;

export type ExternalAppProvisioningCapability =
  (typeof EXTERNAL_APP_PROVISIONING_CAPABILITIES)[number];

export const EXTERNAL_APP_PROVISIONING_STATUSES = [
  "requested",
  "approved",
  "provisioning",
  "active",
  "degraded",
  "failed",
  "revoked",
] as const;

export type ExternalAppProvisioningStatusValue =
  (typeof EXTERNAL_APP_PROVISIONING_STATUSES)[number];

export type ExternalProgramSourceMaterialsMode =
  | "private_sidecar"
  | "private_sidecar_required";

export type ExternalProgramVoiceMode =
  | "disabled"
  | "stub"
  | "token_only"
  | "livekit_unhealthy"
  | "livekit_healthy"
  | "configuration_error";

export interface ExternalAppProvisioningGrantProjectionInput {
  capability: string;
  environment: string;
  status: string;
  provider?: string | null;
  runtimeBaseUrl?: string | null;
  healthStatus?: string | null;
  healthCheckedAt?: Date | string | null;
  expiresAt?: Date | string | null;
  failureCode?: string | null;
}

export interface ExternalProgramCapabilityProvisioningStatus {
  requested: boolean;
  status: ExternalAppProvisioningStatusValue | "not_requested";
  mode: ExternalProgramSourceMaterialsMode | ExternalProgramVoiceMode;
  healthStatus: string | null;
  healthCheckedAt: string | null;
  failureCode: string | null;
  runtimeBaseUrl?: string | null;
}

export interface ExternalProgramProvisioningStatus {
  sourceMaterials: ExternalProgramCapabilityProvisioningStatus & {
    mode: ExternalProgramSourceMaterialsMode;
  };
  voice: ExternalProgramCapabilityProvisioningStatus & {
    mode: ExternalProgramVoiceMode;
  };
}

export function normalizeProvisioningCapability(
  raw: unknown,
): ExternalAppProvisioningCapability | null {
  const value = String(raw ?? "").trim();
  return EXTERNAL_APP_PROVISIONING_CAPABILITIES.includes(
    value as ExternalAppProvisioningCapability,
  )
    ? (value as ExternalAppProvisioningCapability)
    : null;
}

export function normalizeProvisioningStatus(
  raw: unknown,
): ExternalAppProvisioningStatusValue | null {
  const value = String(raw ?? "").trim();
  return EXTERNAL_APP_PROVISIONING_STATUSES.includes(
    value as ExternalAppProvisioningStatusValue,
  )
    ? (value as ExternalAppProvisioningStatusValue)
    : null;
}

export function buildExternalAppProvisioningStatus(input: {
  grants: ExternalAppProvisioningGrantProjectionInput[];
  publicView: boolean;
}): ExternalProgramProvisioningStatus {
  const sourceGrant = selectGrantForCapability(
    input.grants,
    "source_material_private_sidecar",
  );
  const voiceGrant = selectGrantForCapability(
    input.grants,
    "voice_livekit_sandbox",
  );

  return {
    sourceMaterials: buildSourceMaterialsStatus(sourceGrant, input.publicView),
    voice: buildVoiceStatus(voiceGrant, input.publicView),
  };
}

export async function buildExternalAppProvisioningStatusForApp(
  prisma: {
    externalAppProvisioningGrant?: {
      findMany(input: unknown): Promise<ExternalAppProvisioningGrantProjectionInput[]>;
    };
  },
  input: {
    externalAppId: string;
    environment?: string | null;
    publicView: boolean;
    ownerPubkey?: string | null;
  },
): Promise<ExternalProgramProvisioningStatus> {
  const client = prisma.externalAppProvisioningGrant;
  const environment = normalizeOptionalString(input.environment);
  const ownerPubkey = normalizeOptionalString(input.ownerPubkey);
  const where = {
    externalAppId: input.externalAppId,
    ...(environment ? { environment } : {}),
    ...(ownerPubkey ? { externalApp: { ownerPubkey } } : {}),
  };
  const grants =
    typeof client?.findMany === "function"
      ? await client.findMany({
          where,
          orderBy: [{ updatedAt: "desc" }],
          select: {
            capability: true,
            environment: true,
            status: true,
            provider: true,
            runtimeBaseUrl: true,
            healthStatus: true,
            healthCheckedAt: true,
            expiresAt: true,
            failureCode: true,
          },
        })
      : [];
  return buildExternalAppProvisioningStatus({
    grants,
    publicView: input.publicView,
  });
}

function selectGrantForCapability(
  grants: ExternalAppProvisioningGrantProjectionInput[],
  capability: ExternalAppProvisioningCapability,
): ExternalAppProvisioningGrantProjectionInput | null {
  return (
    grants.find(
      (grant) => normalizeProvisioningCapability(grant.capability) === capability,
    ) ?? null
  );
}

function buildSourceMaterialsStatus(
  grant: ExternalAppProvisioningGrantProjectionInput | null,
  publicView: boolean,
): ExternalProgramCapabilityProvisioningStatus & {
  mode: ExternalProgramSourceMaterialsMode;
} {
  if (!grant) {
    return {
      requested: false,
      status: "not_requested",
      mode: "private_sidecar_required",
      healthStatus: null,
      healthCheckedAt: null,
      failureCode: null,
    };
  }
  const status = normalizeProvisioningStatus(grant.status) ?? "requested";
  return withRuntimeUrl(
    {
      requested: true,
      status,
      mode: status === "active" || status === "degraded"
        ? "private_sidecar"
        : "private_sidecar_required",
      healthStatus: normalizeOptionalString(grant.healthStatus),
      healthCheckedAt: toIsoOrNull(grant.healthCheckedAt),
      failureCode: normalizeOptionalString(grant.failureCode),
    },
    grant,
    publicView,
  );
}

function buildVoiceStatus(
  grant: ExternalAppProvisioningGrantProjectionInput | null,
  publicView: boolean,
): ExternalProgramCapabilityProvisioningStatus & {
  mode: ExternalProgramVoiceMode;
} {
  if (!grant) {
    return {
      requested: false,
      status: "not_requested",
      mode: "disabled",
      healthStatus: null,
      healthCheckedAt: null,
      failureCode: null,
    };
  }
  const status = normalizeProvisioningStatus(grant.status) ?? "requested";
  const healthStatus = normalizeOptionalString(grant.healthStatus);
  return withRuntimeUrl(
    {
      requested: true,
      status,
      mode: deriveVoiceMode(status, healthStatus),
      healthStatus,
      healthCheckedAt: toIsoOrNull(grant.healthCheckedAt),
      failureCode: normalizeOptionalString(grant.failureCode),
    },
    grant,
    publicView,
  );
}

function deriveVoiceMode(
  status: ExternalAppProvisioningStatusValue,
  healthStatus: string | null,
): ExternalProgramVoiceMode {
  if (status === "failed") return "configuration_error";
  if (status === "revoked") return "disabled";
  if (status === "active" && healthStatus === "healthy") {
    return "livekit_healthy";
  }
  if (status === "active" || status === "degraded") {
    return "livekit_unhealthy";
  }
  if (status === "approved" || status === "provisioning") {
    return "token_only";
  }
  return "stub";
}

function withRuntimeUrl<T extends ExternalProgramCapabilityProvisioningStatus>(
  status: T,
  grant: ExternalAppProvisioningGrantProjectionInput,
  publicView: boolean,
): T {
  if (publicView) return status;
  const runtimeBaseUrl = normalizeOptionalString(grant.runtimeBaseUrl);
  return {
    ...status,
    runtimeBaseUrl,
  };
}

function normalizeOptionalString(raw: unknown): string | null {
  const value = String(raw ?? "").trim();
  return value ? value : null;
}

function toIsoOrNull(raw: Date | string | null | undefined): string | null {
  if (!raw) return null;
  if (raw instanceof Date) return raw.toISOString();
  const parsed = new Date(raw);
  return Number.isNaN(parsed.getTime()) ? null : parsed.toISOString();
}
