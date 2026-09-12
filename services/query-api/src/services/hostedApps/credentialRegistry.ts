import type { PrismaClient } from "@prisma/client";
import type { JWK } from "jose";
import crypto from "node:crypto";
import { PublicKey } from "@solana/web3.js";

import {
  assertCredentialJwsAlgorithmAllowed,
  buildPublicJwks,
  digestJwkSet,
  type AppTrustRootCredentialJwsAlgorithm,
  type AppTrustRootPublicJwks,
} from "../appTrustRoot/credentialJws";
import {
  HOSTED_APP_TRUST_ROOT_PROGRAM_ID,
  buildDefaultHostedAppChainTrustRootReaderFromEnv,
  type HostedAppChainAccountProof,
  type HostedAppChainTrustRootReader,
} from "./chainTrustRoot";
import { assertRevocationFreshness } from "./credentialGovernance";
import { digestJson, stableStringify } from "./digest";
import { assertCredentialAllowedByVerifierPolicy } from "./verifierPolicies";

const HOSTED_APP_CREDENTIAL_ISSUER_SCOPE = "hosted-app-runtime";
const MAX_CREDENTIAL_CHAIN_ANCHOR_AGE_MS = 5 * 60 * 1000;
const HOSTED_APP_CHAIN_HASH_NAMESPACE = "alcheme:hosted-app-trust-root:v1";

export interface HostedAppCredentialChainAnchorRefs {
  issuer?: string;
  schema?: string;
  verifierPolicy?: string;
  revocationSnapshot?: string;
  offlineBundle?: string;
  [key: string]: string | undefined;
}

export interface HostedAppProductionCredentialContext {
  issuerRef: string;
  issuerId: string;
  issuerKeyVersion: string;
  algorithm: AppTrustRootCredentialJwsAlgorithm;
  keyId: string;
  privateJwk: JWK;
  publicJwks: AppTrustRootPublicJwks;
  issuerKeySetDigest: string;
  schemaRef: string;
  schemaDigest: string;
  schemaDocument: unknown;
  verifierPolicyRef: string;
  verifierPolicyDigest: string;
  verifierPolicyDocument: unknown;
  revocationRef: string;
  revocationSnapshotDigest: string;
  revocationSnapshotIssuedAt: string;
  revocationSnapshot: unknown;
  revocationFeedPublicJwk: JWK;
  maxRevocationFeedAgeMs: number;
  chainAnchorRefs: HostedAppCredentialChainAnchorRefs;
  requireChainAnchors: boolean;
}

export interface HostedAppCredentialIssuerTrustAnchor {
  issuerRef: string;
  issuerKeySetDigest: string;
  publicJwks: AppTrustRootPublicJwks;
}

export async function resolveHostedAppProductionCredentialContext(
  prisma: PrismaClient,
  input: {
    credentialType: string;
    schemaRef: string;
    verifierPolicyRef: string;
    now: Date;
    requireChainAnchors?: boolean;
    chainReader?: HostedAppChainTrustRootReader;
  },
): Promise<HostedAppProductionCredentialContext> {
  return resolveProductionCredentialContext(prisma, {
    ...input,
    issuerScope: HOSTED_APP_CREDENTIAL_ISSUER_SCOPE,
    privateKeyEnvPrefix: "HOSTED_APP_CREDENTIAL_PRIVATE_JWK",
  });
}

