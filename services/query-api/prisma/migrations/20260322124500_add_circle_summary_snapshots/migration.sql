CREATE TABLE IF NOT EXISTS circle_summary_snapshots (
    summary_id VARCHAR(128) PRIMARY KEY,
    circle_id INTEGER NOT NULL REFERENCES circles(id) ON DELETE CASCADE,
    version INTEGER NOT NULL,
    issue_map JSONB NOT NULL,
    concept_graph JSONB NOT NULL,
    viewpoint_branches JSONB NOT NULL,
    fact_explanation_emotion_breakdown JSONB NOT NULL,
    emotion_conflict_context JSONB NOT NULL,
    sedimentation_timeline JSONB NOT NULL,
    open_questions JSONB NOT NULL,
    generated_at TIMESTAMPTZ NOT NULL,
    generated_by VARCHAR(32) NOT NULL,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE UNIQUE INDEX IF NOT EXISTS circle_summary_snapshots_circle_id_version_key
    ON circle_summary_snapshots(circle_id, version);

CREATE INDEX IF NOT EXISTS circle_summary_snapshots_circle_id_generated_at_idx
    ON circle_summary_snapshots(circle_id, generated_at DESC);
