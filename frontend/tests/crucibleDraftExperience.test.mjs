import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

const collaborativeEditorSource = readFileSync(
    new URL('../src/components/circle/CrucibleEditor/CollaborativeEditor.tsx', import.meta.url),
    'utf8',
);
const crucibleTabSource = readFileSync(
    new URL('../src/components/circle/CrucibleTab/CrucibleTab.tsx', import.meta.url),
    'utf8',
);
const crucibleEditorSource = readFileSync(
    new URL('../src/components/circle/CrucibleEditor/CrucibleEditor.tsx', import.meta.url),
    'utf8',
);
const crucibleEditorStyles = readFileSync(
    new URL('../src/components/circle/CrucibleEditor/CrucibleEditor.module.css', import.meta.url),
    'utf8',
);
const crystallizeDraftHookSource = readFileSync(
    new URL('../src/hooks/useCrystallizeDraft.ts', import.meta.url),
    'utf8',
);
const circlePageStyles = readFileSync(
    new URL('../src/app/(main)/circles/[id]/page.module.css', import.meta.url),
    'utf8',
);
const plazaTabSource = readFileSync(
    new URL('../src/components/circle/PlazaTab/PlazaTab.tsx', import.meta.url),
    'utf8',
);
const draftRuntimeApiSource = readFileSync(
    new URL('../src/lib/api/draftRuntime.ts', import.meta.url),
    'utf8',
);

test('CollaborativeEditor disables immediate SSR render to avoid hydration mismatch', () => {
    assert.match(collaborativeEditorSource, /immediatelyRender:\s*false/);
});

test('CollaborativeEditor seeds editor content when Yjs doc is initially empty', () => {
    assert.match(collaborativeEditorSource, /editor\.commands\.setContent\(normalizedInitialContent\)/);
    assert.match(collaborativeEditorSource, /ydoc\.getXmlFragment\(field\)/);
    assert.equal(collaborativeEditorSource.includes("ydoc.getText('default')"), false);
    assert.equal(collaborativeEditorSource.includes("content: initialContent || ''"), false);
});

test('CrucibleTab includes credentials when reading draft content', () => {
    assert.match(
        draftRuntimeApiSource,
        /\/api\/v1\/discussion\/drafts\/\$\{draftPostId\}\/content[\s\S]*credentials:\s*'include'/,
    );
});

test('CrucibleTab includes credentials when writing draft content', () => {
    assert.match(
        draftRuntimeApiSource,
        /\/api\/v1\/discussion\/drafts\/\$\{draftPostId\}\/content[\s\S]*method:\s*'POST'[\s\S]*credentials:\s*'include'/,
    );
});

