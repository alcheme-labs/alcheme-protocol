CREATE TABLE IF NOT EXISTS ai_jobs (
    id SERIAL PRIMARY KEY,
    job_type VARCHAR(64) NOT NULL,
    dedupe_key VARCHAR(191),
    scope_type VARCHAR(16) NOT NULL,
    scope_draft_post_id INTEGER,
    scope_circle_id INTEGER,
    requested_by_user_id INTEGER,
    status VARCHAR(24) NOT NULL,
    attempts INTEGER NOT NULL DEFAULT 0,
    max_attempts INTEGER NOT NULL DEFAULT 3,
    available_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    claimed_at TIMESTAMPTZ,
    completed_at TIMESTAMPTZ,
    worker_id VARCHAR(64),
    claim_token VARCHAR(64),
    payload_json JSONB,
    result_json JSONB,
    last_error_code VARCHAR(64),
    last_error_message TEXT,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE UNIQUE INDEX IF NOT EXISTS ai_jobs_dedupe_key_key
    ON ai_jobs(dedupe_key);

CREATE INDEX IF NOT EXISTS ai_jobs_status_available_at_id_idx
    ON ai_jobs(status, available_at ASC, id ASC);

CREATE INDEX IF NOT EXISTS ai_jobs_scope_draft_created_at_idx
    ON ai_jobs(scope_type, scope_draft_post_id, created_at DESC);

CREATE INDEX IF NOT EXISTS ai_jobs_scope_circle_created_at_idx
    ON ai_jobs(scope_type, scope_circle_id, created_at DESC);

CREATE INDEX IF NOT EXISTS ai_jobs_requested_by_created_at_idx
    ON ai_jobs(requested_by_user_id, created_at DESC);
