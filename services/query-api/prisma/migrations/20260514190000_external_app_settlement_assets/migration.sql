CREATE TABLE "external_app_settlement_assets" (
  "id" VARCHAR(96) NOT NULL,
  "policy_epoch_id" VARCHAR(96) NOT NULL,
  "environment" VARCHAR(24) NOT NULL,
  "mint" VARCHAR(64) NOT NULL,
  "token_program_id" VARCHAR(64) NOT NULL,
  "decimals" INTEGER NOT NULL,
  "symbol" VARCHAR(16) NOT NULL,
  "display_name" VARCHAR(64) NOT NULL,
  "status" VARCHAR(24) NOT NULL DEFAULT 'disabled',
  "per_app_cap_raw" VARCHAR(64),
  "per_case_cap_raw" VARCHAR(64),
  "per_user_cap_raw" VARCHAR(64),
  "withdrawal_lock_seconds" INTEGER NOT NULL DEFAULT 0,
  "activation_receipt_id" VARCHAR(96),
  "metadata" JSONB,
  "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updated_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "external_app_settlement_assets_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "external_app_settlement_assets_environment_mint_key"
  ON "external_app_settlement_assets"("environment", "mint");
CREATE INDEX "external_app_settlement_assets_policy_epoch_id_status_idx"
  ON "external_app_settlement_assets"("policy_epoch_id", "status");
