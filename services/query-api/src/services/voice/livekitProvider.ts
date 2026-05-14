import {
  AccessToken,
  RoomServiceClient,
  TrackSource,
  type ParticipantPermission,
} from "livekit-server-sdk";

import type { VoiceRuntimeConfig } from "../../config/voice";
import type {
  VoiceJoinToken,
  VoiceJoinTokenInput,
  VoiceProvider,
  VoiceProviderHealth,
} from "./provider";

export interface LiveKitVoiceProviderOptions {
  roomServiceClient?: Pick<
    RoomServiceClient,
    "deleteRoom" | "removeParticipant" | "updateParticipant"
  >;
  fetchImpl?: typeof fetch;
}

export function createLiveKitVoiceProvider(
  config: VoiceRuntimeConfig,
  options: LiveKitVoiceProviderOptions = {},
): VoiceProvider {
  if (
    !config.enabled ||
    config.provider !== "livekit" ||
    !config.publicUrl ||
    !config.livekitApiKey ||
    !config.livekitApiSecret
  ) {
    throw new Error("voice_livekit_not_configured");
  }
  const publicUrl = config.publicUrl;
  const apiKey = config.livekitApiKey;
  const apiSecret = config.livekitApiSecret;
  const serverUrl = toLiveKitServerUrl(config.livekitServerUrl ?? publicUrl);
  const fetchImpl = options.fetchImpl ?? fetch;

  const roomServiceClient =
    options.roomServiceClient ??
    new RoomServiceClient(serverUrl, apiKey, apiSecret);

  return {
    async healthCheck(): Promise<VoiceProviderHealth> {
      const controller = new AbortController();
      const timeout = setTimeout(
        () => controller.abort(),
        config.providerHealthTimeoutMs,
      );
      try {
        const response = await fetchImpl(serverUrl, {
          method: "GET",
          signal: controller.signal,
        });
        return {
          provider: "livekit",
          status: response.ok ? "healthy" : "unhealthy",
          checkedAt: new Date(),
          responseStatus: response.status,
          error: response.ok ? null : "livekit_health_check_failed",
        };
      } catch (error) {
        return {
          provider: "livekit",
          status: "unhealthy",
          checkedAt: new Date(),
          responseStatus: null,
          error:
            error instanceof Error
              ? error.message
              : "livekit_health_check_failed",
        };
      } finally {
        clearTimeout(timeout);
      }
    },

    async createJoinToken(input: VoiceJoinTokenInput): Promise<VoiceJoinToken> {
      const ttlSec = Math.max(60, Math.min(input.ttlSec, config.tokenTtlSec));
      const token = new AccessToken(apiKey, apiSecret, {
        identity: input.walletPubkey,
        name: input.displayName ?? undefined,
        ttl: ttlSec,
        metadata: JSON.stringify({
          voiceSessionId: input.voiceSessionId,
          roomKey: input.roomKey,
        }),
      });

      token.addGrant({
        roomJoin: true,
        room: input.providerRoomId,
        canPublish: input.canPublishAudio,
        canPublishSources: input.canPublishAudio
          ? [TrackSource.MICROPHONE]
          : [],
        canSubscribe: input.canSubscribe,
        canPublishData: true,
        canUpdateOwnMetadata: false,
      });

      return {
        provider: "livekit",
        url: publicUrl,
        token: await token.toJwt(),
        providerRoomId: input.providerRoomId,
        canPublishAudio: input.canPublishAudio,
        canSubscribe: input.canSubscribe,
        expiresAt: new Date(Date.now() + ttlSec * 1000),
      };
    },

    async muteParticipant(input): Promise<void> {
      const permission: Partial<ParticipantPermission> = {
        canPublish: !input.muted,
        canSubscribe: true,
        canPublishData: true,
      };
      await roomServiceClient.updateParticipant(
        input.providerRoomId,
        input.walletPubkey,
        {
          permission,
        },
      );
    },

    async kickParticipant(input): Promise<void> {
      await roomServiceClient.removeParticipant(
        input.providerRoomId,
        input.walletPubkey,
      );
    },

    async endSession(input): Promise<void> {
      await roomServiceClient.deleteRoom(input.providerRoomId);
    },
  };
}

function toLiveKitServerUrl(publicUrl: string): string {
  if (publicUrl.startsWith("wss://")) return `https://${publicUrl.slice(6)}`;
  if (publicUrl.startsWith("ws://")) return `http://${publicUrl.slice(5)}`;
  return publicUrl;
}
