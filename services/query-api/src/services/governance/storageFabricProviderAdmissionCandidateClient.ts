import { createHash } from 'node:crypto';

import { loadNodeRuntimeConfig } from '../../config/services';

export class ProviderAdmissionCandidateClientError extends Error {
  statusCode: number;
  code: string;

  constructor(statusCode: number, code: string) {
    super(code);
    this.name = 'ProviderAdmissionCandidateClientError';
    this.statusCode = statusCode;
    this.code = code;
  }
}

const DEFAULT_TIMEOUT_MS = 5_000;
const MAX_RESPONSE_BYTES = 64 * 1024;
const EXECUTION_TARGET_REF = 'storage-fabric:provider-registry:devnet-demo' as const;
const MAPPING_VERSION = 'storage-fabric.provider-admission.v1' as const;

export type ProviderAdmissionCandidateStatusSummary =
  | 'eligible'
  | 'ineligible'
  | 'retired'
  | 'already_admitted';

export type PublicSafeProviderAdmissionCandidate = {
  candidateRef: string;
  displayName: string;
  statusSummary: ProviderAdmissionCandidateStatusSummary;
  capacitySummary: string;
  policySummary: string;
  snapshotVersion: string;
  snapshotDigest: string;
  expiresAt: string;
};

export type PublicSafeProviderAdmissionCandidatePage = {
  items: PublicSafeProviderAdmissionCandidate[];
  nextCursor: string | null;
};

export type ProviderAdmissionCandidateCanonicalFacts = {
  providerId: string;
  providerPubkey: string;
  capacityCommitmentDigest: string;
  executionTargetRef: typeof EXECUTION_TARGET_REF;
  policyDigest: string;
  statePrecondition: {
    providerId: string;
    providerStatus: 'candidate';
    settlementState: 'not_admitted';
    mappingVersion: typeof MAPPING_VERSION;
  };
};

export type ProviderAdmissionCandidateSnapshot = PublicSafeProviderAdmissionCandidate & {
  canonicalFacts: ProviderAdmissionCandidateCanonicalFacts;
};

export type DerivedProviderAdmissionIntent = {
  subjectType: 'external_provider';
  subjectRef: string;
  operationPayload: {
    providerId: string;
    providerPubkey: string;
    capacityCommitmentDigest: string;
    executionTargetRef: typeof EXECUTION_TARGET_REF;
    policyDigest: string;
  };
  statePrecondition: ProviderAdmissionCandidateCanonicalFacts['statePrecondition'];
  snapshotVersion: string;
  snapshotDigest: string;
  expiresAt: string;
  connectorTrustProfile: 'storage-fabric-provider-admission-sidecar-v1';
};

export interface StorageFabricProviderAdmissionCandidateClient {
  listCandidates(input?: {
    cursor?: string;
    limit?: number;
    status?: ProviderAdmissionCandidateStatusSummary;
  }): Promise<PublicSafeProviderAdmissionCandidatePage>;
  getSnapshot(candidateRef: string): Promise<ProviderAdmissionCandidateSnapshot>;
  resolveCanonicalIntent(input: {
    candidateRef: string;
    expectedSnapshotVersion: string;
    expectedSnapshotDigest: string;
  }): Promise<DerivedProviderAdmissionIntent>;
}

export function createStorageFabricProviderAdmissionCandidateClient(options: {
  baseUrl: string;
  fetchImpl?: typeof fetch;
  timeoutMs?: number;
  authSecret?: string | null;
}): StorageFabricProviderAdmissionCandidateClient {
  const baseUrl = normalizeTrustedBaseUrl(options.baseUrl);
  const fetchImpl = options.fetchImpl ?? fetch;
  const timeoutMs = normalizeTimeout(options.timeoutMs);
  const authSecret = String(options.authSecret || '').trim() || null;
  return {
    listCandidates: (input) => listCandidates({
      baseUrl, fetchImpl, timeoutMs, authSecret, input,
    }),
    getSnapshot: (candidateRef) => getSnapshot({
      baseUrl, fetchImpl, timeoutMs, authSecret, candidateRef,
    }),
    resolveCanonicalIntent: (input) => resolveCanonicalIntent({
      baseUrl,
      fetchImpl,
      timeoutMs,
      authSecret,
      input,
    }),
  };
}

