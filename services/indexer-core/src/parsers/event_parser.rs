use alcheme_shared::{
    content::{ContentAnchorRelation, ContentPost, VisibilityLevel},
    events::ProtocolEvent,
    AccessLevel, ContentStatus, UserIdentity, V2AudienceKind,
};
use anyhow::anyhow;
use base64::Engine as _;
use borsh::{BorshDeserialize, BorshSerialize};
use hyper::body::to_bytes;
use hyper::client::HttpConnector;
use hyper::{Body, Client as HyperClient, Method, Request, Uri};
use serde::Deserialize;
use serde_json::{json, Value};
use solana_sdk::pubkey::Pubkey;
use sqlx::PgPool;
use tokio::time::Duration;
use tracing::{debug, error, info, warn};
use yellowstone_grpc_proto::prelude::SubscribeUpdateTransactionInfo;

use crate::database::db_writer::{DbWriter, ProjectedUserProfile};
use crate::parsers::extensions::{
    ContributionEngineEvent, ExtensionParserRegistry, ParsedExtensionEvent,
};

pub(crate) struct ProjectedCircleMembership {
    pub circle_id: i32,
    pub member_pubkey: String,
    pub role: &'static str,
    pub status: &'static str,
    pub on_chain_address: Option<String>,
    pub changed_at: i64,
}

/// 事件解析器 - 负责解析和路由 ProtocolEvent
pub struct EventParser {
    db_pool: PgPool,
    db_writer: DbWriter,
    extension_parser_registry: ExtensionParserRegistry,
    event_emitter_program_id: String,
    circle_manager_program_id: Option<Pubkey>,
    rpc_client: RpcAccountClient,
}

impl EventParser {
    pub fn new(
        db_pool: PgPool,
        redis: Option<redis::aio::MultiplexedConnection>,
        event_emitter_program_id: String,
        circle_manager_program_id: Option<String>,
        solana_rpc_url: String,
    ) -> Self {
        let extension_parser_registry = ExtensionParserRegistry::default();
        info!(
            "Extension parser plugins loaded: {:?}",
            extension_parser_registry.parser_names()
        );

        let parsed_circle_manager_program_id = circle_manager_program_id.and_then(|raw| {
            let candidate = raw.trim();
            if candidate.is_empty() {
                return None;
            }
            match candidate.parse::<Pubkey>() {
                Ok(pubkey) => Some(pubkey),
                Err(error) => {
                    warn!(
                        "Invalid CIRCLE_MANAGER_PROGRAM_ID/CIRCLES_PROGRAM_ID ({}): {}",
                        candidate, error
                    );
                    None
                }
            }
        });

        Self {
            db_writer: DbWriter::new(db_pool.clone(), redis),
            db_pool,
            extension_parser_registry,
            event_emitter_program_id,
            circle_manager_program_id: parsed_circle_manager_program_id,
            rpc_client: RpcAccountClient::new(solana_rpc_url, 4_000),
        }
    }

    /// 解析交易中的日志,提取事件
    pub async fn parse_transaction(
        &self,
        tx_info: &SubscribeUpdateTransactionInfo,
    ) -> anyhow::Result<Vec<ProtocolEvent>> {
        let logs: &[String] = tx_info
            .meta
            .as_ref()
            .map(|meta| meta.log_messages.as_slice())
            .unwrap_or(&[]);

        self.parse_logs(logs).await
    }

    /// 解析日志数组,提取事件
    pub async fn parse_logs(&self, logs: &[String]) -> anyhow::Result<Vec<ProtocolEvent>> {
        let mut events = Vec::new();
        let mut in_event_emitter_context = false;

        // 遍历交易中的所有账户和日志
        for log_message in logs {
            if is_program_invoke(log_message, &self.event_emitter_program_id) {
                in_event_emitter_context = true;
            }

            if let Some(event) = self.extract_event_from_log(log_message, in_event_emitter_context)
            {
                events.push(event);
            }

            if is_program_exit(log_message, &self.event_emitter_program_id) {
                in_event_emitter_context = false;
            }
        }

        // 解析并路由扩展程序事件（Rule 8: 独立于 core event handler）
        let extension_events = self.extension_parser_registry.parse_logs(logs);
        for ext_event in extension_events {
            self.route_extension_event(ext_event).await?;
        }

        Ok(events)
    }

    /// 从日志消息中提取事件
    fn extract_event_from_log(
        &self,
        log: &str,
        in_event_emitter_context: bool,
    ) -> Option<ProtocolEvent> {
        // Anchor 事件格式: "Program data: <base64_encoded_event>"
        if !in_event_emitter_context || !log.starts_with("Program data: ") {
            return None;
        }

        let encoded_data = log.strip_prefix("Program data: ")?;
        let decoded = base64::decode(encoded_data).ok()?;

        if let Some(event) = Self::deserialize_protocol_event(&decoded) {
            return Some(event);
        }

        warn!(
            "Failed to deserialize event (len={}, prefix={}...)",
            decoded.len(),
            hex::encode(&decoded[..decoded.len().min(16)])
        );
        None
    }

    fn deserialize_protocol_event(decoded: &[u8]) -> Option<ProtocolEvent> {
        // strict path: requires all bytes consumed
        if let Ok(event) = ProtocolEvent::try_from_slice(decoded) {
            return Some(event);
        }

        // fallback path: allow trailing bytes from future-compatible log envelopes
        let mut remaining = decoded;
        if let Ok(event) = ProtocolEvent::deserialize(&mut remaining) {
            if !remaining.is_empty() {
                warn!(
                    "Decoded ProtocolEvent with trailing bytes ({} bytes)",
                    remaining.len()
                );
            }
            return Some(event);
        }

        // Anchor `emit!` includes an 8-byte discriminator before payload.
        if decoded.len() > 8 {
            let mut remaining = &decoded[8..];
            if let Ok(event) = ProtocolEvent::deserialize(&mut remaining) {
                warn!(
                    "Decoded ProtocolEvent after skipping 8-byte prefix (trailing={} bytes)",
                    remaining.len()
                );
                return Some(event);
            }
        }

        None
    }

    async fn resolve_identity_snapshot(
        &self,
        identity_account_pubkey: &Pubkey,
        min_context_slot: Option<u64>,
    ) -> anyhow::Result<Option<ResolvedIdentitySnapshot>> {
        let Some(account_data) = self
            .rpc_client
            .get_account_data(identity_account_pubkey, min_context_slot)
            .await?
        else {
            return Ok(None);
        };

        Ok(Some(decode_user_identity_account_snapshot(
            identity_account_pubkey,
            &account_data,
        )?))
    }

    async fn resolve_identity_wallet(
        &self,
        identity_account_pubkey: &Pubkey,
        min_context_slot: Option<u64>,
    ) -> anyhow::Result<Option<ResolvedIdentityWallet>> {
        Ok(self
            .resolve_identity_snapshot(identity_account_pubkey, min_context_slot)
            .await?
            .map(|snapshot| ResolvedIdentityWallet {
                wallet_pubkey: snapshot.wallet_pubkey,
                handle: snapshot.handle,
            }))
    }

