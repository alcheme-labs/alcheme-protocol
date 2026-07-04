// @ts-nocheck
import { expect } from "chai";
import { createRequire } from "module";

const require = createRequire(import.meta.url);
const {
  DEFAULT_PERCENTILE,
  DRAFT_ANCHOR_THRESHOLD_LAMPORTS,
  classifyDraftAnchorMeasurementMode,
  measureDraftAnchorCost,
} = require("../../scripts/measure/draft-anchor-cost.ts");

describe("P4E gate: draft anchor cost measurement", function () {
  this.timeout(300000);

  it("defaults to estimated mode unless real_onchain is explicitly requested", () => {
    expect(classifyDraftAnchorMeasurementMode(undefined)).to.equal("estimated");
    expect(classifyDraftAnchorMeasurementMode("estimated")).to.equal("estimated");
    expect(classifyDraftAnchorMeasurementMode("real_onchain")).to.equal("real_onchain");
  });

  it("emits a structured estimated draft anchor memo cost without pretending to have signatures", async () => {
    const result = await measureDraftAnchorCost({
      percentile: DEFAULT_PERCENTILE,
      sampleCount: 3,
      measurementMode: "estimated",
    });

    console.log("[draft_anchor_cost_estimate]", JSON.stringify(result, null, 2));

    expect(result.method).to.equal("draft_anchor_memo");
    expect(result.measurement_mode).to.equal("estimated");
    expect(result.status).to.equal("estimated");
    expect(result.sample_count).to.equal(3);
    expect(result.successful_samples).to.equal(3);
    expect(result.failed_samples).to.equal(0);
    expect(result.threshold_lamports).to.equal(DRAFT_ANCHOR_THRESHOLD_LAMPORTS);
    expect(result.tx_fee).to.equal(5_000);
    expect(result.rent_delta).to.equal(0);
    expect(result.event_delta).to.equal(0);
    expect(result.total).to.equal(5_000);
    expect(result.p95).to.equal(5_000);
    expect(result.sample_signatures).to.deep.equal([]);
    expect(result.signature_policy).to.equal("estimated_mode_no_sample_signatures");
  });
});
