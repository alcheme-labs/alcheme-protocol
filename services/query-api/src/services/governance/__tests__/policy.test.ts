import {
  computeGovernanceDecisionDigest,
  openGovernanceRequest,
  recordGovernanceSignal,
  recordExecutionReceipt,
  resolveGovernanceRequest,
  type GovernanceRequestStore,
  type GovernanceEngineStore,
} from "../policyEngine";

function createStore(): GovernanceEngineStore {
  const decisions = new Map<string, any>();
  const receipts = new Map<string, any>();

  return {
    async saveDecision(decision) {
      decisions.set(decision.requestId, decision);
      return decision;
    },
    async getExecutionReceiptByMarker(input) {
      return (
        receipts.get(
          `${input.requestId}:${input.executorModule}:${input.idempotencyKey}`,
        ) ?? null
      );
    },
    async saveExecutionReceipt(receipt) {
      receipts.set(
        `${receipt.requestId}:${receipt.executorModule}:${receipt.idempotencyKey}`,
        receipt,
      );
      return receipt;
    },
  };
}

function createRequestStore(): GovernanceRequestStore {
  const requests = new Map<string, any>();
  const snapshots = new Map<string, any>();
  const signals = new Map<string, any>();

  return {
    async saveRequest(request) {
      requests.set(request.id, request);
      return request;
    },
    async saveSnapshot(snapshot) {
      snapshots.set(snapshot.requestId, snapshot);
      return snapshot;
    },
    async saveSignal(signal) {
      signals.set(signal.id, signal);
      return signal;
    },
  };
}

describe("governance policy engine", () => {
  test("opens requests with a frozen eligibility snapshot digest", async () => {
    const request = await openGovernanceRequest(createRequestStore(), {
      id: "gov_req_1",
      policyId: "gov_policy_1",
      policyVersionId: "gov_policy_1_v1",
      policyVersion: 1,
      ruleId: "voice-transcription-consent",
      scope: { type: "voice_session", ref: "voice_1" },
      action: {
        type: "voice.transcription.enable",
        targetType: "voice_session",
        targetRef: "voice_1",
        payload: { transcriptionMode: "transcript" },
        idempotencyKey: "voice:transcription:voice_1",
      },
      proposerPubkey: "wallet-a",
      eligibleActors: [
        { pubkey: "wallet-a", weight: "1", source: "voice_participant" },
        { pubkey: "wallet-b", weight: "1", source: "voice_participant" },
      ],
      openedAt: new Date("2026-05-08T12:00:00.000Z"),
    });

    expect(request).toMatchObject({
      id: "gov_req_1",
      state: "active",
      snapshot: {
        sourceDigest: expect.stringMatching(/^[a-f0-9]{64}$/),
      },
    });
  });

  test("records signed or authenticated governance signals", async () => {
    const signal = await recordGovernanceSignal(createRequestStore(), {
      id: "gov_sig_1",
      requestId: "gov_req_1",
      signalType: "consent",
      actorPubkey: "wallet-a",
      value: "approve",
      weight: "1",
      evidence: { method: "wallet_signature" },
      signature: "sig",
      signedMessage: "message",
      createdAt: new Date("2026-05-08T12:01:00.000Z"),
    });

    expect(signal).toMatchObject({
      requestId: "gov_req_1",
      signalType: "consent",
      actorPubkey: "wallet-a",
      value: "approve",
      signature: "sig",
    });
  });

  test("creates stable decision digests from canonical decision fields", () => {
    const left = computeGovernanceDecisionDigest({
      requestId: "gov_req_1",
      decision: "accepted",
      reason: "unanimous_consent",
      tally: { approved: 2, required: 2 },
      decidedAt: "2026-05-08T12:00:00.000Z",
      executableFrom: null,
      executableUntil: null,
    });
    const right = computeGovernanceDecisionDigest({
      executableUntil: null,
      executableFrom: null,
      decidedAt: "2026-05-08T12:00:00.000Z",
      tally: { required: 2, approved: 2 },
      reason: "unanimous_consent",
      decision: "accepted",
      requestId: "gov_req_1",
    });

    expect(left).toMatch(/^[a-f0-9]{64}$/);
    expect(left).toBe(right);
  });

  test("resolves requests into persisted decisions with stable digest", async () => {
    const store = createStore();

    const decision = await resolveGovernanceRequest(store, {
      requestId: "gov_req_1",
      result: {
        state: "accepted",
        reason: "unanimous_consent",
        tally: { approved: 2, required: 2 },
      },
      now: new Date("2026-05-08T12:00:00.000Z"),
    });

    expect(decision).toMatchObject({
      requestId: "gov_req_1",
      decision: "accepted",
      reason: "unanimous_consent",
      decisionDigest: expect.stringMatching(/^[a-f0-9]{64}$/),
    });
  });

  test("records execution receipts idempotently by request, executor, and marker", async () => {
    const store = createStore();
    const first = await recordExecutionReceipt(store, {
      id: "receipt-1",
      requestId: "gov_req_1",
      actionType: "voice.transcription.enable",
      executorModule: "voice",
      executionStatus: "executed",
      idempotencyKey: "voice:transcription:voice_1",
      executedAt: new Date("2026-05-08T12:01:00.000Z"),
    });
    const second = await recordExecutionReceipt(store, {
      id: "receipt-2",
      requestId: "gov_req_1",
      actionType: "voice.transcription.enable",
      executorModule: "voice",
      executionStatus: "failed",
      idempotencyKey: "voice:transcription:voice_1",
      errorCode: "should_not_replace",
      executedAt: new Date("2026-05-08T12:02:00.000Z"),
    });

    expect(second).toBe(first);
    expect(second).toMatchObject({
      id: "receipt-1",
      executionStatus: "executed",
    });
  });
});
