import {
  PublicKey,
  SystemProgram,
  TransactionInstruction,
} from "@solana/web3.js";
import { sha256 } from "js-sha256";
import * as externalAppEconomicsIdl from "../idl/external_app_economics.json";

export { externalAppEconomicsIdl };

export const LEGACY_SPL_TOKEN_PROGRAM_ID = new PublicKey(
  "TokenkegQfeZyiNwAJbNbGKPFXCWuBvf9Ss623VQ5DA",
);

export type ExternalAppEconomicsAssetStatus =
  | "disabled"
  | "test_only"
  | "active"
  | "paused"
  | "retired";

export interface ExternalAppEconomicsProgramInput {
  programId: PublicKey | string;
}

export interface GovernanceAuthorityInput extends ExternalAppEconomicsProgramInput {
  governanceAuthority: PublicKey | string;
}

export interface InitializeEconomicsConfigInstructionInput
  extends ExternalAppEconomicsProgramInput {
  admin: PublicKey | string;
  governanceAuthority: PublicKey | string;
  policyEpochDigest: Uint8Array | number[] | string;
  withdrawalLockSeconds: number;
  systemProgram?: PublicKey | string;
}

export interface SetPolicyEpochInstructionInput extends GovernanceAuthorityInput {
  policyEpochDigest: Uint8Array | number[] | string;
}

export interface SetAssetAllowlistInstructionInput extends GovernanceAuthorityInput {
  assetMint: PublicKey | string;
  status: ExternalAppEconomicsAssetStatus;
  tokenProgram?: PublicKey | string;
}

export interface PauseNewEconomicExposureInstructionInput extends GovernanceAuthorityInput {
  paused: boolean;
}

export interface OwnerBondVaultInstructionInput extends ExternalAppEconomicsProgramInput {
  appIdHash: Uint8Array | number[] | string;
  assetMint: PublicKey | string;
  owner: PublicKey | string;
  vaultTokenAccount: PublicKey | string;
  systemProgram?: PublicKey | string;
}

export interface OwnerBondTransferInstructionInput extends OwnerBondVaultInstructionInput {
  amount: bigint | number | string;
  ownerTokenAccount: PublicKey | string;
  tokenProgram?: PublicKey | string;
}

export interface RequestOwnerBondWithdrawalInstructionInput
  extends ExternalAppEconomicsProgramInput {
  appIdHash: Uint8Array | number[] | string;
  assetMint: PublicKey | string;
  owner: PublicKey | string;
}

export interface OpenChallengeCaseInstructionInput extends ExternalAppEconomicsProgramInput {
  appIdHash: Uint8Array | number[] | string;
  caseId: Uint8Array | number[] | string;
  evidenceHash: Uint8Array | number[] | string;
  challengeType: number;
  challenger: PublicKey | string;
  assetMint: PublicKey | string;
  caseVaultTokenAccount: PublicKey | string;
  systemProgram?: PublicKey | string;
}

export interface ChallengeBondTransferInstructionInput extends ExternalAppEconomicsProgramInput {
  appIdHash: Uint8Array | number[] | string;
  caseId: Uint8Array | number[] | string;
  amount: bigint | number | string;
  challenger: PublicKey | string;
  assetMint: PublicKey | string;
  challengerTokenAccount: PublicKey | string;
  caseVaultTokenAccount: PublicKey | string;
  tokenProgram?: PublicKey | string;
}

export interface GovernanceChallengeInstructionInput extends GovernanceAuthorityInput {
  appIdHash: Uint8Array | number[] | string;
  caseId: Uint8Array | number[] | string;
}

export interface RecordChallengeResponseInstructionInput
  extends GovernanceChallengeInstructionInput {
  responseDigest: Uint8Array | number[] | string;
}

export interface RecordAppealWindowInstructionInput
  extends GovernanceChallengeInstructionInput {
  appealWindowEndsAt: bigint | number | string;
}

export interface ChallengeRulingInstructionInput extends GovernanceChallengeInstructionInput {
  rulingDigest: Uint8Array | number[] | string;
}

export interface ExecuteBondSettlementInstructionInput
  extends GovernanceChallengeInstructionInput {
  receiptId: Uint8Array | number[] | string;
  amount: bigint | number | string;
  receiptDigest: Uint8Array | number[] | string;
  caseVaultTokenAccount: PublicKey | string;
  settlementDestinationTokenAccount: PublicKey | string;
  tokenProgram?: PublicKey | string;
  systemProgram?: PublicKey | string;
}

export type ExternalAppRiskDisclaimerScope =
  | "external_app_entry"
  | "challenge_bond"
  | "bond_disposition"
  | "developer_registration";

export interface BondDispositionPolicyInstructionInput extends GovernanceAuthorityInput {
  policyId: Uint8Array | number[] | string;
  policyDigest: Uint8Array | number[] | string;
  maxCaseAmount: bigint | number | string;
  paused: boolean;
  systemProgram?: PublicKey | string;
}

