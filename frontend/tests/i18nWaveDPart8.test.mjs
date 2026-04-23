import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';

const plazaTabSource = readFileSync(
  new URL('../src/components/circle/PlazaTab/PlazaTab.tsx', import.meta.url),
  'utf8'
);
const composePageSource = readFileSync(
  new URL('../src/app/(main)/compose/page.tsx', import.meta.url),
  'utf8'
);
const createCircleSheetSource = readFileSync(
  new URL('../src/components/circle/CreateCircleSheet/CreateCircleSheet.tsx', import.meta.url),
  'utf8'
);

test('Wave D part 8 localizes the remaining forward-card and compose level labels', () => {
  assert.match(plazaTabSource, /useI18n|useTranslations/);
  assert.match(composePageSource, /useI18n|useTranslations/);

  assert.doesNotMatch(
    plazaTabSource,
    /` · Lv\.\$\{msg\.forwardCard\.sourceLevel\}`|\|\| 'unknown'/
  );
  assert.doesNotMatch(
    composePageSource,
    /Lv\.\{item\.level\}/
  );
});

test('Wave D part 8 uses locale-aware seeded file list formatting', () => {
  assert.match(createCircleSheetSource, /useCurrentLocale/);
  assert.match(createCircleSheetSource, /Intl\.ListFormat/);
  assert.doesNotMatch(
    createCircleSheetSource,
    /\.join\('、'\)/
  );
});
