export interface AIReviewEvidence {
  suggestionId: string;
  suggestedCapabilityIds: string[];
  manifestSummary: string;
  riskSummary: string;
  runtimeAuthority: false;
  authorizationDecision: false;
}

export function buildAiCapabilityReviewSuggestion(input: {
  requestedCapabilities: string[];
  catalogCapabilities: string[];
  manifestSummary: string;
}): AIReviewEvidence {
  const catalog = new Set(input.catalogCapabilities);
  const suggestedCapabilityIds = input.requestedCapabilities.filter((capabilityId) =>
    catalog.has(capabilityId),
  );

  return {
    suggestionId: "ai-review-suggestion",
    suggestedCapabilityIds,
    manifestSummary: input.manifestSummary,
    riskSummary: "ai_review_evidence_only",
    runtimeAuthority: false,
    authorizationDecision: false,
  };
}

export function assertAiSuggestionCannotAuthorize(input: {
  suggestionId: string;
  triesToSetDecision?: "allowed" | "denied" | "limited";
}): void {
  if (input.triesToSetDecision) {
    throw new Error("hosted_app_ai_cannot_authorize");
  }
}
