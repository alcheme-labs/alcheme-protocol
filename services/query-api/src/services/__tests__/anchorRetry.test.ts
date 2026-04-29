import { afterEach, beforeEach, describe, expect, jest, test } from '@jest/globals';

import { createCollabEditAnchorBatch } from '../collabEditAnchor';
import { createDraftAnchorBatch } from '../draftAnchor';
import { submitMemoAnchorWithSigner } from '../anchorSigner';

jest.mock('../anchorSigner', () => ({
    submitMemoAnchorWithSigner: jest.fn(),
}));

type AnchorRow = Record<string, any>;

const originalEnv = process.env;

function buildPrismaMock(table: 'collab' | 'draft') {
    let row: AnchorRow | null = null;
    const now = new Date('2026-04-29T12:00:00.000Z');
    const readSql = (query: any) => (
        Array.isArray(query)
            ? query.join(' ')
            : String(query?.strings?.join(' ') || query || '')
    );

    const prisma: any = {
        $queryRaw: jest.fn(async (query: any, ...values: any[]) => {
            const sql = readSql(query);
            if (sql.includes('FROM collab_edit_anchor_batches') || sql.includes('FROM discussion_draft_anchor_batches')) {
                const anchorId = String(values[0] || '');
                return row && (!anchorId || row.anchorId === anchorId) ? [row] : [];
            }
            if (sql.includes('UPDATE collab_edit_anchor_batches') || sql.includes('UPDATE discussion_draft_anchor_batches')) {
                const anchorId = String(values[0]);
                if (row?.anchorId === anchorId && ['pending', 'failed', 'skipped'].includes(row.status)) {
                    row = {
                        ...row,
                        status: 'anchoring',
                        errorMessage: null,
                        updatedAt: now,
                    };
                    return [{ anchorId }];
                }
                return [];
            }
            return [];
        }),
        $executeRaw: jest.fn(async (query: any, ...values: any[]) => {
            const sql = readSql(query);
            if (sql.includes('INSERT INTO collab_edit_anchor_batches')) {
                row = {
                    anchorId: values[0],
                    draftPostId: values[1],
                    circleId: values[2],
                    roomKey: values[3],
                    fromSeq: values[4],
                    toSeq: values[5],
                    updateCount: values[6],
                    updatesDigest: values[7],
                    snapshotHash: values[8],
                    payloadHash: values[9],
                    canonicalPayload: values[10],
                    chain: 'solana',
                    memoText: values[11],
                    txSignature: null,
                    txSlot: null,
                    status: 'pending',
                    errorMessage: null,
                    createdAt: now,
                    anchoredAt: null,
                    updatedAt: now,
                };
                return 1;
            }
            if (sql.includes('INSERT INTO discussion_draft_anchor_batches')) {
                row = {
                    anchorId: values[0],
                    circleId: values[1],
                    draftPostId: values[2],
                    roomKey: values[3],
                    triggerReason: values[4],
                    summaryHash: values[5],
                    messagesDigest: values[6],
                    payloadHash: values[7],
                    canonicalPayload: values[8],
                    messageCount: values[9],
                    fromLamport: values[10],
                    toLamport: values[11],
                    chain: 'solana',
                    memoText: values[12],
                    txSignature: null,
                    txSlot: null,
                    status: 'pending',
                    errorMessage: null,
                    createdAt: now,
                    anchoredAt: null,
                    updatedAt: now,
                };
                return 1;
            }
            if (sql.includes('UPDATE collab_edit_anchor_batches') || sql.includes('UPDATE discussion_draft_anchor_batches')) {
                if (!row) return 0;
                row = {
                    ...row,
                    status: values[0],
                    txSignature: values[1] ?? null,
                    txSlot: values[2] ?? null,
                    errorMessage: values[3] ?? null,
                    anchoredAt: values[0] === 'anchored' ? now : row.anchoredAt,
                    updatedAt: now,
                };
                return 1;
            }
            throw new Error(`unexpected ${table} query: ${sql}`);
        }),
    };

    return {
        prisma,
        getRow: () => row,
    };
}

beforeEach(() => {
    jest.clearAllMocks();
    jest.useFakeTimers().setSystemTime(new Date('2026-04-29T16:40:00.000Z'));
    process.env = {
        ...originalEnv,
        NODE_ENV: 'production',
        ANCHOR_SIGNER_MODE: 'external',
        ANCHOR_SIGNER_URL: 'http://anchor-signer.local/sign',
        ANCHOR_SIGNER_AUTH_TOKEN: 'test-token',
    };
    (submitMemoAnchorWithSigner as jest.Mock).mockResolvedValue({
        signature: '5'.repeat(88),
        slot: BigInt(123),
    } as never);
});

afterEach(() => {
    jest.useRealTimers();
    process.env = originalEnv;
});

