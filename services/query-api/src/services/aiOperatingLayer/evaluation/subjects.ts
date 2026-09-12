import crypto from 'crypto';

import { buildEvidenceRefFromSourceMaterial } from '../evidenceLedger';
import type { EvidenceRef } from '../types';
import {
    buildSourceMaterialGroundingContext,
    listSourceMaterials,
} from '../../sourceMaterials/readModel';
import {
    SOURCE_MATERIAL_GROUNDING_STATUSES,
    SOURCE_MATERIAL_REVIEW_QUEUE_STATUSES,
    normalizeSourceMaterialLifecycleStatus,
} from '../../sourceMaterials/lifecycle';
import type {
    NeutralEvaluationSelection,
    NeutralEvaluationSubjectType,
} from './types';

const MAX_EXCERPT_CHARS = 2200;

export async function selectNeutralEvaluationSubjectEvidence(
    prisma: any,
    input: {
        circleId: number;
        subjectType: NeutralEvaluationSubjectType;
        subjectId: string;
        includeProviderContext?: boolean;
    },
): Promise<NeutralEvaluationSelection> {
    if (input.subjectType === 'source_material') {
        return selectSourceMaterialSubject(prisma, {
            ...input,
            subjectType: 'source_material',
        });
    }
    return selectPostLikeSubject(prisma, {
        ...input,
        subjectType: input.subjectType,
    });
}

function refId(ref: Pick<EvidenceRef, 'sourceType' | 'sourceId'>): string {
    return `${ref.sourceType}:${ref.sourceId}`;
}

async function selectPostLikeSubject(
    prisma: any,
    input: {
        circleId: number;
        subjectType: 'post' | 'draft_post';
        subjectId: string;
        includeProviderContext?: boolean;
    },
): Promise<NeutralEvaluationSelection> {
    const post = await loadPostSubject(prisma, input.subjectType, input.subjectId);
    if (!post || (post.circleId && Number(post.circleId) !== input.circleId)) {
        return emptySelection(input, 'source_not_found');
    }
    const text = String(post.text || '').trim();
    if (!text) return emptySelection(input, 'empty_source');
    const digest = sha256Hex(JSON.stringify({
        subjectType: input.subjectType,
        subjectId: input.subjectId,
        textDigest: sha256Hex(text),
        updatedAt: serializeDate(post.updatedAt ?? post.createdAt),
    }));
    const sourceId = input.subjectType === 'draft_post'
        ? `draft_post:${post.id}`
        : `post:${post.contentId || post.id}`;
    const ref: EvidenceRef = {
        sourceType: 'domain_artifact',
        sourceId,
        digest,
        visibility: input.subjectType === 'draft_post' ? 'member_visible' : 'public',
        locator: {
            type: input.subjectType === 'draft_post' ? 'draft_post' : 'post',
            ref: String(input.subjectType === 'draft_post' ? post.id : post.contentId || post.id),
        },
        permissionSnapshot: {
            neutralEvaluation: {
                circleId: input.circleId,
                subjectType: input.subjectType,
                subjectId: String(input.subjectId),
                authorUserId: Number(post.authorId ?? 0) || null,
                contentType: String(post.contentType || ''),
                status: String(post.status || ''),
                visibility: String(post.visibility || ''),
            },
        },
        capturedAt: serializeDate(post.createdAt) ?? new Date().toISOString(),
        expiresAt: null,
    };
    return {
        status: 'ready',
        circleId: input.circleId,
        subjectType: input.subjectType,
        subjectId: String(input.subjectId),
        authorUserId: Number(post.authorId ?? 0) || null,
        evidenceRefs: [ref],
        providerSources: input.includeProviderContext ? [{
            refId: refId(ref),
            sourceType: ref.sourceType,
            sourceId: ref.sourceId,
            title: input.subjectType === 'draft_post' ? `Draft ${post.id}` : `Post ${post.contentId || post.id}`,
            excerpt: truncateText(text, MAX_EXCERPT_CHARS),
            visibility: ref.visibility,
        }] : [],
        sourceDigest: digestJson([{
            sourceType: ref.sourceType,
            sourceId: ref.sourceId,
            digest: ref.digest,
            visibility: ref.visibility,
        }]),
        requiresPrivatePlaintext: input.subjectType === 'draft_post',
        subjectSnapshot: {
            subjectType: input.subjectType,
            subjectId: String(input.subjectId),
            authorUserId: Number(post.authorId ?? 0) || null,
            contentType: String(post.contentType || ''),
        },
    };
}

async function loadPostSubject(prisma: any, subjectType: 'post' | 'draft_post', subjectId: string) {
    if (typeof prisma?.post?.findFirst !== 'function') return null;
    const numericId = Number(subjectId);
    const or = Number.isInteger(numericId) && numericId > 0
        ? [{ id: numericId }, { contentId: subjectId }, { onChainAddress: subjectId }]
        : [{ contentId: subjectId }, { onChainAddress: subjectId }];
    return prisma.post.findFirst({
        where: {
            OR: or,
            ...(subjectType === 'draft_post'
                ? { status: 'Draft' }
                : { safetyQuarantined: false }),
        },
        select: {
            id: true,
            contentId: true,
            authorId: true,
            circleId: true,
            text: true,
            contentType: true,
            status: true,
            visibility: true,
            createdAt: true,
            updatedAt: true,
        },
    });
}

