import { useState } from 'react';
import { type DraftCandidateInlineNotice } from '@/features/discussion-intake/handoff/acceptedCandidate';
import { useI18n } from '@/i18n/useI18n';
import styles from './DraftCandidateInlineCard.module.css';

function resolveStateLabel(
    state: DraftCandidateInlineNotice['state'],
    t: ReturnType<typeof useI18n>,
): string {
    switch (state) {
        case 'open':
            return t('states.open.label');
        case 'proposal_active':
            return t('states.proposal_active.label');
        case 'accepted':
            return t('states.accepted.label');
        case 'generation_failed':
            return t('states.generation_failed.label');
        case 'rejected':
            return t('states.rejected.label');
        case 'expired':
            return t('states.expired.label');
        case 'cancelled':
            return t('states.cancelled.label');
        default:
            return t('states.default.label');
    }
}

function resolveStateTitle(
    state: DraftCandidateInlineNotice['state'],
    t: ReturnType<typeof useI18n>,
): string {
    switch (state) {
        case 'open':
            return t('states.open.title');
        case 'proposal_active':
            return t('states.proposal_active.title');
        case 'accepted':
            return t('states.accepted.title');
        case 'generation_failed':
            return t('states.generation_failed.title');
        case 'rejected':
            return t('states.rejected.title');
        case 'expired':
            return t('states.expired.title');
        case 'cancelled':
            return t('states.cancelled.title');
        default:
            return t('states.default.title');
    }
}

function resolveLabelText(label: string, t: ReturnType<typeof useI18n>): string {
    if (label === 'fact') return t('semanticFacets.fact');
    if (label === 'explanation') return t('semanticFacets.explanation');
    if (label === 'emotion') return t('semanticFacets.emotion');
    if (label === 'question') return t('semanticFacets.question');
    if (label === 'problem') return t('semanticFacets.problem');
    if (label === 'criteria') return t('semanticFacets.criteria');
    if (label === 'proposal') return t('semanticFacets.proposal');
    if (label === 'summary') return t('semanticFacets.summary');
    return label;
}

interface DraftCandidateInlineCardProps {
    notice: DraftCandidateInlineNotice;
    embedded?: boolean;
    footerNote?: string;
    onOpenDraft?: (draftPostId: number) => void;
    onCreateDraft?: (notice: DraftCandidateInlineNotice) => void;
    onViewSource?: (notice: DraftCandidateInlineNotice) => void;
    onRetry?: (notice: DraftCandidateInlineNotice) => void;
    onCancel?: (notice: DraftCandidateInlineNotice) => void;
    createDraftBusy?: boolean;
}

