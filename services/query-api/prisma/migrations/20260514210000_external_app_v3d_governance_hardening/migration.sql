ALTER TABLE "external_app_stability_projections"
  ADD COLUMN "governance_state" JSONB;

CREATE TABLE "external_app_governance_conflict_disclosures" (
  "id" VARCHAR(96) NOT NULL,
  "external_app_id" VARCHAR(64) NOT NULL,
  "actor_pubkey" VARCHAR(64) NOT NULL,
  "action_type" VARCHAR(64) NOT NULL,
  "role" VARCHAR(48) NOT NULL,
  "status" VARCHAR(24) NOT NULL DEFAULT 'active',
  "source" VARCHAR(32) NOT NULL DEFAULT 'self_disclosed',
  "evidence_digest" VARCHAR(128),
  "effective_from" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "ended_at" TIMESTAMP(3),
  "metadata" JSONB,
  "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updated_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

  CONSTRAINT "external_app_governance_conflict_disclosures_pkey" PRIMARY KEY ("id")
);

CREATE INDEX "external_app_governance_conflict_disclosures_external_app_id_action_type_status_idx"
  ON "external_app_governance_conflict_disclosures"("external_app_id", "action_type", "status");

CREATE INDEX "external_app_governance_conflict_disclosures_actor_pubkey_role_status_idx"
  ON "external_app_governance_conflict_disclosures"("actor_pubkey", "role", "status");

