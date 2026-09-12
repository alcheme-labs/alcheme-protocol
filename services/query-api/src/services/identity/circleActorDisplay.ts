import type { AppLocale } from '../../i18n/locale';
import { localizeQueryApiCopy } from '../../i18n/copy';
import { resolveCircleAliases, type CircleAliasPrisma, type CircleAliasUserRow } from './circleAliasStore';

export type CircleActorDisplaySource =
    | 'circle_alias'
    | 'ancestor_alias'
    | 'global_display_name'
    | 'global_handle'
    | 'generic_member'
    | 'technical';

export interface CircleActorDisplay {
    pubkey: string | null;
    effectiveName: string;
    displaySource: CircleActorDisplaySource;
    displayCircleId: number | null;
    inheritedFromCircleId: number | null;
    globalHandle: string | null;
    globalDisplayName: string | null;
    circleAlias: string | null;
    technicalShortAddress: string | null;
    needsDisplayDisambiguation: boolean;
    displayCollisionKey: string | null;
    displayCollisionCount: number;
}

export interface CircleActorDisplayRef {
    displayKey: string;
    pubkey: string | null;
    circleId: number | null;
    sourceCircleId?: number | null;
    snapshotAt?: Date | null;
}

type CircleActorDisplayMode = 'current' | 'event_snapshot' | 'source_snapshot';

interface UserDisplayRow {
    id: number;
    pubkey: string;
    handle: string | null;
    displayName: string | null;
}

interface CircleActorDisplayPrisma extends CircleAliasPrisma {
    user: {
        findMany(args: {
            where: { pubkey: { in: string[] } };
            select: { id: true; pubkey: true; handle: true; displayName: true };
        }): Promise<UserDisplayRow[]>;
    };
}

function normalizeText(value: string | null | undefined): string | null {
    const trimmed = typeof value === 'string' ? value.trim() : '';
    return trimmed || null;
}

function shortAddress(pubkey: string): string {
    if (pubkey.length <= 10) return pubkey;
    return `${pubkey.slice(0, 4)}...${pubkey.slice(-4)}`;
}

export async function resolveCircleActorDisplays(input: {
    prisma: CircleActorDisplayPrisma;
    actors: readonly CircleActorDisplayRef[];
    mode: CircleActorDisplayMode;
    locale: AppLocale | string;
    includeTechnicalShortAddress?: boolean;
}): Promise<Map<string, CircleActorDisplay>> {
    const pubkeys = Array.from(
        new Set(
            input.actors
                .map((actor) => normalizeText(actor.pubkey))
                .filter((pubkey): pubkey is string => Boolean(pubkey)),
        ),
    );

    const users = pubkeys.length
        ? await input.prisma.user.findMany({
            where: { pubkey: { in: pubkeys } },
            select: {
                id: true,
                pubkey: true,
                handle: true,
                displayName: true,
            },
        })
        : [];
    const usersByPubkey = new Map(users.map((user) => [user.pubkey, user]));
    const aliasesByDisplayKey = await resolveCircleAliases({
        prisma: input.prisma,
        actors: input.actors,
        users: users.filter((user): user is CircleAliasUserRow & UserDisplayRow => typeof user.id === 'number'),
    });
    const fallbackName = localizeQueryApiCopy('identity.genericMember', input.locale);
    const result = new Map<string, CircleActorDisplay>();

    for (const actor of input.actors) {
        const pubkey = normalizeText(actor.pubkey);
        const user = pubkey ? usersByPubkey.get(pubkey) : undefined;
        const globalDisplayName = normalizeText(user?.displayName);
        const globalHandle = normalizeText(user?.handle);
        const displayCircleId = actor.sourceCircleId ?? actor.circleId ?? null;
        const alias = aliasesByDisplayKey.get(actor.displayKey);
        const effectiveName = alias?.alias ?? globalDisplayName ?? globalHandle ?? fallbackName;
        const displaySource: CircleActorDisplaySource = alias?.displaySource ?? (globalDisplayName
            ? 'global_display_name'
            : globalHandle
                ? 'global_handle'
                : 'generic_member');

        result.set(actor.displayKey, {
            pubkey,
            effectiveName,
            displaySource,
            displayCircleId,
            inheritedFromCircleId: alias?.inheritedFromCircleId ?? null,
            globalHandle,
            globalDisplayName,
            circleAlias: alias?.alias ?? null,
            technicalShortAddress: input.includeTechnicalShortAddress && pubkey ? shortAddress(pubkey) : null,
            needsDisplayDisambiguation: false,
            displayCollisionKey: null,
            displayCollisionCount: 1,
        });
    }

    const displayKeysByCollisionKey = new Map<string, string[]>();
    const actorKeysByCollisionKey = new Map<string, Set<string>>();
    for (const [displayKey, display] of result) {
        const normalizedName = normalizeText(display.effectiveName)?.toLocaleLowerCase();
        if (!normalizedName) continue;

        const contextKey = display.displayCircleId === null ? 'global' : `circle:${display.displayCircleId}`;
        const collisionKey = `${contextKey}:name:${normalizedName}`;
        const displayKeys = displayKeysByCollisionKey.get(collisionKey) ?? [];
        displayKeys.push(displayKey);
        displayKeysByCollisionKey.set(collisionKey, displayKeys);

        const actorKeys = actorKeysByCollisionKey.get(collisionKey) ?? new Set<string>();
        actorKeys.add(display.pubkey ?? `display:${displayKey}`);
        actorKeysByCollisionKey.set(collisionKey, actorKeys);
    }

    for (const [collisionKey, displayKeys] of displayKeysByCollisionKey) {
        const actorCount = actorKeysByCollisionKey.get(collisionKey)?.size ?? 0;
        if (actorCount < 2) continue;

        for (const displayKey of displayKeys) {
            const display = result.get(displayKey);
            if (!display) continue;
            display.needsDisplayDisambiguation = true;
            display.displayCollisionKey = collisionKey;
            display.displayCollisionCount = actorCount;
        }
    }

    return result;
}
