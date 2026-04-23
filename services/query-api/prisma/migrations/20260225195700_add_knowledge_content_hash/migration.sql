-- Add content_hash column to knowledge table
-- Stores hex-encoded SHA-256 hash of the crystallized IPFS content
ALTER TABLE knowledge ADD COLUMN IF NOT EXISTS content_hash VARCHAR(64);

-- No index needed — content_hash is used for integrity verification, not querying
