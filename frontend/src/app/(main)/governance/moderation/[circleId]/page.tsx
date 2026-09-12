'use client';

import Link from 'next/link';
import { useParams, useSearchParams } from 'next/navigation';
import { useCallback, useEffect, useState } from 'react';
import { ArrowLeft, RefreshCw, ShieldAlert } from 'lucide-react';

import { useI18n } from '@/i18n/useI18n';
import {
    delegateModerationReportMinimumShare,
    executeTemporaryCommunicationMute,
    executeTemporaryCommunicationMessageHide,
    fetchCommunicationMessageHideState,
    fetchCommunicationModerationState,
    fetchModerationOutcomes,
    fetchModerationReports,
    submitModerationReport,
    submitOperatorMisconductReport,
    submitCommunicationModerationAppeal,
    triageModerationReport,
    type ModerationReport,
    type CommunicationModerationState,
    type ModerationOutcomeReadback,
    type TemporaryCommunicationMuteResult,
    type TemporaryCommunicationMessageHideResult,
    type CommunicationMessageHideState,
} from '@/lib/api/communication';
import styles from './page.module.css';

export default function ModerationReportsPage() {
    const params = useParams();
    const search = useSearchParams();
    const circleId = Number(params.circleId);
    const t = useI18n('GovernanceModerationReports');
    const outcomeT = useI18n('GovernanceModerationOutcomes');
    const appealBoundaryT = useI18n('GovernedActionAppealBoundary');
    const shareT = useI18n('GovernanceModerationMinimumShare');
    const linkedMessageEnvelope = search.get('message')?.trim() ?? '';
    const [reports, setReports] = useState<ModerationReport[]>([]);
    const [canTriage, setCanTriage] = useState(false);
    const [hasCircleModerationAccess, setHasCircleModerationAccess] = useState(false);
    const [loading, setLoading] = useState(true);
    const [busy, setBusy] = useState(false);
    const [error, setError] = useState<string | null>(null);
    const [target, setTarget] = useState(search.get('target') ?? '');
    const [reasonCode, setReasonCode] = useState<Parameters<typeof submitModerationReport>[0]['reasonCode']>('other');
    const [visibility, setVisibility] = useState<Parameters<typeof submitModerationReport>[0]['reporterVisibility']>('withheld_from_subject');
    const [statement, setStatement] = useState('');
    const [misconductOperator, setMisconductOperator] = useState('');
    const [misconductActionType, setMisconductActionType] = useState('communication.member.mute');
    const [misconductSubjectType, setMisconductSubjectType] = useState('communication_room_member');
    const [misconductSubjectRef, setMisconductSubjectRef] = useState('');
    const [misconductStatement, setMisconductStatement] = useState('');
    type ResolutionKind = Exclude<NonNullable<ModerationReport['triage']>['resolutionKind'], null>;
    const [resolutionByReport, setResolutionByReport] = useState<Record<string, ResolutionKind>>({});
    const [actionReceiptByReport, setActionReceiptByReport] = useState<Record<string, string>>({});
    const [moderationState, setModerationState] = useState<CommunicationModerationState | null>(null);
    const [moderationOutcomes, setModerationOutcomes] = useState<ModerationOutcomeReadback | null>(null);
    const [appealReason, setAppealReason] = useState('contest_restriction');
    const [counterStatement, setCounterStatement] = useState('');
    const [actionTarget, setActionTarget] = useState(search.get('target') ?? '');
    const [actionReason, setActionReason] = useState('other');
    const [actionDurationSeconds, setActionDurationSeconds] = useState(3600);
    const [actionReviewTiming, setActionReviewTiming] = useState<
        'pre_execution' | 'post_execution_ratification'
    >('pre_execution');
    const [actionResult, setActionResult] = useState<TemporaryCommunicationMuteResult | null>(null);
    const [hideEnvelopeId, setHideEnvelopeId] = useState(linkedMessageEnvelope);
    const [hideReason, setHideReason] = useState('other');
    const [hideDurationSeconds, setHideDurationSeconds] = useState(3600);
    const [hideResult, setHideResult] = useState<TemporaryCommunicationMessageHideResult | null>(null);
    const [hideState, setHideState] = useState<CommunicationMessageHideState | null>(null);
    const effectiveRestrictionState = hideState
        ? hideState.effectiveRestrictionState
        : moderationState?.effectiveRestrictionState ?? null;

    const load = useCallback(async () => {
        if (!Number.isSafeInteger(circleId) || circleId <= 0) return;
        setLoading(true);
        setError(null);
        try {
            const [reportsResult, stateResult, outcomesResult] = await Promise.allSettled([
                fetchModerationReports(circleId),
                fetchCommunicationModerationState(circleId),
                fetchModerationOutcomes(circleId),
            ]);
            if (reportsResult.status === 'fulfilled') {
                setReports(reportsResult.value.reports);
                setCanTriage(reportsResult.value.canTriage);
                setHasCircleModerationAccess(true);
            } else {
                setReports([]);
                setCanTriage(false);
                setHasCircleModerationAccess(false);
            }
            if (stateResult.status === 'fulfilled') setModerationState(stateResult.value);
            else setModerationState(null);
            if (outcomesResult.status === 'fulfilled') setModerationOutcomes(outcomesResult.value);
            else setModerationOutcomes(null);
            let linkedMessageLoaded = false;
            if (linkedMessageEnvelope) {
                setHideState(await fetchCommunicationMessageHideState({
                    circleId,
                    envelopeId: linkedMessageEnvelope,
                }));
                linkedMessageLoaded = true;
            }
            if (reportsResult.status === 'rejected'
                && stateResult.status === 'rejected'
                && outcomesResult.status === 'rejected'
                && !linkedMessageLoaded) {
                throw stateResult.reason;
            }
        } catch (cause) {
            setError(cause instanceof Error ? cause.message : t('loadError'));
        } finally {
            setLoading(false);
        }
    }, [circleId, linkedMessageEnvelope, t]);

    useEffect(() => { void load(); }, [load]);

    const submit = async (event: React.FormEvent) => {
        event.preventDefault();
        setBusy(true);
        setError(null);
        try {
            await submitModerationReport({
                circleId,
                targetMemberPubkey: target.trim(),
                reporterVisibility: visibility,
                reasonCode,
                evidenceStatement: statement.trim(),
                idempotencyKey: crypto.randomUUID(),
            });
            setStatement('');
            await load();
        } catch (cause) {
            setError(cause instanceof Error ? cause.message : t('submitError'));
        } finally {
            setBusy(false);
        }
    };

    const transition = async (report: ModerationReport, next: 'triage' | 'resolve') => {
        if (!report.triage) return;
        const resolutionKind = resolutionByReport[report.id] ?? 'no_violation';
        const actionReceiptId = actionReceiptByReport[report.id] ?? '';
        setBusy(true);
        setError(null);
        try {
            await triageModerationReport({
                circleId,
                reportId: report.id,
                expectedVersion: report.version,
                transition: next,
                priority: report.triage.priority,
                abuseSignal: report.triage.abuseSignal,
                resolutionKind: next === 'resolve' ? resolutionKind : null,
                actionReceiptId: next === 'resolve' && resolutionKind === 'action_taken'
                    ? actionReceiptId.trim()
                    : null,
            });
            await load();
        } catch (cause) {
            setError(cause instanceof Error ? cause.message : t('triageError'));
        } finally {
            setBusy(false);
        }
    };

    const submitMisconduct = async (event: React.FormEvent) => {
        event.preventDefault();
        setBusy(true);
        setError(null);
        try {
            await submitOperatorMisconductReport({
                circleId,
                targetOperatorPubkey: misconductOperator.trim(),
                targetActionType: misconductActionType.trim(),
                targetSubjectType: misconductSubjectType.trim(),
                targetSubjectRef: misconductSubjectRef.trim(),
                reasonCode: 'credible_safety_risk',
                evidenceStatement: misconductStatement.trim(),
                idempotencyKey: crypto.randomUUID(),
            });
            setMisconductStatement('');
            await load();
        } catch (cause) {
            setError(cause instanceof Error ? cause.message : t('submitError'));
        } finally {
            setBusy(false);
        }
    };

    const delegateMinimumShare = async (report: ModerationReport) => {
        setBusy(true);
        setError(null);
        try {
            await delegateModerationReportMinimumShare({
                circleId,
                reportId: report.id,
                idempotencyKey: crypto.randomUUID(),
            });
            await load();
        } catch (cause) {
            setError(cause instanceof Error ? cause.message : shareT('error'));
        } finally {
            setBusy(false);
        }
    };

    const executeMute = async (event: React.FormEvent) => {
        event.preventDefault();
        setBusy(true);
        setError(null);
        try {
            const result = await executeTemporaryCommunicationMute({
                circleId,
                targetMemberPubkey: actionTarget.trim(),
                reasonCode: actionReason,
                durationSeconds: actionDurationSeconds,
                reviewTiming: actionReviewTiming,
                idempotencyKey: crypto.randomUUID(),
            });
            setActionResult(result);
        } catch (cause) {
            setError(cause instanceof Error ? cause.message : t('muteError'));
        } finally {
            setBusy(false);
        }
    };

    const executeMessageHide = async (event: React.FormEvent) => {
        event.preventDefault();
        setBusy(true);
        setError(null);
        try {
            const result = await executeTemporaryCommunicationMessageHide({
                circleId,
                envelopeId: hideEnvelopeId.trim(),
                reasonCode: hideReason,
                durationSeconds: hideDurationSeconds,
                idempotencyKey: crypto.randomUUID(),
            });
            setHideResult(result);
            setHideState(await fetchCommunicationMessageHideState({
                circleId,
                envelopeId: result.message.envelopeId,
            }));
        } catch (cause) {
            setError(cause instanceof Error ? cause.message : t('hideError'));
        } finally {
            setBusy(false);
        }
    };

    const submitAppeal = async (event: React.FormEvent) => {
        event.preventDefault();
        const restriction = moderationState?.restriction;
        if (!restriction?.appealAccess.canSubmit) return;
        setBusy(true);
        setError(null);
        try {
            await submitCommunicationModerationAppeal({
                circleId,
                originalReceiptId: restriction.receipt.id,
                reasonCode: appealReason,
                counterStatement: counterStatement.trim(),
            });
            setCounterStatement('');
            setModerationState(await fetchCommunicationModerationState(circleId));
        } catch (cause) {
            setError(cause instanceof Error ? cause.message : t('submitError'));
        } finally {
            setBusy(false);
        }
    };

    const submitMessageAppeal = async (event: React.FormEvent) => {
        event.preventDefault();
        const currentHideState = hideState;
        const restriction = currentHideState?.restriction;
        if (!currentHideState || !restriction?.appealAccess.canSubmit) return;
        const envelopeId = currentHideState.message.envelopeId;
        setBusy(true);
        setError(null);
        try {
            await submitCommunicationModerationAppeal({
                circleId,
                originalReceiptId: restriction.receipt.id,
                reasonCode: appealReason,
                counterStatement: counterStatement.trim(),
            });
            setCounterStatement('');
            setHideState(await fetchCommunicationMessageHideState({
                circleId,
                envelopeId,
            }));
        } catch (cause) {
            setError(cause instanceof Error ? cause.message : t('submitError'));
        } finally {
            setBusy(false);
        }
    };

    return (
        <main className={styles.page} data-testid="governance-moderation-reports">
            <Link href={`/circles/${circleId}?tab=governance`} className={styles.back}><ArrowLeft size={16} />{t('back')}</Link>
            <header className={styles.header}>
                <ShieldAlert size={28} />
                <div><p>{t('eyebrow')}</p><h1>{t('title')}</h1><span>{t('boundary')}</span></div>
            </header>

            {moderationOutcomes && <section className={styles.panel} data-testid="moderation-outcome-readback">
                <h2>{outcomeT('title')}</h2>
                <p className={styles.boundary}>{outcomeT('boundary')}</p>
                <dl className={styles.factList}>
                    <div><dt>{outcomeT('actions')}</dt><dd>{moderationOutcomes.actions.total}</dd></div>
                    <div><dt>{outcomeT('repeated')}</dt><dd>{moderationOutcomes.actions.repeated} · {(moderationOutcomes.actions.recurrenceRateBps / 100).toFixed(2)}%</dd></div>
                    <div><dt>{outcomeT('appeals')}</dt><dd>{moderationOutcomes.appeals.opened} · {moderationOutcomes.appeals.resolved} {outcomeT('resolved')}</dd></div>
                    {moderationOutcomes.appeals.outcomes ? <>
                        <div><dt>{outcomeT('outcomes')}</dt><dd>{outcomeT('uphold')} {moderationOutcomes.appeals.outcomes.uphold} · {outcomeT('modify')} {moderationOutcomes.appeals.outcomes.modify} · {outcomeT('revoke')} {moderationOutcomes.appeals.outcomes.revoke}</dd></div>
                        <div><dt>{outcomeT('corrected')}</dt><dd>{moderationOutcomes.appeals.correctedActionCount} · {((moderationOutcomes.appeals.correctedActionRateBps ?? 0) / 100).toFixed(2)}%</dd></div>
                        <div><dt>{outcomeT('duration')}</dt><dd>{outcomeT('average')} {moderationOutcomes.appeals.duration?.averageSeconds}s · {outcomeT('median')} {moderationOutcomes.appeals.duration?.medianSeconds}s</dd></div>
                    </> : <div><dt>{outcomeT('outcomes')}</dt><dd>{outcomeT('suppressed', { count: moderationOutcomes.appeals.minimumSampleSize })}</dd></div>}
                    {moderationOutcomes.operatorConcentration.privacyStatus === 'available' ? <>
                        <div><dt>{outcomeT('operators')}</dt><dd>{moderationOutcomes.operatorConcentration.distinctOperatorCount}</dd></div>
                        <div><dt>{outcomeT('topShare')}</dt><dd>{((moderationOutcomes.operatorConcentration.topOperatorShareBps ?? 0) / 100).toFixed(2)}%</dd></div>
                    </> : <div><dt>{outcomeT('concentration')}</dt><dd>{outcomeT('suppressed', { count: moderationOutcomes.operatorConcentration.minimumSampleSize })}</dd></div>}
                </dl>
                <p className={styles.boundary}>{outcomeT('neverPerformance')}</p>
            </section>}

            <section className={styles.panel} data-testid="communication-moderation-state">
                <h2>{t('myStateTitle')}</h2>
                {!moderationState?.restriction ? <p>{t('myStateClear')}</p> : (<>
                    <dl className={styles.factList}>
                        <div><dt>{t('scope')}</dt><dd>{moderationState.restriction.type}</dd></div>
                        <div><dt>{t('reason')}</dt><dd>{moderationState.restriction.reasonCode}</dd></div>
                        <div><dt>{t('expiry')}</dt><dd>{new Date(moderationState.restriction.expiresAt).toLocaleString()}</dd></div>
                        <div><dt>{t('effect')}</dt><dd>{moderationState.restriction.effect.state}</dd></div>
                        <div><dt>{t('review')}</dt><dd>{moderationState.restriction.ratification.status}</dd></div>
                        {moderationState.restriction.ratification.caseId && <div>
                            <dt>{t('ratificationCase')}</dt>
                            <dd><Link href={moderationState.restriction.ratification.caseUrl ?? '#'}>{t('openCase')}</Link></dd>
                        </div>}
                        <div><dt>{t('appeal')}</dt><dd>{new Date(moderationState.restriction.receipt.appealWindowEndsAt).toLocaleString()}</dd></div>
                        <div><dt>{t('appeal')}</dt><dd>{moderationState.restriction.appealAccess.status}</dd></div>
                        <div><dt>Appeal destination</dt><dd>{moderationState.restriction.appealAccess.routing.selectedChannel} · {moderationState.restriction.appealAccess.routing.channels.operatorMisconduct.authorityClass}</dd></div>
                        <div><dt>Appeal visibility</dt><dd>{moderationState.restriction.appealAccess.routing.channels.operatorMisconduct.visibility}</dd></div>
                        <div><dt>Platform Safety / Legal</dt><dd>{moderationState.restriction.appealAccess.routing.channels.platformSafetyLegal.status}</dd></div>
                        {moderationState.restriction.appealAccess.appeal?.governanceCaseRef && <div>
                            <dt>{t('appeal')}</dt>
                            <dd><Link href={moderationState.restriction.appealAccess.appeal.governanceCaseUrl ?? '#'}>{t('openAppealCase')}</Link></dd>
                        </div>}
                        <div><dt>{t('scope')}</dt><dd>membership_independent_no_other_circle_permissions</dd></div>
                    </dl>
                    <p className={styles.boundary} data-testid="moderation-appeal-no-aggravation-boundary">
                        {appealBoundaryT('copy')}
                    </p>
                    {moderationState.restriction.appealAccess.canSubmit && <form onSubmit={submitAppeal} data-testid="moderation-appeal-form">
                        <label>{t('reason')}<input value={appealReason} onChange={(event) => setAppealReason(event.target.value)} minLength={3} maxLength={96} required /></label>
                        <label>{t('evidence')}<textarea value={counterStatement} onChange={(event) => setCounterStatement(event.target.value)} minLength={10} maxLength={4000} required /></label>
                        <p className={styles.boundary}>{t('submitBoundary')}</p>
                        <button type="submit" disabled={busy}>{busy ? t('saving') : t('submit')}</button>
                    </form>}
                </>)}
            </section>

            {hideState && <section className={styles.panel} data-testid="message-hide-subject-readback">
                <h2>{t('hideTitle')}</h2>
                <dl className={styles.factList}>
                    <div><dt>{t('messageEnvelope')}</dt><dd><code>{hideState.message.envelopeId}</code></dd></div>
                    <div><dt>{t('scope')}</dt><dd>{hideState.restriction?.type ?? 'none'}</dd></div>
                    <div><dt>{t('effect')}</dt><dd>{hideState.restriction?.effect.state ?? 'none'}</dd></div>
                    <div><dt>{t('expiry')}</dt><dd>{hideState.restriction ? new Date(hideState.restriction.expiresAt).toLocaleString() : '—'}</dd></div>
                    <div><dt>{t('appeal')}</dt><dd>{hideState.restriction?.appealAccess.status ?? 'not_available'}</dd></div>
                    {hideState.restriction && <div><dt>Appeal destination</dt><dd>{hideState.restriction.appealAccess.routing.selectedChannel} · {hideState.restriction.appealAccess.routing.channels.operatorMisconduct.authorityClass}</dd></div>}
                    {hideState.restriction && <div><dt>Platform Safety / Legal</dt><dd>{hideState.restriction.appealAccess.routing.channels.platformSafetyLegal.status}</dd></div>}
                    <div><dt>{t('appeal')}</dt><dd><code>{hideState.restriction?.receipt.id ?? '—'}</code></dd></div>
                    <div><dt>{t('digest')}</dt><dd><code>{hideState.message.evidenceDigest?.slice(0, 16) ?? '—'}…</code></dd></div>
                    <div><dt>{t('deleteBoundary')}</dt><dd>{hideState.message.deleted ? 'deleted' : t('deleteBoundaryValue')}</dd></div>
                </dl>
                {hideState.restriction?.appealAccess.canSubmit && <form onSubmit={submitMessageAppeal} data-testid="message-hide-appeal-form">
                    <label>{t('reason')}<input value={appealReason} onChange={(event) => setAppealReason(event.target.value)} minLength={3} maxLength={96} required /></label>
                    <label>{t('evidence')}<textarea value={counterStatement} onChange={(event) => setCounterStatement(event.target.value)} minLength={10} maxLength={4000} required /></label>
                    <p className={styles.boundary}>{t('submitBoundary')}</p>
                    <button type="submit" disabled={busy}>{busy ? t('saving') : t('submit')}</button>
                </form>}
            </section>}

            {effectiveRestrictionState && <section className={styles.panel} data-testid="effective-subject-restriction-state">
                <h2>Effective subject restriction state</h2>
                <dl className={styles.factList}>
                    <div><dt>Status</dt><dd>{effectiveRestrictionState.status}</dd></div>
                    <div><dt>Active effects</dt><dd>{effectiveRestrictionState.activeEffectCount}</dd></div>
                    <div><dt>Composition</dt><dd>{effectiveRestrictionState.composition.rule}</dd></div>
                </dl>
                {effectiveRestrictionState.activeEffects.map((effect) => <article key={effect.effect.id} data-restriction-effect={effect.effect.id}>
                    <dl className={styles.factList}>
                        <div><dt>Action</dt><dd>{effect.actionType}</dd></div>
                        <div><dt>{t('scope')}</dt><dd>{JSON.stringify(effect.scope)}</dd></div>
                        <div><dt>Priority</dt><dd>{effect.priority.riskFloor} · {effect.priority.rank}</dd></div>
                        <div><dt>{t('expiry')}</dt><dd>{new Date(effect.expiresAt).toLocaleString()}</dd></div>
                        <div><dt>Authority</dt><dd><code>{effect.authority.bindingId}</code></dd></div>
                        <div><dt>Receipt</dt><dd><code>{effect.receipt.id}</code></dd></div>
                        <div><dt>{t('effect')}</dt><dd>{effect.effect.state}</dd></div>
                        <div><dt>{t('appeal')}</dt><dd>{effect.appeal.status}</dd></div>
                    </dl>
                </article>)}
            </section>}

            {hasCircleModerationAccess && <form className={styles.panel} onSubmit={submit} data-testid="moderation-report-form">
                <h2>{t('submitTitle')}</h2>
                <label>{t('target')}<input value={target} onChange={(event) => setTarget(event.target.value)} required /></label>
                <div className={styles.twoColumns}>
                    <label>{t('reason')}<select value={reasonCode} onChange={(event) => setReasonCode(event.target.value as typeof reasonCode)}>
                        {['spam', 'harassment', 'credible_safety_risk', 'impersonation', 'other'].map((value) => <option key={value} value={value}>{t(`reasonValue.${value}`)}</option>)}
                    </select></label>
                    <label>{t('visibility')}<select value={visibility} onChange={(event) => setVisibility(event.target.value as typeof visibility)}>
                        <option value="withheld_from_subject">{t('visibilityValue.withheld')}</option>
                        <option value="institutional_actor">{t('visibilityValue.institutional')}</option>
                    </select></label>
                </div>
                <label>{t('evidence')}<textarea value={statement} onChange={(event) => setStatement(event.target.value)} minLength={10} maxLength={2000} required /></label>
                <p className={styles.boundary}>{t('submitBoundary')}</p>
                <button type="submit" disabled={busy}>{busy ? t('saving') : t('submit')}</button>
            </form>}

            {hasCircleModerationAccess && <form className={styles.panel} onSubmit={submitMisconduct} data-testid="operator-misconduct-report-form">
                <h2>Report exact operator capability misconduct</h2>
                <p className={styles.boundary}>The reported operator and its Committee cannot access or triage this report. Without an independently bound authority it remains blocked and never triggers an automatic suspension.</p>
                <label>Operator wallet<input value={misconductOperator} onChange={(event) => setMisconductOperator(event.target.value)} required /></label>
                <div className={styles.twoColumns}>
                    <label>Action type<input value={misconductActionType} onChange={(event) => setMisconductActionType(event.target.value)} pattern="[a-z][a-z0-9._-]{2,95}" required /></label>
                    <label>Subject type<input value={misconductSubjectType} onChange={(event) => setMisconductSubjectType(event.target.value)} pattern="[a-z][a-z0-9._-]{2,63}" required /></label>
                </div>
                <label>Subject reference<input value={misconductSubjectRef} onChange={(event) => setMisconductSubjectRef(event.target.value)} maxLength={191} required /></label>
                <label>{t('evidence')}<textarea value={misconductStatement} onChange={(event) => setMisconductStatement(event.target.value)} minLength={10} maxLength={2000} required /></label>
                <button type="submit" disabled={busy}>{busy ? t('saving') : t('submit')}</button>
            </form>}

            {canTriage && <form className={styles.panel} onSubmit={executeMute} data-testid="temporary-communication-mute-form">
                <h2>{t('muteTitle')}</h2>
                <p className={styles.boundary}>{t('muteBoundary')}</p>
                <label>{t('target')}<input value={actionTarget} onChange={(event) => setActionTarget(event.target.value)} required /></label>
                <div className={styles.twoColumns}>
                    <label>{t('reason')}<select value={actionReason} onChange={(event) => setActionReason(event.target.value)}>
                        {['spam', 'harassment', 'credible_safety_risk', 'impersonation', 'other'].map((value) => <option key={value} value={value}>{t(`reasonValue.${value}`)}</option>)}
                    </select></label>
                    <label>{t('duration')}<select value={actionDurationSeconds} onChange={(event) => setActionDurationSeconds(Number(event.target.value))}>
                        <option value={900}>{t('durationValue.15m')}</option>
                        <option value={3600}>{t('durationValue.1h')}</option>
                        <option value={21600}>{t('durationValue.6h')}</option>
                        <option value={86400}>{t('durationValue.24h')}</option>
                    </select></label>
                    <label>{t('review')}<select value={actionReviewTiming} onChange={(event) => setActionReviewTiming(event.target.value as typeof actionReviewTiming)}>
                        <option value="pre_execution">{t('preExecutionReview')}</option>
                        <option value="post_execution_ratification">{t('emergencyRatificationReview')}</option>
                    </select></label>
                </div>
                {actionReviewTiming === 'post_execution_ratification' && actionReason !== 'credible_safety_risk' && (
                    <p className={styles.boundary}>{t('emergencyReasonRequired')}</p>
                )}
                <dl className={styles.factList}>
                    <div><dt>{t('scope')}</dt><dd>{t('muteScope')}</dd></div>
                    <div><dt>{t('maximum')}</dt><dd>{t('maximumValue')}</dd></div>
                    <div><dt>{t('expiry')}</dt><dd>{t('automaticExpiry')}</dd></div>
                    <div><dt>{t('notification')}</dt><dd>{t('notificationValue')}</dd></div>
                    <div><dt>{t('review')}</dt><dd>{actionReviewTiming === 'pre_execution' ? t('preExecutionReview') : t('emergencyRatificationReview')}</dd></div>
                    <div><dt>{t('appeal')}</dt><dd>{t('appealValue')}</dd></div>
                </dl>
                <button type="submit" disabled={busy || (actionReviewTiming === 'post_execution_ratification' && actionReason !== 'credible_safety_risk')}>{busy ? t('saving') : t('executeMute')}</button>
                {actionResult && <p className={styles.success} data-testid="temporary-mute-readback">
                    {t('muteSucceeded')} <Link href={`/governance/operations/${circleId}/${encodeURIComponent(actionResult.receipt.id)}`}>{t('openReceipt')}</Link>
                    {actionResult.ratificationCase && <> · <Link href={actionResult.ratificationCase.url}>{t('openCase')}</Link></>}
                </p>}
            </form>}

            {canTriage && <form className={styles.panel} onSubmit={executeMessageHide} data-testid="temporary-message-hide-form">
                <h2>{t('hideTitle')}</h2>
                <p className={styles.boundary}>{t('hideBoundary')}</p>
                <label>{t('messageEnvelope')}<input value={hideEnvelopeId} onChange={(event) => setHideEnvelopeId(event.target.value)} required /></label>
                <div className={styles.twoColumns}>
                    <label>{t('reason')}<select value={hideReason} onChange={(event) => setHideReason(event.target.value)}>
                        {['spam', 'harassment', 'credible_safety_risk', 'impersonation', 'other'].map((value) => <option key={value} value={value}>{t(`reasonValue.${value}`)}</option>)}
                    </select></label>
                    <label>{t('duration')}<select value={hideDurationSeconds} onChange={(event) => setHideDurationSeconds(Number(event.target.value))}>
                        <option value={900}>{t('durationValue.15m')}</option>
                        <option value={3600}>{t('durationValue.1h')}</option>
                        <option value={21600}>{t('durationValue.6h')}</option>
                        <option value={86400}>{t('durationValue.24h')}</option>
                    </select></label>
                </div>
                <dl className={styles.factList}>
                    <div><dt>{t('scope')}</dt><dd>{t('hideScope')}</dd></div>
                    <div><dt>{t('expiry')}</dt><dd>{t('hideRestore')}</dd></div>
                    <div><dt>{t('deleteBoundary')}</dt><dd>{t('deleteBoundaryValue')}</dd></div>
                </dl>
                <button type="submit" disabled={busy}>{busy ? t('saving') : t('executeHide')}</button>
                {hideResult && <p className={styles.success} data-testid="temporary-message-hide-readback">
                    {t('hideSucceeded')} <Link href={`/governance/operations/${circleId}/${encodeURIComponent(hideResult.receipt.id)}`}>{t('openReceipt')}</Link>
                    {hideState?.restriction && <> · {hideState.restriction.effect.state} · {hideState.restriction.publicProjection}</>}
                </p>}
            </form>}

            {error && <p className={styles.error} role="alert">{error}</p>}
            <section className={styles.panel} aria-labelledby="moderation-report-list-title">
                <div className={styles.listHeader}><h2 id="moderation-report-list-title">{canTriage ? t('queueTitle') : t('myReports')}</h2><button type="button" onClick={() => void load()} disabled={loading}><RefreshCw size={15} />{t('refresh')}</button></div>
                {loading ? <p>{t('loading')}</p> : reports.length === 0 ? <p>{t('empty')}</p> : (
                    <ol className={styles.list}>{reports.map((report) => {
                        const resolutionKind = resolutionByReport[report.id] ?? 'no_violation';
                        const actionReceiptId = actionReceiptByReport[report.id] ?? '';
                        return <li key={report.id} data-report-status={report.reporterStatus.state}>
                            <div className={styles.reportHeader}><strong>{report.reasonCode}</strong><span>{report.reporterStatus.state}{report.triage ? ` · ${report.triage.priority}` : ''}</span></div>
                            <code>{report.subject.ref}</code>
                            <p>{report.sealedEvidence.statement}</p>
                            <dl>
                                <div><dt>Status</dt><dd>{report.reporterStatus.state}</dd></div>
                                <div><dt>Updated</dt><dd>{new Date(report.reporterStatus.updatedAt).toLocaleString()}</dd></div>
                                {report.triage && <div><dt>{t('sla')}</dt><dd>{new Date(report.triage.slaAt).toLocaleString()}</dd></div>}
                                <div><dt>{t('digest')}</dt><dd><code>{report.sealedEvidence.digest.slice(0, 16)}…</code></dd></div>
                                <div><dt>{t('preflight')}</dt><dd>{report.actionPreflight.availability}</dd></div>
                            </dl>
                            {report.operatorMisconduct && <dl data-testid={`operator-misconduct-boundary-${report.id}`}>
                                <div><dt>Independent authority</dt><dd>{report.operatorMisconduct.triageStatus}</dd></div>
                                <div><dt>Reported operator access</dt><dd>{report.operatorMisconduct.reportedOperatorAccess}</dd></div>
                                <div><dt>Reported Committee access</dt><dd>{report.operatorMisconduct.reportedCommitteeAccess}</dd></div>
                                <div><dt>Automatic suspension</dt><dd>{report.operatorMisconduct.automaticSuspension}</dd></div>
                            </dl>}
                            <p className={styles.boundary}>{t('actionBoundary')}</p>
                            {canTriage && report.triage && <div className={styles.minimumShare} data-testid={`moderation-minimum-share-${report.id}`}>
                                <p className={styles.boundary}>{shareT('boundary')}</p>
                                {report.minimumShare ? <dl>
                                    <div><dt>{shareT('status')}</dt><dd>{report.minimumShare.status}</dd></div>
                                    <div><dt>{t('expiry')}</dt><dd>{report.minimumShare.expiresAt ? new Date(report.minimumShare.expiresAt).toLocaleString() : '—'}</dd></div>
                                    <div><dt>{t('digest')}</dt><dd><code>{report.minimumShare.digest.slice(0, 16)}…</code></dd></div>
                                    <div><dt>{shareT('case')}</dt><dd><Link href={`/governance/cases/${encodeURIComponent(report.minimumShare.caseId)}`}>{shareT('openCase')}</Link></dd></div>
                                    <div><dt>{shareT('package')}</dt><dd><Link href={`/governance/evidence-shares/${encodeURIComponent(report.minimumShare.packageId)}`}>{shareT('openPackage')}</Link></dd></div>
                                </dl> : <button type="button" disabled={busy || report.triage.status === 'closed'} onClick={() => void delegateMinimumShare(report)}>{shareT('delegate')}</button>}
                            </div>}
                            {canTriage && report.triage && report.triage.status !== 'closed' && <div className={styles.actions}>
                                <button type="button" disabled={busy} onClick={() => void transition(report, 'triage')}>{t('markTriaged')}</button>
                                <label>{t('review')}<select value={resolutionKind} onChange={(event) => setResolutionByReport((current) => ({ ...current, [report.id]: event.target.value as ResolutionKind }))}>
                                    {['action_taken', 'no_violation', 'transferred', 'closed'].map((value) => <option key={value} value={value}>{value}</option>)}
                                </select></label>
                                {resolutionKind === 'action_taken' && <label>{t('openReceipt')}<input value={actionReceiptId} onChange={(event) => setActionReceiptByReport((current) => ({ ...current, [report.id]: event.target.value }))} required /></label>}
                                <button type="button" disabled={busy || (resolutionKind === 'action_taken' && !actionReceiptId.trim())} onClick={() => void transition(report, 'resolve')}>{t('close')}</button>
                            </div>}
                        </li>;
                    })}</ol>
                )}
            </section>
        </main>
    );
}
