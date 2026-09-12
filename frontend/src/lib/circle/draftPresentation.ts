import type {
    DraftDiscussionIssueType,
    DraftDiscussionState,
    DraftDiscussionTargetType,
} from '../discussion/api';

type DraftDocumentStatus =
    | 'drafting'
    | 'review'
    | 'crystallization_active'
    | 'crystallization_failed'
    | 'crystallized'
    | 'archived'
    | string;

type DraftSourceKind =
    | 'accepted_candidate_v1_seed'
    | 'review_bound_snapshot'
    | null
    | string;

type DraftSemanticFacet = 'fact' | 'explanation' | 'emotion' | 'question' | 'problem' | 'criteria' | 'proposal' | 'summary';
type DraftAuthorAnnotation = 'fact' | 'explanation' | 'emotion';
type BindingEvidenceStatus = 'ready' | 'warn' | 'error' | string;

export function formatNullableDraftValue(value: string | null | undefined, fallback = 'Not provided'): string {
    const normalized = String(value || '').trim();
    return normalized || fallback;
}

export function formatCrucibleDocumentStatus(status: DraftDocumentStatus): string {
    if (status === 'drafting') return 'Drafting';
    if (status === 'review') return 'In review';
    if (status === 'crystallization_active') return 'Crystallization active';
    if (status === 'crystallization_failed') return 'Crystallization incomplete';
    if (status === 'crystallized') return 'Crystallized';
    if (status === 'archived') return 'Archived';
    return 'Draft in progress';
}

export function formatCrucibleDocumentStatusHint(status: DraftDocumentStatus): string {
    if (status === 'drafting') return 'This revision is based on the stable version, and you can keep improving the body.';
    if (status === 'review') return 'The current version is locked, so the body cannot be edited directly right now.';
    if (status === 'crystallization_active') return 'This version is waiting on governance outcome and is not accepting new ordinary revisions.';
    if (status === 'crystallization_failed') return 'Crystallization did not complete. You can retry it or return to review.';
    if (status === 'crystallized') return 'This draft has crystallized successfully and can be viewed as the current result.';
    return 'This draft is still advancing along the current revision chain.';
}

export function formatDraftSourceKind(value: DraftSourceKind): string {
    if (value === null) return 'Source unavailable';
    if (value === 'accepted_candidate_v1_seed') return 'First stable version generated from the accepted candidate';
    if (value === 'review_bound_snapshot') return 'Stable version created after review lock';
    return 'Source pending confirmation';
}

export function formatSemanticFacets(labels: DraftSemanticFacet[]): string {
    if (labels.length === 0) return 'None detected';
    return labels.map((label) => {
        if (label === 'fact') return 'Fact';
        if (label === 'explanation') return 'Explanation';
        if (label === 'emotion') return 'Emotion';
        if (label === 'question') return 'Question';
        if (label === 'problem') return 'Problem';
        if (label === 'criteria') return 'Criteria';
        if (label === 'proposal') return 'Proposal';
        return 'Summary';
    }).join(' / ');
}

export function formatAuthorAnnotations(labels: DraftAuthorAnnotation[]): string {
    if (labels.length === 0) return 'None';
    return labels.map((label) => {
        if (label === 'fact') return 'Fact';
        if (label === 'explanation') return 'Explanation';
        return 'Emotion';
    }).join(' / ');
}

export function formatDraftDiscussionState(state: DraftDiscussionState): string {
    if (state === 'open') return 'Submitted';
    if (state === 'proposed') return 'In review';
    if (state === 'accepted') return 'Accepted';
    if (state === 'rejected') return 'Rejected';
    if (state === 'withdrawn') return 'Withdrawn';
    return 'Resolved';
}

export function formatDraftDiscussionIssueType(type: DraftDiscussionIssueType | null | undefined): string {
    if (type === 'fact_correction') return 'Fact correction';
    if (type === 'expression_improvement') return 'Expression improvement';
    if (type === 'knowledge_supplement') return 'Knowledge supplement';
    if (type === 'question_and_supplement') return 'Question and supplement';
    return 'Issue';
}

export function formatDraftDiscussionTargetType(type: DraftDiscussionTargetType): string {
    if (type === 'paragraph') return 'Paragraph';
    if (type === 'structure') return 'Structure';
    return 'Document';
}

export function formatDraftDiscussionTargetLabel(
    targetType: DraftDiscussionTargetType,
    targetRef: string | null | undefined,
): string {
    const normalizedRef = String(targetRef || '').trim();
    if (targetType === 'paragraph') {
        const matched = normalizedRef.match(/^paragraph:(\d+)$/i);
        if (matched) {
            const parsed = Number.parseInt(matched[1], 10);
            if (Number.isFinite(parsed) && parsed >= 0) {
                return `Paragraph ${parsed + 1}`;
            }
        }
        return normalizedRef ? `Paragraph · ${normalizedRef}` : 'Paragraph';
    }

    if (targetType === 'structure') {
        const paragraphMatches = Array.from(
            normalizedRef.matchAll(/paragraph:(\d+)/gi),
            (match) => Number.parseInt(match[1], 10),
        ).filter((value) => Number.isFinite(value) && value >= 0);

        if (paragraphMatches.length > 0) {
            const paragraphLabel = paragraphMatches
                .map((value) => String(value + 1))
                .join('、');
            return `Structure · paragraphs ${paragraphLabel}`;
        }
    }

    if (targetType === 'document') {
        return 'Document';
    }

    const targetTypeLabel = formatDraftDiscussionTargetType(targetType);
    return normalizedRef ? `${targetTypeLabel} · ${normalizedRef}` : targetTypeLabel;
}

export function formatSeededReferenceLabel(
    input: string | { path: string; line: number; fileName?: string | null },
): string {
    const value = typeof input === 'string'
        ? input
        : `@file:${input.path}:${input.line}`;
    const matched = String(value || '').trim().match(/^@file:([A-Za-z0-9._/-]+):([1-9]\d*)$/);
    if (!matched) return String(value || '').trim() || '@file';

    const fileName = typeof input === 'string'
        ? matched[1].split('/').pop() || matched[1]
        : String(input.fileName || '').trim() || matched[1].split('/').pop() || matched[1];
    return `@file ${fileName}:${matched[2]}`;
}

export function formatBindingEvidenceStatus(status: BindingEvidenceStatus): string {
    if (status === 'ready') return 'Ready';
    if (status === 'warn') return 'Needs review';
    if (status === 'error') return 'Incomplete';
    return 'Processing';
}

export function formatDraftLifecycleWarning(warning: string): string {
    if (warning === 'draft source handoff is missing; treating candidate source as unavailable for this draft') {
        return 'This draft is missing its original source record for now, so the source is shown as unavailable. Editing and review are not blocked.';
    }
    if (
        warning
        === 'v1 seed snapshot is missing draft anchor evidence; current stable snapshot currently relies on accepted handoff metadata only'
    ) {
        return 'The current review baseline is missing draft-anchor evidence, so it temporarily relies on the recorded draft source instead.';
    }
    if (
        warning
        === 'draft discussion application evidence uses legacy appliedDraftVersion values; treating thread.targetVersion as stable snapshot binding truth'
    ) {
        return 'Some historical issue application records are still being normalized, so the bound issue version is used for review progress right now.';
    }
    if (
        warning
        === 'current stable snapshot version has no applied review evidence yet; using thread.targetVersion binding only'
    ) {
        return 'The current review baseline still lacks complete application evidence, so the bound version is shown for now.';
    }
    return warning || 'This draft still has one unresolved detail.';
}
