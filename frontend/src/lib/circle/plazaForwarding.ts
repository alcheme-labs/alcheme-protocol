export interface PlazaForwardTarget {
    groupId: number;
    groupName: string;
    subCircleId: string;
    subCircleName: string;
    level: number;
    accessRequirement: { type: 'free' } | { type: 'crystal'; minCrystals: number };
}

export interface PlazaForwardAction {
    enabled: boolean;
    labelKey: 'actions.forward';
    reasonKey:
        | 'viewerNotJoined'
        | 'missingEnvelopeId'
        | 'deleted'
        | 'ephemeral'
        | 'forwardCard'
        | 'noTargets'
        | null;
}

export function getGovernedForwardTargets(input: {
    circles: PlazaForwardTarget[];
    currentLevel: number;
    currentSubCircleId: string;
}): PlazaForwardTarget[] {
    return input.circles.filter((circle) =>
        circle.subCircleId !== input.currentSubCircleId
        && circle.level > input.currentLevel,
    );
}

export function getPlazaForwardAction(input: {
    viewerJoined: boolean;
    envelopeId?: string | null;
    messageKind?: string | null;
    ephemeral?: boolean;
    deleted?: boolean;
    availableTargetCount: number;
}): PlazaForwardAction {
    if (!input.viewerJoined) {
        return {
            enabled: false,
            labelKey: 'actions.forward',
            reasonKey: 'viewerNotJoined',
        };
    }
    if (!input.envelopeId) {
        return {
            enabled: false,
            labelKey: 'actions.forward',
            reasonKey: 'missingEnvelopeId',
        };
    }
    if (input.deleted) {
        return {
            enabled: false,
            labelKey: 'actions.forward',
            reasonKey: 'deleted',
        };
    }
    if (input.ephemeral) {
        return {
            enabled: false,
            labelKey: 'actions.forward',
            reasonKey: 'ephemeral',
        };
    }
    if (input.messageKind === 'forward') {
        return {
            enabled: false,
            labelKey: 'actions.forward',
            reasonKey: 'forwardCard',
        };
    }
    if (input.availableTargetCount <= 0) {
        return {
            enabled: false,
            labelKey: 'actions.forward',
            reasonKey: 'noTargets',
        };
    }
    return {
        enabled: true,
        labelKey: 'actions.forward',
        reasonKey: null,
    };
}
