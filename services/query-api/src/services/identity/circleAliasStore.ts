import type { CircleActorDisplayRef, CircleActorDisplaySource } from './circleActorDisplay';
import { loadCircleAncestorChains, type CircleHierarchyPrisma } from './circleHierarchy';

export interface CircleAliasUserRow {
    id: number;
    pubkey: string;
}

export interface CircleAliasDisplay {
    displayKey: string;
    pubkey: string;
    userId: number;
    alias: string;
    displaySource: Extract<CircleActorDisplaySource, 'circle_alias' | 'ancestor_alias'>;
    displayCircleId: number;
    inheritedFromCircleId: number | null;
}

interface CircleAliasRow {
    userId: number;
    circleId: number;
    alias: string;
}

export interface CircleAliasPrisma extends CircleHierarchyPrisma {
    circleAlias?: {
        findMany(args: {
            where: {
                userId: { in: number[] };
                circleId: { in: number[] };
                status: 'active';
            };
            select: { userId: true; circleId: true; alias: true };
        }): Promise<CircleAliasRow[]>;
    };
    user?: {
        findMany(args: {
            where: { pubkey: { in: string[] } };
            select: { id: true; pubkey: true; handle?: true; displayName?: true };
        }): Promise<CircleAliasUserRow[]>;
    };
}

function normalizeText(value: string | null | undefined): string | null {
    const trimmed = typeof value === 'string' ? value.trim() : '';
    return trimmed || null;
}

function resolveDisplayCircleId(actor: CircleActorDisplayRef): number | null {
    return actor.sourceCircleId ?? actor.circleId ?? null;
}

export async function resolveCircleAliases(input: {
    prisma: CircleAliasPrisma;
    actors: readonly CircleActorDisplayRef[];
    users?: readonly CircleAliasUserRow[];
}): Promise<Map<string, CircleAliasDisplay>> {
    if (!input.prisma.circle?.findMany || !input.prisma.circleAlias?.findMany) {
        return new Map();
    }

    const normalizedActors = input.actors
        .map((actor) => ({
            actor,
            pubkey: normalizeText(actor.pubkey),
            displayCircleId: resolveDisplayCircleId(actor),
        }))
        .filter((entry): entry is { actor: CircleActorDisplayRef; pubkey: string; displayCircleId: number } =>
            Boolean(entry.pubkey && entry.displayCircleId !== null),
        );

    if (!normalizedActors.length) return new Map();

    const userRows = input.users?.length
        ? input.users
        : input.prisma.user?.findMany
            ? await input.prisma.user.findMany({
                where: {
                    pubkey: {
                        in: Array.from(new Set(normalizedActors.map((entry) => entry.pubkey))),
                    },
                },
                select: {
                    id: true,
                    pubkey: true,
                },
            })
            : [];
    const usersByPubkey = new Map(
        userRows
            .filter((user) => typeof user.id === 'number' && normalizeText(user.pubkey))
            .map((user) => [user.pubkey, user]),
    );
    const userIds = Array.from(new Set(normalizedActors.map((entry) => usersByPubkey.get(entry.pubkey)?.id).filter((id): id is number => typeof id === 'number')));
    if (!userIds.length) return new Map();

    const chainsByCircleId = await loadCircleAncestorChains({
        prisma: input.prisma,
        circleIds: normalizedActors.map((entry) => entry.displayCircleId),
    });
    const aliasCircleIds = Array.from(new Set(Array.from(chainsByCircleId.values()).flat()));
    if (!aliasCircleIds.length) return new Map();

    const aliases = await input.prisma.circleAlias.findMany({
        where: {
            userId: { in: userIds },
            circleId: { in: aliasCircleIds },
            status: 'active',
        },
        select: {
            userId: true,
            circleId: true,
            alias: true,
        },
    });
    const aliasByUserAndCircle = new Map<string, CircleAliasRow>();
    for (const alias of aliases) {
        const normalizedAlias = normalizeText(alias.alias);
        if (!normalizedAlias) continue;
        aliasByUserAndCircle.set(`${alias.userId}:${alias.circleId}`, {
            ...alias,
            alias: normalizedAlias,
        });
    }

    const result = new Map<string, CircleAliasDisplay>();
    for (const entry of normalizedActors) {
        const user = usersByPubkey.get(entry.pubkey);
        if (!user) continue;

        const chain = chainsByCircleId.get(entry.displayCircleId) ?? [];
        for (const circleId of chain) {
            const alias = aliasByUserAndCircle.get(`${user.id}:${circleId}`);
            if (!alias) continue;

            const isDirect = circleId === entry.displayCircleId;
            result.set(entry.actor.displayKey, {
                displayKey: entry.actor.displayKey,
                pubkey: entry.pubkey,
                userId: user.id,
                alias: alias.alias,
                displaySource: isDirect ? 'circle_alias' : 'ancestor_alias',
                displayCircleId: entry.displayCircleId,
                inheritedFromCircleId: isDirect ? null : circleId,
            });
            break;
        }
    }

    return result;
}
