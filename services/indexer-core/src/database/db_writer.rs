use anyhow::{Context, Result};
use redis::AsyncCommands;
use solana_sdk::pubkey::Pubkey;
use sqlx::{FromRow, PgPool, Postgres, Transaction};
use std::str::FromStr;
use tracing::{debug, info, warn};

#[derive(Debug, Clone, PartialEq, Eq)]
pub(crate) struct ProjectedUserProfile {
    pub display_name: Option<String>,
    pub bio: Option<String>,
    pub avatar_uri: Option<String>,
    pub banner_uri: Option<String>,
    pub website: Option<String>,
    pub location: Option<String>,
    pub metadata_uri: Option<String>,
}

#[derive(Debug, Clone, PartialEq, Eq)]
pub(crate) struct UserProfileRowValues {
    display_name: Option<String>,
    bio: Option<String>,
    avatar_uri: Option<String>,
    banner_uri: Option<String>,
    website: Option<String>,
    location: Option<String>,
    metadata_uri: Option<String>,
}

/// 数据库写入层 - 处理所有事件类型的数据库操作
#[derive(Clone)]
pub struct DbWriter {
    pool: PgPool,
    redis: Option<redis::aio::MultiplexedConnection>,
}

const HUE_ANCHORS: [i32; 4] = [42, 200, 280, 150];
const DEFAULT_CRYSTAL_FACETS: i32 = 6;

#[derive(Debug, Clone, FromRow)]
struct KnowledgeReferenceLookupRow {
    knowledge_id: String,
    on_chain_address: String,
}

#[derive(Debug, Clone, FromRow)]
struct LegacyNumericContentPostRepairRow {
    id: i32,
    content_id: String,
    on_chain_address: String,
    author_pubkey: Option<String>,
}

#[derive(Debug, Clone, PartialEq, Eq)]
pub struct LegacyNumericContentPostRepairRecord {
    pub post_id: i32,
    pub legacy_content_id: String,
    pub previous_on_chain_address: String,
    pub repaired_on_chain_address: String,
}

#[derive(Debug, Clone, Default, PartialEq, Eq)]
pub struct LegacyNumericContentPostRepairReport {
    pub scanned: usize,
    pub repaired: usize,
    pub skipped_missing_author: usize,
    pub skipped_invalid_rows: usize,
    pub records: Vec<LegacyNumericContentPostRepairRecord>,
}

impl DbWriter {
    pub fn new(pool: PgPool, redis: Option<redis::aio::MultiplexedConnection>) -> Self {
        Self { pool, redis }
    }

