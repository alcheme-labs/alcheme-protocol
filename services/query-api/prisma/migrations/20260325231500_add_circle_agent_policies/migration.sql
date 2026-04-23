CREATE TABLE "circle_agent_policies" (
    "circle_id" INTEGER NOT NULL,
    "trigger_scope" VARCHAR(32) NOT NULL DEFAULT 'draft_only',
    "cost_discount_bps" INTEGER NOT NULL DEFAULT 0,
    "review_mode" VARCHAR(32) NOT NULL DEFAULT 'owner_review',
    "updated_by_user_id" INTEGER,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "circle_agent_policies_pkey" PRIMARY KEY ("circle_id")
);

CREATE INDEX "circle_agent_policies_updated_by_user_id_updated_at_idx"
    ON "circle_agent_policies"("updated_by_user_id", "updated_at" DESC);

ALTER TABLE "circle_agent_policies"
    ADD CONSTRAINT "circle_agent_policies_circle_id_fkey"
    FOREIGN KEY ("circle_id") REFERENCES "circles"("id")
    ON DELETE CASCADE ON UPDATE CASCADE;

ALTER TABLE "circle_agent_policies"
    ADD CONSTRAINT "circle_agent_policies_updated_by_user_id_fkey"
    FOREIGN KEY ("updated_by_user_id") REFERENCES "users"("id")
    ON DELETE SET NULL ON UPDATE CASCADE;
