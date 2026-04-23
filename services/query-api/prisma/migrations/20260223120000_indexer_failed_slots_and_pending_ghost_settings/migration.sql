-- Track failed local-RPC slots for replay and alerting.
CREATE TABLE IF NOT EXISTS "indexer_failed_slots" (
  "id" BIGSERIAL PRIMARY KEY,
  "program_id" VARCHAR(44) NOT NULL,
  "slot" BIGINT NOT NULL,
  "event_source" VARCHAR(16) NOT NULL DEFAULT 'local',
  "first_failed_at" TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  "last_failed_at" TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  "last_replay_at" TIMESTAMPTZ,
  "failed_count" INTEGER NOT NULL DEFAULT 1,
  "last_error" TEXT,
  "resolved" BOOLEAN NOT NULL DEFAULT FALSE,
  "resolved_at" TIMESTAMPTZ,
  "created_at" TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  "updated_at" TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  UNIQUE ("program_id", "slot")
);

CREATE INDEX IF NOT EXISTS "idx_indexer_failed_slots_program_resolved_slot"
  ON "indexer_failed_slots" ("program_id", "resolved", "slot");

CREATE INDEX IF NOT EXISTS "idx_indexer_failed_slots_resolved_last_failed_at"
  ON "indexer_failed_slots" ("resolved", "last_failed_at");

-- Keep ghost settings before circle row is indexed (eventual consistency window).
CREATE TABLE IF NOT EXISTS "pending_circle_ghost_settings" (
  "circle_id" INTEGER PRIMARY KEY,
  "relevance_mode" VARCHAR(16),
  "summary_use_llm" BOOLEAN,
  "draft_trigger_mode" VARCHAR(24),
  "trigger_summary_use_llm" BOOLEAN,
  "trigger_generate_comment" BOOLEAN,
  "expires_at" TIMESTAMPTZ NOT NULL,
  "created_at" TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  "updated_at" TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS "idx_pending_circle_ghost_settings_expires_at"
  ON "pending_circle_ghost_settings" ("expires_at");

CREATE INDEX IF NOT EXISTS "idx_pending_circle_ghost_settings_updated_at"
  ON "pending_circle_ghost_settings" ("updated_at");
