import { normalizeHash32Hex } from "./chainRegistryDigest";

export type ExternalAppEconomicsMode = "disabled" | "optional" | "required";

export interface ExternalAppEconomicsAdapterConfig {
  mode?: ExternalAppEconomicsMode;
  programId?: string;
  rpcUrl?: string;
  idlPath?: string;
  authorityKeypairPath?: string;
  authoritySignerUrl?: string;
  authoritySignerToken?: string;
  nodeEnv?: string;
  cluster?: string;
}

export interface OpenOwnerBondVaultPayload {
  externalAppId: string;
  appIdHash: string;
  ownerPubkey: string;
  mint: string;
}

export interface OpenChallengeCasePayload {
  externalAppId: string;
  appIdHash: string;
  caseId: string;
  evidenceHash: string;
  challengeType: number;
  mint: string;
  amountRaw: string;
}

export interface ExecuteBondSettlementPayload {
  externalAppId: string;
  appIdHash: string;
  caseId: string;
  receiptId: string;
  amountRaw: string;
  receiptDigest: string;
}

export interface ExternalAppEconomicsSubmitResult {
  txSignature: string;
  accountPda: string;
}

export interface ExternalAppEconomicsSubmitter {
  openOwnerBondVault(input: OpenOwnerBondVaultPayload): Promise<ExternalAppEconomicsSubmitResult>;
  openChallengeCase(input: OpenChallengeCasePayload): Promise<ExternalAppEconomicsSubmitResult>;
  executeBondSettlement(input: ExecuteBondSettlementPayload): Promise<ExternalAppEconomicsSubmitResult>;
}

export interface ExternalAppEconomicsEvidence {
  mode: ExternalAppEconomicsMode;
  status: "skipped" | "submitted";
  reason?: string;
  txSignature?: string;
  accountPda?: string;
  cluster?: string;
}

export function loadExternalAppEconomicsConfigFromEnv(
  env: NodeJS.ProcessEnv = process.env,
): ExternalAppEconomicsAdapterConfig {
  return {
    mode: parseExternalAppEconomicsMode(env.EXTERNAL_APP_ECONOMICS_MODE),
    programId:
      env.EXTERNAL_APP_ECONOMICS_PROGRAM_ID ||
      env.NEXT_PUBLIC_EXTERNAL_APP_ECONOMICS_PROGRAM_ID,
    rpcUrl: env.SOLANA_RPC_URL || env.RPC_URL || env.NEXT_PUBLIC_SOLANA_RPC_URL,
    idlPath: env.EXTERNAL_APP_ECONOMICS_IDL_PATH,
    authorityKeypairPath: env.EXTERNAL_APP_ECONOMICS_AUTHORITY_KEYPAIR_PATH,
    authoritySignerUrl: env.EXTERNAL_APP_ECONOMICS_AUTHORITY_SIGNER_URL,
    authoritySignerToken: env.EXTERNAL_APP_ECONOMICS_AUTHORITY_SIGNER_TOKEN,
    nodeEnv: env.NODE_ENV,
    cluster: env.SOLANA_CLUSTER || env.CLUSTER,
  };
}

export function parseExternalAppEconomicsMode(
  raw: string | undefined,
): ExternalAppEconomicsMode {
  if (raw === "optional" || raw === "required") return raw;
  return "disabled";
}

