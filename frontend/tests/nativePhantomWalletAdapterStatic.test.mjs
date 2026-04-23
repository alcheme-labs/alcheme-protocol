import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';

const repoRoot = '/Users/taiyi/Desktop/Project/Future/web3/alcheme-protocol';
const adapterPath = path.join(repoRoot, 'frontend', 'src', 'lib', 'solana', 'nativePhantomWalletAdapter.ts');
const providerPath = path.join(repoRoot, 'frontend', 'src', 'lib', 'solana', 'wallet-provider.tsx');

test('native phantom wallet adapter implements connect and signing hooks over the native bridge', () => {
  const source = fs.readFileSync(adapterPath, 'utf8');

  assert.match(source, /export class NativePhantomWalletAdapter/);
  assert.match(source, /async connect\(\)/);
  assert.match(source, /async signMessage\(/);
  assert.match(source, /async signTransaction/);
  assert.match(source, /async signAllTransactions/);
  assert.match(source, /requestNativeOpenExternalUrl/);
  assert.match(source, /onNativeWalletCallback/);
  assert.match(source, /buildPhantomConnectUrl/);
  assert.match(source, /buildPhantomProviderMethodUrl/);
  assert.doesNotMatch(source, /toPhantomProtocolHandlerUrl/);
  assert.match(source, /shouldRefreshNativePhantomSessionOnError/);
  assert.match(source, /this\.clearSessionRecord\(\)/);
});

test('wallet provider prefers the native phantom adapter when the shell bridge is available', () => {
  const source = fs.readFileSync(providerPath, 'utf8');

  assert.match(source, /NativePhantomWalletAdapter/);
  assert.match(source, /isNativeWalletBridgeAvailable/);
  assert.match(source, /@solana\/wallet-adapter-phantom/);
  assert.match(source, /@solana\/wallet-adapter-solflare/);
  assert.doesNotMatch(source, /@solana\/wallet-adapter-wallets/);
});

test('wallet provider clears a stale native phantom wallet selection when the persisted session is missing', () => {
  const source = fs.readFileSync(providerPath, 'utf8');

  assert.match(source, /NATIVE_PHANTOM_SESSION_STORAGE_KEY/);
  assert.match(source, /walletName === NativePhantomWalletName/);
  assert.match(source, /window\.localStorage\.getItem\(NATIVE_PHANTOM_SESSION_STORAGE_KEY\)/);
  assert.match(source, /window\.localStorage\.removeItem\('walletName'\)/);
});
