use alcheme_shared::ProtocolEvent;
use anyhow::{anyhow, Result};
use solana_sdk::pubkey::Pubkey;
use std::collections::BTreeSet;
use std::str::FromStr;
use tokio::time::{sleep, Duration};
use tokio_stream::StreamExt;
use tracing::{debug, error, info, warn};
use yellowstone_grpc_proto::prelude::subscribe_update::UpdateOneof;
use yellowstone_grpc_proto::prelude::*;

use crate::database::checkpoint::CheckpointManager;
use crate::database::RuntimeStateStore;
use crate::grpc::client::AlchemeGrpcClient;
use crate::metrics;
use crate::parsers::event_parser::{content_post_snapshot_target_for_event, EventParser};

pub struct EventListener {
    grpc_client: AlchemeGrpcClient,
    checkpoint_manager: CheckpointManager,
    runtime_state_store: RuntimeStateStore,
    event_parser: EventParser,
    registry_factory_program_id: Option<String>,
    base_program_ids: BTreeSet<String>,
    discovered_extension_program_ids: BTreeSet<String>,
    enable_extension_auto_discovery: bool,
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
        }
    }

    pub async fn start(&mut self) -> Result<()> {
        self.runtime_state_store.mark_listener_started().await?;
        // 从检查点恢复
        let mut start_slot = self.checkpoint_manager.get_last_processed_slot().await?;

        if let Some(slot) = start_slot {
            info!("Resuming from slot: {}", slot);
        } else {
            info!("Starting fresh indexing");
        }

        let mut event_count = 0u64;
        let mut reconnect_attempt: u32 = 0;
        loop {
            // 订阅事件流
            let mut stream = match self.grpc_client.subscribe(start_slot).await {
                Ok(stream) => {
                    reconnect_attempt = 0;
                    stream
                }
                Err(error) => {
                    metrics::set_grpc_connected(false);
                    let _ = self
                        .runtime_state_store
                        .mark_error(&format!("yellowstone_connect_failed: {error}"))
                        .await;
                    reconnect_attempt = reconnect_attempt.saturating_add(1);
                    let backoff = reconnect_backoff(reconnect_attempt);
                    warn!(
                        "Failed to establish Yellowstone stream (attempt {}), retrying in {:?}: {:?}",
                        reconnect_attempt, backoff, error
                    );
                    sleep(backoff).await;
                    continue;
                }
            };
            metrics::set_grpc_connected(true);
            let _ = self.runtime_state_store.mark_idle(start_slot).await;
            info!("✅ Event stream established, listening for events...");

            let mut should_resubscribe = false;
            let mut stream_failed = false;
            while let Some(update_result) = stream.next().await {
                match update_result {
                    Ok(update) => {
                        match self.handle_update(update).await {
                            Ok(update_result) => {
                                if let Some(slot) = update_result.latest_slot {
                                    start_slot = Some(slot);
                                }

                                if update_result.should_resubscribe {
                                    should_resubscribe = true;
                                    break;
                                }
                            }
                            Err(e) => {
                                error!("Failed to handle update: {:?}", e);
                                let _ = self
                                    .runtime_state_store
                                    .mark_error(&format!("yellowstone_update_failed: {e}"))
                                    .await;
                                // 处理失败后主动重连，以 checkpoint 为准回放，避免跳过失败 slot。
                                metrics::set_grpc_connected(false);
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
                        stream_failed = true;
                        let _ = self
                            .runtime_state_store
                            .mark_error(&format!("yellowstone_stream_failed: {e}"))
                            .await;
                        warn!("Yellowstone stream error: {:?}, reconnecting...", e);
                        break;
                    }
                }
            }

            if should_resubscribe {
                info!(
                    "Refreshing Yellowstone subscription with extension-aware program IDs: {:?}",
                    self.grpc_client.tracked_program_ids()
                );
                continue;
            }

            reconnect_attempt = reconnect_attempt.saturating_add(1);
            let backoff = reconnect_backoff(reconnect_attempt);
            if stream_failed {
                warn!(
                    "Yellowstone stream failed, reconnect attempt {} in {:?}",
                    reconnect_attempt, backoff
                );
            } else {
                metrics::set_grpc_connected(false);
                warn!(
                    "Yellowstone stream ended, reconnect attempt {} in {:?}",
                    reconnect_attempt, backoff
                );
            }
            sleep(backoff).await;
        }
    }

    async fn handle_update(&mut self, update: SubscribeUpdate) -> Result<UpdateHandlingResult> {
        let mut result = UpdateHandlingResult::default();

        match update.update_oneof {
            Some(UpdateOneof::Transaction(tx_update)) => {
                result = self.handle_transaction_update(tx_update).await?;
            }
            Some(UpdateOneof::Account(account_update)) => {
                // 账户变动暂时只记录 slot 进度
                let slot = account_update.slot;
                let _ = self.runtime_state_store.mark_idle(Some(slot)).await;
                debug!("Account update at slot: {}", slot);
                result.latest_slot = Some(slot);
            }
            Some(UpdateOneof::Slot(slot_update)) => {
                let _ = self.runtime_state_store.mark_idle(Some(slot_update.slot)).await;
                debug!("Slot update: {}", slot_update.slot);
                result.latest_slot = Some(slot_update.slot);
            }
            Some(UpdateOneof::Ping(_)) => {
                let _ = self.runtime_state_store.mark_idle(None).await;
                debug!("Received ping from server");
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
        let _ = self
            .runtime_state_store
            .mark_tx_progress(slot, None, 0, None)
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
                .process_events(events.clone(), Some(slot))
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
        self.checkpoint_manager.update(slot).await?;
        let _ = self.runtime_state_store.mark_slot_completed(slot).await;

        let mut should_resubscribe = false;
        if self.enable_extension_auto_discovery {
            let changes = self.extract_extension_registry_changes(&tx_info);
            if !changes.is_empty() {
                should_resubscribe = self.apply_extension_registry_changes(changes);
            }
        }

        Ok(UpdateHandlingResult {
            latest_slot: Some(slot),
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

        if changed {
            self.grpc_client
                .update_tracked_program_ids(self.current_program_ids());
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

#[cfg(test)]
mod tests {
    use super::*;

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
    latest_slot: Option<u64>,
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

fn reconnect_backoff(attempt: u32) -> Duration {
    let shift = attempt.saturating_sub(1).min(6);
    let secs = (1u64 << shift).min(30);
    Duration::from_secs(secs)
}
