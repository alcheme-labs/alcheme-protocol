use alcheme_shared::ProtocolEvent;
use anyhow::{anyhow, Context, Result};
use solana_sdk::pubkey::Pubkey;
use sqlx::{PgPool, Row};
use std::collections::{BTreeSet, HashMap};
use std::future::Future;
use std::str::FromStr;
use std::time::{Duration, Instant};
use tokio::time::sleep;
use tracing::{info, warn};

use crate::database::checkpoint::CheckpointManager;
use crate::database::RuntimeStateStore;
use crate::listeners::local_rpc_listener::{
    extract_primary_account_from_single_instruction_tx, RpcJsonClient, RpcTransactionResult,
};
use crate::parsers::event_parser::{
    content_post_snapshot_target_for_event, EventParser, EventProjectionContext,
};

pub const YELLOWSTONE_RECOVERY_LISTENER_MODE: &str = "yellowstone_recovery";
const MAX_RECOVERY_RPC_ATTEMPTS: u32 = 5;
const MAX_RECOVERY_HEAD_REFRESH_INTERVAL: Duration = Duration::from_secs(300);
const MIN_RECOVERY_HEAD_REFRESH_INTERVAL: Duration = Duration::from_secs(1);
const HALF_SLOT_MILLIS: u64 = 200;

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub(crate) enum RecoveryDecision {
    NotRequired,
    Recover { from_slot: u64, target_slot: u64 },
}

pub(crate) struct RecoveryOutcome {
    pub(crate) discovered_extension_program_ids: Vec<String>,
    pub(crate) stream_catchup_target_slot: u64,
    pub(crate) subscription_resume_slot: Option<u64>,
}

#[derive(Debug)]
struct StagedRecoveryTransaction {
    signature: String,
    slot: u64,
    transaction_index: i32,
}

#[derive(Debug, Default)]
struct RecoveryHeadCache {
    slot: Option<u64>,
    refreshed_at: Option<Instant>,
}

impl RecoveryHeadCache {
    fn fresh_slot(&self, now: Instant, max_age: Duration) -> Option<u64> {
        let refreshed_at = self.refreshed_at?;
        let elapsed = now.checked_duration_since(refreshed_at)?;
        (elapsed < max_age).then_some(self.slot?)
    }

    fn record(&mut self, slot: u64, refreshed_at: Instant) {
        self.slot = Some(slot);
        self.refreshed_at = Some(refreshed_at);
    }

    fn record_progress(&mut self, slot: u64, observed_at: Instant) -> bool {
        if self.slot.is_some_and(|cached_slot| slot <= cached_slot) {
            return false;
        }
        self.record(slot, observed_at);
        true
    }
}

pub(crate) struct RecoveryCoordinator {
    indexer_id: String,
    pool: PgPool,
    rpc_client: RpcJsonClient,
    checkpoint_manager: CheckpointManager,
    runtime_state_store: RuntimeStateStore,
    event_parser: EventParser,
    registry_factory_program_id: Option<String>,
    base_program_ids: BTreeSet<String>,
    discovered_extension_program_ids: BTreeSet<String>,
    replay_window_slots: u64,
    signature_page_size: usize,
    transaction_batch_size: i64,
    head_cache: RecoveryHeadCache,
}

impl RecoveryCoordinator {
    #[allow(clippy::too_many_arguments)]
    pub(crate) fn new(
        indexer_id: String,
        pool: PgPool,
        rpc_url: String,
        checkpoint_manager: CheckpointManager,
        runtime_state_store: RuntimeStateStore,
        event_parser: EventParser,
        tracked_program_ids: Vec<String>,
        registry_factory_program_id: Option<String>,
        replay_window_slots: u64,
        signature_page_size: usize,
        transaction_batch_size: usize,
        request_timeout_ms: u64,
    ) -> Self {
        Self {
            indexer_id,
            pool,
            rpc_client: RpcJsonClient::new(
                rpc_url,
                request_timeout_ms,
                "indexer_core",
                YELLOWSTONE_RECOVERY_LISTENER_MODE,
            ),
            checkpoint_manager,
            runtime_state_store,
            event_parser,
            registry_factory_program_id,
            base_program_ids: tracked_program_ids.into_iter().collect(),
            discovered_extension_program_ids: BTreeSet::new(),
            replay_window_slots: replay_window_slots.max(1),
            signature_page_size: signature_page_size.clamp(1, 1000),
            transaction_batch_size: transaction_batch_size.max(1) as i64,
            head_cache: RecoveryHeadCache::default(),
        }
    }

