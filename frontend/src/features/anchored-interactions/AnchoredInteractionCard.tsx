'use client';

import { useEffect, useState } from 'react';
import { Check, CircleDot, FileText, SendHorizonal } from 'lucide-react';

import type { DiscussionAnchoredInteractionDto, PlazaAnchoredInteractionType } from './types.ts';
import {
    CHALLENGE_TRUST_VOTE_OPTIONS,
    getChallengeInteractionMode,
} from './eventRegistry.ts';
import styles from './AnchoredInteractionCard.module.css';

export interface AnchoredInteractionEventDraft {
    eventKind: string;
    payload: Record<string, unknown>;
}

interface AnchoredInteractionCardProps {
    interaction: DiscussionAnchoredInteractionDto;
    typeLabels: Record<PlazaAnchoredInteractionType, string>;
    statusLabel: string;
    actionLabels: Record<PlazaAnchoredInteractionType, string>;
    resolveLabels: Record<PlazaAnchoredInteractionType, string>;
    viewDetailsLabel: string;
    submissionPlaceholder: string;
    challengeTrustVoteLabels: {
        agree: string;
        disagree: string;
    };
    signupDisplayNameDefault: string;
    signupDisplayNameLabel: string;
    canManageInteraction?: boolean;
    managementLabels: {
        reviewSubmissions: string;
        accept: string;
        reject: string;
        requestChanges: string;
    };
    emptyLabels: {
        participants: string;
        votes: string;
        supporters: string;
        reads: string;
        submissions: string;
        tips: string;
    };
    tipSummaryLabels: {
        receipt: string;
        transaction: string;
        failed: string;
        latestReceipt: (values: { actor: string; amount: string; asset: string }) => string;
        totalReceipts: (values: { count: string }) => string;
        addTip: string;
        sameNameMember: string;
    };
    pendingKey: string | null;
    errorMessage: string | null;
    viewerPubkey?: string | null;
    selected?: boolean;
    onParticipate?: (interaction: DiscussionAnchoredInteractionDto, event: AnchoredInteractionEventDraft) => void;
    onOpenTipTransfer?: (interaction: DiscussionAnchoredInteractionDto) => void;
    onResolve?: (interaction: DiscussionAnchoredInteractionDto) => void;
    onOpenDetails?: (interaction: DiscussionAnchoredInteractionDto) => void;
}

