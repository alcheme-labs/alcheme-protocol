ALTER TABLE "knowledge"
ADD COLUMN IF NOT EXISTS "heat_score" DECIMAL(10,4) NOT NULL DEFAULT 0;

UPDATE "knowledge" AS k
SET "heat_score" = p."heat_score"
FROM "posts" AS p
WHERE k."source_content_id" IS NOT NULL
  AND k."source_content_id" = p."content_id"
  AND k."heat_score" = 0;
