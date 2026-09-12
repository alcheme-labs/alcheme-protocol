'use client';

import { useState, useCallback, useEffect, useRef, useMemo } from 'react';
import { useParams, useRouter, useSearchParams } from 'next/navigation';
import { useQuery, useMutation, useLazyQuery } from '@apollo/client/react';
import { motion, AnimatePresence, PanInfo } from 'framer-motion';
import { ArrowLeft, Users, MessageSquare, FileEdit, BookOpen, Lock, Gem, Smile, Paperclip, AtSign, SendHorizonal, CornerDownLeft, Copy, Trash2, Plus, X, Compass, Pin, Settings, Rss, Bell, ChevronDown, GitBranch, Radio, Landmark } from 'lucide-react';
import Link from 'next/link';
import dynamic from 'next/dynamic';
import { useConnection, useWallet } from '@solana/wallet-adapter-react';

import { TabBar } from '@/components/ui/TabBar';
import { Card } from '@/components/ui/Card';

import { Skeleton } from '@/components/ui/Skeleton';
import CrucibleEditor from '@/components/circle/CrucibleEditor';
import { useCollaboration } from '@/lib/collaboration';
import MessageActionSheet from '@/components/circle/MessageActionSheet/MessageActionSheet';
import CirclePicker, { type PickerCircle } from '@/components/circle/CirclePicker/CirclePicker';
import ChatRecordBubble, { type ChatRecordMessage } from '@/components/circle/ChatRecordBubble/ChatRecordBubble';
import CreateCircleSheet from '@/components/circle/CreateCircleSheet/CreateCircleSheet';
import CircleSettingsSheet, { type MemberInfo as CircleSettingsMemberInfo } from '@/components/circle/CircleSettingsSheet/CircleSettingsSheet';
import ForkCreateSheet from '@/components/circle/ForkCreateSheet/ForkCreateSheet';
import FeedTab, { type FeedPost } from '@/components/circle/FeedTab/FeedTab';
import FeedThreadSheet from '@/components/circle/FeedThreadSheet/FeedThreadSheet';
import MemberCard, { type MemberProfile } from '@/components/circle/MemberCard/MemberCard';
import NotificationPanel, { type Notification } from '@/components/circle/NotificationPanel/NotificationPanel';
import InviteMemberSheet, { type InvitableUser, type InviteResultSummary } from '@/components/circle/InviteMemberSheet/InviteMemberSheet';
import CrystalDetailSheet, { type CrystalDetail } from '@/components/circle/CrystalDetailSheet';
import DraftCard from '@/components/circle/DraftCard';
import { IdentityBadge } from '@/components/circle/IdentityBadge';
import AccessProgressBar from '@/components/circle/AccessProgressBar';
import RegisterIdentitySheet from '@/components/auth/RegisterIdentitySheet/RegisterIdentitySheet';

import { useColorTemperature } from '@/hooks/useColorTemperature';
import { usePatina } from '@/hooks/usePatina';
import { useCreateCircle } from '@/hooks/useCreateCircle';
import { useRegisterIdentity } from '@/hooks/useRegisterIdentity';
import { useLikePost } from '@/hooks/useLikePost';
import { useCreateFeedReply } from '@/hooks/useCreateFeedReply';
import { useRepostContent } from '@/hooks/useRepostContent';
import { useAlchemeSDK } from '@/hooks/useAlchemeSDK';
import { useMemberFollowCardState } from '@/hooks/useMemberFollowCardState';
import { computeCrystalVisualParams, type CrystalDataInput } from '@/lib/crystal/visualParams';
import { useWalletAction } from '@/lib/wallet/WalletActionProvider';
import { useWalletActionRunner } from '@/lib/wallet/useWalletActionRunner';
import { canonicalPublicKeyString, publicKeyStringsEqual } from '@/lib/solana/publicKeyIdentity';

/* Dynamic imports for 3D crystal (no SSR) */
const Crystal3D = dynamic(
    () => import('@/components/crystal/Crystal3D'),
    { ssr: false },
);
const CrystalDisplay = dynamic(
    () => import('@/components/crystal/CrystalDisplay'),
    { ssr: false },
);
import { GET_CIRCLE, GET_CIRCLE_POSTS, GET_NOTIFICATIONS, GET_KNOWLEDGE_BY_CIRCLE, GET_CIRCLE_DRAFTS, GET_MEMBER_PROFILE, GET_POST_THREAD, MARK_NOTIFICATIONS_READ, SEARCH_USERS } from '@/lib/apollo/queries';
import type { CircleResponse, CirclePostsResponse, GQLPost, NotificationsResponse, KnowledgeByCircleResponse, CircleDraftsResponse, GQLKnowledge, GQLDraftSummary, GQLKnowledgeContributor, MarkNotificationsReadResponse, MemberProfileResponse, PostThreadResponse, SearchUsersResponse } from '@/lib/apollo/types';
import {
    createDiscussionSession,
    createDraftFromCommunicationSourceMaterials,
    fetchDiscussionMessages,
    refreshDiscussionSession,
    sendDiscussionMessage,
    tombstoneDiscussionMessage,
    type DiscussionMessageDto,
} from '@/lib/api/discussion';
import {
    CIRCLE_GHOST_SETTINGS_GOVERNANCE_ACTION,
    fetchCircleGhostSettings,
    normalizeCircleGhostSettings,
    updateCircleGhostSettings,
    type CircleGhostSettings,
    type CircleGhostSettingsGovernancePending,
} from '@/lib/api/circlesGhostSettings';
import {
    archiveCirclePrimaryGeoAnchor,
    fetchCirclePrimaryGeoAnchor,
    updateCirclePrimaryGeoAnchor,
    type CircleGeoAnchorDto,
    type CircleGeoAnchorInput,
} from '@/lib/api/circleLocations';
import {
    fetchCircleAgents,
    fetchCircleAgentPolicy,
    updateCircleAgentPolicy,
    type CircleAgentPolicy,
    type CircleAgentRecord,
} from '@/lib/api/circlesAgents';
import {
    DEFAULT_CIRCLE_FORK_POLICY,
    DEFAULT_CIRCLE_DRAFT_WORKFLOW_POLICY,
    fetchCircleDraftPrompts,
    fetchCirclePolicyProfile,
    updateCircleDraftPrompt,
    updateCircleDraftWorkflowPolicy,
    updateCircleDraftLifecycleTemplate,
    type CircleDraftLifecycleTemplate,
    type CircleDraftPromptScopeReadback,
    type CircleForkPolicy,
    type CircleDraftWorkflowPolicy,
} from '@/lib/api/circlesPolicyProfile';
import {
    createLocalAuxiliaryGovernanceBinding,
    createSelfGovernedGovernanceBinding,
    createSharedCommitteeMandateBinding,
    proposeActiveGovernanceMandateSupersede,
    requestGovernanceBindingDeactivation,
    counterSharedCommitteeGovernanceMandate,
    prepareGovernanceMandateAcceptance,
    acceptGovernanceMandateCounter,
    createGovernanceRecoveryPolicy,
    openGovernanceAuthorityHealthCase,
    applyGovernanceAuthorityHealth,
    permanentlyBlockGovernanceAuthority,
    fetchCircleGovernanceBindings,
    fetchCircleGovernanceCommitteeProfile,
    fetchCircleGovernanceRequests,
    prepareGovernanceRequestSignal,
    submitGovernanceRequestSignal,
    updateCircleGovernanceCommitteeProfile,
    updateCircleGovernancePolicyVersion,
    type CircleGovernanceBinding,
    type CircleGovernanceCommitteeProfile,
    type CircleGovernanceRequest,
    type CircleGovernanceResourceReadiness,
    type GovernanceRecoveryReadback,
} from '@/lib/api/governance';
import {
    exportCircleLifecycleTimeline,
    finalizeCircleMerge,
    readCircleLifecycle,
    submitCircleMergeSourceApproval,
    submitCircleMergeSuccessorAcceptance,
    submitCircleLifecycleAction,
    type CircleMergeDispositionInput,
    type CircleLifecyclePlanReadback,
} from '@/lib/api/circlesLifecycle';
import {
    acceptCircleOwnerTransferRequest,
    createCircleOwnerTransferRequest,
    fetchCircleOwnerTransferRequests,
    type CircleOwnerTransferRequest,
} from '@/lib/api/circlesOwnerTransfer';
import {
    createCircleInvite,
    fetchCircleIdentityStatus,
    fetchCircleMembershipState,
    joinCircle,
    leaveCircle,
    removeCircleMember,
    updateCircleJoinPolicy,
    updateCircleMemberRole,
    type CircleIdentityStatus,
    type CircleMembershipSnapshot,
} from '@/lib/api/circlesMembership';
import { updateCirclePostCreateSettings } from '@/lib/api/circlesPostCreateSettings';
import { waitForCircleMinCrystalsProjection } from '@/lib/api/createCircleFlow';
import { waitForSignatureSlot } from '@/lib/api/sync';
import { bytesToBase64 } from '@/lib/circles/settingsEnvelope';
import {
    clearPendingPostCreateSettings,
    loadPendingPostCreateSettings,
} from '@/lib/circles/postCreateSettingsRecovery';
import styles from './page.module.css';
import TierPill from '@/components/circle/TierPill/TierPill';
import PlazaTab from '@/components/circle/PlazaTab/PlazaTab';
import CrucibleTab from '@/components/circle/CrucibleTab/CrucibleTab';
import SanctuaryTab from '@/components/circle/SanctuaryTab/SanctuaryTab';
import CircleTreePanel from '@/components/circle/CircleTreePanel/CircleTreePanel';
import CircleRoomsPanel from '@/components/circle/CircleRoomsPanel/CircleRoomsPanel';
import GovernanceCasesTab from '@/features/governance/GovernanceCasesTab';
import GovernanceBootstrapCard from '@/features/governance/GovernanceBootstrapCard';
import GovernanceMigrationRehearsalPanel from '@/features/governance/GovernanceMigrationRehearsalPanel';
import type { SubCircle, PlazaMessage, PlazaQuickAuxCircle, CircleGroup, DiscussionSessionState } from '@/lib/circle/types';
import {
    accessRequirementToAccessType,
    resolveCircleAccessRequirement,
    type CircleAccessRequirement,
} from '@/lib/circle/accessPolicy';
import { encodeCircleFlags } from '@/lib/circle/flags';
import { timeAgo, mapContributorRole, mapMembershipToIdentityState, normalizeJoinActionError, mapDiscussionDtoToPlazaMessage, createCircleJoinCopy } from '@/lib/circle/utils';
import { resolveCircleJoinBannerState } from '@/lib/circle/joinBanner';
import { createIdentityCopy, normalizeIdentityCopy } from '@/lib/circle/identityCopy';
import { mapIdentityLevelToDisplayState } from '@/lib/circle/identityDisplay';
import type { CircleRoleValue, ViewerIdentityState } from '@/lib/circle/identityTypes';
import { requiresAuthSessionSignature } from '@/lib/auth/sessionPolicy';
import { resolveIdentityJoinWalletImpact } from '@/lib/circles/settingsWalletImpact';
import {
    buildDirectoryInvitableUsers,
    buildInvitableUsers,
    resolveInviteSourceCircleId,
    shouldSearchGlobalInviteDirectory,
} from '@/lib/circle/memberManagement';
import {
    formatRelationshipLabel,
    resolveSourceDraftVersionLabel,
} from '@/lib/knowledge/relationshipLabels';
import {
    canManageCircleAgents,
    deriveCreatorFallbackMembershipSnapshot,
    deriveIdentityStatusFallbackMembershipSnapshot,
    deriveViewerCircleState,
    resolveActiveIdentityStatus,
    resolveActiveMembershipSnapshot,
} from '@/lib/circle/membershipState';
import { resolvePreferredActiveTierId } from '@/lib/circle/activeTierRestore';
import { canOpenTab, resolveChromeTabs } from '@/lib/circle/chromeTabs';
import {
    normalizeCircleShortcutTab,
    shouldAutoEnterCircleShortcut,
    type CircleShortcutDraft,
} from '@/lib/circle/shortcuts';
import { useCircleShortcuts } from '@/lib/circle/useCircleShortcuts';
import { startMembershipRefresh } from '@/lib/circle/membershipRefresh';
import { deriveFeedRepostMembershipPending } from '@/lib/feed/repostState';
import { submitFeedReply } from '@/lib/feed/replyComposer';
import { resolveNotificationCircleTab, resolveNotificationHref, type NotificationTab } from '@/lib/notifications/routing';
import { useIdentityOnboarding } from '@/lib/auth/identityOnboarding';
import { useCurrentLocale, useI18n } from '@/i18n/useI18n';
import { buildKnowledgeReferenceOptions } from '@/lib/circle/knowledgeReferenceOptions';
import {
    fetchSourceMaterials,
    updateSourceMaterialLifecycle,
    type SourceMaterialRecord,
} from '@/lib/api/circlesSourceMaterials';
import {
    fetchCircleExternalAppBindings,
    type CircleExternalAppBindingRecord,
} from '@/lib/api/externalApps';
import {
    buildAccessPanelViewModel,
    governanceBindingCoversAction,
} from '@/lib/circle/accessPanelViewModel';
import { normalizeCircleRouteTab } from '@/lib/circle/routeTabs';
import { resolveDiscussionWalletPolicy } from '@/lib/discussion/discussionWalletPolicy';
import type { DiscussionSessionTokenOptions } from '@/lib/discussion/sessionRecovery';
import type { WorkspaceDraftLifecycleStatus } from '@/lib/circle/workspaceDraftOrder';
import {
    buildForkReadinessViewModel,
    createForkReadinessCopy,
    type ForkQualificationSnapshot,
    type ForkReadinessViewModel,
    type Team04ForkResolvedInputs,
} from '@/features/fork-lineage/adapter';
import ForkContextPanel from '@/features/fork-lineage/ForkContextPanel';
import {
    createForkFromCircle,
    fetchForkContextView,
    fetchForkLineageView,
    fetchForkQualificationSnapshot,
    fetchForkTeam04ResolvedInputs,
    type ForkContextView,
    type ForkLineageView,
    type ForkLineageViewItem,
} from '@/lib/api/forkLineage';
import {
    clearPendingForkFinalization,
    readPendingForkFinalization,
    writePendingForkFinalization,
    type PendingForkFinalization,
} from '@/features/fork-lineage/pendingFinalization';

/* ══════════════════════════════════════════
   Sub-circle data model
   ══════════════════════════════════════════ */

/**
 * zh: 先隐藏圈层级 Agent 治理面板。
 * 当前这组策略只支持保存/回显，还没有真正驱动运行时 Agent 行为。
 * 未来如果要让圈层独立治理 AI 参数（例如触发范围、审批门槛、成本策略），
 * 再重新打开这块 UI 和对应的数据加载链路。
 *
 * en: Hide the per-circle Agent governance panel for now.
 * The current policy surface only persists and echoes values back; it does not drive runtime Agent behavior yet.
 * Re-enable this UI and its data-loading path when circles can independently govern AI parameters
 * such as trigger scope, approval thresholds, and cost policy.
 */
const CIRCLE_AGENT_GOVERNANCE_UI_ENABLED = false;
const CREATE_CIRCLE_NOTICE_AUTO_DISMISS_MS = 6000;
type CommunityPanelKey = 'circles' | 'rooms';
type IdentityJoinActionStatus =
    | 'idle'
    | 'identity_registered_and_joined'
    | 'identity_registered_join_pending'
    | 'identity_registration_failed'
    | 'join_failed_after_identity';
type AccessPolicySaveStatus =
    | 'idle'
    | 'saved'
    | 'chain_saved_policy_pending'
    | 'policy_saved_chain_pending'
    | 'requires_governance'
    | 'failed';

const DEFAULT_CIRCLE_GHOST_SETTINGS: CircleGhostSettings = {
    summaryUseLLM: false,
    draftTriggerMode: 'notify_only',
    triggerSummaryUseLLM: false,
    triggerGenerateComment: true,
};

const DEFAULT_CIRCLE_DRAFT_LIFECYCLE_TEMPLATE: CircleDraftLifecycleTemplate = {
    templateId: 'fast_deposition',
    draftGenerationVotingMinutes: 10,
    draftingWindowMinutes: 30,
    reviewWindowMinutes: 240,
    maxRevisionRounds: 1,
    reviewEntryMode: 'auto_or_manual',
};

type InviteTargetCircle = {
    id: number;
    name: string;
};

type CircleLoadContext = {
    signal?: AbortSignal;
    isCurrent?: () => boolean;
};

function isAbortError(error: unknown): boolean {
    return error instanceof Error && error.name === 'AbortError';
}

/* ── GQL role → MemberCard role mapping ── */
function mapGqlRoleToCardRole(gqlRole: string): 'owner' | 'curator' | 'member' {
    if (gqlRole === 'Owner') return 'owner';
    if (gqlRole === 'Admin' || gqlRole === 'Moderator') return 'curator';
    return 'member';
}

function resolveCircleDetailRoleLabel(
    role: CircleRoleValue | null | undefined,
    t: (key: string, values?: Record<string, string | number>) => string,
): string | null {
    if (role === 'Owner') return t('identityProgress.roles.Owner');
    if (role === 'Admin') return t('identityProgress.roles.Admin');
    if (role === 'Moderator') return t('identityProgress.roles.Moderator');
    return null;
}

function normalizeAuthorIdentity(rawAuthor: string): string {
    return String(rawAuthor || '').trim().replace(/^@/, '').toLowerCase();
}

function normalizeAuthorPubkey(rawPubkey: string | null | undefined): string {
    return canonicalPublicKeyString(rawPubkey) ?? '';
}

function matchesMemberAuthorIdentity(input: {
    author: string;
    senderPubkey?: string | null;
    handle: string | null | undefined;
    pubkey: string | null | undefined;
}): boolean {
    const rawAuthor = String(input.author || '').trim().replace(/^@/, '');
    const author = normalizeAuthorIdentity(rawAuthor);
    const senderPubkey = normalizeAuthorPubkey(input.senderPubkey);

    const handle = String(input.handle || '').trim().toLowerCase();
    const pubkey = normalizeAuthorPubkey(input.pubkey);
    if (senderPubkey && pubkey && publicKeyStringsEqual(senderPubkey, pubkey)) return true;
    if (!author) return false;

    const shortPubkey = pubkey.length > 8
        ? `${pubkey.slice(0, 4)}...${pubkey.slice(-4)}`
        : '';

    return author === handle || rawAuthor === pubkey || rawAuthor === shortPubkey;
}

function normalizeMembershipActionError(
    error: unknown,
    fallback: string,
    t: (key: string, values?: Record<string, string | number>) => string,
): string {
    const message = error instanceof Error ? error.message : String(error || '');
    if (message.includes('auxiliary_invitee_parent_membership_required')) {
        return t('memberDirectory.actionErrors.parentMembershipRequired');
    }
    if (message.includes('403')) return t('memberDirectory.actionErrors.forbidden');
    if (message.includes('404')) return t('memberDirectory.actionErrors.memberGone');
    if (message.includes('active_invite_exists')) return t('memberDirectory.actionErrors.activeInviteExists');
    if (message.includes('invitee_already_member')) return t('memberDirectory.actionErrors.alreadyMember');
    if (message.includes('protected_member_role')) return t('memberDirectory.actionErrors.protectedRole');
    if (message.includes('self_removal_not_supported')) return t('memberDirectory.actionErrors.selfRemovalUnsupported');
    if (message.includes('self_role_change_not_supported')) return t('memberDirectory.actionErrors.selfRoleChangeUnsupported');
    if (message.includes('browser_only_mock_unsupported')) return t('memberDirectory.actionErrors.browserMockUnsupported');
    return fallback;
}

function normalizeNotificationType(raw: string): Notification['type'] {
    if (
        raw === 'post'
        || raw === 'crystal'
        || raw === 'mention'
        || raw === 'draft'
        || raw === 'identity'
        || raw === 'invite'
        || raw === 'useful'
        || raw === 'forward'
        || raw === 'citation'
        || raw === 'circle'
    ) {
        return raw;
    }
    return 'system';
}

function normalizeDraftDocumentStatus(raw: string | null | undefined): WorkspaceDraftLifecycleStatus {
    if (
        raw === 'drafting'
        || raw === 'review'
        || raw === 'crystallization_active'
        || raw === 'crystallization_failed'
        || raw === 'crystallized'
        || raw === 'archived'
    ) {
        return raw;
    }
    return 'drafting';
}

function formatForkLineageDate(value: string | null | undefined, locale: string): string | null {
    if (!value) return null;
    const parsed = new Date(value);
    if (Number.isNaN(parsed.getTime())) return null;
    return parsed.toLocaleDateString(locale, {
        month: 'short',
        day: 'numeric',
    });
}

function shortenForkLineageToken(value: string | null | undefined): string | null {
    const trimmed = String(value || '').trim();
    if (!trimmed) return null;
    if (trimmed.length <= 22) {
        return trimmed;
    }
    return `${trimmed.slice(0, 10)}...${trimmed.slice(-8)}`;
}

function readForkTargetGovernanceHome(
    manifest: Record<string, unknown> | null,
): { identityBindingId: string; bootstrapState: string } | null {
    const target = manifest?.target;
    if (!target || typeof target !== 'object' || Array.isArray(target)) return null;
    const identityBindingId = String(
        (target as Record<string, unknown>).governanceHomeIdentityBindingId || '',
    ).trim();
    const bootstrapState = String(
        (target as Record<string, unknown>).governanceBootstrapState || '',
    ).trim();
    return identityBindingId && bootstrapState
        ? { identityBindingId, bootstrapState }
        : null;
}

function formatForkDeclarationStatus(
    status: string,
    t: (key: string, values?: Record<string, string | number>) => string,
): string {
    if (status === 'completed') return t('forkLineage.status.completed');
    if (status === 'reconciliation_pending') return t('forkLineage.status.reconciliationPending');
    if (status === 'prepared') return t('forkLineage.status.prepared');
    return status;
}

function describeForkMarkerState(
    item: ForkLineageViewItem,
    t: (key: string, values?: Record<string, string | number>) => string,
    locale: string,
): string {
    if (item.permanentAt) {
        const permanentAt = formatForkLineageDate(item.permanentAt, locale);
        return permanentAt
            ? t('forkLineage.marker.permanentWithDate', {date: permanentAt})
            : t('forkLineage.marker.permanent');
    }
    if (item.markerVisible === false) {
        const hiddenAt = formatForkLineageDate(item.hiddenAt, locale);
        return hiddenAt
            ? t('forkLineage.marker.hiddenWithDate', {date: hiddenAt})
            : t('forkLineage.marker.hidden');
    }
    if (item.markerVisible === true) {
        if (typeof item.currentCheckpointDay === 'number' && item.currentCheckpointDay > 0) {
            return t('forkLineage.marker.visibleWithCheckpoint', {day: item.currentCheckpointDay});
        }
        return t('forkLineage.marker.visible');
    }
    return t('forkLineage.marker.pendingInit');
}

function describeForkMarkerSchedule(
    item: ForkLineageViewItem,
    t: (key: string, values?: Record<string, string | number>) => string,
    locale: string,
): string | null {
    if (item.permanentAt || item.hiddenAt) {
        return null;
    }
    if (typeof item.inactiveStreak === 'number' && item.inactiveStreak > 0 && item.nextCheckAt) {
        const nextCheckAt = formatForkLineageDate(item.nextCheckAt, locale);
        return nextCheckAt
            ? t('forkLineage.schedule.inactiveWithNextCheck', {count: item.inactiveStreak, date: nextCheckAt})
            : t('forkLineage.schedule.inactiveOnly', {count: item.inactiveStreak});
    }
    if (item.nextCheckAt) {
        const nextCheckAt = formatForkLineageDate(item.nextCheckAt, locale);
        return nextCheckAt
            ? t('forkLineage.schedule.nextCheck', {date: nextCheckAt})
            : t('forkLineage.schedule.waitingNextCheck');
    }
    if (typeof item.inactiveStreak === 'number' && item.inactiveStreak > 0) {
        return t('forkLineage.schedule.inactiveOnly', {count: item.inactiveStreak});
    }
    return null;
}

/* ── (Notifications are fetched from API below) ── */

/* ── Sticky last-active circle (localStorage) ── */
function getLastActiveSubCircle(circleId: number): string | null {
    if (typeof window === 'undefined') return null;
    try {
        return localStorage.getItem(`alcheme_active_tier_${circleId}`);
    } catch { return null; }
}

function setLastActiveSubCircle(circleId: number, subCircleId: string) {
    if (typeof window === 'undefined') return;
    try {
        localStorage.setItem(`alcheme_active_tier_${circleId}`, subCircleId);
    } catch { /* ignore */ }
}

function isKnowledgeCircleTab(tab: NotificationTab | null): tab is 'crucible' | 'sanctuary' {
    return tab === 'crucible' || tab === 'sanctuary';
}

function mapAccessRequirementToAccessType(input: CircleAccessRequirement): 'free' | 'crystal' | 'invite' | 'approval' {
    return accessRequirementToAccessType(input);
}

function normalizeForkActorIdentityLevel(
    value: string | null | undefined,
): 'Visitor' | 'Initiate' | 'Member' | 'Elder' | null {
    if (value === 'Initiate' || value === 'Member' || value === 'Elder') {
        return value;
    }
    if (value === 'Visitor') {
        return 'Visitor';
    }
    return null;
}

async function sha256Hex(input: string): Promise<string> {
    const payload = new TextEncoder().encode(input);
    const buffer = payload.buffer.slice(
        payload.byteOffset,
        payload.byteOffset + payload.byteLength,
    ) as ArrayBuffer;
    const digest = await globalThis.crypto.subtle.digest('SHA-256', buffer);
    return Array.from(new Uint8Array(digest))
        .map((byte) => byte.toString(16).padStart(2, '0'))
        .join('');
}

function createForkDeclarationId(sourceCircleId: number): string {
    if (typeof globalThis.crypto?.randomUUID === 'function') {
        return `fork-${sourceCircleId}-${globalThis.crypto.randomUUID()}`;
    }
    return `fork-${sourceCircleId}-${Date.now()}-${Math.random().toString(16).slice(2, 10)}`;
}

function createTabDefs(
    t: (key: string, values?: Record<string, string | number>) => string,
): Record<string, { id: string; label: string; icon: React.ReactNode }> {
    return {
        plaza: { id: 'plaza', label: t('tabs.plaza'), icon: <MessageSquare size={16} /> },
        feed: { id: 'feed', label: t('tabs.feed'), icon: <Rss size={16} /> },
        crucible: { id: 'crucible', label: t('tabs.crucible'), icon: <FileEdit size={16} /> },
        sanctuary: { id: 'sanctuary', label: t('tabs.sanctuary'), icon: <BookOpen size={16} /> },
        governance: { id: 'governance', label: t('tabs.governance'), icon: <Landmark size={16} /> },
    };
}

/* ══════════════════════════════════════════
   Main Page Component
   ══════════════════════════════════════════ */

