export interface KnowledgeReferenceOption {
    knowledgeId: string;
    onChainAddress: string;
    title: string;
    version: number;
}

interface KnowledgeReferenceLike {
    knowledgeId?: string | null;
    onChainAddress?: string | null;
    title?: string | null;
    version?: number | null;
}

function normalizeTitle(title: string | null | undefined): string {
    return String(title || '').replace(/\s+/g, ' ').trim();
}

function isParserSafeTitle(rawTitle: string | null | undefined, normalizedTitle: string): boolean {
    return normalizedTitle.length > 0 && !/[#)\n]/.test(String(rawTitle || ''));
}

export function buildKnowledgeReferenceOptions(
    knowledgeItems: KnowledgeReferenceLike[],
): KnowledgeReferenceOption[] {
    const normalizedItems = (knowledgeItems || [])
        .map((item) => {
            const rawTitle = String(item?.title || '');
            const title = normalizeTitle(rawTitle);
            return {
                knowledgeId: String(item?.knowledgeId || '').trim(),
                onChainAddress: String(item?.onChainAddress || '').trim(),
                rawTitle,
                title,
                version: Number.isFinite(Number(item?.version ?? 0)) ? Number(item?.version ?? 0) : 0,
            };
        })
        .filter((item) => item.knowledgeId && item.title && isParserSafeTitle(item.rawTitle, item.title));

    const titleCounts = new Map<string, number>();
    for (const item of normalizedItems) {
        titleCounts.set(item.title, (titleCounts.get(item.title) || 0) + 1);
    }

    return normalizedItems
        .filter((item) => titleCounts.get(item.title) === 1)
        .sort((left, right) => left.title.localeCompare(right.title, 'en'));
}

export function formatCrystalReferenceMarkup(option: Pick<KnowledgeReferenceOption, 'title'>): string {
    return `@crystal(${normalizeTitle(option.title)})`;
}

export function filterKnowledgeReferenceOptions(
    options: KnowledgeReferenceOption[],
    rawQuery: string,
): KnowledgeReferenceOption[] {
    const query = String(rawQuery || '').trim().toLowerCase();
    if (!query) return [...(options || [])];
    return (options || []).filter((option) => option.title.toLowerCase().includes(query));
}
