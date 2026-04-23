import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

const apiSource = readFileSync(
    new URL('../src/features/draft-working-copy/api.ts', import.meta.url),
    'utf8',
);

test('draft lifecycle API surfaces backend reason codes before falling back to generic error codes', () => {
    assert.match(
        apiSource,
        /typeof payload\?\.reason === 'string'/,
    );
});
