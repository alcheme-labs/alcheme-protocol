import { digestJson } from "./digest";
import type { AppTrustRootCommitment, AppTrustRootProductionStatus } from "./types";

export function buildAppTrustRootCommitment(input: {
  appId: string;
  ownerRef: string;
  manifestHash: string;
  declaredCapabilitySetDigest: string;
  productionStatus: AppTrustRootProductionStatus;
}): AppTrustRootCommitment {
  const payloadDigest = digestJson(input);
  return {
    commitmentType: "app_identity",
    subjectRef: `app:${input.appId}`,
    payloadDigest,
    commitmentDigest: digestJson({ commitmentType: "app_identity", payloadDigest }),
  };
}

export function buildReleaseCommitment(input: {
  appId: string;
  releaseId: string;
  manifestHash: string;
  bundleHash: string;
  codeHash: string;
  originSetDigest: string;
  capabilitySetDigest: string;
}): AppTrustRootCommitment {
  const payloadDigest = digestJson(input);
  return {
    commitmentType: "app_release",
    subjectRef: `app:${input.appId}/release:${input.releaseId}`,
    payloadDigest,
    commitmentDigest: digestJson({ commitmentType: "app_release", payloadDigest }),
  };
}
