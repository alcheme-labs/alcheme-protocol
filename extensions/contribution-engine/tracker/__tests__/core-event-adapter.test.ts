import { adaptProtocolEvent, CONTRIBUTION_SOURCE_PROTOCOL_EVENT_TYPES } from '../src/core-event-adapter';
import {
    ContributionSourceEventType,
    ProtocolEvent,
    ProtocolEventType,
} from '../src/types';

describe('core-event-adapter', () => {
    it('only registers content status changed as the current contribution source event input', () => {
        expect(CONTRIBUTION_SOURCE_PROTOCOL_EVENT_TYPES).toEqual([ProtocolEventType.ContentStatusChanged]);
    });

    it('maps ContentStatusChanged + CRYSTAL into CrystalFinalized', () => {
        const event: ProtocolEvent = {
            type: ProtocolEventType.ContentStatusChanged,
            timestamp: 1,
            slot: 99,
            data: {
                content_id: '11111111111111111111111111111111',
                new_status: 'CRYSTAL',
            },
        };

        const adapted = adaptProtocolEvent(event);
        expect(adapted).not.toBeNull();
        expect(adapted?.type).toBe(ContributionSourceEventType.CrystalFinalized);
        expect(adapted?.slot).toBe(99);
    });

    it('drops non-CRYSTAL status changes', () => {
        const event: ProtocolEvent = {
            type: ProtocolEventType.ContentStatusChanged,
            timestamp: 1,
            slot: 99,
            data: {
                content_id: '11111111111111111111111111111111',
                new_status: 'ALLOY',
            },
        };

        expect(adaptProtocolEvent(event)).toBeNull();
    });
});
