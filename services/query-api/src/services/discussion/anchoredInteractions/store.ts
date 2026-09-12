import { createHash } from 'crypto';
import { Prisma, type PrismaClient } from '@prisma/client';

import type { AppLocale } from '../../../i18n/locale';
import {
    resolveCircleActorDisplays,
    type CircleActorDisplay,
    type CircleActorDisplayRef,
} from '../../identity/circleActorDisplay';
import { projectAnchoredInteraction, type PlazaAnchoredInteractionEventRecord } from './projector';
import {
    validateAnchoredInteractionEventPayload,
    validateAnchoredInteractionInitialState,
} from './eventRegistry';
import {
    applySnapshotDisplayFields,
    resolveAnchoredInteractionDisplaySnapshots,
    snapshotFromRow,
    snapshotToDisplayPayloadFields,
    snapshotToPrismaData,
} from './displaySnapshots';
import {
    getAnchoredInteractionClass,
    normalizeAnchoredInteractionType,
    toDiscussionAnchoredInteractionDto,
    type DiscussionAnchoredInteractionDto,
    type DiscussionAnchoredInteractionRow,
    type PlazaAnchoredInteractionType,
} from './types';

export class AnchoredInteractionInputError extends Error {
    constructor(
        public readonly code: string,
        public readonly statusCode = 400,
    ) {
        super(code);
    }
}

export interface DiscussionAnchoredInteractionsResponse {
    circleId: number;
    count: number;
    watermark: { lastProjectionCursor: number | null };
    interactions: DiscussionAnchoredInteractionDto[];
}

type AnchoredInteractionPrisma = PrismaClient | any;

export async function createAnchoredInteraction(
    prisma: AnchoredInteractionPrisma,
    input: {
        circleId: number;
        anchor: { type: 'discussion_message' | 'freeform'; ref: string };
        interactionType: PlazaAnchoredInteractionType | string;
        createdByPubkey: string;
        clientNonce: string;
        initialState?: Record<string, unknown>;
        initialSummary?: Record<string, unknown>;
        locale?: AppLocale | string;
    },
): Promise<DiscussionAnchoredInteractionDto> {
    const clientNonce = normalizeClientNonce(input.clientNonce);
    const interactionType = normalizeAnchoredInteractionType(input.interactionType);
    if (!interactionType) throw new AnchoredInteractionInputError('unsupported_anchored_interaction_type');
    const anchorRef = normalizeRequiredString(input.anchor.ref, 'invalid_anchor_ref');
    const createdByPubkey = normalizeRequiredString(input.createdByPubkey, 'invalid_created_by_pubkey');
    const rawInitialState = input.initialState || {};
    const initialState = interactionType === 'challenge' || Object.keys(rawInitialState).length > 0
        ? validateAnchoredInteractionInitialState(interactionType, rawInitialState)
        : rawInitialState;
    const interactionId = computeAnchoredInteractionId({
        circleId: input.circleId,
        anchorType: input.anchor.type,
        anchorRef,
        interactionType,
        createdByPubkey,
        clientNonce,
    });
    const eventId = computeAnchoredInteractionEventId({
        circleId: input.circleId,
        interactionId,
        actorPubkey: createdByPubkey,
        eventKind: 'plaza_interaction_created',
        clientNonce,
    });

    const dto = await prisma.$transaction(async (tx: any) => {
        const existing = await tx.discussionAnchoredInteraction.findUnique({
            where: { interactionId },
        });
        if (existing) return toDiscussionAnchoredInteractionDto(existing);

        const created = await tx.discussionAnchoredInteraction.create({
            data: {
                interactionId,
                circleId: input.circleId,
                anchorType: input.anchor.type,
                anchorRef,
                interactionType,
                interactionClass: getAnchoredInteractionClass(interactionType),
                status: 'open',
                projectionVersion: 1,
                resultStatus: 'none',
                resultNoticeEnvelopeId: null,
                state: initialState,
                summary: input.initialSummary || {},
                policyVersion: 'plaza-anchored-interactions-2026-05-28',
                createdByPubkey,
            },
        });
        await tx.discussionAnchoredInteractionEvent.create({
            data: {
                eventId,
                interactionId,
                circleId: input.circleId,
                actorPubkey: createdByPubkey,
                eventKind: 'plaza_interaction_created',
                payload: {},
                clientNonce,
            },
        });
        return toDiscussionAnchoredInteractionDto(created);
    });
    return (await hydrateAnchoredInteractionDisplays(prisma, {
        interactions: [dto],
        locale: input.locale,
    }))[0] ?? dto;
}