export function createStorageFabricProviderAdmissionCandidateClientFromRuntime(input?: {
  runtimeRole?: 'PUBLIC_NODE' | 'PRIVATE_SIDECAR';
  env?: NodeJS.ProcessEnv;
  fetchImpl?: typeof fetch;
}): StorageFabricProviderAdmissionCandidateClient | undefined {
  const env = input?.env ?? process.env;
  const runtimeRole = input?.runtimeRole ?? loadNodeRuntimeConfig(env).runtimeRole;
  if (runtimeRole !== 'PRIVATE_SIDECAR') return undefined;
  const baseUrl = String(env.STORAGE_FABRIC_PROVIDER_ADMISSION_READBACK_BASE_URL ?? '').trim();
  if (!baseUrl) return undefined;
  const authSecret = String(
    env.STORAGE_FABRIC_PROVIDER_ADMISSION_CANDIDATE_AUTH_SECRET || '',
  ).trim();
  if (!authSecret) return undefined;
  return createStorageFabricProviderAdmissionCandidateClient({
    baseUrl,
    fetchImpl: input?.fetchImpl,
    timeoutMs: parseTimeout(env.STORAGE_FABRIC_PROVIDER_ADMISSION_READBACK_TIMEOUT_MS),
    authSecret,
  });
}

async function listCandidates(input: {
  baseUrl: URL;
  fetchImpl: typeof fetch;
  timeoutMs: number;
  authSecret: string | null;
  input?: {
    cursor?: string;
    limit?: number;
    status?: ProviderAdmissionCandidateStatusSummary;
  };
}): Promise<PublicSafeProviderAdmissionCandidatePage> {
  const url = new URL('/v1/provider-admission/candidates', input.baseUrl);
  if (input.input?.cursor) url.searchParams.set('cursor', input.input.cursor);
  if (input.input?.limit != null) url.searchParams.set('limit', String(input.input.limit));
  if (input.input?.status) url.searchParams.set('status', input.input.status);
  const wire = await fetchJson({ ...input, url });
  if (!wire || typeof wire !== 'object' || Array.isArray(wire)) unavailable();
  const items = Array.isArray((wire as any).items) ? (wire as any).items : null;
  if (!items) unavailable();
  return {
    items: items.map(projectPublicSafeCandidate),
    nextCursor: typeof (wire as any).nextCursor === 'string' ? (wire as any).nextCursor : null,
  };
}

