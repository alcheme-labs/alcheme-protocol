import crypto from 'crypto';

import type {
    DraftContributorProofRecord,
} from './contributorProof';
import {
    sortDraftContributorsCanonical,
} from './contributorProof';

export const PROOF_PACKAGE_SCHEMA_VERSION = 2 as const;
export const PROOF_PACKAGE_BINDING_VERSION = 2 as const;

export interface CanonicalProofPackageContributor {
    pubkey: string;
    role: 'Author' | 'Discussant';
    weight_bps: number;
    leaf_hex: string;
}

export interface CanonicalProofPackageV2 {
    schema_version: typeof PROOF_PACKAGE_SCHEMA_VERSION;
    draft_anchor: string;
    collab_edit_anchor: string;
    contributors: CanonicalProofPackageContributor[];
    root: string;
    count: number;
    discussion_resolution_refs: string[];
    generated_at: string;
}

export interface BuildProofPackageInput {
    contributorProof: DraftContributorProofRecord;
    collabEditAnchorId: string;
    discussionResolutionRefs?: string[];
    generatedAt?: Date | string;
}

export interface BuildProofPackageResult {
    canonical_proof_package: CanonicalProofPackageV2;
    proof_package_hash: string;
}

function normalizeIsoTimestamp(value: Date | string | undefined): string {
    if (!value) {
        return new Date().toISOString();
    }
    const date = value instanceof Date ? value : new Date(value);
    if (Number.isNaN(date.getTime())) {
        throw new Error('invalid_generated_at');
    }
    return date.toISOString();
}

function normalizeHex64(value: string): string {
    const normalized = String(value || '').trim().toLowerCase();
    if (!/^[a-f0-9]{64}$/.test(normalized)) {
        throw new Error('invalid_hex_64');
    }
    return normalized;
}

function hashCanonicalPackage(pkg: CanonicalProofPackageV2): string {
    return crypto
        .createHash('sha256')
        .update(JSON.stringify(pkg))
        .digest('hex');
}

function normalizeDiscussionResolutionRefs(refs: string[] | undefined): string[] {
    return [...new Set(
        (refs || [])
            .map((item) => String(item || '').trim())
            .filter((item) => item.length > 0),
    )].sort((a, b) => a.localeCompare(b));
}

export function buildCanonicalProofPackageV2(input: BuildProofPackageInput): BuildProofPackageResult {
    const contributorProof = input.contributorProof;
    const sortedContributors = sortDraftContributorsCanonical(contributorProof.contributors)
        .map((contributor) => ({
            pubkey: contributor.pubkey,
            role: contributor.role,
            weight_bps: contributor.weightBps,
            leaf_hex: normalizeHex64(contributor.leafHex),
        }));

    const canonicalPackage: CanonicalProofPackageV2 = {
        schema_version: PROOF_PACKAGE_SCHEMA_VERSION,
        draft_anchor: String(contributorProof.anchorId || '').trim().toLowerCase(),
        collab_edit_anchor: String(input.collabEditAnchorId || '').trim().toLowerCase(),
        contributors: sortedContributors,
        root: normalizeHex64(contributorProof.rootHex),
        count: contributorProof.count,
        discussion_resolution_refs: normalizeDiscussionResolutionRefs(input.discussionResolutionRefs),
        generated_at: normalizeIsoTimestamp(input.generatedAt),
    };

    if (!/^[a-f0-9]{64}$/.test(canonicalPackage.draft_anchor)) {
        throw new Error('invalid_draft_anchor');
    }
    if (!/^[a-f0-9]{64}$/.test(canonicalPackage.collab_edit_anchor)) {
        throw new Error('invalid_collab_edit_anchor');
    }
    if (!Number.isFinite(canonicalPackage.count) || canonicalPackage.count <= 0) {
        throw new Error('invalid_contributor_count');
    }

    return {
        canonical_proof_package: canonicalPackage,
        proof_package_hash: hashCanonicalPackage(canonicalPackage),
    };
}
