import { createHash } from "crypto";
import { communicationError } from "./errors";

const ROOM_KEY_MAX_LENGTH = 96;
const EXTERNAL_ROOM_ID_MAX_LENGTH = 64;

const VALID_EXTERNAL_APP_ID = /^[a-z0-9][a-z0-9-]{1,47}$/;
const VALID_EXTERNAL_ROOM_ID = /^[A-Za-z0-9][A-Za-z0-9._:-]{0,63}$/;
const VALID_DIRECT_PAIR_HASH = /^[a-f0-9]{64}$/;

const ALLOWED_ROOM_TYPES = new Set([
  "circle",
  "custom",
  "direct",
  "dungeon",
  "guild",
  "party",
  "world",
]);

export type CommunicationRoomKeyInput =
  | {
      roomType: "circle" | string;
      parentCircleId: number;
    }
  | {
      externalAppId: string;
      roomType: string;
      externalRoomId: string;
    }
  | {
      roomType: "direct" | string;
      participantPubkeys: [string, string] | string[];
    };

export type ParsedCommunicationRoomKey =
  | {
      kind: "circle";
      roomKey: string;
      parentCircleId: number;
    }
  | {
      kind: "external";
      roomKey: string;
      externalAppId: string;
      roomType: string;
      externalRoomId: string;
    }
  | {
      kind: "direct";
      roomKey: string;
      pairHash: string;
    };

export function normalizeRoomType(roomType: string): string {
  const normalized = roomType.trim().toLowerCase();
  if (!ALLOWED_ROOM_TYPES.has(normalized)) {
    throw communicationError(400, "invalid_room_type", `Invalid roomType: ${roomType}`);
  }
  return normalized;
}

export function buildCommunicationRoomKey(
  input: CommunicationRoomKeyInput,
): string {
  const roomType = normalizeRoomType(input.roomType);

  if (roomType === "circle") {
    if (
      !("parentCircleId" in input) ||
      !Number.isSafeInteger(input.parentCircleId) ||
      input.parentCircleId <= 0
    ) {
      throw communicationError(
        400,
        "invalid_parent_circle_id",
        "parentCircleId must be a positive integer",
      );
    }
    return assertRoomKeyLength(`circle:${input.parentCircleId}`);
  }

  if (roomType === "direct") {
    if (!("participantPubkeys" in input)) {
      throw communicationError(
        400,
        "invalid_direct_room_participants",
        "participantPubkeys are required for direct rooms",
      );
    }
    return assertRoomKeyLength(
      `direct:${buildStablePairHash(input.participantPubkeys)}`,
    );
  }

  if (
    !("externalAppId" in input) ||
    !input.externalAppId.match(VALID_EXTERNAL_APP_ID)
  ) {
    throw communicationError(400, "invalid_external_app_id", "Invalid externalAppId");
  }
  if (
    !("externalRoomId" in input) ||
    input.externalRoomId.length > EXTERNAL_ROOM_ID_MAX_LENGTH
  ) {
    throw communicationError(400, "invalid_external_room_id", "externalRoomId is too long");
  }
  if (!input.externalRoomId.match(VALID_EXTERNAL_ROOM_ID)) {
    throw communicationError(400, "invalid_external_room_id", "Invalid externalRoomId");
  }

  return assertRoomKeyLength(
    `external:${input.externalAppId}:${roomType}:${input.externalRoomId}`,
  );
}

export function parseCommunicationRoomKey(
  roomKey: string,
): ParsedCommunicationRoomKey {
  if (roomKey.startsWith("circle:")) {
    const rawCircleId = roomKey.slice("circle:".length);
    const parentCircleId = Number(rawCircleId);
    if (
      !Number.isSafeInteger(parentCircleId) ||
      parentCircleId <= 0 ||
      `${parentCircleId}` !== rawCircleId
    ) {
      throw communicationError(400, "invalid_room_key", "Invalid circle room key");
    }
    return {
      kind: "circle",
      roomKey,
      parentCircleId,
    };
  }

  if (roomKey.startsWith("direct:")) {
    const pairHash = roomKey.slice("direct:".length);
    if (!VALID_DIRECT_PAIR_HASH.test(pairHash)) {
      throw communicationError(400, "invalid_room_key", "Invalid direct room key");
    }
    return {
      kind: "direct",
      roomKey,
      pairHash,
    };
  }

  if (roomKey.startsWith("external:")) {
    const [, externalAppId, rawRoomType, ...externalRoomIdParts] =
      roomKey.split(":");
    const externalRoomId = externalRoomIdParts.join(":");
    if (!externalAppId?.match(VALID_EXTERNAL_APP_ID)) {
      throw communicationError(400, "invalid_external_app_id", "Invalid external room key app id");
    }
    const roomType = normalizeRoomType(rawRoomType ?? "");
    if (
      !externalRoomId ||
      externalRoomId.length > EXTERNAL_ROOM_ID_MAX_LENGTH ||
      !externalRoomId.match(VALID_EXTERNAL_ROOM_ID)
    ) {
      throw communicationError(400, "invalid_external_room_id", "Invalid external room key room id");
    }
    return {
      kind: "external",
      roomKey,
      externalAppId,
      roomType,
      externalRoomId,
    };
  }

  throw communicationError(400, "invalid_room_key", "Unsupported communication room key");
}

function buildStablePairHash(participantPubkeys: string[]): string {
  const normalizedPubkeys = [
    ...new Set(
      participantPubkeys.map((pubkey) => pubkey.trim()).filter(Boolean),
    ),
  ].sort();
  if (normalizedPubkeys.length !== 2) {
    throw communicationError(
      400,
      "invalid_direct_room_participants",
      "direct rooms require exactly two unique participant pubkeys",
    );
  }

  return createHash("sha256").update(normalizedPubkeys.join(":")).digest("hex");
}

function assertRoomKeyLength(roomKey: string): string {
  if (roomKey.length > ROOM_KEY_MAX_LENGTH) {
    throw communicationError(400, "invalid_room_key", "communication room key is too long");
  }
  return roomKey;
}
