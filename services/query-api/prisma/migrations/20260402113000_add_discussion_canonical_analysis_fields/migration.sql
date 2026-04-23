ALTER TABLE "circle_discussion_messages"
    ADD COLUMN IF NOT EXISTS "relevance_status" VARCHAR(16) NOT NULL DEFAULT 'ready',
    ADD COLUMN IF NOT EXISTS "embedding_score" DECIMAL(4, 3),
    ADD COLUMN IF NOT EXISTS "actual_mode" VARCHAR(32),
    ADD COLUMN IF NOT EXISTS "analysis_version" VARCHAR(32),
    ADD COLUMN IF NOT EXISTS "topic_profile_version" VARCHAR(128),
    ADD COLUMN IF NOT EXISTS "semantic_facets" JSONB NOT NULL DEFAULT '[]'::jsonb,
    ADD COLUMN IF NOT EXISTS "focus_score" DECIMAL(4, 3),
    ADD COLUMN IF NOT EXISTS "focus_label" VARCHAR(16),
    ADD COLUMN IF NOT EXISTS "analysis_completed_at" TIMESTAMP(3),
    ADD COLUMN IF NOT EXISTS "analysis_error_code" VARCHAR(64),
    ADD COLUMN IF NOT EXISTS "analysis_error_message" TEXT,
    ADD COLUMN IF NOT EXISTS "author_annotations" JSONB NOT NULL DEFAULT '[]'::jsonb;

CREATE INDEX IF NOT EXISTS "circle_discussion_messages_relevance_status_idx"
    ON "circle_discussion_messages" ("relevance_status");
