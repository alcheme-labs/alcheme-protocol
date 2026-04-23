// @ts-nocheck
import {
  PublicKey,
} from "@solana/web3.js";
import { BN } from "@coral-xyz/anchor";
import fs from "fs";
import path from "path";

const { assertMeasurementBalance, confirmSignature, createMeasurementContext } = require("./v2-cost-helpers.ts");

export const CREATE_CONTENT_V2_THRESHOLD_LAMPORTS = 1_000_000;
export const DEFAULT_PERCENTILE = 95;
export const DEFAULT_SAMPLE_COUNT = 20;
export const FAILED_SAMPLE_LAMPORTS = Number.MAX_SAFE_INTEGER;
type MeasurementVisibilityLevel = "Public" | "Followers" | "Private" | "CircleOnly";
type MeasurementContentStatus = "Draft" | "Published" | "Archived";

function visibilityMethodSuffix(visibilityLevel: MeasurementVisibilityLevel): string {
  switch (visibilityLevel) {
    case "CircleOnly":
      return "circle_only";
    case "Followers":
      return "followers";
    case "Private":
      return "private";
    case "Public":
    default:
      return "public";
  }
}

interface CostSnapshot {
  tx_fee: number;
  rent_delta: number;
  event_delta: number;
  total: number;
}

interface CostSample extends CostSnapshot {
  index: number;
  signature: string | null;
  error: string | null;
}

export interface CreateContentV2CostResult extends CostSnapshot {
  percentile: number;
  sample_count: number;
  successful_samples: number;
  failed_samples: number;
  observed_samples: number;
  threshold_lamports: number;
  method: string;
  measurement_mode: "onchain_sampling";
  timestamp: string;
  errors: string[];
  sample_errors: string[];
  sample_signatures: string[];
}

export interface CreateContentV2MeasurementOptions {
  percentile?: number;
  sampleCount?: number;
  visibilityLevel?: MeasurementVisibilityLevel;
  protocolCircleId?: number;
  contentStatus?: MeasurementContentStatus;
}

export type ContentIdPath = "valid_positive" | "invalid_non_positive";

function projectRoot(): string {
  return path.resolve(__dirname, "..", "..");
}

function loadIdl(name: string): any {
  const idlPath = path.join(projectRoot(), "target", "idl", `${name}.json`);
  const raw = fs.readFileSync(idlPath, "utf8");
  return JSON.parse(raw);
}

function failedSnapshot(): CostSnapshot {
  return {
    tx_fee: FAILED_SAMPLE_LAMPORTS,
    rent_delta: FAILED_SAMPLE_LAMPORTS,
    event_delta: FAILED_SAMPLE_LAMPORTS,
    total: FAILED_SAMPLE_LAMPORTS,
  };
}

function leU64(value: number | bigint): Buffer {
  const buffer = Buffer.alloc(8);
  buffer.writeBigUInt64LE(BigInt(value));
  return buffer;
}

export function classifyContentIdPath(contentId: number): ContentIdPath {
  if (contentId <= 0) {
    return "invalid_non_positive";
  }
  return "valid_positive";
}

function buildSampleContentId(index: number, attempt: number): number {
  // Avoid strict event-sequence coupling to reduce cross-process contention.
  const nowPart = Date.now() % 1_000_000_000;
  const randomPart = Math.floor(Math.random() * 1_000_000);
  const candidate = nowPart * 1_000_000 + randomPart + index * 31 + attempt;
  return Math.max(1, candidate);
}

function readEventSequenceFromAccountData(data: Buffer): number {
  const minSize = 8 + 1 + 32 + 8 + 8;
  const offset = 8 + 1 + 32 + 8;
  if (data.length < minSize) {
    throw new Error("event_emitter account data too small");
  }
  return Number(data.readBigUInt64LE(offset));
}

function percentileValue(values: number[], percentile: number): number {
  if (values.length === 0) {
    return FAILED_SAMPLE_LAMPORTS;
  }
  const sorted = [...values].sort((a, b) => a - b);
  const index = Math.min(sorted.length - 1, Math.max(0, Math.ceil((percentile / 100) * sorted.length) - 1));
  return sorted[index];
}

function unique(values: string[]): string[] {
  return [...new Set(values)];
}

