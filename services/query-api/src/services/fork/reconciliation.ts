import type {
    CircleForkLineageRecord,
    ForkDeclarationRecord,
    ForkRuntimeStore,
} from './runtime';

function asRecord(value: unknown): Record<string, unknown> | null {
    if (typeof value === 'object' && value !== null && !Array.isArray(value)) {
        return value as Record<string, unknown>;
    }
    return null;
}

function normalizeLineageId(declarationId: string): string {
    return `fork-lineage:${declarationId}`;
}

export async function listPendingForkReconciliations(
    store: ForkRuntimeStore,
): Promise<ForkDeclarationRecord[]> {
    return store.listReconciliationPendingDeclarations();
}

export async function repairForkLineage(
    store: ForkRuntimeStore,
    input: {
        declarationId: string;
        inheritanceSnapshot: Record<string, unknown>;
        repairedAt?: Date;
    },
): Promise<CircleForkLineageRecord> {
    const declaration = await store.getDeclaration(input.declarationId);
    if (!declaration) {
        throw new Error('fork_declaration_not_found');
    }
    if (!declaration.targetCircleId) {
        throw new Error('fork_reconciliation_target_circle_missing');
    }
    if (!asRecord(input.inheritanceSnapshot)) {
        throw new Error('fork_reconciliation_inheritance_snapshot_required');
    }

    const existingLineage = await store.getLineageByDeclarationId(input.declarationId);
    if (existingLineage) {
        return existingLineage;
    }

    const repairedAt = input.repairedAt ?? new Date();
    const lineage = await store.saveLineage({
        lineageId: normalizeLineageId(input.declarationId),
        sourceCircleId: declaration.sourceCircleId,
        targetCircleId: declaration.targetCircleId,
        declarationId: declaration.declarationId,
        createdBy: declaration.actorUserId,
        originAnchorRef: declaration.originAnchorRef,
        inheritanceSnapshot: input.inheritanceSnapshot,
        executionAnchorDigest: declaration.executionAnchorDigest,
        createdAt: declaration.createdAt,
        updatedAt: repairedAt,
    });

    await store.saveDeclaration({
        ...declaration,
        status: 'completed',
        updatedAt: repairedAt,
    });

    return lineage;
}
