ALTER TABLE "ghost_draft_acceptances"
ADD COLUMN "accepted_suggestion_id" VARCHAR(191),
ADD COLUMN "accepted_thread_ids" JSONB;
