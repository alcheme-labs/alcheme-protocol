'use client';

import { useState, useCallback, useEffect, useRef } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import { Camera, X } from 'lucide-react';
import { FieldAssistInline } from '@/components/alcheme';
import ProfileAvatar from '@/components/profile/ProfileAvatar/ProfileAvatar';
import { useCurrentLocale, useI18n } from '@/i18n/useI18n';
import {
    pollSettingsTextAssistProposal,
    requestSettingsTextAssist,
    type SettingsTextAssistField,
    type SettingsTextAssistProposalView,
} from '@/lib/api/settingsTextAssist';
import { formatNodeRoutingError } from '@/lib/api/nodeRouting';
import styles from './EditProfileModal.module.css';

interface EditProfileModalProps {
    isOpen: boolean;
    onClose: () => void;
    initialData: {
        displayName: string;
        bio: string;
        avatarUri?: string | null;
        handle?: string | null;
    };
    onSave: (data: { displayName: string; bio: string; avatarFile: File | null }) => void | Promise<void>;
}

type SettingsTextAssistState =
    | { status: 'idle' }
    | { status: 'loading'; field: SettingsTextAssistField }
    | { status: 'ready'; field: SettingsTextAssistField; proposal: SettingsTextAssistProposalView }
    | { status: 'disabled'; message: string }
    | { status: 'error'; message: string };

const PROFILE_DISPLAY_NAME_MAX_CHARS = 30;
const PROFILE_BIO_MAX_CHARS = 120;

