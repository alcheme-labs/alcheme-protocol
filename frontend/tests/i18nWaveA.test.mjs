import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';

const bottomNavSource = readFileSync(
  new URL('../src/components/layout/BottomNav/BottomNav.tsx', import.meta.url),
  'utf8'
);
const connectPageSource = readFileSync(
  new URL('../src/app/(auth)/connect/page.tsx', import.meta.url),
  'utf8'
);
const homePageSource = readFileSync(
  new URL('../src/app/(main)/home/page.tsx', import.meta.url),
  'utf8'
);
const composePageSource = readFileSync(
  new URL('../src/app/(main)/compose/page.tsx', import.meta.url),
  'utf8'
);
const registerIdentitySheetSource = readFileSync(
  new URL('../src/components/auth/RegisterIdentitySheet/RegisterIdentitySheet.tsx', import.meta.url),
  'utf8'
);
const identityRegistrationEntrySource = readFileSync(
  new URL('../src/components/auth/IdentityRegistrationEntry/IdentityRegistrationEntry.tsx', import.meta.url),
  'utf8'
);
const landingPageSource = readFileSync(
  new URL('../src/app/page.tsx', import.meta.url),
  'utf8'
);
const heatGaugeSource = readFileSync(
  new URL('../src/alchemy/HeatGauge.tsx', import.meta.url),
  'utf8'
);

test('Wave A shared shell components read labels from i18n instead of hardcoded nav copy', () => {
  assert.match(bottomNavSource, /useI18n|useTranslations/);
  assert.doesNotMatch(bottomNavSource, /'首页'|'圈层'|'发布'|'通知'|'我的'/);
  assert.match(identityRegistrationEntrySource, /useI18n|useTranslations/);
  assert.doesNotMatch(identityRegistrationEntrySource, /链上身份|创建身份/);
  assert.match(heatGaugeSource, /useI18n|useTranslations/);
});

test('connect and landing pages bind visible copy through the i18n layer', () => {
  assert.match(connectPageSource, /useI18n|useTranslations/);
  assert.doesNotMatch(connectPageSource, /连接钱包|创建身份|归位|支持 Phantom/);
  assert.match(landingPageSource, /useI18n|useTranslations/);
  assert.doesNotMatch(landingPageSource, /Turn noise into gold/);
});

test('home page reads reminders, flow tabs and section titles from i18n', () => {
  assert.match(homePageSource, /useI18n|useTranslations/);
  assert.doesNotMatch(homePageSource, /继续你的思考|公共流|关注流|发现圈层|暂无精选讨论|暂无结晶内容|暂无圈层/);
});

test('compose page and registration sheet read publishing copy from i18n', () => {
  assert.match(composePageSource, /useI18n|useTranslations/);
  assert.doesNotMatch(composePageSource, /发布观点|还没有可发布的圈层|当前状态|动态|草稿|写下你的想法/);
  assert.match(registerIdentitySheetSource, /useI18n|useTranslations/);
  assert.doesNotMatch(registerIdentitySheetSource, /创建链上身份|创建身份并加入圈层|身份 handle|例如 alice_01|关闭/);
});
