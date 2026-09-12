import crypto from "node:crypto";

import type { PrismaClient } from "@prisma/client";

import { assertExternalAppCanUseCircle } from "../externalApps/circleBindings";
import {
  createPrismaGovernanceEngineStore,
  createPrismaGovernanceRequestStore,
  recordExecutionReceipt,
} from "../governance/policyEngine";
import { createGovernedActionRegistry } from '../governance/actionRegistry';
import { GovernedActionGateway } from '../governance/governedActionGateway';
import { createSourceMaterial } from "../sourceMaterials/ingest";
import type { SourceMaterialPrivacyClass } from "../sourceMaterials/lifecycle";

type RoomUpgradePrisma = PrismaClient & {
  [key: string]: any;
};

const SOURCE_MATERIAL_REFERENCE_STATUSES = [
  "accepted_to_plaza",
  "used_in_draft",
  "crystallized",
];

export interface RoomUpgradeProposalInput {
  roomKey: string;
  parentCircleId: number;
  proposedCircleName: string;
  communityType: string;
  reason: string;
  sourceMaterialIds: number[];
  actorPubkey: string;
}

export interface RoomUpgradeExecutionInput {
  roomKey: string;
  parentCircleId: number;
  targetCircleId: number;
  governanceRequestId: string;
  decisionDigest: string;
  sourceMaterialIds: number[];
  actorPubkey?: string | null;
}

export class RoomUpgradeError extends Error {
  constructor(
    readonly code: string,
    readonly statusCode = 400,
  ) {
    super(code);
    this.name = "RoomUpgradeError";
  }
}

export async function proposeRoomUpgradeToCircle(
  prisma: RoomUpgradePrisma,
  input: RoomUpgradeProposalInput,
) {
  const normalized = normalizeProposalInput(input);
  const room = await loadRoomOrThrow(prisma, normalized.roomKey);
  assertRoomParent(room, normalized.parentCircleId);
  await assertExternalBindingIfNeeded(prisma, room, normalized.parentCircleId);

  const policyContext = await loadCircleGovernanceContext(
    prisma,
    normalized.parentCircleId,
  );
  const idempotencyKey = buildDigest({
    roomKey: normalized.roomKey,
    parentCircleId: normalized.parentCircleId,
    proposedCircleName: normalized.proposedCircleName,
    communityType: normalized.communityType,
    sourceMaterialIds: normalized.sourceMaterialIds,
  });
  const requestId = `room-upgrade:${idempotencyKey.slice(0, 40)}`;

  const now = new Date();
  const gateway = new GovernedActionGateway({
    registry: createGovernedActionRegistry({ includeCommunicationActions: true }),
    resolveBinding: async () => null,
    listCommitteeEligibleActors: async () => [],
    requestStore: createPrismaGovernanceRequestStore(prisma),
    runtimePrisma: prisma as any,
    createRequestId: () => requestId,
    now: () => now,
  });
  return gateway.openResolvedRequest({
    actionType: "room_upgrade_circle_propose",
    targetCircleId: normalized.parentCircleId,
    targetType: "communication_room",
    targetRef: normalized.roomKey,
    payload: {
        roomKey: normalized.roomKey,
        parentCircleId: normalized.parentCircleId,
        proposedCircleName: normalized.proposedCircleName,
        communityType: normalized.communityType,
        reason: normalized.reason,
        sourceMaterialIds: normalized.sourceMaterialIds,
        externalAppId: room.externalAppId ?? null,
        note:
          "Create a child Circle from selected room source material references; room messages and members are not copied.",
    },
    idempotencyKey,
    proposerPubkey: normalized.actorPubkey,
    authority: {
      id: policyContext.policyVersion.id,
      policyId: policyContext.policy.id,
      policyVersionId: policyContext.policyVersion.id,
      policyVersion: policyContext.policyVersion.version,
      ruleId: "room_upgrade_circle_propose",
      committeeCircleId: normalized.parentCircleId,
      authoritySourceType: 'governance_policy_version',
      authoritySourceRef: policyContext.policyVersion.id,
      authoritySourceVersion: String(policyContext.policyVersion.version),
      authorityPurpose: 'collective_decision',
      authoritySelector: {
        actionType: 'room_upgrade_circle_propose',
        parentCircleId: normalized.parentCircleId,
      },
      authorityLimits: {
        policyId: policyContext.policy.id,
        policyVersionId: policyContext.policyVersion.id,
        ruleId: 'room_upgrade_circle_propose',
      },
    },
    eligibleActors: policyContext.eligibleActors,
    scope: { type: "circle", ref: String(normalized.parentCircleId) },
  });
}

