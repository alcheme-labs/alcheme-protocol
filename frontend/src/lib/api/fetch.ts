import {
  DEFAULT_LOCALE,
  isSupportedLocale,
  LOCALE_COOKIE_NAME,
  REQUEST_LOCALE_HEADER,
  type AppLocale,
} from '../../i18n/config.ts';

type FetchLike = typeof fetch;

interface ApiFetchOptions {
  init?: RequestInit;
  fetchImpl?: FetchLike;
  locale?: AppLocale;
  alchemeApi?: boolean;
}

type ApiFetchInputOptions = ApiFetchOptions | RequestInit;

let activeRequestLocale: AppLocale | null = null;

function normalizeLocale(value: string | null | undefined): AppLocale | null {
  const normalized = String(value || '')
    .trim()
    .toLowerCase()
    .split(/[-_]/)[0];
  return isSupportedLocale(normalized) ? normalized : null;
}

function readLocaleCookie(): AppLocale | null {
  if (typeof document === 'undefined') return null;
  const match = document.cookie.match(new RegExp(`(?:^|; )${LOCALE_COOKIE_NAME}=([^;]+)`));
  if (!match?.[1]) return null;
  try {
    return normalizeLocale(decodeURIComponent(match[1]));
  } catch {
    return normalizeLocale(match[1]);
  }
}

export function setActiveRequestLocale(locale: AppLocale): void {
  activeRequestLocale = locale;
}

export function resolveClientRequestLocale(): AppLocale {
  if (activeRequestLocale && isSupportedLocale(activeRequestLocale)) {
    return activeRequestLocale;
  }

  if (typeof document !== 'undefined') {
    const htmlLocale = normalizeLocale(document.documentElement.lang);
    if (htmlLocale) return htmlLocale;

    const cookieLocale = readLocaleCookie();
    if (cookieLocale) return cookieLocale;
  }

  return DEFAULT_LOCALE;
}

export function withRequestLocaleHeaders(headers?: HeadersInit, locale?: AppLocale): Headers {
  const nextHeaders = new Headers(headers);
  if (!nextHeaders.has(REQUEST_LOCALE_HEADER)) {
    nextHeaders.set(REQUEST_LOCALE_HEADER, locale ?? resolveClientRequestLocale());
  }
  return nextHeaders;
}

export async function apiFetch(
  input: RequestInfo | URL,
  options: ApiFetchInputOptions = {},
): Promise<Response> {
  const normalizedOptions: ApiFetchOptions = 'init' in options
    || 'fetchImpl' in options
    || 'locale' in options
    || 'alchemeApi' in options
    ? options as ApiFetchOptions
    : { init: options as RequestInit };
  const { init, fetchImpl = fetch, locale, alchemeApi = true } = normalizedOptions;
  const nextInit = alchemeApi
    ? {
      ...init,
      headers: withRequestLocaleHeaders(init?.headers, locale),
    }
    : init;

  return fetchImpl(input, nextInit);
}

export async function apiFetchJson<T = any>(
  input: RequestInfo | URL,
  options: ApiFetchInputOptions = {},
): Promise<T> {
  const response = await apiFetch(input, options);
  if (!response.ok) {
    const body = await response.text();
    throw new Error(`${response.status} ${body}`);
  }
  return response.json() as Promise<T>;
}
