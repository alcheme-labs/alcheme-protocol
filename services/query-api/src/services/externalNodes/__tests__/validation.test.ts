import {
  normalizeExternalNodePolicyStatus,
  normalizeExternalNodeType,
} from "../validation";

describe("external node validation", () => {
  it("normalizes node type and policy status", () => {
    expect(normalizeExternalNodeType("app_owned")).toBe("app_owned");
    expect(normalizeExternalNodeType("community")).toBe("community");
    expect(normalizeExternalNodePolicyStatus("normal")).toBe("normal");
    expect(normalizeExternalNodePolicyStatus("restricted")).toBe("restricted");
  });

  it("rejects unsupported node type", () => {
    expect(() => normalizeExternalNodeType("query-api")).toThrow(
      "invalid_external_node_type",
    );
  });
});
