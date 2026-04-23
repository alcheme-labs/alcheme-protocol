CREATE TABLE "draft_version_snapshots" (
    "id" BIGSERIAL NOT NULL,
    "draft_post_id" INTEGER NOT NULL,
    "draft_version" INTEGER NOT NULL,
    "content_snapshot" TEXT NOT NULL,
    "content_hash" CHAR(64) NOT NULL,
    "created_from_state" VARCHAR(32) NOT NULL,
    "created_by" INTEGER,
    "source_edit_anchor_id" VARCHAR(128),
    "source_summary_hash" CHAR(64),
    "source_messages_digest" CHAR(64),
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "draft_version_snapshots_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "draft_version_snapshots_draft_post_id_draft_version_key"
    ON "draft_version_snapshots"("draft_post_id", "draft_version");

CREATE INDEX "draft_version_snapshots_draft_post_id_created_at_idx"
    ON "draft_version_snapshots"("draft_post_id", "created_at" DESC);

ALTER TABLE "draft_version_snapshots"
    ADD CONSTRAINT "draft_version_snapshots_draft_post_id_fkey"
    FOREIGN KEY ("draft_post_id") REFERENCES "posts"("id") ON DELETE CASCADE ON UPDATE CASCADE;

ALTER TABLE "draft_version_snapshots"
    ADD CONSTRAINT "draft_version_snapshots_created_by_fkey"
    FOREIGN KEY ("created_by") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;

ALTER TABLE "draft_workflow_state"
    ADD COLUMN "current_snapshot_version" INTEGER NOT NULL DEFAULT 1;