export default function EditProfileModal({
    isOpen,
    onClose,
    initialData,
    onSave,
}: EditProfileModalProps) {
    const t = useI18n('EditProfileModal');
    const locale = useCurrentLocale();
    const [displayName, setDisplayName] = useState(initialData.displayName);
    const [bio, setBio] = useState(initialData.bio);
    const [avatarFile, setAvatarFile] = useState<File | null>(null);
    const [avatarPreview, setAvatarPreview] = useState<string | null>(null);
    const [saving, setSaving] = useState(false);
    const [errorMessage, setErrorMessage] = useState<string | null>(null);
    const [settingsTextAssistState, setSettingsTextAssistState] = useState<SettingsTextAssistState>({ status: 'idle' });
    const saveInFlightRef = useRef(false);
    const avatarInputRef = useRef<HTMLInputElement>(null);
    const settingsTextAssistAbortRef = useRef<AbortController | null>(null);

    useEffect(() => {
        if (!isOpen) return;
        setDisplayName(initialData.displayName);
        setBio(initialData.bio);
        setAvatarFile(null);
        setAvatarPreview(null);
        setErrorMessage(null);
        clearSettingsTextAssist();
        saveInFlightRef.current = false;
    }, [initialData.bio, initialData.displayName, isOpen]);

    useEffect(() => () => {
        settingsTextAssistAbortRef.current?.abort();
    }, []);

    function clearSettingsTextAssist() {
        settingsTextAssistAbortRef.current?.abort();
        settingsTextAssistAbortRef.current = null;
        setSettingsTextAssistState({ status: 'idle' });
    }

    function getSettingsTextValue(field: SettingsTextAssistField): string {
        return field === 'profile.displayName' ? displayName : bio;
    }

    function setSettingsTextValue(field: SettingsTextAssistField, value: string) {
        if (field === 'profile.displayName') setDisplayName(value.slice(0, PROFILE_DISPLAY_NAME_MAX_CHARS));
        if (field === 'profile.bio') setBio(value.slice(0, PROFILE_BIO_MAX_CHARS));
    }

    async function handleGenerateSettingsTextAssist(field: SettingsTextAssistField) {
        if (saving || settingsTextAssistState.status === 'loading') return;
        settingsTextAssistAbortRef.current?.abort();
        const controller = new AbortController();
        settingsTextAssistAbortRef.current = controller;
        setSettingsTextAssistState({ status: 'loading', field });
        try {
            const response = await requestSettingsTextAssist({
                field,
                locale,
                userIntent: t(`fieldAssist.intent.${field === 'profile.displayName' ? 'displayName' : 'bio'}`),
                currentValue: getSettingsTextValue(field),
                surroundingValues: {
                    displayName,
                    bio,
                },
            });
            if (response.status === 'disabled') {
                setSettingsTextAssistState({ status: 'disabled', message: t('fieldAssist.disabled') });
                return;
            }
            if (!response.jobId) {
                setSettingsTextAssistState({ status: 'error', message: t('fieldAssist.didNotStart') });
                return;
            }
            const proposal = await pollSettingsTextAssistProposal(response.jobId, {
                signal: controller.signal,
            });
            if (!proposal?.proposedDiff.suggestedValue) {
                setSettingsTextAssistState({ status: 'error', message: t('fieldAssist.empty') });
                return;
            }
            setSettingsTextAssistState({ status: 'ready', field, proposal });
        } catch (error) {
            if ((error as any)?.name === 'AbortError') return;
            setSettingsTextAssistState({
                status: 'error',
                message: formatNodeRoutingError(error, t('fieldAssist.failed')),
            });
        } finally {
            if (settingsTextAssistAbortRef.current === controller) {
                settingsTextAssistAbortRef.current = null;
            }
        }
    }

    function handleAcceptSettingsTextAssist(field: SettingsTextAssistField) {
        if (settingsTextAssistState.status !== 'ready' || settingsTextAssistState.field !== field) return;
        const value = settingsTextAssistState.proposal.proposedDiff.suggestedValue;
        if (typeof value === 'string') setSettingsTextValue(field, value);
        clearSettingsTextAssist();
    }

    function renderSettingsTextAssist(field: SettingsTextAssistField) {
        const isCurrentField = settingsTextAssistState.status === 'loading'
            ? settingsTextAssistState.field === field
            : settingsTextAssistState.status === 'ready'
                ? settingsTextAssistState.field === field
                : true;
        const status = isCurrentField ? settingsTextAssistState.status : 'idle';
        const proposal = settingsTextAssistState.status === 'ready' && settingsTextAssistState.field === field
            ? settingsTextAssistState.proposal
            : null;
        return (
            <FieldAssistInline
                status={status}
                requestLabel={t('fieldAssist.requestLabel')}
                loadingLabel={t('fieldAssist.loadingLabel')}
                acceptLabel={t('fieldAssist.acceptLabel')}
                ignoreLabel={t('fieldAssist.ignoreLabel')}
                suggestion={proposal?.proposedDiff.suggestedValue ?? null}
                reason={proposal?.proposedDiff.reason ?? null}
                errorMessage={settingsTextAssistState.status === 'error' ? settingsTextAssistState.message : null}
                disabledReason={settingsTextAssistState.status === 'disabled' ? settingsTextAssistState.message : null}
                disabled={saving}
                onRequest={() => { void handleGenerateSettingsTextAssist(field); }}
                onAccept={() => handleAcceptSettingsTextAssist(field)}
                onIgnore={clearSettingsTextAssist}
            />
        );
    }

    const handleSave = useCallback(async () => {
        if (saveInFlightRef.current || !displayName.trim()) return;
        saveInFlightRef.current = true;
        setSaving(true);
        setErrorMessage(null);
        try {
            await onSave({ displayName: displayName.trim(), bio: bio.trim(), avatarFile });
            onClose();
        } catch (error) {
            setErrorMessage(error instanceof Error ? error.message : t('errors.saveFailed'));
        } finally {
            setSaving(false);
            saveInFlightRef.current = false;
        }
    }, [avatarFile, bio, displayName, onClose, onSave, t]);

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
                                <label className={styles.label}>{t('fields.avatar.label')}</label>
                                <div className={styles.avatarPicker}>
                                    <button
                                        type="button"
                                        className={styles.avatarTap}
                                        disabled={saving}
                                        aria-label={t('fields.avatar.change')}
                                        onClick={() => avatarInputRef.current?.click()}
                                    >
                                        {avatarPreview ? (
                                            <img className={styles.avatarPreview} src={avatarPreview} alt="" />
                                        ) : (
                                            <ProfileAvatar
                                                handle={initialData.handle}
                                                avatarUri={initialData.avatarUri}
                                                className={styles.avatarPreview}
                                                fallback={(
                                                    <span className={styles.avatarFallback}>
                                                        {displayName.trim().charAt(0) || '·'}
                                                    </span>
                                                )}
                                            />
                                        )}
                                        <span className={styles.avatarBadge} aria-hidden="true">
                                            <Camera size={14} />
                                        </span>
                                    </button>
                                    <button
                                        type="button"
                                        className={styles.changeAvatarBtn}
                                        disabled={saving}
                                        onClick={() => avatarInputRef.current?.click()}
                                    >
                                        {t('fields.avatar.change')}
                                    </button>
                                    <input
                                        ref={avatarInputRef}
                                        type="file"
                                        accept="image/*"
                                        className={styles.fileInput}
                                        disabled={saving}
                                        onChange={(event) => {
                                            const file = event.target.files?.[0] || null;
                                            if (avatarPreview) URL.revokeObjectURL(avatarPreview);
                                            setAvatarFile(file);
                                            setAvatarPreview(file ? URL.createObjectURL(file) : null);
                                            event.target.value = '';
                                        }}
                                    />
                                </div>
                            </div>
                            <div className={styles.field}>
                                <label className={styles.label}>{t('fields.displayName.label')}</label>
                                <input
                                    type="text"
                                    className={styles.input}
                                    value={displayName}
                                    onChange={(e) => setDisplayName(e.target.value)}
                                    placeholder={t('fields.displayName.placeholder')}
                                    maxLength={PROFILE_DISPLAY_NAME_MAX_CHARS}
                                />
                                {renderSettingsTextAssist('profile.displayName')}
                            </div>

                            <div className={styles.field}>
                                <label className={styles.label}>{t('fields.bio.label')}</label>
                                <textarea
                                    className={styles.textarea}
                                    value={bio}
                                    onChange={(e) => setBio(e.target.value)}
                                    placeholder={t('fields.bio.placeholder')}
                                    rows={3}
                                    maxLength={PROFILE_BIO_MAX_CHARS}
                                />
                                <span className={styles.charHint}>{t('fields.bio.charCount', {count: bio.length})}</span>
                                {renderSettingsTextAssist('profile.bio')}
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
