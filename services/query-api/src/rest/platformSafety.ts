import { Router } from 'express';
import type { PrismaClient } from '@prisma/client';
import type { Redis } from 'ioredis';

import { requireAuthenticatedActor } from '../services/auth/actor';
import { sendAuthActorError } from '../services/auth/actorPermissions';
import {
  PlatformSafetyError,
  approvePlatformSafetyAuthorityChange,
  appendPlatformSafetyLegalStatus,
  bootstrapPlatformSafetySandbox,
  capturePlatformSafetyEvidence,
  openPlatformSafetyAppeal,
  openPlatformSafetyLegalStatusAppeal,
  proposePlatformSafetyAuthorityChange,
  quarantinePlatformSafetyContent,
  recordPlatformSafetyEvidenceBreakGlassAccess,
  readPlatformSafetyPolicy,
  readPlatformSafetySubjectQuarantine,
  readPlatformSafetyWorkspace,
  releasePlatformSafetyContent,
  resolvePlatformSafetyAppeal,
} from '../services/governance/platformSafety';
import { assertCurrentPublicDemoAdmission } from '../services/governance/publicDemoAdmission';
import {
  closePlatformSafetyIncident,
  declarePlatformSafetyIncident,
  extendPlatformSafetyIncident,
  mergePlatformSafetyIncidents,
  openPlatformSafetyIncidentActivationAppeal,
  readPlatformSafetyIncidents,
  resolvePlatformSafetyIncidentActivation,
  resolvePlatformSafetyIncidentActivationAppeal,
  reviewPlatformSafetyIncident,
  upgradePlatformSafetyIncident,
} from '../services/governance/platformSafetyIncident';

