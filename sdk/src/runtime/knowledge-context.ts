import { parseApiErrorResponse } from "./errors";
import { resolveRuntimeFetch } from "./fetch";
import type { KnowledgeContextClaim } from "../server";

type FetchLike = typeof fetch;

export interface KnowledgeContextRequest {
  appId: string;
  roomKey: string;
  walletPubkey?: string;
  primaryCircleId?: number;
  parentCircleId?: number;
  roomType?: string;
  requestedCapability: "knowledge_context";
  purpose: string;
  knowledgeContextClaim?: KnowledgeContextClaim;
}

export interface KnowledgeContextPackage {
  ok: boolean;
  appId: string;
  roomKey: string;
  circleId: number;
  scope: {
    user: string;
    capability: "knowledge_context";
    purpose: string;
  };
  items: KnowledgeContextItem[];
  cache: {
    keyScope: string;
    ttlSec: number;
  };
  disclaimer: {
    notEndorsement: boolean;
    operatorResponsible: boolean;
  };
}

export interface KnowledgeContextItem {
  kind: "source_material" | "crystal" | "announcement" | "faq";
  id: string;
  title: string;
  summary: string;
  sourceId?: number | string;
  updatedAt: string;
  permissions: {
    canDisplay: boolean;
    canQuote: boolean;
    canContinueDiscussion: boolean;
  };
}

export async function fetchKnowledgeContextPackage(options: {
  apiBaseUrl: string;
  request: KnowledgeContextRequest;
  fetch?: FetchLike;
}): Promise<KnowledgeContextPackage> {
  const fetchImpl = resolveRuntimeFetch(options.fetch);
  const { appId, roomType, ...body } = options.request;
  const response = await fetchImpl(
    `${normalizeApiBaseUrl(options.apiBaseUrl)}/external-apps/${encodeURIComponent(appId)}/knowledge-context`,
    {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        ...body,
        roomType: roomType ?? undefined,
      }),
    },
  );
  if (!response.ok) {
    throw await parseApiErrorResponse(
      response,
      "knowledge_context_request_failed",
    );
  }
  return response.json() as Promise<KnowledgeContextPackage>;
}

function normalizeApiBaseUrl(apiBaseUrl: string): string {
  return apiBaseUrl.replace(/\/+$/, "");
}
