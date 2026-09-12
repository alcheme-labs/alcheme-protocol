'use client';

import { useCallback, useEffect, useState } from 'react';
import { useWallet } from '@solana/wallet-adapter-react';

import {
    acceptContributionCredentialClaim,
    fetchContributionCredentialClaim,
    prepareContributionCredentialClaim,
    type ContributionCredentialClaimReadback,
} from '@/lib/api/contributionCredentialClaim';
import { useI18n } from '@/i18n/useI18n';
import { useWalletAction } from '@/lib/wallet/WalletActionProvider';
import { useWalletActionRunner } from '@/lib/wallet/useWalletActionRunner';

import styles from './ContributionCredentialClaimCard.module.css';

type Visibility = 'private' | 'circle' | 'public';

function bytesToBase64(bytes: Uint8Array): string {
    let binary = '';
    for (const byte of bytes) binary += String.fromCharCode(byte);
    return btoa(binary);
}

export default function ContributionCredentialClaimCard({ knowledgeId }: { knowledgeId: string }) {
    const t = useI18n('KnowledgeDetailPage');
    const wallet = useWallet();
    const { requestWalletConnection } = useWalletAction();
    const { signMessageForAction } = useWalletActionRunner();
    const [readback, setReadback] = useState<ContributionCredentialClaimReadback | null>(null);
    const [visibility, setVisibility] = useState<Visibility>('private');
    const [loading, setLoading] = useState(false);
    const [error, setError] = useState<string | null>(null);

    const refresh = useCallback(async () => {
        if (!wallet.publicKey) {
            setReadback(null);
            return;
        }
        setLoading(true);
        setError(null);
        try {
            setReadback(await fetchContributionCredentialClaim(knowledgeId));
        } catch (cause) {
            const code = String((cause as any)?.code || 'credential_claim_readback_failed');
            setError(code === 'auth_session_required'
                ? t('credentialClaim.signInRequired')
                : t('credentialClaim.loadFailed'));
        } finally {
            setLoading(false);
        }
    }, [knowledgeId, t, wallet.publicKey]);

    useEffect(() => {
        void refresh();
    }, [refresh]);

    const submit = useCallback(async () => {
        if (!wallet.publicKey || !wallet.signMessage) {
            requestWalletConnection({ source: 'contribution_credential_claim' });
            return;
        }
        setLoading(true);
        setError(null);
        try {
            const preparation = await prepareContributionCredentialClaim({ knowledgeId, visibility });
            const signature = await signMessageForAction({
                kind: 'signed_server_mutation',
                source: 'contribution_credential_claim',
                key: `contribution-credential-claim:${preparation.facts.idempotencyKey}`,
                message: preparation.signedMessage,
            });
            await acceptContributionCredentialClaim({
                knowledgeId,
                signedMessage: preparation.signedMessage,
                signature: bytesToBase64(signature),
            });
            await refresh();
        } catch (cause) {
            setError((cause as any)?.code === 'contribution_claim_consent_expired'
                ? t('credentialClaim.expired')
                : t('credentialClaim.submitFailed'));
        } finally {
            setLoading(false);
        }
    }, [knowledgeId, refresh, requestWalletConnection, signMessageForAction, t, visibility, wallet.publicKey, wallet.signMessage]);

    return (
        <section className={styles.card} data-testid="knowledge-credential-claim">
            <div className={styles.header}>
                <div>
                    <span className={styles.kicker}>{t('credentialClaim.kicker')}</span>
                    <h3>{t('credentialClaim.title')}</h3>
                </div>
                <span className={styles.status} data-testid="knowledge-credential-claim-status">
                    {readback?.claim
                        ? t('credentialClaim.status.pending')
                        : t('credentialClaim.status.notRequested')}
                </span>
            </div>
            <p className={styles.boundary}>{t('credentialClaim.boundary')}</p>
            <div className={styles.rows}>
                <div className={styles.row}>
                    <span>{t('credentialClaim.payer')}</span>
                    <strong>{t('credentialClaim.requesterPayer')}</strong>
                </div>
                <div className={styles.row}>
                    <span>{t('credentialClaim.circleSponsor')}</span>
                    <strong>{t('credentialClaim.notConfigured')}</strong>
                </div>
                {readback ? (
                    <>
                        <div className={styles.row} data-testid="knowledge-credential-settlement-readiness">
                            <span>{t('credentialClaim.settlementReadiness')}</span>
                            <strong>{t('credentialClaim.setupRequired')}</strong>
                        </div>
                        <div className={styles.row}>
                            <span>{t('credentialClaim.assetAuthority')}</span>
                            <strong>{readback.settlementReadiness.assetAuthorityPolicy === 'present_unverified'
                                ? t('credentialClaim.presentUnverified')
                                : t('credentialClaim.notConfigured')}</strong>
                        </div>
                        <div className={styles.row}>
                            <span>{t('credentialClaim.providerExecution')}</span>
                            <strong>{t('credentialClaim.unavailable')}</strong>
                        </div>
                        <div className={styles.row} data-testid="knowledge-credential-issuance-plan">
                            <span>{t('credentialClaim.issuancePlan')}</span>
                            <strong>{t('credentialClaim.freeAlternative')}</strong>
                        </div>
                        <div className={styles.row}>
                            <span>{t('credentialClaim.holderConsent')}</span>
                            <strong>{readback.settlementReadiness.identityEvidenceIssuancePlan.holderConsent.status === 'captured'
                                ? t('credentialClaim.consentCaptured')
                                : t('credentialClaim.consentMissing')}</strong>
                        </div>
                        <div className={styles.row}>
                            <span>{t('credentialClaim.sponsorIssuerBoundary')}</span>
                            <strong>{t('credentialClaim.sponsorCannotIssue')}</strong>
                        </div>
                        <div className={styles.row}>
                            <span>{t('credentialClaim.paidIssuanceQuota')}</span>
                            <strong>{readback.settlementReadiness.identityEvidenceIssuancePlan.transaction.quota.paidIssuancePerClaim}</strong>
                        </div>
                    </>
                ) : null}
                <label className={styles.row}>
                    <span>{t('credentialClaim.visibility')}</span>
                    <select
                        value={visibility}
                        onChange={(event) => setVisibility(event.target.value as Visibility)}
                        disabled={loading || Boolean(readback?.claim)}
                    >
                        <option value="private">{t('credentialClaim.visibilityOptions.private')}</option>
                        <option value="circle">{t('credentialClaim.visibilityOptions.circle')}</option>
                        <option value="public">{t('credentialClaim.visibilityOptions.public')}</option>
                    </select>
                </label>
            </div>
            {!wallet.publicKey ? (
                <button
                    type="button"
                    className={styles.action}
                    onClick={() => requestWalletConnection({ source: 'contribution_credential_claim' })}
                >
                    {t('credentialClaim.connectWallet')}
                </button>
            ) : readback?.claim ? (
                <p className={styles.notice}>{t('credentialClaim.pendingReadback')}</p>
            ) : (
                <button
                    type="button"
                    className={styles.action}
                    onClick={() => void submit()}
                    disabled={loading || readback?.eligible === false}
                >
                    {loading ? t('credentialClaim.working') : t('credentialClaim.request')}
                </button>
            )}
            {readback?.eligible === false && !readback.claim ? (
                <p className={styles.error}>{t('credentialClaim.notEligible')}</p>
            ) : null}
            {readback ? (
                <p className={styles.notice} data-testid="knowledge-credential-settlement-boundary">
                    {t('credentialClaim.settlementBoundary')}
                </p>
            ) : null}
            {error ? <p className={styles.error} role="alert">{error}</p> : null}
        </section>
    );
}
