'use client';

import { Inbox, Megaphone } from 'lucide-react';
import styles from '@/app/(main)/circles/[id]/page.module.css';
import { useAnnouncementSeen } from './useAnnouncementSeen.ts';
import type { CircleAnnouncementCopy } from './announcementCopy.ts';
import type { CircleAnnouncementDetailDto } from './types.ts';

export interface AnnouncementFloatingPanelProps {
    open: boolean;
    announcement: CircleAnnouncementDetailDto | null;
    count: number;
    loading: boolean;
    copy: CircleAnnouncementCopy;
    senderPubkey: string | null;
    discussionAccessToken?: string | null;
    onOpen: (announcementId: string) => void;
    onOpenCenter: () => void;
    onSeen: (announcement: CircleAnnouncementDetailDto) => void;
}

export default function AnnouncementFloatingPanel({
    open,
    announcement,
    count,
    loading,
    copy,
    senderPubkey,
    discussionAccessToken,
    onOpen,
    onOpenCenter,
    onSeen,
}: AnnouncementFloatingPanelProps) {
    const seenRef = useAnnouncementSeen<HTMLDivElement>({
        announcement,
        senderPubkey,
        discussionAccessToken,
        enabled: open,
        onSeen,
    });

    if (!open) return null;

    const status = announcement?.myReceipt?.status ?? 'none';
    const needsConfirm = Boolean(
        announcement
        && announcement.confirmationPolicy === 'explicit_confirm'
        && status !== 'confirmed',
    );

    return (
        <div className={styles.announcementPanelFloating} role="region" aria-label={copy.centerTitle}>
            {announcement ? (
                <div ref={seenRef} className={styles.announcementPanelContent}>
                    <button
                        type="button"
                        className={styles.announcementPanelMain}
                        onClick={() => onOpen(announcement.announcementId)}
                    >
                        <span className={styles.announcementPanelIcon} aria-hidden="true">
                            <Megaphone size={15} />
                        </span>
                        <span className={styles.announcementPanelText}>
                            <span className={styles.announcementPanelTitle}>{announcement.title}</span>
                            {announcement.body.trim() && (
                                <span className={styles.announcementPanelBody}>{announcement.body}</span>
                            )}
                            <span className={styles.announcementPanelMeta}>
                                {needsConfirm ? copy.groups.needsConfirmation : copy.receiptStatus[status]} · {announcement.creatorDisplay.effectiveName}
                            </span>
                        </span>
                    </button>
                    <button
                        type="button"
                        className={styles.announcementPanelCenterBtn}
                        onClick={onOpenCenter}
                        aria-label={`${copy.openCenter} · ${copy.totalAnnouncements(count)}`}
                        title={copy.totalAnnouncements(count)}
                    >
                        <Inbox size={15} />
                        <span>{copy.openCenter}</span>
                        <span className={styles.announcementPanelTotal}>{copy.totalAnnouncements(count)}</span>
                    </button>
                </div>
            ) : loading ? (
                <p className={styles.announcementPanelEmpty}>{copy.loading}</p>
            ) : (
                <p className={styles.announcementPanelEmpty}>{copy.empty}</p>
            )}
        </div>
    );
}
