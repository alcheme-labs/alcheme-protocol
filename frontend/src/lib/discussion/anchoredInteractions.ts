export const DISCUSSION_ANCHORED_INTERACTION_TYPES = [
    'signup',
    'poll',
    'challenge',
    'announcement',
    'support',
    'tip',
    'bounty',
] as const;

export type DiscussionAnchoredInteractionType = (typeof DISCUSSION_ANCHORED_INTERACTION_TYPES)[number];
export type DiscussionAnchoredInteractionClass = 'display' | 'aggregate';
export type DiscussionAnchoredInteractionStatus = 'open' | 'closed' | 'resolved' | 'archived';
export type DiscussionAnchoredResultStatus = 'none' | 'pending' | 'ignored' | 'resolved' | 'superseded';

export interface DiscussionAnchoredInteractionDto {
    interactionId: string;
    circleId: number;
    anchor: {
        type: 'discussion_message' | 'freeform';
        ref: string;
    };
    interactionType: DiscussionAnchoredInteractionType;
    interactionClass: DiscussionAnchoredInteractionClass;
    status: DiscussionAnchoredInteractionStatus;
    projectionVersion: number;
    projectionCursor: number;
    resultStatus: DiscussionAnchoredResultStatus;
    resultNoticeEnvelopeId: string | null;
    state: Record<string, unknown>;
    summary: Record<string, unknown>;
    policyVersion: string;
    createdByPubkey: string;
    createdAt: string;
    updatedAt: string;
}

export interface DiscussionAnchoredInteractionResponse {
    interactions: DiscussionAnchoredInteractionDto[];
    watermark?: {
        lastProjectionCursor: number | null;
    };
}
