import { Router } from "express";
import { randomUUID } from "node:crypto";
import type { PrismaClient } from "@prisma/client";
import type { Redis } from "ioredis";

import { isPublicHardeningRequired } from "../config/jwtSecret";
import {
  AuthActorError,
  requireAuthenticatedActor,
  requireCircleActorForAuthActor,
  type AuthActor,
} from "../services/auth/actor";
import { buildHostedAppAuditExportBundle } from "../services/hostedApps/auditExport";
import {
  buildOfflineVerificationBundle,
  createDevCredentialIssuer,
  issueProductionRuntimeAttestation,
  issueRuntimeAttestation,
  type ProductionSignedCredential,
} from "../services/hostedApps/credentialLayer";
import {
  resolveHostedAppCredentialIssuerTrustAnchor,
  resolveHostedAppProductionCredentialContext,
} from "../services/hostedApps/credentialRegistry";
import { digestJson } from "../services/hostedApps/digest";
import { assertVerifiedReleaseBundle } from "../services/hostedApps/integrityMonitor";
import {
  handleHostedAppActionIntent,
  handleHostedAppCapabilityQuery,
} from "../services/hostedApps/runtimeBridge";
import {
  assertHostedAppReleaseRuntimeGate,
} from "../services/hostedApps/runtimeReleaseGates";
import type { HostedAppChainTrustRootSnapshot } from "../services/hostedApps/chainTrustRoot";
import { verifyProductionOfflineVerificationBundle } from "../services/hostedApps/offlineVerifier";
import {
  assertManagedAppOriginIsIsolated,
  buildRuntimeSessionDigest,
} from "../services/hostedApps/runtimeSecurity";
import type { HostedAppNativeActionActor } from "../services/hostedApps/nativeActions";
import {
  buildUserConsentReceipt,
  type HostedAppUserConsentDecision,
} from "../services/hostedApps/userConsent";

const MANAGED_HOSTED_APP_ORIGIN_SUFFIX = ".apps.alchemeusercontent.local";

function loadHostedAppDevIssuer() {
  if (isHostedAppProductionRuntime()) {
    throw new Error("hosted_app_dev_credential_issuer_not_allowed_in_production");
  }
  const secret = process.env.HOSTED_APP_CREDENTIAL_SECRET || "dev-hosted-app-secret";
  if (!secret) throw new Error("hosted_app_credential_issuer_unconfigured");
  return createDevCredentialIssuer(secret);
}

function isHostedAppProductionRuntime(): boolean {
  return isPublicHardeningRequired(process.env);
}

