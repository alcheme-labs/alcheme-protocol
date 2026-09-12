import type { PrismaClient } from '@prisma/client';

import type { AppLocale } from '../../../i18n/locale';
import {
    resolveCircleActorDisplays,
    type CircleActorDisplay,
    type CircleActorDisplayRef,
} from '../../identity/circleActorDisplay';
import {
    toDiscussionAnchoredInteractionDto,
    type DiscussionAnchoredInteractionDto,
    type DiscussionAnchoredInteractionRow,
} from './types';
import { hydrateAnchoredInteractionDisplays } from './store';
import {
    applySnapshotDisplayFields,
    snapshotFromRow,
} from './displaySnapshots';

const MAX_DETAIL_EVENTS = 64;
const MAX_DETAIL_RECEIPTS = 50;
const MAX_TEXT_PREVIEW = 280;
const MAX_PAYLOAD_JSON = 2_000;

type AnchoredInteractionPrisma = PrismaClient | any;

export interface AnchoredInteractionDetailEvent {
    eventId: string;
    actorPubkey: string | null;
    actorDisplayName?: string | null;
    actorCircleAlias?: string | null;
    actorEffectiveDisplayName?: string | null;
    actorDisplaySource?: string | null;
    actorDisplayCircleId?: number | null;
    actorDisplaySnapshot?: string | null;
    actorDisplaySourceSnapshot?: string | null;
    actorDisplayCircleIdSnapshot?: number | null;
    actorInheritedFromCircleIdSnapshot?: number | null;
    actorDisplaySnapshotAt?: string | null;
    actorAliasSnapshot?: string | null;
    eventKind: string;
    payload: Record<string, unknown>;
    createdAt: string;
}

export interface AnchoredInteractionDetailReceipt {
    receiptId: string;
    receiptType: string;
    status: string;
    actorPubkey: string;
    actorDisplayName?: string | null;
    actorCircleAlias?: string | null;
    actorEffectiveDisplayName?: string | null;
    actorDisplaySource?: string | null;
    actorDisplayCircleId?: number | null;
    actorDisplaySnapshot?: string | null;
    actorDisplaySourceSnapshot?: string | null;
    actorDisplayCircleIdSnapshot?: number | null;
    actorInheritedFromCircleIdSnapshot?: number | null;
    actorDisplaySnapshotAt?: string | null;
    actorAliasSnapshot?: string | null;
    actorNeedsDisplayDisambiguation?: boolean;
    actorDisplayCollisionCount?: number;
    recipientPubkey: string | null;
    recipientDisplayName?: string | null;
    recipientCircleAlias?: string | null;
    recipientEffectiveDisplayName?: string | null;
    recipientDisplaySource?: string | null;
    recipientDisplayCircleId?: number | null;
    recipientDisplaySnapshot?: string | null;
    recipientDisplaySourceSnapshot?: string | null;
    recipientDisplayCircleIdSnapshot?: number | null;
    recipientInheritedFromCircleIdSnapshot?: number | null;
    recipientDisplaySnapshotAt?: string | null;
    recipientAliasSnapshot?: string | null;
    recipientNeedsDisplayDisambiguation?: boolean;
    recipientDisplayCollisionCount?: number;
    assetType: string | null;
    mint?: string | null;
    amount: string | null;
    signature?: string | null;
    createdAt?: string;
    updatedAt?: string;
}

export interface AnchoredInteractionDetailMessagePreview {
    envelopeId: string;
    author: string | null;
    text: string;
    createdAt?: string;
}

export interface AnchoredInteractionDetailDto {
    interaction: DiscussionAnchoredInteractionDto;
    sourceMessage: AnchoredInteractionDetailMessagePreview | null;
    resultNotice: AnchoredInteractionDetailMessagePreview | null;
    events: AnchoredInteractionDetailEvent[];
    receipts: AnchoredInteractionDetailReceipt[];
    sections: Array<'anchor' | 'participation' | 'result' | 'receipts' | 'actions'>;
}

