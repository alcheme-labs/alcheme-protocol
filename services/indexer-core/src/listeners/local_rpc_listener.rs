use alcheme_shared::ProtocolEvent;
use anyhow::{anyhow, Context, Result};
use futures::stream::{self, StreamExt};
use hyper::body::to_bytes;
use hyper::client::HttpConnector;
use hyper::{Body, Client as HyperClient, Method, Request, Uri};
use serde::Deserialize;
use serde_json::{json, Value};
use solana_sdk::pubkey::Pubkey;
use std::collections::BTreeSet;
use std::str::FromStr;
use tokio::time::{sleep, Duration};
use tracing::{debug, info, warn};

use crate::database::checkpoint::CheckpointManager;
use crate::database::RuntimeStateStore;
use crate::metrics;
use crate::parsers::event_parser::{
    content_post_snapshot_target_for_event, EventParser, EventProjectionContext,
};

pub struct LocalRpcListener {
    rpc_client: RpcJsonClient,
    checkpoint_manager: CheckpointManager,
    runtime_state_store: RuntimeStateStore,
    event_parser: EventParser,
    registry_factory_program_id: Option<String>,
    base_program_ids: BTreeSet<String>,
    discovered_extension_program_ids: BTreeSet<String>,
    enable_extension_auto_discovery: bool,
    poll_interval: Duration,
    max_slots_per_tick: u64,
    initial_backfill_slots: u64,
    max_retries_per_slot: u32,
    max_retries_per_tx: u32,
    max_failed_txs_per_slot: u32,
    max_concurrent_tx_fetches: u32,
    failed_slot_replay_batch_size: u32,
    failed_slot_replay_interval: Duration,
    failed_slot_resolved_retention_seconds: u64,
    failed_slot_prune_interval: Duration,
    failed_slot_prune_batch_size: u32,
}

impl LocalRpcListener {
    #[allow(clippy::too_many_arguments)]
    pub fn new(
        rpc_url: String,
        checkpoint_manager: CheckpointManager,
        runtime_state_store: RuntimeStateStore,
        event_parser: EventParser,
        tracked_program_ids: Vec<String>,
        registry_factory_program_id: Option<String>,
        extension_program_ids: Vec<String>,
        enable_extension_auto_discovery: bool,
        poll_interval_ms: u64,
        max_slots_per_tick: usize,
        initial_backfill_slots: usize,
        max_retries_per_slot: u32,
        max_retries_per_tx: u32,
        max_failed_txs_per_slot: u32,
        max_concurrent_tx_fetches: u32,
        request_timeout_ms: u64,
        failed_slot_replay_batch_size: u32,
        failed_slot_replay_interval_ms: u64,
        failed_slot_resolved_retention_seconds: u64,
        failed_slot_prune_interval_ms: u64,
        failed_slot_prune_batch_size: u32,
    ) -> Self {
        let mut base_program_ids = tracked_program_ids.into_iter().collect::<BTreeSet<_>>();
        for extension_program_id in extension_program_ids {
            base_program_ids.insert(extension_program_id);
        }

        Self {
            rpc_client: RpcJsonClient::new(rpc_url, request_timeout_ms),
            checkpoint_manager,
            runtime_state_store,
            event_parser,
            registry_factory_program_id,
            base_program_ids,
            discovered_extension_program_ids: BTreeSet::new(),
            enable_extension_auto_discovery,
            poll_interval: Duration::from_millis(poll_interval_ms.max(250)),
            max_slots_per_tick: (max_slots_per_tick.max(1)) as u64,
            initial_backfill_slots: initial_backfill_slots as u64,
            max_retries_per_slot: max_retries_per_slot.max(1),
            max_retries_per_tx,
            max_failed_txs_per_slot: max_failed_txs_per_slot.max(1),
            max_concurrent_tx_fetches: max_concurrent_tx_fetches.max(1),
            failed_slot_replay_batch_size: failed_slot_replay_batch_size.max(1),
            failed_slot_replay_interval: Duration::from_millis(
                failed_slot_replay_interval_ms.max(500),
            ),
            failed_slot_resolved_retention_seconds: failed_slot_resolved_retention_seconds.max(60),
            failed_slot_prune_interval: Duration::from_millis(
                failed_slot_prune_interval_ms.max(1000),
            ),
            failed_slot_prune_batch_size: failed_slot_prune_batch_size.max(1),
        }
    }

