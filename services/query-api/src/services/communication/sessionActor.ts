import type { PrismaClient } from '@prisma/client';

import {
  AuthActorError,
  requireAuthenticatedActor,
  requireCircleActorForAuthActor,
  type CircleActor,
} from '../auth/actor';
import type { CommunicationSessionRow } from './sessionBootstrap';

export type RoomActorAccessResult =
  | { ok: true; actor: CircleActor | null }
  | {
      ok: false;
      status: number;
      error: string;
      body?: Record<string, unknown>;
    };

function optionalPositiveInt(value: unknown): number | null {
  const parsed = Number(value);
  if (!Number.isFinite(parsed) || parsed <= 0) return null;
  return Math.trunc(parsed);
}

export function parseFirstPartyCircleRoomKey(roomKey: string): number | null {
  if (!roomKey.startsWith('circle:')) return null;
  return optionalPositiveInt(roomKey.slice('circle:'.length));
}

export function isFirstPartyCircleRoomKey(roomKey: string): boolean {
  return parseFirstPartyCircleRoomKey(roomKey) !== null;
}

export async function resolveFirstPartyCircleRoomId(
  prisma: Pick<PrismaClient, 'communicationRoom'>,
  roomKey: string,
): Promise<number | null> {
  const routeCircleId = parseFirstPartyCircleRoomKey(roomKey);
  if (routeCircleId) return routeCircleId;

  const room = await prisma.communicationRoom.findUnique({
    where: { roomKey },
  });
  if (!room || room.roomType !== 'circle') return null;
  return optionalPositiveInt((room as any).parentCircleId);
}

export async function resolveCircleActorForCommunicationSession(
  prisma: PrismaClient,
  req: any,
  roomKey: string,
  session: CommunicationSessionRow,
): Promise<RoomActorAccessResult> {
  const circleId = await resolveFirstPartyCircleRoomId(prisma, roomKey);
  if (!circleId) return { ok: true, actor: null };

  try {
    const actor = await requireAuthenticatedActor(req, prisma, {
      requireSessionCookie: true,
    });
    const circleActor = await requireCircleActorForAuthActor(actor, prisma, {
      circleId,
      action: 'communication.room',
    });
    if (circleActor.pubkey !== session.walletPubkey) {
      return {
        ok: false,
        status: 403,
        error: 'communication_session_actor_mismatch',
      };
    }
    return { ok: true, actor: circleActor };
  } catch (error) {
    if (error instanceof AuthActorError) {
      return {
        ok: false,
        status: error.statusCode,
        error: error.code,
        body: error.toResponseBody(),
      };
    }
    throw error;
  }
}

export function sendRoomActorAccessError(
  res: { status(code: number): { json(body: unknown): void } },
  result: Extract<RoomActorAccessResult, { ok: false }>,
) {
  return res.status(result.status).json(result.body ?? { error: result.error });
}