export async function readAnchoredInteractionDetail(
    prisma: AnchoredInteractionPrisma,
    input: {
        circleId: number;
        interactionId: string;
        locale?: AppLocale | string;
    },
): Promise<AnchoredInteractionDetailDto | null> {
    const interaction = await prisma.discussionAnchoredInteraction.findUnique({
        where: { interactionId: input.interactionId },
    });
    if (!interaction || interaction.circleId !== input.circleId) return null;

    const [events, receipts, sourceMessage, resultNotice] = await Promise.all([
        prisma.discussionAnchoredInteractionEvent.findMany({
            where: {
                circleId: input.circleId,
                interactionId: input.interactionId,
            },
            orderBy: { id: 'asc' },
            take: MAX_DETAIL_EVENTS,
        }),
        prisma.discussionAnchoredInteractionReceipt.findMany({
            where: {
                circleId: input.circleId,
                interactionId: input.interactionId,
            },
            orderBy: { createdAt: 'desc' },
            take: MAX_DETAIL_RECEIPTS,
        }),
        interaction.anchorType === 'discussion_message'
            ? prisma.circleDiscussionMessage.findFirst({
                where: {
                    circleId: input.circleId,
                    envelopeId: interaction.anchorRef,
                },
            })
            : Promise.resolve(null),
        interaction.resultNoticeEnvelopeId
            ? prisma.circleDiscussionMessage.findFirst({
                where: {
                    circleId: input.circleId,
                    envelopeId: interaction.resultNoticeEnvelopeId,
                },
            })
            : Promise.resolve(null),
    ]);

    const detail = await buildAnchoredInteractionDetail({
        interaction: toDiscussionAnchoredInteractionDto(interaction as DiscussionAnchoredInteractionRow),
        events: events.map(mapEventRow),
        receipts: receipts.map(mapReceiptRow),
        sourceMessage: sourceMessage ? mapMessageRow(sourceMessage) : null,
        resultNotice: resultNotice ? mapMessageRow(resultNotice) : null,
    });
    return hydrateAnchoredInteractionDetailDisplays(prisma, {
        detail,
        circleId: input.circleId,
        locale: input.locale,
    });
}

export async function buildAnchoredInteractionDetail(input: {
    interaction: DiscussionAnchoredInteractionDto;
    events: Array<{
        eventId: string;
        actorPubkey: string | null;
        eventKind: string;
        payload: Record<string, unknown>;
        createdAt: Date | string;
    } & Partial<AnchoredInteractionDetailEvent>>;
    receipts?: AnchoredInteractionDetailReceipt[];
    sourceMessage?: AnchoredInteractionDetailMessagePreview | null;
    resultNotice?: AnchoredInteractionDetailMessagePreview | null;
}): Promise<AnchoredInteractionDetailDto> {
    return {
        interaction: input.interaction,
        sourceMessage: input.sourceMessage ? normalizeMessagePreview(input.sourceMessage) : null,
        resultNotice: input.resultNotice ? normalizeMessagePreview(input.resultNotice) : null,
        events: input.events.slice(0, MAX_DETAIL_EVENTS).map((event) => ({
            eventId: event.eventId,
            actorPubkey: event.actorPubkey,
            actorDisplaySnapshot: event.actorDisplaySnapshot ?? null,
            actorDisplaySourceSnapshot: event.actorDisplaySourceSnapshot ?? null,
            actorDisplayCircleIdSnapshot: event.actorDisplayCircleIdSnapshot ?? null,
            actorInheritedFromCircleIdSnapshot: event.actorInheritedFromCircleIdSnapshot ?? null,
            actorDisplaySnapshotAt: event.actorDisplaySnapshotAt ?? null,
            actorAliasSnapshot: event.actorAliasSnapshot ?? null,
            eventKind: event.eventKind,
            payload: boundPayload(event.payload),
            createdAt: toIsoString(event.createdAt),
        })),
        receipts: (input.receipts || []).slice(0, MAX_DETAIL_RECEIPTS).map(normalizeReceipt),
        sections: ['anchor', 'participation', 'result', 'receipts', 'actions'],
    };
}

