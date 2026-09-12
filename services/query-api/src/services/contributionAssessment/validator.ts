import {
    CONTRIBUTION_ASSESSMENT_SCHEMA_VERSION,
    TOTAL_CONTRIBUTION_WEIGHT_BPS,
    type ContributionAssessmentDecisionRecord,
    type ContributionAssessmentSuggestion,
    type ContributionEvidencePackage,
    type ContributionEvidenceRef,
    type ContributionStage,
    type ContributionType,
} from './types';

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

export class ContributionAssessmentValidationError extends Error {
    constructor(
        public readonly code: string,
        message?: string,
        public readonly details?: Record<string, unknown>,
    ) {
        super(message || code);
        this.name = 'ContributionAssessmentValidationError';
    }
}

const CONTRIBUTION_TYPE_TO_STAGE: Record<ContributionType, ContributionStage> = {
    source_discussion: 'source_discussion',
    direct_authoring: 'direct_author',
    curation: 'source_selection',
    semantic_edit: 'draft_modification',
    style_edit: 'draft_modification',
    review_issue: 'review_correction',
    review_solution: 'review_correction',
};

function isContributionType(value: unknown): value is ContributionType {
    return typeof value === 'string' && Object.prototype.hasOwnProperty.call(CONTRIBUTION_TYPE_TO_STAGE, value);
}

