'use client';

import { useState, useCallback, useEffect, useRef, useMemo } from 'react';
import { useParams, useRouter, useSearchParams } from 'next/navigation';
import { useQuery, useMutation, useLazyQuery } from '@apollo/client/react';
import { motion, AnimatePresence, PanInfo } from 'framer-motion';
import { ArrowLeft, Users, MessageSquare, FileEdit, BookOpen, Lock, Gem, Smile, Paperclip, AtSign, SendHorizonal, CornerDownLeft, Copy, Trash2, Plus, X, Compass, Settings, Rss, Bell, ChevronDown } from 'lucide-react';
import Link from 'next/link';
import dynamic from 'next/dynamic';
import { useWallet } from '@solana/wallet-adapter-react';
import { useWalletModal } from '@solana/wallet-adapter-react-ui';

import { TabBar } from '@/components/ui/TabBar';
import { Card } from '@/components/ui/Card';

import { Skeleton } from '@/components/ui/Skeleton';
import CrucibleEditor from '@/components/circle/CrucibleEditor';
import { useCollaboration } from '@/lib/collaboration';
import HighlightButton from '@/components/circle/HighlightButton';
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
import { IdentityBadge, type IdentityState } from '@/components/circle/IdentityBadge';
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

/* Dynamic imports for 3D crystal (no SSR) */
const Crystal3D = dynamic(
    () => import('@/components/crystal/Crystal3D'),
    { ssr: false },
);
const CrystalDisplay = dynamic(
    () => import('@/components/crystal/CrystalDisplay'),
    { ssr: false },
);
import { GET_CIRCLE, GET_CIRCLE_POSTS, GET_NOTIFICATIONS, GET_KNOWLEDGE_BY_CIRCLE, GET_CIRCLE_DRAFTS, GET_MEMBER_PROFILE, GET_POST_THREAD, HIGHLIGHT_MESSAGE, MARK_NOTIFICATIONS_READ } from '@/lib/apollo/queries';
import type { CircleResponse, CirclePostsResponse, GQLPost, NotificationsResponse, KnowledgeByCircleResponse, CircleDraftsResponse, GQLKnowledge, GQLDraftSummary, GQLKnowledgeContributor, MarkNotificationsReadResponse, MemberProfileResponse, PostThreadResponse } from '@/lib/apollo/types';
import {
    createDiscussionSession,
    fetchDiscussionMessages,
    refreshDiscussionSession,
    sendDiscussionMessage,
    tombstoneDiscussionMessage,
    type DiscussionMessageDto,
} from '@/lib/discussion/api';
import {
    fetchCircleGhostSettings,
    updateCircleGhostSettings,
    type CircleGhostSettings,
} from '@/lib/circles/ghostSettings';
import {
    fetchCircleAgents,
    fetchCircleAgentPolicy,
    updateCircleAgentPolicy,
    type CircleAgentPolicy,
    type CircleAgentRecord,
} from '@/lib/circles/agents';
import {
    DEFAULT_CIRCLE_FORK_POLICY,
    DEFAULT_CIRCLE_DRAFT_WORKFLOW_POLICY,
    fetchCirclePolicyProfile,
    updateCircleDraftWorkflowPolicy,
    updateCircleDraftLifecycleTemplate,
    type CircleDraftLifecycleTemplate,
    type CircleForkPolicy,
    type CircleDraftWorkflowPolicy,
} from '@/lib/circles/policyProfile';
import {
    createCircleInvite,
    fetchCircleIdentityStatus,
    fetchCircleMembershipState,
    joinCircle,
    leaveCircle,
    removeCircleMember,
    updateCircleMemberRole,
    type CircleIdentityStatus,
    type CircleMembershipSnapshot,
} from '@/lib/circles/membership';
import styles from './page.module.css';
import TierPill from '@/components/circle/TierPill/TierPill';
import AccessGate from '@/components/circle/AccessGate/AccessGate';
import PlazaTab from '@/components/circle/PlazaTab/PlazaTab';
import CrucibleTab from '@/components/circle/CrucibleTab/CrucibleTab';
import SanctuaryTab from '@/components/circle/SanctuaryTab/SanctuaryTab';
import type { SubCircle, PlazaMessage, PlazaQuickAuxCircle, CircleGroup, DiscussionSessionState } from '@/lib/circle/types';
import { timeAgo, mapContributorRole, mapMembershipToIdentityState, normalizeJoinActionError, mapDiscussionDtoToPlazaMessage, createCircleJoinCopy } from '@/lib/circle/utils';
import { resolveCircleJoinBannerState } from '@/lib/circle/joinBanner';
import { createIdentityCopy, normalizeIdentityCopy } from '@/lib/circle/identityCopy';
import {
    buildInvitableUsers,
    resolveInviteSourceCircleId,
} from '@/lib/circle/memberManagement';
import {
    canManageCircleAgents,
    deriveCreatorFallbackMembershipSnapshot,
    deriveIdentityStatusFallbackMembershipSnapshot,
    deriveViewerCircleState,
    resolveActiveIdentityStatus,
    resolveActiveMembershipSnapshot,
} from '@/lib/circle/membershipState';
import { resolvePreferredActiveTierId } from '@/lib/circle/activeTierRestore';
import { startMembershipRefresh } from '@/lib/circle/membershipRefresh';
import { deriveFeedRepostMembershipPending } from '@/lib/feed/repostState';
import { submitFeedReply } from '@/lib/feed/replyComposer';
import { resolveNotificationCircleTab, resolveNotificationHref, type NotificationTab } from '@/lib/notifications/routing';
import { useIdentityOnboarding } from '@/lib/auth/identityOnboarding';
import { useCurrentLocale, useI18n } from '@/i18n/useI18n';
import { buildKnowledgeReferenceOptions } from '@/lib/circle/knowledgeReferenceOptions';
import { normalizeCircleRouteTab } from '@/lib/circle/routeTabs';
import {
    buildForkReadinessViewModel,
    createForkReadinessCopy,
    type ForkQualificationSnapshot,
    type ForkReadinessViewModel,
    type Team04ForkResolvedInputs,
} from '@/features/fork-lineage/adapter';
import {
    createForkFromCircle,
    fetchForkLineageView,
    fetchForkQualificationSnapshot,
    fetchForkTeam04ResolvedInputs,
    type ForkLineageView,
    type ForkLineageViewItem,
} from '@/features/fork-lineage/api';
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

