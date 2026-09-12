import type { PrismaClient } from '@prisma/client';

import { loadPrivateText } from '../privateContentBridge';
import {
    SOURCE_MATERIAL_GROUNDING_STATUSES,
    SOURCE_MATERIAL_REVIEW_QUEUE_STATUSES,
    normalizeSourceMaterialLifecycleStatus,
    normalizeSourceMaterialPrivacyClass,
    isSourceMaterialVisibleToCircleMember,
    type SourceMaterialLifecycleStatus,
    type SourceMaterialPrivacyClass,
} from './lifecycle';
import { isForkUpstreamReferenceAvailableToTargetCircle } from './forkContextAudience';

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
    summaryText: string | null;
    originType: string;
    originRef: string | null;
    canonicalUrl: string | null;
    externalAuthorLabel: string | null;
    sourcePublishedAt: Date | null;
    capturedAt: Date | null;
    sourceVersion: number | null;
    previousVersionId: number | null;
    versionDiff: {
        previousVersion: number;
        previousContentDigest: string;
        addedChunks: number;
        removedChunks: number;
        unchangedChunks: number;
    } | null;
    externalAppId: string | null;
    roomKey: string | null;
    lifecycleStatus: SourceMaterialLifecycleStatus;
    evidencePrivacyClass: SourceMaterialPrivacyClass;
    visibilityScope: string;
    submittedByPubkey: string | null;
    expiresAt: Date | null;
    provenance: Record<string, unknown> | null;
    licenseFacts: Record<string, unknown> | null;
    licenseFactsDigest: string | null;
    licenseAuthorizedByPubkey: string | null;
    licenseAuthorizedAt: Date | null;
    storageObjectId: string | null;
    storageReceiptDigest: string | null;
    chunks: Array<{
        id: number;
        chunkIndex: number;
        textDigest: string;
    }>;
    chunkCount: number;
    createdAt: Date;
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
    lifecycleStatuses?: SourceMaterialLifecycleStatus[] | null;
    createdAtCutoff?: Date | null;
    canReview?: boolean;
    canViewReviewQueue?: boolean;
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
        ...(input.createdAtCutoff ? { createdAt: { lte: input.createdAtCutoff } } : {}),
        ...(Array.isArray(input.lifecycleStatuses) && input.lifecycleStatuses.length > 0
            ? { lifecycleStatus: { in: input.lifecycleStatuses } }
            : {}),
        ...(!input.canReview
            ? { evidencePrivacyClass: { notIn: ['reviewer_only', 'sealed', 'redacted'] } }
            : { evidencePrivacyClass: { notIn: ['sealed', 'redacted'] } }),
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
        canReview?: boolean;
        canViewReviewQueue?: boolean;
        createdAtCutoff?: Date | null;
    },
): Promise<SourceMaterialListItem[]> {
    const canIncludeReviewQueue = Boolean(input.canReview || input.canViewReviewQueue);
    const materials = await (prisma as any).sourceMaterial.findMany({
        where: buildMaterialWhere({
            ...input,
            lifecycleStatuses: canIncludeReviewQueue
                ? [
                    ...SOURCE_MATERIAL_REVIEW_QUEUE_STATUSES,
                    ...SOURCE_MATERIAL_GROUNDING_STATUSES,
                ]
                : SOURCE_MATERIAL_GROUNDING_STATUSES,
            canReview: input.canReview,
            canViewReviewQueue: input.canViewReviewQueue,
        }),
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
            summaryText: true,
            originType: true,
            originRef: true,
            canonicalUrl: true,
            externalAuthorLabel: true,
            sourcePublishedAt: true,
            capturedAt: true,
            sourceVersion: true,
            previousVersionId: true,
            externalAppId: true,
            roomKey: true,
            lifecycleStatus: true,
            evidencePrivacyClass: true,
            visibilityScope: true,
            submittedByPubkey: true,
            expiresAt: true,
            provenance: true,
            licenseFacts: true,
            licenseFactsDigest: true,
            licenseAuthorizedByPubkey: true,
            licenseAuthorizedAt: true,
            storageObjectId: true,
            storageReceiptDigest: true,
            createdAt: true,
            previousVersion: {
                select: {
                    sourceVersion: true,
                    contentDigest: true,
                    chunks: { select: { textDigest: true } },
                },
            },
            chunks: {
                select: {
                    id: true,
                    chunkIndex: true,
                    textDigest: true,
                },
                orderBy: { chunkIndex: 'asc' },
            },
        },
    });

    return materials
        .filter((material: any) => isSourceMaterialVisibleToCircleMember({
            lifecycleStatus: normalizeSourceMaterialLifecycleStatus(
                material.lifecycleStatus ?? 'accepted_to_plaza',
            ),
            evidencePrivacyClass: normalizeSourceMaterialPrivacyClass(
                material.evidencePrivacyClass ?? 'public',
            ),
            canReview: input.canReview,
            canViewReviewQueue: input.canViewReviewQueue,
        })
        && isForkUpstreamReferenceAvailableToTargetCircle(material))
        .map((material: any) => ({
            id: material.id,
            circleId: material.circleId,
            draftPostId: material.draftPostId ?? null,
            discussionThreadId: material.discussionThreadId ?? null,
            seededSourceNodeId: material.seededSourceNodeId ?? null,
            name: material.name,
            mimeType: material.mimeType ?? null,
            status: material.extractionStatus === 'ready' ? 'ai_readable' : 'extracting',
            contentDigest: material.contentDigest,
            summaryText: material.summaryText ?? null,
            originType: material.originType ?? 'manual_upload',
            originRef: material.originRef ?? null,
            canonicalUrl: material.canonicalUrl ?? null,
            externalAuthorLabel: material.externalAuthorLabel ?? null,
            sourcePublishedAt: material.sourcePublishedAt ?? null,
            capturedAt: material.capturedAt ?? null,
            sourceVersion: Number.isSafeInteger(material.sourceVersion) ? material.sourceVersion : null,
            previousVersionId: Number.isSafeInteger(material.previousVersionId)
                ? material.previousVersionId
                : null,
            versionDiff: buildSourceMaterialVersionDiff(material),
            externalAppId: material.externalAppId ?? null,
            roomKey: material.roomKey ?? null,
            lifecycleStatus: normalizeSourceMaterialLifecycleStatus(
                material.lifecycleStatus ?? 'accepted_to_plaza',
            ),
            evidencePrivacyClass: normalizeSourceMaterialPrivacyClass(
                material.evidencePrivacyClass ?? 'public',
            ),
            visibilityScope: material.visibilityScope ?? 'circle',
            submittedByPubkey: material.submittedByPubkey ?? null,
            expiresAt: material.expiresAt ?? null,
            provenance: isRecord(material.provenance) ? material.provenance : null,
            licenseFacts: isRecord(material.licenseFacts) ? material.licenseFacts : null,
            licenseFactsDigest: material.licenseFactsDigest ?? null,
            licenseAuthorizedByPubkey: material.licenseAuthorizedByPubkey ?? null,
            licenseAuthorizedAt: material.licenseAuthorizedAt ?? null,
            storageObjectId: material.storageObjectId ?? null,
            storageReceiptDigest: material.storageReceiptDigest ?? null,
            chunks: Array.isArray(material.chunks)
                ? material.chunks.flatMap((chunk: any) => (
                    Number.isSafeInteger(chunk?.id)
                    && Number.isSafeInteger(chunk?.chunkIndex)
                    && typeof chunk?.textDigest === 'string'
                        ? [{ id: chunk.id, chunkIndex: chunk.chunkIndex, textDigest: chunk.textDigest }]
                        : []
                ))
                : [],
            chunkCount: Array.isArray(material.chunks) ? material.chunks.length : 0,
            createdAt: material.createdAt,
        }));
}

