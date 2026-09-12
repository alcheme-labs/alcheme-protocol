'use client';

import { Fragment, useState, useCallback, useEffect, useRef, useMemo } from 'react';
import { useRouter } from 'next/navigation';
import { motion, AnimatePresence, PanInfo } from 'framer-motion';
import { useMutation } from '@apollo/client/react';
import { Smile, SendHorizonal, CornerDownLeft, Copy, Trash2, Compass, Rss, Plus, X, ChevronUp, ChevronDown, FileEdit, Mic, MicOff, PhoneOff, Loader2, Megaphone, Lightbulb, Check, ListChecks, ArrowUpRight, Landmark } from 'lucide-react';
import type { Connection, Transaction } from '@solana/web3.js';

import UsefulIndicator from '@/components/circle/UsefulIndicator';
import ProfileAvatar from '@/components/profile/ProfileAvatar/ProfileAvatar';
import MessageActionSheet from '@/components/circle/MessageActionSheet/MessageActionSheet';
import ChatRecordBubble from '@/components/circle/ChatRecordBubble/ChatRecordBubble';
import CirclePicker, { type PickerCircle } from '@/components/circle/CirclePicker/CirclePicker';
import { IdentityBadge } from '@/components/circle/IdentityBadge';
import { Skeleton } from '@/components/ui/Skeleton';
import GovernanceCaseTemplatePicker, {
    type GovernanceCaseTemplateDraft,
} from '@/features/governance/GovernanceCaseTemplatePicker';

import type { PlazaMessage, PlazaQuickAuxCircle, DiscussionSessionState } from '@/lib/circle/types';
import { mapDiscussionDtoToPlazaMessage, timeAgo } from '@/lib/circle/utils';
import {
    appendPlazaDiscussionMessages,
    buildPlazaReplyContextDisplay,
    buildPlazaReplyPreview,
    dedupePlazaMessagesByEnvelope,
    didPlazaMessageGestureMove,
    getCollapsiblePlazaReplyQuoteKeys,
    getExpandablePlazaReplyQuoteKeys,
    messageMatchesSemanticFacetFilters,
    mergePlazaDiscussionMessages,
    resolvePlazaReplyPresentation,
    type PlazaReplyQuote,
    pruneExpiredEphemeralMessages,
    refreshPlazaMessagesByEnvelope,
    shouldReconcileViewerDustMessage,
    shouldOpenPlazaReplyQuoteMenu,
    shouldOpenPlazaMessageActionSheet,
    shouldShowFullPlazaReplyQuote,
    shouldSkipPlazaMessageGestureTarget,
    syncPlazaDiscussionMessages as syncPlazaDiscussionMessagesSnapshot,
} from '@/lib/circle/plazaDiscussion';
import { MARK_MESSAGE_USEFUL, UNMARK_MESSAGE_USEFUL } from '@/lib/apollo/queries';
import {
    cancelDraftCandidate,
    appendAnchoredInteractionEvent,
    createDiscussionClientWriteIdentity,
    createAnchoredInteraction,
    createDiscussionSession,
    createDraftFromCandidate,
    createDraftFromDiscussionMessages,
    fetchAnchoredInteractionDetail,
    fetchDiscussionMessages,
    fetchDiscussionMessagesByEnvelopeIds,
    fetchAnchoredInteractions,
    fetchAnchoredSuggestionDecisions,
    getDiscussionProtocolBaseUrl,
    forwardDiscussionMessage,
    forwardDiscussionMessagesBatch,
    lookupAnchoredInteractions,
    resolveAnchoredInteraction,
    refreshDiscussionSession,
    sendDiscussionMessage,
    tombstoneDiscussionMessage,
} from '@/lib/api/discussion';
import type {
    DiscussionAnchoredInteractionDto,
    AnchoredInteractionDetailDto,
    DraftCandidateCreateDraftResponse,
    PlazaAnchoredInteractionType,
} from '@/lib/api/discussion';
import {
    ensureCircleCommunicationRoomSession,
    updateCircleRoomVoicePolicy,
} from '@/lib/api/communication';
import {
    createGovernanceCaseIntake,
    preflightGovernanceCaseIntake,
    type GovernanceCaseIntakeSuggestion,
} from '@/lib/api/governance';
import {
    approveVoiceSpeaker,
    createVoiceSession,
    createVoiceToken,
    denyVoiceSpeaker,
    fetchVoiceParticipants,
    type VoiceParticipantsResponse,
} from '@/lib/api/voice';
import {
    createLiveKitBrowserVoiceProvider,
    type LiveKitBrowserVoiceConnection,
    type LiveKitBrowserVoiceProvider,
} from '@/lib/voice/livekitClient';
import {
    runWithDiscussionSessionRecovery,
    type DiscussionSessionTokenOptions,
} from '@/lib/discussion/sessionRecovery';
import { resolveDiscussionWalletPolicy } from '@/lib/discussion/discussionWalletPolicy';
import { subscribeToCircleDiscussionRealtime, type DiscussionRealtimeSubscription } from '@/lib/discussion/realtime';
import { createIdentityCopy, normalizeIdentityCopy } from '@/lib/circle/identityCopy';
import { mapIdentityLevelToDisplayState } from '@/lib/circle/identityDisplay';
import type {
    CircleIdentityDisplayState,
    CircleIdentityLevelValue,
    CircleRoleValue,
    ViewerIdentityState,
} from '@/lib/circle/identityTypes';
import { canMarkPlazaMessageUseful } from '@/lib/circle/plazaUsefulMarkPermissions';
import { isPlazaScrolledNearBottom } from '@/lib/circle/plazaScroll';
import { getGovernedForwardTargets, getPlazaForwardAction } from '@/lib/circle/plazaForwarding';
import {
    extractDiscussionRealtimeLamport,
    resolveDiscussionSnapshotLamport,
} from '@/lib/circle/plazaRealtimeStartup';
import { buildCircleTabHref } from '@/lib/notifications/routing';
import DraftCandidateInlineCard from '@/features/discussion-intake/candidate-cards/DraftCandidateInlineCard';
import AnchoredInteractionCard, {
    type AnchoredInteractionEventDraft,
} from '@/features/anchored-interactions/AnchoredInteractionCard';
import AnchoredInteractionComposerSheet, {
    type AnchoredInteractionCreateDraft,
} from '@/features/anchored-interactions/AnchoredInteractionComposerSheet';
import AnchoredInteractionTipSheet, {
    type AnchoredInteractionTipSubmit,
} from '@/features/anchored-interactions/AnchoredInteractionTipSheet';
import AnchoredInteractionDetailSheet from '@/features/anchored-interactions/AnchoredInteractionDetailSheet';
import AnchoredInteractionFieldButton from '@/features/anchored-interactions/AnchoredInteractionFieldButton';
import AnchoredInteractionFieldSheet from '@/features/anchored-interactions/AnchoredInteractionFieldSheet';
import InteractionFieldMotionLayer, {
    type InteractionFieldMotionSnapshot,
} from '@/features/anchored-interactions/InteractionFieldMotionLayer';
import InteractionResultNoticeCard from '@/features/anchored-interactions/InteractionResultNoticeCard';
import { getChallengeInteractionMode } from '@/features/anchored-interactions/eventRegistry';
import { parseInteractionResultNoticeMetadata } from '@/features/anchored-interactions/metadata';
import {
    useAnchoredInteractionField,
    type AnchoredInteractionFieldItem,
} from '@/features/anchored-interactions/useAnchoredInteractionField';
import { useAnchoredInteractionActions } from '@/features/anchored-interactions/useAnchoredInteractionActions';
import { useWalletActionRunner } from '@/lib/wallet/useWalletActionRunner';
import type { AnchoredAssetReceiptDraft } from '@/features/anchored-interactions/assetReceipts';
import {
    buildAnchoredInteractionSuggestions,
    createAnchoredInteractionSuggestionConvertedKey,
    createAnchoredInteractionSuggestionDismissedKey,
    selectAnchoredInteractionSuggestionCandidateEnvelopeIds,
    type AnchoredInteractionSuggestion,
    type InteractionSuggestionDecision,
} from '@/features/anchored-interactions/suggestions';
import AnnouncementPublishSheet from '@/features/circle-announcements/AnnouncementPublishSheet';
import AnnouncementInlineNoticeCard from '@/features/circle-announcements/AnnouncementInlineNoticeCard';
import AnnouncementFloatingPanel from '@/features/circle-announcements/AnnouncementFloatingPanel';
import AnnouncementCenterSheet from '@/features/circle-announcements/AnnouncementCenterSheet';
import AnnouncementDetailSheet from '@/features/circle-announcements/AnnouncementDetailSheet';
import {
    normalizeSelectedDraftSourceMessageIds,
    selectVisibleDraftSourceMessageIds,
} from './manualDraftSource';
import {
    isSelectablePlazaMessageForAction,
    normalizeSelectedPlazaMessageIds,
    type PlazaMessageSelectionMode,
} from './messageSelection';
import { createAnnouncementCopy } from '@/features/circle-announcements/announcementCopy';
import {
    confirmCircleAnnouncement,
    fetchCircleAnnouncementDetail,
    fetchCircleAnnouncements,
    markCircleAnnouncementSeen,
    markCircleAnnouncementUnread,
} from '@/lib/api/circleAnnouncements';
import type {
    CircleAnnouncementDetailDto,
    CircleAnnouncementViewerCapabilities,
} from '@/features/circle-announcements/types';
import {
    buildStructuredDiscussionMetadata,
    AUTHOR_ANNOTATION_VALUES,
    type AuthorAnnotationKind,
    type SemanticFacet,
} from '@/features/discussion-intake/labels/structuredMetadata';
import { SourceGroundedAskPanel } from '@/features/ai-evidence-answer';
import {
    parseDraftCandidateInlineNotice,
    type DraftCandidateInlineNotice,
    toAcceptedCandidateHandoffContext,
} from '@/features/discussion-intake/handoff/acceptedCandidate';
import { resolveCandidateRecoveryActions } from '@/features/discussion-intake/governance/recovery';
import { useCurrentLocale, useI18n } from '@/i18n/useI18n';
import type { SessionUser } from '@/lib/api/session';
import type { WalletIdentityState } from '@/lib/auth/identityOnboarding';
import styles from '@/app/(main)/circles/[id]/page.module.css';

const REPLY_PREVIEW_MAX_LENGTH = 64;
const COMPOSER_HINT_AUTO_HIDE_MS = 40_000;
const DISCUSSION_SYNC_LIMIT = 120;
const MANUAL_DRAFT_SOURCE_LIMIT = 16;
const MANUAL_DRAFT_SELECTION_LIMIT = 20;
const MESSAGE_SELECTION_LIMIT = 20;
const FORWARD_BUNDLE_COLLAPSED_PREVIEW_LIMIT = 3;
const FORWARD_BUNDLE_ITEM_PREVIEW_LIMIT = 80;
const SOURCE_GROUNDED_ASK_CONTEXT_LIMIT = 280;

type PlazaTranslate = (key: string, values?: Record<string, string | number>) => string;
type VoiceStatus = 'idle' | 'joining' | 'connected' | 'leaving' | 'error';

function readRequestErrorCode(error: unknown): string {
    return typeof (error as { code?: unknown })?.code === 'string'
        ? (error as { code: string }).code
        : '';
}

function truncateForwardBundlePreview(text: string, limit = FORWARD_BUNDLE_ITEM_PREVIEW_LIMIT): string {
    const parts = Array.from(String(text || '').trim());
    if (parts.length <= limit) return parts.join('');
    return `${parts.slice(0, limit).join('')}…`;
}
type VoiceOverflowStrategy = 'listen_only' | 'deny' | 'queue' | 'moderated_queue';
const VOICE_OVERFLOW_STRATEGIES: VoiceOverflowStrategy[] = ['listen_only', 'deny', 'queue', 'moderated_queue'];

function resolveComposerRoleLabel(role: CircleRoleValue | string | null | undefined, t: PlazaTranslate): string | null {
    if (role === 'Owner') return t('composer.roleLabels.Owner');
    if (role === 'Admin') return t('composer.roleLabels.Admin');
    if (role === 'Moderator') return t('composer.roleLabels.Moderator');
    return null;
}

function resolveMessageIdentityBadgeState(message: PlazaMessage): CircleIdentityDisplayState {
    if (
        message.senderIdentityState === 'observer'
        || message.senderIdentityState === 'participant'
        || message.senderIdentityState === 'contributor'
        || message.senderIdentityState === 'senior_contributor'
        || message.senderIdentityState === 'not_joined'
        || message.senderIdentityState === 'unknown'
    ) {
        return message.senderIdentityState;
    }
    return 'unknown';
}

function resolveMessageIdentityLabel(message: PlazaMessage, t: PlazaTranslate): string {
    if (typeof message.senderIdentityDisplayName === 'string' && message.senderIdentityDisplayName.trim()) {
        return message.senderIdentityDisplayName.trim();
    }
    return t(`identityExplanation.states.${resolveMessageIdentityBadgeState(message)}`);
}

function resolveMembershipSourceLabel(source: PlazaMessage['senderMembershipSource'], t: PlazaTranslate): string | null {
    if (source === 'current_circle') return t('identityExplanation.sources.current_circle');
    if (source === 'inherited_parent') return t('identityExplanation.sources.inherited_parent');
    return null;
}

interface CachedCommunicationVoiceSession {
    roomKey: string;
    walletPubkey: string;
    communicationAccessToken: string;
    expiresAt: string;
}

interface CircleRoomVoicePolicy {
    maxSpeakers: number;
    overflowStrategy: string;
}

interface IdentityExplanationRow {
    label: string;
    value: string;
}

interface MessageUsefulMarkMutationResult {
    markMessageUseful?: {
        ok: boolean;
        usefulCount: number;
        isFeatured: boolean;
        viewerHasMarkedUseful: boolean;
        changed: boolean;
    };
    unmarkMessageUseful?: {
        ok: boolean;
        usefulCount: number;
        isFeatured: boolean;
        viewerHasMarkedUseful: boolean;
        changed: boolean;
    };
}

function buildReplyPreview(text: string, emptyText: string): string {
    return buildPlazaReplyPreview(text, emptyText, REPLY_PREVIEW_MAX_LENGTH);
}

function buildUsefulCountMap(messages: PlazaMessage[]): Record<number, number> {
    return Object.fromEntries(messages.map((message) => [message.id, message.usefulCount]));
}

function buildUsefulMarkedIdSet(messages: PlazaMessage[]): Set<number> {
    return new Set(messages
        .filter((message) => message.viewerHasMarkedUseful)
        .map((message) => message.id));
}

function readStringSetFromLocalStorage(key: string): Set<string> {
    if (typeof window === 'undefined') return new Set();
    try {
        const parsed = JSON.parse(window.localStorage.getItem(key) || '[]');
        if (!Array.isArray(parsed)) return new Set();
        return new Set(parsed.filter((item): item is string => typeof item === 'string' && item.length > 0));
    } catch {
        return new Set();
    }
}

function writeStringSetToLocalStorage(key: string, value: ReadonlySet<string>): void {
    if (typeof window === 'undefined') return;
    try {
        window.localStorage.setItem(key, JSON.stringify(Array.from(value)));
    } catch {
        // Local persistence is best-effort; failure should not block discussion.
    }
}

function areAnchoredInteractionSuggestionListsEqual(
    left: AnchoredInteractionSuggestion[],
    right: AnchoredInteractionSuggestion[],
): boolean {
    if (left.length !== right.length) return false;
    return left.every((item, index) => {
        const other = right[index];
        return Boolean(other)
            && item.envelopeId === other.envelopeId
            && item.suggestedInteractionType === other.suggestedInteractionType;
    });
}

function buildQuotedReplyText(input: {
    author: string;
    preview: string;
    body: string;
}, template: (values: {author: string; preview: string; body: string}) => string): string {
    return template(input);
}

function formatAnchoredInteractionLiveResult(
    interaction: DiscussionAnchoredInteractionDto,
    t: PlazaTranslate,
): string {
    const summary = interaction.summary || {};
    switch (interaction.interactionType) {
        case 'signup':
            return t('anchoredInteraction.detail.snapshot.signup', {
                count: getNumericSummaryValue(summary, 'participantCount'),
            });
        case 'poll': {
            const options = formatPollOptionCounts(interaction);
            if (!options) return t('anchoredInteraction.detail.snapshot.pollNoVotes');
            return t('anchoredInteraction.detail.snapshot.poll', {
                options,
                participants: getNumericSummaryValue(summary, 'participantCount'),
            });
        }
        case 'challenge':
            if (getChallengeInteractionMode(interaction.state) === 'credibility_vote') {
                const options = formatPollOptionCounts(interaction, {
                    agree_challenge: t('anchoredInteraction.challengeTrustVoteAgree'),
                    disagree_challenge: t('anchoredInteraction.challengeTrustVoteDisagree'),
                });
                return t('anchoredInteraction.detail.snapshot.challengeTrustVote', {
                    options: options || t('anchoredInteraction.empty.votes'),
                    participants: getNumericSummaryValue(summary, 'participantCount'),
                });
            }
            return t('anchoredInteraction.detail.snapshot.challenge', {
                submissions: getNumericSummaryValue(summary, 'submissionCount'),
                unresolved: getNumericSummaryValue(summary, 'unresolvedCount'),
                accepted: getNumericSummaryValue(summary, 'acceptedCount'),
                rejected: getNumericSummaryValue(summary, 'rejectedCount'),
                changesRequested: getNumericSummaryValue(summary, 'changesRequestedCount'),
            });
        case 'announcement':
            return t('anchoredInteraction.detail.snapshot.announcement', {
                reads: getNumericSummaryValue(summary, 'readCount'),
            });
        case 'support':
            return t('anchoredInteraction.detail.snapshot.support', {
                supporters: getNumericSummaryValue(summary, 'supportCount'),
            });
        case 'tip':
            return t('anchoredInteraction.detail.snapshot.tip', {
                receipts: getNumericSummaryValue(summary, 'receiptCount'),
                failures: getNumericSummaryValue(summary, 'failureCount'),
            });
        case 'bounty':
            return t('anchoredInteraction.detail.snapshot.bounty', {
                submissions: getNumericSummaryValue(summary, 'submissionCount'),
                unresolved: getNumericSummaryValue(summary, 'unresolvedCount'),
                rejected: getNumericSummaryValue(summary, 'rejectedCount'),
            });
    }
}

function getNumericSummaryValue(summary: Record<string, unknown>, key: string): number {
    const value = summary[key];
    return typeof value === 'number' && Number.isFinite(value) ? value : 0;
}

function formatPollOptionCounts(
    interaction: DiscussionAnchoredInteractionDto,
    labelOverrides: Record<string, string> = {},
): string | null {
    const optionCounts = toNumberRecord(interaction.summary.optionCounts);
    const options = Array.isArray(interaction.state.options)
        ? interaction.state.options
            .map((item) => (item && typeof item === 'object' && !Array.isArray(item) ? item as Record<string, unknown> : null))
            .filter((item): item is Record<string, unknown> => Boolean(item))
            .map((item) => ({
                id: typeof item.id === 'string' ? item.id : '',
                label: typeof item.label === 'string' ? item.label : '',
            }))
            .filter((item) => item.id && item.label)
        : [];
    const optionRows = Object.entries(optionCounts)
        .map(([optionId, count]) => ({
            optionId,
            count,
            label: labelOverrides[optionId] || options.find((option) => option.id === optionId)?.label || optionId,
        }))
        .sort((left, right) => right.count - left.count || left.label.localeCompare(right.label));
    if (optionRows.length === 0) return null;
    return optionRows.map((row) => `${row.label}: ${row.count}`).join(' · ');
}

function toNumberRecord(value: unknown): Record<string, number> {
    if (!value || typeof value !== 'object' || Array.isArray(value)) return {};
    const output: Record<string, number> = {};
    for (const [key, raw] of Object.entries(value)) {
        if (typeof raw === 'number' && Number.isFinite(raw)) output[key] = raw;
    }
    return output;
}

function parseAnnouncementNoticeFromMessage(message: PlazaMessage): {
    announcementId: string;
    title: string;
    bodyPreview: string;
} | null {
    if (message.messageKind !== 'announcement_notice') return null;
    const metadata = message.metadata && typeof message.metadata === 'object'
        ? message.metadata as Record<string, unknown>
        : {};
    const announcementId = typeof metadata.announcementId === 'string' ? metadata.announcementId.trim() : '';
    if (!announcementId) return null;
    const title = typeof metadata.title === 'string' && metadata.title.trim()
        ? metadata.title.trim()
        : message.text.split('\n')[0]?.trim() || announcementId;
    const bodyPreview = message.text
        .replace(title, '')
        .replace(/^\s+/, '')
        .trim()
        .slice(0, 180);
    return {
        announcementId,
        title,
        bodyPreview,
    };
}

function sortCircleAnnouncements(items: CircleAnnouncementDetailDto[]): CircleAnnouncementDetailDto[] {
    return [...items].sort((left, right) => (
        right.pinPriority - left.pinPriority
        || Date.parse(right.publishedAt) - Date.parse(left.publishedAt)
        || left.announcementId.localeCompare(right.announcementId)
    ));
}

function needsAnnouncementAttention(announcement: CircleAnnouncementDetailDto): boolean {
    const status = announcement.myReceipt?.status ?? 'unread';
    if (status === 'unread') return true;
    return announcement.confirmationPolicy === 'explicit_confirm' && status !== 'confirmed';
}

function isIncomingAnchoredInteractionNewer(
    incoming: DiscussionAnchoredInteractionDto,
    current: DiscussionAnchoredInteractionDto | undefined,
): boolean {
    if (!current) return true;
    if (incoming.projectionVersion !== current.projectionVersion) {
        return incoming.projectionVersion > current.projectionVersion;
    }
    return incoming.projectionCursor >= current.projectionCursor;
}

type PlazaTabTranslator = ReturnType<typeof useI18n>;

interface AnchoredInteractionComposerAnchorBase {
    anchorMode: 'message' | 'freeform';
    preselectedInteractionType?: PlazaAnchoredInteractionType | null;
}

type AnchoredInteractionComposerAnchor =
    | (AnchoredInteractionComposerAnchorBase & {
        anchorMode: 'message';
        message: PlazaMessage;
    })
    | (AnchoredInteractionComposerAnchorBase & {
        anchorMode: 'freeform';
        freeformRef: string;
        sourceLabel: string;
        anchorPreview: string | null;
    });

type TipTransferTarget =
    | { mode: 'initial'; message: PlazaMessage }
    | { mode: 'add'; interaction: DiscussionAnchoredInteractionDto };

type SourceGroundedAskTarget = {
    envelopeId: string;
    author: string;
    preview: string;
    question: string;
};

type PendingInitialTipRecord =
    | {
        mode: 'initial';
        anchorEnvelopeId: string;
        recipientPubkey: string;
        amount: string;
        receipt: AnchoredAssetReceiptDraft;
        createClientNonce: string;
        recordClientNonce: string;
    }
    | {
        mode: 'add';
        interactionId: string;
        recipientPubkey: string;
        amount: string;
        receipt: AnchoredAssetReceiptDraft;
        recordClientNonce: string;
    };

function resolveDiscussionRealtimeError(message: string | null, t: PlazaTabTranslator): string | null {
    if (!message) return null;
    if (message === 'discussion_realtime_disconnected') {
        return t('errors.realtimeDisconnected');
    }
    if (message === 'realtime_sync_failed') {
        return t('errors.realtimeSyncFailed');
    }
    return message;
}

