import { createHash } from 'crypto';

import type {
    DiscussionAnchoredInteractionDto,
    PlazaAnchoredInteractionType,
} from './types';
import { getChallengeInteractionMode } from './eventRegistry';

export interface ResolveAnchoredInteractionResultInput {
    interaction: DiscussionAnchoredInteractionDto;
    now: Date;
    policy?: {
        minParticipants?: number;
        dominantRatio?: number;
    };
}

export interface ResolvedAnchoredInteractionResult {
    status: 'pending' | 'ignored' | 'resolved';
    reasonCode: string;
    humanSummary: string;
    resultDigest: string;
    resultPayload: Record<string, unknown>;
    sourceEventIds: string[];
}

export function resolveAnchoredInteractionResult(
    input: ResolveAnchoredInteractionResultInput,
): ResolvedAnchoredInteractionResult {
    const minParticipants = normalizePositiveInteger(input.policy?.minParticipants) || 2;
    const dominantRatio = normalizeRatio(input.policy?.dominantRatio) || 2 / 3;

    switch (input.interaction.interactionType) {
        case 'signup':
            return resolveSignup(input.interaction, minParticipants);
        case 'poll':
            return resolvePoll(input.interaction, minParticipants, dominantRatio);
        case 'challenge':
            return resolveChallenge(input.interaction, minParticipants, dominantRatio);
        case 'announcement':
            return buildResult('ignored', 'announcement_already_visible', 'Announcement content is already visible in the discussion.', {
                interactionId: input.interaction.interactionId,
                interactionType: input.interaction.interactionType,
            }, []);
        case 'support':
            return buildResult('ignored', 'support_not_knowledge_result', 'Support is an interaction signal, not a knowledge result by itself.', {
                interactionId: input.interaction.interactionId,
                interactionType: input.interaction.interactionType,
            }, []);
        case 'tip':
            return buildResult('ignored', 'tip_not_knowledge_result', 'Tip transfers are contribution signals, not knowledge results by themselves.', {
                interactionId: input.interaction.interactionId,
                interactionType: input.interaction.interactionType,
            }, []);
        case 'bounty':
            return resolveBounty(input.interaction);
        default:
            return unsupported(input.interaction.interactionType);
    }
}

function resolveSignup(
    interaction: DiscussionAnchoredInteractionDto,
    minParticipants: number,
): ResolvedAnchoredInteractionResult {
    const participantCount = normalizePositiveInteger(interaction.summary.participantCount) || 0;
    if (participantCount < minParticipants) {
        return buildResult('ignored', 'insufficient_participation', 'Not enough participants joined this signup.', {
            participantCount,
            minParticipants,
        }, []);
    }
    return buildResult('resolved', 'signup_participation_confirmed', `${participantCount} participants joined.`, {
        participantCount,
    }, collectRecordEventIds(interaction.state.entriesByActor, collectEventIds(interaction.summary.latestEntries)));
}

function resolvePoll(
    interaction: DiscussionAnchoredInteractionDto,
    minParticipants: number,
    dominantRatio: number,
): ResolvedAnchoredInteractionResult {
    const participantCount = normalizePositiveInteger(interaction.summary.participantCount) || 0;
    if (participantCount < minParticipants) {
        return buildResult('ignored', 'insufficient_participation', 'Not enough votes were cast.', {
            participantCount,
            minParticipants,
        }, []);
    }

    const optionCounts = normalizeNumberRecord(interaction.summary.optionCounts);
    const ranked = Object.entries(optionCounts).sort((left, right) => right[1] - left[1]);
    const [winning] = ranked;
    if (!winning) {
        return buildResult('ignored', 'poll_no_votes', 'No valid poll votes were found.', {
            participantCount,
        }, []);
    }
    const [winningOptionId, voteCount] = winning;
    const winningOptionLabel = resolvePollOptionLabel(interaction, winningOptionId);
    const ratio = participantCount > 0 ? voteCount / participantCount : 0;
    if (ratio >= dominantRatio) {
        return buildResult('resolved', 'poll_dominant_option', `Poll result: ${winningOptionLabel} received ${voteCount} of ${participantCount} votes.`, {
            winningOptionId,
            winningOptionLabel,
            voteCount,
            totalVotes: participantCount,
            ratio,
        }, collectRecordEventIds(interaction.state.votesByActor));
    }
    if (interaction.status === 'closed') {
        return buildResult('ignored', 'poll_no_dominant_option', 'The poll closed without a dominant result.', {
            optionCounts,
            participantCount,
        }, []);
    }
    return buildResult('pending', 'poll_no_dominant_option', 'The poll does not have a dominant result yet.', {
        optionCounts,
        participantCount,
    }, []);
}

