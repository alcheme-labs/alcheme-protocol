import crypto from "crypto";
import type { PrismaClient } from "@prisma/client";

import { assertExternalAppCanUseCircle } from "../externalApps/circleBindings";
import { verifyEd25519SignatureBase64 } from "../offchainDiscussion";
import { readRoomCapabilities } from "./capabilities";
import {
  CONTRIBUTION_GRANT_POLICY_DIGEST,
  type CommunicationContributionGrantPayload,
} from "./sessionBootstrap";

type ContributionGrantPrisma = Pick<
  PrismaClient,
  "communicationRoom" | "externalAppCircleBinding"
>;

export class ContributionGrantAuthorizationError extends Error {
  readonly statusCode: number;

  constructor(readonly code: string, statusCode = 403) {
    super(code);
    this.name = "ContributionGrantAuthorizationError";
    this.statusCode = statusCode;
  }
}

export async function assertAuthorizedContributionGrant(
  prisma: ContributionGrantPrisma,
  grant: CommunicationContributionGrantPayload,
  options: { now?: Date } = {},
) {
  const room = await prisma.communicationRoom.findUnique({
    where: { roomKey: grant.roomKey },
  });
  if (!room) {
    throw new ContributionGrantAuthorizationError("contribution_grant_room_not_found", 404);
  }
  if (room.roomType === "circle") {
    throw new ContributionGrantAuthorizationError("contribution_grant_external_room_required");
  }
  if (room.externalAppId !== grant.externalAppId) {
    throw new ContributionGrantAuthorizationError("contribution_grant_app_mismatch");
  }
  if (Number(room.parentCircleId) !== grant.circleId) {
    throw new ContributionGrantAuthorizationError("contribution_grant_circle_mismatch");
  }
  const now = options.now ?? new Date();
  if (
    room.lifecycleStatus !== "active"
    || room.endedAt
    || (room.expiresAt && room.expiresAt.getTime() <= now.getTime())
  ) {
    throw new ContributionGrantAuthorizationError("contribution_grant_room_inactive");
  }
  const capabilities = readRoomCapabilities(room.metadata, room.roomType);
  if (!capabilities.sourceMaterialSubmission) {
    throw new ContributionGrantAuthorizationError("contribution_grant_capability_required");
  }
  try {
    await assertExternalAppCanUseCircle(prisma, {
      externalAppId: grant.externalAppId,
      circleId: grant.circleId,
    });
  } catch (error) {
    throw new ContributionGrantAuthorizationError(
      error instanceof Error ? error.message : "external_app_circle_binding_required",
    );
  }
  return room;
}

export function assertCommunicationMessageCoveredByGrant(input: {
  session: {
    walletPubkey: string;
    scopeType: string;
    scopeRef: string;
    issuedAt: Date;
    contributionGrant: unknown;
    contributionGrantDigest: string | null;
  };
  message: {
    senderPubkey: string;
    roomKey: string;
    createdAt: Date;
  };
  externalAppId: string;
  circleId: number;
}): { payload: CommunicationContributionGrantPayload; digest: string } {
  const evidence = plainObject(input.session.contributionGrant);
  const payload = plainObject(evidence?.payload);
  const digest = normalizeDigest(input.session.contributionGrantDigest);
  const signedMessage = typeof evidence?.signedMessage === "string"
    ? evidence.signedMessage
    : "";
  const signature = typeof evidence?.signature === "string"
    ? evidence.signature
    : "";
  if (
    !evidence
    || !payload
    || !digest
    || evidence.digest !== digest
    || !signedMessage
    || !signature
  ) {
    throw new ContributionGrantAuthorizationError(
      "communication_message_contribution_not_authorized",
    );
  }
  if (input.session.walletPubkey !== input.message.senderPubkey) {
    throw new ContributionGrantAuthorizationError(
      "communication_message_session_sender_mismatch",
    );
  }
  if (input.session.scopeType !== "room" || input.session.scopeRef !== input.message.roomKey) {
    throw new ContributionGrantAuthorizationError(
      "communication_message_session_scope_mismatch",
    );
  }
  const signedPayload = parseSignedSessionPayload(signedMessage);
  const signedGrant = plainObject(signedPayload?.contributionGrant);
  if (
    crypto.createHash("sha256").update(signedMessage).digest("hex") !== digest
    || !verifyEd25519SignatureBase64({
      senderPubkey: input.session.walletPubkey,
      message: signedMessage,
      signatureBase64: signature,
    })
    || !signedPayload
    || signedPayload.v !== 2
    || signedPayload.action !== "communication_session_init"
    || signedPayload.walletPubkey !== input.session.walletPubkey
    || signedPayload.scopeType !== "room"
    || signedPayload.scopeRef !== input.session.scopeRef
    || !signedGrant
    || !sameGrantPayload(signedGrant, payload)
  ) {
    throw new ContributionGrantAuthorizationError(
      "communication_message_contribution_proof_invalid",
    );
  }
  if (
    payload.contractVersion !== "communication_contribution_grant.v1"
    || payload.externalAppId !== input.externalAppId
    || payload.roomKey !== input.message.roomKey
    || Number(payload.circleId) !== input.circleId
    || payload.purpose !== "circle_discussion_draft"
    || payload.visibility !== "circle_only"
    || payload.policyDigest !== CONTRIBUTION_GRANT_POLICY_DIGEST
  ) {
    throw new ContributionGrantAuthorizationError(
      "communication_message_contribution_scope_mismatch",
    );
  }
  const grantExpiresAt = new Date(String(payload.grantExpiresAt || ""));
  if (
    Number.isNaN(grantExpiresAt.getTime())
    || input.message.createdAt.getTime() < input.session.issuedAt.getTime()
    || input.message.createdAt.getTime() > grantExpiresAt.getTime()
  ) {
    throw new ContributionGrantAuthorizationError(
      "communication_message_outside_grant_window",
    );
  }
  return {
    payload: payload as unknown as CommunicationContributionGrantPayload,
    digest,
  };
}

function plainObject(value: unknown): Record<string, unknown> | null {
  if (!value || typeof value !== "object" || Array.isArray(value)) return null;
  return value as Record<string, unknown>;
}

function normalizeDigest(value: unknown): string | null {
  const normalized = typeof value === "string" ? value.trim().toLowerCase() : "";
  return /^[a-f0-9]{64}$/.test(normalized) ? normalized : null;
}

function parseSignedSessionPayload(value: string): Record<string, unknown> | null {
  const prefix = "alcheme-communication-session:";
  if (!value.startsWith(prefix)) return null;
  try {
    return plainObject(JSON.parse(value.slice(prefix.length)));
  } catch {
    return null;
  }
}

function sameGrantPayload(
  signed: Record<string, unknown>,
  persisted: Record<string, unknown>,
): boolean {
  const keys = [
    "contractVersion",
    "externalAppId",
    "roomKey",
    "circleId",
    "purpose",
    "visibility",
    "policyDigest",
    "grantExpiresAt",
  ];
  return keys.every((key) => signed[key] === persisted[key]);
}
