'use client';

import { Fragment, useMemo, useState } from 'react';
import { FileText, GitFork, LockKeyhole, ShieldCheck } from 'lucide-react';

import {
    expandForkReference,
    type ForkContextView,
    type ForkReferenceExpansionMode,
    type ForkReferenceExpansionView,
} from '@/lib/api/forkLineage';
import { useCurrentLocale, useI18n } from '@/i18n/useI18n';
import {
    createForkContextCopy,
    formatForkContextReferenceTypeLabel,
    formatForkContextRestrictionLabel,
    formatForkContextStateLabel,
} from './adapter';
import styles from './ForkContextPanel.module.css';

interface ForkContextPanelProps {
    context: ForkContextView | null;
    loading: boolean;
    error: string | null;
}

function shortenDigest(value: string | null): string | null {
    const trimmed = String(value || '').trim();
    if (!trimmed) return null;
    return trimmed.length > 18 ? `${trimmed.slice(0, 8)}...${trimmed.slice(-6)}` : trimmed;
}

function formatDate(value: string | null | undefined, locale: string): string | null {
    if (!value) return null;
    const parsed = new Date(value);
    if (Number.isNaN(parsed.getTime())) return null;
    return parsed.toLocaleDateString(locale, {
        month: 'short',
        day: 'numeric',
        year: 'numeric',
    });
}

function getOriginDeclaration(context: ForkContextView): string | null {
    const declaration = context.capsule?.originSnapshot?.declarationText;
    if (typeof declaration !== 'string') return null;
    const trimmed = declaration.trim();
    return trimmed.length > 0 ? trimmed : null;
}

function getExpansionText(expansion: ForkReferenceExpansionView | null): string | null {
    const text = expansion?.text?.trim();
    return text && text.length > 0 ? text : null;
}

function canOpenSummary(reference: ForkContextView['references'][number]): boolean {
    return reference.visibilityState === 'released_summary' || Boolean(reference.releaseId);
}

function canOpenFullSource(reference: ForkContextView['references'][number]): boolean {
    return reference.canRequestExpansion
        && reference.referenceType === 'source_material'
        && reference.visibilityState !== 'sealed_source'
        && reference.restrictionState !== 'released_safe_summary'
        && reference.restrictionState !== 'revoked';
}

