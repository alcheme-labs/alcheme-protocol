import { Router } from 'express';
import type { PrismaClient } from '@prisma/client';
import type { Redis } from 'ioredis';

import { requirePrivateSidecarSurface } from '../config/services';
import { requireAuthenticatedActor } from '../services/auth/actor';
import {
    requireCircleManagerForActor,
    sendAuthActorError,
} from '../services/auth/actorPermissions';
import { enqueueAiJob } from '../services/aiJobs/runtime';
import {
    buildContextCapsule,
    persistContextCapsule,
} from '../services/aiOperatingLayer/contextFabric';
import {
    applyGuardianFindingAction,
    convertGuardianFindingToProposal,
} from '../services/aiOperatingLayer/guardian/findings';

const FINDING_STATUSES = new Set(['open', 'acknowledged', 'dismissed', 'snoozed', 'converted']);
const FINDING_LEVELS = new Set(['observe', 'notify', 'propose']);
const FORBIDDEN_RESPONSE_KEYS = new Set([
    'rawText',
    'rawTextLocator',
    'text',
    'sourceExcerpt',
    'privateText',
    'providerRawResponse',
    'rawPrompt',
]);

export function guardianFindingsRouter(prisma: PrismaClient, _redis: Redis): Router {
    const router = Router();

    router.use('/guardian-findings', (_req, res, next) => {
        if (!isGuardianUserApiEnabled()) {
            return res.status(404).json({ error: 'guardian_user_api_disabled' });
        }
        return next();
    });

    router.get('/guardian-findings', async (req, res, next) => {
        try {
            const actor = await requireAuthenticatedActor(req, prisma as any, {
                requireSessionCookie: true,
            });
            const circleId = parsePositiveInt(req.query.circleId);
            if (!circleId) {
                return res.status(400).json({ error: 'invalid_circle_id' });
            }
            await requireCircleManagerForActor(prisma as any, {
                actor,
                circleId,
            });

            const where: Record<string, unknown> = { circleId };
            const status = parseSetValue(req.query.status, FINDING_STATUSES);
            const level = parseSetValue(req.query.level, FINDING_LEVELS);
            if (status) where.status = status;
            if (level) where.level = level;
            const findings = await (prisma as any).guardianFinding.findMany({
                where,
                orderBy: [
                    { createdAt: 'desc' },
                    { id: 'desc' },
                ],
                take: Math.max(1, Math.min(100, parsePositiveInt(req.query.limit) ?? 25)),
            });

            return res.status(200).json({
                ok: true,
                findings: findings.map(serializeFinding),
            });
        } catch (error) {
            if (sendAuthActorError(res, error)) return;
            return next(error);
        }
    });

    router.post('/guardian-findings/diagnose', async (req, res, next) => {
        try {
            if (!isGuardianEnabled()) {
                return res.status(200).json({
                    ok: true,
                    status: 'disabled',
                    reasonCode: 'guardian_disabled',
                });
            }
            const gate = requirePrivateSidecarSurface('ghost_draft_private');
            if (!gate.ok) {
                return res.status(gate.statusCode).json({
                    error: gate.error,
                    route: gate.route,
                });
            }
            const actor = await requireAuthenticatedActor(req, prisma as any, {
                requireSessionCookie: true,
            });
            const circleId = parsePositiveInt(req.body?.circleId);
            if (!circleId) {
                return res.status(400).json({ error: 'invalid_circle_id' });
            }
            await requireCircleManagerForActor(prisma as any, {
                actor,
                circleId,
            });

            const reason = normalizeReason(req.body?.reason) ?? 'manual_check';
            const context = buildContextCapsule({
                taskType: 'guardian.finding.watch.v1',
                subjectType: 'circle',
                subjectId: String(circleId),
                actorUserId: actor.userId,
                visibility: 'member_visible',
                runtimeRole: 'PUBLIC_NODE',
                evidenceRefs: [],
                contextPayload: {
                    kind: 'guardian_finding_watch.v1',
                    circleId,
                    reason,
                    ruleVersion: 'guardian-source-review-backlog-v1',
                },
                excerptPolicy: {
                    mode: 'metadata_only',
                    redaction: 'guardian_finding_v1',
                },
                tokenBudget: {
                    maxInputTokens: 500,
                    maxOutputTokens: 0,
                    maxEvidenceRefs: 0,
                },
                privatePlaintextMode: 'member_visible',
            });
            if (!context.ok) {
                return res.status(400).json({ error: `guardian_context_rejected:${context.error}` });
            }
            await persistContextCapsule(prisma as any, context.capsule, {
                cacheKey: `guardian_finding:${circleId}:${reason}:${dayBucket(new Date())}`,
                expiresAt: new Date(Date.now() + 24 * 3_600_000),
            });

            const job = await enqueueAiJob(prisma as any, {
                jobType: 'guardian_finding_generate',
                taskType: 'guardian.finding.watch.v1',
                taskCatalogVersion: 'v1',
                contextCapsuleId: context.capsule.id,
                dedupeKey: `guardian:diagnose:${circleId}:${dayBucket(new Date())}`,
                scopeType: 'circle',
                scopeCircleId: circleId,
                requestedByUserId: actor.userId,
                payload: {
                    circleId,
                    reason,
                },
            });

            return res.status(202).json({
                ok: true,
                status: 'queued',
                jobId: job.id,
                contextCapsuleId: context.capsule.id,
            });
        } catch (error) {
            if (sendAuthActorError(res, error)) return;
            return next(error);
        }
    });

    router.get('/guardian-findings/:findingId', async (req, res, next) => {
        try {
            const actor = await requireAuthenticatedActor(req, prisma as any, {
                requireSessionCookie: true,
            });
            const finding = await loadFindingOr404(prisma as any, req.params.findingId);
            if (!finding) {
                return res.status(404).json({ error: 'guardian_finding_not_found' });
            }
            await requireCircleManagerForActor(prisma as any, {
                actor,
                circleId: Number(finding.circleId),
            });
            const events = await (prisma as any).guardianFindingEvent.findMany({
                where: { findingId: finding.id },
                orderBy: { createdAt: 'desc' },
                take: 25,
            });
            return res.status(200).json({
                ok: true,
                finding: serializeFinding(finding),
                events: events.map(serializeEvent),
            });
        } catch (error) {
            if (sendAuthActorError(res, error)) return;
            return next(error);
        }
    });

    router.post('/guardian-findings/:findingId/ack', async (req, res, next) => {
        try {
            const gate = requirePrivateSidecarSurface('ghost_draft_private');
            if (!gate.ok) {
                return res.status(gate.statusCode).json({
                    error: gate.error,
                    route: gate.route,
                });
            }
            const { actor } = await requireFindingManager(req, prisma as any);
            const finding = await applyGuardianFindingAction(prisma as any, {
                findingId: req.params.findingId,
                actorUserId: actor.userId,
                action: 'ack',
            });
            return res.status(200).json({ ok: true, finding: serializeFinding(finding) });
        } catch (error) {
            if (sendAuthActorError(res, error)) return;
            return sendGuardianErrorOrNext(res, next, error);
        }
    });

    router.post('/guardian-findings/:findingId/dismiss', async (req, res, next) => {
        try {
            const gate = requirePrivateSidecarSurface('ghost_draft_private');
            if (!gate.ok) {
                return res.status(gate.statusCode).json({
                    error: gate.error,
                    route: gate.route,
                });
            }
            const { actor } = await requireFindingManager(req, prisma as any);
            const finding = await applyGuardianFindingAction(prisma as any, {
                findingId: req.params.findingId,
                actorUserId: actor.userId,
                action: 'dismiss',
                reason: req.body?.reason,
            });
            return res.status(200).json({ ok: true, finding: serializeFinding(finding) });
        } catch (error) {
            if (sendAuthActorError(res, error)) return;
            return sendGuardianErrorOrNext(res, next, error);
        }
    });

    router.post('/guardian-findings/:findingId/snooze', async (req, res, next) => {
        try {
            const gate = requirePrivateSidecarSurface('ghost_draft_private');
            if (!gate.ok) {
                return res.status(gate.statusCode).json({
                    error: gate.error,
                    route: gate.route,
                });
            }
            const { actor } = await requireFindingManager(req, prisma as any);
            const finding = await applyGuardianFindingAction(prisma as any, {
                findingId: req.params.findingId,
                actorUserId: actor.userId,
                action: 'snooze',
                reason: req.body?.reason,
                snoozeUntil: req.body?.snoozeUntil,
            });
            return res.status(200).json({ ok: true, finding: serializeFinding(finding) });
        } catch (error) {
            if (sendAuthActorError(res, error)) return;
            return sendGuardianErrorOrNext(res, next, error);
        }
    });

    router.post('/guardian-findings/:findingId/convert', async (req, res, next) => {
        try {
            const gate = requirePrivateSidecarSurface('ghost_draft_private');
            if (!gate.ok) {
                return res.status(gate.statusCode).json({
                    error: gate.error,
                    route: gate.route,
                });
            }
            const { actor } = await requireFindingManager(req, prisma as any);
            const proposal = await convertGuardianFindingToProposal(prisma as any, {
                findingId: req.params.findingId,
                actorUserId: actor.userId,
            });
            return res.status(200).json({
                ok: true,
                proposal: sanitizeForResponse(proposal),
            });
        } catch (error) {
            if (sendAuthActorError(res, error)) return;
            return sendGuardianErrorOrNext(res, next, error);
        }
    });

    return router;
}

