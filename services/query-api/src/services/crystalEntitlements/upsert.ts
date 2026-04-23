import type { Prisma, PrismaClient } from '@prisma/client';

type PrismaLike = PrismaClient | Prisma.TransactionClient;

export class CrystalEntitlementSyncError extends Error {
    constructor(
        public readonly code: string,
        public readonly statusCode: number,
        message?: string,
    ) {
        super(message || code);
        this.name = 'CrystalEntitlementSyncError';
    }
}

interface EntitlementSourceRow {
    id: number;
    knowledgeId: string;
    circleId: number;
    binding: {
        proofPackageHash: string;
        sourceAnchorId: string;
        contributorsRoot: string;
        contributorsCount: number;
    } | null;
    contributions: Array<{
        contributorPubkey: string;
        contributionRole: string;
        contributionWeightBps: number;
    }>;
}

async function loadEntitlementSource(
    prisma: PrismaLike,
    input: {
        knowledgeRowId?: number;
        knowledgePublicId?: string;
    },
): Promise<EntitlementSourceRow> {
    const where = Number.isFinite(Number(input.knowledgeRowId)) && Number(input.knowledgeRowId) > 0
        ? { id: Number(input.knowledgeRowId) }
        : typeof input.knowledgePublicId === 'string' && input.knowledgePublicId.trim().length > 0
            ? { knowledgeId: input.knowledgePublicId.trim() }
            : null;
    if (!where) {
        throw new CrystalEntitlementSyncError(
            'invalid_crystal_entitlement_source',
            400,
            'knowledge identifier is required for crystal entitlement sync',
        );
    }

    const knowledge = await prisma.knowledge.findUnique({
        where,
        select: {
            id: true,
            knowledgeId: true,
            circleId: true,
            binding: {
                select: {
                    proofPackageHash: true,
                    sourceAnchorId: true,
                    contributorsRoot: true,
                    contributorsCount: true,
                },
            },
            contributions: {
                orderBy: [
                    { contributionWeight: 'desc' },
                    { contributorPubkey: 'asc' },
                ],
                select: {
                    contributorPubkey: true,
                    contributionRole: true,
                    contributionWeightBps: true,
                },
            },
        },
    });

    if (!knowledge) {
        throw new CrystalEntitlementSyncError(
            'knowledge_not_found',
            404,
            'knowledge row was not found for crystal entitlement sync',
        );
    }
    if (!knowledge.binding) {
        throw new CrystalEntitlementSyncError(
            'knowledge_binding_missing',
            409,
            'knowledge binding must exist before crystal entitlements can be derived',
        );
    }
    if (!Array.isArray(knowledge.contributions) || knowledge.contributions.length === 0) {
        throw new CrystalEntitlementSyncError(
            'knowledge_contributions_missing',
            409,
            'knowledge contributions must exist before crystal entitlements can be derived',
        );
    }

    return knowledge;
}

export async function upsertCrystalEntitlementsForKnowledge(
    prisma: PrismaLike,
    input: {
        knowledgeRowId?: number;
        knowledgePublicId?: string;
        now?: Date;
    },
): Promise<{
        knowledgeRowId: number;
        knowledgePublicId: string;
        entitlementCount: number;
        ownerPubkeys: string[];
    }> {
    const source = await loadEntitlementSource(prisma, input);
    const now = input.now ?? new Date();
    const contributorPubkeys = Array.from(new Set(
        source.contributions
            .map((item) => String(item.contributorPubkey || '').trim())
            .filter((value) => value.length > 0),
    ));

    if (contributorPubkeys.length === 0) {
        throw new CrystalEntitlementSyncError(
            'knowledge_contributors_invalid',
            409,
            'knowledge contributions did not contain any contributor pubkeys',
        );
    }

    const users = await prisma.user.findMany({
        where: {
            pubkey: { in: contributorPubkeys },
        },
        select: {
            id: true,
            pubkey: true,
        },
    });
    const userIdByPubkey = new Map(users.map((user) => [user.pubkey, user.id]));

    const prismaAny = prisma as any;
    const runWrite = async (tx: any) => {
        await tx.crystalEntitlement.updateMany({
            where: {
                knowledgeRowId: source.id,
                status: 'active',
                ownerPubkey: { notIn: contributorPubkeys },
            },
            data: {
                status: 'revoked',
                lastSyncedAt: now,
            },
        });

        for (const contribution of source.contributions) {
            const ownerPubkey = String(contribution.contributorPubkey || '').trim();
            if (!ownerPubkey) continue;

            await tx.crystalEntitlement.upsert({
                where: {
                    knowledgeRowId_ownerPubkey: {
                        knowledgeRowId: source.id,
                        ownerPubkey,
                    },
                },
                create: {
                    knowledgeRowId: source.id,
                    knowledgePublicId: source.knowledgeId,
                    circleId: source.circleId,
                    ownerPubkey,
                    ownerUserId: userIdByPubkey.get(ownerPubkey) ?? null,
                    contributionRole: contribution.contributionRole,
                    contributionWeightBps: contribution.contributionWeightBps,
                    proofPackageHash: source.binding!.proofPackageHash,
                    sourceAnchorId: source.binding!.sourceAnchorId,
                    contributorsRoot: source.binding!.contributorsRoot,
                    contributorsCount: source.binding!.contributorsCount,
                    status: 'active',
                    grantedAt: now,
                    lastSyncedAt: now,
                },
                update: {
                    knowledgePublicId: source.knowledgeId,
                    circleId: source.circleId,
                    ownerUserId: userIdByPubkey.get(ownerPubkey) ?? null,
                    contributionRole: contribution.contributionRole,
                    contributionWeightBps: contribution.contributionWeightBps,
                    proofPackageHash: source.binding!.proofPackageHash,
                    sourceAnchorId: source.binding!.sourceAnchorId,
                    contributorsRoot: source.binding!.contributorsRoot,
                    contributorsCount: source.binding!.contributorsCount,
                    status: 'active',
                    lastSyncedAt: now,
                },
            });
        }
    };

    if (typeof prismaAny.$transaction === 'function') {
        await prismaAny.$transaction(async (tx: any) => runWrite(tx));
    } else {
        await runWrite(prismaAny);
    }

    return {
        knowledgeRowId: source.id,
        knowledgePublicId: source.knowledgeId,
        entitlementCount: contributorPubkeys.length,
        ownerPubkeys: contributorPubkeys,
    };
}
