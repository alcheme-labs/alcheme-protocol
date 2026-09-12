use anyhow::{Context, Result};
use futures::channel::mpsc;
use futures::{Sink, Stream, StreamExt};
use solana_sdk::hash::hash;
use std::collections::HashMap;
use std::time::Duration;
use tracing::{debug, info};
use yellowstone_grpc_client::{
    ClientTlsConfig, GeyserGrpcBuilder, GeyserGrpcClient, GeyserGrpcClientError,
};
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
        info!("Connecting to configured Yellowstone gRPC endpoint");

        // Some managed Yellowstone providers do not expose the optional standard
        // gRPC Health service. Preserve fail-fast behavior for real health errors,
        // but let the mandatory Subscribe RPC establish provider compatibility.
        let mut client = build_client(&endpoint, x_token.as_deref()).await?;
        match client.health_check().await {
            Ok(_) => info!("Yellowstone standard gRPC health check succeeded"),
            Err(error) if is_optional_health_service_absence(&error) => {
                info!(
                    "Yellowstone endpoint does not expose the optional standard gRPC health \
service; deferring capability validation to Subscribe"
                );
            }
            Err(error) => {
                return Err(error).with_context(|| {
                    "Yellowstone health check failed for the configured endpoint. \
The endpoint is reachable but does not behave like Yellowstone gRPC (or auth/TLS is mismatched). \
Ensure YELLOWSTONE_ENDPOINT points to a Yellowstone gRPC endpoint, not JSON-RPC/WS/other HTTP services."
                        .to_string()
                });
            }
        }

        info!("Yellowstone gRPC channel configured");
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

    pub fn filter_generation_hash(&self) -> String {
        filter_generation_hash(&self.tracked_program_ids)
    }

    pub async fn subscribe(
        &mut self,
        start_slot: Option<u64>,
    ) -> Result<(
        impl Sink<SubscribeRequest, Error = mpsc::SendError>,
        impl Stream<Item = Result<SubscribeUpdate>>,
    )> {
        debug!("Building subscription request");

        if self.tracked_program_ids.is_empty() {
            anyhow::bail!(
                "Yellowstone tracked program set is empty; refusing an unbounded transaction subscription"
            );
        }

        if let Some(slot) = start_slot {
            info!("Starting subscription from slot: {}", slot);
        } else {
            info!("Starting subscription from current slot");
        }

        let request = build_subscription_request(&self.tracked_program_ids, start_slot);

        let mut client = build_client(&self.endpoint, self.x_token.as_deref()).await?;

        let (request_sink, stream) = client
            .subscribe_with_request(Some(request))
            .await
            .context("Failed to create subscription")?;

        Ok((
            request_sink,
            stream.map(|result| result.context("Stream error")),
        ))
    }
}

fn build_subscription_request(
    tracked_program_ids: &[String],
    start_slot: Option<u64>,
) -> SubscribeRequest {
    let mut transactions = HashMap::new();
    transactions.insert(
        "alcheme_tx".to_string(),
        SubscribeRequestFilterTransactions {
            vote: Some(false),
            failed: Some(false),
            account_include: tracked_program_ids.to_vec(),
            account_exclude: vec![],
            account_required: vec![],
            signature: None,
        },
    );

    let mut slots = HashMap::new();
    slots.insert(
        "confirmed_head".to_string(),
        SubscribeRequestFilterSlots {
            filter_by_commitment: Some(true),
            interslot_updates: Some(false),
        },
    );

    SubscribeRequest {
        accounts: HashMap::new(),
        slots,
        transactions,
        transactions_status: HashMap::new(),
        blocks: HashMap::new(),
        blocks_meta: HashMap::new(),
        entry: HashMap::new(),
        commitment: Some(CommitmentLevel::Confirmed as i32),
        accounts_data_slice: vec![],
        ping: None,
        from_slot: start_slot,
    }
}

