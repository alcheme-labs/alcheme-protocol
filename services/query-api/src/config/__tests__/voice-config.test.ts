import { loadVoiceRuntimeConfig, toPublicVoiceRuntimeConfig } from "../voice";

describe("voice runtime config", () => {
  test("keeps voice disabled without requiring LiveKit secrets by default", () => {
    const config = loadVoiceRuntimeConfig({});

    expect(config.enabled).toBe(false);
    expect(config.provider).toBe("disabled");
    expect(config.livekitApiKey).toBeNull();
    expect(config.livekitApiSecret).toBeNull();
    expect(config.platformMaxSpeakersPerSession).toBe(100);
    expect(config.defaultMaxSpeakersPerSession).toBe(16);
    expect(config.speakerLimitStrategy).toBe("listen_only");
    expect(config.requireProviderHealth).toBe(false);
    expect(config.providerHealthTimeoutMs).toBe(1500);
  });

  test("requires LiveKit public URL and credentials only when LiveKit is enabled", () => {
    expect(() =>
      loadVoiceRuntimeConfig({
        VOICE_PROVIDER: "livekit",
        LIVEKIT_API_KEY: "lk-key",
      }),
    ).toThrow("voice_livekit_credentials_required");

    const config = loadVoiceRuntimeConfig({
      VOICE_PROVIDER: "livekit",
      VOICE_PUBLIC_URL: "wss://voice.example.test",
      LIVEKIT_API_KEY: "lk-key",
      LIVEKIT_API_SECRET: "super-secret",
      VOICE_DEFAULT_TTL_SEC: "3600",
      VOICE_TOKEN_TTL_SEC: "300",
      VOICE_PLATFORM_MAX_SPEAKERS_PER_SESSION: "80",
      VOICE_DEFAULT_MAX_SPEAKERS_PER_SESSION: "8",
      VOICE_SPEAKER_LIMIT_STRATEGY: "moderated_queue",
      VOICE_REQUIRE_PROVIDER_HEALTH: "true",
      VOICE_PROVIDER_HEALTH_TIMEOUT_MS: "250",
    });

    expect(config).toMatchObject({
      enabled: true,
      provider: "livekit",
      publicUrl: "wss://voice.example.test",
      livekitServerUrl: "wss://voice.example.test",
      livekitApiKey: "lk-key",
      livekitApiSecret: "super-secret",
      defaultTtlSec: 3600,
      tokenTtlSec: 300,
      platformMaxSpeakersPerSession: 80,
      defaultMaxSpeakersPerSession: 8,
      speakerLimitStrategy: "moderated_queue",
      requireProviderHealth: true,
      providerHealthTimeoutMs: 250,
    });
  });

  test("bounds speaker limit configuration and falls back to listen-only overflow", () => {
    expect(
      loadVoiceRuntimeConfig({
        VOICE_PROVIDER: "livekit",
        VOICE_PUBLIC_URL: "wss://voice.example.test",
        LIVEKIT_API_KEY: "lk-key",
        LIVEKIT_API_SECRET: "super-secret",
        VOICE_PLATFORM_MAX_SPEAKERS_PER_SESSION: "9999",
        VOICE_DEFAULT_MAX_SPEAKERS_PER_SESSION: "250",
        VOICE_SPEAKER_LIMIT_STRATEGY: "unknown",
      }),
    ).toMatchObject({
      platformMaxSpeakersPerSession: 100,
      defaultMaxSpeakersPerSession: 100,
      speakerLimitStrategy: "listen_only",
    });
  });

  test("keeps the legacy speaker env as the default room speaker limit", () => {
    expect(
      loadVoiceRuntimeConfig({
        VOICE_PROVIDER: "livekit",
        VOICE_PUBLIC_URL: "wss://voice.example.test",
        LIVEKIT_API_KEY: "lk-key",
        LIVEKIT_API_SECRET: "super-secret",
        VOICE_MAX_SPEAKERS_PER_SESSION: "12",
      }),
    ).toMatchObject({
      platformMaxSpeakersPerSession: 100,
      defaultMaxSpeakersPerSession: 12,
    });
  });

  test("public config excludes provider secrets", () => {
    const publicConfig = toPublicVoiceRuntimeConfig(
      loadVoiceRuntimeConfig({
        VOICE_PROVIDER: "livekit",
        VOICE_PUBLIC_URL: "wss://voice.example.test",
        LIVEKIT_API_KEY: "lk-key",
        LIVEKIT_API_SECRET: "super-secret",
      }),
    );

    expect(publicConfig).toEqual({
      enabled: true,
      provider: "livekit",
      publicUrl: "wss://voice.example.test",
      requireProviderHealth: false,
      defaultTtlSec: 7200,
      tokenTtlSec: 900,
      platformMaxSpeakersPerSession: 100,
      defaultMaxSpeakersPerSession: 16,
      speakerLimitStrategy: "listen_only",
    });
    expect(JSON.stringify(publicConfig)).not.toContain("super-secret");
    expect(JSON.stringify(publicConfig)).not.toContain("lk-key");
  });
});
