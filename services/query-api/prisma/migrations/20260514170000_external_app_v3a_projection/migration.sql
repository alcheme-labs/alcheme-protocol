CREATE TABLE "external_app_policy_epochs" (
  "id" VARCHAR(96) NOT NULL,
  "epoch_key" VARCHAR(96) NOT NULL,
  "status" VARCHAR(24) NOT NULL DEFAULT 'draft',
  "environment" VARCHAR(32) NOT NULL DEFAULT 'sandbox',
  "formula_registry" JSONB,
  "parameter_bounds" JSONB,
  "effective_from" TIMESTAMP(3),
  "effective_to" TIMESTAMP(3),
  "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updated_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "external_app_policy_epochs_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "external_app_policy_epochs_epoch_key_key"
  ON "external_app_policy_epochs"("epoch_key");
CREATE INDEX "external_app_policy_epochs_status_environment_idx"
  ON "external_app_policy_epochs"("status", "environment");

CREATE TABLE "external_app_stability_projections" (
  "id" VARCHAR(128) NOT NULL,
  "external_app_id" VARCHAR(64) NOT NULL,
  "policy_epoch_id" VARCHAR(96) NOT NULL,
  "challenge_state" VARCHAR(24) NOT NULL DEFAULT 'none',
  "projection_status" VARCHAR(32) NOT NULL DEFAULT 'normal',
  "public_labels" JSONB,
  "risk_score" DOUBLE PRECISION NOT NULL DEFAULT 0,
  "trust_score" DOUBLE PRECISION NOT NULL DEFAULT 0,
  "support_signal_level" DOUBLE PRECISION NOT NULL DEFAULT 0,
  "support_independence_score" DOUBLE PRECISION NOT NULL DEFAULT 0,
  "rollout" JSONB,
  "formula_inputs" JSONB,
  "formula_outputs" JSONB,
  "status_provenance" JSONB,
  "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updated_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "external_app_stability_projections_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "external_app_stability_projections_external_app_id_policy_epoch_id_key"
  ON "external_app_stability_projections"("external_app_id", "policy_epoch_id");
CREATE INDEX "external_app_stability_projections_external_app_id_updated_at_idx"
  ON "external_app_stability_projections"("external_app_id", "updated_at");
CREATE INDEX "external_app_stability_projections_projection_status_challenge_state_idx"
  ON "external_app_stability_projections"("projection_status", "challenge_state");

CREATE TABLE "external_app_risk_signals" (
  "id" VARCHAR(96) NOT NULL,
  "external_app_id" VARCHAR(64) NOT NULL,
  "signal_type" VARCHAR(48) NOT NULL,
  "severity" DOUBLE PRECISION NOT NULL DEFAULT 0,
  "source" VARCHAR(48) NOT NULL,
  "evidence_hash" VARCHAR(128),
  "actor_pubkey" VARCHAR(44),
  "relationship_class" VARCHAR(48),
  "occurred_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "metadata" JSONB,
  "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updated_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "external_app_risk_signals_pkey" PRIMARY KEY ("id")
);

CREATE INDEX "external_app_risk_signals_external_app_id_occurred_at_idx"
  ON "external_app_risk_signals"("external_app_id", "occurred_at");
CREATE INDEX "external_app_risk_signals_signal_type_severity_idx"
  ON "external_app_risk_signals"("signal_type", "severity");

CREATE TABLE "external_app_projection_receipts" (
  "id" VARCHAR(128) NOT NULL,
  "external_app_id" VARCHAR(64) NOT NULL,
  "receipt_type" VARCHAR(48) NOT NULL,
  "source_hierarchy" JSONB,
  "parser_version" VARCHAR(32) NOT NULL,
  "input_digest" VARCHAR(71) NOT NULL,
  "output_digest" VARCHAR(71) NOT NULL,
  "status" VARCHAR(24) NOT NULL DEFAULT 'active',
  "metadata" JSONB,
  "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updated_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "external_app_projection_receipts_pkey" PRIMARY KEY ("id")
);

CREATE INDEX "external_app_projection_receipts_external_app_id_receipt_type_status_idx"
  ON "external_app_projection_receipts"("external_app_id", "receipt_type", "status");
CREATE INDEX "external_app_projection_receipts_input_digest_idx"
  ON "external_app_projection_receipts"("input_digest");
CREATE INDEX "external_app_projection_receipts_output_digest_idx"
  ON "external_app_projection_receipts"("output_digest");
