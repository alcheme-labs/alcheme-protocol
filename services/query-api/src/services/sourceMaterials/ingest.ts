import type { PrismaClient } from '@prisma/client';
import { isIP } from 'node:net';

import { buildPrivateTextLocator, storePrivateText } from '../privateContentBridge';
import {
    normalizeSourceMaterialUpload,
    sha256Hex,
    type SourceMaterialUploadInput,
} from './uploadBridge';
import {
    normalizeSourceMaterialLifecycleStatus,
    normalizeSourceMaterialOriginType,
    normalizeSourceMaterialPrivacyClass,
    normalizeSourceMaterialVisibilityScope,
    resolveDefaultLifecycleStatusForOrigin,
    type SourceMaterialLifecycleStatus,
    type SourceMaterialOriginType,
    type SourceMaterialPrivacyClass,
    type SourceMaterialVisibilityScope,
} from './lifecycle';
import {
    buildSourceMaterialLicenseFacts,
    type SourceMaterialLicenseFacts,
} from '../knowledgePublicationLicense';

export interface SourceMaterialIngestChunk {
    chunkIndex: number;
    locatorType: 'chunk';
    locatorRef: string;
    text: string;
    textDigest: string;
}

export interface SourceMaterialIngestPlan {
    extractedText: string;
    material: {
        name: string;
        mimeType: string | null;
        byteSize: number;
        extractionStatus: 'ready';
        contentDigest: string;
    };
    chunks: SourceMaterialIngestChunk[];
}

export interface SourceMaterialPlaintextCustody {
    publicNodePersistence: 'digest_locator_and_provenance_metadata';
    privatePlaintextStorage: 'trusted_private_store';
    groundingReadPath: 'authorized_private_fetch_bridge';
}

export type SourceMaterialActor =
    | { kind: 'alcheme_user'; uploadedByUserId: number; walletPubkey?: string | null }
    | { kind: 'external_app_server'; externalAppId: string; submittedByPubkey?: string | null; claimDigest: string }
    | { kind: 'provider_webhook'; provider: 'livekit'; externalAppId?: string | null; webhookEventId: string };

export interface SourceMaterialExternalUrlCaptureInput {
    canonicalUrl: string;
    externalAuthorLabel: string;
    publishedAt: string | Date;
}

export interface NormalizedSourceMaterialExternalUrlCapture {
    canonicalUrl: string;
    externalAuthorLabel: string;
    sourcePublishedAt: Date;
    capturedAt: Date;
    sourceVersion: 1;
}

export const SOURCE_MATERIAL_PLAINTEXT_CUSTODY: SourceMaterialPlaintextCustody = {
    publicNodePersistence: 'digest_locator_and_provenance_metadata',
    privatePlaintextStorage: 'trusted_private_store',
    groundingReadPath: 'authorized_private_fetch_bridge',
};

function splitIntoGroundingChunks(content: string): string[] {
    return String(content || '')
        .split(/\n\s*\n/g)
        .map((chunk) => chunk.trim())
        .filter(Boolean);
}

export function buildSourceMaterialIngestPlan(input: SourceMaterialUploadInput): SourceMaterialIngestPlan {
    const normalized = normalizeSourceMaterialUpload(input);
    const extractedText = normalized.content;
    const chunks = splitIntoGroundingChunks(extractedText).map((text, index) => ({
        chunkIndex: index,
        locatorType: 'chunk' as const,
        locatorRef: `chunk:${index + 1}`,
        text,
        textDigest: sha256Hex(text),
    }));

    return {
        extractedText,
        material: {
            name: normalized.name,
            mimeType: normalized.mimeType,
            byteSize: normalized.byteSize,
            extractionStatus: 'ready',
            contentDigest: sha256Hex(extractedText),
        },
        chunks,
    };
}

export function normalizeSourceMaterialExternalUrlCapture(
    input: SourceMaterialExternalUrlCaptureInput,
    capturedAt = new Date(),
): NormalizedSourceMaterialExternalUrlCapture {
    const canonicalUrl = normalizeExternalCaptureUrl(input.canonicalUrl);
    const externalAuthorLabel = normalizeRequiredString(
        input.externalAuthorLabel,
        160,
        'source_material_external_author_required',
    );
    const sourcePublishedAt = input.publishedAt instanceof Date
        ? new Date(input.publishedAt.getTime())
        : new Date(String(input.publishedAt || ''));
    if (Number.isNaN(sourcePublishedAt.getTime())) {
        throw new Error('source_material_published_at_invalid');
    }
    if (Number.isNaN(capturedAt.getTime())) {
        throw new Error('source_material_captured_at_invalid');
    }
    if (sourcePublishedAt.getTime() > capturedAt.getTime()) {
        throw new Error('source_material_published_at_after_capture');
    }
    return {
        canonicalUrl,
        externalAuthorLabel,
        sourcePublishedAt,
        capturedAt: new Date(capturedAt.getTime()),
        sourceVersion: 1,
    };
}

