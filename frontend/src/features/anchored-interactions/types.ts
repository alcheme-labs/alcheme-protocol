export const PLAZA_ANCHORED_INTERACTION_TYPES = [
    'signup',
    'poll',
    'challenge',
    'announcement',
    'support',
    'tip',
    'bounty',
] as const;

export type PlazaAnchoredInteractionType = (typeof PLAZA_ANCHORED_INTERACTION_TYPES)[number];
export type PlazaAnchoredInteractionClass = 'display' | 'aggregate';
export type PlazaAnchoredInteractionStatus = 'open' | 'closed' | 'resolved' | 'archived';
export type PlazaAnchoredResultStatus = 'none' | 'pending' | 'ignored' | 'resolved' | 'superseded';

export interface DiscussionAnchoredInteractionDto {
    interactionId: string;
    circleId: number;
    anchor: {
        type: 'discussion_message' | 'freeform';
        ref: string;
    };
    interactionType: PlazaAnchoredInteractionType;
    interactionClass: PlazaAnchoredInteractionClass;
    status: PlazaAnchoredInteractionStatus;
    projectionVersion: number;
    projectionCursor: number;
    resultStatus: PlazaAnchoredResultStatus;
    resultNoticeEnvelopeId: string | null;
    state: Record<string, unknown>;
    summary: Record<string, unknown>;
    policyVersion: string;
    createdByPubkey: string;
    createdByDisplayName?: string | null;
    createdByCircleAlias?: string | null;
    createdByEffectiveDisplayName?: string | null;
    createdByDisplaySource?: string | null;
    createdByDisplayCircleId?: number | null;
    createdAt: string;
    updatedAt: string;
}

export interface DiscussionAnchoredInteractionsResponse {
    circleId: number;
    count: number;
    watermark: {
        lastProjectionCursor: number | null;
    };
    interactions: DiscussionAnchoredInteractionDto[];
}

export interface InteractionResultNoticeView {
    interactionId: string;
    interactionType: PlazaAnchoredInteractionType;
    resultStatus: 'ignored' | 'resolved';
    reasonCode: string;
    humanSummary: string;
    anchorType: 'discussion_message' | 'freeform';
    anchorEnvelopeId: string;
    sourceMessageIds: string[];
    sourceEventIds: string[];
    projectionVersion: number;
}

export interface AnchoredInteractionDetailEvent {
    eventId: string;
    actorPubkey: string | null;
    actorDisplayName?: string | null;
    actorCircleAlias?: string | null;
    actorEffectiveDisplayName?: string | null;
    actorDisplaySource?: string | null;
    actorDisplayCircleId?: number | null;
    actorDisplaySnapshot?: string | null;
    actorDisplaySourceSnapshot?: string | null;
    actorDisplayCircleIdSnapshot?: number | null;
    actorInheritedFromCircleIdSnapshot?: number | null;
    actorDisplaySnapshotAt?: string | null;
    actorAliasSnapshot?: string | null;
    eventKind: string;
    payload: Record<string, unknown>;
    createdAt: string;
}

export interface AnchoredInteractionDetailReceipt {
    receiptId: string;
    receiptType: string;
    status: string;
    actorPubkey: string;
    actorDisplayName?: string | null;
    actorCircleAlias?: string | null;
    actorEffectiveDisplayName?: string | null;
    actorDisplaySource?: string | null;
    actorDisplayCircleId?: number | null;
    actorDisplaySnapshot?: string | null;
    actorDisplaySourceSnapshot?: string | null;
    actorDisplayCircleIdSnapshot?: number | null;
    actorInheritedFromCircleIdSnapshot?: number | null;
    actorDisplaySnapshotAt?: string | null;
    actorAliasSnapshot?: string | null;
    actorNeedsDisplayDisambiguation?: boolean;
    actorDisplayCollisionCount?: number;
    recipientPubkey: string | null;
    recipientDisplayName?: string | null;
    recipientCircleAlias?: string | null;
    recipientEffectiveDisplayName?: string | null;
    recipientDisplaySource?: string | null;
    recipientDisplayCircleId?: number | null;
    recipientDisplaySnapshot?: string | null;
    recipientDisplaySourceSnapshot?: string | null;
    recipientDisplayCircleIdSnapshot?: number | null;
    recipientInheritedFromCircleIdSnapshot?: number | null;
    recipientDisplaySnapshotAt?: string | null;
    recipientAliasSnapshot?: string | null;
    recipientNeedsDisplayDisambiguation?: boolean;
    recipientDisplayCollisionCount?: number;
    assetType: string | null;
    mint?: string | null;
    amount: string | null;
    signature?: string | null;
    createdAt?: string;
    updatedAt?: string;
}

export interface AnchoredInteractionMessagePreview {
    envelopeId: string;
    author: string | null;
    text: string;
    createdAt?: string;
}

export interface AnchoredInteractionDetailDto {
    interaction: DiscussionAnchoredInteractionDto;
    sourceMessage: AnchoredInteractionMessagePreview | null;
    resultNotice: AnchoredInteractionMessagePreview | null;
    events: AnchoredInteractionDetailEvent[];
    receipts: AnchoredInteractionDetailReceipt[];
    sections: Array<'anchor' | 'participation' | 'result' | 'receipts' | 'actions'>;
}
