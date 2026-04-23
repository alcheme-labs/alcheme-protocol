import { strict as assert } from 'node:assert';
import { describe, it } from 'mocha';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';

describe('Crucible archive/restore UI and anchor wiring', () => {
  const tabSource = readFileSync(
    resolve(process.cwd(), 'frontend/src/components/circle/CrucibleTab/CrucibleTab.tsx'),
    'utf8',
  );
  const headerSource = readFileSync(
    resolve(process.cwd(), 'frontend/src/components/circle/CrucibleTab/CrucibleLifecycleHeader.tsx'),
    'utf8',
  );
  const apiSource = readFileSync(
    resolve(process.cwd(), 'frontend/src/features/draft-working-copy/api.ts'),
    'utf8',
  );
  const sdkSource = readFileSync(
    resolve(process.cwd(), 'sdk/src/modules/content.ts'),
    'utf8',
  );
  const libRs = readFileSync(
    resolve(process.cwd(), 'programs/content-manager/src/lib.rs'),
    'utf8',
  );
  const instructionsRs = readFileSync(
    resolve(process.cwd(), 'programs/content-manager/src/instructions.rs'),
    'utf8',
  );

  it('adds archive and restore lifecycle routes on the frontend API seam', () => {
    assert.match(apiSource, /export async function archiveDraftLifecycle/);
    assert.match(apiSource, /export async function restoreDraftLifecycle/);
    assert.match(apiSource, /\/draft-lifecycle\/drafts\/\$\{input\.draftPostId\}\/archive/);
    assert.match(apiSource, /\/draft-lifecycle\/drafts\/\$\{input\.draftPostId\}\/restore/);
    assert.match(apiSource, /anchorSignature/);
  });

  it('shows archive and restore CTAs from lifecycle-specific states instead of overloading crystallization buttons', () => {
    assert.match(headerSource, /showArchiveAction\?: boolean/);
    assert.match(headerSource, /showRestoreAction\?: boolean/);
    assert.match(headerSource, /onArchive\?: \(\) => void/);
    assert.match(headerSource, /onRestore\?: \(\) => void/);
    assert.match(headerSource, /归档草稿/);
    assert.match(headerSource, /恢复草稿/);
    assert.match(tabSource, /const showArchiveAction = Boolean\(/);
    assert.match(tabSource, /const showRestoreAction = Boolean\(/);
    assert.match(tabSource, /archiveDisabledReason=/);
    assert.match(tabSource, /restoreDisabledReason=/);
  });

  it('anchors archive and restore before writing the off-chain lifecycle transition', () => {
    assert.match(tabSource, /useAlchemeSDK/);
    assert.match(tabSource, /sdk\.content\.archiveDraftLifecycleAnchor/);
    assert.match(tabSource, /sdk\.content\.restoreDraftLifecycleAnchor/);
    assert.match(tabSource, /const handleArchiveDraft = useCallback/);
    assert.match(tabSource, /const handleRestoreDraft = useCallback/);
    assert.match(tabSource, /const anchorSignature = await sdk\.content\.archiveDraftLifecycleAnchor\(/);
    assert.match(tabSource, /const anchorSignature = await sdk\.content\.restoreDraftLifecycleAnchor\(/);
    assert.match(tabSource, /archiveDraftLifecycleRequest\(\{\s*draftPostId: selectedDraftPostId,\s*anchorSignature,/s);
    assert.match(tabSource, /restoreDraftLifecycleRequest\(\{\s*draftPostId: selectedDraftPostId,\s*anchorSignature,/s);
    assert.match(tabSource, /draftLifecycle\?\.policyProfileDigest/);
  });

  it('proves published-content archive semantics do not fit draft restore and adds a dedicated draft anchor path', () => {
    assert.match(instructionsRs, /pub fn archive_content_v2\(/);
    assert.match(instructionsRs, /current_status == ContentStatus::Published/);
    assert.match(instructionsRs, /pub fn restore_content_v2\(/);
    assert.match(instructionsRs, /apply_v2_lifecycle_transition\(ctx, content_id, ContentStatus::Published\)/);
    assert.match(libRs, /pub fn archive_draft_lifecycle_v2\(/);
    assert.match(libRs, /pub fn restore_draft_lifecycle_v2\(/);
    assert.match(instructionsRs, /pub fn archive_draft_lifecycle_v2\(/);
    assert.match(instructionsRs, /pub fn restore_draft_lifecycle_v2\(/);
    assert.match(instructionsRs, /policy_profile_digest:\s*\[u8;\s*32\]/);
    assert.match(sdkSource, /async archiveDraftLifecycleAnchor\(/);
    assert.match(sdkSource, /async restoreDraftLifecycleAnchor\(/);
  });
});
