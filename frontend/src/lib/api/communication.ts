import { apiFetch } from "@/lib/api/fetch";
import { resolveNodeRoute } from "@/lib/api/nodeRouting";

export interface CommunicationSessionResponse {
  ok: boolean;
  sessionId: string;
  walletPubkey: string;
  scopeType: "room";
  scopeRef: string;
  expiresAt: string;
  communicationAccessToken: string;
  signatureVerified?: boolean;
}

export interface CommunicationSessionBootstrapPayload {
  v: 1;
  action: "communication_session_init";
  walletPubkey: string;
  scopeType: "room";
  scopeRef: string;
  clientTimestamp: string;
  nonce: string;
}

export function buildCommunicationSessionBootstrapMessage(
  payload: CommunicationSessionBootstrapPayload,
): string {
  return `alcheme-communication-session:${JSON.stringify(payload)}`;
}

export async function createCommunicationSession(input: {
  walletPubkey: string;
  roomKey: string;
  signMessage?: (message: Uint8Array) => Promise<Uint8Array>;
  ttlSec?: number;
  clientMeta?: Record<string, unknown>;
}): Promise<CommunicationSessionResponse> {
  if (!input.signMessage) {
    throw new Error("wallet_signature_required");
  }

  const clientTimestamp = new Date().toISOString();
  const nonce = randomNonce();
  const signedPayload: CommunicationSessionBootstrapPayload = {
    v: 1,
    action: "communication_session_init",
    walletPubkey: input.walletPubkey,
    scopeType: "room",
    scopeRef: input.roomKey,
    clientTimestamp,
    nonce,
  };
  const signedMessage =
    buildCommunicationSessionBootstrapMessage(signedPayload);
  const signature = bytesToBase64(
    await input.signMessage(new TextEncoder().encode(signedMessage)),
  );
  const route = await resolveNodeRoute("communication_runtime");
  const response = await apiFetch(
    `${route.urlBase}/api/v1/communication/sessions`,
    {
      method: "POST",
      credentials: "include",
      headers: {
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        walletPubkey: input.walletPubkey,
        roomKey: input.roomKey,
        clientTimestamp,
        nonce,
        signedMessage,
        signature,
        ttlSec: input.ttlSec,
        clientMeta: input.clientMeta,
      }),
    },
  );
  const payload = await response.json().catch(() => null);
  if (!response.ok) {
    throw buildRequestError(
      response,
      payload,
      "communication session request failed",
    );
  }
  return payload as CommunicationSessionResponse;
}

function randomNonce(): string {
  if (
    typeof crypto !== "undefined" &&
    typeof crypto.randomUUID === "function"
  ) {
    return crypto.randomUUID().replace(/-/g, "");
  }
  return `${Date.now()}${Math.random().toString(16).slice(2, 10)}`;
}

function bytesToBase64(bytes: Uint8Array): string {
  if (typeof btoa === "function") {
    let binary = "";
    for (let index = 0; index < bytes.length; index += 1) {
      binary += String.fromCharCode(bytes[index]);
    }
    return btoa(binary);
  }
  throw new Error("base64_encoding_unavailable");
}

function buildRequestError(
  response: Response,
  payload: unknown,
  fallback: string,
): Error {
  const record =
    payload && typeof payload === "object"
      ? (payload as Record<string, unknown>)
      : null;
  const message =
    typeof record?.message === "string"
      ? record.message
      : typeof record?.error === "string"
        ? record.error
        : `${fallback}: ${response.status}`;
  const error = new Error(message) as Error & {
    code?: string;
    status?: number;
    details?: unknown;
  };
  if (typeof record?.error === "string") {
    error.code = record.error;
  }
  error.status = response.status;
  if (record && "details" in record) {
    error.details = record.details;
  }
  return error;
}
