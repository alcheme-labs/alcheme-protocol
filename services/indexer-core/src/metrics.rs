use std::env;
use std::time::{SystemTime, UNIX_EPOCH};

use lazy_static::lazy_static;
use prometheus::{
    register_counter, register_counter_vec, register_gauge, register_histogram_vec, Counter,
    CounterVec, Gauge, GaugeVec, HistogramVec, Registry, TextEncoder,
};

lazy_static! {
    pub static ref REGISTRY: Registry = Registry::new();

    // Event processing metrics
    pub static ref EVENTS_PROCESSED: CounterVec = register_counter_vec!(
        "alcheme_events_processed_total",
        "Total number of events processed by type",
        &["event_type"]
    )
    .unwrap();

    pub static ref EVENTS_FAILED: CounterVec = register_counter_vec!(
        "alcheme_events_failed_total",
        "Total number of events that failed processing",
        &["event_type", "error_type"]
    )
    .unwrap();

    // Indexer lag metrics
    pub static ref INDEXER_LAG: Gauge = register_gauge!(
        "alcheme_indexer_lag_seconds",
        "Time difference between blockchain head and indexed slot"
    )
    .unwrap();

    // Queue metrics
    pub static ref QUEUE_SIZE: Gauge = register_gauge!(
        "alcheme_indexer_queue_size",
        "Number of events in processing queue"
    )
    .unwrap();

    // gRPC stream metrics
    pub static ref GRPC_CONNECTED: Gauge = register_gauge!(
        "alcheme_grpc_stream_connected",
        "Whether gRPC stream is currently connected (1=yes, 0=no)"
    )
    .unwrap();

    pub static ref GRPC_MESSAGES: CounterVec = register_counter_vec!(
        "alcheme_grpc_messages_received_total",
        "Total number of gRPC messages received",
        &["message_type"]
    )
    .unwrap();

    pub static ref GRPC_BYTES_RECEIVED: CounterVec = register_counter_vec!(
        "alcheme_grpc_bytes_received_total",
        "Encoded Yellowstone gRPC bytes received by filter generation",
        &["filter"]
    )
    .unwrap();

    pub static ref GRPC_UPDATES: CounterVec = register_counter_vec!(
        "alcheme_grpc_updates_total",
        "Yellowstone gRPC updates received by filter generation and update type",
        &["filter", "update_type"]
    )
    .unwrap();

    pub static ref GRPC_RECONNECTS: CounterVec = register_counter_vec!(
        "alcheme_grpc_reconnect_total",
        "Yellowstone reconnect attempts by reason",
        &["reason"]
    )
    .unwrap();

    pub static ref GRPC_REPLAY_SLOTS: Counter = register_counter!(
        "alcheme_grpc_replay_slots_total",
        "Total inclusive Yellowstone replay slots requested"
    )
    .unwrap();

    pub static ref RPC_REQUESTS: CounterVec = register_counter_vec!(
        "alcheme_rpc_requests_total",
        "Solana JSON-RPC requests by method, caller, reason, and result",
        &["method", "caller", "reason", "result"]
    )
    .unwrap();

    pub static ref RPC_RESPONSE_BYTES: CounterVec = register_counter_vec!(
        "alcheme_rpc_response_bytes_total",
        "Solana JSON-RPC response bytes by method, caller, and reason",
        &["method", "caller", "reason"]
    )
    .unwrap();

    pub static ref RECOVERY_PHASE: GaugeVec = prometheus::register_gauge_vec!(
        "alcheme_recovery_phase",
        "Current recovery phase as a one-hot gauge",
        &["phase"]
    )
    .unwrap();

    pub static ref RECOVERY_REMAINING_SLOTS: Gauge = register_gauge!(
        "alcheme_recovery_remaining_slots",
        "Slots remaining in the active bounded recovery window"
    )
    .unwrap();

    pub static ref PROJECTION_FAILURES: CounterVec = register_counter_vec!(
        "alcheme_projection_failures_total",
        "Canonical projection failures by event type",
        &["event_type"]
    )
    .unwrap();

    pub static ref INGEST_BUDGET_STATE: GaugeVec = prometheus::register_gauge_vec!(
        "alcheme_ingest_budget_state",
        "Ingest budget state as a one-hot gauge",
        &["state"]
    )
    .unwrap();

    pub static ref PROVIDER_USAGE_RECONCILED_AT: Gauge = register_gauge!(
        "alcheme_provider_usage_reconciled_at",
        "Unix timestamp of the latest settled provider usage reconciliation"
    )
    .unwrap();

    pub static ref PROVIDER_USAGE_DELTA_BYTES: Gauge = register_gauge!(
        "alcheme_provider_usage_delta_bytes",
        "Settled provider usage byte delta for the active observation window"
    )
    .unwrap();

    pub static ref PROVIDER_USAGE_DELTA_COST: Gauge = register_gauge!(
        "alcheme_provider_usage_delta_cost",
        "Settled provider usage cost delta in USD for the active observation window"
    )
    .unwrap();

    // Database write metrics
    pub static ref DB_WRITES: CounterVec = register_counter_vec!(
        "alcheme_db_writes_total",
        "Total number of database writes",
        &["operation"]
    )
    .unwrap();

    pub static ref DB_WRITE_DURATION: HistogramVec = register_histogram_vec!(
        "alcheme_db_write_duration_seconds",
        "Database write operation duration",
        &["operation"],
        vec![0.001, 0.005, 0.01, 0.05, 0.1, 0.5, 1.0, 5.0]
    )
    .unwrap();

    // Local slot replay health metrics
    pub static ref LOCAL_FAILED_SLOTS_PENDING: Gauge = register_gauge!(
        "alcheme_local_failed_slots_pending",
        "Number of unresolved local-rpc failed slots pending replay"
    )
    .unwrap();

    pub static ref LOCAL_FAILED_SLOT_OLDEST_AGE_SECONDS: Gauge = register_gauge!(
        "alcheme_local_failed_slot_oldest_age_seconds",
        "Age of the oldest unresolved local-rpc failed slot in seconds"
    )
    .unwrap();

    pub static ref LOCAL_FAILED_SLOT_SKIPPED_TOTAL: Counter = register_counter!(
        "alcheme_local_failed_slot_skipped_total",
        "Total number of local-rpc slots skipped after retry exhaustion"
    )
    .unwrap();

    pub static ref LOCAL_FAILED_SLOT_REPLAY_TOTAL: CounterVec = register_counter_vec!(
        "alcheme_local_failed_slot_replay_total",
        "Total number of local-rpc failed slot replay attempts by result",
        &["result"]
    )
    .unwrap();

    pub static ref INDEXER_RUNTIME_CURRENT_SLOT: Gauge = register_gauge!(
        "alcheme_indexer_runtime_current_slot",
        "Current slot the indexer runtime is actively handling"
    )
    .unwrap();

    pub static ref INDEXER_RUNTIME_CURRENT_SLOT_TX_COUNT: Gauge = register_gauge!(
        "alcheme_indexer_runtime_current_slot_tx_count",
        "Transaction count for the slot currently being processed"
    )
    .unwrap();

    pub static ref INDEXER_RUNTIME_LAST_PROGRESS_UNIXTIME: Gauge = register_gauge!(
        "alcheme_indexer_runtime_last_progress_unixtime",
        "Unix timestamp of the last runtime heartbeat"
    )
    .unwrap();

    pub static ref INDEXER_RUNTIME_STUCK: Gauge = register_gauge!(
        "alcheme_indexer_runtime_stuck",
        "Whether the runtime is considered stuck (1=yes, 0=no)"
    )
    .unwrap();
}