export async function resolveProductionCredentialContext(
  prisma: PrismaClient,
  input: {
    credentialType: string;
    schemaRef: string;
    verifierPolicyRef: string;
    now: Date;
    issuerScope: string;
    privateKeyEnvPrefix: string;
    requireChainAnchors?: boolean;
    chainReader?: HostedAppChainTrustRootReader;
  },
): Promise<HostedAppProductionCredentialContext> {
  const issuer = await (prisma as any).hostedAppCredentialIssuer?.findFirst?.({
    where: {
      issuerScope: input.issuerScope,
      status: "active",
      validFrom: { lte: input.now },
      OR: [{ expiresAt: null }, { expiresAt: { gt: input.now } }],
    },
    orderBy: [{ validFrom: "desc" }],
  });
  if (!issuer) throw new Error("hosted_app_credential_issuer_unconfigured");
  if (String(issuer.status || "") !== "active") {
    throw new Error("hosted_app_credential_issuer_inactive");
  }
  if (String(issuer.issuerScope || "") !== input.issuerScope) {
    throw new Error("hosted_app_credential_issuer_scope_mismatch");
  }

  const algorithm = String(
    issuer.algorithm || "",
  ) as AppTrustRootCredentialJwsAlgorithm;
  assertCredentialJwsAlgorithmAllowed(algorithm);

  const [schemaId, schemaVersion] = parseRef(input.schemaRef);
  const schema = await (prisma as any).hostedAppCredentialSchema?.findUnique?.({
    where: { schemaId_schemaVersion: { schemaId, schemaVersion } },
  });
  if (!schema || String(schema.credentialType || "") !== input.credentialType) {
    throw new Error("hosted_app_credential_schema_unregistered");
  }
  if (String(schema.status || "") !== "active") {
    throw new Error("hosted_app_credential_schema_inactive");
  }
  if (
    toDate(schema.validFrom, "hosted_app_credential_schema_invalid") > input.now
  ) {
    throw new Error("hosted_app_credential_schema_not_effective");
  }
  if (schema.expiresAt && new Date(schema.expiresAt) <= input.now) {
    throw new Error("hosted_app_credential_schema_expired");
  }
  const schemaDocument = schema.schemaDocument;
  if (!schemaDocument)
    throw new Error("hosted_app_credential_schema_document_missing");
  const schemaDigest = digestJson(schemaDocument);
  if (schema.schemaDigest !== schemaDigest) {
    throw new Error("hosted_app_credential_schema_digest_mismatch");
  }

  const [policyId, policyVersion] = parseRef(input.verifierPolicyRef);
  const policy = await (
    prisma as any
  ).hostedAppCredentialVerifierPolicy?.findUnique?.({
    where: { policyId_policyVersion: { policyId, policyVersion } },
  });
  if (!policy) throw new Error("hosted_app_verifier_policy_unregistered");
  if (String(policy.status || "") !== "active") {
    throw new Error("hosted_app_verifier_policy_inactive");
  }
  if (
    toDate(policy.validFrom, "hosted_app_verifier_policy_invalid") > input.now
  ) {
    throw new Error("hosted_app_verifier_policy_not_effective");
  }
  if (policy.expiresAt && new Date(policy.expiresAt) <= input.now) {
    throw new Error("hosted_app_verifier_policy_expired");
  }
  const verifierPolicyDocument = policy.policyDocument;
  const verifierPolicyDigest = digestJson(verifierPolicyDocument);
  if (policy.policyDigest !== verifierPolicyDigest) {
    throw new Error("hosted_app_verifier_policy_digest_mismatch");
  }

  const revocationRef = String(
    issuer.revocationFeedRef || "hosted-app-credential-revocations",
  );
  const revocationSnapshot = await (
    prisma as any
  ).hostedAppCredentialRevocationSnapshot?.findFirst?.({
    where: { feedRef: revocationRef },
    orderBy: [{ issuedAt: "desc" }],
  });
  if (!revocationSnapshot)
    throw new Error("hosted_app_revocation_snapshot_missing");
  const normalizedRevocationSnapshot =
    normalizeRevocationSnapshot(revocationSnapshot);
  const revocationFeedPublicJwk = resolveRevocationFeedPublicJwk({
    issuerRevocationPolicy: issuer.revocationPolicy,
    feedPolicyRef: String(normalizedRevocationSnapshot.feedPolicyRef || ""),
  });
  assertRevocationSnapshotProof(
    normalizedRevocationSnapshot,
    revocationSnapshot,
    {
      now: input.now,
      publicJwk: revocationFeedPublicJwk,
    },
  );

  const maxRevocationFeedAgeMs = readMaxRevocationFeedAgeMs(
    verifierPolicyDocument,
    revocationSnapshot,
  );
  const revocationSnapshotIssuedAt = toIsoDate(
    revocationSnapshot.issuedAt,
    "hosted_app_revocation_snapshot_invalid",
  );
  assertRevocationFreshness({
    credentialType: input.credentialType,
    revocationSnapshotIssuedAt,
    now: input.now.toISOString(),
    maxRevocationFeedAgeMs,
    staleFeedFailureMode: "fail_closed",
  });
  assertCredentialAllowedByVerifierPolicy(verifierPolicyDocument, {
    credentialType: input.credentialType,
    algorithm,
    issuerActive: true,
    schemaActive: true,
    revocationFresh: true,
  });

  const issuerRef = `${issuer.id}:${issuer.keyVersion}`;
  assertCredentialNotRevoked(normalizedRevocationSnapshot, {
    issuerRef,
    schemaRef: input.schemaRef,
  });
  const privateJwk = readPrivateJwkFromEnv(
    issuer.signingKeyRef,
    input.privateKeyEnvPrefix,
  );
  const issuerPublicJwk = readIssuerPublicJwk(issuer.publicJwk);
  const keyId = String(issuer.publicKeyRef || privateJwk.kid || "");
  if (!keyId) throw new Error("hosted_app_credential_key_id_missing");
  const publicJwks = buildPublicJwks([
    {
      ...issuerPublicJwk,
      kid: keyId,
      alg: algorithm,
    } as JWK,
  ]);
  const signingPublicJwks = buildPublicJwks([
    {
      ...privateJwk,
      kid: keyId,
      alg: algorithm,
    } as JWK,
  ]);
  if (digestJwkSet(publicJwks) !== digestJwkSet(signingPublicJwks)) {
    throw new Error("hosted_app_credential_key_mismatch");
  }
  const chainAnchorRefs = await resolveProductionCredentialChainAnchorRefs(
    prisma,
    {
      requireChainAnchors: input.requireChainAnchors === true,
      issuerRef,
      issuerKeySetDigest: digestJwkSet(publicJwks),
      schemaRef: input.schemaRef,
      schemaDigest,
      verifierPolicyRef: input.verifierPolicyRef,
      verifierPolicyDigest,
      revocationRef,
      revocationSnapshotDigest: String(
        normalizedRevocationSnapshot.snapshotDigest || "",
      ),
      now: input.now,
      chainReader: input.chainReader,
    },
  );

  return {
    issuerRef,
    issuerId: String(issuer.id || ""),
    issuerKeyVersion: String(issuer.keyVersion || ""),
    algorithm,
    keyId,
    privateJwk,
    publicJwks,
    issuerKeySetDigest: digestJwkSet(publicJwks),
    schemaRef: input.schemaRef,
    schemaDigest,
    schemaDocument,
    verifierPolicyRef: input.verifierPolicyRef,
    verifierPolicyDigest,
    verifierPolicyDocument,
    revocationRef,
    revocationSnapshotDigest: String(
      normalizedRevocationSnapshot.snapshotDigest || "",
    ),
    revocationSnapshotIssuedAt,
    revocationSnapshot: normalizedRevocationSnapshot,
    revocationFeedPublicJwk,
    maxRevocationFeedAgeMs,
    chainAnchorRefs,
    requireChainAnchors: input.requireChainAnchors === true,
  };
}

