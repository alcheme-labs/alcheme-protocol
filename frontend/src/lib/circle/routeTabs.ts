import type { NotificationTab } from '@/lib/notifications/routing';

const ROUTE_TAB_ALIASES: Record<string, NotificationTab> = {
    plaza: 'plaza',
    discussion: 'plaza',
    feed: 'feed',
    crucible: 'crucible',
    draft: 'crucible',
    drafts: 'crucible',
    sanctuary: 'sanctuary',
    knowledge: 'sanctuary',
};

export function normalizeCircleRouteTab(raw: string | null): NotificationTab | null {
    const key = String(raw || '').trim().toLowerCase();
    if (!key) return null;
    return ROUTE_TAB_ALIASES[key] || null;
}
