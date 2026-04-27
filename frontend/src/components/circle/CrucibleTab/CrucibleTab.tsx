'use client';

import { useState, useCallback, useEffect, useRef, useMemo } from 'react';
import { useMutation, useQuery } from '@apollo/client/react';
import { motion, AnimatePresence } from 'framer-motion';
import { resolveNodeRoute } from '@/lib/config/nodeRouting';
import { useCurrentLocale, useI18n } from '@/i18n/useI18n';

import CrucibleEditor from '@/components/circle/CrucibleEditor';
import GhostReveal from '@/components/circle/GhostReveal';
import ReferencesPanel from '@/components/circle/ReferencesPanel/ReferencesPanel';
import SourceMaterialsPanel from '@/components/circle/SourceMaterialsPanel/SourceMaterialsPanel';
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
} from '@/features/draft-working-copy/api';
import { useCollaboration } from '@/lib/collaboration';
import { useCrystallizeDraft } from '@/hooks/useCrystallizeDraft';
import { useGhostDraftGeneration } from '@/hooks/useGhostDraftGeneration';
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
    buildCrucibleAcceptedIssuesByParagraph,
    buildCrucibleGovernanceSummary,
    buildCrucibleParagraphBlocks,
} from '@/lib/circle/crucibleViewModel';
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
    withdrawDraftDiscussion,
} from '@/lib/discussion/api';
import type { CircleDraftLifecycleTemplate, CircleDraftWorkflowPolicy } from '@/lib/circles/policyProfile';
import {
    fetchSeededFileTree,
    type SeededFileTreeNode,
    type SeededReferenceSelection,
} from '@/lib/circles/seeded';
import {
    fetchSourceMaterials,
    uploadSourceMaterial,
    type SourceMaterialRecord,
} from '@/lib/circles/sourceMaterials';
import {
    fetchDraftReferenceLinks,
    type DraftReferenceLink,
} from '@/lib/drafts/referenceLinks';
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
}

interface TemporaryEditGrantView {
    grantId: string;
    draftPostId: number;
    blockId: string;
    granteeUserId: number;
    requestedBy: number;
    grantedBy: number | null;
    revokedBy: number | null;
    approvalMode: 'manager_confirm' | 'governance_vote';
    status: 'requested' | 'active' | 'revoked' | 'expired' | 'rejected';
    governanceProposalId: string | null;
    requestNote: string | null;
    expiresAt: string | null;
    requestedAt: string;
    grantedAt: string | null;
    revokedAt: string | null;
    updatedAt: string;
}

interface GhostDraftReplaceRequest {
    token: number;
    content: string;
}

interface KnowledgeReferenceInsertRequest {
    token: number;
    option: KnowledgeReferenceOption;
}

