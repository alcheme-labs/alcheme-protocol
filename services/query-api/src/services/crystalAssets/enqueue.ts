import type { Prisma, PrismaClient } from '@prisma/client';

import { loadCrystalMintRuntimeConfig } from '../../config/services';
import { enqueueAiJob } from '../aiJobs/runtime';
import { resolveMasterAssetOwnerPubkey } from './mintAdapter';

type PrismaLike = PrismaClient | Prisma.TransactionClient;

export class CrystalAssetProjectionError extends Error {
    constructor(
        public readonly code: string,
        public readonly statusCode: number,
        message?: string,
    ) {
        super(message || code);
        this.name = 'CrystalAssetProjectionError';
    }
}

interface CrystalAssetProjectionSource {
    id: number;
    knowledgeId: string;
    circleId: number;
    title: string;
    description: string | null;
    author: {
        pubkey: string;
    } | null;
    binding: {
        proofPackageHash: string;
        sourceAnchorId: string;
        contributorsRoot: string;
        contributorsCount: number;
    } | null;
    crystalAsset: {
        ownerPubkey: string;
        mintStatus: string;
    } | null;
    crystalEntitlements: Array<{
        id: number;
        ownerPubkey: string;
        ownerUserId: number | null;
        contributionRole: string;
        contributionWeightBps: number;
        proofPackageHash: string;
        sourceAnchorId: string;
        contributorsRoot: string;
        contributorsCount: number;
    }>;
}

async function loadProjectionSource(
    prisma: PrismaLike,
    input: {
        knowledgeRowId?: number;
        knowledgePublicId?: string;
    },
): Promise<CrystalAssetProjectionSource> {
    const where = Number.isFinite(Number(input.knowledgeRowId)) && Number(input.knowledgeRowId) > 0
        ? { id: Number(input.knowledgeRowId) }
        : typeof input.knowledgePublicId === 'string' && input.knowledgePublicId.trim().length > 0
            ? { knowledgeId: input.knowledgePublicId.trim() }
            : null;
    if (!where) {
        throw new CrystalAssetProjectionError(
            'invalid_crystal_asset_source',
            400,
            'knowledge identifier is required for crystal asset projection',
        );
    }

    const knowledge = await prisma.knowledge.findUnique({
        where,
        select: {
            id: true,
            knowledgeId: true,
            circleId: true,
            title: true,
            description: true,
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
                    mintStatus: true,
                },
            },
            crystalEntitlements: {
                where: {
                    status: 'active',
                },
                orderBy: [
                    { contributionWeightBps: 'desc' },
                    { ownerPubkey: 'asc' },
                ],
                select: {
                    id: true,
                    ownerPubkey: true,
                    ownerUserId: true,
                    contributionRole: true,
                    contributionWeightBps: true,
                    proofPackageHash: true,
                    sourceAnchorId: true,
                    contributorsRoot: true,
                    contributorsCount: true,
                },
            },
        },
    });

    if (!knowledge) {
        throw new CrystalAssetProjectionError(
            'knowledge_not_found',
            404,
            'knowledge row was not found for crystal asset projection',
        );
    }
    if (!knowledge.binding) {
        throw new CrystalAssetProjectionError(
            'knowledge_binding_missing',
            409,
            'knowledge binding must exist before crystal asset projection can be prepared',
        );
    }
    if (!knowledge.author?.pubkey) {
        throw new CrystalAssetProjectionError(
            'knowledge_author_missing',
            409,
            'knowledge author pubkey is required before crystal asset projection can be prepared',
        );
    }
    if (!Array.isArray(knowledge.crystalEntitlements) || knowledge.crystalEntitlements.length === 0) {
        throw new CrystalAssetProjectionError(
            'crystal_entitlements_missing',
            409,
            'active crystal entitlements must exist before crystal asset projection can be prepared',
        );
    }

    return knowledge;
}

