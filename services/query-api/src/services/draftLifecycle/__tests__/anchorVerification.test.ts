import { afterEach, beforeEach, describe, expect, jest, test } from '@jest/globals';
import bs58 from 'bs58';

import {
    verifyArchiveDraftLifecycleAnchor,
    verifyEnterDraftLifecycleCrystallizationAnchor,
    verifyRestoreDraftLifecycleAnchor,
} from '../anchorVerification';

function buildLifecycleInstructionData(input: {
    action: 'entered_crystallization' | 'archived' | 'restored';
    draftPostId: number;
    policyProfileDigest: string;
}): string {
    const discriminator = input.action === 'archived'
        ? Buffer.from([144, 73, 185, 174, 105, 18, 156, 186])
        : input.action === 'restored'
            ? Buffer.from([230, 49, 121, 211, 206, 153, 97, 103])
            : Buffer.from([92, 212, 147, 210, 46, 24, 57, 164]);
    const draftPostId = Buffer.alloc(8);
    draftPostId.writeBigUInt64LE(BigInt(input.draftPostId));
    const digest = Buffer.from(input.policyProfileDigest, 'hex');
    return bs58.encode(Buffer.concat([discriminator, draftPostId, digest]));
}

function buildRpcPayload(overrides?: Record<string, unknown>) {
    return {
        result: {
            blockTime: Math.floor(Date.now() / 1000),
            meta: { err: null },
            transaction: {
                signatures: ['5'.repeat(88)],
                message: {
                    accountKeys: [
                        { pubkey: 'Actor111111111111111111111111111111111111111', signer: true },
                    ],
                    instructions: [
                        {
                            programId: 'FEut65PCemjUt7dRPe4GJhaj1u5czWndvgp7LCEbiV7y',
                            accounts: [
                                'Actor111111111111111111111111111111111111111',
                                'EventProgram11111111111111111111111111111111',
                            ],
                            data: buildLifecycleInstructionData({
                                action: 'entered_crystallization',
                                draftPostId: 42,
                                policyProfileDigest: 'a'.repeat(64),
                            }),
                        },
                    ],
                },
            },
            ...(overrides || {}),
        },
    };
}

