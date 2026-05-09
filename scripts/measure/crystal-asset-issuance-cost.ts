// @ts-nocheck
import crypto from "crypto";
import {
  ExtensionType,
  getMintLen,
} from "@solana/spl-token";

const {
  DEFAULT_PERCENTILE,
  DEFAULT_SAMPLE_COUNT,
  percentileValue,
  unique,
} = require("./v2-cost-helpers.ts");

export type CrystalIssuanceMeasurementMode = "mock_chain" | "estimated";
export type CrystalIssuanceMethod = "crystal_master_asset" | "crystal_receipt_asset" | "crystal_asset_issuance";

export interface CrystalIssuanceCostSample {
  index: number;
  method: CrystalIssuanceMethod;
  asset_standard: string;
  asset_address: string | null;
  signature: string | null;
  tx_fee: number;
  rent_delta: number;
  event_delta: number;
  total: number;
  measurement_mode: CrystalIssuanceMeasurementMode;
  error: string | null;
}

export interface CrystalIssuanceCostResult {
  method: "crystal_asset_issuance";
  measurement_mode: CrystalIssuanceMeasurementMode;
  sample_count: number;
  receipt_count: number;
  issued_receipt_count: number;
  successful_samples: number;
  failed_samples: number;
  observed_samples: number;
  tx_fee: number;
  rent_delta: number;
  event_delta: number;
  total: number;
  p50: number;
  p95: number;
  p99: number;
  master: CrystalIssuanceCostSample | null;
  receipts: CrystalIssuanceCostSample[];
  errors: string[];
  sample_errors: string[];
  sample_signatures: string[];
  signature_policy: string;
  assumptions: string[];
  timestamp: string;
}

export function classifyCrystalIssuanceMeasurementMode(raw?: string | null): CrystalIssuanceMeasurementMode {
  const normalized = String(raw || "").trim().toLowerCase();
  return normalized === "estimated" || normalized === "estimated_token2022" ? "estimated" : "mock_chain";
}

function buildMockAddress(scope: "master" | "receipt", entropy: string): string {
  const digest = crypto.createHash("sha256").update(`${scope}:${entropy}`).digest("hex");
  return `mock_${scope}_${digest.slice(0, 48)}`;
}

function rentExemptLamports(space: number): number {
  return Math.ceil((space + 128) * 6_960);
}

function metadataRentLamports(fields: Array<readonly [string, string]>, uriLength: number): number {
  const fieldBytes = fields.reduce((sum, [key, value]) => sum + key.length + value.length + 8, 0);
  return rentExemptLamports(256 + uriLength + fieldBytes);
}

function buildMockMasterSample(index: number): CrystalIssuanceCostSample {
  return {
    index,
    method: "crystal_master_asset",
    asset_standard: "mock_chain_master",
    asset_address: buildMockAddress("master", `knowledge:${index}`),
    signature: null,
    tx_fee: 0,
    rent_delta: 0,
    event_delta: 0,
    total: 0,
    measurement_mode: "mock_chain",
    error: null,
  };
}

function buildMockReceiptSample(index: number): CrystalIssuanceCostSample {
  return {
    index,
    method: "crystal_receipt_asset",
    asset_standard: "mock_chain_receipt",
    asset_address: buildMockAddress("receipt", `entitlement:${index}`),
    signature: null,
    tx_fee: 0,
    rent_delta: 0,
    event_delta: 0,
    total: 0,
    measurement_mode: "mock_chain",
    error: null,
  };
}

function buildEstimatedToken2022Sample(input: {
  index: number;
  kind: "master" | "receipt";
}): CrystalIssuanceCostSample {
  const isReceipt = input.kind === "receipt";
  const extensions = [
    ExtensionType.MetadataPointer,
    ...(isReceipt ? [ExtensionType.NonTransferable] : []),
  ];
  const mintAccountRent = rentExemptLamports(getMintLen(extensions));
  const ataRent = rentExemptLamports(165);
  const fields = isReceipt
    ? [
        ["kind", "receipt"],
        ["knowledge_id", "K-estimated"],
        ["entitlement_id", String(input.index)],
        ["role", "author"],
        ["weight_bps", "10000"],
        ["proof_hash", "a".repeat(64)],
      ]
    : [
        ["kind", "master"],
        ["knowledge_id", "K-estimated"],
        ["proof_hash", "a".repeat(64)],
        ["source_anchor", "b".repeat(64)],
        ["contributors_root", "c".repeat(64)],
      ];
  const metadataRent = metadataRentLamports(fields, 160);
  const transactionCount = 1 + 1 + fields.length + 1;
  const txFee = transactionCount * 5_000;
  const rentDelta = mintAccountRent + ataRent + metadataRent;

  return {
    index: input.index,
    method: isReceipt ? "crystal_receipt_asset" : "crystal_master_asset",
    asset_standard: isReceipt ? "token2022_non_transferable_receipt" : "token2022_master_nft",
    asset_address: null,
    signature: null,
    tx_fee: txFee,
    rent_delta: rentDelta,
    event_delta: 0,
    total: txFee + rentDelta,
    measurement_mode: "estimated",
    error: null,
  };
}

