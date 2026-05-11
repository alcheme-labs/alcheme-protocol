import {
  getDefaultRoomCapabilities,
  normalizeRoomCapabilities,
  withRoomCapabilitiesMetadata,
} from "../capabilities";

describe("room capabilities", () => {
  test("circle defaults include Plaza capabilities", () => {
    expect(getDefaultRoomCapabilities("circle")).toEqual({
      textChat: true,
      voice: true,
      voiceClip: true,
      transcriptRecap: false,
      plazaDiscussion: true,
      aiSummary: true,
      draftGeneration: true,
      crystallization: true,
      governance: true,
    });
  });

  test("external room defaults exclude Plaza capabilities", () => {
    expect(getDefaultRoomCapabilities("dungeon")).toEqual({
      textChat: true,
      voice: true,
      voiceClip: false,
      transcriptRecap: false,
      plazaDiscussion: false,
      aiSummary: false,
      draftGeneration: false,
      crystallization: false,
      governance: false,
    });
  });

  test("partial capability metadata merges safely with defaults", () => {
    expect(
      normalizeRoomCapabilities(
        {
          plazaDiscussion: false,
          aiSummary: false,
          voiceClip: false,
        },
        "circle",
      ),
    ).toEqual({
      textChat: true,
      voice: true,
      voiceClip: false,
      transcriptRecap: false,
      plazaDiscussion: false,
      aiSummary: false,
      draftGeneration: true,
      crystallization: true,
      governance: true,
    });
  });

  test("unknown capability keys are rejected for API metadata updates", () => {
    expect(() =>
      normalizeRoomCapabilities(
        {
          plazaDiscussion: true,
          teleportDrafts: true,
        },
        "circle",
        { rejectUnknown: true },
      ),
    ).toThrow("unknown_room_capability");
  });

  test("metadata receives normalized capabilities while preserving unrelated keys", () => {
    expect(
      withRoomCapabilitiesMetadata(
        {
          voicePolicy: { maxSpeakers: 4 },
          capabilities: { draftGeneration: false },
          custom: "keep",
        },
        "circle",
      ),
    ).toEqual({
      voicePolicy: { maxSpeakers: 4 },
      custom: "keep",
      capabilities: {
        textChat: true,
        voice: true,
        voiceClip: true,
        transcriptRecap: false,
        plazaDiscussion: true,
        aiSummary: true,
        draftGeneration: false,
        crystallization: true,
        governance: true,
      },
    });
  });
});