    pub async fn start(&mut self) -> Result<()> {
        self.runtime_state_store.mark_listener_started().await?;
        let last_processed_slot = self.checkpoint_manager.get_last_processed_slot().await?;
        let head_slot = self.rpc_client.get_slot().await?;

        let mut next_slot = match last_processed_slot {
            Some(slot) => {
                info!("Resuming local RPC slot polling from slot: {}", slot);
                slot.saturating_add(1)
            }
            None => {
                let start = head_slot.saturating_sub(self.initial_backfill_slots);
                info!(
                    "Starting local RPC slot polling from current head backfill window: start_slot={}, head_slot={}",
                    start, head_slot
                );
                start
            }
        };
        let mut last_retry_slot: Option<u64> = None;
        let mut retry_count_for_slot: u32 = 0;
        let mut next_failed_slot_replay_at = tokio::time::Instant::now();
        let mut next_failed_slot_prune_at =
            tokio::time::Instant::now() + self.failed_slot_prune_interval;
        self.refresh_failed_slot_metrics().await?;

        loop {
            let latest_slot = match self.rpc_client.get_slot().await {
                Ok(slot) => slot,
                Err(error) => {
                    warn!("Failed to fetch latest slot from local RPC: {:?}", error);
                    let _ = self
                        .runtime_state_store
                        .mark_error(&format!("local_head_slot_failed: {error}"))
                        .await;
                    sleep(self.poll_interval).await;
                    continue;
                }
            };

            if next_slot > latest_slot {
                let _ = self.runtime_state_store.mark_idle(Some(latest_slot)).await;
                if tokio::time::Instant::now() >= next_failed_slot_replay_at {
                    if let Err(error) = self.replay_pending_failed_slots().await {
                        warn!("Failed slot replay pass failed: {:?}", error);
                    }
                    next_failed_slot_replay_at =
                        tokio::time::Instant::now() + self.failed_slot_replay_interval;
                }
                if tokio::time::Instant::now() >= next_failed_slot_prune_at {
                    match self.prune_resolved_failed_slots().await {
                        Ok(pruned) => {
                            if pruned > 0 {
                                info!("Pruned {} resolved failed-slot records", pruned);
                            }
                        }
                        Err(error) => {
                            warn!("Failed to prune resolved failed-slot records: {:?}", error);
                        }
                    }
                    next_failed_slot_prune_at =
                        tokio::time::Instant::now() + self.failed_slot_prune_interval;
                }
                sleep(self.poll_interval).await;
                continue;
            }

            let end_slot = std::cmp::min(
                latest_slot,
                next_slot.saturating_add(self.max_slots_per_tick - 1),
            );
            debug!(
                "Local RPC polling slot range [{}, {}] (latest={})",
                next_slot, end_slot, latest_slot
            );

            let mut retry_from_slot: Option<u64> = None;
            let mut retry_error: Option<String> = None;
            for slot in next_slot..=end_slot {
                if let Err(error) = self.process_slot(slot).await {
                    warn!("Failed to process slot {}: {:?}", slot, error);
                    let _ = self
                        .runtime_state_store
                        .mark_error(&format!("local_process_slot_failed[{slot}]: {error}"))
                        .await;
                    retry_from_slot = Some(slot);
                    retry_error = Some(error.to_string());
                    break;
                }

                if let Err(error) = self.checkpoint_manager.update(slot).await {
                    warn!("Failed to update checkpoint for slot {}: {:?}", slot, error);
                    retry_from_slot = Some(slot);
                    retry_error = Some(format!("checkpoint update failed: {error}"));
                    break;
                }
                if let Err(error) = self.checkpoint_manager.resolve_failed_slot(slot).await {
                    warn!(
                        "Failed to mark slot {} as resolved in failed-slot table: {:?}",
                        slot, error
                    );
                }
            }

            if let Some(retry_slot) = retry_from_slot {
                if last_retry_slot == Some(retry_slot) {
                    retry_count_for_slot = retry_count_for_slot.saturating_add(1);
                } else {
                    last_retry_slot = Some(retry_slot);
                    retry_count_for_slot = 1;
                }

                if retry_count_for_slot >= self.max_retries_per_slot {
                    warn!(
                        "Skipping stuck slot {} after {} consecutive failures",
                        retry_slot, retry_count_for_slot
                    );
                    let failed_reason = retry_error
                        .clone()
                        .unwrap_or_else(|| "local-rpc slot processing failed".to_string());
                    if let Err(error) = self
                        .checkpoint_manager
                        .mark_failed_slot(retry_slot, "local", &failed_reason)
                        .await
                    {
                        warn!(
                            "Failed to record failed slot {} in indexer_failed_slots: {:?}",
                            retry_slot, error
                        );
                    }
                    metrics::record_local_failed_slot_skipped();
                    match self.checkpoint_manager.update(retry_slot).await {
                        Ok(_) => {
                            next_slot = retry_slot.saturating_add(1);
                            last_retry_slot = None;
                            retry_count_for_slot = 0;
                        }
                        Err(error) => {
                            warn!(
                                "Failed to advance checkpoint when skipping slot {}: {:?}",
                                retry_slot, error
                            );
                            next_slot = retry_slot;
                        }
                    }
                    if let Err(error) = self.refresh_failed_slot_metrics().await {
                        warn!("Failed to refresh failed-slot metrics: {:?}", error);
                    }
                    sleep(self.poll_interval).await;
                    continue;
                }

                debug!(
                    "Retrying from slot {} due to transient fetch/process/checkpoint failure (attempt {}/{})",
                    retry_slot,
                    retry_count_for_slot,
                    self.max_retries_per_slot
                );
                next_slot = retry_slot;
                sleep(self.poll_interval).await;
                continue;
            }

            last_retry_slot = None;
            retry_count_for_slot = 0;
            next_slot = end_slot.saturating_add(1);

            if tokio::time::Instant::now() >= next_failed_slot_prune_at {
                match self.prune_resolved_failed_slots().await {
                    Ok(pruned) => {
                        if pruned > 0 {
                            info!("Pruned {} resolved failed-slot records", pruned);
                        }
                    }
                    Err(error) => {
                        warn!("Failed to prune resolved failed-slot records: {:?}", error);
                    }
                }
                next_failed_slot_prune_at =
                    tokio::time::Instant::now() + self.failed_slot_prune_interval;
            }

            if next_slot > latest_slot {
                sleep(self.poll_interval).await;
            }
        }
    }

