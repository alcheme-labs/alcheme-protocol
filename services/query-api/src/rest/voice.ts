import crypto from "crypto";

import { Router, raw } from "express";
import type { Prisma, PrismaClient } from "@prisma/client";
import type { Redis } from "ioredis";
import { WebhookReceiver } from "livekit-server-sdk";

import {
  loadVoiceRuntimeConfig,
  normalizeVoiceSpeakerPolicy,
  type VoiceRuntimeConfig,
  type VoiceSpeakerLimitStrategy,
  type VoiceSpeakerPolicy,
} from "../config/voice";
import {
  canJoinVoice,
  canModerateRoom,
  canReadRoom,
  type CommunicationPermissionDecision,
} from "../services/communication/permissions";
import { createLiveKitVoiceProvider } from "../services/voice/livekitProvider";
import type { VoiceProvider } from "../services/voice/provider";

type VoicePrisma = PrismaClient;

interface VoiceRouterOptions {
  config?: VoiceRuntimeConfig;
  provider?: VoiceProvider;
  now?: () => Date;
}

interface CommunicationSessionRow {
  sessionId: string;
  walletPubkey: string;
  scopeType: string;
  scopeRef: string;
  expiresAt: Date;
  revoked: boolean;
}

interface VoiceSessionRow {
  id: string;
  roomKey: string;
  provider: string;
  providerRoomId: string;
  status: string;
  createdByPubkey: string;
  startedAt: Date;
  endedAt?: Date | null;
  expiresAt?: Date | null;
  metadata?: unknown;
  room?: {
    metadata?: unknown;
  } | null;
  createdAt: Date;
  updatedAt: Date;
}

interface VoiceParticipantRow {
  sessionId: string;
  walletPubkey: string;
  role: string;
  joinedAt?: Date | null;
  leftAt?: Date | null;
  mutedByModerator?: boolean | null;
}

interface SpeakerLimitDecision {
  canPublishAudio: boolean;
  activeSpeakerCount: number | null;
  maxSpeakers: number;
  platformMaxSpeakersPerSession: number;
  reason:
    | "speaker_limit_reached"
    | "speaker_queue_waiting"
    | "speaker_approval_required"
    | null;
  queuePosition: number | null;
  role: "speaker" | "listener" | "queued";
  strategy: VoiceSpeakerLimitStrategy;
  source: VoiceSpeakerPolicy["source"];
}

