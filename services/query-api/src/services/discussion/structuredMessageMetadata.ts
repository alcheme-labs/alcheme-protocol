export const AUTHOR_ANNOTATION_KINDS = ['fact', 'explanation', 'emotion'] as const;

export type AuthorAnnotationKind = (typeof AUTHOR_ANNOTATION_KINDS)[number];

export interface StructuredDiscussionMetadata {
    authorAnnotations: AuthorAnnotationKind[];
    primaryAuthorAnnotation: AuthorAnnotationKind | null;
    focusTag: string | null;
    selectedForCandidate: boolean;
}

function normalizeLabel(value: unknown): AuthorAnnotationKind | null {
    if (typeof value !== 'string') return null;
    const normalized = value.trim().toLowerCase();
    if (normalized === 'fact' || normalized === 'explanation' || normalized === 'emotion') {
        return normalized;
    }
    return null;
}

function normalizeLabels(value: unknown): AuthorAnnotationKind[] {
    if (!Array.isArray(value)) {
        const single = normalizeLabel(value);
        return single ? [single] : [];
    }

    const seen = new Set<AuthorAnnotationKind>();
    for (const item of value) {
        const normalized = normalizeLabel(item);
        if (!normalized || seen.has(normalized)) continue;
        seen.add(normalized);
    }

    return AUTHOR_ANNOTATION_KINDS.filter((label) => seen.has(label));
}

function normalizeFocusTag(value: unknown): string | null {
    if (typeof value !== 'string') return null;
    const trimmed = value.trim();
    if (!trimmed) return null;
    return trimmed.slice(0, 64);
}

function isRecord(value: unknown): value is Record<string, unknown> {
    return Boolean(value) && typeof value === 'object' && !Array.isArray(value);
}

export function extractStructuredDiscussionMetadata(input: unknown): StructuredDiscussionMetadata {
    if (!isRecord(input)) {
        return {
            authorAnnotations: [],
            primaryAuthorAnnotation: null,
            focusTag: null,
            selectedForCandidate: false,
        };
    }

    const authorAnnotations = normalizeLabels(
        input.authorAnnotations
        ?? input.authorAnnotation
        ?? input.discussionLabels
        ?? input.discussionLabel
        ?? input.label
        ?? null,
    );
    const primaryAuthorAnnotation = normalizeLabel(
        input.primaryAuthorAnnotation
        ?? input.primaryAuthorTag
        ?? input.primaryDiscussionLabel
        ?? input.primaryLabel
        ?? null,
    ) ?? authorAnnotations[0] ?? null;
    const focusTag = normalizeFocusTag(input.focusTag);
    const selectedForCandidate = Boolean(input.selectedForCandidate);

    return {
        authorAnnotations,
        primaryAuthorAnnotation,
        focusTag,
        selectedForCandidate,
    };
}

export function buildStructuredDiscussionMetadata(input: unknown): Record<string, unknown> | null {
    const parsed = extractStructuredDiscussionMetadata(input);
    if (
        parsed.authorAnnotations.length === 0
        && !parsed.primaryAuthorAnnotation
        && !parsed.focusTag
        && !parsed.selectedForCandidate
    ) {
        return null;
    }

    const next: Record<string, unknown> = {};
    if (parsed.authorAnnotations.length > 0) {
        next.authorAnnotations = parsed.authorAnnotations;
    }
    if (parsed.primaryAuthorAnnotation) {
        next.primaryAuthorAnnotation = parsed.primaryAuthorAnnotation;
    }
    if (parsed.focusTag) {
        next.focusTag = parsed.focusTag;
    }
    if (parsed.selectedForCandidate) {
        next.selectedForCandidate = true;
    }
    return next;
}
