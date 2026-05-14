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
});