export default function AnchoredInteractionCard({
    interaction,
    typeLabels,
    statusLabel,
    actionLabels,
    resolveLabels,
    viewDetailsLabel,
    submissionPlaceholder,
    challengeTrustVoteLabels,
    signupDisplayNameDefault,
    signupDisplayNameLabel,
    canManageInteraction = false,
    managementLabels,
    emptyLabels,
    tipSummaryLabels,
    pendingKey,
    errorMessage,
    viewerPubkey = null,
    selected = false,
    onParticipate,
    onOpenTipTransfer,
    onResolve,
    onOpenDetails,
}: AnchoredInteractionCardProps) {
    const [submissionText, setSubmissionText] = useState('');
    const [signupDisplayName, setSignupDisplayName] = useState(signupDisplayNameDefault);
    useEffect(() => {
        setSignupDisplayName(signupDisplayNameDefault);
    }, [interaction.interactionId, signupDisplayNameDefault]);
    const [selectedChoiceOptionIds, setSelectedChoiceOptionIds] = useState<string[]>([]);
    const projectedChoiceOptionIds = getViewerChoiceSelection(interaction, viewerPubkey);
    const projectedChoiceSelectionKey = projectedChoiceOptionIds.join('\u0000');
    useEffect(() => {
        setSelectedChoiceOptionIds(projectedChoiceOptionIds);
    }, [interaction.interactionId, projectedChoiceSelectionKey]);
    const isLegacyAnnouncement = interaction.interactionType === 'announcement';
    if (isLegacyAnnouncement) {
        return (
            <div
                className={styles.anchoredCard}
                data-testid="anchored-interaction-card"
                data-legacy-announcement-card="true"
                data-anchored-interaction-id={interaction.interactionId}
                data-anchored-anchor-type={interaction.anchor.type}
                data-anchored-anchor-ref={interaction.anchor.ref}
                data-anchored-interaction-selected={selected ? 'true' : undefined}
            >
                <span className={styles.rail} aria-hidden="true" />
                <div className={styles.cardBody}>
                    <div className={styles.cardHeader}>
                        <span className={styles.cardTitle}>{typeLabels[interaction.interactionType]}</span>
                    </div>
                    <p className={styles.summaryText}>
                        {renderSummary(interaction, emptyLabels, tipSummaryLabels, challengeTrustVoteLabels)}
                    </p>
                    {onOpenDetails && (
                        <div className={styles.actionRow}>
                            <button
                                type="button"
                                className={styles.textAction}
                                onClick={() => onOpenDetails(interaction)}
                            >
                                <FileText size={13} />
                                {viewDetailsLabel}
                            </button>
                        </div>
                    )}
                </div>
            </div>
        );
    }
    const isTrustVoteChallenge = isChallengeTrustVote(interaction);
    const challengeReason = renderChallengeReason(interaction);
    const event = buildDefaultEvent(interaction);
    const requiresSubmissionText = (interaction.interactionType === 'challenge' && !isTrustVoteChallenge)
        || interaction.interactionType === 'bounty';
    const preparedEvent = interaction.interactionType === 'signup'
        ? { ...event, payload: { ...event.payload, displayName: signupDisplayName.trim() } }
        : requiresSubmissionText
            ? { ...event, payload: { ...event.payload, text: submissionText.trim() } }
            : event;
    const actionKey = `${interaction.interactionId}:${event.eventKind}`;
    const resolveKey = `${interaction.interactionId}:resolve`;
    const isPending = pendingKey === actionKey;
    const isResolving = pendingKey === resolveKey;
    const isInteractionBusy = Boolean(pendingKey?.startsWith(`${interaction.interactionId}:`));
    const pollOptions = normalizeOptions(interaction.state.options);
    const challengeTrustVoteOptions = isTrustVoteChallenge
        ? normalizeChallengeTrustVoteOptions(interaction.state.options, challengeTrustVoteLabels)
        : [];
    const choiceVoteOptions = interaction.interactionType === 'poll'
        ? pollOptions
        : challengeTrustVoteOptions;
    const canParticipate = Boolean(onParticipate) && interaction.status === 'open';
    const canOpenTipTransfer = Boolean(onOpenTipTransfer) && interaction.interactionType === 'tip' && interaction.status === 'open';
    const canResolve = Boolean(onResolve) && canResolveInteractionResult(interaction, canManageInteraction);
    const isMultipleChoicePoll = interaction.interactionType === 'poll' && interaction.state.multipleChoice === true;
    const canSubmitPollSelection = !isMultipleChoicePoll || selectedChoiceOptionIds.length > 0;
    const reviewableSubmissions = getReviewableSubmissions(interaction);
    const showReviewActions = Boolean(onParticipate)
        && canManageInteraction
        && !isChallengeTrustVote(interaction)
        && interaction.status === 'open'
        && reviewableSubmissions.length > 0;
    const canSubmitPrimary = (canParticipate || canOpenTipTransfer) && (
        interaction.interactionType === 'signup'
            ? signupDisplayName.trim().length > 0
            : (!requiresSubmissionText || submissionText.trim().length > 0)
    );
    return (
        <div
            className={styles.anchoredCard}
            data-testid="anchored-interaction-card"
            data-anchored-interaction-id={interaction.interactionId}
            data-anchored-anchor-type={interaction.anchor.type}
            data-anchored-anchor-ref={interaction.anchor.ref}
            data-anchored-interaction-selected={selected ? 'true' : undefined}
        >
            <span className={styles.rail} aria-hidden="true" />
            <div className={styles.cardBody}>
                <div className={styles.cardHeader}>
                    <span className={styles.cardTitle}>{typeLabels[interaction.interactionType]}</span>
                    <span className={styles.statusPill}>{statusLabel}</span>
                </div>
                {challengeReason && <p className={styles.challengeReasonText}>{challengeReason}</p>}
                <p className={styles.summaryText}>
                    {renderSummary(interaction, emptyLabels, tipSummaryLabels, challengeTrustVoteLabels)}
                </p>
                {requiresSubmissionText && interaction.status === 'open' && (
                    <input
                        className={styles.inlineInput}
                        value={submissionText}
                        placeholder={submissionPlaceholder}
                        disabled={isInteractionBusy}
                        onChange={(event) => setSubmissionText(event.target.value)}
                    />
                )}
                {interaction.interactionType === 'signup' && interaction.status === 'open' && (
                    <input
                        className={styles.inlineInput}
                        value={signupDisplayName}
                        placeholder={signupDisplayNameLabel}
                        disabled={isInteractionBusy}
                        onChange={(event) => setSignupDisplayName(event.target.value)}
                    />
                )}
                <div className={styles.actionRow}>
                    {choiceVoteOptions.length > 0 ? (
                        choiceVoteOptions.map((option) => {
                            const optionSelected = selectedChoiceOptionIds.includes(option.id);
                            const nextSelectedChoiceOptionIds = optionSelected
                                ? selectedChoiceOptionIds.filter((item) => item !== option.id)
                                : [...selectedChoiceOptionIds, option.id];
                            const optionEvent = {
                                eventKind: interaction.interactionType === 'challenge' ? 'challenge_voted' : 'poll_voted',
                                payload: interaction.interactionType === 'poll' && isMultipleChoicePoll
                                    ? { optionIds: nextSelectedChoiceOptionIds }
                                    : { optionId: option.id },
                            };
                            const optionKey = `${interaction.interactionId}:${optionEvent.eventKind}:${option.id}`;
                            const optionPending = pendingKey === optionKey || isPending;
                            return (
                                <button
                                    key={option.id}
                                    type="button"
                                    className={optionSelected
                                        ? `${styles.primaryAction} ${styles.primaryActionSelected}`
                                        : styles.primaryAction}
                                    aria-pressed={optionSelected}
                                    disabled={!canSubmitPrimary || isInteractionBusy}
                                    onClick={() => {
                                        if (interaction.interactionType === 'poll' && isMultipleChoicePoll) {
                                            setSelectedChoiceOptionIds((prev) => prev.includes(option.id)
                                                ? prev.filter((item) => item !== option.id)
                                                : [...prev, option.id]);
                                            return;
                                        }
                                        setSelectedChoiceOptionIds([option.id]);
                                        onParticipate?.(interaction, optionEvent);
                                    }}
                                >
                                    {optionPending ? <CircleDot size={13} /> : <Check size={13} />}
                                    {option.label}
                                </button>
                            );
                        })
                    ) : interaction.interactionType === 'tip' ? (
                        <button
                            type="button"
                            className={styles.primaryAction}
                            disabled={!canOpenTipTransfer || isInteractionBusy}
                            onClick={() => onOpenTipTransfer?.(interaction)}
                        >
                            {isPending ? <CircleDot size={13} /> : <SendHorizonal size={13} />}
                            {tipSummaryLabels.addTip}
                        </button>
                    ) : (
                        <button
                            type="button"
                            className={styles.primaryAction}
                            disabled={!canSubmitPrimary || isInteractionBusy}
                            onClick={() => onParticipate?.(interaction, preparedEvent)}
                        >
                            {isPending ? <CircleDot size={13} /> : <SendHorizonal size={13} />}
                            {resolveActionLabel(actionLabels, interaction.interactionType)}
                        </button>
                    )}
                    {isMultipleChoicePoll && (
                        <button
                            type="button"
                            className={styles.textAction}
                            disabled={!canParticipate || !canSubmitPollSelection || isInteractionBusy}
                            onClick={() => onParticipate?.(interaction, {
                                eventKind: 'poll_voted',
                                payload: { optionIds: selectedChoiceOptionIds },
                            })}
                        >
                            {isPending ? <CircleDot size={13} /> : <SendHorizonal size={13} />}
                            {actionLabels.poll}
                        </button>
                    )}
                    {canResolve && (
                        <button
                            type="button"
                            className={styles.textAction}
                            disabled={isInteractionBusy}
                            onClick={() => onResolve?.(interaction)}
                        >
                            {isResolving ? <CircleDot size={13} /> : <Check size={13} />}
                            {resolveLabels[interaction.interactionType]}
                        </button>
                    )}
                    {onOpenDetails && (
                        <button
                            type="button"
                            className={styles.textAction}
                            onClick={() => onOpenDetails(interaction)}
                        >
                            <FileText size={13} />
                            {viewDetailsLabel}
                        </button>
                    )}
                </div>
                {showReviewActions && (
                    <div className={styles.reviewPanel}>
                        <div className={styles.reviewTitle}>{managementLabels.reviewSubmissions}</div>
                        {reviewableSubmissions.map((submission) => (
                            <div className={styles.reviewItem} key={`${interaction.interactionId}:${submission.actorPubkey}`}>
                                <div className={styles.reviewMeta}>
                                    <span>{submission.actorLabel}</span>
                                    {submission.text && <span>{submission.text}</span>}
                                </div>
                                <div className={styles.actionRow}>
                                    <button
                                        type="button"
                                        className={styles.primaryAction}
                                        disabled={isInteractionBusy}
                                        onClick={() => onParticipate?.(interaction, buildReviewEvent(interaction, submission.actorPubkey, 'accept'))}
                                    >
                                        {managementLabels.accept}
                                    </button>
                                    <button
                                        type="button"
                                        className={styles.textAction}
                                        disabled={isInteractionBusy}
                                        onClick={() => onParticipate?.(interaction, buildReviewEvent(interaction, submission.actorPubkey, 'reject'))}
                                    >
                                        {managementLabels.reject}
                                    </button>
                                    {interaction.interactionType === 'challenge' && (
                                        <button
                                            type="button"
                                            className={styles.textAction}
                                            disabled={isInteractionBusy}
                                            onClick={() => onParticipate?.(interaction, buildReviewEvent(interaction, submission.actorPubkey, 'changes'))}
                                        >
                                            {managementLabels.requestChanges}
                                        </button>
                                    )}
                                </div>
                            </div>
                        ))}
                    </div>
                )}
                {errorMessage && <p className={styles.errorText}>{errorMessage}</p>}
            </div>
        </div>
    );
}

