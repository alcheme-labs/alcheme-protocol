import { MemberRole, MemberStatus } from "@prisma/client";

import {
  type AppRoomClaim,
  type ExternalAppRecord,
  verifyAppRoomClaim,
} from "./roomResolver";
import { communicationError } from "./errors";

export interface CommunicationPermissionDecision {
  allowed: boolean;
  reason: string;
  statusCode: number;
}

export interface CommunicationPermissionInput {
  roomKey: string;
  walletPubkey?: string | null;
  userId?: number | null;
}

export interface CommunicationPermissionOptions {
  now?: Date;
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

interface UserRecord {
  id: number;
}

interface CommunicationPermissionPrisma {
  communicationRoom: {
    findUnique(input: unknown): Promise<CommunicationRoomRecord | null>;
  };
  communicationRoomMember: {
    findUnique(input: unknown): Promise<CommunicationRoomMemberRecord | null>;
    upsert(input: unknown): Promise<CommunicationRoomMemberRecord>;
  };
  user: {
    findUnique(input: unknown): Promise<UserRecord | null>;
  };
  circleMember: {
    findUnique(input: unknown): Promise<CircleMemberRecord | null>;
  };
}

interface PermissionContext {
  room: CommunicationRoomRecord | null;
  member: CommunicationRoomMemberRecord | null;
  circleMember: CircleMemberRecord | null;
  now: Date;
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

  const payload = verifyAppRoomClaim({
    externalApp: room.externalApp,
    claim: input.appRoomClaim,
    expected: {
      externalAppId: room.externalAppId,
      roomType: room.roomType,
      externalRoomId: room.externalRoomId ?? "",
      walletPubkey: input.walletPubkey,
    },
    now,
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

async function loadPermissionContext(
  prisma: CommunicationPermissionPrisma,
  input: CommunicationPermissionInput,
  options: CommunicationPermissionOptions,
): Promise<PermissionContext> {
  const now = options.now ?? new Date();
  const room = await loadRoom(prisma, input.roomKey);
  if (!room) {
    return { room: null, member: null, circleMember: null, now };
  }

  const [member, circleMember] = await Promise.all([
    input.walletPubkey
      ? prisma.communicationRoomMember.findUnique({
          where: {
            roomKey_walletPubkey: {
              roomKey: input.roomKey,
              walletPubkey: input.walletPubkey,
            },
          },
        })
      : Promise.resolve(null),
    loadCircleMember(prisma, room, input),
  ]);

  return { room, member, circleMember, now };
}

async function loadCircleMember(
  prisma: CommunicationPermissionPrisma,
  room: CommunicationRoomRecord,
  input: CommunicationPermissionInput,
): Promise<CircleMemberRecord | null> {
  if (!room.parentCircleId) return null;
  const userId = input.userId ?? (await resolveUserIdByWallet(prisma, input));
  if (!userId) return null;

  return prisma.circleMember.findUnique({
    where: {
      circleId_userId: {
        circleId: room.parentCircleId,
        userId,
      },
    },
    select: {
      status: true,
      role: true,
    },
  });
}

async function resolveUserIdByWallet(
  prisma: CommunicationPermissionPrisma,
  input: CommunicationPermissionInput,
): Promise<number | null> {
  if (!input.walletPubkey) return null;
  const user = await prisma.user.findUnique({
    where: { pubkey: input.walletPubkey },
    select: { id: true },
  });
  return user?.id ?? null;
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
  if (context.circleMember?.status === MemberStatus.Banned) {
    return deny("circle_member_banned", 403);
  }
  return null;
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
