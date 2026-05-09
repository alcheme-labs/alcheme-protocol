import { TokenVerifier } from "livekit-server-sdk";

import { loadVoiceRuntimeConfig } from "../../../config/voice";
import { createLiveKitVoiceProvider } from "../livekitProvider";

describe("voice provider adapter", () => {
  test("creates LiveKit join tokens with subscribe-only grants for muted members", async () => {
    const config = loadVoiceRuntimeConfig({
      VOICE_PROVIDER: "livekit",
      VOICE_PUBLIC_URL: "wss://voice.example.test",
      LIVEKIT_API_KEY: "lk-key",
      LIVEKIT_API_SECRET: "lk-secret",
      VOICE_TOKEN_TTL_SEC: "300",
    });
    const provider = createLiveKitVoiceProvider(config);

    const token = await provider.createJoinToken({
      voiceSessionId: "voice_1",
      providerRoomId: "alcheme_voice_1",
      roomKey: "external:game:dungeon:run-1",
      walletPubkey: "wallet-muted",
      canPublishAudio: false,
      canSubscribe: true,
      ttlSec: 300,
    });
    const claims = await new TokenVerifier("lk-key", "lk-secret").verify(
      token.token,
    );

    expect(token).toMatchObject({
      provider: "livekit",
      url: "wss://voice.example.test",
      providerRoomId: "alcheme_voice_1",
      canPublishAudio: false,
      canSubscribe: true,
    });
    expect(claims.video).toMatchObject({
      room: "alcheme_voice_1",
      roomJoin: true,
      canPublish: false,
      canSubscribe: true,
      canPublishData: true,
    });
  });

  test("limits publishing grants to microphone when the member can speak", async () => {
    const provider = createLiveKitVoiceProvider(
      loadVoiceRuntimeConfig({
        VOICE_PROVIDER: "livekit",
        VOICE_PUBLIC_URL: "wss://voice.example.test",
        LIVEKIT_API_KEY: "lk-key",
        LIVEKIT_API_SECRET: "lk-secret",
      }),
    );

    const token = await provider.createJoinToken({
      voiceSessionId: "voice_2",
      providerRoomId: "alcheme_voice_2",
      roomKey: "external:game:party:p1",
      walletPubkey: "wallet-speaker",
      canPublishAudio: true,
      canSubscribe: true,
      ttlSec: 900,
    });
    const claims = await new TokenVerifier("lk-key", "lk-secret").verify(
      token.token,
    );

    expect(claims.video).toMatchObject({
      room: "alcheme_voice_2",
      roomJoin: true,
      canPublish: true,
      canSubscribe: true,
    });
    expect(claims.video?.canPublishSources).toEqual(["microphone"]);
    expect(claims.metadata).toBe(
      JSON.stringify({
        voiceSessionId: "voice_2",
        roomKey: "external:game:party:p1",
      }),
    );
  });
});
