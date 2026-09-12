import {
    type PlazaAnchoredInteractionType,
    normalizeAnchoredInteractionType,
} from './types';
import {
    CHALLENGE_TRUST_VOTE_OPTIONS,
    getChallengeInteractionMode,
} from './eventRegistry';

export interface PlazaAnchoredInteractionEventRecord {
    id: bigint;
    eventId: string;
    interactionId: string;
    circleId: number;
    actorPubkey: string | null;
    eventKind: string;
    payload: Record<string, unknown>;
    clientNonce: string | null;
    createdAt: Date;
}

export interface AnchoredInteractionProjection {
    state: Record<string, unknown>;
    summary: Record<string, unknown>;
}

const MAX_SUMMARY_PREVIEWS = 8;

export function projectAnchoredInteraction(input: {
    interactionType: PlazaAnchoredInteractionType;
    currentState: Record<string, unknown>;
    events: PlazaAnchoredInteractionEventRecord[];
}): AnchoredInteractionProjection {
    const type = normalizeAnchoredInteractionType(input.interactionType);
    if (!type) throw new Error('unsupported_anchored_interaction_type');

    switch (type) {
        case 'signup':
            return projectSignup(input.events);
        case 'poll':
            return projectPoll(input.currentState, input.events);
        case 'challenge':
            return projectChallenge(input.currentState, input.events);
        case 'announcement':
            return projectAnnouncement(input.events);
        case 'support':
            return projectSupport(input.events);
        case 'tip':
            return projectTip(input.events);
        case 'bounty':
            return projectBounty(input.events);
    }
}

function projectSignup(events: PlazaAnchoredInteractionEventRecord[]): AnchoredInteractionProjection {
    const entriesByActor: Record<string, Record<string, unknown>> = {};
    for (const event of events) {
        const actor = normalizeActor(event.actorPubkey);
        if (!actor) continue;
        if (event.eventKind === 'signup_left') {
            delete entriesByActor[actor];
            continue;
        }
        if (event.eventKind !== 'signup_joined' && event.eventKind !== 'signup_updated') continue;
        entriesByActor[actor] = {
            actorPubkey: actor,
            displayName: normalizeString(event.payload.displayName) || actor,
            note: normalizeString(event.payload.note),
            fields: normalizeStringRecord(event.payload.fields),
            eventId: event.eventId,
        };
    }
    const latestEntries = Object.values(entriesByActor).slice(-MAX_SUMMARY_PREVIEWS);
    return {
        state: { entriesByActor },
        summary: {
            participantCount: Object.keys(entriesByActor).length,
            latestEntries,
        },
    };
}

function projectPoll(
    currentState: Record<string, unknown>,
    events: PlazaAnchoredInteractionEventRecord[],
): AnchoredInteractionProjection {
    const votes = projectChoiceVotes(events, {
        voteKind: 'poll_voted',
        removeKind: 'poll_vote_removed',
    });
    const options = normalizePollOptions(currentState.options);
    const multipleChoice = currentState.multipleChoice === true;
    return {
        state: {
            ...(options.length > 0 ? { options } : {}),
            ...(multipleChoice ? { multipleChoice: true } : {}),
            votesByActor: votes.votesByActor,
        },
        summary: {
            participantCount: votes.participantCount,
            totalSelections: votes.totalSelections,
            optionCounts: votes.optionCounts,
        },
    };
}

function projectChallenge(
    currentState: Record<string, unknown>,
    events: PlazaAnchoredInteractionEventRecord[],
): AnchoredInteractionProjection {
    if (getChallengeInteractionMode(currentState) === 'credibility_vote') {
        return projectChallengeTrustVote(currentState, events);
    }
    return projectLegacyChallenge(events);
}

