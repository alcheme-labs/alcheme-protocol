import { createHash } from "node:crypto";

import type { PrismaClient } from "@prisma/client";
import bs58 from "bs58";
import nacl from "tweetnacl";

export const EXTERNAL_APP_SERVER_KEY_PROOF_VERSION =
  "external_app_server_key_proof.v1";
export const EXTERNAL_APP_SERVER_KEY_PROOF_AUDIENCE =
  "alcheme:external-app-server-key-possession";

export interface ExternalAppServerKeyProofEnvelope {
  payload: string;
  signature: string;
}

export interface ExternalAppServerKeyProofPayload {
  proofVersion: typeof EXTERNAL_APP_SERVER_KEY_PROOF_VERSION;
  appId: string;
  manifestHash?: string;
  serverPublicKeyHash: string;
  audience: typeof EXTERNAL_APP_SERVER_KEY_PROOF_AUDIENCE;
  expiresAt: string;
  nonce: string;
}

export interface ExternalAppServerKeyVerificationStatus {
  required: boolean;
  verified: boolean;
  verifiedAt: string | null;
  fingerprint: string | null;
}

type ServerKeyProofPrisma = Pick<PrismaClient, "externalApp">;

export function computeExternalAppServerKeyHash(
  serverPublicKey: string,
): string {
  return createHash("sha256")
    .update(
      JSON.stringify({
        domain: "alcheme:external-app-server-key:v2",
        serverPublicKey: String(serverPublicKey || "").trim(),
      }),
    )
    .digest("hex");
}

export function verifyExternalAppServerKeyProof(input: {
  proof: ExternalAppServerKeyProofEnvelope;
  expected: {
    appId: string;
    serverPublicKey: string;
    manifestHash?: string | null;
  };
  now: Date;
}): ExternalAppServerKeyProofPayload {
  const publicKey = decodeServerPublicKey(input.expected.serverPublicKey);
  const signature = decodeServerKeyProofSignature(input.proof.signature);
  const message = Buffer.from(input.proof.payload);
  if (!nacl.sign.detached.verify(message, signature, publicKey)) {
    throw new Error("external_app_server_key_proof_signature_invalid");
  }

  const payload = decodeServerKeyProofPayload(input.proof.payload);
  const expectedKeyHash = computeExternalAppServerKeyHash(
    input.expected.serverPublicKey,
  );
  if (
    payload.proofVersion !== EXTERNAL_APP_SERVER_KEY_PROOF_VERSION ||
    payload.audience !== EXTERNAL_APP_SERVER_KEY_PROOF_AUDIENCE ||
    payload.appId !== input.expected.appId ||
    payload.serverPublicKeyHash !== expectedKeyHash ||
    (input.expected.manifestHash !== undefined &&
      input.expected.manifestHash !== null &&
      payload.manifestHash !== input.expected.manifestHash)
  ) {
    throw new Error("external_app_server_key_proof_mismatch");
  }
  if (!payload.nonce) {
    throw new Error("external_app_server_key_proof_nonce_required");
  }
  const expiresAtMs = new Date(payload.expiresAt).getTime();
  if (!Number.isFinite(expiresAtMs)) {
    throw new Error("external_app_server_key_proof_payload_invalid");
  }
  if (expiresAtMs <= input.now.getTime()) {
    throw new Error("external_app_server_key_proof_expired");
  }
  return payload;
}

