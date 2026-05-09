import { PublicKey } from '@solana/web3.js';

import type {
    AnchorSignerConfig,
} from '../anchorSigner';
import {
    submitMemoAnchorWithSigner,
} from '../anchorSigner';
import type {
    AnchorPayload,
    AnchorSubmission,
    AnchorVerification,
    AuthoritySnapshot,
    FinalityStatus,
    ReadCheckpointInput,
    SettlementAdapter,
    SettlementCheckpoint,
    SettlementCommitment,
    VerifyAnchorInput,
} from './types';

export const SOLANA_L1_SETTLEMENT_ADAPTER_ID = 'solana-l1';
export const SOLANA_MEMO_PROGRAM_ID = 'MemoSq4gqABAXKb96qnH8TysNcWxMyWCqXgDLGmfcHr';

export interface SubmitSolanaMemoAnchorInput {
    anchorPayload: AnchorPayload;
    memoText: string;
    signerConfig: AnchorSignerConfig;
    memoProgramId?: string;
}

function normalizeCommitment(value: string | undefined): SettlementCommitment {
    const normalized = String(value || 'confirmed').trim().toLowerCase();
    if (normalized === 'processed') return 'processed';
    if (normalized === 'finalized') return 'finalized';
    return 'confirmed';
}

function normalizeChainId(): string {
    return String(
        process.env.SOLANA_CLUSTER
        || process.env.SOLANA_NETWORK
        || process.env.SOLANA_CHAIN_ID
        || 'localnet',
    ).trim() || 'localnet';
}

function toSlotString(value: number | string | bigint | null | undefined): string | null {
    if (value === null || value === undefined) return null;
    if (typeof value === 'bigint') return value.toString();
    if (typeof value === 'number') {
        if (!Number.isFinite(value) || value < 0) return null;
        return Math.floor(value).toString();
    }
    const trimmed = String(value).trim();
    if (!trimmed) return null;
    return /^\d+$/.test(trimmed) ? trimmed : null;
}

function checkpointFinality(input: {
    readCommitment: string;
    indexedSlot: string;
    stale: boolean;
}): FinalityStatus {
    const commitment = normalizeCommitment(input.readCommitment);
    const indexed = Number(input.indexedSlot) > 0 && !input.stale;
    if (!indexed) {
        return {
            status: input.stale ? 'pending' : 'submitted',
            commitment,
            indexed: false,
            final: false,
            reason: input.stale ? 'settlement_checkpoint_stale' : undefined,
        };
    }
    return {
        status: commitment === 'finalized' ? 'finalized' : 'indexed',
        commitment,
        indexed: true,
        final: commitment === 'finalized',
    };
}

export function buildSolanaSettlementCheckpoint(input: ReadCheckpointInput): SettlementCheckpoint {
    const indexedSlot = toSlotString(input.indexedSlot) || '0';
    const headSlot = toSlotString(input.headSlot);
    const readCommitment = normalizeCommitment(input.readCommitment);

    return {
        adapterId: SOLANA_L1_SETTLEMENT_ADAPTER_ID,
        chainFamily: 'svm',
        settlementLayer: 'solana-l1',
        chainId: normalizeChainId(),
        readCommitment,
        indexedSlot,
        headSlot,
        slotLag: input.slotLag,
        finality: checkpointFinality({
            readCommitment,
            indexedSlot,
            stale: input.stale,
        }),
        stale: input.stale,
        generatedAt: input.generatedAt || new Date().toISOString(),
        source: 'sync_checkpoint_plus_runtime_state',
    };
}

export class SolanaMemoSettlementAdapter implements SettlementAdapter {
    readonly adapterId = SOLANA_L1_SETTLEMENT_ADAPTER_ID;
    readonly chainFamily = 'svm' as const;

    async submitAnchor(input: SubmitSolanaMemoAnchorInput): Promise<AnchorSubmission> {
        const memoProgramId = input.memoProgramId || SOLANA_MEMO_PROGRAM_ID;
        const anchored = await submitMemoAnchorWithSigner({
            config: input.signerConfig,
            memoText: input.memoText,
            memoProgramId: new PublicKey(memoProgramId),
        });
        const commitment = normalizeCommitment(input.signerConfig.commitment);
        const slot = toSlotString(anchored.slot);

        return {
            adapterId: this.adapterId,
            chainFamily: this.chainFamily,
            settlementTxId: anchored.signature,
            slotOrHeight: slot,
            finality: {
                status: commitment === 'finalized' ? 'finalized' : 'confirmed',
                commitment,
                indexed: false,
                final: commitment === 'finalized',
            },
            submittedAt: new Date().toISOString(),
            adapterEvidence: {
                solana: {
                    signature: anchored.signature,
                    slot: slot || undefined,
                    commitment,
                    memoProgramId,
                    cluster: normalizeChainId(),
                },
            },
        };
    }

    async verifyAnchor(input: VerifyAnchorInput): Promise<AnchorVerification> {
        const memoText = String(input.memoText || '');
        const payloadHashMatches =
            memoText.includes(input.anchorPayload.payloadHash)
            && (!input.anchorPayload.summaryHash || memoText.includes(input.anchorPayload.summaryHash))
            && (!input.anchorPayload.messagesDigest || memoText.includes(input.anchorPayload.messagesDigest));

        return {
            adapterId: this.adapterId,
            verified: payloadHashMatches,
            status: payloadHashMatches ? 'verified' : 'payload_mismatch',
            checkedAt: new Date().toISOString(),
            payloadHashMatches,
            adapterEvidence: input.adapterEvidence || {},
        };
    }

    async resolveAuthority(input: { authorityId: string }): Promise<AuthoritySnapshot> {
        return {
            adapterId: this.adapterId,
            chainFamily: this.chainFamily,
            authorityId: String(input.authorityId || '').trim(),
            slotOrHeight: null,
            finality: {
                status: 'pending',
                indexed: false,
                final: false,
                reason: 'authority_resolution_not_configured',
            },
            adapterEvidence: {},
        };
    }

    async readCheckpoint(input: ReadCheckpointInput): Promise<SettlementCheckpoint> {
        return buildSolanaSettlementCheckpoint(input);
    }
}
