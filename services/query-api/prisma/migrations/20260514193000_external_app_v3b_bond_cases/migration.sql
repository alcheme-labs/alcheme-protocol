CREATE TABLE "external_app_economics_config_projections" (
  "id" VARCHAR(96) NOT NULL,
  "environment" VARCHAR(24) NOT NULL,
  "program_id" VARCHAR(64) NOT NULL,
  "config_pda" VARCHAR(64) NOT NULL,
  "governance_authority" VARCHAR(64) NOT NULL,
  "policy_epoch_digest" VARCHAR(64) NOT NULL,
  "asset_mint" VARCHAR(64),
  "asset_token_program" VARCHAR(64),
  "asset_status" VARCHAR(24) NOT NULL DEFAULT 'disabled',
  "withdrawal_lock_seconds" INTEGER NOT NULL DEFAULT 0,
  "paused_new_economic_exposure" BOOLEAN NOT NULL DEFAULT true,
  "tx_signature" VARCHAR(128),
  "tx_slot" BIGINT,
  "synced_at" TIMESTAMP(3),
  "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updated_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "external_app_economics_config_projections_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "external_app_bond_vaults" (
  "id" VARCHAR(128) NOT NULL,
  "external_app_id" VARCHAR(64) NOT NULL,
  "policy_epoch_id" VARCHAR(96) NOT NULL,
  "app_id_hash" VARCHAR(64) NOT NULL,
  "owner_pubkey" VARCHAR(64) NOT NULL,
  "mint" VARCHAR(64) NOT NULL,
  "vault_pda" VARCHAR(64) NOT NULL,
  "vault_token_account" VARCHAR(64) NOT NULL,
  "owner_bond_raw" VARCHAR(64) NOT NULL DEFAULT '0',
  "withdrawal_requested_at" TIMESTAMP(3),
  "status" VARCHAR(24) NOT NULL DEFAULT 'open',
  "last_receipt_digest" VARCHAR(64),
  "tx_signature" VARCHAR(128),
  "tx_slot" BIGINT,
  "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updated_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "external_app_bond_vaults_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "external_app_challenge_cases" (
  "id" VARCHAR(128) NOT NULL,
  "external_app_id" VARCHAR(64) NOT NULL,
  "policy_epoch_id" VARCHAR(96) NOT NULL,
  "app_id_hash" VARCHAR(64) NOT NULL,
  "case_id" VARCHAR(64) NOT NULL,
  "challenger_pubkey" VARCHAR(64) NOT NULL,
  "challenge_type" VARCHAR(48) NOT NULL,
  "evidence_hash" VARCHAR(128) NOT NULL,
  "mint" VARCHAR(64) NOT NULL,
  "case_pda" VARCHAR(64) NOT NULL,
  "case_vault_token_account" VARCHAR(64) NOT NULL,
  "challenge_bond_raw" VARCHAR(64) NOT NULL DEFAULT '0',
  "response_digest" VARCHAR(64),
  "ruling_digest" VARCHAR(64),
  "appeal_window_ends_at" TIMESTAMP(3),
  "status" VARCHAR(24) NOT NULL DEFAULT 'open',
  "governance_request_id" VARCHAR(96),
  "tx_signature" VARCHAR(128),
  "tx_slot" BIGINT,
  "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updated_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "external_app_challenge_cases_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "external_app_settlement_receipts" (
  "id" VARCHAR(128) NOT NULL,
  "external_app_id" VARCHAR(64) NOT NULL,
  "policy_epoch_id" VARCHAR(96) NOT NULL,
  "policy_epoch_digest" VARCHAR(64) NOT NULL,
  "app_id_hash" VARCHAR(64) NOT NULL,
  "case_id" VARCHAR(64) NOT NULL,
  "receipt_id" VARCHAR(64) NOT NULL,
  "mint" VARCHAR(64) NOT NULL,
  "amount_raw" VARCHAR(64) NOT NULL,
  "authority_pubkey" VARCHAR(64) NOT NULL,
  "source_token_account" VARCHAR(64) NOT NULL,
  "destination_token_account" VARCHAR(64) NOT NULL,
  "receipt_digest" VARCHAR(64) NOT NULL,
  "tx_signature" VARCHAR(128),
  "tx_slot" BIGINT,
  "status" VARCHAR(24) NOT NULL DEFAULT 'submitted',
  "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updated_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "external_app_settlement_receipts_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "external_app_economics_config_projections_environment_program_id_key"
  ON "external_app_economics_config_projections"("environment", "program_id");
CREATE UNIQUE INDEX "external_app_economics_config_projections_config_pda_key"
  ON "external_app_economics_config_projections"("config_pda");
CREATE INDEX "external_app_economics_config_projections_environment_asset_status_idx"
  ON "external_app_economics_config_projections"("environment", "asset_status");

CREATE UNIQUE INDEX "external_app_bond_vaults_app_id_hash_mint_key"
  ON "external_app_bond_vaults"("app_id_hash", "mint");
CREATE UNIQUE INDEX "external_app_bond_vaults_vault_pda_key"
  ON "external_app_bond_vaults"("vault_pda");
CREATE INDEX "external_app_bond_vaults_external_app_id_status_idx"
  ON "external_app_bond_vaults"("external_app_id", "status");
CREATE INDEX "external_app_bond_vaults_owner_pubkey_status_idx"
  ON "external_app_bond_vaults"("owner_pubkey", "status");
CREATE INDEX "external_app_bond_vaults_policy_epoch_id_status_idx"
  ON "external_app_bond_vaults"("policy_epoch_id", "status");

CREATE UNIQUE INDEX "external_app_challenge_cases_case_id_key"
  ON "external_app_challenge_cases"("case_id");
CREATE UNIQUE INDEX "external_app_challenge_cases_case_pda_key"
  ON "external_app_challenge_cases"("case_pda");
CREATE INDEX "external_app_challenge_cases_external_app_id_status_idx"
  ON "external_app_challenge_cases"("external_app_id", "status");
CREATE INDEX "external_app_challenge_cases_challenger_pubkey_status_idx"
  ON "external_app_challenge_cases"("challenger_pubkey", "status");
CREATE INDEX "external_app_challenge_cases_policy_epoch_id_status_idx"
  ON "external_app_challenge_cases"("policy_epoch_id", "status");
CREATE INDEX "external_app_challenge_cases_governance_request_id_idx"
  ON "external_app_challenge_cases"("governance_request_id");

CREATE UNIQUE INDEX "external_app_settlement_receipts_receipt_id_key"
  ON "external_app_settlement_receipts"("receipt_id");
CREATE UNIQUE INDEX "external_app_settlement_receipts_receipt_digest_key"
  ON "external_app_settlement_receipts"("receipt_digest");
CREATE INDEX "external_app_settlement_receipts_external_app_id_status_idx"
  ON "external_app_settlement_receipts"("external_app_id", "status");
CREATE INDEX "external_app_settlement_receipts_case_id_status_idx"
  ON "external_app_settlement_receipts"("case_id", "status");
CREATE INDEX "external_app_settlement_receipts_policy_epoch_id_status_idx"
  ON "external_app_settlement_receipts"("policy_epoch_id", "status");