export async function attestRegisteredExternalAppServerKey(
  prisma: ServerKeyProofPrisma,
  input: {
    externalAppId: string;
    proof: ExternalAppServerKeyProofEnvelope;
    now?: Date;
  },
): Promise<ExternalAppServerKeyVerificationStatus> {
  const now = input.now ?? new Date();
  const app = await prisma.externalApp.findUnique({
    where: { id: input.externalAppId },
    select: {
      id: true,
      claimAuthMode: true,
      serverPublicKey: true,
      config: true,
      updatedAt: true,
      environment: true,
    },
  });
  if (!app) throw new Error("external_app_not_found");
  if (app.claimAuthMode !== "server_ed25519" || !app.serverPublicKey) {
    throw new Error("external_app_server_key_proof_not_applicable");
  }
  const payload = verifyExternalAppServerKeyProof({
    proof: input.proof,
    expected: {
      appId: app.id,
      serverPublicKey: app.serverPublicKey,
    },
    now,
  });
  const config = plainObject(app.config);
  const verification = buildStoredServerKeyVerification({
    payload,
    now,
  });
  const update = await prisma.externalApp.updateMany({
    where: {
      id: app.id,
      serverPublicKey: app.serverPublicKey,
      updatedAt: app.updatedAt,
    },
    data: {
      config: {
        ...config,
        serverKeyVerification: verification,
      },
    },
  });
  if (update.count !== 1) {
    throw new Error("external_app_server_key_verification_conflict_retry");
  }
  return projectExternalAppServerKeyVerification({
    environment: app.environment,
    claimAuthMode: app.claimAuthMode,
    serverPublicKey: app.serverPublicKey,
    config: {
      ...config,
      serverKeyVerification: verification,
    },
  });
}

export function buildStoredServerKeyVerification(input: {
  payload: ExternalAppServerKeyProofPayload;
  now: Date;
}) {
  return {
    mode: "server_key_proof_v1",
    keyHash: input.payload.serverPublicKeyHash,
    fingerprint: `sha256:${input.payload.serverPublicKeyHash}`,
    verifiedAt: input.now.toISOString(),
    proofNonce: input.payload.nonce,
    ...(input.payload.manifestHash
      ? { manifestHash: input.payload.manifestHash }
      : {}),
  };
}

export function projectExternalAppServerKeyVerification(input: {
  environment: string;
  claimAuthMode: string;
  serverPublicKey?: string | null;
  config: unknown;
}): ExternalAppServerKeyVerificationStatus {
  const required =
    input.environment === "sandbox" &&
    input.claimAuthMode === "server_ed25519";
  const serverPublicKey = String(input.serverPublicKey || "").trim();
  if (!serverPublicKey) {
    return {
      required,
      verified: false,
      verifiedAt: null,
      fingerprint: null,
    };
  }
  const keyHash = computeExternalAppServerKeyHash(serverPublicKey);
  const verification = plainObject(
    plainObject(input.config).serverKeyVerification,
  );
  const verified =
    verification.mode === "server_key_proof_v1" &&
    verification.keyHash === keyHash &&
    typeof verification.verifiedAt === "string";
  return {
    required,
    verified,
    verifiedAt: verified ? String(verification.verifiedAt) : null,
    fingerprint: `sha256:${keyHash}`,
  };
}

export function normalizeExternalAppServerKeyProof(
  value: unknown,
): ExternalAppServerKeyProofEnvelope {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    throw new Error("external_app_server_key_proof_required");
  }
  const record = value as Record<string, unknown>;
  if (!record.payload || !record.signature) {
    throw new Error("external_app_server_key_proof_required");
  }
  return {
    payload: String(record.payload),
    signature: String(record.signature),
  };
}

function decodeServerPublicKey(value: string): Uint8Array {
  try {
    const publicKey = Uint8Array.from(bs58.decode(value.trim()));
    if (publicKey.length !== 32) throw new Error("invalid length");
    return publicKey;
  } catch {
    throw new Error("external_app_server_key_proof_public_key_invalid");
  }
}

function decodeServerKeyProofSignature(value: string): Uint8Array {
  const signature = Buffer.from(value, "base64");
  if (signature.length !== 64) {
    throw new Error("external_app_server_key_proof_signature_invalid");
  }
  return signature;
}

function decodeServerKeyProofPayload(
  value: string,
): ExternalAppServerKeyProofPayload {
  try {
    const payload = JSON.parse(
      Buffer.from(value, "base64url").toString("utf8"),
    ) as ExternalAppServerKeyProofPayload;
    if (
      !payload.proofVersion ||
      !payload.appId ||
      !payload.serverPublicKeyHash ||
      !payload.audience ||
      !payload.expiresAt
    ) {
      throw new Error("missing required fields");
    }
    return payload;
  } catch {
    throw new Error("external_app_server_key_proof_payload_invalid");
  }
}

function plainObject(value: unknown): Record<string, unknown> {
  return value && typeof value === "object" && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : {};
}
