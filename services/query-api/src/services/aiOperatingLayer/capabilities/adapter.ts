import type {
    AiDataBoundary,
    AiEmbeddingTask,
    AiModelTask,
    GenerateAiEmbeddingInput,
    GenerateAiEmbeddingResult,
    GenerateAiTextInput,
    GenerateAiTextResult,
} from '../../../ai/provider';
import { resolveTaskCatalogEntry } from '../taskCatalog';
import type { AiCapability, AiRuntimeRole } from '../types';

type CapabilityInput =
    | {
        taskType: string;
        capability: 'text.generate' | 'text.structure' | 'text.classify';
        privacyProfile?: AiDataBoundary;
        runtimeRole?: AiRuntimeRole;
        input: {
            prompt: string;
            systemPrompt?: string | null;
            responseFormat?: GenerateAiTextInput['responseFormat'];
            providerOptions?: GenerateAiTextInput['providerOptions'];
            temperature?: number;
            maxOutputTokens?: number;
        };
    }
    | {
        taskType: string;
        capability: 'text.embed';
        privacyProfile?: AiDataBoundary;
        runtimeRole?: AiRuntimeRole;
        input: {
            text: string;
        };
    };

export interface CapabilityResult {
    capability: AiCapability;
    providerProfile: 'builtin' | 'external';
    model: string;
    output: Record<string, unknown>;
    usage: {
        latencyMs: number;
    };
    fallbackUsed: boolean;
    traceId: string;
}

export interface CapabilityProviderDeps {
    generateAiText(input: GenerateAiTextInput): Promise<GenerateAiTextResult>;
    generateAiEmbedding(input: GenerateAiEmbeddingInput): Promise<GenerateAiEmbeddingResult>;
    assertAiTaskAllowed(input: {
        task: AiModelTask;
        dataBoundary?: AiDataBoundary;
    }): void;
}

export async function callAiCapability(
    input: CapabilityInput,
    deps?: CapabilityProviderDeps,
): Promise<CapabilityResult> {
    const providerDeps = deps ?? await loadDefaultProviderDeps();
    const catalogEntry = resolveTaskCatalogEntry(input.taskType);
    if (!catalogEntry || !catalogEntry.requiredCapabilities.includes(input.capability)) {
        throw new Error('capability_not_declared');
    }

    const startedAt = Date.now();
    const providerTask = mapTaskTypeToProviderTask(input.taskType, input.capability);
    if (!providerTask) {
        throw new Error('unsupported_capability_provider_task');
    }
    if (input.privacyProfile === 'private_plaintext' && input.runtimeRole && input.runtimeRole !== 'PRIVATE_SIDECAR') {
        throw new Error('private_sidecar_required');
    }
    providerDeps.assertAiTaskAllowed({
        task: providerTask,
        dataBoundary: input.privacyProfile,
    });

    if (input.capability === 'text.embed') {
        const embedding = await providerDeps.generateAiEmbedding({
            task: mapTaskTypeToEmbeddingTask(input.taskType),
            text: input.input.text,
            dataBoundary: input.privacyProfile,
        });
        return {
            capability: input.capability,
            providerProfile: embedding.providerMode,
            model: embedding.model,
            output: {
                embedding: embedding.embedding,
            },
            usage: {
                latencyMs: Date.now() - startedAt,
            },
            fallbackUsed: false,
            traceId: buildTraceId(input.taskType, input.capability, startedAt),
        };
    }

    const text = await providerDeps.generateAiText({
        task: providerTask as Exclude<AiModelTask, 'embedding'>,
        systemPrompt: input.input.systemPrompt,
        userPrompt: input.input.prompt,
        temperature: input.input.temperature,
        maxOutputTokens: input.input.maxOutputTokens,
        responseFormat: input.input.responseFormat,
        providerOptions: input.input.providerOptions,
        dataBoundary: input.privacyProfile,
    });

    return {
        capability: input.capability,
        providerProfile: text.providerMode,
        model: text.model,
        output: {
            text: text.text,
            rawFinishReason: text.rawFinishReason ?? null,
        },
        usage: {
            latencyMs: Date.now() - startedAt,
        },
        fallbackUsed: false,
        traceId: buildTraceId(input.taskType, input.capability, startedAt),
    };
}

function mapTaskTypeToProviderTask(
    taskType: string,
    capability: AiCapability,
): AiModelTask | null {
    if (capability === 'text.embed') return 'embedding';
    if (taskType === 'draft.ghost_revision.v1') return 'ghost-draft';
    if (taskType === 'draft.accepted_issue_revision.v1') return 'accepted-issue-revision';
    if (taskType === 'discussion.summary.v1') return 'discussion-summary';
    if (taskType === 'discussion.trigger.v1') return 'discussion-trigger';
    if (taskType === 'place_prompt.trend_aware.v1') return 'place-prompt';
    if (taskType === 'configuration.copilot.v1') return 'configuration-copilot';
    if (taskType === 'settings.field_text_suggestion.v1') return 'settings-text-assist';
    if (taskType === 'style.life_feel_advisor.v1') return 'style-advisor';
    if (taskType === 'anchored.interaction_suggestion_judge.v1') return 'anchored-interaction-suggestion';
    if (taskType === 'knowledge.relationship_label_classify.v1') return 'knowledge-relationship-label-classifier';
    if (taskType === 'knowledge.relationship_label_coverage_audit.v1') return 'knowledge-relationship-label-coverage-audit';
    if (taskType === 'circle.cognitive_map_explain.v1') return 'circle-cognitive-map-explain';
    if (taskType === 'contribution.assessment_suggest.v1') return 'contribution-assessment';
    if (taskType === 'source.grounded_ask.v1') return 'source-grounded-ask';
    if (taskType === 'evaluation.neutral.v1') return 'neutral-evaluation';
    if (taskType === 'circle.growth_advisor.v1') return 'circle-growth-advisor';
    return null;
}

function mapTaskTypeToEmbeddingTask(taskType: string): AiEmbeddingTask {
    if (taskType === 'discussion.reanalyze.v1') return 'circle-topic-profile';
    return 'discussion-relevance';
}

function buildTraceId(taskType: string, capability: AiCapability, startedAt: number): string {
    const safeTask = taskType.replace(/[^a-z0-9_.-]/gi, '_');
    const safeCapability = capability.replace(/[^a-z0-9_.-]/gi, '_');
    return `aiol_${safeTask}_${safeCapability}_${startedAt}`;
}

async function loadDefaultProviderDeps(): Promise<CapabilityProviderDeps> {
    const provider = await import('../../../ai/provider');
    return {
        generateAiText: provider.generateAiText,
        generateAiEmbedding: provider.generateAiEmbedding,
        assertAiTaskAllowed: provider.assertAiTaskAllowed,
    };
}
