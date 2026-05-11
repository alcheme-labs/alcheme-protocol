import crypto from "crypto";

import { Router } from "express";
import type { Prisma, PrismaClient } from "@prisma/client";
import type { Redis } from "ioredis";

import { verifyEd25519SignatureBase64 } from "../services/offchainDiscussion";
import { resolveCommunicationRoom } from "../services/communication/roomResolver";
import {
  canModerateRoom,
  canReadRoom,
  canWriteRoom,
  upsertCommunicationRoomMemberFromClaim,
  type CommunicationPermissionDecision,
} from "../services/communication/permissions";

type CommunicationPrisma = PrismaClient;

export interface CommunicationSessionBootstrapPayload {
  v: 1;
  action: "communication_session_init";
  walletPubkey: string;
  scopeType: "room";
  scopeRef: string;
  clientTimestamp: string;
  nonce: string;
}

export type CommunicationMessageKind = "plain" | "voice_clip";

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

interface CommunicationSessionRow {
  sessionId: string;
  walletPubkey: string;
  scopeType: string;
  scopeRef: string;
  expiresAt: Date;
  revoked: boolean;
}

interface CommunicationMessageRow {
  envelopeId: string;
  roomKey: string;
  senderPubkey: string;
  senderHandle?: string | null;
  messageKind: string;
  payloadText?: string | null;
  payloadHash: string;
  storageUri?: string | null;
  durationMs?: number | null;
  metadata?: unknown;
  signature?: string | null;
  signedMessage: string;
  signatureVerified: boolean;
  authMode: string;
  sessionId?: string | null;
  clientTimestamp: Date;
  lamport: bigint;
  prevEnvelopeId?: string | null;
  deleted: boolean;
  expiresAt?: Date | null;
  createdAt: Date;
  updatedAt: Date;
}

type NormalizedMessage =
  | {
      messageKind: "plain";
      text: string;
      storageUri: null;
      durationMs: null;
      fileSizeBytes: null;
      metadata: Record<string, unknown> | null;
    }
  | {
      messageKind: "voice_clip";
      text: string | null;
      storageUri: string;
      durationMs: number;
      fileSizeBytes: number;
      metadata: Record<string, unknown> | null;
    };

type NormalizedMessageResult =
  | { ok: true; message: NormalizedMessage }
  | { ok: false; status: number; error: string };

const DEFAULT_SESSION_TTL_SEC = 60 * 60;
const MAX_SESSION_TTL_SEC = 24 * 60 * 60;
const MAX_MESSAGE_LIMIT = 200;
const DEFAULT_MESSAGE_LIMIT = 80;
const MAX_TEXT_LENGTH = 4_000;
const DEFAULT_MAX_VOICE_CLIP_DURATION_MS = 5 * 60 * 1000;
const DEFAULT_MAX_VOICE_CLIP_BYTES = 25 * 1024 * 1024;
const MAX_STORAGE_URI_LENGTH = 2_048;
const SIGNED_TIMESTAMP_MAX_SKEW_MS = 15 * 60 * 1000;

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

export function computeCommunicationPayloadHash(input: {
  roomKey: string;
  senderPubkey: string;
  messageKind: string;
  text?: string | null;
  metadata?: unknown;
  storageUri?: string | null;
  durationMs?: number | null;
}): string {
  return sha256Hex(
    stableJsonStringify({
      messageKind: input.messageKind,
      metadata: input.metadata ?? null,
      roomKey: input.roomKey,
      senderPubkey: input.senderPubkey,
      storageUri: input.storageUri ?? null,
      durationMs: input.durationMs ?? null,
      text: input.text ?? null,
    }),
  );
}

export function buildCommunicationRealtimeChannel(roomKey: string): string {
  return `communication:room:${roomKey}`;
}

