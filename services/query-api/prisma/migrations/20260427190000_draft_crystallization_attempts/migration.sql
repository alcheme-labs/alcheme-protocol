CREATE TABLE IF NOT EXISTS "draft_crystallization_attempts" (
    "id" BIGSERIAL PRIMARY KEY,
    "draft_post_id" INTEGER NOT NULL,
    "proof_package_hash" CHAR(64) NOT NULL,
    "knowledge_id" VARCHAR(64),
    "knowledge_on_chain_address" VARCHAR(44) NOT NULL,
    "status" VARCHAR(32) NOT NULL DEFAULT 'submitted',
    "failure_code" VARCHAR(64),
    "failure_message" TEXT,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP
);

CREATE UNIQUE INDEX IF NOT EXISTS "draft_crystallization_attempts_draft_post_id_proof_package_hash_key"
    ON "draft_crystallization_attempts" ("draft_post_id", "proof_package_hash");

CREATE INDEX IF NOT EXISTS "draft_crystallization_attempts_draft_post_id_status_idx"
    ON "draft_crystallization_attempts" ("draft_post_id", "status");