function resolveChallenge(
    interaction: DiscussionAnchoredInteractionDto,
    minParticipants: number,
    dominantRatio: number,
): ResolvedAnchoredInteractionResult {
    if (getChallengeInteractionMode(interaction.state) === 'credibility_vote') {
        return resolveChallengeTrustVote(interaction, minParticipants, dominantRatio);
    }
    return resolveChallengeSubmissionReview(interaction);
}

function resolveChallengeTrustVote(
    interaction: DiscussionAnchoredInteractionDto,
    minParticipants: number,
    dominantRatio: number,
): ResolvedAnchoredInteractionResult {
    const participantCount = normalizePositiveInteger(interaction.summary.participantCount) || 0;
    if (participantCount < minParticipants) {
        return buildResult(
            interaction.status === 'closed' ? 'ignored' : 'pending',
            'insufficient_participation',
            'Not enough challenge trust votes were cast.',
            {
                participantCount,
                minParticipants,
            },
            collectRecordEventIds(interaction.state.votesByActor),
        );
    }

    const optionCounts = normalizeNumberRecord(interaction.summary.optionCounts);
    const ranked = Object.entries(optionCounts).sort((left, right) => right[1] - left[1]);
    const [winning] = ranked;
    if (!winning) {
        return buildResult(
            interaction.status === 'closed' ? 'ignored' : 'pending',
            'challenge_vote_no_votes',
            'No valid challenge trust votes were found.',
            { participantCount },
            collectRecordEventIds(interaction.state.votesByActor),
        );
    }

    const [winningOptionId, voteCount] = winning;
    const winningOptionLabel = resolvePollOptionLabel(interaction, winningOptionId);
    const ratio = participantCount > 0 ? voteCount / participantCount : 0;
    const sourceEventIds = collectRecordEventIds(interaction.state.votesByActor);
    if (winningOptionId !== 'agree_challenge' && winningOptionId !== 'disagree_challenge') {
        return buildResult(
            interaction.status === 'closed' ? 'ignored' : 'pending',
            'challenge_vote_invalid_option',
            'The challenge trust vote contains an unknown option and cannot produce an AI trust result.',
            {
                winningOptionId,
                voteCount,
                totalVotes: participantCount,
                optionCounts,
            },
            sourceEventIds,
        );
    }
    if (ratio >= dominantRatio) {
        const aiTreatment = winningOptionId === 'agree_challenge'
            ? 'withhold_trust'
            : 'retain_trust';
        const reasonCode = aiTreatment === 'withhold_trust'
            ? 'challenge_anchor_withhold_trust'
            : 'challenge_anchor_retain_trust';
        return buildResult(
            'resolved',
            reasonCode,
            `Challenge trust vote result: ${aiTreatment}; ${winningOptionLabel} received ${voteCount} of ${participantCount} votes.`,
            {
                winningOptionId,
                winningOptionLabel,
                voteCount,
                totalVotes: participantCount,
                ratio,
                optionCounts,
                challengeReason: normalizeString(interaction.state.reason),
                aiTreatment,
            },
            sourceEventIds,
        );
    }

    return buildResult(
        interaction.status === 'closed' ? 'ignored' : 'pending',
        'challenge_vote_no_dominant_option',
        interaction.status === 'closed'
            ? 'The challenge trust vote closed without a dominant result.'
            : 'The challenge trust vote does not have a dominant result yet.',
        {
            optionCounts,
            participantCount,
        },
        sourceEventIds,
    );
}

function resolveChallengeSubmissionReview(interaction: DiscussionAnchoredInteractionDto): ResolvedAnchoredInteractionResult {
    const unresolvedCount = normalizePositiveInteger(interaction.summary.unresolvedCount) || 0;
    const acceptedCount = normalizePositiveInteger(interaction.summary.acceptedCount) || 0;
    const rejectedCount = normalizePositiveInteger(interaction.summary.rejectedCount) || 0;
    const changesRequestedCount = normalizePositiveInteger(interaction.summary.changesRequestedCount) || 0;
    if (unresolvedCount > 0) {
        return buildResult('pending', 'challenge_unresolved_submissions', 'Challenge submissions still need review.', {
            unresolvedCount,
            acceptedCount,
            rejectedCount,
            changesRequestedCount,
        }, collectRecordEventIds(interaction.state.submissionsByActor, collectEventIds(interaction.summary.latestSubmissions)));
    }
    if (acceptedCount > 0 || rejectedCount > 0 || changesRequestedCount > 0) {
        return buildResult('resolved', 'challenge_submissions_reviewed', `${acceptedCount} accepted, ${rejectedCount} rejected, ${changesRequestedCount} changes requested.`, {
            acceptedCount,
            rejectedCount,
            changesRequestedCount,
        }, [
            ...collectRecordEventIds(interaction.state.acceptedByActor, collectEventIds(interaction.summary.acceptedEntries)),
            ...collectRecordEventIds(interaction.state.rejectedByActor, collectEventIds(interaction.summary.rejectedEntries)),
            ...collectRecordEventIds(interaction.state.changesRequestedByActor, collectEventIds(interaction.summary.changesRequestedEntries)),
        ]);
    }
    return buildResult('ignored', 'challenge_no_accepted_submission', 'No accepted challenge submission is available.', {
        acceptedCount,
    }, []);
}

