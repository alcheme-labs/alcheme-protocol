import {
    DEFAULT_CONTRIBUTION_POLICY_VERSION,
} from './policy';
import {
    hashContributionEvidencePackage,
} from './evidencePackage';
import {
    CONTRIBUTION_ASSESSMENT_SCHEMA_VERSION,
    type ContributionAssessmentSuggestion,
    type ContributionEvidencePackage,
    type ContributionFrameType,
    type ContributionType,
} from './types';
import {
    CONTRIBUTION_ASSESSMENT_AI_ALGORITHM_VERSION,
} from './privacyProfile';

const FRAME_TYPES = new Set<ContributionFrameType>([
    'problem_framing',
    'core_claim',
    'evidence_boundary',
    'structure_expression',
    'review_correction',
]);

const CONTRIBUTION_TYPES = new Set<ContributionType>([
    'source_discussion',
    'direct_authoring',
    'curation',
    'semantic_edit',
    'style_edit',
    'review_issue',
    'review_solution',
]);

const FORBIDDEN_OUTPUT_FIELDS = new Set([
    'rootHex',
    'contributorsRoot',
    'proofPackageHash',
    'proof_package_hash',
    'receiptWeightBps',
    'receipt',
    'knowledgePda',
    'postCrystallizationRewrite',
]);

const MALFORMED_OUTPUT_ERROR = 'contribution_assessment_ai_malformed_output';
const UNPROVIDED_EVIDENCE_REF_ERROR = 'contribution_assessment_ai_unprovided_evidence_ref';

export function parseContributionAssessmentAiSuggestion(input: {
    rawText: unknown;
    evidence: ContributionEvidencePackage;
    algorithmVersion?: string;
    framePolicyVersion?: string;
    allowedEvidenceRefIds?: Iterable<string>;
}): ContributionAssessmentSuggestion {
    const parsed = parseObject(input.rawText);
    const forbiddenFields = listForbiddenFields(parsed);
    if (forbiddenFields.length > 0) {
        throw new Error('contribution_assessment_ai_forbidden_output_field');
    }
    assertKnownKeys(parsed, ['confidence', 'frames', 'highPenetrationCandidates', 'warnings']);
    const allowedEvidenceRefs = input.allowedEvidenceRefIds
        ? new Set(Array.from(input.allowedEvidenceRefIds))
        : null;
    const frames = readArray(parsed, 'frames', { min: 1, max: 8 })
        .map((frame) => normalizeFrame(frame, allowedEvidenceRefs));
    return {
        schemaVersion: CONTRIBUTION_ASSESSMENT_SCHEMA_VERSION,
        provider: 'ai',
        algorithmVersion: input.algorithmVersion ?? CONTRIBUTION_ASSESSMENT_AI_ALGORITHM_VERSION,
        framePolicyVersion: input.framePolicyVersion ?? DEFAULT_CONTRIBUTION_POLICY_VERSION,
        inputHash: hashContributionEvidencePackage(input.evidence),
        confidence: readNumber01(parsed, 'confidence'),
        frames,
        highPenetrationCandidates: readArray(parsed, 'highPenetrationCandidates', { min: 0, max: 12 })
            .map((candidate) => normalizeHighPenetrationCandidate(candidate)),
        warnings: readArray(parsed, 'warnings', { min: 0, max: 12 })
            .map((warning) => normalizeWarning(warning, allowedEvidenceRefs)),
    };
}

function parseObject(value: unknown): Record<string, unknown> {
    if (value && typeof value === 'object' && !Array.isArray(value)) return value as Record<string, unknown>;
    const text = String(value ?? '').trim();
    if (!text) throw new Error('contribution_assessment_ai_invalid_json');
    try {
        const parsed = JSON.parse(text);
        if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) {
            throw new Error('contribution_assessment_ai_invalid_json');
        }
        return parsed as Record<string, unknown>;
    } catch {
        throw new Error('contribution_assessment_ai_invalid_json');
    }
}

