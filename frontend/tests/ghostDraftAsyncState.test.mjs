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
const ghostDraftApiSource = readFileSync(
    new URL('../src/lib/api/ghostDrafts.ts', import.meta.url),
    'utf8',
);
const ghostRevealSource = readFileSync(
    new URL('../src/components/circle/GhostReveal/GhostReveal.tsx', import.meta.url),
    'utf8',
);

test('frontend generate mutation requests an async job envelope instead of synchronous draft text', () => {
    const generateBlock = queriesSource.match(/export const GENERATE_GHOST_DRAFT = gql`([\s\S]*?)`;/)?.[1] || '';
    assert.match(queriesSource, /mutation GenerateGhostDraft/);
    assert.match(queriesSource, /jobId/);
    assert.match(queriesSource, /status/);
    assert.doesNotMatch(generateBlock, /draftText/);
    assert.match(typesSource, /export interface GhostDraftJobResponse/);
});

test('ghost draft hook tracks pending ai jobs and subscribes to dedicated ai job updates', () => {
    assert.match(hookSource, /EventSource/);
    assert.match(hookSource, /openAiJobEventStream/);
    assert.match(hookSource, /pendingJobId/);
    assert.match(ghostDraftApiSource, /\/api\/v1\/ai-jobs\/\$\{input\.jobId\}/);
    assert.match(ghostDraftApiSource, /\/api\/v1\/ai-jobs\/\$\{input\.jobId\}\/stream/);
    assert.match(hookSource, /status:\s*'pending'/);
});

test('ghost draft hook recovers persisted draft-scoped generations after refresh', () => {
    assert.match(hookSource, /fetchLatestGhostDraftJobSnapshot/);
    assert.match(ghostDraftApiSource, /\/api\/v1\/ai-jobs\?draftPostId=/);
    assert.match(hookSource, /jobType === 'ghost_draft_generate'/);
    assert.match(hookSource, /recoveredSnapshot\.status === 'succeeded'/);
});

test('ghost draft hook retries fetching the persisted generation before surfacing an error', () => {
    assert.match(hookSource, /attempts:\s*4/);
    assert.match(hookSource, /retryDelayMs:\s*250/);
    assert.match(hookSource, /await delay\(retryDelayMs\)/);
});

test('ghost draft hook receives localized error copy instead of hardcoding Chinese fallbacks', () => {
    assert.match(hookSource, /options\.copy\.errors\.missingDraftContext/);
    assert.match(hookSource, /options\.copy\.errors\.missingArtifact/);
    assert.match(hookSource, /options\.copy\.errors\.missingContent/);
    assert.match(hookSource, /options\.copy\.errors\.generateFailed/);
    assert.match(hookSource, /options\.copy\.errors\.acceptFailed/);
    assert.doesNotMatch(hookSource, /缺少草稿上下文，暂时无法生成/);
    assert.doesNotMatch(hookSource, /AI 没有返回可读取的草稿产物/);
    assert.doesNotMatch(hookSource, /AI 草稿生成失败，请稍后重试/);
});

test('ghost reveal renders an explicit pending state while the async job is still running', () => {
    assert.match(ghostRevealSource, /states\.pending\.title/);
    assert.match(ghostRevealSource, /states\.pending\.hint/);
});
