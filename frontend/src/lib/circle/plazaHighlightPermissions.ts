export interface PlazaHighlightPermissionInput {
    messageId: number;
    highlightedIds: Set<number>;
    walletPubkey: string | null;
    senderPubkey?: string;
    deleted?: boolean;
    ephemeral?: boolean;
}

export function canHighlightPlazaMessage(input: PlazaHighlightPermissionInput): boolean {
    if (!input.walletPubkey) return false;
    if (input.deleted) return false;
    if (input.ephemeral) return false;
    if (input.highlightedIds.has(input.messageId)) return false;
    if (input.walletPubkey && input.senderPubkey && input.walletPubkey === input.senderPubkey) {
        return false;
    }
    return true;
}
