import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';

const circlesPageSource = readFileSync(
  new URL('../src/app/(main)/circles/page.tsx', import.meta.url),
  'utf8'
);

test('Wave B part 1 localizes the circles list page shell copy', () => {
  assert.match(circlesPageSource, /useI18n|useTranslations/);
  assert.doesNotMatch(
    circlesPageSource,
    /圈层|找到你的知识领地|创建新圈层|搜索圈层\.\.\.|没有找到匹配的圈层|暂无描述|同时在内容中找到了/
  );
});
