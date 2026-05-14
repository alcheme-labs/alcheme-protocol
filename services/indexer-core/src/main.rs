use anyhow::{anyhow, Result};
use dotenv::dotenv;
use solana_sdk::pubkey::Pubkey;
use std::env;
use std::str::FromStr;
use tracing::{info, warn};
use tracing_subscriber::{layer::SubscriberExt, util::SubscriberInitExt};

mod database;
mod grpc;
mod listeners;
mod metrics;
mod metrics_server;
mod parsers;
mod utils;

use crate::database::checkpoint::CheckpointManager;
use crate::database::{DbWriter, RuntimeStateStore};
use crate::grpc::client::AlchemeGrpcClient;
use crate::listeners::event_listener::EventListener;
use crate::listeners::local_program_listener::{LocalProgramListener, PROGRAM_CURSOR_LISTENER_MODE};
use crate::listeners::local_rpc_listener::LocalRpcListener;
use crate::parsers::event_parser::EventParser;

const DEFAULT_CONTENT_MANAGER_PROGRAM_ID: &str = "FEut65PCemjUt7dRPe4GJhaj1u5czWndvgp7LCEbiV7y";

#[tokio::main]
async fn main() -> Result<()> {
    // 加载环境变量
    dotenv().ok();

    // 初始化日志
    tracing_subscriber::registry()
        .with(
            tracing_subscriber::EnvFilter::try_from_default_env().unwrap_or_else(|_| "info".into()),
        )
        .with(tracing_subscriber::fmt::layer())
        .init();

    info!("🚀 Alcheme Indexer Core starting...");

    // 读取配置
    let config = Config::from_env()?;
    info!(
        event_source = %config.event_source.as_str(),
        yellowstone_endpoint = ?config.yellowstone_endpoint,
        solana_rpc_url = %config.solana_rpc_url,
        event_emitter_program_id = %config.event_emitter_program_id,
        circle_manager_program_id = ?config.circle_manager_program_id,
        registry_factory_program_id = ?config.registry_factory_program_id,
        content_manager_program_id = %config.content_manager_program_id,
        extension_program_ids = ?config.extension_program_ids,
        enable_extension_auto_discovery = config.enable_extension_auto_discovery,
        local_listener_mode = %config.local_listener_mode.as_str(),
        has_yellowstone_token = config.yellowstone_token.is_some(),
        local_poll_interval_ms = config.local_poll_interval_ms,
        local_max_slots_per_tick = config.local_max_slots_per_tick,
        local_initial_backfill_slots = config.local_initial_backfill_slots,
        local_max_retries_per_slot = config.local_max_retries_per_slot,
        local_max_retries_per_tx = config.local_max_retries_per_tx,
        local_max_failed_txs_per_slot = config.local_max_failed_txs_per_slot,
        local_max_concurrent_tx_fetches = config.local_max_concurrent_tx_fetches,
        local_request_timeout_ms = config.local_request_timeout_ms,
        local_ws_url = %config.local_ws_url,
        local_backfill_signature_limit = config.local_backfill_signature_limit,
        local_failed_slot_replay_batch_size = config.local_failed_slot_replay_batch_size,
        local_failed_slot_replay_interval_ms = config.local_failed_slot_replay_interval_ms,
        local_failed_slot_resolved_retention_seconds = config.local_failed_slot_resolved_retention_seconds,
        local_failed_slot_prune_interval_ms = config.local_failed_slot_prune_interval_ms,
        local_failed_slot_prune_batch_size = config.local_failed_slot_prune_batch_size,
        enable_metrics = config.enable_metrics,
        metrics_port = config.metrics_port,
        indexer_id = %config.indexer_id,
        node_env = %config.node_env,
        allow_local_event_source_in_production = config.allow_local_event_source_in_production,
        "Configuration loaded",
    );

    // 初始化数据库连接
    let db_pool = database::create_pool(&config.database_url).await?;
    info!("✅ Database connection established");

    // 初始化组件
    let checkpoint_manager = CheckpointManager::new(
        db_pool.clone(),
        config.event_emitter_program_id.clone(),
        "Event Emitter".to_string(),
    );

    if config.enable_metrics {
        let metrics_db_pool = db_pool.clone();
        let metrics_port = config.metrics_port;
        let require_grpc_connected = matches!(config.event_source, EventSource::Yellowstone);

        tokio::spawn(async move {
            if let Err(error) = metrics_server::start_metrics_server(
                metrics_port,
                metrics_db_pool,
                require_grpc_connected,
            )
            .await
            {
                warn!("metrics server stopped with error: {:?}", error);
            }
        });
    }

    // 初始化 Redis 连接（用于缓存失效通知）
    let redis_conn = if let Some(url) = &config.redis_url {
        match redis::Client::open(url.as_str()) {
            Ok(client) => match client.get_multiplexed_async_connection().await {
                Ok(con) => {
                    info!("✅ Connected to Redis");
                    Some(con)
                }
                Err(e) => {
                    warn!("❌ Failed to connect to Redis: {}", e);
                    None
                }
            },
            Err(e) => {
                warn!("❌ Invalid Redis URL: {}", e);
                None
            }
        }
    } else {
        warn!("⚠️ REDIS_URL not set, cache invalidation disabled");
        None
    };

    let content_manager_program_id = Pubkey::from_str(&config.content_manager_program_id)
        .map_err(|error| anyhow!("invalid content manager program id {}: {}", config.content_manager_program_id, error))?;
    let repair_report = DbWriter::new(db_pool.clone(), redis_conn.clone())
        .repair_legacy_numeric_content_post_addresses(&content_manager_program_id)
        .await?;
    if repair_report.repaired > 0 || repair_report.skipped_invalid_rows > 0 || repair_report.skipped_missing_author > 0 {
        info!(
            scanned = repair_report.scanned,
            repaired = repair_report.repaired,
            skipped_missing_author = repair_report.skipped_missing_author,
            skipped_invalid_rows = repair_report.skipped_invalid_rows,
            records = ?repair_report.records,
            "Completed legacy numeric content post repair pass",
        );
    } else {
        info!(
            scanned = repair_report.scanned,
            "Legacy numeric content post repair pass found no rows to update",
        );
    }

    // 创建事件解析器（EventParser → DbWriter → PostgreSQL）
    let event_parser = EventParser::new(
        db_pool.clone(),
        redis_conn,
        config.event_emitter_program_id.clone(),
        config.circle_manager_program_id.clone(),
        config.external_app_registry_program_id.clone(),
        config.solana_rpc_url.clone(),
    );

    // 计算订阅目标程序（核心程序 + registry-factory + 可选扩展）
    let tracked_program_ids = config.tracked_program_ids();
    info!("Tracking program IDs: {:?}", tracked_program_ids);

    match config.event_source {
        EventSource::Yellowstone => {
            let yellowstone_endpoint = config
                .yellowstone_endpoint
                .clone()
                .ok_or_else(|| anyhow!("YELLOWSTONE endpoint is required in yellowstone mode"))?;

            // 创建 gRPC 客户端
            let grpc_client = AlchemeGrpcClient::connect(
                yellowstone_endpoint,
                config.yellowstone_token.clone(),
                tracked_program_ids,
            )
            .await?;
            info!("✅ Connected to Yellowstone gRPC");

            // 创建事件监听器（EventListener → EventParser → DbWriter）
            let mut event_listener = EventListener::new(
                grpc_client,
                checkpoint_manager,
                RuntimeStateStore::new(
                    db_pool.clone(),
                    config.indexer_id.clone(),
                    config.event_source.as_str(),
                ),
                event_parser,
                config.registry_factory_program_id.clone(),
                config.extension_program_ids.clone(),
                config.enable_extension_auto_discovery,
            );

            info!("🎧 Starting Yellowstone event listener...");

            // 运行监听器
            if let Err(e) = event_listener.start().await {
                warn!("Event listener stopped with error: {:?}", e);
                // 可以在这里实现重连逻辑
            }
        }
        EventSource::LocalRpc => {
            match config.local_listener_mode {
                LocalListenerMode::ProgramCursor => {
                    let mut local_listener = LocalProgramListener::new(
                        config.solana_rpc_url.clone(),
                        checkpoint_manager,
                        RuntimeStateStore::new(
                            db_pool.clone(),
                            config.indexer_id.clone(),
                            PROGRAM_CURSOR_LISTENER_MODE,
                        ),
                        event_parser,
                        tracked_program_ids,
                        config.registry_factory_program_id.clone(),
                        config.extension_program_ids.clone(),
                        config.enable_extension_auto_discovery,
                        config.local_poll_interval_ms,
                        config.local_max_slots_per_tick,
                        config.local_initial_backfill_slots,
                        config.local_request_timeout_ms,
                        config.local_ws_url.clone(),
                        config.local_backfill_signature_limit,
                    );

                    info!("🎧 Starting Local program-cursor listener...");
                    if let Err(e) = local_listener.start().await {
                        warn!("Local program-cursor listener stopped with error: {:?}", e);
                    }
                }
                LocalListenerMode::LegacySlotSweep => {
                    let mut local_listener = LocalRpcListener::new(
                        config.solana_rpc_url.clone(),
                        checkpoint_manager,
                        RuntimeStateStore::new(
                            db_pool.clone(),
                            config.indexer_id.clone(),
                            config.local_listener_mode.as_str(),
                        ),
                        event_parser,
                        tracked_program_ids,
                        config.registry_factory_program_id.clone(),
                        config.extension_program_ids.clone(),
                        config.enable_extension_auto_discovery,
                        config.local_poll_interval_ms,
                        config.local_max_slots_per_tick,
                        config.local_initial_backfill_slots,
                        config.local_max_retries_per_slot,
                        config.local_max_retries_per_tx,
                        config.local_max_failed_txs_per_slot,
                        config.local_max_concurrent_tx_fetches,
                        config.local_request_timeout_ms,
                        config.local_failed_slot_replay_batch_size,
                        config.local_failed_slot_replay_interval_ms,
                        config.local_failed_slot_resolved_retention_seconds,
                        config.local_failed_slot_prune_interval_ms,
                        config.local_failed_slot_prune_batch_size,
                    );

                    info!("🎧 Starting legacy Local RPC slot-sweep listener...");
                    if let Err(e) = local_listener.start().await {
                        warn!("Legacy Local RPC listener stopped with error: {:?}", e);
                    }
                }
            }
        }
    }

    Ok(())
}