export function hostedAppRouter(prisma: PrismaClient, _redis: Redis): Router {
  const router = Router();

  router.post("/:appId/session", async (req, res, next) => {
    try {
      const actor = await requireHostedAppRequestActor(req, prisma as any);
      const appId = String(req.params.appId || "").trim();
      const circleId = Number(req.body?.circleId || 0);
      const releaseId = String(req.body?.releaseId || "").trim();
      const manifestHash = String(req.body?.manifestHash || "").trim();
      await requireHostedAppCircleReadActor(actor, prisma as any, circleId);
      const { release, developerSignatureValid } = await assertHostedAppReleaseRuntimeGate(prisma as any, {
        appId,
        circleId,
        releaseId,
        manifestHash,
        userPubkey: actor.pubkey,
        requestedCapability: "read_app_session",
        requestedBundleHash: req.body?.bundleHash == null ? null : String(req.body.bundleHash),
      });
      const releaseOrigin = readReleaseBundleOrigin(release);
      const requestedBundleUrl = String(req.body?.bundleUrl || "");
      if (requestedBundleUrl && requestedBundleUrl !== String(release.bundleUri || "")) {
        throw new Error("hosted_app_bundle_uri_mismatch");
      }
      assertManagedAppOriginIsIsolated({
        appOrigin: releaseOrigin,
        forbiddenOrigins: resolveHostedAppForbiddenOrigins(req.body?.forbiddenOrigins),
        requiredSuffix: MANAGED_HOSTED_APP_ORIGIN_SUFFIX,
      });
      const nonce = randomUUID();
      const bridgeSessionToken = digestJson({
        appId,
        releaseId,
        circleId,
        userPubkey: actor.pubkey,
        nonce,
        purpose: "hosted_app_bridge_session",
      });
      const capabilitySetDigest = digestJson(release.capabilitySet ?? []);
      const sessionDigest = buildRuntimeSessionDigest({
        appId,
        releaseId,
        circleId,
        userPubkey: actor.pubkey,
        manifestHash,
        capabilitySetDigest,
        nonce,
      });
      return res.json({
        ok: true,
        bridgeSessionToken,
        releaseOrigin,
        sessionDigest,
        capabilitySetDigest,
        bundleHash: String(release.bundleHash || ""),
      });
    } catch (error) {
      return sendHostedAppError(res, error, next);
    }
  });

  router.post("/:appId/user-consents", async (req, res, next) => {
    try {
      const actor = await requireHostedAppRequestActor(req, prisma as any);
      const circleId = Number(req.body?.circleId || 0);
      await requireHostedAppCircleReadActor(actor, prisma as any, circleId);
      const receipt = buildUserConsentReceipt({
        appId: String(req.params.appId || "").trim(),
        circleId,
        userPubkey: actor.pubkey,
        capabilityId: String(req.body?.capabilityId || "").trim(),
        personalDataScope: normalizePersonalDataScope(req.body?.personalDataScope),
        decision: normalizeConsentDecision(req.body?.decision),
        expiresAt: req.body?.expiresAt == null ? null : String(req.body.expiresAt),
      });
      await persistUserConsent(prisma as any, receipt);
      return res.json({ ok: true, receipt });
    } catch (error) {
      return sendHostedAppError(res, error, next);
    }
  });

  router.post("/:appId/user-consents/revoke", async (req, res, next) => {
    try {
      const actor = await requireHostedAppRequestActor(req, prisma as any);
      const circleId = Number(req.body?.circleId || 0);
      await requireHostedAppCircleReadActor(actor, prisma as any, circleId);
      const receipt = buildUserConsentReceipt({
        appId: String(req.params.appId || "").trim(),
        circleId,
        userPubkey: actor.pubkey,
        capabilityId: String(req.body?.capabilityId || "").trim(),
        personalDataScope: normalizePersonalDataScope(req.body?.personalDataScope),
        decision: "revoked",
        expiresAt: null,
      });
      await persistUserConsent(prisma as any, receipt);
      return res.json({ ok: true, receipt });
    } catch (error) {
      return sendHostedAppError(res, error, next);
    }
  });

  router.post("/:appId/query-capability", async (req, res, next) => {
    try {
      const actor = await requireHostedAppRequestActor(req, prisma as any);
      const circleId = Number(req.body?.circleId || 0);
      await requireHostedAppCircleReadActor(actor, prisma as any, circleId);
      const result = await handleHostedAppCapabilityQuery(prisma as any, {
        appId: String(req.params.appId || "").trim(),
        circleId,
        releaseId: String(req.body?.releaseId || "").trim(),
        manifestHash: String(req.body?.manifestHash || "").trim(),
        capabilityId: String(req.body?.capabilityId || "").trim(),
        params: typeof req.body?.params === "object" && req.body.params ? req.body.params : {},
        userPubkey: actor.pubkey,
        userId: actor.userId,
      });
      return res.json(result);
    } catch (error) {
      return sendHostedAppError(res, error, next);
    }
  });

  router.post("/:appId/action-intents", async (req, res, next) => {
    try {
      const actor = await requireHostedAppRequestActor(req, prisma as any);
      const circleId = Number(req.body?.circleId || 0);
      const actionId = String(req.body?.actionId || "").trim();
      if (actionId === "request_governance_proposal_intent") {
        await requireCircleActorForAuthActor(actor, prisma as any, {
          circleId,
          action: "circle.manage",
          minRole: "Moderator",
        });
      } else {
        await requireHostedAppCircleReadActor(actor, prisma as any, circleId);
      }
      const result = await handleHostedAppActionIntent(prisma as any, {
        appId: String(req.params.appId || "").trim(),
        circleId,
        releaseId: String(req.body?.releaseId || "").trim(),
        manifestHash: String(req.body?.manifestHash || "").trim(),
        actionId,
        payload: normalizeHostedAppActionPayload(req.body),
        confirmedPreviewDigest: req.body?.confirmedPreviewDigest == null
          ? null
          : String(req.body.confirmedPreviewDigest),
        userPubkey: actor.pubkey,
        actorUserId: actor.userId,
        actor: deriveRequestHostedAppNativeActionActor(actor),
      });
      return res.json(result);
    } catch (error) {
      return sendHostedAppError(res, error, next);
    }
  });

  router.post("/:appId/runtime-attestations", async (req, res, next) => {
    try {
      const actor = await requireHostedAppRequestActor(req, prisma as any);
      const appId = String(req.params.appId || "").trim();
      const circleId = Number(req.body?.circleId || 0);
      const releaseId = String(req.body?.releaseId || "").trim();
      const manifestHash = String(req.body?.manifestHash || "").trim();
      await requireHostedAppCircleReadActor(actor, prisma as any, circleId);
      const { release, developerSignatureValid } = await assertHostedAppReleaseRuntimeGate(prisma as any, {
        appId,
        circleId,
        releaseId,
        manifestHash,
        userPubkey: actor.pubkey,
        requestedCapability: "read_app_session",
        requestedBundleHash: req.body?.bundleHash == null ? null : String(req.body.bundleHash),
        actualManifestHash: req.body?.actualManifestHash == null
          ? manifestHash
          : String(req.body.actualManifestHash),
        actualBundleHash: req.body?.actualBundleHash == null
          ? null
          : String(req.body.actualBundleHash),
      });
      const releaseOrigin = readReleaseBundleOrigin(release);
      const requestedSandboxOrigin = String(req.body?.sandboxOrigin || releaseOrigin);
      if (requestedSandboxOrigin !== releaseOrigin) {
        throw new Error("hosted_app_sandbox_origin_mismatch");
      }
      const runtimeMeasuredBundleHash = readRuntimeAttestationBundleHash(req.body);
      assertVerifiedReleaseBundle({
        expectedManifestHash: String(release.manifestHash || ""),
        actualManifestHash: String(req.body?.actualManifestHash || manifestHash),
        expectedBundleHash: String(release.bundleHash || ""),
        actualBundleHash: runtimeMeasuredBundleHash,
        developerSignatureValid,
        releaseStatus: String(release.status || "active"),
      });
      const credentialPayload = {
        appId,
        releaseId,
        manifestHash,
        bundleHash: String(release.bundleHash || ""),
        circleId,
        userPubkey: actor.pubkey,
        capabilitySetDigest: digestJson(release.capabilitySet ?? []),
        sandboxOrigin: releaseOrigin,
        runtimeVersion: "hosted-runtime-v1",
        sessionId: String(req.body?.sessionId || ""),
        nonce: String(req.body?.nonce || ""),
      };
      const credential = isHostedAppProductionRuntime()
        ? await issueProductionRuntimeAttestation(
          await resolveHostedAppProductionCredentialContext(prisma as any, {
            credentialType: "runtime_attestation",
            schemaRef: "runtime_attestation.v1",
            verifierPolicyRef: "hosted-app-runtime.v1",
            requireChainAnchors: true,
            now: new Date(),
          }),
          credentialPayload,
        )
        : issueRuntimeAttestation(loadHostedAppDevIssuer(), credentialPayload);
      if (isProductionSignedCredential(credential)) {
        await persistHostedAppCredential(prisma as any, credential);
      }
      return res.json({ ok: true, credential });
    } catch (error) {
      return sendHostedAppError(res, error, next);
    }
  });

  router.get("/:appId/offline-verification-bundle", async (req, res, next) => {
    try {
      if (isHostedAppProductionRuntime()) {
        const now = new Date();
        const actor = await requireHostedAppRequestActor(req, prisma as any);
        const appId = String(req.params.appId || "").trim();
        const circleId = Number(req.query?.circleId || 0);
        const releaseId = String(req.query?.releaseId || "").trim();
        const manifestHash = String(req.query?.manifestHash || "").trim();
        if (!releaseId || !manifestHash) {
          throw new Error("hosted_app_offline_verification_release_required");
        }
        await requireHostedAppCircleReadActor(actor, prisma as any, circleId);
        await assertHostedAppReleaseRuntimeGate(prisma as any, {
          appId,
          circleId,
          releaseId,
          manifestHash,
          userPubkey: actor.pubkey,
          requestedCapability: "read_app_session",
        });
        const bundle = await loadPersistedHostedAppOfflineVerificationBundle(prisma as any, now);
        return res.json({ ok: true, bundle });
      }
      const issuer = loadHostedAppDevIssuer();
      const bundle = buildOfflineVerificationBundle(issuer, {
        credentialSchemaDigests: [digestJson({ schema: "runtime_attestation.v1" })],
        verifierPolicyDigests: [digestJson({ policy: "hosted-app-runtime.v1" })],
        revocationSnapshotDigest: digestJson({ revoked: [] }),
        chainAnchorRefs: [],
        maxRevocationFeedAgeMs: 60_000,
      });
      return res.json({ ok: true, bundle });
    } catch (error) {
      return sendHostedAppError(res, error, next, 503);
    }
  });

  router.post("/:appId/audit-export", async (req, res, next) => {
    try {
      const actor = await requireHostedAppRequestActor(req, prisma as any);
      const appId = String(req.params.appId || "").trim();
      const circleId = Number(req.body?.circleId || 0);
      const releaseId = String(req.body?.releaseId || "").trim();
      const manifestHash = String(req.body?.manifestHash || "").trim();
      await requireHostedAppCircleReadActor(actor, prisma as any, circleId);
      if (!releaseId || !manifestHash) {
        throw new Error("hosted_app_audit_export_release_required");
      }
      const runtimeGate = await assertHostedAppReleaseRuntimeGate(prisma as any, {
        appId,
        circleId,
        releaseId,
        manifestHash,
        userPubkey: actor.pubkey,
        requestedCapability: "read_app_session",
        requireChainTrustRoot: isHostedAppProductionRuntime(),
      });
      const chainAnchorRefs = collectHostedAppChainAnchorRefs(
        runtimeGate.chainTrustRoot,
      );
      const bundle = buildHostedAppAuditExportBundle({
        appId,
        releaseId,
        proposalReceipts: normalizeStringList(req.body?.proposalReceipts),
        voteReceiptDigests: normalizeStringList(req.body?.voteReceiptDigests),
        governanceReceiptDigests: normalizeStringList(req.body?.governanceReceiptDigests),
        runtimeAttestationDigests: normalizeStringList(req.body?.runtimeAttestationDigests),
        accessReceiptDigests: normalizeStringList(req.body?.accessReceiptDigests),
        actionReceiptDigests: normalizeStringList(req.body?.actionReceiptDigests),
        grantCredentialDigests: normalizeStringList(req.body?.grantCredentialDigests),
        paymentCredentialDigests: normalizeStringList(req.body?.paymentCredentialDigests),
        publishCredentialDigests: normalizeStringList(req.body?.publishCredentialDigests),
        revocationRefs: normalizeStringList(req.body?.revocationRefs),
        issuerChangeDigests: normalizeStringList(req.body?.issuerChangeDigests),
        schemaChangeDigests: normalizeStringList(req.body?.schemaChangeDigests),
        externalExecutionReceiptDigests: normalizeStringList(req.body?.externalExecutionReceiptDigests),
        chainAnchorRefs,
        requireChainAnchorRefs: isHostedAppProductionRuntime(),
        redactionPolicyRef: String(req.body?.redactionPolicyRef || "hosted-app-audit-redaction-v1"),
      });
      await persistHostedAppAuditExportBundle(prisma as any, bundle);
      return res.json({ ok: true, bundle });
    } catch (error) {
      return sendHostedAppError(res, error, next);
    }
  });

  return router;
}

