CREATE TABLE "governance_policies" (
  "id" VARCHAR(96) NOT NULL,
  "scope_type" VARCHAR(32) NOT NULL,
  "scope_ref" VARCHAR(128) NOT NULL,
  "status" VARCHAR(16) NOT NULL DEFAULT 'active',
  "active_version" INTEGER,
  "created_by_pubkey" VARCHAR(44),
  "metadata" JSONB,
  "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updated_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

  CONSTRAINT "governance_policies_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "governance_policy_versions" (
  "id" VARCHAR(96) NOT NULL,
  "policy_id" VARCHAR(96) NOT NULL,
  "version" INTEGER NOT NULL,
  "status" VARCHAR(16) NOT NULL DEFAULT 'draft',
  "rules" JSONB NOT NULL,
  "config_digest" CHAR(64) NOT NULL,
  "activated_at" TIMESTAMP(3),
  "created_by_pubkey" VARCHAR(44),
  "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updated_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

  CONSTRAINT "governance_policy_versions_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "governance_requests" (
  "id" VARCHAR(96) NOT NULL,
  "policy_id" VARCHAR(96) NOT NULL,
  "policy_version_id" VARCHAR(96) NOT NULL,
  "policy_version" INTEGER NOT NULL,
  "rule_id" VARCHAR(96) NOT NULL,
  "scope_type" VARCHAR(32) NOT NULL,
  "scope_ref" VARCHAR(128) NOT NULL,
  "action_type" VARCHAR(96) NOT NULL,
  "target_type" VARCHAR(64) NOT NULL,
  "target_ref" VARCHAR(128) NOT NULL,
  "payload" JSONB NOT NULL,
  "idempotency_key" VARCHAR(128) NOT NULL,
  "proposer_pubkey" VARCHAR(44) NOT NULL,
  "state" VARCHAR(24) NOT NULL DEFAULT 'active',
  "opened_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "expires_at" TIMESTAMP(3),
  "resolved_at" TIMESTAMP(3),
  "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updated_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

  CONSTRAINT "governance_requests_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "governance_signals" (
  "id" VARCHAR(96) NOT NULL,
  "request_id" VARCHAR(96) NOT NULL,
  "signal_type" VARCHAR(32) NOT NULL,
  "actor_pubkey" VARCHAR(44),
  "value" VARCHAR(32) NOT NULL,
  "weight" VARCHAR(64) NOT NULL DEFAULT '1',
  "evidence" JSONB,
  "signature" VARCHAR(512),
  "signed_message" TEXT,
  "external_claim_nonce" VARCHAR(128),
  "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

  CONSTRAINT "governance_signals_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "governance_snapshots" (
  "id" VARCHAR(96) NOT NULL,
  "request_id" VARCHAR(96) NOT NULL,
  "eligible_actors" JSONB NOT NULL,
  "source_digest" CHAR(64) NOT NULL,
  "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

  CONSTRAINT "governance_snapshots_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "governance_decisions" (
  "request_id" VARCHAR(96) NOT NULL,
  "decision" VARCHAR(24) NOT NULL,
  "reason" VARCHAR(128) NOT NULL,
  "tally" JSONB NOT NULL,
  "decided_at" TIMESTAMP(3) NOT NULL,
  "executable_from" TIMESTAMP(3),
  "executable_until" TIMESTAMP(3),
  "decision_digest" CHAR(64) NOT NULL,
  "issuer_signature" VARCHAR(512),
  "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

  CONSTRAINT "governance_decisions_pkey" PRIMARY KEY ("request_id")
);

CREATE TABLE "governance_execution_receipts" (
  "id" VARCHAR(96) NOT NULL,
  "request_id" VARCHAR(96) NOT NULL,
  "action_type" VARCHAR(96) NOT NULL,
  "executor_module" VARCHAR(64) NOT NULL,
  "execution_status" VARCHAR(24) NOT NULL,
  "execution_ref" VARCHAR(128),
  "error_code" VARCHAR(64),
  "idempotency_key" VARCHAR(128) NOT NULL,
  "executed_at" TIMESTAMP(3) NOT NULL,
  "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

  CONSTRAINT "governance_execution_receipts_pkey" PRIMARY KEY ("id")
);

