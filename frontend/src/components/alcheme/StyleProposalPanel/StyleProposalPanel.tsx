'use client';

import { Check, Download, Eye, RotateCcw, Sparkles, Trash2, X } from 'lucide-react';

import type {
    StyleProposalView,
    StyleRiskLevel,
    StyleTokenName,
} from '@/lib/api/styleAdvisor';
import { buildStyleProposalPreviewVariables } from '@/alchemy/stylePreferences';
import styles from './StyleProposalPanel.module.css';

export interface StyleProposalPanelProps {
    title: string;
    description?: string;
    status: 'idle' | 'loading' | 'ready' | 'applied' | 'disabled' | 'error';
    proposal?: StyleProposalView | null;
    errorMessage?: string | null;
    disabledReason?: string | null;
    requestLabel: string;
    previewLabel: string;
    applyLabel: string;
    appliedLabel: string;
    ignoreLabel: string;
    resetLabel?: string;
    exportLabel?: string;
    deleteLabel?: string;
    emptyLabel: string;
    loadingLabel: string;
    readyAnnouncementLabel: string;
    unavailableLabel: string;
    requestFailedLabel: string;
    checksLabel: string;
    changesLabel: string;
    previewTitle: string;
    previewBody: string;
    riskLabels: Record<StyleRiskLevel, string>;
    tokenLabels: Record<StyleTokenName, string>;
    onRequest: () => void;
    onPreview: () => void;
    onApply: () => void;
    onIgnore: () => void;
    onReset?: () => void;
    onExport?: () => void;
    onDelete?: () => void;
}

function joinClassNames(...values: Array<string | false | null | undefined>): string {
    return values.filter(Boolean).join(' ');
}

function formatTokenValue(value: unknown): string {
    return String(value ?? '').replace(/_/g, ' ') || '-';
}

export default function StyleProposalPanel({
    title,
    description,
    status,
    proposal = null,
    errorMessage = null,
    disabledReason = null,
    requestLabel,
    previewLabel,
    applyLabel,
    appliedLabel,
    ignoreLabel,
    resetLabel,
    exportLabel,
    deleteLabel,
    emptyLabel,
    loadingLabel,
    readyAnnouncementLabel,
    unavailableLabel,
    requestFailedLabel,
    checksLabel,
    changesLabel,
    previewTitle,
    previewBody,
    riskLabels,
    tokenLabels,
    onRequest,
    onPreview,
    onApply,
    onIgnore,
    onReset,
    onExport,
    onDelete,
}: StyleProposalPanelProps) {
    const changes = proposal?.proposedDiff.tokenDiff ?? [];
    const checks = proposal?.proposedDiff.accessibilityChecks ?? [];
    const canReview = status === 'ready' || status === 'applied';
    const canApply = status === 'ready' && changes.length > 0 && (proposal?.validationErrors.length ?? 0) === 0;
    const previewStyle = buildStyleProposalPreviewVariables(proposal);

    return (
        <section className={styles.panel}>
            <div className={styles.header}>
                <div className={styles.titleBlock}>
                    <span className={styles.icon} aria-hidden="true">
                        <Sparkles size={16} />
                    </span>
                    <div>
                        <h3 className={styles.title}>{title}</h3>
                        {description ? <p className={styles.description}>{description}</p> : null}
                    </div>
                </div>
                <button
                    type="button"
                    className={styles.primaryButton}
                    disabled={status === 'loading' || status === 'disabled'}
                    onClick={onRequest}
                >
                    <Sparkles size={14} />
                    <span>{status === 'loading' ? loadingLabel : requestLabel}</span>
                </button>
            </div>

            <div role="status" aria-live="polite">
                {status === 'ready' && changes.length > 0 ? (
                    <span className={styles.srOnly}>{readyAnnouncementLabel}</span>
                ) : null}
                {status === 'disabled' ? (
                    <p className={styles.notice}>{disabledReason || unavailableLabel}</p>
                ) : null}
                {status === 'error' ? (
                    <p className={styles.error}>{errorMessage || requestFailedLabel}</p>
                ) : null}
                {status === 'ready' && changes.length === 0 ? (
                    <p className={styles.notice}>{emptyLabel}</p>
                ) : null}
                {status === 'applied' ? (
                    <p className={styles.notice}>{appliedLabel}</p>
                ) : null}
            </div>

            {canReview ? (
                <div className={styles.previewGrid}>
                    <div className={styles.preview} style={previewStyle}>
                        <div className={styles.previewAccent} />
                        <div>
                            <div className={styles.previewTitle}>{previewTitle}</div>
                            <p className={styles.previewBody}>{previewBody}</p>
                        </div>
                    </div>
                    <div className={styles.summary}>
                        <span className={joinClassNames(styles.riskBadge, styles[`risk${proposal?.riskLevel ?? 'low'}`])}>
                            {riskLabels[proposal?.riskLevel ?? 'low']}
                        </span>
                        <p className={styles.reason}>{proposal?.proposedDiff.reason || proposal?.proposedDiff.styleIntent || ''}</p>
                    </div>
                </div>
            ) : null}

            {changes.length > 0 ? (
                <div className={styles.group}>
                    <div className={styles.groupLabel}>{changesLabel}</div>
                    <div className={styles.changeList}>
                        {changes.map((change) => (
                            <article key={`${change.token}:${change.proposedValue}`} className={styles.changeItem}>
                                <div className={styles.changeTopline}>
                                    <span className={styles.fieldName}>{tokenLabels[change.token]}</span>
                                    <span className={styles.valuePair}>
                                        {formatTokenValue(change.previousValue)} {'->'} {formatTokenValue(change.proposedValue)}
                                    </span>
                                </div>
                                <p className={styles.reason}>{change.reason}</p>
                            </article>
                        ))}
                    </div>
                </div>
            ) : null}

            {checks.length > 0 ? (
                <div className={styles.group}>
                    <div className={styles.groupLabel}>{checksLabel}</div>
                    <div className={styles.checkList}>
                        {checks.map((check) => (
                            <div key={check.check} className={styles.checkRow}>
                                <span className={check.passed ? styles.checkPassed : styles.checkFailed}>
                                    {check.passed ? <Check size={13} /> : <X size={13} />}
                                </span>
                                <span>{check.message}</span>
                            </div>
                        ))}
                    </div>
                </div>
            ) : null}

            <div className={styles.footerActions}>
                <button type="button" className={styles.secondaryButton} disabled={!canReview} onClick={onPreview}>
                    <Eye size={14} />
                    <span>{previewLabel}</span>
                </button>
                <button type="button" className={styles.secondaryButton} disabled={!canApply} onClick={onApply}>
                    <Check size={14} />
                    <span>{status === 'applied' ? appliedLabel : applyLabel}</span>
                </button>
                {onReset && resetLabel ? (
                    <button type="button" className={styles.secondaryButton} onClick={onReset}>
                        <RotateCcw size={14} />
                        <span>{resetLabel}</span>
                    </button>
                ) : null}
                {onExport && exportLabel ? (
                    <button type="button" className={styles.secondaryButton} onClick={onExport}>
                        <Download size={14} />
                        <span>{exportLabel}</span>
                    </button>
                ) : null}
                {onDelete && deleteLabel ? (
                    <button type="button" className={styles.dangerButton} onClick={onDelete}>
                        <Trash2 size={14} />
                        <span>{deleteLabel}</span>
                    </button>
                ) : null}
                <button type="button" className={styles.ghostButton} disabled={status === 'loading'} onClick={onIgnore}>
                    <X size={14} />
                    <span>{ignoreLabel}</span>
                </button>
            </div>
        </section>
    );
}
