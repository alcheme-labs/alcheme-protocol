import type { Prisma, PrismaClient } from '@prisma/client';

import { authorizeDraftActionForActor } from '../auth/actorPermissions';
import {
    applyDraftDiscussionThread,
    listDraftDiscussionThreads,
    type DraftDiscussionThreadRecord,
} from '../draftDiscussionLifecycle';
import { updateDraftContentAndHeat } from '../heat/postHeat';
import {
    resolveDraftWorkflowPermission,
    localizeDraftWorkflowPermissionDecision,
} from '../policy/draftWorkflowPermissions';
import { DEFAULT_LOCALE } from '../../i18n/locale';
import {
    sha256Hex,
    toGhostDraftResultView,
    type GhostDraftAcceptanceView,
    type GhostDraftSuggestionView,
} from '../ghostDraft/readModel';
import { applyGhostDraftSuggestionToContent } from '../ghostDraft/suggestionPatches';
import type { AcceptedIssueRevisionApplyInput } from './types';

type PrismaLike = PrismaClient | Prisma.TransactionClient;

const ACCEPTED_ISSUE_REVISION_PROMPT_ASSET = 'accepted-issue-revision';
const ACCEPTED_ISSUE_REVISION_ACCEPTANCE_MODE = 'accepted_issue_revision_apply';

export class AcceptedIssueRevisionApplyError extends Error {
    statusCode: number;
    code: string;

    constructor(input: { statusCode: number; code: string; message: string }) {
        super(input.message);
        this.name = 'AcceptedIssueRevisionApplyError';
        this.statusCode = input.statusCode;
        this.code = input.code;
    }
}

function toDateOrNull(value: string | Date | null | undefined): Date | null {
    if (!value) return null;
    const parsed = value instanceof Date ? value : new Date(value);
    return Number.isNaN(parsed.getTime()) ? null : parsed;
}

function sameInstant(left: Date, right: Date | null): boolean {
    if (!right) return false;
    return left.getTime() === right.getTime();
}

function buildUnappliedResult(input: {
    generation: any;
    currentText: string;
    updatedAt: Date;
    heatScore: number | null | undefined;
}): GhostDraftAcceptanceView {
    return {
        generation: toGhostDraftResultView(input.generation),
        applied: false,
        changed: false,
        acceptanceId: null,
        acceptanceMode: null,
        acceptedAt: null,
        acceptedByUserId: null,
        acceptedSuggestion: null,
        acceptedThreadIds: [],
        workingCopyContent: input.currentText,
        workingCopyHash: sha256Hex(input.currentText),
        updatedAt: input.updatedAt,
        heatScore: Number(input.heatScore ?? 0),
    };
}

function buildApplicationEvidenceId(input: {
    generationId: number;
    suggestionId: string;
    resultingWorkingCopyHash: string;
}): string {
    return sha256Hex(JSON.stringify({
        kind: 'accepted_issue_revision_apply',
        generationId: input.generationId,
        suggestionId: input.suggestionId,
        resultingWorkingCopyHash: input.resultingWorkingCopyHash,
    }));
}

function normalizeSuggestionThreadId(value: string): number | null {
    const parsed = Number.parseInt(String(value || '').trim(), 10);
    return Number.isFinite(parsed) && parsed > 0 ? parsed : null;
}

function parseParagraphIndex(targetRef: string): number | null {
    const matched = String(targetRef || '').trim().match(/^paragraph:(\d+)$/i);
    if (!matched) return null;
    const parsed = Number.parseInt(matched[1], 10);
    return Number.isFinite(parsed) && parsed >= 0 ? parsed : null;
}

function countPatchParagraphs(content: string): number {
    return Array.from(String(content || '').matchAll(/[^\r\n]+/g))
        .filter((match) => match[0].trim().length > 0)
        .length;
}