    pub(crate) fn update_discovered_extension_program_ids(&mut self, program_ids: Vec<String>) {
        self.discovered_extension_program_ids = program_ids.into_iter().collect();
    }

    pub(crate) async fn recover_if_required(
        &mut self,
        filter_generation_hash: &str,
    ) -> Result<RecoveryOutcome> {
        let active_window = self.runtime_state_store.load_recovery_window().await?;
        let coverage_slot = self.runtime_state_store.load_coverage_slot().await?;
        let checkpoint_slot = self.checkpoint_manager.get_last_processed_slot().await?;
        let head_slot = match active_window.as_ref() {
            Some(window) => window.target_slot,
            None => self.current_head_slot().await?,
        };
        let decision = recovery_decision(
            active_window
                .as_ref()
                .map(|window| (window.from_slot, window.target_slot)),
            coverage_slot,
            checkpoint_slot,
            head_slot,
            self.replay_window_slots,
        );

        let RecoveryDecision::Recover {
            from_slot,
            target_slot,
        } = decision
        else {
            crate::metrics::set_recovery_phase("idle");
            crate::metrics::set_recovery_remaining_slots(0);
            let subscription_resume_slot = durable_resume_slot(checkpoint_slot, coverage_slot);
            if let Some(resume_slot) = subscription_resume_slot {
                crate::metrics::record_grpc_replay_slots(head_slot.saturating_sub(resume_slot));
            }
            return Ok(RecoveryOutcome {
                discovered_extension_program_ids: self.discovered_extension_program_ids(),
                stream_catchup_target_slot: head_slot,
                subscription_resume_slot,
            });
        };

        if active_window
            .as_ref()
            .and_then(|window| window.filter_generation_hash.as_deref())
            != Some(filter_generation_hash)
        {
            self.reset_recovery_generation().await?;
        }
        self.runtime_state_store
            .mark_filter_generation(filter_generation_hash, from_slot)
            .await?;
        info!(
            from_slot,
            target_slot,
            filter_generation_hash,
            "Starting or resuming bounded Yellowstone HTTP recovery"
        );
        crate::metrics::set_recovery_phase("discovering");
        crate::metrics::set_recovery_remaining_slots(target_slot.saturating_sub(from_slot));
        self.runtime_state_store
            .begin_recovery(from_slot, target_slot)
            .await?;

        let result = self
            .run_recovery(filter_generation_hash, from_slot, target_slot)
            .await;
        if let Err(error) = &result {
            crate::metrics::set_recovery_phase("degraded");
            let bounded_error = truncate_error(&error.to_string(), 1000);
            let _ = self
                .runtime_state_store
                .mark_recovery_degraded(&bounded_error)
                .await;
        }
        result.map(|discovered_extension_program_ids| RecoveryOutcome {
            discovered_extension_program_ids,
            stream_catchup_target_slot: target_slot,
            subscription_resume_slot: Some(target_slot),
        })
    }

    async fn current_head_slot(&mut self) -> Result<u64> {
        let refresh_interval = recovery_head_refresh_interval(self.replay_window_slots);
        if let Some(slot) = self.head_cache.fresh_slot(Instant::now(), refresh_interval) {
            return Ok(slot);
        }

        let slot = retry_rpc("recovery_head", || self.rpc_client.get_slot()).await?;
        self.head_cache.record(slot, Instant::now());
        Ok(slot)
    }

    pub(crate) fn observe_stream_head(&mut self, slot: u64) {
        self.head_cache.record_progress(slot, Instant::now());
    }

