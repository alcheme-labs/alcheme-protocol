'use client';

import { useEffect, useMemo, useState } from 'react';
import { X } from 'lucide-react';

import type { PlazaAnchoredInteractionType } from './types.ts';
import { CHALLENGE_TRUST_VOTE_OPTIONS } from './eventRegistry.ts';
import styles from './AnchoredInteractionCard.module.css';

const COMPOSER_TYPES: PlazaAnchoredInteractionType[] = [
    'signup',
    'poll',
    'challenge',
    // 'announcement', // Legacy only. New announcements use the Circle Announcements module.
    // 'support', // Promoted to the top-level Useful action on a message.
    // 'tip', // Uses the dedicated wallet transfer sheet.
    // 'bounty', // Paused until an escrow provider and custody model are selected.
];
const COMPOSER_TYPE_SET = new Set<PlazaAnchoredInteractionType>(COMPOSER_TYPES);

function isComposerInteractionType(value: PlazaAnchoredInteractionType | null | undefined): value is PlazaAnchoredInteractionType {
    return Boolean(value && COMPOSER_TYPE_SET.has(value));
}

export interface AnchoredInteractionCreateDraft {
    interactionType: PlazaAnchoredInteractionType;
    initialState: Record<string, unknown>;
    initialSummary: Record<string, unknown>;
}

interface AnchoredInteractionComposerSheetProps {
    open: boolean;
    busy: boolean;
    errorMessage: string | null;
    defaultDisplayName: string;
    typeLabels: Record<PlazaAnchoredInteractionType, string>;
    createLabel: string;
    creatingLabel: string;
    cancelLabel: string;
    nonCustodyNote: string;
    anchorLabel: string;
    anchorPreview: string | null;
    anchorMode?: 'message' | 'freeform';
    preselectedInteractionType?: PlazaAnchoredInteractionType | null;
    displayNameLabel: string;
    pollOptionPlaceholder: (index: number) => string;
    pollMultipleChoiceLabel: string;
    addPollOptionLabel: string;
    removePollOptionLabel: string;
    bountyRewardPlaceholder: string;
    bountySettlementModeLabel: string;
    bountyReceiptOnlyLabel: string;
    bountyEscrowUnavailableLabel: string;
    challengeReasonPlaceholder: string;
    onClose: () => void;
    onCreate: (draft: AnchoredInteractionCreateDraft) => void;
}