export function communicationRouter(
  prisma: CommunicationPrisma,
  redis: Redis,
): Router {
  const router = Router();

  router.post("/rooms/resolve", async (req, res, next) => {
    try {
      const roomType = String(req.body?.roomType || "").trim();
      if (!roomType) {
        return res.status(400).json({ error: "missing_room_type" });
      }

      const room = await resolveCommunicationRoom(prisma, {
        externalAppId: stringOrNull(req.body?.externalAppId),
        roomType,
        externalRoomId: stringOrNull(req.body?.externalRoomId),
        parentCircleId: optionalPositiveInt(req.body?.parentCircleId),
        participantPubkeys: Array.isArray(req.body?.participantPubkeys)
          ? req.body.participantPubkeys.map((item: unknown) => String(item))
          : undefined,
        ttlSec: optionalPositiveInt(req.body?.ttlSec) ?? undefined,
        knowledgeMode: stringOrUndefined(req.body?.knowledgeMode),
        transcriptionMode: stringOrUndefined(req.body?.transcriptionMode),
        retentionPolicy: stringOrUndefined(req.body?.retentionPolicy),
        createdByPubkey: stringOrNull(req.body?.createdByPubkey),
        metadata: plainObjectOrNull(req.body?.metadata),
        appRoomClaim: req.body?.appRoomClaim ?? null,
        walletPubkey: stringOrNull(req.body?.walletPubkey),
      });

      res.status(201).json({
        ok: true,
        room: mapRoom(room),
      });
    } catch (error) {
      next(error);
    }
  });

  router.get("/rooms/:roomKey", async (req, res, next) => {
    try {
      const roomKey = parseRouteValue(req.params.roomKey);
      const sessionAuth = await authenticateRoomSession(prisma, req, roomKey);
      if (!sessionAuth.ok) {
        return sendSessionError(res, sessionAuth);
      }

      const decision = await canReadRoom(prisma, {
        roomKey,
        walletPubkey: sessionAuth.session.walletPubkey,
      });
      if (!decision.allowed) return sendPermissionDecision(res, decision);

      const room = await prisma.communicationRoom.findUnique({
        where: { roomKey },
      });
      if (!room) return res.status(404).json({ error: "room_not_found" });

      res.json({ ok: true, room: mapRoom(room) });
    } catch (error) {
      next(error);
    }
  });

  router.post("/rooms/:roomKey/members", async (req, res, next) => {
    try {
      const roomKey = parseRouteValue(req.params.roomKey);
      const walletPubkey = stringOrUndefined(req.body?.walletPubkey);
      if (!walletPubkey) {
        return res.status(400).json({ error: "missing_wallet_pubkey" });
      }
      if (!req.body?.appRoomClaim) {
        return res.status(400).json({ error: "missing_app_room_claim" });
      }

      const member = await upsertCommunicationRoomMemberFromClaim(prisma, {
        roomKey,
        walletPubkey,
        appRoomClaim: req.body.appRoomClaim,
      });

      res.json({ ok: true, member: mapMember(member) });
    } catch (error) {
      next(error);
    }
  });

  router.post("/rooms/:roomKey/end", async (req, res, next) => {
    try {
      const roomKey = parseRouteValue(req.params.roomKey);
      const sessionAuth = await authenticateRoomSession(prisma, req, roomKey);
      if (!sessionAuth.ok) {
        return sendSessionError(res, sessionAuth);
      }
      const decision = await canModerateRoom(prisma, {
        roomKey,
        walletPubkey: sessionAuth.session.walletPubkey,
      });
      if (!decision.allowed) return sendPermissionDecision(res, decision);

      const endedAt = new Date();
      const room = await prisma.communicationRoom.update({
        where: { roomKey },
        data: {
          lifecycleStatus: "ended",
          endedAt,
        },
      });
      res.json({ ok: true, room: mapRoom(room) });
    } catch (error) {
      next(error);
    }
  });

  router.post("/sessions", async (req, res, next) => {
    try {
      const walletPubkey = stringOrUndefined(req.body?.walletPubkey);
      const roomKey = stringOrUndefined(
        req.body?.roomKey ?? req.body?.scopeRef,
      );
      if (!walletPubkey) {
        return res.status(400).json({ error: "missing_wallet_pubkey" });
      }
      if (!roomKey) {
        return res.status(400).json({ error: "missing_room_key" });
      }

      const clientTimestamp = parseDateOrNow(req.body?.clientTimestamp);
      if (!clientTimestamp) {
        return res.status(400).json({ error: "invalid_client_timestamp" });
      }
      const timestampDecision = validateSignedTimestamp(clientTimestamp);
      if (timestampDecision) {
        return res
          .status(timestampDecision.status)
          .json({ error: timestampDecision.error });
      }
      const nonce = stringOrUndefined(req.body?.nonce) ?? randomNonce();
      const payload: CommunicationSessionBootstrapPayload = {
        v: 1,
        action: "communication_session_init",
        walletPubkey,
        scopeType: "room",
        scopeRef: roomKey,
        clientTimestamp: clientTimestamp.toISOString(),
        nonce,
      };
      const canonicalSignedMessage =
        buildCommunicationSessionBootstrapMessage(payload);
      const signedMessage =
        stringOrUndefined(req.body?.signedMessage) ?? canonicalSignedMessage;
      if (signedMessage !== canonicalSignedMessage) {
        return res.status(400).json({ error: "signed_message_mismatch" });
      }

      const signatureVerified = verifyEd25519SignatureBase64({
        senderPubkey: walletPubkey,
        message: signedMessage,
        signatureBase64: stringOrNull(req.body?.signature),
      });
      if (!signatureVerified) {
        return res.status(401).json({ error: "session_signature_required" });
      }

      const readDecision = await canReadRoom(prisma, {
        roomKey,
        walletPubkey,
      });
      if (!readDecision.allowed)
        return sendPermissionDecision(res, readDecision);

      const requestedTtl =
        optionalPositiveInt(req.body?.ttlSec) ?? DEFAULT_SESSION_TTL_SEC;
      const ttlSec = Math.min(Math.max(requestedTtl, 60), MAX_SESSION_TTL_SEC);
      const expiresAt = new Date(Date.now() + ttlSec * 1000);
      const sessionId = randomSessionId();
      const session = await prisma.communicationSession.create({
        data: {
          sessionId,
          walletPubkey,
          scopeType: "room",
          scopeRef: roomKey,
          expiresAt,
          revoked: false,
          lastSeenAt: new Date(),
          clientMeta: jsonObjectOrUndefined(req.body?.clientMeta),
        },
      });

      res.status(201).json({
        ok: true,
        sessionId: session.sessionId,
        walletPubkey: session.walletPubkey,
        scopeType: session.scopeType,
        scopeRef: session.scopeRef,
        expiresAt: session.expiresAt.toISOString(),
        communicationAccessToken: session.sessionId,
        signatureVerified,
      });
    } catch (error) {
      next(error);
    }
  });

  router.post("/sessions/:id/refresh", async (req, res, next) => {
    try {
      const sessionId = parseRouteValue(req.params.id);
      const token = parseBearerToken(req.headers.authorization);
      if (!token) {
        return res
          .status(401)
          .json({ error: "missing_communication_session_token" });
      }
      if (token !== sessionId) {
        return res
          .status(403)
          .json({ error: "communication_session_id_mismatch" });
      }
      const session = await loadValidSession(prisma, token);
      if (!session) {
        return res
          .status(401)
          .json({ error: "communication_session_not_found" });
      }

      const requestedTtl =
        optionalPositiveInt(req.body?.ttlSec) ?? DEFAULT_SESSION_TTL_SEC;
      const ttlSec = Math.min(Math.max(requestedTtl, 60), MAX_SESSION_TTL_SEC);
      const refreshed = await prisma.communicationSession.update({
        where: { sessionId },
        data: {
          expiresAt: new Date(Date.now() + ttlSec * 1000),
          lastSeenAt: new Date(),
        },
      });

      res.json({
        ok: true,
        sessionId: refreshed.sessionId,
        walletPubkey: refreshed.walletPubkey,
        scopeType: refreshed.scopeType,
        scopeRef: refreshed.scopeRef,
        expiresAt: refreshed.expiresAt.toISOString(),
        communicationAccessToken: refreshed.sessionId,
      });
    } catch (error) {
      next(error);
    }
  });

  router.delete("/sessions/:id", async (req, res, next) => {
    try {
      const sessionId = parseRouteValue(req.params.id);
      const token = parseBearerToken(req.headers.authorization);
      if (!token) {
        return res
          .status(401)
          .json({ error: "missing_communication_session_token" });
      }
      if (token !== sessionId) {
        return res
          .status(403)
          .json({ error: "communication_session_id_mismatch" });
      }
      await prisma.communicationSession.update({
        where: { sessionId },
        data: { revoked: true },
      });
      res.json({ ok: true, sessionId });
    } catch (error) {
      next(error);
    }
  });

  router.get("/rooms/:roomKey/messages", async (req, res, next) => {
    try {
      const roomKey = parseRouteValue(req.params.roomKey);
      const sessionAuth = await authenticateRoomSession(prisma, req, roomKey);
      if (!sessionAuth.ok) {
        return sendSessionError(res, sessionAuth);
      }
      const decision = await canReadRoom(prisma, {
        roomKey,
        walletPubkey: sessionAuth.session.walletPubkey,
      });
      if (!decision.allowed) return sendPermissionDecision(res, decision);

      const afterLamport = await resolveMessageCursor(prisma, {
        roomKey,
        afterLamport: req.query.afterLamport,
        afterMessageId: req.query.afterMessageId,
      });
      if (afterLamport === "invalid") {
        return res.status(400).json({ error: "invalid_message_cursor" });
      }

      const messages = await findMessagesAfter(prisma, {
        roomKey,
        afterLamport,
        limit: parseLimit(req.query.limit),
      });
      res.json({
        ok: true,
        roomKey,
        count: messages.length,
        messages: messages.map(mapMessage),
      });
    } catch (error) {
      next(error);
    }
  });

  router.post("/rooms/:roomKey/messages", async (req, res, next) => {
    try {
      const roomKey = parseRouteValue(req.params.roomKey);
      const sessionAuth = await authenticateOptionalRoomSession(
        prisma,
        req,
        roomKey,
      );
      if (!sessionAuth.ok) {
        return sendSessionError(res, sessionAuth);
      }

      const messageKind = parseMessageKind(req.body?.messageKind);
      if (!messageKind) {
        return res.status(400).json({ error: "unsupported_message_kind" });
      }
      const normalizedMessage = normalizeIncomingMessage(req.body, messageKind);
      if (!normalizedMessage.ok) {
        return res
          .status(normalizedMessage.status)
          .json({ error: normalizedMessage.error });
      }

      const senderPubkey =
        stringOrUndefined(req.body?.senderPubkey) ??
        sessionAuth.session?.walletPubkey;
      if (!senderPubkey) {
        return res.status(400).json({ error: "missing_sender_pubkey" });
      }
      if (
        sessionAuth.session &&
        sessionAuth.session.walletPubkey !== senderPubkey
      ) {
        return res
          .status(403)
          .json({ error: "communication_session_sender_mismatch" });
      }

      const writeDecision = await canWriteRoom(prisma, {
        roomKey,
        walletPubkey: senderPubkey,
      });
      if (!writeDecision.allowed)
        return sendPermissionDecision(res, writeDecision);

      const clientTimestamp = parseDateOrNow(req.body?.clientTimestamp);
      if (!clientTimestamp) {
        return res.status(400).json({ error: "invalid_client_timestamp" });
      }
      const timestampDecision = validateSignedTimestamp(clientTimestamp);
      if (timestampDecision) {
        return res
          .status(timestampDecision.status)
          .json({ error: timestampDecision.error });
      }
      const clientTimestampIso = clientTimestamp.toISOString();
      const nonce = stringOrUndefined(req.body?.nonce) ?? randomNonce();
      const prevEnvelopeId = stringOrNull(req.body?.prevEnvelopeId);
      const payload = buildMessageSigningPayload({
        roomKey,
        senderPubkey,
        message: normalizedMessage.message,
        clientTimestampIso,
        nonce,
        prevEnvelopeId,
      });
      const canonicalSignedMessage =
        buildCommunicationMessageSigningMessage(payload);
      const signedMessage =
        stringOrUndefined(req.body?.signedMessage) ?? canonicalSignedMessage;
      if (signedMessage !== canonicalSignedMessage) {
        return res.status(400).json({ error: "signed_message_mismatch" });
      }

      const signature = stringOrNull(req.body?.signature);
      const signatureVerified = verifyEd25519SignatureBase64({
        senderPubkey,
        message: signedMessage,
        signatureBase64: signature,
      });
      if (!sessionAuth.session && !signatureVerified) {
        return res.status(401).json({ error: "signature_required" });
      }

      const senderHandle =
        stringOrUndefined(req.body?.senderHandle)?.slice(0, 32) ?? null;
      const metadata = normalizedMessage.message.metadata;
      const payloadHash = computeCommunicationPayloadHash({
        roomKey,
        senderPubkey,
        messageKind: normalizedMessage.message.messageKind,
        text: normalizedMessage.message.text,
        metadata,
        storageUri: normalizedMessage.message.storageUri,
        durationMs: normalizedMessage.message.durationMs,
      });
      const envelopeId = computeCommunicationEnvelopeId({
        roomKey,
        senderPubkey,
        payloadHash,
        clientTimestamp: clientTimestampIso,
        nonce,
        prevEnvelopeId,
        signature,
      });

      const message = await prisma.communicationMessage.create({
        data: {
          envelopeId,
          roomKey,
          senderPubkey,
          senderHandle,
          messageKind: normalizedMessage.message.messageKind,
          payloadText: normalizedMessage.message.text,
          payloadHash,
          storageUri: normalizedMessage.message.storageUri,
          durationMs: normalizedMessage.message.durationMs,
          metadata: jsonObjectOrUndefined(metadata),
          signature,
          signedMessage,
          signatureVerified,
          authMode: sessionAuth.session
            ? "session_token"
            : "wallet_per_message",
          sessionId: sessionAuth.session?.sessionId ?? null,
          clientTimestamp,
          prevEnvelopeId,
        },
      });
      const dto = mapMessage(message);

      await publishCommunicationRealtimeEvent(redis, {
        event: "message_created",
        roomKey,
        latestLamport: dto.lamport,
        envelopeId: dto.envelopeId,
        message: dto,
      });

      res.status(201).json({
        ok: true,
        message: dto,
      });
    } catch (error) {
      next(error);
    }
  });

  router.get("/rooms/:roomKey/stream", async (req, res, next) => {
    try {
      const roomKey = parseRouteValue(req.params.roomKey);
      const sessionAuth = await authenticateRoomSession(prisma, req, roomKey);
      if (!sessionAuth.ok) {
        return sendSessionError(res, sessionAuth);
      }
      const decision = await canReadRoom(prisma, {
        roomKey,
        walletPubkey: sessionAuth.session.walletPubkey,
      });
      if (!decision.allowed) return sendPermissionDecision(res, decision);

      if (!redis || typeof (redis as Partial<Redis>).duplicate !== "function") {
        return res
          .status(503)
          .json({ error: "communication_realtime_unavailable" });
      }

      const afterLamport = await resolveMessageCursor(prisma, {
        roomKey,
        afterLamport: req.query.afterLamport,
        afterMessageId: req.query.afterMessageId,
      });
      if (afterLamport === "invalid") {
        return res.status(400).json({ error: "invalid_message_cursor" });
      }

      const channel = buildCommunicationRealtimeChannel(roomKey);
      const subscriber = (redis as Redis).duplicate();
      await subscriber.subscribe(channel);

      res.status(200);
      res.setHeader("Content-Type", "text/event-stream");
      res.setHeader("Cache-Control", "no-cache, no-transform");
      res.setHeader("Connection", "keep-alive");
      res.setHeader("X-Accel-Buffering", "no");
      if (typeof (res as any).flushHeaders === "function") {
        (res as any).flushHeaders();
      }

      let closed = false;
      const cleanup = () => {
        if (closed) return;
        closed = true;
        if (typeof (subscriber as any).off === "function") {
          (subscriber as any).off("message", handleRedisMessage);
        } else if (typeof (subscriber as any).removeListener === "function") {
          (subscriber as any).removeListener("message", handleRedisMessage);
        }
        void Promise.resolve(subscriber.unsubscribe(channel)).catch(
          () => undefined,
        );
        if (typeof subscriber.quit === "function") {
          void Promise.resolve(subscriber.quit()).catch(() => undefined);
        }
      };
      const handleRedisMessage = (
        incomingChannel: string,
        rawMessage: string,
      ) => {
        if (closed || incomingChannel !== channel) return;
        res.write(serializeSseEvent("message_created", JSON.parse(rawMessage)));
      };

      subscriber.on("message", handleRedisMessage);

      const backlog = await findMessagesAfter(prisma, {
        roomKey,
        afterLamport,
        limit: parseLimit(req.query.limit),
      });
      for (const message of backlog) {
        const dto = mapMessage(message);
        res.write(
          serializeSseEvent("message_created", {
            event: "message_created",
            roomKey,
            latestLamport: dto.lamport,
            envelopeId: dto.envelopeId,
            message: dto,
          }),
        );
      }

      if (String(req.query.once || "") === "1") {
        cleanup();
        res.end();
        return;
      }

      const heartbeatTimer = setInterval(() => {
        if (!closed) res.write(": heartbeat\n\n");
      }, 15_000);

      req.on("close", () => {
        clearInterval(heartbeatTimer);
        cleanup();
      });
    } catch (error) {
      next(error);
    }
  });

  router.delete("/messages/:envelopeId", async (req, res, next) => {
    try {
      const envelopeId = parseRouteValue(req.params.envelopeId);
      const message = await prisma.communicationMessage.findUnique({
        where: { envelopeId },
      });
      if (!message) return res.status(404).json({ error: "message_not_found" });

      const sessionAuth = await authenticateRoomSession(
        prisma,
        req,
        message.roomKey,
      );
      if (!sessionAuth.ok) {
        return sendSessionError(res, sessionAuth);
      }
      const canDeleteOwnMessage =
        message.senderPubkey === sessionAuth.session.walletPubkey;
      const moderationDecision = canDeleteOwnMessage
        ? { allowed: true }
        : await canModerateRoom(prisma, {
            roomKey: message.roomKey,
            walletPubkey: sessionAuth.session.walletPubkey,
          });
      if (!moderationDecision.allowed) {
        return res
          .status(403)
          .json({ error: "message_delete_permission_required" });
      }

      const deleted = await prisma.communicationMessage.update({
        where: { envelopeId },
        data: { deleted: true },
      });
      res.json({ ok: true, message: mapMessage(deleted) });
    } catch (error) {
      next(error);
    }
  });

  return router;
}

