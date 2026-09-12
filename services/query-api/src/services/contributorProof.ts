import crypto from 'crypto';
import { PublicKey } from '@solana/web3.js';
import type { PrismaClient } from '@prisma/client';
import { canonicalSolanaPublicKeyString } from './identity/solanaPublicKey';
import {
    getDraftAnchorsByPostId,
    getDraftAnchorById,
    verifyDraftAnchor,
    type DraftAnchorCanonicalPayload,
} from './draftAnchor';

const TOTAL_WEIGHT_BPS = 10_000;
const AUTHOR_SHARE_BPS = 5_000;
const MIN_DISCUSSANT_SCORE = 0;

const ROLE_CODE = {
    Author: 0,
    Discussant: 1,
} as const;

export type DraftContributorRole = keyof typeof ROLE_CODE;

export interface DraftContributor {
    pubkey: string;
    role: DraftContributorRole;
    weightBps: number;
    leafHex: string;
}

export interface DraftContributorProofRecord {
    draftPostId: number;
    circleId: number;
    anchorId: string;
    payloadHash: string;
    summaryHash: string;
    messagesDigest: string;
    rootHex: string;
    count: number;
    contributors: DraftContributor[];
}

export function sortDraftContributorsCanonical(
    contributors: DraftContributor[],
): DraftContributor[] {
    return [...contributors].sort((a, b) => {
        const roleDelta = ROLE_CODE[a.role] - ROLE_CODE[b.role];
        if (roleDelta !== 0) return roleDelta;
        return a.pubkey.localeCompare(b.pubkey);
    });
}

export class DraftContributorProofError extends Error {
    constructor(
        public readonly code: string,
        public readonly statusCode: number,
        message?: string,
    ) {
        super(message || code);
        this.name = 'DraftContributorProofError';
    }
}

export interface LoadedAnchorForContributorProof {
    anchorId: string;
    payloadHash: string;
    canonicalPayload: DraftAnchorCanonicalPayload | null;
    proof: {
        verifiable: boolean;
    };
}

interface LoadedDraftPostForContributorProof {
    id: number;
    circleId: number | null;
    authorPubkey: string | null;
    contentType?: string | null;
}

export function selectVerifiableContributorProofAnchor(
    anchors: LoadedAnchorForContributorProof[],
): LoadedAnchorForContributorProof | null {
    return anchors.find((anchor) => anchor.canonicalPayload && anchor.proof.verifiable) || null;
}

function sha256Bytes(input: Uint8Array): Uint8Array {
    return crypto.createHash('sha256').update(input).digest();
}

function sha256Hex(input: Uint8Array): string {
    return Buffer.from(sha256Bytes(input)).toString('hex');
}

function clampScore(value: number): number {
    if (!Number.isFinite(value)) return 0;
    return Math.max(0, Math.min(1, value));
}

function isValidPubkey(value: string | null | undefined): value is string {
    return canonicalSolanaPublicKeyString(value) !== null;
}

function isAiGeneratedDraftContentType(value: string | null | undefined): boolean {
    return String(value || '').trim().toLowerCase() === 'ai/discussion-draft';
}

function normalizeAnchorIdHex(value: string): string {
    const normalized = String(value || '').trim().toLowerCase();
    if (!/^[a-f0-9]{64}$/.test(normalized)) {
        throw new DraftContributorProofError('invalid_anchor_id', 400, 'invalid_anchor_id');
    }
    return normalized;
}

function encodeU16LE(value: number): Uint8Array {
    const view = new DataView(new ArrayBuffer(2));
    view.setUint16(0, value, true);
    return new Uint8Array(view.buffer);
}

function encodeContributorLeaf(input: {
    pubkey: string;
    role: DraftContributorRole;
    weightBps: number;
}): Uint8Array {
    const pubkeyBytes = new PublicKey(input.pubkey).toBytes();
    const payload = Buffer.concat([
        Buffer.from(pubkeyBytes),
        Buffer.from([ROLE_CODE[input.role]]),
        Buffer.from(encodeU16LE(input.weightBps)),
    ]);
    return sha256Bytes(payload);
}

function buildMerkleRoot(leafHashes: Uint8Array[]): Uint8Array {
    if (leafHashes.length === 0) {
        throw new DraftContributorProofError(
            'draft_contributors_empty',
            409,
            'draft contributor list is empty',
        );
    }

    let level = [...leafHashes];
    while (level.length > 1) {
        const next: Uint8Array[] = [];
        for (let i = 0; i < level.length; i += 2) {
            const left = level[i];
            const right = level[i + 1] || level[i];
            next.push(sha256Bytes(Buffer.concat([Buffer.from(left), Buffer.from(right)])));
        }
        level = next;
    }
    return level[0];
}

