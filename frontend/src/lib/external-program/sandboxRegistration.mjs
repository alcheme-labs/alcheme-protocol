export const SANDBOX_REGISTRATION_AUDIENCE =
  'alcheme:external-app-sandbox-registration';

export function normalizeSandboxExternalProgramManifest(input) {
  const appId = normalizeAppId(input.appId);
  const name = requiredString(input.name, 'invalid_external_app_manifest');
  const ownerWallet = requiredString(input.ownerWallet, 'invalid_external_app_manifest');
  const serverPublicKey = requiredString(input.serverPublicKey, 'invalid_external_app_manifest');
  const homeUrl = normalizeHomeUrl(input.homeUrl);
  const allowedOrigins = uniqueSorted(
    (Array.isArray(input.allowedOrigins) ? input.allowedOrigins : [])
      .map(normalizeAllowedOrigin),
  );
  if (allowedOrigins.length === 0) throw new Error('invalid_external_app_manifest');

  const manifest = {
    version: '1',
    appId,
    name,
    homeUrl,
    ownerWallet,
    serverPublicKey,
    allowedOrigins,
    capabilities: (Array.isArray(input.capabilities) ? input.capabilities : [])
      .map((capability) => String(capability).trim())
      .filter(Boolean),
  };

  for (const key of ['platforms', 'callbacks', 'policy']) {
    if (isRecord(input[key])) manifest[key] = input[key];
  }
  return manifest;
}

export async function computeSandboxExternalProgramManifestHash(input) {
  const normalized = normalizeSandboxExternalProgramManifest(input);
  return sha256Digest(stableStringify(normalized));
}

export function buildSandboxExternalProgramOwnerAssertionPayload(input) {
  return {
    appId: normalizeAppId(input.appId),
    ownerWallet: requiredString(input.ownerWallet, 'invalid_external_app_ownerWallet'),
    manifestHash: normalizeSha256Digest(input.manifestHash),
    audience: SANDBOX_REGISTRATION_AUDIENCE,
    expiresAt: requiredString(input.expiresAt, 'invalid_external_app_expiresAt'),
    nonce: requiredString(input.nonce, 'invalid_external_app_nonce'),
  };
}

export function encodeExternalProgramOwnerAssertionPayload(input) {
  return base64UrlEncode(stableStringify(
    buildSandboxExternalProgramOwnerAssertionPayload(input),
  ));
}

export function bytesToBase64(bytes) {
  let binary = '';
  for (const byte of bytes) binary += String.fromCharCode(byte);
  return btoa(binary);
}

export function stableStringify(value) {
  if (Array.isArray(value)) {
    return `[${value.map(stableStringify).join(',')}]`;
  }
  if (value && typeof value === 'object') {
    return `{${Object.keys(value).sort().map((key) =>
      `${JSON.stringify(key)}:${stableStringify(value[key])}`,
    ).join(',')}}`;
  }
  return JSON.stringify(value);
}

function normalizeAppId(value) {
  const normalized = String(value || '').trim().toLowerCase();
  if (!/^[a-z0-9][a-z0-9-]{1,47}$/.test(normalized)) {
    throw new Error('invalid_external_app_appId');
  }
  return normalized;
}

function requiredString(value, errorCode) {
  const normalized = String(value || '').trim();
  if (!normalized) throw new Error(errorCode);
  return normalized;
}

function normalizeHomeUrl(value) {
  let url;
  try {
    url = new URL(String(value || '').trim());
  } catch {
    throw new Error('invalid_external_app_manifest');
  }
  if (url.protocol === 'https:') return url.toString();
  if (url.protocol === 'http:' && isLocalDevelopmentHost(url.hostname)) {
    return url.toString();
  }
  throw new Error('invalid_external_app_manifest');
}

function normalizeAllowedOrigin(value) {
  let url;
  try {
    url = new URL(String(value || '').trim());
  } catch {
    throw new Error('invalid_external_app_manifest');
  }
  if (
    !['http:', 'https:'].includes(url.protocol)
    || url.username
    || url.password
    || url.pathname !== '/'
    || url.search
    || url.hash
    || (url.protocol === 'http:' && !isLocalDevelopmentHost(url.hostname))
  ) {
    throw new Error('invalid_external_app_manifest');
  }
  return url.origin;
}

function isLocalDevelopmentHost(hostname) {
  return ['localhost', '127.0.0.1', '::1', '[::1]'].includes(hostname);
}

function normalizeSha256Digest(value) {
  const normalized = String(value || '').trim().toLowerCase();
  if (!/^sha256:[0-9a-f]{64}$/.test(normalized)) {
    throw new Error('invalid_external_app_manifestHash');
  }
  return normalized;
}

function isRecord(value) {
  return Boolean(value && typeof value === 'object' && !Array.isArray(value));
}

function uniqueSorted(values) {
  return Array.from(new Set(values.filter(Boolean))).sort();
}

async function sha256Digest(value) {
  const bytes = new TextEncoder().encode(value);
  const buffer = await globalThis.crypto.subtle.digest('SHA-256', bytes);
  return `sha256:${Array.from(new Uint8Array(buffer))
    .map((byte) => byte.toString(16).padStart(2, '0'))
    .join('')}`;
}

function base64UrlEncode(value) {
  return bytesToBase64(new TextEncoder().encode(value))
    .replace(/\+/g, '-')
    .replace(/\//g, '_')
    .replace(/=+$/g, '');
}
