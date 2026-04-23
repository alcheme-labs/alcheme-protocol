import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

const plazaTabSource = readFileSync(
    new URL('../src/components/circle/PlazaTab/PlazaTab.tsx', import.meta.url),
    'utf8',
);

test('discussion realtime sync defaults to non-deleted reads to reduce read load', () => {
    assert.equal(plazaTabSource.includes('includeDeleted: true'), false);
    assert.match(plazaTabSource, /fetchDiscussionMessages\(\{[\s\S]*circleId:[\s\S]*limit:[\s\S]*DISCUSSION_SYNC_LIMIT[\s\S]*\}\)/);
});

test('discussion realtime sync applies exponential backoff after failures', () => {
    assert.match(plazaTabSource, /discussionPollFailureRef\.current = Math\.min\(/);
    assert.match(plazaTabSource, /DISCUSSION_REALTIME_POLL_INTERVAL_MS\s*\*\s*\(2 \*\* discussionPollFailureRef\.current\)/);
    assert.match(plazaTabSource, /DISCUSSION_REALTIME_POLL_BACKOFF_MAX_MS/);
});

test('discussion realtime sync downgrades polling frequency when page is hidden', () => {
    assert.match(plazaTabSource, /document\.visibilityState === 'hidden'/);
    assert.match(plazaTabSource, /DISCUSSION_REALTIME_POLL_HIDDEN_MS/);
    assert.match(plazaTabSource, /document\.addEventListener\('visibilitychange', handleVisibilityChange\)/);
});
