import {
    normalizeAnchoredInteractionType,
    type PlazaAnchoredInteractionType,
} from './types';

export type AnchoredInteractionActionScope =
    | 'participant'
    | 'creator'
    | 'asset_recorder';

export interface AnchoredInteractionEventContract {
    allowedKinds: string[];
    actionScopeByKind: Record<string, AnchoredInteractionActionScope>;
}

export type ChallengeInteractionMode = 'legacy_submission_review' | 'credibility_vote';

export class AnchoredInteractionEventValidationError extends Error {
    constructor(
        public readonly code:
            | 'invalid_interaction_event_kind'
            | 'invalid_interaction_event_payload'
            | 'invalid_interaction_initial_state',
        public readonly statusCode = 400,
    ) {
        super(code);
    }
}

const CONTRACTS: Record<PlazaAnchoredInteractionType, AnchoredInteractionEventContract> = {
    signup: contract(['signup_joined', 'signup_updated', 'signup_left', 'signup_closed'], {
        signup_closed: 'creator',
    }),
    poll: contract(['poll_voted', 'poll_vote_removed', 'poll_closed'], {
        poll_closed: 'creator',
    }),
    challenge: contract([
        'challenge_submitted',
        'challenge_accepted',
        'challenge_rejected',
        'challenge_changes_requested',
        'challenge_closed',
    ], {
        challenge_accepted: 'creator',
        challenge_rejected: 'creator',
        challenge_changes_requested: 'creator',
        challenge_closed: 'creator',
    }),
    // Legacy records only. New announcements are created by the Circle Announcements module.
    announcement: contract(['announcement_read', 'announcement_closed'], {
        announcement_closed: 'creator',
    }),
    support: contract(['support_added', 'support_removed']),
    tip: contract(['tip_transfer_initiated', 'tip_transfer_recorded', 'tip_transfer_failed'], {
        tip_transfer_recorded: 'asset_recorder',
    }),
    bounty: contract([
        'bounty_submitted',
        'bounty_completion_accepted',
        'bounty_completion_rejected',
        'bounty_settlement_recorded',
        'bounty_refunded',
        'bounty_closed',
    ], {
        bounty_completion_accepted: 'creator',
        bounty_completion_rejected: 'creator',
        bounty_settlement_recorded: 'asset_recorder',
        bounty_refunded: 'asset_recorder',
        bounty_closed: 'creator',
    }),
};

export const CHALLENGE_TRUST_VOTE_OPTIONS = [
    { id: 'agree_challenge', label: 'Agree with challenge' },
    { id: 'disagree_challenge', label: 'Disagree with challenge' },
] as const;

const CHALLENGE_TRUST_VOTE_OPTION_IDS = new Set(
    CHALLENGE_TRUST_VOTE_OPTIONS.map((option) => option.id),
);

const CHALLENGE_TRUST_VOTE_CONTRACT = contract(['challenge_voted', 'challenge_closed'], {
    challenge_closed: 'creator',
});

export function getChallengeInteractionMode(value: unknown): ChallengeInteractionMode {
    const state = value && typeof value === 'object' && !Array.isArray(value)
        ? value as Record<string, unknown>
        : {};
    return state.challengeMode === 'credibility_vote'
        ? 'credibility_vote'
        : 'legacy_submission_review';
}

export function getAnchoredInteractionEventContract(
    interactionType: PlazaAnchoredInteractionType | string,
    state?: Record<string, unknown> | null,
): AnchoredInteractionEventContract {
    const type = normalizeAnchoredInteractionType(interactionType);
    if (!type) {
        throw new AnchoredInteractionEventValidationError('invalid_interaction_event_kind');
    }
    if (type === 'challenge' && getChallengeInteractionMode(state) === 'credibility_vote') {
        return CHALLENGE_TRUST_VOTE_CONTRACT;
    }
    return CONTRACTS[type];
}

export function getAnchoredInteractionEventActionScope(
    interactionType: PlazaAnchoredInteractionType | string,
    eventKind: string,
    state?: Record<string, unknown> | null,
): AnchoredInteractionActionScope {
    const contractValue = getAnchoredInteractionEventContract(interactionType, state);
    if (!contractValue.allowedKinds.includes(eventKind)) {
        throw new AnchoredInteractionEventValidationError('invalid_interaction_event_kind');
    }
    return contractValue.actionScopeByKind[eventKind] || 'participant';
}

