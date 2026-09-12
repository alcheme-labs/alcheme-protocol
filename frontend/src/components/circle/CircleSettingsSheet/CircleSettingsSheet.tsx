'use client';

import { useEffect, useRef, useState } from 'react';
import { useQuery } from '@apollo/client/react';
import { motion, AnimatePresence } from 'framer-motion';
import { X, Settings, UserPlus, ChevronDown, ChevronRight, Copy } from 'lucide-react';
import Link from 'next/link';
import { CircleGrowthAdvisorPanel, ConfigurationDiffPanel, GuardianFindingPanel, StyleProposalPanel } from '@/components/alcheme';
import { Select } from '@/components/ui/Select';
import CircleAliasSettings from '@/components/circle/CircleAliasSettings/CircleAliasSettings';
import AgentAdminPanel from '@/features/agents/AgentAdminPanel';
import CircleLocationEditor from '@/features/circle-location/CircleLocationEditor';
import FeedGovernanceControls from '@/components/circle/FeedGovernanceControls/FeedGovernanceControls';
import OperatorCapabilitySuspensionControls from '@/components/circle/OperatorCapabilitySuspensionControls/OperatorCapabilitySuspensionControls';
import type {
    CircleGeoAnchorDto,
    CircleGeoAnchorInput,
    CircleLocationSaveResult,
} from '@/features/circle-location/types';
import KnowledgeRelationshipLabelSheet from '@/components/knowledge/KnowledgeRelationshipLabelSheet/KnowledgeRelationshipLabelSheet';
import { useCurrentLocale, useI18n } from '@/i18n/useI18n';
import { GET_KNOWLEDGE_RELATIONSHIP_LABELS } from '@/lib/apollo/queries';
import type { GQLKnowledgeRelationshipLabel } from '@/lib/apollo/types';
import type { CircleAgentPolicy, CircleAgentRecord } from '@/lib/api/circlesAgents';
import type {
    CircleGhostSettings,
    CircleGhostSettingsGovernancePending,
} from '@/lib/api/circlesGhostSettings';
import type { CircleMergeDispositionInput } from '@/lib/api/circlesLifecycle';
import {
    DEFAULT_CIRCLE_DRAFT_WORKFLOW_POLICY,
} from '@/lib/api/circlesPolicyProfile';
import {
    applyDraftWorkflowGovernancePreset,
    DRAFT_WORKFLOW_GOVERNANCE_PRESETS,
    resolveDraftWorkflowGovernancePreset,
    type DraftWorkflowGovernancePresetSelection,
} from '@/lib/circle/draftWorkflowGovernancePresets';
import {
    resolveConfigurationRequestKeyTransition,
    restoreConfigurationSettingsDirtyState,
    type ConfigurationSettingsDirtyState,
} from '@/lib/circle/configurationCopilotState';
import { resolveCircleSettingsActionFlags } from '@/lib/circle/memberManagement';
import {
    resolveCircleSettingsScenario,
    scrollCircleSettingsSection,
} from '@/lib/circle/circleSettingsScenarioCompose';
import type { CircleAccessType } from '@/lib/circle/accessPolicy';
import { resolveAccessPolicyWalletImpact } from '@/lib/circles/settingsWalletImpact';
import type {
    CircleDraftPromptMode,
    CircleDraftPromptScope,
    CircleDraftPromptScopeReadback,
    CircleDraftWorkflowPolicy,
    CircleDraftLifecycleTemplate,
    DraftReviewEntryMode,
} from '@/lib/api/circlesPolicyProfile';
import {
    fetchGovernedActionRouting,
    fetchRealmsProviderTrustReadback,
    fetchSquadsProviderTrustReadback,
    openGovernanceGrantPayoutRequest,
    requestRealmsProviderBinding,
    requestRealmsProviderDelegationConformance,
    requestRealmsVotingPowerChallengeConformance,
    requestRealmsProviderDisable,
    requestRealmsProviderRestore,
    requestSquadsProviderBinding,
    requestSquadsProviderAdoption,
    requestSquadsProviderBootstrap,
    requestSquadsProviderDisable,
    requestSquadsProviderRestore,
    type GovernedActionRoutingReadback,
    type RealmsProviderTrustReadback,
    type SquadsProviderTrustReadback,
    type SquadsExistingResourceAdoptionInput,
    CircleGovernanceCommitteeElectorateTemplate,
    CircleGovernanceCommitteeProfile,
    CircleGovernanceBinding,
    GovernanceMandateMinimumConstraints,
    GovernanceMandateOperatorPolicyConstraints,
    GovernanceMandateEffectPolicy,
    GovernanceMandateFeePolicy,
    GovernanceCrossInstitutionDisclosureDeclaration,
    GovernanceCrossInstitutionDisclosureImpact,
    GovernanceDisclosureDataCategory,
    CircleGovernanceRequest,
    CircleGovernanceResourceReadiness,
    GovernanceAuthorityContinuityReadback,
    GovernanceRecoveryReadback,
} from '@/lib/api/governance';
import {
    getConfigurationProposal,
    pollConfigurationCopilotProposal,
    recordConfigurationCopilotEvent,
    requestConfigurationCopilot,
    type ConfigurationFieldChange,
    type ConfigurationProposalView,
} from '@/lib/api/configurationCopilot';
import {
    applyStylePreference,
    getCurrentStylePreference,
    pollStyleAdvisorProposal,
    recordStyleAdvisorEvent,
    requestStyleAdvisor,
    resetCircleStylePreference,
    type StylePreferenceView,
    type StyleProposalView,
} from '@/lib/api/styleAdvisor';
import {
    ackGuardianFinding,
    convertGuardianFinding,
    dismissGuardianFinding,
    getGuardianFinding,
    listGuardianFindings,
    requestGuardianFindingDiagnose,
    snoozeGuardianFinding,
    type GuardianFindingLevel,
    type GuardianFindingStatus,
    type GuardianFindingView,
} from '@/lib/api/guardianFindings';
import {
    convertCircleGrowthProposal,
    listCircleGrowthProposals,
    rejectCircleGrowthProposal,
    requestCircleGrowthAdvisor,
    snoozeCircleGrowthProposal,
    type CircleGrowthProposalView,
} from '@/lib/api/circleGrowthAdvisor';
import { formatNodeRoutingError } from '@/lib/api/nodeRouting';
import styles from './CircleSettingsSheet.module.css';

/**
 * zh: 先隐藏圈层级 Agent 治理面板。
 * 当前 Agent policy 只支持保存/回显，还没有真正驱动运行时 Agent 行为。
 * 未来如果要让圈层独立治理 AI 参数（例如触发范围、审批门槛、成本策略），
 * 再重新打开这里的 UI。
 *
 * en: Hide the per-circle Agent governance panel for now.
 * The current Agent policy surface only persists and reads back values; it does not drive runtime Agent behavior yet.
 * Re-enable this UI when circles can independently govern AI parameters
 * such as trigger scope, approval thresholds, and cost policy.
 */
const SHOW_AGENT_GOVERNANCE_PANEL = false;
const SHOW_CIRCLE_STYLE_ADVISOR_ENTRY = false;
const SHOW_GUARDIAN_FINDINGS_USER_ENTRY = false;

/* ═══ Types ═══ */

export interface MemberInfo {
    userId: number;
    name: string;
    handle: string | null;
    pubkey?: string | null;
    role: 'owner' | 'curator' | 'member';
    actualRole: 'Owner' | 'Admin' | 'Moderator' | 'Member';
    roleMutable?: boolean;
    removable?: boolean;
}

interface CircleIdentityRules {
    initiateMessages: number;
    memberCitations: number;
    elderPercentile: number;
    inactivityDays: number;
}

interface CircleGovernanceCommitteeSummary {
    status: 'action_registry_resolved' | 'active_binding' | 'pending_mandate';
    bindingType?: 'local_auxiliary' | 'shared_committee' | 'self_governed' | null;
    committeeCircleId?: number | null;
    committeeCircleName?: string | null;
    actionScope?: string | null;
    ruleId?: string | null;
    bindingId?: string | null;
    policyVersion?: number | null;
    eligibleCount?: number | null;
    singlePersonCommittee?: boolean;
    mandateId?: string | null;
    mandateVersion?: number | null;
    mandatePurpose?: string | null;
    mandateEnvironment?: string | null;
    mandateNetwork?: string | null;
    mandateCanonicalState?: string | null;
    mandateEffectiveFrom?: string | null;
    mandateEffectiveUntil?: string | null;
    mandateAcceptanceExpiresAt?: string | null;
    mandateMinimumConstraints?: GovernanceMandateMinimumConstraints | null;
    mandateFeePolicy?: GovernanceMandateFeePolicy | null;
    mandateEffectPolicy?: GovernanceMandateEffectPolicy | null;
    mandateDisclosureImpact?: GovernanceCrossInstitutionDisclosureImpact | null;
    authorityTransparency?: CircleGovernanceBinding['authorityTransparency'] | null;
}

interface CircleLifecycleActionStatus {
    state: 'idle' | 'saving' | 'requires_governance' | 'awaiting_wallet' | 'reconciliation_pending' | 'converged' | 'dissolution_pending' | 'merge_pending' | 'merged' | 'blocked' | 'error';
    requestId?: string | null;
    plan?: {
        id: string;
        blockerCodes: string[];
        targetLifecycleState: 'active' | 'archived' | 'dissolution_pending' | 'merged';
        dispositionSnapshot: {
            entries: Array<{
                disposition: 'continue' | 'suspend' | 'cancel' | 'manual_resolution';
            }>;
            externalResources: { status: string };
        };
        dissolutionPolicy?: Record<string, unknown> | null;
        reconciliation?: Record<string, unknown> | null;
    } | null;
    message?: string | null;
}

interface CircleMergeActionStatus {
    state: 'idle' | 'saving' | 'requires_source_governance' | 'source_approved' | 'requires_successor_governance' | 'merge_pending' | 'merged' | 'error';
    sourceRequestId?: string | null;
    successorRequestId?: string | null;
    plan?: { id: string; sourceCircleIds?: number[] } | null;
    message?: string | null;
}

interface CircleCommitteeProfileActionStatus {
    state: 'idle' | 'saving' | 'requires_governance' | 'executed' | 'error';
    requestId?: string | null;
    message?: string | null;
}

interface CircleGovernanceRequestSummary {
    id: string;
    actionType: string;
    targetType: string;
    targetRef: string;
    policyVersionId?: string;
    policyVersion?: number;
    state: 'active' | 'accepted' | 'rejected' | 'expired' | 'cancelled' | string;
    decisionStatus: CircleGovernanceRequest['decisionStatus'];
    executionStatus: CircleGovernanceRequest['executionStatus'];
    openedAt?: string | null;
    expiresAt?: string | null;
    caseRef?: string | null;
    stageRef?: string | null;
    payload?: Record<string, unknown> | null;
    executionCompatibility?: CircleGovernanceRequest['executionCompatibility'];
}

type GovernanceActionScopeValue =
    | 'circle.lifecycle'
    | 'circle.governance_binding'
    | 'circle.owner'
    | 'circle.policy'
    | 'grant'
    | 'communication'
    | 'communication.member.mute'
    | 'storage_fabric.authorize_provider_admission';

type GovernanceBindingTypeValue = 'local_auxiliary' | 'shared_committee' | 'self_governed';
type GovernanceMandatePurposeValue = 'collective_decision' | 'operational_execution';
type CommitteeThresholdMode = CircleGovernanceCommitteeElectorateTemplate['threshold']['mode'];
type CommitteeBallotDisclosureMode = CircleGovernanceCommitteeElectorateTemplate['ballotDisclosure']['mode'];
type ConfigurationCopilotUiState =
    | { status: 'idle' }
    | { status: 'loading'; requestKey: string }
    | { status: 'ready'; proposal: ConfigurationProposalView; requestKey: string }
    | { status: 'disabled'; message: string }
    | { status: 'error'; message: string };
type StyleAdvisorUiState =
    | { status: 'idle' }
    | { status: 'loading'; requestKey: string }
    | { status: 'ready'; proposal: StyleProposalView; requestKey: string }
    | { status: 'applied'; proposal: StyleProposalView; requestKey: string }
    | { status: 'disabled'; message: string }
    | { status: 'error'; message: string };
type GuardianFindingUiState =
    | { status: 'idle' }
    | { status: 'loading' }
    | { status: 'ready' }
    | { status: 'diagnosing' }
    | { status: 'disabled'; message: string }
    | { status: 'error'; message: string };
type CircleGrowthAdvisorUiState =
    | { status: 'idle' }
    | { status: 'loading' }
    | { status: 'ready' }
    | { status: 'requesting' }
    | { status: 'disabled'; message: string }
    | { status: 'error'; message: string };

type ConfigurationUndoEntry = {
    field: string;
    previousValue: unknown;
    dirtyState?: ConfigurationSettingsDirtyState;
};

const GOVERNANCE_ACTION_SCOPE_OPTIONS = [
    { value: 'circle.lifecycle', labelKey: 'governance.scopeLifecycle' },
    { value: 'circle.governance_binding', labelKey: 'governance.scopeGovernanceBinding' },
    { value: 'circle.owner', labelKey: 'governance.scopeOwner' },
    { value: 'circle.policy', labelKey: 'governance.scopePolicy' },
    { value: 'grant', labelKey: 'governance.scopeGrant' },
    { value: 'communication', labelKey: 'governance.scopeCommunication' },
    { value: 'communication.member.mute', labelKey: 'governance.scopeMemberMute' },
    { value: 'storage_fabric.authorize_provider_admission', labelKey: 'governance.scopeProviderAdmission' },
] as const;

const COMMITTEE_RECEIVE_WINDOW_DURATION_OPTIONS = [5, 10, 15] as const;
const SELF_GOVERNED_AUTHORITY_PRESET = {
    acceptanceDays: 7,
    durationDays: 30,
    minimumApprovalThreshold: 1,
    minimumTimelockHours: 0,
} as const;
const COMMITTEE_THRESHOLD_MODES: CommitteeThresholdMode[] = [
    'default_majority',
    'unanimity',
    'fixed_count',
];
const COMMITTEE_BALLOT_DISCLOSURE_MODES: CommitteeBallotDisclosureMode[] = [
    'public',
    'member',
    'eligible_only',
    'aggregate_until_close',
    'provider_defined',
];

function MandateMinimumReadback({
    constraints,
    t,
    className,
}: {
    constraints: GovernanceMandateMinimumConstraints;
    t: ReturnType<typeof useI18n>;
    className: string;
}) {
    return (
        <div className={className} data-testid="mandate-minimum-constraints-readback">
            <span>{t('governance.mandateMinimumRiskLabel')}</span>
            <strong>{t(`governance.mandateRiskFloor.${constraints.riskFloor}`)}</strong>
            <span>{t('governance.mandateMinimumQuorumLabel')}</span>
            <strong>{constraints.minimumApprovalThreshold}</strong>
            <span>{t('governance.mandateMinimumTimelockLabel')}</span>
            <strong>{t('governance.mandateMinimumTimelockValue', {
                hours: constraints.minimumTimelockSeconds / 3600,
            })}</strong>
        </div>
    );
}

function MandateDisclosureReadback({
    impact,
    t,
    className,
}: {
    impact: GovernanceCrossInstitutionDisclosureImpact;
    t: ReturnType<typeof useI18n>;
    className: string;
}) {
    return (
        <div
            className={className}
            data-testid="mandate-disclosure-impact-readback"
            data-recipient-authority-ref={impact.recipientAuthority.ref}
        >
            <span>{t('governance.disclosureDataCategories')}</span>
            <strong>{impact.dataCategories.join(', ')}</strong>
            <span>{t('governance.disclosureRecipients')}</span>
            <strong>{impact.recipientRoles.join(', ')} · {impact.recipientCount}</strong>
            <span>{t('governance.disclosureRegions')}</span>
            <strong>{impact.recipientRegions.join(', ')}</strong>
            <span>{t('governance.disclosurePurposes')}</span>
            <strong>{impact.purposes.join(', ')}</strong>
            <span>{t('governance.disclosureRetention')}</span>
            <strong>{t('governance.disclosureRetentionDays', { count: impact.retention.maximumDays })}</strong>
            <span>{t('governance.disclosureFixedProtections')}</span>
            <strong>{t('governance.disclosureFixedProtectionsValue')}</strong>
        </div>
    );
}

function getCircleSettingsWalletImpactMessageKey(labelKey: string): string {
    const prefix = 'CircleSettings.';
    return labelKey.startsWith(prefix) ? labelKey.slice(prefix.length) : labelKey;
}

interface CircleOwnerTransferRequestSummary {
    id: string;
    circleId: number;
    fromOwnerUserId: number;
    targetUserId: number;
    requestedByUserId: number;
    governanceRequestId?: string | null;
    status: 'pending_target_acceptance' | 'pending_governance' | 'executed' | string;
    executionMode: 'off_chain';
    chainStatus: 'not_supported';
}

interface CircleSettingsSheetProps {
    open: boolean;
    focusSection?: 'members' | 'governance' | null;
    circleId?: number | null;
    circleName: string;
    circleType?: 'Open' | 'Closed' | 'Secret' | null;
    circleMode: 'social' | 'knowledge';
    settingsDataReady?: boolean;
    accessType: CircleAccessType;
    minCrystals?: number;
    allowForwardOut: boolean;
    forwardPolicyEditable?: boolean;
    forwardPolicyNotice?: string | null;
    identityRules?: CircleIdentityRules | null;
    members: MemberInfo[];
    memberDirectoryNotice?: string | null;
    /** Current user's role — controls what actions are available */
    currentUserRole: 'owner' | 'curator' | 'member';
    currentUserActualRole?: 'Owner' | 'Admin' | 'Moderator' | 'Member' | null;
    focusedGuardianFindingId?: string | null;
    currentUserId?: number | null;
    ghostSettings?: CircleGhostSettings | null;
    ghostSettingsSource?: 'circle' | 'pending' | 'global_default' | null;
    ghostSettingsGovernancePending?: CircleGhostSettingsGovernancePending | null;
    ghostSettingsLoading?: boolean;
    ghostSettingsSaving?: boolean;
    ghostSettingsError?: string | null;
    primaryGeoAnchor?: CircleGeoAnchorDto | null;
    primaryGeoAnchorLoading?: boolean;
    primaryGeoAnchorSaving?: boolean;
    primaryGeoAnchorError?: string | null;
    primaryGeoAnchorGovernanceRequestId?: string | null;
    draftLifecycleTemplate?: CircleDraftLifecycleTemplate | null;
    draftWorkflowPolicy?: CircleDraftWorkflowPolicy | null;
    draftLifecycleSaving?: boolean;
    draftLifecycleError?: string | null;
    draftLifecycleNotice?: string | null;
    draftPromptScopes?: CircleDraftPromptScopeReadback[];
    draftPromptLoading?: boolean;
    draftPromptSaving?: boolean;
    draftPromptError?: string | null;
    accessPolicyEditable?: boolean;
    accessPolicySaving?: boolean;
    accessPolicyError?: string | null;
    accessPolicyNotice?: string | null;
    accessPolicyGovernanceRequired?: boolean;
    agents?: CircleAgentRecord[];
    agentPolicy?: CircleAgentPolicy | null;
    agentPolicyLoading?: boolean;
    agentPolicySaving?: boolean;
    agentPolicyError?: string | null;
    governanceCommittee?: CircleGovernanceCommitteeSummary | null;
    governanceResourceReadiness?: CircleGovernanceResourceReadiness | null;
    committeeProfile?: CircleGovernanceCommitteeProfile | null;
    committeeProfileLoading?: boolean;
    committeeProfileStatus?: CircleCommitteeProfileActionStatus | null;
    canManageGovernanceBindings?: boolean;
    committeeGovernanceRequests?: CircleGovernanceRequestSummary[];
    targetGovernanceBindings?: CircleGovernanceBinding[];
    committeeGovernanceBindings?: CircleGovernanceBinding[];
    committeeGovernanceRequestsLoading?: boolean;
    committeeGovernanceSignalActionKey?: string | null;
    committeeGovernanceSignalError?: string | null;
    governanceRecovery?: GovernanceRecoveryReadback | null;
    circleLifecycleStatus?: 'Active' | 'Archived' | string | null;
    canManageLifecycle?: boolean;
    lifecycleActionStatus?: CircleLifecycleActionStatus | null;
    mergeActionStatus?: CircleMergeActionStatus | null;
    ownerTransferRequests?: CircleOwnerTransferRequestSummary[];
    onClose: () => void;
    onToggleForward?: (val: boolean) => void;
    onSaveGhostSettings?: (settings: CircleGhostSettings) => Promise<void> | void;
    onSavePrimaryGeoAnchor?: (input: CircleGeoAnchorInput) => Promise<CircleLocationSaveResult | void> | CircleLocationSaveResult | void;
    onArchivePrimaryGeoAnchor?: (anchorId?: string) => Promise<CircleLocationSaveResult | void> | CircleLocationSaveResult | void;
    onSaveDraftLifecycleTemplate?: (template: {
        reviewEntryMode: DraftReviewEntryMode;
        draftingWindowMinutes: number;
        reviewWindowMinutes: number;
        maxRevisionRounds: number;
    }) => Promise<void> | void;
    onSaveDraftWorkflowPolicy?: (policy: CircleDraftWorkflowPolicy) => Promise<void> | void;
    onSaveDraftPrompt?: (input: {
        scope: CircleDraftPromptScope;
        mode: CircleDraftPromptMode;
        promptBody?: string;
        version?: number;
        promptDigest?: string;
    }) => Promise<void> | void;
    onSaveAccessPolicy?: (policy: {
        accessType: CircleAccessType;
        minCrystals: number;
    }) => Promise<void> | void;
    onAccessPolicyDraftChange?: () => void;
    onSaveAgentPolicy?: (policy: {
        triggerScope: CircleAgentPolicy['triggerScope'];
        costDiscountBps: number;
        reviewMode: CircleAgentPolicy['reviewMode'];
    }) => Promise<void> | void;
    onUpdateCommitteeAvailability?: (
        availabilityStatus: 'disabled' | 'enabled',
        input: {
            windowMinutes?: number | null;
            allowedActionPrefixes?: string[] | null;
            electorateTemplate?: CircleGovernanceCommitteeElectorateTemplate | null;
        },
    ) => Promise<{
        status: 'executed' | 'requires_governance';
        request?: CircleGovernanceRequest;
    } | void> | {
        status: 'executed' | 'requires_governance';
        request?: CircleGovernanceRequest;
    } | void;
    onCreateGovernanceBinding?: (input: {
        bindingType: GovernanceBindingTypeValue;
        committeeCircleId: number;
        purposeBindings: Array<{
            purpose: GovernanceMandatePurposeValue;
            actionType: string | null;
            actionPrefix: string | null;
        }>;
        actionType: string | null;
        actionPrefix: GovernanceActionScopeValue | null;
        effectiveFrom: string;
        effectiveUntil: string;
        acceptanceExpiresAt: string;
        minimumConstraints: GovernanceMandateMinimumConstraints;
        subject: { type: string; ref: string };
        network: 'solana:localnet' | 'solana:devnet';
        feePolicy: GovernanceMandateFeePolicy;
        effectPolicy: GovernanceMandateEffectPolicy | null;
        operatorPolicyConstraints: GovernanceMandateOperatorPolicyConstraints | null;
        crossInstitutionDisclosureImpact: GovernanceCrossInstitutionDisclosureDeclaration | null;
        continuityIncident?: {
            replacementActorPubkey: string;
            incidentReviewRef: string;
            incidentReviewSummary: string;
        } | null;
    }) => Promise<void> | void;
    onUpdateActiveGovernancePolicy?: (input: {
        bindingId: string;
        electorateTemplate: CircleGovernanceCommitteeElectorateTemplate;
        targetCommitteeCircleId?: number | null;
    }) => Promise<{
        status: 'requires_governance';
        case: { id: string; canonicalUrl: string };
    } | {
        status: 'manual_recovery_pending';
        authorityContinuity: GovernanceAuthorityContinuityReadback;
    } | void> | void;
    onCreateGovernanceRecoveryPolicy?: (input: {
        bindingId: string;
        recoveryCircleId: number;
    }) => Promise<{
        status: 'requires_governance';
        case: { id: string; canonicalUrl: string };
    } | void> | void;
    onOpenGovernanceAuthorityHealth?: (input: {
        bindingId: string;
        faultAssessment?: {
            faultClass: 'electorate_inactivity' | 'lost_key' | 'compromised_key';
            affectedActorPubkey: string;
            evidenceRef: string;
            maximumDurationSeconds: number;
        } | null;
    }) => Promise<void> | void;
    onApplyGovernanceAuthorityHealth?: (input: {
        bindingId: string;
        requestId: string;
    }) => Promise<void> | void;
    onPermanentlyBlockGovernanceAuthority?: (input: {
        bindingId: string;
    }) => Promise<void> | void;
    onSupersedeActiveGovernanceMandate?: (input: {
        mandateId: string;
        effectiveUntil: string;
        acceptanceExpiresAt: string;
        minimumConstraints: GovernanceMandateMinimumConstraints;
        operatorPolicyConstraints: GovernanceMandateOperatorPolicyConstraints | null;
        crossInstitutionDisclosureImpact: GovernanceCrossInstitutionDisclosureDeclaration | null;
    }) => Promise<void> | void;
    onDeactivateActiveGovernanceMandate?: (input: {
        bindingId: string;
        reason?: string | null;
    }) => Promise<void> | void;
    onSubmitGovernanceSignal?: (
        request: CircleGovernanceRequestSummary,
        value: 'approve' | 'reject',
    ) => Promise<void> | void;
    onCounterGovernanceMandate?: (input: {
        mandateId: string;
        actionType: string | null;
        actionPrefix: string | null;
        effectiveFrom: string;
        effectiveUntil: string;
        acceptanceExpiresAt: string;
        minimumConstraints: GovernanceMandateMinimumConstraints;
        subject: { type: string; ref: string };
        purposeBindings: Array<{
            purpose: GovernanceMandatePurposeValue;
            actionType: string | null;
            actionPrefix: string | null;
        }>;
        feePolicy: GovernanceMandateFeePolicy;
        effectPolicy: GovernanceMandateEffectPolicy | null;
        operatorPolicyConstraints: GovernanceMandateOperatorPolicyConstraints | null;
        crossInstitutionDisclosureImpact?: GovernanceCrossInstitutionDisclosureDeclaration | null;
    }) => Promise<void> | void;
    onAcceptGovernanceMandateCounter?: (binding: CircleGovernanceBinding) => Promise<void> | void;
    deleteCircleAvailable?: boolean;
    deleteCircleNotice?: string | null;
    onDeleteCircle?: () => void;
    onDissolveCircle?: (input: {
        reason: string;
        exitWindowEndsAt: string;
        retentionSuccessorHomeIdentityBindingId?: string | null;
    }) => Promise<void> | void;
    onExportLifecycleTimeline?: () => Promise<void> | void;
    onApproveMergeSource?: (input: CircleMergeDispositionInput) => Promise<void> | void;
    onAcceptMergeSuccessor?: (sourceApprovalRequestIds: string[], reason: string) => Promise<void> | void;
    onFinalizeMerge?: () => Promise<void> | void;
    onRoleChange?: (member: MemberInfo, newRole: 'Moderator' | 'Member') => Promise<void> | void;
    onRemoveMember?: (member: MemberInfo, reason: string) => Promise<void> | void;
    onRequestOwnerTransfer?: (member: MemberInfo) => Promise<void> | void;
    onAcceptOwnerTransfer?: (transferId: string) => Promise<void> | void;
    onInvite?: () => void;
    onLeaveCircle?: () => Promise<void> | void;
}

function getWorkflowRoleOptions(
    t: ReturnType<typeof useI18n>,
): Array<{value: CircleDraftWorkflowPolicy['createIssueMinRole']; label: string}> {
    return [
        { value: 'Initiate', label: t('roleOptions.initiate') },
        { value: 'Member', label: t('roleOptions.member') },
        { value: 'Elder', label: t('roleOptions.elder') },
        { value: 'Moderator', label: t('roleOptions.moderator') },
        { value: 'Admin', label: t('roleOptions.admin') },
        { value: 'Owner', label: t('roleOptions.owner') },
    ];
}

type WorkflowPolicyRoleField =
    | 'createIssueMinRole'
    | 'followupIssueMinRole'
    | 'reviewIssueMinRole'
    | 'retagIssueMinRole'
    | 'applyIssueMinRole'
    | 'manualEndDraftingMinRole'
    | 'advanceFromReviewMinRole'
    | 'enterCrystallizationMinRole';

function getReviewEntryModeHelp(
    mode: DraftReviewEntryMode,
    t: ReturnType<typeof useI18n>,
): string {
    if (mode === 'auto_only') return t('reviewEntry.help.autoOnly');
    if (mode === 'manual_only') return t('reviewEntry.help.manualOnly');
    return t('reviewEntry.help.autoOrManual');
}

function normalizeCrystalThreshold(value: number): number {
    return Math.max(1, Math.min(0xffff, Math.floor(Number(value || 1))));
}

/* ═══ Component ═══ */

export default function CircleSettingsSheet({
    open,
    focusSection = null,
    circleId = null,
    circleName,
    circleType = null,
    circleMode,
    settingsDataReady = true,
    accessType,
    minCrystals = 0,
    allowForwardOut,
    forwardPolicyEditable = false,
    forwardPolicyNotice = null,
    identityRules = null,
    members,
    memberDirectoryNotice = null,
    currentUserRole,
    currentUserActualRole = null,
    focusedGuardianFindingId = null,
    currentUserId = null,
    ghostSettings = null,
    ghostSettingsSource = null,
    ghostSettingsGovernancePending = null,
    ghostSettingsLoading = false,
    ghostSettingsSaving = false,
    ghostSettingsError = null,
    primaryGeoAnchor = null,
    primaryGeoAnchorLoading = false,
    primaryGeoAnchorSaving = false,
    primaryGeoAnchorError = null,
    primaryGeoAnchorGovernanceRequestId = null,
    draftLifecycleTemplate = null,
    draftWorkflowPolicy = null,
    draftLifecycleSaving = false,
    draftLifecycleError = null,
    draftLifecycleNotice = null,
    draftPromptScopes = [],
    draftPromptLoading = false,
    draftPromptSaving = false,
    draftPromptError = null,
    accessPolicyEditable = false,
    accessPolicySaving = false,
    accessPolicyError = null,
    accessPolicyNotice = null,
    accessPolicyGovernanceRequired = false,
    agents = [],
    agentPolicy = null,
    agentPolicyLoading = false,
    agentPolicySaving = false,
    agentPolicyError = null,
    governanceCommittee: governanceCommitteeProp = null,
    governanceResourceReadiness = null,
    committeeProfile = null,
    committeeProfileLoading = false,
    committeeProfileStatus = null,
    canManageGovernanceBindings = false,
    committeeGovernanceRequests = [],
    targetGovernanceBindings = [],
    committeeGovernanceBindings = [],
    committeeGovernanceRequestsLoading = false,
    committeeGovernanceSignalActionKey = null,
    committeeGovernanceSignalError = null,
    governanceRecovery = null,
    circleLifecycleStatus = null,
    canManageLifecycle = false,
    lifecycleActionStatus = null,
    mergeActionStatus = null,
    ownerTransferRequests = [],
    onClose,
    onToggleForward,
    onSaveGhostSettings,
    onSavePrimaryGeoAnchor,
    onArchivePrimaryGeoAnchor,
    onSaveDraftLifecycleTemplate,
    onSaveDraftWorkflowPolicy,
    onSaveDraftPrompt,
    onSaveAccessPolicy,
    onAccessPolicyDraftChange,
    onSaveAgentPolicy,
    onUpdateCommitteeAvailability,
    onCreateGovernanceBinding,
    onUpdateActiveGovernancePolicy,
    onCreateGovernanceRecoveryPolicy,
    onOpenGovernanceAuthorityHealth,
    onApplyGovernanceAuthorityHealth,
    onPermanentlyBlockGovernanceAuthority,
    onSupersedeActiveGovernanceMandate,
    onDeactivateActiveGovernanceMandate,
    onSubmitGovernanceSignal,
    onCounterGovernanceMandate,
    onAcceptGovernanceMandateCounter,
    deleteCircleAvailable = false,
    deleteCircleNotice = null,
    onDeleteCircle,
    onDissolveCircle,
    onExportLifecycleTimeline,
    onApproveMergeSource,
    onAcceptMergeSuccessor,
    onFinalizeMerge,
    onRoleChange,
    onRemoveMember,
    onRequestOwnerTransfer,
    onAcceptOwnerTransfer,
    onInvite,
    onLeaveCircle,
}: CircleSettingsSheetProps) {
    const t = useI18n('CircleSettingsSheet');
    const circleSettingsT = useI18n('CircleSettings');
    const locale = useCurrentLocale();
    const formatAiPanelError = (error: unknown, fallback: string): string => formatNodeRoutingError(error, fallback, {
        privateSidecarRequired: t('aiRouting.privateSidecarRequired'),
        surfaceUnavailable: t('aiRouting.surfaceUnavailable'),
    });
    const [knowledgeRelationshipLabelsOpen, setKnowledgeRelationshipLabelsOpen] = useState(false);
    const {
        data: knowledgeRelationshipLabelsData,
        loading: knowledgeRelationshipLabelsLoading,
        error: knowledgeRelationshipLabelsError,
    } = useQuery<{
        knowledgeRelationshipLabels: GQLKnowledgeRelationshipLabel[];
    }>(GET_KNOWLEDGE_RELATIONSHIP_LABELS, {
        variables: { status: 'active' },
        skip: !open,
    });
    const knowledgeRelationshipLabels = knowledgeRelationshipLabelsData?.knowledgeRelationshipLabels ?? [];
    const workflowRoleOptions = getWorkflowRoleOptions(t);
    const governanceActionScopeOptions = GOVERNANCE_ACTION_SCOPE_OPTIONS.map((option) => ({
        value: option.value,
        label: t(option.labelKey),
    }));
    const governanceBindingTypeOptions: Array<{ value: GovernanceBindingTypeValue; label: string }> = [
        { value: 'self_governed', label: t('governance.bindingTypeSelfGoverned') },
        { value: 'local_auxiliary', label: t('governance.bindingTypeLocalAuxiliary') },
        { value: 'shared_committee', label: t('governance.bindingTypeSharedCommittee') },
    ];
    const governanceNetworkOptions = (['solana:devnet', 'solana:localnet'] as const).map((value) => ({
        value,
        label: t(`governance.network.${value === 'solana:devnet' ? 'devnet' : 'localnet'}`),
    }));
    const governanceMandatePurposeOptions: Array<{ value: GovernanceMandatePurposeValue; label: string }> = [
        { value: 'collective_decision', label: t('governance.mandatePurposeCollectiveDecision') },
        { value: 'operational_execution', label: t('governance.mandatePurposeOperationalExecution') },
    ];
    const mandateRiskFloorOptions = (['low', 'medium', 'high', 'critical'] as const).map((value) => ({
        value,
        label: t(`governance.mandateRiskFloor.${value}`),
    }));
    const committeeReceiveWindowDurationOptions = COMMITTEE_RECEIVE_WINDOW_DURATION_OPTIONS.map((value) => ({
        value,
        label: t('governance.committeeReceiveWindowDurationValue', { count: value }),
    }));
    const committeeThresholdOptions = COMMITTEE_THRESHOLD_MODES.map((value) => ({
        value,
        label: t(`governance.committeeThreshold.${value}`),
    }));
    const committeeBallotDisclosureOptions = COMMITTEE_BALLOT_DISCLOSURE_MODES.map((value) => ({
        value,
        label: t(`governance.committeeBallotDisclosure.${value}`),
    }));
    const defaultGhostSettings: CircleGhostSettings = {
        summaryUseLLM: false,
        draftTriggerMode: 'notify_only',
        triggerSummaryUseLLM: false,
        triggerGenerateComment: true,
    };
    const defaultDraftLifecycleTemplate = {
        reviewEntryMode: draftLifecycleTemplate?.reviewEntryMode === 'auto_only'
            ? 'auto_only'
            : draftLifecycleTemplate?.reviewEntryMode === 'manual_only'
                ? 'manual_only'
                : 'auto_or_manual',
        draftingWindowMinutes: Math.max(1, Number(draftLifecycleTemplate?.draftingWindowMinutes || 30)),
        reviewWindowMinutes: Math.max(1, Number(draftLifecycleTemplate?.reviewWindowMinutes || 240)),
        maxRevisionRounds: Math.max(1, Number(draftLifecycleTemplate?.maxRevisionRounds || 1)),
    } as const;
    const defaultDraftWorkflowPolicy: CircleDraftWorkflowPolicy = {
        createIssueMinRole: draftWorkflowPolicy?.createIssueMinRole ?? DEFAULT_CIRCLE_DRAFT_WORKFLOW_POLICY.createIssueMinRole,
        followupIssueMinRole: draftWorkflowPolicy?.followupIssueMinRole ?? DEFAULT_CIRCLE_DRAFT_WORKFLOW_POLICY.followupIssueMinRole,
        reviewIssueMinRole: draftWorkflowPolicy?.reviewIssueMinRole ?? DEFAULT_CIRCLE_DRAFT_WORKFLOW_POLICY.reviewIssueMinRole,
        retagIssueMinRole: draftWorkflowPolicy?.retagIssueMinRole ?? DEFAULT_CIRCLE_DRAFT_WORKFLOW_POLICY.retagIssueMinRole,
        applyIssueMinRole: draftWorkflowPolicy?.applyIssueMinRole ?? DEFAULT_CIRCLE_DRAFT_WORKFLOW_POLICY.applyIssueMinRole,
        manualEndDraftingMinRole: draftWorkflowPolicy?.manualEndDraftingMinRole ?? DEFAULT_CIRCLE_DRAFT_WORKFLOW_POLICY.manualEndDraftingMinRole,
        advanceFromReviewMinRole: draftWorkflowPolicy?.advanceFromReviewMinRole ?? DEFAULT_CIRCLE_DRAFT_WORKFLOW_POLICY.advanceFromReviewMinRole,
        enterCrystallizationMinRole: draftWorkflowPolicy?.enterCrystallizationMinRole ?? DEFAULT_CIRCLE_DRAFT_WORKFLOW_POLICY.enterCrystallizationMinRole,
        allowAuthorWithdrawBeforeReview: draftWorkflowPolicy?.allowAuthorWithdrawBeforeReview ?? DEFAULT_CIRCLE_DRAFT_WORKFLOW_POLICY.allowAuthorWithdrawBeforeReview,
        allowModeratorRetagIssue: draftWorkflowPolicy?.allowModeratorRetagIssue ?? DEFAULT_CIRCLE_DRAFT_WORKFLOW_POLICY.allowModeratorRetagIssue,
    };
    const [forwardEnabled, setForwardEnabled] = useState(allowForwardOut);
    const [popoverTarget, setPopoverTarget] = useState<number | null>(null);
    const [memberRemovalTarget, setMemberRemovalTarget] = useState<number | null>(null);
    const [memberRemovalReason, setMemberRemovalReason] = useState('');
    const [ghostDraft, setGhostDraft] = useState<CircleGhostSettings>(
        ghostSettings || defaultGhostSettings,
    );
    const [ghostDirty, setGhostDirty] = useState(false);
    const [draftLifecycleDraft, setDraftLifecycleDraft] = useState(defaultDraftLifecycleTemplate);
    const [draftLifecycleDirty, setDraftLifecycleDirty] = useState(false);
    const [draftWorkflowDraft, setDraftWorkflowDraft] = useState(defaultDraftWorkflowPolicy);
    const [draftWorkflowDirty, setDraftWorkflowDirty] = useState(false);
    const draftWorkflowPreset = resolveDraftWorkflowGovernancePreset(draftWorkflowDraft);
    const draftWorkflowPresetOptions = [
        ...Object.keys(DRAFT_WORKFLOW_GOVERNANCE_PRESETS).map((value) => ({
            value: value as DraftWorkflowGovernancePresetSelection,
            label: t(`draftWorkflow.presets.${value}`),
        })),
        {
            value: 'custom' as DraftWorkflowGovernancePresetSelection,
            label: t('draftWorkflow.presets.custom'),
            disabled: true,
        },
    ];
    const [accessDraftType, setAccessDraftType] = useState<CircleAccessType>(accessType);
    const [accessDraftMinCrystals, setAccessDraftMinCrystals] = useState(normalizeCrystalThreshold(minCrystals || 1));
    const [committeeReceiveWindowMinutes, setCommitteeReceiveWindowMinutes] = useState<number>(10);
    const [committeeReceiveWindowActionPrefix, setCommitteeReceiveWindowActionPrefix] = useState<GovernanceActionScopeValue>('circle.lifecycle');
    const [committeeThresholdMode, setCommitteeThresholdMode] = useState<CommitteeThresholdMode>('default_majority');
    const [committeeFixedThreshold, setCommitteeFixedThreshold] = useState<number>(1);
    const [committeeQuadraticVoiceBudget, setCommitteeQuadraticVoiceBudget] = useState<number>(0);
    const [committeeBallotDisclosureMode, setCommitteeBallotDisclosureMode] = useState<CommitteeBallotDisclosureMode>('member');
    const [committeeTargetCircleId, setCommitteeTargetCircleId] = useState('');
    const [committeeBindingType, setCommitteeBindingType] = useState<GovernanceBindingTypeValue>('local_auxiliary');
    const [committeeBindingActionPrefix, setCommitteeBindingActionPrefix] = useState<GovernanceActionScopeValue>('circle.lifecycle');
    const [committeeExactActionType, setCommitteeExactActionType] = useState('');
    const [committeeExactSubjectType, setCommitteeExactSubjectType] = useState('circle');
    const [committeeExactSubjectRef, setCommitteeExactSubjectRef] = useState('');
    const [committeeExactNetwork, setCommitteeExactNetwork] = useState<'solana:localnet' | 'solana:devnet'>('solana:devnet');
    const [committeeMandatePurposes, setCommitteeMandatePurposes] = useState<GovernanceMandatePurposeValue[]>(['collective_decision']);
    const [committeeMandateDurationDays, setCommitteeMandateDurationDays] = useState(30);
    const [committeeMandateAcceptanceDays, setCommitteeMandateAcceptanceDays] = useState(7);
    const [committeeMandateRiskFloor, setCommitteeMandateRiskFloor] = useState<GovernanceMandateMinimumConstraints['riskFloor']>('high');
    const [committeeMandateMinimumApprovals, setCommitteeMandateMinimumApprovals] = useState(1);
    const [committeeMandateTimelockHours, setCommitteeMandateTimelockHours] = useState(24);
    const [committeeOperatorRoles, setCommitteeOperatorRoles] = useState<Array<'Owner' | 'Admin' | 'Moderator'>>(['Owner', 'Admin', 'Moderator']);
    const [committeeOperatorMaximumActors, setCommitteeOperatorMaximumActors] = useState(50);
    const [committeeOperatorMaximumDurationSeconds, setCommitteeOperatorMaximumDurationSeconds] = useState(86400);
    const [committeeOperatorMaximumInvocations, setCommitteeOperatorMaximumInvocations] = useState(10);
    const [committeeOperatorAppealWindowSeconds, setCommitteeOperatorAppealWindowSeconds] = useState(259200);
    const [committeeMandateFeeMode, setCommitteeMandateFeeMode] = useState<GovernanceMandateFeePolicy['mode']>('no_fee');
    const [committeeMandateEconomicBearer, setCommitteeMandateEconomicBearer] = useState<GovernanceMandateFeePolicy['economicBearer']>('delegator');
    const [committeeMandateMaximumAmountMinor, setCommitteeMandateMaximumAmountMinor] = useState('');
    const [committeeMandateFeeUnit, setCommitteeMandateFeeUnit] = useState('USDC');
    const [mandateDisclosureDataCategories, setMandateDisclosureDataCategories] = useState<GovernanceDisclosureDataCategory[]>([
        'subject_reference',
        'evidence_digest',
    ]);
    const [mandateDisclosureRegions, setMandateDisclosureRegions] = useState('');
    const [mandateDisclosureRetentionDays, setMandateDisclosureRetentionDays] = useState(30);
    const committeeMandateHasOperationalPurpose = committeeMandatePurposes.includes('operational_execution');
    const committeeMandateIsMultiPurpose = committeeMandatePurposes.length > 1;
    const resolvedExactActionType = (
        committeeExactActionType.trim()
        || (
            committeeBindingActionPrefix === 'storage_fabric.authorize_provider_admission'
                ? 'storage_fabric.authorize_provider_admission'
                : ''
        )
    );
    const usesExactActionBinding = resolvedExactActionType.length > 0;
    const displayedCommitteeBindingActionScope = committeeBindingType === 'shared_committee'
        && committeeMandateHasOperationalPurpose
        && !usesExactActionBinding
        ? committeeMandateIsMultiPurpose ? 'communication' : 'communication.member.mute'
        : committeeBindingActionPrefix;
    const [memberActionKey, setMemberActionKey] = useState<string | null>(null);
    const [memberActionError, setMemberActionError] = useState<string | null>(null);
    const basicSectionRef = useRef<HTMLDivElement | null>(null);
    const contentSectionRef = useRef<HTMLDivElement | null>(null);
    const membersSectionRef = useRef<HTMLDivElement | null>(null);
    const governanceSectionRef = useRef<HTMLDivElement | null>(null);
    const [circleIdCopied, setCircleIdCopied] = useState(false);
    const [recoveryCircleIdInput, setRecoveryCircleIdInput] = useState('');
    const [recoveryTargetCommitteeCircleIdInput, setRecoveryTargetCommitteeCircleIdInput] = useState('');
    const [recoveryPolicyBusy, setRecoveryPolicyBusy] = useState(false);
    const [recoveryPolicyError, setRecoveryPolicyError] = useState<string | null>(null);
    const [authorityHealthBusy, setAuthorityHealthBusy] = useState(false);
    const [authorityHealthError, setAuthorityHealthError] = useState<string | null>(null);
    const [governanceBindingSubmitError, setGovernanceBindingSubmitError] = useState<string | null>(null);
    const [authorityFaultClass, setAuthorityFaultClass] = useState<'electorate_inactivity' | 'lost_key' | 'compromised_key'>('compromised_key');
    const [authorityFaultActor, setAuthorityFaultActor] = useState('');
    const [authorityFaultEvidenceRef, setAuthorityFaultEvidenceRef] = useState('');
    const [authorityFaultMaximumHours, setAuthorityFaultMaximumHours] = useState(24);
    const [governedActionRouting, setGovernedActionRouting] = useState<GovernedActionRoutingReadback | null>(null);
    const [governedActionRoutingLoading, setGovernedActionRoutingLoading] = useState(false);
    const [governedActionRoutingError, setGovernedActionRoutingError] = useState<string | null>(null);
    const [realmsProviderTrustReadback, setRealmsProviderTrustReadback] = useState<RealmsProviderTrustReadback | null>(null);
    const [realmsProviderTrustReadbackLoading, setRealmsProviderTrustReadbackLoading] = useState(false);
    const [realmsProviderTrustReadbackError, setRealmsProviderTrustReadbackError] = useState<string | null>(null);
    const [realmsProviderBindingRequest, setRealmsProviderBindingRequest] = useState<CircleGovernanceRequest | null>(null);
    const [realmsProviderBindingRequestLoading, setRealmsProviderBindingRequestLoading] = useState(false);
    const [realmsProviderBindingRequestError, setRealmsProviderBindingRequestError] = useState<string | null>(null);
    const [squadsProviderTrustReadback, setSquadsProviderTrustReadback] = useState<SquadsProviderTrustReadback | null>(null);
    const [squadsProviderTrustReadbackLoading, setSquadsProviderTrustReadbackLoading] = useState(false);
    const [squadsProviderTrustReadbackError, setSquadsProviderTrustReadbackError] = useState<string | null>(null);
    const squadsProviderTrustReadbackInFlightRef = useRef<{
        circleId: number;
        promise: Promise<void>;
    } | null>(null);
    const [squadsProviderBindingRequest, setSquadsProviderBindingRequest] = useState<CircleGovernanceRequest | null>(null);
    const [squadsProviderBindingRequestLoading, setSquadsProviderBindingRequestLoading] = useState(false);
    const [squadsProviderBindingRequestError, setSquadsProviderBindingRequestError] = useState<string | null>(null);
    const [grantPayoutRequestReadback, setGrantPayoutRequestReadback] = useState<{
        agreementId: string;
        request: CircleGovernanceRequest;
    } | null>(null);
    const [grantPayoutRequestLoading, setGrantPayoutRequestLoading] = useState(false);
    const [grantPayoutRequestError, setGrantPayoutRequestError] = useState<string | null>(null);
    const [squadsProviderAdoptionManifest, setSquadsProviderAdoptionManifest] = useState('');
    const [continuityReplacementActor, setContinuityReplacementActor] = useState('');
    const [continuityIncidentReviewRef, setContinuityIncidentReviewRef] = useState('');
    const [continuityIncidentReviewSummary, setContinuityIncidentReviewSummary] = useState('');
    const [configurationCopilotState, setConfigurationCopilotState] = useState<ConfigurationCopilotUiState>({ status: 'idle' });
    const [acceptedConfigurationFields, setAcceptedConfigurationFields] = useState<string[]>([]);
    const [configurationUndoStack, setConfigurationUndoStack] = useState<ConfigurationUndoEntry[]>([]);
    const configurationCopilotAbortRef = useRef<AbortController | null>(null);
    const configurationCopilotRequestKeyRef = useRef<string>('');
    const configurationLocalApplyCountRef = useRef(0);
    const [circleStylePreference, setCircleStylePreference] = useState<StylePreferenceView | null>(null);
    const [styleAdvisorState, setStyleAdvisorState] = useState<StyleAdvisorUiState>({ status: 'idle' });
    const styleAdvisorAbortRef = useRef<AbortController | null>(null);
    const styleAdvisorRequestKeyRef = useRef<string>('');
    const [guardianFindings, setGuardianFindings] = useState<GuardianFindingView[]>([]);
    const [guardianFindingState, setGuardianFindingState] = useState<GuardianFindingUiState>({ status: 'idle' });
    const [guardianFindingStatusFilter, setGuardianFindingStatusFilter] = useState<GuardianFindingStatus | 'all'>('all');
    const [guardianFindingLevelFilter, setGuardianFindingLevelFilter] = useState<GuardianFindingLevel | 'all'>('all');
    const [circleGrowthProposals, setCircleGrowthProposals] = useState<CircleGrowthProposalView[]>([]);
    const [circleGrowthAdvisorState, setCircleGrowthAdvisorState] = useState<CircleGrowthAdvisorUiState>({ status: 'idle' });

    const [identityRulesExpanded, setIdentityRulesExpanded] = useState(false);
    const [draftLifecycleExpanded, setDraftLifecycleExpanded] = useState(false);
    const [draftPromptExpanded, setDraftPromptExpanded] = useState(false);
    const [knowledgeDraftPromptBody, setKnowledgeDraftPromptBody] = useState('');
    const [governanceDraftPromptBody, setGovernanceDraftPromptBody] = useState('');
    const [dissolutionReason, setDissolutionReason] = useState('');
    const [dissolutionExitWindowEndsAt, setDissolutionExitWindowEndsAt] = useState('');
    const [dissolutionRetentionSuccessor, setDissolutionRetentionSuccessor] = useState('');
    const [mergeSuccessorCircleId, setMergeSuccessorCircleId] = useState('');
    const [mergeMembershipDisposition, setMergeMembershipDisposition] = useState<CircleMergeDispositionInput['membershipDisposition']>('reconsent');
    const [mergeContentDisposition, setMergeContentDisposition] = useState<CircleMergeDispositionInput['contentDisposition']>('reference_only');
    const [mergeExitWindowEndsAt, setMergeExitWindowEndsAt] = useState('');
    const [mergeExportWindowEndsAt, setMergeExportWindowEndsAt] = useState('');
    const [mergeDisclosureNoticeRef, setMergeDisclosureNoticeRef] = useState('');
    const [mergeIdentityEvidenceRef, setMergeIdentityEvidenceRef] = useState('');
    const [mergeResourceEvidenceRef, setMergeResourceEvidenceRef] = useState('');
    const [mergeMandateEvidenceRef, setMergeMandateEvidenceRef] = useState('');
    const [mergePrivacyEvidenceRef, setMergePrivacyEvidenceRef] = useState('');
    const [mergeSourceApprovalRefs, setMergeSourceApprovalRefs] = useState('');
    const [mergeSuccessorReason, setMergeSuccessorReason] = useState('');
    const [draftWorkflowExpanded, setDraftWorkflowExpanded] = useState(false);
    const usesAutoReviewTimer = draftLifecycleDraft.reviewEntryMode !== 'manual_only';
    const knowledgeDraftPrompt = draftPromptScopes.find((entry) => entry.scope === 'knowledge_draft') ?? null;
    const governanceDraftPrompt = draftPromptScopes.find((entry) => entry.scope === 'governance_draft') ?? null;
    const canEditDraftPrompt = Boolean(onSaveDraftPrompt)
        && (currentUserActualRole === 'Owner' || currentUserActualRole === 'Admin');
    const canEditAccessPolicy =
        accessPolicyEditable
        && Boolean(onSaveAccessPolicy);
    const canEditPrimaryGeoAnchor =
        Boolean(onSavePrimaryGeoAnchor)
        && (
            currentUserActualRole === 'Owner'
            || currentUserActualRole === 'Admin'
            || currentUserActualRole === 'Moderator'
        );
    const canReadGovernedActionRouting =
        Number.isSafeInteger(Number(circleId))
        && Number(circleId) > 0
        && (
            currentUserActualRole === 'Owner'
            || currentUserActualRole === 'Admin'
            || currentUserActualRole === 'Moderator'
        );
    const canUseConfigurationCopilot =
        (currentUserRole === 'owner' || currentUserRole === 'curator')
        && (
            canEditAccessPolicy
            || Boolean(onSaveGhostSettings)
            || Boolean(onSaveDraftLifecycleTemplate)
            || Boolean(onSaveDraftWorkflowPolicy)
        );
    const canUseStyleAdvisor =
        SHOW_CIRCLE_STYLE_ADVISOR_ENTRY
        && (currentUserRole === 'owner' || currentUserRole === 'curator')
        && Number.isFinite(Number(circleId))
        && Number(circleId) > 0;
    const canUseGuardianFindings =
        SHOW_GUARDIAN_FINDINGS_USER_ENTRY
        && (currentUserActualRole === 'Owner' || currentUserActualRole === 'Admin')
        && Number.isFinite(Number(circleId))
        && Number(circleId) > 0;
    const canUseCircleGrowthAdvisor =
        (currentUserActualRole === 'Owner' || currentUserActualRole === 'Admin')
        && Number.isFinite(Number(circleId))
        && Number(circleId) > 0;
    const currentAccessMinCrystals = accessType === 'crystal'
        ? normalizeCrystalThreshold(minCrystals || 1)
        : 0;
    const normalizedAccessDraftMinCrystals = accessDraftType === 'crystal'
        ? normalizeCrystalThreshold(accessDraftMinCrystals)
        : 0;
    const accessPolicyDirty =
        accessDraftType !== accessType
        || normalizedAccessDraftMinCrystals !== currentAccessMinCrystals;
    const settingsComposeScenario = resolveCircleSettingsScenario({
        focusSection,
        governanceActionRequired: Boolean(authorityHealthError),
        accessPolicyDirty,
        ghostDirty,
        draftLifecycleDirty,
        draftWorkflowDirty,
    });
    const accessPolicyWalletImpact = resolveAccessPolicyWalletImpact({
        minCrystalsChanged: !accessPolicyGovernanceRequired
            && normalizedAccessDraftMinCrystals !== currentAccessMinCrystals,
        policyChanged: accessPolicyGovernanceRequired
            ? accessPolicyDirty
            : accessDraftType !== accessType,
    });
    const accessOptions: Array<{ value: CircleAccessType; label: string }> = [
        { value: 'free', label: t('accessEditor.free') },
        { value: 'crystal', label: t('accessEditor.crystal') },
        { value: 'invite', label: t('accessEditor.invite') },
        { value: 'approval', label: t('accessEditor.approval') },
    ];
    const governanceCommittee = governanceCommitteeProp ?? {
        status: 'action_registry_resolved' as const,
        bindingType: null,
        committeeCircleId: null,
        committeeCircleName: null,
        actionScope: null,
        ruleId: null,
        eligibleCount: null,
        singlePersonCommittee: false,
    };

    const renderAccessLabel = (type: CircleAccessType, threshold: number) => {
        if (type === 'crystal') {
            return t('basic.accessCrystal', { count: normalizeCrystalThreshold(threshold || 1) });
        }
        if (type === 'invite') {
            return t('basic.accessInvite');
        }
        if (type === 'approval') {
            return t('basic.accessApproval');
        }
        return t('basic.accessFree');
    };

    const buildConfigurationRequestKey = () => JSON.stringify({
        circleId,
        accessDraftType,
        accessDraftMinCrystals,
        ghostDraft,
        draftLifecycleDraft,
        draftWorkflowDraft,
    });

    const clearConfigurationCopilotState = () => {
        configurationCopilotAbortRef.current?.abort();
        configurationCopilotAbortRef.current = null;
        configurationCopilotRequestKeyRef.current = '';
        configurationLocalApplyCountRef.current = 0;
        setConfigurationCopilotState({ status: 'idle' });
        setAcceptedConfigurationFields([]);
        setConfigurationUndoStack([]);
    };

    const clearStyleAdvisorState = () => {
        styleAdvisorAbortRef.current?.abort();
        styleAdvisorAbortRef.current = null;
        styleAdvisorRequestKeyRef.current = '';
        setStyleAdvisorState({ status: 'idle' });
    };

    const clearGuardianFindingState = () => {
        setGuardianFindings([]);
        setGuardianFindingState({ status: 'idle' });
        setGuardianFindingStatusFilter('all');
        setGuardianFindingLevelFilter('all');
    };

    const clearCircleGrowthAdvisorState = () => {
        setCircleGrowthProposals([]);
        setCircleGrowthAdvisorState({ status: 'idle' });
    };

    const normalizedFocusedGuardianFindingId = String(focusedGuardianFindingId || '').trim();

    const isGenericGuardianFinding = (finding: GuardianFindingView): boolean =>
        finding.findingKind !== 'circle_growth_opportunity';

    const mergeFocusedGuardianFinding = (
        findings: GuardianFindingView[],
        focusedFinding: GuardianFindingView | null,
    ): GuardianFindingView[] => {
        const genericFindings = findings.filter(isGenericGuardianFinding);
        if (!focusedFinding || !isGenericGuardianFinding(focusedFinding)) return genericFindings;
        return [
            focusedFinding,
            ...genericFindings.filter((finding) => finding.id !== focusedFinding.id),
        ];
    };

    const markConfigurationLocalApply = () => {
        configurationLocalApplyCountRef.current += 1;
    };

    const handleCloseSettings = () => {
        clearConfigurationCopilotState();
        clearStyleAdvisorState();
        clearGuardianFindingState();
        clearCircleGrowthAdvisorState();
        onClose();
    };

    const refreshGuardianFindings = async () => {
        if (!canUseGuardianFindings) return;
        const targetCircleId = Number(circleId);
        setGuardianFindingState({ status: 'loading' });
        try {
            const findings = await listGuardianFindings({
                circleId: targetCircleId,
                status: guardianFindingStatusFilter,
                level: guardianFindingLevelFilter,
            });
            let focusedFinding: GuardianFindingView | null = null;
            if (normalizedFocusedGuardianFindingId && !findings.some((finding) => finding.id === normalizedFocusedGuardianFindingId)) {
                try {
                    const loaded = await getGuardianFinding(normalizedFocusedGuardianFindingId);
                    if (Number(loaded.circleId) === targetCircleId && isGenericGuardianFinding(loaded)) {
                        focusedFinding = loaded;
                    }
                } catch {
                    focusedFinding = null;
                }
            } else if (normalizedFocusedGuardianFindingId) {
                focusedFinding = findings.find((finding) =>
                    finding.id === normalizedFocusedGuardianFindingId && isGenericGuardianFinding(finding)
                ) ?? null;
            }
            setGuardianFindings(mergeFocusedGuardianFinding(findings, focusedFinding));
            setGuardianFindingState({ status: 'ready' });
        } catch (error) {
            setGuardianFindingState({
                status: 'error',
                message: formatAiPanelError(error, t('guardianFindings.failed')),
            });
        }
    };

    const refreshCircleGrowthProposals = async () => {
        if (!canUseCircleGrowthAdvisor) return;
        const targetCircleId = Number(circleId);
        setCircleGrowthAdvisorState({ status: 'loading' });
        try {
            const proposals = await listCircleGrowthProposals({
                circleId: targetCircleId,
                limit: 10,
            });
            setCircleGrowthProposals(proposals);
            setCircleGrowthAdvisorState({ status: 'ready' });
        } catch (error) {
            setCircleGrowthAdvisorState({
                status: 'error',
                message: formatAiPanelError(error, t('circleGrowthAdvisor.failed')),
            });
        }
    };

    useEffect(() => {
        if (!open || (focusSection !== 'members' && focusSection !== 'governance')) return;
        const frame = window.requestAnimationFrame(() => {
            if (focusSection === 'members') {
                membersSectionRef.current?.scrollIntoView({ block: 'start' });
            } else {
                governanceSectionRef.current?.scrollIntoView({ block: 'start' });
            }
        });
        return () => window.cancelAnimationFrame(frame);
    }, [focusSection, open]);

    useEffect(() => {
        setForwardEnabled(allowForwardOut);
    }, [allowForwardOut]);

    useEffect(() => {
        if (!open) {
            clearConfigurationCopilotState();
            clearStyleAdvisorState();
            clearGuardianFindingState();
            clearCircleGrowthAdvisorState();
        }
        return () => {
            configurationCopilotAbortRef.current?.abort();
            styleAdvisorAbortRef.current?.abort();
        };
        // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [open]);

    useEffect(() => {
        if (!open || !canUseGuardianFindings) return;
        void refreshGuardianFindings();
        // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [open, canUseGuardianFindings, circleId, guardianFindingStatusFilter, guardianFindingLevelFilter, normalizedFocusedGuardianFindingId]);

    useEffect(() => {
        if (!open || !canUseCircleGrowthAdvisor) return;
        void refreshCircleGrowthProposals();
        // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [open, canUseCircleGrowthAdvisor, circleId]);

    useEffect(() => {
        if (!open || !canReadGovernedActionRouting) {
            setGovernedActionRouting(null);
            setGovernedActionRoutingLoading(false);
            setGovernedActionRoutingError(null);
            return;
        }
        let cancelled = false;
        setGovernedActionRoutingLoading(true);
        setGovernedActionRoutingError(null);
        fetchGovernedActionRouting(Number(circleId)).then((routing) => {
            if (!cancelled) setGovernedActionRouting(routing);
        }).catch((error) => {
            if (!cancelled) {
                setGovernedActionRouting(null);
                setGovernedActionRoutingError(
                    error instanceof Error ? error.message : 'governed_action_routing_readback_failed',
                );
            }
        }).finally(() => {
            if (!cancelled) setGovernedActionRoutingLoading(false);
        });
        return () => {
            cancelled = true;
        };
    }, [
        open,
        canReadGovernedActionRouting,
        circleId,
        governanceCommitteeProp?.bindingId,
        governanceCommitteeProp?.policyVersion,
    ]);

    useEffect(() => {
        setRealmsProviderTrustReadback(null);
        setRealmsProviderTrustReadbackLoading(false);
        setRealmsProviderTrustReadbackError(null);
        setRealmsProviderBindingRequest(null);
        setRealmsProviderBindingRequestLoading(false);
        setRealmsProviderBindingRequestError(null);
        setSquadsProviderTrustReadback(null);
        setSquadsProviderTrustReadbackLoading(false);
        setSquadsProviderTrustReadbackError(null);
        setSquadsProviderBindingRequest(null);
        setSquadsProviderBindingRequestLoading(false);
        setSquadsProviderBindingRequestError(null);
    }, [circleId]);

    const refreshRealmsProviderTrustReadback = async () => {
        if (!canManageGovernanceBindings || realmsProviderTrustReadbackLoading) return;
        setRealmsProviderTrustReadbackLoading(true);
        setRealmsProviderTrustReadbackError(null);
        try {
            const readback = await fetchRealmsProviderTrustReadback(Number(circleId));
            setRealmsProviderTrustReadback(readback);
        } catch (error) {
            setRealmsProviderTrustReadback(null);
            setRealmsProviderTrustReadbackError(
                error instanceof Error ? error.message : 'realms_provider_trust_readback_failed',
            );
        } finally {
            setRealmsProviderTrustReadbackLoading(false);
        }
    };

    const createRealmsProviderBindingRequest = async () => {
        if (!canManageGovernanceBindings || realmsProviderBindingRequestLoading) return;
        setRealmsProviderBindingRequestLoading(true);
        setRealmsProviderBindingRequestError(null);
        try {
            const result = await requestRealmsProviderBinding(Number(circleId));
            setRealmsProviderBindingRequest(result.request);
        } catch (error) {
            setRealmsProviderBindingRequest(null);
            setRealmsProviderBindingRequestError(
                error instanceof Error ? error.message : 'realms_provider_binding_request_failed',
            );
        } finally {
            setRealmsProviderBindingRequestLoading(false);
        }
    };

    const createRealmsProviderDisableRequest = async () => {
        if (!canManageGovernanceBindings || realmsProviderBindingRequestLoading) return;
        setRealmsProviderBindingRequestLoading(true);
        setRealmsProviderBindingRequestError(null);
        try {
            const result = await requestRealmsProviderDisable(Number(circleId));
            setRealmsProviderBindingRequest(result.request);
        } catch (error) {
            setRealmsProviderBindingRequest(null);
            setRealmsProviderBindingRequestError(
                error instanceof Error ? error.message : 'realms_provider_disable_request_failed',
            );
        } finally {
            setRealmsProviderBindingRequestLoading(false);
        }
    };

    const createRealmsProviderDelegationConformanceRequest = async () => {
        if (!canManageGovernanceBindings || realmsProviderBindingRequestLoading) return;
        setRealmsProviderBindingRequestLoading(true);
        setRealmsProviderBindingRequestError(null);
        try {
            const result = await requestRealmsProviderDelegationConformance(Number(circleId));
            setRealmsProviderBindingRequest(result.request);
        } catch (error) {
            setRealmsProviderBindingRequest(null);
            setRealmsProviderBindingRequestError(
                error instanceof Error ? error.message : 'realms_provider_delegation_request_failed',
            );
        } finally {
            setRealmsProviderBindingRequestLoading(false);
        }
    };

    const createRealmsVotingPowerChallengeConformanceRequest = async () => {
        if (!canManageGovernanceBindings || realmsProviderBindingRequestLoading) return;
        setRealmsProviderBindingRequestLoading(true);
        setRealmsProviderBindingRequestError(null);
        try {
            const result = await requestRealmsVotingPowerChallengeConformance(Number(circleId));
            setRealmsProviderBindingRequest(result.request);
        } catch (error) {
            setRealmsProviderBindingRequest(null);
            setRealmsProviderBindingRequestError(
                error instanceof Error ? error.message : 'realms_voting_power_challenge_request_failed',
            );
        } finally {
            setRealmsProviderBindingRequestLoading(false);
        }
    };

    const createRealmsProviderRestoreRequest = async () => {
        if (!canManageGovernanceBindings || realmsProviderBindingRequestLoading) return;
        setRealmsProviderBindingRequestLoading(true);
        setRealmsProviderBindingRequestError(null);
        try {
            const result = await requestRealmsProviderRestore(Number(circleId));
            setRealmsProviderBindingRequest(result.request);
        } catch (error) {
            setRealmsProviderBindingRequest(null);
            setRealmsProviderBindingRequestError(
                error instanceof Error ? error.message : 'realms_provider_restore_request_failed',
            );
        } finally {
            setRealmsProviderBindingRequestLoading(false);
        }
    };

    const refreshSquadsProviderTrustReadback = async (): Promise<void> => {
        if (!canManageGovernanceBindings) return;
        const targetCircleId = Number(circleId);
        const inFlight = squadsProviderTrustReadbackInFlightRef.current;
        if (inFlight?.circleId === targetCircleId) {
            await inFlight.promise;
            return;
        }
        let refresh!: Promise<void>;
        refresh = (async () => {
            setSquadsProviderTrustReadbackLoading(true);
            setSquadsProviderTrustReadbackError(null);
            try {
                const readback = await fetchSquadsProviderTrustReadback(targetCircleId);
                if (squadsProviderTrustReadbackInFlightRef.current?.promise === refresh) {
                    setSquadsProviderTrustReadback(readback);
                }
            } catch (error) {
                if (squadsProviderTrustReadbackInFlightRef.current?.promise === refresh) {
                    setSquadsProviderTrustReadback(null);
                    setSquadsProviderTrustReadbackError(
                        error instanceof Error ? error.message : 'squads_provider_trust_readback_failed',
                    );
                }
            } finally {
                if (squadsProviderTrustReadbackInFlightRef.current?.promise === refresh) {
                    setSquadsProviderTrustReadbackLoading(false);
                }
            }
        })();
        squadsProviderTrustReadbackInFlightRef.current = {
            circleId: targetCircleId,
            promise: refresh,
        };
        try {
            await refresh;
        } finally {
            if (squadsProviderTrustReadbackInFlightRef.current?.promise === refresh) {
                squadsProviderTrustReadbackInFlightRef.current = null;
            }
        }
    };

    useEffect(() => {
        if (!open || !canManageGovernanceBindings) return;
        void refreshSquadsProviderTrustReadback();
        // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [open, canManageGovernanceBindings, circleId]);

    const createSquadsProviderRequest = async (
        phase: 'binding' | 'bootstrap' | 'disable' | 'restore',
    ) => {
        if (!canManageGovernanceBindings || squadsProviderBindingRequestLoading) return;
        setSquadsProviderBindingRequestLoading(true);
        setSquadsProviderBindingRequestError(null);
        try {
            const result = phase === 'binding'
                ? await requestSquadsProviderBinding(Number(circleId))
                : phase === 'bootstrap'
                    ? await requestSquadsProviderBootstrap(Number(circleId))
                    : phase === 'disable'
                        ? await requestSquadsProviderDisable(Number(circleId))
                        : await requestSquadsProviderRestore(Number(circleId));
            setSquadsProviderBindingRequest(result.request);
        } catch (error) {
            setSquadsProviderBindingRequest(null);
            setSquadsProviderBindingRequestError(
                error instanceof Error ? error.message : `squads_provider_${phase}_request_failed`,
            );
        } finally {
            setSquadsProviderBindingRequestLoading(false);
        }
    };

    const createSquadsProviderAdoptionRequest = async () => {
        if (!canManageGovernanceBindings || squadsProviderBindingRequestLoading) return;
        setSquadsProviderBindingRequestLoading(true);
        setSquadsProviderBindingRequestError(null);
        try {
            const parsed = JSON.parse(squadsProviderAdoptionManifest) as SquadsExistingResourceAdoptionInput;
            if (parsed?.operation !== 'adopt_existing_finalized_no_asset_resource') {
                throw new Error('squads_provider_adoption_manifest_invalid');
            }
            if (parsed.targetCircleId !== Number(circleId)) {
                throw new Error('squads_provider_adoption_circle_scope_mismatch');
            }
            const result = await requestSquadsProviderAdoption(Number(circleId), parsed);
            setSquadsProviderBindingRequest(result.request);
        } catch (error) {
            setSquadsProviderBindingRequest(null);
            setSquadsProviderBindingRequestError(
                error instanceof Error ? error.message : 'squads_provider_adoption_request_failed',
            );
        } finally {
            setSquadsProviderBindingRequestLoading(false);
        }
    };

    const createGrantPayoutRequest = async (
        evaluation: CircleGovernanceResourceReadiness['grantSettlementReadiness']['evaluations'][number],
    ) => {
        if (
            !canManageGovernanceBindings
            || grantPayoutRequestLoading
            || !evaluation.caseId
            || !evaluation.trancheIntentId
        ) return;
        setGrantPayoutRequestLoading(true);
        setGrantPayoutRequestError(null);
        try {
            const result = await openGovernanceGrantPayoutRequest({
                caseId: evaluation.caseId,
                agreementId: evaluation.agreementId,
                trancheIntentId: evaluation.trancheIntentId,
            });
            setGrantPayoutRequestReadback({
                agreementId: evaluation.agreementId,
                request: result.request,
            });
        } catch (error) {
            setGrantPayoutRequestReadback(null);
            setGrantPayoutRequestError(
                error instanceof Error ? error.message : 'governance_grant_payout_request_failed',
            );
        } finally {
            setGrantPayoutRequestLoading(false);
        }
    };

    useEffect(() => {
        if (!normalizedFocusedGuardianFindingId) return;
        setGuardianFindingStatusFilter('all');
        setGuardianFindingLevelFilter('all');
    }, [normalizedFocusedGuardianFindingId]);

    useEffect(() => {
        if (!open || !canUseStyleAdvisor) return;
        const targetCircleId = Number(circleId);
        let cancelled = false;
        getCurrentStylePreference({
            scope: 'circle',
            circleId: targetCircleId,
        }).then((preference) => {
            if (!cancelled) setCircleStylePreference(preference);
        }).catch(() => undefined);
        return () => {
            cancelled = true;
        };
    }, [open, canUseStyleAdvisor, circleId]);

    useEffect(() => {
        const nextKey = buildConfigurationRequestKey();
        const transition = resolveConfigurationRequestKeyTransition({
            currentRequestKey: configurationCopilotRequestKeyRef.current,
            nextRequestKey: nextKey,
            pendingLocalApplyCount: configurationLocalApplyCountRef.current,
        });
        configurationLocalApplyCountRef.current = transition.nextPendingLocalApplyCount;
        configurationCopilotRequestKeyRef.current = transition.nextStoredRequestKey;
        if (transition.shouldClearProposal) {
            clearConfigurationCopilotState();
        }
        // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [
        circleId,
        accessDraftType,
        accessDraftMinCrystals,
        ghostDraft,
        draftLifecycleDraft,
        draftWorkflowDraft,
    ]);

    useEffect(() => {
        if (!open) return;
        setAccessDraftType(accessType);
        setAccessDraftMinCrystals(normalizeCrystalThreshold(minCrystals || 1));
    }, [open, accessType, minCrystals]);

    useEffect(() => {
        if (!open) return;
        setCommitteeReceiveWindowMinutes(
            COMMITTEE_RECEIVE_WINDOW_DURATION_OPTIONS.includes((committeeProfile?.windowMinutes ?? 10) as typeof COMMITTEE_RECEIVE_WINDOW_DURATION_OPTIONS[number])
                ? Number(committeeProfile?.windowMinutes ?? 10)
                : 10,
        );
        const currentPrefix = committeeProfile?.allowedActionPrefixes?.[0];
        const option = GOVERNANCE_ACTION_SCOPE_OPTIONS.find((item) => item.value === currentPrefix);
        setCommitteeReceiveWindowActionPrefix(option?.value ?? 'circle.lifecycle');
        setCommitteeThresholdMode(committeeProfile?.electorateTemplate.threshold.mode ?? 'default_majority');
        setCommitteeFixedThreshold(Math.max(1, committeeProfile?.electorateTemplate.threshold.value ?? 1));
        setCommitteeBallotDisclosureMode(committeeProfile?.electorateTemplate.ballotDisclosure.mode ?? 'member');
        setCommitteeQuadraticVoiceBudget(
            committeeProfile?.electorateTemplate.quadraticVoiceCredits.budgetPerActor ?? 0,
        );
    }, [open, committeeProfile?.windowMinutes, committeeProfile?.allowedActionPrefixes, committeeProfile?.electorateTemplate]);

    useEffect(() => {
        if (!open) return;
        if (ghostSettingsGovernancePending) {
            setGhostDraft(ghostSettingsGovernancePending.requestedSettings);
        } else if (ghostSettings) {
            setGhostDraft(ghostSettings);
        } else {
            setGhostDraft(defaultGhostSettings);
        }
        setGhostDirty(false);
    }, [open, ghostSettings, ghostSettingsGovernancePending]);

    useEffect(() => {
        if (!open) return;
        setDraftLifecycleDraft(defaultDraftLifecycleTemplate);
        setDraftLifecycleDirty(false);
    }, [open, draftLifecycleTemplate]);

    useEffect(() => {
        if (!open) return;
        const knowledgePrompt = draftPromptScopes.find((entry) => entry.scope === 'knowledge_draft');
        const governancePrompt = draftPromptScopes.find((entry) => entry.scope === 'governance_draft');
        setKnowledgeDraftPromptBody(knowledgePrompt?.promptBody ?? '');
        setGovernanceDraftPromptBody(governancePrompt?.promptBody ?? '');
    }, [open, draftPromptScopes]);

    useEffect(() => {
        if (!open) return;
        setDraftWorkflowDraft(defaultDraftWorkflowPolicy);
        setDraftWorkflowDirty(false);
    }, [open, draftWorkflowPolicy]);

    useEffect(() => {
        if (!open) return;
        setPopoverTarget(null);
        setMemberActionKey(null);
        setMemberActionError(null);
        setIdentityRulesExpanded(false);
        setDraftLifecycleExpanded(false);
        setDraftWorkflowExpanded(false);
        setCommitteeTargetCircleId('');
        setCommitteeBindingType('local_auxiliary');
        setCommitteeBindingActionPrefix('circle.lifecycle');
        setCommitteeExactActionType('');
        setCommitteeExactSubjectType('circle');
        setCommitteeExactSubjectRef('');
    }, [open]);

    const handleToggleForward = () => {
        if (!forwardPolicyEditable) return;
        const next = !forwardEnabled;
        setForwardEnabled(next);
        onToggleForward?.(next);
    };

    const updateGhostDraft = <K extends keyof CircleGhostSettings>(
        key: K,
        value: CircleGhostSettings[K],
    ) => {
        setGhostDraft((prev) => ({ ...prev, [key]: value }));
        setGhostDirty(true);
    };

    const canSaveGhostSettings = Boolean(onSaveGhostSettings)
        && settingsDataReady
        && !ghostSettingsLoading
        && !ghostSettingsSaving
        && ghostDirty;
    const canSaveDraftLifecycle = Boolean(onSaveDraftLifecycleTemplate)
        && settingsDataReady
        && !draftLifecycleSaving
        && draftLifecycleDirty;
    const canSaveDraftWorkflow = Boolean(onSaveDraftWorkflowPolicy)
        && settingsDataReady
        && !draftLifecycleSaving
        && draftWorkflowDirty;
    const canSaveAccessPolicy = Boolean(onSaveAccessPolicy)
        && settingsDataReady
        && !accessPolicySaving
        && accessPolicyDirty;

    const handleSaveGhostSettings = async () => {
        if (!canSaveGhostSettings) return;
        if (!onSaveGhostSettings) return;
        try {
            await onSaveGhostSettings({
                ...ghostDraft,
                triggerGenerateComment: true,
            });
            setGhostDirty(false);
        } catch {
            // error state is surfaced by parent via ghostSettingsError
        }
    };

    const updateDraftLifecycleDraft = <K extends keyof typeof defaultDraftLifecycleTemplate>(
        key: K,
        value: (typeof defaultDraftLifecycleTemplate)[K],
    ) => {
        setDraftLifecycleDraft((prev) => ({ ...prev, [key]: value }));
        setDraftLifecycleDirty(true);
    };

    const handleSaveDraftLifecycleTemplate = async () => {
        if (!canSaveDraftLifecycle || !onSaveDraftLifecycleTemplate) return;
        try {
            await onSaveDraftLifecycleTemplate({
                reviewEntryMode: draftLifecycleDraft.reviewEntryMode,
                draftingWindowMinutes: draftLifecycleDraft.draftingWindowMinutes,
                reviewWindowMinutes: draftLifecycleDraft.reviewWindowMinutes,
                maxRevisionRounds: draftLifecycleDraft.maxRevisionRounds,
            });
            setDraftLifecycleDirty(false);
        } catch {
            // error surfaced by parent
        }
    };

    const updateDraftWorkflowDraft = <K extends keyof CircleDraftWorkflowPolicy>(
        key: K,
        value: CircleDraftWorkflowPolicy[K],
    ) => {
        setDraftWorkflowDraft((prev) => ({ ...prev, [key]: value }));
        setDraftWorkflowDirty(true);
    };
    const handleDraftWorkflowPresetChange = (preset: DraftWorkflowGovernancePresetSelection) => {
        if (preset === 'custom') return;
        setDraftWorkflowDraft((prev) => applyDraftWorkflowGovernancePreset(preset, prev));
        setDraftWorkflowDirty(true);
    };
    const renderWorkflowRoleSelect = (key: WorkflowPolicyRoleField, ariaLabel: string) => (
        <Select
            ariaLabel={ariaLabel}
            value={draftWorkflowDraft[key]}
            options={workflowRoleOptions}
            onChange={(value) => updateDraftWorkflowDraft(key, value)}
            disabled={draftLifecycleSaving}
        />
    );

    const handleSaveDraftWorkflowPolicy = async () => {
        if (!canSaveDraftWorkflow || !onSaveDraftWorkflowPolicy) return;
        try {
            await onSaveDraftWorkflowPolicy(draftWorkflowDraft);
            setDraftWorkflowDirty(false);
        } catch {
            // error surfaced by parent
        }
    };

    const handleSaveAccessPolicy = async () => {
        if (!canSaveAccessPolicy || !onSaveAccessPolicy) return;
        try {
            await onSaveAccessPolicy({
                accessType: accessDraftType,
                minCrystals: normalizedAccessDraftMinCrystals,
            });
        } catch {
            // error surfaced by parent
        }
    };

    const runSettingsComposeCta = () => {
        if (!settingsComposeScenario) return;
        if (settingsComposeScenario.cta === 'save_access') {
            void handleSaveAccessPolicy();
            return;
        }
        if (settingsComposeScenario.cta === 'save_ghost') {
            void handleSaveGhostSettings();
            return;
        }
        if (settingsComposeScenario.cta === 'save_draft_lifecycle') {
            void handleSaveDraftLifecycleTemplate();
            return;
        }
        if (settingsComposeScenario.cta === 'save_draft_workflow') {
            void handleSaveDraftWorkflowPolicy();
            return;
        }
        scrollCircleSettingsSection(settingsComposeScenario.scrollSection);
    };

    const buildSettingsConfigurationSnapshot = () => ({
        accessType: accessDraftType,
        minCrystals: normalizedAccessDraftMinCrystals,
        ghostSettings: {
            summaryUseLLM: ghostDraft.summaryUseLLM,
            draftTriggerMode: ghostDraft.draftTriggerMode,
            triggerSummaryUseLLM: ghostDraft.triggerSummaryUseLLM,
        },
        draftLifecycleTemplate: {
            reviewEntryMode: draftLifecycleDraft.reviewEntryMode,
            draftingWindowMinutes: draftLifecycleDraft.draftingWindowMinutes,
            reviewWindowMinutes: draftLifecycleDraft.reviewWindowMinutes,
            maxRevisionRounds: draftLifecycleDraft.maxRevisionRounds,
        },
        draftWorkflowPolicy: {
            createIssueMinRole: draftWorkflowDraft.createIssueMinRole,
            reviewIssueMinRole: draftWorkflowDraft.reviewIssueMinRole,
            applyIssueMinRole: draftWorkflowDraft.applyIssueMinRole,
            advanceFromReviewMinRole: draftWorkflowDraft.advanceFromReviewMinRole,
            allowAuthorWithdrawBeforeReview: draftWorkflowDraft.allowAuthorWithdrawBeforeReview,
            allowModeratorRetagIssue: draftWorkflowDraft.allowModeratorRetagIssue,
        },
    });

    const getSettingsConfigurationFieldValue = (field: string): unknown => {
        const snapshot = buildSettingsConfigurationSnapshot() as Record<string, any>;
        return field.split('.').reduce<unknown>((current, key) => (
            current && typeof current === 'object' && !Array.isArray(current)
                ? (current as Record<string, unknown>)[key]
                : undefined
        ), snapshot);
    };

    const captureConfigurationDirtyState = (): ConfigurationSettingsDirtyState => ({
        ghostDirty,
        draftLifecycleDirty,
        draftWorkflowDirty,
    });

    const restoreConfigurationDirtyState = (dirtyState: ConfigurationSettingsDirtyState | undefined) => {
        if (!dirtyState) return;
        setGhostDirty(dirtyState.ghostDirty);
        setDraftLifecycleDirty(dirtyState.draftLifecycleDirty);
        setDraftWorkflowDirty(dirtyState.draftWorkflowDirty);
    };

    const setSettingsConfigurationFieldValue = (
        field: string,
        value: unknown,
        options: { markDirty?: boolean } = {},
    ) => {
        const markDirty = options.markDirty !== false;
        if (field === 'accessType') {
            setAccessDraftType(value as CircleAccessType);
            if (markDirty) onAccessPolicyDraftChange?.();
        } else if (field === 'minCrystals') {
            setAccessDraftMinCrystals(normalizeCrystalThreshold(Number(value) || 1));
            if (markDirty) onAccessPolicyDraftChange?.();
        } else if (field === 'ghostSettings.summaryUseLLM') {
            setGhostDraft((prev) => ({ ...prev, summaryUseLLM: Boolean(value) }));
            if (markDirty) setGhostDirty(true);
        } else if (field === 'ghostSettings.draftTriggerMode') {
            setGhostDraft((prev) => ({ ...prev, draftTriggerMode: value as CircleGhostSettings['draftTriggerMode'] }));
            if (markDirty) setGhostDirty(true);
        } else if (field === 'ghostSettings.triggerSummaryUseLLM') {
            setGhostDraft((prev) => ({ ...prev, triggerSummaryUseLLM: Boolean(value) }));
            if (markDirty) setGhostDirty(true);
        } else if (field === 'draftLifecycleTemplate.reviewEntryMode') {
            setDraftLifecycleDraft((prev) => ({ ...prev, reviewEntryMode: value as DraftReviewEntryMode }));
            if (markDirty) setDraftLifecycleDirty(true);
        } else if (field === 'draftLifecycleTemplate.draftingWindowMinutes') {
            setDraftLifecycleDraft((prev) => ({ ...prev, draftingWindowMinutes: Math.max(1, Number(value) || 1) }));
            if (markDirty) setDraftLifecycleDirty(true);
        } else if (field === 'draftLifecycleTemplate.reviewWindowMinutes') {
            setDraftLifecycleDraft((prev) => ({ ...prev, reviewWindowMinutes: Math.max(1, Number(value) || 1) }));
            if (markDirty) setDraftLifecycleDirty(true);
        } else if (field === 'draftLifecycleTemplate.maxRevisionRounds') {
            setDraftLifecycleDraft((prev) => ({ ...prev, maxRevisionRounds: Math.max(1, Number(value) || 1) }));
            if (markDirty) setDraftLifecycleDirty(true);
        } else if (field.startsWith('draftWorkflowPolicy.')) {
            const key = field.slice('draftWorkflowPolicy.'.length) as keyof CircleDraftWorkflowPolicy;
            setDraftWorkflowDraft((prev) => ({
                ...prev,
                [key]: value as never,
            }));
            if (markDirty) setDraftWorkflowDirty(true);
        }
    };

    const recordConfigurationEvent = (eventType: Parameters<typeof recordConfigurationCopilotEvent>[0]['eventType'], input: { field?: string; fields?: string[] } = {}) => {
        if (configurationCopilotState.status !== 'ready') return;
        void recordConfigurationCopilotEvent({
            proposalId: configurationCopilotState.proposal.id,
            eventType,
            field: input.field,
            fields: input.fields,
        }).catch(() => undefined);
    };

    const handleGenerateConfigurationProposal = async () => {
        if (configurationCopilotState.status === 'loading') return;
        if (!canUseConfigurationCopilot) {
            setConfigurationCopilotState({ status: 'error', message: t('configurationCopilot.unavailableLabel') });
            return;
        }
        const targetCircleId = Number(circleId);
        if (!Number.isFinite(targetCircleId) || targetCircleId <= 0) {
            setConfigurationCopilotState({ status: 'error', message: t('configurationCopilot.settingsUnavailable') });
            return;
        }
        const requestKey = buildConfigurationRequestKey();
        configurationCopilotAbortRef.current?.abort();
        const controller = new AbortController();
        configurationCopilotAbortRef.current = controller;
        configurationCopilotRequestKeyRef.current = requestKey;
        setAcceptedConfigurationFields([]);
        setConfigurationUndoStack([]);
        setConfigurationCopilotState({ status: 'loading', requestKey });
        try {
            const response = await requestConfigurationCopilot({
                entrypoint: 'circle_settings',
                circleId: targetCircleId,
                locale,
                userIntent: `${circleName} settings`,
                currentSnapshot: buildSettingsConfigurationSnapshot(),
            });
            if (configurationCopilotRequestKeyRef.current !== requestKey) return;
            if (response.status === 'disabled') {
                setConfigurationCopilotState({
                    status: 'disabled',
                    message: t('configurationCopilot.disabledFallback'),
                });
                return;
            }
            if (!response.jobId) {
                setConfigurationCopilotState({ status: 'error', message: t('configurationCopilot.didNotStart') });
                return;
            }
            const proposal = await pollConfigurationCopilotProposal(response.jobId, {
                signal: controller.signal,
            });
            if (configurationCopilotRequestKeyRef.current !== requestKey) return;
            if (!proposal) {
                setConfigurationCopilotState({ status: 'error', message: t('configurationCopilot.timedOut') });
                return;
            }
            setConfigurationCopilotState({ status: 'ready', proposal, requestKey });
        } catch (error) {
            if ((error as any)?.name === 'AbortError') return;
            if (configurationCopilotRequestKeyRef.current !== requestKey) return;
            setConfigurationCopilotState({
                status: 'error',
                message: formatAiPanelError(error, t('configurationCopilot.failed')),
            });
        }
    };

    const handleAcceptConfigurationField = (change: ConfigurationFieldChange) => {
        const previousValue = getSettingsConfigurationFieldValue(change.field);
        const dirtyState = captureConfigurationDirtyState();
        markConfigurationLocalApply();
        setSettingsConfigurationFieldValue(change.field, change.proposedValue);
        setAcceptedConfigurationFields((prev) => Array.from(new Set([...prev, change.field])));
        setConfigurationUndoStack((prev) => [...prev, { field: change.field, previousValue, dirtyState }]);
        recordConfigurationEvent('field_accepted', { field: change.field });
    };

    const handleAcceptAllConfigurationFields = () => {
        if (configurationCopilotState.status !== 'ready') return;
        const changes = configurationCopilotState.proposal.proposedDiff.configDiff ?? [];
        const dirtyState = captureConfigurationDirtyState();
        if (changes.length > 0) markConfigurationLocalApply();
        changes.forEach((change) => {
            const previousValue = getSettingsConfigurationFieldValue(change.field);
            setSettingsConfigurationFieldValue(change.field, change.proposedValue);
            setConfigurationUndoStack((prev) => [...prev, { field: change.field, previousValue, dirtyState }]);
        });
        const fields = changes.map((change) => change.field);
        setAcceptedConfigurationFields(fields);
        recordConfigurationEvent('all_fields_accepted', { fields });
    };

    const handleUndoConfigurationFields = () => {
        const stack = [...configurationUndoStack].reverse();
        if (stack.length > 0) markConfigurationLocalApply();
        const restoredDirtyState = restoreConfigurationSettingsDirtyState(configurationUndoStack, captureConfigurationDirtyState());
        stack.forEach((entry) => setSettingsConfigurationFieldValue(entry.field, entry.previousValue, { markDirty: false }));
        restoreConfigurationDirtyState(restoredDirtyState);
        recordConfigurationEvent('local_undo', { fields: configurationUndoStack.map((entry) => entry.field) });
        setConfigurationUndoStack([]);
        setAcceptedConfigurationFields([]);
    };

    const handleIgnoreConfigurationProposal = () => {
        recordConfigurationEvent('ignored');
        clearConfigurationCopilotState();
    };

    const handleGenerateStyleProposal = async () => {
        if (styleAdvisorState.status === 'loading') return;
        if (!canUseStyleAdvisor) {
            setStyleAdvisorState({ status: 'error', message: t('styleAdvisor.unavailableLabel') });
            return;
        }
        const targetCircleId = Number(circleId);
        const requestKey = JSON.stringify({
            circleId: targetCircleId,
            circleName,
            circleMode,
            preference: circleStylePreference?.preferencePayload ?? null,
            at: Date.now(),
        });
        styleAdvisorAbortRef.current?.abort();
        const controller = new AbortController();
        styleAdvisorAbortRef.current = controller;
        styleAdvisorRequestKeyRef.current = requestKey;
        setStyleAdvisorState({ status: 'loading', requestKey });
        try {
            const response = await requestStyleAdvisor({
                scope: 'circle',
                circleId: targetCircleId,
                locale,
                userIntent: t('styleAdvisor.intentCircle', { circleName }),
                currentPreference: circleStylePreference?.preferencePayload ?? {},
                publicCircleSnapshot: {
                    name: circleName,
                    mode: circleMode,
                },
            });
            if (styleAdvisorRequestKeyRef.current !== requestKey) return;
            if (response.status === 'disabled') {
                setStyleAdvisorState({
                    status: 'disabled',
                    message: t('styleAdvisor.disabledFallback'),
                });
                return;
            }
            if (!response.jobId) {
                setStyleAdvisorState({ status: 'error', message: t('styleAdvisor.didNotStart') });
                return;
            }
            const proposal = await pollStyleAdvisorProposal(response.jobId, {
                signal: controller.signal,
            });
            if (styleAdvisorRequestKeyRef.current !== requestKey) return;
            if (!proposal) {
                setStyleAdvisorState({ status: 'error', message: t('styleAdvisor.timedOut') });
                return;
            }
            setStyleAdvisorState({ status: 'ready', proposal, requestKey });
        } catch (error) {
            if ((error as any)?.name === 'AbortError') return;
            if (styleAdvisorRequestKeyRef.current !== requestKey) return;
            setStyleAdvisorState({
                status: 'error',
                message: formatAiPanelError(error, t('styleAdvisor.failed')),
            });
        }
    };

    const handlePreviewStyleProposal = () => {
        const proposal = styleAdvisorState.status === 'ready' || styleAdvisorState.status === 'applied'
            ? styleAdvisorState.proposal
            : null;
        if (!proposal) return;
        void recordStyleAdvisorEvent({
            proposalId: proposal.id,
            eventType: 'previewed',
            scope: 'circle',
        }).catch(() => undefined);
    };

    const handleApplyStyleProposal = async () => {
        if (styleAdvisorState.status !== 'ready') return;
        const targetCircleId = Number(circleId);
        const proposal = styleAdvisorState.proposal;
        try {
            const preference = await applyStylePreference({
                scope: 'circle',
                circleId: targetCircleId,
                proposalId: proposal.id,
            });
            setCircleStylePreference(preference);
            void recordStyleAdvisorEvent({
                proposalId: proposal.id,
                eventType: 'circle_applied',
                scope: 'circle',
            }).catch(() => undefined);
            setStyleAdvisorState({
                status: 'applied',
                proposal,
                requestKey: styleAdvisorState.requestKey,
            });
        } catch (error) {
            setStyleAdvisorState({
                status: 'error',
                message: formatAiPanelError(error, t('styleAdvisor.applyFailed')),
            });
        }
    };

    const handleIgnoreStyleProposal = () => {
        if (styleAdvisorState.status === 'ready' || styleAdvisorState.status === 'applied') {
            void recordStyleAdvisorEvent({
                proposalId: styleAdvisorState.proposal.id,
                eventType: 'ignored',
                scope: 'circle',
            }).catch(() => undefined);
        }
        clearStyleAdvisorState();
    };

    const handleResetCircleStyle = async () => {
        if (!canUseStyleAdvisor) return;
        try {
            await resetCircleStylePreference(Number(circleId));
            setCircleStylePreference(null);
            clearStyleAdvisorState();
        } catch (error) {
            setStyleAdvisorState({
                status: 'error',
                message: formatAiPanelError(error, t('styleAdvisor.resetFailed')),
            });
        }
    };

    const handleDiagnoseGuardianFindings = async () => {
        if (!canUseGuardianFindings) return;
        const targetCircleId = Number(circleId);
        setGuardianFindingState({ status: 'diagnosing' });
        try {
            const response = await requestGuardianFindingDiagnose({
                circleId: targetCircleId,
                reason: 'manual_check',
            });
            if (response.status === 'disabled') {
                setGuardianFindingState({
                    status: 'disabled',
                    message: t('guardianFindings.disabledFallback'),
                });
                return;
            }
            await refreshGuardianFindings();
        } catch (error) {
            setGuardianFindingState({
                status: 'error',
                message: formatAiPanelError(error, t('guardianFindings.failed')),
            });
        }
    };

    const handleAckGuardianFinding = async (findingId: string) => {
        try {
            await ackGuardianFinding(findingId);
            await refreshGuardianFindings();
        } catch (error) {
            setGuardianFindingState({
                status: 'error',
                message: formatAiPanelError(error, t('guardianFindings.actionFailed')),
            });
        }
    };

    const handleDismissGuardianFinding = async (findingId: string, reason: string) => {
        try {
            await dismissGuardianFinding(findingId, reason);
            await refreshGuardianFindings();
        } catch (error) {
            setGuardianFindingState({
                status: 'error',
                message: formatAiPanelError(error, t('guardianFindings.actionFailed')),
            });
        }
    };

    const handleSnoozeGuardianFinding = async (findingId: string, snoozeUntil: string) => {
        try {
            await snoozeGuardianFinding(findingId, snoozeUntil);
            await refreshGuardianFindings();
        } catch (error) {
            setGuardianFindingState({
                status: 'error',
                message: formatAiPanelError(error, t('guardianFindings.actionFailed')),
            });
        }
    };

    const handleConvertGuardianFinding = async (findingId: string) => {
        try {
            await convertGuardianFinding(findingId);
            await refreshGuardianFindings();
        } catch (error) {
            setGuardianFindingState({
                status: 'error',
                message: formatAiPanelError(error, t('guardianFindings.actionFailed')),
            });
        }
    };

    const handleRequestCircleGrowthAdvisor = async () => {
        if (!canUseCircleGrowthAdvisor) return;
        const targetCircleId = Number(circleId);
        setCircleGrowthAdvisorState({ status: 'requesting' });
        try {
            const response = await requestCircleGrowthAdvisor({
                circleId: targetCircleId,
            });
            if (response.status === 'disabled') {
                setCircleGrowthAdvisorState({
                    status: 'disabled',
                    message: t('circleGrowthAdvisor.disabledFallback'),
                });
                return;
            }
            if (response.proposal) {
                setCircleGrowthProposals((current) => [
                    response.proposal!,
                    ...current.filter((proposal) => proposal.id !== response.proposal!.id),
                ]);
                setCircleGrowthAdvisorState({ status: 'ready' });
                return;
            }
            await refreshCircleGrowthProposals();
        } catch (error) {
            setCircleGrowthAdvisorState({
                status: 'error',
                message: formatAiPanelError(error, t('circleGrowthAdvisor.failed')),
            });
        }
    };

    const handleRejectCircleGrowthProposal = async (proposalId: string, reason: string) => {
        try {
            await rejectCircleGrowthProposal(proposalId, reason);
            await refreshCircleGrowthProposals();
        } catch (error) {
            setCircleGrowthAdvisorState({
                status: 'error',
                message: formatAiPanelError(error, t('circleGrowthAdvisor.actionFailed')),
            });
        }
    };

    const handleSnoozeCircleGrowthProposal = async (proposalId: string, snoozeUntil: string) => {
        try {
            await snoozeCircleGrowthProposal(proposalId, snoozeUntil);
            await refreshCircleGrowthProposals();
        } catch (error) {
            setCircleGrowthAdvisorState({
                status: 'error',
                message: formatAiPanelError(error, t('circleGrowthAdvisor.actionFailed')),
            });
        }
    };

    const handleConvertCircleGrowthProposal = async (proposalId: string) => {
        try {
            const response = await convertCircleGrowthProposal(proposalId);
            const configurationProposalId = response.proposal.configurationProposalId;
            if (configurationProposalId) {
                const configurationProposal = await getConfigurationProposal(configurationProposalId);
                const requestKey = buildConfigurationRequestKey();
                configurationCopilotRequestKeyRef.current = requestKey;
                setAcceptedConfigurationFields([]);
                setConfigurationUndoStack([]);
                setConfigurationCopilotState({
                    status: 'ready',
                    proposal: configurationProposal,
                    requestKey,
                });
            }
            await refreshCircleGrowthProposals();
        } catch (error) {
            setCircleGrowthAdvisorState({
                status: 'error',
                message: formatAiPanelError(error, t('circleGrowthAdvisor.actionFailed')),
            });
        }
    };

    const formatGovernanceTimestamp = (value: string | null | undefined): string => {
        if (!value) return t('governance.notAvailable');
        const parsed = new Date(value);
        if (Number.isNaN(parsed.getTime())) return t('governance.notAvailable');
        return parsed.toLocaleString(undefined, {
            month: 'short',
            day: 'numeric',
            hour: '2-digit',
            minute: '2-digit',
        });
    };

    const handleOpenCommitteeReceiveWindow = async () => {
        if (!onUpdateCommitteeAvailability || !canUpdateCommitteeAvailability) return;
        try {
            await onUpdateCommitteeAvailability('enabled', {
                windowMinutes: committeeReceiveWindowMinutes,
                allowedActionPrefixes: [committeeReceiveWindowActionPrefix],
                electorateTemplate: {
                    source: 'active_committee_members',
                    weight: { mode: 'equal_one' },
                    threshold: {
                        mode: committeeThresholdMode,
                        value: committeeThresholdMode === 'fixed_count'
                            ? Math.max(1, Math.floor(committeeFixedThreshold))
                            : null,
                    },
                    ballotDisclosure: { mode: committeeBallotDisclosureMode },
                    quadraticVoiceCredits: {
                        budgetPerActor: committeeQuadraticVoiceBudget > 0
                            ? Math.floor(committeeQuadraticVoiceBudget)
                            : null,
                    },
                },
            });
        } catch {
            // error is surfaced by parent state
        }
    };

    const handleCloseCommitteeReceiveWindow = async () => {
        if (!onUpdateCommitteeAvailability || !canUpdateCommitteeAvailability) return;
        try {
            await onUpdateCommitteeAvailability('disabled', {
                windowMinutes: null,
                allowedActionPrefixes: null,
            });
        } catch {
            // error is surfaced by parent state
        }
    };

    const handleUpdateActiveGovernancePolicy = async () => {
        const bindingId = governanceCommitteeProp?.bindingId;
        if (!bindingId || !onUpdateActiveGovernancePolicy) return;
        try {
            await onUpdateActiveGovernancePolicy({
                bindingId,
                targetCommitteeCircleId: governanceRecovery?.automaticRecoveryConfigured
                    ? Number(recoveryTargetCommitteeCircleIdInput) || null
                    : null,
                electorateTemplate: {
                    source: 'active_committee_members',
                    weight: { mode: 'equal_one' },
                    threshold: {
                        mode: committeeThresholdMode,
                        value: committeeThresholdMode === 'fixed_count'
                            ? Math.max(1, Math.floor(committeeFixedThreshold))
                            : null,
                    },
                    ballotDisclosure: { mode: committeeBallotDisclosureMode },
                    quadraticVoiceCredits: {
                        budgetPerActor: committeeQuadraticVoiceBudget > 0
                            ? Math.floor(committeeQuadraticVoiceBudget)
                            : null,
                    },
                },
            });
        } catch {
            // error is surfaced by parent state
        }
    };

    const handleCreateRecoveryPolicy = async () => {
        const bindingId = governanceCommitteeProp?.bindingId;
        const recoveryCircleId = Number(recoveryCircleIdInput);
        if (
            !bindingId
            || !onCreateGovernanceRecoveryPolicy
            || !Number.isSafeInteger(recoveryCircleId)
            || recoveryCircleId <= 0
            || recoveryCircleId === Number(circleId)
        ) {
            setRecoveryPolicyError('Choose an existing, independent Recovery Circle.');
            return;
        }
        setRecoveryPolicyBusy(true);
        setRecoveryPolicyError(null);
        try {
            await onCreateGovernanceRecoveryPolicy({ bindingId, recoveryCircleId });
        } catch (error) {
            setRecoveryPolicyError(error instanceof Error
                ? error.message
                : 'Recovery policy proposal failed.');
        } finally {
            setRecoveryPolicyBusy(false);
        }
    };

    const handleOpenAuthorityHealth = async (classifyFault = false) => {
        const bindingId = governanceCommitteeProp?.bindingId;
        if (!bindingId || !onOpenGovernanceAuthorityHealth) return;
        if (classifyFault && (!authorityFaultActor.trim() || !authorityFaultEvidenceRef.trim())) {
            setAuthorityHealthError('Affected frozen actor and evidence reference are required.');
            return;
        }
        setAuthorityHealthBusy(true);
        setAuthorityHealthError(null);
        try {
            await onOpenGovernanceAuthorityHealth({
                bindingId,
                faultAssessment: classifyFault ? {
                    faultClass: authorityFaultClass,
                    affectedActorPubkey: authorityFaultActor.trim(),
                    evidenceRef: authorityFaultEvidenceRef.trim(),
                    maximumDurationSeconds: Math.max(300, Math.round(authorityFaultMaximumHours * 3600)),
                } : null,
            });
        } catch (error) {
            setAuthorityHealthError(error instanceof Error ? error.message : 'Authority health Case failed.');
        } finally {
            setAuthorityHealthBusy(false);
        }
    };

    const handleApplyAuthorityHealth = async () => {
        const bindingId = governanceCommitteeProp?.bindingId;
        const accepted = committeeGovernanceRequests.find((request) => (
            request.actionType === 'circle.governance_binding.authority_health.check'
            && request.targetRef === bindingId
            && request.state === 'accepted'
        ));
        if (!bindingId || !accepted || !onApplyGovernanceAuthorityHealth) return;
        setAuthorityHealthBusy(true);
        setAuthorityHealthError(null);
        try {
            await onApplyGovernanceAuthorityHealth({ bindingId, requestId: accepted.id });
        } catch (error) {
            setAuthorityHealthError(error instanceof Error ? error.message : 'Authority health application failed.');
        } finally {
            setAuthorityHealthBusy(false);
        }
    };

    const handlePermanentlyBlockGovernanceAuthority = async () => {
        const bindingId = governanceCommitteeProp?.bindingId;
        if (!bindingId || !onPermanentlyBlockGovernanceAuthority) return;
        setRecoveryPolicyBusy(true);
        setRecoveryPolicyError(null);
        try {
            await onPermanentlyBlockGovernanceAuthority({ bindingId });
        } catch (error) {
            setRecoveryPolicyError(error instanceof Error
                ? error.message
                : 'Governance authority terminalization failed.');
        } finally {
            setRecoveryPolicyBusy(false);
        }
    };

    const buildMandateFeePolicy = (): GovernanceMandateFeePolicy => ({
        mode: committeeMandateFeeMode,
        economicBearer: committeeMandateEconomicBearer,
        maximumAmountMinor: committeeMandateFeeMode === 'capped_external_quote'
            ? committeeMandateMaximumAmountMinor
            : null,
        unit: committeeMandateFeeMode === 'capped_external_quote'
            ? committeeMandateFeeUnit.trim().toUpperCase()
            : null,
        settlement: 'not_managed_by_mandate',
        payerAuthority: 'separate_from_governance_authority',
    });

    const buildMandateEffectPolicy = (
        delegatorRef: string,
        operational: boolean,
    ): GovernanceMandateEffectPolicy | null => operational ? {
        naturalExpiry: 'expire_at_mandate_end',
        revoke: 'revoke_immediately',
        transfer: 'supersede_immediately',
        appealSurvival: 'survives_until_resolved',
        fallbackAuthority: { type: 'circle', ref: delegatorRef },
    } : null;

    const buildOperatorPolicyConstraints = (): GovernanceMandateOperatorPolicyConstraints | null => (
        committeeMandateHasOperationalPurpose ? {
            roles: committeeOperatorRoles,
            maximumActors: committeeOperatorMaximumActors,
            maximumDurationSeconds: committeeOperatorMaximumDurationSeconds,
            frequency: { windowSeconds: 300, maximumInvocations: committeeOperatorMaximumInvocations },
            appeal: { maximumWindowSeconds: committeeOperatorAppealWindowSeconds },
            targetScope: 'target_circle_exact_subject',
        } : null
    );

    const buildDisclosureDeclaration = (): GovernanceCrossInstitutionDisclosureDeclaration | null => {
        if (circleType !== 'Secret') return null;
        return {
            dataCategories: mandateDisclosureDataCategories,
            recipientRegions: [...new Set(mandateDisclosureRegions
                .split(',')
                .map((region) => region.trim().toUpperCase())
                .filter(Boolean))],
            retentionDays: mandateDisclosureRetentionDays,
        };
    };
    const disclosureDeclarationValid = circleType !== 'Secret' || (
        mandateDisclosureDataCategories.length > 0
        && buildDisclosureDeclaration()!.recipientRegions.length > 0
        && buildDisclosureDeclaration()!.recipientRegions.every((region) => /^[A-Z]{2}$/.test(region))
    );

    const handleCreateGovernanceBinding = async () => {
        if (!onCreateGovernanceBinding || !canCreateCommitteeBinding || !circleId) return;
        setGovernanceBindingSubmitError(null);
        const selfGoverned = committeeBindingType === 'self_governed';
        const committeeCircleId = selfGoverned ? Number(circleId) : Number(committeeTargetCircleId);
        if (!Number.isInteger(committeeCircleId) || committeeCircleId <= 0) return;
        const compromisedKeyRecovery = governanceRecovery?.authorityHealth.faultAssessment?.faultClass === 'compromised_key';
        if (compromisedKeyRecovery && (
            !continuityReplacementActor.trim()
            || !continuityIncidentReviewRef.trim()
            || !continuityIncidentReviewSummary.trim()
        )) {
            setAuthorityHealthError('Replacement actor and incident review are required for compromised-key recovery.');
            return;
        }
        try {
            const now = new Date();
            const acceptanceExpiresAt = new Date(now.getTime() + committeeMandateAcceptanceDays * 24 * 60 * 60 * 1000);
            const effectiveFrom = selfGoverned ? now : acceptanceExpiresAt;
            const effectiveUntil = new Date(effectiveFrom.getTime() + committeeMandateDurationDays * 24 * 60 * 60 * 1000);
            const multiPurpose = committeeMandateIsMultiPurpose;
            const exactActionType = resolvedExactActionType || null;
            if (selfGoverned && !exactActionType) {
                setAuthorityHealthError(t('governance.selfGovernedExactActionRequired'));
                return;
            }
            const purposeBindings = (selfGoverned
                ? ['collective_decision' as const]
                : committeeMandatePurposes).map((purpose) => ({
                purpose,
                actionType: exactActionType
                    ?? (purpose === 'operational_execution'
                        ? 'communication.member.mute'
                        : multiPurpose ? 'communication.voice_policy.update' : null),
                actionPrefix: exactActionType
                    ? null
                    : (
                        purpose === 'collective_decision' && !multiPurpose
                            ? committeeBindingActionPrefix
                            : null
                    ),
            }));
            const subjectType = exactActionType
                ? committeeExactSubjectType.trim()
                : (committeeExactSubjectType.trim() || 'circle');
            const subjectRef = exactActionType
                ? committeeExactSubjectRef.trim()
                : (committeeExactSubjectRef.trim() || String(circleId));
            if (exactActionType && (!subjectType || !subjectRef)) {
                setAuthorityHealthError('Exact action bindings require subject type and subject ref.');
                return;
            }
            await onCreateGovernanceBinding({
                bindingType: committeeBindingType,
                committeeCircleId,
                purposeBindings,
                actionType: exactActionType
                    ?? (
                        committeeBindingType === 'shared_committee'
                        && committeeMandatePurposes.length === 1
                        && committeeMandatePurposes[0] === 'operational_execution'
                            ? 'communication.member.mute'
                            : null
                    ),
                actionPrefix: exactActionType
                    ? null
                    : (
                        committeeBindingType !== 'shared_committee' && !selfGoverned
                            ? committeeBindingActionPrefix
                            : multiPurpose ? 'communication' : committeeBindingActionPrefix
                    ),
                effectiveFrom: effectiveFrom.toISOString(),
                effectiveUntil: effectiveUntil.toISOString(),
                acceptanceExpiresAt: acceptanceExpiresAt.toISOString(),
                minimumConstraints: {
                    riskFloor: committeeMandateRiskFloor,
                    minimumApprovalThreshold: committeeMandateMinimumApprovals,
                    minimumTimelockSeconds: committeeMandateTimelockHours * 60 * 60,
                },
                subject: { type: subjectType, ref: subjectRef },
                network: committeeExactNetwork,
                feePolicy: buildMandateFeePolicy(),
                effectPolicy: buildMandateEffectPolicy(
                    String(circleId),
                    committeeMandateHasOperationalPurpose,
                ),
                operatorPolicyConstraints: buildOperatorPolicyConstraints(),
                crossInstitutionDisclosureImpact: buildDisclosureDeclaration(),
                continuityIncident: compromisedKeyRecovery ? {
                    replacementActorPubkey: continuityReplacementActor.trim(),
                    incidentReviewRef: continuityIncidentReviewRef.trim(),
                    incidentReviewSummary: continuityIncidentReviewSummary.trim(),
                } : null,
            });
            setCommitteeTargetCircleId('');
            setContinuityReplacementActor('');
            setContinuityIncidentReviewRef('');
            setContinuityIncidentReviewSummary('');
        } catch {
            setGovernanceBindingSubmitError(t('governance.bindingCreateFailedInline'));
        }
    };

    const handleSupersedeActiveGovernanceMandate = async () => {
        const mandateId = governanceCommitteeProp?.mandateId;
        if (!mandateId || !onSupersedeActiveGovernanceMandate) return;
        const now = new Date();
        const acceptanceExpiresAt = new Date(
            now.getTime() + committeeMandateAcceptanceDays * 24 * 60 * 60 * 1000,
        );
        const effectiveUntil = new Date(
            now.getTime() + committeeMandateDurationDays * 24 * 60 * 60 * 1000,
        );
        await onSupersedeActiveGovernanceMandate({
            mandateId,
            effectiveUntil: effectiveUntil.toISOString(),
            acceptanceExpiresAt: acceptanceExpiresAt.toISOString(),
            minimumConstraints: {
                riskFloor: committeeMandateRiskFloor,
                minimumApprovalThreshold: committeeMandateMinimumApprovals,
                minimumTimelockSeconds: committeeMandateTimelockHours * 60 * 60,
            },
            operatorPolicyConstraints: buildOperatorPolicyConstraints(),
            crossInstitutionDisclosureImpact: buildDisclosureDeclaration(),
        });
    };

    const handleDeactivateActiveGovernanceMandate = async () => {
        const bindingId = governanceCommitteeProp?.bindingId;
        if (!bindingId || !onDeactivateActiveGovernanceMandate) return;
        await onDeactivateActiveGovernanceMandate({ bindingId });
    };

    const handleCounterGovernanceMandate = async (binding: CircleGovernanceBinding) => {
        if (!onCounterGovernanceMandate || !binding.mandateId) return;
        const now = new Date();
        const acceptanceExpiresAt = new Date(now.getTime() + committeeMandateAcceptanceDays * 24 * 60 * 60 * 1000);
        const effectiveFrom = acceptanceExpiresAt;
        const effectiveUntil = new Date(effectiveFrom.getTime() + committeeMandateDurationDays * 24 * 60 * 60 * 1000);
        await onCounterGovernanceMandate({
            mandateId: binding.mandateId,
            actionType: binding.actionType,
            actionPrefix: binding.actionPrefix,
            effectiveFrom: effectiveFrom.toISOString(),
            effectiveUntil: effectiveUntil.toISOString(),
            acceptanceExpiresAt: acceptanceExpiresAt.toISOString(),
            minimumConstraints: {
                riskFloor: committeeMandateRiskFloor,
                minimumApprovalThreshold: committeeMandateMinimumApprovals,
                minimumTimelockSeconds: committeeMandateTimelockHours * 60 * 60,
            },
            subject: { type: 'circle', ref: String(binding.targetCircleId) },
            purposeBindings: committeeMandatePurposes.map((purpose) => ({
                purpose,
                actionType: purpose === 'operational_execution'
                    ? 'communication.member.mute'
                    : committeeMandateIsMultiPurpose ? 'communication.voice_policy.update' : null,
                actionPrefix: purpose === 'collective_decision' && !committeeMandateIsMultiPurpose
                    ? committeeBindingActionPrefix
                    : null,
            })),
            feePolicy: buildMandateFeePolicy(),
            effectPolicy: buildMandateEffectPolicy(
                String(binding.targetCircleId),
                committeeMandateHasOperationalPurpose,
            ),
            operatorPolicyConstraints: buildOperatorPolicyConstraints(),
            crossInstitutionDisclosureImpact: undefined,
        });
    };

    const getRequestPayloadText = (
        request: CircleGovernanceRequestSummary,
        key: string,
    ): string => {
        const value = request.payload?.[key];
        if (value == null) return t('governance.notAvailable');
        return String(value);
    };

    const handleApproveGovernanceRequest = async (request: CircleGovernanceRequestSummary) => {
        try {
            await onSubmitGovernanceSignal?.(request, 'approve');
        } catch {
            // error is surfaced by parent state
        }
    };

    const handleRejectGovernanceRequest = async (request: CircleGovernanceRequestSummary) => {
        try {
            await onSubmitGovernanceSignal?.(request, 'reject');
        } catch {
            // error is surfaced by parent state
        }
    };

    const getRoleBadgeClass = (role: MemberInfo['role']) => {
        switch (role) {
            case 'owner': return styles.roleBadgeOwner;
            case 'curator': return styles.roleBadgeCurator;
            default: return styles.roleBadgeMember;
        }
    };

    const getRoleLabel = (role: MemberInfo['role']) => {
        switch (role) {
            case 'owner': return t('memberRoles.owner');
            case 'curator': return t('memberRoles.curator');
            default: return t('memberRoles.member');
        }
    };

    const actionFlags = resolveCircleSettingsActionFlags(currentUserRole);
    const canManageRoles = actionFlags.canManageRoles;
    const canRequestOwnerTransfer = currentUserRole === 'owner' && Boolean(onRequestOwnerTransfer);
    const canInvite = actionFlags.canInvite;
    const canLeave = actionFlags.canLeave && Boolean(onLeaveCircle);
    const isCircleArchived = circleLifecycleStatus === 'Archived';
    const isCircleForkPending = circleLifecycleStatus === 'ForkPending';
    const isCircleDissolutionPending = circleLifecycleStatus === 'DissolutionPending'
        || lifecycleActionStatus?.state === 'dissolution_pending'
        || lifecycleActionStatus?.plan?.targetLifecycleState === 'dissolution_pending';
    const isCircleMergeTerminal = circleLifecycleStatus === 'MergePending'
        || circleLifecycleStatus === 'Merged'
        || lifecycleActionStatus?.state === 'merge_pending'
        || lifecycleActionStatus?.state === 'merged';
    const lifecycleArchiveRestrictionVisible = isCircleArchived
        || lifecycleActionStatus?.plan?.targetLifecycleState === 'archived';
    const lifecycleActionBusy = lifecycleActionStatus?.state === 'saving';
    const lifecycleButtonEnabled = deleteCircleAvailable
        && canManageLifecycle
        && !isCircleForkPending
        && !isCircleMergeTerminal
        && !lifecycleActionBusy
        && lifecycleActionStatus?.state !== 'requires_governance'
        && lifecycleActionStatus?.state !== 'reconciliation_pending'
        && lifecycleActionStatus?.state !== 'dissolution_pending'
        && lifecycleActionStatus?.state !== 'blocked'
        && lifecycleActionStatus?.state !== 'error';
    const dissolutionButtonEnabled = deleteCircleAvailable
        && canManageLifecycle
        && Boolean(onDissolveCircle)
        && !lifecycleActionBusy
        && !isCircleForkPending
        && !isCircleDissolutionPending
        && !isCircleMergeTerminal
        && lifecycleActionStatus?.state !== 'awaiting_wallet'
        && lifecycleActionStatus?.state !== 'reconciliation_pending'
        && lifecycleActionStatus?.state !== 'blocked'
        && lifecycleActionStatus?.state !== 'error'
        && dissolutionReason.trim().length > 0
        && dissolutionExitWindowEndsAt.length > 0;
    const mergeActionBusy = mergeActionStatus?.state === 'saving';
    const mergeSourceApprovalEnabled = canManageLifecycle
        && Boolean(onApproveMergeSource)
        && !mergeActionBusy
        && Number.isInteger(Number(mergeSuccessorCircleId))
        && Number(mergeSuccessorCircleId) > 0
        && mergeExitWindowEndsAt.length > 0
        && mergeExportWindowEndsAt.length > 0;
    const mergeApprovalRequestIds = mergeSourceApprovalRefs
        .split(',')
        .map((item) => item.trim())
        .filter(Boolean);
    const mergeSuccessorAcceptanceEnabled = canManageLifecycle
        && Boolean(onAcceptMergeSuccessor)
        && !mergeActionBusy
        && mergeApprovalRequestIds.length > 0;
    const lifecycleDispositionEntries = lifecycleActionStatus?.plan?.dispositionSnapshot.entries ?? [];
    const lifecycleDispositionCounts = lifecycleDispositionEntries.reduce((counts, entry) => {
        counts[entry.disposition] += 1;
        return counts;
    }, { continue: 0, suspend: 0, cancel: 0, manual_resolution: 0 });
    const lifecycleDissolutionPolicy = lifecycleActionStatus?.plan?.dissolutionPolicy;
    const retentionDestructionCoordination = lifecycleDissolutionPolicy
        && typeof lifecycleDissolutionPolicy.retentionDestructionCoordination === 'object'
        && lifecycleDissolutionPolicy.retentionDestructionCoordination !== null
        && !Array.isArray(lifecycleDissolutionPolicy.retentionDestructionCoordination)
        ? lifecycleDissolutionPolicy.retentionDestructionCoordination as Record<string, unknown>
        : null;
    const retentionCoordinationPolicy = retentionDestructionCoordination
        && typeof retentionDestructionCoordination.policy === 'object'
        && retentionDestructionCoordination.policy !== null
        && !Array.isArray(retentionDestructionCoordination.policy)
        ? retentionDestructionCoordination.policy as Record<string, unknown>
        : null;
    const retentionPublicVisibility = retentionDestructionCoordination
        && typeof retentionDestructionCoordination.publicRecordVisibility === 'object'
        && retentionDestructionCoordination.publicRecordVisibility !== null
        && !Array.isArray(retentionDestructionCoordination.publicRecordVisibility)
        ? retentionDestructionCoordination.publicRecordVisibility as Record<string, unknown>
        : null;
    const committeeProfileBusy = committeeProfileLoading || committeeProfileStatus?.state === 'saving';
    const canUpdateCommitteeAvailability =
        canManageGovernanceBindings
        && Boolean(onUpdateCommitteeAvailability)
        && !committeeProfileBusy;
    const canCreateCommitteeBinding =
        canManageGovernanceBindings
        && Boolean(onCreateGovernanceBinding)
        && !committeeProfileBusy;
    const continuityIncidentBinding = targetGovernanceBindings.find((binding) => {
        const metadata = binding.metadata as Record<string, unknown> | null;
        return Boolean(metadata?.continuityIncidentResolution);
    }) ?? null;
    const continuityIncidentReadback = continuityIncidentBinding?.metadata
        && typeof continuityIncidentBinding.metadata.continuityIncidentResolution === 'object'
        && continuityIncidentBinding.metadata.continuityIncidentResolution !== null
        && !Array.isArray(continuityIncidentBinding.metadata.continuityIncidentResolution)
        ? continuityIncidentBinding.metadata.continuityIncidentResolution as Record<string, unknown>
        : null;
    const canUpdateActiveGovernancePolicy = canManageGovernanceBindings
        && governanceCommitteeProp?.status === 'active_binding'
        && Boolean(governanceCommitteeProp.bindingId)
        && Boolean(onUpdateActiveGovernancePolicy)
        && governanceRecovery?.authorityContinuity.status !== 'permanently_blocked_governance_authority'
        && governanceRecovery?.authorityContinuity.status !== 'drifted'
        && !committeeProfileBusy;
    const canCreateRecoveryPolicy = canUpdateActiveGovernancePolicy
        && governanceRecovery?.automaticRecoveryConfigured !== true
        && governanceRecovery?.authorityContinuity.status === 'healthy'
        && Boolean(onCreateGovernanceRecoveryPolicy)
        && !recoveryPolicyBusy;
    const canPermanentlyBlockGovernanceAuthority = canManageGovernanceBindings
        && governanceRecovery?.authorityContinuity.status === 'manual_recovery_pending'
        && governanceRecovery.authorityContinuity.canRecordPermanentBlock
        && Boolean(onPermanentlyBlockGovernanceAuthority)
        && !recoveryPolicyBusy;
    const acceptedAuthorityHealthRequest = committeeGovernanceRequests.find((request) => (
        request.actionType === 'circle.governance_binding.authority_health.check'
        && request.targetRef === governanceCommitteeProp?.bindingId
        && request.state === 'accepted'
    ));
    const committeeProfileEnabled = committeeProfile?.availabilityStatus === 'enabled';
    const committeeInboxRequests = committeeGovernanceRequests.filter((request) =>
        request.actionType === 'circle.governance_binding.accept_mandate'
        || Boolean(request.executionCompatibility),
    );
    const memberNameById = new Map(
        members.map((member) => [
            member.userId,
            member.handle ? `@${member.handle}` : member.name,
        ]),
    );
    const visibleOwnerTransferRequests = ownerTransferRequests.filter((transfer) =>
        transfer.status === 'pending_target_acceptance'
        || transfer.status === 'pending_governance'
        || transfer.status === 'executed',
    );
    const normalizedCircleId = Number(circleId);
    const visibleCircleId = Number.isFinite(normalizedCircleId) && normalizedCircleId > 0
        ? String(normalizedCircleId)
        : null;

    const handleCopyCircleId = async () => {
        if (!visibleCircleId) return;
        if (!navigator.clipboard?.writeText) return;
        try {
            await navigator.clipboard.writeText(visibleCircleId);
            setCircleIdCopied(true);
            window.setTimeout(() => setCircleIdCopied(false), 1600);
        } catch {
            setCircleIdCopied(false);
        }
    };

    const handleMemberTap = (member: MemberInfo) => {
        if (!canManageRoles || !member.roleMutable) return;
        setMemberActionError(null);
        setMemberRemovalTarget(null);
        setMemberRemovalReason('');
        setPopoverTarget(popoverTarget === member.userId ? null : member.userId);
    };

    const handleSetCurator = async (member: MemberInfo) => {
        if (!onRoleChange) return;
        const actionKey = `role:${member.userId}:Moderator`;
        setMemberActionKey(actionKey);
        setMemberActionError(null);
        try {
            await onRoleChange(member, 'Moderator');
            setPopoverTarget(null);
        } catch (error) {
            setMemberActionError(error instanceof Error ? error.message : t('errors.roleChange'));
        } finally {
            setMemberActionKey(null);
        }
    };

    const handleSetMember = async (member: MemberInfo) => {
        if (!onRoleChange) return;
        const actionKey = `role:${member.userId}:Member`;
        setMemberActionKey(actionKey);
        setMemberActionError(null);
        try {
            await onRoleChange(member, 'Member');
            setPopoverTarget(null);
        } catch (error) {
            setMemberActionError(error instanceof Error ? error.message : t('errors.roleChange'));
        } finally {
            setMemberActionKey(null);
        }
    };

    const handleRemove = async (member: MemberInfo) => {
        if (!onRemoveMember) return;
        const reason = memberRemovalReason.trim();
        if (reason.length < 10) {
            setMemberActionError(t('members.removal.reasonRequired'));
            return;
        }
        const actionKey = `remove:${member.userId}`;
        setMemberActionKey(actionKey);
        setMemberActionError(null);
        try {
            await onRemoveMember(member, reason);
            setMemberRemovalTarget(null);
            setMemberRemovalReason('');
            setPopoverTarget(null);
        } catch (error) {
            setMemberActionError(error instanceof Error ? error.message : t('errors.removeMember'));
        } finally {
            setMemberActionKey(null);
        }
    };

    const handleRequestOwnerTransfer = async (member: MemberInfo) => {
        if (!onRequestOwnerTransfer) return;
        const actionKey = `ownerTransfer:request:${member.userId}`;
        setMemberActionKey(actionKey);
        setMemberActionError(null);
        try {
            await onRequestOwnerTransfer(member);
            setPopoverTarget(null);
        } catch (error) {
            setMemberActionError(error instanceof Error ? error.message : t('ownerTransfer.requestFailed'));
        } finally {
            setMemberActionKey(null);
        }
    };

    const handleAcceptOwnerTransfer = async (transferId: string) => {
        if (!onAcceptOwnerTransfer) return;
        const actionKey = `ownerTransfer:accept:${transferId}`;
        setMemberActionKey(actionKey);
        setMemberActionError(null);
        try {
            await onAcceptOwnerTransfer(transferId);
        } catch (error) {
            setMemberActionError(error instanceof Error ? error.message : t('ownerTransfer.acceptFailed'));
        } finally {
            setMemberActionKey(null);
        }
    };

    const getOwnerTransferStatusLabel = (status: string) => {
        if (status === 'pending_governance') return t('ownerTransfer.pendingGovernance');
        if (status === 'executed') return t('ownerTransfer.executed');
        return t('ownerTransfer.pendingTargetAcceptance');
    };

    const handleLeaveCircle = async () => {
        if (!onLeaveCircle) return;
        const actionKey = 'leave:current';
        setMemberActionKey(actionKey);
        setMemberActionError(null);
        try {
            await onLeaveCircle();
            setPopoverTarget(null);
        } catch (error) {
            setMemberActionError(error instanceof Error ? error.message : t('errors.leaveCircle'));
        } finally {
            setMemberActionKey(null);
        }
    };

    const renderConfigurationCopilotPanel = () => {
        if (!canUseConfigurationCopilot) return null;
        const proposal = configurationCopilotState.status === 'ready'
            ? configurationCopilotState.proposal
            : null;
        return (
            <ConfigurationDiffPanel
                title={t('configurationCopilot.title')}
                description={t('configurationCopilot.description')}
                status={configurationCopilotState.status === 'loading'
                    ? 'loading'
                    : configurationCopilotState.status === 'ready'
                        ? 'ready'
                        : configurationCopilotState.status === 'disabled'
                            ? 'disabled'
                            : configurationCopilotState.status === 'error'
                                ? 'error'
                                : 'idle'}
                changes={proposal?.proposedDiff.configDiff ?? []}
                acceptedFields={acceptedConfigurationFields}
                validationErrors={proposal?.validationErrors ?? []}
                errorMessage={configurationCopilotState.status === 'error' ? configurationCopilotState.message : null}
                disabledReason={configurationCopilotState.status === 'disabled' ? configurationCopilotState.message : null}
                requestLabel={t('configurationCopilot.requestLabel')}
                acceptFieldLabel={t('configurationCopilot.acceptFieldLabel')}
                acceptAllLabel={t('configurationCopilot.acceptAllLabel')}
                undoLabel={t('configurationCopilot.undoLabel')}
                ignoreLabel={t('configurationCopilot.ignoreLabel')}
                emptyLabel={t('configurationCopilot.emptyLabel')}
                validationFailedLabel={t('configurationCopilot.validationFailedLabel')}
                loadingLabel={t('configurationCopilot.loadingLabel')}
                acceptedLabel={t('configurationCopilot.acceptedLabel')}
                readyAnnouncementLabel={t('configurationCopilot.readyAnnouncement', {
                    count: proposal?.proposedDiff.configDiff?.length ?? 0,
                })}
                basisLabel={t('configurationCopilot.basis')}
                proposalReasonLabel={t('configurationCopilot.proposalReasonLabel')}
                reviewSummaryLabel={t('configurationCopilot.reviewSummary', {
                    count: proposal?.proposedDiff.configDiff?.length ?? 0,
                })}
                proposalReason={proposal?.proposedDiff.reason ?? null}
                unavailableLabel={t('configurationCopilot.unavailableLabel')}
                requestFailedLabel={t('configurationCopilot.requestFailedLabel')}
                valueUnsetLabel={t('configurationCopilot.valueUnsetLabel')}
                valueBooleanOnLabel={t('configurationCopilot.valueBooleanOnLabel')}
                valueBooleanOffLabel={t('configurationCopilot.valueBooleanOffLabel')}
                riskLabels={{
                    low: t('configurationCopilot.risk.low'),
                    medium: t('configurationCopilot.risk.medium'),
                    high: t('configurationCopilot.risk.high'),
                }}
                onRequest={handleGenerateConfigurationProposal}
                onAcceptField={handleAcceptConfigurationField}
                onAcceptAll={handleAcceptAllConfigurationFields}
                onUndo={handleUndoConfigurationFields}
                onIgnore={handleIgnoreConfigurationProposal}
            />
        );
    };

    const renderStyleAdvisorPanel = () => {
        if (!canUseStyleAdvisor) return null;
        const proposal = styleAdvisorState.status === 'ready' || styleAdvisorState.status === 'applied'
            ? styleAdvisorState.proposal
            : null;
        return (
            <StyleProposalPanel
                title={t('styleAdvisor.title')}
                description={t('styleAdvisor.description')}
                status={styleAdvisorState.status === 'loading'
                    ? 'loading'
                    : styleAdvisorState.status === 'ready'
                        ? 'ready'
                        : styleAdvisorState.status === 'applied'
                            ? 'applied'
                            : styleAdvisorState.status === 'disabled'
                                ? 'disabled'
                                : styleAdvisorState.status === 'error'
                                    ? 'error'
                                    : 'idle'}
                proposal={proposal}
                errorMessage={styleAdvisorState.status === 'error' ? styleAdvisorState.message : null}
                disabledReason={styleAdvisorState.status === 'disabled' ? styleAdvisorState.message : null}
                requestLabel={t('styleAdvisor.requestLabel')}
                previewLabel={t('styleAdvisor.previewLabel')}
                applyLabel={t('styleAdvisor.applyLabel')}
                appliedLabel={t('styleAdvisor.appliedLabel')}
                ignoreLabel={t('styleAdvisor.ignoreLabel')}
                resetLabel={t('styleAdvisor.resetLabel')}
                emptyLabel={t('styleAdvisor.emptyLabel')}
                loadingLabel={t('styleAdvisor.loadingLabel')}
                readyAnnouncementLabel={t('styleAdvisor.readyAnnouncement')}
                unavailableLabel={t('styleAdvisor.unavailableLabel')}
                requestFailedLabel={t('styleAdvisor.requestFailedLabel')}
                checksLabel={t('styleAdvisor.checksLabel')}
                changesLabel={t('styleAdvisor.changesLabel')}
                previewTitle={t('styleAdvisor.previewTitle')}
                previewBody={t('styleAdvisor.previewBody')}
                riskLabels={{
                    low: t('styleAdvisor.risk.low'),
                    medium: t('styleAdvisor.risk.medium'),
                    high: t('styleAdvisor.risk.high'),
                }}
                tokenLabels={{
                    surface: t('styleAdvisor.tokens.surface'),
                    text: t('styleAdvisor.tokens.text'),
                    accent: t('styleAdvisor.tokens.accent'),
                    motion: t('styleAdvisor.tokens.motion'),
                }}
                onRequest={handleGenerateStyleProposal}
                onPreview={handlePreviewStyleProposal}
                onApply={handleApplyStyleProposal}
                onIgnore={handleIgnoreStyleProposal}
                onReset={handleResetCircleStyle}
            />
        );
    };

    const renderGuardianFindingPanel = () => {
        if (!canUseGuardianFindings) return null;
        return (
            <GuardianFindingPanel
                title={t('guardianFindings.title')}
                description={t('guardianFindings.description')}
                circleId={Number(circleId)}
                canManage={canUseGuardianFindings}
                locale={locale}
                findings={guardianFindings}
                isLoading={guardianFindingState.status === 'loading'}
                isDiagnosing={guardianFindingState.status === 'diagnosing'}
                errorMessage={guardianFindingState.status === 'error' ? guardianFindingState.message : null}
                activeStatus={guardianFindingStatusFilter}
                activeLevel={guardianFindingLevelFilter}
                focusedFindingId={normalizedFocusedGuardianFindingId}
                labels={{
                    diagnose: t('guardianFindings.diagnose'),
                    refresh: t('guardianFindings.refresh'),
                    loading: t('guardianFindings.loading'),
                    empty: t('guardianFindings.empty'),
                    ack: t('guardianFindings.ack'),
                    dismiss: t('guardianFindings.dismiss'),
                    snooze: t('guardianFindings.snooze'),
                    convert: t('guardianFindings.convert'),
                    evidence: t('guardianFindings.evidence'),
                    notificationError: t('guardianFindings.notificationError'),
                    cooldown: t('guardianFindings.cooldown'),
                    status: {
                        all: t('guardianFindings.status.all'),
                        open: t('guardianFindings.status.open'),
                        acknowledged: t('guardianFindings.status.acknowledged'),
                        dismissed: t('guardianFindings.status.dismissed'),
                        snoozed: t('guardianFindings.status.snoozed'),
                        converted: t('guardianFindings.status.converted'),
                    },
                    level: {
                        all: t('guardianFindings.level.all'),
                        observe: t('guardianFindings.level.observe'),
                        notify: t('guardianFindings.level.notify'),
                        propose: t('guardianFindings.level.propose'),
                    },
                    risk: {
                        low: t('guardianFindings.risk.low'),
                        medium: t('guardianFindings.risk.medium'),
                        high: t('guardianFindings.risk.high'),
                    },
                    severity: {
                        info: t('guardianFindings.severity.info'),
                        low: t('guardianFindings.severity.low'),
                        medium: t('guardianFindings.severity.medium'),
                        high: t('guardianFindings.severity.high'),
                    },
                }}
                onDiagnose={handleDiagnoseGuardianFindings}
                onRefresh={refreshGuardianFindings}
                onFilterStatus={setGuardianFindingStatusFilter}
                onFilterLevel={setGuardianFindingLevelFilter}
                onAck={handleAckGuardianFinding}
                onDismiss={handleDismissGuardianFinding}
                onSnooze={handleSnoozeGuardianFinding}
                onConvert={handleConvertGuardianFinding}
            />
        );
    };

    const renderCircleGrowthAdvisorPanel = () => {
        if (!canUseCircleGrowthAdvisor) return null;
        return (
            <CircleGrowthAdvisorPanel
                title={t('circleGrowthAdvisor.title')}
                description={t('circleGrowthAdvisor.description')}
                circleId={Number(circleId)}
                canManage={canUseCircleGrowthAdvisor}
                locale={locale}
                status={circleGrowthAdvisorState.status === 'loading'
                    ? 'loading'
                    : circleGrowthAdvisorState.status === 'requesting'
                        ? 'requesting'
                        : circleGrowthAdvisorState.status === 'disabled'
                            ? 'disabled'
                            : circleGrowthAdvisorState.status === 'error'
                                ? 'error'
                                : 'idle'}
                proposals={circleGrowthProposals}
                errorMessage={circleGrowthAdvisorState.status === 'error' ? circleGrowthAdvisorState.message : null}
                disabledReason={circleGrowthAdvisorState.status === 'disabled' ? circleGrowthAdvisorState.message : null}
                labels={{
                    request: t('circleGrowthAdvisor.request'),
                    refresh: t('circleGrowthAdvisor.refresh'),
                    loading: t('circleGrowthAdvisor.loading'),
                    empty: t('circleGrowthAdvisor.empty'),
                    noSignal: t('circleGrowthAdvisor.noSignal'),
                    failed: t('circleGrowthAdvisor.failed'),
                    reject: t('circleGrowthAdvisor.reject'),
                    snooze: t('circleGrowthAdvisor.snooze'),
                    convert: t('circleGrowthAdvisor.convert'),
                    evidence: t('circleGrowthAdvisor.evidence'),
                    cooldown: t('circleGrowthAdvisor.cooldown'),
                    configurationProposal: t('circleGrowthAdvisor.configurationProposal'),
                    currentSignals: t('circleGrowthAdvisor.currentSignals'),
                    counterSignals: t('circleGrowthAdvisor.counterSignals'),
                    missingSignals: t('circleGrowthAdvisor.missingSignals'),
                    valueUnset: t('configurationCopilot.valueUnsetLabel'),
                    valueBooleanOn: t('configurationCopilot.valueBooleanOnLabel'),
                    valueBooleanOff: t('configurationCopilot.valueBooleanOffLabel'),
                    unavailable: t('circleGrowthAdvisor.unavailableLabel'),
                    requestFailed: t('circleGrowthAdvisor.requestFailedLabel'),
                    status: {
                        pending: t('circleGrowthAdvisor.status.pending'),
                        ready: t('circleGrowthAdvisor.status.ready'),
                        no_signal: t('circleGrowthAdvisor.status.noSignal'),
                        failed: t('circleGrowthAdvisor.status.failed'),
                        snoozed: t('circleGrowthAdvisor.status.snoozed'),
                        rejected: t('circleGrowthAdvisor.status.rejected'),
                        converted: t('circleGrowthAdvisor.status.converted'),
                    },
                    risk: {
                        low: t('configurationCopilot.risk.low'),
                        medium: t('configurationCopilot.risk.medium'),
                        high: t('configurationCopilot.risk.high'),
                    },
                }}
                onRequest={handleRequestCircleGrowthAdvisor}
                onRefresh={refreshCircleGrowthProposals}
                onReject={handleRejectCircleGrowthProposal}
                onSnooze={handleSnoozeCircleGrowthProposal}
                onConvert={handleConvertCircleGrowthProposal}
            />
        );
    };

    return (
        <AnimatePresence>
            {open && (
                <motion.div
                    className={styles.settingsOverlay}
                    initial={{ opacity: 0 }}
                    animate={{ opacity: 1 }}
                    exit={{ opacity: 0 }}
                    transition={{ duration: 0.22 }}
                    onClick={() => { setPopoverTarget(null); handleCloseSettings(); }}
                >
                    <motion.div
                        className={styles.settingsSheet}
                        initial={{ y: 300, opacity: 0 }}
                        animate={{ y: 0, opacity: 1 }}
                        exit={{ y: 300, opacity: 0 }}
                        transition={{ duration: 0.36, ease: [0.2, 0.8, 0.2, 1] }}
                        onClick={(e) => { e.stopPropagation(); setPopoverTarget(null); }}
                    >
                        <div className={styles.handle} />

                        {/* Header */}
                        <div className={styles.header}>
                            <Settings size={16} style={{ opacity: 0.5 }} />
                            <span className={styles.title}>{t('header.title', { circleName })}</span>
                            <button className={styles.closeBtn} onClick={handleCloseSettings}>
                                <X size={18} />
                            </button>
                        </div>

                        <div className={`${styles.body}${settingsComposeScenario ? ` ${styles.bodyComposePad}` : ''}`}>
                            {!settingsDataReady ? (
                                <div className={styles.sectionNotice} role="status">
                                    {t('dataUnavailable')}
                                </div>
                            ) : null}
                            <div className={styles.aiPanelStack}>
                                {renderCircleGrowthAdvisorPanel()}
                                {renderStyleAdvisorPanel()}
                                {renderConfigurationCopilotPanel()}
                            </div>

                            <nav className={styles.settingsNavigation} aria-label={t('navigation.ariaLabel')}>
                                <div className={styles.settingsNavigationHeader}>
                                    <span>{t('navigation.title')}</span>
                                    <small>{t('navigation.hint')}</small>
                                </div>
                                <div className={styles.settingsNavigationGrid}>
                                    <button type="button" onClick={() => basicSectionRef.current?.scrollIntoView({ block: 'start' })}>
                                        {t('groups.basics.title')}
                                    </button>
                                    <button type="button" onClick={() => governanceSectionRef.current?.scrollIntoView({ block: 'start' })}>
                                        {t('groups.governance.title')}
                                    </button>
                                    <button type="button" onClick={() => contentSectionRef.current?.scrollIntoView({ block: 'start' })}>
                                        {t('groups.content.title')}
                                    </button>
                                    <button type="button" onClick={() => membersSectionRef.current?.scrollIntoView({ block: 'start' })}>
                                        {t('groups.members.title')}
                                    </button>
                                </div>
                            </nav>

                            <div ref={basicSectionRef} className={styles.settingsGroupHeading} data-settings-group="basics">
                                <span>{t('groups.basics.title')}</span>
                                <small>{t('groups.basics.description')}</small>
                            </div>

                            {/* Basic Info */}
                            <div className={styles.section} data-settings-section="basic">
                                <div className={styles.sectionLabel}>{t('sections.basicInfo')}</div>

                                {visibleCircleId && (
                                    <div className={styles.infoRow}>
                                        <span className={styles.infoLabel}>{t('basic.circleIdLabel')}</span>
                                        <button
                                            type="button"
                                            className={styles.copyValueBtn}
                                            onClick={handleCopyCircleId}
                                            aria-label={t('basic.copyCircleId')}
                                            title={circleIdCopied ? t('basic.copiedCircleId') : t('basic.copyCircleId')}
                                        >
                                            <span>#{visibleCircleId}</span>
                                            <Copy size={14} aria-hidden="true" />
                                        </button>
                                    </div>
                                )}

                                <div className={styles.infoRow}>
                                    <span className={styles.infoLabel}>{t('basic.modeLabel')}</span>
                                    <span className={styles.infoValue}>
                                        {circleMode === 'social' ? t('basic.modeSocial') : t('basic.modeKnowledge')}
                                    </span>
                                </div>

                                <div className={styles.infoRow}>
                                    <span className={styles.infoLabel}>{t('basic.accessLabel')}</span>
                                    {!canEditAccessPolicy && (
                                        <span className={styles.infoValue}>
                                            {renderAccessLabel(accessType, currentAccessMinCrystals)}
                                        </span>
                                    )}
                                </div>

                                {canEditAccessPolicy && (
                                    <div className={styles.accessEditor}>
                                        <div className={styles.accessChoiceGroup}>
                                            {accessOptions.map((option) => (
                                                <button
                                                    key={option.value}
                                                    type="button"
                                                    className={`${styles.accessChoiceBtn} ${accessDraftType === option.value ? styles.accessChoiceBtnActive : ''}`}
                                                    onClick={() => {
                                                        if (option.value !== accessDraftType) {
                                                            onAccessPolicyDraftChange?.();
                                                            setAccessDraftType(option.value);
                                                        }
                                                    }}
                                                    disabled={accessPolicySaving}
                                                >
                                                    {option.label}
                                                </button>
                                            ))}
                                        </div>
                                        {accessDraftType === 'crystal' && (
                                            <div className={styles.infoField}>
                                                <div className={styles.infoFieldHeader}>
                                                    <span className={styles.infoLabel}>{t('accessEditor.minCrystals')}</span>
                                                </div>
                                                <div className={styles.inlineNumberWrap}>
                                                    <input
                                                        className={styles.inlineNumberInput}
                                                        type="number"
                                                        min={1}
                                                        max={65535}
                                                        value={accessDraftMinCrystals}
                                                        onChange={(event) => {
                                                            onAccessPolicyDraftChange?.();
                                                            setAccessDraftMinCrystals(normalizeCrystalThreshold(parseInt(event.target.value, 10) || 1));
                                                        }}
                                                        disabled={accessPolicySaving}
                                                    />
                                                </div>
                                                <span className={styles.infoHint}>{t('accessEditor.minCrystalsHelp')}</span>
                                            </div>
                                        )}
                                        {accessPolicyError && (
                                            <div className={styles.ghostError}>{accessPolicyError}</div>
                                        )}
                                        {!accessPolicyError && accessPolicyNotice && (
                                            <div className={styles.accessPolicyNotice}>{accessPolicyNotice}</div>
                                        )}
                                        {accessPolicyDirty && accessPolicyWalletImpact.totalPromptCount > 0 && (
                                            <div className={styles.accessWalletImpact}>
                                                <div className={styles.accessWalletImpactHeader}>
                                                    <span>{circleSettingsT('walletImpact.accessPolicyTitle')}</span>
                                                    <strong>
                                                        {circleSettingsT('walletImpact.total', {
                                                            count: accessPolicyWalletImpact.totalPromptCount,
                                                        })}
                                                    </strong>
                                                </div>
                                                <div className={styles.accessWalletImpactList}>
                                                    {accessPolicyWalletImpact.items.filter((item) => item.required).map((item) => (
                                                        <span key={item.id} className={styles.accessWalletImpactItem}>
                                                            {circleSettingsT(getCircleSettingsWalletImpactMessageKey(item.labelKey))}
                                                        </span>
                                                    ))}
                                                </div>
                                                {accessPolicyWalletImpact.totalPromptCount > 1 && (
                                                    <p className={styles.accessWalletImpactHint}>
                                                        {circleSettingsT('walletImpact.multiPromptHint')}
                                                    </p>
                                                )}
                                            </div>
                                        )}
                                        <button
                                            type="button"
                                            className={styles.ghostSaveBtn}
                                            onClick={handleSaveAccessPolicy}
                                            disabled={!canSaveAccessPolicy}
                                        >
                                            {accessPolicySaving ? t('accessEditor.saving') : t('accessEditor.save')}
                                        </button>
                                    </div>
                                )}
                            </div>

                            <div className={styles.section}>
                                <CircleAliasSettings circleId={circleId} />
                            </div>

                            <div className={styles.section}>
                                <div className={styles.sectionLabel}>{t('sections.geoLocation')}</div>
                                <CircleLocationEditor
                                    anchor={primaryGeoAnchor}
                                    loading={primaryGeoAnchorLoading}
                                    saving={primaryGeoAnchorSaving}
                                    error={primaryGeoAnchorError}
                                    governanceRequestId={primaryGeoAnchorGovernanceRequestId}
                                    editable={canEditPrimaryGeoAnchor}
                                    onSave={onSavePrimaryGeoAnchor}
                                    onArchive={onArchivePrimaryGeoAnchor}
                                />
                            </div>

                            <div className={styles.section}>
                                <div className={styles.sectionLabel}>{t('sections.knowledgeRelationshipLabels')}</div>
                                <button
                                    type="button"
                                    className={styles.relationshipLabelsEntry}
                                    onClick={() => setKnowledgeRelationshipLabelsOpen(true)}
                                >
                                    <div>
                                        <div className={styles.relationshipLabelsTitle}>{t('knowledgeRelationshipLabels.title')}</div>
                                        <div className={styles.relationshipLabelsDesc}>{t('knowledgeRelationshipLabels.description')}</div>
                                    </div>
                                    <span className={styles.relationshipLabelsAction}>
                                        {t('knowledgeRelationshipLabels.open')}
                                        <ChevronRight size={14} strokeWidth={1.8} />
                                    </span>
                                </button>
                            </div>

                            {/* Permissions */}
                            <div className={styles.section}>
                                <div className={styles.sectionLabel}>{t('sections.permissions')}</div>

                                <div className={styles.toggleRow}>
                                    <div>
                                        <div className={styles.toggleLabel}>{t('permissions.forwardTitle')}</div>
                                        <div className={styles.toggleDesc}>{t('permissions.forwardDescription')}</div>
                                    </div>
                                    <button
                                        className={`${styles.toggleSwitch} ${forwardEnabled ? styles.toggleSwitchOn : ''}`}
                                        onClick={handleToggleForward}
                                        disabled={!forwardPolicyEditable}
                                    >
                                        <div className={`${styles.toggleKnob} ${forwardEnabled ? styles.toggleKnobOn : ''}`} />
                                    </button>
                                </div>
                                {forwardPolicyNotice && (
                                    <div className={styles.sectionNotice}>{forwardPolicyNotice}</div>
                                )}
                            </div>

                            <div
                                id="circle-settings-governance"
                                className={styles.section}
                                ref={governanceSectionRef}
                                data-settings-section="governance"
                            >
                                <div className={styles.settingsGroupHeading} data-settings-group="governance">
                                    <span>{t('groups.governance.title')}</span>
                                    <small>{t('groups.governance.description')}</small>
                                </div>
                                <div className={styles.sectionLabel}>{t('sections.governanceCommittee')}</div>
                                <div className={styles.governancePanel}>
                                    <div className={styles.toggleDesc}>{t('governance.authorityProviderBoundary')}</div>
                                    {circleId ? (
                                        <>
                                            <FeedGovernanceControls circleId={circleId} active={open} />
                                            <OperatorCapabilitySuspensionControls circleId={circleId} active={open} />
                                        </>
                                    ) : null}
                                    {governanceResourceReadiness && (
                                        <div
                                            className={styles.governanceEditor}
                                            data-testid="governance-resource-readiness"
                                            data-readiness-state={governanceResourceReadiness.state}
                                            data-resource-owner={governanceResourceReadiness.governedResourceBinding.currentOwner}
                                            data-realms-profile={governanceResourceReadiness.realmsProviderTrust.profileRef}
                                            data-realms-activation={governanceResourceReadiness.realmsProviderTrust.activation}
                                        >
                                            <div className={styles.settingsSummaryHeader}>
                                                <div>
                                                    <div className={styles.toggleLabel}>{t('governance.resourceReadiness.title')}</div>
                                                    <div className={styles.settingsSummaryText}>
                                                        {governanceResourceReadiness.state === 'ready'
                                                            ? t('governance.resourceReadiness.summaryReady')
                                                            : t('governance.resourceReadiness.summarySetupRequired')}
                                                    </div>
                                                </div>
                                                <span
                                                    className={styles.settingsStatusBadge}
                                                    data-tone={governanceResourceReadiness.state === 'ready' ? 'positive' : 'warning'}
                                                >
                                                    {governanceResourceReadiness.state === 'ready'
                                                        ? t('status.ready')
                                                        : t('status.setupRequired')}
                                                </span>
                                            </div>
                                            <div className={styles.settingsSummaryFacts}>
                                                <span>
                                                    <small>{t('governance.resourceReadiness.network')}</small>
                                                    <strong>{t('governance.network.devnet')}</strong>
                                                </span>
                                                <span>
                                                    <small>{t('governance.resourceReadiness.provider')}</small>
                                                    <strong>
                                                        {governanceResourceReadiness.providerExecution === 'available'
                                                            ? t('status.available')
                                                            : t('status.unavailable')}
                                                    </strong>
                                                </span>
                                            </div>
                                            <details className={styles.settingsDisclosure}>
                                                <summary className={styles.settingsDisclosureSummary}>
                                                    <span>{t('details.showTechnical')}</span>
                                                    <ChevronDown size={16} className={styles.settingsDisclosureChevron} aria-hidden="true" />
                                                </summary>
                                                <div className={styles.settingsDisclosureContent}>
                                            <div className={styles.toggleDesc}>{t('governance.resourceReadiness.description')}</div>
                                            <div className={styles.governanceMetaGrid}>
                                                <span>{t('governance.resourceReadiness.network')}</span>
                                                <strong>
                                                    {t('governance.network.devnet')}
                                                    {' · '}{governanceResourceReadiness.realmsProviderTrust.chainId}
                                                </strong>
                                                <span>{t('governance.resourceReadiness.ordinaryCapabilities')}</span>
                                                <strong>
                                                    {t('governance.resourceReadiness.resourceNotRequired')}
                                                    {' · '}{governanceResourceReadiness.ordinaryCapabilities.circleCreation}
                                                    {' / '}{governanceResourceReadiness.ordinaryCapabilities.nativeGovernance}
                                                </strong>
                                                <span>{t('governance.resourceReadiness.governedResource')}</span>
                                                <strong>
                                                    {t('governance.resourceReadiness.resourceUnavailable')}
                                                    {' · '}{governanceResourceReadiness.governedResourceBinding.currentOwner}
                                                </strong>
                                                <span>{t('governance.resourceReadiness.payerPolicy')}</span>
                                                <strong>
                                                    {governanceResourceReadiness.payerPolicy.state}
                                                    {' · '}{governanceResourceReadiness.payerPolicy.activeCount}
                                                </strong>
                                                <span>{t('governance.resourceReadiness.assetAuthority')}</span>
                                                <strong>
                                                    {governanceResourceReadiness.assetAuthorityPolicy.state}
                                                    {' · '}{governanceResourceReadiness.assetAuthorityPolicy.activeCount}
                                                </strong>
                                                <span>{t('governance.resourceReadiness.grantSettlementTitle')}</span>
                                                <strong>
                                                    {governanceResourceReadiness.grantSettlementReadiness.state}
                                                    {' · '}{governanceResourceReadiness.grantSettlementReadiness.readyAgreementCount}
                                                    {' / '}{governanceResourceReadiness.grantSettlementReadiness.activeAgreementCount}
                                                    {' '}{t('governance.resourceReadiness.grantSettlementReadyCount')}
                                                </strong>
                                                <span>{t('governance.resourceReadiness.externalActions')}</span>
                                                <strong>{governanceResourceReadiness.externalResourceActions}</strong>
                                                <span>{t('governance.resourceReadiness.provider')}</span>
                                                <strong>{governanceResourceReadiness.providerExecution}</strong>
                                                <span>{t('governance.resourceReadiness.authority')}</span>
                                                <strong>{governanceResourceReadiness.authorityVerification}</strong>
                                                <span>{t('governance.resourceReadiness.realmsProfile')}</span>
                                                <strong>
                                                    {governanceResourceReadiness.realmsProviderTrust.profileRef}
                                                    {' · v'}{governanceResourceReadiness.realmsProviderTrust.profileVersion}
                                                    {' · '}{governanceResourceReadiness.realmsProviderTrust.chainId}
                                                </strong>
                                                <span>{t('governance.resourceReadiness.realmsVerification')}</span>
                                                <strong>
                                                    {governanceResourceReadiness.realmsProviderTrust.deploymentVerification}
                                                    {' · slot '}{governanceResourceReadiness.realmsProviderTrust.observedAtSlot}
                                                    {' · activation readback '}{governanceResourceReadiness.realmsProviderTrust.activationReadback}
                                                    {' · '}{governanceResourceReadiness.realmsProviderTrust.decoderConformance}
                                                </strong>
                                                <span>{t('governance.resourceReadiness.realmsActivation')}</span>
                                                <strong>
                                                    {governanceResourceReadiness.realmsProviderTrust.activation}
                                                    {' · '}{governanceResourceReadiness.realmsProviderTrust.walletCustody}
                                                </strong>
                                                <span>{t('governance.resourceReadiness.realmsCustody')}</span>
                                                <strong>
                                                    {governanceResourceReadiness.realmsProviderTrust.keyCustodyRecord.recordRef}
                                                    {' · '}{governanceResourceReadiness.realmsProviderTrust.keyCustodyRecord.signerProvider}
                                                    {' · '}{governanceResourceReadiness.realmsProviderTrust.keyCustodyRecord.serviceTopology}
                                                    {' · '}{governanceResourceReadiness.realmsProviderTrust.keyCustodyRecord.endpoint}
                                                </strong>
                                                <span>{t('governance.resourceReadiness.realmsSigner')}</span>
                                                <strong>
                                                    {governanceResourceReadiness.realmsProviderTrust.keyCustodyRecord.keyContracts.map((contract) => (
                                                        `${contract.role}:${contract.keyRef}:public-key-${contract.publicKey ?? 'unavailable'}:${contract.status}`
                                                    )).join(' · ')}
                                                    {' · '}{governanceResourceReadiness.realmsProviderTrust.keyCustodyRecord.keyAlgorithm}
                                                    {' · exportable '}{String(governanceResourceReadiness.realmsProviderTrust.keyCustodyRecord.exportable)}
                                                </strong>
                                                <span>{t('governance.resourceReadiness.realmsCustodyVerification')}</span>
                                                <strong>
                                                    {'status '}{governanceResourceReadiness.realmsProviderTrust.keyCustodyRecord.status}
                                                    {' · last verified '}{governanceResourceReadiness.realmsProviderTrust.keyCustodyRecord.lastVerifiedAt ?? 'never'}
                                                    {' · backup/restore '}{governanceResourceReadiness.realmsProviderTrust.keyCustodyRecord.verification.backupRestore}
                                                    {' · owner readback '}{governanceResourceReadiness.realmsProviderTrust.keyCustodyRecord.verification.runtimeOwnerReadback}
                                                    {' · recovery '}{governanceResourceReadiness.realmsProviderTrust.keyCustodyRecord.recoveryMaterial.provider}
                                                    {' / '}{governanceResourceReadiness.realmsProviderTrust.keyCustodyRecord.recoveryMaterial.databaseName}
                                                    {' · maintainer/recovery '}{governanceResourceReadiness.realmsProviderTrust.keyCustodyRecord.primaryMaintainer}
                                                    {' / '}{governanceResourceReadiness.realmsProviderTrust.keyCustodyRecord.recoveryOwner}
                                                </strong>
                                                <span>{t('governance.resourceReadiness.realmsBlockers')}</span>
                                                <strong>
                                                    {governanceResourceReadiness.realmsProviderTrust.blockerCodes.join(' · ')}
                                                </strong>
                                                <span>{t('governance.resourceReadiness.realmsRuntimeOwner')}</span>
                                                <strong>
                                                    {governanceResourceReadiness.realmsRuntimeBinding.state}
                                                    {' · resource '}{governanceResourceReadiness.realmsRuntimeBinding.resourceBindingId ?? 'not_configured'}
                                                    {' · authorities '}{governanceResourceReadiness.realmsRuntimeBinding.authorityBindings.map((binding) => (
                                                        `${binding.role}:${binding.keyRef}:${binding.publicKey ?? 'public-key-unavailable'}:${binding.custodyStatus}`
                                                    )).join(', ') || 'not_configured'}
                                                    {' · payer '}{governanceResourceReadiness.realmsRuntimeBinding.payerPolicy
                                                        ? `${governanceResourceReadiness.realmsRuntimeBinding.payerPolicy.state}:${governanceResourceReadiness.realmsRuntimeBinding.payerPolicy.feePayerSignerRef ?? 'unassigned'}:${governanceResourceReadiness.realmsRuntimeBinding.payerPolicy.fundingBlockerCode ?? 'none'}`
                                                        : 'not_configured'}
                                                    {' · application identity '}{governanceResourceReadiness.realmsRuntimeBinding.applicationIdentity
                                                        ? `${governanceResourceReadiness.realmsRuntimeBinding.applicationIdentity.authMethod}:${governanceResourceReadiness.realmsRuntimeBinding.applicationIdentity.policyName}:${governanceResourceReadiness.realmsRuntimeBinding.applicationIdentity.status}:last-verified-${governanceResourceReadiness.realmsRuntimeBinding.applicationIdentity.lastVerifiedAt}`
                                                        : 'not_configured'}
                                                </strong>
                                                <span>{t('governance.resourceReadiness.realmsReconciliation')}</span>
                                                <strong>
                                                    {governanceResourceReadiness.realmsRuntimeBinding.reconciliation
                                                        ? `${governanceResourceReadiness.realmsRuntimeBinding.reconciliation.state}:${governanceResourceReadiness.realmsRuntimeBinding.reconciliation.blocker ?? 'none'}:${governanceResourceReadiness.realmsRuntimeBinding.reconciliation.authority}:slot-${governanceResourceReadiness.realmsRuntimeBinding.reconciliation.observedSlot ?? 'unavailable'}:observed-${governanceResourceReadiness.realmsRuntimeBinding.reconciliation.observedAt}`
                                                        : 'not_available'}
                                                </strong>
                                                <span>{t('governance.resourceReadiness.realmsFinality')}</span>
                                                <strong>
                                                    {governanceResourceReadiness.realmsRuntimeBinding.providerFinality
                                                        ? governanceResourceReadiness.realmsRuntimeBinding.providerFinality.transactions.map((transaction) => (
                                                            `${transaction.stepId}:slot-${transaction.slot}:${transaction.finalityTransitions.map((transition) => (
                                                                transition.slot === undefined
                                                                    ? transition.state
                                                                    : `${transition.state}@${transition.slot}`
                                                            )).join('->')}`
                                                        )).join(' · ')
                                                        : 'not_available'}
                                                </strong>
                                                <span>{t('governance.resourceReadiness.realmsProviderDisable')}</span>
                                                <strong>
                                                    {governanceResourceReadiness.realmsRuntimeBinding.providerDisable
                                                        ? `${governanceResourceReadiness.realmsRuntimeBinding.state === 'disabled' ? 'disabled' : 'restored_current_active'}:source-request-${governanceResourceReadiness.realmsRuntimeBinding.providerDisable.requestId}:disabled-${governanceResourceReadiness.realmsRuntimeBinding.providerDisable.disabledAt}:rollback-${governanceResourceReadiness.realmsRuntimeBinding.providerDisable.rollbackPolicy.preSubmit}:post-submit-${governanceResourceReadiness.realmsRuntimeBinding.providerDisable.rollbackPolicy.postSubmit}`
                                                        : 'not_disabled'}
                                                </strong>
                                                <span>Resource pause boundary</span>
                                                <strong data-testid="realms-resource-pause-boundary">
                                                    {governanceResourceReadiness.realmsRuntimeBinding.providerDisable
                                                        ? `${governanceResourceReadiness.realmsRuntimeBinding.providerDisable.pauseBoundary.authority}:workflow-freeze-chain-paused-${String(governanceResourceReadiness.realmsRuntimeBinding.providerDisable.pauseBoundary.workflowFreezeClaimsChainPaused)}:${governanceResourceReadiness.realmsRuntimeBinding.providerDisable.pauseBoundary.effect}:provider-tx-${governanceResourceReadiness.realmsRuntimeBinding.providerDisable.pauseBoundary.providerTransaction}:onchain-instruction-${governanceResourceReadiness.realmsRuntimeBinding.providerDisable.pauseBoundary.onchainPauseInstruction}:fallback-${governanceResourceReadiness.realmsRuntimeBinding.providerDisable.pauseBoundary.fallbackAuthority}`
                                                        : 'not_disabled'}
                                                </strong>
                                                <span>Emergency on-chain pause</span>
                                                <strong data-testid="realms-emergency-onchain-pause">
                                                    {governanceResourceReadiness.realmsRuntimeBinding.emergencyOnchainPause
                                                        ? `${governanceResourceReadiness.realmsRuntimeBinding.emergencyOnchainPause.state}:enforcement-${governanceResourceReadiness.realmsRuntimeBinding.emergencyOnchainPause.pauseEnforcement}:instruction-${governanceResourceReadiness.realmsRuntimeBinding.emergencyOnchainPause.onchainPauseInstruction}:ends-${governanceResourceReadiness.realmsRuntimeBinding.emergencyOnchainPause.pauseEndsAt}:permanent-risk-${String(governanceResourceReadiness.realmsRuntimeBinding.emergencyOnchainPause.residualRisk.permanentPausePossible)}:expired-alias-forbidden-${String(governanceResourceReadiness.realmsRuntimeBinding.emergencyOnchainPause.residualRisk.expiredAliasForbidden)}:resumed-alias-forbidden-${String(governanceResourceReadiness.realmsRuntimeBinding.emergencyOnchainPause.residualRisk.resumedAliasForbidden)}`
                                                        : 'not_enabled'}
                                                </strong>
                                                <span>Program upgrade</span>
                                                <strong data-testid="realms-program-upgrade">
                                                    {governanceResourceReadiness.realmsRuntimeBinding.programUpgrade
                                                        ? `${governanceResourceReadiness.realmsRuntimeBinding.programUpgrade.state}:request-${governanceResourceReadiness.realmsRuntimeBinding.programUpgrade.requestId}:payload-${governanceResourceReadiness.realmsRuntimeBinding.programUpgrade.upgradePayloadDigest}:repo-${governanceResourceReadiness.realmsRuntimeBinding.programUpgrade.codeRelease.repository}:commit-${governanceResourceReadiness.realmsRuntimeBinding.programUpgrade.codeRelease.commit}:artifact-${governanceResourceReadiness.realmsRuntimeBinding.programUpgrade.codeRelease.buildArtifactSha256}:audit-${governanceResourceReadiness.realmsRuntimeBinding.programUpgrade.codeRelease.auditStatus}:disposition-${governanceResourceReadiness.realmsRuntimeBinding.programUpgrade.disposition.upgradeAuthorityDisposition}:executed-shown-${String(governanceResourceReadiness.realmsRuntimeBinding.programUpgrade.residualRisk.executedShown)}:fallback-${governanceResourceReadiness.realmsRuntimeBinding.programUpgrade.residualRisk.fallbackAuthority}`
                                                        : 'not_run'}
                                                </strong>
                                                <span>{t('governance.resourceReadiness.realmsDelegationConformance')}</span>
                                                <strong>
                                                    {governanceResourceReadiness.realmsRuntimeBinding.delegationConformance
                                                        ? `${governanceResourceReadiness.realmsRuntimeBinding.delegationConformance.state}:request-${governanceResourceReadiness.realmsRuntimeBinding.delegationConformance.requestId}:set-slot-${governanceResourceReadiness.realmsRuntimeBinding.delegationConformance.setObservedSlot ?? 'pending'}:revoke-slot-${governanceResourceReadiness.realmsRuntimeBinding.delegationConformance.revokeObservedSlot ?? 'pending'}:final-delegate-none:history-${governanceResourceReadiness.realmsRuntimeBinding.delegationConformance.historicalVoteInvariant}:blocker-${governanceResourceReadiness.realmsRuntimeBinding.delegationConformance.blocker ?? 'none'}`
                                                        : 'not_run'}
                                                </strong>
                                                <span>{t('governance.resourceReadiness.votingPowerChallenge')}</span>
                                                <strong data-testid="realms-voting-power-challenge">
                                                    {governanceResourceReadiness.realmsRuntimeBinding.votingPowerChallenge
                                                        ? `${governanceResourceReadiness.realmsRuntimeBinding.votingPowerChallenge.state}:request-${governanceResourceReadiness.realmsRuntimeBinding.votingPowerChallenge.requestId}:pre-slot-${governanceResourceReadiness.realmsRuntimeBinding.votingPowerChallenge.preObservedSlot}:post-slot-${governanceResourceReadiness.realmsRuntimeBinding.votingPowerChallenge.postObservedSlot ?? 'pending'}:history-${governanceResourceReadiness.realmsRuntimeBinding.votingPowerChallenge.historicalTallyInvariant}:blocker-${governanceResourceReadiness.realmsRuntimeBinding.votingPowerChallenge.blocker ?? 'none'}`
                                                        : 'not_run'}
                                                </strong>
                                                <span>{t('governance.resourceReadiness.realmsBoundary')}</span>
                                                <strong>
                                                    {governanceResourceReadiness.realmsProviderTrust.devnetExecutionScope}
                                                    {' · '}{governanceResourceReadiness.realmsProviderTrust.authorizationDecisionRef}
                                                    {' · mainnet '}{governanceResourceReadiness.realmsProviderTrust.mainnet}
                                                </strong>
                                            </div>
                                            <div
                                                className={styles.governanceEditor}
                                                data-testid="realms-voting-power-security"
                                                data-voting-power-readiness={governanceResourceReadiness.realmsRuntimeBinding.votingPowerSecurity?.readinessState ?? 'not_available'}
                                            >
                                                <div className={styles.toggleLabel}>
                                                    {t('governance.resourceReadiness.votingPowerTitle')}
                                                </div>
                                                <div className={styles.toggleDesc}>
                                                    {governanceResourceReadiness.realmsRuntimeBinding.votingPowerSecurity
                                                        ? t('governance.resourceReadiness.votingPowerUnavailable')
                                                        : t('governance.resourceReadiness.votingPowerNoReadback')}
                                                </div>
                                                {governanceResourceReadiness.realmsRuntimeBinding.votingPowerSecurity ? (
                                                    <div className={styles.governanceMetaGrid}>
                                                        <span>{t('governance.resourceReadiness.votingPowerSnapshot')}</span>
                                                        <strong>
                                                            {governanceResourceReadiness.realmsRuntimeBinding.votingPowerSecurity.source.commitment}
                                                            {' · slot '}{governanceResourceReadiness.realmsRuntimeBinding.votingPowerSecurity.source.snapshotSlot}
                                                            {' · '}{governanceResourceReadiness.realmsRuntimeBinding.votingPowerSecurity.source.governingTokenMint}
                                                        </strong>
                                                        <span>{t('governance.resourceReadiness.votingPowerDeposits')}</span>
                                                        <strong>
                                                            {governanceResourceReadiness.realmsRuntimeBinding.votingPowerSecurity.tokenOwnerRecords.map((record) => (
                                                                `${record.role}:${record.owner}:${record.depositAmount}:delegate-${record.governanceDelegate ?? 'none'}`
                                                            )).join(' · ')}
                                                        </strong>
                                                        <span>{t('governance.resourceReadiness.votingPowerDedup')}</span>
                                                        <strong>
                                                            {governanceResourceReadiness.realmsRuntimeBinding.votingPowerSecurity.delegationGraph.mapping}
                                                            {' · duplicates '}{governanceResourceReadiness.realmsRuntimeBinding.votingPowerSecurity.delegationGraph.duplicateResourceCount}
                                                            {' · cycle '}{String(governanceResourceReadiness.realmsRuntimeBinding.votingPowerSecurity.delegationGraph.cycleDetected)}
                                                            {' · root '}{governanceResourceReadiness.realmsRuntimeBinding.votingPowerSecurity.sameResourceRoot.rootDigest}
                                                        </strong>
                                                        <span>{t('governance.resourceReadiness.votingPowerProtections')}</span>
                                                        <strong>
                                                            snapshot-delay-{governanceResourceReadiness.realmsRuntimeBinding.votingPowerSecurity.protections.snapshotDelay}
                                                            {' · cooldown-'}{governanceResourceReadiness.realmsRuntimeBinding.votingPowerSecurity.protections.cooldown}
                                                            {' · borrowed-capital-'}{governanceResourceReadiness.realmsRuntimeBinding.votingPowerSecurity.protections.borrowedCapitalRisk}
                                                        </strong>
                                                        <span>{t('governance.resourceReadiness.votingPowerPlugins')}</span>
                                                        <strong>
                                                            VSR {governanceResourceReadiness.realmsRuntimeBinding.votingPowerSecurity.plugins.vsr}
                                                            {' · VWR '}{governanceResourceReadiness.realmsRuntimeBinding.votingPowerSecurity.plugins.voterWeightAddin}
                                                            {' · max VWR '}{governanceResourceReadiness.realmsRuntimeBinding.votingPowerSecurity.plugins.maxVoterWeightAddin}
                                                        </strong>
                                                        <span>{t('governance.resourceReadiness.votingPowerBlockers')}</span>
                                                        <strong>{governanceResourceReadiness.realmsRuntimeBinding.votingPowerSecurity.blockerCodes.join(' · ')}</strong>
                                                    </div>
                                                ) : null}
                                            </div>
                                            <div
                                                className={styles.governanceEditor}
                                                data-testid="governance-grant-settlement-readiness"
                                                data-grant-settlement-state={governanceResourceReadiness.grantSettlementReadiness.state}
                                            >
                                                <div className={styles.toggleLabel}>
                                                    {t('governance.resourceReadiness.grantSettlementTitle')}
                                                </div>
                                                <div className={styles.toggleDesc}>
                                                    {t('governance.resourceReadiness.grantSettlementDescription')}
                                                </div>
                                                {governanceResourceReadiness.grantSettlementReadiness.evaluations.map((evaluation) => (
                                                    <div
                                                        key={evaluation.agreementId}
                                                        className={styles.governanceMetaGrid}
                                                        data-testid="governance-grant-settlement-evaluation"
                                                        data-grant-agreement-id={evaluation.agreementId}
                                                        data-grant-settlement-integrity={evaluation.integrity}
                                                    >
                                                        <span>{t('governance.resourceReadiness.grantSettlementAgreement')}</span>
                                                        <strong>{evaluation.projectRef} · {evaluation.agreementId}</strong>
                                                        <span>{t('governance.resourceReadiness.grantSettlementState')}</span>
                                                        <strong>{evaluation.state} · {evaluation.integrity} · v{evaluation.evaluationVersion}</strong>
                                                        <span>{t('governance.resourceReadiness.grantSettlementResource')}</span>
                                                        <strong>
                                                            {evaluation.resource
                                                                ? `${evaluation.resource.state}:${evaluation.resource.chainId ?? 'unbound'}:${evaluation.resource.profileRef ?? 'unbound'}:${evaluation.resource.resourceRef ?? 'unbound'}`
                                                                : 'not_evaluated'}
                                                        </strong>
                                                        <span>{t('governance.resourceReadiness.grantSettlementAuthority')}</span>
                                                        <strong>
                                                            {evaluation.authority
                                                                ? `${evaluation.authority.state}:${evaluation.authority.bindingRefs.join(',') || 'unbound'}`
                                                                : 'not_evaluated'}
                                                        </strong>
                                                        <span>{t('governance.resourceReadiness.grantSettlementPayerAsset')}</span>
                                                        <strong>
                                                            {evaluation.payer?.state ?? 'not_evaluated'}
                                                            {' · '}{evaluation.assetAuthority?.state ?? 'not_evaluated'}
                                                        </strong>
                                                        <span>{t('governance.resourceReadiness.grantSettlementFunding')}</span>
                                                        <strong>
                                                            {evaluation.fundingReadback
                                                                ? `${evaluation.fundingReadback.state}:${evaluation.fundingReadback.availableUnits ?? 'unavailable'}:${evaluation.fundingReadback.finality ?? 'not_finalized'}`
                                                                : 'not_evaluated'}
                                                        </strong>
                                                        <span>{t('governance.resourceReadiness.grantSettlementPayout')}</span>
                                                        <strong>
                                                            {evaluation.payout
                                                                ? `${evaluation.payout.intent}:paid-${String(evaluation.payout.paid)}:finality-${String(evaluation.payout.providerFinality)}`
                                                                : 'not_created:paid-false:finality-null'}
                                                        </strong>
                                                        <span>{t('governance.resourceReadiness.grantSettlementBlockers')}</span>
                                                        <strong>{evaluation.blockerCodes.join(' · ') || 'none'}</strong>
                                                        {canManageGovernanceBindings
                                                        && evaluation.trancheIntentId
                                                        && evaluation.payout?.intent === 'contractual_pending_settlement'
                                                        && !evaluation.activePayoutRequest
                                                        && grantPayoutRequestReadback?.agreementId !== evaluation.agreementId ? (
                                                            <button
                                                                type="button"
                                                                className={styles.governanceSecondaryBtn}
                                                                onClick={() => { void createGrantPayoutRequest(evaluation); }}
                                                                disabled={grantPayoutRequestLoading}
                                                                data-testid="circle-settings-grant-open-payout-request"
                                                            >
                                                                {grantPayoutRequestLoading
                                                                    ? t('governance.resourceReadiness.grantPayoutRequestLoading')
                                                                    : t('governance.resourceReadiness.grantPayoutRequestCreate')}
                                                            </button>
                                                        ) : null}
                                                        {grantPayoutRequestReadback?.agreementId === evaluation.agreementId
                                                        || evaluation.activePayoutRequest ? (
                                                            <strong data-testid="circle-settings-grant-payout-request-readback">
                                                                {t('governance.resourceReadiness.grantPayoutRequestCreated', {
                                                                    request: grantPayoutRequestReadback?.agreementId === evaluation.agreementId
                                                                        ? grantPayoutRequestReadback.request.id
                                                                        : evaluation.activePayoutRequest?.id ?? '',
                                                                    state: grantPayoutRequestReadback?.agreementId === evaluation.agreementId
                                                                        ? grantPayoutRequestReadback.request.state
                                                                        : evaluation.activePayoutRequest?.state ?? '',
                                                                })}
                                                            </strong>
                                                        ) : null}
                                                    </div>
                                                ))}
                                                {governanceResourceReadiness.grantSettlementReadiness.evaluations.length === 0 ? (
                                                    <div className={styles.toggleDesc}>
                                                        {t('governance.resourceReadiness.grantSettlementNotApplicable')}
                                                    </div>
                                                ) : null}
                                                {governanceResourceReadiness.grantSettlementReadiness.blockerCodes.length > 0 ? (
                                                    <div className={styles.governanceRisk}>
                                                        {governanceResourceReadiness.grantSettlementReadiness.blockerCodes.join(' · ')}
                                                    </div>
                                                ) : null}
                                                {grantPayoutRequestError ? (
                                                    <div className={styles.governanceRisk}>{grantPayoutRequestError}</div>
                                                ) : null}
                                            </div>
                                            {canManageGovernanceBindings && (
                                                <div className={styles.governanceActions}>
                                                    <button
                                                        type="button"
                                                        className={styles.governanceSecondaryBtn}
                                                        onClick={() => { void refreshRealmsProviderTrustReadback(); }}
                                                        disabled={realmsProviderTrustReadbackLoading}
                                                        data-testid="realms-provider-trust-readback-refresh"
                                                    >
                                                        {realmsProviderTrustReadbackLoading
                                                            ? t('governance.resourceReadiness.liveReadbackLoading')
                                                            : t('governance.resourceReadiness.liveReadbackRefresh')}
                                                    </button>
                                                    {governanceResourceReadiness.realmsRuntimeBinding.state === 'not_configured' ? (
                                                        <button
                                                            type="button"
                                                            className={styles.governanceSecondaryBtn}
                                                            onClick={() => { void createRealmsProviderBindingRequest(); }}
                                                            disabled={realmsProviderBindingRequestLoading}
                                                            data-testid="realms-provider-binding-request"
                                                        >
                                                            {realmsProviderBindingRequestLoading
                                                                ? t('governance.resourceReadiness.bindingRequestLoading')
                                                                : t('governance.resourceReadiness.bindingRequestCreate')}
                                                        </button>
                                                    ) : ['active', 'degraded'].includes(governanceResourceReadiness.realmsRuntimeBinding.state) ? (
                                                        <>
                                                            <button
                                                                type="button"
                                                                className={styles.governanceSecondaryBtn}
                                                                onClick={() => { void createRealmsProviderDelegationConformanceRequest(); }}
                                                                disabled={realmsProviderBindingRequestLoading}
                                                                data-testid="realms-provider-delegation-request"
                                                            >
                                                                {realmsProviderBindingRequestLoading
                                                                    ? t('governance.resourceReadiness.delegationRequestLoading')
                                                                    : t('governance.resourceReadiness.delegationRequestCreate')}
                                                            </button>
                                                            <button
                                                                type="button"
                                                                className={styles.governanceSecondaryBtn}
                                                                onClick={() => { void createRealmsVotingPowerChallengeConformanceRequest(); }}
                                                                disabled={realmsProviderBindingRequestLoading}
                                                                data-testid="realms-voting-power-challenge-request"
                                                            >
                                                                {realmsProviderBindingRequestLoading
                                                                    ? t('governance.resourceReadiness.votingPowerChallengeRequestLoading')
                                                                    : t('governance.resourceReadiness.votingPowerChallengeRequestCreate')}
                                                            </button>
                                                            <button
                                                                type="button"
                                                                className={styles.governanceSecondaryBtn}
                                                                onClick={() => { void createRealmsProviderDisableRequest(); }}
                                                                disabled={realmsProviderBindingRequestLoading}
                                                                data-testid="realms-provider-disable-request"
                                                            >
                                                                {realmsProviderBindingRequestLoading
                                                                    ? t('governance.resourceReadiness.disableRequestLoading')
                                                                    : t('governance.resourceReadiness.disableRequestCreate')}
                                                            </button>
                                                        </>
                                                    ) : governanceResourceReadiness.realmsRuntimeBinding.state === 'disabled' ? (
                                                        <button
                                                            type="button"
                                                            className={styles.governanceSecondaryBtn}
                                                            onClick={() => { void createRealmsProviderRestoreRequest(); }}
                                                            disabled={realmsProviderBindingRequestLoading}
                                                            data-testid="realms-provider-restore-request"
                                                        >
                                                            {realmsProviderBindingRequestLoading
                                                                ? t('governance.resourceReadiness.restoreRequestLoading')
                                                                : t('governance.resourceReadiness.restoreRequestCreate')}
                                                        </button>
                                                    ) : null}
                                                </div>
                                            )}
                                            {realmsProviderBindingRequest && (
                                                <div className={styles.governanceRisk} data-testid="realms-provider-binding-request-status">
                                                    {t('governance.resourceReadiness.bindingRequestCreated', {
                                                        request: realmsProviderBindingRequest.id,
                                                    })}
                                                </div>
                                            )}
                                            {realmsProviderBindingRequestError && (
                                                <div className={styles.governanceRisk} data-testid="realms-provider-binding-request-error">
                                                    {t('governance.resourceReadiness.bindingRequestError')}
                                                    {' · '}{realmsProviderBindingRequestError}
                                                </div>
                                            )}
                                            {realmsProviderTrustReadbackError && (
                                                <div className={styles.governanceRisk} data-testid="realms-provider-trust-readback-error">
                                                    {t('governance.resourceReadiness.liveReadbackError')}
                                                </div>
                                            )}
                                            {realmsProviderTrustReadback && (
                                                <div
                                                    className={styles.governanceMetaGrid}
                                                    data-testid="realms-provider-trust-readback"
                                                    data-observed-slot={realmsProviderTrustReadback.observedSlot}
                                                >
                                                    <span>{t('governance.resourceReadiness.liveReadbackStatus')}</span>
                                                    <strong>
                                                        {realmsProviderTrustReadback.status}
                                                        {' · '}{realmsProviderTrustReadback.commitment}
                                                        {' · slot '}{realmsProviderTrustReadback.observedSlot}
                                                        {' · '}{realmsProviderTrustReadback.observedAt}
                                                    </strong>
                                                    <span>{t('governance.resourceReadiness.liveReadbackDeployment')}</span>
                                                    <strong title={realmsProviderTrustReadback.programDataAddress}>
                                                        {realmsProviderTrustReadback.programId}
                                                        {' · ProgramData '}{realmsProviderTrustReadback.programDataAddress}
                                                        {' · authority '}{realmsProviderTrustReadback.upgradeAuthority}
                                                    </strong>
                                                    <span>{t('governance.resourceReadiness.liveReadbackDecoder')}</span>
                                                    <strong>
                                                        {realmsProviderTrustReadback.decoder.package}
                                                        {' · Realm '}{realmsProviderTrustReadback.decoder.realm}
                                                        {' · Governance '}{realmsProviderTrustReadback.decoder.governance}
                                                        {' · add-ins '}{realmsProviderTrustReadback.decoder.addins}
                                                    </strong>
                                                    <span>{t('governance.resourceReadiness.realmsActivation')}</span>
                                                    <strong>{realmsProviderTrustReadback.activation}</strong>
                                                    <span>{t('governance.resourceReadiness.liveSignerStatus')}</span>
                                                    <strong data-testid="realms-runtime-signer-readback">
                                                        {realmsProviderTrustReadback.runtimeSigner.signerProvider}
                                                        {' · '}{realmsProviderTrustReadback.runtimeSigner.status}
                                                        {' · '}{realmsProviderTrustReadback.runtimeSigner.applicationIdentity.status}
                                                        {' · '}{realmsProviderTrustReadback.runtimeSigner.profileRef}
                                                        {' · v'}{realmsProviderTrustReadback.runtimeSigner.profileVersion}
                                                    </strong>
                                                    <span>{t('governance.resourceReadiness.liveSignerKeys')}</span>
                                                    <strong>
                                                        {realmsProviderTrustReadback.runtimeSigner.keys.length > 0
                                                            ? realmsProviderTrustReadback.runtimeSigner.keys.map((key) => (
                                                                `${key.role}:${key.publicKey ?? key.status}`
                                                            )).join(' · ')
                                                            : 'wallet keys not generated'}
                                                    </strong>
                                                    <span>{t('governance.resourceReadiness.liveSignerBlocker')}</span>
                                                    <strong>
                                                        {realmsProviderTrustReadback.runtimeSigner.blocker ?? 'none'}
                                                        {' · last verified '}{realmsProviderTrustReadback.runtimeSigner.observedAt ?? 'never'}
                                                    </strong>
                                                </div>
                                            )}
                                            <div
                                                className={styles.governanceEditor}
                                                data-testid="squads-provider-runtime"
                                                data-binding-status={squadsProviderTrustReadback?.runtimeSigner.bindingStatus ?? 'unread'}
                                            >
                                                <div className={styles.toggleLabel}>Squads V4 · Devnet 2-of-3</div>
                                                <div className={styles.toggleDesc}>
                                                    {t('governance.authorityProviderBoundary')}
                                                </div>
                                                {canManageGovernanceBindings && (
                                                    <div className={styles.governanceActions}>
                                                        <button
                                                            type="button"
                                                            className={styles.governanceSecondaryBtn}
                                                            onClick={() => { void refreshSquadsProviderTrustReadback(); }}
                                                            disabled={squadsProviderTrustReadbackLoading}
                                                            data-testid="squads-provider-trust-readback-refresh"
                                                        >
                                                            {squadsProviderTrustReadbackLoading
                                                                ? t('governance.resourceReadiness.liveReadbackLoading')
                                                                : t('governance.resourceReadiness.liveReadbackRefresh')}
                                                        </button>
                                                        {squadsProviderTrustReadback?.runtimeSigner.bindingStatus === 'not_configured' && (
                                                            <>
                                                                <button
                                                                    type="button"
                                                                    className={styles.governanceSecondaryBtn}
                                                                    onClick={() => { void createSquadsProviderRequest('binding'); }}
                                                                    disabled={squadsProviderBindingRequestLoading}
                                                                    data-testid="squads-provider-binding-request"
                                                                >
                                                                    {t('governance.resourceReadiness.bindingRequestCreate')}
                                                                </button>
                                                                <label htmlFor="squads-existing-resource-adoption-manifest">
                                                                    {t('governance.resourceReadiness.squadsAdoptionManifestLabel')}
                                                                </label>
                                                                <textarea
                                                                    id="squads-existing-resource-adoption-manifest"
                                                                    className={styles.governanceInput}
                                                                    value={squadsProviderAdoptionManifest}
                                                                    onChange={(event) => setSquadsProviderAdoptionManifest(event.target.value)}
                                                                    placeholder={t('governance.resourceReadiness.squadsAdoptionManifestPlaceholder')}
                                                                    rows={6}
                                                                    spellCheck={false}
                                                                    disabled={squadsProviderBindingRequestLoading}
                                                                    data-testid="squads-provider-adoption-manifest"
                                                                />
                                                                <button
                                                                    type="button"
                                                                    className={styles.governanceSecondaryBtn}
                                                                    onClick={() => { void createSquadsProviderAdoptionRequest(); }}
                                                                    disabled={squadsProviderBindingRequestLoading || !squadsProviderAdoptionManifest.trim()}
                                                                    data-testid="squads-provider-adoption-request"
                                                                >
                                                                    {t('governance.resourceReadiness.squadsAdoptionRequestCreate')}
                                                                </button>
                                                            </>
                                                        )}
                                                        {squadsProviderTrustReadback?.runtimeSigner.bindingStatus === 'pending_custody'
                                                            && squadsProviderTrustReadback.runtimeSigner.status === 'verified_read_only' && (
                                                            <button
                                                                type="button"
                                                                className={styles.governanceSecondaryBtn}
                                                                onClick={() => { void createSquadsProviderRequest('bootstrap'); }}
                                                                disabled={squadsProviderBindingRequestLoading}
                                                                data-testid="squads-provider-bootstrap-request"
                                                            >
                                                                {t('governance.resourceReadiness.bindingRequestCreate')}
                                                            </button>
                                                        )}
                                                        {['active', 'degraded'].includes(
                                                            squadsProviderTrustReadback?.runtimeSigner.bindingStatus ?? '',
                                                        ) && (
                                                            <button
                                                                type="button"
                                                                className={styles.governanceSecondaryBtn}
                                                                onClick={() => { void createSquadsProviderRequest('disable'); }}
                                                                disabled={squadsProviderBindingRequestLoading}
                                                                data-testid="squads-provider-disable-request"
                                                            >
                                                                {t('governance.resourceReadiness.disableRequestCreate')}
                                                            </button>
                                                        )}
                                                        {squadsProviderTrustReadback?.runtimeSigner.bindingStatus === 'disabled' && (
                                                            <button
                                                                type="button"
                                                                className={styles.governanceSecondaryBtn}
                                                                onClick={() => { void createSquadsProviderRequest('restore'); }}
                                                                disabled={squadsProviderBindingRequestLoading}
                                                                data-testid="squads-provider-restore-request"
                                                            >
                                                                {t('governance.resourceReadiness.restoreRequestCreate')}
                                                            </button>
                                                        )}
                                                    </div>
                                                )}
                                                {squadsProviderTrustReadback && (
                                                    <div className={styles.governanceMetaGrid} data-testid="squads-provider-trust-readback">
                                                        <span>{t('governance.resourceReadiness.liveReadbackStatus')}</span>
                                                        <strong>
                                                            {squadsProviderTrustReadback.runtimeSigner.bindingStatus}
                                                            {' · '}{squadsProviderTrustReadback.runtimeSigner.status}
                                                            {' · slot '}{squadsProviderTrustReadback.observedSlot}
                                                        </strong>
                                                        <span>{t('governance.resourceReadiness.liveReadbackDeployment')}</span>
                                                        <strong>
                                                            {squadsProviderTrustReadback.profileRef}
                                                            {' · v'}{squadsProviderTrustReadback.profileVersion}
                                                            {' · '}{squadsProviderTrustReadback.programId}
                                                        </strong>
                                                        <span>{t('governance.resourceReadiness.liveReadbackDecoder')}</span>
                                                        <strong>
                                                            {squadsProviderTrustReadback.decoder.package}
                                                            {' · '}{squadsProviderTrustReadback.decoder.threshold}-of-{squadsProviderTrustReadback.decoder.memberCount}
                                                            {' · source '}{squadsProviderTrustReadback.sourceReproducibility}
                                                        </strong>
                                                        <span>{t('governance.resourceReadiness.liveSignerKeys')}</span>
                                                        <strong>
                                                            {squadsProviderTrustReadback.runtimeSigner.identities.map((identity) => (
                                                                `${identity.role}:${identity.publicKey ?? identity.status}`
                                                            )).join(' · ')}
                                                        </strong>
                                                        <span>{t('governance.resourceReadiness.liveSignerBlocker')}</span>
                                                        <strong>
                                                            {squadsProviderTrustReadback.runtimeSigner.blocker ?? 'none'}
                                                            {' · finality '}{squadsProviderTrustReadback.reconciliation?.state ?? 'not_available'}
                                                        </strong>
                                                        {squadsProviderTrustReadback.reconciliation?.state === 'verified'
                                                            && squadsProviderTrustReadback.reconciliation.executionProgress && (
                                                            <>
                                                                <span>{t('governance.resourceReadiness.squadsApprovalProgress')}</span>
                                                                <strong data-testid="squads-provider-approval-progress">
                                                                    {squadsProviderTrustReadback.reconciliation.executionProgress.approvedMemberCount}
                                                                    -of-{squadsProviderTrustReadback.reconciliation.executionProgress.memberCount}
                                                                    {' · '}{t('governance.resourceReadiness.squadsNoPendingApproval')}
                                                                </strong>
                                                                <span>{t('governance.resourceReadiness.squadsTransactionProgress')}</span>
                                                                <strong data-testid="squads-provider-transaction-progress">
                                                                    {squadsProviderTrustReadback.reconciliation.executionProgress.transactionCount}
                                                                    {' · finalized · slot '}
                                                                    {squadsProviderTrustReadback.reconciliation.executionProgress.transactions.at(-1)?.slot}
                                                                </strong>
                                                                <span>{t('governance.resourceReadiness.squadsExecutionResult')}</span>
                                                                <strong data-testid="squads-provider-execution-result">
                                                                    {squadsProviderTrustReadback.reconciliation.executionProgress.executionResult}
                                                                    {' · no real assets'}
                                                                </strong>
                                                            </>
                                                        )}
                                                        {squadsProviderTrustReadback.grantSettlement && <>
                                                            <span>{t('governance.resourceReadiness.squadsGrantPayout')}</span>
                                                            <strong data-testid="squads-grant-payout-readback">
                                                                {squadsProviderTrustReadback.grantSettlement.state}
                                                                {' · '}{squadsProviderTrustReadback.grantSettlement.providerFinality
                                                                    ?? t('governance.resourceReadiness.squadsGrantInFlight')}
                                                                {' · slot '}{squadsProviderTrustReadback.grantSettlement.verifiedSlot ?? '—'}
                                                            </strong>
                                                            <span>{t('governance.resourceReadiness.squadsGrantRecipientAmount')}</span>
                                                            <strong>
                                                                {squadsProviderTrustReadback.grantSettlement.recipient ?? '—'}
                                                                {' · '}{squadsProviderTrustReadback.grantSettlement.amountLamports ?? '—'} lamports
                                                            </strong>
                                                            <span>{t('governance.resourceReadiness.squadsGrantProviderTransaction')}</span>
                                                            <strong>
                                                                {squadsProviderTrustReadback.grantSettlement.payoutSignature ?? '—'}
                                                            </strong>
                                                        </>}
                                                    </div>
                                                )}
                                                {squadsProviderBindingRequest && (
                                                    <div className={styles.governanceRisk} data-testid="squads-provider-binding-request-status">
                                                        {t('governance.resourceReadiness.bindingRequestCreated', {
                                                            request: squadsProviderBindingRequest.id,
                                                        })}
                                                        {squadsProviderBindingRequest.caseRef && (
                                                            <>
                                                                {' '}
                                                                <Link
                                                                    href={`/governance/cases/${encodeURIComponent(squadsProviderBindingRequest.caseRef)}`}
                                                                    data-testid="squads-provider-binding-open-case"
                                                                >
                                                                    {t('governance.resourceReadiness.bindingRequestOpenCase')}
                                                                </Link>
                                                            </>
                                                        )}
                                                    </div>
                                                )}
                                                {(squadsProviderTrustReadbackError || squadsProviderBindingRequestError) && (
                                                    <div className={styles.governanceRisk} data-testid="squads-provider-error">
                                                        {squadsProviderTrustReadbackError ?? squadsProviderBindingRequestError}
                                                    </div>
                                                )}
                                            </div>
                                            <div className={styles.governanceRisk}>
                                                {t('governance.resourceReadiness.businessLabelBoundary')}
                                            </div>
                                                </div>
                                            </details>
                                        </div>
                                    )}
                                    <Link
                                        className={styles.governanceReceiptLink}
                                        href={`/governance/moderation/${circleId}`}
                                        data-testid="circle-moderation-report-link"
                                    >
                                        {t('governance.moderationReports')}
                                    </Link>
                                    {canReadGovernedActionRouting && (
                                        <div
                                            className={styles.governanceEditor}
                                            data-testid="governed-action-routing-readback"
                                            data-governed-action-routing-state={governedActionRoutingLoading
                                                ? 'loading'
                                                : governedActionRoutingError ? 'error' : governedActionRouting ? 'ready' : 'unavailable'}
                                        >
                                            <div className={styles.toggleLabel}>{t('governance.routingReadback.title')}</div>
                                            <div className={styles.toggleDesc}>{t('governance.routingReadback.description')}</div>
                                            {governedActionRoutingLoading && (
                                                <div className={styles.toggleDesc}>{t('governance.routingReadback.loading')}</div>
                                            )}
                                            {governedActionRoutingError && (
                                                <div className={styles.governanceRisk}>{t('governance.routingReadback.error')}</div>
                                            )}
                                            {governedActionRouting && (() => {
                                                const metadataRouting = governedActionRouting.matrix.find((entry) => (
                                                    entry.actionType === 'circle.policy.metadata.update'
                                                ));
                                                const latestMetadataOperation = governedActionRouting.recentDirectOperations.find((entry) => (
                                                    entry.actionType === 'circle.policy.metadata.update'
                                                ));
                                                const highCriticalDirectCount = governedActionRouting.matrix.filter((entry) => (
                                                    (entry.impact === 'high' || entry.impact === 'critical')
                                                    && entry.currentPath === 'direct_operation'
                                                )).length;
                                                return (
                                                    <div className={styles.governanceMetaGrid}>
                                                        <span>{t('governance.routingReadback.registeredActions')}</span>
                                                        <strong>{governedActionRouting.matrix.length}</strong>
                                                        <span>{t('governance.routingReadback.metadataDefaultPath')}</span>
                                                        <strong>{metadataRouting
                                                            ? t(`governance.routingReadback.paths.${metadataRouting.defaultPath}`)
                                                            : t('governance.notAvailable')}</strong>
                                                        <span>{t('governance.routingReadback.metadataCurrentPath')}</span>
                                                        <strong data-governed-metadata-current-path={metadataRouting?.currentPath ?? 'unavailable'}>
                                                            {metadataRouting
                                                                ? t(`governance.routingReadback.paths.${metadataRouting.currentPath}`)
                                                                : t('governance.notAvailable')}
                                                        </strong>
                                                        <span>{t('governance.routingReadback.routingPolicy')}</span>
                                                        <strong data-governed-metadata-policy-version={metadataRouting?.routingPolicy?.policyVersion ?? 'none'}>
                                                            {metadataRouting?.routingPolicy
                                                                ? `${metadataRouting.routingPolicy.policyId} · v${metadataRouting.routingPolicy.policyVersion} · ${formatGovernanceTimestamp(metadataRouting.routingPolicy.effectiveAt)}`
                                                                : t('governance.routingReadback.noPolicy')}
                                                        </strong>
                                                        <span>{t('governance.routingReadback.highCriticalDirect')}</span>
                                                        <strong data-high-critical-direct-count={highCriticalDirectCount}>
                                                            {highCriticalDirectCount}
                                                        </strong>
                                                        <span>{t('governance.routingReadback.latestDirectReceipt')}</span>
                                                        {latestMetadataOperation ? (
                                                            <Link
                                                                className={styles.governanceReceiptLink}
                                                                data-governed-metadata-receipt={latestMetadataOperation.receipt.id}
                                                                href={`/governance/operations/${circleId}/${encodeURIComponent(latestMetadataOperation.receipt.id)}`}
                                                            >
                                                                {latestMetadataOperation.receipt.policyVersionRef} · {latestMetadataOperation.receipt.receiptDigest.slice(0, 12)}…
                                                            </Link>
                                                        ) : (
                                                            <strong data-governed-metadata-receipt="none">{t('governance.routingReadback.noReceipt')}</strong>
                                                        )}
                                                        <span>{t('governance.routingReadback.latestEffect')}</span>
                                                        <strong data-governed-metadata-effect={latestMetadataOperation?.effect.state ?? 'none'}>
                                                            {latestMetadataOperation
                                                                ? `${latestMetadataOperation.effect.state} · v${latestMetadataOperation.effect.stateVersion}`
                                                                : t('governance.routingReadback.noReceipt')}
                                                        </strong>
                                                    </div>
                                                );
                                            })()}
                                        </div>
                                    )}
                                    <div data-mandate-direction="target">
                                        <div className={styles.toggleLabel}>{t('governance.targetMandatesTitle')}</div>
                                        <div className={styles.toggleDesc}>{t('governance.targetMandatesDesc')}</div>
                                        {governanceCommittee.status === 'action_registry_resolved' && (
                                            <>
                                                <div className={styles.toggleLabel}>{t('governance.actionRegistryResolved')}</div>
                                                <div className={styles.toggleDesc}>{t('governance.actionRegistryResolvedDesc')}</div>
                                            </>
                                        )}
                                        {governanceCommittee.status === 'active_binding' && (
                                            <>
                                                <div className={styles.toggleLabel}>
                                                    {t('governance.activeBinding', {
                                                        committee: governanceCommittee.committeeCircleName || `#${governanceCommittee.committeeCircleId ?? '-'}`,
                                                    })}
                                                </div>
                                                <div className={styles.settingsSummaryInline}>
                                                    <span className={styles.settingsStatusBadge} data-tone="positive">
                                                        {t('status.active')}
                                                    </span>
                                                    <span>{governanceCommittee.actionScope || t('governance.allHighImpactActions')}</span>
                                                </div>
                                                <details className={styles.settingsDisclosure}>
                                                    <summary className={styles.settingsDisclosureSummary}>
                                                        <span>{t('details.showMandate')}</span>
                                                        <ChevronDown size={16} className={styles.settingsDisclosureChevron} aria-hidden="true" />
                                                    </summary>
                                                    <div className={styles.settingsDisclosureContent}>
                                                <div className={styles.governanceMetaGrid}>
                                                    <span>{t('governance.scopeLabel')}</span>
                                                    <strong>{governanceCommittee.actionScope || t('governance.allHighImpactActions')}</strong>
                                                    <span>{t('governance.ruleLabel')}</span>
                                                    <strong>{governanceCommittee.ruleId || 'committee.member_threshold'}</strong>
                                                    {governanceCommittee.bindingType === 'local_auxiliary' && (
                                                        <>
                                                            <span>{t('governance.authorityRelationshipLabel')}</span>
                                                            <strong data-governance-authority-relationship="parent-child">
                                                                {t('governance.localAuxiliaryAuthorityRelationship')}
                                                            </strong>
                                                        </>
                                                    )}
                                                    {governanceCommittee.eligibleCount != null && (
                                                        <>
                                                            <span>{t('governance.eligibleCountLabel')}</span>
                                                            <strong>{governanceCommittee.eligibleCount}</strong>
                                                        </>
                                                    )}
                                                    {governanceCommittee.mandateVersion != null && (
                                                        <>
                                                            <span>{t('governance.mandateVersionLabel')}</span>
                                                            <strong>v{governanceCommittee.mandateVersion}</strong>
                                                            <span>{t('governance.mandatePurposeLabel')}</span>
                                                            <strong>{governanceCommittee.mandatePurpose || t('governance.notAvailable')}</strong>
                                                            <span>{t('governance.mandateEnvironmentLabel')}</span>
                                                            <strong>{governanceCommittee.mandateEnvironment || t('governance.notAvailable')} / {governanceCommittee.mandateNetwork || t('governance.notAvailable')}</strong>
                                                            <span>{t('governance.mandateCanonicalStateLabel')}</span>
                                                            <strong>{governanceCommittee.mandateCanonicalState || t('governance.notAvailable')}</strong>
                                                            <span>{t('governance.mandateEffectiveUntilLabel')}</span>
                                                            <strong>{formatGovernanceTimestamp(governanceCommittee.mandateEffectiveUntil)}</strong>
                                                            <span>{t('governance.mandateAcceptanceExpiresAtLabel')}</span>
                                                            <strong>{formatGovernanceTimestamp(governanceCommittee.mandateAcceptanceExpiresAt)}</strong>
                                                        </>
                                                    )}
                                                    {governanceCommittee.authorityTransparency && (
                                                        <>
                                                            <span>{t('governance.authorityModeLabel')}</span>
                                                            <strong>{governanceCommittee.authorityTransparency.authorityMode} / {governanceCommittee.authorityTransparency.integrity}</strong>
                                                            <span>{t('governance.mandateDelegatorLabel')}</span>
                                                            <strong>{governanceCommittee.authorityTransparency.delegator.type}:{governanceCommittee.authorityTransparency.delegator.ref}</strong>
                                                            <span>{t('governance.mandateDelegateLabel')}</span>
                                                            <strong>{governanceCommittee.authorityTransparency.delegate.type}:{governanceCommittee.authorityTransparency.delegate.ref}</strong>
                                                            <span>{t('governance.mandateSubjectLabel')}</span>
                                                            <strong>{governanceCommittee.authorityTransparency.subject.type}:{governanceCommittee.authorityTransparency.subject.ref}</strong>
                                                            <span>{t('governance.decisionAuthorityLabel')}</span>
                                                            <strong>{String(governanceCommittee.authorityTransparency.decisionAuthority.type || t('governance.notAvailable'))}</strong>
                                                            <span>{t('governance.operatorAuthorityLabel')}</span>
                                                            <strong>{String(governanceCommittee.authorityTransparency.operatorAuthority.type || t('governance.notAvailable'))}</strong>
                                                            {governanceCommittee.authorityTransparency.operatorAuthority.selectorMode && (
                                                                <>
                                                                    <span>{t('governance.operatorSelectorLabel')}</span>
                                                                    <strong>
                                                                        {String(governanceCommittee.authorityTransparency.operatorAuthority.selectorMode)}
                                                                        {' · '}
                                                                        {String(governanceCommittee.authorityTransparency.operatorAuthority.frozenActorCount ?? 0)}
                                                                    </strong>
                                                                </>
                                                            )}
                                                            {governanceCommittee.authorityTransparency.operatorAuthority.reauthorization && (
                                                                <>
                                                                    <span>{t('governance.operatorReauthorizationLabel')}</span>
                                                                    <strong>{String((governanceCommittee.authorityTransparency.operatorAuthority.reauthorization as Record<string, unknown>).mode || t('governance.notAvailable'))}</strong>
                                                                </>
                                                            )}
                                                            {governanceCommittee.authorityTransparency.operatorAuthority.limits && (
                                                                <>
                                                                    <span>{t('governance.operatorPolicyLabel')}</span>
                                                                    <strong data-testid="operator-policy-readback">
                                                                        {JSON.stringify(governanceCommittee.authorityTransparency.operatorAuthority.limits)}
                                                                    </strong>
                                                                </>
                                                            )}
                                                            <span>{t('governance.executionAuthorityLabel')}</span>
                                                            <strong>{governanceCommittee.authorityTransparency.executionAuthority.adapter} / {governanceCommittee.authorityTransparency.executionAuthority.executor}</strong>
                                                            <span>{t('governance.stageProviderLabel')}</span>
                                                            <strong>{governanceCommittee.authorityTransparency.stageProvider.authority} / {governanceCommittee.authorityTransparency.stageProvider.status}</strong>
                                                            <span>{t('governance.authorityReceiptLabel')}</span>
                                                            <strong>{governanceCommittee.authorityTransparency.receipt.status} / {governanceCommittee.authorityTransparency.receipt.integrity}</strong>
                                                        </>
                                                    )}
                                                </div>
                                                    {governanceCommittee.mandateMinimumConstraints && (
                                                    <MandateMinimumReadback
                                                        constraints={governanceCommittee.mandateMinimumConstraints}
                                                        t={t}
                                                        className={styles.governanceMetaGrid}
                                                    />
                                                )}
                                                {governanceCommittee.mandateDisclosureImpact && (
                                                    <MandateDisclosureReadback
                                                        impact={governanceCommittee.mandateDisclosureImpact}
                                                        t={t}
                                                        className={styles.governanceMetaGrid}
                                                    />
                                                )}
                                                <div className={styles.governanceActions}>
                                                    <button
                                                        type="button"
                                                        className={styles.governanceSecondaryBtn}
                                                        onClick={() => void handleSupersedeActiveGovernanceMandate()}
                                                        disabled={!canManageGovernanceBindings
                                                            || !governanceCommittee.mandateId
                                                            || !onSupersedeActiveGovernanceMandate
                                                            || !disclosureDeclarationValid
                                                            || committeeProfileBusy}
                                                    >
                                                        {t('governance.proposeMandateSupersede')}
                                                    </button>
                                                    <button
                                                        type="button"
                                                        className={styles.governanceSecondaryBtn}
                                                        onClick={() => void handleDeactivateActiveGovernanceMandate()}
                                                        disabled={!canManageGovernanceBindings
                                                            || !governanceCommittee.bindingId
                                                            || !onDeactivateActiveGovernanceMandate
                                                            || committeeProfileBusy}
                                                    >
                                                        {t('governance.deactivateActiveMandate')}
                                                    </button>
                                                </div>
                                                    </div>
                                                </details>
                                            </>
                                        )}
                                        {governanceCommittee.status === 'pending_mandate' && (
                                            <>
                                                <div className={styles.toggleLabel}>{t('governance.pendingMandate')}</div>
                                                <div className={styles.toggleDesc}>{t('governance.pendingMandateDesc')}</div>
                                                {governanceCommittee.mandateMinimumConstraints && (
                                                    <MandateMinimumReadback
                                                        constraints={governanceCommittee.mandateMinimumConstraints}
                                                        t={t}
                                                        className={styles.governanceMetaGrid}
                                                    />
                                                )}
                                                {governanceCommittee.mandateDisclosureImpact && (
                                                    <MandateDisclosureReadback
                                                        impact={governanceCommittee.mandateDisclosureImpact}
                                                        t={t}
                                                        className={styles.governanceMetaGrid}
                                                    />
                                                )}
                                            </>
                                        )}
                                        {governanceCommittee.singlePersonCommittee && (
                                            <div className={styles.governanceRisk}>{t('governance.singlePersonRisk')}</div>
                                        )}
                                        <div
                                            className={styles.governanceEditor}
                                            data-governance-recovery-status={governanceRecovery?.status ?? 'not_configured'}
                                        >
                                            <div className={styles.settingsSummaryHeader}>
                                                <div>
                                                    <div className={styles.toggleLabel}>{t('governance.recoverySummary.title')}</div>
                                                    <div className={styles.settingsSummaryText}>
                                                        {governanceRecovery?.automaticRecoveryConfigured
                                                            ? t('governance.recoverySummary.configured')
                                                            : t('governance.recoverySummary.manualOnly')}
                                                    </div>
                                                </div>
                                                <span
                                                    className={styles.settingsStatusBadge}
                                                    data-tone={governanceRecovery?.authorityContinuity.status === 'healthy' ? 'positive' : 'warning'}
                                                >
                                                    {governanceRecovery?.authorityContinuity.status === 'healthy'
                                                        ? t('status.healthy')
                                                        : t('status.needsAttention')}
                                                </span>
                                            </div>
                                            <details className={styles.settingsDisclosure}>
                                                <summary className={styles.settingsDisclosureSummary}>
                                                    <span>{t('details.showRecovery')}</span>
                                                    <ChevronDown size={16} className={styles.settingsDisclosureChevron} aria-hidden="true" />
                                                </summary>
                                                <div className={styles.settingsDisclosureContent}>
                                            <div className={styles.toggleDesc}>
                                                {governanceRecovery?.warning
                                                    ?? t('governance.recoverySummary.warning')}
                                            </div>
                                            <div className={styles.governanceMetaGrid}>
                                                <span>Mode</span>
                                                <strong>{governanceRecovery?.mode ?? 'manual_recovery_only'}</strong>
                                                <span>Recovery Circle</span>
                                                <strong>{governanceRecovery?.recoveryCircleId ?? 'not configured'}</strong>
                                                <span>Recovery vote</span>
                                                <strong>frozen actors · minimum 2 · unanimity</strong>
                                                <span>Capability</span>
                                                <strong>single use · 1 hour · zero cost · no asset authority</strong>
                                                <span>Ratification</span>
                                                <strong>required within 24 hours</strong>
                                            </div>
                                            <div
                                                className={styles.governanceField}
                                                data-governance-authority-continuity-status={governanceRecovery?.authorityContinuity.status ?? 'not_applicable'}
                                            >
                                                <div className={styles.infoFieldHeader}>
                                                    <span className={styles.infoLabel}>Governance authority continuity</span>
                                                    <span className={styles.infoHint}>External signer loss requires P06 provider-native readback.</span>
                                                </div>
                                                <div className={styles.toggleDesc}>
                                                    {governanceRecovery?.authorityContinuity.warning
                                                        ?? 'Authority continuity is not available.'}
                                                </div>
                                                <div className={styles.governanceMetaGrid}>
                                                    <span>State</span>
                                                    <strong>{governanceRecovery?.authorityContinuity.status ?? 'not_applicable'}</strong>
                                                    <span>Canonical authority</span>
                                                    <strong>{governanceRecovery?.authorityContinuity.canonicalAuthority ?? 'not_applicable'}</strong>
                                                    <span>Fallback</span>
                                                    <strong>none · reporter gains no authority</strong>
                                                    <span>Evidence</span>
                                                    <strong>{governanceRecovery?.authorityContinuity.evidenceIntegrity ?? 'not_recorded'}</strong>
                                                    {governanceRecovery?.authorityContinuity.faultControls ? (
                                                        <>
                                                            <span>Fault / waiting</span>
                                                            <strong>{governanceRecovery.authorityContinuity.trigger} · until lawful authority restored</strong>
                                                            <span>Freeze / successor</span>
                                                            <strong>new governance frozen · prebound recovery or manual reconstitution</strong>
                                                            <span>Notification</span>
                                                            <strong>Circle managers and current members</strong>
                                                        </>
                                                    ) : null}
                                                </div>
                                                {governanceRecovery?.authorityContinuity.status === 'manual_recovery_pending' ? (
                                                    <>
                                                        <p className={styles.governanceRisk}>
                                                            Retry target preflight only after the existing canonical electorate is restored. If no lawful path exists, recording the terminal state does not grant authority to the reporter.
                                                        </p>
                                                        <button
                                                            type="button"
                                                            className={styles.governanceSecondaryBtn}
                                                            data-permanently-block-governance-authority
                                                            onClick={() => void handlePermanentlyBlockGovernanceAuthority()}
                                                            disabled={!canPermanentlyBlockGovernanceAuthority}
                                                        >
                                                            {recoveryPolicyBusy
                                                                ? 'Recording fail-closed state…'
                                                                : 'Record permanently blocked governance authority'}
                                                        </button>
                                                    </>
                                                ) : null}
                                            </div>
                                            <div
                                                className={styles.governanceField}
                                                data-governance-authority-health-status={governanceRecovery?.authorityHealth.status ?? 'not_checked'}
                                            >
                                                <div className={styles.infoFieldHeader}>
                                                    <span className={styles.infoLabel}>Governance authority health</span>
                                                    <span className={styles.infoHint}>Wallet-signed proof expires after 300 seconds.</span>
                                                </div>
                                                <div className={styles.toggleDesc}>
                                                    {governanceRecovery?.authorityHealth.warning ?? 'Authority health has not been checked.'}
                                                </div>
                                                <div className={styles.governanceMetaGrid}>
                                                    <span>Status</span>
                                                    <strong>{governanceRecovery?.authorityHealth.status ?? 'not_checked'}</strong>
                                                    <span>Committee proof</span>
                                                    <strong>{governanceRecovery?.authorityHealth.committeeSignedCount ?? 0}/{governanceRecovery?.authorityHealth.committeeEligibleCount ?? 0} · operator {governanceRecovery?.authorityHealth.operatorProof ?? 'not_checked'}</strong>
                                                    <span>High-risk gate</span>
                                                    <strong>{governanceRecovery?.authorityHealth.highRiskPlanGate ?? 'not_enforced_until_first_check'}</strong>
                                                    <span>Recovery panel proof</span>
                                                    <strong>{governanceRecovery?.authorityHealth.recoveryPanelStatus ?? 'not_checked'}</strong>
                                                    <span>Stale at</span>
                                                    <strong>{governanceRecovery?.authorityHealth.staleAt ?? 'not checked'}</strong>
                                                    <span>External authority</span>
                                                    <strong>P06 provider readback required</strong>
                                                    {governanceRecovery?.authorityHealth.faultAssessment ? (
                                                        <>
                                                            <span>Ratified fault</span>
                                                            <strong>{governanceRecovery.authorityHealth.faultAssessment.faultClass} · {governanceRecovery.authorityHealth.faultAssessment.affectedActorPubkey}</strong>
                                                            <span>Emergency freeze</span>
                                                            <strong>{governanceRecovery.authorityHealth.faultAssessment.emergencyFreeze.scope} · until {governanceRecovery.authorityHealth.faultAssessment.emergencyFreeze.freezeEndsAt}</strong>
                                                            <span>Actor / quorum</span>
                                                            <strong>{governanceRecovery.authorityHealth.faultAssessment.emergencyFreeze.actorQuorum.approvalThreshold}/{governanceRecovery.authorityHealth.faultAssessment.emergencyFreeze.actorQuorum.eligibleActorCount} · operator signature required</strong>
                                                            <span>Recovery / review</span>
                                                            <strong>new accepted wallet-signed health Case · mandatory review {governanceRecovery.authorityHealth.faultAssessment.emergencyFreeze.reviewStatus}</strong>
                                                            <span>Mutation boundary</span>
                                                            <strong>payload, authority and Decision override forbidden</strong>
                                                            <span>Resource pause</span>
                                                            <strong>P06 authority required · not claimed</strong>
                                                        </>
                                                    ) : null}
                                                    {continuityIncidentReadback ? (
                                                        <>
                                                            <span>Incident replacement</span>
                                                            <strong>{String(continuityIncidentReadback.previousBindingId || '-')} → {continuityIncidentBinding?.id}</strong>
                                                            <span>Actor rotation / review</span>
                                                            <strong>{String(continuityIncidentReadback.affectedActorPubkey || '-')} → {String(continuityIncidentReadback.replacementActorPubkey || '-')} · {String(continuityIncidentReadback.incidentReviewRef || '-')}</strong>
                                                            <span>Revoke / Provider boundary</span>
                                                            <strong>old Alcheme binding superseded · resource pause and external signer revoke require P06</strong>
                                                        </>
                                                    ) : null}
                                                </div>
                                                <div className={styles.governanceActions}>
                                                    <button
                                                        type="button"
                                                        className={styles.governanceSecondaryBtn}
                                                        data-open-governance-authority-health
                                                        onClick={() => void handleOpenAuthorityHealth()}
                                                        disabled={!canManageGovernanceBindings || !onOpenGovernanceAuthorityHealth || authorityHealthBusy}
                                                    >
                                                        {authorityHealthBusy ? 'Working…' : 'Open wallet-signed health Case'}
                                                    </button>
                                                    <button
                                                        type="button"
                                                        className={styles.governanceSecondaryBtn}
                                                        data-apply-governance-authority-health
                                                        onClick={() => void handleApplyAuthorityHealth()}
                                                        disabled={!acceptedAuthorityHealthRequest || !onApplyGovernanceAuthorityHealth || authorityHealthBusy}
                                                    >
                                                        Apply accepted health proof
                                                    </button>
                                                </div>
                                                <div className={styles.governanceMetaGrid} data-authority-fault-classification>
                                                    <label htmlFor="authority-fault-class">Fault class</label>
                                                    <select
                                                        id="authority-fault-class"
                                                        className={styles.governanceInput}
                                                        value={authorityFaultClass}
                                                        onChange={(event) => setAuthorityFaultClass(event.target.value as typeof authorityFaultClass)}
                                                    >
                                                        <option value="electorate_inactivity">electorate inactivity</option>
                                                        <option value="lost_key">lost key</option>
                                                        <option value="compromised_key">compromised key</option>
                                                    </select>
                                                    <label htmlFor="authority-fault-actor">Affected frozen actor</label>
                                                    <input id="authority-fault-actor" className={styles.governanceInput} value={authorityFaultActor} onChange={(event) => setAuthorityFaultActor(event.target.value)} />
                                                    <label htmlFor="authority-fault-evidence">Evidence reference</label>
                                                    <input id="authority-fault-evidence" className={styles.governanceInput} value={authorityFaultEvidenceRef} onChange={(event) => setAuthorityFaultEvidenceRef(event.target.value)} />
                                                    <label htmlFor="authority-fault-maximum">Freeze maximum hours</label>
                                                    <input id="authority-fault-maximum" className={styles.governanceInput} type="number" min={5 / 60} max={24} step={5 / 60} value={authorityFaultMaximumHours} onChange={(event) => setAuthorityFaultMaximumHours(Number(event.target.value))} />
                                                </div>
                                                <button
                                                    type="button"
                                                    className={styles.governanceSecondaryBtn}
                                                    data-open-governance-authority-fault
                                                    onClick={() => void handleOpenAuthorityHealth(true)}
                                                    disabled={!canManageGovernanceBindings || !onOpenGovernanceAuthorityHealth || authorityHealthBusy}
                                                >
                                                    Open governed fault classification Case
                                                </button>
                                                {authorityHealthError ? <div className={styles.ghostError}>{authorityHealthError}</div> : null}
                                            </div>
                                            <div
                                                className={styles.governanceField}
                                                data-resource-authority-recovery-status={governanceRecovery?.resourceAuthorityRecovery.status ?? 'not_configured'}
                                                data-resource-authority-recovery-provider-readback={governanceRecovery?.resourceAuthorityRecovery.verifiedProviderReadbackCount ?? 0}
                                                data-resource-authority-recovery-fallback={governanceRecovery?.resourceAuthorityRecovery.rotation.fallbackAuthority ?? 'none'}
                                            >
                                                <div className={styles.infoFieldHeader}>
                                                    <span className={styles.infoLabel}>Resource authority recovery</span>
                                                    <span className={styles.infoHint}>canonical resource authority and Provider readback; no Circle Owner/Admin fallback.</span>
                                                </div>
                                                <div className={styles.toggleDesc}>
                                                    P06 recovery preserves accepted artifacts, original obligations and residual risks until resource authority and Provider authoritative readback are verified.
                                                </div>
                                                <div className={styles.governanceMetaGrid}>
                                                    <span>Status</span>
                                                    <strong>{governanceRecovery?.resourceAuthorityRecovery.status ?? 'not_configured'}</strong>
                                                    <span>Resource bindings</span>
                                                    <strong>{governanceRecovery?.resourceAuthorityRecovery.resourceBindingCount ?? 0}</strong>
                                                    <span>Authority bindings</span>
                                                    <strong>{governanceRecovery?.resourceAuthorityRecovery.authorityBindingCount ?? 0}</strong>
                                                    <span>Provider readback</span>
                                                    <strong>{governanceRecovery?.resourceAuthorityRecovery.verifiedProviderReadbackCount ?? 0}/{governanceRecovery?.resourceAuthorityRecovery.resourceBindingCount ?? 0} finalized or verified</strong>
                                                    <span>Accepted artifacts</span>
                                                    <strong>{governanceRecovery?.resourceAuthorityRecovery.acceptedArtifacts.length ?? 0} preserved</strong>
                                                    <span>External signer revoke</span>
                                                    <strong>{governanceRecovery?.resourceAuthorityRecovery.rotation.externalSignerRevokeReadback ?? 'not_verified'} · Provider readback required</strong>
                                                    <span>Fallback</span>
                                                    <strong>none · no Circle Owner/Admin fallback</strong>
                                                    <span>Unfulfilled obligations</span>
                                                    <strong>{governanceRecovery?.resourceAuthorityRecovery.unfulfilledObligations.join(', ') || 'none'}</strong>
                                                    <span>Residual risks</span>
                                                    <strong>{governanceRecovery?.resourceAuthorityRecovery.residualRisks.join(', ') || 'none'}</strong>
                                                </div>
                                            </div>
                                            {!governanceRecovery?.automaticRecoveryConfigured && canManageGovernanceBindings ? (
                                                <div className={styles.governanceField}>
                                                    <div className={styles.infoFieldHeader}>
                                                        <span className={styles.infoLabel}>Existing independent Recovery Circle ID</span>
                                                        <span className={styles.infoHint}>No Circle is created or migrated automatically.</span>
                                                    </div>
                                                    <input
                                                        className={styles.governanceInput}
                                                        type="number"
                                                        min={1}
                                                        step={1}
                                                        value={recoveryCircleIdInput}
                                                        onChange={(event) => setRecoveryCircleIdInput(event.target.value)}
                                                        aria-label="Existing independent Recovery Circle ID"
                                                        disabled={!canCreateRecoveryPolicy}
                                                    />
                                                    <button
                                                        type="button"
                                                        className={styles.governanceSecondaryBtn}
                                                        data-propose-governance-recovery-policy
                                                        onClick={() => void handleCreateRecoveryPolicy()}
                                                        disabled={!canCreateRecoveryPolicy}
                                                    >
                                                        {recoveryPolicyBusy ? 'Opening governed Case…' : 'Propose Recovery Circle binding'}
                                                    </button>
                                                    {recoveryPolicyError ? <div className={styles.ghostError}>{recoveryPolicyError}</div> : null}
                                                </div>
                                            ) : null}
                                            {governanceRecovery?.automaticRecoveryConfigured && canManageGovernanceBindings ? (
                                                <div className={styles.governanceField}>
                                                    <div className={styles.infoFieldHeader}>
                                                        <span className={styles.infoLabel}>Recovery target committee Circle ID</span>
                                                        <span className={styles.infoHint}>Used only after the bound electorate is objectively empty.</span>
                                                    </div>
                                                    <input
                                                        className={styles.governanceInput}
                                                        type="number"
                                                        min={1}
                                                        step={1}
                                                        value={recoveryTargetCommitteeCircleIdInput}
                                                        onChange={(event) => setRecoveryTargetCommitteeCircleIdInput(event.target.value)}
                                                        aria-label="Recovery target committee Circle ID"
                                                    />
                                                </div>
                                            ) : null}
                                                </div>
                                            </details>
                                        </div>
                                    </div>
                                    <div className={styles.governanceDivider} />
                                    <div className={styles.governanceEditor} data-mandate-direction="committee">
                                        <div className={styles.toggleLabel}>{t('governance.committeeMandatesTitle')}</div>
                                        <div className={styles.toggleDesc}>{t('governance.committeeMandatesDesc')}</div>
                                        <div className={styles.toggleLabel}>{t('governance.committeeProfileTitle')}</div>
                                        <div className={styles.governanceMetaGrid}>
                                            <span>{t('governance.committeeProfileStatus')}</span>
                                            <strong>
                                                {committeeProfileLoading
                                                    ? t('governance.loading')
                                                    : committeeProfileEnabled
                                                        ? t('governance.committeeProfileEnabled')
                                                        : t('governance.committeeProfileDisabled')}
                                            </strong>
                                            <span>{t('governance.committeeProfileExpiry')}</span>
                                            <strong>{formatGovernanceTimestamp(committeeProfile?.availabilityExpiresAt)}</strong>
                                            <span>{t('governance.committeeProfileLastMandate')}</span>
                                            <strong>{committeeProfile?.lastMandateRequestId || t('governance.notAvailable')}</strong>
                                            {governanceCommitteeProp?.status === 'active_binding' && (
                                                <>
                                                    <span>{t('governance.activePolicyVersion')}</span>
                                                    <strong>v{governanceCommitteeProp.policyVersion ?? '-'}</strong>
                                                </>
                                            )}
                                        </div>
                                        {canManageGovernanceBindings && (
                                            <>
                                                <div className={styles.governanceField}>
                                                    <div className={styles.infoFieldHeader}>
                                                        <span className={styles.infoLabel}>{t('governance.committeeReceiveWindowDuration')}</span>
                                                        <span className={styles.infoHint}>{t('governance.receiveWindowOneRequest')}</span>
                                                    </div>
                                                    <Select<number>
                                                        ariaLabel={t('governance.committeeReceiveWindowDuration')}
                                                        value={committeeReceiveWindowMinutes}
                                                        options={committeeReceiveWindowDurationOptions}
                                                        onChange={setCommitteeReceiveWindowMinutes}
                                                        disabled={!canUpdateCommitteeAvailability}
                                                        className={styles.governanceSelect}
                                                    />
                                                </div>
                                                <div className={styles.governanceField}>
                                                    <div className={styles.infoFieldHeader}>
                                                        <span className={styles.infoLabel}>{t('governance.committeeQvBudgetLabel')}</span>
                                                        <span className={styles.infoHint}>{t('governance.committeeQvBudgetHint')}</span>
                                                    </div>
                                                    <input
                                                        className={styles.governanceInput}
                                                        type="number"
                                                        min={0}
                                                        max={1_000_000}
                                                        step={1}
                                                        value={committeeQuadraticVoiceBudget}
                                                        aria-label={t('governance.committeeQvBudgetLabel')}
                                                        onChange={(event) => setCommitteeQuadraticVoiceBudget(
                                                            Math.max(0, Math.floor(Number(event.target.value) || 0)),
                                                        )}
                                                        disabled={!canUpdateCommitteeAvailability}
                                                    />
                                                </div>
                                                <div className={styles.governanceField}>
                                                    <div className={styles.infoFieldHeader}>
                                                        <span className={styles.infoLabel}>{t('governance.committeeReceiveWindowScope')}</span>
                                                    </div>
                                                    <Select<GovernanceActionScopeValue>
                                                        ariaLabel={t('governance.committeeReceiveWindowScope')}
                                                        value={committeeReceiveWindowActionPrefix}
                                                        options={governanceActionScopeOptions}
                                                        onChange={setCommitteeReceiveWindowActionPrefix}
                                                        disabled={!canUpdateCommitteeAvailability}
                                                        className={styles.governanceSelect}
                                                    />
                                                </div>
                                                <div className={styles.governanceField}>
                                                    <div className={styles.infoFieldHeader}>
                                                        <span className={styles.infoLabel}>{t('governance.committeeThresholdLabel')}</span>
                                                        <span className={styles.infoHint}>{t('governance.committeeThresholdOwnedByCommittee')}</span>
                                                    </div>
                                                    <Select<CommitteeThresholdMode>
                                                        ariaLabel={t('governance.committeeThresholdLabel')}
                                                        value={committeeThresholdMode}
                                                        options={committeeThresholdOptions}
                                                        onChange={setCommitteeThresholdMode}
                                                        disabled={!canUpdateCommitteeAvailability}
                                                        className={styles.governanceSelect}
                                                    />
                                                    {committeeThresholdMode === 'fixed_count' && (
                                                        <input
                                                            className={styles.governanceInput}
                                                            type="number"
                                                            min={1}
                                                            step={1}
                                                            value={committeeFixedThreshold}
                                                            aria-label={t('governance.committeeFixedThresholdLabel')}
                                                            onChange={(event) => setCommitteeFixedThreshold(Math.max(1, Number(event.target.value) || 1))}
                                                            disabled={!canUpdateCommitteeAvailability}
                                                        />
                                                    )}
                                                    {governanceCommittee.mandateFeePolicy && (
                                                        <div className={styles.governanceMetaGrid}>
                                                            <span>{t('governance.mandateFeePolicyLabel')}</span>
                                                            <strong>
                                                                {governanceCommittee.mandateFeePolicy.mode}
                                                                {' · '}
                                                                {governanceCommittee.mandateFeePolicy.economicBearer}
                                                                {governanceCommittee.mandateFeePolicy.maximumAmountMinor
                                                                    ? ` · ${governanceCommittee.mandateFeePolicy.maximumAmountMinor} ${governanceCommittee.mandateFeePolicy.unit}`
                                                                    : ''}
                                                            </strong>
                                                        </div>
                                                    )}
                                                    {governanceCommittee.mandateEffectPolicy && (
                                                        <div className={styles.governanceMetaGrid}>
                                                            <span>{t('governance.mandateEffectPolicyLabel')}</span>
                                                            <strong>
                                                                {governanceCommittee.mandateEffectPolicy.revoke}
                                                                {' · '}
                                                                {governanceCommittee.mandateEffectPolicy.appealSurvival}
                                                                {' · '}
                                                                {governanceCommittee.mandateEffectPolicy.fallbackAuthority.type}:{governanceCommittee.mandateEffectPolicy.fallbackAuthority.ref}
                                                            </strong>
                                                        </div>
                                                    )}
                                                </div>
                                                <div className={styles.governanceField}>
                                                    <div className={styles.infoFieldHeader}>
                                                        <span className={styles.infoLabel}>{t('governance.committeeBallotDisclosureLabel')}</span>
                                                        <span className={styles.infoHint}>{t('governance.committeeBallotDisclosureHint')}</span>
                                                    </div>
                                                    <Select<CommitteeBallotDisclosureMode>
                                                        ariaLabel={t('governance.committeeBallotDisclosureLabel')}
                                                        value={committeeBallotDisclosureMode}
                                                        options={committeeBallotDisclosureOptions}
                                                        onChange={setCommitteeBallotDisclosureMode}
                                                        disabled={!canUpdateCommitteeAvailability}
                                                        className={styles.governanceSelect}
                                                    />
                                                </div>
                                                <div className={styles.governanceActions}>
                                                    <button
                                                        type="button"
                                                        className={styles.governanceSubmitBtn}
                                                        onClick={handleOpenCommitteeReceiveWindow}
                                                        disabled={!canUpdateCommitteeAvailability}
                                                    >
                                                        {t('governance.openCommitteeReceiveWindow')}
                                                    </button>
                                                    <button
                                                        type="button"
                                                        className={styles.governanceSecondaryBtn}
                                                        onClick={handleCloseCommitteeReceiveWindow}
                                                        disabled={!canUpdateCommitteeAvailability || !committeeProfileEnabled}
                                                    >
                                                        {t('governance.closeCommitteeReceiveWindow')}
                                                    </button>
                                                    {governanceCommitteeProp?.status === 'active_binding' && (
                                                        <button
                                                            type="button"
                                                            className={styles.governanceSecondaryBtn}
                                                            onClick={handleUpdateActiveGovernancePolicy}
                                                            disabled={!canUpdateActiveGovernancePolicy}
                                                        >
                                                            {t('governance.proposePolicyVersionUpdate')}
                                                        </button>
                                                    )}
                                                </div>
                                            </>
                                        )}
                                        {committeeProfileStatus?.state === 'requires_governance' && (
                                            <div className={styles.governanceRisk}>
                                                {t('governance.profileGovernanceRequired', {
                                                    requestId: committeeProfileStatus.requestId || '-',
                                                })}
                                            </div>
                                        )}
                                        {committeeProfileStatus?.state === 'executed' && (
                                            <div className={styles.sectionNotice}>{t('governance.profileExecuted')}</div>
                                        )}
                                        {committeeProfileStatus?.state === 'error' && (
                                            <div className={styles.ghostError}>
                                                {committeeProfileStatus.message || t('governance.profileFailed')}
                                            </div>
                                        )}
                                    </div>

                                    {canManageGovernanceBindings && (
                                        <div className={styles.governanceEditor} data-mandate-direction="target">
                                            <div className={styles.toggleLabel}>
                                                {committeeBindingType === 'self_governed'
                                                    ? t('governance.selfGovernedBindingTitle')
                                                    : t('governance.targetMandateRequestTitle')}
                                            </div>
                                            <div className={styles.toggleDesc}>
                                                {committeeBindingType === 'self_governed'
                                                    ? t('governance.selfGovernedBindingDesc')
                                                    : t('governance.targetMandateRequestDesc')}
                                            </div>
                                            <div className={styles.toggleDesc}>
                                                {committeeBindingType === 'local_auxiliary'
                                                    ? t('governance.localAuxiliaryChildRequired')
                                                    : committeeBindingType === 'self_governed'
                                                        ? t('governance.selfGovernedExactBindingRequired')
                                                        : t('governance.sharedCommitteeWindowRequired')}
                                            </div>
                                            {committeeBindingType !== 'self_governed' && (
                                            <div className={styles.governanceField} data-cross-circle-committee-field>
                                                <div className={styles.infoFieldHeader}>
                                                    <span className={styles.infoLabel}>{t('governance.committeeCircleId')}</span>
                                                </div>
                                                <input
                                                    className={styles.governanceInput}
                                                    type="number"
                                                    aria-label={t('governance.committeeCircleId')}
                                                    min={1}
                                                    value={committeeTargetCircleId}
                                                    onChange={(event) => setCommitteeTargetCircleId(event.target.value)}
                                                    disabled={!canCreateCommitteeBinding}
                                                />
                                            </div>
                                            )}
                                            <div className={styles.governanceField}>
                                                <div className={styles.infoFieldHeader}>
                                                    <span className={styles.infoLabel}>{t('governance.bindingTypeLabel')}</span>
                                                </div>
                                                <Select<GovernanceBindingTypeValue>
                                                    ariaLabel={t('governance.bindingTypeLabel')}
                                                    value={committeeBindingType}
                                                    options={governanceBindingTypeOptions}
                                                    onChange={(next) => {
                                                        setCommitteeBindingType(next);
                                                        if (next === 'self_governed') {
                                                            setCommitteeMandatePurposes(['collective_decision']);
                                                        }
                                                    }}
                                                    disabled={!canCreateCommitteeBinding}
                                                    className={styles.governanceSelect}
                                                />
                                            </div>
                                            <div className={styles.governanceField}>
                                                <div className={styles.infoFieldHeader}>
                                                    <span className={styles.infoLabel}>{t('governance.scopeLabel')}</span>
                                                </div>
                                                <Select<GovernanceActionScopeValue>
                                                    ariaLabel={t('governance.scopeLabel')}
                                                    value={displayedCommitteeBindingActionScope}
                                                    options={governanceActionScopeOptions}
                                                    onChange={(next) => {
                                                        setCommitteeBindingActionPrefix(next);
                                                        if (next === 'storage_fabric.authorize_provider_admission') {
                                                            setCommitteeExactActionType(
                                                                'storage_fabric.authorize_provider_admission',
                                                            );
                                                            setCommitteeExactSubjectType('external_provider');
                                                        }
                                                    }}
                                                    disabled={!canCreateCommitteeBinding
                                                        || (committeeBindingType === 'shared_committee'
                                                            && committeeMandateHasOperationalPurpose
                                                            && !usesExactActionBinding)}
                                                    className={styles.governanceSelect}
                                                />
                                            </div>
                                            <div className={styles.governanceField} data-exact-binding-fields>
                                                <div className={styles.infoFieldHeader}>
                                                    <label className={styles.infoLabel} htmlFor="governance-exact-action-type">
                                                        {t('governance.exactActionTypeLabel')}
                                                    </label>
                                                    <span className={styles.infoHint}>{t('governance.exactActionTypeHint')}</span>
                                                </div>
                                                <input
                                                    id="governance-exact-action-type"
                                                    className={styles.governanceInput}
                                                    aria-label={t('governance.exactActionTypeLabel')}
                                                    value={committeeExactActionType}
                                                    onChange={(event) => setCommitteeExactActionType(event.target.value)}
                                                    placeholder="storage_fabric.authorize_provider_admission"
                                                    disabled={!canCreateCommitteeBinding}
                                                />
                                                <label className={styles.infoLabel} htmlFor="governance-exact-subject-type">
                                                    {t('governance.exactSubjectTypeLabel')}
                                                </label>
                                                <input
                                                    id="governance-exact-subject-type"
                                                    className={styles.governanceInput}
                                                    aria-label={t('governance.exactSubjectTypeLabel')}
                                                    value={committeeExactSubjectType}
                                                    onChange={(event) => setCommitteeExactSubjectType(event.target.value)}
                                                    placeholder="external_provider"
                                                    disabled={!canCreateCommitteeBinding}
                                                />
                                                <label className={styles.infoLabel} htmlFor="governance-exact-subject-ref">
                                                    {t('governance.exactSubjectRefLabel')}
                                                </label>
                                                <input
                                                    id="governance-exact-subject-ref"
                                                    className={styles.governanceInput}
                                                    aria-label={t('governance.exactSubjectRefLabel')}
                                                    value={committeeExactSubjectRef}
                                                    onChange={(event) => setCommitteeExactSubjectRef(event.target.value)}
                                                    placeholder={String(circleId)}
                                                    disabled={!canCreateCommitteeBinding}
                                                />
                                                {committeeBindingType === 'self_governed' && (
                                                    <>
                                                        <span className={styles.infoLabel}>{t('governance.networkLabel')}</span>
                                                        <Select<'solana:localnet' | 'solana:devnet'>
                                                            ariaLabel={t('governance.networkLabel')}
                                                            value={committeeExactNetwork}
                                                            options={governanceNetworkOptions}
                                                            onChange={setCommitteeExactNetwork}
                                                            disabled={!canCreateCommitteeBinding}
                                                            className={styles.governanceSelect}
                                                        />
                                                        <div
                                                            className={styles.governanceRequestCard}
                                                            data-self-governed-authority-preset
                                                        >
                                                            <div className={styles.toggleLabel}>
                                                                {t('governance.selfGovernedAuthorityPresetTitle')}
                                                            </div>
                                                            <div className={styles.toggleDesc}>
                                                                {t('governance.selfGovernedAuthorityPresetDesc')}
                                                            </div>
                                                            <div className={styles.governanceMetaGrid}>
                                                                <span>{t('governance.selfGovernedAcceptanceWindowLabel')}</span>
                                                                <strong>{t('governance.selfGovernedDaysValue', {
                                                                    days: SELF_GOVERNED_AUTHORITY_PRESET.acceptanceDays,
                                                                })}</strong>
                                                                <span>{t('governance.selfGovernedEffectiveDurationLabel')}</span>
                                                                <strong>{t('governance.selfGovernedDaysValue', {
                                                                    days: SELF_GOVERNED_AUTHORITY_PRESET.durationDays,
                                                                })}</strong>
                                                                <span>{t('governance.selfGovernedMinimumApprovalsLabel')}</span>
                                                                <strong>{SELF_GOVERNED_AUTHORITY_PRESET.minimumApprovalThreshold}</strong>
                                                                <span>{t('governance.selfGovernedMinimumTimelockLabel')}</span>
                                                                <strong>{t('governance.selfGovernedHoursValue', {
                                                                    hours: SELF_GOVERNED_AUTHORITY_PRESET.minimumTimelockHours,
                                                                })}</strong>
                                                                <span>{t('governance.selfGovernedRiskLabel')}</span>
                                                                <strong>{t('governance.selfGovernedRiskFromAction')}</strong>
                                                            </div>
                                                        </div>
                                                    </>
                                                )}
                                            </div>
                                            {governanceRecovery?.authorityHealth.faultAssessment?.faultClass === 'compromised_key' && (
                                                <div className={styles.governanceField} data-compromised-key-binding-recovery>
                                                    <div className={styles.infoFieldHeader}>
                                                        <span className={styles.infoLabel}>Compromised-key governed replacement</span>
                                                        <span className={styles.infoHint}>The successor electorate must exclude the affected actor. This supersedes only the Alcheme binding; resource pause and external signer revoke still require P06 proof.</span>
                                                    </div>
                                                    <input
                                                        className={styles.governanceInput}
                                                        aria-label="Replacement frozen actor"
                                                        value={continuityReplacementActor}
                                                        onChange={(event) => setContinuityReplacementActor(event.target.value)}
                                                        placeholder="Replacement actor public key"
                                                        disabled={!canCreateCommitteeBinding}
                                                    />
                                                    <input
                                                        className={styles.governanceInput}
                                                        aria-label="Continuity incident review reference"
                                                        value={continuityIncidentReviewRef}
                                                        onChange={(event) => setContinuityIncidentReviewRef(event.target.value)}
                                                        placeholder="Incident review reference"
                                                        disabled={!canCreateCommitteeBinding}
                                                    />
                                                    <textarea
                                                        className={styles.governanceInput}
                                                        aria-label="Continuity incident review summary"
                                                        value={continuityIncidentReviewSummary}
                                                        onChange={(event) => setContinuityIncidentReviewSummary(event.target.value)}
                                                        placeholder="What changed, what remains blocked, and follow-up actions"
                                                        disabled={!canCreateCommitteeBinding}
                                                    />
                                                </div>
                                            )}
                                            {committeeBindingType === 'shared_committee' && (
                                                <>
                                                <div className={styles.governanceField}>
                                                    <div className={styles.infoFieldHeader}>
                                                        <span className={styles.infoLabel}>{t('governance.mandatePurposeLabel')}</span>
                                                        <span className={styles.infoHint}>{t('governance.mandatePurposeHint')}</span>
                                                    </div>
                                                    {governanceMandatePurposeOptions.map((option) => (
                                                        <label key={option.value} className={styles.toggleRow}>
                                                            <input
                                                                type="checkbox"
                                                                checked={committeeMandatePurposes.includes(option.value)}
                                                                onChange={(event) => setCommitteeMandatePurposes((current) => {
                                                                    if (event.target.checked) {
                                                                        return [...new Set([...current, option.value])];
                                                                    }
                                                                    return current.length === 1
                                                                        ? current
                                                                        : current.filter((purpose) => purpose !== option.value);
                                                                })}
                                                                disabled={!canCreateCommitteeBinding}
                                                            />
                                                            <span>{option.label}</span>
                                                        </label>
                                                    ))}
                                                </div>
                                                {committeeMandateHasOperationalPurpose && (
                                                    <div className={styles.governanceField} data-testid="operator-policy-editor">
                                                        <div className={styles.infoFieldHeader}>
                                                            <span className={styles.infoLabel}>{t('governance.operatorPolicyLabel')}</span>
                                                            <span className={styles.infoHint}>{t('governance.operatorPolicyHint')}</span>
                                                        </div>
                                                        {(['Owner', 'Admin', 'Moderator'] as const).map((role) => (
                                                            <label key={role} className={styles.toggleRow}>
                                                                <input
                                                                    type="checkbox"
                                                                    checked={committeeOperatorRoles.includes(role)}
                                                                    onChange={(event) => setCommitteeOperatorRoles((current) => {
                                                                        if (event.target.checked) return [...new Set([...current, role])];
                                                                        return current.length === 1 ? current : current.filter((value) => value !== role);
                                                                    })}
                                                                    disabled={!canCreateCommitteeBinding}
                                                                />
                                                                <span>{role}</span>
                                                            </label>
                                                        ))}
                                                        <label>{t('governance.operatorMaximumActorsLabel')}
                                                            <input className={styles.governanceInput} type="number" min={1} max={50} value={committeeOperatorMaximumActors} onChange={(event) => setCommitteeOperatorMaximumActors(Math.max(1, Math.min(50, Math.floor(Number(event.target.value) || 1))))} />
                                                        </label>
                                                        <label>{t('governance.operatorMaximumDurationLabel')}
                                                            <select className={styles.governanceInput} value={committeeOperatorMaximumDurationSeconds} onChange={(event) => setCommitteeOperatorMaximumDurationSeconds(Number(event.target.value))}>
                                                                <option value={900}>15m</option><option value={3600}>1h</option><option value={21600}>6h</option><option value={86400}>24h</option>
                                                            </select>
                                                        </label>
                                                        <label>{t('governance.operatorFrequencyLabel')}
                                                            <input className={styles.governanceInput} type="number" min={1} max={100} value={committeeOperatorMaximumInvocations} onChange={(event) => setCommitteeOperatorMaximumInvocations(Math.max(1, Math.min(100, Math.floor(Number(event.target.value) || 1))))} />
                                                        </label>
                                                        <label>{t('governance.operatorAppealWindowLabel')}
                                                            <select className={styles.governanceInput} value={committeeOperatorAppealWindowSeconds} onChange={(event) => setCommitteeOperatorAppealWindowSeconds(Number(event.target.value))}>
                                                                <option value={86400}>24h</option><option value={259200}>72h</option><option value={604800}>7d</option>
                                                            </select>
                                                        </label>
                                                        <p className={styles.toggleDesc}>{t('governance.operatorTargetScopeValue')}</p>
                                                    </div>
                                                )}
                                                <div className={styles.governanceField}>
                                                    <div className={styles.infoFieldHeader}>
                                                        <span className={styles.infoLabel}>{t('governance.mandateAcceptanceDaysLabel')}</span>
                                                        <span className={styles.infoHint}>{t('governance.mandateAcceptanceDaysHint')}</span>
                                                    </div>
                                                    <input
                                                        className={styles.governanceInput}
                                                        type="number"
                                                        aria-label={t('governance.mandateAcceptanceDaysLabel')}
                                                        min={1}
                                                        max={30}
                                                        step={1}
                                                        value={committeeMandateAcceptanceDays}
                                                        onChange={(event) => setCommitteeMandateAcceptanceDays(
                                                            Math.max(1, Math.min(30, Math.floor(Number(event.target.value) || 1))),
                                                        )}
                                                        disabled={!canCreateCommitteeBinding}
                                                    />
                                                </div>
                                                <div className={styles.governanceField}>
                                                    <div className={styles.infoFieldHeader}>
                                                        <span className={styles.infoLabel}>{t('governance.mandateDurationDaysLabel')}</span>
                                                        <span className={styles.infoHint}>{t('governance.mandateDurationDaysHint')}</span>
                                                    </div>
                                                    <input
                                                        className={styles.governanceInput}
                                                        type="number"
                                                        aria-label={t('governance.mandateDurationDaysLabel')}
                                                        min={1}
                                                        max={365}
                                                        step={1}
                                                        value={committeeMandateDurationDays}
                                                        onChange={(event) => setCommitteeMandateDurationDays(
                                                            Math.max(1, Math.min(365, Math.floor(Number(event.target.value) || 1))),
                                                        )}
                                                        disabled={!canCreateCommitteeBinding}
                                                    />
                                                </div>
                                                <div className={styles.governanceField}>
                                                    <div className={styles.infoFieldHeader}>
                                                        <span className={styles.infoLabel}>{t('governance.mandateMinimumRiskLabel')}</span>
                                                        <span className={styles.infoHint}>{t('governance.mandateMinimumRiskHint')}</span>
                                                    </div>
                                                    <Select<GovernanceMandateMinimumConstraints['riskFloor']>
                                                        ariaLabel={t('governance.mandateMinimumRiskLabel')}
                                                        value={committeeMandateRiskFloor}
                                                        options={mandateRiskFloorOptions}
                                                        onChange={setCommitteeMandateRiskFloor}
                                                        disabled={!canCreateCommitteeBinding}
                                                        className={styles.governanceSelect}
                                                    />
                                                </div>
                                                <div className={styles.governanceField}>
                                                    <div className={styles.infoFieldHeader}>
                                                        <span className={styles.infoLabel}>{t('governance.mandateMinimumQuorumLabel')}</span>
                                                        <span className={styles.infoHint}>{t('governance.mandateMinimumQuorumHint')}</span>
                                                    </div>
                                                    <input
                                                        className={styles.governanceInput}
                                                        type="number"
                                                        aria-label={t('governance.mandateMinimumQuorumLabel')}
                                                        min={1}
                                                        step={1}
                                                        value={committeeMandateMinimumApprovals}
                                                        onChange={(event) => setCommitteeMandateMinimumApprovals(
                                                            Math.max(1, Math.floor(Number(event.target.value) || 1)),
                                                        )}
                                                        disabled={!canCreateCommitteeBinding}
                                                    />
                                                </div>
                                                <div className={styles.governanceField}>
                                                    <div className={styles.infoFieldHeader}>
                                                        <span className={styles.infoLabel}>{t('governance.mandateMinimumTimelockLabel')}</span>
                                                        <span className={styles.infoHint}>{t('governance.mandateMinimumTimelockHint')}</span>
                                                    </div>
                                                    <input
                                                        className={styles.governanceInput}
                                                        type="number"
                                                        aria-label={t('governance.mandateMinimumTimelockLabel')}
                                                        min={0}
                                                        max={720}
                                                        step={1}
                                                        value={committeeMandateTimelockHours}
                                                        onChange={(event) => setCommitteeMandateTimelockHours(
                                                            Math.max(0, Math.min(720, Math.floor(Number(event.target.value) || 0))),
                                                        )}
                                                        disabled={!canCreateCommitteeBinding}
                                                    />
                                                </div>
                                                <div className={styles.governanceField}>
                                                    <div className={styles.infoFieldHeader}>
                                                        <span className={styles.infoLabel}>{t('governance.mandateFeePolicyLabel')}</span>
                                                        <span className={styles.infoHint}>{t('governance.mandateFeePolicyHint')}</span>
                                                    </div>
                                                    <select
                                                        className={styles.governanceInput}
                                                        aria-label={t('governance.mandateFeePolicyLabel')}
                                                        value={committeeMandateFeeMode}
                                                        onChange={(event) => setCommitteeMandateFeeMode(event.target.value as GovernanceMandateFeePolicy['mode'])}
                                                        disabled={!canCreateCommitteeBinding}
                                                    >
                                                        <option value="no_fee">{t('governance.mandateFeeModeNoFee')}</option>
                                                        <option value="capped_external_quote">{t('governance.mandateFeeModeCappedExternal')}</option>
                                                    </select>
                                                    <select
                                                        className={styles.governanceInput}
                                                        aria-label={t('governance.mandateEconomicBearerLabel')}
                                                        value={committeeMandateEconomicBearer}
                                                        onChange={(event) => setCommitteeMandateEconomicBearer(event.target.value as GovernanceMandateFeePolicy['economicBearer'])}
                                                        disabled={!canCreateCommitteeBinding}
                                                    >
                                                        <option value="delegator">{t('governance.mandateEconomicBearerDelegator')}</option>
                                                        <option value="delegate">{t('governance.mandateEconomicBearerDelegate')}</option>
                                                        <option value="shared">{t('governance.mandateEconomicBearerShared')}</option>
                                                    </select>
                                                    {committeeMandateFeeMode === 'capped_external_quote' && (
                                                        <>
                                                            <input
                                                                className={styles.governanceInput}
                                                                aria-label={t('governance.mandateMaximumFeeLabel')}
                                                                inputMode="numeric"
                                                                value={committeeMandateMaximumAmountMinor}
                                                                onChange={(event) => setCommitteeMandateMaximumAmountMinor(event.target.value.replace(/\D/g, '').slice(0, 30))}
                                                                disabled={!canCreateCommitteeBinding}
                                                            />
                                                            <input
                                                                className={styles.governanceInput}
                                                                aria-label={t('governance.mandateFeeUnitLabel')}
                                                                value={committeeMandateFeeUnit}
                                                                onChange={(event) => setCommitteeMandateFeeUnit(event.target.value.toUpperCase().replace(/[^A-Z0-9_]/g, '').slice(0, 16))}
                                                                disabled={!canCreateCommitteeBinding}
                                                            />
                                                        </>
                                                    )}
                                                </div>
                                                {committeeMandateHasOperationalPurpose && (
                                                    <div className={styles.governanceField}>
                                                        <div className={styles.infoFieldHeader}>
                                                            <span className={styles.infoLabel}>{t('governance.mandateEffectPolicyLabel')}</span>
                                                            <span className={styles.infoHint}>{t('governance.mandateEffectPolicyHint')}</span>
                                                        </div>
                                                        <span className={styles.infoHint}>
                                                            {t('governance.mandateEffectPolicyCurrent')}
                                                        </span>
                                                    </div>
                                                )}
                                                {circleType === 'Secret' && (
                                                    <div
                                                        className={styles.governanceField}
                                                        data-testid="private-home-mandate-disclosure-editor"
                                                    >
                                                        <div className={styles.infoFieldHeader}>
                                                            <span className={styles.infoLabel}>{t('governance.disclosureImpactTitle')}</span>
                                                            <span className={styles.infoHint}>{t('governance.disclosureImpactHint')}</span>
                                                        </div>
                                                        {([
                                                            'redacted_allegation',
                                                            'subject_reference',
                                                            'evidence_digest',
                                                            'operation_status',
                                                        ] as GovernanceDisclosureDataCategory[]).map((category) => (
                                                            <label key={category} className={styles.toggleRow}>
                                                                <input
                                                                    type="checkbox"
                                                                    checked={mandateDisclosureDataCategories.includes(category)}
                                                                    onChange={(event) => setMandateDisclosureDataCategories((current) => (
                                                                        event.target.checked
                                                                            ? [...new Set([...current, category])]
                                                                            : current.filter((value) => value !== category)
                                                                    ))}
                                                                    disabled={!canCreateCommitteeBinding}
                                                                />
                                                                <span>{t(`governance.disclosureCategory.${category}`)}</span>
                                                            </label>
                                                        ))}
                                                        <input
                                                            className={styles.governanceInput}
                                                            aria-label={t('governance.disclosureRegions')}
                                                            placeholder={t('governance.disclosureRegionsPlaceholder')}
                                                            value={mandateDisclosureRegions}
                                                            onChange={(event) => setMandateDisclosureRegions(event.target.value.toUpperCase())}
                                                            disabled={!canCreateCommitteeBinding}
                                                        />
                                                        <label>{t('governance.disclosureRetention')}
                                                            <input
                                                                className={styles.governanceInput}
                                                                type="number"
                                                                min={1}
                                                                max={3650}
                                                                value={mandateDisclosureRetentionDays}
                                                                onChange={(event) => setMandateDisclosureRetentionDays(
                                                                    Math.max(1, Math.min(3650, Math.floor(Number(event.target.value) || 1))),
                                                                )}
                                                                disabled={!canCreateCommitteeBinding}
                                                            />
                                                        </label>
                                                        <div className={styles.toggleDesc}>
                                                            {t('governance.disclosureFixedProtectionsValue')}
                                                        </div>
                                                    </div>
                                                )}
                                                </>
                                            )}
                                            <button
                                                type="button"
                                                className={styles.governanceSubmitBtn}
                                                onClick={handleCreateGovernanceBinding}
                                                disabled={
                                                    !canCreateCommitteeBinding
                                                    || (committeeBindingType !== 'self_governed'
                                                        && (!Number.isInteger(Number(committeeTargetCircleId))
                                                            || Number(committeeTargetCircleId) <= 0))
                                                    || (committeeBindingType === 'self_governed'
                                                        && (!resolvedExactActionType
                                                            || !committeeExactSubjectType.trim()
                                                            || !committeeExactSubjectRef.trim()))
                                                    || (committeeBindingType === 'shared_committee'
                                                        && committeeMandatePurposes.length === 0)
                                                    || (committeeBindingType === 'shared_committee'
                                                        && !disclosureDeclarationValid)
                                                    || (committeeBindingType === 'shared_committee'
                                                        && committeeMandateFeeMode === 'capped_external_quote'
                                                        && (!/^[1-9][0-9]{0,29}$/.test(committeeMandateMaximumAmountMinor)
                                                            || !/^[A-Z][A-Z0-9_]{1,15}$/.test(committeeMandateFeeUnit)))
                                                    || (governanceRecovery?.authorityHealth.faultAssessment?.faultClass === 'compromised_key'
                                                        && (!continuityReplacementActor.trim()
                                                            || !continuityIncidentReviewRef.trim()
                                                            || !continuityIncidentReviewSummary.trim()))
                                                }
                                            >
                                                {committeeBindingType === 'self_governed'
                                                    ? t('governance.createSelfGovernedBinding')
                                                    : t('governance.createGovernanceBinding')}
                                            </button>
                                            {governanceBindingSubmitError ? (
                                                <div className={styles.ghostError} role="alert">
                                                    {governanceBindingSubmitError}
                                                </div>
                                            ) : null}
                                        </div>
                                    )}

                                    <div className={styles.governanceEditor} data-mandate-direction="committee">
                                        <div className={styles.toggleLabel}>{t('governance.committeeInboxTitle')}</div>
                                        {committeeGovernanceBindings
                                            .filter((binding) => binding.status === 'rejected' && binding.mandate?.status === 'rejected')
                                            .map((binding) => (
                                                <div key={`counter:${binding.id}`} className={styles.governanceRequestCard}>
                                                    <div className={styles.toggleDesc}>
                                                        {t('governance.counterMandateSummary', {
                                                            targetCircleId: binding.targetCircleId,
                                                            version: binding.mandate?.currentVersion ?? 1,
                                                        })}
                                                    </div>
                                                    {binding.mandate?.minimumConstraints && (
                                                        <MandateMinimumReadback
                                                            constraints={binding.mandate.minimumConstraints}
                                                            t={t}
                                                            className={styles.governanceMetaGrid}
                                                        />
                                                    )}
                                                    {binding.mandate?.crossInstitutionDisclosureImpact && (
                                                        <MandateDisclosureReadback
                                                            impact={binding.mandate.crossInstitutionDisclosureImpact}
                                                            t={t}
                                                            className={styles.governanceMetaGrid}
                                                        />
                                                    )}
                                                    <button
                                                        type="button"
                                                        className={styles.governanceSecondaryBtn}
                                                        onClick={() => void handleCounterGovernanceMandate(binding)}
                                                        disabled={!canManageGovernanceBindings || !onCounterGovernanceMandate}
                                                    >
                                                        {t('governance.proposeMandateCounter')}
                                                    </button>
                                                </div>
                                            ))}
                                        {targetGovernanceBindings
                                            .filter((binding) => binding.mandate?.status === 'countered'
                                                && binding.targetAuthorizationStatus === 'pending')
                                            .map((binding) => (
                                                <div key={`accept-counter:${binding.id}`} className={styles.governanceRequestCard}>
                                                    <div className={styles.toggleDesc}>
                                                        {t('governance.acceptCounterSummary', {
                                                            version: binding.mandate?.currentVersion ?? 1,
                                                        })}
                                                    </div>
                                                    {binding.mandate?.minimumConstraints && (
                                                        <MandateMinimumReadback
                                                            constraints={binding.mandate.minimumConstraints}
                                                            t={t}
                                                            className={styles.governanceMetaGrid}
                                                        />
                                                    )}
                                                    {binding.mandate?.crossInstitutionDisclosureImpact && (
                                                        <MandateDisclosureReadback
                                                            impact={binding.mandate.crossInstitutionDisclosureImpact}
                                                            t={t}
                                                            className={styles.governanceMetaGrid}
                                                        />
                                                    )}
                                                    <button
                                                        type="button"
                                                        className={styles.governanceSubmitBtn}
                                                        onClick={() => void onAcceptGovernanceMandateCounter?.(binding)}
                                                        disabled={!canManageGovernanceBindings || !onAcceptGovernanceMandateCounter}
                                                    >
                                                        {t('governance.acceptMandateCounter')}
                                                    </button>
                                                </div>
                                            ))}
                                        {committeeGovernanceRequestsLoading && (
                                            <div className={styles.toggleDesc}>{t('governance.loading')}</div>
                                        )}
                                        {!committeeGovernanceRequestsLoading && committeeInboxRequests.length === 0 && (
                                            <div className={styles.toggleDesc}>{t('governance.committeeInboxEmpty')}</div>
                                        )}
                                        {committeeInboxRequests.map((request) => {
                                            const isMandateRequest = request.actionType === 'circle.governance_binding.accept_mandate';
                                            const isPolicyVersionRequest = request.actionType === 'circle.governance_binding.policy_version.update';
                                            const approveKey = `${request.id}:approve`;
                                            const rejectKey = `${request.id}:reject`;
                                            const requestSignalBusy = committeeGovernanceSignalActionKey?.startsWith(`${request.id}:`) ?? false;
                                            const requestBinding = isMandateRequest
                                                ? committeeGovernanceBindings.find((binding) => binding.id === request.targetRef)
                                                : null;
                                            const targetCounterAcceptancePending = requestBinding?.mandate?.status === 'countered'
                                                && requestBinding.targetAuthorizationStatus !== 'accepted';
                                            const mandateCaseHref = isMandateRequest && request.caseRef
                                                ? `/governance/cases/${encodeURIComponent(request.caseRef)}?from=committee-inbox#case-responsibility-review`
                                                : null;
                                            const mandateExpiry = request.expiresAt
                                                && Number.isFinite(Date.parse(request.expiresAt))
                                                ? new Date(request.expiresAt).toLocaleString()
                                                : null;
                                            const mandateDeniedReason = !isMandateRequest
                                                ? null
                                                : request.state === 'expired'
                                                    ? 'mandate_expired'
                                                    : !mandateCaseHref
                                                        ? 'canonical_case_unavailable'
                                                        : null;
                                            const canSubmitSignal = (isMandateRequest || isPolicyVersionRequest)
                                                && request.state === 'active'
                                                && !targetCounterAcceptancePending
                                                && Boolean(onSubmitGovernanceSignal);
                                            return (
                                                <div key={request.id} className={styles.governanceRequestItem}>
                                                    <div className={styles.governanceMetaGrid}>
                                                        {isMandateRequest ? (
                                                            <>
                                                                <span>{t('governance.requestTargetCircle')}</span>
                                                                <strong>{getRequestPayloadText(request, 'targetCircleId')}</strong>
                                                                <span>{t('governance.requestBindingId')}</span>
                                                                <strong>{getRequestPayloadText(request, 'bindingId')}</strong>
                                                                <span>{t('governance.scopeLabel')}</span>
                                                                <strong>{getRequestPayloadText(request, 'actionScope')}</strong>
                                                            </>
                                                        ) : (
                                                            <>
                                                                <span>{t('governance.requestAction')}</span>
                                                                <strong>{request.actionType}</strong>
                                                                <span>{t('governance.requestTarget')}</span>
                                                                <strong>{request.targetType}:{request.targetRef}</strong>
                                                            </>
                                                        )}
                                                        <span>{t('governance.requestState')}</span>
                                                        <strong>{request.state}</strong>
                                                        <span>{t('governance.decisionStatus')}</span>
                                                        <strong>{request.decisionStatus}</strong>
                                                        <span>{t('governance.executionStatus')}</span>
                                                        <strong>{request.executionStatus}</strong>
                                                        {isMandateRequest && mandateExpiry && (
                                                            <>
                                                                <span>{t('governance.committeeMandateExpiresAt')}</span>
                                                                <strong>{mandateExpiry}</strong>
                                                            </>
                                                        )}
                                                        {isPolicyVersionRequest && (
                                                            <>
                                                                <span>{t('governance.currentPolicyVersion')}</span>
                                                                <strong>v{getRequestPayloadText(request, 'currentPolicyVersion')}</strong>
                                                                <span>{t('governance.proposedPolicyDigest')}</span>
                                                                <strong>{getRequestPayloadText(request, 'proposedConfigDigest')}</strong>
                                                            </>
                                                        )}
                                                        {request.executionCompatibility && (
                                                            <>
                                                                <span>{t('governance.legacyExecution')}</span>
                                                                <strong>{request.executionCompatibility.status}</strong>
                                                                <span>{t('governance.executionAdapter')}</span>
                                                                <strong>{request.executionCompatibility.adapter}</strong>
                                                                <span>{t('governance.actionRisk')}</span>
                                                                <strong>{request.executionCompatibility.risk}</strong>
                                                                <span>{t('governance.migrationTarget')}</span>
                                                                <strong>{request.executionCompatibility.migrationTarget}</strong>
                                                            </>
                                                        )}
                                                    </div>
                                                    {mandateCaseHref && (
                                                        <Link
                                                            href={mandateCaseHref}
                                                            className={styles.governanceSecondaryBtn}
                                                            data-committee-mandate-case-ref={request.caseRef}
                                                        >
                                                            {t('governance.committeeMandateCaseAction')}
                                                        </Link>
                                                    )}
                                                    {mandateDeniedReason && (
                                                        <div
                                                            className={styles.governanceRisk}
                                                            role="status"
                                                            data-committee-mandate-denied={mandateDeniedReason}
                                                        >
                                                            {mandateDeniedReason === 'mandate_expired'
                                                                ? t('governance.committeeMandateExpired')
                                                                : t('governance.committeeMandateCaseUnavailable')}
                                                        </div>
                                                    )}
                                                    {targetCounterAcceptancePending && (
                                                        <div className={styles.governanceRisk}>
                                                            {t('governance.counterWaitingForTarget')}
                                                        </div>
                                                    )}
                                                    {canSubmitSignal && (
                                                        <div className={styles.governanceActions}>
                                                            <button
                                                                type="button"
                                                                className={styles.governanceSubmitBtn}
                                                                onClick={() => { void handleApproveGovernanceRequest(request); }}
                                                                disabled={requestSignalBusy}
                                                            >
                                                                {committeeGovernanceSignalActionKey === approveKey
                                                                    ? t('actions.saving')
                                                                    : isMandateRequest
                                                                        ? t('governance.approveMandate')
                                                                        : t('governance.approveRequest')}
                                                            </button>
                                                            <button
                                                                type="button"
                                                                className={styles.governanceSecondaryBtn}
                                                                onClick={() => { void handleRejectGovernanceRequest(request); }}
                                                                disabled={requestSignalBusy}
                                                            >
                                                                {committeeGovernanceSignalActionKey === rejectKey
                                                                    ? t('actions.saving')
                                                                    : isMandateRequest
                                                                        ? t('governance.rejectMandate')
                                                                        : t('governance.rejectRequest')}
                                                            </button>
                                                        </div>
                                                    )}
                                                </div>
                                            );
                                        })}
                                        {committeeGovernanceSignalError && (
                                            <div className={styles.ghostError}>{committeeGovernanceSignalError}</div>
                                        )}
                                    </div>
                                </div>
                            </div>

                            <div ref={contentSectionRef} className={styles.settingsGroupHeading} data-settings-group="content">
                                <span>{t('groups.content.title')}</span>
                                <small>{t('groups.content.description')}</small>
                            </div>

                            {identityRules && (
                                <div className={styles.section}>
                                    <button
                                        type="button"
                                        className={styles.identityRulesToggle}
                                        aria-expanded={identityRulesExpanded}
                                        onClick={() => setIdentityRulesExpanded((prev) => !prev)}
                                    >
                                        <span className={styles.identityRulesToggleTitle}>{t('identityRules.title')}</span>
                                        <span className={styles.identityRulesToggleAction}>
                                            {identityRulesExpanded ? t('common.collapse') : t('common.expand')}
                                            <ChevronDown
                                                size={14}
                                                className={`${styles.identityRulesToggleChevron} ${identityRulesExpanded ? styles.identityRulesToggleChevronExpanded : ''}`}
                                            />
                                        </span>
                                    </button>
                                    {identityRulesExpanded && (
                                        <div className={styles.identityRulesCard}>
                                            <p className={styles.identityRulesLead}>
                                                {t('identityRules.lead')}
                                            </p>
                                            <div className={styles.identityRuleItem}>
                                                <span className={styles.identityRuleStep}>{t('identityRules.initiateStep')}</span>
                                                <p className={styles.identityRuleText}>
                                                    {t('identityRules.initiateText', { count: identityRules.initiateMessages })}
                                                </p>
                                            </div>
                                            <div className={styles.identityRuleItem}>
                                                <span className={styles.identityRuleStep}>{t('identityRules.memberStep')}</span>
                                                <p className={styles.identityRuleText}>
                                                    {t('identityRules.memberText', { count: identityRules.memberCitations })}
                                                </p>
                                            </div>
                                            <div className={styles.identityRuleItem}>
                                                <span className={styles.identityRuleStep}>{t('identityRules.elderStep')}</span>
                                                <p className={styles.identityRuleText}>
                                                    {t('identityRules.elderText', { percentile: identityRules.elderPercentile })}
                                                </p>
                                            </div>
                                            <p className={styles.identityRulesFootnote}>
                                                {t('identityRules.footnote', { count: identityRules.inactivityDays })}
                                            </p>
                                        </div>
                                    )}
                                </div>
                            )}

                            {circleMode === 'knowledge' && (
                                <div
                                    className={styles.section}
                                    data-circle-draft-prompt-settings
                                    data-testid="circle-draft-prompt-settings"
                                >
                                    <button
                                        type="button"
                                        className={styles.identityRulesToggle}
                                        aria-expanded={draftPromptExpanded}
                                        onClick={() => setDraftPromptExpanded((prev) => !prev)}
                                    >
                                        <span className={styles.identityRulesToggleTitle}>{t('draftPrompt.title')}</span>
                                        <span className={styles.identityRulesToggleAction}>
                                            {draftPromptExpanded ? t('common.collapse') : t('common.expand')}
                                            <ChevronDown
                                                size={14}
                                                className={`${styles.identityRulesToggleChevron} ${draftPromptExpanded ? styles.identityRulesToggleChevronExpanded : ''}`}
                                            />
                                        </span>
                                    </button>
                                    {draftPromptExpanded && (
                                        <div className={styles.identityRulesCard}>
                                            <p className={styles.identityRulesLead}>{t('draftPrompt.description')}</p>
                                            <p className={styles.workflowModeHelp}>{t('draftPrompt.privacyNotice')}</p>
                                            {draftPromptLoading ? (
                                                <div className={styles.ghostLoading}>{t('draftPrompt.loading')}</div>
                                            ) : (
                                                <>
                                                    <div
                                                        className={styles.infoField}
                                                        data-testid="knowledge-draft-prompt-readback"
                                                        data-draft-prompt-mode={knowledgeDraftPrompt?.mode ?? 'unavailable'}
                                                        data-draft-prompt-version={knowledgeDraftPrompt?.activeVersion?.version ?? 0}
                                                    >
                                                        <div className={styles.infoFieldHeader}>
                                                            <span className={styles.infoLabel}>{t('draftPrompt.knowledgeTitle')}</span>
                                                            <span className={styles.infoHint}>
                                                                {knowledgeDraftPrompt?.mode === 'circle_custom'
                                                                    ? t('draftPrompt.circleCustom')
                                                                    : t('draftPrompt.systemDefault')}
                                                            </span>
                                                        </div>
                                                        {knowledgeDraftPrompt && (
                                                            <div className={styles.ghostSourceHint}>
                                                                {t('draftPrompt.systemVersion')}: {knowledgeDraftPrompt.systemPromptVersion}
                                                                {' · '}{t('draftPrompt.schema')}: {knowledgeDraftPrompt.schemaRef}
                                                                {knowledgeDraftPrompt.activeVersion && (
                                                                    <>
                                                                        <br />
                                                                        {t('draftPrompt.activeVersion')}: {knowledgeDraftPrompt.activeVersion.version}
                                                                        {' · '}{t('draftPrompt.digest')}: {knowledgeDraftPrompt.activeVersion.promptDigest}
                                                                        {' · '}{t('draftPrompt.keyVersion')}: {knowledgeDraftPrompt.activeVersion.keyVersion}
                                                                    </>
                                                                )}
                                                                {knowledgeDraftPrompt.currentSelectionApprovalRef && (
                                                                    <>
                                                                        <br />
                                                                        {t('draftPrompt.approval')}: {knowledgeDraftPrompt.currentSelectionApprovalRef}
                                                                    </>
                                                                )}
                                                                {knowledgeDraftPrompt.currentSelectionApprovedByPubkey && (
                                                                    <>
                                                                        <br />
                                                                        {t('draftPrompt.approvedBy')}: {knowledgeDraftPrompt.currentSelectionApprovedByPubkey}
                                                                    </>
                                                                )}
                                                                <br />
                                                                {t('draftPrompt.providerBoundary')}: {knowledgeDraftPrompt.providerBoundary.mode}
                                                                {' / '}{knowledgeDraftPrompt.providerBoundary.runtimeRole}
                                                                {' / '}{knowledgeDraftPrompt.providerBoundary.externalPrivateContentMode}
                                                                <br />
                                                                {t('draftPrompt.history')}: {knowledgeDraftPrompt.history.length}
                                                                {' · '}{t('draftPrompt.selectionHistory')}: {knowledgeDraftPrompt.selectionHistory.length}
                                                                {' · '}{t('draftPrompt.decryptAudit')}: {knowledgeDraftPrompt.recentDecryptAudit.length}
                                                            </div>
                                                        )}
                                                        <label className={styles.infoFieldHeader} htmlFor="knowledge-draft-prompt-body">
                                                            <span className={styles.infoLabel}>{t('draftPrompt.editorLabel')}</span>
                                                        </label>
                                                        <textarea
                                                            id="knowledge-draft-prompt-body"
                                                            className={styles.governanceInput}
                                                            value={knowledgeDraftPromptBody}
                                                            onChange={(event) => setKnowledgeDraftPromptBody(event.target.value)}
                                                            placeholder={t('draftPrompt.editorPlaceholder')}
                                                            maxLength={12000}
                                                            rows={7}
                                                            disabled={!canEditDraftPrompt || draftPromptSaving}
                                                        />
                                                        {draftPromptError && (
                                                            <div className={styles.ghostError}>{draftPromptError}</div>
                                                        )}
                                                        <button
                                                            type="button"
                                                            className={styles.ghostSaveBtn}
                                                            disabled={!canEditDraftPrompt || !knowledgeDraftPrompt || draftPromptSaving || !knowledgeDraftPromptBody.trim()}
                                                            onClick={() => void onSaveDraftPrompt?.({
                                                                scope: 'knowledge_draft',
                                                                mode: 'circle_custom',
                                                                promptBody: knowledgeDraftPromptBody,
                                                            })}
                                                        >
                                                            {draftPromptSaving ? t('draftPrompt.saving') : t('draftPrompt.activate')}
                                                        </button>
                                                        {knowledgeDraftPrompt?.mode === 'circle_custom' && (
                                                            <button
                                                                type="button"
                                                                className={styles.ghostSaveBtn}
                                                                disabled={!canEditDraftPrompt || !knowledgeDraftPrompt || draftPromptSaving}
                                                                onClick={() => void onSaveDraftPrompt?.({
                                                                    scope: 'knowledge_draft',
                                                                    mode: 'system_default',
                                                                })}
                                                            >
                                                                {t('draftPrompt.restore')}
                                                            </button>
                                                        )}
                                                        {knowledgeDraftPrompt?.history.map((version) => (
                                                            <button
                                                                key={version.id}
                                                                type="button"
                                                                className={styles.ghostSaveBtn}
                                                                disabled={!canEditDraftPrompt || draftPromptSaving || knowledgeDraftPrompt.activeVersion?.id === version.id}
                                                                onClick={() => void onSaveDraftPrompt?.({
                                                                    scope: 'knowledge_draft',
                                                                    mode: 'circle_custom',
                                                                    version: version.version,
                                                                    promptDigest: version.promptDigest,
                                                                })}
                                                            >
                                                                {t('draftPrompt.selectVersion')} {version.version}
                                                            </button>
                                                        ))}
                                                    </div>
                                                    <div
                                                        className={styles.infoField}
                                                        data-testid="governance-draft-prompt-readback"
                                                        data-draft-prompt-mode={governanceDraftPrompt?.mode ?? 'unavailable'}
                                                        data-draft-prompt-version={governanceDraftPrompt?.activeVersion?.version ?? 0}
                                                    >
                                                        <div className={styles.infoFieldHeader}>
                                                            <span className={styles.infoLabel}>{t('draftPrompt.governanceTitle')}</span>
                                                            <span className={styles.infoHint}>
                                                                {governanceDraftPrompt?.mode === 'circle_custom'
                                                                    ? t('draftPrompt.circleCustom')
                                                                    : t('draftPrompt.systemDefault')}
                                                            </span>
                                                        </div>
                                                        {governanceDraftPrompt && (
                                                            <div className={styles.ghostSourceHint}>
                                                                {t('draftPrompt.systemVersion')}: {governanceDraftPrompt.systemPromptVersion}
                                                                {' · '}{t('draftPrompt.schema')}: {governanceDraftPrompt.schemaRef}
                                                                {governanceDraftPrompt.activeVersion && (
                                                                    <>
                                                                        <br />
                                                                        {t('draftPrompt.activeVersion')}: {governanceDraftPrompt.activeVersion.version}
                                                                        {' · '}{t('draftPrompt.digest')}: {governanceDraftPrompt.activeVersion.promptDigest}
                                                                        {' · '}{t('draftPrompt.keyVersion')}: {governanceDraftPrompt.activeVersion.keyVersion}
                                                                    </>
                                                                )}
                                                                {governanceDraftPrompt.currentSelectionApprovalRef && (
                                                                    <>
                                                                        <br />
                                                                        {t('draftPrompt.approval')}: {governanceDraftPrompt.currentSelectionApprovalRef}
                                                                    </>
                                                                )}
                                                                {governanceDraftPrompt.currentSelectionApprovedByPubkey && (
                                                                    <>
                                                                        <br />
                                                                        {t('draftPrompt.approvedBy')}: {governanceDraftPrompt.currentSelectionApprovedByPubkey}
                                                                    </>
                                                                )}
                                                                <br />
                                                                {t('draftPrompt.providerBoundary')}: {governanceDraftPrompt.providerBoundary.mode}
                                                                {' / '}{governanceDraftPrompt.providerBoundary.runtimeRole}
                                                                {' / '}{governanceDraftPrompt.providerBoundary.externalPrivateContentMode}
                                                                <br />
                                                                {t('draftPrompt.history')}: {governanceDraftPrompt.history.length}
                                                                {' · '}{t('draftPrompt.selectionHistory')}: {governanceDraftPrompt.selectionHistory.length}
                                                                {' · '}{t('draftPrompt.decryptAudit')}: {governanceDraftPrompt.recentDecryptAudit.length}
                                                            </div>
                                                        )}
                                                        <label className={styles.infoFieldHeader} htmlFor="governance-draft-prompt-body">
                                                            <span className={styles.infoLabel}>{t('draftPrompt.editorLabel')}</span>
                                                        </label>
                                                        <textarea
                                                            id="governance-draft-prompt-body"
                                                            className={styles.governanceInput}
                                                            value={governanceDraftPromptBody}
                                                            onChange={(event) => setGovernanceDraftPromptBody(event.target.value)}
                                                            placeholder={t('draftPrompt.editorPlaceholder')}
                                                            maxLength={12000}
                                                            rows={7}
                                                            disabled={!canEditDraftPrompt || !governanceDraftPrompt || draftPromptSaving}
                                                        />
                                                        <button
                                                            type="button"
                                                            className={styles.ghostSaveBtn}
                                                            disabled={!canEditDraftPrompt || !governanceDraftPrompt || draftPromptSaving || !governanceDraftPromptBody.trim()}
                                                            onClick={() => void onSaveDraftPrompt?.({
                                                                scope: 'governance_draft',
                                                                mode: 'circle_custom',
                                                                promptBody: governanceDraftPromptBody,
                                                            })}
                                                        >
                                                            {draftPromptSaving ? t('draftPrompt.saving') : t('draftPrompt.activate')}
                                                        </button>
                                                        {governanceDraftPrompt?.mode === 'circle_custom' && (
                                                            <button
                                                                type="button"
                                                                className={styles.ghostSaveBtn}
                                                                disabled={!canEditDraftPrompt || draftPromptSaving}
                                                                onClick={() => void onSaveDraftPrompt?.({
                                                                    scope: 'governance_draft',
                                                                    mode: 'system_default',
                                                                })}
                                                            >
                                                                {t('draftPrompt.restore')}
                                                            </button>
                                                        )}
                                                        {governanceDraftPrompt?.history.map((version) => (
                                                            <button
                                                                key={version.id}
                                                                type="button"
                                                                className={styles.ghostSaveBtn}
                                                                disabled={!canEditDraftPrompt || draftPromptSaving || governanceDraftPrompt.activeVersion?.id === version.id}
                                                                onClick={() => void onSaveDraftPrompt?.({
                                                                    scope: 'governance_draft',
                                                                    mode: 'circle_custom',
                                                                    version: version.version,
                                                                    promptDigest: version.promptDigest,
                                                                })}
                                                            >
                                                                {t('draftPrompt.selectVersion')} {version.version}
                                                            </button>
                                                        ))}
                                                    </div>
                                                </>
                                            )}
                                        </div>
                                    )}
                                </div>
                            )}

                            {circleMode === 'knowledge' && (
                                <div className={styles.section}>
                                    <button
                                        type="button"
                                        className={styles.identityRulesToggle}
                                        aria-expanded={draftLifecycleExpanded}
                                        onClick={() => setDraftLifecycleExpanded((prev) => !prev)}
                                    >
                                        <span className={styles.identityRulesToggleTitle}>{t('draftLifecycle.title')}</span>
                                        <span className={styles.identityRulesToggleAction}>
                                            {draftLifecycleExpanded ? t('common.collapse') : t('common.expand')}
                                            <ChevronDown
                                                size={14}
                                                className={`${styles.identityRulesToggleChevron} ${draftLifecycleExpanded ? styles.identityRulesToggleChevronExpanded : ''}`}
                                            />
                                        </span>
                                    </button>
                                    {draftLifecycleExpanded && (
                                        <div className={styles.identityRulesCard}>
                                            <div className={styles.workflowModeField}>
                                                <div className={styles.workflowModeHeader}>
                                                    <div className={styles.ghostLabel}>{t('draftLifecycle.reviewEntryLabel')}</div>
                                                    <p className={styles.workflowModeHelp}>
                                                        {getReviewEntryModeHelp(draftLifecycleDraft.reviewEntryMode, t)}
                                                    </p>
                                                </div>
                                                <div className={styles.ghostChoiceGroup}>
                                                    <button
                                                        type="button"
                                                        className={`${styles.ghostChoiceBtn} ${draftLifecycleDraft.reviewEntryMode === 'auto_only' ? styles.ghostChoiceBtnActive : ''}`}
                                                        onClick={() => updateDraftLifecycleDraft('reviewEntryMode', 'auto_only')}
                                                        disabled={draftLifecycleSaving}
                                                    >
                                                        {t('draftLifecycle.reviewEntry.autoOnly')}
                                                    </button>
                                                    <button
                                                        type="button"
                                                        className={`${styles.ghostChoiceBtn} ${draftLifecycleDraft.reviewEntryMode === 'manual_only' ? styles.ghostChoiceBtnActive : ''}`}
                                                        onClick={() => updateDraftLifecycleDraft('reviewEntryMode', 'manual_only')}
                                                        disabled={draftLifecycleSaving}
                                                    >
                                                        {t('draftLifecycle.reviewEntry.manualOnly')}
                                                    </button>
                                                    <button
                                                        type="button"
                                                        className={`${styles.ghostChoiceBtn} ${draftLifecycleDraft.reviewEntryMode === 'auto_or_manual' ? styles.ghostChoiceBtnActive : ''}`}
                                                        onClick={() => updateDraftLifecycleDraft('reviewEntryMode', 'auto_or_manual')}
                                                        disabled={draftLifecycleSaving}
                                                    >
                                                        {t('draftLifecycle.reviewEntry.autoOrManual')}
                                                    </button>
                                                </div>
                                            </div>

                                            {usesAutoReviewTimer && (
                                                <div className={styles.infoField}>
                                                    <div className={styles.infoFieldHeader}>
                                                        <span className={styles.infoLabel}>{t('draftLifecycle.autoReviewTimeLabel')}</span>
                                                        <span className={styles.infoHint}>{t('draftLifecycle.autoReviewTimeHint')}</span>
                                                    </div>
                                                    <div className={styles.inlineNumberWrap}>
                                                        <input
                                                            className={styles.inlineNumberInput}
                                                            type="number"
                                                            min={1}
                                                            max={1440}
                                                            value={draftLifecycleDraft.draftingWindowMinutes}
                                                            onChange={(e) => updateDraftLifecycleDraft('draftingWindowMinutes', Math.max(1, parseInt(e.target.value, 10) || 1))}
                                                            disabled={draftLifecycleSaving}
                                                        />
                                                        <span className={styles.inlineUnit}>{t('units.minutes')}</span>
                                                    </div>
                                                </div>
                                            )}

                                            <div className={styles.infoField}>
                                                <div className={styles.infoFieldHeader}>
                                                    <span className={styles.infoLabel}>{t('draftLifecycle.reviewWindowLabel')}</span>
                                                    <span className={styles.infoHint}>{t('draftLifecycle.reviewWindowHint')}</span>
                                                </div>
                                                <div className={styles.inlineNumberWrap}>
                                                    <input
                                                        className={styles.inlineNumberInput}
                                                        type="number"
                                                        min={1}
                                                        max={4320}
                                                        value={draftLifecycleDraft.reviewWindowMinutes}
                                                        onChange={(e) => updateDraftLifecycleDraft('reviewWindowMinutes', Math.max(1, parseInt(e.target.value, 10) || 1))}
                                                        disabled={draftLifecycleSaving}
                                                    />
                                                    <span className={styles.inlineUnit}>{t('units.minutes')}</span>
                                                </div>
                                            </div>

                                            <div className={styles.infoField}>
                                                <div className={styles.infoFieldHeader}>
                                                    <span className={styles.infoLabel}>{t('draftLifecycle.maxRoundsLabel')}</span>
                                                </div>
                                                <input
                                                    className={styles.inlineNumberInput}
                                                    type="number"
                                                    min={1}
                                                    max={12}
                                                    value={draftLifecycleDraft.maxRevisionRounds}
                                                    onChange={(e) => updateDraftLifecycleDraft('maxRevisionRounds', Math.max(1, parseInt(e.target.value, 10) || 1))}
                                                    disabled={draftLifecycleSaving}
                                                />
                                            </div>

                                            {draftLifecycleError && (
                                                <div className={styles.ghostError}>{draftLifecycleError}</div>
                                            )}
                                            {draftLifecycleNotice && (
                                                <div className={styles.sectionNotice}>{draftLifecycleNotice}</div>
                                            )}
                                            <button
                                                type="button"
                                                className={styles.ghostSaveBtn}
                                                onClick={handleSaveDraftLifecycleTemplate}
                                                disabled={!canSaveDraftLifecycle}
                                            >
                                                {draftLifecycleSaving ? t('actions.saving') : t('draftLifecycle.save')}
                                            </button>
                                        </div>
                                    )}
                                </div>
                            )}

                            {circleMode === 'knowledge' && (
                                <div className={styles.section}>
                                    <button
                                        type="button"
                                        className={styles.identityRulesToggle}
                                        aria-expanded={draftWorkflowExpanded}
                                        onClick={() => setDraftWorkflowExpanded((prev) => !prev)}
                                    >
                                        <span className={styles.identityRulesToggleTitle}>{t('draftWorkflow.title')}</span>
                                        <span className={styles.identityRulesToggleAction}>
                                            {draftWorkflowExpanded ? t('common.collapse') : t('common.expand')}
                                            <ChevronDown
                                                size={14}
                                                className={`${styles.identityRulesToggleChevron} ${draftWorkflowExpanded ? styles.identityRulesToggleChevronExpanded : ''}`}
                                            />
                                        </span>
                                    </button>
                                    {draftWorkflowExpanded && (
                                        <div className={styles.identityRulesCard}>
                                            <div className={styles.workflowPolicyField}>
                                                <div className={styles.workflowPolicyCopy}>
                                                    <span className={styles.infoLabel}>{t('draftWorkflow.preset')}</span>
                                                    <span className={styles.infoHint}>{t('draftWorkflow.presetHint')}</span>
                                                </div>
                                                <Select
                                                    ariaLabel={t('draftWorkflow.preset')}
                                                    value={draftWorkflowPreset}
                                                    options={draftWorkflowPresetOptions}
                                                    onChange={handleDraftWorkflowPresetChange}
                                                    disabled={draftLifecycleSaving}
                                                />
                                            </div>

                                            <div className={styles.workflowPolicyField}>
                                                <div className={styles.workflowPolicyCopy}>
                                                    <span className={styles.infoLabel}>{t('draftWorkflow.createIssue')}</span>
                                                </div>
                                                {renderWorkflowRoleSelect('createIssueMinRole', t('draftWorkflow.createIssue'))}
                                            </div>

                                            <div className={styles.workflowPolicyField}>
                                                <div className={styles.workflowPolicyCopy}>
                                                    <span className={styles.infoLabel}>{t('draftWorkflow.followupIssue')}</span>
                                                </div>
                                                {renderWorkflowRoleSelect('followupIssueMinRole', t('draftWorkflow.followupIssue'))}
                                            </div>

                                            <div className={styles.workflowPolicyField}>
                                                <div className={styles.workflowPolicyCopy}>
                                                    <span className={styles.infoLabel}>{t('draftWorkflow.reviewIssue')}</span>
                                                </div>
                                                {renderWorkflowRoleSelect('reviewIssueMinRole', t('draftWorkflow.reviewIssue'))}
                                            </div>

                                            <div className={styles.workflowPolicyField}>
                                                <div className={styles.workflowPolicyCopy}>
                                                    <span className={styles.infoLabel}>{t('draftWorkflow.retagIssue')}</span>
                                                </div>
                                                {renderWorkflowRoleSelect('retagIssueMinRole', t('draftWorkflow.retagIssue'))}
                                            </div>

                                            <div className={styles.workflowPolicyField}>
                                                <div className={styles.workflowPolicyCopy}>
                                                    <span className={styles.infoLabel}>{t('draftWorkflow.applyIssue')}</span>
                                                </div>
                                                {renderWorkflowRoleSelect('applyIssueMinRole', t('draftWorkflow.applyIssue'))}
                                            </div>

                                            <div className={styles.workflowPolicyField}>
                                                <div className={styles.workflowPolicyCopy}>
                                                    <span className={styles.infoLabel}>{t('draftWorkflow.manualEndDrafting')}</span>
                                                </div>
                                                {renderWorkflowRoleSelect('manualEndDraftingMinRole', t('draftWorkflow.manualEndDrafting'))}
                                            </div>

                                            <div className={styles.workflowPolicyField}>
                                                <div className={styles.workflowPolicyCopy}>
                                                    <span className={styles.infoLabel}>{t('draftWorkflow.advanceFromReview')}</span>
                                                </div>
                                                {renderWorkflowRoleSelect('advanceFromReviewMinRole', t('draftWorkflow.advanceFromReview'))}
                                            </div>

                                            <div className={styles.workflowPolicyField}>
                                                <div className={styles.workflowPolicyCopy}>
                                                    <span className={styles.infoLabel}>{t('draftWorkflow.enterCrystallization')}</span>
                                                </div>
                                                {renderWorkflowRoleSelect('enterCrystallizationMinRole', t('draftWorkflow.enterCrystallization'))}
                                            </div>

                                            <div className={styles.toggleRow}>
                                                <div>
                                                    <div className={styles.toggleLabel}>{t('draftWorkflow.allowAuthorWithdraw')}</div>
                                                </div>
                                                <button
                                                    type="button"
                                                    className={`${styles.toggleSwitch} ${draftWorkflowDraft.allowAuthorWithdrawBeforeReview ? styles.toggleSwitchOn : ''}`}
                                                    onClick={() => updateDraftWorkflowDraft('allowAuthorWithdrawBeforeReview', !draftWorkflowDraft.allowAuthorWithdrawBeforeReview)}
                                                    disabled={draftLifecycleSaving}
                                                    aria-pressed={draftWorkflowDraft.allowAuthorWithdrawBeforeReview}
                                                >
                                                    <div className={`${styles.toggleKnob} ${draftWorkflowDraft.allowAuthorWithdrawBeforeReview ? styles.toggleKnobOn : ''}`} />
                                                </button>
                                            </div>

                                            <div className={styles.toggleRow}>
                                                <div>
                                                    <div className={styles.toggleLabel}>{t('draftWorkflow.allowModeratorRetag')}</div>
                                                </div>
                                                <button
                                                    type="button"
                                                    className={`${styles.toggleSwitch} ${draftWorkflowDraft.allowModeratorRetagIssue ? styles.toggleSwitchOn : ''}`}
                                                    onClick={() => updateDraftWorkflowDraft('allowModeratorRetagIssue', !draftWorkflowDraft.allowModeratorRetagIssue)}
                                                    disabled={draftLifecycleSaving}
                                                    aria-pressed={draftWorkflowDraft.allowModeratorRetagIssue}
                                                >
                                                    <div className={`${styles.toggleKnob} ${draftWorkflowDraft.allowModeratorRetagIssue ? styles.toggleKnobOn : ''}`} />
                                                </button>
                                            </div>

                                            {draftLifecycleError && (
                                                <div className={styles.ghostError}>{draftLifecycleError}</div>
                                            )}
                                            <button
                                                type="button"
                                                className={styles.ghostSaveBtn}
                                                onClick={handleSaveDraftWorkflowPolicy}
                                                disabled={!canSaveDraftWorkflow}
                                            >
                                                {draftLifecycleSaving ? t('actions.saving') : t('draftWorkflow.save')}
                                            </button>
                                        </div>
                                    )}
                                </div>
                            )}

                            <div className={styles.section}>
                                <div className={styles.sectionLabel}>{t('sections.aiCollab')}</div>
                                <div className={styles.ghostSourceHint}>
                                    {ghostSettingsSource === 'circle'
                                        ? t('ghost.source.circle')
                                        : ghostSettingsSource === 'pending'
                                            ? t('ghost.source.pending')
                                            : t('ghost.source.globalDefault')}
                                </div>
                                {ghostSettingsGovernancePending && (
                                    <div className={styles.ghostPendingNotice}>
                                        {t('ghost.pendingGovernance', {
                                            requestId: ghostSettingsGovernancePending.requestId || '-',
                                        })}
                                    </div>
                                )}

                                {ghostSettingsLoading ? (
                                    <div className={styles.ghostLoading}>{t('ghost.loading')}</div>
                                ) : (
                                    <>
                                        <div className={styles.toggleRow}>
                                            <div>
                                                <div className={styles.toggleLabel}>{t('ghost.summaryUseLlmTitle')}</div>
                                                <div className={styles.toggleDesc}>{t('ghost.summaryUseLlmDescription')}</div>
                                            </div>
                                            <button
                                                type="button"
                                                className={`${styles.toggleSwitch} ${ghostDraft.summaryUseLLM ? styles.toggleSwitchOn : ''}`}
                                                onClick={() => updateGhostDraft('summaryUseLLM', !ghostDraft.summaryUseLLM)}
                                                aria-pressed={ghostDraft.summaryUseLLM}
                                            >
                                                <div className={`${styles.toggleKnob} ${ghostDraft.summaryUseLLM ? styles.toggleKnobOn : ''}`} />
                                            </button>
                                        </div>
                                        {!ghostDraft.summaryUseLLM && (
                                            <div className={styles.ghostWarning}>{t('ghost.summaryUseLlmWarning')}</div>
                                        )}

                                        <div className={styles.workflowPolicyField}>
                                            <div className={styles.workflowPolicyCopy}>
                                                <span className={styles.infoLabel}>{t('ghost.triggerModeLabel')}</span>
                                                <span className={styles.infoHint}>{t('ghost.triggerModeHint')}</span>
                                            </div>
                                            <div className={styles.ghostChoiceGroup}>
                                                <button
                                                    type="button"
                                                    className={`${styles.ghostChoiceBtn} ${ghostDraft.draftTriggerMode === 'notify_only' ? styles.ghostChoiceBtnActive : ''}`}
                                                    onClick={() => updateGhostDraft('draftTriggerMode', 'notify_only')}
                                                >
                                                    {t('ghost.triggerModeNotifyOnly')}
                                                </button>
                                                <button
                                                    type="button"
                                                    className={`${styles.ghostChoiceBtn} ${ghostDraft.draftTriggerMode === 'auto_draft' ? styles.ghostChoiceBtnActive : ''}`}
                                                    onClick={() => updateGhostDraft('draftTriggerMode', 'auto_draft')}
                                                >
                                                    {t('ghost.triggerModeAutoDraft')}
                                                </button>
                                            </div>
                                        </div>

                                        <div className={styles.toggleRow}>
                                            <div>
                                                <div className={styles.toggleLabel}>{t('ghost.triggerSummaryUseLlmTitle')}</div>
                                                <div className={styles.toggleDesc}>{t('ghost.triggerSummaryUseLlmDescription')}</div>
                                            </div>
                                            <button
                                                type="button"
                                                className={`${styles.toggleSwitch} ${ghostDraft.triggerSummaryUseLLM ? styles.toggleSwitchOn : ''}`}
                                                onClick={() => updateGhostDraft('triggerSummaryUseLLM', !ghostDraft.triggerSummaryUseLLM)}
                                                aria-pressed={ghostDraft.triggerSummaryUseLLM}
                                            >
                                                <div className={`${styles.toggleKnob} ${ghostDraft.triggerSummaryUseLLM ? styles.toggleKnobOn : ''}`} />
                                            </button>
                                        </div>
                                        {!ghostDraft.triggerSummaryUseLLM && (
                                            <div className={styles.ghostWarning}>{t('ghost.triggerSummaryUseLlmWarning')}</div>
                                        )}
                                    </>
                                )}

                                {ghostSettingsError && (
                                    <div className={styles.ghostError}>{ghostSettingsError}</div>
                                )}

                                <button
                                    type="button"
                                    className={styles.ghostSaveBtn}
                                    onClick={handleSaveGhostSettings}
                                    disabled={!canSaveGhostSettings}
                                >
                                    {ghostSettingsSaving ? t('actions.saving') : t('ghost.save')}
                                </button>
                            </div>

                            {SHOW_AGENT_GOVERNANCE_PANEL && (circleMode === 'knowledge' || agents.length > 0 || currentUserRole !== 'member') && (
                                <div className={styles.section}>
                                    <AgentAdminPanel
                                        agents={agents}
                                        agentPolicy={agentPolicy}
                                        loading={agentPolicyLoading}
                                        saving={agentPolicySaving}
                                        error={agentPolicyError}
                                        currentUserRole={currentUserRole}
                                        onSavePolicy={onSaveAgentPolicy}
                                    />
                                </div>
                            )}

                            {/* Members */}
                            <div
                                className={styles.section}
                                ref={membersSectionRef}
                                data-settings-section="members"
                            >
                                <div className={styles.settingsGroupHeading} data-settings-group="members">
                                    <span>{t('groups.members.title')}</span>
                                    <small>{t('groups.members.description')}</small>
                                </div>
                                <div className={styles.sectionLabel}>
                                    {memberDirectoryNotice ? t('members.directoryTitle') : t('sections.members', { count: members.length })}
                                </div>

                                {visibleOwnerTransferRequests.length > 0 && (
                                    <div className={styles.ownerTransferPanel}>
                                        {visibleOwnerTransferRequests.map((transfer) => {
                                            const targetName = memberNameById.get(transfer.targetUserId) || t('ownerTransfer.unknownTarget');
                                            const canAcceptTransfer =
                                                transfer.status === 'pending_target_acceptance'
                                                && currentUserId === transfer.targetUserId
                                                && Boolean(onAcceptOwnerTransfer);
                                            return (
                                                <div className={styles.ownerTransferItem} key={transfer.id}>
                                                    <div className={styles.ownerTransferMeta}>
                                                        <strong>{t('ownerTransfer.title', { target: targetName })}</strong>
                                                        <span>{getOwnerTransferStatusLabel(transfer.status)}</span>
                                                    </div>
                                                    {canAcceptTransfer && (
                                                        <button
                                                            type="button"
                                                            className={styles.ownerTransferAcceptBtn}
                                                            onClick={() => { void handleAcceptOwnerTransfer(transfer.id); }}
                                                            disabled={memberActionKey !== null}
                                                        >
                                                            {t('ownerTransfer.accept')}
                                                        </button>
                                                    )}
                                                </div>
                                            );
                                        })}
                                    </div>
                                )}

                                {memberDirectoryNotice ? (
                                    <div className={styles.memberDirectoryNotice}>{memberDirectoryNotice}</div>
                                ) : (
                                    members.map((m) => (
                                        <div
                                            key={`${m.userId}:${m.actualRole}`}
                                            className={`${styles.memberRow} ${canManageRoles && m.roleMutable ? styles.memberRowTappable : ''}`}
                                            onClick={(e) => { e.stopPropagation(); void handleMemberTap(m); }}
                                        >
                                            <div className={styles.memberAvatar}>
                                                {m.name.charAt(0).toUpperCase()}
                                            </div>
                                            <div className={styles.memberIdentity}>
                                                <span className={styles.memberName}>{m.name}</span>
                                                {m.handle && m.handle !== m.name && (
                                                    <span className={styles.memberHandle}>@{m.handle}</span>
                                                )}
                                            </div>
                                            <span className={`${styles.roleBadge} ${getRoleBadgeClass(m.role)}`}>
                                                {getRoleLabel(m.role)}
                                            </span>

                                            {/* Role Popover */}
                                            {popoverTarget === m.userId && (
                                                <div className={styles.rolePopover} onClick={(e) => e.stopPropagation()}>
                                                    {m.role === 'member' && m.roleMutable && (
                                                        <button
                                                            className={styles.roleOption}
                                                            onClick={() => { void handleSetCurator(m); }}
                                                            disabled={memberActionKey !== null}
                                                        >
                                                            {t('members.actions.setCurator')}
                                                        </button>
                                                    )}
                                                    {m.role === 'curator' && m.roleMutable && (
                                                        <button
                                                            className={styles.roleOption}
                                                            onClick={() => { void handleSetMember(m); }}
                                                            disabled={memberActionKey !== null}
                                                        >
                                                            {t('members.actions.unsetCurator')}
                                                        </button>
                                                    )}
                                                    {m.removable && memberRemovalTarget !== m.userId && (
                                                        <button
                                                            className={`${styles.roleOption} ${styles.roleOptionDanger}`}
                                                            onClick={() => {
                                                                setMemberRemovalTarget(m.userId);
                                                                setMemberRemovalReason('');
                                                            }}
                                                            disabled={memberActionKey !== null}
                                                        >
                                                            {t('members.actions.remove')}
                                                        </button>
                                                    )}
                                                    {m.removable && memberRemovalTarget === m.userId && (
                                                        <div className={styles.memberRemovalForm}>
                                                            <label>
                                                                <span>{t('members.removal.reasonLabel')}</span>
                                                                <textarea
                                                                    value={memberRemovalReason}
                                                                    onChange={(event) => setMemberRemovalReason(event.target.value)}
                                                                    placeholder={t('members.removal.reasonPlaceholder')}
                                                                    maxLength={500}
                                                                    disabled={memberActionKey !== null}
                                                                />
                                                            </label>
                                                            <p>{t('members.removal.governanceNotice')}</p>
                                                            <button
                                                                className={`${styles.roleOption} ${styles.roleOptionDanger}`}
                                                                onClick={() => { void handleRemove(m); }}
                                                                disabled={memberActionKey !== null || memberRemovalReason.trim().length < 10}
                                                            >
                                                                {t('members.removal.openCase')}
                                                            </button>
                                                            <button
                                                                className={styles.roleOption}
                                                                onClick={() => {
                                                                    setMemberRemovalTarget(null);
                                                                    setMemberRemovalReason('');
                                                                }}
                                                                disabled={memberActionKey !== null}
                                                            >
                                                                {t('members.removal.cancel')}
                                                            </button>
                                                        </div>
                                                    )}
                                                    {canRequestOwnerTransfer && m.roleMutable && (
                                                        <button
                                                            className={styles.roleOption}
                                                            onClick={() => { void handleRequestOwnerTransfer(m); }}
                                                            disabled={memberActionKey !== null}
                                                        >
                                                            {t('ownerTransfer.request')}
                                                        </button>
                                                    )}
                                                </div>
                                            )}
                                        </div>
                                    ))
                                )}

                                {memberActionError && (
                                    <div className={styles.memberActionError}>{memberActionError}</div>
                                )}

                                {/* Invite button — shown for owner and curator */}
                                {canInvite && (
                                    <button className={styles.inviteBtn} onClick={onInvite}>
                                        <UserPlus size={14} />
                                        {t('members.actions.invite')}
                                    </button>
                                )}
                                {canLeave && (
                                    <button
                                        className={`${styles.inviteBtn} ${styles.leaveBtn}`}
                                        onClick={() => { void handleLeaveCircle(); }}
                                        disabled={memberActionKey !== null}
                                    >
                                        {t('members.actions.leave')}
                                    </button>
                                )}
                            </div>

                            {(currentUserRole === 'owner' || canManageLifecycle) && (
                                <div className={styles.section}>
                                    <div className={styles.sectionLabel}>{t('sections.dangerZone')}</div>
                                    <button
                                        className={styles.dangerBtn}
                                        onClick={onDeleteCircle}
                                        disabled={!lifecycleButtonEnabled}
                                    >
                                        {lifecycleActionBusy
                                            ? t('actions.saving')
                                            : isCircleArchived
                                                ? t('danger.restoreCircle')
                                                : t('danger.archiveCircle')}
                                    </button>
                                    {circleLifecycleStatus === 'Active' && onApproveMergeSource && onAcceptMergeSuccessor && (
                                        <div className={styles.infoField} data-circle-merge-workspace>
                                            <div className={styles.infoFieldHeader}>
                                                <span className={styles.infoLabel}>{t('danger.mergeTitle')}</span>
                                                <span className={styles.infoHint}>{t('danger.mergeWarning')}</span>
                                            </div>
                                            <input
                                                className={styles.inlineNumberInput}
                                                type="number"
                                                min={1}
                                                value={mergeSuccessorCircleId}
                                                placeholder={t('danger.mergeSuccessorCircle')}
                                                aria-label={t('danger.mergeSuccessorCircle')}
                                                onChange={(event) => setMergeSuccessorCircleId(event.target.value)}
                                                disabled={mergeActionBusy}
                                            />
                                            <select
                                                className={styles.inlineNumberInput}
                                                value={mergeMembershipDisposition}
                                                aria-label={t('danger.mergeMembershipDisposition')}
                                                onChange={(event) => setMergeMembershipDisposition(event.target.value as CircleMergeDispositionInput['membershipDisposition'])}
                                                disabled={mergeActionBusy}
                                            >
                                                <option value="reconsent">{t('danger.mergeMembershipReconsent')}</option>
                                                <option value="reapply">{t('danger.mergeMembershipReapply')}</option>
                                                <option value="not_migrated">{t('danger.mergeNotMigrated')}</option>
                                            </select>
                                            <select
                                                className={styles.inlineNumberInput}
                                                value={mergeContentDisposition}
                                                aria-label={t('danger.mergeContentDisposition')}
                                                onChange={(event) => setMergeContentDisposition(event.target.value as CircleMergeDispositionInput['contentDisposition'])}
                                                disabled={mergeActionBusy}
                                            >
                                                <option value="copy_authorized">{t('danger.mergeContentCopyAuthorized')}</option>
                                                <option value="reference_only">{t('danger.mergeContentReferenceOnly')}</option>
                                                <option value="not_migrated">{t('danger.mergeNotMigrated')}</option>
                                            </select>
                                            <input
                                                className={styles.inlineNumberInput}
                                                type="datetime-local"
                                                value={mergeExitWindowEndsAt}
                                                aria-label={t('danger.mergeExitWindow')}
                                                onChange={(event) => setMergeExitWindowEndsAt(event.target.value)}
                                                disabled={mergeActionBusy}
                                            />
                                            <input
                                                className={styles.inlineNumberInput}
                                                type="datetime-local"
                                                value={mergeExportWindowEndsAt}
                                                aria-label={t('danger.mergeExportWindow')}
                                                onChange={(event) => setMergeExportWindowEndsAt(event.target.value)}
                                                disabled={mergeActionBusy}
                                            />
                                            <input
                                                className={styles.inlineNumberInput}
                                                value={mergeDisclosureNoticeRef}
                                                placeholder={t('danger.mergeDisclosureNoticeRef')}
                                                onChange={(event) => setMergeDisclosureNoticeRef(event.target.value)}
                                                disabled={mergeActionBusy}
                                            />
                                            <details>
                                                <summary>{t('danger.mergeConflictEvidence')}</summary>
                                                <input className={styles.inlineNumberInput} value={mergeIdentityEvidenceRef} placeholder={t('danger.mergeIdentityEvidence')} onChange={(event) => setMergeIdentityEvidenceRef(event.target.value)} disabled={mergeActionBusy} />
                                                <input className={styles.inlineNumberInput} value={mergeResourceEvidenceRef} placeholder={t('danger.mergeResourceEvidence')} onChange={(event) => setMergeResourceEvidenceRef(event.target.value)} disabled={mergeActionBusy} />
                                                <input className={styles.inlineNumberInput} value={mergeMandateEvidenceRef} placeholder={t('danger.mergeMandateEvidence')} onChange={(event) => setMergeMandateEvidenceRef(event.target.value)} disabled={mergeActionBusy} />
                                                <input className={styles.inlineNumberInput} value={mergePrivacyEvidenceRef} placeholder={t('danger.mergePrivacyEvidence')} onChange={(event) => setMergePrivacyEvidenceRef(event.target.value)} disabled={mergeActionBusy} />
                                            </details>
                                            <button
                                                type="button"
                                                className={styles.dangerBtn}
                                                disabled={!mergeSourceApprovalEnabled}
                                                onClick={() => void onApproveMergeSource({
                                                    successorCircleId: Number(mergeSuccessorCircleId),
                                                    membershipDisposition: mergeMembershipDisposition,
                                                    contentDisposition: mergeContentDisposition,
                                                    crossInstitutionDisclosureImpact: mergeDisclosureNoticeRef.trim()
                                                        ? { status: 'notice_required', noticeRef: mergeDisclosureNoticeRef.trim() }
                                                        : { status: 'none' },
                                                    exitWindowEndsAt: new Date(mergeExitWindowEndsAt).toISOString(),
                                                    exportWindowEndsAt: new Date(mergeExportWindowEndsAt).toISOString(),
                                                    conflicts: {
                                                        identity: mergeIdentityEvidenceRef.trim()
                                                            ? { status: 'resolved', evidenceRef: mergeIdentityEvidenceRef.trim() }
                                                            : { status: 'no_conflict' },
                                                        resource: mergeResourceEvidenceRef.trim()
                                                            ? { status: 'resolved_by_p06', evidenceRef: mergeResourceEvidenceRef.trim() }
                                                            : { status: 'no_resources' },
                                                        mandate: mergeMandateEvidenceRef.trim()
                                                            ? { status: 'resolved', evidenceRef: mergeMandateEvidenceRef.trim() }
                                                            : { status: 'no_conflict' },
                                                        privacy: mergePrivacyEvidenceRef.trim()
                                                            ? { status: 'resolved', evidenceRef: mergePrivacyEvidenceRef.trim() }
                                                            : { status: 'no_conflict' },
                                                    },
                                                })}
                                            >
                                                {t('danger.mergeApproveSource')}
                                            </button>
                                            <input
                                                className={styles.inlineNumberInput}
                                                value={mergeSourceApprovalRefs}
                                                placeholder={t('danger.mergeSourceApprovalRefs')}
                                                onChange={(event) => setMergeSourceApprovalRefs(event.target.value)}
                                                disabled={mergeActionBusy}
                                            />
                                            <input
                                                className={styles.inlineNumberInput}
                                                value={mergeSuccessorReason}
                                                placeholder={t('danger.mergeSuccessorReason')}
                                                onChange={(event) => setMergeSuccessorReason(event.target.value)}
                                                disabled={mergeActionBusy}
                                            />
                                            <button
                                                type="button"
                                                className={styles.dangerBtn}
                                                disabled={!mergeSuccessorAcceptanceEnabled}
                                                onClick={() => void onAcceptMergeSuccessor(
                                                    mergeApprovalRequestIds,
                                                    mergeSuccessorReason.trim(),
                                                )}
                                            >
                                                {t('danger.mergeAcceptSuccessor')}
                                            </button>
                                            {mergeActionStatus?.state === 'merge_pending' && onFinalizeMerge && (
                                                <button
                                                    type="button"
                                                    className={styles.dangerBtn}
                                                    onClick={() => void onFinalizeMerge()}
                                                    disabled={mergeActionBusy}
                                                >
                                                    {t('danger.mergeFinalize')}
                                                </button>
                                            )}
                                            {mergeActionStatus?.state === 'requires_source_governance' && (
                                                <div className={styles.sectionNotice}>{t('danger.mergeSourceGovernanceRequired', { requestId: mergeActionStatus.sourceRequestId || '-' })}</div>
                                            )}
                                            {mergeActionStatus?.state === 'source_approved' && (
                                                <div className={styles.sectionNotice}>{t('danger.mergeSourceApproved', { requestId: mergeActionStatus.sourceRequestId || '-' })}</div>
                                            )}
                                            {mergeActionStatus?.state === 'requires_successor_governance' && (
                                                <div className={styles.sectionNotice}>{t('danger.mergeSuccessorGovernanceRequired', { requestId: mergeActionStatus.successorRequestId || '-' })}</div>
                                            )}
                                            {(mergeActionStatus?.state === 'merge_pending' || mergeActionStatus?.state === 'merged') && (
                                                <div className={styles.sectionNotice}>{t(
                                                    mergeActionStatus.state === 'merged' ? 'danger.mergeCompleted' : 'danger.mergePending',
                                                    { planId: mergeActionStatus.plan?.id || '-' },
                                                )}</div>
                                            )}
                                            {mergeActionStatus?.state === 'error' && (
                                                <div className={styles.ghostError}>{mergeActionStatus.message || t('danger.failed')}</div>
                                            )}
                                        </div>
                                    )}
                                    {!isCircleDissolutionPending && !isCircleMergeTerminal && onDissolveCircle && (
                                        <div className={styles.infoField}>
                                            <div className={styles.infoFieldHeader}>
                                                <span className={styles.infoLabel}>{t('danger.dissolutionTitle')}</span>
                                                <span className={styles.infoHint}>{t('danger.dissolutionWarning')}</span>
                                            </div>
                                            <input
                                                className={styles.inlineNumberInput}
                                                type="text"
                                                value={dissolutionReason}
                                                placeholder={t('danger.dissolutionReason')}
                                                onChange={(event) => setDissolutionReason(event.target.value)}
                                                disabled={lifecycleActionBusy}
                                            />
                                            <input
                                                className={styles.inlineNumberInput}
                                                type="datetime-local"
                                                value={dissolutionExitWindowEndsAt}
                                                aria-label={t('danger.dissolutionExitWindow')}
                                                onChange={(event) => setDissolutionExitWindowEndsAt(event.target.value)}
                                                disabled={lifecycleActionBusy}
                                            />
                                            <input
                                                className={styles.inlineNumberInput}
                                                type="text"
                                                value={dissolutionRetentionSuccessor}
                                                placeholder={t('danger.dissolutionRetentionSuccessor')}
                                                onChange={(event) => setDissolutionRetentionSuccessor(event.target.value)}
                                                disabled={lifecycleActionBusy}
                                            />
                                            <button
                                                type="button"
                                                className={styles.dangerBtn}
                                                disabled={!dissolutionButtonEnabled}
                                                onClick={() => {
                                                    void onDissolveCircle({
                                                        reason: dissolutionReason.trim(),
                                                        exitWindowEndsAt: new Date(dissolutionExitWindowEndsAt).toISOString(),
                                                        retentionSuccessorHomeIdentityBindingId:
                                                            dissolutionRetentionSuccessor.trim() || null,
                                                    });
                                                }}
                                            >
                                                {t('danger.startDissolution')}
                                            </button>
                                        </div>
                                    )}
                                    {lifecycleActionStatus?.state === 'requires_governance' && (
                                        <div className={styles.sectionNotice}>
                                            {t('danger.governanceRequired', {
                                                requestId: lifecycleActionStatus.requestId || '-',
                                            })}
                                        </div>
                                    )}
                                    {lifecycleActionStatus?.state === 'awaiting_wallet' && (
                                        <div className={styles.sectionNotice}>
                                            {t('danger.awaitingWallet', {
                                                planId: lifecycleActionStatus.plan?.id || '-',
                                            })}
                                        </div>
                                    )}
                                    {lifecycleActionStatus?.state === 'reconciliation_pending' && (
                                        <div className={styles.sectionNotice}>
                                            {t('danger.reconciliationPending', {
                                                planId: lifecycleActionStatus.plan?.id || '-',
                                            })}
                                        </div>
                                    )}
                                    {lifecycleActionStatus?.state === 'converged' && (
                                        <div
                                            className={styles.sectionNotice}
                                            data-lifecycle-convergence="converged"
                                        >
                                            {t('danger.lifecycleConverged', {
                                                planId: lifecycleActionStatus.plan?.id || '-',
                                                crossCheck: String(
                                                    (lifecycleActionStatus.plan?.reconciliation as any)
                                                        ?.indexer?.crossCheck || '-',
                                                ),
                                            })}
                                        </div>
                                    )}
                                    {isCircleDissolutionPending && (
                                        <div className={styles.sectionNotice}>
                                            {t('danger.dissolutionPending', {
                                                planId: lifecycleActionStatus?.plan?.id || '-',
                                                blocker: lifecycleActionStatus?.plan?.blockerCodes?.[0] || '-',
                                            })}
                                        </div>
                                    )}
                                    {retentionDestructionCoordination && (
                                        <div
                                            className={styles.sectionNotice}
                                            data-retention-destruction-coordination={String(retentionDestructionCoordination.status || '')}
                                        >
                                            {t('danger.retentionDestructionPending', {
                                                policyRef: String(retentionCoordinationPolicy?.ref || '-'),
                                                version: String(retentionCoordinationPolicy?.version || '-'),
                                                visibility: String(retentionPublicVisibility?.projection || '-'),
                                            })}
                                        </div>
                                    )}
                                    {isCircleForkPending && (
                                        <div className={styles.sectionNotice}>
                                            {t('danger.forkPending')}
                                        </div>
                                    )}
                                    {lifecycleActionStatus?.state === 'blocked' && (
                                        <div className={styles.ghostError}>
                                            {t('danger.reconciliationBlocked', {
                                                blocker: lifecycleActionStatus.plan?.blockerCodes?.[0] || '-',
                                            })}
                                        </div>
                                    )}
                                    {lifecycleArchiveRestrictionVisible && (
                                        <div className={styles.sectionNotice}>
                                            {t('danger.archivedGovernanceRestriction')}
                                        </div>
                                    )}
                                    {lifecycleActionStatus?.plan && (
                                        <>
                                            <div className={styles.sectionNotice}>
                                                {t('danger.dispositionSummary', {
                                                    continueCount: lifecycleDispositionCounts.continue,
                                                    suspendCount: lifecycleDispositionCounts.suspend,
                                                    cancelCount: lifecycleDispositionCounts.cancel,
                                                    manualCount: lifecycleDispositionCounts.manual_resolution,
                                                })}
                                                {' '}
                                                {t('danger.resourceDispositionPending')}
                                            </div>
                                            <button
                                                type="button"
                                                className={styles.governanceSecondaryBtn}
                                                data-export-lifecycle-timeline
                                                onClick={() => void onExportLifecycleTimeline?.()}
                                                disabled={!onExportLifecycleTimeline}
                                            >
                                                {t('danger.exportLifecycleTimeline')}
                                            </button>
                                        </>
                                    )}
                                    {lifecycleActionStatus?.state === 'error' && (
                                        <div className={styles.ghostError}>
                                            {lifecycleActionStatus.message || t('danger.failed')}
                                        </div>
                                    )}
                                    {deleteCircleNotice && (
                                        <div className={styles.sectionNotice}>{deleteCircleNotice}</div>
                                    )}
                                </div>
                            )}

                            {settingsComposeScenario ? (
                                <div
                                    className={styles.composeDock}
                                    data-compose-dock="circle-settings"
                                    data-compose-scenario={settingsComposeScenario.scenarioKey}
                                >
                                    <p className={styles.composeDockTitle}>
                                        {t(`compose.scenario.${settingsComposeScenario.scenarioKey}.title`)}
                                    </p>
                                    <p className={styles.composeDockBody}>
                                        {t(`compose.scenario.${settingsComposeScenario.scenarioKey}.body`)}
                                    </p>
                                    <button
                                        type="button"
                                        className={styles.composeDockCta}
                                        onClick={runSettingsComposeCta}
                                        disabled={
                                            (settingsComposeScenario.cta === 'save_access' && !canSaveAccessPolicy)
                                            || (settingsComposeScenario.cta === 'save_ghost' && !canSaveGhostSettings)
                                            || (settingsComposeScenario.cta === 'save_draft_lifecycle' && !canSaveDraftLifecycle)
                                            || (settingsComposeScenario.cta === 'save_draft_workflow' && !canSaveDraftWorkflow)
                                        }
                                    >
                                        {t(`compose.scenario.${settingsComposeScenario.scenarioKey}.cta`)}
                                    </button>
                                </div>
                            ) : null}
                        </div>
                        <KnowledgeRelationshipLabelSheet
                            open={knowledgeRelationshipLabelsOpen}
                            labels={knowledgeRelationshipLabels}
                            loading={knowledgeRelationshipLabelsLoading}
                            failed={Boolean(knowledgeRelationshipLabelsError)}
                            onClose={() => setKnowledgeRelationshipLabelsOpen(false)}
                        />
                    </motion.div>
                </motion.div>
            )}
        </AnimatePresence>
    );
}
