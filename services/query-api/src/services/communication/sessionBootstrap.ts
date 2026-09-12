import crypto from "crypto";

import type { Prisma, PrismaClient } from "@prisma/client";

import { verifyEd25519SignatureBase64 } from "../offchainDiscussion";

export const CONTRIBUTION_GRANT_POLICY_DIGEST =
  "e8219fe98140a6819c1eaffdb4f79b959b15279f6b76022d00cd19bc04c225fc";

export interface CommunicationContributionGrantPayload {
  contractVersion: "communication_contribution_grant.v1";
  externalAppId: string;
  roomKey: string;
  circleId: number;
  purpose: "circle_discussion_draft";
  visibility: "circle_only";
  policyDigest: string;
  grantExpiresAt: string;
}

export interface CommunicationSessionBootstrapPayloadV1 {
  v: 1;
  action: "communication_session_init";
  walletPubkey: string;
  scopeType: "room";
  scopeRef: string;
  clientTimestamp: string;
  nonce: string;
}

export interface CommunicationSessionBootstrapPayloadV2 {
  v: 2;
  action: "communication_session_init";
  walletPubkey: string;
  scopeType: "room";
  scopeRef: string;
  clientTimestamp: string;
  nonce: string;
  contributionGrant: CommunicationContributionGrantPayload;
}

export type CommunicationSessionBootstrapPayload =
  | CommunicationSessionBootstrapPayloadV1
  | CommunicationSessionBootstrapPayloadV2;

export interface VerifiedCommunicationContributionGrant {
  payload: CommunicationContributionGrantPayload;
  signedMessage: string;
  signature: string;
  digest: string;
  verifiedAt: string;
}

export interface ValidatedCommunicationSessionBootstrap {
  walletPubkey: string;
  roomKey: string;
  clientTimestamp: Date;
  nonce: string;
  signedMessage: string;
  signatureVerified: boolean;
  ttlSec: number;
  clientMeta?: Prisma.InputJsonValue;
  contributionGrant?: VerifiedCommunicationContributionGrant;
}