export async function executeRoomUpgradeToCircle(
  prisma: RoomUpgradePrisma,
  input: RoomUpgradeExecutionInput,
) {
  const normalized = normalizeExecutionInput(input);
  const room = await loadRoomOrThrow(prisma, normalized.roomKey);
  assertRoomParent(room, normalized.parentCircleId);
  await assertExternalBindingIfNeeded(prisma, room, normalized.parentCircleId);
  await assertTargetCircleIsChild(prisma, {
    parentCircleId: normalized.parentCircleId,
    targetCircleId: normalized.targetCircleId,
  });

  const governanceRequest = await prisma.governanceRequest.findUnique({
    where: { id: normalized.governanceRequestId },
    include: { decision: true },
  });
  if (!governanceRequest) {
    throw new RoomUpgradeError("room_upgrade_governance_request_not_found", 404);
  }
  if (governanceRequest.actionType !== "room_upgrade_circle_execute") {
    throw new RoomUpgradeError("room_upgrade_execute_governance_required", 409);
  }
  if (governanceRequest.state !== "accepted") {
    throw new RoomUpgradeError("room_upgrade_governance_not_accepted", 409);
  }
  if (governanceRequest.decision?.decisionDigest !== normalized.decisionDigest) {
    throw new RoomUpgradeError("room_upgrade_decision_digest_mismatch", 409);
  }

  const idempotencyKey = buildDigest({
    roomKey: normalized.roomKey,
    parentCircleId: normalized.parentCircleId,
    targetCircleId: normalized.targetCircleId,
    sourceMaterialIds: normalized.sourceMaterialIds,
    decisionDigest: normalized.decisionDigest,
  });
  const existingReceipt = await prisma.governanceExecutionReceipt.findUnique({
    where: {
      requestId_executorModule_idempotencyKey: {
        requestId: normalized.governanceRequestId,
        executorModule: "communication_room_upgrade",
        idempotencyKey,
      },
    },
  });
  if (existingReceipt) {
    return {
      receipt: existingReceipt,
      referencedSourceMaterials: [],
      idempotent: true,
    };
  }

  const sourceMaterials = await prisma.sourceMaterial.findMany({
    where: {
      id: { in: normalized.sourceMaterialIds },
      circleId: normalized.parentCircleId,
      lifecycleStatus: { in: SOURCE_MATERIAL_REFERENCE_STATUSES },
      evidencePrivacyClass: { notIn: ["sealed", "redacted"] },
    },
    orderBy: [{ id: "asc" }],
    select: {
      id: true,
      name: true,
      mimeType: true,
      contentDigest: true,
      summaryText: true,
      lifecycleStatus: true,
      originType: true,
      originRef: true,
      externalAppId: true,
      roomKey: true,
      evidencePrivacyClass: true,
      visibilityScope: true,
    },
  });
  if (sourceMaterials.length !== normalized.sourceMaterialIds.length) {
    throw new RoomUpgradeError("room_upgrade_source_materials_not_eligible", 409);
  }

  const referencedSourceMaterials = [];
  for (const material of sourceMaterials) {
    const reference = await createSourceMaterial(prisma, {
      circleId: normalized.targetCircleId,
      name: `Room source reference #${material.id}: ${material.name}`,
      mimeType: "text/plain",
      content: buildReferenceContent({
        roomKey: normalized.roomKey,
        sourceMaterial: material,
      }),
      originType: "room_upgrade_reference",
      originRef: String(material.id),
      externalAppId: room.externalAppId ?? material.externalAppId ?? null,
      roomKey: normalized.roomKey,
      lifecycleStatus: "accepted_to_plaza",
      summaryText: material.summaryText ?? `Reference to source material #${material.id}`,
      evidencePrivacyClass: normalizeReferencePrivacyClass(
        material.evidencePrivacyClass,
      ),
      visibilityScope: "circle",
      submittedByPubkey: normalized.actorPubkey ?? null,
      provenance: {
        actor: {
          kind: "room_upgrade_execution",
          pubkey: normalized.actorPubkey ?? null,
        },
        source: {
          sourceMaterialId: material.id,
          sourceCircleId: normalized.parentCircleId,
          targetCircleId: normalized.targetCircleId,
          roomKey: normalized.roomKey,
          governanceRequestId: normalized.governanceRequestId,
          decisionDigest: normalized.decisionDigest,
        },
      },
    });
    referencedSourceMaterials.push(reference);
  }

  const receipt = await recordExecutionReceipt(
    createPrismaGovernanceEngineStore(prisma),
    {
      id: `room-upgrade-receipt:${idempotencyKey.slice(0, 32)}`,
      requestId: normalized.governanceRequestId,
      actionType: "room_upgrade_circle_execute",
      executorModule: "communication_room_upgrade",
      executionStatus: "executed",
      executionRef: `circle:${normalized.targetCircleId}`,
      decisionDigest: normalized.decisionDigest,
      idempotencyKey,
      executedAt: new Date(),
    },
  );

  return {
    receipt,
    referencedSourceMaterials,
    idempotent: false,
  };
}

