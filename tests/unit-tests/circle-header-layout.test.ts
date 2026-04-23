import { strict as assert } from 'node:assert';
import { describe, it } from 'mocha';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';

describe('Circle mobile header layout', () => {
  const pageSource = readFileSync(
    resolve(process.cwd(), 'frontend/src/app/(main)/circles/[id]/page.tsx'),
    'utf8',
  );

  it('renders the identity and summary utility row after the header so it aligns with the full content width', () => {
    const utilityRowIndex = pageSource.indexOf('className={styles.circleMetaUtilityRow}');
    const headerCloseIndex = pageSource.indexOf('</motion.header>');

    assert.notEqual(utilityRowIndex, -1);
    assert.notEqual(headerCloseIndex, -1);
    assert.ok(utilityRowIndex > headerCloseIndex);
    assert.doesNotMatch(pageSource, /styles\.identityProgressCard/);
  });
});
