import { GraphQLScalarType, Kind } from 'graphql';
import bs58 from 'bs58';
import { MemberStatus, Prisma } from '@prisma/client';
import { Context } from './context';
import { localizeNotification } from '../notifications/localize';
import { FeedFilter, verifiedUserFilter } from '../utils/filters';
import {
    authorizeDraftAction,
    canViewCircleMembers,
    hasActiveCircleMembership,
} from '../services/membership/checks';
import { bumpPostHeat, DRAFT_HEAT_EVENTS } from '../services/heat/postHeat';
import { buildGhostDraftGenerationDedupeKey } from '../services/ghostDraft/requestKey';
import { enqueueAiJob } from '../services/aiJobs/runtime';
import { assertAiTaskAllowed } from '../ai/provider';
import { loadKnowledgeVersionDiff } from '../services/knowledgeVersionDiff';
import { normalizeCircleGenesisMode } from '../services/circleGenesisMode';
import { loadCircleAgentsByPubkeys } from '../services/agents/runtime';
import { resolveOwnedCrystalCount } from '../services/crystalEntitlements/runtime';
import { resolveProjectedCircleSettings } from '../services/policy/settingsEnvelope';
import { publishDiscussionRealtimeEvent } from '../services/discussion/realtime';
import { localizeQueryApiCopy } from '../i18n/copy';

// DateTime Scalar
const dateTimeScalar = new GraphQLScalarType({
    name: 'DateTime',
    parseValue(value) {
        return new Date(value as string);
    },
    serialize(value) {
        return (value as Date).toISOString();
    },
    parseLiteral(ast) {
        if (ast.kind === Kind.STRING) {
            return new Date(ast.value);
        }
        return null;
    },
});

// BigInt Scalar  
const bigIntScalar = new GraphQLScalarType({
    name: 'BigInt',
    parseValue(value) {
        return BigInt(value as string);
    },
    serialize(value) {
        if (typeof value === 'object' && value !== null) {
            return JSON.stringify(value);
        }
        return String(value);
    },
    parseLiteral(ast) {
        if (ast.kind === Kind.STRING || ast.kind === Kind.INT) {
            return BigInt(ast.value);
        }
        return null;
    },
});

function hexToBase58(hex: string): string | null {
    if (!/^[0-9a-fA-F]+$/.test(hex) || hex.length % 2 !== 0) return null;
    try {
        return bs58.encode(Buffer.from(hex, 'hex'));
    } catch {
        return null;
    }
}

function buildCandidateCrystalIds(knowledge: any): string[] {
    const candidates = new Set<string>();

    if (typeof knowledge.knowledgeId === 'string' && knowledge.knowledgeId.length > 0) {
        candidates.add(knowledge.knowledgeId);
        const asBase58 = hexToBase58(knowledge.knowledgeId);
        if (asBase58) candidates.add(asBase58);
    }

    if (typeof knowledge.onChainAddress === 'string' && knowledge.onChainAddress.length > 0) {
        candidates.add(knowledge.onChainAddress);
    }

    if (typeof knowledge.sourceContentId === 'string' && knowledge.sourceContentId.length > 0) {
        candidates.add(knowledge.sourceContentId);
    }

    return Array.from(candidates);
}

function normalizeContributionRole(role: string | null | undefined): 'Author' | 'Discussant' | 'Reviewer' | 'Cited' | 'Unknown' {
    if (!role) return 'Unknown';
    const normalized = role.trim().toLowerCase();
    if (normalized === 'author') return 'Author';
    if (normalized === 'discussant') return 'Discussant';
    if (normalized === 'reviewer') return 'Reviewer';
    if (normalized === 'cited') return 'Cited';
    return 'Unknown';
}

function emptyCrystalReceiptStats(): {
    totalCount: number;
    mintedCount: number;
    pendingCount: number;
    failedCount: number;
    unknownCount: number;
} {
    return {
        totalCount: 0,
        mintedCount: 0,
        pendingCount: 0,
        failedCount: 0,
        unknownCount: 0,
    };
}

function summarizeCrystalReceiptStatusBuckets(rows: Array<{
    mintStatus?: string | null;
    _count?: { _all?: number | null } | number | null;
}>): ReturnType<typeof emptyCrystalReceiptStats> {
    return rows.reduce(
        (acc, row) => {
            const count = typeof row._count === 'number'
                ? row._count
                : Number(row._count?._all ?? 0);
            if (!Number.isFinite(count) || count <= 0) return acc;
            acc.totalCount += count;
            const status = String(row.mintStatus || '').trim().toLowerCase();
            if (status === 'minted') {
                acc.mintedCount += count;
            } else if (status === 'pending') {
                acc.pendingCount += count;
            } else if (status === 'failed') {
                acc.failedCount += count;
            } else {
                acc.unknownCount += count;
            }
            return acc;
        },
        emptyCrystalReceiptStats(),
    );
}

async function loadAgentDirectoryByPubkey(
    prisma: Context['prisma'],
    input: {
        circleId?: number | null;
        pubkeys: string[];
    },
): Promise<Map<string, { handle: string | null }>> {
    const rows = await loadCircleAgentsByPubkeys(prisma as any, {
        circleId: input.circleId ?? null,
        pubkeys: input.pubkeys,
    });
    return new Map(
        rows.map((row: { agentPubkey: string; handle: string | null }) => [
            row.agentPubkey,
            { handle: row.handle ?? null },
        ]),
    );
}

function stringifyCachePayload(value: unknown): string {
    return JSON.stringify(value, (_key, nestedValue) =>
        typeof nestedValue === 'bigint' ? nestedValue.toString() : nestedValue);
}

function buildMemberActivityText(input: { kind: 'post' | 'draft' | 'crystal'; locale: Context['locale'] }): string {
    if (input.kind === 'draft') return localizeQueryApiCopy('graphql.activity.draft', input.locale);
    if (input.kind === 'crystal') return localizeQueryApiCopy('graphql.activity.crystal', input.locale);
    return localizeQueryApiCopy('graphql.activity.post', input.locale);
}

function normalizeNumericScore(value: Prisma.Decimal | number | string | null | undefined, fallback = 0): number {
    if (value === null || value === undefined) return fallback;
    if (typeof value === 'number' && Number.isFinite(value)) return value;
    if (typeof value === 'string') {
        const parsed = Number.parseFloat(value);
        return Number.isFinite(parsed) ? parsed : fallback;
    }
    if (typeof value === 'object' && typeof (value as { toNumber?: () => number }).toNumber === 'function') {
        const parsed = (value as { toNumber: () => number }).toNumber();
        return Number.isFinite(parsed) ? parsed : fallback;
    }
    return fallback;
}

async function attachSourceDraftHeat<T extends { sourceContentId?: string | null }>(
    prisma: Context['prisma'],
    rows: T[],
): Promise<Array<T & { sourceDraftHeatScore: number }>> {
    const sourceContentIds = Array.from(
        new Set(
            rows
                .map((row) => row.sourceContentId)
                .filter((value): value is string => typeof value === 'string' && value.length > 0),
        ),
    );

    if (sourceContentIds.length === 0) {
        return rows.map((row) => ({ ...row, sourceDraftHeatScore: 0 }));
    }

    const sourcePosts = await prisma.post.findMany({
        where: {
            contentId: { in: sourceContentIds },
        },
        select: {
            contentId: true,
            heatScore: true,
        },
    });
    const heatByContentId = new Map(
        sourcePosts.map((post) => [post.contentId, Number(post.heatScore ?? 0)]),
    );

    return rows.map((row) => ({
        ...row,
        sourceDraftHeatScore: heatByContentId.get(row.sourceContentId || '') ?? 0,
    }));
}

async function attachProjectedCircleSettings<T extends {
    id: number;
    joinRequirement: string;
    circleType: string;
    minCrystals: number;
}>(
    prisma: Context['prisma'],
    circles: T[],
): Promise<Array<T & { __projectedCircleSettings?: Awaited<ReturnType<typeof resolveProjectedCircleSettings>> }>> {
    return Promise.all(circles.map(async (circle) => ({
        ...circle,
        __projectedCircleSettings: await resolveProjectedCircleSettings(prisma as any, circle as any),
    })));
}

type KnowledgeLineageDirection = 'outbound' | 'inbound';

type KnowledgeLineageLink = {
    knowledgeId: string;
    onChainAddress: string;
    title: string;
    circleId: number;
    circleName: string;
    heatScore: number;
    citationCount: number;
    createdAt: Date;
};

type KnowledgeBindingProjectionRow = {
    knowledgeId: string;
    sourceAnchorId: string;
    proofPackageHash: string;
    contributorsRoot: string;
    contributorsCount: number;
    bindingVersion: number;
    generatedAt: Date;
    boundAt: Date;
    boundBy: string;
    createdAt: Date;
    updatedAt: Date;
};

