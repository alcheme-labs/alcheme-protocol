import {
    KNOWLEDGE_RELATIONSHIP_LABEL_MIN_CONFIDENCE,
    type KnowledgeRelationshipCoverageAuditOutput,
    type KnowledgeRelationshipCoverageRecommendation,
    type KnowledgeRelationshipLabelDecision,
} from './types';

export const KNOWLEDGE_RELATIONSHIP_LABEL_CLASSIFIER_RESPONSE_SCHEMA = {
    type: 'object',
    additionalProperties: false,
    required: [
        'labelKey',
        'confidence',
        'shortReason',
        'sourceKnowledgeIds',
        'needsHumanReview',
    ],
    properties: {
        labelKey: { type: 'string' },
        confidence: { type: 'number', minimum: 0, maximum: 1 },
        shortReason: { type: 'string', minLength: 1, maxLength: 360 },
        sourceKnowledgeIds: {
            type: 'array',
            items: { type: 'string' },
            maxItems: 8,
        },
        needsHumanReview: { type: 'boolean' },
        proposedNewLabel: {
            anyOf: [
                { type: 'null' },
                {
                    type: 'object',
                    additionalProperties: false,
                    required: ['key', 'displayName', 'description', 'useCases'],
                    properties: {
                        key: { type: 'string', pattern: '^[a-z][a-z0-9_]{2,47}$' },
                        displayName: { type: 'string', minLength: 1, maxLength: 80 },
                        description: { type: 'string', minLength: 1, maxLength: 360 },
                        useCases: {
                            type: 'array',
                            items: { type: 'string', minLength: 1, maxLength: 180 },
                            minItems: 1,
                            maxItems: 5,
                        },
                    },
                },
            ],
        },
    },
} as const;

export const KNOWLEDGE_RELATIONSHIP_LABEL_COVERAGE_AUDIT_RESPONSE_SCHEMA = {
    type: 'object',
    additionalProperties: false,
    required: ['recommendations', 'coverageSummary', 'needsOperatorReview'],
    properties: {
        recommendations: {
            type: 'array',
            maxItems: 8,
            items: {
                type: 'object',
                additionalProperties: false,
                required: ['action', 'reason', 'confidence'],
                properties: {
                    action: {
                        type: 'string',
                        enum: ['needs_new_label', 'merge', 'rename', 'retire', 'no_change'],
                    },
                    labelKey: { anyOf: [{ type: 'string' }, { type: 'null' }] },
                    proposedLabel: {
                        anyOf: [
                            { type: 'null' },
                            {
                                type: 'object',
                                additionalProperties: false,
                                required: ['key', 'displayName', 'description', 'useCases'],
                                properties: {
                                    key: { type: 'string', pattern: '^[a-z][a-z0-9_]{2,47}$' },
                                    displayName: { type: 'string', minLength: 1, maxLength: 80 },
                                    description: { type: 'string', minLength: 1, maxLength: 360 },
                                    useCases: {
                                        type: 'array',
                                        items: { type: 'string', minLength: 1, maxLength: 180 },
                                        minItems: 1,
                                        maxItems: 5,
                                    },
                                },
                            },
                        ],
                    },
                    reason: { type: 'string', minLength: 1, maxLength: 500 },
                    confidence: { type: 'number', minimum: 0, maximum: 1 },
                },
            },
        },
        coverageSummary: { type: 'string', maxLength: 1000 },
        needsOperatorReview: { type: 'boolean' },
    },
} as const;

export function parseKnowledgeRelationshipLabelDecision(input: {
    rawText: unknown;
    activeLabelKeys: string[];
    allowedSourceKnowledgeIds?: string[];
}): KnowledgeRelationshipLabelDecision {
    const parsed = parseObject(input.rawText);
    const activeLabels = new Set(input.activeLabelKeys);
    const labelKey = normalizeString(parsed.labelKey);
    const confidence = normalizeConfidence(parsed.confidence);
    const proposedNewLabel = normalizeProposedLabel(parsed.proposedNewLabel);
    const sourceKnowledgeIds = normalizeStringArray(parsed.sourceKnowledgeIds)
        .filter((id) => !input.allowedSourceKnowledgeIds || input.allowedSourceKnowledgeIds.includes(id))
        .slice(0, 8);

    if (!labelKey) throw new Error('invalid_model_output');
    if (!activeLabels.has(labelKey) && !proposedNewLabel) {
        throw new Error('invalid_model_output');
    }

    return {
        labelKey,
        confidence,
        shortReason: normalizeString(parsed.shortReason).slice(0, 360) || 'No model reason provided.',
        sourceKnowledgeIds,
        needsHumanReview: Boolean(parsed.needsHumanReview) || !activeLabels.has(labelKey) || confidence < KNOWLEDGE_RELATIONSHIP_LABEL_MIN_CONFIDENCE,
        proposedNewLabel,
    };
}

