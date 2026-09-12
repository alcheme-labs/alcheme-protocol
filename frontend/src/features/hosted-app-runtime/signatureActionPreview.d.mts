export interface SignatureActionPreviewInput {
  purpose: string;
  chainId: string;
  programOrContract: string;
  method: string;
  accounts?: unknown;
  amount?: unknown;
  spender?: unknown;
  typedDataDomain?: unknown;
  simulationResultDigest: string;
  riskExplanation: string;
  payloadDigest: string;
  previewDigest: string;
  replayDomain: string;
  nonce: string;
  appId: string;
  releaseId: string;
  manifestHash: string;
  circleId: number;
  userPubkey: string;
  riskLevel: string;
  signer?: string;
  expiresAt: string;
}

export function buildSignatureActionPreview(input: SignatureActionPreviewInput): Record<string, unknown>;
export function digestSignatureActionPreview(input: SignatureActionPreviewInput): Promise<string>;
export function stableStringify(value: unknown): string;
