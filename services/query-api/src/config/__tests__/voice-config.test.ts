import { loadVoiceRuntimeConfig, toPublicVoiceRuntimeConfig } from "../voice";

describe("voice runtime config", () => {
  test("keeps voice disabled without requiring LiveKit secrets by default", () => {
    const config = loadVoiceRuntimeConfig({});

    expect(config.enabled).toBe(false);
    expect(config.provider).toBe("disabled");
    expect(config.livekitApiKey).toBeNull();
    expect(config.livekitApiSecret).toBeNull();
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
    });

    expect(config).toMatchObject({
      enabled: true,
      provider: "livekit",
      publicUrl: "wss://voice.example.test",
      livekitApiKey: "lk-key",
      livekitApiSecret: "super-secret",
      defaultTtlSec: 3600,
      tokenTtlSec: 300,
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
      defaultTtlSec: 7200,
      tokenTtlSec: 900,
    });
    expect(JSON.stringify(publicConfig)).not.toContain("super-secret");
    expect(JSON.stringify(publicConfig)).not.toContain("lk-key");
  });
});
