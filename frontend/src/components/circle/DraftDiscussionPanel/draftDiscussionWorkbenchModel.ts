import type { DraftDiscussionThreadRecord } from '../../../lib/api/discussion';
import { shouldResolveIssueViaParagraphEditing } from '../../../lib/circle/crucibleViewModel';

export type DraftDiscussionWorkbenchViewId = 'toHandle' | 'mine' | 'all';

export interface DraftDiscussionWorkbenchCapabilities {
    canStartReview: boolean;
    reviewDisabledReason: string | null;
    canResolve: boolean;
    resolveDisabledReason: string | null;
    canApply: boolean;
    applyDisabledReason: string | null;
    editableParagraphIndices?: number[];
    applyViaParagraphEditingDisabledReason: string | null;
    paragraphApplicationUnavailableReason: string;
    canFollowup: boolean;
    followupDisabledReason: string | null;
    canWithdrawOwn: boolean;
    withdrawDisabledReason: string | null;
}

export interface DraftDiscussionWorkbenchPolicyLabels {
    reviewerLabel: string;
    applierLabel: string;
    followupLabel: string;
}

export interface DraftDiscussionWorkbenchCopy {
    currentVersionUnavailable: string;
    target: {
        paragraph: (index: number) => string;
        invalidParagraph: (value: string) => string;
        structure: (value: string) => string;
        document: string;
        generic: (type: string, value: string) => string;
    };
    version: {
        current: (version: number) => string;
        history: (version: number) => string;
    };
    latestActivity: (input: {
        messageType: string;
        content: string | null;
        authorId: number;
        createdAt: string;
    }) => string;
    nextStep: {
        propose: string;
        resolve: string;
        apply: string;
        applyByParagraphEditing: (targetLabel: string) => string;
        waitForReviewer: (label: string) => string;
        waitForResolver: (label: string) => string;
        waitForApplication: (label: string) => string;
        done: string;
        closed: string;
    };
}

export interface DraftDiscussionWorkbenchItem {
    thread: DraftDiscussionThreadRecord;
    isCurrentVersion: boolean;
    isMine: boolean;
    targetLabel: string;
    primarySummary: string;
    latestActivitySummary: string | null;
    versionLabel: string;
    nextStepKind:
        | 'propose'
        | 'resolve'
        | 'apply'
        | 'applyByParagraphEditing'
        | 'followup'
        | 'waitForReviewer'
        | 'waitForResolver'
        | 'waitForApplication'
        | 'done'
        | 'closed';
    nextStepLabel: string;
    disabledReason: string | null;
    primaryAction:
        | 'openDetail'
        | 'propose'
        | 'resolve'
        | 'apply'
        | 'goToParagraph'
        | null;
}

export interface DraftDiscussionWorkbenchModel {
    toHandle: DraftDiscussionWorkbenchItem[];
    mine: DraftDiscussionWorkbenchItem[];
    current: DraftDiscussionWorkbenchItem[];
    history: DraftDiscussionWorkbenchItem[];
    currentVersion: number | null;
    currentVersionUnavailableReason: string | null;
    counts: {
        toHandle: number;
        mine: number;
        allCurrent: number;
        allHistory: number;
    };
}

export interface BuildDraftDiscussionWorkbenchModelInput {
    threads: DraftDiscussionThreadRecord[];
    viewerUserId?: number | null;
    currentDraftVersion: number | null;
    currentVersionUnavailableReason?: string | null;
    capabilities: DraftDiscussionWorkbenchCapabilities;
    policyLabels: DraftDiscussionWorkbenchPolicyLabels;
    copy: DraftDiscussionWorkbenchCopy;
}

function normalizeCurrentVersion(version: number | null): number | null {
    return Number.isInteger(version) && Number(version) > 0 ? Number(version) : null;
}

function compareByUpdatedDesc(
    left: DraftDiscussionWorkbenchItem,
    right: DraftDiscussionWorkbenchItem,
): number {
    const leftTime = Date.parse(left.thread.updatedAt || left.thread.createdAt || '');
    const rightTime = Date.parse(right.thread.updatedAt || right.thread.createdAt || '');
    const normalizedLeft = Number.isFinite(leftTime) ? leftTime : 0;
    const normalizedRight = Number.isFinite(rightTime) ? rightTime : 0;
    if (normalizedRight !== normalizedLeft) return normalizedRight - normalizedLeft;
    return String(left.thread.id).localeCompare(String(right.thread.id));
}