function buildDefaultEvent(interaction: DiscussionAnchoredInteractionDto): AnchoredInteractionEventDraft {
    if (interaction.interactionType === 'signup') {
        return {
            eventKind: 'signup_joined',
            payload: { displayName: '' },
        };
    }
    if (interaction.interactionType === 'poll') {
        const options = normalizeOptions(interaction.state.options);
        return { eventKind: 'poll_voted', payload: { optionId: options[0]?.id || 'option_1' } };
    }
    if (interaction.interactionType === 'announcement') {
        throw new Error('legacy_announcement_event_disabled');
    }
    if (interaction.interactionType === 'support') {
        return { eventKind: 'support_added', payload: { weight: 1 } };
    }
    if (interaction.interactionType === 'tip') {
        const mint = normalizeString(interaction.state.mint);
        return {
            eventKind: 'tip_transfer_initiated',
            payload: {
                recipientPubkey: normalizeString(interaction.state.recipientPubkey) || '',
                assetType: normalizeString(interaction.state.assetType) || 'SOL',
                amount: normalizeString(interaction.state.amount) || '',
                ...(mint ? { mint } : {}),
            },
        };
    }
    if (interaction.interactionType === 'bounty') {
        return { eventKind: 'bounty_submitted', payload: { text: '' } };
    }
    if (isChallengeTrustVote(interaction)) {
        return { eventKind: 'challenge_voted', payload: { optionId: 'agree_challenge' } };
    }
    return { eventKind: 'challenge_submitted', payload: { text: '' } };
}

