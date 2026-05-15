CREATE TABLE "external_app_store_projections" (
  "external_app_id" VARCHAR(64) NOT NULL,
  "policy_epoch_id" VARCHAR(96) NOT NULL,
  "listing_state" VARCHAR(32) NOT NULL DEFAULT 'unlisted',
  "category_tags" JSONB,
  "search_text" TEXT NOT NULL DEFAULT '',
  "ranking_inputs" JSONB,
  "ranking_output" JSONB,
  "featured_state" VARCHAR(24) NOT NULL DEFAULT 'none',
  "continuity_labels" JSONB,
  "updated_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "external_app_store_projections_pkey"
    PRIMARY KEY ("external_app_id", "policy_epoch_id")
);

CREATE INDEX "external_app_store_projections_listing_state_featured_state_idx"
  ON "external_app_store_projections"("listing_state", "featured_state");

CREATE TABLE "external_app_evidence_receipts" (
  "id" VARCHAR(96) NOT NULL,
  "external_app_id" VARCHAR(64) NOT NULL,
  "case_id" VARCHAR(96),
  "evidence_hash" VARCHAR(128) NOT NULL,
  "evidence_kind" VARCHAR(48) NOT NULL,
  "availability_status" VARCHAR(24) NOT NULL DEFAULT 'available',
  "redaction_level" VARCHAR(24) NOT NULL DEFAULT 'public',
  "retention_until" TIMESTAMP(3),
  "source_actor_pubkey" VARCHAR(44),
  "source_role" VARCHAR(48),
  "metadata" JSONB,
  "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updated_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "external_app_evidence_receipts_pkey" PRIMARY KEY ("id")
);

CREATE INDEX "external_app_evidence_receipts_external_app_id_case_id_idx"
  ON "external_app_evidence_receipts"("external_app_id", "case_id");
CREATE INDEX "external_app_evidence_receipts_evidence_hash_idx"
  ON "external_app_evidence_receipts"("evidence_hash");
CREATE INDEX "external_app_evidence_receipts_availability_status_redaction_level_idx"
  ON "external_app_evidence_receipts"("availability_status", "redaction_level");

CREATE TABLE "external_app_actor_relations" (
  "id" VARCHAR(96) NOT NULL,
  "external_app_id" VARCHAR(64) NOT NULL,
  "actor_pubkey" VARCHAR(44) NOT NULL,
  "relation_type" VARCHAR(32) NOT NULL,
  "disclosure_source" VARCHAR(32) NOT NULL,
  "confidence" VARCHAR(16) NOT NULL DEFAULT 'medium',
  "effective_from" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "ended_at" TIMESTAMP(3),
  "metadata" JSONB,
  "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updated_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "external_app_actor_relations_pkey" PRIMARY KEY ("id")
);

CREATE INDEX "external_app_actor_relations_external_app_id_relation_type_idx"
  ON "external_app_actor_relations"("external_app_id", "relation_type");
CREATE INDEX "external_app_actor_relations_actor_pubkey_relation_type_idx"
  ON "external_app_actor_relations"("actor_pubkey", "relation_type");

CREATE TABLE "external_app_risk_disclaimer_acceptances" (
  "id" VARCHAR(96) NOT NULL,
  "external_app_id" VARCHAR(64) NOT NULL,
  "actor_pubkey" VARCHAR(44) NOT NULL,
  "scope" VARCHAR(32) NOT NULL,
  "policy_epoch_id" VARCHAR(96) NOT NULL,
  "disclaimer_version" VARCHAR(32) NOT NULL,
  "accepted_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "source" VARCHAR(32) NOT NULL,
  "signature_digest" VARCHAR(128),
  "metadata" JSONB,
  CONSTRAINT "external_app_risk_disclaimer_acceptances_pkey" PRIMARY KEY ("id")
);

CREATE INDEX "external_app_risk_disclaimer_acceptances_external_app_id_actor_pubkey_scope_idx"
  ON "external_app_risk_disclaimer_acceptances"("external_app_id", "actor_pubkey", "scope");
CREATE INDEX "external_app_risk_disclaimer_acceptances_policy_epoch_id_disclaimer_version_idx"
  ON "external_app_risk_disclaimer_acceptances"("policy_epoch_id", "disclaimer_version");
