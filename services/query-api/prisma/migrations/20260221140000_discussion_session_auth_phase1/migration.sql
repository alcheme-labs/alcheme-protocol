-- Phase 1: discussion session auth (no per-message wallet popup)

ALTER TABLE "circle_discussion_messages"
ADD COLUMN IF NOT EXISTS "auth_mode" VARCHAR(32) NOT NULL DEFAULT 'wallet_per_message';

ALTER TABLE "circle_discussion_messages"
ADD COLUMN IF NOT EXISTS "session_id" VARCHAR(64);

CREATE INDEX IF NOT EXISTS "idx_discussion_session_id"
ON "circle_discussion_messages" ("session_id");

CREATE TABLE IF NOT EXISTS "discussion_sessions" (
    "session_id" VARCHAR(64) NOT NULL,
    "sender_pubkey" VARCHAR(44) NOT NULL,
    "sender_handle" VARCHAR(32),
    "scope" VARCHAR(64) NOT NULL DEFAULT 'circle:*',
    "issued_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "expires_at" TIMESTAMP(3) NOT NULL,
    "revoked" BOOLEAN NOT NULL DEFAULT false,
    "last_seen_at" TIMESTAMP(3),
    "client_meta" JSONB,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "discussion_sessions_pkey" PRIMARY KEY ("session_id")
);

CREATE INDEX IF NOT EXISTS "idx_discussion_sessions_sender_pubkey"
ON "discussion_sessions" ("sender_pubkey");

CREATE INDEX IF NOT EXISTS "idx_discussion_sessions_expires_at"
ON "discussion_sessions" ("expires_at");
