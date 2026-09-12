import type { PrismaClient } from '@prisma/client';

import type { AppLocale } from '../../../i18n/locale';
import {
    resolveCircleActorDisplays,
    type CircleActorDisplay,
    type CircleActorDisplayRef,
} from '../../identity/circleActorDisplay';

type AnchoredInteractionPrisma = PrismaClient | any;

export interface AnchoredInteractionDisplaySnapshot {
    displaySnapshot: string;
    displaySourceSnapshot: string;
    displayCircleIdSnapshot: number | null;
    inheritedFromCircleIdSnapshot: number | null;
    displaySnapshotAt: Date;
    aliasSnapshot: string | null;
    needsDisplayDisambiguation: boolean;
    displayCollisionKey: string | null;
    displayCollisionCount: number;
}

export interface AnchoredInteractionResolvedDisplaySnapshots {
    actor: AnchoredInteractionDisplaySnapshot | null;
    recipient: AnchoredInteractionDisplaySnapshot | null;
}

export async function resolveAnchoredInteractionDisplaySnapshots(
    prisma: AnchoredInteractionPrisma,
    input: {
        circleId: number;
        actorPubkey?: string | null;
        recipientPubkey?: string | null;
        locale?: AppLocale | string;
        snapshotAt?: Date;
    },
): Promise<AnchoredInteractionResolvedDisplaySnapshots> {
    const snapshotAt = input.snapshotAt ?? new Date();
    const actors: CircleActorDisplayRef[] = [];
    const actorPubkey = normalizeString(input.actorPubkey);
    const recipientPubkey = normalizeString(input.recipientPubkey);
    if (actorPubkey) {
        actors.push({
            displayKey: 'actor',
            pubkey: actorPubkey,
            circleId: input.circleId,
        });
    }
    if (recipientPubkey) {
        actors.push({
            displayKey: 'recipient',
            pubkey: recipientPubkey,
            circleId: input.circleId,
        });
    }
    if (actors.length === 0) {
        return { actor: null, recipient: null };
    }

    const displays = await resolveCircleActorDisplays({
        prisma: buildDisplayPrisma(prisma),
        actors,
        mode: 'event_snapshot',
        locale: input.locale || 'en',
        includeTechnicalShortAddress: false,
    });

    return {
        actor: toSnapshot(displays.get('actor') ?? null, snapshotAt),
        recipient: toSnapshot(displays.get('recipient') ?? null, snapshotAt),
    };
}

export function snapshotToPrismaData(
    prefix: 'actor' | 'recipient',
    snapshot: AnchoredInteractionDisplaySnapshot | null,
): Record<string, unknown> {
    if (!snapshot) return {};
    return {
        [`${prefix}DisplaySnapshot`]: snapshot.displaySnapshot,
        [`${prefix}DisplaySourceSnapshot`]: snapshot.displaySourceSnapshot,
        [`${prefix}DisplayCircleIdSnapshot`]: snapshot.displayCircleIdSnapshot,
        [`${prefix}InheritedFromCircleIdSnapshot`]: snapshot.inheritedFromCircleIdSnapshot,
        [`${prefix}DisplaySnapshotAt`]: snapshot.displaySnapshotAt,
        [`${prefix}AliasSnapshot`]: snapshot.aliasSnapshot,
    };
}

export function snapshotToDisplayPayloadFields(
    prefix: 'actor' | 'recipient',
    snapshot: AnchoredInteractionDisplaySnapshot | null,
): Record<string, unknown> {
    if (!snapshot) return {};
    return {
        [`${prefix}EffectiveDisplayName`]: snapshot.displaySnapshot,
        [`${prefix}DisplaySource`]: snapshot.displaySourceSnapshot,
        [`${prefix}DisplayCircleId`]: snapshot.displayCircleIdSnapshot,
        [`${prefix}CircleAlias`]: snapshot.aliasSnapshot,
        [`${prefix}DisplaySnapshot`]: snapshot.displaySnapshot,
        [`${prefix}DisplaySourceSnapshot`]: snapshot.displaySourceSnapshot,
        [`${prefix}DisplayCircleIdSnapshot`]: snapshot.displayCircleIdSnapshot,
        [`${prefix}InheritedFromCircleIdSnapshot`]: snapshot.inheritedFromCircleIdSnapshot,
        [`${prefix}DisplaySnapshotAt`]: snapshot.displaySnapshotAt.toISOString(),
        [`${prefix}AliasSnapshot`]: snapshot.aliasSnapshot,
        [`${prefix}NeedsDisplayDisambiguation`]: snapshot.needsDisplayDisambiguation,
        [`${prefix}DisplayCollisionCount`]: snapshot.displayCollisionCount,
    };
}

