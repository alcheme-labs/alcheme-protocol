import { AlchemeApiError } from "../errors";
import { fetchKnowledgeContextPackage } from "../knowledge-context";
import { signKnowledgeContextClaim } from "../../server";

const API_BASE = "https://api.example.test/api/v1";

function jsonResponse(body: unknown, status = 200) {
  return {
    ok: status >= 200 && status < 300,
    status,
    json: async () => body,
  } as Response;
}

describe("knowledge context runtime client", () => {
  test("default browser fetch keeps the global binding", async () => {
    const originalFetch = globalThis.fetch;
    const calls: Array<{ url: string; init?: RequestInit }> = [];
    Object.defineProperty(globalThis, "fetch", {
      configurable: true,
      value: function browserBoundFetch(
        this: typeof globalThis,
        url: string,
        init?: RequestInit,
      ) {
        if (this !== globalThis) {
          throw new TypeError("Illegal invocation");
        }
        calls.push({ url, init });
        return Promise.resolve(
          jsonResponse({
            ok: true,
            appId: "example-program",
            roomKey: "external:example-program:lobby",
            circleId: 130,
            scope: {
              user: "wallet",
              capability: "knowledge_context",
              purpose: "room_sidebar",
            },
            items: [],
            cache: {
              keyScope: "appId+circleId+roomKey+wallet+capability+purpose",
              ttlSec: 60,
            },
            disclaimer: {
              notEndorsement: true,
              operatorResponsible: true,
            },
          }),
        );
      },
    });

    try {
      await expect(
        fetchKnowledgeContextPackage({
          apiBaseUrl: API_BASE,
          request: {
            appId: "example-program",
            roomKey: "external:example-program:lobby",
            parentCircleId: 130,
            requestedCapability: "knowledge_context",
            purpose: "room_sidebar",
          },
        }),
      ).resolves.toMatchObject({
        ok: true,
        appId: "example-program",
        circleId: 130,
      });
      expect(calls[0]?.url).toBe(
        `${API_BASE}/external-apps/example-program/knowledge-context`,
      );
    } finally {
      Object.defineProperty(globalThis, "fetch", {
        configurable: true,
        value: originalFetch,
      });
    }
  });

  test("posts scoped knowledge context requests", async () => {
    const calls: Array<{ url: string; init: RequestInit }> = [];
    const fetchImpl = jest.fn(async (url: string, init: RequestInit = {}) => {
      calls.push({ url, init });
      return jsonResponse({
        ok: true,
        appId: "example-program",
        roomKey: "external:example-program:lobby",
        circleId: 130,
        scope: {
          user: "wallet-111",
          capability: "knowledge_context",
          purpose: "room_sidebar",
        },
        items: [
          {
            kind: "source_material",
            id: "source-material:42",
            title: "Boss strategy recap",
            summary: "Accepted summary",
            sourceId: 42,
            updatedAt: "2026-05-15T00:00:00.000Z",
            permissions: {
              canDisplay: true,
              canQuote: true,
              canContinueDiscussion: true,
            },
          },
        ],
        cache: {
          keyScope: "appId+circleId+roomKey+wallet+capability+purpose",
          ttlSec: 60,
        },
        disclaimer: {
          notEndorsement: true,
          operatorResponsible: true,
        },
      });
    });

    const knowledgeContextClaim = await signKnowledgeContextClaim(
      {
        externalAppId: "example-program",
        roomKey: "external:example-program:lobby",
        circleId: 130,
        walletPubkey: "wallet-111",
        purpose: "room_sidebar",
        expiresAt: "2026-05-13T00:10:00.000Z",
        nonce: "nonce-knowledge-1",
      },
      async (payload) => `signed:${payload}`,
    );

    const result = await fetchKnowledgeContextPackage({
      apiBaseUrl: `${API_BASE}/`,
      fetch: fetchImpl as any,
      request: {
        appId: "example-program",
        roomKey: "external:example-program:lobby",
        walletPubkey: "wallet-111",
        primaryCircleId: 130,
        parentCircleId: 130,
        roomType: "lobby",
        requestedCapability: "knowledge_context",
        purpose: "room_sidebar",
        knowledgeContextClaim,
      },
    });

    expect(result.items[0]).toMatchObject({
      kind: "source_material",
      sourceId: 42,
    });
    expect(calls[0].url).toBe(
      `${API_BASE}/external-apps/example-program/knowledge-context`,
    );
    expect(JSON.parse(String(calls[0].init.body))).toMatchObject({
      roomKey: "external:example-program:lobby",
      walletPubkey: "wallet-111",
      primaryCircleId: 130,
      parentCircleId: 130,
      roomType: "lobby",
      requestedCapability: "knowledge_context",
      purpose: "room_sidebar",
      knowledgeContextClaim,
    });
  });

  test("throws parsed API errors", async () => {
    const fetchImpl = jest.fn(async () =>
      jsonResponse({ error: "external_app_circle_binding_required" }, 403),
    );

    await expect(
      fetchKnowledgeContextPackage({
        apiBaseUrl: API_BASE,
        fetch: fetchImpl as any,
        request: {
          appId: "example-program",
          roomKey: "external:example-program:lobby",
          requestedCapability: "knowledge_context",
          purpose: "room_sidebar",
        },
      }),
    ).rejects.toMatchObject<Partial<AlchemeApiError>>({
      name: "AlchemeApiError",
      status: 403,
      code: "external_app_circle_binding_required",
    });
  });
});
