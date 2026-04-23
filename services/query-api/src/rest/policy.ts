import { Router } from 'express';
import type { PrismaClient } from '@prisma/client';
import type { Redis } from 'ioredis';
import { verifyEd25519SignatureBase64 } from '../services/offchainDiscussion';
import {
    resolveCirclePolicyProfile,
    upsertCircleDraftLifecycleTemplate,
    upsertCircleDraftWorkflowPolicy,
} from '../services/policy/profile';
import { reconcileActiveDraftWorkflowStates } from '../services/draftLifecycle/workflowState';
import { requireCircleManagerRole } from '../services/membership/checks';
import type {
    DraftLifecycleTemplatePatch,
    DraftReviewEntryMode,
    DraftWorkflowPolicyPatch,
    GovernanceRole,
} from '../services/policy/types';
import {
    resolveCandidateGenerationGovernanceReadModel,
    resolveCrystallizationGovernanceReadModel,
    resolveForkBaselineResolvedView,
    resolveForkThresholdResolvedView,
    resolveInheritanceResolvedView,
    resolveTeam04ForkResolvedInputs,
} from '../services/governance/read-models';
import {
    buildCircleSettingsSigningMessage,
    buildCircleSettingsSigningPayload,
    buildStoredCircleSettingsEnvelopeSection,
    isCircleSettingsSignatureFresh,
    parseCircleSettingsSignedMessage,
    persistCircleSettingsEnvelopeSection,
    resolveCircleSettingsActorUserId,
} from '../services/policy/settingsEnvelope';

function parseCircleId(raw: string): number | null {
    const parsed = Number(raw);
    if (!Number.isFinite(parsed) || parsed <= 0) return null;
    return parsed;
}

function parseOptionalDraftPostId(raw: unknown): number | null {
    if (raw === null || raw === undefined || raw === '') return null;
    const parsed = Number(raw);
    if (!Number.isFinite(parsed) || parsed <= 0) return null;
    return parsed;
}

function normalizeErrorStatus(error: unknown): number {
    const message = error instanceof Error ? error.message : String(error ?? '');
    if (message.includes('circle_not_found')) return 404;
    return 500;
}

function normalizeErrorCode(error: unknown): string {
    const message = error instanceof Error ? error.message : String(error ?? '');
    if (message.includes('circle_not_found')) return 'circle_not_found';
    return 'policy_read_model_unavailable';
}

function normalizeErrorMessage(error: unknown): string {
    const message = error instanceof Error ? error.message : String(error ?? '');
    if (message.includes('circle_not_found')) return 'circle not found';
    return message || 'policy read model unavailable';
}

function parsePositiveInteger(value: unknown): number | null {
    if (typeof value === 'number' && Number.isFinite(value)) {
        return Math.floor(value) > 0 ? Math.floor(value) : null;
    }
    if (typeof value === 'string' && value.trim()) {
        const parsed = Number(value);
        if (Number.isFinite(parsed) && parsed > 0) {
            return Math.floor(parsed);
        }
    }
    return null;
}

function parseReviewEntryMode(value: unknown): DraftReviewEntryMode | null {
    const normalized = String(value || '').trim().toLowerCase();
    if (normalized === 'auto_only') return 'auto_only';
    if (normalized === 'manual_only') return 'manual_only';
    if (normalized === 'auto_or_manual') return 'auto_or_manual';
    return null;
}

function parseGovernanceRole(value: unknown): GovernanceRole | null {
    const normalized = String(value || '').trim();
    if (
        normalized === 'Owner'
        || normalized === 'Admin'
        || normalized === 'Moderator'
        || normalized === 'Member'
        || normalized === 'Elder'
        || normalized === 'Initiate'
    ) {
        return normalized;
    }
    return null;
}