    /// 发布缓存失效通知到 Redis PubSub
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
                debug!("Published cache invalidation for {}", key);
            }
        }
    }

    // ==================== 用户相关操作 ====================

    /// 创建或更新用户
    pub async fn upsert_user(&self, pubkey: &str, handle: &str, timestamp: i64) -> Result<()> {
        sqlx::query!(
            r#"
            INSERT INTO users (handle, pubkey, on_chain_address, last_synced_slot, created_at, updated_at)
            VALUES ($1, $2, $2, 0, to_timestamp($3::double precision), NOW())
            ON CONFLICT (pubkey) DO UPDATE SET
                handle = EXCLUDED.handle,
                updated_at = NOW()
            "#,
            handle,
            pubkey,
            timestamp as f64
        )
        .execute(&self.pool)
        .await
        .context("Failed to upsert user")?;

        debug!("Upserted user: {} ({})", handle, pubkey);
        self.invalidate(&format!("user:{}", handle)).await;
        Ok(())
    }

    /// 创建或更新用户，并在 identity snapshot 可用时同步协议档案字段。
    pub async fn upsert_user_from_identity_snapshot(
        &self,
        pubkey: &str,
        handle: &str,
        profile: &ProjectedUserProfile,
        timestamp: i64,
    ) -> Result<()> {
        let row = profile_row_values(profile);

        sqlx::query(
            r#"
            INSERT INTO users (
                handle,
                pubkey,
                display_name,
                bio,
                avatar_uri,
                banner_uri,
                website,
                location,
                metadata_uri,
                on_chain_address,
                last_synced_slot,
                created_at,
                updated_at
            )
            VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $2, 0, to_timestamp($10::double precision), NOW())
            ON CONFLICT (pubkey) DO UPDATE SET
                handle = EXCLUDED.handle,
                display_name = EXCLUDED.display_name,
                bio = EXCLUDED.bio,
                avatar_uri = EXCLUDED.avatar_uri,
                banner_uri = EXCLUDED.banner_uri,
                website = EXCLUDED.website,
                location = EXCLUDED.location,
                metadata_uri = EXCLUDED.metadata_uri,
                updated_at = NOW()
            "#,
        )
        .bind(handle)
        .bind(pubkey)
        .bind(row.display_name)
        .bind(row.bio)
        .bind(row.avatar_uri)
        .bind(row.banner_uri)
        .bind(row.website)
        .bind(row.location)
        .bind(row.metadata_uri)
        .bind(timestamp as f64)
        .execute(&self.pool)
        .await
        .context("Failed to upsert user from identity snapshot")?;

        debug!("Upserted user from identity snapshot: {} ({})", handle, pubkey);
        self.invalidate(&format!("user:{}", handle)).await;
        Ok(())
    }

    async fn get_or_create_user_id(&self, pubkey: &str, timestamp: i64) -> Result<i32> {
        let existing = sqlx::query_scalar::<_, i32>("SELECT id FROM users WHERE pubkey = $1")
            .bind(pubkey)
            .fetch_optional(&self.pool)
            .await
            .context("Failed to query user by pubkey")?;

        if let Some(id) = existing {
            return Ok(id);
        }

        let fallback_handle = derive_fallback_handle(pubkey);
        sqlx::query(
            r#"
            INSERT INTO users (handle, pubkey, on_chain_address, last_synced_slot, created_at, updated_at)
            VALUES ($1, $2, $2, 0, to_timestamp($3::double precision), NOW())
            ON CONFLICT (pubkey) DO UPDATE SET
                updated_at = NOW()
            "#,
        )
        .bind(&fallback_handle)
        .bind(pubkey)
        .bind(timestamp as f64)
        .execute(&self.pool)
        .await
        .with_context(|| format!("Failed to create fallback user for pubkey {}", pubkey))?;

        let user_id = sqlx::query_scalar::<_, i32>("SELECT id FROM users WHERE pubkey = $1")
            .bind(pubkey)
            .fetch_one(&self.pool)
            .await
            .with_context(|| format!("Failed to load user id for pubkey {}", pubkey))?;

        Ok(user_id)
    }

    /// 更新用户handle
    pub async fn update_user_handle(
        &self,
        pubkey: &str,
        new_handle: &str,
        timestamp: i64,
    ) -> Result<()> {
        sqlx::query!(
            r#"
            UPDATE users 
            SET handle = $2, updated_at = NOW()
            WHERE pubkey = $1
            "#,
            pubkey,
            new_handle
        )
        .execute(&self.pool)
        .await
        .context("Failed to update user handle")?;

        Ok(())
    }

    /// 转移handle
    pub async fn transfer_handle(
        &self,
        handle: &str,
        from_pubkey: &str,
        to_pubkey: &str,
        timestamp: i64,
    ) -> Result<()> {
        // 先删除旧的关联
        sqlx::query!(
            "UPDATE users SET handle = NULL WHERE pubkey = $1",
            from_pubkey
        )
        .execute(&self.pool)
        .await?;

        // 再更新新的关联
        sqlx::query!(
            "UPDATE users SET handle = $1, updated_at = NOW() WHERE pubkey = $2",
            handle,
            to_pubkey
        )
        .execute(&self.pool)
        .await?;

        Ok(())
    }

    /// 更新用户档案
    pub async fn update_user_profile(
        &self,
        pubkey: &str,
        handle: &str,
        profile: &ProjectedUserProfile,
        timestamp: i64,
    ) -> Result<()> {
        let row = profile_row_values(profile);

        sqlx::query(
            r#"
            INSERT INTO users (
                handle,
                pubkey,
                display_name,
                bio,
                avatar_uri,
                banner_uri,
                website,
                location,
                metadata_uri,
                on_chain_address,
                last_synced_slot,
                created_at,
                updated_at
            )
            VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $2, 0, to_timestamp($10::double precision), NOW())
            ON CONFLICT (pubkey) DO UPDATE SET
                handle = EXCLUDED.handle,
                display_name = EXCLUDED.display_name,
                bio = EXCLUDED.bio,
                avatar_uri = EXCLUDED.avatar_uri,
                banner_uri = EXCLUDED.banner_uri,
                website = EXCLUDED.website,
                location = EXCLUDED.location,
                metadata_uri = EXCLUDED.metadata_uri,
                updated_at = NOW()
            "#,
        )
        .bind(handle)
        .bind(pubkey)
        .bind(row.display_name)
        .bind(row.bio)
        .bind(row.avatar_uri)
        .bind(row.banner_uri)
        .bind(row.website)
        .bind(row.location)
        .bind(row.metadata_uri)
        .bind(timestamp as f64)
        .execute(&self.pool)
        .await?;

        self.invalidate(&format!("user:{}", handle)).await;
        Ok(())
    }

    /// 更新用户声誉
    pub async fn update_user_reputation(
        &self,
        pubkey: &str,
        new_reputation: i32,
        timestamp: i64,
    ) -> Result<()> {
        sqlx::query(
            "UPDATE users SET reputation_score = $2::numeric, updated_at = NOW() WHERE pubkey = $1",
        )
        .bind(pubkey)
        .bind(new_reputation as f64)
        .execute(&self.pool)
        .await?;

        Ok(())
    }

    // ==================== 内容相关操作 ====================

    /// 创建帖子
    pub async fn create_post(
        &self,
        content_id: &str,
        author_pubkey: &str,
        content_type: &str,
        timestamp: i64,
    ) -> Result<()> {
        // 先获取author_id
        let author = sqlx::query!("SELECT id FROM users WHERE pubkey = $1", author_pubkey)
            .fetch_optional(&self.pool)
            .await?;

        let author_id = match author {
            Some(u) => u.id,
            None => {
                warn!("Author not found: {}, creating...", author_pubkey);
                // 创建用户
                let fallback_handle = derive_fallback_handle(author_pubkey);
                self.upsert_user(author_pubkey, &fallback_handle, timestamp)
                    .await?;
                sqlx::query!("SELECT id FROM users WHERE pubkey = $1", author_pubkey)
                    .fetch_one(&self.pool)
                    .await?
                    .id
            }
        };

        sqlx::query!(
            r#"
            INSERT INTO posts (
                content_id,
                author_id,
                content_type,
                on_chain_address,
                last_synced_slot,
                created_at,
                updated_at
            )
            VALUES ($1, $2, $3, $1, 0, to_timestamp($4::double precision), NOW())
            ON CONFLICT (content_id) DO UPDATE SET
                author_id = EXCLUDED.author_id,
                content_type = EXCLUDED.content_type,
                on_chain_address = EXCLUDED.on_chain_address,
                updated_at = NOW()
            "#,
            content_id,
            author_id,
            content_type,
            timestamp as f64
        )
        .execute(&self.pool)
        .await?;

        self.invalidate(&format!("post:{}", content_id)).await;
        self.invalidate(&format!("user:{}", author_pubkey)).await;
        Ok(())
    }

    /// 更新帖子
    pub async fn update_post(
        &self,
        content_id: &str,
        updated_fields: Vec<String>,
        timestamp: i64,
    ) -> Result<()> {
        sqlx::query!(
            "UPDATE posts SET updated_at = NOW() WHERE content_id = $1",
            content_id
        )
        .execute(&self.pool)
        .await?;

        Ok(())
    }

    /// 记录交互
    pub async fn record_interaction(
        &self,
        content_id: &str,
        actor_pubkey: &str,
        interaction_type: &str,
        timestamp: i64,
    ) -> Result<()> {
        // 根据交互类型更新统计
        match interaction_type {
            "Like" | "\"Like\"" => {
                let actor_user_id = self.get_or_create_user_id(actor_pubkey, timestamp).await?;
                let mut tx = self.pool.begin().await?;

                let post_id =
                    sqlx::query_scalar::<_, i32>(
                        "SELECT id FROM posts WHERE content_id = $1 OR on_chain_address = $1",
                    )
                        .bind(content_id)
                        .fetch_optional(&mut *tx)
                        .await?;

                let Some(post_id) = post_id else {
                    warn!(
                        "Post {} not found while recording like interaction",
                        content_id
                    );
                    return Ok(());
                };

                let like_on_chain_address = build_like_on_chain_address(actor_user_id, post_id);
                sqlx::query(
                    "INSERT INTO likes (user_id, post_id, on_chain_address, last_synced_slot, created_at)
                     VALUES ($1, $2, $3, $4, to_timestamp($5::double precision))
                     ON CONFLICT (user_id, post_id) DO NOTHING",
                )
                .bind(actor_user_id)
                .bind(post_id)
                .bind(like_on_chain_address)
                .bind(timestamp)
                .bind(timestamp as f64)
                .execute(&mut *tx)
                .await?;

                sqlx::query(
                    "UPDATE posts
                     SET likes_count = (SELECT COUNT(*) FROM likes WHERE post_id = $1),
                         updated_at = NOW()
                     WHERE id = $1",
                )
                .bind(post_id)
                .execute(&mut *tx)
                .await?;

                tx.commit().await?;
            }
            "Share" | "\"Share\"" => {
                sqlx::query!(
                    "UPDATE posts SET shares_count = shares_count + 1 WHERE content_id = $1 OR on_chain_address = $1",
                    content_id
                )
                .execute(&self.pool)
                .await?;
            }
            "Comment" | "\"Comment\"" => {
                sqlx::query!(
                    "UPDATE posts SET comments_count = comments_count + 1 WHERE content_id = $1 OR on_chain_address = $1",
                    content_id
                )
                .execute(&self.pool)
                .await?;
            }
            _ => {}
        }

        self.invalidate(&format!("post:{}", content_id)).await;
        Ok(())
    }

    /// 审核内容
    pub async fn moderate_content(
        &self,
        content_id: &str,
        moderator_pubkey: &str,
        action: &str,
        reason: &str,
        timestamp: i64,
    ) -> Result<()> {
        // 更新帖子状态
        let status = match action {
            "ContentRemoval" | "\"ContentRemoval\"" => "Removed",
            "ContentFlagging" | "\"ContentFlagging\"" => "Flagged",
            "ContentApproval" | "\"ContentApproval\"" => "Active",
            _ => "Active",
        };

        sqlx::query("UPDATE posts SET status = $2::\"PostStatus\" WHERE content_id = $1 OR on_chain_address = $1")
            .bind(content_id)
            .bind(status)
            .execute(&self.pool)
            .await?;

        self.invalidate(&format!("post:{}", content_id)).await;
        Ok(())
    }

    /// 更新内容状态
    pub async fn update_content_status(
        &self,
        content_id: &str,
        new_status: &str,
        timestamp: i64,
    ) -> Result<()> {
        sqlx::query(
            "UPDATE posts SET status = $2::\"PostStatus\", updated_at = NOW() WHERE content_id = $1 OR on_chain_address = $1",
        )
            .bind(content_id)
            .bind(new_status)
            .execute(&self.pool)
            .await?;

        self.invalidate(&format!("post:{}", content_id)).await;
        Ok(())
    }

    pub async fn reconcile_content_post_snapshot(
        &self,
        content_id: &str,
        legacy_content_id: Option<&str>,
        reply_to: Option<&str>,
        thread_root: Option<&str>,
        repost_of: Option<&str>,
        reply_depth: i32,
        visibility: &str,
        status: &str,
        text_preview: Option<&str>,
        storage_uri: Option<&str>,
        community_on_chain_address: Option<&str>,
        v2_visibility_level: Option<&str>,
        v2_status: Option<&str>,
        is_v2_private: Option<bool>,
        is_v2_draft: Option<bool>,
        v2_audience_kind: Option<&str>,
        v2_audience_ref: Option<i32>,
    ) -> Result<()> {
        let mut tx = self.pool.begin().await?;
        let content_lookup_candidates = build_content_post_lookup_candidates(content_id, legacy_content_id);

        let post_id = sqlx::query_scalar::<_, i32>(
            "SELECT id FROM posts WHERE content_id = ANY($1) OR on_chain_address = ANY($1)",
        )
        .bind(&content_lookup_candidates)
        .fetch_optional(&mut *tx)
        .await?;

        let Some(post_id) = post_id else {
            warn!(
                "Post {} not found while reconciling content snapshot",
                content_id
            );
            return Ok(());
        };

        let parent_post_id = if let Some(reply_to_address) = reply_to {
            sqlx::query_scalar::<_, i32>(
                "SELECT id FROM posts WHERE content_id = $1 OR on_chain_address = $1",
            )
            .bind(reply_to_address)
            .fetch_optional(&mut *tx)
            .await?
        } else {
            None
        };

        let thread_root_id = if let Some(thread_root_address) = thread_root {
            sqlx::query_scalar::<_, i32>(
                "SELECT id FROM posts WHERE content_id = $1 OR on_chain_address = $1",
            )
            .bind(thread_root_address)
            .fetch_optional(&mut *tx)
            .await?
        } else {
            None
        };

        let repost_of_post_id = if let Some(repost_of_address) = repost_of {
            sqlx::query_scalar::<_, i32>(
                "SELECT id FROM posts WHERE content_id = $1 OR on_chain_address = $1",
            )
            .bind(repost_of_address)
            .fetch_optional(&mut *tx)
            .await?
        } else {
            None
        };

        let resolved_circle_id = if let Some(circle_on_chain_address) = community_on_chain_address {
            let circle_id =
                sqlx::query_scalar::<_, i32>("SELECT id FROM circles WHERE on_chain_address = $1")
                    .bind(circle_on_chain_address)
                    .fetch_optional(&mut *tx)
                    .await?;

            if circle_id.is_none() {
                warn!(
                    "Circle {} not found while reconciling content snapshot for post {}",
                    circle_on_chain_address, content_id
                );
            }

            circle_id
        } else {
            None
        };

        sqlx::query(
            "UPDATE posts
             SET on_chain_address = $2,
                 parent_post_id = $3,
                 thread_root_id = $4,
                 repost_of_post_id = $5,
                 repost_of_address = $6,
                 reply_depth = $7,
                 visibility = $8::\"Visibility\",
                 status = $9::\"PostStatus\",
                 circle_id = COALESCE($10, circle_id),
                 text = CASE
                     WHEN $11::text IS NULL THEN text
                     WHEN text IS NULL OR btrim(text) = '' THEN $11
                     ELSE text
                 END,
                 storage_uri = COALESCE($12, storage_uri),
                 v2_visibility_level = COALESCE($13, v2_visibility_level),
                 v2_status = COALESCE($14, v2_status),
                 is_v2_private = COALESCE($15, is_v2_private),
                 is_v2_draft = COALESCE($16, is_v2_draft),
                 v2_audience_kind = COALESCE($17, v2_audience_kind),
                 v2_audience_ref = COALESCE($18, v2_audience_ref),
                 updated_at = NOW()
             WHERE id = $1",
        )
        .bind(post_id)
        .bind(content_id)
        .bind(parent_post_id)
        .bind(thread_root_id)
        .bind(repost_of_post_id)
        .bind(repost_of)
        .bind(reply_depth)
        .bind(visibility)
        .bind(status)
        .bind(resolved_circle_id)
        .bind(text_preview)
        .bind(storage_uri)
        .bind(v2_visibility_level)
        .bind(v2_status)
        .bind(is_v2_private)
        .bind(is_v2_draft)
        .bind(v2_audience_kind)
        .bind(v2_audience_ref)
        .execute(&mut *tx)
        .await?;

        if let Some(parent_post_id) = parent_post_id {
            sqlx::query(
                "UPDATE posts
                 SET replies_count = (SELECT COUNT(*) FROM posts WHERE parent_post_id = $1),
                     updated_at = NOW()
                 WHERE id = $1",
            )
            .bind(parent_post_id)
            .execute(&mut *tx)
            .await?;
        }

        if let Some(repost_of_post_id) = repost_of_post_id {
            sqlx::query(
                "UPDATE posts
                 SET reposts_count = (SELECT COUNT(*) FROM posts WHERE repost_of_post_id = $1),
                     updated_at = NOW()
                 WHERE id = $1",
            )
            .bind(repost_of_post_id)
            .execute(&mut *tx)
            .await?;
        }

        tx.commit().await?;

        self.invalidate(&format!("post:{}", content_id)).await;
        if let Some(legacy_content_id) = legacy_content_id {
            self.invalidate(&format!("post:{}", legacy_content_id)).await;
        }
        if let Some(reply_to_address) = reply_to {
            self.invalidate(&format!("post:{}", reply_to_address)).await;
        }
        if let Some(thread_root_address) = thread_root {
            self.invalidate(&format!("post:{}", thread_root_address))
                .await;
        }
        if let Some(repost_of_address) = repost_of {
            self.invalidate(&format!("post:{}", repost_of_address))
                .await;
        }
        if let Some(circle_id) = resolved_circle_id {
            self.invalidate(&format!("circle:{}", circle_id)).await;
        }

        Ok(())
    }

    pub async fn repair_legacy_numeric_content_post_addresses(
        &self,
        content_program_id: &Pubkey,
    ) -> Result<LegacyNumericContentPostRepairReport> {
        let rows = sqlx::query_as::<_, LegacyNumericContentPostRepairRow>(
            "SELECT
                p.id,
                p.content_id,
                p.on_chain_address,
                u.pubkey AS author_pubkey
             FROM posts p
             LEFT JOIN users u ON u.id = p.author_id
             WHERE p.content_id ~ '^[0-9]+$'
               AND p.on_chain_address ~ '^[0-9]+$'
               AND p.content_id = p.on_chain_address
             ORDER BY p.id",
        )
        .fetch_all(&self.pool)
        .await?;

        let mut report = LegacyNumericContentPostRepairReport::default();

        for row in rows {
            report.scanned += 1;

            if !is_legacy_numeric_content_post_repair_candidate(
                &row.content_id,
                &row.on_chain_address,
            ) {
                report.skipped_invalid_rows += 1;
                continue;
            }

            let Some(author_pubkey) = row.author_pubkey.as_deref() else {
                report.skipped_missing_author += 1;
                warn!(
                    post_id = row.id,
                    content_id = %row.content_id,
                    "Skipping legacy content post repair because author pubkey is missing"
                );
                continue;
            };

            let repaired_on_chain_address =
                match derive_legacy_numeric_content_post_on_chain_address(
                    author_pubkey,
                    &row.content_id,
                    content_program_id,
                ) {
                    Ok(value) => value,
                    Err(error) => {
                        report.skipped_invalid_rows += 1;
                        warn!(
                            post_id = row.id,
                            content_id = %row.content_id,
                            author_pubkey = author_pubkey,
                            "Skipping legacy content post repair: {}",
                            error
                        );
                        continue;
                    }
                };

            if repaired_on_chain_address == row.on_chain_address {
                continue;
            }

            let updated = sqlx::query(
                "UPDATE posts
                 SET on_chain_address = $2,
                     updated_at = NOW()
                 WHERE id = $1
                   AND on_chain_address = $3",
            )
            .bind(row.id)
            .bind(&repaired_on_chain_address)
            .bind(&row.on_chain_address)
            .execute(&self.pool)
            .await?;

            if updated.rows_affected() == 0 {
                continue;
            }

            report.repaired += 1;
            report.records.push(LegacyNumericContentPostRepairRecord {
                post_id: row.id,
                legacy_content_id: row.content_id.clone(),
                previous_on_chain_address: row.on_chain_address.clone(),
                repaired_on_chain_address: repaired_on_chain_address.clone(),
            });

            self.invalidate(&format!("post:{}", row.content_id)).await;
            self.invalidate(&format!("post:{}", repaired_on_chain_address))
                .await;
        }

        Ok(report)
    }

    pub async fn update_v2_content_anchor(
        &self,
        content_id: &str,
        storage_uri: &str,
        text_preview: Option<&str>,
        timestamp: i64,
    ) -> Result<()> {
        sqlx::query(
            "UPDATE posts
             SET storage_uri = $2,
                 text = CASE
                     WHEN $3::text IS NULL THEN text
                     WHEN text IS NULL OR btrim(text) = '' THEN $3
                     ELSE text
                 END,
                 updated_at = NOW()
             WHERE content_id = $1 OR on_chain_address = $1",
        )
        .bind(content_id)
        .bind(storage_uri)
        .bind(text_preview)
        .execute(&self.pool)
        .await?;

        self.invalidate(&format!("post:{}", content_id)).await;
        let _ = timestamp;
        Ok(())
    }

    // ==================== 消息相关操作 ====================

    /// 创建会话
    pub async fn create_conversation(
        &self,
        conversation_id: &str,
        creator_pubkey: &str,
        conversation_type: &str,
        participants: Vec<String>,
        timestamp: i64,
    ) -> Result<()> {
        let mut tx = self.pool.begin().await?;

        // 查找 creator 的内部 ID
        let creator = sqlx::query_scalar::<_, i32>("SELECT id FROM users WHERE pubkey = $1")
            .bind(creator_pubkey)
            .fetch_optional(&mut *tx)
            .await?;

        let creator_id = match creator {
            Some(id) => id,
            None => {
                warn!(
                    "Creator {} not found for conversation {}",
                    creator_pubkey, conversation_id
                );
                return Ok(());
            }
        };

        // 插入会话
        sqlx::query(
            "INSERT INTO conversations (conversation_id, conversation_type, creator_id, on_chain_address, last_synced_slot, created_at, updated_at)
             VALUES ($1, $2, $3, $4, 0, to_timestamp($5), NOW())
             ON CONFLICT (conversation_id) DO NOTHING"
        )
        .bind(conversation_id)
        .bind(conversation_type)
        .bind(creator_id)
        .bind(conversation_id) // on_chain_address = conversation_id (pubkey)
        .bind(timestamp)
        .execute(&mut *tx)
        .await?;

        // 获取内部会话 ID
        let conv_internal_id =
            sqlx::query_scalar::<_, i32>("SELECT id FROM conversations WHERE conversation_id = $1")
                .bind(conversation_id)
                .fetch_one(&mut *tx)
                .await?;

        // 插入参与者
        for participant_pubkey in &participants {
            let user_id = sqlx::query_scalar::<_, i32>("SELECT id FROM users WHERE pubkey = $1")
                .bind(participant_pubkey)
                .fetch_optional(&mut *tx)
                .await?;

            if let Some(uid) = user_id {
                sqlx::query(
                    "INSERT INTO conversation_participants (conversation_id, user_id, joined_at)
                     VALUES ($1, $2, NOW())
                     ON CONFLICT (conversation_id, user_id) DO NOTHING",
                )
                .bind(conv_internal_id)
                .bind(uid)
                .execute(&mut *tx)
                .await?;
            }
        }

        tx.commit().await?;

        info!(
            "Conversation created: {} by {} with {} participants",
            conversation_id,
            creator_pubkey,
            participants.len()
        );

        self.invalidate(&format!("conversation:{}", conversation_id))
            .await;
        Ok(())
    }

    /// 创建消息
    pub async fn create_message(
        &self,
        message_id: &str,
        conversation_id: &str,
        sender_pubkey: &str,
        message_type: &str,
        reply_to: Option<String>,
        timestamp: i64,
    ) -> Result<()> {
        // 查找 sender
        let sender_id = sqlx::query_scalar::<_, i32>("SELECT id FROM users WHERE pubkey = $1")
            .bind(sender_pubkey)
            .fetch_optional(&self.pool)
            .await?;

        let sender_id = match sender_id {
            Some(id) => id,
            None => {
                warn!(
                    "Sender {} not found for message {}",
                    sender_pubkey, message_id
                );
                return Ok(());
            }
        };

        // 查找会话内部 ID
        let conv_id =
            sqlx::query_scalar::<_, i32>("SELECT id FROM conversations WHERE conversation_id = $1")
                .bind(conversation_id)
                .fetch_optional(&self.pool)
                .await?;

        // 查找 reply_to 内部 ID
        let reply_to_id: Option<i32> = if let Some(ref reply_msg_id) = reply_to {
            sqlx::query_scalar::<_, i32>("SELECT id FROM messages WHERE message_id = $1")
                .bind(reply_msg_id)
                .fetch_optional(&self.pool)
                .await?
        } else {
            None
        };

        sqlx::query(
            "INSERT INTO messages (message_id, conversation_id, sender_id, text, message_type, reply_to_id, status, on_chain_address, last_synced_slot, sent_at)
             VALUES ($1, $2, $3, '', $4, $5, 'Sent', $6, 0, to_timestamp($7))
             ON CONFLICT (message_id) DO NOTHING"
        )
        .bind(message_id)
        .bind(conv_id)
        .bind(sender_id)
        .bind(message_type)
        .bind(reply_to_id)
        .bind(message_id) // on_chain_address = message_id (pubkey)
        .bind(timestamp)
        .execute(&self.pool)
        .await?;

        info!("Message sent: {} in {}", message_id, conversation_id);

        self.invalidate(&format!("conversation:{}", conversation_id))
            .await;
        Ok(())
    }

    /// 标记消息为已读
    pub async fn mark_message_read(
        &self,
        message_id: &str,
        reader_pubkey: &str,
        timestamp: i64,
    ) -> Result<()> {
        sqlx::query(
            "UPDATE messages SET status = 'Read', read_at = to_timestamp($1) WHERE message_id = $2",
        )
        .bind(timestamp)
        .bind(message_id)
        .execute(&self.pool)
        .await?;

        info!("Message read: {} by {}", message_id, reader_pubkey);

        self.invalidate(&format!("message:{}", message_id)).await;
        Ok(())
    }

    /// 撤回消息
    pub async fn recall_message(
        &self,
        message_id: &str,
        sender_pubkey: &str,
        timestamp: i64,
    ) -> Result<()> {
        sqlx::query(
            "UPDATE messages SET status = 'Recalled', text = '[已撤回]' WHERE message_id = $1",
        )
        .bind(message_id)
        .execute(&self.pool)
        .await?;

        info!("Message recalled: {} by {}", message_id, sender_pubkey);

        self.invalidate(&format!("message:{}", message_id)).await;
        Ok(())
    }

    // ==================== 关注相关操作 ====================

    /// 记录关注操作
    pub async fn record_follow_action(
        &self,
        follower_pubkey: &str,
        followed_pubkey: &str,
        action: &str,
        timestamp: i64,
    ) -> Result<()> {
        let follower = sqlx::query!("SELECT id FROM users WHERE pubkey = $1", follower_pubkey)
            .fetch_optional(&self.pool)
            .await?;
        let followed = sqlx::query!("SELECT id FROM users WHERE pubkey = $1", followed_pubkey)
            .fetch_optional(&self.pool)
            .await?;

        if follower.is_none() || followed.is_none() {
            warn!("User not found for follow action");
            return Ok(());
        }

        let follower_id = follower.unwrap().id;
        let followed_id = followed.unwrap().id;

        match action {
            "Follow" | "\"Follow\"" => {
                let mut tx = self.pool.begin().await?;
                // FollowAction 事件目前不携带关系 PDA，因此这里使用稳定的投影 key。
                let follow_on_chain_address =
                    build_follow_on_chain_address(follower_id, followed_id);
                let inserted = sqlx::query(
                    "INSERT INTO follows (
                        follower_id,
                        following_id,
                        on_chain_address,
                        last_synced_slot,
                        created_at
                    )
                    VALUES ($1, $2, $3, $4, to_timestamp($5::double precision))
                    ON CONFLICT (follower_id, following_id) DO NOTHING",
                )
                .bind(follower_id)
                .bind(followed_id)
                .bind(follow_on_chain_address)
                .bind(0_i64)
                .bind(timestamp as f64)
                .execute(&mut *tx)
                .await?;

                if inserted.rows_affected() > 0 {
                    sqlx::query!(
                        "UPDATE users SET followers_count = followers_count + 1 WHERE id = $1",
                        followed_id
                    )
                    .execute(&mut *tx)
                    .await?;

                    sqlx::query!(
                        "UPDATE users SET following_count = following_count + 1 WHERE id = $1",
                        follower_id
                    )
                    .execute(&mut *tx)
                    .await?;
                }

                tx.commit().await?;
            }
            "Unfollow" | "\"Unfollow\"" => {
                let mut tx = self.pool.begin().await?;
                let deleted = sqlx::query(
                    "DELETE FROM follows WHERE follower_id = $1 AND following_id = $2",
                )
                .bind(follower_id)
                .bind(followed_id)
                .execute(&mut *tx)
                .await?;

                if deleted.rows_affected() > 0 {
                    sqlx::query!(
                        "UPDATE users SET followers_count = GREATEST(followers_count - 1, 0) WHERE id = $1",
                        followed_id
                    )
                    .execute(&mut *tx)
                    .await?;

                    sqlx::query!(
                        "UPDATE users SET following_count = GREATEST(following_count - 1, 0) WHERE id = $1",
                        follower_id
                    )
                    .execute(&mut *tx)
                    .await?;
                }

                tx.commit().await?;
            }
            _ => {}
        }

        self.invalidate(&format!("user:{}", follower_pubkey)).await;
        self.invalidate(&format!("user:{}", followed_pubkey)).await;
        Ok(())
    }

    /// 更新社交统计
    pub async fn update_social_stats(
        &self,
        pubkey: &str,
        stat_type: &str,
        new_value: i64,
        timestamp: i64,
    ) -> Result<()> {
        match stat_type {
            "FollowerCount" | "\"FollowerCount\"" => {
                sqlx::query!(
                    "UPDATE users SET followers_count = $2 WHERE pubkey = $1",
                    pubkey,
                    new_value as i32
                )
                .execute(&self.pool)
                .await?;
            }
            "FollowingCount" | "\"FollowingCount\"" => {
                sqlx::query!(
                    "UPDATE users SET following_count = $2 WHERE pubkey = $1",
                    pubkey,
                    new_value as i32
                )
                .execute(&self.pool)
                .await?;
            }
            "ReputationScore" | "\"ReputationScore\"" => {
                sqlx::query!(
                    "UPDATE users SET reputation_score = $2 WHERE pubkey = $1",
                    pubkey,
                    new_value as i32
                )
                .execute(&self.pool)
                .await?;
            }
            _ => {}
        }

        Ok(())
    }

    // ==================== 权限相关操作 ====================

    /// 创建访问规则
    pub async fn create_access_rule(
        &self,
        user_pubkey: &str,
        rule_id: &str,
        permission: &str,
        access_level: &str,
        timestamp: i64,
    ) -> Result<()> {
        sqlx::query!(
            r#"
            INSERT INTO access_rules (user_pubkey, rule_id, permission, access_level, created_at)
            VALUES ($1, $2, $3, $4, to_timestamp($5::double precision))
            ON CONFLICT (rule_id) DO UPDATE SET
                permission = EXCLUDED.permission,
                access_level = EXCLUDED.access_level
            "#,
            user_pubkey,
            rule_id,
            permission,
            access_level,
            timestamp as f64
        )
        .execute(&self.pool)
        .await
        .context("Failed to create access rule")?;

        info!(
            "Access rule created: {} for {} ({})",
            rule_id, user_pubkey, permission
        );
        self.invalidate(&format!("acl:{}", user_pubkey)).await;
        Ok(())
    }

    /// 授予权限
    pub async fn grant_permission(
        &self,
        granter_pubkey: &str,
        grantee_pubkey: &str,
        permission: &str,
        timestamp: i64,
    ) -> Result<()> {
        sqlx::query!(
            r#"
            INSERT INTO permissions (granter_pubkey, grantee_pubkey, permission, created_at)
            VALUES ($1, $2, $3, to_timestamp($4::double precision))
            ON CONFLICT (granter_pubkey, grantee_pubkey, permission) DO NOTHING
            "#,
            granter_pubkey,
            grantee_pubkey,
            permission,
            timestamp as f64
        )
        .execute(&self.pool)
        .await
        .context("Failed to grant permission")?;

        info!(
            "Permission granted: {} from {} to {}",
            permission, granter_pubkey, grantee_pubkey
        );
        self.invalidate(&format!("perm:{}", grantee_pubkey)).await;
        Ok(())
    }

    /// 更新关系
    pub async fn update_relationship(
        &self,
        user1_pubkey: &str,
        user2_pubkey: &str,
        relationship: &str,
        timestamp: i64,
    ) -> Result<()> {
        sqlx::query!(
            r#"
            INSERT INTO user_relationships (user1_pubkey, user2_pubkey, relationship, created_at, updated_at)
            VALUES ($1, $2, $3, to_timestamp($4::double precision), NOW())
            ON CONFLICT (user1_pubkey, user2_pubkey) DO UPDATE SET
                relationship = EXCLUDED.relationship,
                updated_at = NOW()
            "#,
            user1_pubkey,
            user2_pubkey,
            relationship,
            timestamp as f64
        )
        .execute(&self.pool)
        .await
        .context("Failed to update relationship")?;

        info!(
            "Relationship updated: {} <-> {} ({})",
            user1_pubkey, user2_pubkey, relationship
        );
        self.invalidate(&format!("rel:{}", user1_pubkey)).await;
        self.invalidate(&format!("rel:{}", user2_pubkey)).await;
        Ok(())
    }

    // ==================== 经济相关操作 ====================

    /// 记录代币交易
    pub async fn record_token_transaction(
        &self,
        pubkey: &str,
        amount: i64,
        transaction_type: &str,
        purpose: &str,
        timestamp: i64,
    ) -> Result<()> {
        sqlx::query!(
            r#"
            INSERT INTO token_transactions (pubkey, amount, transaction_type, purpose, created_at)
            VALUES ($1, $2, $3, $4, to_timestamp($5::double precision))
            "#,
            pubkey,
            amount,
            transaction_type,
            purpose,
            timestamp as f64
        )
        .execute(&self.pool)
        .await
        .context("Failed to record token transaction")?;

        info!(
            "Token transaction: {} {} {} for {}",
            pubkey, transaction_type, amount, purpose
        );
        self.invalidate(&format!("token:{}", pubkey)).await;
        Ok(())
    }

    // ==================== 圈层 & 知识相关操作 ====================

    /// 创建或更新圈层（从链上事件同步）
    pub async fn upsert_circle(
        &self,
        circle_id: i32,
        name: &str,
        level: i32,
        parent_circle_id: Option<i32>,
        flags: i64,
        creator_pubkey: &str,
        on_chain_address: &str,
        timestamp: i64,
    ) -> Result<()> {
        let creator_id = self
            .get_or_create_user_id(creator_pubkey, timestamp)
            .await?;
        let effective_on_chain_address = if on_chain_address.trim().is_empty() {
            format!("circle:{}", circle_id)
        } else {
            on_chain_address.to_string()
        };

        // 从 flags 位字段解码
        let kind = if flags & 0x1 == 0 {
            "main"
        } else {
            "auxiliary"
        };
        let mode = if (flags >> 1) & 0x1 == 0 {
            "knowledge"
        } else {
            "social"
        };
        let min_crystals = ((flags >> 2) & 0xFFFF) as i32;

        sqlx::query!(
            r#"
            INSERT INTO circles (id, name, creator_id, level, parent_circle_id, kind, mode, min_crystals,
                                 on_chain_address, last_synced_slot, created_at)
            VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, 0, to_timestamp($10::double precision))
            ON CONFLICT (id) DO UPDATE SET
                name = EXCLUDED.name,
                creator_id = COALESCE(circles.creator_id, EXCLUDED.creator_id),
                level = EXCLUDED.level,
                parent_circle_id = COALESCE(circles.parent_circle_id, EXCLUDED.parent_circle_id),
                kind = EXCLUDED.kind,
                mode = EXCLUDED.mode,
                min_crystals = EXCLUDED.min_crystals,
                on_chain_address = EXCLUDED.on_chain_address,
                updated_at = NOW()
            "#,
            circle_id,
            name,
            creator_id,
            level,
            parent_circle_id,
            kind,
            mode,
            min_crystals,
            effective_on_chain_address,
            timestamp as f64
        )
        .execute(&self.pool)
        .await
        .context("Failed to upsert circle")?;

        // Ensure the creator is materialized as an active owner member so
        // "my circles" queries and role checks are consistent with on-chain creation.
        let member_on_chain_address = format!("cm:{}:{}", circle_id, creator_id);
        sqlx::query!(
            r#"
            INSERT INTO circle_members (
                circle_id,
                user_id,
                role,
                status,
                identity_level,
                on_chain_address,
                last_synced_slot,
                joined_at,
                updated_at
            )
            VALUES (
                $1,
                $2,
                'Owner'::"MemberRole",
                'Active'::"MemberStatus",
                'Member'::"IdentityLevel",
                $3,
                0,
                to_timestamp($4::double precision),
                NOW()
            )
            ON CONFLICT (circle_id, user_id) DO NOTHING
            "#,
            circle_id,
            creator_id,
            member_on_chain_address,
            timestamp as f64
        )
        .execute(&self.pool)
        .await
        .context("Failed to upsert circle creator membership")?;

        info!(
            "🔵 Circle upserted: id={} name={} creator={} kind={} mode={}",
            circle_id, name, creator_pubkey, kind, mode
        );
        self.invalidate(&format!("circle:{}", circle_id)).await;
        Ok(())
    }

    pub async fn upsert_circle_member(
        &self,
        circle_id: i32,
        member_pubkey: &str,
        role: &str,
        status: &str,
        on_chain_address: Option<&str>,
        timestamp: i64,
    ) -> Result<()> {
        let user_id = self
            .get_or_create_user_id(member_pubkey, timestamp)
            .await?;
        let effective_on_chain_address =
            resolve_circle_member_on_chain_address(on_chain_address, circle_id, user_id);

        sqlx::query(
            r#"
            INSERT INTO circle_members (
                circle_id,
                user_id,
                role,
                status,
                identity_level,
                on_chain_address,
                last_synced_slot,
                joined_at,
                updated_at
            )
            VALUES (
                $1,
                $2,
                $3::"MemberRole",
                $4::"MemberStatus",
                CASE
                    WHEN $4 = 'Active' THEN 'Initiate'::"IdentityLevel"
                    ELSE 'Visitor'::"IdentityLevel"
                END,
                $5,
                0,
                to_timestamp($6::double precision),
                NOW()
            )
            ON CONFLICT (circle_id, user_id) DO UPDATE SET
                role = EXCLUDED.role,
                status = EXCLUDED.status,
                identity_level = CASE
                    WHEN circle_members.identity_level = 'Visitor'::"IdentityLevel"
                        AND EXCLUDED.status = 'Active'::"MemberStatus"
                    THEN 'Initiate'::"IdentityLevel"
                    ELSE circle_members.identity_level
                END,
                on_chain_address = COALESCE(NULLIF(EXCLUDED.on_chain_address, ''), circle_members.on_chain_address),
                updated_at = NOW()
            "#,
        )
        .bind(circle_id)
        .bind(user_id)
        .bind(role)
        .bind(status)
        .bind(effective_on_chain_address)
        .bind(timestamp as f64)
        .execute(&self.pool)
        .await
        .context("Failed to upsert circle member projection")?;

        self.invalidate(&format!("circle:{}", circle_id)).await;
        self.invalidate(&format!("user:{}", member_pubkey)).await;
        Ok(())
    }

    /// 更新圈层 flags（kind/mode/min_crystals）
    pub async fn update_circle_flags(
        &self,
        circle_id: i32,
        flags: i64,
        timestamp: i64,
    ) -> Result<()> {
        let kind = if flags & 0x1 == 0 {
            "main"
        } else {
            "auxiliary"
        };
        let mode = if (flags >> 1) & 0x1 == 0 {
            "knowledge"
        } else {
            "social"
        };
        let min_crystals = ((flags >> 2) & 0xFFFF) as i32;

        sqlx::query!(
            r#"
            UPDATE circles SET
                kind = $2,
                mode = $3,
                min_crystals = $4,
                updated_at = NOW()
            WHERE id = $1
            "#,
            circle_id,
            kind,
            mode,
            min_crystals
        )
        .execute(&self.pool)
        .await
        .context("Failed to update circle flags")?;

        info!(
            "🔵 Circle flags updated: id={} kind={} mode={} min_crystals={}",
            circle_id, kind, mode, min_crystals
        );
        self.invalidate(&format!("circle:{}", circle_id)).await;
        Ok(())
    }

    /// 创建或更新知识条目（从链上事件同步）
    pub async fn upsert_knowledge(
        &self,
        knowledge_id: &str,
        circle_id: i32,
        author_pubkey: &str,
        title: &str,
        flags: i64,
        content_hash: &str,
        on_chain_address: Option<&str>,
        ipfs_cid: Option<&str>,
        timestamp: i64,
    ) -> Result<()> {
        let version = (flags & 0xFFFF) as i32;
        let effective_on_chain_address = if on_chain_address.unwrap_or_default().trim().is_empty() {
            let mut fallback = knowledge_id.chars().take(44).collect::<String>();
            if fallback.is_empty() {
                fallback = "knowledge_unknown".to_string();
            }
            fallback
        } else {
            on_chain_address.unwrap().to_string()
        };

        // 查找/创建 author_id
        let author_id = self.get_or_create_user_id(author_pubkey, timestamp).await?;

        let effective_content_hash: Option<&str> = if content_hash.trim().is_empty() {
            None
        } else {
            Some(content_hash)
        };
        let effective_ipfs_cid: Option<&str> = ipfs_cid.and_then(|value| {
            let trimmed = value.trim();
            if trimmed.is_empty() {
                None
            } else {
                Some(trimmed)
            }
        });

        let circle_name: Option<String> =
            sqlx::query_scalar("SELECT name FROM circles WHERE id = $1")
                .bind(circle_id)
                .fetch_optional(&self.pool)
                .await
                .context("Failed to fetch circle name for crystal params")?;

        let crystal_params_json = serde_json::to_string(&build_crystal_params_json(
            knowledge_id,
            circle_name.as_deref(),
            0,
        ))
        .context("Failed to encode crystal params JSON")?;

        sqlx::query(
            r#"
            INSERT INTO knowledge (knowledge_id, circle_id, author_id, title, version,
                                   content_hash, ipfs_cid, on_chain_address, last_synced_slot,
                                   crystal_params, created_at)
            VALUES ($1, $2, $3, $4, $5, $6, $7, $8, 0, $9::jsonb, to_timestamp($10::double precision))
            ON CONFLICT (knowledge_id) DO UPDATE SET
                title = EXCLUDED.title,
                version = EXCLUDED.version,
                content_hash = COALESCE(EXCLUDED.content_hash, knowledge.content_hash),
                ipfs_cid = COALESCE(EXCLUDED.ipfs_cid, knowledge.ipfs_cid),
                on_chain_address = EXCLUDED.on_chain_address,
                updated_at = NOW()
            "#,
        )
        .bind(knowledge_id)
        .bind(circle_id)
        .bind(author_id)
        .bind(title)
        .bind(version)
        .bind(effective_content_hash)
        .bind(effective_ipfs_cid)
        .bind(effective_on_chain_address)
        .bind(crystal_params_json)
        .bind(timestamp as f64)
        .execute(&self.pool)
        .await
        .context("Failed to upsert knowledge")?;

        self.record_knowledge_version_event(
            knowledge_id,
            "knowledge_submitted",
            version,
            Some(author_pubkey),
            None,
            None,
            timestamp,
        )
        .await?;

        // Notify the author about the new crystallization (idempotent — skips if
        // a 'crystal' notification for this knowledge_id already exists).
        let notif_title = format!("知识已结晶");
        let notif_body = format!("你的知识「{}」已成功结晶", title);
        sqlx::query(
            r#"
            INSERT INTO notifications (user_id, type, title, body, source_type, source_id, circle_id, read, created_at)
            SELECT $1, 'crystal', $2, $3, 'knowledge', $4, $5, false, NOW()
            WHERE NOT EXISTS (
                SELECT 1 FROM notifications
                WHERE user_id = $1
                  AND type = 'crystal'
                  AND source_type = 'knowledge'
                  AND source_id = $4
            )
            "#,
        )
        .bind(author_id)
        .bind(&notif_title)
        .bind(&notif_body)
        .bind(knowledge_id)
        .bind(circle_id)
        .execute(&self.pool)
        .await
        .context("Failed to create crystal notification")?;

        // Check if the author has hit a crystal milestone (5/10/20/50/100).
        // Creates a 'circle' notification at each milestone (idempotent per milestone).
        let crystal_count: Option<i64> =
            sqlx::query_scalar("SELECT COUNT(*) FROM knowledge WHERE author_id = $1")
                .bind(author_id)
                .fetch_one(&self.pool)
                .await
                .unwrap_or(Some(0));

        let count = crystal_count.unwrap_or(0);
        let milestones: &[i64] = &[5, 10, 20, 50, 100];
        for &milestone in milestones {
            if count >= milestone {
                let ms_source_id = format!("milestone:{}", milestone);
                let ms_title = format!("晶体里程碑");
                let ms_body = format!("你已拥有 {} 枚知识晶体！继续探索更多圈层吧", milestone);
                sqlx::query(
                    r#"
                    INSERT INTO notifications (user_id, type, title, body, source_type, source_id, read, created_at)
                    SELECT $1, 'circle', $2, $3, 'milestone', $4, false, NOW()
                    WHERE NOT EXISTS (
                        SELECT 1 FROM notifications
                        WHERE user_id = $1
                          AND type = 'circle'
                          AND source_type = 'milestone'
                          AND source_id = $4
                    )
                    "#,
                )
                .bind(author_id)
                .bind(&ms_title)
                .bind(&ms_body)
                .bind(&ms_source_id)
                .execute(&self.pool)
                .await
                .context("Failed to create milestone notification")?;
            }
        }

        info!(
            "💎 Knowledge upserted: id={} title={} v{}",
            knowledge_id, title, version
        );

        // Evaluate totem stage for the author
        self.evaluate_totem(author_id).await?;

        self.invalidate(&format!("knowledge:{}", knowledge_id))
            .await;
        self.invalidate(&format!("circle:{}:knowledge", circle_id))
            .await;
        Ok(())
    }

    pub async fn reconcile_knowledge_snapshot(
        &self,
        knowledge_id: &str,
        on_chain_address: &str,
        ipfs_cid: Option<&str>,
    ) -> Result<()> {
        if knowledge_id.trim().is_empty() || on_chain_address.trim().is_empty() {
            return Ok(());
        }

        sqlx::query(
            r#"
            UPDATE knowledge
            SET on_chain_address = $2,
                ipfs_cid = COALESCE($3, knowledge.ipfs_cid),
                updated_at = NOW()
            WHERE knowledge_id = $1
            "#,
        )
        .bind(knowledge_id)
        .bind(on_chain_address)
        .bind(ipfs_cid.and_then(|value| {
            let trimmed = value.trim();
            if trimmed.is_empty() {
                None
            } else {
                Some(trimmed)
            }
        }))
        .execute(&self.pool)
        .await
        .context("Failed to reconcile knowledge snapshot")?;

        self.invalidate(&format!("knowledge:{}", knowledge_id))
            .await;
        Ok(())
    }

    /// 处理引用事件（replay-safe: UPSERT + derived count）
    pub async fn handle_reference_added(
        &self,
        source_knowledge_id: &str,
        target_knowledge_id: &str,
        reference_type: &str,
    ) -> Result<()> {
        let Some(canonical_source_knowledge_id) = self
            .resolve_canonical_knowledge_id(source_knowledge_id)
            .await?
        else {
            warn!(
                "Skipping reference insert: source knowledge not found for raw id {}",
                source_knowledge_id
            );
            return Ok(());
        };

        let Some(canonical_target_knowledge_id) = self
            .resolve_canonical_knowledge_id(target_knowledge_id)
            .await?
        else {
            warn!(
                "Skipping reference insert: target knowledge not found for raw id {}",
                target_knowledge_id
            );
            return Ok(());
        };

        // 1. UPSERT reference relationship (idempotent via composite PK)
        let insert_result = sqlx::query(
            r#"
            INSERT INTO knowledge_references (source_knowledge_id, target_knowledge_id, reference_type)
            VALUES ($1, $2, $3)
            ON CONFLICT (source_knowledge_id, target_knowledge_id) DO NOTHING
            "#,
        )
        .bind(&canonical_source_knowledge_id)
        .bind(&canonical_target_knowledge_id)
        .bind(reference_type)
        .execute(&self.pool)
        .await
        .context("Failed to upsert knowledge reference")?;

        let citation_heat_delta = citation_heat_delta(insert_result.rows_affected());

        // 2. Recompute citation_count from actual reference count and only add heat on first insert
        sqlx::query(
            r#"
            UPDATE knowledge SET
                heat_score = LEAST(heat_score + $2, 200),
                citation_count = (SELECT COUNT(*) FROM knowledge_references WHERE target_knowledge_id = $1),
                updated_at = NOW()
            WHERE knowledge_id = $1
            "#,
        )
        .bind(&canonical_target_knowledge_id)
        .bind(citation_heat_delta)
        .execute(&self.pool)
        .await
        .context("Failed to update citation count")?;

        // 3. Notification for target author (idempotent per source→target pair)
        let notif_source_id = format!(
            "ref:{}:{}",
            canonical_source_knowledge_id, canonical_target_knowledge_id
        );
        sqlx::query(
            r#"
            INSERT INTO notifications (user_id, type, title, body, source_type, source_id, read, created_at)
            SELECT k.author_id, 'citation', '你的晶体被引用了',
                   CONCAT('你的知识「', k.title, '」被其他晶体引用'),
                   'knowledge', $2, false, NOW()
            FROM knowledge k WHERE k.knowledge_id = $1
            AND NOT EXISTS (
                SELECT 1 FROM notifications
                WHERE user_id = k.author_id AND type = 'citation'
                  AND source_id = $2
            )
            "#,
        )
        .bind(&canonical_target_knowledge_id)
        .bind(&notif_source_id)
        .execute(&self.pool)
        .await
        .context("Failed to create citation notification")?;

        info!(
            "📎 Reference recorded: {} -> {} ({})",
            canonical_source_knowledge_id, canonical_target_knowledge_id, reference_type
        );

        // Evaluate totem for the target knowledge's author
        let target_author_id: Option<i32> =
            sqlx::query_scalar("SELECT author_id FROM knowledge WHERE knowledge_id = $1")
                .bind(&canonical_target_knowledge_id)
                .fetch_optional(&self.pool)
                .await?;

        if let Some(author_id) = target_author_id {
            self.evaluate_totem(author_id).await?;
        }

        self.invalidate(&format!("knowledge:{}", canonical_target_knowledge_id))
            .await;
        Ok(())
    }

    async fn resolve_canonical_knowledge_id(&self, raw_id: &str) -> Result<Option<String>> {
        let candidates = build_knowledge_reference_candidates(raw_id);
        if candidates.is_empty() {
            return Ok(None);
        }

        let rows = sqlx::query_as::<_, KnowledgeReferenceLookupRow>(
            r#"
            SELECT knowledge_id, on_chain_address
            FROM knowledge
            WHERE knowledge_id = ANY($1) OR on_chain_address = ANY($1)
            "#,
        )
        .bind(&candidates)
        .fetch_all(&self.pool)
        .await
        .context("Failed to resolve canonical knowledge id for reference")?;

        Ok(select_canonical_knowledge_id(&candidates, &rows))
    }

    /// Evaluate and update user's Totem stage (replay-safe)
    pub async fn evaluate_totem(&self, user_id: i32) -> Result<()> {
        // 1. Aggregate current stats in a single query
        let stats: Option<(Option<i64>, Option<i64>, Option<i64>)> = sqlx::query_as(
            r#"
            SELECT
                COUNT(*)::bigint,
                COALESCE(SUM(citation_count), 0)::bigint,
                COUNT(DISTINCT circle_id)::bigint
            FROM knowledge WHERE author_id = $1
            "#,
        )
        .bind(user_id)
        .fetch_optional(&self.pool)
        .await?;

        let (crystal_count, citation_count, circle_count) = match stats {
            Some((c, ci, cc)) => (c.unwrap_or(0), ci.unwrap_or(0), cc.unwrap_or(0)),
            None => (0, 0, 0),
        };

        // 2. Determine stage (highest matching, ordered desc)
        let new_stage = if crystal_count >= 50 && citation_count >= 200 && circle_count >= 10 {
            "legendary"
        } else if crystal_count >= 25 && citation_count >= 50 && circle_count >= 5 {
            "radiant"
        } else if crystal_count >= 10 && citation_count >= 10 {
            "bloom"
        } else if crystal_count >= 1 {
            "sprout"
        } else {
            "seed"
        };

        // 3. Get previous stage for upgrade detection
        let old_stage: Option<String> =
            sqlx::query_scalar("SELECT stage FROM user_totem WHERE user_id = $1")
                .bind(user_id)
                .fetch_optional(&self.pool)
                .await?;

        // 4. UPSERT with last_active_at computed in SQL (avoids chrono dep)
        sqlx::query(
            r#"
            INSERT INTO user_totem (user_id, stage, crystal_count, citation_count, circle_count, last_active_at, updated_at)
            VALUES ($1, $2, $3, $4, $5,
                    COALESCE((SELECT MAX(created_at) FROM knowledge WHERE author_id = $1), NOW()),
                    NOW())
            ON CONFLICT (user_id) DO UPDATE SET
                stage = $2,
                crystal_count = $3,
                citation_count = $4,
                circle_count = $5,
                last_active_at = COALESCE((SELECT MAX(created_at) FROM knowledge WHERE author_id = $1), user_totem.last_active_at),
                updated_at = NOW()
            "#,
        )
        .bind(user_id)
        .bind(new_stage)
        .bind(crystal_count as i32)
        .bind(citation_count as i32)
        .bind(circle_count as i32)
        .execute(&self.pool)
        .await
        .context("Failed to upsert user_totem")?;

        // 5. Notify on stage upgrade
        let stage_order = |s: &str| -> u8 {
            match s {
                "seed" => 0,
                "sprout" => 1,
                "bloom" => 2,
                "radiant" => 3,
                "legendary" => 4,
                _ => 0,
            }
        };

        let old_order = old_stage.as_deref().map(stage_order).unwrap_or(0);
        let new_order = stage_order(new_stage);

        if new_order > old_order {
            let (notif_title, notif_body) = match new_stage {
                "sprout" => ("你的图腾开始萌芽了", "你的首个知识晶体为图腾注入了生命"),
                "bloom" => ("你的图腾正在绽放", "持续的贡献让你的图腾更加明亮"),
                "radiant" => ("你的图腾璀璨夺目", "你的思考在多个圈层扎根，图腾放射出光芒"),
                "legendary" => ("你的图腾已成传世之作", "你的知识已成为社区的基石"),
                _ => return Ok(()),
            };

            let notif_source_id = format!("totem:{}", new_stage);
            sqlx::query(
                r#"
                INSERT INTO notifications (user_id, type, title, body, source_type, source_id, read, created_at)
                SELECT $1, 'crystal', $2, $3, 'totem', $4, false, NOW()
                WHERE NOT EXISTS (
                    SELECT 1 FROM notifications
                    WHERE user_id = $1 AND source_type = 'totem' AND source_id = $4
                )
                "#,
            )
            .bind(user_id)
            .bind(notif_title)
            .bind(notif_body)
            .bind(&notif_source_id)
            .execute(&self.pool)
            .await
            .context("Failed to create totem notification")?;

            info!("🏆 Totem upgrade: user {} → {}", user_id, new_stage);
        }

        self.invalidate(&format!("user:totem:{}", user_id)).await;
        Ok(())
    }

    /// Upsert knowledge binding projection from on-chain ContributorProofBound event.
    pub async fn upsert_knowledge_binding(
        &self,
        knowledge_id: &str,
        source_anchor_id: &str,
        proof_package_hash: &str,
        contributors_root: &str,
        contributors_count: i32,
        binding_version: i32,
        generated_at: i64,
        bound_by_pubkey: &str,
        bound_at: i64,
    ) -> Result<()> {
        if knowledge_id.trim().is_empty() {
            return Ok(());
        }

        sqlx::query(
            r#"
            INSERT INTO knowledge_binding (
                knowledge_id,
                source_anchor_id,
                proof_package_hash,
                contributors_root,
                contributors_count,
                binding_version,
                generated_at,
                bound_at,
                bound_by,
                created_at,
                updated_at
            )
            VALUES (
                $1,
                $2,
                $3,
                $4,
                $5,
                $6,
                to_timestamp($7::double precision),
                to_timestamp($8::double precision),
                $9,
                NOW(),
                NOW()
            )
            ON CONFLICT (knowledge_id) DO UPDATE SET
                source_anchor_id = EXCLUDED.source_anchor_id,
                proof_package_hash = EXCLUDED.proof_package_hash,
                contributors_root = EXCLUDED.contributors_root,
                contributors_count = EXCLUDED.contributors_count,
                binding_version = EXCLUDED.binding_version,
                generated_at = EXCLUDED.generated_at,
                bound_at = EXCLUDED.bound_at,
                bound_by = EXCLUDED.bound_by,
                updated_at = NOW()
            "#,
        )
        .bind(knowledge_id)
        .bind(source_anchor_id)
        .bind(proof_package_hash)
        .bind(contributors_root)
        .bind(contributors_count)
        .bind(binding_version)
        .bind(generated_at as f64)
        .bind(bound_at as f64)
        .bind(bound_by_pubkey)
        .execute(&self.pool)
        .await
        .context("Failed to upsert knowledge binding projection")?;

        self.record_knowledge_version_event(
            knowledge_id,
            "contributor_proof_bound",
            binding_version,
            Some(bound_by_pubkey),
            Some(contributors_count),
            Some(contributors_root),
            bound_at,
        )
        .await?;

        info!(
            "🔗 Knowledge binding projected: id={} v{} count={}",
            knowledge_id, binding_version, contributors_count
        );
        self.invalidate(&format!("knowledge:{}", knowledge_id))
            .await;
        Ok(())
    }

    /// 更新知识贡献者 Merkle root
    pub async fn update_knowledge_contributors(
        &self,
        knowledge_id: &str,
        contributors_root: &str,
        contributors_count: i32,
        version: i32,
        updated_by_pubkey: &str,
        timestamp: i64,
    ) -> Result<()> {
        let snapshot: Option<(Option<String>, Option<String>)> = sqlx::query_as(
            r#"
            SELECT
                crystal_params::text,
                (SELECT name FROM circles WHERE id = knowledge.circle_id)
            FROM knowledge
            WHERE knowledge_id = $1
            "#,
        )
        .bind(knowledge_id)
        .fetch_optional(&self.pool)
        .await
        .context("Failed to load knowledge crystal params snapshot")?;

        let (existing_crystal_params, circle_name) = snapshot.unwrap_or((None, None));
        let parsed_crystal_params = existing_crystal_params
            .as_deref()
            .and_then(|raw| serde_json::from_str::<serde_json::Value>(raw).ok());
        let crystal_params_json = serde_json::to_string(&merge_crystal_params_json(
            parsed_crystal_params.as_ref(),
            knowledge_id,
            circle_name.as_deref(),
            contributors_count,
        ))
        .context("Failed to encode merged crystal params JSON")?;

        sqlx::query(
            r#"
            UPDATE knowledge SET
                contributors_root = $2,
                contributors_count = $3,
                version = $4,
                crystal_params = $5::jsonb,
                updated_at = NOW()
            WHERE knowledge_id = $1
            "#,
        )
        .bind(knowledge_id)
        .bind(contributors_root)
        .bind(contributors_count)
        .bind(version)
        .bind(crystal_params_json)
        .execute(&self.pool)
        .await
        .context("Failed to update knowledge contributors")?;

        self.record_knowledge_version_event(
            knowledge_id,
            "contributors_updated",
            version,
            Some(updated_by_pubkey),
            Some(contributors_count),
            Some(contributors_root),
            timestamp,
        )
        .await?;

        info!(
            "💎 Knowledge contributors updated: id={} count={} v{}",
            knowledge_id, contributors_count, version
        );
        self.invalidate(&format!("knowledge:{}", knowledge_id))
            .await;
        Ok(())
    }

    async fn record_knowledge_version_event(
        &self,
        knowledge_id: &str,
        event_type: &str,
        version: i32,
        actor_pubkey: Option<&str>,
        contributors_count: Option<i32>,
        contributors_root: Option<&str>,
        source_event_timestamp: i64,
    ) -> Result<()> {
        sqlx::query(
            r#"
            INSERT INTO knowledge_version_events (
                knowledge_id,
                event_type,
                version,
                actor_pubkey,
                contributors_count,
                contributors_root,
                source_event_timestamp,
                event_at
            )
            VALUES ($1, $2, $3, $4, $5, $6, $7, to_timestamp($7::double precision))
            ON CONFLICT (knowledge_id, event_type, version, source_event_timestamp) DO NOTHING
            "#,
        )
        .bind(knowledge_id)
        .bind(event_type)
        .bind(version)
        .bind(actor_pubkey)
        .bind(contributors_count)
        .bind(contributors_root)
        .bind(source_event_timestamp)
        .execute(&self.pool)
        .await
        .context("Failed to write knowledge version event")?;

        Ok(())
    }

    // ==================== 批量操作 ====================

    /// 批量写入(使用事务)
    pub async fn batch_write<F, Fut>(&self, operations: Vec<F>) -> Result<()>
    where
        F: FnOnce(&mut Transaction<Postgres>) -> Fut,
        Fut: std::future::Future<Output = Result<()>>,
    {
        let mut tx = self.pool.begin().await?;

        for op in operations {
            op(&mut tx).await?;
        }

        tx.commit().await?;
        Ok(())
    }
}

