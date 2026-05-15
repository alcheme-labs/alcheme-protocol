import { Keypair, PublicKey, SystemProgram } from "@solana/web3.js";
import {
  buildAnchorGovernanceRulingInstruction,
  buildDepositChallengeBondInstruction,
  buildDepositOwnerBondInstruction,
  buildExecuteBondForfeitureInstruction,
  buildExecuteBondReleaseInstruction,
  buildExecuteBondSettlementInstruction,
  buildExecuteUnlockedOwnerBondWithdrawalInstruction,
  buildInitializeEconomicsConfigInstruction,
  buildLockBondForCaseInstruction,
  buildOpenBondDispositionCaseInstruction,
  buildOpenChallengeCaseInstruction,
  buildOpenOwnerBondVaultInstruction,
  buildPauseNewEconomicExposureInstruction,
  buildPauseNewBondExposureInstruction,
  buildRecordBondDispositionEvidenceInstruction,
  buildRecordAppealWindowInstruction,
  buildRecordChallengeResponseInstruction,
  buildRecordRiskDisclaimerAcceptanceInstruction,
  buildRouteForfeitedBondByPolicyInstruction,
  buildSetBondDispositionPolicyInstruction,
  buildRequestOwnerBondWithdrawalInstruction,
  buildSetAssetAllowlistInstruction,
  buildSetPolicyEpochInstruction,
  buildSettleMachineVerifiableCaseInstruction,
  buildUpdateBondExposureStateInstruction,
  deriveExternalAppBondDispositionCasePda,
  deriveExternalAppBondDispositionPolicyPda,
  deriveExternalAppBondExposureStatePda,
  deriveExternalAppBondRoutingReceiptPda,
  deriveExternalAppChallengeCasePda,
  deriveExternalAppEconomicsConfigPda,
  deriveExternalAppOwnerBondVaultPda,
  deriveExternalAppRiskDisclaimerReceiptPda,
  deriveExternalAppSettlementReceiptPda,
  ExternalAppEconomicsModule,
  LEGACY_SPL_TOKEN_PROGRAM_ID,
} from "../external-app-economics";