export function voiceRouter(
  prisma: VoicePrisma,
  _redis: Redis,
  options: VoiceRouterOptions = {},
): Router {
  const router = Router();
  const config = options.config ?? loadVoiceRuntimeConfig();
  const now = options.now ?? (() => new Date());
  const provider =
    options.provider ??
    (config.enabled ? createLiveKitVoiceProvider(config) : null);

  router.post("/sessions", async (req, res, next) => {
    try {
      if (!provider || !config.enabled) {
        return res.status(503).json({ error: "voice_provider_disabled" });
      }
      const roomKey = stringOrUndefined(req.body?.roomKey);
      if (!roomKey) return res.status(400).json({ error: "missing_room_key" });

      const sessionAuth = await authenticateCommunicationSession(
        prisma,
        req,
        roomKey,
        now(),
      );
      if (!sessionAuth.ok) return sendSessionError(res, sessionAuth);

      const decision = await canJoinVoice(prisma, {
        roomKey,
        walletPubkey: sessionAuth.session.walletPubkey,
      });
      if (!decision.allowed) return sendPermissionDecision(res, decision);

      const voiceSessionId = `voice_${randomId()}`;
      const providerRoomId = `alcheme_${voiceSessionId}`;
      const ttlSec =
        optionalPositiveInt(req.body?.ttlSec) ?? config.defaultTtlSec;
      const expiresAt = new Date(now().getTime() + ttlSec * 1000);
      const voiceSession = await prisma.voiceSession.create({
        data: {
          id: voiceSessionId,
          roomKey,
          provider: config.provider,
          providerRoomId,
          status: "active",
          createdByPubkey: sessionAuth.session.walletPubkey,
          expiresAt,
          metadata: jsonObjectOrUndefined(req.body?.metadata),
        },
      });

      res.status(201).json({
        ok: true,
        session: mapVoiceSession(voiceSession),
      });
    } catch (error) {
      next(error);
    }
  });

  router.post("/sessions/:sessionId/token", async (req, res, next) => {
    try {
      if (!provider || !config.enabled) {
        return res.status(503).json({ error: "voice_provider_disabled" });
      }
      const voiceSession = await loadActiveVoiceSession(
        prisma,
        parseRouteValue(req.params.sessionId),
        now(),
      );
      if (!voiceSession) {
        return res.status(404).json({ error: "voice_session_not_found" });
      }

      const sessionAuth = await authenticateCommunicationSession(
        prisma,
        req,
        voiceSession.roomKey,
        now(),
      );
      if (!sessionAuth.ok) return sendSessionError(res, sessionAuth);

      const readDecision = await canReadRoom(prisma, {
        roomKey: voiceSession.roomKey,
        walletPubkey: sessionAuth.session.walletPubkey,
      });
      if (!readDecision.allowed)
        return sendPermissionDecision(res, readDecision);

      const joinDecision = await canJoinVoice(prisma, {
        roomKey: voiceSession.roomKey,
        walletPubkey: sessionAuth.session.walletPubkey,
      });
      const requestedCanPublishAudio = joinDecision.allowed;
      if (
        !joinDecision.allowed &&
        joinDecision.reason !== "member_muted" &&
        joinDecision.reason !== "member_voice_disabled"
      ) {
        return sendPermissionDecision(res, joinDecision);
      }
      const speakerLimit = await evaluateSpeakerLimit(
        prisma,
        voiceSession,
        sessionAuth.session.walletPubkey,
        requestedCanPublishAudio,
        config,
        now(),
      );
      if (
        speakerLimit.reason === "speaker_limit_reached" &&
        speakerLimit.strategy === "deny"
      ) {
        return res.status(429).json({
          error: "voice_speaker_limit_reached",
          activeSpeakerCount: speakerLimit.activeSpeakerCount,
          maxSpeakers: speakerLimit.maxSpeakers,
          platformMaxSpeakersPerSession:
            speakerLimit.platformMaxSpeakersPerSession,
          strategy: speakerLimit.strategy,
        });
      }
      const canPublishAudio = speakerLimit.canPublishAudio;

      await prisma.voiceParticipant.upsert({
        where: {
          sessionId_walletPubkey: {
            sessionId: voiceSession.id,
            walletPubkey: sessionAuth.session.walletPubkey,
          },
        },
        create: {
          sessionId: voiceSession.id,
          walletPubkey: sessionAuth.session.walletPubkey,
          role: speakerLimit.role,
          joinedAt: now(),
          mutedByModerator: !canPublishAudio,
        },
        update: {
          role: speakerLimit.role,
          leftAt: null,
          mutedByModerator: !canPublishAudio,
        },
      });

      const token = await provider.createJoinToken({
        voiceSessionId: voiceSession.id,
        providerRoomId: voiceSession.providerRoomId,
        roomKey: voiceSession.roomKey,
        walletPubkey: sessionAuth.session.walletPubkey,
        canPublishAudio,
        canSubscribe: true,
        ttlSec: config.tokenTtlSec,
      });

      res.json({
        ok: true,
        token,
        policy: {
          permission: joinDecision.reason,
          speakerLimit: {
            reason: speakerLimit.reason,
            activeSpeakerCount: speakerLimit.activeSpeakerCount,
            maxSpeakers: speakerLimit.maxSpeakers,
            platformMaxSpeakersPerSession:
              speakerLimit.platformMaxSpeakersPerSession,
            strategy: speakerLimit.strategy,
            source: speakerLimit.source,
            queuePosition: speakerLimit.queuePosition,
          },
        },
      });
    } catch (error) {
      next(error);
    }
  });

  router.post(
    "/sessions/:sessionId/speakers/:walletPubkey/approve",
    async (req, res, next) => {
      try {
        if (!provider || !config.enabled) {
          return res.status(503).json({ error: "voice_provider_disabled" });
        }
        const voiceSession = await loadActiveVoiceSession(
          prisma,
          parseRouteValue(req.params.sessionId),
          now(),
        );
        if (!voiceSession) {
          return res.status(404).json({ error: "voice_session_not_found" });
        }
        const sessionAuth = await authenticateCommunicationSession(
          prisma,
          req,
          voiceSession.roomKey,
          now(),
        );
        if (!sessionAuth.ok) return sendSessionError(res, sessionAuth);

        const policy = resolveVoiceSpeakerPolicy(voiceSession, config);
        const canModerate = await canModerateVoiceSession(prisma, {
          roomKey: voiceSession.roomKey,
          walletPubkey: sessionAuth.session.walletPubkey,
          policy,
        });
        if (!canModerate) {
          return res
            .status(403)
            .json({ error: "voice_moderator_permission_required" });
        }

        const walletPubkey = parseRouteValue(req.params.walletPubkey);
        if (!walletPubkey) {
          return res.status(400).json({ error: "missing_wallet_pubkey" });
        }
        const activeSpeakerCount = await prisma.voiceParticipant.count({
          where: {
            sessionId: voiceSession.id,
            role: "speaker",
            leftAt: null,
            mutedByModerator: false,
            walletPubkey: { not: walletPubkey },
          },
        });
        if (activeSpeakerCount >= policy.maxSpeakers) {
          return res.status(409).json({
            error: "voice_speaker_limit_reached",
            activeSpeakerCount,
            maxSpeakers: policy.maxSpeakers,
            strategy: policy.overflowStrategy,
          });
        }

        await prisma.voiceParticipant.upsert({
          where: {
            sessionId_walletPubkey: {
              sessionId: voiceSession.id,
              walletPubkey,
            },
          },
          create: {
            sessionId: voiceSession.id,
            walletPubkey,
            role: "speaker",
            joinedAt: now(),
            leftAt: null,
            mutedBySelf: false,
            mutedByModerator: false,
          },
          update: {
            role: "speaker",
            leftAt: null,
            mutedByModerator: false,
          },
        });
        await provider.muteParticipant({
          providerRoomId: voiceSession.providerRoomId,
          walletPubkey,
          muted: false,
        });

        res.json({
          ok: true,
          sessionId: voiceSession.id,
          walletPubkey,
          role: "speaker",
          activeSpeakerCount: activeSpeakerCount + 1,
          maxSpeakers: policy.maxSpeakers,
        });
      } catch (error) {
        next(error);
      }
    },
  );

  router.post(
    "/sessions/:sessionId/speakers/:walletPubkey/deny",
    async (req, res, next) => {
      try {
        if (!provider || !config.enabled) {
          return res.status(503).json({ error: "voice_provider_disabled" });
        }
        const voiceSession = await loadActiveVoiceSession(
          prisma,
          parseRouteValue(req.params.sessionId),
          now(),
        );
        if (!voiceSession) {
          return res.status(404).json({ error: "voice_session_not_found" });
        }
        const sessionAuth = await authenticateCommunicationSession(
          prisma,
          req,
          voiceSession.roomKey,
          now(),
        );
        if (!sessionAuth.ok) return sendSessionError(res, sessionAuth);

        const policy = resolveVoiceSpeakerPolicy(voiceSession, config);
        const canModerate = await canModerateVoiceSession(prisma, {
          roomKey: voiceSession.roomKey,
          walletPubkey: sessionAuth.session.walletPubkey,
          policy,
        });
        if (!canModerate) {
          return res
            .status(403)
            .json({ error: "voice_moderator_permission_required" });
        }

        const walletPubkey = parseRouteValue(req.params.walletPubkey);
        if (!walletPubkey) {
          return res.status(400).json({ error: "missing_wallet_pubkey" });
        }
        await prisma.voiceParticipant.upsert({
          where: {
            sessionId_walletPubkey: {
              sessionId: voiceSession.id,
              walletPubkey,
            },
          },
          create: {
            sessionId: voiceSession.id,
            walletPubkey,
            role: "listener",
            joinedAt: null,
            leftAt: null,
            mutedBySelf: false,
            mutedByModerator: true,
          },
          update: {
            role: "listener",
            mutedByModerator: true,
          },
        });
        await provider.muteParticipant({
          providerRoomId: voiceSession.providerRoomId,
          walletPubkey,
          muted: true,
        });

        res.json({
          ok: true,
          sessionId: voiceSession.id,
          walletPubkey,
          role: "listener",
        });
      } catch (error) {
        next(error);
      }
    },
  );

  router.post("/sessions/:sessionId/mute", async (req, res, next) => {
    try {
      if (!provider || !config.enabled) {
        return res.status(503).json({ error: "voice_provider_disabled" });
      }
      const voiceSession = await loadActiveVoiceSession(
        prisma,
        parseRouteValue(req.params.sessionId),
        now(),
      );
      if (!voiceSession) {
        return res.status(404).json({ error: "voice_session_not_found" });
      }
      const sessionAuth = await authenticateCommunicationSession(
        prisma,
        req,
        voiceSession.roomKey,
        now(),
      );
      if (!sessionAuth.ok) return sendSessionError(res, sessionAuth);

      const decision = await canModerateRoom(prisma, {
        roomKey: voiceSession.roomKey,
        walletPubkey: sessionAuth.session.walletPubkey,
      });
      if (!decision.allowed) return sendPermissionDecision(res, decision);

      const walletPubkey = stringOrUndefined(req.body?.walletPubkey);
      if (!walletPubkey) {
        return res.status(400).json({ error: "missing_wallet_pubkey" });
      }
      const muted = req.body?.muted !== false;
      await prisma.voiceParticipant.upsert({
        where: {
          sessionId_walletPubkey: {
            sessionId: voiceSession.id,
            walletPubkey,
          },
        },
        create: {
          sessionId: voiceSession.id,
          walletPubkey,
          role: "speaker",
          joinedAt: null,
          leftAt: null,
          mutedBySelf: false,
          mutedByModerator: muted,
        },
        update: {
          mutedByModerator: muted,
        },
      });
      await provider.muteParticipant({
        providerRoomId: voiceSession.providerRoomId,
        walletPubkey,
        muted,
      });

      res.json({ ok: true, sessionId: voiceSession.id, walletPubkey, muted });
    } catch (error) {
      next(error);
    }
  });

  router.post("/sessions/:sessionId/kick", async (req, res, next) => {
    try {
      if (!provider || !config.enabled) {
        return res.status(503).json({ error: "voice_provider_disabled" });
      }
      const voiceSession = await loadActiveVoiceSession(
        prisma,
        parseRouteValue(req.params.sessionId),
        now(),
      );
      if (!voiceSession) {
        return res.status(404).json({ error: "voice_session_not_found" });
      }
      const sessionAuth = await authenticateCommunicationSession(
        prisma,
        req,
        voiceSession.roomKey,
        now(),
      );
      if (!sessionAuth.ok) return sendSessionError(res, sessionAuth);

      const decision = await canModerateRoom(prisma, {
        roomKey: voiceSession.roomKey,
        walletPubkey: sessionAuth.session.walletPubkey,
      });
      if (!decision.allowed) return sendPermissionDecision(res, decision);

      const walletPubkey = stringOrUndefined(req.body?.walletPubkey);
      if (!walletPubkey) {
        return res.status(400).json({ error: "missing_wallet_pubkey" });
      }
      const leftAt = now();
      await prisma.voiceParticipant.upsert({
        where: {
          sessionId_walletPubkey: {
            sessionId: voiceSession.id,
            walletPubkey,
          },
        },
        create: {
          sessionId: voiceSession.id,
          walletPubkey,
          role: "speaker",
          joinedAt: null,
          leftAt,
          mutedBySelf: false,
          mutedByModerator: false,
        },
        update: {
          leftAt,
        },
      });
      await provider.kickParticipant({
        providerRoomId: voiceSession.providerRoomId,
        walletPubkey,
      });

      res.json({ ok: true, sessionId: voiceSession.id, walletPubkey });
    } catch (error) {
      next(error);
    }
  });

  router.post("/sessions/:sessionId/end", async (req, res, next) => {
    try {
      if (!provider || !config.enabled) {
        return res.status(503).json({ error: "voice_provider_disabled" });
      }
      const voiceSession = await loadActiveVoiceSession(
        prisma,
        parseRouteValue(req.params.sessionId),
        now(),
      );
      if (!voiceSession) {
        return res.status(404).json({ error: "voice_session_not_found" });
      }
      const sessionAuth = await authenticateCommunicationSession(
        prisma,
        req,
        voiceSession.roomKey,
        now(),
      );
      if (!sessionAuth.ok) return sendSessionError(res, sessionAuth);

      const decision = await canModerateRoom(prisma, {
        roomKey: voiceSession.roomKey,
        walletPubkey: sessionAuth.session.walletPubkey,
      });
      if (!decision.allowed) return sendPermissionDecision(res, decision);

      const ended = await prisma.voiceSession.update({
        where: { id: voiceSession.id },
        data: {
          status: "ended",
          endedAt: now(),
        },
      });
      await provider.endSession({
        providerRoomId: voiceSession.providerRoomId,
      });

      res.json({ ok: true, session: mapVoiceSession(ended) });
    } catch (error) {
      next(error);
    }
  });

  router.post(
    "/providers/livekit/webhook",
    raw({ type: "application/webhook+json" }),
    async (req, res) => {
      try {
        const event = await decodeLiveKitWebhookEvent(req, config);
        const result = await applyLiveKitWebhookEvent(prisma, event, now());
        res.status(202).json({ ok: true, event: event.event, ...result });
      } catch (error) {
        const message = (error as Error).message;
        const status =
          message.includes("authorization") || message.includes("sha256")
            ? 401
            : 400;
        res.status(status).json({ error: "invalid_voice_webhook" });
      }
    },
  );

  return router;
}

