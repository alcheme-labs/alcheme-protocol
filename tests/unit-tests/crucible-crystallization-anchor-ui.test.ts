import { strict as assert } from 'node:assert';
import { describe, it } from 'mocha';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';

describe('Crucible crystallization entry anchor wiring', () => {
  const tabSource = readFileSync(
    resolve(process.cwd(), 'frontend/src/components/circle/CrucibleTab/CrucibleTab.tsx'),
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

  it('extends the frontend lifecycle seam so entering crystallization carries an anchor signature', () => {
    assert.match(apiSource, /export async function enterDraftLifecycleCrystallization/);
    assert.match(apiSource, /anchorSignature: string/);
    assert.match(apiSource, /anchorSignature/);
  });

  it('anchors enter crystallization on-chain before writing the off-chain lifecycle transition', () => {
    assert.match(tabSource, /useAlchemeSDK/);
    assert.match(tabSource, /sdk\.content\.enterDraftLifecycleCrystallizationAnchor/);
    assert.match(tabSource, /draftLifecycle\?\.policyProfileDigest/);
    assert.match(tabSource, /const anchorSignature = await sdk\.content\.enterDraftLifecycleCrystallizationAnchor\(/);
    assert.match(tabSource, /enterDraftLifecycleCrystallizationRequest\(\{\s*draftPostId: selectedDraftPostId,\s*anchorSignature,/s);
  });

  it('adds a dedicated content-manager milestone instruction and SDK wrapper for crystallization entry', () => {
    assert.match(libRs, /pub fn enter_draft_crystallization_v2\(/);
    assert.match(instructionsRs, /pub fn enter_draft_crystallization_v2\(/);
    assert.match(instructionsRs, /DraftLifecycleMilestoneAction::EnteredCrystallization/);
    assert.match(instructionsRs, /policy_profile_digest:\s*\[u8;\s*32\]/);
    assert.match(sdkSource, /async enterDraftLifecycleCrystallizationAnchor\(/);
    assert.match(sdkSource, /enterDraftCrystallizationV2/);
  });
});