async function requireFindingManager(req: any, prisma: any) {
    const actor = await requireAuthenticatedActor(req, prisma, {
        requireSessionCookie: true,
    });
    const finding = await loadFindingOr404(prisma, req.params.findingId);
    if (!finding) {
        const error = new Error('guardian_finding_not_found');
        (error as Error & { statusCode?: number }).statusCode = 404;
        throw error;
    }
    await requireCircleManagerForActor(prisma, {
        actor,
        circleId: Number(finding.circleId),
    });
    return { actor, finding };
}

async function loadFindingOr404(prisma: any, findingId: unknown) {
    const id = String(findingId || '').trim();
    if (!id) return null;
    return prisma.guardianFinding.findUnique({
        where: { id },
    });
}

function serializeFinding(row: any) {
    return sanitizeForResponse({
        id: String(row.id),
        ownerUserId: row.ownerUserId ?? null,
        circleId: Number(row.circleId),
        findingKind: String(row.findingKind),
        level: String(row.level),
        riskLevel: String(row.riskLevel),
        severity: String(row.severity),
        status: String(row.status),
        title: String(row.title),
        summary: String(row.summary),
        explanation: String(row.explanation ?? ''),
        evidenceRefs: Array.isArray(row.evidenceRefs) ? row.evidenceRefs : [],
        suggestedAction: row.suggestedAction && typeof row.suggestedAction === 'object'
            ? row.suggestedAction
            : {},
        sourceDigest: String(row.sourceDigest),
        ruleVersion: String(row.ruleVersion),
        modelProfile: row.modelProfile ?? null,
        cooldownUntil: serializeDate(row.cooldownUntil),
        notificationStatus: String(row.notificationStatus ?? 'skipped'),
        notificationError: row.notificationError ?? null,
        convertedProposalId: row.convertedProposalId ?? null,
        createdAt: serializeDate(row.createdAt),
        updatedAt: serializeDate(row.updatedAt),
    });
}

