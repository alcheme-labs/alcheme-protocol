import {
    resolveCircleActorDisplays,
    type CircleActorDisplay,
} from '../../identity/circleActorDisplay';
import { localizeQueryApiCopy } from '../../../i18n/copy';
import { sha256Hex } from '../../offchainDiscussion';
import {
    CircleAnnouncementPermissionError,
    requireCircleAnnouncementAuthorRole,
    resolveCircleAnnouncementReadAccess,
    resolveCircleAnnouncementRoleAccess,
} from './permissions';
import { writeAnnouncementDiscussionFact } from './discussionFactWriter';
import { loadAnnouncementDiscussionProjection } from './discussionProjection';
import type {
    CircleAnnouncementActorInput,
    CircleAnnouncementConfirmationPolicy,
    CircleAnnouncementDetailDto,
    CircleAnnouncementDisplaySnapshot,
    CircleAnnouncementListDto,
    CircleAnnouncementPublishInput,
    CircleAnnouncementReceiptDto,
    CircleAnnouncementReceiptStatus,
    CircleAnnouncementSourceDto,
    CircleAnnouncementStatsDto,
    CircleAnnouncementViewerCapabilities,
} from './types';

export { CircleAnnouncementPermissionError as AnnouncementPermissionError };

const DEFAULT_LOCALE = 'en';

interface ActiveCircleAnnouncementMember {
    userId: number;
    pubkey: string;
}

