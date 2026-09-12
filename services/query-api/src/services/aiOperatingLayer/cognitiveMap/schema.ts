import type {
    CircleCognitiveMapAiOutput,
    CircleCognitiveMapContextPayload,
    CognitiveSourceRef,
} from './types';

const CONFIDENCE = new Set(['low', 'medium', 'high']);
const FORBIDDEN_ACTION_PATTERN = /\b(create|publish|crystallize|vote|transaction|transfer|fund|compensation|mint|sign)\b|创建|发布|结晶|投票|交易|转账|资金|补偿/i;

export const CIRCLE_COGNITIVE_MAP_RESPONSE_SCHEMA = {
    type: 'object',
    additionalProperties: false,
    required: [
        'routeExplanations',
        'pendingQuestionExplanations',
        'topologyExplanations',
        'evolutionNarration',
        'warnings',
    ],
    properties: {
        coreQuestionSuggestion: {
            anyOf: [
                { type: 'null' },
                {
                    type: 'object',
                    additionalProperties: false,
                    required: ['text', 'sourceRouteIds', 'sourceRefs', 'confidence'],
                    properties: {
                        text: { type: 'string', minLength: 1, maxLength: 220 },
                        sourceRouteIds: { type: 'array', items: { type: 'string' }, maxItems: 6 },
                        sourceRefs: { type: 'array', items: sourceRefSchema(), maxItems: 8 },
                        confidence: { type: 'string', enum: ['low', 'medium', 'high'] },
                    },
                },
            ],
        },
        routeExplanations: {
            type: 'array',
            maxItems: 12,
            items: {
                type: 'object',
                additionalProperties: false,
                required: ['routeId', 'reason', 'sourceRefs'],
                properties: {
                    routeId: { type: 'string' },
                    shortTitle: { type: 'string', maxLength: 80 },
                    reason: { type: 'string', minLength: 1, maxLength: 360 },
                    nextAction: { type: 'string', maxLength: 180 },
                    sourceRefs: { type: 'array', items: sourceRefSchema(), maxItems: 8 },
                },
            },
        },
        pendingQuestionExplanations: {
            type: 'array',
            maxItems: 8,
            items: {
                type: 'object',
                additionalProperties: false,
                required: ['questionId', 'summary', 'nextAction', 'linkedRouteIds'],
                properties: {
                    questionId: { type: 'string' },
                    summary: { type: 'string', minLength: 1, maxLength: 360 },
                    nextAction: { type: 'string', minLength: 1, maxLength: 180 },
                    linkedRouteIds: { type: 'array', items: { type: 'string' }, maxItems: 6 },
                },
            },
        },
        roleGuidance: {
            anyOf: [
                { type: 'null' },
                {
                    type: 'object',
                    additionalProperties: false,
                    properties: {
                        newcomer: { type: 'string', maxLength: 240 },
                        participant: { type: 'string', maxLength: 240 },
                        reviewer: { type: 'string', maxLength: 240 },
                    },
                },
            ],
        },
        topologyExplanations: {
            type: 'array',
            maxItems: 12,
            items: {
                type: 'object',
                additionalProperties: false,
                required: ['nodeId', 'reason', 'linkedRouteIds'],
                properties: {
                    nodeId: { type: 'string' },
                    reason: { type: 'string', minLength: 1, maxLength: 360 },
                    suggestedAction: { type: 'string', maxLength: 180 },
                    linkedRouteIds: { type: 'array', items: { type: 'string' }, maxItems: 6 },
                },
            },
        },
        evolutionNarration: {
            type: 'array',
            maxItems: 12,
            items: {
                type: 'object',
                additionalProperties: false,
                required: ['stepId', 'narration', 'sourceRefs'],
                properties: {
                    stepId: { type: 'string' },
                    narration: { type: 'string', minLength: 1, maxLength: 360 },
                    sourceRefs: { type: 'array', items: sourceRefSchema(), maxItems: 8 },
                },
            },
        },
        warnings: {
            type: 'array',
            items: { type: 'string', maxLength: 180 },
            maxItems: 6,
        },
    },
} as const;

