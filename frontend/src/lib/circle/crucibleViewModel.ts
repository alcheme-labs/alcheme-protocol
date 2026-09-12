import type { DraftLifecycleReadModel } from '../api/draftWorkingCopy';
import type { DraftDiscussionThreadRecord } from '../discussion/api';

const CARRY_ELIGIBLE_ISSUE_TYPES = new Set([
    'fact_correction',
    'expression_improvement',
    'knowledge_supplement',
]);
const ISSUE_SUMMARY_MESSAGE_TYPES = new Set([
    'create',
    'followup',
    'propose',
    'comment',
]);

export interface CrucibleGovernanceProgressItem {
    label: string;
    value: string;
}

export interface CrucibleGovernanceSummaryView {
    actionLabel: string;
    targetLabel: string;
    statusLabel: string;
    capabilityLabel: string;
    auditLabel: string;
    progressItems: CrucibleGovernanceProgressItem[];
}

export interface CrucibleLifecycleSummaryView {
    headline: string;
    summary: string;
    metaLabel: string;
    showReviewCard: boolean;
}

export interface CrucibleParagraphBlockView {
    index: number;
    blockId: string;
    title: string;
    preview: string;
    typeLabel: string;
    sourceLabel: string;
    statusLabel: string;
    editabilityLabel: string;
    discussionCount: number;
    isActive: boolean;
    canEditParagraph: boolean;
    permissionSources: string[];
}

export interface CrucibleAcceptedIssueCarryView {
    threadId: string;
    paragraphIndex: number;
    targetVersion: number;
    summary: string;
    resolvedAt: string | null;
    resolutionReason: string | null;
}

export type CrucibleAcceptedIssueExceptionReason =
    | 'invalid_paragraph_target'
    | 'unsupported_target_type'
    | 'unsupported_issue_type';

export interface CrucibleAcceptedIssueExceptionView {
    threadId: string;
    targetType: DraftDiscussionThreadRecord['targetType'];
    targetRef: string;
    targetVersion: number;
    issueType: DraftDiscussionThreadRecord['issueType'];
    summary: string;
    reason: CrucibleAcceptedIssueExceptionReason;
    resolvedAt: string | null;
    resolutionReason: string | null;
}

export interface CrucibleFileLineReference {
    raw: string;
    path: string;
    line: number;
    index: number;
}

export interface CrucibleLifecycleSummaryCopy {
    pendingTime: string;
    latestUpdatePending: string;
    updatedLabel: (date: string) => string;
    headline: (status: string, version: number) => string;
    statusLabel: (status: DraftLifecycleReadModel['documentStatus']) => string;
    summaries: {
        draftingManualWithIssues: (input: { round: number; count: number; version: number }) => string;
        draftingManualNoIssues: (input: { round: number }) => string;
        draftingAutoWithIssues: (input: { round: number; count: number; version: number; window: string }) => string;
        draftingAutoNoIssues: (input: { round: number; window: string }) => string;
        reviewExpiredWithIssues: (input: { count: number; version: number }) => string;
        reviewExpiredNoIssues: (input: { version: number }) => string;
        reviewActiveWithIssues: (input: { count: number; version: number; window: string }) => string;
        reviewActiveNoIssues: (input: { version: number; window: string }) => string;
        archivedWithStableVersion: (input: { version: number }) => string;
        archivedWithoutStableVersion: string;
        crystallizationActive: (input: { version: number }) => string;
        crystallizationFailed: (input: { version: number }) => string;
        crystallized: (input: { version: number }) => string;
        default: (input: { version: number }) => string;
    };
}

export interface CrucibleGovernanceSummaryCopy {
    actionLabel: (status: DraftLifecycleReadModel['documentStatus']) => string;
    targetVersion: (version: number) => string;
    statusLabel: (status: DraftLifecycleReadModel['documentStatus']) => string;
    capabilities: {
        create: string;
        resolve: string;
        apply: string;
        crystallize: string;
        viewOnly: string;
    };
    audit: {
        pending: string;
        updated: (date: string) => string;
    };
    progress: {
        submitted: string;
        inReview: string;
        accepted: string;
        resolved: string;
    };
}