function resolveActionLabel(
    labels: Record<PlazaAnchoredInteractionType, string>,
    interactionType: PlazaAnchoredInteractionType,
): string {
    return labels[interactionType];
}

function renderSummary(
    interaction: DiscussionAnchoredInteractionDto,
    emptyLabels: AnchoredInteractionCardProps['emptyLabels'],
    tipSummaryLabels: AnchoredInteractionCardProps['tipSummaryLabels'],
    challengeTrustVoteLabels: AnchoredInteractionCardProps['challengeTrustVoteLabels'],
): string {
    if (interaction.interactionType === 'poll') {
        const counts = interaction.summary.optionCounts;
        if (counts && typeof counts === 'object' && !Array.isArray(counts)) {
            return Object.entries(counts)
                .map(([optionId, count]) => `${optionId}: ${count}`)
                .join(' · ') || emptyLabels.votes;
        }
        return emptyLabels.votes;
    }
    if (isChallengeTrustVote(interaction)) {
        const optionCounts = toNumberRecord(interaction.summary.optionCounts);
        const labels: Record<string, string> = {
            agree_challenge: challengeTrustVoteLabels.agree,
            disagree_challenge: challengeTrustVoteLabels.disagree,
        };
        const rendered = Object.entries(optionCounts)
            .map(([optionId, count]) => `${labels[optionId] || optionId}: ${count}`)
            .join(' · ');
        return rendered || emptyLabels.votes;
    }
    if (interaction.interactionType === 'signup') {
        const count = Number(interaction.summary.participantCount || 0);
        return count > 0 ? String(count) : emptyLabels.participants;
    }
    if (interaction.interactionType === 'support') {
        const count = Number(interaction.summary.supportCount || 0);
        return count > 0 ? String(count) : emptyLabels.supporters;
    }
    if (interaction.interactionType === 'announcement') {
        const count = Number(interaction.summary.readCount || 0);
        return count > 0 ? String(count) : emptyLabels.reads;
    }
    if (interaction.interactionType === 'tip') {
        const receiptCount = Number(interaction.summary.receiptCount || 0);
        const failureCount = Number(interaction.summary.failureCount || 0);
        const latestReceipts = normalizeSummaryEntries(interaction.summary.latestReceipts);
        const latestReceipt = latestReceipts[latestReceipts.length - 1];
        if (latestReceipt) {
            const latest = formatTipReceiptSummary(latestReceipt, tipSummaryLabels);
            return receiptCount > 1
                ? `${latest} · ${tipSummaryLabels.totalReceipts({ count: String(receiptCount) })}`
                : latest;
        }
        if (receiptCount > 0) return `${tipSummaryLabels.receipt} ${receiptCount} · ${tipSummaryLabels.transaction}`;
        return failureCount > 0
            ? `${tipSummaryLabels.failed} ${failureCount}`
            : emptyLabels.tips;
    }
    const count = Number(interaction.summary.submissionCount || 0);
    return count > 0 ? String(count) : emptyLabels.submissions;
}

