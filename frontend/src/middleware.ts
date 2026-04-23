import {NextResponse, type NextRequest} from 'next/server';
import {REQUEST_LOCALE_HEADER, LOCALE_COOKIE_NAME} from './i18n/config';
import {resolveLocaleFromRequest} from './i18n/resolveLocale';

export function middleware(request: NextRequest) {
  const requestHeaders = new Headers(request.headers);
  const locale = resolveLocaleFromRequest({
    cookieLocale: request.cookies.get(LOCALE_COOKIE_NAME)?.value,
    acceptLanguage: request.headers.get('accept-language')
  });

  requestHeaders.set(REQUEST_LOCALE_HEADER, locale);

  return NextResponse.next({
    request: {
      headers: requestHeaders
    }
  });
}

export const config = {
  matcher: ['/((?!api|_next|.*\\..*).*)']
};
