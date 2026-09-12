import bs58 from "bs58";
import nacl from "tweetnacl";

export interface ExternalAppOwnerAssertion {
  payload: string;
  signature: string;
}

export interface ExternalAppOwnerAssertionPayload {
  appId: string;
  ownerWallet: string;
  manifestHash: string;
  audience: string;
  expiresAt: string;
  nonce: string;
}

export type ExternalAppKeyOperationOwnerAssertionAudience =
  | "alcheme:external-app-server-key-rotation"
  | "alcheme:external-app-server-key-revocation";

export interface ExternalAppKeyOperationOwnerAssertionPayload {
  appId: string;
  ownerWallet: string;
  audience: ExternalAppKeyOperationOwnerAssertionAudience;
  action:
    | "external_app_server_key_rotate"
    | "external_app_server_key_revoke";
  newServerPublicKeyHash?: string;
  previousKeyVersion?: string;
  previousKeyGraceUntil?: string;
  keyVersion?: string;
  idempotencyKey: string;
  expiresAt: string;
  nonce: string;
}

export function buildExternalAppOwnerAssertionPayload(
  input: ExternalAppOwnerAssertionPayload,
): ExternalAppOwnerAssertionPayload {
  return {
    appId: input.appId.trim().toLowerCase(),
    ownerWallet: input.ownerWallet.trim(),
    manifestHash: input.manifestHash.trim(),
    audience: input.audience.trim(),
    expiresAt: input.expiresAt,
    nonce: input.nonce.trim(),
  };
}

export function encodeExternalAppOwnerAssertionPayload(
  payload: ExternalAppOwnerAssertionPayload,
): string {
  return Buffer.from(JSON.stringify(payload)).toString("base64url");
}

export function buildExternalAppKeyOperationOwnerAssertionPayload(
  input: ExternalAppKeyOperationOwnerAssertionPayload,
): ExternalAppKeyOperationOwnerAssertionPayload {
  return {
    appId: input.appId.trim().toLowerCase(),
    ownerWallet: input.ownerWallet.trim(),
    audience: input.audience,
    action: input.action,
    ...(input.newServerPublicKeyHash
      ? { newServerPublicKeyHash: input.newServerPublicKeyHash.trim().toLowerCase() }
      : {}),
    ...(input.previousKeyVersion
      ? { previousKeyVersion: input.previousKeyVersion.trim() }
      : {}),
    ...(input.previousKeyGraceUntil
      ? { previousKeyGraceUntil: input.previousKeyGraceUntil.trim() }
      : {}),
    ...(input.keyVersion ? { keyVersion: input.keyVersion.trim() } : {}),
    idempotencyKey: input.idempotencyKey.trim(),
    expiresAt: input.expiresAt,
    nonce: input.nonce.trim(),
  };
}

export function encodeExternalAppKeyOperationOwnerAssertionPayload(
  payload: ExternalAppKeyOperationOwnerAssertionPayload,
): string {
  return Buffer.from(JSON.stringify(payload)).toString("base64url");
}

export function extractSolanaOwnerPubkey(ownerWallet: string): string {
  const normalized = ownerWallet.trim();
  const parts = normalized.split(":");
  if (parts.length === 3 && parts[0] === "solana") {
    return parts[2];
  }
  return normalized;
}

export function verifyExternalAppOwnerAssertion(input: {
  assertion: ExternalAppOwnerAssertion;
  expected: {
    appId: string;
    ownerWallet: string;
    manifestHash: string;
    audience: string;
  };
  now: Date;
}): ExternalAppOwnerAssertionPayload {
  const ownerPubkey = extractSolanaOwnerPubkey(input.expected.ownerWallet);
  const publicKey = decodeSolanaPublicKey(ownerPubkey);
  const signature = decodeBase64Signature(input.assertion.signature);
  const message = Buffer.from(input.assertion.payload);
  if (!nacl.sign.detached.verify(message, signature, publicKey)) {
    throw new Error("external_app_owner_assertion_signature_invalid");
  }

  const payload = decodeOwnerAssertionPayload(input.assertion.payload);
  if (
    payload.appId !== input.expected.appId ||
    payload.ownerWallet !== input.expected.ownerWallet ||
    payload.manifestHash !== input.expected.manifestHash ||
    payload.audience !== input.expected.audience
  ) {
    throw new Error("external_app_owner_assertion_mismatch");
  }
  assertOwnerAssertionNotExpired(payload.expiresAt, input.now);
  if (!payload.nonce) {
    throw new Error("external_app_owner_assertion_nonce_required");
  }
  return payload;
}

