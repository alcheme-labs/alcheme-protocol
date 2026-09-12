import { createHash } from "node:crypto";

import { Connection, PublicKey } from "@solana/web3.js";

import { appIdHash } from "./chainRegistryDigest";
import type { ExternalAppRiskDisclaimerScope } from "./riskDisclaimer";

export type RiskDisclaimerReceiptVerificationMode = "disabled" | "optional" | "required";

export interface RiskDisclaimerReceiptVerificationConfig {
  mode?: RiskDisclaimerReceiptVerificationMode;
  programId?: string;
  rpcUrl?: string;
  nodeEnv?: string;
}

export interface RiskDisclaimerReceiptVerificationInput {
  externalAppId: string;
  actorPubkey: string;
  scope: ExternalAppRiskDisclaimerScope;
  termsDigest: string;
  acceptanceDigest: string;
  chainReceiptPda: string;
  chainReceiptDigest: string;
  txSignature: string;
}

export interface RiskDisclaimerReceiptVerifier {
  verifyRiskDisclaimerReceipt(input: RiskDisclaimerReceiptVerificationInput): Promise<void>;
}

export interface DecodedRiskDisclaimerReceipt {
  bump: number;
  version: number;
  appIdHash: string;
  actorPubkey: string;
  scope: number;
  termsDigest: string;
  acceptanceDigest: string;
  policyEpochDigest: string;
  createdAt: bigint;
}

const RISK_DISCLAIMER_RECEIPT_SEED = "external_app_v3_risk_receipt";
const RISK_DISCLAIMER_RECEIPT_ACCOUNT_NAME = "ExternalAppRiskDisclaimerReceipt";
const RISK_DISCLAIMER_RECEIPT_DATA_LEN = 180;
const RISK_SCOPE_BYTES: Record<ExternalAppRiskDisclaimerScope, number> = {
  external_app_entry: 0,
  challenge_bond: 1,
  bond_disposition: 2,
  developer_registration: 3,
};

export function createRiskDisclaimerReceiptVerifierFromEnv(
  env: NodeJS.ProcessEnv = process.env,
): RiskDisclaimerReceiptVerifier {
  return createRiskDisclaimerReceiptVerifier({
    mode: parseRiskDisclaimerReceiptVerificationMode(
      env.EXTERNAL_APP_RISK_RECEIPT_VERIFICATION_MODE,
      env.NODE_ENV,
    ),
    programId:
      env.EXTERNAL_APP_ECONOMICS_PROGRAM_ID ||
      env.NEXT_PUBLIC_EXTERNAL_APP_ECONOMICS_PROGRAM_ID,
    rpcUrl: env.SOLANA_RPC_URL || env.RPC_URL || env.NEXT_PUBLIC_SOLANA_RPC_URL,
    nodeEnv: env.NODE_ENV,
  });
}

export function createRiskDisclaimerReceiptVerifier(
  config: RiskDisclaimerReceiptVerificationConfig,
  deps: { connection?: Connection } = {},
): RiskDisclaimerReceiptVerifier {
  const mode =
    config.mode ??
    parseRiskDisclaimerReceiptVerificationMode(undefined, config.nodeEnv);

  return {
    async verifyRiskDisclaimerReceipt(input) {
      if (mode === "disabled") return;
      if (!config.programId || !config.rpcUrl) {
        if (mode === "optional") return;
        throw new Error("external_app_risk_receipt_verification_config_required");
      }

      const programId = toPublicKey(config.programId, "program_id");
      const actor = toPublicKey(input.actorPubkey, "actor_pubkey");
      const expectedAppIdHash = appIdHash(input.externalAppId);
      const expectedScope = riskScopeByte(input.scope);
      const expectedPda = deriveRiskDisclaimerReceiptPda({
        programId,
        appIdHashHex: expectedAppIdHash,
        actor,
        scope: input.scope,
      });
      if (input.chainReceiptPda.trim() !== expectedPda.toBase58()) {
        throw new Error("external_app_risk_receipt_pda_mismatch");
      }

      const connection = deps.connection ?? new Connection(config.rpcUrl, "confirmed");
      const account = await connection.getAccountInfo(expectedPda, "confirmed");
      if (!account) {
        throw new Error("external_app_risk_receipt_not_found");
      }
      if (!account.owner || !account.owner.equals(programId)) {
        throw new Error("external_app_risk_receipt_owner_mismatch");
      }

      const decoded = decodeRiskDisclaimerReceiptAccount(account.data);
      const expectedTermsDigest = normalizeHash32(input.termsDigest, "terms_digest");
      const expectedAcceptanceDigest = normalizeHash32(
        input.acceptanceDigest,
        "acceptance_digest",
      );
      if (
        decoded.appIdHash !== expectedAppIdHash ||
        decoded.actorPubkey !== actor.toBase58() ||
        decoded.scope !== expectedScope ||
        decoded.termsDigest !== expectedTermsDigest ||
        decoded.acceptanceDigest !== expectedAcceptanceDigest
      ) {
        throw new Error("external_app_risk_receipt_account_mismatch");
      }

      const accountDigest = computeRiskDisclaimerReceiptDataDigest(account.data);
      if (normalizeHash32(input.chainReceiptDigest, "chain_receipt_digest") !== accountDigest) {
        throw new Error("external_app_risk_receipt_digest_mismatch");
      }

      const txSignature = input.txSignature.trim();
      if (!txSignature) throw new Error("external_app_risk_receipt_tx_required");
      const status = await connection.getSignatureStatuses([txSignature], {
        searchTransactionHistory: true,
      });
      const txStatus = status.value[0];
      if (!txStatus) {
        throw new Error("external_app_risk_receipt_tx_not_found");
      }
      if (txStatus.err) {
        throw new Error("external_app_risk_receipt_tx_failed");
      }
      if (
        txStatus.confirmationStatus &&
        txStatus.confirmationStatus !== "confirmed" &&
        txStatus.confirmationStatus !== "finalized"
      ) {
        throw new Error("external_app_risk_receipt_tx_not_confirmed");
      }
    },
  };
}