async function authenticateRoomSession(
  prisma: CommunicationPrisma,
  req: { headers: { authorization?: string | string[] } },
  roomKey: string,
): Promise<
  | { ok: true; session: CommunicationSessionRow }
  | { ok: false; status: number; error: string }
> {
  const auth = await authenticateOptionalRoomSession(prisma, req, roomKey);
  if (!auth.ok) return auth;
  if (!auth.session) {
    return {
      ok: false,
      status: 401,
      error: "missing_communication_session_token",
    };
  }
  return { ok: true, session: auth.session };
}

async function authenticateOptionalRoomSession(
  prisma: CommunicationPrisma,
  req: { headers: { authorization?: string | string[] } },
  roomKey: string,
): Promise<
  | { ok: true; session: CommunicationSessionRow | null }
  | { ok: false; status: number; error: string }
> {
  const authorization = Array.isArray(req.headers.authorization)
    ? req.headers.authorization[0]
    : req.headers.authorization;
  const token = parseBearerToken(authorization);
  if (!token) return { ok: true, session: null };

  const session = await loadValidSession(prisma, token);
  if (!session) {
    return {
      ok: false,
      status: 401,
      error: "communication_session_not_found",
    };
  }
  if (session.scopeType !== "room" || session.scopeRef !== roomKey) {
    return {
      ok: false,
      status: 403,
      error: "communication_session_scope_violation",
    };
  }

  await prisma.communicationSession.update({
    where: { sessionId: session.sessionId },
    data: { lastSeenAt: new Date() },
  });

  return { ok: true, session };
}

