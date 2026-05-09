// @ts-nocheck
import fs from "fs";
import os from "os";
import path from "path";
import {
  Connection,
  Keypair,
  PublicKey,
  Transaction,
  TransactionInstruction,
} from "@solana/web3.js";

const {
  DEFAULT_PERCENTILE,
  DEFAULT_SAMPLE_COUNT,
  FAILED_SAMPLE_LAMPORTS,
  percentileValue,
  unique,
} = require("./v2-cost-helpers.ts");

export const DRAFT_ANCHOR_THRESHOLD_LAMPORTS = 50_000;
export const MEMO_PROGRAM_ID = new PublicKey("MemoSq4gqABAXKb96qnH8TysNcWxMyWCqXgDLGmfcHr");
export type DraftAnchorMeasurementMode = "estimated" | "real_onchain";
export type DraftAnchorSampleStatus = "anchored" | "estimated" | "failed" | "skipped";

export interface DraftAnchorCostSample {
  index: number;
  signature: string | null;
  tx_slot: string | null;
  tx_fee: number;
  rent_delta: number;
  event_delta: number;
  total: number;
  signer_latency_ms: number | null;
  confirmation_latency_ms: number | null;
  status: DraftAnchorSampleStatus;
  error: string | null;
}

export interface DraftAnchorCostResult {
  method: "draft_anchor_memo";
  measurement_mode: DraftAnchorMeasurementMode;
  status: DraftAnchorSampleStatus;
  percentile: number;
  sample_count: number;
  successful_samples: number;
  failed_samples: number;
  observed_samples: number;
  threshold_lamports: number;
  tx_fee: number;
  rent_delta: number;
  event_delta: number;
  total: number;
  p50: number;
  p95: number;
  p99: number;
  errors: string[];
  sample_errors: string[];
  sample_signatures: string[];
  sample_slots: string[];
  signature_policy: string;
  timestamp: string;
}

export function classifyDraftAnchorMeasurementMode(raw?: string | null): DraftAnchorMeasurementMode {
  return String(raw || "").trim().toLowerCase() === "real_onchain" ? "real_onchain" : "estimated";
}

function expandHome(inputPath: string): string {
  if (!inputPath.startsWith("~/")) return inputPath;
  return path.join(os.homedir(), inputPath.slice(2));
}

function loadSigner(pathToKeypair: string): Keypair {
  const raw = fs.readFileSync(pathToKeypair, "utf8");
  const parsed = JSON.parse(raw);
  if (!Array.isArray(parsed) || parsed.length < 64) {
    throw new Error(`invalid keypair file: ${pathToKeypair}`);
  }
  return Keypair.fromSecretKey(Uint8Array.from(parsed));
}

function buildMemoText(index: number): string {
  const anchorId = "a".repeat(64);
  const summaryHash = "b".repeat(64);
  const messagesDigest = "c".repeat(64);
  return `alcheme-draft-anchor:v1:${anchorId}:summary=${summaryHash}:messages=${messagesDigest}:sample=${index}`;
}