#[derive(Debug, Clone)]
struct Config {
    indexer_id: String,
    node_env: String,
    allow_local_event_source_in_production: bool,
    event_source: EventSource,
    local_listener_mode: LocalListenerMode,
    yellowstone_endpoint: Option<String>,
    yellowstone_token: Option<String>,
    solana_rpc_url: String,
    event_emitter_program_id: String,
    circle_manager_program_id: Option<String>,
    external_app_registry_program_id: Option<String>,
    content_manager_program_id: String,
    registry_factory_program_id: Option<String>,
    extension_program_ids: Vec<String>,
    enable_extension_auto_discovery: bool,
    database_url: String,
    redis_url: Option<String>,
    local_poll_interval_ms: u64,
    local_max_slots_per_tick: usize,
    local_initial_backfill_slots: usize,
    local_max_retries_per_slot: u32,
    local_max_retries_per_tx: u32,
    local_max_failed_txs_per_slot: u32,
    local_max_concurrent_tx_fetches: u32,
    local_request_timeout_ms: u64,
    local_ws_url: String,
    local_backfill_signature_limit: usize,
    local_failed_slot_replay_batch_size: u32,
    local_failed_slot_replay_interval_ms: u64,
    local_failed_slot_resolved_retention_seconds: u64,
    local_failed_slot_prune_interval_ms: u64,
    local_failed_slot_prune_batch_size: u32,
    enable_metrics: bool,
    metrics_port: u16,
}

