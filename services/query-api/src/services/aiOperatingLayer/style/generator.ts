import {
    getPromptMetadata,
    getPromptSchema,
    getSystemPrompt,
} from '../../../ai/prompts/registry';
import { callAiCapability } from '../capabilities/adapter';
import { createProposalForStyleAdvisor } from '../proposals';
import type { AiJobRecord } from '../../aiJobs/types';
import { throwAiGenerationFailure } from '../generationFailure';
import { loadStyleAdvisorConfig } from './config';
import { loadStyleAdvisorContext } from './context';
import { parseStyleAdvisorModelOutput } from './schema';
import {
    listStyleTokenPolicy,
} from './validator';
import type { StyleAdvisorContextPayload, StyleAdvisorProposal } from './types';

const TASK_TYPE = 'style.life_feel_advisor.v1';

export async function processStyleLifeFeelJob(
    prisma: any,
    input: {
        job: AiJobRecord;
    },
): Promise<Record<string, unknown>> {
    const config = loadStyleAdvisorConfig();
    const scope = input.job.payload?.scope === 'circle' || input.job.payload?.scope === 'session_preview'
        ? input.job.payload.scope
        : 'personal';

    if (!config.enabled) {
        return {
            proposalArtifactId: null,
            taskType: TASK_TYPE,
            taskCatalogVersion: input.job.taskCatalogVersion ?? 'v1',
            status: 'disabled',
            scope,
            riskLevel: 'low',
            validationErrorCount: 0,
            failureCode: 'style_advisor_disabled',
        };
    }

    const subjectType = typeof input.job.payload?.subjectType === 'string'
        ? input.job.payload.subjectType
        : scope === 'circle'
            ? 'circle'
            : 'style_user';
    const subjectId = typeof input.job.payload?.subjectId === 'string'
        ? input.job.payload.subjectId
        : scope === 'circle' && input.job.scopeCircleId
            ? String(input.job.scopeCircleId)
            : String(input.job.requestedByUserId ?? '');
    const context = await loadStyleAdvisorContext(prisma, {
        contextCapsuleId: input.job.contextCapsuleId,
        expectedSubjectType: subjectType,
        expectedSubjectId: subjectId || undefined,
        expectedActorUserId: input.job.requestedByUserId ?? undefined,
    });

    const promptMetadata = getPromptMetadata('style-life-feel-advisor');
    let proposal: StyleAdvisorProposal;
    let modelProfile: string | null = null;

    try {
        const capability = await callAiCapability({
            taskType: TASK_TYPE,
            capability: 'text.structure',
            privacyProfile: 'public_protocol',
            runtimeRole: 'PUBLIC_NODE',
            input: {
                systemPrompt: getSystemPrompt('style-life-feel-advisor'),
                prompt: buildUserPrompt(context.payload),
                responseFormat: {
                    type: 'json',
                    name: 'style_life_feel_advisor',
                    schema: getPromptSchema('style-life-feel-advisor') ?? undefined,
                },
                temperature: 0.1,
                maxOutputTokens: 700,
            },
        });
        modelProfile = capability.model;
        proposal = parseStyleAdvisorModelOutput({
            scope: context.payload.scope,
            currentPreference: context.payload.currentPreference,
            rawText: capability.output.text,
            maxChanges: config.maxTokenChanges,
        });
    } catch (error) {
        throwAiGenerationFailure(error);
    }

    const artifact = await createProposalForStyleAdvisor(prisma, {
        subjectType: context.subjectType,
        subjectId: context.subjectId,
        createdByUserId: input.job.requestedByUserId ?? context.actorUserId,
        contextCapsuleId: context.capsuleId,
        sourceDigest: context.sourceDigest,
        evidenceRefs: [],
        scope: context.payload.scope,
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
        scope: proposal.scope,
        riskLevel: proposal.riskLevel,
        tokenChangeCount: proposal.tokenDiff.length,
        validationErrorCount: proposal.validationErrors.length,
        failureCode: null,
    };
}

function buildUserPrompt(payload: StyleAdvisorContextPayload): string {
    return JSON.stringify({
        task: TASK_TYPE,
        scope: payload.scope,
        locale: payload.locale,
        userIntent: payload.sanitizedIntent.text,
        currentPreference: payload.currentPreference,
        lifeFeelSignals: payload.lifeFeelSignals,
        publicCircleSnapshot: payload.publicCircleSnapshot,
        tokenPolicyVersion: payload.tokenPolicyVersion,
        allowedTokens: listStyleTokenPolicy(),
        outputContract: {
            tokenDiff: 'array of allowlisted token changes only',
            lifeFeelInputs: 'structured values only',
            previewState: 'structured token preview only',
            forbidden: ['css', 'selector', 'url', 'remote resource', 'private content profiling'],
        },
    });
}
