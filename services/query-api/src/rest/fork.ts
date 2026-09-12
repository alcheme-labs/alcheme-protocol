import { randomUUID } from 'node:crypto';
import { Router } from 'express';
import type { PrismaClient } from '@prisma/client';
import type { Redis } from 'ioredis';
import {
    requireAuthenticatedActor,
    requireCircleActorForAuthActor,
} from '../services/auth/actor';
import { sendAuthActorError } from '../services/auth/actorPermissions';
import { loadPrivateText } from '../services/privateContentBridge';
import { buildForkInheritanceSnapshot, loadForkLineageView } from '../services/fork/readModel';
import { buildForkContextCapsuleInput } from '../services/fork/contextSnapshot';
import { createPrismaForkContextStore } from '../services/fork/contextStore';
import {
    loadForkContextView,
    loadForkReferenceExpansionRecord,
} from '../services/fork/contextReadModel';
import { evaluateForkReferenceExpansion } from '../services/fork/sourceGateEvaluator';
import {
    createForkCircle,
    createPrismaForkRuntimeStore,
    resolveForkQualification,
} from '../services/fork/runtime';
import {
    CIRCLE_FORK_ACTION_TYPE,
    createGovernedActionRegistry,
} from '../services/governance/actionRegistry';
import { GovernedActionGateway } from '../services/governance/governedActionGateway';
import {
    listCommitteeEligibleActors,
    resolveActiveCircleGovernanceBinding,
} from '../services/governance/circleGovernanceBindings';
import { createPrismaGovernanceRequestStore } from '../services/governance/policyEngine';

function asPositiveInteger(value: unknown): number | null {
    const parsed = Number(value);
    return Number.isInteger(parsed) && parsed > 0 ? parsed : null;
}

function asOptionalString(value: unknown): string | null {
    if (typeof value !== 'string') return null;
    const normalized = value.trim();
    return normalized.length > 0 ? normalized : null;
}

function asRecord(value: unknown): Record<string, unknown> | null {
    if (typeof value === 'object' && value !== null && !Array.isArray(value)) {
        return value as Record<string, unknown>;
    }
    return null;
}

function forkGovernanceIdempotencyKey(sourceCircleId: number, declarationId: string): string {
    return `circle-fork:${sourceCircleId}:${declarationId}`;
}

function publicGovernanceRequest(request: any) {
    return {
        id: request.id,
        policyId: request.policyId,
        policyVersionId: request.policyVersionId,
        policyVersion: request.policyVersion,
        ruleId: request.ruleId,
        scopeType: request.scopeType,
        scopeRef: request.scopeRef,
        actionType: request.actionType,
        targetType: request.targetType,
        targetRef: request.targetRef,
        payload: request.payload ?? null,
        idempotencyKey: request.idempotencyKey,
        proposerPubkey: request.proposerPubkey,
        state: request.state,
        openedAt: request.openedAt instanceof Date ? request.openedAt.toISOString() : request.openedAt ?? null,
        expiresAt: request.expiresAt instanceof Date ? request.expiresAt.toISOString() : request.expiresAt ?? null,
        resolvedAt: request.resolvedAt instanceof Date ? request.resolvedAt.toISOString() : request.resolvedAt ?? null,
        snapshot: request.snapshot ?? null,
    };
}

async function readForkGovernanceFinalization(
    prisma: any,
    input: {
        requestId: string;
        sourceCircleId: number;
        declarationId: string;
        declarationText: string;
        actorUserId: number;
    },
): Promise<{ request: any; receipt: any | null }> {
    const request = await prisma.governanceRequest.findUnique({ where: { id: input.requestId } });
    if (!request) throw new Error('fork_governance_request_missing');
    const payload = asRecord(request.payload);
    if (
        request.actionType !== CIRCLE_FORK_ACTION_TYPE
        || request.targetType !== 'circle'
        || request.targetRef !== String(input.sourceCircleId)
        || payload?.declarationId !== input.declarationId
        || payload?.declarationText !== input.declarationText
        || Number(payload?.actorUserId) !== input.actorUserId
    ) {
        throw new Error('fork_governance_request_scope_mismatch');
    }
    if (request.state === 'active') return { request, receipt: null };
    if (request.state !== 'accepted') throw new Error('fork_governance_decision_not_accepted');
    const receipt = await prisma.governanceExecutionReceipt.findFirst({
        where: {
            requestId: request.id,
            executorModule: 'circle_lifecycle',
            executionStatus: 'skipped',
            errorCode: 'wallet_finalization_required',
        },
        orderBy: { executedAt: 'desc' },
    });
    if (!receipt) throw new Error('fork_governance_wallet_finalization_receipt_missing');
    return { request, receipt };
}