/// Get metrics in Prometheus text format
pub fn gather_metrics() -> String {
    refresh_runtime_stuck_gauge();
    let encoder = TextEncoder::new();
    let metric_families = prometheus::gather();
    encoder.encode_to_string(&metric_families).unwrap()
}

/// Helper function to record event processing
pub fn record_event_processed(event_type: &str) {
    EVENTS_PROCESSED.with_label_values(&[event_type]).inc();
}

/// Helper function to record event failure
pub fn record_event_failed(event_type: &str, error_type: &str) {
    EVENTS_FAILED
        .with_label_values(&[event_type, error_type])
        .inc();
}

/// Helper function to update indexer lag
pub fn update_indexer_lag(seconds: f64) {
    INDEXER_LAG.set(seconds);
}

/// Helper function to update queue size
pub fn update_queue_size(size: usize) {
    QUEUE_SIZE.set(size as f64);
}

/// Helper function to set gRPC connection status
pub fn set_grpc_connected(connected: bool) {
    GRPC_CONNECTED.set(if connected { 1.0 } else { 0.0 });
}

pub fn grpc_connected() -> bool {
    GRPC_CONNECTED.get() >= 1.0
}

/// Helper function to record gRPC message
pub fn record_grpc_message(message_type: &str) {
    GRPC_MESSAGES.with_label_values(&[message_type]).inc();
}