export interface CrucibleParagraphBlocksCopy {
    title: (index: number) => string;
    typeLabel: string;
    sourceVersion: (version: number) => string;
    status: {
        locked: string;
        resolved: string;
        acceptedPending: string;
        inReview: string;
        submitted: string;
        ready: string;
    };
    editability: {
        locked: string;
        selected: string;
        editable: string;
        readOnly: string;
    };
}

export interface CrucibleAcceptedIssuesCopy {
    emptySummary: string;
}

const DEFAULT_LIFECYCLE_SUMMARY_COPY: CrucibleLifecycleSummaryCopy = {
    pendingTime: '__pending_time__',
    latestUpdatePending: '__latest_update_pending__',
    updatedLabel: (date) => `__updated__:${date}`,
    headline: (status, version) => `${status} · v${version}`,
    statusLabel: (status) => {
        if (status === 'drafting') return 'drafting';
        if (status === 'review') return 'review';
        if (status === 'crystallization_active') return 'crystallization_active';
        if (status === 'crystallization_failed') return 'crystallization_failed';
        if (status === 'crystallized') return 'crystallized';
        if (status === 'archived') return 'archived';
        return 'in_progress';
    },
    summaries: {
        draftingManualWithIssues: ({ round, count, version }) => `drafting.manual.with_issues:${round}:${count}:${version}`,
        draftingManualNoIssues: ({ round }) => `drafting.manual.no_issues:${round}`,
        draftingAutoWithIssues: ({ round, count, version, window }) => `drafting.auto.with_issues:${round}:${count}:${version}:${window}`,
        draftingAutoNoIssues: ({ round, window }) => `drafting.auto.no_issues:${round}:${window}`,
        reviewExpiredWithIssues: ({ count, version }) => `review.expired.with_issues:${count}:${version}`,
        reviewExpiredNoIssues: ({ version }) => `review.expired.no_issues:${version}`,
        reviewActiveWithIssues: ({ count, version, window }) => `review.active.with_issues:${count}:${version}:${window}`,
        reviewActiveNoIssues: ({ version, window }) => `review.active.no_issues:${version}:${window}`,
        archivedWithStableVersion: ({ version }) => `archived.with_stable_version:${version}`,
        archivedWithoutStableVersion: 'archived.without_stable_version',
        crystallizationActive: ({ version }) => `crystallization.active:${version}`,
        crystallizationFailed: ({ version }) => `crystallization.failed:${version}`,
        crystallized: ({ version }) => `crystallized:${version}`,
        default: ({ version }) => `default:${version}`,
    },
};

const DEFAULT_GOVERNANCE_SUMMARY_COPY: CrucibleGovernanceSummaryCopy = {
    actionLabel: (status) => {
        if (status === 'drafting') return 'drafting';
        if (status === 'review') return 'review';
        if (status === 'crystallization_active') return 'crystallization_active';
        if (status === 'crystallization_failed') return 'crystallization_failed';
        if (status === 'crystallized') return 'crystallized';
        if (status === 'archived') return 'archived';
        return 'default';
    },
    targetVersion: (version) => `v${version}`,
    statusLabel: (status) => DEFAULT_LIFECYCLE_SUMMARY_COPY.statusLabel(status),
    capabilities: {
        create: 'create',
        resolve: 'resolve',
        apply: 'apply',
        crystallize: 'crystallize',
        viewOnly: 'view_only',
    },
    audit: {
        pending: '__latest_activity_pending__',
        updated: (date) => `__updated_at__:${date}`,
    },
    progress: {
        submitted: 'submitted',
        inReview: 'in_review',
        accepted: 'accepted',
        resolved: 'resolved',
    },
};