    /// 路由事件到对应的处理器
    pub async fn route_event(
        &self,
        event: ProtocolEvent,
        min_context_slot: Option<u64>,
    ) -> anyhow::Result<()> {
        match event {
            // ========== 身份相关事件 ==========
            ProtocolEvent::IdentityRegistered {
                identity_id,
                handle,
                verification_level,
                timestamp,
                registry_id,
            } => {
                info!("🆔 Identity registered: {} ({})", handle, identity_id);
                let resolved = self
                    .resolve_identity_snapshot(&identity_id, min_context_slot)
                    .await?;
                let projection = project_identity_registration(&identity_id, handle, resolved);
                if let Some(profile) = projection.profile.as_ref() {
                    self.db_writer
                        .upsert_user_from_identity_snapshot(
                            &projection.wallet_pubkey,
                            &projection.handle,
                            profile,
                            timestamp,
                        )
                        .await?;
                } else {
                    self.db_writer
                        .upsert_user(&projection.wallet_pubkey, &projection.handle, timestamp)
                        .await?;
                }
            }

            ProtocolEvent::HandleRegistered {
                handle,
                identity_id,
                timestamp,
                ..
            } => {
                info!("🏷️  Handle registered: {} -> {}", handle, identity_id);
                let resolved = self
                    .resolve_identity_wallet(&identity_id, min_context_slot)
                    .await?;
                let user_pubkey = resolved
                    .as_ref()
                    .map(|identity| identity.wallet_pubkey.clone())
                    .unwrap_or_else(|| identity_id.to_string());
                self.db_writer
                    .update_user_handle(&user_pubkey, &handle, timestamp)
                    .await?;
            }

            ProtocolEvent::HandleTransferred {
                handle,
                from_owner,
                to_owner,
                timestamp,
                ..
            } => {
                info!(
                    "↔️  Handle transferred: {} from {} to {}",
                    handle, from_owner, to_owner
                );
                self.db_writer
                    .transfer_handle(
                        &handle,
                        &from_owner.to_string(),
                        &to_owner.to_string(),
                        timestamp,
                    )
                    .await?;
            }

            ProtocolEvent::ProfileUpdated {
                identity_id,
                updated_fields,
                timestamp,
                ..
            } => {
                info!(
                    "👤 Profile updated: {} (fields: {:?})",
                    identity_id, updated_fields
                );
                let snapshot = self
                    .resolve_identity_snapshot(&identity_id, min_context_slot)
                    .await?
                    .ok_or_else(|| anyhow!("missing user identity account for {}", identity_id))?;
                self.db_writer
                    .update_user_profile(
                        &snapshot.wallet_pubkey,
                        &snapshot.handle,
                        &snapshot.profile,
                        timestamp,
                    )
                    .await?;
            }

            ProtocolEvent::ReputationUpdated {
                identity_id,
                new_reputation,
                timestamp,
                ..
            } => {
                info!(
                    "⭐ Reputation updated: {} -> {}",
                    identity_id, new_reputation
                );
                let resolved = self
                    .resolve_identity_wallet(&identity_id, min_context_slot)
                    .await?;
                let user_pubkey = resolved
                    .as_ref()
                    .map(|identity| identity.wallet_pubkey.clone())
                    .unwrap_or_else(|| identity_id.to_string());
                self.db_writer
                    .update_user_reputation(&user_pubkey, new_reputation as i32, timestamp)
                    .await?;
            }

            // ========== 内容相关事件 ==========
            ProtocolEvent::ContentCreated {
                content_id,
                author,
                content_type,
                visibility: _,
                timestamp,
                ..
            } => {
                info!("📝 Content created: {} by {}", content_id, author);
                self.db_writer
                    .create_post(
                        &content_id.to_string(),
                        &author.to_string(),
                        &format!("{:?}", content_type),
                        timestamp,
                    )
                    .await?;
            }

            ProtocolEvent::ContentAnchoredV2 {
                content_id,
                author,
                uri_ref,
                relation,
                visibility,
                audience_kind,
                audience_ref,
                status,
                timestamp,
                ..
            } => {
                let projection =
                    project_content_anchor_v2_event(
                        content_id,
                        &relation,
                        &visibility,
                        &audience_kind,
                        audience_ref,
                        &status,
                    );
                let text_preview = normalize_content_preview(uri_ref.as_str());
                info!(
                    "🧷 Content anchored v2: {} by {}",
                    projection.content_id, author
                );
                self.db_writer
                    .create_post(
                        &projection.content_id,
                        &author.to_string(),
                        projection.content_type,
                        timestamp,
                    )
                    .await?;
                self.db_writer
                    .reconcile_content_post_snapshot(
                        &projection.content_id,
                        None,
                        projection.reply_to.as_deref(),
                        projection.thread_root.as_deref(),
                        projection.repost_of.as_deref(),
                        projection.reply_depth,
                        projection.visibility,
                        projection.status,
                        text_preview.as_deref(),
                        Some(uri_ref.as_str()),
                        None,
                        Some(projection.v2_visibility_level),
                        Some(projection.v2_status),
                        Some(projection.is_v2_private),
                        Some(projection.is_v2_draft),
                        Some(projection.v2_audience_kind),
                        projection.v2_audience_ref,
                    )
                    .await?;
            }

            ProtocolEvent::ContentAnchorUpdatedV2 {
                content_id,
                uri_ref,
                timestamp,
                ..
            } => {
                let text_preview = normalize_content_preview(uri_ref.as_str());
                info!("🧷 v2 content anchor updated: {}", content_id);
                self.db_writer
                    .update_v2_content_anchor(
                        &content_id.to_string(),
                        uri_ref.as_str(),
                        text_preview.as_deref(),
                        timestamp,
                    )
                    .await?;
            }

            ProtocolEvent::ContentUpdated {
                content_id,
                updated_fields,
                timestamp,
                ..
            } => {
                info!(
                    "✏️  Content updated: {} (fields: {:?})",
                    content_id, updated_fields
                );
                self.db_writer
                    .update_post(&content_id.to_string(), updated_fields, timestamp)
                    .await?;
            }

            ProtocolEvent::ContentInteraction {
                content_id,
                actor,
                interaction_type,
                timestamp,
                ..
            } => {
                info!(
                    "👍 Interaction: {:?} on {} by {}",
                    interaction_type, content_id, actor
                );
                self.db_writer
                    .record_interaction(
                        &content_id.to_string(),
                        &actor.to_string(),
                        &format!("{:?}", interaction_type),
                        timestamp,
                    )
                    .await?;
            }

            ProtocolEvent::ContentModerated {
                content_id,
                moderator,
                action,
                reason,
                timestamp,
            } => {
                info!(
                    "🚨 Content moderated: {} by {} (action: {:?})",
                    content_id, moderator, action
                );
                self.db_writer
                    .moderate_content(
                        &content_id.to_string(),
                        &moderator.to_string(),
                        &format!("{:?}", action),
                        &reason,
                        timestamp,
                    )
                    .await?;
            }

            ProtocolEvent::ContentStatusChanged {
                content_id,
                new_status,
                timestamp,
                ..
            } => {
                info!(
                    "🔄 Content status changed: {} -> {:?}",
                    content_id, new_status
                );
                self.db_writer
                    .update_content_status(
                        &content_id.to_string(),
                        &format!("{:?}", new_status),
                        timestamp,
                    )
                    .await?;
            }

            ProtocolEvent::ContentStatusChangedV2 {
                content_id,
                new_status,
                timestamp,
                ..
            } => {
                info!(
                    "🔄 v2 content status changed: {} -> {:?}",
                    content_id, new_status
                );
                self.db_writer
                    .update_content_status(
                        &content_id.to_string(),
                        &format!("{:?}", new_status),
                        timestamp,
                    )
                    .await?;
            }

            // ========== 圈层相关事件 ==========
            ProtocolEvent::CircleCreated {
                circle_id,
                name,
                level,
                parent_circle,
                flags,
                creator,
                timestamp,
            } => {
                info!("🔵 Circle created: {} (id={})", name, circle_id);
                let on_chain_address = self.derive_circle_on_chain_address(circle_id);
                self.db_writer
                    .upsert_circle(
                        circle_id as i32,
                        &name,
                        level as i32,
                        parent_circle.map(|id| id as i32),
                        flags as i64,
                        &creator.to_string(),
                        on_chain_address.as_deref().unwrap_or_default(),
                        timestamp,
                    )
                    .await?;
            }

            ProtocolEvent::CircleFlagsUpdated {
                circle_id,
                new_flags,
                timestamp,
                ..
            } => {
                info!("🔵 Circle flags updated: id={}", circle_id);
                self.db_writer
                    .update_circle_flags(circle_id as i32, new_flags as i64, timestamp)
                    .await?;
            }

            ProtocolEvent::CircleMembershipChanged {
                circle_id,
                member,
                role,
                status,
                action,
                timestamp,
                ..
            } => {
                let projection = project_circle_membership_event(
                    self.circle_manager_program_id,
                    circle_id,
                    &member,
                    &role,
                    &status,
                    &action,
                    timestamp,
                );
                self.db_writer
                    .upsert_circle_member(
                        projection.circle_id,
                        &projection.member_pubkey,
                        projection.role,
                        projection.status,
                        projection.on_chain_address.as_deref(),
                        projection.changed_at,
                    )
                    .await?;
            }

            // ========== 知识相关事件 ==========
            ProtocolEvent::KnowledgeSubmitted {
                knowledge_id,
                circle_id,
                author,
                content_hash,
                title,
                flags,
                timestamp,
            } => {
                let kid = hex::encode(knowledge_id);
                let chash = hex::encode(content_hash);
                info!("💎 Knowledge submitted: {} (circle={})", title, circle_id);
                self.db_writer
                    .upsert_knowledge(
                        &kid,
                        circle_id as i32,
                        &author.to_string(),
                        &title,
                        flags as i64,
                        &chash,
                        None,
                        None,
                        timestamp,
                    )
                    .await?;
            }

            ProtocolEvent::ContributorProofBound {
                knowledge_id,
                source_anchor_id,
                proof_package_hash,
                contributors_root,
                contributors_count,
                binding_version,
                generated_at,
                bound_by,
                bound_at,
            } => {
                let kid = hex::encode(knowledge_id);
                let source_anchor_hex = hex::encode(source_anchor_id);
                let proof_package_hash_hex = hex::encode(proof_package_hash);
                let contributors_root_hex = hex::encode(contributors_root);
                info!(
                    "🔗 Contributor proof bound: {} (v{}, count={})",
                    kid, binding_version, contributors_count
                );
                self.db_writer
                    .upsert_knowledge_binding(
                        &kid,
                        &source_anchor_hex,
                        &proof_package_hash_hex,
                        &contributors_root_hex,
                        contributors_count as i32,
                        binding_version as i32,
                        generated_at,
                        &bound_by.to_string(),
                        bound_at,
                    )
                    .await?;
            }

            ProtocolEvent::ContributorsUpdated {
                knowledge_id,
                contributors_root,
                contributors_count,
                version,
                updated_by,
                timestamp,
            } => {
                let kid = hex::encode(knowledge_id);
                let root_hex = hex::encode(contributors_root);
                info!(
                    "💎 Contributors updated: {} (count={}, v{})",
                    kid, contributors_count, version
                );
                self.db_writer
                    .update_knowledge_contributors(
                        &kid,
                        &root_hex,
                        contributors_count as i32,
                        version as i32,
                        &updated_by.to_string(),
                        timestamp,
                    )
                    .await?;
            }

            // ========== 消息相关事件 ==========
            ProtocolEvent::ConversationCreated {
                conversation_id,
                conversation_type,
                creator,
                participants,
                timestamp,
            } => {
                info!(
                    "💬 Conversation created: {} by {} ({} participants)",
                    conversation_id,
                    creator,
                    participants.len()
                );
                self.db_writer
                    .create_conversation(
                        &conversation_id.to_string(),
                        &creator.to_string(),
                        &format!("{:?}", conversation_type),
                        participants.iter().map(|p| p.to_string()).collect(),
                        timestamp,
                    )
                    .await?;
            }

            ProtocolEvent::MessageSent {
                message_id,
                conversation_id,
                sender,
                message_type,
                reply_to,
                timestamp,
            } => {
                info!(
                    "✉️  Message sent: {} in {} by {}",
                    message_id, conversation_id, sender
                );
                self.db_writer
                    .create_message(
                        &message_id.to_string(),
                        &conversation_id.to_string(),
                        &sender.to_string(),
                        &format!("{:?}", message_type),
                        reply_to.as_ref().map(|p| p.to_string()),
                        timestamp,
                    )
                    .await?;
            }

            ProtocolEvent::MessageRead {
                message_id,
                reader,
                timestamp,
            } => {
                info!("👁️  Message read: {} by {}", message_id, reader);
                self.db_writer
                    .mark_message_read(&message_id.to_string(), &reader.to_string(), timestamp)
                    .await?;
            }

            ProtocolEvent::MessageRecalled {
                message_id,
                sender,
                timestamp,
            } => {
                info!("↩️  Message recalled: {} by {}", message_id, sender);
                self.db_writer
                    .recall_message(&message_id.to_string(), &sender.to_string(), timestamp)
                    .await?;
            }

            // ========== 关注/社交事件 ==========
            ProtocolEvent::FollowAction {
                follower,
                followed,
                action,
                timestamp,
            } => {
                info!(
                    "👥 Follow action: {:?} {} -> {}",
                    action, follower, followed
                );
                self.db_writer
                    .record_follow_action(
                        &follower.to_string(),
                        &followed.to_string(),
                        &format!("{:?}", action),
                        timestamp,
                    )
                    .await?;
            }

            ProtocolEvent::SocialStatsUpdated {
                identity_id,
                stat_type,
                new_value,
                timestamp,
                ..
            } => {
                info!(
                    "📊 Stats updated: {} {:?} -> {}",
                    identity_id, stat_type, new_value
                );
                let resolved = self
                    .resolve_identity_wallet(&identity_id, min_context_slot)
                    .await?;
                let user_pubkey = resolved
                    .as_ref()
                    .map(|identity| identity.wallet_pubkey.clone())
                    .unwrap_or_else(|| identity_id.to_string());
                self.db_writer
                    .update_social_stats(
                        &user_pubkey,
                        &format!("{:?}", stat_type),
                        new_value as i64,
                        timestamp,
                    )
                    .await?;
            }

            // ========== 权限相关事件 ==========
            ProtocolEvent::AccessRuleCreated {
                user,
                rule_id,
                permission,
                access_level,
                timestamp,
            } => {
                info!("🔒 Access rule created: {} for {}", rule_id, user);
                self.db_writer
                    .create_access_rule(
                        &user.to_string(),
                        &rule_id,
                        &format!("{:?}", permission),
                        &format!("{:?}", access_level),
                        timestamp,
                    )
                    .await?;
            }

            ProtocolEvent::PermissionGranted {
                granter,
                grantee,
                permission,
                timestamp,
                ..
            } => {
                info!(
                    "✅ Permission granted: {:?} from {} to {}",
                    permission, granter, grantee
                );
                self.db_writer
                    .grant_permission(
                        &granter.to_string(),
                        &grantee.to_string(),
                        &format!("{:?}", permission),
                        timestamp,
                    )
                    .await?;
            }

            ProtocolEvent::RelationshipChanged {
                user1,
                user2,
                new_relationship,
                timestamp,
                ..
            } => {
                info!(
                    "🤝 Relationship changed: {} <-> {} ({})",
                    user1,
                    user2,
                    format!("{:?}", new_relationship)
                );
                self.db_writer
                    .update_relationship(
                        &user1.to_string(),
                        &user2.to_string(),
                        &format!("{:?}", new_relationship),
                        timestamp,
                    )
                    .await?;
            }

            // ========== 系统事件 ==========
            ProtocolEvent::ProgramUpgraded {
                program_id,
                old_version,
                new_version,
                timestamp,
                ..
            } => {
                info!(
                    "⬆️  Program upgraded: {} ({} -> {})",
                    program_id, old_version, new_version
                );
                // 系统事件通常只记录日志,不更新数据库
            }

            ProtocolEvent::RegistryDeployed {
                registry_id,
                registry_type,
                deployer,
                timestamp,
                ..
            } => {
                info!(
                    "🎯 Registry deployed: {} ({:?}) by {}",
                    registry_id, registry_type, deployer
                );
                // 可以选择记录注册表部署事件
            }

            ProtocolEvent::EmergencyAction {
                action_type,
                triggered_by,
                timestamp,
                ..
            } => {
                error!(
                    "🚨 Emergency action: {:?} by {} at {}",
                    action_type, triggered_by, timestamp
                );
                // 紧急事件应该记录并可能触发告警
            }

            // ========== 经济事件 ==========
            ProtocolEvent::TokensEarned {
                identity_id,
                amount,
                source,
                timestamp,
                ..
            } => {
                info!(
                    "💰 Tokens earned: {} earned {} from {:?}",
                    identity_id, amount, source
                );
                self.db_writer
                    .record_token_transaction(
                        &identity_id.to_string(),
                        amount as i64,
                        "earned",
                        &format!("{:?}", source),
                        timestamp,
                    )
                    .await?;
            }

            ProtocolEvent::TokensSpent {
                identity_id,
                amount,
                purpose,
                timestamp,
                ..
            } => {
                info!(
                    "💸 Tokens spent: {} spent {} for {:?}",
                    identity_id, amount, purpose
                );
                self.db_writer
                    .record_token_transaction(
                        &identity_id.to_string(),
                        -(amount as i64),
                        "spent",
                        &format!("{:?}", purpose),
                        timestamp,
                    )
                    .await?;
            }

            // ========== 其他未映射的事件 ==========
            _ => {
                warn!("Unhandled event type: {:?}", event);
                // 对于未处理的事件,记录日志但不阻塞处理
            }
        }

        Ok(())
    }

