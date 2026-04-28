export type CrystalReferenceTextToken =
    | { type: 'text'; text: string }
    | { type: 'crystal'; title: string; knowledgeId: string | null };

const MARKER_PATTERN = /@crystal\(([^)\n]+)\)(?:\{kid=([^}\s]+)\})?/g;

function normalizeTitle(rawTitle: string): string {
    const baseTitle = String(rawTitle || '').split('#')[0] || '';
    return baseTitle.replace(/\s+/g, ' ').trim();
}

function normalizeKnowledgeId(value: string | undefined): string | null {
    const normalized = String(value || '').trim();
    return normalized.length > 0 ? normalized : null;
}

export function parseCrystalReferenceText(input: string): CrystalReferenceTextToken[] {
    const value = String(input || '');
    if (!value) return [];

    const tokens: CrystalReferenceTextToken[] = [];
    let lastIndex = 0;
    for (const match of value.matchAll(MARKER_PATTERN)) {
        const index = match.index ?? 0;
        if (index > lastIndex) {
            tokens.push({ type: 'text', text: value.slice(lastIndex, index) });
        }

        const title = normalizeTitle(match[1] || '');
        const knowledgeId = normalizeKnowledgeId(match[2]);
        if (title) {
            tokens.push({ type: 'crystal', title, knowledgeId });
        } else {
            tokens.push({ type: 'text', text: match[0] });
        }
        lastIndex = index + match[0].length;
    }

    if (lastIndex < value.length) {
        tokens.push({ type: 'text', text: value.slice(lastIndex) });
    }
    return tokens;
}

export function sanitizeCrystalReferenceMarkersForDisplay(input: string): string {
    return parseCrystalReferenceText(input)
        .map((token) => (token.type === 'crystal' ? `@${token.title}` : token.text))
        .join('');
}
