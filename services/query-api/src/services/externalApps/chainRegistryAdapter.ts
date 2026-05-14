import fs from "node:fs";
import path from "node:path";

import { AnchorProvider, BN, Program, Wallet, type Idl } from "@coral-xyz/anchor";
import {
  Connection,
  Keypair,
  PublicKey,
  SystemProgram,
} from "@solana/web3.js";

import { normalizeHash32Hex } from "./chainRegistryDigest";

export type ExternalAppRegistryMode = "disabled" | "optional" | "required";

export interface ExternalAppRegistryAdapterConfig {
  mode?: ExternalAppRegistryMode;
  programId?: string;
  rpcUrl?: string;
  eventProgramId?: string;
  idlPath?: string;
  authorityKeypairPath?: string;
  authoritySignerUrl?: string;
  authoritySignerToken?: string;
  nodeEnv?: string;
  cluster?: string;
}

export interface ExternalAppChainRegistrationPayload {
  externalAppId: string;
  appIdHash: string;
  ownerPubkey: string;
  serverKeyHash: string;
  manifestHashHex: string;
  ownerAssertionHash: string;
  policyStateDigest: string;
  reviewCircleId: number;
  reviewPolicyDigest: string;
  decisionDigest: string;
  executionIntentDigest: string;
  expiresAt?: Date | string | number | null;
}

export interface ExternalAppChainReceiptPayload {
  externalAppId: string;
  appIdHash: string;
  executionReceiptDigest: string;
}

export interface ExternalAppRegistrySubmitResult {
  txSignature: string;
  recordPda: string;
}

export interface ExternalAppRegistrySubmitter {
  anchorExternalAppRegistration(
    input: ExternalAppChainRegistrationPayload,
  ): Promise<ExternalAppRegistrySubmitResult>;
  anchorExecutionReceipt(
    input: ExternalAppChainReceiptPayload,
  ): Promise<ExternalAppRegistrySubmitResult>;
}

export interface ExternalAppRegistryEvidence {
  mode: ExternalAppRegistryMode;
  status: "skipped" | "submitted";
  reason?: string;
  txSignature?: string;
  recordPda?: string;
  cluster?: string;
}

export function loadExternalAppRegistryConfigFromEnv(
  env: NodeJS.ProcessEnv = process.env,
): ExternalAppRegistryAdapterConfig {
  return {
    mode: parseExternalAppRegistryMode(env.EXTERNAL_APP_REGISTRY_MODE),
    programId:
      env.EXTERNAL_APP_REGISTRY_PROGRAM_ID ||
      env.NEXT_PUBLIC_EXTERNAL_APP_REGISTRY_PROGRAM_ID,
    rpcUrl: env.SOLANA_RPC_URL || env.RPC_URL || env.NEXT_PUBLIC_SOLANA_RPC_URL,
    eventProgramId: env.EVENT_EMITTER_PROGRAM_ID || env.NEXT_PUBLIC_EVENT_PROGRAM_ID,
    idlPath: env.EXTERNAL_APP_REGISTRY_IDL_PATH,
    authorityKeypairPath: env.EXTERNAL_APP_REGISTRY_AUTHORITY_KEYPAIR_PATH,
    authoritySignerUrl: env.EXTERNAL_APP_REGISTRY_AUTHORITY_SIGNER_URL,
    authoritySignerToken: env.EXTERNAL_APP_REGISTRY_AUTHORITY_SIGNER_TOKEN,
    nodeEnv: env.NODE_ENV,
    cluster: env.SOLANA_CLUSTER || env.CLUSTER,
  };
}

export function parseExternalAppRegistryMode(
  raw: string | undefined,
): ExternalAppRegistryMode {
  if (raw === "optional" || raw === "required") return raw;
  return "disabled";
}

