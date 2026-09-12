import type { DraftLifecycleReadModel } from '@/lib/api/draftWorkingCopy';

export interface WorkspaceDraftLike {
    id: number;
    documentStatus?: WorkspaceDraftLifecycleStatus;
    publicBlockerCode?: string | null;
    lastActivityAt?: string | null;
}

export type WorkspaceDraftLifecycleStatus = DraftLifecycleReadModel['documentStatus'] | null | undefined;

export type WorkspaceDraftPresentationState = 'blocked' | 'active' | 'complete';

export interface WorkspaceDraftPresentation {
    lifecycleKey:
        | 'drafting'
        | 'review'
        | 'crystallizationActive'
        | 'crystallizationFailed'
        | 'crystallized'
        | 'archived'
        | 'inProgress';
    state: WorkspaceDraftPresentationState;
    blockerKey: 'crystallizationFailed' | null;
}

export function buildWorkspaceDraftPresentation(input: {
    documentStatus?: WorkspaceDraftLifecycleStatus;
    publicBlockerCode?: string | null;
}): WorkspaceDraftPresentation {
    const status = input.documentStatus;
    if (input.publicBlockerCode === 'crystallization_failed' || status === 'crystallization_failed') {
        return {
            lifecycleKey: 'crystallizationFailed',
            state: 'blocked',
            blockerKey: 'crystallizationFailed',
        };
    }
    if (status === 'crystallized') {
        return { lifecycleKey: 'crystallized', state: 'complete', blockerKey: null };
    }
    if (status === 'archived') {
        return { lifecycleKey: 'archived', state: 'complete', blockerKey: null };
    }
    if (status === 'drafting') {
        return { lifecycleKey: 'drafting', state: 'active', blockerKey: null };
    }
    if (status === 'review') {
        return { lifecycleKey: 'review', state: 'active', blockerKey: null };
    }
    if (status === 'crystallization_active') {
        return { lifecycleKey: 'crystallizationActive', state: 'active', blockerKey: null };
    }
    return { lifecycleKey: 'inProgress', state: 'active', blockerKey: null };
}

function parseActivityTime(value: string | null | undefined): number {
    const parsed = Date.parse(String(value || ''));
    return Number.isFinite(parsed) ? parsed : 0;
}

export function prioritizeWorkspaceDrafts<T extends WorkspaceDraftLike>(
    drafts: T[],
): T[] {
    return drafts
        .map((draft, index) => ({ draft, index }))
        .sort((left, right) => {
            const leftPresentation = buildWorkspaceDraftPresentation({
                documentStatus: left.draft.documentStatus,
                publicBlockerCode: left.draft.publicBlockerCode,
            });
            const rightPresentation = buildWorkspaceDraftPresentation({
                documentStatus: right.draft.documentStatus,
                publicBlockerCode: right.draft.publicBlockerCode,
            });
            const rank = (state: WorkspaceDraftPresentationState) => (
                state === 'blocked' ? 0 : state === 'active' ? 1 : 2
            );
            const stateDifference = rank(leftPresentation.state) - rank(rightPresentation.state);
            if (stateDifference !== 0) return stateDifference;

            const activityDifference = parseActivityTime(right.draft.lastActivityAt)
                - parseActivityTime(left.draft.lastActivityAt);
            if (activityDifference !== 0) return activityDifference;
            return left.index - right.index;
        })
        .map(({ draft }) => draft);
}