function summarizeDraftAnchorSamples(input: {
  samples: DraftAnchorCostSample[];
  percentile: number;
  sampleCount: number;
  measurementMode: DraftAnchorMeasurementMode;
  status: DraftAnchorSampleStatus;
  signaturePolicy: string;
}): DraftAnchorCostResult {
  const { samples, percentile, sampleCount, measurementMode, status, signaturePolicy } = input;
  const successfulSamples = samples.filter((sample) => sample.error === null && sample.status !== "failed");
  const failedSamples = samples.filter((sample) => sample.error !== null || sample.status === "failed");
  const sampleErrors = failedSamples.map((sample) => sample.error || "unknown sample error");
  const totals = samples.map((sample) => sample.total);
  const sampleSignatures = successfulSamples
    .map((sample) => sample.signature)
    .filter((signature): signature is string => Boolean(signature));
  const sampleSlots = successfulSamples
    .map((sample) => sample.tx_slot)
    .filter((slot): slot is string => Boolean(slot));

  return {
    method: "draft_anchor_memo",
    measurement_mode: measurementMode,
    status,
    percentile,
    sample_count: sampleCount,
    successful_samples: successfulSamples.length,
    failed_samples: failedSamples.length,
    observed_samples: samples.length,
    threshold_lamports: DRAFT_ANCHOR_THRESHOLD_LAMPORTS,
    tx_fee: percentileValue(samples.map((sample) => sample.tx_fee), percentile),
    rent_delta: percentileValue(samples.map((sample) => sample.rent_delta), percentile),
    event_delta: percentileValue(samples.map((sample) => sample.event_delta), percentile),
    total: percentileValue(totals, percentile),
    p50: percentileValue(totals, 50),
    p95: percentileValue(totals, 95),
    p99: percentileValue(totals, 99),
    errors: sampleErrors.length ? unique(sampleErrors).slice(0, 5) : [],
    sample_errors: sampleErrors,
    sample_signatures: sampleSignatures,
    sample_slots: sampleSlots,
    signature_policy: signaturePolicy,
    timestamp: new Date().toISOString(),
  };
}

function buildEstimatedSamples(sampleCount: number): DraftAnchorCostSample[] {
  return Array.from({ length: sampleCount }, (_, index) => ({
    index,
    signature: null,
    tx_slot: null,
    tx_fee: 5_000,
    rent_delta: 0,
    event_delta: 0,
    total: 5_000,
    signer_latency_ms: null,
    confirmation_latency_ms: null,
    status: "estimated",
    error: null,
  }));
}

async function takeRealOnchainSample(input: {
  connection: Connection;
  signer: Keypair;
  index: number;
}): Promise<DraftAnchorCostSample> {
  const { connection, signer, index } = input;
  const beforeBalance = await connection.getBalance(signer.publicKey, "confirmed");
  const instruction = new TransactionInstruction({
    programId: MEMO_PROGRAM_ID,
    keys: [],
    data: Buffer.from(buildMemoText(index), "utf8"),
  });
  const tx = new Transaction().add(instruction);
  tx.feePayer = signer.publicKey;
  const latest = await connection.getLatestBlockhash("confirmed");
  tx.recentBlockhash = latest.blockhash;
  tx.sign(signer);

  const startedAt = Date.now();
  const signature = await connection.sendRawTransaction(tx.serialize(), {
    skipPreflight: false,
    preflightCommitment: "confirmed",
    maxRetries: 3,
  });
  const sentAt = Date.now();
  const confirmation = await connection.confirmTransaction(
    {
      signature,
      blockhash: latest.blockhash,
      lastValidBlockHeight: latest.lastValidBlockHeight,
    },
    "confirmed",
  );
  const confirmedAt = Date.now();
  if (confirmation.value.err) {
    throw new Error(`memo anchor transaction failed: ${JSON.stringify(confirmation.value.err)}`);
  }
  const txInfo = await connection.getTransaction(signature, {
    commitment: "confirmed",
    maxSupportedTransactionVersion: 0,
  });
  const txFee = txInfo?.meta?.fee ?? 0;
  const afterBalance = await connection.getBalance(signer.publicKey, "confirmed");
  const rentDelta = Math.max(0, beforeBalance - afterBalance - txFee);

  return {
    index,
    signature,
    tx_slot: txInfo?.slot ? String(txInfo.slot) : null,
    tx_fee: txFee,
    rent_delta: rentDelta,
    event_delta: 0,
    total: txFee + rentDelta,
    signer_latency_ms: sentAt - startedAt,
    confirmation_latency_ms: confirmedAt - sentAt,
    status: "anchored",
    error: null,
  };
}