function renderChallengeReason(interaction: DiscussionAnchoredInteractionDto): string | null {
    if (!isChallengeTrustVote(interaction)) return null;
    return normalizeString(interaction.state.reason);
}

function getViewerChoiceSelection(
    interaction: DiscussionAnchoredInteractionDto,
    viewerPubkey: string | null | undefined,
): string[] {
    if (!viewerPubkey) return [];
    if (!(interaction.interactionType === 'poll' || isChallengeTrustVote(interaction))) return [];
    const votesByActor = normalizeRecord(interaction.state.votesByActor);
    const viewerVote = votesByActor ? normalizeRecord(votesByActor[viewerPubkey]) : null;
    if (!viewerVote) return [];
    const optionIds = Array.isArray(viewerVote.optionIds)
        ? viewerVote.optionIds.map(normalizeString).filter((item): item is string => Boolean(item))
        : [];
    if (optionIds.length > 0) return optionIds;
    const optionId = normalizeString(viewerVote.optionId);
    return optionId ? [optionId] : [];
}

function canResolveInteractionResult(
    interaction: DiscussionAnchoredInteractionDto,
    canManageInteraction: boolean,
): boolean {
    if (interaction.status !== 'open') return false;
    if (interaction.interactionType === 'challenge') {
        if (isChallengeTrustVote(interaction)) return true;
        return canManageInteraction;
    }
    if (interaction.interactionType === 'bounty') {
        return canManageInteraction;
    }
    return interaction.interactionType === 'signup' || interaction.interactionType === 'poll';
}