pub fn record_grpc_update(filter: &str, update_type: &str, encoded_bytes: usize) {
    GRPC_BYTES_RECEIVED
        .with_label_values(&[filter])
        .inc_by(encoded_bytes as f64);
    GRPC_UPDATES.with_label_values(&[filter, update_type]).inc();
}

pub fn record_grpc_reconnect(reason: &str) {
    GRPC_RECONNECTS.with_label_values(&[reason]).inc();
}

pub fn record_grpc_replay_slots(slots: u64) {
    GRPC_REPLAY_SLOTS.inc_by(slots as f64);
}

pub fn record_rpc_request(
    method: &str,
    caller: &str,
    reason: &str,
    result: &str,
    response_bytes: usize,
) {
    RPC_REQUESTS
        .with_label_values(&[method, caller, reason, result])
        .inc();
    RPC_RESPONSE_BYTES
        .with_label_values(&[method, caller, reason])
        .inc_by(response_bytes as f64);
}

pub fn set_recovery_phase(phase: &str) {
    for candidate in ["idle", "discovering", "projecting", "degraded"] {
        RECOVERY_PHASE
            .with_label_values(&[candidate])
            .set(if candidate == phase { 1.0 } else { 0.0 });
    }
}

pub fn set_recovery_remaining_slots(remaining: u64) {
    RECOVERY_REMAINING_SLOTS.set(remaining as f64);
}

pub fn record_projection_failure(event_type: &str) {
    PROJECTION_FAILURES.with_label_values(&[event_type]).inc();
}

pub fn set_ingest_budget_state(state: &str) {
    for candidate in ["normal", "warning", "critical", "unreconciled"] {
        INGEST_BUDGET_STATE
            .with_label_values(&[candidate])
            .set(if candidate == state { 1.0 } else { 0.0 });
    }
}

pub fn set_provider_usage_reconciliation(
    reconciled_at_unix: i64,
    delta_bytes: u64,
    delta_cost_usd: f64,
) {
    PROVIDER_USAGE_RECONCILED_AT.set(reconciled_at_unix as f64);
    PROVIDER_USAGE_DELTA_BYTES.set(delta_bytes as f64);
    PROVIDER_USAGE_DELTA_COST.set(delta_cost_usd.max(0.0));
}

/// Helper function to record database write
pub fn record_db_write(operation: &str, duration_seconds: f64) {
    DB_WRITES.with_label_values(&[operation]).inc();
    DB_WRITE_DURATION
        .with_label_values(&[operation])
        .observe(duration_seconds);
}

pub fn set_local_failed_slots_pending(count: u64) {
    LOCAL_FAILED_SLOTS_PENDING.set(count as f64);
}

pub fn set_local_failed_slot_oldest_age_seconds(age_seconds: Option<u64>) {
    let value = age_seconds.unwrap_or(0);
    LOCAL_FAILED_SLOT_OLDEST_AGE_SECONDS.set(value as f64);
}

pub fn record_local_failed_slot_skipped() {
    LOCAL_FAILED_SLOT_SKIPPED_TOTAL.inc();
}

pub fn record_local_failed_slot_replay(success: bool) {
    let result = if success { "success" } else { "failed" };
    LOCAL_FAILED_SLOT_REPLAY_TOTAL
        .with_label_values(&[result])
        .inc();
}

pub fn set_runtime_current_slot(slot: Option<u64>) {
    INDEXER_RUNTIME_CURRENT_SLOT.set(slot.unwrap_or_default() as f64);
}

pub fn set_runtime_current_slot_tx_count(tx_count: Option<i32>) {
    INDEXER_RUNTIME_CURRENT_SLOT_TX_COUNT.set(tx_count.unwrap_or_default() as f64);
}

pub fn set_runtime_last_progress_unixtime(unix_time: i64) {
    INDEXER_RUNTIME_LAST_PROGRESS_UNIXTIME.set(unix_time as f64);
}

pub fn set_runtime_stuck(stuck: bool) {
    INDEXER_RUNTIME_STUCK.set(if stuck { 1.0 } else { 0.0 });
}