export async function createSourceMaterial(
    prisma: PrismaClient,
    input: {
        circleId: number;
        uploadedByUserId?: number | null;
        draftPostId?: number | null;
        discussionThreadId?: string | null;
        seededSourceNodeId?: number | null;
        name: string;
        mimeType?: string | null;
        content: string;
        originType?: SourceMaterialOriginType;
        originRef?: string | null;
        externalAppId?: string | null;
        roomKey?: string | null;
        lifecycleStatus?: SourceMaterialLifecycleStatus;
        summaryText?: string | null;
        evidencePrivacyClass?: SourceMaterialPrivacyClass;
        visibilityScope?: SourceMaterialVisibilityScope;
        submittedByPubkey?: string | null;
        reviewRequestId?: string | null;
        reviewDecisionDigest?: string | null;
        expiresAt?: Date | null;
        externalUrlCapture?: SourceMaterialExternalUrlCaptureInput | null;
        recaptureOfSourceMaterialId?: number | null;
        capturedAt?: Date;
        actor?: SourceMaterialActor;
        provenance?: Record<string, unknown> | null;
        licenseFacts?: SourceMaterialLicenseFacts | null;
        licenseFactsDigest?: string | null;
        licenseAuthorizedByPubkey?: string | null;
        licenseAuthorizedAt?: Date;
        storageObject?: {
            objectId: string;
            receiptId: string;
            receiptDigest: string;
            scopeRef: string;
            tenantId: string;
            contentDigest: string;
        } | null;
    },
): Promise<{
    id: number;
    circleId: number;
    uploadedByUserId: number | null;
    draftPostId: number | null;
    discussionThreadId: string | null;
    seededSourceNodeId: number | null;
    name: string;
    mimeType: string | null;
    status: 'ai_readable';
    contentDigest: string;
    originType: SourceMaterialOriginType;
    originRef: string | null;
    canonicalUrl: string | null;
    externalAuthorLabel: string | null;
    sourcePublishedAt: Date | null;
    capturedAt: Date | null;
    sourceVersion: number | null;
    previousVersionId: number | null;
    externalAppId: string | null;
    roomKey: string | null;
    lifecycleStatus: SourceMaterialLifecycleStatus;
    evidencePrivacyClass: SourceMaterialPrivacyClass;
    visibilityScope: SourceMaterialVisibilityScope;
    licenseFacts: SourceMaterialLicenseFacts | null;
    licenseFactsDigest: string | null;
    licenseAuthorizedByPubkey: string | null;
    licenseAuthorizedAt: Date | null;
    storageObjectId: string | null;
    storageReceiptId: string | null;
    storageReceiptDigest: string | null;
    storageScopeRef: string | null;
    storageTenantId: string | null;
    chunkCount: number;
}> {
    const originType = normalizeSourceMaterialOriginType(input.originType ?? 'manual_upload');
    const lifecycleStatus = normalizeSourceMaterialLifecycleStatus(
        input.lifecycleStatus ?? resolveDefaultLifecycleStatusForOrigin(originType),
    );
    const evidencePrivacyClass = normalizeSourceMaterialPrivacyClass(
        input.evidencePrivacyClass ?? 'public',
    );
    const visibilityScope = normalizeSourceMaterialVisibilityScope(
        input.visibilityScope ??
        (evidencePrivacyClass === 'reviewer_only' ? 'reviewers' : evidencePrivacyClass === 'sealed' ? 'sealed' : 'circle'),
    );
    const uploadedByUserId = normalizeOptionalPositiveInt(input.uploadedByUserId);
    if ((originType === 'manual_upload' || originType === 'external_url_capture') && !uploadedByUserId) {
        throw new Error('source_material_manual_upload_user_required');
    }
    if (
        originType !== 'manual_upload'
        && originType !== 'external_url_capture'
        && !input.actor
        && !input.provenance
    ) {
        throw new Error('source_material_runtime_provenance_required');
    }
    const normalizedLicense = input.licenseFacts
        ? buildSourceMaterialLicenseFacts(input.licenseFacts)
        : null;
    if (normalizedLicense && normalizedLicense.digest !== String(input.licenseFactsDigest || '').trim().toLowerCase()) {
        throw new Error('source_material_license_facts_digest_mismatch');
    }
    const licenseAuthorizedByPubkey = normalizeOptionalString(input.licenseAuthorizedByPubkey, 44);
    if (normalizedLicense && !licenseAuthorizedByPubkey) {
        throw new Error('source_material_license_authority_required');
    }
    const licenseAuthorizedAt = normalizedLicense ? input.licenseAuthorizedAt ?? new Date() : null;
    const plan = buildSourceMaterialIngestPlan({
        name: input.name,
        mimeType: input.mimeType,
        content: input.content,
    });
    const externalUrlCapture = originType === 'external_url_capture'
        ? normalizeSourceMaterialExternalUrlCapture(
            input.externalUrlCapture ?? {
                canonicalUrl: '',
                externalAuthorLabel: '',
                publishedAt: '',
            },
            input.capturedAt ?? new Date(),
        )
        : null;
    if (originType !== 'external_url_capture' && input.externalUrlCapture) {
        throw new Error('source_material_external_url_capture_origin_mismatch');
    }
    const recaptureOfSourceMaterialId = normalizeOptionalPositiveInt(input.recaptureOfSourceMaterialId);
    if (originType !== 'external_url_capture' && recaptureOfSourceMaterialId) {
        throw new Error('source_material_recapture_origin_mismatch');
    }
    const storageObject = normalizeStorageObject(input.storageObject, plan.material.contentDigest);
    const rawTextLocator = storageObject
        ? null
        : buildPrivateTextLocator(
            'source-material',
            'raw',
            plan.material.contentDigest,
        );
    if (rawTextLocator) {
        await storePrivateText({
            locator: rawTextLocator,
            content: plan.extractedText,
        });
    }
    const chunkStorage = await Promise.all(plan.chunks.map(async (chunk) => {
        const textLocator = buildPrivateTextLocator(
            'source-material',
            'chunk',
            chunk.textDigest,
        );
        await storePrivateText({
            locator: textLocator,
            content: chunk.text,
        });
        return {
            ...chunk,
            textLocator,
        };
    }));

    return prisma.$transaction(async (tx) => {
        let sourceVersion = externalUrlCapture?.sourceVersion ?? null;
        let previousVersionId: number | null = null;
        if (externalUrlCapture && recaptureOfSourceMaterialId) {
            const previous = await (tx as any).sourceMaterial.findUnique({
                where: { id: recaptureOfSourceMaterialId },
                select: {
                    id: true,
                    circleId: true,
                    draftPostId: true,
                    originType: true,
                    canonicalUrl: true,
                    capturedAt: true,
                    sourceVersion: true,
                    contentDigest: true,
                },
            });
            if (!previous || previous.originType !== 'external_url_capture') {
                throw new Error('source_material_recapture_source_not_found');
            }
            if (previous.circleId !== input.circleId || previous.draftPostId !== (input.draftPostId ?? null)) {
                throw new Error('source_material_recapture_scope_mismatch');
            }
            if (previous.canonicalUrl !== externalUrlCapture.canonicalUrl) {
                throw new Error('source_material_recapture_canonical_url_mismatch');
            }
            if (!Number.isSafeInteger(previous.sourceVersion) || previous.sourceVersion < 1) {
                throw new Error('source_material_recapture_version_invalid');
            }
            if (!(previous.capturedAt instanceof Date)
                || externalUrlCapture.capturedAt.getTime() <= previous.capturedAt.getTime()) {
                throw new Error('source_material_recapture_time_not_after_previous');
            }
            if (previous.contentDigest === plan.material.contentDigest) {
                throw new Error('source_material_recapture_unchanged');
            }
            const existingNext = await (tx as any).sourceMaterial.findFirst({
                where: { previousVersionId: previous.id },
                select: { id: true },
            });
            if (existingNext) {
                throw new Error('source_material_recapture_stale_version');
            }
            sourceVersion = previous.sourceVersion + 1;
            previousVersionId = previous.id;
        }
        const created = await (tx as any).sourceMaterial.create({
            data: {
                circleId: input.circleId,
                uploadedByUserId,
                draftPostId: input.draftPostId ?? null,
                discussionThreadId: input.discussionThreadId ?? null,
                seededSourceNodeId: input.seededSourceNodeId ?? null,
                name: plan.material.name,
                mimeType: plan.material.mimeType,
                byteSize: plan.material.byteSize,
                extractionStatus: plan.material.extractionStatus,
                rawText: null,
                rawTextLocator,
                contentDigest: plan.material.contentDigest,
                originType,
                originRef: externalUrlCapture
                    ? `url:${sha256Hex(externalUrlCapture.canonicalUrl)}`
                    : normalizeOptionalString(input.originRef, 128),
                canonicalUrl: externalUrlCapture?.canonicalUrl ?? null,
                externalAuthorLabel: externalUrlCapture?.externalAuthorLabel ?? null,
                sourcePublishedAt: externalUrlCapture?.sourcePublishedAt ?? null,
                capturedAt: externalUrlCapture?.capturedAt ?? null,
                sourceVersion,
                previousVersionId,
                externalAppId: normalizeOptionalString(input.externalAppId, 64),
                roomKey: normalizeOptionalString(input.roomKey, 96),
                lifecycleStatus,
                summaryText: normalizeOptionalString(input.summaryText, 10_000),
                evidencePrivacyClass,
                visibilityScope,
                submittedByPubkey: normalizeOptionalString(input.submittedByPubkey, 44),
                reviewRequestId: normalizeOptionalString(input.reviewRequestId, 96),
                reviewDecisionDigest: normalizeOptionalString(input.reviewDecisionDigest, 64),
                expiresAt: input.expiresAt ?? null,
                provenance: buildSourceMaterialProvenance(input),
                licenseFacts: normalizedLicense?.facts,
                licenseFactsDigest: normalizedLicense?.digest,
                licenseAuthorizedByPubkey,
                licenseAuthorizedAt,
                storageObjectId: storageObject?.objectId ?? null,
                storageReceiptId: storageObject?.receiptId ?? null,
                storageReceiptDigest: storageObject?.receiptDigest ?? null,
                storageScopeRef: storageObject?.scopeRef ?? null,
                storageTenantId: storageObject?.tenantId ?? null,
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
                contentDigest: true,
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
                licenseFacts: true,
                licenseFactsDigest: true,
                licenseAuthorizedByPubkey: true,
                licenseAuthorizedAt: true,
                storageObjectId: true,
                storageReceiptId: true,
                storageReceiptDigest: true,
                storageScopeRef: true,
                storageTenantId: true,
            },
        });

        for (const chunk of chunkStorage) {
            await (tx as any).sourceMaterialChunk.create({
                data: {
                    sourceMaterialId: created.id,
                    chunkIndex: chunk.chunkIndex,
                    locatorType: chunk.locatorType,
                    locatorRef: chunk.locatorRef,
                    text: '',
                    textLocator: chunk.textLocator,
                    textDigest: chunk.textDigest,
                },
            });
        }

        return {
            id: created.id,
            circleId: created.circleId,
            uploadedByUserId: created.uploadedByUserId ?? null,
            draftPostId: created.draftPostId,
            discussionThreadId: created.discussionThreadId,
            seededSourceNodeId: created.seededSourceNodeId,
            name: created.name,
            mimeType: created.mimeType,
            status: 'ai_readable' as const,
            contentDigest: created.contentDigest,
            originType: created.originType ?? originType,
            originRef: created.originRef ?? null,
            canonicalUrl: created.canonicalUrl ?? null,
            externalAuthorLabel: created.externalAuthorLabel ?? null,
            sourcePublishedAt: created.sourcePublishedAt ?? null,
            capturedAt: created.capturedAt ?? null,
            sourceVersion: created.sourceVersion ?? null,
            previousVersionId: created.previousVersionId ?? null,
            externalAppId: created.externalAppId ?? null,
            roomKey: created.roomKey ?? null,
            lifecycleStatus: created.lifecycleStatus ?? lifecycleStatus,
            evidencePrivacyClass: created.evidencePrivacyClass ?? evidencePrivacyClass,
            visibilityScope: created.visibilityScope ?? visibilityScope,
            licenseFacts: created.licenseFacts as unknown as SourceMaterialLicenseFacts | null,
            licenseFactsDigest: created.licenseFactsDigest ?? null,
            licenseAuthorizedByPubkey: created.licenseAuthorizedByPubkey ?? null,
            licenseAuthorizedAt: created.licenseAuthorizedAt ?? null,
            storageObjectId: created.storageObjectId ?? null,
            storageReceiptId: created.storageReceiptId ?? null,
            storageReceiptDigest: created.storageReceiptDigest ?? null,
            storageScopeRef: created.storageScopeRef ?? null,
            storageTenantId: created.storageTenantId ?? null,
            chunkCount: plan.chunks.length,
        };
    });
}

