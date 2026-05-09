import crypto from "crypto";

import type { Prisma, PrismaClient } from "@prisma/client";

type PrismaLike = PrismaClient | Prisma.TransactionClient;

export type VoiceTranscriptionMode =
  | "off"
  | "live_caption"
  | "transcript"
  | "recap"
  | "full";

export interface VoiceTranscriptSegmentInput {
  segmentId?: string | null;
  speakerPubkey: string;
  speakerHandle?: string | null;
  text: string;
  startedAt?: Date | string | null;
  endedAt?: Date | string | null;
  confidence?: number | null;
  language?: string | null;
}

export interface NormalizedVoiceTranscriptSegment {
  segmentId: string;
  speakerPubkey: string;
  speakerHandle: string | null;
  text: string;
  startedAt: Date;
  endedAt: Date | null;
  confidence: number | null;
  language: string | null;
}

interface VoiceSessionWithRoom {
  id: string;
  roomKey: string;
  provider: string;
  providerRoomId: string;
  createdByPubkey: string;
  metadata?: unknown;
  room?: {
    roomKey: string;
    parentCircleId?: number | null;
    transcriptionMode?: string | null;
    knowledgeMode?: string | null;
  } | null;
}

export interface VoiceTranscriptIngestResult {
  status: "stored" | "skipped";
  mode: VoiceTranscriptionMode;
  reason?: string;
  storedCount: number;
  envelopeIds: string[];
}

export function normalizeVoiceTranscriptionMode(
  raw: unknown,
): VoiceTranscriptionMode {
  const normalized = String(raw || "")
    .trim()
    .toLowerCase();
  if (normalized === "live_caption") return "live_caption";
  if (normalized === "transcript") return "transcript";
  if (normalized === "recap") return "recap";
  if (normalized === "full") return "full";
  return "off";
}

export function canPersistVoiceTranscript(
  mode: VoiceTranscriptionMode,
): boolean {
  return mode === "transcript" || mode === "full";
}

export function normalizeVoiceTranscriptSegments(
  input: VoiceTranscriptSegmentInput[],
  now: Date = new Date(),
): NormalizedVoiceTranscriptSegment[] {
  const seen = new Set<string>();
  const segments: NormalizedVoiceTranscriptSegment[] = [];
  input.forEach((segment, index) => {
    const speakerPubkey = normalizeString(segment.speakerPubkey);
    const text = normalizeTranscriptText(segment.text);
    if (!speakerPubkey || !text) return;
    const startedAt = parseDate(segment.startedAt) ?? now;
    const endedAt = parseDate(segment.endedAt);
    const explicitSegmentId = normalizeString(segment.segmentId);
    const segmentId =
      explicitSegmentId ||
      sha256Hex(
        stableJsonStringify({
          speakerPubkey,
          text,
          startedAt: startedAt.toISOString(),
          index,
        }),
      ).slice(0, 32);
    if (seen.has(segmentId)) return;
    seen.add(segmentId);
    segments.push({
      segmentId,
      speakerPubkey,
      speakerHandle: normalizeString(segment.speakerHandle) || null,
      text,
      startedAt,
      endedAt,
      confidence: normalizeConfidence(segment.confidence),
      language: normalizeString(segment.language) || null,
    });
  });
  return segments;
}

export function buildVoiceTranscriptText(
  segments: NormalizedVoiceTranscriptSegment[],
): string {
  return segments
    .map((segment) => {
      const speaker =
        segment.speakerHandle || shortPubkey(segment.speakerPubkey);
      return `[${segment.startedAt.toISOString()}] ${speaker}: ${segment.text}`;
    })
    .join("\n");
}

export function computeVoiceTranscriptDigest(
  segments: NormalizedVoiceTranscriptSegment[],
): string {
  return sha256Hex(
    stableJsonStringify(
      segments.map((segment) => ({
        segmentId: segment.segmentId,
        speakerPubkey: segment.speakerPubkey,
        text: segment.text,
        startedAt: segment.startedAt.toISOString(),
        endedAt: segment.endedAt?.toISOString?.() ?? null,
      })),
    ),
  );
}