async function loadValidSession(
  prisma: CommunicationPrisma,
  sessionId: string,
): Promise<CommunicationSessionRow | null> {
  const session = await prisma.communicationSession.findUnique({
    where: { sessionId },
  });
  if (!session) return null;
  if (session.revoked) return null;
  if (session.expiresAt.getTime() <= Date.now()) return null;
  return session;
}

async function resolveMessageCursor(
  prisma: CommunicationPrisma,
  input: {
    roomKey: string;
    afterLamport: unknown;
    afterMessageId: unknown;
  },
): Promise<bigint | "invalid"> {
  const afterLamport = parseOptionalLamport(input.afterLamport);
  if (afterLamport === "invalid") return "invalid";

  const afterMessageId = stringOrUndefined(input.afterMessageId);
  if (!afterMessageId) return afterLamport ?? 0n;

  const cursor = await prisma.communicationMessage.findUnique({
    where: { envelopeId: afterMessageId },
  });
  if (!cursor || cursor.roomKey !== input.roomKey) return "invalid";
  return cursor.lamport;
}

function findMessagesAfter(
  prisma: CommunicationPrisma,
  input: { roomKey: string; afterLamport: bigint; limit: number },
): Promise<CommunicationMessageRow[]> {
  return prisma.communicationMessage.findMany({
    where: {
      roomKey: input.roomKey,
      deleted: false,
      lamport: { gt: input.afterLamport },
      OR: [{ expiresAt: null }, { expiresAt: { gt: new Date() } }],
    },
    orderBy: { lamport: "asc" },
    take: input.limit,
  });
}