    /// 路由扩展事件到对应的处理器（独立于 core route_event，遵循 Covenant Rule 8）
    async fn route_extension_event(&self, event: ParsedExtensionEvent) -> anyhow::Result<()> {
        match event {
            ParsedExtensionEvent::ContributionEngine(ce) => match ce {
                ContributionEngineEvent::ReferenceAdded {
                    source_id,
                    target_id,
                    reference_type,
                } => {
                    info!(
                        "📎 Extension: ReferenceAdded {} -> {}",
                        source_id, target_id
                    );
                    self.db_writer
                        .handle_reference_added(&source_id, &target_id, &reference_type)
                        .await?;
                }
                other => {
                    debug!("Extension event not yet handled: {:?}", other);
                }
            },
        }
        Ok(())
    }

    /// 批量处理事件
    pub async fn process_events(
        &self,
        events: Vec<ProtocolEvent>,
        min_context_slot: Option<u64>,
    ) -> anyhow::Result<()> {
        let mut processed = 0;
        let mut failed = 0;
        let mut first_error: Option<String> = None;

        for event in events {
            match self.route_event(event, min_context_slot).await {
                Ok(_) => processed += 1,
                Err(e) => {
                    error!("Failed to process event: {:?}", e);
                    failed += 1;
                    if first_error.is_none() {
                        first_error = Some(e.to_string());
                    }
                }
            }
        }

        info!(
            "Batch processing complete: {} processed, {} failed",
            processed, failed
        );

        if failed > 0 {
            return Err(anyhow!(
                "Batch processing failed: {} processed, {} failed (first_error={})",
                processed,
                failed,
                first_error.unwrap_or_else(|| "unknown".to_string())
            ));
        }

        Ok(())
    }

