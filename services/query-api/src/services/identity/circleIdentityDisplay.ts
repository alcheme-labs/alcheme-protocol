import { DEFAULT_LOCALE, isSupportedLocale, type AppLocale } from '../../i18n/locale';
import { loadCircleAncestorChains, type CircleHierarchyPrisma } from './circleHierarchy';

export type CircleIdentityLevelValue = 'Visitor' | 'Initiate' | 'Member' | 'Elder';
export type CircleRoleValue = 'Owner' | 'Admin' | 'Moderator' | 'Member';
export type CircleIdentityDisplayState =
    | 'observer'
    | 'participant'
    | 'contributor'
    | 'senior_contributor'
    | 'not_joined'
    | 'unknown';
export type CircleMembershipSource = 'current_circle' | 'inherited_parent' | 'none';

export interface CircleIdentityDisplayRef {
    displayKey: string;
    pubkey: string | null;
    circleId: number | null;
}

export interface CircleIdentityDisplay {
    identityLevel: CircleIdentityLevelValue | null;
    identityDisplayName: string | null;
    identityState: CircleIdentityDisplayState;
    membershipSource: CircleMembershipSource;
    membershipCircleId: number | null;
    role: CircleRoleValue | null;
    roleDisplayName: string | null;
}

interface CircleIdentityUserRow {
    id: number;
    pubkey: string;
}

interface CircleIdentityMemberRow {
    userId: number;
    circleId: number;
    role: string;
    identityLevel: string;
}

export interface CircleIdentityDisplayPrisma extends CircleHierarchyPrisma {
    user?: {
        findMany(args: {
            where: { pubkey: { in: string[] } };
            select: { id: true; pubkey: true };
        }): Promise<CircleIdentityUserRow[]>;
    };
    circleMember?: {
        findMany(args: {
            where: {
                userId: { in: number[] };
                circleId: { in: number[] };
                status: 'Active';
            };
            select: { userId: true; circleId: true; role: true; identityLevel: true };
        }): Promise<CircleIdentityMemberRow[]>;
    };
}

const IDENTITY_LABELS: Record<CircleIdentityLevelValue, Record<AppLocale, string>> = {
    Visitor: {
        zh: '观察者',
        en: 'Observer',
        es: 'Observador',
        fr: 'Observateur',
    },
    Initiate: {
        zh: '参与者',
        en: 'Participant',
        es: 'Participante',
        fr: 'Participant',
    },
    Member: {
        zh: '贡献者',
        en: 'Contributor',
        es: 'Colaborador',
        fr: 'Contributeur',
    },
    Elder: {
        zh: '资深贡献者',
        en: 'Senior Contributor',
        es: 'Colaborador sénior',
        fr: 'Contributeur senior',
    },
};

const ROLE_LABELS: Record<CircleRoleValue, Record<AppLocale, string>> = {
    Owner: {
        zh: '创建者',
        en: 'Owner',
        es: 'Propietario',
        fr: 'Propriétaire',
    },
    Admin: {
        zh: '管理员',
        en: 'Admin',
        es: 'Administrador',
        fr: 'Admin',
    },
    Moderator: {
        zh: '协管者',
        en: 'Moderator',
        es: 'Moderador',
        fr: 'Modérateur',
    },
    Member: {
        zh: '成员',
        en: 'Member',
        es: 'Miembro',
        fr: 'Membre',
    },
};

function normalizeText(value: string | null | undefined): string | null {
    const trimmed = typeof value === 'string' ? value.trim() : '';
    return trimmed || null;
}

function normalizeCircleId(value: number | null | undefined): number | null {
    if (typeof value !== 'number' || !Number.isFinite(value)) return null;
    const normalized = Math.trunc(value);
    return normalized > 0 ? normalized : null;
}

function normalizeLocale(value: AppLocale | string): AppLocale {
    const normalized = String(value || '')
        .trim()
        .toLowerCase()
        .split(/[-_]/)[0];
    return isSupportedLocale(normalized) ? normalized : DEFAULT_LOCALE;
}

function normalizeIdentityLevel(value: string | null | undefined): CircleIdentityLevelValue | null {
    if (value === 'Visitor' || value === 'Initiate' || value === 'Member' || value === 'Elder') {
        return value;
    }
    return null;
}

function normalizeRole(value: string | null | undefined): CircleRoleValue | null {
    if (value === 'Owner' || value === 'Admin' || value === 'Moderator' || value === 'Member') {
        return value;
    }
    return null;
}

function mapIdentityLevelToDisplayState(level: CircleIdentityLevelValue | null): CircleIdentityDisplayState {
    if (level === 'Visitor') return 'observer';
    if (level === 'Initiate') return 'participant';
    if (level === 'Member') return 'contributor';
    if (level === 'Elder') return 'senior_contributor';
    return 'unknown';
}

