import type { WalletSigner } from "./communication";

type FetchLike = typeof fetch;

export interface VoiceProviderJoinInput {
  provider: string;
  url: string;
  token: string;
  providerRoomId: string;
  canPublishAudio: boolean;
  canSubscribe: boolean;
}

export interface VoiceParticipantState {
  walletPubkey: string;
  speaking?: boolean;
  muted?: boolean;
  mutedBySelf?: boolean;
  mutedByModerator?: boolean;
}

export interface VoiceProviderConnection {
  leave(): Promise<void> | void;
  setMicrophoneMuted?(muted: boolean): Promise<void> | void;
  getParticipants?(): VoiceParticipantState[];
}

export interface VoiceProviderClient {
  join(input: VoiceProviderJoinInput): Promise<VoiceProviderConnection>;
}

export interface AlchemeVoiceClientOptions {
  apiBaseUrl: string;
  wallet: WalletSigner;
  providerClient: VoiceProviderClient;
  fetch?: FetchLike;
}

export interface JoinVoiceInput {
  ttlSec?: number;
  metadata?: Record<string, unknown>;
  communicationSessionToken?: string;
}

export interface CreateVoiceSessionInput extends JoinVoiceInput {}

export interface VoiceSession {
  id: string;
  roomKey: string;
  provider: string;
  providerRoomId: string;
  status: string;
  createdByPubkey?: string;
  startedAt?: string;
  endedAt?: string | null;
  expiresAt?: string | null;
}

export interface VoiceJoinToken {
  provider: string;
  url: string;
  token: string;
  providerRoomId: string;
  canPublishAudio: boolean;
  canSubscribe: boolean;
  expiresAt?: string | Date;
}

export interface VoiceConnectionState {
  connected: boolean;
  session: VoiceSession;
  participants: VoiceParticipantState[];
  mutedBySelf: boolean;
  mutedByModerator: boolean;
  speaking: boolean;
}

export function createAlchemeVoiceClient(
  options: AlchemeVoiceClientOptions,
): AlchemeVoiceClient {
  return new AlchemeVoiceClient(options);
}

export class AlchemeVoiceClient {
  private readonly apiBaseUrl: string;
  private readonly wallet: WalletSigner;
  private readonly providerClient: VoiceProviderClient;
  private readonly fetchImpl: FetchLike;
  private readonly roomSessions = new Map<string, string>();

  constructor(options: AlchemeVoiceClientOptions) {
    this.apiBaseUrl = options.apiBaseUrl.replace(/\/+$/, "");
    this.wallet = options.wallet;
    this.providerClient = options.providerClient;
    this.fetchImpl = options.fetch ?? fetch;
  }

  setCommunicationSession(roomKey: string, sessionToken: string): void {
    this.roomSessions.set(roomKey, sessionToken);
  }

  async createVoiceSession(
    roomKey: string,
    input: CreateVoiceSessionInput = {},
  ): Promise<VoiceSession> {
    const sessionToken = this.resolveCommunicationSessionToken(roomKey, input);
    const response = await this.fetchJson<{ session: VoiceSession }>(
      "/voice/sessions",
      {
        method: "POST",
        headers: { Authorization: `Bearer ${sessionToken}` },
        body: {
          roomKey,
          ttlSec: input.ttlSec,
          metadata: input.metadata,
        },
      },
    );
    return response.session;
  }

  async createVoiceToken(
    voiceSessionId: string,
    input: {
      roomKey: string;
      communicationSessionToken?: string;
    },
  ): Promise<VoiceJoinToken> {
    const sessionToken = this.resolveCommunicationSessionToken(
      input.roomKey,
      input,
    );
    const response = await this.fetchJson<{ token: VoiceJoinToken }>(
      `/voice/sessions/${encodeURIComponent(voiceSessionId)}/token`,
      {
        method: "POST",
        headers: { Authorization: `Bearer ${sessionToken}` },
        body: {},
      },
    );
    return response.token;
  }

  async joinVoice(
    roomKey: string,
    input: JoinVoiceInput = {},
  ): Promise<AlchemeVoiceConnection> {
    const session = await this.createVoiceSession(roomKey, input);
    const token = await this.createVoiceToken(session.id, {
      roomKey,
      communicationSessionToken: input.communicationSessionToken,
    });
    const providerConnection = await this.providerClient.join({
      provider: token.provider,
      url: token.url,
      token: token.token,
      providerRoomId: token.providerRoomId,
      canPublishAudio: token.canPublishAudio,
      canSubscribe: token.canSubscribe,
    });

    return new AlchemeVoiceConnection(
      this.wallet.publicKey,
      session,
      token,
      providerConnection,
    );
  }

  private resolveCommunicationSessionToken(
    roomKey: string,
    input: { communicationSessionToken?: string },
  ): string {
    const sessionToken =
      input.communicationSessionToken ?? this.roomSessions.get(roomKey);
    if (!sessionToken) {
      throw new Error("communication session token is required");
    }
    return sessionToken;
  }

  private async fetchJson<T>(
    path: string,
    input: {
      method: string;
      headers?: Record<string, string>;
      body?: unknown;
    },
  ): Promise<T> {
    const response = await this.fetchImpl(`${this.apiBaseUrl}${path}`, {
      method: input.method,
      headers: {
        ...(input.body ? { "Content-Type": "application/json" } : {}),
        ...(input.headers ?? {}),
      },
      body: input.body ? JSON.stringify(input.body) : undefined,
    });
    if (!response.ok) {
      throw new Error(`voice request failed: ${response.status}`);
    }
    return response.json() as Promise<T>;
  }
}

export class AlchemeVoiceConnection {
  private connected = true;
  private mutedBySelf = false;

  constructor(
    private readonly walletPubkey: string,
    private readonly session: VoiceSession,
    private readonly token: VoiceJoinToken,
    private readonly providerConnection: VoiceProviderConnection,
  ) {}

  get state(): VoiceConnectionState {
    const participants = this.providerConnection.getParticipants?.() ?? [];
    const self = participants.find(
      (participant) => participant.walletPubkey === this.walletPubkey,
    );

    return {
      connected: this.connected,
      session: this.session,
      participants,
      mutedBySelf: this.mutedBySelf,
      mutedByModerator: !this.token.canPublishAudio,
      speaking: Boolean(self?.speaking),
    };
  }

  async setMutedBySelf(muted: boolean): Promise<void> {
    if (!this.providerConnection.setMicrophoneMuted) {
      throw new Error("voice provider does not support local microphone mute");
    }
    await this.providerConnection.setMicrophoneMuted(muted);
    this.mutedBySelf = muted;
  }

  async leave(): Promise<void> {
    if (!this.connected) return;
    await this.providerConnection.leave();
    this.connected = false;
  }
}