    pub async fn reconcile_knowledge_account_snapshot(
        &self,
        expected_knowledge_id: &str,
        knowledge_account_pubkey: &Pubkey,
    ) -> anyhow::Result<()> {
        let Some(account_data) = self
            .rpc_client
            .get_account_data(knowledge_account_pubkey, None)
            .await?
        else {
            return Ok(());
        };

        let snapshot = decode_knowledge_account_snapshot(knowledge_account_pubkey, &account_data)?;
        if !expected_knowledge_id.trim().is_empty()
            && snapshot.knowledge_id_hex != expected_knowledge_id.trim()
        {
            return Err(anyhow!(
                "knowledge snapshot mismatch for {}: expected {}, got {}",
                knowledge_account_pubkey,
                expected_knowledge_id,
                snapshot.knowledge_id_hex
            ));
        }

        self.db_writer
            .reconcile_knowledge_snapshot(
                &snapshot.knowledge_id_hex,
                &snapshot.on_chain_address,
                Some(snapshot.ipfs_cid.as_str()),
            )
            .await
    }

    pub async fn reconcile_content_post_account_snapshot(
        &self,
        expected_content_id: &str,
        content_account_pubkey: &Pubkey,
    ) -> anyhow::Result<()> {
        let Some(account_data) = self
            .rpc_client
            .get_account_data(content_account_pubkey, None)
            .await?
        else {
            return Ok(());
        };

        let snapshot = decode_content_post_account_snapshot(content_account_pubkey, &account_data)?;
        if should_require_exact_content_snapshot_match(expected_content_id)
            && snapshot.content_id != expected_content_id.trim()
        {
            return Err(anyhow!(
                "content snapshot mismatch for {}: expected {}, got {}",
                content_account_pubkey,
                expected_content_id,
                snapshot.content_id
            ));
        }
        let legacy_content_id = if !expected_content_id.trim().is_empty()
            && snapshot.content_id != expected_content_id.trim()
        {
            Some(expected_content_id.trim())
        } else {
            None
        };

        self.db_writer
            .reconcile_content_post_snapshot(
                &snapshot.content_id,
                legacy_content_id,
                snapshot.reply_to.as_deref(),
                snapshot.thread_root.as_deref(),
                snapshot.repost_of.as_deref(),
                snapshot.reply_depth,
                snapshot.visibility.as_str(),
                snapshot.status.as_str(),
                snapshot.text_preview.as_deref(),
                Some(snapshot.primary_storage_uri.as_str()),
                snapshot.community_on_chain_address.as_deref(),
                None,
                None,
                None,
                None,
                None,
                None,
            )
            .await
    }

