import type { PrismaClient } from '@prisma/client';
import type { Redis } from 'ioredis';

import { maybeTriggerGhostDraftFromDiscussion } from '../../ai/discussion-draft-trigger';
import { generateGhostDraft } from '../../ai/ghost-draft';
import {
    createCrystalMintAdapter,
    type CrystalMintAdapter,
} from '../crystalAssets/mintAdapter';
import { issueCrystalAssetJob } from '../crystalAssets/jobs';
import { runDiscussionMessageAnalyzeJob } from '../discussion/analysis/enqueue';
import { runDiscussionCircleReanalyzeJob } from '../discussion/analysis/invalidation';
import { acceptGhostDraftIntoWorkingCopy } from '../ghostDraft/acceptance';
import type { AiJobHandlerMap } from './types';

export function createAiJobHandlers(input: {
    prisma: PrismaClient;
    redis: Redis;
    crystalMintAdapter?: CrystalMintAdapter;
}): AiJobHandlerMap {
    const prismaAny = input.prisma as any;

    return {
        async ghost_draft_generate({ job }) {
            const postId = Number(job.payload?.postId ?? job.scopeDraftPostId ?? 0);
            const userId = Number(job.requestedByUserId ?? job.payload?.userId ?? 0);
            if (!Number.isFinite(postId) || postId <= 0 || !Number.isFinite(userId) || userId <= 0) {
                throw new Error('invalid_ghost_draft_job_payload');
            }

            const selectedSeededReference = (
                typeof job.payload?.seededReference === 'object'
                && job.payload?.seededReference
                && !Array.isArray(job.payload.seededReference)
            )
                ? job.payload.seededReference as Record<string, unknown>
                : null;
            const result = await generateGhostDraft(input.prisma, postId, userId, {
                seededReference:
                    selectedSeededReference
                    && typeof selectedSeededReference.path === 'string'
                    && Number.isFinite(Number(selectedSeededReference.line))
                        ? {
                            path: selectedSeededReference.path,
                            line: Number(selectedSeededReference.line),
                        }
                        : null,
                sourceMaterialIds: Array.isArray(job.payload?.sourceMaterialIds)
                    ? job.payload.sourceMaterialIds
                        .map((value) => Number(value))
                        .filter((value) => Number.isFinite(value) && value > 0)
                    : null,
            });
            let acceptanceResult: Awaited<ReturnType<typeof acceptGhostDraftIntoWorkingCopy>> | null = null;
            if (typeof prismaAny.ghostDraftGeneration?.updateMany === 'function') {
                await prismaAny.ghostDraftGeneration.updateMany({
                    where: {
                        id: result.generationId,
                        aiJobId: null,
                    },
                    data: {
                        aiJobId: job.id,
                    },
                });
            }

            if (job.payload?.autoApplyRequested) {
                acceptanceResult = await acceptGhostDraftIntoWorkingCopy(input.prisma as any, {
                    draftPostId: postId,
                    generationId: result.generationId,
                    userId,
                    mode: 'auto_fill',
                    workingCopyHash:
                        typeof job.payload?.workingCopyHash === 'string'
                            ? job.payload.workingCopyHash
                            : null,
                    workingCopyUpdatedAt:
                        typeof job.payload?.workingCopyUpdatedAt === 'string'
                            ? job.payload.workingCopyUpdatedAt
                            : null,
                });
            }

            return {
                generationId: result.generationId,
                postId: result.postId,
                model: result.model,
                autoApplied: Boolean(acceptanceResult?.applied),
                acceptanceId: acceptanceResult?.acceptanceId ?? null,
                changed: acceptanceResult?.changed ?? false,
                acceptanceMode: acceptanceResult?.acceptanceMode ?? null,
                workingCopyHash: acceptanceResult?.workingCopyHash ?? null,
                updatedAt: acceptanceResult?.updatedAt?.toISOString?.() ?? null,
                heatScore: acceptanceResult?.heatScore ?? null,
            };
        },

        async discussion_trigger_evaluate({ job }) {
            const circleId = Number(job.payload?.circleId ?? job.scopeCircleId ?? 0);
            if (!Number.isFinite(circleId) || circleId <= 0) {
                throw new Error('invalid_discussion_trigger_job_payload');
            }

            const result = await maybeTriggerGhostDraftFromDiscussion({
                prisma: input.prisma,
                redis: input.redis,
                circleId,
                aiJob: {
                    id: job.id,
                    attempt: job.attempts,
                    requestedByUserId: job.requestedByUserId,
                },
            });
            return {
                circleId,
                ...result,
            };
        },

        async discussion_message_analyze({ job }) {
            const circleId = Number(job.payload?.circleId ?? job.scopeCircleId ?? 0);
            const envelopeId = typeof job.payload?.envelopeId === 'string'
                ? job.payload.envelopeId
                : '';
            if (!Number.isFinite(circleId) || circleId <= 0 || !envelopeId.trim()) {
                throw new Error('invalid_discussion_message_analyze_job_payload');
            }

            return runDiscussionMessageAnalyzeJob({
                prisma: input.prisma,
                redis: input.redis,
                circleId,
                envelopeId: envelopeId.trim(),
                requestedByUserId: job.requestedByUserId ?? null,
            });
        },

        async discussion_circle_reanalyze({ job }) {
            const circleId = Number(job.payload?.circleId ?? job.scopeCircleId ?? 0);
            if (!Number.isFinite(circleId) || circleId <= 0) {
                throw new Error('invalid_discussion_circle_reanalyze_payload');
            }

            return runDiscussionCircleReanalyzeJob({
                prisma: input.prisma,
                redis: input.redis,
                circleId,
                requestedByUserId: job.requestedByUserId ?? null,
            });
        },

        async crystal_asset_issue({ job }) {
            const knowledgeRowId = Number(job.payload?.knowledgeRowId ?? 0);
            const knowledgePublicId = typeof job.payload?.knowledgePublicId === 'string'
                ? job.payload.knowledgePublicId.trim()
                : '';
            if ((!Number.isFinite(knowledgeRowId) || knowledgeRowId <= 0) && !knowledgePublicId) {
                throw new Error('invalid_crystal_asset_issue_payload');
            }
            const crystalMintAdapter = input.crystalMintAdapter !== undefined
                ? input.crystalMintAdapter
                : createCrystalMintAdapter();

            return issueCrystalAssetJob(input.prisma as any, {
                knowledgeRowId: Number.isFinite(knowledgeRowId) && knowledgeRowId > 0 ? knowledgeRowId : undefined,
                knowledgePublicId: knowledgePublicId || undefined,
                mintAdapter: crystalMintAdapter,
            });
        },
    };
}
