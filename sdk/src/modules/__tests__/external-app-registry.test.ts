import { Keypair, PublicKey, SystemProgram } from "@solana/web3.js";
import {
  buildAnchorExecutionReceiptInstruction,
  buildAnchorExternalAppRegistrationInstruction,
  deriveExternalAppRecordPda,
  deriveExternalAppRegistryConfigPda,
  ExternalAppRegistryModule,
  hex32ToBytes,
  normalizeExternalAppRegistryStatus,
} from "../external-app-registry";

describe("external app registry protocol SDK", () => {
  const programId = new PublicKey("FT4n9xkfEafYP2MSmqwur3xCeu361Vzrfpz8XNmaAG7J");
  const governanceAuthority = Keypair.generate().publicKey;
  const eventProgram = Keypair.generate().publicKey;
  const eventEmitter = Keypair.generate().publicKey;
  const eventBatch = Keypair.generate().publicKey;

  it("derives registry and record PDAs from V2 seeds", () => {
    const appIdHash = "01".repeat(32);

    const configPda = deriveExternalAppRegistryConfigPda(programId);
    const recordPda = deriveExternalAppRecordPda(programId, appIdHash);

    expect(configPda).toBeInstanceOf(PublicKey);
    expect(recordPda).toBeInstanceOf(PublicKey);
    expect(recordPda.toBase58()).not.toEqual(configPda.toBase58());
  });

  it("normalizes 32-byte hex digests and registry statuses", () => {
    expect(hex32ToBytes(`0x${"0a".repeat(32)}`)).toEqual(new Array(32).fill(10));
    expect(normalizeExternalAppRegistryStatus("ACTIVE")).toBe("active");
    expect(() => hex32ToBytes("0a")).toThrow("invalid_external_app_registry_hashHex");
    expect(() => normalizeExternalAppRegistryStatus("paused")).toThrow(
      "invalid_external_app_registry_status",
    );
  });

  it("builds anchor_external_app_registration with deterministic accounts and data", () => {
    const instruction = buildAnchorExternalAppRegistrationInstruction({
      programId,
      governanceAuthority,
      eventProgram,
      eventEmitter,
      eventBatch,
      appIdHash: "01".repeat(32),
      owner: Keypair.generate().publicKey,
      serverKeyHash: "02".repeat(32),
      manifestHash: "03".repeat(32),
      ownerAssertionHash: "04".repeat(32),
      policyStateDigest: "05".repeat(32),
      reviewCircleId: 7,
      reviewPolicyDigest: "06".repeat(32),
      decisionDigest: "07".repeat(32),
      executionIntentDigest: "08".repeat(32),
      expiresAt: 1_800_000_000,
    });

    expect(instruction.programId.toBase58()).toEqual(programId.toBase58());
    expect(Array.from(instruction.data.slice(0, 8))).toEqual([
      64, 25, 118, 38, 185, 208, 96, 85,
    ]);
    expect(instruction.data.length).toBe(308);
    expect(instruction.keys).toHaveLength(7);
    expect(instruction.keys[0]).toMatchObject({
      isSigner: false,
      isWritable: true,
    });
    expect(instruction.keys[1].pubkey.toBase58()).toEqual(
      deriveExternalAppRecordPda(programId, "01".repeat(32)).toBase58(),
    );
    expect(instruction.keys[2]).toMatchObject({
      pubkey: governanceAuthority,
      isSigner: true,
      isWritable: true,
    });
    expect(instruction.keys[6]).toMatchObject({
      pubkey: SystemProgram.programId,
      isSigner: false,
      isWritable: false,
    });
  });

  it("builds anchor_execution_receipt separately from registration", () => {
    const instruction = buildAnchorExecutionReceiptInstruction({
      programId,
      governanceAuthority,
      eventProgram,
      eventEmitter,
      eventBatch,
      appIdHash: new Uint8Array(32).fill(9),
      executionReceiptDigest: new Uint8Array(32).fill(10),
    });

    expect(Array.from(instruction.data.slice(0, 8))).toEqual([
      237, 244, 188, 182, 154, 107, 167, 19,
    ]);
    expect(instruction.data.length).toBe(72);
  });

  it("exposes a lightweight module without coupling runtime browser imports", () => {
    const module = new ExternalAppRegistryModule(programId);

    expect(module.deriveRegistryConfigPda().toBase58()).toEqual(
      deriveExternalAppRegistryConfigPda(programId).toBase58(),
    );
    expect(module.deriveRecordPda("01".repeat(32)).toBase58()).toEqual(
      deriveExternalAppRecordPda(programId, "01".repeat(32)).toBase58(),
    );
  });
});
