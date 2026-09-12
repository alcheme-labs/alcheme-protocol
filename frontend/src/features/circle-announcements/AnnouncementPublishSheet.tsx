'use client';

import { useEffect, useState } from 'react';
import { X } from 'lucide-react';
import {
    DateTimePickerSheet,
    formatDateTimeSummary,
    OptionPickerSheet,
} from '@/components/alcheme';
import styles from '@/app/(main)/circles/[id]/page.module.css';
import { publishCircleAnnouncement } from '@/lib/api/circleAnnouncements';
import type { CircleAnnouncementCopy } from './announcementCopy.ts';
import type {
    CircleAnnouncementConfirmationPolicy,
    CircleAnnouncementDetailDto,
} from './types.ts';

export interface AnnouncementPublishSheetProps {
    open: boolean;
    circleId: number;
    senderPubkey: string | null;
    discussionAccessToken?: string | null;
    copy: CircleAnnouncementCopy;
    errorMessage: string | null;
    onError: (message: string | null) => void;
    onPublished: (announcement: CircleAnnouncementDetailDto) => void | Promise<void>;
    onClose: () => void;
}

export default function AnnouncementPublishSheet({
    open,
    circleId,
    senderPubkey,
    discussionAccessToken,
    copy,
    errorMessage,
    onError,
    onPublished,
    onClose,
}: AnnouncementPublishSheetProps) {
    const [title, setTitle] = useState('');
    const [body, setBody] = useState('');
    const [confirmationPolicy, setConfirmationPolicy] = useState<CircleAnnouncementConfirmationPolicy>('none');
    const [policyPickerOpen, setPolicyPickerOpen] = useState(false);
    const [pinned, setPinned] = useState(false);
    const [pinnedUntilIso, setPinnedUntilIso] = useState<string | null>(null);
    const [pinnedUntilPickerOpen, setPinnedUntilPickerOpen] = useState(false);
    const [publishing, setPublishing] = useState(false);

    useEffect(() => {
        if (!open) return;
        setTitle('');
        setBody('');
        setConfirmationPolicy('none');
        setPolicyPickerOpen(false);
        setPinned(false);
        setPinnedUntilIso(null);
        setPinnedUntilPickerOpen(false);
        onError(null);
    }, [onError, open]);

    if (!open) return null;

    const submitDisabled = publishing || !senderPubkey || !title.trim() || !body.trim();

    const handleSubmit = async () => {
        if (submitDisabled || !senderPubkey) return;
        setPublishing(true);
        onError(null);
        try {
            const response = await publishCircleAnnouncement({
                circleId,
                senderPubkey,
                discussionAccessToken,
                title,
                body,
                confirmationPolicy,
                pinPriority: pinned ? 1 : 0,
                pinnedUntil: pinned ? pinnedUntilIso : null,
            });
            await onPublished(response.announcement);
            onClose();
        } catch (error) {
            onError(formatAnnouncementPublishError(error, copy));
        } finally {
            setPublishing(false);
        }
    };

    const policyOptions = (['none', 'read', 'explicit_confirm'] as CircleAnnouncementConfirmationPolicy[]).map((policy) => ({
        value: policy,
        label: copy.policies[policy],
    }));

    return (
        <>
            <div className={styles.announcementSheetOverlay}>
                <section className={styles.announcementSheet} aria-label={copy.publish}>
                    <header className={styles.announcementSheetHeader}>
                        <h3>{copy.publish}</h3>
                        <button type="button" className={styles.interactionFieldSheetClose} onClick={onClose} aria-label={copy.close}>
                            <X size={16} />
                        </button>
                    </header>
                    <div className={styles.announcementPublishForm}>
                        <label>
                            <span>{copy.titleLabel}</span>
                            <input value={title} onChange={(event) => setTitle(event.target.value)} maxLength={160} />
                        </label>
                        <label>
                            <span>{copy.bodyLabel}</span>
                            <textarea value={body} onChange={(event) => setBody(event.target.value)} rows={5} />
                        </label>
                        <fieldset className={styles.announcementFieldset}>
                            <legend>{copy.policyLabel}</legend>
                            <button
                                type="button"
                                className={styles.announcementPickerButton}
                                aria-haspopup="dialog"
                                aria-expanded={policyPickerOpen}
                                onClick={() => setPolicyPickerOpen(true)}
                            >
                                <span>{copy.policyLabel}</span>
                                <strong>{copy.policies[confirmationPolicy]}</strong>
                            </button>
                        </fieldset>
                        <button
                            type="button"
                            className={`${styles.announcementToggleButton} ${pinned ? styles.announcementToggleButtonActive : ''}`}
                            onClick={() => setPinned((value) => !value)}
                            aria-pressed={pinned}
                        >
                            {copy.pinnedLabel}
                        </button>
                        {pinned && (
                            <fieldset className={styles.announcementFieldset}>
                                <legend>{copy.pinnedUntilLabel}</legend>
                                <button
                                    type="button"
                                    className={styles.announcementPickerButton}
                                    aria-haspopup="dialog"
                                    aria-expanded={pinnedUntilPickerOpen}
                                    onClick={() => setPinnedUntilPickerOpen(true)}
                                >
                                    <span>{copy.pinnedUntilLabel}</span>
                                    <strong>{formatDateTimeSummary(pinnedUntilIso, copy.pinnedUntilUnset)}</strong>
                                </button>
                            </fieldset>
                        )}
                        <p className={styles.announcementFormHint}>{copy.visibilityLabel}</p>
                        <p className={styles.announcementFormHint}>{copy.notificationPreview}</p>
                        {errorMessage && (
                            <p className={styles.announcementError}>{errorMessage}</p>
                        )}
                        <div className={styles.announcementDetailActions}>
                            <button type="button" className={styles.announcementSecondaryButton} onClick={onClose} disabled={publishing}>
                                {copy.cancel}
                            </button>
                            <button type="button" className={styles.announcementPrimaryButton} onClick={handleSubmit} disabled={submitDisabled}>
                                {publishing ? copy.publishing : copy.publish}
                            </button>
                        </div>
                    </div>
                </section>
            </div>
            <OptionPickerSheet
                open={policyPickerOpen}
                title={copy.policyLabel}
                closeLabel={copy.close}
                value={confirmationPolicy}
                options={policyOptions}
                onChange={setConfirmationPolicy}
                onClose={() => setPolicyPickerOpen(false)}
            />
            <DateTimePickerSheet
                open={pinnedUntilPickerOpen}
                title={copy.pinnedUntilLabel}
                closeLabel={copy.close}
                confirmLabel={copy.pickerConfirm}
                clearLabel={copy.pinnedUntilClear}
                dateLabel={copy.dateLabel}
                timeLabel={copy.timeLabel}
                valueIso={pinnedUntilIso}
                presets={[
                    {
                        label: copy.pinnedUntilToday,
                        getValue: () => createPinnedUntilPresetDate(0),
                    },
                    {
                        label: copy.pinnedUntilTomorrow,
                        getValue: () => createPinnedUntilPresetDate(1),
                    },
                ]}
                onChange={setPinnedUntilIso}
                onClose={() => setPinnedUntilPickerOpen(false)}
            />
        </>
    );
}

function createPinnedUntilPresetDate(daysFromNow: number): Date {
    const target = new Date();
    target.setDate(target.getDate() + daysFromNow);
    target.setHours(23, 59, 0, 0);
    return target;
}

function formatAnnouncementPublishError(error: unknown, copy: CircleAnnouncementCopy): string {
    const typedError = error as Error & { code?: string; status?: number };
    const message = error instanceof Error ? error.message : '';
    const code = typeof typedError.code === 'string' ? typedError.code : '';
    const status = typeof typedError.status === 'number' ? typedError.status : null;
    if (code === 'announcement_author_role_required' || message.includes('announcement_author_role_required')) {
        return copy.publishPermissionRequired;
    }
    if ((status !== null && status >= 500) || isBackendInternalAnnouncementError(message)) {
        return copy.publishFailed;
    }
    return message || copy.publishFailed;
}

function isBackendInternalAnnouncementError(message: string): boolean {
    return /Internal Server Error|Prisma|Invalid [`'"]/.test(message);
}