function PlazaTab({
    messages,
    loading,
    onSwipe,
    discussionCircleId,
    walletPubkey,
    identityState,
    sessionUser,
    signMessage,
    walletConnection,
    walletSendTransaction,
    viewerJoined,
    viewerIdentity,
    viewerRole,
    viewerContributionLevel,
    quickAuxCircles,
    onQuickJumpToCircle,
    onOpenCrucible,
    onDraftsChanged,
    onReconcileViewerMembership,
    onAvatarTap,
    circleMembers,
    forwardTargets,
    currentForwardCircleId,
    currentForwardLevel,
    focusEnvelopeId,
    focusedAnnouncementId,
    viewerStateHintOverride,
}: {
    messages: PlazaMessage[];
    loading: boolean;
    onSwipe: (e: MouseEvent | TouchEvent | PointerEvent, info: PanInfo) => void;
    discussionCircleId: number;
    walletPubkey: string | null;
    identityState: WalletIdentityState;
    sessionUser?: SessionUser | null;
    signMessage?: (message: Uint8Array) => Promise<Uint8Array>;
    walletConnection?: Connection | null;
    walletSendTransaction?: (transaction: Transaction, connection: Connection) => Promise<string>;
    viewerJoined: boolean;
    viewerIdentity: ViewerIdentityState;
    viewerRole?: CircleRoleValue | null;
    viewerContributionLevel?: CircleIdentityLevelValue | null;
    quickAuxCircles: PlazaQuickAuxCircle[];
    onQuickJumpToCircle?: (subCircleId: string) => void;
    onOpenCrucible?: (draftPostId?: number | null) => void;
    onDraftsChanged?: () => void | Promise<unknown>;
    onReconcileViewerMembership?: () => Promise<unknown>;
    onAvatarTap?: (author: string, senderPubkey?: string | null) => void;
    circleMembers?: Array<{
        user: { handle: string; pubkey: string; avatarUri?: string | null };
        role: string;
        identityLevel: string;
    }>;
    forwardTargets: PickerCircle[];
    currentForwardCircleId: string;
    currentForwardLevel: number;
    focusEnvelopeId?: string | null;
    focusedAnnouncementId?: string | null;
    viewerStateHintOverride?: string | null;
}) {
    const router = useRouter();
    const t = useI18n('PlazaTab');
    const voiceBoundaryT = useI18n('VoiceModerationBoundary');
    const locale = useCurrentLocale();
    type DiscussionViewMode = 'all' | 'focused' | 'mine';
    const discussionWalletPolicy = resolveDiscussionWalletPolicy({
        discussionAuthMode: process.env.NEXT_PUBLIC_DISCUSSION_AUTH_MODE,
        requireSignature: process.env.NEXT_PUBLIC_DISCUSSION_REQUIRE_SIGNATURE,
    });
    const useSessionTokenAuth = discussionWalletPolicy.useSessionTokenAuth;
    const shouldSignEachMessage = discussionWalletPolicy.shouldSignEachMessage;
    const semanticFacetCopy = useMemo<Record<SemanticFacet, string>>(() => ({
        fact: t('semanticFacets.fact'),
        explanation: t('semanticFacets.explanation'),
        emotion: t('semanticFacets.emotion'),
        question: t('semanticFacets.question'),
        problem: t('semanticFacets.problem'),
        criteria: t('semanticFacets.criteria'),
        proposal: t('semanticFacets.proposal'),
        summary: t('semanticFacets.summary'),
    }), [t]);
    const sourceAskScopeLabels = useMemo(() => ({
        current_circle: t('sourceAsk.scopes.current_circle'),
        formal_references: t('sourceAsk.scopes.formal_references'),
        trend_receipts: t('sourceAsk.scopes.trend_receipts'),
        source_materials: t('sourceAsk.scopes.source_materials'),
    }), [t]);
    const anchoredInteractionTypeLabels = useMemo<Record<PlazaAnchoredInteractionType, string>>(() => ({
        signup: t('anchoredInteraction.type.signup'),
        poll: t('anchoredInteraction.type.poll'),
        challenge: t('anchoredInteraction.type.challenge'),
        announcement: t('anchoredInteraction.type.announcement'),
        support: t('anchoredInteraction.type.support'),
        tip: t('anchoredInteraction.type.tip'),
        bounty: t('anchoredInteraction.type.bounty'),
    }), [t]);
    const anchoredInteractionActionLabels = useMemo<Record<PlazaAnchoredInteractionType, string>>(() => ({
        signup: t('anchoredInteraction.actions.signup'),
        poll: t('anchoredInteraction.actions.poll'),
        challenge: t('anchoredInteraction.actions.challenge'),
        announcement: t('anchoredInteraction.actions.announcement'),
        support: t('anchoredInteraction.actions.support'),
        tip: t('anchoredInteraction.actions.tip'),
        bounty: t('anchoredInteraction.actions.bounty'),
    }), [t]);
    const anchoredInteractionResolveLabels = useMemo<Record<PlazaAnchoredInteractionType, string>>(() => ({
        signup: t('anchoredInteraction.resolveByType.signup'),
        poll: t('anchoredInteraction.resolveByType.poll'),
        challenge: t('anchoredInteraction.resolveByType.challenge'),
        announcement: t('anchoredInteraction.resolveByType.announcement'),
        support: t('anchoredInteraction.resolveByType.support'),
        tip: t('anchoredInteraction.resolveByType.tip'),
        bounty: t('anchoredInteraction.resolveByType.bounty'),
    }), [t]);
    const anchoredInteractionManagementLabels = useMemo(() => ({
        reviewSubmissions: t('anchoredInteraction.management.reviewSubmissions'),
        accept: t('anchoredInteraction.management.accept'),
        reject: t('anchoredInteraction.management.reject'),
        requestChanges: t('anchoredInteraction.management.requestChanges'),
    }), [t]);
    const announcementCopy = useMemo(() => createAnnouncementCopy(t), [t]);
    const viewerSessionPubkey = sessionUser?.pubkey ?? null;
    const viewerHasRegisteredIdentity = identityState === 'registered' && !!viewerSessionPubkey;
    const viewerIdentityWriteError = identityState === 'registered'
        ? t('errors.walletRequired')
        : t('errors.identityRequired');
    const { runWalletAction } = useWalletActionRunner();
    const { sendTipTransfer, recordTipTransferReceipt } = useAnchoredInteractionActions({
        wallet: walletPubkey && walletSendTransaction
            ? {
                publicKey: walletPubkey,
                sendTransaction: walletSendTransaction,
            }
            : null,
        connection: walletConnection ?? null,
        appendEvent: appendAnchoredInteractionEvent,
    });
    const runTipTransfer = useCallback((input: Parameters<typeof sendTipTransfer>[0]) => runWalletAction({
        kind: 'tip_transfer',
        source: 'anchored_interaction_tip_transfer',
        key: `tip_transfer:${input.recipientPubkey}:${input.amount}:${input.assetType}:${input.mint || 'native'}`,
        run: () => sendTipTransfer(input),
    }), [runWalletAction, sendTipTransfer]);
    const identityCopy = useMemo(() => createIdentityCopy(t), [t]);
    const anchoredInteractionSuggestionViewerKey = viewerSessionPubkey || 'anonymous';
    const anchoredInteractionSuggestionStorageBaseKey = `alcheme:plaza:${discussionCircleId}:suggestions:${anchoredInteractionSuggestionViewerKey}`;
    const composerHintBody = typeof viewerStateHintOverride === 'string'
        ? normalizeIdentityCopy(viewerStateHintOverride.trim())
        : '';
    const composerContributionLevelLabel = viewerContributionLevel
        ? identityCopy.levelLabels[viewerContributionLevel]
        : null;
    const composerContributionLevelBadgeState = composerContributionLevelLabel
        ? mapIdentityLevelToDisplayState(viewerContributionLevel)
        : null;
    const composerRoleLabel = resolveComposerRoleLabel(viewerRole, t);
    const composerIdentityHint = viewerJoined && composerHintBody
        ? (
            composerContributionLevelLabel
                ? (
                    composerRoleLabel
                        ? t('composer.identityHintWithRole', {
                            roleLabel: composerRoleLabel,
                            levelLabel: composerContributionLevelLabel,
                            hint: composerHintBody,
                        })
                        : t('composer.identityHintContributionLevel', {
                            levelLabel: composerContributionLevelLabel,
                            hint: composerHintBody,
                        })
                )
                : t('composer.identityHint', { hint: composerHintBody })
        )
        : null;
    const eligibleForwardTargets = useMemo(
        () => getGovernedForwardTargets({
            circles: forwardTargets,
            currentLevel: currentForwardLevel,
            currentSubCircleId: currentForwardCircleId,
        }),
        [forwardTargets, currentForwardLevel, currentForwardCircleId],
    );
    const [usefulCounts, setUsefulCounts] = useState<Record<number, number>>(() =>
        buildUsefulCountMap(messages)
    );
    const [usefulMarkedIds, setUsefulMarkedIds] = useState<Set<number>>(() =>
        buildUsefulMarkedIdSet(messages)
    );
    const [chatInput, setChatInput] = useState('');
    const [localMessages, setLocalMessages] = useState<PlazaMessage[]>(messages);
    const [discussionLoading, setDiscussionLoading] = useState(false);
    const [discussionError, setDiscussionError] = useState<string | null>(null);
    const [discussionSnapshotVersion, setDiscussionSnapshotVersion] = useState(0);
    const [discussionSession, setDiscussionSession] = useState<DiscussionSessionState | null>(null);
    const [voiceStatus, setVoiceStatus] = useState<VoiceStatus>('idle');
    const [voiceError, setVoiceError] = useState<string | null>(null);
    const [voiceMuted, setVoiceMuted] = useState(false);
    const [voiceCanPublishAudio, setVoiceCanPublishAudio] = useState(true);
    const [voiceParticipantCount, setVoiceParticipantCount] = useState(0);
    const [activeVoiceSessionId, setActiveVoiceSessionId] = useState<string | null>(null);
    const [voiceManagement, setVoiceManagement] = useState<VoiceParticipantsResponse | null>(null);
    const [voiceManagementBusyWallet, setVoiceManagementBusyWallet] = useState<string | null>(null);
    const [voicePolicyMaxSpeakers, setVoicePolicyMaxSpeakers] = useState(16);
    const [voicePolicyStrategy, setVoicePolicyStrategy] = useState<VoiceOverflowStrategy>('listen_only');
    const [voicePolicyDirty, setVoicePolicyDirty] = useState(false);
    const [voicePolicyLoaded, setVoicePolicyLoaded] = useState(false);
    const [voicePolicySaving, setVoicePolicySaving] = useState(false);
    const [lastEnvelopeId, setLastEnvelopeId] = useState<string | null>(null);
    const [viewMode, setViewMode] = useState<DiscussionViewMode>('all');
    const [showPanel, setShowPanel] = useState(false);
    const [showEmojiGrid, setShowEmojiGrid] = useState(false);
    const [actionSheetMsgId, setActionSheetMsgId] = useState<number | null>(null);
    const [identityExplanationMsgId, setIdentityExplanationMsgId] = useState<number | null>(null);
    const [anchoredInteractionComposerAnchor, setAnchoredInteractionComposerAnchor] = useState<AnchoredInteractionComposerAnchor | null>(null);
    const [tipTransferTarget, setTipTransferTarget] = useState<TipTransferTarget | null>(null);
    const [tipTransferError, setTipTransferError] = useState<string | null>(null);
    const [creatingTipTransfer, setCreatingTipTransfer] = useState(false);
    const [pendingInitialTipRecord, setPendingInitialTipRecord] = useState<PendingInitialTipRecord | null>(null);
    const [anchoredInteractionsById, setAnchoredInteractionsById] = useState<Record<string, DiscussionAnchoredInteractionDto>>({});
    const [creatingAnchoredInteraction, setCreatingAnchoredInteraction] = useState(false);
    const [anchoredInteractionPendingKey, setAnchoredInteractionPendingKey] = useState<string | null>(null);
    const [anchoredInteractionComposerError, setAnchoredInteractionComposerError] = useState<string | null>(null);
    const [anchoredInteractionCardError, setAnchoredInteractionCardError] = useState<{ interactionId: string; message: string } | null>(null);
    const [anchoredInteractionDetail, setAnchoredInteractionDetail] = useState<AnchoredInteractionDetailDto | null>(null);
    const [anchoredInteractionDetailLoadingId, setAnchoredInteractionDetailLoadingId] = useState<string | null>(null);
    const [anchoredInteractionDetailError, setAnchoredInteractionDetailError] = useState<string | null>(null);
    const [anchoredInteractionProjectionBaselineReady, setAnchoredInteractionProjectionBaselineReady] = useState(false);
    const [showAnchoredInteractionField, setShowAnchoredInteractionField] = useState(false);
    const [focusedAnchoredInteractionId, setFocusedAnchoredInteractionId] = useState<string | null>(null);
    const [announcements, setAnnouncements] = useState<CircleAnnouncementDetailDto[]>([]);
    const [announcementCapabilities, setAnnouncementCapabilities] = useState<CircleAnnouncementViewerCapabilities>({
        canPublish: false,
        canManage: false,
    });
    const [announcementLoading, setAnnouncementLoading] = useState(false);
    const [announcementError, setAnnouncementError] = useState<string | null>(null);
    const [showAnnouncementPublish, setShowAnnouncementPublish] = useState(false);
    const [showAnnouncementCenter, setShowAnnouncementCenter] = useState(false);
    const [showAnnouncementPanel, setShowAnnouncementPanel] = useState(false);
    const [announcementDetail, setAnnouncementDetail] = useState<CircleAnnouncementDetailDto | null>(null);
    const [announcementDetailLoadingId, setAnnouncementDetailLoadingId] = useState<string | null>(null);
    const [announcementActionBusy, setAnnouncementActionBusy] = useState<'mark-unread' | 'confirm' | null>(null);
    const [pendingTipReceiptsByInteractionId, setPendingTipReceiptsByInteractionId] = useState<Record<string, AnchoredAssetReceiptDraft>>({});
    const [replyTarget, setReplyTarget] = useState<{ author: string; preview: string; sourceEnvelopeId?: string | null } | null>(null);
    const [expandedReplyContextIds, setExpandedReplyContextIds] = useState<Set<number>>(new Set());
    const [replyQuoteMenu, setReplyQuoteMenu] = useState<{ key: string; quote: PlazaReplyQuote } | null>(null);
    const [expandedReplyQuoteKeys, setExpandedReplyQuoteKeys] = useState<Set<string>>(new Set());
    const [truncatedReplyQuoteKeys, setTruncatedReplyQuoteKeys] = useState<Set<string>>(new Set());
    const [expandedForwardBundleIds, setExpandedForwardBundleIds] = useState<Set<string>>(new Set());
    const [revealedDimmed, setRevealedDimmed] = useState<Set<number>>(new Set());
    const [showForwardPicker, setShowForwardPicker] = useState(false);
    const [forwardingMessageId, setForwardingMessageId] = useState<number | null>(null);
    const [sourceGroundedAskTarget, setSourceGroundedAskTarget] = useState<SourceGroundedAskTarget | null>(null);
    const [discussionStatus, setDiscussionStatus] = useState<string | null>(null);
    const [creatingCandidateDraftId, setCreatingCandidateDraftId] = useState<string | null>(null);
    const [creatingDiscussionDraft, setCreatingDiscussionDraft] = useState(false);
    const [messageSelectionMode, setMessageSelectionMode] = useState<PlazaMessageSelectionMode | null>(null);
    const [selectedMessageEnvelopeIds, setSelectedMessageEnvelopeIds] = useState<Set<string>>(new Set());
    const [messageSelectionError, setMessageSelectionError] = useState<string | null>(null);
    const [governanceCaseTitle, setGovernanceCaseTitle] = useState('');
    const [governanceRequestedDecision, setGovernanceRequestedDecision] = useState('');
    const [governanceCaseTemplate, setGovernanceCaseTemplate] = useState<GovernanceCaseTemplateDraft | null>(null);
    const [governanceCaseSuggestions, setGovernanceCaseSuggestions] = useState<GovernanceCaseIntakeSuggestion[]>([]);
    const [governanceCasePreflightAcknowledged, setGovernanceCasePreflightAcknowledged] = useState(false);
    const [governanceCaseRelationship, setGovernanceCaseRelationship] = useState<{
        kind: 'related' | 'supersedes';
        caseId: string;
    } | null>(null);
    const [governanceCaseRelationshipReason, setGovernanceCaseRelationshipReason] = useState('');
    const [showBatchForwardPicker, setShowBatchForwardPicker] = useState(false);
    const [pendingCandidateDraftIds, setPendingCandidateDraftIds] = useState<Set<string>>(new Set());
    const [cancelledCandidateIds, setCancelledCandidateIds] = useState<Set<string>>(new Set());
    const [composerLabels, setComposerLabels] = useState<AuthorAnnotationKind[]>([]);
    const [activeContentFilters, setActiveContentFilters] = useState<AuthorAnnotationKind[]>([]);
    const [dismissedAnchoredInteractionSuggestionKeys, setDismissedAnchoredInteractionSuggestionKeys] = useState<Set<string>>(new Set());
    const [convertedAnchoredInteractionSuggestionKeys, setConvertedAnchoredInteractionSuggestionKeys] = useState<Set<string>>(new Set());
    const [anchoredInteractionSuggestionDecisionOverrides, setAnchoredInteractionSuggestionDecisionOverrides] = useState<Map<string, InteractionSuggestionDecision>>(new Map());
    const [anchoredInteractionSuggestionStorageScope, setAnchoredInteractionSuggestionStorageScope] = useState<string | null>(null);
    const [showSuggestionPanel, setShowSuggestionPanel] = useState(false);
    const [anchoredInteractionSuggestionPanelSnapshot, setAnchoredInteractionSuggestionPanelSnapshot] = useState<AnchoredInteractionSuggestion[] | null>(null);
    const [focusedEnvelopeId, setFocusedEnvelopeId] = useState<string | null>(focusEnvelopeId || null);
    const [showComposerIdentityHint, setShowComposerIdentityHint] = useState(false);
    const [showFilterPanel, setShowFilterPanel] = useState(false);
    const textareaRef = useRef<HTMLTextAreaElement>(null);
    const chatMessagesRef = useRef<HTMLDivElement>(null);
    const messagesEndRef = useRef<HTMLDivElement>(null);
    const longPressTimers = useRef<Map<number, ReturnType<typeof setTimeout>>>(new Map());
    const longPressFired = useRef<Set<number>>(new Set());
    const gestureMoved = useRef<Set<number>>(new Set());
    const touchStartPos = useRef<Map<number, { x: number; y: number }>>(new Map());
    const replyQuoteLongPressTimers = useRef<Map<string, ReturnType<typeof setTimeout>>>(new Map());
    const replyQuoteLongPressFired = useRef<Set<string>>(new Set());
    const replyQuoteGestureMoved = useRef<Set<string>>(new Set());
    const replyQuoteStartPos = useRef<Map<string, { x: number; y: number }>>(new Map());
    const sessionBootstrapRef = useRef<Promise<string | null> | null>(null);
    const discussionRealtimeSubscriptionRef = useRef<DiscussionRealtimeSubscription | null>(null);
    const discussionSnapshotReadyRef = useRef(false);
    const discussionSnapshotLamportRef = useRef(0);
    const anchoredProjectionCursorRef = useRef(0);
    const focusedAnnouncementOpenedRef = useRef<string | null>(null);
    const voiceConnectionRef = useRef<LiveKitBrowserVoiceConnection | null>(null);
    const voiceProviderRef = useRef<LiveKitBrowserVoiceProvider | null>(null);
    const communicationVoiceSessionRef = useRef<CachedCommunicationVoiceSession | null>(null);
    const localMessagesRef = useRef<PlazaMessage[]>(messages);
    const manualDraftSelectionMode = messageSelectionMode === 'draft';
    const governanceCaseSelectionMode = messageSelectionMode === 'case';
    const shouldFollowLatestRef = useRef(true);
    const previousMessageCountRef = useRef(messages.length);
    const viewerCircleRole = viewerRole ?? (
        viewerSessionPubkey
            ? circleMembers?.find((member) => member.user.pubkey === viewerSessionPubkey)?.role
            : null
    );
    const viewerCanConfigureVoice = viewerIdentity === 'owner'
        || viewerIdentity === 'curator'
        || viewerCircleRole === 'Owner'
        || viewerCircleRole === 'Admin'
        || viewerCircleRole === 'Moderator';
    const viewerCanCreateManualDiscussionDraft = viewerIdentity === 'owner'
        || viewerIdentity === 'curator'
        || viewerCircleRole === 'Owner'
        || viewerCircleRole === 'Admin'
        || viewerCircleRole === 'Moderator';
    const viewerCanManageAnchoredInteractions = viewerCanConfigureVoice;
    const memberAvatarsByPubkey = useMemo(() => {
        return new Map((circleMembers || []).map((member) => [member.user.pubkey, {
            handle: member.user.handle,
            avatarUri: member.user.avatarUri ?? null,
        }]));
    }, [circleMembers]);
    const memberAvatarsByHandle = useMemo(() => {
        return new Map((circleMembers || []).map((member) => [member.user.handle.trim().toLowerCase(), {
            handle: member.user.handle,
            avatarUri: member.user.avatarUri ?? null,
        }]));
    }, [circleMembers]);
    const genericMemberLabel = t('messages.genericMember');
    const viewerDisplayLabel = useMemo(() => {
        if (!viewerSessionPubkey) return '';
        const member = circleMembers?.find((item) => item.user.pubkey === viewerSessionPubkey);
        const handle = typeof member?.user.handle === 'string' ? member.user.handle.trim() : '';
        const sessionDisplay = typeof sessionUser?.displayName === 'string' ? sessionUser.displayName.trim() : '';
        const sessionHandle = typeof sessionUser?.handle === 'string' ? sessionUser.handle.trim() : '';
        return handle || sessionDisplay || sessionHandle || genericMemberLabel;
    }, [circleMembers, genericMemberLabel, sessionUser?.displayName, sessionUser?.handle, viewerSessionPubkey]);
    const anchoredInteractionViewerDisplayName = viewerDisplayLabel;
    useEffect(() => {
        localMessagesRef.current = localMessages;
    }, [localMessages]);

    const updateFollowLatestState = useCallback(() => {
        const node = chatMessagesRef.current;
        if (!node) return;
        shouldFollowLatestRef.current = isPlazaScrolledNearBottom({
            scrollTop: node.scrollTop,
            clientHeight: node.clientHeight,
            scrollHeight: node.scrollHeight,
        });
    }, []);

    useEffect(() => {
        if (!viewerSessionPubkey) {
            setShowPanel(false);
            setShowEmojiGrid(false);
            setReplyTarget(null);
            setShowForwardPicker(false);
            setForwardingMessageId(null);
            setAnchoredInteractionComposerAnchor(null);
        }
    }, [viewerSessionPubkey]);

    useEffect(() => {
        const dismissedKey = `${anchoredInteractionSuggestionStorageBaseKey}:dismissed`;
        const convertedKey = `${anchoredInteractionSuggestionStorageBaseKey}:converted`;
        setDismissedAnchoredInteractionSuggestionKeys(readStringSetFromLocalStorage(dismissedKey));
        setConvertedAnchoredInteractionSuggestionKeys(readStringSetFromLocalStorage(convertedKey));
        setAnchoredInteractionSuggestionStorageScope(anchoredInteractionSuggestionStorageBaseKey);
    }, [anchoredInteractionSuggestionStorageBaseKey]);

    useEffect(() => {
        if (anchoredInteractionSuggestionStorageScope !== anchoredInteractionSuggestionStorageBaseKey) return;
        writeStringSetToLocalStorage(
            `${anchoredInteractionSuggestionStorageBaseKey}:dismissed`,
            dismissedAnchoredInteractionSuggestionKeys,
        );
    }, [
        anchoredInteractionSuggestionStorageBaseKey,
        anchoredInteractionSuggestionStorageScope,
        dismissedAnchoredInteractionSuggestionKeys,
    ]);

    useEffect(() => {
        if (anchoredInteractionSuggestionStorageScope !== anchoredInteractionSuggestionStorageBaseKey) return;
        writeStringSetToLocalStorage(
            `${anchoredInteractionSuggestionStorageBaseKey}:converted`,
            convertedAnchoredInteractionSuggestionKeys,
        );
    }, [
        anchoredInteractionSuggestionStorageBaseKey,
        anchoredInteractionSuggestionStorageScope,
        convertedAnchoredInteractionSuggestionKeys,
    ]);

    useEffect(() => {
        setFocusedEnvelopeId(focusEnvelopeId || null);
    }, [focusEnvelopeId]);

    useEffect(() => {
        if (!showPanel) {
            setShowEmojiGrid(false);
        }
    }, [showPanel]);

    useEffect(() => {
        if (!viewerSessionPubkey || !composerIdentityHint || chatInput.trim()) {
            setShowComposerIdentityHint(false);
        }
    }, [chatInput, composerIdentityHint, viewerSessionPubkey]);

    useEffect(() => {
        if (!showComposerIdentityHint || !composerIdentityHint) {
            return undefined;
        }
        const timeoutId = window.setTimeout(() => {
            setShowComposerIdentityHint(false);
        }, COMPOSER_HINT_AUTO_HIDE_MS);
        return () => window.clearTimeout(timeoutId);
    }, [composerIdentityHint, showComposerIdentityHint]);

    const discussionSessionStorageKey = useMemo(
        () => (viewerSessionPubkey ? `alcheme_discussion_session_${viewerSessionPubkey}` : null),
        [viewerSessionPubkey],
    );
    const communicationRoomKey = useMemo(
        () => `circle:${discussionCircleId}`,
        [discussionCircleId],
    );

    const revealDimmedMessage = useCallback((msgId: number) => {
        setRevealedDimmed((prev) => {
            if (prev.has(msgId)) return prev;
            const next = new Set(prev);
            next.add(msgId);
            return next;
        });
    }, []);

    const persistDiscussionSession = useCallback((session: DiscussionSessionState | null) => {
        if (typeof window === 'undefined') return;
        if (!discussionSessionStorageKey) return;
        try {
            if (!session) {
                localStorage.removeItem(discussionSessionStorageKey);
                return;
            }
            localStorage.setItem(discussionSessionStorageKey, JSON.stringify(session));
        } catch {
            // ignore storage failures
        }
    }, [discussionSessionStorageKey]);

    useEffect(() => {
        if (typeof window === 'undefined') return;
        if (!discussionSessionStorageKey) {
            setDiscussionSession(null);
            return;
        }
        let raw: string | null = null;
        try {
            raw = localStorage.getItem(discussionSessionStorageKey);
        } catch {
            setDiscussionSession(null);
            return;
        }
        if (!raw) {
            setDiscussionSession(null);
            return;
        }
        try {
            const parsed = JSON.parse(raw) as DiscussionSessionState;
            const expiresAtMs = Date.parse(parsed.expiresAt);
            if (!Number.isFinite(expiresAtMs) || expiresAtMs <= Date.now() || parsed.senderPubkey !== viewerSessionPubkey) {
                try {
                    localStorage.removeItem(discussionSessionStorageKey);
                } catch {
                    // ignore
                }
                setDiscussionSession(null);
                return;
            }
            setDiscussionSession(parsed);
        } catch {
            try {
                localStorage.removeItem(discussionSessionStorageKey);
            } catch {
                // ignore
            }
            setDiscussionSession(null);
        }
    }, [discussionSessionStorageKey, viewerSessionPubkey]);

    const resetDiscussionSession = useCallback(() => {
        setDiscussionSession(null);
        persistDiscussionSession(null);
    }, [persistDiscussionSession]);

    const ensureDiscussionSessionToken = useCallback(async (
        options: DiscussionSessionTokenOptions = {},
    ): Promise<string | null> => {
        if (!useSessionTokenAuth) return null;
        if (!viewerHasRegisteredIdentity || !viewerSessionPubkey) throw new Error(viewerIdentityWriteError);

        const current = options.forceNew ? null : discussionSession;
        const now = Date.now();
        const expiresAtMs = current ? Date.parse(current.expiresAt) : 0;
        const isUsableCurrent =
            !!current
            && current.senderPubkey === viewerSessionPubkey
            && Number.isFinite(expiresAtMs)
            && expiresAtMs - now > 60_000;
        if (isUsableCurrent) {
            return current.discussionAccessToken;
        }

        if (sessionBootstrapRef.current && !options.forceNew) {
            return sessionBootstrapRef.current;
        }

        const bootstrapPromise = (async () => {
            if (
                current
                && current.sessionId
                && current.senderPubkey === viewerSessionPubkey
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
                    setDiscussionSession(nextSession);
                    persistDiscussionSession(nextSession);
                    return nextSession.discussionAccessToken;
                } catch {
                    // refresh failure falls through to create session
                }
            }

            const created = await createDiscussionSession({
                senderHandle: viewerDisplayLabel,
                scope: 'circle:*',
                clientMeta: {
                    circleId: discussionCircleId,
                    source: 'frontend_plaza',
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
            setDiscussionSession(nextSession);
            persistDiscussionSession(nextSession);
            return nextSession.discussionAccessToken;
        })();

        sessionBootstrapRef.current = bootstrapPromise;
        try {
            return await bootstrapPromise;
        } finally {
            sessionBootstrapRef.current = null;
        }
    }, [
        discussionCircleId,
        discussionSession,
        persistDiscussionSession,
        t,
        useSessionTokenAuth,
        viewerDisplayLabel,
        viewerHasRegisteredIdentity,
        viewerIdentityWriteError,
        viewerSessionPubkey,
    ]);

    const getVoiceProvider = useCallback((): LiveKitBrowserVoiceProvider => {
        if (!voiceProviderRef.current) {
            voiceProviderRef.current = createLiveKitBrowserVoiceProvider();
        }
        return voiceProviderRef.current;
    }, []);

    const updateVoiceParticipantCount = useCallback(() => {
        const participants = voiceConnectionRef.current?.getParticipants() ?? [];
        setVoiceParticipantCount(participants.length);
    }, []);

    const applyCircleRoomVoicePolicy = useCallback((policy?: CircleRoomVoicePolicy | null): boolean => {
        if (!policy) return false;
        setVoicePolicyMaxSpeakers(policy.maxSpeakers);
        if (VOICE_OVERFLOW_STRATEGIES.includes(policy.overflowStrategy as VoiceOverflowStrategy)) {
            setVoicePolicyStrategy(policy.overflowStrategy as VoiceOverflowStrategy);
        }
        setVoicePolicyDirty(false);
        setVoicePolicyLoaded(true);
        return true;
    }, []);

    const ensureCommunicationVoiceSessionToken = useCallback(async (
        options: { forceRefresh?: boolean } = {},
    ): Promise<string> => {
        if (!viewerHasRegisteredIdentity || !viewerSessionPubkey) {
            throw new Error(viewerIdentityWriteError);
        }
        if (!viewerJoined) {
            throw new Error(t('voice.membershipRequired'));
        }
        const current = communicationVoiceSessionRef.current;
        const expiresAtMs = current ? Date.parse(current.expiresAt) : 0;
        if (
            current
            && current.walletPubkey === viewerSessionPubkey
            && current.roomKey === communicationRoomKey
            && !options.forceRefresh
            && Number.isFinite(expiresAtMs)
            && expiresAtMs - Date.now() > 60_000
        ) {
            return current.communicationAccessToken;
        }

        const created = await ensureCircleCommunicationRoomSession({
            circleId: discussionCircleId,
            clientMeta: {
                circleId: discussionCircleId,
                source: 'frontend_plaza_voice',
                userAgent: typeof navigator !== 'undefined' ? navigator.userAgent : 'unknown',
            },
        });
        const nextSession: CachedCommunicationVoiceSession = {
            roomKey: created.scopeRef,
            walletPubkey: created.walletPubkey,
            communicationAccessToken: created.communicationAccessToken,
            expiresAt: created.expiresAt,
        };
        communicationVoiceSessionRef.current = nextSession;
        applyCircleRoomVoicePolicy(created.room?.metadata?.voicePolicy);
        return nextSession.communicationAccessToken;
    }, [
        applyCircleRoomVoicePolicy,
        communicationRoomKey,
        discussionCircleId,
        t,
        viewerHasRegisteredIdentity,
        viewerIdentityWriteError,
        viewerJoined,
        viewerSessionPubkey,
    ]);

    const loadVoiceParticipants = useCallback(async (
        voiceSessionId: string,
        communicationSessionToken: string,
    ): Promise<VoiceParticipantsResponse> => {
        const next = await fetchVoiceParticipants({
            voiceSessionId,
            communicationSessionToken,
        });
        setVoiceManagement(next);
        setVoiceParticipantCount(Math.max(next.participants.filter((participant) => !participant.leftAt).length, 1));
        return next;
    }, []);

    const handleLeaveVoice = useCallback(async () => {
        const currentConnection = voiceConnectionRef.current;
        if (!currentConnection) {
            setVoiceStatus('idle');
            setVoiceError(null);
            setVoiceMuted(false);
            setVoiceCanPublishAudio(true);
            setVoiceParticipantCount(0);
            setActiveVoiceSessionId(null);
            setVoiceManagement(null);
            return;
        }

        setVoiceStatus('leaving');
        try {
            await currentConnection.leave();
        } finally {
            if (voiceConnectionRef.current === currentConnection) {
                voiceConnectionRef.current = null;
            }
            setVoiceStatus('idle');
            setVoiceError(null);
            setVoiceMuted(false);
            setVoiceCanPublishAudio(true);
            setVoiceParticipantCount(0);
            setActiveVoiceSessionId(null);
            setVoiceManagement(null);
        }
    }, []);

    const handleJoinVoice = useCallback(async () => {
        if (voiceStatus === 'joining' || voiceStatus === 'leaving' || voiceConnectionRef.current) {
            return;
        }
        setVoiceStatus('joining');
        setVoiceError(null);
        try {
            const communicationSessionToken = await ensureCommunicationVoiceSessionToken();
            const voiceSession = await createVoiceSession({
                roomKey: communicationRoomKey,
                communicationSessionToken,
                metadata: {
                    circleId: discussionCircleId,
                    source: 'frontend_plaza',
                },
            });
            const token = await createVoiceToken({
                voiceSessionId: voiceSession.id,
                communicationSessionToken,
            });
            await loadVoiceParticipants(voiceSession.id, communicationSessionToken).catch(() => null);
            const connection = await getVoiceProvider().join({
                ...token,
                onParticipantsChanged: updateVoiceParticipantCount,
            });

            voiceConnectionRef.current = connection;
            setActiveVoiceSessionId(voiceSession.id);
            setVoiceCanPublishAudio(token.canPublishAudio);
            setVoiceMuted(!token.canPublishAudio);
            setVoiceStatus('connected');
            setShowPanel(false);
            setVoiceParticipantCount(connection.getParticipants().length);
        } catch (error) {
            const failedConnection = voiceConnectionRef.current;
            voiceConnectionRef.current = null;
            if (failedConnection) {
                await failedConnection.leave().catch(() => undefined);
            }
            setVoiceStatus('error');
            setVoiceParticipantCount(0);
            setActiveVoiceSessionId(null);
            setVoiceManagement(null);
            setVoiceCanPublishAudio(true);
            setVoiceMuted(false);
            setVoiceError(error instanceof Error ? error.message : t('voice.joinFailed'));
        }
    }, [
        communicationRoomKey,
        discussionCircleId,
        ensureCommunicationVoiceSessionToken,
        getVoiceProvider,
        loadVoiceParticipants,
        t,
        updateVoiceParticipantCount,
        voiceStatus,
    ]);

    const handleToggleVoiceMute = useCallback(async () => {
        const currentConnection = voiceConnectionRef.current;
        if (!currentConnection) {
            await handleJoinVoice();
            return;
        }
        if (!voiceCanPublishAudio) {
            return;
        }
        const nextMuted = !voiceMuted;
        await currentConnection.setMicrophoneMuted(nextMuted);
        setVoiceMuted(nextMuted);
        updateVoiceParticipantCount();
    }, [
        handleJoinVoice,
        updateVoiceParticipantCount,
        voiceCanPublishAudio,
        voiceMuted,
    ]);

    const handleVoiceSpeakerDecision = useCallback(async (
        targetWalletPubkey: string,
        decision: 'approve' | 'deny',
    ) => {
        if (!activeVoiceSessionId) return;
        setVoiceManagementBusyWallet(targetWalletPubkey);
        setVoiceError(null);
        try {
            const communicationSessionToken = await ensureCommunicationVoiceSessionToken();
            const input = {
                voiceSessionId: activeVoiceSessionId,
                walletPubkey: targetWalletPubkey,
                communicationSessionToken,
            };
            if (decision === 'approve') {
                await approveVoiceSpeaker(input);
            } else {
                await denyVoiceSpeaker(input);
            }
            await loadVoiceParticipants(activeVoiceSessionId, communicationSessionToken);
        } catch (error) {
            setVoiceError(error instanceof Error ? error.message : t('voice.joinFailed'));
        } finally {
            setVoiceManagementBusyWallet(null);
        }
    }, [
        activeVoiceSessionId,
        ensureCommunicationVoiceSessionToken,
        loadVoiceParticipants,
        t,
    ]);

    const handleSaveVoicePolicy = useCallback(async () => {
        setVoicePolicySaving(true);
        setVoiceError(null);
        try {
            const needsPolicyLoad = !voicePolicyLoaded && !voicePolicyDirty;
            const communicationSessionToken = await ensureCommunicationVoiceSessionToken({
                forceRefresh: needsPolicyLoad,
            });
            if (needsPolicyLoad) {
                setVoiceError(t('voice.policyLoaded'));
                return;
            }
            const response = await updateCircleRoomVoicePolicy({
                circleId: discussionCircleId,
                communicationSessionToken,
                maxSpeakers: voicePolicyMaxSpeakers,
                overflowStrategy: voicePolicyStrategy,
            });
            const updatedPolicy = response.room.metadata?.voicePolicy;
            if (updatedPolicy) {
                applyCircleRoomVoicePolicy(updatedPolicy);
            }
            if (activeVoiceSessionId) {
                await loadVoiceParticipants(activeVoiceSessionId, communicationSessionToken).catch(() => null);
            }
        } catch (error) {
            setVoiceError(error instanceof Error ? error.message : t('voice.joinFailed'));
        } finally {
            setVoicePolicySaving(false);
        }
    }, [
        activeVoiceSessionId,
        applyCircleRoomVoicePolicy,
        discussionCircleId,
        ensureCommunicationVoiceSessionToken,
        loadVoiceParticipants,
        t,
        voicePolicyDirty,
        voicePolicyLoaded,
        voicePolicyMaxSpeakers,
        voicePolicyStrategy,
    ]);

    useEffect(() => {
        if (voiceStatus !== 'connected' || !activeVoiceSessionId || !showPanel) {
            return undefined;
        }
        let cancelled = false;
        const refresh = async () => {
            try {
                const communicationSessionToken = await ensureCommunicationVoiceSessionToken();
                if (cancelled) return;
                await loadVoiceParticipants(activeVoiceSessionId, communicationSessionToken);
            } catch {
                // Voice management polling is opportunistic; joining state remains authoritative.
            }
        };
        void refresh();
        const intervalId = window.setInterval(refresh, 7000);
        return () => {
            cancelled = true;
            window.clearInterval(intervalId);
        };
    }, [
        activeVoiceSessionId,
        ensureCommunicationVoiceSessionToken,
        loadVoiceParticipants,
        showPanel,
        voiceStatus,
    ]);

    useEffect(() => {
        if (!showPanel || !viewerJoined || !viewerSessionPubkey || !viewerCanConfigureVoice || voicePolicyLoaded) {
            return undefined;
        }
        let cancelled = false;
        const loadPolicy = async () => {
            try {
                await ensureCommunicationVoiceSessionToken({ forceRefresh: true });
                if (!cancelled) {
                    setVoiceError(null);
                }
            } catch (error) {
                if (!cancelled) {
                    setVoiceError(error instanceof Error ? error.message : t('voice.joinFailed'));
                }
            }
        };
        void loadPolicy();
        return () => {
            cancelled = true;
        };
    }, [
        ensureCommunicationVoiceSessionToken,
        showPanel,
        t,
        viewerCanConfigureVoice,
        viewerJoined,
        voicePolicyLoaded,
        viewerSessionPubkey,
    ]);

    useEffect(() => {
        return () => {
            const currentConnection = voiceConnectionRef.current;
            voiceConnectionRef.current = null;
            communicationVoiceSessionRef.current = null;
            void currentConnection?.leave();
        };
    }, [communicationRoomKey, viewerSessionPubkey]);

    useEffect(() => {
        communicationVoiceSessionRef.current = null;
        setVoiceStatus('idle');
        setVoiceError(null);
        setVoiceMuted(false);
        setVoiceCanPublishAudio(true);
        setVoiceParticipantCount(0);
        setActiveVoiceSessionId(null);
        setVoiceManagement(null);
        setVoicePolicyDirty(false);
        setVoicePolicyLoaded(false);
    }, [communicationRoomKey, viewerSessionPubkey]);

    useEffect(() => {
        if (!voiceManagement || voicePolicyDirty) return;
        applyCircleRoomVoicePolicy({
            maxSpeakers: voiceManagement.policy.maxSpeakers,
            overflowStrategy: voiceManagement.policy.strategy,
        });
    }, [applyCircleRoomVoicePolicy, voiceManagement, voicePolicyDirty]);

    useEffect(() => {
        // Intentionally only react to circle changes. `messages` prop is re-created
        // on parent rerenders and would otherwise keep resetting live discussion state.
        const fallbackMessages = messages.map((m) => ({ ...m, sendState: m.sendState || 'sent' as const }));
        setLocalMessages(fallbackMessages);
        setUsefulCounts(buildUsefulCountMap(fallbackMessages));
        setUsefulMarkedIds(buildUsefulMarkedIdSet(fallbackMessages));
        setLastEnvelopeId(null);
        setDiscussionError(null);
        setRevealedDimmed(new Set());
        setShowPanel(false);
        setShowEmojiGrid(false);
        setReplyTarget(null);
        setShowForwardPicker(false);
        setForwardingMessageId(null);
        setDiscussionStatus(null);
        setFocusedEnvelopeId(focusEnvelopeId || null);
        setAnchoredInteractionsById({});
        anchoredProjectionCursorRef.current = 0;
        setAnchoredInteractionProjectionBaselineReady(false);
        setAnchoredInteractionComposerAnchor(null);
        setTipTransferTarget(null);
        setTipTransferError(null);
        setPendingInitialTipRecord(null);
        setAnchoredInteractionComposerError(null);
        setAnchoredInteractionCardError(null);
        setAnchoredInteractionDetail(null);
        setAnchoredInteractionDetailLoadingId(null);
        setAnchoredInteractionDetailError(null);
        setShowAnchoredInteractionField(false);
        setAnnouncements([]);
        setAnnouncementCapabilities({ canPublish: false, canManage: false });
        setAnnouncementLoading(false);
        setAnnouncementError(null);
        setShowAnnouncementPublish(false);
        setShowAnnouncementCenter(false);
        setAnnouncementDetail(null);
        setAnnouncementDetailLoadingId(null);
        setAnnouncementActionBusy(null);
        focusedAnnouncementOpenedRef.current = null;
        setPendingTipReceiptsByInteractionId({});
        setShowSuggestionPanel(false);
        setAnchoredInteractionSuggestionPanelSnapshot(null);
        shouldFollowLatestRef.current = true;
        previousMessageCountRef.current = fallbackMessages.length;
    }, [discussionCircleId, focusEnvelopeId]);

    const mapDiscussionMessagesToPlaza = useCallback((messagesToMap: Parameters<typeof mapDiscussionDtoToPlazaMessage>[0][]) => (
        dedupePlazaMessagesByEnvelope(
            messagesToMap.map((message) => mapDiscussionDtoToPlazaMessage(message, {
                locale,
                deletedText: t('messages.deleted'),
            })),
        )
    ), [locale, t]);

    const extractLatestEnvelopeId = useCallback((messageList: PlazaMessage[]): string | null => {
        for (let index = messageList.length - 1; index >= 0; index -= 1) {
            const envelopeId = String(messageList[index]?.envelopeId || '').trim();
            if (envelopeId) return envelopeId;
        }
        return null;
    }, []);

    const extractLatestLamport = useCallback((messageList: PlazaMessage[]): number =>
        extractDiscussionRealtimeLamport(messageList), []);

    const extractRefreshableEnvelopeIds = useCallback((messageList: PlazaMessage[]): string[] => {
        const envelopeIds: string[] = [];
        const seen = new Set<string>();
        for (let index = messageList.length - 1; index >= 0; index -= 1) {
            const message = messageList[index];
            const envelopeId = typeof message?.envelopeId === 'string'
                ? message.envelopeId.trim()
                : '';
            if (!envelopeId || seen.has(envelopeId)) continue;
            seen.add(envelopeId);
            envelopeIds.push(envelopeId);
        }
        return envelopeIds;
    }, []);

    const commitDiscussionMessages = useCallback((nextMessages: PlazaMessage[]) => {
        if (nextMessages === localMessagesRef.current) {
            return;
        }
        localMessagesRef.current = nextMessages;
        setLocalMessages(nextMessages);
        setUsefulCounts(buildUsefulCountMap(nextMessages));
        setUsefulMarkedIds(buildUsefulMarkedIdSet(nextMessages));
        setLastEnvelopeId(extractLatestEnvelopeId(nextMessages));
    }, [extractLatestEnvelopeId]);

    const applyDiscussionSnapshot = useCallback((response: Awaited<ReturnType<typeof fetchDiscussionMessages>>) => {
        const mappedServerMessages = mapDiscussionMessagesToPlaza(response.messages);
        const mergedMessages = syncPlazaDiscussionMessagesSnapshot({
            currentMessages: localMessagesRef.current,
            serverMessages: mappedServerMessages,
        });
        commitDiscussionMessages(mergedMessages);
        setDiscussionError(null);
    }, [commitDiscussionMessages, mapDiscussionMessagesToPlaza]);

    const applyDiscussionCatchUp = useCallback((response: Awaited<ReturnType<typeof fetchDiscussionMessages>>) => {
        const mappedServerMessages = mapDiscussionMessagesToPlaza(response.messages);
        const nextMessages = appendPlazaDiscussionMessages({
            currentMessages: localMessagesRef.current,
            appendedMessages: mappedServerMessages,
        });
        commitDiscussionMessages(nextMessages);
        setDiscussionError(null);
    }, [commitDiscussionMessages, mapDiscussionMessagesToPlaza]);

    const applyDiscussionTargetedRefresh = useCallback((response: Awaited<ReturnType<typeof fetchDiscussionMessagesByEnvelopeIds>>) => {
        const mappedServerMessages = mapDiscussionMessagesToPlaza(response.messages);
        const nextMessages = refreshPlazaMessagesByEnvelope({
            currentMessages: localMessagesRef.current,
            refreshedMessages: mappedServerMessages,
        });
        commitDiscussionMessages(nextMessages);
        setDiscussionError(null);
    }, [commitDiscussionMessages, mapDiscussionMessagesToPlaza]);

    const reconcileSentDustMessageIfNeeded = useCallback((message: PlazaMessage) => {
        if (!shouldReconcileViewerDustMessage({ viewerJoined, message })) {
            return;
        }
        const envelopeId = String(message.envelopeId || '').trim();
        void (async () => {
            try {
                await onReconcileViewerMembership?.();
                const response = await fetchDiscussionMessagesByEnvelopeIds({
                    circleId: discussionCircleId,
                    envelopeIds: [envelopeId],
                    includeDeleted: true,
                });
                applyDiscussionTargetedRefresh(response);
            } catch {
                // The message was already sent; reconciliation is best-effort and
                // the realtime catch-up path will still refresh it when available.
            }
        })();
    }, [
        applyDiscussionTargetedRefresh,
        discussionCircleId,
        onReconcileViewerMembership,
        viewerJoined,
    ]);

    const applyAnchoredInteractionProjectionResponse = useCallback((response: {
        interactions?: DiscussionAnchoredInteractionDto[];
        watermark?: { lastProjectionCursor?: number | null } | null;
    }) => {
        const interactions = Array.isArray(response.interactions) ? response.interactions : [];
        if (interactions.length > 0) {
            setAnchoredInteractionsById((prev) => {
                let changed = false;
                const next = { ...prev };
                for (const interaction of interactions) {
                    if (!isIncomingAnchoredInteractionNewer(interaction, next[interaction.interactionId])) {
                        continue;
                    }
                    next[interaction.interactionId] = interaction;
                    changed = true;
                }
                return changed ? next : prev;
            });
        }
        const responseCursor = typeof response.watermark?.lastProjectionCursor === 'number'
            ? response.watermark.lastProjectionCursor
            : interactions.length > 0
                ? Math.max(...interactions.map((interaction) => interaction.projectionCursor))
                : null;
        if (typeof responseCursor === 'number' && Number.isFinite(responseCursor)) {
            const nextCursor = Math.max(anchoredProjectionCursorRef.current, Math.trunc(responseCursor));
            anchoredProjectionCursorRef.current = nextCursor;
        }
    }, []);

    const upsertAnchoredInteraction = useCallback((interaction: DiscussionAnchoredInteractionDto) => {
        applyAnchoredInteractionProjectionResponse({
            interactions: [interaction],
            watermark: { lastProjectionCursor: interaction.projectionCursor },
        });
    }, [applyAnchoredInteractionProjectionResponse]);

    const upsertAnnouncementProjection = useCallback((announcement: CircleAnnouncementDetailDto) => {
        setAnnouncements((prev) => {
            const withoutCurrent = prev.filter((item) => item.announcementId !== announcement.announcementId);
            return sortCircleAnnouncements([...withoutCurrent, announcement]);
        });
        setAnnouncementCapabilities(announcement.viewerCapabilities);
        setAnnouncementDetail((current) => (
            current?.announcementId === announcement.announcementId ? announcement : current
        ));
    }, []);

    const refreshAnnouncements = useCallback(async () => {
        if (!viewerSessionPubkey || !viewerJoined || !Number.isFinite(discussionCircleId) || discussionCircleId <= 0) {
            setAnnouncements([]);
            setAnnouncementCapabilities({ canPublish: false, canManage: false });
            return null;
        }
        const token = await ensureDiscussionSessionToken();
        const response = await fetchCircleAnnouncements({
            circleId: discussionCircleId,
            senderPubkey: viewerSessionPubkey,
            discussionAccessToken: token,
        });
        setAnnouncements(sortCircleAnnouncements(response.announcements));
        setAnnouncementCapabilities(response.viewerCapabilities);
        setAnnouncementError(null);
        return response;
    }, [discussionCircleId, ensureDiscussionSessionToken, viewerJoined, viewerSessionPubkey]);

    const markAnnouncementSeenNow = useCallback(async (announcementId: string) => {
        if (!viewerSessionPubkey) return null;
        const token = await ensureDiscussionSessionToken();
        const response = await markCircleAnnouncementSeen({
            circleId: discussionCircleId,
            announcementId,
            senderPubkey: viewerSessionPubkey,
            discussionAccessToken: token,
        });
        upsertAnnouncementProjection(response.announcement);
        return response.announcement;
    }, [discussionCircleId, ensureDiscussionSessionToken, upsertAnnouncementProjection, viewerSessionPubkey]);

    const handleOpenAnnouncementDetail = useCallback(async (announcementId: string) => {
        if (!announcementId || !viewerSessionPubkey) return;
        const localAnnouncement = announcements.find((item) => item.announcementId === announcementId) ?? null;
        if (localAnnouncement) {
            setAnnouncementDetail(localAnnouncement);
        }
        setAnnouncementDetailLoadingId(announcementId);
        setShowAnnouncementCenter(false);
        setAnnouncementError(null);
        try {
            const token = await ensureDiscussionSessionToken();
            const detail = await fetchCircleAnnouncementDetail({
                circleId: discussionCircleId,
                announcementId,
                senderPubkey: viewerSessionPubkey,
                discussionAccessToken: token,
            });
            upsertAnnouncementProjection(detail);
            setAnnouncementDetail(detail);
            await markAnnouncementSeenNow(announcementId);
        } catch (error) {
            setAnnouncementError(error instanceof Error ? error.message : 'announcement_detail_failed');
        } finally {
            setAnnouncementDetailLoadingId(null);
        }
    }, [
        announcements,
        discussionCircleId,
        ensureDiscussionSessionToken,
        markAnnouncementSeenNow,
        upsertAnnouncementProjection,
        viewerSessionPubkey,
    ]);

    const handleAnnouncementSeen = useCallback((announcement: CircleAnnouncementDetailDto) => {
        upsertAnnouncementProjection(announcement);
    }, [upsertAnnouncementProjection]);

    const handleMarkAnnouncementUnread = useCallback(async (announcementId: string) => {
        if (!viewerSessionPubkey) return;
        setAnnouncementActionBusy('mark-unread');
        setAnnouncementError(null);
        try {
            const token = await ensureDiscussionSessionToken();
            const response = await markCircleAnnouncementUnread({
                circleId: discussionCircleId,
                announcementId,
                senderPubkey: viewerSessionPubkey,
                discussionAccessToken: token,
            });
            upsertAnnouncementProjection(response.announcement);
        } catch (error) {
            setAnnouncementError(error instanceof Error ? error.message : 'announcement_mark_unread_failed');
        } finally {
            setAnnouncementActionBusy(null);
        }
    }, [discussionCircleId, ensureDiscussionSessionToken, upsertAnnouncementProjection, viewerSessionPubkey]);

    const handleConfirmAnnouncement = useCallback(async (announcementId: string) => {
        if (!viewerSessionPubkey) return;
        setAnnouncementActionBusy('confirm');
        setAnnouncementError(null);
        try {
            const token = await ensureDiscussionSessionToken();
            const response = await confirmCircleAnnouncement({
                circleId: discussionCircleId,
                announcementId,
                senderPubkey: viewerSessionPubkey,
                discussionAccessToken: token,
                confirmationText: announcementCopy.confirm,
            });
            upsertAnnouncementProjection(response.announcement);
        } catch (error) {
            setAnnouncementError(error instanceof Error ? error.message : 'announcement_confirm_failed');
        } finally {
            setAnnouncementActionBusy(null);
        }
    }, [announcementCopy.confirm, discussionCircleId, ensureDiscussionSessionToken, upsertAnnouncementProjection, viewerSessionPubkey]);

    const ensureDiscussionEnvelopeVisible = useCallback(async (envelopeId: string): Promise<boolean> => {
        const normalizedEnvelopeId = String(envelopeId || '').trim();
        if (!normalizedEnvelopeId) return false;
        if (localMessagesRef.current.some((message) => message.envelopeId === normalizedEnvelopeId)) {
            return true;
        }
        const response = await fetchDiscussionMessagesByEnvelopeIds({
            circleId: discussionCircleId,
            envelopeIds: [normalizedEnvelopeId],
            includeDeleted: true,
        });
        const mappedMessages = mapDiscussionMessagesToPlaza(response.messages);
        if (!mappedMessages.some((message) => message.envelopeId === normalizedEnvelopeId)) {
            return false;
        }
        commitDiscussionMessages(mergePlazaDiscussionMessages({
            serverMessages: [...localMessagesRef.current, ...mappedMessages],
            optimisticMessages: [],
        }));
        return true;
    }, [commitDiscussionMessages, discussionCircleId, mapDiscussionMessagesToPlaza]);

    const handleOpenAnnouncementDiscussionRoot = useCallback((envelopeId: string) => {
        const normalizedEnvelopeId = String(envelopeId || '').trim();
        if (!normalizedEnvelopeId) return;
        setAnnouncementDetail(null);
        setShowAnnouncementCenter(false);
        setActiveContentFilters([]);
        setViewMode('all');
        void ensureDiscussionEnvelopeVisible(normalizedEnvelopeId)
            .then((visible) => {
                if (visible) {
                    setFocusedEnvelopeId(normalizedEnvelopeId);
                }
            })
            .catch((error) => {
                setDiscussionError(error instanceof Error ? error.message : t('errors.syncFailed'));
            });
    }, [ensureDiscussionEnvelopeVisible, t]);

    const handleAnnouncementPublished = useCallback(async (announcement: CircleAnnouncementDetailDto) => {
        upsertAnnouncementProjection(announcement);
        await Promise.all([
            refreshAnnouncements().catch(() => null),
            fetchDiscussionMessages({
                circleId: discussionCircleId,
                limit: DISCUSSION_SYNC_LIMIT,
            }).then(applyDiscussionSnapshot).catch(() => null),
        ]);
        setDiscussionStatus(t('announcements.published'));
    }, [applyDiscussionSnapshot, discussionCircleId, refreshAnnouncements, t, upsertAnnouncementProjection]);

    useEffect(() => {
        let cancelled = false;
        discussionSnapshotReadyRef.current = false;
        discussionSnapshotLamportRef.current = 0;
        setDiscussionSnapshotVersion((version) => version + 1);

        async function loadDiscussionMessages() {
            if (!Number.isFinite(discussionCircleId) || discussionCircleId <= 0) {
                return;
            }

            setDiscussionLoading(true);
            try {
                const [response, anchoredInteractionResponse] = await Promise.all([
                    fetchDiscussionMessages({
                        circleId: discussionCircleId,
                        limit: DISCUSSION_SYNC_LIMIT,
                    }),
                    fetchAnchoredInteractions({
                        circleId: discussionCircleId,
                        limit: DISCUSSION_SYNC_LIMIT,
                    }),
                ]);
                if (cancelled) return;

                applyDiscussionSnapshot(response);
                applyAnchoredInteractionProjectionResponse(anchoredInteractionResponse);
                setAnchoredInteractionProjectionBaselineReady(true);
                discussionSnapshotLamportRef.current = resolveDiscussionSnapshotLamport(response);
                discussionSnapshotReadyRef.current = true;
                setDiscussionSnapshotVersion((version) => version + 1);
            } catch (error) {
                if (cancelled) return;
                discussionSnapshotReadyRef.current = false;
                discussionSnapshotLamportRef.current = 0;
                setAnchoredInteractionProjectionBaselineReady(false);
                setDiscussionSnapshotVersion((version) => version + 1);
                setDiscussionError(error instanceof Error ? error.message : t('errors.loadFailed'));
            } finally {
                if (!cancelled) setDiscussionLoading(false);
            }
        }

        loadDiscussionMessages();

        return () => {
            cancelled = true;
        };
    }, [applyAnchoredInteractionProjectionResponse, applyDiscussionSnapshot, discussionCircleId, t]);

    useEffect(() => {
        let cancelled = false;
        if (!viewerSessionPubkey || !viewerJoined || !Number.isFinite(discussionCircleId) || discussionCircleId <= 0) {
            setAnnouncements([]);
            setAnnouncementCapabilities({ canPublish: false, canManage: false });
            setAnnouncementLoading(false);
            return undefined;
        }
        setAnnouncementLoading(true);
        void refreshAnnouncements()
            .catch((error) => {
                if (!cancelled) {
                    setAnnouncements([]);
                    setAnnouncementCapabilities({ canPublish: false, canManage: false });
                    setAnnouncementError(error instanceof Error ? error.message : 'announcement_load_failed');
                }
            })
            .finally(() => {
                if (!cancelled) setAnnouncementLoading(false);
            });
        return () => {
            cancelled = true;
        };
    }, [discussionCircleId, refreshAnnouncements, viewerJoined, viewerSessionPubkey]);

    useEffect(() => {
        if (!Number.isFinite(discussionCircleId) || discussionCircleId <= 0) {
            return;
        }
        if (!discussionSnapshotReadyRef.current) {
            return;
        }

        let cancelled = false;
        let handleVisibilityChange: (() => void) | null = null;

        async function startRealtime() {
            try {
                const baseUrl = await getDiscussionProtocolBaseUrl();
                if (cancelled) return;
                const streamAfterLamport = extractLatestLamport(localMessagesRef.current);
                const streamQuery = new URLSearchParams({
                    afterLamport: String(Math.max(0, streamAfterLamport)),
                    locale,
                });

                const subscription = subscribeToCircleDiscussionRealtime({
                    circleId: discussionCircleId,
                    streamUrl: `${baseUrl}/api/v1/discussion/circles/${discussionCircleId}/stream?${streamQuery.toString()}`,
                    fetchCatchUp: (afterLamport) => fetchDiscussionMessages({
                        circleId: discussionCircleId,
                        limit: DISCUSSION_SYNC_LIMIT,
                        afterLamport,
                    }),
                    fetchTargetedRefresh: (envelopeIds) => fetchDiscussionMessagesByEnvelopeIds({
                        circleId: discussionCircleId,
                        envelopeIds,
                        includeDeleted: true,
                    }),
                    fetchInteractionRefresh: (interactionIds) => lookupAnchoredInteractions({
                        circleId: discussionCircleId,
                        interactionIds,
                    }),
                    fetchInteractionCatchUp: (afterProjectionCursor) => fetchAnchoredInteractions({
                        circleId: discussionCircleId,
                        afterProjectionCursor,
                        limit: DISCUSSION_SYNC_LIMIT,
                    }),
                    fetchAnnouncementRefresh: async () => {
                        await refreshAnnouncements();
                    },
                    getLastLamport: () => extractLatestLamport(localMessagesRef.current),
                    getLastInteractionProjectionCursor: () => anchoredProjectionCursorRef.current,
                    getRefreshableEnvelopeIds: () => extractRefreshableEnvelopeIds(localMessagesRef.current),
                    maxRefreshableEnvelopeIds: DISCUSSION_SYNC_LIMIT,
                    applyCatchUp: async (response) => {
                        if (cancelled) return;
                        applyDiscussionCatchUp(response);
                    },
                    applyTargetedRefresh: async (response) => {
                        if (cancelled) return;
                        applyDiscussionTargetedRefresh(response);
                    },
                    applyRealtimeMessages: async (response) => {
                        if (cancelled) return;
                        applyDiscussionCatchUp(response);
                    },
                    applyInteractionRefresh: async (response) => {
                        if (cancelled) return;
                        applyAnchoredInteractionProjectionResponse(response);
                    },
                    applyRealtimeInteractions: async (response) => {
                        if (cancelled) return;
                        applyAnchoredInteractionProjectionResponse(response);
                    },
                    onError: (message) => {
                        if (cancelled) return;
                        setDiscussionError(resolveDiscussionRealtimeError(message, t));
                    },
                });

                discussionRealtimeSubscriptionRef.current = subscription;
                handleVisibilityChange = () => subscription.handleVisibilityChange();
                document.addEventListener('visibilitychange', handleVisibilityChange);
            } catch (error) {
                if (cancelled) return;
                setDiscussionError(error instanceof Error ? error.message : t('errors.syncFailed'));
            }
        }

        void startRealtime();

        return () => {
            cancelled = true;
            if (handleVisibilityChange) {
                document.removeEventListener('visibilitychange', handleVisibilityChange);
            }
            discussionRealtimeSubscriptionRef.current?.close();
            discussionRealtimeSubscriptionRef.current = null;
        };
    }, [
        applyDiscussionCatchUp,
        applyDiscussionTargetedRefresh,
        applyAnchoredInteractionProjectionResponse,
        discussionCircleId,
        discussionSnapshotVersion,
        extractRefreshableEnvelopeIds,
        extractLatestLamport,
        refreshAnnouncements,
        t,
    ]);

    useEffect(() => {
        const nextExpiryAt = localMessages
            .filter((message) => message.ephemeral)
            .map((message) => {
                const expiresAt = typeof message.metadata?.expiresAt === 'string'
                    ? Date.parse(message.metadata.expiresAt)
                    : Number.NaN;
                return Number.isFinite(expiresAt) ? expiresAt : Number.NaN;
            })
            .filter((expiresAt): expiresAt is number => Number.isFinite(expiresAt))
            .sort((left, right) => left - right)[0];

        if (!Number.isFinite(nextExpiryAt)) {
            return undefined;
        }

        const delayMs = Math.max(0, nextExpiryAt - Date.now());
        const timerId = window.setTimeout(() => {
            const nextMessages = pruneExpiredEphemeralMessages({
                messages: localMessagesRef.current,
                now: new Date(),
            });
            if (nextMessages !== localMessagesRef.current) {
                commitDiscussionMessages(nextMessages);
            }
        }, delayMs);

        return () => window.clearTimeout(timerId);
    }, [commitDiscussionMessages, localMessages]);

    // Auto-scroll only when the reader is already following the live bottom.
    useEffect(() => {
        const previousCount = previousMessageCountRef.current;
        previousMessageCountRef.current = localMessages.length;
        if (!shouldFollowLatestRef.current) {
            return;
        }
        messagesEndRef.current?.scrollIntoView({
            behavior: localMessages.length > previousCount ? 'smooth' : 'auto',
        });
    }, [localMessages]);

    const visibleMessages = useMemo(() => {
        const filteredByViewMode = localMessages.filter((msg) => {
            if (viewMode === 'all') return true;

            const isMine = !!viewerSessionPubkey && msg.senderPubkey === viewerSessionPubkey;
            if (isMine) return true;

            if (viewMode === 'mine') return false;

            return msg.focusLabel !== 'off_topic';
        });

        return filteredByViewMode.filter((message) =>
            messageMatchesSemanticFacetFilters(message, activeContentFilters));
    }, [activeContentFilters, localMessages, viewMode, viewerSessionPubkey]);

    const effectiveConvertedAnchoredInteractionSuggestionKeys = useMemo(() => {
        const next = new Set(convertedAnchoredInteractionSuggestionKeys);
        for (const interaction of Object.values(anchoredInteractionsById)) {
            if (interaction.anchor.type !== 'discussion_message' || !interaction.anchor.ref) continue;
            next.add(createAnchoredInteractionSuggestionConvertedKey({
                viewerKey: anchoredInteractionSuggestionViewerKey,
                circleId: discussionCircleId,
                envelopeId: interaction.anchor.ref,
            }));
        }
        return next;
    }, [
        anchoredInteractionSuggestionViewerKey,
        anchoredInteractionsById,
        convertedAnchoredInteractionSuggestionKeys,
        discussionCircleId,
    ]);
    const anchoredInteractionSuggestionCandidateEnvelopeIds = useMemo(() => (
        selectAnchoredInteractionSuggestionCandidateEnvelopeIds(visibleMessages, {
            circleId: discussionCircleId,
            viewerKey: anchoredInteractionSuggestionViewerKey,
            convertedEnvelopeKeys: effectiveConvertedAnchoredInteractionSuggestionKeys,
        })
    ), [
        anchoredInteractionSuggestionViewerKey,
        discussionCircleId,
        effectiveConvertedAnchoredInteractionSuggestionKeys,
        visibleMessages,
    ]);
    const anchoredInteractionSuggestionCandidateRequestKey = anchoredInteractionSuggestionCandidateEnvelopeIds.join('\u001f');
    useEffect(() => {
        if (!viewerSessionPubkey || !discussionCircleId || anchoredInteractionSuggestionCandidateEnvelopeIds.length === 0) {
            setAnchoredInteractionSuggestionDecisionOverrides(new Map());
            return undefined;
        }

        let cancelled = false;
        let retryTimer: number | undefined;

        const loadDecisionOverrides = async (attempt: number): Promise<void> => {
            try {
                const response = await fetchAnchoredSuggestionDecisions({
                    circleId: discussionCircleId,
                    envelopeIds: anchoredInteractionSuggestionCandidateEnvelopeIds,
                    locale,
                });
                if (cancelled) return;
                const nextOverrides = new Map<string, InteractionSuggestionDecision>();
                for (const decision of response.decisions) {
                    nextOverrides.set(decision.envelopeId, decision);
                }
                setAnchoredInteractionSuggestionDecisionOverrides(nextOverrides);
                if ((response.status === 'queued' || response.status === 'running') && attempt < 2) {
                    retryTimer = window.setTimeout(() => {
                        void loadDecisionOverrides(attempt + 1);
                    }, 1500 * (attempt + 1));
                }
            } catch {
                if (!cancelled) {
                    setAnchoredInteractionSuggestionDecisionOverrides(new Map());
                }
            }
        };

        void loadDecisionOverrides(0);

        return () => {
            cancelled = true;
            if (retryTimer !== undefined) {
                window.clearTimeout(retryTimer);
            }
        };
    }, [
        anchoredInteractionSuggestionCandidateEnvelopeIds,
        anchoredInteractionSuggestionCandidateRequestKey,
        discussionCircleId,
        locale,
        viewerSessionPubkey,
    ]);
    const anchoredInteractionSuggestions = useMemo(() => (
        buildAnchoredInteractionSuggestions(visibleMessages, {
            circleId: discussionCircleId,
            viewerKey: anchoredInteractionSuggestionViewerKey,
            dismissedSuggestionKeys: dismissedAnchoredInteractionSuggestionKeys,
            convertedEnvelopeKeys: effectiveConvertedAnchoredInteractionSuggestionKeys,
            decisionOverridesByEnvelopeId: anchoredInteractionSuggestionDecisionOverrides,
        })
    ), [
        anchoredInteractionSuggestionDecisionOverrides,
        anchoredInteractionSuggestionViewerKey,
        dismissedAnchoredInteractionSuggestionKeys,
        discussionCircleId,
        effectiveConvertedAnchoredInteractionSuggestionKeys,
        visibleMessages,
    ]);
    const anchoredInteractionSuggestionsByMessageId = useMemo(() => new Map(
        anchoredInteractionSuggestions.map((suggestion) => [suggestion.messageId, suggestion]),
    ), [anchoredInteractionSuggestions]);
    const visibleMessagesByEnvelopeId = useMemo(() => new Map(
        visibleMessages
            .filter((message): message is PlazaMessage & { envelopeId: string } => Boolean(message.envelopeId))
            .map((message) => [message.envelopeId, message]),
    ), [visibleMessages]);
    const anchoredInteractionSuggestionPanelHasUpdates = Boolean(
        showSuggestionPanel
        && anchoredInteractionSuggestionPanelSnapshot
        && !areAnchoredInteractionSuggestionListsEqual(
            anchoredInteractionSuggestionPanelSnapshot,
            anchoredInteractionSuggestions,
        ),
    );
    const visibleAnchoredInteractionSuggestionPanelItems = showSuggestionPanel
        ? anchoredInteractionSuggestionPanelSnapshot || anchoredInteractionSuggestions
        : anchoredInteractionSuggestions;

    const manualDraftSourceMessageIds = useMemo(
        () => selectVisibleDraftSourceMessageIds(visibleMessages, MANUAL_DRAFT_SOURCE_LIMIT),
        [visibleMessages],
    );
    const selectedManualDraftSourceMessageIds = useMemo(
        () => normalizeSelectedDraftSourceMessageIds(
            visibleMessages,
            selectedMessageEnvelopeIds,
            MANUAL_DRAFT_SELECTION_LIMIT,
        ),
        [selectedMessageEnvelopeIds, visibleMessages],
    );
    const selectedForwardMessageIds = useMemo(
        () => normalizeSelectedPlazaMessageIds(
            visibleMessages,
            selectedMessageEnvelopeIds,
            'forward',
            MESSAGE_SELECTION_LIMIT,
        ),
        [selectedMessageEnvelopeIds, visibleMessages],
    );
    const selectedGovernanceCaseSourceMessageIds = useMemo(
        () => normalizeSelectedPlazaMessageIds(
            visibleMessages,
            selectedMessageEnvelopeIds,
            'case',
            MESSAGE_SELECTION_LIMIT,
        ),
        [selectedMessageEnvelopeIds, visibleMessages],
    );
    const manualDraftSourceScope = useMemo(() => ({
        viewMode,
        visibleMessageCount: visibleMessages.length,
        filterLabels: activeContentFilters,
    }), [activeContentFilters, viewMode, visibleMessages.length]);
    const manualDraftSelectionDisabledReason = !viewerHasRegisteredIdentity
        ? t('manualDraft.selection.disabledNoIdentity')
        : !viewerCanCreateManualDiscussionDraft
            ? t('manualDraft.selection.disabledNoPermission')
            : creatingDiscussionDraft
                ? t('manualDraft.busy')
                : manualDraftSourceMessageIds.length === 0
                    ? t('manualDraft.selection.noEligibleSelection')
                    : null;
    const forwardSelectionDisabledReason = !viewerHasRegisteredIdentity
        ? t('forward.selection.disabledNoIdentity')
        : !viewerJoined
            ? t('forward.reason.viewerNotJoined')
            : eligibleForwardTargets.length === 0
                ? t('forward.reason.noTargets')
                : null;
    const manualDraftSelectionHint = !messageSelectionError
        && selectedManualDraftSourceMessageIds.length > 0
        && selectedManualDraftSourceMessageIds.length < 2
        ? t('manualDraft.selection.lowSourceCountHint')
        : null;
    const formatManualDraftCreateResultMessage = useCallback((response: DraftCandidateCreateDraftResponse) => {
        const result = response.result;
        if (result.status === 'created' || result.status === 'existing') {
            const sourceConsumption = result.sourceConsumption;
            const partialOverlapCount = sourceConsumption?.partialOverlapSourceMessageIds?.length ?? 0;
            if (result.status === 'existing' && sourceConsumption?.blocking) {
                return t('manualDraft.selection.sourceAlreadyConsumed');
            }
            if (partialOverlapCount > 0) {
                return t('manualDraft.selection.sourcePartiallyConsumedHint', { count: partialOverlapCount });
            }
        }

        return result.status === 'created'
            ? t('manualDraft.succeeded')
            : t('manualDraft.existing');
    }, [t]);
    const formatManualDraftCreateErrorMessage = useCallback((error: unknown) => {
        const code = readRequestErrorCode(error);
        if (code === 'candidate_generation_forbidden' || code === 'authentication_required') {
            return t('manualDraft.selection.permissionRequired');
        }
        if (code === 'draft_candidate_missing_sources' || code === 'invalid_source_message_ids') {
            return t('manualDraft.selection.noEligibleSelection');
        }
        if (code === 'source_already_consumed') {
            return t('manualDraft.selection.sourceAlreadyConsumed');
        }

        const detail = error instanceof Error
            ? error.message
            : String(error || '').trim();
        return detail
            ? t('manualDraft.selection.genericFailureWithDetail', { detail })
            : t('manualDraft.failedGeneric');
    }, [t]);

    useEffect(() => {
        if (!focusedEnvelopeId || visibleMessages.length === 0) return;
        const hasTarget = visibleMessages.some((message) => message.envelopeId === focusedEnvelopeId);
        if (!hasTarget) return;
        const escapedEnvelopeId =
            typeof CSS !== 'undefined' && typeof CSS.escape === 'function'
                ? CSS.escape(focusedEnvelopeId)
                : focusedEnvelopeId.replace(/"/g, '\\"');
        const node = document.querySelector<HTMLElement>(`[data-envelope-id="${escapedEnvelopeId}"]`);
        if (!node) return;
        node.scrollIntoView({ behavior: 'smooth', block: 'center' });
        const clearTimer = window.setTimeout(() => {
            setFocusedEnvelopeId((current) => (current === focusedEnvelopeId ? null : current));
        }, 2200);
        return () => window.clearTimeout(clearTimer);
    }, [focusedEnvelopeId, visibleMessages]);

    useEffect(() => {
        if (!focusedAnchoredInteractionId) return undefined;
        const clearTimer = window.setTimeout(() => {
            setFocusedAnchoredInteractionId((current) => (
                current === focusedAnchoredInteractionId ? null : current
            ));
        }, 2200);
        return () => window.clearTimeout(clearTimer);
    }, [focusedAnchoredInteractionId]);

    useEffect(() => {
        const announcementId = typeof focusedAnnouncementId === 'string'
            ? focusedAnnouncementId.trim()
            : '';
        if (!announcementId || focusedAnnouncementOpenedRef.current === announcementId) return;
        if (announcements.length === 0 && !announcementLoading) return;
        focusedAnnouncementOpenedRef.current = announcementId;
        void handleOpenAnnouncementDetail(announcementId);
    }, [announcementLoading, announcements.length, focusedAnnouncementId, handleOpenAnnouncementDetail]);

    const hiddenMessageCount = Math.max(0, localMessages.length - visibleMessages.length);
    const actionSheetMessage = useMemo(
        () => (actionSheetMsgId === null ? null : localMessages.find((m) => m.id === actionSheetMsgId) || null),
        [actionSheetMsgId, localMessages],
    );
    const identityExplanationMessage = useMemo(
        () => (identityExplanationMsgId === null ? null : localMessages.find((m) => m.id === identityExplanationMsgId) || null),
        [identityExplanationMsgId, localMessages],
    );
    const identityExplanationRows = useMemo<IdentityExplanationRow[]>(() => {
        if (!identityExplanationMessage) return [];
        const state = resolveMessageIdentityBadgeState(identityExplanationMessage);
        if (state === 'not_joined') {
            return [
                {
                    label: t('identityExplanation.labels.status'),
                    value: t('identityExplanation.status.notJoined'),
                },
                {
                    label: t('identityExplanation.labels.note'),
                    value: t('identityExplanation.notes.notJoined'),
                },
            ];
        }

        const rows: IdentityExplanationRow[] = [
            {
                label: t('identityExplanation.labels.contributionLevel'),
                value: resolveMessageIdentityLabel(identityExplanationMessage, t),
            },
        ];
        const sourceLabel = resolveMembershipSourceLabel(identityExplanationMessage.senderMembershipSource, t);
        if (sourceLabel) {
            rows.push({
                label: t('identityExplanation.labels.membershipSource'),
                value: sourceLabel,
            });
        }
        if (identityExplanationMessage.senderRoleDisplayName) {
            rows.push({
                label: t('identityExplanation.labels.role'),
                value: identityExplanationMessage.senderRoleDisplayName,
            });
        }
        return rows;
    }, [identityExplanationMessage, t]);
    const isActionSheetInteractionResultNotice = actionSheetMessage?.messageKind === 'interaction_result_notice';
    const canAskAiActionSheetMessage = Boolean(
        !isActionSheetInteractionResultNotice
        && viewerJoined
        && viewerSessionPubkey
        && Number.isFinite(discussionCircleId)
        && discussionCircleId > 0
        && !actionSheetMessage?.messageKind
        && actionSheetMessage?.envelopeId
        && !actionSheetMessage.deleted
        && !actionSheetMessage.ephemeral,
    );
    const forwardAction = useMemo(() => getPlazaForwardAction({
        viewerJoined,
        envelopeId: actionSheetMessage?.envelopeId,
        messageKind: actionSheetMessage?.messageKind,
        ephemeral: actionSheetMessage?.ephemeral,
        deleted: actionSheetMessage?.deleted,
        availableTargetCount: eligibleForwardTargets.length,
    }), [
        actionSheetMessage?.deleted,
        actionSheetMessage?.envelopeId,
        actionSheetMessage?.ephemeral,
        actionSheetMessage?.messageKind,
        eligibleForwardTargets.length,
        viewerJoined,
    ]);
    const canMarkUsefulActionSheetMessage = useMemo(() => {
        if (!actionSheetMessage) return false;
        return canMarkPlazaMessageUseful({
            messageId: actionSheetMessage.id,
            usefulMarkedIds: usefulMarkedIds,
            viewerPubkey: viewerSessionPubkey,
            senderPubkey: actionSheetMessage.senderPubkey,
            deleted: actionSheetMessage.deleted,
            ephemeral: actionSheetMessage.ephemeral,
        });
    }, [actionSheetMessage, usefulMarkedIds, viewerSessionPubkey]);
    const canUnmarkUsefulActionSheetMessage = useMemo(() => {
        if (!actionSheetMessage || !viewerSessionPubkey) return false;
        if (!actionSheetMessage.envelopeId || actionSheetMessage.deleted || actionSheetMessage.ephemeral) return false;
        return usefulMarkedIds.has(actionSheetMessage.id);
    }, [actionSheetMessage, usefulMarkedIds, viewerSessionPubkey]);
    const anchoredInteractionList = useMemo(() => Object.values(anchoredInteractionsById), [anchoredInteractionsById]);
    const anchoredInteractionField = useAnchoredInteractionField({
        interactions: anchoredInteractionList,
        baselineReady: anchoredInteractionProjectionBaselineReady,
    });
    useEffect(() => {
        if (!showAnchoredInteractionField || anchoredInteractionField.unreadChangeCount <= 0) return;
        anchoredInteractionField.acknowledgeChanges();
    }, [anchoredInteractionField, showAnchoredInteractionField]);
    const anchoredInteractionFieldMotion = useMemo<InteractionFieldMotionSnapshot | null>(() => {
        const pulse = anchoredInteractionField.motionPulse;
        if (!pulse) return null;
        return {
            interactionId: pulse.interactionId,
            anchorType: pulse.anchorType,
            anchorRef: pulse.anchorRef,
            projectionCursor: pulse.projectionCursor,
            motionKey: pulse.motionKey,
            title: anchoredInteractionTypeLabels[pulse.interactionType],
            detail: t('anchoredInteraction.updated'),
        };
    }, [anchoredInteractionField.motionPulse, anchoredInteractionTypeLabels, t]);
    const freeformAnchoredInteractions = useMemo(() => anchoredInteractionList
        .filter((interaction) => interaction.anchor.type === 'freeform' && interaction.anchor.ref)
        .sort((left, right) => (
            left.createdAt.localeCompare(right.createdAt)
            || left.interactionId.localeCompare(right.interactionId)
        )), [anchoredInteractionList]);
    const anchoredInteractionsByAnchorRef = useMemo(() => {
        const grouped: Record<string, DiscussionAnchoredInteractionDto[]> = {};
        for (const interaction of anchoredInteractionList) {
            if (interaction.anchor.type !== 'discussion_message' || !interaction.anchor.ref) continue;
            const current = grouped[interaction.anchor.ref] || [];
            current.push(interaction);
            grouped[interaction.anchor.ref] = current;
        }
        for (const anchorRef of Object.keys(grouped)) {
            grouped[anchorRef].sort((left, right) => (
                left.createdAt.localeCompare(right.createdAt)
                || left.interactionId.localeCompare(right.interactionId)
            ));
        }
        return grouped;
    }, [anchoredInteractionList]);

    const getInitials = (author: string): string => {
        const name = author.replace(/\.sol$/, '');
        return name.substring(0, 2).toUpperCase();
    };

    const [markMessageUsefulMutation] = useMutation<MessageUsefulMarkMutationResult>(MARK_MESSAGE_USEFUL);
    const [unmarkMessageUsefulMutation] = useMutation<MessageUsefulMarkMutationResult>(UNMARK_MESSAGE_USEFUL);
    const handleMarkUseful = useCallback((msgId: number) => {
        const msg = localMessages.find((item) => Number(item.id) === msgId);
        if (!msg) return;
        if (!canMarkPlazaMessageUseful({
            messageId: msgId,
            usefulMarkedIds,
            viewerPubkey: viewerSessionPubkey,
            senderPubkey: msg.senderPubkey,
            deleted: msg.deleted,
            ephemeral: msg.ephemeral,
        })) {
            return;
        }
        if (!msg.envelopeId) return;
        const previousCount = usefulCounts[msgId] || 0;
        setUsefulCounts((prev) => {
            const nextCount = (prev[msgId] || 0) + 1;
            return { ...prev, [msgId]: nextCount };
        });
        setUsefulMarkedIds((prev) => new Set(prev).add(msgId));
        setLocalMessages((prev) =>
            prev.map((item) =>
                item.id === msgId
                    ? {
                        ...item,
                        usefulCount: previousCount + 1,
                        viewerHasMarkedUseful: true,
                        isFeatured: true,
                        featureReason: item.featureReason || 'member_useful',
                    }
                    : item,
            ),
        );
        markMessageUsefulMutation({
            variables: { circleId: discussionCircleId, envelopeId: msg.envelopeId },
        })
                .then((result) => {
                    const payload = result.data?.markMessageUseful;
                    if (!payload) return;
                    setUsefulCounts((prev) => ({ ...prev, [msgId]: payload.usefulCount }));
                    setUsefulMarkedIds((prev) => new Set(prev).add(msgId));
                    setLocalMessages((prev) =>
                        prev.map((item) =>
                            item.id === msgId
                                ? {
                                    ...item,
                                    usefulCount: payload.usefulCount,
                                    viewerHasMarkedUseful: payload.viewerHasMarkedUseful,
                                    isFeatured: payload.isFeatured,
                                    featureReason: payload.isFeatured
                                        ? 'member_useful'
                                        : item.featureReason,
                                }
                                : item,
                        ),
                    );
                })
                .catch(() => {
                    setUsefulCounts((prev) => ({ ...prev, [msgId]: previousCount }));
                    setUsefulMarkedIds((prev) => {
                        const next = new Set(prev);
                        next.delete(msgId);
                        return next;
                    });
                    setLocalMessages((prev) =>
                        prev.map((item) =>
                            item.id === msgId
                                ? {
                                    ...item,
                                    usefulCount: previousCount,
                                    viewerHasMarkedUseful: Boolean(msg.viewerHasMarkedUseful),
                                    isFeatured: Boolean(msg.isFeatured),
                                    featureReason: msg.featureReason || null,
                                }
                                : item,
                        ),
                    );
                });
    }, [discussionCircleId, markMessageUsefulMutation, localMessages, usefulCounts, usefulMarkedIds, viewerSessionPubkey]);

    const handleUnmarkUseful = useCallback((msgId: number) => {
        if (!viewerSessionPubkey) return;
        const msg = localMessages.find((item) => Number(item.id) === msgId);
        if (!msg?.envelopeId || !usefulMarkedIds.has(msgId)) return;
        const previousCount = usefulCounts[msgId] || 0;
        const nextOptimisticCount = Math.max(0, previousCount - 1);
        const wasMemberUsefulFeature = msg.featureReason === 'member_useful';
        setUsefulCounts((prev) => ({ ...prev, [msgId]: nextOptimisticCount }));
        setUsefulMarkedIds((prev) => {
            const next = new Set(prev);
            next.delete(msgId);
            return next;
        });
        setLocalMessages((prev) =>
            prev.map((item) =>
                item.id === msgId
                    ? {
                        ...item,
                        usefulCount: nextOptimisticCount,
                        viewerHasMarkedUseful: false,
                        isFeatured: nextOptimisticCount > 0
                            ? true
                            : wasMemberUsefulFeature
                                ? false
                                : Boolean(item.isFeatured),
                        featureReason: nextOptimisticCount > 0
                            ? 'member_useful'
                            : wasMemberUsefulFeature
                                ? null
                                : item.featureReason,
                    }
                    : item,
            ),
        );
        unmarkMessageUsefulMutation({
            variables: { circleId: discussionCircleId, envelopeId: msg.envelopeId },
        })
                .then((result) => {
                    const payload = result.data?.unmarkMessageUseful;
                    if (!payload) return;
                    setUsefulCounts((prev) => ({ ...prev, [msgId]: payload.usefulCount }));
                    setUsefulMarkedIds((prev) => {
                        const next = new Set(prev);
                        if (payload.viewerHasMarkedUseful) {
                            next.add(msgId);
                        } else {
                            next.delete(msgId);
                        }
                        return next;
                    });
                    setLocalMessages((prev) =>
                        prev.map((item) =>
                            item.id === msgId
                                ? {
                                    ...item,
                                    usefulCount: payload.usefulCount,
                                    viewerHasMarkedUseful: payload.viewerHasMarkedUseful,
                                    isFeatured: payload.isFeatured,
                                    featureReason: payload.isFeatured
                                        ? item.featureReason || 'member_useful'
                                        : null,
                                }
                                : item,
                        ),
                    );
                })
                .catch(() => {
                    setUsefulCounts((prev) => ({ ...prev, [msgId]: previousCount }));
                    setUsefulMarkedIds((prev) => new Set(prev).add(msgId));
                    setLocalMessages((prev) =>
                        prev.map((item) =>
                            item.id === msgId
                                ? {
                                    ...item,
                                    usefulCount: previousCount,
                                    viewerHasMarkedUseful: true,
                                    isFeatured: Boolean(msg.isFeatured),
                                    featureReason: msg.featureReason || null,
                                }
                                : item,
                        ),
                    );
                });
    }, [discussionCircleId, localMessages, usefulCounts, usefulMarkedIds, unmarkMessageUsefulMutation, viewerSessionPubkey]);

    const toggleComposerLabel = useCallback((label: AuthorAnnotationKind) => {
        setComposerLabels((prev) => {
            if (prev.includes(label)) {
                return prev.filter((item) => item !== label);
            }
            return [...prev, label];
        });
    }, []);

    const toggleContentFilter = useCallback((label: AuthorAnnotationKind) => {
        setActiveContentFilters((prev) => {
            if (prev.includes(label)) {
                return prev.filter((item) => item !== label);
            }
            return [...prev, label];
        });
    }, []);

    const handleSend = useCallback(async () => {
        const text = chatInput.trim();
        if (!text) return;
        if (!viewerHasRegisteredIdentity || !viewerSessionPubkey) {
            setDiscussionError(viewerIdentityWriteError);
            return;
        }
        setShowComposerIdentityHint(false);

        const replySubjectEnvelopeId = replyTarget?.sourceEnvelopeId || null;
        const outgoingText = replyTarget
            ? buildQuotedReplyText({
                author: replyTarget.author,
                preview: replyTarget.preview,
                body: text,
            }, (values) => t('reply.quoted', values))
            : text;
        const structuredMetadata = buildStructuredDiscussionMetadata({
            authorAnnotations: composerLabels,
            primaryAuthorAnnotation: composerLabels[0] ?? null,
        });
        const clientWrite = createDiscussionClientWriteIdentity();

        const optimisticId = Date.now();
        const fallbackAuthor = viewerDisplayLabel || genericMemberLabel;
        const optimisticMsg: PlazaMessage = {
            id: optimisticId,
            author: fallbackAuthor,
            text: outgoingText,
            time: t('time.justNow'),
            ephemeral: !viewerJoined,
            usefulCount: 0,
            viewerHasMarkedUseful: false,
            sendState: 'pending',
            senderPubkey: viewerSessionPubkey,
            subjectType: replySubjectEnvelopeId ? 'discussion_message' : null,
            subjectId: replySubjectEnvelopeId,
            clientTimestamp: clientWrite.clientTimestamp,
            nonce: clientWrite.nonce,
            relevanceScore: 1,
            metadata: structuredMetadata,
            relevanceStatus: 'pending',
            semanticFacets: [],
            focusScore: null,
            focusLabel: null,
            authorAnnotations: composerLabels,
            primaryAuthorAnnotation: composerLabels[0] ?? null,
            selectedForCandidate: false,
        };

        shouldFollowLatestRef.current = true;
        setLocalMessages((prev) => [...prev, optimisticMsg]);
        setUsefulCounts((prev) => ({ ...prev, [optimisticId]: 0 }));
        setChatInput('');
        setShowPanel(false);
        setShowEmojiGrid(false);
        setReplyTarget(null);
        setDiscussionError(null);
        if (textareaRef.current) {
            textareaRef.current.style.height = 'auto';
        }

        try {
            const response = await runWithDiscussionSessionRecovery({
                useSessionTokenAuth,
                getToken: ensureDiscussionSessionToken,
                resetSession: resetDiscussionSession,
                run: (discussionAccessToken) => sendDiscussionMessage({
                    circleId: discussionCircleId,
                    senderPubkey: viewerSessionPubkey,
                    senderHandle: fallbackAuthor,
                    text: outgoingText,
                    metadata: structuredMetadata,
                    prevEnvelopeId: lastEnvelopeId,
                    subjectType: replySubjectEnvelopeId ? 'discussion_message' : undefined,
                    subjectId: replySubjectEnvelopeId,
                    clientWrite,
                    signMessage: shouldSignEachMessage ? signMessage : undefined,
                    discussionAccessToken: discussionAccessToken || undefined,
                }),
            });

            const mapped = mapDiscussionDtoToPlazaMessage(response.message, {
                locale,
                deletedText: t('messages.deleted'),
            });
            mapped.sendState = 'sent';
            setLastEnvelopeId(response.message.envelopeId);
            setLocalMessages((prev) => {
                const replaced = prev.map((msg) => (msg.id === optimisticId ? mapped : msg));
                return dedupePlazaMessagesByEnvelope(replaced);
            });
            reconcileSentDustMessageIfNeeded(mapped);
            if (replySubjectEnvelopeId) {
                void refreshAnnouncements();
            }
        } catch (error) {
            const hint = error instanceof Error ? error.message : t('errors.sendFailed');
            setLocalMessages((prev) =>
                prev.map((msg) =>
                    msg.id === optimisticId
                        ? {
                            ...msg,
                            sendState: 'failed',
                            errorHint: hint,
                        }
                        : msg,
                ),
            );
            setDiscussionError(hint);
        }
    }, [
        chatInput,
        discussionCircleId,
        ensureDiscussionSessionToken,
        lastEnvelopeId,
        reconcileSentDustMessageIfNeeded,
        refreshAnnouncements,
        resetDiscussionSession,
        shouldSignEachMessage,
        signMessage,
        useSessionTokenAuth,
        viewerHasRegisteredIdentity,
        viewerIdentityWriteError,
        viewerJoined,
        viewerSessionPubkey,
        replyTarget,
        composerLabels,
    ]);

    const handleTextareaChange = useCallback((e: React.ChangeEvent<HTMLTextAreaElement>) => {
        setChatInput(e.target.value);
        setShowComposerIdentityHint(false);
        const el = e.target;
        el.style.height = 'auto';
        el.style.height = `${Math.min(el.scrollHeight, 120)}px`;
    }, []);

    const handleTextareaFocus = useCallback(() => {
        setShowPanel(false);
        setShowEmojiGrid(false);
        setShowComposerIdentityHint(false);
    }, []);

    const handleShowComposerIdentityHint = useCallback(() => {
        if (!composerIdentityHint || chatInput.trim()) return;
        setShowComposerIdentityHint(true);
    }, [chatInput, composerIdentityHint]);

    const handleKeyDown = useCallback(
        (e: React.KeyboardEvent<HTMLTextAreaElement>) => {
            if (e.key === 'Enter' && !e.shiftKey) {
                e.preventDefault();
                handleSend();
            }
        },
        [handleSend]
    );

    const insertEmoji = useCallback((emoji: string) => {
        setChatInput((prev) => prev + emoji);
        textareaRef.current?.focus();
    }, []);

    const handleReply = useCallback((msgId: number) => {
        const msg = localMessages.find((item) => item.id === msgId);
        if (!msg) {
            setActionSheetMsgId(null);
            return;
        }

        setReplyTarget({
            author: msg.author,
            preview: buildReplyPreview(msg.text, t('reply.emptyBody')),
            sourceEnvelopeId: msg.envelopeId || null,
        });
        setActionSheetMsgId(null);
        setShowPanel(false);
        setShowEmojiGrid(false);
        requestAnimationFrame(() => {
            textareaRef.current?.focus();
        });
    }, [localMessages, t]);

    const handleReplyToQuote = useCallback((quote: PlazaReplyQuote) => {
        setReplyTarget({
            author: quote.author,
            preview: quote.preview || t('reply.emptyBody'),
            sourceEnvelopeId: quote.sourceEnvelopeId || null,
        });
        setReplyQuoteMenu(null);
        setActionSheetMsgId(null);
        setShowPanel(false);
        setShowEmojiGrid(false);
        requestAnimationFrame(() => {
            textareaRef.current?.focus();
        });
    }, [t]);

    const handleOpenSourceGroundedAsk = useCallback(() => {
        if (
            !viewerJoined
            || !viewerSessionPubkey
            || !Number.isFinite(discussionCircleId)
            || discussionCircleId <= 0
            || !actionSheetMessage?.envelopeId
            || actionSheetMessage.messageKind
            || actionSheetMessage.deleted
            || actionSheetMessage.ephemeral
        ) {
            setActionSheetMsgId(null);
            return;
        }

        const author = actionSheetMessage.author || t('messages.genericMember');
        const preview = buildReplyPreview(actionSheetMessage.text, t('reply.emptyBody'));
        const questionContext = truncateForwardBundlePreview(
            actionSheetMessage.text.replace(/\s+/g, ' ').trim() || t('reply.emptyBody'),
            SOURCE_GROUNDED_ASK_CONTEXT_LIMIT,
        );
        setSourceGroundedAskTarget({
            envelopeId: actionSheetMessage.envelopeId,
            author,
            preview,
            question: t('sourceAsk.initialQuestion', {
                author,
                preview: questionContext,
            }),
        });
        setActionSheetMsgId(null);
        setShowPanel(false);
        setShowEmojiGrid(false);
    }, [actionSheetMessage, discussionCircleId, t, viewerJoined, viewerSessionPubkey]);

    const renderSourceGroundedAskForMessage = useCallback((msg: PlazaMessage) => {
        const askTarget = sourceGroundedAskTarget;
        if (!askTarget || askTarget.envelopeId !== msg.envelopeId) return null;
        return (
            <div className={styles.sourceGroundedAskDock} data-msg-action="1">
                <div className={styles.sourceGroundedAskAnchor}>
                    <div className={styles.sourceGroundedAskMeta}>
                        <span>{t('sourceAsk.anchorLabel', {author: askTarget.author})}</span>
                        <strong>{askTarget.preview}</strong>
                    </div>
                </div>
                <SourceGroundedAskPanel
                    key={askTarget.envelopeId}
                    circleId={discussionCircleId}
                    locale={locale}
                    compact
                    title={t('sourceAsk.title')}
                    description={t('sourceAsk.description')}
                    initialQuestion={askTarget.question}
                    placeholder={t('sourceAsk.placeholder')}
                    showRefresh={false}
                    scopeLabel={t('sourceAsk.scopeLabel')}
                    scopeLabels={sourceAskScopeLabels}
                    askLabel={t('sourceAsk.ask')}
                    askingLabel={t('sourceAsk.asking')}
                    refreshLabel={t('sourceAsk.refresh')}
                    refreshingLabel={t('sourceAsk.refreshing')}
                    closeLabel={t('sourceAsk.close')}
                    onClose={() => setSourceGroundedAskTarget(null)}
                    defaultScopes={['current_circle']}
                    availableScopes={['current_circle', 'formal_references', 'trend_receipts', 'source_materials']}
                />
            </div>
        );
    }, [discussionCircleId, locale, sourceAskScopeLabels, sourceGroundedAskTarget, t]);

    const handleFocusReplyQuote = useCallback((quote: PlazaReplyQuote) => {
        if (quote.sourceEnvelopeId) {
            setActiveContentFilters([]);
            setViewMode('all');
            setFocusedEnvelopeId(quote.sourceEnvelopeId);
            setReplyQuoteMenu(null);
            return;
        }

        const normalizedPreview = (quote.preview || '').replace(/\s+/g, ' ').trim();
        if (!normalizedPreview) return;
        const source = [...localMessages].reverse().find((candidate) => {
            if (!candidate.envelopeId || candidate.author !== quote.author) return false;
            const candidatePreview = buildReplyPreview(candidate.text, t('reply.emptyBody'));
            if (candidatePreview === normalizedPreview) return true;
            if (!normalizedPreview.endsWith('…')) return false;
            return candidate.text.replace(/\s+/g, ' ').trim().startsWith(normalizedPreview.slice(0, -1));
        });
        if (!source?.envelopeId) return;
        setActiveContentFilters([]);
        setViewMode('all');
        setFocusedEnvelopeId(source.envelopeId);
        setReplyQuoteMenu(null);
    }, [localMessages, t]);

    const toggleReplyContext = useCallback((msgId: number) => {
        setExpandedReplyContextIds((prev) => {
            const next = new Set(prev);
            if (next.has(msgId)) {
                next.delete(msgId);
            } else {
                next.add(msgId);
            }
            return next;
        });
    }, []);

    const handleShowFullReplyQuote = useCallback((key: string) => {
        setExpandedReplyQuoteKeys((prev) => {
            const next = new Set(prev);
            next.add(key);
            return next;
        });
        setReplyQuoteMenu(null);
    }, []);

    const handleShowAllReplyQuotes = useCallback((keys: string[]) => {
        if (keys.length === 0) return;
        setExpandedReplyQuoteKeys((prev) => {
            const next = new Set(prev);
            keys.forEach((key) => next.add(key));
            return next;
        });
        setReplyQuoteMenu(null);
    }, []);

    const handleCollapseReplyQuotes = useCallback((keys: string[]) => {
        if (keys.length === 0) return;
        setExpandedReplyQuoteKeys((prev) => {
            const next = new Set(prev);
            keys.forEach((key) => next.delete(key));
            return next;
        });
        setReplyQuoteMenu(null);
    }, []);

    const trackReplyQuotePreviewTruncation = useCallback((
        key: string,
        isExpanded: boolean,
        element: HTMLSpanElement | null,
    ) => {
        if (!element || isExpanded) return;
        const isTruncated =
            element.scrollHeight > element.clientHeight + 1
            || element.scrollWidth > element.clientWidth + 1;
        setTruncatedReplyQuoteKeys((prev) => {
            if (prev.has(key) === isTruncated) return prev;
            const next = new Set(prev);
            if (isTruncated) {
                next.add(key);
            } else {
                next.delete(key);
            }
            return next;
        });
    }, []);

    const handleOpenForwardPicker = useCallback(() => {
        if (actionSheetMsgId === null || !forwardAction.enabled) {
            setActionSheetMsgId(null);
            return;
        }
        setForwardingMessageId(actionSheetMsgId);
        setMessageSelectionMode(null);
        setSelectedMessageEnvelopeIds(new Set());
        setMessageSelectionError(null);
        setShowBatchForwardPicker(false);
        setActionSheetMsgId(null);
        setShowForwardPicker(true);
    }, [actionSheetMsgId, forwardAction.enabled]);

    const handleForwardSelect = useCallback(async (target: PickerCircle) => {
        if (forwardingMessageId === null) {
            setShowForwardPicker(false);
            return;
        }
        const sourceMessage = localMessages.find((msg) => msg.id === forwardingMessageId);
        if (!sourceMessage?.envelopeId) {
            setShowForwardPicker(false);
            setDiscussionError(t('forward.reason.missingEnvelopeId'));
            return;
        }

        try {
            setDiscussionError(null);
            await forwardDiscussionMessage({
                envelopeId: sourceMessage.envelopeId,
                targetCircleId: Number(target.subCircleId),
            });
            setDiscussionStatus(t('status.forwardedToCircle', { circleName: target.subCircleName }));
        } catch (error) {
            const errorMessage = error instanceof Error ? error.message : t('errors.forwardFailed');
            setDiscussionError(errorMessage);
        } finally {
            setShowForwardPicker(false);
            setForwardingMessageId(null);
        }
    }, [forwardingMessageId, localMessages]);

    const handleOpenAnchoredInteractionComposer = useCallback(() => {
        if (!actionSheetMessage?.envelopeId) {
            setActionSheetMsgId(null);
            return;
        }
        setAnchoredInteractionComposerAnchor({
            anchorMode: 'message',
            message: actionSheetMessage,
        });
        setAnchoredInteractionComposerError(null);
        setActionSheetMsgId(null);
    }, [actionSheetMessage]);

    const handleOpenTipTransferSheet = useCallback(() => {
        if (!actionSheetMessage?.envelopeId || !actionSheetMessage.senderPubkey) {
            setActionSheetMsgId(null);
            return;
        }
        setTipTransferTarget({ mode: 'initial', message: actionSheetMessage });
        setTipTransferError(null);
        setPendingInitialTipRecord(null);
        setActionSheetMsgId(null);
    }, [actionSheetMessage]);

    const handleOpenFreeformAnchoredInteractionComposer = useCallback(() => {
        setAnchoredInteractionComposerAnchor({
            anchorMode: 'freeform',
            freeformRef: `freeform:${discussionCircleId}:${Date.now()}`,
            sourceLabel: t('anchoredInteraction.createFromComposer'),
            anchorPreview: chatInput.trim() || null,
        });
        setAnchoredInteractionComposerError(null);
        setShowPanel(false);
    }, [chatInput, discussionCircleId, t]);

    const handleOpenAnchoredInteractionSuggestion = useCallback((
        message: PlazaMessage,
        suggestion: AnchoredInteractionSuggestion,
    ) => {
        if (!message.envelopeId) return;
        setShowSuggestionPanel(false);
        setAnchoredInteractionSuggestionPanelSnapshot(null);
        setAnchoredInteractionComposerAnchor({
            anchorMode: 'message',
            message,
            preselectedInteractionType: suggestion.suggestedInteractionType,
        });
        setAnchoredInteractionComposerError(null);
    }, []);

    const handleDismissAnchoredInteractionSuggestion = useCallback((suggestion: AnchoredInteractionSuggestion) => {
        const key = createAnchoredInteractionSuggestionDismissedKey({
            viewerKey: anchoredInteractionSuggestionViewerKey,
            circleId: discussionCircleId,
            envelopeId: suggestion.envelopeId,
            suggestedInteractionType: suggestion.suggestedInteractionType,
        });
        setDismissedAnchoredInteractionSuggestionKeys((prev) => new Set(prev).add(key));
        setAnchoredInteractionSuggestionPanelSnapshot((current) => (
            current
                ? current.filter((item) => !(
                    item.envelopeId === suggestion.envelopeId
                    && item.suggestedInteractionType === suggestion.suggestedInteractionType
                ))
                : current
        ));
    }, [anchoredInteractionSuggestionViewerKey, discussionCircleId]);

    const handleLocateAnchoredInteractionSuggestion = useCallback((suggestion: AnchoredInteractionSuggestion) => {
        setShowSuggestionPanel(false);
        setShowFilterPanel(false);
        setShowAnnouncementPanel(false);
        setActiveContentFilters([]);
        setViewMode('all');
        void ensureDiscussionEnvelopeVisible(suggestion.envelopeId)
            .then((visible) => {
                if (visible) setFocusedEnvelopeId(suggestion.envelopeId);
            })
            .catch((error) => {
                setDiscussionError(error instanceof Error ? error.message : t('errors.syncFailed'));
            });
    }, [ensureDiscussionEnvelopeVisible, t]);

    const handleRefreshAnchoredInteractionSuggestionPanel = useCallback(() => {
        setAnchoredInteractionSuggestionPanelSnapshot(anchoredInteractionSuggestions);
    }, [anchoredInteractionSuggestions]);

    const handleCreateAnchoredInteraction = useCallback(async (draft: AnchoredInteractionCreateDraft) => {
        const anchor = anchoredInteractionComposerAnchor;
        if (!anchor) {
            setAnchoredInteractionComposerError(t('anchoredInteraction.errors.missingAnchor'));
            return;
        }
        const anchorPayload = anchor.anchorMode === 'message'
            ? anchor.message.envelopeId
                ? { type: 'discussion_message' as const, ref: anchor.message.envelopeId }
                : null
            : { type: 'freeform' as const, ref: anchor.freeformRef };
        if (!anchorPayload) {
            setAnchoredInteractionComposerError(t('anchoredInteraction.errors.missingAnchor'));
            return;
        }
        if (!viewerHasRegisteredIdentity || !viewerSessionPubkey) {
            setAnchoredInteractionComposerError(viewerIdentityWriteError);
            return;
        }

        setCreatingAnchoredInteraction(true);
        setAnchoredInteractionComposerError(null);
        const clientWrite = createDiscussionClientWriteIdentity();
        try {
            const result = await runWithDiscussionSessionRecovery({
                useSessionTokenAuth,
                getToken: ensureDiscussionSessionToken,
                resetSession: resetDiscussionSession,
                run: (discussionAccessToken) => createAnchoredInteraction({
                    circleId: discussionCircleId,
                    senderPubkey: viewerSessionPubkey,
                    discussionAccessToken: discussionAccessToken || undefined,
                    clientNonce: clientWrite.nonce,
                    anchor: anchorPayload,
                    interactionType: draft.interactionType,
                    initialState: draft.initialState,
                    initialSummary: draft.initialSummary,
                }),
            });
            upsertAnchoredInteraction(result.interaction);
            if (anchor.anchorMode === 'message' && anchor.message.envelopeId) {
                setConvertedAnchoredInteractionSuggestionKeys((prev) => new Set(prev).add(
                    createAnchoredInteractionSuggestionConvertedKey({
                        viewerKey: anchoredInteractionSuggestionViewerKey,
                        circleId: discussionCircleId,
                        envelopeId: anchor.message.envelopeId!,
                    }),
                ));
            }
            setAnchoredInteractionComposerAnchor(null);
            setDiscussionStatus(t('anchoredInteraction.created'));
        } catch (error) {
            const message = error instanceof Error ? error.message : t('anchoredInteraction.errors.createFailedGeneric');
            setAnchoredInteractionComposerError(t('anchoredInteraction.errors.createFailed', { error: message }));
        } finally {
            setCreatingAnchoredInteraction(false);
        }
    }, [
        anchoredInteractionComposerAnchor,
        anchoredInteractionSuggestionViewerKey,
        discussionCircleId,
        ensureDiscussionSessionToken,
        resetDiscussionSession,
        t,
        upsertAnchoredInteraction,
        useSessionTokenAuth,
        viewerHasRegisteredIdentity,
        viewerIdentityWriteError,
        viewerSessionPubkey,
    ]);

    const handleSubmitInitialTipTransfer = useCallback(async (draft: AnchoredInteractionTipSubmit) => {
        const target = tipTransferTarget;
        if (!target) return;
        if (!walletPubkey || !viewerHasRegisteredIdentity || !viewerSessionPubkey) {
            setTipTransferError(viewerIdentityWriteError);
            return;
        }
        const amount = draft.amount.trim();
        const recipientPubkey = target.mode === 'initial'
            ? target.message.senderPubkey || ''
            : typeof target.interaction.state.recipientPubkey === 'string'
                ? target.interaction.state.recipientPubkey
                : '';
        if (!recipientPubkey) {
            setTipTransferError(t('anchoredInteraction.errors.missingTipRecipient'));
            return;
        }
        if (target.mode === 'initial' && !target.message.envelopeId) {
            setTipTransferError(t('anchoredInteraction.errors.missingAnchor'));
            return;
        }

        const matchingPending = pendingInitialTipRecord && (
            target.mode === 'initial'
                ? pendingInitialTipRecord.mode === 'initial'
                    && pendingInitialTipRecord.anchorEnvelopeId === target.message.envelopeId
                    && pendingInitialTipRecord.recipientPubkey === recipientPubkey
                    && pendingInitialTipRecord.amount === amount
                : pendingInitialTipRecord.mode === 'add'
                    && pendingInitialTipRecord.interactionId === target.interaction.interactionId
                    && pendingInitialTipRecord.recipientPubkey === recipientPubkey
                    && pendingInitialTipRecord.amount === amount
        )
            ? pendingInitialTipRecord
            : null;
        const createClientNonce = matchingPending?.mode === 'initial'
            ? matchingPending.createClientNonce
            : createDiscussionClientWriteIdentity().nonce;
        const recordClientNonce = matchingPending?.recordClientNonce || createDiscussionClientWriteIdentity().nonce;

        setCreatingTipTransfer(true);
        setTipTransferError(null);
        let receipt = matchingPending?.receipt || null;
        try {
            if (!receipt) {
                receipt = await runTipTransfer({
                    recipientPubkey,
                    amount,
                    assetType: 'SOL',
                    mint: null,
                });
            }
            const recordedReceipt = receipt;

            if (target.mode === 'initial') {
                const anchorEnvelopeId = target.message.envelopeId || '';
                setPendingInitialTipRecord({
                    mode: 'initial',
                    anchorEnvelopeId,
                    recipientPubkey,
                    amount,
                    receipt: recordedReceipt,
                    createClientNonce,
                    recordClientNonce,
                });
                const result = await runWithDiscussionSessionRecovery({
                    useSessionTokenAuth,
                    getToken: ensureDiscussionSessionToken,
                    resetSession: resetDiscussionSession,
                    run: async (discussionAccessToken) => {
                        const created = await createAnchoredInteraction({
                            circleId: discussionCircleId,
                            senderPubkey: viewerSessionPubkey,
                            discussionAccessToken: discussionAccessToken || undefined,
                            clientNonce: createClientNonce,
                            anchor: { type: 'discussion_message' as const, ref: anchorEnvelopeId },
                            interactionType: 'tip',
                            initialState: {
                                recipientPubkey,
                                assetType: 'SOL',
                                amount,
                            },
                            initialSummary: {},
                        });
                        return recordTipTransferReceipt({
                            circleId: discussionCircleId,
                            senderPubkey: viewerSessionPubkey,
                            discussionAccessToken: discussionAccessToken || undefined,
                            interactionId: created.interaction.interactionId,
                            clientNonce: recordClientNonce,
                            receipt: recordedReceipt,
                        });
                    },
                });
                upsertAnchoredInteraction(result.interaction);
            } else {
                setPendingInitialTipRecord({
                    mode: 'add',
                    interactionId: target.interaction.interactionId,
                    recipientPubkey,
                    amount,
                    receipt: recordedReceipt,
                    recordClientNonce,
                });
                const result = await runWithDiscussionSessionRecovery({
                    useSessionTokenAuth,
                    getToken: ensureDiscussionSessionToken,
                    resetSession: resetDiscussionSession,
                    run: async (discussionAccessToken) => recordTipTransferReceipt({
                        circleId: discussionCircleId,
                        senderPubkey: viewerSessionPubkey,
                        discussionAccessToken: discussionAccessToken || undefined,
                        interactionId: target.interaction.interactionId,
                        clientNonce: recordClientNonce,
                        receipt: recordedReceipt,
                    }),
                });
                upsertAnchoredInteraction(result.interaction);
            }

            setPendingInitialTipRecord(null);
            setTipTransferTarget(null);
            setDiscussionStatus(t('anchoredInteraction.tipRecorded'));
        } catch (error) {
            if (receipt) {
                if (target.mode === 'initial') {
                    setPendingInitialTipRecord({
                        mode: 'initial',
                        anchorEnvelopeId: target.message.envelopeId || '',
                        recipientPubkey,
                        amount,
                        receipt,
                        createClientNonce,
                        recordClientNonce,
                    });
                } else {
                    setPendingInitialTipRecord({
                        mode: 'add',
                        interactionId: target.interaction.interactionId,
                        recipientPubkey,
                        amount,
                        receipt,
                        recordClientNonce,
                    });
                }
            }
            const message = error instanceof Error ? error.message : t('anchoredInteraction.errors.tipTransferFailedGeneric');
            setTipTransferError(t('anchoredInteraction.errors.tipTransferFailed', { error: message }));
        } finally {
            setCreatingTipTransfer(false);
        }
    }, [
        discussionCircleId,
        ensureDiscussionSessionToken,
        pendingInitialTipRecord,
        recordTipTransferReceipt,
        resetDiscussionSession,
        runTipTransfer,
        t,
        tipTransferTarget,
        upsertAnchoredInteraction,
        useSessionTokenAuth,
        viewerHasRegisteredIdentity,
        viewerIdentityWriteError,
        viewerSessionPubkey,
        walletPubkey,
    ]);

    const handleAnchoredInteractionParticipate = useCallback(async (
        interaction: DiscussionAnchoredInteractionDto,
        event: AnchoredInteractionEventDraft,
    ) => {
        if (!viewerHasRegisteredIdentity || !viewerSessionPubkey) {
            setAnchoredInteractionCardError({ interactionId: interaction.interactionId, message: viewerIdentityWriteError });
            return;
        }
        const pendingKey = `${interaction.interactionId}:${event.eventKind}`;
        setAnchoredInteractionPendingKey(pendingKey);
        setAnchoredInteractionCardError(null);
        const clientWrite = createDiscussionClientWriteIdentity();
        try {
            const result = await runWithDiscussionSessionRecovery({
                useSessionTokenAuth,
                getToken: ensureDiscussionSessionToken,
                resetSession: resetDiscussionSession,
                run: async (discussionAccessToken) => {
                    if (event.eventKind !== 'tip_transfer_initiated') {
                        return appendAnchoredInteractionEvent({
                            circleId: discussionCircleId,
                            senderPubkey: viewerSessionPubkey,
                            discussionAccessToken: discussionAccessToken || undefined,
                            interactionId: interaction.interactionId,
                            clientNonce: clientWrite.nonce,
                            eventKind: event.eventKind,
                            payload: event.payload,
                        });
                    }
                    const existingReceipt = pendingTipReceiptsByInteractionId[interaction.interactionId];
                    const receipt = existingReceipt || await runTipTransfer({
                        recipientPubkey: typeof event.payload.recipientPubkey === 'string'
                            ? event.payload.recipientPubkey
                            : '',
                        amount: typeof event.payload.amount === 'string'
                            ? event.payload.amount
                            : '',
                        assetType: event.payload.assetType === 'SPL' ? 'SPL' : 'SOL',
                        mint: typeof event.payload.mint === 'string' ? event.payload.mint : null,
                    });
                    if (!existingReceipt) {
                        setPendingTipReceiptsByInteractionId((prev) => ({
                            ...prev,
                            [interaction.interactionId]: receipt,
                        }));
                    }
                    const recorded = await recordTipTransferReceipt({
                        circleId: discussionCircleId,
                        senderPubkey: viewerSessionPubkey,
                        discussionAccessToken: discussionAccessToken || undefined,
                        interactionId: interaction.interactionId,
                        clientNonce: clientWrite.nonce,
                        receipt,
                    });
                    setPendingTipReceiptsByInteractionId((prev) => {
                        const next = { ...prev };
                        delete next[interaction.interactionId];
                        return next;
                    });
                    return recorded;
                },
            });
            upsertAnchoredInteraction(result.interaction);
            setDiscussionStatus(t('anchoredInteraction.updated'));
        } catch (error) {
            const message = error instanceof Error ? error.message : t('anchoredInteraction.errors.participateFailedGeneric');
            setAnchoredInteractionCardError({
                interactionId: interaction.interactionId,
                message: t('anchoredInteraction.errors.participateFailed', { error: message }),
            });
        } finally {
            setAnchoredInteractionPendingKey(null);
        }
    }, [
        discussionCircleId,
        ensureDiscussionSessionToken,
        pendingTipReceiptsByInteractionId,
        recordTipTransferReceipt,
        resetDiscussionSession,
        runTipTransfer,
        t,
        upsertAnchoredInteraction,
        useSessionTokenAuth,
        viewerHasRegisteredIdentity,
        viewerIdentityWriteError,
        viewerSessionPubkey,
    ]);

    const handleResolveAnchoredInteraction = useCallback(async (interaction: DiscussionAnchoredInteractionDto) => {
        if (!viewerHasRegisteredIdentity || !viewerSessionPubkey) {
            setAnchoredInteractionCardError({ interactionId: interaction.interactionId, message: viewerIdentityWriteError });
            return;
        }
        const pendingKey = `${interaction.interactionId}:resolve`;
        setAnchoredInteractionPendingKey(pendingKey);
        setAnchoredInteractionCardError(null);
        try {
            const result = await runWithDiscussionSessionRecovery({
                useSessionTokenAuth,
                getToken: ensureDiscussionSessionToken,
                resetSession: resetDiscussionSession,
                run: (discussionAccessToken) => resolveAnchoredInteraction({
                    circleId: discussionCircleId,
                    senderPubkey: viewerSessionPubkey,
                    discussionAccessToken: discussionAccessToken || undefined,
                    interactionId: interaction.interactionId,
                    explicitClose: false,
                }),
            });
            upsertAnchoredInteraction(result.interaction);
            const resultStatus = typeof result.result?.status === 'string' ? result.result.status : null;
            if (result.resultNoticeEnvelopeId || result.noticeEnvelopeId) {
                setDiscussionStatus(t('anchoredInteraction.resultPublished'));
            } else if (resultStatus === 'pending') {
                setDiscussionStatus(t('anchoredInteraction.resultPending'));
            } else {
                setDiscussionStatus(t('anchoredInteraction.resultChecked'));
            }
        } catch (error) {
            const message = error instanceof Error ? error.message : t('anchoredInteraction.errors.resolveFailedGeneric');
            setAnchoredInteractionCardError({
                interactionId: interaction.interactionId,
                message: t('anchoredInteraction.errors.resolveFailed', { error: message }),
            });
        } finally {
            setAnchoredInteractionPendingKey(null);
        }
    }, [
        discussionCircleId,
        ensureDiscussionSessionToken,
        resetDiscussionSession,
        t,
        upsertAnchoredInteraction,
        useSessionTokenAuth,
        viewerHasRegisteredIdentity,
        viewerIdentityWriteError,
        viewerSessionPubkey,
    ]);

    const handleOpenAnchoredInteractionDetail = useCallback(async (interactionId: string) => {
        setAnchoredInteractionDetailLoadingId(interactionId);
        setAnchoredInteractionDetailError(null);
        try {
            const detail = await fetchAnchoredInteractionDetail({
                circleId: discussionCircleId,
                interactionId,
            });
            upsertAnchoredInteraction(detail.interaction);
            setAnchoredInteractionDetail(detail);
        } catch (error) {
            const message = error instanceof Error ? error.message : t('anchoredInteraction.errors.detailFailedGeneric');
            setAnchoredInteractionDetailError(t('anchoredInteraction.errors.detailFailed', { error: message }));
            setAnchoredInteractionDetail(null);
        } finally {
            setAnchoredInteractionDetailLoadingId(null);
        }
    }, [discussionCircleId, t, upsertAnchoredInteraction]);

    const handleSelectAnchoredInteractionFromField = useCallback((item: AnchoredInteractionFieldItem) => {
        const interaction = item.interaction;
        setShowAnchoredInteractionField(false);
        setFocusedAnchoredInteractionId(interaction.interactionId);
        if (interaction.anchor.type === 'discussion_message' && interaction.anchor.ref) {
            setFocusedEnvelopeId(interaction.anchor.ref);
            window.setTimeout(() => {
                void handleOpenAnchoredInteractionDetail(interaction.interactionId);
            }, 260);
            return;
        }
        const escapedInteractionId =
            typeof CSS !== 'undefined' && typeof CSS.escape === 'function'
                ? CSS.escape(interaction.interactionId)
                : interaction.interactionId.replace(/"/g, '\\"');
        const node = document.querySelector<HTMLElement>(`[data-anchored-interaction-id="${escapedInteractionId}"]`);
        node?.scrollIntoView({ behavior: 'smooth', block: 'center' });
        window.setTimeout(() => {
            void handleOpenAnchoredInteractionDetail(interaction.interactionId);
        }, 260);
    }, [handleOpenAnchoredInteractionDetail]);

    const handleOpenForwardSource = useCallback((message: PlazaMessage) => {
        const sourceCircleId = message.forwardCard?.sourceCircleId;
        const sourceEnvelopeId = message.forwardCard?.sourceEnvelopeId;
        if (!sourceCircleId || !sourceEnvelopeId || message.forwardCard?.sourceDeleted) return;
        router.push(buildCircleTabHref(sourceCircleId, 'plaza', sourceEnvelopeId));
    }, [router]);

    const handleOpenForwardBundleSource = useCallback((
        message: PlazaMessage,
        sourceEnvelopeId: string,
        sourceDeleted: boolean,
    ) => {
        const sourceCircleId = message.forwardBundleCard?.sourceCircleId;
        if (!sourceCircleId || !sourceEnvelopeId || sourceDeleted) return;
        router.push(buildCircleTabHref(sourceCircleId, 'plaza', sourceEnvelopeId));
    }, [router]);

    const toggleForwardBundleExpanded = useCallback((bundleKey: string) => {
        setExpandedForwardBundleIds((prev) => {
            const next = new Set(prev);
            if (next.has(bundleKey)) {
                next.delete(bundleKey);
            } else {
                next.add(bundleKey);
            }
            return next;
        });
    }, []);

    const handleMessageTap = useCallback((msgId: number) => {
        setActionSheetMsgId(msgId);
    }, []);

    const handleMessageLongPress = useCallback((msgId: number) => {
        setActionSheetMsgId(msgId);
    }, []);

    const shouldSkipRowGesture = useCallback((target: EventTarget | null): boolean => {
        return shouldSkipPlazaMessageGestureTarget(target as HTMLElement | null);
    }, []);

    /* ── Per-message gesture handlers (long-press detection) ── */
    const startMsgGesture = useCallback((msgId: number, clientX: number, clientY: number) => {
        longPressFired.current.delete(msgId);
        gestureMoved.current.delete(msgId);
        touchStartPos.current.set(msgId, { x: clientX, y: clientY });
        const timer = setTimeout(() => {
            longPressFired.current.add(msgId);
            if (typeof navigator !== 'undefined' && navigator.vibrate) navigator.vibrate(30);
            handleMessageLongPress(msgId);
        }, 500);
        longPressTimers.current.set(msgId, timer);
    }, [handleMessageLongPress]);

    const moveMsgGesture = useCallback((msgId: number, clientX: number, clientY: number) => {
        const start = touchStartPos.current.get(msgId);
        if (!start) return;
        if (didPlazaMessageGestureMove({
            startX: start.x,
            startY: start.y,
            currentX: clientX,
            currentY: clientY,
        })) {
            gestureMoved.current.add(msgId);
            const timer = longPressTimers.current.get(msgId);
            if (timer) { clearTimeout(timer); longPressTimers.current.delete(msgId); }
        }
    }, []);

    const endMsgGesture = useCallback((msgId: number) => {
        const gestureStarted = touchStartPos.current.has(msgId);
        const timer = longPressTimers.current.get(msgId);
        if (timer) { clearTimeout(timer); longPressTimers.current.delete(msgId); }
        if (shouldOpenPlazaMessageActionSheet({
            gestureStarted,
            longPressFired: longPressFired.current.has(msgId),
            movedBeyondTapSlop: gestureMoved.current.has(msgId),
        })) {
            handleMessageTap(msgId);
        }
        longPressFired.current.delete(msgId);
        gestureMoved.current.delete(msgId);
        touchStartPos.current.delete(msgId);
    }, [handleMessageTap]);

    const cancelMsgGesture = useCallback((msgId: number) => {
        const timer = longPressTimers.current.get(msgId);
        if (timer) { clearTimeout(timer); longPressTimers.current.delete(msgId); }
        longPressFired.current.delete(msgId);
        gestureMoved.current.delete(msgId);
        touchStartPos.current.delete(msgId);
    }, []);

    const startReplyQuoteGesture = useCallback((key: string, quote: PlazaReplyQuote, clientX: number, clientY: number) => {
        replyQuoteLongPressFired.current.delete(key);
        replyQuoteGestureMoved.current.delete(key);
        replyQuoteStartPos.current.set(key, { x: clientX, y: clientY });
        const timer = setTimeout(() => {
            if (!shouldOpenPlazaReplyQuoteMenu({
                gestureStarted: replyQuoteStartPos.current.has(key),
                movedBeyondTapSlop: replyQuoteGestureMoved.current.has(key),
            })) {
                return;
            }
            replyQuoteLongPressFired.current.add(key);
            if (typeof navigator !== 'undefined' && navigator.vibrate) navigator.vibrate(20);
            setReplyQuoteMenu({ key, quote });
        }, 500);
        replyQuoteLongPressTimers.current.set(key, timer);
    }, []);

    const moveReplyQuoteGesture = useCallback((key: string, clientX: number, clientY: number) => {
        const start = replyQuoteStartPos.current.get(key);
        if (!start) return;
        if (didPlazaMessageGestureMove({
            startX: start.x,
            startY: start.y,
            currentX: clientX,
            currentY: clientY,
        })) {
            replyQuoteGestureMoved.current.add(key);
            const timer = replyQuoteLongPressTimers.current.get(key);
            if (timer) { clearTimeout(timer); replyQuoteLongPressTimers.current.delete(key); }
        }
    }, []);

    const endReplyQuoteGesture = useCallback((key: string) => {
        const timer = replyQuoteLongPressTimers.current.get(key);
        if (timer) { clearTimeout(timer); replyQuoteLongPressTimers.current.delete(key); }
        replyQuoteLongPressFired.current.delete(key);
        replyQuoteGestureMoved.current.delete(key);
        replyQuoteStartPos.current.delete(key);
    }, []);

    const cancelReplyQuoteGesture = useCallback((key: string) => {
        const timer = replyQuoteLongPressTimers.current.get(key);
        if (timer) { clearTimeout(timer); replyQuoteLongPressTimers.current.delete(key); }
        replyQuoteLongPressFired.current.delete(key);
        replyQuoteGestureMoved.current.delete(key);
        replyQuoteStartPos.current.delete(key);
    }, []);

    const renderReplyQuoteMenu = useCallback((key: string, quote: PlazaReplyQuote, isExpanded: boolean) => {
        if (replyQuoteMenu?.key !== key) return null;
        const canShowFull = shouldShowFullPlazaReplyQuote(quote, {
            isVisuallyTruncated: truncatedReplyQuoteKeys.has(key),
        }) && !isExpanded;
        return (
            <span className={styles.replyQuoteMenu} data-msg-action="1">
                <button
                    type="button"
                    className={styles.replyQuoteMenuButton}
                    onClick={(e) => {
                        e.stopPropagation();
                        handleReplyToQuote(quote);
                    }}
                >
                    {t('reply.quoteActions.quickReply')}
                </button>
                <button
                    type="button"
                    className={styles.replyQuoteMenuButton}
                    onClick={(e) => {
                        e.stopPropagation();
                        handleFocusReplyQuote(quote);
                    }}
                >
                    {t('reply.quoteActions.locateOriginal')}
                </button>
                {canShowFull && (
                    <button
                        type="button"
                        className={styles.replyQuoteMenuButton}
                        onClick={(e) => {
                            e.stopPropagation();
                            handleShowFullReplyQuote(key);
                        }}
                    >
                        {t('reply.quoteActions.showFull')}
                    </button>
                )}
            </span>
        );
    }, [handleFocusReplyQuote, handleReplyToQuote, handleShowFullReplyQuote, replyQuoteMenu?.key, t, truncatedReplyQuoteKeys]);

    const handleCopy = useCallback((msgId: number) => {
        const msg = localMessages.find((m) => m.id === msgId);
        if (msg) navigator.clipboard.writeText(msg.text);
        setActionSheetMsgId(null);
    }, [localMessages]);

    const handleDelete = useCallback(async (msgId: number) => {
        const target = localMessages.find((m) => m.id === msgId);
        if (!target) {
            setActionSheetMsgId(null);
            return;
        }

        setActionSheetMsgId(null);
        setLocalMessages((prev) =>
            prev.map((m) =>
                m.id === msgId
                    ? {
                        ...m,
                        deleted: true,
                        text: t('messages.deleted'),
                        sendState: 'pending',
                    }
                    : m,
            ),
        );

        if (!target.envelopeId || !viewerSessionPubkey) {
            setLocalMessages((prev) =>
                prev.map((m) =>
                    m.id === msgId
                        ? {
                            ...m,
                            sendState: 'sent',
                            errorHint: viewerSessionPubkey ? undefined : t('status.localDeleteOnly'),
                        }
                        : m,
                ),
            );
            return;
        }

        const senderPubkey = viewerSessionPubkey;
        const envelopeId = target.envelopeId;
        try {
            const result = await runWithDiscussionSessionRecovery({
                useSessionTokenAuth,
                getToken: ensureDiscussionSessionToken,
                resetSession: resetDiscussionSession,
                run: (discussionAccessToken) => tombstoneDiscussionMessage({
                    circleId: discussionCircleId,
                    envelopeId,
                    senderPubkey,
                    signMessage: shouldSignEachMessage ? signMessage : undefined,
                    discussionAccessToken: discussionAccessToken || undefined,
                }),
            });
            const mapped = mapDiscussionDtoToPlazaMessage(result.message, {
                locale,
                deletedText: t('messages.deleted'),
            });
            mapped.sendState = 'sent';
            setLastEnvelopeId(result.message.envelopeId);
            setLocalMessages((prev) => prev.map((m) => (m.id === msgId ? mapped : m)));
        } catch (error) {
            const hint = error instanceof Error ? error.message : t('errors.deleteFailed');
            setLocalMessages((prev) =>
                prev.map((m) =>
                    m.id === msgId
                        ? {
                            ...m,
                            sendState: 'failed',
                            errorHint: hint,
                        }
                        : m,
                ),
            );
            setDiscussionError(hint);
        }
    }, [
        discussionCircleId,
        ensureDiscussionSessionToken,
        localMessages,
        resetDiscussionSession,
        shouldSignEachMessage,
        signMessage,
        useSessionTokenAuth,
        viewerSessionPubkey,
    ]);

    const openCrucibleAfterDraftsRefresh = useCallback((draftPostId: number) => {
        if (!Number.isFinite(draftPostId) || draftPostId <= 0) return;
        void (async () => {
            try {
                await onDraftsChanged?.();
            } finally {
                onOpenCrucible?.(draftPostId);
            }
        })();
    }, [onDraftsChanged, onOpenCrucible]);

    const handleCandidateCreateDraft = useCallback(async (notice: DraftCandidateInlineNotice) => {
        if (creatingCandidateDraftId) return;
        if (!viewerHasRegisteredIdentity || !viewerSessionPubkey) {
            setDiscussionStatus(t('candidate.createDenied', { candidateId: notice.candidateId.slice(0, 8) }));
            return;
        }
        setCreatingCandidateDraftId(notice.candidateId);
        setDiscussionError(null);
        try {
            const response = await createDraftFromCandidate({
                circleId: discussionCircleId,
                candidateId: notice.candidateId,
            });
            const candidateId = notice.candidateId.slice(0, 8);
            if (response.result.status === 'pending') {
                setPendingCandidateDraftIds((prev) => new Set(prev).add(notice.candidateId));
                setDiscussionStatus(t('candidate.createPending', { candidateId }));
                return;
            }
            setPendingCandidateDraftIds((prev) => {
                if (!prev.has(notice.candidateId)) return prev;
                const next = new Set(prev);
                next.delete(notice.candidateId);
                return next;
            });
            if (response.result.status === 'generation_failed') {
                setDiscussionStatus(t('candidate.createFailed', {
                    candidateId,
                    error: response.result.draftGenerationError,
                }));
                return;
            }
            if (response.result.status === 'created' || response.result.status === 'existing') {
                setDiscussionStatus(
                    response.result.status === 'created'
                        ? t('candidate.createSucceeded', { candidateId })
                        : t('candidate.createExistingDraft', { candidateId }),
                );
                openCrucibleAfterDraftsRefresh(response.result.draftPostId);
            }
        } catch (error) {
            const code = typeof (error as { code?: unknown })?.code === 'string'
                ? (error as { code: string }).code
                : '';
            const candidateId = notice.candidateId.slice(0, 8);
            if (code === 'candidate_generation_forbidden' || code === 'authentication_required') {
                setDiscussionStatus(t('candidate.createDenied', { candidateId }));
            } else if (code === 'draft_candidate_not_ready') {
                setDiscussionStatus(t('candidate.createNotReady', { candidateId }));
            } else if (code === 'draft_candidate_missing_sources') {
                setDiscussionStatus(t('candidate.createMissingSources', { candidateId }));
            } else {
                setDiscussionError(error instanceof Error ? error.message : t('errors.sendFailed'));
            }
            setPendingCandidateDraftIds((prev) => {
                if (!prev.has(notice.candidateId)) return prev;
                const next = new Set(prev);
                next.delete(notice.candidateId);
                return next;
            });
        } finally {
            setCreatingCandidateDraftId((current) => (current === notice.candidateId ? null : current));
        }
    }, [
        creatingCandidateDraftId,
        discussionCircleId,
        openCrucibleAfterDraftsRefresh,
        t,
        viewerHasRegisteredIdentity,
        viewerSessionPubkey,
    ]);

    const handleCreateDraftFromDiscussion = useCallback(async () => {
        if (creatingDiscussionDraft) return;
        if (!viewerHasRegisteredIdentity || !viewerSessionPubkey) {
            setDiscussionStatus(t('manualDraft.selection.disabledNoIdentity'));
            return;
        }
        if (!viewerCanCreateManualDiscussionDraft) {
            setDiscussionStatus(t('manualDraft.selection.permissionRequired'));
            return;
        }
        if (manualDraftSourceMessageIds.length === 0) {
            setDiscussionStatus(t('manualDraft.selection.noEligibleSelection'));
            return;
        }

        setCreatingDiscussionDraft(true);
        setShowPanel(false);
        setDiscussionError(null);
        setDiscussionStatus(t('manualDraft.creating', { count: manualDraftSourceMessageIds.length }));
        try {
            const response = await createDraftFromDiscussionMessages({
                circleId: discussionCircleId,
                sourceMessageIds: manualDraftSourceMessageIds,
                sourceScope: manualDraftSourceScope,
            });

            if (response.result.status === 'pending') {
                setDiscussionStatus(t('manualDraft.pending'));
                return;
            }
            if (response.result.status === 'generation_failed') {
                setDiscussionStatus(t('manualDraft.failed', {
                    error: response.result.draftGenerationError,
                }));
                return;
            }
            if (response.result.status === 'created' || response.result.status === 'existing') {
                setDiscussionStatus(formatManualDraftCreateResultMessage(response));
                openCrucibleAfterDraftsRefresh(response.result.draftPostId);
            }
        } catch (error) {
            const message = formatManualDraftCreateErrorMessage(error);
            const code = readRequestErrorCode(error);
            if (
                code === 'candidate_generation_forbidden'
                || code === 'authentication_required'
                || code === 'draft_candidate_missing_sources'
                || code === 'invalid_source_message_ids'
                || code === 'source_already_consumed'
            ) {
                setDiscussionStatus(message);
            } else {
                setDiscussionError(message);
            }
        } finally {
            setCreatingDiscussionDraft(false);
        }
    }, [
        creatingDiscussionDraft,
        discussionCircleId,
        formatManualDraftCreateErrorMessage,
        formatManualDraftCreateResultMessage,
        manualDraftSourceMessageIds,
        manualDraftSourceScope,
        openCrucibleAfterDraftsRefresh,
        t,
        viewerCanCreateManualDiscussionDraft,
        viewerHasRegisteredIdentity,
        viewerSessionPubkey,
    ]);

    const handleStartManualDraftSelection = useCallback(() => {
        if (manualDraftSelectionDisabledReason) {
            setDiscussionStatus(manualDraftSelectionDisabledReason);
            return;
        }
        setMessageSelectionMode('draft');
        setSelectedMessageEnvelopeIds(new Set());
        setMessageSelectionError(null);
        setShowPanel(false);
        setShowForwardPicker(false);
        setForwardingMessageId(null);
        setShowBatchForwardPicker(false);
    }, [manualDraftSelectionDisabledReason]);

    const handleStartGovernanceCaseSelection = useCallback(() => {
        if (manualDraftSelectionDisabledReason) {
            setDiscussionStatus(manualDraftSelectionDisabledReason);
            return;
        }
        setMessageSelectionMode('case');
        setSelectedMessageEnvelopeIds(new Set());
        setGovernanceCaseTitle('');
        setGovernanceRequestedDecision('');
        setGovernanceCaseTemplate(null);
        setGovernanceCaseSuggestions([]);
        setGovernanceCasePreflightAcknowledged(false);
        setGovernanceCaseRelationship(null);
        setGovernanceCaseRelationshipReason('');
        setMessageSelectionError(null);
        setShowPanel(false);
        setShowForwardPicker(false);
        setForwardingMessageId(null);
        setShowBatchForwardPicker(false);
    }, [manualDraftSelectionDisabledReason]);

    const handleStartBatchForwardSelection = useCallback(() => {
        if (forwardSelectionDisabledReason) {
            setDiscussionStatus(forwardSelectionDisabledReason);
            return;
        }
        setMessageSelectionMode('forward');
        setSelectedMessageEnvelopeIds(new Set());
        setMessageSelectionError(null);
        setShowPanel(false);
        setShowForwardPicker(false);
        setForwardingMessageId(null);
        setShowBatchForwardPicker(false);
        setActionSheetMsgId(null);
    }, [forwardSelectionDisabledReason]);

    const handleStartBatchForwardFromActionSheet = useCallback(() => {
        if (!actionSheetMessage || !isSelectablePlazaMessageForAction(actionSheetMessage, 'forward')) {
            setActionSheetMsgId(null);
            return;
        }
        if (forwardSelectionDisabledReason) {
            setDiscussionStatus(forwardSelectionDisabledReason);
            setActionSheetMsgId(null);
            return;
        }
        setMessageSelectionMode('forward');
        setSelectedMessageEnvelopeIds(new Set([actionSheetMessage.envelopeId]));
        setMessageSelectionError(null);
        setShowPanel(false);
        setShowForwardPicker(false);
        setForwardingMessageId(null);
        setShowBatchForwardPicker(false);
        setActionSheetMsgId(null);
    }, [actionSheetMessage, forwardSelectionDisabledReason]);

    const handleCancelMessageSelection = useCallback(() => {
        setMessageSelectionMode(null);
        setSelectedMessageEnvelopeIds(new Set());
        setMessageSelectionError(null);
        setShowBatchForwardPicker(false);
        setGovernanceCaseTitle('');
        setGovernanceRequestedDecision('');
        setGovernanceCaseTemplate(null);
        setGovernanceCaseSuggestions([]);
        setGovernanceCasePreflightAcknowledged(false);
        setGovernanceCaseRelationship(null);
        setGovernanceCaseRelationshipReason('');
    }, []);

    const handleToggleSelectedMessage = useCallback((message: PlazaMessage) => {
        if (!messageSelectionMode || showBatchForwardPicker) return;
        if (!isSelectablePlazaMessageForAction(message, messageSelectionMode)) return;
        if (messageSelectionMode === 'case') {
            setGovernanceCaseSuggestions([]);
            setGovernanceCasePreflightAcknowledged(false);
            setGovernanceCaseRelationship(null);
            setGovernanceCaseRelationshipReason('');
        }
        setSelectedMessageEnvelopeIds((prev) => {
            const next = new Set(prev);
            if (next.has(message.envelopeId)) {
                next.delete(message.envelopeId);
                setMessageSelectionError(null);
                return next;
            }
            if (next.size >= MESSAGE_SELECTION_LIMIT) {
                const limitMessage = t(
                    messageSelectionMode === 'draft' || messageSelectionMode === 'case'
                        ? 'manualDraft.selection.maxReached'
                        : 'forward.selection.maxReached',
                    { count: MESSAGE_SELECTION_LIMIT },
                );
                setMessageSelectionError(limitMessage);
                setDiscussionStatus(limitMessage);
                return prev;
            }
            next.add(message.envelopeId);
            setMessageSelectionError(null);
            return next;
        });
    }, [messageSelectionMode, showBatchForwardPicker, t]);

    const handleOpenBatchForwardPicker = useCallback(() => {
        if (forwardSelectionDisabledReason) {
            setMessageSelectionError(forwardSelectionDisabledReason);
            setDiscussionStatus(forwardSelectionDisabledReason);
            return;
        }
        if (selectedForwardMessageIds.length === 0) {
            const message = t('forward.selection.noEligibleSelection');
            setMessageSelectionError(message);
            return;
        }
        setMessageSelectionError(null);
        setShowBatchForwardPicker(true);
    }, [forwardSelectionDisabledReason, selectedForwardMessageIds.length, t]);

    const handleBatchForwardSelect = useCallback(async (target: PickerCircle) => {
        if (selectedForwardMessageIds.length === 0) {
            setShowBatchForwardPicker(false);
            return;
        }
        const sourceEnvelopeIds = selectedForwardMessageIds;
        try {
            setDiscussionError(null);
            setMessageSelectionError(null);
            const response = await forwardDiscussionMessagesBatch({
                sourceEnvelopeIds,
                targetCircleId: Number(target.subCircleId),
            });
            setDiscussionStatus(response.status === 'existing'
                ? t('status.forwardBundleAlreadyForwarded', {
                    circleName: target.subCircleName,
                    count: sourceEnvelopeIds.length,
                })
                : t('status.forwardedToCircle', { circleName: target.subCircleName }));
            setMessageSelectionMode(null);
            setSelectedMessageEnvelopeIds(new Set());
        } catch (error) {
            const errorMessage = error instanceof Error ? error.message : t('errors.forwardFailed');
            setMessageSelectionError(errorMessage);
            setDiscussionError(errorMessage);
        } finally {
            setShowBatchForwardPicker(false);
        }
    }, [selectedForwardMessageIds, t]);

    const handleCreateDraftFromSelectedMessages = useCallback(async () => {
        if (creatingDiscussionDraft) return;
        if (!viewerHasRegisteredIdentity || !viewerSessionPubkey) {
            setMessageSelectionError(t('manualDraft.selection.disabledNoIdentity'));
            return;
        }
        if (!viewerCanCreateManualDiscussionDraft) {
            setMessageSelectionError(t('manualDraft.selection.permissionRequired'));
            return;
        }
        if (selectedManualDraftSourceMessageIds.length === 0) {
            setMessageSelectionError(t('manualDraft.selection.noEligibleSelection'));
            return;
        }

        setCreatingDiscussionDraft(true);
        setDiscussionError(null);
        setMessageSelectionError(null);
        setDiscussionStatus(t('manualDraft.creating', { count: selectedManualDraftSourceMessageIds.length }));
        try {
            const response = await createDraftFromDiscussionMessages({
                circleId: discussionCircleId,
                sourceMessageIds: selectedManualDraftSourceMessageIds,
                sourceScope: manualDraftSourceScope,
            });

            if (response.result.status === 'pending') {
                setDiscussionStatus(t('manualDraft.pending'));
                setMessageSelectionMode(null);
                setSelectedMessageEnvelopeIds(new Set());
                return;
            }
            if (response.result.status === 'generation_failed') {
                setDiscussionStatus(t('manualDraft.failed', {
                    error: response.result.draftGenerationError,
                }));
                return;
            }
            if (response.result.status === 'created' || response.result.status === 'existing') {
                setDiscussionStatus(formatManualDraftCreateResultMessage(response));
                setMessageSelectionMode(null);
                setSelectedMessageEnvelopeIds(new Set());
                openCrucibleAfterDraftsRefresh(response.result.draftPostId);
            }
        } catch (error) {
            setMessageSelectionError(formatManualDraftCreateErrorMessage(error));
        } finally {
            setCreatingDiscussionDraft(false);
        }
    }, [
        creatingDiscussionDraft,
        discussionCircleId,
        formatManualDraftCreateErrorMessage,
        formatManualDraftCreateResultMessage,
        manualDraftSourceScope,
        openCrucibleAfterDraftsRefresh,
        selectedManualDraftSourceMessageIds,
        t,
        viewerCanCreateManualDiscussionDraft,
        viewerHasRegisteredIdentity,
        viewerSessionPubkey,
    ]);

    const handleCreateCaseFromSelectedMessages = useCallback(async () => {
        if (creatingDiscussionDraft) return;
        if (!viewerHasRegisteredIdentity || !viewerSessionPubkey) {
            setMessageSelectionError(t('manualDraft.selection.disabledNoIdentity'));
            return;
        }
        if (!viewerCanCreateManualDiscussionDraft) {
            setMessageSelectionError(t('manualDraft.selection.permissionRequired'));
            return;
        }
        if (selectedGovernanceCaseSourceMessageIds.length === 0) {
            setMessageSelectionError(t('governanceCase.selection.noSources'));
            return;
        }
        const title = governanceCaseTitle.trim();
        const requestedDecision = governanceRequestedDecision.trim();
        if (title.length < 3 || requestedDecision.length < 10) {
            setMessageSelectionError(t('governanceCase.selection.requiredFields'));
            return;
        }
        if (!governanceCaseTemplate) {
            setMessageSelectionError(t('governanceCase.selection.templateRequired'));
            return;
        }
        if (
            governanceCaseRelationship?.kind === 'supersedes'
            && governanceCaseRelationshipReason.trim().length < 10
        ) {
            setMessageSelectionError(t('governanceCase.selection.correctionReasonRequired'));
            return;
        }

        setCreatingDiscussionDraft(true);
        setMessageSelectionError(null);
        try {
            if (!governanceCasePreflightAcknowledged) {
                const matches = await preflightGovernanceCaseIntake({
                    circleId: discussionCircleId,
                    title,
                    originKind: 'plaza_selection',
                    sourceMessageIds: selectedGovernanceCaseSourceMessageIds,
                });
                if (matches.length > 0) {
                    setGovernanceCaseSuggestions(matches);
                    return;
                }
            }
            const result = await createGovernanceCaseIntake({
                circleId: discussionCircleId,
                title,
                requestedDecision,
                caseType: 'signal',
                templateId: governanceCaseTemplate.templateId,
                originKind: 'plaza_selection',
                sourceMessageIds: selectedGovernanceCaseSourceMessageIds,
                relationshipKind: governanceCaseRelationship?.kind ?? null,
                relatedCaseId: governanceCaseRelationship?.caseId ?? null,
                relationshipReason: governanceCaseRelationship?.kind === 'supersedes'
                    ? governanceCaseRelationshipReason.trim()
                    : null,
                idempotencyKey: createGovernanceCaseIdempotencyKey(),
            });
            setMessageSelectionMode(null);
            setSelectedMessageEnvelopeIds(new Set());
            setGovernanceCaseTitle('');
            setGovernanceRequestedDecision('');
            setGovernanceCaseTemplate(null);
            setGovernanceCaseSuggestions([]);
            setGovernanceCasePreflightAcknowledged(false);
            setGovernanceCaseRelationship(null);
            setGovernanceCaseRelationshipReason('');
            router.push(result.case.canonicalUrl);
        } catch {
            setMessageSelectionError(t('governanceCase.selection.failed'));
        } finally {
            setCreatingDiscussionDraft(false);
        }
    }, [
        creatingDiscussionDraft,
        discussionCircleId,
        governanceCaseTitle,
        governanceRequestedDecision,
        governanceCaseTemplate,
        governanceCasePreflightAcknowledged,
        governanceCaseRelationship,
        governanceCaseRelationshipReason,
        router,
        selectedGovernanceCaseSourceMessageIds,
        t,
        viewerCanCreateManualDiscussionDraft,
        viewerHasRegisteredIdentity,
        viewerSessionPubkey,
    ]);

    const handleCandidateRetry = useCallback((notice: DraftCandidateInlineNotice) => {
        const recovery = resolveCandidateRecoveryActions({
            notice,
            viewerIdentity,
        });
        if (!recovery.canRetry) {
            setDiscussionStatus(t('candidate.retryDenied', {
                candidateId: notice.candidateId.slice(0, 8),
            }));
            return;
        }
        void handleCandidateCreateDraft(notice);
    }, [handleCandidateCreateDraft, t, viewerIdentity]);

    const handleCandidateCancel = useCallback(async (notice: DraftCandidateInlineNotice) => {
        const recovery = resolveCandidateRecoveryActions({
            notice,
            viewerIdentity,
        });
        if (!recovery.canCancel) {
            setDiscussionStatus(t('candidate.cancelDenied', {
                candidateId: notice.candidateId.slice(0, 8),
            }));
            return;
        }
        setDiscussionError(null);
        try {
            await cancelDraftCandidate({
                circleId: discussionCircleId,
                candidateId: notice.candidateId,
            });
            setCancelledCandidateIds((prev) => new Set(prev).add(notice.candidateId));
            setPendingCandidateDraftIds((prev) => {
                if (!prev.has(notice.candidateId)) return prev;
                const next = new Set(prev);
                next.delete(notice.candidateId);
                return next;
            });
            setDiscussionStatus(t('candidate.cancelSucceeded', {
                candidateId: notice.candidateId.slice(0, 8),
            }));
        } catch (error) {
            const code = typeof (error as { code?: unknown })?.code === 'string'
                ? (error as { code: string }).code
                : '';
            const candidateId = notice.candidateId.slice(0, 8);
            if (code === 'candidate_generation_forbidden' || code === 'authentication_required') {
                setDiscussionStatus(t('candidate.cancelDenied', { candidateId }));
            } else if (code === 'draft_candidate_not_ready') {
                setDiscussionStatus(t('candidate.cancelNotReady', { candidateId }));
            } else {
                setDiscussionError(error instanceof Error ? error.message : t('errors.sendFailed'));
            }
        }
    }, [discussionCircleId, t, viewerIdentity]);

    const EMOJI_LIST = [
        '😀', '😂', '🤔', '👍', '🔥', '💡', '✨', '🎯',
        '❤️', '👀', '🙌', '💪', '🤝', '📝', '⚡', '🌟',
        '😅', '🎉', '💎', '🧠', '🚀', '📚', '🔧', '✅',
    ];
    const voiceConnected = voiceStatus === 'connected';
    const voiceBusy = voiceStatus === 'joining' || voiceStatus === 'leaving';
    const voiceDisplayError = voiceError === 'wallet_signature_required'
        ? t('voice.walletRequired')
        : voiceError === 'member_not_found' || voiceError === 'room_member_not_found'
            ? t('voice.membershipRequired')
            : voiceError;
    const voicePrimaryLabel = !viewerHasRegisteredIdentity
        ? viewerIdentityWriteError
        : !viewerJoined
            ? t('voice.membershipRequired')
            : voiceStatus === 'joining'
                ? t('voice.joining')
                : voiceStatus === 'leaving'
                    ? t('voice.leaving')
                    : voiceConnected
                        ? voiceMuted
                            ? t('voice.unmute')
                            : t('voice.mute')
                        : t('voice.join');
    const voicePrimaryDisabled = voiceBusy
        || !viewerHasRegisteredIdentity
        || (!voiceConnected && !viewerJoined)
        || (voiceConnected && !voiceCanPublishAudio);
    const voiceDockMessage = voiceStatus === 'joining'
        ? t('voice.joining')
        : voiceStatus === 'leaving'
            ? t('voice.leaving')
            : voiceConnected
                ? voiceCanPublishAudio
                    ? t('voice.connected')
                    : t('voice.listenOnly')
                : voiceDisplayError || t('voice.joinFailed');
    const voiceParticipants = voiceManagement?.participants ?? [];
    const activeVoiceSpeakerCount = voiceParticipants.filter(
        (participant) => participant.role === 'speaker' && !participant.leftAt && !participant.mutedByModerator,
    ).length;
    const queuedVoiceParticipants = voiceParticipants.filter(
        (participant) => participant.role === 'queued' && !participant.leftAt,
    );
    const showVoiceManagement = Boolean(voiceConnected && voiceManagement?.permissions.canModerate);
    const getAnchoredInteractionSuggestionCreateLabel = useCallback((type: AnchoredInteractionSuggestion['suggestedInteractionType']) => {
        if (type === 'poll') return t('anchoredInteraction.suggestion.createPoll');
        if (type === 'challenge') return t('anchoredInteraction.suggestion.createChallenge');
        return t('anchoredInteraction.suggestion.createSignup');
    }, [t]);
    const getAnchoredInteractionSuggestionReasonLabel = useCallback((suggestion: AnchoredInteractionSuggestion) => {
        const key = `anchoredInteraction.suggestion.reason.${suggestion.reasonCode}`;
        const translated = t(key);
        return translated === key ? suggestion.shortReason : translated;
    }, [t]);
    const renderAnchoredInteractionCard = useCallback((interaction: DiscussionAnchoredInteractionDto) => (
        <AnchoredInteractionCard
            key={interaction.interactionId}
            interaction={interaction}
            typeLabels={anchoredInteractionTypeLabels}
            statusLabel={t(`anchoredInteraction.status.${interaction.status}`)}
            actionLabels={anchoredInteractionActionLabels}
            resolveLabels={anchoredInteractionResolveLabels}
            viewDetailsLabel={t('anchoredInteraction.viewDetails')}
            submissionPlaceholder={t('anchoredInteraction.submissionPlaceholder')}
            challengeTrustVoteLabels={{
                agree: t('anchoredInteraction.challengeTrustVoteAgree'),
                disagree: t('anchoredInteraction.challengeTrustVoteDisagree'),
            }}
            signupDisplayNameDefault={anchoredInteractionViewerDisplayName}
            signupDisplayNameLabel={t('anchoredInteraction.signupDisplayNamePlaceholder')}
            canManageInteraction={Boolean(
                viewerSessionPubkey
                && (interaction.createdByPubkey === viewerSessionPubkey || viewerCanManageAnchoredInteractions)
            )}
            managementLabels={anchoredInteractionManagementLabels}
            emptyLabels={{
                participants: t('anchoredInteraction.empty.participants'),
                votes: t('anchoredInteraction.empty.votes'),
                supporters: t('anchoredInteraction.empty.supporters'),
                reads: t('anchoredInteraction.empty.reads'),
                submissions: t('anchoredInteraction.empty.submissions'),
                tips: t('anchoredInteraction.empty.tips'),
            }}
            tipSummaryLabels={{
                receipt: t('anchoredInteraction.tipSummary.receipt'),
                transaction: t('anchoredInteraction.tipSummary.transaction'),
                failed: t('anchoredInteraction.tipSummary.failed'),
                latestReceipt: (values) => t('anchoredInteraction.tipSummary.latestReceipt', values),
                totalReceipts: (values) => t('anchoredInteraction.tipSummary.totalReceipts', values),
                addTip: t('anchoredInteraction.tipSummary.addTip'),
                sameNameMember: t('anchoredInteraction.tipSummary.sameNameMember'),
            }}
            pendingKey={anchoredInteractionPendingKey}
            errorMessage={anchoredInteractionCardError?.interactionId === interaction.interactionId
                ? anchoredInteractionCardError.message
                : null}
            viewerPubkey={viewerSessionPubkey}
            selected={focusedAnchoredInteractionId === interaction.interactionId}
            onParticipate={handleAnchoredInteractionParticipate}
            onOpenTipTransfer={(interaction) => {
                setTipTransferTarget({ mode: 'add', interaction });
                setTipTransferError(null);
                setPendingInitialTipRecord(null);
            }}
            onResolve={handleResolveAnchoredInteraction}
            onOpenDetails={(interaction) => {
                void handleOpenAnchoredInteractionDetail(interaction.interactionId);
            }}
        />
    ), [
        anchoredInteractionActionLabels,
        anchoredInteractionCardError,
        anchoredInteractionManagementLabels,
        anchoredInteractionPendingKey,
        anchoredInteractionResolveLabels,
        anchoredInteractionTypeLabels,
        anchoredInteractionViewerDisplayName,
        focusedAnchoredInteractionId,
        handleAnchoredInteractionParticipate,
        handleOpenAnchoredInteractionDetail,
        handleResolveAnchoredInteraction,
        t,
        viewerCanManageAnchoredInteractions,
        viewerSessionPubkey,
    ]);

    const tipTransferRecipientPubkey = tipTransferTarget?.mode === 'initial'
        ? tipTransferTarget.message.senderPubkey || ''
        : typeof tipTransferTarget?.interaction.state.recipientPubkey === 'string'
            ? tipTransferTarget.interaction.state.recipientPubkey
            : '';
    const tipTransferRecipientLabel = tipTransferTarget?.mode === 'initial'
        ? tipTransferTarget.message.author
        : '';
    const tipTransferPendingReceipt = Boolean(pendingInitialTipRecord && (
        tipTransferTarget?.mode === 'initial'
            ? pendingInitialTipRecord.mode === 'initial'
                && pendingInitialTipRecord.anchorEnvelopeId === tipTransferTarget.message.envelopeId
            : tipTransferTarget?.mode === 'add'
                && pendingInitialTipRecord.mode === 'add'
                && pendingInitialTipRecord.interactionId === tipTransferTarget.interaction.interactionId
    ));
    const tipTransferInitialAmount = tipTransferPendingReceipt ? pendingInitialTipRecord?.amount || '' : '';
    const topAnnouncement = announcements[0] ?? null;
    const announcementAttentionCount = announcements.filter(needsAnnouncementAttention).length;
    const shouldShowSuggestionPanelToggle = anchoredInteractionSuggestions.length > 0 || showSuggestionPanel;

    return (
        <div className={styles.plazaChat}>
            <div className={styles.discussionControls}>
                <div className={styles.discussionFilterSummaryRow}>
                    <button
                        type="button"
                        className={styles.discussionFilterToggle}
                        aria-expanded={showFilterPanel}
                        onClick={() => {
                            const nextOpen = !showFilterPanel;
                            setShowFilterPanel(nextOpen);
                            if (nextOpen) {
                                setShowAnnouncementPanel(false);
                                setShowSuggestionPanel(false);
                                setAnchoredInteractionSuggestionPanelSnapshot(null);
                            }
                        }}
                    >
                        {t('filters.title')}
                        <ChevronDown
                            size={14}
                            className={`${styles.discussionFilterChevron} ${showFilterPanel ? styles.discussionFilterChevronExpanded : ''}`}
                        />
                    </button>
                    <button
                        type="button"
                        className={`${styles.announcementPanelToggle} ${showAnnouncementPanel ? styles.announcementPanelToggleActive : ''}`}
                        aria-expanded={showAnnouncementPanel}
                        onClick={() => {
                            const nextOpen = !showAnnouncementPanel;
                            setShowAnnouncementPanel(nextOpen);
                            if (nextOpen) {
                                setShowFilterPanel(false);
                                setShowSuggestionPanel(false);
                                setAnchoredInteractionSuggestionPanelSnapshot(null);
                            }
                        }}
                    >
                        <Megaphone size={13} />
                        <span>{announcementCopy.title}</span>
                        {announcementAttentionCount > 0 && (
                            <strong className={styles.announcementPanelToggleCount}>{announcementAttentionCount}</strong>
                        )}
                        <ChevronDown
                            size={14}
                            className={`${styles.discussionFilterChevron} ${showAnnouncementPanel ? styles.discussionFilterChevronExpanded : ''}`}
                        />
                    </button>
                    {shouldShowSuggestionPanelToggle && (
                        <button
                            type="button"
                            className={`${styles.suggestionPanelToggle} ${showSuggestionPanel ? styles.suggestionPanelToggleActive : ''}`}
                            aria-expanded={showSuggestionPanel}
                            onClick={() => {
                                const nextOpen = !showSuggestionPanel;
                                setShowSuggestionPanel(nextOpen);
                                setAnchoredInteractionSuggestionPanelSnapshot(nextOpen ? anchoredInteractionSuggestions : null);
                                if (nextOpen) {
                                    setShowFilterPanel(false);
                                    setShowAnnouncementPanel(false);
                                }
                            }}
                        >
                            <Lightbulb size={13} />
                            <span>{t('anchoredInteraction.suggestion.entry')}</span>
                            {anchoredInteractionSuggestions.length > 0 && (
                                <strong className={styles.suggestionPanelToggleCount}>{anchoredInteractionSuggestions.length}</strong>
                            )}
                            <ChevronDown
                                size={14}
                                className={`${styles.discussionFilterChevron} ${showSuggestionPanel ? styles.discussionFilterChevronExpanded : ''}`}
                            />
                        </button>
                    )}
                </div>
                {showFilterPanel && (
                    <div className={styles.discussionFilterPanel}>
                        <div className={styles.discussionFilterSection}>
                            <span className={styles.discussionFilterLabel}>{t('filters.scopeLabel')}</span>
                            <div className={styles.discussionFilterGroup}>
                                <button
                                    type="button"
                                    className={`${styles.discussionModeBtn} ${viewMode === 'all' ? styles.discussionModeBtnActive : ''}`}
                                    onClick={() => setViewMode('all')}
                                >
                                    {t('filters.scope.all')}
                                </button>
                                <button
                                    type="button"
                                    className={`${styles.discussionModeBtn} ${viewMode === 'focused' ? styles.discussionModeBtnActive : ''}`}
                                    onClick={() => setViewMode('focused')}
                                >
                                    {t('filters.scope.focused')}
                                </button>
                                <button
                                    type="button"
                                    className={`${styles.discussionModeBtn} ${viewMode === 'mine' ? styles.discussionModeBtnActive : ''}`}
                                    onClick={() => setViewMode('mine')}
                                >
                                    {t('filters.scope.mine')}
                                </button>
                            </div>
                        </div>
                        <div className={styles.discussionFilterSection}>
                            <span className={styles.discussionFilterLabel}>{t('filters.contentLabel')}</span>
                            <div className={`${styles.discussionFilterGroup} ${styles.discussionContentFilters}`}>
                                {AUTHOR_ANNOTATION_VALUES.map((label) => {
                                    const selected = activeContentFilters.includes(label);
                                    return (
                                        <button
                                            key={label}
                                            type="button"
                                            className={`${styles.discussionModeBtn} ${selected ? styles.discussionModeBtnActive : ''}`}
                                            onClick={() => toggleContentFilter(label)}
                                        >
                                            {semanticFacetCopy[label]}
                                        </button>
                                    );
                                })}
                            </div>
                        </div>
                    </div>
                )}
                {showSuggestionPanel && (
                    <div className={styles.anchoredInteractionSuggestionPanel}>
                        <div className={styles.anchoredInteractionSuggestionPanelHeader}>
                            <strong>{t('anchoredInteraction.suggestion.panelTitle')}</strong>
                            {anchoredInteractionSuggestionPanelHasUpdates && (
                                <button
                                    type="button"
                                    className={styles.anchoredInteractionSuggestionPanelRefresh}
                                    onClick={handleRefreshAnchoredInteractionSuggestionPanel}
                                >
                                    {t('anchoredInteraction.suggestion.hasUpdates')}
                                    <span>{t('anchoredInteraction.suggestion.refresh')}</span>
                                </button>
                            )}
                        </div>
                        {visibleAnchoredInteractionSuggestionPanelItems.length === 0 ? (
                            <p className={styles.anchoredInteractionSuggestionPanelEmpty}>
                                {t('anchoredInteraction.suggestion.empty')}
                            </p>
                        ) : (
                            <div className={styles.anchoredInteractionSuggestionPanelList}>
                                {visibleAnchoredInteractionSuggestionPanelItems.map((suggestion) => {
                                    const sourceMessage = visibleMessagesByEnvelopeId.get(suggestion.envelopeId) || null;
                                    return (
                                        <article
                                            key={`${suggestion.envelopeId}:${suggestion.suggestedInteractionType}`}
                                            className={styles.anchoredInteractionSuggestionPanelCard}
                                        >
                                            <button
                                                type="button"
                                                className={styles.anchoredInteractionSuggestionPanelDismiss}
                                                aria-label={t('anchoredInteraction.suggestion.dismissAriaLabel')}
                                                title={t('anchoredInteraction.suggestion.dismissAriaLabel')}
                                                onClick={() => handleDismissAnchoredInteractionSuggestion(suggestion)}
                                            >
                                                <X size={13} />
                                            </button>
                                            <div className={styles.anchoredInteractionSuggestionPanelCardBody}>
                                                <span className={styles.anchoredInteractionSuggestionPanelType}>
                                                    {anchoredInteractionTypeLabels[suggestion.suggestedInteractionType]}
                                                </span>
                                                <p className={styles.anchoredInteractionSuggestionPanelSummary}>
                                                    {suggestion.sourceSummary || t('anchoredInteraction.suggestion.sourceSummaryFallback')}
                                                </p>
                                                <p className={styles.anchoredInteractionSuggestionPanelReason}>
                                                    {getAnchoredInteractionSuggestionReasonLabel(suggestion)}
                                                </p>
                                            </div>
                                            <div className={styles.anchoredInteractionSuggestionPanelActions}>
                                                <button
                                                    type="button"
                                                    className={styles.anchoredInteractionSuggestionPanelSecondary}
                                                    onClick={() => handleLocateAnchoredInteractionSuggestion(suggestion)}
                                                >
                                                    {t('anchoredInteraction.suggestion.locateSource')}
                                                </button>
                                                {sourceMessage && (
                                                    <button
                                                        type="button"
                                                        className={styles.anchoredInteractionSuggestionPanelPrimary}
                                                        onClick={() => handleOpenAnchoredInteractionSuggestion(sourceMessage, suggestion)}
                                                    >
                                                        {getAnchoredInteractionSuggestionCreateLabel(suggestion.suggestedInteractionType)}
                                                    </button>
                                                )}
                                                {sourceMessage && (
                                                    <button
                                                        type="button"
                                                        className={styles.anchoredInteractionSuggestionPanelSecondary}
                                                        onClick={() => handleOpenAnchoredInteractionSuggestion(sourceMessage, suggestion)}
                                                    >
                                                        {t('anchoredInteraction.suggestion.switchType')}
                                                    </button>
                                                )}
                                            </div>
                                        </article>
                                    );
                                })}
                            </div>
                        )}
                    </div>
                )}
                <AnnouncementFloatingPanel
                    open={showAnnouncementPanel}
                    announcement={topAnnouncement}
                    count={announcements.length}
                    loading={announcementLoading}
                    copy={announcementCopy}
                    senderPubkey={viewerSessionPubkey}
                    discussionAccessToken={discussionSession?.discussionAccessToken ?? null}
                    onOpen={(announcementId) => {
                        setShowAnnouncementPanel(false);
                        void handleOpenAnnouncementDetail(announcementId);
                    }}
                    onOpenCenter={() => {
                        setShowAnnouncementPanel(false);
                        setShowAnnouncementCenter(true);
                    }}
                    onSeen={handleAnnouncementSeen}
                />
            </div>
            <AnchoredInteractionFieldButton
                count={anchoredInteractionField.activeCount}
                unreadCount={anchoredInteractionField.unreadChangeCount}
                label={t('anchoredInteraction.field.title')}
                open={showAnchoredInteractionField}
                pulse={anchoredInteractionField.hasNewChanges}
                onClick={() => {
                    anchoredInteractionField.acknowledgeChanges();
                    setShowAnchoredInteractionField(true);
                }}
            />
            <InteractionFieldMotionLayer
                enabled={anchoredInteractionField.hasNewChanges}
                motion={anchoredInteractionFieldMotion}
            />
            {/* ── Message Area (with swipe support) ── */}
            <motion.div
                ref={chatMessagesRef}
                className={styles.chatMessages}
                onPanEnd={onSwipe}
                onScroll={updateFollowLatestState}
                style={{ touchAction: 'pan-y' }}
            >
                {loading ? (
                    <div style={{ padding: 'var(--space-4)' }}>
                        <Skeleton height={60} />
                        <Skeleton height={60} />
                        <Skeleton height={60} />
                    </div>
                ) : (
                    <>
                        {discussionLoading && (
                            <div className={styles.discussionSyncHint}>{t('states.syncing')}</div>
                        )}
                        {discussionError && (
                            <div className={styles.discussionSyncError}>{discussionError}</div>
                        )}
                        {discussionStatus && (
                            <div className={styles.discussionSyncHint}>{discussionStatus}</div>
                        )}
                        {announcementError && (
                            <div className={styles.discussionSyncError}>{announcementError}</div>
                        )}
                        {hiddenMessageCount > 0 && (
                            <div className={styles.discussionMetaRow}>
                                <span className={styles.discussionHiddenHint}>
                                    {t('states.hiddenNoiseCount', {count: hiddenMessageCount})}
                                </span>
                            </div>
                        )}
                        {quickAuxCircles.length > 0 && (
                            <div className={styles.discussionAuxShortcuts}>
                                {quickAuxCircles.map((circle) => (
                                    <button
                                        key={circle.id}
                                        type="button"
                                        className={styles.discussionAuxBtn}
                                        onClick={() => onQuickJumpToCircle?.(circle.id)}
                                    >
                                        ↗ {circle.name}
                                        {circle.minCrystals > 0 ? t('auxShortcut.crystals', { count: circle.minCrystals }) : ''}
                                    </button>
                                ))}
                            </div>
                        )}
                        {freeformAnchoredInteractions.length > 0 && (
                            <div className={styles.standaloneAnchoredInteractionCards}>
                                {freeformAnchoredInteractions.map(renderAnchoredInteractionCard)}
                            </div>
                        )}
                        {visibleMessages.map((msg, i) => {
                            const isMine = !!viewerSessionPubkey && msg.senderPubkey === viewerSessionPubkey;
                            const messageAvatar = (msg.senderPubkey
                                ? memberAvatarsByPubkey.get(msg.senderPubkey)
                                : undefined)
                                || memberAvatarsByHandle.get(msg.author.trim().replace(/^@/, '').toLowerCase())
                                || null;
                            const isDimmed = msg.relevanceStatus === 'ready'
                                && msg.focusLabel === 'off_topic'
                                && !revealedDimmed.has(msg.id);
                            const interactionResultNotice = msg.messageKind === 'interaction_result_notice'
                                ? parseInteractionResultNoticeMetadata(msg.metadata)
                                : null;
                            const announcementNotice = msg.messageKind === 'announcement_notice'
                                ? parseAnnouncementNoticeFromMessage(msg)
                                : null;
                            const announcementProjection = announcementNotice
                                ? announcements.find((item) => item.announcementId === announcementNotice.announcementId) ?? null
                                : null;
                            const anchoredCards = msg.envelopeId
                                ? anchoredInteractionsByAnchorRef[msg.envelopeId] || msg.anchoredInteractions || []
                                : [];
                            const candidateNotice = parseDraftCandidateInlineNotice({
                                messageKind: msg.messageKind,
                                metadata: msg.metadata,
                            });
                            const candidateRecovery = candidateNotice
                                ? resolveCandidateRecoveryActions({ notice: candidateNotice, viewerIdentity })
                                : null;
                            const canApplyLocalPendingState = candidateNotice
                                ? candidateNotice.state === 'open' || candidateNotice.state === 'pending'
                                : false;
                            const isLocallyPendingCandidate = candidateNotice
                                ? canApplyLocalPendingState
                                    && pendingCandidateDraftIds.has(candidateNotice.candidateId)
                                    && !candidateNotice.draftPostId
                                : false;
                            const isLocallyCancelledCandidate = candidateNotice
                                ? cancelledCandidateIds.has(candidateNotice.candidateId)
                                    && !candidateNotice.draftPostId
                                : false;
                            const candidateNoticeForRender = candidateNotice
                                ? {
                                    ...candidateNotice,
                                    state: isLocallyCancelledCandidate
                                        ? 'cancelled' as const
                                        : isLocallyPendingCandidate ? 'pending' as const : candidateNotice.state,
                                    canRetry: isLocallyCancelledCandidate || isLocallyPendingCandidate
                                        ? false
                                        : candidateRecovery?.canRetry ?? candidateNotice.canRetry,
                                    canCancel: isLocallyCancelledCandidate || isLocallyPendingCandidate
                                        ? false
                                        : candidateRecovery?.canCancel ?? candidateNotice.canCancel,
                                }
                                : null;
                            const acceptedHandoff = toAcceptedCandidateHandoffContext(candidateNoticeForRender);
                            const currentMessageIndex = localMessages.findIndex((item) => item.id === msg.id);
                            const previousReplyMessages = currentMessageIndex > 0
                                ? localMessages.slice(0, currentMessageIndex)
                                : [];
                            const replyPresentation = resolvePlazaReplyPresentation({
                                message: msg,
                                previousMessages: previousReplyMessages,
                                emptyText: t('reply.emptyBody'),
                                maxPreviewLength: REPLY_PREVIEW_MAX_LENGTH,
                            });
                            const replyContextDisplay = replyPresentation
                                ? buildPlazaReplyContextDisplay(replyPresentation)
                                : null;
                            const isReplyContextExpanded = expandedReplyContextIds.has(msg.id);
                            const isMessageSelectableForCurrentSelection = messageSelectionMode
                                ? isSelectablePlazaMessageForAction(msg, messageSelectionMode)
                                : false;
                            const isSelectedMessageForCurrentSelection = isMessageSelectableForCurrentSelection
                                && Boolean(msg.envelopeId && selectedMessageEnvelopeIds.has(msg.envelopeId));
                            const forwardBundleCard = msg.forwardBundleCard || null;
                            const forwardBundleKey = forwardBundleCard?.bundleId || msg.envelopeId || String(msg.id);
                            const isForwardBundleExpanded = forwardBundleCard
                                ? expandedForwardBundleIds.has(forwardBundleKey)
                                : false;
                            const visibleForwardBundleItems = forwardBundleCard
                                ? isForwardBundleExpanded
                                    ? forwardBundleCard.sourceItems
                                    : forwardBundleCard.sourceItems.slice(0, FORWARD_BUNDLE_COLLAPSED_PREVIEW_LIMIT)
                                : [];

                            if (announcementNotice) {
                                const announcementAuthor = msg.author || 'ghost.system';
                                return (
                                    <motion.div
                                        key={msg.id}
                                        initial={{ opacity: 0, y: 6 }}
                                        animate={{ opacity: 1, y: 0 }}
                                        transition={{ duration: 0.3, delay: i * 0.04 }}
                                        className={`${styles.msgRow} ${isMine ? styles.msgRowMine : ''} ${isDimmed ? styles.msgRowDimmed : ''} ${msg.envelopeId && msg.envelopeId === focusedEnvelopeId ? styles.msgRowFocused : ''}`}
                                        data-envelope-id={msg.envelopeId || undefined}
                                        onMouseDown={(e) => {
                                            if (shouldSkipRowGesture(e.target)) return;
                                            startMsgGesture(msg.id, e.clientX, e.clientY);
                                        }}
                                        onMouseMove={(e) => {
                                            moveMsgGesture(msg.id, e.clientX, e.clientY);
                                        }}
                                        onMouseUp={() => {
                                            endMsgGesture(msg.id);
                                        }}
                                        onMouseLeave={() => {
                                            cancelMsgGesture(msg.id);
                                        }}
                                        onTouchStart={(e) => {
                                            if (shouldSkipRowGesture(e.target)) return;
                                            const t = e.touches[0];
                                            startMsgGesture(msg.id, t.clientX, t.clientY);
                                        }}
                                        onTouchMove={(e) => {
                                            const t = e.touches[0];
                                            moveMsgGesture(msg.id, t.clientX, t.clientY);
                                        }}
                                        onTouchEnd={() => {
                                            endMsgGesture(msg.id);
                                        }}
                                        onTouchCancel={() => {
                                            cancelMsgGesture(msg.id);
                                        }}
                                    >
                                        <div
                                            data-msg-avatar="1"
                                            className={`${styles.msgAvatar} ${isMine ? styles.msgAvatarMine : ''} ${msg.ephemeral ? styles.msgAvatarVisitor : ''}`}
                                            onClick={(e) => {
                                                e.stopPropagation();
                                                onAvatarTap?.(announcementAuthor, msg.senderPubkey ?? null);
                                            }}
                                            style={{ cursor: 'pointer' }}
                                        >
                                            <ProfileAvatar
                                                handle={messageAvatar?.handle}
                                                avatarUri={messageAvatar?.avatarUri}
                                                className={styles.msgAvatarImage}
                                                alt={announcementAuthor}
                                                fallback={getInitials(announcementAuthor)}
                                            />
                                        </div>
                                        <div className={styles.msgBubbleWrap}>
                                            <div className={styles.msgAuthorRow}>
                                                {!isMine && (
                                                    <>
                                                        <span className={styles.msgAuthor}>@{announcementAuthor}</span>
                                                        <IdentityBadge
                                                            state={resolveMessageIdentityBadgeState(msg)}
                                                            label={msg.senderIdentityDisplayName}
                                                            roleLabel={msg.senderRoleDisplayName}
                                                            membershipSource={msg.senderMembershipSource}
                                                            onOpen={() => setIdentityExplanationMsgId(msg.id)}
                                                            compact
                                                        />
                                                    </>
                                                )}
                                                <span className={styles.msgSystemTag}>{announcementCopy.title}</span>
                                                <span className={styles.msgTime}>{msg.time}</span>
                                            </div>
                                            <div
                                                data-msg-bubble="1"
                                                className={`${styles.msgBubble} ${msg.ephemeral ? styles.msgBubbleEphemeral : ''}`}
                                            >
                                                <AnnouncementInlineNoticeCard
                                                    title={announcementNotice.title}
                                                    bodyPreview={announcementNotice.bodyPreview}
                                                    publisher={announcementAuthor}
                                                    publishedTime={msg.time}
                                                    viewDetailLabel={announcementCopy.viewDetail}
                                                    announcement={announcementProjection}
                                                    senderPubkey={viewerSessionPubkey}
                                                    discussionAccessToken={discussionSession?.discussionAccessToken ?? null}
                                                    onSeen={handleAnnouncementSeen}
                                                    onOpen={() => {
                                                        void handleOpenAnnouncementDetail(announcementNotice.announcementId);
                                                    }}
                                                />
                                            </div>
                                            {isDimmed && (
                                                <div
                                                    className={styles.msgDimOverlay}
                                                    data-msg-overlay="1"
                                                    onMouseDown={(e) => e.stopPropagation()}
                                                    onTouchStart={(e) => e.stopPropagation()}
                                                    onTouchEnd={(e) => {
                                                        e.preventDefault();
                                                        e.stopPropagation();
                                                        revealDimmedMessage(msg.id);
                                                    }}
                                                    onClick={(e) => {
                                                        e.stopPropagation();
                                                        revealDimmedMessage(msg.id);
                                                    }}
                                                >
                                                    <span className={styles.msgDimLabel}>{t('messages.offTopicReveal')}</span>
                                                </div>
                                            )}
                                            {anchoredCards.map(renderAnchoredInteractionCard)}
                                        </div>
                                    </motion.div>
                                );
                            }

                            if (interactionResultNotice) {
                                const systemAuthor = msg.author || 'ghost.system';
                                const resultNoticeViewSourceHandler = interactionResultNotice.anchorType === 'discussion_message'
                                    ? () => {
                                        const sourceEnvelopeId = interactionResultNotice.anchorEnvelopeId
                                            || interactionResultNotice.sourceMessageIds[0]
                                            || null;
                                        if (!sourceEnvelopeId) return;
                                        setFocusedEnvelopeId(sourceEnvelopeId);
                                        setActiveContentFilters([]);
                                        setViewMode('all');
                                        setShowFilterPanel(false);
                                    }
                                    : undefined;
                                return (
                                    <motion.div
                                        key={msg.id}
                                        initial={{ opacity: 0, y: 6 }}
                                        animate={{ opacity: 1, y: 0 }}
                                        transition={{ duration: 0.3, delay: i * 0.04 }}
                                        className={`${styles.msgRow} ${styles.msgRowSystem} ${msg.envelopeId && msg.envelopeId === focusedEnvelopeId ? styles.msgRowFocused : ''}`}
                                        data-envelope-id={msg.envelopeId || undefined}
                                    >
                                        <div className={`${styles.msgAvatar} ${styles.msgAvatarSystem}`}>
                                            {t('candidate.avatar')}
                                        </div>
                                        <div className={styles.msgBubbleWrap}>
                                            <div className={styles.msgAuthorRow}>
                                                <span className={styles.msgAuthor}>@{systemAuthor}</span>
                                                <span className={styles.msgSystemTag}>{t('anchoredInteraction.systemTag')}</span>
                                                <span className={styles.msgTime}>{msg.time}</span>
                                            </div>
                                            <div className={`${styles.msgBubble} ${styles.msgBubbleSystem}`}>
                                                <InteractionResultNoticeCard
                                                    notice={interactionResultNotice}
                                                    label={t('anchoredInteraction.resultNotice')}
                                                    statusLabel={t(`anchoredInteraction.resultStatus.${interactionResultNotice.resultStatus}`)}
                                                    viewSourceLabel={t('anchoredInteraction.viewSource')}
                                                    viewDetailsLabel={t('anchoredInteraction.viewDetails')}
                                                    persistedLabel={t('anchoredInteraction.persistedNotice')}
                                                    onViewSource={resultNoticeViewSourceHandler}
                                                    onViewDetails={() => {
                                                        void handleOpenAnchoredInteractionDetail(interactionResultNotice.interactionId);
                                                    }}
                                                />
                                            </div>
                                        </div>
                                    </motion.div>
                                );
                            }

                            if (candidateNoticeForRender) {
                                const systemAuthor = msg.author || 'ghost.system';
                                return (
                                    <motion.div
                                        key={msg.id}
                                        initial={{ opacity: 0, y: 6 }}
                                        animate={{ opacity: 1, y: 0 }}
                                        transition={{ duration: 0.3, delay: i * 0.04 }}
                                        className={`${styles.msgRow} ${styles.msgRowSystem} ${msg.envelopeId && msg.envelopeId === focusedEnvelopeId ? styles.msgRowFocused : ''}`}
                                        data-envelope-id={msg.envelopeId || undefined}
                                    >
                                        <div className={`${styles.msgAvatar} ${styles.msgAvatarSystem}`}>
                                            {t('candidate.avatar')}
                                        </div>
                                        <div className={styles.msgBubbleWrap}>
                                            <div className={styles.msgAuthorRow}>
                                                <span className={styles.msgAuthor}>@{systemAuthor}</span>
                                                <span className={styles.msgSystemTag}>{t('candidate.systemTag')}</span>
                                                <span className={styles.msgTime}>{msg.time}</span>
                                            </div>
                                            <div className={`${styles.msgBubble} ${styles.msgBubbleSystem}`}>
                                                <DraftCandidateInlineCard
                                                    notice={candidateNoticeForRender}
                                                    embedded
                                                    footerNote={t('candidate.persistedNotice')}
                                                    onOpenDraft={(draftPostId) => {
                                                        const targetPostId = acceptedHandoff?.draftPostId || draftPostId;
                                                        openCrucibleAfterDraftsRefresh(targetPostId);
                                                    }}
                                                    onCreateDraft={handleCandidateCreateDraft}
                                                    createDraftBusy={creatingCandidateDraftId === candidateNoticeForRender.candidateId}
                                                    onViewSource={() => {
                                                        if (!candidateNoticeForRender.sourceMessageIds.length) return;
                                                        const sourceEnvelopeId = candidateNoticeForRender.sourceMessageIds[0] ?? null;
                                                        setFocusedEnvelopeId(sourceEnvelopeId);
                                                        setActiveContentFilters([]);
                                                        setViewMode('all');
                                                        setShowFilterPanel(false);
                                                    }}
                                                    onRetry={(notice) => {
                                                        handleCandidateRetry(notice);
                                                    }}
                                                    onCancel={handleCandidateCancel}
                                                />
                                            </div>
                                        </div>
                                    </motion.div>
                                );
                            }
                            return (
                                <motion.div
                                    key={msg.id}
                                    initial={{ opacity: 0, y: 6 }}
                                    animate={{ opacity: 1, y: 0 }}
                                    transition={{ duration: 0.3, delay: i * 0.04 }}
                                    className={`${styles.msgRow} ${isMine ? styles.msgRowMine : ''} ${messageSelectionMode ? styles.msgRowManualDraftSelection : ''} ${isSelectedMessageForCurrentSelection ? styles.msgRowManualDraftSelected : ''} ${isDimmed ? styles.msgRowDimmed : ''} ${msg.envelopeId && msg.envelopeId === focusedEnvelopeId ? styles.msgRowFocused : ''}`}
                                    data-envelope-id={msg.envelopeId || undefined}
                                    onMouseDown={(e) => {
                                        if (shouldSkipRowGesture(e.target)) return;
                                        startMsgGesture(msg.id, e.clientX, e.clientY);
                                    }}
                                    onMouseMove={(e) => {
                                        moveMsgGesture(msg.id, e.clientX, e.clientY);
                                    }}
                                    onMouseUp={(e) => {
                                        endMsgGesture(msg.id);
                                    }}
                                    onMouseLeave={() => {
                                        cancelMsgGesture(msg.id);
                                    }}
                                    onTouchStart={(e) => {
                                        if (shouldSkipRowGesture(e.target)) return;
                                        const t = e.touches[0];
                                        startMsgGesture(msg.id, t.clientX, t.clientY);
                                    }}
                                    onTouchMove={(e) => {
                                        const t = e.touches[0];
                                        moveMsgGesture(msg.id, t.clientX, t.clientY);
                                    }}
                                    onTouchEnd={() => {
                                        endMsgGesture(msg.id);
                                    }}
                                    onTouchCancel={() => {
                                        cancelMsgGesture(msg.id);
                                    }}
                                >
                                    {messageSelectionMode && isMessageSelectableForCurrentSelection && (
                                        <button
                                            type="button"
                                            data-msg-action="1"
                                            data-testid="message-selection-toggle"
                                            className={`${styles.manualDraftSourceToggle} ${isSelectedMessageForCurrentSelection ? styles.manualDraftSourceToggleSelected : ''}`}
                                            aria-pressed={isSelectedMessageForCurrentSelection}
                                            aria-label={isSelectedMessageForCurrentSelection
                                                ? t(messageSelectionMode === 'draft' ? 'manualDraft.unselectSource' : 'forward.selection.unselectMessage')
                                                : t(messageSelectionMode === 'draft' ? 'manualDraft.selectSource' : 'forward.selection.selectMessage')}
                                            title={isSelectedMessageForCurrentSelection
                                                ? t(messageSelectionMode === 'draft' ? 'manualDraft.unselectSource' : 'forward.selection.unselectMessage')
                                                : t(messageSelectionMode === 'draft' ? 'manualDraft.selectSource' : 'forward.selection.selectMessage')}
                                            onMouseDown={(event) => event.stopPropagation()}
                                            onTouchStart={(event) => event.stopPropagation()}
                                            onClick={(event) => {
                                                event.preventDefault();
                                                event.stopPropagation();
                                                handleToggleSelectedMessage(msg);
                                            }}
                                        >
                                            {isSelectedMessageForCurrentSelection ? (
                                                <Check size={14} strokeWidth={2.2} />
                                            ) : (
                                                <span className={styles.manualDraftSourceToggleEmpty} aria-hidden="true" />
                                            )}
                                        </button>
                                    )}

                                    <div
                                        data-msg-avatar="1"
                                        className={`${styles.msgAvatar} ${isMine ? styles.msgAvatarMine : ''} ${msg.ephemeral ? styles.msgAvatarVisitor : ''}`}
                                        onClick={(e) => {
                                            e.stopPropagation();
                                            onAvatarTap?.(msg.author, msg.senderPubkey ?? null);
                                        }}
                                        style={{ cursor: 'pointer' }}
                                    >
                                        <ProfileAvatar
                                            handle={messageAvatar?.handle}
                                            avatarUri={messageAvatar?.avatarUri}
                                            className={styles.msgAvatarImage}
                                            alt={msg.author}
                                            fallback={getInitials(msg.author)}
                                        />
                                    </div>

                                    {/* Bubble */}
                                    <div className={styles.msgBubbleWrap}>
                                        <div className={styles.msgAuthorRow}>
                                            {!isMine && (
                                                <>
                                                    <span className={styles.msgAuthor}>@{msg.author}</span>
                                                    <IdentityBadge
                                                        state={resolveMessageIdentityBadgeState(msg)}
                                                        label={msg.senderIdentityDisplayName}
                                                        roleLabel={msg.senderRoleDisplayName}
                                                        membershipSource={msg.senderMembershipSource}
                                                        onOpen={() => setIdentityExplanationMsgId(msg.id)}
                                                        compact
                                                    />
                                                </>
                                            )}
                                            <span className={styles.msgTime}>{msg.time}</span>
                                            {!msg.ephemeral && msg.isFeatured && (
                                                <UsefulIndicator
                                                    count={usefulCounts[msg.id] || 0}
                                                    isMarked={Boolean(msg.viewerHasMarkedUseful)}
                                                    threshold={1}
                                                    onMarkUseful={
                                                        canMarkPlazaMessageUseful({
                                                            messageId: msg.id,
                                                            usefulMarkedIds,
                                                            viewerPubkey: viewerSessionPubkey,
                                                            senderPubkey: msg.senderPubkey,
                                                            deleted: msg.deleted,
                                                            ephemeral: msg.ephemeral,
                                                        })
                                                            ? () => handleMarkUseful(msg.id)
                                                            : undefined
                                                    }
                                                    onUnmarkUseful={
                                                        usefulMarkedIds.has(msg.id)
                                                            ? () => handleUnmarkUseful(msg.id)
                                                            : undefined
                                                    }
                                                />
                                            )}
                                        </div>
                                        <div
                                            data-msg-bubble="1"
                                            className={`${styles.msgBubble} ${msg.ephemeral ? styles.msgBubbleEphemeral : ''} ${isSelectedMessageForCurrentSelection ? styles.msgBubbleManualDraftSelected : ''}`}
                                        >
                                            {forwardBundleCard ? (
                                                <div
                                                    className={styles.forwardBundleCard}
                                                    data-testid="forward-bundle-card"
                                                >
                                                    <div className={styles.forwardCardMeta}>
                                                        <span className={styles.forwardCardLabel}>{t('forward.bundleLabel')}</span>
                                                        <span>{t('forward.bundleSummary', {
                                                            count: forwardBundleCard.itemCount,
                                                            circleName: forwardBundleCard.sourceCircleName || t('forward.sourceCircleFallback'),
                                                        })}</span>
                                                    </div>
                                                    <div className={styles.forwardCardSubMeta}>
                                                        <span>{t('forward.forwardedBy', {
                                                            handle: forwardBundleCard.forwarderHandle || msg.author,
                                                        })}</span>
                                                        {typeof forwardBundleCard.sourceLevel === 'number' && (
                                                            <span>{t('forward.sourceLevel', { level: forwardBundleCard.sourceLevel })}</span>
                                                        )}
                                                    </div>
                                                    <div
                                                        className={`${styles.forwardBundleItems} ${isForwardBundleExpanded ? styles.forwardBundleItemsExpanded : ''}`}
                                                        data-testid="forward-bundle-items"
                                                    >
                                                        {visibleForwardBundleItems.length > 0 ? (
                                                            visibleForwardBundleItems.map((item, itemIndex) => (
                                                                <div
                                                                    key={`${item.sourceEnvelopeId}-${itemIndex}`}
                                                                    className={`${styles.forwardBundleItem} ${item.sourceDeleted ? styles.forwardBundleItemDeleted : ''}`}
                                                                >
                                                                    <div className={styles.forwardBundleItemMeta}>
                                                                        <span>@{item.sourceAuthorDisplayName || t('forward.unknownSourceAuthor')}</span>
                                                                        {item.sourceMessageCreatedAt && (
                                                                            <span>{timeAgo(item.sourceMessageCreatedAt, locale)}</span>
                                                                        )}
                                                                        {item.snapshotTruncated && (
                                                                            <span>{t('forward.bundleItemTruncated')}</span>
                                                                        )}
                                                                    </div>
                                                                    <p className={styles.forwardBundleItemText}>
                                                                        {item.sourceDeleted
                                                                            ? t('forward.bundleItemDeleted')
                                                                            : truncateForwardBundlePreview(item.snapshotText)}
                                                                    </p>
                                                                    {!item.sourceDeleted && forwardBundleCard.sourceCircleId && item.sourceEnvelopeId && (
                                                                        <button
                                                                            type="button"
                                                                            data-msg-action="1"
                                                                            data-testid="forward-bundle-view-source"
                                                                            className={styles.forwardCardSourceLink}
                                                                            onClick={(e) => {
                                                                                e.stopPropagation();
                                                                                handleOpenForwardBundleSource(msg, item.sourceEnvelopeId, item.sourceDeleted);
                                                                            }}
                                                                        >
                                                                            {t('forward.viewSource')}
                                                                        </button>
                                                                    )}
                                                                </div>
                                                            ))
                                                        ) : (
                                                            <p className={styles.forwardBundleEmpty}>{msg.text}</p>
                                                        )}
                                                    </div>
                                                    {forwardBundleCard.sourceItems.length > FORWARD_BUNDLE_COLLAPSED_PREVIEW_LIMIT && (
                                                        <button
                                                            type="button"
                                                            data-msg-action="1"
                                                            data-testid="forward-bundle-toggle"
                                                            className={styles.forwardBundleToggle}
                                                            onClick={(e) => {
                                                                e.stopPropagation();
                                                                toggleForwardBundleExpanded(forwardBundleKey);
                                                            }}
                                                        >
                                                            {isForwardBundleExpanded
                                                                ? t('forward.collapseBundle')
                                                                : t('forward.expandBundle', { count: forwardBundleCard.itemCount })}
                                                        </button>
                                                    )}
                                                </div>
                                            ) : msg.forwardCard ? (
                                                <div className={styles.forwardCard}>
                                                    <div className={styles.forwardCardMeta}>
                                                        <span className={styles.forwardCardLabel}>{t('forward.cardLabel')}</span>
                                                        <span>
                                                            {msg.forwardCard.sourceCircleName || t('forward.sourceCircleFallback')}
                                                            {typeof msg.forwardCard.sourceLevel === 'number'
                                                                ? ` · ${t('forward.sourceLevel', { level: msg.forwardCard.sourceLevel })}`
                                                                : ''}
                                                        </span>
                                                    </div>
                                                    <div className={styles.forwardCardSubMeta}>
                                                        <span>@{msg.forwardCard.sourceAuthorHandle || t('forward.unknownSourceAuthor')}</span>
                                                        <span>{t('forward.forwardedBy', {
                                                            handle: msg.forwardCard.forwarderHandle || msg.author,
                                                        })}</span>
                                                    </div>
                                                    <p className={styles.forwardCardText}>
                                                        {msg.forwardCard.snapshotText}
                                                    </p>
                                                    {!msg.forwardCard.sourceDeleted && msg.forwardCard.sourceCircleId && msg.forwardCard.sourceEnvelopeId && (
                                                        <button
                                                            type="button"
                                                            data-msg-action="1"
                                                            data-testid="forward-card-view-source"
                                                            className={styles.forwardCardSourceLink}
                                                            onClick={(e) => {
                                                                e.stopPropagation();
                                                                handleOpenForwardSource(msg);
                                                            }}
                                                        >
                                                            {t('forward.viewSource')}
                                                        </button>
                                                    )}
                                                    {msg.forwardCard.sourceDeleted && (
                                                        <p className={styles.msgEphemeralTag}>{t('forward.sourceDeleted')}</p>
                                                    )}
                                                </div>
                                            ) : msg.chatRecord ? (
                                                <ChatRecordBubble
                                                    sourceCircle={msg.chatRecord.sourceCircle}
                                                    messages={msg.chatRecord.messages}
                                                    forwardedBy={msg.chatRecord.forwardedBy}
                                                />
                                            ) : replyPresentation ? (
                                                <div className={styles.replyMessageStack} data-testid="plaza-reply-message">
                                                    <div className={styles.replyQuoteBlock} data-msg-action="1">
                                                        <span className={styles.replyQuoteRail} aria-hidden="true" />
                                                        {replyContextDisplay && (
                                                            <span className={styles.replyQuoteContent}>
                                                                {replyContextDisplay.ancestorCount > 0 && !isReplyContextExpanded && (
                                                                    <button
                                                                        type="button"
                                                                        data-msg-action="1"
                                                                        className={styles.replyContextSummary}
                                                                        onClick={(e) => {
                                                                            e.stopPropagation();
                                                                            toggleReplyContext(msg.id);
                                                                        }}
                                                                    >
                                                                        <span className={styles.replyContextSummaryLabel}>
                                                                            {t('reply.contextTrail', {
                                                                                count: replyContextDisplay.ancestorCount,
                                                                            })}
                                                                        </span>
                                                                        {replyContextDisplay.ancestorSummary && (
                                                                            <span className={styles.replyContextSummaryText}>
                                                                                {replyContextDisplay.ancestorSummary}
                                                                            </span>
                                                                        )}
                                                                    </button>
                                                                )}
                                                                {replyContextDisplay.ancestorCount > 0 && isReplyContextExpanded && (() => {
                                                                    const ancestorQuoteItems = replyContextDisplay.ancestorQuotes.map((quote, index) => ({
                                                                        key: `${msg.id}:ancestor:${index}:${quote.sourceEnvelopeId || quote.author}`,
                                                                        quote,
                                                                    }));
                                                                    const allReplyQuoteItems = [
                                                                        ...ancestorQuoteItems,
                                                                        {
                                                                            key: `${msg.id}:direct`,
                                                                            quote: replyContextDisplay.directQuote,
                                                                        },
                                                                    ];
                                                                    const expandableReplyQuoteKeys = getExpandablePlazaReplyQuoteKeys(
                                                                        allReplyQuoteItems,
                                                                        expandedReplyQuoteKeys,
                                                                        truncatedReplyQuoteKeys,
                                                                    );
                                                                    const collapsibleReplyQuoteKeys = getCollapsiblePlazaReplyQuoteKeys(
                                                                        allReplyQuoteItems,
                                                                        expandedReplyQuoteKeys,
                                                                        truncatedReplyQuoteKeys,
                                                                    );
                                                                    return (
                                                                    <span
                                                                        className={
                                                                            replyContextDisplay.isLongAncestorChain
                                                                                ? `${styles.replyQuoteChain} ${styles.replyQuoteChainLong}`
                                                                                : styles.replyQuoteChain
                                                                        }
                                                                    >
                                                                        <span className={styles.replyQuoteChainHeader}>
                                                                            <span className={styles.replyContextSummaryLabel}>
                                                                                {t('reply.contextTrail', {
                                                                                    count: replyContextDisplay.ancestorCount,
                                                                                })}
                                                                            </span>
                                                                            <span className={styles.replyQuoteChainActions}>
                                                                                {expandableReplyQuoteKeys.length > 0 ? (
                                                                                    <button
                                                                                        type="button"
                                                                                        data-msg-action="1"
                                                                                        className={styles.replyQuoteExpandAll}
                                                                                        onClick={(e) => {
                                                                                            e.stopPropagation();
                                                                                            handleShowAllReplyQuotes(expandableReplyQuoteKeys);
                                                                                        }}
                                                                                    >
                                                                                        {t('reply.expandContextText')}
                                                                                    </button>
                                                                                ) : collapsibleReplyQuoteKeys.length > 0 && (
                                                                                    <button
                                                                                        type="button"
                                                                                        data-msg-action="1"
                                                                                        className={styles.replyQuoteExpandAll}
                                                                                        onClick={(e) => {
                                                                                            e.stopPropagation();
                                                                                            handleCollapseReplyQuotes(collapsibleReplyQuoteKeys);
                                                                                        }}
                                                                                    >
                                                                                        {t('reply.collapseContextText')}
                                                                                    </button>
                                                                                )}
                                                                                <button
                                                                                    type="button"
                                                                                    data-msg-action="1"
                                                                                    className={styles.replyQuoteCollapse}
                                                                                    onClick={(e) => {
                                                                                        e.stopPropagation();
                                                                                        toggleReplyContext(msg.id);
                                                                                    }}
                                                                                >
                                                                                    {t('reply.collapseContext')}
                                                                                </button>
                                                                            </span>
                                                                        </span>
                                                                        {ancestorQuoteItems.map(({ key: quoteGestureKey, quote }) => {
                                                                            const isQuoteExpanded = expandedReplyQuoteKeys.has(quoteGestureKey);
                                                                            const quotePreview = isQuoteExpanded && quote.fullPreview
                                                                                ? quote.fullPreview
                                                                                : quote.preview;
                                                                            return (
                                                                            <Fragment key={quoteGestureKey}>
                                                                            <button
                                                                                type="button"
                                                                                data-msg-action="1"
                                                                                className={styles.replyQuoteItem}
                                                                                onPointerDown={(e) => {
                                                                                    e.stopPropagation();
                                                                                    startReplyQuoteGesture(quoteGestureKey, quote, e.clientX, e.clientY);
                                                                                }}
                                                                                onPointerMove={(e) => {
                                                                                    e.stopPropagation();
                                                                                    moveReplyQuoteGesture(quoteGestureKey, e.clientX, e.clientY);
                                                                                }}
                                                                                onPointerUp={(e) => {
                                                                                    e.stopPropagation();
                                                                                    endReplyQuoteGesture(quoteGestureKey);
                                                                                }}
                                                                                onPointerCancel={(e) => {
                                                                                    e.stopPropagation();
                                                                                    cancelReplyQuoteGesture(quoteGestureKey);
                                                                                }}
                                                                                onPointerLeave={(e) => {
                                                                                    e.stopPropagation();
                                                                                    cancelReplyQuoteGesture(quoteGestureKey);
                                                                                }}
                                                                                onClick={(e) => {
                                                                                    e.preventDefault();
                                                                                    e.stopPropagation();
                                                                                }}
                                                                                onKeyDown={(e) => {
                                                                                    if (e.key !== 'Enter' && e.key !== ' ') return;
                                                                                    e.preventDefault();
                                                                                    e.stopPropagation();
                                                                                    setReplyQuoteMenu({ key: quoteGestureKey, quote });
                                                                                }}
                                                                            >
                                                                                <span className={styles.replyQuoteMetaMuted}>
                                                                                    <CornerDownLeft size={12} strokeWidth={2} />
                                                                                    {t('reply.banner', {author: quote.author})}
                                                                                </span>
                                                                                {quotePreview && (
                                                                                    <span
                                                                                        ref={(element) => {
                                                                                            trackReplyQuotePreviewTruncation(quoteGestureKey, isQuoteExpanded, element);
                                                                                        }}
                                                                                        className={`${styles.replyQuotePreviewMuted} ${isQuoteExpanded ? styles.replyQuotePreviewExpanded : ''}`}
                                                                                    >
                                                                                        {quotePreview}
                                                                                    </span>
                                                                                )}
                                                                            </button>
                                                                            {renderReplyQuoteMenu(quoteGestureKey, quote, isQuoteExpanded)}
                                                                            </Fragment>
                                                                            );
                                                                        })}
                                                                    </span>
                                                                    );
                                                                })()}
                                                                {(() => {
                                                                    const directQuoteGestureKey = `${msg.id}:direct`;
                                                                    const isDirectQuoteExpanded = expandedReplyQuoteKeys.has(directQuoteGestureKey);
                                                                    const directQuotePreview = isDirectQuoteExpanded && replyContextDisplay.directQuote.fullPreview
                                                                        ? replyContextDisplay.directQuote.fullPreview
                                                                        : replyContextDisplay.directQuote.preview;
                                                                    return (
                                                                    <>
                                                                <button
                                                                    type="button"
                                                                    data-msg-action="1"
                                                                    className={styles.replyDirectQuote}
                                                                    onPointerDown={(e) => {
                                                                        e.stopPropagation();
                                                                        startReplyQuoteGesture(directQuoteGestureKey, replyContextDisplay.directQuote, e.clientX, e.clientY);
                                                                    }}
                                                                    onPointerMove={(e) => {
                                                                        e.stopPropagation();
                                                                        moveReplyQuoteGesture(directQuoteGestureKey, e.clientX, e.clientY);
                                                                    }}
                                                                    onPointerUp={(e) => {
                                                                        e.stopPropagation();
                                                                        endReplyQuoteGesture(directQuoteGestureKey);
                                                                    }}
                                                                    onPointerCancel={(e) => {
                                                                        e.stopPropagation();
                                                                        cancelReplyQuoteGesture(directQuoteGestureKey);
                                                                    }}
                                                                    onPointerLeave={(e) => {
                                                                        e.stopPropagation();
                                                                        cancelReplyQuoteGesture(directQuoteGestureKey);
                                                                    }}
                                                                    onClick={(e) => {
                                                                        e.preventDefault();
                                                                        e.stopPropagation();
                                                                    }}
                                                                    onKeyDown={(e) => {
                                                                        if (e.key !== 'Enter' && e.key !== ' ') return;
                                                                        e.preventDefault();
                                                                        e.stopPropagation();
                                                                        setReplyQuoteMenu({ key: directQuoteGestureKey, quote: replyContextDisplay.directQuote });
                                                                    }}
                                                                    aria-label={t('reply.banner', {author: replyContextDisplay.directQuote.author})}
                                                                >
                                                                    <span className={styles.replyQuoteMeta}>
                                                                        <CornerDownLeft size={13} strokeWidth={2} />
                                                                        {t('reply.banner', {author: replyContextDisplay.directQuote.author})}
                                                                    </span>
                                                                    {directQuotePreview && (
                                                                        <span
                                                                            ref={(element) => {
                                                                                trackReplyQuotePreviewTruncation(directQuoteGestureKey, isDirectQuoteExpanded, element);
                                                                            }}
                                                                            className={`${styles.replyQuotePreview} ${isDirectQuoteExpanded ? styles.replyQuotePreviewExpanded : ''}`}
                                                                        >
                                                                            {directQuotePreview}
                                                                        </span>
                                                                    )}
                                                                </button>
                                                                    {renderReplyQuoteMenu(directQuoteGestureKey, replyContextDisplay.directQuote, isDirectQuoteExpanded)}
                                                                    </>
                                                                    );
                                                                })()}
                                                            </span>
                                                        )}
                                                    </div>
                                                    <p className={styles.msgText}>{replyPresentation.body}</p>
                                                </div>
                                            ) : (
                                                <p className={styles.msgText}>{msg.text}</p>
                                            )}
                                            {!!msg.semanticFacets?.length && (
                                                <div style={{ display: 'flex', flexWrap: 'wrap', gap: 6, marginTop: 8 }}>
                                                    {msg.semanticFacets.map((label) => (
                                                        <span
                                                            key={`${msg.id}-${label}`}
                                                            style={{
                                                                display: 'inline-flex',
                                                                alignItems: 'center',
                                                                padding: '1px 8px',
                                                                borderRadius: 999,
                                                                fontSize: 11,
                                                                lineHeight: 1.3,
                                                                color: 'var(--color-text-secondary)',
                                                                border: '1px solid rgba(255,255,255,0.10)',
                                                                background: 'rgba(255,255,255,0.05)',
                                                            }}
                                                        >
                                                            {semanticFacetCopy[label] || label}
                                                        </span>
                                                    ))}
                                                </div>
                                            )}
                                            {!!msg.authorAnnotations?.length && (
                                                <p className={styles.msgEphemeralTag}>
                                                    {t('messages.authorAnnotations', {
                                                        labels: msg.authorAnnotations
                                                            .map((label) => semanticFacetCopy[label])
                                                            .join(' / '),
                                                    })}
                                                </p>
                                            )}
                                            {(() => {
                                                const anchoredInteractionSuggestion = anchoredInteractionSuggestionsByMessageId.get(msg.id);
                                                if (!anchoredInteractionSuggestion) return null;
                                                return (
                                                    <div className={styles.anchoredInteractionSuggestion}>
                                                        <button
                                                            type="button"
                                                            data-msg-action="1"
                                                            className={styles.anchoredInteractionSuggestionAction}
                                                            onClick={(event) => {
                                                                event.stopPropagation();
                                                                handleOpenAnchoredInteractionSuggestion(msg, anchoredInteractionSuggestion);
                                                            }}
                                                        >
                                                            <Plus size={12} />
                                                            {anchoredInteractionTypeLabels[anchoredInteractionSuggestion.suggestedInteractionType]}
                                                        </button>
                                                        <button
                                                            type="button"
                                                            data-msg-action="1"
                                                            className={styles.anchoredInteractionSuggestionDismiss}
                                                            aria-label={t('anchoredInteraction.suggestion.dismissAriaLabel')}
                                                            title={t('anchoredInteraction.suggestion.dismissAriaLabel')}
                                                            onClick={(event) => {
                                                                event.stopPropagation();
                                                                handleDismissAnchoredInteractionSuggestion(anchoredInteractionSuggestion);
                                                            }}
                                                        >
                                                            <X size={12} />
                                                        </button>
                                                    </div>
                                                );
                                            })()}
                                            {isMine && msg.sendState === 'pending' && (
                                                <p className={styles.msgEphemeralTag}>{t('states.sending')}</p>
                                            )}
                                            {isMine && msg.sendState === 'failed' && (
                                                <p className={styles.msgEphemeralTag}>{msg.errorHint || t('errors.sendFailed')}</p>
                                            )}
                                            {msg.deleted && (
                                                <p className={styles.msgEphemeralTag}>{t('messages.deletedVisibleToSender')}</p>
                                            )}
                                            {msg.ephemeral && (
                                                <p className={styles.msgEphemeralTag}>{t('messages.ephemeral')}</p>
                                            )}
                                        </div>
                                        {renderSourceGroundedAskForMessage(msg)}
                                        {/* Frosted glass overlay for dimmed messages */}
                                        {isDimmed && (
                                            <div
                                                className={styles.msgDimOverlay}
                                                data-msg-overlay="1"
                                                onMouseDown={(e) => e.stopPropagation()}
                                                onTouchStart={(e) => e.stopPropagation()}
                                                onTouchEnd={(e) => {
                                                    e.preventDefault();
                                                    e.stopPropagation();
                                                    revealDimmedMessage(msg.id);
                                                }}
                                                onClick={(e) => {
                                                    e.stopPropagation();
                                                    revealDimmedMessage(msg.id);
                                                }}
                                            >
                                                <span className={styles.msgDimLabel}>{t('messages.offTopicReveal')}</span>
                                            </div>
                                        )}
                                        {anchoredCards.map(renderAnchoredInteractionCard)}
                                    </div>
                                </motion.div>
                            );
                        })}
                        <div ref={messagesEndRef} />
                    </>
                )}
            </motion.div>

            <AnnouncementPublishSheet
                open={showAnnouncementPublish}
                circleId={discussionCircleId}
                senderPubkey={viewerSessionPubkey}
                discussionAccessToken={discussionSession?.discussionAccessToken ?? null}
                copy={announcementCopy}
                errorMessage={announcementError}
                onError={setAnnouncementError}
                onPublished={handleAnnouncementPublished}
                onClose={() => setShowAnnouncementPublish(false)}
            />
            <AnnouncementCenterSheet
                open={showAnnouncementCenter}
                announcements={announcements}
                copy={announcementCopy}
                senderPubkey={viewerSessionPubkey}
                discussionAccessToken={discussionSession?.discussionAccessToken ?? null}
                onOpen={handleOpenAnnouncementDetail}
                onClose={() => setShowAnnouncementCenter(false)}
                onSeen={handleAnnouncementSeen}
            />
            <AnnouncementDetailSheet
                open={Boolean(announcementDetail || announcementDetailLoadingId)}
                announcement={announcementDetail}
                busy={Boolean(announcementDetailLoadingId)}
                actionBusy={announcementActionBusy}
                copy={announcementCopy}
                onClose={() => setAnnouncementDetail(null)}
                onMarkUnread={handleMarkAnnouncementUnread}
                onConfirm={handleConfirmAnnouncement}
                onOpenDiscussionRoot={handleOpenAnnouncementDiscussionRoot}
            />
            <AnimatePresence>
                {identityExplanationMessage && (
                    <motion.div
                        className={styles.identityExplanationOverlay}
                        initial={{ opacity: 0 }}
                        animate={{ opacity: 1 }}
                        exit={{ opacity: 0 }}
                        transition={{ duration: 0.18 }}
                        onClick={() => setIdentityExplanationMsgId(null)}
                    >
                        <motion.div
                            className={styles.identityExplanationSheet}
                            role="dialog"
                            aria-modal="true"
                            aria-label={t('identityExplanation.title')}
                            initial={{ y: 28, opacity: 0 }}
                            animate={{ y: 0, opacity: 1 }}
                            exit={{ y: 28, opacity: 0 }}
                            transition={{ duration: 0.2, ease: [0.2, 0.8, 0.2, 1] }}
                            onClick={(event) => event.stopPropagation()}
                        >
                            <div className={styles.identityExplanationHandle} />
                            <div className={styles.identityExplanationHeader}>
                                <div>
                                    <div className={styles.identityExplanationTitle}>{t('identityExplanation.title')}</div>
                                    <div className={styles.identityExplanationName}>@{identityExplanationMessage.author || t('identityExplanation.unknownActor')}</div>
                                </div>
                                <button
                                    type="button"
                                    className={styles.identityExplanationClose}
                                    aria-label={t('identityExplanation.close')}
                                    onClick={() => setIdentityExplanationMsgId(null)}
                                >
                                    <X size={16} />
                                </button>
                            </div>
                            <div className={styles.identityExplanationRows}>
                                {identityExplanationRows.map((row) => (
                                    <div className={styles.identityExplanationRow} key={row.label}>
                                        <span>{row.label}</span>
                                        <strong>{row.value}</strong>
                                    </div>
                                ))}
                            </div>
                        </motion.div>
                    </motion.div>
                )}
            </AnimatePresence>

            {/* ── Tap Action Sheet (bottom sheet) ── */}
            <MessageActionSheet
                open={actionSheetMsgId !== null}
                messageId={actionSheetMsgId}
                isMine={!!actionSheetMessage && !!viewerSessionPubkey && actionSheetMessage.senderPubkey === viewerSessionPubkey}
                onReply={isActionSheetInteractionResultNotice ? undefined : () => {
                    if (actionSheetMsgId === null) return;
                    handleReply(actionSheetMsgId);
                }}
                onAskAi={!isActionSheetInteractionResultNotice && canAskAiActionSheetMessage ? handleOpenSourceGroundedAsk : undefined}
                onMarkUseful={!isActionSheetInteractionResultNotice && canMarkUsefulActionSheetMessage ? (() => {
                    if (actionSheetMsgId === null) return;
                    handleMarkUseful(actionSheetMsgId);
                    setActionSheetMsgId(null);
                }) : undefined}
                onUnmarkUseful={!isActionSheetInteractionResultNotice && canUnmarkUsefulActionSheetMessage ? (() => {
                    if (actionSheetMsgId === null) return;
                    handleUnmarkUseful(actionSheetMsgId);
                    setActionSheetMsgId(null);
                }) : undefined}
                onTip={!isActionSheetInteractionResultNotice
                    && actionSheetMessage?.envelopeId
                    && actionSheetMessage.senderPubkey
                    && actionSheetMessage.senderPubkey !== viewerSessionPubkey
                    ? handleOpenTipTransferSheet
                    : undefined}
                onForward={!isActionSheetInteractionResultNotice && forwardAction.enabled ? handleOpenForwardPicker : undefined}
                forwardDisabledReason={!isActionSheetInteractionResultNotice && forwardAction.reasonKey ? t(`forward.reason.${forwardAction.reasonKey}`) : null}
                forwardLabel={t(forwardAction.labelKey)}
                onSelectMessages={!isActionSheetInteractionResultNotice && forwardAction.enabled ? handleStartBatchForwardFromActionSheet : undefined}
                selectMessagesLabel={t('forward.selection.actionSheet')}
                onCreateInteraction={!isActionSheetInteractionResultNotice && actionSheetMessage?.envelopeId ? handleOpenAnchoredInteractionComposer : undefined}
                onCopy={() => { if (actionSheetMsgId !== null) handleCopy(actionSheetMsgId); }}
                onDelete={() => { if (actionSheetMsgId !== null) handleDelete(actionSheetMsgId); }}
                onClose={() => setActionSheetMsgId(null)}
            />
            <AnchoredInteractionTipSheet
                open={Boolean(tipTransferTarget)}
                busy={creatingTipTransfer}
                pendingReceipt={tipTransferPendingReceipt}
                errorMessage={tipTransferError}
                title={t('anchoredInteraction.type.tip')}
                recipientLabelText={t('anchoredInteraction.tipRecipientLabel')}
                recipientLabel={tipTransferRecipientLabel}
                recipientPubkey={tipTransferRecipientPubkey}
                initialAmount={tipTransferInitialAmount}
                amountPlaceholder={t('anchoredInteraction.tipAmountPlaceholder')}
                reviewLabel={t('anchoredInteraction.tipReviewLabel')}
                confirmTitle={t('anchoredInteraction.tipConfirmTitle')}
                confirmDescription={({ recipient, amount, asset }) => t('anchoredInteraction.tipConfirmDescription', {
                    recipient,
                    amount,
                    asset,
                })}
                walletConfirmLabel={t('anchoredInteraction.tipWalletConfirmLabel')}
                retryRecordLabel={t('anchoredInteraction.tipRetryRecordLabel')}
                recordingPendingLabel={t('anchoredInteraction.tipRecordingPending')}
                cancelLabel={t('anchoredInteraction.cancel')}
                disclaimer={t('anchoredInteraction.tipDisclaimer')}
                onSubmit={handleSubmitInitialTipTransfer}
                onClose={() => {
                    if (!creatingTipTransfer) {
                        setTipTransferTarget(null);
                        setTipTransferError(null);
                        setPendingInitialTipRecord(null);
                    }
                }}
            />
            <AnchoredInteractionComposerSheet
                open={!!anchoredInteractionComposerAnchor}
                busy={creatingAnchoredInteraction}
                errorMessage={anchoredInteractionComposerError}
                defaultDisplayName={viewerSessionPubkey ? viewerDisplayLabel : ''}
                typeLabels={anchoredInteractionTypeLabels}
                createLabel={t('anchoredInteraction.create')}
                creatingLabel={t('anchoredInteraction.creating')}
                cancelLabel={t('anchoredInteraction.cancel')}
                nonCustodyNote={t('anchoredInteraction.nonCustodyNote')}
                anchorLabel={t('anchoredInteraction.anchorLabel')}
                anchorPreview={anchoredInteractionComposerAnchor?.anchorMode === 'message'
                    ? anchoredInteractionComposerAnchor.message.text
                    : anchoredInteractionComposerAnchor?.anchorPreview || anchoredInteractionComposerAnchor?.sourceLabel || null}
                anchorMode={anchoredInteractionComposerAnchor?.anchorMode}
                preselectedInteractionType={anchoredInteractionComposerAnchor?.preselectedInteractionType || null}
                displayNameLabel={t('anchoredInteraction.displayNameLabel')}
                pollOptionPlaceholder={(index) => t('anchoredInteraction.pollOptionPlaceholder', { index })}
                pollMultipleChoiceLabel={t('anchoredInteraction.pollMultipleChoiceLabel')}
                addPollOptionLabel={t('anchoredInteraction.addPollOption')}
                removePollOptionLabel={t('anchoredInteraction.removePollOption')}
                bountyRewardPlaceholder={t('anchoredInteraction.bountyRewardPlaceholder')}
                bountySettlementModeLabel={t('anchoredInteraction.bountySettlementModeLabel')}
                bountyReceiptOnlyLabel={t('anchoredInteraction.bountyReceiptOnly')}
                bountyEscrowUnavailableLabel={t('anchoredInteraction.bountyEscrowUnavailable')}
                challengeReasonPlaceholder={t('anchoredInteraction.challengeReasonPlaceholder')}
                onCreate={handleCreateAnchoredInteraction}
                onClose={() => {
                    if (!creatingAnchoredInteraction) {
                        setAnchoredInteractionComposerAnchor(null);
                        setAnchoredInteractionComposerError(null);
                    }
                }}
            />
            <AnchoredInteractionDetailSheet
                open={Boolean(anchoredInteractionDetail || anchoredInteractionDetailLoadingId || anchoredInteractionDetailError)}
                detail={anchoredInteractionDetail}
                busy={Boolean(anchoredInteractionDetailLoadingId)}
                errorMessage={anchoredInteractionDetailError}
                titleLabel={t('anchoredInteraction.detail.title')}
                closeLabel={t('anchoredInteraction.cancel')}
                loadingLabel={t('anchoredInteraction.detail.loading')}
                labels={{
                    anchor: t('anchoredInteraction.detail.anchor'),
                    participation: t('anchoredInteraction.detail.participation'),
                    result: t('anchoredInteraction.detail.result'),
                    events: t('anchoredInteraction.detail.events'),
                    receipts: t('anchoredInteraction.detail.receipts'),
                    actions: t('anchoredInteraction.detail.actions'),
                    noSource: t('anchoredInteraction.detail.noSource'),
                    noEvents: t('anchoredInteraction.detail.noEvents'),
                    noReceipts: t('anchoredInteraction.detail.noReceipts'),
                    audit: t('anchoredInteraction.detail.audit'),
                    actorPubkey: t('anchoredInteraction.detail.actorPubkey'),
                    recipientPubkey: t('anchoredInteraction.detail.recipientPubkey'),
                    signature: t('anchoredInteraction.detail.signature'),
                    assetType: t('anchoredInteraction.detail.assetType'),
                    mint: t('anchoredInteraction.detail.mint'),
                    createdAt: t('anchoredInteraction.detail.createdAt'),
                    disclaimer: t('anchoredInteraction.detail.disclaimer'),
                    sameNameMember: t('anchoredInteraction.tipSummary.sameNameMember'),
                    eventKinds: {
                        plaza_interaction_created: t('anchoredInteraction.detail.eventKinds.plaza_interaction_created'),
                        signup_joined: t('anchoredInteraction.detail.eventKinds.signup_joined'),
                        signup_updated: t('anchoredInteraction.detail.eventKinds.signup_updated'),
                        signup_left: t('anchoredInteraction.detail.eventKinds.signup_left'),
                        signup_closed: t('anchoredInteraction.detail.eventKinds.signup_closed'),
                        poll_voted: t('anchoredInteraction.detail.eventKinds.poll_voted'),
                        poll_vote_removed: t('anchoredInteraction.detail.eventKinds.poll_vote_removed'),
                        poll_closed: t('anchoredInteraction.detail.eventKinds.poll_closed'),
                        challenge_submitted: t('anchoredInteraction.detail.eventKinds.challenge_submitted'),
                        challenge_accepted: t('anchoredInteraction.detail.eventKinds.challenge_accepted'),
                        challenge_rejected: t('anchoredInteraction.detail.eventKinds.challenge_rejected'),
                        challenge_changes_requested: t('anchoredInteraction.detail.eventKinds.challenge_changes_requested'),
                        challenge_voted: t('anchoredInteraction.detail.eventKinds.challenge_voted'),
                        challenge_closed: t('anchoredInteraction.detail.eventKinds.challenge_closed'),
                        announcement_read: t('anchoredInteraction.detail.eventKinds.announcement_read'),
                        announcement_closed: t('anchoredInteraction.detail.eventKinds.announcement_closed'),
                        support_added: t('anchoredInteraction.detail.eventKinds.support_added'),
                        support_removed: t('anchoredInteraction.detail.eventKinds.support_removed'),
                        tip_transfer_initiated: t('anchoredInteraction.detail.eventKinds.tip_transfer_initiated'),
                        tip_transfer_recorded: t('anchoredInteraction.detail.eventKinds.tip_transfer_recorded'),
                        tip_transfer_failed: t('anchoredInteraction.detail.eventKinds.tip_transfer_failed'),
                        bounty_submitted: t('anchoredInteraction.detail.eventKinds.bounty_submitted'),
                        bounty_completion_accepted: t('anchoredInteraction.detail.eventKinds.bounty_completion_accepted'),
                        bounty_completion_rejected: t('anchoredInteraction.detail.eventKinds.bounty_completion_rejected'),
                        bounty_settlement_recorded: t('anchoredInteraction.detail.eventKinds.bounty_settlement_recorded'),
                        bounty_refunded: t('anchoredInteraction.detail.eventKinds.bounty_refunded'),
                        bounty_closed: t('anchoredInteraction.detail.eventKinds.bounty_closed'),
                        unknown: t('anchoredInteraction.detail.eventKinds.unknown'),
                    },
                }}
                receiptStatusLabels={{
                    pending: t('anchoredInteraction.receipt.pending'),
                    confirmed: t('anchoredInteraction.receipt.confirmed'),
                    failed: t('anchoredInteraction.receipt.failed'),
                    unverified: t('anchoredInteraction.receipt.unverified'),
                }}
                typeLabels={anchoredInteractionTypeLabels}
                statusLabel={anchoredInteractionDetail
                    ? t(`anchoredInteraction.status.${anchoredInteractionDetail.interaction.status}`)
                    : null}
                resultStatusLabel={anchoredInteractionDetail
                    ? t(`anchoredInteraction.resultStatus.${anchoredInteractionDetail.interaction.resultStatus}`)
                    : null}
                liveResultLabel={anchoredInteractionDetail
                    ? formatAnchoredInteractionLiveResult(anchoredInteractionDetail.interaction, t)
                    : null}
                availableActions={anchoredInteractionDetail
                    ? [anchoredInteractionActionLabels[anchoredInteractionDetail.interaction.interactionType]]
                    : []}
                onClose={() => {
                    setAnchoredInteractionDetail(null);
                    setAnchoredInteractionDetailError(null);
                }}
            />
            <AnchoredInteractionFieldSheet
                open={showAnchoredInteractionField}
                title={t('anchoredInteraction.field.title')}
                closeLabel={t('anchoredInteraction.cancel')}
                anchorLabels={{
                    discussionMessage: t('anchoredInteraction.field.messageAnchor'),
                    freeform: t('anchoredInteraction.field.freeformAnchor'),
                }}
                groups={anchoredInteractionField.groups}
                typeLabels={anchoredInteractionTypeLabels}
                statusLabels={{
                    open: t('anchoredInteraction.status.open'),
                    closed: t('anchoredInteraction.status.closed'),
                    resolved: t('anchoredInteraction.status.resolved'),
                    archived: t('anchoredInteraction.status.archived'),
                }}
                onSelect={handleSelectAnchoredInteractionFromField}
                onClose={() => setShowAnchoredInteractionField(false)}
            />
            <CirclePicker
                open={showForwardPicker}
                circles={eligibleForwardTargets}
                selectedCount={forwardingMessageId === null ? 0 : 1}
                onSelect={(circle) => void handleForwardSelect(circle)}
                onClose={() => {
                    setShowForwardPicker(false);
                    setForwardingMessageId(null);
                }}
            />
            <CirclePicker
                open={showBatchForwardPicker}
                circles={eligibleForwardTargets}
                selectedCount={selectedForwardMessageIds.length}
                onSelect={(circle) => void handleBatchForwardSelect(circle)}
                onClose={() => {
                    setShowBatchForwardPicker(false);
                }}
            />

            {/* ── WeChat-Style Composer ── */}
            <div className={styles.composerWrap}>
                {messageSelectionMode && (
                    <div
                        className={styles.manualDraftSelectionBar}
                        data-testid="manual-draft-selection-bar"
                        data-selection-mode={messageSelectionMode}
                    >
                        <div className={styles.manualDraftSelectionMeta}>
                            <span>
                                {governanceCaseSelectionMode
                                    ? t('governanceCase.selection.selectedCount', {
                                        count: selectedGovernanceCaseSourceMessageIds.length,
                                        limit: MESSAGE_SELECTION_LIMIT,
                                    })
                                    : manualDraftSelectionMode
                                    ? t('manualDraft.selection.selectedCount', {
                                        count: selectedManualDraftSourceMessageIds.length,
                                        limit: MANUAL_DRAFT_SELECTION_LIMIT,
                                    })
                                    : t('forward.selection.selectedCount', {
                                        count: selectedForwardMessageIds.length,
                                        limit: MESSAGE_SELECTION_LIMIT,
                                    })}
                            </span>
                            {messageSelectionError && (
                                <span className={styles.manualDraftSelectionError}>{messageSelectionError}</span>
                            )}
                            {manualDraftSelectionMode && manualDraftSelectionHint && (
                                <span>{manualDraftSelectionHint}</span>
                            )}
                            {governanceCaseSelectionMode && (
                                <div className={styles.governanceCaseSelectionFields}>
                                    <input
                                        value={governanceCaseTitle}
                                        onChange={(event) => {
                                            setGovernanceCaseTitle(event.target.value);
                                            setGovernanceCaseSuggestions([]);
                                            setGovernanceCasePreflightAcknowledged(false);
                                            setGovernanceCaseRelationship(null);
                                            setGovernanceCaseRelationshipReason('');
                                        }}
                                        placeholder={t('governanceCase.selection.titlePlaceholder')}
                                        maxLength={160}
                                        aria-label={t('governanceCase.selection.titleLabel')}
                                    />
                                    <textarea
                                        value={governanceRequestedDecision}
                                        onChange={(event) => setGovernanceRequestedDecision(event.target.value)}
                                        placeholder={t('governanceCase.selection.decisionPlaceholder')}
                                        maxLength={2000}
                                        aria-label={t('governanceCase.selection.decisionLabel')}
                                    />
                                    <GovernanceCaseTemplatePicker
                                        circleId={discussionCircleId}
                                        caseType="signal"
                                        value={governanceCaseTemplate}
                                        onChange={setGovernanceCaseTemplate}
                                        disabled={creatingDiscussionDraft}
                                    />
                                    {governanceCaseSuggestions.length > 0 && !governanceCasePreflightAcknowledged ? (
                                        <section className={styles.governanceCaseSuggestions} aria-label={t('governanceCase.selection.suggestionsTitle')}>
                                            <strong>{t('governanceCase.selection.suggestionsTitle')}</strong>
                                            <span>{t('governanceCase.selection.suggestionsBody')}</span>
                                            {governanceCaseSuggestions.map((suggestion) => (
                                                <article key={suggestion.caseId}>
                                                    <div>
                                                        <strong>{suggestion.title}</strong>
                                                        <span>{suggestion.reasons.map((reason) => t(`governanceCase.selection.reason.${reason}`)).join(' · ')}</span>
                                                    </div>
                                                    <div className={styles.governanceCaseSuggestionActions}>
                                                        <button type="button" onClick={() => router.push(suggestion.canonicalUrl)}>
                                                            {t('governanceCase.selection.openExisting')}
                                                        </button>
                                                        <button type="button" onClick={() => {
                                                            setGovernanceCaseRelationship({ kind: 'related', caseId: suggestion.caseId });
                                                            setGovernanceCaseRelationshipReason('');
                                                            setGovernanceCasePreflightAcknowledged(true);
                                                        }}>{t('governanceCase.selection.createRelated')}</button>
                                                        <button type="button" onClick={() => {
                                                            setGovernanceCaseRelationship({ kind: 'supersedes', caseId: suggestion.caseId });
                                                            setGovernanceCaseRelationshipReason('');
                                                            setGovernanceCasePreflightAcknowledged(true);
                                                        }}>{t('governanceCase.selection.createSuperseding')}</button>
                                                    </div>
                                                </article>
                                            ))}
                                            <button type="button" className={styles.governanceCaseSeparateButton} onClick={() => {
                                                setGovernanceCaseRelationship(null);
                                                setGovernanceCaseRelationshipReason('');
                                                setGovernanceCasePreflightAcknowledged(true);
                                            }}>{t('governanceCase.selection.createSeparate')}</button>
                                        </section>
                                    ) : null}
                                    {governanceCasePreflightAcknowledged && governanceCaseRelationship ? (
                                        <span className={styles.governanceCaseRelationshipChoice}>
                                            {t(`governanceCase.selection.relationship.${governanceCaseRelationship.kind}`)}
                                        </span>
                                    ) : null}
                                    {governanceCasePreflightAcknowledged && governanceCaseRelationship?.kind === 'supersedes' ? (
                                        <textarea
                                            value={governanceCaseRelationshipReason}
                                            onChange={(event) => setGovernanceCaseRelationshipReason(event.target.value)}
                                            placeholder={t('governanceCase.selection.correctionReasonPlaceholder')}
                                            aria-label={t('governanceCase.selection.correctionReasonLabel')}
                                            minLength={10}
                                            maxLength={1000}
                                        />
                                    ) : null}
                                </div>
                            )}
                        </div>
                        <div className={styles.manualDraftSelectionActions}>
                            <button
                                type="button"
                                className={styles.manualDraftSelectionCancel}
                                onClick={handleCancelMessageSelection}
                                disabled={creatingDiscussionDraft}
                            >
                                {t('manualDraft.selection.cancel')}
                            </button>
                            <button
                                type="button"
                                className={styles.manualDraftSelectionSubmit}
                                onClick={() => {
                                    if (governanceCaseSelectionMode) {
                                        void handleCreateCaseFromSelectedMessages();
                                        return;
                                    }
                                    if (manualDraftSelectionMode) {
                                        void handleCreateDraftFromSelectedMessages();
                                        return;
                                    }
                                    handleOpenBatchForwardPicker();
                                }}
                                disabled={
                                    governanceCaseSelectionMode
                                        ? creatingDiscussionDraft
                                            || selectedGovernanceCaseSourceMessageIds.length === 0
                                            || governanceCaseTitle.trim().length < 3
                                            || governanceRequestedDecision.trim().length < 10
                                            || !governanceCaseTemplate
                                            || (
                                                governanceCaseRelationship?.kind === 'supersedes'
                                                && governanceCaseRelationshipReason.trim().length < 10
                                            )
                                        : manualDraftSelectionMode
                                        ? creatingDiscussionDraft
                                            || selectedManualDraftSourceMessageIds.length === 0
                                            || !viewerHasRegisteredIdentity
                                            || !viewerCanCreateManualDiscussionDraft
                                        : selectedForwardMessageIds.length === 0
                                            || Boolean(forwardSelectionDisabledReason)
                                            || showBatchForwardPicker
                                }
                            >
                                {governanceCaseSelectionMode
                                    ? creatingDiscussionDraft
                                        ? t('governanceCase.selection.busy')
                                        : t('governanceCase.selection.submit')
                                    : manualDraftSelectionMode
                                    ? creatingDiscussionDraft
                                        ? t('composer.actions.draftBusy')
                                        : t('manualDraft.selection.submit')
                                    : t('forward.selection.submit')}
                            </button>
                        </div>
                    </div>
                )}
                {composerIdentityHint && !showComposerIdentityHint && !chatInput.trim() && (
                    <div className={styles.composerHintTriggerDock}>
                        <button
                            type="button"
                            className={styles.composerHintTrigger}
                            aria-label={t('composer.identityHintOpenAria')}
                            onClick={handleShowComposerIdentityHint}
                        >
                            <ChevronUp size={14} />
                        </button>
                    </div>
                )}
                <AnimatePresence>
                    {showComposerIdentityHint && composerIdentityHint && (
                        <motion.div
                            className={styles.composerIdentityHint}
                            initial={{ opacity: 0, y: 8 }}
                            animate={{ opacity: 1, y: 0 }}
                            exit={{ opacity: 0, y: 6 }}
                            transition={{ duration: 0.22 }}
                        >
                            {composerContributionLevelBadgeState && composerContributionLevelLabel && (
                                <span className={styles.composerIdentityLevelIcon}>
                                    <IdentityBadge
                                        state={composerContributionLevelBadgeState}
                                        label={composerContributionLevelLabel}
                                        compact
                                    />
                                </span>
                            )}
                            <span className={styles.composerIdentityHintText}>{composerIdentityHint}</span>
                        </motion.div>
                    )}
                </AnimatePresence>
                {replyTarget && (
                    <div className={styles.replyBanner}>
                        <div className={styles.replyBannerMeta}>
                            <CornerDownLeft size={14} />
                            <span>{t('reply.banner', {author: replyTarget.author})}</span>
                        </div>
                        <div className={styles.replyBannerBody}>{replyTarget.preview}</div>
                        <button
                            className={styles.replyBannerClose}
                            type="button"
                            aria-label={t('reply.cancelAria')}
                            onClick={() => setReplyTarget(null)}
                        >
                            <X size={14} />
                        </button>
                    </div>
                )}
                {composerLabels.length > 0 && (
                    <div className={styles.composerSelectedLabels}>
                        {composerLabels.map((label) => (
                            <button
                                key={label}
                                type="button"
                                className={styles.composerSelectedLabel}
                                onClick={() => toggleComposerLabel(label)}
                                disabled={!viewerHasRegisteredIdentity}
                            >
                                {semanticFacetCopy[label]}
                            </button>
                        ))}
                    </div>
                )}
                {(voiceStatus !== 'idle' || voiceError) && (
                    <div className={styles.composerVoiceDock}>
                        <div className={styles.composerVoiceState}>
                            <span
                                className={`${styles.composerVoiceIndicator} ${voiceConnected ? styles.composerVoiceIndicatorActive : ''}`}
                                aria-hidden="true"
                            />
                            <span className={styles.composerVoiceText}>{voiceDockMessage}</span>
                            {voiceConnected && (
                                <span className={styles.composerVoiceMeta}>
                                    {t('voice.participantCount', {count: Math.max(voiceParticipantCount, 1)})}
                                </span>
                            )}
                        </div>
                        {voiceConnected && (
                            <div className={styles.composerVoiceControls}>
                                <button
                                    type="button"
                                    className={styles.composerVoiceControlBtn}
                                    onClick={handleToggleVoiceMute}
                                    disabled={!voiceCanPublishAudio}
                                    aria-label={voiceMuted ? t('voice.unmute') : t('voice.mute')}
                                    title={!voiceCanPublishAudio ? t('voice.listenOnly') : undefined}
                                >
                                    {voiceMuted ? <MicOff size={15} /> : <Mic size={15} />}
                                </button>
                                <button
                                    type="button"
                                    className={styles.composerVoiceControlBtn}
                                    onClick={handleLeaveVoice}
                                    aria-label={t('voice.leave')}
                                    title={activeVoiceSessionId || undefined}
                                >
                                    <PhoneOff size={15} />
                                </button>
                            </div>
                        )}
                    </div>
                )}
                {showVoiceManagement && voiceManagement && (
                    <div className={styles.composerVoiceManagement}>
                        <div className={styles.composerVoiceManagementHeader}>
                            <span>{t('voice.managementTitle')}</span>
                            <span>
                                {t('voice.activeSpeakerCount', {
                                    count: activeVoiceSpeakerCount,
                                    max: voiceManagement.policy.maxSpeakers,
                                })}
                            </span>
                        </div>
                        <div className={styles.composerVoicePolicyLine}>
                            {t('voice.strategy', {strategy: voiceManagement.policy.strategy})}
                        </div>
                        <div className={styles.composerVoicePolicyLine} data-testid="voice-session-moderation-boundary">
                            {voiceBoundaryT('copy')}
                        </div>
                        {queuedVoiceParticipants.length > 0 ? (
                            <div className={styles.composerVoiceQueue}>
                                {queuedVoiceParticipants.map((participant) => (
                                    <div
                                        key={participant.walletPubkey}
                                        className={styles.composerVoiceQueueRow}
                                    >
                                        <div className={styles.composerVoiceQueueMeta}>
                                            <span className={styles.composerVoiceQueueWallet}>
                                                {participant.effectiveDisplayName
                                                    || participant.displayName
                                                    || participant.circleAlias
                                                    || genericMemberLabel}
                                            </span>
                                            <span>
                                                {t('voice.queuePosition', {
                                                    position: participant.queuePosition ?? 1,
                                                })}
                                            </span>
                                        </div>
                                        <div className={styles.composerVoiceQueueActions}>
                                            <button
                                                type="button"
                                                className={styles.composerVoiceDecisionBtn}
                                                onClick={() => handleVoiceSpeakerDecision(participant.walletPubkey, 'approve')}
                                                disabled={voiceManagementBusyWallet === participant.walletPubkey}
                                            >
                                                {t('voice.approve')}
                                            </button>
                                            <button
                                                type="button"
                                                className={styles.composerVoiceDecisionBtn}
                                                onClick={() => handleVoiceSpeakerDecision(participant.walletPubkey, 'deny')}
                                                disabled={voiceManagementBusyWallet === participant.walletPubkey}
                                            >
                                                {t('voice.deny')}
                                            </button>
                                        </div>
                                    </div>
                                ))}
                            </div>
                        ) : (
                            <div className={styles.composerVoicePolicyLine}>{t('voice.noQueue')}</div>
                        )}
                    </div>
                )}
                {/* Input Row: textarea + action button */}
                <div className={`${styles.composerRow} ${styles.composerBar}`}>
                    <textarea
                        ref={textareaRef}
                        className={styles.composerTextarea}
                        placeholder={
                            viewerSessionPubkey
                                ? replyTarget
                                    ? t('composer.replyPlaceholder', {author: replyTarget.author})
                                    : viewerJoined
                                        ? t('composer.placeholderJoined')
                                        : t('composer.placeholderEphemeral')
                                : t('composer.placeholderDisconnected')
                        }
                        value={chatInput}
                        onChange={handleTextareaChange}
                        onKeyDown={handleKeyDown}
                        onFocus={handleTextareaFocus}
                        disabled={!viewerHasRegisteredIdentity}
                        rows={1}
                    />
                    <button
                        className={`${styles.composerVoiceBtn} ${voiceConnected ? styles.composerVoiceBtnActive : ''}`}
                        onClick={voiceConnected ? handleToggleVoiceMute : handleJoinVoice}
                        type="button"
                        disabled={voicePrimaryDisabled}
                        aria-label={voicePrimaryLabel}
                        title={voicePrimaryLabel}
                    >
                        {voiceStatus === 'joining' || voiceStatus === 'leaving' ? (
                            <Loader2 className={styles.composerVoiceSpinner} size={18} />
                        ) : voiceConnected && voiceMuted ? (
                            <MicOff size={18} />
                        ) : (
                            <Mic size={18} />
                        )}
                    </button>
                    {chatInput.trim() ? (
                        <button
                            className={styles.composerSendBtn}
                            onClick={handleSend}
                            type="button"
                            disabled={!viewerHasRegisteredIdentity}
                            aria-label={t('composer.sendAria')}
                        >
                            <SendHorizonal size={18} />
                        </button>
                    ) : (
                        <button
                            className={`${styles.composerPlusBtn} ${showPanel ? styles.composerPlusBtnActive : ''}`}
                            onClick={() => setShowPanel((v) => !v)}
                            type="button"
                            disabled={!viewerHasRegisteredIdentity}
                            aria-label={t('composer.moreAria')}
                        >
                            <Plus size={20} />
                        </button>
                    )}
                </div>

                {/* Expandable Panel */}
                <AnimatePresence>
                    {showPanel && (
                        <motion.div
                            className={styles.composerPanel}
                            initial={{ height: 0, opacity: 0 }}
                            animate={{ height: 'auto', opacity: 1 }}
                            exit={{ height: 0, opacity: 0 }}
                            transition={{ duration: 0.28, ease: [0.2, 0.8, 0.2, 1] }}
                        >
                            {/* Operation Row */}
                            <div className={styles.composerOps}>
                                <button
                                    className={styles.composerOpBtn}
                                    type="button"
                                    onClick={voiceConnected ? handleToggleVoiceMute : handleJoinVoice}
                                    disabled={voicePrimaryDisabled}
                                    title={voicePrimaryLabel}
                                >
                                    {voiceStatus === 'joining' || voiceStatus === 'leaving' ? (
                                        <Loader2 className={styles.composerVoiceSpinner} size={22} />
                                    ) : voiceConnected && voiceMuted ? (
                                        <MicOff size={22} />
                                    ) : (
                                        <Mic size={22} />
                                    )}
                                    <span>{voiceConnected ? voicePrimaryLabel : t('voice.join')}</span>
                                </button>
                                <button
                                    className={styles.composerOpBtn}
                                    onClick={() => setShowEmojiGrid((prev) => !prev)}
                                    type="button"
                                >
                                    <Smile size={22} />
                                    <span>{t('composer.actions.emoji')}</span>
                                </button>
                                <button
                                    className={styles.composerOpBtn}
                                    type="button"
                                    onClick={handleOpenFreeformAnchoredInteractionComposer}
                                    disabled={!viewerHasRegisteredIdentity}
                                >
                                    <Plus size={22} />
                                    <span>{t('anchoredInteraction.createFromComposer')}</span>
                                </button>
                                <button
                                    className={styles.composerOpBtn}
                                    type="button"
                                    onClick={() => {
                                        void ensureDiscussionSessionToken()
                                            .then(() => {
                                                setAnnouncementError(
                                                    announcementCapabilities.canPublish
                                                        ? null
                                                        : announcementCopy.publishPermissionRequired,
                                                );
                                                setShowAnnouncementPublish(true);
                                                setShowPanel(false);
                                            })
                                            .catch((error) => {
                                                setAnnouncementError(error instanceof Error ? error.message : viewerIdentityWriteError);
                                            });
                                    }}
                                    disabled={!viewerHasRegisteredIdentity}
                                    title={announcementCapabilities.canPublish ? undefined : announcementCopy.publishPermissionRequired}
                                >
                                    <Megaphone size={22} />
                                    <span>{announcementCopy.publish}</span>
                                </button>
                                <button
                                    className={styles.composerOpBtn}
                                    type="button"
                                    onClick={handleCreateDraftFromDiscussion}
                                    disabled={Boolean(manualDraftSelectionDisabledReason)}
                                    title={manualDraftSelectionDisabledReason ?? undefined}
                                >
                                    <FileEdit size={22} />
                                    <span>
                                        {creatingDiscussionDraft
                                            ? t('composer.actions.draftBusy')
                                            : t('composer.actions.createDraftFromVisibleMessages', {
                                                count: manualDraftSourceMessageIds.length,
                                            })}
                                    </span>
                                </button>
                                <button
                                    className={styles.composerOpBtn}
                                    type="button"
                                    onClick={handleStartManualDraftSelection}
                                    disabled={Boolean(manualDraftSelectionDisabledReason)}
                                    title={manualDraftSelectionDisabledReason ?? undefined}
                                >
                                    <ListChecks size={22} />
                                    <span>{t('composer.actions.selectMessagesForDraft')}</span>
                                </button>
                                <button
                                    className={styles.composerOpBtn}
                                    type="button"
                                    onClick={handleStartGovernanceCaseSelection}
                                    disabled={Boolean(manualDraftSelectionDisabledReason)}
                                    title={manualDraftSelectionDisabledReason ?? undefined}
                                >
                                    <Landmark size={22} />
                                    <span>{t('composer.actions.selectMessagesForGovernanceCase')}</span>
                                </button>
                                <button
                                    className={styles.composerOpBtn}
                                    type="button"
                                    onClick={handleStartBatchForwardSelection}
                                    disabled={Boolean(forwardSelectionDisabledReason)}
                                    title={forwardSelectionDisabledReason ?? undefined}
                                >
                                    <ArrowUpRight size={22} />
                                    <span>{t('composer.actions.selectMessagesForForward')}</span>
                                </button>
                            </div>
                            {viewerCanConfigureVoice && (
                                <div className={styles.composerVoiceSettings}>
                                    <div className={styles.composerVoiceSettingsHeader}>
                                        {t('voice.settingsTitle')}
                                    </div>
                                    <label className={styles.composerVoiceSettingField}>
                                        <span>{t('voice.maxSpeakers')}</span>
                                        <input
                                            type="number"
                                            min={1}
                                            max={100}
                                            value={voicePolicyMaxSpeakers}
                                            disabled={!voicePolicyLoaded || voicePolicySaving}
                                            onChange={(event) => {
                                                const nextValue = Number.parseInt(event.target.value, 10);
                                                setVoicePolicyMaxSpeakers(Number.isFinite(nextValue) ? nextValue : 1);
                                                setVoicePolicyDirty(true);
                                            }}
                                        />
                                    </label>
                                    <label className={styles.composerVoiceSettingField}>
                                        <span>{t('voice.overflowStrategy')}</span>
                                        <select
                                            value={voicePolicyStrategy}
                                            disabled={!voicePolicyLoaded || voicePolicySaving}
                                            onChange={(event) => {
                                                setVoicePolicyStrategy(event.target.value as VoiceOverflowStrategy);
                                                setVoicePolicyDirty(true);
                                            }}
                                        >
                                            {VOICE_OVERFLOW_STRATEGIES.map((strategy) => (
                                                <option key={strategy} value={strategy}>
                                                    {strategy}
                                                </option>
                                            ))}
                                        </select>
                                    </label>
                                    <button
                                        type="button"
                                        className={styles.composerVoiceSettingsSave}
                                        onClick={handleSaveVoicePolicy}
                                        disabled={voicePolicySaving || !voicePolicyLoaded}
                                    >
                                        {voicePolicySaving ? t('voice.savingPolicy') : t('voice.savePolicy')}
                                    </button>
                                </div>
                            )}
                            <div className={styles.composerLabelSection}>
                                <div className={styles.composerLabelSectionHeader}>
                                    <span className={styles.composerLabelSectionTitle}>{t('composer.authorAnnotations.title')}</span>
                                    {composerLabels.length > 0 && (
                                        <button
                                            type="button"
                                            className={styles.composerLabelClearBtn}
                                            onClick={() => setComposerLabels([])}
                                        >
                                            {t('composer.authorAnnotations.clear')}
                                        </button>
                                    )}
                                </div>
                                <div className={styles.composerLabelPicker}>
                                    {AUTHOR_ANNOTATION_VALUES.map((label) => {
                                        const selected = composerLabels.includes(label);
                                        return (
                                            <button
                                                key={label}
                                                type="button"
                                                className={`${styles.composerLabelBtn} ${selected ? styles.composerLabelBtnActive : ''}`}
                                                onClick={() => toggleComposerLabel(label)}
                                                disabled={!viewerHasRegisteredIdentity}
                                            >
                                                {semanticFacetCopy[label]}
                                            </button>
                                        );
                                    })}
                                </div>
                                <p className={styles.msgEphemeralTag}>{t('composer.authorAnnotations.hint')}</p>
                            </div>

                            {/* Emoji Grid */}
                            {showEmojiGrid && (
                                <div className={styles.emojiGrid}>
                                    {EMOJI_LIST.map((e) => (
                                        <button
                                            key={e}
                                            className={styles.emojiBtn}
                                            onClick={() => insertEmoji(e)}
                                            type="button"
                                        >
                                            {e}
                                        </button>
                                    ))}
                                </div>
                            )}
                        </motion.div>
                    )}
                </AnimatePresence>
            </div>
        </div>
    );
}

function createGovernanceCaseIdempotencyKey(): string {
    if (typeof crypto !== 'undefined' && typeof crypto.randomUUID === 'function') {
        return `case-intake:${crypto.randomUUID()}`;
    }
    return `case-intake:${Date.now()}:${Math.random().toString(16).slice(2)}`;
}

export default PlazaTab;
