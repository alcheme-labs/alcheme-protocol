import { parseApiErrorResponse } from "./errors";

export interface WalletSigner {
  publicKey: string;
  signMessage(message: Uint8Array): Promise<Uint8Array>;
}

export interface AlchemeGameChatClientOptions {
  apiBaseUrl: string;
  wallet: WalletSigner;
  fetch?: typeof fetch;
}

export interface ResolveRoomInput {
  externalAppId?: string;
  roomType: string;
  externalRoomId?: string;
  parentCircleId?: number;
  participantPubkeys?: string[];
  ttlSec?: number;
  knowledgeMode?: string;
  transcriptionMode?: string;
  retentionPolicy?: string;
  metadata?: Record<string, unknown>;
  appRoomClaim?: {
    payload: string;
    signature: string;
  };
  walletPubkey?: string;
}

export interface JoinExternalRoomInput extends ResolveRoomInput {
  sessionTtlSec?: number;
  sessionClientMeta?: Record<string, unknown>;
}

export interface JoinExternalRoomResult {
  room: any;
  member: any;
  session: any;
  communicationAccessToken: string;
}

export interface CommunicationSessionInput {
  roomKey: string;
  ttlSec?: number;
  clientTimestamp?: string;
  nonce?: string;
  clientMeta?: Record<string, unknown>;
}

export interface CommunicationMessageInput {
  text: string;
  senderHandle?: string;
  metadata?: Record<string, unknown>;
  clientTimestamp?: string;
  nonce?: string;
  prevEnvelopeId?: string | null;
  sessionToken?: string;
}

export interface CommunicationVoiceClipInput {
  storageUri: string;
  durationMs: number;
  fileSizeBytes: number;
  payloadText?: string;
  senderHandle?: string;
  metadata?: Record<string, unknown>;
  clientTimestamp?: string;
  nonce?: string;
  prevEnvelopeId?: string | null;
  sessionToken?: string;
}

export interface ListRoomMessagesInput {
  afterLamport?: number;
  afterMessageId?: string;
  limit?: number;
  sessionToken?: string;
}

export interface SubscribeRoomMessagesInput extends ListRoomMessagesInput {}

export interface CommunicationSessionBootstrapPayload {
  v: 1;
  action: "communication_session_init";
  walletPubkey: string;
  scopeType: "room";
  scopeRef: string;
  clientTimestamp: string;
  nonce: string;
}

export type CommunicationMessageSigningPayload =
  | {
      v: 1;
      roomKey: string;
      senderPubkey: string;
      messageKind: "plain";
      text: string;
      clientTimestamp: string;
      nonce: string;
      prevEnvelopeId: string | null;
    }
  | {
      v: 1;
      roomKey: string;
      senderPubkey: string;
      messageKind: "voice_clip";
      text: string | null;
      storageUri: string;
      durationMs: number;
      fileSizeBytes: number;
      clientTimestamp: string;
      nonce: string;
      prevEnvelopeId: string | null;
    };

export interface RoomMessageSubscription {
  close(): void;
  closed: Promise<void>;
}

type FetchLike = typeof fetch;

export function createAlchemeGameChatClient(
  options: AlchemeGameChatClientOptions,
): AlchemeGameChatClient {
  return new AlchemeGameChatClient(options);
}

export function buildCommunicationSessionBootstrapMessage(
  payload: CommunicationSessionBootstrapPayload,
): string {
  return `alcheme-communication-session:${JSON.stringify(payload)}`;
}

export function buildCommunicationMessageSigningMessage(
  payload: CommunicationMessageSigningPayload,
): string {
  return `alcheme-communication-message:${JSON.stringify(payload)}`;
}

export class AlchemeGameChatClient {
  private readonly apiBaseUrl: string;
  private readonly wallet: WalletSigner;
  private readonly fetchImpl: FetchLike;
  private readonly roomSessions = new Map<string, string>();

  constructor(options: AlchemeGameChatClientOptions) {
    this.apiBaseUrl = options.apiBaseUrl.replace(/\/+$/, "");
    this.wallet = options.wallet;
    this.fetchImpl = options.fetch ?? fetch;
  }

  async resolveRoom(input: ResolveRoomInput): Promise<any> {
    const response = await this.fetchJson<{ room: any }>(
      "/communication/rooms/resolve",
      {
        method: "POST",
        body: {
          ...input,
          walletPubkey: input.walletPubkey ?? this.wallet.publicKey,
        },
      },
    );
    return response.room;
  }

  async joinExternalRoom(input: JoinExternalRoomInput): Promise<JoinExternalRoomResult> {
    const room = await this.resolveRoom(input);
    const memberResponse = await this.fetchJson<{ member: any }>(
      `/communication/rooms/${encodeURIComponent(room.roomKey)}/members`,
      {
        method: "POST",
        body: {
          walletPubkey: input.walletPubkey ?? this.wallet.publicKey,
          appRoomClaim: input.appRoomClaim ?? null,
        },
      },
    );
    const session = await this.createCommunicationSession({
      roomKey: room.roomKey,
      ttlSec: input.sessionTtlSec,
      clientMeta: input.sessionClientMeta,
    });
    return {
      room,
      member: memberResponse.member,
      session,
      communicationAccessToken: session.communicationAccessToken,
    };
  }

