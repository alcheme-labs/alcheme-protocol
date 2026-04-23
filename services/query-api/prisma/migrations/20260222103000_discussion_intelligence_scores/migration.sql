-- Phase 1.8: split discussion intelligence scores into semantic/quality/spam/confidence
ALTER TABLE circle_discussion_messages
    ADD COLUMN IF NOT EXISTS semantic_score NUMERIC(4,3),
    ADD COLUMN IF NOT EXISTS quality_score NUMERIC(4,3),
    ADD COLUMN IF NOT EXISTS spam_score NUMERIC(4,3),
    ADD COLUMN IF NOT EXISTS decision_confidence NUMERIC(4,3);

CREATE INDEX IF NOT EXISTS idx_discussion_semantic_score
    ON circle_discussion_messages(semantic_score);

CREATE INDEX IF NOT EXISTS idx_discussion_spam_score
    ON circle_discussion_messages(spam_score);