async function resolveProductionCredentialChainAnchorRefs(
  prisma: PrismaClient,
  input: {
    requireChainAnchors: boolean;
    issuerRef: string;
    issuerKeySetDigest: string;
    schemaRef: string;
    schemaDigest: string;
    verifierPolicyRef: string;
    verifierPolicyDigest: string;
    revocationRef: string;
    revocationSnapshotDigest: string;
    now: Date;
    chainReader?: HostedAppChainTrustRootReader;
  },
): Promise<HostedAppCredentialChainAnchorRefs> {
  if (!input.requireChainAnchors) return {};
  if (!(prisma as any)?.hostedAppChainAnchor?.findMany) {
    throw new Error(
      "hosted_app_credential_chain_anchor_projection_unavailable",
    );
  }

  const expectedRefs = {
    issuer: {
      objectRef: credentialChainObjectRef("issuer", input.issuerRef),
      digest: input.issuerKeySetDigest,
    },
    schema: {
      objectRef: credentialChainObjectRef("schema", input.schemaRef),
      digest: input.schemaDigest,
    },
    verifierPolicy: {
      objectRef: credentialChainObjectRef(
        "verifier_policy",
        input.verifierPolicyRef,
      ),
      digest: input.verifierPolicyDigest,
    },
    revocationSnapshot: {
      objectRef: credentialChainObjectRef("revocation", input.revocationRef),
      digest: input.revocationSnapshotDigest,
    },
  };
  const rows = await (prisma as any).hostedAppChainAnchor.findMany({
    where: {
      anchorType: "hosted_app_credential_anchor",
      objectRef: {
        in: Object.values(expectedRefs).map((entry) => entry.objectRef),
      },
    },
  });
  const byObjectRef = new Map<string, any>();
  for (const row of rows || []) {
    assertCredentialChainAnchorProjection(row, input.now);
    byObjectRef.set(String(row.objectRef || ""), row);
  }
  const proofRows = Object.values(expectedRefs).map((expected) => {
    const row = byObjectRef.get(expected.objectRef);
    if (!row) throw new Error("hosted_app_credential_chain_anchor_missing");
    if (String(row.digest || "") !== expected.digest) {
      throw new Error(
        "hosted_app_credential_chain_anchor_digest_mismatch",
      );
    }
    return row;
  });
  const chainReader = resolveCredentialChainTrustRootReader(prisma, {
    chainReader: input.chainReader,
  });
  if (!chainReader) {
    throw new Error("hosted_app_credential_chain_reader_unavailable");
  }
  const proofs = await chainReader.readAnchors({
    programId: HOSTED_APP_TRUST_ROOT_PROGRAM_ID,
    requiredAnchors: proofRows.map((row) => ({
      anchorType: "hosted_app_credential_anchor",
      objectRef: String(row.objectRef || ""),
      accountPubkey: String(row.accountPubkey || ""),
      expectedAccountPubkey: deriveHostedAppCredentialAnchorPda({
        objectRef: String(row.objectRef || ""),
        digest: String(row.digest || ""),
      }),
    })),
    now: input.now,
    maxAnchorAgeMs: MAX_CREDENTIAL_CHAIN_ANCHOR_AGE_MS,
  });
  const proofByObjectRef = new Map<string, HostedAppChainAccountProof>();
  for (const proof of proofs || []) {
    proofByObjectRef.set(String(proof.objectRef || ""), proof);
  }
  for (const row of proofRows) {
    assertCredentialChainAccountProof(
      row,
      proofByObjectRef.get(String(row.objectRef || "")),
      input.now,
    );
  }

  return Object.fromEntries(
    Object.entries(expectedRefs).map(([key, expected]) => {
      const row = byObjectRef.get(expected.objectRef);
      if (!row) throw new Error("hosted_app_credential_chain_anchor_missing");
      if (String(row.digest || "") !== expected.digest) {
        throw new Error(
          "hosted_app_credential_chain_anchor_digest_mismatch",
        );
      }
      const proof = proofByObjectRef.get(String(row.objectRef || ""));
      return [key, String(proof?.chainRef || "")];
    }),
  ) as HostedAppCredentialChainAnchorRefs;
}

