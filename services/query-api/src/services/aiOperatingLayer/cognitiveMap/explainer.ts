import {
    getPromptMetadata,
    getPromptSchema,
    getSystemPrompt,
} from '../../../ai/prompts/registry';
import type { AiJobRecord } from '../../aiJobs/types';
import { enqueueAiJob } from '../../aiJobs/runtime';
import type { CircleSummarySnapshot } from '../../circleSummary/snapshot';
import type { CircleSummaryTopologyPayload } from '../../circleSummary/topology';
import { callAiCapability } from '../capabilities/adapter';
import {
    loadCircleCognitiveMapContext,
    normalizeCircleCognitiveMapLocale,
    persistCircleCognitiveMapContext,
} from './context';
import {
    buildFallbackCircleCognitiveMapOutput,
    parseCircleCognitiveMapOutput,
} from './schema';
import {
    buildCircleCognitiveMapDedupeKey,
    readCircleCognitiveMapAiByDedupeKey,
    type CircleCognitiveMapAiView,
} from './readModel';
import {
    CIRCLE_COGNITIVE_MAP_EXPLAIN_TASK_TYPE,
    CIRCLE_COGNITIVE_MAP_SCHEMA_VERSION,
    type CircleCognitiveMapJobResult,
    type CircleCognitiveMapLocale,
} from './types';

type CircleCognitiveMapResultInput = Pick<
    CircleCognitiveMapJobResult,
    | 'status'
    | 'circleId'
    | 'sourceDigest'
    | 'output'
    | 'fallbackUsed'
    | 'failureCode'
    | 'modelProfile'
    | 'promptVersion'
>;

export function isCircleCognitiveMapAiEnabled(env: NodeJS.ProcessEnv = process.env): boolean {
    return String(env.AI_CIRCLE_COGNITIVE_MAP_AI_ENABLED ?? 'true')
        .trim()
        .toLowerCase() !== 'false';
}

export async function ensureCircleCognitiveMapAiView(input: {
    prisma: any;
    circleId: number;
    snapshot: CircleSummarySnapshot;
    topology: CircleSummaryTopologyPayload;
    locale?: string | CircleCognitiveMapLocale;
    now?: Date;
}): Promise<CircleCognitiveMapAiView> {
    const context = await persistCircleCognitiveMapContext({
        prisma: input.prisma,
        circleId: input.circleId,
        snapshot: input.snapshot,
        topology: input.topology,
        locale: normalizeCircleCognitiveMapLocale(input.locale),
        now: input.now,
    });
    const dedupeKey = buildCircleCognitiveMapDedupeKey({
        circleId: input.circleId,
        contextDigest: context.contextDigest,
    });
    const view = await readCircleCognitiveMapAiByDedupeKey(input.prisma, {
        circleId: input.circleId,
        dedupeKey,
    });
    if (view.status === 'missing' && isCircleCognitiveMapAiEnabled()) {
        await enqueueAiJob(input.prisma, {
            jobType: 'circle_cognitive_map_explain',
            taskType: CIRCLE_COGNITIVE_MAP_EXPLAIN_TASK_TYPE,
            taskCatalogVersion: 'v1',
            contextCapsuleId: context.capsuleId,
            dedupeKey,
            scopeType: 'circle',
            scopeCircleId: input.circleId,
            requestedByUserId: null,
            maxAttempts: 2,
            payload: {
                circleId: input.circleId,
                sourceDigest: context.sourceDigest,
                contextDigest: context.contextDigest,
            },
        });
        return readCircleCognitiveMapAiByDedupeKey(input.prisma, {
            circleId: input.circleId,
            dedupeKey,
        });
    }
    return view;
}

