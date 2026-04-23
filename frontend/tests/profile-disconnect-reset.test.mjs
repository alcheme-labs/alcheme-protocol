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

const { resolveRegisteredProfileItems } = require('../src/lib/auth/walletSurfaceState.ts');
const { E2EWalletAdapter } = require('../src/lib/solana/e2eWalletAdapter.ts');

function createLocalStorage() {
  const store = new Map();
  return {
    getItem(key) {
      return store.has(key) ? store.get(key) : null;
    },
    setItem(key, value) {
      store.set(key, String(value));
    },
    removeItem(key) {
      store.delete(key);
    },
    clear() {
      store.clear();
    },
  };
}

test('registered profile collections are hidden immediately after the viewer disconnects', () => {
  const visibleItems = resolveRegisteredProfileItems({
    walletConnected: false,
    identityState: 'disconnected',
    items: [{ id: 1 }, { id: 2 }],
  });

  assert.deepEqual(visibleItems, []);
});

test('e2e wallet disconnect clears the persisted mock-wallet pubkey', async () => {
  const originalWindow = globalThis.window;
  const localStorage = createLocalStorage();

  globalThis.window = {
    localStorage,
  };

  try {
    localStorage.setItem('alcheme_e2e_wallet_pubkey', 'Stake11111111111111111111111111111111111111');

    const adapter = new E2EWalletAdapter();
    await adapter.connect();
    await adapter.disconnect();

    assert.equal(localStorage.getItem('alcheme_e2e_wallet_pubkey'), null);
  } finally {
    globalThis.window = originalWindow;
  }
});
