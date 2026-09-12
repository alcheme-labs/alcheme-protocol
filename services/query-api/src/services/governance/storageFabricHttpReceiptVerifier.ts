import { createHash } from 'node:crypto';

import { GovernanceCaseWorkflowError } from './governanceCaseWorkflow';
import {
  normalizeVerifiedStorageFabricProviderAdmissionBinding,
  type StorageFabricReceiptVerificationInput,
  type StorageFabricReceiptVerifier,
  type VerifiedStorageFabricProviderAdmissionBinding,
} from './storageFabricReceiptVerifier';

const READBACK_SCHEMA_VERSION = 'ProviderAdmissionExecutionReadback/v1' as const;
const EVIDENCE_REF_PREFIX = 'storage-fabric:provider-admission-execution:';
const DEFAULT_TIMEOUT_MS = 5_000;
const MAX_RESPONSE_BYTES = 64 * 1024;
const EXACT_READBACK_KEYS = [
  'afterStateDigest',
  'beforeStateDigest',
  'conformanceRunId',
  'credentialJwsDigest',
  'executedAt',
  'idempotencyKey',
  'mandateDigest',
  'mandateId',
  'network',
  'operation',
  'operationPayloadDigest',
  'projectionDigest',
  'providerAdmissionReceiptDigest',
  'providerAdmissionReceiptRef',
  'providerResourceRef',
  'providerStatus',
  'schemaVersion',
  'settlementState',
  'statePreconditionDigest',
  'verificationDecisionId',
].sort();

export interface StorageFabricHttpReceiptVerifierOptions {
  baseUrl: string;
  fetchImpl?: typeof fetch;
  timeoutMs?: number;
}

export function createStorageFabricHttpReceiptVerifier(
  options: StorageFabricHttpReceiptVerifierOptions,
): StorageFabricReceiptVerifier {
  const baseUrl = normalizeTrustedBaseUrl(options.baseUrl);
  const fetchImpl = options.fetchImpl ?? fetch;
  const timeoutMs = normalizeTimeout(options.timeoutMs);
  return {
    verifyProviderAdmissionExecution: (input) => verifyReadback({
      baseUrl,
      fetchImpl,
      timeoutMs,
      input,
    }),
  };
}

export function createStorageFabricHttpReceiptVerifierFromRuntime(input: {
  runtimeRole: 'PUBLIC_NODE' | 'PRIVATE_SIDECAR';
  env?: NodeJS.ProcessEnv;
  fetchImpl?: typeof fetch;
}): StorageFabricReceiptVerifier | undefined {
  if (input.runtimeRole !== 'PRIVATE_SIDECAR') return undefined;
  const env = input.env ?? process.env;
  const baseUrl = String(env.STORAGE_FABRIC_PROVIDER_ADMISSION_READBACK_BASE_URL ?? '').trim();
  if (!baseUrl) return undefined;
  return createStorageFabricHttpReceiptVerifier({
    baseUrl,
    fetchImpl: input.fetchImpl,
    timeoutMs: parseTimeout(env.STORAGE_FABRIC_PROVIDER_ADMISSION_READBACK_TIMEOUT_MS),
  });
}

async function verifyReadback(input: {
  baseUrl: URL;
  fetchImpl: typeof fetch;
  timeoutMs: number;
  input: StorageFabricReceiptVerificationInput;
}): Promise<VerifiedStorageFabricProviderAdmissionBinding> {
  const evidence = requireExecutionEvidence(input.input);
  const url = new URL(
    `/v1/provider-admission/executions/${encodeURIComponent(evidence.operationId)}`,
    input.baseUrl,
  );
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), input.timeoutMs);
  let wire: Record<string, unknown>;
  try {
    const response = await input.fetchImpl(url, {
      method: 'GET',
      headers: { accept: 'application/json' },
      redirect: 'error',
      signal: controller.signal,
    });
    if (response.status === 404) {
      throw new GovernanceCaseWorkflowError(
        409,
        'governance_manual_execution_authoritative_readback_not_found',
      );
    }
    if (response.status === 409) {
      throw new GovernanceCaseWorkflowError(
        409,
        'governance_manual_execution_authoritative_readback_not_final',
      );
    }
    if (!response.ok) {
      throw new GovernanceCaseWorkflowError(
        503,
        'governance_manual_execution_authoritative_readback_unavailable',
      );
    }
    wire = await readBoundedJson(response);
  } catch (error) {
    if (error instanceof GovernanceCaseWorkflowError) throw error;
    throw new GovernanceCaseWorkflowError(
      503,
      'governance_manual_execution_authoritative_readback_unavailable',
    );
  } finally {
    clearTimeout(timeout);
  }
  assertExactReadbackKeys(wire);
  if (wire.schemaVersion !== READBACK_SCHEMA_VERSION) invalidReadback();
  const claimedProjectionDigest = requiredDigest(wire.projectionDigest);
  const projection = { ...wire };
  delete projection.projectionDigest;
  const actualProjectionDigest = `sha256:${createHash('sha256')
    .update(canonicalJson(projection), 'utf8')
    .digest('hex')}`;
  if (
    claimedProjectionDigest !== actualProjectionDigest
    || evidence.digest !== actualProjectionDigest
  ) {
    throw new GovernanceCaseWorkflowError(
      409,
      'governance_manual_execution_authoritative_projection_digest_mismatch',
    );
  }
  const binding = normalizeVerifiedStorageFabricProviderAdmissionBinding(
    wire as unknown as VerifiedStorageFabricProviderAdmissionBinding,
  );
  if (binding.providerResourceRef !== input.input.expectedProviderResourceRef) {
    mismatch('governance_manual_execution_authoritative_provider_mismatch');
  }
  if (binding.credentialJwsDigest !== normalizeDigest(input.input.expectedCredentialJwsDigest)) {
    mismatch('governance_manual_execution_authoritative_credential_mismatch');
  }
  if (binding.operationPayloadDigest !== normalizeDigest(input.input.expectedOperationPayloadDigest)) {
    mismatch('governance_manual_execution_authoritative_operation_payload_mismatch');
  }
  if (binding.statePreconditionDigest !== normalizeDigest(input.input.expectedStatePreconditionDigest)) {
    mismatch('governance_manual_execution_authoritative_state_mismatch');
  }
  return binding;
}