function validateAcceptedThreads(input: {
    threads: DraftDiscussionThreadRecord[];
    suggestion: GhostDraftSuggestionView;
}): Array<{ threadId: string; targetVersion: number }> {
    const byId = new Map(input.threads.map((thread) => [thread.id, thread]));
    const result: Array<{ threadId: string; targetVersion: number }> = [];
    const seen = new Set<string>();

    for (const rawThreadId of input.suggestion.threadIds) {
        const parsed = normalizeSuggestionThreadId(rawThreadId);
        if (!parsed) continue;
        const threadId = String(parsed);
        if (seen.has(threadId)) continue;
        seen.add(threadId);

        const thread = byId.get(threadId);
        if (
            !thread
            || thread.state !== 'accepted'
            || Boolean(thread.latestApplication)
            || thread.targetType !== 'paragraph'
            || thread.targetRef !== input.suggestion.targetRef
        ) {
            throw new AcceptedIssueRevisionApplyError({
                statusCode: 409,
                code: 'accepted_issue_revision_thread_not_applicable',
                message: 'accepted issue revision can only apply accepted unapplied paragraph issues for the selected target',
            });
        }

        result.push({
            threadId,
            targetVersion: Number(thread.targetVersion || 1),
        });
    }

    if (result.length === 0) {
        throw new AcceptedIssueRevisionApplyError({
            statusCode: 422,
            code: 'accepted_issue_revision_threads_required',
            message: 'accepted issue revision suggestion must reference at least one accepted issue',
        });
    }
    return result;
}

async function ensureApplyPermission(
    prisma: PrismaLike,
    input: AcceptedIssueRevisionApplyInput,
) {
    const access = await authorizeDraftActionForActor(prisma as PrismaClient, {
        actor: input.actor,
        postId: input.draftPostId,
        action: 'edit',
    });
    if (!access.allowed) {
        throw new AcceptedIssueRevisionApplyError({
            statusCode: access.statusCode,
            code: access.error,
            message: access.message,
        });
    }
    if (!access.post?.circleId || !access.circleActor) {
        throw new AcceptedIssueRevisionApplyError({
            statusCode: 422,
            code: 'accepted_issue_revision_circle_context_required',
            message: 'Circle governance context is required for accepted issue revision.',
        });
    }

    const permission = await resolveDraftWorkflowPermission(prisma, {
        circleId: Number(access.post.circleId),
        actor: access.circleActor,
        action: 'apply_accepted_issue',
    });
    if (!permission.allowed) {
        throw new AcceptedIssueRevisionApplyError({
            statusCode: 403,
            code: 'accepted_issue_revision_apply_permission_denied',
            message: permission.reasonCode
                ? localizeDraftWorkflowPermissionDecision(permission, input.locale ?? DEFAULT_LOCALE)
                : permission.reason || 'Accepted issue application permission is required.',
        });
    }

    return {
        access,
        actorUserId: input.actor.userId,
    };
}