/* ── GQL role → MemberCard role mapping ── */
function mapGqlRoleToCardRole(gqlRole: string): 'owner' | 'curator' | 'member' {
    if (gqlRole === 'Owner') return 'owner';
    if (gqlRole === 'Admin' || gqlRole === 'Moderator') return 'curator';
    return 'member';
}

function normalizeAuthorIdentity(rawAuthor: string): string {
    return String(rawAuthor || '').trim().replace(/^@/, '').toLowerCase();
}

function matchesMemberAuthorIdentity(input: {
    author: string;
    handle: string | null | undefined;
    pubkey: string | null | undefined;
}): boolean {
    const author = normalizeAuthorIdentity(input.author);
    if (!author) return false;

    const handle = String(input.handle || '').trim().toLowerCase();
    const pubkey = String(input.pubkey || '').trim();
    const pubkeyLower = pubkey.toLowerCase();
    const shortPubkey = pubkey.length > 8
        ? `${pubkey.slice(0, 4)}...${pubkey.slice(-4)}`.toLowerCase()
        : '';

    return author === handle || author === pubkeyLower || author === shortPubkey;
}

function normalizeMembershipActionError(
    error: unknown,
    fallback: string,
    t: (key: string, values?: Record<string, string | number>) => string,
): string {
    const message = error instanceof Error ? error.message : String(error || '');
    if (message.includes('403')) return t('memberDirectory.actionErrors.forbidden');
    if (message.includes('404')) return t('memberDirectory.actionErrors.memberGone');
    if (message.includes('active_invite_exists')) return t('memberDirectory.actionErrors.activeInviteExists');
    if (message.includes('invitee_already_member')) return t('memberDirectory.actionErrors.alreadyMember');
    if (message.includes('protected_member_role')) return t('memberDirectory.actionErrors.protectedRole');
    if (message.includes('self_removal_not_supported')) return t('memberDirectory.actionErrors.selfRemovalUnsupported');
    if (message.includes('self_role_change_not_supported')) return t('memberDirectory.actionErrors.selfRoleChangeUnsupported');
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
        || raw === 'highlight'
        || raw === 'forward'
        || raw === 'citation'
        || raw === 'circle'
    ) {
        return raw;
    }
    return 'system';
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

function mapAccessRequirementToAccessType(input: {
    type: 'free' | 'crystal';
}): 'free' | 'crystal' | 'invite' | 'approval' {
    return input.type === 'crystal' ? 'crystal' : 'free';
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
    };
}

/* ══════════════════════════════════════════
   Main Page Component
   ══════════════════════════════════════════ */