function parseLineRefToParagraphIndex(lineRef: string | null | undefined, fallback = 0): number {
    if (!lineRef) return fallback;
    const matched = lineRef.match(/paragraph:(\d+)/i);
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

/* ═══ Crucible ═══ */
interface CrucibleTabProps {
    drafts: CrucibleDraft[];
    circleId: number;
    genesisMode?: 'BLANK' | 'SEEDED';
    knowledgeReferenceOptions?: KnowledgeReferenceOption[];
    draftLifecycleTemplate?: CircleDraftLifecycleTemplate | null;
    draftWorkflowPolicy?: CircleDraftWorkflowPolicy | null;
    viewerMembership?: DraftPermissionMembership | null;
    requestedDraftId?: number | null;
    onRequestedDraftHandled?: () => void;
    onCrystallizationComplete?: () => Promise<void> | void;
}

function CrucibleTab({
    drafts,
    circleId,
    genesisMode = 'BLANK',
    knowledgeReferenceOptions = [],
    draftLifecycleTemplate = null,
    draftWorkflowPolicy = null,
    viewerMembership = null,
    requestedDraftId = null,
    onRequestedDraftHandled,
    onCrystallizationComplete,
}: CrucibleTabProps) {
    const t = useI18n('CrucibleTab');
    const ghostRevealT = useI18n('GhostReveal');
    const discussionT = useI18n('DraftDiscussionPanel');
    const editorT = useI18n('CrucibleEditor');
    const lifecycleT = useI18n('CrucibleLifecycleHeader');
    const locale = useCurrentLocale();
    const [selectedDraft, setSelectedDraft] = useState<string | null>(null);
    const [displayHeat, setDisplayHeat] = useState<number>(Math.max(0, drafts[0]?.heat ?? 40));
    const autosaveTimerRef = useRef<number | null>(null);
    const autosaveTextRef = useRef('');
    const hasUnsavedDraftRef = useRef(false);
    const noticeTimerRef = useRef<number | null>(null);
    const [notice, setNotice] = useState<{ type: 'success' | 'error'; text: string } | null>(null);
    const [selectedDraftContent, setSelectedDraftContent] = useState('');
    const [selectedDraftContentReady, setSelectedDraftContentReady] = useState(false);
    const [discussionThreads, setDiscussionThreads] = useState<DraftDiscussionThreadRecord[]>([]);
    const [ghostDraftDefaultIssueCarrySelections, setGhostDraftDefaultIssueCarrySelections] = useState<Record<number, string[]>>({});
    const [discussionViewerUserId, setDiscussionViewerUserId] = useState<number | null>(null);
    const [discussionLoading, setDiscussionLoading] = useState(false);
    const [discussionBusy, setDiscussionBusy] = useState(false);
    const [discussionError, setDiscussionError] = useState<string | null>(null);
    const [selectedParagraphIndex, setSelectedParagraphIndex] = useState<number | null>(null);
    const [draftLifecycle, setDraftLifecycle] = useState<DraftLifecycleReadModel | null>(null);
    const [draftLifecycleLoading, setDraftLifecycleLoading] = useState(false);
    const [draftLifecycleError, setDraftLifecycleError] = useState<string | null>(null);
    const [draftLifecycleTransitionBusy, setDraftLifecycleTransitionBusy] = useState(false);
    const [temporaryEditGrants, setTemporaryEditGrants] = useState<TemporaryEditGrantView[]>([]);
    const [temporaryEditGrantBusy, setTemporaryEditGrantBusy] = useState(false);
    const [temporaryEditGrantError, setTemporaryEditGrantError] = useState<string | null>(null);
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
    const [draftWorkspaceStatuses, setDraftWorkspaceStatuses] = useState<Record<number, WorkspaceDraftLifecycleStatus>>({});
    const draftLifecycleRequestRef = useRef(0);
    const draftWorkspaceStatusRequestRef = useRef(0);
    const sourceMaterialsRequestRef = useRef(0);
    const discussionSurfaceSyncRef = useRef<Promise<void> | null>(null);
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

    // Yjs collaborative doc for the selected draft
    const {
        ydoc,
        isConnected,
        connectedUsers,
    } = useCollaboration(selectedDraft || 'default');

    const { canComment, canEdit } = useMemo(
        () => deriveDraftPermissions(viewerMembership),
        [viewerMembership],
    );
    const workflowPermissions = useMemo(() => deriveDraftWorkflowPermissions({
        membership: viewerMembership,
        workflowPolicy: draftWorkflowPolicy,
    }, {
        inactiveReason: t('permissions.inactiveReason'),
        roleLabel: {
            Owner: t('permissions.roles.owner'),
            Admin: t('permissions.roles.admin'),
            Moderator: t('permissions.roles.moderator'),
            Elder: t('permissions.roles.elder'),
            Member: t('permissions.roles.member'),
            Initiate: t('permissions.roles.initiate'),
        },
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
    }), [draftWorkflowPolicy, t, viewerMembership]);
    const discussionCapabilities = useMemo(() => {
        return {
            canCreate: workflowPermissions.createIssue.allowed,
            createDisabledReason: workflowPermissions.createIssue.reason,
            canFollowup: workflowPermissions.followupIssue.allowed,
            followupDisabledReason: workflowPermissions.followupIssue.reason,
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
    }, [workflowPermissions]);
    const selectedDraftPostId = selectedDraft ? Number.parseInt(selectedDraft, 10) : null;
    const selectedDraftSummary = selectedDraft
        ? drafts.find((draft) => String(draft.id) === selectedDraft)
        : null;
    const effectiveDraftWorkspaceStatuses = useMemo(() => {
        const next: Record<number, WorkspaceDraftLifecycleStatus> = {};
        for (const draft of drafts) {
            if (draft.documentStatus) {
                next[draft.id] = draft.documentStatus;
            }
        }
        return {
            ...draftWorkspaceStatuses,
            ...next,
        };
    }, [draftWorkspaceStatuses, drafts]);
    const orderedDrafts = useMemo(
        () => prioritizeWorkspaceDrafts(drafts, effectiveDraftWorkspaceStatuses),
        [drafts, effectiveDraftWorkspaceStatuses],
    );
    const selectedDraftEditCount = Math.max(1, selectedDraftSummary?.editors ?? 1);
    const stableSnapshotVersion = draftLifecycle?.stableSnapshot.draftVersion || 1;
    const paragraphOptions = useMemo(
        () => extractParagraphOptions(selectedDraftContent),
        [selectedDraftContent],
    );
    const {
        crystallizeDraft,
        loading: crystallizing,
        notice: crystallizeNotice,
    } = useCrystallizeDraft({
        draftPostId: selectedDraftPostId,
        circleId,
        title: selectedDraftSummary?.title || '',
        content: selectedDraftContent,
        enabled: discussionCapabilities.canCrystallize,
    });
    const { data: draftCommentsData, refetch: refetchDraftComments } = useQuery<DraftCommentsResponse>(
        GET_DRAFT_COMMENTS,
        {
            variables: { postId: selectedDraftPostId || 0, limit: 200 },
            skip: !selectedDraftPostId || !Number.isFinite(selectedDraftPostId),
            fetchPolicy: 'cache-and-network',
        },
    );
    const [addDraftComment] = useMutation<AddDraftCommentResponse>(ADD_DRAFT_COMMENT);
    const getDraftRuntimeBaseUrl = useCallback(async (): Promise<string> => {
        const route = await resolveNodeRoute('discussion_runtime');
        return route.urlBase;
    }, []);

    const loadTemporaryEditGrants = useCallback(async (): Promise<void> => {
        if (!selectedDraftPostId || !Number.isFinite(selectedDraftPostId)) {
            setTemporaryEditGrants([]);
            setTemporaryEditGrantError(null);
            return;
        }

        try {
            const baseUrl = await getDraftRuntimeBaseUrl();
            const response = await fetch(
                `${baseUrl}/api/v1/temporary-edit-grants/drafts/${selectedDraftPostId}/temporary-edit-grants`,
                {
                    method: 'GET',
                    credentials: 'include',
                    cache: 'no-store',
                },
            );
            const payload = await response.json().catch(() => null);
            if (!response.ok) {
                throw new Error(payload?.message || payload?.error || t('errors.loadTemporaryEditGrants'));
            }
            setTemporaryEditGrants(Array.isArray(payload?.grants) ? payload.grants : []);
            setTemporaryEditGrantError(null);
        } catch (error) {
            const message = error instanceof Error ? error.message : t('errors.loadTemporaryEditGrants');
            setTemporaryEditGrantError(message);
        }
    }, [getDraftRuntimeBaseUrl, selectedDraftPostId, t]);

    useEffect(() => {
        void loadTemporaryEditGrants();
    }, [loadTemporaryEditGrants]);

    useEffect(() => {
        sourceMaterialsRequestRef.current += 1;
        setGhostDraftReplaceRequest(null);
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

    useEffect(() => {
        if (drafts.length === 0) {
            draftWorkspaceStatusRequestRef.current += 1;
            setDraftWorkspaceStatuses({});
            return;
        }

        const draftsMissingGraphqlStatus = drafts.filter((draft) => !draft.documentStatus);
        if (draftsMissingGraphqlStatus.length === 0) {
            draftWorkspaceStatusRequestRef.current += 1;
            setDraftWorkspaceStatuses((current) => (Object.keys(current).length === 0 ? current : {}));
            return;
        }

        const requestId = draftWorkspaceStatusRequestRef.current + 1;
        draftWorkspaceStatusRequestRef.current = requestId;
        let cancelled = false;

        void (async () => {
            const nextStatuses: Record<number, WorkspaceDraftLifecycleStatus> = {};
            for (const draft of draftsMissingGraphqlStatus) {
                try {
                    const lifecycle = await fetchDraftLifecycle({ draftPostId: draft.id });
                    nextStatuses[draft.id] = lifecycle.documentStatus;
                } catch {
                    nextStatuses[draft.id] = null;
                }
            }

            if (cancelled || draftWorkspaceStatusRequestRef.current !== requestId) return;
            setDraftWorkspaceStatuses(nextStatuses);
        })();

        return () => {
            cancelled = true;
        };
    }, [drafts]);

    useEffect(() => {
        if (!selectedDraftPostId || !draftLifecycle?.documentStatus) return;

        setDraftWorkspaceStatuses((current) => {
            if (current[selectedDraftPostId] === draftLifecycle.documentStatus) {
                return current;
            }
            return {
                ...current,
                [selectedDraftPostId]: draftLifecycle.documentStatus,
            };
        });
    }, [draftLifecycle?.documentStatus, selectedDraftPostId]);

    const canEditWorkingCopy = canEdit && (draftLifecycle?.documentStatus || 'drafting') === 'drafting';

    const handleUploadSourceMaterial = useCallback(async (file: File): Promise<void> => {
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
            await uploadSourceMaterial(circleId, {
                draftPostId: selectedDraftPostId,
                name: String(file.name || 'source-material.txt'),
                mimeType: file.type || null,
                content,
            });
            await loadSourceMaterials();
        } catch (error) {
            const message = error instanceof Error ? error.message : t('errors.uploadSourceMaterial');
            setSourceMaterialsError(message);
            throw new Error(message);
        } finally {
            setSourceMaterialsUploading(false);
        }
    }, [canEditWorkingCopy, circleId, loadSourceMaterials, selectedDraftPostId, t]);

    const refreshDraftLifecycle = useCallback(async (): Promise<void> => {
        if (!selectedDraftPostId || !Number.isFinite(selectedDraftPostId)) {
            draftLifecycleRequestRef.current += 1;
            setDraftLifecycle(null);
            setDraftLifecycleError(null);
            setDraftLifecycleLoading(false);
            return;
        }

        const requestId = draftLifecycleRequestRef.current + 1;
        draftLifecycleRequestRef.current = requestId;
        setDraftLifecycleLoading(true);
        setDraftLifecycleError(null);
        try {
            const lifecycle = await fetchDraftLifecycle({
                draftPostId: selectedDraftPostId,
            });
            if (draftLifecycleRequestRef.current !== requestId) return;
            setDraftLifecycle(lifecycle);
        } catch (error) {
            if (draftLifecycleRequestRef.current !== requestId) return;
            const message = error instanceof Error ? error.message : t('errors.loadDraftLifecycle');
            setDraftLifecycle(null);
            setDraftLifecycleError(message);
        } finally {
            if (draftLifecycleRequestRef.current !== requestId) return;
            setDraftLifecycleLoading(false);
        }
    }, [selectedDraftPostId, t]);

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
            const payload = await listDraftDiscussions({
                draftPostId: selectedDraftPostId,
                limit: 80,
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
    }, [selectedDraftPostId, t]);

    const saveDraftContent = useCallback(async (
        postId: number,
        text: string,
        options?: {
            surfaceErrors?: boolean;
        },
    ) => {
        const payloadText = text.trim();
        if (!payloadText) return;
        try {
            const baseUrl = await getDraftRuntimeBaseUrl();
            const response = await fetch(`${baseUrl}/api/v1/discussion/drafts/${postId}/content`, {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                credentials: 'include',
                body: JSON.stringify({ text: payloadText }),
            });
            const payload = await response.json().catch(() => null);
            if (!response.ok) {
                throw new Error(payload?.message || t('errors.saveDraft'));
            }
            const saved = response.ok;
            if (saved && typeof payload?.heatScore === 'number') {
                setDisplayHeat(Math.max(0, payload.heatScore));
            }
            if (saved && payload?.updatedAt && draftLifecycle) {
                setDraftLifecycle({
                    ...draftLifecycle,
                    workingCopy: {
                        ...draftLifecycle.workingCopy,
                        workingCopyContent: payloadText,
                        updatedAt: String(payload.updatedAt),
                    },
                });
            }
            if (autosaveTextRef.current === text) {
                hasUnsavedDraftRef.current = false;
            }
            if (pendingReferenceLinksRefreshRef.current && saved) {
                await loadDraftReferenceLinks();
                pendingReferenceLinksRefreshRef.current = false;
            }
            return payload;
        } catch (error) {
            console.warn('Draft autosave failed:', error);
            if (options?.surfaceErrors) {
                throw error;
            }
            return null;
        }
    }, [draftLifecycle, getDraftRuntimeBaseUrl, loadDraftReferenceLinks]);

    const syncDraftSurfaceFromLifecycle = useCallback((
        lifecycle: DraftLifecycleReadModel,
        options?: {
            replaceLiveDoc?: boolean;
        },
    ) => {
        setDraftLifecycle(lifecycle);

        const nextWorkingCopy = String(lifecycle.workingCopy?.workingCopyContent || '');
        if (!nextWorkingCopy.trim()) return;

        autosaveTextRef.current = nextWorkingCopy;
        hasUnsavedDraftRef.current = false;
        setSelectedDraftContent(nextWorkingCopy);

        if (options?.replaceLiveDoc) {
            setGhostDraftReplaceRequest({
                token: Date.now(),
                content: nextWorkingCopy,
            });
        }
    }, []);

    const handleGhostDraftApplied = useCallback(async (input: {
        draftText: string;
        acceptedSuggestion: {
            targetRef: string;
            threadIds: string[];
        } | null;
        acceptedThreadIds: string[];
        workingCopyContent: string;
        workingCopyHash: string;
        workingCopyUpdatedAt: string;
        mode: 'AUTO_FILL' | 'ACCEPT_SUGGESTION';
        shouldReplaceLiveDoc: boolean;
        heatScore: number;
    }) => {
        const normalized = String(input.workingCopyContent || input.draftText || '').trim();
        if (!normalized) return;

        autosaveTextRef.current = normalized;
        hasUnsavedDraftRef.current = false;
        setSelectedDraftContent(normalized);
        setDisplayHeat(Math.max(0, Number(input.heatScore || 0)));
        if (draftLifecycle) {
            setDraftLifecycle({
                ...draftLifecycle,
                workingCopy: {
                    ...draftLifecycle.workingCopy,
                    workingCopyContent: normalized,
                    workingCopyHash: input.workingCopyHash,
                    updatedAt: input.workingCopyUpdatedAt,
                },
            });
        }
        if (input.shouldReplaceLiveDoc) {
            setGhostDraftReplaceRequest({
                token: Date.now(),
                content: normalized,
            });
        }
        const acceptedSuggestion = input.mode === 'ACCEPT_SUGGESTION'
            ? input.acceptedSuggestion
            : null;
        if (acceptedSuggestion) {
            const paragraphIndex = parseLineRefToParagraphIndex(acceptedSuggestion.targetRef, -1);
            if (paragraphIndex >= 0) {
                setGhostDraftDefaultIssueCarrySelections((prev) => {
                    const nextThreadIds = input.acceptedThreadIds.length > 0
                        ? input.acceptedThreadIds
                        : acceptedSuggestion.threadIds;
                    const mergedThreadIds = Array.from(new Set([
                        ...(prev[paragraphIndex] || []),
                        ...nextThreadIds,
                    ]));
                    return {
                        ...prev,
                        [paragraphIndex]: mergedThreadIds,
                    };
                });
            }
        }
    }, [draftLifecycle]);

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

    const presentDraftLifecycleActionError = useCallback((message: string) => {
        setDraftLifecycleError(message);
        clearNoticeTimer();
        setNotice(null);
    }, [clearNoticeTimer]);

    const flushDraftBeforeWorkflowAction = useCallback(async ({
        postId,
        emptyMessage,
    }: {
        postId: number;
        emptyMessage: string;
    }) => {
        if (autosaveTimerRef.current !== null) {
            window.clearTimeout(autosaveTimerRef.current);
            autosaveTimerRef.current = null;
        }
        const latestDraftText = hasUnsavedDraftRef.current ? autosaveTextRef.current : selectedDraftContent;
        if (!latestDraftText.trim()) {
            throw new Error(emptyMessage);
        }
        await saveDraftContent(postId, latestDraftText, { surfaceErrors: true });
        return latestDraftText;
    }, [saveDraftContent, selectedDraftContent]);

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
                    const confirmed = window.confirm(
                        t('confirm.applyAcceptedGhostThreads', {
                            count: pendingThreadCount > 0 ? pendingThreadCount : 1,
                        }),
                    );
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
            setDraftLifecycle(lifecycle);
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
        selectedDraftPostId,
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
                    const confirmed = window.confirm(
                        t('confirm.applyAcceptedGhostThreads', {
                            count: pendingThreadCount > 0 ? pendingThreadCount : 1,
                        }),
                    );
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
            });
            setDraftLifecycle(lifecycle);
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
        selectedDraftPostId,
        sdk,
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
            setDraftLifecycle(lifecycle);
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
        selectedDraftPostId,
        sdk,
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
            setDraftLifecycle(lifecycle);
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
        selectedDraftPostId,
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
            setDraftLifecycle(lifecycle);
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
        sdk,
        selectedDraftPostId,
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
            setDraftLifecycle(lifecycle);
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
        sdk,
        selectedDraftPostId,
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
        })();

        discussionSurfaceSyncRef.current = syncTask;
        try {
            await syncTask;
        } finally {
            if (discussionSurfaceSyncRef.current === syncTask) {
                discussionSurfaceSyncRef.current = null;
            }
        }
    }, [refreshDraftDiscussions, refreshDraftLifecycle]);

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

        await runDiscussionMutation(async () => createDraftDiscussion({
                draftPostId: selectedDraftPostId,
                targetType: input.targetType,
                targetRef: input.targetRef,
                targetVersion: input.targetVersion || stableSnapshotVersion,
                issueType: input.issueType,
                content: input.content,
            }),
        (payload) => upsertDiscussionThread(payload.thread));
    }, [runDiscussionMutation, selectedDraftPostId, stableSnapshotVersion, t, upsertDiscussionThread]);

    const handleProposeDiscussion = useCallback(async (input: {
        threadId: string;
        issueType?: DraftDiscussionIssueType;
        content: string;
    }) => {
        if (!selectedDraftPostId || !Number.isFinite(selectedDraftPostId)) {
            throw new Error(t('errors.missingDraftContextForPropose'));
        }

        await runDiscussionMutation(async () => proposeDraftDiscussion({
                draftPostId: selectedDraftPostId,
                threadId: input.threadId,
                issueType: input.issueType,
                content: input.content,
            }),
        (payload) => upsertDiscussionThread(payload.thread));
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

        await runDiscussionMutation(async () => resolveDraftDiscussion({
                draftPostId: selectedDraftPostId,
                threadId: input.threadId,
                resolution: input.resolution,
                issueType: input.issueType,
                reason: input.reason,
            }),
        (payload) => upsertDiscussionThread(payload.thread));
    }, [runDiscussionMutation, selectedDraftPostId, t, upsertDiscussionThread]);

    const handleReplyDiscussion = useCallback(async (input: {
        threadId: string;
        content: string;
    }) => {
        if (!selectedDraftPostId || !Number.isFinite(selectedDraftPostId)) {
            throw new Error(t('errors.missingDraftContextForReply'));
        }

        await runDiscussionMutation(async () => appendDraftDiscussionMessage({
                draftPostId: selectedDraftPostId,
                threadId: input.threadId,
                content: input.content,
            }),
        (payload) => upsertDiscussionThread(payload.thread));
    }, [runDiscussionMutation, selectedDraftPostId, t, upsertDiscussionThread]);

    const handleWithdrawDiscussion = useCallback(async (input: {
        threadId: string;
        reason?: string;
    }) => {
        if (!selectedDraftPostId || !Number.isFinite(selectedDraftPostId)) {
            throw new Error(t('errors.missingDraftContextForWithdraw'));
        }

        await runDiscussionMutation(async () => withdrawDraftDiscussion({
                draftPostId: selectedDraftPostId,
                threadId: input.threadId,
                reason: input.reason,
            }),
        (payload) => upsertDiscussionThread(payload.thread));
    }, [runDiscussionMutation, selectedDraftPostId, t, upsertDiscussionThread]);

    const handleApplyDiscussion = useCallback(async (input: {
        threadId: string;
        reason?: string;
    }) => {
        if (!selectedDraftPostId || !Number.isFinite(selectedDraftPostId)) {
            throw new Error(t('errors.missingDraftContextForApply'));
        }

        await runDiscussionMutation(async () => applyDraftDiscussion({
                draftPostId: selectedDraftPostId,
                threadId: input.threadId,
                reason: input.reason,
            }),
        (payload) => upsertDiscussionThread(payload.thread));
    }, [runDiscussionMutation, selectedDraftPostId, t, upsertDiscussionThread]);

    const editorComments = useMemo(() => {
        const comments = draftCommentsData?.draftComments || [];
        return [...comments]
            .sort((a, b) => new Date(a.createdAt).getTime() - new Date(b.createdAt).getTime())
            .map((comment, index) => ({
                id: String(comment.id),
                author: comment.user.displayName || comment.user.handle || t('fallback.unknownMember'),
                text: comment.content,
                paragraphIndex: parseLineRefToParagraphIndex(comment.lineRef, index),
                createdAt: timeAgo(comment.createdAt, locale),
            }));
    }, [draftCommentsData, locale, t]);

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
        const exists = drafts.some((draft) => String(draft.id) === requestedDraftKey);
        if (!exists) return;
        if (selectedDraft !== requestedDraftKey) {
            setSelectedDraft(requestedDraftKey);
        }
        onRequestedDraftHandled?.();
    }, [drafts, onRequestedDraftHandled, requestedDraftId, selectedDraft]);

    useEffect(() => {
        if (!selectedDraftPostId || !Number.isFinite(selectedDraftPostId)) {
            setDiscussionThreads([]);
            setDiscussionError(null);
            setDiscussionLoading(false);
            setDiscussionBusy(false);
            setDraftLifecycle(null);
            setDraftLifecycleError(null);
            setDraftLifecycleLoading(false);
            return;
        }

        void syncDraftDiscussionSurface();
    }, [selectedDraftPostId, syncDraftDiscussionSurface]);

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
            setSelectedDraftContent('');
            setSelectedDraftContentReady(false);
            setSelectedParagraphIndex(null);
            autosaveTextRef.current = '';
            hasUnsavedDraftRef.current = false;
            return;
        }

        let cancelled = false;
        setSelectedDraftContent('');
        setSelectedDraftContentReady(false);
        setSelectedParagraphIndex(null);
        autosaveTextRef.current = '';
        hasUnsavedDraftRef.current = false;

        const fetchDraftContent = async () => {
            try {
                const baseUrl = await getDraftRuntimeBaseUrl();
                const response = await fetch(
                    `${baseUrl}/api/v1/discussion/drafts/${selectedDraftPostId}/content`,
                    {
                        cache: 'no-store',
                        credentials: 'include',
                    },
                );

                if (!response.ok) {
                    if (response.status === 404 || response.status === 409) {
                        if (!cancelled) setSelectedDraftContent('');
                        return;
                    }
                    throw new Error(`draft content fetch failed: ${response.status}`);
                }

                const payload = await response.json().catch(() => null);
                if (!cancelled) {
                    const nextText = typeof payload?.text === 'string' ? payload.text : '';
                    autosaveTextRef.current = nextText;
                    hasUnsavedDraftRef.current = false;
                    setSelectedDraftContent(nextText);
                    if (typeof payload?.heatScore === 'number') {
                        setDisplayHeat(Math.max(0, payload.heatScore));
                    }
                }
            } catch (error) {
                console.warn('load draft content failed:', error);
                if (!cancelled) {
                    autosaveTextRef.current = '';
                    hasUnsavedDraftRef.current = false;
                    setSelectedDraftContent('');
                }
            } finally {
                if (!cancelled) setSelectedDraftContentReady(true);
            }
        };

        void fetchDraftContent();
        return () => {
            cancelled = true;
        };
    }, [getDraftRuntimeBaseUrl, selectedDraftPostId]);

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

    const handleEdit = useCallback((content: string) => {
        autosaveTextRef.current = content;
        hasUnsavedDraftRef.current = true;
        setSelectedDraftContent(content);

        if (!selectedDraftPostId || !Number.isFinite(selectedDraftPostId)) {
            return;
        }

        if (autosaveTimerRef.current !== null) {
            window.clearTimeout(autosaveTimerRef.current);
        }
        const isNearDraftingDeadline = Boolean(draftLifecycle?.documentStatus === 'drafting'
            && draftLifecycle?.draftingEndsAt
            && (new Date(draftLifecycle.draftingEndsAt).getTime() - Date.now()) <= 5000);
        if (isNearDraftingDeadline) {
            void saveDraftContent(selectedDraftPostId, content, { surfaceErrors: false });
            return;
        }
        autosaveTimerRef.current = window.setTimeout(() => {
            autosaveTimerRef.current = null;
            void saveDraftContent(selectedDraftPostId, autosaveTextRef.current, { surfaceErrors: false });
        }, 1200);
    }, [draftLifecycle?.documentStatus, draftLifecycle?.draftingEndsAt, saveDraftContent, selectedDraftPostId]);

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
                const baseUrl = await getDraftRuntimeBaseUrl();
                const heatResponse = await fetch(
                    `${baseUrl}/api/v1/discussion/drafts/${selectedDraftPostId}/content`,
                    {
                        cache: 'no-store',
                        credentials: 'include',
                    },
                );
                const heatPayload = await heatResponse.json().catch(() => null);
                if (heatResponse.ok && typeof heatPayload?.heatScore === 'number') {
                    setDisplayHeat(Math.max(0, heatPayload.heatScore));
                }
            } catch (error) {
                console.warn('refresh draft heat failed:', error);
            }
        } catch (error) {
            console.warn('add draft comment failed:', error);
            showNotice('error', t('errors.sendComment'));
        }
    }, [addDraftComment, getDraftRuntimeBaseUrl, refetchDraftComments, selectedDraftPostId, showNotice, t]);

    const requestTemporaryEditGrant = useCallback(async (input: {
        blockId: string;
    }) => {
        if (!selectedDraftPostId || !Number.isFinite(selectedDraftPostId)) return;
        setTemporaryEditGrantBusy(true);
        setTemporaryEditGrantError(null);
        try {
            const baseUrl = await getDraftRuntimeBaseUrl();
            const response = await fetch(
                `${baseUrl}/api/v1/temporary-edit-grants/drafts/${selectedDraftPostId}/temporary-edit-grants`,
                {
                    method: 'POST',
                    credentials: 'include',
                    cache: 'no-store',
                    headers: { 'Content-Type': 'application/json' },
                    body: JSON.stringify({
                        blockId: input.blockId,
                    }),
                },
            );
            const payload = await response.json().catch(() => null);
            if (!response.ok) {
                throw new Error(payload?.message || payload?.error || t('errors.requestTemporaryEditGrant'));
            }
            await loadTemporaryEditGrants();
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
    }, [getDraftRuntimeBaseUrl, loadTemporaryEditGrants, selectedDraftPostId, t]);

    const issueTemporaryEditGrant = useCallback(async (input: {
        grantId: string;
    }) => {
        setTemporaryEditGrantBusy(true);
        setTemporaryEditGrantError(null);
        try {
            const baseUrl = await getDraftRuntimeBaseUrl();
            const response = await fetch(
                `${baseUrl}/api/v1/temporary-edit-grants/grants/${input.grantId}/issue`,
                {
                    method: 'POST',
                    credentials: 'include',
                    cache: 'no-store',
                    headers: { 'Content-Type': 'application/json' },
                    body: JSON.stringify({
                        expiresInMinutes: 60,
                    }),
                },
            );
            const payload = await response.json().catch(() => null);
            if (!response.ok) {
                throw new Error(payload?.message || payload?.error || t('errors.issueTemporaryEditGrant'));
            }
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
    }, [getDraftRuntimeBaseUrl, loadTemporaryEditGrants, t]);

    const revokeTemporaryEditGrant = useCallback(async (input: {
        grantId: string;
    }) => {
        setTemporaryEditGrantBusy(true);
        setTemporaryEditGrantError(null);
        try {
            const baseUrl = await getDraftRuntimeBaseUrl();
            const response = await fetch(
                `${baseUrl}/api/v1/temporary-edit-grants/grants/${input.grantId}/revoke`,
                {
                    method: 'POST',
                    credentials: 'include',
                    cache: 'no-store',
                },
            );
            const payload = await response.json().catch(() => null);
            if (!response.ok) {
                throw new Error(payload?.message || payload?.error || t('errors.revokeTemporaryEditGrant'));
            }
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
    }, [getDraftRuntimeBaseUrl, loadTemporaryEditGrants, t]);

    const handleExecuteCrystallization = useCallback(async () => {
        if (
            !selectedDraftPostId
            || !Number.isFinite(selectedDraftPostId)
            || !discussionCapabilities.canCrystallize
        ) return;

        setDraftLifecycleError(null);
        try {
            await flushDraftBeforeWorkflowAction({
                postId: selectedDraftPostId,
                emptyMessage: t('errors.crystallizeRequiresBody'),
            });
            const result = await crystallizeDraft();
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
    const aiReadableSourceMaterialIds = useMemo(
        () => sourceMaterials
            .filter((material) => material.status === 'ai_readable')
            .map((material) => material.id)
            .filter((value) => Number.isFinite(value) && value > 0),
        [sourceMaterials],
    );
    const ghostDraft = useGhostDraftGeneration({
        postId: selectedDraftPostId,
        currentContent: selectedDraftContent,
        canEditWorkingCopy,
        workingCopyHash: draftLifecycle?.workingCopy.workingCopyHash,
        workingCopyUpdatedAt: draftLifecycle?.workingCopy.updatedAt,
        selectedSeededReference: selectedSeededReference,
        sourceMaterialIds: aiReadableSourceMaterialIds,
        copy: {
            errors: {
                missingDraftContext: ghostRevealT('errors.missingDraftContext'),
                missingArtifact: ghostRevealT('errors.missingArtifact'),
                missingContent: ghostRevealT('errors.missingContent'),
                generateFailed: ghostRevealT('errors.generateFailed'),
                acceptFailed: ghostRevealT('errors.acceptFailed'),
            },
        },
        onApplied: handleGhostDraftApplied,
    });
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
                actorCapabilities: {
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
        editorT,
        selectedDraftContent,
        selectedDraftContentReady,
        selectedParagraphIndex,
    ]);
    const acceptedIssuesByParagraph = useMemo(
        () => buildCrucibleAcceptedIssuesByParagraph(discussionThreads, {
            copy: {
                emptySummary: discussionT('threads.emptySummary'),
            },
        }),
        [discussionThreads, discussionT],
    );
    const pendingGhostIssueThreads = useMemo(
        () => discussionThreads.filter((thread) => (
            thread.targetType === 'paragraph'
            && (
                thread.state === 'open'
                || thread.state === 'proposed'
            )
        )),
        [discussionThreads],
    );
    const canViewGhostReveal = Boolean(
        discussionCapabilities.canResolve || discussionCapabilities.canApply,
    );
    const canAcceptGhostSuggestion = Boolean(
        discussionCapabilities.canResolve && discussionCapabilities.canApply,
    );
    const ghostAcceptDisabledReason = !discussionCapabilities.canApply
        ? discussionCapabilities.applyDisabledReason
        : !discussionCapabilities.canResolve
            ? discussionCapabilities.resolveDisabledReason
            : null;
    const showGhostReveal = Boolean(
        draftLifecycle?.documentStatus === 'review'
        && pendingGhostIssueThreads.length > 0
        && canViewGhostReveal,
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
    const advanceReviewDisabledReason = hasReachedMaxRevisionRounds
        ? t('disabled.maxRevisionRounds', {count: draftLifecycleTemplate?.maxRevisionRounds || 1})
        : discussionCapabilities.advanceFromReviewDisabledReason;
    const canAdvanceFromReview = Boolean(
        showAdvanceReviewAction
        && discussionCapabilities.canAdvanceFromReview
        && !hasReachedMaxRevisionRounds,
    );
    const showEnterCrystallizationAction = Boolean(
        draftLifecycle && draftLifecycle.documentStatus === 'review',
    );
    const canEnterCrystallization = Boolean(
        showEnterCrystallizationAction
        && discussionCapabilities.canCrystallize
        && sdk
        && draftLifecycle?.policyProfileDigest
    );
    const showRetryCrystallizationAction = Boolean(
        draftLifecycle && draftLifecycle.documentStatus === 'crystallization_failed',
    );
    const canRetryCrystallization = Boolean(
        showRetryCrystallizationAction
        && discussionCapabilities.canCrystallize
        && sdk
        && draftLifecycle?.policyProfileDigest
    );
    const crystallizationAnchorDisabledReason = !sdk
        ? t('disabled.walletRequiredForCrystallization')
        : !draftLifecycle?.policyProfileDigest
            ? t('disabled.policyProfileRequiredForCrystallization')
            : discussionCapabilities.crystallizeDisabledReason;
    const retryCrystallizationAnchorDisabledReason = !sdk
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
        && draftLifecycle?.policyProfileDigest,
    );
    const archiveDisabledReason = !sdk
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
    );
    const executeCrystallizationDisabledReason = !selectedDraftContentReady
        ? t('loading.draftContent')
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
                        <section className={styles.editorPrimary}>
                            {draftLifecycleLoading && (
                                <div className={styles.crystallizeNotice} role="status">
                                    {t('loading.draftLifecycle')}
                                </div>
                            )}
                            {draftLifecycleError && (
                                <div className={`${styles.crystallizeNotice} ${styles.crystallizeNoticeError}`} role="status">
                                    {draftLifecycleError}
                                </div>
                            )}
                            {draftLifecycle && (
                                <CrucibleLifecycleHeader
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
                            <div className={styles.editorSectionHeader}>
                                <div>
                                    <p className={styles.editorSectionEyebrow}>{t('editor.bodyEyebrow')}</p>
                                    <h3 className={styles.editorSectionTitle}>{t('editor.bodyTitle')}</h3>
                                </div>
                                <p className={styles.editorSectionHint}>
                                    {t('editor.bodyHint')}
                                </p>
                            </div>
                            <CrucibleEditor
                                ydoc={ydoc}
                                replaceRequest={ghostDraftReplaceRequest}
                                knowledgeReferenceOptions={knowledgeReferenceOptions}
                                insertReferenceRequest={insertReferenceRequest}
                                draft={{
                                    id: String(selectedDraftPostId || selectedDraftSummary?.id || 0),
                                    title: selectedDraftSummary?.title || t('fallback.untitledDraft'),
                                    content: selectedDraftContent,
                                    heat: displayHeat,
                                    editCount: selectedDraftEditCount,
                                    contributors: commentContributors,
                                }}
                                comments={editorComments}
                                onEdit={handleEdit}
                                onComment={handleComment}
                                canEdit={canEditWorkingCopy}
                                canComment={canComment}
                                onSelectionParagraphChange={setSelectedParagraphIndex}
                                collabStatus={{
                                    isConnected,
                                    connectedUsers,
                                }}
                                paragraphBlocks={paragraphBlocks}
                                selectedParagraphIndex={selectedParagraphIndex}
                                acceptedIssuesByParagraph={acceptedIssuesByParagraph}
                                defaultIssueCarrySelections={ghostDraftDefaultIssueCarrySelections}
                                canApplyAcceptedIssues={discussionCapabilities.canApply}
                                onApplyAcceptedIssues={handleApplyAcceptedIssues}
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
                        </section>
                        <section className={styles.editorAside}>
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
                            {showGhostReveal && (
                                <GhostReveal
                                    title={t('ghostReveal.title')}
                                    status={ghostDraft.status}
                                    candidate={ghostDraft.candidate}
                                    error={ghostDraft.error}
                                    issueThreadCount={pendingGhostIssueThreads.length}
                                    canGenerate={Boolean(
                                        selectedDraftPostId
                                        && Number.isFinite(selectedDraftPostId)
                                        && canViewGhostReveal
                                    )}
                                    canAccept={canAcceptGhostSuggestion}
                                    acceptDisabledReason={ghostAcceptDisabledReason}
                                    canSafelyAutoApply={ghostDraft.canSafelyAutoApply}
                                    onGenerate={ghostDraft.generateGhostDraft}
                                    onAccept={ghostDraft.acceptSuggestion}
                                    onIgnore={ghostDraft.ignoreCandidate}
                                    onRetry={ghostDraft.retryGhostDraft}
                                />
                            )}
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
                                onCreate={handleCreateDiscussion}
                                onPropose={handleProposeDiscussion}
                                onResolve={handleResolveDiscussion}
                                onReply={handleReplyDiscussion}
                                onWithdraw={handleWithdrawDiscussion}
                                onApply={handleApplyDiscussion}
                                paragraphOptions={paragraphOptions}
                                selectedParagraphIndex={selectedParagraphIndex}
                                onSelectParagraph={setSelectedParagraphIndex}
                                currentDraftVersion={stableSnapshotVersion}
                                governanceSummary={governanceSummary}
                                selectedSeededReference={selectedSeededReference}
                                onSelectSeededReference={setSelectedSeededReference}
                            />
                        </section>
                    </div>
                )}
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
                        lifecycleStatus: effectiveDraftWorkspaceStatuses[draft.id],
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