fn refresh_runtime_stuck_gauge() {
    let timeout_ms = env::var("INDEXER_RUNTIME_STUCK_AFTER_MS")
        .ok()
        .and_then(|value| value.parse::<u64>().ok())
        .unwrap_or(15_000);
    let timeout_secs = timeout_ms.div_ceil(1000) as i64;
    let last_progress = INDEXER_RUNTIME_LAST_PROGRESS_UNIXTIME.get() as i64;
    let now = current_unix_seconds();
    let is_stuck = compute_runtime_stuck(now, last_progress, timeout_secs);
    set_runtime_stuck(is_stuck);
}

pub fn initialize_cost_metrics() {
    set_recovery_phase("idle");
    set_ingest_budget_state("unreconciled");
    let _ = PROVIDER_USAGE_RECONCILED_AT.get();
    let _ = PROVIDER_USAGE_DELTA_BYTES.get();
    let _ = PROVIDER_USAGE_DELTA_COST.get();
    for method in [
        "getSlot",
        "getBlock",
        "getSignaturesForAddress",
        "getTransaction",
    ] {
        let _ = RPC_REQUESTS
            .with_label_values(&[
                method,
                "indexer",
                "metric_series_initialized",
                "not_requested",
            ])
            .get();
    }
}

fn compute_runtime_stuck(
    now_unix_seconds: i64,
    last_progress_unix_seconds: i64,
    timeout_secs: i64,
) -> bool {
    if last_progress_unix_seconds <= 0 || timeout_secs <= 0 {
        return false;
    }
    now_unix_seconds.saturating_sub(last_progress_unix_seconds) > timeout_secs
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
        compute_runtime_stuck, gather_metrics, initialize_cost_metrics, record_grpc_reconnect,
        record_grpc_replay_slots, record_grpc_update, record_projection_failure,
        record_rpc_request, set_provider_usage_reconciliation, set_recovery_phase,
        set_recovery_remaining_slots,
    };

    #[test]
    fn runtime_stuck_is_false_without_progress_timestamp() {
        assert!(!compute_runtime_stuck(100, 0, 15));
    }

    #[test]
    fn runtime_stuck_is_false_within_timeout_window() {
        assert!(!compute_runtime_stuck(100, 90, 15));
    }

    #[test]
    fn runtime_stuck_is_true_after_timeout_window() {
        assert!(compute_runtime_stuck(100, 80, 15));
    }

    #[test]
    fn cost_and_recovery_metrics_expose_bounded_dimensions() {
        initialize_cost_metrics();
        record_grpc_update("filter-a", "transaction", 128);
        record_grpc_reconnect("stream_error");
        record_grpc_replay_slots(12);
        record_rpc_request(
            "getTransaction",
            "indexer",
            "yellowstone_recovery",
            "success",
            256,
        );
        set_recovery_phase("projecting");
        set_recovery_remaining_slots(8);
        record_projection_failure("KnowledgeSubmitted");
        set_provider_usage_reconciliation(42, 1024, 0.25);

        let metrics = gather_metrics();
        for expected in [
            "alcheme_grpc_bytes_received_total",
            "alcheme_grpc_updates_total",
            "alcheme_grpc_reconnect_total",
            "alcheme_grpc_replay_slots_total",
            "alcheme_rpc_requests_total",
            "alcheme_rpc_response_bytes_total",
            "alcheme_recovery_phase",
            "alcheme_recovery_remaining_slots",
            "alcheme_projection_failures_total",
            "alcheme_ingest_budget_state",
            "alcheme_provider_usage_reconciled_at",
            "alcheme_provider_usage_delta_bytes",
            "alcheme_provider_usage_delta_cost",
        ] {
            assert!(metrics.contains(expected), "missing metric {expected}");
        }
    }

    #[test]
    fn cost_metric_initialization_exposes_zero_value_rpc_method_series() {
        initialize_cost_metrics();

        let metrics = gather_metrics();
        for method in [
            "getSlot",
            "getBlock",
            "getSignaturesForAddress",
            "getTransaction",
        ] {
            let series = metrics.lines().find(|line| {
                line.starts_with("alcheme_rpc_requests_total{")
                    && line.contains(&format!("method=\"{method}\""))
                    && line.contains("caller=\"indexer\"")
                    && line.contains("reason=\"metric_series_initialized\"")
                    && line.contains("result=\"not_requested\"")
            });

            assert_eq!(
                series.and_then(|line| line.rsplit_once(' ').map(|(_, value)| value)),
                Some("0"),
                "missing zero-value initialized RPC series for {method}"
            );
        }
    }
}
