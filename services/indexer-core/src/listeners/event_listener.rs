use alcheme_shared::ProtocolEvent;
use anyhow::{anyhow, Result};
use futures::{SinkExt, StreamExt};
use prost::Message as ProstMessage;
use solana_sdk::pubkey::Pubkey;
use std::collections::BTreeSet;
use std::str::FromStr;
use std::time::{SystemTime, UNIX_EPOCH};
use tokio::time::{interval, sleep, Duration, MissedTickBehavior};
use tracing::{debug, error, info, warn};
use yellowstone_grpc_proto::prelude::subscribe_update::UpdateOneof;
use yellowstone_grpc_proto::prelude::*;

use crate::database::checkpoint::CheckpointManager;
use crate::database::RuntimeStateStore;
use crate::grpc::client::{build_heartbeat_request, AlchemeGrpcClient};
use crate::listeners::recovery::RecoveryCoordinator;
use crate::metrics;
use crate::parsers::event_parser::{
    content_post_snapshot_target_for_event, EventParser, EventProjectionContext,
};

pub struct EventListener {
    grpc_client: AlchemeGrpcClient,
    checkpoint_manager: CheckpointManager,
    runtime_state_store: RuntimeStateStore,
    event_parser: EventParser,
    registry_factory_program_id: Option<String>,
    base_program_ids: BTreeSet<String>,
    discovered_extension_program_ids: BTreeSet<String>,
    enable_extension_auto_discovery: bool,
    recovery_coordinator: RecoveryCoordinator,
}

impl EventListener {
    pub fn new(
        grpc_client: AlchemeGrpcClient,
        checkpoint_manager: CheckpointManager,
        runtime_state_store: RuntimeStateStore,
        event_parser: EventParser,
        registry_factory_program_id: Option<String>,
        extension_program_ids: Vec<String>,
        enable_extension_auto_discovery: bool,
        recovery_coordinator: RecoveryCoordinator,
    ) -> Self {
        let mut base_program_ids = grpc_client
            .tracked_program_ids()
            .iter()
            .cloned()
            .collect::<BTreeSet<_>>();

        for extension_program_id in extension_program_ids {
            base_program_ids.insert(extension_program_id);
        }

        Self {
            grpc_client,
            checkpoint_manager,
            runtime_state_store,
            event_parser,
            registry_factory_program_id,
            base_program_ids,
            discovered_extension_program_ids: BTreeSet::new(),
            enable_extension_auto_discovery,
            recovery_coordinator,
        }
    }

