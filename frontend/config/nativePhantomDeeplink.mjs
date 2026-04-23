import bs58 from 'bs58';
import nacl from 'tweetnacl';

export const PHANTOM_DEEPLINK_ORIGIN = 'https://phantom.app';
export const PHANTOM_DEEPLINK_BASE_PATH = '/ul/v1';
export const NATIVE_PHANTOM_UNSUPPORTED_LOCALNET_MESSAGE = 'Phantom 移动端当前只支持 mainnet-beta、testnet、devnet，不支持本地 localnet（如 127.0.0.1 / 局域网 8899）交易签名。连接钱包与消息签名可以继续使用，但链上写操作请切到 devnet/testnet/mainnet-beta，或改用本地测试钱包。';

const textEncoder = new TextEncoder();
const textDecoder = new TextDecoder();

function withRequestId(redirectUrl, requestId) {
  const url = new URL(redirectUrl);
  url.searchParams.set('request_id', requestId);
  return url.toString();
}

function buildProviderUrl(method) {
  return new URL(`${PHANTOM_DEEPLINK_BASE_PATH}/${method}`, PHANTOM_DEEPLINK_ORIGIN);
}

function decodeEncryptedJson({ nonce, data, sharedSecret }) {
  const decrypted = nacl.box.open.after(bs58.decode(data), bs58.decode(nonce), sharedSecret);
  if (!decrypted) {
    throw new Error('Failed to decrypt Phantom callback payload.');
  }

  return JSON.parse(textDecoder.decode(decrypted));
}

function isPrivateIpv4(hostname) {
  if (/^10\.\d{1,3}\.\d{1,3}\.\d{1,3}$/.test(hostname)) {
    return true;
  }

  if (/^192\.168\.\d{1,3}\.\d{1,3}$/.test(hostname)) {
    return true;
  }

  const match = hostname.match(/^172\.(\d{1,3})\.\d{1,3}\.\d{1,3}$/);
  if (!match) {
    return false;
  }

  const secondOctet = Number.parseInt(match[1], 10);
  return secondOctet >= 16 && secondOctet <= 31;
}

export function isLikelyLocalSolanaRpcUrl(rpcUrl) {
  const value = String(rpcUrl || '').trim();
  if (!value) {
    return false;
  }

  try {
    const url = new URL(value);
    const hostname = url.hostname.toLowerCase();
    const port = url.port || (url.protocol === 'https:' ? '443' : '80');

    if (
      hostname === 'localhost'
      || hostname === '127.0.0.1'
      || hostname === '0.0.0.0'
      || hostname === '::1'
      || hostname.endsWith('.local')
    ) {
      return true;
    }

    return port === '8899' && isPrivateIpv4(hostname);
  } catch {
    return false;
  }
}

export function resolveNativePhantomProviderErrorMessage({
  errorCode,
  errorMessage,
  rpcUrl,
}) {
  if (
    errorCode === '-32603'
    && String(errorMessage || '').trim().toLowerCase() === 'unexpected error'
    && isLikelyLocalSolanaRpcUrl(rpcUrl)
  ) {
    return NATIVE_PHANTOM_UNSUPPORTED_LOCALNET_MESSAGE;
  }

  return errorMessage || 'Phantom request failed.';
}

export function assertNativePhantomTransactionSigningSupported(rpcUrl) {
  if (!isLikelyLocalSolanaRpcUrl(rpcUrl)) {
    return;
  }

  const error = new Error(NATIVE_PHANTOM_UNSUPPORTED_LOCALNET_MESSAGE);
  error.name = 'NativePhantomWalletError';
  error.code = 'LOCAL_RPC_UNSUPPORTED';
  throw error;
}

function assertNoCallbackError(url, options = {}) {
  const errorCode = url.searchParams.get('errorCode');
  const errorMessage = url.searchParams.get('errorMessage');

  if (!errorCode && !errorMessage) {
    return;
  }

  const error = new Error(resolveNativePhantomProviderErrorMessage({
    errorCode,
    errorMessage,
    rpcUrl: options.rpcUrl,
  }));
  error.name = 'NativePhantomWalletError';
  error.code = errorCode || 'UNKNOWN';
  throw error;
}

export function createPhantomEncryptionKeypair() {
  return nacl.box.keyPair();
}

