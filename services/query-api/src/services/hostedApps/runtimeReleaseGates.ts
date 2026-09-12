import bs58 from "bs58";
import nacl from "tweetnacl";

import {
  assertCandidateReleaseAudience,
  assertGraceReleaseCanRun,
  resolveReleaseForInstallation,
} from "./releaseChannels";
import { assertReleaseCanRun } from "./registry";
import { digestJson, stableStringify } from "./digest";
import { parseHostedAppRequireChainTrustRoot } from "../../config/services";
import {
  resolveHostedAppChainTrustRootSnapshot,
  type HostedAppChainTrustRootReader,
  type HostedAppChainTrustRootSnapshot,
} from "./chainTrustRoot";

export interface HostedAppReleaseRuntimeGateInput {
  appId: string;
  circleId: number;
  releaseId: string;
  manifestHash: string;
  userPubkey: string;
  requestedCapability: string;
  requestedBundleHash?: string | null;
  actualManifestHash?: string | null;
  actualBundleHash?: string | null;
  governanceExecutionNonceHash?: string | null;
  governanceReplayDomainHash?: string | null;
  requireChainTrustRoot?: boolean;
  chainReader?: HostedAppChainTrustRootReader;
}

export interface HostedAppReleaseRuntimeGateResult {
  trust: any;
  installation: any;
  release: any;
  resolvedReleaseId: string;
  developerSignatureValid: boolean;
  chainTrustRoot?: HostedAppChainTrustRootSnapshot;
}

export async function assertHostedAppReleaseRuntimeGate(
  prisma: any,
  input: HostedAppReleaseRuntimeGateInput,
): Promise<HostedAppReleaseRuntimeGateResult> {
  const trust = await prisma.hostedAppCircleTrust.findUnique({
    where: { appId_circleId: { appId: input.appId, circleId: input.circleId } },
  });
  const installation = await prisma.hostedAppCircleInstallation.findUnique({
    where: { appId_circleId: { appId: input.appId, circleId: input.circleId } },
  });
  const resolvedReleaseId = await resolveHostedAppRequestedReleaseId(prisma, {
    appId: input.appId,
    releaseId: input.releaseId,
    installation,
  });
  if (resolvedReleaseId !== input.releaseId) {
    throw new Error("hosted_app_release_resolution_mismatch");
  }
  const resolvedInstallation = buildResolvedHostedAppInstallation(
    installation,
    resolvedReleaseId,
  );
  assertReleaseCanRun({
    appId: input.appId,
    manifestHash: input.manifestHash,
    releaseId: input.releaseId,
    trust,
    installation: resolvedInstallation,
  });
  const release = await loadHostedAppRegisteredRelease(prisma, {
    appId: input.appId,
    releaseId: input.releaseId,
  });
  assertHostedAppReleaseFacts({
    release,
    manifestHash: input.manifestHash,
    requestedBundleHash: input.requestedBundleHash,
    actualManifestHash: input.actualManifestHash,
    actualBundleHash: input.actualBundleHash,
  });
  assertHostedAppRuntimeCapabilityAllowed({
    trust,
    installation: resolvedInstallation,
    release,
    requestedCapability: input.requestedCapability,
  });
  await assertRegisteredReleaseRuntimeGates(prisma, {
    appId: input.appId,
    circleId: input.circleId,
    release,
    userPubkey: input.userPubkey,
    requestedCapability: input.requestedCapability,
  });
  const chainTrustRoot = await maybeAssertHostedAppChainTrustRoot(prisma, {
    input,
    release,
    installation: resolvedInstallation,
  });
  const developerSignatureValid =
    await assertHostedAppDeveloperSignatureRegistered(prisma, {
      appId: input.appId,
      releaseId: input.releaseId,
      release,
    });
  return {
    trust,
    installation: resolvedInstallation,
    release,
    resolvedReleaseId,
    developerSignatureValid,
    chainTrustRoot,
  };
}

export async function loadHostedAppRegisteredRelease(
  prisma: any,
  input: { appId: string; releaseId: string },
) {
  if (!prisma?.hostedAppRelease?.findUnique) {
    throw new Error("hosted_app_release_registry_unavailable");
  }
  const release = await prisma.hostedAppRelease.findUnique({
    where: {
      appId_releaseId: { appId: input.appId, releaseId: input.releaseId },
    },
  });
  if (
    !release ||
    release.appId !== input.appId ||
    release.releaseId !== input.releaseId
  ) {
    throw new Error("hosted_app_release_not_registered");
  }
  return release;
}

