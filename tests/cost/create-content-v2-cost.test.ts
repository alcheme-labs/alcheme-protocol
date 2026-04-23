// @ts-nocheck
import { expect } from "chai";
import { createRequire } from "module";

const require = createRequire(import.meta.url);
const {
  CREATE_CONTENT_V2_THRESHOLD_LAMPORTS,
  DEFAULT_PERCENTILE,
  classifyContentIdPath,
  measureCreateContentV2Cost,
} = require("../../scripts/measure/create-content-v2-cost.ts");

describe("Task1 Batch3a red gate: create_content_v2 cost", function () {
  this.timeout(300000);

  it("classifies positive content_id as valid for v2 route", () => {
    expect(classifyContentIdPath(101)).to.equal("valid_positive");
  });

  it("classifies non-positive content_id as invalid for v2 route", () => {
    expect(classifyContentIdPath(0)).to.equal("invalid_non_positive");
    expect(classifyContentIdPath(-1)).to.equal("invalid_non_positive");
  });

  it("uses real on-chain sampling path (not placeholder reason)", async () => {
    const result = await measureCreateContentV2Cost({
      percentile: DEFAULT_PERCENTILE,
      sampleCount: 3,
    });

    console.log("[create_content_v2_sampling_probe]", JSON.stringify(result, null, 2));

    expect(result.method).to.equal("create_content_v2");
    expect(result.sample_count).to.equal(3);
    expect(result).to.have.property("measurement_mode");
    expect(result.measurement_mode).to.equal("onchain_sampling");
    expect(result).to.have.property("observed_samples");
    expect(result.observed_samples).to.equal(3);
    expect(result).to.have.property("sample_errors");
    expect(result.sample_errors.length).to.equal(result.failed_samples);
    expect(result.errors.join(" | ").toLowerCase()).to.not.include("red-gated");
    expect(result.errors.join(" | ").toLowerCase()).to.not.include("placeholder");
  });

  it("asserts create_content_v2 P95 <= 1_000_000 lamports", async () => {
    const result = await measureCreateContentV2Cost({
      percentile: DEFAULT_PERCENTILE,
      sampleCount: 20,
    });

    console.log("[create_content_v2_cost_result]", JSON.stringify(result, null, 2));

    expect(result.percentile).to.equal(DEFAULT_PERCENTILE);
    expect(
      result.failed_samples,
      `create_content_v2 sampling must have zero failed samples; got ${result.failed_samples}; errors=${result.errors.join(" | ")}`
    ).to.equal(0);
    expect(result.errors, `create_content_v2 sampling errors=${result.errors.join(" | ")}`).to.deep.equal([]);
    expect(result.event_delta).to.be.at.most(
      CREATE_CONTENT_V2_THRESHOLD_LAMPORTS - 5_000,
      `create_content_v2 P${result.percentile} event_delta must be <= ${CREATE_CONTENT_V2_THRESHOLD_LAMPORTS - 5_000} lamports; got ${result.event_delta}; errors=${result.errors.join(" | ")}`
    );
    expect(result.total).to.be.at.most(
      CREATE_CONTENT_V2_THRESHOLD_LAMPORTS,
      `create_content_v2 P${result.percentile} must be <= ${CREATE_CONTENT_V2_THRESHOLD_LAMPORTS} lamports; got ${result.total}; errors=${result.errors.join(" | ")}`
    );
  });

  it("records a non-public CircleOnly cost sample under the same threshold", async () => {
    const result = await measureCreateContentV2Cost({
      percentile: DEFAULT_PERCENTILE,
      sampleCount: 3,
      visibilityLevel: "CircleOnly",
      protocolCircleId: 7,
    } as any);

    console.log("[create_content_v2_circle_only_cost_result]", JSON.stringify(result, null, 2));

    expect(result.method).to.equal("create_content_v2_circle_only");
    expect(result.failed_samples).to.equal(
      0,
      `create_content_v2 CircleOnly sampling must have zero failed samples; got ${result.failed_samples}; errors=${result.errors.join(" | ")}`
    );
    expect(result.errors, `create_content_v2 CircleOnly sampling errors=${result.errors.join(" | ")}`).to.deep.equal([]);
    expect(result.total).to.be.at.most(
      CREATE_CONTENT_V2_THRESHOLD_LAMPORTS,
      `create_content_v2 CircleOnly P${result.percentile} must be <= ${CREATE_CONTENT_V2_THRESHOLD_LAMPORTS} lamports; got ${result.total}; errors=${result.errors.join(" | ")}`
    );
  });
});
