'use client';

import { Check, RotateCcw, Sparkles, X } from 'lucide-react';

import type { ConfigurationFieldChange, ConfigurationRiskLevel } from '@/lib/api/configurationCopilot';
import styles from './ConfigurationDiffPanel.module.css';

export interface ConfigurationDiffPanelProps {
    title: string;
    description?: string;
    status: 'idle' | 'loading' | 'ready' | 'disabled' | 'error';
    changes: ConfigurationFieldChange[];
    acceptedFields?: string[];
    validationErrors?: Array<{
        field?: string | null;
        reasonCode?: string;
        message?: string;
    }>;
    errorMessage?: string | null;
    disabledReason?: string | null;
    requestLabel: string;
    acceptFieldLabel: string;
    acceptAllLabel: string;
    undoLabel: string;
    ignoreLabel: string;
    emptyLabel: string;
    validationFailedLabel: string;
    loadingLabel: string;
    acceptedLabel: string;
    readyAnnouncementLabel: string;
    basisLabel: string;
    proposalReasonLabel: string;
    reviewSummaryLabel: string;
    proposalReason?: string | null;
    unavailableLabel: string;
    requestFailedLabel: string;
    valueUnsetLabel: string;
    valueBooleanOnLabel: string;
    valueBooleanOffLabel: string;
    riskLabels: Record<ConfigurationRiskLevel, string>;
    onRequest: () => void;
    onAcceptField: (change: ConfigurationFieldChange) => void;
    onAcceptAll: () => void;
    onUndo: () => void;
    onIgnore: () => void;
}

function joinClassNames(...values: Array<string | false | null | undefined>): string {
    return values.filter(Boolean).join(' ');
}

function formatValue(value: unknown, labels: {
    unset: string;
    booleanOn: string;
    booleanOff: string;
}): string {
    if (value === null || value === undefined) return labels.unset;
    if (typeof value === 'boolean') return value ? labels.booleanOn : labels.booleanOff;
    if (typeof value === 'string' || typeof value === 'number') return String(value);
    return JSON.stringify(value);
}

export default function ConfigurationDiffPanel({
    title,
    description,
    status,
    changes,
    acceptedFields = [],
    validationErrors = [],
    errorMessage = null,
    disabledReason = null,
    requestLabel,
    acceptFieldLabel,
    acceptAllLabel,
    undoLabel,
    ignoreLabel,
    emptyLabel,
    validationFailedLabel,
    loadingLabel,
    acceptedLabel,
    readyAnnouncementLabel,
    basisLabel,
    proposalReasonLabel,
    reviewSummaryLabel,
    proposalReason = null,
    unavailableLabel,
    requestFailedLabel,
    valueUnsetLabel,
    valueBooleanOnLabel,
    valueBooleanOffLabel,
    riskLabels,
    onRequest,
    onAcceptField,
    onAcceptAll,
    onUndo,
    onIgnore,
}: ConfigurationDiffPanelProps) {
    const accepted = new Set(acceptedFields);
    const canAccept = status === 'ready' && changes.length > 0;
    const normalizedProposalReason = typeof proposalReason === 'string' ? proposalReason.trim() : '';
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
                {status === 'ready' && changes.length === 0 && validationErrors.length > 0 ? (
                    <p className={styles.error}>{validationFailedLabel}</p>
                ) : null}
                {status === 'ready' && changes.length === 0 && validationErrors.length === 0 ? (
                    <p className={styles.notice}>{emptyLabel}</p>
                ) : null}
            </div>

            {status === 'ready' && changes.length > 0 ? (
                <div className={styles.contextNote}>
                    <p>{basisLabel}</p>
                    <p>{reviewSummaryLabel}</p>
                    {normalizedProposalReason ? (
                        <p>
                            <span className={styles.contextLabel}>{proposalReasonLabel}</span>
                            {normalizedProposalReason}
                        </p>
                    ) : null}
                </div>
            ) : null}

            {changes.length > 0 ? (
                <div className={styles.diffList}>
                    {changes.map((change) => {
                        const isAccepted = accepted.has(change.field);
                        return (
                            <article key={change.field} className={joinClassNames(styles.diffItem, isAccepted && styles.diffItemAccepted)}>
                                <div className={styles.diffTopline}>
                                    <div>
                                        <div className={styles.fieldName}>{change.field}</div>
                                        <p className={styles.reason}>{change.reason}</p>
                                    </div>
                                    <span className={joinClassNames(styles.riskBadge, styles[`risk${change.riskLevel}`])}>
                                        {riskLabels[change.riskLevel]}
                                    </span>
                                </div>
                                <div className={styles.valueGrid}>
                                    <span>{formatValue(change.previousValue, {
                                        unset: valueUnsetLabel,
                                        booleanOn: valueBooleanOnLabel,
                                        booleanOff: valueBooleanOffLabel,
                                    })}</span>
                                    <span>{formatValue(change.proposedValue, {
                                        unset: valueUnsetLabel,
                                        booleanOn: valueBooleanOnLabel,
                                        booleanOff: valueBooleanOffLabel,
                                    })}</span>
                                </div>
                                {change.conflicts.length > 0 ? (
                                    <ul className={styles.conflicts}>
                                        {change.conflicts.map((conflict) => (
                                            <li key={conflict}>{conflict}</li>
                                        ))}
                                    </ul>
                                ) : null}
                                <div className={styles.itemActions}>
                                    <button
                                        type="button"
                                        className={styles.secondaryButton}
                                        disabled={isAccepted}
                                        onClick={() => onAcceptField(change)}
                                    >
                                        <Check size={14} />
                                        <span>{isAccepted ? acceptedLabel : acceptFieldLabel}</span>
                                    </button>
                                </div>
                            </article>
                        );
                    })}
                </div>
            ) : null}

            <div className={styles.footerActions}>
                <button type="button" className={styles.secondaryButton} disabled={!canAccept} onClick={onAcceptAll}>
                    <Check size={14} />
                    <span>{acceptAllLabel}</span>
                </button>
                <button type="button" className={styles.secondaryButton} disabled={accepted.size === 0} onClick={onUndo}>
                    <RotateCcw size={14} />
                    <span>{undoLabel}</span>
                </button>
                <button type="button" className={styles.ghostButton} disabled={status === 'loading'} onClick={onIgnore}>
                    <X size={14} />
                    <span>{ignoreLabel}</span>
                </button>
            </div>
        </section>
    );
}
