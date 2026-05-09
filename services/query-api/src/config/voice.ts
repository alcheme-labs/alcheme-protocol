export type VoiceProvider = "disabled" | "livekit";

export interface VoiceRuntimeConfig {
  enabled: boolean;
  provider: VoiceProvider;
  publicUrl: string | null;
  livekitApiKey: string | null;
  livekitApiSecret: string | null;
  defaultTtlSec: number;
  tokenTtlSec: number;
}

export interface PublicVoiceRuntimeConfig {
  enabled: boolean;
  provider: VoiceProvider;
  publicUrl: string | null;
  defaultTtlSec: number;
  tokenTtlSec: number;
}

const DEFAULT_VOICE_TTL_SEC = 7_200;
const DEFAULT_TOKEN_TTL_SEC = 900;

export function loadVoiceRuntimeConfig(
  env: NodeJS.ProcessEnv = process.env,
): VoiceRuntimeConfig {
  const provider = parseVoiceProvider(env.VOICE_PROVIDER);
  const defaultTtlSec = parseBoundedInteger(
    env.VOICE_DEFAULT_TTL_SEC,
    DEFAULT_VOICE_TTL_SEC,
    { min: 60, max: 24 * 60 * 60 },
  );
  const tokenTtlSec = parseBoundedInteger(
    env.VOICE_TOKEN_TTL_SEC,
    DEFAULT_TOKEN_TTL_SEC,
    { min: 60, max: 60 * 60 },
  );

  if (provider === "disabled") {
    return {
      enabled: false,
      provider,
      publicUrl: null,
      livekitApiKey: null,
      livekitApiSecret: null,
      defaultTtlSec,
      tokenTtlSec,
    };
  }

  const publicUrl = normalizeOptionalString(env.VOICE_PUBLIC_URL);
  const livekitApiKey = normalizeOptionalString(env.LIVEKIT_API_KEY);
  const livekitApiSecret = normalizeOptionalString(env.LIVEKIT_API_SECRET);
  if (!publicUrl || !livekitApiKey || !livekitApiSecret) {
    throw new Error("voice_livekit_credentials_required");
  }

  return {
    enabled: true,
    provider,
    publicUrl,
    livekitApiKey,
    livekitApiSecret,
    defaultTtlSec,
    tokenTtlSec,
  };
}

export function toPublicVoiceRuntimeConfig(
  config: VoiceRuntimeConfig,
): PublicVoiceRuntimeConfig {
  return {
    enabled: config.enabled,
    provider: config.provider,
    publicUrl: config.publicUrl,
    defaultTtlSec: config.defaultTtlSec,
    tokenTtlSec: config.tokenTtlSec,
  };
}

function parseVoiceProvider(raw: unknown): VoiceProvider {
  const normalized = typeof raw === "string" ? raw.trim().toLowerCase() : "";
  if (!normalized || normalized === "disabled" || normalized === "none") {
    return "disabled";
  }
  if (normalized === "livekit") return "livekit";
  throw new Error("unsupported_voice_provider");
}

function parseBoundedInteger(
  raw: unknown,
  fallback: number,
  input: { min: number; max: number },
): number {
  const parsed =
    typeof raw === "number"
      ? Math.trunc(raw)
      : typeof raw === "string" && /^\d+$/.test(raw.trim())
        ? Number.parseInt(raw.trim(), 10)
        : fallback;
  if (!Number.isFinite(parsed)) return fallback;
  if (parsed < input.min) return input.min;
  if (parsed > input.max) return input.max;
  return parsed;
}

function normalizeOptionalString(raw: unknown): string | null {
  if (typeof raw !== "string") return null;
  const normalized = raw.trim();
  return normalized || null;
}