async function publishCommunicationRealtimeEvent(
  redis: Redis,
  payload: {
    event: "message_created";
    roomKey: string;
    latestLamport: number;
    envelopeId: string;
    message: ReturnType<typeof mapMessage>;
  },
): Promise<void> {
  if (!redis || typeof redis.publish !== "function") return;
  await redis.publish(
    buildCommunicationRealtimeChannel(payload.roomKey),
    JSON.stringify(payload),
  );
}

function mapRoom(room: any) {
  return {
    roomKey: room.roomKey,
    externalAppId: room.externalAppId ?? null,
    parentCircleId: room.parentCircleId ?? null,
    roomType: room.roomType,
    externalRoomId: room.externalRoomId ?? null,
    lifecycleStatus: room.lifecycleStatus,
    knowledgeMode: room.knowledgeMode,
    transcriptionMode: room.transcriptionMode,
    retentionPolicy: room.retentionPolicy,
    createdByPubkey: room.createdByPubkey ?? null,
    expiresAt: room.expiresAt?.toISOString?.() ?? null,
    endedAt: room.endedAt?.toISOString?.() ?? null,
    metadata: room.metadata ?? null,
    createdAt: room.createdAt?.toISOString?.() ?? null,
    updatedAt: room.updatedAt?.toISOString?.() ?? null,
  };
}

