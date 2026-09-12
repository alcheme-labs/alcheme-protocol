import type { JWK } from "jose";
import crypto from "node:crypto";

import { digestJson, stableStringify } from "./digest";

export type AppTrustRootCredentialJwsAlgorithm = "ES256" | "EdDSA" | "RS256";

export interface AppTrustRootPublicJwks {
  keys: JWK[];
}

const ALLOWED_CREDENTIAL_JWS_ALGORITHMS = new Set<string>(["ES256", "EdDSA", "RS256"]);

export function assertCredentialJwsAlgorithmAllowed(algorithm: string): void {
  if (!ALLOWED_CREDENTIAL_JWS_ALGORITHMS.has(algorithm)) {
    throw new Error("app_trust_root_credential_algorithm_not_allowed");
  }
}

export function buildPublicJwks(keys: JWK[]): AppTrustRootPublicJwks {
  return {
    keys: keys.map(stripPrivateJwkFields),
  };
}

export function digestJwkSet(jwks: AppTrustRootPublicJwks): string {
  return digestJson({
    keys: jwks.keys
      .map((key) => ({
        alg: key.alg ?? null,
        crv: key.crv ?? null,
        e: key.e ?? null,
        kid: key.kid ?? null,
        kty: key.kty ?? null,
        n: key.n ?? null,
        use: key.use ?? null,
        x: key.x ?? null,
        y: key.y ?? null,
      }))
      .sort((left, right) => String(left.kid || "").localeCompare(String(right.kid || ""))),
  });
}

export async function signCredentialJws(input: {
  payload: unknown;
  issuerRef: string;
  privateJwk: JWK;
  keyId: string;
  algorithm: AppTrustRootCredentialJwsAlgorithm;
}): Promise<string> {
  assertCredentialJwsAlgorithmAllowed(input.algorithm);
  if (input.privateJwk.kty === "oct") {
    throw new Error("app_trust_root_credential_algorithm_not_allowed");
  }
  if (isJestRuntime()) {
    return signCredentialJwsWithNodeCrypto(input);
  }
  const { CompactSign, importJWK } = await loadJose();
  const key = await importJWK(input.privateJwk, input.algorithm);
  return new CompactSign(new TextEncoder().encode(stableStringify(input.payload)))
    .setProtectedHeader({
      alg: input.algorithm,
      kid: input.keyId,
      typ: "alcheme-app-trust-root+jws",
      iss: input.issuerRef,
    } as any)
    .sign(key);
}

export async function verifyCredentialJws(input: {
  jws: string;
  jwks: AppTrustRootPublicJwks;
  expectedIssuerRef: string;
  expectedCredentialType: string;
}): Promise<{ protectedHeader: Record<string, unknown>; payload: unknown }> {
  if (isJestRuntime()) {
    return verifyCredentialJwsWithNodeCrypto(input);
  }
  const { compactVerify, createLocalJWKSet } = await loadJose();
  const result = await compactVerify(input.jws, createLocalJWKSet(input.jwks));
  const protectedHeader = result.protectedHeader as Record<string, unknown>;
  assertCredentialJwsAlgorithmAllowed(String(protectedHeader.alg || ""));
  if (protectedHeader.iss !== input.expectedIssuerRef) {
    throw new Error("app_trust_root_credential_issuer_mismatch");
  }
  const payload = JSON.parse(new TextDecoder().decode(result.payload)) as unknown;
  if (!payload || typeof payload !== "object" || Array.isArray(payload)) {
    throw new Error("app_trust_root_credential_payload_invalid");
  }
  if ((payload as { credentialType?: unknown }).credentialType !== input.expectedCredentialType) {
    throw new Error("app_trust_root_credential_type_mismatch");
  }
  return { protectedHeader, payload };
}

function stripPrivateJwkFields(key: JWK): JWK {
  const {
    d: _d,
    dp: _dp,
    dq: _dq,
    k: _k,
    oth: _oth,
    p: _p,
    q: _q,
    qi: _qi,
    ...publicOnly
  } = key as Record<string, unknown>;
  return publicOnly as JWK;
}

