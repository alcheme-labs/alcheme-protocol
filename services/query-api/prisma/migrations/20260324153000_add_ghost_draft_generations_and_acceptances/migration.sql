CREATE TABLE IF NOT EXISTS ghost_draft_generations (
    id SERIAL PRIMARY KEY,
    draft_post_id INTEGER NOT NULL REFERENCES posts(id) ON DELETE CASCADE,
    requested_by_user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    origin VARCHAR(16) NOT NULL,
    provider_mode VARCHAR(16) NOT NULL,
    model VARCHAR(128) NOT NULL,
    prompt_asset VARCHAR(64) NOT NULL,
    prompt_version VARCHAR(32) NOT NULL,
    source_digest CHAR(64) NOT NULL,
    ghost_run_id INTEGER,
    ai_job_id INTEGER,
    draft_text TEXT NOT NULL,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS ghost_draft_generations_draft_post_id_created_at_idx
    ON ghost_draft_generations(draft_post_id, created_at DESC);

CREATE INDEX IF NOT EXISTS ghost_draft_generations_requested_by_user_id_created_at_idx
    ON ghost_draft_generations(requested_by_user_id, created_at DESC);

CREATE INDEX IF NOT EXISTS ghost_draft_generations_ghost_run_id_created_at_idx
    ON ghost_draft_generations(ghost_run_id, created_at DESC);

CREATE TABLE IF NOT EXISTS ghost_draft_acceptances (
    id SERIAL PRIMARY KEY,
    ghost_draft_generation_id INTEGER NOT NULL REFERENCES ghost_draft_generations(id) ON DELETE CASCADE,
    draft_post_id INTEGER NOT NULL REFERENCES posts(id) ON DELETE CASCADE,
    accepted_by_user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    acceptance_mode VARCHAR(32) NOT NULL,
    request_working_copy_hash CHAR(64),
    request_working_copy_updated_at TIMESTAMPTZ,
    resulting_working_copy_hash CHAR(64) NOT NULL,
    changed BOOLEAN NOT NULL DEFAULT TRUE,
    accepted_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS ghost_draft_acceptances_generation_id_accepted_at_idx
    ON ghost_draft_acceptances(ghost_draft_generation_id, accepted_at DESC);

CREATE INDEX IF NOT EXISTS ghost_draft_acceptances_draft_post_id_accepted_at_idx
    ON ghost_draft_acceptances(draft_post_id, accepted_at DESC);

CREATE INDEX IF NOT EXISTS ghost_draft_acceptances_accepted_by_user_id_accepted_at_idx
    ON ghost_draft_acceptances(accepted_by_user_id, accepted_at DESC);
