import { resolveRuntimeFetch } from "../fetch";

function jsonResponse(body: unknown) {
  return {
    ok: true,
    status: 200,
    json: async () => body,
  } as Response;
}

describe("runtime fetch resolver", () => {
  test("keeps browser global fetch binding for default and explicit global fetch", async () => {
    const originalFetch = globalThis.fetch;
    const calls: string[] = [];
    Object.defineProperty(globalThis, "fetch", {
      configurable: true,
      value: function browserBoundFetch(this: typeof globalThis, url: string) {
        if (this !== globalThis) {
          throw new TypeError("Illegal invocation");
        }
        calls.push(url);
        return Promise.resolve(jsonResponse({ ok: true }));
      },
    });

    try {
      await expect(resolveRuntimeFetch()("https://api.example.test/default")).resolves.toMatchObject({
        ok: true,
      });
      await expect(
        resolveRuntimeFetch(globalThis.fetch)("https://api.example.test/explicit"),
      ).resolves.toMatchObject({ ok: true });
      expect(calls).toEqual([
        "https://api.example.test/default",
        "https://api.example.test/explicit",
      ]);
    } finally {
      Object.defineProperty(globalThis, "fetch", {
        configurable: true,
        value: originalFetch,
      });
    }
  });
});