describe("external app economics protocol SDK", () => {
  const programId = new PublicKey("5YUcL1ysdx9busDkvMGjiXNbugFAAWPLby5hoe2hQHAJ");
  const appIdHash = "01".repeat(32);
  const caseId = "02".repeat(32);
  const digest = "03".repeat(32);
  const receiptId = "04".repeat(32);
  const policyId = "05".repeat(32);
  const routeReceiptId = "06".repeat(32);
  const mint = new PublicKey("So11111111111111111111111111111111111111112");
  const authority = Keypair.generate().publicKey;
  const owner = Keypair.generate().publicKey;
  const ownerTokenAccount = Keypair.generate().publicKey;
  const vaultTokenAccount = Keypair.generate().publicKey;
  const challenger = Keypair.generate().publicKey;
  const challengerTokenAccount = Keypair.generate().publicKey;
  const caseVaultTokenAccount = Keypair.generate().publicKey;
  const settlementDestinationTokenAccount = Keypair.generate().publicKey;

  it("derives isolated V3B/V3C PDAs", () => {
    expect(deriveExternalAppEconomicsConfigPda(programId)).toBeInstanceOf(PublicKey);
    expect(deriveExternalAppOwnerBondVaultPda(programId, appIdHash, mint)).toBeInstanceOf(PublicKey);
    expect(deriveExternalAppChallengeCasePda(programId, appIdHash, caseId)).toBeInstanceOf(PublicKey);
    expect(deriveExternalAppSettlementReceiptPda(programId, appIdHash, caseId, receiptId)).toBeInstanceOf(PublicKey);
    expect(deriveExternalAppBondDispositionPolicyPda(programId, policyId)).toBeInstanceOf(PublicKey);
    expect(deriveExternalAppRiskDisclaimerReceiptPda(programId, appIdHash, owner, "bond_disposition")).toBeInstanceOf(PublicKey);
    expect(deriveExternalAppRiskDisclaimerReceiptPda(programId, appIdHash, owner, "developer_registration")).toBeInstanceOf(PublicKey);
    expect(deriveExternalAppBondDispositionCasePda(programId, appIdHash, caseId)).toBeInstanceOf(PublicKey);
    expect(deriveExternalAppBondRoutingReceiptPda(programId, appIdHash, caseId, routeReceiptId)).toBeInstanceOf(PublicKey);
    expect(deriveExternalAppBondExposureStatePda(programId, appIdHash, mint)).toBeInstanceOf(PublicKey);
  });

  it("builds all V3B/V3C instruction payloads with deterministic program id", () => {
    const builders = [
      buildInitializeEconomicsConfigInstruction({
        programId,
        admin: authority,
        governanceAuthority: authority,
        policyEpochDigest: digest,
        withdrawalLockSeconds: 60,
      }),
      buildSetPolicyEpochInstruction({ programId, governanceAuthority: authority, policyEpochDigest: digest }),
      buildSetAssetAllowlistInstruction({
        programId,
        governanceAuthority: authority,
        assetMint: mint,
        status: "test_only",
      }),
      buildPauseNewEconomicExposureInstruction({ programId, governanceAuthority: authority, paused: false }),
      buildOpenOwnerBondVaultInstruction({
        programId,
        owner,
        appIdHash,
        assetMint: mint,
        vaultTokenAccount,
      }),
      buildDepositOwnerBondInstruction({
        programId,
        owner,
        appIdHash,
        amount: 10n,
        assetMint: mint,
        ownerTokenAccount,
        vaultTokenAccount,
      }),
      buildRequestOwnerBondWithdrawalInstruction({ programId, owner, appIdHash, assetMint: mint }),
      buildExecuteUnlockedOwnerBondWithdrawalInstruction({
        programId,
        owner,
        appIdHash,
        amount: 5n,
        assetMint: mint,
        ownerTokenAccount,
        vaultTokenAccount,
      }),
      buildOpenChallengeCaseInstruction({
        programId,
        challenger,
        appIdHash,
        caseId,
        evidenceHash: digest,
        challengeType: 1,
        assetMint: mint,
        caseVaultTokenAccount,
      }),
      buildDepositChallengeBondInstruction({
        programId,
        challenger,
        appIdHash,
        caseId,
        amount: 10n,
        assetMint: mint,
        challengerTokenAccount,
        caseVaultTokenAccount,
      }),
      buildRecordChallengeResponseInstruction({
        programId,
        governanceAuthority: authority,
        appIdHash,
        caseId,
        responseDigest: digest,
      }),
      buildRecordAppealWindowInstruction({
        programId,
        governanceAuthority: authority,
        appIdHash,
        caseId,
        appealWindowEndsAt: 1_800_000_000n,
      }),
      buildSettleMachineVerifiableCaseInstruction({
        programId,
        governanceAuthority: authority,
        appIdHash,
        caseId,
        rulingDigest: digest,
      }),
      buildAnchorGovernanceRulingInstruction({
        programId,
        governanceAuthority: authority,
        appIdHash,
        caseId,
        rulingDigest: digest,
      }),
      buildExecuteBondSettlementInstruction({
        programId,
        governanceAuthority: authority,
        appIdHash,
        caseId,
        receiptId,
        amount: 5n,
        receiptDigest: digest,
        caseVaultTokenAccount,
        settlementDestinationTokenAccount,
      }),
      buildSetBondDispositionPolicyInstruction({
        programId,
        governanceAuthority: authority,
        policyId,
        policyDigest: digest,
        maxCaseAmount: 100n,
        paused: false,
      }),
      buildRecordRiskDisclaimerAcceptanceInstruction({
        programId,
        actor: owner,
        appIdHash,
        scope: "developer_registration",
        termsDigest: digest,
        acceptanceDigest: digest,
      }),
      buildOpenBondDispositionCaseInstruction({
        programId,
        initiator: owner,
        appIdHash,
        caseId,
        policyId,
        evidenceHash: digest,
        requestedAmount: 10n,
        assetMint: mint,
        vaultTokenAccount,
      }),
      buildRecordBondDispositionEvidenceInstruction({
        programId,
        governanceAuthority: authority,
        appIdHash,
        caseId,
        assetMint: mint,
        evidenceHash: digest,
        rulingDigest: digest,
      }),
      buildLockBondForCaseInstruction({
        programId,
        governanceAuthority: authority,
        appIdHash,
        caseId,
        policyId,
        amount: 10n,
        assetMint: mint,
      }),
      buildExecuteBondReleaseInstruction({
        programId,
        governanceAuthority: authority,
        appIdHash,
        caseId,
        assetMint: mint,
      }),
      buildExecuteBondForfeitureInstruction({
        programId,
        governanceAuthority: authority,
        appIdHash,
        caseId,
        assetMint: mint,
      }),
      buildRouteForfeitedBondByPolicyInstruction({
        programId,
        governanceAuthority: authority,
        appIdHash,
        caseId,
        receiptId: routeReceiptId,
        amount: 10n,
        routingDigest: digest,
        assetMint: mint,
        vaultTokenAccount,
        routeDestinationTokenAccount: settlementDestinationTokenAccount,
      }),
      buildUpdateBondExposureStateInstruction({
        programId,
        governanceAuthority: authority,
        appIdHash,
        assetMint: mint,
        exposureDigest: digest,
      }),
      buildPauseNewBondExposureInstruction({
        programId,
        governanceAuthority: authority,
        appIdHash,
        assetMint: mint,
        paused: true,
      }),
    ];

    for (const instruction of builders) {
      expect(instruction.programId.toBase58()).toBe(programId.toBase58());
      expect(instruction.data.length).toBeGreaterThan(8);
    }
    expect(builders[0].keys.at(-1)?.pubkey.toBase58()).toBe(SystemProgram.programId.toBase58());
    expect(builders[5].keys.at(-1)?.pubkey.toBase58()).toBe(LEGACY_SPL_TOKEN_PROGRAM_ID.toBase58());
    expect(builders[7].keys).toHaveLength(9);
    expect(builders[7].keys[2].pubkey.toBase58()).toBe(
      deriveExternalAppBondExposureStatePda(programId, appIdHash, mint).toBase58(),
    );
    expect(builders[7].keys.at(-1)?.pubkey.toBase58()).toBe(SystemProgram.programId.toBase58());
  });

  it("exposes a lightweight module wrapper", () => {
    const module = new ExternalAppEconomicsModule(programId);
    expect(module.deriveConfigPda().toBase58()).toEqual(
      deriveExternalAppEconomicsConfigPda(programId).toBase58(),
    );
  });
});
