'use client';

import { useMemo, useState } from 'react';
import { Inbox } from 'lucide-react';
import { useI18n } from '@/i18n/useI18n';

import { useIssueReviewAssist } from '@/hooks/useIssueReviewAssist';
import type {
    DraftDiscussionIssueType,
    DraftDiscussionResolution,
    DraftDiscussionState,
    DraftDiscussionTargetType,
    DraftDiscussionThreadRecord,
} from '@/lib/api/discussion';
import {
    shouldResolveIssueViaParagraphEditing,
} from '@/lib/circle/crucibleViewModel';
import type { CrucibleGovernanceSummaryView } from '@/lib/circle/crucibleViewModel';
import type { SeededReferenceSelection } from '@/lib/api/circlesSeeded';
import styles from './DraftDiscussionPanel.module.css';
import DraftDiscussionCreateSheet, {
    type DraftDiscussionCreateInput,
} from './DraftDiscussionCreateSheet';
import DraftDiscussionDetailSheet from './DraftDiscussionDetailSheet';
import DraftDiscussionThreadCard from './DraftDiscussionThreadCard';
import {
    buildDraftDiscussionWorkbenchModel,
    type DraftDiscussionWorkbenchCopy,
    type DraftDiscussionWorkbenchItem,
    type DraftDiscussionWorkbenchViewId,
} from './draftDiscussionWorkbenchModel';

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
    | 'governance_request';

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
    governanceRequestId: string | null;
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
    editableParagraphIndices?: number[];
    reviewerPolicyLabel: string;
    applierPolicyLabel: string;
    followupPolicyLabel: string;
    onCreate: (input: DraftDiscussionCreateInput) => Promise<DraftDiscussionThreadRecord>;
    onPropose: (input: ProposeDiscussionInput) => Promise<DraftDiscussionThreadRecord>;
    onResolve: (input: ResolveDiscussionInput) => Promise<DraftDiscussionThreadRecord>;
    onReply: (input: ReplyDiscussionInput) => Promise<DraftDiscussionThreadRecord>;
    onWithdraw: (input: WithdrawDiscussionInput) => Promise<DraftDiscussionThreadRecord>;
    onApply: (input: ApplyDiscussionInput) => Promise<DraftDiscussionThreadRecord>;
    onGoToParagraphIssue?: (paragraphIndex: number, threadId: string) => void;
    paragraphOptions?: Array<{
        index: number;
        preview: string;
    }>;
    selectedParagraphIndex?: number | null;
    onSelectParagraph?: (paragraphIndex: number | null) => void;
    currentDraftVersion: number | null;
    governanceSummary?: CrucibleGovernanceSummaryView | null;
    selectedSeededReference?: SeededReferenceSelection | null;
    onSelectSeededReference?: (reference: SeededReferenceSelection) => void;
}

const WORKBENCH_VIEWS: DraftDiscussionWorkbenchViewId[] = ['toHandle', 'mine', 'all'];
const REVISION_DIRECTION_ACCEPTANCE_MODES: RevisionDirectionAcceptanceMode[] = [
    'manager_confirm',
    'role_confirm',
    'governance_request',
];

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

