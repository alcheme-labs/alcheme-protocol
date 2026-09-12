import type { Prisma, PrismaClient } from '@prisma/client';

import type { AuthActor, CircleActor } from '../auth/actor';
import {
    authorizeDraftActionForActor,
    type DraftActorAccessDecision,
} from '../auth/actorPermissions';
import { updateDraftContentAndHeat } from '../heat/postHeat';
import {
    localizeDraftWorkflowPermissionDecision,
    resolveDraftWorkflowPermission,
} from '../policy/draftWorkflowPermissions';
import { localizeQueryApiCopy } from '../../i18n/copy';
import { DEFAULT_LOCALE, type AppLocale } from '../../i18n/locale';
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
    // Request callers must pass actor. authorizedJob is only for the AI job
    // handler's persisted auto-apply capability snapshot.
    actor?: AuthActor | null;
    authorizedJob?: GhostDraftAuthorizedJobCapability | null;
    mode: GhostDraftAcceptanceMode;
    locale?: AppLocale;
    workingCopyHash?: string | null;
    workingCopyUpdatedAt?: string | Date | null;
}

export interface GhostDraftAuthorizedJobCapability {
    draftPostId: number;
    userId: number;
    actorPubkey: string;
    autoApplyAuthorizedAt: string | Date;
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
        actor: CircleActor | null;
        locale: AppLocale;
    },
) {
    if (!Number.isFinite(Number(input.circleId)) || Number(input.circleId) <= 0 || !input.actor) {
        throw new GhostDraftAcceptanceError({
            statusCode: 422,
            code: 'ghost_draft_circle_context_required',
            message: localizeQueryApiCopy('ghostDraft.circleContextRequired', input.locale),
        });
    }

    const applyPermission = await resolveDraftWorkflowPermission(prisma as any, {
        circleId: Number(input.circleId),
        actor: input.actor,
        action: 'apply_accepted_issue',
    });
    if (!applyPermission.allowed) {
        throw new GhostDraftAcceptanceError({
            statusCode: 403,
            code: 'ghost_draft_apply_permission_denied',
            message: applyPermission.reasonCode
                ? localizeDraftWorkflowPermissionDecision(applyPermission, input.locale)
                : applyPermission.reason || localizeQueryApiCopy('ghostDraft.applyPermissionRequired', input.locale),
        });
    }

    const resolvePermission = await resolveDraftWorkflowPermission(prisma as any, {
        circleId: Number(input.circleId),
        actor: input.actor,
        action: 'accept_reject_issue',
    });
    if (!resolvePermission.allowed) {
        throw new GhostDraftAcceptanceError({
            statusCode: 403,
            code: 'ghost_draft_accept_permission_denied',
            message: resolvePermission.reasonCode
                ? localizeDraftWorkflowPermissionDecision(resolvePermission, input.locale)
                : resolvePermission.reason || localizeQueryApiCopy('ghostDraft.acceptPermissionRequired', input.locale),
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

function finitePositiveInteger(value: unknown): number | null {
    const parsed = Number(value);
    return Number.isInteger(parsed) && parsed > 0 ? parsed : null;
}

function buildAuthorizedJobAccess(input: {
    request: AcceptGhostDraftInput;
    capability: GhostDraftAuthorizedJobCapability;
}): { access: DraftActorAccessDecision; actorUserId: number } {
    if (input.request.mode !== 'auto_fill') {
        throw new GhostDraftAcceptanceError({
            statusCode: 403,
            code: 'ghost_draft_actor_required',
            message: 'request actor is required for manual ghost draft acceptance',
        });
    }
    const capabilityDraftPostId = finitePositiveInteger(input.capability.draftPostId);
    const capabilityUserId = finitePositiveInteger(input.capability.userId);
    const capabilityActorPubkey = String(input.capability.actorPubkey || '').trim();
    const authorizedAt = toDateOrNull(input.capability.autoApplyAuthorizedAt);
    if (
        capabilityDraftPostId !== input.request.draftPostId
        || !capabilityUserId
        || !capabilityActorPubkey
        || !authorizedAt
    ) {
        throw new GhostDraftAcceptanceError({
            statusCode: 409,
            code: 'ghost_draft_authorized_job_context_invalid',
            message: 'authorized ghost draft job context is invalid',
        });
    }

    return {
        actorUserId: capabilityUserId,
        access: {
            allowed: true,
            statusCode: 200,
            error: 'ok',
            message: 'ok',
            post: {
                id: input.request.draftPostId,
                circleId: null,
            } as any,
            circleActor: null,
        },
    };
}

async function authorizeGhostDraftAcceptance(
    prisma: PrismaLike,
    input: AcceptGhostDraftInput,
): Promise<{ access: DraftActorAccessDecision; actorUserId: number }> {
    if (input.actor) {
        const access = await authorizeDraftActionForActor(prisma as any, {
            actor: input.actor,
            postId: input.draftPostId,
            action: input.mode === 'accept_suggestion' ? 'read' : 'edit',
        });
        if (!access.allowed) {
            throw new GhostDraftAcceptanceError({
                statusCode: access.statusCode,
                code: access.error,
                message: access.message,
            });
        }
        return {
            access,
            actorUserId: input.actor.userId,
        };
    }

    if (input.authorizedJob) {
        return buildAuthorizedJobAccess({
            request: input,
            capability: input.authorizedJob,
        });
    }

    throw new GhostDraftAcceptanceError({
        statusCode: 401,
        code: 'ghost_draft_actor_required',
        message: 'authenticated actor is required',
    });
}

export async function acceptGhostDraftIntoWorkingCopy(
    prisma: PrismaLike,
    input: AcceptGhostDraftInput,
): Promise<GhostDraftAcceptanceView> {
    const locale = input.locale ?? DEFAULT_LOCALE;
    const { access, actorUserId } = await authorizeGhostDraftAcceptance(prisma, input);

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
            actor: access.circleActor,
            locale,
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
                actorUserId,
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
                    actorUserId,
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
                    acceptedByUserId: actorUserId,
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
            acceptedByUserId: actorUserId,
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
        acceptedByUserId: actorUserId,
        acceptedSuggestion: null,
        acceptedThreadIds: [],
        workingCopyContent: updatedText,
        workingCopyHash: sha256Hex(updatedText),
        updatedAt: updated.updatedAt,
        heatScore: Number(updated.heatScore ?? 0),
    };
}