function resolveCredentialChainTrustRootReader(
  prisma: any,
  input: { chainReader?: HostedAppChainTrustRootReader },
): HostedAppChainTrustRootReader | null {
  if (input.chainReader) return input.chainReader;
  if (prisma?.hostedAppChainTrustRootReader?.readAnchors) {
    return prisma.hostedAppChainTrustRootReader;
  }
  return buildDefaultHostedAppChainTrustRootReaderFromEnv();
}

function credentialChainObjectRef(kind: string, ref: string): string {
  return `${kind}:${String(ref || "").trim()}`;
}

function assertCredentialChainAnchorProjection(row: any, now: Date): void {
  if (String(row?.programId || "") !== HOSTED_APP_TRUST_ROOT_PROGRAM_ID) {
    throw new Error("hosted_app_credential_chain_anchor_program_mismatch");
  }
  if (!String(row?.accountPubkey || "").trim()) {
    throw new Error("hosted_app_credential_chain_anchor_account_missing");
  }
  const expectedAccountPubkey = deriveHostedAppCredentialAnchorPda({
    objectRef: String(row.objectRef || ""),
    digest: String(row.digest || ""),
  });
  if (String(row.accountPubkey || "") !== expectedAccountPubkey) {
    throw new Error("hosted_app_credential_chain_anchor_account_mismatch");
  }
  if (
    String(row?.finalityStatus || "")
      .trim()
      .toLowerCase() !== "finalized"
  ) {
    throw new Error("hosted_app_credential_chain_anchor_unfinalized");
  }
  if (
    String(row?.status || "active")
      .trim()
      .toLowerCase() !== "active"
  ) {
    throw new Error("hosted_app_credential_chain_anchor_inactive");
  }
  if (!String(row?.chainRef || "").trim()) {
    throw new Error("hosted_app_credential_chain_anchor_ref_missing");
  }
  if (!String(row?.projectionDigest || "").trim()) {
    throw new Error(
      "hosted_app_credential_chain_anchor_projection_digest_missing",
    );
  }
  const observedAt = new Date(row.observedAt);
  if (
    !Number.isFinite(observedAt.getTime()) ||
    now.getTime() - observedAt.getTime() > MAX_CREDENTIAL_CHAIN_ANCHOR_AGE_MS
  ) {
    throw new Error("hosted_app_credential_chain_anchor_stale");
  }
  if (row.expiresAt && new Date(row.expiresAt).getTime() <= now.getTime()) {
    throw new Error("hosted_app_credential_chain_anchor_expired");
  }
}

