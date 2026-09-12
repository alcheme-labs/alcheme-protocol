'use client';

import Link from 'next/link';
import { useCallback, useEffect, useMemo, useState } from 'react';

import { useI18n } from '@/i18n/useI18n';
import {
    fetchFeedGovernance,
    startFeedExperiment,
    stopFeedExperiment,
    updateFeedRankingPolicy,
    type FeedGovernanceCapability,
    type FeedPolicyReEvaluationReadback,
    type FeedRankingPolicyReadback,
    type FeedRecommendationExperimentReadback,
} from '@/lib/api/feedGovernance';

import styles from './FeedGovernanceControls.module.css';

const SIGNAL_KEYS = [
    'content_safety',
    'discussion_quality',
    'engagement',
    'freshness',
    'member_relevance',
] as const;

interface FeedGovernanceSurface {
    policy: FeedRankingPolicyReadback | null;
    capability: FeedGovernanceCapability;
    experiments: FeedRecommendationExperimentReadback[];
}

export default function FeedGovernanceControls({
    circleId,
    active,
}: {
    circleId: number;
    active: boolean;
}) {
    const t = useI18n('CircleSettingsSheet');
    const [surface, setSurface] = useState<FeedGovernanceSurface | null>(null);
    const [loading, setLoading] = useState(false);
    const [busy, setBusy] = useState<'policy' | 'start' | 'stop' | null>(null);
    const [error, setError] = useState<string | null>(null);
    const [signalKeys, setSignalKeys] = useState<string[]>(['engagement', 'freshness']);
    const [factorBps, setFactorBps] = useState(2500);
    const [maxDurationSeconds, setMaxDurationSeconds] = useState(3600);
    const [maxActiveRatioBps, setMaxActiveRatioBps] = useState(1000);
    const [experimentRatioBps, setExperimentRatioBps] = useState(500);
    const [experimentDurationSeconds, setExperimentDurationSeconds] = useState(1800);
    const [applicationMode, setApplicationMode] = useState<'prospective_only' | 're_evaluate_existing_content'>('prospective_only');
    const [reEvaluateContentInput, setReEvaluateContentInput] = useState('');
    const [reEvaluateDurationSeconds, setReEvaluateDurationSeconds] = useState(1800);
    const [lastReEvaluation, setLastReEvaluation] = useState<FeedPolicyReEvaluationReadback[]>([]);
    const [lastReEvaluationFailures, setLastReEvaluationFailures] = useState<Array<{ contentId: string; error: string }>>([]);
    const [lastReEvaluationStatus, setLastReEvaluationStatus] = useState<'succeeded' | 'partial' | 'failed' | null>(null);

    const load = useCallback(async () => {
        setLoading(true);
        setError(null);
        try {
            const next = await fetchFeedGovernance(circleId);
            setSurface(next);
            if (next.policy) {
                setSignalKeys(next.policy.signalKeys);
                setFactorBps(next.policy.defaultFactorBps);
                setMaxDurationSeconds(next.policy.maxDurationSeconds);
                setMaxActiveRatioBps(next.policy.maxActiveRatioBps);
                setExperimentRatioBps(Math.min(500, next.policy.maxActiveRatioBps));
                setExperimentDurationSeconds(Math.min(1800, next.policy.maxDurationSeconds));
                setReEvaluateDurationSeconds(Math.min(1800, next.policy.maxDurationSeconds));
            }
        } catch (loadError) {
            setError(message(loadError));
        } finally {
            setLoading(false);
        }
    }, [circleId]);

    useEffect(() => {
        if (!active || !Number.isSafeInteger(circleId) || circleId <= 0) return;
        void load();
    }, [active, circleId, load]);

    const activeExperiment = useMemo(
        () => surface?.experiments.find((experiment) => experiment.state === 'active') ?? null,
        [surface?.experiments],
    );
    const canOperate = surface?.capability.canOperate === true;
    const canUpdatePolicy = surface?.capability.actions.updatePolicy === true;
    const canStartExperiment = surface?.capability.actions.startExperiment === true;
    const canStopExperiment = surface?.capability.actions.stopExperiment === true;
    const canDownrankContent = surface?.capability.actions.downrankContent === true;
    const reEvaluateContentIds = useMemo(
        () => [...new Set(reEvaluateContentInput.split(/[\n,]/).map((value) => value.trim()).filter(Boolean))].sort(),
        [reEvaluateContentInput],
    );
    const applicationValid = applicationMode === 'prospective_only'
        || (canDownrankContent && reEvaluateContentIds.length >= 1 && reEvaluateContentIds.length <= 25);

    const run = async (kind: 'policy' | 'start' | 'stop', operation: () => Promise<unknown>) => {
        setBusy(kind);
        setError(null);
        try {
            await operation();
            await load();
        } catch (operationError) {
            setError(message(operationError));
        } finally {
            setBusy(null);
        }
    };

    return (
        <section className={styles.panel} data-testid="feed-governance-settings">
            <div className={styles.header}>
                <div>
                    <div className={styles.title}>{t('governance.feed.title')}</div>
                    <div className={styles.description}>{t('governance.feed.description')}</div>
                </div>
                <button type="button" className={styles.refresh} onClick={() => void load()} disabled={loading || busy !== null}>
                    {loading ? t('governance.feed.loading') : t('governance.feed.refresh')}
                </button>
            </div>

            {surface?.policy ? (
                <div className={styles.readback} data-testid="feed-governance-policy-readback">
                    <span>{t('governance.feed.policyVersion')}</span><strong>v{surface.policy.version}</strong>
                    <span>{t('governance.feed.policySignals')}</span><strong>{surface.policy.signalKeys.join(', ')}</strong>
                    <span>{t('governance.feed.policyLimits')}</span>
                    <strong>{surface.policy.defaultFactorBps} bps · {surface.policy.maxActiveRatioBps} bps · {surface.policy.maxDurationSeconds}s</strong>
                    <span>{t('governance.feed.activationBoundary')}</span><strong>{t('governance.feed.aiDisabled')}</strong>
                    <span>{t('governance.feed.receipt')}</span>
                    <Link href={`/governance/operations/${circleId}/${encodeURIComponent(surface.policy.sourceReceiptId)}`}>
                        {surface.policy.sourceReceiptId}
                    </Link>
                </div>
            ) : (
                <div className={styles.notice}>{t('governance.feed.noPolicy')}</div>
            )}

            {activeExperiment ? (
                <div className={styles.readback} data-testid="feed-governance-experiment-readback">
                    <span>{t('governance.feed.experimentState')}</span><strong>{activeExperiment.state}</strong>
                    <span>{t('governance.feed.experimentRatio')}</span><strong>{activeExperiment.targetRatioBps} bps</strong>
                    <span>{t('governance.feed.experimentExpiry')}</span><strong>{new Date(activeExperiment.expiresAt).toLocaleString()}</strong>
                    <span>{t('governance.feed.effect')}</span><strong>{activeExperiment.effectId}</strong>
                    <span>{t('governance.feed.receipt')}</span>
                    <Link href={`/governance/operations/${circleId}/${encodeURIComponent(activeExperiment.receiptId)}`}>
                        {activeExperiment.receiptId}
                    </Link>
                </div>
            ) : (
                <div className={styles.notice}>{t('governance.feed.noActiveExperiment')}</div>
            )}

            {lastReEvaluationStatus ? (
                <div className={styles.readback} data-testid="feed-governance-re-evaluation-readback">
                    <span>{t('governance.feed.reEvaluationStatus')}</span>
                    <strong>{lastReEvaluationStatus}</strong>
                    {lastReEvaluation.map((item) => (
                        <div className={styles.readbackRow} key={item.contentId}>
                            <strong>{item.contentId}</strong>
                            <Link href={`/governance/operations/${circleId}/${encodeURIComponent(item.receiptId)}`}>
                                {item.receiptId}
                            </Link>
                            <span>{t('governance.feed.effect')}: {item.effectId}</span>
                            <span>{item.authority.sourceType}:{item.authority.sourceRef}</span>
                            <span>{item.appeal.ref} · {item.appeal.deadline ? new Date(item.appeal.deadline).toLocaleString() : '—'}</span>
                        </div>
                    ))}
                    {lastReEvaluationFailures.map((item) => (
                        <div className={styles.readbackRow} key={item.contentId}>
                            <strong>{item.contentId}</strong>
                            <span className={styles.failure}>{item.error}</span>
                        </div>
                    ))}
                </div>
            ) : null}

            {canOperate ? (
                <div className={styles.controls} data-authority="exact-frozen-committee-operator">
                    <fieldset className={styles.fieldset}>
                        <legend>{t('governance.feed.signalLegend')}</legend>
                        <div className={styles.signalGrid}>
                            {SIGNAL_KEYS.map((signal) => (
                                <label key={signal}>
                                    <input
                                        type="checkbox"
                                        checked={signalKeys.includes(signal)}
                                        onChange={(event) => setSignalKeys((current) => event.target.checked
                                            ? [...new Set([...current, signal])]
                                            : current.filter((value) => value !== signal))}
                                    />
                                    {t(`governance.feed.signals.${signal}`)}
                                </label>
                            ))}
                        </div>
                    </fieldset>
                    <NumberField label={t('governance.feed.factor')} value={factorBps} min={100} max={9000} onChange={setFactorBps} />
                    <NumberField label={t('governance.feed.maxRatio')} value={maxActiveRatioBps} min={1} max={5000} onChange={setMaxActiveRatioBps} />
                    <NumberField label={t('governance.feed.maxDuration')} value={maxDurationSeconds} min={300} max={86400} onChange={setMaxDurationSeconds} />
                    <label className={styles.field}>
                        <span>{t('governance.feed.applicationMode')}</span>
                        <select
                            data-testid="feed-governance-policy-application"
                            value={applicationMode}
                            onChange={(event) => setApplicationMode(event.target.value as typeof applicationMode)}
                        >
                            <option value="prospective_only">{t('governance.feed.prospectiveOnly')}</option>
                            <option value="re_evaluate_existing_content" disabled={!canDownrankContent}>
                                {t('governance.feed.reEvaluateExisting')}
                            </option>
                        </select>
                    </label>
                    <div className={styles.notice}>{t('governance.feed.applicationBoundary')}</div>
                    {applicationMode === 're_evaluate_existing_content' ? (
                        <>
                            <label className={styles.field}>
                                <span>{t('governance.feed.reEvaluateSubjects')}</span>
                                <textarea
                                    value={reEvaluateContentInput}
                                    onChange={(event) => setReEvaluateContentInput(event.target.value)}
                                    placeholder={t('governance.feed.reEvaluateSubjectsPlaceholder')}
                                    rows={3}
                                />
                            </label>
                            <NumberField
                                label={t('governance.feed.reEvaluateDuration')}
                                value={reEvaluateDurationSeconds}
                                min={300}
                                max={maxDurationSeconds}
                                onChange={setReEvaluateDurationSeconds}
                            />
                        </>
                    ) : null}
                    <button
                        type="button"
                        className={styles.primary}
                        data-testid="feed-governance-policy-update"
                        disabled={busy !== null || !canUpdatePolicy || Boolean(activeExperiment) || signalKeys.length === 0 || !applicationValid}
                        onClick={() => void run('policy', async () => {
                            const result = await updateFeedRankingPolicy(circleId, {
                                signalKeys,
                                defaultFactorBps: factorBps,
                                maxDurationSeconds,
                                maxActiveRatioBps,
                                applicationMode,
                                reEvaluateContentIds: applicationMode === 're_evaluate_existing_content'
                                    ? reEvaluateContentIds : [],
                                reEvaluateDurationSeconds: applicationMode === 're_evaluate_existing_content'
                                    ? reEvaluateDurationSeconds : null,
                                reasonCode: 'feed_ranking_policy_update',
                                idempotencyKey: idempotency('feed-policy'),
                            });
                            setLastReEvaluation(result.reEvaluation);
                            setLastReEvaluationFailures(result.reEvaluationFailures);
                            setLastReEvaluationStatus(result.reEvaluationStatus === 'not_requested'
                                ? null : result.reEvaluationStatus);
                        })}
                    >
                        {busy === 'policy' ? t('governance.feed.saving') : t('governance.feed.updatePolicy')}
                    </button>

                    <div className={styles.divider} />
                    <NumberField label={t('governance.feed.experimentRatio')} value={experimentRatioBps} min={1} max={surface?.policy?.maxActiveRatioBps ?? 1} onChange={setExperimentRatioBps} />
                    <NumberField label={t('governance.feed.experimentDuration')} value={experimentDurationSeconds} min={300} max={surface?.policy?.maxDurationSeconds ?? 300} onChange={setExperimentDurationSeconds} />
                    <div className={styles.actions}>
                        <button
                            type="button"
                            className={styles.primary}
                            data-testid="feed-governance-experiment-start"
                            disabled={busy !== null || !canStartExperiment || !surface?.policy || Boolean(activeExperiment)}
                            onClick={() => void run('start', () => startFeedExperiment(circleId, {
                                targetRatioBps: experimentRatioBps,
                                durationSeconds: experimentDurationSeconds,
                                reasonCode: 'feed_recommendation_experiment_start',
                                idempotencyKey: idempotency('feed-experiment-start'),
                            }))}
                        >
                            {busy === 'start' ? t('governance.feed.starting') : t('governance.feed.startExperiment')}
                        </button>
                        <button
                            type="button"
                            className={styles.secondary}
                            data-testid="feed-governance-experiment-stop"
                            disabled={busy !== null || !canStopExperiment || !activeExperiment}
                            onClick={() => activeExperiment && void run('stop', () => stopFeedExperiment(
                                circleId,
                                activeExperiment.receiptId,
                                {
                                    reasonCode: 'feed_recommendation_experiment_stop',
                                    idempotencyKey: idempotency('feed-experiment-stop'),
                                },
                            ))}
                        >
                            {busy === 'stop' ? t('governance.feed.stopping') : t('governance.feed.stopExperiment')}
                        </button>
                    </div>
                </div>
            ) : surface ? (
                <div className={styles.notice} data-testid="feed-governance-readonly">
                    {t('governance.feed.readOnly', { reason: surface.capability.reason || 'unavailable' })}
                </div>
            ) : null}

            {error ? <div className={styles.error} role="alert">{error}</div> : null}
        </section>
    );
}

function NumberField({
    label, value, min, max, onChange,
}: {
    label: string;
    value: number;
    min: number;
    max: number;
    onChange(value: number): void;
}) {
    return (
        <label className={styles.field}>
            <span>{label}</span>
            <input
                type="number"
                min={min}
                max={max}
                value={value}
                onChange={(event) => onChange(Math.max(min, Math.min(max, Math.floor(Number(event.target.value) || min))))}
            />
        </label>
    );
}

function idempotency(prefix: string): string {
    return `${prefix}:${typeof crypto !== 'undefined' && 'randomUUID' in crypto ? crypto.randomUUID() : Date.now()}`;
}

function message(error: unknown): string {
    return error instanceof Error ? error.message : String(error);
}
