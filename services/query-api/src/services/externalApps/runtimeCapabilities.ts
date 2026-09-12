import { APP_TRUST_ROOT_ERROR_CONTRACT_VERSION } from "../appTrustRoot/errorContract";
import { DEFAULT_APP_TRUST_ROOT_NONCE_MAX_TTL_MS } from "../appTrustRoot/nonceReplayStore";
import { getDefaultRoomCapabilities } from "../communication/capabilities";
import { loadNodeRuntimeConfig } from "../../config/services";
import {
  loadVoiceRuntimeConfig,
  toPublicVoiceRuntimeConfig,
} from "../../config/voice";
import { externalAppRegistryModeFromEnv } from "./chainRegistryProjection";
import {
  EXTERNAL_PROGRAM_CLAIM_CONTRACT_VERSION,
  EXTERNAL_PROGRAM_CLAIM_PAYLOAD_ENCODING,
  EXTERNAL_PROGRAM_CLAIM_SIGNATURE_ENCODING,
  EXTERNAL_PROGRAM_CLAIM_SIGNING_INPUT,
  EXTERNAL_PROGRAM_SUMMARY_DIGEST,
} from "./claimContract";

export interface ExternalProgramRuntimeCapabilities {
  productName: "External Program";
  apiBasePath: "/api/v1/external-apps";
  claimContract: {
    version: string;
    payloadEncoding: string;
    signatureEncoding: string;
    signingInput: string;
    maxTtlSec: number;
    nonceReplayRequired: boolean;
    summaryDigest: string;
    serverKeyLifecycle: {
      persisted: boolean;
      productionStable: boolean;
      requiredForProduction: boolean;
      unavailableReason: null;
    };
    claims: {
      appRoomClaim: ExternalProgramClaimCapability;
      sourceSubmissionClaim: ExternalProgramClaimCapability;
      knowledgeContextClaim: ExternalProgramClaimCapability;
      sourceMaterialStatusClaim: ExternalProgramClaimCapability;
    };
  };
  roomDefaults: {
    roomType: "external";
    capabilities: ReturnType<typeof getDefaultRoomCapabilities>;
  };
  sourceMaterials: {
    mode: "private_sidecar" | "private_sidecar_required";
    privateSidecarRequired: true;
    availableOnThisNode: boolean;
    unavailableError: "private_sidecar_required" | null;
  };
  voice: {
    mode: "disabled" | "configured" | "configuration_error";
    healthEndpoint: "/api/v1/voice/health";
    requireProviderHealth: boolean;
    provider: string;
    publicUrl: string | null;
    tokenTtlSec: number | null;
    defaultTtlSec: number | null;
    error: string | null;
  };
  registry: {
    mode: string;
  };
  errorContractVersion: string;
}

interface ExternalProgramClaimCapability {
  required: boolean;
  authMode: "server_ed25519";
  claimContractVersion: string;
  maxTtlSec: number;
  nonceReplayRequired: boolean;
  payloadEncoding: string;
  signatureEncoding: string;
  signingInput: string;
}

export function buildExternalProgramRuntimeCapabilities(
  env: NodeJS.ProcessEnv = process.env,
): ExternalProgramRuntimeCapabilities {
  const nodeRuntime = loadNodeRuntimeConfig(env);
  const maxTtlSec = Math.floor(DEFAULT_APP_TRUST_ROOT_NONCE_MAX_TTL_MS / 1000);
  const claim = buildClaimCapability(maxTtlSec);
  const voice = readVoiceCapability(env);
  const sourceMaterialAvailable = nodeRuntime.runtimeRole === "PRIVATE_SIDECAR";

  return {
    productName: "External Program",
    apiBasePath: "/api/v1/external-apps",
    claimContract: {
      version: EXTERNAL_PROGRAM_CLAIM_CONTRACT_VERSION,
      payloadEncoding: EXTERNAL_PROGRAM_CLAIM_PAYLOAD_ENCODING,
      signatureEncoding: EXTERNAL_PROGRAM_CLAIM_SIGNATURE_ENCODING,
      signingInput: EXTERNAL_PROGRAM_CLAIM_SIGNING_INPUT,
      maxTtlSec,
      nonceReplayRequired: true,
      summaryDigest: EXTERNAL_PROGRAM_SUMMARY_DIGEST,
      serverKeyLifecycle: {
        persisted: true,
        productionStable: true,
        requiredForProduction: true,
        unavailableReason: null,
      },
      claims: {
        appRoomClaim: claim,
        sourceSubmissionClaim: claim,
        knowledgeContextClaim: claim,
        sourceMaterialStatusClaim: claim,
      },
    },
    roomDefaults: {
      roomType: "external",
      capabilities: getDefaultRoomCapabilities("external"),
    },
    sourceMaterials: {
      mode: sourceMaterialAvailable ? "private_sidecar" : "private_sidecar_required",
      privateSidecarRequired: true,
      availableOnThisNode: sourceMaterialAvailable,
      unavailableError: sourceMaterialAvailable ? null : "private_sidecar_required",
    },
    voice,
    registry: {
      mode: externalAppRegistryModeFromEnv(env),
    },
    errorContractVersion: APP_TRUST_ROOT_ERROR_CONTRACT_VERSION,
  };
}

function buildClaimCapability(maxTtlSec: number): ExternalProgramClaimCapability {
  return {
    required: true,
    authMode: "server_ed25519",
    claimContractVersion: EXTERNAL_PROGRAM_CLAIM_CONTRACT_VERSION,
    maxTtlSec,
    nonceReplayRequired: true,
    payloadEncoding: EXTERNAL_PROGRAM_CLAIM_PAYLOAD_ENCODING,
    signatureEncoding: EXTERNAL_PROGRAM_CLAIM_SIGNATURE_ENCODING,
    signingInput: EXTERNAL_PROGRAM_CLAIM_SIGNING_INPUT,
  };
}

function readVoiceCapability(
  env: NodeJS.ProcessEnv,
): ExternalProgramRuntimeCapabilities["voice"] {
  try {
    const voice = toPublicVoiceRuntimeConfig(loadVoiceRuntimeConfig(env));
    return {
      mode: voice.enabled ? "configured" : "disabled",
      healthEndpoint: "/api/v1/voice/health",
      requireProviderHealth: voice.requireProviderHealth,
      provider: voice.provider,
      publicUrl: voice.publicUrl,
      tokenTtlSec: voice.enabled ? voice.tokenTtlSec : null,
      defaultTtlSec: voice.enabled ? voice.defaultTtlSec : null,
      error: null,
    };
  } catch (error) {
    return {
      mode: "configuration_error",
      healthEndpoint: "/api/v1/voice/health",
      requireProviderHealth: false,
      provider: "disabled",
      publicUrl: null,
      tokenTtlSec: null,
      defaultTtlSec: null,
      error: error instanceof Error ? error.message : "voice_configuration_error",
    };
  }
}
