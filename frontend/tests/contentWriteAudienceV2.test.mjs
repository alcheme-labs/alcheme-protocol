import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

const createContentSource = readFileSync(new URL('../src/hooks/useCreateContent.ts', import.meta.url), 'utf8');

test('Task7 RED: createContent keeps raw CircleOnly audience instead of collapsing it to Private', () => {
  assert.doesNotMatch(
    createContentSource,
    /options\.visibility === 'Private' \|\| options\.visibility === 'CircleOnly'/,
  );
  assert.match(createContentSource, /options\.visibility === 'CircleOnly'/);
});

test('Task7 RED: createContent passes protocolCircleId into v2 create path', () => {
  assert.match(createContentSource, /protocolCircleId/);
});
