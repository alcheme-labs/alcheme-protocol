import {
    getPromptMetadata,
    getPromptSchema,
    getSystemPrompt,
} from '../../../ai/prompts/registry';
import { callAiCapability } from '../capabilities/adapter';
import { createProposalForConfigurationCopilot } from '../proposals';
import { loadConfigurationCopilotConfig } from './config';
import { loadConfigurationCopilotContext } from './context';
import {
    listAllowedConfigurationFields,
} from './fieldPolicy';
import { throwAiGenerationFailure } from '../generationFailure';
import { parseConfigurationCopilotModelOutput } from './schema';
import type { ConfigurationProposalDiff } from './types';
import type { AiJobRecord } from '../../aiJobs/types';

const TASK_TYPE = 'configuration.copilot.v1';

export async function processConfigurationCopilotJob(
    prisma: any,
    input: {
        job: AiJobRecord;
    },
): Promise<Record<string, unknown>> {
    const config = loadConfigurationCopilotConfig();
    if (!config.enabled) {
        return {
            proposalArtifactId: null,
            taskType: TASK_TYPE,
            taskCatalogVersion: input.job.taskCatalogVersion ?? 'v1',
            status: 'disabled',
            riskLevel: 'low',
            affectedFields: [],
            validationErrorCount: 0,
            failureCode: 'configuration_copilot_disabled',
        };
    }

    const subjectType = typeof input.job.payload?.subjectType === 'string'
        ? input.job.payload.subjectType
        : input.job.scopeCircleId
            ? 'circle'
            : 'circle_create_session';
    const subjectId = typeof input.job.payload?.subjectId === 'string'
        ? input.job.payload.subjectId
        : input.job.scopeCircleId
            ? String(input.job.scopeCircleId)
            : '';
    const context = await loadConfigurationCopilotContext(prisma, {
        contextCapsuleId: input.job.contextCapsuleId,
        expectedSubjectType: subjectType,
        expectedSubjectId: subjectId || undefined,
        expectedActorUserId: input.job.requestedByUserId ?? undefined,
    });

    const promptMetadata = getPromptMetadata('configuration-copilot');
    let proposal: ConfigurationProposalDiff;
    let modelProfile: string | null = null;

    try {
        const capability = await callAiCapability({
            taskType: TASK_TYPE,
            capability: 'text.structure',
            privacyProfile: 'public_protocol',
            runtimeRole: 'PUBLIC_NODE',
            input: {
                systemPrompt: getSystemPrompt('configuration-copilot'),
                prompt: buildUserPrompt(context.payload),
                responseFormat: {
                    type: 'json',
                    name: 'configuration_copilot',
                    schema: getPromptSchema('configuration-copilot') ?? undefined,
                },
                providerOptions: {
                    openai: {
                        reasoningEffort: 'none',
                    },
                },
                temperature: 0.1,
                maxOutputTokens: 1000,
            },
        });
        modelProfile = capability.model;
        proposal = parseConfigurationCopilotModelOutput({
            entrypoint: context.payload.entrypoint,
            currentSnapshot: context.payload.normalizedSnapshot,
            rawText: capability.output.text,
            maxChanges: config.maxChanges,
            targetFields: context.payload.targetFields,
        });
    } catch (error) {
        throwAiGenerationFailure(error);
    }

    const artifact = await createProposalForConfigurationCopilot(prisma, {
        subjectType: context.subjectType,
        subjectId: context.subjectId,
        createdByUserId: input.job.requestedByUserId ?? context.actorUserId,
        contextCapsuleId: context.capsuleId,
        sourceDigest: context.sourceDigest,
        evidenceRefs: context.evidenceRefs.filter((ref) => ref.sourceType !== 'source_material'),
        entrypoint: context.payload.entrypoint,
        proposal,
        modelProfile,
        promptVersion: promptMetadata.promptVersion,
        expiresAt: context.expiresAt,
    });

    return {
        proposalArtifactId: typeof artifact?.id === 'string' ? artifact.id : null,
        taskType: TASK_TYPE,
        taskCatalogVersion: input.job.taskCatalogVersion ?? 'v1',
        status: 'ready',
        riskLevel: proposal.riskLevel,
        affectedFields: proposal.affectedFields,
        validationErrorCount: proposal.validationErrors.length,
        failureCode: null,
    };
}

function buildUserPrompt(payload: Awaited<ReturnType<typeof loadConfigurationCopilotContext>>['payload']): string {
    const targetFields = payload.targetFields.length > 0
        ? payload.targetFields
        : listAllowedConfigurationFields(payload.entrypoint);
    return JSON.stringify({
        task: TASK_TYPE,
        entrypoint: payload.entrypoint,
        interactionMode: payload.interactionMode,
        locale: payload.locale,
        userIntent: payload.sanitizedIntent.text,
        currentSnapshot: payload.normalizedSnapshot,
        allowedFields: targetFields,
        targetFields: payload.targetFields,
        trendRefs: payload.trendRefs.map((ref) => ({
            sourceType: ref.sourceType,
            sourceId: ref.sourceId,
            digest: ref.digest,
            visibility: ref.visibility,
        })),
        sourceMaterialRefCount: payload.sourceMaterialRefs.length,
    });
}
