CREATE TABLE "external_app_registry_anchors" (
  "id" VARCHAR(96) NOT NULL,
  "external_app_id" VARCHAR(64) NOT NULL,
  "app_id_hash" VARCHAR(64) NOT NULL,
  "record_pda" VARCHAR(64) NOT NULL,
  "owner_pubkey" VARCHAR(44) NOT NULL,
  "server_key_hash" VARCHAR(64) NOT NULL,
  "manifest_hash" VARCHAR(64) NOT NULL,
  "owner_assertion_hash" VARCHAR(64),
  "policy_state_digest" VARCHAR(64),
  "review_circle_id" INTEGER,
  "review_policy_digest" VARCHAR(64),
  "decision_digest" VARCHAR(64),
  "execution_intent_digest" VARCHAR(64),
  "execution_receipt_digest" VARCHAR(64),
  "registry_status" VARCHAR(24) NOT NULL,
  "tx_signature" VARCHAR(128),
  "tx_slot" BIGINT,
  "receipt_tx_signature" VARCHAR(128),
  "receipt_tx_slot" BIGINT,
  "cluster" VARCHAR(32),
  "finality_status" VARCHAR(24) NOT NULL DEFAULT 'pending',
  "receipt_finality_status" VARCHAR(24) NOT NULL DEFAULT 'pending',
  "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updated_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

  CONSTRAINT "external_app_registry_anchors_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "external_app_registry_anchors_external_app_id_key"
  ON "external_app_registry_anchors"("external_app_id");

CREATE UNIQUE INDEX "external_app_registry_anchors_app_id_hash_key"
  ON "external_app_registry_anchors"("app_id_hash");

CREATE UNIQUE INDEX "external_app_registry_anchors_record_pda_key"
  ON "external_app_registry_anchors"("record_pda");

CREATE INDEX "external_app_registry_anchors_registry_status_finality_status_idx"
  ON "external_app_registry_anchors"("registry_status", "finality_status");
