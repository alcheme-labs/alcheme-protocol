import type { CircleAccessRequirement } from './accessPolicy';
import { canOpenTab, type CircleChromeMode } from './chromeTabs';

type RequestedCircleTab = 'plaza' | 'feed' | 'crucible' | 'sanctuary' | 'governance' | null;

interface RestorableSubCircle {
    id: string;
    tabs: string[];
    mode: CircleChromeMode;
    accessRequirement: CircleAccessRequirement;
}

interface ResolvePreferredActiveTierIdInput {
    circleId: number;
    routeTierId: string | null;
    defaultTierId: string;
    savedTierId: string | null;
    shortcutTierId?: string | null;
    requestedRouteTab: RequestedCircleTab;
    focusEnvelopeId: string | null;
    subCircles: RestorableSubCircle[];
}

function canAccessSavedTier(
    circle: RestorableSubCircle | null,
): boolean {
    return circle !== null;
}

function canUseSavedTierForRoute(
    circle: RestorableSubCircle | null,
    requestedRouteTab: RequestedCircleTab,
): boolean {
    if (!circle) return false;
    if (!requestedRouteTab) {
        return true;
    }
    return canOpenTab(circle.tabs, circle.mode, requestedRouteTab);
}

export function resolvePreferredActiveTierId(
    input: ResolvePreferredActiveTierIdInput,
): string {
    const savedCircle = input.savedTierId
        ? input.subCircles.find((circle) => circle.id === input.savedTierId) || null
        : null;
    const shortcutCircle = input.shortcutTierId
        ? input.subCircles.find((circle) => circle.id === input.shortcutTierId) || null
        : null;
    const savedTierAvailable = canAccessSavedTier(savedCircle)
        && canUseSavedTierForRoute(savedCircle, input.requestedRouteTab);
    const shortcutTierAvailable = canAccessSavedTier(shortcutCircle)
        && canUseSavedTierForRoute(shortcutCircle, input.requestedRouteTab);
    const routeTierIsRoot = input.routeTierId === String(input.circleId);

    if (input.focusEnvelopeId && input.routeTierId) {
        return input.routeTierId;
    }

    if (input.routeTierId && !routeTierIsRoot) {
        return input.routeTierId;
    }

    if (shortcutTierAvailable && (!input.routeTierId || routeTierIsRoot)) {
        return shortcutCircle!.id;
    }

    if (savedTierAvailable && (!input.routeTierId || routeTierIsRoot)) {
        return savedCircle!.id;
    }

    if (input.routeTierId) {
        return input.routeTierId;
    }

    if (savedTierAvailable) {
        return savedCircle!.id;
    }

    return input.defaultTierId;
}
