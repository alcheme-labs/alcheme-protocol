import { AlchemeApiError } from "../errors";
import { submitExternalProgramSourceMaterial } from "../source-materials";
import { signSourceSubmissionClaim } from "../../server";

const API_BASE = "https://api.example.test/api/v1";

function jsonResponse(body: unknown, status = 200) {
  return {
    ok: status >= 200 && status < 300,
    status,
    json: async () => body,
  } as Response;
}

describe("external program source material runtime client", () => {
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
            sourceMaterialId: 42,
            lifecycleStatus: "submitted",
            circleId: 130,
          }),
        );
      },
    });

    try {
      await expect(
        submitExternalProgramSourceMaterial({
          apiBaseUrl: API_BASE,
          appId: "example-program",
          request: {
            roomKey: "external:example-program:lobby",
            originType: "communication_message",
            originRef: "envelope-1",
            targetCircleId: 130,
            summaryText: "Players agreed on the frost strategy.",
            evidencePrivacyClass: "circle_only",
          },
        }),
      ).resolves.toMatchObject({
        ok: true,
        sourceMaterialId: 42,
      });
      expect(calls[0]?.url).toBe(
        `${API_BASE}/external-apps/example-program/source-materials`,
      );
    } finally {
      Object.defineProperty(globalThis, "fetch", {
        configurable: true,
        value: originalFetch,
      });
    }
  });

  test("posts source material submissions with verified claim fields intact", async () => {
    const calls: Array<{ url: string; init: RequestInit }> = [];
    const fetchImpl = jest.fn(async (url: string, init: RequestInit = {}) => {
      calls.push({ url, init });
      return jsonResponse({
        ok: true,
        sourceMaterialId: 42,
        lifecycleStatus: "review_pending",
        circleId: 130,
      });
    });

    const sourceSubmissionClaim = await signSourceSubmissionClaim(
      {
        externalAppId: "example-program",
        roomKey: "external:example-program:lobby",
        originType: "external_summary",
        originRef: "summary-1",
        targetCircleId: 130,
        summaryText: "Players agreed on the frost strategy.",
        evidencePrivacyClass: "circle_only",
        requestedLifecycleStatus: "review_pending",
        submittedByPubkey: "wallet-111",
        expiresAt: "2026-05-13T00:10:00.000Z",
        nonce: "nonce-source-1",
      },
      async (payload) => `signed:${payload}`,
    );

    const result = await submitExternalProgramSourceMaterial({
      apiBaseUrl: `${API_BASE}/`,
      appId: "example-program",
      fetch: fetchImpl as any,
      request: {
        roomKey: "external:example-program:lobby",
        originType: "external_summary",
        originRef: "summary-1",
        targetCircleId: 130,
        summaryText: "Players agreed on the frost strategy.",
        evidencePrivacyClass: "circle_only",
        requestedLifecycleStatus: "review_pending",
        submittedByPubkey: "wallet-111",
        sourceSubmissionClaim,
      },
    });

    expect(result).toMatchObject({
      ok: true,
      sourceMaterialId: 42,
      lifecycleStatus: "review_pending",
      circleId: 130,
    });
    expect(calls[0].url).toBe(
      `${API_BASE}/external-apps/example-program/source-materials`,
    );
    expect(JSON.parse(String(calls[0].init.body))).toMatchObject({
      roomKey: "external:example-program:lobby",
      originType: "external_summary",
      originRef: "summary-1",
      targetCircleId: 130,
      summaryText: "Players agreed on the frost strategy.",
      evidencePrivacyClass: "circle_only",
      requestedLifecycleStatus: "review_pending",
      submittedByPubkey: "wallet-111",
      sourceSubmissionClaim,
    });
  });

  test("throws parsed API errors", async () => {
    const fetchImpl = jest.fn(async () =>
      jsonResponse({ error: "source_material_claim_required" }, 403),
    );

    await expect(
      submitExternalProgramSourceMaterial({
        apiBaseUrl: API_BASE,
        appId: "example-program",
        fetch: fetchImpl as any,
        request: {
          roomKey: "external:example-program:lobby",
          originType: "communication_message",
          originRef: "envelope-1",
          targetCircleId: 130,
          summaryText: "Players agreed on the frost strategy.",
          evidencePrivacyClass: "circle_only",
        },
      }),
    ).rejects.toMatchObject<Partial<AlchemeApiError>>({
      name: "AlchemeApiError",
      status: 403,
      code: "source_material_claim_required",
    });
  });
});
