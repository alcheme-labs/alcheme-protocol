import crypto from 'crypto';

import type {
    AnchorPayload,
    DraftAnchorCanonicalPayload,
    DraftAnchorMessagePayload,
} from './types';

export interface DraftAnchorProofPackageInput {
    payload: DraftAnchorCanonicalPayload;
    memoPrefix: string;
}

export interface DraftAnchorProofPackage {
    canonicalPayload: DraftAnchorCanonicalPayload;
    canonicalJson: string;
    anchorPayload: AnchorPayload;
    payloadHash: string;
    anchorId: string;
    summaryHash: string;
    messagesDigest: string;
    memoText: string;
}

export function sha256Hex(input: string): string {
    return crypto.createHash('sha256').update(input).digest('hex');
}

function stableSortValue(input: unknown): unknown {
    if (Array.isArray(input)) {
        return input.map(stableSortValue);
    }
    if (input && typeof input === 'object') {
        const record = input as Record<string, unknown>;
        const sorted: Record<string, unknown> = {};
        Object.keys(record)
            .sort()
            .forEach((key) => {
                const value = record[key];
                if (value !== undefined) {
                    sorted[key] = stableSortValue(value);
                }
            });
        return sorted;
    }
    return input;
}

export function stableStringify(input: unknown): string {
    return JSON.stringify(stableSortValue(input));
}

export function normalizeDraftAnchorText(input: string): string {
    return String(input || '').replace(/\s+/g, ' ').trim();
}

export function buildDraftAnchorMessagesDigest(messages: DraftAnchorMessagePayload[]): string {
    const compact = messages.map((item) => `${item.lamport}:${item.envelopeId}:${item.payloadHash}`);
    return sha256Hex(compact.join('|'));
}

export function buildDraftAnchorMemoText(input: {
    memoPrefix: string;
    anchorId: string;
    summaryHash: string;
    messagesDigest: string;
    circleId: number;
    draftPostId: number;
    messageCount: number;
    fromLamport: string;
    toLamport: string;
}): string {
    const jsonMemo = `${input.memoPrefix}${stableStringify({
        anchorId: input.anchorId,
        circleId: input.circleId,
        draftPostId: input.draftPostId,
        fromLamport: input.fromLamport,
        messageCount: input.messageCount,
        messagesDigest: input.messagesDigest,
        summaryHash: input.summaryHash,
        toLamport: input.toLamport,
        v: 1,
    })}`;

    if (Buffer.byteLength(jsonMemo, 'utf8') <= 512) {
        return jsonMemo;
    }

    return [
        input.memoPrefix,
        input.anchorId,
        input.summaryHash,
        input.messagesDigest,
        String(input.circleId),
        String(input.draftPostId),
        String(input.messageCount),
        input.fromLamport,
        input.toLamport,
    ].join(':');
}

export function buildDraftAnchorProofPackage(input: DraftAnchorProofPackageInput): DraftAnchorProofPackage {
    const canonicalJson = stableStringify(input.payload);
    const payloadHash = sha256Hex(canonicalJson);
    const anchorId = payloadHash;
    const anchorPayload: AnchorPayload = {
        version: input.payload.version,
        anchorType: input.payload.anchorType,
        sourceId: `draft:${input.payload.draftPostId}`,
        sourceScope: input.payload.roomKey,
        payloadHash,
        summaryHash: input.payload.summaryHash,
        messagesDigest: input.payload.messagesDigest,
        generatedAt: input.payload.generatedAt,
        canonicalJson,
    };

    return {
        canonicalPayload: input.payload,
        canonicalJson,
        anchorPayload,
        payloadHash,
        anchorId,
        summaryHash: input.payload.summaryHash,
        messagesDigest: input.payload.messagesDigest,
        memoText: buildDraftAnchorMemoText({
            memoPrefix: input.memoPrefix,
            anchorId,
            summaryHash: input.payload.summaryHash,
            messagesDigest: input.payload.messagesDigest,
            circleId: input.payload.circleId,
            draftPostId: input.payload.draftPostId,
            messageCount: input.payload.messageCount,
            fromLamport: input.payload.fromLamport,
            toLamport: input.payload.toLamport,
        }),
    };
}
