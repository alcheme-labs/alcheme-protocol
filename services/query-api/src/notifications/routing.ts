const GOVERNANCE_TRANSITION_IMPACT_FRAGMENT = 'configuration-transition-impact';
const GOVERNANCE_ACTION_FRAGMENTS = new Set([
    GOVERNANCE_TRANSITION_IMPACT_FRAGMENT,
    'case-responsibility-review',
    'case-decision-stages-title',
    'case-responsibility-execution',
    'case-responsibility-outcome',
    'case-manual-execution-control',
]);

function asRecord(value: unknown): Record<string, unknown> | null {
    return value != null && typeof value === 'object' && !Array.isArray(value)
        ? value as Record<string, unknown>
        : null;
}

export function resolveNotificationCanonicalUrl(notification: {
    sourceType?: unknown;
    sourceId?: unknown;
    metadata?: unknown;
}): string | null {
    const sourceType = String(notification.sourceType || '').trim();
    const sourceId = String(notification.sourceId || '').trim();
    if (sourceType !== 'governance_case' || !sourceId) return null;

    const caseUrl = `/governance/cases/${encodeURIComponent(sourceId)}`;
    const canonicalUrl = String(asRecord(notification.metadata)?.canonicalUrl || '').trim();
    const fragment = canonicalUrl.startsWith(`${caseUrl}#`)
        ? canonicalUrl.slice(caseUrl.length + 1)
        : '';
    if (GOVERNANCE_ACTION_FRAGMENTS.has(fragment)) {
        return canonicalUrl;
    }
    return caseUrl;
}