export default function DraftCandidateInlineCard({
    notice,
    embedded = false,
    footerNote,
    onOpenDraft,
    onCreateDraft,
    onViewSource,
    onRetry,
    onCancel,
    createDraftBusy = false,
}: DraftCandidateInlineCardProps) {
    const t = useI18n('DraftCandidateInlineCard');
    const [detailsExpanded, setDetailsExpanded] = useState(false);
    const canOpenDraft = typeof notice.draftPostId === 'number' && notice.draftPostId > 0;
    const canCreateDraft = !canOpenDraft && notice.state === 'open' && typeof onCreateDraft === 'function';
    const canViewSource = notice.sourceMessageIds.length > 0;
    const showPendingHint = notice.state === 'open' || notice.state === 'proposal_active';
    const hasMeta = notice.sourceMessageIds.length > 0
        || notice.sourceSemanticFacets.length > 0
        || notice.sourceAuthorAnnotations.length > 0;
    const hasFailureDetails = notice.state === 'generation_failed'
        && Boolean(notice.lastExecutionError || notice.failureRecovery);
    const hasCollapsibleDetails = Boolean(notice.summary) || showPendingHint || hasMeta || hasFailureDetails;
    const primaryAction = canCreateDraft ? (
        <button
            type="button"
            className={`${styles.actionBtn} ${embedded ? styles.primaryAction : ''} ${createDraftBusy ? styles.disabled : ''}`}
            onClick={() => onCreateDraft?.(notice)}
            disabled={createDraftBusy}
        >
            {createDraftBusy ? t('actions.createDraftBusy') : t('actions.createDraft')}
        </button>
    ) : canOpenDraft ? (
        <button
            type="button"
            className={`${styles.actionBtn} ${embedded ? styles.primaryAction : ''}`}
            onClick={() => onOpenDraft?.(notice.draftPostId!)}
        >
            {t('actions.openDraft')}
        </button>
    ) : null;
    const secondaryActions = (
        <>
            {canViewSource && (
                <button
                    type="button"
                    className={`${styles.actionBtn} ${embedded ? styles.textAction : styles.secondaryBtn}`}
                    onClick={() => onViewSource?.(notice)}
                >
                    {t('actions.viewSource')}
                </button>
            )}
            {hasCollapsibleDetails && (
                <button
                    type="button"
                    className={`${styles.detailsToggle} ${embedded ? styles.textAction : ''}`}
                    onClick={() => setDetailsExpanded((value) => !value)}
                >
                    {detailsExpanded ? t('actions.collapseDetails') : t('actions.expandDetails')}
                </button>
            )}
            {notice.state === 'generation_failed' && (
                <>
                    <button
                        type="button"
                        className={`${styles.actionBtn} ${embedded ? styles.textAction : ''} ${!notice.canRetry ? styles.disabled : ''}`}
                        onClick={() => onRetry?.(notice)}
                        disabled={!notice.canRetry}
                        title={notice.canRetry ? t('actions.retryTitle') : t('actions.retryDisabledTitle')}
                    >
                        {t('actions.retry')}
                    </button>
                    <button
                        type="button"
                        className={`${styles.actionBtn} ${embedded ? styles.textAction : styles.secondaryBtn} ${!notice.canCancel ? styles.disabled : ''}`}
                        onClick={() => onCancel?.(notice)}
                        disabled={!notice.canCancel}
                        title={notice.canCancel ? t('actions.cancelTitle') : t('actions.cancelDisabledTitle')}
                    >
                        {t('actions.cancel')}
                    </button>
                </>
            )}
        </>
    );

    return (
        <div className={embedded ? styles.cardEmbeddedRoot : styles.card}>
            <div className={`${styles.header} ${embedded ? styles.headerEmbedded : ''}`}>
                <h4 className={`${styles.title} ${embedded ? styles.titleEmbedded : ''}`}>{resolveStateTitle(notice.state, t)}</h4>
                <span className={`${styles.state} ${embedded ? styles.stateEmbedded : ''}`}>{resolveStateLabel(notice.state, t)}</span>
            </div>

            {hasCollapsibleDetails && detailsExpanded && (
                <div className={styles.detailsBlock}>
                    {notice.summary && (
                        <p className={styles.summary}>{notice.summary}</p>
                    )}
                    {showPendingHint && (
                        <p className={styles.stateHint}>{t(`states.${notice.state}.hint`)}</p>
                    )}

                    {hasMeta && (
                        <div className={styles.metaRow}>
                            {notice.sourceMessageIds.length > 0 && (
                                <span className={styles.chip}>{t('meta.sourceMessages', {count: notice.sourceMessageIds.length})}</span>
                            )}
                            {notice.sourceSemanticFacets.map((label) => (
                                <span key={label} className={styles.chip}>{resolveLabelText(label, t)}</span>
                            ))}
                            {notice.sourceAuthorAnnotations.map((label) => (
                                <span key={`author-${label}`} className={styles.chip}>
                                    {t('meta.authorAnnotation', {label: resolveLabelText(label, t)})}
                                </span>
                            ))}
                        </div>
                    )}

                    {notice.state === 'generation_failed' && notice.lastExecutionError && (
                        <p className={styles.error}>{t('errors.failureReason', {error: notice.lastExecutionError})}</p>
                    )}
                    {notice.state === 'generation_failed' && notice.failureRecovery && (
                        <p className={styles.summary}>
                            {t('recovery.summary', {
                                action: notice.failureRecovery.retryExecutionReusesPassedProposal
                                    ? t('recovery.reusePassedProposal')
                                    : t('recovery.reproposalRequired'),
                            })}
                        </p>
                    )}
                </div>
            )}

            <div className={`${styles.actions} ${embedded ? styles.actionsEmbedded : ''}`}>
                <div className={`${styles.actionsSecondary} ${embedded ? styles.actionsSecondaryEmbedded : ''}`}>{secondaryActions}</div>
            </div>

            {(footerNote || primaryAction) && (
                <div className={`${styles.footerRow} ${embedded ? styles.footerRowEmbedded : ''}`}>
                    <div className={styles.footerMeta}>
                        {footerNote ? <span className={styles.footerNote}>{footerNote}</span> : null}
                    </div>
                    {primaryAction ? <div className={styles.footerPrimary}>{primaryAction}</div> : null}
                </div>
            )}
        </div>
    );
}