async function getSnapshot(input: {
  baseUrl: URL;
  fetchImpl: typeof fetch;
  timeoutMs: number;
  authSecret: string | null;
  candidateRef: string;
}): Promise<ProviderAdmissionCandidateSnapshot> {
  const candidateRef = requiredRef(input.candidateRef, 'candidate_ref');
  const url = new URL(
    `/v1/provider-admission/candidates/${encodeURIComponent(candidateRef)}/snapshot`,
    input.baseUrl,
  );
  const wire = await fetchJson({ ...input, url, notFoundCode: 'provider_admission_candidate_not_found' });
  const publicSafe = projectPublicSafeCandidate(wire);
  const facts = (wire as any).canonicalFacts;
  if (!facts || typeof facts !== 'object' || Array.isArray(facts)) unavailable();
  const state = facts.statePrecondition;
  if (!state || typeof state !== 'object' || Array.isArray(state)) unavailable();
  if (
    String(facts.providerId || '') !== publicSafe.candidateRef
    || String(facts.executionTargetRef || '') !== EXECUTION_TARGET_REF
    || String(state.providerId || '') !== String(facts.providerId || '')
    || String(state.providerStatus || '') !== 'candidate'
    || String(state.settlementState || '') !== 'not_admitted'
    || String(state.mappingVersion || '') !== MAPPING_VERSION
  ) {
    throw new ProviderAdmissionCandidateClientError(409, 'provider_admission_candidate_snapshot_invalid');
  }
  const capacityCommitmentDigest = normalizeDigest(facts.capacityCommitmentDigest);
  const policyDigest = normalizeDigest(facts.policyDigest);
  const digestInput = {
    providerId: String(facts.providerId),
    providerPubkey: requiredRef(facts.providerPubkey, 'provider_pubkey'),
    capacityCommitmentDigest: capacityCommitmentDigest.replace(/^sha256:/, ''),
    executionTargetRef: EXECUTION_TARGET_REF,
    policyDigest: policyDigest.replace(/^sha256:/, ''),
    statePrecondition: {
      providerId: String(state.providerId),
      providerStatus: 'candidate' as const,
      settlementState: 'not_admitted' as const,
      mappingVersion: MAPPING_VERSION,
    },
  };
  const recomputedDigest = createHash('sha256')
    .update(canonicalReceiptJson(digestInput), 'utf8')
    .digest('hex');
  if (recomputedDigest !== normalizeDigest(publicSafe.snapshotDigest).replace(/^sha256:/, '')) {
    throw new ProviderAdmissionCandidateClientError(409, 'provider_admission_candidate_snapshot_invalid');
  }
  return {
    ...publicSafe,
    snapshotDigest: recomputedDigest,
    canonicalFacts: {
      providerId: digestInput.providerId,
      providerPubkey: digestInput.providerPubkey,
      capacityCommitmentDigest,
      executionTargetRef: EXECUTION_TARGET_REF,
      policyDigest,
      statePrecondition: digestInput.statePrecondition,
    },
  };
}

async function resolveCanonicalIntent(input: {
  baseUrl: URL;
  fetchImpl: typeof fetch;
  timeoutMs: number;
  authSecret: string | null;
  input: {
    candidateRef: string;
    expectedSnapshotVersion: string;
    expectedSnapshotDigest: string;
  };
}): Promise<DerivedProviderAdmissionIntent> {
  const snapshot = await getSnapshot({
    baseUrl: input.baseUrl,
    fetchImpl: input.fetchImpl,
    timeoutMs: input.timeoutMs,
    authSecret: input.authSecret,
    candidateRef: input.input.candidateRef,
  });
  const expectedVersion = String(input.input.expectedSnapshotVersion || '').trim();
  const expectedDigest = normalizeDigest(input.input.expectedSnapshotDigest);
  if (
    !expectedVersion
    || snapshot.snapshotVersion !== expectedVersion
    || normalizeDigest(snapshot.snapshotDigest) !== expectedDigest
  ) {
    throw new ProviderAdmissionCandidateClientError(409, 'provider_admission_candidate_snapshot_stale');
  }
  if (snapshot.statusSummary !== 'eligible') {
    throw new ProviderAdmissionCandidateClientError(
      409,
      `provider_admission_candidate_${snapshot.statusSummary}`,
    );
  }
  const expiresAtMs = Date.parse(snapshot.expiresAt);
  if (!Number.isFinite(expiresAtMs) || expiresAtMs <= Date.now()) {
    throw new ProviderAdmissionCandidateClientError(409, 'provider_admission_candidate_expired');
  }
  return {
    subjectType: 'external_provider',
    subjectRef: snapshot.canonicalFacts.providerId,
    operationPayload: {
      providerId: snapshot.canonicalFacts.providerId,
      providerPubkey: snapshot.canonicalFacts.providerPubkey,
      capacityCommitmentDigest: snapshot.canonicalFacts.capacityCommitmentDigest,
      executionTargetRef: snapshot.canonicalFacts.executionTargetRef,
      policyDigest: snapshot.canonicalFacts.policyDigest,
    },
    statePrecondition: snapshot.canonicalFacts.statePrecondition,
    snapshotVersion: snapshot.snapshotVersion,
    snapshotDigest: normalizeDigest(snapshot.snapshotDigest),
    expiresAt: snapshot.expiresAt,
    connectorTrustProfile: 'storage-fabric-provider-admission-sidecar-v1',
  };
}

