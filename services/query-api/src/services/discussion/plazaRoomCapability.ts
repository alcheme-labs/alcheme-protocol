import type { PrismaClient } from "@prisma/client";

import { buildDiscussionRoomKey } from "../offchainDiscussion";
import { ensureCircleCommunicationRoom } from "../communication/circleRoom";
import {
  resolveRoomDiscussionContext,
  type RoomDiscussionContext,
} from "./roomDiscussionAdapter";
import type { CircleActor } from "../auth/actor";

export class PlazaDiscussionCapabilityError extends Error {
  statusCode = 409;
  code = "plaza_discussion_disabled";

  constructor(circleId: number) {
    super(`Plaza discussion capability is disabled for circle ${circleId}`);
  }
}

type PlazaRoomCapabilityPrisma = Pick<
  PrismaClient,
  | "circle"
  | "externalApp"
  | "communicationRoom"
  | "communicationRoomMember"
>;

export async function resolvePlazaDiscussionContextForWrite(
  prisma: PlazaRoomCapabilityPrisma,
  input: {
    circleId: number;
    activeCircleMember: boolean;
    circleActor?: CircleActor | null;
    now?: Date;
  },
): Promise<RoomDiscussionContext> {
  if (input.activeCircleMember) {
    if (!input.circleActor) {
      throw Object.assign(new Error("circle_actor_required"), {
        statusCode: 401,
      });
    }
    await ensureCircleCommunicationRoom(
      prisma,
      {
        circleId: input.circleId,
        actor: input.circleActor,
      },
      { now: input.now },
    );
  }

  const roomKey = buildDiscussionRoomKey(input.circleId);
  const context = await resolveRoomDiscussionContext(prisma, roomKey);
  if (!context) {
    throw new PlazaDiscussionCapabilityError(input.circleId);
  }
  return context;
}