pub(crate) fn profile_row_values(profile: &ProjectedUserProfile) -> UserProfileRowValues {
    UserProfileRowValues {
        display_name: normalize_profile_row_value(profile.display_name.as_deref()),
        bio: normalize_profile_row_value(profile.bio.as_deref()),
        avatar_uri: normalize_profile_row_value(profile.avatar_uri.as_deref()),
        banner_uri: normalize_profile_row_value(profile.banner_uri.as_deref()),
        website: normalize_profile_row_value(profile.website.as_deref()),
        location: normalize_profile_row_value(profile.location.as_deref()),
        metadata_uri: normalize_profile_row_value(profile.metadata_uri.as_deref()),
    }
}

fn normalize_profile_row_value(value: Option<&str>) -> Option<String> {
    let trimmed = value.unwrap_or_default().trim();
    if trimmed.is_empty() {
        None
    } else {
        Some(trimmed.to_string())
    }
}

fn derive_crystal_seed_hex(knowledge_id: &str) -> String {
    if knowledge_id.len() >= 16 {
        format!("0x{}", &knowledge_id[..16])
    } else {
        format!("0x{}", knowledge_id)
    }
}

fn derive_crystal_hue(circle_name: Option<&str>) -> i32 {
    let name = circle_name.unwrap_or("unknown");
    let mut hash: u32 = 0x811c9dc5;
    for byte in name.bytes() {
        hash ^= byte as u32;
        hash = hash.wrapping_mul(0x01000193);
    }
    HUE_ANCHORS[(hash as usize) % HUE_ANCHORS.len()]
}