function buildEmptyDisplay(): CircleIdentityDisplay {
    return {
        identityLevel: null,
        identityDisplayName: null,
        identityState: 'not_joined',
        membershipSource: 'none',
        membershipCircleId: null,
        role: null,
        roleDisplayName: null,
    };
}

function buildMembershipDisplay(input: {
    membership: CircleIdentityMemberRow;
    membershipSource: Exclude<CircleMembershipSource, 'none'>;
    locale: AppLocale;
}): CircleIdentityDisplay {
    const identityLevel = normalizeIdentityLevel(input.membership.identityLevel);
    const role = normalizeRole(input.membership.role);
    return {
        identityLevel,
        identityDisplayName: identityLevel ? IDENTITY_LABELS[identityLevel][input.locale] : null,
        identityState: mapIdentityLevelToDisplayState(identityLevel),
        membershipSource: input.membershipSource,
        membershipCircleId: input.membership.circleId,
        role,
        roleDisplayName: role ? ROLE_LABELS[role][input.locale] : null,
    };
}

export async function resolveCircleIdentityDisplays(input: {
    prisma: CircleIdentityDisplayPrisma;
    actors: readonly CircleIdentityDisplayRef[];
    locale: AppLocale | string;
}): Promise<Map<string, CircleIdentityDisplay>> {
    const locale = normalizeLocale(input.locale);
    const result = new Map<string, CircleIdentityDisplay>();
    const normalizedActors = input.actors.map((actor) => {
        const pubkey = normalizeText(actor.pubkey);
        const circleId = normalizeCircleId(actor.circleId);
        if (!pubkey || circleId === null) {
            result.set(actor.displayKey, buildEmptyDisplay());
            return null;
        }
        return {
            displayKey: actor.displayKey,
            pubkey,
            circleId,
        };
    }).filter((actor): actor is { displayKey: string; pubkey: string; circleId: number } => Boolean(actor));

    if (!normalizedActors.length || !input.prisma.user?.findMany || !input.prisma.circleMember?.findMany) {
        for (const actor of input.actors) {
            if (!result.has(actor.displayKey)) {
                result.set(actor.displayKey, buildEmptyDisplay());
            }
        }
        return result;
    }

    const pubkeys = Array.from(new Set(normalizedActors.map((actor) => actor.pubkey)));
    const users = await input.prisma.user.findMany({
        where: { pubkey: { in: pubkeys } },
        select: {
            id: true,
            pubkey: true,
        },
    });
    const usersByPubkey = new Map(users.map((user) => [user.pubkey, user]));
    const userIds = Array.from(new Set(users.map((user) => user.id)));

    if (!userIds.length) {
        for (const actor of normalizedActors) {
            result.set(actor.displayKey, buildEmptyDisplay());
        }
        return result;
    }

    const chainsByCircleId = await loadCircleAncestorChains({
        prisma: input.prisma,
        circleIds: normalizedActors.map((actor) => actor.circleId),
    });
    const membershipCircleIds = Array.from(new Set(
        Array.from(chainsByCircleId.values()).flat(),
    ));
    const memberships = membershipCircleIds.length
        ? await input.prisma.circleMember.findMany({
            where: {
                userId: { in: userIds },
                circleId: { in: membershipCircleIds },
                status: 'Active',
            },
            select: {
                userId: true,
                circleId: true,
                role: true,
                identityLevel: true,
            },
        })
        : [];
    const membershipByUserAndCircle = new Map(
        memberships.map((membership) => [`${membership.userId}:${membership.circleId}`, membership]),
    );

    for (const actor of normalizedActors) {
        const user = usersByPubkey.get(actor.pubkey);
        if (!user) {
            result.set(actor.displayKey, buildEmptyDisplay());
            continue;
        }

        const chain = chainsByCircleId.get(actor.circleId) ?? [actor.circleId];
        const currentMembership = membershipByUserAndCircle.get(`${user.id}:${actor.circleId}`);
        if (currentMembership) {
            result.set(actor.displayKey, buildMembershipDisplay({
                membership: currentMembership,
                membershipSource: 'current_circle',
                locale,
            }));
            continue;
        }

        const inheritedMembership = chain
            .slice(1)
            .map((circleId) => membershipByUserAndCircle.get(`${user.id}:${circleId}`))
            .find((membership): membership is CircleIdentityMemberRow => Boolean(membership));

        if (inheritedMembership) {
            result.set(actor.displayKey, buildMembershipDisplay({
                membership: inheritedMembership,
                membershipSource: 'inherited_parent',
                locale,
            }));
            continue;
        }

        result.set(actor.displayKey, buildEmptyDisplay());
    }

    return result;
}
