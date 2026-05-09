import type { WalletSigner } from "../communication";
import {
  createAlchemeVoiceClient,
  type VoiceProviderClient,
} from "../voice";

const ROOM_KEY = "external:example-web3-game:dungeon:run-8791";
const WALLET = "wallet-111";

function jsonResponse(body: unknown) {
  return {
    ok: true,
    status: 200,
    json: async () => body,
  } as Response;
}

function wallet(): WalletSigner {
  return {
    publicKey: WALLET,
    signMessage: jest.fn(async () => new Uint8Array([1])),
  };
}

describe("voice runtime client", () => {
  test("joinVoice creates a server voice session, requests a provider token, and joins through an injected provider client", async () => {
    const calls: Array<{ url: string; init: RequestInit }> = [];
    const fetchImpl = jest.fn(async (url: string, init: RequestInit = {}) => {
      calls.push({ url, init });
      if (url.endsWith("/voice/sessions")) {
        return jsonResponse({
          session: {
            id: "voice_1",
            roomKey: ROOM_KEY,
            provider: "livekit",
            providerRoomId: "alcheme_voice_1",
            status: "active",
          },
        });
      }
      return jsonResponse({
        token: {
          provider: "livekit",
          url: "wss://voice.example.test",
          token: "provider-token",
          providerRoomId: "alcheme_voice_1",
          canPublishAudio: true,
          canSubscribe: true,
          expiresAt: "2026-05-08T12:15:00.000Z",
        },
      });
    });
    const providerConnection = {
      leave: jest.fn(async () => undefined),
      setMicrophoneMuted: jest.fn(async () => undefined),
      getParticipants: jest.fn(() => [
        { walletPubkey: WALLET, speaking: true, muted: false },
      ]),
    };
    const providerClient: VoiceProviderClient = {
      join: jest.fn(async () => providerConnection),
    };
    const client = createAlchemeVoiceClient({
      apiBaseUrl: "https://api.example.test/api/v1",
      wallet: wallet(),
      fetch: fetchImpl as any,
      providerClient,
    });
    client.setCommunicationSession(ROOM_KEY, "comm-token");

    const connection = await client.joinVoice(ROOM_KEY, { ttlSec: 600 });

    expect(calls[0]).toMatchObject({
      url: "https://api.example.test/api/v1/voice/sessions",
    });
    expect(JSON.parse(String(calls[0].init.body))).toMatchObject({
      roomKey: ROOM_KEY,
      ttlSec: 600,
    });
    expect(calls[0].init.headers).toMatchObject({
      Authorization: "Bearer comm-token",
    });
    expect(calls[1]).toMatchObject({
      url: "https://api.example.test/api/v1/voice/sessions/voice_1/token",
    });
    expect(calls[1].init.headers).toMatchObject({
      Authorization: "Bearer comm-token",
    });
    expect(providerClient.join).toHaveBeenCalledWith({
      provider: "livekit",
      url: "wss://voice.example.test",
      token: "provider-token",
      providerRoomId: "alcheme_voice_1",
      canPublishAudio: true,
      canSubscribe: true,
    });
    expect(connection.state).toMatchObject({
      connected: true,
      mutedBySelf: false,
      mutedByModerator: false,
      speaking: true,
      participants: [{ walletPubkey: WALLET, speaking: true, muted: false }],
    });

    await connection.setMutedBySelf(true);
    expect(providerConnection.setMicrophoneMuted).toHaveBeenCalledWith(true);
    expect(connection.state.mutedBySelf).toBe(true);

    await connection.leave();
    expect(providerConnection.leave).toHaveBeenCalled();
    expect(connection.state.connected).toBe(false);
  });

  test("joinVoice exposes subscribe-only provider tokens as moderator-muted state", async () => {
    const fetchImpl = jest
      .fn()
      .mockResolvedValueOnce(
        jsonResponse({
          session: {
            id: "voice_1",
            roomKey: ROOM_KEY,
            provider: "livekit",
            providerRoomId: "alcheme_voice_1",
            status: "active",
          },
        }),
      )
      .mockResolvedValueOnce(
        jsonResponse({
          token: {
            provider: "livekit",
            url: "wss://voice.example.test",
            token: "provider-token",
            providerRoomId: "alcheme_voice_1",
            canPublishAudio: false,
            canSubscribe: true,
            expiresAt: "2026-05-08T12:15:00.000Z",
          },
        }),
      );
    const providerClient: VoiceProviderClient = {
      join: jest.fn(async () => ({ leave: jest.fn(async () => undefined) })),
    };
    const client = createAlchemeVoiceClient({
      apiBaseUrl: "https://api.example.test/api/v1",
      wallet: wallet(),
      fetch: fetchImpl as any,
      providerClient,
    });
    client.setCommunicationSession(ROOM_KEY, "comm-token");

    const connection = await client.joinVoice(ROOM_KEY);

    expect(providerClient.join).toHaveBeenCalledWith(
      expect.objectContaining({ canPublishAudio: false, canSubscribe: true }),
    );
    expect(connection.state).toMatchObject({
      connected: true,
      mutedByModerator: true,
      speaking: false,
    });
  });

  test("joinVoice requires an existing communication session token", async () => {
    const providerClient: VoiceProviderClient = {
      join: jest.fn(),
    };
    const client = createAlchemeVoiceClient({
      apiBaseUrl: "https://api.example.test/api/v1",
      wallet: wallet(),
      fetch: jest.fn() as any,
      providerClient,
    });

    await expect(client.joinVoice(ROOM_KEY)).rejects.toThrow(
      "communication session token is required",
    );
    expect(providerClient.join).not.toHaveBeenCalled();
  });
});
