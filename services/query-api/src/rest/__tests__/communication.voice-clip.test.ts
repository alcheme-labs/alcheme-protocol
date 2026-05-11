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

import {
  buildCommunicationMessageSigningMessage,
  communicationRouter,
  computeCommunicationPayloadHash,
} from "../communication";

const NOW = new Date("2026-05-08T12:00:00.000Z");
const WALLET = "wallet-voice-clip-111";
const ROOM_KEY = "external:example-web3-game:dungeon:run-8791";
const STORAGE_URI = "https://cdn.example.test/clips/clip-1.webm";

function buildApp(prisma: any, redis: any) {
  const app = express();
  app.use(express.json());
  app.use("/api/v1/communication", communicationRouter(prisma, redis));
  return app;
}

function buildRedisMock() {
  return {
    publish: jest.fn(async () => 1),
    duplicate: jest.fn(() => ({
      subscribe: jest.fn(async () => 1),
      unsubscribe: jest.fn(async () => 1),
      quit: jest.fn(async () => undefined),
      on: jest.fn(),
      off: jest.fn(),
    })),
  };
}

function buildPrismaMock() {
  const messages: any[] = [];
  let lamport = 0n;
  const room = {
    id: ROOM_KEY,
    roomKey: ROOM_KEY,
    roomType: "dungeon",
    externalAppId: "example-web3-game",
    externalRoomId: "run-8791",
    parentCircleId: null,
    lifecycleStatus: "active",
    knowledgeMode: "off",
    transcriptionMode: "off",
    retentionPolicy: "ephemeral",
    createdByPubkey: WALLET,
    expiresAt: null,
    endedAt: null,
    metadata: null,
    createdAt: NOW,
    updatedAt: NOW,
    externalApp: null,
  };
  const member = {
    roomKey: ROOM_KEY,
    walletPubkey: WALLET,
    role: "speaker",
    canSpeak: true,
    muted: false,
    banned: false,
    joinedAt: NOW,
    leftAt: null,
  };
  const session = {
    sessionId: "comm-token",
    walletPubkey: WALLET,
    scopeType: "room",
    scopeRef: ROOM_KEY,
    expiresAt: new Date("2099-05-08T12:00:00.000Z"),
    revoked: false,
    createdAt: NOW,
    updatedAt: NOW,
  };

  return {
    communicationRoom: {
      findUnique: jest.fn(async () => room),
    },
    communicationRoomMember: {
      findUnique: jest.fn(async () => member),
      upsert: jest.fn(),
    },
    user: {
      findUnique: jest.fn(async () => null),
    },
    circleMember: {
      findUnique: jest.fn(async () => null),
    },
    communicationSession: {
      findUnique: jest.fn(async () => session),
      update: jest.fn(async () => ({ ...session, lastSeenAt: NOW })),
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
      findUnique: jest.fn(async () => null),
      update: jest.fn(),
      findMany: jest.fn(async () => messages),
    },
  } as any;
}

function voiceClipSignedMessage(input: {
  durationMs?: number;
  fileSizeBytes: number;
  storageUri?: string;
  text?: string | null;
}) {
  return buildCommunicationMessageSigningMessage({
    v: 1,
    roomKey: ROOM_KEY,
    senderPubkey: WALLET,
    messageKind: "voice_clip",
    text: input.text ?? null,
    storageUri: input.storageUri ?? STORAGE_URI,
    durationMs: input.durationMs ?? 4200,
    fileSizeBytes: input.fileSizeBytes,
    clientTimestamp: NOW.toISOString(),
    nonce: "clip-1",
    prevEnvelopeId: null,
  });
}

