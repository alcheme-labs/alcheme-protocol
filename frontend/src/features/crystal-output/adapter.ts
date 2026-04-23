export interface CrystalOutputKnowledgeContributorInput {
    sourceType?: 'SNAPSHOT' | 'SETTLEMENT' | null;
    sourceDraftPostId?: number | null;
    sourceAnchorId?: string | null;
    sourceSummaryHash?: string | null;
    sourceMessagesDigest?: string | null;
}

export interface DraftReferenceLink {
    referenceId: string;
    draftPostId: number;
    draftVersion: number;
    sourceBlockId: string;
    crystalName: string;
    crystalBlockAnchor: string | null;
    status: 'parsed';
}

export interface DraftReferenceLinkPreview {
    draftPostId: number | null;
    totalCount: number;
    sourceBlockCount: number;
    crystalNames: string[];
}

export interface CrystalOutputKnowledgeInput {
    knowledgeId: string;
    title: string;
    version: number;
    contributorsCount: number;
    createdAt: string;
    stats: {
        citationCount: number;
    };
    contributors?: CrystalOutputKnowledgeContributorInput[] | null;
    references?: Array<{ knowledgeId: string }> | null;
    citedBy?: Array<{ knowledgeId: string }> | null;
}

export interface CrystalOutputViewModel {
    knowledgeId: string;
    title: string;
    versionLabel: string;
    citationCount: number;
    contributorCount: number;
    outboundReferenceCount: number;
    inboundReferenceCount: number;
    sourceBindingKind: 'snapshot' | 'settlement_fallback' | 'unlabeled';
    sourceDraftPostId: number | null;
    sourceAnchorId: string | null;
    sourceSummaryHash: string | null;
    sourceMessagesDigest: string | null;
    createdAt: string;
    missingTeam03Inputs: string[];
}

export interface CrystallizationOutputRecordInput {
    output?: {
        knowledgeId?: string | null;
        sourceDraftPostId?: number | null;
        sourceDraftVersion?: number | null;
        contentHash?: string | null;
        contributorsRoot?: string | null;
        createdAt?: string | Date | null;
    } | null;
    bindingEvidence?: {
        sourceAnchorId?: string | null;
        sourceSummaryHash?: string | null;
        sourceMessagesDigest?: string | null;
    } | null;
}

interface NormalizedSnapshotContributor {
    sourceDraftPostId: number | null;
    sourceAnchorId: string | null;
    sourceSummaryHash: string | null;
    sourceMessagesDigest: string | null;
}

function normalizeNullableString(value: string | null | undefined): string | null {
    return typeof value === 'string' && value.length > 0 ? value : null;
}

function normalizePositiveInt(value: unknown): number | null {
    const parsed = Number(value);
    return Number.isInteger(parsed) && parsed > 0 ? parsed : null;
}

function ensureObject(value: unknown): Record<string, unknown> {
    if (!value || typeof value !== 'object' || Array.isArray(value)) {
        throw new Error('invalid_object');
    }
    return value as Record<string, unknown>;
}

function normalizeDateString(value: unknown): string | null {
    if (value instanceof Date) {
        return Number.isNaN(value.getTime()) ? null : value.toISOString();
    }
    if (typeof value === 'string' && value.trim().length > 0) {
        return value;
    }
    return null;
}

function normalizeSnapshotContributor(
    contributor: CrystalOutputKnowledgeContributorInput,
): NormalizedSnapshotContributor {
    return {
        sourceDraftPostId: typeof contributor.sourceDraftPostId === 'number'
            && Number.isInteger(contributor.sourceDraftPostId)
            && contributor.sourceDraftPostId > 0
            ? contributor.sourceDraftPostId
            : null,
        sourceAnchorId: normalizeNullableString(contributor.sourceAnchorId),
        sourceSummaryHash: normalizeNullableString(contributor.sourceSummaryHash),
        sourceMessagesDigest: normalizeNullableString(contributor.sourceMessagesDigest),
    };
}

function listSnapshotContributors(
    contributors: CrystalOutputKnowledgeContributorInput[],
): CrystalOutputKnowledgeContributorInput[] {
    return contributors.filter((item) => item.sourceType === 'SNAPSHOT');
}

function pickResolvedSnapshotContributor(
    contributors: CrystalOutputKnowledgeContributorInput[],
): NormalizedSnapshotContributor | null {
    if (contributors.length === 0) return null;

    const [first, ...rest] = contributors.map(normalizeSnapshotContributor);
    const isConsistent = rest.every((item) =>
        item.sourceDraftPostId === first.sourceDraftPostId
        && item.sourceAnchorId === first.sourceAnchorId
        && item.sourceSummaryHash === first.sourceSummaryHash
        && item.sourceMessagesDigest === first.sourceMessagesDigest,
    );

    return isConsistent ? first : null;
}

