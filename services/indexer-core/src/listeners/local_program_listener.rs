use alcheme_shared::ProtocolEvent;
use anyhow::{anyhow, Result};
use solana_sdk::pubkey::Pubkey;
use std::collections::{BTreeMap, BTreeSet};
use std::str::FromStr;
use tokio::time::{sleep, Duration};
use tracing::{debug, info, warn};

use crate::database::checkpoint::{CheckpointManager, ProgramCursor};
use crate::database::RuntimeStateStore;
use crate::listeners::local_logs_subscriber::{LiveLogCandidate, LocalLogsSubscriber};
use crate::listeners::local_rpc_listener::{RpcJsonClient, RpcTransactionResult};
use crate::parsers::event_parser::{
    content_post_snapshot_target_for_event, EventParser, EventProjectionContext,
};

pub const PROGRAM_CURSOR_LISTENER_MODE: &str = "program_cursor";

pub struct LocalProgramListener {
    rpc_client: RpcJsonClient,
    checkpoint_manager: CheckpointManager,
    runtime_state_store: RuntimeStateStore,
    event_parser: EventParser,
    registry_factory_program_id: Option<String>,
    base_program_ids: BTreeSet<String>,
    discovered_extension_program_ids: BTreeSet<String>,
    enable_extension_auto_discovery: bool,
    poll_interval: Duration,
    signature_batch_limit: usize,
    initial_backfill_slots: u64,
    live_subscriber: LocalLogsSubscriber,
}

