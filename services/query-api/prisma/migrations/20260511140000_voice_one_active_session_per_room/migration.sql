WITH ranked AS (
  SELECT
    id,
    ROW_NUMBER() OVER (
      PARTITION BY room_key
      ORDER BY created_at DESC, id DESC
    ) AS rn
  FROM voice_sessions
  WHERE status = 'active'
    AND ended_at IS NULL
)
UPDATE voice_sessions
SET
  status = 'ended',
  ended_at = COALESCE(ended_at, NOW()),
  updated_at = NOW()
WHERE id IN (
  SELECT id
  FROM ranked
  WHERE rn > 1
);

CREATE UNIQUE INDEX IF NOT EXISTS voice_sessions_one_active_room_idx
  ON voice_sessions (room_key)
  WHERE status = 'active'
    AND ended_at IS NULL;