    async fn run_recovery(
        &mut self,
        filter_generation_hash: &str,
        from_slot: u64,
        target_slot: u64,
    ) -> Result<Vec<String>> {
        self.stage_program_signatures(filter_generation_hash, from_slot, target_slot)
            .await?;
        crate::metrics::set_recovery_phase("projecting");
        loop {
            self.resolve_transaction_indexes(filter_generation_hash)
                .await?;
            self.project_staged_transactions(filter_generation_hash, target_slot)
                .await?;
            let remaining = self.pending_recovery_count(filter_generation_hash).await?;
            if remaining == 0 {
                break;
            }
        }

        self.runtime_state_store
            .complete_recovery(target_slot)
            .await?;
        self.cleanup_completed_recovery(filter_generation_hash)
            .await?;
        crate::metrics::set_recovery_phase("idle");
        crate::metrics::set_recovery_remaining_slots(0);
        info!(
            target_slot,
            filter_generation_hash, "Yellowstone HTTP recovery completed"
        );
        Ok(self.discovered_extension_program_ids())
    }

    async fn stage_program_signatures(
        &self,
        filter_generation_hash: &str,
        from_slot: u64,
        target_slot: u64,
    ) -> Result<()> {
        for program_id in self.current_program_ids() {
            self.stage_one_program(program_id, filter_generation_hash, from_slot, target_slot)
                .await?;
        }
        Ok(())
    }

    async fn stage_one_program(
        &self,
        program_id: String,
        filter_generation_hash: &str,
        from_slot: u64,
        target_slot: u64,
    ) -> Result<()> {
        loop {
            let cursor = self
                .checkpoint_manager
                .get_program_cursor(&program_id, YELLOWSTONE_RECOVERY_LISTENER_MODE)
                .await?;
            let before = cursor
                .as_ref()
                .and_then(|value| value.last_signature.as_deref());
            let fetched = retry_rpc("recovery_signatures", || {
                self.rpc_client.get_signatures_for_address(
                    &program_id,
                    before,
                    self.signature_page_size,
                )
            })
            .await?;

            let oldest = fetched.last().cloned();
            let mut tx = self.pool.begin().await?;
            for (signature, slot) in fetched
                .iter()
                .filter(|(_, slot)| *slot > from_slot && *slot <= target_slot)
            {
                sqlx::query(
                    r#"
                        INSERT INTO indexer_recovery_transactions (
                            indexer_id,
                            filter_generation_hash,
                            signature,
                            slot,
                            matched_program_ids,
                            state,
                            updated_at
                        )
                        VALUES ($1, $2, $3, $4, ARRAY[$5]::TEXT[], 'staged', NOW())
                        ON CONFLICT (indexer_id, filter_generation_hash, signature)
                        DO UPDATE SET
                            slot = GREATEST(
                                indexer_recovery_transactions.slot,
                                EXCLUDED.slot
                            ),
                            matched_program_ids = (
                                SELECT ARRAY_AGG(DISTINCT value)
                                FROM UNNEST(
                                    indexer_recovery_transactions.matched_program_ids
                                    || EXCLUDED.matched_program_ids
                                ) AS value
                            ),
                            updated_at = NOW()
                        "#,
                )
                .bind(&self.indexer_id)
                .bind(filter_generation_hash)
                .bind(signature)
                .bind(*slot as i64)
                .bind(&program_id)
                .execute(&mut *tx)
                .await?;
            }

            let continue_paging = oldest
                .as_ref()
                .map(|(_, slot)| *slot > from_slot)
                .unwrap_or(false)
                && fetched.len() >= self.signature_page_size;
            if continue_paging {
                let (oldest_signature, oldest_slot) = oldest.as_ref().ok_or_else(|| {
                    anyhow!(
                        "recovery pagination requires an oldest signature for program {}",
                        program_id
                    )
                })?;
                upsert_recovery_cursor(&mut tx, &program_id, oldest_signature, *oldest_slot)
                    .await?;
            } else {
                clear_recovery_cursor(&mut tx, &program_id).await?;
            }
            tx.commit().await?;

            if !continue_paging {
                break;
            }
            sleep(Duration::from_millis(100)).await;
        }
        Ok(())
    }