function mapMember(member: any) {
  return {
    roomKey: member.roomKey,
    walletPubkey: member.walletPubkey,
    role: member.role,
    canSpeak: member.canSpeak,
    muted: member.muted,
    banned: member.banned,
    joinedAt: member.joinedAt?.toISOString?.() ?? null,
    leftAt: member.leftAt?.toISOString?.() ?? null,
  };
}

function mapMessage(message: CommunicationMessageRow) {
  return {
    envelopeId: message.envelopeId,
    roomKey: message.roomKey,
    senderPubkey: message.senderPubkey,
    senderHandle: message.senderHandle ?? null,
    messageKind: message.messageKind,
    text: message.deleted ? "" : (message.payloadText ?? ""),
    payloadHash: message.payloadHash,
    storageUri: message.storageUri ?? null,
    durationMs: message.durationMs ?? null,
    metadata: message.metadata ?? null,
    signature: message.signature ?? null,
    signatureVerified: message.signatureVerified,
    authMode: message.authMode,
    sessionId: null,
    clientTimestamp: message.clientTimestamp.toISOString(),
    lamport: Number(message.lamport),
    prevEnvelopeId: message.prevEnvelopeId ?? null,
    deleted: message.deleted,
    expiresAt: message.expiresAt?.toISOString() ?? null,
    createdAt: message.createdAt.toISOString(),
    updatedAt: message.updatedAt.toISOString(),
  };
}

function sendPermissionDecision(
  res: { status(code: number): { json(body: unknown): void } },
  decision: CommunicationPermissionDecision,
) {
  return res.status(decision.statusCode).json({ error: decision.reason });
}

function sendSessionError(
  res: { status(code: number): { json(body: unknown): void } },
  sessionAuth: { ok: false; status: number; error: string },
) {
  return res.status(sessionAuth.status).json({ error: sessionAuth.error });
}

