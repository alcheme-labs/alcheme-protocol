import { createHash } from "node:crypto";

import {
  evaluateAppTrustRootKeyLifecycle,
  type AppTrustRootKeyLifecycleRecord,
} from "../appTrustRoot/keyLifecycle";
import { serverKeyHash } from "./chainRegistryDigest";

type JsonRecord = Record<string, unknown>;

export interface ExternalAppServerKeyLifecycleRow {
  keyVersion: string;
  publicKey: string;
  status: string;
  validFrom?: Date | string | null;
  validUntil?: Date | string | null;
  graceUntil?: Date | string | null;
  revokedAt?: Date | string | null;
  rotationReceiptId?: string | null;
}

export function buildExternalAppServerKeyVersion(input: {
  externalAppId: string;
  serverPublicKey: string;
}): string {
  const digest = createHash("sha256")
    .update(
      stableJsonStringify({
        domain: "alcheme:route-a-server-key:v1",
        externalAppId: input.externalAppId,
        serverPublicKey: input.serverPublicKey,
      }),
    )
    .digest("hex");
  return `key_${digest.slice(0, 24)}`;
}

export function buildExternalAppServerKeyId(input: {
  externalAppId: string;
  keyVersion: string;
}): string {
  return `${input.externalAppId}:${input.keyVersion}`;
}

export function buildInitialExternalAppServerKeyUpsert(input: {
  externalAppId: string;
  manifestHash: string;
  serverPublicKey: string;
  executedAt: Date;
  executionReceiptId: string;
  requestId: string;
  actionType: string;
  registryTxSignature?: string | null;
  receiptTxSignature?: string | null;
}) {
  const keyVersion = buildExternalAppServerKeyVersion({
    externalAppId: input.externalAppId,
    serverPublicKey: input.serverPublicKey,
  });
  const id = buildExternalAppServerKeyId({
    externalAppId: input.externalAppId,
    keyVersion,
  });
  const auditMetadata = {
    source: "production_registration_governance_execution",
    actionType: input.actionType,
    requestId: input.requestId,
    manifestHash: input.manifestHash,
    registryTxSignature: input.registryTxSignature ?? null,
    receiptTxSignature: input.receiptTxSignature ?? null,
  };

  return {
    where: {
      externalAppId_keyVersion: {
        externalAppId: input.externalAppId,
        keyVersion,
      },
    },
    create: {
      id,
      externalAppId: input.externalAppId,
      keyVersion,
      publicKey: input.serverPublicKey,
      status: "active",
      validFrom: input.executedAt,
      validUntil: null,
      graceUntil: null,
      revokedAt: null,
      rotationReceiptId: input.executionReceiptId,
      auditMetadata,
    },
    update: {
      auditMetadata,
    },
  };
}

export function buildRotatedExternalAppServerKeyUpsert(input: {
  externalAppId: string;
  serverPublicKey: string;
  executedAt: Date;
  executionReceiptId: string;
  requestId: string;
  actionType: string;
  registryTxSignature?: string | null;
  receiptTxSignature?: string | null;
  idempotencyKey?: string | null;
}) {
  const keyVersion = buildExternalAppServerKeyVersion({
    externalAppId: input.externalAppId,
    serverPublicKey: input.serverPublicKey,
  });
  const id = buildExternalAppServerKeyId({
    externalAppId: input.externalAppId,
    keyVersion,
  });
  const auditMetadata = {
    source: "server_key_rotation_governance_execution",
    actionType: input.actionType,
    requestId: input.requestId,
    registryTxSignature: input.registryTxSignature ?? null,
    receiptTxSignature: input.receiptTxSignature ?? null,
    idempotencyKey: input.idempotencyKey ?? null,
  };

  return {
    where: {
      externalAppId_keyVersion: {
        externalAppId: input.externalAppId,
        keyVersion,
      },
    },
    create: {
      id,
      externalAppId: input.externalAppId,
      keyVersion,
      publicKey: input.serverPublicKey,
      status: "active",
      validFrom: input.executedAt,
      validUntil: null,
      graceUntil: null,
      revokedAt: null,
      rotationReceiptId: input.executionReceiptId,
      auditMetadata,
    },
    update: {
      auditMetadata,
    },
  };
}

export function projectExternalAppServerKeyLifecycle(input: {
  environment: string;
  keys: ExternalAppServerKeyLifecycleRow[];
  chainTrusted: boolean;
  trustedServerKeyHash?: string | null;
  now?: Date;
}) {
  if (input.environment === "sandbox") {
    return {
      ready: true,
      required: false,
      activeKeyVersion: null,
      activeKeyCount: 0,
      graceKeyCount: 0,
      revokedKeyCount: 0,
      nextAction: "server_key_lifecycle_not_required_for_sandbox",
    };
  }

  const active = input.keys.filter((key) => key.status === "active");
  const grace = input.keys.filter((key) => key.status === "grace");
  const revoked = input.keys.filter((key) => key.status === "revoked");
  if (!input.chainTrusted) {
    return {
      ready: false,
      required: true,
      activeKeyVersion: null,
      activeKeyCount: active.length,
      graceKeyCount: grace.length,
      revokedKeyCount: revoked.length,
      nextAction: "wait_for_registry_finality",
    };
  }

  const lifecycleKeys = input.keys.map(mapLifecycleRecord);
  const allowed = input.keys.filter((key) =>
    evaluateAppTrustRootKeyLifecycle({
      keyId: key.keyVersion,
      keys: lifecycleKeys,
      now: input.now,
    }).allowed &&
    (!input.trustedServerKeyHash ||
      serverKeyHash(key.publicKey) === input.trustedServerKeyHash),
  );
  const activeKey =
    allowed.find((key) => key.status === "active") ??
    allowed.find((key) => key.status === "rotating") ??
    null;

  return {
    ready: Boolean(activeKey),
    required: true,
    activeKeyVersion: activeKey?.keyVersion ?? null,
    activeKeyCount: active.length,
    graceKeyCount: grace.length,
    revokedKeyCount: revoked.length,
    nextAction: activeKey
      ? "use_active_server_key_version"
      : "wait_for_key_lifecycle_activation",
  };
}

function mapLifecycleRecord(
  key: ExternalAppServerKeyLifecycleRow,
): AppTrustRootKeyLifecycleRecord {
  return {
    keyId: key.keyVersion,
    publicKeyRef: key.publicKey,
    status: key.status as AppTrustRootKeyLifecycleRecord["status"],
    validFrom: key.validFrom ?? null,
    validUntil: key.validUntil ?? null,
    graceUntil: key.graceUntil ?? null,
    revokedAt: key.revokedAt ?? null,
  };
}

function stableJsonStringify(value: unknown): string {
  if (value === null || typeof value !== "object") return JSON.stringify(value);
  if (Array.isArray(value)) {
    return `[${value.map(stableJsonStringify).join(",")}]`;
  }
  const record = value as JsonRecord;
  return `{${Object.keys(record)
    .sort()
    .map((key) => `${JSON.stringify(key)}:${stableJsonStringify(record[key])}`)
    .join(",")}}`;
}
