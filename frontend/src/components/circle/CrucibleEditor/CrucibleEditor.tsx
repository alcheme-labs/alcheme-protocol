'use client';

import { useState, useCallback, useMemo, useEffect } from 'react';
import { motion } from 'framer-motion';
import type * as Y from 'yjs';
import {
    replaceCrucibleParagraphContent,
    splitCrucibleParagraphContent,
    type CrucibleAcceptedIssueCarryView,
    type CrucibleParagraphBlockView,
} from '@/lib/circle/crucibleViewModel';
import { clampHeatScore, resolveHeatState } from '@/lib/heat/semantics';
import type { KnowledgeReferenceOption } from '@/lib/circle/knowledgeReferenceOptions';
import { useI18n } from '@/i18n/useI18n';
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

interface CrucibleEditorProps {
    ydoc?: Y.Doc | null;
    replaceRequest?: { token: number; content: string } | null;
    knowledgeReferenceOptions?: KnowledgeReferenceOption[];
    insertReferenceRequest?: CrucibleEditorInsertReferenceRequest | null;
    draft: Draft;
    comments?: DraftComment[];
    onEdit?: (content: string) => void;
    onComment?: (paragraphIndex: number, text: string) => void;
    canEdit?: boolean;
    canComment?: boolean;
    onSelectionParagraphChange?: (paragraphIndex: number | null) => void;
    collabStatus?: CollabStatus;
    paragraphBlocks?: CrucibleParagraphBlockView[];
    selectedParagraphIndex?: number | null;
    acceptedIssuesByParagraph?: Record<number, CrucibleAcceptedIssueCarryView[]>;
    defaultIssueCarrySelections?: Record<number, string[]>;
    canApplyAcceptedIssues?: boolean;
    onApplyAcceptedIssues?: (input: { threadIds: string[]; reason?: string }) => Promise<void>;
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
    draft,
    comments = [],
    onEdit,
    onComment,
    canEdit = true,
    canComment = true,
    onSelectionParagraphChange,
    collabStatus,
    paragraphBlocks = [],
    selectedParagraphIndex = null,
    acceptedIssuesByParagraph = {},
    defaultIssueCarrySelections = {},
    canApplyAcceptedIssues = true,
    onApplyAcceptedIssues,
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
    const [commentText, setCommentText] = useState('');
    const [issueCarrySelections, setIssueCarrySelections] = useState<Record<number, string[]>>({});
    const [issueCarryBusyParagraph, setIssueCarryBusyParagraph] = useState<number | null>(null);
    const [issueCarryError, setIssueCarryError] = useState<string | null>(null);
    const [grantBusyId, setGrantBusyId] = useState<string | null>(null);
    const [localGrantError, setLocalGrantError] = useState<string | null>(null);

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

    useEffect(() => {
        if (selectedParagraphIndex === null) {
            setActiveCommentParagraph(null);
        }
    }, [selectedParagraphIndex]);

    useEffect(() => {
        if (selectedParagraphIndex === null) return;
        setEditingParagraphIndex((current) => (current === null ? current : selectedParagraphIndex));
    }, [selectedParagraphIndex]);

    const selectParagraph = useCallback((paragraphIndex: number | null) => {
        onSelectionParagraphChange?.(paragraphIndex);
    }, [onSelectionParagraphChange]);

    const openCommentPanel = useCallback((paragraphIndex: number | null) => {
        setActiveCommentParagraph(paragraphIndex);
        selectParagraph(paragraphIndex);
    }, [selectParagraph]);

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
        onEdit?.(replaceCrucibleParagraphContent(draft.content, paragraphIndex, nextValue));
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

    const beginParagraphEditing = useCallback((paragraphIndex: number) => {
        selectParagraph(paragraphIndex);
        setActiveCommentParagraph(null);
        setIssueCarryError(null);

        setEditingParagraphIndex(paragraphIndex);
        setIssueCarrySelections((prev) => ({
            ...prev,
            [paragraphIndex]: Object.prototype.hasOwnProperty.call(prev, paragraphIndex)
                ? (prev[paragraphIndex] || [])
                : (defaultIssueCarrySelections[paragraphIndex] || []),
        }));
    }, [defaultIssueCarrySelections, selectParagraph]);

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
        }));

    return (
        <div className={styles.editor}>
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
                <div className={styles.paragraphStage}>
                    {renderedBlocks.map((block) => {
                        const paragraphText = paragraphValues[block.index] ?? '';
                        const grantControls = resolveTemporaryGrantControls({
                            blockId: block.blockId,
                            temporaryEditGrants,
                            viewerUserId,
                            baseCanEditParagraph:
                                canEdit
                                && block.editabilityLabel !== t('blocks.editabilityLocked'),
                            canRequestTemporaryEditGrant,
                            canManageTemporaryEditGrants,
                            hasError: Boolean(localGrantError || temporaryEditGrantError),
                        });
                        const isEditableParagraph = grantControls.isEditableParagraph;
                        const isEditingParagraph = editingParagraphIndex === block.index && isEditableParagraph;
                        const isCommentPanelOpen = activeCommentParagraph === block.index && !isEditingParagraph;
                        const blockComments = comments.filter((comment) => comment.paragraphIndex === block.index);
                        const acceptedIssues = acceptedIssuesByParagraph[block.index] || [];
                        const selectedIssueIds = issueCarrySelections[block.index] || [];
                        const issueActionLabel = selectedIssueIds.length > 0
                            ? t('actions.completeEditingResolve', { count: selectedIssueIds.length })
                            : t('actions.completeEditing');
                        const grantHintText = grantControls.managerMode === 'requested'
                            ? t('temporaryGrant.managerRequested')
                            : grantControls.managerMode === 'active'
                                ? t('temporaryGrant.managerActive')
                                : grantControls.viewerRequestedGrant
                                    ? t('temporaryGrant.requested')
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
                                        <span className={styles.paragraphMetaItem}>{block.editabilityLabel}</span>
                                        <span className={styles.paragraphMetaItem}>{block.statusLabel}</span>
                                    </div>
                                    {isEditableParagraph ? (
                                        <button
                                            type="button"
                                            className={styles.paragraphAction}
                                            onClick={() => beginParagraphEditing(block.index)}
                                            disabled={issueCarryBusyParagraph === block.index || isEditingParagraph}
                                        >
                                            {isEditingParagraph ? t('actions.editing') : t('actions.editParagraph')}
                                        </button>
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
                                        {issueCarryError && (
                                            <p className={styles.issueCarryError}>{issueCarryError}</p>
                                        )}
                                    </div>
                                )}

                                {isEditingParagraph ? (
                                    <>
                                        {ydoc ? (
                                            <CollaborativeEditor
                                                ydoc={ydoc}
                                                field={block.blockId}
                                                compact
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
                                    <button
                                        type="button"
                                        className={styles.paragraphReadOnly}
                                        onClick={() => openCommentPanel(block.index)}
                                    >
                                        {paragraphText || t('fallback.emptyParagraph')}
                                    </button>
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

                {!canEdit && (
                    <div className={styles.readOnlyHint}>
                        {t('readOnly.contentLocked')}
                    </div>
                )}
            </div>
        </div>
    );
}