export interface CommunicationSessionRow {
  sessionId: string;
  walletPubkey: string;
  scopeType: string;
  scopeRef: string;
  expiresAt: Date;
  revoked: boolean;
  contributionGrant?: Prisma.JsonValue | null;
  contributionGrantDigest?: string | null;
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
  trustedWalletPubkey?: string | null;
}):
  | { ok: true; bootstrap: ValidatedCommunicationSessionBootstrap }
  | { ok: false; status: number; error: string } {
  const body = input.body && typeof input.body === "object" ? input.body : {};
  const requestedWalletPubkey = stringOrUndefined(body.walletPubkey);
  const trustedWalletPubkey = stringOrUndefined(input.trustedWalletPubkey);
  if (
    requestedWalletPubkey &&
    trustedWalletPubkey &&
    requestedWalletPubkey !== trustedWalletPubkey
  ) {
    return { ok: false, status: 403, error: "communication_session_actor_mismatch" };
  }
  const walletPubkey = trustedWalletPubkey ?? requestedWalletPubkey;
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
  const ttlSec = normalizeSessionTtl(body.ttlSec);
  const contributionGrantResult = normalizeContributionGrant({
    value: body.contributionGrant,
    walletPubkey,
    roomKey,
    now: input.now ?? new Date(),
    ttlSec,
  });
  if (!contributionGrantResult.ok) {
    return contributionGrantResult;
  }
  const contributionGrant = contributionGrantResult.grant;
  const basePayload = {
    action: "communication_session_init" as const,
    walletPubkey,
    scopeType: "room" as const,
    scopeRef: roomKey,
    clientTimestamp: clientTimestamp.toISOString(),
    nonce,
  };
  const payload: CommunicationSessionBootstrapPayload = contributionGrant
    ? { v: 2, ...basePayload, contributionGrant }
    : { v: 1, ...basePayload };
  const canonicalSignedMessage = buildCommunicationSessionBootstrapMessage(payload);
  const signedMessage = stringOrUndefined(body.signedMessage) ?? canonicalSignedMessage;
  if (signedMessage !== canonicalSignedMessage) {
    return { ok: false, status: 400, error: "signed_message_mismatch" };
  }

  const signature = stringOrNull(body.signature);
  const signatureVerified = signature
    ? verifyEd25519SignatureBase64({
        senderPubkey: walletPubkey,
        message: signedMessage,
        signatureBase64: signature,
      })
    : false;
  if (contributionGrant && !signatureVerified) {
    return { ok: false, status: 401, error: "contribution_grant_signature_required" };
  }
  if (!trustedWalletPubkey && !signatureVerified) {
    return { ok: false, status: 401, error: "session_signature_required" };
  }
  if (signature && !signatureVerified) {
    return { ok: false, status: 401, error: "session_signature_invalid" };
  }

  return {
    ok: true,
    bootstrap: {
      walletPubkey,
      roomKey,
      clientTimestamp,
      nonce,
      signedMessage,
      signatureVerified,
      ttlSec,
      clientMeta: jsonObjectOrUndefined(body.clientMeta),
      contributionGrant: contributionGrant && signature
        ? {
            payload: contributionGrant,
            signedMessage,
            signature,
            digest: crypto.createHash("sha256").update(signedMessage).digest("hex"),
            verifiedAt: (input.now ?? new Date()).toISOString(),
          }
        : undefined,
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
      contributionGrant: input.contributionGrant as unknown as Prisma.InputJsonValue,
      contributionGrantDigest: input.contributionGrant?.digest,
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
    contributionAuthorized: Boolean(session.contributionGrantDigest),
    contributionGrantExpiresAt: readGrantExpiresAt(session.contributionGrant),
  };
}

function normalizeContributionGrant(input: {
  value: unknown;
  walletPubkey: string;
  roomKey: string;
  now: Date;
  ttlSec: number;
}):
  | { ok: true; grant?: CommunicationContributionGrantPayload }
  | { ok: false; status: number; error: string } {
  if (input.value == null) return { ok: true };
  if (!input.value || typeof input.value !== "object" || Array.isArray(input.value)) {
    return { ok: false, status: 400, error: "invalid_contribution_grant" };
  }
  const value = input.value as Record<string, unknown>;
  const externalAppId = stringOrUndefined(value.externalAppId);
  const roomKey = stringOrUndefined(value.roomKey);
  const circleId = Number(value.circleId);
  const grantExpiresAt = parseDateOrNow(value.grantExpiresAt);
  if (
    value.contractVersion !== "communication_contribution_grant.v1"
    || !externalAppId
    || !roomKey
    || !Number.isSafeInteger(circleId)
    || circleId <= 0
    || value.purpose !== "circle_discussion_draft"
    || value.visibility !== "circle_only"
    || !grantExpiresAt
  ) {
    return { ok: false, status: 400, error: "invalid_contribution_grant" };
  }
  if (roomKey !== input.roomKey) {
    return { ok: false, status: 400, error: "contribution_grant_scope_mismatch" };
  }
  if (value.policyDigest !== CONTRIBUTION_GRANT_POLICY_DIGEST) {
    return { ok: false, status: 400, error: "contribution_grant_policy_mismatch" };
  }
  if (grantExpiresAt.getTime() <= input.now.getTime()) {
    return { ok: false, status: 400, error: "contribution_grant_expired" };
  }
  if (grantExpiresAt.getTime() > input.now.getTime() + input.ttlSec * 1000) {
    return { ok: false, status: 400, error: "contribution_grant_exceeds_session" };
  }
  return {
    ok: true,
    grant: {
      contractVersion: "communication_contribution_grant.v1",
      externalAppId,
      roomKey,
      circleId,
      purpose: "circle_discussion_draft",
      visibility: "circle_only",
      policyDigest: CONTRIBUTION_GRANT_POLICY_DIGEST,
      grantExpiresAt: grantExpiresAt.toISOString(),
    },
  };
}

function readGrantExpiresAt(value: Prisma.JsonValue | null | undefined): string | null {
  if (!value || typeof value !== "object" || Array.isArray(value)) return null;
  const payload = (value as Record<string, unknown>).payload;
  if (!payload || typeof payload !== "object" || Array.isArray(payload)) return null;
  return stringOrNull((payload as Record<string, unknown>).grantExpiresAt);
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
