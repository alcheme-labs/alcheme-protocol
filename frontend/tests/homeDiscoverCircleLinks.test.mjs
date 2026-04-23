import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';

const homePageSource = readFileSync(
  new URL('../src/app/(main)/home/page.tsx', import.meta.url),
  'utf8',
);

test('home discover circle cards are direct links into circle detail pages', () => {
  assert.match(
    homePageSource,
    /<Link\s+key=\{circle\.id\}\s+href=\{`\/circles\/\$\{circle\.id\}`\}\s+className=\{styles\.cardLink\}>/,
  );
  assert.match(homePageSource, /<Card state="ore">[\s\S]*?<h3 className=\{styles\.cardTitle\}>\{circle\.name\}<\/h3>/);
});
