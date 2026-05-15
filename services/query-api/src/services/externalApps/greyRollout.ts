import { createHash } from "node:crypto";

export function computeGreyRolloutExposure(input: {
  appId: string;
  viewerCohort: string;
  policyEpoch: string;
  rolloutSalt: string;
  exposureBasisPoints: number;
}) {
  const exposureBasisPoints = Math.max(
    0,
    Math.min(10_000, Math.floor(input.exposureBasisPoints)),
  );
  const hash = createHash("sha256")
    .update(
      `${input.appId || ""}|${input.viewerCohort || "public"}|${
        input.policyEpoch || ""
      }|${input.rolloutSalt || ""}`,
    )
    .digest("hex");
  const bucket = Number.parseInt(hash.slice(0, 8), 16) % 10_000;
  return {
    bucket,
    exposureBasisPoints,
    exposed: bucket < exposureBasisPoints,
    cohort: input.viewerCohort || "public",
    policyEpoch: input.policyEpoch,
  };
}
