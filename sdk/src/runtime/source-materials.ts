import { parseApiErrorResponse } from "./errors";
import { resolveRuntimeFetch } from "./fetch";

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
  sourceSubmissionClaim?: {
    payload: string;
    signature: string;
  };
}

export interface ExternalProgramSourceMaterialSubmissionResult {
  ok: boolean;
  sourceMaterialId: number;
  lifecycleStatus: string;
  circleId: number;
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

function normalizeApiBaseUrl(apiBaseUrl: string): string {
  return apiBaseUrl.replace(/\/+$/, "");
}
