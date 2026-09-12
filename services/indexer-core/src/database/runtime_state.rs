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

#[derive(Debug, Clone, PartialEq, Eq)]
pub struct RecoveryWindow {
    pub from_slot: u64,
    pub target_slot: u64,
    pub filter_generation_hash: Option<String>,
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
            .await?;
        self.set_grpc_connected(false).await
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
        let phase = if self.listener_mode == "yellowstone" {
            "live"
        } else {
            "idle"
        };
        self.write_state(phase, Some(slot), None, None, None, None, true)
            .await
    }

    pub async fn mark_error(&self, error: &str) -> Result<()> {
        self.write_state("error", None, None, None, None, Some(error), false)
            .await
    }

    pub async fn mark_filter_generation(
        &self,
        generation_hash: &str,
        effective_from_slot: u64,
    ) -> Result<()> {
        sqlx::query(filter_generation_sql())
            .bind(&self.indexer_id)
            .bind(&self.listener_mode)
            .bind(generation_hash)
            .bind(effective_from_slot as i64)
            .execute(&self.pool)
            .await?;
        Ok(())
    }

    pub async fn mark_stream_connected(&self) -> Result<()> {
        self.set_grpc_connected(true).await
    }

    pub async fn mark_stream_disconnected(&self) -> Result<()> {
        self.set_grpc_connected(false).await
    }

    pub async fn mark_stream_caught_up(
        &self,
        observed_slot: u64,
        catchup_target_slot: u64,
    ) -> Result<()> {
        sqlx::query(stream_caught_up_sql())
            .bind(&self.indexer_id)
            .bind(observed_slot as i64)
            .bind(catchup_target_slot as i64)
            .execute(&self.pool)
            .await?;
        Ok(())
    }

    pub async fn load_recovery_window(&self) -> Result<Option<RecoveryWindow>> {
        let row = sqlx::query_as::<_, (Option<i64>, Option<i64>, Option<String>)>(
            r#"
            SELECT recovery_from_slot, recovery_target_slot, filter_generation_hash
            FROM indexer_runtime_state
            WHERE id = $1
            "#,
        )
        .bind(&self.indexer_id)
        .fetch_optional(&self.pool)
        .await?;

        Ok(
            row.and_then(|(from_slot, target_slot, filter_generation_hash)| {
                Some(RecoveryWindow {
                    from_slot: u64::try_from(from_slot?).ok()?,
                    target_slot: u64::try_from(target_slot?).ok()?,
                    filter_generation_hash,
                })
            }),
        )
    }

    pub async fn load_coverage_slot(&self) -> Result<Option<u64>> {
        let coverage_slot = sqlx::query_scalar::<_, Option<i64>>(
            r#"
            SELECT coverage_slot
            FROM indexer_runtime_state
            WHERE id = $1
            "#,
        )
        .bind(&self.indexer_id)
        .fetch_optional(&self.pool)
        .await?
        .flatten();

        Ok(coverage_slot.and_then(|slot| u64::try_from(slot).ok()))
    }

    pub async fn load_discovered_extension_program_ids(&self) -> Result<Vec<String>> {
        let program_ids = sqlx::query_scalar::<_, Vec<String>>(
            r#"
            SELECT discovered_extension_program_ids
            FROM indexer_runtime_state
            WHERE id = $1
            "#,
        )
        .bind(&self.indexer_id)
        .fetch_optional(&self.pool)
        .await?
        .unwrap_or_default();
        Ok(program_ids)
    }

    pub async fn persist_discovered_extension_program_ids(
        &self,
        program_ids: &[String],
    ) -> Result<()> {
        sqlx::query(discovered_extension_program_ids_sql())
            .bind(&self.indexer_id)
            .bind(program_ids)
            .execute(&self.pool)
            .await?;
        Ok(())
    }

    pub async fn begin_recovery(&self, from_slot: u64, target_slot: u64) -> Result<()> {
        sqlx::query(
            r#"
            UPDATE indexer_runtime_state
            SET
                phase = 'catching_up',
                recovery_from_slot = $2,
                recovery_target_slot = $3,
                grpc_connected = FALSE,
                last_error = NULL,
                last_progress_at = NOW(),
                updated_at = NOW()
            WHERE id = $1
            "#,
        )
        .bind(&self.indexer_id)
        .bind(from_slot as i64)
        .bind(target_slot as i64)
        .execute(&self.pool)
        .await?;
        Ok(())
    }

    pub async fn complete_recovery(&self, target_slot: u64) -> Result<()> {
        sqlx::query(complete_recovery_sql())
            .bind(&self.indexer_id)
            .bind(target_slot as i64)
            .execute(&self.pool)
            .await?;
        Ok(())
    }

    pub async fn mark_recovery_degraded(&self, error: &str) -> Result<()> {
        sqlx::query(
            r#"
            UPDATE indexer_runtime_state
            SET
                phase = 'degraded',
                grpc_connected = FALSE,
                last_error = $2,
                updated_at = NOW()
            WHERE id = $1
            "#,
        )
        .bind(&self.indexer_id)
        .bind(error)
        .execute(&self.pool)
        .await?;
        Ok(())
    }

    pub async fn mark_stream_transaction(&self, slot: u64, signature: Option<&str>) -> Result<()> {
        sqlx::query(stream_transaction_sql())
            .bind(&self.indexer_id)
            .bind(slot as i64)
            .bind(signature)
            .execute(&self.pool)
            .await?;
        metrics::set_runtime_current_slot(Some(slot));
        metrics::set_runtime_last_progress_unixtime(current_unix_seconds());
        Ok(())
    }

    pub async fn mark_observed_head(&self, slot: u64) -> Result<()> {
        sqlx::query(
            r#"
            UPDATE indexer_runtime_state
            SET
                observed_head_slot = GREATEST(
                    COALESCE(observed_head_slot, $2),
                    $2
                ),
                last_progress_at = NOW(),
                updated_at = NOW()
            WHERE id = $1
            "#,
        )
        .bind(&self.indexer_id)
        .bind(slot as i64)
        .execute(&self.pool)
        .await?;
        Ok(())
    }

    async fn set_grpc_connected(&self, connected: bool) -> Result<()> {
        sqlx::query(stream_connection_sql())
            .bind(&self.indexer_id)
            .bind(connected)
            .execute(&self.pool)
            .await?;
        Ok(())
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
            grpc_connected = FALSE,
            updated_at = NOW()
        "#
    }
}