export function selectLatestExternalUrlCaptureVersions(
    materials: SourceMaterialListItem[],
): SourceMaterialListItem[] {
    const latestByOrigin = new Map<string, SourceMaterialListItem>();
    for (const material of materials) {
        if (material.originType !== 'external_url_capture' || !material.originRef) continue;
        const current = latestByOrigin.get(material.originRef);
        if (!current || (material.sourceVersion ?? 0) > (current.sourceVersion ?? 0)) {
            latestByOrigin.set(material.originRef, material);
        }
    }
    const selectedIds = new Set([...latestByOrigin.values()].map((material) => material.id));
    return materials.filter((material) => selectedIds.has(material.id));
}

function buildSourceMaterialVersionDiff(material: any): SourceMaterialListItem['versionDiff'] {
    const previous = material?.previousVersion;
    if (
        !previous
        || !Number.isSafeInteger(previous.sourceVersion)
        || typeof previous.contentDigest !== 'string'
        || !Array.isArray(previous.chunks)
        || !Array.isArray(material?.chunks)
    ) return null;

    const previousCounts = digestCounts(previous.chunks);
    const currentCounts = digestCounts(material.chunks);
    let unchangedChunks = 0;
    for (const [digest, count] of currentCounts) {
        unchangedChunks += Math.min(count, previousCounts.get(digest) ?? 0);
    }
    const currentTotal = [...currentCounts.values()].reduce((total, count) => total + count, 0);
    const previousTotal = [...previousCounts.values()].reduce((total, count) => total + count, 0);
    return {
        previousVersion: previous.sourceVersion,
        previousContentDigest: previous.contentDigest,
        addedChunks: currentTotal - unchangedChunks,
        removedChunks: previousTotal - unchangedChunks,
        unchangedChunks,
    };
}

function digestCounts(chunks: any[]): Map<string, number> {
    const counts = new Map<string, number>();
    for (const chunk of chunks) {
        if (typeof chunk?.textDigest !== 'string') continue;
        counts.set(chunk.textDigest, (counts.get(chunk.textDigest) ?? 0) + 1);
    }
    return counts;
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
        where: buildMaterialWhere({
            ...input,
            lifecycleStatuses: SOURCE_MATERIAL_GROUNDING_STATUSES,
            canReview: false,
        }),
        orderBy: [
            { createdAt: 'desc' },
            { id: 'desc' },
        ],
        select: {
            id: true,
            name: true,
            mimeType: true,
            contentDigest: true,
            originType: true,
            lifecycleStatus: true,
            evidencePrivacyClass: true,
            provenance: true,
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

    const visibleMaterials = materials.filter((material: any) =>
        isSourceMaterialVisibleToCircleMember({
            lifecycleStatus: normalizeSourceMaterialLifecycleStatus(
                material.lifecycleStatus ?? 'accepted_to_plaza',
            ),
            evidencePrivacyClass: normalizeSourceMaterialPrivacyClass(
                material.evidencePrivacyClass ?? 'public',
            ),
        })
        && isForkUpstreamReferenceAvailableToTargetCircle(material),
    );

    return Promise.all(visibleMaterials.flatMap((material: any) => (
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

function isRecord(value: unknown): value is Record<string, unknown> {
    return Boolean(value) && typeof value === 'object' && !Array.isArray(value);
}
