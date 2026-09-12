import type { AppLocale } from '../../../i18n/locale';
import type { CircleActor } from '../../auth/actor';

export type CircleAnnouncementConfirmationPolicy = 'none' | 'read' | 'explicit_confirm';
export type CircleAnnouncementStatus = 'active' | 'archived' | 'expired';
export type CircleAnnouncementReceiptStatus = 'unread' | 'seen' | 'confirmed';

export interface CircleAnnouncementDisplaySnapshot {
    effectiveName: string;
    displaySource: string;
    displayCircleId: number | null;
    inheritedFromCircleId: number | null;
    alias: string | null;
    snapshotAt: string | null;
}

export interface CircleAnnouncementReceiptDto {
    receiptId: string;
    announcementId: string;
    circleId: number;
    actorPubkey: string;
    actorDisplay: CircleAnnouncementDisplaySnapshot;
    status: CircleAnnouncementReceiptStatus;
    firstSeenAt: string | null;
    lastSeenAt: string | null;
    markedUnreadAt: string | null;
    confirmedAt: string | null;
    confirmationText: string | null;
    notificationId: number | null;
    metadata: unknown;
}

export interface CircleAnnouncementStatsDto {
    reachedCount: number;
    unreachedCount: number;
    markedUnreadCount: number;
    confirmedCount: number;
}

export interface CircleAnnouncementViewerCapabilities {
    canPublish: boolean;
    canManage: boolean;
}

export interface CircleAnnouncementSourceDto {
    sourceType: string;
    sourceRef: string;
    sourceCircleId: number | null;
    sourceEnvelopeId: string | null;
    sourceDigest: string | null;
}

export interface CircleAnnouncementDiscussionPreviewDto {
    envelopeId: string;
    senderPubkey: string;
    senderHandle: string | null;
    senderDisplay: CircleAnnouncementDisplaySnapshot;
    text: string;
    clientTimestamp: string;
}

export interface CircleAnnouncementDetailDto {
    announcementId: string;
    circleId: number;
    primarySourceType: string;
    primarySourceRef: string;
    primarySourceEnvelopeId: string | null;
    discussionRootEnvelopeId: string;
    discussionReplyCount: number;
    latestDiscussionPreview: CircleAnnouncementDiscussionPreviewDto[];
    title: string;
    body: string;
    status: CircleAnnouncementStatus;
    confirmationPolicy: CircleAnnouncementConfirmationPolicy;
    discussionPolicy: string;
    visibilityScope: string;
    audienceDigest: string | null;
    pinPriority: number;
    pinnedUntil: string | null;
    publishedAt: string;
    expiresAt: string | null;
    archivedAt: string | null;
    creatorPubkey: string;
    creatorDisplay: CircleAnnouncementDisplaySnapshot;
    correctedFromId: string | null;
    projectionVersion: number;
    projectionDigest: string;
    metadata: unknown;
    myReceipt: CircleAnnouncementReceiptDto | null;
    stats: CircleAnnouncementStatsDto;
    sourceLinks: CircleAnnouncementSourceDto[];
    viewerCapabilities: CircleAnnouncementViewerCapabilities;
}

export interface CircleAnnouncementListDto {
    circleId: number;
    announcements: CircleAnnouncementDetailDto[];
    viewerCapabilities: CircleAnnouncementViewerCapabilities;
}

export interface CircleAnnouncementPublishInput {
    circleId: number;
    actor: CircleActor;
    sessionId?: string | null;
    title: string;
    body: string;
    confirmationPolicy?: CircleAnnouncementConfirmationPolicy | string | null;
    clientNonce?: string | null;
    pinPriority?: number | null;
    pinnedUntil?: Date | null;
    primarySourceType?: string | null;
    primarySourceRef?: string | null;
    primarySourceEnvelopeId?: string | null;
    now?: Date;
    locale?: AppLocale | string;
}

export interface CircleAnnouncementActorInput {
    circleId: number;
    announcementId: string;
    actor: CircleActor;
    now?: Date;
    locale?: AppLocale | string;
}
