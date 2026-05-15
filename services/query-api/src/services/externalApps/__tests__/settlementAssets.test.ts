import {
  resolveExternalAppSettlementAsset,
  assertSettlementAmountWithinCaps,
} from "../settlementAssets";

describe("external app settlement assets", () => {
  it("keeps production disabled unless an active allowlisted asset is configured", () => {
    expect(() =>
      resolveExternalAppSettlementAsset({
        mode: "disabled",
        environment: "production",
        requestedMint: "USDC",
        allowlist: [],
      }),
    ).toThrow("external_app_settlement_assets_disabled");
  });

  it("allows local test mint mode and rejects production test mint mode", () => {
    expect(
      resolveExternalAppSettlementAsset({
        mode: "test_mint",
        environment: "local",
        testMint: "TestMint111111111111111111111111111111111",
        requestedMint: "TestMint111111111111111111111111111111111",
        allowlist: [],
      }),
    ).toMatchObject({ mint: "TestMint111111111111111111111111111111111" });

    expect(() =>
      resolveExternalAppSettlementAsset({
        mode: "test_mint",
        environment: "production",
        testMint: "TestMint111111111111111111111111111111111",
        requestedMint: "TestMint111111111111111111111111111111111",
        allowlist: [],
      }),
    ).toThrow("external_app_settlement_test_mint_not_allowed_in_production");
  });

  it("enforces active allowlist status and caps", () => {
    const asset = resolveExternalAppSettlementAsset({
      mode: "allowlist",
      environment: "devnet",
      requestedMint: "AllowMint11111111111111111111111111111111",
      allowlist: [
        {
          mint: "AllowMint11111111111111111111111111111111",
          status: "active",
          perAppCapRaw: "1000",
          perCaseCapRaw: "100",
          perUserCapRaw: "10",
        },
      ],
    });

    expect(asset.status).toBe("active");
    expect(() => assertSettlementAmountWithinCaps(asset, "11", "perUserCapRaw")).toThrow(
      "external_app_settlement_amount_exceeds_cap",
    );
    expect(() => assertSettlementAmountWithinCaps(asset, "10", "perUserCapRaw")).not.toThrow();
  });
});
