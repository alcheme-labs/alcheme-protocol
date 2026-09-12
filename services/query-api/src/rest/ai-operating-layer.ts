import { Router } from 'express';
import type { PrismaClient } from '@prisma/client';
import type { Redis } from 'ioredis';

import { requireAuthenticatedActor } from '../services/auth/actor';
import {
    authorizeDraftActionForActor,
    requireCircleManagerForActor,
    sendAuthActorError,
} from '../services/auth/actorPermissions';
import { listAiTaskCatalogEntries } from '../services/aiOperatingLayer/taskCatalog';
import { buildAiOperatingLayerMigrationStatus } from '../services/aiOperatingLayer/migrationStatus';
import { isInternalApiRequest } from '../security/internalAuth';
import { enqueueKnowledgeRelationshipCoverageAudit } from '../services/knowledgeRelationshipLabelAi/coverageAudit';
import { recordKnowledgeRelationshipLabelProposalDecision } from '../services/knowledgeRelationshipLabelAi/proposals';

const PUBLIC_JSON_BLOCKED_KEYS = new Set([
    'proofRoot',
    'signature',
    'receiptWeight',
    'rawPrompt',
    'rawText',
    'privateText',
    'providerRawResponse',
    'css',
    'selector',
    'remoteResource',
    'sourceExcerpt',
    'personalProfile',
    'providerTrace',
    'privateProfile',
    'claimToken',
    'confirmationTokenHash',
    'contextCapsuleId',
    'capabilityTrace',
]);

function parsePositiveInt(value: unknown): number | null {
    const parsed = Number.parseInt(String(value ?? ''), 10);
    if (!Number.isFinite(parsed) || parsed <= 0) return null;
    return parsed;
}

function serializeDate(value: unknown): string | null {
    if (value instanceof Date) return value.toISOString();
    if (typeof value === 'string' && value.trim()) return value;
    return null;
}

function isKnowledgeRelationshipLabelCatalogProposal(proposal: any): boolean {
    return proposal?.domainArtifactType === 'knowledge_relationship_label_catalog_proposal'
        && (
            proposal.subjectType === 'knowledge'
            || proposal.subjectType === 'knowledge_relationship_label_catalog'
        );
}

function sendInternalAuthError(req: any, res: any): boolean {
    if (isInternalApiRequest({ headers: req.headers ?? {} })) return false;
    res.status(401).json({ error: 'internal_api_token_required' });
    return true;
}

function toProposalView(proposal: any): Record<string, unknown> {
    return {
        id: String(proposal.id),
        taskType: String(proposal.taskType || ''),
        subjectType: String(proposal.subjectType || ''),
        subjectId: String(proposal.subjectId || ''),
        status: String(proposal.status || ''),
        createdByUserId: proposal.createdByUserId ?? null,
        acceptedByUserId: proposal.acceptedByUserId ?? null,
        rejectedByUserId: proposal.rejectedByUserId ?? null,
        appliedByUserId: proposal.appliedByUserId ?? null,
        sourceDigest: String(proposal.sourceDigest || ''),
        evidenceRefs: sanitizePublicJson(Array.isArray(proposal.evidenceRefs) ? proposal.evidenceRefs : []),
        modelProfile: proposal.modelProfile ? String(proposal.modelProfile) : null,
        promptVersion: proposal.promptVersion ? String(proposal.promptVersion) : null,
        outputSchemaVersion: String(proposal.outputSchemaVersion || ''),
        riskLevel: String(proposal.riskLevel || ''),
        proposedAction: String(proposal.proposedAction || ''),
        proposedDiff: sanitizePublicJson(proposal.proposedDiff && typeof proposal.proposedDiff === 'object'
            ? proposal.proposedDiff
            : {}),
        explanation: String(proposal.explanation || ''),
        validationErrors: Array.isArray(proposal.validationErrors)
            ? proposal.validationErrors
            : [],
        reviewRequired: Boolean(proposal.reviewRequired),
        domainArtifactType: String(proposal.domainArtifactType || ''),
        domainArtifactId: String(proposal.domainArtifactId || ''),
        domainStatus: proposal.domainStatus ? String(proposal.domainStatus) : null,
        expiresAt: serializeDate(proposal.expiresAt),
        createdAt: serializeDate(proposal.createdAt),
        updatedAt: serializeDate(proposal.updatedAt),
    };
}

