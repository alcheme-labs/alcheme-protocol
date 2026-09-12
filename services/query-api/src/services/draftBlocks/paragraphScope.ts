export type ParagraphScopeErrorCode =
    | 'invalid_draft_paragraph_scope'
    | 'draft_working_copy_conflict'
    | 'draft_paragraph_count_changed'
    | 'draft_paragraph_scope_exceeded'
    | 'draft_paragraph_empty';

export type ParagraphScopeValidationResult =
    | {
        ok: true;
        paragraphIndex: number;
    }
    | {
        ok: false;
        code: ParagraphScopeErrorCode;
        message: string;
    };

interface DraftParagraphSpan {
    start: number;
    end: number;
    content: string;
}

function resolveDraftParagraphSpans(content: string): DraftParagraphSpan[] {
    const source = String(content || '');
    const spans = Array.from(source.matchAll(/[^\n]+/g)).flatMap((match) => {
        const rawLine = String(match[0] || '');
        const contentEnd = rawLine.endsWith('\r') ? rawLine.length - 1 : rawLine.length;
        const contentValue = rawLine.slice(0, contentEnd).trim();
        if (!contentValue) return [];
        const start = match.index ?? 0;
        return [{
            start,
            end: start + contentEnd,
            content: contentValue,
        }];
    });
    return spans.length > 0
        ? spans
        : [{ start: 0, end: source.length, content: '' }];
}

export function splitDraftParagraphs(content: string): string[] {
    const paragraphs = resolveDraftParagraphSpans(content)
        .map((span) => span.content.replace(/\s+/g, ' '));
    return paragraphs.length > 0 ? paragraphs : [''];
}

export function parseParagraphBlockId(blockId: string): number | null {
    const matched = String(blockId || '').trim().match(/^paragraph:(\d+)$/);
    if (!matched) return null;
    const parsed = Number.parseInt(matched[1], 10);
    return Number.isInteger(parsed) && parsed >= 0 ? parsed : null;
}

export function validateScopedParagraphEdit(input: {
    blockId: string;
    currentText: string;
    nextText: string;
    baseWorkingCopyHash: string | null | undefined;
    currentWorkingCopyHash: string;
}): ParagraphScopeValidationResult {
    const paragraphIndex = parseParagraphBlockId(input.blockId);
    if (paragraphIndex === null) {
        return {
            ok: false,
            code: 'invalid_draft_paragraph_scope',
            message: 'invalid paragraph edit scope',
        };
    }

    const baseHash = typeof input.baseWorkingCopyHash === 'string'
        ? input.baseWorkingCopyHash.trim()
        : '';
    if (!baseHash || baseHash !== input.currentWorkingCopyHash) {
        return {
            ok: false,
            code: 'draft_working_copy_conflict',
            message: 'draft content changed; refresh before saving',
        };
    }

    const currentParagraphs = resolveDraftParagraphSpans(input.currentText);
    const nextParagraphs = resolveDraftParagraphSpans(input.nextText);
    if (
        paragraphIndex >= currentParagraphs.length
        || paragraphIndex >= nextParagraphs.length
    ) {
        return {
            ok: false,
            code: 'invalid_draft_paragraph_scope',
            message: 'paragraph edit scope does not exist',
        };
    }

    if (currentParagraphs.length !== nextParagraphs.length) {
        return {
            ok: false,
            code: 'draft_paragraph_count_changed',
            message: 'paragraph scoped edit cannot add or remove paragraphs',
        };
    }

    if (!nextParagraphs[paragraphIndex]?.content) {
        return {
            ok: false,
            code: 'draft_paragraph_empty',
            message: 'target paragraph cannot be empty',
        };
    }

    const currentTarget = currentParagraphs[paragraphIndex];
    const nextTarget = nextParagraphs[paragraphIndex];
    const changedOutsideTarget =
        input.currentText.slice(0, currentTarget.start) !== input.nextText.slice(0, nextTarget.start)
        || input.currentText.slice(currentTarget.end) !== input.nextText.slice(nextTarget.end);
    if (changedOutsideTarget) {
        return {
            ok: false,
            code: 'draft_paragraph_scope_exceeded',
            message: 'edit changed content outside the requested paragraph',
        };
    }

    return {
        ok: true,
        paragraphIndex,
    };
}
