import type { Prisma, PrismaClient } from '@prisma/client';

import { authorizeDraftAction } from '../membership/checks';
import { updateDraftContentAndHeat } from '../heat/postHeat';
import { resolveDraftWorkflowPermission } from '../policy/draftWorkflowPermissions';
import {
    applyDraftDiscussionThread,
    listDraftDiscussionThreads,
    proposeDraftDiscussionThread,
    resolveDraftDiscussionThread,
} from '../draftDiscussionLifecycle';
import {
    normalizeGhostDraftText,
    sha256Hex,
    toGhostDraftResultView,
    type GhostDraftAcceptanceView,
    type GhostDraftSuggestionView,
} from './readModel';
import { applyGhostDraftSuggestionToContent } from './suggestionPatches';

type PrismaLike = PrismaClient | Prisma.TransactionClient;

export type GhostDraftAcceptanceMode = 'auto_fill' | 'accept_replace' | 'accept_suggestion';

export class GhostDraftAcceptanceError extends Error {
    statusCode: number;
    code: string;

    constructor(input: { statusCode: number; code: string; message: string }) {
        super(input.message);
        this.name = 'GhostDraftAcceptanceError';
        this.statusCode = input.statusCode;
        this.code = input.code;
    }
}

export interface AcceptGhostDraftInput {
    draftPostId: number;
    generationId: number;
    suggestionId?: string | null;
    userId: number | null | undefined;
    mode: GhostDraftAcceptanceMode;
    workingCopyHash?: string | null;
    workingCopyUpdatedAt?: string | Date | null;
}

