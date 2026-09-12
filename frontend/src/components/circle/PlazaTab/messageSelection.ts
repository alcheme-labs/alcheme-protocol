import type { PlazaMessage } from '@/lib/circle/types';

export type PlazaMessageSelectionMode = 'draft' | 'case' | 'forward';

const NON_SELECTABLE_MESSAGE_KINDS = new Set([
    'draft_candidate_notice',
    'governance_notice',
    'announcement_notice',
    'forward',
    'forward_bundle',
]);

function normalizeMessageKind(value: string | null | undefined): string {
    return String(value || '').trim().toLowerCase();
}

function hasSelectableCore(message: PlazaMessage): message is PlazaMessage & { envelopeId: string } {
    if (!message.envelopeId) return false;
    if (NON_SELECTABLE_MESSAGE_KINDS.has(normalizeMessageKind(message.messageKind))) return false;
    if (message.deleted) return false;
    if (message.ephemeral) return false;
    return message.text.trim().length > 0;
}

export function isDiscussionMessageDraftSourceEligible(
    message: PlazaMessage,
): message is PlazaMessage & { envelopeId: string } {
    if (!hasSelectableCore(message)) return false;
    return message.relevanceStatus === 'ready' || !message.relevanceStatus;
}

export function isDiscussionMessageForwardSelectionEligible(
    message: PlazaMessage,
): message is PlazaMessage & { envelopeId: string } {
    return hasSelectableCore(message);
}

export function isSelectablePlazaMessageForAction(
    message: PlazaMessage,
    mode: PlazaMessageSelectionMode,
): message is PlazaMessage & { envelopeId: string } {
    return mode === 'draft' || mode === 'case'
        ? isDiscussionMessageDraftSourceEligible(message)
        : isDiscussionMessageForwardSelectionEligible(message);
}

export function selectVisiblePlazaMessageIds(
    messages: PlazaMessage[],
    mode: PlazaMessageSelectionMode,
    limit = 16,
): string[] {
    return messages
        .filter((message) => isSelectablePlazaMessageForAction(message, mode))
        .slice(-limit)
        .map((message) => message.envelopeId);
}

export function normalizeSelectedPlazaMessageIds(
    messages: PlazaMessage[],
    selectedEnvelopeIds: Set<string>,
    mode: PlazaMessageSelectionMode,
    limit = 20,
): string[] {
    return messages
        .filter((message) => isSelectablePlazaMessageForAction(message, mode))
        .filter((message) => selectedEnvelopeIds.has(message.envelopeId))
        .slice(0, limit)
        .map((message) => message.envelopeId);
}
