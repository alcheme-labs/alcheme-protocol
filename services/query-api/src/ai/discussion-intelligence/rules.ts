export function normalizeScore01(value: unknown, fallback = 1): number {
    if (typeof value === 'number' && Number.isFinite(value)) {
        return Math.max(0, Math.min(1, value));
    }
    if (typeof value === 'string') {
        const parsed = Number.parseFloat(value);
        if (Number.isFinite(parsed)) {
            return Math.max(0, Math.min(1, parsed));
        }
    }
    return Math.max(0, Math.min(1, fallback));
}

export function hasQuestionSignal(text: string): boolean {
    const normalized = String(text || '').replace(/\s+/g, ' ').trim();
    if (!normalized) return false;
    const patterns = [
        /[?？]/,
        /(为什么|怎么|如何|是否|能否|有没有|要不要|行不行|可不可以|怎么办|是什么|为什么会|怎么做|如何做)/i,
    ];
    return patterns.some((pattern) => pattern.test(normalized));
}

export interface FocusStats {
    focusedCount: number;
    totalCount: number;
    focusedRatio: number;
}

export function computeFocusStats(
    scores: Array<number | null | undefined>,
    focusedThreshold = 0.3,
): FocusStats {
    const normalized = scores.map((score) => normalizeScore01(score, 1));
    const focusedCount = normalized.filter((score) => score >= focusedThreshold).length;
    const totalCount = normalized.length;
    const focusedRatio = totalCount > 0 ? focusedCount / totalCount : 0;
    return {
        focusedCount,
        totalCount,
        focusedRatio,
    };
}
