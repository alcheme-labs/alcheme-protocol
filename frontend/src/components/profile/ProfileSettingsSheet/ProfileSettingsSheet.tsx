'use client';

import { useEffect, useMemo, useRef, useState, useTransition } from 'react';
import { useRouter } from 'next/navigation';
import { AnimatePresence, motion } from 'framer-motion';
import { Check, ChevronLeft, ChevronRight, Languages, Palette, X } from 'lucide-react';
import { StyleProposalPanel } from '@/components/alcheme';
import { LOCALE_OPTIONS, type AppLocale } from '@/i18n/config';
import { useCurrentLocale, useI18n } from '@/i18n/useI18n';
import { updatePreferredLocale } from '@/lib/api/preferences';
import {
    applyStylePreference,
    deletePersonalStylePreferences,
    exportStylePreferences,
    getCurrentStylePreference,
    pollStyleAdvisorProposal,
    recordStyleAdvisorEvent,
    requestStyleAdvisor,
    type StylePreferenceView,
    type StyleProposalView,
} from '@/lib/api/styleAdvisor';
import { formatNodeRoutingError } from '@/lib/api/nodeRouting';
import styles from './ProfileSettingsSheet.module.css';

interface ProfileSettingsSheetProps {
    open: boolean;
    onClose: () => void;
}

type ProfileSettingsView = 'root' | 'language' | 'style';
type StyleAdvisorUiState =
    | { status: 'idle' }
    | { status: 'loading'; requestKey: string }
    | { status: 'ready'; proposal: StyleProposalView; requestKey: string }
    | { status: 'applied'; proposal: StyleProposalView; requestKey: string }
    | { status: 'disabled'; message: string }
    | { status: 'error'; message: string };

const SHOW_STYLE_ADVISOR_ENTRY = false;

