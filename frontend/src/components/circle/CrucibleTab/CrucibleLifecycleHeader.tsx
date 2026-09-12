'use client';

import { useState, type ReactNode } from 'react';
import Link from 'next/link';

import type { DraftLifecycleReadModel } from '@/lib/api/draftWorkingCopy';
import type { RevisionDirectionProposalView } from '@/lib/api/draftRuntime';
import { useCurrentLocale, useI18n } from '@/i18n/useI18n';
import styles from './CrucibleLifecycleHeader.module.css';

function shortenId(
    value: string | null | undefined,
    t: ReturnType<typeof useI18n>,
    size = 8,
): string {
    const normalized = String(value || '').trim();
    if (!normalized) return t('fallback.notProvided');
    if (normalized.length <= size * 2) return normalized;
    return `${normalized.slice(0, size)}…${normalized.slice(-size)}`;
}

function formatDateTime(
    value: string | null | undefined,
    locale: string,
    t: ReturnType<typeof useI18n>,
): string {
    const normalized = String(value || '').trim();
    if (!normalized) return t('fallback.notProvided');
    const date = new Date(normalized);
    if (Number.isNaN(date.getTime())) return t('fallback.notProvided');
    return new Intl.DateTimeFormat(locale, {
        month: 'numeric',
        day: 'numeric',
        hour: '2-digit',
        minute: '2-digit',
    }).format(date);
}

function formatFacetLabels(
    labels: string[],
    t: ReturnType<typeof useI18n>,
): string {
    if (labels.length === 0) return t('facets.none');
    return labels.map((label) => {
        if (label === 'fact') return t('facets.fact');
        if (label === 'explanation') return t('facets.explanation');
        if (label === 'emotion') return t('facets.emotion');
        if (label === 'question') return t('facets.question');
        if (label === 'problem') return t('facets.problem');
        if (label === 'criteria') return t('facets.criteria');
        if (label === 'proposal') return t('facets.proposal');
        return t('facets.summary');
    }).join(' / ');
}

function formatAnnotationLabels(
    labels: string[],
    t: ReturnType<typeof useI18n>,
): string {
    if (labels.length === 0) return t('annotations.none');
    return labels.map((label) => {
        if (label === 'fact') return t('annotations.fact');
        if (label === 'explanation') return t('annotations.explanation');
        return t('annotations.emotion');
    }).join(' / ');
}

function formatSourceKind(
    value: string | null | undefined,
    t: ReturnType<typeof useI18n>,
): string {
    if (value === null) return t('sourceKind.unavailable');
    if (value === 'accepted_candidate_v1_seed') return t('sourceKind.acceptedCandidate');
    if (value === 'review_bound_snapshot') return t('sourceKind.reviewBoundSnapshot');
    return t('sourceKind.pending');
}

function formatLifecycleWarning(
    warning: string,
    t: ReturnType<typeof useI18n>,
): string {
    if (warning === 'draft source handoff is missing; treating candidate source as unavailable for this draft') {
        return t('warnings.missingDraftSource');
    }
    if (
        warning
        === 'v1 seed snapshot is missing draft anchor evidence; current stable snapshot currently relies on accepted handoff metadata only'
    ) {
        return t('warnings.missingAnchorEvidence');
    }
    if (
        warning
        === 'draft discussion application evidence uses legacy appliedDraftVersion values; treating thread.targetVersion as stable snapshot binding truth'
    ) {
        return t('warnings.legacyApplicationEvidence');
    }
    if (
        warning
        === 'current stable snapshot version has no applied review evidence yet; using thread.targetVersion binding only'
    ) {
        return t('warnings.boundVersionOnly');
    }
    if (warning === 'crystallization routing receipt is unavailable; publication path cannot be claimed') {
        return t('warnings.missingRoutingReceipt');
    }
    return warning || t('warnings.fallback');
}

function formatDocumentStatus(
    status: string,
    t: ReturnType<typeof useI18n>,
): string {
    if (status === 'drafting') return t('status.drafting');
    if (status === 'review') return t('status.review');
    if (status === 'crystallization_active') return t('status.crystallizationActive');
    if (status === 'crystallization_failed') return t('status.crystallizationFailed');
    if (status === 'crystallized') return t('status.crystallized');
    if (status === 'archived') return t('status.archived');
    return t('status.inProgress');
}