function signCredentialJwsWithNodeCrypto(input: {
  payload: unknown;
  issuerRef: string;
  privateJwk: JWK;
  keyId: string;
  algorithm: AppTrustRootCredentialJwsAlgorithm;
}): string {
  const protectedHeader = {
    alg: input.algorithm,
    kid: input.keyId,
    typ: "alcheme-app-trust-root+jws",
    iss: input.issuerRef,
  };
  const signingInput = [
    base64UrlEncode(stableStringify(protectedHeader)),
    base64UrlEncode(stableStringify(input.payload)),
  ].join(".");
  const signature = signJwsInput(input.algorithm, signingInput, input.privateJwk);
  return `${signingInput}.${base64UrlEncode(signature)}`;
}

function verifyCredentialJwsWithNodeCrypto(input: {
  jws: string;
  jwks: AppTrustRootPublicJwks;
  expectedIssuerRef: string;
  expectedCredentialType: string;
}): { protectedHeader: Record<string, unknown>; payload: unknown } {
  const parts = input.jws.split(".");
  if (parts.length !== 3) throw new Error("app_trust_root_credential_jws_invalid");
  const protectedHeader = JSON.parse(base64UrlDecodeToString(parts[0])) as Record<string, unknown>;
  assertCredentialJwsAlgorithmAllowed(String(protectedHeader.alg || ""));
  if (protectedHeader.iss !== input.expectedIssuerRef) {
    throw new Error("app_trust_root_credential_issuer_mismatch");
  }
  const key = input.jwks.keys.find((candidate) => candidate.kid === protectedHeader.kid);
  if (!key) throw new Error("app_trust_root_credential_key_not_found");
  const signingInput = `${parts[0]}.${parts[1]}`;
  const signature = base64UrlDecode(parts[2]);
  if (!verifyJwsInput(String(protectedHeader.alg), signingInput, signature, key)) {
    throw new Error("app_trust_root_credential_signature_invalid");
  }
  const payload = JSON.parse(base64UrlDecodeToString(parts[1])) as unknown;
  if (!payload || typeof payload !== "object" || Array.isArray(payload)) {
    throw new Error("app_trust_root_credential_payload_invalid");
  }
  if ((payload as { credentialType?: unknown }).credentialType !== input.expectedCredentialType) {
    throw new Error("app_trust_root_credential_type_mismatch");
  }
  return { protectedHeader, payload };
}

function signJwsInput(
  algorithm: AppTrustRootCredentialJwsAlgorithm,
  signingInput: string,
  privateJwk: JWK,
): Buffer {
  const key = crypto.createPrivateKey({ key: privateJwk as any, format: "jwk" });
  if (algorithm === "ES256") {
    return crypto.sign("sha256", Buffer.from(signingInput), {
      key,
      dsaEncoding: "ieee-p1363",
    });
  }
  if (algorithm === "RS256") {
    return crypto.sign("RSA-SHA256", Buffer.from(signingInput), key);
  }
  return crypto.sign(null, Buffer.from(signingInput), key);
}

function verifyJwsInput(
  algorithm: string,
  signingInput: string,
  signature: Buffer,
  publicJwk: JWK,
): boolean {
  const key = crypto.createPublicKey({ key: publicJwk as any, format: "jwk" });
  if (algorithm === "ES256") {
    return crypto.verify("sha256", Buffer.from(signingInput), {
      key,
      dsaEncoding: "ieee-p1363",
    }, signature);
  }
  if (algorithm === "RS256") {
    return crypto.verify("RSA-SHA256", Buffer.from(signingInput), key, signature);
  }
  return crypto.verify(null, Buffer.from(signingInput), key, signature);
}

function base64UrlEncode(value: string | Buffer): string {
  return Buffer.from(value).toString("base64url");
}

function base64UrlDecode(value: string): Buffer {
  return Buffer.from(value, "base64url");
}

function base64UrlDecodeToString(value: string): string {
  return base64UrlDecode(value).toString("utf8");
}

function isJestRuntime(): boolean {
  return Boolean(process.env.JEST_WORKER_ID);
}

async function loadJose(): Promise<typeof import("jose")> {
  const importer = new Function("specifier", "return import(specifier)") as (
    specifier: string,
  ) => Promise<typeof import("jose")>;
  return importer("jose");
}
