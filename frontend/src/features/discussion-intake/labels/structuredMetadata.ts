export const AUTHOR_ANNOTATION_VALUES = ['fact', 'explanation', 'emotion'] as const;
export const SEMANTIC_FACET_VALUES = [
    'fact',
    'explanation',
    'emotion',
    'question',
    'problem',
    'criteria',
    'proposal',
    'summary',
] as const;

export type AuthorAnnotationKind = (typeof AUTHOR_ANNOTATION_VALUES)[number];
export type SemanticFacet = (typeof SEMANTIC_FACET_VALUES)[number];

export interface StructuredDiscussionMetadataView {
    authorAnnotations: AuthorAnnotationKind[];
    primaryAuthorAnnotation: AuthorAnnotationKind | null;
    focusTag: string | null;
    selectedForCandidate: boolean;
}

function isRecord(value: unknown): value is Record<string, unknown> {
    return Boolean(value) && typeof value === 'object' && !Array.isArray(value);
}

function normalizeAuthorAnnotation(value: unknown): AuthorAnnotationKind | null {
    if (typeof value !== 'string') return null;
    const normalized = value.trim().toLowerCase();
    if (normalized === 'fact' || normalized === 'explanation' || normalized === 'emotion') {
        return normalized;
    }
    return null;
}

function normalizeAuthorAnnotations(value: unknown): AuthorAnnotationKind[] {
    const fallback = normalizeAuthorAnnotation(value);
    if (!Array.isArray(value)) {
        return fallback ? [fallback] : [];
    }
    const seen = new Set<AuthorAnnotationKind>();
    for (const item of value) {
        const annotation = normalizeAuthorAnnotation(item);
        if (!annotation || seen.has(annotation)) continue;
        seen.add(annotation);
    }
    return AUTHOR_ANNOTATION_VALUES.filter((annotation) => seen.has(annotation));
}

export function normalizeSemanticFacets(value: unknown): SemanticFacet[] {
    if (!Array.isArray(value)) return [];
    const seen = new Set<SemanticFacet>();
    for (const item of value) {
        const normalized = String(item || '').trim().toLowerCase();
        if (
            normalized === 'fact'
            || normalized === 'explanation'
            || normalized === 'emotion'
            || normalized === 'question'
            || normalized === 'problem'
            || normalized === 'criteria'
            || normalized === 'proposal'
            || normalized === 'summary'
        ) {
            seen.add(normalized as SemanticFacet);
        }
    }

    return SEMANTIC_FACET_VALUES.filter((facet) => seen.has(facet as SemanticFacet)) as SemanticFacet[];
}

export function extractStructuredDiscussionMetadata(value: unknown): StructuredDiscussionMetadataView {
    if (!isRecord(value)) {
        return {
            authorAnnotations: [],
            primaryAuthorAnnotation: null,
            focusTag: null,
            selectedForCandidate: false,
        };
    }

    const authorAnnotations = normalizeAuthorAnnotations(
        value.authorAnnotations
        ?? value.authorAnnotation
        ?? value.discussionLabels
        ?? value.discussionLabel
        ?? value.label
        ?? null,
    );
    const primaryAuthorAnnotation = normalizeAuthorAnnotation(
        value.primaryAuthorAnnotation
        ?? value.primaryDiscussionLabel
        ?? value.primaryLabel
        ?? null,
    );
    const focusTag = typeof value.focusTag === 'string' && value.focusTag.trim()
        ? value.focusTag.trim().slice(0, 64)
        : null;
    const selectedForCandidate = Boolean(value.selectedForCandidate);

    return {
        authorAnnotations,
        primaryAuthorAnnotation: primaryAuthorAnnotation ?? authorAnnotations[0] ?? null,
        focusTag,
        selectedForCandidate,
    };
}

export function buildStructuredDiscussionMetadata(input: {
    authorAnnotations?: AuthorAnnotationKind[] | null;
    primaryAuthorAnnotation?: AuthorAnnotationKind | null;
    focusTag?: string | null;
    selectedForCandidate?: boolean;
    baseMetadata?: Record<string, unknown> | null;
}): Record<string, unknown> | null {
    const annotations = normalizeAuthorAnnotations(input.authorAnnotations ?? null);
    const primary = normalizeAuthorAnnotation(input.primaryAuthorAnnotation ?? null);
    const fallbackPrimary = primary ?? annotations[0] ?? null;
    const focusTag = typeof input.focusTag === 'string' && input.focusTag.trim()
        ? input.focusTag.trim().slice(0, 64)
        : null;
    const selectedForCandidate = Boolean(input.selectedForCandidate);

    const hasStructuredContent = annotations.length > 0 || fallbackPrimary || focusTag || selectedForCandidate;
    const base = input.baseMetadata && isRecord(input.baseMetadata) ? input.baseMetadata : null;
    if (!hasStructuredContent && !base) return null;

    const next: Record<string, unknown> = base ? { ...base } : {};

    if (annotations.length > 0) {
        next.authorAnnotations = annotations;
    } else {
        delete next.authorAnnotations;
    }

    if (fallbackPrimary) {
        next.primaryAuthorAnnotation = fallbackPrimary;
    } else {
        delete next.primaryAuthorAnnotation;
    }

    if (focusTag) {
        next.focusTag = focusTag;
    } else {
        delete next.focusTag;
    }

    if (selectedForCandidate) {
        next.selectedForCandidate = true;
    } else {
        delete next.selectedForCandidate;
    }

    return Object.keys(next).length > 0 ? next : null;
}