    async fn process_slot(&mut self, slot: u64) -> Result<()> {
        let signatures = match self.rpc_client.get_block_signatures(slot).await {
            Ok(Some(signatures)) => signatures,
            Ok(None) => {
                debug!("Slot {} has no block data (skipped/unavailable)", slot);
                let _ = self.runtime_state_store.mark_idle(Some(slot)).await;
                return Ok(());
            }
            Err(error) => {
                return Err(anyhow!(
                    "failed to fetch block signatures for slot {}: {error}",
                    slot
                ));
            }
        };
        self.runtime_state_store
            .mark_slot_started(slot, signatures.len())
            .await?;

        let rpc_client = self.rpc_client.clone();
        let max_retries_per_tx = self.max_retries_per_tx;
        let max_concurrent_tx_fetches = self.max_concurrent_tx_fetches as usize;
        let tx_count = signatures.len();
        let mut tx_fetches = stream::iter(signatures.into_iter().enumerate().map(
            move |(idx, signature)| {
                fetch_transaction_with_retry(rpc_client.clone(), idx, signature, max_retries_per_tx)
            },
        ))
        .buffer_unordered(max_concurrent_tx_fetches);
        let mut fetched_results: Vec<(usize, String, Result<Option<RpcTransactionResult>>, u32)> =
            Vec::new();
        while let Some(item) = tx_fetches.next().await {
            fetched_results.push(item);
        }
        fetched_results.sort_by_key(|(idx, ..)| *idx);

        let mut failed_txs_in_slot: u32 = 0;
        for (idx, signature, tx_result, tx_attempt) in fetched_results {
            let _ = self
                .runtime_state_store
                .mark_tx_progress(slot, Some(tx_count), idx, Some(&signature))
                .await;
            match tx_result {
                Ok(Some(transaction)) => {
                    if let Err(error) = self
                        .process_fetched_transaction(slot, &signature, transaction)
                        .await
                    {
                        warn!(
                            "Failed to process tx {} at slot {} after {} attempt(s): {:?}",
                            signature, slot, tx_attempt, error
                        );
                        failed_txs_in_slot = failed_txs_in_slot.saturating_add(1);
                    }
                }
                Ok(None) => {}
                Err(error) => {
                    warn!(
                        "Failed to fetch tx {} at slot {} after {} attempt(s): {:?}",
                        signature, slot, tx_attempt, error
                    );
                    failed_txs_in_slot = failed_txs_in_slot.saturating_add(1);
                }
            }

            if failed_txs_in_slot >= self.max_failed_txs_per_slot {
                return Err(anyhow!(
                    "slot {} exceeded max failed txs ({}) while processing local rpc batch",
                    slot,
                    self.max_failed_txs_per_slot
                ));
            }
        }

        self.runtime_state_store.mark_slot_completed(slot).await?;
        Ok(())
    }