function formatMonthDay(value: string | null | undefined, locale: string, t: ReturnType<typeof useI18n>): string {
    if (!value) return t('meta.pendingTime');
    const parsed = new Date(value);
    if (Number.isNaN(parsed.getTime())) return t('meta.pendingTime');
    return new Intl.DateTimeFormat(locale, {
        month: 'long',
        day: 'numeric',
    }).format(parsed);
}

function buildReviewLead(
    lifecycle: DraftLifecycleReadModel,
    t: ReturnType<typeof useI18n>,
): string {
    return t('reviewLead', {
        count: lifecycle.reviewBinding.totalThreadCount,
        version: lifecycle.reviewBinding.boundSnapshotVersion,
    });
}

function buildLifecycleSummary(
    lifecycle: DraftLifecycleReadModel,
    locale: string,
    t: ReturnType<typeof useI18n>,
): {headline: string; summary: string; metaLabel: string; showReviewCard: boolean} {
    const stableVersion = lifecycle.stableSnapshot.draftVersion;
    const boundVersion = lifecycle.reviewBinding.boundSnapshotVersion;
    const totalThreads = lifecycle.reviewBinding.totalThreadCount;
    const updateSource =
        lifecycle.reviewBinding.latestThreadUpdatedAt
        || lifecycle.workingCopy.updatedAt
        || lifecycle.stableSnapshot.createdAt;
    const updateLabel = formatMonthDay(updateSource, locale, t);
    const draftingWindowLabel = formatMonthDay(lifecycle.draftingEndsAt, locale, t);
    const reviewWindowLabel = formatMonthDay(lifecycle.reviewEndsAt, locale, t);

    let summary = '';
    if (lifecycle.documentStatus === 'drafting') {
        if (lifecycle.reviewEntryMode === 'manual_only') {
            summary = totalThreads > 0
                ? t('summary.drafting.manualWithIssues', {round: lifecycle.currentRound, count: totalThreads, version: boundVersion})
                : t('summary.drafting.manualNoIssues', {round: lifecycle.currentRound});
        } else {
            summary = totalThreads > 0
                ? t('summary.drafting.autoWithIssues', {
                    round: lifecycle.currentRound,
                    count: totalThreads,
                    version: boundVersion,
                    window: draftingWindowLabel,
                })
                : t('summary.drafting.autoNoIssues', {
                    round: lifecycle.currentRound,
                    window: draftingWindowLabel,
                });
        }
    } else if (lifecycle.documentStatus === 'review') {
        if (lifecycle.reviewWindowExpiredAt) {
            summary = totalThreads > 0
                ? t('summary.review.expiredWithIssues', {count: totalThreads, version: boundVersion})
                : t('summary.review.expiredNoIssues', {version: boundVersion});
        } else {
            summary = totalThreads > 0
                ? t('summary.review.activeWithIssues', {
                    count: totalThreads,
                    version: boundVersion,
                    window: reviewWindowLabel,
                })
                : t('summary.review.activeNoIssues', {
                    version: boundVersion,
                    window: reviewWindowLabel,
                });
        }
    } else if (lifecycle.documentStatus === 'archived') {
        summary = stableVersion > 1
            ? t('summary.archived.withStableVersion', {version: stableVersion})
            : t('summary.archived.withoutStableVersion');
    } else if (lifecycle.documentStatus === 'crystallization_active') {
        summary = t('summary.crystallizationActive', {version: boundVersion});
    } else if (lifecycle.documentStatus === 'crystallization_failed') {
        summary = t('summary.crystallizationFailed', {version: boundVersion});
    } else if (lifecycle.documentStatus === 'crystallized') {
        summary = t('summary.crystallized', {version: stableVersion});
    } else {
        summary = t('summary.default', {version: boundVersion});
    }

    return {
        headline: t('headline', {
            status: formatDocumentStatus(lifecycle.documentStatus, t),
            version: stableVersion,
        }),
        summary,
        metaLabel: updateLabel === t('meta.pendingTime')
            ? t('meta.latestUpdatePending')
            : t('meta.updated', {date: updateLabel}),
        showReviewCard: totalThreads > 0,
    };
}

