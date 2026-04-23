import {
  DEFAULT_LOCALE,
  isSupportedLocale,
  type AppLocale
} from './config';

const REGION_TO_LOCALE: Record<string, AppLocale> = {
  'zh-cn': 'zh',
  'zh-tw': 'zh',
  'zh-hk': 'zh',
  'en-us': 'en',
  'en-gb': 'en',
  'en-ca': 'en',
  'es-es': 'es',
  'es-mx': 'es',
  'fr-fr': 'fr',
  'fr-ca': 'fr',
  'ar-sa': 'en',
  'ar-eg': 'en'
};

function matchLocaleCandidate(input: string | null | undefined): AppLocale | null {
  if (!input) return null;

  const normalized = input.trim().toLowerCase();
  if (!normalized) return null;

  const direct = REGION_TO_LOCALE[normalized];
  if (direct) return direct;
  if (isSupportedLocale(normalized)) return normalized;

  const base = normalized.split('-')[0];
  if (isSupportedLocale(base)) return base;

  return null;
}

export function resolveLocale(input: string | null | undefined): AppLocale {
  return matchLocaleCandidate(input) ?? DEFAULT_LOCALE;
}

export function parseAcceptLanguage(input: string | null | undefined): string[] {
  if (!input) return [];

  return input
    .split(',')
    .map(part => part.split(';')[0]?.trim())
    .filter((value): value is string => Boolean(value));
}

export function resolveLocaleFromRequest({
  cookieLocale,
  requestLocaleHeader,
  acceptLanguage
}: {
  cookieLocale?: string | null;
  requestLocaleHeader?: string | null;
  acceptLanguage?: string | null;
}): AppLocale {
  const orderedCandidates = [
    cookieLocale,
    requestLocaleHeader,
    ...parseAcceptLanguage(acceptLanguage)
  ];

  for (const candidate of orderedCandidates) {
    const matched = matchLocaleCandidate(candidate);
    if (matched) return matched;
  }

  return DEFAULT_LOCALE;
}
