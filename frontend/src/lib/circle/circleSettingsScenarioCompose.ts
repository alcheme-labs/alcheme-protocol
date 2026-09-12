export type CircleSettingsFocusSection = 'members' | 'governance' | null | undefined;

export type CircleSettingsScenarioKey =
    | 'governance_action_required'
    | 'configuration_save_pending'
    | 'members_invite_focus';

export type CircleSettingsScenario = {
    scenarioKey: CircleSettingsScenarioKey;
    /** Scroll target: data-settings-section or id */
    scrollSection: 'governance' | 'members' | 'basic' | 'ghost' | 'draftLifecycle' | 'draftWorkflow';
    cta: 'scroll' | 'save_access' | 'save_ghost' | 'save_draft_lifecycle' | 'save_draft_workflow';
};

export type CircleSettingsScenarioInput = {
    focusSection?: CircleSettingsFocusSection;
    governanceActionRequired?: boolean;
    accessPolicyDirty?: boolean;
    ghostDirty?: boolean;
    draftLifecycleDirty?: boolean;
    draftWorkflowDirty?: boolean;
};

/**
 * Priority (high → low): governance_action_required → configuration_save_pending → members_invite_focus.
 * Only one Dock scenario at a time; never hides Catalog sections.
 */
export function resolveCircleSettingsScenario(
    input: CircleSettingsScenarioInput,
): CircleSettingsScenario | null {
    if (input.governanceActionRequired) {
        return {
            scenarioKey: 'governance_action_required',
            scrollSection: 'governance',
            cta: 'scroll',
        };
    }

    if (input.accessPolicyDirty) {
        return {
            scenarioKey: 'configuration_save_pending',
            scrollSection: 'basic',
            cta: 'save_access',
        };
    }
    if (input.ghostDirty) {
        return {
            scenarioKey: 'configuration_save_pending',
            scrollSection: 'ghost',
            cta: 'save_ghost',
        };
    }
    if (input.draftLifecycleDirty) {
        return {
            scenarioKey: 'configuration_save_pending',
            scrollSection: 'draftLifecycle',
            cta: 'save_draft_lifecycle',
        };
    }
    if (input.draftWorkflowDirty) {
        return {
            scenarioKey: 'configuration_save_pending',
            scrollSection: 'draftWorkflow',
            cta: 'save_draft_workflow',
        };
    }

    // Intent-only: members focus lights Dock; governance focus relies on existing
    // focusSection scroll (do not mislabel as governance_action_required).
    if (input.focusSection === 'members') {
        return {
            scenarioKey: 'members_invite_focus',
            scrollSection: 'members',
            cta: 'scroll',
        };
    }

    return null;
}

export function scrollCircleSettingsSection(section: CircleSettingsScenario['scrollSection']): void {
    if (typeof document === 'undefined') return;
    const byData = document.querySelector(`[data-settings-section="${section}"]`);
    const el = (byData as HTMLElement | null)
        ?? document.getElementById(`settings-section-${section}`);
    el?.scrollIntoView({ behavior: 'smooth', block: 'start' });
}