const DEFAULT_PARAGRAPH_BLOCKS_COPY: CrucibleParagraphBlocksCopy = {
    title: (index) => `p${index}`,
    typeLabel: 'paragraph',
    sourceVersion: (version) => `V${version}`,
    status: {
        locked: 'locked',
        resolved: 'resolved',
        acceptedPending: 'accepted_pending',
        inReview: 'in_review',
        submitted: 'submitted',
        ready: 'ready',
    },
    editability: {
        locked: 'locked',
        selected: 'selected',
        editable: 'editable',
        readOnly: 'read_only',
    },
};

const DEFAULT_ACCEPTED_ISSUES_COPY: CrucibleAcceptedIssuesCopy = {
    emptySummary: '__empty_issue_summary__',
};

const FILE_LINE_REFERENCE_PATTERN = /@file:([A-Za-z0-9._/-]+):([1-9]\d*)/g;

export function isCarryEligibleIssueType(issueType: DraftDiscussionThreadRecord['issueType']): boolean {
    return CARRY_ELIGIBLE_ISSUE_TYPES.has(issueType);
}

function resolveIssueSummary(
    thread: DraftDiscussionThreadRecord,
    fallbackSummary: string,
): string {
    const preferredMessage = (thread.messages || []).find((message) => (
        ISSUE_SUMMARY_MESSAGE_TYPES.has(message.messageType)
        && String(message.content || '').trim().length > 0
    ));
    if (preferredMessage) {
        return String(preferredMessage.content || '').trim();
    }

    const latestContent = String(thread.latestMessage?.content || '').trim();
    if (
        latestContent
        && ISSUE_SUMMARY_MESSAGE_TYPES.has(String(thread.latestMessage?.messageType || '').trim())
    ) {
        return latestContent;
    }

    const anyMeaningfulMessage = (thread.messages || []).find((message) => (
        String(message.content || '').trim().length > 0
    ));
    if (anyMeaningfulMessage) {
        return String(anyMeaningfulMessage.content || '').trim();
    }

    return latestContent || fallbackSummary;
}

export function shouldResolveIssueViaParagraphEditing(
    thread: Pick<DraftDiscussionThreadRecord, 'targetType' | 'state' | 'issueType' | 'latestApplication'>,
): boolean {
    return (
        thread.targetType === 'paragraph'
        && thread.state === 'accepted'
        && !thread.latestApplication
        && isCarryEligibleIssueType(thread.issueType)
    );
}

interface BuildGovernanceSummaryInput {
    lifecycle: DraftLifecycleReadModel;
    threads: DraftDiscussionThreadRecord[];
    canCreate: boolean;
    canResolve: boolean;
    canApply: boolean;
    canCrystallize: boolean;
}

interface BuildParagraphBlocksInput {
    content: string;
    lifecycle: DraftLifecycleReadModel;
    threads: DraftDiscussionThreadRecord[];
    selectedParagraphIndex: number | null;
    canEditWorkingCopy: boolean;
    permissionSourcesByBlockId?: Record<string, string[]>;
}

function formatMonthDay(
    value: string | null | undefined,
    locale = 'zh',
    pendingLabel = DEFAULT_LIFECYCLE_SUMMARY_COPY.pendingTime,
): string {
    if (!value) return pendingLabel;
    const parsed = new Date(value);
    if (Number.isNaN(parsed.getTime())) return pendingLabel;
    return new Intl.DateTimeFormat(locale, {
        month: 'long',
        day: 'numeric',
    }).format(parsed);
}

interface CrucibleParagraphSpan {
    start: number;
    end: number;
    content: string;
}

function resolveParagraphSpans(content: string): CrucibleParagraphSpan[] {
    const source = String(content || '');
    const spans = Array.from(source.matchAll(/[^\n]+/g)).flatMap((match) => {
        const rawLine = String(match[0] || '');
        const contentEnd = rawLine.endsWith('\r') ? rawLine.length - 1 : rawLine.length;
        const contentValue = rawLine.slice(0, contentEnd).trim();
        if (!contentValue) return [];
        const start = match.index ?? 0;
        return [{
            start,
            end: start + contentEnd,
            content: contentValue,
        }];
    });
    return spans.length > 0
        ? spans
        : [{ start: 0, end: source.length, content: '' }];
}

