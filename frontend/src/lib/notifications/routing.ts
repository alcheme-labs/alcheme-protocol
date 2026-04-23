export type NotificationTab = 'plaza' | 'feed' | 'crucible' | 'sanctuary';

export interface NotificationRouteInput {
    type: string;
    sourceType?: string | null;
    sourceId?: string | null;
    circleId?: number | null;
}

export function buildCircleTabHref(circleId: number, tab: NotificationTab, focusEnvelopeId?: string | null): string {
    const href = `/circles/${circleId}?tab=${tab}`;
    const envelopeId = String(focusEnvelopeId || '').trim();
    if (!envelopeId) return href;
    return `${href}&focusEnvelopeId=${encodeURIComponent(envelopeId)}`;
}

function extractCitationTargetId(sourceId: string): string | null {
    const trimmed = sourceId.trim();
    if (!trimmed.startsWith('ref:')) return trimmed || null;

    const parts = trimmed.split(':');
    if (parts.length < 3) return trimmed || null;

    return parts[parts.length - 1] || null;
}

function normalizeValue(value: string | null | undefined): string {
    return String(value || '').trim().toLowerCase();
}

export function resolveNotificationCircleTab(input: NotificationRouteInput): NotificationTab | null {
    const type = normalizeValue(input.type);
    const sourceType = normalizeValue(input.sourceType);

    if (type === 'draft' || sourceType === 'discussion_trigger') {
        return input.circleId ? 'crucible' : null;
    }

    if (type === 'highlight' || type === 'forward' || sourceType === 'discussion') {
        return input.circleId ? 'plaza' : null;
    }

    if (type === 'post' || sourceType === 'post') {
        return input.circleId ? 'feed' : null;
    }

    return null;
}

export function resolveNotificationHref(input: NotificationRouteInput): string | null {
    const type = normalizeValue(input.type);
    const sourceType = normalizeValue(input.sourceType);
    const sourceId = String(input.sourceId || '').trim();

    if (type === 'citation' && sourceId) {
        const targetId = extractCitationTargetId(sourceId);
        if (targetId) {
            return `/knowledge/${targetId}`;
        }
    }

    if ((sourceType === 'knowledge' || type === 'crystal') && sourceId) {
        return `/knowledge/${sourceId}`;
    }

    const tab = resolveNotificationCircleTab(input);
    if (tab && input.circleId) {
        const href = buildCircleTabHref(input.circleId, tab, type === 'forward' ? sourceId : null);
        if (type === 'forward' && sourceId) {
            return href;
        }
        return href;
    }

    if (input.circleId && (type === 'invite' || type === 'circle' || sourceType === 'circle')) {
        return `/circles/${input.circleId}`;
    }

    if (input.circleId) {
        return `/circles/${input.circleId}`;
    }

    return null;
}
