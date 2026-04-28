'use client';

import { type ReactNode, useEffect, useMemo, useRef, useState } from 'react';
import { useCurrentLocale, useI18n } from '@/i18n/useI18n';

import type {
    DraftDiscussionIssueType,
    DraftDiscussionResolution,
    DraftDiscussionState,
    DraftDiscussionTargetType,
    DraftDiscussionThreadRecord,
} from '@/lib/api/discussion';
import {
    formatSeededReferenceLabel,
} from '@/lib/circle/draftPresentation';
import {
    extractCrucibleFileLineReferences,
    shouldResolveIssueViaParagraphEditing,
} from '@/lib/circle/crucibleViewModel';
import type { CrucibleGovernanceSummaryView } from '@/lib/circle/crucibleViewModel';
import type { SeededReferenceSelection } from '@/lib/api/circlesSeeded';
import styles from './DraftDiscussionPanel.module.css';

interface CreateDiscussionInput {
    targetType: DraftDiscussionTargetType;
    targetRef: string;
    targetVersion?: number;
    issueType: DraftDiscussionIssueType;
    content: string;
}

interface ProposeDiscussionInput {
    threadId: string;
    issueType?: DraftDiscussionIssueType;
    content: string;
}

interface ResolveDiscussionInput {
    threadId: string;
    resolution: DraftDiscussionResolution;
    issueType?: DraftDiscussionIssueType;
    reason?: string;
}

interface ReplyDiscussionInput {
    threadId: string;
    content: string;
}

interface WithdrawDiscussionInput {
    threadId: string;
    reason?: string;
}

interface ApplyDiscussionInput {
    threadId: string;
    reason?: string;
}

type RevisionDirectionAcceptanceMode =
    | 'manager_confirm'
    | 'role_confirm'
    | 'governance_vote';

type RevisionDirectionStatus =
    | 'open'
    | 'accepted'
    | 'rejected'
    | 'expired';

interface RevisionDirectionProposalRecord {
    revisionProposalId: string;
    draftPostId: number;
    draftVersion: number;
    scopeType: string;
    scopeRef: string;
    proposedBy: number | null;
    summary: string;
    acceptanceMode: RevisionDirectionAcceptanceMode;
    status: RevisionDirectionStatus;
    acceptedBy: number | null;
    acceptedAt: string | null;
    governanceProposalId: string | null;
    createdAt: string;
}

interface DraftDiscussionPanelProps {
    draftPostId: number;
    threads: DraftDiscussionThreadRecord[];
    loading: boolean;
    busy: boolean;
    error: string | null;
    viewerUserId?: number | null;
    canCreate: boolean;
    createDisabledReason: string | null;
    canFollowup: boolean;
    followupDisabledReason: string | null;
    canWithdrawOwn: boolean;
    withdrawDisabledReason: string | null;
    canStartReview: boolean;
    reviewDisabledReason: string | null;
    canRetag: boolean;
    retagDisabledReason: string | null;
    canResolve: boolean;
    resolveDisabledReason: string | null;
    canApply: boolean;
    applyDisabledReason: string | null;
    onCreate: (input: CreateDiscussionInput) => Promise<void>;
    onPropose: (input: ProposeDiscussionInput) => Promise<void>;
    onResolve: (input: ResolveDiscussionInput) => Promise<void>;
    onReply: (input: ReplyDiscussionInput) => Promise<void>;
    onWithdraw: (input: WithdrawDiscussionInput) => Promise<void>;
    onApply: (input: ApplyDiscussionInput) => Promise<void>;
    paragraphOptions?: Array<{
        index: number;
        preview: string;
    }>;
    selectedParagraphIndex?: number | null;
    onSelectParagraph?: (paragraphIndex: number | null) => void;
    currentDraftVersion?: number;
    governanceSummary?: CrucibleGovernanceSummaryView | null;
    selectedSeededReference?: SeededReferenceSelection | null;
    onSelectSeededReference?: (reference: SeededReferenceSelection) => void;
}

interface ApplyDraftState {
    reason: string;
}

interface ThreadDraftState {
    issueType: DraftDiscussionIssueType;
    propose: string;
    followup: string;
    resolve: string;
    apply: ApplyDraftState;
}

const EMPTY_APPLY_STATE: ApplyDraftState = {
    reason: '',
};

const DEFAULT_ISSUE_TYPE: DraftDiscussionIssueType = 'question_and_supplement';
const STATE_ORDER: DraftDiscussionState[] = [
    'open',
    'proposed',
    'accepted',
    'applied',
    'rejected',
    'withdrawn',
];
const ISSUE_TYPE_OPTIONS: DraftDiscussionIssueType[] = [
    'fact_correction',
    'expression_improvement',
    'knowledge_supplement',
    'question_and_supplement',
];
const REVISION_DIRECTION_ACCEPTANCE_MODES: RevisionDirectionAcceptanceMode[] = [
    'manager_confirm',
    'role_confirm',
    'governance_vote',
];

interface DraftSelectOption {
    value: string;
    label: string;
    disabled?: boolean;
}

interface DraftSelectProps {
    id: string;
    value: string;
    options: DraftSelectOption[];
    onChange: (value: string) => void;
    disabled?: boolean;
}

function DraftSelect({
    id,
    value,
    options,
    onChange,
    disabled = false,
}: DraftSelectProps) {
    const [open, setOpen] = useState(false);
    const rootRef = useRef<HTMLDivElement>(null);
    const triggerRef = useRef<HTMLButtonElement>(null);
    const listboxId = `${id}-listbox`;
    const selectedOption = options.find((option) => option.value === value);

    useEffect(() => {
        if (!open) return;

        const handlePointerDown = (event: PointerEvent) => {
            if (!rootRef.current?.contains(event.target as Node)) {
                setOpen(false);
            }
        };
        const handleKeyDown = (event: KeyboardEvent) => {
            if (event.key === 'Escape') {
                setOpen(false);
                triggerRef.current?.focus();
            }
        };

        document.addEventListener('pointerdown', handlePointerDown);
        document.addEventListener('keydown', handleKeyDown);
        return () => {
            document.removeEventListener('pointerdown', handlePointerDown);
            document.removeEventListener('keydown', handleKeyDown);
        };
    }, [open]);

    useEffect(() => {
        if (disabled) setOpen(false);
    }, [disabled]);

    const handleSelect = (nextValue: string) => {
        onChange(nextValue);
        setOpen(false);
        triggerRef.current?.focus();
    };

    return (
        <div className={styles.selectRoot} ref={rootRef}>
            <button
                id={id}
                ref={triggerRef}
                type="button"
                className={styles.selectTrigger}
                aria-haspopup="listbox"
                aria-expanded={open}
                aria-controls={open ? listboxId : undefined}
                disabled={disabled}
                onClick={() => setOpen((prev) => !prev)}
                onKeyDown={(event) => {
                    if (event.key === 'ArrowDown' || event.key === 'Enter' || event.key === ' ') {
                        event.preventDefault();
                        setOpen(true);
                    }
                }}
            >
                <span className={styles.selectValue}>
                    {selectedOption?.label || options[0]?.label || ''}
                </span>
                <span className={styles.selectChevron} aria-hidden="true" />
            </button>
            {open && !disabled && (
                <div id={listboxId} className={styles.selectMenu} role="listbox" aria-labelledby={id}>
                    {options.map((option) => {
                        const selected = option.value === value;
                        return (
                            <button
                                key={option.value}
                                type="button"
                                role="option"
                                aria-selected={selected}
                                className={`${styles.selectOption}${selected ? ` ${styles.selectOptionActive}` : ''}`}
                                disabled={option.disabled}
                                onClick={() => handleSelect(option.value)}
                            >
                                <span className={styles.selectOptionLabel}>{option.label}</span>
                            </button>
                        );
                    })}
                </div>
            )}
        </div>
    );
}