    async fn resolve_transaction_indexes(&self, filter_generation_hash: &str) -> Result<()> {
        let slots = sqlx::query_scalar::<_, i64>(
            r#"
            SELECT DISTINCT slot
            FROM indexer_recovery_transactions
            WHERE indexer_id = $1
              AND filter_generation_hash = $2
              AND state = 'staged'
              AND transaction_index IS NULL
            ORDER BY slot ASC
            "#,
        )
        .bind(&self.indexer_id)
        .bind(filter_generation_hash)
        .fetch_all(&self.pool)
        .await?;

        for slot in slots {
            let slot_u64 = u64::try_from(slot).context("negative recovery slot")?;
            let signatures = retry_rpc("recovery_block_signatures", || {
                self.rpc_client.get_block_signatures(slot_u64)
            })
            .await?
            .ok_or_else(|| anyhow!("recovery block unavailable at slot {slot_u64}"))?;
            let indexes = signatures
                .into_iter()
                .enumerate()
                .map(|(index, signature)| (signature, index as i32))
                .collect::<HashMap<_, _>>();

            let staged = sqlx::query_scalar::<_, String>(
                r#"
                SELECT signature
                FROM indexer_recovery_transactions
                WHERE indexer_id = $1
                  AND filter_generation_hash = $2
                  AND slot = $3
                  AND state = 'staged'
                "#,
            )
            .bind(&self.indexer_id)
            .bind(filter_generation_hash)
            .bind(slot)
            .fetch_all(&self.pool)
            .await?;

            let mut tx = self.pool.begin().await?;
            for signature in staged {
                let transaction_index = indexes.get(&signature).ok_or_else(|| {
                    anyhow!(
                        "recovery signature {} missing from authoritative block {}",
                        signature,
                        slot_u64
                    )
                })?;
                sqlx::query(
                    r#"
                    UPDATE indexer_recovery_transactions
                    SET transaction_index = $4, updated_at = NOW()
                    WHERE indexer_id = $1
                      AND filter_generation_hash = $2
                      AND signature = $3
                    "#,
                )
                .bind(&self.indexer_id)
                .bind(filter_generation_hash)
                .bind(&signature)
                .bind(*transaction_index)
                .execute(&mut *tx)
                .await?;
            }
            tx.commit().await?;
            sleep(Duration::from_millis(100)).await;
        }
        Ok(())
    }

    async fn project_staged_transactions(
        &mut self,
        filter_generation_hash: &str,
        target_slot: u64,
    ) -> Result<()> {
        loop {
            let rows = sqlx::query(
                r#"
                SELECT signature, slot, transaction_index
                FROM indexer_recovery_transactions
                WHERE indexer_id = $1
                  AND filter_generation_hash = $2
                  AND state = 'staged'
                  AND transaction_index IS NOT NULL
                ORDER BY slot ASC, transaction_index ASC, signature ASC
                LIMIT $3
                "#,
            )
            .bind(&self.indexer_id)
            .bind(filter_generation_hash)
            .bind(self.transaction_batch_size)
            .fetch_all(&self.pool)
            .await?;

            if rows.is_empty() {
                break;
            }

            for row in rows {
                let staged = StagedRecoveryTransaction {
                    signature: row.try_get("signature")?,
                    slot: u64::try_from(row.try_get::<i64, _>("slot")?)
                        .context("negative staged recovery slot")?,
                    transaction_index: row.try_get("transaction_index")?,
                };
                let changes = match self.project_one(&staged).await {
                    Ok(changes) => changes,
                    Err(error) => {
                        crate::metrics::record_projection_failure("recovery_transaction");
                        sqlx::query(
                            r#"
                        UPDATE indexer_recovery_transactions
                        SET attempts = attempts + 1, last_error = $4, updated_at = NOW()
                        WHERE indexer_id = $1
                          AND filter_generation_hash = $2
                          AND signature = $3
                        "#,
                        )
                        .bind(&self.indexer_id)
                        .bind(filter_generation_hash)
                        .bind(&staged.signature)
                        .bind(truncate_error(&error.to_string(), 1000))
                        .execute(&self.pool)
                        .await?;
                        return Err(error);
                    }
                };

                for change in changes {
                    match change {
                        RecoveryProgramChange::Registered(program_id) => {
                            if self
                                .discovered_extension_program_ids
                                .insert(program_id.clone())
                            {
                                self.persist_discovered_extension_program_ids().await?;
                                self.stage_one_program(
                                    program_id,
                                    filter_generation_hash,
                                    registered_program_recovery_from_slot(staged.slot),
                                    target_slot,
                                )
                                .await?;
                            }
                        }
                        RecoveryProgramChange::Removed(program_id) => {
                            if self.discovered_extension_program_ids.remove(&program_id) {
                                self.persist_discovered_extension_program_ids().await?;
                            }
                        }
                    }
                }

                self.checkpoint_manager
                    .update_transaction(staged.slot, Some(&staged.signature))
                    .await?;
                crate::metrics::set_recovery_remaining_slots(
                    target_slot.saturating_sub(staged.slot),
                );
                sqlx::query(
                    r#"
                    UPDATE indexer_recovery_transactions
                    SET state = 'done', last_error = NULL, updated_at = NOW()
                    WHERE indexer_id = $1
                      AND filter_generation_hash = $2
                      AND signature = $3
                    "#,
                )
                .bind(&self.indexer_id)
                .bind(filter_generation_hash)
                .bind(&staged.signature)
                .execute(&self.pool)
                .await?;
            }
        }
        Ok(())
    }

