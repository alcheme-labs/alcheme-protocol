import { classifyAiJobCompatibility } from './jobCompatibility';
import {
    createProposalForAcceptedIssueRevisionGeneration,
    createProposalForGhostDraftGeneration,
} from './proposals';
import type { AiJobType } from '../aiJobs/types';

export type AiOperatingLayerBackfillEnvelopeMode = 'off' | 'dry_run' | 'write';

export interface BackfillAiOperatingLayerInput {
    prisma: any;
    dryRun?: boolean;
    envelopeMode?: AiOperatingLayerBackfillEnvelopeMode;
    batchSize?: number;
}

export interface BackfillAiOperatingLayerResult {
    mutated: boolean;
    wouldUpdateAiJobs: number;
    updatedAiJobs: number;
    wouldCreateProposals: number;
    createdProposals: number;
    aiJobsByJobType: Record<string, {
        wouldUpdate: number;
        updated: number;
        taskType: string | null;
        modelTask: boolean;
        asyncDomainTask: boolean;
    }>;
    proposalCandidatesByPromptAsset: Record<string, {
        wouldCreate: number;
        created: number;
    }>;
    skippedJobTypes: string[];
}

export async function backfillAiOperatingLayer(
    input: BackfillAiOperatingLayerInput,
): Promise<BackfillAiOperatingLayerResult> {
    const dryRun = input.dryRun === true || input.envelopeMode === 'dry_run' || input.envelopeMode === 'off';
    const proposalWritesEnabled = !dryRun && input.envelopeMode !== 'off';
    const batchSize = Math.max(1, Math.min(Number(input.batchSize ?? 100), 500));

    const aiJobs = typeof input.prisma?.aiJob?.findMany === 'function'
        ? await input.prisma.aiJob.findMany({
            where: {
                taskType: null,
            },
            take: batchSize,
            orderBy: {
                id: 'asc',
            },
        })
        : [];
    const aiJobsByJobType: BackfillAiOperatingLayerResult['aiJobsByJobType'] = {};
    const jobCompatibilityRows = aiJobs
        .map((job: any) => ({
            job,
            compatibility: classifyAiJobCompatibility(job.jobType as AiJobType),
        }));
    for (const item of jobCompatibilityRows) {
        const jobType = String(item.job.jobType || '');
        if (!aiJobsByJobType[jobType]) {
            aiJobsByJobType[jobType] = {
                wouldUpdate: 0,
                updated: 0,
                taskType: item.compatibility.taskType,
                modelTask: item.compatibility.modelTask,
                asyncDomainTask: item.compatibility.asyncDomainTask,
            };
        }
        if (item.compatibility.taskType) {
            aiJobsByJobType[jobType].wouldUpdate += 1;
        }
    }
    const jobUpdates = jobCompatibilityRows.filter((item: any) => item.compatibility.taskType);
    const skippedJobTypes = Array.from(new Set<string>(
        jobCompatibilityRows
            .filter((item: any) => !item.compatibility.taskType)
            .map((item: any) => String(item.job.jobType || 'unknown')),
    )).sort();

    const generations = typeof input.prisma?.ghostDraftGeneration?.findMany === 'function'
        ? await input.prisma.ghostDraftGeneration.findMany({
            where: {
                promptAsset: {
                    in: ['ghost-draft-comment', 'accepted-issue-revision'],
                },
            },
            take: batchSize,
            orderBy: {
                id: 'asc',
            },
        })
        : [];
    const proposalCandidates = generations.filter((generation: any) =>
        generation?.id
        && generation?.draftPostId
        && generation?.sourceDigest
        && generation?.draftText,
    );
    const proposalCandidatesByPromptAsset: BackfillAiOperatingLayerResult['proposalCandidatesByPromptAsset'] = {};
    for (const generation of generations) {
        const promptAsset = String(generation?.promptAsset || 'unknown');
        if (!proposalCandidatesByPromptAsset[promptAsset]) {
            proposalCandidatesByPromptAsset[promptAsset] = {
                wouldCreate: 0,
                created: 0,
            };
        }
    }
    for (const generation of proposalCandidates) {
        const promptAsset = String(generation.promptAsset || 'unknown');
        proposalCandidatesByPromptAsset[promptAsset].wouldCreate += 1;
    }

    let updatedAiJobs = 0;
    let createdProposals = 0;

    if (!dryRun && typeof input.prisma?.aiJob?.updateMany === 'function') {
        for (const item of jobUpdates) {
            const updateResult = await input.prisma.aiJob.updateMany({
                where: {
                    id: item.job.id,
                    taskType: null,
                },
                data: {
                    taskType: item.compatibility.taskType,
                    taskCatalogVersion: item.compatibility.taskCatalogVersion,
                },
            });
            const updatedCount = Number(updateResult?.count ?? 1);
            updatedAiJobs += updatedCount;
            const jobType = String(item.job.jobType || '');
            if (aiJobsByJobType[jobType]) {
                aiJobsByJobType[jobType].updated += updatedCount;
            }
        }
    }

    if (proposalWritesEnabled && typeof input.prisma?.aiProposalArtifact?.upsert === 'function') {
        for (const generation of proposalCandidates) {
            if (generation.promptAsset === 'accepted-issue-revision') {
                await createProposalForAcceptedIssueRevisionGeneration(input.prisma, {
                    generation,
                    aiJobId: generation.aiJobId ?? null,
                });
            } else {
                await createProposalForGhostDraftGeneration(input.prisma, {
                    generation,
                    aiJobId: generation.aiJobId ?? null,
                });
            }
            createdProposals += 1;
            const promptAsset = String(generation.promptAsset || 'unknown');
            if (proposalCandidatesByPromptAsset[promptAsset]) {
                proposalCandidatesByPromptAsset[promptAsset].created += 1;
            }
        }
    }

    return {
        mutated: updatedAiJobs > 0 || createdProposals > 0,
        wouldUpdateAiJobs: jobUpdates.length,
        updatedAiJobs,
        wouldCreateProposals: proposalCandidates.length,
        createdProposals,
        aiJobsByJobType,
        proposalCandidatesByPromptAsset,
        skippedJobTypes,
    };
}
