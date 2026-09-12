export interface DiscussionRealtimeLamportMessage {
    envelopeId?: unknown;
    lamport?: unknown;
    id?: unknown;
}

export interface DiscussionRealtimeSnapshotLike {
    watermark?: {
        lastLamport?: unknown;
    } | null;
    messages?: DiscussionRealtimeLamportMessage[] | null;
}

function normalizeLamport(value: unknown): number | null {
    const numeric = typeof value === 'number' ? value : Number(value);
    if (!Number.isFinite(numeric)) return null;
    return Math.max(0, Math.trunc(numeric));
}

export function extractDiscussionRealtimeLamport(
    messageList: DiscussionRealtimeLamportMessage[],
): number {
    for (let index = messageList.length - 1; index >= 0; index -= 1) {
        const message = messageList[index];
        const envelopeId = typeof message?.envelopeId === 'string'
            ? message.envelopeId.trim()
            : '';
        if (!envelopeId) continue;
        const lamport = normalizeLamport(message.lamport);
        if (lamport !== null) return lamport;
        const idFallback = normalizeLamport(message.id);
        if (idFallback !== null) return idFallback;
    }
    return 0;
}

export function resolveDiscussionSnapshotLamport(
    snapshot: DiscussionRealtimeSnapshotLike,
): number {
    const watermarkLamport = normalizeLamport(snapshot.watermark?.lastLamport);
    if (watermarkLamport !== null) return watermarkLamport;
    return extractDiscussionRealtimeLamport(snapshot.messages ?? []);
}
