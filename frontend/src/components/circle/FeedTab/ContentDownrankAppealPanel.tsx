'use client';

import Link from 'next/link';
import { useCallback, useEffect, useState } from 'react';

import { useI18n } from '@/i18n/useI18n';
import {
    fetchContentDownrankAppealAccess,
    submitContentDownrankAppeal,
    type ContentDownrankAppealAccessReadback,
} from '@/lib/api/feedGovernance';

import styles from './FeedTab.module.css';

export default function ContentDownrankAppealPanel({
    circleId,
    contentId,
}: {
    circleId: number;
    contentId: string;
}) {
    const t = useI18n('FeedTab');
    const [access, setAccess] = useState<ContentDownrankAppealAccessReadback | null>(null);
    const [statement, setStatement] = useState('');
    const [loading, setLoading] = useState(true);
    const [submitting, setSubmitting] = useState(false);
    const [error, setError] = useState<string | null>(null);

    const load = useCallback(async () => {
        setLoading(true);
        setError(null);
        try {
            const result = await fetchContentDownrankAppealAccess(circleId, contentId);
            setAccess(result.adjustment);
        } catch (cause) {
            setError(message(cause));
        } finally {
            setLoading(false);
        }
    }, [circleId, contentId]);

    useEffect(() => {
        void load();
    }, [load]);

    if (loading) {
        return <div className={styles.appealPanel}>{t('ranking.appealLoading')}</div>;
    }
    if (error && !access) {
        return <div className={styles.appealError} role="alert">{t('ranking.appealLoadError')}</div>;
    }
    if (!access) return null;

    const appeal = access.appealAccess.appeal;
    return (
        <div className={styles.appealPanel} data-testid={`feed-post-downrank-appeal-${contentId}`}>
            <div className={styles.appealFacts}>
                <span>{t('ranking.canonicalEffect')}</span>
                <strong>{access.effect.id} · {access.effect.state}</strong>
                <span>{t('ranking.frozenAuthority')}</span>
                <strong>{access.authority.sourceType}:{access.authority.sourceRef}</strong>
                <span>{t('ranking.appealDeadline')}</span>
                <strong>{new Date(access.appealAccess.deadline).toLocaleString()}</strong>
            </div>
            {appeal ? (
                <div className={styles.appealStatus}>
                    {t('ranking.appealStatus', { status: appeal.state })}
                    {appeal.governanceCaseUrl ? (
                        <Link href={appeal.governanceCaseUrl}>{t('ranking.openAppealCase')}</Link>
                    ) : null}
                </div>
            ) : access.appealAccess.canSubmit ? (
                <form
                    className={styles.appealForm}
                    onSubmit={(event) => {
                        event.preventDefault();
                        if (statement.trim().length < 12 || submitting) return;
                        setSubmitting(true);
                        setError(null);
                        void submitContentDownrankAppeal(circleId, contentId, {
                            originalReceiptId: access.receipt.id,
                            reasonCode: 'ranking_adjustment_disputed',
                            evidence: { statement: statement.trim() },
                        }).then(load).catch((cause) => {
                            setError(message(cause));
                        }).finally(() => setSubmitting(false));
                    }}
                >
                    <label>
                        <span>{t('ranking.appealEvidence')}</span>
                        <textarea
                            value={statement}
                            onChange={(event) => setStatement(event.target.value)}
                            minLength={12}
                            maxLength={4000}
                            required
                        />
                    </label>
                    <div className={styles.appealBoundary}>{t('ranking.appealBoundary')}</div>
                    <button type="submit" disabled={submitting || statement.trim().length < 12}>
                        {submitting ? t('ranking.appealSubmitting') : t('ranking.submitAppeal')}
                    </button>
                </form>
            ) : (
                <div className={styles.appealStatus}>{t('ranking.appealUnavailable')}</div>
            )}
            {error ? <div className={styles.appealError} role="alert">{error}</div> : null}
        </div>
    );
}

function message(value: unknown): string {
    return value instanceof Error ? value.message : String(value);
}