function formatRevisionDirectionAcceptanceMode(
    mode: RevisionDirectionAcceptanceMode,
    t: ReturnType<typeof useI18n>,
): string {
    if (mode === 'manager_confirm') return t('revisionDirections.acceptanceMode.managerConfirm');
    if (mode === 'role_confirm') return t('revisionDirections.acceptanceMode.roleConfirm');
    return t('revisionDirections.acceptanceMode.governanceVote');
}

function formatRevisionDirectionStatus(
    status: RevisionDirectionStatus,
    t: ReturnType<typeof useI18n>,
): string {
    if (status === 'accepted') return t('revisionDirections.status.accepted');
    if (status === 'rejected') return t('revisionDirections.status.rejected');
    if (status === 'expired') return t('revisionDirections.status.expired');
    return t('revisionDirections.status.open');
}

function parseParagraphRef(value: string): number | null {
    const matched = String(value || '').trim().match(/^paragraph:(\d+)$/i);
    if (!matched) return null;
    const index = Number.parseInt(matched[1], 10);
    if (!Number.isFinite(index) || index < 0) return null;
    return index;
}

function buildStructureTargetRef(indices: number[]): string {
    return indices
        .filter((value) => Number.isFinite(value) && value >= 0)
        .sort((left, right) => left - right)
        .map((value) => `paragraph:${value}`)
        .join(',');
}

function buildMessageLabel(messageType: string, t: ReturnType<typeof useI18n>): string {
    if (messageType === 'create') return t('messages.create');
    if (messageType === 'followup') return t('messages.followup');
    if (messageType === 'propose') return t('messages.propose');
    if (messageType === 'accept') return t('messages.accept');
    if (messageType === 'reject') return t('messages.reject');
    if (messageType === 'apply') return t('messages.apply');
    if (messageType === 'withdraw') return t('messages.withdraw');
    if (messageType === 'retag') return t('messages.retag');
    return t('messages.update');
}

function buildMessageContent(
    messageType: string,
    content: string | null,
    formatIssueType: (value: DraftDiscussionIssueType | null | undefined) => string,
    t: ReturnType<typeof useI18n>,
): string {
    const normalized = String(content || '').trim();
    if (!normalized) {
        if (messageType === 'retag') return t('messages.content.retag');
        if (messageType === 'withdraw') return t('messages.content.withdraw');
        if (messageType === 'accept') return t('messages.content.accept');
        if (messageType === 'reject') return t('messages.content.reject');
        if (messageType === 'apply') return t('messages.content.apply');
        return t('messages.content.empty');
    }
    if (messageType === 'retag') {
        return t('messages.content.retagWithType', {
            type: formatIssueType(normalized as DraftDiscussionIssueType),
        });
    }
    return normalized;
}

function formatMessageMeta(
    authorId: number,
    createdAt: string,
    locale: string,
    t: ReturnType<typeof useI18n>,
): string {
    const parsed = new Date(createdAt);
    const timeLabel = Number.isNaN(parsed.getTime())
        ? t('fallback.pendingTime')
        : new Intl.DateTimeFormat(locale, {
            month: 'numeric',
            day: 'numeric',
            hour: '2-digit',
            minute: '2-digit',
        }).format(parsed);
    return t('messages.meta', {authorId, time: timeLabel});
}

function normalizeThreadIssueType(thread: DraftDiscussionThreadRecord): DraftDiscussionIssueType {
    return thread.issueType || DEFAULT_ISSUE_TYPE;
}

function canReplyToThread(thread: DraftDiscussionThreadRecord): boolean {
    return thread.state === 'open' || thread.state === 'proposed' || thread.state === 'accepted';
}

function canWithdrawThread(thread: DraftDiscussionThreadRecord, viewerUserId?: number | null): boolean {
    return thread.state === 'open' && viewerUserId === thread.createdBy;
}

function appendSeededReferenceToContent(
    content: string,
    reference: SeededReferenceSelection | null | undefined,
): string {
    if (!reference) return content;
    const normalized = String(content || '').trimEnd();
    return normalized ? `${normalized}\n${reference.raw}` : reference.raw;
}

function renderMessageContentWithReferences(
    content: string,
    onSelectSeededReference?: (reference: SeededReferenceSelection) => void,
): ReactNode {
    const references = extractCrucibleFileLineReferences(content);
    if (references.length === 0) return content;

    const nodes: ReactNode[] = [];
    let cursor = 0;
    references.forEach((reference, index) => {
        if (reference.index > cursor) {
            nodes.push(
                <span key={`text:${index}:${cursor}`}>
                    {content.slice(cursor, reference.index)}
                </span>,
            );
        }
        const selection: SeededReferenceSelection = {
            raw: reference.raw,
            path: reference.path,
            line: reference.line,
            fileName: reference.path.split('/').pop() || reference.path,
        };
        nodes.push(
            <button
                key={reference.raw}
                type="button"
                className={styles.referenceButton}
                onClick={() => onSelectSeededReference?.(selection)}
            >
                {formatSeededReferenceLabel(selection)}
            </button>,
        );
        cursor = reference.index + reference.raw.length;
    });
    if (cursor < content.length) {
        nodes.push(
            <span key={`tail:${cursor}`}>
                {content.slice(cursor)}
            </span>,
        );
    }
    return nodes;
}

