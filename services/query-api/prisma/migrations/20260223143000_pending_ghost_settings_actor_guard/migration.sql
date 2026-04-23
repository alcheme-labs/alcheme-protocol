ALTER TABLE "pending_circle_ghost_settings"
ADD COLUMN IF NOT EXISTS "requested_by_pubkey" VARCHAR(44) NOT NULL DEFAULT '';

CREATE INDEX IF NOT EXISTS "idx_pending_circle_ghost_settings_requested_by_pubkey"
  ON "pending_circle_ghost_settings" ("requested_by_pubkey");
