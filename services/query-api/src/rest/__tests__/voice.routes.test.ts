import express from "express";
import request from "supertest";
import { describe, expect, jest, test } from "@jest/globals";

import { loadVoiceRuntimeConfig } from "../../config/voice";
import type { VoiceRuntimeConfig } from "../../config/voice";
import { voiceRouter } from "../voice";

const NOW = new Date("2026-05-08T12:00:00.000Z");
const ROOM_KEY = "external:example-web3-game:dungeon:run-8791";

function buildApp(
  prisma: any,
  provider: any,
  options: {
    unsignedWebhookFixture?: boolean;
    configOverrides?: Partial<VoiceRuntimeConfig>;
  } = {},
) {
  const app = express();
  const baseConfig = options.unsignedWebhookFixture
    ? {
        enabled: true,
        provider: "livekit" as const,
        publicUrl: "wss://voice.example.test",
        livekitServerUrl: "https://voice.example.test",
        livekitApiKey: null,
        livekitApiSecret: null,
        requireProviderHealth: false,
        providerHealthTimeoutMs: 1500,
        defaultTtlSec: 7200,
        tokenTtlSec: 900,
        platformMaxSpeakersPerSession: 100,
        defaultMaxSpeakersPerSession: 16,
        speakerLimitStrategy: "listen_only" as const,
      }
    : loadVoiceRuntimeConfig({
        VOICE_PROVIDER: "livekit",
        VOICE_PUBLIC_URL: "wss://voice.example.test",
        LIVEKIT_API_KEY: "lk-key",
        LIVEKIT_API_SECRET: "lk-secret",
      });
  app.use(express.json());
  app.use(
    "/api/v1/voice",
    voiceRouter(prisma, {} as any, {
      config: { ...baseConfig, ...(options.configOverrides ?? {}) },
      provider,
      now: () => NOW,
    }),
  );
  return app;
}