    fn derive_circle_on_chain_address(&self, circle_id: u8) -> Option<String> {
        let program_id = self.circle_manager_program_id?;
        let circle_id_seed = [circle_id];
        let seeds: [&[u8]; 2] = [b"circle", &circle_id_seed];
        let (circle_pda, _) = Pubkey::find_program_address(&seeds, &program_id);
        Some(circle_pda.to_string())
    }

    fn derive_circle_member_on_chain_address(&self, circle_id: u8, member: &Pubkey) -> Option<String> {
        derive_circle_member_on_chain_address(self.circle_manager_program_id, circle_id, member)
    }
}

fn parse_program_log_prefix(log: &str) -> Option<(&str, &str)> {
    let rest = log.strip_prefix("Program ")?;
    let mut parts = rest.split_whitespace();
    let program_id = parts.next()?;
    let verb = parts.next()?;
    Some((program_id, verb))
}

fn is_program_invoke(log: &str, program_id: &str) -> bool {
    matches!(
        parse_program_log_prefix(log),
        Some((id, "invoke")) if id == program_id
    )
}

fn is_program_exit(log: &str, program_id: &str) -> bool {
    match parse_program_log_prefix(log) {
        Some((id, "success")) if id == program_id => true,
        Some((id, verb)) if id == program_id && verb.starts_with("failed") => true,
        _ => false,
    }
}

pub(crate) fn content_post_snapshot_target_for_event(event: &ProtocolEvent) -> Option<String> {
    match event {
        ProtocolEvent::ContentCreated { content_id, .. }
        | ProtocolEvent::ContentUpdated { content_id, .. }
        | ProtocolEvent::ContentStatusChanged { content_id, .. } => Some(content_id.to_string()),
        _ => None,
    }
}

fn should_require_exact_content_snapshot_match(expected_content_id: &str) -> bool {
    let trimmed = expected_content_id.trim();
    !trimmed.is_empty() && !trimmed.bytes().all(|byte| byte.is_ascii_digit())
}

pub(crate) fn project_circle_membership_event(
    circle_manager_program_id: Option<Pubkey>,
    circle_id: u8,
    member: &Pubkey,
    role: &alcheme_shared::CircleMemberRole,
    _status: &alcheme_shared::CircleMemberStatus,
    action: &alcheme_shared::CircleMembershipAction,
    changed_at: i64,
) -> ProjectedCircleMembership {
    let status = match action {
        alcheme_shared::CircleMembershipAction::Left
        | alcheme_shared::CircleMembershipAction::Removed => "Left",
        alcheme_shared::CircleMembershipAction::Joined
        | alcheme_shared::CircleMembershipAction::Added
        | alcheme_shared::CircleMembershipAction::RoleChanged => "Active",
    };

    ProjectedCircleMembership {
        circle_id: circle_id as i32,
        member_pubkey: member.to_string(),
        role: match role {
            alcheme_shared::CircleMemberRole::Owner => "Owner",
            alcheme_shared::CircleMemberRole::Admin => "Admin",
            alcheme_shared::CircleMemberRole::Moderator => "Moderator",
            alcheme_shared::CircleMemberRole::Member => "Member",
        },
        status,
        on_chain_address: derive_circle_member_on_chain_address(circle_manager_program_id, circle_id, member),
        changed_at,
    }
}

fn derive_circle_member_on_chain_address(
    circle_manager_program_id: Option<Pubkey>,
    circle_id: u8,
    member: &Pubkey,
) -> Option<String> {
    let program_id = circle_manager_program_id?;
    let circle_id_seed = [circle_id];
    let circle_seeds: [&[u8]; 2] = [b"circle", &circle_id_seed];
    let (circle_pda, _) = Pubkey::find_program_address(&circle_seeds, &program_id);
    let member_seeds: [&[u8]; 3] = [b"circle_member", circle_pda.as_ref(), member.as_ref()];
    let (circle_member_pda, _) = Pubkey::find_program_address(&member_seeds, &program_id);
    Some(circle_member_pda.to_string())
}

struct ResolvedIdentityWallet {
    wallet_pubkey: String,
    handle: String,
}

pub(crate) struct ResolvedIdentitySnapshot {
    pub wallet_pubkey: String,
    pub handle: String,
    pub profile: ProjectedUserProfile,
}

pub(crate) struct IdentityRegistrationProjection {
    pub wallet_pubkey: String,
    pub handle: String,
    pub profile: Option<ProjectedUserProfile>,
}

pub(crate) fn project_identity_registration(
    identity_id: &Pubkey,
    fallback_handle: String,
    resolved: Option<ResolvedIdentitySnapshot>,
) -> IdentityRegistrationProjection {
    if let Some(snapshot) = resolved {
        return IdentityRegistrationProjection {
            wallet_pubkey: snapshot.wallet_pubkey,
            handle: snapshot.handle,
            profile: Some(snapshot.profile),
        };
    }

    IdentityRegistrationProjection {
        wallet_pubkey: identity_id.to_string(),
        handle: fallback_handle,
        profile: None,
    }
}

#[derive(Debug, Clone, PartialEq, Eq)]
struct KnowledgeAccountSnapshot {
    knowledge_id_hex: String,
    on_chain_address: String,
    ipfs_cid: String,
}

#[derive(Debug, Clone, PartialEq, Eq)]
struct ContentPostSnapshot {
    content_id: String,
    reply_to: Option<String>,
    thread_root: Option<String>,
    repost_of: Option<String>,
    reply_depth: i32,
    visibility: String,
    status: String,
    text_preview: Option<String>,
    primary_storage_uri: String,
    community_on_chain_address: Option<String>,
}

