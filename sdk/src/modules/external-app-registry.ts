import { BN } from "@coral-xyz/anchor";
import {
  PublicKey,
  SystemProgram,
  TransactionInstruction,
} from "@solana/web3.js";
import { sha256 } from "js-sha256";
import * as externalAppRegistryIdl from "../idl/external_app_registry.json";

export { externalAppRegistryIdl };

export type ExternalAppRegistryStatus =
  | "pending"
  | "active"
  | "suspended"
  | "revoked";

export interface ExternalAppRegistryAccountInputs {
  programId: PublicKey | string;
  governanceAuthority: PublicKey | string;
  eventProgram: PublicKey | string;
  eventEmitter: PublicKey | string;
  eventBatch: PublicKey | string;
  systemProgram?: PublicKey | string;
}

export interface ExternalAppRegistryInstructionInput
  extends ExternalAppRegistryAccountInputs {
  appIdHash: Uint8Array | number[] | string;
  owner: PublicKey | string;
  serverKeyHash: Uint8Array | number[] | string;
  manifestHash: Uint8Array | number[] | string;
  ownerAssertionHash: Uint8Array | number[] | string;
  policyStateDigest: Uint8Array | number[] | string;
  reviewCircleId: number;
  reviewPolicyDigest: Uint8Array | number[] | string;
  decisionDigest: Uint8Array | number[] | string;
  executionIntentDigest: Uint8Array | number[] | string;
  expiresAt?: Date | string | number | bigint | BN | null;
}

export interface ExternalAppRegistryReceiptInstructionInput
  extends ExternalAppRegistryAccountInputs {
  appIdHash: Uint8Array | number[] | string;
  executionReceiptDigest: Uint8Array | number[] | string;
}

export function deriveExternalAppRegistryConfigPda(
  programId: PublicKey | string,
): PublicKey {
  return PublicKey.findProgramAddressSync(
    [Buffer.from("external_app_registry")],
    asPublicKey(programId),
  )[0];
}

export function deriveExternalAppRecordPda(
  programId: PublicKey | string,
  appIdHash: Uint8Array | number[] | string,
): PublicKey {
  return PublicKey.findProgramAddressSync(
    [Buffer.from("external_app"), Buffer.from(hash32ToBytes(appIdHash, "appIdHash"))],
    asPublicKey(programId),
  )[0];
}

export function hex32ToBytes(hashHex: string): number[] {
  return hash32ToBytes(hashHex, "hashHex");
}

export function normalizeExternalAppRegistryStatus(
  value: string,
): ExternalAppRegistryStatus {
  const normalized = value.trim().toLowerCase();
  if (
    normalized === "pending" ||
    normalized === "active" ||
    normalized === "suspended" ||
    normalized === "revoked"
  ) {
    return normalized;
  }
  throw new Error("invalid_external_app_registry_status");
}

export function buildAnchorExternalAppRegistrationInstruction(
  input: ExternalAppRegistryInstructionInput,
): TransactionInstruction {
  const programId = asPublicKey(input.programId);
  const appIdHash = hash32ToBytes(input.appIdHash, "appIdHash");
  const data = Buffer.concat([
    instructionDiscriminator("anchor_external_app_registration"),
    Buffer.from(appIdHash),
    asPublicKey(input.owner).toBuffer(),
    Buffer.from(hash32ToBytes(input.serverKeyHash, "serverKeyHash")),
    Buffer.from(hash32ToBytes(input.manifestHash, "manifestHash")),
    Buffer.from(hash32ToBytes(input.ownerAssertionHash, "ownerAssertionHash")),
    Buffer.from(hash32ToBytes(input.policyStateDigest, "policyStateDigest")),
    u32Le(input.reviewCircleId, "reviewCircleId"),
    Buffer.from(hash32ToBytes(input.reviewPolicyDigest, "reviewPolicyDigest")),
    Buffer.from(hash32ToBytes(input.decisionDigest, "decisionDigest")),
    Buffer.from(hash32ToBytes(input.executionIntentDigest, "executionIntentDigest")),
    i64Le(toUnixSeconds(input.expiresAt)),
  ]);

  return new TransactionInstruction({
    programId,
    keys: externalAppRegistryAccountMetas(input, appIdHash),
    data,
  });
}