async function requireHostedAppRequestActor(req: any, prisma: PrismaClient): Promise<AuthActor> {
  return requireAuthenticatedActor(req, prisma, { requireSessionCookie: true });
}

async function requireHostedAppCircleReadActor(
  actor: AuthActor,
  prisma: PrismaClient,
  circleId: number,
): Promise<void> {
  await requireCircleActorForAuthActor(actor, prisma, {
    circleId,
    action: "circle.read",
    requireMemberChainPresence: false,
  });
}

function deriveRequestHostedAppNativeActionActor(actor: AuthActor): HostedAppNativeActionActor {
  return {
    userId: actor.userId,
    userPubkey: actor.pubkey,
    pubkey: actor.pubkey,
  };
}

function normalizeHostedAppActionPayload(body: any): Record<string, unknown> {
  if (body?.payload && typeof body.payload === "object" && !Array.isArray(body.payload)) {
    return body.payload;
  }
  const payload: Record<string, unknown> = {};
  for (const [key, value] of Object.entries(body ?? {})) {
    if (
      key === "circleId" ||
      key === "releaseId" ||
      key === "manifestHash" ||
      key === "actionId" ||
      key === "confirmedPreviewDigest" ||
      key === "userPubkey"
    ) {
      continue;
    }
    payload[key] = value;
  }
  return payload;
}

