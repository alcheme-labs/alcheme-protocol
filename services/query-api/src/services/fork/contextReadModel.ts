import type { PrismaClient } from '@prisma/client';

import { createPrismaForkContextStore } from './contextStore';
import type {
    ForkContextReleaseRecord,
    ForkSourcePathEntry,
    ForkUpstreamReferenceRecord,
} from './contextTypes';

export interface ForkContextView {
    circleId: number;
    capsule: null | {
        capsuleId: string;
        sourceCircleId: number;
        targetCircleId: number;
        sourcePath: ForkSourcePathEntry[];
        originSnapshot: Record<string, unknown>;
        createdAt: string;
        status: string;
    };
    references: Array<{
        referenceId: string;
        referenceType: string;
        sourceCircleId: number;
        visibilityState: string;
        restrictionState: string;
        releaseId: string | null;
        sourceDigest: string | null;
        summaryDigest: string | null;
        canRequestExpansion: boolean;
    }>;
}

export interface ForkReferenceExpansionRecord {
    reference: ForkUpstreamReferenceRecord;
    release: ForkContextReleaseRecord | null;
}

function asPositiveInteger(value: unknown): number | null {
    const parsed = Number(value);
    return Number.isInteger(parsed) && parsed > 0 ? parsed : null;
}

function canRequestExpansion(reference: ForkUpstreamReferenceRecord): boolean {
    if (reference.restrictionState === 'revoked') return false;
    if (reference.visibilityState === 'sealed_source' && !reference.releaseId) return false;
    if (reference.visibilityState === 'released_summary') return true;
    if (reference.releaseId) return true;
    return reference.restrictionState === 'none'
        || reference.restrictionState === 'source_gate_required';
}

export async function loadForkContextView(
    prisma: PrismaClient,
    circleId: number,
): Promise<ForkContextView> {
    const targetCircleId = asPositiveInteger(circleId);
    if (!targetCircleId) {
        throw new Error('invalid_circle_id');
    }

    const store = createPrismaForkContextStore(prisma);
    const capsule = await store.getCapsuleByTargetCircleId(targetCircleId);
    if (!capsule) {
        return {
            circleId: targetCircleId,
            capsule: null,
            references: [],
        };
    }

    const references = await store.listReferencesByTargetCircleId(targetCircleId);
    return {
        circleId: targetCircleId,
        capsule: {
            capsuleId: capsule.capsuleId,
            sourceCircleId: capsule.sourceCircleId,
            targetCircleId: capsule.targetCircleId,
            sourcePath: capsule.sourcePathSnapshot,
            originSnapshot: capsule.originSnapshot,
            createdAt: capsule.createdAt.toISOString(),
            status: capsule.status,
        },
        references: references.map((reference) => ({
            referenceId: reference.referenceId,
            referenceType: reference.referenceType,
            sourceCircleId: reference.sourceCircleId,
            visibilityState: reference.visibilityState,
            restrictionState: reference.restrictionState,
            releaseId: reference.releaseId,
            sourceDigest: reference.sourceDigest,
            summaryDigest: reference.summaryDigest,
            canRequestExpansion: canRequestExpansion(reference),
        })),
    };
}

export async function loadForkReferenceExpansionRecord(
    prisma: PrismaClient,
    referenceId: string,
): Promise<ForkReferenceExpansionRecord | null> {
    const store = createPrismaForkContextStore(prisma);
    const reference = await store.getReferenceById(referenceId);
    if (!reference) {
        return null;
    }
    const release = reference.releaseId
        ? await store.getActiveReleaseById(reference.releaseId)
        : null;
    return {
        reference,
        release,
    };
}