function distributeWeightBps(totalBps: number, scores: number[]): number[] {
    if (scores.length === 0 || totalBps <= 0) return [];
    const sum = scores.reduce((acc, value) => acc + value, 0);
    if (sum <= 0) {
        const base = Math.floor(totalBps / scores.length);
        const remainder = totalBps - (base * scores.length);
        return scores.map((_, index) => base + (index < remainder ? 1 : 0));
    }

    const exact = scores.map((value) => (value / sum) * totalBps);
    const base = exact.map((value) => Math.floor(value));
    let remainder = totalBps - base.reduce((acc, value) => acc + value, 0);
    const order = exact
        .map((value, index) => ({
            index,
            fractional: value - Math.floor(value),
        }))
        .sort((a, b) => {
            if (b.fractional !== a.fractional) return b.fractional - a.fractional;
            return a.index - b.index;
        });

    let cursor = 0;
    while (remainder > 0) {
        const target = order[cursor % order.length];
        base[target.index] += 1;
        remainder -= 1;
        cursor += 1;
    }

    return base;
}

export function buildDraftContributorProof(input: {
    draftPostId: number;
    draftAuthorPubkey: string | null;
    anchorId: string;
    payloadHash: string;
    canonicalPayload: DraftAnchorCanonicalPayload;
}): DraftContributorProofRecord {
    if (input.canonicalPayload.draftPostId !== input.draftPostId) {
        throw new DraftContributorProofError(
            'draft_anchor_post_mismatch',
            409,
            'draft anchor payload does not match draft post id',
        );
    }

    const discussantScores = new Map<string, number>();
    for (const message of input.canonicalPayload.messages || []) {
        if (!isValidPubkey(message.senderPubkey)) continue;
        const normalizedScore = clampScore(message.semanticScore);
        if (normalizedScore <= MIN_DISCUSSANT_SCORE) continue;
        if (message.senderPubkey === input.draftAuthorPubkey) continue;
        discussantScores.set(
            message.senderPubkey,
            (discussantScores.get(message.senderPubkey) || 0) + normalizedScore,
        );
    }

    const discussants = [...discussantScores.entries()]
        .map(([pubkey, score]) => ({ pubkey, score }))
        .sort((a, b) => a.pubkey.localeCompare(b.pubkey));

    const hasAuthor = isValidPubkey(input.draftAuthorPubkey);
    const authorWeight = hasAuthor
        ? (discussants.length > 0 ? AUTHOR_SHARE_BPS : TOTAL_WEIGHT_BPS)
        : 0;
    const discussantWeights = distributeWeightBps(
        TOTAL_WEIGHT_BPS - authorWeight,
        discussants.map((item) => item.score),
    );

    const contributors: DraftContributor[] = [];
    if (hasAuthor) {
        contributors.push({
            pubkey: input.draftAuthorPubkey as string,
            role: 'Author',
            weightBps: authorWeight,
            leafHex: '',
        });
    }
    discussants.forEach((item, index) => {
        contributors.push({
            pubkey: item.pubkey,
            role: 'Discussant',
            weightBps: discussantWeights[index] || 0,
            leafHex: '',
        });
    });

    if (contributors.length === 0) {
        throw new DraftContributorProofError(
            'draft_contributors_empty',
            409,
            'draft contributor list is empty',
        );
    }

    const orderedContributors = sortDraftContributorsCanonical(contributors)
        .map((item) => {
            const leafHex = sha256Hex(encodeContributorLeaf(item));
            return {
                ...item,
                leafHex,
            };
        });

    const rootHex = Buffer.from(
        buildMerkleRoot(orderedContributors.map((item) => Buffer.from(item.leafHex, 'hex'))),
    ).toString('hex');

    return {
        draftPostId: input.draftPostId,
        circleId: input.canonicalPayload.circleId,
        anchorId: input.anchorId,
        payloadHash: input.payloadHash,
        summaryHash: input.canonicalPayload.summaryHash,
        messagesDigest: input.canonicalPayload.messagesDigest,
        rootHex,
        count: orderedContributors.length,
        contributors: orderedContributors,
    };
}

