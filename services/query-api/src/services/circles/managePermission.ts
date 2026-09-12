import type { PrismaClient } from "@prisma/client";

import { requireCircleManagerActor } from "../auth/actor";

export async function resolveActorCanManageCircle(input: {
  req: unknown;
  prisma: PrismaClient;
  circleId: number;
  actorPubkey: string;
}): Promise<boolean> {
  const actor = await requireCircleManagerActor(input.req, input.prisma, {
    circleId: input.circleId,
    requireSessionCookie: true,
  });
  return actor.pubkey === input.actorPubkey.trim();
}
