export interface VoiceJoinTokenInput {
  voiceSessionId: string;
  providerRoomId: string;
  roomKey: string;
  walletPubkey: string;
  canPublishAudio: boolean;
  canSubscribe: boolean;
  ttlSec: number;
  displayName?: string | null;
}

export interface VoiceJoinToken {
  provider: "livekit";
  url: string;
  token: string;
  providerRoomId: string;
  canPublishAudio: boolean;
  canSubscribe: boolean;
  expiresAt: Date;
}

export interface VoiceProviderHealth {
  provider: "livekit";
  status: "healthy" | "unhealthy" | "unknown";
  checkedAt: Date;
  responseStatus?: number | null;
  error?: string | null;
}

export interface VoiceProvider {
  healthCheck?(): Promise<VoiceProviderHealth>;
  createJoinToken(input: VoiceJoinTokenInput): Promise<VoiceJoinToken>;
  muteParticipant(input: {
    providerRoomId: string;
    walletPubkey: string;
    muted: boolean;
  }): Promise<void>;
  kickParticipant(input: {
    providerRoomId: string;
    walletPubkey: string;
  }): Promise<void>;
  endSession(input: { providerRoomId: string }): Promise<void>;
}