export function validateAnchoredInteractionEventPayload(
    interactionType: PlazaAnchoredInteractionType | string,
    eventKind: string,
    payload: Record<string, unknown>,
    state?: Record<string, unknown> | null,
): Record<string, unknown> {
    const contractValue = getAnchoredInteractionEventContract(interactionType, state);
    if (!contractValue.allowedKinds.includes(eventKind)) {
        throw new AnchoredInteractionEventValidationError('invalid_interaction_event_kind');
    }

    switch (eventKind) {
        case 'signup_joined':
        case 'signup_updated':
            return {
                displayName: requiredString(payload.displayName),
                ...optionalStringField('note', payload.note),
                ...optionalStringRecordField('fields', payload.fields),
            };
        case 'signup_left':
        case 'poll_vote_removed':
        case 'announcement_read':
        case 'support_removed':
            return {};
        case 'signup_closed':
        case 'poll_closed':
        case 'announcement_closed':
        case 'bounty_closed':
            return optionalReason(payload.reason);
        case 'poll_voted':
            return normalizePollVotePayload(payload);
        case 'challenge_voted':
            return normalizeChallengeVotePayload(payload);
        case 'challenge_submitted':
        case 'bounty_submitted':
            return {
                text: requiredString(payload.text),
                ...optionalStringArrayField('evidenceRefs', payload.evidenceRefs),
            };
        case 'challenge_accepted':
        case 'challenge_rejected':
        case 'bounty_completion_accepted':
        case 'bounty_completion_rejected':
            return {
                actorPubkey: requiredString(payload.actorPubkey),
                ...optionalStringField('reason', payload.reason),
            };
        case 'challenge_changes_requested':
            return {
                actorPubkey: requiredString(payload.actorPubkey),
                reason: requiredString(payload.reason),
            };
        case 'challenge_closed':
            return optionalReason(payload.reason);
        case 'support_added':
            return {
                ...optionalPositiveNumberField('weight', payload.weight),
                ...optionalStringField('note', payload.note),
            };
        case 'tip_transfer_initiated':
            return {
                assetType: normalizeAssetType(payload.assetType),
                ...optionalStringField('mint', payload.mint),
                amount: requiredString(payload.amount),
                recipientPubkey: requiredString(payload.recipientPubkey),
            };
        case 'tip_transfer_recorded':
            return {
                receiptId: requiredString(payload.receiptId),
                signature: requiredString(payload.signature),
                assetType: normalizeAssetType(payload.assetType),
                ...optionalStringField('mint', payload.mint),
                amount: requiredString(payload.amount),
                recipientPubkey: requiredString(payload.recipientPubkey),
                status: normalizeReceiptStatus(payload.status),
            };
        case 'tip_transfer_failed':
            return {
                reasonCode: requiredString(payload.reasonCode),
                ...optionalStringField('signature', payload.signature),
                ...optionalStringField('receiptId', payload.receiptId),
            };
        case 'bounty_settlement_recorded':
            return {
                receiptId: requiredString(payload.receiptId),
                ...optionalStringField('signature', payload.signature),
                ...optionalStringField('externalReceiptId', payload.externalReceiptId),
                assetType: requiredString(payload.assetType),
                amount: requiredString(payload.amount),
                recipientPubkey: requiredString(payload.recipientPubkey),
                status: normalizeReceiptStatus(payload.status),
            };
        case 'bounty_refunded':
            return {
                receiptId: requiredString(payload.receiptId),
                ...optionalStringField('signature', payload.signature),
                ...optionalStringField('externalReceiptId', payload.externalReceiptId),
                ...optionalStringField('reason', payload.reason),
            };
        default:
            throw new AnchoredInteractionEventValidationError('invalid_interaction_event_kind');
    }
}

export function validateAnchoredInteractionInitialState(
    interactionType: PlazaAnchoredInteractionType | string,
    value: Record<string, unknown>,
): Record<string, unknown> {
    const type = normalizeAnchoredInteractionType(interactionType);
    if (!type) {
        throw new AnchoredInteractionEventValidationError('invalid_interaction_event_payload');
    }
    if (type === 'tip') {
        return {
            recipientPubkey: requiredString(value.recipientPubkey),
            assetType: normalizeAssetType(value.assetType),
            ...optionalStringField('mint', value.mint),
            amount: requiredString(value.amount),
        };
    }
    if (type === 'bounty') {
        return {
            ...value,
            rewardDisplay: requiredString(value.rewardDisplay),
            settlementMode: value.settlementMode === 'escrow' ? 'escrow' : 'receipt_only',
            escrowEnabled: value.settlementMode === 'escrow' && value.escrowEnabled === true,
        };
    }
    if (type === 'challenge') {
        return normalizeChallengeInitialState(value);
    }
    if (type !== 'poll') return value;

    const options = Array.isArray(value.options)
        ? value.options
            .slice(0, 12)
            .map((option) => option && typeof option === 'object' && !Array.isArray(option)
                ? option as Record<string, unknown>
                : null)
            .filter((option): option is Record<string, unknown> => Boolean(option))
            .map((option) => ({
                id: optionalString(option.id) || '',
                label: optionalString(option.label) || '',
            }))
            .filter((option) => option.id && option.label)
        : [];
    if (options.length < 2) {
        throw new AnchoredInteractionEventValidationError('invalid_interaction_event_payload');
    }
    return { ...value, options };
}

