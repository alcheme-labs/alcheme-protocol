use anyhow::Result;
use sqlx::{PgPool, Row};
use tracing::debug;

pub struct CheckpointManager {
    pool: PgPool,
    program_id: String,
    program_name: String,
}

#[derive(Debug, Clone, PartialEq, Eq)]
pub struct ProgramCursor {
    pub program_id: String,
    pub listener_mode: String,
    pub last_signature: Option<String>,
    pub last_processed_slot: u64,
}

impl CheckpointManager {
    pub fn new(pool: PgPool, program_id: String, program_name: String) -> Self {
        Self {
            pool,
            program_id,
            program_name,
        }
    }

    pub async fn get_last_processed_slot(&self) -> Result<Option<u64>> {
        let result = sqlx::query!(
            r#"
            SELECT last_processed_slot
            FROM sync_checkpoints
            WHERE program_id = $1
            "#,
            self.program_id
        )
        .fetch_optional(&self.pool)
        .await?;

        Ok(result.map(|r| r.last_processed_slot as u64))
    }

    pub async fn update(&self, slot: u64) -> Result<()> {
        sqlx::query!(
            r#"
            INSERT INTO sync_checkpoints 
              (program_id, program_name, last_processed_slot, total_events_processed)
            VALUES ($1, $2, $3, 1)
            ON CONFLICT (program_id) DO UPDATE SET
              last_processed_slot = GREATEST(
                sync_checkpoints.last_processed_slot, 
                EXCLUDED.last_processed_slot
              ),
              total_events_processed = sync_checkpoints.total_events_processed + 1,
              last_successful_sync = NOW(),
              updated_at = NOW()
            "#,
            self.program_id,
            self.program_name,
            slot as i64
        )
        .execute(&self.pool)
        .await?;

        debug!("Updated checkpoint to slot: {}", slot);
        Ok(())
    }

    pub async fn get_sync_stats(&self) -> Result<SyncStats> {
        let stats = sqlx::query_as!(
            SyncStats,
            r#"
            SELECT 
              last_processed_slot,
              total_events_processed,
              last_successful_sync::text as "last_successful_sync?"
            FROM sync_checkpoints
            WHERE program_id = $1
            "#,
            self.program_id
        )
        .fetch_one(&self.pool)
        .await?;

        Ok(stats)
    }

    pub async fn mark_failed_slot(&self, slot: u64, event_source: &str, error_message: &str) -> Result<()> {
        let normalized_error = truncate_error_message(error_message, 4000);
        sqlx::query(
            r#"
            INSERT INTO indexer_failed_slots (
                program_id,
                slot,
                event_source,
                first_failed_at,
                last_failed_at,
                failed_count,
                last_error,
                resolved,
                resolved_at,
                updated_at
            )
            VALUES ($1, $2, $3, NOW(), NOW(), 1, $4, FALSE, NULL, NOW())
            ON CONFLICT (program_id, slot) DO UPDATE SET
                event_source = EXCLUDED.event_source,
                last_failed_at = NOW(),
                failed_count = indexer_failed_slots.failed_count + 1,
                last_error = EXCLUDED.last_error,
                resolved = FALSE,
                resolved_at = NULL,
                updated_at = NOW()
            "#,
        )
        .bind(&self.program_id)
        .bind(slot as i64)
        .bind(event_source)
        .bind(normalized_error)
        .execute(&self.pool)
        .await?;

        Ok(())
    }

    pub async fn resolve_failed_slot(&self, slot: u64) -> Result<()> {
        sqlx::query(
            r#"
            UPDATE indexer_failed_slots
            SET
                resolved = TRUE,
                resolved_at = NOW(),
                last_replay_at = NOW(),
                last_error = NULL,
                updated_at = NOW()
            WHERE program_id = $1
              AND slot = $2
              AND resolved = FALSE
            "#,
        )
        .bind(&self.program_id)
        .bind(slot as i64)
        .execute(&self.pool)
        .await?;

        Ok(())
    }

    pub async fn list_pending_failed_slots(&self, limit: u32) -> Result<Vec<u64>> {
        let rows = sqlx::query(
            r#"
            SELECT slot
            FROM indexer_failed_slots
            WHERE program_id = $1
              AND resolved = FALSE
            ORDER BY slot ASC
            LIMIT $2
            "#,
        )
        .bind(&self.program_id)
        .bind(limit as i64)
        .fetch_all(&self.pool)
        .await?;

        let mut slots = Vec::with_capacity(rows.len());
        for row in rows {
            let slot: i64 = row.try_get("slot")?;
            if slot >= 0 {
                slots.push(slot as u64);
            }
        }

        Ok(slots)
    }

