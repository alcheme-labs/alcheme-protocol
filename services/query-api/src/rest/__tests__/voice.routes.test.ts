import express from "express";
import request from "supertest";
import { describe, expect, jest, test } from "@jest/globals";

import { loadVoiceRuntimeConfig } from "../../config/voice";
import { voiceRouter } from "../voice";

const NOW = new Date("2026-05-08T12:00:00.000Z");
const ROOM_KEY = "external:example-web3-game:dungeon:run-8791";

function buildApp(prisma: any, provider: any) {
  const app = express();
  app.use(express.json());
  app.use(
    "/api/v1/voice",
    voiceRouter(prisma, {} as any, {
      config: loadVoiceRuntimeConfig({
        VOICE_PROVIDER: "livekit",
        VOICE_PUBLIC_URL: "wss://voice.example.test",
        LIVEKIT_API_KEY: "lk-key",
        LIVEKIT_API_SECRET: "lk-secret",
      }),
      provider,
      now: () => NOW,
    }),
  );
  return app;
}

function buildProviderMock() {
  return {
    createJoinToken: jest.fn(async (input: any) => ({
      provider: "livekit",
      url: "wss://voice.example.test",
      token: "voice-token",
      providerRoomId: input.providerRoomId,
      canPublishAudio: input.canPublishAudio,
      canSubscribe: input.canSubscribe,
      expiresAt: new Date(NOW.getTime() + 900_000),
    })),
    muteParticipant: jest.fn(async () => undefined),
    kickParticipant: jest.fn(async () => undefined),
    endSession: jest.fn(async () => undefined),
  };
}

function buildPrismaMock(memberOverrides: Record<string, unknown> = {}) {
  const sessions = new Map<string, any>();
  const voiceSessions = new Map<string, any>();
  const participants = new Map<string, any>();
  const room = {
    roomKey: ROOM_KEY,
    roomType: "dungeon",
    externalAppId: "example-web3-game",
    externalRoomId: "run-8791",
    parentCircleId: null,
    lifecycleStatus: "active",
    expiresAt: null,
    endedAt: null,
  };
  const member = {
    roomKey: ROOM_KEY,
    walletPubkey: "wallet-speaker",
    role: "member",
    canSpeak: true,
    muted: false,
    banned: false,
    leftAt: null,
    ...memberOverrides,
  };
  sessions.set("comm-token", {
    sessionId: "comm-token",
    walletPubkey: member.walletPubkey,
    scopeType: "room",
    scopeRef: ROOM_KEY,
    expiresAt: new Date(NOW.getTime() + 60_000),
    revoked: false,
  });
  voiceSessions.set("voice_1", {
    id: "voice_1",
    roomKey: ROOM_KEY,
    provider: "livekit",
    providerRoomId: "alcheme_voice_1",
    status: "active",
    createdByPubkey: "wallet-speaker",
    startedAt: NOW,
    endedAt: null,
    expiresAt: new Date(NOW.getTime() + 7_200_000),
    metadata: null,
    createdAt: NOW,
    updatedAt: NOW,
  });

  return {
    communicationSession: {
      findUnique: jest.fn(
        async ({ where }: any) => sessions.get(where.sessionId) ?? null,
      ),
      update: jest.fn(async ({ where, data }: any) => {
        const session = sessions.get(where.sessionId);
        const next = { ...session, ...data };
        sessions.set(where.sessionId, next);
        return next;
      }),
    },
    communicationRoom: {
      findUnique: jest.fn(async () => room),
    },
    communicationRoomMember: {
      findUnique: jest.fn(async () => member),
    },
    circleMember: {
      findUnique: jest.fn(async () => null),
    },
    voiceSession: {
      create: jest.fn(async ({ data }: any) => {
        const created = {
          ...data,
          startedAt: NOW,
          endedAt: null,
          createdAt: NOW,
          updatedAt: NOW,
        };
        voiceSessions.set(created.id, created);
        return created;
      }),
      findUnique: jest.fn(
        async ({ where }: any) => voiceSessions.get(where.id) ?? null,
      ),
      findFirst: jest.fn(async ({ where }: any) => {
        return (
          Array.from(voiceSessions.values()).find((session) => {
            if (where.provider && session.provider !== where.provider) {
              return false;
            }
            if (
              where.providerRoomId &&
              session.providerRoomId !== where.providerRoomId
            ) {
              return false;
            }
            if (where.status?.in && !where.status.in.includes(session.status)) {
              return false;
            }
            return true;
          }) ?? null
        );
      }),
      update: jest.fn(async ({ where, data }: any) => {
        const session = voiceSessions.get(where.id);
        const next = { ...session, ...data, updatedAt: NOW };
        voiceSessions.set(where.id, next);
        return next;
      }),
      updateMany: jest.fn(async ({ where, data }: any) => {
        let count = 0;
        for (const [id, session] of voiceSessions.entries()) {
          if (where.provider && session.provider !== where.provider) continue;
          if (
            where.providerRoomId &&
            session.providerRoomId !== where.providerRoomId
          ) {
            continue;
          }
          if (where.status?.not && session.status === where.status.not) {
            continue;
          }
          voiceSessions.set(id, { ...session, ...data, updatedAt: NOW });
          count += 1;
        }
        return { count };
      }),
    },
    voiceParticipant: {
      upsert: jest.fn(async ({ where, create, update }: any) => {
        const key = `${where.sessionId_walletPubkey.sessionId}:${where.sessionId_walletPubkey.walletPubkey}`;
        const existing = participants.get(key);
        const next = existing ? { ...existing, ...update } : create;
        participants.set(key, next);
        return next;
      }),
      update: jest.fn(async ({ where, data }: any) => {
        const key = `${where.sessionId_walletPubkey.sessionId}:${where.sessionId_walletPubkey.walletPubkey}`;
        const existing = participants.get(key);
        if (!existing) {
          throw new Error("VoiceParticipant not found");
        }
        const next = { ...existing, ...data };
        participants.set(key, next);
        return next;
      }),
    },
  } as any;
}