function buildMeasurementHandle(): string {
  const nowPart = Date.now().toString(36);
  const randomPart = Math.floor(Math.random() * 0xffff)
    .toString(36)
    .padStart(3, "0");
  return `cost${nowPart}${randomPart}`.slice(0, 24);
}

async function ensureAuthorIdentity(connection: any, sdk: any, handle: string): Promise<void> {
  const signature = await sdk.identity.registerIdentity(handle, handle);
  await confirmSignature(connection, signature);
}

async function takeSample(params: {
  connection: Connection;
  eventEmitterPda: PublicKey;
  author: Keypair;
  sdk: Alcheme;
  identityHandle: string;
  index: number;
  visibilityLevel: MeasurementVisibilityLevel;
  protocolCircleId?: number;
  contentStatus: MeasurementContentStatus;
}): Promise<CostSample> {
  const {
    connection,
    eventEmitterPda,
    author,
    sdk,
    identityHandle,
    index,
    visibilityLevel,
    protocolCircleId,
    contentStatus,
  } = params;
  let stage = "load_event_emitter";
  let lastError = "unknown error";
  const maxAttempts = 3;
  const attemptTimeoutMs = 20_000;

  for (let attempt = 0; attempt < maxAttempts; attempt += 1) {
    try {
      const sample = await Promise.race([
        (async (): Promise<CostSample> => {
          const emitterAccount = await connection.getAccountInfo(eventEmitterPda, "confirmed");
          if (!emitterAccount) {
            throw new Error("event_emitter account not found");
          }

          stage = "read_event_sequence";
          const currentEventSequence = readEventSequenceFromAccountData(Buffer.from(emitterAccount.data));
          const contentId = buildSampleContentId(index, attempt);

          stage = "derive_event_batch";
          const eventBatchPda = sdk.pda.findEventBatchPda(new BN(currentEventSequence));

          stage = "read_pre_balances";
          const beforeAuthor = await connection.getBalance(author.publicKey, "confirmed");
          const beforeBatch = await connection.getBalance(eventBatchPda, "confirmed");

          const uriRef = `ipfs://measure-content-${visibilityLevel.toLowerCase()}-${Date.now()}-${index}-try${attempt}`;

          stage = "send_transaction";
          const signature = await sdk.content.createContent({
            contentId: new BN(contentId),
            text: `cost measurement sample ${index} (${visibilityLevel}/${contentStatus})`,
            contentType: "Text",
            externalUri: uriRef,
            identityHandle,
            identityRegistryName: "social_hub_identity",
            useV2: true,
            visibilityLevel,
            protocolCircleId,
            contentStatus,
          });

          stage = "confirm_transaction";
          await confirmSignature(connection, signature);

          stage = "read_transaction_meta";
          const txMeta = await connection.getTransaction(signature, {
            commitment: "confirmed",
            maxSupportedTransactionVersion: 0,
          });

          const txFee = txMeta?.meta?.fee ?? 0;

          stage = "read_post_balances";
          const afterAuthor = await connection.getBalance(author.publicKey, "confirmed");
          const afterBatch = await connection.getBalance(eventBatchPda, "confirmed");
          const eventDelta = Math.max(0, afterBatch - beforeBatch);
          const rentDelta = Math.max(0, beforeAuthor - afterAuthor - txFee);
          const total = txFee + rentDelta;

          return {
            index,
            signature,
            tx_fee: txFee,
            rent_delta: rentDelta,
            event_delta: eventDelta,
            total,
            error: null,
          };
        })(),
        new Promise<CostSample>((_, reject) =>
          setTimeout(() => reject(new Error("sample attempt timeout")), attemptTimeoutMs)
        ),
      ]);

      return sample;
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      lastError = `${stage}: ${message}`;
      const retriable = /fetch failed|already in use|Blockhash not found|timed out|timeout|429|Too Many Requests/i.test(
        message
      );
      if (!retriable || attempt === maxAttempts - 1) {
        return {
          ...failedSnapshot(),
          index,
          signature: null,
          error: lastError,
        };
      }
      const backoffMs = 200 * (attempt + 1);
      await new Promise((resolve) => setTimeout(resolve, backoffMs));
    }
  }

  return {
    ...failedSnapshot(),
    index,
    signature: null,
    error: lastError,
  };
}

