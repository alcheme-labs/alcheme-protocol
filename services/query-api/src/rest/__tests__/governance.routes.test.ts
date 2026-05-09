import { describe, expect, jest, test } from "@jest/globals";
import type { Router } from "express";

import { governanceRouter } from "../governance";

function getRouteHandler(router: Router, path: string, method: "get" | "post") {
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

  test("exposes governance audit anchor payloads without submitting settlement transactions", async () => {
    const prisma = {
      governanceRequest: {
        findUnique: jest.fn(async () => ({
          id: "gov_req_1",
          policyId: "gov_policy_1",
          policyVersionId: "gov_policy_1_v1",
          policyVersion: 1,
          ruleId: "voice-transcription-consent",
          scopeType: "voice_session",
          scopeRef: "voice_1",
          actionType: "voice.transcription.enable",
          targetType: "voice_session",
          targetRef: "voice_1",
          payload: { transcriptionMode: "full" },
          idempotencyKey: "voice:transcription:voice_1",
          proposerPubkey: "wallet-a",
          state: "accepted",
          openedAt: new Date("2026-05-08T12:00:00.000Z"),
          expiresAt: null,
          policyVersionRecord: {
            configDigest: "a".repeat(64),
          },
          snapshot: {
            sourceDigest: "b".repeat(64),
          },
          signals: [{
            id: "sig-1",
            requestId: "gov_req_1",
            signalType: "consent",
            actorPubkey: "wallet-a",
            value: "approve",
            weight: "1",
            evidence: null,
            signature: "sig",
            signedMessage: "message",
            externalClaimNonce: null,
            createdAt: new Date("2026-05-08T12:01:00.000Z"),
          }],
          decision: {
            decisionDigest: "c".repeat(64),
          },
          receipts: [],
        })),
        update: jest.fn(),
      },
      governanceExecutionReceipt: {
        findUnique: jest.fn(),
        create: jest.fn(),
      },
      governanceDecision: {
        upsert: jest.fn(),
      },
    };
    const router = governanceRouter(prisma as any, {} as any);
    const handler = getRouteHandler(
      router,
      "/requests/:requestId/audit",
      "get",
    );
    const req = {
      params: { requestId: "gov_req_1" },
    } as any;
    const res = createMockResponse();

    await handler(req, res as any);

    expect(res.statusCode).toBe(200);
    expect(res.payload.audit).toMatchObject({
      requestId: "gov_req_1",
      digestSet: {
        policyVersionDigest: "a".repeat(64),
        eligibilitySnapshotDigest: "b".repeat(64),
        decisionDigest: "c".repeat(64),
      },
      anchorPayload: {
        anchorType: "governance_audit",
        sourceId: "governance_request:gov_req_1",
        sourceScope: "voice_session:voice_1",
      },
      settlement: {
        adapterId: "solana-l1",
        chainFamily: "svm",
        submissionStatus: "not_submitted",
      },
    });
    expect(res.payload.audit.anchorPayload.payloadHash).toMatch(/^[a-f0-9]{64}$/);
    expect(res.payload.audit.memoText).toContain("alcheme-governance-audit:v1:");
    expect(prisma.governanceExecutionReceipt.create).not.toHaveBeenCalled();
  });
});