    async fn replay_pending_failed_slots(&mut self) -> Result<()> {
        let replay_slots = self
            .checkpoint_manager
            .list_pending_failed_slots(self.failed_slot_replay_batch_size)
            .await?;
        if replay_slots.is_empty() {
            self.refresh_failed_slot_metrics().await?;
            return Ok(());
        }

        for slot in replay_slots {
            match self.process_slot(slot).await {
                Ok(_) => {
                    self.checkpoint_manager.resolve_failed_slot(slot).await?;
                    metrics::record_local_failed_slot_replay(true);
                    info!("Recovered failed slot {} via replay", slot);
                }
                Err(error) => {
                    metrics::record_local_failed_slot_replay(false);
                    warn!("Replay failed for slot {}: {:?}", slot, error);
                    if let Err(mark_error) = self
                        .checkpoint_manager
                        .mark_failed_slot(slot, "local", &format!("replay_failed: {error}"))
                        .await
                    {
                        warn!(
                            "Failed to update failed-slot retry metadata for slot {}: {:?}",
                            slot, mark_error
                        );
                    }
                }
            }
        }
        self.refresh_failed_slot_metrics().await?;
        Ok(())
    }

    async fn refresh_failed_slot_metrics(&self) -> Result<()> {
        let stats = self.checkpoint_manager.pending_failed_slot_stats().await?;
        metrics::set_local_failed_slots_pending(stats.pending_count);
        metrics::set_local_failed_slot_oldest_age_seconds(stats.oldest_age_seconds);
        Ok(())
    }

    async fn prune_resolved_failed_slots(&self) -> Result<u64> {
        self.checkpoint_manager
            .prune_resolved_failed_slots(
                self.failed_slot_resolved_retention_seconds,
                self.failed_slot_prune_batch_size,
            )
            .await
    }

    async fn process_fetched_transaction(
        &mut self,
        slot: u64,
        signature: &str,
        transaction: RpcTransactionResult,
    ) -> Result<()> {
        let tracked_program_ids = self.current_program_ids();

        if transaction.err() {
            return Ok(());
        }

        let logs = transaction.log_messages();
        if logs.is_empty() || !logs_contain_programs(&logs, &tracked_program_ids) {
            return Ok(());
        }

        let events = self.event_parser.parse_logs(&logs).await?;
        if !events.is_empty() {
            info!(
                "Extracted {} events from local block slot {} tx {}",
                events.len(),
                slot,
                signature
            );
            self.event_parser
                .process_events(
                    events.clone(),
                    EventProjectionContext {
                        slot: Some(slot),
                        signature: Some(signature.to_string()),
                    },
                )
                .await?;
            self.reconcile_tx_scoped_addresses(&events, &transaction)
                .await?;
        }

        if self.enable_extension_auto_discovery {
            let changes = self.extract_extension_registry_changes(&logs);
            if !changes.is_empty() {
                self.apply_extension_registry_changes(changes);
            }
        }

        Ok(())
    }

    async fn reconcile_tx_scoped_addresses(
        &self,
        events: &[ProtocolEvent],
        transaction: &RpcTransactionResult,
    ) -> Result<()> {
        let Some(knowledge_on_chain_address) =
            extract_primary_account_from_single_instruction_tx(transaction)
        else {
            return Ok(());
        };

        for event in events {
            if let Some(content_id) = content_post_snapshot_target_for_event(event) {
                let content_pubkey =
                    Pubkey::from_str(&knowledge_on_chain_address).map_err(|error| {
                        anyhow!(
                            "failed to parse content account pubkey {}: {}",
                            knowledge_on_chain_address,
                            error
                        )
                    })?;
                self.event_parser
                    .reconcile_content_post_account_snapshot(&content_id, &content_pubkey)
                    .await?;
                continue;
            }

            match event {
                ProtocolEvent::KnowledgeSubmitted { knowledge_id, .. }
                | ProtocolEvent::ContributorsUpdated { knowledge_id, .. } => {
                    let content_pubkey =
                        Pubkey::from_str(&knowledge_on_chain_address).map_err(|error| {
                            anyhow!(
                                "failed to parse knowledge account pubkey {}: {}",
                                knowledge_on_chain_address,
                                error
                            )
                        })?;
                    self.event_parser
                        .reconcile_knowledge_account_snapshot(
                            &hex::encode(knowledge_id),
                            &content_pubkey,
                        )
                        .await?;
                }
                _ => {}
            }
        }

        Ok(())
    }

