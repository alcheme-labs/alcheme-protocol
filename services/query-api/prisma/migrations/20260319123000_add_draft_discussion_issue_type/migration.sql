ALTER TABLE "draft_discussion_threads"
    ADD COLUMN "issue_type" VARCHAR(32) NOT NULL DEFAULT 'question_and_supplement';
