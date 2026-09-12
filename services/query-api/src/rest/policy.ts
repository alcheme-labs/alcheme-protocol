import { Router } from 'express';
import { createHash } from 'node:crypto';
import type { PrismaClient } from '@prisma/client';
import type { Redis } from 'ioredis';
import { verifyEd25519SignatureBase64 } from '../services/offchainDiscussion';
import {
    resolveCirclePolicyProfile,
    serializeCirclePolicyProfile,
} from '../services/policy/profile';
import { requireCircleManagerActor } from '../services/auth/actor';
import { sendAuthActorError } from '../services/auth/actorPermissions';
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
    isCircleSettingsSignatureFresh,
    parseCircleSettingsSignedMessage,
} from '../services/policy/settingsEnvelope';
import {
    CIRCLE_POLICY_DRAFT_LIFECYCLE_UPDATE_ACTION_TYPE,
    CIRCLE_POLICY_PROFILE_UPDATE_ACTION_TYPE,
    evaluateCirclePolicyGovernance,
    executeCirclePolicyDirectOperation,
} from '../services/governance/circlePolicyGovernance';
import { applyCirclePolicyProfileSetting } from '../services/policy/postCreateSettings';
import {
    CircleDraftPromptError,
    activateApprovedCircleDraftPromptVersion,
    createAndActivateCircleDraftPromptVersion,
    listCircleDraftPromptSettings,
    parseCircleDraftPromptScope,
    readIdempotentCircleDraftPromptUpdate,
    restoreSystemDefaultCircleDraftPrompt,
} from '../services/policy/circleDraftPrompt';
import { resolveActiveCircleGovernanceBinding } from '../services/governance/circleGovernanceBindings';

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
        const actor = await requireCircleManagerActor(req, prisma as any, {
            circleId,
            requireSessionCookie: true,
        }).catch((error) => {
            if (sendAuthActorError(res, error)) return null;
            throw error;
        });
        if (!actor) return;
        if (actorPubkey !== actor.pubkey) {
            return res.status(403).json({ error: 'actor_pubkey_mismatch' });
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
        const actorUserId = actor.userId;

        const governancePayload = {
            ...(lifecyclePatch ? { draftLifecycleTemplate: lifecyclePatch } : {}),
            ...(workflowPatch ? { draftWorkflowPolicy: workflowPatch } : {}),
            settingKind: 'policy_profile',
            executionDomain: 'off_chain',
            chainStatus: 'not_required',
        };
        const actionType = lifecyclePatch && !workflowPatch
            ? CIRCLE_POLICY_DRAFT_LIFECYCLE_UPDATE_ACTION_TYPE
            : CIRCLE_POLICY_PROFILE_UPDATE_ACTION_TYPE;
        const governance = await evaluateCirclePolicyGovernance(prisma, {
            circleId,
            actionType,
            actorPubkey,
            directAllowed: Boolean(lifecyclePatch && !workflowPatch),
            payload: governancePayload,
        });
        if (governance.status === 'requires_governance') {
            return res.status(202).json(governance);
        }
        if (governance.status === 'denied') {
            return res.status(403).json({ error: governance.error });
        }

        try {
            const operation = await executeCirclePolicyDirectOperation(prisma, {
                circleId,
                actionType,
                actorPubkey,
                payload: governancePayload,
                reasonCode: lifecyclePatch && !workflowPatch
                    ? 'circle_manager_wallet_signed_draft_lifecycle_update'
                    : 'circle_manager_wallet_signed_policy_profile_update',
                idempotencyKey: `${actionType}:${circleId}:${signedPayload.nonce}`,
                execute: async (client) => {
                    const profile = await applyCirclePolicyProfileSetting(client, {
                        circleId,
                        actorUserId,
                        actorPubkey,
                        lifecyclePatch,
                        workflowPatch,
                        audit: {
                            signedMessage,
                            signature,
                            clientTimestamp: signedPayload.clientTimestamp,
                            nonce: signedPayload.nonce,
                            anchor: signedPayload.anchor ?? null,
                        },
                    });
                    return {
                        result: serializeCirclePolicyProfile(profile),
                        executionRef: `circle:${circleId}:policy-profile`,
                    };
                },
                readback: async (client) => serializeCirclePolicyProfile(
                    await resolveCirclePolicyProfile(client, circleId),
                ),
            });
            return res.json({
                ok: true,
                circleId,
                profile: operation.result,
                operationReceipt: operation.receipt,
            });
        } catch (error) {
            return res.status(normalizeErrorStatus(error)).json({
                error: normalizeErrorCode(error),
                message: normalizeErrorMessage(error),
            });
        }
    });

    // GET /api/v1/policy/circles/:id/draft-prompts
    router.get('/circles/:id/draft-prompts', async (req, res) => {
        const circleId = parseCircleId(req.params.id);
        if (!circleId) {
            return res.status(400).json({ error: 'invalid_circle_id' });
        }
        const actor = await requireCircleManagerActor(req, prisma as any, {
            circleId,
            requireSessionCookie: true,
        }).catch((error) => {
            if (sendAuthActorError(res, error)) return null;
            throw error;
        });
        if (!actor) return;
        try {
            return res.json({
                circleId,
                scopes: await listCircleDraftPromptSettings(prisma, circleId, {
                    actorUserId: actor.userId,
                    actorPubkey: actor.pubkey,
                    purpose: 'settings_preview',
                }),
            });
        } catch (error) {
            if (error instanceof CircleDraftPromptError) {
                return res.status(error.statusCode).json({ error: error.code });
            }
            return res.status(500).json({ error: 'circle_draft_prompt_readback_unavailable' });
        }
    });

    // PUT /api/v1/policy/circles/:id/draft-prompts/:scope
    router.put('/circles/:id/draft-prompts/:scope', async (req, res) => {
        const circleId = parseCircleId(req.params.id);
        const scope = parseCircleDraftPromptScope(req.params.scope);
        if (!circleId) return res.status(400).json({ error: 'invalid_circle_id' });
        if (!scope) return res.status(400).json({ error: 'circle_draft_prompt_scope_invalid' });

        const mode = String((req.body as any)?.mode || '').trim().toLowerCase();
        const promptBody = typeof (req.body as any)?.promptBody === 'string'
            ? (req.body as any).promptBody
            : undefined;
        const version = (req.body as any)?.version === null
            ? null
            : parsePositiveInteger((req.body as any)?.version);
        const promptDigest = (req.body as any)?.promptDigest === null
            ? null
            : typeof (req.body as any)?.promptDigest === 'string'
                ? (req.body as any).promptDigest.trim().toLowerCase()
                : null;
        const schemaRef = typeof (req.body as any)?.schemaRef === 'string'
            ? (req.body as any).schemaRef.trim()
            : '';
        const systemPromptVersion = typeof (req.body as any)?.systemPromptVersion === 'string'
            ? (req.body as any).systemPromptVersion.trim()
            : '';
        if (mode !== 'system_default' && mode !== 'circle_custom') {
            return res.status(400).json({ error: 'circle_draft_prompt_mode_invalid' });
        }
        if (mode === 'system_default' && promptBody !== undefined) {
            return res.status(400).json({ error: 'circle_draft_prompt_body_not_allowed' });
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
        const actor = await requireCircleManagerActor(req, prisma as any, {
            circleId,
            requireSessionCookie: true,
        }).catch((error) => {
            if (sendAuthActorError(res, error)) return null;
            throw error;
        });
        if (!actor) return;
        if (actor.pubkey !== actorPubkey) {
            return res.status(403).json({ error: 'actor_pubkey_mismatch' });
        }
        if (
            signedPayload.circleId !== circleId
            || signedPayload.actorPubkey !== actorPubkey
            || signedPayload.settingKind !== 'draft_prompt'
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

        let expectedPayload;
        try {
            expectedPayload = buildCircleSettingsSigningPayload({
                circleId,
                actorPubkey,
                settingKind: 'draft_prompt',
                payload: {
                    scope,
                    mode,
                    version,
                    promptDigest,
                    schemaRef,
                    systemPromptVersion,
                    ...(mode === 'circle_custom' && promptBody !== undefined ? { promptBody } : {}),
                },
                clientTimestamp: signedPayload.clientTimestamp,
                nonce: signedPayload.nonce,
                anchor: signedPayload.anchor ?? null,
            });
        } catch {
            return res.status(400).json({ error: 'circle_draft_prompt_payload_invalid' });
        }
        if (buildCircleSettingsSigningMessage(expectedPayload) !== signedMessage) {
            return res.status(400).json({ error: 'circle_settings_signature_payload_mismatch' });
        }
        if (!isCircleSettingsSignatureFresh({
            clientTimestamp: signedPayload.clientTimestamp,
            windowMs: Number(process.env.CIRCLE_SETTINGS_SIGNATURE_WINDOW_MS || '300000'),
        })) {
            return res.status(401).json({ error: 'circle_settings_signature_expired' });
        }
        const approvalRef = `settings:${createHash('sha256').update(signedMessage).digest('hex')}`;
        const nonceKey = `circle_settings:draft_prompt:${circleId}:${actorPubkey}:${signedPayload.nonce}`;
        if (typeof (redis as any)?.set !== 'function') {
            return res.status(503).json({ error: 'circle_settings_nonce_store_unavailable' });
        }
        let nonceStored;
        try {
            nonceStored = await (redis as any).set(
                nonceKey,
                '1',
                'EX',
                Math.max(60, Number(process.env.CIRCLE_SETTINGS_NONCE_TTL_SEC || '600')),
                'NX',
            );
        } catch {
            return res.status(503).json({ error: 'circle_settings_nonce_store_unavailable' });
        }
        if (nonceStored !== 'OK') {
            const prompt = await readIdempotentCircleDraftPromptUpdate(prisma as any, {
                circleId,
                scope,
                mode,
                version,
                promptDigest,
                schemaRef,
                systemPromptVersion,
                approvalRef,
                access: {
                    actorUserId: actor.userId,
                    actorPubkey,
                    purpose: 'idempotent_readback',
                },
            }).catch(() => null);
            if (prompt) {
                return res.json({ ok: true, idempotent: true, circleId, prompt });
            }
            return res.status(409).json({ error: 'circle_settings_replay_detected' });
        }

        try {
            const binding = await resolveActiveCircleGovernanceBinding(prisma as any, {
                targetCircleId: circleId,
                actionType: 'circle.draft_prompt.update',
                subjectType: 'circle',
                subjectRef: String(circleId),
            });
            if (binding) {
                return res.status(409).json({ error: 'governed_prompt_update_not_connected' });
            }
        } catch {
            return res.status(409).json({ error: 'governed_prompt_update_not_connected' });
        }

        try {
            const prompt = mode === 'circle_custom' && promptBody !== undefined
                ? await createAndActivateCircleDraftPromptVersion(prisma, {
                    circleId,
                    scope,
                    promptBody,
                    approvedByUserId: actor.userId,
                    approvedByPubkey: actorPubkey,
                    approvalRef,
                    expectedVersion: version!,
                    expectedPromptDigest: promptDigest!,
                    expectedSchemaRef: schemaRef,
                    expectedSystemPromptVersion: systemPromptVersion,
                })
                : mode === 'circle_custom'
                    ? await activateApprovedCircleDraftPromptVersion(prisma, {
                        circleId,
                        scope,
                        version: version!,
                        promptDigest: promptDigest!,
                        selectedByUserId: actor.userId,
                        selectedByPubkey: actorPubkey,
                        selectionApprovalRef: approvalRef,
                        expectedSchemaRef: schemaRef,
                        expectedSystemPromptVersion: systemPromptVersion,
                    })
                : await restoreSystemDefaultCircleDraftPrompt(prisma, {
                    circleId,
                    scope,
                    selectedByUserId: actor.userId,
                    selectedByPubkey: actorPubkey,
                    selectionApprovalRef: approvalRef,
                    expectedActiveVersion: version!,
                    expectedActivePromptDigest: promptDigest!,
                    expectedSchemaRef: schemaRef,
                    expectedSystemPromptVersion: systemPromptVersion,
                });
            return res.json({ ok: true, circleId, prompt });
        } catch (error) {
            if (error instanceof CircleDraftPromptError) {
                return res.status(error.statusCode).json({ error: error.code });
            }
            return res.status(500).json({ error: 'circle_draft_prompt_update_failed' });
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