export function derivePhantomSharedSecret({
  dappEncryptionSecretKey,
  phantomEncryptionPublicKey,
}) {
  return nacl.box.before(
    bs58.decode(phantomEncryptionPublicKey),
    dappEncryptionSecretKey,
  );
}

export function buildPhantomConnectUrl({
  appUrl,
  cluster = 'devnet',
  redirectUrl,
  dappEncryptionPublicKey,
  requestId,
}) {
  const url = buildProviderUrl('connect');
  url.searchParams.set('app_url', appUrl);
  url.searchParams.set('cluster', cluster);
  url.searchParams.set('dapp_encryption_public_key', dappEncryptionPublicKey);
  url.searchParams.set('redirect_link', withRequestId(redirectUrl, requestId));
  return url;
}

export function encryptPhantomPayload({ payload, sharedSecret, nonce = nacl.randomBytes(nacl.box.nonceLength) }) {
  const message = textEncoder.encode(JSON.stringify(payload));
  const encrypted = nacl.box.after(message, nonce, sharedSecret);
  return {
    nonce: bs58.encode(nonce),
    data: bs58.encode(encrypted),
  };
}

export function buildPhantomProviderMethodUrl({
  method,
  redirectUrl,
  dappEncryptionPublicKey,
  sharedSecret,
  payload,
  requestId,
}) {
  const url = buildProviderUrl(method);
  const encrypted = encryptPhantomPayload({ payload, sharedSecret });
  url.searchParams.set('dapp_encryption_public_key', dappEncryptionPublicKey);
  url.searchParams.set('redirect_link', withRequestId(redirectUrl, requestId));
  url.searchParams.set('nonce', encrypted.nonce);
  url.searchParams.set('payload', encrypted.data);
  return url;
}

export function resolveNativePhantomTransportUrl(urlLike, options = {}) {
  if (options.preferProtocolHandler) {
    return toPhantomProtocolHandlerUrl(urlLike);
  }

  return urlLike instanceof URL ? new URL(urlLike.toString()) : new URL(String(urlLike));
}

export function toPhantomProtocolHandlerUrl(urlLike) {
  const url = urlLike instanceof URL ? new URL(urlLike.toString()) : new URL(String(urlLike));
  const protocolPath = url.pathname.startsWith('/ul/') ? url.pathname.slice('/ul/'.length) : url.pathname.replace(/^\//, '');
  return new URL(`phantom://${protocolPath}${url.search}`);
}

export function shouldRefreshNativePhantomSessionOnError(errorLike) {
  if (!errorLike || typeof errorLike !== 'object') {
    return false;
  }

  const code = typeof errorLike.code === 'string' ? errorLike.code.trim() : '';
  const message = typeof errorLike.message === 'string' ? errorLike.message.trim().toLowerCase() : '';

  return code === '-32603' && message === 'unexpected error';
}

export function decryptPhantomConnectCallback({
  callbackUrl,
  dappEncryptionSecretKey,
  rpcUrl,
}) {
  const url = new URL(callbackUrl);
  assertNoCallbackError(url, { rpcUrl });

  const phantomEncryptionPublicKey = url.searchParams.get('phantom_encryption_public_key');
  const nonce = url.searchParams.get('nonce');
  const data = url.searchParams.get('data');

  if (!phantomEncryptionPublicKey || !nonce || !data) {
    throw new Error('Incomplete Phantom connect callback.');
  }

  const sharedSecret = derivePhantomSharedSecret({
    dappEncryptionSecretKey,
    phantomEncryptionPublicKey,
  });
  const payload = decodeEncryptedJson({ nonce, data, sharedSecret });

  return {
    requestId: url.searchParams.get('request_id'),
    phantomEncryptionPublicKey,
    sharedSecret,
    publicKey: payload.public_key,
    session: payload.session,
  };
}

export function decryptPhantomProviderCallback({ callbackUrl, sharedSecret }) {
  const url = new URL(callbackUrl);
  assertNoCallbackError(url, { rpcUrl: process.env.NEXT_PUBLIC_SOLANA_RPC_URL });

  const nonce = url.searchParams.get('nonce');
  const data = url.searchParams.get('data');

  if (!nonce || !data) {
    return {
      requestId: url.searchParams.get('request_id'),
      payload: null,
    };
  }

  return {
    requestId: url.searchParams.get('request_id'),
    payload: decodeEncryptedJson({ nonce, data, sharedSecret }),
  };
}
