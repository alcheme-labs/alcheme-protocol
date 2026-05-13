'use client';

import { useEffect, useState } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import { X, Settings, UserPlus, ChevronDown } from 'lucide-react';
import { Select } from '@/components/ui/Select';
import AgentAdminPanel from '@/features/agents/AgentAdminPanel';
import { useI18n } from '@/i18n/useI18n';
import type { CircleAgentPolicy, CircleAgentRecord } from '@/lib/api/circlesAgents';
import type { CircleGhostSettings } from '@/lib/api/circlesGhostSettings';
import {
    DEFAULT_CIRCLE_DRAFT_WORKFLOW_POLICY,
} from '@/lib/api/circlesPolicyProfile';
import { resolveCircleSettingsActionFlags } from '@/lib/circle/memberManagement';
import type { CircleAccessType } from '@/lib/circle/accessPolicy';
import type {
    CircleDraftWorkflowPolicy,
    CircleDraftLifecycleTemplate,
    DraftReviewEntryMode,
} from '@/lib/api/circlesPolicyProfile';
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

interface CircleSettingsSheetProps {
    open: boolean;
    circleName: string;
    circleMode: 'social' | 'knowledge';
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
    ghostSettings?: CircleGhostSettings | null;
    ghostSettingsSource?: 'circle' | 'pending' | 'global_default' | null;
    ghostSettingsLoading?: boolean;
    ghostSettingsSaving?: boolean;
    ghostSettingsError?: string | null;
    draftLifecycleTemplate?: CircleDraftLifecycleTemplate | null;
    draftWorkflowPolicy?: CircleDraftWorkflowPolicy | null;
    draftLifecycleSaving?: boolean;
    draftLifecycleError?: string | null;
    accessPolicyEditable?: boolean;
    accessPolicySaving?: boolean;
    accessPolicyError?: string | null;
    agents?: CircleAgentRecord[];
    agentPolicy?: CircleAgentPolicy | null;
    agentPolicyLoading?: boolean;
    agentPolicySaving?: boolean;
    agentPolicyError?: string | null;
    onClose: () => void;
    onToggleForward?: (val: boolean) => void;
    onSaveGhostSettings?: (settings: CircleGhostSettings) => Promise<void> | void;
    onSaveDraftLifecycleTemplate?: (template: {
        reviewEntryMode: DraftReviewEntryMode;
        draftingWindowMinutes: number;
        reviewWindowMinutes: number;
        maxRevisionRounds: number;
    }) => Promise<void> | void;
    onSaveDraftWorkflowPolicy?: (policy: CircleDraftWorkflowPolicy) => Promise<void> | void;
    onSaveAccessPolicy?: (policy: {
        accessType: CircleAccessType;
        minCrystals: number;
    }) => Promise<void> | void;
    onSaveAgentPolicy?: (policy: {
        triggerScope: CircleAgentPolicy['triggerScope'];
        costDiscountBps: number;
        reviewMode: CircleAgentPolicy['reviewMode'];
    }) => Promise<void> | void;
    deleteCircleAvailable?: boolean;
    deleteCircleNotice?: string | null;
    onDeleteCircle?: () => void;
    onRoleChange?: (member: MemberInfo, newRole: 'Moderator' | 'Member') => Promise<void> | void;
    onRemoveMember?: (member: MemberInfo) => Promise<void> | void;
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
    circleName,
    circleMode,
    accessType,
    minCrystals = 0,
    allowForwardOut,
    forwardPolicyEditable = false,
    forwardPolicyNotice = null,
    identityRules = null,
    members,
    memberDirectoryNotice = null,
    currentUserRole,
    ghostSettings = null,
    ghostSettingsSource = null,
    ghostSettingsLoading = false,
    ghostSettingsSaving = false,
    ghostSettingsError = null,
    draftLifecycleTemplate = null,
    draftWorkflowPolicy = null,
    draftLifecycleSaving = false,
    draftLifecycleError = null,
    accessPolicyEditable = false,
    accessPolicySaving = false,
    accessPolicyError = null,
    agents = [],
    agentPolicy = null,
    agentPolicyLoading = false,
    agentPolicySaving = false,
    agentPolicyError = null,
    onClose,
    onToggleForward,
    onSaveGhostSettings,
    onSaveDraftLifecycleTemplate,
    onSaveDraftWorkflowPolicy,
    onSaveAccessPolicy,
    onSaveAgentPolicy,
    deleteCircleAvailable = false,
    deleteCircleNotice = null,
    onDeleteCircle,
    onRoleChange,
    onRemoveMember,
    onInvite,
    onLeaveCircle,
}: CircleSettingsSheetProps) {
    const t = useI18n('CircleSettingsSheet');
    const workflowRoleOptions = getWorkflowRoleOptions(t);
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
    const [ghostDraft, setGhostDraft] = useState<CircleGhostSettings>(
        ghostSettings || defaultGhostSettings,
    );
    const [ghostDirty, setGhostDirty] = useState(false);
    const [draftLifecycleDraft, setDraftLifecycleDraft] = useState(defaultDraftLifecycleTemplate);
    const [draftLifecycleDirty, setDraftLifecycleDirty] = useState(false);
    const [draftWorkflowDraft, setDraftWorkflowDraft] = useState(defaultDraftWorkflowPolicy);
    const [draftWorkflowDirty, setDraftWorkflowDirty] = useState(false);
    const [accessDraftType, setAccessDraftType] = useState<CircleAccessType>(accessType);
    const [accessDraftMinCrystals, setAccessDraftMinCrystals] = useState(normalizeCrystalThreshold(minCrystals || 1));
    const [memberActionKey, setMemberActionKey] = useState<string | null>(null);
    const [memberActionError, setMemberActionError] = useState<string | null>(null);
    const [identityRulesExpanded, setIdentityRulesExpanded] = useState(false);
    const [draftLifecycleExpanded, setDraftLifecycleExpanded] = useState(false);
    const [draftWorkflowExpanded, setDraftWorkflowExpanded] = useState(false);
    const usesAutoReviewTimer = draftLifecycleDraft.reviewEntryMode !== 'manual_only';
    const canEditAccessPolicy =
        accessPolicyEditable
        && Boolean(onSaveAccessPolicy);
    const currentAccessMinCrystals = accessType === 'crystal'
        ? normalizeCrystalThreshold(minCrystals || 1)
        : 0;
    const normalizedAccessDraftMinCrystals = accessDraftType === 'crystal'
        ? normalizeCrystalThreshold(accessDraftMinCrystals)
        : 0;
    const accessPolicyDirty =
        accessDraftType !== accessType
        || normalizedAccessDraftMinCrystals !== currentAccessMinCrystals;
    const accessOptions: Array<{ value: CircleAccessType; label: string }> = [
        { value: 'free', label: t('accessEditor.free') },
        { value: 'crystal', label: t('accessEditor.crystal') },
        { value: 'invite', label: t('accessEditor.invite') },
        { value: 'approval', label: t('accessEditor.approval') },
    ];

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

    useEffect(() => {
        setForwardEnabled(allowForwardOut);
    }, [allowForwardOut]);

    useEffect(() => {
        if (!open) return;
        setAccessDraftType(accessType);
        setAccessDraftMinCrystals(normalizeCrystalThreshold(minCrystals || 1));
    }, [open, accessType, minCrystals]);

    useEffect(() => {
        if (!open) return;
        if (ghostSettings) {
            setGhostDraft(ghostSettings);
        } else {
            setGhostDraft(defaultGhostSettings);
        }
        setGhostDirty(false);
    }, [open, ghostSettings]);

    useEffect(() => {
        if (!open) return;
        setDraftLifecycleDraft(defaultDraftLifecycleTemplate);
        setDraftLifecycleDirty(false);
    }, [open, draftLifecycleTemplate]);

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

    const handleSaveGhostSettings = async () => {
        if (!onSaveGhostSettings || ghostSettingsSaving) return;
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
        if (!onSaveDraftLifecycleTemplate || draftLifecycleSaving) return;
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
        if (!onSaveDraftWorkflowPolicy || draftLifecycleSaving) return;
        try {
            await onSaveDraftWorkflowPolicy(draftWorkflowDraft);
            setDraftWorkflowDirty(false);
        } catch {
            // error surfaced by parent
        }
    };

    const handleSaveAccessPolicy = async () => {
        if (!onSaveAccessPolicy || accessPolicySaving || !accessPolicyDirty) return;
        try {
            await onSaveAccessPolicy({
                accessType: accessDraftType,
                minCrystals: normalizedAccessDraftMinCrystals,
            });
        } catch {
            // error surfaced by parent
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
    const canInvite = actionFlags.canInvite;
    const canLeave = actionFlags.canLeave && Boolean(onLeaveCircle);

    const handleMemberTap = (member: MemberInfo) => {
        if (!canManageRoles || !member.roleMutable) return;
        setMemberActionError(null);
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
        const actionKey = `remove:${member.userId}`;
        setMemberActionKey(actionKey);
        setMemberActionError(null);
        try {
            await onRemoveMember(member);
            setPopoverTarget(null);
        } catch (error) {
            setMemberActionError(error instanceof Error ? error.message : t('errors.removeMember'));
        } finally {
            setMemberActionKey(null);
        }
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

    return (
        <AnimatePresence>
            {open && (
                <motion.div
                    className={styles.settingsOverlay}
                    initial={{ opacity: 0 }}
                    animate={{ opacity: 1 }}
                    exit={{ opacity: 0 }}
                    transition={{ duration: 0.22 }}
                    onClick={() => { setPopoverTarget(null); onClose(); }}
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
                            <button className={styles.closeBtn} onClick={onClose}>
                                <X size={18} />
                            </button>
                        </div>

                        <div className={styles.body}>
                            {/* Basic Info */}
                            <div className={styles.section}>
                                <div className={styles.sectionLabel}>{t('sections.basicInfo')}</div>

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
                                                    onClick={() => setAccessDraftType(option.value)}
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
                                                        onChange={(event) => setAccessDraftMinCrystals(normalizeCrystalThreshold(parseInt(event.target.value, 10) || 1))}
                                                        disabled={accessPolicySaving}
                                                    />
                                                </div>
                                            </div>
                                        )}
                                        {accessPolicyError && (
                                            <div className={styles.ghostError}>{accessPolicyError}</div>
                                        )}
                                        <button
                                            type="button"
                                            className={styles.ghostSaveBtn}
                                            onClick={handleSaveAccessPolicy}
                                            disabled={accessPolicySaving || !accessPolicyDirty}
                                        >
                                            {accessPolicySaving ? t('accessEditor.saving') : t('accessEditor.save')}
                                        </button>
                                    </div>
                                )}
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
                                            <button
                                                type="button"
                                                className={styles.ghostSaveBtn}
                                                onClick={handleSaveDraftLifecycleTemplate}
                                                disabled={!draftLifecycleDirty || draftLifecycleSaving}
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
                                                disabled={!draftWorkflowDirty || draftLifecycleSaving}
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
                                    disabled={ghostSettingsLoading || ghostSettingsSaving || !ghostDirty}
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
                            <div className={styles.section}>
                                <div className={styles.sectionLabel}>
                                    {memberDirectoryNotice ? t('members.directoryTitle') : t('members.title', { count: members.length })}
                                </div>

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
                                            <span className={styles.memberName}>
                                                {m.handle ? `@${m.handle}` : m.name}
                                            </span>
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
                                                    {m.removable && (
                                                        <button
                                                            className={`${styles.roleOption} ${styles.roleOptionDanger}`}
                                                            onClick={() => { void handleRemove(m); }}
                                                            disabled={memberActionKey !== null}
                                                        >
                                                            {t('members.actions.remove')}
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

                            {/* Danger Zone — only for owner */}
                            {currentUserRole === 'owner' && (
                                <div className={styles.section}>
                                    <div className={styles.sectionLabel}>{t('sections.dangerZone')}</div>
                                    <button
                                        className={styles.dangerBtn}
                                        onClick={onDeleteCircle}
                                        disabled={!deleteCircleAvailable}
                                    >
                                        {t('danger.deleteCircle')}
                                    </button>
                                    {deleteCircleNotice && (
                                        <div className={styles.sectionNotice}>{deleteCircleNotice}</div>
                                    )}
                                </div>
                            )}
                        </div>
                    </motion.div>
                </motion.div>
            )}
        </AnimatePresence>
    );
}