export async function ingestVoiceTranscriptSegments(
  prisma: PrismaLike,
  input: {
    voiceSessionId: string;
    segments: VoiceTranscriptSegmentInput[];
    now?: Date;
  },
): Promise<VoiceTranscriptIngestResult> {
  const now = input.now ?? new Date();
  const voiceSession = await loadVoiceSession(prisma, input.voiceSessionId);
  const mode = normalizeVoiceTranscriptionMode(
    voiceSession?.room?.transcriptionMode,
  );

  if (!voiceSession) {
    return {
      status: "skipped",
      mode,
      reason: "voice_session_not_found",
      storedCount: 0,
      envelopeIds: [],
    };
  }

  if (!canPersistVoiceTranscript(mode)) {
    return {
      status: "skipped",
      mode,
      reason:
        mode === "recap"
          ? "recap_mode_does_not_persist_segments"
          : mode === "live_caption"
            ? "live_caption_not_persisted"
            : "transcription_disabled",
      storedCount: 0,
      envelopeIds: [],
    };
  }

  const segments = normalizeVoiceTranscriptSegments(input.segments, now);
  const envelopeIds: string[] = [];
  for (const [index, segment] of segments.entries()) {
    const envelopeId = buildTranscriptEnvelopeId({
      voiceSessionId: voiceSession.id,
      segment,
      index,
    });
    await (prisma as any).communicationMessage.create({
      data: {
        envelopeId,
        roomKey: voiceSession.roomKey,
        senderPubkey: segment.speakerPubkey,
        senderHandle: segment.speakerHandle,
        messageKind: "voice_transcript",
        payloadText: segment.text,
        payloadHash: computeTranscriptPayloadHash({
          voiceSession,
          segment,
        }),
        storageUri: null,
        durationMs: segment.endedAt
          ? Math.max(0, segment.endedAt.getTime() - segment.startedAt.getTime())
          : null,
        metadata: {
          voiceTranscript: {
            voiceSessionId: voiceSession.id,
            provider: voiceSession.provider,
            providerRoomId: voiceSession.providerRoomId,
            segmentId: segment.segmentId,
            startedAt: segment.startedAt.toISOString(),
            endedAt: segment.endedAt?.toISOString?.() ?? null,
            confidence: segment.confidence,
            language: segment.language,
          },
        },
        signature: null,
        signedMessage: `alcheme-voice-transcript:${stableJsonStringify({
          voiceSessionId: voiceSession.id,
          segmentId: segment.segmentId,
          textDigest: sha256Hex(segment.text),
        })}`,
        signatureVerified: false,
        authMode: "system_transcription",
        sessionId: null,
        clientTimestamp: segment.startedAt,
        prevEnvelopeId: null,
      },
    });
    envelopeIds.push(envelopeId);
  }

  return {
    status: "stored",
    mode,
    storedCount: envelopeIds.length,
    envelopeIds,
  };
}

async function loadVoiceSession(
  prisma: PrismaLike,
  voiceSessionId: string,
): Promise<VoiceSessionWithRoom | null> {
  if (!voiceSessionId.trim()) return null;
  return (prisma as any).voiceSession.findUnique({
    where: { id: voiceSessionId.trim() },
    include: { room: true },
  });
}

function buildTranscriptEnvelopeId(input: {
  voiceSessionId: string;
  segment: NormalizedVoiceTranscriptSegment;
  index: number;
}): string {
  return `voice_tx_${sha256Hex(
    stableJsonStringify({
      voiceSessionId: input.voiceSessionId,
      segmentId: input.segment.segmentId,
      speakerPubkey: input.segment.speakerPubkey,
      startedAt: input.segment.startedAt.toISOString(),
      index: input.index,
    }),
  ).slice(0, 48)}`;
}

function computeTranscriptPayloadHash(input: {
  voiceSession: VoiceSessionWithRoom;
  segment: NormalizedVoiceTranscriptSegment;
}): string {
  return sha256Hex(
    stableJsonStringify({
      roomKey: input.voiceSession.roomKey,
      voiceSessionId: input.voiceSession.id,
      messageKind: "voice_transcript",
      senderPubkey: input.segment.speakerPubkey,
      text: input.segment.text,
      segmentId: input.segment.segmentId,
      startedAt: input.segment.startedAt.toISOString(),
      endedAt: input.segment.endedAt?.toISOString?.() ?? null,
    }),
  );
}

function normalizeTranscriptText(value: unknown): string {
  return String(value || "")
    .replace(/\r\n/g, "\n")
    .replace(/[ \t]+/g, " ")
    .trim()
    .slice(0, 4_000);
}

function normalizeString(value: unknown): string {
  return typeof value === "string" ? value.trim() : "";
}

function normalizeConfidence(value: unknown): number | null {
  const parsed = Number(value);
  if (!Number.isFinite(parsed)) return null;
  return Math.max(0, Math.min(1, parsed));
}

function parseDate(value: unknown): Date | null {
  if (value instanceof Date && !Number.isNaN(value.getTime())) {
    return value;
  }
  if (typeof value === "string" || typeof value === "number") {
    const parsed = new Date(value);
    if (!Number.isNaN(parsed.getTime())) return parsed;
  }
  return null;
}

function shortPubkey(pubkey: string): string {
  if (pubkey.length <= 10) return pubkey;
  return `${pubkey.slice(0, 4)}...${pubkey.slice(-4)}`;
}

function sha256Hex(value: string): string {
  return crypto.createHash("sha256").update(value).digest("hex");
}

function stableJsonStringify(value: unknown): string {
  if (value === null || typeof value !== "object") {
    return JSON.stringify(value);
  }
  if (Array.isArray(value)) {
    return `[${value.map((item) => stableJsonStringify(item)).join(",")}]`;
  }
  return `{${Object.keys(value as Record<string, unknown>)
    .sort()
    .map(
      (key) =>
        `${JSON.stringify(key)}:${stableJsonStringify(
          (value as Record<string, unknown>)[key],
        )}`,
    )
    .join(",")}}`;
}
