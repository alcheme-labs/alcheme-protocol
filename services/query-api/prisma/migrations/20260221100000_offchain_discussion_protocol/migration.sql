-- Off-chain discussion protocol storage
-- Non-breaking additive migration

CREATE SEQUENCE IF NOT EXISTS discussion_lamport_seq
AS BIGINT
START WITH 1
INCREMENT BY 1
NO MINVALUE
NO MAXVALUE
CACHE 1;

CREATE TABLE IF NOT EXISTS circle_discussion_messages (
    id BIGSERIAL PRIMARY KEY,
    envelope_id VARCHAR(96) NOT NULL UNIQUE,
    stream_key VARCHAR(64) NOT NULL DEFAULT 'circle-discussion',
    room_key VARCHAR(64) NOT NULL,
    circle_id INTEGER NOT NULL,
    sender_pubkey VARCHAR(44) NOT NULL,
    sender_handle VARCHAR(32),
    payload_text TEXT NOT NULL,
    payload_hash CHAR(64) NOT NULL,
    nonce VARCHAR(64) NOT NULL,
    signature VARCHAR(512),
    signature_scheme VARCHAR(16) NOT NULL DEFAULT 'ed25519',
    signed_message TEXT NOT NULL,
    signature_verified BOOLEAN NOT NULL DEFAULT false,
    client_timestamp TIMESTAMP(3) NOT NULL,
    lamport BIGINT NOT NULL DEFAULT nextval('discussion_lamport_seq'),
    prev_envelope_id VARCHAR(96),
    deleted BOOLEAN NOT NULL DEFAULT false,
    tombstone_reason VARCHAR(64),
    tombstoned_at TIMESTAMP(3),
    created_at TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    updated_at TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP
);

CREATE INDEX IF NOT EXISTS idx_discussion_room_lamport
ON circle_discussion_messages(room_key, lamport DESC);

CREATE INDEX IF NOT EXISTS idx_discussion_stream_lamport
ON circle_discussion_messages(stream_key, lamport ASC);

CREATE INDEX IF NOT EXISTS idx_discussion_circle_lamport
ON circle_discussion_messages(circle_id, lamport DESC);

CREATE INDEX IF NOT EXISTS idx_discussion_sender_lamport
ON circle_discussion_messages(sender_pubkey, lamport DESC);

CREATE TABLE IF NOT EXISTS offchain_sync_watermarks (
    stream_key VARCHAR(64) PRIMARY KEY,
    last_lamport BIGINT NOT NULL DEFAULT 0,
    last_envelope_id VARCHAR(96),
    last_ingested_at TIMESTAMP(3),
    updated_at TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP
);

INSERT INTO offchain_sync_watermarks (
    stream_key,
    last_lamport,
    last_envelope_id,
    last_ingested_at,
    updated_at
) VALUES (
    'circle-discussion',
    0,
    NULL,
    NULL,
    NOW()
)
ON CONFLICT (stream_key) DO NOTHING;
