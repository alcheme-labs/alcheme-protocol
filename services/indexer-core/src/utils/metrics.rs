// Prometheus 指标
use lazy_static::lazy_static;
use prometheus::{IntCounter, IntGauge, Registry};

lazy_static! {
    pub static ref REGISTRY: Registry = Registry::new();
    pub static ref EVENTS_PROCESSED: IntCounter = IntCounter::new(
        "alcheme_indexer_events_processed_total",
        "Total number of events processed"
    )
    .unwrap();
    pub static ref CURRENT_SLOT: IntGauge =
        IntGauge::new("alcheme_indexer_current_slot", "Current processing slot").unwrap();
}

pub fn init_metrics() {
    REGISTRY
        .register(Box::new(EVENTS_PROCESSED.clone()))
        .unwrap();
    REGISTRY.register(Box::new(CURRENT_SLOT.clone())).unwrap();
}
