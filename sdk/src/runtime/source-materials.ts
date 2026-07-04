import { parseApiErrorResponse } from "./errors";
import { resolveRuntimeFetch } from "./fetch";
import type {
  SourceMaterialStatusClaim,
  SourceSubmissionClaim,
} from "../server";

type FetchLike = typeof fetch;

export interface ExternalProgramSourceMaterialSubmission {
  roomKey: string;
  originType: "communication_message" | "voice_recap" | "external_summary";
  originRef: string;
  targetCircleId: number;
  summaryText: string;
  evidencePrivacyClass: "public" | "circle_only" | "reviewer_only" | "sealed";
  requestedLifecycleStatus?: "nominated" | "submitted" | "review_pending";
  submittedByPubkey?: string;
  sourceSubmissionClaim?: SourceSubmissionClaim;
}

export interface ExternalProgramSourceMaterialSubmissionResult {
  ok: boolean;
  sourceMaterialId: number;
  lifecycleStatus: string;
  circleId: number;
}

export interface ExternalProgramSourceMaterialStatus {
  id: number;
  externalAppId: string;
  circleId: number;
  originType: string;
  originRef: string | null;
  roomKey: string | null;
  lifecycleStatus: string;
  statusGroup: "review_queue" | "grounded" | "terminal";
  canAppearInKnowledgeContext: boolean;
  evidencePrivacyClass: string;
  claimDigestRecorded: boolean;
  updatedAt: string | null;
}

export interface ExternalProgramSourceMaterialStatusResult {
  ok: boolean;
  status: ExternalProgramSourceMaterialStatus;
}

export async function submitExternalProgramSourceMaterial(options: {
  apiBaseUrl: string;
  appId: string;
  request: ExternalProgramSourceMaterialSubmission;
  fetch?: FetchLike;
}): Promise<ExternalProgramSourceMaterialSubmissionResult> {
  const fetchImpl = resolveRuntimeFetch(options.fetch);
  const response = await fetchImpl(
    `${normalizeApiBaseUrl(options.apiBaseUrl)}/external-apps/${encodeURIComponent(options.appId)}/source-materials`,
    {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
      },
      body: JSON.stringify(options.request),
    },
  );
  if (!response.ok) {
    throw await parseApiErrorResponse(
      response,
      "source_material_submission_failed",
    );
  }
  return response.json() as Promise<ExternalProgramSourceMaterialSubmissionResult>;
}

export async function fetchExternalProgramSourceMaterialStatusById(options: {
  apiBaseUrl: string;
  appId: string;
  sourceMaterialId: number;
  sourceMaterialStatusClaim: SourceMaterialStatusClaim;
  fetch?: FetchLike;
}): Promise<ExternalProgramSourceMaterialStatusResult> {
  const fetchImpl = resolveRuntimeFetch(options.fetch);
  const apiBaseUrl = normalizeApiBaseUrl(options.apiBaseUrl);
  const appId = encodeURIComponent(options.appId);
  const sourceMaterialId = encodeURIComponent(String(options.sourceMaterialId));
  const response = await fetchImpl(
    `${apiBaseUrl}/external-apps/${appId}/source-materials/${sourceMaterialId}/status`,
    {
      method: "GET",
      headers: sourceMaterialStatusClaimHeaders(options.sourceMaterialStatusClaim),
    },
  );
  if (!response.ok) {
    throw await parseApiErrorResponse(
      response,
      "source_material_status_failed",
    );
  }
  return response.json() as Promise<ExternalProgramSourceMaterialStatusResult>;
}

export async function fetchExternalProgramSourceMaterialStatusByOrigin(options: {
  apiBaseUrl: string;
  appId: string;
  originType: ExternalProgramSourceMaterialSubmission["originType"];
  originRef: string;
  sourceMaterialStatusClaim: SourceMaterialStatusClaim;
  fetch?: FetchLike;
}): Promise<ExternalProgramSourceMaterialStatusResult> {
  const fetchImpl = resolveRuntimeFetch(options.fetch);
  const apiBaseUrl = normalizeApiBaseUrl(options.apiBaseUrl);
  const appId = encodeURIComponent(options.appId);
  const params = new URLSearchParams({
    originType: options.originType,
    originRef: options.originRef,
  });
  const response = await fetchImpl(
    `${apiBaseUrl}/external-apps/${appId}/source-materials/status?${params.toString()}`,
    {
      method: "GET",
      headers: sourceMaterialStatusClaimHeaders(options.sourceMaterialStatusClaim),
    },
  );
  if (!response.ok) {
    throw await parseApiErrorResponse(
      response,
      "source_material_status_failed",
    );
  }
  return response.json() as Promise<ExternalProgramSourceMaterialStatusResult>;
}

function normalizeApiBaseUrl(apiBaseUrl: string): string {
  return apiBaseUrl.replace(/\/+$/, "");
}

function sourceMaterialStatusClaimHeaders(
  claim: SourceMaterialStatusClaim,
): Record<string, string> {
  return {
    "x-external-program-status-claim-payload": claim.payload,
    "x-external-program-status-claim-signature": claim.signature,
  };
}