interface CrucibleLifecycleHeaderProps {
    draftTitle: string;
    titleAction?: ReactNode;
    titleEditor?: ReactNode;
    lifecycle: DraftLifecycleReadModel;
    showEnterReviewAction?: boolean;
    canEnterReviewManually?: boolean;
    enterReviewDisabledReason?: string | null;
    enterReviewPending?: boolean;
    onEnterReview?: () => void;
    showAdvanceReviewAction?: boolean;
    canAdvanceFromReview?: boolean;
    advanceReviewDisabledReason?: string | null;
    advanceReviewPending?: boolean;
    onAdvanceReview?: () => void;
    showEnterCrystallizationAction?: boolean;
    canEnterCrystallization?: boolean;
    enterCrystallizationDisabledReason?: string | null;
    enterCrystallizationPending?: boolean;
    onEnterCrystallization?: () => void;
    revisionDirectionsPending?: boolean;
    governedRoutingError?: string | null;
    pendingGovernedRevisionDirections?: RevisionDirectionProposalView[];
    governedRevisionDirectionOutcome?: RevisionDirectionProposalView | null;
    showExecuteCrystallizationAction?: boolean;
    canExecuteCrystallization?: boolean;
    executeCrystallizationDisabledReason?: string | null;
    executeCrystallizationPending?: boolean;
    onExecuteCrystallization?: () => void;
    showRetryCrystallizationAction?: boolean;
    canRetryCrystallization?: boolean;
    retryCrystallizationDisabledReason?: string | null;
    retryCrystallizationPending?: boolean;
    onRetryCrystallization?: () => void;
    showRollbackCrystallizationAction?: boolean;
    canRollbackCrystallization?: boolean;
    rollbackCrystallizationDisabledReason?: string | null;
    rollbackCrystallizationPending?: boolean;
    onRollbackCrystallization?: () => void;
    showArchiveAction?: boolean;
    canArchive?: boolean;
    archiveDisabledReason?: string | null;
    archivePending?: boolean;
    onArchive?: () => void;
    showRestoreAction?: boolean;
    canRestore?: boolean;
    restoreDisabledReason?: string | null;
    restorePending?: boolean;
    onRestore?: () => void;
}