function buildSourceMaterialProvenance(input: {
    actor?: SourceMaterialActor;
    provenance?: Record<string, unknown> | null;
}): Record<string, unknown> | undefined {
    if (input.actor) {
        return {
            ...(input.provenance ?? {}),
            actor: input.actor,
        };
    }
    return input.provenance ?? undefined;
}

function normalizeStorageObject(
    value: {
        objectId: string;
        receiptId: string;
        receiptDigest: string;
        scopeRef: string;
        tenantId: string;
        contentDigest: string;
    } | null | undefined,
    contentDigest: string,
): {
    objectId: string;
    receiptId: string;
    receiptDigest: string;
    scopeRef: string;
    tenantId: string;
} | null {
    if (!value) return null;
    const objectId = normalizeRequiredString(value.objectId, 128, 'source_material_storage_object_id_required');
    const receiptId = normalizeRequiredString(value.receiptId, 128, 'source_material_storage_receipt_id_required');
    const receiptDigest = normalizeRequiredString(
        value.receiptDigest,
        80,
        'source_material_storage_receipt_digest_required',
    );
    const scopeRef = normalizeRequiredString(value.scopeRef, 128, 'source_material_storage_scope_ref_required');
    const tenantId = normalizeRequiredString(value.tenantId, 128, 'source_material_storage_tenant_id_required');
    const objectDigest = String(value.contentDigest || '').trim().toLowerCase().replace(/^sha256:/, '');
    if (objectDigest !== contentDigest) {
        throw new Error('source_material_storage_digest_mismatch');
    }
    return { objectId, receiptId, receiptDigest, scopeRef, tenantId };
}

