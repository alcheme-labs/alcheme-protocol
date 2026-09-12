export interface KnowledgeReferenceInsertionResult {
    nextValue: string;
    nextSelectionStart: number;
    nextSelectionEnd: number;
}

export interface KnowledgeReferenceInsertionSlice {
    insertedText: string;
    cursorOffset: number;
}

export interface ActiveKnowledgeReferenceQuery {
    token: string;
    query: string;
}

function needsLeadingSpace(beforeText: string): boolean {
    if (!beforeText) return false;
    return !/\s$/.test(beforeText);
}

function needsTrailingSpace(afterText: string): boolean {
    if (!afterText) return true;
    return !/^\s/.test(afterText);
}

export function buildKnowledgeReferenceInsertion(
    beforeText: string,
    afterText: string,
    markup: string,
): KnowledgeReferenceInsertionSlice {
    const leadingSpace = needsLeadingSpace(beforeText) ? ' ' : '';
    const trailingSpace = needsTrailingSpace(afterText) ? ' ' : '';
    const insertedText = `${leadingSpace}${markup}${trailingSpace}`;

    return {
        insertedText,
        cursorOffset: insertedText.length,
    };
}

export function insertKnowledgeReferenceMarkup(
    text: string,
    selectionStart: number,
    selectionEnd: number,
    markup: string,
): KnowledgeReferenceInsertionResult {
    const safeText = String(text || '');
    const start = Math.max(0, Math.min(selectionStart, safeText.length));
    const end = Math.max(start, Math.min(selectionEnd, safeText.length));
    const before = safeText.slice(0, start);
    const after = safeText.slice(end);
    const insertion = buildKnowledgeReferenceInsertion(before, after, markup);
    const nextValue = `${before}${insertion.insertedText}${after}`;
    const nextSelection = before.length + insertion.cursorOffset;

    return {
        nextValue,
        nextSelectionStart: nextSelection,
        nextSelectionEnd: nextSelection,
    };
}

export function detectActiveKnowledgeReferenceQuery(textBeforeCursor: string): ActiveKnowledgeReferenceQuery | null {
    const match = String(textBeforeCursor || '').match(/(?:^|[\s([{'"“‘])(@([^\s@()]*)?)$/u);
    if (!match) return null;
    return {
        token: match[1],
        query: match[2] || '',
    };
}
