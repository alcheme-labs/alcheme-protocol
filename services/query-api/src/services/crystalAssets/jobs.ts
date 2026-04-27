import type { Prisma, PrismaClient } from '@prisma/client';

import { loadCrystalMintRuntimeConfig } from '../../config/services';
import {
    createCrystalMintAdapter,
    type CrystalMintAdapter,
    resolveMasterAssetOwnerPubkey,
} from './mintAdapter';
import { prepareCrystalAssetProjection } from './enqueue';

type PrismaLike = PrismaClient | Prisma.TransactionClient;

interface CrystalIssuanceSource {
    id: number;
    knowledgeId: string;
    circleId: number;
    title: string;
    description: string | null;
    crystalParams: Record<string, unknown> | null;
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
        id: number;
        ownerPubkey: string;
        masterAssetAddress: string | null;
        assetStandard: string;
        mintStatus: string;
        metadataUri: string | null;
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
        crystalReceipt: {
            id: number;
            receiptAssetAddress: string | null;
            assetStandard: string;
            mintStatus: string;
            metadataUri: string | null;
        } | null;
    }>;
}

async function loadCrystalIssuanceSource(
    prisma: PrismaLike,
    input: {
        knowledgeRowId?: number;
        knowledgePublicId?: string;
    },
): Promise<CrystalIssuanceSource> {
    const where = Number.isFinite(Number(input.knowledgeRowId)) && Number(input.knowledgeRowId) > 0
        ? { id: Number(input.knowledgeRowId) }
        : typeof input.knowledgePublicId === 'string' && input.knowledgePublicId.trim().length > 0
            ? { knowledgeId: input.knowledgePublicId.trim() }
            : null;
    if (!where) {
        throw new Error('invalid_crystal_asset_issue_payload');
    }

    const knowledge = await prisma.knowledge.findUnique({
        where,
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
                    id: true,
                    ownerPubkey: true,
                    masterAssetAddress: true,
                    assetStandard: true,
                    mintStatus: true,
                    metadataUri: true,
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
                    crystalReceipt: {
                        select: {
                            id: true,
                            receiptAssetAddress: true,
                            assetStandard: true,
                            mintStatus: true,
                            metadataUri: true,
                        },
                    },
                },
            },
        },
    });

    if (!knowledge?.binding || !knowledge.author?.pubkey) {
        throw new Error('crystal_asset_issue_source_incomplete');
    }
    if (!Array.isArray(knowledge.crystalEntitlements) || knowledge.crystalEntitlements.length === 0) {
        throw new Error('crystal_asset_issue_entitlements_missing');
    }

    return knowledge as CrystalIssuanceSource;
}

async function markCrystalAssetFailure(
    prisma: PrismaLike,
    knowledgeRowId: number,
    error: unknown,
): Promise<void> {
    await (prisma as any).crystalAsset.update({
        where: {
            knowledgeRowId,
        },
        data: {
            mintStatus: 'failed',
            lastError: error instanceof Error ? error.message : String(error),
        },
    });
}

async function markCrystalReceiptFailure(
    prisma: PrismaLike,
    entitlementId: number,
    error: unknown,
): Promise<void> {
    await (prisma as any).crystalReceipt.update({
        where: {
            entitlementId,
        },
        data: {
            mintStatus: 'failed',
            lastError: error instanceof Error ? error.message : String(error),
        },
    });
}

