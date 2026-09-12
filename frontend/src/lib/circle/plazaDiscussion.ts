import type { PlazaMessage } from './types';

export interface PlazaReplyPresentation {
    quotedAuthor: string;
    quotedPreview: string;
    quoteChain: PlazaReplyQuote[];
    body: string;
    hiddenContextCount: number;
    sourceEnvelopeId?: string | null;
}

export interface PlazaReplyQuote {
    author: string;
    preview: string | null;
    fullPreview?: string | null;
    sourceEnvelopeId?: string | null;
}

export interface PlazaReplyContextDisplay {
    directQuote: PlazaReplyQuote;
    ancestorQuotes: PlazaReplyQuote[];
    ancestorSummary: string | null;
    ancestorCount: number;
    isLongAncestorChain: boolean;
}

export interface PlazaMessageGestureTarget {
    closest?: (selector: string) => unknown;
}

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

const REPLY_TEXT_PATTERN = /^↪\s*(?:回复|Reply to|Respuesta a|Réponse à)\s+@([^：:\n]+)\s*[：:]\s*(.*?)\r?\n([\s\S]*)$/u;
const REPLY_PREFIX_PATTERN = /^↪\s*(?:回复|Reply to|Respuesta a|Réponse à)\s+@([^：:\n]+)\s*[：:]\s*(.*)$/u;
const REPLY_PREVIEW_DEFAULT_MAX_LENGTH = 64;
const REPLY_INLINE_ANCESTOR_LIMIT = 5;
const MESSAGE_ACTION_TAP_SLOP = 10;

export function didPlazaMessageGestureMove(input: {
    startX: number;
    startY: number;
    currentX: number;
    currentY: number;
    threshold?: number;
}): boolean {
    const threshold = input.threshold ?? MESSAGE_ACTION_TAP_SLOP;
    return Math.abs(input.currentX - input.startX) > threshold
        || Math.abs(input.currentY - input.startY) > threshold;
}

export function shouldOpenPlazaMessageActionSheet(input: {
    gestureStarted: boolean;
    longPressFired: boolean;
    movedBeyondTapSlop: boolean;
}): boolean {
    return input.gestureStarted && !input.longPressFired && !input.movedBeyondTapSlop;
}

export function shouldOpenPlazaReplyQuoteMenu(input: {
    gestureStarted: boolean;
    movedBeyondTapSlop: boolean;
}): boolean {
    return input.gestureStarted && !input.movedBeyondTapSlop;
}

export function shouldShowFullPlazaReplyQuote(
    quote: PlazaReplyQuote | null,
    options: { isVisuallyTruncated?: boolean } = {},
): boolean {
    const preview = normalizeReplyPreviewText(quote?.preview || '');
    if (!preview) return false;
    const fullPreview = normalizeReplyPreviewText(quote?.fullPreview || '');
    if (fullPreview && fullPreview !== preview && fullPreview.length > preview.length) return true;
    return preview.endsWith('…') || Boolean(options.isVisuallyTruncated);
}

export function getExpandablePlazaReplyQuoteKeys(
    quoteItems: Array<{ key: string; quote: PlazaReplyQuote | null }>,
    expandedKeys: ReadonlySet<string>,
    visuallyTruncatedKeys: ReadonlySet<string> = new Set(),
): string[] {
    return quoteItems
        .filter((item) => !expandedKeys.has(item.key) && shouldShowFullPlazaReplyQuote(item.quote, {
            isVisuallyTruncated: visuallyTruncatedKeys.has(item.key),
        }))
        .map((item) => item.key);
}

export function getCollapsiblePlazaReplyQuoteKeys(
    quoteItems: Array<{ key: string; quote: PlazaReplyQuote | null }>,
    expandedKeys: ReadonlySet<string>,
    visuallyTruncatedKeys: ReadonlySet<string> = new Set(),
): string[] {
    return quoteItems
        .filter((item) => expandedKeys.has(item.key) && shouldShowFullPlazaReplyQuote(item.quote, {
            isVisuallyTruncated: visuallyTruncatedKeys.has(item.key),
        }))
        .map((item) => item.key);
}

export function shouldSkipPlazaMessageGestureTarget(target: PlazaMessageGestureTarget | null): boolean {
    if (!target?.closest) return false;
    return Boolean(
        target.closest('[data-msg-overlay="1"]')
        || target.closest('[data-msg-avatar="1"]')
        || target.closest('[data-msg-action="1"]')
        || !target.closest('[data-msg-bubble="1"]'),
    );
}

function normalizeReplyPreviewText(text: string): string {
    return text.replace(/\s+/g, ' ').trim();
}

function truncateReplyPreview(text: string, maxLength: number): string {
    if (text.length <= maxLength) return text;
    return `${text.slice(0, Math.max(0, maxLength - 1))}…`;
}

