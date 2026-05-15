ALTER TABLE "external_app_stability_projections"
  ADD COLUMN "bond_disposition_state" JSONB;

ALTER TABLE "external_app_risk_disclaimer_acceptances"
  ADD COLUMN "chain_receipt_pda" VARCHAR(64),
  ADD COLUMN "chain_receipt_digest" VARCHAR(64),
  ADD COLUMN "tx_signature" VARCHAR(128);

CREATE INDEX "external_app_risk_disclaimer_acceptances_chain_receipt_pda_idx"
  ON "external_app_risk_disclaimer_acceptances"("chain_receipt_pda");

CREATE TABLE "external_app_bond_disposition_policies" (
  "id" VARCHAR(128) NOT NULL,
  "policy_epoch_id" VARCHAR(96) NOT NULL,
  "policy_id" VARCHAR(64) NOT NULL,
  "policy_digest" VARCHAR(64) NOT NULL,
  "mint" VARCHAR(64) NOT NULL,
  "governance_authority" VARCHAR(64) NOT NULL,
  "max_case_amount_raw" VARCHAR(64) NOT NULL,
  "status" VARCHAR(24) NOT NULL DEFAULT 'active',
  "paused" BOOLEAN NOT NULL DEFAULT false,
  "tx_signature" VARCHAR(128),
  "tx_slot" BIGINT,
  "metadata" JSONB,
  "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updated_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "external_app_bond_disposition_policies_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "external_app_bond_disposition_policies_policy_id_key"
  ON "external_app_bond_disposition_policies"("policy_id");
CREATE INDEX "external_app_bond_disposition_policies_policy_epoch_id_status_idx"
  ON "external_app_bond_disposition_policies"("policy_epoch_id", "status");
CREATE INDEX "external_app_bond_disposition_policies_mint_status_idx"
  ON "external_app_bond_disposition_policies"("mint", "status");

CREATE TABLE "external_app_bond_disposition_cases" (
  "id" VARCHAR(128) NOT NULL,
  "external_app_id" VARCHAR(64) NOT NULL,
  "policy_epoch_id" VARCHAR(96) NOT NULL,
  "app_id_hash" VARCHAR(64) NOT NULL,
  "case_id" VARCHAR(64) NOT NULL,
  "policy_id" VARCHAR(64) NOT NULL,
  "initiator_pubkey" VARCHAR(64) NOT NULL,
  "mint" VARCHAR(64) NOT NULL,
  "owner_bond_vault_pda" VARCHAR(64) NOT NULL,
  "owner_vault_token_account" VARCHAR(64) NOT NULL,
  "requested_amount_raw" VARCHAR(64) NOT NULL,
  "locked_amount_raw" VARCHAR(64) NOT NULL DEFAULT '0',
  "routed_amount_raw" VARCHAR(64) NOT NULL DEFAULT '0',
  "evidence_hash" VARCHAR(128) NOT NULL,
  "ruling_digest" VARCHAR(64),
  "status" VARCHAR(32) NOT NULL DEFAULT 'unlocked',
  "related_party_flags" JSONB,
  "governance_request_id" VARCHAR(96),
  "tx_signature" VARCHAR(128),
  "tx_slot" BIGINT,
  "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updated_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "external_app_bond_disposition_cases_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "external_app_bond_disposition_cases_case_id_key"
  ON "external_app_bond_disposition_cases"("case_id");
CREATE INDEX "external_app_bond_disposition_cases_external_app_id_status_idx"
  ON "external_app_bond_disposition_cases"("external_app_id", "status");
CREATE INDEX "external_app_bond_disposition_cases_policy_epoch_id_status_idx"
  ON "external_app_bond_disposition_cases"("policy_epoch_id", "status");
CREATE INDEX "external_app_bond_disposition_cases_initiator_pubkey_status_idx"
  ON "external_app_bond_disposition_cases"("initiator_pubkey", "status");
CREATE INDEX "external_app_bond_disposition_cases_governance_request_id_idx"
  ON "external_app_bond_disposition_cases"("governance_request_id");

CREATE TABLE "external_app_bond_routing_receipts" (
  "id" VARCHAR(128) NOT NULL,
  "external_app_id" VARCHAR(64) NOT NULL,
  "policy_epoch_id" VARCHAR(96) NOT NULL,
  "app_id_hash" VARCHAR(64) NOT NULL,
  "case_id" VARCHAR(64) NOT NULL,
  "receipt_id" VARCHAR(64) NOT NULL,
  "policy_id" VARCHAR(64) NOT NULL,
  "amount_raw" VARCHAR(64) NOT NULL,
  "authority_pubkey" VARCHAR(64) NOT NULL,
  "source_token_account" VARCHAR(64) NOT NULL,
  "destination_token_account" VARCHAR(64) NOT NULL,
  "routing_digest" VARCHAR(64) NOT NULL,
  "tx_signature" VARCHAR(128),
  "tx_slot" BIGINT,
  "status" VARCHAR(24) NOT NULL DEFAULT 'submitted',
  "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updated_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "external_app_bond_routing_receipts_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "external_app_bond_routing_receipts_receipt_id_key"
  ON "external_app_bond_routing_receipts"("receipt_id");
CREATE UNIQUE INDEX "external_app_bond_routing_receipts_routing_digest_key"
  ON "external_app_bond_routing_receipts"("routing_digest");
CREATE INDEX "external_app_bond_routing_receipts_external_app_id_status_idx"
  ON "external_app_bond_routing_receipts"("external_app_id", "status");
CREATE INDEX "external_app_bond_routing_receipts_case_id_status_idx"
  ON "external_app_bond_routing_receipts"("case_id", "status");
CREATE INDEX "external_app_bond_routing_receipts_policy_epoch_id_status_idx"
  ON "external_app_bond_routing_receipts"("policy_epoch_id", "status");

CREATE TABLE "external_app_bond_exposure_states" (
  "id" VARCHAR(128) NOT NULL,
  "external_app_id" VARCHAR(64) NOT NULL,
  "policy_epoch_id" VARCHAR(96) NOT NULL,
  "app_id_hash" VARCHAR(64) NOT NULL,
  "mint" VARCHAR(64) NOT NULL,
  "active_locked_amount_raw" VARCHAR(64) NOT NULL DEFAULT '0',
  "total_routed_amount_raw" VARCHAR(64) NOT NULL DEFAULT '0',
  "paused_new_bond_exposure" BOOLEAN NOT NULL DEFAULT false,
  "exposure_digest" VARCHAR(64) NOT NULL,
  "tx_signature" VARCHAR(128),
  "tx_slot" BIGINT,
  "updated_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "external_app_bond_exposure_states_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "external_app_bond_exposure_states_app_id_hash_mint_key"
  ON "external_app_bond_exposure_states"("app_id_hash", "mint");
CREATE INDEX "external_app_bond_exposure_states_external_app_id_paused_new_bond_exposure_idx"
  ON "external_app_bond_exposure_states"("external_app_id", "paused_new_bond_exposure");
CREATE INDEX "external_app_bond_exposure_states_policy_epoch_id_idx"
  ON "external_app_bond_exposure_states"("policy_epoch_id");