pub(crate) fn decode_user_identity_account_snapshot(
    identity_account_pubkey: &Pubkey,
    account_data: &[u8],
) -> anyhow::Result<ResolvedIdentitySnapshot> {
    if account_data.len() <= 8 {
        return Err(anyhow!(
            "user identity account {} payload too small",
            identity_account_pubkey
        ));
    }

    let mut payload = &account_data[8..];
    let identity = UserIdentity::deserialize(&mut payload).map_err(|error| {
        anyhow!(
            "failed to decode user identity account {}: {}",
            identity_account_pubkey,
            error
        )
    })?;
    let handle = identity.primary_handle.clone();
    let profile = projected_user_profile_from_identity(&identity);

    Ok(ResolvedIdentitySnapshot {
        wallet_pubkey: identity.identity_id.to_string(),
        handle,
        profile,
    })
}

fn projected_user_profile_from_identity(identity: &UserIdentity) -> ProjectedUserProfile {
    let profile = identity.protocol_profile();
    ProjectedUserProfile {
        display_name: profile.display_name,
        bio: profile.bio,
        avatar_uri: profile.avatar_uri,
        banner_uri: profile.banner_uri,
        website: profile.website,
        location: profile.location,
        metadata_uri: normalize_projected_profile_value(Some(profile.metadata_uri.as_str())),
    }
}

fn normalize_projected_profile_value(value: Option<&str>) -> Option<String> {
    let trimmed = value.unwrap_or_default().trim();
    if trimmed.is_empty() {
        None
    } else {
        Some(trimmed.to_string())
    }
}

#[derive(Debug, Clone, PartialEq, Eq)]
pub(crate) struct ContentAnchorV2EventProjection {
    pub(crate) content_id: String,
    pub(crate) content_type: &'static str,
    pub(crate) reply_to: Option<String>,
    pub(crate) thread_root: Option<String>,
    pub(crate) repost_of: Option<String>,
    pub(crate) reply_depth: i32,
    pub(crate) visibility: &'static str,
    pub(crate) status: &'static str,
    pub(crate) v2_visibility_level: &'static str,
    pub(crate) v2_audience_kind: &'static str,
    pub(crate) v2_audience_ref: Option<i32>,
    pub(crate) v2_status: &'static str,
    pub(crate) is_v2_private: bool,
    pub(crate) is_v2_draft: bool,
}

pub(crate) fn project_content_anchor_v2_event(
    content_id: u64,
    relation: &ContentAnchorRelation,
    _visibility: &AccessLevel,
    audience_kind: &V2AudienceKind,
    audience_ref: u8,
    status: &ContentStatus,
) -> ContentAnchorV2EventProjection {
    let (content_type, reply_to, thread_root, repost_of, reply_depth) = match relation {
        ContentAnchorRelation::None => ("Text", None, None, None, 0),
        ContentAnchorRelation::Reply { parent_content } => {
            let parent = parent_content.to_string();
            ("Reply", Some(parent.clone()), Some(parent), None, 1)
        }
        ContentAnchorRelation::ReplyById { parent_content_id } => {
            let parent = parent_content_id.to_string();
            ("Reply", Some(parent.clone()), Some(parent), None, 1)
        }
        ContentAnchorRelation::Repost { original_content } => {
            ("Repost", None, None, Some(original_content.to_string()), 0)
        }
        ContentAnchorRelation::RepostById { original_content_id } => {
            ("Repost", None, None, Some(original_content_id.to_string()), 0)
        }
        ContentAnchorRelation::Quote { quoted_content } => {
            ("Quote", None, None, Some(quoted_content.to_string()), 0)
        }
        ContentAnchorRelation::QuoteById { quoted_content_id } => {
            ("Quote", None, None, Some(quoted_content_id.to_string()), 0)
        }
    };
    let visibility_projection = map_v2_audience_kind_to_post_visibility(audience_kind);
    let status_projection = map_content_status_to_post_status(status);
    let v2_visibility_level = map_v2_audience_kind_to_v2_visibility_level(audience_kind);
    let v2_audience_kind = map_v2_audience_kind_to_string(audience_kind);
    let v2_audience_ref = match audience_kind {
        V2AudienceKind::CircleOnly => Some(i32::from(audience_ref)),
        _ => None,
    };
    let v2_status = map_content_status_to_v2_status(status);

    ContentAnchorV2EventProjection {
        content_id: content_id.to_string(),
        content_type,
        reply_to,
        thread_root,
        repost_of,
        reply_depth,
        visibility: visibility_projection,
        status: status_projection,
        v2_visibility_level,
        v2_audience_kind,
        v2_audience_ref,
        v2_status,
        is_v2_private: v2_visibility_level == "Private",
        is_v2_draft: v2_status == "Draft",
    }
}

#[derive(BorshDeserialize, BorshSerialize, Clone, Debug, PartialEq)]
struct KnowledgeAccountData {
    knowledge_id: [u8; 32],
    circle_id: u8,
    ipfs_cid: String,
    content_hash: [u8; 32],
    title: String,
    description: String,
    author: Pubkey,
    quality_score: f64,
    source_circle: Option<u8>,
    created_at: i64,
    view_count: u64,
    citation_count: u64,
    bump: u8,
    flags: u64,
    contributors_root: [u8; 32],
    contributors_count: u16,
}

#[derive(Clone)]
struct RpcAccountClient {
    endpoint: Uri,
    client: HyperClient<HttpConnector, Body>,
    request_timeout: Duration,
}

impl RpcAccountClient {
    fn new(endpoint: String, request_timeout_ms: u64) -> Self {
        let endpoint = endpoint
            .parse::<Uri>()
            .expect("Invalid SOLANA_RPC_URL for EventParser RPC client");
        let connector = HttpConnector::new();
        let client = HyperClient::builder().build::<_, Body>(connector);

        Self {
            endpoint,
            client,
            request_timeout: Duration::from_millis(request_timeout_ms.max(500)),
        }
    }

    async fn get_account_data(
        &self,
        pubkey: &Pubkey,
        min_context_slot: Option<u64>,
    ) -> anyhow::Result<Option<Vec<u8>>> {
        let response = self
            .call_raw(
                "getAccountInfo",
                build_get_account_info_params(pubkey, min_context_slot),
            )
            .await?;

        if let Some(error) = response.error {
            return Err(anyhow!(
                "RPC method getAccountInfo failed for {}: code={}, message={}",
                pubkey,
                error.code,
                error.message
            ));
        }

        let Some(result) = response.result else {
            return Ok(None);
        };

        let account = serde_json::from_value::<RpcAccountInfoResult>(result)
            .map_err(|error| anyhow!("Failed to decode getAccountInfo result: {}", error))?;
        let Some(value) = account.value else {
            return Ok(None);
        };

        let encoded = value
            .data
            .first()
            .ok_or_else(|| anyhow!("Missing base64 account payload for {}", pubkey))?;
        let decoded = base64::engine::general_purpose::STANDARD
            .decode(encoded)
            .map_err(|error| {
                anyhow!("Failed to decode account payload for {}: {}", pubkey, error)
            })?;
        Ok(Some(decoded))
    }

