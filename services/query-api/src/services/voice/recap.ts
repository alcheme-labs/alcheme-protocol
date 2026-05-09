import type { Prisma, PrismaClient } from "@prisma/client";

import {
  summarizeDiscussionThread,
  type DiscussionSummaryMessage,
} from "../../ai/discussion-summary";
import { createSourceMaterial } from "../sourceMaterials/ingest";
import {
  buildVoiceTranscriptText,
  computeVoiceTranscriptDigest,
  normalizeVoiceTranscriptSegments,
  normalizeVoiceTranscriptionMode,
  type NormalizedVoiceTranscriptSegment,
  type VoiceTranscriptSegmentInput,
  type VoiceTranscriptionMode,
} from "./transcription";

type PrismaLike = PrismaClient | Prisma.TransactionClient;

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
    roomType?: string | null;
    transcriptionMode?: string | null;
    knowledgeMode?: string | null;
  } | null;
}

export interface VoiceRecapResult {
  status: "stored" | "skipped";
  mode: VoiceTranscriptionMode;
  reason?: string;
  voiceSessionId: string;
  summary?: string;
  method?: "rule" | "llm";
  sourceSegmentCount?: number;
  sourceDigest?: string;
  draftSource?: {
    status:
      | "not_requested"
      | "review_required"
      | "requires_parent_circle_and_user";
    sourceMaterialId?: number;
    circleId?: number;
  };
}

