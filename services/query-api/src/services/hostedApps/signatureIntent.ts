export interface SignatureIntentInput {
  purpose: string;
  humanReadableSummary?: string;
  chainId?: string;
  programOrContract?: string;
  method?: string;
  accounts?: string[];
  amount?: string;
  spender?: string | null;
  typedDataDomain?: string | null;
  typedPayload?: unknown;
  simulationResultDigest?: string;
  riskExplanation?: string;
  payloadDigest?: string;
  previewDigest?: string;
  replayDomain?: string;
  nonce?: string;
  appId?: string;
  releaseId?: string;
  manifestHash?: string;
  circleId?: number;
  userPubkey?: string;
  riskLevel?: string;
  signer?: string;
  expiresAt?: string;
}

export function validateSignatureIntent(input: SignatureIntentInput): void {
  if (input.purpose === "opaque_message") {
    throw new Error("hosted_app_opaque_signature_denied");
  }
  if (input.purpose !== "chain_transaction") {
    throw new Error("hosted_app_signature_purpose_unsupported");
  }
  if (input.purpose === "chain_transaction") {
    const required: Array<keyof SignatureIntentInput> = [
      "chainId",
      "programOrContract",
      "method",
      "simulationResultDigest",
      "riskExplanation",
      "payloadDigest",
      "previewDigest",
      "replayDomain",
      "nonce",
      "appId",
      "releaseId",
      "manifestHash",
      "circleId",
      "userPubkey",
      "riskLevel",
      "signer",
      "expiresAt",
    ];
    for (const field of required) {
      if (!input[field]) throw new Error(`hosted_app_signature_${field}_required`);
    }
    if (!Array.isArray(input.accounts) || input.accounts.length === 0) {
      throw new Error("hosted_app_signature_accounts_required");
    }
  }
}