async function selectSourceMaterialSubject(
    prisma: any,
    input: {
        circleId: number;
        subjectType: 'source_material';
        subjectId: string;
        includeProviderContext?: boolean;
    },
): Promise<NeutralEvaluationSelection> {
    const materialId = Number(input.subjectId);
    if (!Number.isInteger(materialId) || materialId <= 0) {
        return emptySelection(input, 'source_not_found');
    }
    const records = await loadSourceMaterialsForEvaluation(prisma, input.circleId, [materialId]);
    const material = records[0] ?? null;
    if (!material) return emptySelection(input, 'source_not_found');
    const lifecycleStatus = normalizeSourceMaterialLifecycleStatus(material.lifecycleStatus);
    const ref = buildEvidenceRefFromSourceMaterial({
        id: material.id,
        contentDigest: material.contentDigest,
        lifecycleStatus,
        evidencePrivacyClass: material.evidencePrivacyClass,
        visibilityScope: material.visibilityScope,
        originType: material.originType,
        originRef: material.originRef,
        expiresAt: material.expiresAt,
    });
    if (
        SOURCE_MATERIAL_REVIEW_QUEUE_STATUSES.includes(lifecycleStatus)
        || !SOURCE_MATERIAL_GROUNDING_STATUSES.includes(lifecycleStatus)
    ) {
        return {
            status: 'blocked_transcript_review',
            blockReason: 'transcript_review_required',
            circleId: input.circleId,
            subjectType: 'source_material',
            subjectId: String(materialId),
            authorUserId: Number(material.uploadedByUserId ?? 0) || null,
            evidenceRefs: [ref],
            providerSources: [],
            sourceDigest: digestJson([{ sourceType: ref.sourceType, sourceId: ref.sourceId, digest: ref.digest, visibility: ref.visibility }]),
            requiresPrivatePlaintext: false,
            subjectSnapshot: sourceMaterialSnapshot(material),
        };
    }
    const list = await listSourceMaterials(prisma, {
        circleId: input.circleId,
        materialIds: [materialId],
        canReview: false,
        canViewReviewQueue: false,
    });
    if (list.length === 0) return emptySelection(input, 'source_not_found');
    const grounding = input.includeProviderContext
        ? await buildSourceMaterialGroundingContext(prisma, {
            circleId: input.circleId,
            materialIds: [materialId],
        })
        : [];
    const excerpt = truncateText(grounding.map((item) => item.text.trim()).filter(Boolean).join('\n\n'), MAX_EXCERPT_CHARS);
    return {
        status: excerpt || !input.includeProviderContext ? 'ready' : 'no_source',
        blockReason: excerpt || !input.includeProviderContext ? undefined : 'empty_source',
        circleId: input.circleId,
        subjectType: 'source_material',
        subjectId: String(materialId),
        authorUserId: Number(material.uploadedByUserId ?? 0) || null,
        evidenceRefs: [ref],
        providerSources: input.includeProviderContext && excerpt ? [{
            refId: refId(ref),
            sourceType: ref.sourceType,
            sourceId: ref.sourceId,
            title: String(material.name || `Source material ${materialId}`),
            excerpt,
            visibility: ref.visibility,
        }] : [],
        sourceDigest: digestJson([{ sourceType: ref.sourceType, sourceId: ref.sourceId, digest: ref.digest, visibility: ref.visibility }]),
        requiresPrivatePlaintext: Boolean(input.includeProviderContext),
        subjectSnapshot: sourceMaterialSnapshot(material),
    };
}

async function loadSourceMaterialsForEvaluation(prisma: any, circleId: number, materialIds: number[]) {
    if (typeof prisma?.sourceMaterial?.findMany !== 'function') return [];
    return prisma.sourceMaterial.findMany({
        where: {
            circleId,
            id: { in: materialIds },
        },
        select: {
            id: true,
            circleId: true,
            uploadedByUserId: true,
            draftPostId: true,
            discussionThreadId: true,
            seededSourceNodeId: true,
            name: true,
            mimeType: true,
            extractionStatus: true,
            contentDigest: true,
            originType: true,
            originRef: true,
            externalAppId: true,
            roomKey: true,
            lifecycleStatus: true,
            evidencePrivacyClass: true,
            visibilityScope: true,
            submittedByPubkey: true,
            expiresAt: true,
            provenance: true,
            chunks: { select: { id: true } },
        },
    });
}

function emptySelection(
    input: { circleId: number; subjectType: NeutralEvaluationSubjectType; subjectId: string },
    reason: 'source_not_found' | 'empty_source',
): NeutralEvaluationSelection {
    return {
        status: 'no_source',
        blockReason: reason,
        circleId: input.circleId,
        subjectType: input.subjectType,
        subjectId: String(input.subjectId),
        authorUserId: null,
        evidenceRefs: [],
        providerSources: [],
        sourceDigest: digestJson([]),
        requiresPrivatePlaintext: false,
        subjectSnapshot: {
            subjectType: input.subjectType,
            subjectId: String(input.subjectId),
        },
    };
}

function sourceMaterialSnapshot(material: any): Record<string, unknown> {
    return {
        sourceMaterialId: Number(material.id),
        originType: String(material.originType || ''),
        lifecycleStatus: String(material.lifecycleStatus || ''),
        evidencePrivacyClass: String(material.evidencePrivacyClass || ''),
        visibilityScope: String(material.visibilityScope || ''),
        contentDigest: String(material.contentDigest || ''),
    };
}

function sha256Hex(input: string): string {
    return crypto.createHash('sha256').update(input).digest('hex');
}

function digestJson(value: unknown): string {
    return sha256Hex(JSON.stringify(value));
}

function truncateText(value: string, maxChars: number): string {
    return value.trim().slice(0, maxChars);
}

function serializeDate(value: unknown): string | null {
    if (value instanceof Date) return value.toISOString();
    if (typeof value === 'string' && value.trim()) return value;
    return null;
}
