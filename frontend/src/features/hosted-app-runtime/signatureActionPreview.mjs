export function buildSignatureActionPreview(input) {
  return {
    actionId: 'request_signature_intent',
    purpose: requiredString(input.purpose, 'hosted_app_signature_purpose_required'),
    chainId: requiredString(input.chainId, 'hosted_app_signature_chainId_required'),
    programOrContract: requiredString(
      input.programOrContract,
      'hosted_app_signature_programOrContract_required',
    ),
    method: requiredString(input.method, 'hosted_app_signature_method_required'),
    accounts: normalizeStringList(input.accounts),
    amount: optionalString(input.amount),
    spender: optionalString(input.spender),
    typedDataDomain: optionalString(input.typedDataDomain),
    simulationResultDigest: requiredString(
      input.simulationResultDigest,
      'hosted_app_signature_simulationResultDigest_required',
    ),
    riskExplanation: requiredString(input.riskExplanation, 'hosted_app_signature_riskExplanation_required'),
    payloadDigest: requiredString(input.payloadDigest, 'hosted_app_signature_payloadDigest_required'),
    previewDigest: requiredString(input.previewDigest, 'hosted_app_signature_previewDigest_required'),
    replayDomain: requiredString(input.replayDomain, 'hosted_app_signature_replayDomain_required'),
    nonce: requiredString(input.nonce, 'hosted_app_signature_nonce_required'),
    appId: requiredString(input.appId, 'hosted_app_signature_appId_required'),
    releaseId: requiredString(input.releaseId, 'hosted_app_signature_releaseId_required'),
    manifestHash: requiredString(input.manifestHash, 'hosted_app_signature_manifestHash_required'),
    circleId: requiredPositiveNumber(input.circleId, 'hosted_app_signature_circleId_required'),
    userPubkey: requiredString(input.userPubkey, 'hosted_app_signature_userPubkey_required'),
    riskLevel: requiredString(input.riskLevel, 'hosted_app_signature_riskLevel_required'),
    signer: requiredString(input.signer ?? input.userPubkey, 'hosted_app_signature_signer_required'),
    expiresAt: requiredString(input.expiresAt, 'hosted_app_signature_expiresAt_required'),
  };
}

export async function digestSignatureActionPreview(input) {
  return sha256String(stableStringify(buildSignatureActionPreview(input)));
}

export function stableStringify(value) {
  if (Array.isArray(value)) {
    return `[${value.map(stableStringify).join(',')}]`;
  }
  if (value && typeof value === 'object') {
    return `{${Object.keys(value).sort().map((key) =>
      `${JSON.stringify(key)}:${stableStringify(value[key])}`,
    ).join(',')}}`;
  }
  return JSON.stringify(value);
}

function requiredString(value, errorCode) {
  if (typeof value === 'string' && value.trim()) return value.trim();
  throw new Error(errorCode);
}

function optionalString(value) {
  return typeof value === 'string' && value.trim() ? value.trim() : null;
}

function normalizeStringList(value) {
  if (!Array.isArray(value)) return [];
  return value.map((entry) => String(entry).trim()).filter(Boolean);
}

function requiredPositiveNumber(value, errorCode) {
  const numberValue = Number(value);
  if (Number.isFinite(numberValue) && numberValue > 0) return numberValue;
  throw new Error(errorCode);
}

async function sha256String(value) {
  const bytes = new TextEncoder().encode(value);
  const buffer = await globalThis.crypto.subtle.digest('SHA-256', bytes);
  return `sha256:${Array.from(new Uint8Array(buffer))
    .map((byte) => byte.toString(16).padStart(2, '0'))
    .join('')}`;
}
