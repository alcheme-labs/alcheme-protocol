'use client';

import { useState, useCallback, useMemo, useEffect, useRef, type KeyboardEvent } from 'react';
import { motion } from 'framer-motion';
import { Trash2 } from 'lucide-react';
import type * as Y from 'yjs';
import {
    replaceCrucibleParagraphContent,
    splitCrucibleParagraphContent,
    type CrucibleAcceptedIssueCarryView,
    type CrucibleAcceptedIssueExceptionView,
    type CrucibleParagraphBlockView,
} from '@/lib/circle/crucibleViewModel';
import { clampHeatScore, resolveHeatState } from '@/lib/heat/semantics';
import type { KnowledgeReferenceOption } from '@/lib/circle/knowledgeReferenceOptions';
import type {
    AcceptedIssueRevisionAssistStatus,
    AcceptedIssueRevisionCandidateView,
    AcceptedIssueRevisionSuggestionView,
} from '@/hooks/useAcceptedIssueRevisionAssist';
import { useI18n } from '@/i18n/useI18n';
import CrystalReferenceText from '@/components/circle/CrystalReferenceText/CrystalReferenceText';
import { resolveTemporaryGrantControls } from './temporaryGrantControls';
import CollaborativeEditor from './CollaborativeEditor';
import styles from './CrucibleEditor.module.css';

interface DraftComment {
    id: string;
    author: string;
    text: string;
    paragraphIndex: number;
    createdAt: string;
}

interface Draft {
    id: string;
    title: string;
    content: string;
    heat: number;
    editCount: number;
    contributors: string[];
}

interface CollabStatus {
    isConnected: boolean;
    connectedUsers: { name: string; color: string }[];
}

interface ActiveBlockEditorView {
    id: string;
    name: string;
    color: string;
}

interface TemporaryEditGrantView {
    grantId: string;
    blockId: string;
    granteeUserId: number;
    status: 'requested' | 'active' | 'revoked' | 'expired' | 'rejected';
    expiresAt: string | null;
}

interface CrucibleEditorInsertReferenceRequest {
    token: number;
    option: KnowledgeReferenceOption;
}

interface CrucibleEditorParagraphEditRequest {
    token: number;
    paragraphIndex: number;
    issueThreadId?: string | null;
}

interface CrucibleEditorProps {
    ydoc?: Y.Doc | null;
    replaceRequest?: { token: number; content: string } | null;
    knowledgeReferenceOptions?: KnowledgeReferenceOption[];
    insertReferenceRequest?: CrucibleEditorInsertReferenceRequest | null;
    paragraphEditRequest?: CrucibleEditorParagraphEditRequest | null;
    draft: Draft;
    comments?: DraftComment[];
    onEdit?: (content: string, metadata?: { blockId: string; paragraphIndex: number }) => void;
    onDeleteParagraph?: (paragraphIndex: number) => void;
    canDeleteParagraph?: boolean;
    paragraphDeleteDisabledReason?: string | null;
    onComment?: (paragraphIndex: number, text: string) => void;
    onEditingBlockChange?: (blockId: string | null) => void;
    canEdit?: boolean;
    canComment?: boolean;
    onSelectionParagraphChange?: (paragraphIndex: number | null) => void;
    collabStatus?: CollabStatus;
    activeEditorsByBlockId?: Record<string, ActiveBlockEditorView[]>;
    paragraphBlocks?: CrucibleParagraphBlockView[];
    selectedParagraphIndex?: number | null;
    collaborationContentVersion?: string | null;
    acceptedIssuesByParagraph?: Record<number, CrucibleAcceptedIssueCarryView[]>;
    acceptedIssueExceptions?: CrucibleAcceptedIssueExceptionView[];
    defaultIssueCarrySelections?: Record<number, string[]>;
    canApplyAcceptedIssues?: boolean;
    onApplyAcceptedIssues?: (input: { threadIds: string[]; reason?: string }) => Promise<void>;
    acceptedIssueRevisionStatus?: AcceptedIssueRevisionAssistStatus;
    acceptedIssueRevisionCandidate?: AcceptedIssueRevisionCandidateView | null;
    acceptedIssueRevisionError?: string | null;
    acceptedIssueRevisionParagraphIndex?: number | null;
    onGenerateAcceptedIssueRevision?: (input: {
        paragraphIndex: number;
        threadIds: string[];
        targetRef: string;
    }) => Promise<void>;
    onApplyAcceptedIssueRevision?: (suggestion: AcceptedIssueRevisionSuggestionView) => Promise<void>;
    onIgnoreAcceptedIssueRevision?: () => void;
    viewerUserId?: number | null;
    temporaryEditGrants?: TemporaryEditGrantView[];
    canRequestTemporaryEditGrant?: boolean;
    canManageTemporaryEditGrants?: boolean;
    temporaryEditGrantError?: string | null;
    onRequestTemporaryEditGrant?: (input: { blockId: string }) => Promise<void>;
    onIssueTemporaryEditGrant?: (input: { grantId: string }) => Promise<void>;
    onRevokeTemporaryEditGrant?: (input: { grantId: string }) => Promise<void>;
    onKnowledgeReferenceInserted?: (option: KnowledgeReferenceOption) => void;
}

