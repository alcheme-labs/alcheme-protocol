'use client';

import Link from 'next/link';
import { useCallback, useEffect, useRef, useState } from 'react';
import { useQuery } from '@apollo/client/react';
import { useParams } from 'next/navigation';
import { ArrowLeft, RotateCcw } from 'lucide-react';
import { ExternalProgramDetail } from '@/components/external-program/ExternalProgramDetail';
import { useI18n } from '@/i18n/useI18n';
import { GET_ALL_CIRCLES } from '@/lib/apollo/queries';
import type { AllCirclesResponse } from '@/lib/apollo/types';
import {
    ExternalProgramDeveloperDashboardReadError,
    getExternalAppDetail,
    getExternalProgramDeveloperDashboard,
    type ExternalAppDetail as ExternalAppDetailModel,
} from '@/lib/api/externalApps';
import { useIdentityOnboarding } from '@/lib/auth/identityOnboarding';
import styles from '../page.module.css';

type OwnerStatus = 'unknown' | 'owner' | 'not_owner' | 'signed_out' | 'unavailable';

export default function ExternalProgramDetailPage() {
    const t = useI18n('ExternalPrograms');
    const params = useParams();
    const rawAppId = Array.isArray(params?.appId) ? params.appId[0] : params?.appId;
    const appId = decodeAppId(rawAppId);
    const { identityState, sessionUser } = useIdentityOnboarding();
    const sessionOwnerKey = sessionUser?.pubkey ?? null;
    const [detail, setDetail] = useState<ExternalAppDetailModel | null>(null);
    const [detailAppId, setDetailAppId] = useState('');
    const [ownerStatus, setOwnerStatus] = useState<OwnerStatus>('unknown');
    const [ownerAppId, setOwnerAppId] = useState('');
    const [ownerRetryKey, setOwnerRetryKey] = useState(0);
    const [status, setStatus] = useState<'loading' | 'ready' | 'error'>('loading');
    const currentAppIdRef = useRef(appId);
    currentAppIdRef.current = appId;
    const effectiveOwnerStatus = ownerAppId === appId ? ownerStatus : 'unknown';
    const effectiveStatus = detailAppId === appId ? status : 'loading';
    const visibleDetail = detailAppId === appId ? detail : null;
    const {
        data: circlesData,
        loading: circlesLoading,
        error: circlesQueryError,
        refetch: refetchCircles,
    } = useQuery<AllCirclesResponse>(GET_ALL_CIRCLES, {
        variables: { limit: 200, offset: 0 },
        skip: effectiveOwnerStatus !== 'owner',
    });
    const availableCircles = (circlesData?.allCircles ?? [])
        .filter((circle) => circle.lifecycleStatus === 'Active')
        .map((circle) => ({ id: circle.id, name: circle.name }));

    const refreshDetail = useCallback(async () => {
        if (!appId) return;
        const requestedAppId = appId;
        const value = await getExternalAppDetail(requestedAppId);
        if (currentAppIdRef.current !== requestedAppId) return;
        setDetail(value);
        setDetailAppId(requestedAppId);
        setStatus('ready');
    }, [appId]);

    useEffect(() => {
        if (!appId) {
            setStatus('error');
            setDetail(null);
            setDetailAppId('');
            setOwnerStatus('not_owner');
            setOwnerAppId('');
            return;
        }
        let cancelled = false;
        setDetailAppId(appId);
        setStatus('loading');
        setDetail(null);
        void getExternalAppDetail(appId)
            .then((value) => {
                if (cancelled) return;
                setDetail(value);
                setStatus('ready');
            })
            .catch(() => {
                if (cancelled) return;
                setStatus('error');
            });
        return () => {
            cancelled = true;
        };
    }, [appId]);

    useEffect(() => {
        if (!appId) return;
        setOwnerAppId(appId);
        if (!sessionOwnerKey) {
            setOwnerStatus(identityState === 'connecting_session' ? 'unknown' : 'signed_out');
            return;
        }
        let cancelled = false;
        setOwnerStatus('unknown');
        void getExternalProgramDeveloperDashboard()
            .then((dashboard) => {
                if (cancelled) return;
                setOwnerStatus(
                    dashboard.apps.some((item) => item.appId === appId)
                        ? 'owner'
                        : 'not_owner',
                );
            })
            .catch((error: unknown) => {
                if (cancelled) return;
                if (error instanceof ExternalProgramDeveloperDashboardReadError) {
                    if (error.status === 401) setOwnerStatus('signed_out');
                    else if (error.status === 403) setOwnerStatus('not_owner');
                    else setOwnerStatus('unavailable');
                    return;
                }
                setOwnerStatus('unavailable');
            });
        return () => {
            cancelled = true;
        };
    }, [appId, identityState, ownerRetryKey, sessionOwnerKey]);

    return (
        <main className={styles.page} aria-busy={effectiveStatus === 'loading'}>
            <header className={styles.header}>
                <div>
                    <h1>{t('detail.title')}</h1>
                    <p>{t('detail.publicSubtitle')}</p>
                </div>
                <Link className={styles.linkButton} href="/apps">
                    <ArrowLeft aria-hidden="true" size={18} />
                    {t('actions.backToDirectory')}
                </Link>
            </header>
            {effectiveStatus === 'loading' ? <p className={styles.empty}>{t('states.loadingDetail')}</p> : null}
            {effectiveStatus === 'error' ? <p className={styles.empty}>{t('errors.unavailable')}</p> : null}
            {visibleDetail && effectiveOwnerStatus === 'unavailable' ? (
                <section className={styles.ownerVerificationNotice} role="status">
                    <p>{t('owner.verificationUnavailable')}</p>
                    <button
                        type="button"
                        onClick={() => setOwnerRetryKey((value) => value + 1)}
                    >
                        <RotateCcw aria-hidden="true" size={18} />
                        {t('owner.retryVerification')}
                    </button>
                </section>
            ) : null}
            {visibleDetail ? (
                <ExternalProgramDetail
                    detail={visibleDetail}
                    canManageCircleBindings={effectiveOwnerStatus === 'owner'}
                    availableCircles={availableCircles}
                    circlesLoading={circlesLoading}
                    circlesError={Boolean(circlesQueryError)}
                    onRetryCircles={() => { void refetchCircles(); }}
                    onApplicationSubmitted={refreshDetail}
                />
            ) : null}
        </main>
    );
}

function decodeAppId(value: string | undefined): string {
    if (!value) return '';
    try {
        return decodeURIComponent(value).trim();
    } catch {
        return '';
    }
}
