import type { PrismaClient } from "@prisma/client";

import { buildDiscussionRoomKey } from "../offchainDiscussion";
import { ensureCircleCommunicationRoom } from "../communication/circleRoom";
import {
  resolveRoomDiscussionContext,
  type RoomDiscussionContext,
} from "./roomDiscussionAdapter";

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
  | "user"
  | "circleMember"
>;

export async function resolvePlazaDiscussionContextForWrite(
  prisma: PlazaRoomCapabilityPrisma,
  input: {
    circleId: number;
    walletPubkey: string;
    activeCircleMember: boolean;
    now?: Date;
  },
): Promise<RoomDiscussionContext> {
  if (input.activeCircleMember) {
    await ensureCircleCommunicationRoom(
      prisma,
      {
        circleId: input.circleId,
        walletPubkey: input.walletPubkey,
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