export async function publishCircleAnnouncement(
    prisma: any,
    input: CircleAnnouncementPublishInput,
): Promise<CircleAnnouncementDetailDto> {
    const now = input.now ?? new Date();
    const actorPubkey = input.actor.pubkey;
    const title = normalizeRequiredText(input.title, 'announcement_title_required', 160);
    const body = normalizeRequiredText(input.body, 'announcement_body_required', 10_000);
    const confirmationPolicy = normalizeConfirmationPolicy(input.confirmationPolicy);
    const clientNonce = normalizeText(input.clientNonce) ?? sha256Hex(`${actorPubkey}:${now.toISOString()}`).slice(0, 24);
    const primarySourceType = normalizeText(input.primarySourceType) ?? 'manual_publish';
    const primarySourceRef = normalizeText(input.primarySourceRef) ?? `manual:${actorPubkey}:${clientNonce}`;
    const pinPriority = typeof input.pinPriority === 'number' && Number.isFinite(input.pinPriority)
        ? Math.max(0, Math.floor(input.pinPriority))
        : 0;

    const access = await requireCircleAnnouncementAuthorRole({
        circleId: input.circleId,
        actor: input.actor,
    });
    const activeMembers = await loadActiveCircleMembers(prisma, input.circleId);
    const activeMemberPubkeys = activeMembers.map((member) => member.pubkey);
    const displayMap = await resolveCircleActorDisplays({
        prisma,
        actors: [
            { displayKey: 'creator', pubkey: actorPubkey, circleId: input.circleId },
            ...activeMemberPubkeys.map((pubkey) => ({ displayKey: `receipt:${pubkey}`, pubkey, circleId: input.circleId })),
        ],
        mode: 'current',
        locale: input.locale ?? DEFAULT_LOCALE,
    });
    const creatorDisplay = displayMap.get('creator') ?? null;
    const announcementId = buildAnnouncementId({
        circleId: input.circleId,
        primarySourceType,
        primarySourceRef,
    });
    const projectionDigest = buildProjectionDigest({
        title,
        body,
        confirmationPolicy,
        primarySourceType,
        primarySourceRef,
        pinPriority,
        pinnedUntil: input.pinnedUntil ? input.pinnedUntil.toISOString() : null,
    });
    const existingAnnouncement = await prisma.circleAnnouncement.findUnique({
        where: { announcementId },
    });
    if (existingAnnouncement) {
        if (existingAnnouncement.projectionDigest === projectionDigest) {
            await ensureAnnouncementNotifications(prisma, {
                announcementId,
                circleId: input.circleId,
                title: existingAnnouncement.title,
                confirmationPolicy: normalizeConfirmationPolicy(existingAnnouncement.confirmationPolicy),
                pinPriority: Number(existingAnnouncement.pinPriority || 0),
                primarySourceEnvelopeId: existingAnnouncement.primarySourceEnvelopeId ?? null,
                activeMembers,
                now,
                locale: input.locale ?? DEFAULT_LOCALE,
            });
            return readCircleAnnouncementDetail(prisma, {
                circleId: input.circleId,
                announcementId,
                actor: input.actor,
                locale: input.locale,
            });
        }
        throw new CircleAnnouncementPermissionError('announcement_source_conflict', 409);
    }

    await prisma.$transaction(async (tx: any) => {
        const fact = await writeAnnouncementDiscussionFact(tx, {
            circleId: input.circleId,
            announcementId,
            actorPubkey,
            senderHandle: access.user?.handle ?? null,
            sessionId: input.sessionId ?? null,
            title,
            body,
            confirmationPolicy,
            pinPriority,
            primarySourceType,
            primarySourceRef,
            primarySourceEnvelopeId: input.primarySourceEnvelopeId ?? null,
            now,
        });
        await tx.circleAnnouncement.upsert({
            where: { announcementId },
            create: {
                announcementId,
                circleId: input.circleId,
                primarySourceType,
                primarySourceRef,
                primarySourceEnvelopeId: input.primarySourceEnvelopeId ?? null,
                discussionRootEnvelopeId: fact.envelopeId,
                discussionReplyCount: 0,
                latestDiscussionPreview: [],
                title,
                body,
                status: 'active',
                confirmationPolicy,
                discussionPolicy: 'open',
                visibilityScope: 'current_circle',
                audienceDigest: sha256Hex(`current_circle:${input.circleId}`),
                pinPriority,
                pinnedUntil: input.pinnedUntil ?? null,
                publishedAt: now,
                expiresAt: null,
                archivedAt: null,
                creatorPubkey: actorPubkey,
                ...displayCreateFields('creator', creatorDisplay, now),
                correctedFromId: null,
                projectionVersion: 1,
                projectionDigest,
                metadata: {
                    clientNonce,
                    factPayloadHash: fact.payloadHash,
                    factSignedMessage: fact.signedMessage,
                },
                createdAt: now,
                updatedAt: now,
            },
            update: {
                discussionRootEnvelopeId: fact.envelopeId,
                title,
                body,
                confirmationPolicy,
                pinPriority,
                pinnedUntil: input.pinnedUntil ?? null,
                projectionVersion: { increment: 1 },
                projectionDigest,
                metadata: {
                    clientNonce,
                    factPayloadHash: fact.payloadHash,
                    factSignedMessage: fact.signedMessage,
                },
                updatedAt: now,
            },
        });
        await tx.circleAnnouncementSource.create({
            data: {
                announcementId,
                sourceType: primarySourceType,
                sourceRef: primarySourceRef,
                sourceCircleId: input.circleId,
                sourceEnvelopeId: input.primarySourceEnvelopeId ?? null,
                sourceDigest: sha256Hex(`${primarySourceType}:${primarySourceRef}`),
                createdAt: now,
            },
        });
        if (confirmationPolicy === 'read' || confirmationPolicy === 'explicit_confirm') {
            for (const actorPubkey of activeMemberPubkeys) {
                await upsertReceipt(tx, {
                    announcementId,
                    circleId: input.circleId,
                    actorPubkey,
                    status: 'unread',
                    now,
                    display: displayMap.get(`receipt:${actorPubkey}`) ?? null,
                    preserveConfirmed: true,
                });
            }
        }
    });

    await ensureAnnouncementNotifications(prisma, {
        announcementId,
        circleId: input.circleId,
        title,
        confirmationPolicy,
        pinPriority,
        primarySourceEnvelopeId: input.primarySourceEnvelopeId ?? null,
        activeMembers,
        now,
        locale: input.locale ?? DEFAULT_LOCALE,
    });

    return readCircleAnnouncementDetail(prisma, {
        circleId: input.circleId,
        announcementId,
        actor: input.actor,
        locale: input.locale,
    });
}

