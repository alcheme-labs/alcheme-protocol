'use client';

import { FileText, LocateFixed } from 'lucide-react';

import type { InteractionResultNoticeView } from './types.ts';
import styles from './AnchoredInteractionCard.module.css';

interface InteractionResultNoticeCardProps {
    notice: InteractionResultNoticeView;
    label: string;
    statusLabel: string;
    viewSourceLabel: string;
    viewDetailsLabel: string;
    persistedLabel?: string;
    onViewSource?: () => void;
    onViewDetails?: () => void;
}

export default function InteractionResultNoticeCard({
    notice,
    label,
    statusLabel,
    viewSourceLabel,
    viewDetailsLabel,
    persistedLabel,
    onViewSource,
    onViewDetails,
}: InteractionResultNoticeCardProps) {
    return (
        <div className={styles.resultNoticeCard} data-testid="interaction-result-notice-card">
            <div className={styles.resultNoticeHeader}>
                <span className={styles.resultNoticeTitle}>{label}</span>
                <span className={styles.resultNoticeStatus}>{statusLabel}</span>
            </div>
            <p className={styles.resultNoticeSummary}>{notice.humanSummary}</p>
            <div className={styles.resultNoticeActions}>
                {onViewSource && (
                    <button type="button" className={styles.resultNoticeLink} onClick={onViewSource}>
                        <LocateFixed size={13} />
                        {viewSourceLabel}
                    </button>
                )}
                {onViewDetails && (
                    <button type="button" className={styles.resultNoticeLink} onClick={onViewDetails}>
                        <FileText size={13} />
                        {viewDetailsLabel}
                    </button>
                )}
            </div>
            {persistedLabel && <p className={styles.resultNoticeFootnote}>{persistedLabel}</p>}
        </div>
    );
}
