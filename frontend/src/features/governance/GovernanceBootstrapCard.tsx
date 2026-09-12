'use client';

import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { ArrowRight, Check, Clock3, Landmark, RefreshCw } from 'lucide-react';

import {
    activateCircleGovernanceBootstrap,
    CircleGovernanceBootstrapApiError,
    fetchCircleGovernanceBootstrapStatus,
    openCircleGovernanceBootstrap,
    prepareCircleGovernanceBootstrap,
    reenterCircleGovernanceHome,
    type CircleGovernanceBootstrapPreview,
    type CircleGovernanceBootstrapStatus,
} from '@/lib/api/circlesGovernanceBootstrap';
import { useI18n } from '@/i18n/useI18n';
import styles from './GovernanceBootstrapCard.module.css';

interface PendingCeremony {
    ceremonyId: string;
    availableAt: string;
}

export default function GovernanceBootstrapCard({
    circleId,
    canActivate,
    actorPubkey,
    signOpeningMessage,
}: {
    circleId: number;
    canActivate: boolean;
    actorPubkey: string | null;
    signOpeningMessage: (signedMessage: string) => Promise<string>;
}) {
    const t = useI18n('GovernanceBootstrap');
    const [status, setStatus] = useState<CircleGovernanceBootstrapStatus | null>(null);
    const [preparedPreview, setPreparedPreview] = useState<CircleGovernanceBootstrapPreview | null>(null);
    const [pending, setPending] = useState<PendingCeremony | null>(null);
    const [loading, setLoading] = useState(true);
    const [preparing, setPreparing] = useState(false);
    const [prepareAttempted, setPrepareAttempted] = useState(false);
    const [working, setWorking] = useState(false);
    const [error, setError] = useState<string | null>(null);
    const [cooldownUntil, setCooldownUntil] = useState<number | null>(null);
    const [homeMissing, setHomeMissing] = useState(false);
    const [now, setNow] = useState(() => Date.now());
    const translationRef = useRef(t);
    const cooldownUntilRef = useRef<number | null>(null);
    translationRef.current = t;

    const captureRequestError = useCallback((requestError: unknown, fallbackKey: string) => {
        if (requestError instanceof CircleGovernanceBootstrapApiError && requestError.status === 429) {
            const retryAfterSeconds = requestError.retryAfterSeconds ?? 60;
            const until = Date.now() + (retryAfterSeconds * 1000);
            cooldownUntilRef.current = until;
            setCooldownUntil(until);
            setError(translationRef.current('rateLimited', { seconds: retryAfterSeconds }));
            return;
        }
        setError(translationRef.current(fallbackKey));
    }, []);

    const refresh = useCallback(async () => {
        if ((cooldownUntilRef.current ?? 0) > Date.now()) return;
        setError(null);
        try {
            const nextStatus = await fetchCircleGovernanceBootstrapStatus(circleId);
            setHomeMissing(false);
            setStatus(nextStatus);
        } catch (requestError) {
            setHomeMissing(requestError instanceof CircleGovernanceBootstrapApiError
                && requestError.status === 404
                && requestError.message.includes('governance_bootstrap_circle_home_not_initialized'));
            captureRequestError(requestError, 'loadError');
        } finally {
            setLoading(false);
        }
    }, [captureRequestError, circleId]);

    const prepareSigningChallenge = useCallback(async () => {
        if (!canActivate || !actorPubkey || (cooldownUntilRef.current ?? 0) > Date.now()) return;
        setPrepareAttempted(true);
        setPreparing(true);
        try {
            setPreparedPreview(await prepareCircleGovernanceBootstrap(circleId));
        } catch (requestError) {
            setPreparedPreview(null);
            captureRequestError(requestError, 'prepareError');
        } finally {
            setPreparing(false);
        }
    }, [actorPubkey, canActivate, captureRequestError, circleId]);

    useEffect(() => {
        setLoading(true);
        setPreparedPreview(null);
        setPending(null);
        setPrepareAttempted(false);
        void refresh();
    }, [circleId, refresh]);

    useEffect(() => {
        const ceremony = status?.latestCeremony;
        if (!ceremony || status.activation.state === 'active') return;
        if (!['prepared', 'waiting', 'executing', 'verifying', 'recovery_required'].includes(ceremony.state)) return;
        if (pending?.ceremonyId === ceremony.id && pending.availableAt === ceremony.availableAt) return;
        setPreparedPreview(null);
        setPrepareAttempted(true);
        setPending({ ceremonyId: ceremony.id, availableAt: ceremony.availableAt });
        setError(null);
    }, [pending, status]);

    useEffect(() => {
        if (!status
            || status.activation.state === 'active'
            || !status.runtime.available
            || !canActivate
            || !actorPubkey
            || pending
            || status.latestCeremony
            || preparedPreview
            || preparing
            || prepareAttempted) return;
        void prepareSigningChallenge();
    }, [actorPubkey, canActivate, pending, prepareAttempted, prepareSigningChallenge, preparedPreview, preparing, status]);

    useEffect(() => {
        const timer = window.setInterval(() => setNow(Date.now()), 1000);
        return () => window.clearInterval(timer);
    }, []);

    useEffect(() => {
        if (cooldownUntil === null || now < cooldownUntil) return;
        cooldownUntilRef.current = null;
        setCooldownUntil(null);
        setError(null);
    }, [cooldownUntil, now]);

    useEffect(() => {
        if (!preparedPreview || pending) return;
        if (Date.parse(preparedPreview.openingInput.signatureExpiresAt) - now > 30_000) return;
        setPreparedPreview(null);
        setPrepareAttempted(false);
    }, [now, pending, preparedPreview]);

    useEffect(() => {
        if (!pending || !status?.latestCeremony) return;
        if (status.latestCeremony.id !== pending.ceremonyId) return;
        if (status.latestCeremony.availableAt === pending.availableAt) return;
        setPending({ ...pending, availableAt: status.latestCeremony.availableAt });
    }, [pending, status]);

    const remainingSeconds = useMemo(() => pending
        ? Math.max(0, Math.ceil((Date.parse(pending.availableAt) - now) / 1000))
        : 0, [now, pending]);
    const cooldownSeconds = cooldownUntil === null
        ? 0
        : Math.max(0, Math.ceil((cooldownUntil - now) / 1000));

    const start = async () => {
        const preview = preparedPreview;
        if (!canActivate || !actorPubkey || !preview || working || cooldownSeconds > 0) return;
        if (Date.parse(preview.openingInput.signatureExpiresAt) - Date.now() <= 5_000) {
            setPreparedPreview(null);
            setError(translationRef.current('challengeExpired'));
            return;
        }
        setWorking(true);
        setPreparedPreview(null);
        setError(null);
        try {
            // Keep wallet signing as the first asynchronous boundary after the real user click.
            const signatureBase64 = await signOpeningMessage(preview.opening.signedMessage);
            const opened = await openCircleGovernanceBootstrap({ circleId, preview, signatureBase64 });
            setPending({ ceremonyId: opened.ceremonyId, availableAt: opened.availableAt });
            setNow(Date.now());
            await refresh();
        } catch (requestError) {
            captureRequestError(requestError, 'startError');
        } finally {
            setWorking(false);
        }
    };

    const activate = async () => {
        if (!pending || remainingSeconds > 0 || working || cooldownSeconds > 0) return;
        setWorking(true);
        setError(null);
        try {
            await activateCircleGovernanceBootstrap({
                circleId,
                ceremonyId: pending.ceremonyId,
            });
            setPending(null);
            await refresh();
        } catch (requestError) {
            captureRequestError(requestError, 'activateError');
        } finally {
            setWorking(false);
        }
    };

    const recoverMissingHome = async () => {
        if (!canActivate || working || cooldownSeconds > 0) return;
        setWorking(true);
        setError(null);
        try {
            await reenterCircleGovernanceHome(circleId);
            await refresh();
        } catch (requestError) {
            captureRequestError(requestError, 'loadError');
        } finally {
            setWorking(false);
        }
    };

    if (loading) {
        return (
            <section className={`${styles.root} ${styles.loading}`}>
                <RefreshCw className={styles.spin} size={17} />
                <span>{t('loading')}</span>
            </section>
        );
    }
    if (!status) {
        return (
            <section className={`${styles.root} ${styles.failure}`} role="alert">
                <span>{homeMissing ? t('homeMissing') : error || t('loadError')}</span>
                {homeMissing ? (
                    <button
                        type="button"
                        disabled={!canActivate || working || cooldownSeconds > 0}
                        onClick={() => void recoverMissingHome()}
                    >
                        {working ? t('working') : t('recoverHome')}
                    </button>
                ) : (
                    <button type="button" disabled={cooldownSeconds > 0} onClick={() => void refresh()}>
                        {cooldownSeconds > 0 ? t('retryCooldown', { seconds: cooldownSeconds }) : t('retry')}
                    </button>
                )}
            </section>
        );
    }

    const active = status.activation.state === 'active';
    if (active) {
        return (
            <section className={`${styles.root} ${styles.active}`} data-testid="governance-bootstrap-card">
                <span className={styles.icon}><Check size={19} /></span>
                <div>
                    <strong>{t('activeTitle')}</strong>
                    <p>{t('activeReadback', {
                        verifiedAt: status.activation.lastVerifiedAt || status.activation.activatedAt || '—',
                    })}</p>
                </div>
            </section>
        );
    }

    const canRetryPreparation = prepareAttempted && !preparing && !preparedPreview;
    const actionDisabled = working
        || preparing
        || cooldownSeconds > 0
        || (!preparedPreview && !canRetryPreparation)
        || !canActivate
        || !actorPubkey
        || !status.runtime.available;

    return (
        <section className={styles.root} data-testid="governance-bootstrap-card">
            <span className={styles.icon}><Landmark size={20} /></span>
            <div className={styles.content}>
                <div className={styles.headingRow}>
                    <span className={styles.kicker}>{pending ? t('waitingKicker') : t('eyebrow')}</span>
                    <span className={styles.state}>{pending ? t('waitingState') : t('pending')}</span>
                </div>
                <h2>{pending ? t('waitingTitle') : t('title')}</h2>
                <p className={styles.summary}>{pending
                    ? t('waitingSummary')
                    : t('summary')}</p>
                <p className={styles.assurance}>{t('assurance')}</p>
                {!canActivate && <p className={styles.notice}>{t('ownerRequired')}</p>}
                {!status.runtime.available && (
                    <p className={styles.error} role="alert">{t('runtimeBlocked', {
                        blocker: status.runtime.blocker || 'governance_bootstrap_runtime_disabled',
                    })}</p>
                )}
                {error && <p className={styles.error} role="alert">{error}</p>}
                <details className={styles.details}>
                    <summary>{t('details')}</summary>
                    <span>{t('detailsBody', {
                        chain: status.runtime.network || 'unavailable',
                        bypass: status.activation.bootstrapBypassStatus,
                    })}</span>
                </details>
            </div>
            {pending ? (
                <div className={styles.actionColumn}>
                    <span className={styles.countdown}><Clock3 size={15} />{remainingSeconds > 0
                        ? t('waiting', { seconds: remainingSeconds })
                        : t('ready')}</span>
                    <button
                        className={styles.primary}
                        type="button"
                        disabled={working || remainingSeconds > 0 || cooldownSeconds > 0}
                        onClick={() => void activate()}
                    >
                        {working ? t('working') : t('activate')}
                        {!working && <ArrowRight size={16} />}
                    </button>
                </div>
            ) : (
                <div className={styles.actionColumn}>
                    <button
                        className={styles.primary}
                        type="button"
                        disabled={actionDisabled}
                        onClick={() => void (preparedPreview ? start() : prepareSigningChallenge())}
                    >
                        {working
                            ? t('working')
                            : preparing || (!preparedPreview && !prepareAttempted)
                                ? t('preparing')
                                : !preparedPreview
                                    ? t('retry')
                                    : t('start')}
                        {!working && !preparing && preparedPreview && <ArrowRight size={16} />}
                    </button>
                    <span className={styles.actionHint}>{t('actionHint')}</span>
                </div>
            )}
        </section>
    );
}
