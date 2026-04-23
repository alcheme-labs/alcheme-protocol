CREATE TABLE IF NOT EXISTS "circle_policy_profiles" (
    "circle_id" INTEGER NOT NULL,
    "source_type" VARCHAR(32),
    "inheritance_mode" VARCHAR(32),
    "inherits_from_profile_id" VARCHAR(128),
    "inherits_from_circle_id" INTEGER,
    "draft_generation_policy" JSONB,
    "draft_lifecycle_template" JSONB,
    "block_edit_eligibility_policy" JSONB,
    "fork_policy" JSONB,
    "ghost_policy" JSONB,
    "local_editability" VARCHAR(16),
    "effective_from" TIMESTAMPTZ,
    "resolved_from_profile_version" INTEGER,
    "config_version" INTEGER NOT NULL DEFAULT 1,
    "updated_by" INTEGER,
    "created_at" TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    "updated_at" TIMESTAMPTZ NOT NULL DEFAULT NOW(),

    CONSTRAINT "circle_policy_profiles_pkey" PRIMARY KEY ("circle_id")
);

CREATE INDEX IF NOT EXISTS "circle_policy_profiles_effective_from_idx"
    ON "circle_policy_profiles"("effective_from" DESC);
