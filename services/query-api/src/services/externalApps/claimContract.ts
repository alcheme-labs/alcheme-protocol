export const EXTERNAL_PROGRAM_CLAIM_CONTRACT_VERSION = "external_program.claim.v1";
export const EXTERNAL_PROGRAM_CLAIM_PAYLOAD_ENCODING = "base64url_json";
export const EXTERNAL_PROGRAM_CLAIM_SIGNATURE_ENCODING = "base64";
export const EXTERNAL_PROGRAM_CLAIM_SIGNING_INPUT = "encoded_payload_string";
export const EXTERNAL_PROGRAM_SUMMARY_DIGEST = "sha256_hex";

export interface ExternalProgramClaimContractFields {
  claimContractVersion?: string | null;
  serverKeyVersion?: string | null;
}

export function assertExternalProgramClaimContractVersion(
  payload: ExternalProgramClaimContractFields,
  errorCode: string,
  options: { allowMissingVersion?: boolean } = {},
): void {
  if (!payload.claimContractVersion && !options.allowMissingVersion) {
    throw new Error(errorCode);
  }
  if (
    payload.claimContractVersion &&
    payload.claimContractVersion !== EXTERNAL_PROGRAM_CLAIM_CONTRACT_VERSION
  ) {
    throw new Error(errorCode);
  }
}