export async function assertHostedAppDeveloperSignatureRegistered(
  prisma: any,
  input: { appId: string; releaseId: string; release: any },
): Promise<boolean> {
  if (!prisma?.hostedAppReleasePromotionReceipt?.findFirst) {
    throw new Error("hosted_app_developer_signature_required");
  }
  const receipt = await prisma.hostedAppReleasePromotionReceipt.findFirst({
    where: {
      appId: input.appId,
      OR: [
        { candidateReleaseId: input.releaseId },
        { targetProductionReleaseId: input.releaseId },
      ],
      manifestHash: String(input.release.manifestHash || ""),
      bundleHash: String(input.release.bundleHash || ""),
    },
    orderBy: { createdAt: "desc" },
  });
  if (!receipt || !String(receipt.developerSignature || "").trim()) {
    throw new Error("hosted_app_developer_signature_required");
  }
  assertHostedAppReleaseDeveloperSignatureValid({
    release: input.release,
    developerSignature: String(receipt.developerSignature),
  });
  return true;
}

export function buildHostedAppReleaseDeveloperSignaturePayload(
  release: any,
): string {
  const bundleUri = String(release?.bundleUri || "");
  let bundleOrigin = "";
  try {
    bundleOrigin = new URL(bundleUri).origin;
  } catch {
    bundleOrigin = "";
  }
  return stableStringify({
    domain: "alcheme-hosted-app-release",
    appId: String(release?.appId || ""),
    releaseId: String(release?.releaseId || ""),
    manifestHash: String(release?.manifestHash || ""),
    bundleHash: String(release?.bundleHash || ""),
    bundleOrigin,
    capabilitySetDigest: digestJson(release?.capabilitySet ?? []),
    developerPubkey: String(release?.createdByPubkey || ""),
  });
}

async function resolveHostedAppRequestedReleaseId(
  prisma: any,
  input: { appId: string; releaseId: string; installation: any | null },
): Promise<string> {
  if (!input.installation) return input.releaseId;
  const updatePolicy = String(input.installation.updatePolicy || "manual");
  const subscribedChannelId =
    input.installation.subscribedChannelId == null
      ? null
      : String(input.installation.subscribedChannelId);
  const channel =
    (updatePolicy === "auto_patch" || updatePolicy === "auto_minor") &&
    subscribedChannelId
      ? await loadHostedAppReleaseChannel(prisma, {
          appId: input.appId,
          channelId: subscribedChannelId,
        })
      : null;
  return resolveReleaseForInstallation({
    installation: {
      updatePolicy,
      currentReleaseId: String(
        input.installation.currentReleaseId || input.releaseId,
      ),
      subscribedChannelId,
    },
    channel,
  });
}

function buildResolvedHostedAppInstallation(
  installation: any | null,
  releaseId: string,
) {
  if (!installation) return installation;
  return {
    ...installation,
    currentReleaseId: releaseId,
  };
}

async function loadHostedAppReleaseChannel(
  prisma: any,
  input: { appId: string; channelId: string },
): Promise<{ channelId: string; pointsToReleaseId: string }> {
  if (!prisma?.hostedAppReleaseChannel?.findUnique) {
    throw new Error("hosted_app_release_channel_registry_unavailable");
  }
  const channel = await prisma.hostedAppReleaseChannel.findUnique({
    where: {
      appId_channelId: { appId: input.appId, channelId: input.channelId },
    },
  });
  if (
    !channel ||
    channel.appId !== input.appId ||
    channel.channelId !== input.channelId ||
    !channel.pointsToReleaseId
  ) {
    throw new Error("hosted_app_release_channel_missing");
  }
  return {
    channelId: input.channelId,
    pointsToReleaseId: String(channel.pointsToReleaseId),
  };
}