export default function DraftDiscussionPanel(props: DraftDiscussionPanelProps) {
    const t = useI18n('DraftDiscussionPanel');
    const [activeView, setActiveView] = useState<DraftDiscussionWorkbenchViewId>('toHandle');
    const [openCreateSheet, setOpenCreateSheet] = useState(false);
    const [recentThreadId, setRecentThreadId] = useState<string | null>(null);
    const [selectedThreadId, setSelectedThreadId] = useState<string | null>(null);
    const [historyExpanded, setHistoryExpanded] = useState(false);
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

    const paragraphOptions = props.paragraphOptions || [];
    const currentDraftVersion = Number.isFinite(props.currentDraftVersion as number)
        ? Number(props.currentDraftVersion)
        : null;
    const selectedParagraphIndex = Number.isFinite(props.selectedParagraphIndex as number)
        ? Number(props.selectedParagraphIndex)
        : null;
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
    const workbenchCopy = useMemo<DraftDiscussionWorkbenchCopy>(() => ({
        currentVersionUnavailable: t('workbench.empty.currentUnavailable'),
        target: {
            paragraph: (index) => t('targetLabels.paragraphNumber', {index}),
            invalidParagraph: (value) => t('targetLabels.paragraphRaw', {value}),
            structure: (value) => {
                const paragraphMatches = Array.from(
                    String(value || '').matchAll(/paragraph:(\d+)/gi),
                    (match) => Number.parseInt(match[1], 10),
                ).filter((item) => Number.isFinite(item) && item >= 0);
                if (paragraphMatches.length > 0) {
                    return t('targetLabels.structureParagraphs', {
                        values: paragraphMatches.map((item) => String(item + 1)).join(', '),
                    });
                }
                return t('targetLabels.generic', {
                    type: formatTargetType('structure'),
                    value,
                });
            },
            document: t('targetTypes.document'),
            generic: (type, value) => t('targetLabels.generic', {type, value}),
        },
        version: {
            current: (version) => t('workbench.version.current', {version}),
            history: (version) => t('workbench.version.history', {version}),
        },
        latestActivity: ({messageType, content}) => t('workbench.latestActivity', {
            type: buildMessageLabel(messageType, t),
            content: String(content || '').trim() || t('messages.content.empty'),
        }),
        nextStep: {
            propose: t('workbench.nextStep.propose'),
            resolve: t('workbench.nextStep.resolve'),
            apply: t('workbench.nextStep.apply'),
            applyByParagraphEditing: (targetLabel) => t('workbench.nextStep.applyByParagraphEditing', {target: targetLabel}),
            waitForReviewer: (label) => t('workbench.nextStep.waitForReviewer', {role: label}),
            waitForResolver: (label) => t('workbench.nextStep.waitForResolver', {role: label}),
            waitForApplication: (label) => t('workbench.nextStep.waitForApplication', {role: label}),
            done: t('workbench.nextStep.done'),
            closed: t('workbench.nextStep.closed'),
        },
    }), [t]);
    const workbenchModel = useMemo(() => buildDraftDiscussionWorkbenchModel({
        threads: props.threads,
        viewerUserId: props.viewerUserId,
        currentDraftVersion,
        currentVersionUnavailableReason: currentDraftVersion === null
            ? props.createDisabledReason || t('workbench.empty.currentUnavailable')
            : null,
        capabilities: {
            canStartReview: props.canStartReview,
            reviewDisabledReason: props.reviewDisabledReason,
            canResolve: props.canResolve,
            resolveDisabledReason: props.resolveDisabledReason,
            canApply: props.canApply,
            applyDisabledReason: props.applyDisabledReason,
            editableParagraphIndices: props.editableParagraphIndices || [],
            applyViaParagraphEditingDisabledReason: t('detail.goToParagraphLocked'),
            paragraphApplicationUnavailableReason: t('detail.goToParagraphUnavailable'),
            canFollowup: props.canFollowup,
            followupDisabledReason: props.followupDisabledReason,
            canWithdrawOwn: props.canWithdrawOwn,
            withdrawDisabledReason: props.withdrawDisabledReason,
        },
        policyLabels: {
            reviewerLabel: props.reviewerPolicyLabel,
            applierLabel: props.applierPolicyLabel,
            followupLabel: props.followupPolicyLabel,
        },
        copy: workbenchCopy,
    }), [
        currentDraftVersion,
        props.applyDisabledReason,
        props.applierPolicyLabel,
        props.canApply,
        props.canFollowup,
        props.canResolve,
        props.canStartReview,
        props.canWithdrawOwn,
        props.createDisabledReason,
        props.editableParagraphIndices,
        props.followupDisabledReason,
        props.followupPolicyLabel,
        props.resolveDisabledReason,
        props.reviewDisabledReason,
        props.reviewerPolicyLabel,
        props.threads,
        props.viewerUserId,
        props.withdrawDisabledReason,
        workbenchCopy,
        t,
    ]);
    const createDisabledReason = currentDraftVersion === null
        ? workbenchModel.currentVersionUnavailableReason
        : props.createDisabledReason;
    const createDisabled = !props.canCreate || currentDraftVersion === null || isBlocked;
    const activeViewItems = activeView === 'toHandle'
        ? workbenchModel.toHandle
        : activeView === 'mine'
            ? workbenchModel.mine
            : workbenchModel.current;

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
    //                 cache: 'no-store',
    //                 headers: { 'Content-Type': 'application/json' },
    //                 body: JSON.stringify({
    //                     summary: normalizedSummary,
    //                     acceptanceMode,
    //                     scopeType: revisionDirectionScopeType,
    //                     scopeRef: revisionDirectionScopeRef,
    //                     ...(acceptanceMode === 'governance_request'
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

    const viewCounts: Record<DraftDiscussionWorkbenchViewId, number> = {
        toHandle: workbenchModel.counts.toHandle,
        mine: workbenchModel.counts.mine,
        all: workbenchModel.counts.allCurrent + workbenchModel.counts.allHistory,
    };
    const handleCreatedThread = (createdThread: DraftDiscussionThreadRecord) => {
        setActiveView('mine');
        setRecentThreadId(createdThread.id);
    };
    const handleUpdatedThread = (updatedThread: DraftDiscussionThreadRecord) => {
        setRecentThreadId(updatedThread.id);
        setSelectedThreadId(updatedThread.id);
    };
    const handleGoToParagraphIssue = (paragraphIndex: number, threadId: string) => {
        setRecentThreadId(threadId);
        props.onGoToParagraphIssue?.(paragraphIndex, threadId);
    };
    const selectedDetailItem = [
        ...workbenchModel.current,
        ...workbenchModel.history,
    ].find((item) => item.thread.id === selectedThreadId) || null;
    const selectedDetailThread = selectedDetailItem?.thread ?? null;
    const issueReviewAssist = useIssueReviewAssist({
        draftPostId: props.draftPostId,
        threadId: selectedDetailThread?.id ?? null,
    });
    const canUseIssueReviewAssist = Boolean(
        selectedDetailThread
        && (
            (selectedDetailThread.state === 'open' && props.canStartReview)
            || (selectedDetailThread.state === 'proposed' && props.canResolve)
        ),
    );
    const issueReviewAssistDisabledReason = selectedDetailThread?.state === 'open'
        ? (props.reviewDisabledReason || t('aiAssist.permissionDenied'))
        : selectedDetailThread?.state === 'proposed'
            ? (props.resolveDisabledReason || t('aiAssist.permissionDenied'))
            : t('aiAssist.unavailable');
    const renderThreadCards = (
        items: DraftDiscussionWorkbenchItem[],
        emptyText: string,
    ) => {
        if (items.length === 0) {
            return (
                <div className={styles.workbenchEmptyState} role="status">
                    <span className={styles.workbenchEmptyIcon} aria-hidden="true">
                        <Inbox size={18} strokeWidth={1.35} />
                    </span>
                    <p className={styles.emptyHint}>{emptyText}</p>
                </div>
            );
        }
        return items.map((item) => (
            <DraftDiscussionThreadCard
                key={item.thread.id}
                item={item}
                stateLabel={formatState(item.thread.state)}
                issueTypeLabel={formatIssueType(item.thread.issueType)}
                highlighted={item.thread.id === recentThreadId}
                onOpen={() => setSelectedThreadId(item.thread.id)}
            />
        ));
    };

    return (
        <aside className={styles.panel} aria-label={t('aria.panel')}>
            <div className={styles.panelHeading}>
                <div className={styles.panelHeadingText}>
                    <p className={styles.panelEyebrow}>{t('header.eyebrow')}</p>
                    <h3 className={styles.panelTitle}>{t('header.title')}</h3>
                </div>
                <button
                    type="button"
                    className={`${styles.primaryButton} ${styles.panelCreateButton}`}
                    onClick={() => setOpenCreateSheet(true)}
                    disabled={createDisabled}
                >
                    {t('workbench.actions.openCreate')}
                </button>
            </div>
            {createDisabledReason && (
                <p className={styles.policyHint}>{createDisabledReason}</p>
            )}

            {props.error && (
                <div className={styles.errorBox} role="alert">
                    {props.error}
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
                    <div className={styles.governanceMetaLine}>
                        <span className={styles.governanceMetaItem}>
                            <span className={styles.governanceLabel}>{t('governance.labels.target')}</span>
                            <span className={styles.governanceValue}>{props.governanceSummary.targetLabel}</span>
                        </span>
                        <span className={styles.governanceMetaItem}>
                            <span className={styles.governanceLabel}>{t('governance.labels.audit')}</span>
                            <span className={styles.governanceValue}>{props.governanceSummary.auditLabel}</span>
                        </span>
                    </div>
                    <div className={styles.governanceCapabilityLine}>
                        <span className={styles.governanceLabel}>{t('governance.labels.capabilities')}</span>
                        <span className={styles.governanceValue}>{props.governanceSummary.capabilityLabel}</span>
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
                                            {proposal.governanceRequestId
                                                ? t('revisionDirections.governanceMeta', {id: proposal.governanceRequestId})
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
                                {proposal.status === 'open' && proposal.acceptanceMode !== 'governance_request' && (
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
                                {proposal.status === 'open' && proposal.acceptanceMode === 'governance_request' && (
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

            <section className={styles.workbenchToolbar}>
                <div className={styles.workbenchTabs} role="tablist" aria-label={t('workbench.viewsLabel')}>
                    {WORKBENCH_VIEWS.map((view) => (
                        <button
                            key={view}
                            type="button"
                            role="tab"
                            aria-selected={activeView === view}
                            className={`${styles.workbenchTab}${activeView === view ? ` ${styles.workbenchTabActive}` : ''}`}
                            onClick={() => setActiveView(view)}
                        >
                            <span>{t(`workbench.views.${view}`)}</span>
                            <span className={styles.workbenchTabCount}>{viewCounts[view]}</span>
                        </button>
                    ))}
                </div>
            </section>

            <DraftDiscussionCreateSheet
                open={openCreateSheet}
                busy={props.busy}
                canCreate={props.canCreate}
                createDisabledReason={props.createDisabledReason}
                currentDraftVersion={currentDraftVersion}
                paragraphOptions={paragraphOptions}
                selectedParagraphIndex={selectedParagraphIndex}
                selectedSeededReference={props.selectedSeededReference}
                onSelectParagraph={props.onSelectParagraph}
                onCreate={props.onCreate}
                onCreated={handleCreatedThread}
                onClose={() => setOpenCreateSheet(false)}
            />
            <DraftDiscussionDetailSheet
                open={Boolean(selectedDetailItem)}
                item={selectedDetailItem}
                draftPostId={props.draftPostId}
                busy={props.busy}
                viewerUserId={props.viewerUserId}
                canFollowup={props.canFollowup}
                followupDisabledReason={props.followupDisabledReason}
                canWithdrawOwn={props.canWithdrawOwn}
                withdrawDisabledReason={props.withdrawDisabledReason}
                canStartReview={props.canStartReview}
                reviewDisabledReason={props.reviewDisabledReason}
                canRetag={props.canRetag}
                retagDisabledReason={props.retagDisabledReason}
                canResolve={props.canResolve}
                resolveDisabledReason={props.resolveDisabledReason}
                canApply={props.canApply}
                applyDisabledReason={props.applyDisabledReason}
                canUseIssueReviewAssist={canUseIssueReviewAssist}
                issueReviewAssistDisabledReason={issueReviewAssistDisabledReason}
                stateLabel={selectedDetailItem ? formatState(selectedDetailItem.thread.state) : ''}
                issueTypeLabel={selectedDetailItem ? formatIssueType(selectedDetailItem.thread.issueType) : ''}
                onRequestIssueReviewAssist={issueReviewAssist.requestReviewAssist}
                onApplyIssueReviewAssistSuggestion={issueReviewAssist.applySuggestionToForm}
                onReply={props.onReply}
                onPropose={props.onPropose}
                onResolve={props.onResolve}
                onWithdraw={props.onWithdraw}
                onApply={props.onApply}
                onGoToParagraphIssue={props.onGoToParagraphIssue ? handleGoToParagraphIssue : undefined}
                onUpdated={handleUpdatedThread}
                onClose={() => setSelectedThreadId(null)}
                onSelectSeededReference={props.onSelectSeededReference}
            />

            <section className={styles.threadsSection}>
                <h4 className={`${styles.sectionTitle} ${styles.workbenchSectionTitle}`}>{t(`workbench.views.${activeView}`)}</h4>
                {props.loading && (
                    <div className={styles.workbenchEmptyState} role="status">
                        <p className={styles.loadingHint}>{t('threads.loading')}</p>
                    </div>
                )}
                {!props.loading && activeView !== 'all' && (
                    <div className={styles.workbenchList}>
                        {renderThreadCards(
                            activeViewItems,
                            activeView === 'toHandle'
                                ? t('workbench.empty.toHandle')
                                : t('workbench.empty.mine'),
                        )}
                    </div>
                )}
                {!props.loading && activeView === 'all' && (
                    <div className={styles.workbenchList}>
                        <section className={styles.workbenchVersionGroup}>
                            <h5 className={styles.stateHeading}>
                                {t('workbench.sections.current')}
                                <span className={styles.stateCount}>{workbenchModel.counts.allCurrent}</span>
                            </h5>
                            {renderThreadCards(
                                workbenchModel.current,
                                workbenchModel.currentVersionUnavailableReason || t('workbench.empty.current'),
                            )}
                        </section>
                        <section className={styles.workbenchVersionGroup}>
                            <button
                                type="button"
                                className={styles.stateHeadingButton}
                                aria-expanded={historyExpanded}
                                onClick={() => setHistoryExpanded((value) => !value)}
                            >
                                <span>{t('workbench.sections.history')}</span>
                                <span className={styles.stateCount}>{workbenchModel.counts.allHistory}</span>
                                <span className={styles.historyToggleLabel}>
                                    {historyExpanded
                                        ? t('workbench.actions.collapseHistory')
                                        : t('workbench.actions.expandHistory')}
                                </span>
                            </button>
                            {historyExpanded && renderThreadCards(workbenchModel.history, t('workbench.empty.history'))}
                        </section>
                    </div>
                )}
            </section>
        </aside>
    );
}
