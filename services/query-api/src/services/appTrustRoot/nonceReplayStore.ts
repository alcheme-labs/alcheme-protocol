import type { Redis } from "ioredis";

import { digestJson } from "./digest";

export type AppTrustRootNonceReplayRejectReason =
  | "nonce_replayed"
  | "nonce_expired"
  | "nonce_ttl_exceeded"
  | "nonce_invalid";

export interface AppTrustRootNonceReplayConsumeInput {
  replayDomain: string;
  nonce: string;
  expiresAt: Date | string;
  now?: Date;
  maxTtlMs?: number;
  payloadDigest?: string | null;
}

export interface AppTrustRootNonceReplayConsumeResult {
  consumed: boolean;
  replayKey: string;
  ttlMs: number;
  expiresAt: string;
  reasonCode: AppTrustRootNonceReplayRejectReason | null;
}

export interface AppTrustRootNonceReplayStore {
  consume(input: AppTrustRootNonceReplayConsumeInput): Promise<AppTrustRootNonceReplayConsumeResult>;
}

export const DEFAULT_APP_TRUST_ROOT_NONCE_MAX_TTL_MS = 10 * 60 * 1000;

export function buildAppTrustRootNonceReplayKey(input: {
  replayDomain: string;
  nonce: string;
}): string {
  return `app_trust_root:nonce:${digestJson({
    replayDomain: normalizeReplayPart(input.replayDomain, "replayDomain"),
    nonce: normalizeReplayPart(input.nonce, "nonce"),
  })}`;
}

export class InMemoryAppTrustRootNonceReplayStore implements AppTrustRootNonceReplayStore {
  private readonly consumed = new Map<string, { expiresAtMs: number; payloadDigest: string | null }>();

  async consume(
    input: AppTrustRootNonceReplayConsumeInput,
  ): Promise<AppTrustRootNonceReplayConsumeResult> {
    const evaluated = evaluateNonceReplayInput(input);
    if (!evaluated.valid) return evaluated.result;

    this.prune(evaluated.nowMs);
    const existing = this.consumed.get(evaluated.replayKey);
    if (existing && existing.expiresAtMs > evaluated.nowMs) {
      return rejectNonceReplay(evaluated, "nonce_replayed");
    }

    this.consumed.set(evaluated.replayKey, {
      expiresAtMs: evaluated.storeExpiresAtMs,
      payloadDigest: input.payloadDigest ?? null,
    });
    return acceptNonceReplay(evaluated);
  }

  private prune(nowMs: number): void {
    for (const [key, value] of this.consumed.entries()) {
      if (value.expiresAtMs <= nowMs) {
        this.consumed.delete(key);
      }
    }
  }
}

export class RedisAppTrustRootNonceReplayStore implements AppTrustRootNonceReplayStore {
  constructor(private readonly redis: Pick<Redis, "set">) {}

  async consume(
    input: AppTrustRootNonceReplayConsumeInput,
  ): Promise<AppTrustRootNonceReplayConsumeResult> {
    const evaluated = evaluateNonceReplayInput(input);
    if (!evaluated.valid) return evaluated.result;

    const result = await this.redis.set(
      evaluated.replayKey,
      JSON.stringify({
        payloadDigest: input.payloadDigest ?? null,
        expiresAt: evaluated.storeExpiresAt.toISOString(),
      }),
      "PX",
      evaluated.ttlMs,
      "NX",
    );
    if (result !== "OK") {
      return rejectNonceReplay(evaluated, "nonce_replayed");
    }
    return acceptNonceReplay(evaluated);
  }
}

function evaluateNonceReplayInput(input: AppTrustRootNonceReplayConsumeInput):
  | {
      valid: true;
      replayKey: string;
      nowMs: number;
      ttlMs: number;
      storeExpiresAt: Date;
      storeExpiresAtMs: number;
    }
  | { valid: false; result: AppTrustRootNonceReplayConsumeResult } {
  let replayKey: string;
  try {
    replayKey = buildAppTrustRootNonceReplayKey(input);
  } catch {
    return invalidNonceReplayResult(input, "nonce_invalid");
  }

  const now = input.now ?? new Date();
  const nowMs = now.getTime();
  if (!Number.isFinite(nowMs)) {
    return invalidNonceReplayResult(input, "nonce_invalid", replayKey);
  }
  const claimExpiresAt = input.expiresAt instanceof Date
    ? input.expiresAt
    : new Date(input.expiresAt);
  const claimExpiresAtMs = claimExpiresAt.getTime();
  if (!Number.isFinite(claimExpiresAtMs)) {
    return invalidNonceReplayResult(input, "nonce_invalid", replayKey);
  }
  if (claimExpiresAtMs <= nowMs) {
    return invalidNonceReplayResult(input, "nonce_expired", replayKey, now);
  }

  const maxTtlMs = Number.isFinite(input.maxTtlMs)
    ? Math.max(1, Number(input.maxTtlMs))
    : DEFAULT_APP_TRUST_ROOT_NONCE_MAX_TTL_MS;
  const requestedTtlMs = claimExpiresAtMs - nowMs;
  if (requestedTtlMs > maxTtlMs) {
    return invalidNonceReplayResult(input, "nonce_ttl_exceeded", replayKey, now);
  }
  const ttlMs = Math.max(1, requestedTtlMs);
  const storeExpiresAtMs = nowMs + ttlMs;
  return {
    valid: true,
    replayKey,
    nowMs,
    ttlMs,
    storeExpiresAt: new Date(storeExpiresAtMs),
    storeExpiresAtMs,
  };
}

function acceptNonceReplay(input: {
  replayKey: string;
  ttlMs: number;
  storeExpiresAt: Date;
}): AppTrustRootNonceReplayConsumeResult {
  return {
    consumed: true,
    replayKey: input.replayKey,
    ttlMs: input.ttlMs,
    expiresAt: input.storeExpiresAt.toISOString(),
    reasonCode: null,
  };
}

function rejectNonceReplay(
  input: { replayKey: string; ttlMs: number; storeExpiresAt: Date },
  reasonCode: AppTrustRootNonceReplayRejectReason,
): AppTrustRootNonceReplayConsumeResult {
  return {
    consumed: false,
    replayKey: input.replayKey,
    ttlMs: input.ttlMs,
    expiresAt: input.storeExpiresAt.toISOString(),
    reasonCode,
  };
}

function invalidNonceReplayResult(
  input: AppTrustRootNonceReplayConsumeInput,
  reasonCode: AppTrustRootNonceReplayRejectReason,
  replayKey = "app_trust_root:nonce:invalid",
  now = input.now ?? new Date(),
): { valid: false; result: AppTrustRootNonceReplayConsumeResult } {
  const nowMs = now.getTime();
  return {
    valid: false,
    result: {
      consumed: false,
      replayKey,
      ttlMs: 0,
      expiresAt: Number.isFinite(nowMs) ? now.toISOString() : new Date(0).toISOString(),
      reasonCode,
    },
  };
}

function normalizeReplayPart(value: string, field: string): string {
  const normalized = String(value || "").trim();
  if (!normalized) {
    throw new Error(`${field}_required`);
  }
  return normalized;
}