export async function listCircleAnnouncements(
    prisma: any,
    input: { circleId: number; actor: CircleAnnouncementPublishInput['actor']; locale?: string },
): Promise<CircleAnnouncementListDto> {
    await resolveCircleAnnouncementReadAccess(input);
    const rows = await prisma.circleAnnouncement.findMany({
        where: {
            circleId: input.circleId,
            status: 'active',
        },
        orderBy: [
            { pinPriority: 'desc' },
            { publishedAt: 'desc' },
        ],
        take: 50,
    });
    const viewerCapabilities = await resolveViewerCapabilities(prisma, input);
    const announcements = await Promise.all(rows.map((row: any) => buildAnnouncementDetail(prisma, {
        row,
        actorPubkey: input.actor.pubkey,
        locale: input.locale,
        viewerCapabilities,
    })));
    return {
        circleId: input.circleId,
        announcements,
        viewerCapabilities,
    };
}

export async function readCircleAnnouncementDetail(
    prisma: any,
    input: { circleId: number; announcementId: string; actor: CircleAnnouncementPublishInput['actor']; locale?: string },
): Promise<CircleAnnouncementDetailDto> {
    await resolveCircleAnnouncementReadAccess(input);
    const row = await prisma.circleAnnouncement.findUnique({
        where: { announcementId: input.announcementId },
    });
    if (!row || row.circleId !== input.circleId || row.status !== 'active') {
        throw new CircleAnnouncementPermissionError('announcement_not_found', 404);
    }
    return buildAnnouncementDetail(prisma, {
        row,
        actorPubkey: input.actor.pubkey,
        locale: input.locale,
        viewerCapabilities: await resolveViewerCapabilities(prisma, input),
    });
}

export async function markCircleAnnouncementSeen(
    prisma: any,
    input: CircleAnnouncementActorInput,
): Promise<CircleAnnouncementDetailDto> {
    const { row, display } = await resolveVisibleAnnouncementAndActorDisplay(prisma, input);
    const actorPubkey = input.actor.pubkey;
    const current = await findReceipt(prisma, input.announcementId, actorPubkey);
    const now = input.now ?? new Date();
    await upsertReceipt(prisma, {
        announcementId: input.announcementId,
        circleId: input.circleId,
        actorPubkey,
        status: current?.status === 'confirmed' ? 'confirmed' : 'seen',
        now,
        display,
        firstSeenAt: current?.firstSeenAt ?? now,
        lastSeenAt: now,
        preserveConfirmed: true,
    });
    return readCircleAnnouncementDetail(prisma, {
        circleId: input.circleId,
        announcementId: row.announcementId,
        actor: input.actor,
        locale: input.locale,
    });
}

export async function markCircleAnnouncementUnread(
    prisma: any,
    input: CircleAnnouncementActorInput,
): Promise<CircleAnnouncementDetailDto> {
    const { row, display } = await resolveVisibleAnnouncementAndActorDisplay(prisma, input);
    const actorPubkey = input.actor.pubkey;
    const current = await findReceipt(prisma, input.announcementId, actorPubkey);
    const now = input.now ?? new Date();
    await upsertReceipt(prisma, {
        announcementId: input.announcementId,
        circleId: input.circleId,
        actorPubkey,
        status: current?.status === 'confirmed' ? 'confirmed' : 'unread',
        now,
        display,
        firstSeenAt: current?.firstSeenAt ?? null,
        lastSeenAt: current?.lastSeenAt ?? null,
        markedUnreadAt: current?.status === 'confirmed' ? current.markedUnreadAt ?? null : now,
        confirmedAt: current?.confirmedAt ?? null,
        confirmationText: current?.confirmationText ?? null,
        preserveConfirmed: true,
    });
    return readCircleAnnouncementDetail(prisma, {
        circleId: input.circleId,
        announcementId: row.announcementId,
        actor: input.actor,
        locale: input.locale,
    });
}

export async function confirmCircleAnnouncement(
    prisma: any,
    input: CircleAnnouncementActorInput & { confirmationText?: string | null },
): Promise<CircleAnnouncementDetailDto> {
    const { row, display } = await resolveVisibleAnnouncementAndActorDisplay(prisma, input);
    const actorPubkey = input.actor.pubkey;
    const current = await findReceipt(prisma, input.announcementId, actorPubkey);
    const now = input.now ?? new Date();
    await upsertReceipt(prisma, {
        announcementId: input.announcementId,
        circleId: input.circleId,
        actorPubkey,
        status: 'confirmed',
        now,
        display,
        firstSeenAt: current?.firstSeenAt ?? now,
        lastSeenAt: now,
        confirmedAt: now,
        confirmationText: normalizeText(input.confirmationText),
        preserveConfirmed: false,
    });
    return readCircleAnnouncementDetail(prisma, {
        circleId: input.circleId,
        announcementId: row.announcementId,
        actor: input.actor,
        locale: input.locale,
    });
}

