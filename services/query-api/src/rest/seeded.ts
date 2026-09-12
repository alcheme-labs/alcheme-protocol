import { Router } from 'express';
import type { PrismaClient } from '@prisma/client';
import type { Redis } from 'ioredis';

import { requirePrivateSidecarSurface } from '../config/services';
import { requireCircleActor, requireCircleManagerActor } from '../services/auth/actor';
import { sendAuthActorError } from '../services/auth/actorPermissions';
import { normalizeCircleGenesisMode } from '../services/circleGenesisMode';
import {
    importSeededSources,
    SEEDED_PLAINTEXT_CUSTODY,
    type SeededImportFileInput,
} from '../services/seeded/importer';
import { markCircleTopicProfileDirty } from '../services/discussion/analysis/invalidation';
import { listSeededFileTree } from '../services/seeded/file-tree';
import { resolveSeededReference } from '../services/seeded/reference-parser';
import {
    buildCircleSeededReplaceManifestDigest,
    CIRCLE_SEEDED_REPLACE_MANIFEST_ACTION_TYPE,
    evaluateCircleSeededGovernance,
    stageCircleSeededReplaceManifestPayload,
} from '../services/governance/circleSeededGovernance';

function normalizeSeededFiles(value: unknown): SeededImportFileInput[] {
    if (!Array.isArray(value)) return [];
    return value
        .map((item) => ({
            path: typeof item?.path === 'string' ? item.path : '',
            content: typeof item?.content === 'string' ? item.content : '',
            mimeType: typeof item?.mimeType === 'string' ? item.mimeType : null,
        }))
        .filter((item) => item.path.trim().length > 0);
}

export function seededRouter(prisma: PrismaClient, redis: Redis): Router {
    const router = Router();

    router.get('/:id/seeded/tree', async (req, res, next) => {
        try {
            const gate = requirePrivateSidecarSurface('seeded');
            if (!gate.ok) {
                return res.status(gate.statusCode).json({
                    error: gate.error,
                    route: gate.route,
                });
            }

            const circleId = Number.parseInt(String(req.params.id || ''), 10);
            if (!Number.isFinite(circleId) || circleId <= 0) {
                return res.status(400).json({ error: 'invalid_circle_id' });
            }

            const circle = await prisma.circle.findUnique({
                where: { id: circleId },
                select: {
                    id: true,
                    genesisMode: true,
                },
            });
            if (!circle) {
                return res.status(404).json({ error: 'circle_not_found' });
            }
            if (normalizeCircleGenesisMode(circle.genesisMode) !== 'SEEDED') {
                return res.status(409).json({ error: 'seeded_genesis_required' });
            }

            await requireCircleActor(req, prisma as any, {
                circleId,
                action: 'circle.read',
                requireSessionCookie: true,
                requireMemberChainPresence: false,
            });

            const tree = await listSeededFileTree(prisma, circleId);
            return res.json({
                ok: true,
                circleId,
                tree,
                custody: SEEDED_PLAINTEXT_CUSTODY,
            });
        } catch (error) {
            if (sendAuthActorError(res, error)) return;
            next(error);
        }
    });

    router.get('/:id/seeded/reference', async (req, res, next) => {
        try {
            const gate = requirePrivateSidecarSurface('seeded');
            if (!gate.ok) {
                return res.status(gate.statusCode).json({
                    error: gate.error,
                    route: gate.route,
                });
            }

            const circleId = Number.parseInt(String(req.params.id || ''), 10);
            if (!Number.isFinite(circleId) || circleId <= 0) {
                return res.status(400).json({ error: 'invalid_circle_id' });
            }

            const circle = await prisma.circle.findUnique({
                where: { id: circleId },
                select: {
                    id: true,
                    genesisMode: true,
                },
            });
            if (!circle) {
                return res.status(404).json({ error: 'circle_not_found' });
            }
            if (normalizeCircleGenesisMode(circle.genesisMode) !== 'SEEDED') {
                return res.status(409).json({ error: 'seeded_genesis_required' });
            }

            await requireCircleActor(req, prisma as any, {
                circleId,
                action: 'circle.read',
                requireSessionCookie: true,
                requireMemberChainPresence: false,
            });

            const ref = typeof req.query?.ref === 'string' ? req.query.ref : '';
            if (!ref) {
                return res.status(400).json({ error: 'seeded_reference_required' });
            }

            const reference = await resolveSeededReference(prisma, {
                circleId,
                value: ref,
            });
            if (!reference) {
                return res.status(404).json({ error: 'seeded_reference_not_found' });
            }

            return res.json({
                ok: true,
                circleId,
                reference,
                custody: SEEDED_PLAINTEXT_CUSTODY,
            });
        } catch (error) {
            if (sendAuthActorError(res, error)) return;
            next(error);
        }
    });

    router.post('/:id/seeded/import', async (req, res, next) => {
        try {
            const gate = requirePrivateSidecarSurface('seeded');
            if (!gate.ok) {
                return res.status(gate.statusCode).json({
                    error: gate.error,
                    route: gate.route,
                });
            }

            const circleId = Number.parseInt(String(req.params.id || ''), 10);
            if (!Number.isFinite(circleId) || circleId <= 0) {
                return res.status(400).json({ error: 'invalid_circle_id' });
            }

            const circle = await prisma.circle.findUnique({
                where: { id: circleId },
                select: {
                    id: true,
                    genesisMode: true,
                },
            });
            if (!circle) {
                return res.status(404).json({ error: 'circle_not_found' });
            }

            if (normalizeCircleGenesisMode(circle.genesisMode) !== 'SEEDED') {
                return res.status(409).json({ error: 'seeded_genesis_required' });
            }
            const actor = await requireCircleManagerActor(req, prisma as any, {
                circleId,
                requireSessionCookie: true,
            });

            const files = normalizeSeededFiles(req.body?.files);
            if (files.length === 0) {
                return res.status(400).json({ error: 'seeded_files_required' });
            }

            const manifestDigest = buildCircleSeededReplaceManifestDigest(files);
            const governance = await evaluateCircleSeededGovernance(prisma, {
                circleId,
                actorPubkey: actor.pubkey,
                directAllowed: true,
                manifestDigest,
                buildPayload: () => stageCircleSeededReplaceManifestPayload({
                    circleId,
                    files,
                }),
            });
            if (governance.status === 'requires_governance') {
                return res.status(202).json({
                    status: 'requires_governance',
                    actionType: CIRCLE_SEEDED_REPLACE_MANIFEST_ACTION_TYPE,
                    request: governance.request,
                    custody: SEEDED_PLAINTEXT_CUSTODY,
                });
            }
            if (governance.status === 'denied') {
                return res.status(403).json({ error: governance.error });
            }

            const imported = await importSeededSources(prisma, {
                circleId,
                files,
            });

            try {
                await markCircleTopicProfileDirty({
                    prisma,
                        redis,
                        circleId,
                        reason: 'seeded_import_completed',
                        requestedByUserId: actor.userId,
                    });
            } catch {
                // best effort only
            }

            return res.json({
                ok: true,
                circleId,
                fileCount: imported.fileCount,
                nodeCount: imported.nodeCount,
                manifest: {
                    digest: imported.manifestDigest,
                },
                custody: SEEDED_PLAINTEXT_CUSTODY,
            });
        } catch (error) {
            if (sendAuthActorError(res, error)) return;
            next(error);
        }
    });

    return router;
}
