'use client';

import Link from 'next/link';
import { useCallback, useEffect, useMemo, useState } from 'react';

import { useI18n } from '@/i18n/useI18n';
import {
    fetchOperatorCapabilitySuspensions,
    openOperatorCapabilityRatificationCase,
    suspendOperatorCapability,
    type OperatorCapabilitySuspensionReadback,
} from '@/lib/api/operatorCapabilitySuspension';

import styles from './OperatorCapabilitySuspensionControls.module.css';

const MIN_DURATION_SECONDS = 300;
const MAX_DURATION_SECONDS = 86400;

export default function OperatorCapabilitySuspensionControls({
    circleId,
    active,
}: {
    circleId: number;
    active: boolean;
}) {
    const t = useI18n('CircleSettingsSheet');
    const [targetOperatorPubkey, setTargetOperatorPubkey] = useState('');
    const [targetActionType, setTargetActionType] = useState('communication.member.mute');
    const [targetSubjectType, setTargetSubjectType] = useState('communication_room_member');
    const [targetSubjectRef, setTargetSubjectRef] = useState('');
    const [durationSeconds, setDurationSeconds] = useState(1800);
    const [reasonCode, setReasonCode] = useState('credible_safety_risk');
    const [sourceReportId, setSourceReportId] = useState('');
    const [suspensions, setSuspensions] = useState<OperatorCapabilitySuspensionReadback[]>([]);
    const [loadedTarget, setLoadedTarget] = useState<string | null>(null);
    const [readScope, setReadScope] = useState<'target_subject' | 'circle_manager' | 'issuing_operator_receipts_only' | null>(null);
    const [busy, setBusy] = useState<'load' | 'suspend' | `ratify:${string}` | null>(null);
    const [error, setError] = useState<string | null>(null);

    useEffect(() => {
        if (!active) return;
        setError(null);
    }, [active]);

    const targetValid = useMemo(
        () => /^[1-9A-HJ-NP-Za-km-z]{32,44}$/.test(targetOperatorPubkey.trim()),
        [targetOperatorPubkey],
    );
    const formValid = targetValid
        && /^[a-z][a-z0-9._-]{2,95}$/.test(targetActionType.trim())
        && /^[a-z][a-z0-9._-]{2,95}$/.test(targetSubjectType.trim())
        && targetSubjectRef.trim().length >= 3
        && targetSubjectRef.trim().length <= 256
        && /^[a-z][a-z0-9._-]{2,95}$/.test(reasonCode.trim())
        && durationSeconds >= MIN_DURATION_SECONDS
        && durationSeconds <= MAX_DURATION_SECONDS;

    const load = useCallback(async (target = targetOperatorPubkey.trim()) => {
        if (!target) return;
        setBusy('load');
        setError(null);
        try {
            const result = await fetchOperatorCapabilitySuspensions(circleId, target);
            setSuspensions(result.suspensions);
            setLoadedTarget(result.targetOperatorPubkey);
            setReadScope(result.readScope);
        } catch (loadError) {
            setError(message(loadError));
        } finally {
            setBusy(null);
        }
    }, [circleId, targetOperatorPubkey]);

    const submit = async () => {
        if (!formValid) return;
        setBusy('suspend');
        setError(null);
        const target = targetOperatorPubkey.trim();
        try {
            await suspendOperatorCapability(circleId, {
                targetOperatorPubkey: target,
                targetActionType: targetActionType.trim(),
                targetSubjectType: targetSubjectType.trim(),
                targetSubjectRef: targetSubjectRef.trim(),
                durationSeconds,
                reasonCode: reasonCode.trim(),
                idempotencyKey: idempotency('operator-capability-suspend'),
                sourceReportId: sourceReportId.trim() || null,
            });
            await load(target);
        } catch (submitError) {
            setError(message(submitError));
        } finally {
            setBusy(null);
        }
    };

    const openRatification = async (suspension: OperatorCapabilitySuspensionReadback) => {
        setBusy(`ratify:${suspension.effectId}`);
        setError(null);
        try {
            await openOperatorCapabilityRatificationCase(
                circleId,
                suspension.effectId,
                idempotency('operator-capability-ratification'),
            );
            await load(suspension.targetOperatorPubkey);
        } catch (ratificationError) {
            setError(message(ratificationError));
        } finally {
            setBusy(null);
        }
    };

    return (
        <section className={styles.panel} data-testid="operator-capability-suspension-settings">
            <div className={styles.header}>
                <div>
                    <div className={styles.eyebrow}>{t('governance.operatorSuspension.eyebrow')}</div>
                    <h3 className={styles.title}>{t('governance.operatorSuspension.title')}</h3>
                    <p className={styles.description}>{t('governance.operatorSuspension.description')}</p>
                </div>
                <span className={styles.stateBadge}>{t('governance.operatorSuspension.ratificationRequired')}</span>
            </div>

            <div className={styles.boundary} role="note">
                <strong>{t('governance.operatorSuspension.safetyBoundary')}</strong>
                <span>{t('governance.operatorSuspension.safetyBoundaryDetail')}</span>
            </div>

            <div className={styles.form} data-authority="exact-frozen-committee-operator">
                <label className={styles.field}>
                    <span>{t('governance.operatorSuspension.targetOperator')}</span>
                    <input
                        value={targetOperatorPubkey}
                        onChange={(event) => setTargetOperatorPubkey(event.target.value)}
                        autoComplete="off"
                        spellCheck={false}
                    />
                </label>
                <button
                    type="button"
                    className={styles.secondary}
                    onClick={() => void load()}
                    disabled={!targetValid || busy !== null}
                >
                    {busy === 'load'
                        ? t('governance.operatorSuspension.loadingExactState')
                        : t('governance.operatorSuspension.loadExactState')}
                </button>
                <div className={styles.twoColumns}>
                    <TextField label={t('governance.operatorSuspension.actionType')} value={targetActionType} onChange={setTargetActionType} />
                    <TextField label={t('governance.operatorSuspension.subjectType')} value={targetSubjectType} onChange={setTargetSubjectType} />
                </div>
                <TextField label={t('governance.operatorSuspension.subjectReference')} value={targetSubjectRef} onChange={setTargetSubjectRef} />
                <div className={styles.twoColumns}>
                    <label className={styles.field}>
                        <span>{t('governance.operatorSuspension.duration')}</span>
                        <input
                            type="number"
                            min={MIN_DURATION_SECONDS}
                            max={MAX_DURATION_SECONDS}
                            value={durationSeconds}
                            onChange={(event) => setDurationSeconds(Math.max(
                                MIN_DURATION_SECONDS,
                                Math.min(MAX_DURATION_SECONDS, Math.floor(Number(event.target.value) || MIN_DURATION_SECONDS)),
                            ))}
                        />
                    </label>
                    <TextField label={t('governance.operatorSuspension.reasonCode')} value={reasonCode} onChange={setReasonCode} />
                </div>
                <TextField
                    label={t('governance.operatorSuspension.sourceReport')}
                    value={sourceReportId}
                    onChange={setSourceReportId}
                />
                <button
                    type="button"
                    className={styles.danger}
                    data-testid="operator-capability-suspension-submit"
                    onClick={() => void submit()}
                    disabled={!formValid || busy !== null}
                >
                    {busy === 'suspend'
                        ? t('governance.operatorSuspension.writingEffect')
                        : t('governance.operatorSuspension.submit')}
                </button>
            </div>

            <div className={styles.readbackHeader}>
                <span>{t('governance.operatorSuspension.readbackTitle')}</span>
                <strong>{loadedTarget ?? t('governance.operatorSuspension.loadTargetPrompt')}</strong>
            </div>
            {readScope ? (
                <div className={styles.boundary} data-testid="operator-capability-suspension-read-scope">
                    <strong>{t('governance.operatorSuspension.readScope')}</strong>
                    <span>{readScope}</span>
                </div>
            ) : null}
            {suspensions.length ? (
                <div className={styles.stack} data-testid="operator-capability-suspension-readback">
                    {suspensions.map((suspension) => (
                        <article
                            className={styles.card}
                            key={suspension.effectId}
                            data-effect-state={suspension.state}
                        >
                            <div className={styles.cardTopline}>
                                <strong>{suspension.state}</strong>
                                <span>{new Date(suspension.expiresAt).toLocaleString()}</span>
                            </div>
                            <dl className={styles.facts}>
                                <dt>{t('governance.operatorSuspension.capability')}</dt><dd>{suspension.targetActionType}</dd>
                                <dt>{t('governance.operatorSuspension.subject')}</dt><dd>{suspension.targetSubjectType}:{suspension.targetSubjectRef}</dd>
                                <dt>{t('governance.operatorSuspension.effect')}</dt><dd>{suspension.effectId}</dd>
                                <dt>{t('governance.operatorSuspension.ratification')}</dt>
                                <dd data-testid={`operator-capability-ratification-${suspension.effectId}`}>
                                    {suspension.ratificationAuthority.status}
                                    {suspension.ratificationAuthority.reason
                                        ? ` · ${suspension.ratificationAuthority.reason}` : ''}
                                </dd>
                                <dt>{t('governance.operatorSuspension.permanentChanges')}</dt><dd>{t('governance.operatorSuspension.forbidden')}</dd>
                                <dt>{t('governance.operatorSuspension.receipt')}</dt>
                                <dd>
                                    <Link href={`/governance/operations/${circleId}/${encodeURIComponent(suspension.receiptId)}`}>
                                        {suspension.receiptId}
                                    </Link>
                                </dd>
                            </dl>
                            {suspension.ratificationAuthority.status === 'available'
                                && suspension.state === 'ratification_required' ? (
                                    <button
                                        type="button"
                                        className={styles.secondary}
                                        onClick={() => void openRatification(suspension)}
                                        disabled={busy !== null}
                                    >
                                        {busy === `ratify:${suspension.effectId}`
                                            ? t('governance.operatorSuspension.openingRatificationCase')
                                            : t('governance.operatorSuspension.openRatificationCase')}
                                    </button>
                                ) : (
                                    <div className={styles.blocked}>{t('governance.operatorSuspension.blockedAuthority')}</div>
                                )}
                        </article>
                    ))}
                </div>
            ) : (
                <div className={styles.empty}>{t('governance.operatorSuspension.empty')}</div>
            )}

            {error ? <div className={styles.error} role="alert">{error}</div> : null}
        </section>
    );
}

function TextField({
    label,
    value,
    onChange,
}: {
    label: string;
    value: string;
    onChange(value: string): void;
}) {
    return (
        <label className={styles.field}>
            <span>{label}</span>
            <input value={value} onChange={(event) => onChange(event.target.value)} autoComplete="off" />
        </label>
    );
}

function idempotency(prefix: string): string {
    return `${prefix}:${typeof crypto !== 'undefined' && 'randomUUID' in crypto ? crypto.randomUUID() : Date.now()}`;
}

function message(error: unknown): string {
    return error instanceof Error ? error.message : String(error);
}
