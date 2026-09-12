'use client';

import { Megaphone } from 'lucide-react';
import styles from '@/app/(main)/circles/[id]/page.module.css';
import { useAnnouncementSeen } from './useAnnouncementSeen.ts';
import type { CircleAnnouncementDetailDto } from './types.ts';

export interface AnnouncementInlineNoticeCardProps {
    title: string;
    bodyPreview: string;
    publisher: string;
    publishedTime: string;
    viewDetailLabel: string;
    announcement?: CircleAnnouncementDetailDto | null;
    senderPubkey?: string | null;
    discussionAccessToken?: string | null;
    onOpen: () => void;
    onSeen?: (announcement: CircleAnnouncementDetailDto) => void;
}

export default function AnnouncementInlineNoticeCard({
    title,
    bodyPreview,
    publisher,
    publishedTime,
    viewDetailLabel,
    announcement = null,
    senderPubkey = null,
    discussionAccessToken = null,
    onOpen,
    onSeen,
}: AnnouncementInlineNoticeCardProps) {
    const seenRef = useAnnouncementSeen<HTMLDivElement>({
        announcement,
        senderPubkey,
        discussionAccessToken,
        enabled: Boolean(announcement),
        onSeen,
    });

    return (
        <div ref={seenRef} className={styles.announcementInlineNotice}>
            <div className={styles.announcementInlineIcon} aria-hidden="true">
                <Megaphone size={15} />
            </div>
            <div className={styles.announcementInlineBody}>
                <div className={styles.announcementInlineMeta}>
                    <span>{publisher}</span>
                    <span>{publishedTime}</span>
                </div>
                <div className={styles.announcementInlineTitle}>{title}</div>
                {bodyPreview && (
                    <p className={styles.announcementInlineText}>{bodyPreview}</p>
                )}
                <button
                    type="button"
                    data-msg-action="1"
                    className={styles.announcementTextButton}
                    onClick={onOpen}
                >
                    {viewDetailLabel}
                </button>
            </div>
        </div>
    );
}
