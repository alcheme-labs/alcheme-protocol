import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';

const feedThreadSheetSource = readFileSync(
  new URL('../src/components/circle/FeedThreadSheet/FeedThreadSheet.tsx', import.meta.url),
  'utf8'
);
const accessProgressBarSource = readFileSync(
  new URL('../src/components/circle/AccessProgressBar/AccessProgressBar.tsx', import.meta.url),
  'utf8'
);

test('Wave C part 3 localizes feed thread sheet copy', () => {
  assert.match(feedThreadSheetSource, /useI18n|useTranslations/);
  assert.doesNotMatch(
    feedThreadSheetSource,
    /动态讨论|围绕这条动态的回复|关闭动态讨论|（无正文）|条回复|还没有回复|先留下第一条回复，让这条动态继续展开。|写下你的回复|连接钱包后可回复|回复会作为该动态的线程内容写入。|当前仅可浏览回复。|发送中|发送回复/
  );
});

test('Wave C part 3 localizes access progress bar copy', () => {
  assert.match(accessProgressBarSource, /useI18n|useTranslations/);
  assert.doesNotMatch(
    accessProgressBarSource,
    /已到达最高层级|晶体|还需 .* 枚进入/
  );
});
