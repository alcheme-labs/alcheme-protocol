import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, resolve } from 'node:path';

const __dirname = dirname(fileURLToPath(import.meta.url));
const root = resolve(__dirname, '..');

function read(relativePath) {
  return readFileSync(resolve(root, relativePath), 'utf8');
}

describe('circle access policy create wiring', () => {
  it('passes selected accessType when creating a root circle', () => {
    const source = read('src/app/(main)/circles/page.tsx');
    assert.match(source, /createCircle\(\{[\s\S]*accessType:\s*data\.accessType[\s\S]*minCrystals:\s*data\.accessType === 'crystal'/);
  });

  it('passes selected accessType when creating a child or auxiliary circle', () => {
    const source = read('src/app/(main)/circles/[id]/page.tsx');
    assert.match(source, /createCircle\(\{[\s\S]*accessType:\s*data\.accessType[\s\S]*minCrystals:\s*data\.accessType === 'crystal'/);
  });
});
