import {
  assertExternalAppEmergencyActionAllowed,
  buildExternalAppEmergencyActionReceipt,
  emergencyActionPriority,
} from "../emergencyAuthority";

describe("external app emergency authority", () => {
  const base = {
    externalAppId: "game-1",
    actionScope: "official_managed_node" as const,
    affectedCapabilities: ["communication.rooms"],
    operatorIdentity: "operator-1",
    evidenceDigest: "sha256:evidence",
    startsAt: new Date("2026-05-15T00:00:00.000Z"),
    expiresAt: new Date("2026-05-16T00:00:00.000Z"),
    existingSessionEffect: "no_new_sessions",
    ownerNoticeStatus: "sent" as const,
    appealRoute: "external_app_appeal",
    sourceReceiptId: "receipt-1",
  };

  it("validates temporary scoped receipt-bound appealable emergency actions", () => {
    expect(
      buildExternalAppEmergencyActionReceipt({
        ...base,
        actionType: "managed_node_hold",
      }),
    ).toMatchObject({
      actionType: "managed_node_hold",
      actionScope: "official_managed_node",
      ownerNoticeStatus: "sent",
      appealRoute: "external_app_appeal",
    });
  });

  it("rejects expired or non-appealable holds", () => {
    expect(() =>
      assertExternalAppEmergencyActionAllowed({
        ...base,
        actionType: "managed_node_hold",
        expiresAt: new Date("2026-05-20T00:00:00.000Z"),
      }),
    ).toThrow("external_app_emergency_duration_exceeds_limit");

    expect(() =>
      assertExternalAppEmergencyActionAllowed({
        ...base,
        actionType: "managed_node_hold",
        appealRoute: "",
      }),
    ).toThrow("external_app_emergency_appeal_route_required");
  });

  it("does not allow managed-node hold to become registry revocation", () => {
    expect(() =>
      assertExternalAppEmergencyActionAllowed({
        ...base,
        actionType: "registry_revoked",
        actionScope: "registry",
        finalAdjudication: false,
        machineVerifiableSevereViolation: false,
      }),
    ).toThrow("external_app_registry_revoke_requires_final_or_machine_verifiable");
  });

  it("keeps capability-first actions ahead of broad holds", () => {
    expect(emergencyActionPriority("capability_limit")).toBeLessThan(
      emergencyActionPriority("managed_node_hold"),
    );
    expect(emergencyActionPriority("managed_node_hold")).toBeLessThan(
      emergencyActionPriority("registry_suspended"),
    );
  });
});
