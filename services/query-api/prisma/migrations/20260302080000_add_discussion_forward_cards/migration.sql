ALTER TABLE "circle_discussion_messages"
ADD COLUMN IF NOT EXISTS "message_kind" VARCHAR(32) NOT NULL DEFAULT 'plain';

ALTER TABLE "circle_discussion_messages"
ADD COLUMN IF NOT EXISTS "metadata" JSONB;

CREATE INDEX IF NOT EXISTS "circle_discussion_messages_circle_id_message_kind_lamport_idx"
ON "circle_discussion_messages" ("circle_id", "message_kind", "lamport" DESC);

CREATE INDEX IF NOT EXISTS "circle_discussion_messages_subject_type_subject_id_message_kind_l_idx"
ON "circle_discussion_messages" ("subject_type", "subject_id", "message_kind", "lamport" DESC);
