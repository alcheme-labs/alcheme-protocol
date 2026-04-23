'use client';

import { useWalletModal } from '@solana/wallet-adapter-react-ui';
import { useRouter } from 'next/navigation';
import { useEffect, useMemo, useState } from 'react';
import { motion } from 'framer-motion';
import RegisterIdentitySheet from '@/components/auth/RegisterIdentitySheet/RegisterIdentitySheet';
import { Button } from '@/components/ui/Button';
import { useRegisterIdentity } from '@/hooks/useRegisterIdentity';
import { useI18n } from '@/i18n/useI18n';
import { useIdentityOnboarding } from '@/lib/auth/identityOnboarding';
import styles from './page.module.css';

export default function ConnectPage() {
    const t = useI18n('ConnectPage');
    const { setVisible } = useWalletModal();
    const router = useRouter();
    const {
        identityState,
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
        if (!walletConnected) {
            setVisible(true);
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

                <div className={styles.actions}>
                    <Button
                        variant="primary"
                        size="lg"
                        fullWidth
                        onClick={handlePrimaryAction}
                        disabled={identityState === 'registered'}
                        loading={identityState === 'connecting_session'}
                    >
                        {copy.primaryLabel}
                    </Button>

                    <button
                        className={styles.skipLink}
                        onClick={() => router.push('/home')}
                    >
                        {copy.skipLabel}
                    </button>
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
