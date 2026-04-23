import {cookies, headers} from 'next/headers';
import {getRequestConfig} from 'next-intl/server';
import {
  LOCALE_COOKIE_NAME,
  REQUEST_LOCALE_HEADER
} from './config';
import {resolveLocaleFromRequest} from './resolveLocale';

export default getRequestConfig(async () => {
  const cookieStore = await cookies();
  const headerStore = await headers();

  const locale = resolveLocaleFromRequest({
    cookieLocale: cookieStore.get(LOCALE_COOKIE_NAME)?.value,
    requestLocaleHeader: headerStore.get(REQUEST_LOCALE_HEADER),
    acceptLanguage: headerStore.get('accept-language')
  });

  return {
    locale,
    messages: (await import(`./messages/${locale}.json`)).default
  };
});
