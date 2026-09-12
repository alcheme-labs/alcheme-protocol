export const APP_TRUST_ROOT_ERROR_CONTRACT_VERSION = "app_trust_root.error.v1";

export interface AppTrustRootErrorContractEntry {
  code: string;
  category: "auth" | "capability" | "configuration" | "governance" | "runtime";
  retryable: boolean;
  developerAction: string;
  userCopyKey: string;
  httpStatus: number;
}

export function defineAppTrustRootErrorContractEntry(
  input: AppTrustRootErrorContractEntry,
): AppTrustRootErrorContractEntry {
  return {
    code: normalizeErrorContractText(input.code, "code"),
    category: input.category,
    retryable: Boolean(input.retryable),
    developerAction: normalizeErrorContractText(input.developerAction, "developerAction"),
    userCopyKey: normalizeErrorContractText(input.userCopyKey, "userCopyKey"),
    httpStatus: normalizeHttpStatus(input.httpStatus),
  };
}

function normalizeErrorContractText(value: string, field: string): string {
  const normalized = String(value || "").trim();
  if (!normalized) {
    throw new Error(`app_trust_root_error_contract_${field}_required`);
  }
  return normalized;
}

function normalizeHttpStatus(value: number): number {
  if (!Number.isInteger(value) || value < 400 || value > 599) {
    throw new Error("app_trust_root_error_contract_http_status_invalid");
  }
  return value;
}
