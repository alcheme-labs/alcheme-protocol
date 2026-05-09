import crypto from 'crypto';
import {
    createDraftAnchorBatch,
    type DraftAnchorCanonicalPayload,
    type DraftAnchorRecord,
    verifyDraftAnchor,
} from '../draftAnchor';

jest.mock('../settlement/solanaAdapter', () => ({
    SolanaMemoSettlementAdapter: jest.fn().mockImplementation(() => ({
        submitAnchor: jest.fn(async () => ({
            settlementTxId: '5'.repeat(88),
            slotOrHeight: '456',
            finality: {
                status: 'confirmed',
                commitment: 'confirmed',
                indexed: false,
                final: false,
            },
            adapterEvidence: {},
        })),
    })),
}));

const { SolanaMemoSettlementAdapter: mockSolanaMemoSettlementAdapter } =
    jest.requireMock('../settlement/solanaAdapter') as {
        SolanaMemoSettlementAdapter: jest.Mock;
    };

function sha256Hex(input: string): string {
    return crypto.createHash('sha256').update(input).digest('hex');
}

function stableSortValue(input: unknown): unknown {
    if (Array.isArray(input)) {
        return input.map(stableSortValue);
    }
    if (input && typeof input === 'object') {
        const record = input as Record<string, unknown>;
        const output: Record<string, unknown> = {};
        Object.keys(record)
            .sort()
            .forEach((key) => {
                const value = record[key];
                if (value !== undefined) output[key] = stableSortValue(value);
            });
        return output;
    }
    return input;
}

function stableStringify(input: unknown): string {
    return JSON.stringify(stableSortValue(input));
}

function buildMessagesDigest(messages: DraftAnchorCanonicalPayload['messages']): string {
    const compact = messages.map((item) => `${item.lamport}:${item.envelopeId}:${item.payloadHash}`);
    return sha256Hex(compact.join('|'));
}

function buildRecord(status: DraftAnchorRecord['status']): DraftAnchorRecord {
    const messages: DraftAnchorCanonicalPayload['messages'] = [
        {
            envelopeId: 'env-1',
            payloadHash: '1'.repeat(64),
            lamport: '100',
            senderPubkey: '11111111111111111111111111111112',
            createdAt: '2026-03-13T12:00:00.000Z',
            semanticScore: 0.8,
            relevanceMethod: 'rule',
        },
    ];
    const messagesDigest = buildMessagesDigest(messages);
    const payload: DraftAnchorCanonicalPayload = {
        version: 1,
        anchorType: 'discussion_draft_trigger',
        roomKey: 'circle:7',
        circleId: 7,
        draftPostId: 42,
        triggerReason: 'focused_discussion',
        summaryMethod: 'rule',
        summaryHash: 'b'.repeat(64),
        messagesDigest,
        messageCount: messages.length,
        fromLamport: '100',
        toLamport: '100',
        generatedAt: '2026-03-13T12:00:00.000Z',
        messages,
    };
    const payloadHash = sha256Hex(stableStringify(payload));

    return {
        anchorId: payloadHash,
        circleId: payload.circleId,
        draftPostId: payload.draftPostId,
        roomKey: payload.roomKey,
        triggerReason: payload.triggerReason,
        summaryHash: payload.summaryHash,
        messagesDigest: payload.messagesDigest,
        payloadHash,
        canonicalPayload: payload,
        messageCount: payload.messageCount,
        fromLamport: payload.fromLamport,
        toLamport: payload.toLamport,
        chain: 'solana:localnet',
        memoText: `anchor:${payloadHash}:summary:${payload.summaryHash}:digest:${payload.messagesDigest}`,
        txSignature: '3'.repeat(88),
        txSlot: '123',
        status,
        errorMessage: null,
        createdAt: '2026-03-13T12:00:00.000Z',
        anchoredAt: status === 'anchored' ? '2026-03-13T12:00:01.000Z' : null,
        updatedAt: '2026-03-13T12:00:01.000Z',
    };
}

describe('draftAnchor', () => {
    const envBackup = { ...process.env };

    afterEach(() => {
        jest.useRealTimers();
        process.env = { ...envBackup };
        jest.clearAllMocks();
    });

    test('treats pending anchors as non-verifiable for contributor-proof usage', () => {
        const proof = verifyDraftAnchor(buildRecord('pending'));
        expect(proof.verifiable).toBe(false);
    });

    test('accepts anchored records when canonical payload and memo all match', () => {
        const proof = verifyDraftAnchor(buildRecord('anchored'));
        expect(proof.verifiable).toBe(true);
    });

    test('submits draft anchors through the Solana settlement adapter', async () => {
        jest.useFakeTimers();
        jest.setSystemTime(new Date('2026-03-13T12:00:02.000Z'));
        process.env.DRAFT_ANCHOR_SIGNER_MODE = 'external';
        process.env.DRAFT_ANCHOR_SIGNER_URL = 'http://signer.example.test';

        const finalRecord = buildRecord('anchored');
        const prisma = {
            $queryRaw: jest.fn()
                .mockResolvedValueOnce([])
                .mockResolvedValueOnce([{ anchorId: finalRecord.anchorId }])
                .mockResolvedValueOnce([{
                    ...finalRecord,
                    fromLamport: BigInt(finalRecord.fromLamport as string),
                    toLamport: BigInt(finalRecord.toLamport as string),
                    txSlot: BigInt(finalRecord.txSlot as string),
                    createdAt: new Date(finalRecord.createdAt),
                    anchoredAt: new Date(finalRecord.anchoredAt as string),
                    updatedAt: new Date(finalRecord.updatedAt),
                }]),
            $executeRaw: jest.fn(async () => 1),
        };

        const result = await createDraftAnchorBatch({
            prisma: prisma as any,
            circleId: 7,
            draftPostId: 42,
            roomKey: 'circle:7',
            triggerReason: 'focused_discussion',
            summaryText: 'summary text',
            summaryMethod: 'rule',
            messages: [{
                envelopeId: 'env-1',
                payloadHash: '1'.repeat(64),
                lamport: 100n,
                senderPubkey: '11111111111111111111111111111112',
                createdAt: new Date('2026-03-13T12:00:00.000Z'),
                semanticScore: 0.8,
                relevanceMethod: 'rule',
            }],
        });

        expect(mockSolanaMemoSettlementAdapter).toHaveBeenCalledTimes(1);
        const adapterInstance = mockSolanaMemoSettlementAdapter.mock.results[0].value as {
            submitAnchor: jest.Mock;
        };
        expect(adapterInstance.submitAnchor).toHaveBeenCalledWith(expect.objectContaining({
            anchorPayload: expect.objectContaining({
                anchorType: 'discussion_draft_trigger',
                sourceId: 'draft:42',
                sourceScope: 'circle:7',
            }),
            memoText: expect.stringContaining('alcheme-draft-anchor:v1:'),
            signerConfig: expect.objectContaining({
                mode: 'external',
                signerLabel: 'discussion_draft_anchor',
            }),
        }));
        expect(result.txSignature).toBe('3'.repeat(88));
    });
});