async function resolveVisibleAnnouncementAndActorDisplay(
    prisma: any,
    input: CircleAnnouncementActorInput,
): Promise<{ row: any; display: CircleActorDisplay | null }> {
    await resolveCircleAnnouncementReadAccess(input);
    const row = await prisma.circleAnnouncement.findUnique({
        where: { announcementId: input.announcementId },
    });
    if (!row || row.circleId !== input.circleId || row.status !== 'active') {
        throw new CircleAnnouncementPermissionError('announcement_not_found', 404);
    }
    const displays = await resolveCircleActorDisplays({
        prisma,
        actors: [{ displayKey: 'actor', pubkey: input.actor.pubkey, circleId: input.circleId }],
        mode: 'current',
        locale: input.locale ?? DEFAULT_LOCALE,
    });
    return { row, display: displays.get('actor') ?? null };
}

async function buildAnnouncementDetail(
    prisma: any,
    input: {
        row: any;
        actorPubkey: string;
        locale?: string;
        viewerCapabilities: CircleAnnouncementViewerCapabilities;
    },
): Promise<CircleAnnouncementDetailDto> {
    const [receipts, sources, discussionProjection] = await Promise.all([
        prisma.circleAnnouncementReceipt.findMany({ where: { announcementId: input.row.announcementId } }),
        prisma.circleAnnouncementSource.findMany({ where: { announcementId: input.row.announcementId } }),
        loadAnnouncementDiscussionProjection(prisma, {
            circleId: input.row.circleId,
            rootEnvelopeId: input.row.discussionRootEnvelopeId,
            locale: input.locale ?? DEFAULT_LOCALE,
        }),
    ]);
    const myReceipt = receipts.find((receipt: any) => receipt.actorPubkey === input.actorPubkey) ?? null;
    const activeMemberCount = await countActiveMembers(prisma, input.row.circleId);
    const stats = buildStats(receipts, activeMemberCount);
    return {
        announcementId: input.row.announcementId,
        circleId: input.row.circleId,
        primarySourceType: input.row.primarySourceType,
        primarySourceRef: input.row.primarySourceRef,
        primarySourceEnvelopeId: input.row.primarySourceEnvelopeId ?? null,
        discussionRootEnvelopeId: input.row.discussionRootEnvelopeId,
        discussionReplyCount: discussionProjection.discussionReplyCount,
        latestDiscussionPreview: discussionProjection.latestDiscussionPreview,
        title: input.row.title,
        body: input.row.body,
        status: input.row.status,
        confirmationPolicy: input.row.confirmationPolicy,
        discussionPolicy: input.row.discussionPolicy,
        visibilityScope: input.row.visibilityScope,
        audienceDigest: input.row.audienceDigest ?? null,
        pinPriority: Number(input.row.pinPriority || 0),
        pinnedUntil: toIso(input.row.pinnedUntil),
        publishedAt: toIso(input.row.publishedAt) ?? new Date(0).toISOString(),
        expiresAt: toIso(input.row.expiresAt),
        archivedAt: toIso(input.row.archivedAt),
        creatorPubkey: input.row.creatorPubkey,
        creatorDisplay: displaySnapshotFromRow('creator', input.row),
        correctedFromId: input.row.correctedFromId ?? null,
        projectionVersion: Number(input.row.projectionVersion || 1),
        projectionDigest: input.row.projectionDigest,
        metadata: input.row.metadata ?? {},
        myReceipt: myReceipt ? receiptToDto(myReceipt) : null,
        stats,
        sourceLinks: sources.map(sourceToDto),
        viewerCapabilities: input.viewerCapabilities,
    };
}