    pub async fn start(&mut self) -> Result<()> {
        self.runtime_state_store.mark_listener_started().await?;
        self.restore_discovered_extension_scope().await?;

        let mut event_count = 0u64;
        let mut reconnect_backoff = ReconnectBackoffState::default();
        loop {
            self.recovery_coordinator
                .update_discovered_extension_program_ids(
                    self.discovered_extension_program_ids
                        .iter()
                        .cloned()
                        .collect(),
                );
            let recovery_generation_hash = self.grpc_client.filter_generation_hash();
            let (mut stream_catchup_target_slot, start_slot) = match self
                .recovery_coordinator
                .recover_if_required(&recovery_generation_hash)
                .await
            {
                Ok(recovery_outcome) => {
                    self.apply_recovered_extension_scope(
                        recovery_outcome.discovered_extension_program_ids,
                    );
                    (
                        Some(recovery_outcome.stream_catchup_target_slot),
                        recovery_outcome.subscription_resume_slot,
                    )
                }
                Err(error) => {
                    metrics::set_grpc_connected(false);
                    metrics::record_grpc_reconnect("recovery_incomplete");
                    let (attempt, backoff) = reconnect_backoff.next_delay(reconnect_jitter_seed());
                    warn!(
                        attempt,
                        ?backoff,
                        "Yellowstone recovery is incomplete; preserving durable recovery state: {error}"
                    );
                    sleep(backoff).await;
                    continue;
                }
            };
            let filter_generation_hash = self.grpc_client.filter_generation_hash();
            self.runtime_state_store
                .mark_filter_generation(&filter_generation_hash, start_slot.unwrap_or_default())
                .await?;

            if let Some(slot) = start_slot {
                info!(
                    "Resuming Yellowstone subscription from durable slot: {}",
                    slot
                );
            } else {
                info!("Starting fresh Yellowstone subscription");
            }

            // 订阅事件流
            let (mut request_sink, mut stream) = match self.grpc_client.subscribe(start_slot).await
            {
                Ok(subscription) => subscription,
                Err(error) => {
                    metrics::set_grpc_connected(false);
                    metrics::record_grpc_reconnect("connect_failed");
                    let error_detail = bounded_error_chain(&error, 1000);
                    let _ = self
                        .runtime_state_store
                        .mark_error(&format!("yellowstone_connect_failed: {error_detail}"))
                        .await;
                    let (attempt, backoff) = reconnect_backoff.next_delay(reconnect_jitter_seed());
                    warn!(
                        "Failed to establish Yellowstone stream (attempt {}), retrying in {:?}: {}",
                        attempt, backoff, error_detail
                    );
                    sleep(backoff).await;
                    continue;
                }
            };
            metrics::set_grpc_connected(true);
            self.runtime_state_store.mark_stream_connected().await?;
            info!("✅ Event stream established, listening for events...");

            let mut should_resubscribe = false;
            let mut stream_failed = false;
            let mut heartbeat = interval(Duration::from_secs(15));
            heartbeat.set_missed_tick_behavior(MissedTickBehavior::Delay);
            heartbeat.tick().await;
            let mut heartbeat_id = 0i32;

            loop {
                let update_result = tokio::select! {
                    _ = heartbeat.tick() => {
                        heartbeat_id = next_heartbeat_id(heartbeat_id);
                        if let Err(error) = request_sink
                            .send(build_heartbeat_request(heartbeat_id))
                            .await
                        {
                            metrics::set_grpc_connected(false);
                            metrics::record_grpc_reconnect("heartbeat_send_failed");
                            stream_failed = true;
                            let _ = self
                                .runtime_state_store
                                .mark_error(&format!("yellowstone_heartbeat_send_failed: {error}"))
                                .await;
                            warn!("Failed to send Yellowstone heartbeat: {error}");
                            break;
                        }
                        continue;
                    }
                    update_result = stream.next() => update_result,
                };

                let Some(update_result) = update_result else {
                    break;
                };

                match update_result {
                    Ok(update) => {
                        let progress_slot = reconnect_progress_slot(update.update_oneof.as_ref());
                        let stream_observation = update
                            .update_oneof
                            .as_ref()
                            .map(stream_observation_for_update)
                            .unwrap_or_default();
                        metrics::record_grpc_update(
                            &filter_generation_hash,
                            grpc_update_type(&update),
                            update.encoded_len(),
                        );
                        if matches!(update.update_oneof.as_ref(), Some(UpdateOneof::Ping(_))) {
                            heartbeat_id = next_heartbeat_id(heartbeat_id);
                            if let Err(error) = request_sink
                                .send(build_heartbeat_request(heartbeat_id))
                                .await
                            {
                                metrics::set_grpc_connected(false);
                                metrics::record_grpc_reconnect("ping_reply_failed");
                                stream_failed = true;
                                let _ = self
                                    .runtime_state_store
                                    .mark_error(&format!("yellowstone_ping_reply_failed: {error}"))
                                    .await;
                                warn!("Failed to reply to Yellowstone ping: {error}");
                                break;
                            }
                        }

                        match self.handle_update(update).await {
                            Ok(update_result) => {
                                if let Some(observed_slot) = stream_observation.observed_head_slot {
                                    self.recovery_coordinator.observe_stream_head(observed_slot);
                                }
                                if let Some(slot) = progress_slot {
                                    reconnect_backoff.record_progress(slot);
                                }
                                if let (Some(observed_slot), Some(catchup_target_slot)) = (
                                    stream_observation.catchup_barrier_slot,
                                    stream_catchup_target_slot,
                                ) {
                                    if observed_slot >= catchup_target_slot {
                                        self.runtime_state_store
                                            .mark_stream_caught_up(
                                                observed_slot,
                                                catchup_target_slot,
                                            )
                                            .await?;
                                        stream_catchup_target_slot = None;
                                    }
                                }

                                if update_result.should_resubscribe {
                                    should_resubscribe = true;
                                    break;
                                }
                            }
                            Err(e) => {
                                metrics::record_projection_failure("yellowstone_update");
                                error!("Failed to handle update: {:?}", e);
                                let _ = self
                                    .runtime_state_store
                                    .mark_error(&format!("yellowstone_update_failed: {e}"))
                                    .await;
                                // 处理失败后主动重连，以 checkpoint 为准回放，避免跳过失败 slot。
                                metrics::set_grpc_connected(false);
                                metrics::record_grpc_reconnect("update_failed");
                                stream_failed = true;
                                break;
                            }
                        }

                        event_count += 1;
                        if event_count % 100 == 0 {
                            info!("Processed {} events", event_count);
                        }
                    }
                    Err(e) => {
                        metrics::set_grpc_connected(false);
                        metrics::record_grpc_reconnect("stream_error");
                        stream_failed = true;
                        let error_detail = bounded_error_chain(&e, 1000);
                        let _ = self
                            .runtime_state_store
                            .mark_error(&format!("yellowstone_stream_failed: {error_detail}"))
                            .await;
                        warn!(
                            error = %error_detail,
                            "Yellowstone stream error; reconnecting"
                        );
                        break;
                    }
                }
            }

            if should_resubscribe {
                metrics::record_grpc_reconnect("filter_generation_changed");
                let _ = self.runtime_state_store.mark_stream_disconnected().await;
                info!(
                    "Refreshing Yellowstone subscription with extension-aware program IDs: {:?}",
                    self.grpc_client.tracked_program_ids()
                );
                continue;
            }

            let _ = self.runtime_state_store.mark_stream_disconnected().await;
            if !stream_failed {
                metrics::record_grpc_reconnect("stream_ended");
            }
            let (attempt, backoff) = reconnect_backoff.next_delay(reconnect_jitter_seed());
            if stream_failed {
                warn!(
                    "Yellowstone stream failed, reconnect attempt {} in {:?}",
                    attempt, backoff
                );
            } else {
                metrics::set_grpc_connected(false);
                warn!(
                    "Yellowstone stream ended, reconnect attempt {} in {:?}",
                    attempt, backoff
                );
            }
            sleep(backoff).await;
        }
    }