test('Circle page keeps chat layout and join banner styles available', () => {
    assert.match(circlePageStyles, /\.pageChat\s*\{/);
    assert.match(circlePageStyles, /\.joinBanner\s*\{/);
});

test('CrucibleEditor splits long generated draft heading into title and subtitle', () => {
    assert.match(crucibleEditorSource, /splitDraftHeader/);
    assert.match(crucibleEditorSource, /className=\{styles\.titleSub\}/);
});

test('CrucibleEditor includes mobile-safe header layout styles', () => {
    assert.match(crucibleEditorStyles, /\.titleBlock\s*\{/);
    assert.match(crucibleEditorStyles, /@media\s*\(max-width:\s*768px\)/);
    assert.match(crucibleEditorStyles, /\.headerTop\s*\{[\s\S]*align-items:\s*flex-start/);
});

test('CrucibleEditor no longer renders the legacy in-editor crystallization CTA', () => {
    assert.doesNotMatch(crucibleEditorSource, /提议结晶/);
    assert.doesNotMatch(crucibleEditorSource, /canRenderCrystallizeButton/);
});

test('CrucibleTab drives crystallization from the lifecycle header action', () => {
    assert.match(crucibleTabSource, /useCrystallizeDraft/);
    assert.match(crucibleTabSource, /showExecuteCrystallizationAction=/);
    assert.match(crucibleTabSource, /executeCrystallizationPending=\{crystallizing\}/);
});

test('CrucibleTab keeps lifecycle polling as a background refresh after the first snapshot', () => {
    assert.match(crucibleTabSource, /const draftLifecycleRef = useRef<DraftLifecycleReadModel \| null>\(null\);/);
    assert.match(crucibleTabSource, /const hasLifecycleSnapshot = draftLifecycleRef\.current\?\.draftPostId === selectedDraftPostId;/);
    assert.match(crucibleTabSource, /setDraftLifecycleLoading\(!hasLifecycleSnapshot\);/);
    assert.match(crucibleTabSource, /draftLifecycleLoading && !draftLifecycle/);
    assert.doesNotMatch(crucibleTabSource, /catch \(error\) \{[\s\S]{0,240}setDraftLifecycle\(null\);[\s\S]{0,240}setDraftLifecycleError\(message\);/);
});

test('Crucible lifecycle buttons only show wait cursor for true pending states, not generic disabled states', () => {
    const lifecycleHeaderSource = readFileSync(
        new URL('../src/components/circle/CrucibleTab/CrucibleLifecycleHeader.tsx', import.meta.url),
        'utf8',
    );
    const lifecycleHeaderStyles = readFileSync(
        new URL('../src/components/circle/CrucibleTab/CrucibleLifecycleHeader.module.css', import.meta.url),
        'utf8',
    );
    assert.match(lifecycleHeaderSource, /data-pending=\{enterCrystallizationPending \? 'true' : undefined\}/);
    assert.match(lifecycleHeaderStyles, /\.primaryAction:disabled\s*\{[\s\S]*cursor:\s*not-allowed;/);
    assert.match(lifecycleHeaderStyles, /\.primaryAction\[data-pending='true'\]:disabled\s*\{[\s\S]*cursor:\s*wait;/);
});

test('CrucibleTab leaves crystallization evidence gating to backend readiness checks', () => {
    assert.doesNotMatch(crucibleTabSource, /const latestEditAnchorId = draftLifecycle\?\.workingCopy\.latestEditAnchorId \|\| null;/);
    assert.doesNotMatch(crucibleTabSource, /const latestEditAnchorStatus = draftLifecycle\?\.workingCopy\.latestEditAnchorStatus \|\| null;/);
    assert.doesNotMatch(crucibleTabSource, /const hasAnchoredEditSnapshot = latestEditAnchorStatus === 'anchored';/);
    assert.match(crucibleTabSource, /const canEnterCrystallization = Boolean\([\s\S]*&& draftLifecycle\?\.policyProfileDigest,/);
    assert.match(crucibleTabSource, /const canRetryCrystallization = Boolean\([\s\S]*&& draftLifecycle\?\.policyProfileDigest,/);
    assert.match(crucibleTabSource, /const canExecuteCrystallization = Boolean\([\s\S]*&& sdk[\s\S]*&& selectedDraftContentReady/);
    assert.match(crystallizeDraftHookSource, /const readiness = await fetchDraftPublishReadiness\(/);
});

test('PlazaTab refreshes drafts before opening crucible after candidate draft creation', () => {
    assert.match(plazaTabSource, /void onDraftsChanged\?\.\(\);/);
    assert.match(plazaTabSource, /onOpenCrucible\?\.\(targetPostId\);/);
});

test('Crystallize success notice requires on-chain binding and contributor update completion', () => {
    assert.match(
        crystallizeDraftHookSource,
        /t\('crystallization\.notices\.successIndexed'\)/,
    );
    assert.match(
        crystallizeDraftHookSource,
        /t\('crystallization\.notices\.successIndexPending'\)/,
    );
});

test('useCrystallizeDraft surfaces collaboration-evidence preparation instead of silently continuing crystallization', () => {
    assert.match(
        crystallizeDraftHookSource,
        /repairDraftLifecycleCrystallizationEvidence/,
    );
    assert.match(
        crystallizeDraftHookSource,
        /t\('crystallization\.notices\.evidencePreparing'\)/,
    );
    assert.match(
        crystallizeDraftHookSource,
        /await repairDraftLifecycleCrystallizationEvidence\(\{ draftPostId \}\);/,
    );
    assert.match(
        crystallizeDraftHookSource,
        /t\('crystallization\.notices\.evidenceReady'\)/,
    );
    assert.match(
        crystallizeDraftHookSource,
        /shouldRepairCrystallizationEvidence/,
    );
    assert.doesNotMatch(
        crystallizeDraftHookSource,
        /await repairDraftLifecycleCrystallizationEvidence\(\{ draftPostId \}\);[\s\S]*strictInputs = await loadStrictInputs\(\);/,
    );
});

test('useCrystallizeDraft keeps user-facing crystallization notices in i18n messages', () => {
    assert.match(crystallizeDraftHookSource, /const t = useI18n\('CrucibleTab'\);/);
    assert.doesNotMatch(
        crystallizeDraftHookSource,
        /当前身份无法发起结晶|请先连接钱包|缺少草稿上下文|草稿标题为空|草稿正文为空|正在准备草稿协作证据|链上绑定|结晶失败，请稍后重试/,
    );
});