function sanitizePublicJson(value: unknown): unknown {
    if (!value || typeof value !== 'object') return value;
    if (Array.isArray(value)) {
        return value.map(sanitizePublicJson);
    }
    const output: Record<string, unknown> = {};
    for (const [key, nested] of Object.entries(value as Record<string, unknown>)) {
        if (PUBLIC_JSON_BLOCKED_KEYS.has(key)) continue;
        output[key] = sanitizePublicJson(nested);
    }
    return output;
}

async function authorizeProposalRead(
    prisma: PrismaClient,
    actor: Awaited<ReturnType<typeof requireAuthenticatedActor>>,
    proposal: any,
): Promise<{
    allowed: true;
} | {
    allowed: false;
    statusCode: number;
    error: string;
    message?: string;
}> {
    if (proposal.subjectType === 'draft_post') {
        const draftPostId = parsePositiveInt(proposal.subjectId);
        if (!draftPostId) {
            return {
                allowed: false,
                statusCode: 404,
                error: 'ai_proposal_not_found',
            };
        }
        const access = await authorizeDraftActionForActor(prisma, {
            actor,
            postId: draftPostId,
            action: 'read',
        });
        if (!access.allowed) {
            return {
                allowed: false,
                statusCode: access.statusCode,
                error: access.error,
                message: access.message,
            };
        }
        return { allowed: true };
    }

    if (proposal.subjectType === 'circle') {
        const circleId = parsePositiveInt(proposal.subjectId);
        if (!circleId) {
            return {
                allowed: false,
                statusCode: 404,
                error: 'ai_proposal_not_found',
            };
        }
        await requireCircleManagerForActor(prisma, {
            actor,
            circleId,
        });
        return { allowed: true };
    }

    if (proposal.subjectType === 'circle_alias') {
        const circleId = parsePositiveInt(proposal.subjectId);
        if (!circleId) {
            return {
                allowed: false,
                statusCode: 404,
                error: 'ai_proposal_not_found',
            };
        }
        return Number(proposal.createdByUserId ?? 0) === actor.userId
            ? { allowed: true }
            : {
                allowed: false,
                statusCode: 404,
                error: 'ai_proposal_not_found',
            };
    }

    if (proposal.subjectType === 'profile') {
        return Number(proposal.createdByUserId ?? 0) === actor.userId
            && String(proposal.subjectId || '') === String(actor.userId)
            ? { allowed: true }
            : {
                allowed: false,
                statusCode: 404,
                error: 'ai_proposal_not_found',
            };
    }

    if (proposal.subjectType === 'place_prompt') {
        return Number(proposal.createdByUserId ?? 0) === actor.userId
            ? { allowed: true }
            : {
                allowed: false,
                statusCode: 404,
                error: 'ai_proposal_not_found',
            };
    }

    if (proposal.subjectType === 'circle_create_session' || proposal.subjectType === 'circle_fork_session') {
        return Number(proposal.createdByUserId ?? 0) === actor.userId
            ? { allowed: true }
            : {
                allowed: false,
                statusCode: 404,
                error: 'ai_proposal_not_found',
            };
    }

    if (proposal.subjectType === 'style_user' || proposal.subjectType === 'style_session') {
        return Number(proposal.createdByUserId ?? 0) === actor.userId
            ? { allowed: true }
            : {
                allowed: false,
                statusCode: 404,
                error: 'ai_proposal_not_found',
            };
    }

    return {
        allowed: false,
        statusCode: 404,
        error: 'ai_proposal_not_found',
    };
}