    async fn handle_update(&mut self, update: SubscribeUpdate) -> Result<UpdateHandlingResult> {
        let mut result = UpdateHandlingResult::default();
        let stream_observation = update
            .update_oneof
            .as_ref()
            .map(stream_observation_for_update)
            .unwrap_or_default();

        match update.update_oneof {
            Some(UpdateOneof::Transaction(tx_update)) => {
                result = self.handle_transaction_update(tx_update).await?;
            }
            Some(UpdateOneof::Account(account_update)) => {
                let slot = account_update.slot;
                self.runtime_state_store.mark_observed_head(slot).await?;
                debug!(
                    "Account update observed at slot {} without advancing projected cursor",
                    stream_observation.observed_head_slot.unwrap_or(slot)
                );
                result.projected_cursor_slot = stream_observation.projected_cursor_slot;
            }
            Some(UpdateOneof::Slot(slot_update)) => {
                self.runtime_state_store
                    .mark_observed_head(slot_update.slot)
                    .await?;
                debug!(
                    "Slot update observed at slot {} without advancing projected cursor",
                    stream_observation
                        .observed_head_slot
                        .unwrap_or(slot_update.slot)
                );
                result.projected_cursor_slot = stream_observation.projected_cursor_slot;
            }
            Some(UpdateOneof::Ping(_)) => {
                debug!("Received ping from server");
                result.projected_cursor_slot = stream_observation.projected_cursor_slot;
            }
            _ => {
                debug!("Received other update type");
            }
        }
        Ok(result)
    }