function normalizeOptions(value: unknown): Array<{ id: string; label: string }> {
    if (!Array.isArray(value)) return [];
    return value
        .map((item) => item && typeof item === 'object' && !Array.isArray(item) ? item as Record<string, unknown> : null)
        .filter((item): item is Record<string, unknown> => Boolean(item))
        .map((item) => ({
            id: typeof item.id === 'string' && item.id.trim() ? item.id.trim() : '',
            label: typeof item.label === 'string' && item.label.trim() ? item.label.trim() : '',
        }))
        .filter((item) => item.id && item.label);
}

function normalizeString(value: unknown): string | null {
    return typeof value === 'string' && value.trim() ? value.trim() : null;
}

function isChallengeTrustVote(interaction: DiscussionAnchoredInteractionDto): boolean {
    return interaction.interactionType === 'challenge'
        && getChallengeInteractionMode(interaction.state) === 'credibility_vote';
}

function normalizeChallengeTrustVoteOptions(
    value: unknown,
    labels: AnchoredInteractionCardProps['challengeTrustVoteLabels'],
): Array<{ id: string; label: string }> {
    const ids = new Set(normalizeOptions(value).map((option) => option.id));
    return CHALLENGE_TRUST_VOTE_OPTIONS
        .filter((option) => ids.size === 0 || ids.has(option.id))
        .map((option) => ({
            id: option.id,
            label: option.id === 'agree_challenge' ? labels.agree : labels.disagree,
        }));
}

function toNumberRecord(value: unknown): Record<string, number> {
    if (!value || typeof value !== 'object' || Array.isArray(value)) return {};
    const output: Record<string, number> = {};
    for (const [key, raw] of Object.entries(value)) {
        if (typeof raw === 'number' && Number.isFinite(raw)) output[key] = raw;
    }
    return output;
}

function normalizeSummaryEntries(value: unknown): Array<Record<string, unknown>> {
    if (!Array.isArray(value)) return [];
    return value
        .map((item) => item && typeof item === 'object' && !Array.isArray(item)
            ? item as Record<string, unknown>
            : null)
        .filter((item): item is Record<string, unknown> => Boolean(item));
}