export default function CircleDetailPage() {
    const params = useParams();
    const router = useRouter();
    const searchParams = useSearchParams();
    const { connection } = useConnection();
    const { publicKey, signMessage, sendTransaction } = useWallet();
    const { requestWalletConnection } = useWalletAction();
    const { runWalletAction, signMessageForAction } = useWalletActionRunner();
    const {
        identityState,
        lastErrorMessage,
        refreshIdentityState,
        sessionUser,
    } = useIdentityOnboarding();
    const walletPubkey = publicKey?.toBase58() || null;
    const sessionUserPubkey = sessionUser?.pubkey ?? null;
    const circleDetailT = useI18n('CircleDetailPage');
    const forkReadinessT = useI18n('ForkReadiness');
    const circleTreeT = useI18n('CircleTreePanel');
    const circleRoomsT = useI18n('CircleRoomsPanel');
    const locale = useCurrentLocale();
    const discussionWalletPolicy = useMemo(() => resolveDiscussionWalletPolicy({
        discussionAuthMode: process.env.NEXT_PUBLIC_DISCUSSION_AUTH_MODE,
        requireSignature: process.env.NEXT_PUBLIC_DISCUSSION_REQUIRE_SIGNATURE,
    }), []);
    const useSessionTokenAuth = discussionWalletPolicy.useSessionTokenAuth;
    const joinCopy = useMemo(() => createCircleJoinCopy(circleDetailT), [circleDetailT]);
    const identityCopy = useMemo(() => createIdentityCopy(circleDetailT), [circleDetailT]);
    const tabDefs = useMemo(() => createTabDefs(circleDetailT), [circleDetailT]);
    const formatRelativeTime = useCallback((value: string) => timeAgo(value, locale), [locale]);
    const sdk = useAlchemeSDK();
    const circleId = Number(params.id);
    const requestedRouteTab = normalizeCircleRouteTab(searchParams.get('tab'));
    const requestedRouteDraftId = Number(searchParams.get('draft'));
    const rawRequestedRouteDraftVersion = Number(searchParams.get('draftVersion'));
    const requestedRouteDraftVersion = Number.isInteger(rawRequestedRouteDraftVersion)
        && rawRequestedRouteDraftVersion > 0
        ? rawRequestedRouteDraftVersion
        : null;
    const requestedBoundDraftId = Number.isInteger(requestedRouteDraftId) && requestedRouteDraftId > 0
        ? requestedRouteDraftId
        : null;
    const requestedShortcutCircleId = String(searchParams.get('shortcutCircleId') || '').trim() || null;
    const focusEnvelopeId = String(searchParams.get('focusEnvelopeId') || '').trim() || null;
    const focusedAnnouncementId = String(searchParams.get('announcementId') || '').trim() || null;
    const requestedSettingsPanel = String(searchParams.get('settings') || '').trim();
    const returnGovernanceCaseId = String(searchParams.get('returnCase') || '').trim() || null;
    const lastAppliedRouteTabRef = useRef<string | null>(null);
    const [activeTab, setActiveTab] = useState<string>(requestedRouteTab || 'plaza');
    const [requestedCrucibleDraftId, setRequestedCrucibleDraftId] = useState<number | null>(
        Number.isInteger(requestedRouteDraftId) && requestedRouteDraftId > 0 ? requestedRouteDraftId : null,
    );
    const {
        hydrated: shortcutsHydrated,
        primaryShortcut,
        addShortcut,
        removeShortcut,
    } = useCircleShortcuts();

    /* ── Data fetching ── */
    const { data, loading, refetch } = useQuery<CircleResponse>(GET_CIRCLE, {
        variables: { id: circleId },
        skip: isNaN(circleId),
        errorPolicy: 'all',
    });

    const hasRealData = !!data?.circle;
    const circleName = data?.circle?.name || circleDetailT('defaults.unknownCircle');

    const mappedSubCircles: SubCircle[] = useMemo(() => {
        if (data?.circle) {
            const root = data.circle;
            const descendants = (data.circleDescendants || []).filter((circle) => circle.lifecycleStatus === 'Active');
            const res: SubCircle[] = [];
            const knownCircleIds = new Set<number>([root.id, ...descendants.map((c) => c.id)]);

            const normalizeKind = (kind: string | null | undefined): 'main' | 'auxiliary' =>
                typeof kind === 'string' && kind.toLowerCase() === 'auxiliary' ? 'auxiliary' : 'main';
            const normalizeMode = (mode: string | null | undefined): 'social' | 'knowledge' =>
                typeof mode === 'string' && mode.toLowerCase() === 'social' ? 'social' : 'knowledge';
            const resolveTabs = (_kind: 'main' | 'auxiliary', mode: 'social' | 'knowledge'): SubCircle['tabs'] =>
                resolveChromeTabs(mode);

            const rootKind = normalizeKind(root.kind);
            const rootMode = normalizeMode(root.mode);
            res.push({
                id: String(root.id),
                name: root.name || circleDetailT('defaults.publicCircle'),
                level: root.level ?? 0,
                isDefault: true,
                accessRequirement: resolveCircleAccessRequirement(root),
                memberCount: root.stats?.members || 0,
                crystalCount: root.knowledgeCount || 0,
                kind: rootKind,
                mode: rootMode,
                parentId: null,
                tabs: resolveTabs(rootKind, rootMode),
                genesisMode: (root.genesisMode as 'BLANK' | 'SEEDED') || 'BLANK',
            });

            const orderedDescendants = [...descendants].sort((a, b) => {
                if (a.level !== b.level) return (a.level ?? 0) - (b.level ?? 0);
                return a.id - b.id;
            });

            orderedDescendants.forEach((circle) => {
                if (circle.id === root.id) return;
                const kind = normalizeKind(circle.kind);
                const mode = normalizeMode(circle.mode);
                const parentId =
                    circle.parentCircleId != null && knownCircleIds.has(circle.parentCircleId)
                        ? String(circle.parentCircleId)
                        : kind === 'auxiliary'
                            ? String(root.id)
                            : null;

                res.push({
                    id: String(circle.id),
                    name: circle.name,
                    // IMPORTANT: level can legitimately be 0 (aux circle under Lv.0).
                    level: circle.level ?? 1,
                    isDefault: false,
                    accessRequirement: resolveCircleAccessRequirement(circle),
                    memberCount: circle.stats?.members || 0,
                    crystalCount: circle.knowledgeCount || 0,
                    kind,
                    mode,
                    parentId,
                    tabs: resolveTabs(kind, mode),
                    genesisMode: (circle.genesisMode as 'BLANK' | 'SEEDED') || 'BLANK',
                });
            });

            return res;
        }

        // Fallback to a dynamic default if real data hasn't loaded (e.g., loading state)
        return [{
            id: String(circleId),
            name: circleDetailT('defaults.publicCircle'),
            level: 0,
            isDefault: true,
            accessRequirement: { type: 'free' },
            memberCount: 0,
            crystalCount: 0,
            kind: 'main',
            mode: 'knowledge',
            parentId: null,
            tabs: resolveChromeTabs('knowledge'),
            genesisMode: 'BLANK',
        }];
    }, [data?.circle, data?.circleDescendants, circleId]);

    const subCircles = mappedSubCircles;

    const routeTierId = useMemo(() => {
        if (requestedShortcutCircleId && subCircles.find((s) => s.id === requestedShortcutCircleId)) {
            return requestedShortcutCircleId;
        }
        const routeId = String(circleId);
        return subCircles.find((s) => s.id === routeId)?.id || null;
    }, [subCircles, circleId, requestedShortcutCircleId]);
    const defaultTierId = routeTierId || subCircles.find((s) => s.isDefault)?.id || subCircles[0]?.id || String(circleId);
    const [activeTierId, setActiveTierId] = useState<string>(defaultTierId);
    const primaryShortcutAutoEnterTierId = useMemo(() => {
        if (!shortcutsHydrated || !primaryShortcut) return null;
        if (primaryShortcut.rootCircleId !== circleId) return null;
        const hasExplicitIntent = Boolean(requestedShortcutCircleId || requestedRouteTab || focusEnvelopeId);
        if (!shouldAutoEnterCircleShortcut({
            shortcut: primaryShortcut,
            hasExplicitIntent,
        })) {
            return null;
        }
        return String(primaryShortcut.circleId);
    }, [
        circleId,
        focusEnvelopeId,
        primaryShortcut,
        requestedRouteTab,
        requestedShortcutCircleId,
        shortcutsHydrated,
    ]);

    const [isPillLifted, setIsPillLifted] = useState(false);
    // Boundary floating pills: 'left' = at first tab swiping right, 'right' = at last tab swiping left
    const [boundaryPills, setBoundaryPills] = useState<'left' | 'right' | null>(null);
    const boundaryTimer = useRef<ReturnType<typeof setTimeout> | null>(null);

    // ── P2: Circle creation & settings ──
    const [showCreateCircle, setShowCreateCircle] = useState(false);
    const [showForkCreateSheet, setShowForkCreateSheet] = useState(false);
    const [createPermissionError, setCreatePermissionError] = useState<string | null>(null);
    const [forkCreateError, setForkCreateError] = useState<string | null>(null);
    const [forkCreateHint, setForkCreateHint] = useState<ForkReadinessViewModel | null>(null);
    const [forkCreateInputs, setForkCreateInputs] = useState<Team04ForkResolvedInputs | null>(null);
    const [forkQualificationSnapshot, setForkQualificationSnapshot] = useState<ForkQualificationSnapshot | null>(null);
    const [forkCreateLoading, setForkCreateLoading] = useState(false);
    const [pendingForkFinalization, setPendingForkFinalization] = useState<PendingForkFinalization | null>(null);
    const [forkLineage, setForkLineage] = useState<ForkLineageView | null>(null);
    const [forkLineageLoading, setForkLineageLoading] = useState(false);
    const [forkLineageError, setForkLineageError] = useState<string | null>(null);
    const [forkContext, setForkContext] = useState<ForkContextView | null>(null);
    const [forkContextLoading, setForkContextLoading] = useState(false);
    const [forkContextError, setForkContextError] = useState<string | null>(null);
    const [showSettings, setShowSettings] = useState(
        requestedSettingsPanel === 'members' || requestedSettingsPanel === 'governance',
    );
    const activeSettingsCircleIdRef = useRef<number | null>(circleId);
    const baselineCircleLoadGenerationRef = useRef(0);
    const settingsCircleLoadGenerationRef = useRef(0);
    const [circleGhostSettings, setCircleGhostSettings] = useState<CircleGhostSettings | null>(null);
    const [circleGhostSettingsSource, setCircleGhostSettingsSource] = useState<'circle' | 'pending' | 'global_default' | null>(null);
    const [circleGhostSettingsGovernancePending, setCircleGhostSettingsGovernancePending] = useState<CircleGhostSettingsGovernancePending | null>(null);
    const [circleGhostSettingsLoading, setCircleGhostSettingsLoading] = useState(false);
    const [circleGhostSettingsSaving, setCircleGhostSettingsSaving] = useState(false);
    const [circleGhostSettingsError, setCircleGhostSettingsError] = useState<string | null>(null);
    const [circlePrimaryGeoAnchor, setCirclePrimaryGeoAnchor] = useState<CircleGeoAnchorDto | null>(null);
    const [circlePrimaryGeoAnchorLoading, setCirclePrimaryGeoAnchorLoading] = useState(false);
    const [circlePrimaryGeoAnchorSaving, setCirclePrimaryGeoAnchorSaving] = useState(false);
    const [circlePrimaryGeoAnchorError, setCirclePrimaryGeoAnchorError] = useState<string | null>(null);
    const [circlePrimaryGeoAnchorGovernanceRequestId, setCirclePrimaryGeoAnchorGovernanceRequestId] = useState<string | null>(null);
    const [circlePolicyDraftLifecycleTemplate, setCirclePolicyDraftLifecycleTemplate] = useState<CircleDraftLifecycleTemplate | null>(null);
    const [circlePolicyDraftWorkflowPolicy, setCirclePolicyDraftWorkflowPolicy] = useState<CircleDraftWorkflowPolicy | null>(null);
    const [circlePolicyForkPolicy, setCirclePolicyForkPolicy] = useState<CircleForkPolicy | null>(null);
    const [circlePolicyLoading, setCirclePolicyLoading] = useState(false);
    const [circlePolicySaving, setCirclePolicySaving] = useState(false);
    const [circlePolicyError, setCirclePolicyError] = useState<string | null>(null);
    const [circlePolicyNotice, setCirclePolicyNotice] = useState<string | null>(null);
    const [circleDraftPrompts, setCircleDraftPrompts] = useState<CircleDraftPromptScopeReadback[]>([]);
    const [circleDraftPromptsLoading, setCircleDraftPromptsLoading] = useState(false);
    const [circleDraftPromptsSaving, setCircleDraftPromptsSaving] = useState(false);
    const [circleDraftPromptsError, setCircleDraftPromptsError] = useState<string | null>(null);
    const [circleAccessPolicySaving, setCircleAccessPolicySaving] = useState(false);
    const [circleAccessPolicyError, setCircleAccessPolicyError] = useState<string | null>(null);
    const [circleAccessPolicyStatus, setCircleAccessPolicyStatus] = useState<AccessPolicySaveStatus>('idle');
    const [circleAgents, setCircleAgents] = useState<CircleAgentRecord[]>([]);
    const [circleAgentPolicy, setCircleAgentPolicy] = useState<CircleAgentPolicy | null>(null);
    const [circleAgentPolicyLoading, setCircleAgentPolicyLoading] = useState(false);
    const [circleAgentPolicySaving, setCircleAgentPolicySaving] = useState(false);
    const [circleAgentPolicyError, setCircleAgentPolicyError] = useState<string | null>(null);
    const [circleGovernanceBindings, setCircleGovernanceBindings] = useState<CircleGovernanceBinding[]>([]);
    const [circleGovernanceResourceReadiness, setCircleGovernanceResourceReadiness] = useState<CircleGovernanceResourceReadiness | null>(null);
    const [governanceRecovery, setGovernanceRecovery] = useState<GovernanceRecoveryReadback | null>(null);
    const [committeeGovernanceBindings, setCommitteeGovernanceBindings] = useState<CircleGovernanceBinding[]>([]);
    const [circleGovernanceCommitteeProfile, setCircleGovernanceCommitteeProfile] = useState<CircleGovernanceCommitteeProfile | null>(null);
    const [circleGovernanceCommitteeProfileLoading, setCircleGovernanceCommitteeProfileLoading] = useState(false);
    const [circleGovernanceCommitteeProfileStatus, setCircleGovernanceCommitteeProfileStatus] = useState<{
        state: 'idle' | 'saving' | 'requires_governance' | 'executed' | 'error';
        requestId?: string | null;
        message?: string | null;
    }>({ state: 'idle' });
    const [committeeGovernanceRequests, setCommitteeGovernanceRequests] = useState<CircleGovernanceRequest[]>([]);
    const [committeeGovernanceRequestsLoading, setCommitteeGovernanceRequestsLoading] = useState(false);
    const [committeeGovernanceSignalActionKey, setCommitteeGovernanceSignalActionKey] = useState<string | null>(null);
    const [committeeGovernanceSignalError, setCommitteeGovernanceSignalError] = useState<string | null>(null);
    const [circleOwnerTransferRequests, setCircleOwnerTransferRequests] = useState<CircleOwnerTransferRequest[]>([]);
    const [circleLifecycleActionStatus, setCircleLifecycleActionStatus] = useState<{
        state: 'idle' | 'saving' | 'requires_governance' | 'awaiting_wallet' | 'reconciliation_pending' | 'converged' | 'dissolution_pending' | 'merge_pending' | 'merged' | 'blocked' | 'error';
        requestId?: string | null;
        plan?: CircleLifecyclePlanReadback | null;
        message?: string | null;
    }>({ state: 'idle' });
    const [circleMergeActionStatus, setCircleMergeActionStatus] = useState<{
        state: 'idle' | 'saving' | 'requires_source_governance' | 'source_approved' | 'requires_successor_governance' | 'merge_pending' | 'merged' | 'error';
        sourceRequestId?: string | null;
        successorRequestId?: string | null;
        plan?: CircleLifecyclePlanReadback | null;
        message?: string | null;
    }>({ state: 'idle' });
    const [selectedMember, setSelectedMember] = useState<MemberProfile | null>(null);
    const [showNotifications, setShowNotifications] = useState(false);
    const [identityProgressExpanded, setIdentityProgressExpanded] = useState(false);
    const [openCommunityPanel, setOpenCommunityPanel] = useState<CommunityPanelKey | null>(null);
    const [identityTransitionDismissed, setIdentityTransitionDismissed] = useState(false);
    const [createCircleStatusNotice, setCreateCircleStatusNotice] = useState<string | null>(null);
    const [, setPendingInviteCircleId] = useState<number | null>(null);
    const {
        createCircle,
        clearNotice: clearCreateCircleNotice,
        loading: isCreatingCircle,
        error: createCircleError,
        notice: createCircleNotice,
    } = useCreateCircle();
    const selectedMemberRequestRef = useRef<number | null>(null);
    const inviteSourceRequestRef = useRef<number | null>(null);
    const restoredPendingForkSourceRef = useRef<number | null>(null);
    const communityPanelsRef = useRef<HTMLDivElement | null>(null);
    const [loadMemberProfile] = useLazyQuery<MemberProfileResponse>(GET_MEMBER_PROFILE, {
        fetchPolicy: 'network-only',
    });
    const [loadInviteSourceCircle] = useLazyQuery<CircleResponse>(GET_CIRCLE, {
        fetchPolicy: 'network-only',
    });
    const [searchInviteDirectory] = useLazyQuery<SearchUsersResponse>(SEARCH_USERS, {
        fetchPolicy: 'network-only',
    });

    useEffect(() => {
        if (requestedSettingsPanel === 'members' || requestedSettingsPanel === 'governance') {
            setShowSettings(true);
        }
    }, [requestedSettingsPanel]);

    useEffect(() => {
        if (!openCommunityPanel) return;
        const handlePointerDown = (event: PointerEvent) => {
            const target = event.target;
            if (!(target instanceof Node)) return;
            if (!communityPanelsRef.current?.contains(target)) {
                setOpenCommunityPanel(null);
            }
        };
        const handleKeyDown = (event: KeyboardEvent) => {
            if (event.key === 'Escape') {
                setOpenCommunityPanel(null);
            }
        };
        document.addEventListener('pointerdown', handlePointerDown);
        document.addEventListener('keydown', handleKeyDown);
        return () => {
            document.removeEventListener('pointerdown', handlePointerDown);
            document.removeEventListener('keydown', handleKeyDown);
        };
    }, [openCommunityPanel]);

    // ── Membership state (REST) ──
    const [membershipSnapshot, setMembershipSnapshot] = useState<CircleMembershipSnapshot | null>(null);
    const [membershipRefreshFailed, setMembershipRefreshFailed] = useState(false);
    const [activeTierMembershipSnapshot, setActiveTierMembershipSnapshot] = useState<CircleMembershipSnapshot | null>(null);
    const [activeTierMembershipLoading, setActiveTierMembershipLoading] = useState(false);
    const [activeTierMembershipRefreshFailed, setActiveTierMembershipRefreshFailed] = useState(false);
    const [identityStatus, setIdentityStatus] = useState<CircleIdentityStatus | null>(null);
    const [activeTierIdentityStatus, setActiveTierIdentityStatus] = useState<CircleIdentityStatus | null>(null);
    const [joinActionLoading, setJoinActionLoading] = useState(false);
    const [joinActionError, setJoinActionError] = useState<string | null>(null);
    const [identityJoinActionStatus, setIdentityJoinActionStatus] = useState<IdentityJoinActionStatus>('idle');
    const [showRegisterIdentitySheet, setShowRegisterIdentitySheet] = useState(false);
    const {
        registerIdentity,
        loading: identityRegistrationLoading,
        syncing: identityRegistrationSyncing,
        error: identityRegistrationError,
    } = useRegisterIdentity();
    const identityJoinWalletImpact = useMemo(() => resolveIdentityJoinWalletImpact({
        needsIdentityRegistration: true,
        requiresSessionSignature: requiresAuthSessionSignature(),
        willJoinCircle: true,
    }), []);

    useEffect(() => {
        if (subCircles.length === 0) return;
        const nextTierId = resolvePreferredActiveTierId({
            circleId,
            routeTierId,
            defaultTierId,
            savedTierId: getLastActiveSubCircle(circleId),
            shortcutTierId: primaryShortcutAutoEnterTierId,
            requestedRouteTab,
            focusEnvelopeId,
            subCircles: subCircles.map((circle) => ({
                id: circle.id,
                tabs: circle.tabs,
                mode: circle.mode,
                accessRequirement: circle.accessRequirement,
            })),
        });
        setActiveTierId(nextTierId);
    }, [
        circleId,
        defaultTierId,
        focusEnvelopeId,
        primaryShortcutAutoEnterTierId,
        requestedRouteTab,
        routeTierId,
        subCircles,
    ]);

    useEffect(() => {
        if (isNaN(circleId) || circleId <= 0) return;
        return startMembershipRefresh({
            circleId,
            reset: () => {
                setMembershipSnapshot(null);
                setIdentityStatus(null);
                setMembershipRefreshFailed(false);
            },
            fetchSnapshot: fetchCircleMembershipState,
            fetchStatus: fetchCircleIdentityStatus,
            apply: ({ snapshot, status, snapshotFailed, statusFailed }) => {
                setMembershipSnapshot(snapshot);
                setIdentityStatus(status);
                setMembershipRefreshFailed(snapshotFailed || statusFailed);
            },
        });
    }, [circleId, publicKey, identityState, locale, sessionUser?.id]);

    const activeMembershipCircleId = Number(activeTierId || circleId);

    const applyMembershipSnapshot = useCallback((targetCircleId: number, snapshot: CircleMembershipSnapshot) => {
        if (targetCircleId === circleId) {
            setMembershipSnapshot(snapshot);
            return;
        }
        if (targetCircleId === activeMembershipCircleId) {
            setActiveTierMembershipSnapshot(snapshot);
        }
    }, [activeMembershipCircleId, circleId]);

    const applyIdentityStatusSnapshot = useCallback((targetCircleId: number, status: CircleIdentityStatus) => {
        if (targetCircleId === circleId) {
            setIdentityStatus(status);
            return;
        }
        if (targetCircleId === activeMembershipCircleId) {
            setActiveTierIdentityStatus(status);
        }
    }, [activeMembershipCircleId, circleId]);

    const handleJoin = useCallback(async () => {
        if (joinActionLoading) return;
        const targetCircleId = activeMembershipCircleId;
        const continuingIdentityJoin =
            identityJoinActionStatus === 'identity_registered_join_pending'
            || identityJoinActionStatus === 'join_failed_after_identity';
        // If wallet not connected, open wallet modal instead of calling API
        if (!publicKey) {
            requestWalletConnection({ source: 'circle_join' });
            return;
        }
        const targetSnapshot = resolveActiveMembershipSnapshot({
            routeCircleId: circleId,
            activeCircleId: targetCircleId,
            routeSnapshot: membershipSnapshot,
            activeTierSnapshot: activeTierMembershipSnapshot,
        });
        let effectiveSnapshot = targetSnapshot;
        if (!effectiveSnapshot) {
            if (identityState === 'unregistered') {
                setShowRegisterIdentitySheet(true);
                return;
            }
            setJoinActionLoading(true);
            setJoinActionError(null);
            try {
                if (identityState === 'session_error' || identityState === 'connecting_session') {
                    await refreshIdentityState();
                }
                const [snap, status] = await Promise.all([
                    fetchCircleMembershipState(targetCircleId).catch(() => null),
                    fetchCircleIdentityStatus(targetCircleId).catch(() => null),
                ]);
                if (targetCircleId === circleId) {
                    setMembershipSnapshot(snap);
                    setIdentityStatus(status);
                } else {
                    setActiveTierMembershipSnapshot(snap);
                    setActiveTierIdentityStatus(status);
                }
                effectiveSnapshot = snap;
            } finally {
                setJoinActionLoading(false);
            }
            if (!effectiveSnapshot) {
                setJoinActionError(circleDetailT('join.banner.retrySessionHint'));
                return;
            }
        }
        if (!effectiveSnapshot.authenticated) {
            setShowRegisterIdentitySheet(true);
            return;
        }
        setJoinActionLoading(true);
        setJoinActionError(null);
        try {
            const result = await runWalletAction({
                kind: 'circle_join',
                source: 'circle_join',
                key: `circle_join:${targetCircleId}`,
                run: () => joinCircle(targetCircleId, undefined, sdk),
            });
            // Refresh snapshot after join
            const [snap, status] = await Promise.all([
                fetchCircleMembershipState(targetCircleId),
                fetchCircleIdentityStatus(targetCircleId),
            ]);
            applyMembershipSnapshot(targetCircleId, snap);
            applyIdentityStatusSnapshot(targetCircleId, status);
            if (result.joinState === 'joined') {
                if (continuingIdentityJoin) {
                    setIdentityJoinActionStatus('identity_registered_and_joined');
                }
                setJoinActionError(null);
                refetch();
            }
        } catch (err) {
            if (continuingIdentityJoin) {
                setIdentityJoinActionStatus('join_failed_after_identity');
            }
            setJoinActionError(normalizeJoinActionError(err, joinCopy));
        } finally {
            setJoinActionLoading(false);
        }
    }, [
        activeMembershipCircleId,
        activeTierMembershipSnapshot,
        applyMembershipSnapshot,
        applyIdentityStatusSnapshot,
        circleId,
        identityState,
        identityJoinActionStatus,
        joinActionLoading,
        joinCopy,
        membershipSnapshot,
        locale,
        publicKey,
        refetch,
        refreshIdentityState,
        requestWalletConnection,
        runWalletAction,
        sdk,
    ]);

    const handleRegisterIdentityAndJoin = useCallback(async (handle: string) => {
        const targetCircleId = activeMembershipCircleId;
        setIdentityJoinActionStatus('idle');
        setJoinActionError(null);
        const registered = await registerIdentity({ handle });
        if (!registered) {
            setIdentityJoinActionStatus('identity_registration_failed');
            return;
        }
        await refreshIdentityState();
        setIdentityJoinActionStatus('identity_registered_join_pending');

        setShowRegisterIdentitySheet(false);

        try {
            const [snap, status] = await Promise.all([
                fetchCircleMembershipState(targetCircleId),
                fetchCircleIdentityStatus(targetCircleId),
            ]);
            applyMembershipSnapshot(targetCircleId, snap);
            applyIdentityStatusSnapshot(targetCircleId, status);
        } catch {
            // Best-effort refresh so the UI exits the identity-creation state
            // before we attempt the follow-up join finalization.
        }

        setJoinActionLoading(true);
        setJoinActionError(null);
        try {
            const result = await runWalletAction({
                kind: 'circle_join',
                source: 'circle_join_after_identity_registration',
                key: `circle_join:${targetCircleId}`,
                run: () => joinCircle(targetCircleId, undefined, sdk),
            });
            const [snap, status] = await Promise.all([
                fetchCircleMembershipState(targetCircleId),
                fetchCircleIdentityStatus(targetCircleId),
            ]);
            applyMembershipSnapshot(targetCircleId, snap);
            applyIdentityStatusSnapshot(targetCircleId, status);
            if (result.joinState === 'joined') {
                setIdentityJoinActionStatus('identity_registered_and_joined');
                setJoinActionError(null);
                refetch();
            } else {
                setIdentityJoinActionStatus('identity_registered_join_pending');
                setJoinActionError(circleDetailT('join.identityAfterRegistration.joinPending'));
            }
        } catch (err) {
            const normalized = normalizeJoinActionError(err, joinCopy);
            setIdentityJoinActionStatus('join_failed_after_identity');
            setJoinActionError(circleDetailT('join.identityAfterRegistration.joinFailed', {
                reason: normalized,
            }));
        } finally {
            setJoinActionLoading(false);
        }
    }, [
        activeMembershipCircleId,
        applyMembershipSnapshot,
        applyIdentityStatusSnapshot,
        circleDetailT,
        joinCopy,
        locale,
        refetch,
        registerIdentity,
        refreshIdentityState,
        runWalletAction,
        sdk,
    ]);

    // ── P6: Invite flow state ──
    const [showInviteSheet, setShowInviteSheet] = useState(false);
    const [selectedCrystal, setSelectedCrystal] = useState<(CrystalDetail & { patinaLevel: string }) | null>(null);
    const [selectedFeedThreadContentId, setSelectedFeedThreadContentId] = useState<string | null>(null);
    const [inviteTargetCircle, setInviteTargetCircle] = useState<InviteTargetCircle | null>(null);
    const [inviteSourceCircleOverride, setInviteSourceCircleOverride] = useState<CircleResponse['circle'] | null>(null);

    // Auto-dismiss boundary pills after 3s
    useEffect(() => {
        if (boundaryPills) {
            boundaryTimer.current = setTimeout(() => setBoundaryPills(null), 3000);
            return () => { if (boundaryTimer.current) clearTimeout(boundaryTimer.current); };
        }
    }, [boundaryPills]);

    const activeSubCircle = useMemo(
        () => subCircles.find((s) => s.id === activeTierId) || subCircles[0],
        [subCircles, activeTierId],
    );
    const activeDiscussionCircleId = useMemo(() => {
        const parsed = Number(activeSubCircle?.id || circleId);
        return Number.isFinite(parsed) ? parsed : circleId;
    }, [activeSubCircle?.id, circleId]);
    const reconcileActiveDiscussionMembership = useCallback(async () => {
        const targetCircleId = activeDiscussionCircleId;
        const [snap, status] = await Promise.all([
            fetchCircleMembershipState(targetCircleId),
            fetchCircleIdentityStatus(targetCircleId),
        ]);
        applyMembershipSnapshot(targetCircleId, snap);
        applyIdentityStatusSnapshot(targetCircleId, status);
    }, [activeDiscussionCircleId, applyMembershipSnapshot, applyIdentityStatusSnapshot]);
    useEffect(() => {
        setRequestedCrucibleDraftId(null);
    }, [activeDiscussionCircleId]);
    const activeCircleIdForSettings = useMemo(() => {
        const parsed = Number(activeSubCircle?.id || circleId);
        return Number.isFinite(parsed) ? parsed : null;
    }, [activeSubCircle?.id, circleId]);
    const activeCircleTypeForSettings = useMemo(() => {
        if (activeCircleIdForSettings === null) return null;
        const circle = [data?.circle, ...(data?.circleDescendants ?? [])]
            .find((candidate) => candidate?.id === activeCircleIdForSettings);
        return circle?.circleType === 'Open'
            || circle?.circleType === 'Closed'
            || circle?.circleType === 'Secret'
            ? circle.circleType
            : null;
    }, [activeCircleIdForSettings, data?.circle, data?.circleDescendants]);
    const accessPolicyGovernanceRequired = useMemo(() => Boolean(governanceBindingCoversAction(
        circleGovernanceBindings,
        'circle.policy.membership.update',
    )), [circleGovernanceBindings]);
    const accessPolicyNoticeToDisplay = useMemo(() => {
        if (circleAccessPolicyStatus === 'saved') {
            return circleDetailT('settings.accessPolicyStatus.saved');
        }
        if (circleAccessPolicyStatus === 'requires_governance') {
            return circleDetailT('settings.accessPolicyStatus.requiresGovernance');
        }
        if (circleAccessPolicyStatus === 'chain_saved_policy_pending') {
            return circleDetailT('settings.accessPolicyStatus.chainSavedPolicyPending');
        }
        if (circleAccessPolicyStatus === 'policy_saved_chain_pending') {
            return circleDetailT('settings.accessPolicyStatus.policySavedChainPending');
        }
        return null;
    }, [circleAccessPolicyStatus, circleDetailT]);
    const signCircleSettingsMessage = useCallback((source: string, key: string) => (
        message: Uint8Array,
    ) => signMessageForAction({
        kind: 'circle_settings_update',
        source,
        key,
        message,
    }), [signMessageForAction]);
    const circleGovernanceCommittee = useMemo(() => {
        const activeBinding = circleGovernanceBindings.find((binding) =>
            binding.status === 'active'
            && binding.targetAuthorizationStatus === 'accepted'
            && binding.committeeMandateStatus === 'accepted'
        );
        if (activeBinding) {
            return {
                status: 'active_binding' as const,
                bindingType: activeBinding.bindingType,
                committeeCircleId: activeBinding.committeeCircleId,
                committeeCircleName: null,
                actionScope: activeBinding.actionType || activeBinding.actionPrefix,
                ruleId: activeBinding.ruleId,
                bindingId: activeBinding.id,
                policyVersion: activeBinding.policyVersion,
                eligibleCount: activeBinding.eligibleActorCount ?? null,
                singlePersonCommittee: activeBinding.eligibleActorCount === 1,
                mandateId: activeBinding.mandateId,
                mandateVersion: activeBinding.mandate?.currentVersion ?? null,
                mandatePurpose: activeBinding.mandate?.purposes.join(' + ') || null,
                mandateEnvironment: activeBinding.mandate?.environment ?? null,
                mandateNetwork: activeBinding.mandate?.network ?? null,
                mandateCanonicalState: activeBinding.authorityCanonicalState,
                mandateEffectiveFrom: activeBinding.mandate?.effectiveFrom ?? null,
                mandateEffectiveUntil: activeBinding.mandate?.effectiveUntil ?? null,
                mandateAcceptanceExpiresAt: activeBinding.mandate?.acceptanceExpiresAt ?? null,
                mandateMinimumConstraints: activeBinding.mandate?.minimumConstraints ?? null,
                mandateFeePolicy: activeBinding.mandate?.feePolicy ?? null,
                mandateEffectPolicy: activeBinding.mandate?.effectPolicy ?? null,
                mandateDisclosureImpact: activeBinding.mandate?.crossInstitutionDisclosureImpact ?? null,
                authorityTransparency: activeBinding.authorityTransparency,
            };
        }
        const pendingBinding = circleGovernanceBindings.find((binding) =>
            binding.status === 'pending_mandate'
            || binding.committeeMandateStatus === 'pending'
        );
        if (pendingBinding) {
            return {
                status: 'pending_mandate' as const,
                bindingType: pendingBinding.bindingType,
                committeeCircleId: pendingBinding.committeeCircleId,
                committeeCircleName: null,
                actionScope: pendingBinding.actionType || pendingBinding.actionPrefix,
                ruleId: pendingBinding.ruleId,
                eligibleCount: pendingBinding.eligibleActorCount ?? null,
                singlePersonCommittee: pendingBinding.eligibleActorCount === 1,
                mandateId: pendingBinding.mandateId,
                mandateVersion: pendingBinding.mandate?.currentVersion ?? null,
                mandatePurpose: pendingBinding.mandate?.purposes.join(' + ') || null,
                mandateEnvironment: pendingBinding.mandate?.environment ?? null,
                mandateNetwork: pendingBinding.mandate?.network ?? null,
                mandateCanonicalState: pendingBinding.authorityCanonicalState,
                mandateEffectiveFrom: pendingBinding.mandate?.effectiveFrom ?? null,
                mandateEffectiveUntil: pendingBinding.mandate?.effectiveUntil ?? null,
                mandateAcceptanceExpiresAt: pendingBinding.mandate?.acceptanceExpiresAt ?? null,
                mandateMinimumConstraints: pendingBinding.mandate?.minimumConstraints ?? null,
                mandateFeePolicy: pendingBinding.mandate?.feePolicy ?? null,
                mandateEffectPolicy: pendingBinding.mandate?.effectPolicy ?? null,
                mandateDisclosureImpact: pendingBinding.mandate?.crossInstitutionDisclosureImpact ?? null,
                authorityTransparency: pendingBinding.authorityTransparency,
            };
        }
        return {
            status: 'action_registry_resolved' as const,
            bindingType: null,
            committeeCircleId: null,
            committeeCircleName: null,
            actionScope: null,
            ruleId: null,
            singlePersonCommittee: false,
        };
    }, [circleGovernanceBindings]);

    useEffect(() => {
        if (!Number.isFinite(activeDiscussionCircleId) || activeDiscussionCircleId <= 0) return;
        if (activeDiscussionCircleId === circleId) {
            setActiveTierMembershipSnapshot(null);
            setActiveTierIdentityStatus(null);
            setActiveTierMembershipLoading(false);
            setActiveTierMembershipRefreshFailed(false);
            return;
        }

        return startMembershipRefresh({
            circleId: activeDiscussionCircleId,
            reset: () => {
                setActiveTierMembershipSnapshot(null);
                setActiveTierIdentityStatus(null);
                setActiveTierMembershipLoading(true);
                setActiveTierMembershipRefreshFailed(false);
            },
            fetchSnapshot: fetchCircleMembershipState,
            fetchStatus: fetchCircleIdentityStatus,
            apply: ({ snapshot, status, snapshotFailed, statusFailed }) => {
                setActiveTierMembershipSnapshot(snapshot);
                setActiveTierIdentityStatus(status);
                setActiveTierMembershipRefreshFailed(snapshotFailed || statusFailed);
            },
            finalize: () => {
                setActiveTierMembershipLoading(false);
            },
        });
    }, [activeDiscussionCircleId, circleId, publicKey, identityState, locale, sessionUser?.id]);

    const handleTierChange = useCallback(
        (newTierId: string) => {
            const target = subCircles.find((s) => s.id === newTierId);
            if (!target) return;
            const targetCircleId = Number(newTierId);
            activeSettingsCircleIdRef.current = Number.isSafeInteger(targetCircleId) && targetCircleId > 0
                ? targetCircleId
                : null;
            setActiveTierId(newTierId);
            setLastActiveSubCircle(circleId, newTierId);
            if (!canOpenTab(target.tabs, target.mode, activeTab)) {
                setActiveTab(target.tabs[0] || 'plaza');
            }
        },
        [subCircles, circleId, activeTab],
    );

    useEffect(() => {
        activeSettingsCircleIdRef.current = activeCircleIdForSettings;
    }, [activeCircleIdForSettings]);

    const canApplyCircleLoad = useCallback((
        targetCircleId: number,
        context?: CircleLoadContext,
    ) => (
        activeSettingsCircleIdRef.current === targetCircleId
        && (context?.isCurrent?.() ?? true)
    ), []);

    const loadGhostSettingsForCircle = useCallback(async (
        targetCircleId: number,
        context?: CircleLoadContext,
    ) => {
        if (!canApplyCircleLoad(targetCircleId, context)) return;
        setCircleGhostSettingsLoading(true);
        setCircleGhostSettingsError(null);
        try {
            const [payload, governanceRequests] = await Promise.all([
                fetchCircleGhostSettings(targetCircleId, context?.signal),
                fetchCircleGovernanceRequests(targetCircleId, 'target', {
                    actionType: CIRCLE_GHOST_SETTINGS_GOVERNANCE_ACTION,
                    state: 'active',
                    signal: context?.signal,
                }).catch((error) => {
                    if (
                        isAbortError(error)
                        || context?.signal?.aborted
                        || !canApplyCircleLoad(targetCircleId, context)
                    ) {
                        throw error;
                    }
                    console.warn('[CirclePage] load pending ghost settings governance request failed', error);
                    return null;
                }),
            ]);
            if (!canApplyCircleLoad(targetCircleId, context)) return;
            setCircleGhostSettings(payload.settings);
            setCircleGhostSettingsSource(payload.source);
            if (governanceRequests) {
                const pendingRequest = governanceRequests.requests.find((request) => (
                    request.actionType === CIRCLE_GHOST_SETTINGS_GOVERNANCE_ACTION
                    && request.state === 'active'
                    && request.targetRef === String(targetCircleId)
                ));
                setCircleGhostSettingsGovernancePending(pendingRequest ? {
                    requestId: pendingRequest.id,
                    requestedSettings: normalizeCircleGhostSettings(
                        pendingRequest.payload,
                        payload.settings,
                    ),
                } : null);
            }
        } catch (error) {
            if (
                isAbortError(error)
                || context?.signal?.aborted
                || !canApplyCircleLoad(targetCircleId, context)
            ) return;
            console.error('[CirclePage] load ghost settings failed', error);
            setCircleGhostSettings(DEFAULT_CIRCLE_GHOST_SETTINGS);
            setCircleGhostSettingsSource('global_default');
            setCircleGhostSettingsError(circleDetailT('settings.errors.loadAiFallback'));
        } finally {
            if (canApplyCircleLoad(targetCircleId, context)) {
                setCircleGhostSettingsLoading(false);
            }
        }
    }, [canApplyCircleLoad, circleDetailT]);

    const loadCirclePrimaryGeoAnchorForCircle = useCallback(async (
        targetCircleId: number,
        context?: CircleLoadContext,
    ) => {
        if (!canApplyCircleLoad(targetCircleId, context)) return;
        if (!sessionUserPubkey) {
            setCirclePrimaryGeoAnchor(null);
            setCirclePrimaryGeoAnchorError(null);
            setCirclePrimaryGeoAnchorLoading(false);
            return;
        }
        setCirclePrimaryGeoAnchorLoading(true);
        setCirclePrimaryGeoAnchorError(null);
        try {
            const anchor = await fetchCirclePrimaryGeoAnchor(
                targetCircleId,
                sessionUserPubkey,
                context?.signal,
            );
            if (!canApplyCircleLoad(targetCircleId, context)) return;
            setCirclePrimaryGeoAnchor(anchor);
        } catch (error) {
            if (
                isAbortError(error)
                || context?.signal?.aborted
                || !canApplyCircleLoad(targetCircleId, context)
            ) return;
            console.error('[CirclePage] load primary geo anchor failed', error);
            setCirclePrimaryGeoAnchor(null);
            setCirclePrimaryGeoAnchorError(circleDetailT('settings.errors.loadLocationFailed'));
        } finally {
            if (canApplyCircleLoad(targetCircleId, context)) {
                setCirclePrimaryGeoAnchorLoading(false);
            }
        }
    }, [canApplyCircleLoad, circleDetailT, sessionUserPubkey]);

    const loadPolicyProfileForCircle = useCallback(async (
        targetCircleId: number,
        context?: CircleLoadContext,
    ) => {
        if (!canApplyCircleLoad(targetCircleId, context)) return;
        setCirclePolicyLoading(true);
        setCirclePolicyError(null);
        try {
            const payload = await fetchCirclePolicyProfile(targetCircleId, context?.signal);
            if (!canApplyCircleLoad(targetCircleId, context)) return;
            setCirclePolicyDraftLifecycleTemplate(payload.profile.draftLifecycleTemplate);
            setCirclePolicyDraftWorkflowPolicy(payload.profile.draftWorkflowPolicy);
            setCirclePolicyForkPolicy(payload.profile.forkPolicy);
        } catch (error) {
            if (
                isAbortError(error)
                || context?.signal?.aborted
                || !canApplyCircleLoad(targetCircleId, context)
            ) return;
            console.error('[CirclePage] load policy profile failed', error);
            setCirclePolicyDraftLifecycleTemplate(DEFAULT_CIRCLE_DRAFT_LIFECYCLE_TEMPLATE);
            setCirclePolicyDraftWorkflowPolicy(null);
            setCirclePolicyForkPolicy(DEFAULT_CIRCLE_FORK_POLICY);
            setCirclePolicyError(circleDetailT('settings.errors.loadDraftPolicyFallback'));
        } finally {
            if (canApplyCircleLoad(targetCircleId, context)) {
                setCirclePolicyLoading(false);
            }
        }
    }, [canApplyCircleLoad, circleDetailT]);

    const loadDraftPromptsForCircle = useCallback(async (
        targetCircleId: number,
        context?: CircleLoadContext,
    ) => {
        if (!canApplyCircleLoad(targetCircleId, context)) return;
        setCircleDraftPromptsLoading(true);
        setCircleDraftPromptsError(null);
        try {
            const prompts = await fetchCircleDraftPrompts(targetCircleId, context?.signal);
            if (!canApplyCircleLoad(targetCircleId, context)) return;
            setCircleDraftPrompts(prompts);
        } catch (error) {
            if (
                isAbortError(error)
                || context?.signal?.aborted
                || !canApplyCircleLoad(targetCircleId, context)
            ) return;
            console.error('[CirclePage] load Draft Prompt settings failed', error);
            setCircleDraftPrompts([]);
            setCircleDraftPromptsError(circleDetailT('settings.errors.loadDraftPromptFailed'));
        } finally {
            if (canApplyCircleLoad(targetCircleId, context)) {
                setCircleDraftPromptsLoading(false);
            }
        }
    }, [canApplyCircleLoad, circleDetailT]);

    const loadAgentsForCircle = useCallback(async (
        targetCircleId: number,
        context?: CircleLoadContext,
    ) => {
        if (!canApplyCircleLoad(targetCircleId, context)) return;
        setCircleAgentPolicyLoading(true);
        setCircleAgentPolicyError(null);
        try {
            const [agents, policy] = await Promise.all([
                fetchCircleAgents(targetCircleId, context?.signal),
                fetchCircleAgentPolicy(targetCircleId, context?.signal),
            ]);
            if (!canApplyCircleLoad(targetCircleId, context)) return;
            setCircleAgents(agents);
            setCircleAgentPolicy(policy);
        } catch (error) {
            if (
                isAbortError(error)
                || context?.signal?.aborted
                || !canApplyCircleLoad(targetCircleId, context)
            ) return;
            console.error('[CirclePage] load agent admin state failed', error);
            setCircleAgents([]);
            setCircleAgentPolicy({
                circleId: targetCircleId,
                triggerScope: 'draft_only',
                costDiscountBps: 0,
                reviewMode: 'owner_review',
                updatedByUserId: null,
            });
            setCircleAgentPolicyError(circleDetailT('settings.errors.loadAgentPolicyFallback'));
        } finally {
            if (canApplyCircleLoad(targetCircleId, context)) {
                setCircleAgentPolicyLoading(false);
            }
        }
    }, [canApplyCircleLoad, circleDetailT]);

    const loadGovernanceBindingsForCircle = useCallback(async (
        targetCircleId: number,
        context?: CircleLoadContext,
    ) => {
        if (!canApplyCircleLoad(targetCircleId, context)) return;
        try {
            const payload = await fetchCircleGovernanceBindings(targetCircleId, context?.signal);
            if (!canApplyCircleLoad(targetCircleId, context)) return;
            setCircleGovernanceBindings(payload.bindings);
            setCommitteeGovernanceBindings(payload.committeeBindings);
            setCircleGovernanceResourceReadiness(payload.resourceReadiness);
            setGovernanceRecovery(payload.recovery);
        } catch (error) {
            if (
                isAbortError(error)
                || context?.signal?.aborted
                || !canApplyCircleLoad(targetCircleId, context)
            ) return;
            console.error('[CirclePage] load governance bindings failed', error);
            setCircleGovernanceBindings([]);
            setCommitteeGovernanceBindings([]);
            setCircleGovernanceResourceReadiness(null);
            setGovernanceRecovery(null);
        }
    }, [canApplyCircleLoad]);

    const loadGovernanceCommitteeProfileForCircle = useCallback(async (
        targetCircleId: number,
        context?: CircleLoadContext,
    ) => {
        if (!canApplyCircleLoad(targetCircleId, context)) return;
        setCircleGovernanceCommitteeProfileLoading(true);
        try {
            const profile = await fetchCircleGovernanceCommitteeProfile(targetCircleId, context?.signal);
            if (!canApplyCircleLoad(targetCircleId, context)) return;
            setCircleGovernanceCommitteeProfile(profile);
        } catch (error) {
            if (
                isAbortError(error)
                || context?.signal?.aborted
                || !canApplyCircleLoad(targetCircleId, context)
            ) return;
            console.error('[CirclePage] load governance committee profile failed', error);
            setCircleGovernanceCommitteeProfile(null);
        } finally {
            if (canApplyCircleLoad(targetCircleId, context)) {
                setCircleGovernanceCommitteeProfileLoading(false);
            }
        }
    }, [canApplyCircleLoad]);

    const loadCommitteeGovernanceRequestsForCircle = useCallback(async (
        targetCircleId: number,
        context?: CircleLoadContext,
    ) => {
        if (!canApplyCircleLoad(targetCircleId, context)) return;
        setCommitteeGovernanceRequestsLoading(true);
        try {
            const payload = await fetchCircleGovernanceRequests(targetCircleId, 'committee', {
                signal: context?.signal,
            });
            if (!canApplyCircleLoad(targetCircleId, context)) return;
            setCommitteeGovernanceRequests(payload.requests);
        } catch (error) {
            if (
                isAbortError(error)
                || context?.signal?.aborted
                || !canApplyCircleLoad(targetCircleId, context)
            ) return;
            console.error('[CirclePage] load committee governance requests failed', error);
            setCommitteeGovernanceRequests([]);
        } finally {
            if (canApplyCircleLoad(targetCircleId, context)) {
                setCommitteeGovernanceRequestsLoading(false);
            }
        }
    }, [canApplyCircleLoad]);

    useEffect(() => {
        settingsCircleLoadGenerationRef.current += 1;
        setCircleGovernanceCommitteeProfileStatus({ state: 'idle' });
        setCommitteeGovernanceSignalActionKey(null);
        setCommitteeGovernanceSignalError(null);
        setCirclePrimaryGeoAnchorGovernanceRequestId(null);
        setCircleGhostSettingsGovernancePending(null);
        setCirclePrimaryGeoAnchor(null);
        setCirclePrimaryGeoAnchorError(null);
        setCirclePrimaryGeoAnchorLoading(false);
        setCircleDraftPrompts([]);
        setCircleDraftPromptsError(null);
        setCircleDraftPromptsLoading(false);
        setCircleGovernanceCommitteeProfile(null);
        setCircleGovernanceCommitteeProfileLoading(false);
        setCommitteeGovernanceRequests([]);
        setCommitteeGovernanceRequestsLoading(false);
        setCircleOwnerTransferRequests([]);
        setCircleAgents([]);
        setCircleAgentPolicy(null);
        setCircleAgentPolicyError(null);
        setCircleAgentPolicyLoading(false);
    }, [activeCircleIdForSettings]);

    const loadOwnerTransfersForCircle = useCallback(async (
        targetCircleId: number,
        context?: CircleLoadContext,
    ) => {
        if (!canApplyCircleLoad(targetCircleId, context)) return;
        try {
            const requests = await fetchCircleOwnerTransferRequests(targetCircleId, context?.signal);
            if (!canApplyCircleLoad(targetCircleId, context)) return;
            setCircleOwnerTransferRequests(requests);
        } catch (error) {
            if (
                isAbortError(error)
                || context?.signal?.aborted
                || !canApplyCircleLoad(targetCircleId, context)
            ) return;
            console.error('[CirclePage] load owner transfer requests failed', error);
            setCircleOwnerTransferRequests([]);
        }
    }, [canApplyCircleLoad]);

    useEffect(() => {
        if (activeCircleIdForSettings === null) return;
        const targetCircleId = activeCircleIdForSettings;
        const generation = baselineCircleLoadGenerationRef.current + 1;
        baselineCircleLoadGenerationRef.current = generation;
        const controller = new AbortController();
        const context: CircleLoadContext = {
            signal: controller.signal,
            isCurrent: () => baselineCircleLoadGenerationRef.current === generation,
        };

        setCircleGhostSettings(null);
        setCircleGhostSettingsSource(null);
        setCircleGhostSettingsGovernancePending(null);
        setCirclePolicyDraftLifecycleTemplate(null);
        setCirclePolicyDraftWorkflowPolicy(null);
        setCirclePolicyForkPolicy(null);
        setCircleGovernanceBindings([]);
        setCommitteeGovernanceBindings([]);
        setCircleGovernanceResourceReadiness(null);
        setGovernanceRecovery(null);

        void loadGhostSettingsForCircle(targetCircleId, context);
        void loadPolicyProfileForCircle(targetCircleId, context);
        void loadGovernanceBindingsForCircle(targetCircleId, context);

        return () => {
            controller.abort();
            if (baselineCircleLoadGenerationRef.current === generation) {
                baselineCircleLoadGenerationRef.current += 1;
            }
        };
    }, [
        activeCircleIdForSettings,
        loadGhostSettingsForCircle,
        loadGovernanceBindingsForCircle,
        loadPolicyProfileForCircle,
    ]);

    useEffect(() => {
        if (activeCircleIdForSettings === null || !showSettings) {
            settingsCircleLoadGenerationRef.current += 1;
            setCirclePrimaryGeoAnchorLoading(false);
            setCircleDraftPromptsLoading(false);
            setCircleGovernanceCommitteeProfileLoading(false);
            setCommitteeGovernanceRequestsLoading(false);
            setCircleAgentPolicyLoading(false);
            return;
        }

        const targetCircleId = activeCircleIdForSettings;
        const generation = settingsCircleLoadGenerationRef.current + 1;
        settingsCircleLoadGenerationRef.current = generation;
        const controller = new AbortController();
        const context: CircleLoadContext = {
            signal: controller.signal,
            isCurrent: () => settingsCircleLoadGenerationRef.current === generation,
        };
        const settingsMembershipSnapshot = resolveActiveMembershipSnapshot({
            routeCircleId: circleId,
            activeCircleId: targetCircleId,
            routeSnapshot: membershipSnapshot,
            activeTierSnapshot: activeTierMembershipSnapshot,
        });

        void loadCirclePrimaryGeoAnchorForCircle(targetCircleId, context);
        if (
            sessionUser?.id
            && (
                settingsMembershipSnapshot?.membership?.role === 'Owner'
                || settingsMembershipSnapshot?.membership?.role === 'Admin'
            )
        ) {
            void loadDraftPromptsForCircle(targetCircleId, context);
        } else {
            setCircleDraftPrompts([]);
            setCircleDraftPromptsError(null);
            setCircleDraftPromptsLoading(false);
        }
        void loadGovernanceCommitteeProfileForCircle(targetCircleId, context);
        void loadCommitteeGovernanceRequestsForCircle(targetCircleId, context);
        if (sessionUser?.id) {
            void loadOwnerTransfersForCircle(targetCircleId, context);
        } else {
            setCircleOwnerTransferRequests([]);
        }
        if (!CIRCLE_AGENT_GOVERNANCE_UI_ENABLED) {
            setCircleAgents([]);
            setCircleAgentPolicy(null);
            setCircleAgentPolicyError(null);
            setCircleAgentPolicyLoading(false);
        } else if (canManageCircleAgents({ snapshot: settingsMembershipSnapshot })) {
            void loadAgentsForCircle(targetCircleId, context);
        } else {
            setCircleAgents([]);
            setCircleAgentPolicy({
                circleId: targetCircleId,
                triggerScope: 'draft_only',
                costDiscountBps: 0,
                reviewMode: 'owner_review',
                updatedByUserId: null,
            });
            setCircleAgentPolicyError(null);
            setCircleAgentPolicyLoading(false);
        }

        return () => {
            controller.abort();
            if (settingsCircleLoadGenerationRef.current === generation) {
                settingsCircleLoadGenerationRef.current += 1;
            }
        };
    }, [
        activeCircleIdForSettings,
        activeTierMembershipSnapshot,
        circleId,
        loadCirclePrimaryGeoAnchorForCircle,
        loadAgentsForCircle,
        loadCommitteeGovernanceRequestsForCircle,
        loadGovernanceCommitteeProfileForCircle,
        loadDraftPromptsForCircle,
        loadOwnerTransfersForCircle,
        membershipSnapshot,
        sessionUser?.id,
        showSettings,
    ]);

    /* ── Direction for content animation ── */
    const [tierDirection, setTierDirection] = useState(0);
    const prevTierRef = useRef(activeTierId);

    useEffect(() => {
        const prevIdx = subCircles.findIndex((s) => s.id === prevTierRef.current);
        const newIdx = subCircles.findIndex((s) => s.id === activeTierId);
        setTierDirection(newIdx > prevIdx ? 1 : newIdx < prevIdx ? -1 : 0);
        prevTierRef.current = activeTierId;
    }, [activeTierId, subCircles]);

    /* ── Knowledge (Sanctuary crystals) ── */
    const { data: knowledgeData, refetch: refetchKnowledgeByCircle } = useQuery<KnowledgeByCircleResponse>(GET_KNOWLEDGE_BY_CIRCLE, {
        variables: { circleId: activeDiscussionCircleId, limit: 50 },
        skip: !Number.isFinite(activeDiscussionCircleId) || activeDiscussionCircleId <= 0,
        errorPolicy: 'all',
    });

    /* ── Circle Feed (Dynamic stream in current circle) ── */
    const { data: circlePostsData, refetch: refetchCirclePosts } = useQuery<CirclePostsResponse>(GET_CIRCLE_POSTS, {
        variables: { id: activeDiscussionCircleId, limit: 50 },
        skip: !Number.isFinite(activeDiscussionCircleId) || activeDiscussionCircleId <= 0,
        errorPolicy: 'all',
    });

    const {
        likePost,
        pendingContentIds: pendingLikedContentIds,
        error: feedLikeError,
    } = useLikePost({
        onIndexed: async () => {
            await refetchCirclePosts({ id: activeDiscussionCircleId, limit: 50 });
        },
    });
    const {
        repostContent,
        pendingContentIds: pendingRepostedContentIds,
        error: feedRepostError,
    } = useRepostContent({
        onIndexed: async () => {
            await refetchCirclePosts({ id: activeDiscussionCircleId, limit: 50 });
        },
    });
    const {
        createReply: createFeedReply,
        loading: feedReplySubmitting,
        error: feedReplyError,
        clearError: clearFeedReplyError,
    } = useCreateFeedReply();
    const { data: feedThreadData, refetch: refetchFeedThread } = useQuery<PostThreadResponse>(GET_POST_THREAD, {
        variables: {
            contentId: selectedFeedThreadContentId || '',
            replyLimit: 50,
        },
        skip: !selectedFeedThreadContentId,
        fetchPolicy: 'network-only',
        errorPolicy: 'all',
    });

    /* ── Drafts (Crucible) ── */
    const { data: draftsData, refetch: refetchDrafts } = useQuery<CircleDraftsResponse>(GET_CIRCLE_DRAFTS, {
        variables: { circleId: activeDiscussionCircleId, limit: 50 },
        skip: !Number.isFinite(activeDiscussionCircleId) || activeDiscussionCircleId <= 0,
        errorPolicy: 'all',
    });
    const draftSummariesByCircleRef = useRef<Map<number, GQLDraftSummary[]>>(new Map());

    useEffect(() => {
        if (!Number.isFinite(activeDiscussionCircleId) || activeDiscussionCircleId <= 0) return;
        if (!draftsData?.circleDrafts) return;
        draftSummariesByCircleRef.current.set(activeDiscussionCircleId, draftsData.circleDrafts);
    }, [activeDiscussionCircleId, draftsData?.circleDrafts]);

    const refreshProgressiveTabData = useCallback((tabId: string) => {
        if (!Number.isFinite(activeDiscussionCircleId) || activeDiscussionCircleId <= 0) return;
        if (tabId === 'crucible') {
            void refetchDrafts({ circleId: activeDiscussionCircleId, limit: 50 }).catch(console.error);
            return;
        }
        if (tabId === 'sanctuary') {
            void refetchKnowledgeByCircle({ circleId: activeDiscussionCircleId, limit: 50 }).catch(console.error);
        }
    }, [activeDiscussionCircleId, refetchDrafts, refetchKnowledgeByCircle]);

    useEffect(() => {
        refreshProgressiveTabData(activeTab);
    }, [activeTab, refreshProgressiveTabData]);

    const handleCrystallizationComplete = useCallback(async () => {
        if (!Number.isFinite(activeDiscussionCircleId) || activeDiscussionCircleId <= 0) return;

        await Promise.all([
            refetchKnowledgeByCircle({ circleId: activeDiscussionCircleId, limit: 50 }),
            refetchDrafts({ circleId: activeDiscussionCircleId, limit: 50 }),
            refetch(),
        ]);
    }, [activeDiscussionCircleId, refetch, refetchDrafts, refetchKnowledgeByCircle]);

    const handleDraftLifecycleChanged = useCallback(async () => {
        if (!Number.isFinite(activeDiscussionCircleId) || activeDiscussionCircleId <= 0) return;
        await refetchDrafts({ circleId: activeDiscussionCircleId, limit: 50 });
    }, [activeDiscussionCircleId, refetchDrafts]);

    /* ── Notifications ── */
    const { data: notificationData } = useQuery<NotificationsResponse>(GET_NOTIFICATIONS, {
        variables: { limit: 20 },
        errorPolicy: 'all',
    });
    const [markNotificationsRead] = useMutation<MarkNotificationsReadResponse>(MARK_NOTIFICATIONS_READ);
    const [localReadNotificationIds, setLocalReadNotificationIds] = useState<Set<number>>(new Set());

    const notifications: Notification[] = useMemo(() => {
        if (!notificationData?.myNotifications) return [];
        return notificationData.myNotifications.map(n => ({
            id: n.id,
            type: normalizeNotificationType(n.type),
            text: n.displayBody || n.displayTitle,
            time: formatRelativeTime(n.createdAt),
            circle: undefined,
            sourceType: n.sourceType,
            sourceId: n.sourceId,
            circleId: n.circleId,
            read: n.read || localReadNotificationIds.has(n.id),
        }));
    }, [notificationData, localReadNotificationIds]);

    const plazaMessages: PlazaMessage[] = [];

    // Map API circle posts to FeedPost format for FeedTab
    const feedPosts: FeedPost[] = circlePostsData?.circle?.posts?.length
        ? circlePostsData.circle.posts.map((p: GQLPost) => ({
            id: p.id,
            contentId: p.contentId,
            onChainAddress: p.onChainAddress ?? null,
            author: p.author.handle,
            authorPubkey: p.author.pubkey,
            authorAvatarUri: p.author.avatarUri ?? null,
            text: p.text || '',
            time: formatRelativeTime(p.createdAt),
            likes: p.stats.likes,
            comments: p.stats.replies,
            reposts: p.stats.reposts,
            visibility: p.visibility,
            rankingAdjustmentState: p.rankingAdjustmentState,
            rankingAdjustmentFactorBps: p.rankingAdjustmentFactorBps,
            rankingAdjustmentExpiresAt: p.rankingAdjustmentExpiresAt,
            liked: p.liked,
            pendingLike: pendingLikedContentIds.has(p.contentId),
            pendingRepost: pendingRepostedContentIds.has(p.contentId),
            repostOfAddress: p.repostOfAddress ?? null,
            repostOf: p.repostOf ? {
                contentId: p.repostOf.contentId,
                author: p.repostOf.author.handle,
                authorPubkey: p.repostOf.author.pubkey,
                text: p.repostOf.text || '',
                time: formatRelativeTime(p.repostOf.createdAt),
            } : null,
            replies: p.replies?.map((reply) => ({
                id: reply.id,
                contentId: reply.contentId,
                author: reply.author.handle,
                authorAvatarUri: reply.author.avatarUri ?? null,
                text: reply.text || '',
                time: formatRelativeTime(reply.createdAt),
            })) ?? [],
        }))
        : [];
    const selectedFeedThreadRootPost = useMemo(() => {
        if (!selectedFeedThreadContentId) return null;
        const liveRoot = circlePostsData?.circle?.posts?.find((post) => post.contentId === selectedFeedThreadContentId);
        return feedThreadData?.post || liveRoot || null;
    }, [circlePostsData?.circle?.posts, feedThreadData?.post, selectedFeedThreadContentId]);
    const selectedFeedThreadReplies = feedThreadData?.post?.replies || [];

    // Map API knowledge to CrystalDetail format for SanctuaryTab
    const crystals: CrystalDetail[] = useMemo(() => {
        if (knowledgeData?.knowledgeByCircle?.length) {
            return knowledgeData.knowledgeByCircle.map((k: GQLKnowledge) => ({
                id: k.id,
                title: k.title,
                citedBy: k.stats.citationCount,
                author: k.author?.handle || circleDetailT('defaults.unknownMember'),
                relationshipLabel: formatRelationshipLabel(k.relationshipAssignment),
                relationshipLabelKey: k.relationshipAssignment?.labelKey ?? 'pending',
                relationshipAssignment: k.relationshipAssignment ?? null,
                sourceDraftVersionLabel: resolveSourceDraftVersionLabel(k.crystallizationOutput),
                internalRecordVersion: Math.max(1, Number(k.version ?? 1)),
                version: String(k.version ?? 1),
                ageDays: Math.floor((Date.now() - new Date(k.createdAt).getTime()) / 86400000),
                content: (k.description && k.description.trim()) || k.title,
                sources: [],
                contributors: (k.contributors || []).map((c) => ({
                    handle: c.handle,
                    role: mapContributorRole(c.role),
                    weight: Math.max(0, Math.min(1, Number(c.weight ?? 0))),
                    authorType: c.authorType === 'AGENT' ? 'AGENT' : 'HUMAN',
                    sourceType: c.sourceType,
                    assessmentKind: c.assessmentKind,
                    assessmentAlgorithmVersion: c.assessmentAlgorithmVersion,
                    assessmentStatus: c.assessmentStatus,
                    sourceDraftPostId: c.sourceDraftPostId,
                    sourceAnchorId: c.sourceAnchorId,
                    sourcePayloadHash: c.sourcePayloadHash,
                    sourceSummaryHash: c.sourceSummaryHash,
                    sourceMessagesDigest: c.sourceMessagesDigest,
                })),
                /* Crystal 3D visual data */
                knowledgeId: k.knowledgeId,
                circleName: k.circle?.name ?? data?.circle?.name ?? '',
                qualityScore: k.stats.qualityScore,
                contributorsCount: k.contributorsCount,
                crystalParams: k.crystalParams ?? null,
                createdAt: k.createdAt,
                heatScore: k.stats.heatScore,
            }));
        }
        return [];
    }, [knowledgeData]);

    const knowledgeReferenceOptions = useMemo(
        () => buildKnowledgeReferenceOptions(knowledgeData?.knowledgeByCircle || []),
        [knowledgeData?.knowledgeByCircle],
    );

    const draftSummaries = draftsData?.circleDrafts ?? draftSummariesByCircleRef.current.get(activeDiscussionCircleId) ?? [];

    // Map API drafts for CrucibleTab
    const drafts = useMemo(() => {
        if (draftSummaries.length) {
            return draftSummaries.map((d: GQLDraftSummary) => ({
                id: d.postId,
                title: d.title,
                heat: Math.max(0, Number(d.heatScore ?? 0)),
                editors: d.commentCount > 0 ? Math.ceil(d.commentCount / 3) : 1,
                comments: d.commentCount,
                documentStatus: normalizeDraftDocumentStatus(d.documentStatus),
                publicBlockerCode: d.publicBlockerCode,
                lastActivityAt: d.lastActivityAt,
            }));
        }
        return [];
    }, [draftSummaries]);

    const { style: colorTempStyle } = useColorTemperature({
        activeTab,
        heatLevel: activeTab === 'crucible' ? 0.7 : 0.4,
        hasConsensus: activeTab === 'sanctuary',
    });

    /* ── Content transition variants ── */
    const contentVariants = {
        enter: (dir: number) => ({
            opacity: 0,
            x: dir > 0 ? 30 : dir < 0 ? -30 : 0,
            scale: dir > 0 ? 0.98 : 1,
        }),
        center: {
            opacity: 1,
            x: 0,
            scale: 1,
        },
        exit: (dir: number) => ({
            opacity: 0,
            x: dir > 0 ? -20 : dir < 0 ? 20 : 0,
            scale: dir > 0 ? 1 : 0.98,
        }),
    };

    const activeTabs = useMemo(() =>
        (activeSubCircle.tabs || ['plaza', 'crucible', 'sanctuary']).map((tabId) => tabDefs[tabId]).filter(Boolean),
        [activeSubCircle.tabs, tabDefs],
    );

    useEffect(() => {
        if (!requestedRouteTab) {
            lastAppliedRouteTabRef.current = null;
            return;
        }
        const nextTab = canOpenTab(activeSubCircle.tabs, activeSubCircle.mode, requestedRouteTab)
            ? requestedRouteTab
            : (activeSubCircle.tabs[0] || 'plaza');
        const routeKey = `${circleId}:${requestedRouteTab}:${nextTab}`;
        if (lastAppliedRouteTabRef.current === routeKey) return;

        setActiveTab(nextTab);
        lastAppliedRouteTabRef.current = routeKey;
    }, [requestedRouteTab, activeSubCircle.mode, activeSubCircle.tabs, circleId]);

    const handleSelectCircleTab = useCallback((tab: string) => {
        setActiveTab(tab);
        const params = new URLSearchParams(searchParams.toString());
        params.set('tab', tab);
        const query = params.toString();
        router.replace(`/circles/${circleId}${query ? `?${query}` : ''}`);
    }, [circleId, router, searchParams]);

    useEffect(() => {
        if (requestedRouteTab !== 'crucible' || !Number.isInteger(requestedRouteDraftId) || requestedRouteDraftId <= 0) return;
        setRequestedCrucibleDraftId(requestedRouteDraftId);
    }, [requestedRouteDraftId, requestedRouteTab]);

    const isPlaza = activeTab === 'plaza';

    const markNotificationIdsRead = useCallback((ids: number[]) => {
        if (ids.length === 0) return;
        setLocalReadNotificationIds((prev) => {
            const next = new Set(prev);
            ids.forEach((id) => next.add(id));
            return next;
        });
        markNotificationsRead({ variables: { ids } }).catch(console.error);
    }, [markNotificationsRead]);

    const handleNotificationClick = useCallback((notification: Notification) => {
        markNotificationIdsRead([notification.id]);
        setShowNotifications(false);
        const href = resolveNotificationHref(notification);
        if (href && href.includes('focusEnvelopeId=')) {
            router.push(href);
            return;
        }
        const targetTab = resolveNotificationCircleTab(notification);
        if (notification.circleId === circleId && targetTab) {
            setActiveTab(targetTab);
            return;
        }
        if (href) {
            router.push(href);
        }
    }, [circleId, markNotificationIdsRead, router]);

    const handleMarkAllNotificationsRead = useCallback(() => {
        const unreadIds = notifications.filter((notification) => !notification.read).map((notification) => notification.id);
        markNotificationIdsRead(unreadIds);
    }, [markNotificationIdsRead, notifications]);

    const handleOpenFeedThread = useCallback((post: FeedPost) => {
        clearFeedReplyError();
        setSelectedFeedThreadContentId(post.contentId);
    }, [clearFeedReplyError]);

    const handleCloseFeedThread = useCallback(() => {
        clearFeedReplyError();
        setSelectedFeedThreadContentId(null);
    }, [clearFeedReplyError]);

    const handleSubmitFeedReply = useCallback(async (draft: string) => {
        if (!selectedFeedThreadContentId) {
            return false;
        }

        const result = await submitFeedReply({
            parentContentId: selectedFeedThreadContentId,
            circleId: activeDiscussionCircleId,
            draft,
            createReply: ({ parentContentId, circleId, text }) => createFeedReply({
                parentContentId,
                parentAuthorPubkey: selectedFeedThreadRootPost?.author.pubkey,
                circleId,
                text,
            }),
            refreshThread: async () => {
                await refetchFeedThread({
                    contentId: selectedFeedThreadContentId,
                    replyLimit: 50,
                });
            },
            refreshFeed: async () => {
                await refetchCirclePosts({
                    id: activeDiscussionCircleId,
                    limit: 50,
                });
            },
        });

        return result.ok;
    }, [
        activeDiscussionCircleId,
        createFeedReply,
        refetchCirclePosts,
        refetchFeedThread,
        selectedFeedThreadContentId,
    ]);

    const handleOpenCrucible = useCallback((draftPostId?: number | null) => {
        if (typeof draftPostId === 'number' && Number.isFinite(draftPostId) && draftPostId > 0) {
            setRequestedCrucibleDraftId(draftPostId);
        }
        setActiveTab('crucible');
    }, []);

    const handleRequestedCrucibleDraftHandled = useCallback(() => {
        setRequestedCrucibleDraftId(null);
    }, []);

    const handleRepostFeedPost = useCallback((post: FeedPost) => {
        if (post.repostOfAddress) {
            return;
        }

        void repostContent({
            originalContentId: post.contentId,
            originalAuthorPubkey: post.authorPubkey,
            circleId: activeDiscussionCircleId,
        });
    }, [activeDiscussionCircleId, repostContent]);

    /* Unified swipe handler for all tabs */
    const handleSwipe = useCallback((_e: MouseEvent | TouchEvent | PointerEvent, info: PanInfo) => {
        const threshold = 60;
        if (Math.abs(info.offset.x) < threshold) return;
        if (Math.abs(info.velocity.x) < 100 && Math.abs(info.offset.x) < 100) return;

        const activeTbs = (activeSubCircle.tabs || ['plaza', 'crucible', 'sanctuary']).map((tabId) => tabDefs[tabId]).filter(Boolean);
        const tabIds = activeTbs.map((t) => t.id);
        const tabIndex = tabIds.indexOf(activeTab);
        if (tabIndex < 0) return;

        if (info.offset.x > threshold) {
            if (tabIndex > 0) {
                handleSelectCircleTab(tabIds[tabIndex - 1]);
                setBoundaryPills(null);
            } else {
                setBoundaryPills('left');
            }
        } else if (info.offset.x < -threshold) {
            if (tabIndex < tabIds.length - 1) {
                handleSelectCircleTab(tabIds[tabIndex + 1]);
                setBoundaryPills(null);
            } else {
                setBoundaryPills('right');
            }
        }
    }, [activeSubCircle.tabs, activeTab, handleSelectCircleTab, tabDefs]);

    /* Boundary pill actions */
    const handleBoundaryBack = useCallback(() => {
        setBoundaryPills(null);
        router.back();
    }, [router]);

    /* ── Compute navigation context for edge panel ── */
    const currentCircle = useMemo(
        () => subCircles.find(s => s.id === activeTierId),
        [subCircles, activeTierId],
    );
    const isInAux = currentCircle?.kind === 'auxiliary';
    const auxSiblings = useMemo(() => {
        if (!isInAux || !currentCircle?.parentId) return [];
        return subCircles.filter(s => s.kind === 'auxiliary' && s.parentId === currentCircle.parentId);
    }, [subCircles, isInAux, currentCircle?.parentId]);
    const mainCircles = useMemo(
        () => subCircles.filter(s => s.kind === 'main'),
        [subCircles],
    );
    // Find the parent main circle of the current active circle
    const activeMainCircle = useMemo(() => {
        if (!currentCircle) return subCircles.find(s => s.kind === 'main') || subCircles[0];
        if (currentCircle.kind === 'main') return currentCircle;
        // auxiliary: find parent
        return subCircles.find(s => s.id === currentCircle.parentId) || subCircles.find(s => s.kind === 'main') || subCircles[0];
    }, [subCircles, currentCircle]);
    const activeShortcutCircleId = Number(activeSubCircle?.id || circleId);
    const activeShortcutIsPrimary = primaryShortcut?.circleId === activeShortcutCircleId;
    const handleToggleActiveCircleShortcut = useCallback(() => {
        if (!activeSubCircle || !Number.isFinite(activeShortcutCircleId)) return;
        if (activeShortcutIsPrimary) {
            removeShortcut(activeShortcutCircleId);
            return;
        }
        const rootCircleId = Number(activeMainCircle?.id || circleId);
        if (!Number.isFinite(rootCircleId)) return;
        const draft: CircleShortcutDraft = {
            rootCircleId,
            circleId: activeShortcutCircleId,
            circleName: activeSubCircle.name,
            level: activeSubCircle.level,
            kind: activeSubCircle.kind,
            mode: activeSubCircle.mode,
            preferredTab: normalizeCircleShortcutTab(activeTab),
        };
        addShortcut(draft, {
            isPrimary: true,
            autoEnterEnabled: true,
        });
    }, [
        activeMainCircle?.id,
        activeShortcutCircleId,
        activeShortcutIsPrimary,
        activeSubCircle,
        activeTab,
        addShortcut,
        circleId,
        removeShortcut,
    ]);

    const quickAuxCircles = useMemo<PlazaQuickAuxCircle[]>(() => {
        if (!activeMainCircle) return [];
        return subCircles
            .filter((sc) => sc.kind === 'auxiliary' && sc.parentId === activeMainCircle.id && sc.id !== activeTierId)
            .sort((a, b) => a.level - b.level || a.id.localeCompare(b.id))
            .map((sc) => ({
                id: sc.id,
                name: sc.name,
                level: sc.level,
                minCrystals: sc.accessRequirement.type === 'crystal' ? sc.accessRequirement.minCrystals : 0,
            }));
    }, [subCircles, activeMainCircle, activeTierId]);
    const plazaForwardTargets = useMemo<PickerCircle[]>(() => {
        if (!activeMainCircle) return [];
        return subCircles.map((sc) => ({
            groupId: Number(activeMainCircle.id),
            groupName: activeMainCircle.name,
            subCircleId: sc.id,
            subCircleName: sc.name,
            level: sc.level,
            accessRequirement: sc.accessRequirement,
        }));
    }, [subCircles, activeMainCircle]);

    const [circleRuntimeDiscussionSession, setCircleRuntimeDiscussionSession] = useState<DiscussionSessionState | null>(null);
    const circleRuntimeSessionBootstrapRef = useRef<Promise<string | null> | null>(null);
    const circleRuntimeDiscussionSessionStorageKey = useMemo(
        () => (sessionUserPubkey ? `alcheme_discussion_session_${sessionUserPubkey}` : null),
        [sessionUserPubkey],
    );
    const activeMainCircleId = Number(activeMainCircle?.id || circleId);
    const circleById = useMemo(() => {
        const index = new Map<number, any>();
        if (data?.circle) {
            index.set(data.circle.id, data.circle);
        }
        (data?.circleDescendants || []).forEach((circle) => {
            // Descendants intentionally omit members/posts and are used as minimal circle metadata.
            index.set(circle.id, circle as any);
        });
        return index;
    }, [data?.circle, data?.circleDescendants]);

    const activeMainCircleData = useMemo(() => {
        return circleById.get(activeMainCircleId) || null;
    }, [circleById, activeMainCircleId]);

    const circleRuntimeViewerDisplayLabel = useMemo(() => {
        const displayName = typeof sessionUser?.displayName === 'string' ? sessionUser.displayName.trim() : '';
        const handle = typeof sessionUser?.handle === 'string' ? sessionUser.handle.trim() : '';
        const pubkey = String(sessionUserPubkey || '').trim();
        return displayName || handle || (pubkey ? `${pubkey.slice(0, 4)}...${pubkey.slice(-4)}` : 'member');
    }, [sessionUser?.displayName, sessionUser?.handle, sessionUserPubkey]);

    const persistCircleRuntimeDiscussionSession = useCallback((session: DiscussionSessionState | null) => {
        if (typeof window === 'undefined') return;
        if (!circleRuntimeDiscussionSessionStorageKey) return;
        try {
            if (!session) {
                localStorage.removeItem(circleRuntimeDiscussionSessionStorageKey);
                return;
            }
            localStorage.setItem(circleRuntimeDiscussionSessionStorageKey, JSON.stringify(session));
        } catch {
            // ignore storage failures
        }
    }, [circleRuntimeDiscussionSessionStorageKey]);

    useEffect(() => {
        if (typeof window === 'undefined') return;
        if (!circleRuntimeDiscussionSessionStorageKey) {
            setCircleRuntimeDiscussionSession(null);
            return;
        }
        let raw: string | null = null;
        try {
            raw = localStorage.getItem(circleRuntimeDiscussionSessionStorageKey);
        } catch {
            setCircleRuntimeDiscussionSession(null);
            return;
        }
        if (!raw) {
            setCircleRuntimeDiscussionSession(null);
            return;
        }
        try {
            const parsed = JSON.parse(raw) as DiscussionSessionState;
            const expiresAtMs = Date.parse(parsed.expiresAt);
            if (!Number.isFinite(expiresAtMs) || expiresAtMs <= Date.now() || parsed.senderPubkey !== sessionUserPubkey) {
                try {
                    localStorage.removeItem(circleRuntimeDiscussionSessionStorageKey);
                } catch {
                    // ignore
                }
                setCircleRuntimeDiscussionSession(null);
                return;
            }
            setCircleRuntimeDiscussionSession(parsed);
        } catch {
            try {
                localStorage.removeItem(circleRuntimeDiscussionSessionStorageKey);
            } catch {
                // ignore
            }
            setCircleRuntimeDiscussionSession(null);
        }
    }, [circleRuntimeDiscussionSessionStorageKey, sessionUserPubkey]);

    const ensureCircleRuntimeDiscussionSessionToken = useCallback(async (
        options: DiscussionSessionTokenOptions = {},
    ): Promise<string | null> => {
        if (!useSessionTokenAuth) return null;
        if (identityState !== 'registered' || !sessionUserPubkey) return null;

        const current = options.forceNew ? null : circleRuntimeDiscussionSession;
        const now = Date.now();
        const expiresAtMs = current ? Date.parse(current.expiresAt) : 0;
        const isUsableCurrent =
            !!current
            && current.senderPubkey === sessionUserPubkey
            && Number.isFinite(expiresAtMs)
            && expiresAtMs - now > 60_000;
        if (isUsableCurrent) {
            return current.discussionAccessToken;
        }

        if (circleRuntimeSessionBootstrapRef.current && !options.forceNew) {
            return circleRuntimeSessionBootstrapRef.current;
        }

        const bootstrapPromise = (async () => {
            if (
                current
                && current.sessionId
                && current.senderPubkey === sessionUserPubkey
                && Number.isFinite(expiresAtMs)
                && expiresAtMs > now
            ) {
                try {
                    const refreshed = await refreshDiscussionSession({
                        sessionId: current.sessionId,
                        discussionAccessToken: current.discussionAccessToken,
                    });
                    const nextSession: DiscussionSessionState = {
                        sessionId: refreshed.sessionId,
                        discussionAccessToken: refreshed.discussionAccessToken,
                        expiresAt: refreshed.expiresAt,
                        senderPubkey: refreshed.senderPubkey,
                        scope: refreshed.scope,
                    };
                    setCircleRuntimeDiscussionSession(nextSession);
                    persistCircleRuntimeDiscussionSession(nextSession);
                    return nextSession.discussionAccessToken;
                } catch {
                    // refresh failure falls through to create session
                }
            }

            const created = await createDiscussionSession({
                senderHandle: circleRuntimeViewerDisplayLabel,
                scope: 'circle:*',
                clientMeta: {
                    circleId: activeDiscussionCircleId,
                    source: 'frontend_circle_runtime',
                    userAgent: typeof navigator !== 'undefined' ? navigator.userAgent : 'unknown',
                },
            });
            const nextSession: DiscussionSessionState = {
                sessionId: created.sessionId,
                discussionAccessToken: created.discussionAccessToken,
                expiresAt: created.expiresAt,
                senderPubkey: created.senderPubkey,
                scope: created.scope,
            };
            setCircleRuntimeDiscussionSession(nextSession);
            persistCircleRuntimeDiscussionSession(nextSession);
            return nextSession.discussionAccessToken;
        })();

        circleRuntimeSessionBootstrapRef.current = bootstrapPromise;
        try {
            return await bootstrapPromise;
        } finally {
            circleRuntimeSessionBootstrapRef.current = null;
        }
    }, [
        activeDiscussionCircleId,
        circleRuntimeDiscussionSession,
        circleRuntimeViewerDisplayLabel,
        identityState,
        persistCircleRuntimeDiscussionSession,
        sessionUserPubkey,
        useSessionTokenAuth,
    ]);

    const activeSettingsCircleData = useMemo(() => {
        const parsed = Number(activeSubCircle?.id || circleId);
        if (!Number.isFinite(parsed)) return null;
        return circleById.get(parsed) || null;
    }, [circleById, activeSubCircle?.id, circleId]);
    const forkSourceCircleId = activeDiscussionCircleId;
    const forkSourceCircleName = activeSubCircle?.name || circleName;
    const forkSourceLevel = activeSubCircle?.level ?? data?.circle?.level ?? 0;
    const forkContributorCount = useMemo(() => {
        if (!walletPubkey) return 0;
        let count = 0;
        for (const knowledge of knowledgeData?.knowledgeByCircle || []) {
            for (const contributor of knowledge.contributors || []) {
                if (contributor.pubkey === walletPubkey) {
                    count += 1;
                }
            }
        }
        return count;
    }, [knowledgeData?.knowledgeByCircle, walletPubkey]);

    const settingsMembers = useMemo((): CircleSettingsMemberInfo[] => {
        return (activeSettingsCircleData?.members || []).filter(
            (m: any) => m.status === 'Active',
        ).map((m: any) => ({
            userId: Number(m.user.id),
            name: m.effectiveDisplayName
                || m.circleAlias
                || m.user.displayName
                || m.user.handle
                || circleDetailT('fallbacks.unknownMember'),
            handle: m.globalHandle || m.user.handle || null,
            pubkey: m.user.pubkey || null,
            role: mapGqlRoleToCardRole(m.role),
            actualRole: m.role,
            roleMutable: m.role === 'Moderator' || m.role === 'Member',
            removable: (m.role === 'Moderator' || m.role === 'Member') && m.user.pubkey !== walletPubkey,
        }));
    }, [activeSettingsCircleData, walletPubkey]);

    const inviteTargetCircleData = useMemo(() => {
        if (!inviteTargetCircle) return null;
        return circleById.get(inviteTargetCircle.id) || null;
    }, [circleById, inviteTargetCircle]);

    const inviteSourceCircleId = useMemo(() => {
        if (!inviteTargetCircleData) return null;
        const sourceCircleId = resolveInviteSourceCircleId({
            targetCircleId: Number(inviteTargetCircleData.id),
            targetKind: inviteTargetCircleData.kind,
            targetParentCircleId: inviteTargetCircleData.parentCircleId,
        });
        return Number.isFinite(sourceCircleId) && sourceCircleId > 0
            ? sourceCircleId
            : null;
    }, [inviteTargetCircleData]);

    const inviteSourceCircleData = useMemo(() => {
        if (!inviteSourceCircleId) return null;
        if (inviteSourceCircleOverride?.id === inviteSourceCircleId) {
            return inviteSourceCircleOverride;
        }
        if (data?.circle?.id === inviteSourceCircleId) {
            return data.circle;
        }
        return circleById.get(inviteSourceCircleId) || null;
    }, [circleById, data?.circle, inviteSourceCircleId, inviteSourceCircleOverride]);

    const invitableUsers: InvitableUser[] = useMemo(() => {
        if (!inviteSourceCircleData || !inviteTargetCircleData) return [];
        return buildInvitableUsers({
            sourceMembers: inviteSourceCircleData.members || [],
            targetMembers: inviteTargetCircleData.members || [],
        });
    }, [inviteSourceCircleData, inviteTargetCircleData]);

    const inviteSearchUsesGlobalDirectory = useMemo(() => {
        if (!inviteTargetCircleData) return false;
        return shouldSearchGlobalInviteDirectory({
            targetKind: inviteTargetCircleData.kind,
            targetParentCircleId: inviteTargetCircleData.parentCircleId,
        });
    }, [inviteTargetCircleData]);

    const searchGlobalInvitableUsers = useCallback(async (query: string): Promise<InvitableUser[]> => {
        if (!inviteTargetCircleData || !inviteSearchUsesGlobalDirectory) return [];
        const result = await searchInviteDirectory({
            variables: { query, limit: 20 },
        });
        return buildDirectoryInvitableUsers({
            directoryUsers: result.data?.searchUsers || [],
            targetMembers: inviteTargetCircleData.members || [],
        });
    }, [inviteSearchUsesGlobalDirectory, inviteTargetCircleData, searchInviteDirectory]);

    useEffect(() => {
        if (!showInviteSheet || !inviteSourceCircleId) {
            inviteSourceRequestRef.current = null;
            setInviteSourceCircleOverride(null);
            return;
        }
        if (Array.isArray(inviteSourceCircleData?.members)) {
            return;
        }

        inviteSourceRequestRef.current = inviteSourceCircleId;
        void loadInviteSourceCircle({
            variables: { id: inviteSourceCircleId },
        }).then((result) => {
            if (inviteSourceRequestRef.current !== inviteSourceCircleId) return;
            setInviteSourceCircleOverride(result.data?.circle || null);
        }).catch((error) => {
            console.error('[CirclePage] load invite source circle failed', error);
            if (inviteSourceRequestRef.current !== inviteSourceCircleId) return;
            setInviteSourceCircleOverride(null);
        });

        return () => {
            if (inviteSourceRequestRef.current === inviteSourceCircleId) {
                inviteSourceRequestRef.current = null;
            }
        };
    }, [inviteSourceCircleData, inviteSourceCircleId, loadInviteSourceCircle, showInviteSheet]);

    const openInviteSheetForCircle = useCallback((targetCircleId: number, targetCircleName?: string) => {
        if (!Number.isFinite(targetCircleId) || targetCircleId <= 0) return;
        const nameFromData = circleById.get(targetCircleId)?.name;
        inviteSourceRequestRef.current = null;
        setInviteSourceCircleOverride(null);
        setInviteTargetCircle({
            id: targetCircleId,
            name: targetCircleName || nameFromData || circleDetailT('defaults.circleWithId', {circleId: targetCircleId}),
        });
        setShowInviteSheet(true);
    }, [circleById, circleDetailT]);
    const activeDiscussionCircleData = useMemo(() => {
        return circleById.get(activeDiscussionCircleId) || null;
    }, [circleById, activeDiscussionCircleId]);
    const activeCircleArchived = activeDiscussionCircleData?.lifecycleStatus === 'Archived';
    const activeCircleArchivedReason = normalizeIdentityCopy(activeDiscussionCircleData?.archiveReason || '');
    const activeCircleArchivedAt = activeDiscussionCircleData?.archivedAt || null;
    const archivedCircleNotice = useMemo(() => {
        if (activeCircleArchivedReason) {
            return circleDetailT('archived.noticeWithReason', { reason: activeCircleArchivedReason });
        }
        return circleDetailT('archived.notice');
    }, [activeCircleArchivedReason, circleDetailT]);
    const activeDiscussionMembers = (activeDiscussionCircleData?.members || []) as Array<{
        circleAlias?: string | null;
        effectiveDisplayName?: string | null;
        displaySource?: string | null;
        displayCircleId?: number | null;
        inheritedFromCircleId?: number | null;
        globalHandle?: string | null;
        globalDisplayName?: string | null;
        user: {
            id: number;
            handle: string;
            pubkey: string;
            displayName: string | null;
            avatarUri: string | null;
        };
        role: 'Owner' | 'Admin' | 'Moderator' | 'Member';
        status: 'Active' | 'Banned' | 'Left';
        identityLevel: 'Visitor' | 'Initiate' | 'Member' | 'Elder';
        joinedAt: string;
    }>;
    const {
        memberCardTargetPubkey,
        memberCardFollowState,
        toggleSelectedMemberFollow,
        reconcilePendingWithServer,
        clearSelectedMemberFollowState,
    } = useMemberFollowCardState({
        selectedMember,
        setSelectedMember,
        activeDiscussionCircleId,
        loadMemberProfile,
        locale,
        indexTimeoutHint: circleDetailT('memberDirectory.followSyncing'),
    });
    const resolvedActiveCircleMembershipSnapshot = useMemo(() => resolveActiveMembershipSnapshot({
        routeCircleId: circleId,
        activeCircleId: activeDiscussionCircleId,
        routeSnapshot: membershipSnapshot,
        activeTierSnapshot: activeTierMembershipSnapshot,
    }), [activeDiscussionCircleId, activeTierMembershipSnapshot, circleId, membershipSnapshot]);
    const activeCircleIdentityStatus = useMemo(() => resolveActiveIdentityStatus({
        routeCircleId: circleId,
        activeCircleId: activeDiscussionCircleId,
        routeStatus: identityStatus,
        activeTierStatus: activeTierIdentityStatus,
    }), [activeDiscussionCircleId, activeTierIdentityStatus, circleId, identityStatus]);
    const creatorFallbackMembershipSnapshot = useMemo(() => deriveCreatorFallbackMembershipSnapshot({
        snapshot: resolvedActiveCircleMembershipSnapshot,
        circleId: activeDiscussionCircleId,
        circleCreatorId: activeDiscussionCircleData?.creator?.id,
        circleCreatorPubkey: activeDiscussionCircleData?.creator?.pubkey,
        circleCreatedAt: activeDiscussionCircleData?.createdAt,
        sessionUserId: sessionUser?.id,
        walletPubkey,
    }), [
        activeDiscussionCircleData?.createdAt,
        activeDiscussionCircleData?.creator?.id,
        activeDiscussionCircleData?.creator?.pubkey,
        activeDiscussionCircleId,
        resolvedActiveCircleMembershipSnapshot,
        sessionUser?.id,
        walletPubkey,
    ]);
    const activeCircleMembershipSnapshot = useMemo(() => deriveIdentityStatusFallbackMembershipSnapshot({
        snapshot: creatorFallbackMembershipSnapshot,
        status: activeCircleIdentityStatus,
        circleId: activeDiscussionCircleId,
        circleCreatedAt: activeDiscussionCircleData?.createdAt,
    }), [
        activeDiscussionCircleData?.createdAt,
        activeCircleIdentityStatus,
        activeDiscussionCircleId,
        creatorFallbackMembershipSnapshot,
    ]);
    const activeCircleMembershipFetchFailed = useMemo(() => {
        if (activeDiscussionCircleId === circleId) {
            return membershipRefreshFailed;
        }
        return activeTierMembershipRefreshFailed;
    }, [
        activeDiscussionCircleId,
        activeTierMembershipRefreshFailed,
        circleId,
        membershipRefreshFailed,
    ]);
    const viewerCircleState = useMemo(
        () => deriveViewerCircleState({ snapshot: activeCircleMembershipSnapshot }),
        [activeCircleMembershipSnapshot],
    );
    const viewerMembership = viewerCircleState.membership;
    const viewerJoinedCurrentCircle = viewerCircleState.joined;
    const viewerCurrentRole = viewerCircleState.role;
    const viewerContributionLevel = viewerCircleState.contributionLevel;
    const canViewActiveCircleSummary = Boolean(
        Number.isFinite(activeDiscussionCircleId)
        && activeDiscussionCircleId > 0
        && viewerJoinedCurrentCircle
        && !activeCircleMembershipFetchFailed,
    );
    const activeCircleSummaryHref = useMemo(() => {
        const baseHref = `/circles/${activeDiscussionCircleId}/summary`;
        if (
            Number.isFinite(circleId)
            && circleId > 0
            && Number.isFinite(activeDiscussionCircleId)
            && activeDiscussionCircleId > 0
            && activeDiscussionCircleId !== circleId
        ) {
            return `${baseHref}?returnCircleId=${circleId}`;
        }
        return baseHref;
    }, [activeDiscussionCircleId, circleId]);
    const viewerIdentityState: ViewerIdentityState = viewerCircleState.identityState;
    const [communitySourceMaterials, setCommunitySourceMaterials] = useState<SourceMaterialRecord[]>([]);
    const [communitySourceMaterialsLoading, setCommunitySourceMaterialsLoading] = useState(false);
    const [communitySourceMaterialsError, setCommunitySourceMaterialsError] = useState<string | null>(null);
    const [communityExternalAppBindings, setCommunityExternalAppBindings] = useState<CircleExternalAppBindingRecord[]>([]);
    const [communityExternalAppBindingsLoading, setCommunityExternalAppBindingsLoading] = useState(false);
    const [communityExternalAppBindingsError, setCommunityExternalAppBindingsError] = useState<string | null>(null);
    const [targetGovernanceRequests, setTargetGovernanceRequests] = useState<CircleGovernanceRequest[]>([]);
    const [targetGovernanceRequestsLoading, setTargetGovernanceRequestsLoading] = useState(false);
    const [sourceMaterialActionPendingId, setSourceMaterialActionPendingId] = useState<number | null>(null);
    const [selectedCommunicationDraftSourceIds, setSelectedCommunicationDraftSourceIds] = useState<Set<number>>(new Set());
    const [communicationDraftCreating, setCommunicationDraftCreating] = useState(false);
    useEffect(() => {
        setSelectedCommunicationDraftSourceIds(new Set());
    }, [activeDiscussionCircleId]);
    const accessPanelRequestSeqRef = useRef(0);
    const viewerDraftPermissionMembership = useMemo(() => {
        if (!viewerMembership) return null;
        return {
            role: viewerMembership.role,
            status: viewerMembership.status,
            identityLevel: viewerMembership.identityLevel,
        } as const;
    }, [viewerMembership]);
    const crucibleViewerCollaborationIdentity = useMemo(() => ({
        userId: sessionUser?.id ?? null,
        pubkey: sessionUserPubkey,
        displayName: sessionUser?.displayName ?? null,
        handle: sessionUser?.handle ?? null,
    }), [
        sessionUser?.displayName,
        sessionUser?.handle,
        sessionUser?.id,
        sessionUserPubkey,
    ]);
    const viewerCanModerateRooms = useMemo(() => {
        if (!viewerMembership || viewerMembership.status !== 'Active') return false;
        return viewerMembership.role === 'Owner'
            || viewerMembership.role === 'Admin'
            || viewerMembership.role === 'Moderator';
    }, [viewerMembership]);
    const viewerCanManageCircleLifecycle = useMemo(() => {
        if (!viewerMembership || viewerMembership.status !== 'Active') return false;
        return viewerMembership.role === 'Owner' || viewerMembership.role === 'Admin';
    }, [viewerMembership]);
    useEffect(() => {
        let cancelled = false;
        if (activeCircleIdForSettings === null || !viewerCanManageCircleLifecycle) {
            setCircleLifecycleActionStatus({ state: 'idle' });
            return () => {
                cancelled = true;
            };
        }
        void readCircleLifecycle(activeCircleIdForSettings)
            .then(({ plan }) => {
                if (cancelled) return;
                if (!plan) {
                    setCircleLifecycleActionStatus({ state: 'idle' });
                    return;
                }
                setCircleLifecycleActionStatus({
                    state: plan.status,
                    requestId: plan.governingRequestId,
                    plan,
                });
                if (plan.action === 'merge') {
                    setCircleMergeActionStatus({
                        state: plan.status === 'merged' ? 'merged' : 'merge_pending',
                        successorRequestId: plan.governingRequestId,
                        plan,
                    });
                }
            })
            .catch((error) => {
                if (cancelled) return;
                setCircleLifecycleActionStatus({
                    state: 'error',
                    message: error instanceof Error
                        ? error.message
                        : circleDetailT('settings.errors.lifecycleFailed'),
                });
            });
        return () => {
            cancelled = true;
        };
    }, [
        activeCircleIdForSettings,
        circleDetailT,
        viewerCanManageCircleLifecycle,
    ]);
    const viewerCanManageGovernanceBindings = useMemo(() => {
        if (!viewerMembership || viewerMembership.status !== 'Active') return false;
        return viewerMembership.role === 'Owner' || viewerMembership.role === 'Admin';
    }, [viewerMembership]);
    const handleCircleLifecycleAction = useCallback(async (
        requestedAction?: 'archive' | 'restore' | 'dissolve',
        dissolution?: {
            reason: string;
            exitWindowEndsAt: string;
            retentionSuccessorHomeIdentityBindingId?: string | null;
        },
    ) => {
        if (activeCircleIdForSettings === null) {
            setCircleLifecycleActionStatus({
                state: 'error',
                message: circleDetailT('settings.errors.invalidCircleForAccessPolicy'),
            });
            return;
        }
        if (!viewerCanManageCircleLifecycle) {
            setCircleLifecycleActionStatus({
                state: 'error',
                message: circleDetailT('settings.errors.lifecycleForbidden'),
            });
            return;
        }
        const action = requestedAction ?? (activeCircleArchived ? 'restore' : 'archive');
        setCircleLifecycleActionStatus({ state: 'saving' });
        try {
            let result = await submitCircleLifecycleAction({
                circleId: activeCircleIdForSettings,
                action,
                reason: dissolution?.reason ?? null,
                governanceRequestId: circleLifecycleActionStatus.requestId ?? null,
                exitWindowEndsAt: dissolution?.exitWindowEndsAt ?? null,
                retentionSuccessorHomeIdentityBindingId:
                    dissolution?.retentionSuccessorHomeIdentityBindingId ?? null,
            });
            if (result.status === 'requires_governance') {
                setCircleLifecycleActionStatus({
                    state: 'requires_governance',
                    requestId: result.request?.id ?? null,
                });
                void loadGovernanceBindingsForCircle(activeCircleIdForSettings);
                return;
            }
            if (
                result.status === 'reconciliation_pending'
                || result.status === 'converged'
                || result.status === 'dissolution_pending'
                || result.status === 'blocked'
            ) {
                setCircleLifecycleActionStatus({
                    state: result.status,
                    requestId: result.plan?.governingRequestId ?? null,
                    plan: result.plan ?? null,
                });
                if (result.status === 'converged') {
                    await refetch();
                    void loadGovernanceBindingsForCircle(activeCircleIdForSettings);
                }
                return;
            }
            if (result.status === 'requires_wallet_transaction') {
                setCircleLifecycleActionStatus({
                    state: 'awaiting_wallet',
                    requestId: result.plan?.governingRequestId ?? circleLifecycleActionStatus.requestId ?? null,
                    plan: result.plan ?? null,
                });
                const activeSdk = sdk;
                if (!activeSdk) throw new Error('wallet_sdk_unavailable');
                const signature = await runWalletAction({
                    kind: 'circle_settings_update',
                    source: 'circle_lifecycle',
                    key: `circle_lifecycle:${activeCircleIdForSettings}:${result.chainAction}`,
                    run: () => result.chainAction === 'restore'
                        ? activeSdk.circles.restoreCircle(activeCircleIdForSettings)
                        : activeSdk.circles.archiveCircle(activeCircleIdForSettings, ''),
                });
                const observedSlot = await waitForSignatureSlot(activeSdk.connection, signature);
                if (!observedSlot) throw new Error('circle_lifecycle_transaction_confirmation_timeout');
                result = await submitCircleLifecycleAction({
                    circleId: activeCircleIdForSettings,
                    action,
                    reason: null,
                    transactionSignature: signature,
                    governanceRequestId: circleLifecycleActionStatus.requestId ?? null,
                });
                if (result.status !== 'reconciliation_pending' && result.status !== 'converged') {
                    throw new Error('circle_lifecycle_projection_reconciliation_pending');
                }
                if (result.status === 'reconciliation_pending') {
                    result = await submitCircleLifecycleAction({
                        circleId: activeCircleIdForSettings,
                        action,
                        reason: null,
                        transactionSignature: signature,
                        governanceRequestId: result.plan?.governingRequestId
                            ?? circleLifecycleActionStatus.requestId
                            ?? null,
                    });
                }
            }
            setCircleLifecycleActionStatus({
                state: result.status === 'converged' ? 'converged' : 'reconciliation_pending',
                requestId: result.plan?.governingRequestId ?? null,
                plan: result.plan ?? null,
            });
            await refetch();
            void loadGovernanceBindingsForCircle(activeCircleIdForSettings);
        } catch (error) {
            setCircleLifecycleActionStatus({
                state: 'error',
                message: error instanceof Error ? error.message : circleDetailT('settings.errors.lifecycleFailed'),
            });
        }
    }, [
        activeCircleArchived,
        activeCircleIdForSettings,
        circleDetailT,
        circleLifecycleActionStatus.requestId,
        loadGovernanceBindingsForCircle,
        refetch,
        runWalletAction,
        sdk,
        viewerCanManageCircleLifecycle,
    ]);
    const handleCircleMergeSourceApproval = useCallback(async (
        mergeDisposition: CircleMergeDispositionInput,
    ) => {
        if (activeCircleIdForSettings === null) return;
        setCircleMergeActionStatus((current) => ({ ...current, state: 'saving', message: null }));
        try {
            const result = await submitCircleMergeSourceApproval({
                sourceCircleId: activeCircleIdForSettings,
                mergeDisposition: circleMergeActionStatus.sourceRequestId ? null : mergeDisposition,
                governanceRequestId: circleMergeActionStatus.sourceRequestId ?? null,
            });
            if (result.status === 'requires_governance') {
                setCircleMergeActionStatus((current) => ({
                    ...current,
                    state: 'requires_source_governance',
                    sourceRequestId: result.request?.id ?? current.sourceRequestId ?? null,
                }));
                return;
            }
            if (result.status !== 'source_approved') throw new Error('invalid_circle_merge_source_response');
            setCircleMergeActionStatus((current) => ({
                ...current,
                state: 'source_approved',
                sourceRequestId: result.approval?.sourceApprovalRequestId ?? current.sourceRequestId ?? null,
            }));
        } catch (error) {
            setCircleMergeActionStatus((current) => ({
                ...current,
                state: 'error',
                message: error instanceof Error ? error.message : 'circle_merge_source_approval_failed',
            }));
        }
    }, [activeCircleIdForSettings, circleMergeActionStatus.sourceRequestId]);
    const handleCircleMergeSuccessorAcceptance = useCallback(async (
        sourceApprovalRequestIds: string[],
        reason: string,
    ) => {
        if (activeCircleIdForSettings === null) return;
        setCircleMergeActionStatus((current) => ({ ...current, state: 'saving', message: null }));
        try {
            const result = await submitCircleMergeSuccessorAcceptance({
                successorCircleId: activeCircleIdForSettings,
                sourceApprovalRequestIds: circleMergeActionStatus.successorRequestId
                    ? []
                    : sourceApprovalRequestIds,
                governanceRequestId: circleMergeActionStatus.successorRequestId ?? null,
                reason,
            });
            if (result.status === 'requires_governance') {
                setCircleMergeActionStatus((current) => ({
                    ...current,
                    state: 'requires_successor_governance',
                    successorRequestId: result.request?.id ?? current.successorRequestId ?? null,
                }));
                return;
            }
            if (result.status !== 'merge_pending') throw new Error('invalid_circle_merge_successor_response');
            setCircleMergeActionStatus((current) => ({
                ...current,
                state: 'merge_pending',
                successorRequestId: result.plan?.governingRequestId ?? current.successorRequestId ?? null,
                plan: result.plan ?? null,
            }));
            await refetch();
        } catch (error) {
            setCircleMergeActionStatus((current) => ({
                ...current,
                state: 'error',
                message: error instanceof Error ? error.message : 'circle_merge_successor_acceptance_failed',
            }));
        }
    }, [
        activeCircleIdForSettings,
        circleMergeActionStatus.successorRequestId,
        refetch,
    ]);
    const handleCircleMergeFinalize = useCallback(async () => {
        if (activeCircleIdForSettings === null || !circleMergeActionStatus.successorRequestId) return;
        setCircleMergeActionStatus((current) => ({ ...current, state: 'saving', message: null }));
        try {
            const result = await finalizeCircleMerge({
                successorCircleId: activeCircleIdForSettings,
                governanceRequestId: circleMergeActionStatus.successorRequestId,
            });
            if (result.status !== 'merged') throw new Error('invalid_circle_merge_finalization_response');
            setCircleMergeActionStatus((current) => ({
                ...current,
                state: 'merged',
                plan: result.plan ?? null,
            }));
            await refetch();
        } catch (error) {
            setCircleMergeActionStatus((current) => ({
                ...current,
                state: 'error',
                message: error instanceof Error ? error.message : 'circle_merge_finalization_failed',
            }));
        }
    }, [activeCircleIdForSettings, circleMergeActionStatus.successorRequestId, refetch]);
    useEffect(() => {
        selectedMemberRequestRef.current = null;
        setSelectedMember(null);
        clearSelectedMemberFollowState();
        // This effect is a route/session boundary reset. Depending on the selected-member
        // follow-state callback would close the card again when its profile finishes loading.
        // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [activeDiscussionCircleId, sessionUser?.id, walletPubkey]);
    const isAccessPanelRequestCurrent = useCallback((requestSeq?: number) => (
        requestSeq == null || accessPanelRequestSeqRef.current === requestSeq
    ), []);
    const refreshAccessPanelSourceMaterials = useCallback(async (targetCircleId: number, requestSeq?: number) => {
        setCommunitySourceMaterialsLoading(true);
        setCommunitySourceMaterialsError(null);
        try {
            const materials = await fetchSourceMaterials(targetCircleId, {
                includeGovernedReviewQueue: true,
            });
            if (!isAccessPanelRequestCurrent(requestSeq)) return;
            setCommunitySourceMaterials(materials);
        } catch (error) {
            if (!isAccessPanelRequestCurrent(requestSeq)) return;
            console.warn('[CirclePage] access panel source material load failed', error);
            setCommunitySourceMaterials([]);
            setCommunitySourceMaterialsError(circleRoomsT('notices.actionFailed'));
        } finally {
            if (isAccessPanelRequestCurrent(requestSeq)) {
                setCommunitySourceMaterialsLoading(false);
            }
        }
    }, [circleRoomsT, isAccessPanelRequestCurrent]);

    const refreshTargetGovernanceRequests = useCallback(async (targetCircleId: number, requestSeq?: number) => {
        setTargetGovernanceRequestsLoading(true);
        try {
            const payload = await fetchCircleGovernanceRequests(targetCircleId, 'target', {
                targetType: 'source_material',
                actionType: 'source_material.accept',
                state: 'active',
            });
            if (!isAccessPanelRequestCurrent(requestSeq)) return;
            setTargetGovernanceRequests(payload.requests.filter((request) =>
                request.targetType === 'source_material'
                && request.actionType === 'source_material.accept'
                && request.state === 'active'
            ));
        } catch (error) {
            if (!isAccessPanelRequestCurrent(requestSeq)) return;
            console.warn('[CirclePage] target governance request load failed', error);
            setTargetGovernanceRequests([]);
        } finally {
            if (isAccessPanelRequestCurrent(requestSeq)) {
                setTargetGovernanceRequestsLoading(false);
            }
        }
    }, [isAccessPanelRequestCurrent]);

    const refreshCircleExternalAppBindings = useCallback(async (targetCircleId: number, requestSeq?: number) => {
        setCommunityExternalAppBindingsLoading(true);
        setCommunityExternalAppBindingsError(null);
        try {
            const bindings = await fetchCircleExternalAppBindings(targetCircleId);
            if (!isAccessPanelRequestCurrent(requestSeq)) return;
            setCommunityExternalAppBindings(bindings);
        } catch (error) {
            if (!isAccessPanelRequestCurrent(requestSeq)) return;
            console.warn('[CirclePage] circle external app bindings load failed', error);
            setCommunityExternalAppBindings([]);
            setCommunityExternalAppBindingsError(circleRoomsT('notices.actionFailed'));
        } finally {
            if (isAccessPanelRequestCurrent(requestSeq)) {
                setCommunityExternalAppBindingsLoading(false);
            }
        }
    }, [circleRoomsT, isAccessPanelRequestCurrent]);

    useEffect(() => {
        const requestSeq = accessPanelRequestSeqRef.current + 1;
        accessPanelRequestSeqRef.current = requestSeq;
        if (!Number.isFinite(activeDiscussionCircleId) || activeDiscussionCircleId <= 0 || !viewerJoinedCurrentCircle) {
            setCommunitySourceMaterials([]);
            setCommunitySourceMaterialsLoading(false);
            setCommunitySourceMaterialsError(null);
            setCommunityExternalAppBindings([]);
            setCommunityExternalAppBindingsLoading(false);
            setCommunityExternalAppBindingsError(null);
            setTargetGovernanceRequests([]);
            setTargetGovernanceRequestsLoading(false);
            return;
        }

        void refreshAccessPanelSourceMaterials(activeDiscussionCircleId, requestSeq);
        void refreshTargetGovernanceRequests(activeDiscussionCircleId, requestSeq);
        void refreshCircleExternalAppBindings(activeDiscussionCircleId, requestSeq);
        return () => {
            if (accessPanelRequestSeqRef.current === requestSeq) {
                accessPanelRequestSeqRef.current += 1;
            }
        };
    }, [
        activeDiscussionCircleId,
        circleGovernanceBindings,
        refreshAccessPanelSourceMaterials,
        refreshCircleExternalAppBindings,
        refreshTargetGovernanceRequests,
        viewerJoinedCurrentCircle,
    ]);
    const accessPanelViewModel = useMemo(() => buildAccessPanelViewModel({
        sourceMaterials: communitySourceMaterials,
        externalAppBindings: communityExternalAppBindings,
        governanceBindings: circleGovernanceBindings,
        targetGovernanceRequests,
        canReviewSourceMaterials: viewerCanModerateRooms,
        canAccessSourceMaterials: canViewActiveCircleSummary,
        t: circleRoomsT,
    }), [
        canViewActiveCircleSummary,
        circleGovernanceBindings,
        circleRoomsT,
        communityExternalAppBindings,
        communitySourceMaterials,
        targetGovernanceRequests,
        viewerCanModerateRooms,
    ]);
    const accessPanelLoading = communitySourceMaterialsLoading
        || communityExternalAppBindingsLoading
        || targetGovernanceRequestsLoading;
    const accessPanelError = communitySourceMaterialsError || communityExternalAppBindingsError;
    const handleAccessPanelMaterialAction = useCallback(async (materialId: number) => {
        if (!Number.isFinite(activeDiscussionCircleId) || activeDiscussionCircleId <= 0) return;
        setSourceMaterialActionPendingId(materialId);
        setCommunitySourceMaterialsError(null);
        try {
            const result = await updateSourceMaterialLifecycle({
                circleId: activeDiscussionCircleId,
                sourceMaterialId: materialId,
                nextStatus: 'accepted_to_plaza',
            });
            if (result.status === 'requires_governance') {
                setCreateCircleStatusNotice(circleRoomsT('notices.submittedReview'));
                await Promise.all([
                    refreshTargetGovernanceRequests(activeDiscussionCircleId),
                    refreshAccessPanelSourceMaterials(activeDiscussionCircleId),
                ]);
            } else {
                setCreateCircleStatusNotice(circleRoomsT('notices.accepted'));
                await refreshAccessPanelSourceMaterials(activeDiscussionCircleId);
            }
        } catch (error) {
            console.warn('[CirclePage] source material lifecycle action failed', error);
            setCommunitySourceMaterialsError(circleRoomsT('notices.actionFailed'));
        } finally {
            setSourceMaterialActionPendingId(null);
        }
    }, [
        activeDiscussionCircleId,
        circleRoomsT,
        refreshAccessPanelSourceMaterials,
        refreshTargetGovernanceRequests,
    ]);
    const toggleCommunicationDraftSource = useCallback((materialId: number) => {
        setSelectedCommunicationDraftSourceIds((current) => {
            const next = new Set(current);
            if (next.has(materialId)) next.delete(materialId);
            else next.add(materialId);
            return next;
        });
    }, []);
    const handleCreateCommunicationDraft = useCallback(async () => {
        if (
            communicationDraftCreating
            || !Number.isFinite(activeDiscussionCircleId)
            || activeDiscussionCircleId <= 0
            || selectedCommunicationDraftSourceIds.size === 0
        ) return;
        setCommunicationDraftCreating(true);
        setCommunitySourceMaterialsError(null);
        try {
            const response = await createDraftFromCommunicationSourceMaterials({
                circleId: activeDiscussionCircleId,
                sourceMaterialIds: Array.from(selectedCommunicationDraftSourceIds),
            });
            if (response.result.status === 'pending') {
                setCreateCircleStatusNotice(circleRoomsT('notices.draftPending'));
                return;
            }
            if (response.result.status === 'generation_failed') {
                setCommunitySourceMaterialsError(circleRoomsT('notices.draftFailed'));
                return;
            }
            if (response.result.status === 'created' || response.result.status === 'existing') {
                setSelectedCommunicationDraftSourceIds(new Set());
                setCreateCircleStatusNotice(circleRoomsT('notices.draftCreated'));
                await Promise.all([
                    refetch(),
                    refreshAccessPanelSourceMaterials(activeDiscussionCircleId),
                ]);
                handleOpenCrucible(response.result.draftPostId);
            }
        } catch (error) {
            console.warn('[CirclePage] communication source draft creation failed', error);
            setCommunitySourceMaterialsError(circleRoomsT('notices.draftFailed'));
        } finally {
            setCommunicationDraftCreating(false);
        }
    }, [
        activeDiscussionCircleId,
        circleRoomsT,
        communicationDraftCreating,
        handleOpenCrucible,
        refetch,
        refreshAccessPanelSourceMaterials,
        selectedCommunicationDraftSourceIds,
    ]);
    const joinBannerState = useMemo(
        () => resolveCircleJoinBannerState(activeCircleMembershipSnapshot, Boolean(publicKey), joinCopy, {
            connectWallet: circleDetailT('join.banner.connectWallet'),
            connectWalletHint: circleDetailT('join.banner.connectWalletHint'),
            registerIdentity: circleDetailT('join.banner.registerIdentity'),
            registerIdentityHint: circleDetailT('join.banner.registerIdentityHint'),
            retrySession: circleDetailT('join.banner.retrySession'),
            retrySessionHint: lastErrorMessage || circleDetailT('join.banner.retrySessionHint'),
            unresolvedMembershipLabel: circleDetailT('join.processing'),
            unresolvedMembershipHint: joinCopy.hint.visitorDefault,
        }, {
            identityState,
            membershipFetchFailed: activeCircleMembershipFetchFailed,
        }),
        [
            activeCircleMembershipFetchFailed,
            activeCircleMembershipSnapshot,
            circleDetailT,
            identityState,
            joinCopy,
            lastErrorMessage,
            publicKey,
        ],
    );
    const joinBannerHint = useMemo(() => {
        if (!activeCircleMembershipSnapshot) {
            return joinBannerState.hint;
        }
        const shouldUseIdentityHint = (
            activeCircleMembershipSnapshot.joinState === 'guest'
            || activeCircleMembershipSnapshot.joinState === 'can_join'
            || activeCircleMembershipSnapshot.joinState === 'left'
        );
        if (shouldUseIdentityHint && activeCircleIdentityStatus?.hint) {
            if (activeCircleIdentityStatus.messagingMode === 'dust_only') {
                return joinCopy.hint.visitorDefault;
            }
            return normalizeIdentityCopy(activeCircleIdentityStatus.hint);
        }
        return joinBannerState.hint;
    }, [activeCircleIdentityStatus, activeCircleMembershipSnapshot, joinBannerState.hint, joinCopy.hint.visitorDefault]);
    const joinBannerActionLabel = useMemo(() => {
        if (joinActionLoading) return circleDetailT('join.processing');
        if (
            identityJoinActionStatus === 'identity_registered_join_pending'
            || identityJoinActionStatus === 'join_failed_after_identity'
        ) {
            return circleDetailT('join.identityAfterRegistration.continueJoin');
        }
        return joinBannerState.label;
    }, [circleDetailT, identityJoinActionStatus, joinActionLoading, joinBannerState.label]);
    const plazaViewerStateHint = useMemo(() => {
        if (!activeCircleIdentityStatus?.hint || !activeCircleMembershipSnapshot) {
            return null;
        }
        if (activeCircleIdentityStatus.messagingMode !== 'formal') {
            return null;
        }
        if (
            activeCircleMembershipSnapshot.joinState === 'pending'
            || activeCircleMembershipSnapshot.joinState === 'invite_required'
            || activeCircleMembershipSnapshot.joinState === 'banned'
        ) {
            return null;
        }
        return normalizeIdentityCopy(activeCircleIdentityStatus.hint);
    }, [activeCircleIdentityStatus, activeCircleMembershipSnapshot]);
    const repostMembershipPending = useMemo(() => deriveFeedRepostMembershipPending({
        joinState: activeCircleMembershipSnapshot?.joinState ?? null,
        joinBannerHint,
        pendingMembershipHint: joinCopy.hint.pending,
    }), [activeCircleMembershipSnapshot?.joinState, joinBannerHint, joinCopy.hint.pending]);
    const identityProgressCard = useMemo(() => {
        if (
            !activeCircleIdentityStatus
            || activeCircleIdentityStatus.messagingMode !== 'formal'
            || activeCircleMembershipSnapshot?.joinState !== 'joined'
        ) {
            return null;
        }
        const currentLevel = viewerContributionLevel ?? activeCircleIdentityStatus.currentLevel;
        const currentLabel = identityCopy.levelLabels[currentLevel] || identityCopy.levelLabels[activeCircleIdentityStatus.currentLevel];
        const nextLabel = activeCircleIdentityStatus.nextLevel
            ? identityCopy.levelLabels[activeCircleIdentityStatus.nextLevel]
            : null;
        const roleLabel = resolveCircleDetailRoleLabel(viewerCurrentRole, circleDetailT);
        return {
            currentLabel,
            currentBadgeState: mapIdentityLevelToDisplayState(currentLevel),
            currentLine: circleDetailT('identityProgress.currentContributionLevel', {levelLabel: currentLabel}),
            roleLine: roleLabel ? circleDetailT('identityProgress.currentRole', {roleLabel}) : null,
            nextLabel: nextLabel ? circleDetailT('identityProgress.nextLevel', {levelLabel: nextLabel}) : null,
            nextBadgeState: activeCircleIdentityStatus.nextLevel
                ? mapIdentityLevelToDisplayState(activeCircleIdentityStatus.nextLevel)
                : null,
            hint: normalizeIdentityCopy(activeCircleIdentityStatus.hint),
        };
    }, [
        activeCircleIdentityStatus,
        activeCircleMembershipSnapshot?.joinState,
        circleDetailT,
        identityCopy.levelLabels,
        viewerContributionLevel,
        viewerCurrentRole,
    ]);
    useEffect(() => {
        setIdentityProgressExpanded(false);
    }, [activeDiscussionCircleId, activeCircleMembershipSnapshot?.joinState]);
    const identityTransitionNotice = useMemo(() => {
        if (activeCircleIdentityStatus?.messagingMode !== 'formal') return null;
        const transition = activeCircleIdentityStatus?.recentTransition;
        const changedAt = transition?.changedAt;
        if (!transition || !changedAt) return null;

        const from = identityCopy.levelLabels[transition.from] || transition.from;
        const to = identityCopy.levelLabels[transition.to] || transition.to;
        const reason = normalizeIdentityCopy(transition.reason?.trim());
        const suffix = reason ? ` · ${reason}` : '';
        return `${from} → ${to} · ${formatRelativeTime(changedAt)}${suffix}`;
    }, [
        activeCircleIdentityStatus?.messagingMode,
        activeCircleIdentityStatus?.recentTransition,
        formatRelativeTime,
        identityCopy.levelLabels,
    ]);
    const identityHistoryRows = useMemo(() => {
        if (activeCircleIdentityStatus?.messagingMode !== 'formal') return [] as string[];
        const rows = activeCircleIdentityStatus?.history || [];
        if (!Array.isArray(rows) || rows.length === 0) return [] as string[];
        return rows.slice(0, 3).map((row) => {
            const from = identityCopy.levelLabels[row.from] || row.from;
            const to = identityCopy.levelLabels[row.to] || row.to;
            const reason = normalizeIdentityCopy(row.reason?.trim());
            return `${from} → ${to} · ${formatRelativeTime(row.changedAt)}${reason ? ` · ${reason}` : ''}`;
        });
    }, [
        activeCircleIdentityStatus?.messagingMode,
        activeCircleIdentityStatus?.history,
        formatRelativeTime,
        identityCopy.levelLabels,
    ]);
    const activeIdentityTransitionStorageKey = useMemo(() => {
        if (activeCircleIdentityStatus?.messagingMode !== 'formal') return null;
        const changedAt = activeCircleIdentityStatus?.recentTransition?.changedAt;
        if (!changedAt) return null;
        const viewerScope = sessionUser?.pubkey || walletPubkey || 'anonymous';
        return `alcheme_identity_transition_dismissed:${viewerScope}:${activeDiscussionCircleId}:${changedAt}`;
    }, [
        activeCircleIdentityStatus?.messagingMode,
        activeCircleIdentityStatus?.recentTransition?.changedAt,
        activeDiscussionCircleId,
        sessionUser?.pubkey,
        walletPubkey,
    ]);
    useEffect(() => {
        if (!activeIdentityTransitionStorageKey) {
            setIdentityTransitionDismissed(false);
            return;
        }
        try {
            setIdentityTransitionDismissed(window.sessionStorage.getItem(activeIdentityTransitionStorageKey) === '1');
        } catch {
            setIdentityTransitionDismissed(false);
        }
    }, [activeIdentityTransitionStorageKey]);
    const dismissIdentityTransition = useCallback(() => {
        if (activeIdentityTransitionStorageKey) {
            try {
                window.sessionStorage.setItem(activeIdentityTransitionStorageKey, '1');
            } catch {
                // Ignore storage failures and still hide locally for this render.
            }
        }
        setIdentityTransitionDismissed(true);
    }, [activeIdentityTransitionStorageKey]);
    const suggestedIdentityHandle = useMemo(() => {
        return '';
    }, [publicKey]);
    const memberDirectoryNotice = useMemo(() => {
        if (activeDiscussionMembers.length > 0) return null;
        if (activeTierMembershipLoading) return null;
        if (!walletPubkey) {
            return circleDetailT('memberDirectory.notice.connectAndJoin');
        }
        if (activeCircleMembershipSnapshot && activeCircleMembershipSnapshot.joinState !== 'joined') {
            return circleDetailT('memberDirectory.notice.joinRequired');
        }
        return null;
    }, [
        activeCircleMembershipSnapshot,
        activeDiscussionMembers.length,
        activeTierMembershipLoading,
        circleDetailT,
        walletPubkey,
    ]);
    const canOpenMemberProfiles = !memberDirectoryNotice && activeDiscussionMembers.length > 0;
    const openMemberProfile = useCallback(async (member: typeof activeDiscussionMembers[number]) => {
        const memberDisplayName = member.effectiveDisplayName
            || member.circleAlias
            || member.user.displayName
            || member.user.handle
            || circleDetailT('fallbacks.unknownMember');
        const memberHandle = member.globalHandle || member.user.handle || '';
        const baseProfile: MemberProfile = {
            userId: member.user.id,
            pubkey: member.user.pubkey,
            name: memberDisplayName,
            handle: memberHandle,
            avatarUri: member.user.avatarUri ?? null,
            role: mapGqlRoleToCardRole(member.role),
            contributionLevel: member.identityLevel,
            joinedAgo: formatRelativeTime(member.joinedAt),
            viewerFollows: false,
            isSelf: member.user.pubkey === walletPubkey,
            stats: null,
            sharedCircles: [],
            recentActivity: [],
            loading: true,
            errorMessage: null,
        };

        selectedMemberRequestRef.current = member.user.id;
        setSelectedMember(baseProfile);

        try {
            const result = await loadMemberProfile({
                variables: {
                    circleId: activeDiscussionCircleId,
                    userId: member.user.id,
                },
            });

            if (selectedMemberRequestRef.current !== member.user.id) return;

            const profile = result.data?.memberProfile;
            if (!profile) {
                setSelectedMember({
                    ...baseProfile,
                    loading: false,
                    errorMessage: circleDetailT('memberDirectory.errors.profileUnavailable'),
                });
                return;
            }

            setSelectedMember({
                userId: member.user.id,
                pubkey: profile.user.pubkey,
                name: memberDisplayName,
                handle: memberHandle,
                avatarUri: profile.user.avatarUri ?? null,
                role: mapGqlRoleToCardRole(profile.role),
                contributionLevel: member.identityLevel,
                joinedAgo: formatRelativeTime(profile.joinedAt),
                viewerFollows: profile.viewerFollows,
                isSelf: profile.isSelf,
                stats: {
                    citations: profile.totalCitations,
                    crystals: profile.ownedCrystalCount,
                    circles: profile.circleCount,
                },
                sharedCircles: profile.sharedCircles,
                recentActivity: profile.recentActivity.map((activity) => ({
                    type: activity.type,
                    text: activity.text,
                    time: formatRelativeTime(activity.createdAt),
                })),
                loading: false,
                errorMessage: null,
            });
            reconcilePendingWithServer(member.user.id, profile.viewerFollows);
        } catch (error) {
            console.error('[CirclePage] load member profile failed', error);
            if (selectedMemberRequestRef.current !== member.user.id) return;
            setSelectedMember({
                ...baseProfile,
                loading: false,
                errorMessage: circleDetailT('memberDirectory.errors.loadFailed'),
            });
        }
    }, [
        activeDiscussionCircleId,
        loadMemberProfile,
        reconcilePendingWithServer,
        circleDetailT,
        formatRelativeTime,
        walletPubkey,
    ]);

    const topKnowledgeContributorPubkeys = useMemo(() => {
        const stats = new Map<string, number>();
        for (const knowledge of knowledgeData?.knowledgeByCircle || []) {
            const authorPubkey = knowledge.author?.pubkey;
            if (!authorPubkey) continue;
            stats.set(authorPubkey, (stats.get(authorPubkey) || 0) + 1);
        }
        let maxCount = 0;
        for (const count of stats.values()) {
            maxCount = Math.max(maxCount, count);
        }
        if (maxCount <= 0) return new Set<string>();
        const topSet = new Set<string>();
        for (const [pubkey, count] of stats.entries()) {
            if (count === maxCount) {
                topSet.add(pubkey);
            }
        }
        return topSet;
    }, [knowledgeData]);

    const isActiveMainCreator = !!(
        walletPubkey &&
        activeMainCircleData?.creator?.pubkey &&
        activeMainCircleData.creator.pubkey === walletPubkey
    );
    const activeMainMembers = (activeMainCircleData?.members || []) as Array<{
        user: { pubkey: string };
        role: 'Owner' | 'Admin' | 'Moderator' | 'Member';
    }>;
    const isActiveMainAdmin = !!(
        walletPubkey &&
        activeMainMembers.some((member) =>
            member.user.pubkey === walletPubkey &&
            (member.role === 'Owner' || member.role === 'Admin' || member.role === 'Moderator')
        )
    );
    const isTopKnowledgeContributor = !!(
        walletPubkey &&
        topKnowledgeContributorPubkeys.has(walletPubkey)
    );

    const canCreateNextLevel = isActiveMainCreator || isActiveMainAdmin || isTopKnowledgeContributor;
    const nextLevelPermissionHint = useMemo(() => {
        if (canCreateNextLevel) return null;
        if (!walletPubkey) return circleDetailT('fork.nextLevelPermission.connectWallet');
        return circleDetailT('fork.nextLevelPermission.insufficientRole');
    }, [canCreateNextLevel, circleDetailT, walletPubkey]);
    useEffect(() => {
        if (!forkCreateInputs) {
            setForkCreateHint(null);
            return;
        }
        setForkCreateHint(buildForkReadinessViewModel({
            sourceCircleId: forkSourceCircleId,
            sourceCircleName: forkSourceCircleName,
            sourceLevel: forkSourceLevel,
            resolvedInputs: forkCreateInputs,
            contributorCount: forkContributorCount,
            actorRole: viewerMembership?.role ?? null,
            actorIdentityLevel: normalizeForkActorIdentityLevel(viewerMembership?.identityLevel),
            qualificationSnapshot: forkQualificationSnapshot,
        }, createForkReadinessCopy(forkReadinessT)));
    }, [
        forkReadinessT,
        forkContributorCount,
        forkCreateInputs,
        forkQualificationSnapshot,
        forkSourceCircleId,
        forkSourceCircleName,
        forkSourceLevel,
        viewerMembership?.identityLevel,
        viewerMembership?.role,
    ]);

    const openForkCreateSheet = useCallback(async (options?: {
        preserveError?: boolean;
    }) => {
        if (!Number.isFinite(forkSourceCircleId) || forkSourceCircleId <= 0) {
            setForkCreateError(circleDetailT('fork.errors.invalidSourceCircle'));
            setShowForkCreateSheet(true);
            return;
        }

        setShowCreateCircle(false);
        if (!options?.preserveError) {
            setForkCreateError(null);
        }
        setShowForkCreateSheet(true);
        setForkCreateLoading(true);
        try {
            const [resolvedInputs, qualificationSnapshot] = await Promise.all([
                fetchForkTeam04ResolvedInputs({
                    circleId: forkSourceCircleId,
                }),
                fetchForkQualificationSnapshot({
                    circleId: forkSourceCircleId,
                }).catch(() => null),
            ]);
            setForkCreateInputs(resolvedInputs);
            setForkQualificationSnapshot(qualificationSnapshot);
        } catch (error) {
            console.error('[CirclePage] load fork create inputs failed', error);
            setForkCreateInputs(null);
            setForkQualificationSnapshot(null);
            setForkCreateHint(null);
            setForkCreateError(circleDetailT('fork.errors.loadRequirementsFailed'));
        } finally {
            setForkCreateLoading(false);
        }
    }, [circleDetailT, forkSourceCircleId]);

    useEffect(() => {
        if (!Number.isFinite(forkSourceCircleId) || forkSourceCircleId <= 0) {
            setForkLineage(null);
            setForkLineageLoading(false);
            setForkLineageError(null);
            return;
        }
        if (restoredPendingForkSourceRef.current !== forkSourceCircleId) {
            return;
        }
        if (pendingForkFinalization?.sourceCircleId === forkSourceCircleId) {
            writePendingForkFinalization(pendingForkFinalization);
            return;
        }
        clearPendingForkFinalization(forkSourceCircleId);
    }, [forkSourceCircleId, pendingForkFinalization]);

    useEffect(() => {
        if (!Number.isFinite(forkSourceCircleId) || forkSourceCircleId <= 0) {
            return;
        }
        if (restoredPendingForkSourceRef.current === forkSourceCircleId) {
            return;
        }
        restoredPendingForkSourceRef.current = forkSourceCircleId;

        const restoredPendingFinalization = readPendingForkFinalization(forkSourceCircleId);
        if (!restoredPendingFinalization) {
            return;
        }

        setPendingForkFinalization(restoredPendingFinalization);
        setForkCreateError(restoredPendingFinalization.targetCircleId
            ? circleDetailT('fork.errors.pendingFinalizationDetected', {
                targetCircleId: restoredPendingFinalization.targetCircleId,
            })
            : circleDetailT('fork.errors.governancePending', {
                requestId: restoredPendingFinalization.governanceRequestId ?? '',
            }));
        void openForkCreateSheet({ preserveError: true });
    }, [circleDetailT, forkSourceCircleId, openForkCreateSheet]);

    useEffect(() => {
        if (!Number.isFinite(forkSourceCircleId) || forkSourceCircleId <= 0) {
            setForkLineage(null);
            setForkLineageLoading(false);
            setForkLineageError(null);
            return;
        }

        let cancelled = false;
        setForkLineageLoading(true);
        setForkLineageError(null);

        fetchForkLineageView({ circleId: forkSourceCircleId })
            .then((view) => {
                if (cancelled) return;
                setForkLineage(view);
            })
            .catch((error) => {
                if (cancelled) return;
                console.error('[CirclePage] load fork lineage failed', error);
                setForkLineage(null);
                setForkLineageError(circleDetailT('forkLineage.errors.loadFailed'));
            })
            .finally(() => {
                if (cancelled) return;
                setForkLineageLoading(false);
            });

        return () => {
            cancelled = true;
        };
    }, [forkSourceCircleId]);

    const hasForkTargetLineage = Boolean(forkLineage?.asTarget?.length);

    useEffect(() => {
        if (!Number.isFinite(activeDiscussionCircleId) || activeDiscussionCircleId <= 0) {
            setForkContext(null);
            setForkContextLoading(false);
            setForkContextError(null);
            return;
        }
        if (!hasForkTargetLineage) {
            setForkContext(null);
            setForkContextLoading(false);
            setForkContextError(null);
            return;
        }

        let cancelled = false;
        setForkContextLoading(true);
        setForkContextError(null);

        fetchForkContextView({ circleId: activeDiscussionCircleId })
            .then((view) => {
                if (cancelled) return;
                setForkContext(view);
            })
            .catch((error) => {
                if (cancelled) return;
                const message = error instanceof Error ? error.message : String(error || '');
                if (
                    message.includes('authentication_required')
                    || message.includes('target_circle_membership_required')
                    || message.includes('circle_not_found')
                ) {
                    setForkContext(null);
                    setForkContextError(null);
                    return;
                }
                console.error('[CirclePage] load fork context failed', error);
                setForkContext(null);
                setForkContextError(circleDetailT('forkContext.errors.loadFailed'));
            })
            .finally(() => {
                if (cancelled) return;
                setForkContextLoading(false);
            });

        return () => {
            cancelled = true;
        };
    }, [activeDiscussionCircleId, circleDetailT, hasForkTargetLineage]);

    const forkSourceLineageItems = forkLineage?.asSource || [];
    const forkTargetLineageItems = forkLineage?.asTarget || [];
    const showForkLineageCard = forkLineageLoading
        || Boolean(forkLineageError)
        || forkSourceLineageItems.length > 0
        || forkTargetLineageItems.length > 0;
    const showForkContextPanel = forkContextLoading
        || Boolean(forkContextError)
        || Boolean(forkContext?.capsule);

    const handleBoundaryTier = useCallback((direction: 'prev' | 'next') => {
        setBoundaryPills(null);

        if (isInAux) {
            // Auxiliary circle: navigate among siblings with same parentId
            const sibIdx = auxSiblings.findIndex(s => s.id === activeTierId);
            const targetIdx = direction === 'next' ? sibIdx + 1 : sibIdx - 1;
            if (targetIdx >= 0 && targetIdx < auxSiblings.length) {
                const target = auxSiblings[targetIdx];
                setIsPillLifted(true);
                setTimeout(() => {
                    handleTierChange(target.id);
                    setIsPillLifted(false);
                }, 400);
            }
        } else {
            // Main circle: navigate among main circles only
            const mainIdx = mainCircles.findIndex(s => s.id === activeTierId);
            const targetIdx = direction === 'next' ? mainIdx + 1 : mainIdx - 1;
            if (targetIdx >= 0 && targetIdx < mainCircles.length) {
                const target = mainCircles[targetIdx];
                setIsPillLifted(true);
                setTimeout(() => {
                    handleTierChange(target.id);
                    setActiveTab(direction === 'next' ? 'plaza' : 'sanctuary');
                    setIsPillLifted(false);
                }, 400);
            }
        }
    }, [activeTierId, handleTierChange, isInAux, auxSiblings, mainCircles]);

    const handleQuickJumpToCircle = useCallback((targetId: string) => {
        const target = subCircles.find((s) => s.id === targetId);
        if (!target) return;
        handleTierChange(targetId);
    }, [subCircles, handleTierChange]);

    const creationInitialGhostSettings = (
        circleGhostSettingsSource === 'circle' || circleGhostSettingsSource === 'pending'
    )
        ? (circleGhostSettings ?? DEFAULT_CIRCLE_GHOST_SETTINGS)
        : undefined;
    const visibleCreateCircleNotice = createCircleStatusNotice || (!showCreateCircle ? createCircleNotice : null);

    useEffect(() => {
        if (!visibleCreateCircleNotice) return;
        const timer = setTimeout(() => {
            setCreateCircleStatusNotice(null);
            clearCreateCircleNotice();
        }, CREATE_CIRCLE_NOTICE_AUTO_DISMISS_MS);
        return () => clearTimeout(timer);
    }, [visibleCreateCircleNotice, clearCreateCircleNotice]);

    return (
        <div className={isPlaza ? styles.pageChat : activeTab === 'feed' ? styles.pageFeed : styles.page} style={colorTempStyle as React.CSSProperties} suppressHydrationWarning>
            {/* ═══ Unified header + tabs ═══ */}
            <div className={isPlaza || activeTab === 'feed' ? styles.stickyTop : undefined}>
                <div className="content-container">
                    <motion.header
                        className={styles.header}
                        initial={{ opacity: 0, y: 8 }}
                        animate={{ opacity: 1, y: 0 }}
                        transition={{ duration: 0.4, ease: [0.2, 0.8, 0.2, 1] }}
                    >
                        <Link
                            href="/circles"
                            className={styles.backButton}
                            aria-label={circleDetailT('header.backToCirclesAria')}
                        >
                            <ArrowLeft size={20} strokeWidth={1.5} />
                        </Link>
                        <div className={styles.headerInfo}>
                            <div className={styles.circleIcon}>
                                <Users size={18} strokeWidth={1.5} />
                            </div>
                            <div className={styles.headerText}>
                                {loading ? (
                                    <Skeleton width={120} height={20} />
                                ) : (
                                    <>
                                        <h1 className={styles.circleName}>{circleName}</h1>
                                        <p className={styles.circleMeta}>
                                            {circleDetailT('header.meta', {
                                                memberCount: activeSubCircle.memberCount,
                                                crystalCount: activeSubCircle.crystalCount,
                                            })}
                                        </p>
                                    </>
                                )}
                            </div>
                        </div>
                        {hasRealData && subCircles.length > 0 && (
                            <TierPill
                                subCircles={subCircles}
                                activeTierId={activeTierId}
                                onTierChange={handleTierChange}
                                isLifted={isPillLifted}
                                setIsLifted={setIsPillLifted}
                                onCreateCircle={() => {
                                    setCreatePermissionError(null);
                                    setCreateCircleStatusNotice(null);
                                    setPendingInviteCircleId(null);
                                    clearCreateCircleNotice();
                                    setShowCreateCircle(true);
                                }}
                            />
                        )}
                        {hasRealData && activeSubCircle && (
                            <button
                                type="button"
                                className={`${styles.settingsButton} ${activeShortcutIsPrimary ? styles.shortcutButtonActive : ''}`}
                                onClick={handleToggleActiveCircleShortcut}
                                aria-label={activeShortcutIsPrimary
                                    ? circleDetailT('header.shortcutUnsetAria')
                                    : circleDetailT('header.shortcutSetAria')}
                                title={activeShortcutIsPrimary
                                    ? circleDetailT('header.shortcutUnsetAria')
                                    : circleDetailT('header.shortcutSetAria')}
                            >
                                <Pin size={18} strokeWidth={activeShortcutIsPrimary ? 2 : 1.5} />
                            </button>
                        )}
                        <button
                            className={styles.settingsButton}
                            onClick={() => setShowNotifications(true)}
                            aria-label={circleDetailT('header.notificationsAria')}
                            style={{ position: 'relative' }}
                        >
                            <Bell size={18} strokeWidth={1.5} />
                            <span style={{
                                position: 'absolute', top: -2, right: -2,
                                width: 8, height: 8, borderRadius: '50%',
                                background: 'var(--color-accent-gold)',
                                display: notifications.some(n => !n.read) ? 'block' : 'none',
                            }} />
                        </button>
                        <button
                            className={styles.settingsButton}
                            onClick={() => setShowSettings(true)}
                            aria-label={circleDetailT('header.settingsAria')}
                        >
                            <Settings size={18} strokeWidth={1.5} />
                        </button>
                    </motion.header>
                    {visibleCreateCircleNotice && (
                        <div className={styles.createCircleNotice} role="status">
                            {visibleCreateCircleNotice}
                        </div>
                    )}
                    {hasRealData && showForkLineageCard && (
                        <Card state="ore" className={styles.forkLineageCard}>
                            <div className={styles.forkLineageHeader}>
                                <div>
                                    <p className={styles.forkLineageEyebrow}>{circleDetailT('forkLineage.eyebrow')}</p>
                                    <h2 className={styles.forkLineageTitle}>{circleDetailT('forkLineage.title')}</h2>
                                </div>
                                {forkLineageLoading && (
                                    <span className={styles.forkLineageStatus}>{circleDetailT('forkLineage.syncing')}</span>
                                )}
                            </div>
                            {forkLineageError ? (
                                <p className={styles.forkLineageError}>{forkLineageError}</p>
                            ) : (
                                <div className={styles.forkLineageList}>
                                    {forkTargetLineageItems.map((item) => {
                                        const originAnchorRef = shortenForkLineageToken(item.originAnchorRef);
                                        const executionAnchorDigest = shortenForkLineageToken(item.executionAnchorDigest);
                                        const migrationManifestDigest = shortenForkLineageToken(
                                            typeof item.migrationManifest?.manifestDigest === 'string'
                                                ? item.migrationManifest.manifestDigest
                                                : null,
                                        );
                                        const targetGovernanceHome = readForkTargetGovernanceHome(item.migrationManifest);
                                        return (
                                            <div key={`target-${item.lineageId}`} className={styles.forkLineageItem}>
                                                <div className={styles.forkLineageItemHeader}>
                                                    <span className={styles.forkLineageBadge}>{circleDetailT('forkLineage.badges.currentFrom')}</span>
                                                    <span className={styles.forkLineageItemTitle}>{item.sourceCircleName}</span>
                                                </div>
                                                <p className={styles.forkLineageBody}>{item.declarationText}</p>
                                                {item.migrationManifest && (
                                                    <p className={styles.forkLineageBody}>{circleDetailT('forkLineage.migrationBoundary')}</p>
                                                )}
                                                <div className={styles.forkLineageMeta}>
                                                    <span>{formatForkDeclarationStatus(item.status, circleDetailT)}</span>
                                                    {originAnchorRef && <span>{circleDetailT('forkLineage.meta.originAnchor', {anchor: originAnchorRef})}</span>}
                                                    {executionAnchorDigest && <span>{circleDetailT('forkLineage.meta.executionDigest', {digest: executionAnchorDigest})}</span>}
                                                    {migrationManifestDigest && <span>{circleDetailT('forkLineage.meta.migrationManifest', {digest: migrationManifestDigest})}</span>}
                                                    {targetGovernanceHome && (
                                                        <span>{circleDetailT('forkLineage.meta.governanceHome', {
                                                            identityBindingId: targetGovernanceHome.identityBindingId,
                                                            bootstrapState: targetGovernanceHome.bootstrapState,
                                                        })}</span>
                                                    )}
                                                </div>
                                            </div>
                                        );
                                    })}
                                    {forkSourceLineageItems.map((item) => {
                                        const markerSchedule = describeForkMarkerSchedule(item, circleDetailT, locale);
                                        const originAnchorRef = shortenForkLineageToken(item.originAnchorRef);
                                        const migrationManifestDigest = shortenForkLineageToken(
                                            typeof item.migrationManifest?.manifestDigest === 'string'
                                                ? item.migrationManifest.manifestDigest
                                                : null,
                                        );
                                        const targetGovernanceHome = readForkTargetGovernanceHome(item.migrationManifest);
                                        return (
                                            <div key={`source-${item.lineageId}`} className={styles.forkLineageItem}>
                                                <div className={styles.forkLineageItemHeader}>
                                                    <span className={styles.forkLineageBadge}>{circleDetailT('forkLineage.badges.sourceFork')}</span>
                                                    <Link
                                                        href={`/circles/${item.targetCircleId}`}
                                                        className={styles.forkLineageLink}
                                                    >
                                                        {item.targetCircleName}
                                                    </Link>
                                                </div>
                                                <p className={styles.forkLineageBody}>{describeForkMarkerState(item, circleDetailT, locale)}</p>
                                                {item.migrationManifest && (
                                                    <p className={styles.forkLineageBody}>{circleDetailT('forkLineage.migrationBoundary')}</p>
                                                )}
                                                <div className={styles.forkLineageMeta}>
                                                    {markerSchedule && <span>{markerSchedule}</span>}
                                                    <span>{formatForkDeclarationStatus(item.status, circleDetailT)}</span>
                                                    {originAnchorRef && <span>{circleDetailT('forkLineage.meta.originAnchor', {anchor: originAnchorRef})}</span>}
                                                    {migrationManifestDigest && <span>{circleDetailT('forkLineage.meta.migrationManifest', {digest: migrationManifestDigest})}</span>}
                                                    {targetGovernanceHome && (
                                                        <span>{circleDetailT('forkLineage.meta.governanceHome', {
                                                            identityBindingId: targetGovernanceHome.identityBindingId,
                                                            bootstrapState: targetGovernanceHome.bootstrapState,
                                                        })}</span>
                                                    )}
                                                </div>
                                            </div>
                                        );
                                    })}
                                </div>
                            )}
                        </Card>
                    )}
                    {hasRealData && showForkContextPanel && (
                        <ForkContextPanel
                            context={forkContext}
                            loading={forkContextLoading}
                            error={forkContextError}
                        />
                    )}
                    {(identityProgressCard || activeDiscussionCircleId) && (
                        <div className={styles.circleMetaUtilityRow}>
                            <div className={styles.circleMetaUtilityLeft}>
                                {identityProgressCard ? (
                                    <div className={styles.identityProgressAnchor}>
                                        <button
                                            type="button"
                                            className={styles.identityProgressToggle}
                                            aria-expanded={identityProgressExpanded}
                                            onClick={() => setIdentityProgressExpanded((prev) => !prev)}
                                        >
                                            <div className={styles.identityProgressSummary}>
                                                <span className={styles.identityProgressLabel}>{circleDetailT('identityProgress.contributionLevelLabel')}</span>
                                                <span className={styles.identityProgressLevelIcon}>
                                                    <IdentityBadge
                                                        state={identityProgressCard.currentBadgeState}
                                                        label={identityProgressCard.currentLabel}
                                                        compact
                                                    />
                                                </span>
                                                <span className={styles.identityProgressValue}>{identityProgressCard.currentLabel}</span>
                                                <ChevronDown
                                                    size={13}
                                                    className={`${styles.identityProgressChevron} ${identityProgressExpanded ? styles.identityProgressChevronExpanded : ''}`}
                                                />
                                            </div>
                                        </button>
                                        {identityProgressExpanded && (
                                            <div className={styles.identityProgressMain}>
                                                <div className={styles.identityProgressTitleRow}>
                                                    <span className={styles.identityProgressCurrent}>
                                                        <span className={styles.identityProgressLevelIcon}>
                                                            <IdentityBadge
                                                                state={identityProgressCard.currentBadgeState}
                                                                label={identityProgressCard.currentLabel}
                                                                compact
                                                            />
                                                        </span>
                                                        <span>{identityProgressCard.currentLine}</span>
                                                    </span>
                                                    {identityProgressCard.nextLabel && (
                                                        <span className={styles.identityProgressNext}>
                                                            {identityProgressCard.nextBadgeState && (
                                                                <IdentityBadge
                                                                    state={identityProgressCard.nextBadgeState}
                                                                    label={identityProgressCard.nextLabel}
                                                                    compact
                                                                />
                                                            )}
                                                            <span>{identityProgressCard.nextLabel}</span>
                                                        </span>
                                                    )}
                                                </div>
                                                {identityProgressCard.roleLine && (
                                                    <p className={styles.identityProgressRole}>{identityProgressCard.roleLine}</p>
                                                )}
                                                <p className={styles.identityProgressHint}>{identityProgressCard.hint}</p>
                                            </div>
                                        )}
                                    </div>
                                ) : (
                                    <div className={styles.identityProgressStatic}>
                                        <span className={styles.identityProgressLabel}>{circleDetailT('identityProgress.label')}</span>
                                    </div>
                                )}
                            </div>
                            {(activeSubCircle.mode === 'knowledge' || canViewActiveCircleSummary) && (
                                <div className={styles.circleMetaUtilityRight}>
                                    {activeSubCircle.mode === 'knowledge' && (
                                        <button
                                            type="button"
                                            data-testid="circle-feed-entry"
                                            className={`${styles.identitySummaryBtn}${activeTab === 'feed' ? ` ${styles.identitySummaryBtnActive}` : ''}`}
                                            onClick={() => handleSelectCircleTab('feed')}
                                        >
                                            {circleDetailT('identityProgress.feedLink')}
                                        </button>
                                    )}
                                    {canViewActiveCircleSummary && (
                                        <Link
                                            href={activeCircleSummaryHref}
                                            className={styles.identitySummaryBtn}
                                        >
                                            {circleDetailT('identityProgress.summaryLink')}
                                        </Link>
                                    )}
                                </div>
                            )}
                        </div>
                    )}
                    {/* ── Membership Join Banner ── */}
                    {activeCircleArchived && (
                        <div className={styles.joinBanner}>
                            <div className={styles.joinBannerMain}>
                                <span className={styles.joinBannerHint}>
                                    {archivedCircleNotice}
                                </span>
                                <span className={styles.joinBannerActionDisabled}>
                                    {circleDetailT('archived.badge')}
                                </span>
                            </div>
                            {activeCircleArchivedAt && (
                                <div className={styles.archivedBannerMeta}>
                                    {circleDetailT('archived.meta', { date: formatRelativeTime(activeCircleArchivedAt) })}
                                </div>
                            )}
                        </div>
                    )}
                    {!activeCircleArchived && (!activeCircleMembershipSnapshot || activeCircleMembershipSnapshot.joinState !== 'joined') && (
                        <div className={styles.joinBanner}>
                            <div className={styles.joinBannerMain}>
                                <span className={styles.joinBannerHint}>
                                    {joinBannerHint}
                                </span>
                                {joinBannerState.action !== 'passive' && (
                                    <button
                                        onClick={handleJoin}
                                        disabled={joinActionLoading || identityRegistrationLoading || identityRegistrationSyncing}
                                        className={styles.joinBannerAction}
                                    >
                                        {joinBannerActionLabel}
                                    </button>
                                )}
                                {joinBannerState.action === 'passive' && (
                                    <span className={styles.joinBannerActionDisabled}>
                                        {joinBannerState.label}
                                    </span>
                                )}
                            </div>
                            {joinActionError && (
                                <div className={styles.joinBannerError}>
                                    {joinActionError}
                                </div>
                            )}
                        </div>
                    )}
                    {activeCircleMembershipSnapshot?.joinState === 'joined' && identityTransitionNotice && !identityTransitionDismissed && (
                        <div className={styles.identityTransitionBanner}>
                            <div className={styles.identityTransitionMain}>
                                <div className={styles.identityTransitionMainCopy}>
                                    <span className={styles.identityTransitionBadge}>{circleDetailT('identityTransition.badge')}</span>
                                    <span className={styles.identityTransitionText}>{identityTransitionNotice}</span>
                                </div>
                                <button
                                    type="button"
                                    className={styles.identityTransitionClose}
                                    onClick={dismissIdentityTransition}
                                    aria-label={circleDetailT('identityTransition.dismissAria')}
                                >
                                    <X size={14} />
                                </button>
                            </div>
                            {identityHistoryRows.length > 1 && (
                                <div className={styles.identityTransitionHistory}>
                                    {identityHistoryRows.slice(1).map((row) => (
                                        <span key={row} className={styles.identityTransitionHistoryItem}>{row}</span>
                                    ))}
                                </div>
                            )}
                        </div>
                    )}
                    <TabBar tabs={activeTabs} activeTab={activeTab} onTabChange={handleSelectCircleTab} className={styles.tabBar} />
                    {hasRealData && activeSubCircle && (
                        <div
                            ref={communityPanelsRef}
                            className={[
                                styles.communityPanels,
                                isPlaza ? styles.communityPanelsChat : '',
                                openCommunityPanel === 'circles' ? styles.communityPanelsOpenCircles : '',
                                openCommunityPanel === 'rooms' ? styles.communityPanelsOpenRooms : '',
                            ].filter(Boolean).join(' ')}
                        >
                            <div className={styles.communityPanelControls}>
                                <button
                                    type="button"
                                    className={`${styles.communityPanelToggle} ${openCommunityPanel === 'circles' ? styles.communityPanelToggleActive : ''}`}
                                    onClick={() => setOpenCommunityPanel((value) => value === 'circles' ? null : 'circles')}
                                    aria-expanded={openCommunityPanel === 'circles'}
                                    aria-controls="community-panel-floating"
                                >
                                    <span className={styles.communityPanelToggleMain}>
                                        <GitBranch size={15} />
                                        <span className={styles.communityPanelToggleTitle}>{circleTreeT('title')}</span>
                                        <span className={styles.communityPanelToggleMeta}>
                                            {circleTreeT('meta.count', { count: subCircles.length })}
                                        </span>
                                    </span>
                                    <ChevronDown
                                        size={15}
                                        className={`${styles.communityPanelChevron} ${openCommunityPanel === 'circles' ? styles.communityPanelChevronOpen : ''}`}
                                    />
                                </button>
                                <button
                                    type="button"
                                    className={`${styles.communityPanelToggle} ${openCommunityPanel === 'rooms' ? styles.communityPanelToggleActive : ''}`}
                                    onClick={() => setOpenCommunityPanel((value) => value === 'rooms' ? null : 'rooms')}
                                    aria-expanded={openCommunityPanel === 'rooms'}
                                    aria-controls="community-panel-floating"
                                >
                                    <span className={styles.communityPanelToggleMain}>
                                        <Radio size={15} />
                                        <span className={styles.communityPanelToggleTitle}>{circleRoomsT('title')}</span>
                                        <span className={styles.communityPanelToggleMeta}>
                                            {circleRoomsT('meta.externalPrograms', { count: accessPanelViewModel.externalAppCount })}
                                        </span>
                                    </span>
                                    <ChevronDown
                                        size={15}
                                        className={`${styles.communityPanelChevron} ${openCommunityPanel === 'rooms' ? styles.communityPanelChevronOpen : ''}`}
                                    />
                                </button>
                            </div>
                            {openCommunityPanel && (
                                <div
                                    id="community-panel-floating"
                                    className={styles.communityPanelFloating}
                                    role="region"
                                    aria-label={openCommunityPanel === 'circles' ? circleTreeT('aria.panel') : circleRoomsT('aria.panel')}
                                >
                                    {openCommunityPanel === 'circles' ? (
                                        <CircleTreePanel
                                            circles={subCircles}
                                            activeCircleId={activeTierId}
                                            rootCircleId={Number(activeMainCircle?.id || circleId)}
                                            onSelectCircle={(nextCircleId) => {
                                                setOpenCommunityPanel(null);
                                                handleTierChange(nextCircleId);
                                            }}
                                            presentation="content"
                                        />
                                    ) : (
                                        <CircleRoomsPanel
                                            viewModel={accessPanelViewModel}
                                            bindingCircleId={activeDiscussionCircleId}
                                            returnCircleId={circleId}
                                            loading={accessPanelLoading}
                                            error={accessPanelError}
                                            actionPendingMaterialId={sourceMaterialActionPendingId}
                                            onAcceptMaterial={handleAccessPanelMaterialAction}
                                            selectedDraftSourceMaterialIds={selectedCommunicationDraftSourceIds}
                                            draftCreationBusy={communicationDraftCreating}
                                            onToggleDraftSourceMaterial={viewerCanModerateRooms ? toggleCommunicationDraftSource : undefined}
                                            onCreateDraftFromMaterials={viewerCanModerateRooms ? handleCreateCommunicationDraft : undefined}
                                            presentation="content"
                                        />
                                    )}
                                </div>
                            )}
                        </div>
                    )}
                </div>
            </div>

            {/* ── Edge-reveal Boundary Panel ── */}
            <AnimatePresence>
                {boundaryPills && (
                    <motion.div
                        className={styles.boundaryOverlay}
                        initial={{ opacity: 0 }}
                        animate={{ opacity: 1 }}
                        exit={{ opacity: 0 }}
                        transition={{ duration: 0.22 }}
                        onClick={() => setBoundaryPills(null)}
                        style={{ pointerEvents: 'auto' }}
                    >
                        <motion.div
                            className={`${styles.edgePanel} ${boundaryPills === 'left' ? styles.edgePanelLeft : styles.edgePanelRight}`}
                            initial={{ x: boundaryPills === 'left' ? -80 : 80, opacity: 0 }}
                            animate={{ x: 0, opacity: 1 }}
                            exit={{ x: boundaryPills === 'left' ? -80 : 80, opacity: 0 }}
                            transition={{ duration: 0.36, ease: [0.2, 0.8, 0.2, 1] }}
                            onClick={(e) => e.stopPropagation()}
                        >
                            <button className={styles.edgeBtn} onClick={handleBoundaryBack}>
                                <ArrowLeft size={20} strokeWidth={1.5} />
                                <span className={styles.edgeBtnLabel}>{isInAux ? circleDetailT('boundary.backToMain') : circleDetailT('boundary.back')}</span>
                            </button>
                            {(() => {
                                // Determine if there's a valid target to navigate to
                                const dir = boundaryPills === 'left' ? 'prev' : 'next';
                                if (isInAux) {
                                    const sibIdx = auxSiblings.findIndex(s => s.id === activeTierId);
                                    const hasTarget = dir === 'next' ? sibIdx < auxSiblings.length - 1 : sibIdx > 0;
                                    if (!hasTarget) return null;
                                    return (
                                        <button
                                            className={styles.edgeBtn}
                                            onClick={() => handleBoundaryTier(dir)}
                                        >
                                            <Compass size={20} strokeWidth={1.5} />
                                            <span className={styles.edgeBtnLabel}>{circleDetailT('boundary.next')}</span>
                                        </button>
                                    );
                                } else {
                                    const mainIdx = mainCircles.findIndex(s => s.id === activeTierId);
                                    const hasTarget = dir === 'next' ? mainIdx < mainCircles.length - 1 : mainIdx > 0;
                                    if (!hasTarget) return null;
                                    return (
                                        <button
                                            className={styles.edgeBtn}
                                            onClick={() => handleBoundaryTier(dir)}
                                        >
                                            <Compass size={20} strokeWidth={1.5} />
                                            <span className={styles.edgeBtnLabel}>{dir === 'next' ? circleDetailT('boundary.nextLevel') : circleDetailT('boundary.previousLevel')}</span>
                                        </button>
                                    );
                                }
                            })()}
                        </motion.div>
                    </motion.div>
                )}
            </AnimatePresence>

            {/* ── Tab Content with Unified Swipe ── */}
            {isPlaza ? (
                <PlazaTab
                    messages={plazaMessages}
                    loading={loading}
                    onSwipe={handleSwipe}
                    discussionCircleId={activeDiscussionCircleId}
                    walletPubkey={walletPubkey}
                    identityState={identityState}
                    sessionUser={sessionUser}
                    signMessage={signMessage}
                    walletConnection={connection}
                    walletSendTransaction={sendTransaction}
                    viewerJoined={viewerJoinedCurrentCircle}
                    viewerIdentity={viewerIdentityState}
                    viewerRole={viewerCurrentRole}
                    viewerContributionLevel={viewerContributionLevel}
                    quickAuxCircles={quickAuxCircles}
                    onQuickJumpToCircle={handleQuickJumpToCircle}
                    onOpenCrucible={activeSubCircle.tabs.includes('crucible') ? handleOpenCrucible : undefined}
                    onDraftsChanged={activeSubCircle.tabs.includes('crucible')
                        ? () => refetchDrafts({ circleId: activeDiscussionCircleId, limit: 50 })
                        : undefined}
                    onReconcileViewerMembership={reconcileActiveDiscussionMembership}
                    onAvatarTap={canOpenMemberProfiles ? (author, senderPubkey) => {
                        const m = (activeDiscussionCircleData?.members || []).find(
                            (mem: any) => matchesMemberAuthorIdentity({
                                author,
                                senderPubkey,
                                handle: mem.user.handle,
                                pubkey: mem.user.pubkey,
                            }),
                        );
                        if (m) {
                            void openMemberProfile(m);
                        }
                    } : undefined}
                    circleMembers={(activeDiscussionCircleData?.members || []) as any[]}
                    forwardTargets={plazaForwardTargets}
                    currentForwardCircleId={activeTierId}
                    currentForwardLevel={currentCircle?.level || 0}
                    focusEnvelopeId={focusEnvelopeId}
                    focusedAnnouncementId={focusedAnnouncementId}
                    viewerStateHintOverride={plazaViewerStateHint}
                />
            ) : activeTab === 'feed' ? (
                <motion.div
                    className={styles.tabContentFeed}
                    onPanEnd={handleSwipe}
                    style={{ touchAction: 'pan-y' }}
                >
                    <FeedTab
                        posts={feedPosts}
                        circleName={activeSubCircle.name}
                        circleId={activeDiscussionCircleId}
                        walletPubkey={walletPubkey}
                        walletConnected={Boolean(publicKey)}
                        repostMembershipPending={repostMembershipPending}
                        interactionError={feedLikeError || feedRepostError}
                        onLike={publicKey ? (post) => {
                            void likePost({
                                contentId: post.contentId,
                                onChainAddress: post.onChainAddress ?? null,
                                authorPubkey: post.authorPubkey,
                            });
                        } : undefined}
                        onComment={(post) => {
                            handleOpenFeedThread(post);
                        }}
                        onRepost={publicKey && viewerJoinedCurrentCircle ? (post) => {
                            handleRepostFeedPost(post);
                        } : undefined}
                        onCompose={() => {
                            router.push(`/compose?circleId=${activeDiscussionCircleId}&intent=feed`);
                        }}
                        onAvatarTap={canOpenMemberProfiles ? (author) => {
                            const m = (activeDiscussionCircleData?.members || []).find(
                                (mem: any) => matchesMemberAuthorIdentity({
                                    author,
                                    handle: mem.user.handle,
                                    pubkey: mem.user.pubkey,
                                }),
                            );
                            if (m) {
                                void openMemberProfile(m);
                            }
                        } : undefined}
                    />
                </motion.div>
            ) : (
                <motion.div
                    className={styles.tabContent}
                    onPanEnd={handleSwipe}
                    style={{ touchAction: 'pan-y' }}
                >
                    <div className="content-container">
                        <AnimatePresence mode="wait" custom={tierDirection}>
                            <motion.div
                                key={`${activeTierId}-${activeTab}`}
                                custom={tierDirection}
                                variants={contentVariants}
                                initial="enter"
                                animate="center"
                                exit="exit"
                                transition={{ duration: 0.4, ease: [0.2, 0.8, 0.2, 1] }}
                            >
                                {activeTab === 'crucible' && (
                                    <>
                                        {returnGovernanceCaseId ? (
                                            <div style={{ margin: '0 0 12px' }}>
                                                <Link
                                                    href={`/governance/cases/${encodeURIComponent(returnGovernanceCaseId)}`}
                                                    style={{
                                                        display: 'inline-flex',
                                                        alignItems: 'center',
                                                        gap: 6,
                                                        minHeight: 44,
                                                        padding: '8px 12px',
                                                        border: '1px solid color-mix(in srgb, currentColor 18%, transparent)',
                                                        borderRadius: 999,
                                                        color: 'inherit',
                                                        textDecoration: 'none',
                                                        fontSize: '.85rem',
                                                    }}
                                                >
                                                    ← {circleDetailT('governanceReturnToCase')}
                                                </Link>
                                            </div>
                                        ) : null}
                                        <CrucibleTab
                                            drafts={drafts}
                                            circleId={activeDiscussionCircleId}
                                            circleMembers={activeDiscussionMembers}
                                            genesisMode={activeDiscussionCircleData?.genesisMode || 'BLANK'}
                                            knowledgeReferenceOptions={knowledgeReferenceOptions}
                                            draftLifecycleTemplate={circlePolicyDraftLifecycleTemplate}
                                            draftWorkflowPolicy={circlePolicyDraftWorkflowPolicy}
                                            viewerMembership={viewerDraftPermissionMembership}
                                            viewerCollaborationIdentity={crucibleViewerCollaborationIdentity}
                                            requestedDraftId={requestedCrucibleDraftId}
                                            requestedBoundDraftId={requestedBoundDraftId}
                                            requestedDraftVersion={requestedRouteDraftVersion}
                                            onRequestedDraftHandled={handleRequestedCrucibleDraftHandled}
                                            onDraftLifecycleChanged={handleDraftLifecycleChanged}
                                            onCrystallizationComplete={handleCrystallizationComplete}
                                            ensureDiscussionSessionToken={ensureCircleRuntimeDiscussionSessionToken}
                                        />
                                    </>
                                )}
                                {activeTab === 'sanctuary' && <SanctuaryTab crystals={crystals} onCrystalClick={(c) => setSelectedCrystal(c)} />}
                                {activeTab === 'governance' && (
                                    <>
                                        <GovernanceBootstrapCard
                                            circleId={activeDiscussionCircleId}
                                            canActivate={viewerCurrentRole === 'Owner'}
                                            actorPubkey={sessionUserPubkey}
                                            signOpeningMessage={async (signedMessage) => bytesToBase64(
                                                await signMessageForAction({
                                                    kind: 'governance_signal',
                                                    source: 'circle_governance_bootstrap',
                                                    key: `circle-governance-bootstrap:${activeDiscussionCircleId}`,
                                                    message: signedMessage,
                                                }),
                                            )}
                                        />
                                        <GovernanceMigrationRehearsalPanel
                                            circleId={activeDiscussionCircleId}
                                            canRun={viewerCurrentRole === 'Owner'}
                                            autoRead={searchParams.get('governanceMigration') === 'read'}
                                            executeOwnerLock={sdk ? async (intent) => {
                                                const activeSdk = sdk;
                                                const signature = await runWalletAction({
                                                    kind: 'circle_settings_update',
                                                    source: 'governance_migration_cutover',
                                                    key: `governance_migration_cutover:${intent.circleId}:${intent.compatibilityBundleDigest}`,
                                                    run: () => activeSdk.circles.lockLegacyGovernanceActions({
                                                        circleId: intent.circleId,
                                                        actions: intent.actions,
                                                        compatibilityBundleDigest: intent.compatibilityBundleDigest,
                                                        openProposalDispositionDigest: intent.openProposalDispositionDigest,
                                                    }),
                                                });
                                                const observedSlot = await waitForSignatureSlot(
                                                    activeSdk.connection,
                                                    signature,
                                                );
                                                if (!observedSlot) {
                                                    throw new Error('governance_migration_confirmation_timeout');
                                                }
                                                return signature;
                                            } : null}
                                        />
                                        <GovernanceCasesTab
                                            circleId={activeDiscussionCircleId}
                                            canCreate={viewerCurrentRole === 'Owner' || viewerCurrentRole === 'Admin' || viewerCurrentRole === 'Moderator'}
                                        />
                                    </>
                                )}
                            </motion.div>
                        </AnimatePresence>
                    </div>
                </motion.div>
            )}

            {/* ── P2: Create Circle Sheet ── */}
            <CreateCircleSheet
                open={showCreateCircle}
                title={circleDetailT('createCircle.title', {
                    name: activeMainCircle.name,
                    level: activeMainCircle.level,
                })}
                allowFork={true}
                allowNextLevel={canCreateNextLevel}
                nextLevelDisabledReason={nextLevelPermissionHint}
                parentCircleName={circleDetailT('createCircle.parentCircleName', {
                    name: activeMainCircle.name,
                    level: activeMainCircle.level,
                })}
                initialGhostSettings={creationInitialGhostSettings}
                initialDraftLifecycleTemplate={circlePolicyDraftLifecycleTemplate || DEFAULT_CIRCLE_DRAFT_LIFECYCLE_TEMPLATE}
                initialDraftWorkflowPolicy={circlePolicyDraftWorkflowPolicy || DEFAULT_CIRCLE_DRAFT_WORKFLOW_POLICY}
                onSelectFork={() => {
                    void openForkCreateSheet();
                }}
                onClose={() => {
                    setShowCreateCircle(false);
                    setCreatePermissionError(null);
                }}
                onCreate={async (data) => {
                    const parentCircle = Number(activeMainCircle.id);
                    if (Number.isNaN(parentCircle)) {
                        setCreatePermissionError(circleDetailT('createCircle.errors.invalidParentCircle'));
                        return false;
                    }

                    if (data.creationScope === 'next-level' && !canCreateNextLevel) {
                        setCreatePermissionError(
                            nextLevelPermissionHint || circleDetailT('createCircle.errors.noNextLevelPermission'),
                        );
                        return false;
                    }

                    setCreatePermissionError(null);

                    const isNextLevel = data.creationScope === 'next-level';
                    const result = await createCircle({
                        name: data.name,
                        description: data.description,
                        level: isNextLevel ? Math.max(0, (activeMainCircle.level ?? 0) + 1) : Math.max(0, activeMainCircle.level ?? 0),
                        parentCircle,
                        kind: isNextLevel ? 'main' : 'auxiliary',
                        mode: data.mode,
                        genesisMode: data.genesisMode,
                        seededSources: data.seededSources,
                        accessType: data.accessType,
                        minCrystals: data.accessType === 'crystal' ? data.minCrystals : 0,
                        ghostSettings: data.ghostSettings,
                        draftLifecycleTemplate: data.draftLifecycleTemplate,
                        draftWorkflowPolicy: data.draftWorkflowPolicy,
                        postCreateSettingsChanged: data.postCreateSettingsChanged,
                    });

                    if (!result?.txSignature) return false;
                    if (result.notice) {
                        setCreateCircleStatusNotice(result.notice);
                    }

                    let refreshed: Awaited<ReturnType<typeof refetch>> | null = null;
                    try {
                        refreshed = await refetch();
                    } catch (error) {
                        console.warn('[CirclePage] refetch after circle creation failed', error);
                    }

                    if (data.accessType === 'invite') {
                        // Invite-only circles open the invite sheet right after creation.
                        const expectedKind = isNextLevel ? 'main' : 'auxiliary';
                        const expectedLevel = isNextLevel
                            ? Math.max(0, (activeMainCircle.level ?? 0) + 1)
                            : Math.max(0, activeMainCircle.level ?? 0);
                        const allCircles = [
                            refreshed?.data?.circle,
                            ...(refreshed?.data?.circleDescendants || []),
                        ].filter(Boolean) as any[];
                        const createdCircle = allCircles.find((circle) => {
                            if (circle.name !== data.name) return false;
                            const kind = typeof circle.kind === 'string' ? circle.kind.toLowerCase() : 'main';
                            if (kind !== expectedKind) return false;
                            if (Number(circle.level ?? 0) !== expectedLevel) return false;
                            if (expectedKind === 'auxiliary') {
                                return Number(circle.parentCircleId ?? parentCircle) === parentCircle;
                            }
                            return true;
                        });
                        setTimeout(() => {
                            if (createdCircle?.id) {
                                openInviteSheetForCircle(createdCircle.id, createdCircle.name);
                            } else {
                                setPendingInviteCircleId(result.circleId);
                                setCreateCircleStatusNotice(result.notice || circleDetailT('createCircle.notices.invitePending', {
                                    circleId: result.circleId,
                                }));
                            }
                        }, 300);
                    }

                    return true;
                }}
                submitting={isCreatingCircle}
                submitError={createPermissionError || createCircleError}
                submitNotice={createCircleNotice}
            />

            <ForkCreateSheet
                open={showForkCreateSheet}
                sourceCircle={{
                    id: forkSourceCircleId,
                    name: forkSourceCircleName,
                    level: forkSourceLevel,
                    mode: activeSubCircle.mode,
                    accessType: mapAccessRequirementToAccessType(activeSubCircle.accessRequirement),
                    minCrystals: activeSubCircle.accessRequirement.type === 'crystal'
                        ? activeSubCircle.accessRequirement.minCrystals
                        : 0,
                }}
                hint={forkCreateLoading ? null : forkCreateHint}
                initialGhostSettings={creationInitialGhostSettings}
                initialDraftLifecycleTemplate={circlePolicyDraftLifecycleTemplate || DEFAULT_CIRCLE_DRAFT_LIFECYCLE_TEMPLATE}
                initialDraftWorkflowPolicy={circlePolicyDraftWorkflowPolicy || DEFAULT_CIRCLE_DRAFT_WORKFLOW_POLICY}
                initialForkPolicy={circlePolicyForkPolicy || DEFAULT_CIRCLE_FORK_POLICY}
                initialDeclarationText={pendingForkFinalization?.declarationText || ''}
                declarationFrozen={Boolean(pendingForkFinalization?.governanceRequestId)}
                resumePendingFinalization={Boolean(pendingForkFinalization?.targetCircleId)}
                pendingTargetCircleId={pendingForkFinalization?.targetCircleId ?? null}
                onClose={() => {
                    setShowForkCreateSheet(false);
                    setForkCreateError(null);
                }}
                onCreate={async (forkData) => {
                    if (!forkCreateHint?.canSubmitFork) {
                        setForkCreateError(circleDetailT('fork.errors.notQualified'));
                        return false;
                    }

                    setForkCreateError(null);

                    const originAnchorRef = `circle:${forkSourceCircleId}`;
                    if (pendingForkFinalization?.targetCircleId && pendingForkFinalization.executionAnchorDigest) {
                        try {
                            const retryResult = await createForkFromCircle({
                                sourceCircleId: forkSourceCircleId,
                                declarationId: pendingForkFinalization.declarationId,
                                targetCircleId: pendingForkFinalization.targetCircleId,
                                declarationText: pendingForkFinalization.declarationText,
                                executionAnchorDigest: pendingForkFinalization.executionAnchorDigest,
                                originAnchorRef: pendingForkFinalization.originAnchorRef,
                                governanceRequestId: pendingForkFinalization.governanceRequestId,
                            });
                            if (retryResult?.reconciliationPending) {
                                setForkCreateError(circleDetailT('fork.errors.pendingFinalizationStillReconciling', {
                                    targetCircleId: pendingForkFinalization.targetCircleId,
                                }));
                                return false;
                            }
                            setPendingForkFinalization(null);
                            router.push(`/circles/${pendingForkFinalization.targetCircleId}`);
                            return true;
                        } catch (error) {
                            console.error('[CirclePage] retry fork finalization failed', error);
                            setForkCreateError(circleDetailT('fork.errors.pendingFinalizationRetryLastStep', {
                                targetCircleId: pendingForkFinalization.targetCircleId,
                            }));
                            return false;
                        }
                    }

                    const declarationDigest = await sha256Hex(JSON.stringify({
                        sourceCircleId: forkSourceCircleId,
                        sourceCircleName: forkSourceCircleName,
                        declarationText: pendingForkFinalization?.declarationText ?? forkData.declarationText,
                        configVersion: forkCreateInputs?.minimumFieldSet.configVersion ?? null,
                    }));
                    const declarationId = pendingForkFinalization?.declarationId
                        ?? createForkDeclarationId(forkSourceCircleId);
                    const declarationText = pendingForkFinalization?.declarationText
                        ?? forkData.declarationText;
                    const governanceRequestId = pendingForkFinalization?.governanceRequestId ?? null;

                    try {
                        const prepared = await createForkFromCircle({
                            sourceCircleId: forkSourceCircleId,
                            declarationId,
                            declarationText,
                            originAnchorRef,
                            governanceRequestId,
                        });
                        if (prepared.status === 'requires_governance') {
                            const pendingRequestId = prepared.governanceRequestId;
                            if (!pendingRequestId) throw new Error('fork_governance_request_missing');
                            setPendingForkFinalization({
                                sourceCircleId: forkSourceCircleId,
                                declarationId,
                                declarationText,
                                targetCircleId: null,
                                executionAnchorDigest: null,
                                originAnchorRef,
                                governanceRequestId: pendingRequestId,
                            });
                            setForkCreateError(circleDetailT('fork.errors.governancePending', {
                                requestId: pendingRequestId,
                            }));
                            return false;
                        }
                    } catch (error) {
                        console.error('[CirclePage] prepare fork filing failed', error);
                        setForkCreateError(circleDetailT('fork.errors.prepareFilingFailed'));
                        return false;
                    }

                    const result = await createCircle({
                        name: forkData.name,
                        description: forkData.description,
                        level: Math.max(0, forkSourceLevel),
                        kind: 'main',
                        mode: forkData.mode,
                        accessType: forkData.accessType,
                        minCrystals: forkData.accessType === 'crystal' ? forkData.minCrystals : 0,
                        ghostSettings: forkData.ghostSettings,
                        draftLifecycleTemplate: forkData.draftLifecycleTemplate,
                        draftWorkflowPolicy: forkData.draftWorkflowPolicy,
                        postCreateSettingsChanged: forkData.postCreateSettingsChanged,
                        forkAnchor: {
                            sourceCircleId: forkSourceCircleId,
                            forkDeclarationDigest: declarationDigest,
                        },
                    });
                    if (!result) return false;

                    const nextPendingFinalization: PendingForkFinalization = {
                        sourceCircleId: forkSourceCircleId,
                        declarationId,
                        declarationText,
                        targetCircleId: result.circleId,
                        executionAnchorDigest: declarationDigest,
                        originAnchorRef,
                        governanceRequestId,
                    };
                    setPendingForkFinalization(nextPendingFinalization);

                    try {
                        const filingResult = await createForkFromCircle({
                            sourceCircleId: forkSourceCircleId,
                            declarationId,
                            targetCircleId: result.circleId,
                            declarationText,
                            executionAnchorDigest: declarationDigest,
                            originAnchorRef,
                            governanceRequestId,
                        });
                        if (filingResult?.reconciliationPending) {
                            setForkCreateError(circleDetailT('fork.errors.finalizationStillReconciling', {
                                targetCircleId: result.circleId,
                            }));
                            return false;
                        }
                    } catch (error) {
                        console.error('[CirclePage] finalize fork filing failed', error);
                        setForkCreateError(circleDetailT('fork.errors.finalizationRetryLastStep', {
                            targetCircleId: result.circleId,
                        }));
                        return false;
                    }

                    setPendingForkFinalization(null);
                    router.push(`/circles/${result.circleId}`);
                    return true;
                }}
                submitting={isCreatingCircle}
                submitError={forkCreateError || createCircleError}
            />

            {/* ── P2: Circle Settings Sheet ── */}
            <CircleSettingsSheet
                open={showSettings}
                settingsDataReady={hasRealData}
                focusSection={
                    requestedSettingsPanel === 'members'
                        ? 'members'
                        : requestedSettingsPanel === 'governance'
                            ? 'governance'
                            : null
                }
                circleId={Number(activeSubCircle.id) || null}
                circleName={activeSubCircle.name}
                circleType={activeCircleTypeForSettings}
                circleMode={activeSubCircle.mode}
                accessType={activeSubCircle.accessRequirement.type}
                minCrystals={activeSubCircle.accessRequirement.type === 'crystal' ? activeSubCircle.accessRequirement.minCrystals : 0}
                allowForwardOut={false}
                forwardPolicyEditable={false}
                forwardPolicyNotice={circleDetailT('settings.forwardPolicyNotice')}
                identityRules={activeCircleIdentityStatus?.thresholds ?? null}
                members={settingsMembers}
                memberDirectoryNotice={memberDirectoryNotice}
                currentUserRole={mapGqlRoleToCardRole(viewerMembership?.role || 'Member')}
                currentUserActualRole={viewerMembership?.role || 'Member'}
                currentUserId={sessionUser?.id ?? null}
                ghostSettings={circleGhostSettings}
                ghostSettingsSource={circleGhostSettingsSource}
                ghostSettingsGovernancePending={circleGhostSettingsGovernancePending}
                ghostSettingsLoading={circleGhostSettingsLoading}
                ghostSettingsSaving={circleGhostSettingsSaving}
                ghostSettingsError={circleGhostSettingsError}
                primaryGeoAnchor={circlePrimaryGeoAnchor}
                primaryGeoAnchorLoading={circlePrimaryGeoAnchorLoading}
                primaryGeoAnchorSaving={circlePrimaryGeoAnchorSaving}
                primaryGeoAnchorError={circlePrimaryGeoAnchorError}
                primaryGeoAnchorGovernanceRequestId={circlePrimaryGeoAnchorGovernanceRequestId}
                draftLifecycleTemplate={circlePolicyDraftLifecycleTemplate || DEFAULT_CIRCLE_DRAFT_LIFECYCLE_TEMPLATE}
                draftWorkflowPolicy={circlePolicyDraftWorkflowPolicy || DEFAULT_CIRCLE_DRAFT_WORKFLOW_POLICY}
                draftLifecycleSaving={circlePolicySaving}
                draftLifecycleError={circlePolicyError}
                draftLifecycleNotice={circlePolicyNotice}
                draftPromptScopes={circleDraftPrompts}
                draftPromptLoading={circleDraftPromptsLoading}
                draftPromptSaving={circleDraftPromptsSaving}
                draftPromptError={circleDraftPromptsError}
                accessPolicyEditable={viewerMembership?.role === 'Owner' || viewerMembership?.role === 'Admin'}
                accessPolicySaving={circleAccessPolicySaving}
                accessPolicyError={circleAccessPolicyError}
                accessPolicyNotice={accessPolicyNoticeToDisplay}
                accessPolicyGovernanceRequired={accessPolicyGovernanceRequired}
                onAccessPolicyDraftChange={() => {
                    setCircleAccessPolicyStatus('idle');
                    setCircleAccessPolicyError(null);
                }}
                agents={CIRCLE_AGENT_GOVERNANCE_UI_ENABLED ? circleAgents : []}
                agentPolicy={CIRCLE_AGENT_GOVERNANCE_UI_ENABLED ? circleAgentPolicy : null}
                agentPolicyLoading={CIRCLE_AGENT_GOVERNANCE_UI_ENABLED ? circleAgentPolicyLoading : false}
                agentPolicySaving={CIRCLE_AGENT_GOVERNANCE_UI_ENABLED ? circleAgentPolicySaving : false}
                agentPolicyError={CIRCLE_AGENT_GOVERNANCE_UI_ENABLED ? circleAgentPolicyError : null}
                governanceCommittee={circleGovernanceCommittee}
                governanceResourceReadiness={circleGovernanceResourceReadiness}
                committeeProfile={circleGovernanceCommitteeProfile}
                committeeProfileLoading={circleGovernanceCommitteeProfileLoading}
                committeeProfileStatus={circleGovernanceCommitteeProfileStatus}
                canManageGovernanceBindings={viewerCanManageGovernanceBindings}
                committeeGovernanceRequests={committeeGovernanceRequests}
                targetGovernanceBindings={circleGovernanceBindings}
                committeeGovernanceBindings={committeeGovernanceBindings}
                committeeGovernanceRequestsLoading={committeeGovernanceRequestsLoading}
                committeeGovernanceSignalActionKey={committeeGovernanceSignalActionKey}
                committeeGovernanceSignalError={committeeGovernanceSignalError}
                governanceRecovery={governanceRecovery}
                circleLifecycleStatus={activeDiscussionCircleData?.lifecycleStatus ?? null}
                canManageLifecycle={viewerCanManageCircleLifecycle}
                lifecycleActionStatus={circleLifecycleActionStatus}
                mergeActionStatus={circleMergeActionStatus}
                ownerTransferRequests={circleOwnerTransferRequests}
                onClose={() => setShowSettings(false)}
                onSaveAccessPolicy={async ({ accessType, minCrystals }) => {
                    if (activeCircleIdForSettings === null) {
                        setCircleAccessPolicyError(circleDetailT('settings.errors.invalidCircleForAccessPolicy'));
                        return;
                    }
                    if (!sessionUserPubkey || !signMessage) {
                        setCircleAccessPolicyError(circleDetailT('settings.errors.accessPolicyWalletRequired'));
                        throw new Error('wallet_sign_message_unavailable');
                    }
                    const targetCircleId = activeCircleIdForSettings;
                    const pendingPostCreateSettings = loadPendingPostCreateSettings(targetCircleId);
                    const nextMinCrystals = accessType === 'crystal'
                        ? Math.max(1, Math.min(0xffff, Math.floor(Number(minCrystals || 1))))
                        : 0;
                    const currentMinCrystals = activeSubCircle.accessRequirement.type === 'crystal'
                        ? Math.max(1, Math.min(0xffff, Math.floor(Number(activeSubCircle.accessRequirement.minCrystals || 1))))
                        : 0;
                    const minCrystalsChanged = nextMinCrystals !== currentMinCrystals;
                    const policyChanged = accessType !== activeSubCircle.accessRequirement.type;
                    if (!accessPolicyGovernanceRequired && minCrystalsChanged && !sdk) {
                        setCircleAccessPolicyError(circleDetailT('settings.errors.accessPolicyWalletRequired'));
                        throw new Error('wallet_sdk_unavailable');
                    }
                    let flagsProjectionUpdated = false;
                    let policySaved = false;
                    let policyRequiresGovernance = false;

                    setCircleAccessPolicySaving(true);
                    setCircleAccessPolicyError(null);
                    setCircleAccessPolicyStatus('idle');
                    try {
                        if (!accessPolicyGovernanceRequired && minCrystalsChanged) {
                            const activeSdk = sdk;
                            if (!activeSdk) {
                                throw new Error('wallet_sdk_unavailable');
                            }
                            const circlesModule = activeSdk.circles as typeof activeSdk.circles & {
                                updateCircleFlags: (
                                    circleId: number,
                                    flags: ReturnType<typeof encodeCircleFlags>,
                                ) => Promise<string>;
                            };
                            await runWalletAction({
                                kind: 'circle_settings_update',
                                source: 'circle_settings_access_flags',
                                key: `circle_settings_access_flags:${targetCircleId}`,
                                run: () => circlesModule.updateCircleFlags(targetCircleId, encodeCircleFlags({
                                    kind: activeSubCircle.kind,
                                    mode: activeSubCircle.mode,
                                    minCrystals: nextMinCrystals,
                                })),
                            });

                            const indexed = await waitForCircleMinCrystalsProjection({
                                circleId: targetCircleId,
                                expectedMinCrystals: nextMinCrystals,
                            });
                            if (!indexed) {
                                throw new Error('circle_min_crystals_projection_timeout');
                            }
                            flagsProjectionUpdated = true;
                        }

                        if (policyChanged || accessPolicyGovernanceRequired || pendingPostCreateSettings) {
                            const policyResult = pendingPostCreateSettings
                                ? await updateCirclePostCreateSettings(
                                    targetCircleId,
                                    {
                                        ...pendingPostCreateSettings.patch,
                                        joinPolicy: { accessType, minCrystals: nextMinCrystals },
                                    },
                                    {
                                        actorPubkey: sessionUserPubkey,
                                        signMessage: signCircleSettingsMessage(
                                            'circle_post_create_settings_recovery',
                                            `circle_post_create_settings_recovery:${targetCircleId}`,
                                        ),
                                    },
                                )
                                : await updateCircleJoinPolicy(
                                    activeCircleIdForSettings,
                                    { accessType, minCrystals: nextMinCrystals },
                                    {
                                        actorPubkey: sessionUserPubkey,
                                        signMessage: signCircleSettingsMessage(
                                            'circle_settings_access_policy',
                                            `circle_settings_access_policy:${targetCircleId}`,
                                        ),
                                    },
                                );
                            policySaved = policyResult.status !== 'requires_governance';
                            if (policyResult.status === 'requires_governance') {
                                policyRequiresGovernance = true;
                                setCircleAccessPolicyStatus('requires_governance');
                                void loadGovernanceBindingsForCircle(targetCircleId);
                            } else if (pendingPostCreateSettings) {
                                clearPendingPostCreateSettings(targetCircleId);
                            }
                        } else {
                            policySaved = true;
                        }
                        if (!policyRequiresGovernance) {
                            setCircleAccessPolicyStatus('saved');
                        }
                        await refetch();
                    } catch (error) {
                        console.error('[CirclePage] save access policy failed', error);
                        const nextStatus: AccessPolicySaveStatus = flagsProjectionUpdated && !policySaved
                            ? 'chain_saved_policy_pending'
                            : policySaved && !flagsProjectionUpdated && minCrystalsChanged
                                ? 'policy_saved_chain_pending'
                                : 'failed';
                        setCircleAccessPolicyStatus(nextStatus);
                        setCircleAccessPolicyError(
                            flagsProjectionUpdated
                                ? circleDetailT('settings.errors.accessPolicyPartialSyncFailed')
                                : circleDetailT('settings.errors.accessPolicySaveFailed'),
                        );
                        await refetch().catch(() => undefined);
                        throw error;
                    } finally {
                        setCircleAccessPolicySaving(false);
                    }
                }}
                onUpdateCommitteeAvailability={async (availabilityStatus, input) => {
                    if (activeCircleIdForSettings === null) {
                        const message = circleDetailT('settings.errors.invalidCircleForGovernanceBindings');
                        setCircleGovernanceCommitteeProfileStatus({ state: 'error', message });
                        throw new Error(message);
                    }
                    if (!sessionUserPubkey) {
                        const message = circleDetailT('settings.errors.committeeProfileWalletRequired');
                        setCircleGovernanceCommitteeProfileStatus({ state: 'error', message });
                        requestWalletConnection({ source: 'circle_committee_profile' });
                        throw new Error('wallet_unavailable');
                    }
                    const targetCircleId = activeCircleIdForSettings;
                    setCircleGovernanceCommitteeProfileStatus({ state: 'saving' });
                    try {
                        const result = await updateCircleGovernanceCommitteeProfile({
                            circleId: targetCircleId,
                            availabilityStatus,
                            actorPubkey: sessionUserPubkey,
                            windowMinutes: input.windowMinutes ?? null,
                            allowedActionPrefixes: input.allowedActionPrefixes ?? null,
                            electorateTemplate: input.electorateTemplate ?? null,
                        });
                        if (result.status === 'requires_governance') {
                            setCircleGovernanceCommitteeProfileStatus({
                                state: 'requires_governance',
                                requestId: result.request?.id ?? null,
                            });
                            void loadGovernanceBindingsForCircle(targetCircleId);
                            void loadGovernanceCommitteeProfileForCircle(targetCircleId);
                            return result;
                        }
                        setCircleGovernanceCommitteeProfileStatus({ state: 'executed' });
                        if (result.profile) {
                            setCircleGovernanceCommitteeProfile(result.profile);
                        } else {
                            void loadGovernanceCommitteeProfileForCircle(targetCircleId);
                        }
                        void loadGovernanceBindingsForCircle(targetCircleId);
                        return result;
                    } catch (error) {
                        console.error('[CirclePage] update governance committee profile failed', error);
                        setCircleGovernanceCommitteeProfileStatus({
                            state: 'error',
                            message: circleDetailT('settings.errors.committeeProfileSaveFailed'),
                        });
                        throw error;
                    }
                }}
                onCreateGovernanceBinding={async (input) => {
                    if (activeCircleIdForSettings === null) {
                        const message = circleDetailT('settings.errors.invalidCircleForGovernanceBindings');
                        setCircleGovernanceCommitteeProfileStatus({ state: 'error', message });
                        throw new Error(message);
                    }
                    if (!sessionUserPubkey) {
                        const message = circleDetailT('settings.errors.committeeBindingWalletRequired');
                        setCircleGovernanceCommitteeProfileStatus({ state: 'error', message });
                        requestWalletConnection({ source: 'circle_governance_binding' });
                        throw new Error('wallet_unavailable');
                    }
                    const targetCircleId = activeCircleIdForSettings;
                    setCircleGovernanceCommitteeProfileStatus({ state: 'saving' });
                    try {
                        if (input.bindingType === 'self_governed') {
                            if (!input.actionType) {
                                throw new Error('self_governed_exact_action_required');
                            }
                            const result = await createSelfGovernedGovernanceBinding({
                                circleId: targetCircleId,
                                actionType: input.actionType,
                                subject: input.subject,
                                network: input.network,
                                actorPubkey: sessionUserPubkey,
                            });
                            setCircleGovernanceCommitteeProfileStatus({
                                state: 'requires_governance',
                                requestId: result.request?.id ?? null,
                            });
                        } else if (input.bindingType === 'shared_committee') {
                            const result = await createSharedCommitteeMandateBinding({
                                circleId: targetCircleId,
                                committeeCircleId: input.committeeCircleId,
                                purposeBindings: input.purposeBindings,
                                actionType: input.actionType,
                                actionPrefix: input.actionPrefix,
                                actorPubkey: sessionUserPubkey,
                                effectiveFrom: input.effectiveFrom,
                                effectiveUntil: input.effectiveUntil,
                                acceptanceExpiresAt: input.acceptanceExpiresAt,
                                minimumConstraints: input.minimumConstraints,
                                subject: input.subject,
                                feePolicy: input.feePolicy,
                                effectPolicy: input.effectPolicy,
                                operatorPolicyConstraints: input.operatorPolicyConstraints,
                                crossInstitutionDisclosureImpact: input.crossInstitutionDisclosureImpact,
                                continuityIncident: input.continuityIncident ?? null,
                            });
                            setCircleGovernanceCommitteeProfileStatus({
                                state: 'requires_governance',
                                requestId: result.request?.id ?? null,
                            });
                        } else {
                            const result = await createLocalAuxiliaryGovernanceBinding({
                                circleId: targetCircleId,
                                committeeCircleId: input.committeeCircleId,
                                actionType: input.actionType,
                                actionPrefix: input.actionPrefix,
                                actorPubkey: sessionUserPubkey,
                                continuityIncident: input.continuityIncident ?? null,
                            });
                            setCircleGovernanceCommitteeProfileStatus({
                                state: 'requires_governance',
                                requestId: result.request?.id ?? null,
                            });
                        }
                        await Promise.all([
                            loadGovernanceBindingsForCircle(targetCircleId),
                            loadGovernanceCommitteeProfileForCircle(targetCircleId),
                        ]);
                    } catch (error) {
                        console.error('[CirclePage] create governance binding failed', error);
                        setCircleGovernanceCommitteeProfileStatus({ state: 'idle' });
                        throw error;
                    }
                }}
                onCounterGovernanceMandate={async (input) => {
                    if (activeCircleIdForSettings === null || !sessionUserPubkey) {
                        throw new Error('wallet_unavailable');
                    }
                    await counterSharedCommitteeGovernanceMandate({
                        committeeCircleId: activeCircleIdForSettings,
                        mandateId: input.mandateId,
                        actionType: input.actionType,
                        actionPrefix: input.actionPrefix,
                        actorPubkey: sessionUserPubkey,
                        effectiveFrom: input.effectiveFrom,
                        effectiveUntil: input.effectiveUntil,
                        acceptanceExpiresAt: input.acceptanceExpiresAt,
                        minimumConstraints: input.minimumConstraints,
                        subject: input.subject,
                        purposeBindings: input.purposeBindings,
                        feePolicy: input.feePolicy,
                        effectPolicy: input.effectPolicy,
                        operatorPolicyConstraints: input.operatorPolicyConstraints,
                        crossInstitutionDisclosureImpact: input.crossInstitutionDisclosureImpact,
                    });
                    await Promise.all([
                        loadGovernanceBindingsForCircle(activeCircleIdForSettings),
                        loadCommitteeGovernanceRequestsForCircle(activeCircleIdForSettings),
                    ]);
                }}
                onSupersedeActiveGovernanceMandate={async (input) => {
                    if (activeCircleIdForSettings === null || !sessionUserPubkey) {
                        throw new Error('wallet_unavailable');
                    }
                    setCircleGovernanceCommitteeProfileStatus({ state: 'saving' });
                    try {
                        const result = await proposeActiveGovernanceMandateSupersede({
                            targetCircleId: activeCircleIdForSettings,
                            mandateId: input.mandateId,
                            actorPubkey: sessionUserPubkey,
                            effectiveUntil: input.effectiveUntil,
                            acceptanceExpiresAt: input.acceptanceExpiresAt,
                            minimumConstraints: input.minimumConstraints,
                            operatorPolicyConstraints: input.operatorPolicyConstraints,
                            crossInstitutionDisclosureImpact: input.crossInstitutionDisclosureImpact,
                            idempotencyKey: `mandate-supersede:${input.mandateId}:${Date.now()}`,
                        });
                        setCircleGovernanceCommitteeProfileStatus({ state: 'executed' });
                        await loadGovernanceBindingsForCircle(activeCircleIdForSettings);
                        router.push(result.case.canonicalUrl);
                    } catch (error) {
                        console.error('[CirclePage] propose governance mandate supersede failed', error);
                        setCircleGovernanceCommitteeProfileStatus({
                            state: 'error',
                            message: circleDetailT('settings.errors.committeeBindingCreateFailed'),
                        });
                        throw error;
                    }
                }}
                onDeactivateActiveGovernanceMandate={async ({ bindingId, reason }) => {
                    if (activeCircleIdForSettings === null || !sessionUserPubkey) {
                        throw new Error('wallet_unavailable');
                    }
                    setCircleGovernanceCommitteeProfileStatus({ state: 'saving' });
                    try {
                        const result = await requestGovernanceBindingDeactivation({
                            circleId: activeCircleIdForSettings,
                            bindingId,
                            actorPubkey: sessionUserPubkey,
                            reason,
                        });
                        setCircleGovernanceCommitteeProfileStatus({ state: 'executed' });
                        router.push(result.case.canonicalUrl);
                    } catch (error) {
                        console.error('[CirclePage] create governance binding deactivation Case failed', error);
                        setCircleGovernanceCommitteeProfileStatus({
                            state: 'error',
                            message: circleDetailT('settings.errors.committeeBindingCreateFailed'),
                        });
                        throw error;
                    }
                }}
                onAcceptGovernanceMandateCounter={async (binding) => {
                    if (activeCircleIdForSettings === null || !sessionUserPubkey || !signMessage) {
                        requestWalletConnection({ source: 'governance_mandate_acceptance' });
                        throw new Error('wallet_sign_message_unavailable');
                    }
                    if (!binding.mandateId || !binding.mandate) {
                        throw new Error('governance_mandate_not_found');
                    }
                    const challenge = await prepareGovernanceMandateAcceptance({
                        targetCircleId: activeCircleIdForSettings,
                        mandateId: binding.mandateId,
                        actorPubkey: sessionUserPubkey,
                    });
                    const signatureBytes = await signMessageForAction({
                        kind: 'governance_signal',
                        source: 'governance_mandate_acceptance',
                        key: `governance_mandate_acceptance:${binding.mandateId}:${challenge.envelope.mandateVersion}`,
                        message: challenge.signedMessage,
                    });
                    await acceptGovernanceMandateCounter({
                        targetCircleId: activeCircleIdForSettings,
                        mandateId: binding.mandateId,
                        actorPubkey: sessionUserPubkey,
                        signedMessage: challenge.signedMessage,
                        signature: bytesToBase64(signatureBytes),
                        nonce: challenge.envelope.nonce,
                        expiresAt: challenge.envelope.expiresAt,
                        mandateVersion: challenge.envelope.mandateVersion,
                        mandateTermsDigest: challenge.envelope.mandateTermsDigest,
                    });
                    await loadGovernanceBindingsForCircle(activeCircleIdForSettings);
                }}
                onUpdateActiveGovernancePolicy={async ({ bindingId, electorateTemplate, targetCommitteeCircleId }) => {
                    if (activeCircleIdForSettings === null) {
                        const message = circleDetailT('settings.errors.invalidCircleForGovernanceBindings');
                        setCircleGovernanceCommitteeProfileStatus({ state: 'error', message });
                        throw new Error(message);
                    }
                    if (!sessionUserPubkey) {
                        const message = circleDetailT('settings.errors.committeeGovernanceWalletRequired');
                        setCircleGovernanceCommitteeProfileStatus({ state: 'error', message });
                        requestWalletConnection({ source: 'circle_governance_policy_version' });
                        throw new Error('wallet_required');
                    }
                    setCircleGovernanceCommitteeProfileStatus({ state: 'saving' });
                    try {
                        const result = await updateCircleGovernancePolicyVersion({
                            circleId: activeCircleIdForSettings,
                            bindingId,
                            actorPubkey: sessionUserPubkey,
                            electorateTemplate,
                            targetCommitteeCircleId,
                        });
                        if (result.status === 'manual_recovery_pending') {
                            setCircleGovernanceCommitteeProfileStatus({
                                state: 'executed',
                                message: result.authorityContinuity.warning,
                            });
                            await loadGovernanceBindingsForCircle(activeCircleIdForSettings);
                            return result;
                        }
                        setCircleGovernanceCommitteeProfileStatus({
                            state: 'requires_governance',
                            requestId: result.case.id,
                        });
                        await loadGovernanceBindingsForCircle(activeCircleIdForSettings);
                        router.push(result.case.canonicalUrl);
                        return result;
                    } catch (error) {
                        console.error('[CirclePage] update governance policy version failed', error);
                        setCircleGovernanceCommitteeProfileStatus({
                            state: 'error',
                            message: circleDetailT('settings.errors.committeeBindingCreateFailed'),
                        });
                        throw error;
                    }
                }}
                onCreateGovernanceRecoveryPolicy={async ({ bindingId, recoveryCircleId }) => {
                    if (activeCircleIdForSettings === null || !sessionUserPubkey) {
                        requestWalletConnection({ source: 'governance_recovery_policy' });
                        throw new Error('wallet_required');
                    }
                    setCircleGovernanceCommitteeProfileStatus({ state: 'saving' });
                    try {
                        const result = await createGovernanceRecoveryPolicy({
                            circleId: activeCircleIdForSettings,
                            bindingId,
                            recoveryCircleId,
                            actorPubkey: sessionUserPubkey,
                        });
                        setCircleGovernanceCommitteeProfileStatus({
                            state: 'requires_governance',
                            requestId: result.case.id,
                        });
                        await loadGovernanceBindingsForCircle(activeCircleIdForSettings);
                        router.push(result.case.canonicalUrl);
                        return result;
                    } catch (error) {
                        setCircleGovernanceCommitteeProfileStatus({
                            state: 'error',
                            message: error instanceof Error ? error.message : 'governance_recovery_policy_create_failed',
                        });
                        throw error;
                    }
                }}
                onOpenGovernanceAuthorityHealth={async ({ bindingId, faultAssessment }) => {
                    if (activeCircleIdForSettings === null || !sessionUserPubkey) {
                        requestWalletConnection({ source: 'governance_authority_health' });
                        throw new Error('wallet_required');
                    }
                    const result = await openGovernanceAuthorityHealthCase({
                        circleId: activeCircleIdForSettings,
                        bindingId,
                        actorPubkey: sessionUserPubkey,
                        faultAssessment,
                    });
                    await loadGovernanceBindingsForCircle(activeCircleIdForSettings);
                    router.push(result.case.canonicalUrl);
                }}
                onApplyGovernanceAuthorityHealth={async ({ bindingId, requestId }) => {
                    if (activeCircleIdForSettings === null || !sessionUserPubkey) {
                        requestWalletConnection({ source: 'governance_authority_health' });
                        throw new Error('wallet_required');
                    }
                    const authorityHealth = await applyGovernanceAuthorityHealth({
                        circleId: activeCircleIdForSettings,
                        bindingId,
                        requestId,
                        actorPubkey: sessionUserPubkey,
                    });
                    setGovernanceRecovery((current) => current ? { ...current, authorityHealth } : current);
                    await loadGovernanceBindingsForCircle(activeCircleIdForSettings);
                }}
                onPermanentlyBlockGovernanceAuthority={async ({ bindingId }) => {
                    if (activeCircleIdForSettings === null || !sessionUserPubkey) {
                        requestWalletConnection({ source: 'governance_authority_continuity' });
                        throw new Error('wallet_required');
                    }
                    setCircleGovernanceCommitteeProfileStatus({ state: 'saving' });
                    try {
                        const authorityContinuity = await permanentlyBlockGovernanceAuthority({
                            circleId: activeCircleIdForSettings,
                            bindingId,
                            actorPubkey: sessionUserPubkey,
                        });
                        setCircleGovernanceCommitteeProfileStatus({
                            state: 'executed',
                            message: authorityContinuity.warning,
                        });
                        await loadGovernanceBindingsForCircle(activeCircleIdForSettings);
                    } catch (error) {
                        setCircleGovernanceCommitteeProfileStatus({
                            state: 'error',
                            message: error instanceof Error
                                ? error.message
                                : 'governance_authority_continuity_terminalization_failed',
                        });
                        throw error;
                    }
                }}
                onSubmitGovernanceSignal={async (request, value) => {
                    if (activeCircleIdForSettings === null) {
                        const message = circleDetailT('settings.errors.invalidCircleForGovernanceBindings');
                        setCommitteeGovernanceSignalError(message);
                        throw new Error(message);
                    }
                    if (!sessionUserPubkey || !signMessage) {
                        const message = circleDetailT('settings.errors.committeeGovernanceWalletRequired');
                        setCommitteeGovernanceSignalError(message);
                        requestWalletConnection({ source: 'circle_governance_signal' });
                        throw new Error('wallet_sign_message_unavailable');
                    }
                    const actorPubkey = sessionUserPubkey;
                    const actionKey = `${request.id}:${value}`;
                    setCommitteeGovernanceSignalActionKey(actionKey);
                    setCommitteeGovernanceSignalError(null);
                    try {
                        const challenge = await prepareGovernanceRequestSignal({
                            requestId: request.id,
                            actorPubkey,
                            value,
                        });
                        const signatureBytes = await signMessageForAction({
                            kind: 'governance_signal',
                            source: 'circle_settings_governance_signal',
                            key: `governance_signal:${request.id}:${value}`,
                            message: challenge.signedMessage,
                        });
                        await submitGovernanceRequestSignal({
                            requestId: request.id,
                            actorPubkey,
                            value,
                            signedMessage: challenge.signedMessage,
                            nonce: challenge.envelope.nonce,
                            expiresAt: challenge.envelope.expiresAt,
                            signature: bytesToBase64(signatureBytes),
                        });
                        await loadCommitteeGovernanceRequestsForCircle(activeCircleIdForSettings);
                        const targetCircleId = Number(request.payload?.targetCircleId);
                        if (
                            value === 'approve'
                            && Number.isInteger(targetCircleId)
                            && targetCircleId === activeCircleIdForSettings
                        ) {
                            await loadGovernanceBindingsForCircle(targetCircleId);
                        }
                    } catch (error) {
                        console.error('[CirclePage] submit governance signal failed', error);
                        setCommitteeGovernanceSignalError(circleDetailT('settings.errors.committeeGovernanceSignalFailed'));
                        throw error;
                    } finally {
                        setCommitteeGovernanceSignalActionKey(null);
                    }
                }}
                onSavePrimaryGeoAnchor={async (input: CircleGeoAnchorInput) => {
                    if (activeCircleIdForSettings === null) {
                        setCirclePrimaryGeoAnchorError(circleDetailT('settings.errors.invalidCircleForLocation'));
                        return;
                    }
                    if (!sessionUserPubkey || !signMessage) {
                        setCirclePrimaryGeoAnchorError(circleDetailT('settings.errors.locationWalletRequired'));
                        requestWalletConnection({ source: 'circle_location_settings' });
                        throw new Error('wallet_sign_message_unavailable');
                    }
                    const targetCircleId = activeCircleIdForSettings;
                    setCirclePrimaryGeoAnchorSaving(true);
                    setCirclePrimaryGeoAnchorError(null);
                    setCirclePrimaryGeoAnchorGovernanceRequestId(null);
                    try {
                        const result = await updateCirclePrimaryGeoAnchor(targetCircleId, input, {
                            actorPubkey: sessionUserPubkey,
                            signMessage: signCircleSettingsMessage(
                                'circle_settings_geo_anchor',
                                `circle_settings_geo_anchor:${targetCircleId}`,
                            ),
                        });
                        if (result.status === 'requires_governance') {
                            const requestId = result.request?.id ?? null;
                            setCirclePrimaryGeoAnchorGovernanceRequestId(requestId);
                            void loadGovernanceBindingsForCircle(targetCircleId);
                            return {
                                status: 'requires_governance' as const,
                                requestId,
                            };
                        }
                        setCirclePrimaryGeoAnchor(result.anchor);
                        void loadGovernanceBindingsForCircle(targetCircleId);
                        return { status: 'executed' as const };
                    } catch (error) {
                        console.error('[CirclePage] save primary geo anchor failed', error);
                        setCirclePrimaryGeoAnchorError(circleDetailT('settings.errors.saveLocationFailed'));
                        throw error;
                    } finally {
                        setCirclePrimaryGeoAnchorSaving(false);
                    }
                }}
                onArchivePrimaryGeoAnchor={async (anchorId?: string) => {
                    if (activeCircleIdForSettings === null) {
                        setCirclePrimaryGeoAnchorError(circleDetailT('settings.errors.invalidCircleForLocation'));
                        return;
                    }
                    if (!sessionUserPubkey || !signMessage) {
                        setCirclePrimaryGeoAnchorError(circleDetailT('settings.errors.locationWalletRequired'));
                        requestWalletConnection({ source: 'circle_location_settings_archive' });
                        throw new Error('wallet_sign_message_unavailable');
                    }
                    const targetCircleId = activeCircleIdForSettings;
                    setCirclePrimaryGeoAnchorSaving(true);
                    setCirclePrimaryGeoAnchorError(null);
                    setCirclePrimaryGeoAnchorGovernanceRequestId(null);
                    try {
                        const result = await archiveCirclePrimaryGeoAnchor(targetCircleId, { anchorId }, {
                            actorPubkey: sessionUserPubkey,
                            signMessage: signCircleSettingsMessage(
                                'circle_settings_geo_anchor_archive',
                                `circle_settings_geo_anchor_archive:${targetCircleId}:${anchorId || 'primary'}`,
                            ),
                        });
                        if (result.status === 'requires_governance') {
                            const requestId = result.request?.id ?? null;
                            setCirclePrimaryGeoAnchorGovernanceRequestId(requestId);
                            void loadGovernanceBindingsForCircle(targetCircleId);
                            return {
                                status: 'requires_governance' as const,
                                requestId,
                            };
                        }
                        setCirclePrimaryGeoAnchor(null);
                        void loadGovernanceBindingsForCircle(targetCircleId);
                        return { status: 'executed' as const };
                    } catch (error) {
                        console.error('[CirclePage] archive primary geo anchor failed', error);
                        setCirclePrimaryGeoAnchorError(circleDetailT('settings.errors.archiveLocationFailed'));
                        throw error;
                    } finally {
                        setCirclePrimaryGeoAnchorSaving(false);
                    }
                }}
                onSaveGhostSettings={async (settings) => {
                    if (activeCircleIdForSettings === null) {
                        setCircleGhostSettingsError(circleDetailT('settings.errors.invalidCircleForAi'));
                        return;
                    }
                    setCircleGhostSettingsSaving(true);
                    setCircleGhostSettingsError(null);
                    try {
                        if (!sessionUserPubkey || !signMessage) {
                            throw new Error('wallet_sign_message_unavailable');
                        }
                        const saved = await updateCircleGhostSettings(activeCircleIdForSettings, settings, {
                            actorPubkey: sessionUserPubkey,
                            signMessage: signCircleSettingsMessage(
                                'circle_settings_ghost_settings',
                                `circle_settings_ghost_settings:${activeCircleIdForSettings}`,
                            ),
                        });
                        if (saved.status === 'requires_governance') {
                            setCircleGhostSettingsGovernancePending({
                                requestId: saved.request.id,
                                requestedSettings: saved.requestedSettings,
                            });
                            void loadCommitteeGovernanceRequestsForCircle(activeCircleIdForSettings);
                            return;
                        }
                        setCircleGhostSettings(saved.settings);
                        setCircleGhostSettingsSource(saved.source);
                        setCircleGhostSettingsGovernancePending(null);
                    } catch (error) {
                        console.error('[CirclePage] save ghost settings failed', error);
                        setCircleGhostSettingsError(circleDetailT('settings.errors.saveAiFailed'));
                        throw error;
                    } finally {
                        setCircleGhostSettingsSaving(false);
                    }
                }}
                onSaveDraftLifecycleTemplate={async (template) => {
                    if (activeCircleIdForSettings === null) {
                        setCirclePolicyError(circleDetailT('settings.errors.invalidCircleForDraftLifecycle'));
                        return;
                    }
                    setCirclePolicySaving(true);
                    setCirclePolicyError(null);
                    setCirclePolicyNotice(null);
                    try {
                        if (!sessionUserPubkey || !signMessage) {
                            throw new Error('wallet_sign_message_unavailable');
                        }
                        const saved = await updateCircleDraftLifecycleTemplate(activeCircleIdForSettings, template, {
                            actorPubkey: sessionUserPubkey,
                            signMessage: signCircleSettingsMessage(
                                'circle_settings_draft_lifecycle',
                                `circle_settings_draft_lifecycle:${activeCircleIdForSettings}`,
                            ),
                        });
                        if (saved.status === 'requires_governance') {
                            setCirclePolicyNotice(circleDetailT('settings.policyProfileStatus.requiresGovernance', {
                                requestId: saved.request.id || '-',
                            }));
                            return;
                        }
                        setCirclePolicyDraftLifecycleTemplate(saved.profile.draftLifecycleTemplate);
                    } catch (error) {
                        console.error('[CirclePage] save draft lifecycle template failed', error);
                        setCirclePolicyError(circleDetailT('settings.errors.saveDraftLifecycleFailed'));
                        throw error;
                    } finally {
                        setCirclePolicySaving(false);
                    }
                }}
                onSaveDraftWorkflowPolicy={async (policy) => {
                    if (activeCircleIdForSettings === null) {
                        setCirclePolicyError(circleDetailT('settings.errors.invalidCircleForWorkflow'));
                        return;
                    }
                    setCirclePolicySaving(true);
                    setCirclePolicyError(null);
                    setCirclePolicyNotice(null);
                    try {
                        if (!sessionUserPubkey || !signMessage) {
                            throw new Error('wallet_sign_message_unavailable');
                        }
                        const saved = await updateCircleDraftWorkflowPolicy(activeCircleIdForSettings, policy, {
                            actorPubkey: sessionUserPubkey,
                            signMessage: signCircleSettingsMessage(
                                'circle_settings_draft_workflow',
                                `circle_settings_draft_workflow:${activeCircleIdForSettings}`,
                            ),
                        });
                        if (saved.status === 'requires_governance') {
                            setCirclePolicyNotice(circleDetailT('settings.policyProfileStatus.requiresGovernance', {
                                requestId: saved.request.id || '-',
                            }));
                            return;
                        }
                        setCirclePolicyDraftWorkflowPolicy(saved.profile.draftWorkflowPolicy);
                    } catch (error) {
                        console.error('[CirclePage] save draft workflow policy failed', error);
                        setCirclePolicyError(circleDetailT('settings.errors.saveWorkflowFailed'));
                        throw error;
                    } finally {
                        setCirclePolicySaving(false);
                    }
                }}
                onSaveDraftPrompt={async (input) => {
                    if (activeCircleIdForSettings === null) {
                        setCircleDraftPromptsError(circleDetailT('settings.errors.invalidCircleForDraftPrompt'));
                        return;
                    }
                    setCircleDraftPromptsSaving(true);
                    setCircleDraftPromptsError(null);
                    try {
                        if (!sessionUserPubkey || !signMessage) {
                            throw new Error('wallet_sign_message_unavailable');
                        }
                        const currentPrompt = circleDraftPrompts.find((entry) => entry.scope === input.scope);
                        if (!currentPrompt) throw new Error('circle_draft_prompt_readback_required');
                        const saved = await updateCircleDraftPrompt(activeCircleIdForSettings, input, {
                            actorPubkey: sessionUserPubkey,
                            signMessage: signCircleSettingsMessage(
                                'circle_settings_draft_prompt',
                                `circle_settings_draft_prompt:${activeCircleIdForSettings}:${input.scope}`,
                            ),
                        }, currentPrompt);
                        setCircleDraftPrompts((current) => [
                            ...current.filter((entry) => entry.scope !== saved.scope),
                            saved,
                        ].sort((left, right) => left.scope.localeCompare(right.scope)));
                    } catch (error) {
                        console.error('[CirclePage] save Draft Prompt failed', error);
                        setCircleDraftPromptsError(circleDetailT('settings.errors.saveDraftPromptFailed'));
                        throw error;
                    } finally {
                        setCircleDraftPromptsSaving(false);
                    }
                }}
                onSaveAgentPolicy={async (policy) => {
                    if (!CIRCLE_AGENT_GOVERNANCE_UI_ENABLED) {
                        return;
                    }
                    if (activeCircleIdForSettings === null) {
                        setCircleAgentPolicyError(circleDetailT('settings.errors.invalidCircleForAgents'));
                        return;
                    }
                    setCircleAgentPolicySaving(true);
                    setCircleAgentPolicyError(null);
                    try {
                        const saved = await updateCircleAgentPolicy(activeCircleIdForSettings, policy);
                        setCircleAgentPolicy(saved);
                    } catch (error) {
                        console.error('[CirclePage] save agent policy failed', error);
                        setCircleAgentPolicyError(circleDetailT('settings.errors.saveAgentsFailed'));
                        throw error;
                    } finally {
                        setCircleAgentPolicySaving(false);
                    }
                }}
                deleteCircleAvailable={viewerCanManageCircleLifecycle}
                deleteCircleNotice={circleDetailT('settings.archiveNotice')}
                onDeleteCircle={() => { void handleCircleLifecycleAction(); }}
                onDissolveCircle={(input) => handleCircleLifecycleAction('dissolve', input)}
                onApproveMergeSource={handleCircleMergeSourceApproval}
                onAcceptMergeSuccessor={handleCircleMergeSuccessorAcceptance}
                onFinalizeMerge={handleCircleMergeFinalize}
                onExportLifecycleTimeline={async () => {
                    if (activeCircleIdForSettings === null) throw new Error('circle_required');
                    const timeline = await exportCircleLifecycleTimeline(activeCircleIdForSettings);
                    const blob = new Blob([JSON.stringify(timeline, null, 2)], { type: 'application/json' });
                    const url = URL.createObjectURL(blob);
                    const anchor = document.createElement('a');
                    anchor.href = url;
                    anchor.download = `circle-${activeCircleIdForSettings}-lifecycle-${timeline.lifecyclePlanId}.json`;
                    anchor.click();
                    URL.revokeObjectURL(url);
                }}
                onRoleChange={async (member, newRole) => {
                    if (activeCircleIdForSettings === null) {
                        throw new Error(circleDetailT('settings.errors.invalidCircleForRoleChange'));
                    }
                    if (!member.pubkey) {
                        throw new Error(circleDetailT('settings.errors.memberWalletMissingForRoleChange'));
                    }
                    const memberPubkey = member.pubkey;
                    try {
                        await runWalletAction({
                            kind: 'circle_member_role_update',
                            source: 'circle_settings_member_role',
                            key: `circle_member_role_update:${activeCircleIdForSettings}:${member.userId}:${newRole}`,
                            run: () => updateCircleMemberRole(
                                activeCircleIdForSettings,
                                member.userId,
                                newRole,
                                memberPubkey,
                                sdk,
                            ),
                        });
                        await refetch();
                    } catch (error) {
                        throw new Error(normalizeMembershipActionError(error, circleDetailT('settings.errors.roleChangeFailed'), circleDetailT));
                    }
                }}
                onRemoveMember={async (member, reason) => {
                    if (activeCircleIdForSettings === null) {
                        throw new Error(circleDetailT('settings.errors.invalidCircleForRemoveMember'));
                    }
                    try {
                        const result = await runWalletAction({
                            kind: 'circle_member_remove',
                            source: 'circle_settings_member_remove',
                            key: `circle_member_remove:${activeCircleIdForSettings}:${member.userId}`,
                            run: () => removeCircleMember(
                                activeCircleIdForSettings,
                                member.userId,
                                reason,
                            ),
                        });
                        router.push(result.case.canonicalUrl);
                    } catch (error) {
                        throw new Error(normalizeMembershipActionError(error, circleDetailT('settings.errors.removeMemberFailed'), circleDetailT));
                    }
                }}
                onRequestOwnerTransfer={async (member) => {
                    if (activeCircleIdForSettings === null) {
                        throw new Error(circleDetailT('settings.errors.invalidCircleForRoleChange'));
                    }
                    try {
                        await createCircleOwnerTransferRequest({
                            circleId: activeCircleIdForSettings,
                            targetUserId: member.userId,
                        });
                        await loadOwnerTransfersForCircle(activeCircleIdForSettings);
                    } catch (error) {
                        console.error('[CirclePage] request owner transfer failed', error);
                        throw new Error(circleDetailT('settings.errors.roleChangeFailed'));
                    }
                }}
                onAcceptOwnerTransfer={async (transferId) => {
                    if (activeCircleIdForSettings === null) {
                        throw new Error(circleDetailT('settings.errors.invalidCircleForRoleChange'));
                    }
                    try {
                        const result = await acceptCircleOwnerTransferRequest({
                            circleId: activeCircleIdForSettings,
                            transferId,
                        });
                        await loadOwnerTransfersForCircle(activeCircleIdForSettings);
                        if (result.status === 'executed') {
                            await refetch();
                        }
                    } catch (error) {
                        console.error('[CirclePage] accept owner transfer failed', error);
                        throw new Error(circleDetailT('settings.errors.roleChangeFailed'));
                    }
                }}
                onInvite={() => {
                    setShowSettings(false);
                    setTimeout(() => {
                        openInviteSheetForCircle(Number(activeSubCircle.id), activeSubCircle.name);
                    }, 300);
                }}
                onLeaveCircle={async () => {
                    if (activeCircleIdForSettings === null) {
                        throw new Error(circleDetailT('settings.errors.invalidCircleForLeave'));
                    }
                    try {
                        await runWalletAction({
                            kind: 'circle_leave',
                            source: 'circle_settings_leave',
                            key: `circle_leave:${activeCircleIdForSettings}`,
                            run: () => leaveCircle(activeCircleIdForSettings, sdk),
                        });
                        await refetch();
                    } catch (error) {
                        throw new Error(normalizeMembershipActionError(error, circleDetailT('settings.errors.leaveFailed'), circleDetailT));
                    }
                }}
            />

            {/* ── P4: Member Profile Card ── */}
            <MemberCard
                open={!!selectedMember}
                member={selectedMember}
                targetPubkey={memberCardTargetPubkey}
                followState={memberCardFollowState}
                onToggleFollow={(nextFollowState) => {
                    void toggleSelectedMemberFollow(nextFollowState);
                }}
                onClose={() => {
                    selectedMemberRequestRef.current = null;
                    setSelectedMember(null);
                    clearSelectedMemberFollowState();
                }}
                onInvite={(handle) => {
                    selectedMemberRequestRef.current = null;
                    setSelectedMember(null);
                    clearSelectedMemberFollowState();
                    setTimeout(() => {
                        openInviteSheetForCircle(Number(activeSubCircle.id), activeSubCircle.name);
                    }, 300);
                }}
            />

            {/* ── P6: Invite Member Sheet ── */}
            <InviteMemberSheet
                open={showInviteSheet}
                targetCircleName={inviteTargetCircle?.name || ''}
                users={invitableUsers}
                onSearch={inviteSearchUsesGlobalDirectory ? searchGlobalInvitableUsers : undefined}
                onClose={() => {
                    setShowInviteSheet(false);
                    setInviteTargetCircle(null);
                    setInviteSourceCircleOverride(null);
                    inviteSourceRequestRef.current = null;
                }}
                onInvite={async (handles): Promise<InviteResultSummary> => {
                    if (!inviteTargetCircle || handles.length === 0) {
                        return {
                            successCount: 0,
                            failureCount: 0,
                            errorMessage: circleDetailT('invite.errors.selectMember'),
                        };
                    }
                    const usersByHandle = new Map(invitableUsers.map((user) => [user.handle, user]));
                    const results = await Promise.allSettled(
                        handles.map((handle) => {
                            const user = usersByHandle.get(handle);
                            return createCircleInvite(inviteTargetCircle.id, {
                                inviteeUserId: user?.userId,
                                inviteeHandle: user?.userId ? undefined : handle,
                            });
                        }),
                    );
                    const failed = results.filter((result): result is PromiseRejectedResult => result.status === 'rejected');
                    const successCount = results.length - failed.length;
                    if (successCount > 0) {
                        await refetch();
                    }
                    if (failed.length > 0) {
                        console.error(
                            `[CirclePage] ${failed.length}/${results.length} invites failed for circle ${inviteTargetCircle.id}`,
                            failed,
                        );
                    }
                    return {
                        successCount,
                        failureCount: failed.length,
                        errorMessage: successCount === 0 && failed[0]
                            ? normalizeMembershipActionError(failed[0].reason, circleDetailT('invite.errors.sendFailed'), circleDetailT)
                            : undefined,
                    };
                }}
            />

            <FeedThreadSheet
                open={!!selectedFeedThreadContentId}
                post={selectedFeedThreadRootPost}
                replies={selectedFeedThreadReplies}
                canReply={Boolean(publicKey) && viewerJoinedCurrentCircle}
                submitting={feedReplySubmitting}
                error={feedReplyError}
                onClose={handleCloseFeedThread}
                onSubmitReply={handleSubmitFeedReply}
            />

            {/* ── Crystal Detail Sheet ── */}
            <CrystalDetailSheet
                open={!!selectedCrystal}
                crystal={selectedCrystal}
                patinaLevel={selectedCrystal?.patinaLevel as 'fresh' | 'settling' | 'ancient'}
                onClose={() => setSelectedCrystal(null)}
                onCopy={() => {
                    if (!selectedCrystal?.knowledgeId) return;
                    const crystalHref = new URL(`/knowledge/${selectedCrystal.knowledgeId}`, window.location.origin).toString();
                    void navigator.clipboard.writeText(crystalHref);
                }}
                onOpenKnowledge={selectedCrystal?.knowledgeId
                    ? () => {
                        const targetKnowledgeId = selectedCrystal.knowledgeId;
                        setSelectedCrystal(null);
                        void router.push(`/knowledge/${targetKnowledgeId}`);
                    }
                    : undefined}
            />

            {/* ── P5: Notification Panel ── */}
            <NotificationPanel
                open={showNotifications}
                notifications={notifications}
                onClose={() => setShowNotifications(false)}
                onMarkAllRead={handleMarkAllNotificationsRead}
                onNotificationClick={handleNotificationClick}
            />
            <RegisterIdentitySheet
                open={showRegisterIdentitySheet}
                loading={identityRegistrationLoading}
                syncing={identityRegistrationSyncing}
                error={identityRegistrationError}
                suggestedHandle={suggestedIdentityHandle}
                walletImpact={identityJoinWalletImpact}
                onClose={() => {
                    if (!identityRegistrationLoading && !identityRegistrationSyncing) {
                        setShowRegisterIdentitySheet(false);
                    }
                }}
                onSubmit={handleRegisterIdentityAndJoin}
            />
        </div>
    );
}
