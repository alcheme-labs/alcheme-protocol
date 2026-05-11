export type RoomCapability =
  | "textChat"
  | "voice"
  | "voiceClip"
  | "transcriptRecap"
  | "plazaDiscussion"
  | "aiSummary"
  | "draftGeneration"
  | "crystallization"
  | "governance";

export interface RoomCapabilitySet {
  textChat: boolean;
  voice: boolean;
  voiceClip: boolean;
  transcriptRecap: boolean;
  plazaDiscussion: boolean;
  aiSummary: boolean;
  draftGeneration: boolean;
  crystallization: boolean;
  governance: boolean;
}

export interface NormalizeRoomCapabilitiesOptions {
  rejectUnknown?: boolean;
}

export class RoomCapabilityMetadataError extends Error {
  statusCode = 400;

  constructor(
    readonly code: "unknown_room_capability" | "invalid_room_capability",
    readonly capability: string,
  ) {
    super(`${code}:${capability}`);
    this.name = "RoomCapabilityMetadataError";
  }
}

const ROOM_CAPABILITY_KEYS: RoomCapability[] = [
  "textChat",
  "voice",
  "voiceClip",
  "transcriptRecap",
  "plazaDiscussion",
  "aiSummary",
  "draftGeneration",
  "crystallization",
  "governance",
];

const ROOM_CAPABILITY_KEY_SET = new Set<string>(ROOM_CAPABILITY_KEYS);

const CIRCLE_ROOM_CAPABILITIES: RoomCapabilitySet = {
  textChat: true,
  voice: true,
  voiceClip: true,
  transcriptRecap: false,
  plazaDiscussion: true,
  aiSummary: true,
  draftGeneration: true,
  crystallization: true,
  governance: true,
};

const EXTERNAL_ROOM_CAPABILITIES: RoomCapabilitySet = {
  textChat: true,
  voice: true,
  voiceClip: false,
  transcriptRecap: false,
  plazaDiscussion: false,
  aiSummary: false,
  draftGeneration: false,
  crystallization: false,
  governance: false,
};

export function getDefaultRoomCapabilities(roomType: string): RoomCapabilitySet {
  return {
    ...(roomType.trim().toLowerCase() === "circle"
      ? CIRCLE_ROOM_CAPABILITIES
      : EXTERNAL_ROOM_CAPABILITIES),
  };
}

export function normalizeRoomCapabilities(
  raw: unknown,
  roomType: string,
  options: NormalizeRoomCapabilitiesOptions = {},
): RoomCapabilitySet {
  const normalized = getDefaultRoomCapabilities(roomType);
  const record = plainObjectOrNull(raw);
  if (!record) return normalized;

  for (const [key, value] of Object.entries(record)) {
    if (!ROOM_CAPABILITY_KEY_SET.has(key)) {
      if (options.rejectUnknown) {
        throw new RoomCapabilityMetadataError("unknown_room_capability", key);
      }
      continue;
    }
    if (typeof value !== "boolean") {
      if (options.rejectUnknown) {
        throw new RoomCapabilityMetadataError("invalid_room_capability", key);
      }
      continue;
    }
    normalized[key as RoomCapability] = value;
  }

  return normalized;
}

export function withRoomCapabilitiesMetadata(
  metadata: unknown,
  roomType: string,
  options: NormalizeRoomCapabilitiesOptions = {},
): Record<string, unknown> {
  const record = plainObjectOrNull(metadata) ?? {};
  const { capabilities: rawCapabilities, ...rest } = record;
  return {
    ...rest,
    capabilities: normalizeRoomCapabilities(rawCapabilities, roomType, options),
  };
}

export function readRoomCapabilities(
  metadata: unknown,
  roomType: string,
): RoomCapabilitySet {
  return normalizeRoomCapabilities(
    plainObjectOrNull(metadata)?.capabilities,
    roomType,
  );
}

function plainObjectOrNull(value: unknown): Record<string, unknown> | null {
  if (!value || typeof value !== "object" || Array.isArray(value)) return null;
  return value as Record<string, unknown>;
}