async function assertRegisteredReleaseRuntimeGates(
  prisma: any,
  input: {
    appId: string;
    circleId: number;
    release: any;
    userPubkey: string;
    requestedCapability: string;
  },
): Promise<void> {
  const releaseKind =
    String(input.release.status || "active") === "candidate"
      ? "candidate"
      : "production";
  const audienceGrant =
    releaseKind === "candidate"
      ? await loadHostedAppReleaseAudienceGrant(prisma, {
          appId: input.appId,
          releaseId: String(input.release.releaseId || ""),
          circleId: input.circleId,
          userPubkey: input.userPubkey,
        })
      : null;
  assertCandidateReleaseAudience({ releaseKind, audienceGrant });

  const gracePolicy = await loadHostedAppReleaseGracePolicy(prisma, {
    appId: input.appId,
    releaseId: String(input.release.releaseId || ""),
  });
  if (String(input.release.status || "active") === "grace" && !gracePolicy) {
    throw new Error("hosted_app_grace_policy_required");
  }
  assertGraceReleaseCanRun({
    supportStatus: String(gracePolicy?.supportStatus || "active"),
    graceUntil: readOptionalDateIso(gracePolicy?.graceUntil),
    allowedCapabilitiesDuringGrace: normalizeStringList(
      gracePolicy?.allowedCapabilitiesDuringGrace,
    ),
    requestedCapability: input.requestedCapability,
  });
}

async function maybeAssertHostedAppChainTrustRoot(
  prisma: any,
  input: {
    input: HostedAppReleaseRuntimeGateInput;
    release: any;
    installation: any;
  },
): Promise<HostedAppChainTrustRootSnapshot | undefined> {
  const requireChainTrustRoot =
    input.input.requireChainTrustRoot ??
    parseHostedAppRequireChainTrustRoot(process.env);
  if (!requireChainTrustRoot || !isProductionLikeRelease(input.release)) {
    return undefined;
  }
  return resolveHostedAppChainTrustRootSnapshot(prisma, {
    appId: input.input.appId,
    release: input.release,
    requestedCapability: input.input.requestedCapability,
    channelId: readInstallationChainChannelId(input.installation),
    circleId: input.input.circleId,
    governanceExecutionNonceHash: input.input.governanceExecutionNonceHash,
    governanceReplayDomainHash: input.input.governanceReplayDomainHash,
    chainReader: input.input.chainReader,
  });
}

function isProductionLikeRelease(release: any): boolean {
  return (
    String(release?.status || "active")
      .trim()
      .toLowerCase() !== "candidate"
  );
}

function readInstallationChainChannelId(installation: any): string | null {
  const updatePolicy = String(installation?.updatePolicy || "manual");
  const channelId =
    installation?.subscribedChannelId == null
      ? ""
      : String(installation.subscribedChannelId).trim();
  if (!channelId) return null;
  return updatePolicy === "auto_patch" || updatePolicy === "auto_minor"
    ? channelId
    : null;
}

function assertHostedAppRuntimeCapabilityAllowed(input: {
  trust: any;
  installation: any;
  release: any;
  requestedCapability: string;
}): void {
  const requestedCapability = String(input.requestedCapability || "").trim();
  if (!requestedCapability) {
    throw new Error("hosted_app_capability_required");
  }
  if (
    !normalizeStringList(input.release?.capabilitySet).includes(
      requestedCapability,
    )
  ) {
    throw new Error("hosted_app_release_capability_not_declared");
  }
  if (
    !normalizeStringList(input.trust?.allowedCapabilities).includes(
      requestedCapability,
    )
  ) {
    throw new Error("hosted_app_capability_not_trusted");
  }
  if (
    !normalizeStringList(input.installation?.allowedCapabilities).includes(
      requestedCapability,
    )
  ) {
    throw new Error("hosted_app_capability_not_installed");
  }
}

