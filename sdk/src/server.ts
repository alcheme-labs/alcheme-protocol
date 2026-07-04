import { sha256 } from "js-sha256";

export const EXTERNAL_PROGRAM_CLAIM_CONTRACT_VERSION = "external_program.claim.v1";

export interface ExternalAppManifestInput {
  version: string;
  appId: string;
  name: string;
  homeUrl: string;
  ownerWallet: string;
  serverPublicKey?: string | null;
  allowedOrigins: string[];
  platforms?: Record<string, unknown> | null;
  capabilities: string[];
  callbacks?: Record<string, unknown> | null;
  policy?: Record<string, unknown> | null;
  /**
   * Legacy convenience field from the early external-game SDK draft. Production
   * registration manifests use `callbacks`; this field is ignored for manifest
   * hashing so the SDK stays aligned with query-api manifest canonicalization.
   */
  callbackUrl?: string | null;
  metadata?: Record<string, unknown> | null;
}

export interface ExternalAppManifest {
  version: "1";
  appId: string;
  name: string;
  homeUrl: string;
  ownerWallet: string;
  serverPublicKey: string;
  allowedOrigins: string[];
  platforms?: Record<string, unknown>;
  capabilities: string[];
  callbacks?: Record<string, unknown>;
  policy?: Record<string, unknown>;
}

export interface ExternalAppOwnerAssertionPayload {
  appId: string;
  ownerWallet: string;
  manifestHash: string;
  audience: "alcheme:external-app-production-registration";
  expiresAt: string;
  nonce: string;
}

export interface BuildAppRoomClaimPayloadInput {
  externalAppId: string;
  roomType: string;
  externalRoomId: string;
  serverKeyVersion?: string | null;
  transcriptionMode?: "off" | "live_caption" | "transcript" | "recap" | "full" | null;
  voicePolicy?: AppRoomVoicePolicy | null;
  walletPubkeys: string[];
  roles?: Record<string, string>;
  expiresAt: string;
  nonce: string;
}

export interface AppRoomClaimPayload {
  claimContractVersion: typeof EXTERNAL_PROGRAM_CLAIM_CONTRACT_VERSION;
  serverKeyVersion?: string;
  externalAppId: string;
  roomType: string;
  externalRoomId: string;
  transcriptionMode?: "off" | "live_caption" | "transcript" | "recap" | "full";
  voicePolicy?: AppRoomVoicePolicy;
  walletPubkeys: string[];
  roles?: Record<string, string>;
  expiresAt: string;
  nonce: string;
}

export interface ExternalProgramClaimEnvelope {
  payload: string;
  signature: string;
}

export type AppRoomClaim = ExternalProgramClaimEnvelope;

export type ExternalAppServerSigner = (payload: string) => Promise<string>;

export type AppRoomClaimSigner = ExternalAppServerSigner;

export type SourceSubmissionClaimSigner = ExternalAppServerSigner;

export type KnowledgeContextClaimSigner = ExternalAppServerSigner;

export interface AppRoomVoicePolicy {
  maxSpeakers?: number;
  overflowStrategy?: string;
  moderatorRoles?: string[];
}

export interface BuildSourceSubmissionClaimPayloadInput {
  externalAppId: string;
  roomKey: string;
  originType: "communication_message" | "voice_recap" | "external_summary";
  originRef: string;
  targetCircleId: number;
  summaryText: string;
  evidencePrivacyClass: "public" | "circle_only" | "reviewer_only" | "sealed";
  requestedLifecycleStatus?: "nominated" | "submitted" | "review_pending" | null;
  submittedByPubkey?: string | null;
  expiresAt: string;
  nonce: string;
  serverKeyVersion?: string | null;
}

export interface SourceSubmissionClaimPayload {
  claimContractVersion: typeof EXTERNAL_PROGRAM_CLAIM_CONTRACT_VERSION;
  serverKeyVersion?: string;
  externalAppId: string;
  roomKey: string;
  originType: "communication_message" | "voice_recap" | "external_summary";
  originRef: string;
  targetCircleId: number;
  summaryDigest: string;
  evidencePrivacyClass: "public" | "circle_only" | "reviewer_only" | "sealed";
  requestedLifecycleStatus?: "nominated" | "submitted" | "review_pending";
  submittedByPubkey?: string;
  expiresAt: string;
  nonce: string;
}