function parseDraftLifecycleTemplatePatch(raw: unknown): DraftLifecycleTemplatePatch | null {
    if (!raw || typeof raw !== 'object') return null;
    const value = raw as Record<string, unknown>;
    const reviewEntryMode = parseReviewEntryMode(value.reviewEntryMode);
    const draftingWindowMinutes = parsePositiveInteger(value.draftingWindowMinutes);
    const reviewWindowMinutes = parsePositiveInteger(value.reviewWindowMinutes);
    const maxRevisionRounds = parsePositiveInteger(value.maxRevisionRounds);

    if (!reviewEntryMode || !draftingWindowMinutes || !reviewWindowMinutes || !maxRevisionRounds) {
        return null;
    }

    return {
        reviewEntryMode,
        draftingWindowMinutes,
        reviewWindowMinutes,
        maxRevisionRounds,
    };
}

function parseDraftWorkflowPolicyPatch(raw: unknown): DraftWorkflowPolicyPatch | null {
    if (!raw || typeof raw !== 'object') return null;
    const value = raw as Record<string, unknown>;

    const patch: DraftWorkflowPolicyPatch = {};
    type DraftWorkflowRoleField =
        | 'createIssueMinRole'
        | 'followupIssueMinRole'
        | 'reviewIssueMinRole'
        | 'retagIssueMinRole'
        | 'applyIssueMinRole'
        | 'manualEndDraftingMinRole'
        | 'advanceFromReviewMinRole'
        | 'enterCrystallizationMinRole'
    ;
    const roleFields: DraftWorkflowRoleField[] = [
        'createIssueMinRole',
        'followupIssueMinRole',
        'reviewIssueMinRole',
        'retagIssueMinRole',
        'applyIssueMinRole',
        'manualEndDraftingMinRole',
        'advanceFromReviewMinRole',
        'enterCrystallizationMinRole',
    ];

    for (const field of roleFields) {
        if (!(field in value)) continue;
        const parsed = parseGovernanceRole(value[field]);
        if (!parsed) return null;
        patch[field] = parsed;
    }

    if ('allowAuthorWithdrawBeforeReview' in value) {
        if (typeof value.allowAuthorWithdrawBeforeReview !== 'boolean') return null;
        patch.allowAuthorWithdrawBeforeReview = value.allowAuthorWithdrawBeforeReview;
    }
    if ('allowModeratorRetagIssue' in value) {
        if (typeof value.allowModeratorRetagIssue !== 'boolean') return null;
        patch.allowModeratorRetagIssue = value.allowModeratorRetagIssue;
    }

    return Object.keys(patch).length > 0 ? patch : null;
}