async function upsertReceipt(
    prisma: any,
    input: {
        announcementId: string;
        circleId: number;
        actorPubkey: string;
        status: CircleAnnouncementReceiptStatus;
        now: Date;
        display: CircleActorDisplay | null;
        firstSeenAt?: Date | null;
        lastSeenAt?: Date | null;
        markedUnreadAt?: Date | null;
        confirmedAt?: Date | null;
        confirmationText?: string | null;
        preserveConfirmed: boolean;
    },
): Promise<any> {
    const existing = await findReceipt(prisma, input.announcementId, input.actorPubkey);
    const nextStatus = input.preserveConfirmed && existing?.status === 'confirmed'
        ? 'confirmed'
        : input.status;
    return prisma.circleAnnouncementReceipt.upsert({
        where: {
            announcementId_actorPubkey: {
                announcementId: input.announcementId,
                actorPubkey: input.actorPubkey,
            },
        },
        create: {
            receiptId: buildReceiptId(input.announcementId, input.actorPubkey),
            announcementId: input.announcementId,
            circleId: input.circleId,
            actorPubkey: input.actorPubkey,
            ...displayCreateFields('actor', input.display, input.now),
            status: nextStatus,
            firstSeenAt: input.firstSeenAt ?? null,
            lastSeenAt: input.lastSeenAt ?? null,
            markedUnreadAt: input.markedUnreadAt ?? null,
            confirmedAt: input.confirmedAt ?? null,
            confirmationText: input.confirmationText ?? null,
            notificationId: null,
            metadata: {},
            createdAt: input.now,
            updatedAt: input.now,
        },
        update: {
            ...displayCreateFields('actor', input.display, input.now),
            status: nextStatus,
            firstSeenAt: input.firstSeenAt ?? existing?.firstSeenAt ?? null,
            lastSeenAt: input.lastSeenAt ?? existing?.lastSeenAt ?? null,
            markedUnreadAt: input.markedUnreadAt ?? existing?.markedUnreadAt ?? null,
            confirmedAt: input.confirmedAt ?? existing?.confirmedAt ?? null,
            confirmationText: input.confirmationText ?? existing?.confirmationText ?? null,
            updatedAt: input.now,
        },
    });
}

async function findReceipt(prisma: any, announcementId: string, actorPubkey: string): Promise<any | null> {
    return prisma.circleAnnouncementReceipt.findUnique({
        where: {
            announcementId_actorPubkey: {
                announcementId,
                actorPubkey,
            },
        },
    });
}

async function loadActiveCircleMembers(prisma: any, circleId: number): Promise<ActiveCircleAnnouncementMember[]> {
    const rows = await prisma.circleMember.findMany({
        where: { circleId, status: 'Active' },
        select: { userId: true, user: { select: { pubkey: true } } },
    });
    const members: ActiveCircleAnnouncementMember[] = rows
        .map((row: any) => ({
            userId: Number(row.userId),
            pubkey: normalizeText(row.user?.pubkey),
        }))
        .filter((member: { userId: number; pubkey: string | null }): member is ActiveCircleAnnouncementMember => (
            Number.isSafeInteger(member.userId) && member.userId > 0 && Boolean(member.pubkey)
        ));
    const seenUserIds = new Set<number>();
    return members.filter((member: ActiveCircleAnnouncementMember) => {
        if (seenUserIds.has(member.userId)) return false;
        seenUserIds.add(member.userId);
        return true;
    });
}

async function ensureAnnouncementNotifications(
    prisma: any,
    input: {
        announcementId: string;
        circleId: number;
        title: string;
        confirmationPolicy: CircleAnnouncementConfirmationPolicy;
        pinPriority: number;
        primarySourceEnvelopeId: string | null;
        activeMembers: ActiveCircleAnnouncementMember[];
        now: Date;
        locale?: string;
    },
): Promise<void> {
    if (!shouldCreateAnnouncementNotifications(input)) {
        return;
    }
    const recipients = input.activeMembers.filter((member) => Number.isSafeInteger(member.userId) && member.userId > 0);
    if (recipients.length === 0) return;

    try {
        const existing = await prisma.notification.findMany({
            where: {
                userId: { in: recipients.map((member) => member.userId) },
                sourceType: 'announcement',
                sourceId: input.announcementId,
            },
            select: { userId: true },
        });
        const existingUserIds = new Set(existing.map((row: any) => Number(row.userId)).filter(Number.isSafeInteger));
        const missingRecipients = recipients.filter((member) => !existingUserIds.has(member.userId));
        const notificationTitle = localizeQueryApiCopy(
            input.confirmationPolicy === 'explicit_confirm'
                ? 'announcement.notificationConfirmTitle'
                : 'announcement.notificationTitle',
            input.locale ?? DEFAULT_LOCALE,
        );
        for (const member of missingRecipients) {
            await prisma.notification.create({
                data: {
                    userId: member.userId,
                    type: 'announcement',
                    title: notificationTitle,
                    body: input.title,
                    metadata: buildAnnouncementNotificationMetadata(input),
                    sourceType: 'announcement',
                    sourceId: input.announcementId,
                    circleId: input.circleId,
                    read: false,
                    createdAt: input.now,
                },
            });
        }
        await writeAnnouncementNotificationStatus(prisma, input.announcementId, {
            status: 'created',
            createdCount: missingRecipients.length,
            recipientCount: recipients.length,
        }, input.now).catch(() => undefined);
    } catch (error) {
        await writeAnnouncementNotificationStatus(prisma, input.announcementId, {
            status: 'failed',
            code: compactErrorCode(error),
        }, input.now).catch(() => undefined);
    }
}

