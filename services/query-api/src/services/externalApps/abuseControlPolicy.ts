import { canonicalSolanaPublicKeyString } from "../identity/solanaPublicKey";

export interface SandboxRegistrationAbusePolicy {
  maxAppsPerOwner: number;
  maxRegistrationsPerHour: number;
  blockedOwnerPubkeys: Set<string>;
}

export function loadSandboxRegistrationAbusePolicy(
  env: NodeJS.ProcessEnv = process.env,
): SandboxRegistrationAbusePolicy {
  return {
    maxAppsPerOwner: parseBoundedInt(
      env.EXTERNAL_APP_SANDBOX_MAX_APPS_PER_OWNER,
      10,
      { min: 1, max: 100 },
    ),
    maxRegistrationsPerHour: parseBoundedInt(
      env.EXTERNAL_APP_SANDBOX_MAX_REGISTRATIONS_PER_HOUR,
      5,
      { min: 1, max: 100 },
    ),
    blockedOwnerPubkeys: new Set(
      String(env.EXTERNAL_APP_SANDBOX_BLOCKED_OWNER_PUBKEYS || "")
        .split(",")
        .map((value) => value.trim())
        .filter(Boolean)
        .map((value) => {
          const canonical = canonicalSolanaPublicKeyString(value);
          if (!canonical) throw new Error("invalid_external_app_blocked_owner_pubkey");
          return canonical;
        }),
    ),
  };
}

export function assertSandboxRegistrationAllowed(input: {
  ownerPubkey: string;
  existingAppCount: number;
  recentRegistrationCount: number;
  policy?: SandboxRegistrationAbusePolicy;
}): void {
  const policy = input.policy ?? loadSandboxRegistrationAbusePolicy();
  const ownerPubkey = canonicalSolanaPublicKeyString(input.ownerPubkey);
  if (!ownerPubkey) {
    throw new Error("invalid_external_app_registration_owner_pubkey");
  }
  if (policy.blockedOwnerPubkeys.has(ownerPubkey)) {
    throw new Error("external_app_registration_owner_blocked");
  }
  if (input.existingAppCount >= policy.maxAppsPerOwner) {
    throw new Error("external_app_registration_quota_exceeded");
  }
  if (input.recentRegistrationCount >= policy.maxRegistrationsPerHour) {
    throw new Error("external_app_registration_rate_limited");
  }
}

function parseBoundedInt(
  raw: unknown,
  fallback: number,
  input: { min: number; max: number },
): number {
  const value =
    typeof raw === "number"
      ? Math.trunc(raw)
      : typeof raw === "string" && /^\d+$/.test(raw.trim())
        ? Number(raw.trim())
        : fallback;
  if (!Number.isFinite(value)) return fallback;
  return Math.max(input.min, Math.min(input.max, value));
}