fn filter_generation_sql() -> &'static str {
    r#"
    INSERT INTO indexer_runtime_state (
        id,
        indexer_id,
        listener_mode,
        phase,
        filter_generation_hash,
        filter_effective_from_slot,
        last_progress_at,
        updated_at
    )
    VALUES ($1, $1, $2, 'starting', $3, $4, NOW(), NOW())
    ON CONFLICT (id) DO UPDATE SET
        listener_mode = EXCLUDED.listener_mode,
        confirmed_coverage_slot = CASE
            WHEN indexer_runtime_state.filter_generation_hash
                IS DISTINCT FROM EXCLUDED.filter_generation_hash
                AND indexer_runtime_state.confirmed_coverage_slot IS NOT NULL
            THEN LEAST(
                indexer_runtime_state.confirmed_coverage_slot,
                GREATEST(EXCLUDED.filter_effective_from_slot - 1, 0)
            )
            ELSE indexer_runtime_state.confirmed_coverage_slot
        END,
        finalized_coverage_slot = CASE
            WHEN indexer_runtime_state.filter_generation_hash
                IS DISTINCT FROM EXCLUDED.filter_generation_hash
                AND indexer_runtime_state.finalized_coverage_slot IS NOT NULL
            THEN LEAST(
                indexer_runtime_state.finalized_coverage_slot,
                GREATEST(EXCLUDED.filter_effective_from_slot - 1, 0)
            )
            ELSE indexer_runtime_state.finalized_coverage_slot
        END,
        coverage_slot = CASE
            WHEN indexer_runtime_state.filter_generation_hash
                IS DISTINCT FROM EXCLUDED.filter_generation_hash
                AND indexer_runtime_state.coverage_slot IS NOT NULL
            THEN LEAST(
                indexer_runtime_state.coverage_slot,
                GREATEST(EXCLUDED.filter_effective_from_slot - 1, 0)
            )
            ELSE indexer_runtime_state.coverage_slot
        END,
        filter_generation_hash = EXCLUDED.filter_generation_hash,
        filter_effective_from_slot = CASE
            WHEN indexer_runtime_state.filter_generation_hash
                IS DISTINCT FROM EXCLUDED.filter_generation_hash
            THEN EXCLUDED.filter_effective_from_slot
            ELSE indexer_runtime_state.filter_effective_from_slot
        END,
        updated_at = NOW()
    "#
}

fn discovered_extension_program_ids_sql() -> &'static str {
    r#"
    UPDATE indexer_runtime_state
    SET
        discovered_extension_program_ids = $2,
        updated_at = NOW()
    WHERE id = $1
    "#
}