export async function applyAcceptedIssueRevision(
    prisma: PrismaLike,
    input: AcceptedIssueRevisionApplyInput,
): Promise<GhostDraftAcceptanceView> {
    const { actorUserId } = await ensureApplyPermission(prisma, input);
    const generation = await (prisma as any).ghostDraftGeneration.findUnique({
        where: { id: Number(input.generationId) },
    });
    if (!generation || Number(generation.draftPostId) !== Number(input.draftPostId)) {
        throw new AcceptedIssueRevisionApplyError({
            statusCode: 404,
            code: 'accepted_issue_revision_generation_not_found',
            message: 'accepted issue revision generation is not found',
        });
    }
    if (String(generation.promptAsset || '') !== ACCEPTED_ISSUE_REVISION_PROMPT_ASSET) {
        throw new AcceptedIssueRevisionApplyError({
            statusCode: 409,
            code: 'accepted_issue_revision_generation_kind_mismatch',
            message: 'generation is not an accepted issue revision',
        });
    }

    const generationView = toGhostDraftResultView(generation);
    const selectedSuggestion = generationView.suggestions.find(
        (suggestion) => suggestion.suggestionId === input.suggestionId,
    );
    if (!selectedSuggestion) {
        throw new AcceptedIssueRevisionApplyError({
            statusCode: 404,
            code: 'accepted_issue_revision_suggestion_not_found',
            message: 'accepted issue revision suggestion is not found',
        });
    }
    if (selectedSuggestion.targetType !== 'paragraph') {
        throw new AcceptedIssueRevisionApplyError({
            statusCode: 422,
            code: 'accepted_issue_revision_target_unsupported',
            message: 'accepted issue revision currently supports paragraph targets only',
        });
    }

    const current = await prisma.post.findUnique({
        where: { id: Number(input.draftPostId) },
        select: {
            id: true,
            status: true,
            text: true,
            updatedAt: true,
            heatScore: true,
        },
    });
    if (!current) {
        throw new Error('draft_not_found');
    }
    const currentText = String(current.text || '');
    const requestUpdatedAt = toDateOrNull(input.workingCopyUpdatedAt);
    const matchesHash = input.workingCopyHash
        ? input.workingCopyHash === sha256Hex(currentText)
        : true;
    const matchesUpdatedAt = requestUpdatedAt
        ? sameInstant(current.updatedAt, requestUpdatedAt)
        : true;
    if (!matchesHash || !matchesUpdatedAt) {
        return buildUnappliedResult({
            generation,
            currentText,
            updatedAt: current.updatedAt,
            heatScore: Number(current.heatScore ?? 0),
        });
    }

    const allThreads = await listDraftDiscussionThreads(prisma as PrismaClient, {
        draftPostId: Number(input.draftPostId),
        limit: 100,
    });
    const acceptedThreads = validateAcceptedThreads({
        threads: allThreads,
        suggestion: selectedSuggestion,
    });
    const paragraphIndex = parseParagraphIndex(selectedSuggestion.targetRef);
    if (paragraphIndex === null || paragraphIndex >= countPatchParagraphs(currentText)) {
        throw new AcceptedIssueRevisionApplyError({
            statusCode: 409,
            code: 'accepted_issue_revision_target_changed',
            message: 'accepted issue revision target paragraph no longer exists in the current working copy',
        });
    }
    const nextText = applyGhostDraftSuggestionToContent(currentText, selectedSuggestion);
    const executeWriteScope = typeof (prisma as any).$transaction === 'function'
        ? (work: (tx: PrismaLike) => Promise<GhostDraftAcceptanceView>) => (prisma as any).$transaction(work)
        : (work: (tx: PrismaLike) => Promise<GhostDraftAcceptanceView>) => work(prisma);

    return executeWriteScope(async (tx) => {
        const updated = await updateDraftContentAndHeat(tx, {
            postId: Number(input.draftPostId),
            text: nextText,
            precondition: {
                expectedText: currentText,
                expectedUpdatedAt: current.updatedAt,
            },
        });
        if (updated.preconditionFailed) {
            return buildUnappliedResult({
                generation,
                currentText: updated.currentText ?? currentText,
                updatedAt: updated.updatedAt,
                heatScore: Number(updated.heatScore ?? 0),
            });
        }

        const updatedText = String((updated.currentText ?? nextText) || '');
        const updatedWorkingCopyHash = sha256Hex(updatedText);
        const appliedEditAnchorId = buildApplicationEvidenceId({
            generationId: Number(generation.id),
            suggestionId: selectedSuggestion.suggestionId,
            resultingWorkingCopyHash: updatedWorkingCopyHash,
        });

        for (const thread of acceptedThreads) {
            await applyDraftDiscussionThread(tx as any, {
                draftPostId: Number(input.draftPostId),
                threadId: Number.parseInt(thread.threadId, 10),
                actorUserId,
                appliedEditAnchorId,
                appliedSnapshotHash: updatedWorkingCopyHash,
                appliedDraftVersion: thread.targetVersion,
                reason: selectedSuggestion.summary || `Applied accepted issue revision for ${selectedSuggestion.targetRef}.`,
            });
        }

        const acceptedThreadIds = acceptedThreads.map((thread) => thread.threadId);
        const acceptance = await (tx as any).ghostDraftAcceptance.create({
            data: {
                ghostDraftGenerationId: Number(generation.id),
                draftPostId: Number(input.draftPostId),
                acceptedByUserId: actorUserId,
                acceptanceMode: ACCEPTED_ISSUE_REVISION_ACCEPTANCE_MODE,
                acceptedSuggestionId: selectedSuggestion.suggestionId,
                acceptedThreadIds,
                requestWorkingCopyHash: input.workingCopyHash || sha256Hex(currentText),
                requestWorkingCopyUpdatedAt: toDateOrNull(input.workingCopyUpdatedAt),
                resultingWorkingCopyHash: updatedWorkingCopyHash,
                changed: Boolean(updated.changed),
            },
        });

        return {
            generation: generationView,
            applied: true,
            changed: Boolean(updated.changed),
            acceptanceId: Number(acceptance.id),
            acceptanceMode: String(acceptance.acceptanceMode || ACCEPTED_ISSUE_REVISION_ACCEPTANCE_MODE),
            acceptedAt: acceptance.acceptedAt instanceof Date
                ? acceptance.acceptedAt
                : new Date(acceptance.acceptedAt),
            acceptedByUserId: actorUserId,
            acceptedSuggestion: selectedSuggestion,
            acceptedThreadIds,
            workingCopyContent: updatedText,
            workingCopyHash: updatedWorkingCopyHash,
            updatedAt: updated.updatedAt,
            heatScore: Number(updated.heatScore ?? 0),
        };
    });
}