function normalizeFrame(
    value: unknown,
    allowedEvidenceRefs: Set<string> | null,
): ContributionAssessmentSuggestion['frames'][number] {
    if (!value || typeof value !== 'object' || Array.isArray(value)) throw new Error(MALFORMED_OUTPUT_ERROR);
    const record = value as Record<string, unknown>;
    assertKnownKeys(record, ['frameId', 'frameType', 'weightBps', 'allocations']);
    const frameId = readText(record, 'frameId', 120);
    const frameType = readText(record, 'frameType', 80) as ContributionFrameType;
    if (!FRAME_TYPES.has(frameType)) throw new Error(MALFORMED_OUTPUT_ERROR);
    const allocations = readArray(record, 'allocations', { min: 1, max: 20 })
        .map((allocation) => normalizeAllocation(allocation, allowedEvidenceRefs));
    return {
        frameId,
        frameType,
        weightBps: readInt(record, 'weightBps', 0, 10000),
        allocations,
    };
}

function normalizeAllocation(
    value: unknown,
    allowedEvidenceRefs: Set<string> | null,
): ContributionAssessmentSuggestion['frames'][number]['allocations'][number] {
    if (!value || typeof value !== 'object' || Array.isArray(value)) throw new Error(MALFORMED_OUTPUT_ERROR);
    const record = value as Record<string, unknown>;
    assertKnownKeys(record, [
        'allocationId',
        'pubkey',
        'contributionType',
        'weightBps',
        'evidenceRefs',
        'confidence',
        'penetration',
        'reasonCode',
        'shortReason',
    ]);
    const allocationId = readText(record, 'allocationId', 160);
    const pubkey = readText(record, 'pubkey', 80);
    const contributionType = readText(record, 'contributionType', 80) as ContributionType;
    const penetration = normalizePenetration(record.penetration);
    const reasonCode = readText(record, 'reasonCode', 120);
    const shortReason = readText(record, 'shortReason', 220);
    const evidenceRefs = readStringArray(record, 'evidenceRefs', { min: 1, max: 12, maxLength: 160 });
    assertEvidenceRefsWereProvided(evidenceRefs, allowedEvidenceRefs);
    if (!CONTRIBUTION_TYPES.has(contributionType)) throw new Error(MALFORMED_OUTPUT_ERROR);
    return {
        allocationId,
        pubkey,
        contributionType,
        weightBps: readInt(record, 'weightBps', 0, 10000),
        evidenceRefs,
        confidence: readNumber01(record, 'confidence'),
        penetration,
        reasonCode,
        shortReason,
    };
}

function normalizePenetration(
    value: unknown,
): ContributionAssessmentSuggestion['frames'][number]['allocations'][number]['penetration'] {
    if (!value || typeof value !== 'object' || Array.isArray(value)) throw new Error(MALFORMED_OUTPUT_ERROR);
    const record = value as Record<string, unknown>;
    assertKnownKeys(record, ['targetFrameId', 'strengthBps', 'requiresReview']);
    return {
        targetFrameId: readNullableText(record, 'targetFrameId', 120),
        strengthBps: readInt(record, 'strengthBps', 0, 10000),
        requiresReview: readBoolean(record, 'requiresReview'),
    };
}

function normalizeHighPenetrationCandidate(
    value: unknown,
): ContributionAssessmentSuggestion['highPenetrationCandidates'][number] {
    if (!value || typeof value !== 'object' || Array.isArray(value)) throw new Error(MALFORMED_OUTPUT_ERROR);
    const record = value as Record<string, unknown>;
    assertKnownKeys(record, ['candidateId', 'sourceAllocationRef', 'targetFrameId', 'strengthBps', 'reasonCode', 'shortReason']);
    return {
        candidateId: readText(record, 'candidateId', 160),
        sourceAllocationRef: readText(record, 'sourceAllocationRef', 160),
        targetFrameId: readText(record, 'targetFrameId', 120),
        strengthBps: readInt(record, 'strengthBps', 0, 10000),
        reasonCode: readText(record, 'reasonCode', 120),
        shortReason: readText(record, 'shortReason', 220),
    };
}