export function buildDraftContributorProofFromContributors(input: {
    draftPostId: number;
    circleId: number;
    anchorId: string;
    payloadHash: string;
    summaryHash: string;
    messagesDigest: string;
    contributors: Array<{
        pubkey: string;
        role: DraftContributorRole;
        weightBps: number;
    }>;
}): DraftContributorProofRecord {
    if (!Number.isInteger(input.draftPostId) || input.draftPostId <= 0) {
        throw new DraftContributorProofError('invalid_draft_post_id', 400, 'invalid_draft_post_id');
    }
    if (!Number.isInteger(input.circleId) || input.circleId <= 0) {
        throw new DraftContributorProofError('invalid_circle_id', 400, 'invalid_circle_id');
    }
    const anchorId = normalizeAnchorIdHex(input.anchorId);
    const payloadHash = normalizeAnchorIdHex(input.payloadHash);
    const summaryHash = normalizeAnchorIdHex(input.summaryHash);
    const messagesDigest = normalizeAnchorIdHex(input.messagesDigest);

    const contributors = input.contributors.map((item) => {
        if (!isValidPubkey(item.pubkey)) {
            throw new DraftContributorProofError('invalid_contributor_pubkey', 400, 'invalid_contributor_pubkey');
        }
        if (item.role !== 'Author' && item.role !== 'Discussant') {
            throw new DraftContributorProofError('invalid_contributor_role', 400, 'invalid_contributor_role');
        }
        if (!Number.isInteger(item.weightBps) || item.weightBps <= 0 || item.weightBps > TOTAL_WEIGHT_BPS) {
            throw new DraftContributorProofError('invalid_contributor_weight', 400, 'invalid_contributor_weight');
        }
        return {
            pubkey: item.pubkey,
            role: item.role,
            weightBps: item.weightBps,
            leafHex: '',
        };
    });
    const totalWeight = contributors.reduce((sum, item) => sum + item.weightBps, 0);
    if (totalWeight !== TOTAL_WEIGHT_BPS) {
        throw new DraftContributorProofError(
            'invalid_contributor_weight_total',
            400,
            'contributor weights must sum to 10000 bps',
        );
    }

    const seen = new Set<string>();
    const seenPubkeys = new Set<string>();
    for (const contributor of contributors) {
        const key = `${contributor.role}:${contributor.pubkey}`;
        if (seen.has(key)) {
            throw new DraftContributorProofError(
                'duplicate_contributor_leaf',
                400,
                'duplicate contributor leaf',
            );
        }
        seen.add(key);
        if (seenPubkeys.has(contributor.pubkey)) {
            throw new DraftContributorProofError(
                'duplicate_contributor_pubkey',
                400,
                'canonical contributor proof requires one leaf per pubkey',
            );
        }
        seenPubkeys.add(contributor.pubkey);
    }

    const orderedContributors = sortDraftContributorsCanonical(contributors)
        .map((item) => ({
            ...item,
            leafHex: sha256Hex(encodeContributorLeaf(item)),
        }));
    const rootHex = Buffer.from(
        buildMerkleRoot(orderedContributors.map((item) => Buffer.from(item.leafHex, 'hex'))),
    ).toString('hex');

    return {
        draftPostId: input.draftPostId,
        circleId: input.circleId,
        anchorId,
        payloadHash,
        summaryHash,
        messagesDigest,
        rootHex,
        count: orderedContributors.length,
        contributors: orderedContributors,
    };
}

export function validateDraftContributorProofRecord(
    proof: DraftContributorProofRecord,
    expected?: {
        draftPostId?: number;
        circleId?: number;
        anchorId?: string;
    },
): DraftContributorProofRecord {
    if (!proof || typeof proof !== 'object' || !Array.isArray(proof.contributors)) {
        throw new DraftContributorProofError(
            'invalid_contributor_proof',
            400,
            'invalid contributor proof',
        );
    }
    if (
        expected?.draftPostId !== undefined
        && proof.draftPostId !== expected.draftPostId
    ) {
        throw new DraftContributorProofError(
            'draft_contributor_proof_post_mismatch',
            409,
            'prepared contributor proof does not match draft post id',
        );
    }
    if (
        expected?.circleId !== undefined
        && proof.circleId !== expected.circleId
    ) {
        throw new DraftContributorProofError(
            'draft_contributor_proof_circle_mismatch',
            409,
            'prepared contributor proof does not match circle id',
        );
    }
    if (
        expected?.anchorId !== undefined
        && normalizeAnchorIdHex(proof.anchorId) !== normalizeAnchorIdHex(expected.anchorId)
    ) {
        throw new DraftContributorProofError(
            'draft_contributor_proof_anchor_mismatch',
            409,
            'prepared contributor proof does not match source anchor id',
        );
    }

    const canonical = buildDraftContributorProofFromContributors({
        draftPostId: proof.draftPostId,
        circleId: proof.circleId,
        anchorId: proof.anchorId,
        payloadHash: proof.payloadHash,
        summaryHash: proof.summaryHash,
        messagesDigest: proof.messagesDigest,
        contributors: proof.contributors.map((contributor) => ({
            pubkey: contributor.pubkey,
            role: contributor.role,
            weightBps: contributor.weightBps,
        })),
    });

    if (proof.count !== canonical.count || proof.count !== proof.contributors.length) {
        throw new DraftContributorProofError(
            'invalid_contributor_count',
            400,
            'contributor proof count does not match contributor leaves',
        );
    }
    if (normalizeAnchorIdHex(proof.rootHex) !== canonical.rootHex) {
        throw new DraftContributorProofError(
            'invalid_contributors_root',
            400,
            'contributor proof root does not match contributor leaves',
        );
    }

    const canonicalLeafByKey = new Map(
        canonical.contributors.map((contributor) => [
            `${contributor.role}:${contributor.pubkey}`,
            contributor.leafHex,
        ]),
    );
    for (const contributor of proof.contributors) {
        const leafHex = normalizeAnchorIdHex(contributor.leafHex);
        const expectedLeafHex = canonicalLeafByKey.get(`${contributor.role}:${contributor.pubkey}`);
        if (!expectedLeafHex || leafHex !== expectedLeafHex) {
            throw new DraftContributorProofError(
                'invalid_contributor_leaf',
                400,
                'contributor proof leaf does not match contributor payload',
            );
        }
    }

    return canonical;
}

