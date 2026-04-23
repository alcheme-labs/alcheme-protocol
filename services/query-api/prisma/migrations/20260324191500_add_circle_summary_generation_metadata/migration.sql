ALTER TABLE circle_summary_snapshots
    ADD COLUMN IF NOT EXISTS generation_metadata JSONB;