export function deriveRiskDisclaimerReceiptPda(input: {
  programId: PublicKey | string;
  appIdHashHex: string;
  actor: PublicKey | string;
  scope: ExternalAppRiskDisclaimerScope;
}): PublicKey {
  return PublicKey.findProgramAddressSync(
    [
      Buffer.from(RISK_DISCLAIMER_RECEIPT_SEED),
      Buffer.from(normalizeHash32(input.appIdHashHex, "app_id_hash"), "hex"),
      toPublicKey(input.actor, "actor").toBuffer(),
      Buffer.from([riskScopeByte(input.scope)]),
    ],
    toPublicKey(input.programId, "program_id"),
  )[0];
}

export function decodeRiskDisclaimerReceiptAccount(
  data: Buffer | Uint8Array,
): DecodedRiskDisclaimerReceipt {
  const buffer = Buffer.from(data);
  if (buffer.length < RISK_DISCLAIMER_RECEIPT_DATA_LEN) {
    throw new Error("external_app_risk_receipt_account_too_short");
  }
  const expectedDiscriminator = anchorAccountDiscriminator(
    RISK_DISCLAIMER_RECEIPT_ACCOUNT_NAME,
  );
  if (!buffer.subarray(0, 8).equals(expectedDiscriminator)) {
    throw new Error("external_app_risk_receipt_account_discriminator_mismatch");
  }
  return {
    bump: buffer.readUInt8(8),
    version: buffer.readUInt16LE(9),
    appIdHash: buffer.subarray(11, 43).toString("hex"),
    actorPubkey: new PublicKey(buffer.subarray(43, 75)).toBase58(),
    scope: buffer.readUInt8(75),
    termsDigest: buffer.subarray(76, 108).toString("hex"),
    acceptanceDigest: buffer.subarray(108, 140).toString("hex"),
    policyEpochDigest: buffer.subarray(140, 172).toString("hex"),
    createdAt: buffer.readBigInt64LE(172),
  };
}

export function computeRiskDisclaimerReceiptDataDigest(data: Buffer | Uint8Array): string {
  return createHash("sha256").update(Buffer.from(data)).digest("hex");
}

export function anchorAccountDiscriminator(accountName: string): Buffer {
  return createHash("sha256")
    .update(`account:${accountName}`)
    .digest()
    .subarray(0, 8);
}

export function parseRiskDisclaimerReceiptVerificationMode(
  raw: string | undefined,
  nodeEnv = process.env.NODE_ENV,
): RiskDisclaimerReceiptVerificationMode {
  if (raw === "disabled" || raw === "optional" || raw === "required") return raw;
  return nodeEnv === "production" ? "required" : "disabled";
}

function riskScopeByte(scope: ExternalAppRiskDisclaimerScope): number {
  const scopeByte = RISK_SCOPE_BYTES[scope];
  if (scopeByte === undefined) {
    throw new Error("external_app_risk_receipt_scope_invalid");
  }
  return scopeByte;
}

function normalizeHash32(value: unknown, label: string): string {
  const normalized = String(value || "").trim().toLowerCase();
  const withoutPrefix = normalized.startsWith("sha256:")
    ? normalized.slice("sha256:".length)
    : normalized;
  if (!/^[0-9a-f]{64}$/.test(withoutPrefix)) {
    throw new Error(`invalid_external_app_risk_receipt_${label}`);
  }
  return withoutPrefix;
}

function toPublicKey(value: PublicKey | string, label: string): PublicKey {
  try {
    return value instanceof PublicKey ? value : new PublicKey(value);
  } catch {
    throw new Error(`invalid_external_app_risk_receipt_${label}`);
  }
}
