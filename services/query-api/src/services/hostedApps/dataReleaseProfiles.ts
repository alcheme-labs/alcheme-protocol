import { digestJson } from "./digest";

export type HostedAppDataReleaseMode =
  | "native_view_only"
  | "bridge_return_minimized"
  | "bridge_return_watermarked"
  | "third_party_server_allowed";

export interface HostedAppDataReleaseProfile {
  profileId: string;
  profileVersion: string;
  mode: HostedAppDataReleaseMode;
  allowedFields: string[];
  watermark: boolean;
  networkPolicy?: string;
}

const DATA_RELEASE_PROFILES: Record<string, HostedAppDataReleaseProfile> = {
  "app-session-minimized-v1": {
    profileId: "app-session-minimized-v1",
    profileVersion: "v1",
    mode: "bridge_return_minimized",
    allowedFields: ["appId", "releaseId", "circleId", "userPubkey"],
    watermark: false,
  },
  "circle-public-profile-minimized-v1": {
    profileId: "circle-public-profile-minimized-v1",
    profileVersion: "v1",
    mode: "bridge_return_minimized",
    allowedFields: ["circleId", "name", "description", "memberCount"],
    watermark: false,
  },
  "membership-minimized-v1": {
    profileId: "membership-minimized-v1",
    profileVersion: "v1",
    mode: "bridge_return_minimized",
    allowedFields: ["circleId", "userPubkey", "membershipStatus", "role"],
    watermark: false,
  },
  "approved-circle-summary-minimized-v1": {
    profileId: "approved-circle-summary-minimized-v1",
    profileVersion: "v1",
    mode: "bridge_return_minimized",
    allowedFields: ["circleId", "summaryDigest", "summaryText", "approvalReceiptRef"],
    watermark: false,
  },
  "approved-context-watermarked-v1": {
    profileId: "approved-context-watermarked-v1",
    profileVersion: "v1",
    mode: "bridge_return_watermarked",
    allowedFields: ["items"],
    watermark: true,
    networkPolicy: "declared_endpoints_only",
  },
};

const CAPABILITY_DATA_RELEASE_PROFILE: Record<string, string> = {
  read_app_session: "app-session-minimized-v1",
  read_current_circle_public_profile: "circle-public-profile-minimized-v1",
  read_my_circle_membership_status: "membership-minimized-v1",
  read_approved_circle_summary: "approved-circle-summary-minimized-v1",
  read_approved_knowledge_context: "approved-context-watermarked-v1",
};

export function resolveCapabilityDataReleaseProfile(
  capabilityId: string,
): HostedAppDataReleaseProfile {
  const profileId = CAPABILITY_DATA_RELEASE_PROFILE[capabilityId];
  const profile = profileId ? DATA_RELEASE_PROFILES[profileId] : null;
  if (!profile) {
    throw new Error("hosted_app_data_release_profile_unknown");
  }
  return profile;
}

export function applyDataReleaseProfile(input: {
  profile: {
    profileId: string;
    mode: HostedAppDataReleaseMode;
    allowedFields: string[];
    watermark: boolean;
  };
  payload: Record<string, unknown>;
  traceId: string;
}) {
  if (input.profile.mode === "native_view_only") {
    return {
      dataReleaseProfile: "native_view_only",
      nativeViewRef: `trace:${input.traceId}`,
    };
  }

  const data: Record<string, unknown> = {};
  for (const field of input.profile.allowedFields) {
    if (field in input.payload) data[field] = input.payload[field];
  }
  if (input.profile.mode === "bridge_return_watermarked" || input.profile.watermark) {
    data.traceId = input.traceId;
  }
  return {
    dataReleaseProfile: input.profile.mode,
    data,
  };
}

export function assertThirdPartyServerWarningSatisfied(input: {
  profileMode: HostedAppDataReleaseMode;
  warningAccepted: boolean;
}): void {
  if (input.profileMode === "third_party_server_allowed" && !input.warningAccepted) {
    throw new Error("hosted_app_third_party_server_warning_required");
  }
}

export function buildDataReleaseProfileDigest(profile: unknown): string {
  return digestJson(profile);
}

export function formatDataReleaseProfileRef(profile: HostedAppDataReleaseProfile): string {
  return `${profile.profileId}@${profile.profileVersion}`;
}
