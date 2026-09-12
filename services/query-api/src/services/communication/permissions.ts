import { MemberRole, MemberStatus } from "@prisma/client";

import {
  type AppRoomClaim,
  type ExternalAppRecord,
  verifyAppRoomClaim,
} from "./roomResolver";
import { communicationError } from "./errors";
import type { AppTrustRootNonceReplayStore } from "../appTrustRoot/nonceReplayStore";
import type { CircleActor } from "../auth/actor";
import { assertExternalAppCanUseCircle } from "../externalApps/circleBindings";
import { externalAppRegistryModeFromEnv } from "../externalApps/chainRegistryProjection";
import {
  assertExternalProgramRuntimeAppAllowed,
  type ExternalProgramRuntimeCapability,
} from "../externalApps/runtimeAuthorizationGate";

export interface CommunicationPermissionDecision {
  allowed: boolean;
  reason: string;
  statusCode: number;
}

export interface CommunicationPermissionInput {
  roomKey: string;
  walletPubkey?: string | null;
  userId?: number | null;
  actor?: CircleActor | null;
}

export interface CommunicationPermissionOptions {
  now?: Date;
  nonceReplayStore?: AppTrustRootNonceReplayStore | null;
}

export interface UpsertCommunicationRoomMemberInput {
  roomKey: string;
  walletPubkey: string;
  appRoomClaim?: AppRoomClaim | null;
}

interface CommunicationRoomRecord {
  roomKey: string;
  roomType: string;
  externalAppId?: string | null;
  externalRoomId?: string | null;
  parentCircleId?: number | null;
  metadata?: unknown;
  transcriptionMode?: string | null;
  lifecycleStatus: string;
  expiresAt?: Date | null;
  endedAt?: Date | null;
  externalApp?: ExternalAppRecord | null;
}

interface CommunicationRoomMemberRecord {
  roomKey: string;
  walletPubkey: string;
  role: string;
  canSpeak: boolean;
  muted: boolean;
  banned: boolean;
  leftAt?: Date | null;
}

interface CircleMemberRecord {
  status: MemberStatus | string;
  role: MemberRole | string;
}

interface CommunicationPermissionPrisma {
  communicationRoom: {
    findUnique(input: unknown): Promise<CommunicationRoomRecord | null>;
  };
  communicationRoomMember: {
    findUnique(input: unknown): Promise<CommunicationRoomMemberRecord | null>;
    upsert(input: unknown): Promise<CommunicationRoomMemberRecord>;
  };
  externalAppCircleBinding?: {
    findFirst(input: unknown): Promise<unknown | null>;
  };
  externalAppRegistryAnchor?: {
    findUnique(input: unknown): Promise<unknown | null>;
  };
  externalAppServerKey?: {
    findMany(input: unknown): Promise<any[]>;
  };
}

interface PermissionContext {
  room: CommunicationRoomRecord | null;
  member: CommunicationRoomMemberRecord | null;
  circleMember: CircleMemberRecord | null;
  now: Date;
  circleActorRequired: boolean;
  circleActorMismatch: boolean;
}

const ROOM_MEMBER_ROLES = new Set([
  "owner",
  "moderator",
  "host",
  "party_leader",
  "speaker",
  "listener",
  "member",
]);

export async function canReadRoom(
  prisma: CommunicationPermissionPrisma,
  input: CommunicationPermissionInput,
  options: CommunicationPermissionOptions = {},
): Promise<CommunicationPermissionDecision> {
  const context = await loadPermissionContext(prisma, input, options);
  const base = evaluateBaseRoomAccess(context);
  if (base) return base;

  if (hasPresentMember(context.member)) {
    return allow("room_member");
  }
  if (isActiveCircleMember(context.circleMember)) {
    return allow("circle_member");
  }
  return deny("room_membership_required", 403);
}

export async function canWriteRoom(
  prisma: CommunicationPermissionPrisma,
  input: CommunicationPermissionInput,
  options: CommunicationPermissionOptions = {},
): Promise<CommunicationPermissionDecision> {
  const context = await loadPermissionContext(prisma, input, options);
  const base = evaluateBaseRoomAccess(context);
  if (base) return base;

  if (hasPresentMember(context.member)) {
    if (context.member.muted) return deny("member_muted", 403);
    return allow("room_member");
  }
  if (isActiveCircleMember(context.circleMember)) {
    return allow("circle_member");
  }
  return deny("room_membership_required", 403);
}

