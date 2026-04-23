ALTER TABLE "circle_discussion_messages"
ADD COLUMN IF NOT EXISTS "subject_type" VARCHAR(32);

ALTER TABLE "circle_discussion_messages"
ADD COLUMN IF NOT EXISTS "subject_id" VARCHAR(128);

CREATE INDEX IF NOT EXISTS "circle_discussion_messages_subject_type_subject_id_lamport_idx"
ON "circle_discussion_messages" ("subject_type", "subject_id", "lamport" DESC);

CREATE INDEX IF NOT EXISTS "circle_discussion_messages_circle_id_subject_type_subject_id_lampo_idx"
ON "circle_discussion_messages" ("circle_id", "subject_type", "subject_id", "lamport" DESC);