function contract(
    allowedKinds: string[],
    scopedKinds: Partial<Record<string, AnchoredInteractionActionScope>> = {},
): AnchoredInteractionEventContract {
    return {
        allowedKinds,
        actionScopeByKind: Object.fromEntries(allowedKinds.map((kind) => [
            kind,
            scopedKinds[kind] || 'participant',
        ])),
    };
}

function normalizePollVotePayload(payload: Record<string, unknown>): Record<string, unknown> {
    const optionIds = Array.isArray(payload.optionIds)
        ? payload.optionIds.map(optionalString).filter((item): item is string => Boolean(item))
        : optionalString(payload.optionId)
            ? [optionalString(payload.optionId) as string]
            : [];
    if (optionIds.length === 0) {
        throw new AnchoredInteractionEventValidationError('invalid_interaction_event_payload');
    }
    return {
        optionIds: [...new Set(optionIds)].slice(0, 12),
        ...optionalStringField('note', payload.note),
    };
}

function normalizeChallengeVotePayload(payload: Record<string, unknown>): Record<string, unknown> {
    const optionId = optionalString(payload.optionId);
    if (!optionId || !CHALLENGE_TRUST_VOTE_OPTION_IDS.has(optionId as typeof CHALLENGE_TRUST_VOTE_OPTIONS[number]['id'])) {
        throw new AnchoredInteractionEventValidationError('invalid_interaction_event_payload');
    }
    return {
        optionId,
        ...optionalStringField('note', payload.note),
    };
}

function normalizeChallengeInitialState(value: Record<string, unknown>): Record<string, unknown> {
    const reason = optionalString(value.reason);
    if (!reason) {
        throw new AnchoredInteractionEventValidationError('invalid_interaction_initial_state');
    }
    if (value.challengeMode && value.challengeMode !== 'credibility_vote') {
        throw new AnchoredInteractionEventValidationError('invalid_interaction_initial_state');
    }
    if (value.aiImpact && value.aiImpact !== 'credibility_dispute') {
        throw new AnchoredInteractionEventValidationError('invalid_interaction_initial_state');
    }
    if (value.options !== undefined && !matchesChallengeTrustVoteOptions(value.options)) {
        throw new AnchoredInteractionEventValidationError('invalid_interaction_initial_state');
    }
    return {
        challengeMode: 'credibility_vote',
        reason,
        options: CHALLENGE_TRUST_VOTE_OPTIONS.map((option) => ({ ...option })),
        aiImpact: 'credibility_dispute',
    };
}

function matchesChallengeTrustVoteOptions(value: unknown): boolean {
    if (!Array.isArray(value) || value.length !== CHALLENGE_TRUST_VOTE_OPTIONS.length) return false;
    return CHALLENGE_TRUST_VOTE_OPTIONS.every((expected, index) => {
        const option = value[index];
        if (!option || typeof option !== 'object' || Array.isArray(option)) return false;
        const record = option as Record<string, unknown>;
        return record.id === expected.id && record.label === expected.label;
    });
}

function optionalReason(value: unknown): Record<string, unknown> {
    return optionalStringField('reason', value);
}

function requiredString(value: unknown): string {
    const normalized = optionalString(value);
    if (!normalized) {
        throw new AnchoredInteractionEventValidationError('invalid_interaction_event_payload');
    }
    return normalized;
}

function optionalString(value: unknown): string | null {
    return typeof value === 'string' && value.trim() ? value.trim() : null;
}

function optionalStringField(key: string, value: unknown): Record<string, string> {
    const normalized = optionalString(value);
    return normalized ? { [key]: normalized } : {};
}

function optionalStringArrayField(key: string, value: unknown): Record<string, string[]> {
    if (!Array.isArray(value)) return {};
    const normalized = value.map(optionalString).filter((item): item is string => Boolean(item)).slice(0, 24);
    return normalized.length > 0 ? { [key]: normalized } : {};
}

function optionalStringRecordField(key: string, value: unknown): Record<string, Record<string, string>> {
    if (!value || typeof value !== 'object' || Array.isArray(value)) return {};
    const output: Record<string, string> = {};
    for (const [fieldKey, raw] of Object.entries(value)) {
        const normalizedKey = optionalString(fieldKey);
        const normalizedValue = optionalString(raw);
        if (normalizedKey && normalizedValue) output[normalizedKey] = normalizedValue;
    }
    return Object.keys(output).length > 0 ? { [key]: output } : {};
}

function optionalPositiveNumberField(key: string, value: unknown): Record<string, number> {
    return typeof value === 'number' && Number.isFinite(value) && value > 0 ? { [key]: value } : {};
}

function normalizeAssetType(value: unknown): 'SOL' | 'SPL' {
    if (value === 'SOL' || value === 'SPL') return value;
    throw new AnchoredInteractionEventValidationError('invalid_interaction_event_payload');
}

function normalizeReceiptStatus(value: unknown): 'pending' | 'confirmed' | 'failed' | 'unverified' {
    if (value === 'pending' || value === 'confirmed' || value === 'failed' || value === 'unverified') return value;
    throw new AnchoredInteractionEventValidationError('invalid_interaction_event_payload');
}
