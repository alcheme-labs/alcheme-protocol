import crypto from 'crypto';

import {
    buildEvidenceRefFromFormalReference,
    buildEvidenceRefFromSourceMaterial,
    buildEvidenceRefFromTrendReceipt,
} from '../evidenceLedger';
import type { EvidenceRef } from '../types';
import {
    buildSourceMaterialGroundingContext,
    listSourceMaterials,
} from '../../sourceMaterials/readModel';
import { loadDraftReferenceLinks } from '../../draftReferences/readModel';
import type {
    SourceGroundedAskScope,
    SourceGroundedAskSelection,
    SourceGroundedAskSelectionInput,
    SourceGroundedCitation,
    SourceGroundedProviderSource,
} from './types';

const DEFAULT_MAX_SOURCES = 8;
const MAX_EXCERPT_CHARS = 900;
const VALID_SCOPES: SourceGroundedAskScope[] = [
    'current_circle',
    'current_draft',
    'source_materials',
    'formal_references',
    'trend_receipts',
];

export class SourceGroundedAskError extends Error {
    code: string;
    statusCode: number;
    details: Record<string, unknown>;

    constructor(code: string, input: {
        statusCode?: number;
        details?: Record<string, unknown>;
    } = {}) {
        super(code);
        this.name = 'SourceGroundedAskError';
        this.code = code;
        this.statusCode = input.statusCode ?? 400;
        this.details = input.details ?? {};
    }
}

export async function selectSourceGroundedAskEvidence(
    prisma: any,
    input: SourceGroundedAskSelectionInput,
): Promise<SourceGroundedAskSelection> {
    const now = input.now ?? new Date();
    const scopes = normalizeScopes(input.scopes, input.draftPostId);
    const maxSources = Math.max(1, Math.min(20, Math.trunc(input.maxSources ?? DEFAULT_MAX_SOURCES)));
    const evidenceRefs: EvidenceRef[] = [];
    const citations: SourceGroundedCitation[] = [];
    const providerSources: SourceGroundedProviderSource[] = [];
    const seen = new Set<string>();
    let hasSourceMaterial = false;

    const addEntry = (entry: {
        ref: EvidenceRef;
        citation: SourceGroundedCitation;
        providerSource?: SourceGroundedProviderSource | null;
    }) => {
        const refId = buildRefId(entry.ref);
        if (seen.has(refId)) return;
        seen.add(refId);
        evidenceRefs.push(entry.ref);
        citations.push(entry.citation);
        if (entry.providerSource) {
            providerSources.push(entry.providerSource);
        }
    };

    if (scopes.includes('current_draft') && input.draftPostId) {
        const sourceEntries = await selectSourceMaterials(prisma, {
            circleId: input.circleId,
            draftPostId: input.draftPostId,
            materialIds: [],
            includeProviderContext: Boolean(input.includeProviderContext),
            now,
        });
        sourceEntries.forEach(addEntry);
        if (sourceEntries.length > 0) hasSourceMaterial = true;

        const formalEntries = await selectDraftFormalReferences(prisma, {
            circleId: input.circleId,
            draftPostId: input.draftPostId,
            includeProviderContext: Boolean(input.includeProviderContext),
            now,
            draftReferenceLinks: input.draftReferenceLinks ?? null,
        });
        formalEntries.forEach(addEntry);
    }

    if (scopes.includes('source_materials')) {
        const materialIds = normalizePositiveInts(input.sourceMaterialIds);
        const sourceEntries = await selectSourceMaterials(prisma, {
            circleId: input.circleId,
            draftPostId: input.draftPostId ?? null,
            materialIds,
            includeProviderContext: Boolean(input.includeProviderContext),
            now,
        });
        if (materialIds.length > 0) {
            const found = new Set(sourceEntries.map((entry) => Number(entry.ref.sourceId)));
            const missing = materialIds.filter((id) => !found.has(id));
            if (missing.length > 0) {
                throw new SourceGroundedAskError('source_material_not_found', {
                    statusCode: 404,
                    details: { materialIds: missing },
                });
            }
        }
        sourceEntries.forEach(addEntry);
        if (sourceEntries.length > 0) hasSourceMaterial = true;
    }

    if (scopes.includes('formal_references') || scopes.includes('current_circle')) {
        const formalEntries = await selectCircleFormalReferences(prisma, {
            circleId: input.circleId,
            knowledgeIds: normalizeStrings(input.knowledgeIds),
            includeProviderContext: Boolean(input.includeProviderContext),
            now,
            maxSources,
        });
        formalEntries.forEach(addEntry);
    }

    if (scopes.includes('trend_receipts') || scopes.includes('current_circle')) {
        const trendEntries = await selectTrendReceipts(prisma, {
            receiptIds: normalizeStrings(input.trendReceiptIds),
            includeProviderContext: Boolean(input.includeProviderContext),
            now,
            maxSources,
        });
        trendEntries.forEach(addEntry);
    }

    const trimmedRefs = evidenceRefs.slice(0, maxSources);
    const trimmedRefIds = new Set(trimmedRefs.map(buildRefId));
    const trimmedCitations = citations.filter((citation) => trimmedRefIds.has(citation.refId));
    const trimmedProviderSources = providerSources.filter((source) => trimmedRefIds.has(source.refId));
    const sourceDigest = digestJson(trimmedRefs.map((ref) => ({
        sourceType: ref.sourceType,
        sourceId: ref.sourceId,
        digest: ref.digest,
        visibility: ref.visibility,
    })));

    return {
        evidenceRefs: trimmedRefs,
        citations: trimmedCitations,
        providerSources: trimmedProviderSources,
        sourceDigest,
        hasSourceMaterial,
        scopeSnapshot: {
            scopes,
            circleId: input.circleId,
            draftPostId: input.draftPostId ?? null,
            sourceMaterialIds: normalizePositiveInts(input.sourceMaterialIds),
            knowledgeIds: normalizeStrings(input.knowledgeIds),
            trendReceiptIds: normalizeStrings(input.trendReceiptIds),
            selectedRefIds: trimmedRefs.map(buildRefId),
        },
    };
}

