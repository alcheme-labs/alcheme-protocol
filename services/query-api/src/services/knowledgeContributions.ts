import { Prisma, type PrismaClient } from '@prisma/client';
import {
    DraftContributorProofError,
    getDraftContributorProof,
} from './contributorProof';

type PrismaLike = PrismaClient | Prisma.TransactionClient;

interface KnowledgeBindingProjectionRow {
    sourceAnchorId: string;
    proofPackageHash: string;
    contributorsRoot: string;
    contributorsCount: number;
}

export class KnowledgeContributionSyncError extends Error {
    constructor(
        public readonly code: string,
        public readonly statusCode: number,
        message?: string,
    ) {
        super(message || code);
        this.name = 'KnowledgeContributionSyncError';
    }
}

function normalizeHex(value: string | null | undefined): string | null {
    if (!value || typeof value !== 'string') return null;
    const normalized = value.trim().toLowerCase();
    return normalized.length > 0 ? normalized : null;
}

function normalizeWeight(weightBps: number): number {
    return Math.max(0, Math.min(1, weightBps / 10_000));
}

async function loadProjectedKnowledgeBinding(
    db: PrismaLike,
    knowledgeId: string,
): Promise<KnowledgeBindingProjectionRow | null> {
    const rows = await db.$queryRaw<KnowledgeBindingProjectionRow[]>(Prisma.sql`
        SELECT
            source_anchor_id AS "sourceAnchorId",
            proof_package_hash AS "proofPackageHash",
            contributors_root AS "contributorsRoot",
            contributors_count AS "contributorsCount"
        FROM knowledge_binding
        WHERE knowledge_id = ${knowledgeId}
        LIMIT 1
    `);
    return rows[0] || null;
}

