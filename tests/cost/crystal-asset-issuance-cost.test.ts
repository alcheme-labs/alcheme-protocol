// @ts-nocheck
import { expect } from "chai";
import { createRequire } from "module";

const require = createRequire(import.meta.url);
const {
  classifyCrystalIssuanceMeasurementMode,
  measureCrystalAssetIssuanceCost,
} = require("../../scripts/measure/crystal-asset-issuance-cost.ts");

describe("P4E gate: crystal asset issuance cost measurement", function () {
  this.timeout(300000);

  it("keeps mock_chain and estimated Token-2022 measurement modes explicit", () => {
    expect(classifyCrystalIssuanceMeasurementMode(undefined)).to.equal("mock_chain");
    expect(classifyCrystalIssuanceMeasurementMode("mock_chain")).to.equal("mock_chain");
    expect(classifyCrystalIssuanceMeasurementMode("estimated")).to.equal("estimated");
    expect(classifyCrystalIssuanceMeasurementMode("estimated_token2022")).to.equal("estimated");
  });

  it("records mock_chain issuance as zero-cost demo evidence, not real chain cost", async () => {
    const result = await measureCrystalAssetIssuanceCost({
      measurementMode: "mock_chain",
      receiptCount: 2,
    });

    console.log("[crystal_asset_issuance_mock_cost]", JSON.stringify(result, null, 2));

    expect(result.method).to.equal("crystal_asset_issuance");
    expect(result.measurement_mode).to.equal("mock_chain");
    expect(result.receipt_count).to.equal(2);
    expect(result.issued_receipt_count).to.equal(2);
    expect(result.total).to.equal(0);
    expect(result.sample_signatures).to.deep.equal([]);
    expect(result.signature_policy).to.equal("mock_chain_no_sample_signatures");
    expect(result.master.asset_standard).to.equal("mock_chain_master");
    expect(result.receipts[0].asset_standard).to.equal("mock_chain_receipt");
  });

  it("can produce a non-zero estimated Token-2022 master plus receipt cost", async () => {
    const result = await measureCrystalAssetIssuanceCost({
      measurementMode: "estimated",
      receiptCount: 2,
    });

    console.log("[crystal_asset_issuance_token2022_estimate]", JSON.stringify(result, null, 2));

    expect(result.measurement_mode).to.equal("estimated");
    expect(result.total).to.be.greaterThan(0);
    expect(result.master.asset_standard).to.equal("token2022_master_nft");
    expect(result.receipts[0].asset_standard).to.equal("token2022_non_transferable_receipt");
    expect(result.signature_policy).to.equal("estimated_token2022_no_sample_signatures");
  });
});
