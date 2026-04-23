import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

const crucibleTabSource = readFileSync(
    new URL('../src/components/circle/CrucibleTab/CrucibleTab.tsx', import.meta.url),
    'utf8',
);

test('CrucibleTab centralizes lifecycle action errors instead of showing duplicate notices', () => {
    assert.match(crucibleTabSource, /const presentDraftLifecycleActionError = useCallback/);
    assert.match(crucibleTabSource, /presentDraftLifecycleActionError\(message\)/);
    const archiveStart = crucibleTabSource.indexOf('const handleArchiveDraft = useCallback');
    const restoreStart = crucibleTabSource.indexOf('const handleRestoreDraft = useCallback');
    assert.notStrictEqual(archiveStart, -1);
    assert.notStrictEqual(restoreStart, -1);
    const archiveHandlerSource = crucibleTabSource.slice(archiveStart, restoreStart);
    const archiveCatchMatch = archiveHandlerSource.match(/catch \(error\) \{([\s\S]*?)\n        \} finally/);
    assert.ok(archiveCatchMatch, 'expected handleArchiveDraft catch block');
    assert.match(archiveCatchMatch[1], /presentDraftLifecycleActionError\(message\)/);
    assert.doesNotMatch(archiveCatchMatch[1], /setNotice\(\{\s*type:\s*'error'/);
});