export async function canJoinVoice(
  prisma: CommunicationPermissionPrisma,
  input: CommunicationPermissionInput,
  options: CommunicationPermissionOptions = {},
): Promise<CommunicationPermissionDecision> {
  const context = await loadPermissionContext(prisma, input, options);
  const base = evaluateBaseRoomAccess(context);
  if (base) return base;

  if (hasPresentMember(context.member)) {
    if (context.member.muted) return deny("member_muted", 403);
    if (!context.member.canSpeak) return deny("member_voice_disabled", 403);
    return allow("room_member");
  }
  if (isActiveCircleMember(context.circleMember)) {
    return allow("circle_member");
  }
  return deny("room_membership_required", 403);
}

export async function canModerateRoom(
  prisma: CommunicationPermissionPrisma,
  input: CommunicationPermissionInput,
  options: CommunicationPermissionOptions = {},
): Promise<CommunicationPermissionDecision> {
  const context = await loadPermissionContext(prisma, input, options);
  const base = evaluateBaseRoomAccess(context);
  if (base) return base;

  if (
    hasPresentMember(context.member) &&
    isRoomModerator(context.member.role)
  ) {
    return allow("room_moderator");
  }
  if (isCircleManager(context.circleMember)) {
    return allow("circle_manager");
  }
  return deny("moderator_permission_required", 403);
}

export async function upsertCommunicationRoomMemberFromClaim(
  prisma: CommunicationPermissionPrisma,
  input: UpsertCommunicationRoomMemberInput,
  options: CommunicationPermissionOptions = {},
): Promise<CommunicationRoomMemberRecord> {
  const now = options.now ?? new Date();
  const room = await loadRoom(prisma, input.roomKey);
  if (!room) {
    throw communicationError(404, "room_not_found", "Communication room not found");
  }
  if (!room.externalAppId || !room.externalApp) {
    throw communicationError(400, "external_app_room_required", "External app room required");
  }
  await assertRoomExternalAppStillAllowed(prisma, room);

  const payload = await verifyAppRoomClaim({
    prisma,
    externalApp: room.externalApp,
    claim: input.appRoomClaim,
    expected: {
      externalAppId: room.externalAppId,
      roomType: room.roomType,
      externalRoomId: room.externalRoomId ?? "",
      walletPubkey: input.walletPubkey,
    },
    now,
    nonceReplayStore: options.nonceReplayStore,
  });
  const role = normalizeRoomMemberRole(payload.roles?.[input.walletPubkey]);
  const canSpeak = role !== "listener";

  return prisma.communicationRoomMember.upsert({
    where: {
      roomKey_walletPubkey: {
        roomKey: input.roomKey,
        walletPubkey: input.walletPubkey,
      },
    },
    create: {
      roomKey: input.roomKey,
      walletPubkey: input.walletPubkey,
      role,
      canSpeak,
      muted: false,
      banned: false,
    },
    update: {
      role,
      canSpeak,
      leftAt: null,
    },
  });
}

async function assertRoomExternalAppStillAllowed(
  prisma: CommunicationPermissionPrisma,
  room: CommunicationRoomRecord,
): Promise<void> {
  if (!room.externalAppId || !room.externalApp) return;
  try {
    await assertExternalProgramRuntimeAppAllowed(prisma as any, {
      app: room.externalApp,
      registryMode: externalAppRegistryModeFromEnv(),
      requestedCapabilities: collectRoomRequestedCapabilities(room),
    });
    if (room.parentCircleId) {
      await assertExternalAppCanUseCircle(prisma as any, {
        externalAppId: room.externalAppId,
        circleId: room.parentCircleId,
      });
    }
  } catch (error) {
    const typed = error as { code?: string; statusCode?: number; message?: string };
    const code = typed?.code || typed?.message || "external_app_runtime_authorization_failed";
    const statusCode = typed?.statusCode && typed.statusCode >= 400 && typed.statusCode < 600
      ? typed.statusCode
      : 403;
    throw communicationError(statusCode, code, code);
  }
}

function collectRoomRequestedCapabilities(
  room: CommunicationRoomRecord,
): ExternalProgramRuntimeCapability[] {
  const capabilities: ExternalProgramRuntimeCapability[] = [];
  const metadata = room.metadata && typeof room.metadata === "object" && !Array.isArray(room.metadata)
    ? room.metadata as Record<string, unknown>
    : {};
  const roomCapabilities = metadata.capabilities &&
    typeof metadata.capabilities === "object" &&
    !Array.isArray(metadata.capabilities)
    ? metadata.capabilities as Record<string, unknown>
    : {};
  if (roomCapabilities.sourceMaterialSubmission === true) {
    capabilities.push("sourceMaterialSubmission");
  }
  if (roomCapabilities.knowledgeContext === true) {
    capabilities.push("knowledgeContext");
  }
  if (String(room.transcriptionMode || "off").trim().toLowerCase() !== "off") {
    capabilities.push("transcriptRecap");
  }
  if (metadata.voicePolicy && typeof metadata.voicePolicy === "object") {
    capabilities.push("voice");
  }
  return Array.from(new Set(capabilities));
}

