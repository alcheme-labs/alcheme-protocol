import {
  buildGovernanceAuditAnchorPackage,
  buildGovernanceAuditDigestSet,
  computeGovernanceExecutionReceiptDigest,
  computeGovernanceSignalRoot,
} from "../auditAnchor";

const request = {
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
};

describe("governance audit anchors", () => {
  test("builds a stable signal root independent of input order", () => {
    const left = computeGovernanceSignalRoot([
      {
        id: "sig-2",
        requestId: "gov_req_1",
        signalType: "consent",
        actorPubkey: "wallet-b",
        value: "approve",
        weight: "1",
        createdAt: new Date("2026-05-08T12:02:00.000Z"),
      },
      {
        id: "sig-1",
        requestId: "gov_req_1",
        signalType: "consent",
        actorPubkey: "wallet-a",
        value: "approve",
        weight: "1",
        createdAt: new Date("2026-05-08T12:01:00.000Z"),
      },
    ]);
    const right = computeGovernanceSignalRoot([
      {
        id: "sig-1",
        requestId: "gov_req_1",
        signalType: "consent",
        actorPubkey: "wallet-a",
        value: "approve",
        weight: "1",
        createdAt: new Date("2026-05-08T12:01:00.000Z"),
      },
      {
        id: "sig-2",
        requestId: "gov_req_1",
        signalType: "consent",
        actorPubkey: "wallet-b",
        value: "approve",
        weight: "1",
        createdAt: new Date("2026-05-08T12:02:00.000Z"),
      },
    ]);

    expect(left).toMatch(/^[a-f0-9]{64}$/);
    expect(left).toBe(right);
  });

  test("computes execution receipt digests without treating receipt assets as gate truth", () => {
    const digest = computeGovernanceExecutionReceiptDigest({
      id: "receipt-1",
      requestId: "gov_req_1",
      actionType: "voice.transcription.enable",
      executorModule: "voice",
      executionStatus: "executed",
      executionRef: "voice-session-1",
      errorCode: null,
      idempotencyKey: "voice:transcription:voice_1",
      executedAt: new Date("2026-05-08T12:03:00.000Z"),
    });

    expect(digest).toMatch(/^[a-f0-9]{64}$/);
  });

  test("builds a settlement-neutral governance audit anchor payload", () => {
    const digestSet = buildGovernanceAuditDigestSet({
      request,
      snapshot: { sourceDigest: "b".repeat(64) },
      signals: [{
        id: "sig-1",
        requestId: "gov_req_1",
        signalType: "consent",
        actorPubkey: "wallet-a",
        value: "approve",
        weight: "1",
        createdAt: new Date("2026-05-08T12:01:00.000Z"),
      }],
      decision: { decisionDigest: "c".repeat(64) },
      receipts: [{
        id: "receipt-1",
        requestId: "gov_req_1",
        actionType: "voice.transcription.enable",
        executorModule: "voice",
        executionStatus: "executed",
        idempotencyKey: "voice:transcription:voice_1",
        executedAt: new Date("2026-05-08T12:03:00.000Z"),
      }],
    });

    const anchorPackage = buildGovernanceAuditAnchorPackage({
      request,
      digestSet,
      generatedAt: new Date("2026-05-08T12:04:00.000Z"),
    });

    expect(anchorPackage.anchorPayload).toMatchObject({
      version: 1,
      anchorType: "governance_audit",
      sourceId: "governance_request:gov_req_1",
      sourceScope: "voice_session:voice_1",
      payloadHash: expect.stringMatching(/^[a-f0-9]{64}$/),
    });
    expect(anchorPackage.memoText).toContain("alcheme-governance-audit:v1:");
    expect(anchorPackage.memoText).toContain(anchorPackage.payloadHash);
  });
});
