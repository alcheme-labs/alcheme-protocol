import { describe, expect, jest, test } from "@jest/globals";
import type { Router } from "express";

import { governanceRouter } from "../governance";

function getRouteHandler(router: Router, path: string, method: "post") {
  const layer = (router as any).stack.find(
    (item: any) =>
      item.route?.path === path &&
      item.route?.stack?.some((entry: any) => entry.method === method),
  );
  const routeLayer = layer?.route?.stack?.find(
    (entry: any) => entry.method === method,
  );
  if (!routeLayer?.handle) {
    throw new Error(
      `route handler not found for ${method.toUpperCase()} ${path}`,
    );
  }
  return routeLayer.handle;
}

function createMockResponse() {
  return {
    statusCode: 200,
    payload: null as any,
    status(code: number) {
      this.statusCode = code;
      return this;
    },
    json(payload: any) {
      this.payload = payload;
      return this;
    },
  };
}

describe("generic governance routes", () => {
  test("records execution receipts idempotently through the generic request route", async () => {
    const existingReceipt = {
      id: "receipt-1",
      requestId: "gov_req_1",
      actionType: "room.end",
      executorModule: "communication",
      executionStatus: "executed",
      executionRef: null,
      errorCode: null,
      idempotencyKey: "room:end:1",
      executedAt: new Date("2026-05-08T12:00:00.000Z"),
      createdAt: new Date("2026-05-08T12:00:00.000Z"),
    };
    const prisma = {
      governanceExecutionReceipt: {
        findUnique: jest.fn(async () => existingReceipt),
        create: jest.fn(),
      },
      governanceDecision: {
        upsert: jest.fn(),
      },
      governanceRequest: {
        update: jest.fn(),
      },
    };
    const router = governanceRouter(prisma as any, {} as any);
    const handler = getRouteHandler(
      router,
      "/requests/:requestId/execution-receipts",
      "post",
    );
    const req = {
      params: { requestId: "gov_req_1" },
      body: {
        actionType: "room.end",
        executorModule: "communication",
        executionStatus: "executed",
        idempotencyKey: "room:end:1",
      },
    } as any;
    const res = createMockResponse();

    await handler(req, res as any);

    expect(res.statusCode).toBe(201);
    expect(res.payload.receipt).toBe(existingReceipt);
    expect(prisma.governanceExecutionReceipt.create).not.toHaveBeenCalled();
  });
});