impl Config {
    fn from_env() -> Result<Self> {
        let node_env = env::var("NODE_ENV")
            .unwrap_or_else(|_| "development".to_string())
            .trim()
            .to_ascii_lowercase();
        let allow_local_event_source_in_production =
            parse_bool_env("ALLOW_LOCAL_EVENT_SOURCE_IN_PRODUCTION", false);
        let event_source =
            parse_event_source_env("INDEXER_EVENT_SOURCE", EventSource::Yellowstone)?;
        let local_listener_mode = parse_local_listener_mode_env(
            "LOCAL_LISTENER_MODE",
            LocalListenerMode::ProgramCursor,
        )?;
        let extension_program_ids = env::var("EXTENSION_PROGRAM_IDS")
            .ok()
            .map(|raw| {
                raw.split(',')
                    .map(str::trim)
                    .filter(|id| !id.is_empty())
                    .map(ToString::to_string)
                    .collect::<Vec<_>>()
            })
            .unwrap_or_default();

        let yellowstone_endpoint = env::var("RPC_ENDPOINT")
            .or_else(|_| env::var("YELLOWSTONE_ENDPOINT"))
            .ok()
            .map(|endpoint| normalize_grpc_endpoint(&endpoint));

        if matches!(event_source, EventSource::Yellowstone) && yellowstone_endpoint.is_none() {
            return Err(anyhow!(
                "RPC_ENDPOINT or YELLOWSTONE_ENDPOINT must be set when INDEXER_EVENT_SOURCE=yellowstone"
            ));
        }
        if node_env == "production"
            && matches!(event_source, EventSource::LocalRpc)
            && !allow_local_event_source_in_production
        {
            return Err(anyhow!(
                "INDEXER_EVENT_SOURCE=local is blocked in production; set ALLOW_LOCAL_EVENT_SOURCE_IN_PRODUCTION=true only for emergency"
            ));
        }

        Ok(Self {
            indexer_id: env::var("INDEXER_ID")
                .ok()
                .map(|value| value.trim().to_string())
                .filter(|value| !value.is_empty())
                .unwrap_or_else(|| "local-indexer-1".to_string()),
            node_env,
            allow_local_event_source_in_production,
            event_source,
            local_listener_mode,
            yellowstone_endpoint,
            yellowstone_token: env::var("YELLOWSTONE_TOKEN")
                .ok()
                .map(|token| token.trim().to_string())
                .filter(|token| !token.is_empty()),
            solana_rpc_url: normalize_http_endpoint(
                &env::var("SOLANA_RPC_URL").unwrap_or_else(|_| "http://127.0.0.1:8899".to_string()),
            ),
            event_emitter_program_id: env::var("EVENT_EMITTER_PROGRAM_ID")
                .expect("EVENT_EMITTER_PROGRAM_ID must be set"),
            circle_manager_program_id: env::var("CIRCLE_MANAGER_PROGRAM_ID")
                .or_else(|_| env::var("CIRCLES_PROGRAM_ID"))
                .ok()
                .map(|value| value.trim().to_string())
                .filter(|value| !value.is_empty()),
            external_app_registry_program_id: env::var("EXTERNAL_APP_REGISTRY_PROGRAM_ID")
                .or_else(|_| env::var("NEXT_PUBLIC_EXTERNAL_APP_REGISTRY_PROGRAM_ID"))
                .ok()
                .map(|value| value.trim().to_string())
                .filter(|value| !value.is_empty()),
            content_manager_program_id: env::var("CONTENT_MANAGER_PROGRAM_ID")
                .or_else(|_| env::var("NEXT_PUBLIC_CONTENT_PROGRAM_ID"))
                .ok()
                .map(|value| value.trim().to_string())
                .filter(|value| !value.is_empty())
                .unwrap_or_else(|| DEFAULT_CONTENT_MANAGER_PROGRAM_ID.to_string()),
            registry_factory_program_id: env::var("REGISTRY_FACTORY_PROGRAM_ID").ok(),
            extension_program_ids,
            enable_extension_auto_discovery: parse_bool_env(
                "ENABLE_EXTENSION_AUTO_DISCOVERY",
                true,
            ),
            database_url: env::var("DATABASE_URL").expect("DATABASE_URL must be set"),
            redis_url: env::var("REDIS_URL").ok(),
            local_poll_interval_ms: parse_u64_env("LOCAL_RPC_POLL_INTERVAL_MS", 1500),
            local_max_slots_per_tick: parse_usize_env("LOCAL_RPC_MAX_SLOTS_PER_TICK", 32),
            local_initial_backfill_slots: parse_usize_env("LOCAL_RPC_INITIAL_BACKFILL_SLOTS", 32),
            local_max_retries_per_slot: parse_u64_env("LOCAL_RPC_MAX_RETRIES_PER_SLOT", 3)
                .clamp(1, u32::MAX as u64) as u32,
            local_max_retries_per_tx: parse_u64_env("LOCAL_RPC_MAX_RETRIES_PER_TX", 1)
                .min(u32::MAX as u64) as u32,
            local_max_failed_txs_per_slot: parse_u64_env("LOCAL_RPC_MAX_FAILED_TXS_PER_SLOT", 16)
                .clamp(1, u32::MAX as u64) as u32,
            local_max_concurrent_tx_fetches: parse_u64_env(
                "LOCAL_RPC_MAX_CONCURRENT_TX_FETCHES",
                12,
            )
            .clamp(1, u32::MAX as u64) as u32,
            local_request_timeout_ms: parse_u64_env("LOCAL_RPC_REQUEST_TIMEOUT_MS", 12000),
            local_ws_url: normalize_ws_endpoint(
                &env::var("LOCAL_WS_URL").unwrap_or_else(|_| "ws://127.0.0.1:8900".to_string()),
            ),
            local_backfill_signature_limit: parse_usize_env(
                "LOCAL_BACKFILL_SIGNATURE_LIMIT",
                64,
            )
            .max(1),
            local_failed_slot_replay_batch_size: parse_u64_env(
                "LOCAL_FAILED_SLOT_REPLAY_BATCH_SIZE",
                16,
            )
            .clamp(1, u32::MAX as u64) as u32,
            local_failed_slot_replay_interval_ms: parse_u64_env(
                "LOCAL_FAILED_SLOT_REPLAY_INTERVAL_MS",
                5000,
            )
            .max(500),
            local_failed_slot_resolved_retention_seconds: parse_u64_env(
                "LOCAL_FAILED_SLOT_RESOLVED_RETENTION_SECONDS",
                7 * 24 * 3600,
            )
            .max(60),
            local_failed_slot_prune_interval_ms: parse_u64_env(
                "LOCAL_FAILED_SLOT_PRUNE_INTERVAL_MS",
                3600_000,
            )
            .max(1000),
            local_failed_slot_prune_batch_size: parse_u64_env(
                "LOCAL_FAILED_SLOT_PRUNE_BATCH_SIZE",
                500,
            )
            .clamp(1, u32::MAX as u64) as u32,
            enable_metrics: parse_bool_env("ENABLE_METRICS", false),
            metrics_port: parse_u64_env("METRICS_PORT", 9090).clamp(1, u16::MAX as u64) as u16,
        })
    }

