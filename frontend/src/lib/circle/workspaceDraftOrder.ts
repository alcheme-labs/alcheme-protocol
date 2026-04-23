import type { DraftLifecycleReadModel } from '@/features/draft-working-copy/api';

export interface WorkspaceDraftLike {
    id: number;
}

export type WorkspaceDraftLifecycleStatus = DraftLifecycleReadModel['documentStatus'] | null | undefined;

export function prioritizeWorkspaceDrafts<T extends WorkspaceDraftLike>(
    drafts: T[],
    statuses: Record<number, WorkspaceDraftLifecycleStatus>,
): T[] {
    const drafting: T[] = [];
    const others: T[] = [];

    for (const draft of drafts) {
        if (statuses[draft.id] === 'drafting') {
            drafting.push(draft);
            continue;
        }
        others.push(draft);
    }

    return [...drafting, ...others];
}