describe('anchor retry', () => {
    test('collab edit anchors can retry a previously skipped batch after config is enabled', async () => {
        const { prisma, getRow } = buildPrismaMock('collab');
        const input = {
            prisma,
            draftPostId: 42,
            circleId: 7,
            roomKey: 'crucible-42',
            snapshotHash: '1'.repeat(64),
            generatedAt: new Date('2026-04-29T11:00:00.000Z'),
            updates: [{
                seq: 1,
                updateHash: '2'.repeat(64),
                updateBytes: 128,
                editorUserId: 9,
                editorHandle: null,
                receivedAt: new Date('2026-04-29T11:00:00.000Z'),
            }],
        };

        process.env.COLLAB_EDIT_ANCHOR_ENABLED = 'false';
        const skipped = await createCollabEditAnchorBatch(input);
        expect(skipped.status).toBe('skipped');
        expect(skipped.errorMessage).toBe('COLLAB_EDIT_ANCHOR_ENABLED=false');
        expect(submitMemoAnchorWithSigner).not.toHaveBeenCalled();

        process.env.COLLAB_EDIT_ANCHOR_ENABLED = 'true';
        process.env.COLLAB_EDIT_ANCHOR_WRITER_ENABLED = 'true';
        const retried = await createCollabEditAnchorBatch(input);
        expect(retried.status).toBe('anchored');
        expect(retried.errorMessage).toBeNull();
        expect(getRow()?.status).toBe('anchored');
        expect(submitMemoAnchorWithSigner).toHaveBeenCalledTimes(1);
    });

    test('discussion draft anchors can retry a previously skipped batch after config is enabled', async () => {
        const { prisma, getRow } = buildPrismaMock('draft');
        const input = {
            prisma,
            circleId: 7,
            draftPostId: 42,
            roomKey: 'circle:7',
            triggerReason: 'focused_discussion',
            summaryText: 'summary',
            summaryMethod: 'rule',
            messages: [{
                envelopeId: 'env-1',
                payloadHash: '3'.repeat(64),
                lamport: BigInt(100),
                senderPubkey: '11111111111111111111111111111112',
                createdAt: new Date('2026-04-29T11:00:00.000Z'),
                semanticScore: 0.8,
                relevanceMethod: 'rule',
            }],
        };

        process.env.DRAFT_ANCHOR_ENABLED = 'false';
        const skipped = await createDraftAnchorBatch(input);
        expect(skipped.status).toBe('skipped');
        expect(skipped.errorMessage).toBe('DRAFT_ANCHOR_ENABLED=false');
        expect(submitMemoAnchorWithSigner).not.toHaveBeenCalled();

        process.env.DRAFT_ANCHOR_ENABLED = 'true';
        process.env.DRAFT_ANCHOR_WRITER_ENABLED = 'true';
        const retried = await createDraftAnchorBatch(input);

        expect(retried.status).toBe('anchored');
        expect(retried.errorMessage).toBeNull();
        expect(getRow()?.status).toBe('anchored');
        expect(submitMemoAnchorWithSigner).toHaveBeenCalledTimes(1);
    });

    test('collab edit anchors inherit SOLANA_RPC_URL when no anchor-specific RPC is configured', async () => {
        const { prisma } = buildPrismaMock('collab');
        process.env.COLLAB_EDIT_ANCHOR_ENABLED = 'true';
        process.env.COLLAB_EDIT_ANCHOR_WRITER_ENABLED = 'true';
        process.env.SOLANA_RPC_URL = 'https://api.devnet.solana.com';
        delete process.env.COLLAB_EDIT_ANCHOR_RPC_URL;
        delete process.env.DRAFT_ANCHOR_RPC_URL;
        delete process.env.RPC_ENDPOINT;

        await createCollabEditAnchorBatch({
            prisma,
            draftPostId: 42,
            circleId: 7,
            roomKey: 'crucible-42',
            snapshotHash: '1'.repeat(64),
            generatedAt: new Date('2026-04-29T11:00:00.000Z'),
            updates: [{
                seq: 1,
                updateHash: '2'.repeat(64),
                updateBytes: 128,
                editorUserId: 9,
                editorHandle: null,
                receivedAt: new Date('2026-04-29T11:00:00.000Z'),
            }],
        });

        expect(submitMemoAnchorWithSigner).toHaveBeenCalledWith(expect.objectContaining({
            config: expect.objectContaining({
                rpcUrl: 'https://api.devnet.solana.com',
            }),
        }));
    });

    test('discussion draft anchors inherit SOLANA_RPC_URL when no anchor-specific RPC is configured', async () => {
        const { prisma } = buildPrismaMock('draft');
        process.env.DRAFT_ANCHOR_ENABLED = 'true';
        process.env.DRAFT_ANCHOR_WRITER_ENABLED = 'true';
        process.env.SOLANA_RPC_URL = 'https://api.devnet.solana.com';
        delete process.env.DRAFT_ANCHOR_RPC_URL;
        delete process.env.RPC_ENDPOINT;

        await createDraftAnchorBatch({
            prisma,
            circleId: 7,
            draftPostId: 42,
            roomKey: 'circle:7',
            triggerReason: 'focused_discussion',
            summaryText: 'summary',
            summaryMethod: 'rule',
            messages: [{
                envelopeId: 'env-1',
                payloadHash: '3'.repeat(64),
                lamport: BigInt(100),
                senderPubkey: '11111111111111111111111111111112',
                createdAt: new Date('2026-04-29T11:00:00.000Z'),
                semanticScore: 0.8,
                relevanceMethod: 'rule',
            }],
        });

        expect(submitMemoAnchorWithSigner).toHaveBeenCalledWith(expect.objectContaining({
            config: expect.objectContaining({
                rpcUrl: 'https://api.devnet.solana.com',
            }),
        }));
    });
});
