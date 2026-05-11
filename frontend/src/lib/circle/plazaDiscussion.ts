import type { PlazaMessage } from './types';

function isPlainObject(value: unknown): value is Record<string, unknown> {
    return Boolean(value) && typeof value === 'object' && !Array.isArray(value);
}

function deepEqual(left: unknown, right: unknown): boolean {
    if (Object.is(left, right)) return true;

    if (Array.isArray(left) && Array.isArray(right)) {
        if (left.length !== right.length) return false;
        return left.every((item, index) => deepEqual(item, right[index]));
    }

    if (isPlainObject(left) && isPlainObject(right)) {
        const leftKeys = Object.keys(left);
        const rightKeys = Object.keys(right);
        if (leftKeys.length !== rightKeys.length) return false;
        return leftKeys.every((key) => deepEqual(left[key], right[key]));
    }

    return false;
}

function areMessagesEquivalent(left: PlazaMessage, right: PlazaMessage): boolean {
    return deepEqual(left, right);
}

function messageTimeMs(message: PlazaMessage): number {
    const source = message.createdAt || message.clientTimestamp || null;
    if (source) {
        const parsed = Date.parse(source);
        if (Number.isFinite(parsed)) return parsed;
    }
    return Number.POSITIVE_INFINITY;
}

function messageLamport(message: PlazaMessage): number {
    const value = Number(message.lamport);
    return Number.isFinite(value) ? value : Number.POSITIVE_INFINITY;
}

export function messageMatchesSemanticFacetFilters(
    message: Pick<PlazaMessage, 'messageKind' | 'semanticFacets'>,
    activeFilters: string[],
): boolean {
    if (activeFilters.length === 0) return true;
    if (message.messageKind === 'draft_candidate_notice' || message.messageKind === 'governance_notice') {
        return true;
    }
    const semanticFacets = message.semanticFacets ?? [];
    if (semanticFacets.length === 0) return false;
    return semanticFacets.some((facet) => activeFilters.includes(facet));
}

export function sortPlazaMessagesChronologically(messages: PlazaMessage[]): PlazaMessage[] {
    return [...messages].sort((left, right) => {
        const byTime = messageTimeMs(left) - messageTimeMs(right);
        if (byTime !== 0) return byTime;
        const byLamport = messageLamport(left) - messageLamport(right);
        if (byLamport !== 0) return byLamport;
        return left.id - right.id;
    });
}

export function dedupePlazaMessagesByEnvelope(messages: PlazaMessage[]): PlazaMessage[] {
    const seenEnvelopeIds = new Set<string>();
    return messages.filter((message) => {
        const envelopeId = String(message.envelopeId || '').trim();
        if (!envelopeId) return true;
        if (seenEnvelopeIds.has(envelopeId)) return false;
        seenEnvelopeIds.add(envelopeId);
        return true;
    });
}

export function mergePlazaDiscussionMessages(input: {
    serverMessages: PlazaMessage[];
    optimisticMessages: PlazaMessage[];
}): PlazaMessage[] {
    return sortPlazaMessagesChronologically(dedupePlazaMessagesByEnvelope([
        ...input.serverMessages,
        ...input.optimisticMessages,
    ]));
}

export function appendPlazaDiscussionMessages(input: {
    currentMessages: PlazaMessage[];
    appendedMessages: PlazaMessage[];
}): PlazaMessage[] {
    const optimisticMessages = input.currentMessages.filter(
        (message) => message.sendState !== 'sent' && !message.envelopeId,
    );
    const committedMessages = input.currentMessages.filter(
        (message) => message.sendState === 'sent' || Boolean(message.envelopeId),
    );
    const nextCommittedMessages = [...committedMessages];
    const envelopeIndex = new Map(
        committedMessages
            .filter((message) => typeof message.envelopeId === 'string' && message.envelopeId.trim().length > 0)
            .map((message, index) => [String(message.envelopeId), index]),
    );

    let changed = false;
    for (const appendedMessage of dedupePlazaMessagesByEnvelope(input.appendedMessages)) {
        const envelopeId = String(appendedMessage.envelopeId || '').trim();
        if (!envelopeId) continue;
        const existingIndex = envelopeIndex.get(envelopeId);
        if (existingIndex === undefined) {
            envelopeIndex.set(envelopeId, nextCommittedMessages.length);
            nextCommittedMessages.push(appendedMessage);
            changed = true;
            continue;
        }
        const existingMessage = nextCommittedMessages[existingIndex];
        if (areMessagesEquivalent(existingMessage, appendedMessage)) {
            continue;
        }
        nextCommittedMessages[existingIndex] = appendedMessage;
        changed = true;
    }

    if (!changed) {
        return input.currentMessages;
    }

    return [
        ...nextCommittedMessages,
        ...optimisticMessages,
    ];
}

export function syncPlazaDiscussionMessages(input: {
    currentMessages: PlazaMessage[];
    serverMessages: PlazaMessage[];
}): PlazaMessage[] {
    const optimisticMessages = input.currentMessages.filter(
        (message) => message.sendState !== 'sent' && !message.envelopeId,
    );
    const mergedMessages = mergePlazaDiscussionMessages({
        serverMessages: input.serverMessages,
        optimisticMessages,
    });

    const currentByEnvelope = new Map(
        input.currentMessages
            .filter((message) => typeof message.envelopeId === 'string' && message.envelopeId.trim().length > 0)
            .map((message) => [String(message.envelopeId), message]),
    );

    const nextMessages = mergedMessages.map((message) => {
        const envelopeId = String(message.envelopeId || '').trim();
        if (!envelopeId) {
            return message;
        }
        const currentMessage = currentByEnvelope.get(envelopeId);
        if (!currentMessage) {
            return message;
        }
        return areMessagesEquivalent(currentMessage, message) ? currentMessage : message;
    });

    const isExactReuse = nextMessages.length === input.currentMessages.length
        && nextMessages.every((message, index) => message === input.currentMessages[index]);

    return isExactReuse ? input.currentMessages : nextMessages;
}

export function refreshPlazaMessagesByEnvelope(input: {
    currentMessages: PlazaMessage[];
    refreshedMessages: PlazaMessage[];
}): PlazaMessage[] {
    const refreshedByEnvelope = new Map(
        input.refreshedMessages
            .filter((message) => typeof message.envelopeId === 'string' && message.envelopeId.trim().length > 0)
            .map((message) => [String(message.envelopeId), message]),
    );

    if (refreshedByEnvelope.size === 0) {
        return input.currentMessages;
    }

    const nextMessages = input.currentMessages.map((message) => {
        const envelopeId = String(message.envelopeId || '').trim();
        if (!envelopeId) return message;
        const refreshed = refreshedByEnvelope.get(envelopeId);
        if (!refreshed) return message;
        return areMessagesEquivalent(message, refreshed) ? message : refreshed;
    });

    const isExactReuse = nextMessages.every((message, index) => message === input.currentMessages[index]);
    return isExactReuse ? input.currentMessages : nextMessages;
}

export function pruneExpiredEphemeralMessages(input: {
    messages: PlazaMessage[];
    now: Date;
}): PlazaMessage[] {
    const nextMessages = input.messages.filter((message) => {
        if (!message.ephemeral) return true;
        const expiresAt = typeof message.metadata?.expiresAt === 'string'
            ? Date.parse(message.metadata.expiresAt)
            : Number.NaN;
        if (!Number.isFinite(expiresAt)) return true;
        return expiresAt > input.now.getTime();
    });

    return nextMessages.length === input.messages.length ? input.messages : nextMessages;
}
