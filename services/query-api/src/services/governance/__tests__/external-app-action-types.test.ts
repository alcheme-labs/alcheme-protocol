import {
  getGovernanceActionDefinition,
  normalizeGovernanceActionType,
} from "../actionTypes";

describe("external app governance action types", () => {
  it.each([
    "external_app_register",
    "approve_store_listing",
    "approve_managed_node_quota",
    "downgrade_discovery_status",
    "limit_capability",
    "emergency_hold",
    "external_app_challenge_open",
    "external_app_challenge_accept_resolution",
    "external_app_dispute_escalate",
    "external_app_dispute_rule",
    "external_app_owner_bond_slash",
    "external_app_settlement_execute",
    "external_app_funding_pause",
    "external_app_challenge_abuse_countercase",
    "external_app_appeal_open",
    "external_app_bond_disposition_apply",
    "external_app_bond_routing_execute",
    "external_app_policy_epoch_update",
    "external_app_parameter_bounds_update",
    "external_app_governance_role_binding_update",
    "external_app_policy_epoch_migration",
    "external_app_bond_exposure_guard_update",
    "external_app_projection_dispute_open",
    "external_app_projection_reconcile",
    "external_app_governance_capture_review",
    "external_app_emergency_hold_extend",
    "external_app_emergency_hold_correct",
    "external_app_registry_revoke",
  ])("normalizes %s", (actionType) => {
    expect(normalizeGovernanceActionType(actionType)).toBe(actionType);
  });

  it("requires a decision for production app registration", () => {
    expect(getGovernanceActionDefinition("external_app_register")).toMatchObject({
      actionType: "external_app_register",
      voteMode: "required",
      requiresPolicyProfileDigest: false,
    });
  });

  it("requires decisions for V3B challenge and settlement actions", () => {
    expect(getGovernanceActionDefinition("external_app_challenge_open")).toMatchObject({
      voteMode: "required",
    });
    expect(getGovernanceActionDefinition("external_app_settlement_execute")).toMatchObject({
      voteMode: "required",
    });
    expect(getGovernanceActionDefinition("external_app_funding_pause")).toMatchObject({
      voteMode: "required",
    });
  });

  it("requires decisions for V3D high-impact governance actions", () => {
    for (const actionType of [
      "external_app_bond_disposition_apply",
      "external_app_bond_routing_execute",
      "external_app_governance_role_binding_update",
      "external_app_projection_dispute_open",
      "external_app_governance_capture_review",
      "external_app_emergency_hold_extend",
      "external_app_registry_revoke",
    ] as const) {
      expect(getGovernanceActionDefinition(actionType)).toMatchObject({
        actionType,
        voteMode: "required",
      });
    }
  });
});
