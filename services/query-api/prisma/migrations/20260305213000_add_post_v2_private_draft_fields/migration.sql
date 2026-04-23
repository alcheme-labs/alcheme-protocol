ALTER TABLE "posts"
ADD COLUMN IF NOT EXISTS "v2_visibility_level" VARCHAR(32),
ADD COLUMN IF NOT EXISTS "v2_status" VARCHAR(32),
ADD COLUMN IF NOT EXISTS "is_v2_private" BOOLEAN NOT NULL DEFAULT FALSE,
ADD COLUMN IF NOT EXISTS "is_v2_draft" BOOLEAN NOT NULL DEFAULT FALSE;

UPDATE "posts"
SET
    "v2_visibility_level" = COALESCE("v2_visibility_level", "visibility"::text),
    "v2_status" = COALESCE("v2_status", "status"::text),
    "is_v2_private" = COALESCE("is_v2_private", FALSE) OR COALESCE("v2_visibility_level", "visibility"::text) = 'Private',
    "is_v2_draft" = COALESCE("is_v2_draft", FALSE) OR COALESCE("v2_status", "status"::text) = 'Draft';

CREATE INDEX IF NOT EXISTS "posts_v2_visibility_level_v2_status_idx"
ON "posts"("v2_visibility_level", "v2_status");