function readRuntimeAttestationBundleHash(body: any): string {
  const candidates = [body?.actualBundleHash, body?.runtimeMeasuredBundleHash];
  for (const value of candidates) {
    if (typeof value === "string" && value.trim()) {
      return value.trim();
    }
  }
  throw new Error("hosted_app_bundle_hash_required");
}

function readReleaseBundleOrigin(release: any): string {
  const bundleUri = String(release?.bundleUri || "");
  if (!bundleUri) throw new Error("hosted_app_bundle_uri_required");
  try {
    return new URL(bundleUri).origin;
  } catch {
    throw new Error("hosted_app_bundle_uri_invalid");
  }
}

function resolveHostedAppForbiddenOrigins(additionalOrigins: unknown): string[] {
  return [
    ...normalizeStringList(additionalOrigins),
    process.env.QUERY_API_PUBLIC_BASE_URL,
    process.env.QUERY_API_SIDECAR_BASE_URL,
    process.env.HOSTED_APP_FORBIDDEN_ORIGINS,
  ].flatMap((value) => normalizeStringListFromEnv(value));
}

function normalizeStringListFromEnv(value: unknown): string[] {
  if (Array.isArray(value)) return normalizeStringList(value);
  if (typeof value !== "string") return [];
  return value
    .split(",")
    .map((entry) => entry.trim())
    .filter(Boolean);
}

