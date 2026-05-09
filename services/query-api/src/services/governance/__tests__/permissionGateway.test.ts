import {
  evaluateVoiceTranscriptionEnablePermission,
  toPermissionGatewayDecision,
} from "../permissionGateway";

describe("governance permission gateway", () => {
  test("maps strategy results to allow, deny, or requires_governance", () => {
    expect(
      toPermissionGatewayDecision({
        state: "accepted",
        reason: "unanimous_consent",
      }),
    ).toMatchObject({ status: "allow" });

    expect(
      toPermissionGatewayDecision({
        state: "rejected",
        reason: "consent_rejected",
      }),
    ).toMatchObject({ status: "deny", reason: "consent_rejected" });

    expect(
      toPermissionGatewayDecision({
        state: "active",
        reason: "consent_missing",
        requestId: "gov_req_1",
      }),
    ).toMatchObject({
      status: "requires_governance",
      requestId: "gov_req_1",
    });
  });

  test("requires unanimous participant consent before voice transcription can be enabled", () => {
    expect(
      evaluateVoiceTranscriptionEnablePermission({
        requestId: "gov_req_voice_1",
        participantPubkeys: ["wallet-a", "wallet-b"],
        signals: [{ actorPubkey: "wallet-a", value: "approve" }],
      }),
    ).toMatchObject({
      status: "requires_governance",
      requestId: "gov_req_voice_1",
      reason: "consent_missing",
    });

    expect(
      evaluateVoiceTranscriptionEnablePermission({
        requestId: "gov_req_voice_1",
        participantPubkeys: ["wallet-a", "wallet-b"],
        signals: [
          { actorPubkey: "wallet-a", value: "approve" },
          { actorPubkey: "wallet-b", value: "approve" },
        ],
      }),
    ).toMatchObject({ status: "allow", reason: "unanimous_consent" });
  });
});