export type SourceSubmissionClaim = ExternalProgramClaimEnvelope;

export interface BuildKnowledgeContextClaimPayloadInput {
  externalAppId: string;
  roomKey: string;
  circleId: number;
  walletPubkey?: string | null;
  requestedCapability?: "knowledge_context";
  purpose: string;
  expiresAt: string;
  nonce: string;
  serverKeyVersion?: string | null;
}

export interface KnowledgeContextClaimPayload {
  claimContractVersion: typeof EXTERNAL_PROGRAM_CLAIM_CONTRACT_VERSION;
  serverKeyVersion?: string;
  externalAppId: string;
  roomKey: string;
  circleId: number;
  walletPubkey?: string;
  requestedCapability: "knowledge_context";
  purpose: string;
  expiresAt: string;
  nonce: string;
}

export type KnowledgeContextClaim = ExternalProgramClaimEnvelope;

export interface ExternalAppPlatformCallbackPayload {
  externalAppId: string;
  callbackUrl: string;
  eventType: string;
  bodyDigest: string;
  timestamp: string;
  nonce: string;
}

export type ExternalAppRiskDisclaimerScope =
  | "developer_registration"
  | "external_app_entry"
  | "challenge_bond"
  | "bond_disposition";

export function normalizeExternalAppManifest(
  input: ExternalAppManifestInput,
): ExternalAppManifest {
  const appId = normalizeRequiredId(input.appId, "appId");
  const allowedOrigins = normalizeAllowedOrigins(input.allowedOrigins);
  if (allowedOrigins.some((origin) => !origin.startsWith("https://"))) {
    throw new Error("invalid_external_app_manifest");
  }
  const capabilities = uniqueSorted(
    input.capabilities.map((capability) => capability.trim()).filter(Boolean),
  );
  const serverPublicKey = input.serverPublicKey ? String(input.serverPublicKey) : "";
  if (
    input.version !== "1" ||
    !input.name ||
    !input.homeUrl ||
    !input.ownerWallet ||
    !serverPublicKey
  ) {
    throw new Error("invalid_external_app_manifest");
  }
  return {
    version: "1",
    appId,
    name: String(input.name),
    homeUrl: normalizeManifestUrl(input.homeUrl),
    ownerWallet: String(input.ownerWallet),
    serverPublicKey,
    allowedOrigins,
    platforms: asRecord(input.platforms),
    capabilities,
    callbacks: asRecord(input.callbacks),
    policy: asRecord(input.policy),
  };
}

export function computeExternalAppManifestHash(input: ExternalAppManifestInput): string {
  return `sha256:${sha256(stableStringify(normalizeExternalAppManifest(input)))}`;
}

export function buildExternalAppOwnerAssertionPayload(input: {
  appId: string;
  ownerWallet: string;
  manifestHash: string;
  expiresAt: string;
  nonce: string;
}): ExternalAppOwnerAssertionPayload {
  return {
    appId: normalizeRequiredId(input.appId, "appId"),
    ownerWallet: input.ownerWallet.trim(),
    manifestHash: normalizeSha256Digest(input.manifestHash, "manifestHash"),
    audience: "alcheme:external-app-production-registration",
    expiresAt: input.expiresAt,
    nonce: input.nonce,
  };
}

export function encodeExternalAppServerPayload(payload: unknown): string {
  return Buffer.from(stableStringify(payload)).toString("base64url");
}

export async function signExternalAppOwnerAssertion(
  input: {
    appId: string;
    ownerWallet: string;
    manifestHash: string;
    expiresAt: string;
    nonce: string;
  },
  signer: ExternalAppServerSigner,
): Promise<{ payload: string; signature: string }> {
  const payload = encodeExternalAppServerPayload(
    buildExternalAppOwnerAssertionPayload(input),
  );
  return { payload, signature: await signer(payload) };
}

