import type { Prisma, PrismaClient } from "@prisma/client";

import {
  SOURCE_MATERIAL_GROUNDING_STATUSES,
  SOURCE_MATERIAL_REVIEW_QUEUE_STATUSES,
  normalizeSourceMaterialLifecycleStatus,
  normalizeSourceMaterialOriginType,
  normalizeSourceMaterialPrivacyClass,
} from "../sourceMaterials/lifecycle";
import { assertExternalAppCanUseCircle } from "./circleBindings";

export interface ExternalAppSourceMaterialStatusProjection {
  id: number;
  externalAppId: string;
  circleId: number;
  originType: string;
  originRef: string | null;
  roomKey: string | null;
  lifecycleStatus: string;
  statusGroup: "review_queue" | "grounded" | "terminal";
  canAppearInKnowledgeContext: boolean;
  evidencePrivacyClass: string;
  claimDigestRecorded: boolean;
  scope: {
    appId: string;
    circleId: number;
    roomKey: string | null;
    appScoped: boolean;
    userScoped: boolean;
    user: string | null;
  };
  updatedAt: string | null;
}

const SOURCE_MATERIAL_STATUS_SELECT = {
  id: true,
  externalAppId: true,
  circleId: true,
  originType: true,
  originRef: true,
  roomKey: true,
  lifecycleStatus: true,
  evidencePrivacyClass: true,
  provenance: true,
  updatedAt: true,
} satisfies Prisma.SourceMaterialSelect;

type SourceMaterialStatusRow = Prisma.SourceMaterialGetPayload<{
  select: typeof SOURCE_MATERIAL_STATUS_SELECT;
}>;

export async function getExternalAppSourceMaterialStatusById(
  prisma: PrismaClient,
  input: { externalAppId: string; sourceMaterialId: number },
): Promise<ExternalAppSourceMaterialStatusProjection | null> {
  const material = await prisma.sourceMaterial.findFirst({
    where: {
      id: input.sourceMaterialId,
      externalAppId: input.externalAppId,
    },
    select: SOURCE_MATERIAL_STATUS_SELECT,
  });
  if (!material) return null;
  await assertExternalAppCanUseCircle(prisma, {
    externalAppId: input.externalAppId,
    circleId: Number(material.circleId),
  });
  return mapSourceMaterialStatus(material, input.externalAppId);
}

export async function getExternalAppSourceMaterialStatusByOrigin(
  prisma: PrismaClient,
  input: { externalAppId: string; originType: unknown; originRef: unknown },
): Promise<ExternalAppSourceMaterialStatusProjection | null> {
  const originType = normalizeSourceMaterialOriginType(input.originType);
  const originRef = String(input.originRef || "").trim();
  if (!originRef) {
    throw new Error("source_material_origin_ref_required");
  }
  const material = await prisma.sourceMaterial.findFirst({
    where: {
      externalAppId: input.externalAppId,
      originType,
      originRef,
    },
    orderBy: [
      { updatedAt: "desc" },
      { id: "desc" },
    ],
    select: SOURCE_MATERIAL_STATUS_SELECT,
  });
  if (!material) return null;
  await assertExternalAppCanUseCircle(prisma, {
    externalAppId: input.externalAppId,
    circleId: Number(material.circleId),
  });
  return mapSourceMaterialStatus(material, input.externalAppId);
}

function mapSourceMaterialStatus(
  material: SourceMaterialStatusRow,
  expectedExternalAppId: string,
): ExternalAppSourceMaterialStatusProjection {
  if (material.externalAppId !== expectedExternalAppId) {
    throw new Error("source_material_not_found");
  }
  const lifecycleStatus = normalizeSourceMaterialLifecycleStatus(
    material.lifecycleStatus ?? "submitted",
  );
  const evidencePrivacyClass = normalizeSourceMaterialPrivacyClass(
    material.evidencePrivacyClass ?? "circle_only",
  );
  const grounded = SOURCE_MATERIAL_GROUNDING_STATUSES.includes(lifecycleStatus);
  const reviewQueue = SOURCE_MATERIAL_REVIEW_QUEUE_STATUSES.includes(lifecycleStatus);
  return {
    id: Number(material.id),
    externalAppId: expectedExternalAppId,
    circleId: Number(material.circleId),
    originType: String(material.originType || "external_summary"),
    originRef: material.originRef == null ? null : String(material.originRef),
    roomKey: material.roomKey == null ? null : String(material.roomKey),
    lifecycleStatus,
    statusGroup: reviewQueue ? "review_queue" : grounded ? "grounded" : "terminal",
    canAppearInKnowledgeContext:
      grounded &&
      evidencePrivacyClass !== "sealed" &&
      evidencePrivacyClass !== "redacted" &&
      evidencePrivacyClass !== "reviewer_only",
    evidencePrivacyClass,
    claimDigestRecorded: hasActorClaimDigest(material.provenance),
    scope: {
      appId: expectedExternalAppId,
      circleId: Number(material.circleId),
      roomKey: material.roomKey == null ? null : String(material.roomKey),
      appScoped: true,
      userScoped: false,
      user: null,
    },
    updatedAt: material.updatedAt instanceof Date
      ? material.updatedAt.toISOString()
      : material.updatedAt == null
        ? null
        : String(material.updatedAt),
  };
}

function hasActorClaimDigest(provenance: Prisma.JsonValue | null): boolean {
  if (!isRecord(provenance) || !isRecord(provenance.actor)) return false;
  return (
    typeof provenance.actor.claimDigest === "string" &&
    provenance.actor.claimDigest.trim().length > 0
  );
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === "object" && !Array.isArray(value);
}