export function normalizeScopes(
    scopes: SourceGroundedAskSelectionInput['scopes'],
    draftPostId?: number | null,
): SourceGroundedAskScope[] {
    const normalized = Array.isArray(scopes)
        ? scopes
            .map((scope) => String(scope || '').trim())
            .filter((scope): scope is SourceGroundedAskScope =>
                (VALID_SCOPES as readonly string[]).includes(scope),
            )
        : [];
    if (normalized.length > 0) {
        return Array.from(new Set(normalized));
    }
    return draftPostId ? ['current_draft'] : ['current_circle'];
}

export function buildRefId(ref: Pick<EvidenceRef, 'sourceType' | 'sourceId'>): string {
    return `${ref.sourceType}:${ref.sourceId}`;
}

async function selectSourceMaterials(
    prisma: any,
    input: {
        circleId: number;
        draftPostId?: number | null;
        materialIds: number[];
        includeProviderContext: boolean;
        now: Date;
    },
) {
    const materials = (await listSourceMaterials(prisma, {
        circleId: input.circleId,
        draftPostId: input.draftPostId ?? null,
        materialIds: input.materialIds,
        canReview: false,
        canViewReviewQueue: false,
    })).filter((material) => material.status === 'ai_readable');

    const grounding = input.includeProviderContext && materials.length > 0
        ? await buildSourceMaterialGroundingContext(prisma, {
            circleId: input.circleId,
            draftPostId: input.draftPostId ?? null,
            materialIds: materials.map((material) => material.id),
        })
        : [];
    const groundingByMaterial = new Map<number, string[]>();
    for (const item of grounding) {
        const list = groundingByMaterial.get(item.materialId) ?? [];
        if (item.text.trim()) list.push(item.text.trim());
        groundingByMaterial.set(item.materialId, list);
    }

    return materials.map((material) => {
        const expiresAt = serializeDate(material.expiresAt);
        const stale = isExpired(expiresAt, input.now);
        const ref = buildEvidenceRefFromSourceMaterial({
            id: material.id,
            contentDigest: material.contentDigest,
            lifecycleStatus: material.lifecycleStatus,
            evidencePrivacyClass: material.evidencePrivacyClass,
            visibilityScope: material.visibilityScope,
            originType: 'source_material',
            originRef: `source_material:${material.id}`,
            expiresAt,
        });
        const refId = buildRefId(ref);
        const excerpt = truncateText((groundingByMaterial.get(material.id) ?? []).join('\n\n'), MAX_EXCERPT_CHARS);
        return {
            ref,
            citation: {
                refId,
                sourceType: ref.sourceType,
                sourceId: ref.sourceId,
                title: material.name,
                locator: ref.locator,
                visibility: ref.visibility,
                stale,
                capturedAt: ref.capturedAt,
                createdAt: null,
                expiresAt,
                sourceStatus: material.lifecycleStatus,
            },
            providerSource: input.includeProviderContext && excerpt
                ? {
                    refId,
                    sourceType: ref.sourceType,
                    sourceId: ref.sourceId,
                    title: material.name,
                    summary: material.name,
                    excerpt,
                    stale,
                }
                : null,
        };
    });
}

