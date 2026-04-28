import { apiFetch } from '@/lib/api/fetch';
import type { AppLocale } from '@/i18n/config';

export async function updatePreferredLocale(locale: AppLocale): Promise<void> {
  const response = await apiFetch('/api/preferences/locale', {
    method: 'POST',
    headers: {
      'content-type': 'application/json',
    },
    body: JSON.stringify({ locale }),
  });

  if (!response.ok) {
    throw new Error(`update preferred locale failed: ${response.status}`);
  }
}
