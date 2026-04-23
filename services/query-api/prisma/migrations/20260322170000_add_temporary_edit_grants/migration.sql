CREATE TABLE IF NOT EXISTS temporary_edit_grants (
    grant_id VARCHAR(128) PRIMARY KEY,
    draft_post_id INTEGER NOT NULL,
    block_id VARCHAR(128) NOT NULL,
    grantee_user_id INTEGER NOT NULL,
    requested_by INTEGER NOT NULL,
    granted_by INTEGER NULL,
    revoked_by INTEGER NULL,
    approval_mode VARCHAR(32) NOT NULL,
    status VARCHAR(16) NOT NULL,
    governance_proposal_id VARCHAR(128) NULL,
    request_note TEXT NULL,
    expires_at TIMESTAMPTZ NULL,
    requested_at TIMESTAMPTZ NOT NULL,
    granted_at TIMESTAMPTZ NULL,
    revoked_at TIMESTAMPTZ NULL,
    updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS temporary_edit_grants_draft_block_idx
    ON temporary_edit_grants (draft_post_id, block_id, requested_at DESC);

CREATE INDEX IF NOT EXISTS temporary_edit_grants_draft_user_status_idx
    ON temporary_edit_grants (draft_post_id, grantee_user_id, status, requested_at DESC);