export interface RecordRiskDisclaimerAcceptanceInstructionInput
  extends ExternalAppEconomicsProgramInput {
  appIdHash: Uint8Array | number[] | string;
  actor: PublicKey | string;
  scope: ExternalAppRiskDisclaimerScope;
  termsDigest: Uint8Array | number[] | string;
  acceptanceDigest: Uint8Array | number[] | string;
  systemProgram?: PublicKey | string;
}

export interface OpenBondDispositionCaseInstructionInput
  extends ExternalAppEconomicsProgramInput {
  appIdHash: Uint8Array | number[] | string;
  caseId: Uint8Array | number[] | string;
  policyId: Uint8Array | number[] | string;
  evidenceHash: Uint8Array | number[] | string;
  requestedAmount: bigint | number | string;
  initiator: PublicKey | string;
  assetMint: PublicKey | string;
  vaultTokenAccount: PublicKey | string;
  systemProgram?: PublicKey | string;
}

export interface GovernanceBondDispositionInstructionInput extends GovernanceAuthorityInput {
  appIdHash: Uint8Array | number[] | string;
  caseId: Uint8Array | number[] | string;
  assetMint: PublicKey | string;
}

export interface RecordBondDispositionEvidenceInstructionInput
  extends GovernanceBondDispositionInstructionInput {
  evidenceHash: Uint8Array | number[] | string;
  rulingDigest: Uint8Array | number[] | string;
}

export interface LockBondForCaseInstructionInput
  extends GovernanceBondDispositionInstructionInput {
  policyId: Uint8Array | number[] | string;
  amount: bigint | number | string;
  systemProgram?: PublicKey | string;
}

export interface RouteForfeitedBondByPolicyInstructionInput
  extends GovernanceBondDispositionInstructionInput {
  receiptId: Uint8Array | number[] | string;
  amount: bigint | number | string;
  routingDigest: Uint8Array | number[] | string;
  vaultTokenAccount: PublicKey | string;
  routeDestinationTokenAccount: PublicKey | string;
  tokenProgram?: PublicKey | string;
  systemProgram?: PublicKey | string;
}

export interface UpdateBondExposureStateInstructionInput
  extends GovernanceAuthorityInput {
  appIdHash: Uint8Array | number[] | string;
  assetMint: PublicKey | string;
  exposureDigest: Uint8Array | number[] | string;
  systemProgram?: PublicKey | string;
}

export interface PauseNewBondExposureInstructionInput extends GovernanceAuthorityInput {
  appIdHash: Uint8Array | number[] | string;
  assetMint: PublicKey | string;
  paused: boolean;
}

export function deriveExternalAppEconomicsConfigPda(
  programId: PublicKey | string,
): PublicKey {
  return PublicKey.findProgramAddressSync(
    [Buffer.from("external_app_economics")],
    asPublicKey(programId),
  )[0];
}

export function deriveExternalAppOwnerBondVaultPda(
  programId: PublicKey | string,
  appIdHash: Uint8Array | number[] | string,
  assetMint: PublicKey | string,
): PublicKey {
  return PublicKey.findProgramAddressSync(
    [
      Buffer.from("external_app_v3_owner_bond_vault"),
      Buffer.from(hash32ToBytes(appIdHash, "appIdHash")),
      asPublicKey(assetMint).toBuffer(),
    ],
    asPublicKey(programId),
  )[0];
}

export function deriveExternalAppChallengeCasePda(
  programId: PublicKey | string,
  appIdHash: Uint8Array | number[] | string,
  caseId: Uint8Array | number[] | string,
): PublicKey {
  return PublicKey.findProgramAddressSync(
    [
      Buffer.from("external_app_v3_challenge_case"),
      Buffer.from(hash32ToBytes(appIdHash, "appIdHash")),
      Buffer.from(hash32ToBytes(caseId, "caseId")),
    ],
    asPublicKey(programId),
  )[0];
}

export function deriveExternalAppSettlementReceiptPda(
  programId: PublicKey | string,
  appIdHash: Uint8Array | number[] | string,
  caseId: Uint8Array | number[] | string,
  receiptId: Uint8Array | number[] | string,
): PublicKey {
  return PublicKey.findProgramAddressSync(
    [
      Buffer.from("external_app_v3_settle_receipt"),
      Buffer.from(hash32ToBytes(appIdHash, "appIdHash")),
      Buffer.from(hash32ToBytes(caseId, "caseId")),
      Buffer.from(hash32ToBytes(receiptId, "receiptId")),
    ],
    asPublicKey(programId),
  )[0];
}

export function deriveExternalAppBondDispositionPolicyPda(
  programId: PublicKey | string,
  policyId: Uint8Array | number[] | string,
): PublicKey {
  return PublicKey.findProgramAddressSync(
    [
      Buffer.from("external_app_v3_bond_policy"),
      Buffer.from(hash32ToBytes(policyId, "policyId")),
    ],
    asPublicKey(programId),
  )[0];
}

