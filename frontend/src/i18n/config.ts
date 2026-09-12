export const SUPPORTED_LOCALES = ['zh', 'en', 'es', 'fr'] as const;

export type AppLocale = (typeof SUPPORTED_LOCALES)[number];

export const DEFAULT_LOCALE: AppLocale = 'en';
export const LOCALE_COOKIE_NAME = 'alcheme_locale';
export const REQUEST_LOCALE_HEADER = 'x-alcheme-locale';

export const LOCALE_OPTIONS: ReadonlyArray<{value: AppLocale; label: string}> = [
  {value: 'zh', label: '中文'},
  {value: 'en', label: 'English'},
  {value: 'es', label: 'Español'},
  {value: 'fr', label: 'Français'}
];

export function isSupportedLocale(value: string): value is AppLocale {
  return SUPPORTED_LOCALES.includes(value as AppLocale);
}
