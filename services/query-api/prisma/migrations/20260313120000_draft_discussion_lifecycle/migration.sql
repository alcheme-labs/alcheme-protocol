CREATE TABLE "draft_discussion_threads" (
    "id" BIGSERIAL NOT NULL,
    "draft_post_id" INTEGER NOT NULL,
    "target_type" VARCHAR(32) NOT NULL,
    "target_ref" VARCHAR(256) NOT NULL,
    "target_version" INTEGER NOT NULL DEFAULT 1,
    "state" VARCHAR(16) NOT NULL,
    "created_by" INTEGER NOT NULL,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "draft_discussion_threads_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "draft_discussion_messages" (
    "id" BIGSERIAL NOT NULL,
    "thread_id" BIGINT NOT NULL,
    "draft_post_id" INTEGER NOT NULL,
    "author_id" INTEGER NOT NULL,
    "message_type" VARCHAR(32) NOT NULL,
    "content" TEXT,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "draft_discussion_messages_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "draft_discussion_resolutions" (
    "id" BIGSERIAL NOT NULL,
    "thread_id" BIGINT NOT NULL,
    "draft_post_id" INTEGER NOT NULL,
    "from_state" VARCHAR(16) NOT NULL,
    "to_state" VARCHAR(16) NOT NULL,
    "reason" TEXT,
    "resolved_by" INTEGER NOT NULL,
    "resolved_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "draft_discussion_resolutions_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "draft_discussion_applications" (
    "id" BIGSERIAL NOT NULL,
    "thread_id" BIGINT NOT NULL,
    "draft_post_id" INTEGER NOT NULL,
    "applied_by" INTEGER NOT NULL,
    "applied_edit_anchor_id" VARCHAR(128) NOT NULL,
    "applied_snapshot_hash" CHAR(64) NOT NULL,
    "applied_draft_version" INTEGER NOT NULL,
    "reason" TEXT,
    "applied_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "draft_discussion_applications_pkey" PRIMARY KEY ("id")
);

CREATE INDEX "draft_discussion_threads_draft_post_id_updated_at_idx"
    ON "draft_discussion_threads"("draft_post_id", "updated_at" DESC);
CREATE INDEX "draft_discussion_threads_draft_post_id_state_idx"
    ON "draft_discussion_threads"("draft_post_id", "state");

CREATE INDEX "draft_discussion_messages_thread_id_created_at_idx"
    ON "draft_discussion_messages"("thread_id", "created_at" DESC);
CREATE INDEX "draft_discussion_messages_draft_post_id_created_at_idx"
    ON "draft_discussion_messages"("draft_post_id", "created_at" DESC);

CREATE INDEX "draft_discussion_resolutions_thread_id_resolved_at_idx"
    ON "draft_discussion_resolutions"("thread_id", "resolved_at" DESC);
CREATE INDEX "draft_discussion_resolutions_draft_post_id_resolved_at_idx"
    ON "draft_discussion_resolutions"("draft_post_id", "resolved_at" DESC);

CREATE INDEX "draft_discussion_applications_thread_id_applied_at_idx"
    ON "draft_discussion_applications"("thread_id", "applied_at" DESC);
CREATE INDEX "draft_discussion_applications_draft_post_id_applied_at_idx"
    ON "draft_discussion_applications"("draft_post_id", "applied_at" DESC);

ALTER TABLE "draft_discussion_threads"
    ADD CONSTRAINT "draft_discussion_threads_draft_post_id_fkey"
    FOREIGN KEY ("draft_post_id") REFERENCES "posts"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "draft_discussion_threads"
    ADD CONSTRAINT "draft_discussion_threads_created_by_fkey"
    FOREIGN KEY ("created_by") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;

ALTER TABLE "draft_discussion_messages"
    ADD CONSTRAINT "draft_discussion_messages_thread_id_fkey"
    FOREIGN KEY ("thread_id") REFERENCES "draft_discussion_threads"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "draft_discussion_messages"
    ADD CONSTRAINT "draft_discussion_messages_draft_post_id_fkey"
    FOREIGN KEY ("draft_post_id") REFERENCES "posts"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "draft_discussion_messages"
    ADD CONSTRAINT "draft_discussion_messages_author_id_fkey"
    FOREIGN KEY ("author_id") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;

ALTER TABLE "draft_discussion_resolutions"
    ADD CONSTRAINT "draft_discussion_resolutions_thread_id_fkey"
    FOREIGN KEY ("thread_id") REFERENCES "draft_discussion_threads"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "draft_discussion_resolutions"
    ADD CONSTRAINT "draft_discussion_resolutions_draft_post_id_fkey"
    FOREIGN KEY ("draft_post_id") REFERENCES "posts"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "draft_discussion_resolutions"
    ADD CONSTRAINT "draft_discussion_resolutions_resolved_by_fkey"
    FOREIGN KEY ("resolved_by") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;

ALTER TABLE "draft_discussion_applications"
    ADD CONSTRAINT "draft_discussion_applications_thread_id_fkey"
    FOREIGN KEY ("thread_id") REFERENCES "draft_discussion_threads"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "draft_discussion_applications"
    ADD CONSTRAINT "draft_discussion_applications_draft_post_id_fkey"
    FOREIGN KEY ("draft_post_id") REFERENCES "posts"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "draft_discussion_applications"
    ADD CONSTRAINT "draft_discussion_applications_applied_by_fkey"
    FOREIGN KEY ("applied_by") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;
