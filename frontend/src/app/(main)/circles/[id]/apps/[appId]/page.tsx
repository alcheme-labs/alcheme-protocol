'use client';

import Link from 'next/link';
import { ArrowLeft, RotateCcw } from 'lucide-react';
import { useEffect, useMemo, useState } from 'react';
import { useParams, useSearchParams } from 'next/navigation';

import { ExternalProgramDetail } from '@/components/external-program/ExternalProgramDetail';
import { useI18n } from '@/i18n/useI18n';
import {
    CircleExternalAppBindingReadError,
    fetchCircleExternalAppBindingsStrict,
    getExternalAppDetail,
    type CircleExternalAppBindingRecord,
    type ExternalAppDetail,
} from '@/lib/api/externalApps';
import {
    buildCircleExternalAppBackHref,
    parsePositiveCircleId,
} from '@/lib/external-program/navigation';
import styles from './page.module.css';

type PageState =
    | 'loading'
    | 'ready'
    | 'pending'
    | 'invalid'
    | 'signedOut'
    | 'forbidden'
    | 'conflict'
    | 'unavailable'
    | 'notBound';

function decodeRouteAppId(value: string | string[] | undefined): string {
    const raw = Array.isArray(value) ? value[0] : value;
    if (!raw) return '';
    try {
        return decodeURIComponent(raw).trim();
    } catch {
        return '';
    }
}

export default function CircleExternalProgramDetailPage() {
    const t = useI18n('ExternalPrograms');
    const params = useParams<{ id: string; appId: string }>();
    const searchParams = useSearchParams();
    const bindingCircleId = useMemo(
        () => parsePositiveCircleId(Array.isArray(params?.id) ? params.id[0] : params?.id),
        [params?.id],
    );
    const returnCircleId = useMemo(
        () => parsePositiveCircleId(searchParams.get('returnCircleId')),
        [searchParams],
    );
    const appId = useMemo(() => decodeRouteAppId(params?.appId), [params?.appId]);
    const routeKey = `${bindingCircleId ?? 'invalid'}:${appId}`;
    const backHref = buildCircleExternalAppBackHref({
        bindingCircleId: bindingCircleId ?? 0,
        returnCircleId,
    });

    const [detail, setDetail] = useState<ExternalAppDetail | null>(null);
    const [binding, setBinding] = useState<CircleExternalAppBindingRecord | null>(null);
    const [pageState, setPageState] = useState<PageState>('loading');
    const [resolvedRouteKey, setResolvedRouteKey] = useState('');
    const [retryKey, setRetryKey] = useState(0);
    const effectivePageState = resolvedRouteKey === routeKey ? pageState : 'loading';

    useEffect(() => {
        if (!bindingCircleId || !appId) {
            setResolvedRouteKey(routeKey);
            setDetail(null);
            setBinding(null);
            setPageState('invalid');
            return;
        }

        let cancelled = false;
        setResolvedRouteKey(routeKey);
        setPageState('loading');
        setDetail(null);
        setBinding(null);

        void Promise.all([
            getExternalAppDetail(appId),
            fetchCircleExternalAppBindingsStrict(bindingCircleId),
        ])
            .then(([nextDetail, bindings]) => {
                if (cancelled) return;
                const matchingBindings = bindings.filter((item) => item.appId === appId);
                const exactBinding = matchingBindings.find((item) => item.status === 'active')
                    ?? matchingBindings.find((item) => item.status === 'pending')
                    ?? null;
                setDetail(nextDetail);
                setBinding(exactBinding);
                setPageState(
                    exactBinding?.status === 'active'
                        ? 'ready'
                        : exactBinding?.status === 'pending'
                            ? 'pending'
                            : 'notBound',
                );
            })
            .catch((error: unknown) => {
                if (cancelled) return;
                setDetail(null);
                setBinding(null);
                if (error instanceof CircleExternalAppBindingReadError) {
                    if (error.status === 401) setPageState('signedOut');
                    else if (error.status === 403) setPageState('forbidden');
                    else if (error.status === 409) setPageState('conflict');
                    else setPageState('unavailable');
                    return;
                }
                setPageState('unavailable');
            });

        return () => {
            cancelled = true;
        };
    }, [appId, bindingCircleId, retryKey, routeKey]);

    const stateCopy = effectivePageState === 'invalid'
        ? t('errors.invalidRoute')
        : effectivePageState === 'signedOut'
            ? t('errors.signedOut')
            : effectivePageState === 'forbidden'
                ? t('errors.forbidden')
                : effectivePageState === 'conflict'
                    ? t('errors.membershipConflict')
                    : effectivePageState === 'notBound'
                        ? t('errors.notBound')
                        : t('errors.unavailable');

    return (
        <main className={styles.page} aria-busy={effectivePageState === 'loading'}>
            <header className={styles.header}>
                <Link className={styles.backLink} href={backHref}>
                    <ArrowLeft aria-hidden="true" size={20} />
                    <span>{t('actions.backToCircle')}</span>
                </Link>
                <div>
                    <p className={styles.eyebrow}>{t('circleContext.eyebrow')}</p>
                    <h1>{detail?.app.name ?? t('detail.title')}</h1>
                    <p>{t('circleContext.subtitle', { circleId: bindingCircleId ?? '—' })}</p>
                </div>
            </header>

            {effectivePageState === 'loading' ? (
                <section className={styles.stateCard} role="status">
                    <p>{t('states.loadingDetail')}</p>
                </section>
            ) : null}

            {effectivePageState !== 'loading'
                && effectivePageState !== 'ready'
                && effectivePageState !== 'pending' ? (
                <section className={styles.stateCard} role="alert">
                    <h2>{t('errors.title')}</h2>
                    <p>{stateCopy}</p>
                    {(effectivePageState === 'conflict' || effectivePageState === 'unavailable') ? (
                        <button
                            type="button"
                            className={styles.retryButton}
                            onClick={() => setRetryKey((value) => value + 1)}
                        >
                            <RotateCcw aria-hidden="true" size={18} />
                            {t('actions.retry')}
                        </button>
                    ) : null}
                </section>
            ) : null}

            {detail && binding && (effectivePageState === 'ready' || effectivePageState === 'pending') ? (
                <ExternalProgramDetail
                    detail={detail}
                    context={{
                        kind: 'circle',
                        bindingCircleId: binding.circleId,
                        binding,
                    }}
                    canManageCircleBindings={false}
                    availableCircles={[]}
                    circlesLoading={false}
                    circlesError={false}
                    onRetryCircles={() => undefined}
                    onApplicationSubmitted={async () => undefined}
                />
            ) : null}
        </main>
    );
}
