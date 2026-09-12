import { Router, Request, Response } from 'express';
import { PrismaClient } from '@prisma/client';
import { Redis } from 'ioredis';
import { loadKnowledgeVersionDiff } from '../services/knowledgeVersionDiff';
import { resolveExpressRequestLocale } from '../i18n/request';
import { loadCrystalContributionTrace } from '../services/contributionAssessment/trace';
import {
    acceptContributionCredentialClaim,
    ContributionCredentialClaimError,
    loadContributionCredentialClaimReadback,
    prepareContributionCredentialClaim,
} from '../services/contributionAssessment/contributionCredentialClaimRuntime';
import {
    AuthActorError,
    requireCircleActorForAuthActor,
    resolveAuthenticatedActor,
} from '../services/auth/actor';
import { isKnowledgePublicationPubliclyReadable } from '../services/knowledgePublicationLicense';
import {
    destroyKnowledgeContent,
    exportKnowledgeDurability,
    KnowledgeDurabilityError,
    loadKnowledgeDurabilityReadback,
    repairKnowledgeDurability,
    verifyKnowledgeDurability,
} from '../services/knowledgeDurability';

function sendCrystalMetadata(res: Response, payload: Record<string, unknown>) {
    res.setHeader('Cache-Control', 'public, max-age=300');
    return res.json(payload);
}

function buildAttributes(entries: Array<{ trait_type: string; value: string | number | null | undefined }>) {
    return entries
        .filter((entry) => entry.value !== null && entry.value !== undefined && String(entry.value).length > 0)
        .map((entry) => ({
            trait_type: entry.trait_type,
            value: entry.value,
        }));
}