export function deriveExternalAppRiskDisclaimerReceiptPda(
  programId: PublicKey | string,
  appIdHash: Uint8Array | number[] | string,
  actor: PublicKey | string,
  scope: ExternalAppRiskDisclaimerScope,
): PublicKey {
  return PublicKey.findProgramAddressSync(
    [
      Buffer.from("external_app_v3_risk_receipt"),
      Buffer.from(hash32ToBytes(appIdHash, "appIdHash")),
      asPublicKey(actor).toBuffer(),
      Buffer.from([riskScopeByte(scope)]),
    ],
    asPublicKey(programId),
  )[0];
}

export function deriveExternalAppBondDispositionCasePda(
  programId: PublicKey | string,
  appIdHash: Uint8Array | number[] | string,
  caseId: Uint8Array | number[] | string,
): PublicKey {
  return PublicKey.findProgramAddressSync(
    [
      Buffer.from("external_app_v3_bond_case"),
      Buffer.from(hash32ToBytes(appIdHash, "appIdHash")),
      Buffer.from(hash32ToBytes(caseId, "caseId")),
    ],
    asPublicKey(programId),
  )[0];
}

export function deriveExternalAppBondRoutingReceiptPda(
  programId: PublicKey | string,
  appIdHash: Uint8Array | number[] | string,
  caseId: Uint8Array | number[] | string,
  receiptId: Uint8Array | number[] | string,
): PublicKey {
  return PublicKey.findProgramAddressSync(
    [
      Buffer.from("external_app_v3_bond_route"),
      Buffer.from(hash32ToBytes(appIdHash, "appIdHash")),
      Buffer.from(hash32ToBytes(caseId, "caseId")),
      Buffer.from(hash32ToBytes(receiptId, "receiptId")),
    ],
    asPublicKey(programId),
  )[0];
}

export function deriveExternalAppBondExposureStatePda(
  programId: PublicKey | string,
  appIdHash: Uint8Array | number[] | string,
  assetMint: PublicKey | string,
): PublicKey {
  return PublicKey.findProgramAddressSync(
    [
      Buffer.from("external_app_v3_bond_exposure"),
      Buffer.from(hash32ToBytes(appIdHash, "appIdHash")),
      asPublicKey(assetMint).toBuffer(),
    ],
    asPublicKey(programId),
  )[0];
}

export function buildInitializeEconomicsConfigInstruction(
  input: InitializeEconomicsConfigInstructionInput,
): TransactionInstruction {
  const programId = asPublicKey(input.programId);
  return new TransactionInstruction({
    programId,
    keys: [
      writable(deriveExternalAppEconomicsConfigPda(programId)),
      signerWritable(asPublicKey(input.admin)),
      readonly(input.systemProgram ? asPublicKey(input.systemProgram) : SystemProgram.programId),
    ],
    data: concatData(
      "initialize_economics_config",
      asPublicKey(input.governanceAuthority).toBuffer(),
      Buffer.from(hash32ToBytes(input.policyEpochDigest, "policyEpochDigest")),
      u32Le(input.withdrawalLockSeconds, "withdrawalLockSeconds"),
    ),
  });
}

export function buildSetPolicyEpochInstruction(
  input: SetPolicyEpochInstructionInput,
): TransactionInstruction {
  const programId = asPublicKey(input.programId);
  return new TransactionInstruction({
    programId,
    keys: governanceConfigKeys(programId, input.governanceAuthority),
    data: concatData(
      "set_policy_epoch",
      Buffer.from(hash32ToBytes(input.policyEpochDigest, "policyEpochDigest")),
    ),
  });
}

export function buildSetAssetAllowlistInstruction(
  input: SetAssetAllowlistInstructionInput,
): TransactionInstruction {
  const programId = asPublicKey(input.programId);
  return new TransactionInstruction({
    programId,
    keys: [
      writable(deriveExternalAppEconomicsConfigPda(programId)),
      signerReadonly(asPublicKey(input.governanceAuthority)),
      readonly(asPublicKey(input.assetMint)),
      readonly(input.tokenProgram ? asPublicKey(input.tokenProgram) : LEGACY_SPL_TOKEN_PROGRAM_ID),
    ],
    data: concatData("set_asset_allowlist", Buffer.from([assetStatusByte(input.status)])),
  });
}

export function buildPauseNewEconomicExposureInstruction(
  input: PauseNewEconomicExposureInstructionInput,
): TransactionInstruction {
  const programId = asPublicKey(input.programId);
  return new TransactionInstruction({
    programId,
    keys: governanceConfigKeys(programId, input.governanceAuthority),
    data: concatData("pause_new_economic_exposure", Buffer.from([input.paused ? 1 : 0])),
  });
}