    fn tracked_program_ids(&self) -> Vec<String> {
        let mut ids = vec![self.event_emitter_program_id.clone()];

        if let Some(registry_factory_program_id) = &self.registry_factory_program_id {
            if !ids.contains(registry_factory_program_id) {
                ids.push(registry_factory_program_id.clone());
            }
        }

        if let Some(external_app_registry_program_id) = &self.external_app_registry_program_id {
            if !ids.contains(external_app_registry_program_id) {
                ids.push(external_app_registry_program_id.clone());
            }
        }

        for extension_program_id in &self.extension_program_ids {
            if !ids.contains(extension_program_id) {
                ids.push(extension_program_id.clone());
            }
        }

        ids
    }
}

fn parse_bool_env(key: &str, default: bool) -> bool {
    match env::var(key) {
        Ok(value) => {
            let normalized = value.trim().to_ascii_lowercase();
            matches!(normalized.as_str(), "1" | "true" | "yes" | "on")
        }
        Err(_) => default,
    }
}

fn parse_u64_env(key: &str, default: u64) -> u64 {
    env::var(key)
        .ok()
        .and_then(|value| value.trim().parse::<u64>().ok())
        .unwrap_or(default)
}

fn parse_usize_env(key: &str, default: usize) -> usize {
    env::var(key)
        .ok()
        .and_then(|value| value.trim().parse::<usize>().ok())
        .unwrap_or(default)
}

