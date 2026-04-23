// @ts-nocheck
import { Connection, Keypair, LAMPORTS_PER_SOL, PublicKey, SystemProgram } from "@solana/web3.js";
import { BN, Wallet } from "@coral-xyz/anchor";
import fs from "fs";
import os from "os";
import path from "path";
import { Alcheme } from "../../sdk/src/alcheme";

export const DEFAULT_PERCENTILE = 95;
export const DEFAULT_SAMPLE_COUNT = 20;
export const FAILED_SAMPLE_LAMPORTS = Number.MAX_SAFE_INTEGER;
export const LOCAL_RPC_URL = "http://127.0.0.1:8899";
export const MEASUREMENT_IDENTITY_REGISTRY_NAME = "social_hub_identity";

export interface CostSnapshot {
  tx_fee: number;
  rent_delta: number;
  event_delta: number;
  total: number;
}

export interface CostSample extends CostSnapshot {
  index: number;
  signature: string | null;
  error: string | null;
}

export interface LocalnetConfig {
  network: string;
  programIds: {
    identity: string;
    content: string;
    access: string;
    event: string;
    factory: string;
    messaging?: string;
    circles?: string;
    contributionEngine?: string;
  };
}

export interface V2CostResult extends CostSnapshot {
  percentile: number;
  sample_count: number;
  successful_samples: number;
  failed_samples: number;
  observed_samples: number;
  threshold_lamports?: number;
  method: string;
  measurement_mode: "onchain_sampling";
  timestamp: string;
  errors: string[];
  sample_errors: string[];
  sample_signatures: string[];
}

export function projectRoot(): string {
  return path.resolve(__dirname, "..", "..");
}

export function loadLocalnetConfig(): LocalnetConfig {
  const configPath = path.join(projectRoot(), "sdk", "localnet-config.json");
  const raw = fs.readFileSync(configPath, "utf8");
  return JSON.parse(raw) as LocalnetConfig;
}

export function failedSnapshot(): CostSnapshot {
  return {
    tx_fee: FAILED_SAMPLE_LAMPORTS,
    rent_delta: FAILED_SAMPLE_LAMPORTS,
    event_delta: FAILED_SAMPLE_LAMPORTS,
    total: FAILED_SAMPLE_LAMPORTS,
  };
}

export function buildSampleContentId(index: number, attempt: number, salt = 0): number {
  const nowPart = Date.now() % 1_000_000_000;
  const randomPart = Math.floor(Math.random() * 1_000_000);
  const candidate = nowPart * 1_000_000 + randomPart + index * 31 + attempt + salt;
  return Math.max(1, candidate);
}

export function readEventSequenceFromAccountData(data: Buffer): number {
  const minSize = 8 + 1 + 32 + 8 + 8;
  const offset = 8 + 1 + 32 + 8;
  if (data.length < minSize) {
    throw new Error("event_emitter account data too small");
  }
  return Number(data.readBigUInt64LE(offset));
}

export function percentileValue(values: number[], percentile: number): number {
  if (values.length === 0) {
    return FAILED_SAMPLE_LAMPORTS;
  }
  const sorted = [...values].sort((a, b) => a - b);
  const index = Math.min(sorted.length - 1, Math.max(0, Math.ceil((percentile / 100) * sorted.length) - 1));
  return sorted[index];
}

export function unique(values: string[]): string[] {
  return [...new Set(values)];
}

export function loadDefaultWallet(): Keypair {
  const walletPath = path.join(os.homedir(), ".config", "solana", "id.json");
  const raw = fs.readFileSync(walletPath, "utf8");
  const secret = Uint8Array.from(JSON.parse(raw));
  return Keypair.fromSecretKey(secret);
}

async function requestAndConfirmAirdrop(
  connection: Connection,
  pubkey: PublicKey,
  lamports: number,
): Promise<void> {
  const signature = await connection.requestAirdrop(pubkey, lamports);
  const latest = await connection.getLatestBlockhash("confirmed");
  await connection.confirmTransaction(
    {
      signature,
      blockhash: latest.blockhash,
      lastValidBlockHeight: latest.lastValidBlockHeight,
    },
    "confirmed",
  );
}

export function buildMeasurementHandle(): string {
  const nowPart = Date.now().toString(36);
  const randomPart = Math.floor(Math.random() * 0xffff)
    .toString(36)
    .padStart(3, "0");
  return `cost${nowPart}${randomPart}`.slice(0, 24);
}

export async function ensureAuthorIdentity(
  sdk: Alcheme,
  handle: string,
  connection?: Connection,
): Promise<void> {
  const signature = await sdk.identity.registerIdentity(handle, handle);
  if (connection) {
    await confirmSignature(connection, signature);
  }
}