function splitParagraphs(content: string): string[] {
    return resolveParagraphSpans(content).map((span) => span.content);
}

function parseParagraphIndexFromTargetRef(targetRef: string | null | undefined): number | null {
    const matched = String(targetRef || '').trim().match(/^paragraph:(\d+)$/i);
    if (!matched) return null;
    const index = Number.parseInt(matched[1], 10);
    if (!Number.isFinite(index) || index < 0) return null;
    return index;
}

export function splitCrucibleParagraphContent(content: string): string[] {
    const paragraphs = splitParagraphs(content);
    return paragraphs.length > 0 ? paragraphs : [''];
}

export function normalizeCrucibleParagraphEditContent(content: string): string {
    return String(content || '')
        .replace(/\r\n?/g, '\n')
        .replace(/\n+/g, ' ')
        .trim();
}

export function replaceCrucibleParagraphContent(
    content: string,
    paragraphIndex: number,
    nextParagraph: string,
): string {
    const source = String(content || '');
    const spans = resolveParagraphSpans(source);
    if (!Number.isInteger(paragraphIndex) || paragraphIndex < 0 || paragraphIndex >= spans.length) {
        return source;
    }
    const span = spans[paragraphIndex];
    const normalizedParagraph = normalizeCrucibleParagraphEditContent(nextParagraph);
    if (!normalizedParagraph) return source;
    return `${source.slice(0, span.start)}${normalizedParagraph}${source.slice(span.end)}`;
}

export type RemoveCrucibleParagraphResult =
    | {
        ok: true;
        content: string;
        removedParagraph: string;
    }
    | {
        ok: false;
        code: 'invalid_index' | 'last_paragraph' | 'empty_result';
    };

export function removeCrucibleParagraphContent(
    content: string,
    paragraphIndex: number,
): RemoveCrucibleParagraphResult {
    const source = String(content || '');
    const spans = resolveParagraphSpans(source);
    if (!Number.isInteger(paragraphIndex) || paragraphIndex < 0 || paragraphIndex >= spans.length) {
        return { ok: false, code: 'invalid_index' };
    }
    if (spans.length <= 1) {
        return { ok: false, code: 'last_paragraph' };
    }

    const target = spans[paragraphIndex];
    const deleteStart = paragraphIndex === 0
        ? target.start
        : spans[paragraphIndex - 1].end;
    const deleteEnd = paragraphIndex === 0
        ? spans[paragraphIndex + 1].start
        : target.end;
    const removedParagraph = target.content;
    const nextContent = `${source.slice(0, deleteStart)}${source.slice(deleteEnd)}`;
    if (!nextContent) {
        return { ok: false, code: 'empty_result' };
    }

    return {
        ok: true,
        content: nextContent,
        removedParagraph,
    };
}

export function extractCrucibleFileLineReferences(content: string): CrucibleFileLineReference[] {
    return Array.from(String(content || '').matchAll(FILE_LINE_REFERENCE_PATTERN)).map((match) => ({
        raw: match[0],
        path: match[1],
        line: Number.parseInt(match[2], 10),
        index: match.index ?? 0,
    }));
}

function buildCapabilityLabel(
    input: BuildGovernanceSummaryInput,
    locale: string,
    copy: CrucibleGovernanceSummaryCopy,
): string {
    const capabilities: string[] = [];
    if (input.canCreate) capabilities.push(copy.capabilities.create);
    if (input.canResolve) capabilities.push(copy.capabilities.resolve);
    if (input.canApply) capabilities.push(copy.capabilities.apply);
    if (input.canCrystallize) capabilities.push(copy.capabilities.crystallize);
    if (capabilities.length === 0) {
        return copy.capabilities.viewOnly;
    }

    return new Intl.ListFormat(locale, {
        style: 'short',
        type: 'conjunction',
    }).format(capabilities);
}