export default function ProfileSettingsSheet({ open, onClose }: ProfileSettingsSheetProps) {
    const t = useI18n('ProfileSettingsSheet');
    const router = useRouter();
    const locale = useCurrentLocale();
    const [isPending, startTransition] = useTransition();
    const [view, setView] = useState<ProfileSettingsView>('root');
    const [selectedLocale, setSelectedLocale] = useState<AppLocale>(locale);
    const [personalStylePreference, setPersonalStylePreference] = useState<StylePreferenceView | null>(null);
    const [styleAdvisorState, setStyleAdvisorState] = useState<StyleAdvisorUiState>({ status: 'idle' });
    const styleAdvisorAbortRef = useRef<AbortController | null>(null);
    const styleAdvisorRequestKeyRef = useRef('');

    useEffect(() => {
        setSelectedLocale(locale);
    }, [locale]);

    useEffect(() => {
        if (!open) {
            setView('root');
            styleAdvisorAbortRef.current?.abort();
            styleAdvisorAbortRef.current = null;
        }
    }, [open]);

    useEffect(() => {
        if (!open || !SHOW_STYLE_ADVISOR_ENTRY) return;
        let cancelled = false;
        getCurrentStylePreference({ scope: 'personal' })
            .then((preference) => {
                if (!cancelled) setPersonalStylePreference(preference);
            })
            .catch(() => undefined);
        return () => {
            cancelled = true;
        };
    }, [open]);

    const currentLocaleLabel = useMemo(
        () => t(`language.options.${selectedLocale}`),
        [selectedLocale, t],
    );
    const viewIndex = view === 'root' ? 0 : view === 'language' ? 1 : 2;

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

    function clearStyleAdvisorState() {
        styleAdvisorAbortRef.current?.abort();
        styleAdvisorAbortRef.current = null;
        styleAdvisorRequestKeyRef.current = '';
        setStyleAdvisorState({ status: 'idle' });
    }

    async function handleGeneratePersonalStyleProposal() {
        if (styleAdvisorState.status === 'loading') return;
        const requestKey = JSON.stringify({
            locale,
            preference: personalStylePreference?.preferencePayload ?? null,
            at: Date.now(),
        });
        styleAdvisorAbortRef.current?.abort();
        const controller = new AbortController();
        styleAdvisorAbortRef.current = controller;
        styleAdvisorRequestKeyRef.current = requestKey;
        setStyleAdvisorState({ status: 'loading', requestKey });
        try {
            const response = await requestStyleAdvisor({
                scope: 'personal',
                locale,
                userIntent: t('style.intentPersonal'),
                currentPreference: personalStylePreference?.preferencePayload ?? {},
            });
            if (styleAdvisorRequestKeyRef.current !== requestKey) return;
            if (response.status === 'disabled') {
                setStyleAdvisorState({
                    status: 'disabled',
                    message: t('style.disabledFallback'),
                });
                return;
            }
            if (!response.jobId) {
                setStyleAdvisorState({ status: 'error', message: t('style.didNotStart') });
                return;
            }
            const proposal = await pollStyleAdvisorProposal(response.jobId, {
                signal: controller.signal,
            });
            if (styleAdvisorRequestKeyRef.current !== requestKey) return;
            if (!proposal) {
                setStyleAdvisorState({ status: 'error', message: t('style.timedOut') });
                return;
            }
            setStyleAdvisorState({ status: 'ready', proposal, requestKey });
        } catch (error) {
            if ((error as any)?.name === 'AbortError') return;
            if (styleAdvisorRequestKeyRef.current !== requestKey) return;
            setStyleAdvisorState({
                status: 'error',
                message: formatNodeRoutingError(error, t('style.failed')),
            });
        }
    }

    function handlePreviewPersonalStyleProposal() {
        const proposal = styleAdvisorState.status === 'ready' || styleAdvisorState.status === 'applied'
            ? styleAdvisorState.proposal
            : null;
        if (!proposal) return;
        void recordStyleAdvisorEvent({
            proposalId: proposal.id,
            eventType: 'previewed',
            scope: 'personal',
        }).catch(() => undefined);
    }

    async function handleApplyPersonalStyleProposal() {
        if (styleAdvisorState.status !== 'ready') return;
        const proposal = styleAdvisorState.proposal;
        try {
            const preference = await applyStylePreference({
                scope: 'personal',
                proposalId: proposal.id,
            });
            setPersonalStylePreference(preference);
            void recordStyleAdvisorEvent({
                proposalId: proposal.id,
                eventType: 'personal_applied',
                scope: 'personal',
            }).catch(() => undefined);
            setStyleAdvisorState({
                status: 'applied',
                proposal,
                requestKey: styleAdvisorState.requestKey,
            });
        } catch (error) {
            setStyleAdvisorState({
                status: 'error',
                message: formatNodeRoutingError(error, t('style.applyFailed')),
            });
        }
    }

    function handleIgnorePersonalStyleProposal() {
        if (styleAdvisorState.status === 'ready' || styleAdvisorState.status === 'applied') {
            void recordStyleAdvisorEvent({
                proposalId: styleAdvisorState.proposal.id,
                eventType: 'ignored',
                scope: 'personal',
            }).catch(() => undefined);
        }
        clearStyleAdvisorState();
    }

    async function handleDeletePersonalStylePreference() {
        try {
            await deletePersonalStylePreferences();
            setPersonalStylePreference(null);
            clearStyleAdvisorState();
        } catch (error) {
            setStyleAdvisorState({
                status: 'error',
                message: formatNodeRoutingError(error, t('style.deleteFailed')),
            });
        }
    }

    async function handleExportPersonalStylePreference() {
        try {
            await exportStylePreferences();
            if (styleAdvisorState.status === 'ready' || styleAdvisorState.status === 'applied') {
                void recordStyleAdvisorEvent({
                    proposalId: styleAdvisorState.proposal.id,
                    eventType: 'exported',
                    scope: 'personal',
                }).catch(() => undefined);
            }
        } catch (error) {
            setStyleAdvisorState({
                status: 'error',
                message: formatNodeRoutingError(error, t('style.exportFailed')),
            });
        }
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
                                style={{ transform: `translateX(-${viewIndex * (100 / 3)}%)` }}
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
                                        {SHOW_STYLE_ADVISOR_ENTRY ? (
                                            <button
                                                type="button"
                                                className={styles.menuRow}
                                                onClick={() => setView('style')}
                                                aria-label={t('style.openAria')}
                                            >
                                                <div className={styles.menuIcon}>
                                                    <Palette size={18} />
                                                </div>
                                                <div className={styles.menuCopy}>
                                                    <span className={styles.menuTitle}>{t('style.label')}</span>
                                                    <span className={styles.menuDescription}>
                                                        {personalStylePreference ? t('style.currentLabel') : t('style.notSetLabel')}
                                                    </span>
                                                </div>
                                                <ChevronRight size={18} className={styles.chevron} />
                                            </button>
                                        ) : null}
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

                                <section className={styles.panel} aria-hidden={view !== 'style'}>
                                    <header className={styles.header}>
                                        <button
                                            type="button"
                                            className={styles.backButton}
                                            onClick={() => setView('root')}
                                            aria-label={t('style.backAria')}
                                        >
                                            <ChevronLeft size={18} />
                                            <span>{t('style.backLabel')}</span>
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
                                        <StyleProposalPanel
                                            title={t('style.title')}
                                            description={t('style.description')}
                                            status={styleAdvisorState.status === 'loading'
                                                ? 'loading'
                                                : styleAdvisorState.status === 'ready'
                                                    ? 'ready'
                                                    : styleAdvisorState.status === 'applied'
                                                        ? 'applied'
                                                        : styleAdvisorState.status === 'disabled'
                                                            ? 'disabled'
                                                            : styleAdvisorState.status === 'error'
                                                                ? 'error'
                                                                : 'idle'}
                                            proposal={styleAdvisorState.status === 'ready' || styleAdvisorState.status === 'applied'
                                                ? styleAdvisorState.proposal
                                                : null}
                                            errorMessage={styleAdvisorState.status === 'error' ? styleAdvisorState.message : null}
                                            disabledReason={styleAdvisorState.status === 'disabled' ? styleAdvisorState.message : null}
                                            requestLabel={t('style.requestLabel')}
                                            previewLabel={t('style.previewLabel')}
                                            applyLabel={t('style.applyLabel')}
                                            appliedLabel={t('style.appliedLabel')}
                                            ignoreLabel={t('style.ignoreLabel')}
                                            exportLabel={t('style.exportLabel')}
                                            deleteLabel={t('style.deleteLabel')}
                                            emptyLabel={t('style.emptyLabel')}
                                            loadingLabel={t('style.loadingLabel')}
                                            readyAnnouncementLabel={t('style.readyAnnouncement')}
                                            unavailableLabel={t('style.unavailableLabel')}
                                            requestFailedLabel={t('style.requestFailedLabel')}
                                            checksLabel={t('style.checksLabel')}
                                            changesLabel={t('style.changesLabel')}
                                            previewTitle={t('style.previewTitle')}
                                            previewBody={t('style.previewBody')}
                                            riskLabels={{
                                                low: t('style.risk.low'),
                                                medium: t('style.risk.medium'),
                                                high: t('style.risk.high'),
                                            }}
                                            tokenLabels={{
                                                surface: t('style.tokens.surface'),
                                                text: t('style.tokens.text'),
                                                accent: t('style.tokens.accent'),
                                                motion: t('style.tokens.motion'),
                                            }}
                                            onRequest={handleGeneratePersonalStyleProposal}
                                            onPreview={handlePreviewPersonalStyleProposal}
                                            onApply={handleApplyPersonalStyleProposal}
                                            onIgnore={handleIgnorePersonalStyleProposal}
                                            onExport={handleExportPersonalStylePreference}
                                            onDelete={handleDeletePersonalStylePreference}
                                        />
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