function resolveBounty(interaction: DiscussionAnchoredInteractionDto): ResolvedAnchoredInteractionResult {
    const acceptedCompletion = normalizeRecord(interaction.summary.acceptedCompletion);
    const eventId = typeof acceptedCompletion?.eventId === 'string' ? acceptedCompletion.eventId : null;
    if (!acceptedCompletion || !eventId) {
        return buildResult('pending', 'bounty_no_accepted_completion', 'No bounty completion has been accepted yet.', {
            interactionId: interaction.interactionId,
        }, []);
    }
    return buildResult('resolved', 'bounty_completion_accepted', 'A bounty completion was accepted. Reward settlement is outside this discussion projection.', {
        acceptedCompletion,
        riskNote: 'reward_settlement_out_of_scope',
    }, [eventId]);
}

function unsupported(type: PlazaAnchoredInteractionType): ResolvedAnchoredInteractionResult {
    return buildResult('ignored', 'unsupported_anchored_interaction_type', `Unsupported interaction type: ${type}`, {
        interactionType: type,
    }, []);
}

function buildResult(
    status: ResolvedAnchoredInteractionResult['status'],
    reasonCode: string,
    humanSummary: string,
    resultPayload: Record<string, unknown>,
    sourceEventIds: string[],
): ResolvedAnchoredInteractionResult {
    const resultDigest = createHash('sha256')
        .update(stableStringify({ status, reasonCode, resultPayload, sourceEventIds }))
        .digest('hex');
    return {
        status,
        reasonCode,
        humanSummary,
        resultDigest,
        resultPayload,
        sourceEventIds,
    };
}

function normalizePositiveInteger(value: unknown): number | null {
    return typeof value === 'number' && Number.isFinite(value) && value >= 0
        ? Math.trunc(value)
        : null;
}

function normalizeRatio(value: unknown): number | null {
    return typeof value === 'number' && Number.isFinite(value) && value > 0 && value <= 1 ? value : null;
}

function normalizeNumberRecord(value: unknown): Record<string, number> {
    const record = normalizeRecord(value);
    const output: Record<string, number> = {};
    if (!record) return output;
    for (const [key, raw] of Object.entries(record)) {
        if (typeof raw === 'number' && Number.isFinite(raw) && raw > 0) {
            output[key] = raw;
        }
    }
    return output;
}

function resolvePollOptionLabel(
    interaction: DiscussionAnchoredInteractionDto,
    optionId: string,
): string {
    const options = Array.isArray(interaction.state.options)
        ? interaction.state.options
        : [];
    for (const option of options) {
        const record = normalizeRecord(option);
        if (record?.id === optionId && typeof record.label === 'string' && record.label.trim()) {
            return record.label.trim();
        }
    }
    return optionId;
}

function normalizeRecord(value: unknown): Record<string, unknown> | null {
    return value && typeof value === 'object' && !Array.isArray(value)
        ? value as Record<string, unknown>
        : null;
}

function normalizeString(value: unknown): string | null {
    return typeof value === 'string' && value.trim() ? value.trim() : null;
}

function collectEventIds(value: unknown): string[] {
    if (!Array.isArray(value)) return [];
    return value
        .map((item) => normalizeRecord(item)?.eventId)
        .filter((eventId): eventId is string => typeof eventId === 'string' && eventId.length > 0)
        .slice(0, 64);
}

function collectRecordEventIds(value: unknown, fallback: string[] = []): string[] {
    const record = normalizeRecord(value);
    const eventIds = record
        ? Object.values(record)
            .map((item) => normalizeRecord(item)?.eventId)
            .filter((eventId): eventId is string => typeof eventId === 'string' && eventId.length > 0)
        : [];
    const seen = new Set<string>();
    const output: string[] = [];
    for (const eventId of [...eventIds, ...fallback]) {
        if (seen.has(eventId)) continue;
        seen.add(eventId);
        output.push(eventId);
        if (output.length >= 64) break;
    }
    return output;
}

function stableStringify(value: unknown): string {
    if (value === null || typeof value !== 'object') return JSON.stringify(value);
    if (Array.isArray(value)) return `[${value.map(stableStringify).join(',')}]`;
    const record = value as Record<string, unknown>;
    return `{${Object.keys(record).sort().map((key) => `${JSON.stringify(key)}:${stableStringify(record[key])}`).join(',')}}`;
}