    /// 处理交易更新 — 从交易日志中提取 ProtocolEvent 并路由到 DbWriter
    async fn handle_transaction_update(
        &mut self,
        tx_update: SubscribeUpdateTransaction,
    ) -> Result<UpdateHandlingResult> {
        let tx_info = tx_update
            .transaction
            .ok_or_else(|| anyhow!("Missing transaction info"))?;

        let slot = tx_update.slot;
        let signature = transaction_signature(&tx_info);
        let _ = self
            .runtime_state_store
            .mark_stream_transaction(slot, signature.as_deref())
            .await;

        // 使用 EventParser 从交易日志中提取事件；失败时不推进 checkpoint。
        let events = self
            .event_parser
            .parse_transaction(&tx_info)
            .await
            .map_err(|e| anyhow!("Failed to parse transaction at slot {}: {:?}", slot, e))?;
        if !events.is_empty() {
            info!(
                "Extracted {} events from transaction at slot {}",
                events.len(),
                slot
            );
            // 路由每个事件到对应的 DbWriter 方法
            self.event_parser
                .process_events(
                    events.clone(),
                    EventProjectionContext {
                        slot: Some(slot),
                        signature: signature.clone(),
                        event_index: None,
                    },
                )
                .await
                .map_err(|e| anyhow!("Failed to process events at slot {}: {:?}", slot, e))?;
            self.reconcile_tx_scoped_knowledge_snapshots(&events, &tx_info)
                .await
                .map_err(|e| {
                    anyhow!(
                        "Failed to reconcile knowledge snapshot at slot {}: {:?}",
                        slot,
                        e
                    )
                })?;
        }

        // 更新检查点
        self.checkpoint_manager
            .update_transaction(slot, signature.as_deref())
            .await?;

        let mut should_resubscribe = false;
        if self.enable_extension_auto_discovery {
            let changes = self.extract_extension_registry_changes(&tx_info);
            if !changes.is_empty() {
                should_resubscribe = self.apply_extension_registry_changes(changes).await?;
                if should_resubscribe {
                    let filter_generation_hash = self.grpc_client.filter_generation_hash();
                    self.runtime_state_store
                        .mark_filter_generation(&filter_generation_hash, slot)
                        .await?;
                }
            }
        }

        Ok(UpdateHandlingResult {
            projected_cursor_slot: Some(slot),
            should_resubscribe,
        })
    }

    fn extract_extension_registry_changes(
        &self,
        tx_info: &SubscribeUpdateTransactionInfo,
    ) -> Vec<ExtensionRegistryChange> {
        let registry_factory_program_id = match &self.registry_factory_program_id {
            Some(program_id) => program_id,
            None => return Vec::new(),
        };

        let logs: &[String] = tx_info
            .meta
            .as_ref()
            .map(|meta| meta.log_messages.as_slice())
            .unwrap_or(&[]);

        // 仅处理包含 registry-factory 程序日志的交易，避免误判其他日志
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

    async fn apply_extension_registry_changes(
        &mut self,
        changes: Vec<ExtensionRegistryChange>,
    ) -> Result<bool> {
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

        if changed {
            self.runtime_state_store
                .persist_discovered_extension_program_ids(
                    &self
                        .discovered_extension_program_ids
                        .iter()
                        .cloned()
                        .collect::<Vec<_>>(),
                )
                .await?;
            let program_ids = self.current_program_ids();
            self.grpc_client
                .update_tracked_program_ids(program_ids.clone());
            self.recovery_coordinator
                .update_discovered_extension_program_ids(
                    self.discovered_extension_program_ids
                        .iter()
                        .cloned()
                        .collect(),
                );
        }

        Ok(changed)
    }

    async fn restore_discovered_extension_scope(&mut self) -> Result<()> {
        let persisted = self
            .runtime_state_store
            .load_discovered_extension_program_ids()
            .await?;
        self.apply_recovered_extension_scope(persisted);
        Ok(())
    }

    fn apply_recovered_extension_scope(&mut self, program_ids: Vec<String>) {
        let recovered = program_ids.into_iter().collect::<BTreeSet<_>>();
        if recovered == self.discovered_extension_program_ids {
            return;
        }
        self.discovered_extension_program_ids = recovered;
        let current_program_ids = self.current_program_ids();
        self.grpc_client
            .update_tracked_program_ids(current_program_ids);
        self.recovery_coordinator
            .update_discovered_extension_program_ids(
                self.discovered_extension_program_ids
                    .iter()
                    .cloned()
                    .collect(),
            );
    }

    fn current_program_ids(&self) -> Vec<String> {
        self.base_program_ids
            .union(&self.discovered_extension_program_ids)
            .cloned()
            .collect()
    }
}

fn grpc_update_type(update: &SubscribeUpdate) -> &'static str {
    match update.update_oneof.as_ref() {
        Some(UpdateOneof::Transaction(_)) => "transaction",
        Some(UpdateOneof::Slot(_)) => "slot",
        Some(UpdateOneof::Ping(_)) => "ping",
        Some(UpdateOneof::Pong(_)) => "pong",
        Some(UpdateOneof::Account(_)) => "account",
        _ => "other",
    }
}

