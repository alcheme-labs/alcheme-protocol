'use client';

import { type ReactNode, useEffect, useMemo, useState } from 'react';
import { useCurrentLocale, useI18n } from '@/i18n/useI18n';

import { BottomSheet, ConfirmationSheet } from '@/components/alcheme';
import type {
    DraftDiscussionIssueType,
    DraftDiscussionResolution,
    DraftDiscussionThreadRecord,
} from '@/lib/api/discussion';
import type {
    GQLIssueReviewAssistResult,
} from '@/lib/apollo/types';
import type {
    IssueReviewAssistFormSuggestion,
} from '@/hooks/useIssueReviewAssist';
import {
    extractCrucibleFileLineReferences,
    shouldResolveIssueViaParagraphEditing,
} from '@/lib/circle/crucibleViewModel';
import {
    formatSeededReferenceLabel,
} from '@/lib/circle/draftPresentation';
import type { SeededReferenceSelection } from '@/lib/api/circlesSeeded';
import DraftDiscussionSelect, {
    type DraftDiscussionSelectOption,
} from './DraftDiscussionSelect';
import type { DraftDiscussionWorkbenchItem } from './draftDiscussionWorkbenchModel';
import styles from './DraftDiscussionPanel.module.css';

type DetailActionMode = 'propose' | 'resolve' | 'apply' | 'followup' | null;

interface DraftDiscussionDetailSheetProps {
    open: boolean;
    item: DraftDiscussionWorkbenchItem | null;
    draftPostId: number;
    busy: boolean;
    viewerUserId?: number | null;
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
    canUseIssueReviewAssist: boolean;
    issueReviewAssistDisabledReason: string | null;
    stateLabel: string;
    issueTypeLabel: string;
    onRequestIssueReviewAssist: () => Promise<GQLIssueReviewAssistResult | null>;
    onApplyIssueReviewAssistSuggestion: (result: GQLIssueReviewAssistResult | null) => IssueReviewAssistFormSuggestion | null;
    onReply: (input: { threadId: string; content: string }) => Promise<DraftDiscussionThreadRecord>;
    onPropose: (input: {
        threadId: string;
        issueType?: DraftDiscussionIssueType;
        content: string;
    }) => Promise<DraftDiscussionThreadRecord>;
    onResolve: (input: {
        threadId: string;
        resolution: DraftDiscussionResolution;
        issueType?: DraftDiscussionIssueType;
        reason?: string;
    }) => Promise<DraftDiscussionThreadRecord>;
    onWithdraw: (input: { threadId: string; reason?: string }) => Promise<DraftDiscussionThreadRecord>;
    onApply: (input: { threadId: string; reason?: string }) => Promise<DraftDiscussionThreadRecord>;
    onGoToParagraphIssue?: (paragraphIndex: number, threadId: string) => void;
    onUpdated: (thread: DraftDiscussionThreadRecord) => void;
    onClose: () => void;
    onSelectSeededReference?: (reference: SeededReferenceSelection) => void;
}

const ISSUE_TYPE_OPTIONS: DraftDiscussionIssueType[] = [
    'fact_correction',
    'expression_improvement',
    'knowledge_supplement',
    'question_and_supplement',
];

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
            issueType: formatIssueType(normalized as DraftDiscussionIssueType),
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

