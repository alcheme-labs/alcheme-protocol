import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';

const notificationsPageSource = readFileSync(
  new URL('../src/app/(main)/notifications/page.tsx', import.meta.url),
  'utf8'
);
const notificationsQuerySource = readFileSync(
  new URL('../src/lib/apollo/queries.ts', import.meta.url),
  'utf8'
);
const circlePageSource = readFileSync(
  new URL('../src/app/(main)/circles/[id]/page.tsx', import.meta.url),
  'utf8'
);
const apolloClientSource = readFileSync(
  new URL('../src/lib/apollo/client.ts', import.meta.url),
  'utf8'
);

test('Wave B part 4 localizes the notifications page shell copy', () => {
  assert.match(notificationsPageSource, /useI18n|useTranslations/);
  assert.doesNotMatch(
    notificationsPageSource,
    /通知|全部已读|加载中…|加载通知失败，请稍后重试|暂无通知|刚刚|分钟前|小时前|天前|个月前/
  );
});

test('notifications use locale-aware display fields and forward the locale header to GraphQL', () => {
  assert.match(notificationsPageSource, /displayBody\s*\|\|\s*notification\.displayTitle/);
  assert.match(circlePageSource, /displayBody\s*\|\|\s*n\.displayTitle/);
  assert.doesNotMatch(circlePageSource, /text:\s*n\.body\s*\|\|\s*n\.title/);
  assert.match(notificationsQuerySource, /displayTitle/);
  assert.match(notificationsQuerySource, /displayBody/);
  assert.match(apolloClientSource, /REQUEST_LOCALE_HEADER/);
  assert.match(apolloClientSource, /headers\.set\(REQUEST_LOCALE_HEADER/);
});
