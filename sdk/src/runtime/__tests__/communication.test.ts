import {
  buildCommunicationMessageSigningMessage,
  buildCommunicationSessionBootstrapMessage,
  createAlchemeGameChatClient,
  type WalletSigner,
} from "../communication";

const ROOM_KEY = "external:example-web3-game:dungeon:run-8791";
const WALLET = "wallet-111";

function jsonResponse(body: unknown) {
  return {
    ok: true,
    status: 200,
    json: async () => body,
  } as Response;
}

function sseResponse(payload: string) {
  const encoder = new TextEncoder();
  let used = false;
  return {
    ok: true,
    status: 200,
    body: {
      getReader: () => ({
        read: async () => {
          if (used) return { done: true, value: undefined };
          used = true;
          return { done: false, value: encoder.encode(payload) };
        },
        releaseLock: () => undefined,
      }),
    },
  } as unknown as Response;
}

describe("communication runtime client", () => {
  test("resolves rooms, creates sessions, sends and lists messages without Anchor dependencies", async () => {
    const calls: Array<{ url: string; init: RequestInit }> = [];
    const fetchImpl = jest.fn(async (url: string, init: RequestInit = {}) => {
      calls.push({ url, init });
      if (url.endsWith("/communication/rooms/resolve")) {
        return jsonResponse({ room: { roomKey: ROOM_KEY } });
      }
      if (url.endsWith("/communication/sessions")) {
        return jsonResponse({
          sessionId: "session-1",
          communicationAccessToken: "session-token",
          scopeRef: ROOM_KEY,
        });
      }
      if (
        url.endsWith(
          `/communication/rooms/${encodeURIComponent(ROOM_KEY)}/messages`,
        ) &&
        init.method === "POST"
      ) {
        return jsonResponse({
          message: {
            envelopeId: "msg-1",
            roomKey: ROOM_KEY,
            text: "wait",
            lamport: 1,
          },
        });
      }
      return jsonResponse({
        messages: [{ envelopeId: "msg-1", roomKey: ROOM_KEY, lamport: 1 }],
      });
    });
    const wallet: WalletSigner = {
      publicKey: WALLET,
      signMessage: jest.fn(async () => new Uint8Array([1, 2, 3])),
    };
    const client = createAlchemeGameChatClient({
      apiBaseUrl: "https://api.example.test/api/v1",
      wallet,
      fetch: fetchImpl as any,
    });

    await expect(
      client.resolveRoom({
        externalAppId: "example-web3-game",
        roomType: "dungeon",
        externalRoomId: "run-8791",
      }),
    ).resolves.toEqual({ roomKey: ROOM_KEY });

    const session = await client.createCommunicationSession({
      roomKey: ROOM_KEY,
      clientTimestamp: "2026-05-08T12:00:00.000Z",
      nonce: "session-1",
    });
    expect(session.communicationAccessToken).toBe("session-token");

    await client.sendRoomMessage(ROOM_KEY, {
      text: "wait",
      clientTimestamp: "2026-05-08T12:00:01.000Z",
      nonce: "message-1",
    });
    await client.listRoomMessages(ROOM_KEY, { afterLamport: 0 });

    const sessionBody = JSON.parse(String(calls[1].init.body));
    expect(sessionBody.signedMessage).toBe(
      buildCommunicationSessionBootstrapMessage({
        v: 1,
        action: "communication_session_init",
        walletPubkey: WALLET,
        scopeType: "room",
        scopeRef: ROOM_KEY,
        clientTimestamp: "2026-05-08T12:00:00.000Z",
        nonce: "session-1",
      }),
    );
    expect(sessionBody.signature).toBe("AQID");

    const messageBody = JSON.parse(String(calls[2].init.body));
    expect(messageBody.signedMessage).toBe(
      buildCommunicationMessageSigningMessage({
        v: 1,
        roomKey: ROOM_KEY,
        senderPubkey: WALLET,
        messageKind: "plain",
        text: "wait",
        clientTimestamp: "2026-05-08T12:00:01.000Z",
        nonce: "message-1",
        prevEnvelopeId: null,
      }),
    );
    expect(calls[2].init.headers).toMatchObject({
      Authorization: "Bearer session-token",
    });
    expect(calls[3].url).toContain("afterLamport=0");
    expect(calls[3].init.headers).toMatchObject({
      Authorization: "Bearer session-token",
    });
  });

  test("subscribes to room messages with cursor and bearer token headers", async () => {
    const fetchImpl = jest.fn(async () =>
      sseResponse(
        'event: message_created\ndata: {"message":{"envelopeId":"msg-2","roomKey":"' +
          ROOM_KEY +
          '","lamport":2}}\n\n',
      ),
    );
    const wallet: WalletSigner = {
      publicKey: WALLET,
      signMessage: jest.fn(async () => new Uint8Array([1])),
    };
    const client = createAlchemeGameChatClient({
      apiBaseUrl: "https://api.example.test/api/v1",
      wallet,
      fetch: fetchImpl as any,
    });
    client.setCommunicationSession(ROOM_KEY, "session-token");
    const seen: unknown[] = [];

    const subscription = client.subscribeRoomMessages(
      ROOM_KEY,
      (event) => seen.push(event),
      { afterLamport: 1 },
    );
    await subscription.closed;

    expect(fetchImpl).toHaveBeenCalledWith(
      `https://api.example.test/api/v1/communication/rooms/${encodeURIComponent(ROOM_KEY)}/stream?afterLamport=1`,
      expect.objectContaining({
        headers: expect.objectContaining({
          Authorization: "Bearer session-token",
        }),
      }),
    );
    expect(seen).toEqual([
      {
        message: {
          envelopeId: "msg-2",
          roomKey: ROOM_KEY,
          lamport: 2,
        },
      },
    ]);
  });
});
