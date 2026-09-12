import type { PlazaAnchoredInteractionType } from './types.ts';
import type { AnchoredInteractionActionScope } from './schema.ts';

export interface AnchoredInteractionEventUiContract {
    allowedKinds: string[];
    actionScopeByKind: Record<string, AnchoredInteractionActionScope>;
}

export type ChallengeInteractionMode = 'legacy_submission_review' | 'credibility_vote';

export const CHALLENGE_TRUST_VOTE_OPTIONS = [
    { id: 'agree_challenge', label: 'Agree with challenge' },
    { id: 'disagree_challenge', label: 'Disagree with challenge' },
] as const;

const CONTRACTS: Record<PlazaAnchoredInteractionType, AnchoredInteractionEventUiContract> = {
    signup: contract(['signup_joined', 'signup_updated', 'signup_left', 'signup_closed'], { signup_closed: 'creator' }),
    poll: contract(['poll_voted', 'poll_vote_removed', 'poll_closed'], { poll_closed: 'creator' }),
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
    announcement: contract(['announcement_read', 'announcement_closed'], { announcement_closed: 'creator' }),
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

const CHALLENGE_TRUST_VOTE_CONTRACT = contract(['challenge_voted', 'challenge_closed'], {
    challenge_closed: 'creator',
});

export function getChallengeInteractionMode(state: unknown): ChallengeInteractionMode {
    const record = state && typeof state === 'object' && !Array.isArray(state)
        ? state as Record<string, unknown>
        : {};
    return record.challengeMode === 'credibility_vote'
        ? 'credibility_vote'
        : 'legacy_submission_review';
}

export function getAnchoredInteractionEventUiContract(
    type: PlazaAnchoredInteractionType,
    state?: Record<string, unknown> | null,
): AnchoredInteractionEventUiContract {
    if (type === 'challenge' && getChallengeInteractionMode(state) === 'credibility_vote') {
        return CHALLENGE_TRUST_VOTE_CONTRACT;
    }
    return CONTRACTS[type];
}

function contract(
    allowedKinds: string[],
    scopedKinds: Partial<Record<string, AnchoredInteractionActionScope>> = {},
): AnchoredInteractionEventUiContract {
    return {
        allowedKinds,
        actionScopeByKind: Object.fromEntries(allowedKinds.map((kind) => [
            kind,
            scopedKinds[kind] || 'participant',
        ])),
    };
}
