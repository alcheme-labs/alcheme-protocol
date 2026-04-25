CREATE TABLE "draft_candidate_generation_attempts" (
    "id" SERIAL NOT NULL,
    "circle_id" INTEGER NOT NULL,
    "candidate_id" VARCHAR(64) NOT NULL,
    "source_messages_digest" CHAR(64) NOT NULL,
    "status" VARCHAR(32) NOT NULL,
    "draft_post_id" INTEGER,
    "attempted_by_user_id" INTEGER,
    "claim_token" VARCHAR(64),
    "claimed_until" TIMESTAMP(3),
    "attempt_count" INTEGER NOT NULL DEFAULT 0,
    "source_message_ids" JSONB NOT NULL DEFAULT '[]',
    "source_semantic_facets" JSONB NOT NULL DEFAULT '[]',
    "source_author_annotations" JSONB NOT NULL DEFAULT '[]',
    "last_proposal_id" VARCHAR(128),
    "summary_method" VARCHAR(32),
    "draft_generation_method" VARCHAR(32),
    "draft_generation_error" VARCHAR(128),
    "draft_generation_diagnostics" JSONB,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "draft_candidate_generation_attempts_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "draft_candidate_generation_attempts_circle_id_candidate_id_source_messages_digest_key"
    ON "draft_candidate_generation_attempts"("circle_id", "candidate_id", "source_messages_digest");

CREATE INDEX "draft_candidate_generation_attempts_circle_id_status_updated_at_idx"
    ON "draft_candidate_generation_attempts"("circle_id", "status", "updated_at" DESC);

CREATE INDEX "draft_candidate_generation_attempts_draft_post_id_idx"
    ON "draft_candidate_generation_attempts"("draft_post_id");

CREATE INDEX "draft_candidate_generation_attempts_attempted_by_user_id_updated_at_idx"
    ON "draft_candidate_generation_attempts"("attempted_by_user_id", "updated_at" DESC);

ALTER TABLE "draft_candidate_generation_attempts"
    ADD CONSTRAINT "draft_candidate_generation_attempts_circle_id_fkey"
    FOREIGN KEY ("circle_id") REFERENCES "circles"("id") ON DELETE CASCADE ON UPDATE CASCADE;

ALTER TABLE "draft_candidate_generation_attempts"
    ADD CONSTRAINT "draft_candidate_generation_attempts_draft_post_id_fkey"
    FOREIGN KEY ("draft_post_id") REFERENCES "posts"("id") ON DELETE SET NULL ON UPDATE CASCADE;

ALTER TABLE "draft_candidate_generation_attempts"
    ADD CONSTRAINT "draft_candidate_generation_attempts_attempted_by_user_id_fkey"
    FOREIGN KEY ("attempted_by_user_id") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;