describe("communication voice clip messages", () => {
  beforeEach(() => {
    jest.useFakeTimers();
    jest.setSystemTime(NOW);
  });

  afterEach(() => {
    jest.useRealTimers();
  });

  test("stores a voice clip as a communication message without reusing live voice sessions", async () => {
    const prisma = buildPrismaMock();
    const redis = buildRedisMock();
    const app = buildApp(prisma, redis);
    const signedMessage = voiceClipSignedMessage({
      text: "fallback caption",
      fileSizeBytes: 8192,
    });

    const response = await request(app)
      .post(
        `/api/v1/communication/rooms/${encodeURIComponent(ROOM_KEY)}/messages`,
      )
      .set("Authorization", "Bearer comm-token")
      .send({
        senderPubkey: WALLET,
        messageKind: "voice_clip",
        storageUri: STORAGE_URI,
        durationMs: 4200,
        fileSizeBytes: 8192,
        payloadText: "fallback caption",
        clientTimestamp: NOW.toISOString(),
        nonce: "clip-1",
        signedMessage,
      })
      .expect(201);

    expect(response.body.message).toMatchObject({
      roomKey: ROOM_KEY,
      senderPubkey: WALLET,
      messageKind: "voice_clip",
      text: "fallback caption",
      storageUri: STORAGE_URI,
      durationMs: 4200,
      payloadHash: computeCommunicationPayloadHash({
        roomKey: ROOM_KEY,
        senderPubkey: WALLET,
        messageKind: "voice_clip",
        text: "fallback caption",
        storageUri: STORAGE_URI,
        durationMs: 4200,
        metadata: {
          voiceClip: {
            fileSizeBytes: 8192,
          },
        },
      }),
    });
    expect(redis.publish).toHaveBeenCalledWith(
      `communication:room:${ROOM_KEY}`,
      expect.stringContaining("voice_clip"),
    );
  });

  test("rejects realtime provider URIs for voice clip messages", async () => {
    const app = buildApp(buildPrismaMock(), buildRedisMock());

    await request(app)
      .post(
        `/api/v1/communication/rooms/${encodeURIComponent(ROOM_KEY)}/messages`,
      )
      .set("Authorization", "Bearer comm-token")
      .send({
        senderPubkey: WALLET,
        messageKind: "voice_clip",
        storageUri: "livekit://room/session-track",
        durationMs: 4200,
        clientTimestamp: NOW.toISOString(),
        nonce: "clip-1",
      })
      .expect(400)
      .expect((response) => {
        expect(response.body.error).toBe(
          "voice_clip_realtime_source_forbidden",
        );
      });
  });

  test("requires file size for voice clip messages", async () => {
    const app = buildApp(buildPrismaMock(), buildRedisMock());

    await request(app)
      .post(
        `/api/v1/communication/rooms/${encodeURIComponent(ROOM_KEY)}/messages`,
      )
      .set("Authorization", "Bearer comm-token")
      .send({
        senderPubkey: WALLET,
        messageKind: "voice_clip",
        storageUri: STORAGE_URI,
        durationMs: 4200,
        clientTimestamp: NOW.toISOString(),
        nonce: "clip-1",
        signedMessage: "not-checked-before-validation",
      })
      .expect(400)
      .expect((response) => {
        expect(response.body.error).toBe("missing_file_size_bytes");
      });
  });

  test("enforces configured voice clip duration and file size limits", async () => {
    const originalDuration =
      process.env.COMMUNICATION_VOICE_CLIP_MAX_DURATION_MS;
    const originalBytes = process.env.COMMUNICATION_VOICE_CLIP_MAX_BYTES;
    process.env.COMMUNICATION_VOICE_CLIP_MAX_DURATION_MS = "1000";
    process.env.COMMUNICATION_VOICE_CLIP_MAX_BYTES = "1024";
    try {
      const app = buildApp(buildPrismaMock(), buildRedisMock());

      await request(app)
        .post(
          `/api/v1/communication/rooms/${encodeURIComponent(ROOM_KEY)}/messages`,
        )
        .set("Authorization", "Bearer comm-token")
        .send({
          senderPubkey: WALLET,
          messageKind: "voice_clip",
          storageUri: STORAGE_URI,
          durationMs: 1001,
          fileSizeBytes: 512,
          clientTimestamp: NOW.toISOString(),
          nonce: "clip-1",
        })
        .expect(413)
        .expect((response) => {
          expect(response.body.error).toBe("voice_clip_duration_too_large");
        });

      await request(app)
        .post(
          `/api/v1/communication/rooms/${encodeURIComponent(ROOM_KEY)}/messages`,
        )
        .set("Authorization", "Bearer comm-token")
        .send({
          senderPubkey: WALLET,
          messageKind: "voice_clip",
          storageUri: STORAGE_URI,
          durationMs: 1000,
          fileSizeBytes: 1025,
          clientTimestamp: NOW.toISOString(),
          nonce: "clip-2",
        })
        .expect(413)
        .expect((response) => {
          expect(response.body.error).toBe("voice_clip_file_too_large");
        });
    } finally {
      if (originalDuration === undefined) {
        delete process.env.COMMUNICATION_VOICE_CLIP_MAX_DURATION_MS;
      } else {
        process.env.COMMUNICATION_VOICE_CLIP_MAX_DURATION_MS = originalDuration;
      }
      if (originalBytes === undefined) {
        delete process.env.COMMUNICATION_VOICE_CLIP_MAX_BYTES;
      } else {
        process.env.COMMUNICATION_VOICE_CLIP_MAX_BYTES = originalBytes;
      }
    }
  });
});
