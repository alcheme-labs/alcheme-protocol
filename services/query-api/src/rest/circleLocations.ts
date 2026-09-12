import { Router } from "express";
import type { PrismaClient } from "@prisma/client";
import type { Redis } from "ioredis";

import { verifyEd25519SignatureBase64 } from "../services/offchainDiscussion";
import { resolveActorCanManageCircle } from "../services/circles/managePermission";
import {
  CIRCLE_POLICY_LOCATION_UPDATE_ACTION_TYPE,
  evaluateCirclePolicyGovernance,
} from "../services/governance/circlePolicyGovernance";
import {
  archiveCirclePrimaryGeoAnchor,
  fetchCirclePrimaryGeoAnchor,
  upsertCirclePrimaryGeoAnchor,
} from "../services/circleLocation/store";
import {
  normalizeCircleGeoAnchorSettingsPayload,
} from "../services/circleLocation/validation";
import {
  buildCircleSettingsSigningMessage,
  buildCircleSettingsSigningPayload,
  buildStoredCircleSettingsEnvelopeSection,
  isCircleSettingsSignatureFresh,
  parseCircleSettingsSignedMessage,
  persistCircleSettingsEnvelopeSection,
} from "../services/policy/settingsEnvelope";
import { AuthActorError } from "../services/auth/actor";

export function circleLocationRouter(prisma: PrismaClient, redis: Redis): Router {
  const router = Router();

  router.get("/circles/:circleId/primary-anchor", async (req, res, next) => {
    try {
      const circleId = parseCircleId(req.params.circleId);
      if (!circleId) return res.status(400).json({ error: "invalid_circle_id" });
      const actorPubkey = parseString(req.query.actorPubkey);
      if (!actorPubkey) {
        return res.status(401).json({ error: "circle_location_actor_required" });
      }
      const canManage = await resolveActorCanManageCircle({ req, prisma, circleId, actorPubkey });
      if (!canManage) return res.status(403).json({ error: "circle_location_forbidden" });
      const anchor = await fetchCirclePrimaryGeoAnchor(prisma, circleId);
      return res.json({ circleId, anchor });
    } catch (error) {
      if (sendCircleLocationError(res, error)) return;
      next(error);
    }
  });

  router.put("/circles/:circleId/primary-anchor", async (req, res, next) => {
    try {
      const circleId = parseCircleId(req.params.circleId);
      if (!circleId) return res.status(400).json({ error: "invalid_circle_id" });
      const auth = authorizeSignedLocationPayload(req.body, {
        circleId,
        expectedOperation: "upsert",
      });
      if (!auth.ok) return res.status(auth.status).json({ error: auth.error });
      const canManage = await resolveActorCanManageCircle({
        req,
        prisma,
        circleId,
        actorPubkey: auth.actorPubkey,
      });
      if (!canManage) return res.status(403).json({ error: "circle_location_forbidden" });
      const governance = await evaluateCirclePolicyGovernance(prisma, {
        circleId,
        actionType: CIRCLE_POLICY_LOCATION_UPDATE_ACTION_TYPE,
        actorPubkey: auth.actorPubkey,
        directAllowed: canManage,
        payload: buildGovernancePayload(auth),
      });
      if (governance.status === "requires_governance") return res.status(202).json(governance);
      if (governance.status === "denied") return res.status(403).json({ error: governance.error });
      const anchor = await upsertCirclePrimaryGeoAnchor(prisma, {
        circleId,
        actorPubkey: auth.actorPubkey,
      }, { ...auth.payload });
      await persistCircleLocationSettingsEnvelope(prisma, circleId, auth);
      await invalidateCircleCache(redis, circleId);
      return res.json({ ok: true, circleId, anchor });
    } catch (error) {
      if (sendCircleLocationError(res, error)) return;
      next(error);
    }
  });

  router.post("/circles/:circleId/primary-anchor/archive", async (req, res, next) => {
    try {
      const circleId = parseCircleId(req.params.circleId);
      if (!circleId) return res.status(400).json({ error: "invalid_circle_id" });
      const auth = authorizeSignedLocationPayload(req.body, {
        circleId,
        expectedOperation: "archive",
      });
      if (!auth.ok) return res.status(auth.status).json({ error: auth.error });
      const canManage = await resolveActorCanManageCircle({
        req,
        prisma,
        circleId,
        actorPubkey: auth.actorPubkey,
      });
      if (!canManage) return res.status(403).json({ error: "circle_location_forbidden" });
      const governance = await evaluateCirclePolicyGovernance(prisma, {
        circleId,
        actionType: CIRCLE_POLICY_LOCATION_UPDATE_ACTION_TYPE,
        actorPubkey: auth.actorPubkey,
        directAllowed: canManage,
        payload: buildGovernancePayload(auth),
      });
      if (governance.status === "requires_governance") return res.status(202).json(governance);
      if (governance.status === "denied") return res.status(403).json({ error: governance.error });
      const anchor = await archiveCirclePrimaryGeoAnchor(prisma, {
        circleId,
        actorPubkey: auth.actorPubkey,
      }, { ...auth.payload });
      if (anchor) {
        await persistCircleLocationSettingsEnvelope(prisma, circleId, auth);
      }
      await invalidateCircleCache(redis, circleId);
      return res.json({
        ok: true,
        circleId,
        archived: Boolean(anchor),
        anchorId: anchor?.anchorId ?? null,
      });
    } catch (error) {
      if (sendCircleLocationError(res, error)) return;
      next(error);
    }
  });

  return router;
}