function projectChallengeTrustVote(
    currentState: Record<string, unknown>,
    events: PlazaAnchoredInteractionEventRecord[],
): AnchoredInteractionProjection {
    const votes = projectChoiceVotes(events, { voteKind: 'challenge_voted' });
    return {
        state: {
            challengeMode: 'credibility_vote',
            reason: normalizeString(currentState.reason) || '',
            options: CHALLENGE_TRUST_VOTE_OPTIONS.map((option) => ({ ...option })),
            aiImpact: 'credibility_dispute',
            votesByActor: votes.votesByActor,
        },
        summary: {
            participantCount: votes.participantCount,
            totalSelections: votes.totalSelections,
            optionCounts: votes.optionCounts,
        },
    };
}

function projectLegacyChallenge(events: PlazaAnchoredInteractionEventRecord[]): AnchoredInteractionProjection {
    const submissionsByActor: Record<string, Record<string, unknown>> = {};
    const acceptedByActor: Record<string, Record<string, unknown>> = {};
    const rejectedByActor: Record<string, Record<string, unknown>> = {};
    const changesRequestedByActor: Record<string, Record<string, unknown>> = {};
    for (const event of events) {
        const actor = normalizeActor(event.actorPubkey);
        if (event.eventKind === 'challenge_submitted' && actor) {
            submissionsByActor[actor] = {
                actorPubkey: actor,
                text: normalizeString(event.payload.text),
                evidenceRefs: normalizeStringArray(event.payload.evidenceRefs),
                eventId: event.eventId,
            };
        }
        if (event.eventKind === 'challenge_accepted'
            || event.eventKind === 'challenge_rejected'
            || event.eventKind === 'challenge_changes_requested') {
            const reviewedActor = normalizeString(event.payload.actorPubkey);
            if (!reviewedActor) continue;
            const decision = {
                actorPubkey: reviewedActor,
                reason: normalizeString(event.payload.reason),
                eventId: event.eventId,
            };
            if (event.eventKind === 'challenge_accepted') acceptedByActor[reviewedActor] = decision;
            if (event.eventKind === 'challenge_rejected') rejectedByActor[reviewedActor] = decision;
            if (event.eventKind === 'challenge_changes_requested') changesRequestedByActor[reviewedActor] = decision;
        }
    }
    const submissionCount = Object.keys(submissionsByActor).length;
    const acceptedCount = Object.keys(acceptedByActor).length;
    const rejectedCount = Object.keys(rejectedByActor).length;
    const changesRequestedCount = Object.keys(changesRequestedByActor).length;
    const reviewedActors = new Set([
        ...Object.keys(acceptedByActor),
        ...Object.keys(rejectedByActor),
        ...Object.keys(changesRequestedByActor),
    ]);
    return {
        state: {
            submissionsByActor,
            acceptedByActor,
            rejectedByActor,
            changesRequestedByActor,
        },
        summary: {
            submissionCount,
            acceptedCount,
            rejectedCount,
            changesRequestedCount,
            unresolvedCount: Math.max(0, submissionCount - reviewedActors.size),
            latestSubmissions: Object.values(submissionsByActor).slice(-MAX_SUMMARY_PREVIEWS),
            acceptedEntries: Object.values(acceptedByActor).slice(-MAX_SUMMARY_PREVIEWS),
            rejectedEntries: Object.values(rejectedByActor).slice(-MAX_SUMMARY_PREVIEWS),
            changesRequestedEntries: Object.values(changesRequestedByActor).slice(-MAX_SUMMARY_PREVIEWS),
        },
    };
}