export function createExternalAppRegistryAdapter(
  config: ExternalAppRegistryAdapterConfig = loadExternalAppRegistryConfigFromEnv(),
  deps: { submitter?: ExternalAppRegistrySubmitter } = {},
) {
  const normalizedConfig = {
    ...config,
    mode: config.mode ?? "disabled",
  };

  async function submit<TInput>(
    kind: "registration" | "receipt",
    input: TInput,
    submitWithInjected: (submitter: ExternalAppRegistrySubmitter) => Promise<ExternalAppRegistrySubmitResult>,
    submitWithLocal: (submitter: ExternalAppRegistrySubmitter) => Promise<ExternalAppRegistrySubmitResult>,
  ): Promise<ExternalAppRegistryEvidence> {
    if (normalizedConfig.mode === "disabled") {
      return skipped("registry_mode_disabled", normalizedConfig);
    }

    const configError = validateConfig(normalizedConfig, Boolean(deps.submitter));
    if (configError) {
      if (normalizedConfig.mode === "optional") {
        return skipped(configError, normalizedConfig);
      }
      throw new Error(configError);
    }

    try {
      const result = deps.submitter
        ? await submitWithInjected(deps.submitter)
        : normalizedConfig.authoritySignerUrl
          ? await submitWithSignerUrl(normalizedConfig, kind, input)
          : await submitWithLocal(new LocalAnchorExternalAppRegistrySubmitter(normalizedConfig));
      return {
        mode: normalizedConfig.mode,
        status: "submitted",
        txSignature: result.txSignature,
        recordPda: result.recordPda,
        cluster: normalizedConfig.cluster,
      };
    } catch (error) {
      const reason = (error as Error).message || "external_app_registry_submit_failed";
      if (normalizedConfig.mode === "optional") {
        return skipped(reason, normalizedConfig);
      }
      throw error;
    }
  }

  return {
    anchorExternalAppRegistration(input: ExternalAppChainRegistrationPayload) {
      validateRegistrationPayload(input);
      return submit(
        "registration",
        input,
        (submitter) => submitter.anchorExternalAppRegistration(input),
        (submitter) => submitter.anchorExternalAppRegistration(input),
      );
    },
    anchorExecutionReceipt(input: ExternalAppChainReceiptPayload) {
      normalizeHash32Hex(input.appIdHash, "external_app_registry_app_id_hash");
      normalizeHash32Hex(
        input.executionReceiptDigest,
        "external_app_registry_execution_receipt_digest",
      );
      return submit(
        "receipt",
        input,
        (submitter) => submitter.anchorExecutionReceipt(input),
        (submitter) => submitter.anchorExecutionReceipt(input),
      );
    },
  };
}

export type ExternalAppRegistryAdapter = ReturnType<
  typeof createExternalAppRegistryAdapter
>;

function validateConfig(
  config: Required<Pick<ExternalAppRegistryAdapterConfig, "mode">> &
    ExternalAppRegistryAdapterConfig,
  hasInjectedSubmitter: boolean,
): string | null {
  if (!config.programId) return "external_app_registry_program_id_required";
  if (!config.rpcUrl) return "external_app_registry_rpc_url_required";
  if (!config.eventProgramId) return "external_app_registry_event_program_id_required";
  if (!hasInjectedSubmitter && !config.authorityKeypairPath && !config.authoritySignerUrl) {
    return "external_app_registry_authority_required";
  }
  if (
    config.mode === "required" &&
    config.nodeEnv === "production" &&
    config.authorityKeypairPath &&
    !config.authoritySignerUrl
  ) {
    return "external_app_registry_local_keypair_not_allowed_in_production_required_mode";
  }
  return null;
}

function skipped(
  reason: string,
  config: Required<Pick<ExternalAppRegistryAdapterConfig, "mode">> &
    ExternalAppRegistryAdapterConfig,
): ExternalAppRegistryEvidence {
  return {
    mode: config.mode,
    status: "skipped",
    reason,
    cluster: config.cluster,
  };
}

function validateRegistrationPayload(input: ExternalAppChainRegistrationPayload): void {
  normalizeHash32Hex(input.appIdHash, "external_app_registry_app_id_hash");
  normalizeHash32Hex(input.serverKeyHash, "external_app_registry_server_key_hash");
  normalizeHash32Hex(input.manifestHashHex, "external_app_registry_manifest_hash");
  normalizeHash32Hex(
    input.ownerAssertionHash,
    "external_app_registry_owner_assertion_hash",
  );
  normalizeHash32Hex(input.policyStateDigest, "external_app_registry_policy_state_digest");
  normalizeHash32Hex(input.reviewPolicyDigest, "external_app_registry_review_policy_digest");
  normalizeHash32Hex(input.decisionDigest, "external_app_registry_decision_digest");
  normalizeHash32Hex(
    input.executionIntentDigest,
    "external_app_registry_execution_intent_digest",
  );
  if (!Number.isSafeInteger(input.reviewCircleId) || input.reviewCircleId < 0) {
    throw new Error("invalid_external_app_registry_review_circle_id");
  }
  new PublicKey(input.ownerPubkey);
}

