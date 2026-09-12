import type { PrismaClient } from "@prisma/client";

import type { VoiceSpeakerPolicy } from "../../config/voice";
import type { CircleActor } from "../auth/actor";
import { canModerateRoom } from "../communication/permissions";

type VoicePermissionPrisma = Pick<
  PrismaClient,
  "communicationRoom" | "communicationRoomMember"
>;

export async function canModerateVoiceSession(
  prisma: VoicePermissionPrisma,
  input: {
    roomKey: string;
    walletPubkey: string;
    policy: VoiceSpeakerPolicy;
    actor?: CircleActor | null;
  },
): Promise<boolean> {
  const roomModeration = await canModerateRoom(prisma, {
    roomKey: input.roomKey,
    walletPubkey: input.walletPubkey,
    actor: input.actor,
  });
  if (roomModeration.allowed) return true;

  const member = await prisma.communicationRoomMember.findUnique({
    where: {
      roomKey_walletPubkey: {
        roomKey: input.roomKey,
        walletPubkey: input.walletPubkey,
      },
    },
  });
  const role =
    member && !member.leftAt && typeof member.role === "string"
      ? member.role.trim().toLowerCase()
      : "";
  return !!role && input.policy.moderatorRoles.includes(role);
}