export function buildOpenOwnerBondVaultInstruction(
  input: OwnerBondVaultInstructionInput,
): TransactionInstruction {
  const programId = asPublicKey(input.programId);
  const appIdHash = hash32ToBytes(input.appIdHash, "appIdHash");
  const assetMint = asPublicKey(input.assetMint);
  return new TransactionInstruction({
    programId,
    keys: [
      readonly(deriveExternalAppEconomicsConfigPda(programId)),
      writable(deriveExternalAppOwnerBondVaultPda(programId, appIdHash, assetMint)),
      signerWritable(asPublicKey(input.owner)),
      readonly(assetMint),
      readonly(asPublicKey(input.vaultTokenAccount)),
      readonly(input.systemProgram ? asPublicKey(input.systemProgram) : SystemProgram.programId),
    ],
    data: concatData("open_owner_bond_vault", Buffer.from(appIdHash)),
  });
}

export function buildDepositOwnerBondInstruction(
  input: OwnerBondTransferInstructionInput,
): TransactionInstruction {
  return ownerBondTransferInstruction("deposit_owner_bond", input);
}

export function buildRequestOwnerBondWithdrawalInstruction(
  input: RequestOwnerBondWithdrawalInstructionInput,
): TransactionInstruction {
  const programId = asPublicKey(input.programId);
  const appIdHash = hash32ToBytes(input.appIdHash, "appIdHash");
  return new TransactionInstruction({
    programId,
    keys: [
      writable(deriveExternalAppOwnerBondVaultPda(programId, appIdHash, input.assetMint)),
      signerReadonly(asPublicKey(input.owner)),
    ],
    data: concatData("request_owner_bond_withdrawal", Buffer.from(appIdHash)),
  });
}

export function buildExecuteUnlockedOwnerBondWithdrawalInstruction(
  input: OwnerBondTransferInstructionInput,
): TransactionInstruction {
  const programId = asPublicKey(input.programId);
  const appIdHash = hash32ToBytes(input.appIdHash, "appIdHash");
  const assetMint = asPublicKey(input.assetMint);
  return new TransactionInstruction({
    programId,
    keys: [
      readonly(deriveExternalAppEconomicsConfigPda(programId)),
      writable(deriveExternalAppOwnerBondVaultPda(programId, appIdHash, assetMint)),
      writable(deriveExternalAppBondExposureStatePda(programId, appIdHash, assetMint)),
      signerWritable(asPublicKey(input.owner)),
      readonly(assetMint),
      writable(asPublicKey(input.ownerTokenAccount)),
      writable(asPublicKey(input.vaultTokenAccount)),
      readonly(input.tokenProgram ? asPublicKey(input.tokenProgram) : LEGACY_SPL_TOKEN_PROGRAM_ID),
      readonly(input.systemProgram ? asPublicKey(input.systemProgram) : SystemProgram.programId),
    ],
    data: concatData(
      "execute_unlocked_owner_bond_withdrawal",
      Buffer.from(appIdHash),
      u64Le(input.amount),
    ),
  });
}

export function buildOpenChallengeCaseInstruction(
  input: OpenChallengeCaseInstructionInput,
): TransactionInstruction {
  const programId = asPublicKey(input.programId);
  const appIdHash = hash32ToBytes(input.appIdHash, "appIdHash");
  const caseId = hash32ToBytes(input.caseId, "caseId");
  if (!Number.isInteger(input.challengeType) || input.challengeType < 0 || input.challengeType > 255) {
    throw new Error("invalid_external_app_economics_challengeType");
  }
  return new TransactionInstruction({
    programId,
    keys: [
      readonly(deriveExternalAppEconomicsConfigPda(programId)),
      writable(deriveExternalAppChallengeCasePda(programId, appIdHash, caseId)),
      signerWritable(asPublicKey(input.challenger)),
      readonly(asPublicKey(input.assetMint)),
      readonly(asPublicKey(input.caseVaultTokenAccount)),
      readonly(input.systemProgram ? asPublicKey(input.systemProgram) : SystemProgram.programId),
    ],
    data: concatData(
      "open_challenge_case",
      Buffer.from(appIdHash),
      Buffer.from(caseId),
      Buffer.from(hash32ToBytes(input.evidenceHash, "evidenceHash")),
      Buffer.from([input.challengeType]),
    ),
  });
}

export function buildDepositChallengeBondInstruction(
  input: ChallengeBondTransferInstructionInput,
): TransactionInstruction {
  const programId = asPublicKey(input.programId);
  const appIdHash = hash32ToBytes(input.appIdHash, "appIdHash");
  const caseId = hash32ToBytes(input.caseId, "caseId");
  return new TransactionInstruction({
    programId,
    keys: [
      readonly(deriveExternalAppEconomicsConfigPda(programId)),
      writable(deriveExternalAppChallengeCasePda(programId, appIdHash, caseId)),
      signerWritable(asPublicKey(input.challenger)),
      readonly(asPublicKey(input.assetMint)),
      writable(asPublicKey(input.challengerTokenAccount)),
      writable(asPublicKey(input.caseVaultTokenAccount)),
      readonly(input.tokenProgram ? asPublicKey(input.tokenProgram) : LEGACY_SPL_TOKEN_PROGRAM_ID),
    ],
    data: concatData(
      "deposit_challenge_bond",
      Buffer.from(appIdHash),
      Buffer.from(caseId),
      u64Le(input.amount),
    ),
  });
}

