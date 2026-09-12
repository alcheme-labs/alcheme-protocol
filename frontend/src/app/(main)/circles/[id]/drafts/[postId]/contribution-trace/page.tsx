'use client';

import { useCallback, useEffect, useState, type FormEvent } from 'react';
import Link from 'next/link';
import { useParams } from 'next/navigation';
import { ArrowLeft, CheckCircle2, ChevronDown, FileText, Wrench, XCircle } from 'lucide-react';

import ContributionTraceTimeline from '@/features/contribution-trace/ContributionTraceTimeline';
import {
    ContributionTraceRequestError,
    fetchDraftContributionTrace,
} from '@/lib/api/contributionTrace';
import { recordDraftContributionAssessmentDecision } from '@/lib/api/discussion';
import type { ContributionTraceResponse } from '@/features/contribution-trace/adapter';
import { useI18n } from '@/i18n/useI18n';
import styles from './page.module.css';

type ReviewDecisionType = 'confirm_high_penetration' | 'reject_high_penetration';

function hasReviewAction(trace: ContributionTraceResponse, action: ReviewDecisionType): boolean {
    return trace.gate?.availableActions.some((item) => item.action === action) ?? false;
}

function formatDraftTraceLoadError(
    err: unknown,
    t: ReturnType<typeof useI18n>,
): string {
    if (err instanceof ContributionTraceRequestError) {
        if (err.code === 'invalid_post_id' || err.status === 400) return t('errors.invalidDraftRoute');
        if (err.status === 401) return t('errors.signInRequired');
        if (err.status === 403) return t('errors.permissionDenied');
        if (err.status === 404) return t('errors.notFound');
    }
    return t('errors.loadFailed');
}

function formatReviewDecisionError(
    err: unknown,
    t: ReturnType<typeof useI18n>,
): string {
    const status = typeof (err as { status?: unknown })?.status === 'number'
        ? (err as { status: number }).status
        : null;
    const code = typeof (err as { code?: unknown })?.code === 'string'
        ? (err as { code: string }).code
        : '';
    if (status === 401) return t('errors.signInRequired');
    if (status === 403) return t('review.permissionDenied');
    if (status === 409 || code === 'contribution_assessment_stale') return t('review.stale');
    return t('review.failed');
}

function formatCorrectionRequestError(
    err: unknown,
    t: ReturnType<typeof useI18n>,
): string {
    const status = typeof (err as { status?: unknown })?.status === 'number'
        ? (err as { status: number }).status
        : null;
    const code = typeof (err as { code?: unknown })?.code === 'string'
        ? (err as { code: string }).code
        : '';
    if (status === 401) return t('errors.signInRequired');
    if (status === 403) return t('correction.permissionDenied');
    if (code === 'contribution_correction_evidence_ref_invalid') return t('correction.invalidEvidence');
    if (status === 409) return t('correction.stale');
    return t('correction.failed');
}

