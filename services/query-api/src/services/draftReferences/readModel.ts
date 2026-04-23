import type { PrismaClient } from '@prisma/client';

import * as draftBlockReadModelService from '../draftBlocks/readModel';

export interface DraftReferenceLinkRecord {
    referenceId: string;
    draftPostId: number;
    draftVersion: number;
    sourceBlockId: string;
    crystalName: string;
    crystalBlockAnchor: string | null;
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
        status: 'parsed',
    };
}

export async function loadDraftReferenceLinks(
    prisma: PrismaClient,
    draftPostId: number,
): Promise<DraftReferenceLinkRecord[]> {
    const rows = await draftBlockReadModelService.resolveStableDraftReferenceLinkInputs(prisma, {
        draftPostId,
    });

    return rows
        .map((row) => mapDraftReferenceLinkRecord(row))
        .filter((row): row is DraftReferenceLinkRecord => Boolean(row));
}
