'use client';

import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { useEffect, useMemo, useState } from 'react';
import { motion } from 'framer-motion';
import RegisterIdentitySheet from '@/components/auth/RegisterIdentitySheet/RegisterIdentitySheet';
import { Button } from '@/components/ui/Button';
import { useRegisterIdentity } from '@/hooks/useRegisterIdentity';
import { useI18n } from '@/i18n/useI18n';
import { useIdentityOnboarding } from '@/lib/auth/identityOnboarding';
import { useWalletAction } from '@/lib/wallet/WalletActionProvider';
import styles from './page.module.css';

export default function ConnectPage() {
    const t = useI18n('ConnectPage');
    const { requestWalletConnection } = useWalletAction();
    const router = useRouter();
    const {
        identityState,
        acceptPublicDemoAdmission,
        lastErrorMessage,
        refreshIdentityState,
        walletConnected,
    } = useIdentityOnboarding();
    const {
        registerIdentity,
        loading,
        syncing,
        error,
    } = useRegisterIdentity();
    const [showRegisterSheet, setShowRegisterSheet] = useState(false);
    const [autoPromptDismissed, setAutoPromptDismissed] = useState(false);
    const [admissionRegion, setAdmissionRegion] = useState<'US' | 'OTHER' | 'CN'>('US');
    const [adultAttested, setAdultAttested] = useState(false);
    const [termsAccepted, setTermsAccepted] = useState(false);
    const [privacyAccepted, setPrivacyAccepted] = useState(false);
    const [safetyPolicyAccepted, setSafetyPolicyAccepted] = useState(false);

    useEffect(() => {
        if (identityState === 'registered') {
            router.push('/home');
        }
    }, [identityState, router]);

    useEffect(() => {
        if (identityState !== 'unregistered') {
            setAutoPromptDismissed(false);
            return;
        }
        if (!autoPromptDismissed) {
            setShowRegisterSheet(true);
        }
    }, [autoPromptDismissed, identityState]);

    const copy = useMemo(() => {
        if (identityState === 'connecting_session') {
            return {
                subtitle: t('states.connectingSession.subtitle'),
                primaryLabel: t('states.connectingSession.primaryLabel'),
                skipLabel: t('common.skip'),
            };
        }

        if (identityState === 'unregistered') {
            return {
                subtitle: t('states.unregistered.subtitle'),
                primaryLabel: t('states.unregistered.primaryLabel'),
                skipLabel: t('states.unregistered.skipLabel'),
            };
        }

        if (identityState === 'admission_required') {
            return {
                subtitle: lastErrorMessage || t('states.admissionRequired.subtitle'),
                primaryLabel: t('states.admissionRequired.primaryLabel'),
                skipLabel: t('common.skip'),
            };
        }

        if (identityState === 'session_error') {
            return {
                subtitle: lastErrorMessage || t('states.sessionError.subtitle'),
                primaryLabel: t('states.sessionError.primaryLabel'),
                skipLabel: t('states.sessionError.skipLabel'),
            };
        }

        if (identityState === 'registered') {
            return {
                subtitle: t('states.registered.subtitle'),
                primaryLabel: t('states.registered.primaryLabel'),
                skipLabel: t('common.skip'),
            };
        }

        return {
            subtitle: t('states.default.subtitle'),
            primaryLabel: t('states.default.primaryLabel'),
            skipLabel: t('common.skip'),
        };
    }, [identityState, lastErrorMessage, t]);

    const handlePrimaryAction = () => {
        if (identityState === 'unregistered') {
            setShowRegisterSheet(true);
            return;
        }
        if (identityState === 'session_error') {
            void refreshIdentityState();
            return;
        }
        if (identityState === 'admission_required') {
            if (
                adultAttested
                && termsAccepted
                && privacyAccepted
                && safetyPolicyAccepted
            ) {
                void acceptPublicDemoAdmission(admissionRegion);
            }
            return;
        }
        if (!walletConnected) {
            requestWalletConnection({ source: 'connect_page_primary' });
        }
    };

    const handleRegisterIdentity = async (handle: string) => {
        const created = await registerIdentity({ handle });
        if (!created) return;
        await refreshIdentityState();
        setShowRegisterSheet(false);
    };

    return (
        <div className={styles.container}>

            <motion.div
                className={styles.content}
                initial={{ opacity: 0, y: 20 }}
                animate={{ opacity: 1, y: 0 }}
                transition={{ duration: 0.8, ease: [0.2, 0.8, 0.2, 1] }}
            >
                {/* Crystal logo */}
                <svg
                    className={styles.logo}
                    width="64"
                    height="64"
                    viewBox="0 0 64 64"
                    fill="none"
                >
                    <path
                        d="M32 4L56 18V46L32 60L8 46V18L32 4Z"
                        stroke="var(--color-accent-gold)"
                        strokeWidth="1.5"
                        fill="none"
                    />
                    <path
                        d="M32 12L48 22V42L32 52L16 42V22L32 12Z"
                        stroke="var(--color-accent-gold)"
                        strokeWidth="1"
                        opacity="0.6"
                        fill="none"
                    />
                    <circle
                        cx="32"
                        cy="32"
                        r="4"
                        fill="var(--color-accent-gold)"
                        opacity="0.8"
                    />
                </svg>

                <h1 className={styles.title}>{t('title')}</h1>
                <p className={styles.subtitle}>
                    {copy.subtitle}
                </p>

                {identityState === 'admission_required' && (
                    <fieldset className={styles.admission}>
                        <legend>{t('admission.title')}</legend>
                        <p className={styles.admissionBoundary}>{t('admission.boundary')}</p>
                        <nav className={styles.admissionLinks} aria-label={t('admission.title')}>
                            <Link href="/terms/public-demo" target="_blank">{t('admission.links.terms')}</Link>
                            <Link href="/privacy/public-demo" target="_blank">{t('admission.links.privacy')}</Link>
                            <Link href="/safety/public-demo" target="_blank">{t('admission.links.safety')}</Link>
                        </nav>
                        <label className={styles.admissionField}>
                            <span>{t('admission.regionLabel')}</span>
                            <select
                                value={admissionRegion}
                                onChange={(event) => setAdmissionRegion(event.target.value as 'US' | 'OTHER' | 'CN')}
                            >
                                <option value="US">{t('admission.regions.us')}</option>
                                <option value="OTHER">{t('admission.regions.other')}</option>
                                <option value="CN">{t('admission.regions.cn')}</option>
                            </select>
                        </label>
                        <label className={styles.admissionCheck}>
                            <input
                                type="checkbox"
                                checked={adultAttested}
                                onChange={(event) => setAdultAttested(event.target.checked)}
                            />
                            <span>{t('admission.adult')}</span>
                        </label>
                        <label className={styles.admissionCheck}>
                            <input
                                type="checkbox"
                                checked={termsAccepted}
                                onChange={(event) => setTermsAccepted(event.target.checked)}
                            />
                            <span>{t('admission.terms')}</span>
                        </label>
                        <label className={styles.admissionCheck}>
                            <input
                                type="checkbox"
                                checked={privacyAccepted}
                                onChange={(event) => setPrivacyAccepted(event.target.checked)}
                            />
                            <span>{t('admission.privacy')}</span>
                        </label>
                        <label className={styles.admissionCheck}>
                            <input
                                type="checkbox"
                                checked={safetyPolicyAccepted}
                                onChange={(event) => setSafetyPolicyAccepted(event.target.checked)}
                            />
                            <span>{t('admission.safety')}</span>
                        </label>
                        {admissionRegion === 'CN' && (
                            <p className={styles.admissionUnavailable}>{t('admission.chinaUnavailable')}</p>
                        )}
                    </fieldset>
                )}

                <div className={styles.actions}>
                    <Button
                        variant="primary"
                        size="lg"
                        fullWidth
                        onClick={handlePrimaryAction}
                        disabled={identityState === 'registered' || (
                            identityState === 'admission_required' && (
                                admissionRegion === 'CN'
                                || !adultAttested
                                || !termsAccepted
                                || !privacyAccepted
                                || !safetyPolicyAccepted
                            )
                        )}
                        aria-disabled={identityState === 'admission_required' && (
                            !adultAttested
                            || !termsAccepted
                            || !privacyAccepted
                            || !safetyPolicyAccepted
                        )}
                        loading={identityState === 'connecting_session'}
                    >
                        {copy.primaryLabel}
                    </Button>

                    {identityState !== 'admission_required' && (
                        <button
                            className={styles.skipLink}
                            onClick={() => router.push('/home')}
                        >
                            {copy.skipLabel}
                        </button>
                    )}
                </div>

                <p className={styles.hint}>
                    {t('walletHint')}
                </p>
            </motion.div>

            <RegisterIdentitySheet
                open={showRegisterSheet}
                context="onboarding"
                loading={loading}
                syncing={syncing}
                error={error}
                onClose={() => {
                    if (!loading && !syncing) {
                        setShowRegisterSheet(false);
                        setAutoPromptDismissed(true);
                    }
                }}
                onSubmit={handleRegisterIdentity}
            />
        </div>
    );
}
