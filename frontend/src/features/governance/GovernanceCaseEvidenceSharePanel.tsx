'use client';

import Link from 'next/link';
import { useEffect, useState } from 'react';
import { FileKey2, RefreshCw } from 'lucide-react';

import { useI18n } from '@/i18n/useI18n';
import {
    decideGovernanceEvidenceShare,
    fetchGovernanceCaseEvidenceShares,
    revokeGovernanceEvidenceShare,
    type GovernanceCase,
    type GovernanceEvidenceSharePackage,
} from '@/lib/api/governance';
import styles from './GovernanceCaseEvidenceSharePanel.module.css';

export default function GovernanceCaseEvidenceSharePanel({
    governanceCase,
}: {
    governanceCase: GovernanceCase;
}) {
    const t = useI18n('GovernanceCases');
    const [packages, setPackages] = useState<GovernanceEvidenceSharePackage[]>([]);
    const [loading, setLoading] = useState(false);
    const [busyId, setBusyId] = useState<string | null>(null);
    const [error, setError] = useState<string | null>(null);
    const [safeSummary, setSafeSummary] = useState('');
    const [expiry, setExpiry] = useState('');
    const [reason, setReason] = useState('');
    const canManage = governanceCase.workflow.canManage;
    const sourceMaterialIds = governanceCase.brief?.sources.map((source) => source.id) ?? [];

    async function load() {
        if (!canManage) return;
        setLoading(true);
        setError(null);
        try {
            setPackages(await fetchGovernanceCaseEvidenceShares(governanceCase.id));
        } catch {
            setError(t('evidenceShare.loadError'));
        } finally {
            setLoading(false);
        }
    }

    useEffect(() => { void load(); }, [canManage, governanceCase.id]);

    async function decide(item: GovernanceEvidenceSharePackage, action: 'authorize' | 'deny') {
        setBusyId(item.id);
        setError(null);
        try {
            await decideGovernanceEvidenceShare({
                packageId: item.id,
                action,
                expectedVersion: item.version,
                idempotencyKey: `evidence-share-${action}:${crypto.randomUUID()}`,
                ...(action === 'authorize'
                    ? {
                        sourceMaterialIds,
                        safeSummary,
                        expiresAt: expiry ? new Date(expiry).toISOString() : null,
                        reason: reason || null,
                    }
                    : { reason }),
            });
            await load();
        } catch {
            setError(t('evidenceShare.actionError'));
        } finally {
            setBusyId(null);
        }
    }

    async function revoke(item: GovernanceEvidenceSharePackage) {
        setBusyId(item.id);
        setError(null);
        try {
            await revokeGovernanceEvidenceShare({
                packageId: item.id,
                expectedVersion: item.version,
                reason,
                idempotencyKey: `evidence-share-revoke:${crypto.randomUUID()}`,
            });
            await load();
        } catch {
            setError(t('evidenceShare.actionError'));
        } finally {
            setBusyId(null);
        }
    }

    return (
        <section className={styles.panel}>
            <div className={styles.heading}>
                <FileKey2 size={20} />
                <div>
                    <p>{t('evidenceShare.eyebrow')}</p>
                    <h2>{t('evidenceShare.title')}</h2>
                </div>
            </div>
            <p className={styles.boundary}>{t('evidenceShare.boundary')}</p>
            <Link className={styles.requestLink} href={`/governance/cases/${governanceCase.id}/evidence-request`}>
                {t('evidenceShare.requestLink')}
            </Link>
            {canManage ? (
                <>
                    <div className={styles.controls}>
                        <label>
                            {t('evidenceShare.safeSummary')}
                            <textarea value={safeSummary} onChange={(event) => setSafeSummary(event.target.value)} />
                        </label>
                        <label>
                            {t('evidenceShare.expiry')}
                            <input type="datetime-local" value={expiry} onChange={(event) => setExpiry(event.target.value)} />
                        </label>
                        <label>
                            {t('evidenceShare.reason')}
                            <textarea value={reason} onChange={(event) => setReason(event.target.value)} />
                        </label>
                    </div>
                    {loading ? <p><RefreshCw size={15} className={styles.spin} /> {t('evidenceShare.loading')}</p> : null}
                    {!loading && packages.length === 0 ? <p className={styles.empty}>{t('evidenceShare.empty')}</p> : null}
                    <ul className={styles.list}>
                        {packages.map((item) => (
                            <li key={item.id}>
                                <div className={styles.packageHeader}>
                                    <strong>{t(`evidenceShare.status.${item.effectiveStatus}`)}</strong>
                                    <span>v{item.version}</span>
                                </div>
                                <p>{item.purpose}</p>
                                {item.requestNote ? <p>{item.requestNote}</p> : null}
                                {item.safeSummary ? <p>{item.safeSummary}</p> : null}
                                <code>{item.digest}</code>
                                <small>{t('evidenceShare.recipient', { circleId: item.recipientCircleId })}</small>
                                <small>{t('evidenceShare.sources', { count: item.sourceRefs.length })}</small>
                                <div className={styles.actions}>
                                    {item.status === 'requested' ? (
                                        <>
                                            <button
                                                type="button"
                                                disabled={busyId === item.id || sourceMaterialIds.length === 0 || safeSummary.trim().length < 10 || !expiry}
                                                onClick={() => void decide(item, 'authorize')}
                                            >{t('evidenceShare.authorize')}</button>
                                            <button
                                                type="button"
                                                disabled={busyId === item.id || reason.trim().length < 3}
                                                onClick={() => void decide(item, 'deny')}
                                            >{t('evidenceShare.deny')}</button>
                                        </>
                                    ) : null}
                                    {item.status === 'authorized' ? (
                                        <button
                                            type="button"
                                            disabled={busyId === item.id || reason.trim().length < 3}
                                            onClick={() => void revoke(item)}
                                        >{t('evidenceShare.revoke')}</button>
                                    ) : null}
                                    <Link href={`/governance/evidence-shares/${item.id}`}>
                                        {t('evidenceShare.openPackage')}
                                    </Link>
                                </div>
                                <details>
                                    <summary>{t('evidenceShare.audit', { count: item.events.length })}</summary>
                                    <ol>
                                        {item.events.map((event) => (
                                            <li key={event.id}>
                                                {event.eventType} · {event.result} · {new Date(event.createdAt).toLocaleString()}
                                            </li>
                                        ))}
                                    </ol>
                                </details>
                            </li>
                        ))}
                    </ul>
                    {error ? <p role="alert" className={styles.error}>{error}</p> : null}
                </>
            ) : null}
        </section>
    );
}
