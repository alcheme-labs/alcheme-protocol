import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

const discussionApiSource = readFileSync(
    new URL('../src/lib/discussion/api.ts', import.meta.url),
    'utf8',
);
const plazaTabSource = readFileSync(
    new URL('../src/components/circle/PlazaTab/PlazaTab.tsx', import.meta.url),
    'utf8',
);
const handoffSource = readFileSync(
    new URL('../src/features/discussion-intake/handoff/acceptedCandidate.ts', import.meta.url),
    'utf8',
);

test('createDraftFromCandidate exposes a response union where pending has no draftPostId', () => {
    assert.match(discussionApiSource, /type DraftCandidateCreateDraftResult =/);
    assert.match(discussionApiSource, /status: 'created';[\s\S]*draftPostId: number;/);
    assert.match(discussionApiSource, /status: 'existing';[\s\S]*draftPostId: number;/);
    assert.match(discussionApiSource, /status: 'pending';[\s\S]*attemptId: number;[\s\S]*claimedUntil: string;[\s\S]*created: false;/);
    assert.match(discussionApiSource, /status: 'generation_failed';[\s\S]*canRetry: boolean;[\s\S]*created: false;/);
});

test('PlazaTab only opens Crucible for created or existing create-draft responses', () => {
    assert.match(plazaTabSource, /if \(response\.result\.status === 'pending'\)/);
    assert.match(plazaTabSource, /if \(response\.result\.status === 'generation_failed'\)/);
    assert.match(plazaTabSource, /if \(response\.result\.status === 'created' \|\| response\.result\.status === 'existing'\)/);
    assert.match(plazaTabSource, /onOpenCrucible\?\.\(response\.result\.draftPostId\)/);
});

test('PlazaTab retries failed draft generation through create-draft and locally disables pending candidates', () => {
    assert.match(plazaTabSource, /pendingCandidateDraftIds,\s*setPendingCandidateDraftIds/);
    assert.match(plazaTabSource, /setPendingCandidateDraftIds\(\(prev\)[\s\S]*notice\.candidateId/);
    assert.match(plazaTabSource, /const handleCandidateRetry[\s\S]*handleCandidateCreateDraft\(notice\)/);
});

test('PlazaTab local pending override only applies before a terminal server state arrives', () => {
    assert.match(
        plazaTabSource,
        /candidateNotice\.state === 'open' \|\| candidateNotice\.state === 'pending'/,
    );
    assert.doesNotMatch(
        plazaTabSource,
        /pendingCandidateDraftIds\.has\(candidateNotice\.candidateId\) && !candidateNotice\.draftPostId\s*\n\s*: false;/,
    );
});

test('candidate handoff parser accepts persisted pending candidate state', () => {
    assert.match(handoffSource, /'pending',/);
    assert.match(handoffSource, /normalized === 'pending'/);
});

test('PlazaTab exposes a manual discussion-to-draft action using source message ids', () => {
    assert.match(discussionApiSource, /export async function createDraftFromDiscussionMessages/);
    assert.match(discussionApiSource, /\/api\/v1\/discussion\/circles\/\$\{input\.circleId\}\/drafts\/from-messages/);
    assert.match(plazaTabSource, /createDraftFromDiscussionMessages/);
    assert.match(plazaTabSource, /const manualDraftSourceMessageIds = useMemo/);
    assert.match(plazaTabSource, /message\.messageKind !== 'draft_candidate_notice'/);
    assert.match(plazaTabSource, /message\.messageKind !== 'governance_notice'/);
    assert.match(plazaTabSource, /!message\.deleted/);
    assert.match(plazaTabSource, /!message\.ephemeral/);
    assert.match(plazaTabSource, /sourceMessageIds: manualDraftSourceMessageIds/);
});
