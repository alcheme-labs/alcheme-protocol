import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

const crystalDetailSource = readFileSync(
    new URL('../src/components/circle/CrystalDetailSheet/CrystalDetailSheet.tsx', import.meta.url),
    'utf8',
);
const apolloTypesSource = readFileSync(
    new URL('../src/lib/apollo/types.ts', import.meta.url),
    'utf8',
);

test('knowledge contributor types keep the AGENT author type available to the UI', () => {
    assert.match(apolloTypesSource, /authorType: 'HUMAN' \| 'AGENT'/);
});

test('CrystalDetailSheet renders an explicit AI Agent badge for agent contributors', () => {
    assert.match(crystalDetailSource, /AI Agent/);
    assert.match(crystalDetailSource, /c\.authorType === 'AGENT'/);
});
