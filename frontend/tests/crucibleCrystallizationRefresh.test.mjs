import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

const circlePageSource = readFileSync(
  new URL('../src/app/(main)/circles/[id]/page.tsx', import.meta.url),
  'utf8',
);
const crucibleTabSource = readFileSync(
  new URL('../src/components/circle/CrucibleTab/CrucibleTab.tsx', import.meta.url),
  'utf8',
);
const queriesSource = readFileSync(
  new URL('../src/lib/apollo/queries.ts', import.meta.url),
  'utf8',
);
const typesSource = readFileSync(
  new URL('../src/lib/apollo/types.ts', import.meta.url),
  'utf8',
);

function extractConstCallback(source, name) {
  const start = source.indexOf(`const ${name} = useCallback`);
  assert.notEqual(start, -1, `${name} callback not found`);
  const dependencyStart = source.indexOf('\n    }, [', start);
  assert.notEqual(dependencyStart, -1, `${name} callback dependency list not found`);
  return source.slice(start, dependencyStart);
}

test('Circle page refreshes knowledge, drafts, and summary after draft crystallization', () => {
  const callbackSource = extractConstCallback(circlePageSource, 'handleCrystallizationComplete');
  assert.match(
    circlePageSource,
    /data:\s*knowledgeData,\s*refetch:\s*refetchKnowledgeByCircle[\s\S]*GET_KNOWLEDGE_BY_CIRCLE/,
  );
  assert.match(callbackSource, /const handleCrystallizationComplete = useCallback\(async \(\) => \{/);
  assert.match(
    callbackSource,
    /refetchKnowledgeByCircle\(\{\s*circleId:\s*activeDiscussionCircleId,\s*limit:\s*50\s*\}\)/,
  );
  assert.match(
    callbackSource,
    /refetchDrafts\(\{\s*circleId:\s*activeDiscussionCircleId,\s*limit:\s*50\s*\}\)/,
  );
  assert.match(callbackSource, /refetch\(\)/);
  assert.match(circlePageSource, /onCrystallizationComplete=\{handleCrystallizationComplete\}/);
});

test('Circle page scopes retained draft query data to the active circle', () => {
  assert.match(
    circlePageSource,
    /data:\s*draftsData,\s*refetch:\s*refetchDrafts[\s\S]*GET_CIRCLE_DRAFTS/,
  );
  assert.doesNotMatch(circlePageSource, /previousData:\s*previousDraftsData/);
  assert.match(circlePageSource, /const draftSummariesByCircleRef = useRef<Map<number, GQLDraftSummary\[\]>>\(new Map\(\)\)/);
  assert.match(circlePageSource, /draftSummariesByCircleRef\.current\.set\(activeDiscussionCircleId, draftsData\.circleDrafts\)/);
  assert.match(
    circlePageSource,
    /draftSummariesByCircleRef\.current\.get\(activeDiscussionCircleId\) \?\? \[\]/,
  );
  assert.match(circlePageSource, /draftSummaries\.map\(\(d: GQLDraftSummary\) => \(/);
});

test('Draft list query carries lifecycle status so the list does not wait for REST lifecycle probes', () => {
  assert.match(queriesSource, /circleDrafts\(circleId: \$circleId, limit: \$limit, offset: \$offset\) \{[\s\S]*documentStatus/);
  assert.match(typesSource, /documentStatus: string;/);
  assert.match(circlePageSource, /documentStatus:\s*normalizeDraftDocumentStatus\(d\.documentStatus\)/);
});

test('CrucibleTab notifies its parent only after crystallization succeeds', () => {
  assert.match(crucibleTabSource, /onCrystallizationComplete\?: \(\) => Promise<void> \| void;/);
  assert.match(crucibleTabSource, /onCrystallizationComplete,/);
  assert.match(crucibleTabSource, /const result = await crystallizeDraft\(\);/);
  assert.match(crucibleTabSource, /if \(result\) \{/);
  assert.match(
    crucibleTabSource,
    /await onCrystallizationComplete\?\.\(\);/,
  );
});