export default function DraftDiscussionPanel(props: DraftDiscussionPanelProps) {
    const t = useI18n('DraftDiscussionPanel');
    const locale = useCurrentLocale();
    const [targetType, setTargetType] = useState<DraftDiscussionTargetType>('paragraph');
    const [targetRef, setTargetRef] = useState('');
    const [targetIssueType, setTargetIssueType] = useState<DraftDiscussionIssueType>(DEFAULT_ISSUE_TYPE);
    const [structureTargetIndices, setStructureTargetIndices] = useState<number[]>([]);
    const [createContent, setCreateContent] = useState('');
    const [threadDrafts, setThreadDrafts] = useState<Record<string, ThreadDraftState>>({});
    const [inlineError, setInlineError] = useState<string | null>(null);
    /*
     * Product note:
     * The "accepted directions" panel is intentionally hidden for now.
     *
     * Why this UI is disabled:
     * 1. It duplicates information that already exists in issue resolution / governance outcomes.
     * 2. It records accepted directions, but it does not actually apply them to the draft body.
     * 3. In user testing, this created a second "decision ledger" on the draft page and made the
     *    workflow feel heavier without closing the loop.
     *
     * Why we keep the backend/data model:
     * - `RevisionDirectionProposal` is still useful as a possible future bridge between
     *   governance results and the next-round editing workflow.
     * - Keeping the types and request helpers here makes it easier to reactivate after the
     *   product flow is redesigned, without rediscovering the API surface from scratch.
     * - The matching `revisionDirections.*` i18n strings are intentionally kept for the same
     *   reason. JSON locale files do not support inline comments, so this note is the canonical
     *   reminder that those translations are dormant on purpose rather than accidentally unused.
     *
     * What must happen before re-enabling:
     * - Decide whether accepted directions are created automatically from issue/governance outcomes
     *   or remain a manual drafting tool.
     * - Connect accepted directions to an actual "apply to next revision" workflow instead of
     *   leaving them as a passive record.
     * - Re-enable the state, loading effect, and JSX block below together; do not restore only the
     *   visual panel, or the page will again expose a non-closing workflow.
     *
     * Cleanup TODO:
     * - If the redesign explicitly drops accepted directions as a product feature, remove the
     *   dormant request helpers/types below and then delete the `revisionDirections.*` locale keys
     *   in one cleanup pass so translators do not have to guess whether the strings are still live.
     */
    // const [revisionDirectionSummary, setRevisionDirectionSummary] = useState('');
    // const [acceptanceMode, setAcceptanceMode] = useState<RevisionDirectionAcceptanceMode>('manager_confirm');
    // const [revisionDirections, setRevisionDirections] = useState<RevisionDirectionProposalRecord[]>([]);
    // const [revisionDirectionError, setRevisionDirectionError] = useState<string | null>(null);
    // const [revisionDirectionBusy, setRevisionDirectionBusy] = useState(false);

    const groupedThreads = useMemo(() => {
        const groups = new Map<DraftDiscussionState, DraftDiscussionThreadRecord[]>();
        for (const state of STATE_ORDER) {
            groups.set(state, []);
        }
        for (const thread of props.threads) {
            const bucket = groups.get(thread.state) || [];
            bucket.push(thread);
            groups.set(thread.state, bucket);
        }
        return groups;
    }, [props.threads]);

    const paragraphOptions = props.paragraphOptions || [];
    const stableSnapshotVersion = Number.isFinite(props.currentDraftVersion as number)
        ? Number(props.currentDraftVersion)
        : 1;
    const selectedParagraphIndex = Number.isFinite(props.selectedParagraphIndex as number)
        ? Number(props.selectedParagraphIndex)
        : null;
    const selectedParagraphPreview = selectedParagraphIndex !== null
        ? paragraphOptions.find((option) => option.index === selectedParagraphIndex)?.preview || ''
        : '';
    const selectedStructureOptions = paragraphOptions.filter((option) => structureTargetIndices.includes(option.index));

    const isBlocked = props.busy;
    // Hidden with the accepted-directions panel. Keep the intended wiring nearby so the future
    // redesign can restore this as one coherent feature instead of re-inventing the permissions.
    // const canCreateRevisionDirection = props.canFollowup || props.canResolve || props.canStartReview;
    // const revisionDirectionDisabledReason =
    //     props.followupDisabledReason
    //     || props.resolveDisabledReason
    //     || props.reviewDisabledReason;
    // const canConfirmRevisionDirection = props.canResolve;
    // const revisionDirectionScopeType = selectedParagraphIndex !== null ? 'paragraph' : 'document';
    // const revisionDirectionScopeRef = selectedParagraphIndex !== null
    //     ? `paragraph:${selectedParagraphIndex}`
    //     : 'document';
    // const acceptedDirections = revisionDirections.filter((proposal) => proposal.status === 'accepted');
    const formatIssueType = (type: DraftDiscussionIssueType | null | undefined) => {
        if (type === 'fact_correction') return t('issueTypes.fact_correction');
        if (type === 'expression_improvement') return t('issueTypes.expression_improvement');
        if (type === 'knowledge_supplement') return t('issueTypes.knowledge_supplement');
        if (type === 'question_and_supplement') return t('issueTypes.question_and_supplement');
        return t('issueTypes.fallback');
    };
    const formatState = (state: DraftDiscussionState) => {
        if (state === 'open') return t('states.open');
        if (state === 'proposed') return t('states.proposed');
        if (state === 'accepted') return t('states.accepted');
        if (state === 'rejected') return t('states.rejected');
        if (state === 'withdrawn') return t('states.withdrawn');
        return t('states.applied');
    };
    const formatTargetType = (type: DraftDiscussionTargetType) => {
        if (type === 'paragraph') return t('targetTypes.paragraph');
        if (type === 'structure') return t('targetTypes.structure');
        return t('targetTypes.document');
    };
    const formatTargetLabel = (
        targetType: DraftDiscussionTargetType,
        targetRef: string | null | undefined,
    ) => {
        const normalizedRef = String(targetRef || '').trim();
        if (targetType === 'paragraph') {
            const matched = normalizedRef.match(/^paragraph:(\d+)$/i);
            if (matched) {
                const parsed = Number.parseInt(matched[1], 10);
                if (Number.isFinite(parsed) && parsed >= 0) {
                    return t('targetLabels.paragraphNumber', {index: parsed + 1});
                }
            }
            return normalizedRef
                ? t('targetLabels.paragraphRaw', {value: normalizedRef})
                : t('targetTypes.paragraph');
        }
        if (targetType === 'structure') {
            const paragraphMatches = Array.from(
                normalizedRef.matchAll(/paragraph:(\d+)/gi),
                (match) => Number.parseInt(match[1], 10),
            ).filter((value) => Number.isFinite(value) && value >= 0);
            if (paragraphMatches.length > 0) {
                return t('targetLabels.structureParagraphs', {
                    values: paragraphMatches.map((value) => String(value + 1)).join(', '),
                });
            }
        }
        if (targetType === 'document') {
            return t('targetTypes.document');
        }
        const targetTypeLabel = formatTargetType(targetType);
        return normalizedRef
            ? t('targetLabels.generic', {type: targetTypeLabel, value: normalizedRef})
            : targetTypeLabel;
    };

    /*
     * Hidden runtime wiring for accepted directions.
     *
     * These requests are intentionally commented out together with the JSX block below. If we only
     * hide the panel but keep these effects alive, the draft page continues polling/loading a
     * feature that users cannot see or act on. That costs runtime work and makes the page harder to
     * reason about during debugging.
     *
     * Future restore checklist:
     * 1. Re-enable the state above.
     * 2. Restore this loader/effect and action handlers.
     * 3. Restore the JSX panel.
     * 4. Verify that accepted directions now feed a real next-round editing flow.
     */
    // const loadRevisionDirections = async () => {
    //     setRevisionDirectionError(null);
    //     try {
    //         const route = await resolveNodeRoute('discussion_runtime');
    //         const baseUrl = route.urlBase;
    //         const payload = await requestRevisionDirection<{
    //             proposals: RevisionDirectionProposalRecord[];
    //             acceptedDirections: RevisionDirectionProposalRecord[];
    //         }>(
    //             `${baseUrl}/api/v1/revision-directions/drafts/${props.draftPostId}/revision-directions?draftVersion=${stableSnapshotVersion}`,
    //             {
    //                 method: 'GET',
    //                 credentials: 'include',
    //                 cache: 'no-store',
    //             },
    //         );
    //         setRevisionDirections(Array.isArray(payload.proposals) ? payload.proposals : []);
    //     } catch (error) {
    //         setRevisionDirectionError(error instanceof Error ? error.message : t('errors.loadRevisionDirections'));
    //     }
    // };

    // useEffect(() => {
    //     void loadRevisionDirections();
    //     // eslint-disable-next-line react-hooks/exhaustive-deps
    // }, [props.draftPostId, stableSnapshotVersion]);

    // const createRevisionDirection = async () => {
    //     setInlineError(null);
    //     setRevisionDirectionError(null);
    //     const normalizedSummary = revisionDirectionSummary.trim();
    //     if (!normalizedSummary) {
    //         setRevisionDirectionError(t('errors.revisionSummaryRequired'));
    //         return;
    //     }
    //     setRevisionDirectionBusy(true);
    //     try {
    //         const route = await resolveNodeRoute('discussion_runtime');
    //         const baseUrl = route.urlBase;
    //         await requestRevisionDirection<{
    //             proposal: RevisionDirectionProposalRecord;
    //         }>(
    //             `${baseUrl}/api/v1/revision-directions/drafts/${props.draftPostId}/revision-directions`,
    //             {
    //                 method: 'POST',
    //                 credentials: 'include',
    //                 cache: 'no-store',
    //                 headers: { 'Content-Type': 'application/json' },
    //                 body: JSON.stringify({
    //                     summary: normalizedSummary,
    //                     acceptanceMode,
    //                     scopeType: revisionDirectionScopeType,
    //                     scopeRef: revisionDirectionScopeRef,
    //                     ...(acceptanceMode === 'governance_vote'
    //                         ? {
    //                             electorateScope: 'qualified_roles',
    //                             voteRule: 'single_approver',
    //                             thresholdValue: 1,
    //                         }
    //                         : {}),
    //                 }),
    //             },
    //         );
    //         setRevisionDirectionSummary('');
    //         await loadRevisionDirections();
    //     } catch (error) {
    //         setRevisionDirectionError(error instanceof Error ? error.message : t('errors.createRevisionDirection'));
    //     } finally {
    //         setRevisionDirectionBusy(false);
    //     }
    // };

    // const acceptRevisionDirection = async (revisionProposalId: string) => {
    //     setRevisionDirectionBusy(true);
    //     setRevisionDirectionError(null);
    //     try {
    //         const route = await resolveNodeRoute('discussion_runtime');
    //         const baseUrl = route.urlBase;
    //         await requestRevisionDirection<{
    //             proposal: RevisionDirectionProposalRecord;
    //         }>(
    //             `${baseUrl}/api/v1/revision-directions/proposals/${revisionProposalId}/accept`,
    //             {
    //                 method: 'POST',
    //                 credentials: 'include',
    //                 cache: 'no-store',
    //             },
    //         );
    //         await loadRevisionDirections();
    //     } catch (error) {
    //         setRevisionDirectionError(error instanceof Error ? error.message : t('errors.acceptRevisionDirection'));
    //     } finally {
    //         setRevisionDirectionBusy(false);
    //     }
    // };

    // const rejectRevisionDirection = async (revisionProposalId: string) => {
    //     setRevisionDirectionBusy(true);
    //     setRevisionDirectionError(null);
    //     try {
    //         const route = await resolveNodeRoute('discussion_runtime');
    //         const baseUrl = route.urlBase;
    //         await requestRevisionDirection<{
    //             proposal: RevisionDirectionProposalRecord;
    //         }>(
    //             `${baseUrl}/api/v1/revision-directions/proposals/${revisionProposalId}/reject`,
    //             {
    //                 method: 'POST',
    //                 credentials: 'include',
    //                 cache: 'no-store',
    //             },
    //         );
    //         await loadRevisionDirections();
    //     } catch (error) {
    //         setRevisionDirectionError(error instanceof Error ? error.message : t('errors.rejectRevisionDirection'));
    //     } finally {
    //         setRevisionDirectionBusy(false);
    //     }
    // };

    const getThreadDraft = (thread: DraftDiscussionThreadRecord): ThreadDraftState => threadDrafts[thread.id] || {
        issueType: normalizeThreadIssueType(thread),
        propose: '',
        followup: '',
        resolve: '',
        apply: EMPTY_APPLY_STATE,
    };

    const updateThreadDraft = (
        thread: DraftDiscussionThreadRecord,
        updater: (prev: ThreadDraftState) => ThreadDraftState,
    ) => {
        setThreadDrafts((prev) => {
            const current = prev[thread.id] || {
                issueType: normalizeThreadIssueType(thread),
                propose: '',
                followup: '',
                resolve: '',
                apply: EMPTY_APPLY_STATE,
            };
            return {
                ...prev,
                [thread.id]: updater(current),
            };
        });
    };

    const handleCreate = async () => {
        setInlineError(null);
        let normalizedTargetRef = targetRef.trim();
        const normalizedContent = createContent.trim();

        if (targetType === 'paragraph') {
            const paragraphIndex = selectedParagraphIndex ?? parseParagraphRef(normalizedTargetRef);
            if (paragraphIndex === null) {
                setInlineError(t('errors.selectParagraph'));
                return;
            }
            normalizedTargetRef = `paragraph:${paragraphIndex}`;
        } else if (targetType === 'structure') {
            if (structureTargetIndices.length === 0) {
                setInlineError(t('errors.selectStructureRange'));
                return;
            }
            normalizedTargetRef = buildStructureTargetRef(structureTargetIndices);
        } else {
            normalizedTargetRef = 'document';
        }

        if (!normalizedContent) {
            setInlineError(t('errors.createDescriptionRequired'));
            return;
        }

        try {
            await props.onCreate({
                targetType,
                targetRef: normalizedTargetRef,
                targetVersion: stableSnapshotVersion,
                issueType: targetIssueType,
                content: normalizedContent,
            });
            setCreateContent('');
            if (targetType === 'paragraph') {
                setTargetRef(normalizedTargetRef);
            } else if (targetType === 'structure') {
                setTargetRef('');
                setStructureTargetIndices([]);
            } else {
                setTargetRef('document');
            }
        } catch (error) {
            setInlineError(error instanceof Error ? error.message : t('errors.createThread'));
        }
    };

    const handleTargetTypeChange = (nextType: DraftDiscussionTargetType) => {
        setTargetType(nextType);
        setInlineError(null);

        if (nextType === 'paragraph') {
            setTargetRef(selectedParagraphIndex !== null ? `paragraph:${selectedParagraphIndex}` : '');
            return;
        }

        if (nextType === 'structure') {
            setTargetRef('');
            setStructureTargetIndices(
                selectedParagraphIndex !== null ? [selectedParagraphIndex] : [],
            );
            return;
        }

        setTargetRef('document');
        setStructureTargetIndices([]);
    };

    const toggleStructureTarget = (index: number) => {
        setStructureTargetIndices((prev) => (
            prev.includes(index)
                ? prev.filter((value) => value !== index)
                : [...prev, index].sort((left, right) => left - right)
        ));
    };

    const handleReply = async (thread: DraftDiscussionThreadRecord) => {
        setInlineError(null);
        const draft = getThreadDraft(thread);
        const content = draft.followup.trim();
        if (!content) {
            setInlineError(t('errors.followupRequired'));
            return;
        }

        try {
            await props.onReply({
                threadId: thread.id,
                content,
            });
            updateThreadDraft(thread, (prev) => ({
                ...prev,
                followup: '',
            }));
        } catch (error) {
            setInlineError(error instanceof Error ? error.message : t('errors.reply'));
        }
    };

    const handlePropose = async (thread: DraftDiscussionThreadRecord) => {
        setInlineError(null);
        if (thread.state !== 'open') return;

        const draft = getThreadDraft(thread);
        try {
            await props.onPropose({
                threadId: thread.id,
                issueType: draft.issueType,
                content: draft.propose.trim(),
            });
            updateThreadDraft(thread, (prev) => ({ ...prev, propose: '' }));
        } catch (error) {
            setInlineError(error instanceof Error ? error.message : t('errors.propose'));
        }
    };

    const handleResolve = async (
        thread: DraftDiscussionThreadRecord,
        resolution: DraftDiscussionResolution,
    ) => {
        setInlineError(null);
        if (thread.state !== 'proposed') return;

        const draft = getThreadDraft(thread);
        try {
            await props.onResolve({
                threadId: thread.id,
                resolution,
                issueType: draft.issueType,
                reason: draft.resolve.trim() || undefined,
            });
            updateThreadDraft(thread, (prev) => ({ ...prev, resolve: '' }));
        } catch (error) {
            setInlineError(error instanceof Error ? error.message : t('errors.resolve'));
        }
    };

    const handleWithdraw = async (thread: DraftDiscussionThreadRecord) => {
        setInlineError(null);
        try {
            await props.onWithdraw({
                threadId: thread.id,
            });
        } catch (error) {
            setInlineError(error instanceof Error ? error.message : t('errors.withdraw'));
        }
    };

    const handleApply = async (thread: DraftDiscussionThreadRecord) => {
        setInlineError(null);
        if (thread.state !== 'accepted') return;

        const draft = getThreadDraft(thread);

        try {
            await props.onApply({
                threadId: thread.id,
                reason: draft.apply.reason.trim() || undefined,
            });
            updateThreadDraft(thread, (prev) => ({
                ...prev,
                apply: EMPTY_APPLY_STATE,
            }));
        } catch (error) {
            setInlineError(error instanceof Error ? error.message : t('errors.apply'));
        }
    };

    const targetTypeOptions: DraftSelectOption[] = [
        { value: 'paragraph', label: formatTargetType('paragraph') },
        { value: 'structure', label: formatTargetType('structure') },
        { value: 'document', label: formatTargetType('document') },
    ];
    const issueTypeOptions: DraftSelectOption[] = ISSUE_TYPE_OPTIONS.map((issueType) => ({
        value: issueType,
        label: formatIssueType(issueType),
    }));
    const paragraphSelectOptions: DraftSelectOption[] = [
        { value: '', label: t('create.selectParagraph') },
        ...paragraphOptions.map((option) => ({
            value: String(option.index),
            label: t('create.paragraphOption', {index: option.index + 1, preview: option.preview}),
        })),
    ];

    return (
        <aside className={styles.panel} aria-label={t('aria.panel')}>
            <div className={styles.panelHeading}>
                <p className={styles.panelEyebrow}>{t('header.eyebrow')}</p>
                <h3 className={styles.panelTitle}>{t('header.title')}</h3>
            </div>

            {(props.error || inlineError) && (
                <div className={styles.errorBox} role="alert">
                    {inlineError || props.error}
                </div>
            )}

            {props.governanceSummary && (
                <section className={styles.governanceSection}>
                    <div className={styles.governanceHeader}>
                        <div>
                            <p className={styles.governanceEyebrow}>{t('governance.eyebrow')}</p>
                            <h4 className={styles.governanceTitle}>{props.governanceSummary.actionLabel}</h4>
                        </div>
                        <span className={styles.governanceStatus}>{props.governanceSummary.statusLabel}</span>
                    </div>
                    <div className={styles.governanceRows}>
                        <div className={styles.governanceRow}>
                            <span className={styles.governanceLabel}>{t('governance.labels.target')}</span>
                            <span className={styles.governanceValue}>{props.governanceSummary.targetLabel}</span>
                        </div>
                        <div className={styles.governanceRow}>
                            <span className={styles.governanceLabel}>{t('governance.labels.actor')}</span>
                            <span className={styles.governanceValue}>{props.governanceSummary.actorLabel}</span>
                        </div>
                        <div className={styles.governanceRow}>
                            <span className={styles.governanceLabel}>{t('governance.labels.audit')}</span>
                            <span className={styles.governanceValue}>{props.governanceSummary.auditLabel}</span>
                        </div>
                    </div>
                    <div className={styles.governanceProgress}>
                        {props.governanceSummary.progressItems.map((item) => (
                            <div key={item.label} className={styles.governanceProgressItem}>
                                <span className={styles.governanceProgressLabel}>{item.label}</span>
                                <strong className={styles.governanceProgressValue}>{item.value}</strong>
                            </div>
                        ))}
                    </div>
                </section>
            )}

            {/*
             * Accepted directions UI intentionally hidden.
             *
             * This panel used to expose a manual "record accepted direction" workflow on the draft
             * page. We are commenting it out instead of deleting it because the backend endpoints and
             * stored proposals still exist, and they may become useful again after the product flow
             * is redesigned.
             *
             * Re-enable only after all of the following are true:
             * - the product has a single clear source of truth for accepted changes
             *   (issue resolution / governance / accepted directions must not duplicate each other);
             * - saving an accepted direction leads to a concrete next-step in the editing workflow;
             * - the hidden request/effect block above is restored together with this JSX.
             */}
            {/*
            <section className={styles.createSection}>
                <h4 className={styles.sectionTitle}>{t('revisionDirections.title')}</h4>
                <p className={styles.bindingHint}>
                    {t('revisionDirections.hint')}
                </p>
                <div className={styles.formRow}>
                    <label className={styles.fieldLabel} htmlFor="revision-direction-summary">{t('revisionDirections.summaryLabel')}</label>
                    <textarea
                        id="revision-direction-summary"
                        className={styles.textarea}
                        value={revisionDirectionSummary}
                        onChange={(event) => setRevisionDirectionSummary(event.target.value)}
                        placeholder={t('revisionDirections.summaryPlaceholder')}
                        disabled={!canCreateRevisionDirection || isBlocked}
                    />
                </div>
                <div className={styles.formRow}>
                    <label className={styles.fieldLabel} htmlFor="revision-direction-acceptance-mode">{t('revisionDirections.acceptanceMode.label')}</label>
                    <select
                        id="revision-direction-acceptance-mode"
                        className={styles.select}
                        value={acceptanceMode}
                        onChange={(event) => setAcceptanceMode(event.target.value as RevisionDirectionAcceptanceMode)}
                        disabled={!canCreateRevisionDirection || isBlocked}
                    >
                        {REVISION_DIRECTION_ACCEPTANCE_MODES.map((mode) => (
                            <option key={mode} value={mode}>
                                {formatRevisionDirectionAcceptanceMode(mode, t)}
                            </option>
                        ))}
                    </select>
                    <p className={styles.paragraphHint}>
                        {revisionDirectionScopeType === 'paragraph'
                            ? t('revisionDirections.scope.paragraph', {index: (selectedParagraphIndex ?? 0) + 1})
                            : t('revisionDirections.scope.document')}
                    </p>
                </div>
                <button
                    type="button"
                    className={styles.primaryButton}
                    onClick={createRevisionDirection}
                    disabled={!canCreateRevisionDirection || isBlocked}
                >
                    {t('revisionDirections.submit')}
                </button>
                {!canCreateRevisionDirection && revisionDirectionDisabledReason && (
                    <p className={styles.policyHint}>{revisionDirectionDisabledReason}</p>
                )}
                {acceptedDirections.length > 0 && (
                    <div className={styles.actionBlock}>
                        <h5 className={styles.sectionTitle}>{t('revisionDirections.acceptedTitle')}</h5>
                        {acceptedDirections.map((proposal) => (
                            <article key={proposal.revisionProposalId} className={styles.threadCard}>
                                <header className={styles.threadHeader}>
                                    <div>
                                        <p className={styles.threadTarget}>{proposal.summary}</p>
                                        <p className={styles.threadMeta}>
                                            {t('revisionDirections.scopeMeta', {
                                                scope: proposal.scopeType,
                                                version: proposal.draftVersion,
                                            })}
                                        </p>
                                    </div>
                                    <div className={styles.threadBadges}>
                                        <span className={styles.issueTypeBadge}>
                                            {formatRevisionDirectionAcceptanceMode(proposal.acceptanceMode, t)}
                                        </span>
                                        <span className={styles.stateBadge}>
                                            {formatRevisionDirectionStatus(proposal.status, t)}
                                        </span>
                                    </div>
                                </header>
                            </article>
                        ))}
                    </div>
                )}
                {revisionDirections.length > 0 && (
                    <div className={styles.actionBlock}>
                        <h5 className={styles.sectionTitle}>{t('revisionDirections.listTitle')}</h5>
                        {revisionDirections.map((proposal) => (
                            <article key={proposal.revisionProposalId} className={styles.threadCard}>
                                <header className={styles.threadHeader}>
                                    <div>
                                        <p className={styles.threadTarget}>{proposal.summary}</p>
                                        <p className={styles.threadMeta}>
                                            #{proposal.revisionProposalId.slice(0, 8)} · {proposal.scopeRef}
                                            {proposal.governanceProposalId
                                                ? t('revisionDirections.governanceMeta', {id: proposal.governanceProposalId})
                                                : ''}
                                        </p>
                                    </div>
                                    <div className={styles.threadBadges}>
                                        <span className={styles.issueTypeBadge}>
                                            {formatRevisionDirectionAcceptanceMode(proposal.acceptanceMode, t)}
                                        </span>
                                        <span className={styles.stateBadge}>
                                            {formatRevisionDirectionStatus(proposal.status, t)}
                                        </span>
                                    </div>
                                </header>
                                {proposal.status === 'open' && proposal.acceptanceMode !== 'governance_vote' && (
                                    <div className={styles.actionRow}>
                                        <button
                                            type="button"
                                            className={styles.secondaryButton}
                                            onClick={() => acceptRevisionDirection(proposal.revisionProposalId)}
                                            disabled={!canConfirmRevisionDirection || isBlocked}
                                        >
                                            {t('revisionDirections.actions.accept')}
                                        </button>
                                        <button
                                            type="button"
                                            className={styles.secondaryButton}
                                            onClick={() => rejectRevisionDirection(proposal.revisionProposalId)}
                                            disabled={!canConfirmRevisionDirection || isBlocked}
                                        >
                                            {t('revisionDirections.actions.reject')}
                                        </button>
                                    </div>
                                )}
                                {proposal.status === 'open' && proposal.acceptanceMode === 'governance_vote' && (
                                    <p className={styles.policyHint}>
                                        {t('revisionDirections.governanceHint')}
                                    </p>
                                )}
                            </article>
                        ))}
                    </div>
                )}
            </section>
            */}

            <section className={styles.createSection}>
                <h4 className={styles.sectionTitle}>{t('create.title')}</h4>
                <p className={styles.bindingHint}>
                    {t('create.bindingHint', {version: stableSnapshotVersion})}
                </p>
                <div className={styles.formRow}>
                    <label className={styles.fieldLabel} htmlFor="draft-discussion-target-type">{t('create.targetTypeLabel')}</label>
                    <DraftSelect
                        id="draft-discussion-target-type"
                        value={targetType}
                        options={targetTypeOptions}
                        onChange={(nextValue) => handleTargetTypeChange(nextValue as DraftDiscussionTargetType)}
                        disabled={!props.canCreate || isBlocked}
                    />
                </div>
                <div className={styles.formRow}>
                    <label className={styles.fieldLabel} htmlFor="draft-discussion-issue-type">{t('create.issueTypeLabel')}</label>
                    <DraftSelect
                        id="draft-discussion-issue-type"
                        value={targetIssueType}
                        options={issueTypeOptions}
                        onChange={(nextValue) => setTargetIssueType(nextValue as DraftDiscussionIssueType)}
                        disabled={!props.canCreate || isBlocked}
                    />
                </div>
                <div className={styles.formRow}>
                    {targetType === 'paragraph' ? (
                        <>
                            <label className={styles.fieldLabel} htmlFor="draft-discussion-target-paragraph">{t('create.paragraphTargetLabel')}</label>
                            <DraftSelect
                                id="draft-discussion-target-paragraph"
                                value={selectedParagraphIndex !== null ? String(selectedParagraphIndex) : ''}
                                options={paragraphSelectOptions}
                                onChange={(nextValue) => {
                                    if (!nextValue) {
                                        props.onSelectParagraph?.(null);
                                        setTargetRef('');
                                        return;
                                    }
                                    const parsed = Number.parseInt(nextValue, 10);
                                    if (!Number.isFinite(parsed) || parsed < 0) {
                                        props.onSelectParagraph?.(null);
                                        setTargetRef('');
                                        return;
                                    }
                                    props.onSelectParagraph?.(parsed);
                                    setTargetRef(`paragraph:${parsed}`);
                                }}
                                disabled={!props.canCreate || isBlocked || paragraphOptions.length === 0}
                            />
                            <p className={styles.paragraphHint}>
                                {selectedParagraphIndex !== null
                                    ? t('create.paragraphSelectedHint', {index: selectedParagraphIndex + 1})
                                    : t('create.paragraphSelectHint')}
                            </p>
                            {selectedParagraphPreview && (
                                <p className={styles.paragraphPreview}>
                                    {selectedParagraphPreview}
                                </p>
                            )}
                        </>
                    ) : targetType === 'structure' ? (
                        <>
                            <label className={styles.fieldLabel}>{t('create.structureLabel')}</label>
                            <p className={styles.paragraphHint}>
                                {t('create.structureHint')}
                            </p>
                            <div className={styles.structureOptions}>
                                {paragraphOptions.map((option) => {
                                    const checked = structureTargetIndices.includes(option.index);
                                    return (
                                        <label
                                            key={option.index}
                                            className={`${styles.structureOption}${checked ? ` ${styles.structureOptionSelected}` : ''}`}
                                        >
                                            <input
                                                type="checkbox"
                                                className={styles.structureOptionCheckbox}
                                                checked={checked}
                                                onChange={() => toggleStructureTarget(option.index)}
                                                disabled={!props.canCreate || isBlocked}
                                                />
                                                <span className={styles.structureOptionBody}>
                                                    <span className={styles.structureOptionLabel}>
                                                        {t('create.paragraphShort', {index: option.index + 1})}
                                                    </span>
                                                    <span className={styles.structureOptionPreview}>
                                                        {option.preview}
                                                </span>
                                            </span>
                                        </label>
                                    );
                                })}
                            </div>
                            {selectedStructureOptions.length > 0 && (
                                <p className={styles.paragraphPreview}>
                                    {t('create.selectedStructure', {
                                        values: selectedStructureOptions.map((option) => t('create.paragraphShort', {index: option.index + 1})).join(', '),
                                    })}
                                </p>
                            )}
                        </>
                    ) : (
                        <>
                            <label className={styles.fieldLabel}>{t('create.documentLabel')}</label>
                            <p className={styles.paragraphHint}>
                                {t('create.documentHint')}
                            </p>
                        </>
                    )}
                </div>
                <div className={styles.formRow}>
                    <label className={styles.fieldLabel}>{t('create.boundVersionLabel')}</label>
                    <p className={styles.paragraphHint}>
                        {t('create.boundVersionHint', {version: stableSnapshotVersion})}
                    </p>
                </div>
                <div className={styles.formRow}>
                    <label className={styles.fieldLabel} htmlFor="draft-discussion-content">{t('create.descriptionLabel')}</label>
                    <textarea
                        id="draft-discussion-content"
                        className={styles.textarea}
                        value={createContent}
                        onChange={(event) => setCreateContent(event.target.value)}
                        placeholder={t('create.descriptionPlaceholder')}
                        disabled={!props.canCreate || isBlocked}
                    />
                    <div className={styles.inlineActionRow}>
                        <button
                            type="button"
                            className={styles.secondaryButton}
                            onClick={() => setCreateContent((current) => appendSeededReferenceToContent(
                                current,
                                props.selectedSeededReference,
                            ))}
                            disabled={!props.canCreate || isBlocked || !props.selectedSeededReference}
                        >
                            {t('create.insertCurrentReference')}
                        </button>
                        {props.selectedSeededReference && (
                            <span className={styles.referenceHint}>
                                {props.selectedSeededReference.raw}
                            </span>
                        )}
                    </div>
                </div>
                <button
                    type="button"
                    className={styles.primaryButton}
                    onClick={handleCreate}
                    disabled={!props.canCreate || isBlocked}
                >
                    {t('create.submit')}
                </button>
                {!props.canCreate && props.createDisabledReason && (
                    <p className={styles.policyHint}>{props.createDisabledReason}</p>
                )}
            </section>

            <section className={styles.threadsSection}>
                <h4 className={styles.sectionTitle}>{t('threads.title')}</h4>
                {props.loading && <p className={styles.loadingHint}>{t('threads.loading')}</p>}
                {!props.loading && props.threads.length === 0 && (
                    <p className={styles.emptyHint}>{t('threads.empty')}</p>
                )}

                {STATE_ORDER.map((state) => {
                    const threads = groupedThreads.get(state) || [];
                    if (threads.length === 0) return null;
                    return (
                        <div key={state} className={styles.stateGroup}>
                            <h5 className={styles.stateHeading}>
                                {formatState(state)}
                                <span className={styles.stateCount}>{threads.length}</span>
                            </h5>
                            {threads.map((thread) => {
                                const draft = getThreadDraft(thread);
                                const threadCanReply = canReplyToThread(thread);
                                const threadCanWithdraw = canWithdrawThread(thread, props.viewerUserId);
                                const canEditIssueType = props.canRetag
                                    && (thread.state === 'open' || thread.state === 'proposed');
                                const canPropose = props.canStartReview && thread.state === 'open';
                                const canResolve = props.canResolve && thread.state === 'proposed';
                                const canApply = props.canApply
                                    && thread.state === 'accepted'
                                    && !shouldResolveIssueViaParagraphEditing(thread);
                                const canReply = props.canFollowup && threadCanReply;
                                const canWithdraw = props.canWithdrawOwn && threadCanWithdraw;
                                const threadMessages = thread.messages?.length > 0
                                    ? thread.messages
                                    : thread.latestMessage
                                        ? [{
                                            id: `${thread.id}:latest`,
                                            authorId: thread.latestMessage.authorId,
                                            messageType: thread.latestMessage.messageType,
                                            content: thread.latestMessage.content,
                                            createdAt: thread.latestMessage.createdAt,
                                        }]
                                        : [];

                                return (
                                    <article key={thread.id} className={styles.threadCard}>
                                        <header className={styles.threadHeader}>
                                            <div>
                                                <p className={styles.threadTarget}>
                                                    {formatTargetLabel(thread.targetType, thread.targetRef)}
                                                </p>
                                                <p className={styles.threadMeta}>{t('threads.targetVersion', {version: thread.targetVersion, id: thread.id})}</p>
                                            </div>
                                            <div className={styles.threadBadges}>
                                                <span className={styles.issueTypeBadge}>{formatIssueType(thread.issueType)}</span>
                                                <span className={styles.stateBadge}>{formatState(thread.state)}</span>
                                            </div>
                                        </header>

                                        {threadMessages.length > 0 ? (
                                            <div className={styles.threadMessages}>
                                                {threadMessages.map((message) => (
                                                    <div key={message.id} className={styles.threadMessage}>
                                                        <div className={styles.threadMessageHeader}>
                                                            <span className={styles.threadMessageLabel}>{buildMessageLabel(message.messageType, t)}</span>
                                                            <span className={styles.threadMessageMeta}>
                                                                {formatMessageMeta(message.authorId, message.createdAt, locale, t)}
                                                            </span>
                                                        </div>
                                                        <div className={styles.threadMessageContent}>
                                                            {renderMessageContentWithReferences(
                                                                buildMessageContent(message.messageType, message.content, formatIssueType, t),
                                                                props.onSelectSeededReference,
                                                            )}
                                                        </div>
                                                    </div>
                                                ))}
                                            </div>
                                        ) : (
                                            <p className={styles.emptyHint}>{t('threads.noMessages')}</p>
                                        )}

                                        {thread.latestApplication && (
                                            <div className={styles.evidenceCard}>
                                                <p className={styles.evidenceTitle}>{t('threads.evidence.title')}</p>
                                                <p className={styles.evidenceItem}>{t('threads.evidence.editAnchor', {id: thread.latestApplication.appliedEditAnchorId})}</p>
                                                <p className={styles.evidenceItem}>{t('threads.evidence.snapshotHash', {hash: thread.latestApplication.appliedSnapshotHash})}</p>
                                                <p className={styles.evidenceItem}>{t('threads.evidence.draftVersion', {version: thread.latestApplication.appliedDraftVersion})}</p>
                                            </div>
                                        )}

                                        {(canEditIssueType || ((thread.state === 'open' || thread.state === 'proposed') && !props.canRetag)) && (
                                            <div className={styles.actionBlock}>
                                                <label className={styles.fieldLabel} htmlFor={`thread-issue-type-${thread.id}`}>{t('threads.issueTypeLabel')}</label>
                                                {canEditIssueType ? (
                                                    <DraftSelect
                                                        id={`thread-issue-type-${thread.id}`}
                                                        value={draft.issueType}
                                                        options={issueTypeOptions}
                                                        onChange={(nextValue) => updateThreadDraft(thread, (prev) => ({
                                                            ...prev,
                                                            issueType: nextValue as DraftDiscussionIssueType,
                                                        }))}
                                                        disabled={isBlocked}
                                                    />
                                                ) : (
                                                    <p className={styles.staticIssueType}>
                                                        {formatIssueType(thread.issueType)}
                                                    </p>
                                                )}
                                                {!canEditIssueType && props.retagDisabledReason && (
                                                    <p className={styles.policyHint}>{props.retagDisabledReason}</p>
                                                )}
                                            </div>
                                        )}

                                        {canReply && (
                                            <div className={styles.actionBlock}>
                                                <textarea
                                                    className={styles.textarea}
                                                    placeholder={t('threads.replyPlaceholder')}
                                                    value={draft.followup}
                                                    onChange={(event) => updateThreadDraft(thread, (prev) => ({
                                                        ...prev,
                                                        followup: event.target.value,
                                                    }))}
                                                    disabled={isBlocked}
                                                />
                                                <button
                                                    type="button"
                                                    className={styles.secondaryButton}
                                                    onClick={() => handleReply(thread)}
                                                    disabled={isBlocked}
                                                >
                                                    {t('threads.actions.reply')}
                                                </button>
                                            </div>
                                        )}
                                        {!canReply && threadCanReply && props.followupDisabledReason && (
                                            <p className={styles.policyHint}>{props.followupDisabledReason}</p>
                                        )}

                                        {canWithdraw && (
                                            <div className={styles.actionBlock}>
                                                <button
                                                    type="button"
                                                    className={styles.secondaryButton}
                                                    onClick={() => handleWithdraw(thread)}
                                                    disabled={isBlocked}
                                                >
                                                    {t('threads.actions.withdraw')}
                                                </button>
                                            </div>
                                        )}
                                        {!canWithdraw && threadCanWithdraw && props.withdrawDisabledReason && (
                                            <p className={styles.policyHint}>{props.withdrawDisabledReason}</p>
                                        )}

                                        {canPropose && (
                                            <div className={styles.actionBlock}>
                                                <textarea
                                                    className={styles.textarea}
                                                    placeholder={t('threads.proposePlaceholder')}
                                                    value={draft.propose}
                                                    onChange={(event) => updateThreadDraft(thread, (prev) => ({
                                                        ...prev,
                                                        propose: event.target.value,
                                                    }))}
                                                    disabled={isBlocked}
                                                />
                                                <button
                                                    type="button"
                                                    className={styles.secondaryButton}
                                                    onClick={() => handlePropose(thread)}
                                                    disabled={isBlocked}
                                                >
                                                    {t('threads.actions.propose')}
                                                </button>
                                            </div>
                                        )}
                                        {!canPropose && thread.state === 'open' && props.reviewDisabledReason && (
                                            <p className={styles.policyHint}>{props.reviewDisabledReason}</p>
                                        )}

                                        {canResolve && (
                                            <div className={styles.actionBlock}>
                                                <input
                                                    className={styles.input}
                                                    placeholder={t('threads.resolvePlaceholder')}
                                                    value={draft.resolve}
                                                    onChange={(event) => updateThreadDraft(thread, (prev) => ({
                                                        ...prev,
                                                        resolve: event.target.value,
                                                    }))}
                                                    disabled={isBlocked}
                                                />
                                                <div className={styles.actionRow}>
                                                    <button
                                                        type="button"
                                                        className={styles.secondaryButton}
                                                        onClick={() => handleResolve(thread, 'accepted')}
                                                        disabled={isBlocked}
                                                    >
                                                        {t('threads.actions.accept')}
                                                    </button>
                                                    <button
                                                        type="button"
                                                        className={styles.secondaryButton}
                                                        onClick={() => handleResolve(thread, 'rejected')}
                                                        disabled={isBlocked}
                                                    >
                                                        {t('threads.actions.reject')}
                                                    </button>
                                                </div>
                                            </div>
                                        )}
                                        {!canResolve && thread.state === 'proposed' && props.resolveDisabledReason && (
                                            <p className={styles.policyHint}>{props.resolveDisabledReason}</p>
                                        )}

                                        {canApply && (
                                            <div className={styles.actionBlock}>
                                                <input
                                                    className={styles.input}
                                                    placeholder={t('threads.applyPlaceholder')}
                                                    value={draft.apply.reason}
                                                    onChange={(event) => updateThreadDraft(thread, (prev) => ({
                                                        ...prev,
                                                        apply: {
                                                            ...prev.apply,
                                                            reason: event.target.value,
                                                        },
                                                    }))}
                                                    disabled={isBlocked}
                                                />
                                                <button
                                                    type="button"
                                                    className={styles.primaryButton}
                                                    onClick={() => handleApply(thread)}
                                                    disabled={isBlocked}
                                                >
                                                    {t('threads.actions.apply')}
                                                </button>
                                            </div>
                                        )}
                                        {!canApply
                                            && thread.state === 'accepted'
                                            && !shouldResolveIssueViaParagraphEditing(thread)
                                            && props.applyDisabledReason && (
                                                <p className={styles.policyHint}>{props.applyDisabledReason}</p>
                                        )}
                                    </article>
                                );
                            })}
                        </div>
                    );
                })}
            </section>
        </aside>
    );
}
