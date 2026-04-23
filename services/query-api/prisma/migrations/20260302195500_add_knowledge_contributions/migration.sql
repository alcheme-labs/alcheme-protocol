CREATE TABLE "knowledge_contributions" (
    "id" SERIAL NOT NULL,
    "knowledge_id" INTEGER NOT NULL,
    "contributor_pubkey" VARCHAR(44) NOT NULL,
    "contributor_handle" VARCHAR(32),
    "contribution_role" VARCHAR(32) NOT NULL,
    "contribution_weight_bps" INTEGER NOT NULL,
    "contribution_weight" DECIMAL(10,4) NOT NULL,
    "source_draft_post_id" INTEGER,
    "source_anchor_id" VARCHAR(128),
    "source_payload_hash" VARCHAR(64),
    "source_summary_hash" VARCHAR(64),
    "source_messages_digest" VARCHAR(64),
    "contributors_root" VARCHAR(64),
    "contributors_count" INTEGER,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "knowledge_contributions_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "knowledge_contributions_knowledge_id_contributor_pubkey_contributio_key"
    ON "knowledge_contributions"("knowledge_id", "contributor_pubkey", "contribution_role");

CREATE INDEX "knowledge_contributions_knowledge_id_contribution_weight_idx"
    ON "knowledge_contributions"("knowledge_id", "contribution_weight" DESC);

CREATE INDEX "knowledge_contributions_contributor_pubkey_idx"
    ON "knowledge_contributions"("contributor_pubkey");

ALTER TABLE "knowledge_contributions"
    ADD CONSTRAINT "knowledge_contributions_knowledge_id_fkey"
    FOREIGN KEY ("knowledge_id") REFERENCES "knowledge"("id") ON DELETE CASCADE ON UPDATE CASCADE;
