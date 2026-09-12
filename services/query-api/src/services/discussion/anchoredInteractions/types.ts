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

export interface DiscussionAnchoredInteractionRow {
    interactionId: string;
    circleId: number;
    anchorType: string;
    anchorRef: string;
    interactionType: string;
    interactionClass: string;
    status: string;
    projectionVersion: number;
    projectionCursor: bigint | number;
    resultStatus: string;
    resultNoticeEnvelopeId: string | null;
    state: unknown;
    summary: unknown;
    policyVersion: string;
    createdByPubkey: string;
    createdAt: Date | string;
    updatedAt: Date | string;
}

const INTERACTION_TYPE_SET = new Set<string>(PLAZA_ANCHORED_INTERACTION_TYPES);
const STATUS_SET = new Set<string>(['open', 'closed', 'resolved', 'archived']);
const RESULT_STATUS_SET = new Set<string>(['none', 'pending', 'ignored', 'resolved', 'superseded']);

export function normalizeAnchoredInteractionType(value: unknown): PlazaAnchoredInteractionType | null {
    if (typeof value !== 'string') return null;
    return INTERACTION_TYPE_SET.has(value)
        ? value as PlazaAnchoredInteractionType
        : null;
}

export function getAnchoredInteractionClass(
    type: PlazaAnchoredInteractionType,
): PlazaAnchoredInteractionClass {
    return type === 'announcement' ? 'display' : 'aggregate';
}

export function isAggregateAnchoredInteractionType(type: PlazaAnchoredInteractionType): boolean {
    return getAnchoredInteractionClass(type) === 'aggregate';
}

export function toDiscussionAnchoredInteractionDto(
    row: DiscussionAnchoredInteractionRow,
): DiscussionAnchoredInteractionDto {
    const interactionType = normalizeAnchoredInteractionType(row.interactionType);
    if (!interactionType) {
        throw new Error('unsupported_anchored_interaction_type');
    }
    const interactionClass = row.interactionClass === 'display' || row.interactionClass === 'aggregate'
        ? row.interactionClass
        : getAnchoredInteractionClass(interactionType);
    const status = STATUS_SET.has(row.status)
        ? row.status as PlazaAnchoredInteractionStatus
        : 'open';
    const resultStatus = RESULT_STATUS_SET.has(row.resultStatus)
        ? row.resultStatus as PlazaAnchoredResultStatus
        : 'none';

    return {
        interactionId: row.interactionId,
        circleId: row.circleId,
        anchor: {
            type: row.anchorType === 'freeform' ? 'freeform' : 'discussion_message',
            ref: row.anchorRef,
        },
        interactionType,
        interactionClass,
        status,
        projectionVersion: row.projectionVersion,
        projectionCursor: Number(row.projectionCursor),
        resultStatus,
        resultNoticeEnvelopeId: row.resultNoticeEnvelopeId,
        state: normalizeRecord(row.state),
        summary: normalizeRecord(row.summary),
        policyVersion: row.policyVersion,
        createdByPubkey: row.createdByPubkey,
        createdAt: toIsoString(row.createdAt),
        updatedAt: toIsoString(row.updatedAt),
    };
}

function normalizeRecord(value: unknown): Record<string, unknown> {
    return value && typeof value === 'object' && !Array.isArray(value)
        ? value as Record<string, unknown>
        : {};
}

function toIsoString(value: Date | string): string {
    return value instanceof Date ? value.toISOString() : new Date(value).toISOString();
}