function buildAuditLabel(
    lifecycle: DraftLifecycleReadModel,
    locale: string,
    copy: CrucibleGovernanceSummaryCopy['audit'],
): string {
    const source = lifecycle.reviewBinding.latestThreadUpdatedAt
        || lifecycle.workingCopy.updatedAt
        || lifecycle.stableSnapshot.createdAt;
    const label = formatMonthDay(source, locale, DEFAULT_LIFECYCLE_SUMMARY_COPY.pendingTime);
    return label === DEFAULT_LIFECYCLE_SUMMARY_COPY.pendingTime ? copy.pending : copy.updated(label);
}

function buildParagraphStatus(
    lifecycle: DraftLifecycleReadModel,
    paragraphThreads: DraftDiscussionThreadRecord[],
    copy: CrucibleParagraphBlocksCopy['status'],
): string {
    if (lifecycle.documentStatus !== 'drafting') {
        return copy.locked;
    }
    if (paragraphThreads.some((thread) => thread.state === 'applied')) {
        return copy.resolved;
    }
    if (paragraphThreads.some((thread) => thread.state === 'accepted')) {
        return copy.acceptedPending;
    }
    if (paragraphThreads.some((thread) => thread.state === 'proposed')) {
        return copy.inReview;
    }
    if (paragraphThreads.some((thread) => thread.state === 'open')) {
        return copy.submitted;
    }
    return copy.ready;
}

export function buildCrucibleLifecycleSummary(
    lifecycle: DraftLifecycleReadModel,
    options: {
        locale?: string;
        copy?: CrucibleLifecycleSummaryCopy;
    } = {},
): CrucibleLifecycleSummaryView {
    const locale = options.locale || 'zh';
    const copy = options.copy || DEFAULT_LIFECYCLE_SUMMARY_COPY;
    const stableVersion = lifecycle.stableSnapshot.draftVersion;
    const boundVersion = lifecycle.reviewBinding.boundSnapshotVersion;
    const totalThreads = lifecycle.reviewBinding.totalThreadCount;
    const updateSource =
        lifecycle.reviewBinding.latestThreadUpdatedAt
        || lifecycle.workingCopy.updatedAt
        || lifecycle.stableSnapshot.createdAt;
    const updateLabel = formatMonthDay(updateSource, locale, copy.pendingTime);

    let summary = '';
    if (lifecycle.documentStatus === 'drafting') {
        const draftingWindowLabel = formatMonthDay(lifecycle.draftingEndsAt, locale, copy.pendingTime);
        if (lifecycle.reviewEntryMode === 'manual_only') {
            summary = totalThreads > 0
                ? copy.summaries.draftingManualWithIssues({
                    round: lifecycle.currentRound,
                    count: totalThreads,
                    version: boundVersion,
                })
                : copy.summaries.draftingManualNoIssues({
                    round: lifecycle.currentRound,
                });
        } else {
            summary = totalThreads > 0
                ? copy.summaries.draftingAutoWithIssues({
                    round: lifecycle.currentRound,
                    count: totalThreads,
                    version: boundVersion,
                    window: draftingWindowLabel,
                })
                : copy.summaries.draftingAutoNoIssues({
                    round: lifecycle.currentRound,
                    window: draftingWindowLabel,
                });
        }
    } else if (lifecycle.documentStatus === 'review') {
        const reviewWindowLabel = formatMonthDay(lifecycle.reviewEndsAt, locale, copy.pendingTime);
        if (lifecycle.reviewWindowExpiredAt) {
            summary = totalThreads > 0
                ? copy.summaries.reviewExpiredWithIssues({
                    count: totalThreads,
                    version: boundVersion,
                })
                : copy.summaries.reviewExpiredNoIssues({
                    version: boundVersion,
                });
        } else {
            summary = totalThreads > 0
                ? copy.summaries.reviewActiveWithIssues({
                    count: totalThreads,
                    version: boundVersion,
                    window: reviewWindowLabel,
                })
                : copy.summaries.reviewActiveNoIssues({
                    version: boundVersion,
                    window: reviewWindowLabel,
                });
        }
    } else if (lifecycle.documentStatus === 'archived') {
        summary = stableVersion > 1
            ? copy.summaries.archivedWithStableVersion({ version: stableVersion })
            : copy.summaries.archivedWithoutStableVersion;
    } else if (lifecycle.documentStatus === 'crystallization_active') {
        summary = copy.summaries.crystallizationActive({ version: boundVersion });
    } else if (lifecycle.documentStatus === 'crystallization_failed') {
        summary = copy.summaries.crystallizationFailed({ version: boundVersion });
    } else if (lifecycle.documentStatus === 'crystallized') {
        summary = copy.summaries.crystallized({ version: stableVersion });
    } else {
        summary = copy.summaries.default({ version: boundVersion });
    }

    return {
        headline: copy.headline(copy.statusLabel(lifecycle.documentStatus), stableVersion),
        summary,
        metaLabel: updateLabel === copy.pendingTime ? copy.latestUpdatePending : copy.updatedLabel(updateLabel),
        showReviewCard: totalThreads > 0,
    };
}

