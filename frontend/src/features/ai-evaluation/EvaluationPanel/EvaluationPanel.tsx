'use client';

import { AlertTriangle, CheckCircle2, Loader2, RefreshCw, Scale, Send, Undo2 } from 'lucide-react';

import { useI18n } from '@/i18n/useI18n';
import type { NeutralEvaluationArtifactView } from '@/lib/api/neutralEvaluation';
import {
    canPublishEvaluation,
    canRetractEvaluation,
    isEvaluationActionDisabled,
} from './evaluationPanelState';
import styles from './EvaluationPanel.module.css';

export interface EvaluationPanelProps {
    artifact: NeutralEvaluationArtifactView | null;
    busy?: boolean;
    pendingAction?: string | null;
    errorMessage?: string | null;
    onRequest?: () => void;
    onRefresh?: () => void;
    onPublish?: () => void;
    onRetract?: () => void;
    onAppeal?: () => void;
    onReview?: () => void;
}

function renderList(items: string[], emptyText: string) {
    if (!items.length) return <p className={styles.muted}>{emptyText}</p>;
    return (
        <ul className={styles.list}>
            {items.map((item, index) => (
                <li key={`${item}-${index}`}>{item}</li>
            ))}
        </ul>
    );
}

function statusLabel(artifact: NeutralEvaluationArtifactView | null, t: (key: string) => string): string {
    if (!artifact) return t('statuses.noEvaluation');
    if (artifact.status === 'blocked_transcript_review') return t('statuses.blockedTranscriptReview');
    if (artifact.status === 'no_source') return t('statuses.noSource');
    if (artifact.status === 'failed') return t('statuses.failed');
    if (artifact.status === 'pending') return t('statuses.pending');
    return t('statuses.ready');
}

export default function EvaluationPanel({
    artifact,
    busy = false,
    pendingAction = null,
    errorMessage = null,
    onRequest,
    onRefresh,
    onPublish,
    onRetract,
    onAppeal,
    onReview,
}: EvaluationPanelProps) {
    const t = useI18n('NeutralEvaluation');
    const panelBusy = busy || artifact?.status === 'pending';
    const publishAllowed = canPublishEvaluation(artifact);
    const retractAllowed = canRetractEvaluation(artifact);
    const publishDisabled = isEvaluationActionDisabled({
        allowed: publishAllowed,
        panelBusy,
        hasPendingAction: Boolean(pendingAction),
    });
    const retractDisabled = isEvaluationActionDisabled({
        allowed: retractAllowed,
        panelBusy,
        hasPendingAction: Boolean(pendingAction),
    });

    return (
        <section className={styles.panel} aria-label={t('aria.panel')}>
            <header className={styles.header}>
                <div className={styles.titleBlock}>
                    <span className={styles.icon} aria-hidden="true">
                        <Scale size={16} />
                    </span>
                    <div>
                        <h3 className={styles.title}>{t('title')}</h3>
                        <p className={styles.muted}>{t('subtitle')}</p>
                    </div>
                </div>
                <span className={styles.statusPill}>{statusLabel(artifact, t)}</span>
            </header>

            {errorMessage ? (
                <p className={styles.error}>
                    <AlertTriangle size={14} />
                    <span>{errorMessage}</span>
                </p>
            ) : null}

            <div className={styles.actions}>
                <button type="button" className={styles.primaryButton} onClick={onRequest} disabled={panelBusy || Boolean(pendingAction)}>
                    {panelBusy ? <Loader2 size={14} className={styles.spin} /> : <Scale size={14} />}
                    <span>{artifact ? t('actions.runAgain') : t('actions.evaluate')}</span>
                </button>
                <button type="button" className={styles.secondaryButton} onClick={onRefresh} disabled={busy}>
                    <RefreshCw size={14} />
                    <span>{t('actions.refresh')}</span>
                </button>
                {artifact ? (
                    <>
                        <button type="button" className={styles.secondaryButton} onClick={onPublish} disabled={publishDisabled}>
                            <Send size={14} />
                            <span>{t('actions.publish')}</span>
                        </button>
                        <button type="button" className={styles.secondaryButton} onClick={onRetract} disabled={retractDisabled}>
                            <Undo2 size={14} />
                            <span>{t('actions.retract')}</span>
                        </button>
                    </>
                ) : null}
            </div>

            {artifact ? (
                <article className={styles.card}>
                    <div className={styles.metaGrid}>
                        <span>confidence: {artifact.confidence}</span>
                        <span>reviewStatus: {artifact.reviewStatus}</span>
                        <span>appealStatus: {artifact.appealStatus}</span>
                    </div>
                    <p className={styles.summary}>{artifact.summary || artifact.failureCode || t('states.waiting')}</p>

                    <div className={styles.sectionGrid}>
                        <section>
                            <h4>{t('sections.claims')}</h4>
                            {artifact.claims.length ? (
                                <ul className={styles.list}>
                                    {artifact.claims.map((claim) => (
                                        <li key={claim.id}>
                                            <span>{claim.text}</span>
                                            <small>{claim.evidenceRefIds.join(', ')}</small>
                                        </li>
                                    ))}
                                </ul>
                            ) : (
                                <p className={styles.muted}>{t('empty.claims')}</p>
                            )}
                        </section>
                        <section>
                            <h4>{t('sections.evidenceGaps')}</h4>
                            {renderList(artifact.evidenceGaps, t('empty.evidenceGaps'))}
                        </section>
                        <section>
                            <h4>{t('sections.counterpoints')}</h4>
                            {renderList(artifact.counterpoints, t('empty.counterpoints'))}
                        </section>
                        <section>
                            <h4>{t('sections.limitations')}</h4>
                            {renderList(artifact.limitations, t('empty.limitations'))}
                        </section>
                    </div>

                    <div className={styles.actions}>
                        <button type="button" className={styles.secondaryButton} onClick={onAppeal} disabled={panelBusy || Boolean(pendingAction)}>
                            <AlertTriangle size={14} />
                            <span>{t('actions.appeal')}</span>
                        </button>
                        <button type="button" className={styles.secondaryButton} onClick={onReview} disabled={panelBusy || Boolean(pendingAction)}>
                            <CheckCircle2 size={14} />
                            <span>{t('actions.review')}</span>
                        </button>
                    </div>
                </article>
            ) : (
                <p className={styles.muted}>{t('states.empty')}</p>
            )}
        </section>
    );
}