fn normalize_crystal_facets(contributors_count: i32) -> i32 {
    if contributors_count > 0 {
        contributors_count
    } else {
        DEFAULT_CRYSTAL_FACETS
    }
}

fn build_crystal_params_json(
    knowledge_id: &str,
    circle_name: Option<&str>,
    contributors_count: i32,
) -> serde_json::Value {
    serde_json::json!({
        "seed": derive_crystal_seed_hex(knowledge_id),
        "hue": derive_crystal_hue(circle_name),
        "facets": normalize_crystal_facets(contributors_count),
    })
}

fn merge_crystal_params_json(
    existing: Option<&serde_json::Value>,
    knowledge_id: &str,
    circle_name: Option<&str>,
    contributors_count: i32,
) -> serde_json::Value {
    let fallback = build_crystal_params_json(knowledge_id, circle_name, contributors_count);
    let seed_fallback = fallback
        .get("seed")
        .and_then(|value| value.as_str())
        .unwrap_or("0x0")
        .to_string();
    let hue_fallback = fallback
        .get("hue")
        .and_then(|value| value.as_i64())
        .unwrap_or(42);

    let Some(serde_json::Value::Object(map)) = existing else {
        return fallback;
    };

    let seed = map
        .get("seed")
        .and_then(|value| value.as_str())
        .filter(|value| !value.trim().is_empty())
        .unwrap_or(seed_fallback.as_str());
    let hue = map
        .get("hue")
        .and_then(|value| value.as_i64())
        .unwrap_or(hue_fallback);

    serde_json::json!({
        "seed": seed,
        "hue": hue,
        "facets": normalize_crystal_facets(contributors_count),
    })
}