function assertCredentialChainAccountProof(
  row: any,
  proof: HostedAppChainAccountProof | undefined,
  now: Date,
): void {
  if (!proof) throw new Error("hosted_app_credential_chain_account_proof_missing");
  if (proof.missing) throw new Error("hosted_app_credential_chain_account_missing");
  if (
    String(proof.anchorType || "") !== "hosted_app_credential_anchor" ||
    String(proof.objectRef || "") !== String(row.objectRef || "")
  ) {
    throw new Error("hosted_app_credential_chain_anchor_proof_mismatch");
  }
  if (String(proof.programId || "") !== HOSTED_APP_TRUST_ROOT_PROGRAM_ID) {
    throw new Error("hosted_app_credential_chain_anchor_program_mismatch");
  }
  if (String(proof.ownerProgramId || "") !== HOSTED_APP_TRUST_ROOT_PROGRAM_ID) {
    throw new Error("hosted_app_credential_chain_anchor_owner_mismatch");
  }
  const expectedAccountPubkey = deriveHostedAppCredentialAnchorPda({
    objectRef: String(row.objectRef || ""),
    digest: String(row.digest || ""),
  });
  if (
    String(proof.accountPubkey || "") !== expectedAccountPubkey ||
    String(row.accountPubkey || "") !== expectedAccountPubkey ||
    (proof.expectedAccountPubkey &&
      proof.expectedAccountPubkey !== expectedAccountPubkey) ||
    proof.pdaMatches !== true
  ) {
    throw new Error("hosted_app_credential_chain_anchor_account_mismatch");
  }
  if (
    String(proof.finalityStatus || "")
      .trim()
      .toLowerCase() !== "finalized"
  ) {
    throw new Error("hosted_app_credential_chain_anchor_unfinalized");
  }
  if (String(proof.digest || "") !== String(row.digest || "")) {
    throw new Error("hosted_app_credential_chain_anchor_digest_mismatch");
  }
  if (String(proof.chainRef || "") !== String(row.chainRef || "")) {
    throw new Error("hosted_app_credential_chain_anchor_ref_mismatch");
  }
  if (
    !String(proof.projectionDigest || "").trim() ||
    String(proof.projectionDigest || "") !== String(row.projectionDigest || "")
  ) {
    throw new Error("hosted_app_credential_chain_anchor_projection_mismatch");
  }
  if (
    String(proof.status || "active")
      .trim()
      .toLowerCase() !== "active"
  ) {
    throw new Error("hosted_app_credential_chain_anchor_inactive");
  }
  const observedAt = new Date(proof.observedAt as any);
  if (
    !Number.isFinite(observedAt.getTime()) ||
    now.getTime() - observedAt.getTime() > MAX_CREDENTIAL_CHAIN_ANCHOR_AGE_MS
  ) {
    throw new Error("hosted_app_credential_chain_anchor_stale");
  }
  if (proof.expiresAt && new Date(proof.expiresAt).getTime() <= now.getTime()) {
    throw new Error("hosted_app_credential_chain_anchor_expired");
  }
}

function deriveHostedAppCredentialAnchorPda(input: {
  objectRef: string;
  digest: string;
}): string {
  return PublicKey.findProgramAddressSync(
    [
      Buffer.from("hosted_app_credential_anchor"),
      hostedAppChainBytes32("object-ref", input.objectRef),
      hostedAppChainBytes32("digest", input.digest),
    ],
    new PublicKey(HOSTED_APP_TRUST_ROOT_PROGRAM_ID),
  )[0].toBase58();
}

function hostedAppChainBytes32(kind: string, value: string): Buffer {
  const normalized = String(value || "").trim();
  const sha256Match = normalized.match(/^sha256:([a-f0-9]{64})$/i);
  if (sha256Match) return Buffer.from(sha256Match[1], "hex");
  if (/^[a-f0-9]{64}$/i.test(normalized)) {
    return Buffer.from(normalized, "hex");
  }
  return crypto
    .createHash("sha256")
    .update(`${HOSTED_APP_CHAIN_HASH_NAMESPACE}:${kind}:${normalized}`)
    .digest();
}