function normalizeExpansionMode(value: unknown): 'summary' | 'full_source' | null {
    if (value === undefined || value === null || value === '') return 'summary';
    if (value === 'summary') return 'summary';
    if (value === 'full_source') return 'full_source';
    return null;
}

async function loadExpandedSourceMaterial(
    prisma: PrismaClient,
    input: {
        sourceMaterialId: number;
        sourceCircleId: number;
    },
) {
    const material = await (prisma as any).sourceMaterial.findUnique({
        where: { id: input.sourceMaterialId },
        select: {
            id: true,
            circleId: true,
            name: true,
            contentDigest: true,
            chunks: {
                orderBy: [{ chunkIndex: 'asc' }],
                select: {
                    chunkIndex: true,
                    locatorType: true,
                    locatorRef: true,
                    text: true,
                    textLocator: true,
                    textDigest: true,
                },
            },
        },
    });
    if (!material || material.circleId !== input.sourceCircleId) {
        throw new Error('source_material_not_found');
    }
    const chunks = await Promise.all((Array.isArray(material.chunks) ? material.chunks : []).map(async (chunk: any) => ({
        chunkIndex: chunk.chunkIndex,
        locatorType: chunk.locatorType,
        locatorRef: chunk.locatorRef,
        text: (typeof chunk.text === 'string' && chunk.text.length > 0)
            ? chunk.text
            : (await loadPrivateText(chunk.textLocator)) || '',
        textDigest: chunk.textDigest,
    })));
    return {
        id: material.id,
        name: material.name,
        contentDigest: material.contentDigest,
        chunks,
    };
}