export function snapshotToMetadata(
    snapshot: AnchoredInteractionDisplaySnapshot | null,
): Record<string, unknown> | null {
    if (!snapshot) return null;
    return {
        displaySnapshot: snapshot.displaySnapshot,
        displaySourceSnapshot: snapshot.displaySourceSnapshot,
        displayCircleIdSnapshot: snapshot.displayCircleIdSnapshot,
        inheritedFromCircleIdSnapshot: snapshot.inheritedFromCircleIdSnapshot,
        displaySnapshotAt: snapshot.displaySnapshotAt.toISOString(),
        aliasSnapshot: snapshot.aliasSnapshot,
        needsDisplayDisambiguation: snapshot.needsDisplayDisambiguation,
        displayCollisionKey: snapshot.displayCollisionKey,
        displayCollisionCount: snapshot.displayCollisionCount,
    };
}

export function snapshotFromRow(
    row: Record<string, unknown>,
    prefix: 'actor' | 'recipient',
): AnchoredInteractionDisplaySnapshot | null {
    const displaySnapshot = normalizeString(row[`${prefix}DisplaySnapshot`]);
    if (!displaySnapshot) return null;
    return {
        displaySnapshot,
        displaySourceSnapshot: normalizeString(row[`${prefix}DisplaySourceSnapshot`]) || 'generic_member',
        displayCircleIdSnapshot: normalizeNullableNumber(row[`${prefix}DisplayCircleIdSnapshot`]),
        inheritedFromCircleIdSnapshot: normalizeNullableNumber(row[`${prefix}InheritedFromCircleIdSnapshot`]),
        displaySnapshotAt: normalizeDate(row[`${prefix}DisplaySnapshotAt`]),
        aliasSnapshot: normalizeString(row[`${prefix}AliasSnapshot`]),
        needsDisplayDisambiguation: Boolean(row[`${prefix}NeedsDisplayDisambiguation`]),
        displayCollisionKey: normalizeString(row[`${prefix}DisplayCollisionKey`]),
        displayCollisionCount: normalizePositiveNumber(row[`${prefix}DisplayCollisionCount`], 1),
    };
}

export function applySnapshotDisplayFields(
    record: Record<string, unknown>,
    prefix: 'actor' | 'recipient',
    snapshot: AnchoredInteractionDisplaySnapshot,
): void {
    Object.assign(record, snapshotToDisplayPayloadFields(prefix, snapshot));
}

function toSnapshot(
    display: CircleActorDisplay | null,
    snapshotAt: Date,
): AnchoredInteractionDisplaySnapshot | null {
    if (!display) return null;
    return {
        displaySnapshot: display.effectiveName,
        displaySourceSnapshot: display.displaySource,
        displayCircleIdSnapshot: display.displayCircleId,
        inheritedFromCircleIdSnapshot: display.inheritedFromCircleId,
        displaySnapshotAt: snapshotAt,
        aliasSnapshot: display.circleAlias,
        needsDisplayDisambiguation: display.needsDisplayDisambiguation,
        displayCollisionKey: display.displayCollisionKey,
        displayCollisionCount: display.displayCollisionCount,
    };
}

function buildDisplayPrisma(prisma: AnchoredInteractionPrisma): AnchoredInteractionPrisma {
    return prisma?.user?.findMany
        ? prisma
        : { user: { findMany: async () => [] } };
}

function normalizeString(value: unknown): string | null {
    return typeof value === 'string' && value.trim() ? value.trim() : null;
}

function normalizeNullableNumber(value: unknown): number | null {
    const numeric = typeof value === 'number' ? value : Number(value);
    return Number.isFinite(numeric) ? numeric : null;
}

function normalizePositiveNumber(value: unknown, fallback: number): number {
    const numeric = typeof value === 'number' ? value : Number(value);
    return Number.isFinite(numeric) && numeric > 0 ? numeric : fallback;
}

function normalizeDate(value: unknown): Date {
    if (value instanceof Date) return value;
    if (typeof value === 'string' && value) {
        const parsed = new Date(value);
        if (!Number.isNaN(parsed.getTime())) return parsed;
    }
    return new Date(0);
}
