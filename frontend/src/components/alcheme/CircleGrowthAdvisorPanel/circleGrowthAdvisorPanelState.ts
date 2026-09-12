import type { CircleGrowthProposalStatus } from '@/lib/api/circleGrowthAdvisor';

export type CircleGrowthPanelAction = 'reject' | 'snooze' | 'convert';

export function canClearCircleGrowthProposal(status: CircleGrowthProposalStatus): boolean {
    return ['pending', 'ready', 'no_signal', 'failed', 'snoozed'].includes(status);
}

export function canConvertCircleGrowthProposal(status: CircleGrowthProposalStatus): boolean {
    return status === 'ready' || status === 'snoozed';
}

export function isCircleGrowthActionDisabled(input: {
    allowed: boolean;
    panelBusy: boolean;
    hasPendingAction: boolean;
}): boolean {
    return !input.allowed || input.panelBusy || input.hasPendingAction;
}
