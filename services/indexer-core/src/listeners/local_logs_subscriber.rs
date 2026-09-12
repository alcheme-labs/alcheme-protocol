use anyhow::{anyhow, Result};
use futures::{SinkExt, StreamExt};
use serde_json::{json, Value};
use std::collections::{BTreeSet, HashMap, HashSet, VecDeque};
use tokio::sync::mpsc::{self, error::TryRecvError, UnboundedReceiver};
use tokio_tungstenite::{connect_async, tungstenite::protocol::Message};
use tracing::warn;

#[derive(Debug, Clone, PartialEq, Eq)]
pub(crate) struct LiveLogCandidate {
    pub(crate) signature: String,
    pub(crate) slot: u64,
    pub(crate) matched_programs: Vec<String>,
}

impl LiveLogCandidate {
    #[cfg(test)]
    pub(crate) fn new(signature: &str, slot: u64, program_id: &str) -> Self {
        Self {
            signature: signature.to_string(),
            slot,
            matched_programs: vec![program_id.to_string()],
        }
    }
}

#[derive(Debug, Clone)]
struct LogSubscribeRequest {
    request_id: u64,
    program_id: String,
    payload: Value,
}

#[derive(Debug)]
pub struct LocalLogsSubscriber {
    ws_url: String,
    tracked_program_ids: Vec<String>,
    overlap_signature_limit: usize,
    recent_signatures: RecentSignatureWindow,
    receiver: Option<UnboundedReceiver<LiveLogCandidate>>,
    reconnect_backfill_pending: bool,
}

impl LocalLogsSubscriber {
    pub fn new(ws_url: String, tracked_program_ids: Vec<String>, overlap_signature_limit: usize) -> Self {
        let dedup_window = overlap_signature_limit.max(1) * tracked_program_ids.len().max(1);
        Self {
            ws_url,
            tracked_program_ids: tracked_program_ids
                .into_iter()
                .collect::<BTreeSet<_>>()
                .into_iter()
                .collect(),
            overlap_signature_limit: overlap_signature_limit.max(1),
            recent_signatures: RecentSignatureWindow::new(dedup_window.max(8)),
            receiver: None,
            reconnect_backfill_pending: false,
        }
    }

    pub fn overlap_signature_limit(&self) -> usize {
        self.overlap_signature_limit
    }

    pub fn take_reconnect_backfill_pending(&mut self) -> bool {
        let pending = self.reconnect_backfill_pending;
        self.reconnect_backfill_pending = false;
        pending
    }

    pub fn mark_stream_disconnected(&mut self) {
        self.receiver = None;
        self.reconnect_backfill_pending = true;
    }

    pub fn filter_new_signatures(
        &mut self,
        candidates: Vec<LiveLogCandidate>,
    ) -> Vec<LiveLogCandidate> {
        let mut filtered = Vec::new();
        for candidate in candidates {
            if self.recent_signatures.insert(candidate.signature.clone()) {
                filtered.push(candidate);
            }
        }
        filtered.sort_by(|left, right| {
            left.slot
                .cmp(&right.slot)
                .then_with(|| left.signature.cmp(&right.signature))
        });
        filtered
    }

    pub fn drain_ready_signatures(&mut self) -> Vec<LiveLogCandidate> {
        let mut drained = Vec::new();
        let mut disconnected = false;

        if let Some(receiver) = &mut self.receiver {
            loop {
                match receiver.try_recv() {
                    Ok(candidate) => drained.push(candidate),
                    Err(TryRecvError::Empty) => break,
                    Err(TryRecvError::Disconnected) => {
                        disconnected = true;
                        break;
                    }
                }
            }
        }

        if disconnected {
            self.mark_stream_disconnected();
        }

        self.filter_new_signatures(drained)
    }

    pub async fn ensure_connected(&mut self) -> Result<()> {
        if self.tracked_program_ids.is_empty() {
            return Ok(());
        }

        let needs_connect = match &self.receiver {
            Some(receiver) => receiver.is_closed(),
            None => true,
        };
        if !needs_connect {
            return Ok(());
        }

        if self.ws_url.trim().is_empty() {
            return Err(anyhow!("LOCAL_WS_URL must be set for local logs subscriber"));
        }

        let (sender, receiver) = mpsc::unbounded_channel();
        let ws_url = self.ws_url.clone();
        let requests = build_logs_subscribe_requests(&self.tracked_program_ids);
        tokio::spawn(async move {
            if let Err(error) = run_logs_subscription(ws_url, requests, sender).await {
                warn!("local logs subscriber stream stopped: {:?}", error);
            }
        });
        self.receiver = Some(receiver);
        Ok(())
    }
}

fn build_logs_subscribe_requests(program_ids: &[String]) -> Vec<LogSubscribeRequest> {
    program_ids
        .iter()
        .enumerate()
        .map(|(idx, program_id)| LogSubscribeRequest {
            request_id: idx as u64 + 1,
            program_id: program_id.clone(),
            payload: json!({
                "jsonrpc": "2.0",
                "id": idx as u64 + 1,
                "method": "logsSubscribe",
                "params": [
                    { "mentions": [program_id] },
                    { "commitment": "confirmed" }
                ]
            }),
        })
        .collect()
}

