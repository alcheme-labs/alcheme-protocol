import test from 'node:test';
import assert from 'node:assert/strict';
import path from 'node:path';
import { createRequire } from 'node:module';
import { fileURLToPath } from 'node:url';

const filePath = fileURLToPath(import.meta.url);
const frontendRoot = path.resolve(path.dirname(filePath), '..');
process.env.TS_NODE_PROJECT = path.join(frontendRoot, 'tsconfig.json');
process.env.TS_NODE_COMPILER_OPTIONS = JSON.stringify({
  module: 'commonjs',
  moduleResolution: 'node',
  allowImportingTsExtensions: true,
});

const require = createRequire(import.meta.url);
require('ts-node/register/transpile-only');
require('tsconfig-paths/register');

const { resolveLikeTargetPostPda } = require('../src/hooks/useLikePost.ts');

test('feed like target prefers a valid on-chain address when present', () => {
  const derived = resolveLikeTargetPostPda({
    contentId: '7449278668049604377',
    onChainAddress: '11111111111111111111111111111111',
    authorPubkey: '7f6P9hKPXxGepL4GAvX8Z64Kbjsgg7sWXBJgp7wa9uRc',
  }, {
    findContentPostPda() {
      throw new Error('should not derive pda when on-chain address is already valid');
    },
  });

  assert.equal(derived.toBase58(), '11111111111111111111111111111111');
});

test('feed like target derives the content PDA from author pubkey when stored address is not a valid public key', () => {
  const derived = resolveLikeTargetPostPda({
    contentId: '7449278668049604377',
    onChainAddress: '7449278668049604377',
    authorPubkey: '7f6P9hKPXxGepL4GAvX8Z64Kbjsgg7sWXBJgp7wa9uRc',
  }, {
    findContentPostPda(author, contentId) {
      assert.equal(author.toBase58(), '7f6P9hKPXxGepL4GAvX8Z64Kbjsgg7sWXBJgp7wa9uRc');
      assert.equal(contentId.toString(), '7449278668049604377');
      return {
        toBase58() {
          return 'DerivedPostPda1111111111111111111111111111';
        },
      };
    },
  });

  assert.equal(derived.toBase58(), 'DerivedPostPda1111111111111111111111111111');
});

test('feed like target surfaces a friendly error when neither a public key nor derivation inputs are usable', () => {
  assert.throws(() => resolveLikeTargetPostPda({
    contentId: 'not-a-post-pda',
    onChainAddress: 'still-not-a-public-key',
    authorPubkey: null,
  }, {
    findContentPostPda() {
      throw new Error('unexpected derivation');
    },
  }), /无法解析帖子链上地址/);
});