export function parseCircleCognitiveMapOutput(input: {
    rawText: unknown;
    context: CircleCognitiveMapContextPayload;
}): CircleCognitiveMapAiOutput {
    const parsed = parseObject(input.rawText);
    const routeIds = new Set(input.context.routes.map((route) => route.id));
    const nodeIds = new Set(input.context.topology.nodes.map((node) => node.id));
    const questionIds = new Set(input.context.openQuestions.map((question) => question.questionId));
    const stepIds = new Set(input.context.evolution.map((step) => step.id));
    const sourceRefs = collectAllowedSourceRefs(input.context);

    const output: CircleCognitiveMapAiOutput = {
        routeExplanations: normalizeArray(parsed.routeExplanations)
            .map((item) => normalizeRouteExplanation(item, routeIds, sourceRefs))
            .filter((item): item is CircleCognitiveMapAiOutput['routeExplanations'][number] => Boolean(item))
            .slice(0, 12),
        pendingQuestionExplanations: normalizeArray(parsed.pendingQuestionExplanations)
            .map((item) => normalizePendingQuestionExplanation(item, questionIds, routeIds))
            .filter((item): item is CircleCognitiveMapAiOutput['pendingQuestionExplanations'][number] => Boolean(item))
            .slice(0, 8),
        topologyExplanations: normalizeArray(parsed.topologyExplanations)
            .map((item) => normalizeTopologyExplanation(item, nodeIds, routeIds))
            .filter((item): item is CircleCognitiveMapAiOutput['topologyExplanations'][number] => Boolean(item))
            .slice(0, 12),
        evolutionNarration: normalizeArray(parsed.evolutionNarration)
            .map((item) => normalizeEvolutionNarration(item, stepIds, sourceRefs))
            .filter((item): item is CircleCognitiveMapAiOutput['evolutionNarration'][number] => Boolean(item))
            .slice(0, 12),
        warnings: normalizeArray(parsed.warnings)
            .map((item) => safeText(item, 180))
            .filter(Boolean)
            .slice(0, 6),
    };

    const coreQuestionSuggestion = normalizeCoreQuestionSuggestion(
        parsed.coreQuestionSuggestion,
        routeIds,
        sourceRefs,
    );
    if (coreQuestionSuggestion) output.coreQuestionSuggestion = coreQuestionSuggestion;

    const roleGuidance = normalizeRoleGuidance(parsed.roleGuidance);
    if (roleGuidance) output.roleGuidance = roleGuidance;

    return output;
}

export function buildFallbackCircleCognitiveMapOutput(reason: string): CircleCognitiveMapAiOutput {
    return {
        routeExplanations: [],
        pendingQuestionExplanations: [],
        topologyExplanations: [],
        evolutionNarration: [],
        warnings: [safeText(reason, 180) || 'AI explanation unavailable.'],
    };
}

function sourceRefSchema(): Record<string, unknown> {
    return {
        type: 'object',
        additionalProperties: false,
        required: ['kind', 'id', 'label'],
        properties: {
            kind: { type: 'string', enum: ['discussion', 'draft', 'crystal', 'knowledge', 'citation'] },
            id: { type: 'string' },
            label: { type: 'string', maxLength: 120 },
        },
    };
}

function parseObject(value: unknown): Record<string, unknown> {
    if (value && typeof value === 'object' && !Array.isArray(value)) return value as Record<string, unknown>;
    const text = String(value ?? '').trim();
    if (!text) throw new Error('invalid_model_output');
    try {
        const parsed = JSON.parse(text);
        if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) throw new Error('invalid_model_output');
        return parsed as Record<string, unknown>;
    } catch {
        throw new Error('invalid_model_output');
    }
}

function normalizeArray(value: unknown): unknown[] {
    return Array.isArray(value) ? value : [];
}

function safeText(value: unknown, maxLength: number): string {
    const text = String(value ?? '').replace(/\s+/g, ' ').trim().slice(0, maxLength);
    if (!text || FORBIDDEN_ACTION_PATTERN.test(text)) return '';
    return text;
}

function collectAllowedSourceRefs(context: CircleCognitiveMapContextPayload): Map<string, CognitiveSourceRef> {
    const refs = new Map<string, CognitiveSourceRef>();
    for (const route of context.routes) {
        for (const ref of route.sourceRefs) refs.set(refKey(ref), ref);
    }
    for (const step of context.evolution) {
        for (const ref of step.sourceRefs) refs.set(refKey(ref), ref);
    }
    return refs;
}

function filterRouteIds(value: unknown, routeIds: Set<string>): string[] {
    return Array.from(new Set(normalizeArray(value).map((item) => String(item || '').trim()).filter((item) => routeIds.has(item))));
}

function filterSourceRefs(value: unknown, sourceRefs: Map<string, CognitiveSourceRef>): CognitiveSourceRef[] {
    return normalizeArray(value)
        .map((item) => {
            if (!item || typeof item !== 'object' || Array.isArray(item)) return null;
            const record = item as Record<string, unknown>;
            return sourceRefs.get(refKey({
                kind: record.kind as CognitiveSourceRef['kind'],
                id: String(record.id || '').trim(),
                label: String(record.label || '').trim(),
            }));
        })
        .filter((item): item is CognitiveSourceRef => Boolean(item))
        .slice(0, 8);
}