export function buildCrystalOutputViewModel(
    input: CrystalOutputKnowledgeInput,
): CrystalOutputViewModel {
    const contributors = Array.isArray(input.contributors) ? input.contributors : [];
    const snapshotContributors = listSnapshotContributors(contributors);
    const snapshotContributor = pickResolvedSnapshotContributor(snapshotContributors);
    const hasSettlementFallback =
        snapshotContributors.length === 0 && contributors.some((item) => item.sourceType === 'SETTLEMENT');

    const missingTeam03Inputs: string[] = [];
    if (snapshotContributors.length === 0) {
        missingTeam03Inputs.push('snapshot-backed output evidence');
    }
    if (snapshotContributor?.sourceDraftPostId === null || snapshotContributor?.sourceDraftPostId === undefined) {
        missingTeam03Inputs.push('stable output to draft binding');
    }

    return {
        knowledgeId: input.knowledgeId,
        title: input.title,
        versionLabel: `v${Math.max(1, Number(input.version || 1))}`,
        citationCount: Math.max(0, Number(input.stats?.citationCount || 0)),
        contributorCount: Math.max(0, Number(input.contributorsCount || 0)),
        outboundReferenceCount: Array.isArray(input.references) ? input.references.length : 0,
        inboundReferenceCount: Array.isArray(input.citedBy) ? input.citedBy.length : 0,
        sourceBindingKind: snapshotContributors.length > 0
            ? 'snapshot'
            : hasSettlementFallback
                ? 'settlement_fallback'
                : 'unlabeled',
        sourceDraftPostId: snapshotContributor?.sourceDraftPostId ?? null,
        sourceAnchorId: snapshotContributor?.sourceAnchorId ?? null,
        sourceSummaryHash: snapshotContributor?.sourceSummaryHash ?? null,
        sourceMessagesDigest: snapshotContributor?.sourceMessagesDigest ?? null,
        createdAt: input.createdAt,
        missingTeam03Inputs,
    };
}

export function buildCrystalOutputViewModelFromRecord(input: {
    knowledge: CrystalOutputKnowledgeInput;
    record: CrystallizationOutputRecordInput | null;
}): CrystalOutputViewModel | null {
    if (!input.record?.output) {
        return null;
    }
    const output = input.record?.output ?? null;
    const bindingEvidence = input.record?.bindingEvidence ?? null;
    const sourceDraftPostId = normalizePositiveInt(output?.sourceDraftPostId);
    const sourceAnchorId = normalizeNullableString(bindingEvidence?.sourceAnchorId);
    const sourceSummaryHash = normalizeNullableString(bindingEvidence?.sourceSummaryHash);
    const sourceMessagesDigest = normalizeNullableString(bindingEvidence?.sourceMessagesDigest);
    const hasBindingEvidence = Boolean(sourceAnchorId || sourceSummaryHash || sourceMessagesDigest);

    const missingTeam03Inputs: string[] = [];
    if (!hasBindingEvidence) {
        missingTeam03Inputs.push('snapshot-backed output evidence');
    }
    if (sourceDraftPostId === null) {
        missingTeam03Inputs.push('stable output to draft binding');
    }

    return {
        knowledgeId: input.knowledge.knowledgeId,
        title: input.knowledge.title,
        versionLabel: `v${Math.max(1, Number(input.knowledge.version || 1))}`,
        citationCount: Math.max(0, Number(input.knowledge.stats?.citationCount || 0)),
        contributorCount: Math.max(0, Number(input.knowledge.contributorsCount || 0)),
        outboundReferenceCount: Array.isArray(input.knowledge.references) ? input.knowledge.references.length : 0,
        inboundReferenceCount: Array.isArray(input.knowledge.citedBy) ? input.knowledge.citedBy.length : 0,
        sourceBindingKind: hasBindingEvidence ? 'snapshot' : 'unlabeled',
        sourceDraftPostId,
        sourceAnchorId,
        sourceSummaryHash,
        sourceMessagesDigest,
        createdAt: normalizeDateString(output?.createdAt) || input.knowledge.createdAt,
        missingTeam03Inputs,
    };
}

export function pickDraftReferenceLinks(payload: unknown): DraftReferenceLink[] {
    const rows = Array.isArray(payload) ? payload : [];

    return rows.map((value) => {
        const root = ensureObject(value);
        return {
            referenceId: String(root.referenceId || ''),
            draftPostId: normalizePositiveInt(root.draftPostId) || 0,
            draftVersion: normalizePositiveInt(root.draftVersion) || 0,
            sourceBlockId: String(root.sourceBlockId || ''),
            crystalName: String(root.crystalName || ''),
            crystalBlockAnchor: normalizeNullableString(
                typeof root.crystalBlockAnchor === 'string'
                    ? root.crystalBlockAnchor
                    : null,
            ),
            status: 'parsed' as const,
        };
    }).filter((row) =>
        row.referenceId.length > 0
        && row.draftPostId > 0
        && row.draftVersion > 0
        && row.sourceBlockId.length > 0
        && row.crystalName.length > 0,
    );
}

export function buildDraftReferenceLinkPreview(input: {
    draftPostId: number | null;
    referenceLinks: DraftReferenceLink[];
}): DraftReferenceLinkPreview {
    return {
        draftPostId: input.draftPostId,
        totalCount: input.referenceLinks.length,
        sourceBlockCount: new Set(input.referenceLinks.map((item) => item.sourceBlockId)).size,
        crystalNames: Array.from(new Set(input.referenceLinks.map((item) => item.crystalName))),
    };
}