function mapEventRow(row: any): AnchoredInteractionDetailEvent {
    return {
        eventId: String(row.eventId || ''),
        actorPubkey: typeof row.actorPubkey === 'string' ? row.actorPubkey : null,
        actorDisplaySnapshot: typeof row.actorDisplaySnapshot === 'string' ? row.actorDisplaySnapshot : null,
        actorDisplaySourceSnapshot: typeof row.actorDisplaySourceSnapshot === 'string' ? row.actorDisplaySourceSnapshot : null,
        actorDisplayCircleIdSnapshot: typeof row.actorDisplayCircleIdSnapshot === 'number' ? row.actorDisplayCircleIdSnapshot : null,
        actorInheritedFromCircleIdSnapshot: typeof row.actorInheritedFromCircleIdSnapshot === 'number' ? row.actorInheritedFromCircleIdSnapshot : null,
        actorDisplaySnapshotAt: row.actorDisplaySnapshotAt ? toIsoString(row.actorDisplaySnapshotAt) : null,
        actorAliasSnapshot: typeof row.actorAliasSnapshot === 'string' ? row.actorAliasSnapshot : null,
        eventKind: String(row.eventKind || ''),
        payload: normalizeRecord(row.payload),
        createdAt: toIsoString(row.createdAt),
    };
}

function mapReceiptRow(row: any): AnchoredInteractionDetailReceipt {
    return normalizeReceipt({
        receiptId: row.receiptId,
        receiptType: row.receiptType,
        status: row.status,
        actorPubkey: row.actorPubkey,
        actorDisplaySnapshot: row.actorDisplaySnapshot,
        actorDisplaySourceSnapshot: row.actorDisplaySourceSnapshot,
        actorDisplayCircleIdSnapshot: row.actorDisplayCircleIdSnapshot,
        actorInheritedFromCircleIdSnapshot: row.actorInheritedFromCircleIdSnapshot,
        actorDisplaySnapshotAt: row.actorDisplaySnapshotAt,
        actorAliasSnapshot: row.actorAliasSnapshot,
        actorNeedsDisplayDisambiguation: Boolean(row.metadata?.displaySnapshots?.actor?.needsDisplayDisambiguation),
        actorDisplayCollisionCount: Number(row.metadata?.displaySnapshots?.actor?.displayCollisionCount ?? 1),
        recipientPubkey: row.recipientPubkey,
        recipientDisplaySnapshot: row.recipientDisplaySnapshot,
        recipientDisplaySourceSnapshot: row.recipientDisplaySourceSnapshot,
        recipientDisplayCircleIdSnapshot: row.recipientDisplayCircleIdSnapshot,
        recipientInheritedFromCircleIdSnapshot: row.recipientInheritedFromCircleIdSnapshot,
        recipientDisplaySnapshotAt: row.recipientDisplaySnapshotAt,
        recipientAliasSnapshot: row.recipientAliasSnapshot,
        recipientNeedsDisplayDisambiguation: Boolean(row.metadata?.displaySnapshots?.recipient?.needsDisplayDisambiguation),
        recipientDisplayCollisionCount: Number(row.metadata?.displaySnapshots?.recipient?.displayCollisionCount ?? 1),
        assetType: row.assetType,
        mint: row.mint,
        amount: row.amount,
        signature: row.signature,
        createdAt: row.createdAt,
        updatedAt: row.updatedAt,
    });
}

function mapMessageRow(row: any): AnchoredInteractionDetailMessagePreview {
    return normalizeMessagePreview({
        envelopeId: String(row.envelopeId || ''),
        author: typeof row.senderHandle === 'string' && row.senderHandle
            ? row.senderHandle
            : null,
        text: typeof row.payloadText === 'string' ? row.payloadText : '',
        createdAt: row.createdAt ? toIsoString(row.createdAt) : undefined,
    });
}

interface DetailDisplayAssignment {
    displayKey: string;
    pubkey: string | null;
    circleId: number | null;
    apply(display: CircleActorDisplay): void;
}

