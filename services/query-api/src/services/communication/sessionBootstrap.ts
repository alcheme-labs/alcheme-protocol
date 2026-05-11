import crypto from "crypto";

import type { Prisma, PrismaClient } from "@prisma/client";

import { verifyEd25519SignatureBase64 } from "../offchainDiscussion";

export interface CommunicationSessionBootstrapPayload {
  v: 1;
  action: "communication_session_init";
  walletPubkey: string;
  scopeType: "room";
  scopeRef: string;
  clientTimestamp: string;
  nonce: string;
}

export interface ValidatedCommunicationSessionBootstrap {
  walletPubkey: string;
  roomKey: string;
  clientTimestamp: Date;
  nonce: string;
  signedMessage: string;
  signatureVerified: true;
  ttlSec: number;
  clientMeta?: Prisma.InputJsonValue;
}

export interface CommunicationSessionRow {
  sessionId: string;
  walletPubkey: string;
  scopeType: string;
  scopeRef: string;
  expiresAt: Date;
  revoked: boolean;
}

const DEFAULT_SESSION_TTL_SEC = 60 * 60;
const MAX_SESSION_TTL_SEC = 24 * 60 * 60;
const SIGNED_TIMESTAMP_MAX_SKEW_MS = 15 * 60 * 1000;

export function buildCommunicationSessionBootstrapMessage(
  payload: CommunicationSessionBootstrapPayload,
): string {
  return `alcheme-communication-session:${JSON.stringify(payload)}`;
}

export function validateCommunicationSessionBootstrap(input: {
  body: any;
  expectedRoomKey?: string;
  now?: Date;
}):
  | { ok: true; bootstrap: ValidatedCommunicationSessionBootstrap }
  | { ok: false; status: number; error: string } {
  const body = input.body && typeof input.body === "object" ? input.body : {};
  const walletPubkey = stringOrUndefined(body.walletPubkey);
  const roomKey = stringOrUndefined(body.roomKey ?? body.scopeRef) ?? input.expectedRoomKey;
  if (!walletPubkey) {
    return { ok: false, status: 400, error: "missing_wallet_pubkey" };
  }
  if (!roomKey) {
    return { ok: false, status: 400, error: "missing_room_key" };
  }
  if (input.expectedRoomKey && roomKey !== input.expectedRoomKey) {
    return { ok: false, status: 400, error: "signed_message_mismatch" };
  }

  const clientTimestamp = parseDateOrNow(body.clientTimestamp);
  if (!clientTimestamp) {
    return { ok: false, status: 400, error: "invalid_client_timestamp" };
  }
  const timestampDecision = validateSignedTimestamp(
    clientTimestamp,
    input.now ?? new Date(),
  );
  if (timestampDecision) {
    return { ok: false, ...timestampDecision };
  }

  const nonce = stringOrUndefined(body.nonce) ?? randomNonce();
  const payload: CommunicationSessionBootstrapPayload = {
    v: 1,
    action: "communication_session_init",
    walletPubkey,
    scopeType: "room",
    scopeRef: roomKey,
    clientTimestamp: clientTimestamp.toISOString(),
    nonce,
  };
  const canonicalSignedMessage = buildCommunicationSessionBootstrapMessage(payload);
  const signedMessage = stringOrUndefined(body.signedMessage) ?? canonicalSignedMessage;
  if (signedMessage !== canonicalSignedMessage) {
    return { ok: false, status: 400, error: "signed_message_mismatch" };
  }

  const signatureVerified = verifyEd25519SignatureBase64({
    senderPubkey: walletPubkey,
    message: signedMessage,
    signatureBase64: stringOrNull(body.signature),
  });
  if (!signatureVerified) {
    return { ok: false, status: 401, error: "session_signature_required" };
  }

  return {
    ok: true,
    bootstrap: {
      walletPubkey,
      roomKey,
      clientTimestamp,
      nonce,
      signedMessage,
      signatureVerified: true,
      ttlSec: normalizeSessionTtl(body.ttlSec),
      clientMeta: jsonObjectOrUndefined(body.clientMeta),
    },
  };
}

export async function issueCommunicationSession(
  prisma: Pick<PrismaClient, "communicationSession">,
  input: ValidatedCommunicationSessionBootstrap,
  options: { now?: Date } = {},
): Promise<CommunicationSessionRow> {
  const now = options.now ?? new Date();
  const sessionId = randomSessionId();
  return prisma.communicationSession.create({
    data: {
      sessionId,
      walletPubkey: input.walletPubkey,
      scopeType: "room",
      scopeRef: input.roomKey,
      expiresAt: new Date(now.getTime() + input.ttlSec * 1000),
      revoked: false,
      lastSeenAt: now,
      clientMeta: input.clientMeta,
    },
  }) as Promise<CommunicationSessionRow>;
}

export function mapCommunicationSessionResponse(
  session: CommunicationSessionRow,
) {
  return {
    sessionId: session.sessionId,
    walletPubkey: session.walletPubkey,
    scopeType: session.scopeType,
    scopeRef: session.scopeRef,
    expiresAt: session.expiresAt.toISOString(),
    communicationAccessToken: session.sessionId,
  };
}

function validateSignedTimestamp(
  value: Date,
  now: Date,
): { status: number; error: string } | null {
  const skewMs = Math.abs(now.getTime() - value.getTime());
  if (!Number.isFinite(skewMs) || skewMs > SIGNED_TIMESTAMP_MAX_SKEW_MS) {
    return { status: 401, error: "signed_timestamp_out_of_window" };
  }
  return null;
}

function normalizeSessionTtl(value: unknown): number {
  const requestedTtl = optionalPositiveInt(value) ?? DEFAULT_SESSION_TTL_SEC;
  return Math.min(Math.max(requestedTtl, 60), MAX_SESSION_TTL_SEC);
}

function parseDateOrNow(value: unknown): Date | null {
  if (value === null || value === undefined || value === "") return new Date();
  if (typeof value !== "string") return null;
  const parsed = new Date(value);
  return Number.isNaN(parsed.getTime()) ? null : parsed;
}

function optionalPositiveInt(value: unknown): number | null {
  if (value === null || value === undefined || value === "") return null;
  const parsed =
    typeof value === "number"
      ? Math.trunc(value)
      : Number.parseInt(String(value), 10);
  return Number.isSafeInteger(parsed) && parsed > 0 ? parsed : null;
}

function stringOrUndefined(value: unknown): string | undefined {
  if (typeof value !== "string") return undefined;
  const normalized = value.trim();
  return normalized || undefined;
}

function stringOrNull(value: unknown): string | null {
  return stringOrUndefined(value) ?? null;
}

function plainObjectOrNull(value: unknown): Record<string, unknown> | null {
  if (!value || typeof value !== "object" || Array.isArray(value)) return null;
  return value as Record<string, unknown>;
}

function jsonObjectOrUndefined(
  value: unknown,
): Prisma.InputJsonValue | undefined {
  const objectValue = plainObjectOrNull(value);
  return objectValue ? (objectValue as Prisma.InputJsonValue) : undefined;
}

function randomNonce(): string {
  return crypto.randomBytes(16).toString("hex");
}

function randomSessionId(): string {
  return `comm_${crypto.randomBytes(18).toString("base64url")}`;
}