async function loadHostedAppReleaseAudienceGrant(
  prisma: any,
  input: {
    appId: string;
    releaseId: string;
    circleId: number;
    userPubkey: string;
  },
): Promise<{ expiresAt: string; dataPolicy: string } | null> {
  if (!prisma?.hostedAppReleaseAudienceGrant?.findFirst) {
    throw new Error("hosted_app_candidate_audience_registry_unavailable");
  }
  const grant = await prisma.hostedAppReleaseAudienceGrant.findFirst({
    where: {
      appId: input.appId,
      releaseId: input.releaseId,
      OR: [
        { audienceType: "circle", audienceRef: String(input.circleId) },
        { audienceType: "circle", audienceRef: `circle:${input.circleId}` },
        { audienceType: "user", audienceRef: input.userPubkey },
        { audienceType: "wallet", audienceRef: input.userPubkey },
      ],
    },
    orderBy: { expiresAt: "desc" },
  });
  if (!grant) return null;
  return {
    expiresAt: readRequiredDateIso(
      grant.expiresAt,
      "hosted_app_candidate_audience_expired",
    ),
    dataPolicy: String(grant.dataPolicy || ""),
  };
}

async function loadHostedAppReleaseGracePolicy(
  prisma: any,
  input: { appId: string; releaseId: string },
): Promise<any | null> {
  if (!prisma?.hostedAppReleaseGracePolicy?.findUnique) return null;
  return prisma.hostedAppReleaseGracePolicy.findUnique({
    where: {
      appId_releaseId: { appId: input.appId, releaseId: input.releaseId },
    },
  });
}

function assertHostedAppReleaseFacts(input: {
  release: any;
  manifestHash: string;
  requestedBundleHash?: string | null;
  actualManifestHash?: string | null;
  actualBundleHash?: string | null;
}): void {
  const releaseStatus = String(input.release.status || "active");
  if (
    releaseStatus === "revoked" ||
    releaseStatus === "suspended" ||
    releaseStatus === "expired"
  ) {
    throw new Error("hosted_app_release_not_runnable");
  }
  const expectedManifestHash = String(input.release.manifestHash || "");
  const actualManifestHash = String(
    input.actualManifestHash || input.manifestHash,
  );
  if (!expectedManifestHash || actualManifestHash !== expectedManifestHash) {
    throw new Error("hosted_app_manifest_hash_mismatch");
  }
  const expectedBundleHash = String(input.release.bundleHash || "");
  const actualBundleHash = String(
    input.actualBundleHash ||
      input.requestedBundleHash ||
      input.release.bundleHash ||
      "",
  );
  if (!expectedBundleHash || actualBundleHash !== expectedBundleHash) {
    throw new Error("hosted_app_bundle_hash_mismatch");
  }
}

function assertHostedAppReleaseDeveloperSignatureValid(input: {
  release: any;
  developerSignature: string;
}): void {
  const developerPubkey = String(input.release?.createdByPubkey || "").trim();
  if (!developerPubkey) {
    throw new Error("hosted_app_developer_signature_invalid");
  }
  const publicKey = decodeBase58Bytes(
    developerPubkey,
    32,
    "hosted_app_developer_signature_invalid",
  );
  const signature = decodeDeveloperSignature(input.developerSignature);
  const payload = Buffer.from(
    buildHostedAppReleaseDeveloperSignaturePayload(input.release),
  );
  if (!nacl.sign.detached.verify(payload, signature, publicKey)) {
    throw new Error("hosted_app_developer_signature_invalid");
  }
}

function decodeDeveloperSignature(value: string): Uint8Array {
  const trimmed = value.trim();
  const base64 = Buffer.from(trimmed, "base64");
  if (base64.length === 64) {
    return Uint8Array.from(base64);
  }
  return decodeBase58Bytes(
    trimmed,
    64,
    "hosted_app_developer_signature_invalid",
  );
}

function decodeBase58Bytes(
  value: string,
  expectedLength: number,
  errorCode: string,
): Uint8Array {
  try {
    const bytes = Uint8Array.from(bs58.decode(value.trim()));
    if (bytes.length !== expectedLength) throw new Error("invalid length");
    return bytes;
  } catch {
    throw new Error(errorCode);
  }
}

function normalizeStringList(value: unknown): string[] {
  if (!Array.isArray(value)) return [];
  return value.map((entry) => String(entry).trim()).filter(Boolean);
}

function readOptionalDateIso(value: unknown): string | null {
  if (value == null) return null;
  return readRequiredDateIso(value, "hosted_app_date_invalid");
}

function readRequiredDateIso(value: unknown, errorCode: string): string {
  const date = value instanceof Date ? value : new Date(String(value));
  if (Number.isNaN(date.getTime())) {
    throw new Error(errorCode);
  }
  return date.toISOString();
}