    async fn call_raw(&self, method: &str, params: Value) -> anyhow::Result<RpcResponse<Value>> {
        let payload = json!({
            "jsonrpc": "2.0",
            "id": 1,
            "method": method,
            "params": params
        });

        let request = Request::builder()
            .method(Method::POST)
            .uri(self.endpoint.clone())
            .header("content-type", "application/json")
            .body(Body::from(payload.to_string()))?;

        let response = tokio::time::timeout(self.request_timeout, self.client.request(request))
            .await
            .map_err(|error| anyhow!("RPC request timeout: {} ({})", method, error))?
            .map_err(|error| anyhow!("RPC transport error: {} ({})", method, error))?;

        if !response.status().is_success() {
            return Err(anyhow!(
                "RPC request returned HTTP {} for method {}",
                response.status(),
                method
            ));
        }

        let body_bytes = tokio::time::timeout(self.request_timeout, to_bytes(response.into_body()))
            .await
            .map_err(|error| anyhow!("RPC response body timeout: {} ({})", method, error))?
            .map_err(|error| anyhow!("Failed to read RPC response body: {} ({})", method, error))?;
        let body = serde_json::from_slice::<RpcResponse<Value>>(&body_bytes)
            .map_err(|error| anyhow!("Failed to decode RPC response {}: {}", method, error))?;

        Ok(body)
    }
}

pub(crate) fn build_get_account_info_params(
    pubkey: &Pubkey,
    min_context_slot: Option<u64>,
) -> Value {
    let mut config = json!({
        "encoding": "base64",
        "commitment": "confirmed"
    });
    if let Some(slot) = min_context_slot {
        config["minContextSlot"] = json!(slot);
    }

    json!([pubkey.to_string(), config])
}

fn decode_knowledge_account_snapshot(
    account_pubkey: &Pubkey,
    account_data: &[u8],
) -> anyhow::Result<KnowledgeAccountSnapshot> {
    if account_data.len() <= 8 {
        return Err(anyhow!(
            "knowledge account {} missing anchor discriminator payload",
            account_pubkey
        ));
    }

    let mut payload = &account_data[8..];
    let knowledge = KnowledgeAccountData::deserialize(&mut payload).map_err(|error| {
        anyhow!(
            "failed to decode knowledge account {}: {}",
            account_pubkey,
            error
        )
    })?;

    Ok(KnowledgeAccountSnapshot {
        knowledge_id_hex: hex::encode(knowledge.knowledge_id),
        on_chain_address: account_pubkey.to_string(),
        ipfs_cid: knowledge.ipfs_cid,
    })
}

fn decode_content_post_account_snapshot(
    account_pubkey: &Pubkey,
    account_data: &[u8],
) -> anyhow::Result<ContentPostSnapshot> {
    if account_data.len() <= 8 {
        return Err(anyhow!(
            "content post account {} missing anchor discriminator payload",
            account_pubkey
        ));
    }

    let mut payload = &account_data[8..];
    let content_post = ContentPost::deserialize(&mut payload).map_err(|error| {
        anyhow!(
            "failed to decode content post account {}: {}",
            account_pubkey,
            error
        )
    })?;

    let visibility_projection =
        map_visibility_level_to_post_visibility(&content_post.visibility_settings.visibility_level);

    Ok(ContentPostSnapshot {
        content_id: account_pubkey.to_string(),
        reply_to: content_post.reply_to.map(|value| value.to_string()),
        thread_root: content_post.thread_root.map(|value| value.to_string()),
        repost_of: content_post.repost_of.map(|value| value.to_string()),
        reply_depth: i32::from(content_post.thread_depth),
        visibility: visibility_projection.visibility.to_string(),
        status: map_content_status_to_post_status(&content_post.status).to_string(),
        text_preview: normalize_content_preview(&content_post.content_preview),
        primary_storage_uri: content_post.primary_storage_uri,
        community_on_chain_address: visibility_projection.community_on_chain_address,
    })
}

#[derive(Debug, Clone, PartialEq, Eq)]
struct VisibilityProjection {
    visibility: &'static str,
    community_on_chain_address: Option<String>,
}

fn map_visibility_level_to_post_visibility(level: &VisibilityLevel) -> VisibilityProjection {
    match level {
        VisibilityLevel::Public => VisibilityProjection {
            visibility: "Public",
            community_on_chain_address: None,
        },
        VisibilityLevel::Followers => VisibilityProjection {
            visibility: "FollowersOnly",
            community_on_chain_address: None,
        },
        VisibilityLevel::Friends => VisibilityProjection {
            visibility: "Private",
            community_on_chain_address: None,
        },
        VisibilityLevel::Community(circle_address) => VisibilityProjection {
            visibility: "CircleOnly",
            community_on_chain_address: Some(circle_address.to_string()),
        },
        VisibilityLevel::Custom(_) | VisibilityLevel::Private => VisibilityProjection {
            visibility: "Private",
            community_on_chain_address: None,
        },
    }
}

fn map_access_level_to_post_visibility(level: &AccessLevel) -> &'static str {
    match level {
        AccessLevel::Public => "Public",
        AccessLevel::Followers => "FollowersOnly",
        AccessLevel::Friends | AccessLevel::Private | AccessLevel::Custom => "Private",
    }
}

fn map_access_level_to_v2_visibility_level(level: &AccessLevel) -> &'static str {
    match level {
        AccessLevel::Public => "Public",
        AccessLevel::Followers => "Followers",
        AccessLevel::Friends => "Friends",
        AccessLevel::Private => "Private",
        AccessLevel::Custom => "Custom",
    }
}

fn map_v2_audience_kind_to_post_visibility(kind: &V2AudienceKind) -> &'static str {
    match kind {
        V2AudienceKind::Public => "Public",
        V2AudienceKind::Private => "Private",
        V2AudienceKind::FollowersOnly => "FollowersOnly",
        V2AudienceKind::CircleOnly => "CircleOnly",
    }
}

fn map_v2_audience_kind_to_v2_visibility_level(kind: &V2AudienceKind) -> &'static str {
    match kind {
        V2AudienceKind::Public => "Public",
        V2AudienceKind::Private => "Private",
        V2AudienceKind::FollowersOnly => "FollowersOnly",
        V2AudienceKind::CircleOnly => "CircleOnly",
    }
}

fn map_v2_audience_kind_to_string(kind: &V2AudienceKind) -> &'static str {
    match kind {
        V2AudienceKind::Public => "Public",
        V2AudienceKind::Private => "Private",
        V2AudienceKind::FollowersOnly => "FollowersOnly",
        V2AudienceKind::CircleOnly => "CircleOnly",
    }
}

fn map_content_status_to_post_status(status: &ContentStatus) -> &'static str {
    match status {
        ContentStatus::Draft => "Draft",
        ContentStatus::Published => "Published",
        ContentStatus::Archived => "Archived",
        ContentStatus::Deleted => "Deleted",
        ContentStatus::Moderated => "Moderated",
        ContentStatus::Suspended => "Suspended",
        ContentStatus::Flagged => "Flagged",
        ContentStatus::UnderReview => "UnderReview",
    }
}

fn map_content_status_to_v2_status(status: &ContentStatus) -> &'static str {
    match status {
        ContentStatus::Draft => "Draft",
        ContentStatus::Published => "Published",
        ContentStatus::Archived => "Archived",
        ContentStatus::Deleted => "Deleted",
        ContentStatus::Moderated => "Moderated",
        ContentStatus::Suspended => "Suspended",
        ContentStatus::Flagged => "Flagged",
        ContentStatus::UnderReview => "UnderReview",
    }
}