export async function resolveHostedAppCredentialIssuerTrustAnchor(
  prisma: PrismaClient,
  input: {
    issuerRef: string;
    now: Date;
  },
): Promise<HostedAppCredentialIssuerTrustAnchor> {
  const [issuerId, keyVersion] = parseIssuerRef(input.issuerRef);
  const issuer = await (prisma as any).hostedAppCredentialIssuer?.findFirst?.({
    where: {
      id: issuerId,
      keyVersion,
      issuerScope: HOSTED_APP_CREDENTIAL_ISSUER_SCOPE,
      status: "active",
      validFrom: { lte: input.now },
      OR: [{ expiresAt: null }, { expiresAt: { gt: input.now } }],
    },
    orderBy: [{ validFrom: "desc" }],
  });
  if (!issuer) throw new Error("hosted_app_credential_issuer_unconfigured");
  if (String(issuer.status || "") !== "active") {
    throw new Error("hosted_app_credential_issuer_inactive");
  }
  if (String(issuer.issuerScope || "") !== HOSTED_APP_CREDENTIAL_ISSUER_SCOPE) {
    throw new Error("hosted_app_credential_issuer_scope_mismatch");
  }
  if (String(issuer.keyVersion || "") !== keyVersion) {
    throw new Error("hosted_app_credential_key_version_mismatch");
  }
  if (
    toDate(issuer.validFrom, "hosted_app_credential_issuer_invalid") > input.now
  ) {
    throw new Error("hosted_app_credential_issuer_not_effective");
  }
  if (issuer.expiresAt && new Date(issuer.expiresAt) <= input.now) {
    throw new Error("hosted_app_credential_issuer_expired");
  }
  const algorithm = String(
    issuer.algorithm || "",
  ) as AppTrustRootCredentialJwsAlgorithm;
  assertCredentialJwsAlgorithmAllowed(algorithm);
  const keyId = String(issuer.publicKeyRef || "").trim();
  if (!keyId) throw new Error("hosted_app_credential_key_id_missing");
  const publicJwks = buildPublicJwks([
    {
      ...readIssuerPublicJwk(issuer.publicJwk),
      kid: keyId,
      alg: algorithm,
    } as JWK,
  ]);
  return {
    issuerRef: input.issuerRef,
    issuerKeySetDigest: digestJwkSet(publicJwks),
    publicJwks,
  };
}

function parseRef(ref: string): [string, string] {
  const index = ref.lastIndexOf(".");
  if (index <= 0 || index === ref.length - 1) {
    throw new Error("hosted_app_credential_ref_invalid");
  }
  return [ref.slice(0, index), ref.slice(index + 1)];
}

function parseIssuerRef(ref: string): [string, string] {
  const index = ref.lastIndexOf(":");
  if (index <= 0 || index === ref.length - 1) {
    throw new Error("hosted_app_credential_issuer_ref_invalid");
  }
  return [ref.slice(0, index), ref.slice(index + 1)];
}

function readPrivateJwkFromEnv(
  signingKeyRef: unknown,
  envPrefix = "HOSTED_APP_CREDENTIAL_PRIVATE_JWK",
): JWK {
  const ref = String(signingKeyRef || "").trim();
  if (!ref) throw new Error("hosted_app_credential_signing_key_ref_missing");
  const envName = `${envPrefix}_${ref.replace(/[^a-zA-Z0-9]/g, "_").toUpperCase()}`;
  const raw = process.env[envName];
  if (!raw) throw new Error("hosted_app_credential_signing_key_missing");
  try {
    const parsed = JSON.parse(raw);
    if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) {
      throw new Error("invalid");
    }
    return parsed as JWK;
  } catch {
    throw new Error("hosted_app_credential_signing_key_invalid");
  }
}

function readIssuerPublicJwk(value: unknown): JWK {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    throw new Error("hosted_app_credential_public_jwk_missing");
  }
  return value as JWK;
}

function readMaxRevocationFeedAgeMs(
  verifierPolicyDocument: unknown,
  revocationSnapshot: any,
): number {
  const fromPolicy = (
    verifierPolicyDocument as { maxRevocationFeedAgeMs?: unknown }
  )?.maxRevocationFeedAgeMs;
  const fromSnapshot = revocationSnapshot?.maxAgeMs;
  const candidates = [fromPolicy, fromSnapshot]
    .filter((value) => value !== null && value !== undefined)
    .map((value) => Number(value));
  if (
    candidates.length === 0 ||
    candidates.some((value) => !Number.isFinite(value) || value <= 0)
  ) {
    throw new Error("hosted_app_verifier_policy_revocation_age_invalid");
  }
  return Math.trunc(Math.min(...candidates));
}

