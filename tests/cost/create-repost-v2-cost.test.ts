// @ts-nocheck
import { expect } from "chai";
import { createRequire } from "module";

const require = createRequire(import.meta.url);
const {
  DEFAULT_PERCENTILE,
  measureCreateRepostV2Cost,
} = require("../../scripts/measure/create-repost-v2-cost.ts");

const CREATE_RELATION_V2_THRESHOLD_LAMPORTS = 1_000_000;

describe("Task8 gate: create_repost_v2 cost", function () {
  this.timeout(300000);

  it("exposes thresholded on-chain sampling output for repost v2", async () => {
    const result = await measureCreateRepostV2Cost({
      percentile: DEFAULT_PERCENTILE,
      sampleCount: 3,
    });

    console.log("[create_repost_v2_cost_result]", JSON.stringify(result, null, 2));

    expect(result.method).to.equal("create_repost_v2");
    expect(result.measurement_mode).to.equal("onchain_sampling");
    expect(result.threshold_lamports).to.equal(CREATE_RELATION_V2_THRESHOLD_LAMPORTS);
    expect(result.failed_samples).to.equal(
      0,
      `create_repost_v2 sampling must have zero failed samples; got ${result.failed_samples}; errors=${result.errors.join(" | ")}`
    );
    expect(result.total).to.be.at.most(
      CREATE_RELATION_V2_THRESHOLD_LAMPORTS,
      `create_repost_v2 P${result.percentile} must be <= ${CREATE_RELATION_V2_THRESHOLD_LAMPORTS} lamports; got ${result.total}; errors=${result.errors.join(" | ")}`
    );
  });
});
