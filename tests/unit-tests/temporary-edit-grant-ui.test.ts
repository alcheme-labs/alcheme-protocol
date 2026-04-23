import { strict as assert } from 'node:assert';
import { describe, it } from 'mocha';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';

describe('Temporary edit grant UI wiring', () => {
  const editorSource = readFileSync(
    resolve(process.cwd(), 'frontend/src/components/circle/CrucibleEditor/CrucibleEditor.tsx'),
    'utf8',
  );
  const tabSource = readFileSync(
    resolve(process.cwd(), 'frontend/src/components/circle/CrucibleTab/CrucibleTab.tsx'),
    'utf8',
  );

  it('adds grant state and callbacks to the editor surface', () => {
    assert.match(editorSource, /temporaryEditGrants/);
    assert.match(editorSource, /onRequestTemporaryEditGrant/);
    assert.match(editorSource, /onIssueTemporaryEditGrant/);
    assert.match(editorSource, /onRevokeTemporaryEditGrant/);
    assert.match(editorSource, /临时编辑授权/);
  });

  it('wires the tab to the dedicated temporary-edit-grant route', () => {
    assert.match(tabSource, /temporaryEditGrants/);
    assert.match(tabSource, /loadTemporaryEditGrants/);
    assert.match(tabSource, /requestTemporaryEditGrant/);
    assert.match(tabSource, /issueTemporaryEditGrant/);
    assert.match(tabSource, /revokeTemporaryEditGrant/);
    assert.match(tabSource, /\/api\/v1\/temporary-edit-grants\/drafts\/\$\{selectedDraftPostId\}\/temporary-edit-grants/);
  });

  it('shows request, approve, and revoke actions near paragraph editing rather than inventing a second block workflow page', () => {
    assert.match(editorSource, /请求临时编辑授权/);
    assert.match(editorSource, /批准临时授权/);
    assert.match(editorSource, /撤销临时授权/);
    assert.match(editorSource, /grant\.status === 'requested'/);
    assert.match(editorSource, /grant\.status === 'active'/);
  });
});