async function decodeLiveKitWebhookEvent(
  req: {
    body?: unknown;
    get(name: string): string | undefined;
  },
  config: VoiceRuntimeConfig,
): Promise<LiveKitWebhookEvent> {
  if (Buffer.isBuffer(req.body)) {
    const body = req.body.toString("utf8");
    const authHeader = req.get("Authorization");
    if (config.livekitApiKey && config.livekitApiSecret) {
      if (!authHeader) {
        throw new Error("voice webhook authorization required");
      }
      const receiver = new WebhookReceiver(
        config.livekitApiKey,
        config.livekitApiSecret,
      );
      return (await receiver.receive(body, authHeader)) as LiveKitWebhookEvent;
    }
    return JSON.parse(body) as LiveKitWebhookEvent;
  }

  if (config.livekitApiKey && config.livekitApiSecret) {
    throw new Error("voice webhook authorization requires raw body");
  }

  if (req.body && typeof req.body === "object") {
    return req.body as LiveKitWebhookEvent;
  }

  throw new Error("voice webhook body required");
}

async function applyLiveKitWebhookEvent(
  prisma: VoicePrisma,
  event: LiveKitWebhookEvent,
  receivedAt: Date,
): Promise<{ applied: boolean }> {
  const providerRoomId = stringOrUndefined(event.room?.name);
  if (!providerRoomId) return { applied: false };

  switch (event.event) {
    case "room_started":
      await prisma.voiceSession.updateMany({
        where: {
          provider: "livekit",
          providerRoomId,
          status: { in: ["ringing", "active"] },
        },
        data: {
          status: "active",
          endedAt: null,
        },
      });
      return { applied: true };

    case "room_finished":
      await prisma.voiceSession.updateMany({
        where: {
          provider: "livekit",
          providerRoomId,
          status: { not: "ended" },
        },
        data: {
          status: "ended",
          endedAt: receivedAt,
        },
      });
      return { applied: true };

    case "participant_joined":
      return syncLiveKitParticipant(prisma, event, providerRoomId, receivedAt, {
        leftAt: null,
      });

    case "participant_left":
    case "participant_connection_aborted":
      return syncLiveKitParticipant(prisma, event, providerRoomId, receivedAt, {
        leftAt: receivedAt,
      });

    default:
      return { applied: false };
  }
}

