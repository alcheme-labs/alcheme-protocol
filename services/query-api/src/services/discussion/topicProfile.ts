import crypto from 'crypto';
import type { PrismaClient } from '@prisma/client';

import { embedDiscussionText } from '../../ai/embedding';
import { listSourceMaterials } from '../sourceMaterials/readModel';

const TOPIC_PROFILE_CACHE_TTL_MS = 60_000;
const topicProfileCache = new Map<number, {
    cachedAt: number;
    profile: DiscussionTopicProfile;
}>();

export interface DiscussionTopicProfile {
    circleId: number;
    topicProfileVersion: string;
    snapshotText: string;
    embedding: number[] | null;
    embeddingModel: string | null;
    embeddingProviderMode: 'builtin' | 'external' | null;
    sourceDigest: string;
}

interface TopicProfileSeededFileRecord {
    path: string;
    mimeType: string | null;
    lineCount: number | null;
    contentDigest: string | null;
}

function normalizeText(input: string | null | undefined): string {
    return String(input || '').replace(/\s+/g, ' ').trim();
}

function clipText(input: string, maxLength: number): string {
    if (input.length <= maxLength) return input;
    return `${input.slice(0, Math.max(0, maxLength - 1))}…`;
}

function buildTopicProfileCacheKey(circleId: number): number {
    return circleId;
}

function readCachedTopicProfile(circleId: number): DiscussionTopicProfile | null {
    const entry = topicProfileCache.get(buildTopicProfileCacheKey(circleId));
    if (!entry) return null;
    if ((Date.now() - entry.cachedAt) > TOPIC_PROFILE_CACHE_TTL_MS) {
        topicProfileCache.delete(buildTopicProfileCacheKey(circleId));
        return null;
    }
    return entry.profile;
}

function writeCachedTopicProfile(profile: DiscussionTopicProfile): DiscussionTopicProfile {
    topicProfileCache.set(buildTopicProfileCacheKey(profile.circleId), {
        cachedAt: Date.now(),
        profile,
    });
    return profile;
}

export function invalidateDiscussionTopicProfileCache(circleId?: number): void {
    if (typeof circleId === 'number' && Number.isFinite(circleId) && circleId > 0) {
        topicProfileCache.delete(buildTopicProfileCacheKey(circleId));
        return;
    }
    topicProfileCache.clear();
}

async function listSeededTopicProfileFiles(
    prisma: PrismaClient,
    circleId: number,
): Promise<TopicProfileSeededFileRecord[]> {
    if (typeof (prisma as any).seededSourceNode?.findMany !== 'function') {
        return [];
    }

    const rows = await (prisma as any).seededSourceNode.findMany({
        where: {
            circleId,
            nodeType: 'file',
        },
        orderBy: [
            { sortOrder: 'asc' },
            { path: 'asc' },
        ],
        select: {
            path: true,
            mimeType: true,
            lineCount: true,
            contentHash: true,
        },
    }) as Array<{
        path: string;
        mimeType: string | null;
        lineCount: number | null;
        contentHash: string | null;
    }>;

    return rows.map((row) => ({
        path: row.path,
        mimeType: row.mimeType ?? null,
        lineCount: row.lineCount ?? null,
        contentDigest: row.contentHash ?? null,
    }));
}

function buildTopicProfileSourceDigest(input: {
    circleId: number;
    circleName: string | null;
    circleDescription: string | null;
    materialDigestEntries: string[];
    seededDigestEntries: string[];
}): string {
    return crypto.createHash('sha256').update(JSON.stringify({
        circleId: input.circleId,
        circleName: input.circleName,
        circleDescription: input.circleDescription,
        materialDigestEntries: input.materialDigestEntries,
        seededDigestEntries: input.seededDigestEntries,
    })).digest('hex');
}