export async function processCircleCognitiveMapExplanationJob(
    prisma: any,
    input: {
        job: AiJobRecord;
    },
): Promise<CircleCognitiveMapJobResult> {
    const circleId = Number(input.job.scopeCircleId ?? input.job.payload?.circleId ?? 0);
    if (!Number.isFinite(circleId) || circleId <= 0) {
        throw new Error('invalid_circle_cognitive_map_job_payload');
    }
    const context = await loadCircleCognitiveMapContext(prisma, {
        contextCapsuleId: input.job.contextCapsuleId,
        expectedCircleId: circleId,
    });
    assertJobDigestMatchesContext(input.job, context);
    const promptMetadata = getPromptMetadata('circle-cognitive-map-explain');

    if (!isCircleCognitiveMapAiEnabled()) {
        return buildResult(input.job, {
            status: 'disabled',
            circleId,
            sourceDigest: context.sourceDigest,
            output: buildFallbackCircleCognitiveMapOutput('Circle cognitive map AI is disabled.'),
            fallbackUsed: true,
            failureCode: 'circle_cognitive_map_ai_disabled',
            modelProfile: null,
            promptVersion: promptMetadata.promptVersion,
        });
    }

    try {
        const capability = await callAiCapability({
            taskType: CIRCLE_COGNITIVE_MAP_EXPLAIN_TASK_TYPE,
            capability: 'text.structure',
            privacyProfile: 'public_protocol',
            runtimeRole: 'PUBLIC_NODE',
            input: {
                systemPrompt: getSystemPrompt('circle-cognitive-map-explain'),
                prompt: buildUserPrompt(context.payload),
                responseFormat: {
                    type: 'json',
                    name: 'circle_cognitive_map_explain',
                    schema: getPromptSchema('circle-cognitive-map-explain') ?? undefined,
                },
                temperature: 0.1,
                maxOutputTokens: 900,
            },
        });
        const output = parseCircleCognitiveMapOutput({
            rawText: capability.output.text,
            context: context.payload,
        });
        return buildResult(input.job, {
            status: 'ready',
            circleId,
            sourceDigest: context.sourceDigest,
            output,
            fallbackUsed: false,
            failureCode: null,
            modelProfile: capability.model,
            promptVersion: promptMetadata.promptVersion,
        });
    } catch (error) {
        const failureCode = error instanceof Error && error.message === 'invalid_model_output'
            ? 'invalid_model_output'
            : 'provider_failed';
        return buildResult(input.job, {
            status: 'fallback',
            circleId,
            sourceDigest: context.sourceDigest,
            output: buildFallbackCircleCognitiveMapOutput(failureCode),
            fallbackUsed: true,
            failureCode,
            modelProfile: null,
            promptVersion: promptMetadata.promptVersion,
        });
    }
}

function buildResult(
    job: AiJobRecord,
    input: CircleCognitiveMapResultInput,
): CircleCognitiveMapJobResult {
    return {
        taskType: CIRCLE_COGNITIVE_MAP_EXPLAIN_TASK_TYPE,
        taskCatalogVersion: job.taskCatalogVersion ?? 'v1',
        schemaVersion: CIRCLE_COGNITIVE_MAP_SCHEMA_VERSION,
        generatedAt: new Date().toISOString(),
        ...input,
    };
}

function buildUserPrompt(payload: unknown): string {
    return JSON.stringify({
        task: CIRCLE_COGNITIVE_MAP_EXPLAIN_TASK_TYPE,
        privacy: {
            inputMode: 'metadata_only',
            noRawDiscussionText: true,
            noHiddenTopologyNodes: true,
        },
        map: payload,
        outputRules: {
            bindEveryItemToProvidedIds: true,
            doNotInventRoutesNodesQuestionsStepsOrSourceRefs: true,
            doNotCreateActionsDraftsVotesTransactionsOrTopology: true,
            returnOnlyJson: true,
        },
    });
}

function assertJobDigestMatchesContext(
    job: AiJobRecord,
    context: Awaited<ReturnType<typeof loadCircleCognitiveMapContext>>,
): void {
    const sourceDigest = normalizeString(job.payload?.sourceDigest);
    if (!sourceDigest) throw new Error('context_capsule_source_digest_required');
    if (sourceDigest !== context.sourceDigest) throw new Error('context_capsule_source_digest_mismatch');
    const contextDigest = normalizeString(job.payload?.contextDigest);
    if (!contextDigest) throw new Error('context_capsule_context_digest_required');
    if (contextDigest !== context.contextDigest) throw new Error('context_capsule_context_digest_mismatch');
}

function normalizeString(value: unknown): string {
    return typeof value === 'string' ? value.trim() : '';
}