export function crystalRouter(prisma: PrismaClient, redis: Redis): Router {
    const router = Router();

    async function canReadKnowledge(req: Request, knowledge: {
        publicationState: string;
        knowledgeId: string;
        version: number;
        publicationLicenseRef?: string | null;
        publicationLicenseVersion?: string | null;
        publicationLicenseDigest?: string | null;
        publicationSourceSnapshotDigest?: string | null;
        stablePublicPath?: string | null;
        authorId: number;
        circleId: number;
    }): Promise<boolean> {
        if (knowledge.publicationState === 'published' && await isKnowledgePublicationPubliclyReadable({
            prisma,
            knowledge,
        })) return true;
        const actor = await resolveAuthenticatedActor(req, prisma, { requireSessionCookie: true });
        if (!actor) return false;
        if (actor.userId === knowledge.authorId) return true;
        try {
            await requireCircleActorForAuthActor(actor, prisma, {
                circleId: knowledge.circleId,
                action: 'public.read',
                requireMemberChainPresence: false,
            });
            return true;
        } catch (error) {
            if (error instanceof AuthActorError && error.code === 'circle_membership_required') return false;
            throw error;
        }
    }

    async function requireReadableKnowledge(req: Request, res: Response, knowledgeId: string) {
        const knowledge = await prisma.knowledge.findUnique({
            where: { knowledgeId },
            select: {
                knowledgeId: true,
                version: true,
                publicationState: true,
                publicationLicenseRef: true,
                publicationLicenseVersion: true,
                publicationLicenseDigest: true,
                publicationSourceSnapshotDigest: true,
                stablePublicPath: true,
                authorId: true,
                circleId: true,
            },
        });
        if (!knowledge || !await canReadKnowledge(req, knowledge)) {
            res.status(404).json({ error: 'knowledge_not_found' });
            return null;
        }
        return knowledge;
    }

    async function requireCredentialClaimActor(req: Request, res: Response) {
        const actor = await resolveAuthenticatedActor(req, prisma, { requireSessionCookie: true });
        if (!actor) {
            res.status(401).json({ error: 'auth_session_required' });
            return null;
        }
        return actor;
    }

    async function requireDurabilityOperator(req: Request, res: Response, knowledgeId: string) {
        const knowledge = await prisma.knowledge.findUnique({
            where: { knowledgeId },
            select: { authorId: true, circleId: true },
        });
        if (!knowledge) {
            res.status(404).json({ error: 'knowledge_not_found' });
            return null;
        }
        const actor = await resolveAuthenticatedActor(req, prisma, { requireSessionCookie: true });
        if (!actor) {
            res.status(401).json({ error: 'auth_session_required' });
            return null;
        }
        if (actor.userId !== knowledge.authorId) {
            await requireCircleActorForAuthActor(actor, prisma, {
                circleId: knowledge.circleId,
                action: 'circle.manage',
                minRole: 'Moderator',
            });
        }
        return actor;
    }

    function sendDurabilityError(res: Response, error: unknown): boolean {
        if (error instanceof KnowledgeDurabilityError) {
            res.status(error.statusCode).json({ error: error.code, message: error.message });
            return true;
        }
        if (error instanceof AuthActorError) {
            res.status(error.statusCode).json(error.toResponseBody());
            return true;
        }
        return false;
    }

    router.get('/:knowledgeId/contribution-trace', async (req: Request, res: Response, next) => {
        try {
            const knowledgeId = String(req.params.knowledgeId || '').trim();
            if (!knowledgeId) {
                return res.status(400).json({ error: 'invalid_knowledge_id' });
            }
            if (!await requireReadableKnowledge(req, res, knowledgeId)) return;

            const trace = await loadCrystalContributionTrace(prisma, {
                knowledgeId,
                includePrivateDraftEvidence: false,
            });
            if (!trace) {
                return res.status(404).json({ error: 'knowledge_not_found' });
            }
            return res.json(trace);
        } catch (error) {
            next(error);
        }
    });

    router.get('/:knowledgeId/credential-claim', async (req: Request, res: Response, next) => {
        try {
            const knowledgeId = String(req.params.knowledgeId || '').trim();
            if (!knowledgeId) return res.status(400).json({ error: 'invalid_knowledge_id' });
            const actor = await requireCredentialClaimActor(req, res);
            if (!actor || !await requireReadableKnowledge(req, res, knowledgeId)) return;
            return res.json({
                ok: true,
                readback: await loadContributionCredentialClaimReadback({
                    prisma,
                    knowledgeId,
                    actorPubkey: actor.pubkey,
                }),
            });
        } catch (error) {
            if (error instanceof ContributionCredentialClaimError) {
                return res.status(error.statusCode).json(error.toResponseBody());
            }
            next(error);
        }
    });

    router.post('/:knowledgeId/credential-claim/prepare', async (req: Request, res: Response, next) => {
        try {
            const knowledgeId = String(req.params.knowledgeId || '').trim();
            if (!knowledgeId) return res.status(400).json({ error: 'invalid_knowledge_id' });
            const actor = await requireCredentialClaimActor(req, res);
            if (!actor || !await requireReadableKnowledge(req, res, knowledgeId)) return;
            return res.json({
                ok: true,
                preparation: await prepareContributionCredentialClaim({
                    prisma,
                    knowledgeId,
                    actorPubkey: actor.pubkey,
                    payerMode: req.body?.payerMode,
                    visibility: req.body?.visibility,
                }),
            });
        } catch (error) {
            if (error instanceof ContributionCredentialClaimError) {
                return res.status(error.statusCode).json(error.toResponseBody());
            }
            next(error);
        }
    });

    router.post('/:knowledgeId/credential-claim/accept', async (req: Request, res: Response, next) => {
        try {
            const knowledgeId = String(req.params.knowledgeId || '').trim();
            if (!knowledgeId) return res.status(400).json({ error: 'invalid_knowledge_id' });
            const actor = await requireCredentialClaimActor(req, res);
            if (!actor || !await requireReadableKnowledge(req, res, knowledgeId)) return;
            return res.json({
                ok: true,
                result: await acceptContributionCredentialClaim({
                    prisma,
                    knowledgeId,
                    actorPubkey: actor.pubkey,
                    signedMessage: String(req.body?.signedMessage || ''),
                    signature: String(req.body?.signature || ''),
                }),
            });
        } catch (error) {
            if (error instanceof ContributionCredentialClaimError) {
                return res.status(error.statusCode).json(error.toResponseBody());
            }
            next(error);
        }
    });

    router.get('/:knowledgeId/version-diff', async (req: Request, res: Response) => {
        try {
            const knowledgeId = String(req.params.knowledgeId || '').trim();
            const fromVersion = Number.parseInt(String(req.query.fromVersion || ''), 10);
            const toVersion = Number.parseInt(String(req.query.toVersion || ''), 10);

            if (!knowledgeId || !Number.isInteger(fromVersion) || !Number.isInteger(toVersion)) {
                return res.status(400).json({ error: 'invalid_version_range' });
            }
            if (!await requireReadableKnowledge(req, res, knowledgeId)) return;

            const diff = await loadKnowledgeVersionDiff(prisma, {
                knowledgeId,
                fromVersion,
                toVersion,
                locale: resolveExpressRequestLocale(req),
            });

            if (!diff) {
                return res.status(404).json({ error: 'knowledge_version_diff_not_found' });
            }

            return res.json({
                ok: true,
                diff,
            });
        } catch (error) {
            console.error('Error fetching knowledge version diff:', error);
            return res.status(500).json({ error: 'Internal server error' });
        }
    });

    router.get('/:knowledgeId/durability', async (req: Request, res: Response, next) => {
        try {
            const knowledgeId = String(req.params.knowledgeId || '').trim();
            if (!knowledgeId) return res.status(400).json({ error: 'invalid_knowledge_id' });
            if (!await requireReadableKnowledge(req, res, knowledgeId)) return;
            return res.json({
                ok: true,
                durability: await loadKnowledgeDurabilityReadback({ prisma, knowledgeId }),
            });
        } catch (error) {
            if (sendDurabilityError(res, error)) return;
            next(error);
        }
    });

    router.post('/:knowledgeId/durability/verify', async (req: Request, res: Response, next) => {
        try {
            const knowledgeId = String(req.params.knowledgeId || '').trim();
            if (!knowledgeId) return res.status(400).json({ error: 'invalid_knowledge_id' });
            const actor = await requireDurabilityOperator(req, res, knowledgeId);
            if (!actor) return;
            return res.json({
                ok: true,
                durability: await verifyKnowledgeDurability({
                    prisma,
                    knowledgeId,
                    actorPubkey: actor.pubkey,
                }),
            });
        } catch (error) {
            if (sendDurabilityError(res, error)) return;
            next(error);
        }
    });

    router.post('/:knowledgeId/durability/repair', async (req: Request, res: Response, next) => {
        try {
            const knowledgeId = String(req.params.knowledgeId || '').trim();
            if (!knowledgeId) return res.status(400).json({ error: 'invalid_knowledge_id' });
            const actor = await requireDurabilityOperator(req, res, knowledgeId);
            if (!actor) return;
            return res.json({
                ok: true,
                durability: await repairKnowledgeDurability({
                    prisma,
                    knowledgeId,
                    actorPubkey: actor.pubkey,
                }),
            });
        } catch (error) {
            if (sendDurabilityError(res, error)) return;
            next(error);
        }
    });

    router.post('/:knowledgeId/durability/delete', async (req: Request, res: Response, next) => {
        try {
            const knowledgeId = String(req.params.knowledgeId || '').trim();
            if (!knowledgeId) return res.status(400).json({ error: 'invalid_knowledge_id' });
            const knowledge = await prisma.knowledge.findUnique({
                where: { knowledgeId },
                select: { authorId: true },
            });
            if (!knowledge) return res.status(404).json({ error: 'knowledge_not_found' });
            const actor = await resolveAuthenticatedActor(req, prisma, { requireSessionCookie: true });
            if (!actor) return res.status(401).json({ error: 'auth_session_required' });
            if (actor.userId !== knowledge.authorId) {
                return res.status(403).json({ error: 'knowledge_author_required' });
            }
            if (String(req.body?.confirmKnowledgeId || '').trim() !== knowledgeId) {
                return res.status(400).json({ error: 'knowledge_deletion_confirmation_required' });
            }
            return res.json({
                ok: true,
                deletion: await destroyKnowledgeContent({
                    prisma,
                    knowledgeId,
                    authorUserId: actor.userId,
                    actorPubkey: actor.pubkey,
                }),
            });
        } catch (error) {
            if (sendDurabilityError(res, error)) return;
            next(error);
        }
    });

    router.get('/:knowledgeId/durability/export', async (req: Request, res: Response, next) => {
        try {
            const knowledgeId = String(req.params.knowledgeId || '').trim();
            if (!knowledgeId) return res.status(400).json({ error: 'invalid_knowledge_id' });
            if (!await requireReadableKnowledge(req, res, knowledgeId)) return;
            const exported = await exportKnowledgeDurability({ prisma, knowledgeId });
            res.setHeader(
                'Content-Disposition',
                `attachment; filename="alcheme-knowledge-${encodeURIComponent(knowledgeId)}-durability.json"`,
            );
            return res.json(exported);
        } catch (error) {
            if (sendDurabilityError(res, error)) return;
            next(error);
        }
    });

    router.get('/:knowledgeId/master.json', async (req: Request, res: Response) => {
        try {
            const knowledgeId = String(req.params.knowledgeId || '').trim();
            if (!knowledgeId) {
                return res.status(400).json({ error: 'invalid_knowledge_id' });
            }
            if (!await requireReadableKnowledge(req, res, knowledgeId)) return;

            const crystal = await prisma.knowledge.findUnique({
                where: { knowledgeId },
                select: {
                    id: true,
                    knowledgeId: true,
                    circleId: true,
                    authorId: true,
                    publicationState: true,
                    title: true,
                    description: true,
                    crystalParams: true,
                    author: {
                        select: {
                            pubkey: true,
                        },
                    },
                    binding: {
                        select: {
                            proofPackageHash: true,
                            sourceAnchorId: true,
                            contributorsRoot: true,
                            contributorsCount: true,
                        },
                    },
                    crystalAsset: {
                        select: {
                            ownerPubkey: true,
                            proofPackageHash: true,
                            sourceAnchorId: true,
                            contributorsRoot: true,
                            contributorsCount: true,
                        },
                    },
                },
            });

            if (!crystal) {
                return res.status(404).json({ error: 'crystal_metadata_not_found' });
            }

            const proof = crystal.crystalAsset || crystal.binding;
            if (!proof) {
                return res.status(409).json({ error: 'crystal_metadata_not_ready' });
            }

            const ownerPubkey = crystal.crystalAsset?.ownerPubkey || crystal.author?.pubkey || null;
            return sendCrystalMetadata(res, {
                name: crystal.title || `Alcheme Crystal ${crystal.knowledgeId}`,
                symbol: 'ALCH-X',
                description: crystal.description || 'Alcheme crystallized knowledge master asset.',
                kind: 'master',
                knowledgePublicId: crystal.knowledgeId,
                circleId: crystal.circleId,
                ownerPubkey,
                proofPackageHash: proof.proofPackageHash,
                sourceAnchorId: proof.sourceAnchorId,
                contributorsRoot: proof.contributorsRoot,
                contributorsCount: proof.contributorsCount,
                crystalParams: crystal.crystalParams || null,
                attributes: buildAttributes([
                    { trait_type: 'Kind', value: 'Master Crystal' },
                    { trait_type: 'Circle ID', value: crystal.circleId },
                    { trait_type: 'Contributors', value: proof.contributorsCount },
                    { trait_type: 'Proof Package Hash', value: proof.proofPackageHash },
                    { trait_type: 'Source Anchor', value: proof.sourceAnchorId },
                ]),
            });
        } catch (error) {
            console.error('Error fetching crystal master metadata:', error);
            return res.status(500).json({ error: 'Internal server error' });
        }
    });

    router.get('/:knowledgeId/receipts/:ownerPubkey.json', async (req: Request, res: Response) => {
        try {
            const knowledgeId = String(req.params.knowledgeId || '').trim();
            const ownerPubkey = String(req.params.ownerPubkey || '').trim();
            if (!knowledgeId || !ownerPubkey) {
                return res.status(400).json({ error: 'invalid_crystal_receipt_metadata_request' });
            }
            if (!await requireReadableKnowledge(req, res, knowledgeId)) return;

            const receipt = await prisma.crystalReceipt.findFirst({
                where: {
                    knowledgePublicId: knowledgeId,
                    ownerPubkey,
                },
                select: {
                    entitlementId: true,
                    knowledgePublicId: true,
                    circleId: true,
                    ownerPubkey: true,
                    contributionRole: true,
                    contributionWeightBps: true,
                    proofPackageHash: true,
                    sourceAnchorId: true,
                    contributorsRoot: true,
                    contributorsCount: true,
                    knowledge: {
                        select: {
                            title: true,
                            description: true,
                        },
                    },
                },
            });

            if (!receipt) {
                return res.status(404).json({ error: 'crystal_receipt_metadata_not_found' });
            }

            return sendCrystalMetadata(res, {
                name: `Alcheme Receipt ${receipt.knowledgePublicId}`,
                symbol: 'ALCH-R',
                description: receipt.knowledge.description || `Contributor receipt for ${receipt.knowledge.title}`,
                kind: 'receipt',
                entitlementId: receipt.entitlementId,
                knowledgePublicId: receipt.knowledgePublicId,
                circleId: receipt.circleId,
                ownerPubkey: receipt.ownerPubkey,
                contributionRole: receipt.contributionRole,
                contributionWeightBps: receipt.contributionWeightBps,
                proofPackageHash: receipt.proofPackageHash,
                sourceAnchorId: receipt.sourceAnchorId,
                contributorsRoot: receipt.contributorsRoot,
                contributorsCount: receipt.contributorsCount,
                attributes: buildAttributes([
                    { trait_type: 'Kind', value: 'Contributor Receipt' },
                    { trait_type: 'Circle ID', value: receipt.circleId },
                    { trait_type: 'Contribution Role', value: receipt.contributionRole },
                    { trait_type: 'Contribution Weight BPS', value: receipt.contributionWeightBps },
                    { trait_type: 'Contributors', value: receipt.contributorsCount },
                    { trait_type: 'Proof Package Hash', value: receipt.proofPackageHash },
                    { trait_type: 'Source Anchor', value: receipt.sourceAnchorId },
                ]),
            });
        } catch (error) {
            console.error('Error fetching crystal receipt metadata:', error);
            return res.status(500).json({ error: 'Internal server error' });
        }
    });

    // GET /crystals/:knowledgeId - 获取单个知识晶体
    router.get('/:knowledgeId', async (req: Request, res: Response) => {
        try {
            const { knowledgeId } = req.params;

            const crystal = await prisma.knowledge.findUnique({
                where: { knowledgeId },
                include: {
                    author: true,
                    circle: true,
                    sourceCircle: true,
                },
            });

            if (!crystal) {
                return res.status(404).json({ error: 'Knowledge crystal not found' });
            }
            if (!await canReadKnowledge(req, crystal)) {
                return res.status(404).json({ error: 'Knowledge crystal not found' });
            }

            return res.json({
                data: {
                    ...crystal,
                    qualityScore: parseFloat(crystal.qualityScore as any) || 0,
                },
            });
        } catch (error) {
            console.error('Error fetching crystal:', error);
            return res.status(500).json({ error: 'Internal server error' });
        }
    });

    // GET /crystals/circle/:circleId - 获取圈子的知识晶体列表
    router.get('/circle/:circleId', async (req: Request, res: Response) => {
        try {
            const circleId = parseInt(req.params.circleId);
            const limit = parseInt(req.query.limit as string) || 20;
            const offset = parseInt(req.query.offset as string) || 0;

            if (isNaN(circleId)) {
                return res.status(400).json({ error: 'Invalid circle ID' });
            }

            const actor = await resolveAuthenticatedActor(req, prisma, { requireSessionCookie: true });
            let canReadRestricted = false;
            if (actor) {
                try {
                    await requireCircleActorForAuthActor(actor, prisma, {
                        circleId,
                        action: 'public.read',
                        requireMemberChainPresence: false,
                    });
                    canReadRestricted = true;
                } catch (error) {
                    if (!(error instanceof AuthActorError && error.code === 'circle_membership_required')) throw error;
                }
            }
            const where = {
                circleId,
                ...(canReadRestricted ? {} : { publicationState: 'published' }),
            };
            const candidates = await prisma.knowledge.findMany({
                where,
                ...(canReadRestricted ? { take: limit, skip: offset } : {}),
                orderBy: { qualityScore: 'desc' },
                include: {
                    author: true,
                    circle: true,
                },
            });
            const readable = canReadRestricted
                ? candidates
                : (await Promise.all(candidates.map(async (knowledge) => ({
                    knowledge,
                    readable: await isKnowledgePublicationPubliclyReadable({ prisma, knowledge }),
                }))))
                    .filter((entry) => entry.readable)
                    .map((entry) => entry.knowledge);
            const crystals = canReadRestricted ? readable : readable.slice(offset, offset + limit);
            const total = canReadRestricted
                ? await prisma.knowledge.count({ where })
                : readable.length;

            return res.json({
                data: crystals.map((c: any) => ({
                    ...c,
                    qualityScore: parseFloat(c.qualityScore) || 0,
                })),
                pagination: {
                    total,
                    limit,
                    offset,
                    hasMore: offset + limit < total,
                },
            });
        } catch (error) {
            console.error('Error fetching crystals:', error);
            return res.status(500).json({ error: 'Internal server error' });
        }
    });

    return router;
}
