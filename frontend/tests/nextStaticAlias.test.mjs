import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

const nextConfigSource = readFileSync(
  new URL('../next.config.ts', import.meta.url),
  'utf8',
);

test('next dev config aliases broken /static chunk requests back into /_next/static', () => {
  assert.match(nextConfigSource, /source:\s*['"]\/static\/:path\*['"]/);
  assert.match(nextConfigSource, /destination:\s*['"]\/_next\/static\/:path\*['"]/);
  assert.match(nextConfigSource, /process\.env\.NODE_ENV\s*===\s*['"]development['"]/);
});
