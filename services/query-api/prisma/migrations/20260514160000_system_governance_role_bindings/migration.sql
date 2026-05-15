CREATE TABLE "system_governance_role_bindings" (
  "id" VARCHAR(96) NOT NULL,
  "domain" VARCHAR(32) NOT NULL,
  "role_key" VARCHAR(64) NOT NULL,
  "environment" VARCHAR(32) NOT NULL,
  "circle_id" INTEGER NOT NULL,
  "policy_id" VARCHAR(96) NOT NULL,
  "policy_version_id" VARCHAR(96) NOT NULL,
  "policy_version" INTEGER NOT NULL,
  "status" VARCHAR(16) NOT NULL DEFAULT 'active',
  "activated_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "superseded_at" TIMESTAMP(3),
  "created_by_pubkey" VARCHAR(44),
  "source_request_id" VARCHAR(96),
  "source_decision_digest" CHAR(64),
  "source_execution_receipt_id" VARCHAR(96),
  "metadata" JSONB,
  "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updated_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

  CONSTRAINT "system_governance_role_bindings_pkey" PRIMARY KEY ("id")
);

CREATE INDEX "system_governance_role_bindings_domain_role_key_environment_status_idx"
  ON "system_governance_role_bindings"("domain", "role_key", "environment", "status");

CREATE INDEX "system_governance_role_bindings_circle_id_idx"
  ON "system_governance_role_bindings"("circle_id");

CREATE INDEX "system_governance_role_bindings_policy_id_policy_version_id_idx"
  ON "system_governance_role_bindings"("policy_id", "policy_version_id");

CREATE UNIQUE INDEX "system_governance_role_bindings_active_unique"
  ON "system_governance_role_bindings"("domain", "role_key", "environment")
  WHERE "status" = 'active';