function summarizeCrystalIssuanceSamples(input: {
  master: CrystalIssuanceCostSample;
  receipts: CrystalIssuanceCostSample[];
  measurementMode: CrystalIssuanceMeasurementMode;
  signaturePolicy: string;
  assumptions: string[];
}): CrystalIssuanceCostResult {
  const samples = [input.master, ...input.receipts];
  const failedSamples = samples.filter((sample) => sample.error !== null);
  const sampleErrors = failedSamples.map((sample) => sample.error || "unknown sample error");
  const successfulSamples = samples.filter((sample) => sample.error === null);
  const totals = samples.map((sample) => sample.total);

  return {
    method: "crystal_asset_issuance",
    measurement_mode: input.measurementMode,
    sample_count: samples.length,
    receipt_count: input.receipts.length,
    issued_receipt_count: input.receipts.filter((sample) => sample.error === null).length,
    successful_samples: successfulSamples.length,
    failed_samples: failedSamples.length,
    observed_samples: samples.length,
    tx_fee: samples.reduce((sum, sample) => sum + sample.tx_fee, 0),
    rent_delta: samples.reduce((sum, sample) => sum + sample.rent_delta, 0),
    event_delta: samples.reduce((sum, sample) => sum + sample.event_delta, 0),
    total: samples.reduce((sum, sample) => sum + sample.total, 0),
    p50: percentileValue(totals, 50),
    p95: percentileValue(totals, 95),
    p99: percentileValue(totals, 99),
    master: input.master,
    receipts: input.receipts,
    errors: sampleErrors.length ? unique(sampleErrors).slice(0, 5) : [],
    sample_errors: sampleErrors,
    sample_signatures: successfulSamples
      .map((sample) => sample.signature)
      .filter((signature): signature is string => Boolean(signature)),
    signature_policy: input.signaturePolicy,
    assumptions: input.assumptions,
    timestamp: new Date().toISOString(),
  };
}

export async function measureCrystalAssetIssuanceCost(options?: {
  measurementMode?: CrystalIssuanceMeasurementMode;
  receiptCount?: number;
}): Promise<CrystalIssuanceCostResult> {
  const measurementMode = options?.measurementMode
    || classifyCrystalIssuanceMeasurementMode(process.env.CRYSTAL_ASSET_COST_MODE);
  const receiptCount = Math.max(1, options?.receiptCount ?? DEFAULT_SAMPLE_COUNT);

  if (measurementMode === "estimated") {
    const master = buildEstimatedToken2022Sample({ index: 0, kind: "master" });
    const receipts = Array.from({ length: receiptCount }, (_, index) =>
      buildEstimatedToken2022Sample({ index, kind: "receipt" }));
    return summarizeCrystalIssuanceSamples({
      master,
      receipts,
      measurementMode,
      signaturePolicy: "estimated_token2022_no_sample_signatures",
      assumptions: [
        "Token-2022 transaction fee is estimated as 5,000 lamports per signer transaction.",
        "Rent is estimated from account size plus Solana rent overhead; metadata rent transfer is estimated until real mint signatures are sampled.",
        "Compressed receipt costs are not included because compressed receipt issuance is not implemented.",
      ],
    });
  }

  const master = buildMockMasterSample(0);
  const receipts = Array.from({ length: receiptCount }, (_, index) => buildMockReceiptSample(index));
  return summarizeCrystalIssuanceSamples({
    master,
    receipts,
    measurementMode,
    signaturePolicy: "mock_chain_no_sample_signatures",
    assumptions: [
      "mock_chain is product/demo evidence only and is not counted as real chain cost.",
      "Use CRYSTAL_ASSET_COST_MODE=estimated to produce a Token-2022 estimate.",
    ],
  });
}

async function main() {
  const result = await measureCrystalAssetIssuanceCost();
  console.log(JSON.stringify(result, null, 2));
}

if (require.main === module) {
  main().catch((error) => {
    console.error("[crystal-asset-issuance-cost] unexpected failure:", error);
    process.exit(1);
  });
}
