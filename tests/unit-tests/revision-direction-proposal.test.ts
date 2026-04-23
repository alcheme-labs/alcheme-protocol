import { strict as assert } from 'node:assert';
import { describe, it } from 'mocha';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';

describe('Revision direction proposal UI wiring', () => {
  const panelSource = readFileSync(
    resolve(process.cwd(), 'frontend/src/components/circle/DraftDiscussionPanel/DraftDiscussionPanel.tsx'),
    'utf8',
  );

  it('adds a lightweight revision direction entry point in the draft discussion panel', () => {
    assert.match(panelSource, /修订方向/);
    assert.match(panelSource, /下一轮修订/);
    assert.match(panelSource, /revisionDirections/);
    assert.match(panelSource, /setRevisionDirections/);
  });

  it('supports the three frozen acceptance modes in the review-stage panel', () => {
    assert.match(panelSource, /manager_confirm/);
    assert.match(panelSource, /role_confirm/);
    assert.match(panelSource, /governance_vote/);
    assert.match(panelSource, /acceptanceMode/);
  });

  it('talks to the dedicated revision-direction route instead of overloading discussion thread mutations', () => {
    assert.match(panelSource, /\/api\/v1\/revision-directions\/drafts\/\$\{props\.draftPostId\}\/revision-directions/);
    assert.match(panelSource, /loadRevisionDirections/);
    assert.match(panelSource, /createRevisionDirection/);
    assert.match(panelSource, /acceptRevisionDirection/);
  });

  it('surfaces accepted directions as next-round drafting inputs', () => {
    assert.match(panelSource, /acceptedDirections/);
    assert.match(panelSource, /下一轮写作输入/);
    assert.match(panelSource, /status === 'accepted'/);
  });
});