export function buildAppRoomClaimPayload(
  input: BuildAppRoomClaimPayloadInput,
): AppRoomClaimPayload {
  return {
    claimContractVersion: EXTERNAL_PROGRAM_CLAIM_CONTRACT_VERSION,
    ...optionalServerKeyVersion(input.serverKeyVersion),
    externalAppId: normalizeRequiredId(input.externalAppId, "externalAppId"),
    roomType: input.roomType.trim().toLowerCase(),
    externalRoomId: input.externalRoomId.trim(),
    ...optionalTranscriptionMode(input.transcriptionMode),
    ...optionalVoicePolicy(input.voicePolicy),
    walletPubkeys: input.walletPubkeys.map((pubkey) => pubkey.trim()).filter(Boolean),
    ...(input.roles ? { roles: input.roles } : {}),
    expiresAt: input.expiresAt,
    nonce: input.nonce,
  };
}

export function encodeAppRoomClaimPayload(payload: AppRoomClaimPayload): string {
  return encodeExternalAppServerPayload(payload);
}

export async function signAppRoomClaim(
  input: BuildAppRoomClaimPayloadInput,
  signer: AppRoomClaimSigner,
): Promise<AppRoomClaim> {
  const payload = encodeAppRoomClaimPayload(buildAppRoomClaimPayload(input));
  return {
    payload,
    signature: await signer(payload),
  };
}

export function computeExternalProgramSummaryDigest(summaryText: string): string {
  return sha256(summaryText);
}

export function buildSourceSubmissionClaimPayload(
  input: BuildSourceSubmissionClaimPayloadInput,
): SourceSubmissionClaimPayload {
  return {
    claimContractVersion: EXTERNAL_PROGRAM_CLAIM_CONTRACT_VERSION,
    ...optionalServerKeyVersion(input.serverKeyVersion),
    externalAppId: normalizeRequiredId(input.externalAppId, "externalAppId"),
    roomKey: normalizeRequiredString(input.roomKey, "roomKey"),
    originType: normalizeSourceOriginType(input.originType),
    originRef: normalizeRequiredString(input.originRef, "originRef"),
    targetCircleId: normalizePositiveInteger(input.targetCircleId, "targetCircleId"),
    summaryDigest: computeExternalProgramSummaryDigest(input.summaryText),
    evidencePrivacyClass: normalizeEvidencePrivacyClass(input.evidencePrivacyClass),
    ...optionalSourceLifecycleStatus(input.requestedLifecycleStatus),
    ...optionalStringField("submittedByPubkey", input.submittedByPubkey),
    expiresAt: input.expiresAt,
    nonce: normalizeRequiredString(input.nonce, "nonce"),
  };
}

export function encodeSourceSubmissionClaimPayload(
  payload: SourceSubmissionClaimPayload,
): string {
  return encodeExternalAppServerPayload(payload);
}

export async function signSourceSubmissionClaim(
  input: BuildSourceSubmissionClaimPayloadInput,
  signer: SourceSubmissionClaimSigner,
): Promise<SourceSubmissionClaim> {
  const payload = encodeSourceSubmissionClaimPayload(
    buildSourceSubmissionClaimPayload(input),
  );
  return {
    payload,
    signature: await signer(payload),
  };
}

export function buildKnowledgeContextClaimPayload(
  input: BuildKnowledgeContextClaimPayloadInput,
): KnowledgeContextClaimPayload {
  return {
    claimContractVersion: EXTERNAL_PROGRAM_CLAIM_CONTRACT_VERSION,
    ...optionalServerKeyVersion(input.serverKeyVersion),
    externalAppId: normalizeRequiredId(input.externalAppId, "externalAppId"),
    roomKey: normalizeRequiredString(input.roomKey, "roomKey"),
    circleId: normalizePositiveInteger(input.circleId, "circleId"),
    ...optionalStringField("walletPubkey", input.walletPubkey),
    requestedCapability: "knowledge_context",
    purpose: normalizeRequiredString(input.purpose, "purpose"),
    expiresAt: input.expiresAt,
    nonce: normalizeRequiredString(input.nonce, "nonce"),
  };
}

