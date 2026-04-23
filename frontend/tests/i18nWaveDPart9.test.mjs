import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';

const circlePickerSource = readFileSync(
  new URL('../src/components/circle/CirclePicker/CirclePicker.tsx', import.meta.url),
  'utf8'
);
const tierPillSource = readFileSync(
  new URL('../src/components/circle/TierPill/TierPill.tsx', import.meta.url),
  'utf8'
);

test('Wave D part 9 removes the remaining raw level labels from picker surfaces', () => {
  assert.match(circlePickerSource, /useI18n|useTranslations/);
  assert.match(tierPillSource, /useI18n|useTranslations/);

  assert.doesNotMatch(
    circlePickerSource,
    /Lv\.\{c\.level\}/
  );
  assert.doesNotMatch(
    tierPillSource,
    /Lv\.\{sc\.level\}|Lv\.\{sc\.level\}\.\{childIdx \+ 1\}/
  );
});