function projectPublicSafeCandidate(value: unknown): PublicSafeProviderAdmissionCandidate {
  if (!value || typeof value !== 'object' || Array.isArray(value)) unavailable();
  const record = value as Record<string, unknown>;
  const status = String(record.statusSummary || '');
  if (
    status !== 'eligible'
    && status !== 'ineligible'
    && status !== 'retired'
    && status !== 'already_admitted'
  ) {
    unavailable();
  }
  return {
    candidateRef: requiredRef(record.candidateRef, 'candidate_ref'),
    displayName: requiredText(record.displayName, 1, 256, 'display_name'),
    statusSummary: status,
    capacitySummary: requiredText(record.capacitySummary, 1, 512, 'capacity_summary'),
    policySummary: requiredText(record.policySummary, 1, 512, 'policy_summary'),
    snapshotVersion: requiredText(record.snapshotVersion, 1, 512, 'snapshot_version'),
    snapshotDigest: normalizeDigest(record.snapshotDigest).replace(/^sha256:/, ''),
    expiresAt: requiredText(record.expiresAt, 1, 64, 'expires_at'),
  };
}

async function fetchJson(input: {
  baseUrl: URL;
  fetchImpl: typeof fetch;
  timeoutMs: number;
  authSecret?: string | null;
  url: URL;
  notFoundCode?: string;
}): Promise<Record<string, unknown>> {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), input.timeoutMs);
  try {
    const headers: Record<string, string> = { accept: 'application/json' };
    if (input.authSecret) {
      headers['x-storage-fabric-hook-secret'] = input.authSecret;
    }
    const response = await input.fetchImpl(input.url, {
      method: 'GET',
      headers,
      redirect: 'error',
      signal: controller.signal,
    });
    if (response.status === 401 || response.status === 403) {
      throw new ProviderAdmissionCandidateClientError(503, 'provider_admission_candidate_unavailable');
    }
    if (response.status === 404 && input.notFoundCode) {
      throw new ProviderAdmissionCandidateClientError(404, input.notFoundCode);
    }
    if (response.status === 409) {
      const body = await readBoundedJson(response).catch(() => null);
      const code = typeof body?.error === 'object' && body?.error && !Array.isArray(body.error)
        ? String((body.error as any).code || '')
        : '';
      throw new ProviderAdmissionCandidateClientError(
        409,
        code.startsWith('provider_admission_candidate_')
          ? code
          : 'provider_admission_candidate_unavailable',
      );
    }
    if (!response.ok) unavailable();
    return await readBoundedJson(response);
  } catch (error) {
    if (error instanceof ProviderAdmissionCandidateClientError) throw error;
    unavailable();
  } finally {
    clearTimeout(timeout);
  }
}

async function readBoundedJson(response: Response): Promise<Record<string, unknown>> {
  const contentType = response.headers.get('content-type') ?? '';
  if (!/^application\/json(?:\s*;|$)/i.test(contentType)) unavailable();
  const contentLength = Number(response.headers.get('content-length') ?? '0');
  if (Number.isFinite(contentLength) && contentLength > MAX_RESPONSE_BYTES) unavailable();
  const reader = response.body?.getReader();
  if (!reader) unavailable();
  const chunks: Uint8Array[] = [];
  let total = 0;
  while (true) {
    const { done, value } = await reader.read();
    if (done) break;
    if (!value) continue;
    total += value.byteLength;
    if (total > MAX_RESPONSE_BYTES) {
      await reader.cancel();
      unavailable();
    }
    chunks.push(value);
  }
  const bytes = new Uint8Array(total);
  let offset = 0;
  for (const chunk of chunks) {
    bytes.set(chunk, offset);
    offset += chunk.byteLength;
  }
  let parsed: unknown;
  try {
    parsed = JSON.parse(new TextDecoder().decode(bytes));
  } catch {
    unavailable();
  }
  if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) unavailable();
  return parsed as Record<string, unknown>;
}