fn build_like_on_chain_address(user_id: i32, post_id: i32) -> String {
    format!("like:{}:{}", user_id, post_id)
}

fn build_follow_on_chain_address(follower_id: i32, followed_id: i32) -> String {
    format!("follow:{}:{}", follower_id, followed_id)
}

fn derive_fallback_handle(pubkey: &str) -> String {
    let lowered = pubkey.to_ascii_lowercase();
    let mut normalized = lowered
        .chars()
        .filter(|c| c.is_ascii_lowercase() || c.is_ascii_digit())
        .collect::<String>();

    if normalized.len() < 3 {
        normalized.push_str("usr");
    }

    let core = if normalized.len() > 28 {
        let head = &normalized[..14];
        let tail = &normalized[normalized.len() - 14..];
        format!("{}{}", head, tail)
    } else {
        normalized
    };

    let mut handle = format!("u_{}", core);
    if handle.len() > 32 {
        handle.truncate(32);
    }

    handle
}

fn map_circle_membership_action_to_status(action: &str) -> &'static str {
    match action {
        "Left" | "Removed" => "Left",
        _ => "Active",
    }
}

fn resolve_circle_member_on_chain_address(
    on_chain_address: Option<&str>,
    circle_id: i32,
    user_id: i32,
) -> String {
    on_chain_address
        .map(str::trim)
        .filter(|value| !value.is_empty())
        .map(ToOwned::to_owned)
        .unwrap_or_else(|| format!("cm:{circle_id}:{user_id}"))
}

