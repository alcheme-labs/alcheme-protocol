'use client';

import { useEffect, useMemo, useState } from 'react';
import { X } from 'lucide-react';

import styles from './AnchoredInteractionCard.module.css';

export interface AnchoredInteractionTipSubmit {
    amount: string;
}

interface AnchoredInteractionTipSheetProps {
    open: boolean;
    busy: boolean;
    pendingReceipt: boolean;
    errorMessage: string | null;
    title: string;
    recipientLabelText: string;
    recipientLabel: string;
    recipientPubkey: string;
    initialAmount?: string;
    amountPlaceholder: string;
    reviewLabel: string;
    confirmTitle: string;
    confirmDescription: (input: { recipient: string; amount: string; asset: string }) => string;
    walletConfirmLabel: string;
    retryRecordLabel: string;
    recordingPendingLabel: string;
    cancelLabel: string;
    disclaimer: string;
    onSubmit: (draft: AnchoredInteractionTipSubmit) => void;
    onClose: () => void;
}

export default function AnchoredInteractionTipSheet({
    open,
    busy,
    pendingReceipt,
    errorMessage,
    title,
    recipientLabelText,
    recipientLabel,
    recipientPubkey,
    initialAmount = '',
    amountPlaceholder,
    reviewLabel,
    confirmTitle,
    confirmDescription,
    walletConfirmLabel,
    retryRecordLabel,
    recordingPendingLabel,
    cancelLabel,
    disclaimer,
    onSubmit,
    onClose,
}: AnchoredInteractionTipSheetProps) {
    const [amount, setAmount] = useState(initialAmount);
    const [stage, setStage] = useState<'form' | 'confirm'>('form');
    const recipientProjection = useMemo(
        () => formatRecipientProjection(recipientLabel, recipientPubkey),
        [recipientLabel, recipientPubkey],
    );
    const normalizedAmount = amount.trim();
    const canReview = isPositiveSolAmount(normalizedAmount) && !busy;

    useEffect(() => {
        if (!open) return;
        setAmount(initialAmount);
        setStage(pendingReceipt ? 'confirm' : 'form');
    }, [initialAmount, open, pendingReceipt, recipientPubkey]);

    if (!open) return null;

    return (
        <div className={styles.sheetOverlay} data-msg-action="1" data-testid="anchored-tip-sheet">
            <div className={styles.composerSheet}>
                <div className={styles.sheetHandle} />
                <div className={styles.sheetHeader}>
                    <strong>{stage === 'confirm' ? confirmTitle : title}</strong>
                    <button type="button" className={styles.iconButton} onClick={onClose} aria-label={cancelLabel}>
                        <X size={17} />
                    </button>
                </div>

                {stage === 'form' ? (
                    <div className={styles.fieldStack}>
                        <label className={styles.fieldLabel}>
                            {recipientLabelText}
                            <input
                                className={styles.textInput}
                                value={recipientProjection}
                                readOnly
                            />
                        </label>
                        <input
                            className={styles.textInput}
                            value={amount}
                            inputMode="decimal"
                            placeholder={amountPlaceholder}
                            disabled={busy || pendingReceipt}
                            onChange={(event) => setAmount(event.target.value)}
                        />
                        <p className={styles.footerNote}>{disclaimer}</p>
                    </div>
                ) : (
                    <div className={styles.fieldStack}>
                        <p className={styles.summaryText}>
                            {confirmDescription({
                                recipient: recipientProjection,
                                amount: normalizedAmount,
                                asset: 'SOL',
                            })}
                        </p>
                        {pendingReceipt && <p className={styles.footerNote}>{recordingPendingLabel}</p>}
                        <p className={styles.footerNote}>{disclaimer}</p>
                    </div>
                )}

                {errorMessage && <p className={styles.errorText}>{errorMessage}</p>}
                <div className={styles.sheetActions}>
                    <button
                        type="button"
                        className={styles.secondaryAction}
                        onClick={stage === 'confirm' && !pendingReceipt ? () => setStage('form') : onClose}
                        disabled={busy}
                    >
                        {cancelLabel}
                    </button>
                    {stage === 'form' ? (
                        <button
                            type="button"
                            className={styles.primaryAction}
                            disabled={!canReview}
                            onClick={() => setStage('confirm')}
                        >
                            {reviewLabel}
                        </button>
                    ) : (
                        <button
                            type="button"
                            className={styles.primaryAction}
                            disabled={!canReview}
                            onClick={() => onSubmit({ amount: normalizedAmount })}
                        >
                            {pendingReceipt ? retryRecordLabel : walletConfirmLabel}
                        </button>
                    )}
                </div>
            </div>
        </div>
    );
}

function formatRecipientProjection(label: string, pubkey: string): string {
    const normalizedLabel = label.trim();
    const normalizedPubkey = pubkey.trim();
    return normalizedLabel || (normalizedPubkey ? 'A member' : '');
}

function isPositiveSolAmount(amount: string): boolean {
    if (!/^\d+(\.\d{1,9})?$/.test(amount)) return false;
    const [wholeRaw, fractionalRaw = ''] = amount.split('.');
    const whole = BigInt(wholeRaw || '0');
    const fractional = BigInt(fractionalRaw.padEnd(9, '0') || '0');
    return whole > BigInt(0) || fractional > BigInt(0);
}