export function buildRecordChallengeResponseInstruction(
  input: RecordChallengeResponseInstructionInput,
): TransactionInstruction {
  return governanceChallengeInstruction(
    "record_challenge_response",
    input,
    Buffer.from(hash32ToBytes(input.responseDigest, "responseDigest")),
  );
}

export function buildRecordAppealWindowInstruction(
  input: RecordAppealWindowInstructionInput,
): TransactionInstruction {
  return governanceChallengeInstruction(
    "record_appeal_window",
    input,
    i64Le(input.appealWindowEndsAt),
  );
}

export function buildSettleMachineVerifiableCaseInstruction(
  input: ChallengeRulingInstructionInput,
): TransactionInstruction {
  return governanceChallengeInstruction(
    "settle_machine_verifiable_case",
    input,
    Buffer.from(hash32ToBytes(input.rulingDigest, "rulingDigest")),
  );
}

export function buildAnchorGovernanceRulingInstruction(
  input: ChallengeRulingInstructionInput,
): TransactionInstruction {
  return governanceChallengeInstruction(
    "anchor_governance_ruling",
    input,
    Buffer.from(hash32ToBytes(input.rulingDigest, "rulingDigest")),
  );
}

export function buildExecuteBondSettlementInstruction(
  input: ExecuteBondSettlementInstructionInput,
): TransactionInstruction {
  const programId = asPublicKey(input.programId);
  const appIdHash = hash32ToBytes(input.appIdHash, "appIdHash");
  const caseId = hash32ToBytes(input.caseId, "caseId");
  const receiptId = hash32ToBytes(input.receiptId, "receiptId");
  return new TransactionInstruction({
    programId,
    keys: [
      readonly(deriveExternalAppEconomicsConfigPda(programId)),
      writable(deriveExternalAppChallengeCasePda(programId, appIdHash, caseId)),
      writable(deriveExternalAppSettlementReceiptPda(programId, appIdHash, caseId, receiptId)),
      signerWritable(asPublicKey(input.governanceAuthority)),
      writable(asPublicKey(input.caseVaultTokenAccount)),
      writable(asPublicKey(input.settlementDestinationTokenAccount)),
      readonly(input.tokenProgram ? asPublicKey(input.tokenProgram) : LEGACY_SPL_TOKEN_PROGRAM_ID),
      readonly(input.systemProgram ? asPublicKey(input.systemProgram) : SystemProgram.programId),
    ],
    data: concatData(
      "execute_bond_settlement",
      Buffer.from(appIdHash),
      Buffer.from(caseId),
      Buffer.from(receiptId),
      u64Le(input.amount),
      Buffer.from(hash32ToBytes(input.receiptDigest, "receiptDigest")),
    ),
  });
}

export function buildSetBondDispositionPolicyInstruction(
  input: BondDispositionPolicyInstructionInput,
): TransactionInstruction {
  const programId = asPublicKey(input.programId);
  const policyId = hash32ToBytes(input.policyId, "policyId");
  return new TransactionInstruction({
    programId,
    keys: [
      readonly(deriveExternalAppEconomicsConfigPda(programId)),
      writable(deriveExternalAppBondDispositionPolicyPda(programId, policyId)),
      signerWritable(asPublicKey(input.governanceAuthority)),
      readonly(input.systemProgram ? asPublicKey(input.systemProgram) : SystemProgram.programId),
    ],
    data: concatData(
      "set_bond_disposition_policy",
      Buffer.from(policyId),
      Buffer.from(hash32ToBytes(input.policyDigest, "policyDigest")),
      u64Le(input.maxCaseAmount),
      Buffer.from([input.paused ? 1 : 0]),
    ),
  });
}

export function buildRecordRiskDisclaimerAcceptanceInstruction(
  input: RecordRiskDisclaimerAcceptanceInstructionInput,
): TransactionInstruction {
  const programId = asPublicKey(input.programId);
  const appIdHash = hash32ToBytes(input.appIdHash, "appIdHash");
  const actor = asPublicKey(input.actor);
  const scope = riskScopeByte(input.scope);
  return new TransactionInstruction({
    programId,
    keys: [
      readonly(deriveExternalAppEconomicsConfigPda(programId)),
      writable(deriveExternalAppRiskDisclaimerReceiptPda(programId, appIdHash, actor, input.scope)),
      signerWritable(actor),
      readonly(input.systemProgram ? asPublicKey(input.systemProgram) : SystemProgram.programId),
    ],
    data: concatData(
      "record_risk_disclaimer_acceptance",
      Buffer.from(appIdHash),
      Buffer.from([scope]),
      Buffer.from(hash32ToBytes(input.termsDigest, "termsDigest")),
      Buffer.from(hash32ToBytes(input.acceptanceDigest, "acceptanceDigest")),
    ),
  });
}

