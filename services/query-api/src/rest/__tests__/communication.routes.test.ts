import crypto from "crypto";
import { EventEmitter } from "events";

import express from "express";
import request from "supertest";
import {
  afterEach,
  beforeEach,
  describe,
  expect,
  jest,
  test,
} from "@jest/globals";
import bs58 from "bs58";
import nacl from "tweetnacl";

import {
  buildCommunicationMessageSigningMessage,
  buildCommunicationSessionBootstrapMessage,
  communicationRouter,
  computeCommunicationPayloadHash,
} from "../communication";

const NOW = new Date("2026-05-08T12:00:00.000Z");
const WALLET_KEYPAIR = nacl.sign.keyPair();
const WALLET = bs58.encode(Buffer.from(WALLET_KEYPAIR.publicKey));
const ROOM_KEY = "external:example-web3-game:dungeon:run-8791";

function signBase64(message: string, secretKey: Uint8Array): string {
  return Buffer.from(
    nacl.sign.detached(Buffer.from(message), secretKey),
  ).toString("base64");
}

function buildSignedAppClaim(
  payload: Record<string, unknown>,
  keyPair = nacl.sign.keyPair(),
) {
  const encodedPayload = Buffer.from(JSON.stringify(payload)).toString(
    "base64url",
  );
  const signature = Buffer.from(
    nacl.sign.detached(Buffer.from(encodedPayload), keyPair.secretKey),
  ).toString("base64");
  return {
    claim: {
      payload: encodedPayload,
      signature,
    },
    serverPublicKey: bs58.encode(Buffer.from(keyPair.publicKey)),
  };
}

function buildApp(prisma: any, redis: any) {
  const app = express();
  app.use(express.json());
  app.use("/api/v1/communication", communicationRouter(prisma, redis));
  return app;
}

function buildRedisMock() {
  const subscriber = new EventEmitter() as any;
  subscriber.subscribe = jest.fn(async () => 1);
  subscriber.unsubscribe = jest.fn(async () => 1);
  subscriber.quit = jest.fn(async () => undefined);

  return {
    publish: jest.fn(async () => 1),
    duplicate: jest.fn(() => subscriber),
    subscriber,
  };
}