function requireExecutionEvidence(input: StorageFabricReceiptVerificationInput): {
  operationId: string;
  digest: string;
} {
  const matches = input.evidence.filter((item) =>
    item.kind === 'external_receipt' && item.ref.startsWith(EVIDENCE_REF_PREFIX));
  if (matches.length !== 1) {
    throw new GovernanceCaseWorkflowError(
      409,
      'governance_manual_execution_storage_fabric_evidence_required',
    );
  }
  const operationId = matches[0]!.ref.slice(EVIDENCE_REF_PREFIX.length);
  if (!/^[A-Za-z0-9][A-Za-z0-9._-]{0,127}$/.test(operationId)) {
    throw new GovernanceCaseWorkflowError(
      409,
      'governance_manual_execution_storage_fabric_evidence_invalid',
    );
  }
  return { operationId, digest: requiredDigest(matches[0]!.digest) };
}

async function readBoundedJson(response: Response): Promise<Record<string, unknown>> {
  const contentType = response.headers.get('content-type') ?? '';
  if (!/^application\/json(?:\s*;|$)/i.test(contentType)) invalidReadback();
  const contentLength = Number(response.headers.get('content-length') ?? '0');
  if (Number.isFinite(contentLength) && contentLength > MAX_RESPONSE_BYTES) invalidReadback();
  const reader = response.body?.getReader();
  if (!reader) invalidReadback();
  const chunks: Uint8Array[] = [];
  let total = 0;
  while (true) {
    const { done, value } = await reader.read();
    if (done) break;
    if (!value) continue;
    total += value.byteLength;
    if (total > MAX_RESPONSE_BYTES) {
      await reader.cancel();
      invalidReadback();
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
    invalidReadback();
  }
  if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) invalidReadback();
  return parsed as Record<string, unknown>;
}

function assertExactReadbackKeys(value: Record<string, unknown>): void {
  const actual = Object.keys(value).sort();
  if (actual.length !== EXACT_READBACK_KEYS.length) invalidReadback();
  for (let index = 0; index < actual.length; index += 1) {
    if (actual[index] !== EXACT_READBACK_KEYS[index]) invalidReadback();
  }
}

function canonicalJson(value: unknown): string {
  if (value === null) return 'null';
  if (typeof value === 'boolean' || typeof value === 'string') return JSON.stringify(value);
  if (typeof value === 'number') {
    if (!Number.isFinite(value)) invalidReadback();
    return JSON.stringify(value);
  }
  if (Array.isArray(value)) return `[${value.map(canonicalJson).join(',')}]`;
  if (!value || typeof value !== 'object') invalidReadback();
  const prototype = Object.getPrototypeOf(value);
  if (prototype !== Object.prototype && prototype !== null) invalidReadback();
  const record = value as Record<string, unknown>;
  return `{${Object.keys(record)
    .sort()
    .map((key) => `${JSON.stringify(key)}:${canonicalJson(record[key])}`)
    .join(',')}}`;
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
  ) throw new Error('storage_fabric_readback_base_url_invalid');
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

function requiredDigest(value: unknown): string {
  const normalized = normalizeDigest(value);
  if (!normalized) invalidReadback();
  return normalized;
}

function normalizeDigest(value: unknown): string {
  const normalized = typeof value === 'string' ? value.trim().toLowerCase() : '';
  if (!/^(?:sha256:)?[a-f0-9]{64}$/.test(normalized)) return '';
  return normalized.startsWith('sha256:') ? normalized : `sha256:${normalized}`;
}

function mismatch(code: string): never {
  throw new GovernanceCaseWorkflowError(409, code);
}

function invalidReadback(): never {
  throw new GovernanceCaseWorkflowError(
    409,
    'governance_manual_execution_authoritative_readback_invalid',
  );
}
