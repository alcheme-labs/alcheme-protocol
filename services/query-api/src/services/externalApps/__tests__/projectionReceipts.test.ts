import {
  buildExternalAppProjectionReceipt,
  markProjectionReceiptDisputed,
} from "../projectionReceipts";

describe("external app projection receipts", () => {
  it("builds stable parser-versioned input and output digests", () => {
    const receipt = buildExternalAppProjectionReceipt({
      externalAppId: "last-ignition",
      receiptType: "stability_projection",
      sourceHierarchy: ["external_app", "risk_signal"],
      parserVersion: "v3a.1",
      input: { risk: 10, support: 3 },
      output: { projectionStatus: "normal" },
      status: "active",
    });

    expect(receipt.parserVersion).toBe("v3a.1");
    expect(receipt.inputDigest).toMatch(/^sha256:[a-f0-9]{64}$/);
    expect(receipt.outputDigest).toMatch(/^sha256:[a-f0-9]{64}$/);
  });

  it("marks projection receipts disputed without changing receipt digests", () => {
    const receipt = buildExternalAppProjectionReceipt({
      externalAppId: "last-ignition",
      receiptType: "stability_projection",
      sourceHierarchy: ["external_app"],
      parserVersion: "v3a.1",
      input: { appId: "last-ignition" },
      output: { projectionStatus: "normal" },
      status: "active",
    });
    const disputed = markProjectionReceiptDisputed(receipt, "challenge-case-1");

    expect(disputed.status).toBe("disputed");
    expect(disputed.inputDigest).toBe(receipt.inputDigest);
    expect(disputed.outputDigest).toBe(receipt.outputDigest);
    expect(disputed.disputeRef).toBe("challenge-case-1");
  });
});
