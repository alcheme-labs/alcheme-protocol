import type { PlazaMessage } from '@/lib/circle/types';
import {
    normalizeSelectedPlazaMessageIds,
    selectVisiblePlazaMessageIds,
} from './messageSelection';

export { isDiscussionMessageDraftSourceEligible } from './messageSelection';

export function selectVisibleDraftSourceMessageIds(
    messages: PlazaMessage[],
    limit = 16,
): string[] {
    return selectVisiblePlazaMessageIds(
        messages.filter((message) => message.focusLabel !== 'off_topic'),
        'draft',
        limit,
    );
}

export function normalizeSelectedDraftSourceMessageIds(
    messages: PlazaMessage[],
    selectedEnvelopeIds: Set<string>,
    limit = 20,
): string[] {
    return normalizeSelectedPlazaMessageIds(messages, selectedEnvelopeIds, 'draft', limit);
}