function buildProviderMock(): any {
  return {
    healthCheck: jest.fn(async () => ({
      provider: "livekit" as const,
      status: "healthy" as const,
      checkedAt: NOW,
      responseStatus: 200,
      error: null,
    })),
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

function buildPrismaMock(
  memberOverrides: Record<string, unknown> = {},
  options: {
    activeSpeakers?: string[];
    initialVoiceSessions?: "default" | "empty" | any[];
    queuedSpeakers?: Array<{ walletPubkey: string; joinedAt: Date }>;
    raceWinnerVoiceSession?: any;
    roomMetadata?: Record<string, unknown> | null;
    sessionScopeRef?: string;
  } = {},
) {
  const sessions = new Map<string, any>();
  const voiceSessions = new Map<string, any>();
  const participants = new Map<string, any>();
  let createCalls = 0;
  const room = {
    roomKey: ROOM_KEY,
    roomType: "dungeon",
    externalAppId: "example-web3-game",
    externalRoomId: "run-8791",
    parentCircleId: null,
    lifecycleStatus: "active",
    expiresAt: null,
    endedAt: null,
    metadata: options.roomMetadata ?? null,
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
    scopeRef: options.sessionScopeRef ?? ROOM_KEY,
    expiresAt: new Date(NOW.getTime() + 60_000),
    revoked: false,
  });
  const defaultVoiceSession = {
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
  };
  const initialVoiceSessions =
    options.initialVoiceSessions === "empty"
      ? []
      : Array.isArray(options.initialVoiceSessions)
        ? options.initialVoiceSessions
        : [defaultVoiceSession];
  for (const session of initialVoiceSessions) {
    voiceSessions.set(session.id, session);
  }
  for (const walletPubkey of options.activeSpeakers ?? []) {
    participants.set(`voice_1:${walletPubkey}`, {
      sessionId: "voice_1",
      walletPubkey,
      role: "speaker",
      joinedAt: NOW,
      leftAt: null,
      mutedByModerator: false,
      mutedBySelf: false,
    });
  }
  for (const queued of options.queuedSpeakers ?? []) {
    participants.set(`voice_1:${queued.walletPubkey}`, {
      sessionId: "voice_1",
      walletPubkey: queued.walletPubkey,
      role: "queued",
      joinedAt: queued.joinedAt,
      leftAt: null,
      mutedByModerator: true,
      mutedBySelf: false,
    });
  }

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
    user: {
      findUnique: jest.fn(async () => null),
    },
    circleMember: {
      findUnique: jest.fn(async () => null),
    },
    voiceSession: {
      create: jest.fn(async ({ data }: any) => {
        createCalls += 1;
        if (createCalls === 1 && options.raceWinnerVoiceSession) {
          voiceSessions.set(
            options.raceWinnerVoiceSession.id,
            options.raceWinnerVoiceSession,
          );
          throw { code: "P2002", meta: { target: ["room_key"] } };
        }
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
      findUnique: jest.fn(async ({ where, include }: any) => {
        const session = voiceSessions.get(where.id) ?? null;
        if (!session || !include?.room) return session;
        return { ...session, room };
      }),
      findFirst: jest.fn(async ({ where, include }: any) => {
        const session = Array.from(voiceSessions.values()).find((candidate) => {
          if (where.roomKey && candidate.roomKey !== where.roomKey) {
            return false;
          }
          if (where.provider && candidate.provider !== where.provider) {
            return false;
          }
          if (
            where.providerRoomId &&
            candidate.providerRoomId !== where.providerRoomId
          ) {
            return false;
          }
          if (where.status?.in && !where.status.in.includes(candidate.status)) {
            return false;
          }
          if (where.status && typeof where.status === "string") {
            if (candidate.status !== where.status) return false;
          }
          if (where.endedAt === null && candidate.endedAt !== null) {
            return false;
          }
          if (where.expiresAt?.gt) {
            if (
              candidate.expiresAt &&
              candidate.expiresAt.getTime() <= where.expiresAt.gt.getTime()
            ) {
              return false;
            }
          }
          return true;
        });
        if (!session || !include?.room) return session ?? null;
        return { ...session, room };
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
          if (where.roomKey && session.roomKey !== where.roomKey) continue;
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
          if (where.status && typeof where.status === "string") {
            if (session.status !== where.status) continue;
          }
          if (where.endedAt === null && session.endedAt !== null) continue;
          if (where.expiresAt?.lte) {
            if (
              !session.expiresAt ||
              session.expiresAt.getTime() > where.expiresAt.lte.getTime()
            ) {
              continue;
            }
          }
          voiceSessions.set(id, { ...session, ...data, updatedAt: NOW });
          count += 1;
        }
        return { count };
      }),
    },
    voiceParticipant: {
      findMany: jest.fn(async ({ where, orderBy, take }: any) => {
        const values = Array.from(participants.values()).filter(
          (participant) => {
            if (where.sessionId && participant.sessionId !== where.sessionId) {
              return false;
            }
            if (where.role && participant.role !== where.role) {
              return false;
            }
            if (where.leftAt === null && participant.leftAt !== null) {
              return false;
            }
            return true;
          },
        );
        if (Array.isArray(orderBy)) {
          values.sort((left, right) => {
            for (const order of orderBy) {
              const key = Object.keys(order)[0];
              const direction = order[key];
              const leftValue = left[key];
              const rightValue = right[key];
              const leftMs =
                leftValue instanceof Date ? leftValue.getTime() : leftValue;
              const rightMs =
                rightValue instanceof Date ? rightValue.getTime() : rightValue;
              if (leftMs === rightMs) continue;
              if (leftMs === null || leftMs === undefined) return 1;
              if (rightMs === null || rightMs === undefined) return -1;
              return direction === "desc"
                ? rightMs > leftMs
                  ? 1
                  : -1
                : leftMs > rightMs
                  ? 1
                  : -1;
            }
            return 0;
          });
        }
        return typeof take === "number" ? values.slice(0, take) : values;
      }),
      findUnique: jest.fn(async ({ where }: any) => {
        const key = `${where.sessionId_walletPubkey.sessionId}:${where.sessionId_walletPubkey.walletPubkey}`;
        return participants.get(key) ?? null;
      }),
      count: jest.fn(async ({ where }: any) => {
        return Array.from(participants.values()).filter((participant) => {
          if (where.sessionId && participant.sessionId !== where.sessionId) {
            return false;
          }
          if (where.role && participant.role !== where.role) {
            return false;
          }
          if (where.leftAt === null && participant.leftAt !== null) {
            return false;
          }
          if (
            typeof where.mutedByModerator === "boolean" &&
            participant.mutedByModerator !== where.mutedByModerator
          ) {
            return false;
          }
          if (
            where.walletPubkey?.not &&
            participant.walletPubkey === where.walletPubkey.not
          ) {
            return false;
          }
          if (
            where.joinedAt?.lt &&
            (!participant.joinedAt ||
              participant.joinedAt.getTime() >= where.joinedAt.lt.getTime())
          ) {
            return false;
          }
          return true;
        }).length;
      }),
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
  test("reports disabled voice provider health", async () => {
    const prisma = buildPrismaMock();
    const response = await request(
      buildApp(prisma, null, {
        configOverrides: {
          enabled: false,
          provider: "disabled",
          publicUrl: null,
          livekitServerUrl: null,
          livekitApiKey: null,
          livekitApiSecret: null,
        },
      }),
    )
      .get("/api/v1/voice/health")
      .expect(200);

    expect(response.body.health).toMatchObject({
      enabled: false,
      provider: "disabled",
      status: "disabled",
      healthy: false,
    });
  });

  test("reports unhealthy LiveKit provider state", async () => {
    const provider = buildProviderMock();
    provider.healthCheck.mockResolvedValueOnce({
      provider: "livekit",
      status: "unhealthy",
      checkedAt: NOW,
      responseStatus: null,
      error: "connect ECONNREFUSED",
    });

    const response = await request(buildApp(buildPrismaMock(), provider))
      .get("/api/v1/voice/health")
      .expect(200);

    expect(response.body.health).toMatchObject({
      enabled: true,
      provider: "livekit",
      status: "unhealthy",
      healthy: false,
      error: "connect ECONNREFUSED",
    });
  });

  test("refuses token issuance when provider health is required and unavailable", async () => {
    const provider = buildProviderMock();
    provider.healthCheck.mockResolvedValueOnce({
      provider: "livekit",
      status: "unhealthy",
      checkedAt: NOW,
      responseStatus: null,
      error: "connect ECONNREFUSED",
    });

    await request(
      buildApp(buildPrismaMock(), provider, {
        configOverrides: { requireProviderHealth: true },
      }),
    )
      .post("/api/v1/voice/sessions/voice_1/token")
      .set("Authorization", "Bearer comm-token")
      .expect(503)
      .expect((response) => {
        expect(response.body.error).toBe("voice_provider_unavailable");
        expect(response.body.health.status).toBe("unhealthy");
      });
    expect(provider.createJoinToken).not.toHaveBeenCalled();
  });

  test("creates a voice session for a member who can join voice", async () => {
    const provider = buildProviderMock();
    const prisma = buildPrismaMock({}, { initialVoiceSessions: "empty" });

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
    expect(response.body.reused).toBe(false);
    expect(prisma.voiceSession.create).toHaveBeenCalled();
  });

  test("reuses the active voice session for the same room", async () => {
    const provider = buildProviderMock();
    const prisma = buildPrismaMock();

    const response = await request(buildApp(prisma, provider))
      .post("/api/v1/voice/sessions")
      .set("Authorization", "Bearer comm-token")
      .send({ roomKey: ROOM_KEY })
      .expect(200);

    expect(response.body).toMatchObject({
      ok: true,
      reused: true,
      session: {
        id: "voice_1",
        roomKey: ROOM_KEY,
        status: "active",
      },
    });
    expect(prisma.voiceSession.create).not.toHaveBeenCalled();
  });

  test("does not reuse an active voice session from another room", async () => {
    const provider = buildProviderMock();
    const prisma = buildPrismaMock(
      {},
      {
        initialVoiceSessions: [
          {
            id: "voice_other_room",
            roomKey: "external:other-game:lobby:1",
            provider: "livekit",
            providerRoomId: "alcheme_voice_other_room",
            status: "active",
            createdByPubkey: "wallet-other",
            startedAt: NOW,
            endedAt: null,
            expiresAt: new Date(NOW.getTime() + 7_200_000),
            metadata: null,
            createdAt: NOW,
            updatedAt: NOW,
          },
        ],
      },
    );

    const response = await request(buildApp(prisma, provider))
      .post("/api/v1/voice/sessions")
      .set("Authorization", "Bearer comm-token")
      .send({ roomKey: ROOM_KEY })
      .expect(201);

    expect(response.body).toMatchObject({
      ok: true,
      reused: false,
      session: {
        roomKey: ROOM_KEY,
      },
    });
    expect(response.body.session.id).not.toBe("voice_other_room");
    expect(prisma.voiceSession.create).toHaveBeenCalled();
  });

  test("ends an expired active session before creating a replacement", async () => {
    const provider = buildProviderMock();
    const prisma = buildPrismaMock(
      {},
      {
        initialVoiceSessions: [
          {
            id: "voice_expired",
            roomKey: ROOM_KEY,
            provider: "livekit",
            providerRoomId: "alcheme_voice_expired",
            status: "active",
            createdByPubkey: "wallet-speaker",
            startedAt: new Date(NOW.getTime() - 7_200_000),
            endedAt: null,
            expiresAt: new Date(NOW.getTime() - 1_000),
            metadata: null,
            createdAt: new Date(NOW.getTime() - 7_200_000),
            updatedAt: new Date(NOW.getTime() - 7_200_000),
          },
        ],
      },
    );

    const response = await request(buildApp(prisma, provider))
      .post("/api/v1/voice/sessions")
      .set("Authorization", "Bearer comm-token")
      .send({ roomKey: ROOM_KEY })
      .expect(201);

    expect(response.body).toMatchObject({
      ok: true,
      reused: false,
      session: {
        roomKey: ROOM_KEY,
        status: "active",
      },
    });
    expect(response.body.session.id).not.toBe("voice_expired");
    expect(prisma.voiceSession.updateMany).toHaveBeenCalledWith(
      expect.objectContaining({
        where: expect.objectContaining({
          roomKey: ROOM_KEY,
          status: "active",
          endedAt: null,
        }),
        data: expect.objectContaining({
          status: "ended",
          endedAt: NOW,
        }),
      }),
    );
    expect(prisma.voiceSession.create).toHaveBeenCalled();
  });

  test("recovers from an active-session create race by reloading the winner", async () => {
    const provider = buildProviderMock();
    const raceWinner = {
      id: "voice_winner",
      roomKey: ROOM_KEY,
      provider: "livekit",
      providerRoomId: "alcheme_voice_winner",
      status: "active",
      createdByPubkey: "wallet-other",
      startedAt: NOW,
      endedAt: null,
      expiresAt: new Date(NOW.getTime() + 7_200_000),
      metadata: null,
      createdAt: NOW,
      updatedAt: NOW,
    };
    const prisma = buildPrismaMock(
      {},
      {
        initialVoiceSessions: "empty",
        raceWinnerVoiceSession: raceWinner,
      },
    );

    const response = await request(buildApp(prisma, provider))
      .post("/api/v1/voice/sessions")
      .set("Authorization", "Bearer comm-token")
      .send({ roomKey: ROOM_KEY })
      .expect(200);

    expect(response.body).toMatchObject({
      ok: true,
      reused: true,
      session: {
        id: "voice_winner",
        roomKey: ROOM_KEY,
      },
    });
    expect(prisma.voiceSession.create).toHaveBeenCalledTimes(1);
  });

  test("returns the active voice session for an authenticated room reader", async () => {
    const provider = buildProviderMock();
    const prisma = buildPrismaMock();

    const response = await request(buildApp(prisma, provider))
      .get(`/api/v1/voice/rooms/${encodeURIComponent(ROOM_KEY)}/active`)
      .set("Authorization", "Bearer comm-token")
      .expect(200);

    expect(response.body).toMatchObject({
      ok: true,
      session: {
        id: "voice_1",
        roomKey: ROOM_KEY,
        status: "active",
      },
    });
  });

  test("returns null when an authenticated room reader has no active voice session", async () => {
    const provider = buildProviderMock();
    const prisma = buildPrismaMock({}, { initialVoiceSessions: "empty" });

    const response = await request(buildApp(prisma, provider))
      .get(`/api/v1/voice/rooms/${encodeURIComponent(ROOM_KEY)}/active`)
      .set("Authorization", "Bearer comm-token")
      .expect(200);

    expect(response.body).toEqual({
      ok: true,
      session: null,
    });
  });

  test("does not expose an active voice session to the wrong communication scope", async () => {
    const provider = buildProviderMock();
    const prisma = buildPrismaMock({}, { sessionScopeRef: "external:other" });

    await request(buildApp(prisma, provider))
      .get(`/api/v1/voice/rooms/${encodeURIComponent(ROOM_KEY)}/active`)
      .set("Authorization", "Bearer comm-token")
      .expect(403)
      .expect((response) => {
        expect(response.body.error).toBe("communication_session_scope_violation");
      });
  });

  test("lets room members read voice participants and queue positions", async () => {
    const provider = buildProviderMock();
    const prisma = buildPrismaMock(
      {},
      {
        activeSpeakers: ["wallet-speaker-a"],
        queuedSpeakers: [
          {
            walletPubkey: "wallet-waiting-first",
            joinedAt: new Date(NOW.getTime() - 30_000),
          },
          {
            walletPubkey: "wallet-waiting-second",
            joinedAt: new Date(NOW.getTime() - 10_000),
          },
        ],
        roomMetadata: {
          voicePolicy: {
            maxSpeakers: 2,
            overflowStrategy: "queue",
            source: "app_room_claim",
          },
        },
      },
    );

    const response = await request(buildApp(prisma, provider))
      .get("/api/v1/voice/sessions/voice_1/participants")
      .set("Authorization", "Bearer comm-token")
      .expect(200);

    expect(response.body).toMatchObject({
      ok: true,
      sessionId: "voice_1",
      policy: {
        maxSpeakers: 2,
        strategy: "queue",
        source: "room_metadata",
      },
      permissions: {
        canModerate: false,
      },
    });
    expect(response.body.participants).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          walletPubkey: "wallet-speaker-a",
          role: "speaker",
          queuePosition: null,
        }),
      ]),
    );
    const queuedParticipants = response.body.participants
      .filter((participant: any) => participant.role === "queued")
      .map((participant: any) => ({
      walletPubkey: participant.walletPubkey,
      role: participant.role,
      queuePosition: participant.queuePosition,
    }));
    expect(queuedParticipants).toEqual([
      {
        walletPubkey: "wallet-waiting-first",
        role: "queued",
        queuePosition: 1,
      },
      {
        walletPubkey: "wallet-waiting-second",
        role: "queued",
        queuePosition: 2,
      },
    ]);
  });

  test("shows voice moderation permission on the participants read surface", async () => {
    const provider = buildProviderMock();
    const prisma = buildPrismaMock({
      walletPubkey: "wallet-moderator",
      role: "moderator",
    });

    const response = await request(buildApp(prisma, provider))
      .get("/api/v1/voice/sessions/voice_1/participants")
      .set("Authorization", "Bearer comm-token")
      .expect(200);

    expect(response.body.permissions).toEqual({ canModerate: true });
  });

  test("does not let non-members read voice participants", async () => {
    const provider = buildProviderMock();
    const prisma = buildPrismaMock({ leftAt: NOW });

    await request(buildApp(prisma, provider))
      .get("/api/v1/voice/sessions/voice_1/participants")
      .set("Authorization", "Bearer comm-token")
      .expect(403)
      .expect((response) => {
        expect(response.body.error).toBe("room_membership_required");
      });
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

  test("uses signed room voice policy to downgrade extra speakers to listen-only", async () => {
    const provider = buildProviderMock();
    const prisma = buildPrismaMock(
      {},
      {
        activeSpeakers: ["wallet-speaker-a", "wallet-speaker-b"],
        roomMetadata: {
          voicePolicy: {
            maxSpeakers: 2,
            overflowStrategy: "listen_only",
            source: "app_room_claim",
          },
        },
      },
    );

    const response = await request(buildApp(prisma, provider))
      .post("/api/v1/voice/sessions/voice_1/token")
      .set("Authorization", "Bearer comm-token")
      .send({})
      .expect(200);

    expect(response.body.token).toMatchObject({
      canPublishAudio: false,
      canSubscribe: true,
    });
    expect(response.body.policy).toMatchObject({
      speakerLimit: {
        reason: "speaker_limit_reached",
        activeSpeakerCount: 2,
        maxSpeakers: 2,
        platformMaxSpeakersPerSession: 100,
        strategy: "listen_only",
        source: "room_metadata",
      },
    });
    expect(provider.createJoinToken).toHaveBeenCalledWith(
      expect.objectContaining({
        canPublishAudio: false,
        canSubscribe: true,
      }),
    );
    expect(prisma.voiceParticipant.upsert).toHaveBeenCalledWith(
      expect.objectContaining({
        update: expect.objectContaining({
          role: "listener",
          mutedByModerator: true,
        }),
      }),
    );
  });

  test("can hard-deny extra speakers when the room policy rejects overflow", async () => {
    const provider = buildProviderMock();
    const prisma = buildPrismaMock(
      {},
      {
        activeSpeakers: ["wallet-speaker-a", "wallet-speaker-b"],
        roomMetadata: {
          voicePolicy: {
            maxSpeakers: 2,
            overflowStrategy: "deny",
            source: "app_room_claim",
          },
        },
      },
    );

    await request(buildApp(prisma, provider))
      .post("/api/v1/voice/sessions/voice_1/token")
      .set("Authorization", "Bearer comm-token")
      .send({})
      .expect(429)
      .expect((response) => {
        expect(response.body).toMatchObject({
          error: "voice_speaker_limit_reached",
          activeSpeakerCount: 2,
          maxSpeakers: 2,
          strategy: "deny",
        });
      });

    expect(provider.createJoinToken).not.toHaveBeenCalled();
  });

  test("falls back to the runtime default speaker policy when a room has no policy", async () => {
    const provider = buildProviderMock();
    const prisma = buildPrismaMock(
      {},
      { activeSpeakers: ["wallet-speaker-a", "wallet-speaker-b"] },
    );

    await request(
      buildApp(prisma, provider, {
        configOverrides: {
          defaultMaxSpeakersPerSession: 2,
          speakerLimitStrategy: "deny",
        },
      }),
    )
      .post("/api/v1/voice/sessions/voice_1/token")
      .set("Authorization", "Bearer comm-token")
      .send({})
      .expect(429)
      .expect((response) => {
        expect(response.body).toMatchObject({
          error: "voice_speaker_limit_reached",
          activeSpeakerCount: 2,
          maxSpeakers: 2,
          strategy: "deny",
        });
      });
  });

  test("keeps overflow speakers in a FIFO queue instead of letting new callers skip ahead", async () => {
    const provider = buildProviderMock();
    const prisma = buildPrismaMock(
      {},
      {
        activeSpeakers: ["wallet-speaker-a"],
        queuedSpeakers: [
          {
            walletPubkey: "wallet-waiting-first",
            joinedAt: new Date(NOW.getTime() - 30_000),
          },
        ],
        roomMetadata: {
          voicePolicy: {
            maxSpeakers: 2,
            overflowStrategy: "queue",
            source: "app_room_claim",
          },
        },
      },
    );

    const response = await request(buildApp(prisma, provider))
      .post("/api/v1/voice/sessions/voice_1/token")
      .set("Authorization", "Bearer comm-token")
      .send({})
      .expect(200);

    expect(response.body.token).toMatchObject({
      canPublishAudio: false,
      canSubscribe: true,
    });
    expect(response.body.policy).toMatchObject({
      speakerLimit: {
        reason: "speaker_queue_waiting",
        activeSpeakerCount: 1,
        maxSpeakers: 2,
        queuePosition: 2,
        strategy: "queue",
      },
    });
    expect(prisma.voiceParticipant.upsert).toHaveBeenCalledWith(
      expect.objectContaining({
        create: expect.objectContaining({
          role: "queued",
          mutedByModerator: true,
        }),
      }),
    );
  });

  test("promotes the first queued speaker when a speaker slot opens", async () => {
    const provider = buildProviderMock();
    const prisma = buildPrismaMock(
      { walletPubkey: "wallet-waiting-first" },
      {
        activeSpeakers: ["wallet-speaker-a"],
        queuedSpeakers: [
          {
            walletPubkey: "wallet-waiting-first",
            joinedAt: new Date(NOW.getTime() - 30_000),
          },
        ],
        roomMetadata: {
          voicePolicy: {
            maxSpeakers: 2,
            overflowStrategy: "queue",
            source: "app_room_claim",
          },
        },
      },
    );

    const response = await request(buildApp(prisma, provider))
      .post("/api/v1/voice/sessions/voice_1/token")
      .set("Authorization", "Bearer comm-token")
      .send({})
      .expect(200);

    expect(response.body.token).toMatchObject({
      canPublishAudio: true,
      canSubscribe: true,
    });
    expect(response.body.policy).toMatchObject({
      speakerLimit: {
        reason: null,
        activeSpeakerCount: 1,
        maxSpeakers: 2,
        queuePosition: null,
        strategy: "queue",
      },
    });
    expect(prisma.voiceParticipant.upsert).toHaveBeenCalledWith(
      expect.objectContaining({
        update: expect.objectContaining({
          role: "speaker",
          mutedByModerator: false,
        }),
      }),
    );
  });

  test("keeps moderated queue callers listen-only until a voice moderator approves", async () => {
    const provider = buildProviderMock();
    const prisma = buildPrismaMock(
      {},
      {
        roomMetadata: {
          voicePolicy: {
            maxSpeakers: 2,
            overflowStrategy: "moderated_queue",
            moderatorRoles: ["host", "moderator"],
            source: "app_room_claim",
          },
        },
      },
    );

    const response = await request(buildApp(prisma, provider))
      .post("/api/v1/voice/sessions/voice_1/token")
      .set("Authorization", "Bearer comm-token")
      .send({})
      .expect(200);

    expect(response.body.token).toMatchObject({
      canPublishAudio: false,
      canSubscribe: true,
    });
    expect(response.body.policy).toMatchObject({
      speakerLimit: {
        reason: "speaker_approval_required",
        activeSpeakerCount: 0,
        maxSpeakers: 2,
        queuePosition: 1,
        strategy: "moderated_queue",
      },
    });
    expect(prisma.voiceParticipant.upsert).toHaveBeenCalledWith(
      expect.objectContaining({
        create: expect.objectContaining({
          role: "queued",
          mutedByModerator: true,
        }),
      }),
    );
  });

  test("allows configured voice moderator roles to approve queued speakers", async () => {
    const provider = buildProviderMock();
    const prisma = buildPrismaMock(
      { walletPubkey: "wallet-host", role: "host" },
      {
        queuedSpeakers: [
          {
            walletPubkey: "wallet-speaker",
            joinedAt: new Date(NOW.getTime() - 30_000),
          },
        ],
        roomMetadata: {
          voicePolicy: {
            maxSpeakers: 2,
            overflowStrategy: "moderated_queue",
            moderatorRoles: ["host", "moderator"],
            source: "app_room_claim",
          },
        },
      },
    );

    const response = await request(buildApp(prisma, provider))
      .post("/api/v1/voice/sessions/voice_1/speakers/wallet-speaker/approve")
      .set("Authorization", "Bearer comm-token")
      .send({})
      .expect(200);

    expect(response.body).toMatchObject({
      ok: true,
      sessionId: "voice_1",
      walletPubkey: "wallet-speaker",
      role: "speaker",
    });
    expect(prisma.voiceParticipant.upsert).toHaveBeenCalledWith(
      expect.objectContaining({
        update: expect.objectContaining({
          role: "speaker",
          mutedByModerator: false,
        }),
      }),
    );
    expect(provider.muteParticipant).toHaveBeenCalledWith({
      providerRoomId: "alcheme_voice_1",
      walletPubkey: "wallet-speaker",
      muted: false,
    });
  });

  test("does not approve a queued speaker when moderated speaker slots are full", async () => {
    const provider = buildProviderMock();
    const prisma = buildPrismaMock(
      { walletPubkey: "wallet-host", role: "host" },
      {
        activeSpeakers: ["wallet-speaker-a", "wallet-speaker-b"],
        queuedSpeakers: [
          {
            walletPubkey: "wallet-speaker",
            joinedAt: new Date(NOW.getTime() - 30_000),
          },
        ],
        roomMetadata: {
          voicePolicy: {
            maxSpeakers: 2,
            overflowStrategy: "moderated_queue",
            moderatorRoles: ["host", "moderator"],
            source: "app_room_claim",
          },
        },
      },
    );

    await request(buildApp(prisma, provider))
      .post("/api/v1/voice/sessions/voice_1/speakers/wallet-speaker/approve")
      .set("Authorization", "Bearer comm-token")
      .send({})
      .expect(409)
      .expect((response) => {
        expect(response.body).toMatchObject({
          error: "voice_speaker_limit_reached",
          activeSpeakerCount: 2,
          maxSpeakers: 2,
          strategy: "moderated_queue",
        });
      });

    expect(provider.muteParticipant).not.toHaveBeenCalled();
  });

  test("allows voice moderators to deny queued speaker requests", async () => {
    const provider = buildProviderMock();
    const prisma = buildPrismaMock(
      { walletPubkey: "wallet-host", role: "host" },
      {
        queuedSpeakers: [
          {
            walletPubkey: "wallet-speaker",
            joinedAt: new Date(NOW.getTime() - 30_000),
          },
        ],
        roomMetadata: {
          voicePolicy: {
            maxSpeakers: 2,
            overflowStrategy: "moderated_queue",
            moderatorRoles: ["host", "moderator"],
            source: "app_room_claim",
          },
        },
      },
    );

    const response = await request(buildApp(prisma, provider))
      .post("/api/v1/voice/sessions/voice_1/speakers/wallet-speaker/deny")
      .set("Authorization", "Bearer comm-token")
      .send({})
      .expect(200);

    expect(response.body).toMatchObject({
      ok: true,
      sessionId: "voice_1",
      walletPubkey: "wallet-speaker",
      role: "listener",
    });
    expect(prisma.voiceParticipant.upsert).toHaveBeenCalledWith(
      expect.objectContaining({
        update: expect.objectContaining({
          role: "listener",
          mutedByModerator: true,
        }),
      }),
    );
    expect(provider.muteParticipant).toHaveBeenCalledWith({
      providerRoomId: "alcheme_voice_1",
      walletPubkey: "wallet-speaker",
      muted: true,
    });
  });

  test("rejects non moderators from approving moderated queue speakers", async () => {
    const provider = buildProviderMock();
    const prisma = buildPrismaMock(
      { role: "member" },
      {
        queuedSpeakers: [
          {
            walletPubkey: "wallet-speaker",
            joinedAt: new Date(NOW.getTime() - 30_000),
          },
        ],
        roomMetadata: {
          voicePolicy: {
            maxSpeakers: 2,
            overflowStrategy: "moderated_queue",
            moderatorRoles: ["host", "moderator"],
            source: "app_room_claim",
          },
        },
      },
    );

    await request(buildApp(prisma, provider))
      .post("/api/v1/voice/sessions/voice_1/speakers/wallet-speaker/approve")
      .set("Authorization", "Bearer comm-token")
      .send({})
      .expect(403)
      .expect((response) => {
        expect(response.body.error).toBe("voice_moderator_permission_required");
      });

    expect(provider.muteParticipant).not.toHaveBeenCalled();
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
    const app = buildApp(prisma, provider, { unsignedWebhookFixture: true });

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

  test("keeps queued participants queued when LiveKit joins them listen-only", async () => {
    const provider = buildProviderMock();
    const prisma = buildPrismaMock(
      {},
      {
        activeSpeakers: ["wallet-speaker-a"],
        queuedSpeakers: [
          {
            walletPubkey: "wallet-waiting-first",
            joinedAt: new Date(NOW.getTime() - 30_000),
          },
        ],
        roomMetadata: {
          voicePolicy: {
            maxSpeakers: 1,
            overflowStrategy: "queue",
            source: "room_metadata",
          },
        },
      },
    );
    const app = buildApp(prisma, provider, { unsignedWebhookFixture: true });

    await request(app)
      .post("/api/v1/voice/providers/livekit/webhook")
      .send({
        event: "participant_joined",
        room: { name: "alcheme_voice_1" },
        participant: {
          identity: "wallet-waiting-first",
          permission: { canPublish: false },
        },
      })
      .expect(202);

    expect(prisma.voiceParticipant.upsert).toHaveBeenCalledWith(
      expect.objectContaining({
        update: expect.objectContaining({
          role: "queued",
          leftAt: null,
          mutedByModerator: true,
        }),
      }),
    );
  });

  test("promotes the first queued speaker when a speaker leaves a queue-mode room", async () => {
    const provider = buildProviderMock();
    const prisma = buildPrismaMock(
      {},
      {
        activeSpeakers: ["wallet-speaker-a"],
        queuedSpeakers: [
          {
            walletPubkey: "wallet-waiting-first",
            joinedAt: new Date(NOW.getTime() - 30_000),
          },
          {
            walletPubkey: "wallet-waiting-second",
            joinedAt: new Date(NOW.getTime() - 10_000),
          },
        ],
        roomMetadata: {
          voicePolicy: {
            maxSpeakers: 1,
            overflowStrategy: "queue",
            source: "room_metadata",
          },
        },
      },
    );
    const app = buildApp(prisma, provider, { unsignedWebhookFixture: true });

    await request(app)
      .post("/api/v1/voice/providers/livekit/webhook")
      .send({
        event: "participant_left",
        room: { name: "alcheme_voice_1" },
        participant: { identity: "wallet-speaker-a" },
      })
      .expect(202);

    expect(provider.muteParticipant).toHaveBeenCalledWith({
      providerRoomId: "alcheme_voice_1",
      walletPubkey: "wallet-waiting-first",
      muted: false,
    });
    expect(provider.muteParticipant.mock.invocationCallOrder[0]).toBeLessThan(
      prisma.voiceParticipant.update.mock.invocationCallOrder[0],
    );
    expect(prisma.voiceParticipant.update).toHaveBeenCalledWith(
      expect.objectContaining({
        where: {
          sessionId_walletPubkey: {
            sessionId: "voice_1",
            walletPubkey: "wallet-waiting-first",
          },
        },
        data: expect.objectContaining({
          role: "speaker",
          mutedByModerator: false,
        }),
      }),
    );
  });

  test("rejects unsigned LiveKit webhooks when provider secrets are configured", async () => {
    const provider = buildProviderMock();
    const prisma = buildPrismaMock();
    const app = buildApp(prisma, provider);

    await request(app)
      .post("/api/v1/voice/providers/livekit/webhook")
      .send({
        event: "room_finished",
        room: { name: "alcheme_voice_1" },
      })
      .expect(401)
      .expect((response) => {
        expect(response.body.error).toBe("invalid_voice_webhook");
      });

    expect(prisma.voiceSession.updateMany).not.toHaveBeenCalled();
  });
});