export default function AnchoredInteractionComposerSheet({
    open,
    busy,
    errorMessage,
    defaultDisplayName,
    typeLabels,
    createLabel,
    creatingLabel,
    cancelLabel,
    nonCustodyNote,
    anchorLabel,
    anchorPreview,
    anchorMode = 'message',
    preselectedInteractionType,
    displayNameLabel,
    pollOptionPlaceholder,
    pollMultipleChoiceLabel,
    addPollOptionLabel,
    removePollOptionLabel,
    bountyRewardPlaceholder,
    bountySettlementModeLabel,
    bountyReceiptOnlyLabel,
    bountyEscrowUnavailableLabel,
    challengeReasonPlaceholder,
    onClose,
    onCreate,
}: AnchoredInteractionComposerSheetProps) {
    const [interactionType, setInteractionType] = useState<PlazaAnchoredInteractionType>('signup');
    const [displayName, setDisplayName] = useState(defaultDisplayName);
    const [pollOptions, setPollOptions] = useState(['', '']);
    const [pollMultipleChoice, setPollMultipleChoice] = useState(false);
    const [bountyReward, setBountyReward] = useState('');
    const [bountySettlementMode, setBountySettlementMode] = useState<'receipt_only' | 'escrow'>('receipt_only');
    const [challengeReason, setChallengeReason] = useState('');
    const canCreate = (
        interactionType !== 'poll'
        || pollOptions.map((option) => option.trim()).filter(Boolean).length >= 2
    ) && (
        interactionType !== 'challenge'
        || challengeReason.trim().length > 0
    ) && (
        interactionType !== 'bounty'
        || bountyReward.trim().length > 0
    );
    const isStructuredNonCustody = interactionType === 'challenge'
        || interactionType === 'support'
        || interactionType === 'bounty';

    useEffect(() => {
        if (open) setDisplayName(defaultDisplayName);
    }, [defaultDisplayName, open]);

    useEffect(() => {
        if (!open) return;
        if (isComposerInteractionType(preselectedInteractionType)) {
            setInteractionType(preselectedInteractionType);
            return;
        }
        setInteractionType((current) => isComposerInteractionType(current) ? current : 'signup');
    }, [open, preselectedInteractionType]);

    const initialState = useMemo(() => {
        if (interactionType === 'signup') {
            return { defaultDisplayName: displayName.trim() };
        }
        if (interactionType === 'poll') {
            return {
                options: pollOptions
                    .map((label, index) => ({
                        id: `option_${index + 1}`,
                        label: label.trim(),
                    }))
                    .filter((option) => option.label),
                ...(pollMultipleChoice ? { multipleChoice: true } : {}),
            };
        }
        if (interactionType === 'challenge') {
            return {
                challengeMode: 'credibility_vote',
                reason: challengeReason.trim(),
                options: CHALLENGE_TRUST_VOTE_OPTIONS.map((option) => ({ ...option })),
                aiImpact: 'credibility_dispute',
            };
        }
        if (interactionType === 'bounty') {
            return {
                rewardDisplay: bountyReward.trim(),
                settlementMode: bountySettlementMode,
                escrowEnabled: bountySettlementMode === 'escrow' ? false : undefined,
            };
        }
        return {};
    }, [bountyReward, bountySettlementMode, challengeReason, displayName, interactionType, pollMultipleChoice, pollOptions]);

    if (!open) return null;

    return (
        <div className={styles.sheetOverlay} data-msg-action="1">
            <div className={styles.composerSheet}>
                <div className={styles.sheetHandle} />
                <div className={styles.sheetHeader}>
                    <strong>{createLabel}</strong>
                    <button type="button" className={styles.iconButton} onClick={onClose} aria-label={cancelLabel}>
                        <X size={17} />
                    </button>
                </div>
                {anchorPreview && (
                    <div className={styles.anchorPreview} data-anchor-mode={anchorMode}>
                        <span>{anchorLabel}</span>
                        <p>{anchorPreview}</p>
                    </div>
                )}
                <div className={styles.typeGrid}>
                    {COMPOSER_TYPES.map((type) => (
                        <button
                            type="button"
                            key={type}
                            className={type === interactionType ? styles.typeButtonActive : styles.typeButton}
                            onClick={() => setInteractionType(type)}
                        >
                            {typeLabels[type]}
                        </button>
                    ))}
                </div>
                {interactionType === 'signup' && (
                    <label className={styles.fieldLabel}>
                        {displayNameLabel}
                        <input
                            className={styles.textInput}
                            value={displayName}
                            onChange={(event) => setDisplayName(event.target.value)}
                        />
                    </label>
                )}
                {interactionType === 'poll' && (
                    <div className={styles.fieldStack}>
                        {pollOptions.map((option, index) => (
                            <div key={index} className={styles.pollOptionRow}>
                                <input
                                    className={styles.textInput}
                                    value={option}
                                    placeholder={pollOptionPlaceholder(index + 1)}
                                    onChange={(event) => {
                                        const next = [...pollOptions];
                                        next[index] = event.target.value;
                                        setPollOptions(next);
                                    }}
                                />
                                {pollOptions.length > 2 && (
                                    <button
                                        type="button"
                                        className={styles.iconButton}
                                        onClick={() => setPollOptions((prev) => prev.filter((_, itemIndex) => itemIndex !== index))}
                                        aria-label={removePollOptionLabel}
                                    >
                                        -
                                    </button>
                                )}
                            </div>
                        ))}
                        <button
                            type="button"
                            className={styles.secondaryAction}
                            onClick={() => setPollOptions((prev) => prev.length >= 12 ? prev : [...prev, ''])}
                        >
                            {addPollOptionLabel}
                        </button>
                        <label className={styles.checkboxRow}>
                            <input
                                type="checkbox"
                                checked={pollMultipleChoice}
                                onChange={(event) => setPollMultipleChoice(event.target.checked)}
                            />
                            {pollMultipleChoiceLabel}
                        </label>
                    </div>
                )}
                {interactionType === 'challenge' && (
                    <div className={styles.fieldStack}>
                        <textarea
                            className={styles.textInput}
                            value={challengeReason}
                            placeholder={challengeReasonPlaceholder}
                            rows={3}
                            onChange={(event) => setChallengeReason(event.target.value)}
                        />
                    </div>
                )}
                {isStructuredNonCustody && <p className={styles.footerNote}>{nonCustodyNote}</p>}
                {interactionType === 'bounty' && (
                    <div className={styles.fieldStack}>
                        <input
                            className={styles.textInput}
                            value={bountyReward}
                            placeholder={bountyRewardPlaceholder}
                            onChange={(event) => setBountyReward(event.target.value)}
                        />
                        <select
                            className={styles.textInput}
                            aria-label={bountySettlementModeLabel}
                            value={bountySettlementMode}
                            onChange={(event) => setBountySettlementMode(event.target.value === 'escrow' ? 'escrow' : 'receipt_only')}
                        >
                            <option value="receipt_only">{bountyReceiptOnlyLabel}</option>
                            <option value="escrow" disabled>{bountyEscrowUnavailableLabel}</option>
                        </select>
                    </div>
                )}
                {errorMessage && <p className={styles.errorText}>{errorMessage}</p>}
                <div className={styles.sheetActions}>
                    <button type="button" className={styles.secondaryAction} onClick={onClose}>{cancelLabel}</button>
                    <button
                        type="button"
                        className={styles.primaryAction}
                        disabled={!canCreate || busy}
                        onClick={() => onCreate({
                            interactionType,
                            initialState,
                            initialSummary: {},
                        })}
                    >
                        {busy ? creatingLabel : createLabel}
                    </button>
                </div>
            </div>
        </div>
    );
}
