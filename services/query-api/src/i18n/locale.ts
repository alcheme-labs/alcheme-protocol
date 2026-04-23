export const SUPPORTED_LOCALES = ['zh', 'en', 'es', 'fr'] as const;

export type AppLocale = (typeof SUPPORTED_LOCALES)[number];

export const DEFAULT_LOCALE: AppLocale = 'en';

export function isSupportedLocale(value: string): value is AppLocale {
    return SUPPORTED_LOCALES.includes(value as AppLocale);
}

export function normalizeLocale(value: string | null | undefined): AppLocale | null {
    const normalized = String(value || '')
        .trim()
        .toLowerCase()
        .split(/[-_]/)[0];

    if (!normalized) return null;
    return isSupportedLocale(normalized) ? normalized : null;
}

export function resolveRequestLocale(input: {
    requestedLocale?: string | string[] | null;
    acceptLanguage?: string | string[] | null;
}): AppLocale {
    const requested = Array.isArray(input.requestedLocale)
        ? input.requestedLocale[0]
        : input.requestedLocale;
    const normalizedRequested = normalizeLocale(requested);
    if (normalizedRequested) {
        return normalizedRequested;
    }

    const acceptLanguage = Array.isArray(input.acceptLanguage)
        ? input.acceptLanguage.join(',')
        : input.acceptLanguage;

    const candidates = String(acceptLanguage || '')
        .split(',')
        .map((part) => part.split(';')[0]?.trim())
        .filter(Boolean);

    for (const candidate of candidates) {
        const normalized = normalizeLocale(candidate);
        if (normalized) {
            return normalized;
        }
    }

    return DEFAULT_LOCALE;
}