function sendHostedAppError(
  res: any,
  error: unknown,
  next: (error: unknown) => void,
  hostedAppStatus = 403,
) {
  if (error instanceof AuthActorError) {
    return res.status(error.statusCode).json(error.toResponseBody());
  }
  if (error instanceof Error && error.message.startsWith("hosted_app_")) {
    return res.status(hostedAppStatus).json({ error: error.message });
  }
  return next(error);
}

function normalizePersonalDataScope(value: unknown): string[] {
  return normalizeStringList(value);
}

function normalizeStringList(value: unknown): string[] {
  if (!Array.isArray(value)) return [];
  return value.map((entry) => String(entry).trim()).filter(Boolean);
}

function normalizeConsentDecision(value: unknown): HostedAppUserConsentDecision {
  if (value === "allowed" || value === "denied") return value;
  throw new Error("hosted_app_user_consent_decision_invalid");
}

async function persistUserConsent(
  prisma: any,
  receipt: ReturnType<typeof buildUserConsentReceipt>,
) {
  const row = {
    appId: receipt.appId,
    circleId: receipt.circleId,
    userPubkey: receipt.userPubkey,
    capabilityId: receipt.capabilityId,
    personalDataScope: receipt.personalDataScope,
    decision: receipt.decision,
    expiresAt: receipt.expiresAt ? new Date(receipt.expiresAt) : null,
    receiptId: receipt.receiptId,
  };
  await prisma.hostedAppUserConsent.upsert({
    where: {
      appId_circleId_userPubkey_capabilityId: {
        appId: receipt.appId,
        circleId: receipt.circleId,
        userPubkey: receipt.userPubkey,
        capabilityId: receipt.capabilityId,
      },
    },
    create: {
      id: receipt.receiptId,
      ...row,
    },
    update: row,
  });
}