function projectChoiceVotes(
    events: PlazaAnchoredInteractionEventRecord[],
    options: { voteKind: string; removeKind?: string },
): {
    votesByActor: Record<string, Record<string, unknown>>;
    participantCount: number;
    totalSelections: number;
    optionCounts: Record<string, number>;
} {
    const votesByActor: Record<string, Record<string, unknown>> = {};
    for (const event of events) {
        const actor = normalizeActor(event.actorPubkey);
        if (!actor) continue;
        if (options.removeKind && event.eventKind === options.removeKind) {
            delete votesByActor[actor];
            continue;
        }
        if (event.eventKind !== options.voteKind) continue;
        const optionIds = normalizeVoteOptionIds(event.payload);
        if (optionIds.length === 0) continue;
        votesByActor[actor] = {
            optionId: optionIds[0],
            optionIds,
            ...optionalStringEntry('note', event.payload.note),
            eventId: event.eventId,
        };
    }

    const optionCounts: Record<string, number> = {};
    for (const vote of Object.values(votesByActor)) {
        const optionIds = Array.isArray(vote.optionIds)
            ? vote.optionIds.map(normalizeString).filter((item): item is string => Boolean(item))
            : normalizeString(vote.optionId)
                ? [normalizeString(vote.optionId) as string]
                : [];
        for (const optionId of optionIds) {
            optionCounts[optionId] = (optionCounts[optionId] || 0) + 1;
        }
    }
    return {
        votesByActor,
        participantCount: Object.keys(votesByActor).length,
        totalSelections: Object.values(optionCounts).reduce((sum, count) => sum + count, 0),
        optionCounts,
    };
}

function projectAnnouncement(events: PlazaAnchoredInteractionEventRecord[]): AnchoredInteractionProjection {
    const readByActor: Record<string, Record<string, unknown>> = {};
    for (const event of events) {
        const actor = normalizeActor(event.actorPubkey);
        if (!actor || event.eventKind !== 'announcement_read') continue;
        readByActor[actor] = { actorPubkey: actor, eventId: event.eventId };
    }
    return {
        state: { readByActor },
        summary: { readCount: Object.keys(readByActor).length },
    };
}

function projectSupport(events: PlazaAnchoredInteractionEventRecord[]): AnchoredInteractionProjection {
    const supportByActor: Record<string, Record<string, unknown>> = {};
    for (const event of events) {
        const actor = normalizeActor(event.actorPubkey);
        if (!actor) continue;
        if (event.eventKind === 'support_removed') {
            delete supportByActor[actor];
            continue;
        }
        if (event.eventKind !== 'support_added') continue;
        const weight = normalizePositiveNumber(event.payload.weight) || 1;
        supportByActor[actor] = { actorPubkey: actor, weight, eventId: event.eventId };
    }
    const totalWeight = Object.values(supportByActor)
        .reduce((sum, item) => sum + (normalizePositiveNumber(item.weight) || 0), 0);
    return {
        state: { supportByActor },
        summary: {
            supportCount: Object.keys(supportByActor).length,
            totalWeight,
        },
    };
}

function projectTip(events: PlazaAnchoredInteractionEventRecord[]): AnchoredInteractionProjection {
    const receiptsById: Record<string, Record<string, unknown>> = {};
    const failuresByEventId: Record<string, Record<string, unknown>> = {};
    for (const event of events) {
        if (event.eventKind === 'tip_transfer_recorded') {
            const receiptId = normalizeString(event.payload.receiptId);
            if (!receiptId) continue;
            receiptsById[receiptId] = {
                receiptId,
                actorPubkey: event.actorPubkey,
                signature: normalizeString(event.payload.signature),
                assetType: normalizeString(event.payload.assetType),
                amount: normalizeString(event.payload.amount),
                recipientPubkey: normalizeString(event.payload.recipientPubkey),
                status: normalizeString(event.payload.status),
                eventId: event.eventId,
            };
        }
        if (event.eventKind === 'tip_transfer_failed') {
            failuresByEventId[event.eventId] = {
                actorPubkey: event.actorPubkey,
                reasonCode: normalizeString(event.payload.reasonCode),
                eventId: event.eventId,
            };
        }
    }
    return {
        state: { receiptsById, failuresByEventId },
        summary: {
            receiptCount: Object.keys(receiptsById).length,
            failureCount: Object.keys(failuresByEventId).length,
            latestReceipts: Object.values(receiptsById).slice(-MAX_SUMMARY_PREVIEWS),
        },
    };
}