export async function measureDraftAnchorCost(options?: {
  percentile?: number;
  sampleCount?: number;
  measurementMode?: DraftAnchorMeasurementMode;
  rpcUrl?: string;
  keypairPath?: string;
}): Promise<DraftAnchorCostResult> {
  const percentile = options?.percentile ?? DEFAULT_PERCENTILE;
  const sampleCount = options?.sampleCount ?? DEFAULT_SAMPLE_COUNT;
  const measurementMode = options?.measurementMode
    || classifyDraftAnchorMeasurementMode(process.env.DRAFT_ANCHOR_COST_MODE);

  if (measurementMode === "estimated") {
    return summarizeDraftAnchorSamples({
      samples: buildEstimatedSamples(sampleCount),
      percentile,
      sampleCount,
      measurementMode,
      status: "estimated",
      signaturePolicy: "estimated_mode_no_sample_signatures",
    });
  }

  if (String(process.env.DRAFT_ANCHOR_ENABLED || "true").trim().toLowerCase() === "false") {
    const reason = "draft_anchor_disabled";
    return summarizeDraftAnchorSamples({
      samples: [{
        ...buildEstimatedSamples(1)[0],
        total: FAILED_SAMPLE_LAMPORTS,
        tx_fee: FAILED_SAMPLE_LAMPORTS,
        rent_delta: FAILED_SAMPLE_LAMPORTS,
        event_delta: FAILED_SAMPLE_LAMPORTS,
        status: "skipped",
        error: reason,
      }],
      percentile,
      sampleCount,
      measurementMode,
      status: "skipped",
      signaturePolicy: reason,
    });
  }

  const rpcUrl = options?.rpcUrl
    || process.env.DRAFT_ANCHOR_RPC_URL
    || process.env.SOLANA_RPC_URL
    || process.env.ANCHOR_PROVIDER_URL
    || "http://127.0.0.1:8899";
  const keypairPath = expandHome(
    options?.keypairPath
    || process.env.DRAFT_ANCHOR_KEYPAIR_PATH
    || process.env.SOLANA_KEYPAIR_PATH
    || process.env.ANCHOR_WALLET
    || path.join(os.homedir(), ".config", "solana", "id.json"),
  );

  let signer: Keypair;
  try {
    signer = loadSigner(keypairPath);
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    return summarizeDraftAnchorSamples({
      samples: [{
        ...buildEstimatedSamples(1)[0],
        total: FAILED_SAMPLE_LAMPORTS,
        tx_fee: FAILED_SAMPLE_LAMPORTS,
        rent_delta: FAILED_SAMPLE_LAMPORTS,
        event_delta: FAILED_SAMPLE_LAMPORTS,
        status: "skipped",
        error: `keypair_unavailable: ${message}`,
      }],
      percentile,
      sampleCount,
      measurementMode,
      status: "skipped",
      signaturePolicy: "real_onchain_requires_local_keypair",
    });
  }

  const connection = new Connection(rpcUrl, "confirmed");
  const samples: DraftAnchorCostSample[] = [];
  for (let index = 0; index < sampleCount; index += 1) {
    try {
      samples.push(await takeRealOnchainSample({ connection, signer, index }));
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      samples.push({
        ...buildEstimatedSamples(1)[0],
        index,
        total: FAILED_SAMPLE_LAMPORTS,
        tx_fee: FAILED_SAMPLE_LAMPORTS,
        rent_delta: FAILED_SAMPLE_LAMPORTS,
        event_delta: FAILED_SAMPLE_LAMPORTS,
        status: "failed",
        error: message,
      });
    }
  }

  return summarizeDraftAnchorSamples({
    samples,
    percentile,
    sampleCount,
    measurementMode,
    status: samples.some((sample) => sample.status === "failed") ? "failed" : "anchored",
    signaturePolicy: "real_onchain_samples_require_sample_signatures",
  });
}

async function main() {
  const result = await measureDraftAnchorCost();
  console.log(JSON.stringify(result, null, 2));
  if (result.measurement_mode === "real_onchain" && result.status !== "anchored") {
    process.exitCode = 1;
  }
}

if (require.main === module) {
  main().catch((error) => {
    console.error("[draft-anchor-cost] unexpected failure:", error);
    process.exit(1);
  });
}
