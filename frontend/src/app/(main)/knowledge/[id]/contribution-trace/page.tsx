'use client';

import { useEffect, useState } from 'react';
import Link from 'next/link';
import { useParams } from 'next/navigation';
import { ArrowLeft } from 'lucide-react';

import ContributionTraceTimeline from '@/features/contribution-trace/ContributionTraceTimeline';
import {
    ContributionTraceRequestError,
    fetchCrystalContributionTrace,
} from '@/lib/api/contributionTrace';
import type { ContributionTraceResponse } from '@/features/contribution-trace/adapter';
import { useI18n } from '@/i18n/useI18n';
import styles from './page.module.css';

function formatCrystalTraceLoadError(
    err: unknown,
    t: ReturnType<typeof useI18n>,
): string {
    if (err instanceof ContributionTraceRequestError) {
        if (err.code === 'invalid_knowledge_id' || err.status === 400) return t('errors.invalidKnowledgeRoute');
        if (err.status === 401) return t('errors.signInRequired');
        if (err.status === 403) return t('errors.permissionDenied');
        if (err.status === 404) return t('errors.notFound');
    }
    return t('errors.loadFailed');
}

export default function KnowledgeContributionTracePage() {
    const t = useI18n('ContributionTrace');
    const params = useParams();
    const knowledgeId = String(params.id || '').trim();
    const [trace, setTrace] = useState<ContributionTraceResponse | null>(null);
    const [loading, setLoading] = useState(true);
    const [error, setError] = useState<string | null>(null);

    useEffect(() => {
        let cancelled = false;
        if (!knowledgeId) {
            setError(t('errors.invalidKnowledgeRoute'));
            setLoading(false);
            return;
        }
        setLoading(true);
        setError(null);
        fetchCrystalContributionTrace({ knowledgeId })
            .then((payload) => {
                if (cancelled) return;
                setTrace(payload);
            })
            .catch((err) => {
                if (cancelled) return;
                setTrace(null);
                setError(formatCrystalTraceLoadError(err, t));
            })
            .finally(() => {
                if (!cancelled) setLoading(false);
            });
        return () => {
            cancelled = true;
        };
    }, [knowledgeId, t]);

    return (
        <div className={styles.page}>
            <Link href={`/knowledge/${encodeURIComponent(knowledgeId)}`} className={styles.backLink}>
                <ArrowLeft size={16} />
                {t('actions.backToKnowledge')}
            </Link>
            {loading && <p className={styles.state}>{t('states.loading')}</p>}
            {!loading && error && <p className={styles.error}>{error}</p>}
            {!loading && trace?.circleId && trace.draftPostId && (
                <Link
                    href={`/circles/${trace.circleId}/drafts/${trace.draftPostId}/contribution-trace#correction-request`}
                    className={styles.correctionLink}
                >
                    {t('actions.requestCorrection')}
                </Link>
            )}
            {!loading && trace && <ContributionTraceTimeline trace={trace} />}
        </div>
    );
}