export default function CrucibleLifecycleHeader(props: CrucibleLifecycleHeaderProps) {
    const t = useI18n('CrucibleLifecycleHeader');
    const locale = useCurrentLocale();
    const {
        draftTitle,
        titleAction = null,
        titleEditor = null,
        lifecycle,
        showEnterReviewAction = false,
        canEnterReviewManually = false,
        enterReviewDisabledReason = null,
        enterReviewPending = false,
        onEnterReview,
        showAdvanceReviewAction = false,
        canAdvanceFromReview = false,
        advanceReviewDisabledReason = null,
        advanceReviewPending = false,
        onAdvanceReview,
        showEnterCrystallizationAction = false,
        canEnterCrystallization = false,
        enterCrystallizationDisabledReason = null,
        enterCrystallizationPending = false,
        onEnterCrystallization,
        revisionDirectionsPending = false,
        governedRoutingError = null,
        pendingGovernedRevisionDirections = [],
        governedRevisionDirectionOutcome = null,
        showExecuteCrystallizationAction = false,
        canExecuteCrystallization = false,
        executeCrystallizationDisabledReason = null,
        executeCrystallizationPending = false,
        onExecuteCrystallization,
        showRetryCrystallizationAction = false,
        canRetryCrystallization = false,
        retryCrystallizationDisabledReason = null,
        retryCrystallizationPending = false,
        onRetryCrystallization,
        showRollbackCrystallizationAction = false,
        canRollbackCrystallization = false,
        rollbackCrystallizationDisabledReason = null,
        rollbackCrystallizationPending = false,
        onRollbackCrystallization,
        showArchiveAction = false,
        canArchive = false,
        archiveDisabledReason = null,
        archivePending = false,
        onArchive,
        showRestoreAction = false,
        canRestore = false,
        restoreDisabledReason = null,
        restorePending = false,
        onRestore,
    } = props;
    const handoff = lifecycle.handoff;
    const lifecycleSummary = buildLifecycleSummary(lifecycle, locale, t);
    const [detailsExpanded, setDetailsExpanded] = useState(false);
    const receipt = lifecycle.stableSnapshot.crystallizationRoutingReceipt;
    const boundCaseId = lifecycle.briefLock?.caseId
        || (receipt?.path === 'governed_case' ? receipt.caseId : null);
    const currentPendingDirections = pendingGovernedRevisionDirections.filter((proposal) => (
        proposal.draftPostId === lifecycle.draftPostId
        && proposal.draftVersion === lifecycle.stableSnapshot.draftVersion
        && proposal.acceptanceMode === 'governance_request'
        && proposal.status === 'open'
        && Boolean(proposal.governanceRequestId)
    ));
    const canNavigateToCircle = lifecycle.documentStatus === 'review'
        && Number.isSafeInteger(lifecycle.circleId) && Number(lifecycle.circleId) > 0
        && !boundCaseId && currentPendingDirections.length === 0
        && !governedRoutingError && !revisionDirectionsPending;

    return (
        <section className={styles.panel} data-testid="draft-lifecycle-header">
            <div className={styles.headerRow}>
                <div>
                    <p className={styles.eyebrow}>{t('header.eyebrow')}</p>
                    <div className={styles.draftTitleRow}>
                        <h2 className={styles.draftTitle}>{draftTitle}</h2>
                        {titleAction}
                    </div>
                    {titleEditor}
                    <h3 className={styles.title}>{lifecycleSummary.headline}</h3>
                    <p className={styles.subtitle}>{lifecycleSummary.summary}</p>
                </div>
            </div>

            {showEnterReviewAction && lifecycle.documentStatus === 'drafting' && onEnterReview && (
                <div className={styles.actionRow}>
                    <button
                        type="button"
                        className={styles.primaryAction}
                        onClick={onEnterReview}
                        data-pending={enterReviewPending ? 'true' : undefined}
                        title={!canEnterReviewManually && enterReviewDisabledReason ? enterReviewDisabledReason : undefined}
                        disabled={enterReviewPending || !canEnterReviewManually}
                    >
                        {enterReviewPending ? t('actions.enterReview.pending') : t('actions.enterReview.idle')}
                    </button>
                    {!enterReviewPending && !canEnterReviewManually && enterReviewDisabledReason && (
                        <p className={styles.actionHint}>{enterReviewDisabledReason}</p>
                    )}
                </div>
            )}

            {lifecycle.documentStatus === 'review' && (
                showAdvanceReviewAction
                || showEnterCrystallizationAction
            ) && (
                <div className={styles.actionRow}>
                    <div className={styles.actionButtonRow}>
                        {showAdvanceReviewAction && onAdvanceReview && (
                            <button
                                type="button"
                                className={styles.primaryAction}
                                onClick={onAdvanceReview}
                                data-pending={advanceReviewPending ? 'true' : undefined}
                                title={!canAdvanceFromReview && advanceReviewDisabledReason ? advanceReviewDisabledReason : undefined}
                                disabled={advanceReviewPending || !canAdvanceFromReview}
                            >
                                {advanceReviewPending ? t('actions.advanceReview.pending') : t('actions.advanceReview.idle')}
                            </button>
                        )}
                        {showEnterCrystallizationAction && onEnterCrystallization && (
                            <button
                                type="button"
                                className={styles.primaryAction}
                                onClick={onEnterCrystallization}
                                data-pending={enterCrystallizationPending ? 'true' : undefined}
                                title={!canEnterCrystallization && enterCrystallizationDisabledReason ? enterCrystallizationDisabledReason : undefined}
                                disabled={enterCrystallizationPending || !canEnterCrystallization}
                            >
                                {enterCrystallizationPending ? t('actions.enterCrystallization.pending') : t('actions.enterCrystallization.idle')}
                            </button>
                        )}
                    </div>
                    {!advanceReviewPending && !canAdvanceFromReview && advanceReviewDisabledReason && (
                        <p className={styles.actionHint}>{advanceReviewDisabledReason}</p>
                    )}
                    {!enterCrystallizationPending && !canEnterCrystallization && enterCrystallizationDisabledReason && (
                        <p className={styles.actionHint}>{enterCrystallizationDisabledReason}</p>
                    )}
                </div>
            )}

            {boundCaseId ? (
                <div className={styles.actionRow} data-testid="draft-case-navigation">
                    <p className={styles.actionHint}>{t('caseNavigation.boundHint')}</p>
                    <Link className={styles.caseLink} href={`/governance/cases/${encodeURIComponent(boundCaseId)}`}>
                        {t('caseNavigation.openCase')}
                    </Link>
                </div>
            ) : canNavigateToCircle ? (
                <div className={styles.actionRow} data-testid="draft-case-navigation">
                    <p className={styles.actionHint}>{t('caseNavigation.unboundHint')}</p>
                    <Link className={styles.caseLink} href={`/circles/${lifecycle.circleId}?tab=governance`}>
                        {t('caseNavigation.openGovernance')}
                    </Link>
                </div>
            ) : null}
            {currentPendingDirections.map((proposal) => (
                <div className={styles.pendingGovernedItem} key={proposal.revisionProposalId} data-testid="draft-pending-case">
                    <p className={styles.cardLine}>{proposal.summary}</p>
                    <p className={styles.actionHint}>{t('caseNavigation.pendingHint')}</p>
                    {proposal.governanceCaseRef ? (
                        proposal.governanceCaseRef !== boundCaseId ? (
                            <Link className={styles.caseLink} href={`/governance/cases/${encodeURIComponent(proposal.governanceCaseRef)}`}>
                                {t('caseNavigation.openCase')}
                            </Link>
                        ) : null
                    ) : (
                        <p className={styles.actionHint} data-testid="draft-case-reference-unavailable">
                            {t('caseNavigation.missingCaseHint')}
                        </p>
                    )}
                </div>
            ))}
            {governedRoutingError && (
                <p className={styles.governedError} role="alert">{t('caseNavigation.loadError')}</p>
            )}
            {revisionDirectionsPending && !boundCaseId && (
                <p className={styles.actionHint} role="status">{t('caseNavigation.loading')}</p>
            )}

            {lifecycle.documentStatus === 'crystallization_active' && showExecuteCrystallizationAction && onExecuteCrystallization && (
                <div className={styles.actionRow}>
                    <button
                        type="button"
                        className={styles.primaryAction}
                        onClick={onExecuteCrystallization}
                        data-pending={executeCrystallizationPending ? 'true' : undefined}
                        title={!canExecuteCrystallization && executeCrystallizationDisabledReason ? executeCrystallizationDisabledReason : undefined}
                        disabled={executeCrystallizationPending || !canExecuteCrystallization}
                    >
                        {executeCrystallizationPending ? t('actions.executeCrystallization.pending') : t('actions.executeCrystallization.idle')}
                    </button>
                    {!executeCrystallizationPending && !canExecuteCrystallization && executeCrystallizationDisabledReason && (
                        <p className={styles.actionHint}>{executeCrystallizationDisabledReason}</p>
                    )}
                </div>
            )}

            {lifecycle.documentStatus === 'crystallization_failed' && (showRetryCrystallizationAction || showRollbackCrystallizationAction) && (
                <div className={styles.actionRow}>
                    <div className={styles.actionButtonRow}>
                        {showRetryCrystallizationAction && onRetryCrystallization && (
                    <button
                        type="button"
                        className={styles.primaryAction}
                        onClick={onRetryCrystallization}
                        data-pending={retryCrystallizationPending ? 'true' : undefined}
                        title={!canRetryCrystallization && retryCrystallizationDisabledReason ? retryCrystallizationDisabledReason : undefined}
                        disabled={retryCrystallizationPending || !canRetryCrystallization}
                    >
                                {retryCrystallizationPending ? t('actions.retryCrystallization.pending') : t('actions.retryCrystallization.idle')}
                            </button>
                        )}
                        {showRollbackCrystallizationAction && onRollbackCrystallization && (
                    <button
                        type="button"
                        className={styles.primaryAction}
                        onClick={onRollbackCrystallization}
                        data-pending={rollbackCrystallizationPending ? 'true' : undefined}
                        title={!canRollbackCrystallization && rollbackCrystallizationDisabledReason ? rollbackCrystallizationDisabledReason : undefined}
                        disabled={rollbackCrystallizationPending || !canRollbackCrystallization}
                    >
                                {rollbackCrystallizationPending ? t('actions.rollbackCrystallization.pending') : t('actions.rollbackCrystallization.idle')}
                            </button>
                        )}
                    </div>
                    {!retryCrystallizationPending && !canRetryCrystallization && retryCrystallizationDisabledReason && (
                        <p className={styles.actionHint}>{retryCrystallizationDisabledReason}</p>
                    )}
                    {!rollbackCrystallizationPending && !canRollbackCrystallization && rollbackCrystallizationDisabledReason && (
                        <p className={styles.actionHint}>{rollbackCrystallizationDisabledReason}</p>
                    )}
                </div>
            )}

            {showArchiveAction && lifecycle.documentStatus !== 'archived' && lifecycle.documentStatus !== 'crystallized' && onArchive && (
                <div className={styles.actionRow}>
                    <button
                        type="button"
                        className={styles.primaryAction}
                        onClick={onArchive}
                        data-pending={archivePending ? 'true' : undefined}
                        title={!canArchive && archiveDisabledReason ? archiveDisabledReason : undefined}
                        disabled={archivePending || !canArchive}
                    >
                        {archivePending ? t('actions.archive.pending') : t('actions.archive.idle')}
                    </button>
                    {!archivePending && !canArchive && archiveDisabledReason && (
                        <p className={styles.actionHint}>{archiveDisabledReason}</p>
                    )}
                </div>
            )}

            {showRestoreAction && lifecycle.documentStatus === 'archived' && onRestore && (
                <div className={styles.actionRow}>
                    <button
                        type="button"
                        className={styles.primaryAction}
                        onClick={onRestore}
                        data-pending={restorePending ? 'true' : undefined}
                        title={!canRestore && restoreDisabledReason ? restoreDisabledReason : undefined}
                        disabled={restorePending || !canRestore}
                    >
                        {restorePending ? t('actions.restore.pending') : t('actions.restore.idle')}
                    </button>
                    {!restorePending && !canRestore && restoreDisabledReason && (
                        <p className={styles.actionHint}>{restoreDisabledReason}</p>
                    )}
                </div>
            )}

            <div className={styles.metaRow}>
                <button
                    type="button"
                    className={styles.detailsToggle}
                    aria-expanded={detailsExpanded}
                    onClick={() => setDetailsExpanded((value) => !value)}
                >
                    <span>{detailsExpanded ? t('details.collapse') : t('details.expand')}</span>
                    <span className={styles.detailsToggleIcon}>{detailsExpanded ? '↑' : '↓'}</span>
                </button>
                <p className={styles.metaLine}>{lifecycleSummary.metaLabel}</p>
            </div>

            {detailsExpanded && (
                <>
                    <div className={styles.grid}>
                        <article className={styles.card}>
                            <p className={styles.cardTitle}>{t('cards.source.title')}</p>
                            {handoff ? (
                                <>
                                    <p className={styles.cardLead}>
                                        {t('cards.source.lead', {count: handoff.sourceMessageIds.length})}
                                    </p>
                                    <p className={styles.cardLine}>
                                        {t('cards.source.candidateId', {id: shortenId(handoff.candidateId, t)})}
                                    </p>
                                    <p className={styles.cardLine}>
                                        {t('cards.source.messageCount', {count: handoff.sourceMessageIds.length})}
                                    </p>
                                    <p className={styles.cardLine}>
                                        {t('cards.source.semanticFacets', {
                                            labels: formatFacetLabels(handoff.sourceSemanticFacets, t),
                                        })}
                                    </p>
                                    <p className={styles.cardLine}>
                                        {t('cards.source.authorAnnotations', {
                                            labels: formatAnnotationLabels(handoff.sourceAuthorAnnotations, t),
                                        })}
                                    </p>
                                    {handoff.lastProposalId && (
                                        <p className={styles.cardLine}>
                                            {t('cards.source.lastProposal', {id: handoff.lastProposalId})}
                                        </p>
                                    )}
                                </>
                            ) : (
                                <>
                                    <p className={styles.cardLead}>{t('cards.source.missingTitle')}</p>
                                    <p className={styles.cardLine}>
                                        {t('cards.source.missingHint')}
                                    </p>
                                </>
                            )}
                        </article>

                        <article className={styles.card}>
                            <p className={styles.cardTitle}>{t('cards.baseline.title')}</p>
                            <p className={styles.cardLead}>
                                {t('cards.baseline.lead', {version: lifecycle.stableSnapshot.draftVersion})}
                            </p>
                            <p className={styles.cardLine}>
                                {t('cards.baseline.source', {
                                    label: formatSourceKind(lifecycle.stableSnapshot.sourceKind, t),
                                })}
                            </p>
                            <p className={styles.cardLine}>
                                {t('cards.baseline.createdAt', {
                                    date: formatDateTime(lifecycle.stableSnapshot.createdAt, locale, t),
                                })}
                            </p>
                            {lifecycle.stableSnapshot.seedDraftAnchorId && (
                                <p className={styles.cardLine}>
                                    {t('cards.baseline.anchorId', {
                                        id: shortenId(lifecycle.stableSnapshot.seedDraftAnchorId, t),
                                    })}
                                </p>
                            )}
                        </article>

                        {lifecycle.stableSnapshot.crystallizationRoutingReceipt && (
                            <article className={styles.card}>
                                <p className={styles.cardTitle}>{t('cards.routing.title')}</p>
                                {lifecycle.stableSnapshot.crystallizationRoutingReceipt.path === 'ordinary_knowledge' ? (
                                    <>
                                        <p className={styles.cardLead}>{t('cards.routing.ordinaryLead')}</p>
                                        <p className={styles.cardLine}>{t('cards.routing.reason')}</p>
                                    </>
                                ) : (
                                    <>
                                        <p className={styles.cardLead}>{t('cards.routing.governedLead')}</p>
                                        <p className={styles.cardLine}>{t('cards.routing.governedReason')}</p>
                                        <p
                                            className={styles.cardLine}
                                            data-testid="governed-revision-effect-status"
                                        >
                                            {governedRevisionDirectionOutcome
                                                ? t(`cards.routing.effect.${governedRevisionDirectionOutcome.status}`)
                                                : t('cards.routing.effect.unavailable')}
                                        </p>
                                        <Link
                                            className={styles.caseLink}
                                            href={`/governance/cases/${encodeURIComponent(lifecycle.stableSnapshot.crystallizationRoutingReceipt.caseId)}`}
                                        >
                                            {t('cards.routing.openCase')}
                                        </Link>
                                    </>
                                )}
                                <p className={styles.cardLine}>
                                    {t('cards.routing.receipt', {
                                        id: shortenId(
                                            lifecycle.stableSnapshot.crystallizationRoutingReceipt.receiptDigest,
                                            t,
                                        ),
                                    })}
                                </p>
                            </article>
                        )}

                        <article className={styles.card}>
                            <p className={styles.cardTitle}>{t('cards.workingCopy.title')}</p>
                            <p className={styles.cardLead}>
                                {lifecycle.documentStatus === 'drafting'
                                    ? t('cards.workingCopy.draftingLead', {version: lifecycle.workingCopy.basedOnSnapshotVersion})
                                    : t('cards.workingCopy.lockedLead', {version: lifecycle.reviewBinding.boundSnapshotVersion})}
                            </p>
                            <p className={styles.cardLine}>
                                {t('cards.workingCopy.basedOnVersion', {version: lifecycle.workingCopy.basedOnSnapshotVersion})}
                            </p>
                            <p className={styles.cardLine}>
                                {t('cards.workingCopy.updatedAt', {
                                    date: formatDateTime(lifecycle.workingCopy.updatedAt, locale, t),
                                })}
                            </p>
                        </article>

                        {lifecycleSummary.showReviewCard && (
                            <article className={styles.card}>
                                <p className={styles.cardTitle}>{t('cards.reviewProgress.title')}</p>
                                <p className={styles.cardLead}>{buildReviewLead(lifecycle, t)}</p>
                                <p className={styles.cardLine}>
                                    {t('cards.reviewProgress.submittedInReview', {
                                        submitted: lifecycle.reviewBinding.openThreadCount,
                                        inReview: lifecycle.reviewBinding.proposedThreadCount,
                                    })}
                                </p>
                                <p className={styles.cardLine}>
                                    {t('cards.reviewProgress.acceptedResolved', {
                                        accepted: lifecycle.reviewBinding.acceptedThreadCount,
                                        resolved: lifecycle.reviewBinding.appliedThreadCount,
                                    })}
                                </p>
                            </article>
                        )}
                    </div>

                    {lifecycle.warnings.length > 0 && (
                        <div className={styles.warningList}>
                            {lifecycle.warnings.map((warning) => (
                                <p key={warning} className={styles.warningItem}>
                                    {formatLifecycleWarning(warning, t)}
                                </p>
                            ))}
                        </div>
                    )}
                </>
            )}
        </section>
    );
}
