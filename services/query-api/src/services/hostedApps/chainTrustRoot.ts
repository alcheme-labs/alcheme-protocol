import fs from "node:fs";
import crypto from "node:crypto";
import path from "node:path";

import { BorshAccountsCoder, type Idl } from "@coral-xyz/anchor";
import { Connection, PublicKey } from "@solana/web3.js";

import { getHostedAppCapabilityDefinition } from "./capabilityCatalog";
import { digestJson } from "./digest";

export const HOSTED_APP_TRUST_ROOT_PROGRAM_ID =
  process.env.HOSTED_APP_TRUST_ROOT_PROGRAM_ID ||
  "4eeDm2Qs6YSQMd5mj9KhtBuQdGUjpxbREfHGKbxnNzae";

const DEFAULT_MAX_CHAIN_ANCHOR_AGE_MS = 5 * 60 * 1000;
const HASH_NAMESPACE = "alcheme:hosted-app-trust-root:v1";
const PDA_SEEDS = {
  identity: "hosted_app_identity",
  release: "hosted_app_release",
  channel: "hosted_app_release_channel",
  deny: "hosted_app_capability_deny",
  credential: "hosted_app_credential_anchor",
  governanceExecution: "hosted_app_governance_execution",
  policy: "hosted_app_policy_anchor",
  installation: "hosted_app_installation",
} as const;
const DECODED_FIELD_ALIASES: Record<string, string> = {
  appIdHash: "app_id_hash",
  releaseIdHash: "release_id_hash",
  channelIdHash: "channel_id_hash",
  currentReleaseIdHash: "current_release_id_hash",
  previousReleaseIdHash: "previous_release_id_hash",
  manifestHash: "manifest_hash",
  bundleHash: "bundle_hash",
  bundleUriHash: "bundle_uri_hash",
  capabilitySetDigest: "capability_set_digest",
  productionStatus: "production_status",
  releaseKind: "release_kind",
  supportStatus: "support_status",
  commitmentDigest: "commitment_digest",
  stateDigest: "state_digest",
};

export const hostedAppChainObjectRefs = {
  appIdentity(appId: string): string {
    return `hosted_app:${normalizeRefPart(appId)}`;
  },
  release(appId: string, releaseId: string): string {
    return `hosted_app:${normalizeRefPart(appId)}:release:${normalizeRefPart(releaseId)}`;
  },
  channel(appId: string, channelId: string): string {
    return `hosted_app:${normalizeRefPart(appId)}:channel:${normalizeRefPart(channelId)}`;
  },
  capabilityDeny(appId: string, capabilityId: string): string {
    return `hosted_app:${normalizeRefPart(appId)}:capability:${normalizeRefPart(capabilityId)}`;
  },
  policy(appId: string, capabilityId: string): string {
    return `hosted_app:${normalizeRefPart(appId)}:policy:${normalizeRefPart(capabilityId)}`;
  },
  circleInstallation(appId: string, circleId: number | string): string {
    return `hosted_app:${normalizeRefPart(appId)}:circle:${normalizeRefPart(String(circleId))}:installation`;
  },
  governanceExecution(
    appId: string,
    nonceHash: string,
    replayDomainHash?: string | null,
  ): string {
    const base = `hosted_app:${normalizeRefPart(appId)}:governance_execution`;
    return replayDomainHash
      ? `${base}:${normalizeRefPart(replayDomainHash)}:${normalizeRefPart(nonceHash)}`
      : `${base}:${normalizeRefPart(nonceHash)}`;
  },
};

export interface HostedAppChainTrustRootRequest {
  appId: string;
  release: {
    appId?: string | null;
    releaseId: string;
    manifestHash: string;
    bundleHash: string;
    bundleUri?: string | null;
    capabilitySet?: unknown;
    status?: string | null;
  };
  requestedCapability: string;
  channelId?: string | null;
  circleId?: number | null;
  governanceExecutionNonceHash?: string | null;
  governanceReplayDomainHash?: string | null;
  programId?: string;
  now?: Date;
  maxAnchorAgeMs?: number;
  chainReader?: HostedAppChainTrustRootReader;
}

export interface HostedAppChainTrustRootSnapshot {
  appIdentity: ChainAnchorProjection;
  release: ChainAnchorProjection;
  channel: ChainAnchorProjection | null;
  policyAnchor: ChainAnchorProjection | null;
  installationAnchor: ChainAnchorProjection | null;
  checkedAt: string;
}

export interface ChainAnchorProjection {
  id: string;
  anchorType: string;
  objectRef: string;
  digest: string;
  chainRef: string;
  programId: string;
  accountPubkey: string;
  slot: bigint | number | string;
  finalityStatus: string;
  observedAt: Date | string;
  expiresAt?: Date | string | null;
  sourceTxSignature?: string | null;
  projectionDigest: string;
  status?: string | null;
}

export interface HostedAppChainAccountProof {
  anchorType: string;
  objectRef: string;
  digest: string;
  chainRef: string;
  programId: string;
  ownerProgramId?: string | null;
  accountPubkey: string;
  expectedAccountPubkey?: string | null;
  pdaMatches?: boolean;
  slot: bigint | number | string;
  finalityStatus: string;
  observedAt: Date | string;
  expiresAt?: Date | string | null;
  sourceTxSignature?: string | null;
  projectionDigest?: string | null;
  status?: string | null;
  missing?: boolean;
  decoded?: Record<string, unknown>;
}