async function persistHostedAppCredential(
  prisma: any,
  credential: ProductionSignedCredential,
): Promise<void> {
  if (typeof prisma?.hostedAppCredential?.create !== "function") {
    throw new Error("hosted_app_credential_store_unavailable");
  }
  const [issuerId, issuerKeyVersion] = splitIssuerRef(credential.envelope.issuerRef);
  await prisma.hostedAppCredential.create({
    data: {
      id: credential.envelope.credentialId,
      credentialType: credential.envelope.credentialType,
      issuerId,
      issuerKeyVersion,
      subjectRef: credential.envelope.subjectRef,
      audienceRef: credential.envelope.audienceRef,
      scopeRef: credential.envelope.scopeRef,
      replayDomain: credential.envelope.replayDomain,
      nonce: credential.envelope.nonce,
      payloadDigest: credential.envelope.payloadDigest,
      schemaRef: credential.envelope.schemaRef,
      policyVersion: credential.envelope.verifierPolicyRef,
      validFrom: new Date(credential.envelope.validFrom),
      expiresAt: new Date(credential.envelope.expiresAt),
      revocationRef: credential.envelope.revocationRef,
      chainAnchorRef: credential.envelope.chainAnchorRef,
      signature: credential.jws,
    },
  });
}

async function loadPersistedHostedAppOfflineVerificationBundle(
  prisma: any,
  now: Date,
): Promise<Record<string, unknown>> {
  if (typeof prisma?.hostedAppOfflineVerificationBundle?.findFirst !== "function") {
    throw new Error("hosted_app_offline_verification_bundle_store_unavailable");
  }
  const row = await prisma.hostedAppOfflineVerificationBundle.findFirst({
    where: {
      expiresAt: { gt: now },
    },
    orderBy: { createdAt: "desc" },
  });
  if (!row) {
    throw new Error("hosted_app_offline_verification_bundle_missing");
  }
  assertPersistedOfflineVerificationBundleSigned(row);
  assertPersistedOfflineVerificationBundleChainAnchored(row);
  const bundle = {
    bundleId: row.id,
    credentialType: "OfflineVerificationBundle",
    issuerKeySetDigest: row.issuerKeySetDigest,
    issuerKeySetRef: row.issuerKeySetRef,
    jwks: row.publicJwks,
    credentialSchemaDigests: row.credentialSchemaDigests,
    schemaDocuments: row.schemaDocuments,
    verifierPolicyDigests: row.verifierPolicyDigests,
    policyDocuments: row.policyDocuments,
    revocationSnapshot: row.revocationSnapshot,
    revocationFeedPublicJwk: row.revocationFeedPublicJwk,
    revocationSnapshotDigest: row.revocationSnapshotDigest,
    revocationSnapshotIssuedAt: row.revocationSnapshotIssuedAt instanceof Date
      ? row.revocationSnapshotIssuedAt.toISOString()
      : row.revocationSnapshotIssuedAt,
    maxRevocationFeedAgeMs: row.maxRevocationFeedAgeMs,
    chainAnchorRefs: row.chainAnchorRefs,
    validityWindow: row.validityWindow,
    redactionPolicyRef: row.redactionPolicyRef,
    bundleDigest: row.bundleDigest,
    bundleJws: row.bundleJws,
    bundleSignature: row.bundleSignature,
    expiresAt: row.expiresAt instanceof Date ? row.expiresAt.toISOString() : row.expiresAt,
  };
  const trustAnchor = await resolveHostedAppCredentialIssuerTrustAnchor(prisma, {
    issuerRef: String(row.issuerKeySetRef || ""),
    now,
  });
  try {
    const verifiedBundle = await verifyProductionOfflineVerificationBundle({
      offlineBundle: bundle,
      trustedIssuerKeySetDigest: trustAnchor.issuerKeySetDigest,
      expectedIssuerRef: trustAnchor.issuerRef,
      now: now.toISOString(),
    });
    assertPersistedOfflineVerificationBundleChainAnchored(verifiedBundle);
    return verifiedBundle;
  } catch (error) {
    if (
      error instanceof Error &&
      (
        error.message === "hosted_app_offline_verifier_chain_anchor_required" ||
        error.message === "hosted_app_offline_verification_chain_anchor_required"
      )
    ) {
      throw new Error("hosted_app_offline_verification_chain_anchor_required");
    }
    throw new Error("hosted_app_offline_verification_bundle_invalid");
  }
}

