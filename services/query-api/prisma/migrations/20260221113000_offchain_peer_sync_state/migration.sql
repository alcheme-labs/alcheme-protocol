-- Off-chain peer sync state for cross-node discussion replication

CREATE TABLE IF NOT EXISTS offchain_peer_sync_state (
    peer_url VARCHAR(512) PRIMARY KEY,
    last_remote_lamport BIGINT NOT NULL DEFAULT 0,
    last_success_at TIMESTAMP(3),
    last_error TEXT,
    updated_at TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP
);