function quotePreviewText(quote: PlazaReplyQuote): string {
    return normalizeReplyPreviewText(quote.preview || '');
}

export function buildPlazaReplyContextDisplay(reply: PlazaReplyPresentation): PlazaReplyContextDisplay {
    const chain = reply.quoteChain.length > 0
        ? reply.quoteChain
        : [{ author: reply.quotedAuthor, preview: reply.quotedPreview || null }];
    const directQuote = chain[chain.length - 1];
    const ancestorQuotes = chain.slice(0, -1);
    const ancestorSummaryItems = ancestorQuotes
        .map(quotePreviewText)
        .filter(Boolean)
        .slice(-2);

    return {
        directQuote,
        ancestorQuotes,
        ancestorSummary: ancestorSummaryItems.length > 0
            ? ancestorSummaryItems.join(' / ')
            : null,
        ancestorCount: ancestorQuotes.length,
        isLongAncestorChain: ancestorQuotes.length > REPLY_INLINE_ANCESTOR_LIMIT,
    };
}

function buildFlattenedReplyPreview(
    text: string,
    emptyText: string,
    maxLength = REPLY_PREVIEW_DEFAULT_MAX_LENGTH,
): string {
    const normalized = normalizeReplyPreviewText(text);
    if (!normalized) return emptyText;
    return truncateReplyPreview(normalized, maxLength);
}

function buildQuoteChain(author: string, preview: string): PlazaReplyQuote[] {
    const chain: PlazaReplyQuote[] = [{
        author,
        preview: null,
    }];
    let remainder = preview;

    while (remainder) {
        const nested = remainder.match(REPLY_PREFIX_PATTERN);
        if (!nested) {
            chain[chain.length - 1].preview = remainder;
            break;
        }

        const nestedAuthor = nested[1]?.trim() ?? '';
        if (!nestedAuthor) {
            chain[chain.length - 1].preview = remainder;
            break;
        }

        remainder = normalizeReplyPreviewText(nested[2] ?? '');
        chain.push({
            author: nestedAuthor,
            preview: null,
        });

        if (chain.length >= 10) {
            chain[chain.length - 1].preview = remainder || null;
            break;
        }
    }

    if (chain.length === 1 && chain[0].preview === null) {
        chain[0].preview = preview || null;
    }

    return chain;
}

export function parsePlazaReplyPresentation(text: string): PlazaReplyPresentation | null {
    const match = text.match(REPLY_TEXT_PATTERN);
    if (!match) return null;

    const quotedAuthor = match[1]?.trim() ?? '';
    const quotedPreview = normalizeReplyPreviewText(match[2] ?? '');
    const body = (match[3] ?? '').trim();
    if (!quotedAuthor || !body) return null;

    const quoteChain = buildQuoteChain(quotedAuthor, quotedPreview);
    return {
        quotedAuthor,
        quotedPreview,
        quoteChain,
        body,
        hiddenContextCount: Math.min(9, Math.max(0, quoteChain.length - 1)),
    };
}

export function buildPlazaReplyPreview(
    text: string,
    emptyText: string,
    maxLength = REPLY_PREVIEW_DEFAULT_MAX_LENGTH,
): string {
    const reply = parsePlazaReplyPresentation(text);
    const normalized = normalizeReplyPreviewText(reply?.body ?? text);
    if (!normalized) return emptyText;
    return truncateReplyPreview(normalized, maxLength);
}

type ReplySourceMessage = Pick<PlazaMessage, 'id' | 'author' | 'text' | 'envelopeId'>;

function replyPreviewMatches(input: {
    candidate: ReplySourceMessage;
    quotedPreview: string;
    emptyText: string;
    maxLength: number;
}): boolean {
    const quotedPreview = normalizeReplyPreviewText(input.quotedPreview);
    const bodyPreview = buildPlazaReplyPreview(input.candidate.text, input.emptyText, input.maxLength);
    const legacyPreview = buildFlattenedReplyPreview(input.candidate.text, input.emptyText, input.maxLength);
    if (quotedPreview === bodyPreview || quotedPreview === legacyPreview) return true;
    if (quotedPreview.endsWith('…')) {
        const prefix = quotedPreview.slice(0, -1);
        return bodyPreview.startsWith(prefix) || legacyPreview.startsWith(prefix);
    }
    return false;
}