fn citation_heat_delta(rows_affected: u64) -> i32 {
    if rows_affected > 0 {
        10
    } else {
        0
    }
}

fn build_knowledge_reference_candidates(raw_id: &str) -> Vec<String> {
    let trimmed = raw_id.trim();
    if trimmed.is_empty() {
        return Vec::new();
    }

    let mut candidates = Vec::new();
    push_unique_candidate(&mut candidates, trimmed.to_string());

    if trimmed.len() == 64 && trimmed.chars().all(|char| char.is_ascii_hexdigit()) {
        push_unique_candidate(&mut candidates, trimmed.to_ascii_lowercase());
    }

    candidates
}

fn push_unique_candidate(candidates: &mut Vec<String>, value: String) {
    if !candidates.iter().any(|existing| existing == &value) {
        candidates.push(value);
    }
}

fn select_canonical_knowledge_id(
    candidates: &[String],
    rows: &[KnowledgeReferenceLookupRow],
) -> Option<String> {
    for candidate in candidates {
        if let Some(row) = rows
            .iter()
            .find(|row| row.knowledge_id == *candidate || row.on_chain_address == *candidate)
        {
            return Some(row.knowledge_id.clone());
        }
    }

    None
}

fn build_content_post_lookup_candidates(
    on_chain_address: &str,
    legacy_content_id: Option<&str>,
) -> Vec<String> {
    let mut candidates = Vec::new();
    let normalized_on_chain_address = on_chain_address.trim();
    if !normalized_on_chain_address.is_empty() {
        push_unique_candidate(&mut candidates, normalized_on_chain_address.to_string());
    }

    let normalized_legacy_content_id = legacy_content_id.unwrap_or_default().trim();
    if !normalized_legacy_content_id.is_empty() {
        push_unique_candidate(&mut candidates, normalized_legacy_content_id.to_string());
    }

    candidates
}

