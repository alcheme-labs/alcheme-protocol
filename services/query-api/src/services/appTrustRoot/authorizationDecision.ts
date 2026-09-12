export interface AppTrustRootAuthorizationDecision {
  allowed: boolean;
  reasonCode: string;
  httpStatus: number;
  developerAction: string;
  userCopyKey: string;
  metadata?: Record<string, unknown>;
}

export function allowAppTrustRootAction(input: {
  reasonCode?: string;
  developerAction?: string;
  userCopyKey?: string;
  metadata?: Record<string, unknown>;
} = {}): AppTrustRootAuthorizationDecision {
  return {
    allowed: true,
    reasonCode: input.reasonCode ?? "allowed",
    httpStatus: 200,
    developerAction: input.developerAction ?? "none",
    userCopyKey: input.userCopyKey ?? "app_trust_root.allowed",
    ...(input.metadata ? { metadata: input.metadata } : {}),
  };
}

export function denyAppTrustRootAction(input: {
  reasonCode: string;
  httpStatus?: number;
  developerAction: string;
  userCopyKey?: string;
  metadata?: Record<string, unknown>;
}): AppTrustRootAuthorizationDecision {
  const reasonCode = normalizeDecisionText(input.reasonCode, "reasonCode");
  return {
    allowed: false,
    reasonCode,
    httpStatus: normalizeDenyHttpStatus(input.httpStatus ?? 403),
    developerAction: normalizeDecisionText(input.developerAction, "developerAction"),
    userCopyKey: input.userCopyKey ?? `app_trust_root.${reasonCode}`,
    ...(input.metadata ? { metadata: input.metadata } : {}),
  };
}

function normalizeDecisionText(value: string, field: string): string {
  const normalized = String(value || "").trim();
  if (!normalized) {
    throw new Error(`app_trust_root_authorization_${field}_required`);
  }
  return normalized;
}

function normalizeDenyHttpStatus(value: number): number {
  if (!Number.isInteger(value) || value < 400 || value > 599) {
    throw new Error("app_trust_root_authorization_http_status_invalid");
  }
  return value;
}
