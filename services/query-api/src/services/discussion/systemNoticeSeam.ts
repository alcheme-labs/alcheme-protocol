import { buildStructuredDiscussionMetadata } from './structuredMessageMetadata';

export const DISCUSSION_SYSTEM_NOTICE_KINDS = [
    'draft_candidate_notice',
    'governance_notice',
    'source_material_notice',
    'interaction_result_notice',
] as const;

export type DiscussionSystemNoticeKind = (typeof DISCUSSION_SYSTEM_NOTICE_KINDS)[number];

export interface DiscussionSystemNoticeSeed {
    messageKind: DiscussionSystemNoticeKind;
    metadata: Record<string, unknown>;
    payloadText: string;
    subjectType: string | null;
    subjectId: string | null;
}

function isRecord(value: unknown): value is Record<string, unknown> {
    return Boolean(value) && typeof value === 'object' && !Array.isArray(value);
}

function normalizeSystemNoticeKind(value: unknown): DiscussionSystemNoticeKind | null {
    if (typeof value !== 'string') return null;
    const normalized = value.trim().toLowerCase();
    if (
        normalized === 'draft_candidate_notice'
        || normalized === 'governance_notice'
        || normalized === 'source_material_notice'
        || normalized === 'interaction_result_notice'
    ) {
        return normalized;
    }
    return null;
}

function normalizeOptionalString(value: unknown, maxLength: number): string | null {
    if (typeof value !== 'string') return null;
    const trimmed = value.trim();
    if (!trimmed) return null;
    return trimmed.slice(0, maxLength);
}

function buildDefaultPayloadText(kind: DiscussionSystemNoticeKind): string {
    if (kind === 'draft_candidate_notice') return 'draft candidate notice';
    if (kind === 'source_material_notice') return 'source material accepted to Plaza';
    if (kind === 'interaction_result_notice') return 'anchored interaction result';
    return 'governance notice';
}

export function prepareStructuredDiscussionWriteMetadata(input: unknown): Record<string, unknown> | null {
    return buildStructuredDiscussionMetadata(input);
}

export function buildDiscussionSystemNoticeSeed(input: {
    messageKind: unknown;
    metadata: unknown;
    payloadText?: unknown;
    subjectType?: unknown;
    subjectId?: unknown;
}): DiscussionSystemNoticeSeed | null {
    const messageKind = normalizeSystemNoticeKind(input.messageKind);
    if (!messageKind) return null;

    if (!isRecord(input.metadata)) {
        return null;
    }

    const payloadText = normalizeOptionalString(input.payloadText, 2000)
        || buildDefaultPayloadText(messageKind);
    const subjectType = normalizeOptionalString(input.subjectType, 32);
    const subjectId = normalizeOptionalString(input.subjectId, 128);

    return {
        messageKind,
        metadata: input.metadata,
        payloadText,
        subjectType,
        subjectId,
    };
}