async fn run_logs_subscription(
    ws_url: String,
    requests: Vec<LogSubscribeRequest>,
    sender: mpsc::UnboundedSender<LiveLogCandidate>,
) -> Result<()> {
    let (stream, _) = connect_async(ws_url).await?;
    let (mut write, mut read) = stream.split();

    let mut pending_requests = HashMap::<u64, String>::new();
    let mut subscriptions = HashMap::<u64, String>::new();

    for request in &requests {
        pending_requests.insert(request.request_id, request.program_id.clone());
        write
            .send(Message::Text(request.payload.to_string().into()))
            .await?;
    }

    while let Some(message) = read.next().await {
        match message? {
            Message::Text(text) => {
                if let Some(candidate) = parse_logs_message(text.as_ref(), &mut pending_requests, &mut subscriptions)? {
                    if sender.send(candidate).is_err() {
                        break;
                    }
                }
            }
            Message::Binary(bytes) => {
                if let Ok(text) = std::str::from_utf8(&bytes) {
                    if let Some(candidate) = parse_logs_message(text, &mut pending_requests, &mut subscriptions)? {
                        if sender.send(candidate).is_err() {
                            break;
                        }
                    }
                }
            }
            Message::Ping(payload) => {
                write.send(Message::Pong(payload)).await?;
            }
            Message::Close(_) => break,
            _ => {}
        }
    }

    Ok(())
}

fn parse_logs_message(
    text: &str,
    pending_requests: &mut HashMap<u64, String>,
    subscriptions: &mut HashMap<u64, String>,
) -> Result<Option<LiveLogCandidate>> {
    let payload: Value = serde_json::from_str(text)?;

    if let Some(request_id) = payload.get("id").and_then(Value::as_u64) {
        if let Some(error) = payload.get("error") {
            return Err(anyhow!("logsSubscribe failed: {}", error));
        }
        if let Some(program_id) = pending_requests.remove(&request_id) {
            if let Some(subscription_id) = payload.get("result").and_then(Value::as_u64) {
                subscriptions.insert(subscription_id, program_id);
            }
        }
        return Ok(None);
    }

    if payload
        .get("method")
        .and_then(Value::as_str)
        != Some("logsNotification")
    {
        return Ok(None);
    }

    let subscription_id = payload
        .pointer("/params/subscription")
        .and_then(Value::as_u64)
        .ok_or_else(|| anyhow!("logsNotification missing subscription id"))?;
    let signature = payload
        .pointer("/params/result/value/signature")
        .and_then(Value::as_str)
        .ok_or_else(|| anyhow!("logsNotification missing signature"))?;
    let slot = payload
        .pointer("/params/result/context/slot")
        .and_then(Value::as_u64)
        .ok_or_else(|| anyhow!("logsNotification missing slot"))?;
    let program_id = subscriptions
        .get(&subscription_id)
        .cloned()
        .ok_or_else(|| anyhow!("unknown logs subscription id: {}", subscription_id))?;

    Ok(Some(LiveLogCandidate {
        signature: signature.to_string(),
        slot,
        matched_programs: vec![program_id],
    }))
}

#[derive(Debug)]
struct RecentSignatureWindow {
    order: VecDeque<String>,
    seen: HashSet<String>,
    capacity: usize,
}

impl RecentSignatureWindow {
    fn new(capacity: usize) -> Self {
        Self {
            order: VecDeque::new(),
            seen: HashSet::new(),
            capacity: capacity.max(1),
        }
    }

    fn insert(&mut self, signature: String) -> bool {
        if self.seen.contains(&signature) {
            return false;
        }

        self.order.push_back(signature.clone());
        self.seen.insert(signature);

        while self.order.len() > self.capacity {
            if let Some(removed) = self.order.pop_front() {
                self.seen.remove(&removed);
            }
        }

        true
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[tokio::test]
    async fn local_logs_subscriber_builds_one_logs_subscribe_request_per_program() {
        let requests = build_logs_subscribe_requests(&[
            "prog-a".to_string(),
            "prog-b".to_string(),
        ]);

        assert_eq!(requests.len(), 2);
        assert_eq!(requests[0].program_id, "prog-a");
        assert_eq!(requests[1].program_id, "prog-b");
        assert_eq!(requests[0].payload["method"], "logsSubscribe");
        assert_eq!(requests[0].payload["params"][0]["mentions"][0], "prog-a");
        assert_eq!(requests[1].payload["params"][0]["mentions"][0], "prog-b");
    }

    #[tokio::test]
    async fn local_logs_subscriber_marks_reconnect_after_disconnect() {
        let mut subscriber = LocalLogsSubscriber::new(
            "ws://127.0.0.1:8900".to_string(),
            vec!["prog-a".to_string()],
            8,
        );

        subscriber.mark_stream_disconnected();

        assert!(subscriber.take_reconnect_backfill_pending());
        assert!(!subscriber.take_reconnect_backfill_pending());
    }

    #[tokio::test]
    async fn local_logs_subscriber_dedupes_overlap_after_reconnect() {
        let mut subscriber = LocalLogsSubscriber::new(
            "ws://127.0.0.1:8900".to_string(),
            vec!["prog-a".to_string()],
            8,
        );

        let first = subscriber.filter_new_signatures(vec![
            LiveLogCandidate::new("sig-1", 10, "prog-a"),
            LiveLogCandidate::new("sig-2", 11, "prog-a"),
        ]);
        assert_eq!(first.len(), 2);

        subscriber.mark_stream_disconnected();
        assert!(subscriber.take_reconnect_backfill_pending());

        let second = subscriber.filter_new_signatures(vec![
            LiveLogCandidate::new("sig-2", 11, "prog-a"),
            LiveLogCandidate::new("sig-3", 12, "prog-a"),
        ]);
        assert_eq!(second.len(), 1);
        assert_eq!(second[0].signature, "sig-3");
    }
}
