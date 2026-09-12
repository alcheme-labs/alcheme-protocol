import crypto from 'crypto';

import {
    SOURCE_MATERIAL_GROUNDING_STATUSES,
    SOURCE_MATERIAL_REVIEW_QUEUE_STATUSES,
    normalizeSourceMaterialLifecycleStatus,
    normalizeSourceMaterialPrivacyClass,
    normalizeSourceMaterialVisibilityScope,
    type SourceMaterialLifecycleStatus,
    type SourceMaterialPrivacyClass,
    type SourceMaterialVisibilityScope,
} from '../sourceMaterials/lifecycle';
import type { EvidenceRef, EvidenceVisibility } from './types';

interface SourceMaterialEvidenceInput {
    id: number | string;
    contentDigest: string;
    name?: string | null;
    text?: string | null;
    lifecycleStatus?: SourceMaterialLifecycleStatus | string | null;
    evidencePrivacyClass?: SourceMaterialPrivacyClass | string | null;
    visibilityScope?: SourceMaterialVisibilityScope | string | null;
    originType?: string | null;
    originRef?: string | null;
    expiresAt?: Date | string | null;
}

interface TrendReceiptEvidenceInput {
    id: number | string;
    digest: string;
    sourceKey?: string | null;
    licenseNote?: string | null;
    query?: string | null;
    cacheKey?: string | null;
    fetchedAt?: Date | string | null;
    expiresAt?: Date | string | null;
}

interface FormalReferenceEvidenceInput {
    knowledgeId: string;
    digest: string;
    circleId: number;
    title?: string | null;
    onChainAddress?: string | null;
    version?: number | string | null;
    createdAt?: Date | string | null;
    draftPostId?: number | null;
    sourceBlockId?: string | null;
}

export function buildEvidenceRefFromSourceMaterial(input: SourceMaterialEvidenceInput): EvidenceRef {
    const lifecycleStatus = normalizeSourceMaterialLifecycleStatus(
        input.lifecycleStatus ?? 'accepted_to_plaza',
    );
    const evidencePrivacyClass = normalizeSourceMaterialPrivacyClass(
        input.evidencePrivacyClass ?? 'public',
    );
    const visibilityScope = normalizeSourceMaterialVisibilityScope(
        input.visibilityScope ?? 'circle',
    );

    return {
        sourceType: 'source_material',
        sourceId: String(input.id),
        digest: String(input.contentDigest || ''),
        visibility: mapSourceMaterialVisibility(
            lifecycleStatus,
            evidencePrivacyClass,
            visibilityScope,
        ),
        locator: {
            type: String(input.originType || 'source_material'),
            ref: String(input.originRef || input.id),
        },
        permissionSnapshot: {
            lifecycleStatus,
            evidencePrivacyClass,
            visibilityScope,
        },
        capturedAt: new Date().toISOString(),
        expiresAt: serializeDate(input.expiresAt),
    };
}

export function buildEvidenceRefFromTrendReceipt(input: TrendReceiptEvidenceInput): EvidenceRef {
    const capturedAt = serializeDate(input.fetchedAt) ?? new Date().toISOString();
    return {
        sourceType: 'trend_receipt',
        sourceId: String(input.id),
        digest: String(input.digest || ''),
        visibility: 'public',
        locator: {
            type: 'trend_receipt',
            ref: String(input.id),
        },
        permissionSnapshot: {
            sourceKey: String(input.sourceKey || ''),
            licenseNote: String(input.licenseNote || ''),
            queryDigest: digest(String(input.query || '')),
            cacheKey: String(input.cacheKey || ''),
            visibility: 'public',
        },
        capturedAt,
        expiresAt: serializeDate(input.expiresAt),
    };
}

export function buildEvidenceRefFromFormalReference(input: FormalReferenceEvidenceInput): EvidenceRef {
    return {
        sourceType: 'formal_reference',
        sourceId: String(input.knowledgeId || ''),
        digest: String(input.digest || ''),
        visibility: 'member_visible',
        locator: {
            type: 'knowledge',
            ref: String(input.knowledgeId || input.onChainAddress || ''),
        },
        permissionSnapshot: {
            circleId: input.circleId,
            title: String(input.title || ''),
            onChainAddress: String(input.onChainAddress || ''),
            version: String(input.version ?? ''),
            draftPostId: input.draftPostId ?? null,
            sourceBlockId: input.sourceBlockId ?? null,
        },
        capturedAt: serializeDate(input.createdAt) ?? new Date().toISOString(),
        expiresAt: null,
    };
}

export function validateEvidenceRefs(refs: Array<Partial<EvidenceRef>>): {
    ok: true;
} | {
    ok: false;
    reasonCode: 'invalid_source_ref' | 'digest_mismatch';
} {
    for (const ref of refs) {
        if (
            !ref.sourceType ||
            !ref.sourceId ||
            ref.sourceId === 'missing' ||
            !ref.digest ||
            !/^[a-f0-9]{64}$/i.test(String(ref.digest))
        ) {
            return {
                ok: false,
                reasonCode: 'invalid_source_ref',
            };
        }
    }
    return { ok: true };
}

function mapSourceMaterialVisibility(
    lifecycleStatus: SourceMaterialLifecycleStatus,
    privacyClass: SourceMaterialPrivacyClass,
    visibilityScope: SourceMaterialVisibilityScope,
): EvidenceVisibility {
    if (privacyClass === 'sealed' || visibilityScope === 'sealed') return 'sealed';
    if (privacyClass === 'redacted') return 'redacted';
    if (!SOURCE_MATERIAL_GROUNDING_STATUSES.includes(lifecycleStatus)) {
        if (SOURCE_MATERIAL_REVIEW_QUEUE_STATUSES.includes(lifecycleStatus)) return 'reviewer_only';
        return 'redacted';
    }
    if (visibilityScope === 'reviewers') return 'reviewer_only';
    if (privacyClass === 'public') return 'public';
    if (privacyClass === 'circle_only') return 'member_visible';
    if (privacyClass === 'reviewer_only') return 'reviewer_only';
    return 'redacted';
}

function serializeDate(value: Date | string | null | undefined): string | null {
    if (value instanceof Date) return value.toISOString();
    if (typeof value === 'string' && value.trim()) {
        const date = new Date(value);
        return Number.isNaN(date.getTime()) ? value : date.toISOString();
    }
    return null;
}

function digest(value: string): string {
    return crypto.createHash('sha256').update(value).digest('hex');
}
