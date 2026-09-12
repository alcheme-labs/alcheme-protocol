'use client';

import {useLocale, useTranslations} from 'next-intl';
import type {AppLocale} from './config';

export function useI18n(namespace?: string) {
  return useTranslations(namespace);
}

export function useCurrentLocale(): AppLocale {
  return useLocale() as AppLocale;
}