function measurementIdentityRegistrySettings() {
  return {
    allowHandleTransfers: true,
    requireVerification: false,
    enableReputationSystem: true,
    enableSocialFeatures: true,
    enableEconomicTracking: true,
    maxHandlesPerIdentity: new BN(5),
    handleReservationPeriod: new BN(86400 * 30),
    minimumHandleLength: new BN(3),
    maximumHandleLength: new BN(32),
  };
}

function measurementEventStorageConfig() {
  return {
    chainStorageLimit: 1000,
    archiveToArweave: true,
    useCompression: true,
    batchSize: 50,
    autoArchiveAfterDays: 30,
    maxEventSize: 1024,
  };
}

function measurementEventRetentionPolicy() {
  return {
    chainRetentionDays: 30,
    archiveRetentionDays: 365,
    autoCleanup: true,
    priorityRetention: [],
  };
}

function measurementContentManagerConfig() {
  return {
    maxContentSize: new BN(1024 * 1024 * 10),
    maxMediaAttachments: 5,
    defaultStorageStrategy: { hybrid: {} },
    autoModerationEnabled: true,
    threadDepthLimit: 10,
    quoteChainLimit: 5,
  };
}

function measurementContentStorageConfig() {
  return {
    textThreshold: new BN(1000),
    mediaThreshold: new BN(1024 * 1024),
    arweaveEnabled: true,
    ipfsEnabled: true,
    compressionEnabled: true,
    backupEnabled: true,
  };
}

function measurementContentModerationConfig() {
  return {
    autoModeration: true,
    spamDetection: true,
    contentFiltering: true,
    communityModeration: false,
    appealProcess: true,
  };
}

async function ensureOwnedAccount(params: {
  connection: Connection;
  name: string;
  address: PublicKey;
  owner: PublicKey;
  initialize: () => Promise<string>;
}): Promise<void> {
  const { connection, name, address, owner, initialize } = params;
  const existing = await connection.getAccountInfo(address, "confirmed");
  if (existing) {
    if (!existing.owner.equals(owner)) {
      throw new Error(
        `${name} account ${address.toBase58()} is owned by ${existing.owner.toBase58()}, expected ${owner.toBase58()}`,
      );
    }
    return;
  }

  try {
    const signature = await initialize();
    await confirmSignature(connection, signature);
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    if (!/already in use/i.test(message)) {
      throw error;
    }
  }

  const initialized = await connection.getAccountInfo(address, "confirmed");
  if (!initialized) {
    throw new Error(`${name} account ${address.toBase58()} was not initialized`);
  }
  if (!initialized.owner.equals(owner)) {
    throw new Error(
      `${name} account ${address.toBase58()} is owned by ${initialized.owner.toBase58()}, expected ${owner.toBase58()}`,
    );
  }
}

export async function ensureMeasurementProgramsInitialized(params: {
  connection: Connection;
  sdk: Alcheme;
}): Promise<void> {
  const { connection, sdk } = params;
  const identityRegistry = sdk.pda.findIdentityRegistryPda(MEASUREMENT_IDENTITY_REGISTRY_NAME);
  const accessController = sdk.pda.findAccessControllerPda();
  const eventEmitter = sdk.pda.findEventEmitterPda();
  const contentManager = sdk.pda.findContentManagerPda();

  await ensureOwnedAccount({
    connection,
    name: "event_emitter",
    address: eventEmitter,
    owner: sdk.event.programId,
    initialize: () =>
      (sdk.event.program.methods as any)
        .initializeEventEmitter(
          measurementEventStorageConfig(),
          measurementEventRetentionPolicy(),
        )
        .accounts({
          eventEmitter,
          admin: sdk.provider.publicKey,
          systemProgram: SystemProgram.programId,
        })
        .rpc(),
  });

  await ensureOwnedAccount({
    connection,
    name: "identity_registry",
    address: identityRegistry,
    owner: sdk.identity.programId,
    initialize: () =>
      (sdk.identity.program.methods as any)
        .initializeIdentityRegistry(
          MEASUREMENT_IDENTITY_REGISTRY_NAME,
          "https://socialhub.protocol/metadata",
          measurementIdentityRegistrySettings(),
        )
        .accounts({
          identityRegistry,
          admin: sdk.provider.publicKey,
          systemProgram: SystemProgram.programId,
        })
        .rpc(),
  });

  await ensureOwnedAccount({
    connection,
    name: "access_controller",
    address: accessController,
    owner: sdk.access.programId,
    initialize: () =>
      (sdk.access.program.methods as any)
        .initializeAccessController()
        .accounts({
          accessController,
          admin: sdk.provider.publicKey,
          systemProgram: SystemProgram.programId,
        })
        .rpc(),
  });

  await ensureOwnedAccount({
    connection,
    name: "content_manager",
    address: contentManager,
    owner: sdk.content.programId,
    initialize: () =>
      (sdk.content.program.methods as any)
        .initializeContentManager(
          measurementContentManagerConfig(),
          measurementContentStorageConfig(),
          measurementContentModerationConfig(),
        )
        .accounts({
          contentManager,
          admin: sdk.provider.publicKey,
          systemProgram: SystemProgram.programId,
        })
        .rpc(),
  });
}