async function selectDraftFormalReferences(
    prisma: any,
    input: {
        circleId: number;
        draftPostId: number;
        includeProviderContext: boolean;
        now: Date;
        draftReferenceLinks: SourceGroundedAskSelectionInput['draftReferenceLinks'];
    },
) {
    const links = input.draftReferenceLinks ?? await loadDraftReferenceLinks(prisma, input.draftPostId);
    const resolvedLinks = links.filter((link) =>
        link.resolutionStatus === 'resolved' && Boolean(link.sourceKnowledgeId),
    );
    const knowledgeIds = Array.from(new Set(
        resolvedLinks.map((link) => String(link.sourceKnowledgeId)).filter(Boolean),
    ));
    if (knowledgeIds.length === 0) return [];
    const rows = await loadKnowledgeRows(prisma, {
        circleId: input.circleId,
        knowledgeIds,
        maxSources: knowledgeIds.length,
    });
    const linkByKnowledgeId = new Map(resolvedLinks.map((link) => [String(link.sourceKnowledgeId), link]));
    return rows.map((row: any) => formalReferenceEntry(row, {
        circleId: input.circleId,
        includeProviderContext: input.includeProviderContext,
        draftPostId: input.draftPostId,
        sourceBlockId: linkByKnowledgeId.get(row.knowledgeId)?.sourceBlockId ?? null,
    }));
}

async function selectCircleFormalReferences(
    prisma: any,
    input: {
        circleId: number;
        knowledgeIds: string[];
        includeProviderContext: boolean;
        now: Date;
        maxSources: number;
    },
) {
    const rows = await loadKnowledgeRows(prisma, {
        circleId: input.circleId,
        knowledgeIds: input.knowledgeIds,
        maxSources: input.maxSources,
    });
    if (input.knowledgeIds.length > 0) {
        const found = new Set(rows.map((row: any) => String(row.knowledgeId)));
        const missing = input.knowledgeIds.filter((id) => !found.has(id));
        if (missing.length > 0) {
            throw new SourceGroundedAskError('formal_reference_not_found', {
                statusCode: 404,
                details: { knowledgeIds: missing },
            });
        }
    }
    return rows.map((row: any) => formalReferenceEntry(row, {
        circleId: input.circleId,
        includeProviderContext: input.includeProviderContext,
        draftPostId: null,
        sourceBlockId: null,
    }));
}

async function loadKnowledgeRows(
    prisma: any,
    input: {
        circleId: number;
        knowledgeIds: string[];
        maxSources: number;
    },
) {
    if (typeof prisma?.knowledge?.findMany !== 'function') return [];
    return prisma.knowledge.findMany({
        where: {
            circleId: input.circleId,
            ...(input.knowledgeIds.length > 0 ? { knowledgeId: { in: input.knowledgeIds } } : {}),
        },
        orderBy: [
            { createdAt: 'desc' },
            { id: 'desc' },
        ],
        take: input.knowledgeIds.length > 0 ? input.knowledgeIds.length : input.maxSources,
        select: {
            id: true,
            knowledgeId: true,
            circleId: true,
            title: true,
            description: true,
            contentHash: true,
            onChainAddress: true,
            version: true,
            createdAt: true,
        },
    });
}

function formalReferenceEntry(
    row: any,
    input: {
        circleId: number;
        includeProviderContext: boolean;
        draftPostId: number | null;
        sourceBlockId: string | null;
    },
) {
    const digest = normalizeDigest(row.contentHash) ?? digestJson({
        knowledgeId: row.knowledgeId,
        title: row.title,
        description: row.description ?? '',
        version: row.version ?? 1,
    });
    const ref = buildEvidenceRefFromFormalReference({
        knowledgeId: row.knowledgeId,
        digest,
        circleId: input.circleId,
        title: row.title,
        onChainAddress: row.onChainAddress,
        version: row.version,
        createdAt: row.createdAt,
        draftPostId: input.draftPostId,
        sourceBlockId: input.sourceBlockId,
    });
    const refId = buildRefId(ref);
    const excerpt = truncateText(String(row.description || row.title || ''), MAX_EXCERPT_CHARS);
    return {
        ref,
        citation: {
            refId,
            sourceType: ref.sourceType,
            sourceId: ref.sourceId,
            title: String(row.title || row.knowledgeId),
            locator: ref.locator,
            visibility: ref.visibility,
            stale: false,
            capturedAt: ref.capturedAt,
            createdAt: serializeDate(row.createdAt),
            expiresAt: null,
            sourceStatus: 'formal_reference',
        },
        providerSource: input.includeProviderContext && excerpt
            ? {
                refId,
                sourceType: ref.sourceType,
                sourceId: ref.sourceId,
                title: String(row.title || row.knowledgeId),
                summary: String(row.description || ''),
                excerpt,
                stale: false,
            }
            : null,
    };
}