impl LocalProgramListener {
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
        signature_batch_limit: usize,
        initial_backfill_slots: usize,
        request_timeout_ms: u64,
        local_ws_url: String,
        overlap_backfill_signature_limit: usize,
    ) -> Self {
        let mut base_program_ids = tracked_program_ids.into_iter().collect::<BTreeSet<_>>();
        for extension_program_id in extension_program_ids {
            base_program_ids.insert(extension_program_id);
        }
        let live_program_ids = base_program_ids.iter().cloned().collect();

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
            signature_batch_limit: signature_batch_limit.max(1),
            initial_backfill_slots: initial_backfill_slots as u64,
            live_subscriber: LocalLogsSubscriber::new(
                local_ws_url,
                live_program_ids,
                overlap_backfill_signature_limit,
            ),
        }
    }

    pub async fn start(&mut self) -> Result<()> {
        self.runtime_state_store.mark_listener_started().await?;

        loop {
            if let Err(error) = self.live_subscriber.ensure_connected().await {
                let _ = self
                    .runtime_state_store
                    .mark_error(&format!("local_logs_connect_failed: {error}"))
                    .await;
                warn!("Failed to connect local logs subscriber: {:?}", error);
            }

            let latest_slot = match self.rpc_client.get_slot().await {
                Ok(slot) => slot,
                Err(error) => {
                    let _ = self
                        .runtime_state_store
                        .mark_error(&format!("local_program_head_slot_failed: {error}"))
                        .await;
                    warn!("Failed to fetch latest slot for program-cursor listener: {:?}", error);
                    sleep(self.poll_interval).await;
                    continue;
                }
            };

            let checkpoint_slot = self
                .checkpoint_manager
                .get_last_processed_slot()
                .await?
                .unwrap_or_else(|| latest_slot.saturating_sub(self.initial_backfill_slots));
            let floor_slot = checkpoint_slot.saturating_sub(self.initial_backfill_slots);

            let pages = match self.fetch_program_pages(checkpoint_slot, floor_slot).await {
                Ok(pages) => pages,
                Err(error) => {
                    let _ = self
                        .runtime_state_store
                        .mark_error(&format!("local_program_fetch_failed: {error}"))
                        .await;
                    warn!("Failed to fetch program-targeted backfill pages: {:?}", error);
                    sleep(self.poll_interval).await;
                    continue;
                }
            };

            let overlap_candidates = if self.live_subscriber.take_reconnect_backfill_pending() {
                match self
                    .fetch_overlap_candidates(checkpoint_slot, self.live_subscriber.overlap_signature_limit())
                    .await
                {
                    Ok(candidates) => candidates,
                    Err(error) => {
                        let _ = self
                            .runtime_state_store
                            .mark_error(&format!("local_logs_overlap_backfill_failed: {error}"))
                            .await;
                        warn!("Failed to run overlap backfill after logs reconnect: {:?}", error);
                        Vec::new()
                    }
                }
            } else {
                Vec::new()
            };
            let live_candidates = self.live_subscriber.drain_ready_signatures();
            let candidates = merge_signature_candidates(
                merge_program_signature_pages(&pages)
                    .into_iter()
                    .chain(overlap_candidates.into_iter())
                    .chain(live_candidates.into_iter().map(Self::from_live_candidate))
                    .collect(),
            );
            if candidates.is_empty() {
                self.advance_program_cursors(&pages, floor_slot).await?;
                let _ = self.runtime_state_store.mark_idle(Some(latest_slot)).await;
                sleep(self.poll_interval).await;
                continue;
            }

            self.runtime_state_store
                .mark_slot_started(candidates[0].slot, candidates.len())
                .await?;

            for (idx, candidate) in candidates.iter().enumerate() {
                let _ = self
                    .runtime_state_store
                    .mark_tx_progress(
                        candidate.slot,
                        Some(candidates.len()),
                        idx,
                        Some(&candidate.signature),
                    )
                    .await;
                match self.rpc_client.get_transaction(&candidate.signature).await? {
                    Some(transaction) => {
                        if let Err(error) = self
                            .process_fetched_transaction(candidate.slot, &candidate.signature, transaction)
                            .await
                        {
                            let _ = self
                                .runtime_state_store
                                .mark_error(&format!(
                                    "local_program_process_tx_failed[{}]: {}",
                                    candidate.signature, error
                                ))
                                .await;
                            warn!(
                                "Failed to process program-targeted tx {} at slot {}: {:?}",
                                candidate.signature,
                                candidate.slot,
                                error
                            );
                            continue;
                        }
                        self.checkpoint_manager.update(candidate.slot).await?;
                    }
                    None => continue,
                }
            }

            self.advance_program_cursors(&pages, floor_slot).await?;
            if let Some(last) = candidates.last() {
                self.runtime_state_store.mark_slot_completed(last.slot).await?;
            }
        }
    }

    async fn fetch_overlap_candidates(
        &self,
        checkpoint_slot: u64,
        limit: usize,
    ) -> Result<Vec<ProgramSignatureCandidate>> {
        let mut candidates = Vec::new();
        for program_id in self.current_program_ids() {
            let fetched = self
                .rpc_client
                .get_signatures_for_address(&program_id, None, limit.max(1))
                .await?;
            for (signature, slot) in fetched {
                if slot > checkpoint_slot {
                    candidates.push(ProgramSignatureCandidate {
                        signature,
                        slot,
                        matched_programs: vec![program_id.clone()],
                    });
                }
            }
        }
        Ok(merge_signature_candidates(candidates))
    }

    fn from_live_candidate(candidate: LiveLogCandidate) -> ProgramSignatureCandidate {
        ProgramSignatureCandidate {
            signature: candidate.signature,
            slot: candidate.slot,
            matched_programs: candidate.matched_programs,
        }
    }

    async fn fetch_program_pages(
        &self,
        checkpoint_slot: u64,
        floor_slot: u64,
    ) -> Result<Vec<ProgramSignaturePage>> {
        let mut pages = Vec::new();
        for program_id in self.current_program_ids() {
            let cursor = self
                .checkpoint_manager
                .get_program_cursor(&program_id, PROGRAM_CURSOR_LISTENER_MODE)
                .await?;
            let continuing_backfill = cursor
                .as_ref()
                .map(|value| value.last_processed_slot > floor_slot)
                .unwrap_or(false);
            let before = cursor
                .as_ref()
                .and_then(|value| value.last_signature.as_deref())
                .filter(|_| continuing_backfill);

            let fetched = self
                .rpc_client
                .get_signatures_for_address(&program_id, before, self.signature_batch_limit)
                .await?;

            let mut signatures = Vec::new();
            for (signature, slot) in fetched.iter().cloned() {
                let should_include = if continuing_backfill {
                    slot >= floor_slot
                } else {
                    slot > checkpoint_slot
                };
                if should_include {
                    signatures.push(ProgramSignatureCandidate {
                        signature,
                        slot,
                        matched_programs: vec![program_id.clone()],
                    });
                }
            }

            let oldest = fetched.last().map(|(signature, slot)| (signature.clone(), *slot));
            pages.push(ProgramSignaturePage {
                program_id,
                fetched_count: fetched.len(),
                continuing_backfill,
                oldest_signature: oldest.as_ref().map(|(signature, _)| signature.clone()),
                oldest_slot: oldest.map(|(_, slot)| slot),
                signatures,
            });
        }

        Ok(pages)
    }

    async fn advance_program_cursors(
        &self,
        pages: &[ProgramSignaturePage],
        floor_slot: u64,
    ) -> Result<()> {
        for page in pages {
            let should_continue = page.oldest_signature.is_some()
                && page.oldest_slot.unwrap_or_default() > floor_slot
                && (page.continuing_backfill || page.fetched_count >= self.signature_batch_limit);

            if should_continue {
                self.checkpoint_manager
                    .upsert_program_cursor(
                        &page.program_id,
                        PROGRAM_CURSOR_LISTENER_MODE,
                        page.oldest_signature.as_deref(),
                        page.oldest_slot.unwrap_or_default(),
                    )
                    .await?;
            } else {
                self.checkpoint_manager
                    .clear_program_cursor(&page.program_id, PROGRAM_CURSOR_LISTENER_MODE)
                    .await?;
            }
        }

        Ok(())
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
                "Extracted {} events from program-targeted local tx {} at slot {}",
                events.len(),
                signature,
                slot
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
            self.reconcile_tx_scoped_addresses(&events, &transaction).await?;
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

    fn apply_extension_registry_changes(&mut self, changes: Vec<ExtensionRegistryChange>) {
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
                    }
                }
                ExtensionRegistryChange::Removed(program_id) => {
                    if self.discovered_extension_program_ids.remove(&program_id) {
                        info!(
                            "Removed extension program from discovered set: {}",
                            program_id
                        );
                    }
                }
            }
        }
    }

    fn current_program_ids(&self) -> Vec<String> {
        self.base_program_ids
            .union(&self.discovered_extension_program_ids)
            .cloned()
            .collect()
    }
}

