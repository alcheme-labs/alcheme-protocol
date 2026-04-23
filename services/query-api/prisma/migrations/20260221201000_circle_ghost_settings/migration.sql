-- Phase 1.7: per-circle ghost policy settings

CREATE TABLE IF NOT EXISTS "circle_ghost_settings" (
    "circle_id" INTEGER NOT NULL,
    "relevance_mode" VARCHAR(16),
    "summary_use_llm" BOOLEAN,
    "draft_trigger_mode" VARCHAR(24),
    "trigger_summary_use_llm" BOOLEAN,
    "trigger_generate_comment" BOOLEAN,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "circle_ghost_settings_pkey" PRIMARY KEY ("circle_id")
);

CREATE INDEX IF NOT EXISTS "idx_circle_ghost_settings_updated_at"
ON "circle_ghost_settings" ("updated_at" DESC);