function serializeSseEvent(event: string, payload: unknown): string {
  return `event: ${event}\ndata: ${JSON.stringify(payload)}\n\n`;
}

function parseBearerToken(headerValue: string | undefined): string | null {
  if (!headerValue || !headerValue.startsWith("Bearer ")) return null;
  const token = headerValue.slice(7).trim();
  return token || null;
}

function parseRouteValue(value: unknown): string {
  return String(value || "").trim();
}

function stringOrUndefined(value: unknown): string | undefined {
  if (typeof value !== "string") return undefined;
  const normalized = value.trim();
  return normalized || undefined;
}

function stringOrNull(value: unknown): string | null {
  return stringOrUndefined(value) ?? null;
}

function optionalPositiveInt(value: unknown): number | null {
  if (value === null || value === undefined || value === "") return null;
  const parsed =
    typeof value === "number"
      ? Math.trunc(value)
      : Number.parseInt(String(value), 10);
  return Number.isSafeInteger(parsed) && parsed > 0 ? parsed : null;
}

function parseLimit(value: unknown): number {
  const parsed = optionalPositiveInt(value) ?? DEFAULT_MESSAGE_LIMIT;
  return Math.min(parsed, MAX_MESSAGE_LIMIT);
}

function parseOptionalLamport(value: unknown): bigint | null | "invalid" {
  if (value === null || value === undefined || value === "") return null;
  if (typeof value !== "string" && typeof value !== "number") return "invalid";
  const normalized = String(value).trim();
  if (!/^\d+$/.test(normalized)) return "invalid";
  return BigInt(normalized);
}

function parseDateOrNow(value: unknown): Date | null {
  if (value === null || value === undefined || value === "") return new Date();
  if (typeof value !== "string") return null;
  const parsed = new Date(value);
  return Number.isNaN(parsed.getTime()) ? null : parsed;
}