function serializeEvent(row: any) {
    return sanitizeForResponse({
        id: String(row.id),
        findingId: String(row.findingId),
        eventType: String(row.eventType),
        actorUserId: row.actorUserId ?? null,
        eventPayload: row.eventPayload && typeof row.eventPayload === 'object'
            ? row.eventPayload
            : {},
        createdAt: serializeDate(row.createdAt),
    });
}

function sanitizeForResponse(value: unknown): unknown {
    if (!value || typeof value !== 'object') return value;
    if (Array.isArray(value)) {
        return value.map((item) => sanitizeForResponse(item));
    }
    const output: Record<string, unknown> = {};
    for (const [key, nested] of Object.entries(value as Record<string, unknown>)) {
        if (FORBIDDEN_RESPONSE_KEYS.has(key)) continue;
        output[key] = sanitizeForResponse(nested);
    }
    return output;
}

function parsePositiveInt(value: unknown): number | null {
    const parsed = Number.parseInt(String(value ?? ''), 10);
    if (!Number.isFinite(parsed) || parsed <= 0) return null;
    return parsed;
}

function parseSetValue(value: unknown, allowed: Set<string>): string | null {
    const normalized = String(value ?? '').trim().toLowerCase();
    return allowed.has(normalized) ? normalized : null;
}

function normalizeReason(value: unknown): string | null {
    if (typeof value !== 'string') return null;
    const trimmed = value.trim();
    return /^[a-z0-9_.:-]{1,80}$/i.test(trimmed) ? trimmed : null;
}

function serializeDate(value: unknown): string | null {
    if (value instanceof Date) return value.toISOString();
    if (typeof value === 'string' && value.trim()) {
        const date = new Date(value);
        return Number.isNaN(date.getTime()) ? value : date.toISOString();
    }
    return null;
}

function dayBucket(date: Date): string {
    return date.toISOString().slice(0, 10);
}

function isGuardianEnabled(): boolean {
    const normalized = String(process.env.AI_GUARDIAN_ENABLED ?? 'true').trim().toLowerCase();
    return normalized !== 'false' && normalized !== '0' && normalized !== 'off';
}

function isGuardianUserApiEnabled(): boolean {
    const normalized = String(process.env.AI_GUARDIAN_USER_API_ENABLED ?? 'false').trim().toLowerCase();
    return normalized === 'true' || normalized === '1' || normalized === 'on';
}

function sendGuardianErrorOrNext(res: any, next: (error?: unknown) => void, error: unknown) {
    const message = error instanceof Error ? error.message : String(error || '');
    const statusCode = (error as any)?.statusCode;
    if (statusCode === 404 || /guardian_finding_not_found/.test(message)) {
        return res.status(404).json({ error: 'guardian_finding_not_found' });
    }
    if (/guardian_finding_dismiss_reason_required|guardian_finding_snooze_until_required/.test(message)) {
        return res.status(400).json({ error: message });
    }
    if (/guardian_finding_must_be_open|guardian_finding_convert_requires_open_propose|guardian_finding_growth_lifecycle_owned/.test(message)) {
        return res.status(409).json({ error: message });
    }
    return next(error);
}