function findReplySourceMessage(input: {
    reply: PlazaReplyPresentation;
    previousMessages: ReplySourceMessage[];
    emptyText: string;
    maxLength: number;
}): ReplySourceMessage | null {
    for (let index = input.previousMessages.length - 1; index >= 0; index -= 1) {
        const candidate = input.previousMessages[index];
        if (candidate.author !== input.reply.quotedAuthor) continue;
        if (!replyPreviewMatches({
            candidate,
            quotedPreview: input.reply.quotedPreview,
            emptyText: input.emptyText,
            maxLength: input.maxLength,
        })) {
            continue;
        }
        return candidate;
    }
    return null;
}

export function resolvePlazaReplyPresentation(input: {
    message: ReplySourceMessage;
    previousMessages: ReplySourceMessage[];
    emptyText: string;
    maxPreviewLength?: number;
}): PlazaReplyPresentation | null {
    const maxLength = input.maxPreviewLength ?? REPLY_PREVIEW_DEFAULT_MAX_LENGTH;
    const parsed = parsePlazaReplyPresentation(input.message.text);
    if (!parsed) return null;

    const source = findReplySourceMessage({
        reply: parsed,
        previousMessages: input.previousMessages,
        emptyText: input.emptyText,
        maxLength,
    });
    if (!source) return parsed;

    const sourceIndex = input.previousMessages.findIndex((message) => message.id === source.id);
    const earlierMessages = sourceIndex >= 0 ? input.previousMessages.slice(0, sourceIndex) : input.previousMessages;
    const sourceReply = resolvePlazaReplyPresentation({
        message: source,
        previousMessages: earlierMessages,
        emptyText: input.emptyText,
        maxPreviewLength: maxLength,
    });
    const preview = buildPlazaReplyPreview(source.text, input.emptyText, maxLength);
    const fullPreview = buildPlazaReplyPreview(source.text, input.emptyText, Number.MAX_SAFE_INTEGER);
    const sourceQuote: PlazaReplyQuote = {
        author: source.author,
        preview,
        sourceEnvelopeId: source.envelopeId || null,
    };
    if (fullPreview !== preview) {
        sourceQuote.fullPreview = fullPreview;
    }
    const quoteChain = sourceReply
        ? [...sourceReply.quoteChain, sourceQuote]
        : [sourceQuote];

    return {
        ...parsed,
        quoteChain,
        hiddenContextCount: Math.min(9, Math.max(0, quoteChain.length - 1)),
        sourceEnvelopeId: source.envelopeId || null,
    };
}

function stableClientWriteIdentity(message: PlazaMessage): { nonce: string; clientTimestamp: string; senderPubkey: string } | null {
    const metadata = isPlainObject(message.metadata) ? message.metadata : null;
    const rawIdentity = isPlainObject(metadata?.discussionClientWrite)
        ? metadata.discussionClientWrite
        : metadata;
    const nonce = typeof rawIdentity?.nonce === 'string'
        ? rawIdentity.nonce.trim()
        : typeof message.nonce === 'string'
            ? message.nonce.trim()
            : '';
    const clientTimestamp = typeof rawIdentity?.clientTimestamp === 'string'
        ? rawIdentity.clientTimestamp.trim()
        : typeof message.clientTimestamp === 'string'
            ? message.clientTimestamp.trim()
            : '';
    const senderPubkey = typeof message.senderPubkey === 'string' ? message.senderPubkey.trim() : '';
    if (!nonce || !clientTimestamp || !senderPubkey) return null;
    return { nonce, clientTimestamp, senderPubkey };
}

function hasSameStableClientWriteIdentity(left: PlazaMessage, right: PlazaMessage): boolean {
    const leftIdentity = stableClientWriteIdentity(left);
    const rightIdentity = stableClientWriteIdentity(right);
    return Boolean(
        leftIdentity
        && rightIdentity
        && leftIdentity.nonce === rightIdentity.nonce
        && leftIdentity.clientTimestamp === rightIdentity.clientTimestamp
        && leftIdentity.senderPubkey === rightIdentity.senderPubkey,
    );
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
    const appendedMessages = dedupePlazaMessagesByEnvelope(input.appendedMessages);
    const optimisticMessages = input.currentMessages.filter(
        (message) => message.sendState !== 'sent' && !message.envelopeId,
    ).filter(
        (message) => !appendedMessages.some((appendedMessage) =>
            hasSameStableClientWriteIdentity(message, appendedMessage)),
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

    let changed = optimisticMessages.length !== input.currentMessages.filter(
        (message) => message.sendState !== 'sent' && !message.envelopeId,
    ).length;
    for (const appendedMessage of appendedMessages) {
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

export function shouldReconcileViewerDustMessage(input: {
    viewerJoined: boolean;
    message: Pick<PlazaMessage, 'ephemeral' | 'envelopeId'> | null | undefined;
}): boolean {
    return input.viewerJoined
        && input.message?.ephemeral === true
        && typeof input.message.envelopeId === 'string'
        && input.message.envelopeId.trim().length > 0;
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
