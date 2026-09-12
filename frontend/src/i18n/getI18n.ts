import {getLocale, getTranslations} from 'next-intl/server';

export async function getI18n(namespace?: string) {
  if (namespace) {
    return getTranslations(namespace);
  }

  return getTranslations();
}

export async function getCurrentLocale() {
  return getLocale();
}
