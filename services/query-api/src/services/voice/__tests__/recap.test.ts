import { describe, expect, jest, test } from "@jest/globals";

jest.mock("../../sourceMaterials/ingest", () => ({
  createSourceMaterial: jest.fn(),
}));

import { generateVoiceRecap } from "../recap";
import { ingestVoiceTranscriptSegments } from "../transcription";

const { createSourceMaterial: createSourceMaterialMock } = jest.requireMock(
  "../../sourceMaterials/ingest",
) as {
  createSourceMaterial: jest.Mock;
};

const NOW = new Date("2026-05-08T12:00:00.000Z");

function buildPrisma(input: {
  transcriptionMode: string;
  parentCircleId?: number | null;
  metadata?: Record<string, unknown> | null;
  messages?: any[];
}) {
  const room = {
    roomKey: "external:game:dungeon:run-1",
    roomType: "dungeon",
    parentCircleId: input.parentCircleId ?? null,
    transcriptionMode: input.transcriptionMode,
    knowledgeMode: input.transcriptionMode === "full" ? "full" : "off",
  };
  let voiceSession = {
    id: "voice_1",
    roomKey: room.roomKey,
    provider: "livekit",
    providerRoomId: "alcheme_voice_1",
    createdByPubkey: "wallet-speaker",
    metadata: input.metadata ?? null,
    room,
  };
  const messages = [...(input.messages ?? [])];

  return {
    voiceSession: {
      findUnique: jest.fn(async () => voiceSession),
      update: jest.fn(async ({ data }: any) => {
        voiceSession = {
          ...voiceSession,
          ...data,
        };
        return voiceSession;
      }),
    },
    communicationMessage: {
      create: jest.fn(async ({ data }: any) => {
        const row = {
          ...data,
          lamport: BigInt(messages.length + 1),
          deleted: false,
          createdAt: NOW,
          updatedAt: NOW,
        };
        messages.push(row);
        return row;
      }),
      findMany: jest.fn(async () => messages),
    },
  } as any;
}

describe("voice recap and transcription pipeline", () => {
  test("does not persist transcript segments when transcription is off", async () => {
    const prisma = buildPrisma({ transcriptionMode: "off" });

    const result = await ingestVoiceTranscriptSegments(prisma, {
      voiceSessionId: "voice_1",
      now: NOW,
      segments: [
        {
          segmentId: "seg-1",
          speakerPubkey: "wallet-speaker",
          text: "pulling the next pack",
          startedAt: NOW,
        },
      ],
    });

    expect(result).toMatchObject({
      status: "skipped",
      mode: "off",
      reason: "transcription_disabled",
      storedCount: 0,
    });
    expect(prisma.communicationMessage.create).not.toHaveBeenCalled();
  });

  test("persists transcript segments only for transcript-capable modes", async () => {
    const prisma = buildPrisma({ transcriptionMode: "transcript" });

    const result = await ingestVoiceTranscriptSegments(prisma, {
      voiceSessionId: "voice_1",
      now: NOW,
      segments: [
        {
          segmentId: "seg-1",
          speakerPubkey: "wallet-speaker",
          speakerHandle: "player-1",
          text: "pulling the next pack",
          startedAt: NOW,
          endedAt: new Date(NOW.getTime() + 1200),
          confidence: 0.91,
        },
      ],
    });

    expect(result).toMatchObject({
      status: "stored",
      mode: "transcript",
      storedCount: 1,
    });
    expect(prisma.communicationMessage.create).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({
          messageKind: "voice_transcript",
          payloadText: "pulling the next pack",
          authMode: "system_transcription",
          signatureVerified: false,
          metadata: {
            voiceTranscript: expect.objectContaining({
              voiceSessionId: "voice_1",
              segmentId: "seg-1",
            }),
          },
        }),
      }),
    );
  });

  test("recap mode stores only the final summary on the voice session", async () => {
    const prisma = buildPrisma({ transcriptionMode: "recap" });

    const result = await generateVoiceRecap(prisma, {
      voiceSessionId: "voice_1",
      now: NOW,
      transcriptSegments: [
        {
          segmentId: "seg-1",
          speakerPubkey: "wallet-a",
          speakerHandle: "A",
          text: "We need to test the dungeon bridge before release.",
          startedAt: NOW,
        },
        {
          segmentId: "seg-2",
          speakerPubkey: "wallet-b",
          speakerHandle: "B",
          text: "Next step is to rerun voice and chat smoke tests.",
          startedAt: new Date(NOW.getTime() + 1000),
        },
      ],
    });

    expect(result).toMatchObject({
      status: "stored",
      mode: "recap",
      method: "rule",
      sourceSegmentCount: 2,
      draftSource: { status: "not_requested" },
    });
    expect(prisma.communicationMessage.create).not.toHaveBeenCalled();
    expect(prisma.voiceSession.update).toHaveBeenCalledWith({
      where: { id: "voice_1" },
      data: {
        metadata: expect.objectContaining({
          voiceRecap: expect.objectContaining({
            voiceSessionId: "voice_1",
            mode: "recap",
            sourceSegmentCount: 2,
          }),
        }),
      },
    });
  });

  test("full mode creates a review-gated source material without creating a draft or crystal", async () => {
    (createSourceMaterialMock as any).mockResolvedValueOnce({
      id: 44,
      circleId: 130,
      contentDigest: "digest",
      chunkCount: 1,
    });
    const prisma = buildPrisma({
      transcriptionMode: "full",
      parentCircleId: 130,
    });

    const result = await generateVoiceRecap(prisma, {
      voiceSessionId: "voice_1",
      now: NOW,
      requestedByUserId: 9,
      createDraftSource: true,
      transcriptSegments: [
        {
          segmentId: "seg-1",
          speakerPubkey: "wallet-a",
          text: "This should become source material only.",
          startedAt: NOW,
        },
      ],
    });

    expect(result.draftSource).toEqual({
      status: "review_required",
      sourceMaterialId: 44,
      circleId: 130,
    });
    expect(createSourceMaterialMock).toHaveBeenCalledWith(
      prisma,
      expect.objectContaining({
        circleId: 130,
        uploadedByUserId: 9,
        discussionThreadId: "voice:voice_1",
        content: expect.stringContaining("## Transcript"),
      }),
    );
    expect((prisma as any).post).toBeUndefined();
  });
});