function assert(condition: unknown, code: string, details?: Record<string, unknown>): asserts condition {
    if (!condition) {
        throw new ContributionAssessmentValidationError(code, code, details);
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

function normalizeDecisionByCandidate(
    decisions: ContributionAssessmentDecisionRecord[] | undefined,
): Map<string, ContributionAssessmentDecisionRecord> {
    const result = new Map<string, ContributionAssessmentDecisionRecord>();
    for (const decision of decisions ?? []) {
        const candidateId = String(decision.candidateId || '').trim();
        if (!candidateId) continue;
        result.set(candidateId, decision);
    }
    return result;
}

function getAssessmentLevelHighPenetrationDecision(
    decisions: ContributionAssessmentDecisionRecord[] | undefined,
): ContributionAssessmentDecisionRecord | null {
    for (const decision of decisions ?? []) {
        const candidateId = String(decision.candidateId || '').trim();
        if (candidateId) continue;
        if (
            decision.decisionType === 'confirm_high_penetration'
            || decision.decisionType === 'continue_with_fallback'
            || decision.decisionType === 'reject_high_penetration'
        ) {
            return decision;
        }
    }
    return null;
}

function resolveHighPenetrationDecision(input: {
    decisionsByCandidate: Map<string, ContributionAssessmentDecisionRecord>;
    assessmentLevelDecision: ContributionAssessmentDecisionRecord | null;
    candidateId: string | null;
}): ContributionAssessmentDecisionRecord | null {
    if (input.candidateId) {
        return input.decisionsByCandidate.get(input.candidateId) ?? input.assessmentLevelDecision;
    }
    return input.assessmentLevelDecision;
}

function assertEvidenceMatchesContribution(input: {
    evidence: ContributionEvidencePackage;
    allocationId: string;
    pubkey: string;
    contributionType: ContributionType;
    refs: ContributionEvidenceRef[];
}): void {
    const expectedStage = CONTRIBUTION_TYPE_TO_STAGE[input.contributionType];
    if (input.contributionType === 'direct_authoring' && input.evidence.draftOrigin !== 'direct_human') {
        throw new ContributionAssessmentValidationError('direct_authoring_not_allowed_for_ai_draft', undefined, {
            allocationId: input.allocationId,
            draftOrigin: input.evidence.draftOrigin,
        });
    }
    for (const ref of input.refs) {
        if (ref.stage !== null && ref.stage !== expectedStage) {
            throw new ContributionAssessmentValidationError('evidence_stage_contribution_type_mismatch', undefined, {
                allocationId: input.allocationId,
                refId: ref.refId,
                refStage: ref.stage,
                contributionType: input.contributionType,
                expectedStage,
            });
        }
        if (ref.contributorPubkey !== null && ref.contributorPubkey !== input.pubkey) {
            throw new ContributionAssessmentValidationError('evidence_ref_contributor_mismatch', undefined, {
                allocationId: input.allocationId,
                refId: ref.refId,
                refPubkey: ref.contributorPubkey,
                allocationPubkey: input.pubkey,
            });
        }
    }
    const retainedContributorEvidence = input.refs.some((ref) =>
        ref.retention === 'retained'
        && ref.stage === expectedStage
        && ref.contributorPubkey === input.pubkey
    );
    if (!retainedContributorEvidence) {
        throw new ContributionAssessmentValidationError('allocation_missing_retained_contributor_evidence', undefined, {
            allocationId: input.allocationId,
            contributionType: input.contributionType,
            expectedStage,
        });
    }
}

export function validateContributionAssessmentSuggestion(input: {
    evidence: ContributionEvidencePackage;
    suggestion: ContributionAssessmentSuggestion;
    expectedInputHash?: string;
    decisions?: ContributionAssessmentDecisionRecord[];
}): void {
    const evidenceContributorPubkeys = new Set(input.evidence.contributors.map((item) => item.pubkey));
    const evidenceRefs = new Map(input.evidence.evidenceRefs.map((item) => [item.refId, item]));
    const forbiddenFields = listForbiddenFields(input.suggestion);
    assert(forbiddenFields.length === 0, 'assessment_output_contains_forbidden_fields', { forbiddenFields });
    assert(input.suggestion.schemaVersion === CONTRIBUTION_ASSESSMENT_SCHEMA_VERSION, 'invalid_schema_version');
    assert(input.suggestion.provider === 'disabled' || input.suggestion.provider === 'mock' || input.suggestion.provider === 'ai', 'invalid_provider');
    assert(input.suggestion.algorithmVersion.trim().length > 0, 'missing_algorithm_version');
    assert(input.suggestion.framePolicyVersion.trim().length > 0, 'missing_frame_policy_version');
    if (input.expectedInputHash !== undefined) {
        assert(input.suggestion.inputHash === input.expectedInputHash, 'input_hash_mismatch');
    }
    assert(
        Number.isFinite(input.suggestion.confidence)
        && input.suggestion.confidence >= 0
        && input.suggestion.confidence <= 1,
        'invalid_confidence',
    );

    const frameTotal = input.suggestion.frames.reduce((sum, frame) => sum + Number(frame.weightBps || 0), 0);
    assert(frameTotal === TOTAL_CONTRIBUTION_WEIGHT_BPS, 'frame_weight_total_invalid', { frameTotal });

    const frameIds = new Set<string>();
    for (const frame of input.suggestion.frames) {
        assert(frame.frameId.trim().length > 0, 'missing_frame_id');
        assert(!frameIds.has(frame.frameId), 'duplicate_frame_id', { frameId: frame.frameId });
        frameIds.add(frame.frameId);
    }

    const allocationIds = new Set<string>();
    const reviewRequiredAllocationIds = new Set<string>();
    for (const frame of input.suggestion.frames) {
        assert(Number.isInteger(frame.weightBps) && frame.weightBps >= 0, 'invalid_frame_weight', {
            frameId: frame.frameId,
        });
        const allocationTotal = frame.allocations.reduce((sum, allocation) => sum + Number(allocation.weightBps || 0), 0);
        assert(allocationTotal === frame.weightBps, 'allocation_weight_total_invalid', {
            frameId: frame.frameId,
            allocationTotal,
            frameWeight: frame.weightBps,
        });
        for (const allocation of frame.allocations) {
            assert(allocation.allocationId.trim().length > 0, 'missing_allocation_id');
            assert(!allocationIds.has(allocation.allocationId), 'duplicate_allocation_id', {
                allocationId: allocation.allocationId,
            });
            allocationIds.add(allocation.allocationId);
            assert(evidenceContributorPubkeys.has(allocation.pubkey), 'unknown_contributor_pubkey', {
                pubkey: allocation.pubkey,
            });
            assert(isContributionType(allocation.contributionType), 'invalid_contribution_type', {
                allocationId: allocation.allocationId,
                contributionType: allocation.contributionType,
            });
            assert(Number.isInteger(allocation.weightBps) && allocation.weightBps >= 0, 'invalid_allocation_weight', {
                allocationId: allocation.allocationId,
            });
            assert(allocation.evidenceRefs.length > 0, 'allocation_missing_evidence_refs', {
                allocationId: allocation.allocationId,
            });
            const allocationEvidenceRefs: ContributionEvidenceRef[] = [];
            for (const refId of allocation.evidenceRefs) {
                const ref = evidenceRefs.get(refId);
                assert(ref, 'unknown_evidence_ref', {
                    allocationId: allocation.allocationId,
                    refId,
                });
                allocationEvidenceRefs.push(ref);
            }
            assertEvidenceMatchesContribution({
                evidence: input.evidence,
                allocationId: allocation.allocationId,
                pubkey: allocation.pubkey,
                contributionType: allocation.contributionType,
                refs: allocationEvidenceRefs,
            });
            assert(
                Number.isFinite(allocation.confidence)
                && allocation.confidence >= 0
                && allocation.confidence <= 1,
                'invalid_allocation_confidence',
                { allocationId: allocation.allocationId },
            );
            assert(
                Number.isInteger(allocation.penetration.strengthBps)
                && allocation.penetration.strengthBps >= 0
                && allocation.penetration.strengthBps <= TOTAL_CONTRIBUTION_WEIGHT_BPS,
                'invalid_penetration_strength',
                { allocationId: allocation.allocationId },
            );
            if (allocation.penetration.targetFrameId !== null) {
                assert(
                    frameIds.has(allocation.penetration.targetFrameId),
                    'penetration_unknown_target_frame',
                    {
                        allocationId: allocation.allocationId,
                        targetFrameId: allocation.penetration.targetFrameId,
                    },
                );
            }
            if (
                allocation.penetration.requiresReview
                || allocation.penetration.strengthBps >= 8000
            ) {
                reviewRequiredAllocationIds.add(allocation.allocationId);
            }
        }
    }

    const decisionsByCandidate = normalizeDecisionByCandidate(input.decisions);
    const assessmentLevelDecision = getAssessmentLevelHighPenetrationDecision(input.decisions);
    const highPenetrationCandidatesByAllocation = new Map<string, string>();
    const highPenetrationCandidateIds = new Set<string>();
    for (const candidate of input.suggestion.highPenetrationCandidates) {
        assert(candidate.candidateId.trim().length > 0, 'missing_high_penetration_candidate_id');
        assert(
            !highPenetrationCandidateIds.has(candidate.candidateId),
            'duplicate_high_penetration_candidate_id',
            { candidateId: candidate.candidateId },
        );
        highPenetrationCandidateIds.add(candidate.candidateId);
        assert(allocationIds.has(candidate.sourceAllocationRef), 'high_penetration_unknown_allocation_ref', {
            candidateId: candidate.candidateId,
            sourceAllocationRef: candidate.sourceAllocationRef,
        });
        assert(frameIds.has(candidate.targetFrameId), 'high_penetration_unknown_target_frame', {
            candidateId: candidate.candidateId,
            targetFrameId: candidate.targetFrameId,
        });
        highPenetrationCandidatesByAllocation.set(candidate.sourceAllocationRef, candidate.candidateId);
        assert(
            Number.isInteger(candidate.strengthBps)
            && candidate.strengthBps >= 0
            && candidate.strengthBps <= TOTAL_CONTRIBUTION_WEIGHT_BPS,
            'invalid_high_penetration_strength',
            { candidateId: candidate.candidateId },
        );
        const decision = resolveHighPenetrationDecision({
            decisionsByCandidate,
            assessmentLevelDecision,
            candidateId: candidate.candidateId,
        });
        assert(
            decision
            && (
                decision.decisionType === 'confirm_high_penetration'
                || decision.decisionType === 'continue_with_fallback'
                || decision.decisionType === 'reject_high_penetration'
            ),
            'high_penetration_decision_required',
            { candidateId: candidate.candidateId },
        );
    }
    for (const allocationId of reviewRequiredAllocationIds) {
        const candidateId = highPenetrationCandidatesByAllocation.get(allocationId);
        const decision = resolveHighPenetrationDecision({
            decisionsByCandidate,
            assessmentLevelDecision,
            candidateId: candidateId || null,
        });
        assert(
            decision
            && (
                decision.decisionType === 'confirm_high_penetration'
                || decision.decisionType === 'continue_with_fallback'
                || decision.decisionType === 'reject_high_penetration'
            ),
            'high_penetration_decision_required',
            { allocationId, candidateId: candidateId || null },
        );
    }
}