function normalizeOptionalPositiveInt(value: unknown): number | null {
    if (value === null || value === undefined) return null;
    const numeric = Number(value);
    return Number.isSafeInteger(numeric) && numeric > 0 ? numeric : null;
}

function normalizeOptionalString(value: unknown, maxLength: number): string | null {
    if (typeof value !== 'string') return null;
    const normalized = value.trim();
    if (!normalized) return null;
    return normalized.slice(0, maxLength);
}

function normalizeRequiredString(value: unknown, maxLength: number, errorCode: string): string {
    const normalized = normalizeOptionalString(value, maxLength);
    if (!normalized) throw new Error(errorCode);
    return normalized;
}

function normalizeExternalCaptureUrl(value: unknown): string {
    const raw = typeof value === 'string' ? value.trim() : '';
    let parsed: URL;
    try {
        parsed = new URL(raw);
    } catch {
        throw new Error('source_material_canonical_url_invalid');
    }
    if (parsed.protocol !== 'https:' || parsed.username || parsed.password) {
        throw new Error('source_material_canonical_url_invalid');
    }
    const hostname = parsed.hostname.toLowerCase().replace(/^\[|\]$/g, '');
    if (!hostname || isNonPublicHostname(hostname)) {
        throw new Error('source_material_canonical_url_not_public');
    }
    parsed.hash = '';
    const normalized = parsed.toString();
    if (normalized.length > 2048) {
        throw new Error('source_material_canonical_url_invalid');
    }
    return normalized;
}

function isNonPublicHostname(hostname: string): boolean {
    if (
        hostname === 'localhost'
        || hostname.endsWith('.localhost')
        || hostname.endsWith('.local')
        || hostname.endsWith('.internal')
    ) {
        return true;
    }
    const ipVersion = isIP(hostname);
    if (ipVersion === 4) {
        const octets = hostname.split('.').map(Number);
        return octets[0] === 0
            || octets[0] === 10
            || octets[0] === 127
            || (octets[0] === 100 && octets[1] >= 64 && octets[1] <= 127)
            || (octets[0] === 169 && octets[1] === 254)
            || (octets[0] === 172 && octets[1] >= 16 && octets[1] <= 31)
            || (octets[0] === 192 && octets[1] === 168)
            || octets[0] >= 224;
    }
    if (ipVersion === 6) {
        return hostname === '::'
            || hostname === '::1'
            || /^f[cd]/.test(hostname)
            || /^fe[89ab]/.test(hostname);
    }
    return false;
}
