import {
  buildCommunicationRoomKey,
  normalizeRoomType,
  parseCommunicationRoomKey,
} from "../roomScope";

describe("communication room scope", () => {
  test("builds and parses circle room keys", () => {
    const roomKey = buildCommunicationRoomKey({
      roomType: "circle",
      parentCircleId: 130,
    });

    expect(roomKey).toBe("circle:130");
    expect(parseCommunicationRoomKey(roomKey)).toEqual({
      kind: "circle",
      roomKey,
      parentCircleId: 130,
    });
  });

  test("builds and parses external game room keys", () => {
    const roomKey = buildCommunicationRoomKey({
      externalAppId: "example-web3-game",
      roomType: "dungeon",
      externalRoomId: "run-8791",
    });

    expect(roomKey).toBe("external:example-web3-game:dungeon:run-8791");
    expect(parseCommunicationRoomKey(roomKey)).toEqual({
      kind: "external",
      roomKey,
      externalAppId: "example-web3-game",
      roomType: "dungeon",
      externalRoomId: "run-8791",
    });
  });

  test("builds stable direct room keys independent of wallet order", () => {
    const alice = "9QfRrR7dW7B8d8n3k3D6Vw6m3W9R2kA2jGk4dWpP1uHz";
    const bob = "7xKXtg2CW87d97TXJSDpbD5jBkheTqA83TZRuJosgDqY";

    const roomKey = buildCommunicationRoomKey({
      roomType: "direct",
      participantPubkeys: [alice, bob],
    });
    const reversed = buildCommunicationRoomKey({
      roomType: "direct",
      participantPubkeys: [bob, alice],
    });

    expect(roomKey).toBe(reversed);
    expect(roomKey).toMatch(/^direct:[a-f0-9]{64}$/);
    expect(parseCommunicationRoomKey(roomKey)).toEqual({
      kind: "direct",
      roomKey,
      pairHash: roomKey.slice("direct:".length),
    });
  });

  test("normalizes known room types", () => {
    expect(normalizeRoomType(" Dungeon ")).toBe("dungeon");
    expect(normalizeRoomType("guild")).toBe("guild");
    expect(normalizeRoomType("party")).toBe("party");
    expect(normalizeRoomType("world")).toBe("world");
    expect(normalizeRoomType("custom")).toBe("custom");
  });

  test("rejects invalid app ids, invalid room types, and overlong room ids", () => {
    expect(() =>
      buildCommunicationRoomKey({
        externalAppId: "../bad-app",
        roomType: "dungeon",
        externalRoomId: "run-1",
      }),
    ).toThrow("Invalid externalAppId");

    expect(() =>
      buildCommunicationRoomKey({
        externalAppId: "example-web3-game",
        roomType: "voice",
        externalRoomId: "run-1",
      }),
    ).toThrow("Invalid roomType");

    expect(() =>
      buildCommunicationRoomKey({
        externalAppId: "example-web3-game",
        roomType: "dungeon",
        externalRoomId: "x".repeat(80),
      }),
    ).toThrow("externalRoomId is too long");
  });
});
