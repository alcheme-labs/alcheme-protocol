export const SOURCE_MATERIAL_LIFECYCLE_STATUSES = [
  "nominated",
  "submitted",
  "review_pending",
  "accepted_to_plaza",
  "used_in_draft",
  "crystallized",
  "rejected",
  "redacted",
  "revoked",
  "expired",
] as const;

export type SourceMaterialLifecycleStatus =
  (typeof SOURCE_MATERIAL_LIFECYCLE_STATUSES)[number];

export const SOURCE_MATERIAL_PRIVACY_CLASSES = [
  "public",
  "circle_only",
  "reviewer_only",
  "sealed",
  "redacted",
] as const;

export type SourceMaterialPrivacyClass =
  (typeof SOURCE_MATERIAL_PRIVACY_CLASSES)[number];

export const SOURCE_MATERIAL_ORIGIN_TYPES = [
  "manual_upload",
  "external_url_capture",
  "communication_message",
  "voice_recap",
  "external_summary",
  "room_upgrade_reference",
  "fork_upstream_reference",
] as const;

export type SourceMaterialOriginType =
  (typeof SOURCE_MATERIAL_ORIGIN_TYPES)[number];

export const SOURCE_MATERIAL_VISIBILITY_SCOPES = [
  "circle",
  "reviewers",
  "sealed",
] as const;

export type SourceMaterialVisibilityScope =
  (typeof SOURCE_MATERIAL_VISIBILITY_SCOPES)[number];

export const SOURCE_MATERIAL_GROUNDING_STATUSES: SourceMaterialLifecycleStatus[] = [
  "accepted_to_plaza",
  "used_in_draft",
  "crystallized",
];

export const SOURCE_MATERIAL_REVIEW_QUEUE_STATUSES: SourceMaterialLifecycleStatus[] = [
  "nominated",
  "submitted",
  "review_pending",
];

export function normalizeSourceMaterialLifecycleStatus(
  value: unknown,
): SourceMaterialLifecycleStatus {
  const normalized = String(value || "").trim().toLowerCase();
  if (
    (SOURCE_MATERIAL_LIFECYCLE_STATUSES as readonly string[]).includes(
      normalized,
    )
  ) {
    return normalized as SourceMaterialLifecycleStatus;
  }
  throw new Error("invalid_source_material_lifecycle_status");
}

export function normalizeSourceMaterialPrivacyClass(
  value: unknown,
): SourceMaterialPrivacyClass {
  const normalized = String(value || "").trim().toLowerCase();
  if (
    (SOURCE_MATERIAL_PRIVACY_CLASSES as readonly string[]).includes(normalized)
  ) {
    return normalized as SourceMaterialPrivacyClass;
  }
  throw new Error("invalid_source_material_privacy_class");
}

export function normalizeSourceMaterialOriginType(
  value: unknown,
): SourceMaterialOriginType {
  const normalized = String(value || "").trim().toLowerCase();
  if ((SOURCE_MATERIAL_ORIGIN_TYPES as readonly string[]).includes(normalized)) {
    return normalized as SourceMaterialOriginType;
  }
  throw new Error("invalid_source_material_origin_type");
}

export function normalizeSourceMaterialVisibilityScope(
  value: unknown,
): SourceMaterialVisibilityScope {
  const normalized = String(value || "").trim().toLowerCase();
  if (
    (SOURCE_MATERIAL_VISIBILITY_SCOPES as readonly string[]).includes(
      normalized,
    )
  ) {
    return normalized as SourceMaterialVisibilityScope;
  }
  throw new Error("invalid_source_material_visibility_scope");
}

export function resolveDefaultLifecycleStatusForOrigin(
  originType: SourceMaterialOriginType,
): SourceMaterialLifecycleStatus {
  if (originType === "manual_upload" || originType === "external_url_capture") return "accepted_to_plaza";
  if (originType === "voice_recap") return "review_pending";
  return "submitted";
}

export function isSourceMaterialVisibleToCircleMember(input: {
  lifecycleStatus: SourceMaterialLifecycleStatus;
  evidencePrivacyClass: SourceMaterialPrivacyClass;
  canReview?: boolean;
  canViewReviewQueue?: boolean;
}): boolean {
  if (input.evidencePrivacyClass === "sealed") return false;
  if (input.evidencePrivacyClass === "redacted") return false;
  if (input.evidencePrivacyClass === "reviewer_only") {
    return Boolean(input.canReview);
  }
  if (SOURCE_MATERIAL_REVIEW_QUEUE_STATUSES.includes(input.lifecycleStatus)) {
    return Boolean(input.canReview || input.canViewReviewQueue);
  }
  return SOURCE_MATERIAL_GROUNDING_STATUSES.includes(input.lifecycleStatus);
}
