'use client';

import Link from 'next/link';
import { useParams } from 'next/navigation';
import { useState } from 'react';
import { Download, FileKey2 } from 'lucide-react';

import { useI18n } from '@/i18n/useI18n';
import { accessGovernanceEvidenceShare, type GovernanceEvidenceSharePackage } from '@/lib/api/governance';
import styles from './page.module.css';

export default function GovernanceEvidenceSharePage() {
    const params = useParams();
    const t = useI18n('GovernanceCases');
    const packageId = decodeURIComponent(String(params.id || ''));
    const [purpose, setPurpose] = useState('');
    const [value, setValue] = useState<GovernanceEvidenceSharePackage | null>(null);
    const [busy, setBusy] = useState(false);
    const [error, setError] = useState<string | null>(null);

    async function access(action: 'read' | 'export') {
        setBusy(true);
        setError(null);
        try {
            const packageValue = await accessGovernanceEvidenceShare({
                packageId,
                action,
                purpose,
                idempotencyKey: `evidence-share-${action}:${crypto.randomUUID()}`,
            });
            setValue(packageValue);
            if (action === 'export') {
                const blob = new Blob([JSON.stringify(packageValue, null, 2)], { type: 'application/json' });
                const url = URL.createObjectURL(blob);
                const anchor = document.createElement('a');
                anchor.href = url;
                anchor.download = `${packageValue.id.replace(/[^a-zA-Z0-9._-]/g, '_')}.json`;
                anchor.click();
                URL.revokeObjectURL(url);
            }
        } catch {
            setValue(null);
            setError(t('evidenceShare.accessDenied'));
        } finally {
            setBusy(false);
        }
    }

    return (
        <main className={styles.page}>
            <header><FileKey2 size={24} /><h1>{t('evidenceShare.packageTitle')}</h1></header>
            <p>{t('evidenceShare.recipientBoundary')}</p>
            <label className={styles.purpose}>
                {t('evidenceShare.accessPurpose')}
                <textarea value={purpose} onChange={(event) => setPurpose(event.target.value)} />
            </label>
            <div className={styles.actions}>
                <button type="button" disabled={busy || purpose.trim().length < 3} onClick={() => void access('read')}>
                    {t('evidenceShare.read')}
                </button>
                <button type="button" disabled={busy || purpose.trim().length < 3} onClick={() => void access('export')}>
                    <Download size={15} />{t('evidenceShare.export')}
                </button>
            </div>
            {value ? (
                <section className={styles.package}>
                    <strong>{t(`evidenceShare.status.${value.effectiveStatus}`)}</strong>
                    <p>{value.safeSummary}</p>
                    {value.minimumDisclosure ? <dl data-testid="moderation-minimum-disclosure-readback">
                        <div><dt>Permitted use</dt><dd>{value.minimumDisclosure.permittedUse}</dd></div>
                        <div><dt>Redacted allegation</dt><dd>{value.minimumDisclosure.redactedAllegation.reasonCode}</dd></div>
                        <div><dt>Necessary subject</dt><dd><code>{value.minimumDisclosure.subject.ref}</code></dd></div>
                        <div><dt>Included</dt><dd>{value.minimumDisclosure.includedFields.join(', ')}</dd></div>
                        <div><dt>Excluded</dt><dd>{value.minimumDisclosure.excludedFields.join(', ')}</dd></div>
                        <div><dt>Prohibited uses</dt><dd>{value.minimumDisclosure.prohibitedUses.join(', ')}</dd></div>
                        <div><dt>Additional disclosure</dt><dd>{value.minimumDisclosure.additionalDisclosure}</dd></div>
                    </dl> : null}
                    <code>{value.digest}</code>
                    <p>{t('evidenceShare.sources', { count: value.sourceRefs.length })}</p>
                    <ul>{value.sourceRefs.map((source) => (
                        <li key={source.sourceMaterialId}>#{source.sourceMaterialId} · <code>{source.contentDigest}</code></li>
                    ))}</ul>
                    <p>{value.expiresAt ? new Date(value.expiresAt).toLocaleString() : null}</p>
                    <Link href={`/governance/cases/${value.caseId}`}>{t('evidenceShare.backToCase')}</Link>
                </section>
            ) : null}
            {error ? <p role="alert" className={styles.error}>{error}</p> : null}
        </main>
    );
}
