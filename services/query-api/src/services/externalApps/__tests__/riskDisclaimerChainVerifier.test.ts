import { Keypair, PublicKey } from "@solana/web3.js";

import { appIdHash } from "../chainRegistryDigest";
import {
  anchorAccountDiscriminator,
  computeRiskDisclaimerReceiptDataDigest,
  createRiskDisclaimerReceiptVerifier,
  decodeRiskDisclaimerReceiptAccount,
  deriveRiskDisclaimerReceiptPda,
} from "../riskDisclaimerChainVerifier";

describe("risk disclaimer chain verifier", () => {
  const programId = new PublicKey("5YUcL1ysdx9busDkvMGjiXNbugFAAWPLby5hoe2hQHAJ");
  const externalAppId = "last-ignition";
  const termsDigest = "11".repeat(32);
  const acceptanceDigest = "22".repeat(32);
  const policyEpochDigest = "33".repeat(32);

  it("decodes and verifies a matching on-chain risk receipt", async () => {
    const actor = Keypair.generate().publicKey;
    const data = buildRiskReceiptAccountData({
      actor,
      appIdHashHex: appIdHash(externalAppId),
      termsDigest,
      acceptanceDigest,
      policyEpochDigest,
      scope: 3,
    });
    const chainReceiptPda = deriveRiskDisclaimerReceiptPda({
      programId,
      appIdHashHex: appIdHash(externalAppId),
      actor,
      scope: "developer_registration",
    }).toBase58();
    const connection = {
      getAccountInfo: jest.fn(async () => ({ data, owner: programId })),
      getSignatureStatuses: jest.fn(async () => ({
        value: [{ err: null, confirmationStatus: "confirmed" }],
      })),
    };

    await expect(
      createRiskDisclaimerReceiptVerifier(
        {
          mode: "required",
          programId: programId.toBase58(),
          rpcUrl: "http://127.0.0.1:8899",
        },
        { connection: connection as never },
      ).verifyRiskDisclaimerReceipt({
        externalAppId,
        actorPubkey: actor.toBase58(),
        scope: "developer_registration",
        termsDigest: `sha256:${termsDigest}`,
        acceptanceDigest: `sha256:${acceptanceDigest}`,
        chainReceiptPda,
        chainReceiptDigest: computeRiskDisclaimerReceiptDataDigest(data),
        txSignature: "tx-1",
      }),
    ).resolves.toBeUndefined();

    expect(connection.getAccountInfo).toHaveBeenCalled();
    expect(connection.getSignatureStatuses).toHaveBeenCalledWith(["tx-1"], {
      searchTransactionHistory: true,
    });
  });

  it("rejects mismatched receipt PDA before trusting submitted metadata", async () => {
    const actor = Keypair.generate().publicKey;
    const verifier = createRiskDisclaimerReceiptVerifier({
      mode: "required",
      programId: programId.toBase58(),
      rpcUrl: "http://127.0.0.1:8899",
    });

    await expect(
      verifier.verifyRiskDisclaimerReceipt({
        externalAppId,
        actorPubkey: actor.toBase58(),
        scope: "developer_registration",
        termsDigest: `sha256:${termsDigest}`,
        acceptanceDigest: `sha256:${acceptanceDigest}`,
        chainReceiptPda: Keypair.generate().publicKey.toBase58(),
        chainReceiptDigest: "44".repeat(32),
        txSignature: "tx-1",
      }),
    ).rejects.toThrow("external_app_risk_receipt_pda_mismatch");
  });

  it("rejects receipt accounts not owned by the economics program", async () => {
    const actor = Keypair.generate().publicKey;
    const data = buildRiskReceiptAccountData({
      actor,
      appIdHashHex: appIdHash(externalAppId),
      termsDigest,
      acceptanceDigest,
      policyEpochDigest,
      scope: 3,
    });
    const chainReceiptPda = deriveRiskDisclaimerReceiptPda({
      programId,
      appIdHashHex: appIdHash(externalAppId),
      actor,
      scope: "developer_registration",
    }).toBase58();
    const connection = {
      getAccountInfo: jest.fn(async () => ({
        data,
        owner: Keypair.generate().publicKey,
      })),
      getSignatureStatuses: jest.fn(),
    };

    await expect(
      createRiskDisclaimerReceiptVerifier(
        {
          mode: "required",
          programId: programId.toBase58(),
          rpcUrl: "http://127.0.0.1:8899",
        },
        { connection: connection as never },
      ).verifyRiskDisclaimerReceipt({
        externalAppId,
        actorPubkey: actor.toBase58(),
        scope: "developer_registration",
        termsDigest: `sha256:${termsDigest}`,
        acceptanceDigest: `sha256:${acceptanceDigest}`,
        chainReceiptPda,
        chainReceiptDigest: computeRiskDisclaimerReceiptDataDigest(data),
        txSignature: "tx-1",
      }),
    ).rejects.toThrow("external_app_risk_receipt_owner_mismatch");
    expect(connection.getSignatureStatuses).not.toHaveBeenCalled();
  });

  it("rejects receipt transactions that are not confirmed or finalized", async () => {
    const actor = Keypair.generate().publicKey;
    const data = buildRiskReceiptAccountData({
      actor,
      appIdHashHex: appIdHash(externalAppId),
      termsDigest,
      acceptanceDigest,
      policyEpochDigest,
      scope: 3,
    });
    const chainReceiptPda = deriveRiskDisclaimerReceiptPda({
      programId,
      appIdHashHex: appIdHash(externalAppId),
      actor,
      scope: "developer_registration",
    }).toBase58();
    const connection = {
      getAccountInfo: jest.fn(async () => ({ data, owner: programId })),
      getSignatureStatuses: jest.fn(async () => ({
        value: [{ err: null, confirmationStatus: "processed" }],
      })),
    };

    await expect(
      createRiskDisclaimerReceiptVerifier(
        {
          mode: "required",
          programId: programId.toBase58(),
          rpcUrl: "http://127.0.0.1:8899",
        },
        { connection: connection as never },
      ).verifyRiskDisclaimerReceipt({
        externalAppId,
        actorPubkey: actor.toBase58(),
        scope: "developer_registration",
        termsDigest: `sha256:${termsDigest}`,
        acceptanceDigest: `sha256:${acceptanceDigest}`,
        chainReceiptPda,
        chainReceiptDigest: computeRiskDisclaimerReceiptDataDigest(data),
        txSignature: "tx-1",
      }),
    ).rejects.toThrow("external_app_risk_receipt_tx_not_confirmed");
  });
});

function buildRiskReceiptAccountData(input: {
  actor: PublicKey;
  appIdHashHex: string;
  termsDigest: string;
  acceptanceDigest: string;
  policyEpochDigest: string;
  scope: number;
}): Buffer {
  const buffer = Buffer.alloc(180);
  anchorAccountDiscriminator("ExternalAppRiskDisclaimerReceipt").copy(buffer, 0);
  buffer.writeUInt8(1, 8);
  buffer.writeUInt16LE(1, 9);
  Buffer.from(input.appIdHashHex, "hex").copy(buffer, 11);
  input.actor.toBuffer().copy(buffer, 43);
  buffer.writeUInt8(input.scope, 75);
  Buffer.from(input.termsDigest, "hex").copy(buffer, 76);
  Buffer.from(input.acceptanceDigest, "hex").copy(buffer, 108);
  Buffer.from(input.policyEpochDigest, "hex").copy(buffer, 140);
  buffer.writeBigInt64LE(123n, 172);
  expect(decodeRiskDisclaimerReceiptAccount(buffer)).toMatchObject({
    actorPubkey: input.actor.toBase58(),
    scope: input.scope,
    termsDigest: input.termsDigest,
    acceptanceDigest: input.acceptanceDigest,
  });
  return buffer;
}
