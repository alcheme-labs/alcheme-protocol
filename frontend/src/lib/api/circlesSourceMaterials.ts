import { authenticatedApiFetch } from '@/lib/api/fetch';
import { resolveNodeRoute } from '@/lib/api/nodeRouting';
import type { CircleGovernanceRequest } from './governance';

export interface SourceMaterialRecord {
    id: number;
    circleId: number;
    draftPostId: number | null;
    discussionThreadId: string | null;
    seededSourceNodeId: number | null;
    name: string;
    mimeType: string | null;
    status: 'extracting' | 'ai_readable' | string;
    contentDigest: string;
    summaryText?: string | null;
    originType?: string | null;
    originRef?: string | null;
    canonicalUrl?: string | null;
    externalAuthorLabel?: string | null;
    sourcePublishedAt?: string | null;
    capturedAt?: string | null;
    sourceVersion?: number | null;
    previousVersionId?: number | null;
    versionDiff?: {
        previousVersion: number;
        previousContentDigest: string;
        addedChunks: number;
        removedChunks: number;
        unchangedChunks: number;
    } | null;
    externalAppId?: string | null;
    roomKey?: string | null;
    lifecycleStatus?: string | null;
    evidencePrivacyClass?: string | null;
    visibilityScope?: string | null;
    submittedByPubkey?: string | null;
    provenance?: Record<string, unknown> | null;
    licenseFacts?: SourceMaterialLicenseInput | null;
    licenseFactsDigest?: string | null;
    licenseAuthorizedByPubkey?: string | null;
    licenseAuthorizedAt?: string | null;
    storageObjectId?: string | null;
    storageReceiptDigest?: string | null;
    chunkCount: number;
}

export interface SourceMaterialLicenseInput {
    basis: 'self_authored_safe_default' | 'external_license';
    rightsHolder: string;
    licenseRef?: string | null;
    licenseVersion?: string | null;
    publicDisplayAuthorized: boolean;
    commercialUseAuthorized?: boolean;
    nftUseAuthorized?: boolean;
}

export async function fetchSourceMaterials(
    circleId: number,
    input?: { draftPostId?: number | null; includeGovernedReviewQueue?: boolean },
): Promise<SourceMaterialRecord[]> {
    const route = await resolveNodeRoute('source_materials');
    const query = new URLSearchParams();
    if (input?.draftPostId && input.draftPostId > 0) {
        query.set('draftPostId', String(input.draftPostId));
    }
    if (input?.includeGovernedReviewQueue) {
        query.set('reviewQueue', 'governed_accept');
    }

    const response = await authenticatedApiFetch(
        `${route.urlBase}/api/v1/circles/${circleId}/source-materials${query.size > 0 ? `?${query.toString()}` : ''}`,
        {
            method: 'GET',
            cache: 'no-store',
        },
    );

    if (response.status === 404 || response.status === 409) {
        return [];
    }

    if (!response.ok) {
        const body = await response.text();
        throw new Error(`fetch source materials failed: ${response.status} ${body}`);
    }

    const payload = await response.json().catch(() => null);
    return Array.isArray(payload?.materials) ? payload.materials as SourceMaterialRecord[] : [];
}

export type SourceMaterialLifecycleNextStatus =
    | 'accepted_to_plaza'
    | 'rejected'
    | 'redacted'
    | 'revoked';

export type SourceMaterialLifecycleResult =
    | {
        status: 'updated';
        circleId: number;
        material: SourceMaterialRecord;
        systemNoticeEnvelopeId: string | null;
    }
    | {
        status: 'requires_governance';
        actionType: string;
        request: CircleGovernanceRequest;
    };