pub(crate) fn build_heartbeat_request(id: i32) -> SubscribeRequest {
    SubscribeRequest {
        ping: Some(SubscribeRequestPing { id }),
        ..SubscribeRequest::default()
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

fn filter_generation_hash(program_ids: &[String]) -> String {
    let mut normalized = program_ids.to_vec();
    normalized.sort();
    normalized.dedup();
    hash(normalized.join("\n").as_bytes()).to_string()
}

async fn build_client(
    endpoint: &str,
    x_token: Option<&str>,
) -> Result<GeyserGrpcClient<impl yellowstone_grpc_client::Interceptor>> {
    let mut builder = build_channel_builder(endpoint)?
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

fn build_channel_builder(endpoint: &str) -> Result<GeyserGrpcBuilder> {
    let mut builder = GeyserGrpcClient::build_from_shared(endpoint.to_string())
        .context("Failed to build gRPC endpoint")?;

    if endpoint_uses_tls(endpoint) {
        builder = builder
            .tls_config(ClientTlsConfig::new().with_enabled_roots())
            .context("Failed to configure TLS for the HTTPS Yellowstone endpoint")?;
    }

    Ok(builder)
}

fn endpoint_uses_tls(endpoint: &str) -> bool {
    endpoint
        .get(..8)
        .is_some_and(|scheme| scheme.eq_ignore_ascii_case("https://"))
}

fn is_optional_health_service_absence(error: &GeyserGrpcClientError) -> bool {
    matches!(
        error,
        GeyserGrpcClientError::TonicStatus(status)
            if status.code() == tonic::Code::Unimplemented
    )
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn subscription_is_narrow_and_does_not_request_unconsumed_accounts() {
        let programs = vec!["program-a".to_string(), "program-b".to_string()];
        let request = build_subscription_request(&programs, Some(123));

        assert!(request.accounts.is_empty());
        assert_eq!(request.transactions.len(), 1);
        let transaction_filter = request
            .transactions
            .get("alcheme_tx")
            .expect("transaction filter");
        assert_eq!(transaction_filter.vote, Some(false));
        assert_eq!(transaction_filter.failed, Some(false));
        assert_eq!(transaction_filter.account_include, programs);

        assert_eq!(request.slots.len(), 1);
        let slot_filter = request.slots.get("confirmed_head").expect("slot filter");
        assert_eq!(slot_filter.filter_by_commitment, Some(true));
        assert_eq!(slot_filter.interslot_updates, Some(false));

        assert_eq!(request.commitment, Some(CommitmentLevel::Confirmed as i32));
        assert_eq!(request.from_slot, Some(123));
        assert!(request.blocks.is_empty());
        assert!(request.blocks_meta.is_empty());
        assert!(request.entry.is_empty());
    }

    #[test]
    fn heartbeat_request_only_carries_ping_control_data() {
        let request = build_heartbeat_request(41);

        assert_eq!(request.ping, Some(SubscribeRequestPing { id: 41 }));
        assert!(request.accounts.is_empty());
        assert!(request.slots.is_empty());
        assert!(request.transactions.is_empty());
        assert!(request.transactions_status.is_empty());
        assert!(request.blocks.is_empty());
        assert!(request.blocks_meta.is_empty());
        assert!(request.entry.is_empty());
        assert_eq!(request.commitment, None);
        assert_eq!(request.from_slot, None);
    }

    #[test]
    fn filter_generation_hash_is_order_independent_and_changes_with_scope() {
        let first = filter_generation_hash(&["program-b".to_string(), "program-a".to_string()]);
        let reordered = filter_generation_hash(&["program-a".to_string(), "program-b".to_string()]);
        let expanded = filter_generation_hash(&[
            "program-a".to_string(),
            "program-b".to_string(),
            "program-c".to_string(),
        ]);

        assert_eq!(first, reordered);
        assert_ne!(first, expanded);
    }

    #[tokio::test]
    async fn https_yellowstone_endpoint_enables_tls_on_the_channel() {
        let builder =
            build_channel_builder("https://127.0.0.1:9").expect("valid Yellowstone endpoint");
        let result = builder
            .connect_timeout(Duration::from_millis(100))
            .connect()
            .await;
        let error = match result {
            Ok(_) => panic!("test endpoint unexpectedly accepted a connection"),
            Err(error) => error,
        };
        let diagnostic = format!("{error:?}");

        assert!(
            !diagnostic.contains("Connecting to HTTPS without TLS enabled"),
            "HTTPS Yellowstone endpoints must configure TLS before connect: {diagnostic}"
        );
    }

    #[test]
    fn tls_scheme_detection_preserves_http_local_development() {
        assert!(endpoint_uses_tls("https://solana-devnet.g.alchemy.com"));
        assert!(endpoint_uses_tls("HTTPS://solana-devnet.g.alchemy.com"));
        assert!(!endpoint_uses_tls("http://127.0.0.1:10000"));
    }

    #[test]
    fn unimplemented_standard_health_service_defers_validation_to_subscribe() {
        let error = yellowstone_grpc_client::GeyserGrpcClientError::TonicStatus(
            tonic::Status::unimplemented(""),
        );

        assert!(is_optional_health_service_absence(&error));
    }

    #[test]
    fn real_health_failures_remain_fatal() {
        let error = yellowstone_grpc_client::GeyserGrpcClientError::TonicStatus(
            tonic::Status::unauthenticated("invalid x-token"),
        );

        assert!(!is_optional_health_service_absence(&error));
    }
}
