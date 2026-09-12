import type { AnchoredInteractionActionScope } from './eventRegistry';

export interface AnchoredInteractionPermissionInput {
    actionScope: AnchoredInteractionActionScope;
    eventKind?: string;
    senderPubkey: string;
    createdByPubkey: string;
    actorRole?: string | null;
}

export function canPerformAnchoredInteractionAction(
    input: AnchoredInteractionPermissionInput,
): boolean {
    if (input.actionScope === 'participant') return true;
    if (input.actionScope === 'creator') {
        return input.senderPubkey === input.createdByPubkey || isCircleManagerRole(input.actorRole);
    }
    if (input.actionScope === 'asset_recorder') {
        if (input.eventKind === 'tip_transfer_recorded') return true;
        if (input.eventKind === 'bounty_settlement_recorded' || input.eventKind === 'bounty_refunded') {
            return input.senderPubkey === input.createdByPubkey || isCircleManagerRole(input.actorRole);
        }
        return false;
    }
    return false;
}

function isCircleManagerRole(value: string | null | undefined): boolean {
    return value === 'Owner' || value === 'Admin' || value === 'Moderator';
}
