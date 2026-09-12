import { Router } from 'express';
import type { PrismaClient } from '@prisma/client';
import type { Redis } from 'ioredis';

import { requirePrivateSidecarSurface } from '../config/services';
import {
    authenticateDiscussionSessionFromRequest,
} from '../services/discussion/sessionAuth';
import {
    resolvePlazaDiscussionWriteAccess,
    PlazaDiscussionWriteAccessError,
} from '../services/discussion/writeAccess';
import {
    AnchoredInteractionInputError,
    appendAnchoredInteractionEvent,
    createAnchoredInteraction,
    listAnchoredInteractions,
    lookupAnchoredInteractions,
} from '../services/discussion/anchoredInteractions/store';
import {
    AnchoredInteractionEventValidationError,
    getAnchoredInteractionEventActionScope,
    getChallengeInteractionMode,
    validateAnchoredInteractionEventPayload,
    validateAnchoredInteractionInitialState,
} from '../services/discussion/anchoredInteractions/eventRegistry';
import {
    resolveAnchoredInteractionResultNotice,
} from '../services/discussion/anchoredInteractions/resultNotice';
import {
    readAnchoredInteractionDetail,
} from '../services/discussion/anchoredInteractions/detail';
import {
    AnchoredInteractionReceiptError,
    createSolanaRpcReceiptVerifierFromEnv,
    recordAnchoredInteractionReceipt,
} from '../services/discussion/anchoredInteractions/receipts';
import {
    canPerformAnchoredInteractionAction,
} from '../services/discussion/anchoredInteractions/permissions';
import {
    publishDiscussionRealtimeEvent,
} from '../services/discussion/realtime';
import { enqueueAiJob } from '../services/aiJobs/runtime';
import {
    normalizeAnchoredSuggestionLocale,
    normalizeEnvelopeIds,
    persistAnchoredSuggestionContext,
} from '../services/aiOperatingLayer/anchoredSuggestions/context';
import {
    buildAnchoredSuggestionDedupeKey,
    readAnchoredSuggestionDecisionsByContextCapsuleId,
    readAnchoredSuggestionDecisionsByDedupeKey,
} from '../services/aiOperatingLayer/anchoredSuggestions/readModel';
import { resolveExpressRequestLocale } from '../i18n/request';
import type {
    DiscussionAnchoredInteractionDto,
} from '../services/discussion/anchoredInteractions/types';
import {
    AuthActorError,
    requireCircleActor,
} from '../services/auth/actor';