export async function createMeasurementContext() {
  const connection = new Connection(LOCAL_RPC_URL, "confirmed");
  const author = Keypair.generate();
  const config = loadLocalnetConfig();
  await requestAndConfirmAirdrop(connection, author.publicKey, 50 * LAMPORTS_PER_SOL);
  const sdk = new Alcheme({
    connection,
    wallet: new Wallet(author),
    programIds: config.programIds,
  });
  sdk.content.setQueryApiBaseUrl("http://127.0.0.1:4000");
  await ensureMeasurementProgramsInitialized({ connection, sdk });
  return {
    connection,
    author,
    sdk,
    config,
  };
}

export async function assertMeasurementBalance(connection: Connection, author: PublicKey): Promise<void> {
  const authorBalance = await connection.getBalance(author, "confirmed");
  if (authorBalance < 5 * LAMPORTS_PER_SOL) {
    throw new Error(`author balance too low: ${authorBalance}`);
  }
}

export async function resolveMeasurementAccounts(input: {
  connection: Connection;
  sdk: Alcheme;
  identityHandle: string;
  identityRegistryName?: string;
}) {
  const { connection, sdk, identityHandle } = input;
  const identityRegistryName = input.identityRegistryName || "social_hub_identity";
  const identityProgram = sdk.pda.getIdentityProgramId();
  const accessProgram = sdk.pda.getAccessProgramId();
  const eventProgram = sdk.pda.getEventProgramId();
  const contentManager = sdk.pda.findContentManagerPda();
  const identityRegistry = sdk.pda.findIdentityRegistryPda(identityRegistryName);
  const userIdentity = sdk.pda.findUserIdentityPda(identityRegistry, identityHandle);
  const accessControllerAccount = sdk.pda.findAccessControllerPda();
  const eventEmitterAccount = sdk.pda.findEventEmitterPda();
  const emitter = await connection.getAccountInfo(eventEmitterAccount, "confirmed");
  if (!emitter) {
    throw new Error("event_emitter account not found");
  }
  const eventSequence = readEventSequenceFromAccountData(Buffer.from(emitter.data));
  const eventBatch = sdk.pda.findEventBatchPda(new BN(eventSequence));

  return {
    identityProgram,
    accessProgram,
    eventProgram,
    contentManager,
    userIdentity,
    accessControllerAccount,
    eventEmitterAccount,
    eventBatch,
  };
}

export async function confirmSignature(connection: Connection, signature: string): Promise<void> {
  const latest = await connection.getLatestBlockhash("confirmed");
  await connection.confirmTransaction(
    {
      signature,
      blockhash: latest.blockhash,
      lastValidBlockHeight: latest.lastValidBlockHeight,
    },
    "confirmed",
  );
}

export function summarizeSamples(input: {
  method: string;
  percentile: number;
  sampleCount: number;
  thresholdLamports?: number;
  samples: CostSample[];
}): V2CostResult {
  const { method, percentile, sampleCount, thresholdLamports, samples } = input;
  const successfulSamples = samples.filter((sample) => sample.error === null);
  const failedSamples = samples.filter((sample) => sample.error !== null);
  const sampleErrors = failedSamples.map((sample) => sample.error || "unknown sample error");
  const sampleSignatures = successfulSamples
    .map((sample) => sample.signature)
    .filter((signature): signature is string => Boolean(signature));

  const totalValues = samples.map((sample) => sample.total);

  const errors = sampleErrors.length
    ? [
        `on-chain sampling observed ${failedSamples.length}/${sampleCount} failed samples`,
        ...unique(sampleErrors).slice(0, 5),
      ]
    : [];

  return {
    tx_fee: percentileValue(samples.map((sample) => sample.tx_fee), percentile),
    rent_delta: percentileValue(samples.map((sample) => sample.rent_delta), percentile),
    event_delta: percentileValue(samples.map((sample) => sample.event_delta), percentile),
    total: percentileValue(totalValues, percentile),
    percentile,
    sample_count: sampleCount,
    successful_samples: successfulSamples.length,
    failed_samples: failedSamples.length,
    observed_samples: samples.length,
    threshold_lamports: thresholdLamports,
    method,
    measurement_mode: "onchain_sampling",
    timestamp: new Date().toISOString(),
    errors,
    sample_errors: sampleErrors,
    sample_signatures: sampleSignatures,
  };
}