export interface HostedAppRequiredChainAnchor {
  anchorType: string;
  objectRef: string;
  accountPubkey?: string | null;
  expectedAccountPubkey?: string | null;
  optional?: boolean;
}

export interface HostedAppChainTrustRootReader {
  readAnchors(input: {
    programId: string;
    requiredAnchors: HostedAppRequiredChainAnchor[];
    now: Date;
    maxAnchorAgeMs: number;
  }): Promise<HostedAppChainAccountProof[]>;
}

export async function resolveHostedAppChainTrustRootSnapshot(
  prisma: any,
  input: HostedAppChainTrustRootRequest,
): Promise<HostedAppChainTrustRootSnapshot> {
  if (!prisma?.hostedAppChainAnchor?.findMany) {
    throw new Error("hosted_app_chain_anchor_projection_unavailable");
  }

  const appId = normalizeRefPart(input.appId);
  const releaseId = normalizeRefPart(input.release.releaseId);
  const requestedCapability = normalizeRefPart(input.requestedCapability);
  const expectedProgramId = input.programId || HOSTED_APP_TRUST_ROOT_PROGRAM_ID;
  const now = input.now || new Date();
  const maxAnchorAgeMs = Number.isFinite(input.maxAnchorAgeMs)
    ? Number(input.maxAnchorAgeMs)
    : DEFAULT_MAX_CHAIN_ANCHOR_AGE_MS;
  if (input.governanceExecutionNonceHash && !input.governanceReplayDomainHash) {
    throw new Error("hosted_app_chain_governance_replay_domain_required");
  }

  const requiredAnchors = [
    {
      anchorType: "hosted_app_identity",
      objectRef: hostedAppChainObjectRefs.appIdentity(appId),
    },
    {
      anchorType: "hosted_app_release",
      objectRef: hostedAppChainObjectRefs.release(appId, releaseId),
    },
    {
      anchorType: "hosted_app_capability_deny",
      objectRef: hostedAppChainObjectRefs.capabilityDeny(
        appId,
        requestedCapability,
      ),
      optional: true,
    },
    ...(input.channelId
      ? [
          {
            anchorType: "hosted_app_release_channel",
            objectRef: hostedAppChainObjectRefs.channel(appId, input.channelId),
          },
        ]
      : []),
    ...(requiresHighValueChainPolicy(requestedCapability)
      ? [
          {
            anchorType: "hosted_app_policy",
            objectRef: hostedAppChainObjectRefs.policy(
              appId,
              requestedCapability,
            ),
          },
          ...(input.circleId
            ? [
                {
                  anchorType: "hosted_app_circle_installation",
                  objectRef: hostedAppChainObjectRefs.circleInstallation(
                    appId,
                    input.circleId,
                  ),
                },
              ]
            : []),
        ]
      : []),
    ...(input.governanceExecutionNonceHash
      ? [
          {
            anchorType: "hosted_app_governance_execution",
            objectRef: hostedAppChainObjectRefs.governanceExecution(
              appId,
              input.governanceExecutionNonceHash,
              input.governanceReplayDomainHash,
            ),
          },
        ]
      : []),
  ];

  const anchors = await prisma.hostedAppChainAnchor.findMany({
    where: { objectRef: { in: requiredAnchors.map((entry) => entry.objectRef) } },
  });
  const byTypeAndRef = new Map<string, ChainAnchorProjection>();
  for (const anchor of anchors) {
    assertChainAnchorProjection(anchor, {
      expectedProgramId,
      now,
      maxAnchorAgeMs,
    });
    byTypeAndRef.set(anchorKey(anchor.anchorType, anchor.objectRef), anchor);
  }
  const chainReader = resolveChainTrustRootReader(prisma, input);
  if (!chainReader) {
    throw new Error("hosted_app_chain_reader_unavailable");
  }
  const proofs = await chainReader.readAnchors({
    programId: expectedProgramId,
    requiredAnchors: buildRequiredChainAnchorProofRequests(
      requiredAnchors,
      byTypeAndRef,
      expectedProgramId,
    ),
    now,
    maxAnchorAgeMs,
  });
  const proofByTypeAndRef = new Map<string, HostedAppChainAccountProof>();
  for (const proof of proofs || []) {
    proofByTypeAndRef.set(anchorKey(proof.anchorType, proof.objectRef), proof);
  }
  for (const anchor of byTypeAndRef.values()) {
    assertChainAccountProof(anchor, proofByTypeAndRef.get(anchorKey(anchor.anchorType, anchor.objectRef)), {
      expectedProgramId,
      now,
      maxAnchorAgeMs,
    });
  }

  const appIdentity = requireAnchor(byTypeAndRef, {
    anchorType: "hosted_app_identity",
    objectRef: hostedAppChainObjectRefs.appIdentity(appId),
    missingError: "hosted_app_chain_identity_missing",
  });
  assertActiveStatus(appIdentity, "hosted_app_chain_identity_not_active");
  assertDecodedIdentityActive(
    requireProof(proofByTypeAndRef, appIdentity),
    "hosted_app_chain_identity_not_active",
  );
  assertDecodedIdentityMatches(requireProof(proofByTypeAndRef, appIdentity), {
    appId,
  });

  const release = requireAnchor(byTypeAndRef, {
    anchorType: "hosted_app_release",
    objectRef: hostedAppChainObjectRefs.release(appId, releaseId),
    missingError: "hosted_app_chain_release_missing",
  });
  assertActiveStatus(release, "hosted_app_chain_release_not_active");
  assertDecodedReleaseMatchesRuntimeRelease(
    requireProof(proofByTypeAndRef, release),
    {
      appId,
      releaseId,
      release: input.release,
    },
  );

  const channel = input.channelId
    ? requireAnchor(byTypeAndRef, {
        anchorType: "hosted_app_release_channel",
        objectRef: hostedAppChainObjectRefs.channel(appId, input.channelId),
        missingError: "hosted_app_chain_channel_missing",
      })
    : null;
  if (channel) {
    assertDecodedChannelMatchesRuntimeRelease(requireProof(proofByTypeAndRef, channel), {
      appId,
      channelId: input.channelId || "",
      releaseId,
    });
  }

  const deny = byTypeAndRef.get(
    anchorKey(
      "hosted_app_capability_deny",
      hostedAppChainObjectRefs.capabilityDeny(appId, requestedCapability),
    ),
  );
  const denyProof = proofByTypeAndRef.get(
    anchorKey(
      "hosted_app_capability_deny",
      hostedAppChainObjectRefs.capabilityDeny(appId, requestedCapability),
    ),
  );
  if (deny && isActiveStatus(deny)) {
    throw new Error("hosted_app_chain_capability_denied");
  }
  if (denyProof && !denyProof.missing) {
    assertStandaloneChainAccountProof(denyProof, {
      expectedProgramId,
      now,
      maxAnchorAgeMs,
    });
    if (isActiveChainProof(denyProof)) {
      throw new Error("hosted_app_chain_capability_denied");
    }
  }

  if (input.governanceExecutionNonceHash) {
    const governanceExecutionObjectRef = hostedAppChainObjectRefs.governanceExecution(
      appId,
      input.governanceExecutionNonceHash,
      input.governanceReplayDomainHash,
    );
    const consumed = byTypeAndRef.get(
      anchorKey(
        "hosted_app_governance_execution",
        governanceExecutionObjectRef,
      ),
    );
    if (consumed && isActiveStatus(consumed)) {
      throw new Error("hosted_app_chain_governance_nonce_consumed");
    }
    const consumedProof = proofByTypeAndRef.get(
      anchorKey("hosted_app_governance_execution", governanceExecutionObjectRef),
    );
    if (consumedProof && !consumedProof.missing) {
      assertStandaloneChainAccountProof(consumedProof, {
        expectedProgramId,
        now,
        maxAnchorAgeMs,
      });
      if (isActiveChainProof(consumedProof)) {
        throw new Error("hosted_app_chain_governance_nonce_consumed");
      }
    }
  }

  const requiresHighValuePolicy =
    requiresHighValueChainPolicy(requestedCapability);
  const policyAnchor = requiresHighValuePolicy
    ? requireAnchor(byTypeAndRef, {
        anchorType: "hosted_app_policy",
        objectRef: hostedAppChainObjectRefs.policy(appId, requestedCapability),
        missingError: "hosted_app_chain_policy_anchor_missing",
      })
    : null;
  if (policyAnchor) {
    assertActiveStatus(policyAnchor, "hosted_app_chain_policy_anchor_not_active");
    assertDecodedAnchorActive(
      requireProof(proofByTypeAndRef, policyAnchor),
      "hosted_app_chain_policy_anchor_not_active",
    );
  }

  const installationAnchor =
    requiresHighValuePolicy && input.circleId
      ? requireAnchor(byTypeAndRef, {
          anchorType: "hosted_app_circle_installation",
          objectRef: hostedAppChainObjectRefs.circleInstallation(
            appId,
            input.circleId,
          ),
          missingError: "hosted_app_chain_installation_anchor_missing",
        })
      : null;
  if (installationAnchor) {
    assertActiveStatus(
      installationAnchor,
      "hosted_app_chain_installation_anchor_not_active",
    );
    assertDecodedAnchorActive(
      requireProof(proofByTypeAndRef, installationAnchor),
      "hosted_app_chain_installation_anchor_not_active",
    );
  }

  return {
    appIdentity,
    release,
    channel,
    policyAnchor,
    installationAnchor,
    checkedAt: now.toISOString(),
  };
}

