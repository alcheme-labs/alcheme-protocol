ALTER TABLE "posts"
ADD COLUMN IF NOT EXISTS "v2_audience_kind" VARCHAR(32),
ADD COLUMN IF NOT EXISTS "v2_audience_ref" INTEGER;

CREATE INDEX IF NOT EXISTS "posts_v2_audience_kind_v2_audience_ref_idx"
ON "posts" ("v2_audience_kind", "v2_audience_ref");
