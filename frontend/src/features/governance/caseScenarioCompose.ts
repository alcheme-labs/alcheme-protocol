export type CaseComposeMode = 'interactive' | 'scroll-only' | 'none';

export type CaseNextRequiredActionLike = {
    primaryAction?: string | null;
    status?: 'available' | 'waiting' | 'blocked' | 'completed' | null;
    disabledReason?: string | null;
    targetAnchor?: string | null;
    category?: string | null;
} | null | undefined;

export type CaseScenarioCompose = {
    mode: CaseComposeMode;
    scenarioKey: string | null;
    /** DOM id for portal / highlight (may differ from API anchor). */
    slotId: string | null;
    /** API / hash anchor from nextRequiredAction.targetAnchor. */
    apiAnchor: string | null;
    status: 'available' | 'waiting' | 'blocked' | 'completed' | null;
    disabledReason: string | null;
};

const SCROLL_ONLY_SLOTS: Record<string, string> = {
    submit_execution_evidence: 'case-manual-execution-control',
    review_execution_evidence: 'case-manual-execution-control',
    record_outcome: 'case-actual-outcome-title',
    accept_responsibility: 'case-responsibility-coordinator',
    continue_brief: 'case-brief-title',
    open_approval_stage: 'case-focus-action',
    cast_vote: 'case-decision-stages-title',
    open_execution: 'case-responsibility-execution',
};

const VIEW_CATEGORY_SLOTS: Record<string, string> = {
    outcome: 'case-responsibility-outcome',
    review: 'case-responsibility-review',
    execution: 'case-responsibility-execution',
    decision: 'case-decision-stages-title',
    drafting: 'case-brief-title',
    record: 'case-actual-outcome-title',
};

function resolveViewSlot(
    category: string | null | undefined,
    apiAnchor: string | null,
): string {
    if (apiAnchor && apiAnchor !== 'case-workflow-title') {
        return apiAnchor;
    }
    if (category && VIEW_CATEGORY_SLOTS[category]) {
        return VIEW_CATEGORY_SLOTS[category];
    }
    return apiAnchor ?? 'case-focus-work';
}

/**
 * Map nextRequiredAction → compose scenario.
 * P0: only review_brief is interactive (portal to #case-review-focus).
 * API anchor (e.g. case-responsibility-review) may differ from DOM slot.
 */
export function resolveCaseScenarioCompose(
    next: CaseNextRequiredActionLike,
): CaseScenarioCompose {
    if (!next || !next.status || next.status === 'completed') {
        return {
            mode: 'none',
            scenarioKey: null,
            slotId: null,
            apiAnchor: null,
            status: next?.status ?? null,
            disabledReason: next?.disabledReason ?? null,
        };
    }

    const action = next.primaryAction ?? null;
    const apiAnchor = next.targetAnchor ?? null;
    const status = next.status;
    const disabledReason = next.disabledReason ?? null;

    if (!action) {
        return {
            mode: 'none',
            scenarioKey: null,
            slotId: null,
            apiAnchor,
            status,
            disabledReason,
        };
    }

    if (action === 'review_brief') {
        return {
            mode: 'interactive',
            scenarioKey: 'review_brief',
            slotId: 'case-review-focus',
            apiAnchor: apiAnchor ?? 'case-responsibility-review',
            status,
            disabledReason,
        };
    }

    if (action === 'view_case' || action === 'view_record') {
        const slotId = resolveViewSlot(next.category, apiAnchor);
        return {
            mode: 'scroll-only',
            scenarioKey: action,
            slotId,
            apiAnchor: apiAnchor ?? slotId,
            status,
            disabledReason,
        };
    }

    if (action === 'accept_responsibility') {
        const roleSlot = next.category === 'outcome'
            ? 'case-responsibility-outcome'
            : next.category === 'review'
                ? 'case-responsibility-review'
                : next.category === 'execution'
                    ? 'case-responsibility-execution'
                    : SCROLL_ONLY_SLOTS.accept_responsibility;
        return {
            mode: 'scroll-only',
            scenarioKey: action,
            slotId: roleSlot,
            apiAnchor: apiAnchor ?? roleSlot,
            status,
            disabledReason,
        };
    }

    const slotId = SCROLL_ONLY_SLOTS[action] ?? apiAnchor;
    if (!slotId && !apiAnchor) {
        return {
            mode: 'none',
            scenarioKey: action,
            slotId: null,
            apiAnchor: null,
            status,
            disabledReason,
        };
    }

    return {
        mode: 'scroll-only',
        scenarioKey: action,
        slotId: slotId ?? apiAnchor,
        apiAnchor: apiAnchor ?? slotId,
        status,
        disabledReason,
    };
}

export function scrollToComposeTarget(anchorOrSlot: string | null | undefined): void {
    if (!anchorOrSlot || typeof document === 'undefined') return;
    const el = document.getElementById(anchorOrSlot);
    if (!el) return;
    const collapsedParent = el.closest<HTMLDetailsElement>('details:not([open])');
    if (collapsedParent) collapsedParent.open = true;
    const chrome = document.querySelector<HTMLElement>('[data-case-top-chrome]');
    const margin = Math.max(96, (chrome?.getBoundingClientRect().height ?? 0) + 12);
    el.style.scrollMarginTop = `${margin}px`;
    el.scrollIntoView({ behavior: 'smooth', block: 'start' });
    el.classList.add('compose-slot-highlight');
    window.setTimeout(() => el.classList.remove('compose-slot-highlight'), 1600);
}