function buildRequiredChainAnchorProofRequests(
  requiredAnchors: Array<{
    anchorType: string;
    objectRef: string;
    optional?: boolean;
  }>,
  anchors: Map<string, ChainAnchorProjection>,
  programId: string,
): HostedAppRequiredChainAnchor[] {
  return requiredAnchors.map((requiredAnchor) => {
    const anchor = anchors.get(anchorKey(requiredAnchor.anchorType, requiredAnchor.objectRef));
    return {
      anchorType: requiredAnchor.anchorType,
      objectRef: requiredAnchor.objectRef,
      accountPubkey: anchor?.accountPubkey,
      expectedAccountPubkey: deriveHostedAppChainAccountPubkey({
        anchorType: requiredAnchor.anchorType,
        objectRef: requiredAnchor.objectRef,
        programId,
        digest: anchor?.digest,
      }),
      optional: requiredAnchor.optional,
    };
  });
}

function resolveChainTrustRootReader(
  prisma: any,
  input: HostedAppChainTrustRootRequest,
): HostedAppChainTrustRootReader | null {
  if (input.chainReader) return input.chainReader;
  if (prisma?.hostedAppChainTrustRootReader?.readAnchors) {
    return prisma.hostedAppChainTrustRootReader;
  }
  return buildDefaultHostedAppChainTrustRootReaderFromEnv();
}

