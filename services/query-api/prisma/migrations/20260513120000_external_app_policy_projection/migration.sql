ALTER TABLE "external_apps"
  ADD COLUMN "environment" VARCHAR(32) NOT NULL DEFAULT 'sandbox',
  ADD COLUMN "registry_status" VARCHAR(24) NOT NULL DEFAULT 'pending',
  ADD COLUMN "discovery_status" VARCHAR(24) NOT NULL DEFAULT 'unlisted',
  ADD COLUMN "managed_node_policy" VARCHAR(32) NOT NULL DEFAULT 'restricted',
  ADD COLUMN "capability_policies" JSONB,
  ADD COLUMN "manifest_hash" VARCHAR(128),
  ADD COLUMN "allowed_origins_digest" VARCHAR(128),
  ADD COLUMN "review_circle_id" INTEGER,
  ADD COLUMN "review_policy_id" VARCHAR(96),
  ADD COLUMN "quota_policy" JSONB,
  ADD COLUMN "trust_score" VARCHAR(64),
  ADD COLUMN "risk_score" VARCHAR(64),
  ADD COLUMN "owner_bond" VARCHAR(64),
  ADD COLUMN "community_backing_level" VARCHAR(64),
  ADD COLUMN "expires_at" TIMESTAMP(3),
  ADD COLUMN "revoked_at" TIMESTAMP(3);

CREATE INDEX "external_apps_environment_registry_status_idx"
  ON "external_apps"("environment", "registry_status");
CREATE INDEX "external_apps_discovery_status_managed_node_policy_idx"
  ON "external_apps"("discovery_status", "managed_node_policy");
CREATE INDEX "external_apps_review_circle_id_idx"
  ON "external_apps"("review_circle_id");

CREATE TABLE "external_app_backings" (
  "id" VARCHAR(96) NOT NULL,
  "external_app_id" VARCHAR(64) NOT NULL,
  "backer_pubkey" VARCHAR(44) NOT NULL,
  "amount_raw" VARCHAR(64) NOT NULL,
  "risk_tier" VARCHAR(24) NOT NULL DEFAULT 'standard',
  "status" VARCHAR(24) NOT NULL DEFAULT 'active',
  "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updated_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "external_app_backings_pkey" PRIMARY KEY ("id")
);

CREATE INDEX "external_app_backings_external_app_id_status_idx"
  ON "external_app_backings"("external_app_id", "status");
CREATE INDEX "external_app_backings_backer_pubkey_status_idx"
  ON "external_app_backings"("backer_pubkey", "status");

CREATE TABLE "external_app_challenges" (
  "id" VARCHAR(96) NOT NULL,
  "external_app_id" VARCHAR(64) NOT NULL,
  "challenger_pubkey" VARCHAR(44) NOT NULL,
  "challenge_type" VARCHAR(32) NOT NULL,
  "amount_raw" VARCHAR(64) NOT NULL,
  "evidence_hash" VARCHAR(128) NOT NULL,
  "status" VARCHAR(24) NOT NULL DEFAULT 'open',
  "governance_request_id" VARCHAR(96),
  "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updated_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "external_app_challenges_pkey" PRIMARY KEY ("id")
);

CREATE INDEX "external_app_challenges_external_app_id_status_idx"
  ON "external_app_challenges"("external_app_id", "status");
CREATE INDEX "external_app_challenges_challenger_pubkey_status_idx"
  ON "external_app_challenges"("challenger_pubkey", "status");
CREATE INDEX "external_app_challenges_governance_request_id_idx"
  ON "external_app_challenges"("governance_request_id");

CREATE TABLE "external_nodes" (
  "id" VARCHAR(96) NOT NULL,
  "operator_pubkey" VARCHAR(44) NOT NULL,
  "node_type" VARCHAR(32) NOT NULL,
  "service_url" TEXT NOT NULL,
  "capabilities_digest" VARCHAR(128),
  "protocol_version" VARCHAR(32),
  "sync_status" VARCHAR(24) NOT NULL DEFAULT 'unknown',
  "conformance_status" VARCHAR(24) NOT NULL DEFAULT 'unknown',
  "node_trust_score" VARCHAR(64),
  "node_policy_status" VARCHAR(32) NOT NULL DEFAULT 'normal',
  "node_stake" VARCHAR(64),
  "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updated_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "external_nodes_pkey" PRIMARY KEY ("id")
);

CREATE INDEX "external_nodes_operator_pubkey_node_policy_status_idx"
  ON "external_nodes"("operator_pubkey", "node_policy_status");
CREATE INDEX "external_nodes_sync_status_conformance_status_idx"
  ON "external_nodes"("sync_status", "conformance_status");