export function encodeKnowledgeContextClaimPayload(
  payload: KnowledgeContextClaimPayload,
): string {
  return encodeExternalAppServerPayload(payload);
}

export async function signKnowledgeContextClaim(
  input: BuildKnowledgeContextClaimPayloadInput,
  signer: KnowledgeContextClaimSigner,
): Promise<KnowledgeContextClaim> {
  const payload = encodeKnowledgeContextClaimPayload(
    buildKnowledgeContextClaimPayload(input),
  );
  return {
    payload,
    signature: await signer(payload),
  };
}

export function buildPlatformCallbackPayload(
  input: ExternalAppPlatformCallbackPayload,
): ExternalAppPlatformCallbackPayload {
  return {
    externalAppId: normalizeRequiredId(input.externalAppId, "externalAppId"),
    callbackUrl: normalizeUrl(input.callbackUrl, "callbackUrl"),
    eventType: input.eventType.trim(),
    bodyDigest: normalizeSha256Digest(input.bodyDigest, "bodyDigest"),
    timestamp: input.timestamp,
    nonce: input.nonce,
  };
}

export function computePlatformCallbackDigest(
  input: ExternalAppPlatformCallbackPayload,
): string {
  return `sha256:${sha256(stableStringify(buildPlatformCallbackPayload(input)))}`;
}

export function assertPlatformCallbackDigest(input: {
  payload: ExternalAppPlatformCallbackPayload;
  digest: string;
}): void {
  const expected = computePlatformCallbackDigest(input.payload);
  if (expected !== normalizeSha256Digest(input.digest, "digest")) {
    throw new Error("external_app_platform_callback_digest_mismatch");
  }
}

export function computeExternalAppEvidenceHash(input: {
  externalAppId: string;
  evidenceKind: string;
  evidenceBodyDigest: string;
  submittedByPubkey: string;
  occurredAt: string;
}): string {
  return `sha256:${sha256(
    stableStringify({
      externalAppId: normalizeRequiredId(input.externalAppId, "externalAppId"),
      evidenceKind: input.evidenceKind.trim().toLowerCase(),
      evidenceBodyDigest: normalizeSha256Digest(
        input.evidenceBodyDigest,
        "evidenceBodyDigest",
      ),
      submittedByPubkey: input.submittedByPubkey.trim(),
      occurredAt: input.occurredAt,
    }),
  )}`;
}

export function computeExternalAppReceiptDigest(input: {
  receiptType: string;
  externalAppId: string;
  policyEpochId?: string | null;
  sourceDigest: string;
  issuedAt: string;
  nonce: string;
}): string {
  return `sha256:${sha256(
    stableStringify({
      receiptType: input.receiptType.trim().toLowerCase(),
      externalAppId: normalizeRequiredId(input.externalAppId, "externalAppId"),
      policyEpochId: input.policyEpochId?.trim() || null,
      sourceDigest: normalizeSha256Digest(input.sourceDigest, "sourceDigest"),
      issuedAt: input.issuedAt,
      nonce: input.nonce,
    }),
  )}`;
}

export function computeExternalAppRiskDisclaimerAcceptanceDigest(input: {
  externalAppId: string;
  actorPubkey: string;
  scope: ExternalAppRiskDisclaimerScope;
  policyEpochId: string;
  disclaimerVersion: string;
  termsDigest: string;
  bindingDigest?: string | null;
}): string {
  return `sha256:${sha256(
    stableStringify({
      domain: "alcheme:external-app-risk-disclaimer-acceptance:v1",
      externalAppId: normalizeRequiredId(input.externalAppId, "externalAppId"),
      actorPubkey: normalizeRequiredString(input.actorPubkey, "actorPubkey"),
      scope: normalizeRiskDisclaimerScope(input.scope),
      policyEpochId: normalizeRequiredString(input.policyEpochId, "policyEpochId"),
      disclaimerVersion: normalizeRequiredString(
        input.disclaimerVersion,
        "disclaimerVersion",
      ),
      termsDigest: normalizeExternalAppDigest(input.termsDigest, "termsDigest"),
      bindingDigest: input.bindingDigest
        ? normalizeExternalAppDigest(input.bindingDigest, "bindingDigest")
        : null,
    }),
  )}`;
}