    async fn project_one(
        &mut self,
        staged: &StagedRecoveryTransaction,
    ) -> Result<Vec<RecoveryProgramChange>> {
        let transaction = retry_rpc("recovery_transaction", || {
            self.rpc_client.get_transaction(&staged.signature)
        })
        .await?
        .ok_or_else(|| anyhow!("recovery transaction unavailable: {}", staged.signature))?;
        if transaction.err() {
            return Ok(Vec::new());
        }

        let logs = transaction.log_messages();
        if !logs_contain_programs(&logs, &self.current_program_id_set()) {
            return Ok(Vec::new());
        }
        let changes =
            extract_recovery_program_changes(&logs, self.registry_factory_program_id.as_deref());
        let events = self.event_parser.parse_logs(&logs).await?;
        if !events.is_empty() {
            self.event_parser
                .process_events(
                    events.clone(),
                    EventProjectionContext {
                        slot: Some(staged.slot),
                        signature: Some(staged.signature.clone()),
                        event_index: None,
                    },
                )
                .await?;
            self.reconcile_tx_scoped_addresses(&events, &transaction)
                .await?;
        }
        Ok(changes)
    }

    async fn reconcile_tx_scoped_addresses(
        &self,
        events: &[ProtocolEvent],
        transaction: &RpcTransactionResult,
    ) -> Result<()> {
        let Some(on_chain_address) =
            extract_primary_account_from_single_instruction_tx(transaction)
        else {
            return Ok(());
        };
        let account = Pubkey::from_str(&on_chain_address)
            .with_context(|| format!("invalid recovered account {on_chain_address}"))?;

        for event in events {
            if let Some(content_id) = content_post_snapshot_target_for_event(event) {
                self.event_parser
                    .reconcile_content_post_account_snapshot(&content_id, &account)
                    .await?;
                continue;
            }
            match event {
                ProtocolEvent::KnowledgeSubmitted { knowledge_id, .. }
                | ProtocolEvent::ContributorsUpdated { knowledge_id, .. } => {
                    self.event_parser
                        .reconcile_knowledge_account_snapshot(&hex::encode(knowledge_id), &account)
                        .await?;
                }
                _ => {}
            }
        }
        Ok(())
    }

    async fn cleanup_completed_recovery(&self, filter_generation_hash: &str) -> Result<()> {
        let mut tx = self.pool.begin().await?;
        sqlx::query(
            r#"
            DELETE FROM indexer_recovery_transactions
            WHERE indexer_id = $1
              AND filter_generation_hash = $2
              AND state = 'done'
            "#,
        )
        .bind(&self.indexer_id)
        .bind(filter_generation_hash)
        .execute(&mut *tx)
        .await?;
        sqlx::query(
            r#"
            DELETE FROM indexer_program_cursors
            WHERE listener_mode = $1
            "#,
        )
        .bind(YELLOWSTONE_RECOVERY_LISTENER_MODE)
        .execute(&mut *tx)
        .await?;
        tx.commit().await?;
        Ok(())
    }

    async fn pending_recovery_count(&self, filter_generation_hash: &str) -> Result<i64> {
        sqlx::query_scalar(
            r#"
            SELECT COUNT(*)::BIGINT
            FROM indexer_recovery_transactions
            WHERE indexer_id = $1
              AND filter_generation_hash = $2
              AND state = 'staged'
            "#,
        )
        .bind(&self.indexer_id)
        .bind(filter_generation_hash)
        .fetch_one(&self.pool)
        .await
        .map_err(Into::into)
    }