function mapKnowledgeBindingProjection(
    row: KnowledgeBindingProjectionRow | null | undefined,
): KnowledgeBindingProjectionRow | null {
    if (!row) return null;
    return {
        knowledgeId: row.knowledgeId,
        sourceAnchorId: row.sourceAnchorId,
        proofPackageHash: row.proofPackageHash,
        contributorsRoot: row.contributorsRoot,
        contributorsCount: Number(row.contributorsCount ?? 0),
        bindingVersion: Number(row.bindingVersion ?? 0),
        generatedAt: row.generatedAt,
        boundAt: row.boundAt,
        boundBy: row.boundBy,
        createdAt: row.createdAt,
        updatedAt: row.updatedAt,
    };
}

async function resolveKnowledgeBindingProjection(
    prisma: Context['prisma'],
    knowledgeId: string,
): Promise<KnowledgeBindingProjectionRow | null> {
    const normalizedKnowledgeId = String(knowledgeId || '').trim();
    if (!normalizedKnowledgeId) return null;

    const rows = await prisma.$queryRaw<KnowledgeBindingProjectionRow[]>(Prisma.sql`
        SELECT
            knowledge_id AS "knowledgeId",
            source_anchor_id AS "sourceAnchorId",
            proof_package_hash AS "proofPackageHash",
            contributors_root AS "contributorsRoot",
            contributors_count AS "contributorsCount",
            binding_version AS "bindingVersion",
            generated_at AS "generatedAt",
            bound_at AS "boundAt",
            bound_by AS "boundBy",
            created_at AS "createdAt",
            updated_at AS "updatedAt"
        FROM knowledge_binding
        WHERE knowledge_id = ${normalizedKnowledgeId}
        LIMIT 1
    `);

    return mapKnowledgeBindingProjection(rows[0]);
}

async function resolveKnowledgeLineageLinks(
    prisma: Context['prisma'],
    knowledgeId: string,
    direction: KnowledgeLineageDirection,
    limit: number,
): Promise<KnowledgeLineageLink[]> {
    const resolvedLimit = Math.max(1, Math.min(limit ?? 8, 50));
    const references = await prisma.knowledgeReference.findMany({
        where: direction === 'outbound'
            ? { sourceKnowledgeId: knowledgeId }
            : { targetKnowledgeId: knowledgeId },
        orderBy: { createdAt: 'desc' },
        take: resolvedLimit,
    });
    if (references.length === 0) return [];

    const linkedKnowledgeIds = references.map((row) => (
        direction === 'outbound' ? row.targetKnowledgeId : row.sourceKnowledgeId
    ));
    const linkedKnowledgeRows = await prisma.knowledge.findMany({
        where: { knowledgeId: { in: linkedKnowledgeIds } },
        select: {
            knowledgeId: true,
            onChainAddress: true,
            title: true,
            createdAt: true,
            citationCount: true,
            heatScore: true,
            circle: {
                select: {
                    id: true,
                    name: true,
                },
            },
        },
    });
    const rowByKnowledgeId = new Map(
        linkedKnowledgeRows.map((row) => [row.knowledgeId, row]),
    );

    const dedupedOrder = Array.from(new Set(linkedKnowledgeIds));
    return dedupedOrder
        .map((id) => rowByKnowledgeId.get(id))
        .filter((row): row is NonNullable<typeof row> => !!row)
        .map((row) => ({
            knowledgeId: row.knowledgeId,
            onChainAddress: row.onChainAddress,
            title: row.title,
            circleId: row.circle.id,
            circleName: row.circle.name,
            heatScore: Number(row.heatScore ?? 0),
            citationCount: row.citationCount,
            createdAt: row.createdAt,
        }));
}

interface PublicFlowRow {
    kind: 'Discussion' | 'Crystal';
    sourceId: string;
    title: string;
    excerpt: string;
    circleId: number;
    circleName: string;
    circleLevel: number;
    authorHandle: string | null;
    authorPubkey: string | null;
    score: Prisma.Decimal | number | string | null;
    featuredReason: string | null;
    createdAt: Date;
}