fn is_legacy_numeric_content_post_repair_candidate(
    content_id: &str,
    on_chain_address: &str,
) -> bool {
    let normalized_content_id = content_id.trim();
    let normalized_on_chain_address = on_chain_address.trim();

    !normalized_content_id.is_empty()
        && normalized_content_id == normalized_on_chain_address
        && normalized_content_id
            .chars()
            .all(|character| character.is_ascii_digit())
}

fn derive_legacy_numeric_content_post_on_chain_address(
    author_pubkey: &str,
    legacy_content_id: &str,
    content_program_id: &Pubkey,
) -> Result<String> {
    let author = Pubkey::from_str(author_pubkey.trim()).with_context(|| {
        format!(
            "invalid author pubkey while repairing legacy content post: {}",
            author_pubkey
        )
    })?;
    let numeric_content_id = legacy_content_id.trim().parse::<u64>().with_context(|| {
        format!(
            "invalid numeric content id while repairing legacy content post: {}",
            legacy_content_id
        )
    })?;
    let (content_post_pda, _) = Pubkey::find_program_address(
        &[b"content_post", author.as_ref(), &numeric_content_id.to_le_bytes()],
        content_program_id,
    );

    Ok(content_post_pda.to_string())
}

#[cfg(test)]
mod tests {
    use super::*;
    use serde_json::json;
    use solana_sdk::pubkey::Pubkey;

