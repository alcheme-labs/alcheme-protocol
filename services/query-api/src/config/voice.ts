export type VoiceProvider = "disabled" | "livekit";
export type VoiceSpeakerLimitStrategy =
  | "listen_only"
  | "deny"
  | "queue"
  | "moderated_queue";

export interface VoiceSpeakerPolicy {
  maxSpeakers: number;
  overflowStrategy: VoiceSpeakerLimitStrategy;
  moderatorRoles: string[];
  source: "runtime_default" | "room_metadata" | "app_room_claim";
}

export interface VoiceRuntimeConfig {
  enabled: boolean;
  provider: VoiceProvider;
  publicUrl: string | null;
  livekitApiKey: string | null;
  livekitApiSecret: string | null;
  defaultTtlSec: number;
  tokenTtlSec: number;
  platformMaxSpeakersPerSession: number;
  defaultMaxSpeakersPerSession: number;
  speakerLimitStrategy: VoiceSpeakerLimitStrategy;
}

export interface PublicVoiceRuntimeConfig {
  enabled: boolean;
  provider: VoiceProvider;
  publicUrl: string | null;
  defaultTtlSec: number;
  tokenTtlSec: number;
  platformMaxSpeakersPerSession: number;
  defaultMaxSpeakersPerSession: number;
  speakerLimitStrategy: VoiceSpeakerLimitStrategy;
}

const DEFAULT_VOICE_TTL_SEC = 7_200;
const DEFAULT_TOKEN_TTL_SEC = 900;
const DEFAULT_PLATFORM_MAX_SPEAKERS_PER_SESSION = 100;
const DEFAULT_MAX_SPEAKER_SLOTS_PER_SESSION = 16;

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
  const platformMaxSpeakersPerSession = parseBoundedInteger(
    env.VOICE_PLATFORM_MAX_SPEAKERS_PER_SESSION,
    DEFAULT_PLATFORM_MAX_SPEAKERS_PER_SESSION,
    {
      min: 1,
      max: DEFAULT_PLATFORM_MAX_SPEAKERS_PER_SESSION,
    },
  );
  const defaultMaxSpeakersPerSession = parseBoundedInteger(
    env.VOICE_DEFAULT_MAX_SPEAKERS_PER_SESSION ??
      env.VOICE_MAX_SPEAKERS_PER_SESSION,
    DEFAULT_MAX_SPEAKER_SLOTS_PER_SESSION,
    { min: 1, max: platformMaxSpeakersPerSession },
  );
  const speakerLimitStrategy =
    parseSpeakerLimitStrategy(env.VOICE_SPEAKER_LIMIT_STRATEGY) ??
    "listen_only";

  if (provider === "disabled") {
    return {
      enabled: false,
      provider,
      publicUrl: null,
      livekitApiKey: null,
      livekitApiSecret: null,
      defaultTtlSec,
      tokenTtlSec,
      platformMaxSpeakersPerSession,
      defaultMaxSpeakersPerSession,
      speakerLimitStrategy,
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
    platformMaxSpeakersPerSession,
    defaultMaxSpeakersPerSession,
    speakerLimitStrategy,
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
    platformMaxSpeakersPerSession: config.platformMaxSpeakersPerSession,
    defaultMaxSpeakersPerSession: config.defaultMaxSpeakersPerSession,
    speakerLimitStrategy: config.speakerLimitStrategy,
  };
}

export function normalizeVoiceSpeakerPolicy(
  raw: unknown,
  input: {
    fallbackMaxSpeakers: number;
    platformMaxSpeakers: number;
    fallbackStrategy: VoiceSpeakerLimitStrategy;
    source: VoiceSpeakerPolicy["source"];
  },
): VoiceSpeakerPolicy {
  const record =
    raw && typeof raw === "object" && !Array.isArray(raw)
      ? (raw as Record<string, unknown>)
      : {};
  const maxSpeakers = parseBoundedInteger(
    record.maxSpeakers,
    input.fallbackMaxSpeakers,
    { min: 1, max: input.platformMaxSpeakers },
  );
  return {
    maxSpeakers,
    overflowStrategy:
      parseSpeakerLimitStrategy(record.overflowStrategy) ??
      input.fallbackStrategy,
    moderatorRoles: parseStringList(record.moderatorRoles, [
      "owner",
      "moderator",
    ]),
    source: input.source,
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

function parseSpeakerLimitStrategy(
  raw: unknown,
): VoiceSpeakerLimitStrategy | null {
  const normalized = typeof raw === "string" ? raw.trim().toLowerCase() : "";
  if (normalized === "moderated_queue") return "moderated_queue";
  if (normalized === "queue") return "queue";
  if (normalized === "deny") return "deny";
  if (normalized === "listen_only") return "listen_only";
  return null;
}

function parseStringList(raw: unknown, fallback: string[]): string[] {
  if (!Array.isArray(raw)) return fallback;
  const values = raw
    .map((value) =>
      typeof value === "string" ? value.trim().toLowerCase() : "",
    )
    .filter(Boolean);
  return values.length > 0 ? Array.from(new Set(values)) : fallback;
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
