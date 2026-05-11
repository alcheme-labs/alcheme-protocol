'use client';

import { useState, useCallback, useEffect, useRef, useMemo } from 'react';
import { useRouter } from 'next/navigation';
import { motion, AnimatePresence, PanInfo } from 'framer-motion';
import { useMutation } from '@apollo/client/react';
import { Smile, Paperclip, AtSign, SendHorizonal, CornerDownLeft, Copy, Trash2, Compass, Rss, Plus, X, ChevronUp, ChevronDown, FileEdit, Mic, MicOff, PhoneOff, Loader2 } from 'lucide-react';

import HighlightButton from '@/components/circle/HighlightButton';
import MessageActionSheet from '@/components/circle/MessageActionSheet/MessageActionSheet';
import ChatRecordBubble from '@/components/circle/ChatRecordBubble/ChatRecordBubble';
import CirclePicker, { type PickerCircle } from '@/components/circle/CirclePicker/CirclePicker';
import { IdentityBadge, type IdentityState } from '@/components/circle/IdentityBadge';
import { Skeleton } from '@/components/ui/Skeleton';

import type { PlazaMessage, PlazaQuickAuxCircle, DiscussionSessionState } from '@/lib/circle/types';
import { mapDiscussionDtoToPlazaMessage } from '@/lib/circle/utils';
import {
    appendPlazaDiscussionMessages,
    dedupePlazaMessagesByEnvelope,
    pruneExpiredEphemeralMessages,
    refreshPlazaMessagesByEnvelope,
    syncPlazaDiscussionMessages as syncPlazaDiscussionMessagesSnapshot,
} from '@/lib/circle/plazaDiscussion';
import { HIGHLIGHT_MESSAGE } from '@/lib/apollo/queries';
import {
    createDiscussionSession,
    createDraftFromCandidate,
    createDraftFromDiscussionMessages,
    fetchDiscussionMessages,
    fetchDiscussionMessagesByEnvelopeIds,
    getDiscussionProtocolBaseUrl,
    forwardDiscussionMessage,
    refreshDiscussionSession,
    sendDiscussionMessage,
    tombstoneDiscussionMessage,
} from '@/lib/api/discussion';
import { createCommunicationSession } from '@/lib/api/communication';
import { createVoiceSession, createVoiceToken } from '@/lib/api/voice';
import {
    createLiveKitBrowserVoiceProvider,
    type LiveKitBrowserVoiceConnection,
    type LiveKitBrowserVoiceProvider,
} from '@/lib/voice/livekitClient';
import {
    runWithDiscussionSessionRecovery,
    type DiscussionSessionTokenOptions,
} from '@/lib/discussion/sessionRecovery';
import { subscribeToCircleDiscussionStream, type DiscussionRealtimeSubscription } from '@/lib/discussion/realtime';
import { createIdentityCopy, normalizeIdentityCopy } from '@/lib/circle/identityCopy';
import { canHighlightPlazaMessage } from '@/lib/circle/plazaHighlightPermissions';
import { isPlazaScrolledNearBottom } from '@/lib/circle/plazaScroll';
import { getGovernedForwardTargets, getPlazaForwardAction } from '@/lib/circle/plazaForwarding';
import { buildCircleTabHref } from '@/lib/notifications/routing';
import DraftCandidateInlineCard from '@/features/discussion-intake/candidate-cards/DraftCandidateInlineCard';
import {
    buildStructuredDiscussionMetadata,
    AUTHOR_ANNOTATION_VALUES,
    type AuthorAnnotationKind,
    type SemanticFacet,
} from '@/features/discussion-intake/labels/structuredMetadata';
import {
    parseDraftCandidateInlineNotice,
    type DraftCandidateInlineNotice,
    toAcceptedCandidateHandoffContext,
} from '@/features/discussion-intake/handoff/acceptedCandidate';
import { resolveCandidateRecoveryActions } from '@/features/discussion-intake/governance/recovery';
import { useCurrentLocale, useI18n } from '@/i18n/useI18n';
import styles from '@/app/(main)/circles/[id]/page.module.css';

const DISCUSSION_ATTACHMENTS_ENABLED = false;
const REPLY_PREVIEW_MAX_LENGTH = 64;
const COMPOSER_HINT_AUTO_HIDE_MS = 40_000;
const DISCUSSION_SYNC_LIMIT = 120;
const MANUAL_DRAFT_SOURCE_LIMIT = 16;

type VoiceStatus = 'idle' | 'joining' | 'connected' | 'leaving' | 'error';

interface CachedCommunicationVoiceSession {
    roomKey: string;
    walletPubkey: string;
    communicationAccessToken: string;
    expiresAt: string;
}

function messageMatchesContentFilters(
    message: PlazaMessage,
    activeFilters: AuthorAnnotationKind[],
): boolean {
    if (activeFilters.length === 0) return true;
    if (message.messageKind === 'draft_candidate_notice' || message.messageKind === 'governance_notice') {
        return true;
    }
    const semanticFacets = message.semanticFacets ?? [];
    if (semanticFacets.length === 0) return false;
    return semanticFacets.some((facet) => activeFilters.includes(facet as AuthorAnnotationKind));
}