export function createExternalAppEconomicsAdapter(
  config: ExternalAppEconomicsAdapterConfig = loadExternalAppEconomicsConfigFromEnv(),
  deps: { submitter?: ExternalAppEconomicsSubmitter } = {},
) {
  const normalizedConfig = {
    ...config,
    mode: config.mode ?? "disabled",
  };

  async function submit<TInput>(
    input: TInput,
    submitWithInjected: (submitter: ExternalAppEconomicsSubmitter) => Promise<ExternalAppEconomicsSubmitResult>,
  ): Promise<ExternalAppEconomicsEvidence> {
    if (normalizedConfig.mode === "disabled") {
      return skipped("external_app_economics_mode_disabled", normalizedConfig);
    }
    const configError = validateConfig(normalizedConfig, Boolean(deps.submitter));
    if (configError) {
      if (normalizedConfig.mode === "optional") {
        return skipped(configError, normalizedConfig);
      }
      throw new Error(configError);
    }
    try {
      if (!deps.submitter) {
        throw new Error("external_app_economics_local_submitter_not_configured");
      }
      const result = await submitWithInjected(deps.submitter);
      return {
        mode: normalizedConfig.mode,
        status: "submitted",
        txSignature: result.txSignature,
        accountPda: result.accountPda,
        cluster: normalizedConfig.cluster,
      };
    } catch (error) {
      const reason = (error as Error).message || "external_app_economics_submit_failed";
      if (normalizedConfig.mode === "optional") {
        return skipped(reason, normalizedConfig);
      }
      throw error;
    }
  }

  return {
    openOwnerBondVault(input: OpenOwnerBondVaultPayload) {
      validateOwnerBondPayload(input);
      return submit(input, (submitter) => submitter.openOwnerBondVault(input));
    },
    openChallengeCase(input: OpenChallengeCasePayload) {
      validateChallengePayload(input);
      return submit(input, (submitter) => submitter.openChallengeCase(input));
    },
    executeBondSettlement(input: ExecuteBondSettlementPayload) {
      validateSettlementPayload(input);
      return submit(input, (submitter) => submitter.executeBondSettlement(input));
    },
  };
}

function validateConfig(
  config: Required<Pick<ExternalAppEconomicsAdapterConfig, "mode">> &
    ExternalAppEconomicsAdapterConfig,
  hasInjectedSubmitter: boolean,
): string | null {
  if (!config.programId) return "external_app_economics_program_id_required";
  if (!config.rpcUrl) return "external_app_economics_rpc_url_required";
  if (!hasInjectedSubmitter && !config.authorityKeypairPath && !config.authoritySignerUrl) {
    return "external_app_economics_authority_required";
  }
  if (
    config.mode === "required" &&
    config.nodeEnv === "production" &&
    config.authorityKeypairPath &&
    !config.authoritySignerUrl
  ) {
    return "external_app_economics_local_keypair_not_allowed_in_production_required_mode";
  }
  return null;
}

function skipped(
  reason: string,
  config: Required<Pick<ExternalAppEconomicsAdapterConfig, "mode">> &
    ExternalAppEconomicsAdapterConfig,
): ExternalAppEconomicsEvidence {
  return {
    mode: config.mode,
    status: "skipped",
    reason,
    cluster: config.cluster,
  };
}

function validateOwnerBondPayload(input: OpenOwnerBondVaultPayload): void {
  normalizeHash32Hex(input.appIdHash, "external_app_economics_app_id_hash");
  requireNonEmpty(input.externalAppId, "external_app_economics_external_app_id_required");
  requireNonEmpty(input.ownerPubkey, "external_app_economics_owner_pubkey_required");
  requireNonEmpty(input.mint, "external_app_economics_mint_required");
}

function validateChallengePayload(input: OpenChallengeCasePayload): void {
  normalizeHash32Hex(input.appIdHash, "external_app_economics_app_id_hash");
  normalizeHash32Hex(input.caseId, "external_app_economics_case_id");
  normalizeHash32Hex(input.evidenceHash, "external_app_economics_evidence_hash");
  normalizePositiveRawAmount(input.amountRaw);
  if (!Number.isInteger(input.challengeType) || input.challengeType < 0 || input.challengeType > 255) {
    throw new Error("invalid_external_app_economics_challenge_type");
  }
  requireNonEmpty(input.mint, "external_app_economics_mint_required");
}

function validateSettlementPayload(input: ExecuteBondSettlementPayload): void {
  normalizeHash32Hex(input.appIdHash, "external_app_economics_app_id_hash");
  normalizeHash32Hex(input.caseId, "external_app_economics_case_id");
  normalizeHash32Hex(input.receiptId, "external_app_economics_receipt_id");
  normalizeHash32Hex(input.receiptDigest, "external_app_economics_receipt_digest");
  normalizePositiveRawAmount(input.amountRaw);
}

function normalizePositiveRawAmount(value: string): string {
  const normalized = String(value || "").trim();
  if (!/^[0-9]+$/.test(normalized) || BigInt(normalized) <= 0n) {
    throw new Error("invalid_external_app_economics_amount_raw");
  }
  return normalized;
}

function requireNonEmpty(value: unknown, errorCode: string): void {
  if (String(value || "").trim().length === 0) {
    throw new Error(errorCode);
  }
}
