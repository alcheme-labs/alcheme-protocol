use anyhow::Result;
use sqlx::PgPool;
use std::time::{SystemTime, UNIX_EPOCH};

use crate::metrics;

#[derive(Clone)]
pub struct RuntimeStateStore {
    pool: PgPool,
    indexer_id: String,
    listener_mode: String,
}

impl RuntimeStateStore {
    pub fn new(pool: PgPool, indexer_id: String, listener_mode: impl Into<String>) -> Self {
        Self {
            pool,
            indexer_id,
            listener_mode: listener_mode.into(),
        }
    }

    pub async fn mark_listener_started(&self) -> Result<()> {
        self.write_state("starting", None, None, None, None, None, true)
            .await
    }

    pub async fn mark_idle(&self, current_slot: Option<u64>) -> Result<()> {
        self.write_state("idle", current_slot, None, None, None, None, true)
            .await
    }

    pub async fn mark_slot_started(&self, slot: u64, tx_count: usize) -> Result<()> {
        self.write_state(
            "processing_slot",
            Some(slot),
            Some(tx_count.min(i32::MAX as usize) as i32),
            None,
            None,
            None,
            true,
        )
        .await
    }

    pub async fn mark_tx_progress(
        &self,
        slot: u64,
        tx_count: Option<usize>,
        tx_index: usize,
        signature: Option<&str>,
    ) -> Result<()> {
        self.write_state(
            "processing_tx",
            Some(slot),
            tx_count.map(|count| count.min(i32::MAX as usize) as i32),
            Some(tx_index.min(i32::MAX as usize) as i32),
            signature,
            None,
            true,
        )
        .await
    }

    pub async fn mark_slot_completed(&self, slot: u64) -> Result<()> {
        self.write_state("idle", Some(slot), None, None, None, None, true)
            .await
    }

    pub async fn mark_error(&self, error: &str) -> Result<()> {
        self.write_state("error", None, None, None, None, Some(error), false)
            .await
    }

    async fn write_state(
        &self,
        phase: &str,
        current_slot: Option<u64>,
        current_slot_tx_count: Option<i32>,
        current_tx_index: Option<i32>,
        current_tx_signature: Option<&str>,
        last_error: Option<&str>,
        refresh_progress_at: bool,
    ) -> Result<()> {
        sqlx::query(runtime_state_upsert_sql(refresh_progress_at))
        .bind(&self.indexer_id)
        .bind(&self.indexer_id)
        .bind(&self.listener_mode)
        .bind(phase)
        .bind(current_slot.map(|value| value as i64))
        .bind(current_slot_tx_count)
        .bind(current_tx_index)
        .bind(current_tx_signature)
        .bind(last_error)
        .execute(&self.pool)
        .await?;

        metrics::set_runtime_current_slot(current_slot);
        metrics::set_runtime_current_slot_tx_count(current_slot_tx_count);
        if refresh_progress_at {
            metrics::set_runtime_last_progress_unixtime(current_unix_seconds());
        }

        Ok(())
    }
}

fn runtime_state_upsert_sql(refresh_progress_at: bool) -> &'static str {
    if refresh_progress_at {
        r#"
        INSERT INTO indexer_runtime_state (
            id,
            indexer_id,
            listener_mode,
            phase,
            current_slot,
            current_slot_tx_count,
            current_tx_index,
            current_tx_signature,
            last_progress_at,
            last_error,
            updated_at
        )
        VALUES ($1, $2, $3, $4, $5, $6, $7, $8, NOW(), $9, NOW())
        ON CONFLICT (id) DO UPDATE SET
            indexer_id = EXCLUDED.indexer_id,
            listener_mode = EXCLUDED.listener_mode,
            phase = EXCLUDED.phase,
            current_slot = EXCLUDED.current_slot,
            current_slot_tx_count = EXCLUDED.current_slot_tx_count,
            current_tx_index = EXCLUDED.current_tx_index,
            current_tx_signature = EXCLUDED.current_tx_signature,
            last_progress_at = NOW(),
            last_error = EXCLUDED.last_error,
            updated_at = NOW()
        "#
    } else {
        r#"
        INSERT INTO indexer_runtime_state (
            id,
            indexer_id,
            listener_mode,
            phase,
            current_slot,
            current_slot_tx_count,
            current_tx_index,
            current_tx_signature,
            last_progress_at,
            last_error,
            updated_at
        )
        VALUES ($1, $2, $3, $4, $5, $6, $7, $8, NOW(), $9, NOW())
        ON CONFLICT (id) DO UPDATE SET
            indexer_id = EXCLUDED.indexer_id,
            listener_mode = EXCLUDED.listener_mode,
            phase = EXCLUDED.phase,
            current_slot = EXCLUDED.current_slot,
            current_slot_tx_count = EXCLUDED.current_slot_tx_count,
            current_tx_index = EXCLUDED.current_tx_index,
            current_tx_signature = EXCLUDED.current_tx_signature,
            last_error = EXCLUDED.last_error,
            updated_at = NOW()
        "#
    }
}

fn current_unix_seconds() -> i64 {
    SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .map(|duration| duration.as_secs() as i64)
        .unwrap_or_default()
}

#[cfg(test)]
mod tests {
    use super::{current_unix_seconds, runtime_state_upsert_sql};

    #[test]
    fn runtime_state_clock_is_monotonicish() {
        let first = current_unix_seconds();
        let second = current_unix_seconds();
        assert!(second >= first);
    }

    #[test]
    fn runtime_error_sql_preserves_last_progress_timestamp_on_update() {
        let sql = runtime_state_upsert_sql(false);
        assert!(sql.contains("VALUES ($1, $2, $3, $4, $5, $6, $7, $8, NOW(), $9, NOW())"));
        assert!(!sql.contains("last_progress_at = NOW()"));
    }

    #[test]
    fn runtime_progress_sql_refreshes_last_progress_timestamp_on_update() {
        let sql = runtime_state_upsert_sql(true);
        assert!(sql.contains("last_progress_at = NOW()"));
    }
}