interface HighlightMessageMutationResult {
    highlightMessage: {
        ok: boolean;
        highlightCount: number;
        isFeatured: boolean;
        alreadyHighlighted: boolean;
    };
}

function buildReplyPreview(text: string, emptyText: string): string {
    const normalized = text.replace(/\s+/g, ' ').trim();
    if (!normalized) return emptyText;
    return normalized.length > REPLY_PREVIEW_MAX_LENGTH
        ? `${normalized.slice(0, REPLY_PREVIEW_MAX_LENGTH - 1)}…`
        : normalized;
}

function buildQuotedReplyText(input: {
    author: string;
    preview: string;
    body: string;
}, template: (values: {author: string; preview: string; body: string}) => string): string {
    return template(input);
}

function PlazaTab({
    messages,
    loading,
    onSwipe,
    discussionCircleId,
    walletPubkey,
    signMessage,
    viewerJoined,
    viewerIdentity,
    quickAuxCircles,
    onQuickJumpToCircle,
    onOpenCrucible,
    onDraftsChanged,
    onAvatarTap,
    circleMembers,
    forwardTargets,
    currentForwardCircleId,
    currentForwardLevel,
    userCrystals,
    focusEnvelopeId,
    viewerStateHintOverride,
}: {
    messages: PlazaMessage[];
    loading: boolean;
    onSwipe: (e: MouseEvent | TouchEvent | PointerEvent, info: PanInfo) => void;
    discussionCircleId: number;
    walletPubkey: string | null;
    signMessage?: (message: Uint8Array) => Promise<Uint8Array>;
    viewerJoined: boolean;
    viewerIdentity: IdentityState;
    quickAuxCircles: PlazaQuickAuxCircle[];
    onQuickJumpToCircle?: (subCircleId: string) => void;
    onOpenCrucible?: (draftPostId?: number | null) => void;
    onDraftsChanged?: () => void | Promise<unknown>;
    onAvatarTap?: (author: string) => void;
    circleMembers?: Array<{ user: { handle: string; pubkey: string }; role: string; identityLevel: string }>;
    forwardTargets: PickerCircle[];
    currentForwardCircleId: string;
    currentForwardLevel: number;
    userCrystals: number;
    focusEnvelopeId?: string | null;
    viewerStateHintOverride?: string | null;
}) {
    const router = useRouter();
    const t = useI18n('PlazaTab');
    const locale = useCurrentLocale();
    type DiscussionViewMode = 'all' | 'focused' | 'mine';
    const discussionAuthMode = process.env.NEXT_PUBLIC_DISCUSSION_AUTH_MODE || 'session_token';
    const useSessionTokenAuth = discussionAuthMode === 'session_token';
    const shouldSignEachMessage =
        !useSessionTokenAuth && process.env.NEXT_PUBLIC_DISCUSSION_REQUIRE_SIGNATURE === 'true';
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
    const identityCopy = useMemo(() => createIdentityCopy(t), [t]);
    const composerIdentityHint = (
        viewerJoined
        && typeof viewerStateHintOverride === 'string'
        && viewerStateHintOverride.trim()
    )
        ? t('composer.identityHint', {
            stateLabel: identityCopy.stateLabels[viewerIdentity],
            hint: normalizeIdentityCopy(viewerStateHintOverride.trim()) || '',
        })
        : null;
    const eligibleForwardTargets = useMemo(
        () => getGovernedForwardTargets({
            circles: forwardTargets,
            currentLevel: currentForwardLevel,
            currentSubCircleId: currentForwardCircleId,
        }),
        [forwardTargets, currentForwardLevel, currentForwardCircleId],
    );
    /* ── Identity resolution from members data ── */
    const resolveIdentity = useCallback((author: string): IdentityState => {
        if (!circleMembers || circleMembers.length === 0) {
            // Fallback: everyone is 'initiate' if we have no member data
            return author.startsWith('visitor') ? 'visitor' : 'initiate';
        }
        const member = circleMembers.find(
            m => m.user.handle === author || m.user.pubkey === author,
        );
        if (!member) return 'visitor';
        if (member.role === 'Owner') return 'owner';
        if (member.role === 'Admin' || member.role === 'Moderator') return 'curator';
        if (member.identityLevel === 'Initiate') return 'initiate';
        if (member.identityLevel === 'Visitor') return 'visitor';
        return 'member';
    }, [circleMembers]);
    const [highlights, setHighlights] = useState<Record<number, number>>(() =>
        Object.fromEntries(messages.map((m) => [m.id, m.highlights]))
    );
    const [highlighted, setHighlighted] = useState<Set<number>>(new Set());
    const [chatInput, setChatInput] = useState('');
    const [localMessages, setLocalMessages] = useState<PlazaMessage[]>(messages);
    const [discussionLoading, setDiscussionLoading] = useState(false);
    const [discussionError, setDiscussionError] = useState<string | null>(null);
    const [discussionSession, setDiscussionSession] = useState<DiscussionSessionState | null>(null);
    const [voiceStatus, setVoiceStatus] = useState<VoiceStatus>('idle');
    const [voiceError, setVoiceError] = useState<string | null>(null);
    const [voiceMuted, setVoiceMuted] = useState(false);
    const [voiceCanPublishAudio, setVoiceCanPublishAudio] = useState(true);
    const [voiceParticipantCount, setVoiceParticipantCount] = useState(0);
    const [activeVoiceSessionId, setActiveVoiceSessionId] = useState<string | null>(null);
    const [lastEnvelopeId, setLastEnvelopeId] = useState<string | null>(null);
    const [viewMode, setViewMode] = useState<DiscussionViewMode>('all');
    const [showPanel, setShowPanel] = useState(false);
    const [showEmojiGrid, setShowEmojiGrid] = useState(false);
    const [actionSheetMsgId, setActionSheetMsgId] = useState<number | null>(null);
    const [replyTarget, setReplyTarget] = useState<{ author: string; preview: string } | null>(null);
    const [revealedDimmed, setRevealedDimmed] = useState<Set<number>>(new Set());
    const [showForwardPicker, setShowForwardPicker] = useState(false);
    const [forwardingMessageId, setForwardingMessageId] = useState<number | null>(null);
    const [discussionStatus, setDiscussionStatus] = useState<string | null>(null);
    const [creatingCandidateDraftId, setCreatingCandidateDraftId] = useState<string | null>(null);
    const [creatingDiscussionDraft, setCreatingDiscussionDraft] = useState(false);
    const [pendingCandidateDraftIds, setPendingCandidateDraftIds] = useState<Set<string>>(new Set());
    const [composerLabels, setComposerLabels] = useState<AuthorAnnotationKind[]>([]);
    const [activeContentFilters, setActiveContentFilters] = useState<AuthorAnnotationKind[]>([]);
    const [focusedEnvelopeId, setFocusedEnvelopeId] = useState<string | null>(focusEnvelopeId || null);
    const [showComposerIdentityHint, setShowComposerIdentityHint] = useState(false);
    const [showFilterPanel, setShowFilterPanel] = useState(false);
    const textareaRef = useRef<HTMLTextAreaElement>(null);
    const chatMessagesRef = useRef<HTMLDivElement>(null);
    const messagesEndRef = useRef<HTMLDivElement>(null);
    const longPressTimers = useRef<Map<number, ReturnType<typeof setTimeout>>>(new Map());
    const longPressFired = useRef<Set<number>>(new Set());
    const touchStartPos = useRef<Map<number, { x: number; y: number }>>(new Map());
    const sessionBootstrapRef = useRef<Promise<string | null> | null>(null);
    const discussionRealtimeSubscriptionRef = useRef<DiscussionRealtimeSubscription | null>(null);
    const voiceConnectionRef = useRef<LiveKitBrowserVoiceConnection | null>(null);
    const voiceProviderRef = useRef<LiveKitBrowserVoiceProvider | null>(null);
    const communicationVoiceSessionRef = useRef<CachedCommunicationVoiceSession | null>(null);
    const localMessagesRef = useRef<PlazaMessage[]>(messages);
    const shouldFollowLatestRef = useRef(true);
    const previousMessageCountRef = useRef(messages.length);
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
        if (!walletPubkey) {
            setShowPanel(false);
            setShowEmojiGrid(false);
            setReplyTarget(null);
            setShowForwardPicker(false);
            setForwardingMessageId(null);
        }
    }, [walletPubkey]);

    useEffect(() => {
        setFocusedEnvelopeId(focusEnvelopeId || null);
    }, [focusEnvelopeId]);

    useEffect(() => {
        if (!showPanel) {
            setShowEmojiGrid(false);
        }
    }, [showPanel]);

    useEffect(() => {
        if (!walletPubkey || !composerIdentityHint || chatInput.trim()) {
            setShowComposerIdentityHint(false);
        }
    }, [chatInput, composerIdentityHint, walletPubkey]);

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
        () => (walletPubkey ? `alcheme_discussion_session_${walletPubkey}` : null),
        [walletPubkey],
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
            if (!Number.isFinite(expiresAtMs) || expiresAtMs <= Date.now() || parsed.senderPubkey !== walletPubkey) {
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
    }, [discussionSessionStorageKey, walletPubkey]);

    const resetDiscussionSession = useCallback(() => {
        setDiscussionSession(null);
        persistDiscussionSession(null);
    }, [persistDiscussionSession]);

    const ensureDiscussionSessionToken = useCallback(async (
        options: DiscussionSessionTokenOptions = {},
    ): Promise<string | null> => {
        if (!useSessionTokenAuth) return null;
        if (!walletPubkey) throw new Error(t('errors.walletRequired'));

        const current = options.forceNew ? null : discussionSession;
        const now = Date.now();
        const expiresAtMs = current ? Date.parse(current.expiresAt) : 0;
        const isUsableCurrent =
            !!current
            && current.senderPubkey === walletPubkey
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
                && current.senderPubkey === walletPubkey
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
                senderPubkey: walletPubkey,
                senderHandle: `${walletPubkey.slice(0, 4)}...${walletPubkey.slice(-4)}`,
                signMessage,
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
        signMessage,
        t,
        useSessionTokenAuth,
        walletPubkey,
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

    const ensureCommunicationVoiceSessionToken = useCallback(async (): Promise<string> => {
        if (!walletPubkey) {
            throw new Error(t('voice.walletRequired'));
        }
        if (!viewerJoined) {
            throw new Error(t('voice.membershipRequired'));
        }
        const current = communicationVoiceSessionRef.current;
        const expiresAtMs = current ? Date.parse(current.expiresAt) : 0;
        if (
            current
            && current.walletPubkey === walletPubkey
            && current.roomKey === communicationRoomKey
            && Number.isFinite(expiresAtMs)
            && expiresAtMs - Date.now() > 60_000
        ) {
            return current.communicationAccessToken;
        }

        const created = await createCommunicationSession({
            walletPubkey,
            roomKey: communicationRoomKey,
            signMessage,
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
        return nextSession.communicationAccessToken;
    }, [
        communicationRoomKey,
        discussionCircleId,
        signMessage,
        t,
        viewerJoined,
        walletPubkey,
    ]);

    const handleLeaveVoice = useCallback(async () => {
        const currentConnection = voiceConnectionRef.current;
        if (!currentConnection) {
            setVoiceStatus('idle');
            setVoiceError(null);
            setVoiceMuted(false);
            setVoiceCanPublishAudio(true);
            setVoiceParticipantCount(0);
            setActiveVoiceSessionId(null);
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
            setVoiceCanPublishAudio(true);
            setVoiceMuted(false);
            setVoiceError(error instanceof Error ? error.message : t('voice.joinFailed'));
        }
    }, [
        communicationRoomKey,
        discussionCircleId,
        ensureCommunicationVoiceSessionToken,
        getVoiceProvider,
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

    useEffect(() => {
        return () => {
            const currentConnection = voiceConnectionRef.current;
            voiceConnectionRef.current = null;
            communicationVoiceSessionRef.current = null;
            void currentConnection?.leave();
        };
    }, [communicationRoomKey, walletPubkey]);

    useEffect(() => {
        communicationVoiceSessionRef.current = null;
        setVoiceStatus('idle');
        setVoiceError(null);
        setVoiceMuted(false);
        setVoiceCanPublishAudio(true);
        setVoiceParticipantCount(0);
        setActiveVoiceSessionId(null);
    }, [communicationRoomKey, walletPubkey]);

    useEffect(() => {
        // Intentionally only react to circle changes. `messages` prop is re-created
        // on parent rerenders and would otherwise keep resetting live discussion state.
        const fallbackMessages = messages.map((m) => ({ ...m, sendState: m.sendState || 'sent' as const }));
        setLocalMessages(fallbackMessages);
        setHighlights(Object.fromEntries(fallbackMessages.map((m) => [m.id, m.highlights])));
        setHighlighted(new Set());
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

    const extractLatestLamport = useCallback((messageList: PlazaMessage[]): number => {
        for (let index = messageList.length - 1; index >= 0; index -= 1) {
            const message = messageList[index];
            if (typeof message.envelopeId !== 'string' || message.envelopeId.trim().length === 0) continue;
            if (typeof message.id === 'number' && Number.isFinite(message.id)) {
                return Math.max(0, Math.trunc(message.id));
            }
        }
        return 0;
    }, []);

    const commitDiscussionMessages = useCallback((nextMessages: PlazaMessage[]) => {
        if (nextMessages === localMessagesRef.current) {
            return;
        }
        localMessagesRef.current = nextMessages;
        setLocalMessages(nextMessages);
        setHighlights(Object.fromEntries(nextMessages.map((message) => [message.id, message.highlights])));
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

    useEffect(() => {
        let cancelled = false;

        async function loadDiscussionMessages() {
            if (!Number.isFinite(discussionCircleId) || discussionCircleId <= 0) {
                return;
            }

            setDiscussionLoading(true);
            try {
                const response = await fetchDiscussionMessages({
                    circleId: discussionCircleId,
                    limit: DISCUSSION_SYNC_LIMIT,
                });
                if (cancelled) return;

                if (response.messages.length === 0) {
                    setDiscussionLoading(false);
                    return;
                }

                applyDiscussionSnapshot(response);
                setHighlighted(new Set());
            } catch (error) {
                if (cancelled) return;
                setDiscussionError(error instanceof Error ? error.message : t('errors.loadFailed'));
            } finally {
                if (!cancelled) setDiscussionLoading(false);
            }
        }

        loadDiscussionMessages();

        return () => {
            cancelled = true;
        };
    }, [applyDiscussionSnapshot, discussionCircleId, t]);

    useEffect(() => {
        if (!Number.isFinite(discussionCircleId) || discussionCircleId <= 0) {
            return;
        }

        let cancelled = false;
        let handleVisibilityChange: (() => void) | null = null;

        async function startRealtime() {
            try {
                const baseUrl = await getDiscussionProtocolBaseUrl();
                if (cancelled) return;

                const subscription = subscribeToCircleDiscussionStream({
                    circleId: discussionCircleId,
                    streamUrl: `${baseUrl}/api/v1/discussion/circles/${discussionCircleId}/stream`,
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
                    getLastLamport: () => extractLatestLamport(localMessagesRef.current),
                    applyCatchUp: async (response) => {
                        if (cancelled) return;
                        applyDiscussionCatchUp(response);
                    },
                    applyTargetedRefresh: async (response) => {
                        if (cancelled) return;
                        applyDiscussionTargetedRefresh(response);
                    },
                    onError: (message) => {
                        if (cancelled) return;
                        setDiscussionError(message);
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
        discussionCircleId,
        extractLatestLamport,
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

            const isMine = !!walletPubkey && msg.senderPubkey === walletPubkey;
            if (isMine) return true;

            if (viewMode === 'mine') return false;

            return msg.focusLabel !== 'off_topic';
        });

        return filteredByViewMode.filter((message) => messageMatchesContentFilters(message, activeContentFilters));
    }, [activeContentFilters, localMessages, viewMode, walletPubkey]);

    const manualDraftSourceMessageIds = useMemo(() => visibleMessages
        .filter((message) =>
            Boolean(message.envelopeId)
            && message.messageKind !== 'draft_candidate_notice'
            && message.messageKind !== 'governance_notice'
            && !message.deleted
            && !message.ephemeral
            && message.text.trim().length > 0
            && (message.relevanceStatus === 'ready' || !message.relevanceStatus)
        )
        .slice(-MANUAL_DRAFT_SOURCE_LIMIT)
        .map((message) => message.envelopeId!)
    , [visibleMessages]);

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

    const hiddenMessageCount = Math.max(0, localMessages.length - visibleMessages.length);
    const actionSheetMessage = useMemo(
        () => (actionSheetMsgId === null ? null : localMessages.find((m) => m.id === actionSheetMsgId) || null),
        [actionSheetMsgId, localMessages],
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
    const canHighlightActionSheetMessage = useMemo(() => {
        if (!actionSheetMessage) return false;
        return canHighlightPlazaMessage({
            messageId: actionSheetMessage.id,
            highlightedIds: highlighted,
            walletPubkey,
            senderPubkey: actionSheetMessage.senderPubkey,
            deleted: actionSheetMessage.deleted,
            ephemeral: actionSheetMessage.ephemeral,
        });
    }, [actionSheetMessage, highlighted, walletPubkey]);

    const getInitials = (author: string): string => {
        const name = author.replace(/\.sol$/, '');
        return name.substring(0, 2).toUpperCase();
    };

    const [highlightMutation] = useMutation<HighlightMessageMutationResult>(HIGHLIGHT_MESSAGE);
    const handleHighlight = useCallback((msgId: number) => {
        const msg = localMessages.find((item) => Number(item.id) === msgId);
        if (!msg) return;
        if (!canHighlightPlazaMessage({
            messageId: msgId,
            highlightedIds: highlighted,
            walletPubkey,
            senderPubkey: msg.senderPubkey,
            deleted: msg.deleted,
            ephemeral: msg.ephemeral,
        })) {
            return;
        }
        if (!msg.envelopeId) return;
        const previousCount = highlights[msgId] || 0;
        setHighlights((prev) => {
            const nextCount = (prev[msgId] || 0) + 1;
            return { ...prev, [msgId]: nextCount };
        });
        setHighlighted((prev) => new Set(prev).add(msgId));
        setLocalMessages((prev) =>
            prev.map((item) =>
                item.id === msgId
                    ? {
                        ...item,
                        isFeatured: true,
                        featureReason: item.featureReason || 'member_highlight',
                    }
                    : item,
            ),
        );
        highlightMutation({
            variables: { circleId: discussionCircleId, envelopeId: msg.envelopeId },
        })
                .then((result) => {
                    const payload = result.data?.highlightMessage;
                    if (!payload) return;
                    setHighlights((prev) => ({ ...prev, [msgId]: payload.highlightCount }));
                    setHighlighted((prev) => new Set(prev).add(msgId));
                    setLocalMessages((prev) =>
                        prev.map((item) =>
                            item.id === msgId
                                ? {
                                    ...item,
                                    isFeatured: payload.isFeatured,
                                    featureReason: payload.isFeatured
                                        ? 'member_highlight'
                                        : item.featureReason,
                                }
                                : item,
                        ),
                    );
                })
                .catch(() => {
                    setHighlights((prev) => ({ ...prev, [msgId]: previousCount }));
                    setHighlighted((prev) => {
                        const next = new Set(prev);
                        next.delete(msgId);
                        return next;
                    });
                    setLocalMessages((prev) =>
                        prev.map((item) =>
                            item.id === msgId
                                ? {
                                    ...item,
                                    isFeatured: Boolean(msg.isFeatured),
                                    featureReason: msg.featureReason || null,
                                }
                                : item,
                        ),
                    );
                });
    }, [discussionCircleId, highlightMutation, highlighted, highlights, localMessages, walletPubkey]);

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
        if (!walletPubkey) {
            setDiscussionError(t('errors.walletRequired'));
            return;
        }
        setShowComposerIdentityHint(false);

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

        const optimisticId = Date.now();
        const fallbackAuthor = walletPubkey
            ? `${walletPubkey.slice(0, 4)}...${walletPubkey.slice(-4)}`
            : 'me.sol';
        const optimisticMsg: PlazaMessage = {
            id: optimisticId,
            author: fallbackAuthor,
            text: outgoingText,
            time: t('time.justNow'),
            ephemeral: !viewerJoined,
            highlights: 0,
            sendState: 'pending',
            senderPubkey: walletPubkey || undefined,
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
        setHighlights((prev) => ({ ...prev, [optimisticId]: 0 }));
        setChatInput('');
        setShowPanel(false);
        setShowEmojiGrid(false);
        setReplyTarget(null);
        setDiscussionError(null);
        if (textareaRef.current) {
            textareaRef.current.style.height = 'auto';
        }

        if (!walletPubkey) {
            setLocalMessages((prev) =>
                prev.map((msg) =>
                    msg.id === optimisticId
                        ? {
                            ...msg,
                            sendState: 'failed',
                            errorHint: t('errors.walletRequired'),
                        }
                        : msg,
                ),
            );
            return;
        }

        try {
            const response = await runWithDiscussionSessionRecovery({
                useSessionTokenAuth,
                getToken: ensureDiscussionSessionToken,
                resetSession: resetDiscussionSession,
                run: (discussionAccessToken) => sendDiscussionMessage({
                    circleId: discussionCircleId,
                    senderPubkey: walletPubkey,
                    senderHandle: fallbackAuthor,
                    text: outgoingText,
                    metadata: structuredMetadata,
                    prevEnvelopeId: lastEnvelopeId,
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
        resetDiscussionSession,
        shouldSignEachMessage,
        signMessage,
        useSessionTokenAuth,
        viewerJoined,
        walletPubkey,
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
        });
        setActionSheetMsgId(null);
        setShowPanel(false);
        setShowEmojiGrid(false);
        requestAnimationFrame(() => {
            textareaRef.current?.focus();
        });
    }, [localMessages]);

    const handleOpenForwardPicker = useCallback(() => {
        if (actionSheetMsgId === null || !forwardAction.enabled) {
            setActionSheetMsgId(null);
            return;
        }
        setForwardingMessageId(actionSheetMsgId);
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
            const message = error instanceof Error ? error.message : t('errors.forwardFailed');
            setDiscussionError(message);
        } finally {
            setShowForwardPicker(false);
            setForwardingMessageId(null);
        }
    }, [forwardingMessageId, localMessages]);

    const handleOpenForwardSource = useCallback((message: PlazaMessage) => {
        const sourceCircleId = message.forwardCard?.sourceCircleId;
        const sourceEnvelopeId = message.forwardCard?.sourceEnvelopeId;
        if (!sourceCircleId || !sourceEnvelopeId || message.forwardCard?.sourceDeleted) return;
        router.push(buildCircleTabHref(sourceCircleId, 'plaza', sourceEnvelopeId));
    }, [router]);

    const handleMessageTap = useCallback((msgId: number) => {
        setActionSheetMsgId(msgId);
    }, []);

    const handleMessageLongPress = useCallback((msgId: number) => {
        setActionSheetMsgId(msgId);
    }, []);

    const shouldSkipRowGesture = useCallback((target: EventTarget | null): boolean => {
        const el = target as HTMLElement | null;
        if (!el) return false;
        return Boolean(
            el.closest('[data-msg-overlay="1"]')
            || el.closest('[data-msg-avatar="1"]')
            || el.closest('[data-msg-action="1"]'),
        );
    }, []);

    /* ── Per-message gesture handlers (long-press detection) ── */
    const startMsgGesture = useCallback((msgId: number, clientX: number, clientY: number) => {
        longPressFired.current.delete(msgId);
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
        const dx = Math.abs(clientX - start.x);
        const dy = Math.abs(clientY - start.y);
        if (dx > 10 || dy > 10) {
            const timer = longPressTimers.current.get(msgId);
            if (timer) { clearTimeout(timer); longPressTimers.current.delete(msgId); }
        }
    }, []);

    const endMsgGesture = useCallback((msgId: number) => {
        const timer = longPressTimers.current.get(msgId);
        if (timer) { clearTimeout(timer); longPressTimers.current.delete(msgId); }
        if (!longPressFired.current.has(msgId)) {
            handleMessageTap(msgId);
        }
        longPressFired.current.delete(msgId);
        touchStartPos.current.delete(msgId);
    }, [handleMessageTap]);

    const cancelMsgGesture = useCallback((msgId: number) => {
        const timer = longPressTimers.current.get(msgId);
        if (timer) { clearTimeout(timer); longPressTimers.current.delete(msgId); }
        longPressFired.current.delete(msgId);
        touchStartPos.current.delete(msgId);
    }, []);

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

        if (!target.envelopeId || !walletPubkey) {
            setLocalMessages((prev) =>
                prev.map((m) =>
                    m.id === msgId
                        ? {
                            ...m,
                            sendState: 'sent',
                            errorHint: walletPubkey ? undefined : t('status.localDeleteOnly'),
                        }
                        : m,
                ),
            );
            return;
        }

        const senderPubkey = walletPubkey;
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
        walletPubkey,
    ]);

    const handleCandidateCreateDraft = useCallback(async (notice: DraftCandidateInlineNotice) => {
        if (creatingCandidateDraftId) return;
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
                void onDraftsChanged?.();
                onOpenCrucible?.(response.result.draftPostId);
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
        onDraftsChanged,
        onOpenCrucible,
        t,
    ]);

    const handleCreateDraftFromDiscussion = useCallback(async () => {
        if (creatingDiscussionDraft) return;
        if (manualDraftSourceMessageIds.length === 0) {
            setDiscussionStatus(t('manualDraft.noSources'));
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
                setDiscussionStatus(
                    response.result.status === 'created'
                        ? t('manualDraft.succeeded')
                        : t('manualDraft.existing'),
                );
                void onDraftsChanged?.();
                onOpenCrucible?.(response.result.draftPostId);
            }
        } catch (error) {
            const code = typeof (error as { code?: unknown })?.code === 'string'
                ? (error as { code: string }).code
                : '';
            if (code === 'candidate_generation_forbidden') {
                setDiscussionStatus(t('manualDraft.denied'));
            } else if (code === 'draft_candidate_missing_sources' || code === 'invalid_source_message_ids') {
                setDiscussionStatus(t('manualDraft.noSources'));
            } else {
                setDiscussionError(error instanceof Error ? error.message : t('manualDraft.failedGeneric'));
            }
        } finally {
            setCreatingDiscussionDraft(false);
        }
    }, [
        creatingDiscussionDraft,
        discussionCircleId,
        manualDraftSourceMessageIds,
        onDraftsChanged,
        onOpenCrucible,
        t,
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

    const handleCandidateCancel = useCallback((notice: DraftCandidateInlineNotice) => {
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
        const proposalHint = notice.lastProposalId
            ? t('candidate.relatedProposal', { proposalId: notice.lastProposalId })
            : '';
        setDiscussionStatus(t('candidate.cancelAvailable', {
            candidateId: notice.candidateId.slice(0, 8),
            proposalHint,
        }));
    }, [t, viewerIdentity]);

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
    const voicePrimaryLabel = !walletPubkey
        ? t('voice.walletRequired')
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
        || !walletPubkey
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

    return (
        <div className={styles.plazaChat}>
            <div className={styles.discussionControls}>
                <div className={styles.discussionFilterSummaryRow}>
                    <button
                        type="button"
                        className={styles.discussionFilterToggle}
                        aria-expanded={showFilterPanel}
                        onClick={() => setShowFilterPanel((prev) => !prev)}
                    >
                        {t('filters.title')}
                        <ChevronDown
                            size={14}
                            className={`${styles.discussionFilterChevron} ${showFilterPanel ? styles.discussionFilterChevronExpanded : ''}`}
                        />
                    </button>
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
            </div>
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
                        {visibleMessages.map((msg, i) => {
                            const isMine = !!walletPubkey && msg.senderPubkey === walletPubkey;
                            const isDimmed = msg.relevanceStatus === 'ready'
                                && msg.focusLabel === 'off_topic'
                                && !revealedDimmed.has(msg.id);
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
                            const candidateNoticeForRender = candidateNotice
                                ? {
                                    ...candidateNotice,
                                    state: isLocallyPendingCandidate ? 'pending' as const : candidateNotice.state,
                                    canRetry: isLocallyPendingCandidate
                                        ? false
                                        : candidateRecovery?.canRetry ?? candidateNotice.canRetry,
                                    canCancel: isLocallyPendingCandidate
                                        ? false
                                        : candidateRecovery?.canCancel ?? candidateNotice.canCancel,
                                }
                                : null;
                            const acceptedHandoff = toAcceptedCandidateHandoffContext(candidateNoticeForRender);

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
                                                        void onDraftsChanged?.();
                                                        onOpenCrucible?.(targetPostId);
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
                                                    onCancel={(notice) => {
                                                        handleCandidateCancel(notice);
                                                    }}
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
                                    className={`${styles.msgRow} ${isMine ? styles.msgRowMine : ''} ${isDimmed ? styles.msgRowDimmed : ''} ${msg.envelopeId && msg.envelopeId === focusedEnvelopeId ? styles.msgRowFocused : ''}`}
                                    data-envelope-id={msg.envelopeId || undefined}
                                    onMouseDown={(e) => {
                                        if (shouldSkipRowGesture(e.target)) return;
                                        startMsgGesture(msg.id, e.clientX, e.clientY);
                                    }}
                                    onMouseMove={(e) => {
                                        if (shouldSkipRowGesture(e.target)) return;
                                        moveMsgGesture(msg.id, e.clientX, e.clientY);
                                    }}
                                    onMouseUp={(e) => {
                                        if (shouldSkipRowGesture(e.target)) return;
                                        endMsgGesture(msg.id);
                                    }}
                                    onMouseLeave={(e) => {
                                        if (shouldSkipRowGesture(e.target)) return;
                                        cancelMsgGesture(msg.id);
                                    }}
                                    onTouchStart={(e) => {
                                        if (shouldSkipRowGesture(e.target)) return;
                                        const t = e.touches[0];
                                        startMsgGesture(msg.id, t.clientX, t.clientY);
                                    }}
                                    onTouchMove={(e) => {
                                        if (shouldSkipRowGesture(e.target)) return;
                                        const t = e.touches[0];
                                        moveMsgGesture(msg.id, t.clientX, t.clientY);
                                    }}
                                    onTouchEnd={(e) => {
                                        if (shouldSkipRowGesture(e.target)) return;
                                        endMsgGesture(msg.id);
                                    }}
                                    onTouchCancel={(e) => {
                                        if (shouldSkipRowGesture(e.target)) return;
                                        cancelMsgGesture(msg.id);
                                    }}
                                >
                                    <div
                                        data-msg-avatar="1"
                                        className={`${styles.msgAvatar} ${isMine ? styles.msgAvatarMine : ''} ${msg.ephemeral ? styles.msgAvatarVisitor : ''}`}
                                        onClick={(e) => {
                                            e.stopPropagation();
                                            onAvatarTap?.(msg.author);
                                        }}
                                        style={{ cursor: 'pointer' }}
                                    >
                                        {getInitials(msg.author)}
                                    </div>

                                    {/* Bubble */}
                                    <div className={styles.msgBubbleWrap}>
                                        <div className={styles.msgAuthorRow}>
                                            {!isMine && (
                                                <>
                                                    <span className={styles.msgAuthor}>@{msg.author}</span>
                                                    <IdentityBadge state={resolveIdentity(msg.author)} compact />
                                                </>
                                            )}
                                            <span className={styles.msgTime}>{msg.time}</span>
                                            {!msg.ephemeral && msg.isFeatured && (
                                                <HighlightButton
                                                    count={highlights[msg.id] || 0}
                                                    isHighlighted={true}
                                                    threshold={1}
                                                />
                                            )}
                                        </div>
                                        <div className={`${styles.msgBubble} ${msg.ephemeral ? styles.msgBubbleEphemeral : ''}`}>
                                            {msg.forwardCard ? (
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
                                    </div>
                                </motion.div>
                            );
                        })}
                        <div ref={messagesEndRef} />
                    </>
                )}
            </motion.div>

            {/* ── Tap Action Sheet (bottom sheet) ── */}
            <MessageActionSheet
                open={actionSheetMsgId !== null}
                messageId={actionSheetMsgId}
                isMine={!!actionSheetMessage && !!walletPubkey && actionSheetMessage.senderPubkey === walletPubkey}
                onReply={() => {
                    if (actionSheetMsgId === null) return;
                    handleReply(actionSheetMsgId);
                }}
                onHighlight={canHighlightActionSheetMessage ? (() => {
                    if (actionSheetMsgId === null) return;
                    handleHighlight(actionSheetMsgId);
                    setActionSheetMsgId(null);
                }) : undefined}
                onForward={forwardAction.enabled ? handleOpenForwardPicker : undefined}
                forwardDisabledReason={forwardAction.reasonKey ? t(`forward.reason.${forwardAction.reasonKey}`) : null}
                forwardLabel={t(forwardAction.labelKey)}
                onCopy={() => { if (actionSheetMsgId !== null) handleCopy(actionSheetMsgId); }}
                onDelete={() => { if (actionSheetMsgId !== null) handleDelete(actionSheetMsgId); }}
                onClose={() => setActionSheetMsgId(null)}
            />
            <CirclePicker
                open={showForwardPicker}
                circles={eligibleForwardTargets}
                userCrystals={userCrystals}
                selectedCount={forwardingMessageId === null ? 0 : 1}
                onSelect={(circle) => void handleForwardSelect(circle)}
                onClose={() => {
                    setShowForwardPicker(false);
                    setForwardingMessageId(null);
                }}
            />

            {/* ── WeChat-Style Composer ── */}
            <div className={styles.composerWrap}>
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
                                disabled={!walletPubkey}
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
                {/* Input Row: textarea + action button */}
                <div className={styles.composerRow}>
                    <textarea
                        ref={textareaRef}
                        className={styles.composerTextarea}
                        placeholder={
                            walletPubkey
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
                        disabled={!walletPubkey}
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
                            disabled={!walletPubkey}
                            aria-label={t('composer.sendAria')}
                        >
                            <SendHorizonal size={18} />
                        </button>
                    ) : (
                        <button
                            className={`${styles.composerPlusBtn} ${showPanel ? styles.composerPlusBtnActive : ''}`}
                            onClick={() => setShowPanel((v) => !v)}
                            type="button"
                            disabled={!walletPubkey}
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
                                    disabled={!DISCUSSION_ATTACHMENTS_ENABLED}
                                    aria-label={t('composer.actions.attachmentsUnavailable')}
                                    title={t('composer.actions.attachmentsUnavailable')}
                                >
                                    <Paperclip size={22} />
                                    <span>{t('composer.actions.attachments')}</span>
                                </button>
                                <button
                                    className={styles.composerOpBtn}
                                    type="button"
                                    onClick={() => {
                                        setChatInput((prev) => prev + '@');
                                        setShowPanel(false);
                                        textareaRef.current?.focus();
                                    }}
                                >
                                    <AtSign size={22} />
                                    <span>{t('composer.actions.mention')}</span>
                                </button>
                                <button
                                    className={styles.composerOpBtn}
                                    type="button"
                                    onClick={handleCreateDraftFromDiscussion}
                                    disabled={!walletPubkey || creatingDiscussionDraft || manualDraftSourceMessageIds.length === 0}
                                    title={manualDraftSourceMessageIds.length === 0 ? t('manualDraft.noSources') : undefined}
                                >
                                    <FileEdit size={22} />
                                    <span>{creatingDiscussionDraft ? t('composer.actions.draftBusy') : t('composer.actions.createDraft')}</span>
                                </button>
                            </div>
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
                                                disabled={!walletPubkey}
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

export default PlazaTab;