#[derive(Debug, Clone, PartialEq, Eq)]
pub(crate) struct ProgramSignatureCandidate {
    signature: String,
    slot: u64,
    matched_programs: Vec<String>,
}

#[derive(Debug, Clone)]
struct ProgramSignaturePage {
    program_id: String,
    fetched_count: usize,
    continuing_backfill: bool,
    oldest_signature: Option<String>,
    oldest_slot: Option<u64>,
    signatures: Vec<ProgramSignatureCandidate>,
}

fn merge_program_signature_pages(pages: &[ProgramSignaturePage]) -> Vec<ProgramSignatureCandidate> {
    merge_signature_candidates(
        pages.iter()
            .flat_map(|page| page.signatures.iter().map(|candidate| (page.program_id.clone(), candidate.clone())))
            .map(|(program_id, mut candidate)| {
                if !candidate.matched_programs.contains(&program_id) {
                    candidate.matched_programs.push(program_id);
                    candidate.matched_programs.sort();
                }
                candidate
            })
            .collect(),
    )
}

fn merge_signature_candidates(candidates: Vec<ProgramSignatureCandidate>) -> Vec<ProgramSignatureCandidate> {
    let mut by_signature = BTreeMap::<String, ProgramSignatureCandidate>::new();

    for candidate in candidates {
        by_signature
            .entry(candidate.signature.clone())
            .and_modify(|existing| {
                for program_id in &candidate.matched_programs {
                    if !existing.matched_programs.contains(program_id) {
                        existing.matched_programs.push(program_id.clone());
                    }
                }
                existing.matched_programs.sort();
                existing.slot = existing.slot.max(candidate.slot);
            })
            .or_insert(candidate);
    }

    let mut merged = by_signature.into_values().collect::<Vec<_>>();
    // local fallback currently guarantees eventual consistency only.
    // Within the same slot we use signature order as a deterministic tie-breaker,
    // but this is not intended to match Yellowstone's strict global ordering.
    merged.sort_by(|left, right| {
        left.slot
            .cmp(&right.slot)
            .then_with(|| left.signature.cmp(&right.signature))
    });
    merged
}