export async function generateVoiceRecap(
  prisma: PrismaLike,
  input: {
    voiceSessionId: string;
    transcriptSegments?: VoiceTranscriptSegmentInput[];
    requestedByUserId?: number | null;
    createDraftSource?: boolean;
    now?: Date;
  },
): Promise<VoiceRecapResult> {
  const now = input.now ?? new Date();
  const voiceSession = await loadVoiceSession(prisma, input.voiceSessionId);
  if (!voiceSession) {
    return {
      status: "skipped",
      mode: "off",
      reason: "voice_session_not_found",
      voiceSessionId: input.voiceSessionId,
    };
  }

  const mode = normalizeVoiceTranscriptionMode(
    voiceSession.room?.transcriptionMode,
  );
  if (mode !== "recap" && mode !== "full") {
    return {
      status: "skipped",
      mode,
      reason: "recap_not_enabled",
      voiceSessionId: voiceSession.id,
    };
  }

  const segments = await loadRecapSegments(prisma, voiceSession, {
    inputSegments: input.transcriptSegments,
    now,
  });
  if (segments.length === 0) {
    return {
      status: "skipped",
      mode,
      reason: "no_transcript_segments",
      voiceSessionId: voiceSession.id,
    };
  }

  const summaryResult = await summarizeDiscussionThread({
    circleName: `Voice session ${voiceSession.id}`,
    circleDescription: voiceSession.room?.roomType ?? null,
    messages: segments.map(toDiscussionSummaryMessage),
    // Voice transcript text is private plaintext. Keep V1 recap rule-based until
    // the AI provider boundary can explicitly carry private voice content.
    useLLM: false,
  });
  const sourceDigest = computeVoiceTranscriptDigest(segments);
  const draftSource = await maybeCreateDraftSource(prisma, {
    mode,
    voiceSession,
    requestedByUserId: input.requestedByUserId ?? null,
    createDraftSource: Boolean(input.createDraftSource),
    summary: summaryResult.summary,
    transcriptText: buildVoiceTranscriptText(segments),
  });

  const existingMetadata = plainObjectOrNull(voiceSession.metadata);
  await (prisma as any).voiceSession.update({
    where: { id: voiceSession.id },
    data: {
      metadata: {
        ...(existingMetadata ?? {}),
        voiceRecap: {
          voiceSessionId: voiceSession.id,
          mode,
          summary: summaryResult.summary,
          method: summaryResult.method,
          generatedAt: now.toISOString(),
          sourceSegmentCount: segments.length,
          sourceDigest,
          draftSource,
        },
      },
    },
  });

  return {
    status: "stored",
    mode,
    voiceSessionId: voiceSession.id,
    summary: summaryResult.summary,
    method: summaryResult.method,
    sourceSegmentCount: segments.length,
    sourceDigest,
    draftSource,
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

async function loadRecapSegments(
  prisma: PrismaLike,
  voiceSession: VoiceSessionWithRoom,
  input: {
    inputSegments?: VoiceTranscriptSegmentInput[];
    now: Date;
  },
): Promise<NormalizedVoiceTranscriptSegment[]> {
  const direct = normalizeVoiceTranscriptSegments(
    input.inputSegments ?? [],
    input.now,
  );
  if (direct.length > 0) return direct;
  if (typeof (prisma as any).communicationMessage?.findMany !== "function") {
    return [];
  }

  const rows = await (prisma as any).communicationMessage.findMany({
    where: {
      roomKey: voiceSession.roomKey,
      messageKind: "voice_transcript",
      deleted: false,
    },
    orderBy: [{ clientTimestamp: "asc" }, { lamport: "asc" }],
    take: 500,
  });

  return normalizeVoiceTranscriptSegments(
    (Array.isArray(rows) ? rows : [])
      .filter((row) => {
        const metadata = plainObjectOrNull(row.metadata);
        const transcript = plainObjectOrNull(metadata?.voiceTranscript);
        return transcript?.voiceSessionId === voiceSession.id;
      })
      .map((row) => {
        const metadata = plainObjectOrNull(row.metadata);
        const transcript = plainObjectOrNull(metadata?.voiceTranscript);
        const startedAt =
          normalizeDateLike(row.clientTimestamp) ??
          normalizeDateLike(transcript?.startedAt) ??
          input.now;
        const endedAt = normalizeDateLike(transcript?.endedAt);
        return {
          segmentId: String(transcript?.segmentId ?? row.envelopeId ?? ""),
          speakerPubkey: String(
            row.senderPubkey ?? voiceSession.createdByPubkey,
          ),
          speakerHandle:
            typeof row.senderHandle === "string" ? row.senderHandle : null,
          text: String(row.payloadText ?? ""),
          startedAt,
          endedAt,
          confidence:
            typeof transcript?.confidence === "number"
              ? transcript.confidence
              : null,
          language:
            typeof transcript?.language === "string"
              ? transcript.language
              : null,
        };
      }),
    input.now,
  );
}

function toDiscussionSummaryMessage(
  segment: NormalizedVoiceTranscriptSegment,
): DiscussionSummaryMessage {
  return {
    senderHandle: segment.speakerHandle,
    senderPubkey: segment.speakerPubkey,
    text: segment.text,
    createdAt: segment.startedAt,
  };
}

async function maybeCreateDraftSource(
  prisma: PrismaLike,
  input: {
    mode: VoiceTranscriptionMode;
    voiceSession: VoiceSessionWithRoom;
    requestedByUserId: number | null;
    createDraftSource: boolean;
    summary: string;
    transcriptText: string;
  },
): Promise<VoiceRecapResult["draftSource"]> {
  if (input.mode !== "full" || !input.createDraftSource) {
    return { status: "not_requested" };
  }

  const circleId = Number(input.voiceSession.room?.parentCircleId ?? 0);
  const requestedByUserId = Number(input.requestedByUserId ?? 0);
  if (
    !Number.isFinite(circleId) ||
    circleId <= 0 ||
    !Number.isFinite(requestedByUserId) ||
    requestedByUserId <= 0
  ) {
    return { status: "requires_parent_circle_and_user" };
  }

  const material = await createSourceMaterial(prisma as PrismaClient, {
    circleId,
    uploadedByUserId: requestedByUserId,
    discussionThreadId: `voice:${input.voiceSession.id}`,
    name: `Voice recap ${input.voiceSession.id}`,
    mimeType: "text/markdown",
    content: [
      `# Voice recap ${input.voiceSession.id}`,
      "",
      "## Summary",
      input.summary,
      "",
      "## Transcript",
      input.transcriptText,
    ].join("\n"),
  });

  return {
    status: "review_required",
    sourceMaterialId: material.id,
    circleId,
  };
}

function plainObjectOrNull(value: unknown): Record<string, unknown> | null {
  return value && typeof value === "object" && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : null;
}

function normalizeDateLike(value: unknown): Date | string | null {
  if (value instanceof Date && !Number.isNaN(value.getTime())) return value;
  if (typeof value === "string") {
    const parsed = new Date(value);
    if (!Number.isNaN(parsed.getTime())) return value;
  }
  return null;
}