export const resolvers = {
    DateTime: dateTimeScalar,
    BigInt: bigIntScalar,

    Query: {
        user: async (_: any, { handle }: { handle: string }, { prisma, cache }: Context) => {
            const cacheKey = `user:${handle}`;
            const cached = await cache.get(cacheKey);

            if (cached) {
                return JSON.parse(cached);
            }

            const user = await prisma.user.findUnique({
                where: { handle },
            });

            if (user) {
                await cache.setex(cacheKey, 300, stringifyCachePayload(user)); // 5分钟缓存
            }

            return user;
        },

        me: async (_: any, __: any, { prisma, userId }: Context) => {
            if (!userId) return null;
            return await prisma.user.findUnique({ where: { id: userId } });
        },

        users: async (_: any, { handles }: { handles: string[] }, { prisma }: Context) => {
            return await prisma.user.findMany({
                where: {
                    handle: { in: handles },
                },
            });
        },

        post: async (_: any, { contentId }: { contentId: string }, { prisma, cache }: Context) => {
            const cacheKey = `post:${contentId}`;
            const cached = await cache.get(cacheKey);

            if (cached) {
                return JSON.parse(cached);
            }

            const postByContentId = await prisma.post.findUnique({
                where: { contentId },
                include: {
                    author: true,
                },
            });
            const post = postByContentId || await prisma.post.findFirst({
                where: { onChainAddress: contentId },
                include: {
                    author: true,
                },
            });

            if (post) {
                const cachePayload = stringifyCachePayload(post);
                const cacheKeys = Array.from(new Set([cacheKey, `post:${post.contentId}`]));
                await Promise.all(
                    cacheKeys.map((key) => cache.setex(key, 3600, cachePayload)),
                );
            }

            return post;
        },

        posts: async (_: any, { contentIds }: { contentIds: string[] }, { prisma }: Context) => {
            const normalizedContentIds = Array.from(
                new Set(
                    (contentIds || [])
                        .map((value) => String(value || '').trim())
                        .filter((value) => value.length > 0),
                ),
            );
            if (normalizedContentIds.length === 0) return [];

            return await prisma.post.findMany({
                where: {
                    OR: [
                        { contentId: { in: normalizedContentIds } },
                        { onChainAddress: { in: normalizedContentIds } },
                    ],
                },
                include: {
                    author: true,
                },
            });
        },

        feed: async (_: any, { limit, offset, filter }: { limit: number; offset: number; filter: FeedFilter }, { prisma }: Context) => {
            const where: any = {
                status: { in: ['Active', 'Published'] as any[] },
                visibility: 'Public',
            };

            if (filter === FeedFilter.VERIFIED_ONLY) {
                Object.assign(where, verifiedUserFilter);
            }

            return await prisma.post.findMany({
                where,
                take: limit,
                skip: offset,
                orderBy: { createdAt: 'desc' },
                include: {
                    author: true,
                },
            });
        },

        followingFlow: async (
            _: any,
            { limit, offset }: { limit: number; offset: number },
            { prisma, userId, locale }: Context,
        ) => {
            if (!userId) return [];
            const resolvedLimit = Math.max(1, Math.min(limit ?? 20, 100));
            const resolvedOffset = Math.max(0, offset ?? 0);

            const follows = await prisma.follow.findMany({
                where: { followerId: userId },
                select: { followingId: true },
                take: 5000,
            });
            const followingIds = follows.map((f) => f.followingId);
            if (followingIds.length === 0) return [];

            return prisma.post.findMany({
                where: {
                    authorId: { in: followingIds },
                    status: { in: ['Active', 'Published'] as any[] },
                    OR: [
                        { visibility: 'Public' as any },
                        { visibility: 'FollowersOnly' as any },
                        {
                            visibility: 'CircleOnly' as any,
                            circle: {
                                members: {
                                    some: {
                                        userId,
                                        status: 'Active',
                                    },
                                },
                            },
                        },
                    ],
                },
                take: resolvedLimit,
                skip: resolvedOffset,
                orderBy: { createdAt: 'desc' },
                include: {
                    author: true,
                },
            });
        },

        publicFlow: async (
            _: any,
            { limit, offset }: { limit: number; offset: number },
            { prisma, locale }: Context,
        ) => {
            const resolvedLimit = Math.max(1, Math.min(limit ?? 20, 50));
            const resolvedOffset = Math.max(0, offset ?? 0);
            const rows = await prisma.$queryRaw<PublicFlowRow[]>(Prisma.sql`
                SELECT *
                FROM (
                    SELECT
                        'Discussion'::text AS "kind",
                        m.envelope_id AS "sourceId",
                        LEFT(m.payload_text, 72) AS "title",
                        LEFT(m.payload_text, 180) AS "excerpt",
                        c.id AS "circleId",
                        c.name AS "circleName",
                        c.level AS "circleLevel",
                        COALESCE(m.sender_handle, CONCAT(SUBSTRING(m.sender_pubkey, 1, 4), '...', SUBSTRING(m.sender_pubkey, 41, 4))) AS "authorHandle",
                        m.sender_pubkey AS "authorPubkey",
                        COALESCE(m.semantic_score, m.relevance_score, 0.0) AS "score",
                        m.feature_reason AS "featuredReason",
                        COALESCE(m.featured_at, m.created_at) AS "createdAt"
                    FROM circle_discussion_messages m
                    INNER JOIN circles c ON c.id = m.circle_id
                    WHERE c.level = 0
                      AND c.kind = 'main'
                      AND m.deleted = FALSE
                      AND m.is_featured = TRUE

                    UNION ALL

                    SELECT
                        'Crystal'::text AS "kind",
                        k.knowledge_id AS "sourceId",
                        LEFT(k.title, 72) AS "title",
                        LEFT(COALESCE(k.description, k.title), 180) AS "excerpt",
                        c.id AS "circleId",
                        c.name AS "circleName",
                        c.level AS "circleLevel",
                        u.handle AS "authorHandle",
                        u.pubkey AS "authorPubkey",
                        k.quality_score AS "score",
                        'knowledge_crystal'::text AS "featuredReason",
                        k.created_at AS "createdAt"
                    FROM knowledge k
                    INNER JOIN circles c ON c.id = k.circle_id
                    INNER JOIN users u ON u.id = k.author_id
                    WHERE c.level = 0
                      AND c.kind = 'main'
                ) public_flow
                ORDER BY "createdAt" DESC, "kind" ASC, "sourceId" DESC
                OFFSET ${resolvedOffset}
                LIMIT ${resolvedLimit}
            `);

            return rows.map((row) => ({
                id: `${row.kind.toLowerCase()}:${row.sourceId}`,
                kind: row.kind,
                sourceId: row.sourceId,
                title: row.title || (row.kind === 'Discussion'
                    ? localizeQueryApiCopy('graphql.publicFlow.discussionTitle', locale)
                    : localizeQueryApiCopy('graphql.publicFlow.crystalTitle', locale)),
                excerpt: row.excerpt || row.title || '',
                circleId: row.circleId,
                circleName: row.circleName,
                circleLevel: row.circleLevel,
                authorHandle: row.authorHandle || 'unknown',
                authorPubkey: row.authorPubkey,
                score: Math.max(0, Math.min(1, normalizeNumericScore(row.score, row.kind === 'Discussion' ? 0.6 : 0.7))),
                featuredReason: row.featuredReason || (row.kind === 'Discussion' ? 'ai_discussion_featured' : 'knowledge_crystal'),
                createdAt: row.createdAt,
            }));
        },

        trending: async (
            _: any,
            { timeRange, limit }: { timeRange: string; limit: number },
            { prisma }: Context
        ) => {
            const now = new Date();
            const timeMap = {
                HOUR: 60 * 60 * 1000,
                DAY: 24 * 60 * 60 * 1000,
                WEEK: 7 * 24 * 60 * 60 * 1000,
                MONTH: 30 * 24 * 60 * 60 * 1000,
            };

            const since = new Date(now.getTime() - timeMap[timeRange as keyof typeof timeMap]);

            return await prisma.post.findMany({
                where: {
                    status: { in: ['Active', 'Published'] as any[] },
                    visibility: 'Public',
                    createdAt: { gte: since },
                },
                take: limit,
                orderBy: [
                    { likesCount: 'desc' },
                    { repostsCount: 'desc' },
                ],
                include: {
                    author: true,
                },
            });
        },

        circle: async (_: any, { id }: { id: number }, { prisma }: Context) => {
            const circle = await prisma.circle.findUnique({
                where: { id },
                include: {
                    creator: true,
                },
            });
            if (!circle) return null;
            const [projected] = await attachProjectedCircleSettings(prisma, [circle as any]);
            return projected;
        },

        circleDescendants: async (
            _: any,
            { rootId }: { rootId: number },
            { prisma }: Context,
        ) => {
            const descendants: any[] = [];
            const seen = new Set<number>([rootId]);
            let frontier = [rootId];

            while (frontier.length > 0) {
                const children = await prisma.circle.findMany({
                    where: {
                        parentCircleId: { in: frontier },
                        lifecycleStatus: 'Active',
                    },
                    orderBy: { createdAt: 'desc' },
                    include: { creator: true },
                });

                frontier = [];
                for (const child of children) {
                    if (seen.has(child.id)) {
                        continue;
                    }
                    seen.add(child.id);
                    descendants.push(child);
                    frontier.push(child.id);
                }
            }

            return descendants;
        },

        circles: async (_: any, { ids }: { ids: number[] }, { prisma }: Context) => {
            const circles = await prisma.circle.findMany({
                where: {
                    id: { in: ids },
                },
                include: {
                    creator: true,
                },
            });
            return attachProjectedCircleSettings(prisma, circles as any);
        },

        searchUsers: async (_: any, { query, limit }: { query: string; limit: number }, { prisma }: Context) => {
            return await prisma.user.findMany({
                where: {
                    OR: [
                        { handle: { contains: query, mode: 'insensitive' } },
                        { displayName: { contains: query, mode: 'insensitive' } },
                    ],
                },
                take: limit,
            });
        },

        searchPosts: async (
            _: any,
            { query, tags, limit }: { query: string; tags?: string[]; limit: number },
            { prisma }: Context
        ) => {
            const where: any = {
                status: { in: ['Active', 'Published'] as any[] },
                visibility: 'Public',
            };

            if (query) {
                where.text = { contains: query, mode: 'insensitive' };
            }

            if (tags && tags.length > 0) {
                where.tags = { hasSome: tags };
            }

            return await prisma.post.findMany({
                where,
                take: limit,
                orderBy: { createdAt: 'desc' },
                include: {
                    author: true,
                },
            });
        },

        allCircles: async (
            _: any,
            { limit, offset }: { limit: number; offset: number },
            { prisma }: Context,
        ) => {
            const circles = await prisma.circle.findMany({
                where: {
                    lifecycleStatus: 'Active',
                },
                take: limit,
                skip: offset,
                orderBy: { createdAt: 'desc' },
                include: { creator: true },
            });
            return attachProjectedCircleSettings(prisma, circles as any);
        },

        searchCircles: async (
            _: any,
            { query, limit }: { query: string; limit: number },
            { prisma }: Context,
        ) => {
            const circles = await prisma.circle.findMany({
                where: {
                    lifecycleStatus: 'Active',
                    OR: [
                        { name: { contains: query, mode: 'insensitive' } },
                        { description: { contains: query, mode: 'insensitive' } },
                    ],
                },
                take: limit,
                orderBy: { createdAt: 'desc' },
                include: { creator: true },
            });
            return attachProjectedCircleSettings(prisma, circles as any);
        },

        myDrafts: async (
            _: any,
            { limit, offset }: { limit: number; offset: number },
            { prisma, userId }: Context
        ) => {
            if (!userId) {
                throw new Error('Authentication required');
            }
            return await prisma.post.findMany({
                where: {
                    authorId: userId,
                    status: 'Draft' as any,
                },
                take: limit,
                skip: offset,
                orderBy: { updatedAt: 'desc' },
                include: {
                    author: true,
                },
            });
        },

        myCircles: async (
            _: any,
            __: any,
            { prisma, userId }: Context,
        ) => {
            if (!userId) return [];
            const memberships = await prisma.circleMember.findMany({
                where: {
                    userId,
                    status: 'Active',
                },
                include: { circle: true },
            });
            return attachProjectedCircleSettings(prisma, memberships.map(m => m.circle) as any);
        },

        knowledge: async (_: any, { knowledgeId }: { knowledgeId: string }, { prisma }: Context) => {
            const row = await prisma.knowledge.findUnique({
                where: { knowledgeId },
                include: { author: true, circle: true, sourceCircle: true },
            });
            if (!row) return null;
            const [withHeat] = await attachSourceDraftHeat(prisma, [row]);
            return withHeat;
        },

        knowledgeByOnChainAddress: async (
            _: any,
            { onChainAddress }: { onChainAddress: string },
            { prisma }: Context,
        ) => {
            const row = await prisma.knowledge.findUnique({
                where: { onChainAddress },
                include: { author: true, circle: true, sourceCircle: true },
            });
            if (!row) return null;
            const [withHeat] = await attachSourceDraftHeat(prisma, [row]);
            return withHeat;
        },

        // ── 用户通知 ──
        myNotifications: async (
            _: any,
            { limit, offset }: { limit: number; offset: number },
            { prisma, userId, locale }: Context,
        ) => {
            if (!userId) return [];
            const notifications = await prisma.notification.findMany({
                where: { userId },
                take: limit,
                skip: offset,
                orderBy: { createdAt: 'desc' },
            });

            const circleIds = Array.from(
                new Set(
                    notifications
                        .map((notification) => notification.circleId)
                        .filter((circleId): circleId is number => typeof circleId === 'number'),
                ),
            );

            const circleNameById = circleIds.length > 0
                ? new Map(
                    (
                        await prisma.circle.findMany({
                            where: { id: { in: circleIds } },
                            select: { id: true, name: true },
                        })
                    ).map((circle) => [circle.id, circle.name]),
                )
                : new Map<number, string>();

            return notifications.map((notification) => {
                const localized = localizeNotification(notification, {
                    locale,
                    circleName: notification.circleId ? circleNameById.get(notification.circleId) ?? null : null,
                });

                return {
                    ...notification,
                    displayTitle: localized.displayTitle,
                    displayBody: localized.displayBody,
                };
            });
        },

        // ── 草稿批注 ──
        draftComments: async (
            _: any,
            { postId, limit }: { postId: number; limit: number },
            { prisma, userId }: Context,
        ) => {
            if (!userId) return [];
            const access = await authorizeDraftAction(prisma, {
                postId,
                userId,
                action: 'read',
            });
            if (!access.allowed) return [];

            return await prisma.draftComment.findMany({
                where: { postId },
                take: limit,
                orderBy: { createdAt: 'desc' },
                include: { user: true },
            });
        },

        // ── 圈层草稿概览 ──
        circleDrafts: async (
            _: any,
            { circleId, limit, offset }: { circleId: number; limit: number; offset: number },
            { prisma, userId }: Context,
        ) => {
            if (!userId) return [];
            const activeMember = await hasActiveCircleMembership(prisma, {
                circleId,
                userId,
            });
            if (!activeMember) return [];

            const drafts = await prisma.post.findMany({
                where: {
                    circleId,
                    status: 'Draft' as any,
                },
                take: limit,
                skip: offset,
                orderBy: { updatedAt: 'desc' },
                include: {
                    _count: { select: { draftComments: true } },
                },
            });
            const draftIds = drafts.map((draft: any) => draft.id);
            const workflowStates = draftIds.length > 0
                ? await prisma.draftWorkflowState.findMany({
                    where: { draftPostId: { in: draftIds } },
                    select: { draftPostId: true, documentStatus: true },
                })
                : [];
            const documentStatusByDraftId = new Map<number, string>(
                workflowStates.map((state: any) => [
                    Number(state.draftPostId),
                    String(state.documentStatus || 'drafting'),
                ]),
            );

            const now = Date.now();
            return drafts.map((d: any) => ({
                postId: d.id,
                title: d.text?.slice(0, 80) || 'Untitled',
                excerpt: d.text?.slice(0, 200),
                heatScore: Number(d.heatScore ?? 0),
                status: d.status,
                documentStatus: documentStatusByDraftId.get(d.id) || 'drafting',
                commentCount: d._count?.draftComments ?? 0,
                ageDays: Math.floor((now - new Date(d.createdAt).getTime()) / (1000 * 60 * 60 * 24)),
                createdAt: d.createdAt,
                updatedAt: d.updatedAt,
            }));
        },

        // ── 圈层成员资料 ──
        memberProfile: async (
            _: any,
            { circleId, userId }: { circleId: number; userId: number },
            { prisma, userId: viewerUserId, locale }: Context,
        ) => {
            if (!viewerUserId) return null;

            const circle = await prisma.circle.findUnique({
                where: { id: circleId },
                select: { creatorId: true },
            });
            if (!circle) return null;

            const allowed = await canViewCircleMembers(prisma, {
                circleId,
                userId: viewerUserId,
                creatorId: circle.creatorId,
            });
            if (!allowed) return null;

            const membership = await prisma.circleMember.findFirst({
                where: {
                    circleId,
                    userId,
                    status: MemberStatus.Active,
                },
                include: { user: true },
            });
            if (!membership) return null;

            const isSelf = viewerUserId === userId;
            const followModel = (prisma as any).follow;
            const viewerFollowPromise = !isSelf && followModel?.findFirst
                ? followModel.findFirst({
                    where: {
                        followerId: viewerUserId,
                        followingId: userId,
                    },
                    select: { followerId: true },
                })
                : Promise.resolve(null);

            const [
                knowledgeStats,
                circleCount,
                viewerCircleMemberships,
                targetCircleMemberships,
                recentPosts,
                recentKnowledge,
                viewerFollow,
            ] = await Promise.all([
                prisma.knowledge.aggregate({
                    where: { authorId: userId, circleId },
                    _count: true,
                    _sum: { citationCount: true },
                }),
                prisma.circleMember.count({
                    where: {
                        userId,
                        status: MemberStatus.Active,
                    },
                }),
                prisma.circleMember.findMany({
                    where: {
                        userId: viewerUserId,
                        status: MemberStatus.Active,
                    },
                    select: { circleId: true },
                }),
                prisma.circleMember.findMany({
                    where: {
                        userId,
                        status: MemberStatus.Active,
                    },
                    select: { circleId: true },
                }),
                prisma.post.findMany({
                    where: {
                        authorId: userId,
                        circleId,
                        status: {
                            in: ['Active', 'Published', 'Draft'] as any,
                        },
                    },
                    orderBy: { createdAt: 'desc' },
                    take: 5,
                    select: {
                        status: true,
                        createdAt: true,
                    },
                }),
                prisma.knowledge.findMany({
                    where: {
                        authorId: userId,
                        circleId,
                    },
                    orderBy: { createdAt: 'desc' },
                    take: 5,
                    select: {
                        createdAt: true,
                    },
                }),
                viewerFollowPromise,
            ]);

            const viewerCircleIds = new Set(viewerCircleMemberships.map((row: { circleId: number }) => row.circleId));
            if (circle.creatorId === viewerUserId) {
                viewerCircleIds.add(circleId);
            }
            const sharedCircleIds = targetCircleMemberships
                .map((row: { circleId: number }) => row.circleId)
                .filter((candidate: number) => viewerCircleIds.has(candidate));

            const sharedCircles = sharedCircleIds.length === 0
                ? []
                : await prisma.circle.findMany({
                    where: {
                        id: { in: sharedCircleIds },
                    },
                    orderBy: [
                        { level: 'asc' },
                        { name: 'asc' },
                    ],
                    take: 6,
                    select: {
                        id: true,
                        name: true,
                        kind: true,
                        level: true,
                    },
                });
            const ownedCrystalCount = await resolveOwnedCrystalCount(prisma as any, {
                ownerPubkey: membership.user.pubkey,
                circleId,
            });

            const recentActivity = [
                ...recentPosts.map((post: { status: string; createdAt: Date }) => ({
                    type: String(post.status) === 'Draft' ? 'draft' : 'post',
                    text: buildMemberActivityText({
                        kind: String(post.status) === 'Draft' ? 'draft' : 'post',
                        locale,
                    }),
                    createdAt: post.createdAt,
                })),
                ...recentKnowledge.map((knowledge: { createdAt: Date }) => ({
                    type: 'crystal',
                    text: buildMemberActivityText({ kind: 'crystal', locale }),
                    createdAt: knowledge.createdAt,
                })),
            ]
                .sort((a, b) => b.createdAt.getTime() - a.createdAt.getTime())
                .slice(0, 5);

            return {
                user: membership.user,
                viewerFollows: Boolean(viewerFollow),
                isSelf,
                role: membership.role,
                joinedAt: membership.joinedAt,
                knowledgeCount: knowledgeStats._count,
                ownedCrystalCount,
                totalCitations: knowledgeStats._sum?.citationCount ?? 0,
                circleCount,
                sharedCircles,
                recentActivity,
            };
        },

        knowledgeByCircle: async (
            _: any,
            { circleId, limit, offset }: { circleId: number; limit: number; offset: number },
            { prisma }: Context
        ) => {
            const rows = await prisma.knowledge.findMany({
                where: { circleId },
                take: limit,
                skip: offset,
                orderBy: { qualityScore: 'desc' },
                include: { author: true, circle: true },
            });
            return await attachSourceDraftHeat(prisma, rows);
        },

        myKnowledge: async (
            _: any,
            { limit, offset }: { limit: number; offset: number },
            { prisma, userId }: Context,
        ) => {
            if (!userId) return [];
            const rows = await prisma.knowledge.findMany({
                where: { authorId: userId },
                take: limit,
                skip: offset,
                orderBy: { createdAt: 'desc' },
                include: { author: true, circle: true },
            });
            return await attachSourceDraftHeat(prisma, rows);
        },

        knowledgeBinding: async (
            _: any,
            { knowledgeId }: { knowledgeId: string },
            { prisma }: Context,
        ) => resolveKnowledgeBindingProjection(prisma, knowledgeId),
    },

    User: {
        stats: (user: any) => ({
            followers: user.followersCount,
            following: user.followingCount,
            posts: user.postsCount,
            circles: user.circlesCount,
        }),

        totem: async (user: any, _: any, { prisma }: Context) => {
            const row = await prisma.userTotem.findUnique({
                where: { userId: user.id },
            });
            if (!row) {
                return {
                    stage: 'seed',
                    crystalCount: 0,
                    citationCount: 0,
                    circleCount: 0,
                    dustFactor: 0,
                    lastActiveAt: user.createdAt,
                };
            }
            const daysSinceActive = (Date.now() - new Date(row.lastActiveAt).getTime()) / 86400000;
            return {
                stage: row.stage,
                crystalCount: row.crystalCount,
                citationCount: row.citationCount,
                circleCount: row.circleCount,
                dustFactor: Math.min(1, daysSinceActive / 90),
                lastActiveAt: row.lastActiveAt,
            };
        },

        posts: async (user: any, { limit, offset }: any, { prisma }: Context) => {
            return await prisma.post.findMany({
                where: { authorId: user.id },
                take: limit,
                skip: offset,
                orderBy: { createdAt: 'desc' },
            });
        },

        followers: async (user: any, { limit }: any, { prisma }: Context) => {
            const follows = await prisma.follow.findMany({
                where: { followingId: user.id },
                take: limit,
                include: { follower: true },
            });
            return follows.map((f: any) => f.follower);
        },

        following: async (user: any, { limit }: any, { prisma }: Context) => {
            const follows = await prisma.follow.findMany({
                where: { followerId: user.id },
                take: limit,
                include: { following: true },
            });
            return follows.map((f: any) => f.following);
        },

        profile: async (user: any, _: any, { prisma }: Context) => {
            const knowledge = await prisma.knowledge.aggregate({
                where: { authorId: user.id },
                _count: true,
                _sum: { citationCount: true, viewCount: true },
                _avg: { qualityScore: true },
            });

            const recentActivity = await prisma.post.count({
                where: {
                    authorId: user.id,
                    createdAt: { gte: new Date(Date.now() - 7 * 24 * 60 * 60 * 1000) },
                },
            });

            const unreadNotifications = await prisma.notification.count({
                where: { userId: user.id, read: false },
            });

            return {
                knowledgeCount: knowledge._count,
                totalCitations: knowledge._sum?.citationCount ?? 0,
                totalViews: knowledge._sum?.viewCount ?? 0,
                averageQuality: parseFloat(String(knowledge._avg?.qualityScore ?? 0)),
                recentActivity,
                unreadNotifications,
            };
        },
    },

    Post: {
        v2VisibilityLevel: (post: any) => {
            const raw = String(post?.v2VisibilityLevel || '').trim();
            if (raw) return raw;
            const normalized = String(post?.visibility || '').trim();
            return normalized || 'Public';
        },

        v2AudienceKind: (post: any) => {
            const raw = String(post?.v2AudienceKind || '').trim();
            if (raw) return raw;
            const normalized = String(post?.v2VisibilityLevel || post?.visibility || '').trim();
            return normalized || null;
        },

        v2AudienceRef: (post: any) => {
            if (Number.isFinite(post?.v2AudienceRef)) {
                return post.v2AudienceRef;
            }
            if (Number.isFinite(post?.protocolCircleId)) {
                return post.protocolCircleId;
            }
            if (Number.isFinite(post?.circle?.protocolCircleId)) {
                return post.circle.protocolCircleId;
            }
            if (Number.isFinite(post?.circle?.id)) {
                return post.circle.id;
            }
            return null;
        },

        v2Status: (post: any) => {
            const raw = String(post?.v2Status || '').trim();
            if (raw) return raw;
            const normalized = String(post?.status || '').trim();
            return normalized || 'Published';
        },

        isV2Private: (post: any) => {
            if (typeof post?.isV2Private === 'boolean') {
                return post.isV2Private;
            }
            const visibility = String(post?.v2VisibilityLevel || post?.visibility || '').trim();
            return visibility === 'Private';
        },

        isV2Draft: (post: any) => {
            if (typeof post?.isV2Draft === 'boolean') {
                return post.isV2Draft;
            }
            const status = String(post?.v2Status || post?.status || '').trim();
            return status === 'Draft';
        },

        protocolCircleId: (post: any) => {
            if (Number.isFinite(post?.protocolCircleId)) {
                return post.protocolCircleId;
            }
            if (Number.isFinite(post?.circle?.protocolCircleId)) {
                return post.circle.protocolCircleId;
            }
            if (Number.isFinite(post?.circle?.id)) {
                return post.circle.id;
            }
            if (Number.isFinite(post?.circleId)) {
                return post.circleId;
            }
            if (Number.isFinite(post?.v2AudienceRef) && String(post?.v2AudienceKind || '').trim() === 'CircleOnly') {
                return post.v2AudienceRef;
            }
            return null;
        },

        circleOnChainAddress: async (post: any, _: any, { prisma }: Context) => {
            const preloaded = String(
                post?.circleOnChainAddress
                || post?.circle?.onChainAddress
                || ''
            ).trim();
            if (preloaded) return preloaded;
            if (!post?.circleId) return null;

            const circle = await prisma.circle.findUnique({
                where: { id: post.circleId },
                select: { onChainAddress: true },
            });
            return circle?.onChainAddress ?? null;
        },

        stats: (post: any) => ({
            likes: post.likesCount,
            reposts: post.repostsCount,
            replies: post.repliesCount,
            comments: post.commentsCount ?? 0,
            shares: post.sharesCount ?? 0,
            views: post.viewsCount,
            heatScore: Number(post.heatScore ?? 0),
        }),

        repostOf: async (post: any, _: any, { prisma }: Context) => {
            if (post.repostOfPostId) {
                return await prisma.post.findUnique({
                    where: { id: post.repostOfPostId },
                    include: { author: true },
                });
            }
            const repostOfAddress = String(post.repostOfAddress || '').trim();
            if (!repostOfAddress) return null;
            return await prisma.post.findFirst({
                where: {
                    OR: [
                        { contentId: repostOfAddress },
                        { onChainAddress: repostOfAddress },
                    ],
                },
                include: { author: true },
            });
        },

        author: async (post: any, _: any, { prisma }: Context) => {
            return await prisma.user.findUnique({
                where: { id: post.authorId },
            });
        },

        replies: async (post: any, { limit }: any, { prisma }: Context) => {
            return await prisma.post.findMany({
                where: { parentPostId: post.id },
                take: limit,
                orderBy: { createdAt: 'desc' },
                include: { author: true },
            });
        },

        circle: async (post: any, _: any, { prisma }: Context) => {
            if (!post.circleId) return null;
            return await prisma.circle.findUnique({
                where: { id: post.circleId },
            });
        },

        liked: async (post: any, _: any, { prisma, userId }: Context) => {
            if (!userId) return false;
            const like = await prisma.like.findFirst({
                where: { postId: post.id, userId },
            });
            return !!like;
        },
    },

    Circle: {
        protocolCircleId: (circle: any) => circle.id,
        onChainAddress: (circle: any) => circle.onChainAddress,
        knowledgeCount: async (circle: any, _: any, { prisma }: Context) => {
            if (!Number.isFinite(Number(circle?.id)) || Number(circle.id) <= 0) {
                return Math.max(0, Number(circle?.knowledgeCount ?? 0));
            }
            return Math.max(0, await prisma.knowledge.count({
                where: {
                    circleId: Number(circle.id),
                },
            }));
        },
        circleType: async (circle: any, _: any, { prisma }: Context) => {
            if (circle.__projectedCircleSettings?.circleType) {
                return circle.__projectedCircleSettings.circleType;
            }
            if (
                typeof circle.id === 'number'
                && typeof circle.joinRequirement === 'string'
                && typeof circle.circleType === 'string'
            ) {
                const projected = await resolveProjectedCircleSettings(prisma as any, circle);
                return projected.circleType;
            }
            return circle.circleType;
        },
        joinRequirement: async (circle: any, _: any, { prisma }: Context) => {
            if (circle.__projectedCircleSettings?.joinRequirement) {
                return circle.__projectedCircleSettings.joinRequirement;
            }
            if (
                typeof circle.id === 'number'
                && typeof circle.joinRequirement === 'string'
                && typeof circle.circleType === 'string'
            ) {
                const projected = await resolveProjectedCircleSettings(prisma as any, circle);
                return projected.joinRequirement;
            }
            return circle.joinRequirement || 'Free';
        },
        genesisMode: (circle: any) => normalizeCircleGenesisMode(circle.genesisMode),
        minCrystals: async (circle: any, _: any, { prisma }: Context) => {
            if (typeof circle.__projectedCircleSettings?.minCrystals === 'number') {
                return circle.__projectedCircleSettings.minCrystals;
            }
            if (
                typeof circle.id === 'number'
                && typeof circle.joinRequirement === 'string'
                && typeof circle.circleType === 'string'
            ) {
                const projected = await resolveProjectedCircleSettings(prisma as any, circle);
                return projected.minCrystals;
            }
            return Number(circle.minCrystals ?? 0);
        },
        stats: async (circle: any, _: any, { prisma }: Context) => {
            if (!Number.isFinite(Number(circle?.id)) || Number(circle.id) <= 0) {
                return {
                    members: Math.max(0, Number(circle?.membersCount ?? 0)),
                    posts: Math.max(0, Number(circle?.postsCount ?? 0)),
                };
            }

            const circleId = Number(circle.id);
            const [members, posts] = await Promise.all([
                prisma.circleMember.count({
                    where: {
                        circleId,
                        status: MemberStatus.Active,
                    },
                }),
                prisma.post.count({
                    where: {
                        circleId,
                    },
                }),
            ]);

            return {
                members: Math.max(0, members),
                posts: Math.max(0, posts),
            };
        },

        creator: async (circle: any, _: any, { prisma }: Context) => {
            if (circle.creator) return circle.creator;
            return await prisma.user.findUnique({
                where: { id: circle.creatorId },
            });
        },

        parentCircle: async (circle: any, _: any, { prisma }: Context) => {
            if (!circle.parentCircleId) return null;
            return await prisma.circle.findUnique({
                where: { id: circle.parentCircleId },
            });
        },

        childCircles: async (circle: any, _: any, { prisma }: Context) => {
            return await prisma.circle.findMany({
                where: { parentCircleId: circle.id },
                orderBy: { createdAt: 'desc' },
            });
        },

        members: async (circle: any, { limit }: any, { prisma, userId }: Context) => {
            const allowed = await canViewCircleMembers(prisma, {
                circleId: circle.id,
                userId: userId ?? null,
                creatorId: circle.creatorId ?? null,
            });
            if (!allowed) return [];

            return await prisma.circleMember.findMany({
                where: {
                    circleId: circle.id,
                    status: MemberStatus.Active,
                },
                take: limit,
                include: { user: true },
            });
        },

        posts: async (circle: any, { limit }: any, { prisma }: Context) => {
            return await prisma.post.findMany({
                where: { circleId: circle.id },
                take: limit,
                orderBy: { createdAt: 'desc' },
                include: { author: true },
            });
        },
    },

    CircleMember: {
        user: async (member: any, _: any, { prisma }: Context) => {
            return await prisma.user.findUnique({
                where: { id: member.userId },
            });
        },
    },

    Knowledge: {
        stats: (knowledge: any) => {
            const hasStoredHeatScore = knowledge.heatScore !== undefined && knowledge.heatScore !== null;

            return {
                qualityScore: parseFloat(knowledge.qualityScore) || 0,
                citationCount: knowledge.citationCount,
                viewCount: knowledge.viewCount,
                heatScore: hasStoredHeatScore
                    ? Number(knowledge.heatScore ?? 0)
                    : Number(knowledge.sourceDraftHeatScore ?? 0),
            };
        },

        crystalParams: (knowledge: any) => {
            // Return frozen crystal visual params if stored, null otherwise
            const cp = knowledge.crystalParams;
            if (!cp || typeof cp !== 'object') return null;
            return {
                seed: cp.seed ?? '0x0',
                hue: cp.hue ?? 42,
                facets: cp.facets ?? 6,
            };
        },

        crystalAsset: async (
            knowledge: any,
            _: any,
            { prisma }: Context,
        ) => {
            if (knowledge.crystalAsset !== undefined) return knowledge.crystalAsset;
            const knowledgeRowId = Number(knowledge.id ?? 0);
            if (!Number.isFinite(knowledgeRowId) || knowledgeRowId <= 0) return null;

            return prisma.crystalAsset.findUnique({
                where: {
                    knowledgeRowId,
                },
            });
        },

        crystalReceiptStats: async (
            knowledge: any,
            _: any,
            { prisma }: Context,
        ) => {
            if (
                knowledge.crystalReceiptStats
                && typeof knowledge.crystalReceiptStats === 'object'
                && !Array.isArray(knowledge.crystalReceiptStats)
            ) {
                return knowledge.crystalReceiptStats;
            }

            const knowledgeRowId = Number(knowledge.id ?? 0);
            if (!Number.isFinite(knowledgeRowId) || knowledgeRowId <= 0) {
                return emptyCrystalReceiptStats();
            }

            const receiptStatusBuckets = await prisma.crystalReceipt.groupBy({
                where: {
                    knowledgeRowId,
                },
                by: ['mintStatus'],
                _count: {
                    _all: true,
                },
            });

            return summarizeCrystalReceiptStatusBuckets(receiptStatusBuckets);
        },

        crystalReceipts: async (
            knowledge: any,
            { limit }: { limit: number },
            { prisma }: Context,
        ) => {
            const resolvedLimit = Math.max(1, Math.min(limit ?? 20, 100));
            if (Array.isArray(knowledge.crystalReceipts)) {
                return knowledge.crystalReceipts.slice(0, resolvedLimit);
            }

            const knowledgeRowId = Number(knowledge.id ?? 0);
            if (!Number.isFinite(knowledgeRowId) || knowledgeRowId <= 0) return [];

            return prisma.crystalReceipt.findMany({
                where: {
                    knowledgeRowId,
                },
                orderBy: [
                    { contributionWeightBps: 'desc' },
                    { updatedAt: 'desc' },
                ],
                take: resolvedLimit,
            });
        },

        binding: async (
            knowledge: any,
            _: any,
            { prisma }: Context,
        ) => {
            const preloaded = mapKnowledgeBindingProjection(knowledge.binding ?? null);
            if (preloaded) return preloaded;

            const knowledgeId = typeof knowledge.knowledgeId === 'string'
                ? knowledge.knowledgeId.trim()
                : '';
            if (!knowledgeId) return null;
            return resolveKnowledgeBindingProjection(prisma, knowledgeId);
        },

        contributors: async (
            knowledge: any,
            { limit }: { limit: number },
            { prisma }: Context,
        ) => {
            const resolvedLimit = Math.max(1, Math.min(limit ?? 20, 100));
            if (typeof knowledge.id === 'number' && Number.isFinite(knowledge.id)) {
                const rows = await prisma.knowledgeContribution.findMany({
                    where: { knowledgeId: knowledge.id },
                    orderBy: [
                        { contributionWeight: 'desc' },
                        { updatedAt: 'desc' },
                    ],
                    take: resolvedLimit,
                });

                if (rows.length > 0) {
                    const missingHandlePubkeys = Array.from(
                        new Set(
                            rows
                                .filter((row) => !row.contributorHandle)
                                .map((row) => row.contributorPubkey),
                        ),
                    );
                    const users = missingHandlePubkeys.length > 0
                        ? await prisma.user.findMany({
                            where: {
                                pubkey: { in: missingHandlePubkeys },
                            },
                            select: {
                                pubkey: true,
                                handle: true,
                            },
                        })
                        : [];
                    const handleByPubkey = new Map(users.map((user) => [user.pubkey, user.handle]));
                    const agentDirectoryByPubkey = await loadAgentDirectoryByPubkey(prisma, {
                        circleId: typeof knowledge.circleId === 'number' ? knowledge.circleId : null,
                        pubkeys: rows.map((row) => row.contributorPubkey),
                    });

                    return rows.map((row) => ({
                        handle: row.contributorHandle
                            || handleByPubkey.get(row.contributorPubkey)
                            || agentDirectoryByPubkey.get(row.contributorPubkey)?.handle
                            || `${row.contributorPubkey.slice(0, 6)}...${row.contributorPubkey.slice(-4)}`,
                        pubkey: row.contributorPubkey,
                        role: normalizeContributionRole(row.contributionRole),
                        weight: normalizeNumericScore(row.contributionWeight, 0),
                        authorType: agentDirectoryByPubkey.has(row.contributorPubkey) ? 'AGENT' : 'HUMAN',
                        authorityScore: 0,
                        reputationDelta: 0,
                        settledAt: row.updatedAt,
                        sourceType: 'SNAPSHOT',
                        sourceDraftPostId: row.sourceDraftPostId,
                        sourceAnchorId: row.sourceAnchorId,
                        sourcePayloadHash: row.sourcePayloadHash,
                        sourceSummaryHash: row.sourceSummaryHash,
                        sourceMessagesDigest: row.sourceMessagesDigest,
                    }));
                }
            }

            const candidateCrystalIds = buildCandidateCrystalIds(knowledge);

            if (candidateCrystalIds.length === 0) {
                return [];
            }

            const settlements = await prisma.settlementHistory.findMany({
                where: {
                    crystalId: { in: candidateCrystalIds },
                },
                orderBy: { settledAt: 'desc' },
                take: resolvedLimit * 8,
            });

            if (settlements.length === 0) {
                return [];
            }

            type Aggregate = {
                pubkey: string;
                role: 'Author' | 'Discussant' | 'Reviewer' | 'Cited' | 'Unknown';
                authorityScore: number;
                reputationDelta: number;
                weight: number;
                settledAt: Date;
            };

            const aggregates = new Map<string, Aggregate>();

            for (const row of settlements) {
                const pubkey = row.contributorPubkey;
                const authorityScore = Number(row.authorityScore ?? 0);
                const reputationDelta = Number(row.reputationDelta ?? 0);
                const weightFromRow = row.contributionWeight !== null && row.contributionWeight !== undefined
                    ? Number(row.contributionWeight)
                    : null;
                const weight = weightFromRow ?? (authorityScore > 0 ? reputationDelta / authorityScore : 0);
                const role = normalizeContributionRole(row.contributionRole);

                const current = aggregates.get(pubkey);
                if (!current || row.settledAt > current.settledAt) {
                    aggregates.set(pubkey, {
                        pubkey,
                        role,
                        authorityScore,
                        reputationDelta,
                        weight,
                        settledAt: row.settledAt,
                    });
                }
            }

            const sorted = Array.from(aggregates.values())
                .sort((a, b) => b.reputationDelta - a.reputationDelta)
                .slice(0, resolvedLimit);

            const users = await prisma.user.findMany({
                where: { pubkey: { in: sorted.map(s => s.pubkey) } },
                select: { pubkey: true, handle: true },
            });
            const handleByPubkey = new Map(users.map(u => [u.pubkey, u.handle]));
            const agentDirectoryByPubkey = await loadAgentDirectoryByPubkey(prisma, {
                circleId: typeof knowledge.circleId === 'number' ? knowledge.circleId : null,
                pubkeys: sorted.map((item) => item.pubkey),
            });

            return sorted.map((item) => ({
                handle: handleByPubkey.get(item.pubkey)
                    || agentDirectoryByPubkey.get(item.pubkey)?.handle
                    || `${item.pubkey.slice(0, 6)}...${item.pubkey.slice(-4)}`,
                pubkey: item.pubkey,
                role: item.role,
                weight: item.weight,
                authorType: agentDirectoryByPubkey.has(item.pubkey) ? 'AGENT' : 'HUMAN',
                authorityScore: item.authorityScore,
                reputationDelta: item.reputationDelta,
                settledAt: item.settledAt,
                sourceType: 'SETTLEMENT',
                sourceDraftPostId: null,
                sourceAnchorId: null,
                sourcePayloadHash: null,
                sourceSummaryHash: null,
                sourceMessagesDigest: null,
            }));
        },

        versionTimeline: async (
            knowledge: any,
            { limit }: { limit: number },
            { prisma }: Context,
        ) => {
            const knowledgeId = typeof knowledge.knowledgeId === 'string' ? knowledge.knowledgeId.trim() : '';
            if (!knowledgeId) return [];

            const resolvedLimit = Math.max(1, Math.min(limit ?? 20, 100));
            type VersionEventRow = {
                id: bigint;
                eventType: string;
                version: number;
                actorPubkey: string | null;
                contributorsCount: number | null;
                contributorsRoot: string | null;
                sourceEventTimestamp: bigint;
                eventAt: Date;
                createdAt: Date;
            };

            const rows = await prisma.$queryRaw<VersionEventRow[]>(Prisma.sql`
                SELECT
                    id,
                    event_type AS "eventType",
                    version,
                    actor_pubkey AS "actorPubkey",
                    contributors_count AS "contributorsCount",
                    contributors_root AS "contributorsRoot",
                    source_event_timestamp AS "sourceEventTimestamp",
                    event_at AS "eventAt",
                    created_at AS "createdAt"
                FROM knowledge_version_events
                WHERE knowledge_id = ${knowledgeId}
                ORDER BY event_at DESC, id DESC
                LIMIT ${resolvedLimit}
            `);

            if (rows.length === 0) {
                return [];
            }

            const actorPubkeys = Array.from(
                new Set(
                    rows
                        .map((row) => row.actorPubkey)
                        .filter((value): value is string => Boolean(value)),
                ),
            );
            const users = actorPubkeys.length > 0
                ? await prisma.user.findMany({
                    where: {
                        pubkey: { in: actorPubkeys },
                    },
                    select: {
                        pubkey: true,
                        handle: true,
                    },
                })
                : [];
            const handleByPubkey = new Map(users.map((user) => [user.pubkey, user.handle]));

            return rows.map((row) => ({
                id: String(row.id),
                eventType: row.eventType,
                version: row.version,
                actorPubkey: row.actorPubkey,
                actorHandle: row.actorPubkey ? (handleByPubkey.get(row.actorPubkey) ?? null) : null,
                contributorsCount: row.contributorsCount,
                contributorsRoot: row.contributorsRoot,
                sourceEventTimestamp: String(row.sourceEventTimestamp),
                eventAt: row.eventAt,
                createdAt: row.createdAt,
            }));
        },

        versionDiff: async (
            knowledge: any,
            { fromVersion, toVersion }: { fromVersion: number; toVersion: number },
            { prisma, locale }: Context,
        ) => {
            const knowledgeId = typeof knowledge.knowledgeId === 'string' ? knowledge.knowledgeId.trim() : '';
            if (!knowledgeId) return null;
            return await loadKnowledgeVersionDiff(prisma as any, {
                knowledgeId,
                fromVersion,
                toVersion,
                locale,
            });
        },

        references: async (
            knowledge: any,
            { limit }: { limit: number },
            { prisma }: Context,
        ) => {
            const knowledgeId = typeof knowledge.knowledgeId === 'string' ? knowledge.knowledgeId : '';
            if (!knowledgeId) return [];
            return resolveKnowledgeLineageLinks(prisma, knowledgeId, 'outbound', limit ?? 8);
        },

        citedBy: async (
            knowledge: any,
            { limit }: { limit: number },
            { prisma }: Context,
        ) => {
            const knowledgeId = typeof knowledge.knowledgeId === 'string' ? knowledge.knowledgeId : '';
            if (!knowledgeId) return [];
            return resolveKnowledgeLineageLinks(prisma, knowledgeId, 'inbound', limit ?? 8);
        },

        author: async (knowledge: any, _: any, { prisma }: Context) => {
            if (knowledge.author) return knowledge.author;
            return await prisma.user.findUnique({ where: { id: knowledge.authorId } });
        },

        circle: async (knowledge: any, _: any, { prisma }: Context) => {
            if (knowledge.circle) return knowledge.circle;
            return await prisma.circle.findUnique({ where: { id: knowledge.circleId } });
        },

        sourceCircle: async (knowledge: any, _: any, { prisma }: Context) => {
            if (knowledge.sourceCircle) return knowledge.sourceCircle;
            if (!knowledge.sourceCircleId) return null;
            return await prisma.circle.findUnique({ where: { id: knowledge.sourceCircleId } });
        },
    },

    // ══════════════════════════════════════
    // Mutations
    // ══════════════════════════════════════
    Mutation: {
        // ── createPost / deletePost removed ──
        // 内容创建和删除走链上 SDK (content-manager.create_content / delete_content)
        // indexer 监听 ContentCreated / ContentStatusChanged 事件后入库

        // ── updateUser ──
        async updateUser(
            _: any,
            { input }: { input: { displayName?: string; bio?: string; avatarUri?: string; bannerUri?: string; website?: string; location?: string } },
            { prisma, userId }: Context,
        ) {
            if (!userId) throw new Error('Authentication required');
            const requestedProtocolFields = [
                input.displayName,
                input.bio,
                input.avatarUri,
                input.bannerUri,
                input.website,
                input.location,
            ].filter((value) => value !== undefined);

            if (requestedProtocolFields.length > 0) {
                throw new Error('Protocol-owned profile fields must be updated via wallet-signed identity transaction');
            }

            return await prisma.user.findUnique({
                where: { id: userId },
            });
        },

        // ── evaluateIdentity ──
        async evaluateIdentity(
            _: any,
            { circleId, userId: targetUserId }: { circleId: number; userId: number },
            { prisma }: Context,
        ) {
            const { evaluateAndUpdate } = await import('../identity/machine');
            const result = await evaluateAndUpdate(prisma, targetUserId, circleId);

            return {
                previousLevel: result.previousLevel,
                currentLevel: result.newLevel,
                changed: result.changed,
            };
        },

        // ── generateGhostDraft ──
        async generateGhostDraft(
            _: any,
            {
                input,
            }: {
                input: {
                    postId: number;
                    preferAutoApply?: boolean | null;
                    workingCopyHash?: string | null;
                    workingCopyUpdatedAt?: string | Date | null;
                    seededReference?: {
                        path: string;
                        line: number;
                    } | null;
                    sourceMaterialIds?: number[] | null;
                };
            },
            { prisma, userId }: Context,
        ) {
            if (!userId) throw new Error('Authentication required');
            const postId = Number(input.postId);
            const access = await authorizeDraftAction(prisma, {
                postId,
                userId,
                action: 'read',
            });
            if (!access.allowed) throw new Error(access.error);

            const editAccess = input.preferAutoApply
                ? await authorizeDraftAction(prisma, {
                    postId,
                    userId,
                    action: 'edit',
                })
                : null;
            assertAiTaskAllowed({
                task: 'ghost-draft',
                dataBoundary: 'private_plaintext',
            });
            const autoApplyRequested = Boolean(input.preferAutoApply && editAccess?.allowed);
            const seededReference = input.seededReference
                && typeof input.seededReference.path === 'string'
                && Number.isFinite(Number(input.seededReference.line))
                && Number(input.seededReference.line) > 0
                ? {
                    path: String(input.seededReference.path).trim(),
                    line: Number(input.seededReference.line),
                }
                : null;
            const sourceMaterialIds = Array.isArray(input.sourceMaterialIds)
                ? input.sourceMaterialIds
                    .map((value) => Number(value))
                    .filter((value) => Number.isFinite(value) && value > 0)
                : [];
            const job = await enqueueAiJob(prisma as any, {
                jobType: 'ghost_draft_generate',
                dedupeKey: buildGhostDraftGenerationDedupeKey({
                    postId,
                    requestedByUserId: userId,
                    autoApplyRequested,
                    workingCopyHash: input.workingCopyHash || null,
                    workingCopyUpdatedAt: input.workingCopyUpdatedAt || null,
                    seededReference,
                    sourceMaterialIds,
                }),
                scopeType: 'draft',
                scopeDraftPostId: postId,
                scopeCircleId: access.post?.circleId ?? null,
                requestedByUserId: userId,
                payload: {
                    postId,
                    autoApplyRequested,
                    workingCopyHash: input.workingCopyHash || null,
                    workingCopyUpdatedAt: input.workingCopyUpdatedAt || null,
                    seededReference,
                    sourceMaterialIds,
                },
            });

            return {
                jobId: job.id,
                status: job.status,
                postId,
                autoApplyRequested,
            };
        },

        async acceptGhostDraft(
            _: any,
            {
                input,
            }: {
                input: {
                    postId: number;
                    generationId: number;
                    mode: 'AUTO_FILL' | 'ACCEPT_REPLACE' | 'ACCEPT_SUGGESTION';
                    suggestionId?: string | null;
                    workingCopyHash?: string | null;
                    workingCopyUpdatedAt?: string | Date | null;
                };
            },
            { prisma, userId, locale }: Context,
        ) {
            if (!userId) throw new Error('Authentication required');

            const {
                acceptGhostDraftIntoWorkingCopy,
                normalizeGhostDraftAcceptanceMode,
            } = await import('../services/ghostDraft/acceptance');
            const mode = normalizeGhostDraftAcceptanceMode(input.mode);
            if (!mode) {
                throw new Error('invalid_ghost_draft_acceptance_mode');
            }

            return acceptGhostDraftIntoWorkingCopy(prisma as any, {
                draftPostId: input.postId,
                generationId: input.generationId,
                suggestionId: input.suggestionId || null,
                userId,
                mode,
                locale,
                workingCopyHash: input.workingCopyHash || null,
                workingCopyUpdatedAt: input.workingCopyUpdatedAt || null,
            });
        },

        // ── highlightMessage ──
        async highlightMessage(
            _: any,
            { circleId, envelopeId }: { circleId: number; envelopeId: string },
            { prisma, userId, cache }: Context,
        ) {
            if (!userId) throw new Error('Authentication required');

            // Verify circle membership
            const membership = await prisma.circleMember.findFirst({
                where: { circleId, userId, status: 'Active' },
            });
            if (!membership) throw new Error('Not a circle member');

            // Find message + prevent self-highlight
            const msg = await prisma.circleDiscussionMessage.findUnique({
                where: { envelopeId },
                select: {
                    senderPubkey: true,
                    circleId: true,
                    deleted: true,
                    isEphemeral: true,
                    isFeatured: true,
                    featureReason: true,
                    featuredAt: true,
                },
            });
            if (!msg || msg.circleId !== circleId || msg.deleted) throw new Error('Message not found');
            if (msg.isEphemeral) throw new Error('Cannot highlight ephemeral message');

            const user = await prisma.user.findUnique({
                where: { id: userId },
                select: { pubkey: true },
            });
            if (user?.pubkey === msg.senderPubkey) throw new Error('Cannot highlight own message');

            const targetUser = await prisma.user.findFirst({
                where: { pubkey: msg.senderPubkey },
                select: { id: true },
            });

            const result = await prisma.$transaction(async (tx) => {
                const inserted = await tx.discussionMessageHighlight.createMany({
                    data: [{ envelopeId, userId }],
                    skipDuplicates: true,
                });
                const highlightCount = await tx.discussionMessageHighlight.count({
                    where: { envelopeId },
                });
                const nextIsFeatured = msg.isFeatured || highlightCount > 0;
                const nextFeatureReason =
                    highlightCount > 0
                        ? 'member_highlight'
                        : msg.featureReason;
                const nextFeaturedAt =
                    nextIsFeatured
                        ? (msg.featuredAt ?? new Date())
                        : null;

                await tx.circleDiscussionMessage.update({
                    where: { envelopeId },
                    data: {
                        isFeatured: nextIsFeatured,
                        featuredAt: nextFeaturedAt,
                        featureReason: nextFeatureReason,
                    },
                });

                if (inserted.count > 0 && targetUser) {
                    await tx.$executeRaw`
                        INSERT INTO notifications (user_id, type, title, body, source_type, source_id, circle_id, read, created_at, metadata)
                        SELECT ${targetUser.id}, 'highlight', 'discussion.highlighted', NULL,
                               'discussion', ${envelopeId}, ${circleId}, false, NOW(),
                               jsonb_build_object('messageKey', 'discussion.highlighted', 'params', jsonb_build_object())
                        WHERE NOT EXISTS (
                            SELECT 1 FROM notifications WHERE user_id = ${targetUser.id}
                              AND type = 'highlight' AND source_id = ${envelopeId}
                        )`;
                }

                return {
                    ok: true,
                    highlightCount,
                    isFeatured: nextIsFeatured,
                    alreadyHighlighted: inserted.count === 0,
                };
            });

            if (cache && typeof (cache as { publish?: unknown }).publish === 'function') {
                try {
                    await publishDiscussionRealtimeEvent(cache, {
                        circleId,
                        envelopeId,
                        reason: 'message_refresh_required',
                    });
                } catch (error) {
                    const message = error instanceof Error ? error.message : String(error);
                    console.warn(`discussion realtime publish failed for highlight ${envelopeId}: ${message}`);
                }
            }

            return result;
        },

        // ── markNotificationsRead ──
        async markNotificationsRead(
            _: any,
            { ids }: { ids: number[] },
            { prisma, userId }: Context,
        ) {
            if (!userId) throw new Error('Authentication required');
            await prisma.notification.updateMany({
                where: { id: { in: ids }, userId },
                data: { read: true },
            });
            return true;
        },

        // ── addDraftComment ──
        async addDraftComment(
            _: any,
            { postId, content, lineRef }: { postId: number; content: string; lineRef?: string },
            { prisma, userId }: Context,
        ) {
            if (!userId) throw new Error('Authentication required');
            const trimmed = String(content || '').trim();
            if (!trimmed) throw new Error('empty_comment_content');

            const access = await authorizeDraftAction(prisma, {
                postId,
                userId,
                action: 'comment',
            });
            if (!access.allowed) {
                throw new Error(access.error);
            }

            return await prisma.$transaction(async (tx) => {
                const comment = await tx.draftComment.create({
                    data: {
                        postId,
                        userId,
                        content: trimmed,
                        lineRef: lineRef || null,
                    },
                    include: { user: true },
                });
                await bumpPostHeat(tx, {
                    postId,
                    delta: DRAFT_HEAT_EVENTS.comment,
                });
                return comment;
            });
        },
    },

    DraftComment: {
        user: async (comment: any, _: any, { prisma }: Context) => {
            if (comment.user) return comment.user;
            return await prisma.user.findUnique({ where: { id: comment.userId } });
        },
    },
};
