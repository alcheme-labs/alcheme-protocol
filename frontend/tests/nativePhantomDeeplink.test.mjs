import test from 'node:test';
import assert from 'node:assert/strict';

import bs58 from 'bs58';
import nacl from 'tweetnacl';

import {
  assertNativePhantomTransactionSigningSupported,
  buildPhantomConnectUrl,
  buildPhantomProviderMethodUrl,
  decryptPhantomConnectCallback,
  decryptPhantomProviderCallback,
  encryptPhantomPayload,
  isLikelyLocalSolanaRpcUrl,
  resolveNativePhantomProviderErrorMessage,
  resolveNativePhantomTransportUrl,
  shouldRefreshNativePhantomSessionOnError,
} from '../config/nativePhantomDeeplink.mjs';

test('buildPhantomConnectUrl embeds redirect request id and encryption key', () => {
  const keypair = nacl.box.keyPair();
  const url = buildPhantomConnectUrl({
    appUrl: 'http://127.0.0.1:3000',
    cluster: 'devnet',
    redirectUrl: 'alcheme://wallet/callback',
    dappEncryptionPublicKey: bs58.encode(keypair.publicKey),
    requestId: 'req-connect-1',
  });

  assert.equal(url.origin, 'https://phantom.app');
  assert.equal(url.pathname, '/ul/v1/connect');
  assert.equal(url.searchParams.get('app_url'), 'http://127.0.0.1:3000');
  assert.equal(url.searchParams.get('cluster'), 'devnet');
  assert.equal(
    url.searchParams.get('dapp_encryption_public_key'),
    bs58.encode(keypair.publicKey),
  );

  const redirect = new URL(url.searchParams.get('redirect_link'));
  assert.equal(redirect.protocol, 'alcheme:');
  assert.equal(redirect.host, 'wallet');
  assert.equal(redirect.pathname, '/callback');
  assert.equal(redirect.searchParams.get('request_id'), 'req-connect-1');
});

test('decryptPhantomConnectCallback decodes encrypted public key and session payload', () => {
  const dappKeypair = nacl.box.keyPair();
  const phantomKeypair = nacl.box.keyPair();
  const sharedSecret = nacl.box.before(phantomKeypair.publicKey, dappKeypair.secretKey);
  const nonce = nacl.randomBytes(nacl.box.nonceLength);
  const payload = new TextEncoder().encode(
    JSON.stringify({
      public_key: '4Nd1m7x6oXUe4mS9m9W7zX9jP1Qw2a3s4d5f6g7h8i9J',
      session: 'session-token-123',
    }),
  );
  const encrypted = nacl.box.after(payload, nonce, sharedSecret);
  const callbackUrl = new URL('alcheme://wallet/callback');
  callbackUrl.searchParams.set('request_id', 'req-connect-1');
  callbackUrl.searchParams.set(
    'phantom_encryption_public_key',
    bs58.encode(phantomKeypair.publicKey),
  );
  callbackUrl.searchParams.set('nonce', bs58.encode(nonce));
  callbackUrl.searchParams.set('data', bs58.encode(encrypted));

  const result = decryptPhantomConnectCallback({
    callbackUrl: callbackUrl.toString(),
    dappEncryptionSecretKey: dappKeypair.secretKey,
  });

  assert.equal(result.requestId, 'req-connect-1');
  assert.equal(result.phantomEncryptionPublicKey, bs58.encode(phantomKeypair.publicKey));
  assert.equal(result.publicKey, '4Nd1m7x6oXUe4mS9m9W7zX9jP1Qw2a3s4d5f6g7h8i9J');
  assert.equal(result.session, 'session-token-123');
});

test('buildPhantomProviderMethodUrl encrypts payload and preserves request id in callback', () => {
  const dappKeypair = nacl.box.keyPair();
  const phantomKeypair = nacl.box.keyPair();
  const sharedSecret = nacl.box.before(phantomKeypair.publicKey, dappKeypair.secretKey);
  const url = buildPhantomProviderMethodUrl({
    method: 'signMessage',
    redirectUrl: 'alcheme://wallet/callback',
    dappEncryptionPublicKey: bs58.encode(dappKeypair.publicKey),
    sharedSecret,
    payload: {
      session: 'session-token-123',
      message: bs58.encode(new TextEncoder().encode('hello phantom')),
      display: 'utf8',
    },
    requestId: 'req-sign-message-1',
  });

  assert.equal(url.pathname, '/ul/v1/signMessage');
  assert.equal(
    url.searchParams.get('dapp_encryption_public_key'),
    bs58.encode(dappKeypair.publicKey),
  );
  assert.ok(url.searchParams.get('nonce'));
  assert.ok(url.searchParams.get('payload'));

  const redirect = new URL(url.searchParams.get('redirect_link'));
  assert.equal(redirect.searchParams.get('request_id'), 'req-sign-message-1');
});