async function selectTrendReceipts(
    prisma: any,
    input: {
        receiptIds: string[];
        includeProviderContext: boolean;
        now: Date;
        maxSources: number;
    },
) {
    if (typeof prisma?.trendReceipt?.findMany !== 'function') return [];
    const rows = await prisma.trendReceipt.findMany({
        where: {
            visibility: 'public',
            ...(input.receiptIds.length > 0 ? { id: { in: input.receiptIds } } : {}),
        },
        orderBy: [
            { fetchedAt: 'desc' },
            { id: 'desc' },
        ],
        take: input.receiptIds.length > 0 ? input.receiptIds.length : input.maxSources,
        include: {
            source: {
                select: {
                    sourceKey: true,
                    displayName: true,
                },
            },
        },
    });
    if (input.receiptIds.length > 0) {
        const found = new Set(rows.map((row: any) => String(row.id)));
        const missing = input.receiptIds.filter((id) => !found.has(id));
        if (missing.length > 0) {
            throw new SourceGroundedAskError('trend_receipt_not_found', {
                statusCode: 404,
                details: { trendReceiptIds: missing },
            });
        }
    }
    return rows.map((row: any) => {
        const ref = buildEvidenceRefFromTrendReceipt({
            id: row.id,
            digest: row.digest,
            sourceKey: row.source?.sourceKey ?? row.sourceId,
            licenseNote: row.licenseNote,
            query: row.query,
            cacheKey: row.cacheKey,
            fetchedAt: row.fetchedAt,
            expiresAt: row.expiresAt,
        });
        const refId = buildRefId(ref);
        const expiresAt = serializeDate(row.expiresAt);
        const stale = row.status === 'stale' || isExpired(expiresAt, input.now);
        const title = String(row.source?.displayName || row.sourceId || 'Trend receipt');
        const excerpt = truncateText(String(row.summary || ''), MAX_EXCERPT_CHARS);
        return {
            ref,
            citation: {
                refId,
                sourceType: ref.sourceType,
                sourceId: ref.sourceId,
                title,
                locator: ref.locator,
                visibility: ref.visibility,
                stale,
                capturedAt: ref.capturedAt,
                fetchedAt: serializeDate(row.fetchedAt),
                expiresAt,
                sourceStatus: String(row.status || ''),
                licenseNote: String(row.licenseNote || ''),
            },
            providerSource: input.includeProviderContext && excerpt
                ? {
                    refId,
                    sourceType: ref.sourceType,
                    sourceId: ref.sourceId,
                    title,
                    summary: excerpt,
                    excerpt,
                    stale,
                }
                : null,
        };
    });
}

function normalizePositiveInts(value: unknown): number[] {
    if (!Array.isArray(value)) return [];
    return Array.from(new Set(value
        .map((item) => Number(item))
        .filter((item) => Number.isFinite(item) && item > 0)
        .map((item) => Math.trunc(item))));
}

function normalizeStrings(value: unknown): string[] {
    if (!Array.isArray(value)) return [];
    return Array.from(new Set(value
        .map((item) => String(item || '').trim())
        .filter(Boolean)));
}

function normalizeDigest(value: unknown): string | null {
    const digest = String(value || '').trim();
    return /^[a-f0-9]{64}$/i.test(digest) ? digest : null;
}

function digestJson(value: unknown): string {
    return crypto.createHash('sha256').update(JSON.stringify(value)).digest('hex');
}

function serializeDate(value: Date | string | null | undefined): string | null {
    if (value instanceof Date) return value.toISOString();
    if (typeof value === 'string' && value.trim()) {
        const date = new Date(value);
        return Number.isNaN(date.getTime()) ? value : date.toISOString();
    }
    return null;
}

function isExpired(expiresAt: string | null, now: Date): boolean {
    if (!expiresAt) return false;
    const date = new Date(expiresAt);
    return !Number.isNaN(date.getTime()) && date.getTime() <= now.getTime();
}

function truncateText(value: string, maxChars: number): string {
    const text = String(value || '').replace(/\s+/g, ' ').trim();
    if (text.length <= maxChars) return text;
    return `${text.slice(0, Math.max(0, maxChars - 1)).trim()}…`;
}