export function buildOpenBondDispositionCaseInstruction(
  input: OpenBondDispositionCaseInstructionInput,
): TransactionInstruction {
  const programId = asPublicKey(input.programId);
  const appIdHash = hash32ToBytes(input.appIdHash, "appIdHash");
  const caseId = hash32ToBytes(input.caseId, "caseId");
  const policyId = hash32ToBytes(input.policyId, "policyId");
  const assetMint = asPublicKey(input.assetMint);
  return new TransactionInstruction({
    programId,
    keys: [
      readonly(deriveExternalAppEconomicsConfigPda(programId)),
      readonly(deriveExternalAppBondDispositionPolicyPda(programId, policyId)),
      readonly(deriveExternalAppRiskDisclaimerReceiptPda(programId, appIdHash, input.initiator, "bond_disposition")),
      writable(deriveExternalAppBondDispositionCasePda(programId, appIdHash, caseId)),
      readonly(deriveExternalAppOwnerBondVaultPda(programId, appIdHash, assetMint)),
      readonly(asPublicKey(input.vaultTokenAccount)),
      signerWritable(asPublicKey(input.initiator)),
      readonly(input.systemProgram ? asPublicKey(input.systemProgram) : SystemProgram.programId),
    ],
    data: concatData(
      "open_bond_disposition_case",
      Buffer.from(appIdHash),
      Buffer.from(caseId),
      Buffer.from(policyId),
      Buffer.from(hash32ToBytes(input.evidenceHash, "evidenceHash")),
      u64Le(input.requestedAmount),
    ),
  });
}

export function buildRecordBondDispositionEvidenceInstruction(
  input: RecordBondDispositionEvidenceInstructionInput,
): TransactionInstruction {
  return governanceBondDispositionInstruction(
    "record_bond_disposition_evidence",
    input,
    Buffer.from(hash32ToBytes(input.evidenceHash, "evidenceHash")),
    Buffer.from(hash32ToBytes(input.rulingDigest, "rulingDigest")),
  );
}

export function buildLockBondForCaseInstruction(
  input: LockBondForCaseInstructionInput,
): TransactionInstruction {
  const programId = asPublicKey(input.programId);
  const appIdHash = hash32ToBytes(input.appIdHash, "appIdHash");
  const caseId = hash32ToBytes(input.caseId, "caseId");
  const assetMint = asPublicKey(input.assetMint);
  return new TransactionInstruction({
    programId,
    keys: [
      readonly(deriveExternalAppEconomicsConfigPda(programId)),
      readonly(deriveExternalAppBondDispositionPolicyPda(programId, input.policyId)),
      writable(deriveExternalAppBondDispositionCasePda(programId, appIdHash, caseId)),
      readonly(deriveExternalAppOwnerBondVaultPda(programId, appIdHash, assetMint)),
      writable(deriveExternalAppBondExposureStatePda(programId, appIdHash, assetMint)),
      signerWritable(asPublicKey(input.governanceAuthority)),
      readonly(input.systemProgram ? asPublicKey(input.systemProgram) : SystemProgram.programId),
    ],
    data: concatData("lock_bond_for_case", Buffer.from(appIdHash), Buffer.from(caseId), u64Le(input.amount)),
  });
}

export function buildExecuteBondReleaseInstruction(
  input: GovernanceBondDispositionInstructionInput,
): TransactionInstruction {
  return releaseBondDispositionInstruction("execute_bond_release", input);
}

export function buildExecuteBondForfeitureInstruction(
  input: GovernanceBondDispositionInstructionInput,
): TransactionInstruction {
  return releaseBondDispositionInstruction("execute_bond_forfeiture", input);
}

export function buildRouteForfeitedBondByPolicyInstruction(
  input: RouteForfeitedBondByPolicyInstructionInput,
): TransactionInstruction {
  const programId = asPublicKey(input.programId);
  const appIdHash = hash32ToBytes(input.appIdHash, "appIdHash");
  const caseId = hash32ToBytes(input.caseId, "caseId");
  const receiptId = hash32ToBytes(input.receiptId, "receiptId");
  const assetMint = asPublicKey(input.assetMint);
  return new TransactionInstruction({
    programId,
    keys: [
      readonly(deriveExternalAppEconomicsConfigPda(programId)),
      writable(deriveExternalAppBondDispositionCasePda(programId, appIdHash, caseId)),
      writable(deriveExternalAppOwnerBondVaultPda(programId, appIdHash, assetMint)),
      writable(deriveExternalAppBondExposureStatePda(programId, appIdHash, assetMint)),
      writable(deriveExternalAppBondRoutingReceiptPda(programId, appIdHash, caseId, receiptId)),
      signerWritable(asPublicKey(input.governanceAuthority)),
      writable(asPublicKey(input.vaultTokenAccount)),
      writable(asPublicKey(input.routeDestinationTokenAccount)),
      readonly(input.tokenProgram ? asPublicKey(input.tokenProgram) : LEGACY_SPL_TOKEN_PROGRAM_ID),
      readonly(input.systemProgram ? asPublicKey(input.systemProgram) : SystemProgram.programId),
    ],
    data: concatData(
      "route_forfeited_bond_by_policy",
      Buffer.from(appIdHash),
      Buffer.from(caseId),
      Buffer.from(receiptId),
      u64Le(input.amount),
      Buffer.from(hash32ToBytes(input.routingDigest, "routingDigest")),
    ),
  });
}