export function normalizeGhostDraftAcceptanceMode(value: unknown): GhostDraftAcceptanceMode | null {
    const normalized = String(value || '').trim().toLowerCase();
    if (normalized === 'auto_fill') return 'auto_fill';
    if (normalized === 'accept_replace') return 'accept_replace';
    if (normalized === 'accept_suggestion') return 'accept_suggestion';
    return null;
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

async function ensureSuggestionAcceptancePermission(
    prisma: PrismaLike,
    input: {
        circleId: number | null;
        userId: number;
    },
) {
    if (!Number.isFinite(Number(input.circleId)) || Number(input.circleId) <= 0) {
        throw new GhostDraftAcceptanceError({
            statusCode: 422,
            code: 'ghost_draft_circle_context_required',
            message: 'ghost draft suggestion acceptance requires a circle-bound draft',
        });
    }

    const applyPermission = await resolveDraftWorkflowPermission(prisma as any, {
        circleId: Number(input.circleId),
        userId: input.userId,
        action: 'apply_accepted_issue',
    });
    if (!applyPermission.allowed) {
        throw new GhostDraftAcceptanceError({
            statusCode: 403,
            code: 'ghost_draft_apply_permission_denied',
            message: applyPermission.reason || 'issue application permission is required',
        });
    }

    const resolvePermission = await resolveDraftWorkflowPermission(prisma as any, {
        circleId: Number(input.circleId),
        userId: input.userId,
        action: 'accept_reject_issue',
    });
    if (!resolvePermission.allowed) {
        throw new GhostDraftAcceptanceError({
            statusCode: 403,
            code: 'ghost_draft_accept_permission_denied',
            message: resolvePermission.reason || 'issue acceptance permission is required',
        });
    }
}

async function acceptLinkedIssueThreads(
    prisma: PrismaLike,
    input: {
        draftPostId: number;
        actorUserId: number;
        suggestion: GhostDraftSuggestionView;
    },
): Promise<Array<{ threadId: string; targetVersion: number }>> {
    const allThreads = await listDraftDiscussionThreads(prisma as any, {
        draftPostId: input.draftPostId,
        limit: 100,
    });
    const threadById = new Map(allThreads.map((thread) => [thread.id, thread]));
    const acceptedThreads: Array<{ threadId: string; targetVersion: number }> = [];
    const seenAcceptedThreadIds = new Set<string>();

    for (const threadId of input.suggestion.threadIds) {
        const normalizedThreadId = String(threadId || '').trim();
        if (!normalizedThreadId) continue;
        const parsedThreadId = Number.parseInt(normalizedThreadId, 10);
        if (!Number.isFinite(parsedThreadId) || parsedThreadId <= 0) continue;

        const existing = threadById.get(normalizedThreadId);
        if (!existing) continue;

        if (existing.state === 'open') {
            await proposeDraftDiscussionThread(prisma as any, {
                draftPostId: input.draftPostId,
                threadId: parsedThreadId,
                actorUserId: input.actorUserId,
                content: input.suggestion.summary || `Accepted from AI suggestion for ${input.suggestion.targetRef}.`,
            });
        }
        if (existing.state === 'open' || existing.state === 'proposed') {
            await resolveDraftDiscussionThread(prisma as any, {
                draftPostId: input.draftPostId,
                threadId: parsedThreadId,
                actorUserId: input.actorUserId,
                resolution: 'accepted',
                reason: input.suggestion.summary || `Accepted from AI suggestion for ${input.suggestion.targetRef}.`,
            });
        }
        if (
            existing.state === 'open'
            || existing.state === 'proposed'
            || existing.state === 'accepted'
        ) {
            if (seenAcceptedThreadIds.has(normalizedThreadId)) continue;
            seenAcceptedThreadIds.add(normalizedThreadId);
            acceptedThreads.push({
                threadId: normalizedThreadId,
                targetVersion: Number(existing.targetVersion || 1),
            });
        }
    }

    return acceptedThreads;
}

function buildGhostSuggestionApplicationEvidenceId(input: {
    generationId: number;
    suggestionId: string;
    resultingWorkingCopyHash: string;
}): string {
    return sha256Hex(JSON.stringify({
        generationId: input.generationId,
        suggestionId: input.suggestionId,
        resultingWorkingCopyHash: input.resultingWorkingCopyHash,
    }));
}

export async function acceptGhostDraftIntoWorkingCopy(
    prisma: PrismaLike,
    input: AcceptGhostDraftInput,
): Promise<GhostDraftAcceptanceView> {
    const access = await authorizeDraftAction(prisma as any, {
        postId: input.draftPostId,
        userId: input.userId,
        action: input.mode === 'accept_suggestion' ? 'read' : 'edit',
    });
    if (!access.allowed) {
        throw new GhostDraftAcceptanceError({
            statusCode: access.statusCode,
            code: access.error,
            message: access.message,
        });
    }

    const prismaAny = prisma as any;
    const generation = await prismaAny.ghostDraftGeneration.findUnique({
        where: { id: input.generationId },
    });
    if (!generation || Number(generation.draftPostId) !== input.draftPostId) {
        throw new GhostDraftAcceptanceError({
            statusCode: 404,
            code: 'ghost_draft_generation_not_found',
            message: 'ghost draft generation is not found',
        });
    }

    const current = await prisma.post.findUnique({
        where: { id: input.draftPostId },
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
    const generationView = toGhostDraftResultView(generation);
    const normalizedDraftText = normalizeGhostDraftText(String(generation.draftText || ''));
    const selectedSuggestion = input.suggestionId
        ? generationView.suggestions.find((suggestion) => suggestion.suggestionId === input.suggestionId)
        : null;
    if (input.mode === 'auto_fill') {
        const requestUpdatedAt = toDateOrNull(input.workingCopyUpdatedAt);
        const matchesHash = input.workingCopyHash
            ? input.workingCopyHash === sha256Hex(currentText)
            : false;
        const matchesUpdatedAt = sameInstant(current.updatedAt, requestUpdatedAt);
        const currentIsEmpty = currentText.trim().length === 0;
        if (!currentIsEmpty || !matchesHash || !matchesUpdatedAt) {
            return buildUnappliedResult({
                generation,
                currentText,
                updatedAt: current.updatedAt,
                heatScore: Number(current.heatScore ?? 0),
            });
        }
    }

    if (input.mode === 'accept_suggestion') {
        if (!selectedSuggestion) {
            throw new GhostDraftAcceptanceError({
                statusCode: 404,
                code: 'ghost_draft_suggestion_not_found',
                message: 'ghost draft suggestion is not found',
            });
        }
        await ensureSuggestionAcceptancePermission(prisma, {
            circleId: access.post?.circleId ?? null,
            userId: Number(input.userId),
        });

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
        const nextText = applyGhostDraftSuggestionToContent(currentText, selectedSuggestion);
        const executeWriteScope = typeof (prisma as any).$transaction === 'function'
            ? (work: (tx: PrismaLike) => Promise<GhostDraftAcceptanceView>) => (prisma as any).$transaction(work)
            : (work: (tx: PrismaLike) => Promise<GhostDraftAcceptanceView>) => work(prisma);

        return executeWriteScope(async (tx) => {
            const updated = await updateDraftContentAndHeat(tx, {
                postId: input.draftPostId,
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
            const acceptedThreads = await acceptLinkedIssueThreads(tx, {
                draftPostId: input.draftPostId,
                actorUserId: Number(input.userId),
                suggestion: selectedSuggestion,
            });
            const acceptedThreadIds = acceptedThreads.map((thread) => thread.threadId);
            const appliedEditAnchorId = buildGhostSuggestionApplicationEvidenceId({
                generationId: Number(generation.id),
                suggestionId: selectedSuggestion.suggestionId,
                resultingWorkingCopyHash: updatedWorkingCopyHash,
            });

            for (const thread of acceptedThreads) {
                await applyDraftDiscussionThread(tx as any, {
                    draftPostId: input.draftPostId,
                    threadId: Number.parseInt(thread.threadId, 10),
                    actorUserId: Number(input.userId),
                    appliedEditAnchorId,
                    appliedSnapshotHash: updatedWorkingCopyHash,
                    appliedDraftVersion: thread.targetVersion,
                    reason: selectedSuggestion.summary || `Applied from AI suggestion for ${selectedSuggestion.targetRef}.`,
                });
            }

            const acceptance = await (tx as any).ghostDraftAcceptance.create({
                data: {
                    ghostDraftGenerationId: Number(generation.id),
                    draftPostId: input.draftPostId,
                    acceptedByUserId: Number(input.userId),
                    acceptanceMode: input.mode,
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
                acceptanceMode: String(acceptance.acceptanceMode || input.mode),
                acceptedAt: acceptance.acceptedAt instanceof Date
                    ? acceptance.acceptedAt
                    : new Date(acceptance.acceptedAt),
                acceptedByUserId: Number(input.userId),
                acceptedSuggestion: selectedSuggestion,
                acceptedThreadIds,
                workingCopyContent: updatedText,
                workingCopyHash: updatedWorkingCopyHash,
                updatedAt: updated.updatedAt,
                heatScore: Number(updated.heatScore ?? 0),
            };
        });
    }

    const updated = await updateDraftContentAndHeat(prisma, {
        postId: input.draftPostId,
        text: normalizedDraftText,
        precondition: input.mode === 'auto_fill'
            ? {
                expectedText: currentText,
                expectedUpdatedAt: current.updatedAt,
            }
            : undefined,
    });
    if (input.mode === 'auto_fill' && updated.preconditionFailed) {
        return buildUnappliedResult({
            generation,
            currentText: updated.currentText ?? currentText,
            updatedAt: updated.updatedAt,
            heatScore: Number(updated.heatScore ?? 0),
        });
    }

    const updatedText = String((updated.currentText ?? normalizedDraftText) || '');
    const acceptance = await prismaAny.ghostDraftAcceptance.create({
        data: {
            ghostDraftGenerationId: Number(generation.id),
            draftPostId: input.draftPostId,
            acceptedByUserId: Number(input.userId),
            acceptanceMode: input.mode,
            requestWorkingCopyHash: input.workingCopyHash || null,
            requestWorkingCopyUpdatedAt: toDateOrNull(input.workingCopyUpdatedAt),
            resultingWorkingCopyHash: sha256Hex(updatedText),
            changed: Boolean(updated.changed),
        },
    });

    return {
        generation: generationView,
        applied: true,
        changed: Boolean(updated.changed),
        acceptanceId: Number(acceptance.id),
        acceptanceMode: String(acceptance.acceptanceMode || input.mode),
        acceptedAt: acceptance.acceptedAt instanceof Date
            ? acceptance.acceptedAt
            : new Date(acceptance.acceptedAt),
        acceptedByUserId: Number(input.userId),
        acceptedSuggestion: null,
        acceptedThreadIds: [],
        workingCopyContent: updatedText,
        workingCopyHash: sha256Hex(updatedText),
        updatedAt: updated.updatedAt,
        heatScore: Number(updated.heatScore ?? 0),
    };
}