export function policyRouter(prisma: PrismaClient, redis: Redis): Router {
    const router = Router();

    // GET /api/v1/policy/circles/:id/profile
    router.get('/circles/:id/profile', async (req, res) => {
        const circleId = parseCircleId(req.params.id);
        if (!circleId) {
            return res.status(400).json({ error: 'invalid_circle_id' });
        }

        try {
            const profile = await resolveCirclePolicyProfile(prisma, circleId);
            return res.json({
                circleId,
                profile,
            });
        } catch (error) {
            return res.status(normalizeErrorStatus(error)).json({
                error: normalizeErrorCode(error),
                message: normalizeErrorMessage(error),
            });
        }
    });

    // PUT /api/v1/policy/circles/:id/profile
    router.put('/circles/:id/profile', async (req, res) => {
        const circleId = parseCircleId(req.params.id);
        if (!circleId) {
            return res.status(400).json({ error: 'invalid_circle_id' });
        }

        const lifecyclePatch = parseDraftLifecycleTemplatePatch((req.body as any)?.draftLifecycleTemplate);
        const workflowPatch = parseDraftWorkflowPolicyPatch((req.body as any)?.draftWorkflowPolicy);
        if (!lifecyclePatch && !workflowPatch) {
            return res.status(400).json({ error: 'invalid_circle_policy_patch' });
        }

        const actorPubkey = typeof (req.body as any)?.actorPubkey === 'string'
            ? (req.body as any).actorPubkey.trim()
            : '';
        const signedMessage = typeof (req.body as any)?.signedMessage === 'string'
            ? (req.body as any).signedMessage
            : '';
        const signature = typeof (req.body as any)?.signature === 'string'
            ? (req.body as any).signature
            : '';
        const signedPayload = parseCircleSettingsSignedMessage(signedMessage);
        if (!actorPubkey || !signedMessage || !signature || !signedPayload) {
            return res.status(401).json({ error: 'circle_settings_auth_required' });
        }
        if (
            signedPayload.circleId !== circleId
            || signedPayload.actorPubkey !== actorPubkey
            || signedPayload.settingKind !== 'policy_profile'
        ) {
            return res.status(400).json({ error: 'circle_settings_signature_payload_mismatch' });
        }
        if (!verifyEd25519SignatureBase64({
            senderPubkey: actorPubkey,
            message: signedMessage,
            signatureBase64: signature,
        })) {
            return res.status(401).json({ error: 'invalid_circle_settings_signature' });
        }
        const expectedPayload = buildCircleSettingsSigningPayload({
            circleId,
            actorPubkey,
            settingKind: 'policy_profile',
            payload: {
                ...(lifecyclePatch ? { draftLifecycleTemplate: lifecyclePatch } : {}),
                ...(workflowPatch ? { draftWorkflowPolicy: workflowPatch } : {}),
            },
            clientTimestamp: signedPayload.clientTimestamp,
            nonce: signedPayload.nonce,
            anchor: signedPayload.anchor ?? null,
        });
        if (buildCircleSettingsSigningMessage(expectedPayload) !== signedMessage) {
            return res.status(400).json({ error: 'circle_settings_signature_payload_mismatch' });
        }
        if (!isCircleSettingsSignatureFresh({
            clientTimestamp: signedPayload.clientTimestamp,
            windowMs: Number(process.env.CIRCLE_SETTINGS_SIGNATURE_WINDOW_MS || '300000'),
        })) {
            return res.status(401).json({ error: 'circle_settings_signature_expired' });
        }
        const nonceKey = `circle_settings:policy_profile:${circleId}:${actorPubkey}:${signedPayload.nonce}`;
        const nonceStored = typeof (redis as any)?.set === 'function'
            ? await (redis as any).set(
                nonceKey,
                '1',
                'EX',
                Math.max(60, Number(process.env.CIRCLE_SETTINGS_NONCE_TTL_SEC || '600')),
                'NX',
            )
            : 'OK';
        if (nonceStored !== 'OK') {
            return res.status(409).json({ error: 'circle_settings_replay_detected' });
        }
        const actorUserId = await resolveCircleSettingsActorUserId(prisma, circleId, actorPubkey);
        if (!actorUserId) {
            return res.status(403).json({ error: 'forbidden_circle_policy_update' });
        }

        const canManage = await requireCircleManagerRole(prisma, {
            circleId,
            userId: actorUserId,
            allowModerator: false,
        });
        if (!canManage) {
            return res.status(403).json({
                error: 'forbidden_circle_policy_update',
                message: 'owner or admin circle permission is required to update circle policy',
            });
        }

        try {
            let profile = await resolveCirclePolicyProfile(prisma, circleId);
            if (lifecyclePatch) {
                profile = await upsertCircleDraftLifecycleTemplate(prisma, {
                    circleId,
                    actorUserId,
                    patch: lifecyclePatch,
                });
                await reconcileActiveDraftWorkflowStates(prisma, {
                    circleId,
                    template: profile.draftLifecycleTemplate,
                    now: new Date(),
                });
            }
            if (workflowPatch) {
                profile = await upsertCircleDraftWorkflowPolicy(prisma, {
                    circleId,
                    actorUserId,
                    patch: workflowPatch,
                });
            }
            await persistCircleSettingsEnvelopeSection(prisma, {
                circleId,
                actorUserId,
                section: buildStoredCircleSettingsEnvelopeSection({
                    settingKind: 'policy_profile',
                    payload: {
                        draftLifecycleTemplate: profile.draftLifecycleTemplate,
                        draftWorkflowPolicy: profile.draftWorkflowPolicy,
                        forkPolicy: profile.forkPolicy,
                    },
                    actorPubkey,
                    signedMessage,
                    signature,
                    clientTimestamp: signedPayload.clientTimestamp,
                    nonce: signedPayload.nonce,
                    anchor: signedPayload.anchor ?? null,
                }),
            });
            return res.json({
                ok: true,
                circleId,
                profile,
            });
        } catch (error) {
            return res.status(normalizeErrorStatus(error)).json({
                error: normalizeErrorCode(error),
                message: normalizeErrorMessage(error),
            });
        }
    });

    // GET /api/v1/policy/circles/:id/governance/candidate-generation?candidateId=...
    router.get('/circles/:id/governance/candidate-generation', async (req, res) => {
        const circleId = parseCircleId(req.params.id);
        if (!circleId) {
            return res.status(400).json({ error: 'invalid_circle_id' });
        }
        const candidateIdRaw = typeof req.query.candidateId === 'string'
            ? req.query.candidateId.trim()
            : '';
        const candidateId = candidateIdRaw || null;

        try {
            const readModel = await resolveCandidateGenerationGovernanceReadModel(prisma, {
                circleId,
                candidateId,
            });
            return res.json(readModel);
        } catch (error) {
            return res.status(normalizeErrorStatus(error)).json({
                error: normalizeErrorCode(error),
                message: normalizeErrorMessage(error),
            });
        }
    });

    // GET /api/v1/policy/circles/:id/governance/crystallization?draftPostId=...
    router.get('/circles/:id/governance/crystallization', async (req, res) => {
        const circleId = parseCircleId(req.params.id);
        if (!circleId) {
            return res.status(400).json({ error: 'invalid_circle_id' });
        }

        const draftPostId = parseOptionalDraftPostId(req.query.draftPostId);
        if (req.query.draftPostId !== undefined && draftPostId === null) {
            return res.status(400).json({ error: 'invalid_draft_post_id' });
        }

        try {
            const readModel = await resolveCrystallizationGovernanceReadModel(prisma, {
                circleId,
                draftPostId,
            });
            return res.json(readModel);
        } catch (error) {
            return res.status(normalizeErrorStatus(error)).json({
                error: normalizeErrorCode(error),
                message: normalizeErrorMessage(error),
            });
        }
    });

    // GET /api/v1/policy/circles/:id/fork/baseline
    router.get('/circles/:id/fork/baseline', async (req, res) => {
        const circleId = parseCircleId(req.params.id);
        if (!circleId) {
            return res.status(400).json({ error: 'invalid_circle_id' });
        }

        try {
            const readModel = await resolveForkBaselineResolvedView(prisma, circleId);
            return res.json(readModel);
        } catch (error) {
            return res.status(normalizeErrorStatus(error)).json({
                error: normalizeErrorCode(error),
                message: normalizeErrorMessage(error),
            });
        }
    });

    // GET /api/v1/policy/circles/:id/fork/threshold-resolved
    router.get('/circles/:id/fork/threshold-resolved', async (req, res) => {
        const circleId = parseCircleId(req.params.id);
        if (!circleId) {
            return res.status(400).json({ error: 'invalid_circle_id' });
        }

        try {
            const readModel = await resolveForkThresholdResolvedView(prisma, circleId);
            return res.json(readModel);
        } catch (error) {
            return res.status(normalizeErrorStatus(error)).json({
                error: normalizeErrorCode(error),
                message: normalizeErrorMessage(error),
            });
        }
    });

    // GET /api/v1/policy/circles/:id/fork/inheritance-resolved
    router.get('/circles/:id/fork/inheritance-resolved', async (req, res) => {
        const circleId = parseCircleId(req.params.id);
        if (!circleId) {
            return res.status(400).json({ error: 'invalid_circle_id' });
        }

        try {
            const readModel = await resolveInheritanceResolvedView(prisma, circleId);
            return res.json(readModel);
        } catch (error) {
            return res.status(normalizeErrorStatus(error)).json({
                error: normalizeErrorCode(error),
                message: normalizeErrorMessage(error),
            });
        }
    });

    // GET /api/v1/policy/circles/:id/fork/team04-inputs
    router.get('/circles/:id/fork/team04-inputs', async (req, res) => {
        const circleId = parseCircleId(req.params.id);
        if (!circleId) {
            return res.status(400).json({ error: 'invalid_circle_id' });
        }

        try {
            const readModel = await resolveTeam04ForkResolvedInputs(prisma, circleId);
            return res.json(readModel);
        } catch (error) {
            return res.status(normalizeErrorStatus(error)).json({
                error: normalizeErrorCode(error),
                message: normalizeErrorMessage(error),
            });
        }
    });

    return router;
}