export async function measureCreateContentV2Cost(options?: {
  percentile?: number;
  sampleCount?: number;
  visibilityLevel?: MeasurementVisibilityLevel;
  protocolCircleId?: number;
  contentStatus?: MeasurementContentStatus;
}): Promise<CreateContentV2CostResult> {
  const percentile = options?.percentile ?? DEFAULT_PERCENTILE;
  const sampleCount = options?.sampleCount ?? DEFAULT_SAMPLE_COUNT;
  const visibilityLevel = options?.visibilityLevel ?? "Public";
  const contentStatus = options?.contentStatus ?? "Published";
  const protocolCircleId = options?.protocolCircleId;
  const method =
    visibilityLevel === "Public" && contentStatus === "Published"
      ? "create_content_v2"
      : `create_content_v2_${visibilityMethodSuffix(visibilityLevel)}`;

  if (visibilityLevel === "CircleOnly") {
    if (!Number.isInteger(protocolCircleId) || Number(protocolCircleId) < 0 || Number(protocolCircleId) > 255) {
      throw new Error("protocolCircleId must be an integer between 0 and 255 for CircleOnly cost measurement");
    }
  }

  const baseResult = {
    percentile,
    sample_count: sampleCount,
    threshold_lamports: CREATE_CONTENT_V2_THRESHOLD_LAMPORTS,
    method,
    measurement_mode: "onchain_sampling" as const,
    timestamp: new Date().toISOString(),
  };

  let stage = "bootstrap";
  try {
    stage = "create_context";
    const { connection, author, sdk } = await createMeasurementContext();

    stage = "load_idl";
    loadIdl("content_manager");
    loadIdl("event_emitter");

    stage = "check_author_balance";
    await assertMeasurementBalance(connection, author.publicKey);

    const identityHandle = buildMeasurementHandle();
    stage = "register_identity";
    await ensureAuthorIdentity(connection, sdk, identityHandle);

    stage = "derive_pdas";
    const eventEmitterPda = sdk.pda.findEventEmitterPda();

    stage = "run_samples";
    const samples: CostSample[] = [];
    for (let index = 0; index < sampleCount; index += 1) {
      const sample = await takeSample({
        connection,
        eventEmitterPda,
        author,
        sdk,
        identityHandle,
        index,
        visibilityLevel,
        protocolCircleId,
        contentStatus,
      });
      samples.push(sample);
    }

    const successfulSamples = samples.filter((sample) => sample.error === null);
    const failedSamples = samples.filter((sample) => sample.error !== null);
    const totalValues = samples.map((sample) => sample.total);

    const sampleErrors = failedSamples.map((sample) => sample.error || "unknown sample error");
    const sampleSignatures = successfulSamples
      .map((sample) => sample.signature)
      .filter((signature): signature is string => Boolean(signature));

    const pValue = percentileValue(totalValues, percentile);
    const aggregateTxFee = percentileValue(samples.map((sample) => sample.tx_fee), percentile);
    const aggregateRentDelta = percentileValue(samples.map((sample) => sample.rent_delta), percentile);
    const aggregateEventDelta = percentileValue(samples.map((sample) => sample.event_delta), percentile);

    const errors = sampleErrors.length
      ? [
          `on-chain sampling observed ${failedSamples.length}/${sampleCount} failed samples`,
          ...unique(sampleErrors).slice(0, 5),
        ]
      : [];

    return {
      tx_fee: aggregateTxFee,
      rent_delta: aggregateRentDelta,
      event_delta: aggregateEventDelta,
      total: pValue,
      ...baseResult,
      successful_samples: successfulSamples.length,
      failed_samples: failedSamples.length,
      observed_samples: samples.length,
      errors,
      sample_errors: sampleErrors,
      sample_signatures: sampleSignatures,
    };
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    const stagedMessage = `${stage}: ${message}`;
    return {
      ...failedSnapshot(),
      ...baseResult,
      successful_samples: 0,
      failed_samples: sampleCount,
      observed_samples: sampleCount,
      errors: [stagedMessage],
      sample_errors: Array(sampleCount).fill(stagedMessage),
      sample_signatures: [],
    };
  }
}

async function main() {
  const result = await measureCreateContentV2Cost();
  console.log(JSON.stringify(result, null, 2));
  if (result.errors.length > 0) {
    process.exitCode = 1;
  }
}

if (require.main === module) {
  main().catch((error) => {
    console.error("[create-content-v2-cost] unexpected failure:", error);
    process.exit(1);
  });
}