export function buildDefaultHostedAppChainTrustRootReaderFromEnv(): HostedAppChainTrustRootReader | null {
  const rpcUrl = String(process.env.HOSTED_APP_TRUST_ROOT_RPC_URL || "").trim();
  if (!rpcUrl) return null;
  return new SolanaHostedAppChainTrustRootReader({
    rpcUrl,
    idlPath: process.env.HOSTED_APP_TRUST_ROOT_IDL_PATH,
  });
}

class SolanaHostedAppChainTrustRootReader implements HostedAppChainTrustRootReader {
  private readonly connection: Connection;
  private readonly coder: BorshAccountsCoder;

  constructor(input: { rpcUrl: string; idlPath?: string }) {
    this.connection = new Connection(input.rpcUrl, "finalized");
    this.coder = new BorshAccountsCoder(loadHostedAppTrustRootIdl(input.idlPath));
  }

  async readAnchors(input: {
    programId: string;
    requiredAnchors: HostedAppRequiredChainAnchor[];
    now: Date;
    maxAnchorAgeMs: number;
  }): Promise<HostedAppChainAccountProof[]> {
    const programId = new PublicKey(input.programId);
    const proofs: HostedAppChainAccountProof[] = [];
    for (const requiredAnchor of input.requiredAnchors) {
      const expectedAccountPubkey =
        requiredAnchor.expectedAccountPubkey || requiredAnchor.accountPubkey;
      if (!expectedAccountPubkey) {
        throw new Error("hosted_app_chain_anchor_account_missing");
      }
      const accountPubkey = new PublicKey(expectedAccountPubkey);
      const response = await this.connection.getAccountInfoAndContext(
        accountPubkey,
        "finalized",
      );
      const account = response.value;
      if (!account) {
        proofs.push({
          anchorType: requiredAnchor.anchorType,
          objectRef: requiredAnchor.objectRef,
          digest: "",
          chainRef: `solana:${input.programId}:${accountPubkey.toBase58()}`,
          programId: input.programId,
          ownerProgramId: null,
          accountPubkey: accountPubkey.toBase58(),
          expectedAccountPubkey,
          pdaMatches: false,
          slot: response.context.slot,
          finalityStatus: "finalized",
          observedAt: input.now,
          missing: true,
          decoded: {},
        });
        continue;
      }
      const decoded = this.coder.decodeAny(account.data) as Record<string, unknown>;
      proofs.push({
        anchorType: requiredAnchor.anchorType,
        objectRef: requiredAnchor.objectRef,
        digest: readDecodedDigest(requiredAnchor.anchorType, decoded),
        projectionDigest: digestJson(toJcsCompatible(decoded)),
        chainRef: `solana:${input.programId}:${accountPubkey.toBase58()}`,
        programId: input.programId,
        ownerProgramId: account.owner.toBase58(),
        accountPubkey: accountPubkey.toBase58(),
        expectedAccountPubkey,
        pdaMatches:
          account.owner.equals(programId) &&
          accountPubkey.toBase58() === expectedAccountPubkey,
        slot: response.context.slot,
        finalityStatus: "finalized",
        observedAt: input.now,
        status: readDecodedStatus(requiredAnchor.anchorType, decoded),
        decoded,
      });
    }
    return proofs;
  }
}

function loadHostedAppTrustRootIdl(idlPath?: string): Idl {
  const resolved =
    idlPath ||
    path.resolve(
      __dirname,
      "../../../../../target/idl/hosted_app_trust_root.json",
    );
  if (!fs.existsSync(resolved)) {
    throw new Error("hosted_app_chain_trust_root_idl_missing");
  }
  return JSON.parse(fs.readFileSync(resolved, "utf8")) as Idl;
}

