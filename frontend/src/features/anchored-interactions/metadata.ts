import {
    PLAZA_ANCHORED_INTERACTION_TYPES,
    type InteractionResultNoticeView,
    type PlazaAnchoredInteractionType,
} from './types.ts';

const INTERACTION_TYPE_SET = new Set<string>(PLAZA_ANCHORED_INTERACTION_TYPES);
const RESULT_STATUS_SET = new Set<string>(['ignored', 'resolved']);
const MAX_SOURCE_IDS = 64;

export function parseInteractionResultNoticeMetadata(value: unknown): InteractionResultNoticeView | null {
    const metadata = toRecord(value);
    if (!metadata) return null;
    if (typeof metadata.kind === 'string' && metadata.kind !== 'interaction_result_notice') return null;

    const interactionId = normalizeString(metadata.interactionId);
    const interactionType = normalizeInteractionType(metadata.interactionType);
    const resultStatus = normalizeResultStatus(metadata.resultStatus);
    const reasonCode = normalizeString(metadata.reasonCode);
    const humanSummary = normalizeString(metadata.humanSummary);
    const anchorType = normalizeAnchorType(metadata.anchorType);
    const anchorEnvelopeId = normalizeString(metadata.anchorEnvelopeId);
    const projectionVersion = normalizePositiveInteger(metadata.projectionVersion);
    if (
        !interactionId
        || !interactionType
        || !resultStatus
        || !reasonCode
        || !humanSummary
        || !anchorEnvelopeId
        || projectionVersion === null
    ) {
        return null;
    }

    return {
        interactionId,
        interactionType,
        resultStatus,
        reasonCode,
        humanSummary,
        anchorType,
        anchorEnvelopeId,
        sourceMessageIds: anchorType === 'discussion_message'
            ? normalizeIdList(metadata.sourceMessageIds)
            : [],
        sourceEventIds: normalizeIdList(metadata.sourceEventIds),
        projectionVersion,
    };
}

function toRecord(value: unknown): Record<string, unknown> | null {
    return value && typeof value === 'object' && !Array.isArray(value)
        ? value as Record<string, unknown>
        : null;
}

function normalizeString(value: unknown): string | null {
    return typeof value === 'string' && value.trim() ? value.trim() : null;
}

function normalizeInteractionType(value: unknown): PlazaAnchoredInteractionType | null {
    const normalized = normalizeString(value);
    return normalized && INTERACTION_TYPE_SET.has(normalized)
        ? normalized as PlazaAnchoredInteractionType
        : null;
}

function normalizeResultStatus(value: unknown): 'ignored' | 'resolved' | null {
    const normalized = normalizeString(value);
    return normalized && RESULT_STATUS_SET.has(normalized)
        ? normalized as 'ignored' | 'resolved'
        : null;
}

function normalizeAnchorType(value: unknown): 'discussion_message' | 'freeform' {
    return value === 'freeform' ? 'freeform' : 'discussion_message';
}

function normalizePositiveInteger(value: unknown): number | null {
    const parsed = typeof value === 'number'
        ? value
        : typeof value === 'string'
            ? Number.parseInt(value, 10)
            : NaN;
    return Number.isSafeInteger(parsed) && parsed > 0 ? parsed : null;
}

function normalizeIdList(value: unknown): string[] {
    if (!Array.isArray(value)) return [];
    const seen = new Set<string>();
    for (const item of value) {
        const normalized = normalizeString(item);
        if (!normalized || seen.has(normalized)) continue;
        seen.add(normalized);
        if (seen.size >= MAX_SOURCE_IDS) break;
    }
    return [...seen];
}
