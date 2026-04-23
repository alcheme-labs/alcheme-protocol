export interface CrystalOutput {
    knowledgeId: string;
    sourceDraftPostId: number;
    sourceDraftVersion: number;
    contentHash: string;
    contributorsRoot: string;
    createdAt: Date;
}

export interface CrystallizationBindingEvidence {
    knowledgeId: string;
    sourceDraftPostId: number;
    sourceDraftVersion: number;
    sourceAnchorId: string;
    sourceSummaryHash: string | null;
    sourceMessagesDigest: string | null;
    proofPackageHash: string;
    contributorsRoot: string;
    contributorsCount: number;
    bindingVersion: number;
    createdAt: Date;
}

export interface CrystallizationOutputRecord {
    output: CrystalOutput;
    bindingEvidence: CrystallizationBindingEvidence | null;
    policyProfileDigest: string | null;
}

export interface CrystallizationOutputRow {
    knowledgeId: string;
    sourceDraftPostId: number | null;
    sourceDraftVersion: number | null;
    contentHash: string | null;
    contributorsRoot: string | null;
    createdAt: Date | null;
    sourceAnchorId: string | null;
    sourceSummaryHash: string | null;
    sourceMessagesDigest: string | null;
    proofPackageHash: string | null;
    contributorsCount: number | null;
    bindingVersion: number | null;
    bindingCreatedAt: Date | null;
    policyProfileDigest: string | null;
}

function isPositiveInt(value: number | null | undefined): value is number {
    return typeof value === 'number' && Number.isInteger(value) && value > 0;
}

function isNonEmptyString(value: string | null | undefined): value is string {
    return typeof value === 'string' && value.trim().length > 0;
}

export function buildCrystallizationOutputRecord(
    row: CrystallizationOutputRow | null | undefined,
): CrystallizationOutputRecord | null {
    if (!row) return null;
    if (
        !isNonEmptyString(row.knowledgeId)
        || !isPositiveInt(row.sourceDraftPostId)
        || !isPositiveInt(row.sourceDraftVersion)
        || !isNonEmptyString(row.contentHash)
        || !isNonEmptyString(row.contributorsRoot)
        || !(row.createdAt instanceof Date)
    ) {
        return null;
    }

    const output: CrystalOutput = {
        knowledgeId: row.knowledgeId,
        sourceDraftPostId: row.sourceDraftPostId,
        sourceDraftVersion: row.sourceDraftVersion,
        contentHash: row.contentHash,
        contributorsRoot: row.contributorsRoot,
        createdAt: row.createdAt,
    };

    const bindingEvidence = (
        isNonEmptyString(row.sourceAnchorId)
        && isNonEmptyString(row.proofPackageHash)
        && isPositiveInt(row.contributorsCount)
        && isPositiveInt(row.bindingVersion)
        && row.bindingCreatedAt instanceof Date
    )
        ? {
            knowledgeId: row.knowledgeId,
            sourceDraftPostId: row.sourceDraftPostId,
            sourceDraftVersion: row.sourceDraftVersion,
            sourceAnchorId: row.sourceAnchorId,
            sourceSummaryHash: row.sourceSummaryHash ?? null,
            sourceMessagesDigest: row.sourceMessagesDigest ?? null,
            proofPackageHash: row.proofPackageHash,
            contributorsRoot: row.contributorsRoot,
            contributorsCount: row.contributorsCount,
            bindingVersion: row.bindingVersion,
            createdAt: row.bindingCreatedAt,
        }
        : null;

    return {
        output,
        bindingEvidence,
        policyProfileDigest: row.policyProfileDigest ?? null,
    };
}
