pub mod checkpoint;
pub mod db_writer;
pub mod models;
pub mod runtime_state;
pub mod writer;

use anyhow::Result;
use sqlx::postgres::{PgPool, PgPoolOptions};

pub use checkpoint::CheckpointManager;
pub use db_writer::DbWriter;
pub use runtime_state::RuntimeStateStore;
pub use writer::BatchWriter;

pub async fn create_pool(database_url: &str) -> Result<PgPool> {
    let pool = PgPoolOptions::new()
        .max_connections(20)
        .connect(database_url)
        .await?;

    Ok(pool)
}
