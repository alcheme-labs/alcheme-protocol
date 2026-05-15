#!/usr/bin/env node
import fs from "node:fs";
import crypto from "node:crypto";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const rootDir = path.resolve(__dirname, "../..");

const idlPath =
  process.env.EXTERNAL_APP_ECONOMICS_IDL_PATH ||
  path.join(rootDir, "target/idl/external_app_economics.json");
const sdkIdlPath = path.join(rootDir, "sdk/src/idl/external_app_economics.json");
const execute =
  process.env.ALCHEME_EXTERNAL_APP_V3C_EXECUTE === "true" ||
  process.env.ALCHEME_EXTERNAL_APP_V3B_EXECUTE === "true";
const mode = process.env.EXTERNAL_APP_SETTLEMENT_ASSET_MODE || "disabled";
const rpcUrl = process.env.SOLANA_RPC_URL || process.env.RPC_URL || "http://127.0.0.1:8899";
const walletPath =
  process.env.ANCHOR_WALLET || path.join(os.homedir(), ".config/solana/id.json");

function readJson(filePath) {
  return JSON.parse(fs.readFileSync(filePath, "utf8"));
}

const result = {
  ok: true,
  execute,
  settlementAssetMode: mode,
  economicsProgramId:
    process.env.EXTERNAL_APP_ECONOMICS_PROGRAM_ID ||
    process.env.NEXT_PUBLIC_EXTERNAL_APP_ECONOMICS_PROGRAM_ID ||
    null,
  idl: {
    targetExists: fs.existsSync(idlPath),
    sdkExists: fs.existsSync(sdkIdlPath),
    instructionCount: 0,
  },
  chainSubmit: {
    skipped: !execute,
    reason: execute ? null : "ALCHEME_EXTERNAL_APP_V3C_EXECUTE_not_true",
  },
};

if (!result.idl.targetExists) {
  throw new Error(`external_app_economics_idl_missing:${idlPath}`);
}
if (!result.idl.sdkExists) {
  throw new Error(`external_app_economics_sdk_idl_missing:${sdkIdlPath}`);
}

const idl = readJson(idlPath);
result.idl.instructionCount = Array.isArray(idl.instructions) ? idl.instructions.length : 0;
if (result.idl.instructionCount < 25) {
  throw new Error("external_app_economics_idl_incomplete");
}

if (execute && mode !== "test_mint") {
  throw new Error("external_app_v3c_execute_requires_test_mint_mode");
}

if (execute) {
  result.execution = await executeLocalV3cSmoke({
    idl,
    programId: result.economicsProgramId,
    rpcUrl,
    walletPath,
  });
}

console.log(JSON.stringify(result, null, 2));

function loadKeypair(Keypair, filePath) {
  return Keypair.fromSecretKey(Uint8Array.from(JSON.parse(fs.readFileSync(filePath, "utf8"))));
}

function sha256Bytes(value) {
  return Array.from(crypto.createHash("sha256").update(value).digest());
}