type AuthorizedLocationPayload =
  | {
    ok: true;
    actorPubkey: string;
    payload: ReturnType<typeof normalizeCircleGeoAnchorSettingsPayload>;
    signedMessage: string;
    signature: string;
    clientTimestamp: string;
    nonce: string;
    anchor: Record<string, unknown> | null;
  }
  | { ok: false; status: number; error: string };

function authorizeSignedLocationPayload(
  rawBody: unknown,
  input: { circleId: number; expectedOperation: "upsert" | "archive" },
): AuthorizedLocationPayload {
  const body = normalizeRecord(rawBody);
  const actorPubkey = parseString(body.actorPubkey);
  const signedMessage = typeof body.signedMessage === "string" ? body.signedMessage : "";
  const signature = typeof body.signature === "string" ? body.signature : "";
  const signedPayload = parseCircleSettingsSignedMessage(signedMessage);
  if (!actorPubkey || !signedPayload || !signature || signedPayload.settingKind !== "circle_geo_anchor") {
    return { ok: false, status: 401, error: "circle_location_auth_required" };
  }
  if (signedPayload.circleId !== input.circleId || signedPayload.actorPubkey !== actorPubkey) {
    return { ok: false, status: 400, error: "circle_location_payload_mismatch" };
  }
  if (!verifyEd25519SignatureBase64({
    senderPubkey: actorPubkey,
    message: signedMessage,
    signatureBase64: signature,
  })) {
    return { ok: false, status: 401, error: "invalid_circle_location_signature" };
  }
  const payload = normalizeCircleGeoAnchorSettingsPayload({
    ...body,
    operation: input.expectedOperation,
  });
  if (payload.operation !== input.expectedOperation) {
    return { ok: false, status: 400, error: "circle_location_operation_mismatch" };
  }
  const expectedMessage = buildCircleSettingsSigningMessage(buildCircleSettingsSigningPayload({
    circleId: input.circleId,
    actorPubkey,
    settingKind: "circle_geo_anchor",
    payload,
    clientTimestamp: signedPayload.clientTimestamp,
    nonce: signedPayload.nonce,
    anchor: signedPayload.anchor ?? null,
  }));
  if (expectedMessage !== signedMessage) {
    return { ok: false, status: 400, error: "circle_location_signature_payload_mismatch" };
  }
  if (!isCircleSettingsSignatureFresh({
    clientTimestamp: signedPayload.clientTimestamp,
    windowMs: Number(process.env.CIRCLE_SETTINGS_SIGNATURE_WINDOW_MS || "300000"),
  })) {
    return { ok: false, status: 401, error: "circle_location_signature_expired" };
  }
  return {
    ok: true,
    actorPubkey,
    payload,
    signedMessage,
    signature,
    clientTimestamp: signedPayload.clientTimestamp,
    nonce: signedPayload.nonce,
    anchor: signedPayload.anchor ?? null,
  };
}

function buildGovernancePayload(auth: Extract<AuthorizedLocationPayload, { ok: true }>) {
  return {
    ...auth.payload,
    actorPubkey: auth.actorPubkey,
    settingKind: "circle_geo_anchor",
    signedMessage: auth.signedMessage,
    signature: auth.signature,
    clientTimestamp: auth.clientTimestamp,
    nonce: auth.nonce,
    anchor: auth.anchor,
    executionDomain: "off_chain",
    chainStatus: "not_required",
  };
}

function normalizeRecord(value: unknown): Record<string, unknown> {
  return value && typeof value === "object" && !Array.isArray(value)
    ? value as Record<string, unknown>
    : {};
}

function parseCircleId(value: unknown): number | null {
  const parsed = Number(value);
  return Number.isInteger(parsed) && parsed > 0 ? parsed : null;
}

function parseString(value: unknown): string {
  return typeof value === "string" ? value.trim() : "";
}

async function invalidateCircleCache(redis: Redis, circleId: number): Promise<void> {
  try {
    if (typeof (redis as any)?.del === "function") {
      await (redis as any).del(`circle:${circleId}`);
    }
  } catch {
    return;
  }
}

async function persistCircleLocationSettingsEnvelope(
  prisma: PrismaClient,
  circleId: number,
  auth: Extract<AuthorizedLocationPayload, { ok: true }>,
): Promise<void> {
  await persistCircleSettingsEnvelopeSection(prisma, {
    circleId,
    section: buildStoredCircleSettingsEnvelopeSection({
      settingKind: "circle_geo_anchor",
      payload: { ...auth.payload },
      actorPubkey: auth.actorPubkey,
      signedMessage: auth.signedMessage,
      signature: auth.signature,
      clientTimestamp: auth.clientTimestamp,
      nonce: auth.nonce,
      anchor: auth.anchor ?? null,
    }),
  });
}

function sendCircleLocationError(res: any, error: unknown): boolean {
  if (error instanceof AuthActorError) {
    res.status(error.statusCode).json(error.toResponseBody());
    return true;
  }
  const message = error instanceof Error ? error.message : String(error || "");
  if (message.startsWith("invalid_circle_geo_anchor") || message === "invalid_circle_location_payload") {
    res.status(400).json({ error: message });
    return true;
  }
  return false;
}
