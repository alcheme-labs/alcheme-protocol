type RequestedCircleTab = 'plaza' | 'feed' | 'crucible' | 'sanctuary' | null;

interface RestorableSubCircle {
    id: string;
    tabs: string[];
    accessRequirement: {
        type: 'free' | 'crystal';
        minCrystals?: number;
    };
}

interface ResolvePreferredActiveTierIdInput {
    circleId: number;
    routeTierId: string | null;
    defaultTierId: string;
    savedTierId: string | null;
    requestedRouteTab: RequestedCircleTab;
    focusEnvelopeId: string | null;
    userCrystals: number;
    subCircles: RestorableSubCircle[];
}

function canAccessSavedTier(
    circle: RestorableSubCircle | null,
    userCrystals: number,
): boolean {
    if (!circle) return false;
    if (circle.accessRequirement.type !== 'crystal') {
        return true;
    }
    return userCrystals >= (circle.accessRequirement.minCrystals ?? 0);
}

function canUseSavedTierForRoute(
    circle: RestorableSubCircle | null,
    requestedRouteTab: RequestedCircleTab,
): boolean {
    if (!circle) return false;
    if (!requestedRouteTab) {
        return true;
    }
    return circle.tabs.includes(requestedRouteTab);
}

export function resolvePreferredActiveTierId(
    input: ResolvePreferredActiveTierIdInput,
): string {
    const savedCircle = input.savedTierId
        ? input.subCircles.find((circle) => circle.id === input.savedTierId) || null
        : null;
    const savedTierAvailable = canAccessSavedTier(savedCircle, input.userCrystals)
        && canUseSavedTierForRoute(savedCircle, input.requestedRouteTab);
    const routeTierIsRoot = input.routeTierId === String(input.circleId);

    if (input.focusEnvelopeId && input.routeTierId) {
        return input.routeTierId;
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
