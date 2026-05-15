import {
  assertArbitrationReferenceBoundToGovernance,
  buildExternalAppArbitrationReference,
} from "../arbitrationAdapter";

describe("external app arbitration adapter", () => {
  it("records external arbitration references with receipt binding", () => {
    expect(
      buildExternalAppArbitrationReference({
        externalAppId: "game-1",
        caseId: "case-1",
        provider: "kleros-compatible",
        externalReferenceId: "arb-1",
        receiptDigest: "sha256:arb",
        status: "decision_recorded",
      }),
    ).toMatchObject({
      id: "game-1:case-1:arb-1",
      status: "decision_recorded",
      receiptDigest: "sha256:arb",
    });
  });

  it("does not let arbitration replace GovernanceExecutionReceipt", () => {
    expect(() =>
      assertArbitrationReferenceBoundToGovernance({
        arbitrationReceiptDigest: "sha256:arb",
        governanceExecutionReceiptId: null,
      }),
    ).toThrow("external_app_arbitration_requires_governance_execution_receipt");
  });
});