function validateSignedTimestamp(
  value: Date,
): { status: number; error: string } | null {
  const skewMs = Math.abs(Date.now() - value.getTime());
  if (!Number.isFinite(skewMs) || skewMs > SIGNED_TIMESTAMP_MAX_SKEW_MS) {
    return { status: 401, error: "signed_timestamp_out_of_window" };
  }
  return null;
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

function normalizeMessageText(value: unknown): string {
  if (typeof value !== "string") return "";
  return value.replace(/\r\n/g, "\n").trim();
}

function parseMessageKind(value: unknown): CommunicationMessageKind | null {
  const normalized =
    typeof value === "string" ? value.trim().toLowerCase() : "plain";
  if (!normalized || normalized === "plain") return "plain";
  if (normalized === "voice_clip") return "voice_clip";
  return null;
}

function normalizeIncomingMessage(
  body: unknown,
  messageKind: CommunicationMessageKind,
): NormalizedMessageResult {
  const record = body && typeof body === "object" ? (body as any) : {};
  if (messageKind === "plain") {
    const text = normalizeMessageText(record.text);
    if (!text) return { ok: false, status: 400, error: "missing_message_text" };
    if (text.length > MAX_TEXT_LENGTH) {
      return { ok: false, status: 413, error: "message_too_large" };
    }
    return {
      ok: true,
      message: {
        messageKind,
        text,
        storageUri: null,
        durationMs: null,
        fileSizeBytes: null,
        metadata: plainObjectOrNull(record.metadata),
      },
    };
  }

  const limits = getVoiceClipLimits();
  const storageUri = stringOrUndefined(record.storageUri);
  if (!storageUri) {
    return { ok: false, status: 400, error: "missing_storage_uri" };
  }
  const storageUriDecision = validateVoiceClipStorageUri(storageUri);
  if (storageUriDecision) return storageUriDecision;

  if (
    stringOrUndefined(record.voiceSessionId) ||
    stringOrUndefined(record.providerRoomId)
  ) {
    return {
      ok: false,
      status: 400,
      error: "voice_clip_realtime_source_forbidden",
    };
  }

  const durationMs = optionalPositiveInt(record.durationMs);
  if (!durationMs) {
    return { ok: false, status: 400, error: "missing_duration_ms" };
  }
  if (durationMs > limits.maxDurationMs) {
    return { ok: false, status: 413, error: "voice_clip_duration_too_large" };
  }

  const fileSizeBytes = optionalPositiveInt(record.fileSizeBytes);
  if (fileSizeBytes === null) {
    return { ok: false, status: 400, error: "missing_file_size_bytes" };
  }
  if (fileSizeBytes > limits.maxFileSizeBytes) {
    return { ok: false, status: 413, error: "voice_clip_file_too_large" };
  }

  const text = normalizeMessageText(record.payloadText ?? record.text);
  if (text.length > MAX_TEXT_LENGTH) {
    return { ok: false, status: 413, error: "message_too_large" };
  }

  return {
    ok: true,
    message: {
      messageKind,
      text: text || null,
      storageUri,
      durationMs,
      fileSizeBytes,
      metadata: mergeVoiceClipMetadata(
        plainObjectOrNull(record.metadata),
        fileSizeBytes,
      ),
    },
  };
}

function buildMessageSigningPayload(input: {
  roomKey: string;
  senderPubkey: string;
  message: NormalizedMessage;
  clientTimestampIso: string;
  nonce: string;
  prevEnvelopeId: string | null;
}): CommunicationMessageSigningPayload {
  if (input.message.messageKind === "plain") {
    return {
      v: 1,
      roomKey: input.roomKey,
      senderPubkey: input.senderPubkey,
      messageKind: "plain",
      text: input.message.text,
      clientTimestamp: input.clientTimestampIso,
      nonce: input.nonce,
      prevEnvelopeId: input.prevEnvelopeId,
    };
  }

  return {
    v: 1,
    roomKey: input.roomKey,
    senderPubkey: input.senderPubkey,
    messageKind: "voice_clip",
    text: input.message.text,
    storageUri: input.message.storageUri,
    durationMs: input.message.durationMs,
    fileSizeBytes: input.message.fileSizeBytes,
    clientTimestamp: input.clientTimestampIso,
    nonce: input.nonce,
    prevEnvelopeId: input.prevEnvelopeId,
  };
}

function validateVoiceClipStorageUri(
  storageUri: string,
): { ok: false; status: number; error: string } | null {
  if (storageUri.length > MAX_STORAGE_URI_LENGTH) {
    return { ok: false, status: 413, error: "storage_uri_too_large" };
  }
  if (/^(livekit|webrtc|voice-session):\/\//i.test(storageUri)) {
    return {
      ok: false,
      status: 400,
      error: "voice_clip_realtime_source_forbidden",
    };
  }
  try {
    const parsed = new URL(storageUri);
    if (!["https:", "ipfs:", "ar:", "s3:"].includes(parsed.protocol)) {
      return { ok: false, status: 400, error: "unsupported_storage_uri" };
    }
  } catch {
    return { ok: false, status: 400, error: "invalid_storage_uri" };
  }
  return null;
}

function mergeVoiceClipMetadata(
  metadata: Record<string, unknown> | null,
  fileSizeBytes: number,
): Record<string, unknown> | null {
  return {
    ...(metadata ?? {}),
    voiceClip: {
      ...(plainObjectOrNull(metadata?.voiceClip) ?? {}),
      fileSizeBytes,
    },
  };
}

function getVoiceClipLimits(): {
  maxDurationMs: number;
  maxFileSizeBytes: number;
} {
  return {
    maxDurationMs: parseBoundedEnvInt(
      "COMMUNICATION_VOICE_CLIP_MAX_DURATION_MS",
      DEFAULT_MAX_VOICE_CLIP_DURATION_MS,
      { min: 1_000, max: 30 * 60 * 1000 },
    ),
    maxFileSizeBytes: parseBoundedEnvInt(
      "COMMUNICATION_VOICE_CLIP_MAX_BYTES",
      DEFAULT_MAX_VOICE_CLIP_BYTES,
      { min: 1_024, max: 250 * 1024 * 1024 },
    ),
  };
}

function parseBoundedEnvInt(
  key: string,
  fallback: number,
  input: { min: number; max: number },
): number {
  const parsed = optionalPositiveInt(process.env[key]);
  if (!parsed) return fallback;
  return Math.max(input.min, Math.min(parsed, input.max));
}

function randomNonce(): string {
  return crypto.randomBytes(16).toString("hex");
}

function randomSessionId(): string {
  if (typeof crypto.randomUUID === "function") {
    return crypto.randomUUID().replace(/-/g, "");
  }
  return crypto.randomBytes(16).toString("hex");
}

function computeCommunicationEnvelopeId(input: {
  roomKey: string;
  senderPubkey: string;
  payloadHash: string;
  clientTimestamp: string;
  nonce: string;
  prevEnvelopeId: string | null;
  signature: string | null;
}): string {
  return `comm_${sha256Hex(stableJsonStringify(input)).slice(0, 48)}`;
}

function sha256Hex(value: string): string {
  return crypto.createHash("sha256").update(value).digest("hex");
}

function stableJsonStringify(value: unknown): string {
  if (value === null || typeof value !== "object") {
    return JSON.stringify(value);
  }
  if (Array.isArray(value)) {
    return `[${value.map((item) => stableJsonStringify(item)).join(",")}]`;
  }

  const record = value as Record<string, unknown>;
  return `{${Object.keys(record)
    .filter((key) => record[key] !== undefined && record[key] !== null)
    .sort()
    .map((key) => `${JSON.stringify(key)}:${stableJsonStringify(record[key])}`)
    .join(",")}}`;
}