function shouldCreateAnnouncementNotifications(input: {
    confirmationPolicy: CircleAnnouncementConfirmationPolicy;
    pinPriority: number;
}): boolean {
    return input.confirmationPolicy === 'read'
        || input.confirmationPolicy === 'explicit_confirm'
        || (input.confirmationPolicy === 'none' && input.pinPriority > 0);
}

function buildAnnouncementNotificationMetadata(input: {
    title: string;
    confirmationPolicy: CircleAnnouncementConfirmationPolicy;
    primarySourceEnvelopeId: string | null;
}): Record<string, unknown> {
    return {
        messageKey: 'announcement.published',
        announcementTitle: input.title,
        confirmationPolicy: input.confirmationPolicy,
        sourceEnvelopeId: input.primarySourceEnvelopeId,
        params: {
            announcementTitle: input.title,
            confirmationPolicy: input.confirmationPolicy,
            sourceEnvelopeId: input.primarySourceEnvelopeId,
        },
    };
}

async function writeAnnouncementNotificationStatus(
    prisma: any,
    announcementId: string,
    notificationStatus: Record<string, unknown>,
    now: Date,
): Promise<void> {
    const row = await prisma.circleAnnouncement.findUnique({ where: { announcementId } });
    if (!row) return;
    const metadata = row.metadata && typeof row.metadata === 'object' && !Array.isArray(row.metadata)
        ? row.metadata as Record<string, unknown>
        : {};
    await prisma.circleAnnouncement.update({
        where: { announcementId },
        data: {
            metadata: {
                ...metadata,
                notificationStatus,
            },
            updatedAt: now,
        },
    });
}

function compactErrorCode(error: unknown): string {
    const candidate = error && typeof error === 'object' && 'code' in error
        ? String((error as { code?: unknown }).code || '')
        : '';
    if (/^[a-z0-9_:-]{1,64}$/i.test(candidate)) {
        return candidate;
    }
    return 'notification_insert_failed';
}

async function countActiveMembers(prisma: any, circleId: number): Promise<number> {
    const rows = await prisma.circleMember.findMany({
        where: { circleId, status: 'Active' },
        select: { userId: true },
    });
    return rows.length;
}

async function resolveViewerCapabilities(
    prisma: any,
    input: { circleId: number; actor: CircleAnnouncementPublishInput['actor'] },
): Promise<CircleAnnouncementViewerCapabilities> {
    const access = await resolveCircleAnnouncementRoleAccess(input);
    return {
        canPublish: access.canPublish,
        canManage: access.canManage,
    };
}

function buildStats(receipts: any[], activeMemberCount: number): CircleAnnouncementStatsDto {
    const reachedCount = receipts.filter((receipt) => receipt.firstSeenAt || receipt.status === 'seen' || receipt.status === 'confirmed').length;
    const confirmedCount = receipts.filter((receipt) => receipt.status === 'confirmed').length;
    const markedUnreadCount = receipts.filter((receipt) => receipt.status === 'unread' && receipt.markedUnreadAt).length;
    return {
        reachedCount,
        unreachedCount: Math.max(0, activeMemberCount - reachedCount),
        markedUnreadCount,
        confirmedCount,
    };
}