async function submitWithSignerUrl<TInput>(
  config: ExternalAppRegistryAdapterConfig,
  kind: "registration" | "receipt",
  input: TInput,
): Promise<ExternalAppRegistrySubmitResult> {
  if (!config.authoritySignerUrl) {
    throw new Error("external_app_registry_authority_signer_url_required");
  }
  const response = await fetch(config.authoritySignerUrl, {
    method: "POST",
    headers: {
      "content-type": "application/json",
      ...(config.authoritySignerToken
        ? { authorization: `Bearer ${config.authoritySignerToken}` }
        : {}),
    },
    body: JSON.stringify({
      kind,
      programId: config.programId,
      eventProgramId: config.eventProgramId,
      input,
    }),
  });
  if (!response.ok) {
    throw new Error(`external_app_registry_signer_failed:${response.status}`);
  }
  const parsed = (await response.json()) as Partial<ExternalAppRegistrySubmitResult>;
  if (!parsed.txSignature || !parsed.recordPda) {
    throw new Error("external_app_registry_signer_invalid_response");
  }
  return {
    txSignature: parsed.txSignature,
    recordPda: parsed.recordPda,
  };
}

class LocalAnchorExternalAppRegistrySubmitter implements ExternalAppRegistrySubmitter {
  private readonly config: ExternalAppRegistryAdapterConfig;
  private readonly connection: Connection;
  private readonly authority: Keypair;
  private readonly program: Program<Idl>;
  private readonly eventProgramId: PublicKey;

  constructor(config: ExternalAppRegistryAdapterConfig) {
    this.config = config;
    this.connection = new Connection(required(config.rpcUrl, "external_app_registry_rpc_url_required"), "confirmed");
    this.authority = Keypair.fromSecretKey(
      Uint8Array.from(JSON.parse(fs.readFileSync(required(config.authorityKeypairPath, "external_app_registry_authority_keypair_path_required"), "utf8"))),
    );
    this.eventProgramId = new PublicKey(
      required(config.eventProgramId, "external_app_registry_event_program_id_required"),
    );
    const wallet = new Wallet(this.authority);
    const provider = new AnchorProvider(this.connection, wallet, {
      commitment: "confirmed",
    });
    const programId = new PublicKey(
      required(config.programId, "external_app_registry_program_id_required"),
    );
    this.program = new Program(loadExternalAppRegistryIdl(config), provider);
    if (!this.program.programId.equals(programId)) {
      throw new Error("external_app_registry_idl_program_id_mismatch");
    }
  }

  async anchorExternalAppRegistration(
    input: ExternalAppChainRegistrationPayload,
  ): Promise<ExternalAppRegistrySubmitResult> {
    const appIdHashBytes = hex32ToNumberArray(input.appIdHash);
    const recordPda = this.findExternalAppRecordPda(appIdHashBytes);
    const eventAccounts = await this.resolveEventAccounts();
    const signature = await (this.program.methods as any)
      .anchorExternalAppRegistration(
        appIdHashBytes,
        new PublicKey(input.ownerPubkey),
        hex32ToNumberArray(input.serverKeyHash),
        hex32ToNumberArray(input.manifestHashHex),
        hex32ToNumberArray(input.ownerAssertionHash),
        hex32ToNumberArray(input.policyStateDigest),
        input.reviewCircleId,
        hex32ToNumberArray(input.reviewPolicyDigest),
        hex32ToNumberArray(input.decisionDigest),
        hex32ToNumberArray(input.executionIntentDigest),
        new BN(toUnixSeconds(input.expiresAt)),
      )
      .accounts({
        registryConfig: this.findRegistryConfigPda(),
        externalAppRecord: recordPda,
        governanceAuthority: this.authority.publicKey,
        eventProgram: eventAccounts.eventProgram,
        eventEmitter: eventAccounts.eventEmitter,
        eventBatch: eventAccounts.eventBatch,
        systemProgram: SystemProgram.programId,
      })
      .signers([this.authority])
      .rpc();
    return {
      txSignature: signature,
      recordPda: recordPda.toBase58(),
    };
  }