  async createCommunicationSession(
    input: CommunicationSessionInput,
  ): Promise<any> {
    const clientTimestamp = input.clientTimestamp ?? new Date().toISOString();
    const nonce = input.nonce ?? randomNonce();
    const payload: CommunicationSessionBootstrapPayload = {
      v: 1,
      action: "communication_session_init",
      walletPubkey: this.wallet.publicKey,
      scopeType: "room",
      scopeRef: input.roomKey,
      clientTimestamp,
      nonce,
    };
    const signedMessage = buildCommunicationSessionBootstrapMessage(payload);
    const signature = await this.signToBase64(signedMessage);

    const response = await this.fetchJson<any>("/communication/sessions", {
      method: "POST",
      body: {
        walletPubkey: this.wallet.publicKey,
        roomKey: input.roomKey,
        ttlSec: input.ttlSec,
        clientTimestamp,
        nonce,
        clientMeta: input.clientMeta,
        signedMessage,
        signature,
      },
    });
    if (response.communicationAccessToken) {
      this.roomSessions.set(input.roomKey, response.communicationAccessToken);
    }
    return response;
  }

  setCommunicationSession(roomKey: string, sessionToken: string): void {
    this.roomSessions.set(roomKey, sessionToken);
  }

  async sendRoomMessage(
    roomKey: string,
    input: CommunicationMessageInput,
  ): Promise<any> {
    const sessionToken = input.sessionToken ?? this.roomSessions.get(roomKey);
    const clientTimestamp = input.clientTimestamp ?? new Date().toISOString();
    const nonce = input.nonce ?? randomNonce();
    const text = input.text.replace(/\r\n/g, "\n").trim();
    const payload: CommunicationMessageSigningPayload = {
      v: 1,
      roomKey,
      senderPubkey: this.wallet.publicKey,
      messageKind: "plain",
      text,
      clientTimestamp,
      nonce,
      prevEnvelopeId: input.prevEnvelopeId ?? null,
    };
    const signedMessage = buildCommunicationMessageSigningMessage(payload);
    const signature = sessionToken
      ? undefined
      : await this.signToBase64(signedMessage);
    const response = await this.fetchJson<{ message: any }>(
      `/communication/rooms/${encodeURIComponent(roomKey)}/messages`,
      {
        method: "POST",
        headers: sessionToken
          ? { Authorization: `Bearer ${sessionToken}` }
          : undefined,
        body: {
          senderPubkey: this.wallet.publicKey,
          senderHandle: input.senderHandle,
          text,
          metadata: input.metadata,
          clientTimestamp,
          nonce,
          prevEnvelopeId: input.prevEnvelopeId ?? null,
          signedMessage,
          signature,
        },
      },
    );
    return response.message;
  }

  async sendRoomVoiceClip(
    roomKey: string,
    input: CommunicationVoiceClipInput,
  ): Promise<any> {
    const sessionToken = input.sessionToken ?? this.roomSessions.get(roomKey);
    const clientTimestamp = input.clientTimestamp ?? new Date().toISOString();
    const nonce = input.nonce ?? randomNonce();
    const payloadText = input.payloadText
      ? input.payloadText.replace(/\r\n/g, "\n").trim()
      : null;
    const payload: CommunicationMessageSigningPayload = {
      v: 1,
      roomKey,
      senderPubkey: this.wallet.publicKey,
      messageKind: "voice_clip",
      text: payloadText,
      storageUri: input.storageUri,
      durationMs: input.durationMs,
      fileSizeBytes: input.fileSizeBytes,
      clientTimestamp,
      nonce,
      prevEnvelopeId: input.prevEnvelopeId ?? null,
    };
    const signedMessage = buildCommunicationMessageSigningMessage(payload);
    const signature = sessionToken
      ? undefined
      : await this.signToBase64(signedMessage);
    const response = await this.fetchJson<{ message: any }>(
      `/communication/rooms/${encodeURIComponent(roomKey)}/messages`,
      {
        method: "POST",
        headers: sessionToken
          ? { Authorization: `Bearer ${sessionToken}` }
          : undefined,
        body: {
          senderPubkey: this.wallet.publicKey,
          senderHandle: input.senderHandle,
          messageKind: "voice_clip",
          storageUri: input.storageUri,
          durationMs: input.durationMs,
          fileSizeBytes: input.fileSizeBytes,
          payloadText,
          metadata: input.metadata,
          clientTimestamp,
          nonce,
          prevEnvelopeId: input.prevEnvelopeId ?? null,
          signedMessage,
          signature,
        },
      },
    );
    return response.message;
  }

