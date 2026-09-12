export type NotificationTab = 'plaza' | 'feed' | 'crucible' | 'sanctuary' | 'governance';

export interface NotificationRouteInput {
    type: string;
    sourceType?: string | null;
    sourceId?: string | null;
    circleId?: number | null;
    canonicalUrl?: string | null;
}

const GOVERNANCE_ACTION_FRAGMENTS = new Set([
    'configuration-transition-impact',
    'case-responsibility-review',
    'case-review-focus',
    'case-decision-stages-title',
    'case-responsibility-execution',
    'case-responsibility-outcome',
    'case-manual-execution-control',
]);

export function buildCircleTabHref(circleId: number, tab: NotificationTab, focusEnvelopeId?: string | null): string {
    const href = `/circles/${circleId}?tab=${tab}`;
    const envelopeId = String(focusEnvelopeId || '').trim();
    if (!envelopeId) return href;
    return `${href}&focusEnvelopeId=${encodeURIComponent(envelopeId)}`;
}

export function buildCircleAnnouncementHref(circleId: number, announcementId: string): string {
    return `/circles/${circleId}?tab=plaza&announcementId=${encodeURIComponent(announcementId)}`;
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

    if (type === 'useful' || type === 'forward' || type === 'announcement' || sourceType === 'discussion' || sourceType === 'announcement') {
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

    if (sourceType === 'governance_case' && sourceId) {
        const caseUrl = `/governance/cases/${encodeURIComponent(sourceId)}`;
        const canonicalUrl = String(input.canonicalUrl || '').trim();
        const fragment = canonicalUrl.startsWith(`${caseUrl}#`)
            ? canonicalUrl.slice(caseUrl.length + 1)
            : '';
        return GOVERNANCE_ACTION_FRAGMENTS.has(fragment) ? canonicalUrl : caseUrl;
    }

    if (type === 'citation' && sourceId) {
        const targetId = extractCitationTargetId(sourceId);
        if (targetId) {
            return `/knowledge/${targetId}`;
        }
    }

    if ((sourceType === 'knowledge' || type === 'crystal') && sourceId) {
        return `/knowledge/${sourceId}`;
    }

    if ((type === 'announcement' || sourceType === 'announcement') && input.circleId) {
        return sourceId
            ? buildCircleAnnouncementHref(input.circleId, sourceId)
            : buildCircleTabHref(input.circleId, 'plaza');
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