function normalizeProposalInput(input: RoomUpgradeProposalInput): RoomUpgradeProposalInput {
  return {
    roomKey: normalizeRequiredString(input.roomKey, "room_upgrade_room_key_required", 96),
    parentCircleId: normalizePositiveInt(input.parentCircleId, "room_upgrade_parent_circle_required"),
    proposedCircleName: normalizeRequiredString(
      input.proposedCircleName,
      "room_upgrade_circle_name_required",
      96,
    ),
    communityType: normalizeRequiredString(input.communityType || "topic", "room_upgrade_community_type_required", 32),
    reason: normalizeRequiredString(input.reason, "room_upgrade_reason_required", 1_000),
    sourceMaterialIds: normalizeSourceMaterialIds(input.sourceMaterialIds),
    actorPubkey: normalizeRequiredString(input.actorPubkey, "room_upgrade_actor_required", 44),
  };
}

function normalizeExecutionInput(input: RoomUpgradeExecutionInput): RoomUpgradeExecutionInput {
  return {
    roomKey: normalizeRequiredString(input.roomKey, "room_upgrade_room_key_required", 96),
    parentCircleId: normalizePositiveInt(input.parentCircleId, "room_upgrade_parent_circle_required"),
    targetCircleId: normalizePositiveInt(input.targetCircleId, "room_upgrade_target_circle_required"),
    governanceRequestId: normalizeRequiredString(input.governanceRequestId, "room_upgrade_governance_request_required", 96),
    decisionDigest: normalizeDigest(input.decisionDigest),
    sourceMaterialIds: normalizeSourceMaterialIds(input.sourceMaterialIds),
    actorPubkey: input.actorPubkey
      ? normalizeRequiredString(input.actorPubkey, "room_upgrade_actor_required", 44)
      : null,
  };
}

async function loadRoomOrThrow(prisma: RoomUpgradePrisma, roomKey: string) {
  const room = await prisma.communicationRoom.findUnique({
    where: { roomKey },
  });
  if (!room) throw new RoomUpgradeError("room_not_found", 404);
  return room;
}

function assertRoomParent(room: any, parentCircleId: number): void {
  if (Number(room.parentCircleId) !== parentCircleId) {
    throw new RoomUpgradeError("room_upgrade_parent_circle_mismatch", 409);
  }
}

async function assertExternalBindingIfNeeded(
  prisma: RoomUpgradePrisma,
  room: any,
  parentCircleId: number,
): Promise<void> {
  if (!room.externalAppId) return;
  await assertExternalAppCanUseCircle(prisma, {
    externalAppId: room.externalAppId,
    circleId: parentCircleId,
  });
}

async function assertTargetCircleIsChild(
  prisma: RoomUpgradePrisma,
  input: { parentCircleId: number; targetCircleId: number },
): Promise<void> {
  const circle = await prisma.circle.findUnique({
    where: { id: input.targetCircleId },
    select: {
      id: true,
      parentCircleId: true,
    },
  });
  if (!circle) throw new RoomUpgradeError("room_upgrade_target_circle_not_found", 404);
  if (Number(circle.parentCircleId) !== input.parentCircleId) {
    throw new RoomUpgradeError("room_upgrade_target_circle_not_child", 409);
  }
}