export default function DraftContributionTracePage() {
    const t = useI18n('ContributionTrace');
    const params = useParams();
    const circleId = Number.parseInt(String(params.id || ''), 10);
    const postId = Number.parseInt(String(params.postId || ''), 10);
    const [trace, setTrace] = useState<ContributionTraceResponse | null>(null);
    const [loading, setLoading] = useState(true);
    const [error, setError] = useState<string | null>(null);
    const [reviewBusy, setReviewBusy] = useState<ReviewDecisionType | null>(null);
    const [reviewError, setReviewError] = useState<string | null>(null);
    const [reviewNotice, setReviewNotice] = useState<string | null>(null);
    const [correctionReason, setCorrectionReason] = useState('');
    const [correctionRefs, setCorrectionRefs] = useState<string[]>([]);
    const [correctionBusy, setCorrectionBusy] = useState(false);
    const [correctionError, setCorrectionError] = useState<string | null>(null);
    const [correctionNotice, setCorrectionNotice] = useState<string | null>(null);
    const [correctionOpen, setCorrectionOpen] = useState(false);
    const evidenceTypeLabels: Record<string, string> = {
        source_message: t('evidenceTypes.sourceMessage'),
        draft_snapshot: t('evidenceTypes.draftSnapshot'),
        collab_edit: t('evidenceTypes.collabEdit'),
        review_issue: t('evidenceTypes.reviewIssue'),
        review_application: t('evidenceTypes.reviewApplication'),
        source_selection: t('evidenceTypes.sourceSelection'),
        governance_claim: t('evidenceTypes.governanceClaim'),
        governance_execution: t('evidenceTypes.governanceExecution'),
        governance_outcome: t('evidenceTypes.governanceOutcome'),
        governance_vote: t('evidenceTypes.governanceVote'),
        automation_trigger: t('evidenceTypes.automationTrigger'),
    };
    const stageLabels: Record<string, string> = {
        source_discussion: t('stages.sourceDiscussion'),
        direct_author: t('stages.directAuthor'),
        source_selection: t('stages.sourceSelection'),
        draft_modification: t('stages.draftModification'),
        review_correction: t('stages.reviewCorrection'),
    };

    const loadTrace = useCallback(async (cancelled?: () => boolean) => {
        if (!Number.isFinite(circleId) || !Number.isFinite(postId)) {
            setError(t('errors.invalidDraftRoute'));
            setLoading(false);
            return null;
        }
        setLoading(true);
        setError(null);
        try {
            const payload = await fetchDraftContributionTrace({ draftPostId: postId });
            if (cancelled?.()) return null;
            if (payload.circleId !== null && payload.circleId !== circleId) {
                setTrace(null);
                setError(t('errors.circleMismatch'));
                return null;
            }
            setTrace(payload);
            return payload;
        } catch (err) {
            if (cancelled?.()) return null;
            setTrace(null);
            setError(formatDraftTraceLoadError(err, t));
            return null;
        } finally {
            if (!cancelled?.()) setLoading(false);
        }
    }, [circleId, postId, t]);

    useEffect(() => {
        let cancelled = false;
        setReviewError(null);
        setReviewNotice(null);
        void loadTrace(() => cancelled);
        return () => {
            cancelled = true;
        };
    }, [loadTrace]);

    const handleReviewDecision = async (decisionType: ReviewDecisionType) => {
        if (!trace?.assessment?.id || trace.gate?.state !== 'high_penetration_needs_review') return;
        setReviewBusy(decisionType);
        setReviewError(null);
        setReviewNotice(null);
        try {
            await recordDraftContributionAssessmentDecision({
                draftPostId: postId,
                assessmentId: trace.assessment.id,
                decisionType,
                reason: null,
                affectedRefs: null,
            });
            const refreshed = await loadTrace();
            if (refreshed) setReviewNotice(t('review.success'));
        } catch (err) {
            setReviewError(formatReviewDecisionError(err, t));
        } finally {
            setReviewBusy(null);
        }
    };

    const hasAssessmentId = Boolean(trace?.assessment?.id);
    const reviewAuthorized = trace?.reviewAuthorization?.allowed === true;
    const canConfirm = trace && hasAssessmentId && reviewAuthorized
        ? hasReviewAction(trace, 'confirm_high_penetration')
        : false;
    const canReject = trace && hasAssessmentId && reviewAuthorized
        ? hasReviewAction(trace, 'reject_high_penetration')
        : false;
    const reviewRequired = trace?.gate?.state === 'high_penetration_needs_review';
    const showReviewPanel = Boolean(trace && (reviewRequired || reviewError || reviewNotice));

    const handleCorrectionRequest = async (event: FormEvent<HTMLFormElement>) => {
        event.preventDefault();
        if (!trace?.assessment?.id || !correctionReason.trim() || correctionRefs.length === 0) return;
        setCorrectionBusy(true);
        setCorrectionError(null);
        setCorrectionNotice(null);
        try {
            await recordDraftContributionAssessmentDecision({
                draftPostId: postId,
                assessmentId: trace.assessment.id,
                decisionType: 'request_correction',
                reason: correctionReason.trim(),
                affectedRefs: correctionRefs,
            });
            await loadTrace();
            setCorrectionReason('');
            setCorrectionRefs([]);
            setCorrectionNotice(t('correction.success'));
        } catch (err) {
            setCorrectionError(formatCorrectionRequestError(err, t));
        } finally {
            setCorrectionBusy(false);
        }
    };

    const toggleCorrectionRef = (refId: string) => {
        setCorrectionRefs((current) => current.includes(refId)
            ? current.filter((value) => value !== refId)
            : [...current, refId].sort());
    };

    return (
        <div className={styles.page}>
            <Link href={`/circles/${circleId}`} className={styles.backLink}>
                <ArrowLeft size={16} />
                {t('actions.backToCircle')}
            </Link>
            {loading && <p className={styles.state}>{t('states.loading')}</p>}
            {!loading && error && <p className={styles.error}>{error}</p>}
            {!loading && trace && showReviewPanel && (
                <section className={styles.reviewPanel} aria-labelledby="trace-review-title">
                    <div className={styles.reviewCopy}>
                        <h2 id="trace-review-title">{t('review.title')}</h2>
                        {reviewNotice && !reviewRequired ? (
                            <p>{t('review.completedBody')}</p>
                        ) : (
                            <p>{t('review.readyBody')}</p>
                        )}
                    </div>
                    {reviewRequired && (canConfirm || canReject) && (
                        <div className={styles.reviewActions}>
                            {canConfirm && (
                                <button
                                    type="button"
                                    className={styles.primaryReviewButton}
                                    disabled={reviewBusy !== null}
                                    onClick={() => void handleReviewDecision('confirm_high_penetration')}
                                >
                                    <CheckCircle2 size={15} />
                                    {reviewBusy === 'confirm_high_penetration'
                                        ? t('review.busy')
                                        : t('review.confirmHighPenetration')}
                                </button>
                            )}
                            {canReject && (
                                <button
                                    type="button"
                                    className={styles.secondaryReviewButton}
                                    disabled={reviewBusy !== null}
                                    onClick={() => void handleReviewDecision('reject_high_penetration')}
                                >
                                    <XCircle size={15} />
                                    {reviewBusy === 'reject_high_penetration'
                                        ? t('review.busy')
                                        : t('review.rejectHighPenetration')}
                                </button>
                            )}
                        </div>
                    )}
                    {reviewRequired && !reviewAuthorized && (
                        <p className={styles.reviewAuthority} role="status">
                            {trace.reviewAuthorization?.requiredAuthority === 'circle_manager'
                                ? t('review.managerRequired')
                                : t('review.ownerRequired')}
                        </p>
                    )}
                    {reviewError && <p className={styles.reviewError}>{reviewError}</p>}
                    {reviewNotice && <p className={styles.reviewNotice}>{reviewNotice}</p>}
                </section>
            )}
            {!loading && trace?.assessment && trace.evidenceRefs.length > 0 && (
                <section id="correction-request" className={styles.correctionPanel}>
                    <button
                        type="button"
                        className={styles.correctionToggle}
                        aria-expanded={correctionOpen}
                        aria-controls="correction-request-form"
                        onClick={() => setCorrectionOpen((current) => !current)}
                    >
                        <Wrench size={16} />
                        <span>
                            <strong>{t('correction.title')}</strong>
                            <small>{t('correction.collapsedBody')}</small>
                        </span>
                        <ChevronDown className={correctionOpen ? styles.chevronOpen : undefined} size={16} />
                    </button>
                    {correctionOpen && (
                        <form
                            id="correction-request-form"
                            className={styles.correctionForm}
                            onSubmit={(event) => void handleCorrectionRequest(event)}
                            aria-labelledby="correction-request-title"
                        >
                            <div className={styles.reviewCopy}>
                                <h2 id="correction-request-title">{t('correction.formTitle')}</h2>
                                <p id="correction-request-description">{t('correction.body')}</p>
                            </div>
                            <fieldset className={styles.correctionRefs} aria-describedby="correction-request-description">
                                <legend>{t('correction.evidenceLegend')}</legend>
                                {trace.evidenceRefs.map((ref, index) => (
                                    <label key={ref.refId} className={styles.evidenceChoice}>
                                        <input
                                            type="checkbox"
                                            checked={correctionRefs.includes(ref.refId)}
                                            onChange={() => toggleCorrectionRef(ref.refId)}
                                        />
                                        <span className={styles.evidenceChoiceBody}>
                                            <strong>
                                                <FileText size={14} />
                                                {t('correction.evidenceItem', {
                                                    index: index + 1,
                                                    type: evidenceTypeLabels[ref.refType] ?? t('fallbacks.unknown'),
                                                })}
                                            </strong>
                                            <span>{ref.excerpt || t('correction.excerptUnavailable')}</span>
                                            <small>
                                                {ref.contributorPubkey
                                                    ? t('correction.contributor', {
                                                        contributor: `${ref.contributorPubkey.slice(0, 6)}…${ref.contributorPubkey.slice(-4)}`,
                                                    })
                                                    : t('correction.contributorUnknown')}
                                                {ref.stage
                                                    ? ` · ${stageLabels[ref.stage] ?? ref.stage}`
                                                    : ''}
                                            </small>
                                            <details className={styles.technicalDetails}>
                                                <summary>{t('correction.technicalDetails')}</summary>
                                                <code>{t('correction.referenceId')}: {ref.refId}</code>
                                                {ref.hash && <code>{t('correction.hash')}: {ref.hash}</code>}
                                            </details>
                                        </span>
                                    </label>
                                ))}
                            </fieldset>
                            <label className={styles.correctionReason}>
                                <span>{t('correction.reasonLabel')}</span>
                                <textarea
                                    value={correctionReason}
                                    maxLength={2000}
                                    rows={4}
                                    onChange={(event) => setCorrectionReason(event.target.value)}
                                    placeholder={t('correction.reasonPlaceholder')}
                                />
                            </label>
                            <button
                                type="submit"
                                className={styles.primaryReviewButton}
                                disabled={correctionBusy || !correctionReason.trim() || correctionRefs.length === 0}
                            >
                                {correctionBusy ? t('correction.busy') : t('correction.submit')}
                            </button>
                            {correctionError && <p className={styles.reviewError}>{correctionError}</p>}
                            {correctionNotice && <p className={styles.reviewNotice}>{correctionNotice}</p>}
                        </form>
                    )}
                </section>
            )}
            {!loading && trace && <ContributionTraceTimeline trace={trace} />}
        </div>
    );
}