CREATE TABLE "external_app_reviewer_reputations" (
  "id" VARCHAR(96) NOT NULL,
  "reviewer_pubkey" VARCHAR(64) NOT NULL,
  "environment" VARCHAR(32) NOT NULL DEFAULT 'production',
  "participation_count" INTEGER NOT NULL DEFAULT 0,
  "recusal_count" INTEGER NOT NULL DEFAULT 0,
  "upheld_decision_count" INTEGER NOT NULL DEFAULT 0,
  "reversed_decision_count" INTEGER NOT NULL DEFAULT 0,
  "capture_flag_count" INTEGER NOT NULL DEFAULT 0,
  "reputation_score" DOUBLE PRECISION NOT NULL DEFAULT 0,
  "status" VARCHAR(24) NOT NULL DEFAULT 'active',
  "metadata" JSONB,
  "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updated_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

  CONSTRAINT "external_app_reviewer_reputations_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "external_app_reviewer_reputations_reviewer_pubkey_environment_key"
  ON "external_app_reviewer_reputations"("reviewer_pubkey", "environment");

CREATE INDEX "external_app_reviewer_reputations_environment_status_reputation_score_idx"
  ON "external_app_reviewer_reputations"("environment", "status", "reputation_score");

CREATE TABLE "external_app_capture_reviews" (
  "id" VARCHAR(96) NOT NULL,
  "external_app_id" VARCHAR(64) NOT NULL,
  "opened_by_pubkey" VARCHAR(64) NOT NULL,
  "evidence_digest" VARCHAR(128) NOT NULL,
  "status" VARCHAR(24) NOT NULL DEFAULT 'open',
  "affected_action_types" JSONB,
  "governance_request_id" VARCHAR(96),
  "governance_receipt_id" VARCHAR(96),
  "opened_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "resolved_at" TIMESTAMP(3),
  "metadata" JSONB,
  "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updated_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

  CONSTRAINT "external_app_capture_reviews_pkey" PRIMARY KEY ("id")
);

CREATE INDEX "external_app_capture_reviews_external_app_id_status_idx"
  ON "external_app_capture_reviews"("external_app_id", "status");

CREATE INDEX "external_app_capture_reviews_opened_by_pubkey_status_idx"
  ON "external_app_capture_reviews"("opened_by_pubkey", "status");

CREATE INDEX "external_app_capture_reviews_governance_request_id_idx"
  ON "external_app_capture_reviews"("governance_request_id");

CREATE TABLE "external_app_projection_disputes" (
  "id" VARCHAR(96) NOT NULL,
  "external_app_id" VARCHAR(64) NOT NULL,
  "opened_by_pubkey" VARCHAR(64) NOT NULL,
  "projection_receipt_id" VARCHAR(128) NOT NULL,
  "evidence_digest" VARCHAR(128) NOT NULL,
  "status" VARCHAR(24) NOT NULL DEFAULT 'open',
  "governance_request_id" VARCHAR(96),
  "reconcile_receipt_id" VARCHAR(96),
  "opened_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "resolved_at" TIMESTAMP(3),
  "metadata" JSONB,
  "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updated_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

  CONSTRAINT "external_app_projection_disputes_pkey" PRIMARY KEY ("id")
);

CREATE INDEX "external_app_projection_disputes_external_app_id_status_idx"
  ON "external_app_projection_disputes"("external_app_id", "status");

CREATE INDEX "external_app_projection_disputes_projection_receipt_id_idx"
  ON "external_app_projection_disputes"("projection_receipt_id");

CREATE INDEX "external_app_projection_disputes_governance_request_id_idx"
  ON "external_app_projection_disputes"("governance_request_id");

CREATE TABLE "external_app_arbitration_references" (
  "id" VARCHAR(128) NOT NULL,
  "external_app_id" VARCHAR(64) NOT NULL,
  "case_id" VARCHAR(96) NOT NULL,
  "provider" VARCHAR(48) NOT NULL,
  "external_reference_id" VARCHAR(128) NOT NULL,
  "status" VARCHAR(24) NOT NULL DEFAULT 'opened',
  "receipt_digest" VARCHAR(128) NOT NULL,
  "governance_execution_receipt_id" VARCHAR(96),
  "metadata" JSONB,
  "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updated_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

  CONSTRAINT "external_app_arbitration_references_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "external_app_arbitration_references_provider_external_reference_id_key"
  ON "external_app_arbitration_references"("provider", "external_reference_id");

CREATE INDEX "external_app_arbitration_references_external_app_id_case_id_status_idx"
  ON "external_app_arbitration_references"("external_app_id", "case_id", "status");

CREATE INDEX "external_app_arbitration_references_governance_execution_receipt_id_idx"
  ON "external_app_arbitration_references"("governance_execution_receipt_id");

CREATE TABLE "external_app_emergency_actions" (
  "id" VARCHAR(128) NOT NULL,
  "external_app_id" VARCHAR(64) NOT NULL,
  "action_type" VARCHAR(48) NOT NULL,
  "action_scope" VARCHAR(48) NOT NULL,
  "affected_capabilities" JSONB,
  "operator_identity" VARCHAR(96) NOT NULL,
  "evidence_digest" VARCHAR(128) NOT NULL,
  "source_receipt_id" VARCHAR(96) NOT NULL,
  "owner_notification_status" VARCHAR(32) NOT NULL,
  "appeal_route" VARCHAR(96) NOT NULL,
  "existing_session_effect" VARCHAR(32) NOT NULL,
  "status" VARCHAR(24) NOT NULL DEFAULT 'active',
  "started_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "expires_at" TIMESTAMP(3) NOT NULL,
  "corrected_at" TIMESTAMP(3),
  "metadata" JSONB,
  "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updated_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

  CONSTRAINT "external_app_emergency_actions_pkey" PRIMARY KEY ("id")
);

CREATE INDEX "external_app_emergency_actions_external_app_id_action_scope_status_idx"
  ON "external_app_emergency_actions"("external_app_id", "action_scope", "status");

CREATE INDEX "external_app_emergency_actions_expires_at_idx"
  ON "external_app_emergency_actions"("expires_at");

CREATE INDEX "external_app_emergency_actions_source_receipt_id_idx"
  ON "external_app_emergency_actions"("source_receipt_id");

CREATE TABLE "external_app_correction_receipts" (
  "id" VARCHAR(128) NOT NULL,
  "external_app_id" VARCHAR(64) NOT NULL,
  "correction_type" VARCHAR(48) NOT NULL,
  "corrected_record_type" VARCHAR(48) NOT NULL,
  "corrected_record_id" VARCHAR(128) NOT NULL,
  "correction_digest" VARCHAR(128) NOT NULL,
  "source_receipt_id" VARCHAR(96) NOT NULL,
  "governance_execution_receipt_id" VARCHAR(96),
  "created_by_pubkey" VARCHAR(64),
  "metadata" JSONB,
  "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updated_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

  CONSTRAINT "external_app_correction_receipts_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "external_app_correction_receipts_corrected_record_type_corrected_record_id_correction_digest_key"
  ON "external_app_correction_receipts"("corrected_record_type", "corrected_record_id", "correction_digest");

CREATE INDEX "external_app_correction_receipts_external_app_id_correction_type_idx"
  ON "external_app_correction_receipts"("external_app_id", "correction_type");

CREATE INDEX "external_app_correction_receipts_source_receipt_id_idx"
  ON "external_app_correction_receipts"("source_receipt_id");