async function syncLiveKitParticipant(
  prisma: VoicePrisma,
  event: LiveKitWebhookEvent,
  providerRoomId: string,
  receivedAt: Date,
  input: { leftAt: Date | null },
): Promise<{ applied: boolean }> {
  const walletPubkey = stringOrUndefined(event.participant?.identity);
  if (!walletPubkey) return { applied: false };

  const voiceSession = await prisma.voiceSession.findFirst({
    where: {
      provider: "livekit",
      providerRoomId,
      status: { in: ["ringing", "active"] },
    },
  });
  if (!voiceSession) return { applied: false };

  const canPublish = event.participant?.permission?.canPublish !== false;
  await prisma.voiceParticipant.upsert({
    where: {
      sessionId_walletPubkey: {
        sessionId: voiceSession.id,
        walletPubkey,
      },
    },
    create: {
      sessionId: voiceSession.id,
      walletPubkey,
      role: canPublish ? "speaker" : "listener",
      joinedAt: input.leftAt ? null : receivedAt,
      leftAt: input.leftAt,
      mutedBySelf: false,
      mutedByModerator: !canPublish,
    },
    update: {
      role: canPublish ? "speaker" : "listener",
      leftAt: input.leftAt,
      mutedByModerator: !canPublish,
    },
  });

  return { applied: true };
}