function buildPrismaMock(serverPublicKey: string) {
  const rooms = new Map<string, any>();
  const members = new Map<string, any>();
  const sessions = new Map<string, any>();
  const messages: any[] = [];
  let lamport = 0n;

  const externalApp = {
    id: "example-web3-game",
    status: "active",
    serverPublicKey,
    claimAuthMode: "server_ed25519",
  };

  return {
    circle: {
      findUnique: jest.fn(async () => ({ id: 130 })),
      create: jest.fn(),
    },
    externalApp: {
      findUnique: jest.fn(async () => externalApp),
    },
    communicationRoom: {
      upsert: jest.fn(async ({ where, create, update }: any) => {
        const existing = rooms.get(where.roomKey);
        const next = existing
          ? { ...existing, ...update, updatedAt: NOW }
          : { ...create, createdAt: NOW, updatedAt: NOW };
        rooms.set(where.roomKey, next);
        return next;
      }),
      findUnique: jest.fn(async ({ where, include }: any) => {
        const room = rooms.get(where.roomKey);
        if (!room) return null;
        return include?.externalApp ? { ...room, externalApp } : room;
      }),
      update: jest.fn(async ({ where, data }: any) => {
        const room = rooms.get(where.roomKey);
        if (!room) return null;
        const next = { ...room, ...data, updatedAt: NOW };
        rooms.set(where.roomKey, next);
        return next;
      }),
    },
    communicationRoomMember: {
      findUnique: jest.fn(async ({ where }: any) => {
        return (
          members.get(
            `${where.roomKey_walletPubkey.roomKey}:${where.roomKey_walletPubkey.walletPubkey}`,
          ) ?? null
        );
      }),
      upsert: jest.fn(async ({ where, create, update }: any) => {
        const key = `${where.roomKey_walletPubkey.roomKey}:${where.roomKey_walletPubkey.walletPubkey}`;
        const existing = members.get(key);
        const next = existing
          ? { ...existing, ...update }
          : { ...create, joinedAt: NOW };
        members.set(key, next);
        return next;
      }),
    },
    user: {
      findUnique: jest.fn(async () => null),
    },
    circleMember: {
      findUnique: jest.fn(async () => null),
    },
    communicationSession: {
      create: jest.fn(async ({ data }: any) => {
        const session = {
          ...data,
          issuedAt: NOW,
          revoked: false,
          lastSeenAt: NOW,
          createdAt: NOW,
          updatedAt: NOW,
        };
        sessions.set(session.sessionId, session);
        return session;
      }),
      findUnique: jest.fn(async ({ where }: any) => {
        return sessions.get(where.sessionId) ?? null;
      }),
      update: jest.fn(async ({ where, data }: any) => {
        const session = sessions.get(where.sessionId);
        if (!session) return null;
        const next = { ...session, ...data, updatedAt: NOW };
        sessions.set(where.sessionId, next);
        return next;
      }),
    },
    communicationMessage: {
      create: jest.fn(async ({ data }: any) => {
        lamport += 1n;
        const message = {
          id: lamport,
          ...data,
          lamport,
          deleted: false,
          createdAt: NOW,
          updatedAt: NOW,
        };
        messages.push(message);
        return message;
      }),
      findMany: jest.fn(async ({ where, take }: any) => {
        const afterLamport = where?.lamport?.gt ?? 0n;
        return messages
          .filter((message) => message.roomKey === where.roomKey)
          .filter(
            (message) => !where.deleted || message.deleted === where.deleted,
          )
          .filter((message) => message.lamport > afterLamport)
          .slice(0, take ?? 50);
      }),
      findUnique: jest.fn(async ({ where }: any) => {
        return (
          messages.find((message) => message.envelopeId === where.envelopeId) ??
          null
        );
      }),
      update: jest.fn(async ({ where, data }: any) => {
        const message = messages.find(
          (item) => item.envelopeId === where.envelopeId,
        );
        if (!message) return null;
        Object.assign(message, data, { updatedAt: NOW });
        return message;
      }),
    },
  } as any;
}