  async listRoomMessages(
    roomKey: string,
    input: ListRoomMessagesInput = {},
  ): Promise<any[]> {
    const sessionToken = input.sessionToken ?? this.roomSessions.get(roomKey);
    if (!sessionToken)
      throw new Error("communication session token is required");
    const query = buildCursorQuery(input);
    const response = await this.fetchJson<{ messages: any[] }>(
      `/communication/rooms/${encodeURIComponent(roomKey)}/messages${query}`,
      {
        method: "GET",
        headers: { Authorization: `Bearer ${sessionToken}` },
      },
    );
    return response.messages;
  }

  subscribeRoomMessages(
    roomKey: string,
    onEvent: (event: any) => void,
    input: SubscribeRoomMessagesInput = {},
  ): RoomMessageSubscription {
    const sessionToken = input.sessionToken ?? this.roomSessions.get(roomKey);
    if (!sessionToken)
      throw new Error("communication session token is required");

    const controller = new AbortController();
    const query = buildCursorQuery(input);
    const closed = this.consumeSse(
      `/communication/rooms/${encodeURIComponent(roomKey)}/stream${query}`,
      {
        Authorization: `Bearer ${sessionToken}`,
      },
      controller.signal,
      onEvent,
    ).catch((error) => {
      if (isAbortError(error)) return;
      throw error;
    });

    return {
      close: () => controller.abort(),
      closed,
    };
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
      throw await parseApiErrorResponse(response, "communication_request_failed");
    }
    return response.json() as Promise<T>;
  }

  private async consumeSse(
    path: string,
    headers: Record<string, string>,
    signal: AbortSignal,
    onEvent: (event: any) => void,
  ): Promise<void> {
    const response = await this.fetchImpl(`${this.apiBaseUrl}${path}`, {
      method: "GET",
      headers,
      signal,
    });
    if (!response.ok) {
      throw await parseApiErrorResponse(response, "communication_stream_failed");
    }
    const reader = response.body?.getReader();
    if (!reader) {
      throw new Error("communication stream body is unavailable");
    }

    const decoder = new TextDecoder();
    let buffer = "";
    try {
      while (true) {
        const next = await reader.read();
        if (next.done) break;
        buffer += decoder.decode(next.value, { stream: true });
        buffer = drainSseEvents(buffer, onEvent);
      }
      buffer += decoder.decode();
      drainSseEvents(buffer, onEvent);
    } finally {
      reader.releaseLock();
    }
  }

  private async signToBase64(message: string): Promise<string> {
    const signature = await this.wallet.signMessage(
      new TextEncoder().encode(message),
    );
    return bytesToBase64(signature);
  }
}

function buildCursorQuery(input: {
  afterLamport?: number;
  afterMessageId?: string;
  limit?: number;
}): string {
  const query = new URLSearchParams();
  if (typeof input.afterLamport === "number") {
    query.set("afterLamport", String(input.afterLamport));
  }
  if (input.afterMessageId) {
    query.set("afterMessageId", input.afterMessageId);
  }
  if (typeof input.limit === "number") {
    query.set("limit", String(input.limit));
  }
  const encoded = query.toString();
  return encoded ? `?${encoded}` : "";
}

function drainSseEvents(buffer: string, onEvent: (event: any) => void): string {
  let cursor = buffer.indexOf("\n\n");
  while (cursor >= 0) {
    const rawEvent = buffer.slice(0, cursor);
    buffer = buffer.slice(cursor + 2);
    const parsed = parseSseEvent(rawEvent);
    if (parsed.event === "message_created" && parsed.data) {
      onEvent(JSON.parse(parsed.data));
    }
    cursor = buffer.indexOf("\n\n");
  }
  return buffer;
}

function parseSseEvent(rawEvent: string): {
  event: string | null;
  data: string | null;
} {
  let event: string | null = null;
  const data: string[] = [];
  for (const line of rawEvent.split(/\r?\n/)) {
    if (line.startsWith("event:")) {
      event = line.slice("event:".length).trim();
    } else if (line.startsWith("data:")) {
      data.push(line.slice("data:".length).trimStart());
    }
  }
  return {
    event,
    data: data.length > 0 ? data.join("\n") : null,
  };
}

function bytesToBase64(bytes: Uint8Array): string {
  if (typeof Buffer !== "undefined") {
    return Buffer.from(bytes).toString("base64");
  }
  let binary = "";
  for (const byte of bytes) {
    binary += String.fromCharCode(byte);
  }
  return btoa(binary);
}

function randomNonce(): string {
  if (typeof crypto !== "undefined" && "randomUUID" in crypto) {
    return crypto.randomUUID();
  }
  return `${Date.now()}-${Math.random().toString(16).slice(2)}`;
}

function isAbortError(error: unknown): boolean {
  return error instanceof Error && error.name === "AbortError";
}