    #[test]
    fn test_db_writer_creation() {
        // 需要实际的数据库连接才能测试
        // 这里只是占位测试
    }

    #[test]
    fn crystal_params_builds_initial_payload() {
        let params =
            build_crystal_params_json("0123456789abcdef0123456789abcdef", Some("Alpha Circle"), 0);

        assert_eq!(params["seed"], json!("0x0123456789abcdef"));
        assert_eq!(params["hue"], json!(200));
        assert_eq!(params["facets"], json!(6));
    }

    #[test]
    fn crystal_params_merge_updates_facets_and_preserves_seed_and_hue() {
        let existing = json!({
            "seed": "0xfeedfacecafebeef",
            "hue": 280,
            "facets": 6
        });

        let params = merge_crystal_params_json(
            Some(&existing),
            "0123456789abcdef0123456789abcdef",
            Some("Beta Circle"),
            9,
        );

        assert_eq!(params["seed"], json!("0xfeedfacecafebeef"));
        assert_eq!(params["hue"], json!(280));
        assert_eq!(params["facets"], json!(9));
    }

    #[test]
    fn crystal_params_merge_recovers_from_malformed_payload() {
        let malformed = json!("not-an-object");

        let params = merge_crystal_params_json(
            Some(&malformed),
            "89abcdef0123456789abcdef01234567",
            Some("Jade Circle"),
            0,
        );

        assert_eq!(params["seed"], json!("0x89abcdef01234567"));
        assert_eq!(params["hue"], json!(200));
        assert_eq!(params["facets"], json!(6));
    }

    #[test]
    fn citation_heat_delta_is_idempotent_for_replayed_references() {
        assert_eq!(citation_heat_delta(1), 10);
        assert_eq!(citation_heat_delta(3), 10);
        assert_eq!(citation_heat_delta(0), 0);
    }

    #[test]
    fn follow_on_chain_address_is_stable_and_short() {
        let key = build_follow_on_chain_address(7, 42);
        assert_eq!(key, "follow:7:42");
        assert!(key.len() < 44);
    }

    #[test]
    fn follow_on_chain_address_changes_per_direction() {
        let a = build_follow_on_chain_address(7, 42);
        let b = build_follow_on_chain_address(42, 7);
        let c = build_follow_on_chain_address(7, 43);

        assert_ne!(a, b);
        assert_ne!(a, c);
    }

    #[test]
    fn knowledge_reference_candidates_keep_on_chain_address_as_primary_candidate() {
        let on_chain_address = Pubkey::new_from_array([1u8; 32]).to_string();

        let candidates = build_knowledge_reference_candidates(&on_chain_address);

        assert_eq!(candidates[0], on_chain_address);
        assert_eq!(candidates.len(), 1);
    }

    #[test]
    fn content_post_lookup_candidates_include_legacy_numeric_content_id() {
        let candidates = build_content_post_lookup_candidates(
            "Post1111111111111111111111111111111111111",
            Some("7449278668049604377"),
        );

        assert_eq!(
            candidates,
            vec![
                "Post1111111111111111111111111111111111111".to_string(),
                "7449278668049604377".to_string(),
            ]
        );
    }

    #[test]
    fn legacy_numeric_content_post_repair_candidate_requires_matching_numeric_pair() {
        assert!(is_legacy_numeric_content_post_repair_candidate(
            "7449278668049604377",
            "7449278668049604377",
        ));
        assert!(!is_legacy_numeric_content_post_repair_candidate(
            "7449278668049604377",
            "Post1111111111111111111111111111111111111",
        ));
        assert!(!is_legacy_numeric_content_post_repair_candidate(
            "Post1111111111111111111111111111111111111",
            "7449278668049604377",
        ));
        assert!(!is_legacy_numeric_content_post_repair_candidate(
            "7449278668049604377",
            "7449277771852908733",
        ));
    }

    #[test]
    fn derive_legacy_numeric_content_post_on_chain_address_matches_program_pda() {
        let author = Pubkey::new_from_array([7u8; 32]);
        let content_program_id = Pubkey::new_from_array([9u8; 32]);
        let legacy_content_id = "7449278668049604377";

        let derived = derive_legacy_numeric_content_post_on_chain_address(
            &author.to_string(),
            legacy_content_id,
            &content_program_id,
        )
        .expect("expected legacy numeric content id to derive a content PDA");

        let expected = Pubkey::find_program_address(
            &[
                b"content_post",
                author.as_ref(),
                &legacy_content_id.parse::<u64>().unwrap().to_le_bytes(),
            ],
            &content_program_id,
        )
        .0
        .to_string();

        assert_eq!(derived, expected);
    }

    #[test]
    fn knowledge_reference_candidates_normalize_uppercase_hex() {
        let raw_hex = "AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA";
        let expected_lower_hex = raw_hex.to_ascii_lowercase();

        let candidates = build_knowledge_reference_candidates(raw_hex);

        assert_eq!(candidates[0], raw_hex);
        assert!(candidates
            .iter()
            .any(|candidate| candidate == &expected_lower_hex));
    }

    #[test]
    fn select_canonical_knowledge_id_prefers_matching_candidate_order() {
        let canonical_knowledge_id =
            "bbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb".to_string();
        let on_chain_address = Pubkey::new_from_array([2u8; 32]).to_string();
        let rows = vec![KnowledgeReferenceLookupRow {
            knowledge_id: canonical_knowledge_id.clone(),
            on_chain_address: on_chain_address.clone(),
        }];

        let from_on_chain = build_knowledge_reference_candidates(&on_chain_address);
        let resolved_on_chain = select_canonical_knowledge_id(&from_on_chain, &rows);
        assert_eq!(
            resolved_on_chain.as_deref(),
            Some(canonical_knowledge_id.as_str())
        );

        let from_hex = build_knowledge_reference_candidates(&canonical_knowledge_id);
        let resolved_hex = select_canonical_knowledge_id(&from_hex, &rows);
        assert_eq!(
            resolved_hex.as_deref(),
            Some(canonical_knowledge_id.as_str())
        );
    }

    #[test]
    fn derive_fallback_handle_respects_users_handle_length_limit() {
        let pubkey = "Eyf5Njt1jrkbp8hRSwiMLDd5w7wC7UfckdmJcgzWJTfE";
        let handle = derive_fallback_handle(pubkey);

        assert!(handle.starts_with("u_"));
        assert!(handle.len() <= 32);
    }

    #[test]
    fn knowledge_binding_projection_write_path_exists() {
        let source = include_str!("db_writer.rs");

        assert!(
            source.contains("pub async fn upsert_knowledge_binding("),
            "expected DbWriter to expose a knowledge-binding projection upsert API"
        );
        assert!(
            source.contains("INSERT INTO knowledge_binding"),
            "expected knowledge-binding projection to persist into knowledge_binding table"
        );
        assert!(
            source.contains("\"contributor_proof_bound\""),
            "expected knowledge-binding projection to append contributor_proof_bound history"
        );
    }

    #[test]
    fn follow_projection_write_path_persists_projection_key_and_sync_slot() {
        let source = include_str!("db_writer.rs");

        assert!(
            source.contains("INSERT INTO follows ("),
            "expected follow projection writes to target follows table"
        );
        assert!(
            source.contains("on_chain_address,"),
            "expected follow projection writes to persist a stable projection key"
        );
        assert!(
            source.contains("last_synced_slot,"),
            "expected follow projection writes to keep the non-null sync slot field populated"
        );
        assert!(
            source.contains("build_follow_on_chain_address(follower_id, followed_id)"),
            "expected follow projection writes to derive a stable follow relation key"
        );
    }

    #[test]
    fn follow_projection_write_path_only_updates_counters_on_relation_changes() {
        let source = include_str!("db_writer.rs");

        assert!(
            source.contains("if inserted.rows_affected() > 0"),
            "expected follow counters to update only when a new relation row is inserted"
        );
        assert!(
            source.contains("if deleted.rows_affected() > 0"),
            "expected unfollow counters to update only when a relation row is actually removed"
        );
    }

    #[test]
    fn db_writer_upsert_circle_sql_keeps_genesis_mode_off_chain_managed() {
        let source = include_str!("db_writer.rs");
        let upsert_circle_section = source
            .split("pub async fn upsert_circle")
            .nth(1)
            .and_then(|tail| tail.split("pub async fn upsert_circle_member").next())
            .expect("expected to isolate upsert_circle implementation");

        assert!(
            upsert_circle_section.contains(
                "INSERT INTO circles (id, name, creator_id, level, parent_circle_id, kind, mode, min_crystals,"
            ),
            "expected upsert_circle write path to target circles projection"
        );
        assert!(
            !upsert_circle_section.contains("genesis_mode = EXCLUDED.genesis_mode"),
            "genesis_mode should remain an off-chain managed field and must not be overwritten by indexer upserts"
        );
    }
}