export function platformSafetyRouter(
  prisma: PrismaClient,
  redis: Redis,
): Router {
  const router = Router();

  const requireActor = async (req: any) => {
    const actor = await requireAuthenticatedActor(req, prisma, {
      requireSessionCookie: true,
    });
    await assertCurrentPublicDemoAdmission(prisma, actor.pubkey, actor.userId);
    return actor;
  };

  router.get('/policy', async (_req, res, next) => {
    try {
      return res.json(await readPlatformSafetyPolicy(prisma));
    } catch (error) {
      next(error);
    }
  });

  router.post('/bootstrap', async (req, res, next) => {
    try {
      const actor = await requireActor(req);
      const result = await bootstrapPlatformSafetySandbox(prisma, {
        actorPubkey: actor.pubkey,
        policyAdminCircleId: Number(req.body?.policyAdminCircleId),
        caseResponderCircleId: Number(req.body?.caseResponderCircleId),
        emergencyResponderCircleId: Number(
          req.body?.emergencyResponderCircleId,
        ),
        appealReviewCircleId: Number(req.body?.appealReviewCircleId),
        auditReviewCircleId: Number(req.body?.auditReviewCircleId),
        legalOperatorCircleId: Number(req.body?.legalOperatorCircleId),
        legalAppealCircleId: Number(req.body?.legalAppealCircleId),
      });
      return res.status(201).json({ ok: true, ...result });
    } catch (error) {
      if (sendAuthActorError(res, error)) return;
      if (sendPlatformSafetyError(res, error)) return;
      next(error);
    }
  });

  router.get('/workspace', async (req, res, next) => {
    try {
      const actor = await requireActor(req);
      return res.json(await readPlatformSafetyWorkspace(prisma, {
        actorPubkey: actor.pubkey,
      }));
    } catch (error) {
      if (sendAuthActorError(res, error)) return;
      if (sendPlatformSafetyError(res, error)) return;
      next(error);
    }
  });

  router.post('/authority-change-proposals', async (req, res, next) => {
    try {
      const actor = await requireActor(req);
      const result = await proposePlatformSafetyAuthorityChange(prisma, {
        actorPubkey: actor.pubkey,
        targetRoleKey: String(req.body?.targetRoleKey || '').trim() as any,
        targetCircleId: Number(req.body?.targetCircleId),
        reasonCode: String(req.body?.reasonCode || '').trim(),
        evidenceDigest: String(req.body?.evidenceDigest || '').trim(),
        idempotencyKey: String(req.body?.idempotencyKey || '').trim(),
        excludedActorPubkeys: Array.isArray(req.body?.excludedActorPubkeys)
          ? req.body.excludedActorPubkeys.map((value: unknown) => String(value || '').trim())
          : [],
      });
      return res.status(result.replayed ? 200 : 201).json({ ok: true, ...result });
    } catch (error) {
      if (sendAuthActorError(res, error)) return;
      if (sendPlatformSafetyError(res, error)) return;
      next(error);
    }
  });

  router.post('/authority-change-proposals/:receiptId/approval', async (req, res, next) => {
    try {
      const actor = await requireActor(req);
      const result = await approvePlatformSafetyAuthorityChange(prisma, {
        actorPubkey: actor.pubkey,
        proposalReceiptId: String(req.params.receiptId || '').trim(),
        reasonCode: String(req.body?.reasonCode || '').trim(),
        evidenceDigest: String(req.body?.evidenceDigest || '').trim(),
        idempotencyKey: String(req.body?.idempotencyKey || '').trim(),
      });
      return res.status(result.replayed ? 200 : 201).json({ ok: true, ...result });
    } catch (error) {
      if (sendAuthActorError(res, error)) return;
      if (sendPlatformSafetyError(res, error)) return;
      next(error);
    }
  });

  router.post('/evidence-captures', async (req, res, next) => {
    try {
      const actor = await requireActor(req);
      const result = await capturePlatformSafetyEvidence(prisma, {
        actorPubkey: actor.pubkey,
        subjectType: String(req.body?.subjectType || '').trim() as any,
        subjectRef: String(req.body?.subjectRef || '').trim(),
        sourceDigest: String(req.body?.sourceDigest || '').trim(),
        malwareScanStatus: String(req.body?.malwareScanStatus || '').trim() as any,
        piiRedactionStatus: String(req.body?.piiRedactionStatus || '').trim() as any,
        retentionSeconds: Number(req.body?.retentionSeconds),
        reasonCode: String(req.body?.reasonCode || '').trim(),
        idempotencyKey: String(req.body?.idempotencyKey || '').trim(),
      });
      return res.status(result.replayed ? 200 : 201).json({ ok: true, ...result });
    } catch (error) {
      if (sendAuthActorError(res, error)) return;
      if (sendPlatformSafetyError(res, error)) return;
      next(error);
    }
  });

  router.post('/evidence-captures/:receiptId/break-glass-accesses', async (req, res, next) => {
    try {
      const actor = await requireActor(req);
      const result = await recordPlatformSafetyEvidenceBreakGlassAccess(prisma, {
        actorPubkey: actor.pubkey,
        requesterPubkey: String(req.body?.requesterPubkey || '').trim(),
        evidenceReceiptId: String(req.params.receiptId || '').trim(),
        safetyIncidentId: String(req.body?.safetyIncidentId || '').trim(),
        purposeCode: String(req.body?.purposeCode || '').trim(),
        accessJustificationDigest: String(req.body?.accessJustificationDigest || '').trim(),
        durationSeconds: Number(req.body?.durationSeconds),
        idempotencyKey: String(req.body?.idempotencyKey || '').trim(),
      });
      return res.status(result.replayed ? 200 : 201).json({ ok: true, ...result });
    } catch (error) {
      if (sendAuthActorError(res, error)) return;
      if (sendPlatformSafetyError(res, error)) return;
      next(error);
    }
  });

  router.post('/legal-statuses', async (req, res, next) => {
    try {
      const actor = await requireActor(req);
      const contentId = String(req.body?.contentId || '').trim();
      const result = await appendPlatformSafetyLegalStatus(prisma, {
        actorPubkey: actor.pubkey,
        contentId,
        status: String(req.body?.status || '').trim() as any,
        jurisdiction: String(req.body?.jurisdiction || '').trim() as 'US',
        authorityDigest: String(req.body?.authorityDigest || '').trim(),
        publicTombstoneDigest: String(req.body?.publicTombstoneDigest || '').trim(),
        redactedSummaryDigest: String(req.body?.redactedSummaryDigest || '').trim(),
        lifecyclePlanDigest: String(req.body?.lifecyclePlanDigest || '').trim(),
        noticeRequired: req.body?.noticeRequired === true,
        appealWindowSeconds: Number(req.body?.appealWindowSeconds),
        reasonCode: String(req.body?.reasonCode || '').trim(),
        idempotencyKey: String(req.body?.idempotencyKey || '').trim(),
      });
      const post = await (prisma as any).post.findUnique({
        where: { contentId },
        select: { contentId: true, onChainAddress: true },
      });
      await Promise.all(
        [contentId, post?.onChainAddress]
          .filter((value): value is string => typeof value === 'string' && value.length > 0)
          .map((value) => redis.del(`post:${value}`)),
      );
      return res.status(result.replayed ? 200 : 201).json({ ok: true, ...result });
    } catch (error) {
      if (sendAuthActorError(res, error)) return;
      if (sendPlatformSafetyError(res, error)) return;
      next(error);
    }
  });

  router.post('/legal-statuses/:contentId/appeals', async (req, res, next) => {
    try {
      const actor = await requireActor(req);
      const result = await openPlatformSafetyLegalStatusAppeal(prisma, {
        actorPubkey: actor.pubkey,
        contentId: String(req.params.contentId || '').trim(),
        reasonCode: String(req.body?.reasonCode || '').trim(),
        evidenceDigest: String(req.body?.evidenceDigest || '').trim(),
      });
      return res.status(result.replayed ? 200 : 201).json({ ok: true, ...result });
    } catch (error) {
      if (sendAuthActorError(res, error)) return;
      if (sendPlatformSafetyError(res, error)) return;
      next(error);
    }
  });

  router.post('/quarantines', async (req, res, next) => {
    try {
      const actor = await requireActor(req);
      const result = await quarantinePlatformSafetyContent(prisma, {
        actorPubkey: actor.pubkey,
        circleId: Number(req.body?.circleId),
        contentId: String(req.body?.contentId || '').trim(),
        category: String(req.body?.category || '').trim(),
        severity: String(req.body?.severity || '').trim() as 'sev2' | 'sev1',
        durationSeconds: Number(req.body?.durationSeconds),
        reasonCode: String(req.body?.reasonCode || '').trim(),
        evidenceDigest: String(req.body?.evidenceDigest || '').trim(),
        idempotencyKey: String(req.body?.idempotencyKey || '').trim(),
        safetyIncidentId: String(req.body?.safetyIncidentId || '').trim() || null,
      });
      const contentId = String(req.body?.contentId || '').trim();
      await redis.del(`post:${contentId}`);
      return res.status(result.replayed ? 200 : 201).json({ ok: true, ...result });
    } catch (error) {
      if (sendAuthActorError(res, error)) return;
      if (sendPlatformSafetyError(res, error)) return;
      next(error);
    }
  });

  router.get('/quarantines/:contentId', async (req, res, next) => {
    try {
      const actor = await requireActor(req);
      return res.json(await readPlatformSafetySubjectQuarantine(prisma, {
        actorPubkey: actor.pubkey,
        contentId: String(req.params.contentId || '').trim(),
      }));
    } catch (error) {
      if (sendAuthActorError(res, error)) return;
      if (sendPlatformSafetyError(res, error)) return;
      next(error);
    }
  });

  router.post('/quarantines/:contentId/release', async (req, res, next) => {
    try {
      const actor = await requireActor(req);
      const contentId = String(req.params.contentId || '').trim();
      const result = await releasePlatformSafetyContent(prisma, {
        actorPubkey: actor.pubkey,
        circleId: Number(req.body?.circleId),
        contentId,
        reasonCode: String(req.body?.reasonCode || '').trim(),
        idempotencyKey: String(req.body?.idempotencyKey || '').trim(),
      });
      await redis.del(`post:${contentId}`);
      return res.status(result.replayed ? 200 : 201).json({ ok: true, ...result });
    } catch (error) {
      if (sendAuthActorError(res, error)) return;
      if (sendPlatformSafetyError(res, error)) return;
      next(error);
    }
  });

  router.post('/quarantines/:contentId/appeals', async (req, res, next) => {
    try {
      const actor = await requireActor(req);
      const result = await openPlatformSafetyAppeal(prisma, {
        actorPubkey: actor.pubkey,
        contentId: String(req.params.contentId || '').trim(),
        reasonCode: String(req.body?.reasonCode || '').trim(),
        evidenceDigest: String(req.body?.evidenceDigest || '').trim(),
      });
      return res.status(result.replayed ? 200 : 201).json({ ok: true, ...result });
    } catch (error) {
      if (sendAuthActorError(res, error)) return;
      if (sendPlatformSafetyError(res, error)) return;
      next(error);
    }
  });

  router.post('/appeals/:appealId/resolution', async (req, res, next) => {
    try {
      const actor = await requireActor(req);
      const result = await resolvePlatformSafetyAppeal(prisma, {
        reviewerPubkey: actor.pubkey,
        appealId: String(req.params.appealId || '').trim(),
        outcome: String(req.body?.outcome || '').trim() as 'uphold' | 'revoke',
        reasonCode: String(req.body?.reasonCode || '').trim(),
        evidenceDigest: String(req.body?.evidenceDigest || '').trim(),
      });
      if (result.appeal.contentId) {
        await redis.del(`post:${result.appeal.contentId}`);
      }
      return res.status(result.replayed ? 200 : 201).json({ ok: true, ...result });
    } catch (error) {
      if (sendAuthActorError(res, error)) return;
      if (sendPlatformSafetyError(res, error)) return;
      next(error);
    }
  });

  router.get('/incidents', async (req, res, next) => {
    try {
      const actor = await requireActor(req);
      return res.json({
        schemaVersion: 1,
        incidents: await readPlatformSafetyIncidents(prisma, {
          actorPubkey: actor.pubkey,
        }),
      });
    } catch (error) {
      if (sendAuthActorError(res, error)) return;
      if (sendPlatformSafetyError(res, error)) return;
      next(error);
    }
  });

  router.post('/incidents', async (req, res, next) => {
    try {
      const actor = await requireActor(req);
      const result = await declarePlatformSafetyIncident(prisma, {
        actorPubkey: actor.pubkey,
        targetCircleId: Number(req.body?.targetCircleId),
        category: String(req.body?.category || '').trim(),
        severity: String(req.body?.severity || '').trim() as 'sev2' | 'sev1',
        maxDurationSeconds: Number(req.body?.maxDurationSeconds),
        reasonCode: String(req.body?.reasonCode || '').trim(),
        evidenceDigest: String(req.body?.evidenceDigest || '').trim(),
        idempotencyKey: String(req.body?.idempotencyKey || '').trim(),
      });
      return res.status(result.replayed ? 200 : 201).json({ ok: true, ...result });
    } catch (error) {
      if (sendAuthActorError(res, error)) return;
      if (sendPlatformSafetyError(res, error)) return;
      next(error);
    }
  });

  router.post('/incidents/:incidentId/activation', async (req, res, next) => {
    try {
      const actor = await requireActor(req);
      const result = await resolvePlatformSafetyIncidentActivation(prisma, {
        reviewerPubkey: actor.pubkey,
        incidentId: String(req.params.incidentId || '').trim(),
        outcome: String(req.body?.outcome || '').trim() as 'approve' | 'reject',
        reasonCode: String(req.body?.reasonCode || '').trim(),
        evidenceDigest: String(req.body?.evidenceDigest || '').trim(),
        idempotencyKey: String(req.body?.idempotencyKey || '').trim(),
      });
      return res.status(result.replayed ? 200 : 201).json({ ok: true, ...result });
    } catch (error) {
      if (sendAuthActorError(res, error)) return;
      if (sendPlatformSafetyError(res, error)) return;
      next(error);
    }
  });

  router.post('/incidents/:incidentId/activation-appeals', async (req, res, next) => {
    try {
      const actor = await requireActor(req);
      const result = await openPlatformSafetyIncidentActivationAppeal(prisma, {
        appellantPubkey: actor.pubkey,
        incidentId: String(req.params.incidentId || '').trim(),
        reasonCode: String(req.body?.reasonCode || '').trim(),
        evidenceDigest: String(req.body?.evidenceDigest || '').trim(),
      });
      return res.status(result.replayed ? 200 : 201).json({ ok: true, ...result });
    } catch (error) {
      if (sendAuthActorError(res, error)) return;
      if (sendPlatformSafetyError(res, error)) return;
      next(error);
    }
  });

  router.post('/incident-activation-appeals/:appealId/resolution', async (req, res, next) => {
    try {
      const actor = await requireActor(req);
      const result = await resolvePlatformSafetyIncidentActivationAppeal(prisma, {
        reviewerPubkey: actor.pubkey,
        appealId: String(req.params.appealId || '').trim(),
        outcome: String(req.body?.outcome || '').trim() as 'uphold' | 'revoke',
        reasonCode: String(req.body?.reasonCode || '').trim(),
        evidenceDigest: String(req.body?.evidenceDigest || '').trim(),
      });
      return res.status(result.replayed ? 200 : 201).json({ ok: true, ...result });
    } catch (error) {
      if (sendAuthActorError(res, error)) return;
      if (sendPlatformSafetyError(res, error)) return;
      next(error);
    }
  });

  router.post('/incidents/:incidentId/close', async (req, res, next) => {
    try {
      const actor = await requireActor(req);
      const result = await closePlatformSafetyIncident(prisma, {
        actorPubkey: actor.pubkey,
        incidentId: String(req.params.incidentId || '').trim(),
        reasonCode: String(req.body?.reasonCode || '').trim(),
        evidenceDigest: String(req.body?.evidenceDigest || '').trim(),
        idempotencyKey: String(req.body?.idempotencyKey || '').trim(),
      });
      return res.status(result.replayed ? 200 : 201).json({ ok: true, ...result });
    } catch (error) {
      if (sendAuthActorError(res, error)) return;
      if (sendPlatformSafetyError(res, error)) return;
      next(error);
    }
  });

  router.post('/incidents/:incidentId/upgrade', async (req, res, next) => {
    try {
      const actor = await requireActor(req);
      const result = await upgradePlatformSafetyIncident(prisma, {
        reviewerPubkey: actor.pubkey,
        incidentId: String(req.params.incidentId || '').trim(),
        severity: String(req.body?.severity || '').trim() as 'sev1',
        reasonCode: String(req.body?.reasonCode || '').trim(),
        evidenceDigest: String(req.body?.evidenceDigest || '').trim(),
        idempotencyKey: String(req.body?.idempotencyKey || '').trim(),
      });
      return res.status(result.replayed ? 200 : 201).json({ ok: true, ...result });
    } catch (error) {
      if (sendAuthActorError(res, error)) return;
      if (sendPlatformSafetyError(res, error)) return;
      next(error);
    }
  });

  router.post('/incidents/:incidentId/extend', async (req, res, next) => {
    try {
      const actor = await requireActor(req);
      const result = await extendPlatformSafetyIncident(prisma, {
        reviewerPubkey: actor.pubkey,
        incidentId: String(req.params.incidentId || '').trim(),
        additionalDurationSeconds: Number(req.body?.additionalDurationSeconds),
        reasonCode: String(req.body?.reasonCode || '').trim(),
        evidenceDigest: String(req.body?.evidenceDigest || '').trim(),
        idempotencyKey: String(req.body?.idempotencyKey || '').trim(),
      });
      return res.status(result.replayed ? 200 : 201).json({ ok: true, ...result });
    } catch (error) {
      if (sendAuthActorError(res, error)) return;
      if (sendPlatformSafetyError(res, error)) return;
      next(error);
    }
  });

  router.post('/incidents/:incidentId/merge', async (req, res, next) => {
    try {
      const actor = await requireActor(req);
      const result = await mergePlatformSafetyIncidents(prisma, {
        reviewerPubkey: actor.pubkey,
        incidentId: String(req.params.incidentId || '').trim(),
        sourceIncidentId: String(req.body?.sourceIncidentId || '').trim(),
        reasonCode: String(req.body?.reasonCode || '').trim(),
        evidenceDigest: String(req.body?.evidenceDigest || '').trim(),
        idempotencyKey: String(req.body?.idempotencyKey || '').trim(),
      });
      return res.status(result.replayed ? 200 : 201).json({ ok: true, ...result });
    } catch (error) {
      if (sendAuthActorError(res, error)) return;
      if (sendPlatformSafetyError(res, error)) return;
      next(error);
    }
  });

  router.post('/incidents/:incidentId/review', async (req, res, next) => {
    try {
      const actor = await requireActor(req);
      const result = await reviewPlatformSafetyIncident(prisma, {
        reviewerPubkey: actor.pubkey,
        incidentId: String(req.params.incidentId || '').trim(),
        reasonCode: String(req.body?.reasonCode || '').trim(),
        evidenceDigest: String(req.body?.evidenceDigest || '').trim(),
        idempotencyKey: String(req.body?.idempotencyKey || '').trim(),
      });
      return res.status(result.replayed ? 200 : 201).json({ ok: true, ...result });
    } catch (error) {
      if (sendAuthActorError(res, error)) return;
      if (sendPlatformSafetyError(res, error)) return;
      next(error);
    }
  });

  return router;
}

function sendPlatformSafetyError(res: any, error: unknown): boolean {
  if (!(error instanceof PlatformSafetyError)) return false;
  res.status(error.statusCode).json({ error: error.code });
  return true;
}