function normalizeCoreQuestionSuggestion(
    value: unknown,
    routeIds: Set<string>,
    sourceRefs: Map<string, CognitiveSourceRef>,
): CircleCognitiveMapAiOutput['coreQuestionSuggestion'] | null {
    if (!value || typeof value !== 'object' || Array.isArray(value)) return null;
    const record = value as Record<string, unknown>;
    const text = safeText(record.text, 220);
    const confidence = String(record.confidence || '').trim();
    if (!text || !CONFIDENCE.has(confidence)) return null;
    return {
        text,
        sourceRouteIds: filterRouteIds(record.sourceRouteIds, routeIds),
        sourceRefs: filterSourceRefs(record.sourceRefs, sourceRefs),
        confidence: confidence as 'low' | 'medium' | 'high',
    };
}

function normalizeRouteExplanation(
    value: unknown,
    routeIds: Set<string>,
    sourceRefs: Map<string, CognitiveSourceRef>,
): CircleCognitiveMapAiOutput['routeExplanations'][number] | null {
    if (!value || typeof value !== 'object' || Array.isArray(value)) return null;
    const record = value as Record<string, unknown>;
    const routeId = String(record.routeId || '').trim();
    const reason = safeText(record.reason, 360);
    if (!routeIds.has(routeId) || !reason) return null;
    const shortTitle = safeText(record.shortTitle, 80);
    const nextAction = safeText(record.nextAction, 180);
    return {
        routeId,
        ...(shortTitle ? { shortTitle } : {}),
        reason,
        ...(nextAction ? { nextAction } : {}),
        sourceRefs: filterSourceRefs(record.sourceRefs, sourceRefs),
    };
}

function normalizePendingQuestionExplanation(
    value: unknown,
    questionIds: Set<string>,
    routeIds: Set<string>,
): CircleCognitiveMapAiOutput['pendingQuestionExplanations'][number] | null {
    if (!value || typeof value !== 'object' || Array.isArray(value)) return null;
    const record = value as Record<string, unknown>;
    const questionId = String(record.questionId || '').trim();
    const summary = safeText(record.summary, 360);
    const nextAction = safeText(record.nextAction, 180);
    if (!questionIds.has(questionId) || !summary || !nextAction) return null;
    return {
        questionId,
        summary,
        nextAction,
        linkedRouteIds: filterRouteIds(record.linkedRouteIds, routeIds),
    };
}

function normalizeRoleGuidance(value: unknown): CircleCognitiveMapAiOutput['roleGuidance'] | null {
    if (!value || typeof value !== 'object' || Array.isArray(value)) return null;
    const record = value as Record<string, unknown>;
    const newcomer = safeText(record.newcomer, 240);
    const participant = safeText(record.participant, 240);
    const reviewer = safeText(record.reviewer, 240);
    if (!newcomer && !participant && !reviewer) return null;
    return {
        ...(newcomer ? { newcomer } : {}),
        ...(participant ? { participant } : {}),
        ...(reviewer ? { reviewer } : {}),
    };
}

function normalizeTopologyExplanation(
    value: unknown,
    nodeIds: Set<string>,
    routeIds: Set<string>,
): CircleCognitiveMapAiOutput['topologyExplanations'][number] | null {
    if (!value || typeof value !== 'object' || Array.isArray(value)) return null;
    const record = value as Record<string, unknown>;
    const nodeId = String(record.nodeId || '').trim();
    const reason = safeText(record.reason, 360);
    if (!nodeIds.has(nodeId) || !reason) return null;
    const suggestedAction = safeText(record.suggestedAction, 180);
    return {
        nodeId,
        reason,
        ...(suggestedAction ? { suggestedAction } : {}),
        linkedRouteIds: filterRouteIds(record.linkedRouteIds, routeIds),
    };
}

function normalizeEvolutionNarration(
    value: unknown,
    stepIds: Set<string>,
    sourceRefs: Map<string, CognitiveSourceRef>,
): CircleCognitiveMapAiOutput['evolutionNarration'][number] | null {
    if (!value || typeof value !== 'object' || Array.isArray(value)) return null;
    const record = value as Record<string, unknown>;
    const stepId = String(record.stepId || '').trim();
    const narration = safeText(record.narration, 360);
    if (!stepIds.has(stepId) || !narration) return null;
    return {
        stepId,
        narration,
        sourceRefs: filterSourceRefs(record.sourceRefs, sourceRefs),
    };
}

function refKey(ref: CognitiveSourceRef): string {
    return `${ref.kind}:${ref.id}`;
}
