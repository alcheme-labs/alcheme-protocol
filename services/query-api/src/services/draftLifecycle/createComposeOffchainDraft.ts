import crypto from 'crypto';
import type { PrismaClient } from '@prisma/client';

import { createDraftVersionSnapshot, loadDraftVersionSnapshot } from './versionSnapshots';
import { normalizeDraftTitle } from './draftTitle';

export class ComposeOffchainDraftError extends Error {
    statusCode: number;
    code: string;

    constructor(input: { statusCode: number; code: string; message: string }) {
        super(input.message);
        this.statusCode = input.statusCode;
        this.code = input.code;
    }
}

export async function createComposeOffchainDraft(
    prisma: PrismaClient,
    input: {
        circleId: number;
        text: string;
        actorUserId: number;
        draftTitle?: string | null;
        clientRequestId?: string | null;
    },
): Promise<{ draftPostId: number }> {
    const text = String(input.text || '').replace(/\r\n/g, '\n').trim();
    let draftTitle: string | null;
    try {
        draftTitle = normalizeDraftTitle(input.draftTitle);
    } catch {
        throw new ComposeOffchainDraftError({
            statusCode: 400,
            code: 'draft_title_invalid',
            message: 'draftTitle must contain 1 to 160 characters',
        });
    }
    const clientRequestId = normalizeClientRequestId(input.clientRequestId);

    const circle = await prisma.circle.findUnique({
        where: { id: input.circleId },
        select: { id: true, mode: true },
    });
    if (!circle) {
        throw new ComposeOffchainDraftError({
            statusCode: 404,
            code: 'circle_not_found',
            message: 'circle not found',
        });
    }
    if (String(circle.mode || '').toLowerCase() !== 'knowledge') {
        throw new ComposeOffchainDraftError({
            statusCode: 409,
            code: 'draft_not_allowed_for_circle_mode',
            message: 'only knowledge-mode circles can create compose drafts',
        });
    }

    const nonce = crypto.randomBytes(8).toString('hex');
    const contentId = clientRequestId
        ? `compose-request:${crypto.createHash('sha256')
            .update(`${input.circleId}:${input.actorUserId}:${clientRequestId}`)
            .digest('hex')}`
        : `compose-draft:${input.circleId}:${Date.now()}:${nonce}`;
    const onChainAddress = `offchain_compose_${crypto.randomBytes(16).toString('hex')}`.slice(0, 44);

    if (clientRequestId) {
        const existing = await findIdempotentDraft(prisma, contentId);
        if (existing) return assertIdempotentDraft(prisma, existing, input, text);
    }

    try {
        return await prisma.$transaction(async (tx) => {
            const draftPost = await tx.post.create({
                data: {
                    contentId,
                    authorId: input.actorUserId,
                    text,
                    draftTitle,
                    contentType: 'compose/draft',
                    circleId: input.circleId,
                    status: 'Draft' as any,
                    visibility: 'CircleOnly' as any,
                    onChainAddress,
                    lastSyncedSlot: BigInt(0),
                },
                select: { id: true },
            });

            await createDraftVersionSnapshot(tx, {
                draftPostId: draftPost.id,
                draftVersion: 1,
                contentSnapshot: text,
                createdFromState: 'drafting',
                createdBy: input.actorUserId,
            });

            return { draftPostId: draftPost.id };
        });
    } catch (error) {
        if (!clientRequestId || !isUniqueConstraintError(error)) throw error;
        const raced = await findIdempotentDraft(prisma, contentId);
        if (!raced) throw error;
        return assertIdempotentDraft(prisma, raced, input, text);
    }
}

function normalizeClientRequestId(value: string | null | undefined): string | null {
    if (value == null) return null;
    const normalized = String(value).trim();
    if (normalized.length < 8 || normalized.length > 128) {
        throw new ComposeOffchainDraftError({
            statusCode: 400,
            code: 'draft_client_request_id_invalid',
            message: 'clientRequestId must contain 8 to 128 characters',
        });
    }
    return normalized;
}

interface IdempotentDraftRecord {
    id: number;
    authorId: number;
    contentType: string;
    circleId: number | null;
    status: string;
}

async function findIdempotentDraft(
    prisma: PrismaClient,
    contentId: string,
): Promise<IdempotentDraftRecord | null> {
    return prisma.post.findUnique({
        where: { contentId },
        select: {
            id: true,
            authorId: true,
            contentType: true,
            circleId: true,
            status: true,
        },
    });
}

async function assertIdempotentDraft(
    prisma: PrismaClient,
    existing: IdempotentDraftRecord,
    input: { circleId: number; actorUserId: number },
    text: string,
): Promise<{ draftPostId: number }> {
    const initialSnapshot = await loadDraftVersionSnapshot(prisma, {
        draftPostId: Number(existing.id),
        draftVersion: 1,
    });
    if (
        Number(existing.authorId) !== input.actorUserId
        || Number(existing.circleId) !== input.circleId
        || String(existing.contentType) !== 'compose/draft'
        || String(existing.status) !== 'Draft'
        || !initialSnapshot
        || initialSnapshot.contentSnapshot !== text
    ) {
        throw new ComposeOffchainDraftError({
            statusCode: 409,
            code: 'draft_create_idempotency_conflict',
            message: 'clientRequestId is already bound to a different Draft payload',
        });
    }
    return { draftPostId: Number(existing.id) };
}

function isUniqueConstraintError(error: unknown): boolean {
    return Boolean(
        error
        && typeof error === 'object'
        && 'code' in error
        && (error as { code?: unknown }).code === 'P2002',
    );
}
