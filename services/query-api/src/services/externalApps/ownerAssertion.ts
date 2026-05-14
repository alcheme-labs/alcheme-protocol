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
  if (new Date(payload.expiresAt).getTime() <= input.now.getTime()) {
    throw new Error("external_app_owner_assertion_expired");
  }
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