export async function appendAnchoredInteractionEvent(
    prisma: AnchoredInteractionPrisma,
    input: {
        circleId: number;
        interactionId: string;
        actorPubkey: string | null;
        eventKind: string;
        payload: Record<string, unknown>;
        clientNonce: string;
        locale?: AppLocale | string;
    },
): Promise<DiscussionAnchoredInteractionDto> {
    const clientNonce = normalizeClientNonce(input.clientNonce);
    const interactionId = normalizeRequiredString(input.interactionId, 'invalid_interaction_id');
    const eventKind = normalizeRequiredString(input.eventKind, 'invalid_event_kind');
    const actorPubkey = input.actorPubkey ? input.actorPubkey.trim() : null;
    const eventId = computeAnchoredInteractionEventId({
        circleId: input.circleId,
        interactionId,
        actorPubkey,
        eventKind,
        clientNonce,
    });

    const dto = await prisma.$transaction(async (tx: any) => {
        await lockAnchoredInteraction(tx, interactionId);
        const interaction = await tx.discussionAnchoredInteraction.findUnique({
            where: { interactionId },
        });
        if (!interaction || interaction.circleId !== input.circleId) {
            throw new AnchoredInteractionInputError('anchored_interaction_not_found', 404);
        }

        const duplicate = await tx.discussionAnchoredInteractionEvent.findUnique({
            where: { eventId },
        });
        if (duplicate) return toDiscussionAnchoredInteractionDto(interaction);
        if (interaction.status !== 'open') {
            throw new AnchoredInteractionInputError('anchored_interaction_not_open', 409);
        }
        const interactionType = normalizeAnchoredInteractionType(interaction.interactionType);
        if (!interactionType) throw new AnchoredInteractionInputError('unsupported_anchored_interaction_type');
        const payload = validateAnchoredInteractionEventPayload(
            interactionType,
            eventKind,
            input.payload || {},
            normalizeRecord(interaction.state),
        );
        const displaySnapshots = shouldSnapshotAnchoredInteractionEvent(eventKind)
            ? await resolveAnchoredInteractionDisplaySnapshots(tx, {
                circleId: input.circleId,
                actorPubkey,
                recipientPubkey: normalizeString(payload.recipientPubkey),
                locale: input.locale,
            })
            : { actor: null, recipient: null };
        const payloadWithSnapshots = {
            ...payload,
            ...snapshotToDisplayPayloadFields('actor', displaySnapshots.actor),
            ...snapshotToDisplayPayloadFields('recipient', displaySnapshots.recipient),
        };

        await tx.discussionAnchoredInteractionEvent.create({
            data: {
                eventId,
                interactionId,
                circleId: input.circleId,
                actorPubkey,
                ...snapshotToPrismaData('actor', displaySnapshots.actor),
                eventKind,
                payload: payloadWithSnapshots,
                clientNonce,
            },
        });

        const events = await tx.discussionAnchoredInteractionEvent.findMany({
            where: { interactionId },
            orderBy: { id: 'asc' },
        });
        const projection = projectAnchoredInteraction({
            interactionType,
            currentState: normalizeRecord(interaction.state),
            events: events.map(mapEventRow),
        });

        const updated = await updateInteractionProjection(tx, {
            interactionId,
            state: projection.state,
            summary: projection.summary,
        });
        return toDiscussionAnchoredInteractionDto(updated);
    });
    return (await hydrateAnchoredInteractionDisplays(prisma, {
        interactions: [dto],
        locale: input.locale,
    }))[0] ?? dto;
}

export async function listAnchoredInteractions(
    prisma: AnchoredInteractionPrisma,
    input: {
        circleId: number;
        afterProjectionCursor?: number | null;
        limit?: number;
        locale?: AppLocale | string;
    },
): Promise<DiscussionAnchoredInteractionsResponse> {
    const cursor = Math.max(0, Math.trunc(input.afterProjectionCursor || 0));
    const limit = Math.min(Math.max(Math.trunc(input.limit || 50), 1), 100);
    const rows: DiscussionAnchoredInteractionRow[] = await prisma.discussionAnchoredInteraction.findMany({
        where: {
            circleId: input.circleId,
            ...(cursor > 0 ? { projectionCursor: { gt: BigInt(cursor) } } : {}),
        },
        orderBy: { projectionCursor: 'asc' },
        take: limit,
    });
    const interactions = await hydrateAnchoredInteractionDisplays(prisma, {
        interactions: rows.map(toDiscussionAnchoredInteractionDto),
        locale: input.locale,
    });
    return {
        circleId: input.circleId,
        count: interactions.length,
        watermark: {
            lastProjectionCursor: interactions.length
                ? Math.max(...interactions.map((interaction) => interaction.projectionCursor))
                : null,
        },
        interactions,
    };
}