function displayCreateFields(prefix: 'creator' | 'actor', display: CircleActorDisplay | null, now: Date): Record<string, unknown> {
    return {
        [`${prefix}DisplaySnapshot`]: display?.effectiveName ?? null,
        [`${prefix}DisplaySourceSnapshot`]: display?.displaySource ?? null,
        [`${prefix}DisplayCircleIdSnapshot`]: display?.displayCircleId ?? null,
        [`${prefix}InheritedFromCircleIdSnapshot`]: display?.inheritedFromCircleId ?? null,
        [`${prefix}DisplaySnapshotAt`]: display ? now : null,
        [`${prefix}AliasSnapshot`]: display?.circleAlias ?? null,
    };
}

function displaySnapshotFromRow(prefix: 'creator' | 'actor', row: any): CircleAnnouncementDisplaySnapshot {
    return {
        effectiveName: row[`${prefix}DisplaySnapshot`] ?? 'A member',
        displaySource: row[`${prefix}DisplaySourceSnapshot`] ?? 'generic_member',
        displayCircleId: row[`${prefix}DisplayCircleIdSnapshot`] ?? null,
        inheritedFromCircleId: row[`${prefix}InheritedFromCircleIdSnapshot`] ?? null,
        alias: row[`${prefix}AliasSnapshot`] ?? null,
        snapshotAt: toIso(row[`${prefix}DisplaySnapshotAt`]),
    };
}

function receiptToDto(row: any): CircleAnnouncementReceiptDto {
    return {
        receiptId: row.receiptId,
        announcementId: row.announcementId,
        circleId: row.circleId,
        actorPubkey: row.actorPubkey,
        actorDisplay: displaySnapshotFromRow('actor', row),
        status: row.status,
        firstSeenAt: toIso(row.firstSeenAt),
        lastSeenAt: toIso(row.lastSeenAt),
        markedUnreadAt: toIso(row.markedUnreadAt),
        confirmedAt: toIso(row.confirmedAt),
        confirmationText: row.confirmationText ?? null,
        notificationId: row.notificationId ?? null,
        metadata: row.metadata ?? {},
    };
}

function sourceToDto(row: any): CircleAnnouncementSourceDto {
    return {
        sourceType: row.sourceType,
        sourceRef: row.sourceRef,
        sourceCircleId: row.sourceCircleId ?? null,
        sourceEnvelopeId: row.sourceEnvelopeId ?? null,
        sourceDigest: row.sourceDigest ?? null,
    };
}

function normalizeConfirmationPolicy(value: unknown): CircleAnnouncementConfirmationPolicy {
    const normalized = normalizeText(value) ?? 'none';
    if (normalized === 'read' || normalized === 'explicit_confirm') return normalized;
    return 'none';
}

function normalizeRequiredText(value: unknown, code: string, maxLength: number): string {
    const normalized = normalizeText(value);
    if (!normalized) {
        throw new CircleAnnouncementPermissionError(code, 400);
    }
    return normalized.slice(0, maxLength);
}

function normalizeText(value: unknown): string | null {
    const normalized = typeof value === 'string' ? value.trim() : '';
    return normalized || null;
}

function buildAnnouncementId(input: { circleId: number; primarySourceType: string; primarySourceRef: string }): string {
    return `ann_${sha256Hex(`${input.circleId}:${input.primarySourceType}:${input.primarySourceRef}`).slice(0, 40)}`;
}

function buildReceiptId(announcementId: string, actorPubkey: string): string {
    return `ann_rcpt_${sha256Hex(`${announcementId}:${actorPubkey}`).slice(0, 40)}`;
}

function buildProjectionDigest(value: unknown): string {
    return sha256Hex(stableStringify(value));
}

function stableStringify(value: unknown): string {
    if (!value || typeof value !== 'object') return JSON.stringify(value);
    if (Array.isArray(value)) return `[${value.map((item) => stableStringify(item)).join(',')}]`;
    const record = value as Record<string, unknown>;
    return `{${Object.keys(record).sort().map((key) => `${JSON.stringify(key)}:${stableStringify(record[key])}`).join(',')}}`;
}

function toIso(value: unknown): string | null {
    if (!value) return null;
    if (value instanceof Date) return value.toISOString();
    const parsed = new Date(String(value));
    return Number.isNaN(parsed.getTime()) ? null : parsed.toISOString();
}
