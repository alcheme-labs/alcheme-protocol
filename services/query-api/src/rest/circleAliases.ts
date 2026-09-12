import { Router, type Request } from 'express';
import type { PrismaClient } from '@prisma/client';
import type { Redis } from 'ioredis';

import { resolveExpressRequestLocale } from '../i18n/request';
import {
    requireAuthenticatedActor,
    requireCircleActorForAuthActor,
    type AuthActor,
} from '../services/auth/actor';
import { sendAuthActorError } from '../services/auth/actorPermissions';
import { resolveCircleActorDisplays, type CircleActorDisplay } from '../services/identity/circleActorDisplay';

const RESERVED_ALIASES = new Set(['admin', 'system', 'alcheme', 'moderator', 'owner']);
const FORBIDDEN_OWNER_FIELDS = ['userId', 'pubkey', 'walletPubkey', 'actorPubkey'];

function parsePositiveInt(value: unknown): number | null {
    const parsed = Number.parseInt(String(value ?? ''), 10);
    if (!Number.isFinite(parsed) || parsed <= 0) return null;
    return parsed;
}

function normalizeText(value: unknown): string | null {
    const normalized = typeof value === 'string' ? value.trim() : '';
    return normalized || null;
}

function hasOwnField(input: unknown, field: string): boolean {
    return Boolean(input && typeof input === 'object' && Object.prototype.hasOwnProperty.call(input, field));
}

function hasForbiddenOwnerField(req: Request): boolean {
    return FORBIDDEN_OWNER_FIELDS.some((field) => hasOwnField(req.body, field) || hasOwnField(req.query, field));
}

function validateAlias(value: unknown): { ok: true; alias: string } | { ok: false; error: string } {
    const alias = normalizeText(value);
    if (!alias) return { ok: false, error: 'circle_alias_required' };

    const visibleLength = Array.from(alias).length;
    if (visibleLength < 1 || visibleLength > 32) {
        return { ok: false, error: 'circle_alias_length_invalid' };
    }
    if (RESERVED_ALIASES.has(alias.toLowerCase())) {
        return { ok: false, error: 'circle_alias_reserved' };
    }

    return { ok: true, alias };
}

async function requireAliasActor(prisma: PrismaClient, req: Request, circleId: number): Promise<AuthActor> {
    const actor = await requireAuthenticatedActor(req, prisma, { requireSessionCookie: true });
    await requireCircleActorForAuthActor(actor, prisma, {
        circleId,
        action: 'circle.read',
        requireMemberChainPresence: false,
    });
    return actor;
}

async function loadExplicitAlias(prisma: PrismaClient, input: { circleId: number; userId: number }): Promise<string | null> {
    const row = await (prisma as any).circleAlias.findUnique({
        where: {
            circleId_userId: {
                circleId: input.circleId,
                userId: input.userId,
            },
        },
        select: {
            alias: true,
            status: true,
        },
    });
    if (!row || row.status !== 'active') return null;
    return normalizeText(row.alias);
}

async function loadInheritedFromCircle(prisma: PrismaClient, display: CircleActorDisplay) {
    if (typeof display.inheritedFromCircleId !== 'number') return null;
    const circle = await prisma.circle.findUnique({
        where: { id: display.inheritedFromCircleId },
        select: {
            id: true,
            name: true,
        },
    });
    return circle ? { id: circle.id, name: circle.name } : null;
}

function toPublicDisplay(display: CircleActorDisplay) {
    const {
        pubkey: _pubkey,
        technicalShortAddress: _technicalShortAddress,
        ...publicDisplay
    } = display;
    return publicDisplay;
}

async function buildAliasResponse(prisma: PrismaClient, input: {
    circleId: number;
    userId: number;
    pubkey: string;
    req: Request;
}) {
    const resolved = await resolveCircleActorDisplays({
        prisma: prisma as any,
        actors: [
            {
                displayKey: 'circle-alias:me',
                pubkey: input.pubkey,
                circleId: input.circleId,
            },
        ],
        mode: 'current',
        locale: resolveExpressRequestLocale(input.req),
    });
    const effectiveDisplay = resolved.get('circle-alias:me');
    if (!effectiveDisplay) {
        throw new Error('circle_alias_display_resolution_failed');
    }

    const [alias, inheritedFromCircle] = await Promise.all([
        loadExplicitAlias(prisma, input),
        loadInheritedFromCircle(prisma, effectiveDisplay),
    ]);

    return {
        ok: true,
        circleId: input.circleId,
        alias,
        effectiveDisplay: toPublicDisplay(effectiveDisplay),
        inheritedFromCircle,
    };
}

export function circleAliasRouter(prisma: PrismaClient, _redis: Redis): Router {
    const router = Router();

    router.get('/:circleId/aliases/me', async (req, res, next) => {
        try {
            const circleId = parsePositiveInt(req.params.circleId);
            if (!circleId) return res.status(400).json({ error: 'invalid_circle_id' });
            if (hasForbiddenOwnerField(req)) {
                return res.status(400).json({ error: 'identity_owner_fields_not_allowed' });
            }

            const actor = await requireAliasActor(prisma, req, circleId);

            return res.status(200).json(await buildAliasResponse(prisma, {
                circleId,
                userId: actor.userId,
                pubkey: actor.pubkey,
                req,
            }));
        } catch (error) {
            if (sendAuthActorError(res, error)) return;
            return next(error);
        }
    });

    router.put('/:circleId/aliases/me', async (req, res, next) => {
        try {
            const circleId = parsePositiveInt(req.params.circleId);
            if (!circleId) return res.status(400).json({ error: 'invalid_circle_id' });
            if (hasForbiddenOwnerField(req)) {
                return res.status(400).json({ error: 'identity_owner_fields_not_allowed' });
            }

            const actor = await requireAliasActor(prisma, req, circleId);

            const alias = validateAlias(req.body?.alias);
            if (!alias.ok) return res.status(400).json({ error: alias.error });

            await (prisma as any).circleAlias.upsert({
                where: {
                    circleId_userId: {
                        circleId,
                        userId: actor.userId,
                    },
                },
                create: {
                    circleId,
                    userId: actor.userId,
                    alias: alias.alias,
                    status: 'active',
                },
                update: {
                    alias: alias.alias,
                    status: 'active',
                },
            });

            return res.status(200).json(await buildAliasResponse(prisma, {
                circleId,
                userId: actor.userId,
                pubkey: actor.pubkey,
                req,
            }));
        } catch (error) {
            if (sendAuthActorError(res, error)) return;
            return next(error);
        }
    });

    router.delete('/:circleId/aliases/me', async (req, res, next) => {
        try {
            const circleId = parsePositiveInt(req.params.circleId);
            if (!circleId) return res.status(400).json({ error: 'invalid_circle_id' });
            if (hasForbiddenOwnerField(req)) {
                return res.status(400).json({ error: 'identity_owner_fields_not_allowed' });
            }

            const actor = await requireAliasActor(prisma, req, circleId);

            await (prisma as any).circleAlias.updateMany({
                where: {
                    circleId,
                    userId: actor.userId,
                },
                data: {
                    status: 'deleted',
                },
            });

            return res.status(200).json(await buildAliasResponse(prisma, {
                circleId,
                userId: actor.userId,
                pubkey: actor.pubkey,
                req,
            }));
        } catch (error) {
            if (sendAuthActorError(res, error)) return;
            return next(error);
        }
    });

    return router;
}