function assertCredentialNotRevoked(
  revocationSnapshot: {
    revokedCredentialIds?: unknown;
    revokedIssuerRefs?: unknown;
    revokedSchemaRefs?: unknown;
  },
  input: { issuerRef: string; schemaRef: string },
): void {
  const revokedIssuerRefs = normalizeStringList(
    revocationSnapshot.revokedIssuerRefs,
  );
  const revokedSchemaRefs = normalizeStringList(
    revocationSnapshot.revokedSchemaRefs,
  );
  if (revokedIssuerRefs.includes(input.issuerRef)) {
    throw new Error("hosted_app_credential_issuer_revoked");
  }
  if (revokedSchemaRefs.includes(input.schemaRef)) {
    throw new Error("hosted_app_credential_schema_revoked");
  }
}

function normalizeRevocationSnapshot(snapshot: any): Record<string, unknown> {
  const validUntil = toIsoDate(
    snapshot.validUntil,
    "hosted_app_revocation_snapshot_valid_until_missing",
  );
  const feedSequence = readPositiveInteger(
    snapshot.feedSequence,
    "hosted_app_revocation_feed_sequence_invalid",
  );
  const maxAgeMs = readOptionalPositiveInteger(
    snapshot.maxAgeMs,
    "hosted_app_revocation_snapshot_max_age_invalid",
  );
  const feedPolicyRef = String(snapshot.feedPolicyRef || "").trim();
  const chainAnchorRef =
    snapshot.chainAnchorRef == null ? null : String(snapshot.chainAnchorRef);
  const unsignedMaterial = {
    feedRef: String(snapshot.feedRef || ""),
    feedClass: String(snapshot.feedClass || ""),
    revokedCredentialIds: normalizeStringList(snapshot.revokedCredentialIds),
    revokedIssuerRefs: normalizeStringList(snapshot.revokedIssuerRefs),
    revokedSchemaRefs: normalizeStringList(snapshot.revokedSchemaRefs),
    issuedAt: toIsoDate(
      snapshot.issuedAt,
      "hosted_app_revocation_snapshot_invalid",
    ),
    validUntil,
    maxAgeMs,
    staleFailureMode: String(snapshot.staleFailureMode || ""),
    feedSequence,
    feedPolicyRef,
    chainAnchorRef,
  };
  return {
    ...unsignedMaterial,
    feedSignature: String(snapshot.feedSignature || ""),
    snapshotDigest: digestJson(unsignedMaterial),
  };
}

function assertRevocationSnapshotProof(
  normalizedSnapshot: Record<string, unknown>,
  rawSnapshot: { snapshotDigest?: unknown },
  input: { now: Date; publicJwk: JWK },
): void {
  if (
    String(rawSnapshot.snapshotDigest || "") !==
    normalizedSnapshot.snapshotDigest
  ) {
    throw new Error("hosted_app_revocation_snapshot_digest_mismatch");
  }
  if (normalizedSnapshot.staleFailureMode !== "fail_closed") {
    throw new Error("hosted_app_revocation_snapshot_not_fail_closed");
  }
  if (!String(normalizedSnapshot.feedSignature || "").trim()) {
    throw new Error("hosted_app_revocation_feed_signature_missing");
  }
  if (!String(normalizedSnapshot.feedPolicyRef || "").trim()) {
    throw new Error("hosted_app_revocation_feed_policy_missing");
  }
  const issuedAtMs = Date.parse(String(normalizedSnapshot.issuedAt));
  const validUntilMs = Date.parse(String(normalizedSnapshot.validUntil));
  if (Number.isNaN(issuedAtMs) || Number.isNaN(validUntilMs)) {
    throw new Error("hosted_app_revocation_snapshot_invalid");
  }
  if (issuedAtMs > input.now.getTime()) {
    throw new Error("hosted_app_revocation_snapshot_issued_in_future");
  }
  if (validUntilMs <= issuedAtMs) {
    throw new Error("hosted_app_revocation_snapshot_window_invalid");
  }
  if (validUntilMs <= input.now.getTime()) {
    throw new Error("hosted_app_revocation_snapshot_expired");
  }
  verifyRevocationFeedSignature(normalizedSnapshot, input.publicJwk);
}

