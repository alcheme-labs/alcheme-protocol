import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

const source = readFileSync(new URL('../src/lib/api/bindPostToCircle.ts', import.meta.url), 'utf8');

test('bindPostToCircle includes credentials so query-api session cookies are sent', () => {
  assert.match(source, /credentials:\s*['"]include['"]/);
});
