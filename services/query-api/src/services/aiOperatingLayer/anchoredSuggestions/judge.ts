import {
    getPromptMetadata,
    getPromptSchema,
    getSystemPrompt,
} from '../../../ai/prompts/registry';
import { createAiJobHandlerError } from '../../aiJobs/errors';
import type { AiJobRecord } from '../../aiJobs/types';
import { callAiCapability } from '../capabilities/adapter';
import { loadAnchoredSuggestionAiConfig } from './config';
import { loadAnchoredSuggestionContext } from './context';
import { parseAnchoredSuggestionModelOutput } from './schema';
import {
    ANCHORED_SUGGESTION_SCHEMA_VERSION,
    ANCHORED_SUGGESTION_TASK_TYPE,
    type AnchoredSuggestionJobResult,
} from './types';

type AnchoredSuggestionResultInput = Pick<
    AnchoredSuggestionJobResult,
    | 'status'
    | 'circleId'
    | 'sourceDigest'
    | 'decisions'
    | 'fallbackUsed'
    | 'failureCode'
    | 'modelProfile'
    | 'promptVersion'
>;

export async function processAnchoredSuggestionJob(
    prisma: any,
    input: {
        job: AiJobRecord;
    },
): Promise<AnchoredSuggestionJobResult> {
    const circleId = Number(input.job.scopeCircleId ?? input.job.payload?.circleId ?? 0);
    if (!Number.isFinite(circleId) || circleId <= 0) {
        throw new Error('invalid_anchored_suggestion_job_payload');
    }
    const config = loadAnchoredSuggestionAiConfig();
    const context = await loadAnchoredSuggestionContext(prisma, {
        contextCapsuleId: input.job.contextCapsuleId,
        expectedCircleId: circleId,
        expectedActorUserId: input.job.requestedByUserId ?? undefined,
    });

    if (context.payload.candidates.length === 0) {
        return buildResult(input.job, {
            status: 'ready',
            circleId,
            sourceDigest: context.sourceDigest,
            decisions: [],
            fallbackUsed: false,
            failureCode: null,
            modelProfile: null,
            promptVersion: null,
        });
    }

    if (!config.enabled) {
        throw createAiJobHandlerError(
            'anchored_suggestions_disabled',
            'anchored interaction suggestion AI is disabled',
        );
    }

    const promptMetadata = getPromptMetadata('anchored-interaction-suggestion');
    try {
        const capability = await callAiCapability({
            taskType: ANCHORED_SUGGESTION_TASK_TYPE,
            capability: 'text.structure',
            privacyProfile: 'public_protocol',
            runtimeRole: 'PUBLIC_NODE',
            input: {
                systemPrompt: getSystemPrompt('anchored-interaction-suggestion'),
                prompt: buildUserPrompt(context.payload),
                responseFormat: {
                    type: 'json',
                    name: 'anchored_interaction_suggestion',
                    schema: getPromptSchema('anchored-interaction-suggestion') ?? undefined,
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
        const decisions = parseAnchoredSuggestionModelOutput({
            rawText: capability.output.text,
            candidates: context.payload.candidates,
        });
        return buildResult(input.job, {
            status: 'ready',
            circleId,
            sourceDigest: context.sourceDigest,
            decisions,
            fallbackUsed: false,
            failureCode: null,
            modelProfile: capability.model,
            promptVersion: promptMetadata.promptVersion,
        });
    } catch (error) {
        const failureCode = error instanceof Error && error.message === 'invalid_model_output'
            ? 'invalid_model_output'
            : 'provider_failed';
        throw createAiJobHandlerError(
            failureCode,
            error instanceof Error && error.message.trim() ? error.message : failureCode,
        );
    }
}

function buildResult(
    job: AiJobRecord,
    input: AnchoredSuggestionResultInput,
): AnchoredSuggestionJobResult {
    return {
        taskType: ANCHORED_SUGGESTION_TASK_TYPE,
        taskCatalogVersion: job.taskCatalogVersion ?? 'v1',
        schemaVersion: ANCHORED_SUGGESTION_SCHEMA_VERSION,
        ...input,
    };
}

function buildUserPrompt(payload: {
    circleId: number;
    locale: string;
    candidates: unknown[];
}): string {
    return JSON.stringify({
        task: ANCHORED_SUGGESTION_TASK_TYPE,
        locale: payload.locale,
        circleId: payload.circleId,
        privacy: {
            inputMode: 'metadata_only',
            noRawDiscussionText: true,
        },
        candidates: payload.candidates,
        output: {
            decisions: 'one decision per candidate envelopeId',
            allowedSuggestedTypes: ['signup', 'poll', 'challenge', 'none'],
            allowedReasonCodes: [
                'needs_participants',
                'needs_decision',
                'needs_verification',
                'low_actionability',
                'unclear',
            ],
            requiredModelFields: ['envelopeId', 'suggestedType'],
            optionalModelFields: ['reasonCode', 'shortReason'],
            serverDerivedDecisionFields: [
                'shouldSuggest',
                'importanceScore',
                'actionabilityScore',
                'discussionAdvancementScore',
                'confidence',
            ],
        },
    });
}
