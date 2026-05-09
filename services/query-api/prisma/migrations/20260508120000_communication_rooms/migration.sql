CREATE TABLE IF NOT EXISTS "external_apps" (
    "id" VARCHAR(64) PRIMARY KEY,
    "name" VARCHAR(128) NOT NULL,
    "owner_pubkey" VARCHAR(44) NOT NULL,
    "status" VARCHAR(16) NOT NULL DEFAULT 'active',
    "server_public_key" VARCHAR(128),
    "claim_auth_mode" VARCHAR(32) NOT NULL DEFAULT 'server_ed25519',
    "allowed_origins" JSONB,
    "config" JSONB,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP
);

CREATE TABLE IF NOT EXISTS "communication_rooms" (
    "id" VARCHAR(96) PRIMARY KEY,
    "room_key" VARCHAR(96) NOT NULL,
    "external_app_id" VARCHAR(64),
    "parent_circle_id" INTEGER,
    "room_type" VARCHAR(32) NOT NULL,
    "external_room_id" VARCHAR(128),
    "lifecycle_status" VARCHAR(16) NOT NULL DEFAULT 'active',
    "knowledge_mode" VARCHAR(16) NOT NULL DEFAULT 'off',
    "transcription_mode" VARCHAR(16) NOT NULL DEFAULT 'off',
    "retention_policy" VARCHAR(32) NOT NULL DEFAULT 'ephemeral',
    "created_by_pubkey" VARCHAR(44),
    "expires_at" TIMESTAMP(3),
    "ended_at" TIMESTAMP(3),
    "metadata" JSONB,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP
);

CREATE TABLE IF NOT EXISTS "communication_room_members" (
    "room_key" VARCHAR(96) NOT NULL,
    "wallet_pubkey" VARCHAR(44) NOT NULL,
    "role" VARCHAR(16) NOT NULL DEFAULT 'member',
    "can_speak" BOOLEAN NOT NULL DEFAULT TRUE,
    "muted" BOOLEAN NOT NULL DEFAULT FALSE,
    "banned" BOOLEAN NOT NULL DEFAULT FALSE,
    "joined_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "left_at" TIMESTAMP(3),
    PRIMARY KEY ("room_key", "wallet_pubkey")
);

CREATE TABLE IF NOT EXISTS "communication_sessions" (
    "session_id" VARCHAR(64) PRIMARY KEY,
    "wallet_pubkey" VARCHAR(44) NOT NULL,
    "scope_type" VARCHAR(16) NOT NULL,
    "scope_ref" VARCHAR(128) NOT NULL,
    "issued_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "expires_at" TIMESTAMP(3) NOT NULL,
    "revoked" BOOLEAN NOT NULL DEFAULT FALSE,
    "last_seen_at" TIMESTAMP(3),
    "client_meta" JSONB,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP
);

CREATE TABLE IF NOT EXISTS "communication_messages" (
    "id" BIGSERIAL PRIMARY KEY,
    "envelope_id" VARCHAR(96) NOT NULL,
    "room_key" VARCHAR(96) NOT NULL,
    "sender_pubkey" VARCHAR(44) NOT NULL,
    "sender_handle" VARCHAR(32),
    "message_kind" VARCHAR(32) NOT NULL DEFAULT 'plain',
    "payload_text" TEXT,
    "payload_hash" CHAR(64) NOT NULL,
    "storage_uri" TEXT,
    "duration_ms" INTEGER,
    "metadata" JSONB,
    "signature" VARCHAR(512),
    "signed_message" TEXT NOT NULL,
    "signature_verified" BOOLEAN NOT NULL DEFAULT FALSE,
    "auth_mode" VARCHAR(32) NOT NULL DEFAULT 'session_token',
    "session_id" VARCHAR(64),
    "client_timestamp" TIMESTAMP(3) NOT NULL,
    "lamport" BIGSERIAL NOT NULL,
    "prev_envelope_id" VARCHAR(96),
    "deleted" BOOLEAN NOT NULL DEFAULT FALSE,
    "expires_at" TIMESTAMP(3),
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP
);

CREATE UNIQUE INDEX IF NOT EXISTS "communication_rooms_room_key_key"
    ON "communication_rooms" ("room_key");

CREATE INDEX IF NOT EXISTS "communication_rooms_external_app_id_external_room_id_idx"
    ON "communication_rooms" ("external_app_id", "external_room_id");

CREATE INDEX IF NOT EXISTS "communication_rooms_parent_circle_id_idx"
    ON "communication_rooms" ("parent_circle_id");

CREATE INDEX IF NOT EXISTS "communication_rooms_room_type_lifecycle_status_idx"
    ON "communication_rooms" ("room_type", "lifecycle_status");

CREATE INDEX IF NOT EXISTS "communication_rooms_expires_at_idx"
    ON "communication_rooms" ("expires_at");

CREATE INDEX IF NOT EXISTS "communication_room_members_wallet_pubkey_idx"
    ON "communication_room_members" ("wallet_pubkey");

CREATE INDEX IF NOT EXISTS "communication_room_members_room_key_role_idx"
    ON "communication_room_members" ("room_key", "role");

CREATE INDEX IF NOT EXISTS "communication_sessions_wallet_pubkey_idx"
    ON "communication_sessions" ("wallet_pubkey");

CREATE INDEX IF NOT EXISTS "communication_sessions_scope_type_scope_ref_idx"
    ON "communication_sessions" ("scope_type", "scope_ref");

CREATE INDEX IF NOT EXISTS "communication_sessions_expires_at_idx"
    ON "communication_sessions" ("expires_at");

CREATE UNIQUE INDEX IF NOT EXISTS "communication_messages_envelope_id_key"
    ON "communication_messages" ("envelope_id");

CREATE INDEX IF NOT EXISTS "communication_messages_room_key_lamport_idx"
    ON "communication_messages" ("room_key", "lamport" DESC);

CREATE INDEX IF NOT EXISTS "communication_messages_sender_pubkey_lamport_idx"
    ON "communication_messages" ("sender_pubkey", "lamport" DESC);

CREATE INDEX IF NOT EXISTS "communication_messages_expires_at_idx"
    ON "communication_messages" ("expires_at");

ALTER TABLE "communication_rooms"
    ADD CONSTRAINT "communication_rooms_external_app_id_fkey"
    FOREIGN KEY ("external_app_id") REFERENCES "external_apps"("id")
    ON DELETE SET NULL ON UPDATE CASCADE;

ALTER TABLE "communication_room_members"
    ADD CONSTRAINT "communication_room_members_room_key_fkey"
    FOREIGN KEY ("room_key") REFERENCES "communication_rooms"("room_key")
    ON DELETE CASCADE ON UPDATE CASCADE;
