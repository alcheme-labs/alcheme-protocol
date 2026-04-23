ALTER TABLE circle_discussion_messages
    ADD COLUMN IF NOT EXISTS is_ephemeral BOOLEAN NOT NULL DEFAULT FALSE;

ALTER TABLE circle_discussion_messages
    ADD COLUMN IF NOT EXISTS expires_at TIMESTAMP(3);

CREATE INDEX IF NOT EXISTS idx_discussion_circle_ephemeral_lamport
    ON circle_discussion_messages(circle_id, is_ephemeral, lamport DESC);

CREATE INDEX IF NOT EXISTS idx_discussion_ephemeral_expires_at
    ON circle_discussion_messages(is_ephemeral, expires_at);
