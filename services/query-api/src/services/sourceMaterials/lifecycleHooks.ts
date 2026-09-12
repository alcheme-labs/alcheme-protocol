import type { Prisma, PrismaClient } from '@prisma/client';

import {
    normalizeSourceMaterialLifecycleStatus,
    type SourceMaterialLifecycleStatus,
} from './lifecycle';
import { isForkUpstreamReferenceAvailableToTargetCircle } from './forkContextAudience';

type PrismaLike = PrismaClient | Prisma.TransactionClient;

const DRAFT_USABLE_STATUSES = new Set<SourceMaterialLifecycleStatus>([
    'accepted_to_plaza',
    'used_in_draft',
    'crystallized',
]);

const CRYSTALLIZABLE_STATUSES = new Set<SourceMaterialLifecycleStatus>([
    'used_in_draft',
    'crystallized',
]);

function normalizePositiveIds(value: number[] | null | undefined): number[] {
    return Array.from(new Set(
        (Array.isArray(value) ? value : [])
            .map((item) => Number(item))
            .filter((item) => Number.isFinite(item) && item > 0),
    )).sort((left, right) => left - right);
}

function normalizeStatusOrNull(value: unknown): SourceMaterialLifecycleStatus | null {
    try {
        return normalizeSourceMaterialLifecycleStatus(value);
    } catch {
        return null;
    }
}

function appendLifecycleEvent(input: {
    existing: unknown;
    event: Record<string, unknown>;
}): Record<string, unknown> {
    const base = input.existing && typeof input.existing === 'object' && !Array.isArray(input.existing)
        ? { ...(input.existing as Record<string, unknown>) }
        : {};
    const events = Array.isArray(base.lifecycleEvents)
        ? base.lifecycleEvents.filter((event) => event && typeof event === 'object').slice(-19)
        : [];
    return {
        ...base,
        lifecycleEvents: [
            ...events,
            input.event,
        ],
    };
}

function asRecord(value: unknown): Record<string, unknown> | null {
    return value && typeof value === 'object' && !Array.isArray(value)
        ? value as Record<string, unknown>
        : null;
}

function extractForkContextMarker(provenance: unknown): Record<string, unknown> | null {
    const record = asRecord(provenance);
    const source = asRecord(record?.source);
    const restriction = asRecord(record?.restriction);
    if (!source || !restriction) return null;
    if (source.kind !== 'fork_context_release') return null;
    if (restriction.state !== 'released_safe_summary') return null;
    const releaseId = typeof source.releaseId === 'string' ? source.releaseId.trim() : '';
    const referenceId = typeof source.referenceId === 'string' ? source.referenceId.trim() : '';
    const summaryDigest = typeof source.summaryDigest === 'string' ? source.summaryDigest.trim() : '';
    const sourceCircleId = Number(source.sourceCircleId);
    if (!releaseId || !summaryDigest || !Number.isInteger(sourceCircleId) || sourceCircleId <= 0) {
        return null;
    }
    return {
        ...(referenceId ? { referenceId } : {}),
        releaseId,
        sourceCircleId,
        summaryDigest,
    };
}

async function loadSourceMaterialsForDraft(
    prisma: PrismaLike,
    input: {
        draftPostId: number;
        sourceMaterialIds?: number[] | null;
        lifecycleStatuses?: SourceMaterialLifecycleStatus[] | null;
    },
): Promise<Array<{
    id: number;
    draftPostId: number | null;
    lifecycleStatus: SourceMaterialLifecycleStatus;
    provenance: unknown;
    originType: string | null;
}>> {
    const prismaAny = prisma as any;
    if (typeof prismaAny.sourceMaterial?.findMany !== 'function') return [];
    const sourceMaterialIds = normalizePositiveIds(input.sourceMaterialIds);
    const rows = await prismaAny.sourceMaterial.findMany({
        where: {
            draftPostId: input.draftPostId,
            ...(sourceMaterialIds.length > 0 ? { id: { in: sourceMaterialIds } } : {}),
            ...(Array.isArray(input.lifecycleStatuses) && input.lifecycleStatuses.length > 0
                ? { lifecycleStatus: { in: input.lifecycleStatuses } }
                : {}),
        },
        select: {
            id: true,
            draftPostId: true,
            lifecycleStatus: true,
            provenance: true,
            originType: true,
        },
    });
    return (Array.isArray(rows) ? rows : [])
        .map((row) => ({
            id: Number(row.id),
            draftPostId: Number.isFinite(Number(row.draftPostId)) ? Number(row.draftPostId) : null,
            lifecycleStatus: normalizeStatusOrNull(row.lifecycleStatus) ?? 'accepted_to_plaza',
            provenance: row.provenance ?? null,
            originType: typeof row.originType === 'string' ? row.originType : null,
        }))
        .filter((row) => Number.isFinite(row.id)
            && row.id > 0
            && isForkUpstreamReferenceAvailableToTargetCircle(row));
}

