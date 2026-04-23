ALTER TABLE "circle_discussion_messages"
    ADD COLUMN IF NOT EXISTS "is_featured" BOOLEAN NOT NULL DEFAULT FALSE,
    ADD COLUMN IF NOT EXISTS "feature_reason" VARCHAR(240),
    ADD COLUMN IF NOT EXISTS "featured_at" TIMESTAMP(3);

CREATE INDEX IF NOT EXISTS "circle_discussion_messages_circle_id_is_featured_featured_at_idx"
    ON "circle_discussion_messages" ("circle_id", "is_featured", "featured_at" DESC);
