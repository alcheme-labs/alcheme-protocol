import type { CollabEditAnchorRecord } from '../collabEditAnchor';

export type DeterministicEditImpact =
    | 'none'
    | 'punctuation_only'
    | 'style_or_minor'
    | 'semantic_or_structural';

function normalizeWhitespace(value: string): string {
    return String(value ?? '').replace(/\s+/g, ' ').trim();
}

function stripPunctuation(value: string): string {
    return normalizeWhitespace(value)
        .replace(/[!"#$%&'()*+,\-./:;<=>?@[\\\]^_`{|}~，。！？、；：“”‘’（）【】《》]/g, '')
        .toLowerCase();
}

function normalizeForStyle(value: string): string {
    return normalizeWhitespace(value).toLowerCase();
}

export function classifyDeterministicEditImpact(input: {
    before: string;
    after: string;
}): DeterministicEditImpact {
    const before = String(input.before ?? '');
    const after = String(input.after ?? '');
    if (before === after) return 'none';
    if (stripPunctuation(before) === stripPunctuation(after)) return 'punctuation_only';
    if (normalizeForStyle(before) === normalizeForStyle(after)) return 'style_or_minor';

    const beforeWords = new Set(stripPunctuation(before).split(/\s+/).filter(Boolean));
    const afterWords = new Set(stripPunctuation(after).split(/\s+/).filter(Boolean));
    if (beforeWords.size === 0 || afterWords.size === 0) return 'semantic_or_structural';
    let shared = 0;
    for (const word of beforeWords) {
        if (afterWords.has(word)) shared += 1;
    }
    const overlap = shared / Math.max(beforeWords.size, afterWords.size);
    return overlap >= 0.85 ? 'style_or_minor' : 'semantic_or_structural';
}

export function isLifecycleFallbackCollabAnchor(input: {
    anchor: Pick<CollabEditAnchorRecord, 'draftPostId' | 'roomKey' | 'updateCount' | 'snapshotHash' | 'canonicalPayload'>;
    stableSnapshot: {
        draftVersion: number;
        contentHash: string;
        contentSnapshot?: string | null;
    };
}): boolean {
    const payload = input.anchor.canonicalPayload;
    if (!payload) return false;
    if (payload.anchorType !== 'collab_edit_batch') return false;
    if (input.anchor.roomKey !== `crucible-${input.anchor.draftPostId}`) return false;
    if (input.anchor.updateCount !== 1 || payload.updateCount !== 1) return false;
    if (String(input.anchor.snapshotHash).toLowerCase() !== String(input.stableSnapshot.contentHash).toLowerCase()) {
        return false;
    }
    const update = payload.updates[0];
    if (!update) return false;
    if (Number(update.seq) !== Number(input.stableSnapshot.draftVersion)) return false;
    if (String(update.updateHash).toLowerCase() !== String(input.stableSnapshot.contentHash).toLowerCase()) {
        return false;
    }
    if (typeof input.stableSnapshot.contentSnapshot === 'string') {
        const expectedBytes = Buffer.byteLength(input.stableSnapshot.contentSnapshot, 'utf8');
        if (Number(update.updateBytes) !== expectedBytes) return false;
    }
    return true;
}

export function shouldRetainEvidenceForFinalAllocation(input: {
    retention: 'retained' | 'trace_only' | 'excluded';
    isLifecycleFallbackAnchor?: boolean;
}): boolean {
    if (input.isLifecycleFallbackAnchor) return false;
    return input.retention === 'retained';
}