    pub async fn pending_failed_slot_stats(&self) -> Result<PendingFailedSlotStats> {
        let row = sqlx::query(
            r#"
            SELECT
              COUNT(*)::bigint AS pending_count,
              EXTRACT(EPOCH FROM (NOW() - MIN(first_failed_at)))::bigint AS oldest_age_seconds
            FROM indexer_failed_slots
            WHERE program_id = $1
              AND resolved = FALSE
            "#,
        )
        .bind(&self.program_id)
        .fetch_one(&self.pool)
        .await?;

        let pending_count: i64 = row.try_get("pending_count")?;
        let oldest_age_seconds: Option<i64> = row.try_get("oldest_age_seconds")?;

        Ok(PendingFailedSlotStats {
            pending_count: pending_count.max(0) as u64,
            oldest_age_seconds: oldest_age_seconds
                .and_then(|age| if age >= 0 { Some(age as u64) } else { None }),
        })
    }

    pub async fn prune_resolved_failed_slots(&self, retention_seconds: u64, limit: u32) -> Result<u64> {
        let result = sqlx::query(
            r#"
            WITH candidate AS (
                SELECT ctid
                FROM indexer_failed_slots
                WHERE program_id = $1
                  AND resolved = TRUE
                  AND resolved_at IS NOT NULL
                  AND resolved_at < NOW() - ($2::bigint * INTERVAL '1 second')
                ORDER BY resolved_at ASC
                LIMIT $3
            )
            DELETE FROM indexer_failed_slots t
            USING candidate c
            WHERE t.ctid = c.ctid
            "#,
        )
        .bind(&self.program_id)
        .bind(retention_seconds as i64)
        .bind(limit as i64)
        .execute(&self.pool)
        .await?;

        Ok(result.rows_affected())
    }

    pub async fn get_program_cursor(
        &self,
        program_id: &str,
        listener_mode: &str,
    ) -> Result<Option<ProgramCursor>> {
        let row = sqlx::query(
            r#"
            SELECT program_id, listener_mode, last_signature, last_processed_slot
            FROM indexer_program_cursors
            WHERE program_id = $1
              AND listener_mode = $2
            "#,
        )
        .bind(program_id)
        .bind(listener_mode)
        .fetch_optional(&self.pool)
        .await?;

        Ok(row.map(program_cursor_from_row).transpose()?)
    }

    pub async fn upsert_program_cursor(
        &self,
        program_id: &str,
        listener_mode: &str,
        last_signature: Option<&str>,
        last_processed_slot: u64,
    ) -> Result<()> {
        sqlx::query(
            r#"
            INSERT INTO indexer_program_cursors (
                program_id,
                listener_mode,
                last_signature,
                last_processed_slot,
                updated_at
            )
            VALUES ($1, $2, $3, $4, NOW())
            ON CONFLICT (program_id, listener_mode) DO UPDATE SET
                last_signature = EXCLUDED.last_signature,
                last_processed_slot = EXCLUDED.last_processed_slot,
                updated_at = NOW()
            "#,
        )
        .bind(program_id)
        .bind(listener_mode)
        .bind(last_signature)
        .bind(last_processed_slot as i64)
        .execute(&self.pool)
        .await?;

        Ok(())
    }

    pub async fn clear_program_cursor(&self, program_id: &str, listener_mode: &str) -> Result<()> {
        sqlx::query(
            r#"
            DELETE FROM indexer_program_cursors
            WHERE program_id = $1
              AND listener_mode = $2
            "#,
        )
        .bind(program_id)
        .bind(listener_mode)
        .execute(&self.pool)
        .await?;

        Ok(())
    }
}

#[derive(Debug)]
pub struct SyncStats {
    pub last_processed_slot: i64,
    pub total_events_processed: i64,
    pub last_successful_sync: Option<String>,
}

#[derive(Debug, Clone)]
pub struct PendingFailedSlotStats {
    pub pending_count: u64,
    pub oldest_age_seconds: Option<u64>,
}

fn truncate_error_message(message: &str, max_len: usize) -> String {
    if message.len() <= max_len {
        return message.to_string();
    }
    let mut output = String::with_capacity(max_len);
    for ch in message.chars() {
        if output.len() + ch.len_utf8() > max_len {
            break;
        }
        output.push(ch);
    }
    output
}

fn program_cursor_from_row(row: sqlx::postgres::PgRow) -> Result<ProgramCursor, sqlx::Error> {
    use sqlx::Row;

    let last_processed_slot: i64 = row.try_get("last_processed_slot")?;
    Ok(ProgramCursor {
        program_id: row.try_get("program_id")?,
        listener_mode: row.try_get("listener_mode")?,
        last_signature: row.try_get("last_signature")?,
        last_processed_slot: last_processed_slot.max(0) as u64,
    })
}