describe("communication routes", () => {
  beforeEach(() => {
    jest.useFakeTimers();
    jest.setSystemTime(NOW);
  });

  afterEach(() => {
    jest.useRealTimers();
  });

  test("resolves an external room, writes, reads, and streams messages without creating circles", async () => {
    const appClaim = buildSignedAppClaim({
      externalAppId: "example-web3-game",
      roomType: "dungeon",
      externalRoomId: "run-8791",
      walletPubkeys: [WALLET],
      roles: { [WALLET]: "speaker" },
      expiresAt: "2099-05-08T12:05:00.000Z",
      nonce: "claim-1",
    });
    const prisma = buildPrismaMock(appClaim.serverPublicKey);
    const redis = buildRedisMock();
    const app = buildApp(prisma, redis);

    const resolved = await request(app)
      .post("/api/v1/communication/rooms/resolve")
      .send({
        externalAppId: "example-web3-game",
        roomType: "dungeon",
        externalRoomId: "run-8791",
        parentCircleId: 130,
        ttlSec: 7200,
        walletPubkey: WALLET,
        appRoomClaim: appClaim.claim,
      })
      .expect(201);
    expect(resolved.body.room.roomKey).toBe(ROOM_KEY);

    await request(app)
      .post(
        `/api/v1/communication/rooms/${encodeURIComponent(ROOM_KEY)}/members`,
      )
      .send({
        walletPubkey: WALLET,
        appRoomClaim: appClaim.claim,
      })
      .expect(200);

    const sessionPayload = {
      v: 1 as const,
      action: "communication_session_init" as const,
      walletPubkey: WALLET,
      scopeType: "room" as const,
      scopeRef: ROOM_KEY,
      clientTimestamp: NOW.toISOString(),
      nonce: "session-1",
    };
    const sessionMessage =
      buildCommunicationSessionBootstrapMessage(sessionPayload);
    const session = await request(app)
      .post("/api/v1/communication/sessions")
      .send({
        walletPubkey: WALLET,
        roomKey: ROOM_KEY,
        clientTimestamp: NOW.toISOString(),
        nonce: "session-1",
        signedMessage: sessionMessage,
        signature: signBase64(sessionMessage, WALLET_KEYPAIR.secretKey),
      })
      .expect(201);

    const accessToken = session.body.communicationAccessToken;
    expect(accessToken).toBeTruthy();

    const text = "wait, pulling next pack";
    const messagePayload = {
      v: 1 as const,
      roomKey: ROOM_KEY,
      senderPubkey: WALLET,
      messageKind: "plain" as const,
      text,
      clientTimestamp: NOW.toISOString(),
      nonce: "message-1",
      prevEnvelopeId: null,
    };
    const signedMessage =
      buildCommunicationMessageSigningMessage(messagePayload);
    const posted = await request(app)
      .post(
        `/api/v1/communication/rooms/${encodeURIComponent(ROOM_KEY)}/messages`,
      )
      .set("Authorization", `Bearer ${accessToken}`)
      .send({
        senderPubkey: WALLET,
        text,
        clientTimestamp: NOW.toISOString(),
        nonce: "message-1",
        signedMessage,
      })
      .expect(201);

    expect(posted.body.message).toMatchObject({
      roomKey: ROOM_KEY,
      senderPubkey: WALLET,
      text,
      lamport: 1,
      payloadHash: computeCommunicationPayloadHash({
        roomKey: ROOM_KEY,
        senderPubkey: WALLET,
        messageKind: "plain",
        text,
        metadata: null,
      }),
    });
    expect(redis.publish).toHaveBeenCalledWith(
      `communication:room:${ROOM_KEY}`,
      expect.stringContaining(posted.body.message.envelopeId),
    );

    const listed = await request(app)
      .get(
        `/api/v1/communication/rooms/${encodeURIComponent(ROOM_KEY)}/messages?afterLamport=0`,
      )
      .set("Authorization", `Bearer ${accessToken}`)
      .expect(200);
    expect(listed.body.messages).toHaveLength(1);
    expect(listed.body.messages[0].envelopeId).toBe(
      posted.body.message.envelopeId,
    );

    const streamed = await request(app)
      .get(
        `/api/v1/communication/rooms/${encodeURIComponent(ROOM_KEY)}/stream?afterLamport=0&once=1`,
      )
      .set("Authorization", `Bearer ${accessToken}`)
      .expect(200);
    expect(streamed.headers["content-type"]).toContain("text/event-stream");
    expect(streamed.text).toContain("event: message_created");
    expect(streamed.text).toContain(posted.body.message.envelopeId);
    expect(redis.duplicate).toHaveBeenCalled();
    expect(redis.subscriber.subscribe).toHaveBeenCalledWith(
      `communication:room:${ROOM_KEY}`,
    );

    expect(prisma.circle.create).not.toHaveBeenCalled();
  });

  test("keeps communication payload hashing deterministic", () => {
    const payload = {
      roomKey: ROOM_KEY,
      senderPubkey: WALLET,
      messageKind: "plain",
      text: "hello",
      metadata: { b: 2, a: 1 },
    };

    expect(computeCommunicationPayloadHash(payload)).toBe(
      crypto
        .createHash("sha256")
        .update(
          '{"messageKind":"plain","metadata":{"a":1,"b":2},"roomKey":"' +
            ROOM_KEY +
            '","senderPubkey":"' +
            WALLET +
            '","text":"hello"}',
        )
        .digest("hex"),
    );
  });

  test("rejects stale session bootstrap signatures instead of issuing reusable room tokens", async () => {
    const appClaim = buildSignedAppClaim({
      externalAppId: "example-web3-game",
      roomType: "dungeon",
      externalRoomId: "run-8791",
      walletPubkeys: [WALLET],
      roles: { [WALLET]: "speaker" },
      expiresAt: "2099-05-08T12:05:00.000Z",
      nonce: "claim-1",
    });
    const prisma = buildPrismaMock(appClaim.serverPublicKey);
    const redis = buildRedisMock();
    const app = buildApp(prisma, redis);

    await request(app)
      .post("/api/v1/communication/rooms/resolve")
      .send({
        externalAppId: "example-web3-game",
        roomType: "dungeon",
        externalRoomId: "run-8791",
        parentCircleId: 130,
        walletPubkey: WALLET,
        appRoomClaim: appClaim.claim,
      })
      .expect(201);
    await request(app)
      .post(
        `/api/v1/communication/rooms/${encodeURIComponent(ROOM_KEY)}/members`,
      )
      .send({ walletPubkey: WALLET, appRoomClaim: appClaim.claim })
      .expect(200);

    const staleTimestamp = new Date(
      NOW.getTime() - 16 * 60 * 1000,
    ).toISOString();
    const sessionPayload = {
      v: 1 as const,
      action: "communication_session_init" as const,
      walletPubkey: WALLET,
      scopeType: "room" as const,
      scopeRef: ROOM_KEY,
      clientTimestamp: staleTimestamp,
      nonce: "stale-session-1",
    };
    const sessionMessage =
      buildCommunicationSessionBootstrapMessage(sessionPayload);

    const response = await request(app)
      .post("/api/v1/communication/sessions")
      .send({
        walletPubkey: WALLET,
        roomKey: ROOM_KEY,
        clientTimestamp: staleTimestamp,
        nonce: "stale-session-1",
        signedMessage: sessionMessage,
        signature: signBase64(sessionMessage, WALLET_KEYPAIR.secretKey),
      })
      .expect(401);

    expect(response.body.error).toBe("signed_timestamp_out_of_window");
    expect(prisma.communicationSession.create).not.toHaveBeenCalled();
  });

  test("rejects stale wallet-signed room messages before accepting per-message auth", async () => {
    const appClaim = buildSignedAppClaim({
      externalAppId: "example-web3-game",
      roomType: "dungeon",
      externalRoomId: "run-8791",
      walletPubkeys: [WALLET],
      roles: { [WALLET]: "speaker" },
      expiresAt: "2099-05-08T12:05:00.000Z",
      nonce: "claim-1",
    });
    const prisma = buildPrismaMock(appClaim.serverPublicKey);
    const redis = buildRedisMock();
    const app = buildApp(prisma, redis);

    await request(app)
      .post("/api/v1/communication/rooms/resolve")
      .send({
        externalAppId: "example-web3-game",
        roomType: "dungeon",
        externalRoomId: "run-8791",
        parentCircleId: 130,
        walletPubkey: WALLET,
        appRoomClaim: appClaim.claim,
      })
      .expect(201);
    await request(app)
      .post(
        `/api/v1/communication/rooms/${encodeURIComponent(ROOM_KEY)}/members`,
      )
      .send({ walletPubkey: WALLET, appRoomClaim: appClaim.claim })
      .expect(200);

    const text = "old packet";
    const staleTimestamp = new Date(
      NOW.getTime() - 16 * 60 * 1000,
    ).toISOString();
    const messagePayload = {
      v: 1 as const,
      roomKey: ROOM_KEY,
      senderPubkey: WALLET,
      messageKind: "plain" as const,
      text,
      clientTimestamp: staleTimestamp,
      nonce: "stale-message-1",
      prevEnvelopeId: null,
    };
    const signedMessage =
      buildCommunicationMessageSigningMessage(messagePayload);

    const response = await request(app)
      .post(
        `/api/v1/communication/rooms/${encodeURIComponent(ROOM_KEY)}/messages`,
      )
      .send({
        senderPubkey: WALLET,
        text,
        clientTimestamp: staleTimestamp,
        nonce: "stale-message-1",
        signedMessage,
        signature: signBase64(signedMessage, WALLET_KEYPAIR.secretKey),
      })
      .expect(401);

    expect(response.body.error).toBe("signed_timestamp_out_of_window");
    expect(prisma.communicationMessage.create).not.toHaveBeenCalled();
  });
});
