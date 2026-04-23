use anyhow::Result;
use redis::AsyncCommands;
use sqlx::PgPool;
use tracing::{debug, info, warn};

#[derive(Clone)]
pub struct BatchWriter {
    pool: PgPool,
    redis: Option<redis::aio::MultiplexedConnection>,
    batch_size: usize,
}

impl BatchWriter {
    pub fn new(
        pool: PgPool,
        redis: Option<redis::aio::MultiplexedConnection>,
        batch_size: usize,
    ) -> Self {
        Self {
            pool,
            redis,
            batch_size,
        }
    }

    async fn invalidate(&self, key: &str) {
        if let Some(mut conn) = self.redis.clone() {
            let payload = serde_json::json!({
                "type": "invalidation",
                "key": key
            })
            .to_string();

            if let Err(e) = conn
                .publish::<_, _, ()>("cache:invalidation", payload)
                .await
            {
                warn!("Failed to publish invalidation for {}: {}", key, e);
            } else {
                debug!("Published invalidation for {}", key);
            }
        }
    }

    pub async fn insert_user(
        &self,
        handle: &str,
        pubkey: &str,
        on_chain_address: &str,
        slot: i64,
    ) -> Result<()> {
        sqlx::query!(
            r#"
            INSERT INTO users (handle, pubkey, on_chain_address, last_synced_slot)
            VALUES ($1, $2, $3, $4)
            ON CONFLICT (handle) DO UPDATE SET
              last_synced_slot = EXCLUDED.last_synced_slot,
              updated_at = NOW()
            WHERE users.last_synced_slot < EXCLUDED.last_synced_slot
            "#,
            handle,
            pubkey,
            on_chain_address,
            slot
        )
        .execute(&self.pool)
        .await?;

        debug!("Inserted/updated user: {}", handle);
        self.invalidate(&format!("user:{}", handle)).await;
        Ok(())
    }

    pub async fn insert_post(
        &self,
        content_id: &str,
        author_handle: &str,
        text: Option<&str>,
        content_type: &str,
        on_chain_address: &str,
        slot: i64,
    ) -> Result<()> {
        // 先查找 author_id
        let author = sqlx::query!("SELECT id FROM users WHERE handle = $1", author_handle)
            .fetch_one(&self.pool)
            .await?;

        sqlx::query!(
            r#"
            INSERT INTO posts 
              (content_id, author_id, text, content_type, on_chain_address, last_synced_slot)
            VALUES ($1, $2, $3, $4, $5, $6)
            ON CONFLICT (content_id) DO UPDATE SET
              last_synced_slot = EXCLUDED.last_synced_slot,
              updated_at = NOW()
            WHERE posts.last_synced_slot < EXCLUDED.last_synced_slot
            "#,
            content_id,
            author.id,
            text,
            content_type,
            on_chain_address,
            slot
        )
        .execute(&self.pool)
        .await?;

        debug!("Inserted/updated post: {}", content_id);
        self.invalidate(&format!("user:{}", author_handle)).await;
        Ok(())
    }

    pub async fn insert_follow(
        &self,
        follower_handle: &str,
        following_handle: &str,
        on_chain_address: &str,
        slot: i64,
    ) -> Result<()> {
        let follower = sqlx::query!("SELECT id FROM users WHERE handle = $1", follower_handle)
            .fetch_one(&self.pool)
            .await?;

        let following = sqlx::query!("SELECT id FROM users WHERE handle = $1", following_handle)
            .fetch_one(&self.pool)
            .await?;

        sqlx::query!(
            r#"
            INSERT INTO follows (follower_id, following_id, on_chain_address, last_synced_slot)
            VALUES ($1, $2, $3, $4)
            ON CONFLICT (on_chain_address) DO NOTHING
            "#,
            follower.id,
            following.id,
            on_chain_address,
            slot
        )
        .execute(&self.pool)
        .await?;

        // 更新统计
        sqlx::query!(
            "UPDATE users SET followers_count = followers_count + 1 WHERE id = $1",
            following.id
        )
        .execute(&self.pool)
        .await?;

        sqlx::query!(
            "UPDATE users SET following_count = following_count + 1 WHERE id = $1",
            follower.id
        )
        .execute(&self.pool)
        .await?;

        debug!(
            "Inserted follow: {} -> {}",
            follower_handle, following_handle
        );
        self.invalidate(&format!("user:{}", follower_handle)).await;
        self.invalidate(&format!("user:{}", following_handle)).await;
        Ok(())
    }
}
