ALTER TABLE "circle_policy_profiles"
    ADD COLUMN IF NOT EXISTS "draft_workflow_policy" JSONB;
