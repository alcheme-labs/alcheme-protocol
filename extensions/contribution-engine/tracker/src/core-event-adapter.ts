import {
    ContributionSourceEvent,
    ContributionSourceEventType,
    ProtocolEvent,
    ProtocolEventType,
} from './types';

export const CONTRIBUTION_SOURCE_PROTOCOL_EVENT_TYPES: ProtocolEventType[] = [
    ProtocolEventType.ContentStatusChanged,
];

export function adaptProtocolEvent(event: ProtocolEvent): ContributionSourceEvent | null {
    if (event.type !== ProtocolEventType.ContentStatusChanged) {
        return null;
    }

    const newStatus = event.data['new_status'];
    if (newStatus !== 'CRYSTAL') {
        return null;
    }

    return {
        type: ContributionSourceEventType.CrystalFinalized,
        timestamp: event.timestamp,
        slot: event.slot,
        data: event.data,
    };
}