export function parseKnowledgeRelationshipCoverageAuditOutput(input: {
    rawText: unknown;
    activeLabelKeys: string[];
}): KnowledgeRelationshipCoverageAuditOutput {
    const parsed = parseObject(input.rawText);
    const activeLabels = new Set(input.activeLabelKeys);
    const recommendations = Array.isArray(parsed.recommendations)
        ? parsed.recommendations
            .map((item) => normalizeCoverageRecommendation(item, activeLabels))
            .filter((item): item is KnowledgeRelationshipCoverageRecommendation => Boolean(item))
            .slice(0, 8)
        : [];

    return {
        recommendations,
        coverageSummary: normalizeString(parsed.coverageSummary).slice(0, 1000),
        needsOperatorReview: Boolean(parsed.needsOperatorReview) || recommendations.some((item) => item.action !== 'no_change'),
    };
}

export function buildFallbackKnowledgeRelationshipLabelDecision(reason: string): KnowledgeRelationshipLabelDecision {
    return {
        labelKey: 'original',
        confidence: 0,
        shortReason: reason,
        sourceKnowledgeIds: [],
        needsHumanReview: false,
        proposedNewLabel: null,
    };
}

function normalizeCoverageRecommendation(
    value: unknown,
    activeLabels: Set<string>,
): KnowledgeRelationshipCoverageRecommendation | null {
    if (!value || typeof value !== 'object' || Array.isArray(value)) return null;
    const record = value as Record<string, unknown>;
    const action = normalizeString(record.action) as KnowledgeRelationshipCoverageRecommendation['action'];
    if (!['needs_new_label', 'merge', 'rename', 'retire', 'no_change'].includes(action)) return null;
    const labelKey = normalizeString(record.labelKey) || null;
    if (labelKey && !activeLabels.has(labelKey)) return null;
    const proposedLabel = normalizeProposedLabel(record.proposedLabel);
    if (action === 'needs_new_label' && !proposedLabel) return null;
    return {
        action,
        labelKey,
        proposedLabel,
        reason: normalizeString(record.reason).slice(0, 500) || 'No model reason provided.',
        confidence: normalizeConfidence(record.confidence),
    };
}

function normalizeProposedLabel(value: unknown): KnowledgeRelationshipLabelDecision['proposedNewLabel'] {
    if (!value || typeof value !== 'object' || Array.isArray(value)) return null;
    const record = value as Record<string, unknown>;
    const key = normalizeString(record.key);
    if (!/^[a-z][a-z0-9_]{2,47}$/.test(key)) return null;
    const displayName = normalizeString(record.displayName).slice(0, 80);
    const description = normalizeString(record.description).slice(0, 360);
    const useCases = normalizeStringArray(record.useCases).slice(0, 5);
    if (!displayName || !description || useCases.length === 0) return null;
    return {
        key,
        displayName,
        description,
        useCases,
    };
}

function parseObject(value: unknown): Record<string, unknown> {
    if (value && typeof value === 'object' && !Array.isArray(value)) {
        return value as Record<string, unknown>;
    }
    const text = normalizeString(value);
    if (!text) throw new Error('invalid_model_output');
    try {
        const parsed = JSON.parse(text);
        if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) {
            throw new Error('invalid_model_output');
        }
        return parsed as Record<string, unknown>;
    } catch {
        throw new Error('invalid_model_output');
    }
}

function normalizeConfidence(value: unknown): number {
    const parsed = Number(value);
    if (!Number.isFinite(parsed)) return 0;
    return Math.max(0, Math.min(1, parsed));
}

function normalizeString(value: unknown): string {
    return typeof value === 'string' ? value.trim() : '';
}

function normalizeStringArray(value: unknown): string[] {
    if (!Array.isArray(value)) return [];
    return Array.from(new Set(value.map((item) => normalizeString(item)).filter(Boolean)));
}