export function discussionAnchoredInteractionsRouter(
    prisma: PrismaClient,
    redis: Redis,
): Router {
    const router = Router();

    router.post('/circles/:id/interactions/suggestion-decisions', async (req, res, next) => {
        try {
            const circleId = parsePositiveInt(req.params.id);
            if (!circleId) return res.status(400).json({ error: 'invalid_circle_id' });
            const gate = requirePrivateSidecarSurface('discussion_runtime');
            if (!gate.ok) {
                return res.status(gate.statusCode).json({
                    error: gate.error,
                    route: gate.route,
                });
            }
            const circleActor = await requireCircleActor(req, prisma, {
                circleId,
                action: 'circle.read',
                requireSessionCookie: true,
                requireMemberChainPresence: false,
            });
            const envelopeIds = normalizeEnvelopeIds(req.body?.envelopeIds);
            if (envelopeIds.length === 0) {
                return res.status(400).json({ error: 'anchored_suggestion_envelope_ids_required' });
            }
            const persisted = await persistAnchoredSuggestionContext({
                prisma: prisma as any,
                circleId,
                requestedByUserId: circleActor.userId,
                envelopeIds,
                locale: normalizeAnchoredSuggestionLocale(req.body?.locale ?? resolveExpressRequestLocale(req)),
            });
            if (persisted.empty) {
                return res.status(200).json({
                    ok: true,
                    circleId,
                    status: 'ready',
                    jobId: null,
                    sourceDigest: null,
                    decisions: [],
                    failureCode: null,
                });
            }
            const dedupeKey = buildAnchoredSuggestionDedupeKey({
                circleId,
                sourceDigest: persisted.sourceDigest,
                locale: persisted.payload.locale,
            });
            const existingView = await readAnchoredSuggestionDecisionsByContextCapsuleId(prisma as any, {
                circleId,
                contextCapsuleId: persisted.capsuleId,
            });
            if (existingView.status === 'ready' || existingView.status === 'queued' || existingView.status === 'running') {
                return res.status(existingView.status === 'ready' ? 200 : 202).json({
                    ok: true,
                    circleId,
                    status: existingView.status,
                    jobId: existingView.jobId,
                    sourceDigest: existingView.sourceDigest ?? persisted.sourceDigest,
                    decisions: existingView.decisions,
                    failureCode: existingView.failureCode,
                });
            }
            const job = await enqueueAiJob(prisma as any, {
                jobType: 'anchored_interaction_suggestion_judge',
                dedupeKey,
                scopeType: 'circle',
                scopeCircleId: circleId,
                requestedByUserId: circleActor.userId,
                contextCapsuleId: persisted.capsuleId,
                payload: {
                    circleId,
                    candidateEnvelopeIds: persisted.payload.candidateEnvelopeIds,
                    sourceDigest: persisted.sourceDigest,
                    locale: persisted.payload.locale,
                    candidateCount: persisted.payload.candidates.length,
                },
            });
            const view = await readAnchoredSuggestionDecisionsByDedupeKey(prisma as any, {
                circleId,
                dedupeKey,
            });
            return res.status(view.status === 'ready' ? 200 : 202).json({
                ok: true,
                circleId,
                status: view.status,
                jobId: view.jobId ?? job.id,
                sourceDigest: view.sourceDigest ?? persisted.sourceDigest,
                decisions: view.decisions,
                failureCode: view.failureCode,
            });
        } catch (error) {
            if (sendInteractionRouteError(res, error)) return;
            next(error);
        }
    });

    router.get('/circles/:id/interactions/lookup', async (req, res, next) => {
        try {
            const circleId = parsePositiveInt(req.params.id);
            if (!circleId) return res.status(400).json({ error: 'invalid_circle_id' });
            const interactionIds = parseDelimitedList(req.query.interactionIds);
            const response = await lookupAnchoredInteractions(prisma, {
                circleId,
                interactionIds,
                locale: resolveExpressRequestLocale(req),
            });
            res.json(response);
        } catch (error) {
            next(error);
        }
    });

    router.get('/circles/:id/interactions/:interactionId/detail', async (req, res, next) => {
        try {
            const circleId = parsePositiveInt(req.params.id);
            if (!circleId) return res.status(400).json({ error: 'invalid_circle_id' });
            const interactionId = normalizeRequiredString(req.params.interactionId);
            if (!interactionId) return res.status(400).json({ error: 'invalid_interaction_id' });
            const detail = await readAnchoredInteractionDetail(prisma, {
                circleId,
                interactionId,
                locale: resolveExpressRequestLocale(req),
            });
            if (!detail) return res.status(404).json({ error: 'anchored_interaction_not_found' });
            return res.json(detail);
        } catch (error) {
            next(error);
        }
    });

    router.get('/circles/:id/interactions', async (req, res, next) => {
        try {
            const circleId = parsePositiveInt(req.params.id);
            if (!circleId) return res.status(400).json({ error: 'invalid_circle_id' });
            const response = await listAnchoredInteractions(prisma, {
                circleId,
                afterProjectionCursor: parseNonNegativeInt(req.query.afterProjectionCursor),
                limit: parsePositiveInt(req.query.limit) ?? undefined,
                locale: resolveExpressRequestLocale(req),
            });
            res.json(response);
        } catch (error) {
            next(error);
        }
    });

    router.post('/circles/:id/interactions', async (req, res, next) => {
        try {
            const circleId = parsePositiveInt(req.params.id);
            if (!circleId) return res.status(400).json({ error: 'invalid_circle_id' });
            const circleActor = await requireCircleActor(req, prisma, {
                circleId,
                action: 'discussion.write',
                requireSessionCookie: true,
            });
            const bodySenderPubkey = normalizeActorPubkey(req.body);
            if (bodySenderPubkey && bodySenderPubkey !== circleActor.pubkey) {
                return res.status(403).json({ error: 'sender_pubkey_mismatch' });
            }
            const senderPubkey = circleActor.pubkey;
            const clientNonce = normalizeClientNonce(req.body?.clientNonce);
            if (!clientNonce) return res.status(400).json({ error: 'invalid_client_nonce' });
            if (String(req.body?.interactionType || '').trim().toLowerCase() === 'announcement') {
                return res.status(410).json({ error: 'legacy_announcement_creation_disabled' });
            }

            const auth = await authenticateInteractionActor(req, circleId, senderPubkey);
            if (!auth.ok) return res.status(auth.status).json({ error: auth.error, message: auth.message });
            await resolvePlazaDiscussionWriteAccess({
                prisma,
                circleId,
                circleActor,
                now: new Date(),
            });

            const interaction = await createAnchoredInteraction(prisma, {
                circleId,
                anchor: normalizeAnchor(req.body?.anchor),
                interactionType: req.body?.interactionType,
                createdByPubkey: senderPubkey,
                clientNonce,
                initialState: validateCreateInitialState(
                    req.body?.interactionType,
                    normalizeRecord(req.body?.initialState),
                ),
                initialSummary: normalizeRecord(req.body?.initialSummary),
                locale: resolveExpressRequestLocale(req),
            });
            await publishInteractionProjection(redis, interaction);
            return res.status(201).json({ ok: true, interaction });
        } catch (error) {
            if (sendInteractionRouteError(res, error)) return;
            next(error);
        }
    });

    router.post('/circles/:id/interactions/:interactionId/events', async (req, res, next) => {
        try {
            const circleId = parsePositiveInt(req.params.id);
            if (!circleId) return res.status(400).json({ error: 'invalid_circle_id' });
            const interactionId = normalizeRequiredString(req.params.interactionId);
            if (!interactionId) return res.status(400).json({ error: 'invalid_interaction_id' });
            const circleActor = await requireCircleActor(req, prisma, {
                circleId,
                action: 'discussion.write',
                requireSessionCookie: true,
            });
            const bodySenderPubkey = normalizeActorPubkey(req.body);
            if (bodySenderPubkey && bodySenderPubkey !== circleActor.pubkey) {
                return res.status(403).json({ error: 'sender_pubkey_mismatch' });
            }
            const senderPubkey = circleActor.pubkey;
            const eventKind = normalizeRequiredString(req.body?.eventKind);
            if (!eventKind) return res.status(400).json({ error: 'invalid_event_kind' });
            const clientNonce = normalizeClientNonce(req.body?.clientNonce);
            if (!clientNonce) return res.status(400).json({ error: 'invalid_client_nonce' });

            const auth = await authenticateInteractionActor(req, circleId, senderPubkey);
            if (!auth.ok) return res.status(auth.status).json({ error: auth.error, message: auth.message });
            const writeAccess = await resolvePlazaDiscussionWriteAccess({
                prisma,
                circleId,
                circleActor,
                now: new Date(),
            });

            const lookup = await lookupAnchoredInteractions(prisma, {
                circleId,
                interactionIds: [interactionId],
            });
            const currentInteraction = lookup.interactions[0];
            if (!currentInteraction) return res.status(404).json({ error: 'anchored_interaction_not_found' });
            let payload = validateAnchoredInteractionEventPayload(
                currentInteraction.interactionType,
                eventKind,
                normalizeRecord(req.body?.payload),
                currentInteraction.state,
            );
            const actionScope = getAnchoredInteractionEventActionScope(
                currentInteraction.interactionType,
                eventKind,
                currentInteraction.state,
            );
            if (actionScope === 'asset_recorder') {
                if (!canPerformAnchoredInteractionAction({
                    actionScope,
                    eventKind,
                    senderPubkey,
                    createdByPubkey: currentInteraction.createdByPubkey,
                    actorRole: writeAccess.membershipRole ?? null,
                })) {
                    return res.status(403).json({ error: 'anchored_interaction_forbidden' });
                }
                const receiptResult = await recordAnchoredInteractionReceipt(prisma, {
                    interaction: currentInteraction,
                    actorPubkey: senderPubkey,
                    eventKind,
                    payload,
                    verifier: createSolanaRpcReceiptVerifierFromEnv(),
                    locale: resolveExpressRequestLocale(req),
                });
                payload = receiptResult.eventPayload;
            } else if (!canPerformAnchoredInteractionAction({
                actionScope,
                eventKind,
                senderPubkey,
                createdByPubkey: currentInteraction.createdByPubkey,
                actorRole: writeAccess.membershipRole ?? null,
            })) {
                return res.status(403).json({ error: 'anchored_interaction_forbidden' });
            }

            const interaction = await appendAnchoredInteractionEvent(prisma, {
                circleId,
                interactionId,
                actorPubkey: senderPubkey,
                eventKind,
                payload,
                clientNonce,
                locale: resolveExpressRequestLocale(req),
            });
            await publishInteractionProjection(redis, interaction);
            return res.json({ ok: true, interaction });
        } catch (error) {
            if (sendInteractionRouteError(res, error)) return;
            next(error);
        }
    });

    router.post('/circles/:id/interactions/:interactionId/resolve', async (req, res, next) => {
        try {
            const circleId = parsePositiveInt(req.params.id);
            if (!circleId) return res.status(400).json({ error: 'invalid_circle_id' });
            const interactionId = normalizeRequiredString(req.params.interactionId);
            if (!interactionId) return res.status(400).json({ error: 'invalid_interaction_id' });
            const circleActor = await requireCircleActor(req, prisma, {
                circleId,
                action: 'discussion.write',
                requireSessionCookie: true,
            });
            const bodySenderPubkey = normalizeActorPubkey(req.body);
            if (bodySenderPubkey && bodySenderPubkey !== circleActor.pubkey) {
                return res.status(403).json({ error: 'sender_pubkey_mismatch' });
            }
            const senderPubkey = circleActor.pubkey;

            const auth = await authenticateInteractionActor(req, circleId, senderPubkey);
            if (!auth.ok) return res.status(auth.status).json({ error: auth.error, message: auth.message });
            const writeAccess = await resolvePlazaDiscussionWriteAccess({
                prisma,
                circleId,
                circleActor,
                now: new Date(),
            });

            const lookup = await lookupAnchoredInteractions(prisma, {
                circleId,
                interactionIds: [interactionId],
                locale: resolveExpressRequestLocale(req),
            });
            const interaction = lookup.interactions[0];
            if (!interaction) return res.status(404).json({ error: 'anchored_interaction_not_found' });
            const requiresCreatorScope = req.body?.explicitClose === true
                || requiresCreatorScopedResultResolution(interaction);
            if (requiresCreatorScope && !canPerformAnchoredInteractionAction({
                actionScope: 'creator',
                senderPubkey,
                createdByPubkey: interaction.createdByPubkey,
                actorRole: writeAccess.membershipRole ?? null,
            })) {
                return res.status(403).json({ error: 'anchored_interaction_forbidden' });
            }

            const resolved = await resolveAnchoredInteractionResultNotice({
                prisma,
                redis,
                interaction,
                explicitClose: req.body?.explicitClose === true,
                now: new Date(),
                policy: normalizeRecord(req.body?.policy),
            });

            if (resolved.projectionChanged) {
                await publishInteractionProjection(redis, resolved.interaction);
            }

            return res.json({
                ok: true,
                interaction: resolved.interaction,
                result: resolved.result,
                resultNoticeEnvelopeId: resolved.resultNoticeEnvelopeId,
                noticeEnvelopeId: resolved.resultNoticeEnvelopeId,
            });
        } catch (error) {
            if (sendInteractionRouteError(res, error)) return;
            next(error);
        }
    });

    async function authenticateInteractionActor(
        req: { headers?: Record<string, unknown> },
        circleId: number,
        senderPubkey: string,
    ) {
        return authenticateDiscussionSessionFromRequest({
            prisma,
            authorizationHeader: typeof req.headers?.authorization === 'string'
                ? req.headers.authorization
                : undefined,
            circleId,
            actorPubkey: senderPubkey,
        });
    }

    return router;
}

