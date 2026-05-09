import express from "express";
import request from "supertest";
import { afterEach, describe, expect, jest, test } from "@jest/globals";

import { restRouter } from "../index";

function buildApp() {
  const app = express();
  app.use(express.json());
  app.use("/api/v1", restRouter(buildPrismaMock(), buildRedisMock()));
  return app;
}

function buildPrismaMock() {
  return {
    communicationMessage: {
      findUnique: jest.fn(async () => null),
    },
  } as any;
}

function buildRedisMock() {
  return {
    publish: jest.fn(),
  } as any;
}

describe("communication route boundary", () => {
  const originalRole = process.env.QUERY_API_RUNTIME_ROLE;

  afterEach(() => {
    if (originalRole === undefined) {
      delete process.env.QUERY_API_RUNTIME_ROLE;
    } else {
      process.env.QUERY_API_RUNTIME_ROLE = originalRole;
    }
  });

  test("PUBLIC_NODE allows public-safe communication route groups and blocks sidecar-owned groups", async () => {
    process.env.QUERY_API_RUNTIME_ROLE = "PUBLIC_NODE";
    const app = buildApp();

    await request(app)
      .post("/api/v1/communication/rooms/resolve")
      .send({})
      .expect(400)
      .expect((response) => {
        expect(response.body.error).not.toBe("private_sidecar_required");
      });
    await request(app)
      .post("/api/v1/communication/sessions")
      .send({})
      .expect(400)
      .expect((response) => {
        expect(response.body.error).not.toBe("private_sidecar_required");
      });
    await request(app)
      .get(
        "/api/v1/communication/rooms/external%3Aapp%3Adungeon%3Arun/messages",
      )
      .expect(401)
      .expect((response) => {
        expect(response.body.error).not.toBe("private_sidecar_required");
      });

    await request(app)
      .post("/api/v1/communication/rooms/external%3Aapp%3Adungeon%3Arun/end")
      .send({})
      .expect(409)
      .expect((response) => {
        expect(response.body).toMatchObject({
          error: "private_sidecar_required",
          route: "communication_sidecar",
        });
      });
    await request(app)
      .delete("/api/v1/communication/messages/msg-1")
      .expect(409)
      .expect((response) => {
        expect(response.body).toMatchObject({
          error: "private_sidecar_required",
          route: "communication_sidecar",
        });
      });
    await request(app)
      .post("/api/v1/voice/providers/livekit/webhook")
      .send({})
      .expect(409)
      .expect((response) => {
        expect(response.body).toMatchObject({
          error: "private_sidecar_required",
          route: "voice_provider_webhook",
        });
      });
  });

  test("PRIVATE_SIDECAR does not reject communication sidecar routes at the route boundary", async () => {
    process.env.QUERY_API_RUNTIME_ROLE = "PRIVATE_SIDECAR";
    const app = buildApp();

    await request(app)
      .delete("/api/v1/communication/messages/msg-1")
      .expect((response) => {
        expect(response.status).not.toBe(409);
        expect(response.body.error).not.toBe("private_sidecar_required");
      });
  });
});