CREATE INDEX "governance_policies_scope_type_scope_ref_status_idx" ON "governance_policies"("scope_type", "scope_ref", "status");
CREATE UNIQUE INDEX "governance_policy_versions_policy_id_version_key" ON "governance_policy_versions"("policy_id", "version");
CREATE INDEX "governance_policy_versions_policy_id_status_idx" ON "governance_policy_versions"("policy_id", "status");
CREATE UNIQUE INDEX "governance_requests_scope_type_scope_ref_action_type_idempotency_key_key" ON "governance_requests"("scope_type", "scope_ref", "action_type", "idempotency_key");
CREATE INDEX "governance_requests_policy_id_state_opened_at_idx" ON "governance_requests"("policy_id", "state", "opened_at" DESC);
CREATE INDEX "governance_requests_scope_type_scope_ref_state_idx" ON "governance_requests"("scope_type", "scope_ref", "state");
CREATE INDEX "governance_requests_target_type_target_ref_idx" ON "governance_requests"("target_type", "target_ref");
CREATE UNIQUE INDEX "governance_signals_request_id_actor_pubkey_signal_type_key" ON "governance_signals"("request_id", "actor_pubkey", "signal_type");
CREATE UNIQUE INDEX "governance_signals_external_claim_nonce_key" ON "governance_signals"("external_claim_nonce");
CREATE INDEX "governance_signals_request_id_created_at_idx" ON "governance_signals"("request_id", "created_at");
CREATE INDEX "governance_signals_actor_pubkey_created_at_idx" ON "governance_signals"("actor_pubkey", "created_at" DESC);
CREATE UNIQUE INDEX "governance_snapshots_request_id_key" ON "governance_snapshots"("request_id");
CREATE UNIQUE INDEX "governance_decisions_decision_digest_key" ON "governance_decisions"("decision_digest");
CREATE UNIQUE INDEX "governance_execution_receipts_request_id_executor_module_idempotency_key_key" ON "governance_execution_receipts"("request_id", "executor_module", "idempotency_key");
CREATE INDEX "governance_execution_receipts_action_type_executed_at_idx" ON "governance_execution_receipts"("action_type", "executed_at" DESC);

ALTER TABLE "governance_policy_versions"
  ADD CONSTRAINT "governance_policy_versions_policy_id_fkey"
  FOREIGN KEY ("policy_id")
  REFERENCES "governance_policies"("id")
  ON DELETE CASCADE
  ON UPDATE CASCADE;

ALTER TABLE "governance_requests"
  ADD CONSTRAINT "governance_requests_policy_id_fkey"
  FOREIGN KEY ("policy_id")
  REFERENCES "governance_policies"("id")
  ON DELETE RESTRICT
  ON UPDATE CASCADE;

ALTER TABLE "governance_requests"
  ADD CONSTRAINT "governance_requests_policy_version_id_fkey"
  FOREIGN KEY ("policy_version_id")
  REFERENCES "governance_policy_versions"("id")
  ON DELETE RESTRICT
  ON UPDATE CASCADE;

ALTER TABLE "governance_signals"
  ADD CONSTRAINT "governance_signals_request_id_fkey"
  FOREIGN KEY ("request_id")
  REFERENCES "governance_requests"("id")
  ON DELETE CASCADE
  ON UPDATE CASCADE;

ALTER TABLE "governance_snapshots"
  ADD CONSTRAINT "governance_snapshots_request_id_fkey"
  FOREIGN KEY ("request_id")
  REFERENCES "governance_requests"("id")
  ON DELETE CASCADE
  ON UPDATE CASCADE;

ALTER TABLE "governance_decisions"
  ADD CONSTRAINT "governance_decisions_request_id_fkey"
  FOREIGN KEY ("request_id")
  REFERENCES "governance_requests"("id")
  ON DELETE CASCADE
  ON UPDATE CASCADE;

ALTER TABLE "governance_execution_receipts"
  ADD CONSTRAINT "governance_execution_receipts_request_id_fkey"
  FOREIGN KEY ("request_id")
  REFERENCES "governance_requests"("id")
  ON DELETE CASCADE
  ON UPDATE CASCADE;