export async function prepareCrystalAssetProjection(
    prisma: PrismaLike,
    input: {
        knowledgeRowId?: number;
        knowledgePublicId?: string;
        now?: Date;
    },
): Promise<{
        knowledgeRowId: number;
        knowledgePublicId: string;
        circleId: number;
        ownerPubkey: string;
        entitlementCount: number;
        receiptCount: number;
        receiptOwnerPubkeys: string[];
    }> {
    const source = await loadProjectionSource(prisma, input);
    const now = input.now ?? new Date();
    const authorPubkey = source.author!.pubkey;
    const binding = source.binding!;
    const config = loadCrystalMintRuntimeConfig();
    const assetOwnerPubkey = source.crystalAsset?.mintStatus === 'minted' && source.crystalAsset.ownerPubkey
        ? source.crystalAsset.ownerPubkey
        : resolveMasterAssetOwnerPubkey(config, authorPubkey);

    await (prisma as any).crystalAsset.upsert({
        where: {
            knowledgeRowId: source.id,
        },
        create: {
            knowledgeRowId: source.id,
            knowledgePublicId: source.knowledgeId,
            circleId: source.circleId,
            ownerPubkey: assetOwnerPubkey,
            assetStandard: 'pending',
            mintStatus: 'pending',
            metadataUri: null,
            proofPackageHash: binding.proofPackageHash,
            sourceAnchorId: binding.sourceAnchorId,
            contributorsRoot: binding.contributorsRoot,
            contributorsCount: binding.contributorsCount,
            mintedAt: null,
            lastError: null,
            createdAt: now,
            updatedAt: now,
        },
        update: {
            knowledgePublicId: source.knowledgeId,
            circleId: source.circleId,
            ownerPubkey: assetOwnerPubkey,
            proofPackageHash: binding.proofPackageHash,
            sourceAnchorId: binding.sourceAnchorId,
            contributorsRoot: binding.contributorsRoot,
            contributorsCount: binding.contributorsCount,
            updatedAt: now,
        },
    });

    for (const entitlement of source.crystalEntitlements) {
        await (prisma as any).crystalReceipt.upsert({
            where: {
                entitlementId: entitlement.id,
            },
            create: {
                entitlementId: entitlement.id,
                knowledgeRowId: source.id,
                knowledgePublicId: source.knowledgeId,
                circleId: source.circleId,
                ownerPubkey: entitlement.ownerPubkey,
                ownerUserId: entitlement.ownerUserId,
                contributionRole: entitlement.contributionRole,
                contributionWeightBps: entitlement.contributionWeightBps,
                receiptAssetAddress: null,
                assetStandard: 'pending',
                transferMode: 'non_transferable',
                mintStatus: 'pending',
                metadataUri: null,
                proofPackageHash: entitlement.proofPackageHash,
                sourceAnchorId: entitlement.sourceAnchorId,
                contributorsRoot: entitlement.contributorsRoot,
                contributorsCount: entitlement.contributorsCount,
                mintedAt: null,
                lastError: null,
                createdAt: now,
                updatedAt: now,
            },
            update: {
                knowledgeRowId: source.id,
                knowledgePublicId: source.knowledgeId,
                circleId: source.circleId,
                ownerPubkey: entitlement.ownerPubkey,
                ownerUserId: entitlement.ownerUserId,
                contributionRole: entitlement.contributionRole,
                contributionWeightBps: entitlement.contributionWeightBps,
                proofPackageHash: entitlement.proofPackageHash,
                sourceAnchorId: entitlement.sourceAnchorId,
                contributorsRoot: entitlement.contributorsRoot,
                contributorsCount: entitlement.contributorsCount,
                transferMode: 'non_transferable',
                updatedAt: now,
            },
        });
    }

    return {
        knowledgeRowId: source.id,
        knowledgePublicId: source.knowledgeId,
        circleId: source.circleId,
        ownerPubkey: assetOwnerPubkey,
        entitlementCount: source.crystalEntitlements.length,
        receiptCount: source.crystalEntitlements.length,
        receiptOwnerPubkeys: source.crystalEntitlements.map((entitlement) => entitlement.ownerPubkey),
    };
}

export async function enqueueCrystalAssetIssueJob(
    prisma: PrismaLike,
    input: {
        knowledgeRowId?: number;
        knowledgePublicId?: string;
        requestedByUserId?: number | null;
        now?: Date;
    },
): Promise<{
        knowledgeRowId: number;
        knowledgePublicId: string;
        enqueued: boolean;
        jobId: number | null;
        adapterMode: string;
        reason: 'enqueued';
    }> {
    const projection = await prepareCrystalAssetProjection(prisma, input);
    const config = loadCrystalMintRuntimeConfig();

    const job = await enqueueAiJob(prisma, {
        jobType: 'crystal_asset_issue',
        dedupeKey: `crystal-asset-issue:${projection.knowledgeRowId}`,
        scopeType: 'circle',
        scopeCircleId: projection.circleId,
        requestedByUserId: input.requestedByUserId ?? null,
        availableAt: input.now ?? new Date(),
        payload: {
            knowledgeRowId: projection.knowledgeRowId,
            knowledgePublicId: projection.knowledgePublicId,
        },
    });

    return {
        knowledgeRowId: projection.knowledgeRowId,
        knowledgePublicId: projection.knowledgePublicId,
        enqueued: true,
        jobId: job.id,
        adapterMode: config.adapterMode,
        reason: 'enqueued',
    };
}