function assertChainAccountProof(
  anchor: ChainAnchorProjection,
  proof: HostedAppChainAccountProof | undefined,
  input: { expectedProgramId: string; now: Date; maxAnchorAgeMs: number },
): void {
  if (!proof) throw new Error("hosted_app_chain_account_proof_missing");
  if (proof.missing) throw new Error("hosted_app_chain_account_missing");
  const expectedAccountPubkey = deriveHostedAppChainAccountPubkey({
    anchorType: anchor.anchorType,
    objectRef: anchor.objectRef,
    programId: input.expectedProgramId,
    digest: anchor.digest,
  });
  if (expectedAccountPubkey) {
    if (String(anchor.accountPubkey || "") !== expectedAccountPubkey) {
      throw new Error("hosted_app_chain_anchor_pda_mismatch");
    }
    if (String(proof.accountPubkey || "") !== expectedAccountPubkey) {
      throw new Error("hosted_app_chain_anchor_pda_mismatch");
    }
    if (
      proof.expectedAccountPubkey &&
      proof.expectedAccountPubkey !== expectedAccountPubkey
    ) {
      throw new Error("hosted_app_chain_anchor_pda_mismatch");
    }
  }
  if (proof.anchorType !== anchor.anchorType || proof.objectRef !== anchor.objectRef) {
    throw new Error("hosted_app_chain_anchor_proof_mismatch");
  }
  if (String(proof.programId || "") !== input.expectedProgramId) {
    throw new Error("hosted_app_chain_anchor_program_mismatch");
  }
  if (String(proof.ownerProgramId || "") !== input.expectedProgramId) {
    throw new Error("hosted_app_chain_anchor_owner_mismatch");
  }
  if (proof.pdaMatches !== true) {
    throw new Error("hosted_app_chain_anchor_pda_mismatch");
  }
  if (String(proof.accountPubkey || "") !== String(anchor.accountPubkey || "")) {
    throw new Error("hosted_app_chain_anchor_account_mismatch");
  }
  if (proof.expectedAccountPubkey && proof.expectedAccountPubkey !== anchor.accountPubkey) {
    throw new Error("hosted_app_chain_anchor_account_mismatch");
  }
  if (
    String(proof.finalityStatus || "")
      .trim()
      .toLowerCase() !== "finalized"
  ) {
    throw new Error("hosted_app_chain_anchor_unfinalized");
  }
  if (!String(proof.digest || "").trim() || String(proof.digest) !== anchor.digest) {
    throw new Error("hosted_app_chain_anchor_digest_mismatch");
  }
  if (anchor.projectionDigest) {
    if (
      !proof.projectionDigest ||
      String(proof.projectionDigest) !== String(anchor.projectionDigest)
    ) {
      throw new Error("hosted_app_chain_anchor_projection_mismatch");
    }
  }
  const observedAt = readDate(proof.observedAt);
  if (
    !observedAt ||
    input.now.getTime() - observedAt.getTime() > input.maxAnchorAgeMs
  ) {
    throw new Error("hosted_app_chain_anchor_stale");
  }
}

function assertStandaloneChainAccountProof(
  proof: HostedAppChainAccountProof,
  input: { expectedProgramId: string; now: Date; maxAnchorAgeMs: number },
): void {
  if (String(proof.programId || "") !== input.expectedProgramId) {
    throw new Error("hosted_app_chain_anchor_program_mismatch");
  }
  if (String(proof.ownerProgramId || "") !== input.expectedProgramId) {
    throw new Error("hosted_app_chain_anchor_owner_mismatch");
  }
  const expectedAccountPubkey = deriveHostedAppChainAccountPubkey({
    anchorType: proof.anchorType,
    objectRef: proof.objectRef,
    programId: input.expectedProgramId,
    digest: proof.digest,
  });
  if (expectedAccountPubkey) {
    if (String(proof.accountPubkey || "") !== expectedAccountPubkey) {
      throw new Error("hosted_app_chain_anchor_pda_mismatch");
    }
    if (
      proof.expectedAccountPubkey &&
      proof.expectedAccountPubkey !== expectedAccountPubkey
    ) {
      throw new Error("hosted_app_chain_anchor_pda_mismatch");
    }
  }
  if (proof.pdaMatches !== true) {
    throw new Error("hosted_app_chain_anchor_pda_mismatch");
  }
  if (
    String(proof.finalityStatus || "")
      .trim()
      .toLowerCase() !== "finalized"
  ) {
    throw new Error("hosted_app_chain_anchor_unfinalized");
  }
  const observedAt = readDate(proof.observedAt);
  if (
    !observedAt ||
    input.now.getTime() - observedAt.getTime() > input.maxAnchorAgeMs
  ) {
    throw new Error("hosted_app_chain_anchor_stale");
  }
}

function isActiveChainProof(proof: HostedAppChainAccountProof): boolean {
  const decoded = proof.decoded || {};
  if (readDecodedField(decoded, "active") === false) return false;
  if (readDecodedField(decoded, "revoked") === true) return false;
  const status = decodedStatusName(
    readDecodedField(decoded, "status") ||
      readDecodedField(decoded, "productionStatus") ||
      readDecodedField(decoded, "supportStatus") ||
      proof.status ||
      "active",
  );
  return status.trim().toLowerCase() === "active";
}

function requireProof(
  proofs: Map<string, HostedAppChainAccountProof>,
  anchor: ChainAnchorProjection,
): HostedAppChainAccountProof {
  const proof = proofs.get(anchorKey(anchor.anchorType, anchor.objectRef));
  if (!proof) throw new Error("hosted_app_chain_account_proof_missing");
  return proof;
}