fn parse_event_source_env(key: &str, default: EventSource) -> Result<EventSource> {
    let raw = match env::var(key) {
        Ok(value) => value,
        Err(_) => return Ok(default),
    };

    match raw.trim().to_ascii_lowercase().as_str() {
        "yellowstone" | "grpc" => Ok(EventSource::Yellowstone),
        "local" | "local_rpc" | "rpc" | "polling" => Ok(EventSource::LocalRpc),
        other => Err(anyhow!(
            "Invalid {} value: {}. Use one of: yellowstone, local",
            key,
            other
        )),
    }
}

fn parse_local_listener_mode_env(key: &str, default: LocalListenerMode) -> Result<LocalListenerMode> {
    let raw = match env::var(key) {
        Ok(value) => value,
        Err(_) => return Ok(default),
    };

    match raw.trim().to_ascii_lowercase().as_str() {
        "program_cursor" | "program-cursor" | "program" => Ok(LocalListenerMode::ProgramCursor),
        "legacy_slot_sweep" | "legacy-slot-sweep" | "legacy" | "slot_sweep" => {
            Ok(LocalListenerMode::LegacySlotSweep)
        }
        other => Err(anyhow!(
            "Invalid {} value: {}. Use one of: program_cursor, legacy_slot_sweep",
            key,
            other
        )),
    }
}