export default function CircleDetailPage() {
    const params = useParams();
    const router = useRouter();
    const searchParams = useSearchParams();
    const { publicKey, signMessage } = useWallet();
    const {
        identityState,
        lastErrorMessage,
        refreshIdentityState,
        sessionUser,
    } = useIdentityOnboarding();
    const { setVisible: setWalletModalVisible } = useWalletModal();
    const circleDetailT = useI18n('CircleDetailPage');
    const forkReadinessT = useI18n('ForkReadiness');
    const locale = useCurrentLocale();
    const joinCopy = useMemo(() => createCircleJoinCopy(circleDetailT), [circleDetailT]);
    const identityCopy = useMemo(() => createIdentityCopy(circleDetailT), [circleDetailT]);
    const tabDefs = useMemo(() => createTabDefs(circleDetailT), [circleDetailT]);
    const formatRelativeTime = useCallback((value: string) => timeAgo(value, locale), [locale]);
    const sdk = useAlchemeSDK();
    const circleId = Number(params.id);
    const requestedRouteTab = normalizeCircleRouteTab(searchParams.get('tab'));
    const focusEnvelopeId = String(searchParams.get('focusEnvelopeId') || '').trim() || null;
    const lastAppliedRouteTabRef = useRef<string | null>(null);
    const [activeTab, setActiveTab] = useState<string>(requestedRouteTab || 'plaza');
    const [requestedCrucibleDraftId, setRequestedCrucibleDraftId] = useState<number | null>(null);

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
            const descendants = (data.circleDescendants || []).filter((circle) => circle.lifecycleStatus !== 'Archived');
            const res: SubCircle[] = [];
            const knownCircleIds = new Set<number>([root.id, ...descendants.map((c) => c.id)]);

            const normalizeKind = (kind: string | null | undefined): 'main' | 'auxiliary' =>
                typeof kind === 'string' && kind.toLowerCase() === 'auxiliary' ? 'auxiliary' : 'main';
            const normalizeMode = (mode: string | null | undefined): 'social' | 'knowledge' =>
                typeof mode === 'string' && mode.toLowerCase() === 'social' ? 'social' : 'knowledge';
            const resolveTabs = (_kind: 'main' | 'auxiliary', mode: 'social' | 'knowledge'): SubCircle['tabs'] =>
                mode === 'social'
                    ? ['plaza', 'feed']
                    : ['plaza', 'crucible', 'sanctuary'];

            const rootKind = normalizeKind(root.kind);
            const rootMode = normalizeMode(root.mode);
            res.push({
                id: String(root.id),
                name: root.name || circleDetailT('defaults.publicCircle'),
                level: root.level ?? 0,
                isDefault: true,
                accessRequirement: root.minCrystals ? { type: 'crystal', minCrystals: root.minCrystals } : { type: 'free' },
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
                    accessRequirement: circle.minCrystals
                        ? { type: 'crystal', minCrystals: circle.minCrystals }
                        : { type: 'free' },
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
            tabs: ['plaza', 'crucible', 'sanctuary'],
            genesisMode: 'BLANK',
        }];
    }, [data?.circle, data?.circleDescendants, circleId]);

    const subCircles = mappedSubCircles;

    const routeTierId = useMemo(() => {
        const routeId = String(circleId);
        return subCircles.find((s) => s.id === routeId)?.id || null;
    }, [subCircles, circleId]);
    const defaultTierId = routeTierId || subCircles.find((s) => s.isDefault)?.id || subCircles[0]?.id || String(circleId);
    const [activeTierId, setActiveTierId] = useState<string>(defaultTierId);

    const [showAccessGate, setShowAccessGate] = useState<SubCircle | null>(null);
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
    const [showSettings, setShowSettings] = useState(false);
    const [circleGhostSettings, setCircleGhostSettings] = useState<CircleGhostSettings | null>(null);
    const [circleGhostSettingsSource, setCircleGhostSettingsSource] = useState<'circle' | 'pending' | 'global_default' | null>(null);
    const [circleGhostSettingsLoading, setCircleGhostSettingsLoading] = useState(false);
    const [circleGhostSettingsSaving, setCircleGhostSettingsSaving] = useState(false);
    const [circleGhostSettingsError, setCircleGhostSettingsError] = useState<string | null>(null);
    const [circlePolicyDraftLifecycleTemplate, setCirclePolicyDraftLifecycleTemplate] = useState<CircleDraftLifecycleTemplate | null>(null);
    const [circlePolicyDraftWorkflowPolicy, setCirclePolicyDraftWorkflowPolicy] = useState<CircleDraftWorkflowPolicy | null>(null);
    const [circlePolicyForkPolicy, setCirclePolicyForkPolicy] = useState<CircleForkPolicy | null>(null);
    const [circlePolicyLoading, setCirclePolicyLoading] = useState(false);
    const [circlePolicySaving, setCirclePolicySaving] = useState(false);
    const [circlePolicyError, setCirclePolicyError] = useState<string | null>(null);
    const [circleAgents, setCircleAgents] = useState<CircleAgentRecord[]>([]);
    const [circleAgentPolicy, setCircleAgentPolicy] = useState<CircleAgentPolicy | null>(null);
    const [circleAgentPolicyLoading, setCircleAgentPolicyLoading] = useState(false);
    const [circleAgentPolicySaving, setCircleAgentPolicySaving] = useState(false);
    const [circleAgentPolicyError, setCircleAgentPolicyError] = useState<string | null>(null);
    const [selectedMember, setSelectedMember] = useState<MemberProfile | null>(null);
    const [showNotifications, setShowNotifications] = useState(false);
    const [identityProgressExpanded, setIdentityProgressExpanded] = useState(false);
    const [identityTransitionDismissed, setIdentityTransitionDismissed] = useState(false);
    const { createCircle, loading: isCreatingCircle, error: createCircleError } = useCreateCircle();
    const selectedMemberRequestRef = useRef<number | null>(null);
    const inviteSourceRequestRef = useRef<number | null>(null);
    const restoredPendingForkSourceRef = useRef<number | null>(null);
    const [loadMemberProfile] = useLazyQuery<MemberProfileResponse>(GET_MEMBER_PROFILE, {
        fetchPolicy: 'network-only',
    });
    const [loadInviteSourceCircle] = useLazyQuery<CircleResponse>(GET_CIRCLE, {
        fetchPolicy: 'network-only',
    });

    // ── Membership state (REST) ──
    const [membershipSnapshot, setMembershipSnapshot] = useState<CircleMembershipSnapshot | null>(null);
    const [membershipRefreshFailed, setMembershipRefreshFailed] = useState(false);
    const [activeTierMembershipSnapshot, setActiveTierMembershipSnapshot] = useState<CircleMembershipSnapshot | null>(null);
    const [activeTierMembershipLoading, setActiveTierMembershipLoading] = useState(false);
    const [activeTierMembershipRefreshFailed, setActiveTierMembershipRefreshFailed] = useState(false);
    const [identityStatus, setIdentityStatus] = useState<CircleIdentityStatus | null>(null);
    const [activeTierIdentityStatus, setActiveTierIdentityStatus] = useState<CircleIdentityStatus | null>(null);
    const userCrystals = membershipSnapshot?.userCrystals ?? 0;
    const [joinActionLoading, setJoinActionLoading] = useState(false);
    const [joinActionError, setJoinActionError] = useState<string | null>(null);
    const [showRegisterIdentitySheet, setShowRegisterIdentitySheet] = useState(false);
    const {
        registerIdentity,
        loading: identityRegistrationLoading,
        syncing: identityRegistrationSyncing,
        error: identityRegistrationError,
    } = useRegisterIdentity();

    useEffect(() => {
        if (subCircles.length === 0) return;
        const nextTierId = resolvePreferredActiveTierId({
            circleId,
            routeTierId,
            defaultTierId,
            savedTierId: getLastActiveSubCircle(circleId),
            requestedRouteTab,
            focusEnvelopeId,
            userCrystals,
            subCircles,
        });
        setActiveTierId(nextTierId);
    }, [circleId, defaultTierId, focusEnvelopeId, requestedRouteTab, routeTierId, subCircles, userCrystals]);

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
    }, [circleId, publicKey, identityState, sessionUser?.id]);

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
        // If wallet not connected, open wallet modal instead of calling API
        if (!publicKey) {
            setWalletModalVisible(true);
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
            const result = await joinCircle(targetCircleId, undefined, sdk);
            // Refresh snapshot after join
            const [snap, status] = await Promise.all([
                fetchCircleMembershipState(targetCircleId),
                fetchCircleIdentityStatus(targetCircleId),
            ]);
            applyMembershipSnapshot(targetCircleId, snap);
            applyIdentityStatusSnapshot(targetCircleId, status);
            if (result.joinState === 'joined') {
                refetch();
            }
        } catch (err) {
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
        joinActionLoading,
        membershipSnapshot,
        publicKey,
        refetch,
        setWalletModalVisible,
    ]);

    const handleRegisterIdentityAndJoin = useCallback(async (handle: string) => {
        const targetCircleId = activeMembershipCircleId;
        const registered = await registerIdentity({ handle });
        if (!registered) {
            return;
        }

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
            const result = await joinCircle(targetCircleId, undefined, sdk);
            const [snap, status] = await Promise.all([
                fetchCircleMembershipState(targetCircleId),
                fetchCircleIdentityStatus(targetCircleId),
            ]);
            applyMembershipSnapshot(targetCircleId, snap);
            applyIdentityStatusSnapshot(targetCircleId, status);
            if (result.joinState === 'joined') {
                refetch();
            }
        } catch (err) {
            setJoinActionError(normalizeJoinActionError(err, joinCopy));
        } finally {
            setJoinActionLoading(false);
        }
    }, [activeMembershipCircleId, applyMembershipSnapshot, applyIdentityStatusSnapshot, refetch, registerIdentity]);

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
    useEffect(() => {
        setRequestedCrucibleDraftId(null);
    }, [activeDiscussionCircleId]);
    const activeCircleIdForSettings = useMemo(() => {
        const parsed = Number(activeSubCircle?.id || circleId);
        return Number.isFinite(parsed) ? parsed : null;
    }, [activeSubCircle?.id, circleId]);

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
    }, [activeDiscussionCircleId, circleId, publicKey, identityState, sessionUser?.id]);

    const handleTierChange = useCallback(
        (newTierId: string) => {
            const target = subCircles.find((s) => s.id === newTierId);
            if (!target) return;
            setActiveTierId(newTierId);
            setLastActiveSubCircle(circleId, newTierId);
            // Reset tab if the new circle doesn't support the current tab
            if (!target.tabs.includes(activeTab as 'plaza' | 'feed' | 'crucible' | 'sanctuary')) {
                setActiveTab(target.tabs[0] || 'plaza');
            }
        },
        [subCircles, circleId, activeTab],
    );

    const handleLockedTier = useCallback((sc: SubCircle) => {
        setShowAccessGate(sc);
    }, []);

    const loadGhostSettingsForCircle = useCallback(async (targetCircleId: number) => {
        setCircleGhostSettingsLoading(true);
        setCircleGhostSettingsError(null);
        try {
            const payload = await fetchCircleGhostSettings(targetCircleId);
            setCircleGhostSettings(payload.settings);
            setCircleGhostSettingsSource(payload.source);
        } catch (error) {
            console.error('[CirclePage] load ghost settings failed', error);
            setCircleGhostSettings(DEFAULT_CIRCLE_GHOST_SETTINGS);
            setCircleGhostSettingsSource('global_default');
            setCircleGhostSettingsError(circleDetailT('settings.errors.loadAiFallback'));
        } finally {
            setCircleGhostSettingsLoading(false);
        }
    }, []);

    const loadPolicyProfileForCircle = useCallback(async (targetCircleId: number) => {
        setCirclePolicyLoading(true);
        setCirclePolicyError(null);
        try {
            const payload = await fetchCirclePolicyProfile(targetCircleId);
            setCirclePolicyDraftLifecycleTemplate(payload.profile.draftLifecycleTemplate);
            setCirclePolicyDraftWorkflowPolicy(payload.profile.draftWorkflowPolicy);
            setCirclePolicyForkPolicy(payload.profile.forkPolicy);
        } catch (error) {
            console.error('[CirclePage] load policy profile failed', error);
            setCirclePolicyDraftLifecycleTemplate(DEFAULT_CIRCLE_DRAFT_LIFECYCLE_TEMPLATE);
            setCirclePolicyDraftWorkflowPolicy(null);
            setCirclePolicyForkPolicy(DEFAULT_CIRCLE_FORK_POLICY);
            setCirclePolicyError(circleDetailT('settings.errors.loadDraftPolicyFallback'));
        } finally {
            setCirclePolicyLoading(false);
        }
    }, []);

    const loadAgentsForCircle = useCallback(async (targetCircleId: number) => {
        setCircleAgentPolicyLoading(true);
        setCircleAgentPolicyError(null);
        try {
            const [agents, policy] = await Promise.all([
                fetchCircleAgents(targetCircleId),
                fetchCircleAgentPolicy(targetCircleId),
            ]);
            setCircleAgents(agents);
            setCircleAgentPolicy(policy);
        } catch (error) {
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
            setCircleAgentPolicyLoading(false);
        }
    }, []);

    useEffect(() => {
        if (activeCircleIdForSettings === null) return;
        void loadGhostSettingsForCircle(activeCircleIdForSettings);
        void loadPolicyProfileForCircle(activeCircleIdForSettings);
        if (!CIRCLE_AGENT_GOVERNANCE_UI_ENABLED) {
            setCircleAgents([]);
            setCircleAgentPolicy(null);
            setCircleAgentPolicyError(null);
            setCircleAgentPolicyLoading(false);
            return;
        }
        const settingsMembershipSnapshot = resolveActiveMembershipSnapshot({
            routeCircleId: circleId,
            activeCircleId: activeCircleIdForSettings,
            routeSnapshot: membershipSnapshot,
            activeTierSnapshot: activeTierMembershipSnapshot,
        });
        if (canManageCircleAgents({ snapshot: settingsMembershipSnapshot })) {
            void loadAgentsForCircle(activeCircleIdForSettings);
            return;
        }
        setCircleAgents([]);
        setCircleAgentPolicy({
            circleId: activeCircleIdForSettings,
            triggerScope: 'draft_only',
            costDiscountBps: 0,
            reviewMode: 'owner_review',
            updatedByUserId: null,
        });
        setCircleAgentPolicyError(null);
        setCircleAgentPolicyLoading(false);
    }, [
        activeCircleIdForSettings,
        activeTierMembershipSnapshot,
        circleId,
        loadAgentsForCircle,
        loadGhostSettingsForCircle,
        loadPolicyProfileForCircle,
        membershipSnapshot,
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
    const { data: knowledgeData } = useQuery<KnowledgeByCircleResponse>(GET_KNOWLEDGE_BY_CIRCLE, {
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

    const { likePost, pendingContentIds: pendingLikedContentIds } = useLikePost({
        onIndexed: async () => {
            await refetchCirclePosts({ id: activeDiscussionCircleId, limit: 50 });
        },
    });
    const { repostContent, pendingContentIds: pendingRepostedContentIds } = useRepostContent({
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
            text: n.body || n.title,
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
            text: p.text || '',
            time: formatRelativeTime(p.createdAt),
            likes: p.stats.likes,
            comments: p.stats.replies,
            reposts: p.stats.reposts,
            visibility: p.visibility,
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
                version: `v${k.version ?? 1}`,
                ageDays: Math.floor((Date.now() - new Date(k.createdAt).getTime()) / 86400000),
                content: (k.description && k.description.trim()) || k.title,
                sources: [],
                contributors: (k.contributors || []).map((c) => ({
                    handle: c.handle,
                    role: mapContributorRole(c.role),
                    weight: Math.max(0, Math.min(1, Number(c.weight ?? 0))),
                    authorType: c.authorType === 'AGENT' ? 'AGENT' : 'HUMAN',
                    sourceType: c.sourceType,
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
            }));
        }
        return [];
    }, [knowledgeData]);

    const knowledgeReferenceOptions = useMemo(
        () => buildKnowledgeReferenceOptions(knowledgeData?.knowledgeByCircle || []),
        [knowledgeData?.knowledgeByCircle],
    );

    // Map API drafts for CrucibleTab
    const drafts = useMemo(() => {
        if (draftsData?.circleDrafts?.length) {
            return draftsData.circleDrafts.map((d: GQLDraftSummary) => ({
                id: d.postId,
                title: d.title,
                heat: Math.max(0, Number(d.heatScore ?? 0)),
                editors: d.commentCount > 0 ? Math.ceil(d.commentCount / 3) : 1,
                comments: d.commentCount,
            }));
        }
        return [];
    }, [draftsData]);

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
        const nextTab = activeSubCircle.tabs.includes(requestedRouteTab)
            ? requestedRouteTab
            : (activeSubCircle.tabs[0] || 'plaza');
        const routeKey = `${circleId}:${requestedRouteTab}:${nextTab}`;
        if (lastAppliedRouteTabRef.current === routeKey) return;

        setActiveTab(nextTab);
        lastAppliedRouteTabRef.current = routeKey;
    }, [requestedRouteTab, activeSubCircle.tabs, circleId]);

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

        if (info.offset.x > threshold) {
            if (tabIndex > 0) {
                setActiveTab(tabIds[tabIndex - 1]);
                setBoundaryPills(null);
            } else {
                setBoundaryPills('left');
            }
        } else if (info.offset.x < -threshold) {
            if (tabIndex < tabIds.length - 1) {
                setActiveTab(tabIds[tabIndex + 1]);
                setBoundaryPills(null);
            } else {
                setBoundaryPills('right');
            }
        }
    }, [activeSubCircle.tabs, activeTab, tabDefs]);

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

    const walletPubkey = publicKey?.toBase58() || null;
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
            name: m.user.displayName || m.user.handle || m.user.pubkey?.slice(0, 8) || '?',
            handle: m.user.handle || null,
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
    const viewerIdentityState: IdentityState = viewerCircleState.identityState;
    const viewerDraftPermissionMembership = useMemo(() => {
        if (!viewerMembership) return null;
        return {
            role: viewerMembership.role,
            status: viewerMembership.status,
            identityLevel: viewerMembership.identityLevel,
        } as const;
    }, [viewerMembership]);
    useEffect(() => {
        selectedMemberRequestRef.current = null;
        setSelectedMember(null);
        clearSelectedMemberFollowState();
    }, [activeDiscussionCircleId, clearSelectedMemberFollowState, sessionUser?.id, walletPubkey]);
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
            return normalizeIdentityCopy(activeCircleIdentityStatus.hint);
        }
        return joinBannerState.hint;
    }, [activeCircleIdentityStatus, activeCircleMembershipSnapshot, joinBannerState.hint]);
    const plazaViewerStateHint = useMemo(() => {
        if (!activeCircleIdentityStatus?.hint || !activeCircleMembershipSnapshot) {
            return null;
        }
        if (
            activeCircleMembershipSnapshot.joinState === 'pending'
            || activeCircleMembershipSnapshot.joinState === 'invite_required'
            || activeCircleMembershipSnapshot.joinState === 'insufficient_crystals'
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
        if (!activeCircleIdentityStatus || activeCircleMembershipSnapshot?.joinState !== 'joined') {
            return null;
        }
        const currentLabel = identityCopy.levelLabels[activeCircleIdentityStatus.currentLevel];
        const nextLabel = activeCircleIdentityStatus.nextLevel
            ? identityCopy.levelLabels[activeCircleIdentityStatus.nextLevel]
            : null;
        return {
            currentLabel,
            nextLabel: nextLabel ? circleDetailT('identityProgress.nextLevel', {levelLabel: nextLabel}) : null,
            hint: normalizeIdentityCopy(activeCircleIdentityStatus.hint),
        };
    }, [activeCircleIdentityStatus, activeCircleMembershipSnapshot?.joinState, circleDetailT, identityCopy.levelLabels]);
    useEffect(() => {
        setIdentityProgressExpanded(false);
    }, [activeDiscussionCircleId, activeCircleMembershipSnapshot?.joinState]);
    const identityTransitionNotice = useMemo(() => {
        const transition = activeCircleIdentityStatus?.recentTransition;
        const changedAt = transition?.changedAt;
        if (!transition || !changedAt) return null;

        const from = identityCopy.levelLabels[transition.from] || transition.from;
        const to = identityCopy.levelLabels[transition.to] || transition.to;
        const reason = normalizeIdentityCopy(transition.reason?.trim());
        const suffix = reason ? ` · ${reason}` : '';
        return `${from} → ${to} · ${formatRelativeTime(changedAt)}${suffix}`;
    }, [activeCircleIdentityStatus?.recentTransition, formatRelativeTime, identityCopy.levelLabels]);
    const identityHistoryRows = useMemo(() => {
        const rows = activeCircleIdentityStatus?.history || [];
        if (!Array.isArray(rows) || rows.length === 0) return [] as string[];
        return rows.slice(0, 3).map((row) => {
            const from = identityCopy.levelLabels[row.from] || row.from;
            const to = identityCopy.levelLabels[row.to] || row.to;
            const reason = normalizeIdentityCopy(row.reason?.trim());
            return `${from} → ${to} · ${formatRelativeTime(row.changedAt)}${reason ? ` · ${reason}` : ''}`;
        });
    }, [activeCircleIdentityStatus?.history, formatRelativeTime, identityCopy.levelLabels]);
    const activeIdentityTransitionStorageKey = useMemo(() => {
        const changedAt = activeCircleIdentityStatus?.recentTransition?.changedAt;
        if (!changedAt) return null;
        const viewerScope = sessionUser?.pubkey || walletPubkey || 'anonymous';
        return `alcheme_identity_transition_dismissed:${viewerScope}:${activeDiscussionCircleId}:${changedAt}`;
    }, [activeCircleIdentityStatus?.recentTransition?.changedAt, activeDiscussionCircleId, sessionUser?.pubkey, walletPubkey]);
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
        const wallet = publicKey?.toBase58();
        if (!wallet) return '';
        return `user_${wallet.slice(0, 8)}`;
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
        const baseProfile: MemberProfile = {
            userId: member.user.id,
            pubkey: member.user.pubkey,
            name: member.user.displayName || member.user.handle,
            handle: member.user.handle,
            role: mapGqlRoleToCardRole(member.role),
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
                name: profile.user.displayName || profile.user.handle,
                handle: profile.user.handle,
                role: mapGqlRoleToCardRole(profile.role),
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
        setForkCreateError(circleDetailT('fork.errors.pendingFinalizationDetected', {
            targetCircleId: restoredPendingFinalization.targetCircleId,
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

    const forkSourceLineageItems = forkLineage?.asSource || [];
    const forkTargetLineageItems = forkLineage?.asTarget || [];
    const showForkLineageCard = forkLineageLoading
        || Boolean(forkLineageError)
        || forkSourceLineageItems.length > 0
        || forkTargetLineageItems.length > 0;

    const handleBoundaryTier = useCallback((direction: 'prev' | 'next') => {
        setBoundaryPills(null);

        if (isInAux) {
            // Auxiliary circle: navigate among siblings with same parentId
            const sibIdx = auxSiblings.findIndex(s => s.id === activeTierId);
            const targetIdx = direction === 'next' ? sibIdx + 1 : sibIdx - 1;
            if (targetIdx >= 0 && targetIdx < auxSiblings.length) {
                const target = auxSiblings[targetIdx];
                const locked = target.accessRequirement.type === 'crystal' && userCrystals < target.accessRequirement.minCrystals;
                setIsPillLifted(true);
                setTimeout(() => {
                    if (locked) {
                        handleLockedTier(target);
                    } else {
                        handleTierChange(target.id);
                    }
                    setIsPillLifted(false);
                }, 400);
            }
        } else {
            // Main circle: navigate among main circles only
            const mainIdx = mainCircles.findIndex(s => s.id === activeTierId);
            const targetIdx = direction === 'next' ? mainIdx + 1 : mainIdx - 1;
            if (targetIdx >= 0 && targetIdx < mainCircles.length) {
                const target = mainCircles[targetIdx];
                const locked = target.accessRequirement.type === 'crystal' && userCrystals < target.accessRequirement.minCrystals;
                setIsPillLifted(true);
                setTimeout(() => {
                    if (locked) {
                        handleLockedTier(target);
                    } else {
                        handleTierChange(target.id);
                        setActiveTab(direction === 'next' ? 'plaza' : 'sanctuary');
                    }
                    setIsPillLifted(false);
                }, 400);
            }
        }
    }, [activeTierId, handleTierChange, handleLockedTier, isInAux, auxSiblings, mainCircles, userCrystals]);

    const handleQuickJumpToCircle = useCallback((targetId: string) => {
        const target = subCircles.find((s) => s.id === targetId);
        if (!target) return;
        const locked = target.accessRequirement.type === 'crystal' && userCrystals < target.accessRequirement.minCrystals;
        if (locked) {
            handleLockedTier(target);
            return;
        }
        handleTierChange(targetId);
    }, [subCircles, handleLockedTier, handleTierChange, userCrystals]);

    const creationInitialGhostSettings = (
        circleGhostSettingsSource === 'circle' || circleGhostSettingsSource === 'pending'
    )
        ? (circleGhostSettings ?? DEFAULT_CIRCLE_GHOST_SETTINGS)
        : undefined;

    return (
        <div className={isPlaza ? styles.pageChat : styles.page} style={colorTempStyle as React.CSSProperties} suppressHydrationWarning>
            {/* ═══ Unified header + tabs ═══ */}
            <div className={isPlaza ? styles.stickyTop : undefined}>
                <div className="content-container">
                    <motion.header
                        className={styles.header}
                        initial={{ opacity: 0, y: 8 }}
                        animate={{ opacity: 1, y: 0 }}
                        transition={{ duration: 0.4, ease: [0.2, 0.8, 0.2, 1] }}
                    >
                        <Link href="/circles" className={styles.backButton} aria-label={circleDetailT('header.backToCirclesAria')}>
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
                                onLockedTier={handleLockedTier}
                                userCrystals={userCrystals}
                                isLifted={isPillLifted}
                                setIsLifted={setIsPillLifted}
                                onCreateCircle={() => {
                                    setCreatePermissionError(null);
                                    setShowCreateCircle(true);
                                }}
                            />
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
                                        return (
                                            <div key={`target-${item.lineageId}`} className={styles.forkLineageItem}>
                                                <div className={styles.forkLineageItemHeader}>
                                                    <span className={styles.forkLineageBadge}>{circleDetailT('forkLineage.badges.currentFrom')}</span>
                                                    <span className={styles.forkLineageItemTitle}>{item.sourceCircleName}</span>
                                                </div>
                                                <p className={styles.forkLineageBody}>{item.declarationText}</p>
                                                <div className={styles.forkLineageMeta}>
                                                    <span>{formatForkDeclarationStatus(item.status, circleDetailT)}</span>
                                                    {originAnchorRef && <span>{circleDetailT('forkLineage.meta.originAnchor', {anchor: originAnchorRef})}</span>}
                                                    {executionAnchorDigest && <span>{circleDetailT('forkLineage.meta.executionDigest', {digest: executionAnchorDigest})}</span>}
                                                </div>
                                            </div>
                                        );
                                    })}
                                    {forkSourceLineageItems.map((item) => {
                                        const markerSchedule = describeForkMarkerSchedule(item, circleDetailT, locale);
                                        const originAnchorRef = shortenForkLineageToken(item.originAnchorRef);
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
                                                <div className={styles.forkLineageMeta}>
                                                    {markerSchedule && <span>{markerSchedule}</span>}
                                                    <span>{formatForkDeclarationStatus(item.status, circleDetailT)}</span>
                                                    {originAnchorRef && <span>{circleDetailT('forkLineage.meta.originAnchor', {anchor: originAnchorRef})}</span>}
                                                </div>
                                            </div>
                                        );
                                    })}
                                </div>
                            )}
                        </Card>
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
                                                <span className={styles.identityProgressLabel}>{circleDetailT('identityProgress.labelInline')}</span>
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
                                                    {identityProgressCard.nextLabel && (
                                                        <span className={styles.identityProgressNext}>{identityProgressCard.nextLabel}</span>
                                                    )}
                                                </div>
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
                            {activeDiscussionCircleId && (
                                <Link
                                    href={`/circles/${activeDiscussionCircleId}/summary`}
                                    className={styles.identitySummaryBtn}
                                >
                                    {circleDetailT('identityProgress.summaryLink')}
                                </Link>
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
                                        {joinActionLoading ? circleDetailT('join.processing') : joinBannerState.label}
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
                    <TabBar tabs={activeTabs} activeTab={activeTab} onTabChange={setActiveTab} className={styles.tabBar} />
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
                    signMessage={signMessage}
                    viewerJoined={viewerJoinedCurrentCircle}
                    viewerIdentity={viewerIdentityState}
                    quickAuxCircles={quickAuxCircles}
                    onQuickJumpToCircle={handleQuickJumpToCircle}
                    onOpenCrucible={activeSubCircle.tabs.includes('crucible') ? handleOpenCrucible : undefined}
                    onDraftsChanged={activeSubCircle.tabs.includes('crucible')
                        ? () => refetchDrafts({ circleId: activeDiscussionCircleId, limit: 50 })
                        : undefined}
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
                    circleMembers={(activeDiscussionCircleData?.members || []) as any[]}
                    forwardTargets={plazaForwardTargets}
                    currentForwardCircleId={activeTierId}
                    currentForwardLevel={currentCircle?.level || 0}
                    userCrystals={userCrystals}
                    focusEnvelopeId={focusEnvelopeId}
                    viewerStateHintOverride={plazaViewerStateHint}
                />
            ) : activeTab === 'feed' ? (
                <motion.div
                    className={styles.tabContent}
                    onPanEnd={handleSwipe}
                    style={{ touchAction: 'pan-y' }}
                >
                    <FeedTab
                        posts={feedPosts}
                        circleName={activeSubCircle.name}
                        walletConnected={Boolean(publicKey)}
                        repostMembershipPending={repostMembershipPending}
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
                                    <CrucibleTab
                                        drafts={drafts}
                                        circleId={activeDiscussionCircleId}
                                        genesisMode={activeDiscussionCircleData?.genesisMode || 'BLANK'}
                                        knowledgeReferenceOptions={knowledgeReferenceOptions}
                                        draftLifecycleTemplate={circlePolicyDraftLifecycleTemplate}
                                        draftWorkflowPolicy={circlePolicyDraftWorkflowPolicy}
                                        viewerMembership={viewerDraftPermissionMembership}
                                        requestedDraftId={requestedCrucibleDraftId}
                                        onRequestedDraftHandled={handleRequestedCrucibleDraftHandled}
                                    />
                                )}
                                {activeTab === 'sanctuary' && <SanctuaryTab crystals={crystals} onCrystalClick={(c) => setSelectedCrystal(c)} />}
                            </motion.div>
                        </AnimatePresence>
                    </div>
                </motion.div>
            )}

            {/* ── Access Gate Overlay ── */}
            <AnimatePresence>
                {showAccessGate && (
                    <AccessGate
                        subCircle={showAccessGate}
                        userCrystals={userCrystals}
                        onDismiss={() => setShowAccessGate(null)}
                    />
                )}
            </AnimatePresence>

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
                        minCrystals: data.accessType === 'crystal' ? data.minCrystals : 0,
                        ghostSettings: data.ghostSettings,
                        draftLifecycleTemplate: data.draftLifecycleTemplate,
                        draftWorkflowPolicy: data.draftWorkflowPolicy,
                    });

                    if (!result?.txSignature) return false;

                    const refreshed = await refetch();

                    if (data.accessType === 'invite') {
                        // Invite-only circles open the invite sheet right after creation.
                        const expectedKind = isNextLevel ? 'main' : 'auxiliary';
                        const expectedLevel = isNextLevel
                            ? Math.max(0, (activeMainCircle.level ?? 0) + 1)
                            : Math.max(0, activeMainCircle.level ?? 0);
                        const allCircles = [
                            refreshed.data?.circle,
                            ...(refreshed.data?.circleDescendants || []),
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
                                openInviteSheetForCircle(parentCircle, activeMainCircle.name);
                            }
                        }, 300);
                    }

                    return true;
                }}
                submitting={isCreatingCircle}
                submitError={createPermissionError || createCircleError}
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
                resumePendingFinalization={Boolean(pendingForkFinalization)}
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
                    const inheritanceSnapshot = {
                        sourceCircleId: forkSourceCircleId,
                        sourceCircleName: forkSourceCircleName,
                        sourceLevel: forkSourceLevel,
                        resolvedInputs: forkCreateInputs,
                        prefilledConfig: {
                            mode: forkData.mode,
                            joinRequirement: forkData.accessType,
                            minCrystals: forkData.accessType === 'crystal' ? forkData.minCrystals : 0,
                            draftLifecycleTemplate: forkData.draftLifecycleTemplate,
                            draftWorkflowPolicy: forkData.draftWorkflowPolicy,
                            ghostPolicy: forkData.ghostSettings,
                            forkPolicy: forkData.forkPolicy,
                        },
                    } satisfies Record<string, unknown>;

                    if (pendingForkFinalization) {
                        try {
                            const retryResult = await createForkFromCircle({
                                sourceCircleId: forkSourceCircleId,
                                declarationId: pendingForkFinalization.declarationId,
                                targetCircleId: pendingForkFinalization.targetCircleId,
                                declarationText: pendingForkFinalization.declarationText,
                                executionAnchorDigest: pendingForkFinalization.executionAnchorDigest,
                                originAnchorRef: pendingForkFinalization.originAnchorRef,
                                inheritanceSnapshot: pendingForkFinalization.inheritanceSnapshot,
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
                        declarationText: forkData.declarationText,
                        configVersion: forkCreateInputs?.minimumFieldSet.configVersion ?? null,
                    }));
                    const declarationId = createForkDeclarationId(forkSourceCircleId);

                    try {
                        await createForkFromCircle({
                            sourceCircleId: forkSourceCircleId,
                            declarationId,
                            declarationText: forkData.declarationText,
                            originAnchorRef,
                        });
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
                        forkAnchor: {
                            sourceCircleId: forkSourceCircleId,
                            forkDeclarationDigest: declarationDigest,
                        },
                    });
                    if (!result) return false;

                    const nextPendingFinalization: PendingForkFinalization = {
                        sourceCircleId: forkSourceCircleId,
                        declarationId,
                        declarationText: forkData.declarationText,
                        targetCircleId: result.circleId,
                        executionAnchorDigest: declarationDigest,
                        originAnchorRef,
                        inheritanceSnapshot,
                    };
                    setPendingForkFinalization(nextPendingFinalization);

                    try {
                        const filingResult = await createForkFromCircle({
                            sourceCircleId: forkSourceCircleId,
                            declarationId,
                            targetCircleId: result.circleId,
                            declarationText: forkData.declarationText,
                            executionAnchorDigest: declarationDigest,
                            originAnchorRef,
                            inheritanceSnapshot,
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
                circleName={activeSubCircle.name}
                circleMode={activeSubCircle.mode}
                accessType={activeSubCircle.accessRequirement.type as 'free' | 'crystal' | 'invite'}
                minCrystals={activeSubCircle.accessRequirement.type === 'crystal' ? activeSubCircle.accessRequirement.minCrystals : 0}
                allowForwardOut={false}
                forwardPolicyEditable={false}
                forwardPolicyNotice={circleDetailT('settings.forwardPolicyNotice')}
                identityRules={activeCircleIdentityStatus?.thresholds ?? null}
                members={settingsMembers}
                memberDirectoryNotice={memberDirectoryNotice}
                currentUserRole={mapGqlRoleToCardRole(viewerMembership?.role || 'Member')}
                ghostSettings={circleGhostSettings}
                ghostSettingsSource={circleGhostSettingsSource}
                ghostSettingsLoading={circleGhostSettingsLoading}
                ghostSettingsSaving={circleGhostSettingsSaving}
                ghostSettingsError={circleGhostSettingsError}
                draftLifecycleTemplate={circlePolicyDraftLifecycleTemplate || DEFAULT_CIRCLE_DRAFT_LIFECYCLE_TEMPLATE}
                draftWorkflowPolicy={circlePolicyDraftWorkflowPolicy || DEFAULT_CIRCLE_DRAFT_WORKFLOW_POLICY}
                draftLifecycleSaving={circlePolicySaving}
                draftLifecycleError={circlePolicyError}
                agents={CIRCLE_AGENT_GOVERNANCE_UI_ENABLED ? circleAgents : []}
                agentPolicy={CIRCLE_AGENT_GOVERNANCE_UI_ENABLED ? circleAgentPolicy : null}
                agentPolicyLoading={CIRCLE_AGENT_GOVERNANCE_UI_ENABLED ? circleAgentPolicyLoading : false}
                agentPolicySaving={CIRCLE_AGENT_GOVERNANCE_UI_ENABLED ? circleAgentPolicySaving : false}
                agentPolicyError={CIRCLE_AGENT_GOVERNANCE_UI_ENABLED ? circleAgentPolicyError : null}
                onClose={() => setShowSettings(false)}
                onSaveGhostSettings={async (settings) => {
                    if (activeCircleIdForSettings === null) {
                        setCircleGhostSettingsError(circleDetailT('settings.errors.invalidCircleForAi'));
                        return;
                    }
                    setCircleGhostSettingsSaving(true);
                    setCircleGhostSettingsError(null);
                    try {
                        if (!publicKey || !signMessage) {
                            throw new Error('wallet_sign_message_unavailable');
                        }
                        const saved = await updateCircleGhostSettings(activeCircleIdForSettings, settings, {
                            actorPubkey: publicKey.toBase58(),
                            signMessage,
                        });
                        setCircleGhostSettings(saved.settings);
                        setCircleGhostSettingsSource(saved.source);
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
                    try {
                        if (!publicKey || !signMessage) {
                            throw new Error('wallet_sign_message_unavailable');
                        }
                        const saved = await updateCircleDraftLifecycleTemplate(activeCircleIdForSettings, template, {
                            actorPubkey: publicKey.toBase58(),
                            signMessage,
                        });
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
                    try {
                        if (!publicKey || !signMessage) {
                            throw new Error('wallet_sign_message_unavailable');
                        }
                        const saved = await updateCircleDraftWorkflowPolicy(activeCircleIdForSettings, policy, {
                            actorPubkey: publicKey.toBase58(),
                            signMessage,
                        });
                        setCirclePolicyDraftWorkflowPolicy(saved.profile.draftWorkflowPolicy);
                    } catch (error) {
                        console.error('[CirclePage] save draft workflow policy failed', error);
                        setCirclePolicyError(circleDetailT('settings.errors.saveWorkflowFailed'));
                        throw error;
                    } finally {
                        setCirclePolicySaving(false);
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
                deleteCircleAvailable={false}
                deleteCircleNotice={circleDetailT('settings.deleteNotice')}
                onRoleChange={async (member, newRole) => {
                    if (activeCircleIdForSettings === null) {
                        throw new Error(circleDetailT('settings.errors.invalidCircleForRoleChange'));
                    }
                    if (!member.pubkey) {
                        throw new Error(circleDetailT('settings.errors.memberWalletMissingForRoleChange'));
                    }
                    try {
                        await updateCircleMemberRole(
                            activeCircleIdForSettings,
                            member.userId,
                            newRole,
                            member.pubkey,
                            sdk,
                        );
                        await refetch();
                    } catch (error) {
                        throw new Error(normalizeMembershipActionError(error, circleDetailT('settings.errors.roleChangeFailed'), circleDetailT));
                    }
                }}
                onRemoveMember={async (member) => {
                    if (activeCircleIdForSettings === null) {
                        throw new Error(circleDetailT('settings.errors.invalidCircleForRemoveMember'));
                    }
                    if (!member.pubkey) {
                        throw new Error(circleDetailT('settings.errors.memberWalletMissingForRemoveMember'));
                    }
                    try {
                        await removeCircleMember(
                            activeCircleIdForSettings,
                            member.userId,
                            member.pubkey,
                            sdk,
                        );
                        await refetch();
                    } catch (error) {
                        throw new Error(normalizeMembershipActionError(error, circleDetailT('settings.errors.removeMemberFailed'), circleDetailT));
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
                        await leaveCircle(activeCircleIdForSettings, sdk);
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
                    if (selectedCrystal) navigator.clipboard.writeText(selectedCrystal.content);
                }}
                onCite={selectedCrystal?.knowledgeId
                    ? () => {
                        const targetKnowledgeId = selectedCrystal.knowledgeId;
                        setSelectedCrystal(null);
                        void router.push(`/knowledge/${targetKnowledgeId}?action=cite`);
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