interface LiveKitWebhookEvent {
  event?: string;
  room?: {
    name?: string;
  };
  participant?: {
    identity?: string;
    permission?: {
      canPublish?: boolean;
    };
  };
}

async function authenticateCommunicationSession(
  prisma: VoicePrisma,
  req: { headers: { authorization?: string | string[] } },
  roomKey: string,
  now: Date,
): Promise<
  | { ok: true; session: CommunicationSessionRow }
  | { ok: false; status: number; error: string }
> {
  const authorization = Array.isArray(req.headers.authorization)
    ? req.headers.authorization[0]
    : req.headers.authorization;
  const token = parseBearerToken(authorization);
  if (!token) {
    return {
      ok: false,
      status: 401,
      error: "missing_communication_session_token",
    };
  }

  const session = await prisma.communicationSession.findUnique({
    where: { sessionId: token },
  });
  if (
    !session ||
    session.revoked ||
    session.expiresAt.getTime() <= now.getTime()
  ) {
    return { ok: false, status: 401, error: "communication_session_not_found" };
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
    data: { lastSeenAt: now },
  });

  return { ok: true, session };
}

async function evaluateSpeakerLimit(
  prisma: VoicePrisma,
  voiceSession: VoiceSessionRow,
  walletPubkey: string,
  requestedCanPublishAudio: boolean,
  config: VoiceRuntimeConfig,
  now: Date,
): Promise<SpeakerLimitDecision> {
  const policy = resolveVoiceSpeakerPolicy(voiceSession, config);
  if (!requestedCanPublishAudio) {
    return {
      canPublishAudio: false,
      activeSpeakerCount: null,
      maxSpeakers: policy.maxSpeakers,
      platformMaxSpeakersPerSession: config.platformMaxSpeakersPerSession,
      reason: null,
      queuePosition: null,
      role: "listener",
      strategy: policy.overflowStrategy,
      source: policy.source,
    };
  }

  const existingParticipant = (await prisma.voiceParticipant.findUnique({
    where: {
      sessionId_walletPubkey: {
        sessionId: voiceSession.id,
        walletPubkey,
      },
    },
  })) as VoiceParticipantRow | null;

  const activeSpeakerCount = await prisma.voiceParticipant.count({
    where: {
      sessionId: voiceSession.id,
      role: "speaker",
      leftAt: null,
      mutedByModerator: false,
      walletPubkey: { not: walletPubkey },
    },
  });

  if (policy.overflowStrategy === "moderated_queue") {
    if (
      existingParticipant?.role === "speaker" &&
      existingParticipant.mutedByModerator !== true &&
      activeSpeakerCount < policy.maxSpeakers
    ) {
      return {
        canPublishAudio: true,
        activeSpeakerCount,
        maxSpeakers: policy.maxSpeakers,
        platformMaxSpeakersPerSession: config.platformMaxSpeakersPerSession,
        reason: null,
        queuePosition: null,
        role: "speaker",
        strategy: policy.overflowStrategy,
        source: policy.source,
      };
    }
    const queuePosition = await evaluateQueuePosition(
      prisma,
      voiceSession.id,
      walletPubkey,
      existingParticipant,
      now,
    );
    return {
      canPublishAudio: false,
      activeSpeakerCount,
      maxSpeakers: policy.maxSpeakers,
      platformMaxSpeakersPerSession: config.platformMaxSpeakersPerSession,
      reason: "speaker_approval_required",
      queuePosition: queuePosition.position,
      role: "queued",
      strategy: policy.overflowStrategy,
      source: policy.source,
    };
  }

  if (policy.overflowStrategy === "queue") {
    const queuePosition = await evaluateQueuePosition(
      prisma,
      voiceSession.id,
      walletPubkey,
      existingParticipant,
      now,
    );
    if (
      activeSpeakerCount >= policy.maxSpeakers ||
      queuePosition.position > 1
    ) {
      return {
        canPublishAudio: false,
        activeSpeakerCount,
        maxSpeakers: policy.maxSpeakers,
        platformMaxSpeakersPerSession: config.platformMaxSpeakersPerSession,
        reason:
          activeSpeakerCount >= policy.maxSpeakers
            ? "speaker_limit_reached"
            : "speaker_queue_waiting",
        queuePosition: queuePosition.position,
        role: "queued",
        strategy: policy.overflowStrategy,
        source: policy.source,
      };
    }
  }

  if (activeSpeakerCount >= policy.maxSpeakers) {
    return {
      canPublishAudio: false,
      activeSpeakerCount,
      maxSpeakers: policy.maxSpeakers,
      platformMaxSpeakersPerSession: config.platformMaxSpeakersPerSession,
      reason: "speaker_limit_reached",
      queuePosition: null,
      role: "listener",
      strategy: policy.overflowStrategy,
      source: policy.source,
    };
  }

  return {
    canPublishAudio: true,
    activeSpeakerCount,
    maxSpeakers: policy.maxSpeakers,
    platformMaxSpeakersPerSession: config.platformMaxSpeakersPerSession,
    reason: null,
    queuePosition: null,
    role: "speaker",
    strategy: policy.overflowStrategy,
    source: policy.source,
  };
}