test('resolveNativePhantomTransportUrl can keep Phantom provider requests on the universal link', () => {
  const universalLink = buildPhantomConnectUrl({
    appUrl: 'http://127.0.0.1:3000',
    cluster: 'devnet',
    redirectUrl: 'alcheme://wallet/callback',
    dappEncryptionPublicKey: bs58.encode(nacl.box.keyPair().publicKey),
    requestId: 'req-connect-1',
  });

  const transportUrl = resolveNativePhantomTransportUrl(universalLink);

  assert.equal(transportUrl.protocol, 'https:');
  assert.equal(transportUrl.host, 'phantom.app');
  assert.equal(transportUrl.pathname, '/ul/v1/connect');
  assert.equal(transportUrl.searchParams.get('cluster'), 'devnet');
  assert.equal(transportUrl.searchParams.get('app_url'), 'http://127.0.0.1:3000');
});

test('resolveNativePhantomTransportUrl can force Phantom protocol links for native Android shells', () => {
  const universalLink = buildPhantomConnectUrl({
    appUrl: 'http://127.0.0.1:3000',
    cluster: 'devnet',
    redirectUrl: 'alcheme://wallet/callback',
    dappEncryptionPublicKey: bs58.encode(nacl.box.keyPair().publicKey),
    requestId: 'req-connect-1',
  });

  const transportUrl = resolveNativePhantomTransportUrl(universalLink, {
    preferProtocolHandler: true,
  });

  assert.equal(transportUrl.protocol, 'phantom:');
  assert.equal(transportUrl.host, 'v1');
  assert.equal(transportUrl.pathname, '/connect');
  assert.equal(transportUrl.searchParams.get('cluster'), 'devnet');
});

test('decryptPhantomProviderCallback decodes encrypted response payload', () => {
  const dappKeypair = nacl.box.keyPair();
  const phantomKeypair = nacl.box.keyPair();
  const sharedSecret = nacl.box.before(phantomKeypair.publicKey, dappKeypair.secretKey);
  const encrypted = encryptPhantomPayload({
    payload: { signature: bs58.encode(new Uint8Array([1, 2, 3, 4])) },
    sharedSecret,
    nonce: new Uint8Array(Array.from({ length: nacl.box.nonceLength }, (_, index) => index + 1)),
  });

  const callbackUrl = new URL('alcheme://wallet/callback');
  callbackUrl.searchParams.set('request_id', 'req-sign-message-1');
  callbackUrl.searchParams.set('nonce', encrypted.nonce);
  callbackUrl.searchParams.set('data', encrypted.data);

  const result = decryptPhantomProviderCallback({
    callbackUrl: callbackUrl.toString(),
    sharedSecret,
  });

  assert.equal(result.requestId, 'req-sign-message-1');
  assert.deepEqual(result.payload, {
    signature: bs58.encode(new Uint8Array([1, 2, 3, 4])),
  });
});

test('recognizes localhost-style RPC endpoints as unsupported for Phantom mobile transaction signing', () => {
  assert.equal(isLikelyLocalSolanaRpcUrl('http://127.0.0.1:8899'), true);
  assert.equal(isLikelyLocalSolanaRpcUrl('http://localhost:8899'), true);
  assert.equal(isLikelyLocalSolanaRpcUrl('http://10.0.0.158:8899'), true);
  assert.equal(isLikelyLocalSolanaRpcUrl('https://api.devnet.solana.com'), false);
});

test('maps Phantom generic transaction errors on local RPCs to an actionable message', () => {
  assert.match(
    resolveNativePhantomProviderErrorMessage({
      errorCode: '-32603',
      errorMessage: 'Unexpected error',
      rpcUrl: 'http://127.0.0.1:8899',
    }),
    /不支持本地 localnet/i,
  );
});

test('throws a clear localnet message before opening Phantom for unsupported transaction signing', () => {
  assert.throws(
    () => assertNativePhantomTransactionSigningSupported('http://127.0.0.1:8899'),
    /不支持本地 localnet/i,
  );
});

test('marks Phantom internal provider errors as a signal to refresh the cached deeplink session', () => {
  assert.equal(
    shouldRefreshNativePhantomSessionOnError({
      code: '-32603',
      message: 'Unexpected error',
    }),
    true,
  );

  assert.equal(
    shouldRefreshNativePhantomSessionOnError({
      code: '4001',
      message: 'User Rejected Request',
    }),
    false,
  );
});