fn next_heartbeat_id(current: i32) -> i32 {
    if current == i32::MAX {
        1
    } else {
        current + 1
    }
}

fn reconnect_progress_slot(update: Option<&UpdateOneof>) -> Option<u64> {
    match update {
        Some(UpdateOneof::Slot(update)) => Some(update.slot),
        Some(UpdateOneof::Transaction(update)) => Some(update.slot),
        _ => None,
    }
}

fn bounded_error_chain(error: &anyhow::Error, max_len: usize) -> String {
    format!("{error:#}").chars().take(max_len).collect()
}

fn transaction_signature(tx_info: &SubscribeUpdateTransactionInfo) -> Option<String> {
    if tx_info.signature.is_empty() {
        return None;
    }
    solana_sdk::signature::Signature::try_from(tx_info.signature.as_slice())
        .ok()
        .map(|signature| signature.to_string())
}

impl EventListener {
    async fn reconcile_tx_scoped_knowledge_snapshots(
        &self,
        events: &[ProtocolEvent],
        tx_info: &SubscribeUpdateTransactionInfo,
    ) -> Result<()> {
        let Some(knowledge_account) = extract_primary_account_from_yellowstone_tx(tx_info) else {
            return Ok(());
        };

        for event in events {
            if let Some(content_id) = content_post_snapshot_target_for_event(event) {
                self.event_parser
                    .reconcile_content_post_account_snapshot(&content_id, &knowledge_account)
                    .await?;
                continue;
            }

            match event {
                ProtocolEvent::KnowledgeSubmitted { knowledge_id, .. }
                | ProtocolEvent::ContributorsUpdated { knowledge_id, .. } => {
                    self.event_parser
                        .reconcile_knowledge_account_snapshot(
                            &hex::encode(knowledge_id),
                            &knowledge_account,
                        )
                        .await?;
                }
                _ => {}
            }
        }

        Ok(())
    }
}

fn extract_primary_account_from_yellowstone_tx(
    tx_info: &SubscribeUpdateTransactionInfo,
) -> Option<Pubkey> {
    let transaction = tx_info.transaction.as_ref()?;
    let message = transaction.message.as_ref()?;
    let mut account_keys = message
        .account_keys
        .iter()
        .filter_map(|key| Pubkey::try_from(key.as_slice()).ok())
        .collect::<Vec<_>>();

    if let Some(meta) = &tx_info.meta {
        account_keys.extend(
            meta.loaded_writable_addresses
                .iter()
                .filter_map(|key| Pubkey::try_from(key.as_slice()).ok()),
        );
        account_keys.extend(
            meta.loaded_readonly_addresses
                .iter()
                .filter_map(|key| Pubkey::try_from(key.as_slice()).ok()),
        );
    }

    let mut candidate_instructions = message.instructions.iter().filter(|instruction| {
        account_keys
            .get(instruction.program_id_index as usize)
            .map(Pubkey::to_string)
            .as_deref()
            != Some("ComputeBudget111111111111111111111111111111")
    });

    let instruction = candidate_instructions.next()?;
    if candidate_instructions.next().is_some() {
        return None;
    }

    let primary_account_index = *instruction.accounts.first()? as usize;
    account_keys.get(primary_account_index).copied()
}