async function evaluateQueuePosition(
  prisma: VoicePrisma,
  sessionId: string,
  walletPubkey: string,
  existingParticipant: VoiceParticipantRow | null,
  now: Date,
): Promise<{ position: number }> {
  const queuedAt =
    existingParticipant?.role === "queued" && existingParticipant.joinedAt
      ? existingParticipant.joinedAt
      : now;
  const queuedAhead = await prisma.voiceParticipant.count({
    where: {
      sessionId,
      role: "queued",
      leftAt: null,
      joinedAt: { lt: queuedAt },
      walletPubkey: { not: walletPubkey },
    },
  });
  return { position: queuedAhead + 1 };
}

function resolveVoiceSpeakerPolicy(
  voiceSession: VoiceSessionRow,
  config: VoiceRuntimeConfig,
): VoiceSpeakerPolicy {
  const roomPolicy = readRoomVoicePolicy(voiceSession.room?.metadata);
  if (roomPolicy) {
    return normalizeVoiceSpeakerPolicy(roomPolicy, {
      fallbackMaxSpeakers: config.defaultMaxSpeakersPerSession,
      platformMaxSpeakers: config.platformMaxSpeakersPerSession,
      fallbackStrategy: config.speakerLimitStrategy,
      source: "room_metadata",
    });
  }

  return normalizeVoiceSpeakerPolicy(null, {
    fallbackMaxSpeakers: config.defaultMaxSpeakersPerSession,
    platformMaxSpeakers: config.platformMaxSpeakersPerSession,
    fallbackStrategy: config.speakerLimitStrategy,
    source: "runtime_default",
  });
}

