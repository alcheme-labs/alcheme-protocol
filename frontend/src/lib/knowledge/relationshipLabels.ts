import type {
    GQLCrystallizationOutputSummary,
    GQLKnowledgeRelationshipAssignment,
    GQLKnowledgeRelationshipLabel,
} from '../apollo/types';

export interface KnowledgeRelationshipLabelView {
    key: string;
    displayName: string;
    description: string;
    useCases: string[];
    example: string | null;
    status: string;
    source: string;
    sortOrder: number;
}

export interface KnowledgeRelationshipAssignmentView {
    knowledgeId: string;
    labelKey: string;
    label: KnowledgeRelationshipLabelView;
    sourceKnowledgeIds: string[];
    sourceDraftId: string | null;
    assignedBy: string;
    confidence: number | null;
}

export const RELATIONSHIP_LABEL_PENDING_TEXT = '标签待确认 / Label pending';

function normalizeString(value: unknown): string | null {
    return typeof value === 'string' && value.trim().length > 0 ? value.trim() : null;
}

function normalizeStringList(value: unknown): string[] {
    return Array.isArray(value)
        ? value.filter((item): item is string => typeof item === 'string' && item.trim().length > 0)
        : [];
}

export function toRelationshipLabelView(
    label: GQLKnowledgeRelationshipLabel | null | undefined,
): KnowledgeRelationshipLabelView {
    return {
        key: normalizeString(label?.key) ?? 'pending',
        displayName: normalizeString(label?.displayName) ?? RELATIONSHIP_LABEL_PENDING_TEXT,
        description: normalizeString(label?.description) ?? '',
        useCases: normalizeStringList(label?.useCases),
        example: normalizeString(label?.example) ?? null,
        status: normalizeString(label?.status) ?? 'unknown',
        source: normalizeString(label?.source) ?? 'unknown',
        sortOrder: Number.isFinite(Number(label?.sortOrder)) ? Number(label?.sortOrder) : 0,
    };
}

export function toRelationshipAssignmentView(
    assignment: GQLKnowledgeRelationshipAssignment | null | undefined,
): KnowledgeRelationshipAssignmentView {
    const label = toRelationshipLabelView(assignment?.label);
    return {
        knowledgeId: normalizeString(assignment?.knowledgeId) ?? '',
        labelKey: normalizeString(assignment?.labelKey) ?? label.key,
        label,
        sourceKnowledgeIds: normalizeStringList(assignment?.sourceKnowledgeIds),
        sourceDraftId: normalizeString(assignment?.sourceDraftId),
        assignedBy: normalizeString(assignment?.assignedBy) ?? 'unknown',
        confidence: Number.isFinite(Number(assignment?.confidence)) ? Number(assignment?.confidence) : null,
    };
}

export function formatRelationshipLabel(
    assignment: GQLKnowledgeRelationshipAssignment | KnowledgeRelationshipAssignmentView | null | undefined,
): string {
    const label = 'label' in (assignment ?? {}) ? (assignment as any).label : null;
    return normalizeString(label?.displayName) ?? RELATIONSHIP_LABEL_PENDING_TEXT;
}

export function formatSourceDraftVersionLabel(
    version: number | null | undefined,
    locale: 'en' | 'zh' | 'es' | 'fr' = 'en',
): string | null {
    const parsed = Number(version);
    if (!Number.isInteger(parsed) || parsed <= 0) return null;
    if (locale === 'zh') return `来源草稿版本 v${parsed}`;
    if (locale === 'es') return `Versión del borrador de origen v${parsed}`;
    if (locale === 'fr') return `Version du brouillon source v${parsed}`;
    return `Source draft version v${parsed}`;
}

export function formatInternalRecordVersionLabel(
    version: number | null | undefined,
    locale: 'en' | 'zh' | 'es' | 'fr' = 'en',
): string | null {
    const parsed = Number(version);
    if (!Number.isInteger(parsed) || parsed <= 0) return null;
    if (locale === 'zh') return `内部记录版本 ${parsed}`;
    if (locale === 'es') return `Versión interna de registro ${parsed}`;
    if (locale === 'fr') return `Version interne du dossier ${parsed}`;
    return `Internal record version ${parsed}`;
}

export function resolveSourceDraftVersionLabel(
    output: GQLCrystallizationOutputSummary | null | undefined,
): string | null {
    return normalizeString(output?.sourceDraftVersionLabel)
        ?? formatSourceDraftVersionLabel(output?.sourceDraftVersion ?? null);
}