function projectBounty(events: PlazaAnchoredInteractionEventRecord[]): AnchoredInteractionProjection {
    const submissionsByActor: Record<string, Record<string, unknown>> = {};
    const rejectedByActor: Record<string, Record<string, unknown>> = {};
    let acceptedCompletion: Record<string, unknown> | null = null;
    for (const event of events) {
        const actor = normalizeActor(event.actorPubkey);
        if (event.eventKind === 'bounty_submitted' && actor) {
            submissionsByActor[actor] = {
                actorPubkey: actor,
                text: normalizeString(event.payload.text),
                eventId: event.eventId,
            };
        }
        if (event.eventKind === 'bounty_completion_accepted') {
            const acceptedActor = normalizeString(event.payload.actorPubkey);
            if (acceptedActor) {
                acceptedCompletion = {
                    actorPubkey: acceptedActor,
                    eventId: event.eventId,
                };
            }
        }
        if (event.eventKind === 'bounty_completion_rejected') {
            const rejectedActor = normalizeString(event.payload.actorPubkey);
            if (rejectedActor) {
                rejectedByActor[rejectedActor] = {
                    actorPubkey: rejectedActor,
                    reason: normalizeString(event.payload.reason),
                    eventId: event.eventId,
                };
            }
        }
    }
    const reviewedActors = new Set([
        ...Object.keys(rejectedByActor),
        ...(normalizeString(acceptedCompletion?.actorPubkey) ? [normalizeString(acceptedCompletion?.actorPubkey) as string] : []),
    ]);
    const submissionCount = Object.keys(submissionsByActor).length;
    return {
        state: { submissionsByActor, acceptedCompletion, rejectedByActor },
        summary: {
            submissionCount,
            rejectedCount: Object.keys(rejectedByActor).length,
            unresolvedCount: Math.max(0, submissionCount - reviewedActors.size),
            acceptedCompletion,
            rejectedEntries: Object.values(rejectedByActor).slice(-MAX_SUMMARY_PREVIEWS),
            latestSubmissions: Object.values(submissionsByActor).slice(-MAX_SUMMARY_PREVIEWS),
        },
    };
}

function normalizeActor(value: unknown): string | null {
    return normalizeString(value);
}

function normalizeString(value: unknown): string | null {
    return typeof value === 'string' && value.trim() ? value.trim() : null;
}

function normalizeVoteOptionIds(payload: Record<string, unknown>): string[] {
    const legacyOptionId = normalizeString(payload.optionId);
    const optionIds = Array.isArray(payload.optionIds)
        ? payload.optionIds.map(normalizeString).filter((item): item is string => Boolean(item))
        : legacyOptionId
            ? [legacyOptionId]
            : [];
    return [...new Set(optionIds)].slice(0, 12);
}

function optionalStringEntry(key: string, value: unknown): Record<string, string> {
    const normalized = normalizeString(value);
    return normalized ? { [key]: normalized } : {};
}

function normalizePositiveNumber(value: unknown): number | null {
    return typeof value === 'number' && Number.isFinite(value) && value > 0 ? value : null;
}

function normalizePollOptions(value: unknown): Array<{ id: string; label: string }> {
    if (!Array.isArray(value)) return [];
    return value
        .slice(0, 12)
        .map((item) => item && typeof item === 'object' && !Array.isArray(item) ? item as Record<string, unknown> : null)
        .filter((item): item is Record<string, unknown> => Boolean(item))
        .map((item) => ({
            id: normalizeString(item.id) || '',
            label: normalizeString(item.label) || '',
        }))
        .filter((item) => item.id && item.label);
}

function normalizeStringArray(value: unknown): string[] {
    if (!Array.isArray(value)) return [];
    return value.map(normalizeString).filter((item): item is string => Boolean(item)).slice(0, 24);
}

function normalizeStringRecord(value: unknown): Record<string, string> | null {
    if (!value || typeof value !== 'object' || Array.isArray(value)) return null;
    const output: Record<string, string> = {};
    for (const [key, raw] of Object.entries(value)) {
        const normalizedValue = normalizeString(raw);
        if (key && normalizedValue) output[key] = normalizedValue;
    }
    return Object.keys(output).length > 0 ? output : null;
}