    fn extract_extension_registry_changes(&self, logs: &[String]) -> Vec<ExtensionRegistryChange> {
        let registry_factory_program_id = match &self.registry_factory_program_id {
            Some(program_id) => program_id,
            None => return Vec::new(),
        };

        if !logs
            .iter()
            .any(|log| log.contains(registry_factory_program_id))
        {
            return Vec::new();
        }

        let mut changes = Vec::new();
        for log in logs {
            if let Some(program_id) = extract_program_id_from_log(log) {
                if is_extension_registered_log(log) {
                    changes.push(ExtensionRegistryChange::Registered(program_id));
                } else if is_extension_removed_log(log) {
                    changes.push(ExtensionRegistryChange::Removed(program_id));
                }
            }
        }

        changes
    }

    fn apply_extension_registry_changes(&mut self, changes: Vec<ExtensionRegistryChange>) -> bool {
        let mut changed = false;

        for change in changes {
            match change {
                ExtensionRegistryChange::Registered(program_id) => {
                    if self
                        .discovered_extension_program_ids
                        .insert(program_id.clone())
                    {
                        info!(
                            "Discovered extension program from registry logs: {}",
                            program_id
                        );
                        changed = true;
                    }
                }
                ExtensionRegistryChange::Removed(program_id) => {
                    if self.discovered_extension_program_ids.remove(&program_id) {
                        info!(
                            "Removed extension program from discovered set: {}",
                            program_id
                        );
                        changed = true;
                    }
                }
            }
        }

        changed
    }

    fn current_program_ids(&self) -> Vec<String> {
        self.base_program_ids
            .union(&self.discovered_extension_program_ids)
            .cloned()
            .collect()
    }
}

async fn fetch_transaction_with_retry(
    rpc_client: RpcJsonClient,
    idx: usize,
    signature: String,
    max_retries_per_tx: u32,
) -> (usize, String, Result<Option<RpcTransactionResult>>, u32) {
    let mut tx_attempt: u32 = 0;
    loop {
        tx_attempt = tx_attempt.saturating_add(1);
        match rpc_client.get_transaction(&signature).await {
            Ok(tx) => return (idx, signature, Ok(tx), tx_attempt),
            Err(error) => {
                if tx_attempt > max_retries_per_tx {
                    return (idx, signature, Err(error), tx_attempt);
                }
                sleep(Duration::from_millis(100)).await;
            }
        }
    }
}

#[derive(Debug, Clone)]
pub(crate) struct RpcJsonClient {
    endpoint: Uri,
    client: HyperClient<HttpConnector, Body>,
    request_timeout: Duration,
}

impl RpcJsonClient {
    pub(crate) fn new(endpoint: String, request_timeout_ms: u64) -> Self {
        let endpoint = endpoint
            .parse::<Uri>()
            .expect("Invalid SOLANA_RPC_URL for local RPC mode");
        let connector = HttpConnector::new();
        let client = HyperClient::builder().build::<_, Body>(connector);

        Self {
            endpoint,
            client,
            request_timeout: Duration::from_millis(request_timeout_ms.max(500)),
        }
    }

    pub(crate) async fn get_slot(&self) -> Result<u64> {
        let response = self
            .call_raw("getSlot", json!([{ "commitment": "confirmed" }]))
            .await?;

        if let Some(error) = response.error {
            return Err(anyhow!(
                "RPC method getSlot failed: code={}, message={}",
                error.code,
                error.message
            ));
        }

        let result = response
            .result
            .ok_or_else(|| anyhow!("RPC getSlot returned no result"))?;
        serde_json::from_value::<u64>(result).context("Failed to decode getSlot result as u64")
    }

