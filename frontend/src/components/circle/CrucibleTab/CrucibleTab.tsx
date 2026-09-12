'use client';

import { useState, useCallback, useEffect, useRef, useMemo } from 'react';
import { useMutation, useQuery } from '@apollo/client/react';
import { motion, AnimatePresence } from 'framer-motion';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { Pencil, Plus } from 'lucide-react';
import { useCurrentLocale, useI18n } from '@/i18n/useI18n';

import { BottomSheet, ConfirmationSheet } from '@/components/alcheme';
import CrucibleEditor from '@/components/circle/CrucibleEditor';
import ReferencesPanel from '@/components/circle/ReferencesPanel/ReferencesPanel';
import SourceMaterialsPanel from '@/components/circle/SourceMaterialsPanel/SourceMaterialsPanel';
import { SourceGroundedAskPanel } from '@/features/ai-evidence-answer';
import { NeutralEvaluationWorkspacePanel } from '@/features/ai-evaluation';
import CrucibleLifecycleHeader from '@/components/circle/CrucibleTab/CrucibleLifecycleHeader';
import DraftDiscussionPanel from '@/components/circle/DraftDiscussionPanel/DraftDiscussionPanel';
import {
    advanceDraftLifecycleReview as advanceDraftLifecycleReviewRequest,
    archiveDraftLifecycle as archiveDraftLifecycleRequest,
    DraftLifecycleRequestError,
    enterDraftLifecycleCrystallization as enterDraftLifecycleCrystallizationRequest,
    enterDraftLifecycleReview as enterDraftLifecycleReviewRequest,
    fetchDraftLifecycle,
    restoreDraftLifecycle as restoreDraftLifecycleRequest,
    retryDraftLifecycleCrystallization as retryDraftLifecycleCrystallizationRequest,
    rollbackDraftLifecycleCrystallization as rollbackDraftLifecycleCrystallizationRequest,
    type DraftLifecycleReadModel,
} from '@/lib/api/draftWorkingCopy';
import { useCollaboration, type DraftSavedSignal } from '@/lib/collaboration';
import {
    useAcceptedIssueRevisionAssist,
    type AcceptedIssueRevisionAppliedPayload,
    type AcceptedIssueRevisionSuggestionView,
} from '@/hooks/useAcceptedIssueRevisionAssist';
import { useCrystallizeDraft, type ContributionAssessmentGateDecision } from '@/hooks/useCrystallizeDraft';
import { useAlchemeSDK } from '@/hooks/useAlchemeSDK';
import DraftCard from '@/components/circle/DraftCard';
import { ADD_DRAFT_COMMENT, GET_DRAFT_COMMENTS } from '@/lib/apollo/queries';
import type { AddDraftCommentResponse, DraftCommentsResponse } from '@/lib/apollo/types';
import { timeAgo } from '@/lib/circle/utils';
import {
    deriveDraftPermissions,
    deriveDraftWorkflowPermissions,
    type DraftPermissionMembership,
} from '@/lib/circle/draftPermissions';
import {
    buildCrucibleAcceptedIssueExceptions,
    buildCrucibleAcceptedIssuesByParagraph,
    buildCrucibleGovernanceSummary,
    buildCrucibleParagraphBlocks,
    removeCrucibleParagraphContent,
} from '@/lib/circle/crucibleViewModel';
import { deriveDraftIssueCreateCapability } from '@/lib/circle/draftReviewIssueCapability';
import {
    applyDraftDiscussion,
    appendDraftDiscussionMessage,
    createDraftDiscussion,
    listDraftDiscussions,
    proposeDraftDiscussion,
    resolveDraftDiscussion,
    type DraftDiscussionIssueType,
    type DraftDiscussionResolution,
    type DraftDiscussionThreadRecord,
    type DraftDiscussionTargetType,
    type DraftContributionAssessmentResponse,
    withdrawDraftDiscussion,
} from '@/lib/api/discussion';
import {
    DEFAULT_CIRCLE_DRAFT_WORKFLOW_POLICY,
    type CircleDraftLifecycleTemplate,
    type CircleDraftWorkflowPolicy,
    type GovernanceRole,
} from '@/lib/api/circlesPolicyProfile';
import {
    fetchSeededFileTree,
    type SeededFileTreeNode,
    type SeededReferenceSelection,
} from '@/lib/api/circlesSeeded';
import {
    captureExternalUrlSourceMaterial,
    fetchSourceMaterialContent,
    fetchSourceMaterials,
    uploadSourceMaterial,
    type SourceMaterialRecord,
} from '@/lib/api/circlesSourceMaterials';
import {
    fetchDraftReferenceLinks,
    type DraftReferenceLink,
} from '@/lib/api/draftReferenceLinks';
import {
    fetchDiscussionDraftContent,
    fetchRevisionDirectionsForDraft,
    fetchTemporaryEditGrantsForDraft,
    issueTemporaryEditGrant as issueTemporaryEditGrantRequest,
    requestTemporaryEditGrantForDraft,
    revokeTemporaryEditGrant as revokeTemporaryEditGrantRequest,
    saveDiscussionDraftContent,
    updateDiscussionDraftTitle,
    type DraftScopedPermissionState,
    type SaveDraftContentOptions,
    type RevisionDirectionProposalView,
    type TemporaryEditGrantView,
} from '@/lib/api/draftRuntime';
import { deriveDraftReferenceSurface } from '@/lib/circle/draftReferenceSurface';
import type { KnowledgeReferenceOption } from '@/lib/circle/knowledgeReferenceOptions';
import {
    prioritizeWorkspaceDrafts,
    type WorkspaceDraftLifecycleStatus,
} from '@/lib/circle/workspaceDraftOrder';
import styles from '@/app/(main)/circles/[id]/page.module.css';

interface CrucibleDraft {
    id: number;
    title: string;
    heat: number;
    editors: number;
    comments: number;
    documentStatus?: WorkspaceDraftLifecycleStatus;
    publicBlockerCode?: string | null;
    lastActivityAt?: string | null;
}

interface GhostDraftReplaceRequest {
    token: number;
    content: string;
}

interface KnowledgeReferenceInsertRequest {
    token: number;
    option: KnowledgeReferenceOption;
}

interface ParagraphIssueEditRequest {
    token: number;
    paragraphIndex: number;
    issueThreadId: string;
}

interface CrucibleViewerCollaborationIdentity {
    userId?: number | null;
    pubkey?: string | null;
    displayName?: string | null;
    handle?: string | null;
}

interface DraftRemoteUpdateConflict {
    workingCopyHash: string | null;
    updatedAt?: string | null;
    source: 'remote_signal' | 'polling' | 'save_conflict';
}

interface ConfirmationRequest {
    id: number;
    title: string;
    description: string;
    confirmLabel: string;
    cancelLabel: string;
    closeLabel: string;
    tone?: 'default' | 'danger';
}

function normalizeAppendParagraphText(value: string): string {
    return value.replace(/\s*[\r\n]+\s*/g, ' ');
}

function shortenPubkey(value: string | null | undefined): string | null {
    const pubkey = String(value || '').trim();
    if (!pubkey) return null;
    return pubkey.length > 8 ? `${pubkey.slice(0, 4)}...${pubkey.slice(-4)}` : pubkey;
}

function resolveDraftSavedSignalKey(signal: DraftSavedSignal): string {
    return signal.nonce || `${signal.draftId}:${signal.actorId}:${signal.workingCopyHash}:${signal.at}`;
}

function getDraftRequestErrorMetadata(error: unknown): {
    code: string | null;
    workingCopyHash: string | null;
} {
    const value = error as { code?: unknown; workingCopyHash?: unknown } | null;
    return {
        code: typeof value?.code === 'string' ? value.code : null,
        workingCopyHash: typeof value?.workingCopyHash === 'string' ? value.workingCopyHash : null,
    };
}

const DRAFT_SAVE_REFRESH_ERROR_CODES = new Set([
    'draft_working_copy_conflict',
    'draft_paragraph_scope_exceeded',
    'draft_paragraph_count_changed',
    'invalid_draft_paragraph_scope',
]);

function canPreserveLocalDraftWork(status: WorkspaceDraftLifecycleStatus): boolean {
    return !status || status === 'drafting';
}

function parseLineRefToParagraphIndex(lineRef: string | null | undefined, fallback: number | null = 0): number | null {
    if (!lineRef) return fallback;
    const matched = lineRef.trim().match(/^paragraph:(\d+)$/i);
    if (matched) {
        const parsed = Number.parseInt(matched[1], 10);
        if (Number.isFinite(parsed) && parsed >= 0) return parsed;
    }

    const numeric = Number.parseInt(lineRef, 10);
    if (Number.isFinite(numeric) && numeric >= 0) return numeric;
    return fallback;
}

function extractParagraphOptions(content: string): Array<{ index: number; preview: string }> {
    const blocks = String(content || '')
        .split(/\n+/)
        .map((item) => item.replace(/\s+/g, ' ').trim())
        .filter(Boolean);
    return blocks.map((block, index) => ({
        index,
        preview: block.length > 48 ? `${block.slice(0, 48)}…` : block,
    }));
}

function resolveViewerCollaborationIdentity(
    viewer: CrucibleViewerCollaborationIdentity | null | undefined,
    circleMembers: NonNullable<CrucibleTabProps['circleMembers']>,
    fallbackName: string,
) {
    const pubkey = String(viewer?.pubkey || '').trim();
    const member = pubkey
        ? circleMembers.find((item) => item.user?.pubkey === pubkey)
        : null;
    const displayName = String(
        member?.effectiveDisplayName
        || member?.circleAlias
        || member?.globalDisplayName
        || member?.user?.displayName
        || viewer?.displayName
        || member?.globalHandle
        || member?.user?.handle
        || viewer?.handle
        || shortenPubkey(pubkey)
        || fallbackName,
    ).trim();
    const id = Number.isFinite(viewer?.userId)
        ? `user:${viewer?.userId}`
        : pubkey
            ? `pubkey:${pubkey}`
            : 'viewer:anonymous';
    return {
        id,
        name: displayName || fallbackName,
    };
}

/* ═══ Crucible ═══ */
interface CrucibleTabProps {
    drafts: CrucibleDraft[];
    circleId: number;
    circleMembers?: Array<{
        circleAlias?: string | null;
        effectiveDisplayName?: string | null;
        globalHandle?: string | null;
        globalDisplayName?: string | null;
        user?: {
            id?: number | null;
            pubkey?: string | null;
            handle?: string | null;
            displayName?: string | null;
        } | null;
    }>;
    genesisMode?: 'BLANK' | 'SEEDED';
    knowledgeReferenceOptions?: KnowledgeReferenceOption[];
    draftLifecycleTemplate?: CircleDraftLifecycleTemplate | null;
    draftWorkflowPolicy?: CircleDraftWorkflowPolicy | null;
    viewerMembership?: DraftPermissionMembership | null;
    viewerCollaborationIdentity?: CrucibleViewerCollaborationIdentity | null;
    requestedDraftId?: number | null;
    requestedBoundDraftId?: number | null;
    requestedDraftVersion?: number | null;
    onRequestedDraftHandled?: () => void;
    onDraftLifecycleChanged?: () => Promise<void> | void;
    onCrystallizationComplete?: () => Promise<void> | void;
    ensureDiscussionSessionToken?: () => Promise<string | null>;
}