function assertPersistedOfflineVerificationBundleChainAnchored(row: any): void {
  if (!normalizeStringList(row?.chainAnchorRefs).length) {
    throw new Error("hosted_app_offline_verification_chain_anchor_required");
  }
}

function assertPersistedOfflineVerificationBundleSigned(row: any): void {
  for (const field of [
    "publicJwks",
    "schemaDocuments",
    "policyDocuments",
    "revocationSnapshot",
    "revocationFeedPublicJwk",
    "bundleDigest",
    "bundleJws",
  ]) {
    const value = row?.[field];
    if (value == null || (typeof value === "string" && !value.trim())) {
      throw new Error("hosted_app_offline_verification_bundle_unsigned");
    }
  }
  if (
    String(row.bundleJws).startsWith("legacy-missing-") ||
    String(row.bundleDigest).includes("legacy-missing-")
  ) {
    throw new Error("hosted_app_offline_verification_bundle_unsigned");
  }
}

async function persistHostedAppAuditExportBundle(
  prisma: any,
  bundle: ReturnType<typeof buildHostedAppAuditExportBundle>,
): Promise<void> {
  if (typeof prisma?.hostedAppAuditExportBundle?.create !== "function") {
    if (isHostedAppProductionRuntime()) {
      throw new Error("hosted_app_audit_export_store_unavailable");
    }
    return;
  }
  await prisma.hostedAppAuditExportBundle.create({
    data: {
      id: bundle.bundleId,
      appId: bundle.appId,
      releaseId: bundle.releaseId,
      proposalReceipts: bundle.proposalReceipts,
      voteReceiptDigests: bundle.voteReceiptDigests,
      governanceReceiptDigests: bundle.governanceReceiptDigests,
      runtimeAttestationDigests: bundle.runtimeAttestationDigests,
      accessReceiptDigests: bundle.accessReceiptDigests,
      actionReceiptDigests: bundle.actionReceiptDigests,
      grantCredentialDigests: bundle.grantCredentialDigests,
      paymentCredentialDigests: bundle.paymentCredentialDigests,
      publishCredentialDigests: bundle.publishCredentialDigests,
      revocationRefs: bundle.revocationRefs,
      issuerChangeDigests: bundle.issuerChangeDigests,
      schemaChangeDigests: bundle.schemaChangeDigests,
      externalExecutionReceiptDigests: bundle.externalExecutionReceiptDigests,
      redactionPolicyRef: bundle.redactionPolicyRef,
      bundleDigest: bundle.bundleDigest,
      chainAnchorRefs: bundle.chainAnchorRefs,
    },
  });
}

function collectHostedAppChainAnchorRefs(
  snapshot: HostedAppChainTrustRootSnapshot | undefined,
): string[] {
  if (!snapshot) return [];
  return [
    snapshot.appIdentity,
    snapshot.release,
    snapshot.channel,
    snapshot.policyAnchor,
    snapshot.installationAnchor,
  ]
    .filter(Boolean)
    .map((anchor: any) => String(anchor.chainRef || "").trim())
    .filter(Boolean);
}

function isProductionSignedCredential(value: unknown): value is ProductionSignedCredential {
  return Boolean(
    value &&
    typeof value === "object" &&
    typeof (value as { jws?: unknown }).jws === "string" &&
    (value as { envelope?: unknown }).envelope,
  );
}

function splitIssuerRef(issuerRef: string): [string, string] {
  const index = issuerRef.lastIndexOf(":");
  if (index <= 0 || index === issuerRef.length - 1) {
    return [issuerRef, ""];
  }
  return [issuerRef.slice(0, index), issuerRef.slice(index + 1)];
}
