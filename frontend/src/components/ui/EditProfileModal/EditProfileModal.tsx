'use client';

import { useState, useCallback, useEffect } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import { X } from 'lucide-react';
import { useI18n } from '@/i18n/useI18n';
import styles from './EditProfileModal.module.css';

interface EditProfileModalProps {
    isOpen: boolean;
    onClose: () => void;
    initialData: {
        displayName: string;
        bio: string;
    };
    onSave: (data: { displayName: string; bio: string }) => void | Promise<void>;
}

export default function EditProfileModal({
    isOpen,
    onClose,
    initialData,
    onSave,
}: EditProfileModalProps) {
    const t = useI18n('EditProfileModal');
    const [displayName, setDisplayName] = useState(initialData.displayName);
    const [bio, setBio] = useState(initialData.bio);
    const [saving, setSaving] = useState(false);
    const [errorMessage, setErrorMessage] = useState<string | null>(null);

    useEffect(() => {
        if (!isOpen) return;
        setDisplayName(initialData.displayName);
        setBio(initialData.bio);
        setErrorMessage(null);
    }, [initialData.bio, initialData.displayName, isOpen]);

    const handleSave = useCallback(async () => {
        if (!displayName.trim()) return;
        setSaving(true);
        setErrorMessage(null);
        try {
            await onSave({ displayName: displayName.trim(), bio: bio.trim() });
            onClose();
        } catch (error) {
            setErrorMessage(error instanceof Error ? error.message : t('errors.saveFailed'));
        } finally {
            setSaving(false);
        }
    }, [bio, displayName, onClose, onSave, t]);

    return (
        <AnimatePresence>
            {isOpen && (
                <>
                    {/* Backdrop */}
                    <motion.div
                        className={styles.backdrop}
                        initial={{ opacity: 0 }}
                        animate={{ opacity: 1 }}
                        exit={{ opacity: 0 }}
                        onClick={onClose}
                    />

                    {/* Modal */}
                    <motion.div
                        className={styles.modal}
                        initial={{ opacity: 0, y: 40, scale: 0.97 }}
                        animate={{ opacity: 1, y: 0, scale: 1 }}
                        exit={{ opacity: 0, y: 20, scale: 0.97 }}
                        transition={{ duration: 0.3, ease: [0.2, 0.8, 0.2, 1] }}
                    >
                        <div className={styles.header}>
                            <h2 className={styles.title}>{t('title')}</h2>
                            <button className={styles.closeBtn} onClick={onClose} aria-label={t('actions.closeAria')}>
                                <X size={18} />
                            </button>
                        </div>

                        <div className={styles.form}>
                            <div className={styles.field}>
                                <label className={styles.label}>{t('fields.displayName.label')}</label>
                                <input
                                    type="text"
                                    className={styles.input}
                                    value={displayName}
                                    onChange={(e) => setDisplayName(e.target.value)}
                                    placeholder={t('fields.displayName.placeholder')}
                                    maxLength={30}
                                />
                            </div>

                            <div className={styles.field}>
                                <label className={styles.label}>{t('fields.bio.label')}</label>
                                <textarea
                                    className={styles.textarea}
                                    value={bio}
                                    onChange={(e) => setBio(e.target.value)}
                                    placeholder={t('fields.bio.placeholder')}
                                    rows={3}
                                    maxLength={120}
                                />
                                <span className={styles.charHint}>{t('fields.bio.charCount', {count: bio.length})}</span>
                            </div>
                        </div>

                        {errorMessage ? (
                            <p className={styles.errorText}>{errorMessage}</p>
                        ) : null}

                        <div className={styles.actions}>
                            <button className={styles.cancelBtn} onClick={onClose}>{t('actions.cancel')}</button>
                            <button
                                className={styles.saveBtn}
                                onClick={handleSave}
                                disabled={saving || !displayName.trim()}
                            >
                                {saving ? t('actions.saving') : t('actions.save')}
                            </button>
                        </div>
                    </motion.div>
                </>
            )}
        </AnimatePresence>
    );
}