export async function issueCrystalAssetJob(
    prisma: PrismaLike,
    input: {
        knowledgeRowId?: number;
        knowledgePublicId?: string;
        mintAdapter?: CrystalMintAdapter;
        now?: Date;
    },
): Promise<{
        knowledgeRowId: number;
        knowledgePublicId: string;
        adapterMode: string;
        masterAssetIssued: boolean;
        masterAssetAddress: string | null;
        receiptCount: number;
        issuedReceiptCount: number;
    }> {
    const now = input.now ?? new Date();
    await prepareCrystalAssetProjection(prisma, input);
    const source = await loadCrystalIssuanceSource(prisma, input);
    const config = loadCrystalMintRuntimeConfig();
    const mintAdapter = input.mintAdapter ?? createCrystalMintAdapter(config);
    const authorPubkey = source.author!.pubkey;
    const binding = source.binding!;
    const masterOwnerPubkey = source.crystalAsset?.ownerPubkey
        || resolveMasterAssetOwnerPubkey(config, authorPubkey);

    let masterAssetIssued = false;
    let masterAssetAddress = source.crystalAsset?.masterAssetAddress ?? null;
    if (!(source.crystalAsset?.mintStatus === 'minted' && source.crystalAsset.masterAssetAddress)) {
        try {
            const masterOutcome = await mintAdapter.issueMasterAsset({
                knowledgeRowId: source.id,
                knowledgePublicId: source.knowledgeId,
                circleId: source.circleId,
                ownerPubkey: masterOwnerPubkey,
                title: source.title,
                description: source.description,
                proofPackageHash: binding.proofPackageHash,
                sourceAnchorId: binding.sourceAnchorId,
                contributorsRoot: binding.contributorsRoot,
                contributorsCount: binding.contributorsCount,
                crystalParams: source.crystalParams,
            });
            await (prisma as any).crystalAsset.update({
                where: {
                    knowledgeRowId: source.id,
                },
                data: {
                    masterAssetAddress: masterOutcome.assetAddress,
                    assetStandard: masterOutcome.assetStandard,
                    metadataUri: masterOutcome.metadataUri,
                    mintStatus: 'minted',
                    mintedAt: masterOutcome.mintedAt,
                    lastError: null,
                    updatedAt: now,
                },
            });
            masterAssetIssued = true;
            masterAssetAddress = masterOutcome.assetAddress;
        } catch (error) {
            await markCrystalAssetFailure(prisma, source.id, error);
            throw error;
        }
    }

    let issuedReceiptCount = 0;
    for (const entitlement of source.crystalEntitlements) {
        if (entitlement.crystalReceipt?.mintStatus === 'minted' && entitlement.crystalReceipt.receiptAssetAddress) {
            continue;
        }

        try {
            const receiptOutcome = await mintAdapter.issueReceipt({
                entitlementId: entitlement.id,
                knowledgeRowId: source.id,
                knowledgePublicId: source.knowledgeId,
                circleId: source.circleId,
                ownerPubkey: entitlement.ownerPubkey,
                contributionRole: entitlement.contributionRole,
                contributionWeightBps: entitlement.contributionWeightBps,
                proofPackageHash: entitlement.proofPackageHash,
                sourceAnchorId: entitlement.sourceAnchorId,
                contributorsRoot: entitlement.contributorsRoot,
                contributorsCount: entitlement.contributorsCount,
            });
            await (prisma as any).crystalReceipt.update({
                where: {
                    entitlementId: entitlement.id,
                },
                data: {
                    ownerUserId: entitlement.ownerUserId,
                    contributionRole: entitlement.contributionRole,
                    contributionWeightBps: entitlement.contributionWeightBps,
                    receiptAssetAddress: receiptOutcome.assetAddress,
                    assetStandard: receiptOutcome.assetStandard,
                    metadataUri: receiptOutcome.metadataUri,
                    mintStatus: 'minted',
                    mintedAt: receiptOutcome.mintedAt,
                    lastError: null,
                    updatedAt: now,
                },
            });
            issuedReceiptCount += 1;
        } catch (error) {
            await markCrystalReceiptFailure(prisma, entitlement.id, error);
            throw error;
        }
    }

    return {
        knowledgeRowId: source.id,
        knowledgePublicId: source.knowledgeId,
        adapterMode: mintAdapter.mode,
        masterAssetIssued,
        masterAssetAddress,
        receiptCount: source.crystalEntitlements.length,
        issuedReceiptCount,
    };
}
