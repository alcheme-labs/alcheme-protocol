export interface PlazaUsefulMarkPermissionInput {
    messageId: number;
    usefulMarkedIds: Set<number>;
    viewerPubkey: string | null;
    senderPubkey?: string;
    deleted?: boolean;
    ephemeral?: boolean;
}

export function canMarkPlazaMessageUseful(input: PlazaUsefulMarkPermissionInput): boolean {
    if (!input.viewerPubkey) return false;
    if (input.deleted) return false;
    if (input.ephemeral) return false;
    if (input.usefulMarkedIds.has(input.messageId)) return false;
    if (input.viewerPubkey && input.senderPubkey && input.viewerPubkey === input.senderPubkey) {
        return false;
    }
    return true;
}