function readRoomVoicePolicy(metadata: unknown): unknown | null {
  if (!metadata || typeof metadata !== "object" || Array.isArray(metadata)) {
    return null;
  }
  const record = metadata as Record<string, unknown>;
  return record.voicePolicy ?? null;
}

async function canModerateVoiceSession(
  prisma: VoicePrisma,
  input: {
    roomKey: string;
    walletPubkey: string;
    policy: VoiceSpeakerPolicy;
  },
): Promise<boolean> {
  const roomModeration = await canModerateRoom(prisma, {
    roomKey: input.roomKey,
    walletPubkey: input.walletPubkey,
  });
  if (roomModeration.allowed) return true;

  const member = await prisma.communicationRoomMember.findUnique({
    where: {
      roomKey_walletPubkey: {
        roomKey: input.roomKey,
        walletPubkey: input.walletPubkey,
      },
    },
  });
  const role =
    member && !member.leftAt && typeof member.role === "string"
      ? member.role.trim().toLowerCase()
      : "";
  return !!role && input.policy.moderatorRoles.includes(role);
}

async function loadActiveVoiceSession(
  prisma: VoicePrisma,
  sessionId: string,
  now: Date,
): Promise<VoiceSessionRow | null> {
  const session = await prisma.voiceSession.findUnique({
    where: { id: sessionId },
    include: {
      room: {
        select: {
          metadata: true,
        },
      },
    },
  });
  if (!session) return null;
  if (session.status === "ended" || session.status === "failed") return null;
  if (session.endedAt) return null;
  if (session.expiresAt && session.expiresAt.getTime() <= now.getTime())
    return null;
  return session;
}

