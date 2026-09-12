export const MAX_DRAFT_TITLE_LENGTH = 160;

export function normalizeDraftTitle(value: unknown): string | null {
    if (value == null) return null;
    const normalized = String(value).trim().replace(/\s+/g, ' ');
    if (!normalized || normalized.length > MAX_DRAFT_TITLE_LENGTH) {
        throw new Error('draft_title_invalid');
    }
    return normalized;
}

export function resolveDraftTitle(input: {
    draftTitle: unknown;
    text: unknown;
    draftPostId: number;
}): string {
    const explicit = typeof input.draftTitle === 'string'
        ? input.draftTitle.trim().replace(/\s+/g, ' ')
        : '';
    if (explicit) return explicit.slice(0, MAX_DRAFT_TITLE_LENGTH);
    const firstLine = typeof input.text === 'string'
        ? (input.text.split(/\r?\n/).find((line) => line.trim()) ?? '')
            .trim()
            .replace(/^#{1,6}\s+/, '')
            .replace(/\s+/g, ' ')
        : '';
    return firstLine ? firstLine.slice(0, 80) : `Draft #${input.draftPostId}`;
}
