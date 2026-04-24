CREATE TYPE "CircleLifecycleStatus" AS ENUM ('Active', 'Archived');

ALTER TABLE "circles"
ADD COLUMN "lifecycle_status" "CircleLifecycleStatus" NOT NULL DEFAULT 'Active',
ADD COLUMN "archived_at" TIMESTAMP(3),
ADD COLUMN "archived_by_pubkey" VARCHAR(44),
ADD COLUMN "archive_reason" TEXT;

CREATE INDEX "circles_lifecycle_status_idx" ON "circles"("lifecycle_status");
