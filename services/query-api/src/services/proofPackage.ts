import crypto from 'crypto';
import { PublicKey } from '@solana/web3.js';

import type {
    DraftContributorProofRecord,
    DraftContributorRole,
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

function normalizePublicKey(value: unknown): string {
    if (typeof value !== 'string' || !value.trim()) {
        throw new Error('invalid_proof_package');
    }
    try {
        return new PublicKey(value.trim()).toBase58();
    } catch {
        throw new Error('invalid_proof_package');
    }
}

function normalizeContributorRole(value: unknown): DraftContributorRole {
    if (value === 'Author' || value === 'Discussant') {
        return value;
    }
    throw new Error('invalid_proof_package');
}

function normalizeWeightBps(value: unknown): number {
    if (
        typeof value !== 'number'
        || !Number.isFinite(value)
        || !Number.isInteger(value)
        || value <= 0
        || value > 10_000
    ) {
        throw new Error('invalid_proof_package');
    }
    return value;
}

function normalizePositiveU16(value: unknown): number {
    if (
        typeof value !== 'number'
        || !Number.isFinite(value)
        || !Number.isInteger(value)
        || value <= 0
        || value > 65_535
    ) {
        throw new Error('invalid_proof_package');
    }
    return value;
}

function normalizeDiscussionResolutionRefs(refs: string[] | undefined): string[] {
    return [...new Set(
        (refs || [])
            .map((item) => String(item || '').trim())
            .filter((item) => item.length > 0),
    )].sort((a, b) => a.localeCompare(b));
}

function isPlainRecord(value: unknown): value is Record<string, unknown> {
    return Boolean(value) && typeof value === 'object' && !Array.isArray(value);
}

export function normalizeCanonicalProofPackageV2(input: unknown): CanonicalProofPackageV2 {
    if (!isPlainRecord(input)) {
        throw new Error('invalid_proof_package');
    }
    if (input.schema_version !== PROOF_PACKAGE_SCHEMA_VERSION) {
        throw new Error('invalid_proof_package');
    }
    if (!Array.isArray(input.contributors)) {
        throw new Error('invalid_proof_package');
    }
    if (!Array.isArray(input.discussion_resolution_refs)) {
        throw new Error('invalid_proof_package');
    }

    const seenPubkeys = new Set<string>();
    const contributors = sortDraftContributorsCanonical(input.contributors.map((raw) => {
        if (!isPlainRecord(raw)) {
            throw new Error('invalid_proof_package');
        }
        const pubkey = normalizePublicKey(raw.pubkey);
        if (seenPubkeys.has(pubkey)) {
            throw new Error('invalid_proof_package');
        }
        seenPubkeys.add(pubkey);
        return {
            pubkey,
            role: normalizeContributorRole(raw.role),
            weightBps: normalizeWeightBps(raw.weight_bps),
            leafHex: normalizeHex64(String(raw.leaf_hex || '')),
        };
    })).map((contributor) => ({
        pubkey: contributor.pubkey,
        role: contributor.role,
        weight_bps: contributor.weightBps,
        leaf_hex: contributor.leafHex,
    }));
    const count = normalizePositiveU16(input.count);
    if (contributors.length !== count) {
        throw new Error('invalid_proof_package');
    }
    const totalWeight = contributors.reduce((sum, contributor) => sum + contributor.weight_bps, 0);
    if (totalWeight !== 10_000) {
        throw new Error('invalid_proof_package');
    }

    return {
        schema_version: PROOF_PACKAGE_SCHEMA_VERSION,
        draft_anchor: normalizeHex64(String(input.draft_anchor || '')),
        collab_edit_anchor: normalizeHex64(String(input.collab_edit_anchor || '')),
        contributors,
        root: normalizeHex64(String(input.root || '')),
        count,
        discussion_resolution_refs: normalizeDiscussionResolutionRefs(
            input.discussion_resolution_refs.map((item) => String(item || '')),
        ),
        generated_at: normalizeIsoTimestamp(String(input.generated_at || '')),
    };
}

export function hashCanonicalProofPackageV2(input: unknown): string {
    return hashCanonicalPackage(normalizeCanonicalProofPackageV2(input));
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
        proof_package_hash: hashCanonicalProofPackageV2(canonicalPackage),
    };
}