function requiresCreatorScopedResultResolution(
    interaction: DiscussionAnchoredInteractionDto,
): boolean {
    if (interaction.interactionType === 'challenge') {
        return getChallengeInteractionMode(interaction.state) !== 'credibility_vote';
    }
    return interaction.interactionType === 'bounty';
}

async function publishInteractionProjection(
    redis: Redis,
    interaction: DiscussionAnchoredInteractionDto,
): Promise<void> {
    await publishDiscussionRealtimeEvent(redis, {
        circleId: interaction.circleId,
        reason: 'interaction_projection_changed',
        interactionId: interaction.interactionId,
        projectionVersion: interaction.projectionVersion,
        projectionCursor: interaction.projectionCursor,
        interaction,
    });
}

function sendInteractionRouteError(
    res: { status: (code: number) => { json: (payload: unknown) => unknown } },
    error: unknown,
): boolean {
    if (error instanceof AnchoredInteractionInputError) {
        res.status(error.statusCode).json({ error: error.code });
        return true;
    }
    if (error instanceof AnchoredInteractionEventValidationError) {
        res.status(error.statusCode).json({ error: error.code });
        return true;
    }
    if (error instanceof AnchoredInteractionReceiptError) {
        res.status(error.statusCode).json({ error: error.code });
        return true;
    }
    if (error instanceof PlazaDiscussionWriteAccessError) {
        res.status(error.statusCode).json({ error: error.code, message: error.message });
        return true;
    }
    if (error instanceof AuthActorError) {
        res.status(error.statusCode).json(error.toResponseBody());
        return true;
    }
    return false;
}

