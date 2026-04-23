import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';

const createCircleSheetSource = readFileSync(
  new URL('../src/components/circle/CreateCircleSheet/CreateCircleSheet.tsx', import.meta.url),
  'utf8'
);

test('Wave B part 2 localizes create circle sheet shell copy', () => {
  assert.match(createCircleSheetSource, /useI18n|useTranslations/);
  assert.doesNotMatch(
    createCircleSheetSource,
    /创建新圈层|基本信息|圈层模式|准入设置|确认创建|圈层名称|简介（可选）|搜索圈层|创建中\.\.\.|下一步|取消/
  );
});