function getReviewableSubmissions(interaction: DiscussionAnchoredInteractionDto): Array<{
    actorPubkey: string;
    actorLabel: string;
    text: string | null;
}> {
    if (isChallengeTrustVote(interaction)) return [];
    if (interaction.interactionType !== 'challenge' && interaction.interactionType !== 'bounty') return [];
    const reviewedActors = new Set<string>();
    for (const key of ['acceptedByActor', 'rejectedByActor', 'changesRequestedByActor']) {
        for (const entry of normalizeRecordMapEntries(interaction.state[key])) {
            const actorPubkey = normalizeString(entry.actorPubkey);
            if (actorPubkey) reviewedActors.add(actorPubkey);
        }
    }
    for (const key of ['acceptedEntries', 'rejectedEntries', 'changesRequestedEntries']) {
        for (const entry of normalizeSummaryEntries(interaction.summary[key])) {
            const actorPubkey = normalizeString(entry.actorPubkey);
            if (actorPubkey) reviewedActors.add(actorPubkey);
        }
    }
    const acceptedCompletion = normalizeRecord(interaction.state.acceptedCompletion)
        || normalizeRecord(interaction.summary.acceptedCompletion);
    if (acceptedCompletion && typeof acceptedCompletion === 'object' && !Array.isArray(acceptedCompletion)) {
        const actorPubkey = normalizeString(acceptedCompletion.actorPubkey);
        if (actorPubkey) reviewedActors.add(actorPubkey);
    }
    const stateSubmissions = normalizeRecordMapEntries(interaction.state.submissionsByActor);
    const submissions = stateSubmissions.length > 0
        ? stateSubmissions
        : normalizeSummaryEntries(interaction.summary.latestSubmissions);
    return submissions
        .map((entry) => ({
            actorPubkey: normalizeString(entry.actorPubkey) || '',
            actorLabel: normalizeString(entry.actorEffectiveDisplayName) || normalizeString(entry.actorDisplayName) || 'A member',
            text: normalizeString(entry.text),
        }))
        .filter((entry) => entry.actorPubkey && !reviewedActors.has(entry.actorPubkey));
}

function normalizeRecord(value: unknown): Record<string, unknown> | null {
    return value && typeof value === 'object' && !Array.isArray(value)
        ? value as Record<string, unknown>
        : null;
}

function normalizeRecordMapEntries(value: unknown): Array<Record<string, unknown>> {
    const record = normalizeRecord(value);
    if (!record) return [];
    return Object.values(record)
        .map((item) => normalizeRecord(item))
        .filter((item): item is Record<string, unknown> => Boolean(item));
}

function buildReviewEvent(
    interaction: DiscussionAnchoredInteractionDto,
    actorPubkey: string,
    decision: 'accept' | 'reject' | 'changes',
): AnchoredInteractionEventDraft {
    if (interaction.interactionType === 'bounty') {
        return {
            eventKind: decision === 'accept' ? 'bounty_completion_accepted' : 'bounty_completion_rejected',
            payload: { actorPubkey },
        };
    }
    if (decision === 'changes') {
        return {
            eventKind: 'challenge_changes_requested',
            payload: { actorPubkey, reason: 'needs_revision' },
        };
    }
    return {
        eventKind: decision === 'accept' ? 'challenge_accepted' : 'challenge_rejected',
        payload: { actorPubkey },
    };
}

function formatTipReceiptSummary(
    receipt: Record<string, unknown>,
    labels: AnchoredInteractionCardProps['tipSummaryLabels'],
): string {
    const actorLabel = normalizeString(receipt.actorDisplaySnapshot)
        || normalizeString(receipt.actorEffectiveDisplayName)
        || normalizeString(receipt.actorDisplayName)
        || 'A member';
    const recipientLabel = normalizeString(receipt.recipientDisplaySnapshot)
        || normalizeString(receipt.recipientEffectiveDisplayName)
        || normalizeString(receipt.recipientDisplayName);
    const actor = formatReceiptPartyLabel(
        actorLabel,
        Boolean(receipt.actorNeedsDisplayDisambiguation),
        labels.sameNameMember,
    );
    const recipient = recipientLabel
        ? formatReceiptPartyLabel(
            recipientLabel,
            Boolean(receipt.recipientNeedsDisplayDisambiguation),
            labels.sameNameMember,
        )
        : null;
    const party = recipient ? `${actor} -> ${recipient}` : actor;
    const amount = normalizeString(receipt.amount) || '0';
    const asset = normalizeString(receipt.assetType) || 'SOL';
    return labels.latestReceipt({ actor: party, amount, asset });
}

function formatReceiptPartyLabel(name: string, needsDisambiguation: boolean, sameNameMemberLabel: string): string {
    if (!needsDisambiguation) return name;
    return `${name} (${sameNameMemberLabel})`;
}