function renderMessageContentWithReferences(
    content: string,
    onSelectSeededReference?: (reference: SeededReferenceSelection) => void,
) {
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

function canReplyToThread(thread: DraftDiscussionThreadRecord): boolean {
    return thread.state === 'open' || thread.state === 'proposed' || thread.state === 'accepted';
}

function canWithdrawThread(thread: DraftDiscussionThreadRecord, viewerUserId?: number | null): boolean {
    return thread.state === 'open' && viewerUserId === thread.createdBy;
}

function parseParagraphTargetIndex(targetRef: string | null | undefined): number | null {
    const matched = String(targetRef || '').trim().match(/^paragraph:(\d+)$/i);
    if (!matched) return null;
    const parsed = Number.parseInt(matched[1], 10);
    if (!Number.isFinite(parsed) || parsed < 0) return null;
    return parsed;
}

function formatAssistResolutionHint(
    suggestion: IssueReviewAssistFormSuggestion | null,
    t: ReturnType<typeof useI18n>,
): string | null {
    if (!suggestion) return null;
    if (suggestion.proposalResolution === 'accepted') return t('aiAssist.hints.proposalAccepted');
    if (suggestion.proposalResolution === 'rejected') return t('aiAssist.hints.proposalRejected');
    if (suggestion.finalResolution === 'accepted') return t('aiAssist.hints.finalAccepted');
    if (suggestion.finalResolution === 'rejected') return t('aiAssist.hints.finalRejected');
    if (suggestion.shouldRetag) return t('aiAssist.hints.retag');
    return null;
}

export default function DraftDiscussionDetailSheet({
    open,
    item,
    draftPostId,
    busy,
    viewerUserId,
    canFollowup,
    followupDisabledReason,
    canWithdrawOwn,
    withdrawDisabledReason,
    canStartReview,
    reviewDisabledReason,
    canRetag,
    retagDisabledReason,
    canResolve,
    resolveDisabledReason,
    canApply,
    applyDisabledReason,
    canUseIssueReviewAssist,
    issueReviewAssistDisabledReason,
    stateLabel,
    issueTypeLabel,
    onRequestIssueReviewAssist,
    onApplyIssueReviewAssistSuggestion,
    onReply,
    onPropose,
    onResolve,
    onWithdraw,
    onApply,
    onGoToParagraphIssue,
    onUpdated,
    onClose,
    onSelectSeededReference,
}: DraftDiscussionDetailSheetProps) {
    const t = useI18n('DraftDiscussionPanel');
    const locale = useCurrentLocale();
    const thread = item?.thread ?? null;
    const threadLifecycleKey = thread ? `${draftPostId}:${thread.id}:${thread.state}` : null;
    const threadIssueType = thread?.issueType || 'question_and_supplement';
    const [activeActionMode, setActiveActionMode] = useState<DetailActionMode>(null);
    const [issueType, setIssueType] = useState<DraftDiscussionIssueType>('question_and_supplement');
    const [proposeContent, setProposeContent] = useState('');
    const [followupContent, setFollowupContent] = useState('');
    const [resolveReason, setResolveReason] = useState('');
    const [applyReason, setApplyReason] = useState('');
    const [inlineError, setInlineError] = useState<string | null>(null);
    const [confirmWithdrawOpen, setConfirmWithdrawOpen] = useState(false);
    const [assistStatus, setAssistStatus] = useState<'idle' | 'pending' | 'ready' | 'error'>('idle');
    const [assistResult, setAssistResult] = useState<GQLIssueReviewAssistResult | null>(null);
    const [assistHint, setAssistHint] = useState<string | null>(null);
    const [assistError, setAssistError] = useState<string | null>(null);

    const threadCanReply = thread ? canReplyToThread(thread) : false;
    const threadCanWithdraw = thread ? canWithdrawThread(thread, viewerUserId) : false;
    const reviewContextReady = Boolean(thread?.reviewContext && thread.reviewContext.state !== 'unavailable');
    const canPropose = Boolean(thread && thread.state === 'open' && canStartReview && reviewContextReady);
    const canResolveNow = Boolean(thread && thread.state === 'proposed' && canResolve && reviewContextReady);
    const canApplyNow = Boolean(
        thread
        && thread.state === 'accepted'
        && canApply
        && reviewContextReady
        && !shouldResolveIssueViaParagraphEditing(thread),
    );
    const canReplyNow = Boolean(thread && threadCanReply && canFollowup);
    const canWithdrawNow = Boolean(thread && threadCanWithdraw && canWithdrawOwn);
    const paragraphIssueTargetIndex = thread ? parseParagraphTargetIndex(thread.targetRef) : null;
    const canGoToParagraphIssue = Boolean(
        thread
        && item?.primaryAction === 'goToParagraph'
        && canApply
        && paragraphIssueTargetIndex !== null
        && onGoToParagraphIssue,
    );

    const primaryActionMode: DetailActionMode = canPropose
        ? 'propose'
        : canResolveNow
            ? 'resolve'
            : canApplyNow
                ? 'apply'
                : null;
    const primaryDisabledReason = useMemo(() => {
        if (!thread) return null;
        if (!reviewContextReady && ['open', 'proposed', 'accepted'].includes(thread.state)) {
            return t('detail.contextUnavailable');
        }
        if (thread.state === 'open' && !canStartReview) return reviewDisabledReason;
        if (thread.state === 'proposed' && !canResolve) return resolveDisabledReason;
        if (
            thread.state === 'accepted'
            && !shouldResolveIssueViaParagraphEditing(thread)
            && !canApply
        ) {
            return applyDisabledReason;
        }
        return null;
    }, [applyDisabledReason, canApply, canResolve, canStartReview, resolveDisabledReason, reviewContextReady, reviewDisabledReason, t, thread]);

    useEffect(() => {
        if (!open || !thread) return;
        setActiveActionMode(primaryActionMode);
        setIssueType(threadIssueType);
        setProposeContent('');
        setFollowupContent('');
        setResolveReason('');
        setApplyReason('');
        setInlineError(null);
        setConfirmWithdrawOpen(false);
        setAssistStatus('idle');
        setAssistResult(null);
        setAssistHint(null);
        setAssistError(null);
    }, [open, primaryActionMode, threadIssueType, threadLifecycleKey]);

    const formatIssueType = (type: DraftDiscussionIssueType | null | undefined) => {
        if (type === 'fact_correction') return t('issueTypes.fact_correction');
        if (type === 'expression_improvement') return t('issueTypes.expression_improvement');
        if (type === 'knowledge_supplement') return t('issueTypes.knowledge_supplement');
        if (type === 'question_and_supplement') return t('issueTypes.question_and_supplement');
        return t('issueTypes.fallback');
    };
    const issueTypeOptions: DraftDiscussionSelectOption[] = ISSUE_TYPE_OPTIONS.map((option) => ({
        value: option,
        label: formatIssueType(option),
    }));
    const threadMessages = thread?.messages?.length
        ? thread.messages
        : thread?.latestMessage
            ? [{
                id: `${thread.id}:latest`,
                authorId: thread.latestMessage.authorId,
                messageType: thread.latestMessage.messageType,
                content: thread.latestMessage.content,
                createdAt: thread.latestMessage.createdAt,
            }]
            : [];

    const runAction = async (action: () => Promise<DraftDiscussionThreadRecord>, fallbackError: string) => {
        setInlineError(null);
        try {
            const updatedThread = await action();
            onUpdated(updatedThread);
            return updatedThread;
        } catch (error) {
            setInlineError(error instanceof Error ? error.message : fallbackError);
            return null;
        }
    };

    const handlePropose = async () => {
        if (!thread || !canPropose) return;
        const updated = await runAction(() => onPropose({
            threadId: thread.id,
            issueType: canRetag ? issueType : undefined,
            content: proposeContent.trim(),
        }), t('errors.propose'));
        if (updated) setProposeContent('');
    };

    const handleResolve = async (resolution: DraftDiscussionResolution) => {
        if (!thread || !canResolveNow) return;
        const updated = await runAction(() => onResolve({
            threadId: thread.id,
            resolution,
            issueType: canRetag ? issueType : undefined,
            reason: resolveReason.trim() || undefined,
        }), t('errors.resolve'));
        if (updated) setResolveReason('');
    };

    const handleReply = async () => {
        if (!thread || !canReplyNow) return;
        const content = followupContent.trim();
        if (!content) {
            setInlineError(t('errors.followupRequired'));
            return;
        }
        const updated = await runAction(() => onReply({
            threadId: thread.id,
            content,
        }), t('errors.reply'));
        if (updated) setFollowupContent('');
    };

    const handleWithdraw = async () => {
        if (!thread || !canWithdrawNow) return;
        const updated = await runAction(() => onWithdraw({
            threadId: thread.id,
        }), t('errors.withdraw'));
        if (updated) {
            setConfirmWithdrawOpen(false);
        }
    };

    const handleApply = async () => {
        if (!thread || !canApplyNow) return;
        const updated = await runAction(() => onApply({
            threadId: thread.id,
            reason: applyReason.trim() || undefined,
        }), t('errors.apply'));
        if (updated) setApplyReason('');
    };

    const handleIssueReviewAssist = async () => {
        if (!thread || !canUseIssueReviewAssist) return;
        setAssistStatus('pending');
        setAssistError(null);
        setAssistHint(null);

        try {
            const result = await onRequestIssueReviewAssist();
            if (!result) {
                throw new Error(t('aiAssist.errors.request'));
            }
            const suggestion = onApplyIssueReviewAssistSuggestion(result);
            if (suggestion?.issueType && canRetag && ISSUE_TYPE_OPTIONS.includes(suggestion.issueType as DraftDiscussionIssueType)) {
                setIssueType(suggestion.issueType as DraftDiscussionIssueType);
            }
            if (primaryActionMode === 'propose' && suggestion?.reason) {
                setProposeContent(suggestion.reason);
            }
            if (primaryActionMode === 'resolve' && suggestion?.reason) {
                setResolveReason(suggestion.reason);
            }
            setAssistResult(result);
            setAssistHint(formatAssistResolutionHint(suggestion, t));
            setAssistStatus('ready');
        } catch (error) {
            setAssistResult(null);
            setAssistStatus('error');
            setAssistError(error instanceof Error ? error.message : t('aiAssist.errors.request'));
        }
    };

    const renderIssueReviewAssist = () => {
        if (!thread || (thread.state !== 'open' && thread.state !== 'proposed')) {
            return null;
        }

        if (!canUseIssueReviewAssist) {
            return (
                <p className={styles.issueReviewAssistDisabled}>
                    {issueReviewAssistDisabledReason || t('aiAssist.permissionDenied')}
                </p>
            );
        }

        return (
            <div className={styles.issueReviewAssist}>
                <div className={styles.issueReviewAssistHeader}>
                    <span className={styles.issueReviewAssistTitle}>{t('aiAssist.title')}</span>
                    <button
                        type="button"
                        className={styles.issueReviewAssistButton}
                        onClick={handleIssueReviewAssist}
                        disabled={busy || assistStatus === 'pending'}
                    >
                        {assistStatus === 'pending' ? t('aiAssist.loading') : t('aiAssist.button')}
                    </button>
                </div>
                {assistStatus === 'ready' && assistResult && (
                    <div className={styles.issueReviewAssistResult}>
                        <strong>{t('aiAssist.appliedToForm')}</strong>
                        <p>{assistResult.reason}</p>
                        {assistHint && <span>{assistHint}</span>}
                    </div>
                )}
                {assistStatus === 'error' && assistError && (
                    <p className={styles.issueReviewAssistError} role="alert">
                        {assistError}
                    </p>
                )}
            </div>
        );
    };

    const renderPrimaryAction = () => {
        if (!thread) return null;
        if (item?.primaryAction === 'goToParagraph') {
            if (canGoToParagraphIssue && paragraphIssueTargetIndex !== null) {
                return (
                    <div className={styles.detailActionPanel}>
                        <p className={styles.policyHint}>{t('detail.goToParagraphHint')}</p>
                        <button
                            type="button"
                            className={styles.primaryButton}
                            onClick={() => {
                                onGoToParagraphIssue?.(paragraphIssueTargetIndex, thread.id);
                                onClose();
                            }}
                            disabled={busy}
                        >
                            {t('detail.actions.goToParagraph')}
                        </button>
                    </div>
                );
            }
            return (
                <p className={styles.policyHint}>
                    {paragraphIssueTargetIndex === null
                        ? t('detail.goToParagraphUnavailable')
                        : primaryDisabledReason || item.disabledReason || item.nextStepLabel}
                </p>
            );
        }
        if (!primaryActionMode) {
            return (
                <>
                    <p className={styles.policyHint}>
                        {primaryDisabledReason || item?.disabledReason || item?.nextStepLabel || t('detail.noPrimaryAction')}
                    </p>
                    {renderIssueReviewAssist()}
                </>
            );
        }
        if (activeActionMode !== primaryActionMode) {
            return (
                <button
                    type="button"
                    className={styles.secondaryButton}
                    onClick={() => setActiveActionMode(primaryActionMode)}
                    disabled={busy}
                >
                    {item?.nextStepLabel || t(`detail.actions.${primaryActionMode}`)}
                </button>
            );
        }
        if (primaryActionMode === 'propose') {
            return (
                <div className={styles.detailActionPanel}>
                    {canRetag ? (
                        <div className={styles.formRow}>
                            <label className={styles.fieldLabel} htmlFor="draft-discussion-detail-issue-type">{t('threads.issueTypeLabel')}</label>
                            <DraftDiscussionSelect
                                id="draft-discussion-detail-issue-type"
                                value={issueType}
                                options={issueTypeOptions}
                                onChange={(nextValue) => setIssueType(nextValue as DraftDiscussionIssueType)}
                                disabled={busy}
                            />
                        </div>
                    ) : retagDisabledReason ? (
                        <p className={styles.policyHint}>{retagDisabledReason}</p>
                    ) : null}
                    <textarea
                        className={styles.textarea}
                        placeholder={t('threads.proposePlaceholder')}
                        value={proposeContent}
                        onChange={(event) => setProposeContent(event.target.value)}
                        disabled={busy}
                    />
                    {renderIssueReviewAssist()}
                    <button type="button" className={styles.primaryButton} onClick={handlePropose} disabled={busy}>
                        {t('threads.actions.propose')}
                    </button>
                </div>
            );
        }
        if (primaryActionMode === 'resolve') {
            return (
                <div className={styles.detailActionPanel}>
                    {canRetag ? (
                        <div className={styles.formRow}>
                            <label className={styles.fieldLabel} htmlFor="draft-discussion-detail-resolve-issue-type">{t('threads.issueTypeLabel')}</label>
                            <DraftDiscussionSelect
                                id="draft-discussion-detail-resolve-issue-type"
                                value={issueType}
                                options={issueTypeOptions}
                                onChange={(nextValue) => setIssueType(nextValue as DraftDiscussionIssueType)}
                                disabled={busy}
                            />
                        </div>
                    ) : retagDisabledReason ? (
                        <p className={styles.policyHint}>{retagDisabledReason}</p>
                    ) : null}
                    <input
                        className={styles.input}
                        placeholder={t('threads.resolvePlaceholder')}
                        value={resolveReason}
                        onChange={(event) => setResolveReason(event.target.value)}
                        disabled={busy}
                    />
                    {renderIssueReviewAssist()}
                    <div className={styles.actionRow}>
                        <button type="button" className={styles.secondaryButton} onClick={() => handleResolve('accepted')} disabled={busy}>
                            {t('threads.actions.accept')}
                        </button>
                        <button type="button" className={styles.secondaryButton} onClick={() => handleResolve('rejected')} disabled={busy}>
                            {t('threads.actions.reject')}
                        </button>
                    </div>
                </div>
            );
        }
        return (
            <div className={styles.detailActionPanel}>
                <input
                    className={styles.input}
                    placeholder={t('threads.applyPlaceholder')}
                    value={applyReason}
                    onChange={(event) => setApplyReason(event.target.value)}
                    disabled={busy}
                />
                <button type="button" className={styles.primaryButton} onClick={handleApply} disabled={busy}>
                    {t('threads.actions.apply')}
                </button>
            </div>
        );
    };

    return (
        <>
            <BottomSheet
                open={open && Boolean(thread && item)}
                title={t('detail.title')}
                closeLabel={t('detail.close')}
                onClose={onClose}
            >
                {thread && item && (
                    <div className={styles.detailSheetBody}>
                        {inlineError && (
                            <div className={styles.errorBox} role="alert">
                                {inlineError}
                            </div>
                        )}
                        <section className={styles.detailSummary}>
                            <div>
                                <span className={styles.detailLabel}>{t('detail.target')}</span>
                                <strong className={styles.detailValue}>{item.targetLabel}</strong>
                            </div>
                            <div>
                                <span className={styles.detailLabel}>{t('detail.version')}</span>
                                <strong className={styles.detailValue}>{item.versionLabel}</strong>
                            </div>
                            <div>
                                <span className={styles.detailLabel}>{t('threads.issueTypeLabel')}</span>
                                <strong className={styles.detailValue}>{issueTypeLabel}</strong>
                            </div>
                            <div>
                                <span className={styles.detailLabel}>{t('detail.state')}</span>
                                <strong className={styles.detailValue}>{stateLabel}</strong>
                            </div>
                        </section>

                        <section className={styles.detailSection}>
                            <h4 className={styles.sectionTitle}>{t('detail.contextTitle')}</h4>
                            {thread.reviewContext?.state === 'unavailable' || !thread.reviewContext ? (
                                <p className={styles.emptyHint}>{t('detail.contextUnavailable')}</p>
                            ) : (
                                <>
                                    <p className={styles.contextStatus} data-state={thread.reviewContext.state}>
                                        {thread.reviewContext.state === 'changed'
                                            ? t('detail.contextChanged', {
                                                createdVersion: thread.targetVersion,
                                                currentVersion: thread.reviewContext.currentVersion ?? thread.targetVersion,
                                            })
                                            : t('detail.contextUnchanged', {version: thread.targetVersion})}
                                    </p>
                                    <div className={styles.contextDiff}>
                                        <article>
                                            <span>{t('detail.contextAtCreation', {version: thread.targetVersion})}</span>
                                            <p>{thread.reviewContext.targetAtCreation}</p>
                                        </article>
                                        <article>
                                            <span>{t('detail.contextCurrent', {
                                                version: thread.reviewContext.currentVersion ?? thread.targetVersion,
                                            })}</span>
                                            <p>{thread.reviewContext.targetCurrent}</p>
                                        </article>
                                    </div>
                                </>
                            )}
                        </section>

                        <section className={styles.detailSection}>
                            <h4 className={styles.sectionTitle}>{t('detail.timelineTitle')}</h4>
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
                                                    onSelectSeededReference,
                                                )}
                                            </div>
                                        </div>
                                    ))}
                                </div>
                            ) : (
                                <p className={styles.emptyHint}>{t('threads.noMessages')}</p>
                            )}
                        </section>

                        <section className={styles.detailSection}>
                            <h4 className={styles.sectionTitle}>{t('detail.primaryActionTitle')}</h4>
                            {renderPrimaryAction()}
                        </section>

                        <section className={styles.detailSection}>
                            <button
                                type="button"
                                className={styles.secondaryButton}
                                onClick={() => setActiveActionMode(activeActionMode === 'followup' ? primaryActionMode : 'followup')}
                                disabled={busy || !canReplyNow}
                            >
                                {t('detail.actions.followup')}
                            </button>
                            {activeActionMode === 'followup' && canReplyNow && (
                                <div className={styles.detailActionPanel}>
                                    <textarea
                                        className={styles.textarea}
                                        placeholder={t('threads.replyPlaceholder')}
                                        value={followupContent}
                                        onChange={(event) => setFollowupContent(event.target.value)}
                                        disabled={busy}
                                    />
                                    <button type="button" className={styles.secondaryButton} onClick={handleReply} disabled={busy}>
                                        {t('threads.actions.reply')}
                                    </button>
                                </div>
                            )}
                            {!canReplyNow && threadCanReply && followupDisabledReason && (
                                <p className={styles.policyHint}>{followupDisabledReason}</p>
                            )}
                        </section>

                        {threadCanWithdraw && (
                            <section className={styles.detailSection}>
                                <button
                                    type="button"
                                    className={styles.dangerButton}
                                    onClick={() => setConfirmWithdrawOpen(true)}
                                    disabled={busy || !canWithdrawNow}
                                >
                                    {t('detail.actions.withdraw')}
                                </button>
                                {!canWithdrawNow && withdrawDisabledReason && (
                                    <p className={styles.policyHint}>{withdrawDisabledReason}</p>
                                )}
                            </section>
                        )}
                    </div>
                )}
            </BottomSheet>
            <ConfirmationSheet
                open={confirmWithdrawOpen && open && Boolean(thread)}
                title={t('detail.withdrawConfirm.title')}
                description={t('detail.withdrawConfirm.description')}
                confirmLabel={t('detail.withdrawConfirm.confirm')}
                cancelLabel={t('detail.withdrawConfirm.cancel')}
                closeLabel={t('detail.close')}
                tone="danger"
                confirmDisabled={busy}
                onConfirm={handleWithdraw}
                onCancel={() => setConfirmWithdrawOpen(false)}
            />
        </>
    );
}