export function buildUpdateBondExposureStateInstruction(
  input: UpdateBondExposureStateInstructionInput,
): TransactionInstruction {
  const programId = asPublicKey(input.programId);
  const appIdHash = hash32ToBytes(input.appIdHash, "appIdHash");
  const assetMint = asPublicKey(input.assetMint);
  return new TransactionInstruction({
    programId,
    keys: [
      readonly(deriveExternalAppEconomicsConfigPda(programId)),
      writable(deriveExternalAppBondExposureStatePda(programId, appIdHash, assetMint)),
      signerWritable(asPublicKey(input.governanceAuthority)),
      readonly(input.systemProgram ? asPublicKey(input.systemProgram) : SystemProgram.programId),
    ],
    data: concatData(
      "update_bond_exposure_state",
      Buffer.from(appIdHash),
      Buffer.from(hash32ToBytes(input.exposureDigest, "exposureDigest")),
    ),
  });
}

export function buildPauseNewBondExposureInstruction(
  input: PauseNewBondExposureInstructionInput,
): TransactionInstruction {
  const programId = asPublicKey(input.programId);
  const appIdHash = hash32ToBytes(input.appIdHash, "appIdHash");
  const assetMint = asPublicKey(input.assetMint);
  return new TransactionInstruction({
    programId,
    keys: [
      readonly(deriveExternalAppEconomicsConfigPda(programId)),
      writable(deriveExternalAppBondExposureStatePda(programId, appIdHash, assetMint)),
      signerReadonly(asPublicKey(input.governanceAuthority)),
    ],
    data: concatData("pause_new_bond_exposure", Buffer.from(appIdHash), Buffer.from([input.paused ? 1 : 0])),
  });
}

export class ExternalAppEconomicsModule {
  constructor(public readonly programId: PublicKey) {}

  deriveConfigPda(): PublicKey {
    return deriveExternalAppEconomicsConfigPda(this.programId);
  }
}

function ownerBondTransferInstruction(
  name: "deposit_owner_bond" | "execute_unlocked_owner_bond_withdrawal",
  input: OwnerBondTransferInstructionInput,
): TransactionInstruction {
  const programId = asPublicKey(input.programId);
  const appIdHash = hash32ToBytes(input.appIdHash, "appIdHash");
  const assetMint = asPublicKey(input.assetMint);
  return new TransactionInstruction({
    programId,
    keys: [
      readonly(deriveExternalAppEconomicsConfigPda(programId)),
      writable(deriveExternalAppOwnerBondVaultPda(programId, appIdHash, assetMint)),
      signerWritable(asPublicKey(input.owner)),
      readonly(assetMint),
      writable(asPublicKey(input.ownerTokenAccount)),
      writable(asPublicKey(input.vaultTokenAccount)),
      readonly(input.tokenProgram ? asPublicKey(input.tokenProgram) : LEGACY_SPL_TOKEN_PROGRAM_ID),
    ],
    data: concatData(name, Buffer.from(appIdHash), u64Le(input.amount)),
  });
}

function governanceChallengeInstruction(
  name:
    | "record_challenge_response"
    | "record_appeal_window"
    | "settle_machine_verifiable_case"
    | "anchor_governance_ruling",
  input: GovernanceChallengeInstructionInput,
  tail: Buffer,
): TransactionInstruction {
  const programId = asPublicKey(input.programId);
  const appIdHash = hash32ToBytes(input.appIdHash, "appIdHash");
  const caseId = hash32ToBytes(input.caseId, "caseId");
  return new TransactionInstruction({
    programId,
    keys: [
      readonly(deriveExternalAppEconomicsConfigPda(programId)),
      writable(deriveExternalAppChallengeCasePda(programId, appIdHash, caseId)),
      signerReadonly(asPublicKey(input.governanceAuthority)),
    ],
    data: concatData(name, Buffer.from(appIdHash), Buffer.from(caseId), tail),
  });
}

function governanceBondDispositionInstruction(
  name: "record_bond_disposition_evidence",
  input: GovernanceBondDispositionInstructionInput,
  ...tail: Buffer[]
): TransactionInstruction {
  const programId = asPublicKey(input.programId);
  const appIdHash = hash32ToBytes(input.appIdHash, "appIdHash");
  const caseId = hash32ToBytes(input.caseId, "caseId");
  return new TransactionInstruction({
    programId,
    keys: [
      readonly(deriveExternalAppEconomicsConfigPda(programId)),
      writable(deriveExternalAppBondDispositionCasePda(programId, appIdHash, caseId)),
      signerReadonly(asPublicKey(input.governanceAuthority)),
    ],
    data: concatData(name, Buffer.from(appIdHash), Buffer.from(caseId), ...tail),
  });
}