export function forkRouter(prisma: PrismaClient, _redis: Redis): Router {
    const router = Router();
    const forkStore = createPrismaForkRuntimeStore(prisma);
    const forkContextStore = createPrismaForkContextStore(prisma);

    router.get('/circles/:circleId/lineage', async (req, res) => {
        try {
            const circleId = asPositiveInteger(req.params.circleId);
            if (!circleId) {
                return res.status(400).json({ error: 'invalid_circle_id' });
            }

            const readModel = await loadForkLineageView(prisma, circleId);
            return res.json(readModel);
        } catch (error) {
            return res.status(400).json({
                error: error instanceof Error ? error.message : 'fork_lineage_read_failed',
            });
        }
    });

    router.get('/circles/:circleId/context', async (req, res) => {
        try {
            const circleId = asPositiveInteger(req.params.circleId);
            if (!circleId) {
                return res.status(400).json({ error: 'invalid_circle_id' });
            }
            const actor = await requireAuthenticatedActor(req, prisma, { requireSessionCookie: true });
            await requireCircleActorForAuthActor(actor, prisma, {
                circleId,
                action: 'circle.read',
                requireMemberChainPresence: false,
            });

            const context = await loadForkContextView(prisma, circleId);
            return res.json(context);
        } catch (error) {
            if (sendAuthActorError(res, error)) return;
            return res.status(400).json({
                error: error instanceof Error ? error.message : 'fork_context_read_failed',
            });
        }
    });

    router.get('/references/:referenceId/expand', async (req, res) => {
        try {
            const referenceId = asOptionalString(req.params.referenceId);
            if (!referenceId) {
                return res.status(400).json({ error: 'invalid_reference_id' });
            }
            const actor = await requireAuthenticatedActor(req, prisma, { requireSessionCookie: true });
            const mode = normalizeExpansionMode(req.query.mode);
            if (!mode) {
                return res.status(400).json({ error: 'invalid_expansion_mode' });
            }
            const expansionRecord = await loadForkReferenceExpansionRecord(prisma, referenceId);
            if (!expansionRecord) {
                return res.status(404).json({ error: 'fork_reference_not_found' });
            }

            const { reference, release } = expansionRecord;
            await requireCircleActorForAuthActor(actor, prisma, {
                circleId: reference.targetCircleId,
                action: 'circle.read',
                requireMemberChainPresence: false,
            });

            const decision = await evaluateForkReferenceExpansion(prisma, {
                targetCircleId: reference.targetCircleId,
                sourceCircleId: reference.sourceCircleId,
                viewerUserId: actor.userId,
                sourceGateSnapshot: reference.sourceGateSnapshot,
                releaseId: reference.releaseId,
                requestedMode: mode,
            });
            if (!decision.allowed) {
                return res.status(403).json({
                    error: decision.status,
                    decision,
                });
            }

            if (mode === 'summary') {
                if (!release?.summaryText) {
                    return res.status(403).json({
                        error: 'released_summary_required',
                        decision,
                    });
                }
                return res.json({
                    ok: true,
                    mode,
                    referenceId,
                    status: decision.status,
                    summaryText: release.summaryText,
                    summaryDigest: release.summaryDigest,
                    releaseId: release.releaseId,
                    decision,
                });
            }

            if (!reference.sourceMaterialId) {
                return res.status(404).json({
                    error: 'reference_source_material_not_found',
                    decision,
                });
            }
            const material = await loadExpandedSourceMaterial(prisma, {
                sourceMaterialId: reference.sourceMaterialId,
                sourceCircleId: reference.sourceCircleId,
            });
            return res.json({
                ok: true,
                mode,
                referenceId,
                status: decision.status,
                material,
                decision,
            });
        } catch (error) {
            if (sendAuthActorError(res, error)) return;
            return res.status(400).json({
                error: error instanceof Error ? error.message : 'fork_reference_expand_failed',
            });
        }
    });

    router.get('/circles/:sourceCircleId/qualification', async (req, res) => {
        try {
            const sourceCircleId = asPositiveInteger(req.params.sourceCircleId);
            if (!sourceCircleId) {
                return res.status(400).json({ error: 'invalid_fork_qualification_input' });
            }
            const actor = await requireAuthenticatedActor(req, prisma, { requireSessionCookie: true });
            await requireCircleActorForAuthActor(actor, prisma, {
                circleId: sourceCircleId,
                action: 'circle.read',
                requireMemberChainPresence: false,
            });

            const qualificationSnapshot = await resolveForkQualification(prisma, {
                sourceCircleId,
                userId: actor.userId,
            });
            return res.json(qualificationSnapshot);
        } catch (error) {
            if (sendAuthActorError(res, error)) return;
            return res.status(400).json({
                error: error instanceof Error ? error.message : 'fork_qualification_failed',
            });
        }
    });

    router.post('/circles/:sourceCircleId/forks', async (req, res) => {
        try {
            const sourceCircleId = asPositiveInteger(req.params.sourceCircleId);
            const declarationText = asOptionalString(req.body?.declarationText);

            if (!sourceCircleId || !declarationText) {
                return res.status(400).json({ error: 'invalid_fork_create_input' });
            }
            const actor = await requireAuthenticatedActor(req, prisma, { requireSessionCookie: true });
            await requireCircleActorForAuthActor(actor, prisma, {
                circleId: sourceCircleId,
                action: 'circle.read',
                requireMemberChainPresence: false,
            });

            const qualificationSnapshot = await resolveForkQualification(prisma, {
                sourceCircleId,
                userId: actor.userId,
            });
            if (!qualificationSnapshot.qualifies) {
                return res.status(403).json({
                    error: 'fork_qualification_not_met',
                    qualificationSnapshot,
                });
            }

            const declarationId = asOptionalString(req.body?.declarationId) ?? randomUUID();
            const suppliedGovernanceRequestId = asOptionalString(req.body?.governanceRequestId);
            let governanceFinalization: { request: any; receipt: any | null } | null = null;
            if (qualificationSnapshot.requiresGovernanceVote) {
                governanceFinalization = suppliedGovernanceRequestId
                    ? await readForkGovernanceFinalization(prisma as any, {
                        requestId: suppliedGovernanceRequestId,
                        sourceCircleId,
                        declarationId,
                        declarationText,
                        actorUserId: actor.userId,
                    })
                    : null;
                if (governanceFinalization?.request.state === 'active') {
                    return res.status(202).json({
                        status: 'requires_governance',
                        actionType: CIRCLE_FORK_ACTION_TYPE,
                        request: publicGovernanceRequest(governanceFinalization.request),
                    });
                }
                if (!governanceFinalization) {
                    const registry = createGovernedActionRegistry({ includeCircleLifecycleActions: true });
                    const gateway = new GovernedActionGateway({
                        registry,
                        resolveBinding: (input) => resolveActiveCircleGovernanceBinding(prisma as any, input),
                        listCommitteeEligibleActors: (input) => listCommitteeEligibleActors(prisma as any, input),
                        requestStore: createPrismaGovernanceRequestStore(prisma as any),
                        runtimePrisma: prisma as any,
                    });
                    const decision = await gateway.evaluate({
                        actionType: CIRCLE_FORK_ACTION_TYPE,
                        targetCircleId: sourceCircleId,
                        actorPubkey: actor.pubkey,
                        directAllowed: false,
                    });
                    if (decision.status === 'denied') {
                        return res.status(403).json({ error: decision.reason });
                    }
                    if (decision.status !== 'requires_governance') {
                        return res.status(403).json({ error: 'fork_governance_binding_required' });
                    }
                    const idempotencyKey = forkGovernanceIdempotencyKey(sourceCircleId, declarationId);
                    const existingRequest = await (prisma as any).governanceRequest.findFirst({
                        where: { idempotencyKey, state: 'active' },
                        include: { snapshot: true },
                        orderBy: { openedAt: 'desc' },
                    });
                    const request = existingRequest ?? await gateway.openRequest({
                        actionType: CIRCLE_FORK_ACTION_TYPE,
                        targetCircleId: sourceCircleId,
                        targetType: 'circle',
                        targetRef: String(sourceCircleId),
                        payload: {
                            declarationId,
                            declarationText,
                            actorUserId: actor.userId,
                            originAnchorRef: asOptionalString(req.body?.originAnchorRef),
                        },
                        idempotencyKey,
                        proposerPubkey: actor.pubkey,
                    });
                    return res.status(202).json({
                        status: 'requires_governance',
                        actionType: CIRCLE_FORK_ACTION_TYPE,
                        request: publicGovernanceRequest(request),
                    });
                }
            }

            const targetCircleId = asPositiveInteger(req.body?.targetCircleId);
            const existingLineage = targetCircleId
                ? await forkStore.getLineageByDeclarationId(declarationId)
                : null;
            const inheritanceSnapshot = targetCircleId && !existingLineage
                ? await buildForkInheritanceSnapshot(prisma, sourceCircleId, {
                    targetCircleId,
                    declarationId,
                    actorUserId: actor.userId,
                    governanceRequestId: governanceFinalization?.request.id ?? null,
                    governanceReceiptId: governanceFinalization?.receipt?.id ?? null,
                })
                : undefined;
            const result = await createForkCircle(forkStore, {
                declarationId,
                sourceCircleId,
                actorUserId: actor.userId,
                declarationText,
                originAnchorRef: asOptionalString(req.body?.originAnchorRef),
                qualificationSnapshot,
                inheritanceSnapshot,
                targetCircleId,
                executionAnchorDigest: asOptionalString(req.body?.executionAnchorDigest),
                createdAt: new Date(),
                ensureContextCapsule: async ({ declaration, lineage }) => {
                    const capsuleInput = await buildForkContextCapsuleInput(prisma, {
                        declaration: {
                            ...declaration,
                            qualificationSnapshot: declaration.qualificationSnapshot as unknown as Record<string, unknown>,
                        },
                        lineage,
                    });
                    await forkContextStore.ensureCapsule(capsuleInput);
                },
            });

            return res.json({
                ...result,
                status: targetCircleId ? 'completed' : 'prepared',
                governanceRequestId: governanceFinalization?.request.id ?? null,
            });
        } catch (error) {
            if (sendAuthActorError(res, error)) return;
            return res.status(400).json({
                error: error instanceof Error ? error.message : 'fork_create_failed',
            });
        }
    });

    return router;
}
