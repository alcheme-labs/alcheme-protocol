import type { PlazaAnchoredInteractionType } from './types.ts';

export type AnchoredInteractionActionScope = 'participant' | 'creator' | 'asset_recorder';

export interface AnchoredInteractionTypeSchema {
    type: PlazaAnchoredInteractionType;
    interactionClass: 'display' | 'aggregate';
    canFormKnowledgeResult: boolean;
}

export const ANCHORED_INTERACTION_TYPE_SCHEMAS: Record<PlazaAnchoredInteractionType, AnchoredInteractionTypeSchema> = {
    signup: { type: 'signup', interactionClass: 'aggregate', canFormKnowledgeResult: true },
    poll: { type: 'poll', interactionClass: 'aggregate', canFormKnowledgeResult: true },
    challenge: { type: 'challenge', interactionClass: 'aggregate', canFormKnowledgeResult: true },
    announcement: { type: 'announcement', interactionClass: 'display', canFormKnowledgeResult: false },
    support: { type: 'support', interactionClass: 'aggregate', canFormKnowledgeResult: false },
    tip: { type: 'tip', interactionClass: 'aggregate', canFormKnowledgeResult: false },
    bounty: { type: 'bounty', interactionClass: 'aggregate', canFormKnowledgeResult: true },
};