function buildTopicProfileSnapshot(input: {
    circleName: string | null;
    circleDescription: string | null;
    materialBlocks: string[];
    seededBlocks: string[];
}): string {
    const lines: string[] = [];
    lines.push(`圈层主题：${normalizeText(input.circleName) || '未命名圈层'}`);
    if (normalizeText(input.circleDescription)) {
        lines.push(`圈层描述：${normalizeText(input.circleDescription)}`);
    }

    if (input.materialBlocks.length > 0) {
        lines.push('Source Materials:');
        lines.push(...input.materialBlocks);
    }

    if (input.seededBlocks.length > 0) {
        lines.push('Seeded Source:');
        lines.push(...input.seededBlocks);
    }

    return lines.join('\n');
}

export async function loadDiscussionTopicProfile(
    prisma: PrismaClient,
    circleId: number,
): Promise<DiscussionTopicProfile> {
    const cached = readCachedTopicProfile(circleId);
    if (cached) {
        return cached;
    }

    const [circle, materials, seededFiles] = await Promise.all([
        prisma.circle.findUnique({
            where: { id: circleId },
            select: {
                name: true,
                description: true,
            },
        }),
        listSourceMaterials(prisma, { circleId }),
        listSeededTopicProfileFiles(prisma, circleId),
    ]);

    const materialBlocks = materials
        .slice(0, 8)
        .map((material) => {
            const descriptor = [
                material.mimeType ? `mime=${material.mimeType}` : null,
                material.contentDigest ? `digest=${material.contentDigest.slice(0, 12)}` : null,
                Number.isFinite(material.chunkCount) ? `chunks=${material.chunkCount}` : null,
            ].filter(Boolean).join(', ');
            return descriptor
                ? `- ${material.name} (${descriptor})`
                : `- ${material.name}`;
        });
    const materialDigestEntries = materials.map((material) => JSON.stringify({
        id: material.id,
        name: material.name,
        mimeType: material.mimeType ?? null,
        contentDigest: material.contentDigest,
        chunkCount: material.chunkCount,
        status: material.status,
    }));

    const seededBlocks = seededFiles
        .slice(0, 8)
        .map((node) => {
            const descriptor = [
                node.mimeType ? `mime=${node.mimeType}` : null,
                Number.isFinite(node.lineCount) ? `lines=${node.lineCount}` : null,
                node.contentDigest ? `digest=${node.contentDigest.slice(0, 12)}` : null,
            ].filter(Boolean).join(', ');
            return descriptor
                ? `- ${node.path} (${descriptor})`
                : `- ${node.path}`;
        });
    const seededDigestEntries = seededFiles.map((node) => JSON.stringify({
        path: node.path,
        mimeType: node.mimeType ?? null,
        lineCount: node.lineCount ?? null,
        contentDigest: node.contentDigest ?? null,
    }));

    const snapshotText = buildTopicProfileSnapshot({
        circleName: circle?.name ?? null,
        circleDescription: circle?.description ?? null,
        materialBlocks,
        seededBlocks,
    });
    const sourceDigest = buildTopicProfileSourceDigest({
        circleId,
        circleName: circle?.name ?? null,
        circleDescription: circle?.description ?? null,
        materialDigestEntries,
        seededDigestEntries,
    });
    const topicProfileVersion = `topic:${circleId}:${sourceDigest.slice(0, 16)}`;

    try {
        const embedding = await embedDiscussionText({
            text: snapshotText,
            purpose: 'circle-topic-profile',
        });
        return writeCachedTopicProfile({
            circleId,
            topicProfileVersion,
            snapshotText,
            embedding: embedding.embedding,
            embeddingModel: embedding.model,
            embeddingProviderMode: embedding.providerMode,
            sourceDigest,
        });
    } catch {
        return writeCachedTopicProfile({
            circleId,
            topicProfileVersion,
            snapshotText,
            embedding: null,
            embeddingModel: null,
            embeddingProviderMode: null,
            sourceDigest,
        });
    }
}