export async function lookupAnchoredInteractions(
    prisma: AnchoredInteractionPrisma,
    input: {
        circleId: number;
        interactionIds: string[];
        locale?: AppLocale | string;
    },
): Promise<DiscussionAnchoredInteractionsResponse> {
    const interactionIds = [...new Set(input.interactionIds.map((value) => value.trim()).filter(Boolean))].slice(0, 100);
    if (interactionIds.length === 0) {
        return { circleId: input.circleId, count: 0, watermark: { lastProjectionCursor: null }, interactions: [] };
    }
    const rows: DiscussionAnchoredInteractionRow[] = await prisma.discussionAnchoredInteraction.findMany({
        where: {
            circleId: input.circleId,
            interactionId: { in: interactionIds },
        },
        orderBy: { projectionCursor: 'asc' },
        take: interactionIds.length,
    });
    const interactions = await hydrateAnchoredInteractionDisplays(prisma, {
        interactions: rows.map(toDiscussionAnchoredInteractionDto),
        locale: input.locale,
    });
    return {
        circleId: input.circleId,
        count: interactions.length,
        watermark: {
            lastProjectionCursor: interactions.length
                ? Math.max(...interactions.map((interaction) => interaction.projectionCursor))
                : null,
        },
        interactions,
    };
}

interface DisplayAssignment {
    displayKey: string;
    pubkey: string | null;
    circleId: number | null;
    apply(display: CircleActorDisplay): void;
}

export async function hydrateAnchoredInteractionDisplays(
    prisma: AnchoredInteractionPrisma,
    input: {
        interactions: readonly DiscussionAnchoredInteractionDto[];
        locale?: AppLocale | string;
    },
): Promise<DiscussionAnchoredInteractionDto[]> {
    const assignments: DisplayAssignment[] = [];
    const interactions = input.interactions.map((interaction) => {
        const cloned: DiscussionAnchoredInteractionDto = {
            ...interaction,
            state: cloneValueWithDisplayAssignments(interaction.state, {
                baseKey: `interaction:${interaction.interactionId}:state`,
                circleId: interaction.circleId,
                assignments,
            }) as Record<string, unknown>,
            summary: cloneValueWithDisplayAssignments(interaction.summary, {
                baseKey: `interaction:${interaction.interactionId}:summary`,
                circleId: interaction.circleId,
                assignments,
            }) as Record<string, unknown>,
        };
        const displayKey = `interaction:${interaction.interactionId}:createdBy`;
        assignments.push({
            displayKey,
            pubkey: interaction.createdByPubkey,
            circleId: interaction.circleId,
            apply: (display) => {
                cloned.createdByDisplayName = display.globalDisplayName;
                cloned.createdByCircleAlias = display.circleAlias;
                cloned.createdByEffectiveDisplayName = display.effectiveName;
                cloned.createdByDisplaySource = display.displaySource;
                cloned.createdByDisplayCircleId = display.displayCircleId;
            },
        });
        return cloned;
    });

    await applyDisplayAssignments(prisma, assignments, input.locale);
    return interactions;
}

function cloneValueWithDisplayAssignments(
    value: unknown,
    context: {
        baseKey: string;
        circleId: number;
        assignments: DisplayAssignment[];
    },
): unknown {
    if (Array.isArray(value)) {
        return value.map((item, index) => cloneValueWithDisplayAssignments(item, {
            ...context,
            baseKey: `${context.baseKey}:${index}`,
        }));
    }
    if (!value || typeof value !== 'object') return value;

    const record = value as Record<string, unknown>;
    const cloned: Record<string, unknown> = {};
    const actorSnapshot = snapshotFromRow(record, 'actor');
    const actorPubkey = normalizeString(record.actorPubkey);
    if (actorSnapshot) {
        applySnapshotDisplayFields(cloned, 'actor', actorSnapshot);
    } else if (actorPubkey) {
        const displayKey = `${context.baseKey}:actor`;
        context.assignments.push({
            displayKey,
            pubkey: actorPubkey,
            circleId: context.circleId,
            apply: (display) => applyDisplayFields(cloned, 'actor', display),
        });
    }
    const recipientSnapshot = snapshotFromRow(record, 'recipient');
    const recipientPubkey = normalizeString(record.recipientPubkey);
    if (recipientSnapshot) {
        applySnapshotDisplayFields(cloned, 'recipient', recipientSnapshot);
    } else if (recipientPubkey) {
        const displayKey = `${context.baseKey}:recipient`;
        context.assignments.push({
            displayKey,
            pubkey: recipientPubkey,
            circleId: context.circleId,
            apply: (display) => applyDisplayFields(cloned, 'recipient', display),
        });
    }

    for (const [key, raw] of Object.entries(record)) {
        cloned[key] = cloneValueWithDisplayAssignments(raw, {
            ...context,
            baseKey: `${context.baseKey}:${key}`,
        });
    }
    return cloned;
}

