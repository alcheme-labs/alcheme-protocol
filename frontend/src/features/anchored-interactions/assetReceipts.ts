export type AnchoredAssetReceiptStatus = 'pending' | 'confirmed' | 'failed' | 'unverified';

export interface AnchoredAssetReceiptDraft {
    receiptId: string;
    signature: string | null;
    recipientPubkey: string;
    assetType: 'SOL' | 'SPL';
    mint?: string | null;
    amount: string;
    status: AnchoredAssetReceiptStatus;
}

export function normalizeAssetReceiptStatus(value: unknown): AnchoredAssetReceiptStatus {
    if (value === 'pending' || value === 'confirmed' || value === 'failed' || value === 'unverified') return value;
    return 'pending';
}

export function buildAssetReceiptPayload(receipt: AnchoredAssetReceiptDraft): Record<string, unknown> {
    return {
        receiptId: receipt.receiptId,
        ...(receipt.signature ? { signature: receipt.signature } : {}),
        recipientPubkey: receipt.recipientPubkey,
        assetType: receipt.assetType,
        ...(receipt.mint ? { mint: receipt.mint } : {}),
        amount: receipt.amount,
        status: normalizeAssetReceiptStatus(receipt.status),
    };
}

export function describeAssetReceipt(receipt: {
    status?: unknown;
    signature?: string | null;
    recipientPubkey?: string | null;
    amount?: string | null;
}): string {
    const status = normalizeAssetReceiptStatus(receipt.status);
    return [
        status,
        receipt.amount || '',
        receipt.recipientPubkey || '',
        receipt.signature || '',
    ].filter(Boolean).join(' · ');
}