    async fn reset_recovery_generation(&self) -> Result<()> {
        let mut tx = self.pool.begin().await?;
        sqlx::query("DELETE FROM indexer_recovery_transactions WHERE indexer_id = $1")
            .bind(&self.indexer_id)
            .execute(&mut *tx)
            .await?;
        sqlx::query("DELETE FROM indexer_program_cursors WHERE listener_mode = $1")
            .bind(YELLOWSTONE_RECOVERY_LISTENER_MODE)
            .execute(&mut *tx)
            .await?;
        tx.commit().await?;
        Ok(())
    }

    fn current_program_id_set(&self) -> BTreeSet<String> {
        self.base_program_ids
            .union(&self.discovered_extension_program_ids)
            .cloned()
            .collect()
    }

    fn current_program_ids(&self) -> Vec<String> {
        self.current_program_id_set().into_iter().collect()
    }

    fn discovered_extension_program_ids(&self) -> Vec<String> {
        self.discovered_extension_program_ids
            .iter()
            .cloned()
            .collect()
    }

    async fn persist_discovered_extension_program_ids(&self) -> Result<()> {
        self.runtime_state_store
            .persist_discovered_extension_program_ids(&self.discovered_extension_program_ids())
            .await
    }
}

fn recovery_decision(
    active_window: Option<(u64, u64)>,
    coverage_slot: Option<u64>,
    checkpoint_slot: Option<u64>,
    head_slot: u64,
    replay_window_slots: u64,
) -> RecoveryDecision {
    if let Some((from_slot, target_slot)) = active_window {
        return RecoveryDecision::Recover {
            from_slot,
            target_slot,
        };
    }

    if coverage_slot.is_none() {
        return RecoveryDecision::Recover {
            from_slot: checkpoint_slot
                .unwrap_or_else(|| head_slot.saturating_sub(replay_window_slots)),
            target_slot: head_slot,
        };
    }

    let durable_cursor = durable_resume_slot(checkpoint_slot, coverage_slot).unwrap_or_default();
    if head_slot.saturating_sub(durable_cursor) <= replay_window_slots {
        RecoveryDecision::NotRequired
    } else {
        RecoveryDecision::Recover {
            from_slot: durable_cursor,
            target_slot: head_slot,
        }
    }
}

fn recovery_head_refresh_interval(replay_window_slots: u64) -> Duration {
    Duration::from_millis(replay_window_slots.saturating_mul(HALF_SLOT_MILLIS)).clamp(
        MIN_RECOVERY_HEAD_REFRESH_INTERVAL,
        MAX_RECOVERY_HEAD_REFRESH_INTERVAL,
    )
}

async fn retry_rpc<T, F, Fut>(operation_name: &str, mut operation: F) -> Result<T>
where
    F: FnMut() -> Fut,
    Fut: Future<Output = Result<T>>,
{
    let mut attempt = 0_u32;
    loop {
        match operation().await {
            Ok(value) => return Ok(value),
            Err(error) => {
                attempt = attempt.saturating_add(1);
                if attempt >= MAX_RECOVERY_RPC_ATTEMPTS {
                    return Err(error).with_context(|| {
                        format!("{operation_name} failed after {attempt} attempts")
                    });
                }
                let delay = recovery_backoff(attempt, operation_name);
                warn!(
                    attempt,
                    ?delay,
                    operation_name,
                    "Recovery RPC failed; backing off before retry"
                );
                sleep(delay).await;
            }
        }
    }
}

fn recovery_backoff(attempt: u32, salt: &str) -> Duration {
    let exponent = attempt.saturating_sub(1).min(5);
    let base_ms = 500_u64.saturating_mul(1_u64 << exponent);
    let jitter = salt.bytes().fold(attempt as u64, |value, byte| {
        value.wrapping_mul(31) + byte as u64
    }) % 251;
    Duration::from_millis((base_ms + jitter).min(30_000))
}

fn registered_program_recovery_from_slot(registration_slot: u64) -> u64 {
    registration_slot.saturating_sub(1)
}

