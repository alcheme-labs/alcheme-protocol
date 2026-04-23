import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

const ghostRevealSource = readFileSync(
    new URL('../src/components/circle/GhostReveal/GhostReveal.tsx', import.meta.url),
    'utf8',
);
const ghostDraftHookSource = readFileSync(
    new URL('../src/hooks/useGhostDraftGeneration.ts', import.meta.url),
    'utf8',
);
const crucibleTabSource = readFileSync(
    new URL('../src/components/circle/CrucibleTab/CrucibleTab.tsx', import.meta.url),
    'utf8',
);

test('GhostReveal exposes a real ghost draft entry surface instead of returning null', () => {
    assert.doesNotMatch(ghostRevealSource, /export default function GhostReveal[\s\S]*return null/);
    assert.match(ghostRevealSource, /candidate\.targetLabel/);
    assert.match(ghostRevealSource, /suggestions\.map/);
    assert.match(ghostRevealSource, /actions\.ignore/);
});

test('useGhostDraftGeneration wraps GENERATE_GHOST_DRAFT behind a stable async adapter', () => {
    assert.match(ghostDraftHookSource, /useMutation/);
    assert.match(ghostDraftHookSource, /useRef/);
    assert.match(ghostDraftHookSource, /GENERATE_GHOST_DRAFT/);
    assert.match(ghostDraftHookSource, /ACCEPT_GHOST_DRAFT/);
    assert.match(ghostDraftHookSource, /generateGhostDraft/);
    assert.match(ghostDraftHookSource, /acceptSuggestion/);
    assert.match(ghostDraftHookSource, /ignoreCandidate/);
    assert.match(ghostDraftHookSource, /EventSource/);
    assert.match(ghostDraftHookSource, /pendingJobId/);
    assert.match(ghostDraftHookSource, /latestWorkingCopyHashRef/);
    assert.match(ghostDraftHookSource, /latestOnAppliedRef/);
});

test('CrucibleTab wires GhostReveal through the dedicated hook instead of leaving the flow disconnected', () => {
    assert.match(crucibleTabSource, /useGhostDraftGeneration/);
    assert.match(crucibleTabSource, /GhostReveal/);
    assert.match(crucibleTabSource, /onGenerate=/);
    assert.match(crucibleTabSource, /onAccept=/);
    assert.match(crucibleTabSource, /onIgnore=/);
});

test('accepting a ghost draft candidate applies it through the shared write path', () => {
    assert.match(ghostDraftHookSource, /runAcceptGhostDraft/);
    assert.match(ghostDraftHookSource, /workingCopyHash/);
    assert.match(ghostDraftHookSource, /workingCopyUpdatedAt/);
    assert.match(ghostDraftHookSource, /ACCEPT_SUGGESTION/);
    assert.match(ghostDraftHookSource, /suggestionId/);
});