function normalizeTrustedBaseUrl(value: string): URL {
  let url: URL;
  try {
    url = new URL(value);
  } catch {
    throw new Error('storage_fabric_readback_base_url_invalid');
  }
  if (
    url.protocol !== 'https:'
    || url.username
    || url.password
    || url.search
    || url.hash
    || (url.pathname !== '/' && url.pathname !== '')
  ) {
    throw new Error('storage_fabric_readback_base_url_invalid');
  }
  return url;
}

function normalizeTimeout(value: number | undefined): number {
  if (value == null) return DEFAULT_TIMEOUT_MS;
  if (!Number.isSafeInteger(value) || value < 250 || value > 10_000) {
    throw new Error('storage_fabric_readback_timeout_invalid');
  }
  return value;
}

function parseTimeout(value: string | undefined): number | undefined {
  const normalized = String(value ?? '').trim();
  if (!normalized) return undefined;
  return Number(normalized);
}

function normalizeDigest(value: unknown): string {
  const normalized = typeof value === 'string' ? value.trim().toLowerCase() : '';
  if (!/^(?:sha256:)?[a-f0-9]{64}$/.test(normalized)) {
    throw new ProviderAdmissionCandidateClientError(409, 'provider_admission_candidate_snapshot_invalid');
  }
  return normalized.startsWith('sha256:') ? normalized : `sha256:${normalized}`;
}

/** Matches Storage Fabric `canonicalReceiptJson` for snapshotDigest recompute. */
function canonicalReceiptJson(value: unknown): string {
  if (value === null) return 'null';
  switch (typeof value) {
    case 'boolean':
      return value ? 'true' : 'false';
    case 'number':
      if (!Number.isFinite(value)) {
        throw new ProviderAdmissionCandidateClientError(409, 'provider_admission_candidate_snapshot_invalid');
      }
      return JSON.stringify(value);
    case 'string':
      return JSON.stringify(value);
    case 'object': {
      if (Array.isArray(value)) {
        return `[${value.map((entry) => canonicalReceiptJson(entry)).join(',')}]`;
      }
      const prototype = Object.getPrototypeOf(value);
      if (prototype !== Object.prototype && prototype !== null) {
        throw new ProviderAdmissionCandidateClientError(409, 'provider_admission_candidate_snapshot_invalid');
      }
      const record = value as Record<string, unknown>;
      return `{${Object.keys(record).sort()
        .map((key) => {
          if (record[key] === undefined) {
            throw new ProviderAdmissionCandidateClientError(409, 'provider_admission_candidate_snapshot_invalid');
          }
          return `${JSON.stringify(key)}:${canonicalReceiptJson(record[key])}`;
        })
        .join(',')}}`;
    }
    default:
      throw new ProviderAdmissionCandidateClientError(409, 'provider_admission_candidate_snapshot_invalid');
  }
}

function requiredRef(value: unknown, field: string): string {
  const text = String(value ?? '').trim();
  if (!/^[A-Za-z0-9][A-Za-z0-9._:-]{0,127}$/.test(text)) {
    throw new ProviderAdmissionCandidateClientError(400, `provider_admission_${field}_invalid`);
  }
  return text;
}

function requiredText(
  value: unknown,
  min: number,
  max: number,
  field: string,
): string {
  const text = String(value ?? '').trim();
  if (text.length < min || text.length > max) {
    throw new ProviderAdmissionCandidateClientError(409, `provider_admission_${field}_invalid`);
  }
  return text;
}

function unavailable(): never {
  throw new ProviderAdmissionCandidateClientError(503, 'provider_admission_candidate_unavailable');
}