export function buildAnchorExecutionReceiptInstruction(
  input: ExternalAppRegistryReceiptInstructionInput,
): TransactionInstruction {
  const programId = asPublicKey(input.programId);
  const appIdHash = hash32ToBytes(input.appIdHash, "appIdHash");
  const data = Buffer.concat([
    instructionDiscriminator("anchor_execution_receipt"),
    Buffer.from(appIdHash),
    Buffer.from(hash32ToBytes(input.executionReceiptDigest, "executionReceiptDigest")),
  ]);

  return new TransactionInstruction({
    programId,
    keys: externalAppRegistryAccountMetas(input, appIdHash),
    data,
  });
}

export class ExternalAppRegistryModule {
  constructor(public readonly programId: PublicKey) {}

  deriveRegistryConfigPda(): PublicKey {
    return deriveExternalAppRegistryConfigPda(this.programId);
  }

  deriveRecordPda(appIdHash: Uint8Array | number[] | string): PublicKey {
    return deriveExternalAppRecordPda(this.programId, appIdHash);
  }

  buildAnchorExternalAppRegistrationInstruction(
    input: Omit<ExternalAppRegistryInstructionInput, "programId">,
  ): TransactionInstruction {
    return buildAnchorExternalAppRegistrationInstruction({
      ...input,
      programId: this.programId,
    });
  }

  buildAnchorExecutionReceiptInstruction(
    input: Omit<ExternalAppRegistryReceiptInstructionInput, "programId">,
  ): TransactionInstruction {
    return buildAnchorExecutionReceiptInstruction({
      ...input,
      programId: this.programId,
    });
  }
}

function externalAppRegistryAccountMetas(
  input: ExternalAppRegistryAccountInputs,
  appIdHash: number[],
) {
  const programId = asPublicKey(input.programId);
  return [
    {
      pubkey: deriveExternalAppRegistryConfigPda(programId),
      isSigner: false,
      isWritable: true,
    },
    {
      pubkey: deriveExternalAppRecordPda(programId, appIdHash),
      isSigner: false,
      isWritable: true,
    },
    {
      pubkey: asPublicKey(input.governanceAuthority),
      isSigner: true,
      isWritable: true,
    },
    {
      pubkey: asPublicKey(input.eventProgram),
      isSigner: false,
      isWritable: false,
    },
    {
      pubkey: asPublicKey(input.eventEmitter),
      isSigner: false,
      isWritable: true,
    },
    {
      pubkey: asPublicKey(input.eventBatch),
      isSigner: false,
      isWritable: true,
    },
    {
      pubkey: input.systemProgram
        ? asPublicKey(input.systemProgram)
        : SystemProgram.programId,
      isSigner: false,
      isWritable: false,
    },
  ];
}

function hash32ToBytes(
  value: Uint8Array | number[] | string,
  fieldName: string,
): number[] {
  if (typeof value === "string") {
    const normalized = value.startsWith("0x") ? value.slice(2) : value;
    if (!/^[0-9a-fA-F]{64}$/.test(normalized)) {
      throw new Error(`invalid_external_app_registry_${fieldName}`);
    }
    const bytes: number[] = [];
    for (let index = 0; index < normalized.length; index += 2) {
      bytes.push(Number.parseInt(normalized.slice(index, index + 2), 16));
    }
    return bytes;
  }

  const bytes = Array.from(value);
  if (bytes.length !== 32 || bytes.some((byte) => !Number.isInteger(byte) || byte < 0 || byte > 255)) {
    throw new Error(`invalid_external_app_registry_${fieldName}`);
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

function u32Le(value: number, fieldName: string): Buffer {
  if (!Number.isSafeInteger(value) || value < 0 || value > 0xffffffff) {
    throw new Error(`invalid_external_app_registry_${fieldName}`);
  }
  const output = Buffer.alloc(4);
  output.writeUInt32LE(value);
  return output;
}

function i64Le(value: bigint): Buffer {
  const output = Buffer.alloc(8);
  output.writeBigInt64LE(value);
  return output;
}

function toUnixSeconds(value: Date | string | number | bigint | BN | null | undefined): bigint {
  if (value === undefined || value === null) return 0n;
  if (typeof value === "bigint") return value;
  if (typeof value === "number") return BigInt(Math.floor(value));
  if (BN.isBN(value)) return BigInt(value.toString());
  if (value instanceof Date) return BigInt(Math.floor(value.getTime() / 1000));
  return BigInt(Math.floor(new Date(value).getTime() / 1000));
}
