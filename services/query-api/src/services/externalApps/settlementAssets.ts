export type ExternalAppSettlementAssetMode = "disabled" | "test_mint" | "allowlist";
export type ExternalAppSettlementEnvironment = "local" | "devnet" | "production";
export type ExternalAppSettlementAssetStatus =
  | "disabled"
  | "test_only"
  | "active"
  | "paused"
  | "retired";

export interface ExternalAppSettlementAssetConfig {
  mint: string;
  status: ExternalAppSettlementAssetStatus;
  tokenProgramId?: string;
  decimals?: number;
  symbol?: string;
  displayName?: string;
  perAppCapRaw?: string | null;
  perCaseCapRaw?: string | null;
  perUserCapRaw?: string | null;
}

export function resolveExternalAppSettlementAsset(input: {
  mode: ExternalAppSettlementAssetMode;
  environment: ExternalAppSettlementEnvironment;
  requestedMint?: string | null;
  testMint?: string | null;
  allowlist: ExternalAppSettlementAssetConfig[];
}): ExternalAppSettlementAssetConfig {
  if (input.mode === "disabled") {
    throw new Error("external_app_settlement_assets_disabled");
  }
  const requestedMint = normalizeMint(input.requestedMint);
  if (input.mode === "test_mint") {
    if (input.environment === "production") {
      throw new Error("external_app_settlement_test_mint_not_allowed_in_production");
    }
    const testMint = normalizeMint(input.testMint);
    if (!testMint || requestedMint !== testMint) {
      throw new Error("external_app_settlement_test_mint_required");
    }
    return {
      mint: testMint,
      status: "test_only",
      tokenProgramId: "TokenkegQfeZyiNwAJbNbGKPFXCWuBvf9Ss623VQ5DA",
      decimals: 6,
      symbol: "TEST",
      displayName: "External App Settlement Test Mint",
    };
  }

  const asset = input.allowlist.find(
    (candidate) => normalizeMint(candidate.mint) === requestedMint,
  );
  if (!asset) throw new Error("external_app_settlement_asset_not_allowlisted");
  if (asset.status !== "active") {
    throw new Error("external_app_settlement_asset_not_active");
  }
  return asset;
}

export function assertSettlementAmountWithinCaps(
  asset: ExternalAppSettlementAssetConfig,
  amountRaw: string,
  capField: "perAppCapRaw" | "perCaseCapRaw" | "perUserCapRaw",
): void {
  const cap = asset[capField];
  if (!cap) return;
  if (BigInt(amountRaw) > BigInt(cap)) {
    throw new Error("external_app_settlement_amount_exceeds_cap");
  }
}

function normalizeMint(value: unknown): string {
  return String(value || "").trim();
}
