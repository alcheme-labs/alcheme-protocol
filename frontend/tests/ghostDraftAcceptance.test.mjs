import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

const queriesSource = readFileSync(
    new URL('../src/lib/apollo/queries.ts', import.meta.url),
    'utf8',
);
const typesSource = readFileSync(
    new URL('../src/lib/apollo/types.ts', import.meta.url),
    'utf8',
);
const hookSource = readFileSync(
    new URL('../src/hooks/useGhostDraftGeneration.ts', import.meta.url),
    'utf8',
);
const crucibleTabSource = readFileSync(
    new URL('../src/components/circle/CrucibleTab/CrucibleTab.tsx', import.meta.url),
    'utf8',
);
const draftLifecycleApiSource = readFileSync(
    new URL('../src/lib/api/draftWorkingCopy.ts', import.meta.url),
    'utf8',
);

test('frontend declares a dedicated acceptGhostDraft mutation', () => {
    assert.match(queriesSource, /mutation AcceptGhostDraft/);
    assert.match(queriesSource, /acceptGhostDraft\(input: \$input\)/);
    assert.match(queriesSource, /suggestionId/);
    assert.match(queriesSource, /acceptedSuggestion/);
    assert.match(queriesSource, /acceptedThreadIds/);
    assert.match(queriesSource, /workingCopyHash/);
    assert.match(typesSource, /updatedAt: string/);
});

test('ghost draft hook applies one suggestion at a time instead of replacing the whole draft', () => {
    assert.match(hookSource, /ACCEPT_SUGGESTION/);
    assert.match(hookSource, /suggestionId/);
    assert.doesNotMatch(hookSource, /ACCEPT_REPLACE/);
});

test('review-stage suggestion acceptance requires structured apply authority instead of generic review access', () => {
    assert.doesNotMatch(hookSource, /acceptSuggestion[\s\S]*latestCanEditWorkingCopyRef\.current/);
    assert.match(crucibleTabSource, /const canViewGhostReveal = Boolean\(\s*discussionCapabilities\.canResolve \|\| discussionCapabilities\.canApply,\s*\)/);
    assert.match(crucibleTabSource, /const canAcceptGhostSuggestion = Boolean\(\s*discussionCapabilities\.canResolve && discussionCapabilities\.canApply,\s*\)/);
    assert.match(crucibleTabSource, /canAccept=\{canAcceptGhostSuggestion\}/);
    assert.match(crucibleTabSource, /acceptDisabledReason=\{ghostAcceptDisabledReason\}/);
});

test('crucible tab forwards current working copy preconditions into ghost draft acceptance', () => {
    assert.match(crucibleTabSource, /draftLifecycle\?\.workingCopy\.workingCopyHash/);
    assert.match(crucibleTabSource, /draftLifecycle\?\.workingCopy\.updatedAt/);
    assert.match(crucibleTabSource, /onApplied:\s*handleGhostDraftApplied/);
});

test('frontend types expose working copy semantics for acceptGhostDraft results', () => {
    assert.match(typesSource, /export interface AcceptGhostDraftResponse/);
    assert.match(typesSource, /workingCopyContent: string/);
    assert.match(typesSource, /workingCopyHash: string/);
    assert.match(typesSource, /applied: boolean/);
    assert.match(typesSource, /acceptedThreadIds: string\[]/);
    assert.match(typesSource, /acceptedSuggestion:/);
});

test('accepting an AI suggestion immediately promotes the frontend flow to applied and replaces the live draft content', () => {
    assert.match(hookSource, /mode === 'ACCEPT_SUGGESTION'/);
    assert.match(hookSource, /payload\.applied/);
    assert.match(
        hookSource,
        /shouldReplaceLiveDoc:\s*payload\.applied[\s\S]*mode === 'ACCEPT_SUGGESTION'/,
    );
    assert.match(
        hookSource,
        /status:\s*payload\.applied[\s\S]*'applied'/,
    );
    assert.match(crucibleTabSource, /setSelectedDraftContent\(normalized\)/);
    assert.match(crucibleTabSource, /if \(input\.shouldReplaceLiveDoc\)[\s\S]*setGhostDraftReplaceRequest/);
});

test('legacy review advance flow still supports explicit confirmation for stale accepted AI applications', () => {
    assert.match(draftLifecycleApiSource, /export class DraftLifecycleRequestError/);
    assert.match(draftLifecycleApiSource, /confirmApplyAcceptedGhostThreads/);
    assert.match(crucibleTabSource, /draft_review_apply_confirmation_required/);
    assert.match(crucibleTabSource, /window\.confirm/);
    assert.match(crucibleTabSource, /confirmApplyAcceptedGhostThreads:\s*true/);
});

test('advance review syncs the returned working copy into the local draft surface and live editor handoff', () => {
    assert.match(crucibleTabSource, /const syncDraftSurfaceFromLifecycle = useCallback/);
    assert.match(crucibleTabSource, /autosaveTextRef\.current = nextWorkingCopy/);
    assert.match(crucibleTabSource, /setSelectedDraftContent\(nextWorkingCopy\)/);
    assert.match(crucibleTabSource, /setGhostDraftReplaceRequest\(\{\s*token: Date\.now\(\),\s*content: nextWorkingCopy,\s*\}\)/);
    assert.match(crucibleTabSource, /syncDraftSurfaceFromLifecycle\(lifecycle, \{ replaceLiveDoc: true \}\)/);
});

test('accepted AI suggestions accumulate default issue carry selections instead of overwriting earlier ones', () => {
    assert.match(crucibleTabSource, /setGhostDraftDefaultIssueCarrySelections\(\(prev\)\s*=>/);
});

test('frontend only shows ghost draft suggestions for open or proposed issue threads', () => {
    assert.match(crucibleTabSource, /thread\.state === 'open'/);
    assert.match(crucibleTabSource, /thread\.state === 'proposed'/);
    assert.doesNotMatch(crucibleTabSource, /thread\.state === 'accepted'/);
});