export async function updateSourceMaterialLifecycle(input: {
    circleId: number;
    sourceMaterialId: number;
    nextStatus: SourceMaterialLifecycleNextStatus;
    reason?: string | null;
    governanceRequestId?: string | null;
    reviewDecisionDigest?: string | null;
}): Promise<SourceMaterialLifecycleResult> {
    const route = await resolveNodeRoute('source_materials');
    const circleId = input.circleId;
    const sourceMaterialId = input.sourceMaterialId;
    const response = await authenticatedApiFetch(`${route.urlBase}/api/v1/circles/${circleId}/source-materials/${sourceMaterialId}/lifecycle`, {
        method: 'POST',
        headers: {
            'Content-Type': 'application/json',
        },
        body: JSON.stringify({
            nextStatus: input.nextStatus,
            reason: input.reason ?? null,
            governanceRequestId: input.governanceRequestId ?? null,
            reviewDecisionDigest: input.reviewDecisionDigest ?? null,
        }),
    });

    const payload = await response.json().catch(() => null);
    if (response.status === 202) {
        return {
            status: 'requires_governance',
            actionType: String(payload?.actionType || 'source_material.accept'),
            request: payload?.request as CircleGovernanceRequest,
        };
    }
    if (response.ok) {
        return {
            status: 'updated',
            circleId: Number(payload?.circleId || circleId),
            material: payload?.material as SourceMaterialRecord,
            systemNoticeEnvelopeId: payload?.systemNoticeEnvelopeId ?? null,
        };
    }

    throw new Error(`update source material lifecycle failed: ${response.status} ${JSON.stringify(payload)}`);
}

export async function uploadSourceMaterial(
    circleId: number,
    input: {
        draftPostId?: number | null;
        discussionThreadId?: string | null;
        seededSourceNodeId?: number | null;
        name: string;
        mimeType?: string | null;
        content: string;
        license: SourceMaterialLicenseInput;
    },
): Promise<SourceMaterialRecord> {
    const route = await resolveNodeRoute('source_materials');
    const response = await authenticatedApiFetch(`${route.urlBase}/api/v1/circles/${circleId}/source-materials`, {
        method: 'POST',
        headers: {
            'Content-Type': 'application/json',
        },
        body: JSON.stringify({
            draftPostId: input.draftPostId ?? null,
            discussionThreadId: input.discussionThreadId ?? null,
            seededSourceNodeId: input.seededSourceNodeId ?? null,
            name: input.name,
            mimeType: input.mimeType ?? null,
            content: input.content,
            license: input.license,
        }),
    });

    if (!response.ok) {
        const body = await response.text();
        throw new Error(`upload source material failed: ${response.status} ${body}`);
    }

    const payload = await response.json().catch(() => null);
    return payload?.material as SourceMaterialRecord;
}

export async function fetchSourceMaterialContent(
    circleId: number,
    sourceMaterialId: number,
): Promise<{ content: string; contentType: string | null }> {
    const route = await resolveNodeRoute('source_materials');
    const response = await authenticatedApiFetch(
        `${route.urlBase}/api/v1/circles/${circleId}/source-materials/${sourceMaterialId}/content`,
        {
            method: 'GET',
            cache: 'no-store',
        },
    );
    if (!response.ok) {
        const body = await response.text();
        throw new Error(`fetch source material content failed: ${response.status} ${body}`);
    }
    return {
        content: await response.text(),
        contentType: response.headers.get('content-type'),
    };
}

export async function captureExternalUrlSourceMaterial(
    circleId: number,
    input: {
        draftPostId: number;
        name: string;
        canonicalUrl: string;
        externalAuthorLabel: string;
        publishedAt: string;
        content: string;
        recaptureOfSourceMaterialId?: number | null;
        license: SourceMaterialLicenseInput;
    },
): Promise<SourceMaterialRecord> {
    const route = await resolveNodeRoute('source_materials');
    const response = await authenticatedApiFetch(`${route.urlBase}/api/v1/circles/${circleId}/source-materials`, {
        method: 'POST',
        headers: {
            'Content-Type': 'application/json',
        },
        body: JSON.stringify({
            draftPostId: input.draftPostId,
            name: input.name,
            mimeType: 'text/plain',
            content: input.content,
            externalUrlCapture: true,
            canonicalUrl: input.canonicalUrl,
            externalAuthorLabel: input.externalAuthorLabel,
            publishedAt: input.publishedAt,
            recaptureOfSourceMaterialId: input.recaptureOfSourceMaterialId ?? null,
            license: input.license,
        }),
    });

    if (!response.ok) {
        const body = await response.text();
        throw new Error(`capture external URL source material failed: ${response.status} ${body}`);
    }

    const payload = await response.json().catch(() => null);
    return payload?.material as SourceMaterialRecord;
}
