use axum::{
    extract::State,
    http::StatusCode,
    routing::get,
    Router,
};
use sqlx::PgPool;
use std::net::SocketAddr;
use tracing::info;

use crate::metrics;

#[derive(Clone)]
struct MetricsServerState {
    db_pool: PgPool,
    require_grpc_connected: bool,
}

/// Start the metrics HTTP server
pub async fn start_metrics_server(
    port: u16,
    db_pool: PgPool,
    require_grpc_connected: bool,
) -> Result<(), Box<dyn std::error::Error>> {
    let state = MetricsServerState {
        db_pool,
        require_grpc_connected,
    };
    let app = Router::new()
        .route("/metrics", get(metrics_handler))
        .route("/health", get(health_handler))
        .route("/ready", get(ready_handler))
        .with_state(state);

    let addr = SocketAddr::from(([0, 0, 0, 0], port));
    info!("Metrics server listening on {}", addr);

    axum::Server::bind(&addr)
        .serve(app.into_make_service())
        .await?;

    Ok(())
}

/// Handler for /metrics endpoint
async fn metrics_handler() -> String {
    metrics::gather_metrics()
}

/// Handler for /health endpoint (liveness probe)
async fn health_handler() -> &'static str {
    "OK"
}

/// Handler for /ready endpoint (readiness probe)
async fn ready_handler(State(state): State<MetricsServerState>) -> (StatusCode, &'static str) {
    let db_healthy = sqlx::query_scalar::<_, i32>("SELECT 1")
        .fetch_one(&state.db_pool)
        .await
        .is_ok();

    let ready = compute_readiness(
        db_healthy,
        state.require_grpc_connected,
        metrics::grpc_connected(),
    );

    if ready {
        (StatusCode::OK, "OK")
    } else {
        (StatusCode::SERVICE_UNAVAILABLE, "NOT_READY")
    }
}

fn compute_readiness(
    db_healthy: bool,
    require_grpc_connected: bool,
    grpc_connected: bool,
) -> bool {
    db_healthy && (!require_grpc_connected || grpc_connected)
}

#[cfg(test)]
mod tests {
    use super::compute_readiness;

    #[test]
    fn local_mode_is_ready_when_db_is_healthy() {
        assert!(compute_readiness(true, false, false));
    }

    #[test]
    fn any_mode_is_not_ready_when_db_is_unhealthy() {
        assert!(!compute_readiness(false, false, true));
        assert!(!compute_readiness(false, true, true));
    }

    #[test]
    fn yellowstone_mode_requires_grpc_connection() {
        assert!(!compute_readiness(true, true, false));
        assert!(compute_readiness(true, true, true));
    }
}