function compareMine(
    left: DraftDiscussionWorkbenchItem,
    right: DraftDiscussionWorkbenchItem,
): number {
    if (left.isCurrentVersion !== right.isCurrentVersion) {
        return left.isCurrentVersion ? -1 : 1;
    }
    return compareByUpdatedDesc(left, right);
}

function formatTargetLabel(
    thread: DraftDiscussionThreadRecord,
    copy: DraftDiscussionWorkbenchCopy,
): string {
    const targetType = String(thread.targetType || '').trim();
    const targetRef = String(thread.targetRef || '').trim();

    if (targetType === 'paragraph') {
        const match = targetRef.match(/^paragraph:(\d+)$/i);
        if (!match) return copy.target.invalidParagraph(targetRef);
        const zeroBasedIndex = Number(match[1]);
        if (!Number.isInteger(zeroBasedIndex) || zeroBasedIndex < 0) {
            return copy.target.invalidParagraph(targetRef);
        }
        return copy.target.paragraph(zeroBasedIndex + 1);
    }

    if (targetType === 'structure') {
        return copy.target.structure(targetRef);
    }

    if (targetType === 'document') {
        return copy.target.document;
    }

    return copy.target.generic(targetType, targetRef);
}

function parseParagraphTargetIndex(thread: DraftDiscussionThreadRecord): number | null {
    if (String(thread.targetType || '').trim() !== 'paragraph') return null;
    const match = String(thread.targetRef || '').trim().match(/^paragraph:(\d+)$/i);
    if (!match) return null;
    const parsed = Number(match[1]);
    if (!Number.isInteger(parsed) || parsed < 0) return null;
    return parsed;
}

function canEditParagraphTarget(
    paragraphIndex: number | null,
    capabilities: DraftDiscussionWorkbenchCapabilities,
): boolean {
    if (paragraphIndex === null) return false;
    return (capabilities.editableParagraphIndices || []).includes(paragraphIndex);
}

function resolvePrimarySummary(thread: DraftDiscussionThreadRecord): string {
    const createMessage = (thread.messages || []).find((message) => (
        String(message.messageType || '').trim() === 'create'
        && String(message.content || '').trim().length > 0
    ));
    if (createMessage) return String(createMessage.content || '').trim();

    const latestContent = String(thread.latestMessage?.content || '').trim();
    if (latestContent) return latestContent;

    const firstContent = (thread.messages || []).find((message) => (
        String(message.content || '').trim().length > 0
    ));
    return String(firstContent?.content || '').trim();
}

function resolveLatestActivitySummary(
    thread: DraftDiscussionThreadRecord,
    copy: DraftDiscussionWorkbenchCopy,
): string | null {
    const latest = thread.latestMessage;
    if (!latest) return null;
    return copy.latestActivity({
        messageType: latest.messageType,
        content: latest.content,
        authorId: latest.authorId,
        createdAt: latest.createdAt,
    });
}

