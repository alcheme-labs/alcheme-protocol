use anyhow::{Context, Result};
use std::collections::HashMap;
use std::time::Duration;
use tokio_stream::Stream;
use tokio_stream::StreamExt;
use tracing::{debug, info};
use yellowstone_grpc_client::GeyserGrpcClient;
use yellowstone_grpc_proto::prelude::*;

pub struct AlchemeGrpcClient {
    endpoint: String,
    x_token: Option<String>,
    tracked_program_ids: Vec<String>,
}

impl AlchemeGrpcClient {
    pub async fn connect(
        endpoint: String,
        x_token: Option<String>,
        tracked_program_ids: Vec<String>,
    ) -> Result<Self> {
        info!("Connecting to Yellowstone gRPC at: {}", endpoint);

        // Fail fast on startup with an explicit connection check.
        let mut client = build_client(&endpoint, x_token.as_deref()).await?;
        client
            .health_check()
            .await
            .with_context(|| {
                format!(
                    "Yellowstone health check failed for endpoint: {endpoint}. \
This endpoint is reachable but does not behave like Yellowstone gRPC (or auth/TLS is mismatched). \
Ensure RPC_ENDPOINT/YELLOWSTONE_ENDPOINT points to a Yellowstone gRPC endpoint, not JSON-RPC/WS/other HTTP services."
                )
            })?;

        info!("Successfully connected to Yellowstone gRPC");
        let tracked_program_ids = dedupe_program_ids(tracked_program_ids);

        Ok(Self {
            endpoint,
            x_token,
            tracked_program_ids,
        })
    }

    pub fn update_tracked_program_ids(&mut self, tracked_program_ids: Vec<String>) {
        self.tracked_program_ids = dedupe_program_ids(tracked_program_ids);
        info!(
            "Updated tracked program IDs for subscription refresh: {:?}",
            self.tracked_program_ids
        );
    }

    pub fn tracked_program_ids(&self) -> &[String] {
        &self.tracked_program_ids
    }

    pub async fn subscribe(
        &mut self,
        start_slot: Option<u64>,
    ) -> Result<impl Stream<Item = Result<SubscribeUpdate>>> {
        debug!("Building subscription request");

        // 订阅 event-emitter 程序的账户变动（保留，用于账户状态同步）
        let mut accounts = HashMap::new();
        accounts.insert(
            "alcheme_events".to_string(),
            SubscribeRequestFilterAccounts {
                account: vec![],
                owner: self.tracked_program_ids.clone(),
                filters: vec![],
                nonempty_txn_signature: Some(false),
            },
        );

        // 订阅 event-emitter 程序的交易（新增，用于解析事件日志）
        let mut transactions = HashMap::new();
        transactions.insert(
            "alcheme_tx".to_string(),
            SubscribeRequestFilterTransactions {
                vote: Some(false),
                failed: Some(false),
                account_include: self.tracked_program_ids.clone(),
                account_exclude: vec![],
                account_required: vec![],
                signature: None,
            },
        );

        let commitment = Some(CommitmentLevel::Confirmed);

        if let Some(slot) = start_slot {
            info!("Starting subscription from slot: {}", slot);
        } else {
            info!("Starting subscription from current slot");
        }

        let request = SubscribeRequest {
            accounts,
            slots: HashMap::new(),
            transactions,
            transactions_status: HashMap::new(),
            blocks: HashMap::new(),
            blocks_meta: HashMap::new(),
            entry: HashMap::new(),
            commitment: commitment.map(|c| c as i32),
            accounts_data_slice: vec![],
            ping: None,
            from_slot: start_slot,
        };

        let mut client = build_client(&self.endpoint, self.x_token.as_deref()).await?;

        let stream = client
            .subscribe_once(request)
            .await
            .context("Failed to create subscription")?;

        Ok(stream.map(|result| result.context("Stream error")))
    }
}

fn dedupe_program_ids(program_ids: Vec<String>) -> Vec<String> {
    let mut deduped = Vec::with_capacity(program_ids.len());
    for program_id in program_ids {
        if !deduped.contains(&program_id) {
            deduped.push(program_id);
        }
    }
    deduped
}

async fn build_client(
    endpoint: &str,
    x_token: Option<&str>,
) -> Result<GeyserGrpcClient<impl yellowstone_grpc_client::Interceptor>> {
    let mut builder = GeyserGrpcClient::build_from_shared(endpoint.to_string())
        .context("Failed to build gRPC endpoint")?
        .connect_timeout(Duration::from_secs(8))
        .timeout(Duration::from_secs(30))
        .tcp_nodelay(true)
        .keep_alive_while_idle(true);

    if let Some(token) = x_token {
        let normalized = token.trim();
        if !normalized.is_empty() {
            builder = builder
                .x_token(Some(normalized))
                .context("Invalid YELLOWSTONE_TOKEN (cannot set x-token metadata)")?;
        }
    }

    let client = builder
        .connect()
        .await
        .context("Failed to connect to gRPC endpoint")?;

    Ok(client)
}
