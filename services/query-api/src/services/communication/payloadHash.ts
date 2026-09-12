import { createHash } from "node:crypto";

export function computeCommunicationPayloadHash(input: {
  roomKey: string;
  senderPubkey: string;
  messageKind: string;
  text?: string | null;
  metadata?: unknown;
  storageUri?: string | null;
  durationMs?: number | null;
}): string {
  return createHash("sha256")
    .update(stableJsonStringify({
      messageKind: input.messageKind,
      metadata: input.metadata ?? null,
      roomKey: input.roomKey,
      senderPubkey: input.senderPubkey,
      storageUri: input.storageUri ?? null,
      durationMs: input.durationMs ?? null,
      text: input.text ?? null,
    }))
    .digest("hex");
}

function stableJsonStringify(value: unknown): string {
  if (value === null || typeof value !== "object") {
    return JSON.stringify(value);
  }
  if (Array.isArray(value)) {
    return `[${value.map((item) => stableJsonStringify(item)).join(",")}]`;
  }
  const record = value as Record<string, unknown>;
  return `{${Object.keys(record)
    .filter((key) => record[key] !== undefined && record[key] !== null)
    .sort()
    .map((key) => `${JSON.stringify(key)}:${stableJsonStringify(record[key])}`)
    .join(",")}}`;
}
