'use client';

import { useCallback, useMemo } from 'react';
import {
    PublicKey,
    SystemProgram,
    Transaction,
    type Connection,
} from '@solana/web3.js';

import type { AnchoredInteractionMutationResponse, AppendAnchoredInteractionEventInput } from '@/lib/api/anchoredInteractions';
import { buildAssetReceiptPayload, type AnchoredAssetReceiptDraft } from './assetReceipts.ts';

interface WalletBackedInteractionActionsInput {
    wallet: {
        publicKey?: string | PublicKey | null;
        sendTransaction?: (transaction: Transaction, connection: Connection) => Promise<string>;
    } | null;
    connection?: Connection | null;
    appendEvent: (input: AppendAnchoredInteractionEventInput) => Promise<AnchoredInteractionMutationResponse>;
}

export interface TipTransferInput {
    recipientPubkey: string;
    amount: string;
    assetType: 'SOL' | 'SPL';
    mint?: string | null;
}

export function useAnchoredInteractionActions({
    wallet,
    connection,
    appendEvent,
}: WalletBackedInteractionActionsInput) {
    const sendTipTransfer = useCallback(async (transfer: TipTransferInput): Promise<AnchoredAssetReceiptDraft> => {
        if (!wallet?.publicKey || !wallet.sendTransaction || !connection) {
            throw new Error('wallet_required_for_asset_receipt');
        }
        if (transfer.assetType !== 'SOL') {
            throw new Error('unsupported_tip_asset');
        }
        const fromPubkey = typeof wallet.publicKey === 'string'
            ? new PublicKey(wallet.publicKey)
            : wallet.publicKey;
        const recipientPubkey = new PublicKey(transfer.recipientPubkey);
        const lamports = parseSolAmountToLamports(transfer.amount);
        const transaction = new Transaction().add(SystemProgram.transfer({
            fromPubkey,
            toPubkey: recipientPubkey,
            lamports,
        }));
        const signature = await wallet.sendTransaction(transaction, connection);
        return {
            receiptId: signature,
            signature,
            recipientPubkey: transfer.recipientPubkey,
            assetType: 'SOL',
            amount: transfer.amount,
            status: 'pending',
        };
    }, [connection, wallet]);

    const recordTipTransferReceipt = useCallback(async (
        input: Omit<AppendAnchoredInteractionEventInput, 'eventKind' | 'payload'> & {
            receipt: AnchoredAssetReceiptDraft;
        },
    ) => {
        return appendEvent({
            ...input,
            eventKind: 'tip_transfer_recorded',
            payload: buildAssetReceiptPayload(input.receipt),
        });
    }, [appendEvent]);

    const recordBountySettlementReceipt = useCallback(async (
        input: Omit<AppendAnchoredInteractionEventInput, 'eventKind' | 'payload'> & {
            receipt: AnchoredAssetReceiptDraft;
        },
    ) => appendEvent({
        ...input,
        eventKind: 'bounty_settlement_recorded',
            payload: buildAssetReceiptPayload(input.receipt),
    }), [appendEvent]);

    return useMemo(() => ({
        sendTipTransfer,
        recordTipTransferReceipt,
        recordBountySettlementReceipt,
    }), [recordBountySettlementReceipt, recordTipTransferReceipt, sendTipTransfer]);
}

const LAMPORTS_PER_SOL_DECIMALS = 9;
const LAMPORTS_PER_SOL_BIGINT = BigInt(1_000_000_000);
const ZERO_LAMPORTS = BigInt(0);

function parseSolAmountToLamports(amount: string): bigint {
    const normalized = amount.trim();
    if (!/^\d+(\.\d{1,9})?$/.test(normalized)) {
        throw new Error('invalid_tip_amount');
    }
    const [wholeRaw, fractionalRaw = ''] = normalized.split('.');
    const lamports = BigInt(wholeRaw) * LAMPORTS_PER_SOL_BIGINT
        + BigInt(fractionalRaw.padEnd(LAMPORTS_PER_SOL_DECIMALS, '0'));
    if (lamports <= ZERO_LAMPORTS) {
        throw new Error('invalid_tip_amount');
    }
    return lamports;
}
