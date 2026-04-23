CREATE TABLE IF NOT EXISTS "discussion_message_highlights" (
    "envelope_id" VARCHAR(96) NOT NULL,
    "user_id" INTEGER NOT NULL,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "discussion_message_highlights_pkey" PRIMARY KEY ("envelope_id", "user_id"),
    CONSTRAINT "discussion_message_highlights_envelope_id_fkey"
        FOREIGN KEY ("envelope_id") REFERENCES "circle_discussion_messages" ("envelope_id")
        ON DELETE CASCADE ON UPDATE CASCADE,
    CONSTRAINT "discussion_message_highlights_user_id_fkey"
        FOREIGN KEY ("user_id") REFERENCES "users" ("id")
        ON DELETE CASCADE ON UPDATE CASCADE
);

CREATE INDEX IF NOT EXISTS "discussion_message_highlights_user_id_idx"
    ON "discussion_message_highlights" ("user_id");