function normalizeWarning(
    value: unknown,
    allowedEvidenceRefs: Set<string> | null,
): ContributionAssessmentSuggestion['warnings'][number] {
    if (!value || typeof value !== 'object' || Array.isArray(value)) throw new Error(MALFORMED_OUTPUT_ERROR);
    const record = value as Record<string, unknown>;
    assertKnownKeys(record, ['code', 'evidenceRefs', 'message']);
    const evidenceRefs = readStringArray(record, 'evidenceRefs', { min: 0, max: 12, maxLength: 160 });
    assertEvidenceRefsWereProvided(evidenceRefs, allowedEvidenceRefs);
    return {
        code: readText(record, 'code', 120),
        evidenceRefs,
        message: readText(record, 'message', 220),
    };
}

function readArray(
    record: Record<string, unknown>,
    key: string,
    bounds: { min: number; max: number },
): unknown[] {
    const value = record[key];
    if (!Array.isArray(value) || value.length < bounds.min || value.length > bounds.max) {
        throw new Error(MALFORMED_OUTPUT_ERROR);
    }
    return value;
}

function readStringArray(
    record: Record<string, unknown>,
    key: string,
    bounds: { min: number; max: number; maxLength: number },
): string[] {
    return readArray(record, key, bounds).map((item) => {
        if (typeof item !== 'string') throw new Error(MALFORMED_OUTPUT_ERROR);
        return normalizeText(item, bounds.maxLength);
    });
}

function readText(record: Record<string, unknown>, key: string, maxLength: number): string {
    const value = record[key];
    if (typeof value !== 'string') throw new Error(MALFORMED_OUTPUT_ERROR);
    return normalizeText(value, maxLength);
}

function readNullableText(record: Record<string, unknown>, key: string, maxLength: number): string | null {
    const value = record[key];
    if (value === null) return null;
    if (typeof value !== 'string') throw new Error(MALFORMED_OUTPUT_ERROR);
    const normalized = value.replace(/\s+/g, ' ').trim();
    if (normalized.length > maxLength) throw new Error(MALFORMED_OUTPUT_ERROR);
    return normalized || null;
}

function normalizeText(value: string, maxLength: number): string {
    const normalized = value.replace(/\s+/g, ' ').trim();
    if (!normalized || normalized.length > maxLength) throw new Error(MALFORMED_OUTPUT_ERROR);
    return normalized;
}

function readInt(record: Record<string, unknown>, key: string, min: number, max: number): number {
    const value = record[key];
    if (typeof value !== 'number' || !Number.isInteger(value) || value < min || value > max) {
        throw new Error(MALFORMED_OUTPUT_ERROR);
    }
    return value;
}

function readNumber01(record: Record<string, unknown>, key: string): number {
    const value = record[key];
    if (typeof value !== 'number' || !Number.isFinite(value) || value < 0 || value > 1) {
        throw new Error(MALFORMED_OUTPUT_ERROR);
    }
    return value;
}

function readBoolean(record: Record<string, unknown>, key: string): boolean {
    const value = record[key];
    if (typeof value !== 'boolean') throw new Error(MALFORMED_OUTPUT_ERROR);
    return value;
}

function assertKnownKeys(record: Record<string, unknown>, allowed: string[]): void {
    const allowedKeys = new Set(allowed);
    for (const key of Object.keys(record)) {
        if (!allowedKeys.has(key)) throw new Error(MALFORMED_OUTPUT_ERROR);
    }
}

function assertEvidenceRefsWereProvided(refs: string[], allowedEvidenceRefs: Set<string> | null): void {
    if (!allowedEvidenceRefs) return;
    for (const ref of refs) {
        if (!allowedEvidenceRefs.has(ref)) throw new Error(UNPROVIDED_EVIDENCE_REF_ERROR);
    }
}

function listForbiddenFields(value: unknown, path = ''): string[] {
    if (!value || typeof value !== 'object') return [];
    const found: string[] = [];
    if (Array.isArray(value)) {
        value.forEach((item, index) => {
            found.push(...listForbiddenFields(item, `${path}[${index}]`));
        });
        return found;
    }
    for (const [key, nested] of Object.entries(value as Record<string, unknown>)) {
        const keyPath = path ? `${path}.${key}` : key;
        if (FORBIDDEN_OUTPUT_FIELDS.has(key)) found.push(keyPath);
        found.push(...listForbiddenFields(nested, keyPath));
    }
    return found;
}
