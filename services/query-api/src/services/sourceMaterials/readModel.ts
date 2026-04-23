import type { PrismaClient } from '@prisma/client';

import { loadPrivateText } from '../privateContentBridge';

export interface SourceMaterialListItem {
    id: number;
    circleId: number;
    draftPostId: number | null;
    discussionThreadId: string | null;
    seededSourceNodeId: number | null;
    name: string;
    mimeType: string | null;
    status: 'extracting' | 'ai_readable';
    contentDigest: string;
    chunkCount: number;
}

export interface SourceMaterialGroundingItem {
    materialId: number;
    name: string;
    mimeType: string | null;
    contentDigest: string;
    locatorType: string;
    locatorRef: string;
    text: string;
    textDigest: string;
}

function buildMaterialWhere(input: {
    circleId: number;
    materialIds?: number[] | null;
    draftPostId?: number | null;
    discussionThreadId?: string | null;
    seededSourceNodeId?: number | null;
}) {
    const materialIds = Array.isArray(input.materialIds)
        ? input.materialIds
            .map((value) => Number(value))
            .filter((value) => Number.isFinite(value) && value > 0)
        : [];

    return {
        circleId: input.circleId,
        ...(materialIds.length > 0 ? { id: { in: materialIds } } : {}),
        ...(input.draftPostId ? { draftPostId: input.draftPostId } : {}),
        ...(input.discussionThreadId ? { discussionThreadId: input.discussionThreadId } : {}),
        ...(input.seededSourceNodeId ? { seededSourceNodeId: input.seededSourceNodeId } : {}),
    };
}

export async function listSourceMaterials(
    prisma: PrismaClient,
    input: {
        circleId: number;
        materialIds?: number[] | null;
        draftPostId?: number | null;
        discussionThreadId?: string | null;
        seededSourceNodeId?: number | null;
    },
): Promise<SourceMaterialListItem[]> {
    const materials = await (prisma as any).sourceMaterial.findMany({
        where: buildMaterialWhere(input),
        orderBy: [
            { createdAt: 'desc' },
            { id: 'desc' },
        ],
        select: {
            id: true,
            circleId: true,
            draftPostId: true,
            discussionThreadId: true,
            seededSourceNodeId: true,
            name: true,
            mimeType: true,
            extractionStatus: true,
            contentDigest: true,
            chunks: {
                select: {
                    id: true,
                },
            },
        },
    });

    return materials.map((material: any) => ({
        id: material.id,
        circleId: material.circleId,
        draftPostId: material.draftPostId ?? null,
        discussionThreadId: material.discussionThreadId ?? null,
        seededSourceNodeId: material.seededSourceNodeId ?? null,
        name: material.name,
        mimeType: material.mimeType ?? null,
        status: material.extractionStatus === 'ready' ? 'ai_readable' : 'extracting',
        contentDigest: material.contentDigest,
        chunkCount: Array.isArray(material.chunks) ? material.chunks.length : 0,
    }));
}

export async function buildSourceMaterialGroundingContext(
    prisma: PrismaClient,
    input: {
        circleId: number;
        materialIds?: number[] | null;
        draftPostId?: number | null;
        discussionThreadId?: string | null;
        seededSourceNodeId?: number | null;
    },
): Promise<SourceMaterialGroundingItem[]> {
    if (typeof (prisma as any).sourceMaterial?.findMany !== 'function') {
        return [];
    }

    const materials = await (prisma as any).sourceMaterial.findMany({
        where: buildMaterialWhere(input),
        orderBy: [
            { createdAt: 'desc' },
            { id: 'desc' },
        ],
        select: {
            id: true,
            name: true,
            mimeType: true,
            contentDigest: true,
            chunks: {
                orderBy: [{ chunkIndex: 'asc' }],
                select: {
                    id: true,
                    chunkIndex: true,
                    locatorType: true,
                    locatorRef: true,
                    text: true,
                    textLocator: true,
                    textDigest: true,
                },
            },
        },
    });

    return Promise.all(materials.flatMap((material: any) => (
        Array.isArray(material.chunks)
            ? material.chunks.map(async (chunk: any) => ({
                materialId: material.id,
                name: material.name,
                mimeType: material.mimeType ?? null,
                contentDigest: material.contentDigest,
                locatorType: chunk.locatorType,
                locatorRef: chunk.locatorRef,
                text: (typeof chunk.text === 'string' && chunk.text.length > 0)
                    ? chunk.text
                    : (await loadPrivateText(chunk.textLocator)) || '',
                textDigest: chunk.textDigest,
            }))
            : []
    )));
}