function validateCreateInitialState(
    interactionType: unknown,
    initialState: Record<string, unknown>,
): Record<string, unknown> {
    const normalizedInteractionType = typeof interactionType === 'string' ? interactionType : '';
    if (
        Object.keys(initialState).length === 0
        && normalizedInteractionType !== 'challenge'
        && normalizedInteractionType !== 'tip'
        && normalizedInteractionType !== 'bounty'
    ) {
        return initialState;
    }
    try {
        return validateAnchoredInteractionInitialState(
            normalizedInteractionType,
            initialState,
        );
    } catch (error) {
        if (error instanceof AnchoredInteractionEventValidationError) {
            throw new AnchoredInteractionInputError('invalid_interaction_payload');
        }
        throw error;
    }
}

function parsePositiveInt(value: unknown): number | null {
    const parsed = typeof value === 'number'
        ? value
        : typeof value === 'string'
            ? Number.parseInt(value, 10)
            : NaN;
    return Number.isSafeInteger(parsed) && parsed > 0 ? parsed : null;
}

function parseNonNegativeInt(value: unknown): number | null {
    if (value === undefined) return null;
    const parsed = typeof value === 'number'
        ? value
        : typeof value === 'string'
            ? Number.parseInt(value, 10)
            : NaN;
    return Number.isSafeInteger(parsed) && parsed >= 0 ? parsed : null;
}

