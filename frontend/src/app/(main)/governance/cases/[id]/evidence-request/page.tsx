'use client';

import Link from 'next/link';
import { useParams } from 'next/navigation';
import { useState } from 'react';
import { FileKey2 } from 'lucide-react';

import { useI18n } from '@/i18n/useI18n';
import { requestGovernanceEvidenceShare, type GovernanceEvidenceSharePackage } from '@/lib/api/governance';
import styles from './page.module.css';

export default function GovernanceEvidenceShareRequestPage() {
    const params = useParams();
    const t = useI18n('GovernanceCases');
    const caseId = decodeURIComponent(String(params.id || ''));
    const [purpose, setPurpose] = useState('');
    const [requestNote, setRequestNote] = useState('');
    const [created, setCreated] = useState<GovernanceEvidenceSharePackage | null>(null);
    const [busy, setBusy] = useState(false);
    const [error, setError] = useState<string | null>(null);

    async function submit() {
        setBusy(true);
        setError(null);
        try {
            const result = await requestGovernanceEvidenceShare({
                caseId,
                purpose,
                requestNote: requestNote || null,
                idempotencyKey: `evidence-share-request:${crypto.randomUUID()}`,
            });
            setCreated(result.package);
        } catch {
            setError(t('evidenceShare.requestError'));
        } finally {
            setBusy(false);
        }
    }

    return (
        <main className={styles.page}>
            <Link href={`/governance/cases/${caseId}`}>{t('evidenceShare.backToCase')}</Link>
            <header><FileKey2 size={24} /><h1>{t('evidenceShare.requestTitle')}</h1></header>
            <p>{t('evidenceShare.requestBoundary')}</p>
            {created ? (
                <section className={styles.result}>
                    <strong>{t('evidenceShare.requestRecorded')}</strong>
                    <code>{created.digest}</code>
                    <Link href={`/governance/evidence-shares/${created.id}`}>
                        {t('evidenceShare.openPackage')}
                    </Link>
                </section>
            ) : (
                <section className={styles.form}>
                    <label>
                        {t('evidenceShare.purpose')}
                        <textarea value={purpose} onChange={(event) => setPurpose(event.target.value)} />
                    </label>
                    <label>
                        {t('evidenceShare.requestNote')}
                        <textarea value={requestNote} onChange={(event) => setRequestNote(event.target.value)} />
                    </label>
                    <button type="button" disabled={busy || purpose.trim().length < 3} onClick={() => void submit()}>
                        {busy ? t('evidenceShare.submitting') : t('evidenceShare.submitRequest')}
                    </button>
                </section>
            )}
            {error ? <p role="alert" className={styles.error}>{error}</p> : null}
        </main>
    );
}