async function applyDisplayAssignments(
    prisma: AnchoredInteractionPrisma,
    assignments: DisplayAssignment[],
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

function normalizeString(value: unknown): string | null {
    return typeof value === 'string' && value.trim() ? value.trim() : null;
}

function shouldSnapshotAnchoredInteractionEvent(eventKind: string): boolean {
    return eventKind === 'tip_transfer_initiated'
        || eventKind === 'tip_transfer_recorded'
        || eventKind === 'tip_transfer_failed'
        || eventKind === 'bounty_settlement_recorded'
        || eventKind === 'bounty_refunded'
        || eventKind === 'challenge_accepted'
        || eventKind === 'challenge_rejected'
        || eventKind === 'challenge_changes_requested'
        || eventKind === 'challenge_closed';
}

function normalizeClientNonce(value: string): string {
    const nonce = typeof value === 'string' ? value.trim() : '';
    if (!nonce) throw new AnchoredInteractionInputError('invalid_client_nonce');
    return nonce;
}

function normalizeRequiredString(value: unknown, code: string): string {
    if (typeof value !== 'string' || !value.trim()) {
        throw new AnchoredInteractionInputError(code);
    }
    return value.trim();
}

function computeAnchoredInteractionId(input: {
    circleId: number;
    anchorType: string;
    anchorRef: string;
    interactionType: string;
    createdByPubkey: string;
    clientNonce: string;
}): string {
    return `intr_${sha256Hex([
        input.circleId,
        input.anchorType,
        input.anchorRef,
        input.interactionType,
        input.createdByPubkey,
        input.clientNonce,
    ].join('|')).slice(0, 32)}`;
}

export function computeAnchoredInteractionEventId(input: {
    circleId: number;
    interactionId: string;
    actorPubkey: string | null;
    eventKind: string;
    clientNonce: string;
}): string {
    return `plazaevt_${sha256Hex([
        input.circleId,
        input.interactionId,
        input.actorPubkey || '',
        input.eventKind,
        input.clientNonce,
    ].join('|')).slice(0, 32)}`;
}

function sha256Hex(value: string): string {
    return createHash('sha256').update(value).digest('hex');
}

async function lockAnchoredInteraction(tx: any, interactionId: string): Promise<void> {
    if (typeof tx.$queryRaw !== 'function') return;
    await tx.$queryRaw(Prisma.sql`
        SELECT interaction_id
        FROM discussion_anchored_interactions
        WHERE interaction_id = ${interactionId}
        FOR UPDATE
    `);
}

async function updateInteractionProjection(
    tx: any,
    input: {
        interactionId: string;
        state: Record<string, unknown>;
        summary: Record<string, unknown>;
    },
): Promise<DiscussionAnchoredInteractionRow> {
    if (typeof tx.$queryRaw === 'function') {
        const rows = await tx.$queryRaw(Prisma.sql`
            UPDATE discussion_anchored_interactions
            SET
                state = ${JSON.stringify(input.state)}::jsonb,
                summary = ${JSON.stringify(input.summary)}::jsonb,
                projection_version = projection_version + 1,
                projection_cursor = nextval('discussion_anchored_interaction_projection_cursor_seq'::regclass),
                updated_at = CURRENT_TIMESTAMP
            WHERE interaction_id = ${input.interactionId}
            RETURNING
                interaction_id AS "interactionId",
                circle_id AS "circleId",
                anchor_type AS "anchorType",
                anchor_ref AS "anchorRef",
                interaction_type AS "interactionType",
                interaction_class AS "interactionClass",
                status,
                projection_version AS "projectionVersion",
                projection_cursor AS "projectionCursor",
                result_status AS "resultStatus",
                result_notice_envelope_id AS "resultNoticeEnvelopeId",
                state,
                summary,
                policy_version AS "policyVersion",
                created_by_pubkey AS "createdByPubkey",
                created_at AS "createdAt",
                updated_at AS "updatedAt"
        `);
        const typedRows = rows as DiscussionAnchoredInteractionRow[];
        if (typedRows[0]) return typedRows[0];
    }

    return tx.discussionAnchoredInteraction.update({
        where: { interactionId: input.interactionId },
        data: {
            state: input.state,
            summary: input.summary,
            projectionVersion: { increment: 1 },
            updatedAt: new Date(),
        },
    });
}

function mapEventRow(row: any): PlazaAnchoredInteractionEventRecord {
    return {
        id: typeof row.id === 'bigint' ? row.id : BigInt(row.id),
        eventId: row.eventId,
        interactionId: row.interactionId,
        circleId: row.circleId,
        actorPubkey: row.actorPubkey,
        eventKind: row.eventKind,
        payload: normalizeRecord(row.payload),
        clientNonce: row.clientNonce,
        createdAt: row.createdAt instanceof Date ? row.createdAt : new Date(row.createdAt),
    };
}

function normalizeRecord(value: unknown): Record<string, unknown> {
    return value && typeof value === 'object' && !Array.isArray(value)
        ? value as Record<string, unknown>
        : {};
}
