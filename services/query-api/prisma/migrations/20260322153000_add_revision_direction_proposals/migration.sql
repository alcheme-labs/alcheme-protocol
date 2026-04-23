CREATE TABLE IF NOT EXISTS revision_direction_proposals (
    revision_proposal_id VARCHAR(128) PRIMARY KEY,
    draft_post_id INTEGER NOT NULL,
    draft_version INTEGER NOT NULL,
    scope_type VARCHAR(32) NOT NULL,
    scope_ref TEXT NOT NULL,
    proposed_by INTEGER NULL,
    summary TEXT NOT NULL,
    acceptance_mode VARCHAR(32) NOT NULL,
    status VARCHAR(16) NOT NULL,
    accepted_by INTEGER NULL,
    accepted_at TIMESTAMPTZ NULL,
    governance_proposal_id VARCHAR(128) NULL UNIQUE,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS revision_direction_proposals_draft_version_idx
    ON revision_direction_proposals (draft_post_id, draft_version, created_at DESC);

CREATE INDEX IF NOT EXISTS revision_direction_proposals_draft_status_idx
    ON revision_direction_proposals (draft_post_id, status, created_at DESC);