function assertChainAnchorProjection(
  anchor: ChainAnchorProjection,
  input: { expectedProgramId: string; now: Date; maxAnchorAgeMs: number },
): void {
  if (!anchor || typeof anchor !== "object") {
    throw new Error("hosted_app_chain_anchor_invalid");
  }
  if (String(anchor.programId || "") !== input.expectedProgramId) {
    throw new Error("hosted_app_chain_anchor_program_mismatch");
  }
  if (!String(anchor.accountPubkey || "").trim()) {
    throw new Error("hosted_app_chain_anchor_account_missing");
  }
  if (
    String(anchor.finalityStatus || "")
      .trim()
      .toLowerCase() !== "finalized"
  ) {
    throw new Error("hosted_app_chain_anchor_unfinalized");
  }
  if (!String(anchor.digest || "").trim()) {
    throw new Error("hosted_app_chain_anchor_digest_missing");
  }
  if (!String(anchor.projectionDigest || "").trim()) {
    throw new Error("hosted_app_chain_anchor_projection_digest_missing");
  }
  const observedAt = readDate(anchor.observedAt);
  if (
    !observedAt ||
    input.now.getTime() - observedAt.getTime() > input.maxAnchorAgeMs
  ) {
    throw new Error("hosted_app_chain_anchor_stale");
  }
  const expiresAt = anchor.expiresAt ? readDate(anchor.expiresAt) : null;
  if (expiresAt && expiresAt.getTime() <= input.now.getTime()) {
    throw new Error("hosted_app_chain_anchor_expired");
  }
}

function requireAnchor(
  anchors: Map<string, ChainAnchorProjection>,
  input: { anchorType: string; objectRef: string; missingError: string },
): ChainAnchorProjection {
  const anchor = anchors.get(anchorKey(input.anchorType, input.objectRef));
  if (!anchor) throw new Error(input.missingError);
  return anchor;
}

function anchorKey(anchorType: string, objectRef: string): string {
  return `${String(anchorType || "").trim()}::${String(objectRef || "").trim()}`;
}

function normalizeRefPart(value: string): string {
  const normalized = String(value || "").trim();
  if (!normalized) throw new Error("hosted_app_chain_ref_required");
  return normalized;
}

function readDate(value: Date | string): Date | null {
  if (value instanceof Date)
    return Number.isFinite(value.getTime()) ? value : null;
  const parsed = new Date(String(value || ""));
  return Number.isFinite(parsed.getTime()) ? parsed : null;
}

function isActiveStatus(anchor: ChainAnchorProjection): boolean {
  return (
    String(anchor.status || "active")
      .trim()
      .toLowerCase() === "active"
  );
}

function assertActiveStatus(
  anchor: ChainAnchorProjection,
  errorCode: string,
): void {
  if (!isActiveStatus(anchor)) throw new Error(errorCode);
}

function requiresHighValueChainPolicy(capabilityId: string): boolean {
  const capability = getHostedAppCapabilityDefinition(capabilityId);
  if (!capability) return false;
  return capability.riskLevel === "high" || capability.riskLevel === "critical";
}

function assertDecodedIdentityActive(
  proof: HostedAppChainAccountProof,
  errorCode: string,
): void {
  const decoded = proof.decoded || {};
  const status = String(
    readDecodedField(decoded, "productionStatus") ||
      readDecodedField(decoded, "status") ||
      proof.status ||
      "",
  )
    .trim()
    .toLowerCase();
  if (status && status !== "active") throw new Error(errorCode);
}

function assertDecodedIdentityMatches(
  proof: HostedAppChainAccountProof,
  input: { appId: string },
): void {
  const decoded = proof.decoded || {};
  assertDecodedTextOrHashMatches(decoded, {
    textField: "appId",
    hashField: "appIdHash",
    expectedText: input.appId,
    hashKind: "app",
    errorCode: "hosted_app_chain_identity_app_mismatch",
  });
}

function assertDecodedAnchorActive(
  proof: HostedAppChainAccountProof,
  errorCode: string,
): void {
  const decoded = proof.decoded || {};
  if (
    readDecodedField(decoded, "active") === false ||
    readDecodedField(decoded, "revoked") === true ||
    String(readDecodedField(decoded, "status") || proof.status || "active")
      .trim()
      .toLowerCase() !== "active"
  ) {
    throw new Error(errorCode);
  }
}

function assertDecodedReleaseMatchesRuntimeRelease(
  proof: HostedAppChainAccountProof,
  input: {
    appId: string;
    releaseId: string;
    release: HostedAppChainTrustRootRequest["release"];
  },
): void {
  const decoded = proof.decoded || {};
  assertDecodedTextOrHashMatches(decoded, {
    textField: "appId",
    hashField: "appIdHash",
    expectedText: input.appId,
    hashKind: "app",
    errorCode: "hosted_app_chain_release_app_mismatch",
  });
  assertDecodedTextOrHashMatches(decoded, {
    textField: "releaseId",
    hashField: "releaseIdHash",
    expectedText: input.releaseId,
    hashKind: "release",
    errorCode: "hosted_app_chain_release_id_mismatch",
  });
  assertDecodedTextOrHashMatches(decoded, {
    textField: "manifestHash",
    hashField: "manifestHash",
    expectedText: input.release.manifestHash,
    hashKind: "digest",
    errorCode: "hosted_app_chain_release_manifest_mismatch",
  });
  assertDecodedTextOrHashMatches(decoded, {
    textField: "bundleHash",
    hashField: "bundleHash",
    expectedText: input.release.bundleHash,
    hashKind: "digest",
    errorCode: "hosted_app_chain_release_bundle_mismatch",
  });
  assertDecodedTextOrHashMatches(decoded, {
    textField: "bundleUri",
    hashField: "bundleUriHash",
    expectedText: input.release.bundleUri || "",
    hashKind: "uri",
    errorCode: "hosted_app_chain_release_bundle_uri_mismatch",
  });
  assertDecodedTextOrHashMatches(decoded, {
    textField: "capabilitySetDigest",
    hashField: "capabilitySetDigest",
    expectedText: digestJson(input.release.capabilitySet ?? []),
    hashKind: "digest",
    errorCode: "hosted_app_chain_release_capability_set_mismatch",
  });
  const supportStatus = decodedStatusName(
    readDecodedField(decoded, "supportStatus") || proof.status || "active",
  )
    .trim()
    .toLowerCase();
  if (["revoked", "suspended", "expired", "deprecated"].includes(supportStatus)) {
    throw new Error("hosted_app_chain_release_not_active");
  }
}

