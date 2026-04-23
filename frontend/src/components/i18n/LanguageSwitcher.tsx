'use client';

import {useEffect, useState, useTransition} from 'react';
import {useRouter} from 'next/navigation';
import {useI18n, useCurrentLocale} from '@/i18n/useI18n';
import {LOCALE_OPTIONS, type AppLocale} from '@/i18n/config';
import styles from './LanguageSwitcher.module.css';

export function LanguageSwitcher() {
  const t = useI18n('LanguageSwitcher');
  const locale = useCurrentLocale();
  const router = useRouter();
  const [isPending, startTransition] = useTransition();
  const [selectedLocale, setSelectedLocale] = useState(locale);

  useEffect(() => {
    setSelectedLocale(locale);
  }, [locale]);

  async function handleChange(nextLocale: AppLocale) {
    setSelectedLocale(nextLocale);

    const response = await fetch('/api/preferences/locale', {
      method: 'POST',
      headers: {
        'content-type': 'application/json'
      },
      body: JSON.stringify({locale: nextLocale})
    });

    if (!response.ok) {
      setSelectedLocale(locale);
      return;
    }

    startTransition(() => {
      router.refresh();
    });
  }

  return (
    <div className={styles.shell}>
      <span className={styles.label}>{t('label')}</span>
      <select
        className={styles.select}
        aria-label={t('ariaLabel')}
        value={selectedLocale}
        onChange={(event) => handleChange(event.target.value as AppLocale)}
        disabled={isPending}
      >
        {LOCALE_OPTIONS.map(option => (
          <option key={option.value} value={option.value}>
            {t(`options.${option.value}`)}
          </option>
        ))}
      </select>
    </div>
  );
}
