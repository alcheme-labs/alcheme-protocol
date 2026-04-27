import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';

import {
    CIRCLE_NAME_MAX_BYTES,
    clampUtf8Bytes,
    getUtf8ByteLength,
} from '../src/lib/circles/nameLimit.ts';

const sheetSource = fs.readFileSync(
    new URL('../src/components/circle/CreateCircleSheet/CreateCircleSheet.tsx', import.meta.url),
    'utf8',
);

test('circle name limit follows the on-chain 64 byte budget instead of the old 30 character cap', () => {
    assert.equal(CIRCLE_NAME_MAX_BYTES, 64);
    assert.equal(clampUtf8Bytes('a'.repeat(80)), 'a'.repeat(64));
    assert.equal(getUtf8ByteLength(clampUtf8Bytes('圈'.repeat(30))) <= CIRCLE_NAME_MAX_BYTES, true);
});

test('CreateCircleSheet clamps circle names with the shared byte-aware helper', () => {
    assert.match(sheetSource, /clampUtf8Bytes\(value\)/);
    assert.match(sheetSource, /maxLength=\{CIRCLE_NAME_MAX_BYTES\}/);
    assert.doesNotMatch(sheetSource, /maxLength=\{30\}/);
});