    async fn get_block_signatures(&self, slot: u64) -> Result<Option<Vec<String>>> {
        let response = self
            .call_raw(
                "getBlock",
                json!([
                    slot,
                    {
                        "encoding": "json",
                        "transactionDetails": "signatures",
                        "rewards": false,
                        "commitment": "confirmed",
                        "maxSupportedTransactionVersion": 0
                    }
                ]),
            )
            .await?;

        if let Some(error) = response.error {
            if is_ignorable_block_error(&error) {
                return Ok(None);
            }
            return Err(anyhow!(
                "RPC method getBlock failed for slot {}: code={}, message={}",
                slot,
                error.code,
                error.message
            ));
        }

        let Some(result) = response.result else {
            return Ok(None);
        };

        let block = serde_json::from_value::<Option<RpcBlockSignaturesResult>>(result)
            .context("Failed to decode getBlock signatures result")?;
        Ok(block.map(|b| b.signatures))
    }

    pub(crate) async fn get_transaction(&self, signature: &str) -> Result<Option<RpcTransactionResult>> {
        let response = self
            .call_raw(
                "getTransaction",
                json!([
                    signature,
                    {
                        "encoding": "json",
                        "commitment": "confirmed",
                        "maxSupportedTransactionVersion": 0
                    }
                ]),
            )
            .await?;

        if let Some(error) = response.error {
            let message = error.message.to_ascii_lowercase();
            let data_text = error
                .data
                .as_ref()
                .map(|value| value.to_string().to_ascii_lowercase())
                .unwrap_or_default();
            let context = format!("{} {}", message, data_text);
            let ignorable = context.contains("transaction version")
                || context.contains("not found")
                || context.contains("already rooted");
            if ignorable {
                return Ok(None);
            }

            return Err(anyhow!(
                "RPC method getTransaction failed for signature {}: code={}, message={}",
                signature,
                error.code,
                error.message
            ));
        }

        let Some(result) = response.result else {
            return Ok(None);
        };

        serde_json::from_value::<Option<RpcTransactionResult>>(result)
            .context("Failed to decode getTransaction result")
    }

    pub(crate) async fn get_signatures_for_address(
        &self,
        address: &str,
        before: Option<&str>,
        limit: usize,
    ) -> Result<Vec<(String, u64)>> {
        let mut config = json!({
            "limit": limit.max(1).min(1000),
            "commitment": "confirmed"
        });
        if let Some(before_signature) = before {
            config["before"] = Value::String(before_signature.to_string());
        }

        let response = self
            .call_raw("getSignaturesForAddress", json!([address, config]))
            .await?;

        if let Some(error) = response.error {
            return Err(anyhow!(
                "RPC method getSignaturesForAddress failed for address {}: code={}, message={}",
                address,
                error.code,
                error.message
            ));
        }

        let result = response
            .result
            .ok_or_else(|| anyhow!("RPC getSignaturesForAddress returned no result"))?;
        let rows = serde_json::from_value::<Vec<RpcAddressSignatureResult>>(result)
            .context("Failed to decode getSignaturesForAddress result")?;

        Ok(rows
            .into_iter()
            .map(|row| (row.signature, row.slot))
            .collect())
    }

    pub(crate) async fn call_raw(&self, method: &str, params: Value) -> Result<RpcResponse<Value>> {
        let payload = json!({
            "jsonrpc": "2.0",
            "id": 1,
            "method": method,
            "params": params
        });

        let request = Request::builder()
            .method(Method::POST)
            .uri(self.endpoint.clone())
            .header("content-type", "application/json")
            .body(Body::from(payload.to_string()))
            .context("Failed to build RPC request")?;

        let response = tokio::time::timeout(self.request_timeout, self.client.request(request))
            .await
            .with_context(|| format!("RPC request timeout: {}", method))?
            .with_context(|| format!("RPC transport error: {}", method))?;

        if !response.status().is_success() {
            return Err(anyhow!(
                "RPC request returned HTTP {} for method {}",
                response.status(),
                method
            ));
        }

        let body_bytes = tokio::time::timeout(self.request_timeout, to_bytes(response.into_body()))
            .await
            .with_context(|| format!("RPC response body timeout: {}", method))?
            .with_context(|| format!("Failed to read RPC response body: {}", method))?;
        let body = serde_json::from_slice::<RpcResponse<Value>>(&body_bytes)
            .with_context(|| format!("Failed to decode RPC response: {}", method))?;

        Ok(body)
    }
}

#[derive(Debug, Deserialize)]
pub(crate) struct RpcResponse<T> {
    result: Option<T>,
    error: Option<RpcError>,
}

#[derive(Debug, Deserialize)]
pub(crate) struct RpcError {
    code: i64,
    message: String,
    #[serde(default)]
    data: Option<Value>,
}