function mapVoiceSession(session: VoiceSessionRow) {
  return {
    id: session.id,
    roomKey: session.roomKey,
    provider: session.provider,
    providerRoomId: session.providerRoomId,
    status: session.status,
    createdByPubkey: session.createdByPubkey,
    startedAt: session.startedAt.toISOString(),
    endedAt: session.endedAt?.toISOString() ?? null,
    expiresAt: session.expiresAt?.toISOString() ?? null,
    metadata: session.metadata ?? null,
    createdAt: session.createdAt.toISOString(),
    updatedAt: session.updatedAt.toISOString(),
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

function optionalPositiveInt(value: unknown): number | null {
  if (value === null || value === undefined || value === "") return null;
  const parsed =
    typeof value === "number"
      ? Math.trunc(value)
      : Number.parseInt(String(value), 10);
  return Number.isSafeInteger(parsed) && parsed > 0 ? parsed : null;
}

function jsonObjectOrUndefined(
  value: unknown,
): Prisma.InputJsonValue | undefined {
  if (!value || typeof value !== "object" || Array.isArray(value))
    return undefined;
  return value as Prisma.InputJsonValue;
}

function randomId(): string {
  if (typeof crypto.randomUUID === "function") {
    return crypto.randomUUID().replace(/-/g, "");
  }
  return crypto.randomBytes(16).toString("hex");
}