  async anchorExecutionReceipt(
    input: ExternalAppChainReceiptPayload,
  ): Promise<ExternalAppRegistrySubmitResult> {
    const appIdHashBytes = hex32ToNumberArray(input.appIdHash);
    const recordPda = this.findExternalAppRecordPda(appIdHashBytes);
    const eventAccounts = await this.resolveEventAccounts();
    const signature = await (this.program.methods as any)
      .anchorExecutionReceipt(
        appIdHashBytes,
        hex32ToNumberArray(input.executionReceiptDigest),
      )
      .accounts({
        registryConfig: this.findRegistryConfigPda(),
        externalAppRecord: recordPda,
        governanceAuthority: this.authority.publicKey,
        eventProgram: eventAccounts.eventProgram,
        eventEmitter: eventAccounts.eventEmitter,
        eventBatch: eventAccounts.eventBatch,
        systemProgram: SystemProgram.programId,
      })
      .signers([this.authority])
      .rpc();
    return {
      txSignature: signature,
      recordPda: recordPda.toBase58(),
    };
  }

  private findRegistryConfigPda(): PublicKey {
    return PublicKey.findProgramAddressSync(
      [Buffer.from("external_app_registry")],
      this.program.programId,
    )[0];
  }

  private findExternalAppRecordPda(appIdHashBytes: number[]): PublicKey {
    return PublicKey.findProgramAddressSync(
      [Buffer.from("external_app"), Buffer.from(appIdHashBytes)],
      this.program.programId,
    )[0];
  }

  private async resolveEventAccounts(): Promise<{
    eventProgram: PublicKey;
    eventEmitter: PublicKey;
    eventBatch: PublicKey;
  }> {
    const [eventEmitter] = PublicKey.findProgramAddressSync(
      [Buffer.from("event_emitter")],
      this.eventProgramId,
    );
    const eventEmitterInfo = await this.connection.getAccountInfo(eventEmitter);
    if (!eventEmitterInfo) {
      throw new Error("external_app_registry_event_emitter_not_initialized");
    }
    const eventSequence = readEventSequence(eventEmitterInfo.data);
    const [eventBatch] = PublicKey.findProgramAddressSync(
      [Buffer.from("event_batch"), u64Le(eventSequence)],
      this.eventProgramId,
    );
    return {
      eventProgram: this.eventProgramId,
      eventEmitter,
      eventBatch,
    };
  }
}

function loadExternalAppRegistryIdl(config: ExternalAppRegistryAdapterConfig): Idl {
  const programId = required(config.programId, "external_app_registry_program_id_required");
  const idlPath = config.idlPath || defaultExternalAppRegistryIdlPath();
  if (!fs.existsSync(idlPath)) {
    throw new Error("external_app_registry_idl_not_found");
  }
  return {
    ...(JSON.parse(fs.readFileSync(idlPath, "utf8")) as Record<string, unknown>),
    address: programId,
  } as Idl;
}

function defaultExternalAppRegistryIdlPath(): string {
  return path.resolve(__dirname, "../../../../../target/idl/external_app_registry.json");
}

function required(value: string | undefined, errorCode: string): string {
  if (!value) throw new Error(errorCode);
  return value;
}

function hex32ToNumberArray(hashHex: string): number[] {
  const normalized = normalizeHash32Hex(hashHex, "external_app_registry_hash");
  const bytes: number[] = [];
  for (let index = 0; index < normalized.length; index += 2) {
    bytes.push(Number.parseInt(normalized.slice(index, index + 2), 16));
  }
  return bytes;
}

function toUnixSeconds(value: Date | string | number | null | undefined): number {
  if (value === undefined || value === null) return 0;
  if (typeof value === "number") return Math.floor(value);
  if (value instanceof Date) return Math.floor(value.getTime() / 1000);
  return Math.floor(new Date(value).getTime() / 1000);
}

function u64Le(value: bigint): Buffer {
  const output = Buffer.alloc(8);
  output.writeBigUInt64LE(value);
  return output;
}

function readEventSequence(data: Buffer): bigint {
  const offset = 8 + 1 + 32 + 8;
  if (data.length < offset + 8) {
    throw new Error("external_app_registry_event_emitter_invalid_data");
  }
  return data.readBigUInt64LE(offset);
}