export function ForkContextPanel({ context, loading, error }: ForkContextPanelProps) {
    const t = useI18n('ForkContextPanel');
    const locale = useCurrentLocale();
    const copy = useMemo(() => createForkContextCopy(t), [t]);
    const [expanded, setExpanded] = useState<Record<string, ForkReferenceExpansionView>>({});
    const [pendingKey, setPendingKey] = useState<string | null>(null);
    const [expandError, setExpandError] = useState<string | null>(null);

    const capsule = context?.capsule ?? null;
    const originDeclaration = context ? getOriginDeclaration(context) : null;
    const createdAt = formatDate(capsule?.createdAt, locale);

    const handleExpand = async (
        referenceId: string,
        mode: ForkReferenceExpansionMode,
    ) => {
        const key = `${referenceId}:${mode}`;
        if (pendingKey) return;
        setPendingKey(key);
        setExpandError(null);
        try {
            const result = await expandForkReference({ referenceId, mode });
            setExpanded((current) => ({ ...current, [key]: result }));
            if (result.status !== 'allowed' && result.status !== 'released_summary') {
                setExpandError(t(`expandStatus.${result.status}`));
            }
        } catch {
            setExpandError(t('errors.expandFailed'));
        } finally {
            setPendingKey(null);
        }
    };

    if (!loading && !error && !capsule) {
        return null;
    }

    return (
        <section className={styles.panel} aria-live="polite">
            <div className={styles.header}>
                <div>
                    <p className={styles.eyebrow}>{t('eyebrow')}</p>
                    <h2 className={styles.title}>{t('title')}</h2>
                </div>
                {loading ? (
                    <span className={styles.statusBadge}>{t('loading')}</span>
                ) : capsule ? (
                    <span className={styles.statusBadge}>{capsule.status}</span>
                ) : null}
            </div>

            {error ? (
                <p className={styles.error}>{error}</p>
            ) : loading ? (
                <div className={styles.loadingRows}>
                    <span />
                    <span />
                </div>
            ) : capsule && context ? (
                <>
                    <div className={styles.summaryGrid}>
                        <div className={styles.summaryItem}>
                            <GitFork size={14} strokeWidth={1.7} aria-hidden="true" />
                            <span>{t('sourcePath')}</span>
                            <strong>{context.capsule?.sourcePath.length || 0}</strong>
                        </div>
                        <div className={styles.summaryItem}>
                            <ShieldCheck size={14} strokeWidth={1.7} aria-hidden="true" />
                            <span>{t('references')}</span>
                            <strong>{context.references.length}</strong>
                        </div>
                        {createdAt && (
                            <div className={styles.summaryItem}>
                                <FileText size={14} strokeWidth={1.7} aria-hidden="true" />
                                <span>{t('created')}</span>
                                <strong>{createdAt}</strong>
                            </div>
                        )}
                    </div>

                    {context.capsule?.sourcePath.length ? (
                        <div className={styles.pathRow} aria-label={t('sourcePath')}>
                            {context.capsule.sourcePath.map((entry, index) => (
                                <Fragment key={entry.circleId}>
                                    {index > 0 && <span className={styles.pathSeparator}>{'>'}</span>}
                                    <span className={styles.pathNode}>
                                        {entry.name || `#${entry.circleId}`}
                                    </span>
                                </Fragment>
                            ))}
                        </div>
                    ) : null}

                    {originDeclaration && (
                        <p className={styles.originText}>{originDeclaration}</p>
                    )}

                    {context.references.length > 0 && (
                        <div className={styles.referenceList}>
                            {context.references.map((reference) => {
                                const summaryKey = `${reference.referenceId}:summary`;
                                const fullSourceKey = `${reference.referenceId}:full_source`;
                                const currentSummary = expanded[summaryKey] ?? null;
                                const currentFullSource = expanded[fullSourceKey] ?? null;
                                const expandedText = getExpansionText(currentSummary) || getExpansionText(currentFullSource);
                                const digest = shortenDigest(reference.summaryDigest || reference.sourceDigest);
                                const isBusy = pendingKey?.startsWith(`${reference.referenceId}:`) ?? false;

                                return (
                                    <div key={reference.referenceId} className={styles.referenceRow}>
                                        <div className={styles.referenceHeader}>
                                            <span className={styles.referenceType}>
                                                {formatForkContextReferenceTypeLabel(reference.referenceType, copy)}
                                            </span>
                                            <span className={styles.referenceState}>
                                                {formatForkContextStateLabel(reference.visibilityState, copy)}
                                            </span>
                                        </div>
                                        <div className={styles.referenceMeta}>
                                            <span>
                                                <LockKeyhole size={12} strokeWidth={1.8} aria-hidden="true" />
                                                {formatForkContextRestrictionLabel(reference.restrictionState, copy)}
                                            </span>
                                            {digest && <span>{t('digest', {digest})}</span>}
                                        </div>
                                        {(canOpenSummary(reference) || canOpenFullSource(reference)) && (
                                            <div className={styles.actions}>
                                                {canOpenSummary(reference) && (
                                                    <button
                                                        type="button"
                                                        className={styles.actionButton}
                                                        disabled={isBusy}
                                                        onClick={() => void handleExpand(reference.referenceId, 'summary')}
                                                    >
                                                        {t('actions.openSummary')}
                                                    </button>
                                                )}
                                                {canOpenFullSource(reference) && (
                                                    <button
                                                        type="button"
                                                        className={styles.actionButton}
                                                        disabled={isBusy}
                                                        onClick={() => void handleExpand(reference.referenceId, 'full_source')}
                                                    >
                                                        {t('actions.requestFullSource')}
                                                    </button>
                                                )}
                                            </div>
                                        )}
                                        {expandedText && (
                                            <p className={styles.expandedText}>{expandedText}</p>
                                        )}
                                    </div>
                                );
                            })}
                        </div>
                    )}
                </>
            ) : null}

            {expandError && <p className={styles.error}>{expandError}</p>}
        </section>
    );
}

export default ForkContextPanel;