export async function markSourceMaterialsUsedInDraft(
    prisma: PrismaLike,
    input: {
        sourceMaterialIds: number[];
        draftPostId: number;
        actorUserId?: number | null;
    },
): Promise<void> {
    const sourceMaterialIds = normalizePositiveIds(input.sourceMaterialIds);
    if (sourceMaterialIds.length === 0) return;
    const materials = await loadSourceMaterialsForDraft(prisma, {
        draftPostId: input.draftPostId,
        sourceMaterialIds,
    });
    const foundIds = new Set(materials.map((material) => material.id));
    const missingIds = sourceMaterialIds.filter((id) => !foundIds.has(id));
    if (missingIds.length > 0) {
        throw new Error('source_material_not_available_for_draft');
    }
    const invalid = materials.find((material) => !DRAFT_USABLE_STATUSES.has(material.lifecycleStatus));
    if (invalid) {
        throw new Error('source_material_not_accepted_for_draft');
    }
    const toPromote = materials.filter((material) => material.lifecycleStatus === 'accepted_to_plaza');
    if (toPromote.length === 0) return;

    const prismaAny = prisma as any;
    if (typeof prismaAny.sourceMaterial?.updateMany !== 'function') {
        throw new Error('source_material_lifecycle_update_unavailable');
    }
    await prismaAny.sourceMaterial.updateMany({
        where: {
            draftPostId: input.draftPostId,
            id: { in: toPromote.map((material) => material.id) },
            lifecycleStatus: 'accepted_to_plaza',
        },
        data: {
            lifecycleStatus: 'used_in_draft',
        },
    });
}

export async function markSourceMaterialsCrystallized(
    prisma: PrismaLike,
    input: {
        sourceMaterialIds: number[];
        draftPostId: number;
        knowledgeId: string;
        crystalId?: string | null;
    },
): Promise<void> {
    const explicitIds = normalizePositiveIds(input.sourceMaterialIds);
    const materials = await loadSourceMaterialsForDraft(prisma, {
        draftPostId: input.draftPostId,
        sourceMaterialIds: explicitIds,
        lifecycleStatuses: explicitIds.length > 0
            ? null
            : ['used_in_draft'],
    });
    if (explicitIds.length > 0) {
        const foundIds = new Set(materials.map((material) => material.id));
        const missingIds = explicitIds.filter((id) => !foundIds.has(id));
        if (missingIds.length > 0) {
            throw new Error('source_material_not_available_for_crystallization');
        }
    }
    if (materials.length === 0) return;
    const invalid = materials.find((material) => !CRYSTALLIZABLE_STATUSES.has(material.lifecycleStatus));
    if (invalid) {
        throw new Error('source_material_not_used_in_draft');
    }
    const toPromote = materials.filter((material) => material.lifecycleStatus === 'used_in_draft');
    if (toPromote.length === 0) return;

    const prismaAny = prisma as any;
    if (typeof prismaAny.sourceMaterial?.update !== 'function') {
        if (typeof prismaAny.sourceMaterial?.updateMany !== 'function') {
            throw new Error('source_material_lifecycle_update_unavailable');
        }
        await prismaAny.sourceMaterial.updateMany({
            where: {
                draftPostId: input.draftPostId,
                id: { in: toPromote.map((material) => material.id) },
                lifecycleStatus: 'used_in_draft',
            },
            data: {
                lifecycleStatus: 'crystallized',
            },
        });
        return;
    }

    await Promise.all(toPromote.map((material) => prismaAny.sourceMaterial.update({
        where: { id: material.id },
        data: {
            lifecycleStatus: 'crystallized',
            provenance: appendLifecycleEvent({
                existing: material.provenance,
                event: (() => {
                    const forkContext = extractForkContextMarker(material.provenance);
                    return {
                        fromStatus: 'used_in_draft',
                        toStatus: 'crystallized',
                        draftPostId: input.draftPostId,
                        knowledgeId: input.knowledgeId,
                        crystalId: input.crystalId ?? null,
                        ...(forkContext ? { forkContext } : {}),
                        at: new Date().toISOString(),
                    };
                })(),
            }),
        },
    })));
}
