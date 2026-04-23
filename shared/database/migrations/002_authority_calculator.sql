-- Authority Calculator 数据库迁移
-- Version: 002
-- 新增: authority_scores, anti_gaming_flags, settlement_history

BEGIN;

-- Crystal 的 PageRank authority 分数 (每 epoch 一条)
CREATE TABLE IF NOT EXISTS authority_scores (
    id SERIAL PRIMARY KEY,
    crystal_id VARCHAR(44) NOT NULL,
    score DECIMAL(10,6) NOT NULL,
    epoch INTEGER NOT NULL,
    calculated_at TIMESTAMP DEFAULT NOW(),
    UNIQUE(crystal_id, epoch)
);

CREATE INDEX IF NOT EXISTS idx_authority_scores_crystal ON authority_scores(crystal_id);
CREATE INDEX IF NOT EXISTS idx_authority_scores_epoch ON authority_scores(epoch DESC);
CREATE INDEX IF NOT EXISTS idx_authority_scores_score ON authority_scores(score DESC);

-- 反作弊标记
CREATE TABLE IF NOT EXISTS anti_gaming_flags (
    id SERIAL PRIMARY KEY,
    user_pubkey VARCHAR(44) NOT NULL,
    flag_type VARCHAR(32) NOT NULL,
    details JSONB,
    flagged_at TIMESTAMP DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_anti_gaming_flags_user ON anti_gaming_flags(user_pubkey);
CREATE INDEX IF NOT EXISTS idx_anti_gaming_flags_type ON anti_gaming_flags(flag_type);
CREATE INDEX IF NOT EXISTS idx_anti_gaming_flags_date ON anti_gaming_flags(flagged_at DESC);

-- 结算历史
CREATE TABLE IF NOT EXISTS settlement_history (
    id SERIAL PRIMARY KEY,
    crystal_id VARCHAR(44) NOT NULL,
    contributor_pubkey VARCHAR(44) NOT NULL,
    authority_score DECIMAL(10,6) NOT NULL,
    reputation_delta DECIMAL(10,6) NOT NULL,
    tx_signature VARCHAR(88),
    settled_at TIMESTAMP DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_settlement_history_crystal ON settlement_history(crystal_id);
CREATE INDEX IF NOT EXISTS idx_settlement_history_contributor ON settlement_history(contributor_pubkey);
CREATE INDEX IF NOT EXISTS idx_settlement_history_date ON settlement_history(settled_at DESC);

INSERT INTO schema_migrations (version, description)
VALUES ('002', 'Authority Calculator tables')
ON CONFLICT (version) DO NOTHING;

COMMIT;
