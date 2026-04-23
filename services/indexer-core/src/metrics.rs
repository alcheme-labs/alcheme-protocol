use std::env;
use std::time::{SystemTime, UNIX_EPOCH};

use lazy_static::lazy_static;
use prometheus::{
    register_counter, register_counter_vec, register_gauge, register_histogram_vec, Counter,
    CounterVec, Gauge, HistogramVec, Registry, TextEncoder,
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
    EVENTS_PROCESSED
        .with_label_values(&[event_type])
        .inc();
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
    GRPC_MESSAGES
        .with_label_values(&[message_type])
        .inc();
}

/// Helper function to record database write
pub fn record_db_write(operation: &str, duration_seconds: f64) {
    DB_WRITES
        .with_label_values(&[operation])
        .inc();
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

fn compute_runtime_stuck(now_unix_seconds: i64, last_progress_unix_seconds: i64, timeout_secs: i64) -> bool {
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
    use super::compute_runtime_stuck;

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
}