fn normalize_content_preview(preview: &str) -> Option<String> {
    let trimmed = preview.trim();
    if trimmed.is_empty() {
        None
    } else {
        Some(trimmed.to_string())
    }
}

#[derive(Debug, Deserialize)]
struct RpcResponse<T> {
    result: Option<T>,
    error: Option<RpcError>,
}

#[derive(Debug, Deserialize)]
struct RpcError {
    code: i64,
    message: String,
}

#[derive(Debug, Deserialize)]
struct RpcAccountInfoResult {
    value: Option<RpcAccountInfoValue>,
}

#[derive(Debug, Deserialize)]
struct RpcAccountInfoValue {
    data: Vec<String>,
}

#[cfg(test)]
mod tests {
    use super::*;
    use borsh::BorshSerialize;

    #[test]
    fn test_program_invoke_detection() {
        let program_id = "uhPvVgDANHaUzUq2rYEVXJ9vGEBjWjNZ1E6gQJqdBUC";
        let invoke_log = format!("Program {} invoke [2]", program_id);
        assert!(is_program_invoke(&invoke_log, program_id));
        assert!(!is_program_exit(&invoke_log, program_id));
    }

    #[test]
    fn test_program_exit_detection() {
        let program_id = "uhPvVgDANHaUzUq2rYEVXJ9vGEBjWjNZ1E6gQJqdBUC";
        let success_log = format!("Program {} success", program_id);
        let failed_log = format!("Program {} failed: custom program error: 0x1", program_id);

        assert!(is_program_exit(&success_log, program_id));
        assert!(is_program_exit(&failed_log, program_id));
        assert!(!is_program_invoke(&success_log, program_id));
    }

    #[test]
    fn decodes_knowledge_account_snapshot_from_anchor_account_data() {
        let knowledge_account = Pubkey::new_unique();
        let knowledge_id = [4_u8; 32];
        let snapshot = KnowledgeAccountData {
            knowledge_id,
            circle_id: 5,
            ipfs_cid: "bafybeigdyrzt5x6l5fydemo".to_string(),
            content_hash: [8_u8; 32],
            title: "Crystal".to_string(),
            description: "Desc".to_string(),
            author: Pubkey::new_unique(),
            quality_score: 0.0,
            source_circle: None,
            created_at: 1_706_000_000,
            view_count: 0,
            citation_count: 0,
            bump: 255,
            flags: 1,
            contributors_root: [2_u8; 32],
            contributors_count: 3,
        };

        let mut encoded = vec![0_u8; 8];
        encoded.extend(snapshot.try_to_vec().expect("serialize knowledge account"));

        let decoded =
            decode_knowledge_account_snapshot(&knowledge_account, &encoded).expect("decode");
        assert_eq!(decoded.knowledge_id_hex, hex::encode(knowledge_id));
        assert_eq!(decoded.on_chain_address, knowledge_account.to_string());
        assert_eq!(decoded.ipfs_cid, "bafybeigdyrzt5x6l5fydemo");
    }

    #[test]
    fn decodes_content_post_snapshot_relationships_from_anchor_account_data() {
        let content_account = Pubkey::new_unique();
        let reply_to = Pubkey::new_unique();
        let repost_of = Pubkey::new_unique();
        let thread_root = Pubkey::new_unique();

        let snapshot = ContentPost {
            content_id: 42,
            author_identity: Pubkey::new_unique(),
            created_at: 1_706_000_000,
            last_updated: 1_706_000_100,
            content_version: 1,
            content_type: alcheme_shared::ContentType::Text,
            content_hash: [7_u8; 32],
            primary_storage_uri: "repost://demo/42".to_string(),
            content_preview: "preview".to_string(),
            reply_to: Some(reply_to),
            quote_post: None,
            repost_of: Some(repost_of),
            thread_root: Some(thread_root),
            thread_depth: 2,
            moderation_status: alcheme_shared::content::ModerationStatus::Pending,
            content_warnings: vec![],
            visibility_settings: alcheme_shared::content::VisibilitySettings::default(),
            tags: vec![],
            categories: vec![],
            language: Some("zh-CN".to_string()),
            content_length: 12,
            stats_account: Pubkey::new_unique(),
            storage_account: Pubkey::new_unique(),
            bump: 255,
            status: alcheme_shared::ContentStatus::Published,
        };

        let mut encoded = vec![0_u8; 8];
        encoded.extend(snapshot.try_to_vec().expect("serialize content post"));

        let decoded =
            decode_content_post_account_snapshot(&content_account, &encoded).expect("decode");
        assert_eq!(decoded.content_id, content_account.to_string());
        let reply_to_string = reply_to.to_string();
        let thread_root_string = thread_root.to_string();
        let repost_of_string = repost_of.to_string();

        assert_eq!(decoded.reply_to.as_deref(), Some(reply_to_string.as_str()));
        assert_eq!(
            decoded.thread_root.as_deref(),
            Some(thread_root_string.as_str())
        );
        assert_eq!(
            decoded.repost_of.as_deref(),
            Some(repost_of_string.as_str())
        );
        assert_eq!(decoded.reply_depth, 2);
        assert_eq!(decoded.primary_storage_uri, "repost://demo/42");
        assert_eq!(decoded.visibility, "Public");
        assert_eq!(decoded.status, "Published");
        assert_eq!(decoded.text_preview.as_deref(), Some("preview"));
        assert_eq!(decoded.community_on_chain_address, None);
    }

    #[test]
    fn maps_community_visibility_to_circle_only_with_on_chain_address() {
        let community_address = Pubkey::new_unique();
        let community_address_string = community_address.to_string();
        let projection =
            map_visibility_level_to_post_visibility(&VisibilityLevel::Community(community_address));

        assert_eq!(projection.visibility, "CircleOnly");
        assert_eq!(
            projection.community_on_chain_address.as_deref(),
            Some(community_address_string.as_str())
        );
    }

    #[test]
    fn maps_friends_visibility_to_private_for_safety() {
        let projection = map_visibility_level_to_post_visibility(&VisibilityLevel::Friends);
        assert_eq!(projection.visibility, "Private");
        assert_eq!(projection.community_on_chain_address, None);
    }

    #[test]
    fn maps_content_status_to_post_status_values() {
        assert_eq!(
            map_content_status_to_post_status(&ContentStatus::Draft),
            "Draft"
        );
        assert_eq!(
            map_content_status_to_post_status(&ContentStatus::Published),
            "Published"
        );
        assert_eq!(
            map_content_status_to_post_status(&ContentStatus::UnderReview),
            "UnderReview"
        );
    }

    #[test]
    fn numeric_v2_content_ids_do_not_require_exact_snapshot_pubkey_match() {
        assert!(!should_require_exact_content_snapshot_match("7449278668049604377"));
    }

    #[test]
    fn pubkey_content_ids_still_require_exact_snapshot_match() {
        assert!(should_require_exact_content_snapshot_match(
            "Post1111111111111111111111111111111111111"
        ));
    }
}
