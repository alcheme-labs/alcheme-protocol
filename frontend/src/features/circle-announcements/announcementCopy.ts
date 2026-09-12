import type { CircleAnnouncementConfirmationPolicy, CircleAnnouncementReceiptStatus } from './types.ts';

type Translate = (key: string, values?: Record<string, string | number>) => string;

export interface CircleAnnouncementCopy {
    title: string;
    publish: string;
    publishing: string;
    publishFailed: string;
    publishPermissionRequired: string;
    cancel: string;
    close: string;
    centerTitle: string;
    detailTitle: string;
    titleLabel: string;
    bodyLabel: string;
    policyLabel: string;
    pinnedLabel: string;
    pinnedUntilLabel: string;
    pinnedUntilToday: string;
    pinnedUntilTomorrow: string;
    pinnedUntilClear: string;
    pinnedUntilUnset: string;
    pickerConfirm: string;
    dateLabel: string;
    timeLabel: string;
    visibilityLabel: string;
    notificationPreview: string;
    source: string;
    stats: string;
    status: string;
    publisher: string;
    publishedAt: string;
    viewDetail: string;
    openCenter: string;
    moreAnnouncements: (count: number) => string;
    totalAnnouncements: (count: number) => string;
    markUnread: string;
    markUnreadBusy: string;
    confirm: string;
    confirming: string;
    confirmDisclaimer: string;
    relatedDiscussion: string;
    viewDiscussionRoot: string;
    replyCount: (count: number) => string;
    empty: string;
    loading: string;
    groups: {
        pinned: string;
        needsConfirmation: string;
        unread: string;
        recent: string;
    };
    policies: Record<CircleAnnouncementConfirmationPolicy, string>;
    receiptStatus: Record<CircleAnnouncementReceiptStatus | 'none', string>;
}

export function createAnnouncementCopy(t: Translate): CircleAnnouncementCopy {
    return {
        title: t('announcements.title'),
        publish: t('announcements.publish'),
        publishing: t('announcements.publishing'),
        publishFailed: t('announcements.publishFailed'),
        publishPermissionRequired: t('announcements.publishPermissionRequired'),
        cancel: t('anchoredInteraction.cancel'),
        close: t('anchoredInteraction.cancel'),
        centerTitle: t('announcements.centerTitle'),
        detailTitle: t('announcements.detailTitle'),
        titleLabel: t('announcements.titleLabel'),
        bodyLabel: t('announcements.bodyLabel'),
        policyLabel: t('announcements.policyLabel'),
        pinnedLabel: t('announcements.pinnedLabel'),
        pinnedUntilLabel: t('announcements.pinnedUntilLabel'),
        pinnedUntilToday: t('announcements.pinnedUntilToday'),
        pinnedUntilTomorrow: t('announcements.pinnedUntilTomorrow'),
        pinnedUntilClear: t('announcements.pinnedUntilClear'),
        pinnedUntilUnset: t('announcements.pinnedUntilUnset'),
        pickerConfirm: t('announcements.pickerConfirm'),
        dateLabel: t('announcements.dateLabel'),
        timeLabel: t('announcements.timeLabel'),
        visibilityLabel: t('announcements.visibilityLabel'),
        notificationPreview: t('announcements.notificationPreview'),
        source: t('announcements.source'),
        stats: t('announcements.stats'),
        status: t('announcements.status'),
        publisher: t('announcements.publisher'),
        publishedAt: t('announcements.publishedAt'),
        viewDetail: t('announcements.viewDetail'),
        openCenter: t('announcements.openCenter'),
        moreAnnouncements: (count) => t('announcements.moreAnnouncements', { count }),
        totalAnnouncements: (count) => t('announcements.totalAnnouncements', { count }),
        markUnread: t('announcements.markUnread'),
        markUnreadBusy: t('announcements.markUnreadBusy'),
        confirm: t('announcements.confirm'),
        confirming: t('announcements.confirming'),
        confirmDisclaimer: t('announcements.confirmDisclaimer'),
        relatedDiscussion: t('announcements.relatedDiscussion'),
        viewDiscussionRoot: t('announcements.viewDiscussionRoot'),
        replyCount: (count) => t('announcements.replyCount', { count }),
        empty: t('announcements.empty'),
        loading: t('announcements.loading'),
        groups: {
            pinned: t('announcements.groups.pinned'),
            needsConfirmation: t('announcements.groups.needsConfirmation'),
            unread: t('announcements.groups.unread'),
            recent: t('announcements.groups.recent'),
        },
        policies: {
            none: t('announcements.policies.none'),
            read: t('announcements.policies.read'),
            explicit_confirm: t('announcements.policies.explicitConfirm'),
        },
        receiptStatus: {
            none: t('announcements.receiptStatus.none'),
            unread: t('announcements.receiptStatus.unread'),
            seen: t('announcements.receiptStatus.seen'),
            confirmed: t('announcements.receiptStatus.confirmed'),
        },
    };
}
