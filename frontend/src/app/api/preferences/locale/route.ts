import {NextResponse} from 'next/server';
import {
  LOCALE_COOKIE_NAME,
  SUPPORTED_LOCALES,
  type AppLocale
} from '@/i18n/config';

export async function POST(request: Request) {
  const payload = await request.json().catch(() => null);
  const locale = payload?.locale;

  if (!SUPPORTED_LOCALES.includes(locale as AppLocale)) {
    return NextResponse.json(
      {error: 'invalid_locale'},
      {status: 400}
    );
  }

  const response = NextResponse.json({ok: true, locale});
  response.cookies.set(LOCALE_COOKIE_NAME, locale, {
    path: '/',
    sameSite: 'lax',
    maxAge: 60 * 60 * 24 * 365
  });

  return response;
}
