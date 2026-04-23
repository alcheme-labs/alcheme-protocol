import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

const plazaTabSource = readFileSync(
    new URL('../src/components/circle/PlazaTab/PlazaTab.tsx', import.meta.url),
    'utf8',
);

test('discussion polling uses setTimeout loop instead of fixed setInterval', () => {
    assert.match(plazaTabSource, /const scheduleNextPoll = \(delayMs: number\) =>/);
    assert.match(plazaTabSource, /window\.setTimeout\(async \(\) =>/);
    assert.equal(plazaTabSource.includes('window.setInterval'), false);
});

test('discussion polling immediately tries sync when tab becomes visible', () => {
    assert.match(plazaTabSource, /if \(document\.visibilityState === 'visible'\)/);
    assert.match(plazaTabSource, /void syncDiscussionMessages\(\);/);
    assert.match(plazaTabSource, /scheduleNextPoll\(DISCUSSION_REALTIME_POLL_INTERVAL_MS\);/);
});

test('discussion polling clears scheduled timer on cleanup', () => {
    assert.match(plazaTabSource, /const clearScheduledPoll = \(\) =>/);
    assert.match(plazaTabSource, /window\.clearTimeout\(timeoutId\)/);
    assert.match(plazaTabSource, /document\.removeEventListener\('visibilitychange', handleVisibilityChange\)/);
});