#[derive(Debug, Default, PartialEq, Eq)]
struct StreamObservation {
    observed_head_slot: Option<u64>,
    projected_cursor_slot: Option<u64>,
    catchup_barrier_slot: Option<u64>,
}

fn stream_observation_for_update(update: &UpdateOneof) -> StreamObservation {
    let observed_head_slot = match update {
        UpdateOneof::Account(account_update) => Some(account_update.slot),
        UpdateOneof::Slot(slot_update) => Some(slot_update.slot),
        _ => None,
    };

    StreamObservation {
        observed_head_slot,
        projected_cursor_slot: None,
        catchup_barrier_slot: match update {
            UpdateOneof::Slot(slot_update) => Some(slot_update.slot),
            _ => None,
        },
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn account_slot_and_ping_do_not_advance_projected_cursor() {
        let account =
            stream_observation_for_update(&UpdateOneof::Account(SubscribeUpdateAccount {
                slot: 41,
                ..Default::default()
            }));
        assert_eq!(account.observed_head_slot, Some(41));
        assert_eq!(account.projected_cursor_slot, None);
        assert_eq!(account.catchup_barrier_slot, None);

        let slot = stream_observation_for_update(&UpdateOneof::Slot(SubscribeUpdateSlot {
            slot: 42,
            ..Default::default()
        }));
        assert_eq!(slot.observed_head_slot, Some(42));
        assert_eq!(slot.projected_cursor_slot, None);
        assert_eq!(slot.catchup_barrier_slot, Some(42));

        let ping =
            stream_observation_for_update(&UpdateOneof::Ping(SubscribeUpdatePing::default()));
        assert_eq!(ping.observed_head_slot, None);
        assert_eq!(ping.projected_cursor_slot, None);
        assert_eq!(ping.catchup_barrier_slot, None);
    }

    #[test]
    fn repeated_stream_failures_keep_increasing_backoff_until_real_progress() {
        let mut reconnect = ReconnectBackoffState::default();

        assert!(reconnect.record_progress(42));
        for expected_attempt in 1..=100 {
            let (attempt, delay) = reconnect.next_delay(0);
            assert_eq!(attempt, expected_attempt);
            assert!(delay <= Duration::from_secs(30));
            assert!(!reconnect.record_progress(42));
        }

        assert!(reconnect.record_progress(43));
        let (attempt, delay) = reconnect.next_delay(0);
        assert_eq!(attempt, 1);
        assert_eq!(delay, Duration::from_secs(1));
    }

    #[test]
    fn bounded_stream_error_keeps_provider_cause_without_unbounded_output() {
        let error = anyhow!("provider code Unavailable").context("Stream error");
        assert_eq!(
            bounded_error_chain(&error, 1000),
            "Stream error: provider code Unavailable"
        );
        assert_eq!(bounded_error_chain(&error, 6), "Stream");
    }

    #[test]
    fn extracts_primary_account_from_single_yellowstone_instruction() {
        let primary = Pubkey::new_unique();
        let secondary = Pubkey::new_unique();
        let program = Pubkey::new_unique();
        let tx_info = SubscribeUpdateTransactionInfo {
            signature: vec![],
            is_vote: false,
            transaction: Some(Transaction {
                signatures: vec![],
                message: Some(Message {
                    header: None,
                    account_keys: vec![
                        primary.to_bytes().to_vec(),
                        secondary.to_bytes().to_vec(),
                        program.to_bytes().to_vec(),
                    ],
                    recent_blockhash: vec![],
                    instructions: vec![CompiledInstruction {
                        program_id_index: 2,
                        accounts: vec![0, 1],
                        data: vec![],
                    }],
                    versioned: false,
                    address_table_lookups: vec![],
                }),
            }),
            meta: Some(TransactionStatusMeta {
                err: None,
                fee: 0,
                pre_balances: vec![],
                post_balances: vec![],
                inner_instructions: vec![],
                inner_instructions_none: true,
                log_messages: vec![],
                log_messages_none: true,
                pre_token_balances: vec![],
                post_token_balances: vec![],
                rewards: vec![],
                loaded_writable_addresses: vec![],
                loaded_readonly_addresses: vec![],
                return_data: None,
                return_data_none: true,
                compute_units_consumed: None,
            }),
            index: 0,
        };

        assert_eq!(
            extract_primary_account_from_yellowstone_tx(&tx_info),
            Some(primary)
        );
    }

    #[test]
    fn yellowstone_primary_account_extraction_ignores_compute_budget_instruction() {
        let primary = Pubkey::new_unique();
        let program = Pubkey::new_unique();
        let tx_info = SubscribeUpdateTransactionInfo {
            signature: vec![],
            is_vote: false,
            transaction: Some(Transaction {
                signatures: vec![],
                message: Some(Message {
                    header: None,
                    account_keys: vec![
                        Pubkey::from_str("ComputeBudget111111111111111111111111111111")
                            .expect("valid compute budget program")
                            .to_bytes()
                            .to_vec(),
                        primary.to_bytes().to_vec(),
                        program.to_bytes().to_vec(),
                    ],
                    recent_blockhash: vec![],
                    instructions: vec![
                        CompiledInstruction {
                            program_id_index: 0,
                            accounts: vec![],
                            data: vec![],
                        },
                        CompiledInstruction {
                            program_id_index: 2,
                            accounts: vec![1],
                            data: vec![],
                        },
                    ],
                    versioned: false,
                    address_table_lookups: vec![],
                }),
            }),
            meta: Some(TransactionStatusMeta {
                err: None,
                fee: 0,
                pre_balances: vec![],
                post_balances: vec![],
                inner_instructions: vec![],
                inner_instructions_none: true,
                log_messages: vec![],
                log_messages_none: true,
                pre_token_balances: vec![],
                post_token_balances: vec![],
                rewards: vec![],
                loaded_writable_addresses: vec![],
                loaded_readonly_addresses: vec![],
                return_data: None,
                return_data_none: true,
                compute_units_consumed: None,
            }),
            index: 0,
        };

        assert_eq!(
            extract_primary_account_from_yellowstone_tx(&tx_info),
            Some(primary)
        );
    }
}

#[derive(Debug, Default)]
struct UpdateHandlingResult {
    projected_cursor_slot: Option<u64>,
    should_resubscribe: bool,
}

#[derive(Debug)]
enum ExtensionRegistryChange {
    Registered(String),
    Removed(String),
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

#[derive(Debug, Default)]
struct ReconnectBackoffState {
    consecutive_failures: u32,
    last_progress_slot: Option<u64>,
}

impl ReconnectBackoffState {
    fn next_delay(&mut self, jitter_seed: u64) -> (u32, Duration) {
        self.consecutive_failures = self.consecutive_failures.saturating_add(1);
        (
            self.consecutive_failures,
            reconnect_backoff(self.consecutive_failures, jitter_seed),
        )
    }

    fn record_progress(&mut self, slot: u64) -> bool {
        if self
            .last_progress_slot
            .is_some_and(|last_progress_slot| slot <= last_progress_slot)
        {
            return false;
        }
        self.last_progress_slot = Some(slot);
        self.consecutive_failures = 0;
        true
    }
}

fn reconnect_jitter_seed() -> u64 {
    SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .unwrap_or_default()
        .subsec_nanos() as u64
}

fn reconnect_backoff(attempt: u32, jitter_seed: u64) -> Duration {
    let shift = attempt.saturating_sub(1).min(6);
    let secs = (1u64 << shift).min(30);
    let base = Duration::from_secs(secs);
    if secs >= 30 {
        return base;
    }
    let jitter = Duration::from_millis(jitter_seed % 251);
    (base + jitter).min(Duration::from_secs(30))
}