export function aiOperatingLayerRouter(prisma: PrismaClient, _redis: Redis): Router {
    const router = Router();

    router.get('/catalog', async (_req, res, next) => {
        try {
            return res.status(200).json({
                ok: true,
                entries: listAiTaskCatalogEntries().map((entry) => ({
                    taskType: entry.taskType,
                    catalogVersion: entry.catalogVersion,
                    status: entry.status,
                    executionStrategy: entry.executionStrategy,
                    requiredCapabilities: entry.requiredCapabilities,
                    allowedProviderProfiles: entry.allowedProviderProfiles,
                    promptVersion: entry.promptVersion,
                    outputSchemaVersion: entry.outputSchemaVersion,
                    currentOwnerPath: entry.currentOwnerPath,
                    aiJobType: entry.aiJobType,
                })),
            });
        } catch (error) {
            return next(error);
        }
    });

    router.get('/migration-status', async (_req, res, next) => {
        try {
            return res.status(200).json({
                ok: true,
                status: buildAiOperatingLayerMigrationStatus(),
            });
        } catch (error) {
            return next(error);
        }
    });

    router.post('/internal/knowledge-relationship-labels/coverage-audits', async (req, res, next) => {
        try {
            if (sendInternalAuthError(req, res)) return;
            const circleId = parsePositiveInt(req.body?.circleId ?? req.query?.circleId);
            const result = await enqueueKnowledgeRelationshipCoverageAudit({
                prisma: prisma as any,
                circleId,
            });
            return res.status(202).json({
                ok: true,
                job: result,
            });
        } catch (error) {
            return next(error);
        }
    });

    router.get('/internal/knowledge-relationship-labels/proposals', async (req, res, next) => {
        try {
            if (sendInternalAuthError(req, res)) return;
            const limit = Math.min(parsePositiveInt(req.query.limit) ?? 20, 100);
            const proposals = await (prisma as any).aiProposalArtifact.findMany({
                where: {
                    domainArtifactType: 'knowledge_relationship_label_catalog_proposal',
                },
                orderBy: {
                    createdAt: 'desc',
                },
                take: limit,
            });
            return res.status(200).json({
                ok: true,
                proposals: proposals.map(toProposalView),
            });
        } catch (error) {
            return next(error);
        }
    });

    router.get('/internal/knowledge-relationship-labels/proposals/:proposalId', async (req, res, next) => {
        try {
            if (sendInternalAuthError(req, res)) return;
            const proposalId = String(req.params.proposalId || '').trim();
            if (!proposalId) {
                return res.status(400).json({ error: 'invalid_ai_proposal_id' });
            }
            const proposal = await (prisma as any).aiProposalArtifact.findUnique({
                where: { id: proposalId },
            });
            if (!proposal || !isKnowledgeRelationshipLabelCatalogProposal(proposal)) {
                return res.status(404).json({ error: 'ai_proposal_not_found' });
            }
            return res.status(200).json({
                ok: true,
                proposal: toProposalView(proposal),
            });
        } catch (error) {
            return next(error);
        }
    });

    router.post('/internal/knowledge-relationship-labels/proposals/:proposalId/decision', async (req, res, next) => {
        try {
            if (sendInternalAuthError(req, res)) return;
            const proposalId = String(req.params.proposalId || '').trim();
            const decision = String(req.body?.decision || '').trim();
            if (!proposalId) {
                return res.status(400).json({ error: 'invalid_ai_proposal_id' });
            }
            if (!['accepted', 'rejected', 'expired'].includes(decision)) {
                return res.status(400).json({ error: 'invalid_ai_proposal_decision' });
            }
            const result = await recordKnowledgeRelationshipLabelProposalDecision(prisma as any, {
                proposalId,
                decision: decision as 'accepted' | 'rejected' | 'expired',
                decidedBy: typeof req.body?.decidedBy === 'string' ? req.body.decidedBy : null,
                reason: typeof req.body?.reason === 'string' ? req.body.reason : null,
            });
            if (!result.ok) {
                return res.status(result.error === 'already_decided' ? 409 : 404).json({
                    error: result.error,
                });
            }
            return res.status(200).json({
                ok: true,
                proposal: toProposalView(result.proposal),
                applied: false,
            });
        } catch (error) {
            return next(error);
        }
    });

    router.get('/proposals', async (req, res, next) => {
        try {
            const actor = await requireAuthenticatedActor(req, prisma as any, {
                requireSessionCookie: true,
            });
            const draftPostId = parsePositiveInt(req.query.draftPostId);
            const circleId = parsePositiveInt(req.query.circleId);
            const placePromptId = typeof req.query.placePromptId === 'string'
                ? req.query.placePromptId.trim()
                : '';
            const createSessionId = typeof req.query.createSessionId === 'string'
                ? req.query.createSessionId.trim()
                : '';
            const forkSessionId = typeof req.query.forkSessionId === 'string'
                ? req.query.forkSessionId.trim()
                : '';
            const styleUserId = req.query.styleUserId === 'me'
                ? String(actor.userId)
                : typeof req.query.styleUserId === 'string'
                    ? req.query.styleUserId.trim()
                    : '';
            const styleSessionId = typeof req.query.styleSessionId === 'string'
                ? req.query.styleSessionId.trim()
                : '';
            const limit = Math.min(parsePositiveInt(req.query.limit) ?? 20, 100);

            if (draftPostId) {
                const access = await authorizeDraftActionForActor(prisma as any, {
                    actor,
                    postId: draftPostId,
                    action: 'read',
                });
                if (!access.allowed) {
                    return res.status(access.statusCode).json({
                        error: access.error,
                        message: access.message,
                    });
                }

                const proposals = await (prisma as any).aiProposalArtifact.findMany({
                    where: {
                        subjectType: 'draft_post',
                        subjectId: String(draftPostId),
                    },
                    orderBy: {
                        createdAt: 'desc',
                    },
                    take: limit,
                });
                return res.status(200).json({
                    ok: true,
                    proposals: proposals.map(toProposalView),
                });
            }

            if (circleId) {
                await requireCircleManagerForActor(prisma as any, {
                    actor,
                    circleId,
                });
                const proposals = await (prisma as any).aiProposalArtifact.findMany({
                    where: {
                        subjectType: 'circle',
                        subjectId: String(circleId),
                    },
                    orderBy: {
                        createdAt: 'desc',
                    },
                    take: limit,
                });
                return res.status(200).json({
                    ok: true,
                    proposals: proposals.map(toProposalView),
                });
            }

            if (placePromptId) {
                const proposals = await (prisma as any).aiProposalArtifact.findMany({
                    where: {
                        subjectType: 'place_prompt',
                        subjectId: placePromptId,
                        createdByUserId: actor.userId,
                    },
                    orderBy: {
                        createdAt: 'desc',
                    },
                    take: limit,
                });
                return res.status(200).json({
                    ok: true,
                    proposals: proposals.map(toProposalView),
                });
            }

            if (createSessionId) {
                const proposals = await (prisma as any).aiProposalArtifact.findMany({
                    where: {
                        subjectType: 'circle_create_session',
                        subjectId: createSessionId,
                        createdByUserId: actor.userId,
                    },
                    orderBy: {
                        createdAt: 'desc',
                    },
                    take: limit,
                });
                return res.status(200).json({
                    ok: true,
                    proposals: proposals.map(toProposalView),
                });
            }

            if (forkSessionId) {
                const proposals = await (prisma as any).aiProposalArtifact.findMany({
                    where: {
                        subjectType: 'circle_fork_session',
                        subjectId: forkSessionId,
                        createdByUserId: actor.userId,
                    },
                    orderBy: {
                        createdAt: 'desc',
                    },
                    take: limit,
                });
                return res.status(200).json({
                    ok: true,
                    proposals: proposals.map(toProposalView),
                });
            }

            if (styleUserId) {
                if (styleUserId !== String(actor.userId)) {
                    return res.status(404).json({ error: 'ai_proposal_not_found' });
                }
                const proposals = await (prisma as any).aiProposalArtifact.findMany({
                    where: {
                        subjectType: 'style_user',
                        subjectId: styleUserId,
                        createdByUserId: actor.userId,
                    },
                    orderBy: {
                        createdAt: 'desc',
                    },
                    take: limit,
                });
                return res.status(200).json({
                    ok: true,
                    proposals: proposals.map(toProposalView),
                });
            }

            if (styleSessionId) {
                const proposals = await (prisma as any).aiProposalArtifact.findMany({
                    where: {
                        subjectType: 'style_session',
                        subjectId: styleSessionId,
                        createdByUserId: actor.userId,
                    },
                    orderBy: {
                        createdAt: 'desc',
                    },
                    take: limit,
                });
                return res.status(200).json({
                    ok: true,
                    proposals: proposals.map(toProposalView),
                });
            }

            return res.status(400).json({
                error: 'ai_proposal_scope_filter_required',
                message: 'provide draftPostId, circleId, placePromptId, createSessionId, styleUserId, or styleSessionId',
            });
        } catch (error) {
            if (sendAuthActorError(res, error)) return;
            return next(error);
        }
    });

    router.get('/proposals/:proposalId', async (req, res, next) => {
        try {
            const actor = await requireAuthenticatedActor(req, prisma as any, {
                requireSessionCookie: true,
            });
            const proposalId = String(req.params.proposalId || '').trim();
            if (!proposalId) {
                return res.status(400).json({ error: 'invalid_ai_proposal_id' });
            }

            const proposal = await (prisma as any).aiProposalArtifact.findUnique({
                where: {
                    id: proposalId,
                },
            });
            if (!proposal) {
                return res.status(404).json({ error: 'ai_proposal_not_found' });
            }

            const access = await authorizeProposalRead(prisma as any, actor, proposal);
            if (!access.allowed) {
                return res.status(access.statusCode).json({
                    error: access.error,
                    message: access.message,
                });
            }

            return res.status(200).json({
                ok: true,
                proposal: toProposalView(proposal),
            });
        } catch (error) {
            if (sendAuthActorError(res, error)) return;
            return next(error);
        }
    });

    router.post('/proposals/:proposalId/apply', async (_req, res) => res.status(404).json({
        error: 'ai_proposal_apply_not_available',
        message: 'AI Operating Layer proposal application is domain-owned and not exposed in Part 0.',
    }));

    return router;
}