function CrucibleTab({
    drafts,
    circleId,
    circleMembers = [],
    genesisMode = 'BLANK',
    knowledgeReferenceOptions = [],
    draftLifecycleTemplate = null,
    draftWorkflowPolicy = null,
    viewerMembership = null,
    viewerCollaborationIdentity = null,
    requestedDraftId = null,
    requestedBoundDraftId = null,
    requestedDraftVersion = null,
    onRequestedDraftHandled,
    onDraftLifecycleChanged,
    onCrystallizationComplete,
    ensureDiscussionSessionToken,
}: CrucibleTabProps) {
    const t = useI18n('CrucibleTab');
    const discussionT = useI18n('DraftDiscussionPanel');
    const editorT = useI18n('CrucibleEditor');
    const lifecycleT = useI18n('CrucibleLifecycleHeader');
    const locale = useCurrentLocale();
    const draftSourceAskScopeLabels = useMemo(() => ({
        current_draft: t('sourceAsk.scopes.current_draft'),
        formal_references: t('sourceAsk.scopes.formal_references'),
        source_materials: t('sourceAsk.scopes.source_materials'),
    }), [t]);
    const router = useRouter();
    const [selectedDraft, setSelectedDraft] = useState<string | null>(null);
    const [displayHeat, setDisplayHeat] = useState<number>(Math.max(0, drafts[0]?.heat ?? 40));
    const autosaveTimerRef = useRef<number | null>(null);
    const autosaveTextRef = useRef('');
    const hasUnsavedDraftRef = useRef(false);
    const draftContentLoadRequestRef = useRef(0);
    const loadedDraftContentPostIdRef = useRef<number | null>(null);
    const pendingDraftEditScopeRef = useRef<SaveDraftContentOptions['editScope'] | null>(null);
    const noticeTimerRef = useRef<number | null>(null);
    const confirmationRequestIdRef = useRef(0);
    const confirmationResolveRef = useRef<((confirmed: boolean) => void) | null>(null);
    const contributionGateResolveRef = useRef<((decision: ContributionAssessmentGateDecision) => void) | null>(null);
    const [notice, setNotice] = useState<{ type: 'success' | 'error'; text: string } | null>(null);
    const [confirmationRequest, setConfirmationRequest] = useState<ConfirmationRequest | null>(null);
    const [contributionGatePrompt, setContributionGatePrompt] = useState<DraftContributionAssessmentResponse | null>(null);
    const [selectedDraftContent, setSelectedDraftContent] = useState('');
    const [selectedDraftTitle, setSelectedDraftTitle] = useState('');
    const [draftTitleInput, setDraftTitleInput] = useState('');
    const [draftTitleBusy, setDraftTitleBusy] = useState(false);
    const [draftTitleEditing, setDraftTitleEditing] = useState(false);
    const [documentEditorOpen, setDocumentEditorOpen] = useState(false);
    const [documentEditorText, setDocumentEditorText] = useState('');
    const [documentEditorBusy, setDocumentEditorBusy] = useState(false);
    const [appendParagraphText, setAppendParagraphText] = useState('');
    const [appendParagraphBusy, setAppendParagraphBusy] = useState(false);
    const [appendParagraphOpen, setAppendParagraphOpen] = useState(false);
    const [selectedDraftContentReady, setSelectedDraftContentReady] = useState(false);
    const [selectedDraftWorkingCopyHash, setSelectedDraftWorkingCopyHash] = useState<string | null>(null);
    const selectedDraftContentRef = useRef('');
    const selectedDraftWorkingCopyHashRef = useRef<string | null>(null);
    const draftTitleEditingRef = useRef(false);
    const [draftParagraphDeleteBlockedBy, setDraftParagraphDeleteBlockedBy] = useState<string[]>([]);
    const [draftDocumentEditAllowed, setDraftDocumentEditAllowed] = useState(false);
    const [draftScopedPermissions, setDraftScopedPermissions] = useState<DraftScopedPermissionState | null>(null);
    const [draftRemoteUpdateConflict, setDraftRemoteUpdateConflict] = useState<DraftRemoteUpdateConflict | null>(null);
    const [discussionThreads, setDiscussionThreads] = useState<DraftDiscussionThreadRecord[]>([]);
    const [ghostDraftDefaultIssueCarrySelections, setGhostDraftDefaultIssueCarrySelections] = useState<Record<number, string[]>>({});
    const [discussionViewerUserId, setDiscussionViewerUserId] = useState<number | null>(null);
    const [discussionLoading, setDiscussionLoading] = useState(false);
    const [discussionBusy, setDiscussionBusy] = useState(false);
    const [discussionError, setDiscussionError] = useState<string | null>(null);
    const [selectedParagraphIndex, setSelectedParagraphIndex] = useState<number | null>(null);
    const [acceptedIssueRevisionParagraphIndex, setAcceptedIssueRevisionParagraphIndex] = useState<number | null>(null);
    const [paragraphIssueEditRequest, setParagraphIssueEditRequest] = useState<ParagraphIssueEditRequest | null>(null);
    const [draftLifecycle, setDraftLifecycle] = useState<DraftLifecycleReadModel | null>(null);
    const [draftLifecycleLoading, setDraftLifecycleLoading] = useState(false);
    const [draftLifecycleError, setDraftLifecycleError] = useState<string | null>(null);
    const [draftLifecycleTransitionBusy, setDraftLifecycleTransitionBusy] = useState(false);
    const [temporaryEditGrants, setTemporaryEditGrants] = useState<TemporaryEditGrantView[]>([]);
    const [temporaryEditGrantBusy, setTemporaryEditGrantBusy] = useState(false);
    const [temporaryEditGrantError, setTemporaryEditGrantError] = useState<string | null>(null);
    const [revisionDirectionsReadback, setRevisionDirectionsReadback] = useState<{
        draftPostId: number | null;
        draftVersion: number | null;
        proposals: RevisionDirectionProposalView[];
        error: string | null;
    } | null>(null);
    const revisionDirectionsRequestRef = useRef(0);
    const [seededFileTree, setSeededFileTree] = useState<SeededFileTreeNode[]>([]);
    const [seededFileTreeLoading, setSeededFileTreeLoading] = useState(false);
    const [seededFileTreeError, setSeededFileTreeError] = useState<string | null>(null);
    const [selectedSeededReference, setSelectedSeededReference] = useState<SeededReferenceSelection | null>(null);
    const [draftReferenceLinks, setDraftReferenceLinks] = useState<DraftReferenceLink[]>([]);
    const [draftReferenceLinksLoading, setDraftReferenceLinksLoading] = useState(false);
    const [draftReferenceLinksError, setDraftReferenceLinksError] = useState<string | null>(null);
    const [sourceMaterials, setSourceMaterials] = useState<SourceMaterialRecord[]>([]);
    const [sourceMaterialsLoading, setSourceMaterialsLoading] = useState(false);
    const [sourceMaterialsUploading, setSourceMaterialsUploading] = useState(false);
    const [sourceMaterialsError, setSourceMaterialsError] = useState<string | null>(null);
    const [ghostDraftReplaceRequest, setGhostDraftReplaceRequest] = useState<GhostDraftReplaceRequest | null>(null);
    const [insertReferenceRequest, setInsertReferenceRequest] = useState<KnowledgeReferenceInsertRequest | null>(null);
    const draftLifecycleRequestRef = useRef(0);
    const draftLifecycleRef = useRef<DraftLifecycleReadModel | null>(null);
    const setDraftLifecycleSnapshot = useCallback((nextLifecycle: DraftLifecycleReadModel | null) => {
        draftLifecycleRef.current = nextLifecycle;
        setDraftLifecycle(nextLifecycle);
    }, []);
    const clearNoticeTimer = useCallback(() => {
        if (noticeTimerRef.current !== null) {
            window.clearTimeout(noticeTimerRef.current);
            noticeTimerRef.current = null;
        }
    }, []);
    const showNotice = useCallback((type: 'success' | 'error', text: string) => {
        setNotice({ type, text });
        clearNoticeTimer();
        noticeTimerRef.current = window.setTimeout(() => {
            setNotice(null);
            noticeTimerRef.current = null;
        }, 4600);
    }, [clearNoticeTimer]);
    const refreshDraftSummaryAfterLifecycleChange = useCallback(async (): Promise<void> => {
        try {
            await onDraftLifecycleChanged?.();
        } catch (error) {
            console.warn('[CrucibleTab] refresh draft summary after lifecycle change failed', error);
        }
    }, [onDraftLifecycleChanged]);
    const sourceMaterialsRequestRef = useRef(0);
    const discussionSurfaceSyncRef = useRef<Promise<void> | null>(null);
    const editorPrimaryRef = useRef<HTMLElement | null>(null);
    const activeEditingBlockIdRef = useRef<string | null>(null);
    const handledRemoteSavedSignalRef = useRef<string | null>(null);
    const pendingReferenceLinksRefreshRef = useRef(false);
    const sdk = useAlchemeSDK();
    const handleInsertKnowledgeReference = useCallback((option: KnowledgeReferenceOption) => {
        if (selectedParagraphIndex === null) return;
        pendingReferenceLinksRefreshRef.current = true;
        setInsertReferenceRequest({
            token: Date.now(),
            option,
        });
    }, [selectedParagraphIndex]);
    const handleKnowledgeReferenceInserted = useCallback((_option: KnowledgeReferenceOption) => {
        pendingReferenceLinksRefreshRef.current = true;
        setInsertReferenceRequest(null);
    }, []);

    const collaborationViewer = useMemo(
        () => resolveViewerCollaborationIdentity(
            viewerCollaborationIdentity,
            circleMembers,
            t('fallback.unknownMember'),
        ),
        [
            circleMembers,
            t,
            viewerCollaborationIdentity?.displayName,
            viewerCollaborationIdentity?.handle,
            viewerCollaborationIdentity?.pubkey,
            viewerCollaborationIdentity?.userId,
        ],
    );

    // Yjs collaborative doc for the selected draft
    const {
        ydoc,
        isConnected,
        connectedUsers,
        activeEditorsByBlockId,
        latestRemoteSavedSignal,
        setEditingBlockId,
        announceDraftSaved,
    } = useCollaboration(selectedDraft || 'default', { viewer: collaborationViewer });

    const { canComment, canEdit } = useMemo(
        () => deriveDraftPermissions(viewerMembership),
        [viewerMembership],
    );
    const workflowRoleLabels = useMemo<Record<GovernanceRole, string>>(() => ({
        Owner: t('permissions.roles.owner'),
        Admin: t('permissions.roles.admin'),
        Moderator: t('permissions.roles.moderator'),
        Elder: t('permissions.roles.elder'),
        Member: t('permissions.roles.member'),
        Initiate: t('permissions.roles.initiate'),
    }), [t]);
    const workflowPermissions = useMemo(() => deriveDraftWorkflowPermissions({
        membership: viewerMembership,
        workflowPolicy: draftWorkflowPolicy,
    }, {
        inactiveReason: t('permissions.inactiveReason'),
        roleLabel: workflowRoleLabels,
        higherRoleLabel: t('permissions.roles.higher'),
        reasons: {
            createIssue: (role) => t('permissions.reasons.createIssue', { role }),
            followupIssue: (role) => t('permissions.reasons.followupIssue', { role }),
            withdrawOwnIssue: t('permissions.reasons.withdrawOwnIssue'),
            reviewIssue: (role) => t('permissions.reasons.reviewIssue', { role }),
            retagIssue: (role) => t('permissions.reasons.retagIssue', { role }),
            applyAcceptedIssue: (role) => t('permissions.reasons.applyAcceptedIssue', { role }),
            endDraftingEarly: (role) => t('permissions.reasons.endDraftingEarly', { role }),
            advanceFromReview: (role) => t('permissions.reasons.advanceFromReview', { role }),
            enterCrystallization: (role) => t('permissions.reasons.enterCrystallization', { role }),
            retagIssueDisabled: t('permissions.reasons.retagIssueDisabled'),
        },
    }), [draftWorkflowPolicy, t, viewerMembership, workflowRoleLabels]);
    const draftDiscussionPolicyLabels = useMemo(() => ({
        reviewerLabel: workflowRoleLabels[
            draftWorkflowPolicy?.reviewIssueMinRole
            ?? DEFAULT_CIRCLE_DRAFT_WORKFLOW_POLICY.reviewIssueMinRole
        ],
        applierLabel: workflowRoleLabels[
            draftWorkflowPolicy?.applyIssueMinRole
            ?? DEFAULT_CIRCLE_DRAFT_WORKFLOW_POLICY.applyIssueMinRole
        ],
        followupLabel: workflowRoleLabels[
            draftWorkflowPolicy?.followupIssueMinRole
            ?? DEFAULT_CIRCLE_DRAFT_WORKFLOW_POLICY.followupIssueMinRole
        ],
    }), [draftWorkflowPolicy, workflowRoleLabels]);
    const issueCapabilityCopy = useMemo(() => ({
        stageRequired: t('permissions.reasons.createIssueStageRequired'),
        reviewWindowExpired: t('permissions.reasons.createIssueReviewExpired'),
        stableSnapshotRequired: t('permissions.reasons.createIssueStableSnapshotRequired'),
    }), [t]);
    const createIssueCapability = useMemo(() => deriveDraftIssueCreateCapability({
        lifecycle: draftLifecycle,
        workflowPermission: workflowPermissions.createIssue,
    }, issueCapabilityCopy), [draftLifecycle, issueCapabilityCopy, workflowPermissions.createIssue]);
    const followupIssueCapability = useMemo(() => deriveDraftIssueCreateCapability({
        lifecycle: draftLifecycle,
        workflowPermission: workflowPermissions.followupIssue,
    }, issueCapabilityCopy), [draftLifecycle, issueCapabilityCopy, workflowPermissions.followupIssue]);
    const discussionCapabilities = useMemo(() => {
        return {
            canCreate: createIssueCapability.allowed,
            createDisabledReason: createIssueCapability.reason,
            canFollowup: followupIssueCapability.allowed,
            followupDisabledReason: followupIssueCapability.reason,
            canWithdraw: workflowPermissions.withdrawOwnIssue.allowed,
            withdrawDisabledReason: workflowPermissions.withdrawOwnIssue.reason,
            canStartReview: workflowPermissions.startReview.allowed,
            startReviewDisabledReason: workflowPermissions.startReview.reason,
            canRetag: workflowPermissions.retagIssue.allowed,
            retagDisabledReason: workflowPermissions.retagIssue.reason,
            canResolve: workflowPermissions.acceptRejectIssue.allowed,
            resolveDisabledReason: workflowPermissions.acceptRejectIssue.reason,
            canApply: workflowPermissions.applyAcceptedIssue.allowed,
            applyDisabledReason: workflowPermissions.applyAcceptedIssue.reason,
            canEndDraftingEarly: workflowPermissions.endDraftingEarly.allowed,
            endDraftingDisabledReason: workflowPermissions.endDraftingEarly.reason,
            canAdvanceFromReview: workflowPermissions.advanceFromReview.allowed,
            advanceFromReviewDisabledReason: workflowPermissions.advanceFromReview.reason,
            canCrystallize: workflowPermissions.enterCrystallization.allowed,
            crystallizeDisabledReason: workflowPermissions.enterCrystallization.reason,
        };
    }, [createIssueCapability, followupIssueCapability, workflowPermissions]);
    const selectedDraftPostId = selectedDraft ? Number.parseInt(selectedDraft, 10) : null;
    const selectedDraftSummary = selectedDraft
        ? drafts.find((draft) => String(draft.id) === selectedDraft)
        : null;
    useEffect(() => {
        setDocumentEditorOpen(false);
        setDocumentEditorText('');
        setAppendParagraphText('');
        setAppendParagraphOpen(false);
        setDraftTitleEditing(false);
    }, [selectedDraftPostId]);
    useEffect(() => {
        selectedDraftContentRef.current = selectedDraftContent;
    }, [selectedDraftContent]);
    useEffect(() => {
        selectedDraftWorkingCopyHashRef.current = selectedDraftWorkingCopyHash;
    }, [selectedDraftWorkingCopyHash]);
    useEffect(() => {
        draftTitleEditingRef.current = draftTitleEditing;
    }, [draftTitleEditing]);
    useEffect(() => {
        if (!documentEditorOpen) return undefined;
        activeEditingBlockIdRef.current = 'document';
        setEditingBlockId('document');
        return () => {
            if (activeEditingBlockIdRef.current === 'document') {
                activeEditingBlockIdRef.current = null;
                setEditingBlockId(null);
            }
        };
    }, [documentEditorOpen, setEditingBlockId]);
    const orderedDrafts = useMemo(
        () => prioritizeWorkspaceDrafts(drafts),
        [drafts],
    );
    const selectedDraftEditCount = Math.max(1, selectedDraftSummary?.editors ?? 1);
    const stableSnapshotVersion = draftLifecycle?.stableSnapshot.draftVersion || 1;
    const discussionCurrentDraftVersion = draftLifecycle?.stableSnapshot?.draftVersion ?? null;
    const paragraphOptions = useMemo(
        () => extractParagraphOptions(selectedDraftContent),
        [selectedDraftContent],
    );
    const handleContributionAssessmentGate = useCallback((assessment: DraftContributionAssessmentResponse) => {
        contributionGateResolveRef.current?.(null);
        return new Promise<ContributionAssessmentGateDecision>((resolve) => {
            contributionGateResolveRef.current = resolve;
            setContributionGatePrompt(assessment);
        });
    }, []);
    const {
        crystallizeDraft,
        loading: crystallizing,
        notice: crystallizeNotice,
        publicationLicense,
        publicationLicenseLoading,
        preparePublicationLicense,
        acceptPublicationLicense,
    } = useCrystallizeDraft({
        draftPostId: selectedDraftPostId,
        circleId,
        title: selectedDraftSummary?.title || '',
        content: selectedDraftContent,
        enabled: discussionCapabilities.canCrystallize,
        onContributionAssessmentGate: handleContributionAssessmentGate,
    });
    const currentPublicationLicense = publicationLicense?.authorization.draftPostId === selectedDraftPostId
        ? publicationLicense
        : null;

    useEffect(() => {
        if (
            draftLifecycle?.documentStatus !== 'crystallization_active'
            || !selectedDraftPostId
            || !selectedDraftContentReady
        ) return;
        void preparePublicationLicense({ content: selectedDraftContent });
    }, [
        draftLifecycle?.documentStatus,
        preparePublicationLicense,
        selectedDraftContent,
        selectedDraftContentReady,
        selectedDraftPostId,
    ]);

    const handleAcceptPublicationLicense = useCallback(async () => {
        await acceptPublicationLicense({ content: selectedDraftContent });
    }, [acceptPublicationLicense, selectedDraftContent]);
    const { data: draftCommentsData, refetch: refetchDraftComments } = useQuery<DraftCommentsResponse>(
        GET_DRAFT_COMMENTS,
        {
            variables: { postId: selectedDraftPostId || 0, limit: 200 },
            skip: !selectedDraftPostId || !Number.isFinite(selectedDraftPostId),
            fetchPolicy: 'cache-and-network',
        },
    );
    const [addDraftComment] = useMutation<AddDraftCommentResponse>(ADD_DRAFT_COMMENT);
    const refreshDraftCommentsSafely = useCallback(async (): Promise<void> => {
        if (!selectedDraftPostId || !Number.isFinite(selectedDraftPostId)) return;
        try {
            await refetchDraftComments({ postId: selectedDraftPostId, limit: 200 });
        } catch (error) {
            console.warn('refresh draft comments failed:', error);
        }
    }, [refetchDraftComments, selectedDraftPostId]);
    const loadTemporaryEditGrants = useCallback(async (): Promise<void> => {
        if (!selectedDraftPostId || !Number.isFinite(selectedDraftPostId)) {
            setTemporaryEditGrants([]);
            setTemporaryEditGrantError(null);
            return;
        }

        try {
            const grants = await fetchTemporaryEditGrantsForDraft(
                selectedDraftPostId,
                t('errors.loadTemporaryEditGrants'),
            );
            setTemporaryEditGrants(grants);
            setTemporaryEditGrantError(null);
        } catch (error) {
            const message = error instanceof Error ? error.message : t('errors.loadTemporaryEditGrants');
            setTemporaryEditGrantError(message);
        }
    }, [selectedDraftPostId, t]);

    useEffect(() => {
        void loadTemporaryEditGrants();
    }, [loadTemporaryEditGrants]);

    const loadRevisionDirections = useCallback(async (): Promise<void> => {
        const requestId = ++revisionDirectionsRequestRef.current;
        const draftVersion = draftLifecycle?.stableSnapshot.draftVersion ?? null;
        setRevisionDirectionsReadback(null);
        if (!selectedDraftPostId || !Number.isFinite(selectedDraftPostId)) {
            return;
        }
        try {
            const proposals = await fetchRevisionDirectionsForDraft(
                selectedDraftPostId,
                draftVersion,
            );
            if (requestId !== revisionDirectionsRequestRef.current) return;
            setRevisionDirectionsReadback({ draftPostId: selectedDraftPostId, draftVersion, proposals, error: null });
        } catch (error) {
            if (requestId !== revisionDirectionsRequestRef.current) return;
            setRevisionDirectionsReadback({
                draftPostId: selectedDraftPostId,
                draftVersion,
                proposals: [],
                error: error instanceof Error ? error.message : t('errors.loadRevisionDirections'),
            });
        }
    }, [draftLifecycle?.stableSnapshot.draftVersion, selectedDraftPostId, t]);

    useEffect(() => {
        void loadRevisionDirections();
        return () => { revisionDirectionsRequestRef.current += 1; };
    }, [loadRevisionDirections]);

    // Key the result to its Draft and snapshot even before the next effect runs.
    // An old successful read must not briefly make a newly selected Draft look unbound.
    const revisionDirectionsReady = revisionDirectionsReadback !== null
        && revisionDirectionsReadback.draftPostId === selectedDraftPostId
        && revisionDirectionsReadback.draftVersion === (draftLifecycle?.stableSnapshot.draftVersion ?? null);
    const revisionDirections = useMemo(
        () => revisionDirectionsReady ? revisionDirectionsReadback!.proposals : [],
        [revisionDirectionsReadback, revisionDirectionsReady],
    );
    const governedRoutingError = revisionDirectionsReady ? revisionDirectionsReadback!.error : null;
    const revisionDirectionsLoading = !revisionDirectionsReady;

    useEffect(() => {
        sourceMaterialsRequestRef.current += 1;
        setGhostDraftReplaceRequest(null);
        setAcceptedIssueRevisionParagraphIndex(null);
        setInsertReferenceRequest(null);
        setSelectedSeededReference(null);
        setSourceMaterials([]);
        setSourceMaterialsError(null);
        setSourceMaterialsLoading(false);
        setSourceMaterialsUploading(false);
        pendingReferenceLinksRefreshRef.current = false;
    }, [selectedDraft]);

    const loadDraftReferenceLinks = useCallback(async (): Promise<void> => {
        if (!selectedDraftPostId || !Number.isFinite(selectedDraftPostId)) {
            setDraftReferenceLinks([]);
            setDraftReferenceLinksLoading(false);
            setDraftReferenceLinksError(null);
            return;
        }

        setDraftReferenceLinksLoading(true);
        try {
            const links = await fetchDraftReferenceLinks({
                draftPostId: selectedDraftPostId,
            });
            setDraftReferenceLinks(links);
            setDraftReferenceLinksError(null);
        } catch (error) {
            setDraftReferenceLinks([]);
            setDraftReferenceLinksError(error instanceof Error ? error.message : t('errors.fetchDraftReferenceLinks'));
        } finally {
            setDraftReferenceLinksLoading(false);
        }
    }, [selectedDraftPostId, t]);

    useEffect(() => {
        void loadDraftReferenceLinks();
    }, [loadDraftReferenceLinks]);

    const loadSourceMaterials = useCallback(async (): Promise<void> => {
        const requestId = sourceMaterialsRequestRef.current + 1;
        sourceMaterialsRequestRef.current = requestId;
        if (!selectedDraftPostId || !Number.isFinite(selectedDraftPostId)) {
            if (sourceMaterialsRequestRef.current !== requestId) return;
            setSourceMaterials([]);
            setSourceMaterialsError(null);
            setSourceMaterialsLoading(false);
            return;
        }

        setSourceMaterialsLoading(true);
        try {
            const materials = await fetchSourceMaterials(circleId, {
                draftPostId: selectedDraftPostId,
            });
            if (sourceMaterialsRequestRef.current !== requestId) return;
            setSourceMaterials(materials);
            setSourceMaterialsError(null);
        } catch (error) {
            if (sourceMaterialsRequestRef.current !== requestId) return;
            setSourceMaterials([]);
            setSourceMaterialsError(error instanceof Error ? error.message : t('errors.loadSourceMaterials'));
        } finally {
            if (sourceMaterialsRequestRef.current !== requestId) return;
            setSourceMaterialsLoading(false);
        }
    }, [circleId, selectedDraftPostId, t]);

    useEffect(() => {
        void loadSourceMaterials();
    }, [loadSourceMaterials]);

    const loadSeededFileTree = useCallback(async (): Promise<void> => {
        if (genesisMode !== 'SEEDED') {
            setSeededFileTree([]);
            setSeededFileTreeError(null);
            setSeededFileTreeLoading(false);
            return;
        }

        setSeededFileTreeLoading(true);
        try {
            const tree = await fetchSeededFileTree(circleId);
            setSeededFileTree(tree);
            setSeededFileTreeError(null);
        } catch (error) {
            setSeededFileTree([]);
            setSeededFileTreeError(error instanceof Error ? error.message : t('errors.loadSeededReferences'));
        } finally {
            setSeededFileTreeLoading(false);
        }
    }, [circleId, genesisMode, t]);

    useEffect(() => {
        void loadSeededFileTree();
    }, [loadSeededFileTree]);

    const resolveDiscussionAccessToken = useCallback(async (): Promise<string | null> => {
        if (!ensureDiscussionSessionToken) return null;
        try {
            return await ensureDiscussionSessionToken();
        } catch (error) {
            console.warn('resolve discussion session token failed:', error);
            return null;
        }
    }, [ensureDiscussionSessionToken]);

    const canEditWorkingCopy = canEdit && (draftLifecycle?.documentStatus || 'drafting') === 'drafting';

    const handleSaveDraftTitle = useCallback(async () => {
        if (!selectedDraftPostId || !canEditWorkingCopy || draftTitleBusy) return;
        const title = draftTitleInput.trim().replace(/\s+/g, ' ');
        if (!title) return;
        if (title === selectedDraftTitle) {
            setDraftTitleEditing(false);
            return;
        }
        setDraftTitleBusy(true);
        try {
            const updated = await updateDiscussionDraftTitle(selectedDraftPostId, {
                title,
                expectedTitle: selectedDraftTitle || selectedDraftSummary?.title || '',
            }, t('editor.titleSaveError'));
            setSelectedDraftTitle(updated.title);
            setDraftTitleInput(updated.title);
            await refreshDraftSummaryAfterLifecycleChange();
            setDraftTitleEditing(false);
            showNotice('success', t('editor.titleSaved'));
        } catch (error) {
            showNotice('error', error instanceof Error ? error.message : t('editor.titleSaveError'));
        } finally {
            setDraftTitleBusy(false);
        }
    }, [
        canEditWorkingCopy,
        draftTitleBusy,
        draftTitleInput,
        refreshDraftSummaryAfterLifecycleChange,
        selectedDraftPostId,
        selectedDraftSummary?.title,
        selectedDraftTitle,
        showNotice,
        t,
    ]);

    const handleUploadSourceMaterial = useCallback(async (
        file: File,
        license: import('@/lib/api/circlesSourceMaterials').SourceMaterialLicenseInput,
    ): Promise<import('@/lib/api/circlesSourceMaterials').SourceMaterialRecord | void> => {
        if (!selectedDraftPostId || !Number.isFinite(selectedDraftPostId)) {
            throw new Error(t('errors.missingDraftContextForUpload'));
        }
        if (!canEditWorkingCopy) {
            throw new Error(t('errors.uploadWithoutEditPermission'));
        }

        setSourceMaterialsError(null);
        setSourceMaterialsUploading(true);
        try {
            const content = await file.text();
            const material = await uploadSourceMaterial(circleId, {
                draftPostId: selectedDraftPostId,
                name: String(file.name || 'source-material.txt'),
                mimeType: file.type || null,
                content,
                license,
            });
            await loadSourceMaterials();
            if (material?.id) {
                setSourceMaterials((current) => (
                    current.some((item) => item.id === material.id)
                        ? current
                        : [material, ...current]
                ));
            }
            return material;
        } catch (error) {
            const message = error instanceof Error ? error.message : t('errors.uploadSourceMaterial');
            setSourceMaterialsError(message);
            throw new Error(message);
        } finally {
            setSourceMaterialsUploading(false);
        }
    }, [canEditWorkingCopy, circleId, loadSourceMaterials, selectedDraftPostId, t]);

    const handleCaptureExternalUrlSourceMaterial = useCallback(async (input: {
        name: string;
        canonicalUrl: string;
        externalAuthorLabel: string;
        publishedAt: string;
        content: string;
        recaptureOfSourceMaterialId?: number | null;
        license: import('@/lib/api/circlesSourceMaterials').SourceMaterialLicenseInput;
    }): Promise<import('@/lib/api/circlesSourceMaterials').SourceMaterialRecord | void> => {
        if (!selectedDraftPostId || !Number.isFinite(selectedDraftPostId)) {
            throw new Error(t('errors.missingDraftContextForUpload'));
        }
        if (!canEditWorkingCopy) {
            throw new Error(t('errors.uploadWithoutEditPermission'));
        }

        setSourceMaterialsError(null);
        setSourceMaterialsUploading(true);
        try {
            const material = await captureExternalUrlSourceMaterial(circleId, {
                draftPostId: selectedDraftPostId,
                ...input,
            });
            await loadSourceMaterials();
            if (material?.id) {
                setSourceMaterials((current) => (
                    current.some((item) => item.id === material.id)
                        ? current
                        : [material, ...current]
                ));
            }
            return material;
        } catch (error) {
            const message = error instanceof Error ? error.message : t('errors.uploadSourceMaterial');
            setSourceMaterialsError(message);
            throw new Error(message);
        } finally {
            setSourceMaterialsUploading(false);
        }
    }, [canEditWorkingCopy, circleId, loadSourceMaterials, selectedDraftPostId, t]);

    const handleOpenSourceMaterialContent = useCallback(async (sourceMaterialId: number) => {
        setSourceMaterialsError(null);
        try {
            return await fetchSourceMaterialContent(circleId, sourceMaterialId);
        } catch (error) {
            const message = error instanceof Error ? error.message : t('errors.loadSourceMaterials');
            setSourceMaterialsError(message);
            throw new Error(message);
        }
    }, [circleId, t]);

    const refreshDraftLifecycle = useCallback(async (): Promise<void> => {
        if (!selectedDraftPostId || !Number.isFinite(selectedDraftPostId)) {
            draftLifecycleRequestRef.current += 1;
            setDraftLifecycleSnapshot(null);
            setDraftLifecycleError(null);
            setDraftLifecycleLoading(false);
            return;
        }

        const requestId = draftLifecycleRequestRef.current + 1;
        draftLifecycleRequestRef.current = requestId;
        const hasLifecycleSnapshot = draftLifecycleRef.current?.draftPostId === selectedDraftPostId;
        if (!hasLifecycleSnapshot && draftLifecycleRef.current) {
            setDraftLifecycleSnapshot(null);
        }
        setDraftLifecycleLoading(!hasLifecycleSnapshot);
        setDraftLifecycleError(null);
        try {
            const discussionAccessToken = await resolveDiscussionAccessToken();
            const lifecycle = await fetchDraftLifecycle({
                draftPostId: selectedDraftPostId,
                discussionAccessToken,
            });
            if (draftLifecycleRequestRef.current !== requestId) return;
            setDraftLifecycleSnapshot(lifecycle);
        } catch (error) {
            if (draftLifecycleRequestRef.current !== requestId) return;
            const message = error instanceof Error ? error.message : t('errors.loadDraftLifecycle');
            if (!hasLifecycleSnapshot) {
                setDraftLifecycleSnapshot(null);
                setDraftLifecycleError(message);
            } else {
                console.warn('refresh draft lifecycle failed:', error);
            }
        } finally {
            if (draftLifecycleRequestRef.current !== requestId) return;
            setDraftLifecycleLoading(false);
        }
    }, [resolveDiscussionAccessToken, selectedDraftPostId, setDraftLifecycleSnapshot, t]);

    const refreshDraftDiscussions = useCallback(async (): Promise<void> => {
        if (!selectedDraftPostId || !Number.isFinite(selectedDraftPostId)) {
            setDiscussionThreads([]);
            setDiscussionViewerUserId(null);
            setDiscussionError(null);
            setDiscussionLoading(false);
            return;
        }

        setDiscussionLoading(true);
        try {
            const discussionAccessToken = await resolveDiscussionAccessToken();
            const payload = await listDraftDiscussions({
                draftPostId: selectedDraftPostId,
                limit: 80,
                discussionAccessToken,
            });
            setDiscussionThreads(payload.threads || []);
            setDiscussionViewerUserId(
                Number.isFinite(payload.viewerUserId as number) ? Number(payload.viewerUserId) : null,
            );
            setDiscussionError(null);
        } catch (error) {
            const message = error instanceof Error ? error.message : t('errors.loadDiscussionThreads');
            setDiscussionError(message);
        } finally {
            setDiscussionLoading(false);
        }
    }, [resolveDiscussionAccessToken, selectedDraftPostId, t]);

    const refreshSelectedDraftWorkingCopy = useCallback(async (options?: {
        forceReplace?: boolean;
        replaceLiveDoc?: boolean;
        conflictSource?: DraftRemoteUpdateConflict['source'];
    }): Promise<boolean> => {
        if (!selectedDraftPostId || !Number.isFinite(selectedDraftPostId)) return false;

        const discussionAccessToken = await resolveDiscussionAccessToken();
        const payload = await fetchDiscussionDraftContent(selectedDraftPostId, { discussionAccessToken });
        if (!payload) return false;

        const nextText = payload.text ?? '';
        const nextHash = payload.workingCopyHash ?? null;
        const nextTitle = String(payload.title || payload.draftTitle || '').trim();
        const currentHash =
            selectedDraftWorkingCopyHashRef.current
            || draftLifecycleRef.current?.workingCopy?.workingCopyHash
            || null;
        const serverChanged = Boolean(
            nextHash
            ? nextHash !== currentHash
            : nextText !== selectedDraftContentRef.current,
        );

        if (typeof payload.heatScore === 'number') {
            setDisplayHeat(Math.max(0, payload.heatScore));
        }
        if (nextTitle && !draftTitleEditingRef.current) {
            setSelectedDraftTitle(nextTitle);
            setDraftTitleInput(nextTitle);
        }
        if (payload.scopedPermissions) {
            setDraftScopedPermissions(payload.scopedPermissions);
        }
        setDraftParagraphDeleteBlockedBy(payload.paragraphStructure.deleteBlockedBy);
        setDraftDocumentEditAllowed(payload.paragraphStructure.canEditDocument);

        const documentStatus = draftLifecycleRef.current?.documentStatus || draftLifecycle?.documentStatus || null;
        const hasLocalDraftWork = hasUnsavedDraftRef.current || Boolean(activeEditingBlockIdRef.current);
        const canPreserveLocalWork = canPreserveLocalDraftWork(documentStatus);
        const shouldDiscardStaleLocalWork = hasLocalDraftWork && !canPreserveLocalWork;
        if (!options?.forceReplace && canPreserveLocalWork && hasLocalDraftWork) {
            if (serverChanged) {
                setDraftRemoteUpdateConflict({
                    workingCopyHash: nextHash,
                    updatedAt: payload.updatedAt,
                    source: options?.conflictSource || 'polling',
                });
            }
            return false;
        }

        if (!serverChanged && !options?.forceReplace && !shouldDiscardStaleLocalWork) {
            return true;
        }

        await refreshDraftCommentsSafely();

        autosaveTextRef.current = nextText;
        hasUnsavedDraftRef.current = false;
        pendingDraftEditScopeRef.current = null;
        activeEditingBlockIdRef.current = null;
        setEditingBlockId(null);
        setSelectedDraftContent(nextText);
        if (options?.forceReplace) {
            setDocumentEditorText(nextText);
        }
        setSelectedDraftWorkingCopyHash(nextHash);
        setSelectedDraftContentReady(true);
        setDraftRemoteUpdateConflict(null);

        const currentLifecycle = draftLifecycleRef.current;
        if (currentLifecycle && currentLifecycle.draftPostId === selectedDraftPostId) {
            setDraftLifecycleSnapshot({
                ...currentLifecycle,
                workingCopy: {
                    ...currentLifecycle.workingCopy,
                    workingCopyContent: nextText,
                    workingCopyHash: nextHash || currentLifecycle.workingCopy.workingCopyHash,
                    updatedAt: payload.updatedAt || currentLifecycle.workingCopy.updatedAt,
                },
            });
        }

        if (options?.replaceLiveDoc) {
            setGhostDraftReplaceRequest({
                token: Date.now(),
                content: nextText,
            });
        }

        return true;
    }, [
        refreshDraftCommentsSafely,
        resolveDiscussionAccessToken,
        selectedDraftPostId,
        setDraftLifecycleSnapshot,
    ]);

    const saveDraftContent = useCallback(async (
        postId: number,
        text: string,
        options?: {
            surfaceErrors?: boolean;
            editScope?: SaveDraftContentOptions['editScope'] | null;
            workingCopyHash?: string | null;
            paragraphDelete?: SaveDraftContentOptions['paragraphDelete'] | null;
            preserveStructure?: boolean;
            appendParagraph?: boolean;
        },
    ) => {
        const payloadText = text.trim();
        if (!payloadText) {
            const error = new Error(t('errors.cannotDeleteLastParagraph'));
            if (options?.surfaceErrors) {
                throw error;
            }
            return null;
        }
        try {
            const discussionAccessToken = await resolveDiscussionAccessToken();
            let editScope = options?.editScope ?? undefined;
            let workingCopyHash = editScope ? undefined : (options?.workingCopyHash || selectedDraftWorkingCopyHash || draftLifecycle?.workingCopy.workingCopyHash || undefined);
            if (editScope?.type === 'paragraph' && !editScope.baseWorkingCopyHash) {
                const latestPayload = await fetchDiscussionDraftContent(postId, { discussionAccessToken });
                const latestHash = latestPayload?.workingCopyHash ?? null;
                if (latestPayload?.scopedPermissions) {
                    setDraftScopedPermissions(latestPayload.scopedPermissions);
                }
                if (latestHash) {
                    setSelectedDraftWorkingCopyHash(latestHash);
                    editScope = {
                        ...editScope,
                        baseWorkingCopyHash: latestHash,
                    };
                } else {
                    throw new Error(t('errors.saveDraftMissingBaseHash'));
                }
            }
            if (!editScope && !workingCopyHash) {
                const latestPayload = await fetchDiscussionDraftContent(postId, { discussionAccessToken });
                const latestHash = latestPayload?.workingCopyHash ?? null;
                if (latestPayload?.scopedPermissions) {
                    setDraftScopedPermissions(latestPayload.scopedPermissions);
                }
                if (latestHash) {
                    setSelectedDraftWorkingCopyHash(latestHash);
                    workingCopyHash = latestHash;
                } else {
                    throw new Error(t('errors.saveDraftMissingBaseHash'));
                }
            }
            const payload = await saveDiscussionDraftContent(postId, payloadText, t('errors.saveDraft'), {
                discussionAccessToken,
                workingCopyHash,
                editScope,
                paragraphDelete: options?.paragraphDelete ?? undefined,
                preserveStructure: options?.preserveStructure,
                appendParagraph: options?.appendParagraph,
            });
            const saved = true;
            if (typeof payload.heatScore === 'number') {
                setDisplayHeat(Math.max(0, payload.heatScore));
            }
            setSelectedDraftWorkingCopyHash(payload.workingCopyHash ?? null);
            if (payload.scopedPermissions) {
                setDraftScopedPermissions(payload.scopedPermissions);
            }
            if (payload.workingCopyHash) {
                announceDraftSaved({
                    workingCopyHash: payload.workingCopyHash,
                    updatedAt: payload.updatedAt,
                });
            }
            if (payload.updatedAt && draftLifecycle) {
                setDraftLifecycleSnapshot({
                    ...draftLifecycle,
                    workingCopy: {
                        ...draftLifecycle.workingCopy,
                        workingCopyContent: payloadText,
                        workingCopyHash: payload.workingCopyHash || draftLifecycle.workingCopy.workingCopyHash,
                        updatedAt: payload.updatedAt,
                    },
                });
            }
            if (autosaveTextRef.current === text) {
                hasUnsavedDraftRef.current = false;
                pendingDraftEditScopeRef.current = null;
            }
            if (pendingReferenceLinksRefreshRef.current && saved) {
                await loadDraftReferenceLinks();
                pendingReferenceLinksRefreshRef.current = false;
            }
            return payload;
        } catch (error) {
            console.warn('Draft autosave failed:', error);
            const errorMetadata = getDraftRequestErrorMetadata(error);
            const shouldRefreshFromServer =
                errorMetadata.code ? DRAFT_SAVE_REFRESH_ERROR_CODES.has(errorMetadata.code) : false;
            if (shouldRefreshFromServer) {
                setDraftRemoteUpdateConflict({
                    workingCopyHash: errorMetadata.workingCopyHash,
                    updatedAt: null,
                    source: 'save_conflict',
                });
                void refreshSelectedDraftWorkingCopy({
                    replaceLiveDoc: true,
                    conflictSource: 'save_conflict',
                });
            } else if (!options?.surfaceErrors) {
                showNotice('error', error instanceof Error ? error.message : t('errors.saveDraft'));
            }
            if (options?.surfaceErrors) {
                throw error;
            }
            return null;
        }
    }, [
        announceDraftSaved,
        draftLifecycle,
        loadDraftReferenceLinks,
        resolveDiscussionAccessToken,
        refreshSelectedDraftWorkingCopy,
        selectedDraftWorkingCopyHash,
        setDraftLifecycleSnapshot,
        showNotice,
        t,
    ]);

    const syncDraftSurfaceFromLifecycle = useCallback((
        lifecycle: DraftLifecycleReadModel,
        options?: {
            replaceLiveDoc?: boolean;
        },
    ) => {
        setDraftLifecycleSnapshot(lifecycle);

        const nextWorkingCopy = String(lifecycle.workingCopy?.workingCopyContent || '');
        if (!nextWorkingCopy.trim()) return;

        autosaveTextRef.current = nextWorkingCopy;
        hasUnsavedDraftRef.current = false;
        setSelectedDraftContent(nextWorkingCopy);
        setSelectedDraftWorkingCopyHash(lifecycle.workingCopy?.workingCopyHash || null);

        if (options?.replaceLiveDoc) {
            setGhostDraftReplaceRequest({
                token: Date.now(),
                content: nextWorkingCopy,
            });
        }
    }, [setDraftLifecycleSnapshot]);

    const presentDraftLifecycleActionError = useCallback((message: string) => {
        setDraftLifecycleError(message);
        clearNoticeTimer();
        setNotice(null);
    }, [clearNoticeTimer]);

    const resolveConfirmationRequest = useCallback((confirmed: boolean) => {
        const resolve = confirmationResolveRef.current;
        confirmationResolveRef.current = null;
        setConfirmationRequest(null);
        resolve?.(confirmed);
    }, []);

    const requestConfirmation = useCallback((input: {
        title: string;
        description: string;
        confirmLabel: string;
        tone?: 'default' | 'danger';
    }): Promise<boolean> => {
        confirmationResolveRef.current?.(false);
        confirmationRequestIdRef.current += 1;
        return new Promise((resolve) => {
            confirmationResolveRef.current = resolve;
            setConfirmationRequest({
                id: confirmationRequestIdRef.current,
                title: input.title,
                description: input.description,
                confirmLabel: input.confirmLabel,
                cancelLabel: t('confirm.cancel'),
                closeLabel: t('confirm.close'),
                tone: input.tone,
            });
        });
    }, [t]);

    const resolveContributionGatePrompt = useCallback((decision: ContributionAssessmentGateDecision) => {
        const resolve = contributionGateResolveRef.current;
        contributionGateResolveRef.current = null;
        setContributionGatePrompt(null);
        resolve?.(decision);
    }, []);

    const handleReviewContributionTraceBeforeCrystallize = useCallback(() => {
        const draftPostId = contributionGatePrompt?.draftPostId ?? selectedDraftPostId;
        resolveContributionGatePrompt(null);
        if (draftPostId && Number.isFinite(draftPostId)) {
            router.push(`/circles/${circleId}/drafts/${draftPostId}/contribution-trace`);
        }
    }, [
        circleId,
        contributionGatePrompt?.draftPostId,
        resolveContributionGatePrompt,
        router,
        selectedDraftPostId,
    ]);

    useEffect(() => {
        return () => {
            contributionGateResolveRef.current?.(null);
            contributionGateResolveRef.current = null;
        };
    }, []);

    useEffect(() => {
        if (!contributionGatePrompt) return;
        if (
            !selectedDraftPostId
            || contributionGatePrompt.draftPostId !== selectedDraftPostId
        ) {
            resolveContributionGatePrompt(null);
        }
    }, [
        contributionGatePrompt,
        resolveContributionGatePrompt,
        selectedDraftPostId,
    ]);

    const flushDraftBeforeWorkflowAction = useCallback(async ({
        postId,
        emptyMessage,
        allowLockedRead = false,
    }: {
        postId: number;
        emptyMessage: string;
        allowLockedRead?: boolean;
    }) => {
        if (autosaveTimerRef.current !== null) {
            window.clearTimeout(autosaveTimerRef.current);
            autosaveTimerRef.current = null;
        }
        const latestDraftText = hasUnsavedDraftRef.current ? autosaveTextRef.current : selectedDraftContent;
        if (!canPreserveLocalDraftWork(draftLifecycleRef.current?.documentStatus || draftLifecycle?.documentStatus || null)) {
            if (!allowLockedRead) {
                throw new Error(emptyMessage);
            }
            const discussionAccessToken = await resolveDiscussionAccessToken();
            const payload = await fetchDiscussionDraftContent(postId, { discussionAccessToken });
            const lockedDraftText = String(
                payload?.text
                ?? draftLifecycleRef.current?.workingCopy?.workingCopyContent
                ?? selectedDraftContent
                ?? '',
            );
            if (!lockedDraftText.trim()) {
                throw new Error(emptyMessage);
            }
            if (typeof payload?.heatScore === 'number') {
                setDisplayHeat(Math.max(0, payload.heatScore));
            }
            if (payload?.scopedPermissions) {
                setDraftScopedPermissions(payload.scopedPermissions);
            }
            setSelectedDraftWorkingCopyHash(payload?.workingCopyHash ?? draftLifecycleRef.current?.workingCopy?.workingCopyHash ?? null);
            setSelectedDraftContent(lockedDraftText);
            setGhostDraftReplaceRequest({
                token: Date.now(),
                content: lockedDraftText,
            });
            autosaveTextRef.current = lockedDraftText;
            hasUnsavedDraftRef.current = false;
            pendingDraftEditScopeRef.current = null;
            activeEditingBlockIdRef.current = null;
            setEditingBlockId(null);
            setDraftRemoteUpdateConflict(null);
            return lockedDraftText;
        }
        if (!latestDraftText.trim()) {
            throw new Error(emptyMessage);
        }
        await saveDraftContent(postId, latestDraftText, { surfaceErrors: true });
        return latestDraftText;
    }, [draftLifecycle?.documentStatus, resolveDiscussionAccessToken, saveDraftContent, selectedDraftContent, setEditingBlockId]);

    const handleOpenDocumentEditor = useCallback(async () => {
        if (!selectedDraftPostId || !canEditWorkingCopy || documentEditorBusy) return;
        if (!draftDocumentEditAllowed) {
            showNotice('error', t('editor.documentEditBlocked'));
            return;
        }
        setDocumentEditorBusy(true);
        try {
            const flushedText = await flushDraftBeforeWorkflowAction({
                postId: selectedDraftPostId,
                emptyMessage: t('errors.documentEditorRequiresBody'),
            });
            const discussionAccessToken = await resolveDiscussionAccessToken();
            const current = await fetchDiscussionDraftContent(selectedDraftPostId, { discussionAccessToken });
            const authoritativeText = String(current?.text || flushedText);
            setSelectedDraftContent(authoritativeText);
            setSelectedDraftWorkingCopyHash(current?.workingCopyHash || selectedDraftWorkingCopyHash);
            setDocumentEditorText(authoritativeText);
            setDocumentEditorOpen(true);
        } catch (error) {
            showNotice('error', error instanceof Error ? error.message : t('errors.openDocumentEditor'));
        } finally {
            setDocumentEditorBusy(false);
        }
    }, [
        canEditWorkingCopy,
        documentEditorBusy,
        draftDocumentEditAllowed,
        flushDraftBeforeWorkflowAction,
        resolveDiscussionAccessToken,
        selectedDraftPostId,
        selectedDraftWorkingCopyHash,
        showNotice,
        t,
    ]);

    const handleSaveDocumentEditor = useCallback(async () => {
        if (!selectedDraftPostId || !canEditWorkingCopy || documentEditorBusy) return;
        const nextText = documentEditorText.trim();
        if (!nextText) {
            showNotice('error', t('errors.documentEditorRequiresBody'));
            return;
        }
        setDocumentEditorBusy(true);
        try {
            const payload = await saveDraftContent(selectedDraftPostId, nextText, {
                surfaceErrors: true,
                workingCopyHash: selectedDraftWorkingCopyHash,
                preserveStructure: true,
            });
            if (!payload) return;
            autosaveTextRef.current = nextText;
            hasUnsavedDraftRef.current = false;
            pendingDraftEditScopeRef.current = null;
            setSelectedDraftContent(nextText);
            setGhostDraftReplaceRequest({ token: Date.now(), content: nextText });
            setDocumentEditorOpen(false);
            showNotice('success', t('notices.documentSaved'));
        } catch (error) {
            showNotice('error', error instanceof Error ? error.message : t('errors.saveDocumentEditor'));
        } finally {
            setDocumentEditorBusy(false);
        }
    }, [
        canEditWorkingCopy,
        documentEditorBusy,
        documentEditorText,
        saveDraftContent,
        selectedDraftPostId,
        selectedDraftWorkingCopyHash,
        showNotice,
        t,
    ]);

    const handleAppendParagraph = useCallback(async () => {
        if (!selectedDraftPostId || !canEditWorkingCopy || appendParagraphBusy) return;
        const paragraph = normalizeAppendParagraphText(appendParagraphText).trim();
        if (!paragraph) return;
        setAppendParagraphBusy(true);
        try {
            const flushedText = await flushDraftBeforeWorkflowAction({
                postId: selectedDraftPostId,
                emptyMessage: t('errors.documentEditorRequiresBody'),
            });
            const discussionAccessToken = await resolveDiscussionAccessToken();
            const current = await fetchDiscussionDraftContent(selectedDraftPostId, { discussionAccessToken });
            const currentText = String(current?.text || flushedText).trim();
            const nextText = `${currentText}\n\n${paragraph}`;
            const payload = await saveDraftContent(selectedDraftPostId, nextText, {
                surfaceErrors: true,
                workingCopyHash: current?.workingCopyHash || selectedDraftWorkingCopyHash,
                appendParagraph: true,
            });
            if (!payload) return;
            autosaveTextRef.current = nextText;
            hasUnsavedDraftRef.current = false;
            pendingDraftEditScopeRef.current = null;
            setSelectedDraftContent(nextText);
            setGhostDraftReplaceRequest({ token: Date.now(), content: nextText });
            setAppendParagraphText('');
            setAppendParagraphOpen(false);
            showNotice('success', t('notices.paragraphAppended'));
        } catch (error) {
            showNotice('error', error instanceof Error ? error.message : t('errors.appendParagraph'));
        } finally {
            setAppendParagraphBusy(false);
        }
    }, [
        appendParagraphBusy,
        appendParagraphText,
        canEditWorkingCopy,
        flushDraftBeforeWorkflowAction,
        resolveDiscussionAccessToken,
        saveDraftContent,
        selectedDraftPostId,
        selectedDraftWorkingCopyHash,
        showNotice,
        t,
    ]);

    const handleEnterReview = useCallback(async () => {
        if (
            !selectedDraftPostId
            || !Number.isFinite(selectedDraftPostId)
            || !discussionCapabilities.canEndDraftingEarly
        ) return;
        setDraftLifecycleTransitionBusy(true);
        setDraftLifecycleError(null);
        try {
            await flushDraftBeforeWorkflowAction({
                postId: selectedDraftPostId,
                emptyMessage: t('errors.reviewRequiresBody'),
            });
            let lifecycle: DraftLifecycleReadModel;
            try {
                lifecycle = await enterDraftLifecycleReviewRequest({
                    draftPostId: selectedDraftPostId,
                });
            } catch (error) {
                if (
                    error instanceof DraftLifecycleRequestError
                    && error.code === 'draft_review_apply_confirmation_required'
                ) {
                    const pendingThreadCount = Number(error.payload?.pendingThreadCount || 0);
                    const confirmed = await requestConfirmation({
                        title: t('confirm.applyAcceptedGhostThreadsTitle'),
                        description: t('confirm.applyAcceptedGhostThreads', {
                            count: pendingThreadCount > 0 ? pendingThreadCount : 1,
                        }),
                        confirmLabel: t('confirm.continue'),
                    });
                    if (!confirmed) {
                        return;
                    }
                    lifecycle = await enterDraftLifecycleReviewRequest({
                        draftPostId: selectedDraftPostId,
                        confirmApplyAcceptedGhostThreads: true,
                    });
                } else {
                    throw error;
                }
            }
            setDraftLifecycleSnapshot(lifecycle);
            await refreshDraftSummaryAfterLifecycleChange();
            await refreshDraftDiscussions();
            setNotice({
                type: 'success',
                text: t('notices.enterReviewSuccess'),
            });
        } catch (error) {
            const message = error instanceof Error ? error.message : t('errors.enterReview');
            presentDraftLifecycleActionError(message);
        } finally {
            setDraftLifecycleTransitionBusy(false);
        }
    }, [
        discussionCapabilities.canEndDraftingEarly,
        flushDraftBeforeWorkflowAction,
        presentDraftLifecycleActionError,
        refreshDraftDiscussions,
        refreshDraftSummaryAfterLifecycleChange,
        requestConfirmation,
        selectedDraftPostId,
        setDraftLifecycleSnapshot,
        t,
    ]);

    const handleAdvanceReview = useCallback(async () => {
        if (
            !selectedDraftPostId
            || !Number.isFinite(selectedDraftPostId)
            || !discussionCapabilities.canAdvanceFromReview
        ) return;
        setDraftLifecycleTransitionBusy(true);
        setDraftLifecycleError(null);
        try {
            let lifecycle: DraftLifecycleReadModel;
            try {
                lifecycle = await advanceDraftLifecycleReviewRequest({
                    draftPostId: selectedDraftPostId,
                });
            } catch (error) {
                if (
                    error instanceof DraftLifecycleRequestError
                    && error.code === 'draft_review_apply_confirmation_required'
                ) {
                    const pendingThreadCount = Number(error.payload?.pendingThreadCount || 0);
                    const confirmed = await requestConfirmation({
                        title: t('confirm.applyAcceptedGhostThreadsTitle'),
                        description: t('confirm.applyAcceptedGhostThreads', {
                            count: pendingThreadCount > 0 ? pendingThreadCount : 1,
                        }),
                        confirmLabel: t('confirm.continue'),
                    });
                    if (!confirmed) {
                        return;
                    }
                    lifecycle = await advanceDraftLifecycleReviewRequest({
                        draftPostId: selectedDraftPostId,
                        confirmApplyAcceptedGhostThreads: true,
                    });
                } else {
                    throw error;
                }
            }
            syncDraftSurfaceFromLifecycle(lifecycle, { replaceLiveDoc: true });
            await refreshDraftSummaryAfterLifecycleChange();
            await refreshDraftDiscussions();
            setNotice({
                type: 'success',
                text: t('notices.advanceReviewSuccess'),
            });
        } catch (error) {
            const message = error instanceof Error ? error.message : t('errors.advanceReview');
            presentDraftLifecycleActionError(message);
        } finally {
            setDraftLifecycleTransitionBusy(false);
        }
    }, [
        discussionCapabilities.canAdvanceFromReview,
        presentDraftLifecycleActionError,
        refreshDraftDiscussions,
        refreshDraftSummaryAfterLifecycleChange,
        requestConfirmation,
        selectedDraftPostId,
        syncDraftSurfaceFromLifecycle,
        t,
    ]);

    const handleEnterCrystallization = useCallback(async () => {
        if (
            !selectedDraftPostId
            || !Number.isFinite(selectedDraftPostId)
            || !discussionCapabilities.canCrystallize
            || !sdk
            || !draftLifecycle?.policyProfileDigest
        ) return;
        const ordinaryConfirmed = await requestConfirmation({
            title: t('confirm.ordinaryCrystallizationTitle'),
            description: t('confirm.ordinaryCrystallizationDescription'),
            confirmLabel: t('confirm.ordinaryCrystallizationConfirm'),
        });
        if (!ordinaryConfirmed) return;
        setDraftLifecycleTransitionBusy(true);
        setDraftLifecycleError(null);
        try {
            const anchorSignature = await sdk.content.enterDraftLifecycleCrystallizationAnchor({
                draftPostId: selectedDraftPostId,
                policyProfileDigest: draftLifecycle?.policyProfileDigest,
            });
            const lifecycle = await enterDraftLifecycleCrystallizationRequest({
                draftPostId: selectedDraftPostId,
                anchorSignature,
                policyProfileDigest: draftLifecycle.policyProfileDigest,
                routingConfirmation: {
                    path: 'ordinary_knowledge',
                    actionIntent: null,
                    humanConfirmed: true,
                },
            });
            setDraftLifecycleSnapshot(lifecycle);
            await refreshDraftSummaryAfterLifecycleChange();
            await refreshDraftDiscussions();
            setNotice({
                type: 'success',
                text: t('notices.enterCrystallizationSuccess'),
            });
        } catch (error) {
            const message = error instanceof Error ? error.message : t('errors.enterCrystallization');
            presentDraftLifecycleActionError(message);
        } finally {
            setDraftLifecycleTransitionBusy(false);
        }
    }, [
        discussionCapabilities.canCrystallize,
        draftLifecycle?.policyProfileDigest,
        presentDraftLifecycleActionError,
        refreshDraftDiscussions,
        refreshDraftSummaryAfterLifecycleChange,
        requestConfirmation,
        selectedDraftPostId,
        sdk,
        setDraftLifecycleSnapshot,
        t,
    ]);

    const handleRetryCrystallization = useCallback(async () => {
        if (
            !selectedDraftPostId
            || !Number.isFinite(selectedDraftPostId)
            || !discussionCapabilities.canCrystallize
            || !sdk
            || !draftLifecycle?.policyProfileDigest
        ) return;
        setDraftLifecycleTransitionBusy(true);
        setDraftLifecycleError(null);
        try {
            const anchorSignature = await sdk.content.enterDraftLifecycleCrystallizationAnchor({
                draftPostId: selectedDraftPostId,
                policyProfileDigest: draftLifecycle?.policyProfileDigest,
            });
            const lifecycle = await retryDraftLifecycleCrystallizationRequest({
                draftPostId: selectedDraftPostId,
                anchorSignature,
                policyProfileDigest: draftLifecycle.policyProfileDigest,
            });
            setDraftLifecycleSnapshot(lifecycle);
            await refreshDraftSummaryAfterLifecycleChange();
            await refreshDraftDiscussions();
            setNotice({
                type: 'success',
                text: t('notices.retryCrystallizationSuccess'),
            });
        } catch (error) {
            const message = error instanceof Error ? error.message : t('errors.retryCrystallization');
            presentDraftLifecycleActionError(message);
        } finally {
            setDraftLifecycleTransitionBusy(false);
        }
    }, [
        discussionCapabilities.canCrystallize,
        draftLifecycle?.policyProfileDigest,
        presentDraftLifecycleActionError,
        refreshDraftDiscussions,
        refreshDraftSummaryAfterLifecycleChange,
        selectedDraftPostId,
        sdk,
        setDraftLifecycleSnapshot,
        t,
    ]);

    const handleRollbackCrystallization = useCallback(async () => {
        if (
            !selectedDraftPostId
            || !Number.isFinite(selectedDraftPostId)
            || !discussionCapabilities.canAdvanceFromReview
        ) return;
        setDraftLifecycleTransitionBusy(true);
        setDraftLifecycleError(null);
        try {
            const lifecycle = await rollbackDraftLifecycleCrystallizationRequest({
                draftPostId: selectedDraftPostId,
            });
            setDraftLifecycleSnapshot(lifecycle);
            await refreshDraftSummaryAfterLifecycleChange();
            await refreshDraftDiscussions();
            setNotice({
                type: 'success',
                text: t('notices.rollbackCrystallizationSuccess'),
            });
        } catch (error) {
            const message = error instanceof Error ? error.message : t('errors.rollbackCrystallization');
            presentDraftLifecycleActionError(message);
        } finally {
            setDraftLifecycleTransitionBusy(false);
        }
    }, [
        discussionCapabilities.canAdvanceFromReview,
        presentDraftLifecycleActionError,
        refreshDraftDiscussions,
        refreshDraftSummaryAfterLifecycleChange,
        selectedDraftPostId,
        setDraftLifecycleSnapshot,
        t,
    ]);

    const handleArchiveDraft = useCallback(async () => {
        if (
            !selectedDraftPostId
            || !Number.isFinite(selectedDraftPostId)
            || !discussionCapabilities.canAdvanceFromReview
            || !sdk
            || !draftLifecycle?.policyProfileDigest
        ) return;
        setDraftLifecycleTransitionBusy(true);
        setDraftLifecycleError(null);
        try {
            if (draftLifecycle.documentStatus === 'drafting') {
                await flushDraftBeforeWorkflowAction({
                    postId: selectedDraftPostId,
                    emptyMessage: t('errors.archiveRequiresBody'),
                });
            }

            const anchorSignature = await sdk.content.archiveDraftLifecycleAnchor({
                draftPostId: selectedDraftPostId,
                policyProfileDigest: draftLifecycle?.policyProfileDigest,
            });
            const lifecycle = await archiveDraftLifecycleRequest({
                draftPostId: selectedDraftPostId,
                anchorSignature,
                policyProfileDigest: draftLifecycle.policyProfileDigest,
            });
            setDraftLifecycleSnapshot(lifecycle);
            await refreshDraftSummaryAfterLifecycleChange();
            await refreshDraftDiscussions();
            setNotice({
                type: 'success',
                text: t('notices.archiveSuccess'),
            });
        } catch (error) {
            const message = error instanceof Error ? error.message : t('errors.archiveDraft');
            presentDraftLifecycleActionError(message);
        } finally {
            setDraftLifecycleTransitionBusy(false);
        }
    }, [
        discussionCapabilities.canAdvanceFromReview,
        draftLifecycle,
        flushDraftBeforeWorkflowAction,
        presentDraftLifecycleActionError,
        refreshDraftDiscussions,
        refreshDraftSummaryAfterLifecycleChange,
        sdk,
        selectedDraftPostId,
        setDraftLifecycleSnapshot,
        t,
    ]);

    const handleRestoreDraft = useCallback(async () => {
        if (
            !selectedDraftPostId
            || !Number.isFinite(selectedDraftPostId)
            || !discussionCapabilities.canAdvanceFromReview
            || !sdk
            || !draftLifecycle?.policyProfileDigest
        ) return;
        setDraftLifecycleTransitionBusy(true);
        setDraftLifecycleError(null);
        try {
            const anchorSignature = await sdk.content.restoreDraftLifecycleAnchor({
                draftPostId: selectedDraftPostId,
                policyProfileDigest: draftLifecycle?.policyProfileDigest,
            });
            const lifecycle = await restoreDraftLifecycleRequest({
                draftPostId: selectedDraftPostId,
                anchorSignature,
                policyProfileDigest: draftLifecycle.policyProfileDigest,
            });
            setDraftLifecycleSnapshot(lifecycle);
            await refreshDraftSummaryAfterLifecycleChange();
            await refreshDraftDiscussions();
            setNotice({
                type: 'success',
                text: t('notices.restoreSuccess'),
            });
        } catch (error) {
            const message = error instanceof Error ? error.message : t('errors.restoreDraft');
            presentDraftLifecycleActionError(message);
        } finally {
            setDraftLifecycleTransitionBusy(false);
        }
    }, [
        discussionCapabilities.canAdvanceFromReview,
        draftLifecycle?.policyProfileDigest,
        presentDraftLifecycleActionError,
        refreshDraftDiscussions,
        refreshDraftSummaryAfterLifecycleChange,
        sdk,
        selectedDraftPostId,
        setDraftLifecycleSnapshot,
        t,
    ]);

    const syncDraftDiscussionSurface = useCallback(async (): Promise<void> => {
        if (discussionSurfaceSyncRef.current) {
            return discussionSurfaceSyncRef.current;
        }

        const syncTask = (async () => {
            await Promise.all([
                refreshDraftDiscussions(),
                refreshDraftLifecycle(),
            ]);
            await refreshSelectedDraftWorkingCopy({
                replaceLiveDoc: true,
                conflictSource: 'polling',
            });
        })();

        discussionSurfaceSyncRef.current = syncTask;
        try {
            await syncTask;
        } finally {
            if (discussionSurfaceSyncRef.current === syncTask) {
                discussionSurfaceSyncRef.current = null;
            }
        }
    }, [refreshDraftDiscussions, refreshDraftLifecycle, refreshSelectedDraftWorkingCopy]);

    const handleAcceptedIssueRevisionApplied = useCallback(async (payload: AcceptedIssueRevisionAppliedPayload) => {
        const normalized = String(payload.workingCopyContent || '').trim();
        if (normalized) {
            autosaveTextRef.current = normalized;
            hasUnsavedDraftRef.current = false;
            pendingDraftEditScopeRef.current = null;
            activeEditingBlockIdRef.current = null;
            setEditingBlockId(null);
            setSelectedDraftContent(normalized);
            setSelectedDraftWorkingCopyHash(payload.workingCopyHash || null);
            setDisplayHeat(Math.max(0, Number(payload.heatScore || 0)));
            setGhostDraftReplaceRequest({
                token: Date.now(),
                content: normalized,
            });
            if (draftLifecycle) {
                setDraftLifecycleSnapshot({
                    ...draftLifecycle,
                    workingCopy: {
                        ...draftLifecycle.workingCopy,
                        workingCopyContent: normalized,
                        workingCopyHash: payload.workingCopyHash,
                        updatedAt: payload.workingCopyUpdatedAt,
                    },
                });
            }
        }

        await syncDraftDiscussionSurface();
    }, [draftLifecycle, setDraftLifecycleSnapshot, setEditingBlockId, syncDraftDiscussionSurface]);

    const upsertDiscussionThread = useCallback((thread: DraftDiscussionThreadRecord) => {
        setDiscussionThreads((prev) => {
            const remaining = prev.filter((item) => item.id !== thread.id);
            return [thread, ...remaining];
        });
    }, []);

    const runDiscussionMutation = useCallback(async function runDiscussionMutation<T>(
        mutation: () => Promise<T>,
        onSuccess?: (result: T) => void,
    ): Promise<T> {
        setDiscussionBusy(true);
        setDiscussionError(null);
        try {
            const result = await mutation();
            onSuccess?.(result);
            try {
                await syncDraftDiscussionSurface();
            } catch (refreshError) {
                const refreshMessage = refreshError instanceof Error
                    ? refreshError.message
                    : t('errors.refreshDiscussionThreads');
                setDiscussionError(refreshMessage);
            }
            return result;
        } catch (error) {
            const message = error instanceof Error ? error.message : t('errors.discussionOperation');
            setDiscussionError(message);
            throw error;
        } finally {
            setDiscussionBusy(false);
        }
    }, [syncDraftDiscussionSurface, t]);

    const handleCreateDiscussion = useCallback(async (input: {
        targetType: DraftDiscussionTargetType;
        targetRef: string;
        targetVersion?: number;
        issueType: DraftDiscussionIssueType;
        content: string;
    }) => {
        if (!selectedDraftPostId || !Number.isFinite(selectedDraftPostId)) {
            throw new Error(t('errors.missingDraftContextForCreateThread'));
        }
        if (!Number.isInteger(input.targetVersion) || Number(input.targetVersion) <= 0) {
            throw new Error(t('errors.missingDraftStableVersion'));
        }

        const payload = await runDiscussionMutation(async () => createDraftDiscussion({
                draftPostId: selectedDraftPostId,
                targetType: input.targetType,
                targetRef: input.targetRef,
                targetVersion: input.targetVersion,
                issueType: input.issueType,
                content: input.content,
            }),
        (payload) => upsertDiscussionThread(payload.thread));
        return payload.thread;
    }, [runDiscussionMutation, selectedDraftPostId, t, upsertDiscussionThread]);

    const handleProposeDiscussion = useCallback(async (input: {
        threadId: string;
        issueType?: DraftDiscussionIssueType;
        content: string;
    }) => {
        if (!selectedDraftPostId || !Number.isFinite(selectedDraftPostId)) {
            throw new Error(t('errors.missingDraftContextForPropose'));
        }

        const payload = await runDiscussionMutation(async () => proposeDraftDiscussion({
                draftPostId: selectedDraftPostId,
                threadId: input.threadId,
                issueType: input.issueType,
                content: input.content,
            }),
        (payload) => upsertDiscussionThread(payload.thread));
        return payload.thread;
    }, [runDiscussionMutation, selectedDraftPostId, t, upsertDiscussionThread]);

    const handleResolveDiscussion = useCallback(async (input: {
        threadId: string;
        resolution: DraftDiscussionResolution;
        issueType?: DraftDiscussionIssueType;
        reason?: string;
    }) => {
        if (!selectedDraftPostId || !Number.isFinite(selectedDraftPostId)) {
            throw new Error(t('errors.missingDraftContextForResolve'));
        }

        const payload = await runDiscussionMutation(async () => resolveDraftDiscussion({
                draftPostId: selectedDraftPostId,
                threadId: input.threadId,
                resolution: input.resolution,
                issueType: input.issueType,
                reason: input.reason,
            }),
        (payload) => upsertDiscussionThread(payload.thread));
        return payload.thread;
    }, [runDiscussionMutation, selectedDraftPostId, t, upsertDiscussionThread]);

    const handleReplyDiscussion = useCallback(async (input: {
        threadId: string;
        content: string;
    }) => {
        if (!selectedDraftPostId || !Number.isFinite(selectedDraftPostId)) {
            throw new Error(t('errors.missingDraftContextForReply'));
        }

        const payload = await runDiscussionMutation(async () => appendDraftDiscussionMessage({
                draftPostId: selectedDraftPostId,
                threadId: input.threadId,
                content: input.content,
            }),
        (payload) => upsertDiscussionThread(payload.thread));
        return payload.thread;
    }, [runDiscussionMutation, selectedDraftPostId, t, upsertDiscussionThread]);

    const handleWithdrawDiscussion = useCallback(async (input: {
        threadId: string;
        reason?: string;
    }) => {
        if (!selectedDraftPostId || !Number.isFinite(selectedDraftPostId)) {
            throw new Error(t('errors.missingDraftContextForWithdraw'));
        }

        const payload = await runDiscussionMutation(async () => withdrawDraftDiscussion({
                draftPostId: selectedDraftPostId,
                threadId: input.threadId,
                reason: input.reason,
            }),
        (payload) => upsertDiscussionThread(payload.thread));
        return payload.thread;
    }, [runDiscussionMutation, selectedDraftPostId, t, upsertDiscussionThread]);

    const handleApplyDiscussion = useCallback(async (input: {
        threadId: string;
        reason?: string;
    }) => {
        if (!selectedDraftPostId || !Number.isFinite(selectedDraftPostId)) {
            throw new Error(t('errors.missingDraftContextForApply'));
        }

        const payload = await runDiscussionMutation(async () => applyDraftDiscussion({
                draftPostId: selectedDraftPostId,
                threadId: input.threadId,
                reason: input.reason,
            }),
        (payload) => upsertDiscussionThread(payload.thread));
        return payload.thread;
    }, [runDiscussionMutation, selectedDraftPostId, t, upsertDiscussionThread]);

    const memberDisplayNameByPubkey = useMemo(() => {
        const map = new Map<string, string>();
        for (const member of circleMembers) {
            const pubkey = String(member.user?.pubkey || '').trim();
            if (!pubkey) continue;
            const name = String(
                member.effectiveDisplayName
                || member.circleAlias
                || member.globalDisplayName
                || member.user?.displayName
                || member.globalHandle
                || member.user?.handle
                || '',
            ).trim();
            if (name) map.set(pubkey, name);
        }
        return map;
    }, [circleMembers]);

    const editorComments = useMemo(() => {
        const comments = draftCommentsData?.draftComments || [];
        return [...comments]
            .sort((a, b) => new Date(a.createdAt).getTime() - new Date(b.createdAt).getTime())
            .flatMap((comment) => {
                const paragraphIndex = parseLineRefToParagraphIndex(comment.lineRef, null);
                if (paragraphIndex === null) return [];
                const author = memberDisplayNameByPubkey.get(comment.user.pubkey)
                    || comment.user.displayName
                    || comment.user.handle
                    || t('fallback.unknownMember');
                return [{
                    id: String(comment.id),
                    author,
                    text: comment.content,
                    paragraphIndex,
                    createdAt: timeAgo(comment.createdAt, locale),
                }];
            });
    }, [draftCommentsData, locale, memberDisplayNameByPubkey, t]);

    const commentContributors = useMemo(() => {
        const unique = new Set(editorComments.map((comment) => comment.author).filter(Boolean));
        return Array.from(unique);
    }, [editorComments]);

    const targetHeat = selectedDraftSummary?.heat ?? 40;
    useEffect(() => {
        setDisplayHeat(Math.max(0, targetHeat));
    }, [targetHeat]);

    useEffect(() => {
        if (!requestedDraftId || !Number.isFinite(requestedDraftId)) return;
        const requestedDraftKey = String(requestedDraftId);
        if (selectedDraft !== requestedDraftKey) {
            setSelectedDraft(requestedDraftKey);
        }
        onRequestedDraftHandled?.();
    }, [onRequestedDraftHandled, requestedDraftId, selectedDraft]);

    useEffect(() => {
        if (!selectedDraftPostId || !Number.isFinite(selectedDraftPostId)) {
            setDiscussionThreads([]);
            setDiscussionError(null);
            setDiscussionLoading(false);
            setDiscussionBusy(false);
            setDraftLifecycleSnapshot(null);
            setDraftLifecycleError(null);
            setDraftLifecycleLoading(false);
            return;
        }

        void syncDraftDiscussionSurface();
    }, [selectedDraftPostId, setDraftLifecycleSnapshot, syncDraftDiscussionSurface]);

    useEffect(() => {
        if (!selectedDraftPostId || !Number.isFinite(selectedDraftPostId)) return;

        const intervalId = window.setInterval(() => {
            if (document.visibilityState !== 'visible') return;
            if (discussionBusy) return;
            void syncDraftDiscussionSurface();
        }, 15000);

        return () => {
            window.clearInterval(intervalId);
        };
    }, [discussionBusy, selectedDraftPostId, syncDraftDiscussionSurface]);

    useEffect(() => {
        if (!selectedDraftPostId || !Number.isFinite(selectedDraftPostId)) {
            draftContentLoadRequestRef.current += 1;
            loadedDraftContentPostIdRef.current = null;
            setSelectedDraftContent('');
            setSelectedDraftTitle('');
            setDraftTitleInput('');
            setSelectedDraftContentReady(false);
            setSelectedParagraphIndex(null);
            autosaveTextRef.current = '';
            hasUnsavedDraftRef.current = false;
            pendingDraftEditScopeRef.current = null;
            activeEditingBlockIdRef.current = null;
            handledRemoteSavedSignalRef.current = null;
            setDraftRemoteUpdateConflict(null);
            setSelectedDraftWorkingCopyHash(null);
            setDraftParagraphDeleteBlockedBy([]);
            setDraftDocumentEditAllowed(false);
            setDraftScopedPermissions(null);
            return;
        }

        if (loadedDraftContentPostIdRef.current === selectedDraftPostId) {
            return;
        }

        let cancelled = false;
        const requestId = draftContentLoadRequestRef.current + 1;
        draftContentLoadRequestRef.current = requestId;
        setSelectedDraftContent('');
        setSelectedDraftTitle('');
        setDraftTitleInput('');
        setSelectedDraftContentReady(false);
        setSelectedParagraphIndex(null);
        autosaveTextRef.current = '';
        hasUnsavedDraftRef.current = false;
        pendingDraftEditScopeRef.current = null;
        activeEditingBlockIdRef.current = null;
        handledRemoteSavedSignalRef.current = null;
        setDraftRemoteUpdateConflict(null);
        setSelectedDraftWorkingCopyHash(null);
        setDraftParagraphDeleteBlockedBy([]);
        setDraftDocumentEditAllowed(false);
        setDraftScopedPermissions(null);

        const fetchDraftContent = async () => {
            try {
                const discussionAccessToken = await resolveDiscussionAccessToken();
                if (cancelled || draftContentLoadRequestRef.current !== requestId) return;
                const payload = await fetchDiscussionDraftContent(selectedDraftPostId, { discussionAccessToken });
                if (!cancelled && draftContentLoadRequestRef.current === requestId) {
                    const nextText = payload?.text ?? '';
                    autosaveTextRef.current = nextText;
                    hasUnsavedDraftRef.current = false;
                    setSelectedDraftContent(nextText);
                    const nextTitle = payload?.title || selectedDraftSummary?.title || t('fallback.untitledDraft');
                    setSelectedDraftTitle(nextTitle);
                    setDraftTitleInput(nextTitle);
                    setSelectedDraftWorkingCopyHash(payload?.workingCopyHash ?? null);
                    setDraftParagraphDeleteBlockedBy(payload?.paragraphStructure.deleteBlockedBy ?? []);
                    setDraftDocumentEditAllowed(payload?.paragraphStructure.canEditDocument === true);
                    setDraftScopedPermissions(payload?.scopedPermissions ?? null);
                    loadedDraftContentPostIdRef.current = selectedDraftPostId;
                    if (typeof payload?.heatScore === 'number') {
                        setDisplayHeat(Math.max(0, payload.heatScore));
                    }
                }
            } catch (error) {
                console.warn('load draft content failed:', error);
                if (!cancelled && draftContentLoadRequestRef.current === requestId) {
                    autosaveTextRef.current = '';
                    hasUnsavedDraftRef.current = false;
                    setSelectedDraftContent('');
                }
            } finally {
                if (!cancelled && draftContentLoadRequestRef.current === requestId) {
                    setSelectedDraftContentReady(true);
                }
            }
        };

        void fetchDraftContent();
        return () => {
            cancelled = true;
        };
    }, [resolveDiscussionAccessToken, selectedDraftPostId, selectedDraftSummary?.title, t]);

    const handleEditingBlockChange = useCallback((blockId: string | null) => {
        activeEditingBlockIdRef.current = blockId;
        setEditingBlockId(blockId);
    }, [setEditingBlockId]);

    useEffect(() => {
        if (!latestRemoteSavedSignal || !selectedDraft || !selectedDraftPostId) return;
        if (latestRemoteSavedSignal.draftId !== selectedDraft) return;
        const signalKey = resolveDraftSavedSignalKey(latestRemoteSavedSignal);
        if (handledRemoteSavedSignalRef.current === signalKey) return;
        handledRemoteSavedSignalRef.current = signalKey;

        const currentHash =
            selectedDraftWorkingCopyHash
            || draftLifecycleRef.current?.workingCopy?.workingCopyHash
            || null;
        if (
            latestRemoteSavedSignal.workingCopyHash
            && currentHash
            && latestRemoteSavedSignal.workingCopyHash === currentHash
        ) {
            return;
        }

        const documentStatus = draftLifecycleRef.current?.documentStatus || draftLifecycle?.documentStatus || null;
        const hasLocalDraftWork = hasUnsavedDraftRef.current || Boolean(activeEditingBlockIdRef.current);
        if (hasLocalDraftWork && canPreserveLocalDraftWork(documentStatus)) {
            setDraftRemoteUpdateConflict({
                workingCopyHash: latestRemoteSavedSignal.workingCopyHash,
                updatedAt: latestRemoteSavedSignal.updatedAt,
                source: 'remote_signal',
            });
            return;
        }
        if (hasLocalDraftWork) {
            hasUnsavedDraftRef.current = false;
            pendingDraftEditScopeRef.current = null;
            activeEditingBlockIdRef.current = null;
            setEditingBlockId(null);
        }

        void refreshSelectedDraftWorkingCopy({
            replaceLiveDoc: true,
            conflictSource: 'remote_signal',
        });
    }, [
        draftLifecycle?.documentStatus,
        latestRemoteSavedSignal,
        refreshSelectedDraftWorkingCopy,
        selectedDraft,
        selectedDraftPostId,
        selectedDraftWorkingCopyHash,
        setEditingBlockId,
    ]);

    const handleRefreshRemoteDraft = useCallback(async () => {
        const confirmed = await requestConfirmation({
            title: t('confirm.refreshLatestTitle'),
            description: t('collaboration.confirmRefreshLatest'),
            confirmLabel: t('confirm.refresh'),
        });
        if (!confirmed) return;
        await refreshSelectedDraftWorkingCopy({
            forceReplace: true,
            replaceLiveDoc: true,
            conflictSource: draftRemoteUpdateConflict?.source || 'remote_signal',
        });
    }, [draftRemoteUpdateConflict?.source, refreshSelectedDraftWorkingCopy, requestConfirmation, t]);

    const handleKeepLocalDraft = useCallback(() => {
        if (!canPreserveLocalDraftWork(draftLifecycleRef.current?.documentStatus || draftLifecycle?.documentStatus || null)) {
            hasUnsavedDraftRef.current = false;
            pendingDraftEditScopeRef.current = null;
            activeEditingBlockIdRef.current = null;
            setEditingBlockId(null);
        }
        setDraftRemoteUpdateConflict(null);
    }, [draftLifecycle?.documentStatus, setEditingBlockId]);

    useEffect(() => {
        if (selectedParagraphIndex === null) return;
        const exists = paragraphOptions.some((option) => option.index === selectedParagraphIndex);
        if (!exists) {
            setSelectedParagraphIndex(null);
        }
    }, [paragraphOptions, selectedParagraphIndex]);

    const handleApplyAcceptedIssues = useCallback(async (input: {
        threadIds: string[];
        reason?: string;
    }) => {
        const uniqueThreadIds = Array.from(new Set(input.threadIds.filter(Boolean)));
        if (uniqueThreadIds.length === 0) return;
        if (!selectedDraftPostId || !Number.isFinite(selectedDraftPostId)) {
            throw new Error(t('errors.missingDraftContextForApplyAcceptedIssues'));
        }

        setDiscussionBusy(true);
        setDiscussionError(null);
        try {
            await flushDraftBeforeWorkflowAction({
                postId: selectedDraftPostId,
                emptyMessage: t('errors.applyAcceptedIssuesRequiresBody'),
                allowLockedRead: true,
            });

            for (const threadId of uniqueThreadIds) {
                const payload = await applyDraftDiscussion({
                    draftPostId: selectedDraftPostId,
                    threadId,
                    reason: input.reason,
                });
                upsertDiscussionThread(payload.thread);
            }

            await syncDraftDiscussionSurface();
        } catch (error) {
            const message = error instanceof Error ? error.message : t('errors.applyAcceptedIssues');
            setDiscussionError(message);
            throw error;
        } finally {
            setDiscussionBusy(false);
        }
    }, [
        flushDraftBeforeWorkflowAction,
        selectedDraftPostId,
        syncDraftDiscussionSurface,
        t,
        upsertDiscussionThread,
    ]);

    const handleGoToParagraphIssue = useCallback((paragraphIndex: number, threadId: string) => {
        if (!Number.isFinite(paragraphIndex) || paragraphIndex < 0 || !threadId) return;
        setSelectedParagraphIndex(paragraphIndex);
        setGhostDraftDefaultIssueCarrySelections((prev) => {
            const current = prev[paragraphIndex] || [];
            return {
                ...prev,
                [paragraphIndex]: current.includes(threadId) ? current : [...current, threadId],
            };
        });
        setParagraphIssueEditRequest({
            token: Date.now(),
            paragraphIndex,
            issueThreadId: threadId,
        });
        window.requestAnimationFrame(() => {
            editorPrimaryRef.current?.scrollIntoView({
                block: 'start',
                behavior: 'smooth',
            });
        });
    }, []);

    const resolveParagraphEditScope = useCallback((metadata?: {
        blockId: string;
        paragraphIndex: number;
    }): SaveDraftContentOptions['editScope'] | null => {
        if (!metadata?.blockId || canEditWorkingCopy) return null;
        const permissionSources = draftScopedPermissions?.permissionSourcesByBlockId?.[metadata.blockId] || [];
        const scopedEditable = permissionSources.includes('source_participant')
            || permissionSources.includes('temporary_grant');
        if (!scopedEditable) return null;
        const baseWorkingCopyHash =
            selectedDraftWorkingCopyHash
            || draftLifecycle?.workingCopy.workingCopyHash
            || null;
        return {
            type: 'paragraph',
            blockId: metadata.blockId,
            baseWorkingCopyHash,
        };
    }, [
        canEditWorkingCopy,
        draftLifecycle?.workingCopy.workingCopyHash,
        draftScopedPermissions?.permissionSourcesByBlockId,
        selectedDraftWorkingCopyHash,
    ]);

    const handleEdit = useCallback((content: string, metadata?: {
        blockId: string;
        paragraphIndex: number;
    }) => {
        autosaveTextRef.current = content;
        hasUnsavedDraftRef.current = true;
        setSelectedDraftContent(content);
        if (!content.trim()) {
            showNotice('error', t('errors.cannotDeleteLastParagraph'));
        }
        const editScope = resolveParagraphEditScope(metadata);
        pendingDraftEditScopeRef.current = editScope;

        if (!selectedDraftPostId || !Number.isFinite(selectedDraftPostId)) {
            return;
        }

        if (autosaveTimerRef.current !== null) {
            window.clearTimeout(autosaveTimerRef.current);
        }
        const draftingDeadlineRemainingMs = draftLifecycle?.draftingEndsAt
            ? new Date(draftLifecycle.draftingEndsAt).getTime() - Date.now()
            : Number.NaN;
        const isNearDraftingDeadline = draftLifecycle?.documentStatus === 'drafting'
            && Number.isFinite(draftingDeadlineRemainingMs)
            && draftingDeadlineRemainingMs > 0
            && draftingDeadlineRemainingMs <= 5000;
        if (isNearDraftingDeadline) {
            void saveDraftContent(selectedDraftPostId, content, {
                surfaceErrors: false,
                editScope,
            });
            return;
        }
        autosaveTimerRef.current = window.setTimeout(() => {
            autosaveTimerRef.current = null;
            void saveDraftContent(selectedDraftPostId, autosaveTextRef.current, {
                surfaceErrors: false,
                editScope: pendingDraftEditScopeRef.current,
            });
        }, 1200);
    }, [
        draftLifecycle?.documentStatus,
        draftLifecycle?.draftingEndsAt,
        resolveParagraphEditScope,
        saveDraftContent,
        selectedDraftPostId,
        showNotice,
        t,
    ]);

    const handleComment = useCallback(async (paragraphIndex: number, text: string) => {
        if (!selectedDraftPostId || !Number.isFinite(selectedDraftPostId)) return;

        try {
            await addDraftComment({
                variables: {
                    postId: selectedDraftPostId,
                    content: text.trim(),
                    lineRef: `paragraph:${Math.max(0, paragraphIndex)}`,
                },
            });
            await refetchDraftComments();
            try {
                const discussionAccessToken = await resolveDiscussionAccessToken();
                const heatPayload = await fetchDiscussionDraftContent(selectedDraftPostId, { discussionAccessToken });
                if (typeof heatPayload?.heatScore === 'number') {
                    setDisplayHeat(Math.max(0, heatPayload.heatScore));
                }
            } catch (error) {
                console.warn('refresh draft heat failed:', error);
            }
        } catch (error) {
            console.warn('add draft comment failed:', error);
            showNotice('error', t('errors.sendComment'));
        }
    }, [addDraftComment, refetchDraftComments, resolveDiscussionAccessToken, selectedDraftPostId, showNotice, t]);

    const handleDeleteParagraph = useCallback(async (paragraphIndex: number) => {
        if (!selectedDraftPostId || !Number.isFinite(selectedDraftPostId)) return;
        if (!canEditWorkingCopy) {
            showNotice('error', t('errors.deleteParagraph'));
            return;
        }
        const result = removeCrucibleParagraphContent(selectedDraftContent, paragraphIndex);
        if (!result.ok) {
            showNotice(
                'error',
                result.code === 'last_paragraph' || result.code === 'empty_result'
                    ? t('errors.cannotDeleteLastParagraph')
                    : t('errors.deleteParagraph'),
            );
            return;
        }
        const confirmed = await requestConfirmation({
            title: t('confirm.deleteParagraphTitle'),
            description: t('confirm.confirmDeleteParagraph'),
            confirmLabel: t('confirm.delete'),
            tone: 'danger',
        });
        if (!confirmed) return;

        try {
            const workingCopyHash =
                selectedDraftWorkingCopyHash
                || draftLifecycle?.workingCopy.workingCopyHash
                || null;
            const payload = await saveDraftContent(selectedDraftPostId, result.content, {
                surfaceErrors: true,
                workingCopyHash,
                paragraphDelete: { index: paragraphIndex },
            });
            if (!payload) return;
            await refreshDraftCommentsSafely();
            autosaveTextRef.current = result.content;
            hasUnsavedDraftRef.current = false;
            pendingDraftEditScopeRef.current = null;
            setSelectedDraftContent(result.content);
            setSelectedParagraphIndex(null);
            showNotice('success', t('notices.deleteParagraphSuccess'));
        } catch (error) {
            console.warn('delete draft paragraph failed:', error);
            showNotice('error', error instanceof Error ? error.message : t('errors.deleteParagraph'));
        }
    }, [
        canEditWorkingCopy,
        draftLifecycle?.workingCopy.workingCopyHash,
        requestConfirmation,
        refreshDraftCommentsSafely,
        saveDraftContent,
        selectedDraftContent,
        selectedDraftPostId,
        selectedDraftWorkingCopyHash,
        showNotice,
        t,
    ]);

    const requestTemporaryEditGrant = useCallback(async (input: {
        blockId: string;
    }) => {
        if (!selectedDraftPostId || !Number.isFinite(selectedDraftPostId)) return;
        const workingCopyHash = selectedDraftWorkingCopyHash || draftLifecycle?.workingCopy.workingCopyHash || null;
        if (!workingCopyHash) {
            setTemporaryEditGrantError(t('errors.saveDraftMissingBaseHash'));
            return;
        }
        setTemporaryEditGrantBusy(true);
        setTemporaryEditGrantError(null);
        try {
            await requestTemporaryEditGrantForDraft(
                selectedDraftPostId,
                { blockId: input.blockId, workingCopyHash },
                t('errors.requestTemporaryEditGrant'),
            );
            await loadTemporaryEditGrants();
            setDraftParagraphDeleteBlockedBy((current) => current.includes('temporary_edit_grant')
                ? current
                : [...current, 'temporary_edit_grant']);
            setNotice({
                type: 'success',
                text: t('notices.requestTemporaryEditGrantSuccess'),
            });
        } catch (error) {
            const message = error instanceof Error ? error.message : t('errors.requestTemporaryEditGrant');
            setTemporaryEditGrantError(message);
            setNotice({
                type: 'error',
                text: message,
            });
        } finally {
            setTemporaryEditGrantBusy(false);
        }
    }, [draftLifecycle?.workingCopy.workingCopyHash, loadTemporaryEditGrants, selectedDraftPostId, selectedDraftWorkingCopyHash, t]);

    const issueTemporaryEditGrant = useCallback(async (input: {
        grantId: string;
    }) => {
        setTemporaryEditGrantBusy(true);
        setTemporaryEditGrantError(null);
        try {
            await issueTemporaryEditGrantRequest(
                input.grantId,
                { expiresInMinutes: 60 },
                t('errors.issueTemporaryEditGrant'),
            );
            await loadTemporaryEditGrants();
            setNotice({
                type: 'success',
                text: t('notices.issueTemporaryEditGrantSuccess'),
            });
        } catch (error) {
            const message = error instanceof Error ? error.message : t('errors.issueTemporaryEditGrant');
            setTemporaryEditGrantError(message);
            setNotice({
                type: 'error',
                text: message,
            });
        } finally {
            setTemporaryEditGrantBusy(false);
        }
    }, [loadTemporaryEditGrants, t]);

    const revokeTemporaryEditGrant = useCallback(async (input: {
        grantId: string;
    }) => {
        setTemporaryEditGrantBusy(true);
        setTemporaryEditGrantError(null);
        try {
            await revokeTemporaryEditGrantRequest(input.grantId, t('errors.revokeTemporaryEditGrant'));
            await loadTemporaryEditGrants();
            setNotice({
                type: 'success',
                text: t('notices.revokeTemporaryEditGrantSuccess'),
            });
        } catch (error) {
            const message = error instanceof Error ? error.message : t('errors.revokeTemporaryEditGrant');
            setTemporaryEditGrantError(message);
            setNotice({
                type: 'error',
                text: message,
            });
        } finally {
            setTemporaryEditGrantBusy(false);
        }
    }, [loadTemporaryEditGrants, t]);

    const handleExecuteCrystallization = useCallback(async () => {
        if (
            !selectedDraftPostId
            || !Number.isFinite(selectedDraftPostId)
            || !discussionCapabilities.canCrystallize
        ) return;

        setDraftLifecycleError(null);
        try {
            const latestDraftText = await flushDraftBeforeWorkflowAction({
                postId: selectedDraftPostId,
                emptyMessage: t('errors.crystallizeRequiresBody'),
                allowLockedRead: true,
            });
            const result = await crystallizeDraft({ content: latestDraftText });
            if (result) {
                try {
                    await onCrystallizationComplete?.();
                } catch (refreshError) {
                    console.warn('[CrucibleTab] refresh after crystallization failed', refreshError);
                }
            }
        } catch (error) {
            const message = error instanceof Error ? error.message : t('errors.executeCrystallization');
            setDraftLifecycleError(message);
            setNotice({
                type: 'error',
                text: message,
            });
        } finally {
            await Promise.all([
                refreshDraftLifecycle(),
                refreshDraftDiscussions(),
            ]);
        }
    }, [
        crystallizeDraft,
        discussionCapabilities.canCrystallize,
        flushDraftBeforeWorkflowAction,
        refreshDraftDiscussions,
        refreshDraftLifecycle,
        onCrystallizationComplete,
        selectedDraftPostId,
        t,
    ]);

    const activeNotice = crystallizeNotice || notice;
    const draftReferenceSurface = useMemo(
        () => deriveDraftReferenceSurface({
            isSeededCircle: genesisMode === 'SEEDED',
            referenceLinks: draftReferenceLinks,
            seededFileTree,
        }),
        [draftReferenceLinks, genesisMode, seededFileTree],
    );
    const seededDraftListSurface = useMemo(() => ({
        showPanel: genesisMode === 'SEEDED',
        showFormalReferenceSummary: false,
        showSeededEvidence: genesisMode === 'SEEDED',
        showAiSourceMaterials: false,
        formalReferenceCount: 0,
        formalReferenceNames: [],
    }), [genesisMode]);
    const acceptedIssueRevisionSourceMaterialIds = useMemo(
        () => sourceMaterials
            .filter((material) => material.status === 'ai_readable')
            .map((material) => material.id)
            .filter((value) => Number.isFinite(value) && value > 0),
        [sourceMaterials],
    );
    const acceptedIssueRevision = useAcceptedIssueRevisionAssist({
        postId: selectedDraftPostId,
        workingCopyHash: draftLifecycle?.workingCopy.workingCopyHash || selectedDraftWorkingCopyHash,
        workingCopyUpdatedAt: draftLifecycle?.workingCopy.updatedAt || null,
        copy: {
            errors: {
                missingDraftContext: editorT('acceptedIssueRevision.errors.missingDraftContext'),
                missingArtifact: editorT('acceptedIssueRevision.errors.missingArtifact'),
                missingContent: editorT('acceptedIssueRevision.errors.missingContent'),
                missingSuggestion: editorT('acceptedIssueRevision.errors.missingSuggestion'),
                generateFailed: editorT('acceptedIssueRevision.errors.generate'),
                applyFailed: editorT('acceptedIssueRevision.errors.apply'),
                staleWorkingCopy: editorT('acceptedIssueRevision.errors.staleWorkingCopy'),
            },
        },
        onApplied: handleAcceptedIssueRevisionApplied,
    });
    const handleGenerateAcceptedIssueRevision = useCallback(async (input: {
        paragraphIndex: number;
        threadIds: string[];
        targetRef: string;
    }) => {
        if (
            draftLifecycle?.documentStatus !== 'drafting'
            || !selectedDraftPostId
            || !Number.isFinite(selectedDraftPostId)
        ) {
            throw new Error(editorT('acceptedIssueRevision.errors.notDrafting'));
        }
        const threadIds = input.threadIds
            .map((threadId) => String(threadId || '').trim())
            .filter(Boolean);
        if (threadIds.length === 0) {
            throw new Error(editorT('acceptedIssueRevision.errors.missingSuggestion'));
        }
        setAcceptedIssueRevisionParagraphIndex(input.paragraphIndex);
        await acceptedIssueRevision.generateAcceptedIssueRevision({
            threadIds,
            targetRef: input.targetRef,
            seededReference: selectedSeededReference,
            sourceMaterialIds: acceptedIssueRevisionSourceMaterialIds,
        });
    }, [
        acceptedIssueRevision,
        acceptedIssueRevisionSourceMaterialIds,
        draftLifecycle?.documentStatus,
        editorT,
        selectedDraftPostId,
        selectedSeededReference,
    ]);
    const handleApplyAcceptedIssueRevision = useCallback(async (
        suggestion: AcceptedIssueRevisionSuggestionView,
    ) => {
        const payload = await acceptedIssueRevision.applyAcceptedIssueRevision(suggestion);
        if (payload?.applied) {
            setAcceptedIssueRevisionParagraphIndex(null);
        }
    }, [acceptedIssueRevision]);
    const handleIgnoreAcceptedIssueRevision = useCallback(() => {
        acceptedIssueRevision.ignore();
        setAcceptedIssueRevisionParagraphIndex(null);
    }, [acceptedIssueRevision]);
    const canRequestTemporaryEditGrant = Boolean(
        selectedDraftPostId
        && Number.isFinite(selectedDraftPostId)
        && discussionViewerUserId
        && draftLifecycle?.documentStatus === 'drafting',
    ) && !temporaryEditGrantBusy;
    const canManageTemporaryEditGrants = Boolean(
        draftLifecycle?.documentStatus === 'drafting'
        && (
            viewerMembership?.role === 'Owner'
            || viewerMembership?.role === 'Admin'
            || viewerMembership?.role === 'Moderator'
        ),
    ) && !temporaryEditGrantBusy;
    const pendingGovernedRevisionDirections = useMemo(
        () => revisionDirections.filter((proposal) => (
            proposal.acceptanceMode === 'governance_request'
            && proposal.status === 'open'
            && proposal.draftPostId === selectedDraftPostId
            && Boolean(proposal.governanceRequestId)
            && proposal.draftVersion === draftLifecycle?.stableSnapshot.draftVersion
        )),
        [draftLifecycle?.stableSnapshot.draftVersion, revisionDirections, selectedDraftPostId],
    );
    const governedRevisionDirectionOutcome = useMemo(() => {
        const receipt = draftLifecycle?.stableSnapshot.crystallizationRoutingReceipt;
        if (!receipt || receipt.path !== 'governed_case') return null;
        return revisionDirections.find((proposal) => (
            proposal.revisionProposalId === receipt.targetRef
            && proposal.governanceRequestId === receipt.requestId
            && proposal.draftVersion === receipt.draftVersion
        )) ?? null;
    }, [draftLifecycle?.stableSnapshot.crystallizationRoutingReceipt, revisionDirections]);
    const governanceSummary = useMemo(() => {
        if (!draftLifecycle) return null;
        return buildCrucibleGovernanceSummary({
            lifecycle: draftLifecycle,
            threads: discussionThreads,
            canCreate: discussionCapabilities.canCreate,
            canResolve: discussionCapabilities.canStartReview || discussionCapabilities.canResolve,
            canApply: discussionCapabilities.canApply,
            canCrystallize: discussionCapabilities.canCrystallize,
        }, {
            locale,
            copy: {
                actionLabel: (status) => {
                    if (status === 'drafting') return discussionT('governance.actions.drafting');
                    if (status === 'review') return discussionT('governance.actions.review');
                    if (status === 'crystallization_active') return discussionT('governance.actions.crystallizationActive');
                    if (status === 'crystallization_failed') return discussionT('governance.actions.crystallizationFailed');
                    if (status === 'crystallized') return discussionT('governance.actions.crystallized');
                    if (status === 'archived') return discussionT('governance.actions.archived');
                    return discussionT('governance.actions.default');
                },
                targetVersion: (version) => discussionT('governance.values.targetVersion', { version }),
                statusLabel: (status) => {
                    if (status === 'drafting') return lifecycleT('status.drafting');
                    if (status === 'review') return lifecycleT('status.review');
                    if (status === 'crystallization_active') return lifecycleT('status.crystallizationActive');
                    if (status === 'crystallization_failed') return lifecycleT('status.crystallizationFailed');
                    if (status === 'crystallized') return lifecycleT('status.crystallized');
                    if (status === 'archived') return lifecycleT('status.archived');
                    return lifecycleT('status.inProgress');
                },
                capabilities: {
                    create: discussionT('governance.capabilities.create'),
                    resolve: discussionT('governance.capabilities.resolve'),
                    apply: discussionT('governance.capabilities.apply'),
                    crystallize: discussionT('governance.capabilities.crystallize'),
                    viewOnly: discussionT('governance.viewOnly'),
                },
                audit: {
                    pending: lifecycleT('meta.latestUpdatePending'),
                    updated: (date) => lifecycleT('meta.updated', { date }),
                },
                progress: {
                    submitted: discussionT('governance.progress.submitted'),
                    inReview: discussionT('governance.progress.inReview'),
                    accepted: discussionT('governance.progress.accepted'),
                    resolved: discussionT('governance.progress.resolved'),
                },
            },
        });
    }, [
        discussionCapabilities.canApply,
        discussionCapabilities.canCreate,
        discussionCapabilities.canCrystallize,
        discussionCapabilities.canResolve,
        discussionCapabilities.canStartReview,
        discussionThreads,
        draftLifecycle,
        discussionT,
        lifecycleT,
        locale,
    ]);
    const paragraphBlocks = useMemo(() => {
        if (!draftLifecycle || !selectedDraftContentReady) return [];
        return buildCrucibleParagraphBlocks({
            content: selectedDraftContent,
            lifecycle: draftLifecycle,
            threads: discussionThreads,
            selectedParagraphIndex,
            canEditWorkingCopy,
            permissionSourcesByBlockId: draftScopedPermissions?.permissionSourcesByBlockId,
        }, {
            copy: {
                title: (index) => editorT('blocks.title', { index }),
                typeLabel: editorT('blocks.typeLabel'),
                sourceVersion: (version) => editorT('blocks.sourceVersion', { version }),
                status: {
                    locked: editorT('blocks.statusLocked'),
                    resolved: editorT('blocks.statusResolved'),
                    acceptedPending: editorT('blocks.statusAcceptedPending'),
                    inReview: editorT('blocks.statusInReview'),
                    submitted: editorT('blocks.statusSubmitted'),
                    ready: editorT('blocks.statusReadyForMoreEdits'),
                },
                editability: {
                    locked: editorT('blocks.editabilityLocked'),
                    selected: editorT('blocks.editabilitySelected'),
                    editable: editorT('blocks.editabilityEditable'),
                    readOnly: editorT('blocks.editabilityReadOnly'),
                },
            },
        });
    }, [
        canEditWorkingCopy,
        discussionThreads,
        draftLifecycle,
        draftScopedPermissions?.permissionSourcesByBlockId,
        editorT,
        selectedDraftContent,
        selectedDraftContentReady,
        selectedParagraphIndex,
    ]);
    const editableParagraphIndices = useMemo(() => (
        paragraphBlocks
            .filter((block) => block.canEditParagraph)
            .map((block) => block.index)
    ), [paragraphBlocks]);
    const acceptedIssuesByParagraph = useMemo(
        () => buildCrucibleAcceptedIssuesByParagraph(discussionThreads, {
            paragraphCount: paragraphBlocks.length,
            copy: {
                emptySummary: discussionT('threads.emptySummary'),
            },
        }),
        [discussionThreads, discussionT, paragraphBlocks.length],
    );
    const acceptedIssueExceptions = useMemo(
        () => buildCrucibleAcceptedIssueExceptions(discussionThreads, {
            paragraphCount: paragraphBlocks.length,
            copy: {
                emptySummary: discussionT('threads.emptySummary'),
            },
        }),
        [discussionThreads, discussionT, paragraphBlocks.length],
    );
    const showEnterReviewAction = Boolean(
        draftLifecycle
        && draftLifecycle.documentStatus === 'drafting'
        && draftLifecycle.reviewEntryMode !== 'auto_only'
    );
    const canEnterReviewManually = Boolean(
        showEnterReviewAction && discussionCapabilities.canEndDraftingEarly,
    );
    const showAdvanceReviewAction = Boolean(
        draftLifecycle && draftLifecycle.documentStatus === 'review',
    );
    const hasReachedMaxRevisionRounds = Boolean(
        draftLifecycle
        && draftLifecycleTemplate
        && draftLifecycle.currentRound >= draftLifecycleTemplate.maxRevisionRounds,
    );
    const briefLock = draftLifecycle?.briefLock ?? null;
    const showBriefVersionDivergence = Boolean(
        requestedBoundDraftId
        && selectedDraftPostId === requestedBoundDraftId
        && requestedDraftVersion
        && draftLifecycle
        && draftLifecycle.currentSnapshotVersion !== requestedDraftVersion,
    );
    const advanceReviewDisabledReason = briefLock && briefLock.canReturnToDrafting === false
        ? t('disabled.briefLockedReturnToDrafting')
        : hasReachedMaxRevisionRounds
            ? t('disabled.maxRevisionRounds', {count: draftLifecycleTemplate?.maxRevisionRounds || 1})
            : discussionCapabilities.advanceFromReviewDisabledReason;
    const canAdvanceFromReview = Boolean(
        showAdvanceReviewAction
        && discussionCapabilities.canAdvanceFromReview
        && !hasReachedMaxRevisionRounds
        && briefLock?.canReturnToDrafting !== false,
    );
    const showEnterCrystallizationAction = Boolean(
        draftLifecycle
        && draftLifecycle.documentStatus === 'review'
        && !draftLifecycle.stableSnapshot.crystallizationRoutingReceipt,
    );
    const canEnterCrystallization = Boolean(
        showEnterCrystallizationAction
        && discussionCapabilities.canCrystallize
        && sdk
        && draftLifecycle?.policyProfileDigest
        && briefLock?.canCrystallize !== false,
    );
    const showRetryCrystallizationAction = Boolean(
        draftLifecycle && draftLifecycle.documentStatus === 'crystallization_failed',
    );
    const canRetryCrystallization = Boolean(
        showRetryCrystallizationAction
        && discussionCapabilities.canCrystallize
        && sdk
        && draftLifecycle?.policyProfileDigest
        && briefLock?.canCrystallize !== false,
    );
    const crystallizationAnchorDisabledReason = briefLock && briefLock.canCrystallize === false
        ? t('disabled.briefLockedCrystallize')
        : !sdk
            ? t('disabled.walletRequiredForCrystallization')
            : !draftLifecycle?.policyProfileDigest
                ? t('disabled.policyProfileRequiredForCrystallization')
                : discussionCapabilities.crystallizeDisabledReason;
    const retryCrystallizationAnchorDisabledReason = briefLock && briefLock.canCrystallize === false
        ? t('disabled.briefLockedCrystallize')
        : !sdk
            ? t('disabled.walletRequiredForCrystallization')
            : !draftLifecycle?.policyProfileDigest
                ? t('disabled.policyProfileRequiredForRetryCrystallization')
                : discussionCapabilities.crystallizeDisabledReason;
    const showRollbackCrystallizationAction = Boolean(
        draftLifecycle && draftLifecycle.documentStatus === 'crystallization_failed',
    );
    const canRollbackCrystallization = Boolean(
        showRollbackCrystallizationAction && discussionCapabilities.canAdvanceFromReview,
    );
    const showArchiveAction = Boolean(
        draftLifecycle
        && draftLifecycle.documentStatus !== 'archived'
        && draftLifecycle.documentStatus !== 'crystallized',
    );
    const canArchive = Boolean(
        showArchiveAction
        && discussionCapabilities.canAdvanceFromReview
        && sdk
        && draftLifecycle?.policyProfileDigest
        && briefLock?.canArchive !== false,
    );
    const archiveDisabledReason = briefLock && briefLock.canArchive === false
        ? t('disabled.briefLockedArchive')
        : !sdk
            ? t('disabled.walletRequiredForArchive')
            : !draftLifecycle?.policyProfileDigest
                ? t('disabled.policyProfileRequiredForArchive')
                : discussionCapabilities.advanceFromReviewDisabledReason;
    const showRestoreAction = Boolean(
        draftLifecycle && draftLifecycle.documentStatus === 'archived',
    );
    const canRestore = Boolean(
        showRestoreAction
        && discussionCapabilities.canAdvanceFromReview
        && sdk
        && draftLifecycle?.policyProfileDigest,
    );
    const restoreDisabledReason = !sdk
        ? t('disabled.walletRequiredForRestore')
        : !draftLifecycle?.policyProfileDigest
            ? t('disabled.policyProfileRequiredForRestore')
            : discussionCapabilities.advanceFromReviewDisabledReason;
    const showExecuteCrystallizationAction = Boolean(
        draftLifecycle && draftLifecycle.documentStatus === 'crystallization_active',
    );
    const canExecuteCrystallization = Boolean(
        showExecuteCrystallizationAction
        && discussionCapabilities.canCrystallize
        && sdk
        && selectedDraftContentReady
        && draftLifecycle?.stableSnapshot.crystallizationRoutingReceipt
    );
    const executeCrystallizationDisabledReason = !selectedDraftContentReady
        ? t('loading.draftContent')
        : !draftLifecycle?.stableSnapshot.crystallizationRoutingReceipt
            ? t('disabled.routingReceiptRequiredForCrystallization')
        : !sdk
            ? t('disabled.walletRequiredForCrystallization')
        : !discussionCapabilities.canCrystallize
            ? discussionCapabilities.crystallizeDisabledReason
            : null;

    useEffect(() => {
        setGhostDraftDefaultIssueCarrySelections({});
    }, [selectedDraftPostId]);

    useEffect(() => {
        return () => {
            if (autosaveTimerRef.current !== null) {
                window.clearTimeout(autosaveTimerRef.current);
                autosaveTimerRef.current = null;
            }
            clearNoticeTimer();
            confirmationResolveRef.current?.(false);
            confirmationResolveRef.current = null;
        };
    }, [clearNoticeTimer]);

    if (selectedDraft) {
        return (
            <div className={styles.editorContainer}>
                <button className={styles.editorBack} onClick={() => setSelectedDraft(null)}>
                    {t('actions.backToDraftList')}
                </button>
                <AnimatePresence>
                    {activeNotice && (
                        <motion.div
                            className={`${styles.crystallizeNotice} ${activeNotice.type === 'error' ? styles.crystallizeNoticeError : styles.crystallizeNoticeSuccess}`}
                            initial={{ opacity: 0, y: 8 }}
                            animate={{ opacity: 1, y: 0 }}
                            exit={{ opacity: 0, y: -6 }}
                            transition={{ duration: 0.2 }}
                            role="status"
                        >
                            {activeNotice.text}
                        </motion.div>
                    )}
                </AnimatePresence>
                {!selectedDraftContentReady && (
                    <div className={styles.crystallizeNotice} role="status">
                        {t('loading.draftContent')}
                    </div>
                )}
                {selectedDraftContentReady && (
                    <div className={styles.editorMainGrid}>
                        <section className={styles.editorPrimary} ref={editorPrimaryRef}>
                            {draftLifecycleLoading && !draftLifecycle && (
                                <div className={styles.crystallizeNotice} role="status">
                                    {t('loading.draftLifecycle')}
                                </div>
                            )}
                            {draftLifecycleError && (
                                <div className={`${styles.crystallizeNotice} ${styles.crystallizeNoticeError}`} role="status">
                                    {draftLifecycleError}
                                </div>
                            )}
                            {showBriefVersionDivergence && draftLifecycle && requestedDraftVersion ? (
                                <div className={styles.crystallizeNotice} role="status">
                                    {t('notices.briefVersionDiverged', {
                                        current: draftLifecycle.currentSnapshotVersion,
                                        bound: requestedDraftVersion,
                                    })}
                                </div>
                            ) : null}
                            {draftLifecycle && (
                                <CrucibleLifecycleHeader
                                    draftTitle={selectedDraftTitle || selectedDraftSummary?.title || t('fallback.untitledDraft')}
                                    titleAction={canEditWorkingCopy && !draftTitleEditing ? (
                                        <button
                                            type="button"
                                            className={styles.draftTitleEditAction}
                                            onClick={() => {
                                                setDraftTitleInput(
                                                    selectedDraftTitle
                                                    || selectedDraftSummary?.title
                                                    || t('fallback.untitledDraft'),
                                                );
                                                setDraftTitleEditing(true);
                                            }}
                                        >
                                            <Pencil size={13} aria-hidden="true" />
                                            <span>{t('editor.titleEdit')}</span>
                                        </button>
                                    ) : null}
                                    titleEditor={canEditWorkingCopy && draftTitleEditing ? (
                                        <form
                                            className={styles.draftTitleInlineEditor}
                                            onSubmit={(event) => {
                                                event.preventDefault();
                                                void handleSaveDraftTitle();
                                            }}
                                        >
                                            <label htmlFor="draft-document-title">{t('editor.titleLabel')}</label>
                                            <input
                                                id="draft-document-title"
                                                autoFocus
                                                value={draftTitleInput}
                                                maxLength={160}
                                                onChange={(event) => setDraftTitleInput(event.target.value)}
                                            />
                                            <div className={styles.draftTitleInlineActions}>
                                                <button
                                                    type="button"
                                                    onClick={() => {
                                                        setDraftTitleInput(selectedDraftTitle);
                                                        setDraftTitleEditing(false);
                                                    }}
                                                    disabled={draftTitleBusy}
                                                >
                                                    {t('editor.titleCancel')}
                                                </button>
                                                <button
                                                    type="submit"
                                                    disabled={draftTitleBusy || !draftTitleInput.trim()}
                                                >
                                                    {draftTitleBusy ? t('editor.titleSaving') : t('editor.titleSave')}
                                                </button>
                                            </div>
                                        </form>
                                    ) : null}
                                    lifecycle={draftLifecycle}
                                    showEnterReviewAction={showEnterReviewAction}
                                    canEnterReviewManually={canEnterReviewManually}
                                    enterReviewDisabledReason={discussionCapabilities.endDraftingDisabledReason}
                                    enterReviewPending={draftLifecycleTransitionBusy}
                                    onEnterReview={handleEnterReview}
                                    showAdvanceReviewAction={showAdvanceReviewAction}
                                    canAdvanceFromReview={canAdvanceFromReview}
                                    advanceReviewDisabledReason={advanceReviewDisabledReason}
                                    advanceReviewPending={draftLifecycleTransitionBusy}
                                    onAdvanceReview={handleAdvanceReview}
                                    showEnterCrystallizationAction={showEnterCrystallizationAction}
                                    canEnterCrystallization={canEnterCrystallization}
                                    enterCrystallizationDisabledReason={crystallizationAnchorDisabledReason}
                                    enterCrystallizationPending={draftLifecycleTransitionBusy}
                                    onEnterCrystallization={handleEnterCrystallization}
                                    governedRoutingError={governedRoutingError}
                                    revisionDirectionsPending={revisionDirectionsLoading}
                                    pendingGovernedRevisionDirections={pendingGovernedRevisionDirections}
                                    governedRevisionDirectionOutcome={governedRevisionDirectionOutcome}
                                    showExecuteCrystallizationAction={showExecuteCrystallizationAction}
                                    canExecuteCrystallization={canExecuteCrystallization}
                                    executeCrystallizationDisabledReason={executeCrystallizationDisabledReason}
                                    executeCrystallizationPending={crystallizing}
                                    onExecuteCrystallization={handleExecuteCrystallization}
                                    showRetryCrystallizationAction={showRetryCrystallizationAction}
                                    canRetryCrystallization={canRetryCrystallization}
                                    retryCrystallizationDisabledReason={retryCrystallizationAnchorDisabledReason}
                                    retryCrystallizationPending={draftLifecycleTransitionBusy}
                                    onRetryCrystallization={handleRetryCrystallization}
                                    showRollbackCrystallizationAction={showRollbackCrystallizationAction}
                                    canRollbackCrystallization={canRollbackCrystallization}
                                    rollbackCrystallizationDisabledReason={discussionCapabilities.advanceFromReviewDisabledReason}
                                    rollbackCrystallizationPending={draftLifecycleTransitionBusy}
                                    onRollbackCrystallization={handleRollbackCrystallization}
                                    showArchiveAction={showArchiveAction}
                                    canArchive={canArchive}
                                    archiveDisabledReason={archiveDisabledReason}
                                    archivePending={draftLifecycleTransitionBusy}
                                    onArchive={handleArchiveDraft}
                                    showRestoreAction={showRestoreAction}
                                    canRestore={canRestore}
                                    restoreDisabledReason={restoreDisabledReason}
                                    restorePending={draftLifecycleTransitionBusy}
                                    onRestore={handleRestoreDraft}
                                />
                            )}
                            {draftLifecycle?.documentStatus === 'crystallization_active' && (
                                <section
                                    className={styles.publicationLicensePanel}
                                    aria-labelledby="knowledge-publication-license-title"
                                    data-testid="knowledge-publication-license-authorization"
                                >
                                    <div>
                                        <p className={styles.editorSectionEyebrow}>
                                            {t('crystallization.publicationLicense.eyebrow')}
                                        </p>
                                        <h3 id="knowledge-publication-license-title" className={styles.publicationLicenseTitle}>
                                            {t('crystallization.publicationLicense.title')}
                                        </h3>
                                        <p className={styles.publicationLicenseTerms}>
                                            {t('crystallization.publicationLicense.terms')}
                                        </p>
                                    </div>
                                    {currentPublicationLicense ? (
                                        <>
                                            <p className={styles.publicationLicenseStatus} role="status">
                                                {t('crystallization.publicationLicense.progress', {
                                                    accepted: currentPublicationLicense.acceptedContributorPubkeys.length,
                                                    total: currentPublicationLicense.authorization.contributorsCount,
                                                })}
                                            </p>
                                            {currentPublicationLicense.missingContributorPubkeys.length > 0 && (
                                                <p className={styles.publicationLicenseMissing}>
                                                    {t('crystallization.publicationLicense.missing', {
                                                        contributors: currentPublicationLicense.missingContributorPubkeys
                                                            .map((pubkey) => `${pubkey.slice(0, 5)}…${pubkey.slice(-4)}`)
                                                            .join(', '),
                                                    })}
                                                </p>
                                            )}
                                            {currentPublicationLicense.actorSigningEnvelope ? (
                                                <button
                                                    type="button"
                                                    className={styles.publicationLicenseAction}
                                                    disabled={publicationLicenseLoading}
                                                    onClick={() => void handleAcceptPublicationLicense()}
                                                >
                                                    {publicationLicenseLoading
                                                        ? t('crystallization.publicationLicense.accepting')
                                                        : t('crystallization.publicationLicense.accept')}
                                                </button>
                                            ) : (
                                                <p className={styles.publicationLicenseAccepted}>
                                                    {t('crystallization.publicationLicense.actorNoAction')}
                                                </p>
                                            )}
                                        </>
                                    ) : (
                                        <p className={styles.publicationLicenseStatus} role="status">
                                            {publicationLicenseLoading
                                                ? t('crystallization.publicationLicense.loading')
                                                : t('crystallization.publicationLicense.unavailable')}
                                        </p>
                                    )}
                                </section>
                            )}
                            {selectedDraftPostId && Number.isFinite(selectedDraftPostId) && (
                                <Link
                                    href={`/circles/${circleId}/drafts/${selectedDraftPostId}/contribution-trace`}
                                    className={styles.contributionTraceLink}
                                >
                                    {t('contributionAssessmentGate.traceLink')}
                                </Link>
                            )}
                            {draftRemoteUpdateConflict && (
                                <div className={styles.draftRemoteConflict} role="status">
                                    <div>
                                        <p className={styles.draftRemoteConflictTitle}>
                                            {t('collaboration.remoteUpdateTitle')}
                                        </p>
                                        <p className={styles.draftRemoteConflictBody}>
                                            {t('collaboration.remoteUpdateBody')}
                                        </p>
                                    </div>
                                    <div className={styles.draftRemoteConflictActions}>
                                        <button
                                            type="button"
                                            className={`${styles.draftRemoteConflictButton} ${styles.draftRemoteConflictPrimary}`}
                                            onClick={handleRefreshRemoteDraft}
                                        >
                                            {t('collaboration.refreshToLatest')}
                                        </button>
                                        <button
                                            type="button"
                                            className={styles.draftRemoteConflictButton}
                                            onClick={handleKeepLocalDraft}
                                        >
                                            {t('collaboration.keepMyEdits')}
                                        </button>
                                    </div>
                                </div>
                            )}
                            <div className={styles.editorSectionHeader}>
                                <div>
                                    <p className={styles.editorSectionEyebrow}>{t('editor.bodyEyebrow')}</p>
                                    <h3 className={styles.editorSectionTitle}>{t('editor.bodyTitle')}</h3>
                                </div>
                                <p className={styles.editorSectionHint}>
                                    {t('editor.bodyHint')}
                                </p>
                            </div>
                            {canEditWorkingCopy ? (
                                <div className={styles.documentEditorActions}>
                                    <button
                                        type="button"
                                        onClick={() => void handleOpenDocumentEditor()}
                                        disabled={documentEditorBusy || documentEditorOpen || !draftDocumentEditAllowed}
                                        title={!draftDocumentEditAllowed
                                            ? t('editor.documentEditBlocked')
                                            : undefined}
                                    >
                                        {documentEditorBusy && !documentEditorOpen
                                            ? t('editor.documentOpening')
                                            : t('editor.documentOpen')}
                                    </button>
                                </div>
                            ) : null}
                            {documentEditorOpen ? (
                                <form
                                    className={styles.documentEditor}
                                    onSubmit={(event) => {
                                        event.preventDefault();
                                        void handleSaveDocumentEditor();
                                    }}
                                >
                                    <label htmlFor="draft-whole-document">{t('editor.documentLabel')}</label>
                                    <p>{t('editor.documentHint')}</p>
                                    <textarea
                                        id="draft-whole-document"
                                        rows={22}
                                        value={documentEditorText}
                                        readOnly={!canEditWorkingCopy}
                                        onChange={(event) => setDocumentEditorText(event.target.value)}
                                    />
                                    <div>
                                        <button
                                            type="button"
                                            disabled={documentEditorBusy}
                                            onClick={() => {
                                                setDocumentEditorText(selectedDraftContent);
                                                setDocumentEditorOpen(false);
                                            }}
                                        >
                                            {t('editor.documentCancel')}
                                        </button>
                                        <button
                                            type="submit"
                                            disabled={!canEditWorkingCopy || documentEditorBusy || !documentEditorText.trim()}
                                        >
                                            {documentEditorBusy
                                                ? t('editor.documentSaving')
                                                : t('editor.documentSave')}
                                        </button>
                                    </div>
                                </form>
                            ) : (
                            <>
                            {canEditWorkingCopy && !draftDocumentEditAllowed ? (
                                <p className={styles.paragraphStructureNotice} role="status">
                                    {t('editor.documentEditBlocked')}
                                </p>
                            ) : null}
                            {canEditWorkingCopy && draftParagraphDeleteBlockedBy.length > 0 ? (
                                <p className={styles.paragraphStructureNotice} role="status">
                                    {t('editor.paragraphDeleteBlocked')}
                                </p>
                            ) : null}
                            <CrucibleEditor
                                ydoc={ydoc}
                                replaceRequest={ghostDraftReplaceRequest}
                                knowledgeReferenceOptions={knowledgeReferenceOptions}
                                insertReferenceRequest={insertReferenceRequest}
                                paragraphEditRequest={paragraphIssueEditRequest}
                                draft={{
                                    id: String(selectedDraftPostId || selectedDraftSummary?.id || 0),
                                    title: selectedDraftTitle || selectedDraftSummary?.title || t('fallback.untitledDraft'),
                                    content: selectedDraftContent,
                                    heat: displayHeat,
                                    editCount: selectedDraftEditCount,
                                    contributors: commentContributors,
                                }}
                                comments={editorComments}
                                onEdit={handleEdit}
                                onDeleteParagraph={canEditWorkingCopy ? handleDeleteParagraph : undefined}
                                canDeleteParagraph={draftParagraphDeleteBlockedBy.length === 0}
                                paragraphDeleteDisabledReason={draftParagraphDeleteBlockedBy.length > 0
                                    ? t('editor.paragraphDeleteBlocked')
                                    : null}
                                onComment={handleComment}
                                onEditingBlockChange={handleEditingBlockChange}
                                canEdit={canEditWorkingCopy}
                                canComment={canComment}
                                onSelectionParagraphChange={setSelectedParagraphIndex}
                                collabStatus={{
                                    isConnected,
                                    connectedUsers,
                                }}
                                activeEditorsByBlockId={activeEditorsByBlockId}
                                paragraphBlocks={paragraphBlocks}
                                selectedParagraphIndex={selectedParagraphIndex}
                                collaborationContentVersion={selectedDraftWorkingCopyHash || draftLifecycle?.workingCopy.workingCopyHash || null}
                                acceptedIssuesByParagraph={acceptedIssuesByParagraph}
                                acceptedIssueExceptions={acceptedIssueExceptions}
                                defaultIssueCarrySelections={ghostDraftDefaultIssueCarrySelections}
                                canApplyAcceptedIssues={discussionCapabilities.canApply}
                                onApplyAcceptedIssues={handleApplyAcceptedIssues}
                                acceptedIssueRevisionStatus={acceptedIssueRevision.status}
                                acceptedIssueRevisionCandidate={acceptedIssueRevision.candidate}
                                acceptedIssueRevisionError={acceptedIssueRevision.error}
                                acceptedIssueRevisionParagraphIndex={acceptedIssueRevisionParagraphIndex}
                                onGenerateAcceptedIssueRevision={handleGenerateAcceptedIssueRevision}
                                onApplyAcceptedIssueRevision={handleApplyAcceptedIssueRevision}
                                onIgnoreAcceptedIssueRevision={handleIgnoreAcceptedIssueRevision}
                                viewerUserId={discussionViewerUserId}
                                temporaryEditGrants={temporaryEditGrants}
                                canRequestTemporaryEditGrant={canRequestTemporaryEditGrant}
                                canManageTemporaryEditGrants={canManageTemporaryEditGrants}
                                temporaryEditGrantError={temporaryEditGrantError}
                                onRequestTemporaryEditGrant={requestTemporaryEditGrant}
                                onIssueTemporaryEditGrant={issueTemporaryEditGrant}
                                onRevokeTemporaryEditGrant={revokeTemporaryEditGrant}
                                onKnowledgeReferenceInserted={handleKnowledgeReferenceInserted}
                            />
                            {canEditWorkingCopy ? (
                                <section
                                    className={styles.appendParagraphSection}
                                    data-testid="append-paragraph-section"
                                    aria-label={t('editor.appendParagraph')}
                                >
                                    {!appendParagraphOpen ? (
                                        <button
                                            type="button"
                                            className={styles.appendParagraphTrigger}
                                            aria-expanded="false"
                                            onClick={() => setAppendParagraphOpen(true)}
                                        >
                                            <span className={styles.appendParagraphIcon} aria-hidden="true">
                                                <Plus size={18} />
                                            </span>
                                            <span className={styles.appendParagraphTriggerCopy}>
                                                <strong>{t('editor.appendParagraph')}</strong>
                                                <small>{t('editor.appendParagraphHint')}</small>
                                            </span>
                                        </button>
                                    ) : (
                                        <form
                                            className={styles.appendParagraphComposer}
                                            onSubmit={(event) => {
                                                event.preventDefault();
                                                void handleAppendParagraph();
                                            }}
                                        >
                                            <div className={styles.appendParagraphComposerHeader}>
                                                <div>
                                                    <span>{t('editor.appendParagraphLabel')}</span>
                                                    <strong>
                                                        {t('editor.appendParagraphBlockTitle', {
                                                            index: paragraphBlocks.length + 1,
                                                        })}
                                                    </strong>
                                                </div>
                                                <button
                                                    type="button"
                                                    onClick={() => {
                                                        setAppendParagraphText('');
                                                        setAppendParagraphOpen(false);
                                                    }}
                                                    disabled={appendParagraphBusy}
                                                >
                                                    {t('editor.appendParagraphCancel')}
                                                </button>
                                            </div>
                                            <textarea
                                                id="draft-append-paragraph"
                                                autoFocus
                                                aria-label={t('editor.appendParagraphLabel')}
                                                rows={5}
                                                value={appendParagraphText}
                                                placeholder={t('editor.appendParagraphPlaceholder')}
                                                onChange={(event) => setAppendParagraphText(
                                                    normalizeAppendParagraphText(event.target.value),
                                                )}
                                                onKeyDown={(event) => {
                                                    if (event.key === 'Enter' && !event.nativeEvent.isComposing) {
                                                        event.preventDefault();
                                                    }
                                                }}
                                            />
                                            <p className={styles.appendParagraphComposerHint}>
                                                {t('editor.appendParagraphSingleBlockHint')}
                                            </p>
                                            <div className={styles.appendParagraphComposerActions}>
                                                <button
                                                    type="submit"
                                                    disabled={appendParagraphBusy || !appendParagraphText.trim()}
                                                >
                                                    <Plus size={15} aria-hidden="true" />
                                                    {appendParagraphBusy
                                                        ? t('editor.appendParagraphSaving')
                                                        : t('editor.appendParagraphSave')}
                                                </button>
                                            </div>
                                        </form>
                                    )}
                                </section>
                            ) : null}
                            </>
                            )}
                        </section>
                        <section className={styles.editorAside}>
                            <SourceGroundedAskPanel
                                circleId={circleId}
                                draftPostId={selectedDraftPostId || null}
                                locale={locale}
                                compact
                                title={t('sourceAsk.title')}
                                description={t('sourceAsk.description')}
                                placeholder={t('sourceAsk.placeholder')}
                                scopeLabel={t('sourceAsk.scopeLabel')}
                                scopeLabels={draftSourceAskScopeLabels}
                                askLabel={t('sourceAsk.ask')}
                                askingLabel={t('sourceAsk.asking')}
                                refreshLabel={t('sourceAsk.refresh')}
                                refreshingLabel={t('sourceAsk.refreshing')}
                                defaultScopes={['current_draft']}
                                availableScopes={['current_draft', 'formal_references', 'source_materials']}
                            />
                            {selectedDraftPostId ? (
                                <NeutralEvaluationWorkspacePanel
                                    circleId={circleId}
                                    subjectType="draft_post"
                                    subjectId={selectedDraftPostId}
                                    locale={locale}
                                    compact
                                    title="Neutral draft evaluation"
                                />
                            ) : null}
                            <ReferencesPanel
                                surface={draftReferenceSurface}
                                referenceLinks={draftReferenceLinks}
                                knowledgeReferenceOptions={knowledgeReferenceOptions}
                                canInsertKnowledgeReference={genesisMode !== 'SEEDED' && canEditWorkingCopy && selectedParagraphIndex !== null}
                                onInsertReference={handleInsertKnowledgeReference}
                                referencesLoading={draftReferenceLinksLoading}
                                referencesError={draftReferenceLinksError}
                                seededFileTree={seededFileTree}
                                seededFileTreeLoading={seededFileTreeLoading}
                                seededFileTreeError={seededFileTreeError}
                                selectedSeededReference={selectedSeededReference}
                                onSelectSeededReference={setSelectedSeededReference}
                            />
                            <SourceMaterialsPanel
                                materials={sourceMaterials}
                                loading={sourceMaterialsLoading}
                                busy={sourceMaterialsUploading}
                                error={sourceMaterialsError}
                                canUpload={canEditWorkingCopy}
                                onUpload={handleUploadSourceMaterial}
                                onCaptureExternalUrl={handleCaptureExternalUrlSourceMaterial}
                                onOpenContent={handleOpenSourceMaterialContent}
                            />
                            <div className={styles.editorSectionHeader}>
                                <div>
                                    <p className={styles.editorSectionEyebrow}>{t('editor.discussionEyebrow')}</p>
                                    <h3 className={styles.editorSectionTitle}>{t('editor.discussionTitle')}</h3>
                                </div>
                                <p className={styles.editorSectionHint}>
                                    {t('editor.discussionHint')}
                                </p>
                            </div>
                            <DraftDiscussionPanel
                                draftPostId={selectedDraftPostId || 0}
                                threads={discussionThreads}
                                loading={discussionLoading}
                                busy={discussionBusy}
                                error={discussionError}
                                viewerUserId={discussionViewerUserId}
                                canCreate={discussionCapabilities.canCreate}
                                createDisabledReason={discussionCapabilities.createDisabledReason}
                                canFollowup={discussionCapabilities.canFollowup}
                                followupDisabledReason={discussionCapabilities.followupDisabledReason}
                                canWithdrawOwn={discussionCapabilities.canWithdraw}
                                withdrawDisabledReason={discussionCapabilities.withdrawDisabledReason}
                                canStartReview={discussionCapabilities.canStartReview}
                                reviewDisabledReason={discussionCapabilities.startReviewDisabledReason}
                                canRetag={discussionCapabilities.canRetag}
                                retagDisabledReason={discussionCapabilities.retagDisabledReason}
                                canResolve={discussionCapabilities.canResolve}
                                resolveDisabledReason={discussionCapabilities.resolveDisabledReason}
                                canApply={discussionCapabilities.canApply}
                                applyDisabledReason={discussionCapabilities.applyDisabledReason}
                                editableParagraphIndices={editableParagraphIndices}
                                reviewerPolicyLabel={draftDiscussionPolicyLabels.reviewerLabel}
                                applierPolicyLabel={draftDiscussionPolicyLabels.applierLabel}
                                followupPolicyLabel={draftDiscussionPolicyLabels.followupLabel}
                                onCreate={handleCreateDiscussion}
                                onPropose={handleProposeDiscussion}
                                onResolve={handleResolveDiscussion}
                                onReply={handleReplyDiscussion}
                                onWithdraw={handleWithdrawDiscussion}
                                onApply={handleApplyDiscussion}
                                onGoToParagraphIssue={handleGoToParagraphIssue}
                                paragraphOptions={paragraphOptions}
                                selectedParagraphIndex={selectedParagraphIndex}
                                onSelectParagraph={setSelectedParagraphIndex}
                                currentDraftVersion={discussionCurrentDraftVersion}
                                governanceSummary={governanceSummary}
                                selectedSeededReference={selectedSeededReference}
                                onSelectSeededReference={setSelectedSeededReference}
                            />
                        </section>
                    </div>
                )}
                <BottomSheet
                    open={Boolean(contributionGatePrompt)}
                    title={t('contributionAssessmentGate.title')}
                    closeLabel={t('confirm.close')}
                    onClose={() => resolveContributionGatePrompt(null)}
                >
                    <div className={styles.contributionGateBody}>
                        <p className={styles.contributionGateText}>
                            {t('contributionAssessmentGate.body')}
                        </p>
                        <dl className={styles.contributionGateMeta}>
                            <div>
                                <dt>{t('contributionAssessmentGate.statusLabel')}</dt>
                                <dd>{t('contributionAssessmentGate.statusReviewRequired')}</dd>
                            </div>
                            <div>
                                <dt>{t('contributionAssessmentGate.assessmentLabel')}</dt>
                                <dd>{contributionGatePrompt?.assessment?.id || '-'}</dd>
                            </div>
                        </dl>
                    </div>
                    <div className={styles.contributionGateActions}>
                        <button
                            type="button"
                            className={styles.contributionGateSecondary}
                            onClick={handleReviewContributionTraceBeforeCrystallize}
                        >
                            {t('contributionAssessmentGate.reviewAction')}
                        </button>
                    </div>
                </BottomSheet>
                <ConfirmationSheet
                    open={Boolean(confirmationRequest)}
                    title={confirmationRequest?.title || ''}
                    description={confirmationRequest?.description || ''}
                    confirmLabel={confirmationRequest?.confirmLabel || ''}
                    cancelLabel={confirmationRequest?.cancelLabel || ''}
                    closeLabel={confirmationRequest?.closeLabel || ''}
                    tone={confirmationRequest?.tone}
                    onConfirm={() => resolveConfirmationRequest(true)}
                    onCancel={() => resolveConfirmationRequest(false)}
                />
            </div>
        );
    }

    return (
        <div className={styles.draftList}>
            {orderedDrafts.map((draft, i) => (
                <DraftCard
                    key={draft.id}
                    draft={{
                        ...draft,
                        lifecycleStatus: draft.documentStatus,
                        publicBlockerCode: draft.publicBlockerCode,
                        lastActivityAt: draft.lastActivityAt,
                    }}
                    index={i}
                    onClick={() => setSelectedDraft(String(draft.id))}
                />
            ))}
            {genesisMode === 'SEEDED' && (
                <div className={styles.editorAside}>
                    <ReferencesPanel
                        surface={seededDraftListSurface}
                        referenceLinks={[]}
                        knowledgeReferenceOptions={[]}
                        canInsertKnowledgeReference={false}
                        onInsertReference={() => {}}
                        referencesLoading={false}
                        referencesError={null}
                        seededFileTree={seededFileTree}
                        seededFileTreeLoading={seededFileTreeLoading}
                        seededFileTreeError={seededFileTreeError}
                        selectedSeededReference={selectedSeededReference}
                        onSelectSeededReference={setSelectedSeededReference}
                    />
                </div>
            )}
        </div>
    );
}

export default CrucibleTab;