function resolveRevocationFeedPublicJwk(input: {
  issuerRevocationPolicy?: unknown;
  feedPolicyRef: string;
}): JWK {
  if (!input.feedPolicyRef.trim()) {
    throw new Error("hosted_app_revocation_feed_policy_missing");
  }
  const policy = input.issuerRevocationPolicy as {
    publicJwk?: unknown;
    publicJwks?: unknown;
  } | null;
  if (
    policy?.publicJwk &&
    typeof policy.publicJwk === "object" &&
    !Array.isArray(policy.publicJwk)
  ) {
    return buildPublicJwks([policy.publicJwk as JWK]).keys[0];
  }
  if (Array.isArray(policy?.publicJwks) && policy.publicJwks.length > 0) {
    return buildPublicJwks([policy.publicJwks[0] as JWK]).keys[0];
  }
  const envName = `HOSTED_APP_REVOCATION_FEED_PUBLIC_JWK_${input.feedPolicyRef
    .replace(/[^a-zA-Z0-9]/g, "_")
    .toUpperCase()}`;
  const raw = process.env[envName];
  if (!raw) throw new Error("hosted_app_revocation_feed_key_missing");
  try {
    const parsed = JSON.parse(raw);
    if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) {
      throw new Error("invalid");
    }
    return buildPublicJwks([parsed as JWK]).keys[0];
  } catch {
    throw new Error("hosted_app_revocation_feed_key_invalid");
  }
}

function verifyRevocationFeedSignature(
  normalizedSnapshot: Record<string, unknown>,
  publicJwk: JWK,
): void {
  const feedSignature = String(normalizedSnapshot.feedSignature || "");
  const [scheme, encodedSignature] = splitSignature(feedSignature);
  if (scheme !== "ed25519" || !encodedSignature) {
    throw new Error("hosted_app_revocation_feed_signature_invalid");
  }
  try {
    const key = crypto.createPublicKey({
      key: publicJwk as any,
      format: "jwk",
    });
    const signature = Buffer.from(encodedSignature, "base64url");
    const unsignedMaterial = {
      feedRef: normalizedSnapshot.feedRef,
      feedClass: normalizedSnapshot.feedClass,
      revokedCredentialIds: normalizedSnapshot.revokedCredentialIds,
      revokedIssuerRefs: normalizedSnapshot.revokedIssuerRefs,
      revokedSchemaRefs: normalizedSnapshot.revokedSchemaRefs,
      issuedAt: normalizedSnapshot.issuedAt,
      validUntil: normalizedSnapshot.validUntil,
      maxAgeMs: normalizedSnapshot.maxAgeMs,
      staleFailureMode: normalizedSnapshot.staleFailureMode,
      feedSequence: normalizedSnapshot.feedSequence,
      feedPolicyRef: normalizedSnapshot.feedPolicyRef,
      chainAnchorRef: normalizedSnapshot.chainAnchorRef,
    };
    const valid = crypto.verify(
      null,
      Buffer.from(stableStringify(unsignedMaterial)),
      key,
      signature,
    );
    if (!valid) {
      throw new Error("invalid signature");
    }
  } catch (error) {
    if (error instanceof Error && error.message.startsWith("hosted_app_"))
      throw error;
    throw new Error("hosted_app_revocation_feed_signature_invalid");
  }
}

function splitSignature(value: string): [string, string] {
  const index = value.indexOf(":");
  if (index <= 0 || index === value.length - 1) return ["", ""];
  return [value.slice(0, index), value.slice(index + 1)];
}

function normalizeStringList(value: unknown): string[] {
  if (!Array.isArray(value)) return [];
  return value.map((entry) => String(entry).trim()).filter(Boolean);
}

function readPositiveInteger(value: unknown, errorCode: string): number {
  const parsed = Number(value);
  if (!Number.isInteger(parsed) || parsed <= 0) throw new Error(errorCode);
  return parsed;
}

function readOptionalPositiveInteger(
  value: unknown,
  errorCode: string,
): number | null {
  if (value == null) return null;
  return readPositiveInteger(value, errorCode);
}

function toDate(value: unknown, errorCode: string): Date {
  const date = value instanceof Date ? value : new Date(String(value));
  if (Number.isNaN(date.getTime())) throw new Error(errorCode);
  return date;
}

function toIsoDate(value: unknown, errorCode: string): string {
  return toDate(value, errorCode).toISOString();
}