describe("voice routes", () => {
  test("creates a voice session for a member who can join voice", async () => {
    const provider = buildProviderMock();
    const prisma = buildPrismaMock();

    const response = await request(buildApp(prisma, provider))
      .post("/api/v1/voice/sessions")
      .set("Authorization", "Bearer comm-token")
      .send({ roomKey: ROOM_KEY })
      .expect(201);

    expect(response.body.session).toMatchObject({
      roomKey: ROOM_KEY,
      provider: "livekit",
      status: "active",
    });
    expect(prisma.voiceSession.create).toHaveBeenCalled();
  });

  test("denies banned users before issuing provider tokens", async () => {
    const provider = buildProviderMock();
    const prisma = buildPrismaMock({ banned: true });

    await request(buildApp(prisma, provider))
      .post("/api/v1/voice/sessions/voice_1/token")
      .set("Authorization", "Bearer comm-token")
      .send({})
      .expect(403)
      .expect((response) => {
        expect(response.body.error).toBe("member_banned");
      });

    expect(provider.createJoinToken).not.toHaveBeenCalled();
  });

  test("issues subscribe-only tokens for muted users", async () => {
    const provider = buildProviderMock();
    const prisma = buildPrismaMock({ muted: true });

    const response = await request(buildApp(prisma, provider))
      .post("/api/v1/voice/sessions/voice_1/token")
      .set("Authorization", "Bearer comm-token")
      .send({})
      .expect(200);

    expect(response.body.token).toMatchObject({
      canPublishAudio: false,
      canSubscribe: true,
    });
    expect(provider.createJoinToken).toHaveBeenCalledWith(
      expect.objectContaining({
        canPublishAudio: false,
        canSubscribe: true,
      }),
    );
  });

  test("lets room moderators mute and end voice sessions", async () => {
    const provider = buildProviderMock();
    const prisma = buildPrismaMock({
      walletPubkey: "wallet-moderator",
      role: "moderator",
    });

    await request(buildApp(prisma, provider))
      .post("/api/v1/voice/sessions/voice_1/mute")
      .set("Authorization", "Bearer comm-token")
      .send({ walletPubkey: "wallet-speaker", muted: true })
      .expect(200);
    await request(buildApp(prisma, provider))
      .post("/api/v1/voice/sessions/voice_1/end")
      .set("Authorization", "Bearer comm-token")
      .send({})
      .expect(200);

    expect(provider.muteParticipant).toHaveBeenCalledWith({
      providerRoomId: "alcheme_voice_1",
      walletPubkey: "wallet-speaker",
      muted: true,
    });
    expect(provider.endSession).toHaveBeenCalledWith({
      providerRoomId: "alcheme_voice_1",
    });
    expect(prisma.voiceSession.update).toHaveBeenCalledWith(
      expect.objectContaining({
        where: { id: "voice_1" },
        data: expect.objectContaining({ status: "ended" }),
      }),
    );
  });

  test("syncs LiveKit webhook participant and room lifecycle into local voice state", async () => {
    const provider = buildProviderMock();
    const prisma = buildPrismaMock();
    const app = buildApp(prisma, provider);

    await request(app)
      .post("/api/v1/voice/providers/livekit/webhook")
      .send({
        event: "participant_joined",
        room: { name: "alcheme_voice_1" },
        participant: {
          identity: "wallet-listener",
          permission: { canPublish: false },
        },
      })
      .expect(202);
    await request(app)
      .post("/api/v1/voice/providers/livekit/webhook")
      .send({
        event: "participant_left",
        room: { name: "alcheme_voice_1" },
        participant: { identity: "wallet-listener" },
      })
      .expect(202);
    await request(app)
      .post("/api/v1/voice/providers/livekit/webhook")
      .send({
        event: "room_finished",
        room: { name: "alcheme_voice_1" },
      })
      .expect(202);

    expect(prisma.voiceParticipant.upsert).toHaveBeenNthCalledWith(
      1,
      expect.objectContaining({
        create: expect.objectContaining({
          sessionId: "voice_1",
          walletPubkey: "wallet-listener",
          role: "listener",
          mutedByModerator: true,
        }),
      }),
    );
    expect(prisma.voiceParticipant.upsert).toHaveBeenNthCalledWith(
      2,
      expect.objectContaining({
        update: expect.objectContaining({ leftAt: NOW }),
      }),
    );
    expect(prisma.voiceSession.updateMany).toHaveBeenCalledWith(
      expect.objectContaining({
        where: expect.objectContaining({
          provider: "livekit",
          providerRoomId: "alcheme_voice_1",
        }),
        data: expect.objectContaining({ status: "ended", endedAt: NOW }),
      }),
    );
  });
});
