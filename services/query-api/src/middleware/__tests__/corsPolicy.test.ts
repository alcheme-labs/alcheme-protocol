import { createCorsPolicy, defaultDevExternalOrigins } from "../corsPolicy";

function responseMock() {
  const headers: Record<string, unknown> = {};
  return {
    headers,
    setHeader: jest.fn((key: string, value: unknown) => {
      headers[key] = value;
    }),
    status: jest.fn(function status(this: any, code: number) {
      this.statusCode = code;
      return this;
    }),
    json: jest.fn(function json(this: any, body: unknown) {
      this.body = body;
      return this;
    }),
    end: jest.fn(),
  } as any;
}

async function run(policy: ReturnType<typeof createCorsPolicy>, origin: string) {
  const req = { headers: { origin }, method: "GET" } as any;
  const res = responseMock();
  const next = jest.fn();
  await policy.corsMiddleware(req, res, next);
  await new Promise((resolve) => setTimeout(resolve, 0));
  return { res, next };
}

describe("cors policy", () => {
  it("allows first-party and active external origins", async () => {
    const findMany = jest.fn(async () => [{
      id: "demo-game",
      environment: "sandbox",
      registryStatus: "active",
      allowedOrigins: ["http://127.0.0.1:4173"],
    }]);
    const policy = createCorsPolicy(
      {
        externalApp: {
          findMany,
        },
      },
      { firstPartyOrigins: ["http://127.0.0.1:3000"], devExternalOrigins: [], cacheTtlMs: 0 },
    );

    await expect(run(policy, "http://127.0.0.1:3000")).resolves.toMatchObject({
      next: expect.any(Function),
    });
    const external = await run(policy, "http://127.0.0.1:4173");
    expect(external.next).toHaveBeenCalled();
    expect(findMany).toHaveBeenCalledWith({
      where: { status: "active", registryStatus: "active" },
      select: {
        id: true,
        allowedOrigins: true,
        environment: true,
        registryStatus: true,
      },
    });
  });

  it("requires confirmed chain anchor for production external origins in required mode", async () => {
    const policy = createCorsPolicy(
      {
        externalApp: {
          findMany: jest.fn(async () => [{
            id: "prod-game",
            environment: "mainnet_production",
            registryStatus: "active",
            allowedOrigins: ["https://game.example.com"],
          }]),
        },
        externalAppRegistryAnchor: {
          findMany: jest.fn(async () => [{
            externalAppId: "prod-game",
            registryStatus: "active",
            finalityStatus: "confirmed",
            receiptFinalityStatus: "confirmed",
          }]),
        },
      },
      {
        firstPartyOrigins: [],
        devExternalOrigins: [],
        cacheTtlMs: 0,
        externalAppRegistryMode: "required",
      },
    );

    const result = await run(policy, "https://game.example.com");

    expect(result.next).toHaveBeenCalled();
  });

  it("rejects production external origins without receipt finality in required mode", async () => {
    const policy = createCorsPolicy(
      {
        externalApp: {
          findMany: jest.fn(async () => [{
            id: "prod-game",
            environment: "mainnet_production",
            registryStatus: "active",
            allowedOrigins: ["https://game.example.com"],
          }]),
        },
        externalAppRegistryAnchor: {
          findMany: jest.fn(async () => [{
            externalAppId: "prod-game",
            registryStatus: "active",
            finalityStatus: "submitted",
            receiptFinalityStatus: "pending",
          }]),
        },
      },
      {
        firstPartyOrigins: [],
        devExternalOrigins: [],
        cacheTtlMs: 0,
        externalAppRegistryMode: "required",
      },
    );

    const result = await run(policy, "https://game.example.com");

    expect(result.res.status).toHaveBeenCalledWith(403);
  });

  it("rejects unknown origins with a stable 403", async () => {
    const policy = createCorsPolicy(
      { externalApp: { findMany: jest.fn(async () => []) } },
      { firstPartyOrigins: [], devExternalOrigins: [], cacheTtlMs: 0 },
    );
    const result = await run(policy, "https://unknown.example");
    expect(result.res.status).toHaveBeenCalledWith(403);
    expect(result.res.body).toMatchObject({ error: "origin_not_allowed" });
  });

  it("passes external origin lookup failures to Express error handling", async () => {
    const error = new Error("db unavailable");
    const policy = createCorsPolicy(
      { externalApp: { findMany: jest.fn(async () => { throw error; }) } },
      { firstPartyOrigins: [], devExternalOrigins: [], cacheTtlMs: 0 },
    );

    const req = { headers: { origin: "https://game.example.com" }, method: "GET" } as any;
    const res = responseMock();
    const next = jest.fn();
    await policy.corsMiddleware(req, res, next);
    await new Promise((resolve) => setTimeout(resolve, 0));

    expect(next).toHaveBeenCalledWith(error);
  });

  it("keeps dev external origins out of production defaults", () => {
    expect(defaultDevExternalOrigins("production")).toEqual([]);
    expect(defaultDevExternalOrigins("development")).toContain("http://127.0.0.1:4173");
  });
});
