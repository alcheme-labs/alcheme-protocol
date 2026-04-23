CREATE TABLE "draft_workflow_state" (
    "draft_post_id" INTEGER NOT NULL,
    "circle_id" INTEGER,
    "document_status" VARCHAR(32) NOT NULL,
    "current_round" INTEGER NOT NULL DEFAULT 1,
    "review_entry_mode" VARCHAR(32) NOT NULL DEFAULT 'auto_or_manual',
    "drafting_started_at" TIMESTAMP(3),
    "drafting_ends_at" TIMESTAMP(3),
    "review_started_at" TIMESTAMP(3),
    "review_ends_at" TIMESTAMP(3),
    "transition_mode" VARCHAR(32),
    "last_transition_at" TIMESTAMP(3),
    "last_transition_by" INTEGER,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "draft_workflow_state_pkey" PRIMARY KEY ("draft_post_id")
);

CREATE INDEX "draft_workflow_state_circle_id_document_status_idx"
    ON "draft_workflow_state"("circle_id", "document_status");
CREATE INDEX "draft_workflow_state_drafting_ends_at_idx"
    ON "draft_workflow_state"("drafting_ends_at" ASC);
CREATE INDEX "draft_workflow_state_review_ends_at_idx"
    ON "draft_workflow_state"("review_ends_at" ASC);

ALTER TABLE "draft_workflow_state"
    ADD CONSTRAINT "draft_workflow_state_draft_post_id_fkey"
    FOREIGN KEY ("draft_post_id") REFERENCES "posts"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "draft_workflow_state"
    ADD CONSTRAINT "draft_workflow_state_circle_id_fkey"
    FOREIGN KEY ("circle_id") REFERENCES "circles"("id") ON DELETE SET NULL ON UPDATE CASCADE;
ALTER TABLE "draft_workflow_state"
    ADD CONSTRAINT "draft_workflow_state_last_transition_by_fkey"
    FOREIGN KEY ("last_transition_by") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;
