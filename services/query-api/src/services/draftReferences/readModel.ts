import type { PrismaClient } from '@prisma/client';

import * as draftBlockReadModelService from '../draftBlocks/readModel';

export interface DraftReferenceLinkRecord {
    referenceId: string;
    draftPostId: number;
    draftVersion: number;
    sourceBlockId: string;
    crystalName: string;
    crystalBlockAnchor: string | null;
    sourceKnowledgeId: string | null;
    sourceOnChainAddress: string | null;
    resolutionStatus: 'resolved' | 'not_found' | 'ambiguous';
    status: 'parsed';
}

function asPositiveInt(value: unknown): number | null {
    const parsed = Number(value);
    return Number.isInteger(parsed) && parsed > 0 ? parsed : null;
}

function asNullableString(value: unknown): string | null {
    return typeof value === 'string' && value.trim().length > 0 ? value : null;
}

function mapDraftReferenceLinkRecord(
    value: unknown,
): DraftReferenceLinkRecord | null {
    if (!value || typeof value !== 'object' || Array.isArray(value)) {
        return null;
    }
    const row = value as Record<string, unknown>;
    const draftPostId = asPositiveInt(row.draftPostId);
    const draftVersion = asPositiveInt(row.draftVersion);
    if (
        typeof row.referenceId !== 'string'
        || !row.referenceId.trim()
        || !draftPostId
        || !draftVersion
        || typeof row.sourceBlockId !== 'string'
        || !row.sourceBlockId.trim()
        || typeof row.crystalName !== 'string'
        || !row.crystalName.trim()
        || row.status !== 'parsed'
    ) {
        return null;
    }

    return {
        referenceId: row.referenceId,
        draftPostId,
        draftVersion,
        sourceBlockId: row.sourceBlockId,
        crystalName: row.crystalName,
        crystalBlockAnchor: asNullableString(row.crystalBlockAnchor),
        sourceKnowledgeId: typeof row.sourceKnowledgeId === 'string' && row.sourceKnowledgeId.trim()
            ? row.sourceKnowledgeId
            : null,
        sourceOnChainAddress: typeof row.sourceOnChainAddress === 'string' && row.sourceOnChainAddress.trim()
            ? row.sourceOnChainAddress
            : null,
        resolutionStatus:
            row.resolutionStatus === 'resolved'
            || row.resolutionStatus === 'not_found'
            || row.resolutionStatus === 'ambiguous'
                ? row.resolutionStatus
                : 'not_found',
        status: 'parsed',
    };
}

async function resolveDraftCircleId(prisma: PrismaClient, draftPostId: number): Promise<number | null> {
    const post = await prisma.post.findUnique({
        where: { id: draftPostId },
        select: { circleId: true },
    });
    return typeof post?.circleId === 'number' ? post.circleId : null;
}

async function resolveReferenceTarget(
    prisma: PrismaClient,
    input: {
        circleId: number | null;
        crystalName: string;
        markerKnowledgeId: string | null;
    },
): Promise<{
    sourceKnowledgeId: string | null;
    sourceOnChainAddress: string | null;
    resolutionStatus: 'resolved' | 'not_found' | 'ambiguous';
}> {
    if (!input.circleId) {
        return {
            sourceKnowledgeId: null,
            sourceOnChainAddress: null,
            resolutionStatus: 'not_found',
        };
    }

    const where = input.markerKnowledgeId
        ? { circleId: input.circleId, knowledgeId: input.markerKnowledgeId }
        : { circleId: input.circleId, title: input.crystalName };
    const rows = await prisma.knowledge.findMany({
        where,
        select: {
            knowledgeId: true,
            onChainAddress: true,
        },
        take: 2,
    });

    if (rows.length === 1) {
        return {
            sourceKnowledgeId: rows[0].knowledgeId,
            sourceOnChainAddress: rows[0].onChainAddress,
            resolutionStatus: 'resolved',
        };
    }
    return {
        sourceKnowledgeId: null,
        sourceOnChainAddress: null,
        resolutionStatus: rows.length > 1 ? 'ambiguous' : 'not_found',
    };
}

export async function loadDraftReferenceLinks(
    prisma: PrismaClient,
    draftPostId: number,
): Promise<DraftReferenceLinkRecord[]> {
    const [rows, circleId] = await Promise.all([
        draftBlockReadModelService.resolveStableDraftReferenceLinkInputs(prisma, {
            draftPostId,
        }),
        resolveDraftCircleId(prisma, draftPostId),
    ]);

    const resolvedRows = await Promise.all(rows.map(async (row) => {
        const resolution = await resolveReferenceTarget(prisma, {
            circleId,
            crystalName: String((row as any).crystalName || ''),
            markerKnowledgeId: asNullableString((row as any).markerKnowledgeId),
        });
        return {
            ...row,
            ...resolution,
        };
    }));

    return resolvedRows
        .map((row) => mapDraftReferenceLinkRecord(row))
        .filter((row): row is DraftReferenceLinkRecord => Boolean(row));
}