#[derive(Debug, Deserialize)]
struct RpcBlockSignaturesResult {
    #[serde(default)]
    signatures: Vec<String>,
}

#[derive(Debug, Deserialize)]
struct RpcAddressSignatureResult {
    signature: String,
    slot: u64,
}

#[derive(Debug, Deserialize)]
pub(crate) struct RpcTransactionResult {
    #[serde(default)]
    pub(crate) transaction: Option<RpcEncodedTransaction>,
    #[serde(default)]
    pub(crate) meta: Option<RpcTransactionMeta>,
}

#[derive(Debug, Deserialize)]
pub(crate) struct RpcTransactionMeta {
    #[serde(default, rename = "logMessages")]
    pub(crate) log_messages: Option<Vec<String>>,
    #[serde(default)]
    pub(crate) err: Option<Value>,
}

#[derive(Debug, Deserialize)]
pub(crate) struct RpcEncodedTransaction {
    pub(crate) message: RpcTransactionMessage,
}

#[derive(Debug, Deserialize)]
pub(crate) struct RpcTransactionMessage {
    #[serde(default, rename = "accountKeys")]
    pub(crate) account_keys: Vec<String>,
    #[serde(default)]
    pub(crate) instructions: Vec<RpcCompiledInstruction>,
}

#[derive(Debug, Deserialize)]
pub(crate) struct RpcCompiledInstruction {
    #[serde(default, rename = "programIdIndex")]
    pub(crate) program_id_index: usize,
    #[serde(default)]
    pub(crate) accounts: Vec<usize>,
}

impl RpcTransactionResult {
    pub(crate) fn err(&self) -> bool {
        self.meta.as_ref().and_then(|m| m.err.as_ref()).is_some()
    }

    pub(crate) fn log_messages(&self) -> Vec<String> {
        self.meta
            .as_ref()
            .and_then(|m| m.log_messages.clone())
            .unwrap_or_default()
    }
}

#[derive(Debug)]
enum ExtensionRegistryChange {
    Registered(String),
    Removed(String),
}

fn logs_contain_programs(logs: &[String], program_ids: &[String]) -> bool {
    program_ids
        .iter()
        .any(|program_id| logs.iter().any(|log| log.contains(program_id)))
}

fn is_ignorable_block_error(error: &RpcError) -> bool {
    let message = error.message.to_ascii_lowercase();
    let data_text = error
        .data
        .as_ref()
        .map(|value| value.to_string().to_ascii_lowercase())
        .unwrap_or_default();
    let context = format!("{} {}", message, data_text);

    context.contains("slot was skipped")
        || context.contains("block not available")
        || context.contains("long-term storage")
        // Some local validators wrap skippable slot errors as {-32603, "Internal error"}
        // and put the real reason in `error.data`.
        || (error.code == -32603
            && message.contains("internal error")
            && (context.contains("skipped")
                || context.contains("block not available")
                || context.contains("long-term storage")))
}

fn is_extension_registered_log(log: &str) -> bool {
    let lower = log.to_ascii_lowercase();
    log.contains("扩展程序注册成功")
        || lower.contains("extension registered")
        || lower.contains("register extension")
}

fn is_extension_removed_log(log: &str) -> bool {
    let lower = log.to_ascii_lowercase();
    log.contains("扩展程序移除成功")
        || lower.contains("extension removed")
        || lower.contains("remove extension")
}

fn extract_program_id_from_log(log: &str) -> Option<String> {
    for token in log.split(|c: char| {
        c.is_whitespace() || matches!(c, ':' | ',' | ';' | '(' | ')' | '[' | ']' | '{' | '}')
    }) {
        if let Some(pubkey) = parse_pubkey_token(token) {
            return Some(pubkey);
        }
    }

    None
}

fn parse_pubkey_token(token: &str) -> Option<String> {
    let sanitized = token.trim_matches(|c: char| !c.is_ascii_alphanumeric());
    if sanitized.is_empty() {
        return None;
    }

    Pubkey::from_str(sanitized)
        .ok()
        .map(|pubkey| pubkey.to_string())
}