export async function loadDraftContributorProof(input: {
    draftPostId: number;
    loadLatestAnchor: (draftPostId: number) => Promise<LoadedAnchorForContributorProof | null>;
    loadDraftPost: (draftPostId: number) => Promise<LoadedDraftPostForContributorProof | null>;
}): Promise<DraftContributorProofRecord> {
    const draft = await input.loadDraftPost(input.draftPostId);
    if (!draft) {
        throw new DraftContributorProofError('draft_not_found', 404, 'draft_not_found');
    }
    if (!draft.circleId) {
        throw new DraftContributorProofError('draft_not_circle_bound', 409, 'draft_not_circle_bound');
    }

    const anchor = await input.loadLatestAnchor(input.draftPostId);
    if (!anchor) {
        throw new DraftContributorProofError('draft_anchor_not_found', 404, 'draft_anchor_not_found');
    }
    if (!anchor.canonicalPayload || !anchor.proof.verifiable) {
        throw new DraftContributorProofError(
            'draft_anchor_unverifiable',
            409,
            'draft_anchor_unverifiable',
        );
    }
    if (anchor.canonicalPayload.circleId !== draft.circleId) {
        throw new DraftContributorProofError(
            'draft_anchor_circle_mismatch',
            409,
            'draft_anchor_circle_mismatch',
        );
    }

    // AI-generated discussion drafts store an operator/creator on Post.author for ownership,
    // but that identity is trace context, not direct author contribution.
    const directAuthorPubkey = isAiGeneratedDraftContentType(draft.contentType)
        ? null
        : draft.authorPubkey;

    return buildDraftContributorProof({
        draftPostId: input.draftPostId,
        draftAuthorPubkey: directAuthorPubkey,
        anchorId: anchor.anchorId,
        payloadHash: anchor.payloadHash,
        canonicalPayload: anchor.canonicalPayload,
    });
}

export async function getDraftContributorProof(
    prisma: PrismaClient,
    draftPostId: number,
    options?: {
        anchorId?: string;
    },
): Promise<DraftContributorProofRecord> {
    const requestedAnchorId = options?.anchorId
        ? normalizeAnchorIdHex(options.anchorId)
        : null;

    return loadDraftContributorProof({
        draftPostId,
        loadLatestAnchor: async (postId) => {
            if (requestedAnchorId) {
                const anchor = await getDraftAnchorById(prisma, requestedAnchorId);
                if (!anchor || anchor.draftPostId !== postId) return null;
                return {
                    anchorId: anchor.anchorId,
                    payloadHash: anchor.payloadHash,
                    canonicalPayload: anchor.canonicalPayload,
                    proof: verifyDraftAnchor(anchor),
                };
            }

            const anchors = await getDraftAnchorsByPostId(prisma, postId, 20);
            return selectVerifiableContributorProofAnchor(anchors.map((anchor) => ({
                anchorId: anchor.anchorId,
                payloadHash: anchor.payloadHash,
                canonicalPayload: anchor.canonicalPayload,
                proof: verifyDraftAnchor(anchor),
            })));
        },
        loadDraftPost: async (postId) => {
            const post = await prisma.post.findUnique({
                where: { id: postId },
                select: {
                    id: true,
                    circleId: true,
                    contentType: true,
                    author: {
                        select: {
                            pubkey: true,
                        },
                    },
                },
            });

            if (!post) return null;
            return {
                id: post.id,
                circleId: post.circleId,
                authorPubkey: post.author?.pubkey || null,
                contentType: post.contentType,
            };
        },
    });
}
