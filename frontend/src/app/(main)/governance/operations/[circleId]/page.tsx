'use client';

import Link from 'next/link';
import { useParams } from 'next/navigation';
import { useCallback, useEffect, useState } from 'react';
import { ArrowLeft, RefreshCw } from 'lucide-react';

import GovernanceOperationsList from '@/features/governance/GovernanceOperationsList';
import { useI18n } from '@/i18n/useI18n';
import {
    fetchCircleGovernanceRuntimeMetrics,
    fetchMyGovernanceInbox,
    type GovernanceOperationInboxItem,
    type GovernanceRuntimeMetricsReadback,
} from '@/lib/api/governance';
import styles from './page.module.css';

export default function CircleGovernanceOperationsPage() {
    const params = useParams();
    const circleId = Number(params.circleId);
    const t = useI18n('CircleGovernanceOperations');
    const [operations, setOperations] = useState<GovernanceOperationInboxItem[]>([]);
    const [loading, setLoading] = useState(true);
    const [error, setError] = useState(false);
    const [runtimeMetrics, setRuntimeMetrics] = useState<GovernanceRuntimeMetricsReadback | null>(null);

    const load = useCallback(() => {
        if (!Number.isSafeInteger(circleId) || circleId <= 0) {
            setError(true);
            setRuntimeMetrics(null);
            setLoading(false);
            return;
        }
        setLoading(true);
        setError(false);
        setRuntimeMetrics(null);
        void Promise.allSettled([
            fetchMyGovernanceInbox({ home: `circle:${circleId}` }),
            fetchCircleGovernanceRuntimeMetrics(circleId),
        ])
            .then(([inboxResult, metricsResult]) => {
                if (inboxResult.status === 'fulfilled') {
                    setOperations(inboxResult.value.operations);
                } else {
                    setError(true);
                }
                if (metricsResult.status === 'fulfilled') {
                    setRuntimeMetrics(metricsResult.value);
                } else {
                    setRuntimeMetrics(null);
                }
            })
            .finally(() => setLoading(false));
    }, [circleId]);

    useEffect(() => { load(); }, [load]);

    return (
        <main className={styles.page} data-testid="circle-governance-operations">
            <Link href={`/circles/${circleId}?tab=governance`} className={styles.back}>
                <ArrowLeft size={16} />{t('back')}
            </Link>
            <header className={styles.header}>
                <p>{t('eyebrow')}</p>
                <h1>{t('title')}</h1>
                <span>{t('boundary')}</span>
            </header>
            {!loading && (
                <section
                    className={styles.metricsPanel}
                    data-governance-runtime-metrics={runtimeMetrics ? 'available' : 'unavailable'}
                    data-slo-target={runtimeMetrics?.sloTarget.status ?? 'unavailable'}
                >
                    <div className={styles.metricsHeader}>
                        <div>
                            <p>{t('runtimeMetrics.title')}</p>
                            <span>{t('runtimeMetrics.boundary')}</span>
                        </div>
                        <strong>{runtimeMetrics
                            ? t('runtimeMetrics.sloNotConfigured')
                            : t('runtimeMetrics.unavailable')}</strong>
                    </div>
                    {runtimeMetrics && (
                        <dl className={styles.metricsGrid}>
                            <div><dt>{t('runtimeMetrics.total')}</dt><dd>{runtimeMetrics.requests.total}</dd></div>
                            <div><dt>{t('runtimeMetrics.serverErrors')}</dt><dd>{runtimeMetrics.requests.serverErrors}</dd></div>
                            <div><dt>{t('runtimeMetrics.average')}</dt><dd>{Math.round(runtimeMetrics.latency.averageMs)} ms</dd></div>
                            <div><dt>{t('runtimeMetrics.p95')}</dt><dd>{runtimeMetrics.latency.p95UpperBoundMs === null
                                ? t('runtimeMetrics.notObserved')
                                : `${Math.round(runtimeMetrics.latency.p95UpperBoundMs)} ms`}</dd></div>
                        </dl>
                    )}
                </section>
            )}
            {loading ? (
                <div className={styles.state}><RefreshCw className={styles.spin} size={18} />{t('loading')}</div>
            ) : error ? (
                <div className={styles.state} role="alert">{t('loadError')}</div>
            ) : operations.length === 0 ? (
                <div className={styles.state}>{t('empty')}</div>
            ) : (
                <GovernanceOperationsList operations={operations} />
            )}
        </main>
    );
}
