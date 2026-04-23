import { strict as assert } from 'node:assert';
import fs from 'node:fs';
import path from 'node:path';
import { describe, it } from '@jest/globals';
import { fileURLToPath } from 'node:url';

describe('Task2 RED: SDK follow fact surface', () => {
  const filePath = fileURLToPath(import.meta.url);
  const repoRoot = path.resolve(path.dirname(filePath), '..', '..');
  const identityModulePath = path.join(repoRoot, 'sdk/src/modules/identity.ts');
  const accessModulePath = path.join(repoRoot, 'sdk/src/modules/access.ts');
  const pdaPath = path.join(repoRoot, 'sdk/src/utils/pda.ts');

  function read(filePath: string): string {
    assert.equal(fs.existsSync(filePath), true, `missing file: ${filePath}`);
    return fs.readFileSync(filePath, 'utf8');
  }

  it('adds a follow relationship PDA helper', () => {
    const pdaSource = read(pdaPath);

    assert.match(pdaSource, /findFollowRelationshipPda\(follower: PublicKey, followed: PublicKey\): PublicKey/);
    assert.match(pdaSource, /SEEDS\.FOLLOW_RELATIONSHIP/);
  });

  it('exposes follow and unfollow on the access module using access-controller PDAs', () => {
    const accessSource = read(accessModulePath);

    assert.match(accessSource, /async followUser\(followed: PublicKey\)/);
    assert.match(accessSource, /async unfollowUser\(followed: PublicKey\)/);
    assert.match(accessSource, /findFollowRelationshipPda\(this\.provider\.publicKey, followed\)/);
    assert.doesNotMatch(accessSource, /updateSocialStats\(/);
  });

  it('keeps identity module as compatibility surface without turning follow fact ownership into identity stats', () => {
    const identitySource = read(identityModulePath);

    assert.match(identitySource, /async followUser\(followed: PublicKey\)/);
    assert.match(identitySource, /async unfollowUser\(followed: PublicKey\)/);
    assert.match(identitySource, /AccessModule|access_controller\.json|accessIdl/);
    assert.doesNotMatch(identitySource, /followUser[\s\S]*updateSocialStats\(/);
    assert.doesNotMatch(identitySource, /unfollowUser[\s\S]*updateSocialStats\(/);
  });
});