fn complete_recovery_sql() -> &'static str {
    r#"
    UPDATE indexer_runtime_state
    SET
        phase = 'starting',
        current_slot = GREATEST(COALESCE(current_slot, $2), $2),
        observed_head_slot = GREATEST(COALESCE(observed_head_slot, $2), $2),
        confirmed_coverage_slot = GREATEST(
            COALESCE(confirmed_coverage_slot, $2),
            $2
        ),
        coverage_slot = GREATEST(COALESCE(coverage_slot, $2), $2),
        recovery_from_slot = NULL,
        recovery_target_slot = NULL,
        last_error = NULL,
        last_progress_at = NOW(),
        updated_at = NOW()
    WHERE id = $1
    "#
}

fn stream_connection_sql() -> &'static str {
    r#"
    UPDATE indexer_runtime_state
    SET
        grpc_connected = $2,
        phase = CASE
            WHEN NOT $2 AND phase = 'live' THEN 'starting'
            WHEN $2 AND phase = 'error' THEN 'starting'
            ELSE phase
        END,
        last_error = CASE WHEN $2 THEN NULL ELSE last_error END,
        last_progress_at = NOW(),
        updated_at = NOW()
    WHERE id = $1
    "#
}

fn stream_caught_up_sql() -> &'static str {
    r#"
    UPDATE indexer_runtime_state
    SET
        observed_head_slot = GREATEST(COALESCE(observed_head_slot, $2), $2),
        phase = CASE
            WHEN grpc_connected = TRUE
                AND coverage_slot IS NOT NULL
                AND recovery_target_slot IS NULL
                AND last_error IS NULL
                AND $2 >= $3
            THEN 'live'
            ELSE phase
        END,
        last_progress_at = NOW(),
        updated_at = NOW()
    WHERE id = $1
    "#
}

fn stream_transaction_sql() -> &'static str {
    r#"
    UPDATE indexer_runtime_state
    SET
        current_slot = GREATEST(COALESCE(current_slot, $2), $2),
        current_tx_signature = $3,
        last_progress_at = NOW(),
        updated_at = NOW()
    WHERE id = $1
    "#
}

fn current_unix_seconds() -> i64 {
    SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .map(|duration| duration.as_secs() as i64)
        .unwrap_or_default()
}

#[cfg(test)]
mod tests {
    use super::{
        complete_recovery_sql, current_unix_seconds, discovered_extension_program_ids_sql,
        filter_generation_sql, runtime_state_upsert_sql, stream_caught_up_sql,
        stream_connection_sql, stream_transaction_sql,
    };

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

    #[test]
    fn filter_generation_change_clamps_coverage_before_effective_slot() {
        let sql = filter_generation_sql()
            .split_whitespace()
            .collect::<Vec<_>>()
            .join(" ");
        assert!(
            sql.contains("filter_generation_hash IS DISTINCT FROM EXCLUDED.filter_generation_hash")
        );
        assert!(sql.contains("filter_effective_from_slot"));
        assert!(sql.contains("confirmed_coverage_slot"));
        assert!(sql.contains("finalized_coverage_slot"));
        assert!(sql.contains("coverage_slot"));
        assert!(sql.contains("EXCLUDED.filter_effective_from_slot - 1"));
    }

    #[test]
    fn completed_confirmed_recovery_establishes_coverage_without_claiming_finality() {
        let sql = complete_recovery_sql();
        assert!(sql.contains("confirmed_coverage_slot"));
        assert!(sql.contains("coverage_slot"));
        assert!(sql.contains("observed_head_slot"));
        assert!(!sql.contains("finalized_coverage_slot"));
    }

    #[test]
    fn stream_connection_never_claims_projection_readiness() {
        let connected = stream_connection_sql()
            .split_whitespace()
            .collect::<Vec<_>>()
            .join(" ");
        assert!(!connected.contains("THEN 'live'"));
    }

    #[test]
    fn stream_catchup_requires_the_observed_slot_to_reach_the_connection_barrier() {
        let caught_up = stream_caught_up_sql()
            .split_whitespace()
            .collect::<Vec<_>>()
            .join(" ");
        assert!(caught_up.contains("grpc_connected = TRUE"));
        assert!(caught_up.contains("coverage_slot IS NOT NULL"));
        assert!(caught_up.contains("recovery_target_slot IS NULL"));
        assert!(caught_up.contains("$2 >= $3"));
        assert!(caught_up.contains("THEN 'live'"));
    }

    #[test]
    fn stream_transaction_progress_preserves_connection_and_phase() {
        let sql = stream_transaction_sql();
        assert!(sql.contains("current_tx_signature"));
        assert!(!sql.contains("phase ="));
        assert!(!sql.contains("grpc_connected ="));
    }

    #[test]
    fn discovered_extension_scope_has_a_durable_runtime_owner() {
        let sql = discovered_extension_program_ids_sql();
        assert!(sql.contains("discovered_extension_program_ids"));
        assert!(sql.contains("updated_at = NOW()"));
    }
}
