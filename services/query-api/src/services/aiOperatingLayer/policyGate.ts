import type { AiRuntimeRole } from './types';

export type AiPolicyGateDecision =
    | {
        decision: 'allow';
        reasonCode: 'known_action_read_or_domain_owned';
        proposedAction: AiProposedAction;
        ownerService: string;
        applyBehavior: 'domain_owned' | 'read_only';
    }
    | {
        decision: 'deny';
        reasonCode: 'unknown_action' | 'private_sidecar_required';
        proposedAction: string | null;
    };

export type AiProposedAction =
    | 'draft.ghost_revision.accept'
    | 'draft.accepted_issue_revision.apply'
    | 'discussion.summary.read'
    | 'discussion.trigger.observe'
    | 'voice.recap.read'
    | 'place_prompt.apply_to_create_circle_form'
    | 'configuration.apply_to_create_circle_form'
    | 'configuration.apply_to_fork_create_form'
    | 'configuration.apply_to_circle_settings_form'
    | 'settings_text.apply_local_suggestion'
    | 'style.preview_personal_preferences'
    | 'style.preview_circle_style'
    | 'style.preview_session'
    | 'style.apply_to_user_preferences'
    | 'style.apply_to_circle_style'
    | 'knowledge_relationship_label.propose_catalog_change'
    | 'guardian.finding.observe'
    | 'guardian.finding.notify'
    | 'guardian.finding.propose'
    | 'guardian.finding.convert_to_proposal';

interface AiPolicyGateInput {
    proposedAction?: string | null;
    stage?: 'enqueue' | 'context_build' | 'validate' | 'display' | 'accept' | 'apply';
    dataBoundary?: 'public' | 'member_visible' | 'reviewer_only' | 'private_plaintext';
    runtimeRole?: AiRuntimeRole;
}

const KNOWN_AI_ACTIONS: Record<AiProposedAction, {
    ownerService: string;
    applyBehavior: 'domain_owned' | 'read_only';
}> = {
    'draft.ghost_revision.accept': {
        ownerService: 'services/query-api/src/services/ghostDraft/acceptance.ts',
        applyBehavior: 'domain_owned',
    },
    'draft.accepted_issue_revision.apply': {
        ownerService: 'services/query-api/src/services/draftAiAssist/acceptedIssueRevisionApply.ts',
        applyBehavior: 'domain_owned',
    },
    'discussion.summary.read': {
        ownerService: 'services/query-api/src/ai/discussion-summary.ts',
        applyBehavior: 'read_only',
    },
    'discussion.trigger.observe': {
        ownerService: 'services/query-api/src/ai/discussion-draft-trigger.ts',
        applyBehavior: 'read_only',
    },
    'voice.recap.read': {
        ownerService: 'services/query-api/src/services/voice/recap.ts',
        applyBehavior: 'read_only',
    },
    'place_prompt.apply_to_create_circle_form': {
        ownerService: 'frontend/src/components/circle/CreateCircleSheet/CreateCircleSheet.tsx',
        applyBehavior: 'read_only',
    },
    'configuration.apply_to_create_circle_form': {
        ownerService: 'frontend/src/components/circle/CreateCircleSheet/CreateCircleSheet.tsx',
        applyBehavior: 'read_only',
    },
    'configuration.apply_to_fork_create_form': {
        ownerService: 'frontend/src/components/circle/ForkCreateSheet/ForkCreateSheet.tsx',
        applyBehavior: 'read_only',
    },
    'configuration.apply_to_circle_settings_form': {
        ownerService: 'frontend/src/components/circle/CircleSettingsSheet/CircleSettingsSheet.tsx',
        applyBehavior: 'read_only',
    },
    'settings_text.apply_local_suggestion': {
        ownerService: 'frontend/src/components/alcheme/FieldAssist/FieldAssistInline.tsx',
        applyBehavior: 'read_only',
    },
    'style.preview_personal_preferences': {
        ownerService: 'frontend/src/components/profile/ProfileSettingsSheet/ProfileSettingsSheet.tsx',
        applyBehavior: 'read_only',
    },
	    'style.preview_circle_style': {
	        ownerService: 'frontend/src/components/circle/CircleSettingsSheet/CircleSettingsSheet.tsx',
	        applyBehavior: 'read_only',
	    },
	    'style.preview_session': {
	        ownerService: 'frontend/src/components/alcheme/StyleProposalPanel/StyleProposalPanel.tsx',
	        applyBehavior: 'read_only',
	    },
	    'style.apply_to_user_preferences': {
        ownerService: 'services/query-api/src/services/aiOperatingLayer/style/preferences.ts',
        applyBehavior: 'domain_owned',
    },
    'style.apply_to_circle_style': {
        ownerService: 'services/query-api/src/services/aiOperatingLayer/style/preferences.ts',
        applyBehavior: 'domain_owned',
    },
    'knowledge_relationship_label.propose_catalog_change': {
        ownerService: 'services/query-api/src/services/knowledgeRelationshipLabelAi/proposals.ts',
        applyBehavior: 'read_only',
    },
    'guardian.finding.observe': {
        ownerService: 'services/query-api/src/services/aiOperatingLayer/guardian/findings.ts',
        applyBehavior: 'read_only',
    },
    'guardian.finding.notify': {
        ownerService: 'services/query-api/src/services/aiOperatingLayer/guardian/notifications.ts',
        applyBehavior: 'read_only',
    },
    'guardian.finding.propose': {
        ownerService: 'services/query-api/src/services/aiOperatingLayer/guardian/findings.ts',
        applyBehavior: 'read_only',
    },
    'guardian.finding.convert_to_proposal': {
        ownerService: 'services/query-api/src/services/aiOperatingLayer/guardian/proposals.ts',
        applyBehavior: 'domain_owned',
    },
};

export async function evaluateAiPolicyGate(
    input: AiPolicyGateInput,
): Promise<AiPolicyGateDecision> {
    const proposedAction = input.proposedAction ?? null;
    if (!isKnownAiAction(proposedAction)) {
        return {
            decision: 'deny',
            reasonCode: 'unknown_action',
            proposedAction,
        };
    }

    if (
        input.dataBoundary === 'private_plaintext' &&
        input.runtimeRole !== 'PRIVATE_SIDECAR'
    ) {
        return {
            decision: 'deny',
            reasonCode: 'private_sidecar_required',
            proposedAction,
        };
    }

    const action = KNOWN_AI_ACTIONS[proposedAction];
    return {
        decision: 'allow',
        reasonCode: 'known_action_read_or_domain_owned',
        proposedAction,
        ownerService: action.ownerService,
        applyBehavior: action.applyBehavior,
    };
}

export function isKnownAiAction(value: unknown): value is AiProposedAction {
    return typeof value === 'string' && Object.prototype.hasOwnProperty.call(KNOWN_AI_ACTIONS, value);
}
