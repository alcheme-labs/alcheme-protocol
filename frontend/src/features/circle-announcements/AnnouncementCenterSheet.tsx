'use client';

import { X } from 'lucide-react';
import styles from '@/app/(main)/circles/[id]/page.module.css';
import { useAnnouncementSeen } from './useAnnouncementSeen.ts';
import type { CircleAnnouncementCopy } from './announcementCopy.ts';
import type { CircleAnnouncementDetailDto } from './types.ts';

interface AnnouncementCenterItemProps {
    announcement: CircleAnnouncementDetailDto;
    copy: CircleAnnouncementCopy;
    senderPubkey: string | null;
    discussionAccessToken?: string | null;
    onOpen: (announcementId: string) => void;
    onSeen: (announcement: CircleAnnouncementDetailDto) => void;
}

export interface AnnouncementCenterSheetProps {
    open: boolean;
    announcements: CircleAnnouncementDetailDto[];
    copy: CircleAnnouncementCopy;
    senderPubkey: string | null;
    discussionAccessToken?: string | null;
    onOpen: (announcementId: string) => void;
    onClose: () => void;
    onSeen: (announcement: CircleAnnouncementDetailDto) => void;
}

function AnnouncementCenterItem({
    announcement,
    copy,
    senderPubkey,
    discussionAccessToken,
    onOpen,
    onSeen,
}: AnnouncementCenterItemProps) {
    const seenRef = useAnnouncementSeen<HTMLButtonElement>({
        announcement,
        senderPubkey,
        discussionAccessToken,
        onSeen,
    });
    const status = announcement.myReceipt?.status ?? 'none';
    return (
        <button
            ref={seenRef}
            type="button"
            className={styles.announcementCenterItem}
            onClick={() => onOpen(announcement.announcementId)}
        >
            <span className={styles.announcementCenterItemTitle}>{announcement.title}</span>
            {announcement.body.trim() && (
                <span className={styles.announcementCenterItemBody}>{announcement.body}</span>
            )}
            <span className={styles.announcementCenterItemMeta}>
                {copy.receiptStatus[status]} · {announcement.creatorDisplay.effectiveName}
            </span>
        </button>
    );
}

export default function AnnouncementCenterSheet({
    open,
    announcements,
    copy,
    senderPubkey,
    discussionAccessToken,
    onOpen,
    onClose,
    onSeen,
}: AnnouncementCenterSheetProps) {
    if (!open) return null;
    const usedIds = new Set<string>();
    const takeGroup = (predicate: (item: CircleAnnouncementDetailDto) => boolean) => {
        const items = announcements.filter((item) => !usedIds.has(item.announcementId) && predicate(item));
        for (const item of items) usedIds.add(item.announcementId);
        return items;
    };
    const pinned = takeGroup((item) => item.pinPriority > 0);
    const needsConfirmation = takeGroup((item) =>
        item.confirmationPolicy === 'explicit_confirm' && item.myReceipt?.status !== 'confirmed');
    const unread = takeGroup((item) => item.myReceipt?.status === 'unread' || !item.myReceipt);
    const recent = takeGroup(() => true);
    const groups = [
        [copy.groups.pinned, pinned],
        [copy.groups.needsConfirmation, needsConfirmation],
        [copy.groups.unread, unread],
        [copy.groups.recent, recent],
    ] as const;

    return (
        <div className={styles.announcementSheetOverlay}>
            <section className={styles.announcementSheet} aria-label={copy.centerTitle}>
                <header className={styles.announcementSheetHeader}>
                    <h3>{copy.centerTitle}</h3>
                    <button type="button" className={styles.interactionFieldSheetClose} onClick={onClose} aria-label={copy.close}>
                        <X size={16} />
                    </button>
                </header>
                {announcements.length === 0 ? (
                    <p className={styles.announcementEmpty}>{copy.empty}</p>
                ) : (
                    <div className={styles.announcementCenterGroups}>
                        {groups.map(([label, items]) => items.length > 0 && (
                            <section key={label} className={styles.announcementCenterGroup}>
                                <h4>{label}</h4>
                                {items.map((announcement) => (
                                    <AnnouncementCenterItem
                                        key={announcement.announcementId}
                                        announcement={announcement}
                                        copy={copy}
                                        senderPubkey={senderPubkey}
                                        discussionAccessToken={discussionAccessToken}
                                        onOpen={onOpen}
                                        onSeen={onSeen}
                                    />
                                ))}
                            </section>
                        ))}
                    </div>
                )}
            </section>
        </div>
    );
}
