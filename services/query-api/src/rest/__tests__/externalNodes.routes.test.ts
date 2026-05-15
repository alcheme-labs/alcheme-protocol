import express from "express";
import request from "supertest";
import { jest } from "@jest/globals";

import { externalNodeRouter } from "../externalNodes";

function buildApp(prisma: any) {
  const app = express();
  app.use(express.json());
  app.use("/api/v1/external-nodes", externalNodeRouter(prisma, {} as any));
  return app;
}

describe("external node routes", () => {
  it("returns app-declared external route projections without endorsement fields", async () => {
    const prisma = {
      externalNode: {
        findMany: jest.fn(async () => [
          {
            id: "node-1",
            operatorPubkey: "operator-wallet",
            nodeType: "app_owned",
            serviceUrl: "https://node.game.example",
            capabilitiesDigest: "sha256:abc",
            protocolVersion: "v1",
            syncStatus: "healthy",
            conformanceStatus: "certified",
            nodeTrustScore: "100",
            nodePolicyStatus: "normal",
          },
        ]),
      },
    };

    const response = await request(buildApp(prisma)).get("/api/v1/external-nodes/routes");

    expect(response.status).toBe(200);
    expect(response.body.routes[0]).toMatchObject({
      label: "App-Operated Node Declared",
      endorsement: "not_alcheme_endorsed",
      rankingContribution: 0,
    });
    expect(JSON.stringify(response.body.routes[0])).not.toMatch(
      /Certified|Recommended|Trusted|Alcheme Compatible/,
    );
  });
});
