import { Router, Request, Response } from 'express';
import { PrismaClient } from '@prisma/client';
import { Redis } from 'ioredis';
import { loadKnowledgeVersionDiff } from '../services/knowledgeVersionDiff';
import { resolveExpressRequestLocale } from '../i18n/request';

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

    router.get('/:knowledgeId/version-diff', async (req: Request, res: Response) => {
        try {
            const knowledgeId = String(req.params.knowledgeId || '').trim();
            const fromVersion = Number.parseInt(String(req.query.fromVersion || ''), 10);
            const toVersion = Number.parseInt(String(req.query.toVersion || ''), 10);

            if (!knowledgeId || !Number.isInteger(fromVersion) || !Number.isInteger(toVersion)) {
                return res.status(400).json({ error: 'invalid_version_range' });
            }

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

    router.get('/:knowledgeId/master.json', async (req: Request, res: Response) => {
        try {
            const knowledgeId = String(req.params.knowledgeId || '').trim();
            if (!knowledgeId) {
                return res.status(400).json({ error: 'invalid_knowledge_id' });
            }

            const crystal = await prisma.knowledge.findUnique({
                where: { knowledgeId },
                select: {
                    id: true,
                    knowledgeId: true,
                    circleId: true,
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

            const [crystals, total] = await Promise.all([
                prisma.knowledge.findMany({
                    where: { circleId },
                    take: limit,
                    skip: offset,
                    orderBy: { qualityScore: 'desc' },
                    include: {
                        author: true,
                        circle: true,
                    },
                }),
                prisma.knowledge.count({ where: { circleId } }),
            ]);

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