async fn upsert_recovery_cursor(
    tx: &mut sqlx::Transaction<'_, sqlx::Postgres>,
    program_id: &str,
    last_signature: &str,
    last_processed_slot: u64,
) -> Result<()> {
    sqlx::query(
        r#"
        INSERT INTO indexer_program_cursors (
            program_id, listener_mode, last_signature, last_processed_slot, updated_at
        )
        VALUES ($1, $2, $3, $4, NOW())
        ON CONFLICT (program_id, listener_mode) DO UPDATE SET
            last_signature = EXCLUDED.last_signature,
            last_processed_slot = EXCLUDED.last_processed_slot,
            updated_at = NOW()
        "#,
    )
    .bind(program_id)
    .bind(YELLOWSTONE_RECOVERY_LISTENER_MODE)
    .bind(last_signature)
    .bind(last_processed_slot as i64)
    .execute(&mut **tx)
    .await?;
    Ok(())
}

async fn clear_recovery_cursor(
    tx: &mut sqlx::Transaction<'_, sqlx::Postgres>,
    program_id: &str,
) -> Result<()> {
    sqlx::query(
        r#"
        DELETE FROM indexer_program_cursors
        WHERE program_id = $1 AND listener_mode = $2
        "#,
    )
    .bind(program_id)
    .bind(YELLOWSTONE_RECOVERY_LISTENER_MODE)
    .execute(&mut **tx)
    .await?;
    Ok(())
}

fn logs_contain_programs(logs: &[String], program_ids: &BTreeSet<String>) -> bool {
    program_ids
        .iter()
        .any(|program_id| logs.iter().any(|log| log.contains(program_id)))
}

#[derive(Debug, Clone, PartialEq, Eq)]
enum RecoveryProgramChange {
    Registered(String),
    Removed(String),
}

fn extract_recovery_program_changes(
    logs: &[String],
    registry_factory_program_id: Option<&str>,
) -> Vec<RecoveryProgramChange> {
    let Some(registry_program_id) = registry_factory_program_id else {
        return Vec::new();
    };
    if !logs.iter().any(|log| log.contains(registry_program_id)) {
        return Vec::new();
    }

    let mut changes = Vec::new();
    for log in logs {
        let lower = log.to_ascii_lowercase();
        let kind = if log.contains("扩展程序注册成功")
            || lower.contains("extension registered")
            || lower.contains("register extension")
        {
            Some(true)
        } else if log.contains("扩展程序移除成功")
            || lower.contains("extension removed")
            || lower.contains("remove extension")
        {
            Some(false)
        } else {
            None
        };
        let Some(registered) = kind else {
            continue;
        };
        for token in log.split(|character: char| {
            character.is_whitespace()
                || matches!(
                    character,
                    ':' | ',' | ';' | '(' | ')' | '[' | ']' | '{' | '}'
                )
        }) {
            let sanitized =
                token.trim_matches(|character: char| !character.is_ascii_alphanumeric());
            if let Ok(program_id) = Pubkey::from_str(sanitized) {
                changes.push(if registered {
                    RecoveryProgramChange::Registered(program_id.to_string())
                } else {
                    RecoveryProgramChange::Removed(program_id.to_string())
                });
                break;
            }
        }
    }
    changes
}

fn truncate_error(message: &str, max_len: usize) -> String {
    message.chars().take(max_len).collect()
}

