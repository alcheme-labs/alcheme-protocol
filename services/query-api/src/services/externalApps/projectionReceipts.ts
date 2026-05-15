import { createHash, randomUUID } from "node:crypto";

export interface ExternalAppProjectionReceiptDraft {
  id: string;
  externalAppId: string;
  receiptType: string;
  sourceHierarchy: string[];
  parserVersion: string;
  inputDigest: string;
  outputDigest: string;
  status: string;
  disputeRef?: string;
}

export function buildExternalAppProjectionReceipt(input: {
  externalAppId: string;
  receiptType: string;
  sourceHierarchy: string[];
  parserVersion: string;
  input: unknown;
  output: unknown;
  status?: string;
}): ExternalAppProjectionReceiptDraft {
  return {
    id: randomUUID(),
    externalAppId: input.externalAppId,
    receiptType: input.receiptType,
    sourceHierarchy: input.sourceHierarchy,
    parserVersion: input.parserVersion,
    inputDigest: digest(input.input),
    outputDigest: digest(input.output),
    status: input.status ?? "active",
  };
}

export function markProjectionReceiptDisputed(
  receipt: ExternalAppProjectionReceiptDraft,
  disputeRef: string,
): ExternalAppProjectionReceiptDraft {
  return {
    ...receipt,
    status: "disputed",
    disputeRef,
  };
}

function digest(value: unknown): string {
  return `sha256:${createHash("sha256").update(stableJson(value)).digest("hex")}`;
}

function stableJson(value: unknown): string {
  if (Array.isArray(value)) {
    return `[${value.map(stableJson).join(",")}]`;
  }
  if (value && typeof value === "object") {
    const record = value as Record<string, unknown>;
    return `{${Object.keys(record)
      .sort()
      .map((key) => `${JSON.stringify(key)}:${stableJson(record[key])}`)
      .join(",")}}`;
  }
  return JSON.stringify(value);
}