export async function hydrateAnchoredInteractionDetailDisplays(
    prisma: AnchoredInteractionPrisma,
    input: {
        detail: AnchoredInteractionDetailDto;
        circleId: number;
        locale?: AppLocale | string;
    },
): Promise<AnchoredInteractionDetailDto> {
    const [interaction] = await hydrateAnchoredInteractionDisplays(prisma, {
        interactions: [input.detail.interaction],
        locale: input.locale,
    });
    const events = input.detail.events.map((event) => ({ ...event }));
    const receipts = input.detail.receipts.map((receipt) => ({ ...receipt }));
    const assignments: DetailDisplayAssignment[] = [];

    for (const event of events) {
        if (!event.actorPubkey) continue;
        const actorSnapshot = snapshotFromRow(event as unknown as Record<string, unknown>, 'actor');
        if (actorSnapshot) {
            applySnapshotDisplayFields(event as unknown as Record<string, unknown>, 'actor', actorSnapshot);
            continue;
        }
        const displayKey = `detail:${input.detail.interaction.interactionId}:event:${event.eventId}:actor`;
        assignments.push({
            displayKey,
            pubkey: event.actorPubkey,
            circleId: input.circleId,
            apply: (display) => applyDisplayFields(event as unknown as Record<string, unknown>, 'actor', display),
        });
    }
    for (const receipt of receipts) {
        const actorSnapshot = snapshotFromRow(receipt as unknown as Record<string, unknown>, 'actor');
        if (actorSnapshot) {
            applySnapshotDisplayFields(receipt as unknown as Record<string, unknown>, 'actor', actorSnapshot);
        } else {
            const actorKey = `detail:${input.detail.interaction.interactionId}:receipt:${receipt.receiptId}:actor`;
            assignments.push({
                displayKey: actorKey,
                pubkey: receipt.actorPubkey,
                circleId: input.circleId,
                apply: (display) => applyDisplayFields(receipt as unknown as Record<string, unknown>, 'actor', display),
            });
        }
        if (receipt.recipientPubkey) {
            const recipientSnapshot = snapshotFromRow(receipt as unknown as Record<string, unknown>, 'recipient');
            if (recipientSnapshot) {
                applySnapshotDisplayFields(receipt as unknown as Record<string, unknown>, 'recipient', recipientSnapshot);
                continue;
            }
            const recipientKey = `detail:${input.detail.interaction.interactionId}:receipt:${receipt.receiptId}:recipient`;
            assignments.push({
                displayKey: recipientKey,
                pubkey: receipt.recipientPubkey,
                circleId: input.circleId,
                apply: (display) => applyDisplayFields(receipt as unknown as Record<string, unknown>, 'recipient', display),
            });
        }
    }

    await applyDetailDisplayAssignments(prisma, assignments, input.locale);
    return {
        ...input.detail,
        interaction: interaction ?? input.detail.interaction,
        events,
        receipts,
    };
}

function normalizeMessagePreview(
    message: AnchoredInteractionDetailMessagePreview,
): AnchoredInteractionDetailMessagePreview {
    return {
        envelopeId: message.envelopeId,
        author: message.author,
        text: truncateText(message.text),
        ...(message.createdAt ? { createdAt: message.createdAt } : {}),
    };
}