function releaseBondDispositionInstruction(
  name: "execute_bond_release" | "execute_bond_forfeiture",
  input: GovernanceBondDispositionInstructionInput,
): TransactionInstruction {
  const programId = asPublicKey(input.programId);
  const appIdHash = hash32ToBytes(input.appIdHash, "appIdHash");
  const caseId = hash32ToBytes(input.caseId, "caseId");
  const assetMint = asPublicKey(input.assetMint);
  return new TransactionInstruction({
    programId,
    keys: [
      readonly(deriveExternalAppEconomicsConfigPda(programId)),
      writable(deriveExternalAppBondDispositionCasePda(programId, appIdHash, caseId)),
      writable(deriveExternalAppBondExposureStatePda(programId, appIdHash, assetMint)),
      signerReadonly(asPublicKey(input.governanceAuthority)),
    ],
    data: concatData(name, Buffer.from(appIdHash), Buffer.from(caseId)),
  });
}

function governanceConfigKeys(
  programId: PublicKey,
  governanceAuthority: PublicKey | string,
) {
  return [
    writable(deriveExternalAppEconomicsConfigPda(programId)),
    signerReadonly(asPublicKey(governanceAuthority)),
  ];
}

function hash32ToBytes(
  value: Uint8Array | number[] | string,
  fieldName: string,
): number[] {
  if (typeof value === "string") {
    const withoutDigestPrefix = value.startsWith("sha256:")
      ? value.slice("sha256:".length)
      : value;
    const normalized = withoutDigestPrefix.startsWith("0x")
      ? withoutDigestPrefix.slice(2)
      : withoutDigestPrefix;
    if (!/^[0-9a-fA-F]{64}$/.test(normalized)) {
      throw new Error(`invalid_external_app_economics_${fieldName}`);
    }
    const bytes: number[] = [];
    for (let index = 0; index < normalized.length; index += 2) {
      bytes.push(Number.parseInt(normalized.slice(index, index + 2), 16));
    }
    return bytes;
  }
  const bytes = Array.from(value);
  if (bytes.length !== 32 || bytes.some((byte) => !Number.isInteger(byte) || byte < 0 || byte > 255)) {
    throw new Error(`invalid_external_app_economics_${fieldName}`);
  }
  return bytes;
}

function asPublicKey(value: PublicKey | string): PublicKey {
  return value instanceof PublicKey ? value : new PublicKey(value);
}

function instructionDiscriminator(name: string): Buffer {
  return Buffer.from(
    sha256.array(Buffer.from(`global:${name}`, "utf8")).slice(0, 8),
  );
}

function concatData(name: string, ...parts: Buffer[]): Buffer {
  return Buffer.concat([instructionDiscriminator(name), ...parts]);
}

function u32Le(value: number, fieldName: string): Buffer {
  if (!Number.isSafeInteger(value) || value < 0 || value > 0xffffffff) {
    throw new Error(`invalid_external_app_economics_${fieldName}`);
  }
  const output = Buffer.alloc(4);
  output.writeUInt32LE(value);
  return output;
}

function u64Le(value: bigint | number | string): Buffer {
  const normalized = BigInt(value);
  if (normalized < 0n || normalized > 0xffffffffffffffffn) {
    throw new Error("invalid_external_app_economics_u64");
  }
  const output = Buffer.alloc(8);
  output.writeBigUInt64LE(normalized);
  return output;
}

function i64Le(value: bigint | number | string): Buffer {
  const normalized = BigInt(value);
  if (normalized < -0x8000000000000000n || normalized > 0x7fffffffffffffffn) {
    throw new Error("invalid_external_app_economics_i64");
  }
  const output = Buffer.alloc(8);
  output.writeBigInt64LE(normalized);
  return output;
}

function assetStatusByte(status: ExternalAppEconomicsAssetStatus): number {
  if (status === "disabled") return 0;
  if (status === "test_only") return 1;
  if (status === "active") return 2;
  if (status === "paused") return 3;
  if (status === "retired") return 4;
  throw new Error("invalid_external_app_economics_asset_status");
}

function riskScopeByte(scope: ExternalAppRiskDisclaimerScope): number {
  if (scope === "external_app_entry") return 0;
  if (scope === "challenge_bond") return 1;
  if (scope === "bond_disposition") return 2;
  if (scope === "developer_registration") return 3;
  throw new Error("invalid_external_app_economics_risk_scope");
}

function readonly(pubkey: PublicKey) {
  return { pubkey, isSigner: false, isWritable: false };
}

function writable(pubkey: PublicKey) {
  return { pubkey, isSigner: false, isWritable: true };
}

function signerReadonly(pubkey: PublicKey) {
  return { pubkey, isSigner: true, isWritable: false };
}

function signerWritable(pubkey: PublicKey) {
  return { pubkey, isSigner: true, isWritable: true };
}