async function loadPermissionContext(
  prisma: CommunicationPermissionPrisma,
  input: CommunicationPermissionInput,
  options: CommunicationPermissionOptions,
): Promise<PermissionContext> {
  const now = options.now ?? new Date();
  const room = await loadRoom(prisma, input.roomKey);
  if (!room) {
    return {
      room: null,
      member: null,
      circleMember: null,
      now,
      circleActorRequired: false,
      circleActorMismatch: false,
    };
  }
  const firstPartyCircleRoom = isFirstPartyCircleRoom(room);
  const circleActorRequired = firstPartyCircleRoom && !input.actor;
  const circleActorMismatch =
    firstPartyCircleRoom &&
    !!input.actor &&
    input.actor.circle.id !== room.parentCircleId;
  const memberWalletPubkey = input.walletPubkey ?? input.actor?.pubkey ?? null;

  const [member, circleMember] = await Promise.all([
    memberWalletPubkey
      ? prisma.communicationRoomMember.findUnique({
          where: {
            roomKey_walletPubkey: {
              roomKey: input.roomKey,
              walletPubkey: memberWalletPubkey,
            },
          },
        })
      : Promise.resolve(null),
    loadCircleMember(room, input),
  ]);

  return {
    room,
    member,
    circleMember,
    now,
    circleActorRequired,
    circleActorMismatch,
  };
}

async function loadCircleMember(
  room: CommunicationRoomRecord,
  input: CommunicationPermissionInput,
): Promise<CircleMemberRecord | null> {
  if (!isFirstPartyCircleRoom(room) || !input.actor) return null;
  if (input.actor.circle.id !== room.parentCircleId) return null;
  return {
    status: input.actor.membership.status,
    role: input.actor.membership.role,
  };
}

function loadRoom(
  prisma: CommunicationPermissionPrisma,
  roomKey: string,
): Promise<CommunicationRoomRecord | null> {
  return prisma.communicationRoom.findUnique({
    where: { roomKey },
    include: { externalApp: true },
  });
}

function evaluateBaseRoomAccess(
  context: PermissionContext,
): CommunicationPermissionDecision | null {
  if (!context.room) return deny("room_not_found", 404);
  if (context.room.endedAt) return deny("room_ended", 409);
  if (
    context.room.expiresAt &&
    context.room.expiresAt.getTime() <= context.now.getTime()
  ) {
    return deny("room_expired", 409);
  }
  if (
    context.room.lifecycleStatus === "ended" ||
    context.room.lifecycleStatus === "expired"
  ) {
    return deny("room_inactive", 409);
  }
  if (context.member?.banned) return deny("member_banned", 403);
  if (context.circleActorRequired) return deny("circle_actor_required", 401);
  if (context.circleActorMismatch) return deny("circle_actor_mismatch", 403);
  if (context.circleMember?.status === MemberStatus.Banned) {
    return deny("circle_member_banned", 403);
  }
  return null;
}

function isFirstPartyCircleRoom(room: CommunicationRoomRecord): boolean {
  return room.roomType === "circle" || room.roomKey.startsWith("circle:");
}

function hasPresentMember(
  member: CommunicationRoomMemberRecord | null,
): member is CommunicationRoomMemberRecord {
  return !!member && !member.leftAt;
}

function isActiveCircleMember(member: CircleMemberRecord | null): boolean {
  return !!member && member.status === MemberStatus.Active;
}

function isCircleManager(member: CircleMemberRecord | null): boolean {
  if (!member || member.status !== MemberStatus.Active) return false;
  return (
    member.role === MemberRole.Owner ||
    member.role === MemberRole.Admin ||
    member.role === MemberRole.Moderator
  );
}

function isRoomModerator(role: string): boolean {
  return role === "owner" || role === "moderator";
}

function normalizeRoomMemberRole(raw: string | undefined): string {
  const role = raw?.trim().toLowerCase() ?? "";
  return ROOM_MEMBER_ROLES.has(role) ? role : "member";
}

function allow(reason: string): CommunicationPermissionDecision {
  return { allowed: true, reason, statusCode: 200 };
}

function deny(
  reason: string,
  statusCode: number,
): CommunicationPermissionDecision {
  return { allowed: false, reason, statusCode };
}
