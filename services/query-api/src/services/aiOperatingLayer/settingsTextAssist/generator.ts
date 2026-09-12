import {
    getPromptMetadata,
    getPromptSchema,
    getSystemPrompt,
} from '../../../ai/prompts/registry';
import type { AiJobRecord } from '../../aiJobs/types';
import { callAiCapability } from '../capabilities/adapter';
import { createProposalForSettingsTextAssist } from '../proposals';
import { loadSettingsTextAssistConfig } from './config';
import { loadSettingsTextAssistContext } from './context';
import {
    getSettingsTextFieldPolicy,
} from './fieldPolicy';
import { throwAiGenerationFailure } from '../generationFailure';
import { parseSettingsTextAssistModelOutput } from './schema';
import type {
    SettingsTextAssistContextPayload,
    SettingsTextAssistField,
    SettingsTextAssistSubjectType,
    SettingsTextSuggestionProposal,
} from './types';

const TASK_TYPE = 'settings.field_text_suggestion.v1';

export async function processSettingsTextAssistJob(
    prisma: any,
    input: {
        job: AiJobRecord;
    },
): Promise<Record<string, unknown>> {
    const config = loadSettingsTextAssistConfig();
    const field = normalizeField(input.job.payload?.field);

    if (!config.enabled) {
        return {
            proposalArtifactId: null,
            taskType: TASK_TYPE,
            taskCatalogVersion: input.job.taskCatalogVersion ?? 'v1',
            status: 'disabled',
            field: field ?? null,
            riskLevel: 'low',
            validationErrorCount: 0,
            failureCode: 'settings_text_assist_disabled',
        };
    }

    if (!field) {
        throw new Error('invalid_settings_text_assist_job_payload');
    }
    const policy = getSettingsTextFieldPolicy(field);
    if (!policy) {
        throw new Error('invalid_settings_text_assist_job_payload');
    }
    const subjectType = typeof input.job.payload?.subjectType === 'string'
        ? input.job.payload.subjectType as SettingsTextAssistSubjectType
        : policy.subjectType;
    const subjectId = typeof input.job.payload?.subjectId === 'string'
        ? input.job.payload.subjectId
        : policy.subjectType === 'circle_alias' && input.job.scopeCircleId
            ? String(input.job.scopeCircleId)
            : String(input.job.requestedByUserId ?? '');

    const context = await loadSettingsTextAssistContext(prisma, {
        contextCapsuleId: input.job.contextCapsuleId,
        expectedSubjectType: subjectType,
        expectedSubjectId: subjectId || undefined,
        expectedActorUserId: input.job.requestedByUserId ?? undefined,
    });

    const promptMetadata = getPromptMetadata('settings-text-assist');
    let proposal: SettingsTextSuggestionProposal;
    let modelProfile: string | null = null;

    try {
        const capability = await callAiCapability({
            taskType: TASK_TYPE,
            capability: 'text.structure',
            privacyProfile: 'public_protocol',
            runtimeRole: 'PUBLIC_NODE',
            input: {
                systemPrompt: getSystemPrompt('settings-text-assist'),
                prompt: buildUserPrompt(context.payload),
                responseFormat: {
                    type: 'json',
                    name: 'settings_text_assist',
                    schema: getPromptSchema('settings-text-assist') ?? undefined,
                },
                temperature: 0.1,
                maxOutputTokens: 300,
            },
        });
        modelProfile = capability.model;
        proposal = parseSettingsTextAssistModelOutput({
            field: context.payload.field,
            currentValue: context.payload.currentValue,
            rawText: capability.output.text,
        });
    } catch (error) {
        throwAiGenerationFailure(error);
    }

    const artifact = await createProposalForSettingsTextAssist(prisma, {
        subjectType: context.subjectType,
        subjectId: context.subjectId,
        createdByUserId: input.job.requestedByUserId ?? context.actorUserId,
        contextCapsuleId: context.capsuleId,
        sourceDigest: context.sourceDigest,
        field: context.payload.field,
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
        field: proposal.field,
        riskLevel: proposal.riskLevel,
        validationErrorCount: proposal.validationErrors.length,
        failureCode: null,
    };
}

function buildUserPrompt(payload: SettingsTextAssistContextPayload): string {
    const policy = getSettingsTextFieldPolicy(payload.field);
    return JSON.stringify({
        task: TASK_TYPE,
        field: payload.field,
        locale: payload.locale,
        userIntent: payload.sanitizedIntent.text,
        currentValue: payload.currentValue,
        surroundingValues: payload.surroundingValues,
        outputContract: {
            field: payload.field,
            maxLength: policy?.maxLength ?? 200,
            forbidden: ['discussion content', 'draft content', 'source material', 'private notes', 'automatic apply'],
            applyBehavior: 'proposal_only_local_user_confirm',
        },
    });
}

function normalizeField(value: unknown): SettingsTextAssistField | null {
    const text = String(value || '').trim() as SettingsTextAssistField;
    return getSettingsTextFieldPolicy(text) ? text : null;
}
