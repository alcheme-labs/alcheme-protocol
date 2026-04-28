'use client';

import { useEffect, useMemo, useState, useTransition } from 'react';
import { useRouter } from 'next/navigation';
import { AnimatePresence, motion } from 'framer-motion';
import { Check, ChevronLeft, ChevronRight, Languages, X } from 'lucide-react';
import { LOCALE_OPTIONS, type AppLocale } from '@/i18n/config';
import { useCurrentLocale, useI18n } from '@/i18n/useI18n';
import { updatePreferredLocale } from '@/lib/api/preferences';
import styles from './ProfileSettingsSheet.module.css';

interface ProfileSettingsSheetProps {
    open: boolean;
    onClose: () => void;
}

export default function ProfileSettingsSheet({ open, onClose }: ProfileSettingsSheetProps) {
    const t = useI18n('ProfileSettingsSheet');
    const router = useRouter();
    const locale = useCurrentLocale();
    const [isPending, startTransition] = useTransition();
    const [view, setView] = useState<'root' | 'language'>('root');
    const [selectedLocale, setSelectedLocale] = useState<AppLocale>(locale);

    useEffect(() => {
        setSelectedLocale(locale);
    }, [locale]);

    useEffect(() => {
        if (!open) {
            setView('root');
        }
    }, [open]);

    const currentLocaleLabel = useMemo(
        () => t(`language.options.${selectedLocale}`),
        [selectedLocale, t],
    );

    async function handleSelectLocale(nextLocale: AppLocale) {
        if (nextLocale === locale) {
            onClose();
            return;
        }

        setSelectedLocale(nextLocale);

        try {
            await updatePreferredLocale(nextLocale);
        } catch {
            setSelectedLocale(locale);
            return;
        }

        startTransition(() => {
            router.refresh();
        });
        onClose();
    }

    return (
        <AnimatePresence>
            {open ? (
                <motion.div
                    className={styles.overlay}
                    initial={{ opacity: 0 }}
                    animate={{ opacity: 1 }}
                    exit={{ opacity: 0 }}
                    transition={{ duration: 0.18 }}
                    onClick={onClose}
                >
                    <motion.div
                        className={styles.sheet}
                        initial={{ x: '100%' }}
                        animate={{ x: 0 }}
                        exit={{ x: '100%' }}
                        transition={{ duration: 0.24, ease: [0.2, 0.8, 0.2, 1] }}
                        onClick={(event) => event.stopPropagation()}
                    >
                        <div className={styles.viewport}>
                            <div
                                className={styles.track}
                                style={{ transform: `translateX(${view === 'root' ? '0%' : '-50%'})` }}
                            >
                                <section className={styles.panel} aria-hidden={view !== 'root'}>
                                    <header className={styles.header}>
                                        <div>
                                            <p className={styles.eyebrow}>{t('eyebrow')}</p>
                                            <h2 className={styles.title}>{t('title')}</h2>
                                        </div>
                                        <button
                                            type="button"
                                            className={styles.iconButton}
                                            onClick={onClose}
                                            aria-label={t('actions.closeAria')}
                                        >
                                            <X size={18} />
                                        </button>
                                    </header>

                                    <div className={styles.body}>
                                        <button
                                            type="button"
                                            className={styles.menuRow}
                                            onClick={() => setView('language')}
                                            aria-label={t('language.openAria')}
                                        >
                                            <div className={styles.menuIcon}>
                                                <Languages size={18} />
                                            </div>
                                            <div className={styles.menuCopy}>
                                                <span className={styles.menuTitle}>{t('language.label')}</span>
                                                <span className={styles.menuDescription}>{currentLocaleLabel}</span>
                                            </div>
                                            <ChevronRight size={18} className={styles.chevron} />
                                        </button>
                                    </div>
                                </section>

                                <section className={styles.panel} aria-hidden={view !== 'language'}>
                                    <header className={styles.header}>
                                        <button
                                            type="button"
                                            className={styles.backButton}
                                            onClick={() => setView('root')}
                                            aria-label={t('language.backAria')}
                                        >
                                            <ChevronLeft size={18} />
                                            <span>{t('language.backLabel')}</span>
                                        </button>
                                        <button
                                            type="button"
                                            className={styles.iconButton}
                                            onClick={onClose}
                                            aria-label={t('actions.closeAria')}
                                        >
                                            <X size={18} />
                                        </button>
                                    </header>

                                    <div className={styles.body}>
                                        <div className={styles.languageHeader}>
                                            <h3 className={styles.languageTitle}>{t('language.title')}</h3>
                                            <p className={styles.languageHint}>{t('language.hint')}</p>
                                        </div>

                                        <div className={styles.languageList}>
                                            {LOCALE_OPTIONS.map((option) => {
                                                const isActive = selectedLocale === option.value;
                                                return (
                                                    <button
                                                        key={option.value}
                                                        type="button"
                                                        className={styles.languageOption}
                                                        onClick={() => handleSelectLocale(option.value)}
                                                        disabled={isPending}
                                                    >
                                                        <div className={styles.menuCopy}>
                                                            <span className={styles.menuTitle}>{t(`language.options.${option.value}`)}</span>
                                                            <span className={styles.menuDescription}>
                                                                {option.value === locale ? t('language.currentLabel') : t('language.tapToSwitch')}
                                                            </span>
                                                        </div>
                                                        {isActive ? <Check size={18} className={styles.check} /> : null}
                                                    </button>
                                                );
                                            })}
                                        </div>

                                        {isPending ? (
                                            <p className={styles.pending}>{t('language.pending')}</p>
                                        ) : null}
                                    </div>
                                </section>
                            </div>
                        </div>
                    </motion.div>
                </motion.div>
            ) : null}
        </AnimatePresence>
    );
}