export async function syncKnowledgeContributionsFromDraftProof(
    prisma: PrismaClient,
    input: {
        draftPostId: number;
        knowledgeOnChainAddress: string;
    },
    options?: {
        tx?: Prisma.TransactionClient;
        requireBindingProjection?: boolean;
        proofAnchorId?: string;
        expectedProofPackageHash?: string;
        expectedContributorsRoot?: string;
        expectedContributorsCount?: number;
    },
): Promise<{
    synced: boolean;
    knowledgeId: string;
    contributorsCount: number;
    contributorsRoot: string | null;
}> {
    const db: PrismaLike = options?.tx ?? prisma;

    const knowledge = await db.knowledge.findUnique({
        where: { onChainAddress: input.knowledgeOnChainAddress },
        select: {
            id: true,
            knowledgeId: true,
            circleId: true,
            contributorsRoot: true,
            contributorsCount: true,
        },
    });

    if (!knowledge) {
        throw new KnowledgeContributionSyncError(
            'knowledge_not_indexed',
            409,
            'knowledge is not indexed yet',
        );
    }

    const proof = await getDraftContributorProof(
        db as PrismaClient,
        input.draftPostId,
        options?.proofAnchorId
            ? { anchorId: options.proofAnchorId }
            : undefined,
    );
    if (proof.circleId !== knowledge.circleId) {
        throw new KnowledgeContributionSyncError(
            'knowledge_circle_mismatch',
            409,
            'draft and knowledge circle mismatch',
        );
    }

    const expectedRoot = normalizeHex(options?.expectedContributorsRoot);
    const expectedProofPackageHash = normalizeHex(options?.expectedProofPackageHash);
    const indexedRoot = normalizeHex(knowledge.contributorsRoot);
    const proofRoot = normalizeHex(proof.rootHex);

    if (options?.expectedContributorsRoot !== undefined) {
        if (!expectedRoot || !proofRoot || expectedRoot !== proofRoot) {
            throw new KnowledgeContributionSyncError(
                'proof_binding_required',
                409,
                'request proof snapshot contributors root does not match draft proof',
            );
        }
    }
    if (options?.expectedContributorsCount !== undefined) {
        const expectedCount = options.expectedContributorsCount;
        if (
            !Number.isInteger(expectedCount)
            || !Number.isFinite(expectedCount)
            || expectedCount <= 0
            || expectedCount !== proof.count
        ) {
            throw new KnowledgeContributionSyncError(
                'proof_binding_required',
                409,
                'request proof snapshot contributors count does not match draft proof',
            );
        }
    }

    if (options?.requireBindingProjection) {
        const projectedBinding = await loadProjectedKnowledgeBinding(db, knowledge.knowledgeId);
        if (!projectedBinding) {
            throw new KnowledgeContributionSyncError(
                'proof_binding_required',
                409,
                'indexed knowledge binding projection is missing',
            );
        }
        const projectedAnchor = normalizeHex(projectedBinding.sourceAnchorId);
        const proofAnchor = normalizeHex(proof.anchorId);
        if (!projectedAnchor || !proofAnchor || projectedAnchor !== proofAnchor) {
            throw new KnowledgeContributionSyncError(
                'proof_binding_required',
                409,
                'indexed knowledge binding source anchor does not match draft proof',
            );
        }
        if (options?.expectedProofPackageHash !== undefined) {
            const projectedProofPackageHash = normalizeHex(projectedBinding.proofPackageHash);
            if (
                !expectedProofPackageHash
                || !projectedProofPackageHash
                || projectedProofPackageHash !== expectedProofPackageHash
            ) {
                throw new KnowledgeContributionSyncError(
                    'proof_binding_required',
                    409,
                    'indexed knowledge binding proof package hash does not match request snapshot',
                );
            }
        }
        const projectedRoot = normalizeHex(projectedBinding.contributorsRoot);
        if (!projectedRoot || !proofRoot || projectedRoot !== proofRoot) {
            throw new KnowledgeContributionSyncError(
                'proof_binding_required',
                409,
                'indexed knowledge binding contributors root does not match draft proof',
            );
        }
        if (
            !Number.isFinite(projectedBinding.contributorsCount)
            || projectedBinding.contributorsCount <= 0
            || projectedBinding.contributorsCount !== proof.count
        ) {
            throw new KnowledgeContributionSyncError(
                'proof_binding_required',
                409,
                'indexed knowledge binding contributors count does not match draft proof',
            );
        }
    }

    if (indexedRoot && proofRoot && indexedRoot !== proofRoot) {
        throw new KnowledgeContributionSyncError(
            'proof_binding_required',
            409,
            'indexed contributors root does not match draft proof',
        );
    }
    if (knowledge.contributorsCount > 0 && knowledge.contributorsCount !== proof.count) {
        throw new KnowledgeContributionSyncError(
            'proof_binding_required',
            409,
            'indexed contributors count does not match draft proof',
        );
    }

    const contributorPubkeys = Array.from(new Set(proof.contributors.map((item) => item.pubkey)));
    const users = contributorPubkeys.length > 0
        ? await db.user.findMany({
            where: { pubkey: { in: contributorPubkeys } },
            select: { pubkey: true, handle: true },
        })
        : [];
    const handleByPubkey = new Map(users.map((user) => [user.pubkey, user.handle]));
    const agentDirectory = contributorPubkeys.length > 0 && (db as any).agent && typeof (db as any).agent.findMany === 'function'
        ? await (db as any).agent.findMany({
            where: {
                circleId: knowledge.circleId,
                agentPubkey: { in: contributorPubkeys },
            },
            select: {
                agentPubkey: true,
                handle: true,
            },
        })
        : [];
    const agentHandleByPubkey = new Map(
        (Array.isArray(agentDirectory) ? agentDirectory : []).map((agent: any) => [agent.agentPubkey, agent.handle]),
    );

    const writeSnapshot = async (writer: PrismaLike) => {
        await writer.knowledgeContribution.deleteMany({
            where: { knowledgeId: knowledge.id },
        });

        if (proof.contributors.length === 0) {
            return;
        }

        await writer.knowledgeContribution.createMany({
            data: proof.contributors.map((item) => ({
                knowledgeId: knowledge.id,
                contributorPubkey: item.pubkey,
                contributorHandle: handleByPubkey.get(item.pubkey) ?? agentHandleByPubkey.get(item.pubkey) ?? null,
                contributionRole: item.role,
                contributionWeightBps: item.weightBps,
                contributionWeight: normalizeWeight(item.weightBps),
                sourceDraftPostId: input.draftPostId,
                sourceAnchorId: proof.anchorId,
                sourcePayloadHash: proof.payloadHash,
                sourceSummaryHash: proof.summaryHash,
                sourceMessagesDigest: proof.messagesDigest,
                contributorsRoot: proof.rootHex,
                contributorsCount: proof.count,
            })),
        });
    };

    if (options?.tx) {
        await writeSnapshot(options.tx);
    } else {
        await prisma.$transaction(async (tx) => {
            await writeSnapshot(tx);
        });
    }

    return {
        synced: true,
        knowledgeId: knowledge.knowledgeId,
        contributorsCount: proof.count,
        contributorsRoot: proof.rootHex,
    };
}

export function mapContributionSyncError(error: unknown): {
    code: string;
    statusCode: number;
    message: string;
} {
    if (error instanceof KnowledgeContributionSyncError) {
        return {
            code: error.code,
            statusCode: error.statusCode,
            message: error.message,
        };
    }
    if (error instanceof DraftContributorProofError) {
        const statusCode = error.code === 'draft_anchor_unverifiable'
            ? 422
            : error.code === 'draft_anchor_not_found'
                ? 409
                : error.statusCode;
        return {
            code: error.code,
            statusCode,
            message: error.message,
        };
    }
    if (error instanceof Error) {
        return {
            code: 'knowledge_contribution_sync_failed',
            statusCode: 500,
            message: error.message,
        };
    }
    return {
        code: 'knowledge_contribution_sync_failed',
        statusCode: 500,
        message: 'failed to sync knowledge contributions',
    };
}
