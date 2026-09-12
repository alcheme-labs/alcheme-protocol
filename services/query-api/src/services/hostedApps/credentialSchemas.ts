import Ajv2020 from "ajv/dist/2020";

import { digestJson } from "./digest";

const ajv = new Ajv2020({
  allErrors: true,
  strict: true,
  formats: {
    "date-time": {
      type: "string",
      validate: (value: string) => (
        /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z$/.test(value)
        && !Number.isNaN(Date.parse(value))
      ),
    },
  },
});

const digestPattern = "^sha256:";

const credentialSchemas: Record<string, Record<string, unknown>> = {
  "runtime_attestation.v1": objectSchema(
    {
      appId: stringSchema(),
      releaseId: stringSchema(),
      manifestHash: digestSchema(),
      bundleHash: digestSchema(),
      circleId: { type: "number" },
      userPubkey: stringSchema(),
      capabilitySetDigest: digestSchema(),
      sandboxOrigin: { type: "string", pattern: "^https://" },
      runtimeVersion: stringSchema(),
      sessionId: stringSchema(),
      nonce: stringSchema(),
    },
    [
      "appId",
      "releaseId",
      "manifestHash",
      "bundleHash",
      "circleId",
      "userPubkey",
      "capabilitySetDigest",
      "sandboxOrigin",
      "runtimeVersion",
      "sessionId",
      "nonce",
    ],
  ),
  "governance_decision.v1": objectSchema(
    {
      operationId: stringSchema(),
      operationVersion: stringSchema(),
      payloadDigest: digestSchema(),
      executionTargetRef: stringSchema(),
      executionNonce: stringSchema(),
      verifierPolicyVersion: stringSchema(),
      statePreconditionDigest: digestSchema(),
    },
    [
      "operationId",
      "operationVersion",
      "payloadDigest",
      "executionTargetRef",
      "executionNonce",
      "verifierPolicyVersion",
      "statePreconditionDigest",
    ],
  ),
  "storage_grant.v1": objectSchema(
    {
      objectDigest: digestSchema(),
      scopeRef: stringSchema(),
      readRightRef: stringSchema(),
      writeRightRef: stringSchema(),
      visibility: { type: "string", enum: ["private", "circle", "public"] },
      forkPolicyRef: stringSchema(),
      expiresAt: stringSchema(),
    },
    ["objectDigest", "scopeRef", "readRightRef", "visibility", "expiresAt"],
  ),
  "fork_grant.v1": objectSchema(
    {
      sourceScopeRef: stringSchema(),
      targetScopeRef: stringSchema(),
      objectDigest: digestSchema(),
      inheritedVisibility: { type: "string", enum: ["private", "circle", "public"] },
      newVisibility: { type: "string", enum: ["private", "circle", "public"] },
      forkDecisionReceiptRef: stringSchema(),
      expiresAt: stringSchema(),
    },
    [
      "sourceScopeRef",
      "targetScopeRef",
      "objectDigest",
      "inheritedVisibility",
      "newVisibility",
      "forkDecisionReceiptRef",
      "expiresAt",
    ],
  ),
  "payment_authorization.v1": objectSchema(
    {
      payerRef: stringSchema(),
      payerType: stringSchema(),
      budgetSourceRef: stringSchema(),
      quoteId: stringSchema(),
      quoteDigest: digestSchema(),
      costCap: stringSchema(),
      currency: stringSchema(),
      objectDigest: digestSchema(),
      refundPolicy: stringSchema(),
      nonPaymentPolicy: stringSchema(),
      expiresAt: stringSchema(),
    },
    [
      "payerRef",
      "payerType",
      "budgetSourceRef",
      "quoteId",
      "quoteDigest",
      "costCap",
      "currency",
      "objectDigest",
      "refundPolicy",
      "nonPaymentPolicy",
      "expiresAt",
    ],
  ),
  "publish_grant.v1": objectSchema(
    {
      objectDigest: digestSchema(),
      ownerRef: stringSchema(),
      scopeRef: stringSchema(),
      visibility: { type: "string", enum: ["private", "circle", "public"] },
      publishRightRef: stringSchema(),
      permanence: stringSchema(),
      retentionPolicy: stringSchema(),
      providerPolicyRef: stringSchema(),
      accessPolicyDigest: digestSchema(),
      deletionSemanticsAcknowledged: { type: "boolean" },
      moderationStatus: stringSchema(),
      paymentAuthorizationRef: stringSchema(),
      expiresAt: stringSchema(),
    },
    [
      "objectDigest",
      "ownerRef",
      "scopeRef",
      "visibility",
      "publishRightRef",
      "permanence",
      "retentionPolicy",
      "providerPolicyRef",
      "accessPolicyDigest",
      "deletionSemanticsAcknowledged",
      "moderationStatus",
      "paymentAuthorizationRef",
      "expiresAt",
    ],
  ),
  "publish_confirmation.v1": objectSchema(
    {
      paymentAuthorizationDigest: digestSchema(),
      publishGrantDigest: digestSchema(),
      userConfirmedPreviewDigest: digestSchema(),
      nativeCeremonyVersion: stringSchema(),
    },
    [
      "paymentAuthorizationDigest",
      "publishGrantDigest",
      "userConfirmedPreviewDigest",
      "nativeCeremonyVersion",
    ],
  ),
  "offline_verification_bundle.v1": objectSchema(
    {
      bundleDigest: digestSchema(),
      issuerKeySetDigest: digestSchema(),
      revocationSnapshotDigest: digestSchema(),
      maxRevocationFeedAgeMs: { type: "number" },
    },
    ["bundleDigest", "issuerKeySetDigest", "revocationSnapshotDigest", "maxRevocationFeedAgeMs"],
  ),
};

export function getHostedAppCredentialSchemaDocument(schemaRef: string): Record<string, unknown> {
  const schema = credentialSchemas[schemaRef];
  if (!schema) throw new Error("hosted_app_credential_schema_unregistered");
  return schema;
}

export function getHostedAppCredentialSchemaDigest(schemaRef: string): string {
  return digestJson(getHostedAppCredentialSchemaDocument(schemaRef));
}

export function validateCredentialPayloadForSchema(
  schemaDocument: unknown,
  payload: unknown,
): { ok: true } | {
  ok: false;
  reason: "hosted_app_credential_payload_schema_invalid";
  errors: unknown;
} {
  const validate = ajv.compile(schemaDocument as Record<string, unknown>);
  if (validate(payload)) return { ok: true };
  return {
    ok: false,
    reason: "hosted_app_credential_payload_schema_invalid",
    errors: validate.errors ?? [],
  };
}

function objectSchema(
  properties: Record<string, unknown>,
  required: string[],
): Record<string, unknown> {
  return {
    $schema: "https://json-schema.org/draft/2020-12/schema",
    type: "object",
    additionalProperties: false,
    required,
    properties,
  };
}

function stringSchema(): Record<string, unknown> {
  return { type: "string", minLength: 1 };
}

function digestSchema(): Record<string, unknown> {
  return { type: "string", pattern: digestPattern };
}