export function buildCrucibleGovernanceSummary(
    input: BuildGovernanceSummaryInput,
    options: {
        locale?: string;
        copy?: CrucibleGovernanceSummaryCopy;
    } = {},
): CrucibleGovernanceSummaryView {
    const locale = options.locale || 'zh';
    const copy = options.copy || DEFAULT_GOVERNANCE_SUMMARY_COPY;
    const { lifecycle } = input;

    return {
        actionLabel: copy.actionLabel(lifecycle.documentStatus),
        targetLabel: copy.targetVersion(lifecycle.reviewBinding.boundSnapshotVersion),
        statusLabel: copy.statusLabel(lifecycle.documentStatus),
        capabilityLabel: buildCapabilityLabel(input, locale, copy),
        auditLabel: buildAuditLabel(lifecycle, locale, copy.audit),
        progressItems: [
            { label: copy.progress.submitted, value: String(lifecycle.reviewBinding.openThreadCount) },
            { label: copy.progress.inReview, value: String(lifecycle.reviewBinding.proposedThreadCount) },
            { label: copy.progress.accepted, value: String(lifecycle.reviewBinding.acceptedThreadCount) },
            { label: copy.progress.resolved, value: String(lifecycle.reviewBinding.appliedThreadCount) },
        ],
    };
}

export function buildCrucibleParagraphBlocks(
    input: BuildParagraphBlocksInput,
    options: {
        copy?: CrucibleParagraphBlocksCopy;
    } = {},
): CrucibleParagraphBlockView[] {
    const copy = options.copy || DEFAULT_PARAGRAPH_BLOCKS_COPY;
    const paragraphs = splitCrucibleParagraphContent(input.content);
    const sourceLabel = copy.sourceVersion(input.lifecycle.stableSnapshot.draftVersion);

    return paragraphs.map((paragraph, index) => {
        const blockId = `paragraph:${index}`;
        const paragraphThreads = input.threads.filter((thread) =>
            thread.targetType === 'paragraph' && thread.targetRef === blockId,
        );
        const permissionSources = input.permissionSourcesByBlockId?.[blockId] || [];
        const scopedEditable = permissionSources.includes('source_participant')
            || permissionSources.includes('temporary_grant');
        const canEditParagraph = input.lifecycle.documentStatus === 'drafting'
            && (input.canEditWorkingCopy || scopedEditable);

        return {
            index,
            blockId,
            title: copy.title(index + 1),
            preview: paragraph.length > 48 ? `${paragraph.slice(0, 48)}…` : paragraph,
            typeLabel: copy.typeLabel,
            sourceLabel,
            statusLabel: buildParagraphStatus(input.lifecycle, paragraphThreads, copy.status),
            editabilityLabel: input.lifecycle.documentStatus !== 'drafting'
                ? copy.editability.locked
                : input.selectedParagraphIndex === index
                    ? copy.editability.selected
                    : canEditParagraph
                        ? copy.editability.editable
                        : copy.editability.readOnly,
            discussionCount: paragraphThreads.length,
            isActive: input.selectedParagraphIndex === index,
            canEditParagraph,
            permissionSources,
        };
    });
}

