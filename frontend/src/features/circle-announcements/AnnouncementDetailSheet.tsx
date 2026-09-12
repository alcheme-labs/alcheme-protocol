'use client';

import { X } from 'lucide-react';
import styles from '@/app/(main)/circles/[id]/page.module.css';
import type { CircleAnnouncementCopy } from './announcementCopy.ts';
import type { CircleAnnouncementDetailDto, CircleAnnouncementDiscussionPreviewDto } from './types.ts';

export interface AnnouncementDetailSheetProps {
    open: boolean;
    announcement: CircleAnnouncementDetailDto | null;
    busy: boolean;
    actionBusy: 'mark-unread' | 'confirm' | null;
    copy: CircleAnnouncementCopy;
    onClose: () => void;
    onMarkUnread: (announcementId: string) => void;
    onConfirm: (announcementId: string) => void;
    onOpenDiscussionRoot: (envelopeId: string) => void;
}

export default function AnnouncementDetailSheet({
    open,
    announcement,
    busy,
    actionBusy,
    copy,
    onClose,
    onMarkUnread,
    onConfirm,
    onOpenDiscussionRoot,
}: AnnouncementDetailSheetProps) {
    if (!open) return null;
    const status = announcement?.myReceipt?.status ?? 'none';
    const canMarkUnread = Boolean(announcement?.myReceipt?.firstSeenAt && status !== 'confirmed');
    const canConfirm = Boolean(announcement?.confirmationPolicy === 'explicit_confirm' && status !== 'confirmed');
    const source = announcement?.sourceLinks[0] ?? null;
    const relatedDiscussion = normalizeDiscussionPreview(announcement?.latestDiscussionPreview);

    return (
        <div className={styles.announcementSheetOverlay}>
            <section className={styles.announcementSheet} aria-label={copy.detailTitle}>
                <header className={styles.announcementSheetHeader}>
                    <h3>{copy.detailTitle}</h3>
                    <button type="button" className={styles.interactionFieldSheetClose} onClick={onClose} aria-label={copy.close}>
                        <X size={16} />
                    </button>
                </header>
                {busy && !announcement ? (
                    <p className={styles.announcementEmpty}>{copy.loading}</p>
                ) : announcement ? (
                    <div className={styles.announcementDetailBody}>
                        <div className={styles.announcementDetailTitleBlock}>
                            <span className={styles.announcementDetailStatus}>{copy.receiptStatus[status]}</span>
                            <h4>{announcement.title}</h4>
                            <p>{announcement.body}</p>
                        </div>
                        <dl className={styles.announcementDetailMetaGrid}>
                            <div>
                                <dt>{copy.publisher}</dt>
                                <dd>{announcement.creatorDisplay.effectiveName}</dd>
                            </div>
                            <div>
                                <dt>{copy.publishedAt}</dt>
                                <dd>{formatDate(announcement.publishedAt)}</dd>
                            </div>
                            <div>
                                <dt>{copy.policyLabel}</dt>
                                <dd>{copy.policies[announcement.confirmationPolicy]}</dd>
                            </div>
                            <div>
                                <dt>{copy.stats}</dt>
                                <dd>
                                    {announcement.stats.reachedCount}/{announcement.stats.reachedCount + announcement.stats.unreachedCount}
                                    {' · '}
                                    {announcement.stats.confirmedCount}
                                </dd>
                            </div>
                        </dl>
                        {source && (
                            <p className={styles.announcementSourceLine}>
                                {copy.source}: {source.sourceType} · {source.sourceRef}
                            </p>
                        )}
                        <section className={styles.announcementRelatedDiscussion}>
                            <div className={styles.announcementRelatedDiscussionHeader}>
                                <span>{copy.relatedDiscussion}</span>
                                <span>{copy.replyCount(Math.max(0, Number(announcement.discussionReplyCount || 0)))}</span>
                            </div>
                            {relatedDiscussion.length > 0 && (
                                <div className={styles.announcementRelatedDiscussionList}>
                                    {relatedDiscussion.map((item) => (
                                        <button
                                            key={item.envelopeId}
                                            type="button"
                                            className={styles.announcementRelatedDiscussionItem}
                                            onClick={() => onOpenDiscussionRoot(item.envelopeId)}
                                        >
                                            <span className={styles.announcementRelatedDiscussionMeta}>
                                                <span>{item.senderDisplay.effectiveName || 'A member'}</span>
                                                <span>{formatDate(item.clientTimestamp)}</span>
                                            </span>
                                            <span className={styles.announcementRelatedDiscussionText}>{item.text}</span>
                                        </button>
                                    ))}
                                </div>
                            )}
                            <button
                                type="button"
                                className={styles.announcementSecondaryButton}
                                onClick={() => onOpenDiscussionRoot(announcement.discussionRootEnvelopeId)}
                            >
                                {copy.viewDiscussionRoot}
                            </button>
                        </section>
                        {canConfirm && (
                            <p className={styles.announcementDisclaimer}>{copy.confirmDisclaimer}</p>
                        )}
                        <div className={styles.announcementDetailActions}>
                            {canMarkUnread && (
                                <button
                                    type="button"
                                    className={styles.announcementSecondaryButton}
                                    onClick={() => onMarkUnread(announcement.announcementId)}
                                    disabled={actionBusy !== null}
                                >
                                    {actionBusy === 'mark-unread' ? copy.markUnreadBusy : copy.markUnread}
                                </button>
                            )}
                            {canConfirm && (
                                <button
                                    type="button"
                                    className={styles.announcementPrimaryButton}
                                    onClick={() => onConfirm(announcement.announcementId)}
                                    disabled={actionBusy !== null}
                                >
                                    {actionBusy === 'confirm' ? copy.confirming : copy.confirm}
                                </button>
                            )}
                        </div>
                    </div>
                ) : (
                    <p className={styles.announcementEmpty}>{copy.empty}</p>
                )}
            </section>
        </div>
    );
}

function formatDate(value: string): string {
    const parsed = new Date(value);
    if (Number.isNaN(parsed.getTime())) return value;
    return parsed.toLocaleString();
}

function normalizeDiscussionPreview(value: CircleAnnouncementDetailDto['latestDiscussionPreview'] | null | undefined): CircleAnnouncementDiscussionPreviewDto[] {
    if (!Array.isArray(value)) return [];
    return value.filter((item): item is CircleAnnouncementDiscussionPreviewDto => (
        Boolean(item)
        && typeof item.envelopeId === 'string'
        && typeof item.senderPubkey === 'string'
        && Boolean(item.senderDisplay)
        && typeof item.senderDisplay.effectiveName === 'string'
        && typeof item.text === 'string'
        && typeof item.clientTimestamp === 'string'
    ));
}