async function executeLocalV3cSmoke({ idl, programId, rpcUrl, walletPath }) {
  const anchorModule = await import("@coral-xyz/anchor");
  const anchor = anchorModule.default ?? anchorModule;
  const web3 = await import("@solana/web3.js");
  const splToken = await import("@solana/spl-token");
  const {
    Connection,
    Keypair,
    PublicKey,
    SystemProgram,
  } = web3;
  const {
    TOKEN_PROGRAM_ID,
    createMint,
    getOrCreateAssociatedTokenAccount,
    mintTo,
  } = splToken;
  if (!programId) throw new Error("external_app_economics_program_id_required");
  const authority = loadKeypair(Keypair, walletPath);
  const connection = new Connection(rpcUrl, "confirmed");
  const provider = new anchor.AnchorProvider(
    connection,
    new anchor.Wallet(authority),
    { commitment: "confirmed" },
  );
  anchor.setProvider(provider);
  const program = new anchor.Program({ ...idl, address: programId }, provider);
  const programPk = new PublicKey(programId);
  const [configPda] = PublicKey.findProgramAddressSync(
    [Buffer.from("external_app_economics")],
    programPk,
  );
  const policyEpochDigest = sha256Bytes("alcheme:v3b:local-smoke:policy-epoch");

  if (!(await connection.getAccountInfo(configPda))) {
    await program.methods
      .initializeEconomicsConfig(authority.publicKey, policyEpochDigest, 1)
      .accounts({
        config: configPda,
        admin: authority.publicKey,
        systemProgram: SystemProgram.programId,
      })
      .signers([authority])
      .rpc();
  }

  const configuredMint = process.env.EXTERNAL_APP_SETTLEMENT_TEST_MINT;
  const mint = configuredMint
    ? new PublicKey(configuredMint)
    : await createMint(connection, authority, authority.publicKey, null, 6);
  const ownerToken = await getOrCreateAssociatedTokenAccount(
    connection,
    authority,
    mint,
    authority.publicKey,
  );
  if (!configuredMint) {
    await mintTo(connection, authority, mint, ownerToken.address, authority, 1_000_000n);
  }

  await program.methods
    .setAssetAllowlist({ testOnly: {} })
    .accounts({
      config: configPda,
      governanceAuthority: authority.publicKey,
      assetMint: mint,
      tokenProgram: TOKEN_PROGRAM_ID,
    })
    .signers([authority])
    .rpc();
  await program.methods
    .pauseNewEconomicExposure(false)
    .accounts({
      config: configPda,
      governanceAuthority: authority.publicKey,
    })
    .signers([authority])
    .rpc();

  const nonce = `${Date.now()}:${Math.random()}`;
  const appIdHash = sha256Bytes(`alcheme:v3b:local-smoke:app:${nonce}`);
  const caseId = sha256Bytes(`alcheme:v3b:local-smoke:case:${nonce}`);
  const evidenceHash = sha256Bytes(`alcheme:v3b:local-smoke:evidence:${nonce}`);
  const receiptId = sha256Bytes(`alcheme:v3b:local-smoke:receipt:${nonce}`);
  const receiptDigest = sha256Bytes(`alcheme:v3b:local-smoke:receipt-digest:${nonce}`);
  const dispositionPolicyId = sha256Bytes(`alcheme:v3c:local-smoke:policy:${nonce}`);
  const dispositionPolicyDigest = sha256Bytes(`alcheme:v3c:local-smoke:policy-digest:${nonce}`);
  const riskTermsDigest = sha256Bytes(`alcheme:v3c:local-smoke:terms:${nonce}`);
  const riskAcceptanceDigest = sha256Bytes(`alcheme:v3c:local-smoke:acceptance:${nonce}`);
  const dispositionCaseId = sha256Bytes(`alcheme:v3c:local-smoke:case:${nonce}`);
  const dispositionEvidenceHash = sha256Bytes(`alcheme:v3c:local-smoke:evidence:${nonce}`);
  const dispositionRulingDigest = sha256Bytes(`alcheme:v3c:local-smoke:ruling:${nonce}`);
  const routeReceiptId = sha256Bytes(`alcheme:v3c:local-smoke:route-receipt:${nonce}`);
  const routeDigest = sha256Bytes(`alcheme:v3c:local-smoke:route-digest:${nonce}`);
  const [bondVault] = PublicKey.findProgramAddressSync(
    [Buffer.from("external_app_v3_owner_bond_vault"), Buffer.from(appIdHash), mint.toBuffer()],
    programPk,
  );
  const [challengeCase] = PublicKey.findProgramAddressSync(
    [Buffer.from("external_app_v3_challenge_case"), Buffer.from(appIdHash), Buffer.from(caseId)],
    programPk,
  );
  const [settlementReceipt] = PublicKey.findProgramAddressSync(
    [
      Buffer.from("external_app_v3_settle_receipt"),
      Buffer.from(appIdHash),
      Buffer.from(caseId),
      Buffer.from(receiptId),
    ],
    programPk,
  );
  const [bondDispositionPolicy] = PublicKey.findProgramAddressSync(
    [
      Buffer.from("external_app_v3_bond_policy"),
      Buffer.from(dispositionPolicyId),
    ],
    programPk,
  );
  const [riskDisclaimerReceipt] = PublicKey.findProgramAddressSync(
    [
      Buffer.from("external_app_v3_risk_receipt"),
      Buffer.from(appIdHash),
      authority.publicKey.toBuffer(),
      Buffer.from([2]),
    ],
    programPk,
  );
  const [bondDispositionCase] = PublicKey.findProgramAddressSync(
    [
      Buffer.from("external_app_v3_bond_case"),
      Buffer.from(appIdHash),
      Buffer.from(dispositionCaseId),
    ],
    programPk,
  );
  const [bondExposureState] = PublicKey.findProgramAddressSync(
    [
      Buffer.from("external_app_v3_bond_exposure"),
      Buffer.from(appIdHash),
      mint.toBuffer(),
    ],
    programPk,
  );
  const [bondRoutingReceipt] = PublicKey.findProgramAddressSync(
    [
      Buffer.from("external_app_v3_bond_route"),
      Buffer.from(appIdHash),
      Buffer.from(dispositionCaseId),
      Buffer.from(routeReceiptId),
    ],
    programPk,
  );
  const vaultToken = await getOrCreateAssociatedTokenAccount(
    connection,
    authority,
    mint,
    bondVault,
    true,
  );
  const caseVaultToken = await getOrCreateAssociatedTokenAccount(
    connection,
    authority,
    mint,
    challengeCase,
    true,
  );

  const openOwnerTx = await program.methods
    .openOwnerBondVault(appIdHash)
    .accounts({
      config: configPda,
      bondVault,
      owner: authority.publicKey,
      assetMint: mint,
      vaultTokenAccount: vaultToken.address,
      systemProgram: SystemProgram.programId,
    })
    .signers([authority])
    .rpc();
  const depositOwnerTx = await program.methods
    .depositOwnerBond(appIdHash, new anchor.BN(100))
    .accounts({
      config: configPda,
      bondVault,
      owner: authority.publicKey,
      assetMint: mint,
      ownerTokenAccount: ownerToken.address,
      vaultTokenAccount: vaultToken.address,
      tokenProgram: TOKEN_PROGRAM_ID,
    })
    .signers([authority])
    .rpc();
  const openChallengeTx = await program.methods
    .openChallengeCase(appIdHash, caseId, evidenceHash, 1)
    .accounts({
      config: configPda,
      challengeCase,
      challenger: authority.publicKey,
      assetMint: mint,
      caseVaultTokenAccount: caseVaultToken.address,
      systemProgram: SystemProgram.programId,
    })
    .signers([authority])
    .rpc();
  const depositChallengeTx = await program.methods
    .depositChallengeBond(appIdHash, caseId, new anchor.BN(50))
    .accounts({
      config: configPda,
      challengeCase,
      challenger: authority.publicKey,
      assetMint: mint,
      challengerTokenAccount: ownerToken.address,
      caseVaultTokenAccount: caseVaultToken.address,
      tokenProgram: TOKEN_PROGRAM_ID,
    })
    .signers([authority])
    .rpc();
  const rulingTx = await program.methods
    .anchorGovernanceRuling(appIdHash, caseId, receiptDigest)
    .accounts({
      config: configPda,
      challengeCase,
      governanceAuthority: authority.publicKey,
    })
    .signers([authority])
    .rpc();
  const settlementTx = await program.methods
    .executeBondSettlement(appIdHash, caseId, receiptId, new anchor.BN(25), receiptDigest)
    .accounts({
      config: configPda,
      challengeCase,
      settlementReceipt,
      governanceAuthority: authority.publicKey,
      caseVaultTokenAccount: caseVaultToken.address,
      settlementDestinationTokenAccount: ownerToken.address,
      tokenProgram: TOKEN_PROGRAM_ID,
      systemProgram: SystemProgram.programId,
    })
    .signers([authority])
    .rpc();
  const setDispositionPolicyTx = await program.methods
    .setBondDispositionPolicy(
      dispositionPolicyId,
      dispositionPolicyDigest,
      new anchor.BN(60),
      false,
    )
    .accounts({
      config: configPda,
      policy: bondDispositionPolicy,
      governanceAuthority: authority.publicKey,
      systemProgram: SystemProgram.programId,
    })
    .signers([authority])
    .rpc();
  const riskReceiptTx = await program.methods
    .recordRiskDisclaimerAcceptance(
      appIdHash,
      2,
      riskTermsDigest,
      riskAcceptanceDigest,
    )
    .accounts({
      config: configPda,
      riskDisclaimerReceipt,
      actor: authority.publicKey,
      systemProgram: SystemProgram.programId,
    })
    .signers([authority])
    .rpc();
  const openDispositionCaseTx = await program.methods
    .openBondDispositionCase(
      appIdHash,
      dispositionCaseId,
      dispositionPolicyId,
      dispositionEvidenceHash,
      new anchor.BN(40),
    )
    .accounts({
      config: configPda,
      policy: bondDispositionPolicy,
      riskDisclaimerReceipt,
      dispositionCase: bondDispositionCase,
      bondVault,
      vaultTokenAccount: vaultToken.address,
      initiator: authority.publicKey,
      systemProgram: SystemProgram.programId,
    })
    .signers([authority])
    .rpc();
  const recordDispositionEvidenceTx = await program.methods
    .recordBondDispositionEvidence(
      appIdHash,
      dispositionCaseId,
      dispositionEvidenceHash,
      dispositionRulingDigest,
    )
    .accounts({
      config: configPda,
      dispositionCase: bondDispositionCase,
      governanceAuthority: authority.publicKey,
    })
    .signers([authority])
    .rpc();
  const lockDispositionTx = await program.methods
    .lockBondForCase(appIdHash, dispositionCaseId, new anchor.BN(40))
    .accounts({
      config: configPda,
      policy: bondDispositionPolicy,
      dispositionCase: bondDispositionCase,
      bondVault,
      exposureState: bondExposureState,
      governanceAuthority: authority.publicKey,
      systemProgram: SystemProgram.programId,
    })
    .signers([authority])
    .rpc();
  const forfeitureTx = await program.methods
    .executeBondForfeiture(appIdHash, dispositionCaseId)
    .accounts({
      config: configPda,
      dispositionCase: bondDispositionCase,
      exposureState: bondExposureState,
      governanceAuthority: authority.publicKey,
    })
    .signers([authority])
    .rpc();
  const routingTx = await program.methods
    .routeForfeitedBondByPolicy(
      appIdHash,
      dispositionCaseId,
      routeReceiptId,
      new anchor.BN(30),
      routeDigest,
    )
    .accounts({
      config: configPda,
      dispositionCase: bondDispositionCase,
      bondVault,
      exposureState: bondExposureState,
      routingReceipt: bondRoutingReceipt,
      governanceAuthority: authority.publicKey,
      vaultTokenAccount: vaultToken.address,
      routeDestinationTokenAccount: ownerToken.address,
      tokenProgram: TOKEN_PROGRAM_ID,
      systemProgram: SystemProgram.programId,
    })
    .signers([authority])
    .rpc();

  return {
    mint: mint.toBase58(),
    configPda: configPda.toBase58(),
    bondVault: bondVault.toBase58(),
    challengeCase: challengeCase.toBase58(),
    settlementReceipt: settlementReceipt.toBase58(),
    bondDispositionPolicy: bondDispositionPolicy.toBase58(),
    riskDisclaimerReceipt: riskDisclaimerReceipt.toBase58(),
    bondDispositionCase: bondDispositionCase.toBase58(),
    bondExposureState: bondExposureState.toBase58(),
    bondRoutingReceipt: bondRoutingReceipt.toBase58(),
    tx: {
      openOwnerTx,
      depositOwnerTx,
      openChallengeTx,
      depositChallengeTx,
      rulingTx,
      settlementTx,
      setDispositionPolicyTx,
      riskReceiptTx,
      openDispositionCaseTx,
      recordDispositionEvidenceTx,
      lockDispositionTx,
      forfeitureTx,
      routingTx,
    },
  };
}