function buildActionState(input: {
    thread: DraftDiscussionThreadRecord;
    isCurrentVersion: boolean;
    targetLabel: string;
    capabilities: DraftDiscussionWorkbenchCapabilities;
    policyLabels: DraftDiscussionWorkbenchPolicyLabels;
    copy: DraftDiscussionWorkbenchCopy;
}): Pick<DraftDiscussionWorkbenchItem, 'nextStepKind' | 'nextStepLabel' | 'disabledReason' | 'primaryAction'> {
    const {
        thread,
        isCurrentVersion,
        targetLabel,
        capabilities,
        policyLabels,
        copy,
    } = input;

    if (thread.state === 'open') {
        if (isCurrentVersion && capabilities.canStartReview) {
            return {
                nextStepKind: 'propose',
                nextStepLabel: copy.nextStep.propose,
                disabledReason: null,
                primaryAction: 'propose',
            };
        }
        return {
            nextStepKind: 'waitForReviewer',
            nextStepLabel: copy.nextStep.waitForReviewer(policyLabels.reviewerLabel),
            disabledReason: isCurrentVersion ? capabilities.reviewDisabledReason : null,
            primaryAction: 'openDetail',
        };
    }

    if (thread.state === 'proposed') {
        if (isCurrentVersion && capabilities.canResolve) {
            return {
                nextStepKind: 'resolve',
                nextStepLabel: copy.nextStep.resolve,
                disabledReason: null,
                primaryAction: 'resolve',
            };
        }
        return {
            nextStepKind: 'waitForResolver',
            nextStepLabel: copy.nextStep.waitForResolver(policyLabels.reviewerLabel),
            disabledReason: isCurrentVersion ? capabilities.resolveDisabledReason : null,
            primaryAction: 'openDetail',
        };
    }

    if (thread.state === 'accepted') {
        if (thread.latestApplication) {
            return {
                nextStepKind: 'done',
                nextStepLabel: copy.nextStep.done,
                disabledReason: null,
                primaryAction: 'openDetail',
            };
        }

        if (isCurrentVersion && capabilities.canApply) {
            if (shouldResolveIssueViaParagraphEditing(thread)) {
                const paragraphIndex = parseParagraphTargetIndex(thread);
                if (canEditParagraphTarget(paragraphIndex, capabilities)) {
                    return {
                        nextStepKind: 'applyByParagraphEditing',
                        nextStepLabel: copy.nextStep.applyByParagraphEditing(targetLabel),
                        disabledReason: null,
                        primaryAction: 'goToParagraph',
                    };
                }
                return {
                    nextStepKind: 'waitForApplication',
                    nextStepLabel: copy.nextStep.waitForApplication(policyLabels.applierLabel),
                    disabledReason: paragraphIndex === null
                        ? capabilities.paragraphApplicationUnavailableReason
                        : capabilities.applyViaParagraphEditingDisabledReason,
                    primaryAction: 'openDetail',
                };
            }
            return {
                nextStepKind: 'apply',
                nextStepLabel: copy.nextStep.apply,
                disabledReason: null,
                primaryAction: 'apply',
            };
        }

        return {
            nextStepKind: 'waitForApplication',
            nextStepLabel: copy.nextStep.waitForApplication(policyLabels.applierLabel),
            disabledReason: isCurrentVersion ? capabilities.applyDisabledReason : null,
            primaryAction: 'openDetail',
        };
    }

    if (thread.state === 'applied') {
        return {
            nextStepKind: 'done',
            nextStepLabel: copy.nextStep.done,
            disabledReason: null,
            primaryAction: 'openDetail',
        };
    }

    return {
        nextStepKind: 'closed',
        nextStepLabel: copy.nextStep.closed,
        disabledReason: null,
        primaryAction: 'openDetail',
    };
}

export function buildDraftDiscussionWorkbenchModel(
    input: BuildDraftDiscussionWorkbenchModelInput,
): DraftDiscussionWorkbenchModel {
    const currentVersion = normalizeCurrentVersion(input.currentDraftVersion);
    const items = (input.threads || []).map((thread): DraftDiscussionWorkbenchItem => {
        const isCurrentVersion = currentVersion !== null && thread.targetVersion === currentVersion;
        const targetLabel = formatTargetLabel(thread, input.copy);
        const actionState = buildActionState({
            thread,
            isCurrentVersion,
            targetLabel,
            capabilities: input.capabilities,
            policyLabels: input.policyLabels,
            copy: input.copy,
        });
        return {
            thread,
            isCurrentVersion,
            isMine: input.viewerUserId !== null
                && input.viewerUserId !== undefined
                && thread.createdBy === input.viewerUserId,
            targetLabel,
            primarySummary: resolvePrimarySummary(thread),
            latestActivitySummary: resolveLatestActivitySummary(thread, input.copy),
            versionLabel: isCurrentVersion
                ? input.copy.version.current(thread.targetVersion)
                : input.copy.version.history(thread.targetVersion),
            ...actionState,
        };
    });

    const current = items
        .filter((item) => item.isCurrentVersion)
        .sort(compareByUpdatedDesc);
    const history = items
        .filter((item) => !item.isCurrentVersion)
        .sort(compareByUpdatedDesc);
    const mine = items
        .filter((item) => item.isMine)
        .sort(compareMine);
    const toHandle = current
        .filter((item) => (
            item.primaryAction === 'propose'
            || item.primaryAction === 'resolve'
            || item.primaryAction === 'apply'
            || item.primaryAction === 'goToParagraph'
        ))
        .sort(compareByUpdatedDesc);

    return {
        toHandle,
        mine,
        current,
        history,
        currentVersion,
        currentVersionUnavailableReason: currentVersion === null
            ? input.currentVersionUnavailableReason || input.copy.currentVersionUnavailable
            : null,
        counts: {
            toHandle: toHandle.length,
            mine: mine.length,
            allCurrent: current.length,
            allHistory: history.length,
        },
    };
}