function normalizeReceipt(receipt: AnchoredInteractionDetailReceipt): AnchoredInteractionDetailReceipt {
    return {
        receiptId: String(receipt.receiptId || ''),
        receiptType: String(receipt.receiptType || ''),
        status: String(receipt.status || 'pending'),
        actorPubkey: String(receipt.actorPubkey || ''),
        actorDisplaySnapshot: typeof receipt.actorDisplaySnapshot === 'string' ? receipt.actorDisplaySnapshot : null,
        actorDisplaySourceSnapshot: typeof receipt.actorDisplaySourceSnapshot === 'string' ? receipt.actorDisplaySourceSnapshot : null,
        actorDisplayCircleIdSnapshot: typeof receipt.actorDisplayCircleIdSnapshot === 'number' ? receipt.actorDisplayCircleIdSnapshot : null,
        actorInheritedFromCircleIdSnapshot: typeof receipt.actorInheritedFromCircleIdSnapshot === 'number' ? receipt.actorInheritedFromCircleIdSnapshot : null,
        actorDisplaySnapshotAt: receipt.actorDisplaySnapshotAt ? toIsoString(receipt.actorDisplaySnapshotAt) : null,
        actorAliasSnapshot: typeof receipt.actorAliasSnapshot === 'string' ? receipt.actorAliasSnapshot : null,
        actorNeedsDisplayDisambiguation: Boolean(receipt.actorNeedsDisplayDisambiguation),
        actorDisplayCollisionCount: Number(receipt.actorDisplayCollisionCount || 1),
        recipientPubkey: typeof receipt.recipientPubkey === 'string' ? receipt.recipientPubkey : null,
        recipientDisplaySnapshot: typeof receipt.recipientDisplaySnapshot === 'string' ? receipt.recipientDisplaySnapshot : null,
        recipientDisplaySourceSnapshot: typeof receipt.recipientDisplaySourceSnapshot === 'string' ? receipt.recipientDisplaySourceSnapshot : null,
        recipientDisplayCircleIdSnapshot: typeof receipt.recipientDisplayCircleIdSnapshot === 'number' ? receipt.recipientDisplayCircleIdSnapshot : null,
        recipientInheritedFromCircleIdSnapshot: typeof receipt.recipientInheritedFromCircleIdSnapshot === 'number' ? receipt.recipientInheritedFromCircleIdSnapshot : null,
        recipientDisplaySnapshotAt: receipt.recipientDisplaySnapshotAt ? toIsoString(receipt.recipientDisplaySnapshotAt) : null,
        recipientAliasSnapshot: typeof receipt.recipientAliasSnapshot === 'string' ? receipt.recipientAliasSnapshot : null,
        recipientNeedsDisplayDisambiguation: Boolean(receipt.recipientNeedsDisplayDisambiguation),
        recipientDisplayCollisionCount: Number(receipt.recipientDisplayCollisionCount || 1),
        assetType: typeof receipt.assetType === 'string' ? receipt.assetType : null,
        ...(receipt.mint ? { mint: receipt.mint } : {}),
        amount: typeof receipt.amount === 'string' ? receipt.amount : null,
        ...(receipt.signature ? { signature: receipt.signature } : {}),
        ...(receipt.createdAt ? { createdAt: toIsoString(receipt.createdAt) } : {}),
        ...(receipt.updatedAt ? { updatedAt: toIsoString(receipt.updatedAt) } : {}),
    };
}

async function applyDetailDisplayAssignments(
    prisma: AnchoredInteractionPrisma,
    assignments: DetailDisplayAssignment[],
    locale: AppLocale | string = 'en',
): Promise<void> {
    if (assignments.length === 0) return;
    const displayPrisma = prisma?.user?.findMany
        ? prisma
        : { user: { findMany: async () => [] } };
    const displays = await resolveCircleActorDisplays({
        prisma: displayPrisma,
        actors: assignments.map((assignment): CircleActorDisplayRef => ({
            displayKey: assignment.displayKey,
            pubkey: assignment.pubkey,
            circleId: assignment.circleId,
        })),
        mode: 'current',
        locale,
    });
    for (const assignment of assignments) {
        const display = displays.get(assignment.displayKey);
        if (display) assignment.apply(display);
    }
}

function applyDisplayFields(
    record: Record<string, unknown>,
    prefix: 'actor' | 'recipient',
    display: CircleActorDisplay,
): void {
    record[`${prefix}DisplayName`] = display.globalDisplayName;
    record[`${prefix}CircleAlias`] = display.circleAlias;
    record[`${prefix}EffectiveDisplayName`] = display.effectiveName;
    record[`${prefix}DisplaySource`] = display.displaySource;
    record[`${prefix}DisplayCircleId`] = display.displayCircleId;
}

function boundPayload(payload: Record<string, unknown>): Record<string, unknown> {
    const normalized = normalizeRecord(payload);
    const json = JSON.stringify(normalized);
    if (json.length <= MAX_PAYLOAD_JSON) return normalized;
    return {
        truncated: true,
        preview: json.slice(0, MAX_PAYLOAD_JSON),
    };
}

function normalizeRecord(value: unknown): Record<string, unknown> {
    return value && typeof value === 'object' && !Array.isArray(value)
        ? value as Record<string, unknown>
        : {};
}

function truncateText(value: string): string {
    if (value.length <= MAX_TEXT_PREVIEW) return value;
    return `${value.slice(0, MAX_TEXT_PREVIEW)}...`;
}

function toIsoString(value: Date | string | undefined): string {
    if (!value) return new Date(0).toISOString();
    return value instanceof Date ? value.toISOString() : new Date(value).toISOString();
}