function parseDelimitedList(value: unknown): string[] {
    const raw = Array.isArray(value) ? value.join(',') : String(value || '');
    return raw.split(',').map((item) => item.trim()).filter(Boolean).slice(0, 100);
}

function normalizeActorPubkey(body: unknown): string | null {
    const record = normalizeRecord(body);
    const candidate = typeof record.senderPubkey === 'string'
        ? record.senderPubkey
        : typeof record.actorPubkey === 'string'
            ? record.actorPubkey
            : typeof record.createdByPubkey === 'string'
                ? record.createdByPubkey
                : '';
    return normalizeRequiredString(candidate);
}

function normalizeAnchor(value: unknown): { type: 'discussion_message' | 'freeform'; ref: string } {
    const record = normalizeRecord(value);
    const type = record.type === 'freeform' ? 'freeform' : 'discussion_message';
    const ref = normalizeRequiredString(record.ref);
    if (!ref) throw new AnchoredInteractionInputError('invalid_anchor_ref');
    return { type, ref };
}

function normalizeClientNonce(value: unknown): string | null {
    return normalizeRequiredString(value);
}

function normalizeRequiredString(value: unknown): string | null {
    return typeof value === 'string' && value.trim() ? value.trim() : null;
}

function normalizeRecord(value: unknown): Record<string, unknown> {
    return value && typeof value === 'object' && !Array.isArray(value)
        ? value as Record<string, unknown>
        : {};
}