export function buildCrucibleAcceptedIssuesByParagraph(
    threads: DraftDiscussionThreadRecord[],
    options: {
        copy?: CrucibleAcceptedIssuesCopy;
        paragraphCount?: number | null;
    } = {},
): Record<number, CrucibleAcceptedIssueCarryView[]> {
    const copy = options.copy || DEFAULT_ACCEPTED_ISSUES_COPY;
    const paragraphCount = Number(options.paragraphCount);
    const grouped: Record<number, CrucibleAcceptedIssueCarryView[]> = {};

    for (const thread of threads) {
        if (thread.targetType !== 'paragraph') continue;
        if (thread.state !== 'accepted') continue;
        if (thread.latestApplication) continue;
        if (!CARRY_ELIGIBLE_ISSUE_TYPES.has(thread.issueType)) continue;

        const paragraphIndex = parseParagraphIndexFromTargetRef(thread.targetRef);
        if (paragraphIndex === null) continue;
        if (Number.isFinite(paragraphCount) && paragraphIndex >= paragraphCount) continue;

        const issue: CrucibleAcceptedIssueCarryView = {
            threadId: thread.id,
            paragraphIndex,
            targetVersion: thread.targetVersion,
            summary: resolveIssueSummary(thread, copy.emptySummary),
            resolvedAt: thread.latestResolution?.resolvedAt || null,
            resolutionReason: thread.latestResolution?.reason || null,
        };

        if (!grouped[paragraphIndex]) {
            grouped[paragraphIndex] = [];
        }
        grouped[paragraphIndex].push(issue);
    }

    for (const key of Object.keys(grouped)) {
        grouped[Number(key)].sort((left, right) => {
            const leftTime = left.resolvedAt ? new Date(left.resolvedAt).getTime() : 0;
            const rightTime = right.resolvedAt ? new Date(right.resolvedAt).getTime() : 0;
            return rightTime - leftTime;
        });
    }

    return grouped;
}

export function buildCrucibleAcceptedIssueExceptions(
    threads: DraftDiscussionThreadRecord[],
    options: {
        copy?: CrucibleAcceptedIssuesCopy;
        paragraphCount?: number | null;
    } = {},
): CrucibleAcceptedIssueExceptionView[] {
    const copy = options.copy || DEFAULT_ACCEPTED_ISSUES_COPY;
    const paragraphCount = Number(options.paragraphCount);
    const exceptions: CrucibleAcceptedIssueExceptionView[] = [];

    for (const thread of threads) {
        if (thread.state !== 'accepted') continue;
        if (thread.latestApplication) continue;

        let reason: CrucibleAcceptedIssueExceptionReason | null = null;
        if (!CARRY_ELIGIBLE_ISSUE_TYPES.has(thread.issueType)) {
            reason = 'unsupported_issue_type';
        } else if (thread.targetType === 'paragraph') {
            const paragraphIndex = parseParagraphIndexFromTargetRef(thread.targetRef);
            const paragraphExists = paragraphIndex !== null
                && (!Number.isFinite(paragraphCount) || paragraphIndex < paragraphCount);
            if (paragraphExists) continue;
            reason = 'invalid_paragraph_target';
        } else if (thread.targetType === 'structure' || thread.targetType === 'document') {
            reason = 'unsupported_target_type';
        } else {
            reason = 'unsupported_target_type';
        }

        exceptions.push({
            threadId: thread.id,
            targetType: thread.targetType,
            targetRef: thread.targetRef,
            targetVersion: thread.targetVersion,
            issueType: thread.issueType,
            summary: resolveIssueSummary(thread, copy.emptySummary),
            reason,
            resolvedAt: thread.latestResolution?.resolvedAt || null,
            resolutionReason: thread.latestResolution?.reason || null,
        });
    }

    return exceptions.sort((left, right) => {
        const leftTime = left.resolvedAt ? new Date(left.resolvedAt).getTime() : 0;
        const rightTime = right.resolvedAt ? new Date(right.resolvedAt).getTime() : 0;
        if (rightTime !== leftTime) return rightTime - leftTime;
        return left.threadId.localeCompare(right.threadId);
    });
}