describe('draft lifecycle anchor verification', () => {
    beforeEach(() => {
        process.env.NEXT_PUBLIC_CONTENT_PROGRAM_ID = 'FEut65PCemjUt7dRPe4GJhaj1u5czWndvgp7LCEbiV7y';
        process.env.SOLANA_RPC_URL = 'http://127.0.0.1:8899';
    });

    afterEach(() => {
        jest.restoreAllMocks();
        delete process.env.NEXT_PUBLIC_CONTENT_PROGRAM_ID;
        delete process.env.SOLANA_RPC_URL;
        delete process.env.DRAFT_LIFECYCLE_ANCHOR_LOOKUP_ATTEMPTS;
        delete process.env.DRAFT_LIFECYCLE_ANCHOR_LOOKUP_DELAY_MS;
        delete process.env.DRAFT_LIFECYCLE_ANCHOR_RPC_TIMEOUT_MS;
    });

    test('accepts a confirmed crystallization milestone transaction for the same actor, draft, and digest', async () => {
        const fetchSpy = jest.fn<any>(async () => ({
            ok: true,
            json: async () => buildRpcPayload(),
        }));
        (global as any).fetch = fetchSpy;

        const result = await verifyEnterDraftLifecycleCrystallizationAnchor({
            actorPubkey: 'Actor111111111111111111111111111111111111111',
            anchorSignature: '5'.repeat(88),
            draftPostId: 42,
            policyProfileDigest: 'a'.repeat(64),
        });

        expect(result).toEqual({ ok: true });
        const requestInit = fetchSpy.mock.calls[0]?.[1] as RequestInit | undefined;
        const body = JSON.parse(String(requestInit?.body || '{}'));
        expect(body.params?.[1]?.commitment).toBe('confirmed');
    });

    test('retries transaction lookup before returning anchor_tx_not_found', async () => {
        process.env.DRAFT_LIFECYCLE_ANCHOR_LOOKUP_ATTEMPTS = '3';
        process.env.DRAFT_LIFECYCLE_ANCHOR_LOOKUP_DELAY_MS = '1';
        const fetchSpy = jest.fn<any>(async () => ({
            ok: true,
            json: async () => ({ result: null }),
        }));
        (global as any).fetch = fetchSpy;

        const result = await verifyEnterDraftLifecycleCrystallizationAnchor({
            actorPubkey: 'Actor111111111111111111111111111111111111111',
            anchorSignature: '5'.repeat(88),
            draftPostId: 42,
            policyProfileDigest: 'a'.repeat(64),
        });

        expect(result).toEqual({
            ok: false,
            reason: 'anchor_tx_not_found',
        });
        expect(fetchSpy).toHaveBeenCalledTimes(3);
    });

    test('rejects transactions whose instruction digest does not match the submitted public digest', async () => {
        (global as any).fetch = jest.fn(async () => ({
            ok: true,
            json: async () => buildRpcPayload(),
        }));

        const result = await verifyEnterDraftLifecycleCrystallizationAnchor({
            actorPubkey: 'Actor111111111111111111111111111111111111111',
            anchorSignature: '5'.repeat(88),
            draftPostId: 42,
            policyProfileDigest: 'b'.repeat(64),
        });

        expect(result).toEqual({
            ok: false,
            reason: 'anchor_digest_mismatch',
        });
    });

    test('rejects transactions that are missing the crystallization milestone instruction for the requested draft', async () => {
        (global as any).fetch = jest.fn(async () => ({
            ok: true,
            json: async () => buildRpcPayload({
                transaction: {
                    signatures: ['5'.repeat(88)],
                    message: {
                        accountKeys: [
                            { pubkey: 'Actor111111111111111111111111111111111111111', signer: true },
                        ],
                        instructions: [
                            {
                                programId: 'FEut65PCemjUt7dRPe4GJhaj1u5czWndvgp7LCEbiV7y',
                                accounts: [
                                    'Actor111111111111111111111111111111111111111',
                                    'EventProgram11111111111111111111111111111111',
                                ],
                                data: buildLifecycleInstructionData({
                                    action: 'entered_crystallization',
                                    draftPostId: 41,
                                    policyProfileDigest: 'a'.repeat(64),
                                }),
                            },
                        ],
                    },
                },
            }),
        }));

        const result = await verifyEnterDraftLifecycleCrystallizationAnchor({
            actorPubkey: 'Actor111111111111111111111111111111111111111',
            anchorSignature: '5'.repeat(88),
            draftPostId: 42,
            policyProfileDigest: 'a'.repeat(64),
        });

        expect(result).toEqual({
            ok: false,
            reason: 'anchor_draft_post_mismatch',
        });
    });

    test('rejects verification when the content program id is not configured', async () => {
        delete process.env.NEXT_PUBLIC_CONTENT_PROGRAM_ID;

        (global as any).fetch = jest.fn(async () => ({
            ok: true,
            json: async () => buildRpcPayload(),
        }));

        const result = await verifyEnterDraftLifecycleCrystallizationAnchor({
            actorPubkey: 'Actor111111111111111111111111111111111111111',
            anchorSignature: '5'.repeat(88),
            draftPostId: 42,
            policyProfileDigest: 'a'.repeat(64),
        });

        expect(result).toEqual({
            ok: false,
            reason: 'content_program_id_unconfigured',
        });
    });

    test('rejects crystallization anchors whose block time is older than the current workflow transition', async () => {
        (global as any).fetch = jest.fn(async () => ({
            ok: true,
            json: async () => buildRpcPayload({
                blockTime: 100,
            }),
        }));

        const result = await verifyEnterDraftLifecycleCrystallizationAnchor({
            actorPubkey: 'Actor111111111111111111111111111111111111111',
            anchorSignature: '5'.repeat(88),
            draftPostId: 42,
            policyProfileDigest: 'a'.repeat(64),
            minimumAcceptedAt: '1970-01-01T00:01:41.000Z',
        });

        expect(result).toEqual({
            ok: false,
            reason: 'anchor_tx_stale',
        });
    });

    test('accepts crystallization anchors whose block time is in the same second as the current workflow transition', async () => {
        (global as any).fetch = jest.fn(async () => ({
            ok: true,
            json: async () => buildRpcPayload({
                blockTime: 101,
            }),
        }));

        const result = await verifyEnterDraftLifecycleCrystallizationAnchor({
            actorPubkey: 'Actor111111111111111111111111111111111111111',
            anchorSignature: '5'.repeat(88),
            draftPostId: 42,
            policyProfileDigest: 'a'.repeat(64),
            minimumAcceptedAt: '1970-01-01T00:01:41.500Z',
        });

        expect(result).toEqual({ ok: true });
    });

    test('rejects crystallization anchors when the signature was already consumed by the previous attempt', async () => {
        (global as any).fetch = jest.fn(async () => ({
            ok: true,
            json: async () => buildRpcPayload(),
        }));

        const result = await verifyEnterDraftLifecycleCrystallizationAnchor({
            actorPubkey: 'Actor111111111111111111111111111111111111111',
            anchorSignature: '5'.repeat(88),
            draftPostId: 42,
            policyProfileDigest: 'a'.repeat(64),
            reusedAnchorSignature: '5'.repeat(88),
        });

        expect(result).toEqual({
            ok: false,
            reason: 'anchor_signature_reused',
        });
    });

    test('accepts archive milestones only when the archive instruction matches the draft and digest', async () => {
        (global as any).fetch = jest.fn(async () => ({
            ok: true,
            json: async () => buildRpcPayload({
                transaction: {
                    signatures: ['5'.repeat(88)],
                    message: {
                        accountKeys: [
                            { pubkey: 'Actor111111111111111111111111111111111111111', signer: true },
                        ],
                        instructions: [
                            {
                                programId: 'FEut65PCemjUt7dRPe4GJhaj1u5czWndvgp7LCEbiV7y',
                                accounts: [
                                    'Actor111111111111111111111111111111111111111',
                                    'EventProgram11111111111111111111111111111111',
                                ],
                                data: buildLifecycleInstructionData({
                                    action: 'archived',
                                    draftPostId: 42,
                                    policyProfileDigest: 'a'.repeat(64),
                                }),
                            },
                        ],
                    },
                },
            }),
        }));

        const result = await verifyArchiveDraftLifecycleAnchor({
            actorPubkey: 'Actor111111111111111111111111111111111111111',
            anchorSignature: '5'.repeat(88),
            draftPostId: 42,
            policyProfileDigest: 'a'.repeat(64),
        });

        expect(result).toEqual({ ok: true });
    });

    test('accepts restore milestones only when the restore instruction matches the draft and digest', async () => {
        (global as any).fetch = jest.fn(async () => ({
            ok: true,
            json: async () => buildRpcPayload({
                transaction: {
                    signatures: ['5'.repeat(88)],
                    message: {
                        accountKeys: [
                            { pubkey: 'Actor111111111111111111111111111111111111111', signer: true },
                        ],
                        instructions: [
                            {
                                programId: 'FEut65PCemjUt7dRPe4GJhaj1u5czWndvgp7LCEbiV7y',
                                accounts: [
                                    'Actor111111111111111111111111111111111111111',
                                    'EventProgram11111111111111111111111111111111',
                                ],
                                data: buildLifecycleInstructionData({
                                    action: 'restored',
                                    draftPostId: 42,
                                    policyProfileDigest: 'a'.repeat(64),
                                }),
                            },
                        ],
                    },
                },
            }),
        }));

        const result = await verifyRestoreDraftLifecycleAnchor({
            actorPubkey: 'Actor111111111111111111111111111111111111111',
            anchorSignature: '5'.repeat(88),
            draftPostId: 42,
            policyProfileDigest: 'a'.repeat(64),
        });

        expect(result).toEqual({ ok: true });
    });
});