function normalizeRequiredId(value: string, fieldName: string): string {
  const normalized = value.trim().toLowerCase();
  if (!/^[a-z0-9][a-z0-9-]{1,47}$/.test(normalized)) {
    throw new Error(`invalid_external_app_${fieldName}`);
  }
  return normalized;
}

function optionalServerKeyVersion(
  value: string | null | undefined,
): { serverKeyVersion?: string } {
  return optionalStringField("serverKeyVersion", value);
}

function optionalTranscriptionMode(
  value: BuildAppRoomClaimPayloadInput["transcriptionMode"],
): { transcriptionMode?: AppRoomClaimPayload["transcriptionMode"] } {
  if (value === undefined || value === null) return {};
  const normalized = String(value).trim().toLowerCase();
  if (!normalized) return {};
  if (
    normalized === "off" ||
    normalized === "live_caption" ||
    normalized === "transcript" ||
    normalized === "recap" ||
    normalized === "full"
  ) {
    return { transcriptionMode: normalized };
  }
  throw new Error("invalid_external_app_transcriptionMode");
}

function optionalVoicePolicy(
  value: AppRoomVoicePolicy | null | undefined,
): { voicePolicy?: AppRoomVoicePolicy } {
  if (value === undefined || value === null) return {};
  if (typeof value !== "object" || Array.isArray(value)) {
    throw new Error("invalid_external_app_voicePolicy");
  }
  const voicePolicy: AppRoomVoicePolicy = {};
  if (value.maxSpeakers !== undefined) {
    if (!Number.isSafeInteger(value.maxSpeakers) || value.maxSpeakers <= 0) {
      throw new Error("invalid_external_app_voicePolicy");
    }
    voicePolicy.maxSpeakers = value.maxSpeakers;
  }
  if (value.overflowStrategy !== undefined) {
    voicePolicy.overflowStrategy = normalizeRequiredString(
      value.overflowStrategy,
      "voicePolicy",
    ).toLowerCase();
  }
  if (value.moderatorRoles !== undefined) {
    if (!Array.isArray(value.moderatorRoles)) {
      throw new Error("invalid_external_app_voicePolicy");
    }
    const moderatorRoles = uniqueSorted(
      value.moderatorRoles
        .map((role) => String(role || "").trim().toLowerCase())
        .filter(Boolean),
    );
    if (moderatorRoles.length > 0) {
      voicePolicy.moderatorRoles = moderatorRoles;
    }
  }
  return Object.keys(voicePolicy).length > 0 ? { voicePolicy } : {};
}

function normalizePositiveInteger(value: number, fieldName: string): number {
  if (!Number.isSafeInteger(value) || value <= 0) {
    throw new Error(`invalid_external_app_${fieldName}`);
  }
  return value;
}

function normalizeSourceOriginType(
  value: BuildSourceSubmissionClaimPayloadInput["originType"],
): SourceSubmissionClaimPayload["originType"] {
  const normalized = String(value || "").trim().toLowerCase();
  if (
    normalized === "communication_message" ||
    normalized === "voice_recap" ||
    normalized === "external_summary"
  ) {
    return normalized;
  }
  throw new Error("invalid_external_app_originType");
}

function normalizeEvidencePrivacyClass(
  value: BuildSourceSubmissionClaimPayloadInput["evidencePrivacyClass"],
): SourceSubmissionClaimPayload["evidencePrivacyClass"] {
  const normalized = String(value || "").trim().toLowerCase();
  if (
    normalized === "public" ||
    normalized === "circle_only" ||
    normalized === "reviewer_only" ||
    normalized === "sealed"
  ) {
    return normalized;
  }
  throw new Error("invalid_external_app_evidencePrivacyClass");
}