function splitDraftHeader(
    rawTitle: string,
    t: ReturnType<typeof useI18n>,
): { primary: string; secondary: string | null } {
    const normalized = rawTitle.replace(/\s+/g, ' ').trim();
    if (!normalized) {
        return { primary: t('fallback.untitledDraft'), secondary: null };
    }

    const bracketPrefixMatch = normalized.match(/^(【[^】]{1,40}】)\s*(.+)$/u);
    if (bracketPrefixMatch) {
        return {
            primary: bracketPrefixMatch[1],
            secondary: bracketPrefixMatch[2] || null,
        };
    }

    const probeStart = 18;
    if (normalized.length > probeStart + 6) {
        const punctuationOffset = normalized
            .slice(probeStart)
            .search(/[。！？；;，,]/u);
        if (punctuationOffset >= 0) {
            const splitAt = probeStart + punctuationOffset + 1;
            const primary = normalized.slice(0, splitAt).trim();
            const secondary = normalized.slice(splitAt).trim();
            if (primary && secondary) {
                return { primary, secondary };
            }
        }
    }

    return { primary: normalized, secondary: null };
}

export default function CrucibleEditor({
    ydoc = null,
    replaceRequest = null,
    knowledgeReferenceOptions = [],
    insertReferenceRequest = null,
    paragraphEditRequest = null,
    draft,
    comments = [],
    onEdit,
    onDeleteParagraph,
    canDeleteParagraph = true,
    paragraphDeleteDisabledReason = null,
    onComment,
    onEditingBlockChange,
    canEdit = true,
    canComment = true,
    onSelectionParagraphChange,
    collabStatus,
    activeEditorsByBlockId = {},
    paragraphBlocks = [],
    selectedParagraphIndex = null,
    collaborationContentVersion = null,
    acceptedIssuesByParagraph = {},
    acceptedIssueExceptions = [],
    defaultIssueCarrySelections = {},
    canApplyAcceptedIssues = true,
    onApplyAcceptedIssues,
    acceptedIssueRevisionStatus = 'idle',
    acceptedIssueRevisionCandidate = null,
    acceptedIssueRevisionError = null,
    acceptedIssueRevisionParagraphIndex = null,
    onGenerateAcceptedIssueRevision,
    onApplyAcceptedIssueRevision,
    onIgnoreAcceptedIssueRevision,
    viewerUserId = null,
    temporaryEditGrants = [],
    canRequestTemporaryEditGrant = false,
    canManageTemporaryEditGrants = false,
    temporaryEditGrantError = null,
    onRequestTemporaryEditGrant,
    onIssueTemporaryEditGrant,
    onRevokeTemporaryEditGrant,
    onKnowledgeReferenceInserted,
}: CrucibleEditorProps) {
    const t = useI18n('CrucibleEditor');
    const [activeCommentParagraph, setActiveCommentParagraph] = useState<number | null>(null);
    const [editingParagraphIndex, setEditingParagraphIndex] = useState<number | null>(null);
    const [editingSessionVersions, setEditingSessionVersions] = useState<Record<number, string>>({});
    const [commentText, setCommentText] = useState('');
    const [issueCarrySelections, setIssueCarrySelections] = useState<Record<number, string[]>>({});
    const [issueCarryBusyParagraph, setIssueCarryBusyParagraph] = useState<number | null>(null);
    const [issueCarryError, setIssueCarryError] = useState<string | null>(null);
    const [grantBusyId, setGrantBusyId] = useState<string | null>(null);
    const [localGrantError, setLocalGrantError] = useState<string | null>(null);
    const onEditingBlockChangeRef = useRef(onEditingBlockChange);

    useEffect(() => {
        onEditingBlockChangeRef.current = onEditingBlockChange;
    }, [onEditingBlockChange]);

    const heatPercent = clampHeatScore(draft.heat);
    const heatState = resolveHeatState(heatPercent);
    const heatLabel = t(`heat.${heatState}`);
    const heatIcon = heatState === 'active'
        ? '🔥'
        : heatState === 'cooling'
            ? '❄️'
            : '🧊';
    const draftHeading = useMemo(() => splitDraftHeader(draft.title, t), [draft.title, t]);
    const paragraphValues = useMemo(
        () => splitCrucibleParagraphContent(draft.content),
        [draft.content],
    );
    const activeCollaborationContentVersion = String(collaborationContentVersion || 'unversioned');

    useEffect(() => {
        if (selectedParagraphIndex === null) {
            setActiveCommentParagraph(null);
        }
    }, [selectedParagraphIndex]);

    useEffect(() => {
        if (selectedParagraphIndex === null) return;
        setEditingParagraphIndex((current) => (current === null ? current : selectedParagraphIndex));
    }, [selectedParagraphIndex]);

    useEffect(() => {
        const blockId = editingParagraphIndex === null ? null : `paragraph:${editingParagraphIndex}`;
        onEditingBlockChangeRef.current?.(blockId);
        return () => {
            if (blockId) {
                onEditingBlockChangeRef.current?.(null);
            }
        };
    }, [editingParagraphIndex]);

    const selectParagraph = useCallback((paragraphIndex: number | null) => {
        onSelectionParagraphChange?.(paragraphIndex);
    }, [onSelectionParagraphChange]);

    const openCommentPanel = useCallback((paragraphIndex: number | null) => {
        setActiveCommentParagraph(paragraphIndex);
        selectParagraph(paragraphIndex);
    }, [selectParagraph]);

    const handleReadOnlyParagraphKeyDown = useCallback((event: KeyboardEvent, paragraphIndex: number) => {
        if (event.key !== 'Enter' && event.key !== ' ') return;
        event.preventDefault();
        openCommentPanel(paragraphIndex);
    }, [openCommentPanel]);

    useEffect(() => {
        if (!insertReferenceRequest) return;
        if (editingParagraphIndex !== null) return;
        if (selectedParagraphIndex === null) return;
        selectParagraph(selectedParagraphIndex);
        setEditingParagraphIndex(selectedParagraphIndex);
    }, [editingParagraphIndex, insertReferenceRequest, selectParagraph, selectedParagraphIndex]);

    const handleAddComment = useCallback(() => {
        if (activeCommentParagraph !== null && commentText.trim()) {
            onComment?.(activeCommentParagraph, commentText.trim());
            setCommentText('');
        }
    }, [activeCommentParagraph, commentText, onComment]);

    const handleParagraphEdit = useCallback((paragraphIndex: number, nextValue: string) => {
        const blockId = `paragraph:${paragraphIndex}`;
        onEdit?.(
            replaceCrucibleParagraphContent(draft.content, paragraphIndex, nextValue),
            { blockId, paragraphIndex },
        );
    }, [draft.content, onEdit]);

    const toggleIssueCarrySelection = useCallback((paragraphIndex: number, threadId: string) => {
        setIssueCarrySelections((prev) => {
            const current = prev[paragraphIndex] || [];
            const next = current.includes(threadId)
                ? current.filter((item) => item !== threadId)
                : [...current, threadId];
            return {
                ...prev,
                [paragraphIndex]: next,
            };
        });
    }, []);

    const completeParagraphEditing = useCallback(async (paragraphIndex: number) => {
        const selectedIssueIds = issueCarrySelections[paragraphIndex] || [];
        if (selectedIssueIds.length > 0 && onApplyAcceptedIssues) {
            setIssueCarryBusyParagraph(paragraphIndex);
            setIssueCarryError(null);
            try {
                await onApplyAcceptedIssues({
                    threadIds: selectedIssueIds,
                });
                setIssueCarrySelections((prev) => ({
                    ...prev,
                    [paragraphIndex]: [],
                }));
            } catch (error) {
                setIssueCarryError(error instanceof Error ? error.message : t('errors.applyAcceptedIssues'));
                return;
            } finally {
                setIssueCarryBusyParagraph(null);
            }
        }

        setEditingParagraphIndex(null);
    }, [issueCarrySelections, onApplyAcceptedIssues]);

    const generateAcceptedIssueRevision = useCallback(async (
        paragraphIndex: number,
        acceptedIssues: CrucibleAcceptedIssueCarryView[],
    ) => {
        if (!onGenerateAcceptedIssueRevision || acceptedIssues.length === 0) return;
        const selectedIssueIds = issueCarrySelections[paragraphIndex] || [];
        const threadIds = selectedIssueIds.length > 0
            ? selectedIssueIds
            : acceptedIssues.map((issue) => issue.threadId);
        setIssueCarryError(null);
        try {
            await onGenerateAcceptedIssueRevision({
                paragraphIndex,
                threadIds,
                targetRef: `paragraph:${paragraphIndex}`,
            });
        } catch (error) {
            setIssueCarryError(error instanceof Error ? error.message : t('acceptedIssueRevision.errors.generate'));
        }
    }, [issueCarrySelections, onGenerateAcceptedIssueRevision, t]);

    const applyAcceptedIssueRevision = useCallback(async (
        paragraphIndex: number,
        suggestion: AcceptedIssueRevisionSuggestionView,
    ) => {
        if (!onApplyAcceptedIssueRevision) return;
        setIssueCarryError(null);
        try {
            await onApplyAcceptedIssueRevision(suggestion);
            setIssueCarrySelections((prev) => ({
                ...prev,
                [paragraphIndex]: (prev[paragraphIndex] || [])
                    .filter((threadId) => !suggestion.threadIds.includes(threadId)),
            }));
        } catch (error) {
            setIssueCarryError(error instanceof Error ? error.message : t('acceptedIssueRevision.errors.apply'));
        }
    }, [onApplyAcceptedIssueRevision, t]);

    const beginParagraphEditing = useCallback((
        paragraphIndex: number,
        options: { ensureIssueThreadId?: string | null } = {},
    ) => {
        selectParagraph(paragraphIndex);
        setActiveCommentParagraph(null);
        setIssueCarryError(null);

        setEditingParagraphIndex(paragraphIndex);
        setEditingSessionVersions((prev) => ({
            ...prev,
            [paragraphIndex]: activeCollaborationContentVersion,
        }));
        setIssueCarrySelections((prev) => ({
            ...prev,
            [paragraphIndex]: (() => {
                const base = Object.prototype.hasOwnProperty.call(prev, paragraphIndex)
                    ? (prev[paragraphIndex] || [])
                    : (defaultIssueCarrySelections[paragraphIndex] || []);
                const ensuredThreadId = options.ensureIssueThreadId;
                if (!ensuredThreadId || base.includes(ensuredThreadId)) return base;
                return [...base, ensuredThreadId];
            })(),
        }));
    }, [activeCollaborationContentVersion, defaultIssueCarrySelections, selectParagraph]);

    useEffect(() => {
        if (!paragraphEditRequest) return;
        if (!Number.isFinite(paragraphEditRequest.paragraphIndex) || paragraphEditRequest.paragraphIndex < 0) return;
        if (paragraphEditRequest.paragraphIndex >= paragraphValues.length) return;
        beginParagraphEditing(paragraphEditRequest.paragraphIndex, {
            ensureIssueThreadId: paragraphEditRequest.issueThreadId || null,
        });
    }, [beginParagraphEditing, paragraphEditRequest, paragraphValues.length]);

    const requestTemporaryEditGrant = useCallback(async (blockId: string) => {
        if (!onRequestTemporaryEditGrant) return;
        setGrantBusyId(blockId);
        setLocalGrantError(null);
        try {
            await onRequestTemporaryEditGrant({ blockId });
        } catch (error) {
            setLocalGrantError(error instanceof Error ? error.message : t('errors.requestTemporaryGrant'));
        } finally {
            setGrantBusyId(null);
        }
    }, [onRequestTemporaryEditGrant]);

    const issueTemporaryEditGrant = useCallback(async (grantId: string) => {
        if (!onIssueTemporaryEditGrant) return;
        setGrantBusyId(grantId);
        setLocalGrantError(null);
        try {
            await onIssueTemporaryEditGrant({ grantId });
        } catch (error) {
            setLocalGrantError(error instanceof Error ? error.message : t('errors.issueTemporaryGrant'));
        } finally {
            setGrantBusyId(null);
        }
    }, [onIssueTemporaryEditGrant]);

    const revokeTemporaryEditGrant = useCallback(async (grantId: string) => {
        if (!onRevokeTemporaryEditGrant) return;
        setGrantBusyId(grantId);
        setLocalGrantError(null);
        try {
            await onRevokeTemporaryEditGrant({ grantId });
        } catch (error) {
            setLocalGrantError(error instanceof Error ? error.message : t('errors.revokeTemporaryGrant'));
        } finally {
            setGrantBusyId(null);
        }
    }, [onRevokeTemporaryEditGrant]);

    const renderedBlocks = paragraphBlocks.length > 0
        ? paragraphBlocks
        : paragraphValues.map((paragraph, index) => ({
            index,
            blockId: `paragraph:${index}`,
            title: t('blocks.title', { index: index + 1 }),
            preview: paragraph,
            typeLabel: t('blocks.typeLabel'),
            sourceLabel: 'V?',
            statusLabel: t('blocks.statusLabel'),
            editabilityLabel: canEdit ? t('blocks.editabilityEditable') : t('blocks.editabilityReadOnly'),
            discussionCount: comments.filter((item) => item.paragraphIndex === index).length,
            isActive: selectedParagraphIndex === index,
            canEditParagraph: canEdit,
            permissionSources: [],
        }));
    const hasEditableParagraphs = renderedBlocks.some((block) => block.canEditParagraph);

    return (
        <div className={styles.editor} data-testid="crucible-editor">
            <div className={styles.header}>
                <div className={styles.headerTop}>
                    <div className={styles.titleBlock}>
                        <h2 className={styles.title}>{draftHeading.primary}</h2>
                        {draftHeading.secondary && (
                            <p className={styles.titleSub}>{draftHeading.secondary}</p>
                        )}
                    </div>
                    <div className={styles.headerRight}>
                        {collabStatus && (
                            <div className={styles.collabStatus}>
                                <span className={`${styles.connDot} ${collabStatus.isConnected ? styles.connDotOnline : ''}`} />
                                <span className={styles.connCount}>
                                    {t('meta.onlineCount', { count: collabStatus.connectedUsers.length })}
                                </span>
                            </div>
                        )}
                        <div className={`${styles.heatBadge} ${styles[heatState]}`}>
                            {heatIcon} {heatLabel} {Math.round(heatPercent)}°
                        </div>
                    </div>
                </div>
                <div className={styles.meta}>
                    <span>{t('meta.editCount', { count: draft.editCount })}</span>
                    <span>·</span>
                    <span>{t('meta.contributorCount', { count: draft.contributors.length })}</span>
                </div>
            </div>

            <div className={styles.document}>
                {acceptedIssueExceptions.length > 0 && (
                    <div className={styles.acceptedIssueExceptionPanel}>
                        <p className={styles.issueCarryTitle}>{t('acceptedIssueExceptions.title')}</p>
                        <div className={styles.issueCarryList}>
                            {acceptedIssueExceptions.map((issue) => (
                                <div key={issue.threadId} className={styles.acceptedIssueExceptionItem}>
                                    <span className={styles.issueCarryText}>{issue.summary}</span>
                                    <span className={styles.acceptedIssueExceptionReason}>
                                        {t(`acceptedIssueExceptions.reasons.${issue.reason}`)}
                                    </span>
                                </div>
                            ))}
                        </div>
                    </div>
                )}
                <div className={styles.paragraphStage}>
                    {renderedBlocks.map((block) => {
                        const paragraphText = paragraphValues[block.index] ?? '';
                        const grantControls = resolveTemporaryGrantControls({
                            blockId: block.blockId,
                            temporaryEditGrants,
                            viewerUserId,
                            baseCanEditParagraph:
                                block.canEditParagraph
                                && block.editabilityLabel !== t('blocks.editabilityLocked'),
                            canRequestTemporaryEditGrant,
                            canManageTemporaryEditGrants,
                            hasError: Boolean(localGrantError || temporaryEditGrantError),
                        });
                        const isEditableParagraph = grantControls.isEditableParagraph;
                        const isEditingParagraph = editingParagraphIndex === block.index && isEditableParagraph;
                        const editorSessionVersion = editingSessionVersions[block.index]
                            || activeCollaborationContentVersion;
                        const collaborationField = `${block.blockId}:wc:${editorSessionVersion}`;
                        const isCommentPanelOpen = activeCommentParagraph === block.index && !isEditingParagraph;
                        const blockComments = comments.filter((comment) => comment.paragraphIndex === block.index);
                        const remoteEditors = activeEditorsByBlockId[block.blockId] || [];
                        const remoteEditorNames = remoteEditors
                            .map((editor) => editor.name)
                            .filter(Boolean)
                            .slice(0, 2)
                            .join(', ');
                        const isSourceParticipantScoped = block.permissionSources.includes('source_participant') && !canEdit;
                        const isTemporaryGrantScoped = block.permissionSources.includes('temporary_grant') && !canEdit;
                        const scopedPermissionHint = isSourceParticipantScoped
                            ? t('blocks.sourceParticipantHint')
                            : isTemporaryGrantScoped
                                ? t('temporaryGrant.active')
                                : null;
                        const acceptedIssues = acceptedIssuesByParagraph[block.index] || [];
                        const selectedIssueIds = issueCarrySelections[block.index] || [];
                        const revisionTargetRef = `paragraph:${block.index}`;
                        const revisionSuggestion = acceptedIssueRevisionCandidate?.suggestions.find((suggestion) => (
                            suggestion.targetType === 'paragraph'
                            && suggestion.targetRef === revisionTargetRef
                        )) || null;
                        const isRevisionTarget = acceptedIssueRevisionParagraphIndex === block.index || Boolean(revisionSuggestion);
                        const isRevisionPending = isRevisionTarget && acceptedIssueRevisionStatus === 'pending';
                        const isRevisionApplying = isRevisionTarget && acceptedIssueRevisionStatus === 'applied';
                        const canGenerateRevision = Boolean(
                            onGenerateAcceptedIssueRevision
                            && canApplyAcceptedIssues
                            && acceptedIssues.length > 0,
                        );
                        const revisionIssueCount = selectedIssueIds.length > 0
                            ? selectedIssueIds.length
                            : acceptedIssues.length;
                        const issueActionLabel = selectedIssueIds.length > 0
                            ? t('actions.completeEditingResolve', { count: selectedIssueIds.length })
                            : t('actions.completeEditing');
                        const grantHintText = grantControls.managerMode === 'requested'
                            ? t('temporaryGrant.managerRequested')
                            : grantControls.managerMode === 'active'
                                ? t('temporaryGrant.managerActive')
                                : grantControls.viewerRequestedGrant
                                    ? t('temporaryGrant.requested')
                                    : grantControls.viewerExpiredGrant
                                        ? t('temporaryGrant.expired')
                                        : t('temporaryGrant.hint');

                        return (
                            <section
                                key={block.blockId}
                                className={`${styles.paragraphBlock} ${block.isActive ? styles.paragraphBlockActive : ''}`}
                            >
                                <div className={styles.paragraphHeader}>
                                    <div className={styles.paragraphMetaRow}>
                                        <span className={styles.paragraphMetaItem}>{block.title}</span>
                                        <span className={styles.paragraphMetaItem}>{block.sourceLabel}</span>
                                        <button
                                            type="button"
                                            className={styles.paragraphMetaButton}
                                            onClick={() => openCommentPanel(block.index)}
                                        >
                                            {t('meta.commentCount', { count: blockComments.length })}
                                        </button>
                                        <span className={styles.paragraphMetaItem}>{t('meta.issueCount', { count: block.discussionCount })}</span>
                                        {block.permissionSources.includes('source_participant') && (
                                            <span className={styles.paragraphMetaItem}>{t('blocks.sourceParticipant')}</span>
                                        )}
                                        {block.permissionSources.includes('temporary_grant') && (
                                            <span className={styles.paragraphMetaItem}>{t('blocks.temporaryGrant')}</span>
                                        )}
                                        {remoteEditors.length > 0 && (
                                            <span className={`${styles.paragraphMetaItem} ${styles.paragraphRemoteEditors}`}>
                                                {t('collaboration.editingParagraph', { names: remoteEditorNames })}
                                            </span>
                                        )}
                                        <span className={styles.paragraphMetaItem}>{block.editabilityLabel}</span>
                                        <span className={styles.paragraphMetaItem}>{block.statusLabel}</span>
                                    </div>
                                    {isEditableParagraph ? (
                                        <div className={styles.paragraphActionGroup}>
                                            <button
                                                type="button"
                                                className={styles.paragraphAction}
                                                onClick={() => beginParagraphEditing(block.index)}
                                                disabled={issueCarryBusyParagraph === block.index || isEditingParagraph}
                                            >
                                                {isEditingParagraph ? t('actions.editing') : t('actions.editParagraph')}
                                            </button>
                                            {canEdit && onDeleteParagraph && (
                                                <button
                                                    type="button"
                                                    className={`${styles.paragraphAction} ${styles.paragraphDeleteAction}`}
                                                    onClick={() => onDeleteParagraph(block.index)}
                                                    disabled={!canDeleteParagraph || issueCarryBusyParagraph === block.index || isEditingParagraph || paragraphValues.length <= 1}
                                                    aria-label={t('actions.deleteParagraph')}
                                                    title={!canDeleteParagraph ? paragraphDeleteDisabledReason || undefined : undefined}
                                                >
                                                    <Trash2 size={13} aria-hidden="true" />
                                                    <span>{t('actions.deleteParagraph')}</span>
                                                </button>
                                            )}
                                        </div>
                                    ) : (
                                        <button
                                            type="button"
                                            className={styles.paragraphAction}
                                            onClick={() => openCommentPanel(block.index)}
                                        >
                                            {t('actions.viewDiscussion')}
                                        </button>
                                    )}
                                </div>

                                {grantControls.showPanel && (
                                    <div className={styles.issueCarryPanel}>
                                        <p className={styles.issueCarryTitle}>{t('temporaryGrant.title')}</p>
                                        <p className={styles.issueCarryHint}>
                                            {grantHintText}
                                        </p>
                                        {grantControls.canRequest && (
                                            <div className={styles.paragraphEditorActions}>
                                                <button
                                                    type="button"
                                                    className={styles.paragraphCompleteButton}
                                                    onClick={() => { void requestTemporaryEditGrant(block.blockId); }}
                                                    disabled={grantBusyId === block.blockId}
                                                >
                                                    {grantBusyId === block.blockId ? t('actions.submitting') : t('actions.requestTemporaryGrant')}
                                                </button>
                                            </div>
                                        )}
                                        {grantControls.canIssue && grantControls.requestedGrant && (
                                            <div className={styles.paragraphEditorActions}>
                                                <button
                                                    type="button"
                                                    className={styles.paragraphCompleteButton}
                                                    onClick={() => { void issueTemporaryEditGrant(grantControls.requestedGrant!.grantId); }}
                                                    disabled={grantBusyId === grantControls.requestedGrant.grantId}
                                                >
                                                    {grantBusyId === grantControls.requestedGrant.grantId ? t('actions.processing') : t('actions.issueTemporaryGrant')}
                                                </button>
                                            </div>
                                        )}
                                        {grantControls.canRevoke && grantControls.activeGrant && (
                                            <div className={styles.paragraphEditorActions}>
                                                <button
                                                    type="button"
                                                    className={styles.paragraphCompleteButton}
                                                    onClick={() => { void revokeTemporaryEditGrant(grantControls.activeGrant!.grantId); }}
                                                    disabled={grantBusyId === grantControls.activeGrant.grantId}
                                                >
                                                    {grantBusyId === grantControls.activeGrant.grantId ? t('actions.processing') : t('actions.revokeTemporaryGrant')}
                                                </button>
                                            </div>
                                        )}
                                        {(localGrantError || temporaryEditGrantError) && (
                                            <p className={styles.issueCarryError}>
                                                {localGrantError || temporaryEditGrantError}
                                            </p>
                                        )}
                                    </div>
                                )}

                                {scopedPermissionHint && (
                                    <p className={styles.paragraphPermissionHint}>
                                        {scopedPermissionHint}
                                    </p>
                                )}

                                {isEditingParagraph && canApplyAcceptedIssues && acceptedIssues.length > 0 && (
                                    <div className={styles.issueCarryPanel}>
                                        <p className={styles.issueCarryTitle}>{t('issueCarry.title')}</p>
                                        <div className={styles.issueCarryList}>
                                            {acceptedIssues.map((issue) => {
                                                const checked = selectedIssueIds.includes(issue.threadId);
                                                return (
                                                    <label key={issue.threadId} className={styles.issueCarryItem}>
                                                        <input
                                                            type="checkbox"
                                                            checked={checked}
                                                            onChange={() => toggleIssueCarrySelection(block.index, issue.threadId)}
                                                            disabled={issueCarryBusyParagraph === block.index}
                                                        />
                                                        <span className={styles.issueCarryText}>{issue.summary}</span>
                                                    </label>
                                                );
                                            })}
                                        </div>
                                        <p className={styles.issueCarryHint}>
                                            {t('issueCarry.hint')}
                                        </p>
                                        {canGenerateRevision && (
                                            <div className={styles.acceptedIssueRevision}>
                                                <div className={styles.acceptedIssueRevisionHeader}>
                                                    <div>
                                                        <p className={styles.acceptedIssueRevisionTitle}>
                                                            {t('acceptedIssueRevision.title')}
                                                        </p>
                                                        <p className={styles.acceptedIssueRevisionHint}>
                                                            {t('acceptedIssueRevision.hint', { count: revisionIssueCount })}
                                                        </p>
                                                    </div>
                                                    <button
                                                        type="button"
                                                        className={styles.acceptedIssueRevisionButton}
                                                        onClick={() => { void generateAcceptedIssueRevision(block.index, acceptedIssues); }}
                                                        disabled={isRevisionPending || issueCarryBusyParagraph === block.index}
                                                    >
                                                        {isRevisionPending
                                                            ? t('acceptedIssueRevision.actions.generating')
                                                            : t('acceptedIssueRevision.actions.generate')}
                                                    </button>
                                                </div>
                                                {isRevisionTarget && acceptedIssueRevisionError && (
                                                    <p className={styles.issueCarryError}>{acceptedIssueRevisionError}</p>
                                                )}
                                                {revisionSuggestion && (
                                                    <div className={styles.acceptedIssueRevisionPreview}>
                                                        <p className={styles.acceptedIssueRevisionSummary}>
                                                            {revisionSuggestion.summary || t('acceptedIssueRevision.defaultSummary')}
                                                        </p>
                                                        <div className={styles.acceptedIssueRevisionCompare}>
                                                            <div>
                                                                <span>{t('acceptedIssueRevision.before')}</span>
                                                                <p>{paragraphText || t('fallback.emptyParagraph')}</p>
                                                            </div>
                                                            <div>
                                                                <span>{t('acceptedIssueRevision.after')}</span>
                                                                <p>{revisionSuggestion.suggestedText}</p>
                                                            </div>
                                                        </div>
                                                        <div className={styles.acceptedIssueRevisionActions}>
                                                            <button
                                                                type="button"
                                                                className={styles.paragraphCompleteButton}
                                                                onClick={() => { void applyAcceptedIssueRevision(block.index, revisionSuggestion); }}
                                                                disabled={issueCarryBusyParagraph === block.index || acceptedIssueRevisionStatus === 'pending'}
                                                            >
                                                                {isRevisionApplying
                                                                    ? t('acceptedIssueRevision.actions.applied')
                                                                    : t('acceptedIssueRevision.actions.apply')}
                                                            </button>
                                                            {onIgnoreAcceptedIssueRevision && (
                                                                <button
                                                                    type="button"
                                                                    className={styles.acceptedIssueRevisionSecondaryButton}
                                                                    onClick={onIgnoreAcceptedIssueRevision}
                                                                    disabled={acceptedIssueRevisionStatus === 'pending'}
                                                                >
                                                                    {t('acceptedIssueRevision.actions.ignore')}
                                                                </button>
                                                            )}
                                                        </div>
                                                    </div>
                                                )}
                                            </div>
                                        )}
                                        {issueCarryError && (
                                            <p className={styles.issueCarryError}>{issueCarryError}</p>
                                        )}
                                    </div>
                                )}

                                {isEditingParagraph ? (
                                    <>
                                        {ydoc ? (
                                            <CollaborativeEditor
                                                key={collaborationField}
                                                ydoc={ydoc}
                                                field={collaborationField}
                                                compact
                                                singleParagraph
                                                editable={isEditableParagraph}
                                                initialContent={paragraphText}
                                                knowledgeReferenceOptions={knowledgeReferenceOptions}
                                                insertReferenceRequest={insertReferenceRequest}
                                                replaceRequest={replaceRequest
                                                    ? {
                                                        token: replaceRequest.token,
                                                        content: paragraphText,
                                                    }
                                                    : null}
                                                placeholder={t('placeholders.continueParagraph', { title: block.title })}
                                                onSelectionParagraphChange={() => selectParagraph(block.index)}
                                                onUpdate={(nextParagraph) => handleParagraphEdit(block.index, nextParagraph)}
                                                onKnowledgeReferenceInserted={onKnowledgeReferenceInserted}
                                            />
                                        ) : (
                                            <div className={styles.readOnlyHint}>
                                                {t('readOnly.editorDisconnected')}
                                            </div>
                                        )}
                                        <p className={styles.singleParagraphHint}>
                                            {t('readOnly.singleParagraphHint')}
                                        </p>
                                        <div className={styles.paragraphEditorActions}>
                                            <button
                                                type="button"
                                                className={styles.paragraphCompleteButton}
                                                onClick={() => { void completeParagraphEditing(block.index); }}
                                                disabled={issueCarryBusyParagraph === block.index}
                                            >
                                                {issueCarryBusyParagraph === block.index ? t('actions.completing') : issueActionLabel}
                                            </button>
                                        </div>
                                    </>
                                ) : (
                                    <div
                                        role="button"
                                        tabIndex={0}
                                        className={styles.paragraphReadOnly}
                                        onClick={() => openCommentPanel(block.index)}
                                        onKeyDown={(event) => handleReadOnlyParagraphKeyDown(event, block.index)}
                                    >
                                        <CrystalReferenceText text={paragraphText || t('fallback.emptyParagraph')} />
                                    </div>
                                )}

                                {isCommentPanelOpen && (
                                    <motion.div
                                        className={styles.commentPanel}
                                        initial={{ opacity: 0, y: 8 }}
                                        animate={{ opacity: 1, y: 0 }}
                                        transition={{ duration: 0.18 }}
                                    >
                                        <div className={styles.commentPanelHeader}>
                                            <span className={styles.commentPanelTitle}>
                                                {t('comments.title', { index: block.index + 1 })}
                                            </span>
                                            <button
                                                className={styles.closeBtn}
                                                onClick={() => openCommentPanel(null)}
                                            >
                                                ✕
                                            </button>
                                        </div>

                                        <div className={styles.commentList}>
                                            {blockComments.map((comment) => (
                                                <div key={comment.id} className={styles.commentItem}>
                                                    <span className={styles.commentAuthor}>{comment.author}</span>
                                                    <p className={styles.commentText}>{comment.text}</p>
                                                    <span className={styles.commentTime}>{comment.createdAt}</span>
                                                </div>
                                            ))}
                                            {blockComments.length === 0 && (
                                                <p className={styles.noComments}>{t('comments.empty')}</p>
                                            )}
                                        </div>

                                        {canComment ? (
                                            <div className={styles.commentInput}>
                                                <input
                                                    type="text"
                                                    value={commentText}
                                                    onChange={(event) => setCommentText(event.target.value)}
                                                    placeholder={t('comments.placeholder')}
                                                    onKeyDown={(event) => event.key === 'Enter' && handleAddComment()}
                                                />
                                                <button onClick={handleAddComment} disabled={!commentText.trim()}>
                                                    {t('actions.send')}
                                                </button>
                                            </div>
                                        ) : (
                                            <div className={styles.readOnlyHint}>
                                                {t('readOnly.commentLocked')}
                                            </div>
                                        )}
                                    </motion.div>
                                )}
                            </section>
                        );
                    })}
                </div>

                {!canEdit && !hasEditableParagraphs && (
                    <div className={styles.readOnlyHint}>
                        {t('readOnly.contentLocked')}
                    </div>
                )}
                {!canEdit && hasEditableParagraphs && (
                    <div className={styles.readOnlyHint}>
                        {t('readOnly.scopedContent')}
                    </div>
                )}
            </div>
        </div>
    );
}
