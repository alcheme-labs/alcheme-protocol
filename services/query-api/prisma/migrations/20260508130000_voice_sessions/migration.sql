CREATE TABLE "voice_sessions" (
  "id" VARCHAR(96) NOT NULL,
  "room_key" VARCHAR(96) NOT NULL,
  "provider" VARCHAR(24) NOT NULL DEFAULT 'livekit',
  "provider_room_id" VARCHAR(128) NOT NULL,
  "status" VARCHAR(16) NOT NULL DEFAULT 'active',
  "created_by_pubkey" VARCHAR(44) NOT NULL,
  "started_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "ended_at" TIMESTAMP(3),
  "expires_at" TIMESTAMP(3),
  "metadata" JSONB,
  "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updated_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

  CONSTRAINT "voice_sessions_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "voice_participants" (
  "session_id" VARCHAR(96) NOT NULL,
  "wallet_pubkey" VARCHAR(44) NOT NULL,
  "role" VARCHAR(16) NOT NULL DEFAULT 'speaker',
  "joined_at" TIMESTAMP(3),
  "left_at" TIMESTAMP(3),
  "muted_by_self" BOOLEAN NOT NULL DEFAULT false,
  "muted_by_moderator" BOOLEAN NOT NULL DEFAULT false,

  CONSTRAINT "voice_participants_pkey" PRIMARY KEY ("session_id", "wallet_pubkey")
);

CREATE INDEX "voice_sessions_room_key_status_idx" ON "voice_sessions"("room_key", "status");
CREATE INDEX "voice_sessions_provider_provider_room_id_idx" ON "voice_sessions"("provider", "provider_room_id");
CREATE INDEX "voice_sessions_expires_at_idx" ON "voice_sessions"("expires_at");
CREATE INDEX "voice_participants_wallet_pubkey_idx" ON "voice_participants"("wallet_pubkey");

ALTER TABLE "voice_sessions"
  ADD CONSTRAINT "voice_sessions_room_key_fkey"
  FOREIGN KEY ("room_key")
  REFERENCES "communication_rooms"("room_key")
  ON DELETE CASCADE
  ON UPDATE CASCADE;

ALTER TABLE "voice_participants"
  ADD CONSTRAINT "voice_participants_session_id_fkey"
  FOREIGN KEY ("session_id")
  REFERENCES "voice_sessions"("id")
  ON DELETE CASCADE
  ON UPDATE CASCADE;