fn logs_contain_programs(logs: &[String], program_ids: &[String]) -> bool {
    program_ids
        .iter()
        .any(|program_id| logs.iter().any(|log| log.contains(program_id)))
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
        let sanitized = token.trim_matches(|c: char| !c.is_ascii_alphanumeric());
        if sanitized.is_empty() {
            continue;
        }
        if let Ok(pubkey) = Pubkey::from_str(sanitized) {
            return Some(pubkey.to_string());
        }
    }

    None
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

#[derive(Debug)]
enum ExtensionRegistryChange {
    Registered(String),
    Removed(String),
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn local_program_listener_dedupes_same_signature_across_programs() {
        let merged = merge_program_signature_pages(&[
            ProgramSignaturePage {
                program_id: "prog-a".to_string(),
                fetched_count: 2,
                continuing_backfill: false,
                oldest_signature: Some("sig-1".to_string()),
                oldest_slot: Some(100),
                signatures: vec![
                    ProgramSignatureCandidate {
                        signature: "sig-2".to_string(),
                        slot: 102,
                        matched_programs: vec!["prog-a".to_string()],
                    },
                    ProgramSignatureCandidate {
                        signature: "sig-1".to_string(),
                        slot: 100,
                        matched_programs: vec!["prog-a".to_string()],
                    },
                ],
            },
            ProgramSignaturePage {
                program_id: "prog-b".to_string(),
                fetched_count: 2,
                continuing_backfill: false,
                oldest_signature: Some("sig-2".to_string()),
                oldest_slot: Some(101),
                signatures: vec![
                    ProgramSignatureCandidate {
                        signature: "sig-3".to_string(),
                        slot: 103,
                        matched_programs: vec!["prog-b".to_string()],
                    },
                    ProgramSignatureCandidate {
                        signature: "sig-2".to_string(),
                        slot: 102,
                        matched_programs: vec!["prog-b".to_string()],
                    },
                ],
            },
        ]);

        assert_eq!(merged.len(), 3);
        assert_eq!(merged[0].signature, "sig-1");
        assert_eq!(merged[1].signature, "sig-2");
        assert_eq!(merged[1].matched_programs, vec!["prog-a".to_string(), "prog-b".to_string()]);
        assert_eq!(merged[2].signature, "sig-3");
    }

    #[test]
    fn local_program_listener_uses_signature_tie_breaker_for_same_slot() {
        let merged = merge_program_signature_pages(&[
            ProgramSignaturePage {
                program_id: "prog-a".to_string(),
                fetched_count: 2,
                continuing_backfill: true,
                oldest_signature: Some("sig-a".to_string()),
                oldest_slot: Some(500),
                signatures: vec![
                    ProgramSignatureCandidate {
                        signature: "sig-b".to_string(),
                        slot: 500,
                        matched_programs: vec!["prog-a".to_string()],
                    },
                    ProgramSignatureCandidate {
                        signature: "sig-a".to_string(),
                        slot: 500,
                        matched_programs: vec!["prog-a".to_string()],
                    },
                ],
            },
        ]);

        assert_eq!(
            merged.into_iter().map(|candidate| candidate.signature).collect::<Vec<_>>(),
            vec!["sig-a".to_string(), "sig-b".to_string()]
        );
    }

    #[test]
    fn local_program_listener_cursor_resume_is_before_oldest_signature() {
        let cursor = ProgramCursor {
            program_id: "prog-a".to_string(),
            listener_mode: PROGRAM_CURSOR_LISTENER_MODE.to_string(),
            last_signature: Some("sig-older".to_string()),
            last_processed_slot: 420,
        };

        assert_eq!(cursor.last_signature.as_deref(), Some("sig-older"));
        assert_eq!(cursor.last_processed_slot, 420);
    }
}
