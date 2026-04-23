'use client';

import { useEffect, useMemo, useState } from 'react';
import { AnimatePresence, motion } from 'framer-motion';
import { X } from 'lucide-react';
import { validateIdentityHandle } from '@/lib/identity/handle';
import { useI18n } from '@/i18n/useI18n';
import styles from './RegisterIdentitySheet.module.css';

interface RegisterIdentitySheetProps {
    open: boolean;
    context?: 'onboarding' | 'join_circle';
    loading?: boolean;
    syncing?: boolean;
    error?: string | null;
    suggestedHandle?: string;
    onClose: () => void;
    onSubmit: (handle: string) => Promise<void> | void;
}

export default function RegisterIdentitySheet({
    open,
    context = 'join_circle',
    loading = false,
    syncing = false,
    error = null,
    suggestedHandle = '',
    onClose,
    onSubmit,
}: RegisterIdentitySheetProps) {
    const t = useI18n('RegisterIdentitySheet');
    const [handle, setHandle] = useState(suggestedHandle);
    const [localError, setLocalError] = useState<string | null>(null);

    useEffect(() => {
        if (open) {
            setHandle(suggestedHandle);
            setLocalError(null);
        }
    }, [open, suggestedHandle]);

    const submitting = loading || syncing;
    const isJoinContext = context === 'join_circle';
    const helperText = useMemo(() => {
        if (syncing) {
            return isJoinContext
                ? t('helper.syncing.joinCircle')
                : t('helper.syncing.onboarding');
        }
        return t('helper.default');
    }, [isJoinContext, syncing, t]);

    const title = isJoinContext ? t('title.joinCircle') : t('title.onboarding');
    const lead = isJoinContext
        ? t('lead.joinCircle')
        : t('lead.onboarding');
    const secondaryLabel = isJoinContext ? t('actions.cancel') : t('actions.notNow');
    const submitLabel = syncing
        ? isJoinContext ? t('actions.submittingJoin') : t('actions.submittingCreate')
        : loading
            ? isJoinContext ? t('actions.registeringJoin') : t('actions.registeringCreate')
            : isJoinContext ? t('actions.createAndJoin') : t('actions.create');

    const handleSubmit = async () => {
        const validationError = validateIdentityHandle(handle);
        if (validationError) {
            setLocalError(validationError);
            return;
        }
        setLocalError(null);
        await onSubmit(handle.trim());
    };

    return (
        <AnimatePresence>
            {open && (
                <motion.div
                    className={styles.overlay}
                    initial={{ opacity: 0 }}
                    animate={{ opacity: 1 }}
                    exit={{ opacity: 0 }}
                    transition={{ duration: 0.22 }}
                    onClick={() => {
                        if (!submitting) onClose();
                    }}
                >
                    <motion.div
                        className={styles.sheet}
                        initial={{ y: 280, opacity: 0 }}
                        animate={{ y: 0, opacity: 1 }}
                        exit={{ y: 280, opacity: 0 }}
                        transition={{ duration: 0.34, ease: [0.2, 0.8, 0.2, 1] }}
                        onClick={(event) => event.stopPropagation()}
                        role="dialog"
                        aria-modal="true"
                        aria-labelledby="register-identity-sheet-title"
                    >
                        <div className={styles.handle} />

                        <div className={styles.header}>
                            <div id="register-identity-sheet-title" className={styles.title}>{title}</div>
                            <button className={styles.closeBtn} onClick={onClose} disabled={submitting} aria-label={t('actions.close')}>
                                <X size={18} />
                            </button>
                        </div>

                        <div className={styles.body}>
                            <p className={styles.lead}>
                                {lead}
                            </p>

                            <div className={styles.field}>
                                <label className={styles.label} htmlFor="register-identity-handle">
                                    {t('handle.label')}
                                </label>
                                <input
                                    id="register-identity-handle"
                                    className={styles.input}
                                    value={handle}
                                    onChange={(event) => setHandle(event.target.value)}
                                    placeholder={t('handle.placeholder')}
                                    autoCapitalize="off"
                                    autoCorrect="off"
                                    spellCheck={false}
                                    disabled={submitting}
                                />
                                <div className={styles.hint}>{helperText}</div>
                            </div>

                            {(localError || error) && (
                                <div className={styles.error}>{localError || error}</div>
                            )}
                        </div>

                        <div className={styles.footer}>
                            <button className={styles.btnSecondary} onClick={onClose} disabled={submitting}>
                                {secondaryLabel}
                            </button>
                            <button className={styles.btnPrimary} onClick={() => void handleSubmit()} disabled={submitting}>
                                {submitLabel}
                            </button>
                        </div>
                    </motion.div>
                </motion.div>
            )}
        </AnimatePresence>
    );
}
