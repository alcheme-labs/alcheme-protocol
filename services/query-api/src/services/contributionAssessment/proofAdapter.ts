import {
    buildDraftContributorProofFromContributors,
    type DraftContributorProofRecord,
} from '../contributorProof';
import type {
    CanonicalContributionAllocation,
    ContributionEvidencePackage,
} from './types';

export function buildDraftContributorProofFromCanonicalAllocation(input: {
    evidence: ContributionEvidencePackage;
    allocation: CanonicalContributionAllocation;
}): DraftContributorProofRecord {
    if (!input.evidence.sourceAnchor) {
        throw new Error('source_anchor_required_for_contributor_proof');
    }
    if (input.evidence.draftPostId !== input.allocation.draftPostId) {
        throw new Error('allocation_draft_mismatch');
    }
    if (input.evidence.circleId !== input.allocation.circleId) {
        throw new Error('allocation_circle_mismatch');
    }
    return buildDraftContributorProofFromContributors({
        draftPostId: input.evidence.draftPostId,
        circleId: input.evidence.circleId,
        anchorId: input.evidence.sourceAnchor.anchorId,
        payloadHash: input.evidence.sourceAnchor.payloadHash,
        summaryHash: input.evidence.sourceAnchor.summaryHash,
        messagesDigest: input.evidence.sourceAnchor.sourceMessagesDigest,
        contributors: input.allocation.contributors.map((contributor) => ({
            pubkey: contributor.pubkey,
            role: contributor.proofRole,
            weightBps: contributor.weightBps,
        })),
    });
}
