-- Phase 1.6: ghost orchestration audit trail

CREATE TABLE IF NOT EXISTS "ghost_runs" (
    "id" BIGSERIAL PRIMARY KEY,
    "run_kind" VARCHAR(64) NOT NULL,
    "status" VARCHAR(16) NOT NULL,
    "circle_id" INTEGER NOT NULL,
    "reason" VARCHAR(64) NOT NULL,
    "window_size" INTEGER NOT NULL,
    "message_count" INTEGER,
    "focused_count" INTEGER,
    "focused_ratio" NUMERIC(5,4),
    "min_messages" INTEGER NOT NULL,
    "min_question_count" INTEGER NOT NULL,
    "min_focused_ratio" NUMERIC(5,4) NOT NULL,
    "question_count" INTEGER,
    "summary_method" VARCHAR(32),
    "summary_preview" TEXT,
    "draft_post_id" INTEGER,
    "metadata" JSONB,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP
);

CREATE INDEX IF NOT EXISTS "idx_ghost_runs_kind_created_at"
ON "ghost_runs" ("run_kind", "created_at" DESC);

CREATE INDEX IF NOT EXISTS "idx_ghost_runs_circle_created_at"
ON "ghost_runs" ("circle_id", "created_at" DESC);

CREATE INDEX IF NOT EXISTS "idx_ghost_runs_status_created_at"
ON "ghost_runs" ("status", "created_at" DESC);