fn durable_resume_slot(
    projected_transaction_slot: Option<u64>,
    verified_coverage_slot: Option<u64>,
) -> Option<u64> {
    match (projected_transaction_slot, verified_coverage_slot) {
        (Some(projected), Some(coverage)) => Some(projected.max(coverage)),
        (Some(projected), None) => Some(projected),
        (None, Some(coverage)) => Some(coverage),
        (None, None) => None,
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn recovery_only_activates_outside_replay_window_or_when_persisted() {
        assert_eq!(
            recovery_decision(None, Some(9_400), Some(9_500), 10_000, 600),
            RecoveryDecision::NotRequired
        );
        assert_eq!(
            recovery_decision(None, Some(8_000), Some(8_000), 10_000, 600),
            RecoveryDecision::Recover {
                from_slot: 8_000,
                target_slot: 10_000
            }
        );
        assert_eq!(
            recovery_decision(Some((7_000, 9_000)), Some(8_000), Some(8_500), 10_000, 600,),
            RecoveryDecision::Recover {
                from_slot: 7_000,
                target_slot: 9_000
            }
        );
        assert_eq!(
            recovery_decision(None, Some(9_700), Some(8_000), 10_000, 600),
            RecoveryDecision::NotRequired
        );
    }

    #[test]
    fn recovery_head_cache_bounds_get_slot_during_reconnect_storms() {
        let started_at = Instant::now();
        let refresh_interval = recovery_head_refresh_interval(6_000);
        let mut cache = RecoveryHeadCache::default();
        let mut refreshes = 0;

        for reconnect in 0..100 {
            let now = started_at + Duration::from_secs(reconnect);
            if cache.fresh_slot(now, refresh_interval).is_none() {
                refreshes += 1;
                cache.record(10_000, now);
            }
        }

        assert_eq!(refresh_interval, Duration::from_secs(300));
        assert_eq!(refreshes, 1);
        assert_eq!(
            cache.fresh_slot(started_at + Duration::from_secs(301), refresh_interval),
            None
        );
    }

    #[test]
    fn stream_progress_advances_recovery_head_without_refreshing_on_old_slots() {
        let started_at = Instant::now();
        let mut cache = RecoveryHeadCache::default();

        assert!(cache.record_progress(10_001, started_at));
        assert!(!cache.record_progress(10_000, started_at + Duration::from_secs(1)));
        assert_eq!(
            cache.fresh_slot(started_at + Duration::from_secs(2), Duration::from_secs(3)),
            Some(10_001)
        );
        assert_eq!(
            cache.fresh_slot(started_at + Duration::from_secs(3), Duration::from_secs(3)),
            None
        );
    }

    #[test]
    fn recovery_head_refresh_interval_tracks_half_window_with_safe_bounds() {
        assert_eq!(recovery_head_refresh_interval(1), Duration::from_secs(1));
        assert_eq!(recovery_head_refresh_interval(100), Duration::from_secs(20));
        assert_eq!(
            recovery_head_refresh_interval(u64::MAX),
            Duration::from_secs(300)
        );
    }

    #[test]
    fn durable_resume_uses_the_newer_of_projected_transaction_and_verified_coverage() {
        assert_eq!(durable_resume_slot(Some(8_000), Some(9_000)), Some(9_000));
        assert_eq!(durable_resume_slot(Some(9_500), Some(9_000)), Some(9_500));
        assert_eq!(durable_resume_slot(None, Some(9_000)), Some(9_000));
        assert_eq!(durable_resume_slot(Some(9_000), None), Some(9_000));
        assert_eq!(durable_resume_slot(None, None), None);
    }

    #[test]
    fn missing_coverage_baseline_forces_one_time_bounded_recovery() {
        assert_eq!(
            recovery_decision(None, None, Some(9_500), 10_000, 600),
            RecoveryDecision::Recover {
                from_slot: 9_500,
                target_slot: 10_000,
            }
        );
        assert_eq!(
            recovery_decision(None, None, None, 10_000, 600),
            RecoveryDecision::Recover {
                from_slot: 9_400,
                target_slot: 10_000,
            }
        );
    }

    #[test]
    fn recovery_backoff_is_bounded_and_jittered() {
        let first = recovery_backoff(1, "signatures");
        let second = recovery_backoff(2, "signatures");
        assert!(second > first);
        assert!(recovery_backoff(99, "signatures") <= Duration::from_secs(30));
        assert_ne!(
            recovery_backoff(3, "signatures"),
            recovery_backoff(3, "transaction")
        );
    }

    #[test]
    fn recovery_queue_orders_by_slot_then_transaction_index() {
        let source = include_str!("recovery.rs");
        assert!(source.contains("ORDER BY slot ASC, transaction_index ASC, signature ASC"));
        assert!(source.contains("get_block_signatures"));
        assert!(source.contains("listener_mode = $1"));
    }

    #[test]
    fn recovery_detects_extension_generation_changes_for_compensation() {
        let registry = Pubkey::new_unique().to_string();
        let extension = Pubkey::new_unique().to_string();
        let logs = vec![
            format!("Program {registry} invoke [1]"),
            format!("Program log: Extension registered: {extension}"),
        ];
        assert_eq!(
            extract_recovery_program_changes(&logs, Some(&registry)),
            vec![RecoveryProgramChange::Registered(extension)]
        );
    }

    #[test]
    fn registered_program_backfill_includes_the_registration_slot() {
        assert_eq!(registered_program_recovery_from_slot(400), 399);
        assert_eq!(registered_program_recovery_from_slot(0), 0);
    }
}