function assertDecodedChannelMatchesRuntimeRelease(
  proof: HostedAppChainAccountProof,
  input: { appId: string; channelId: string; releaseId: string },
): void {
  const decoded = proof.decoded || {};
  assertDecodedTextOrHashMatches(decoded, {
    textField: "appId",
    hashField: "appIdHash",
    expectedText: input.appId,
    hashKind: "app",
    errorCode: "hosted_app_chain_channel_app_mismatch",
  });
  assertDecodedTextOrHashMatches(decoded, {
    textField: "channelId",
    hashField: "channelIdHash",
    expectedText: input.channelId,
    hashKind: "channel",
    errorCode: "hosted_app_chain_channel_id_mismatch",
  });
  assertDecodedTextOrHashMatches(decoded, {
    textField: "currentReleaseId",
    hashField: "currentReleaseIdHash",
    expectedText: input.releaseId,
    hashKind: "release",
    errorCode: "hosted_app_chain_channel_release_mismatch",
  });
  const previous =
    readDecodedField(decoded, "previousReleaseId") ??
    readDecodedField(decoded, "previousReleaseIdHash");
  if (previous !== undefined && previous !== null && !String(previous).trim()) {
    throw new Error("hosted_app_chain_channel_previous_release_missing");
  }
}

function assertDecodedTextOrHashMatches(
  decoded: Record<string, unknown>,
  input: {
    textField: string;
    hashField: string;
    expectedText: string;
    hashKind: string;
    errorCode: string;
  },
): void {
  const textValue = readDecodedField(decoded, input.textField);
  const hashValue = readDecodedField(decoded, input.hashField);
  const expectedText = String(input.expectedText ?? "");
  const expectedHash = bytes32Hex(input.hashKind, expectedText);
  if (textValue !== undefined && textValue !== null) {
    const actualHash = decodedBytes32Hex(textValue);
    if (actualHash) {
      if (actualHash !== expectedHash) throw new Error(input.errorCode);
      return;
    }
    if (String(textValue) !== expectedText) throw new Error(input.errorCode);
    return;
  }
  if (hashValue !== undefined && hashValue !== null) {
    const actualHash = decodedBytes32Hex(hashValue);
    if (!actualHash || actualHash !== expectedHash) throw new Error(input.errorCode);
    return;
  }
  throw new Error(input.errorCode);
}

export function normalizeHostedAppDecodedDigestForTest(
  anchorType: string,
  decoded: Record<string, unknown>,
): string {
  return readDecodedDigest(anchorType, decoded);
}

function readDecodedDigest(anchorType: string, decoded: Record<string, unknown>): string {
  const direct =
    readDecodedField(decoded, "commitmentDigest") ||
    readDecodedField(decoded, "stateDigest") ||
    readDecodedField(decoded, "digest");
  const directHash = decodedBytes32Hex(direct);
  if (directHash) return `sha256:${directHash}`;
  if (typeof direct === "string" && direct.trim()) return direct;
  throw new Error(`hosted_app_chain_decoded_digest_missing:${anchorType}`);
}

function readDecodedStatus(anchorType: string, decoded: Record<string, unknown>): string {
  const status = decodedStatusName(readDecodedField(decoded, "status"));
  if (status) return status;
  const productionStatus = decodedStatusName(
    readDecodedField(decoded, "productionStatus"),
  );
  if (productionStatus) return productionStatus;
  const supportStatus = decodedStatusName(readDecodedField(decoded, "supportStatus"));
  if (supportStatus) return supportStatus;
  if (anchorType === "hosted_app_capability_deny") return "active";
  return "active";
}

function decodedStatusName(value: unknown): string {
  if (typeof value === "string") return value;
  if (value && typeof value === "object" && !Array.isArray(value)) {
    const keys = Object.keys(value as Record<string, unknown>);
    if (keys.length === 1) return keys[0];
  }
  return "";
}

function readDecodedField(
  decoded: Record<string, unknown>,
  field: string,
): unknown {
  if (Object.prototype.hasOwnProperty.call(decoded, field)) {
    return decoded[field];
  }
  const snake =
    DECODED_FIELD_ALIASES[field] ||
    field.replace(/[A-Z]/g, (match) => `_${match.toLowerCase()}`);
  if (Object.prototype.hasOwnProperty.call(decoded, snake)) {
    return decoded[snake];
  }
  return undefined;
}

