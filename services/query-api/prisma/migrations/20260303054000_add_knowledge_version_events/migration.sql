CREATE TABLE IF NOT EXISTS knowledge_version_events (
    id BIGSERIAL PRIMARY KEY,
    knowledge_id VARCHAR(64) NOT NULL,
    event_type VARCHAR(32) NOT NULL,
    version INTEGER NOT NULL,
    actor_pubkey VARCHAR(44),
    contributors_count INTEGER,
    contributors_root VARCHAR(64),
    source_event_timestamp BIGINT NOT NULL,
    event_at TIMESTAMP(3) NOT NULL,
    created_at TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP
);

CREATE UNIQUE INDEX IF NOT EXISTS knowledge_version_events_identity_key
    ON knowledge_version_events (knowledge_id, event_type, version, source_event_timestamp);

CREATE INDEX IF NOT EXISTS knowledge_version_events_knowledge_event_at_idx
    ON knowledge_version_events (knowledge_id, event_at DESC);

CREATE INDEX IF NOT EXISTS knowledge_version_events_event_type_event_at_idx
    ON knowledge_version_events (event_type, event_at DESC);
