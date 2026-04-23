ALTER TABLE "draft_workflow_state"
    ADD COLUMN "crystallization_policy_profile_digest" CHAR(64),
    ADD COLUMN "crystallization_anchor_signature" VARCHAR(128);
