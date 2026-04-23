-- Phase 1.5: persist discussion relevance scoring metadata
ALTER TABLE circle_discussion_messages
    ADD COLUMN IF NOT EXISTS relevance_score NUMERIC(4,3) NOT NULL DEFAULT 1.000,
    ADD COLUMN IF NOT EXISTS relevance_method VARCHAR(32) NOT NULL DEFAULT 'rule';

CREATE INDEX IF NOT EXISTS idx_discussion_relevance_score
    ON circle_discussion_messages(relevance_score);