function deriveHostedAppChainAccountPubkey(input: {
  anchorType: string;
  objectRef: string;
  programId: string;
  digest?: string | null;
}): string | null {
  const seeds = pdaSeedsForChainAnchor(
    input.anchorType,
    input.objectRef,
    input.digest,
  );
  if (!seeds) return null;
  return PublicKey.findProgramAddressSync(
    seeds,
    new PublicKey(input.programId),
  )[0].toBase58();
}

function pdaSeedsForChainAnchor(
  anchorType: string,
  objectRef: string,
  digest?: string | null,
): Buffer[] | null {
  const parts = String(objectRef || "").split(":");
  if (anchorType === "hosted_app_identity" && parts.length === 2) {
    return [
      Buffer.from(PDA_SEEDS.identity),
      bytes32Buffer("app", parts[1]),
    ];
  }
  if (anchorType === "hosted_app_release" && parts.length === 4) {
    return [
      Buffer.from(PDA_SEEDS.release),
      bytes32Buffer("app", parts[1]),
      bytes32Buffer("release", parts[3]),
    ];
  }
  if (anchorType === "hosted_app_release_channel" && parts.length === 4) {
    return [
      Buffer.from(PDA_SEEDS.channel),
      bytes32Buffer("app", parts[1]),
      bytes32Buffer("channel", parts[3]),
    ];
  }
  if (anchorType === "hosted_app_capability_deny" && parts.length === 4) {
    return [
      Buffer.from(PDA_SEEDS.deny),
      bytes32Buffer("app", parts[1]),
      bytes32Buffer("capability", parts[3]),
    ];
  }
  if (anchorType === "hosted_app_policy" && parts.length === 4) {
    if (!digest) return null;
    return [
      Buffer.from(PDA_SEEDS.policy),
      bytes32Buffer("object-ref", objectRef),
      bytes32Buffer("digest", digest),
    ];
  }
  if (anchorType === "hosted_app_circle_installation" && parts.length === 5) {
    return [
      Buffer.from(PDA_SEEDS.installation),
      bytes32Buffer("app", parts[1]),
      bytes32Buffer("circle", parts[3]),
    ];
  }
  if (anchorType === "hosted_app_credential_anchor") {
    if (!digest) return null;
    return [
      Buffer.from(PDA_SEEDS.credential),
      bytes32Buffer("object-ref", objectRef),
      bytes32Buffer("digest", digest),
    ];
  }
  if (anchorType === "hosted_app_governance_execution" && parts.length === 5) {
    return [
      Buffer.from(PDA_SEEDS.governanceExecution),
      bytes32Buffer("digest", parts[3]),
      bytes32Buffer("digest", parts[4]),
    ];
  }
  return null;
}

function bytes32Buffer(kind: string, value: string): Buffer {
  return Buffer.from(bytes32Hex(kind, value), "hex");
}

function bytes32Hex(kind: string, value: string): string {
  const normalized = String(value || "").trim();
  const sha256Match = normalized.match(/^sha256:([a-f0-9]{64})$/i);
  if (sha256Match) return sha256Match[1].toLowerCase();
  if (/^[a-f0-9]{64}$/i.test(normalized)) return normalized.toLowerCase();
  return crypto
    .createHash("sha256")
    .update(`${HASH_NAMESPACE}:${kind}:${normalized}`)
    .digest("hex");
}

function decodedBytes32Hex(value: unknown): string | null {
  if (Array.isArray(value)) {
    return bytesFromArrayLike(value);
  }
  if (ArrayBuffer.isView(value)) {
    const view = value as ArrayBufferView;
    return bytesFromArrayLike([
      ...new Uint8Array(view.buffer, view.byteOffset, view.byteLength),
    ]);
  }
  if (Buffer.isBuffer(value)) {
    return value.length === 32 ? value.toString("hex") : null;
  }
  if (typeof value === "string") {
    const normalized = value.trim();
    const sha256Match = normalized.match(/^sha256:([a-f0-9]{64})$/i);
    if (sha256Match) return sha256Match[1].toLowerCase();
    if (/^[a-f0-9]{64}$/i.test(normalized)) return normalized.toLowerCase();
  }
  return null;
}

function bytesFromArrayLike(value: unknown[]): string | null {
  if (value.length !== 32) return null;
  const bytes = value.map((item) => Number(item));
  if (bytes.some((item) => !Number.isInteger(item) || item < 0 || item > 255)) {
    return null;
  }
  return Buffer.from(bytes).toString("hex");
}

function toJcsCompatible(value: unknown): unknown {
  if (value === null || ["string", "number", "boolean"].includes(typeof value)) {
    return value;
  }
  if (typeof value === "bigint") return value.toString();
  if (Array.isArray(value) || ArrayBuffer.isView(value)) {
    return Array.from(value as ArrayLike<unknown>).map(toJcsCompatible);
  }
  if (value instanceof PublicKey) return value.toBase58();
  if (value && typeof value === "object") {
    if (typeof (value as { toBase58?: unknown }).toBase58 === "function") {
      return (value as { toBase58(): string }).toBase58();
    }
    if (typeof (value as { toString?: unknown }).toString === "function") {
      const ctor = (value as { constructor?: { name?: string } }).constructor?.name;
      if (ctor === "BN") return String(value);
    }
    return Object.fromEntries(
      Object.entries(value as Record<string, unknown>).map(([key, nested]) => [
        key,
        toJcsCompatible(nested),
      ]),
    );
  }
  return String(value);
}
