export interface GhostDraftPatchSuggestionLike {
    targetType: string;
    targetRef: string;
    suggestedText: string;
}

function parseParagraphIndex(targetRef: string): number | null {
    const matched = String(targetRef || '').trim().match(/^paragraph:(\d+)$/i);
    if (!matched) return null;
    const parsed = Number.parseInt(matched[1], 10);
    return Number.isFinite(parsed) && parsed >= 0 ? parsed : null;
}

function replaceParagraphContent(
    content: string,
    paragraphIndex: number,
    nextParagraph: string,
): string {
    const source = String(content || '');
    const paragraphMatches = Array.from(source.matchAll(/[^\r\n]+/g))
        .filter((match) => match[0].trim().length > 0);
    const replacement = String(nextParagraph || '').replace(/\s+$/g, '');
    if (paragraphMatches.length === 0) {
        return replacement;
    }

    const safeIndex = Math.max(0, Math.min(paragraphMatches.length - 1, paragraphIndex));
    const match = paragraphMatches[safeIndex];
    const start = match.index ?? 0;
    const end = start + match[0].length;
    return `${source.slice(0, start)}${replacement}${source.slice(end)}`;
}

export function applyGhostDraftSuggestionToContent(
    currentText: string,
    suggestion: GhostDraftPatchSuggestionLike,
): string {
    const paragraphIndex = parseParagraphIndex(suggestion.targetRef);
    if (String(suggestion.targetType || '').trim().toLowerCase() !== 'paragraph' || paragraphIndex === null) {
        throw new Error('ghost_draft_suggestion_target_unsupported');
    }
    return replaceParagraphContent(currentText, paragraphIndex, suggestion.suggestedText);
}
