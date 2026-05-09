import type { AnchorSignerConfig } from '../../anchorSigner';
import {
    SOLANA_L1_SETTLEMENT_ADAPTER_ID,
    SOLANA_MEMO_PROGRAM_ID,
    SolanaMemoSettlementAdapter,
    buildSolanaSettlementCheckpoint,
} from '../solanaAdapter';
import type { AnchorPayload } from '../types';

jest.mock('../../anchorSigner', () => ({
    submitMemoAnchorWithSigner: jest.fn(async () => ({
        signature: '5'.repeat(88),
        slot: 456n,
    })),
}));

const { submitMemoAnchorWithSigner } = jest.requireMock('../../anchorSigner') as {
    submitMemoAnchorWithSigner: jest.Mock;
};

function anchorPayload(): AnchorPayload {
    return {
        version: 1,
        anchorType: 'discussion_draft_trigger',
        sourceId: 'draft:42',
        sourceScope: 'circle:7',
        payloadHash: 'a'.repeat(64),
        summaryHash: 'b'.repeat(64),
        messagesDigest: 'c'.repeat(64),
        generatedAt: '2026-03-13T12:00:00.000Z',
        canonicalJson: '{"payload":true}',
    };
}

describe('SolanaMemoSettlementAdapter', () => {
    beforeEach(() => {
        submitMemoAnchorWithSigner.mockClear();
    });

    test('submits memo anchors through the signer without leaking signer details into proof core', async () => {
        const adapter = new SolanaMemoSettlementAdapter();
        const signerConfig: AnchorSignerConfig = {
            mode: 'external',
            rpcUrl: 'http://rpc.example.test',
            commitment: 'confirmed',
            keypairPath: '/tmp/keypair.json',
            externalUrl: 'http://signer.example.test',
            externalAuthToken: 'secret',
            externalTimeoutMs: 5000,
            signerLabel: 'discussion_draft_anchor',
        };

        const submission = await adapter.submitAnchor({
            anchorPayload: anchorPayload(),
            memoText: 'alcheme-draft-anchor:v1:anchor',
            signerConfig,
        });

        expect(submitMemoAnchorWithSigner).toHaveBeenCalledWith({
            config: signerConfig,
            memoText: 'alcheme-draft-anchor:v1:anchor',
            memoProgramId: expect.objectContaining({
                toBase58: expect.any(Function),
            }),
        });
        expect(submission.adapterId).toBe(SOLANA_L1_SETTLEMENT_ADAPTER_ID);
        expect(submission.chainFamily).toBe('svm');
        expect(submission.settlementTxId).toBe('5'.repeat(88));
        expect(submission.slotOrHeight).toBe('456');
        expect(submission.finality).toEqual({
            status: 'confirmed',
            commitment: 'confirmed',
            indexed: false,
            final: false,
        });
        expect(submission.adapterEvidence.solana).toMatchObject({
            signature: '5'.repeat(88),
            slot: '456',
            commitment: 'confirmed',
            memoProgramId: SOLANA_MEMO_PROGRAM_ID,
        });
    });

    test('builds a settlement checkpoint from existing indexer consistency state', () => {
        const checkpoint = buildSolanaSettlementCheckpoint({
            readCommitment: 'finalized',
            indexedSlot: 123,
            headSlot: 130,
            slotLag: 7,
            stale: false,
            generatedAt: '2026-05-09T00:00:00.000Z',
        });

        expect(checkpoint).toEqual({
            adapterId: SOLANA_L1_SETTLEMENT_ADAPTER_ID,
            chainFamily: 'svm',
            settlementLayer: 'solana-l1',
            chainId: 'localnet',
            readCommitment: 'finalized',
            indexedSlot: '123',
            headSlot: '130',
            slotLag: 7,
            finality: {
                status: 'finalized',
                commitment: 'finalized',
                indexed: true,
                final: true,
            },
            stale: false,
            generatedAt: '2026-05-09T00:00:00.000Z',
            source: 'sync_checkpoint_plus_runtime_state',
        });
    });
});