export function verifyExternalAppKeyOperationOwnerAssertion(input: {
  assertion: ExternalAppOwnerAssertion;
  expected: {
    appId: string;
    ownerPubkey: string;
    audience: ExternalAppKeyOperationOwnerAssertionAudience;
    action:
      | "external_app_server_key_rotate"
      | "external_app_server_key_revoke";
    newServerPublicKeyHash?: string | null;
    previousKeyVersion?: string | null;
    previousKeyGraceUntil?: string | null;
    keyVersion?: string | null;
    idempotencyKey: string;
  };
  now: Date;
}): ExternalAppKeyOperationOwnerAssertionPayload {
  const payload = decodeKeyOperationOwnerAssertionPayload(
    input.assertion.payload,
  );
  const ownerPubkey = extractSolanaOwnerPubkey(payload.ownerWallet);
  const publicKey = decodeSolanaPublicKey(ownerPubkey);
  const signature = decodeBase64Signature(input.assertion.signature);
  const message = Buffer.from(input.assertion.payload);
  if (!nacl.sign.detached.verify(message, signature, publicKey)) {
    throw new Error("external_app_owner_assertion_signature_invalid");
  }

  if (
    payload.appId !== input.expected.appId ||
    ownerPubkey !== input.expected.ownerPubkey ||
    payload.audience !== input.expected.audience ||
    payload.action !== input.expected.action ||
    payload.idempotencyKey !== input.expected.idempotencyKey
  ) {
    throw new Error("external_app_owner_assertion_mismatch");
  }
  if (
    (input.expected.newServerPublicKeyHash || null) !==
    (payload.newServerPublicKeyHash || null)
  ) {
    throw new Error("external_app_owner_assertion_mismatch");
  }
  if (
    (input.expected.previousKeyVersion || null) !==
    (payload.previousKeyVersion || null)
  ) {
    throw new Error("external_app_owner_assertion_mismatch");
  }
  if (
    (input.expected.previousKeyGraceUntil || null) !==
    (payload.previousKeyGraceUntil || null)
  ) {
    throw new Error("external_app_owner_assertion_mismatch");
  }
  if ((input.expected.keyVersion || null) !== (payload.keyVersion || null)) {
    throw new Error("external_app_owner_assertion_mismatch");
  }
  assertOwnerAssertionNotExpired(payload.expiresAt, input.now);
  if (!payload.nonce) {
    throw new Error("external_app_owner_assertion_nonce_required");
  }
  return payload;
}

function decodeSolanaPublicKey(value: string): Uint8Array {
  try {
    const publicKey = Uint8Array.from(bs58.decode(value.trim()));
    if (publicKey.length !== 32) {
      throw new Error("invalid length");
    }
    return publicKey;
  } catch {
    throw new Error("external_app_owner_assertion_public_key_invalid");
  }
}

function assertOwnerAssertionNotExpired(expiresAt: string, now: Date): void {
  const expiresAtMs = new Date(expiresAt).getTime();
  if (!Number.isFinite(expiresAtMs)) {
    throw new Error("external_app_owner_assertion_payload_invalid");
  }
  if (expiresAtMs <= now.getTime()) {
    throw new Error("external_app_owner_assertion_expired");
  }
}

function decodeBase64Signature(value: string): Uint8Array {
  const signature = Buffer.from(value, "base64");
  if (signature.length !== 64) {
    throw new Error("external_app_owner_assertion_signature_invalid");
  }
  return signature;
}

function decodeOwnerAssertionPayload(value: string): ExternalAppOwnerAssertionPayload {
  try {
    const payload = JSON.parse(
      Buffer.from(value, "base64url").toString("utf8"),
    ) as ExternalAppOwnerAssertionPayload;
    if (
      !payload.appId ||
      !payload.ownerWallet ||
      !payload.manifestHash ||
      !payload.audience ||
      !payload.expiresAt
    ) {
      throw new Error("missing required payload fields");
    }
    return payload;
  } catch {
    throw new Error("external_app_owner_assertion_payload_invalid");
  }
}

function decodeKeyOperationOwnerAssertionPayload(
  value: string,
): ExternalAppKeyOperationOwnerAssertionPayload {
  try {
    const payload = JSON.parse(
      Buffer.from(value, "base64url").toString("utf8"),
    ) as ExternalAppKeyOperationOwnerAssertionPayload;
    if (
      !payload.appId ||
      !payload.ownerWallet ||
      !payload.audience ||
      !payload.action ||
      !payload.idempotencyKey ||
      !payload.expiresAt ||
      !payload.nonce
    ) {
      throw new Error("missing fields");
    }
    if (
      payload.audience !== "alcheme:external-app-server-key-rotation" &&
      payload.audience !== "alcheme:external-app-server-key-revocation"
    ) {
      throw new Error("invalid audience");
    }
    if (
      payload.action === "external_app_server_key_rotate" &&
      (!payload.newServerPublicKeyHash || !payload.previousKeyVersion)
    ) {
      throw new Error("missing rotation key binding");
    }
    if (
      payload.action === "external_app_server_key_revoke" &&
      !payload.keyVersion
    ) {
      throw new Error("missing key version");
    }
    return buildExternalAppKeyOperationOwnerAssertionPayload(payload);
  } catch {
    throw new Error("external_app_owner_assertion_payload_invalid");
  }
}