function optionalSourceLifecycleStatus(
  value: BuildSourceSubmissionClaimPayloadInput["requestedLifecycleStatus"],
): Pick<SourceSubmissionClaimPayload, "requestedLifecycleStatus"> {
  if (value === undefined || value === null) return {};
  const normalized = String(value).trim().toLowerCase();
  if (!normalized) return {};
  if (
    normalized === "nominated" ||
    normalized === "submitted" ||
    normalized === "review_pending"
  ) {
    return { requestedLifecycleStatus: normalized };
  }
  throw new Error("invalid_external_app_requestedLifecycleStatus");
}

function optionalStringField<K extends string>(
  fieldName: K,
  value: string | null | undefined,
): { [P in K]?: string } {
  if (value === undefined || value === null) return {};
  const normalized = String(value).trim();
  return normalized ? ({ [fieldName]: normalized } as { [P in K]?: string }) : {};
}

function normalizeAllowedOrigins(value: string[]): string[] {
  if (!Array.isArray(value)) {
    return [];
  }
  return uniqueSorted(value.map(normalizeAllowedOrigin));
}

function normalizeAllowedOrigin(value: string): string {
  const raw = String(value || "").trim();
  let parsed: URL;
  try {
    parsed = new URL(raw);
  } catch {
    throw new Error("invalid_external_app_manifest");
  }
  if (
    (parsed.protocol !== "http:" && parsed.protocol !== "https:") ||
    parsed.username ||
    parsed.password ||
    parsed.pathname !== "/" ||
    parsed.search ||
    parsed.hash
  ) {
    throw new Error("invalid_external_app_manifest");
  }
  return parsed.origin;
}

function normalizeManifestUrl(value: string): string {
  const raw = String(value || "").trim();
  try {
    const parsed = new URL(raw);
    if (parsed.protocol !== "https:") {
      throw new Error("invalid protocol");
    }
    return parsed.toString();
  } catch {
    throw new Error("invalid_external_app_manifest");
  }
}

function normalizeUrl(value: string, fieldName: string): string {
  try {
    const url = new URL(value.trim());
    if (url.protocol !== "https:" && !url.hostname.match(/^(localhost|127\.0\.0\.1)$/)) {
      throw new Error("external_app_url_requires_https");
    }
    return url.toString().replace(/\/$/, "");
  } catch {
    throw new Error(`invalid_external_app_${fieldName}`);
  }
}

function asRecord(value: unknown): Record<string, unknown> | undefined {
  return value && typeof value === "object" && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : undefined;
}

function normalizeSha256Digest(value: string, fieldName: string): string {
  const normalized = value.trim().toLowerCase();
  if (!/^sha256:[a-f0-9]{64}$/.test(normalized)) {
    throw new Error(`invalid_external_app_${fieldName}`);
  }
  return normalized;
}

function normalizeExternalAppDigest(value: string, fieldName: string): string {
  const normalized = value.trim().toLowerCase();
  if (/^sha256:[a-f0-9]{64}$/.test(normalized)) return normalized;
  if (/^[a-f0-9]{64}$/.test(normalized)) return `sha256:${normalized}`;
  throw new Error(`invalid_external_app_${fieldName}`);
}

function normalizeRequiredString(value: string, fieldName: string): string {
  const normalized = String(value || "").trim();
  if (!normalized) throw new Error(`invalid_external_app_${fieldName}`);
  return normalized;
}

function normalizeRiskDisclaimerScope(
  value: ExternalAppRiskDisclaimerScope,
): ExternalAppRiskDisclaimerScope {
  if (
    value === "developer_registration" ||
    value === "external_app_entry" ||
    value === "challenge_bond" ||
    value === "bond_disposition"
  ) {
    return value;
  }
  throw new Error("invalid_external_app_riskDisclaimerScope");
}

function uniqueSorted(values: string[]): string[] {
  return Array.from(new Set(values.filter(Boolean))).sort();
}

function stableStringify(value: unknown): string {
  if (Array.isArray(value)) {
    return `[${value.map(stableStringify).join(",")}]`;
  }
  if (value && typeof value === "object") {
    const record = value as Record<string, unknown>;
    return `{${Object.keys(record)
      .sort()
      .map((key) => `${JSON.stringify(key)}:${stableStringify(record[key])}`)
      .join(",")}}`;
  }
  return JSON.stringify(value);
}