fn extract_primary_account_from_single_instruction_tx(
    transaction: &RpcTransactionResult,
) -> Option<String> {
    let message = &transaction.transaction.as_ref()?.message;
    let mut candidate_instructions = message.instructions.iter().filter(|instruction| {
        message
            .account_keys
            .get(instruction.program_id_index)
            .map(String::as_str)
            != Some("ComputeBudget111111111111111111111111111111")
    });

    let instruction = candidate_instructions.next()?;
    if candidate_instructions.next().is_some() {
        return None;
    }
    let primary_account_index = *instruction.accounts.first()?;
    message.account_keys.get(primary_account_index).cloned()
}

#[cfg(test)]
mod tests {
    use super::*;
    use serde_json::json;

    #[test]
    fn extracts_primary_account_from_single_instruction_transaction() {
        let tx: RpcTransactionResult = serde_json::from_value(json!({
            "transaction": {
                "message": {
                    "accountKeys": [
                        "3cYUAYFF5uqxU2rKDGivsP7WcSPAodzKfwKca2tk3FWf",
                        "DfXQReZcMkcWLv6LK9eeCCCo1M94Nv5eVwG9tAs3WRFn",
                        "GZswb1rGbZfoiapkvatDuMZrptVAX2p1pEVDSrMuyLqQ"
                    ],
                    "instructions": [
                        {
                            "programIdIndex": 2,
                            "accounts": [0, 1]
                        }
                    ]
                }
            },
            "meta": {
                "logMessages": [
                    "Program GZswb1rGbZfoiapkvatDuMZrptVAX2p1pEVDSrMuyLqQ invoke [1]",
                    "Program log: Instruction: SubmitKnowledge"
                ]
            }
        }))
        .expect("sample tx should deserialize");

        assert_eq!(
            extract_primary_account_from_single_instruction_tx(&tx),
            Some("3cYUAYFF5uqxU2rKDGivsP7WcSPAodzKfwKca2tk3FWf".to_string())
        );
    }

    #[test]
    fn refuses_to_guess_when_transaction_has_multiple_top_level_instructions() {
        let tx: RpcTransactionResult = serde_json::from_value(json!({
            "transaction": {
                "message": {
                    "accountKeys": [
                        "3cYUAYFF5uqxU2rKDGivsP7WcSPAodzKfwKca2tk3FWf",
                        "DfXQReZcMkcWLv6LK9eeCCCo1M94Nv5eVwG9tAs3WRFn",
                        "GZswb1rGbZfoiapkvatDuMZrptVAX2p1pEVDSrMuyLqQ"
                    ],
                    "instructions": [
                        {
                            "programIdIndex": 2,
                            "accounts": [0, 1]
                        },
                        {
                            "programIdIndex": 2,
                            "accounts": [1, 0]
                        }
                    ]
                }
            },
            "meta": {
                "logMessages": [
                    "Program GZswb1rGbZfoiapkvatDuMZrptVAX2p1pEVDSrMuyLqQ invoke [1]",
                    "Program log: Instruction: SubmitKnowledge"
                ]
            }
        }))
        .expect("sample tx should deserialize");

        assert_eq!(
            extract_primary_account_from_single_instruction_tx(&tx),
            None
        );
    }

    #[test]
    fn ignores_compute_budget_instruction_when_deriving_primary_account() {
        let tx: RpcTransactionResult = serde_json::from_value(json!({
            "transaction": {
                "message": {
                    "accountKeys": [
                        "ComputeBudget111111111111111111111111111111",
                        "DC5UjsF7Zab35MgoxHrau8m4ezNEieVCbTeKisnm5NJR",
                        "DfXQReZcMkcWLv6LK9eeCCCo1M94Nv5eVwG9tAs3WRFn",
                        "GZswb1rGbZfoiapkvatDuMZrptVAX2p1pEVDSrMuyLqQ"
                    ],
                    "instructions": [
                        {
                            "programIdIndex": 0,
                            "accounts": []
                        },
                        {
                            "programIdIndex": 3,
                            "accounts": [1, 2]
                        }
                    ]
                }
            },
            "meta": {
                "logMessages": [
                    "Program ComputeBudget111111111111111111111111111111 invoke [1]",
                    "Program GZswb1rGbZfoiapkvatDuMZrptVAX2p1pEVDSrMuyLqQ invoke [1]",
                    "Program log: Instruction: SubmitKnowledge"
                ]
            }
        }))
        .expect("sample tx should deserialize");

        assert_eq!(
            extract_primary_account_from_single_instruction_tx(&tx),
            Some("DC5UjsF7Zab35MgoxHrau8m4ezNEieVCbTeKisnm5NJR".to_string())
        );
    }
}