async function loadCircleGovernanceContext(
  prisma: RoomUpgradePrisma,
  parentCircleId: number,
) {
  const policy = await prisma.governancePolicy.findFirst({
    where: {
      scopeType: "circle",
      scopeRef: String(parentCircleId),
      status: "active",
    },
    orderBy: [{ updatedAt: "desc" }],
  });
  if (!policy) {
    throw new RoomUpgradeError("room_upgrade_governance_policy_required", 409);
  }
  const policyVersion = await prisma.governancePolicyVersion.findFirst({
    where: {
      policyId: policy.id,
      status: "active",
      ...(policy.activeVersion ? { version: policy.activeVersion } : {}),
    },
    orderBy: [{ version: "desc" }],
  });
  if (!policyVersion) {
    throw new RoomUpgradeError("room_upgrade_governance_policy_version_required", 409);
  }
  const members = await prisma.circleMember.findMany({
    where: {
      circleId: parentCircleId,
      status: "Active",
      role: { in: ["Owner", "Admin", "Moderator"] },
    },
    include: {
      user: {
        select: {
          pubkey: true,
        },
      },
    },
  });
  const eligibleActors = members
    .map((member: any) => ({
      pubkey: String(member.user?.pubkey || "").trim(),
      role: String(member.role || ""),
      weight: "1",
      source: "circle_managers",
    }))
    .filter((actor: any) => actor.pubkey);
  if (eligibleActors.length === 0) {
    throw new RoomUpgradeError("room_upgrade_governance_eligible_actors_required", 409);
  }
  return { policy, policyVersion, eligibleActors };
}

function buildReferenceContent(input: {
  roomKey: string;
  sourceMaterial: {
    id: number;
    name: string;
    contentDigest: string;
    summaryText?: string | null;
    lifecycleStatus: string;
  };
}): string {
  return [
    `Room source reference from ${input.roomKey}.`,
    `Original source material #${input.sourceMaterial.id}: ${input.sourceMaterial.name}.`,
    input.sourceMaterial.summaryText
      ? `Summary: ${input.sourceMaterial.summaryText}`
      : null,
    `Original digest: ${input.sourceMaterial.contentDigest}.`,
    `Original lifecycle: ${input.sourceMaterial.lifecycleStatus}.`,
  ]
    .filter(Boolean)
    .join("\n\n");
}

function normalizeReferencePrivacyClass(value: unknown): SourceMaterialPrivacyClass {
  if (value === "public" || value === "circle_only") return value;
  return "circle_only";
}

function normalizeSourceMaterialIds(value: unknown): number[] {
  if (!Array.isArray(value) || value.length === 0) {
    throw new RoomUpgradeError("room_upgrade_source_materials_required", 400);
  }
  const ids = Array.from(new Set(value.map((item) => Number(item))))
    .filter((item) => Number.isSafeInteger(item) && item > 0)
    .sort((a, b) => a - b);
  if (ids.length === 0) {
    throw new RoomUpgradeError("room_upgrade_source_materials_required", 400);
  }
  if (ids.length > 50) {
    throw new RoomUpgradeError("room_upgrade_source_materials_too_many", 400);
  }
  return ids;
}

function normalizePositiveInt(value: unknown, code: string): number {
  const numeric = Number(value);
  if (!Number.isSafeInteger(numeric) || numeric <= 0) {
    throw new RoomUpgradeError(code, 400);
  }
  return numeric;
}

function normalizeRequiredString(value: unknown, code: string, maxLength: number): string {
  const normalized = String(value || "").trim();
  if (!normalized) throw new RoomUpgradeError(code, 400);
  return normalized.slice(0, maxLength);
}

function normalizeDigest(value: unknown): string {
  const normalized = String(value || "").trim().toLowerCase();
  if (!/^[a-f0-9]{64}$/.test(normalized)) {
    throw new RoomUpgradeError("room_upgrade_decision_digest_invalid", 400);
  }
  return normalized;
}

function buildDigest(value: unknown): string {
  return crypto.createHash("sha256").update(stableJson(value)).digest("hex");
}

function stableJson(value: unknown): string {
  if (value === null || typeof value !== "object") return JSON.stringify(value);
  if (Array.isArray(value)) return `[${value.map(stableJson).join(",")}]`;
  const record = value as Record<string, unknown>;
  return `{${Object.keys(record)
    .sort()
    .map((key) => `${JSON.stringify(key)}:${stableJson(record[key])}`)
    .join(",")}}`;
}