#[derive(Debug, Clone, Copy)]
enum EventSource {
    Yellowstone,
    LocalRpc,
}

#[derive(Debug, Clone, Copy)]
enum LocalListenerMode {
    ProgramCursor,
    LegacySlotSweep,
}

impl EventSource {
    fn as_str(self) -> &'static str {
        match self {
            EventSource::Yellowstone => "yellowstone",
            EventSource::LocalRpc => "local",
        }
    }
}

impl LocalListenerMode {
    fn as_str(self) -> &'static str {
        match self {
            LocalListenerMode::ProgramCursor => "program_cursor",
            LocalListenerMode::LegacySlotSweep => "legacy_slot_sweep",
        }
    }
}

fn normalize_grpc_endpoint(raw: &str) -> String {
    let trimmed = raw.trim();
    if trimmed.contains("://") {
        return trimmed.to_string();
    }

    if trimmed.starts_with("127.0.0.1") || trimmed.starts_with("localhost") {
        format!("http://{trimmed}")
    } else {
        format!("https://{trimmed}")
    }
}

fn normalize_ws_endpoint(raw: &str) -> String {
    let trimmed = raw.trim();
    if trimmed.contains("://") {
        return trimmed.to_string();
    }

    format!("ws://{trimmed}")
}

fn normalize_http_endpoint(raw: &str) -> String {
    let trimmed = raw.trim();
    if trimmed.contains("://") {
        return trimmed.to_string();
    }

    format!("http://{trimmed}")
}
