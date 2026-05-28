use anchor_lang::prelude::*;
use alcheme_shared::*;

/// 分页配置
#[derive(AnchorSerialize, AnchorDeserialize, Clone, Debug)]
pub struct PaginationConfig {
    pub page: u32,
    pub limit: u32,
    pub sort_by: Option<String>,
    pub sort_order: SortOrder,
}

/// 排序顺序
#[derive(AnchorSerialize, AnchorDeserialize, Clone, Debug, PartialEq)]
pub enum SortOrder {
    Ascending,
    Descending,
}

/// 事件统计
#[derive(AnchorSerialize, AnchorDeserialize, Clone, Debug)]
pub struct EventStats {
    pub total_events: u64,
    pub events_by_type: Vec<EventTypeCount>,
    pub events_by_priority: Vec<EventPriorityCount>,
    pub average_events_per_day: f64,
    pub peak_events_per_hour: u64,
    pub current_batch_count: u32,
    pub archived_batch_count: u32,
    pub storage_usage: StorageUsage,
}

/// 按类型的事件计数
#[derive(AnchorSerialize, AnchorDeserialize, Clone, Debug)]
pub struct EventTypeCount {
    pub event_type: EventType,
    pub count: u64,
    pub percentage: f64,
}

/// 按优先级的事件计数
#[derive(AnchorSerialize, AnchorDeserialize, Clone, Debug)]
pub struct EventPriorityCount {
    pub priority: EventPriority,
    pub count: u64,
    pub percentage: f64,
}

/// 存储使用情况
#[derive(AnchorSerialize, AnchorDeserialize, Clone, Debug)]
pub struct StorageUsage {
    pub chain_storage_used: u64,
    pub chain_storage_limit: u64,
    pub archive_storage_used: u64,
    pub compression_ratio: f64,
}

/// 归档统计
#[derive(AnchorSerialize, AnchorDeserialize, Clone, Debug)]
pub struct ArchiveStats {
    pub total_archived_batches: u64,
    pub total_archived_events: u64,
    pub archive_storage_used: u64,
    pub successful_archives: u64,
    pub failed_archives: u64,
    pub average_archive_time: f64,
    pub last_archive_time: i64,
}

/// 事件查询结果
#[derive(AnchorSerialize, AnchorDeserialize, Clone, Debug)]
pub struct EventQueryResult {
    pub events: Vec<ProtocolEvent>,
    pub total_count: u64,
    pub page: u32,
    pub has_more: bool,
    pub query_time_ms: u64,
}

/// 订阅管理统计
#[derive(AnchorSerialize, AnchorDeserialize, Clone, Debug)]
pub struct SubscriptionStats {
    pub total_subscriptions: u64,
    pub active_subscriptions: u64,
    pub inactive_subscriptions: u64,
    pub total_deliveries: u64,
    pub successful_deliveries: u64,
    pub failed_deliveries: u64,
    pub average_delivery_time: f64,
}

// ==================== 辅助数据结构 ====================

/// 事件处理上下文
#[derive(AnchorSerialize, AnchorDeserialize, Clone, Debug)]
pub struct EventProcessingContext {
    pub batch_id: u64,
    pub event_sequence: u64,
    pub processing_start_time: i64,
    pub caller_program: Pubkey,
    pub priority: EventPriority,
}

/// 批次处理结果
#[derive(AnchorSerialize, AnchorDeserialize, Clone, Debug)]
pub struct BatchProcessingResult {
    pub batch_id: u64,
    pub processed_events: u32,
    pub failed_events: u32,
    pub processing_time_ms: u64,
    pub batch_status: BatchStatus,
    pub error_details: Option<String>,
}

/// 事件投递结果
#[derive(AnchorSerialize, AnchorDeserialize, Clone, Debug)]
pub struct EventDeliveryResult {
    pub subscription_id: Pubkey,
    pub delivered_events: u32,
    pub failed_deliveries: u32,
    pub delivery_time_ms: u64,
    pub next_delivery_time: Option<i64>,
}

// ==================== 工具函数 ====================

/// 事件工具函数
pub struct EventEmitterUtils;

impl EventEmitterUtils {
    /// 计算事件优先级
    pub fn calculate_event_priority(event: &ProtocolEvent) -> EventPriority {
        match event {
            ProtocolEvent::ProgramUpgraded { .. } => EventPriority::Critical,
            ProtocolEvent::PermissionDenied { .. } => EventPriority::High,
            ProtocolEvent::IdentityRegistered { .. } => EventPriority::Normal,
            ProtocolEvent::ContentCreated { .. } => EventPriority::Normal,
            ProtocolEvent::ContentInteraction { .. } => EventPriority::Low,
            _ => EventPriority::Normal,
        }
    }

    /// 生成事件ID
    pub fn generate_event_id(
        event_sequence: u64,
        batch_id: u64,
        event_index: u32,
    ) -> String {
        format!("evt_{}_{}_{}_{}", 
                Clock::get().unwrap().unix_timestamp,
                event_sequence,
                batch_id,
                event_index)
    }

    /// 验证事件完整性
    pub fn validate_event(event: &ProtocolEvent) -> Result<()> {
        // 验证时间戳
        let event_time = Self::get_event_timestamp(event);
        ValidationUtils::validate_timestamp(event_time)?;
        
        // 验证事件特定字段
        match event {
            ProtocolEvent::IdentityRegistered { handle, .. } => {
                ValidationUtils::validate_handle(handle)?;
            },
            _ => {}, // 其他事件的特定验证
        }
        
        Ok(())
    }

    /// 获取事件时间戳
    pub fn get_event_timestamp(event: &ProtocolEvent) -> i64 {
        match event {
            ProtocolEvent::IdentityRegistered { timestamp, .. } |
            ProtocolEvent::HandleRegistered { timestamp, .. } |
            ProtocolEvent::HandleTransferred { timestamp, .. } |
            ProtocolEvent::ProfileUpdated { timestamp, .. } |
            ProtocolEvent::VerificationAttributeAdded { timestamp, .. } |
            ProtocolEvent::ReputationUpdated { timestamp, .. } |
            ProtocolEvent::ContentCreated { timestamp, .. } |
            ProtocolEvent::ContentAnchoredV2 { timestamp, .. } |
            ProtocolEvent::ContentAnchorUpdatedV2 { timestamp, .. } |
            ProtocolEvent::ContentStatusChangedV2 { timestamp, .. } |
            ProtocolEvent::DraftLifecycleMilestoneV2 { timestamp, .. } |
            ProtocolEvent::ContentUpdated { timestamp, .. } |
            ProtocolEvent::ContentInteraction { timestamp, .. } |
            ProtocolEvent::ContentModerated { timestamp, .. } |
            ProtocolEvent::ContentStatusChanged { timestamp, .. } |
            ProtocolEvent::ConversationCreated { timestamp, .. } |
            ProtocolEvent::MessageSent { timestamp, .. } |
            ProtocolEvent::MessageRead { timestamp, .. } |
            ProtocolEvent::MessageRecalled { timestamp, .. } |
            ProtocolEvent::PresenceUpdated { timestamp, .. } |
            ProtocolEvent::AccessRuleCreated { timestamp, .. } |
            ProtocolEvent::AccessRuleUpdated { timestamp, .. } |
            ProtocolEvent::PermissionGranted { timestamp, .. } |
            ProtocolEvent::PermissionDenied { timestamp, .. } |
            ProtocolEvent::RelationshipChanged { timestamp, .. } |
            ProtocolEvent::ProgramUpgraded { timestamp, .. } |
            ProtocolEvent::RegistryDeployed { timestamp, .. } |
            ProtocolEvent::RegistryUpgraded { timestamp, .. } |
            ProtocolEvent::ExternalAppRegisteredV2 { timestamp, .. } |
            ProtocolEvent::ExternalAppExecutionReceiptAnchoredV2 { timestamp, .. } |
            ProtocolEvent::ExternalAppManifestUpdatedV2 { timestamp, .. } |
            ProtocolEvent::ExternalAppServerKeyRotatedV2 { timestamp, .. } |
            ProtocolEvent::ExternalAppRegistryStatusChangedV2 { timestamp, .. } |
            ProtocolEvent::ExternalAppRegistryAuthorityChangedV2 { timestamp, .. } |
            ProtocolEvent::EmergencyAction { timestamp, .. } |
            ProtocolEvent::CircleCreated { timestamp, .. } |
            ProtocolEvent::CircleMembershipChanged { timestamp, .. } |
            ProtocolEvent::CircleFlagsUpdated { timestamp, .. } |
            ProtocolEvent::CircleArchived { timestamp, .. } |
            ProtocolEvent::CircleRestored { timestamp, .. } |
            ProtocolEvent::KnowledgeSubmitted { timestamp, .. } |
            ProtocolEvent::ContributorsUpdated { timestamp, .. } |
            ProtocolEvent::ProofAttestorRegistered { timestamp, .. } |
            ProtocolEvent::MembershipAttestorRegistered { timestamp, .. } |
            ProtocolEvent::MembershipAttestorRevoked { timestamp, .. } |
            ProtocolEvent::TokensEarned { timestamp, .. } |
            ProtocolEvent::TokensSpent { timestamp, .. } |
            ProtocolEvent::FollowAction { timestamp, .. } |
            ProtocolEvent::SocialStatsUpdated { timestamp, .. } => *timestamp,
            ProtocolEvent::ContributorProofBound { bound_at, .. } => *bound_at,
        }
    }

    /// 获取事件类型
    pub fn get_event_type(event: &ProtocolEvent) -> EventType {
        match event {
            ProtocolEvent::IdentityRegistered { .. } |
            ProtocolEvent::HandleRegistered { .. } |
            ProtocolEvent::HandleTransferred { .. } => EventType::Identity,
            
            ProtocolEvent::ProfileUpdated { .. } |
            ProtocolEvent::VerificationAttributeAdded { .. } |
            ProtocolEvent::ReputationUpdated { .. } => EventType::Profile,
            
            ProtocolEvent::ContentCreated { .. } |
            ProtocolEvent::ContentAnchoredV2 { .. } |
            ProtocolEvent::ContentAnchorUpdatedV2 { .. } |
            ProtocolEvent::ContentUpdated { .. } |
            ProtocolEvent::ContentStatusChanged { .. } |
            ProtocolEvent::ContentStatusChangedV2 { .. } |
            ProtocolEvent::DraftLifecycleMilestoneV2 { .. } => EventType::Content,
            
            ProtocolEvent::ContentInteraction { .. } => EventType::Interaction,
            
            ProtocolEvent::ConversationCreated { .. } |
            ProtocolEvent::MessageSent { .. } |
            ProtocolEvent::MessageRead { .. } |
            ProtocolEvent::MessageRecalled { .. } |
            ProtocolEvent::PresenceUpdated { .. } => EventType::Messaging,
            
            ProtocolEvent::ContentModerated { .. } => EventType::Moderation,
            
            ProtocolEvent::AccessRuleCreated { .. } |
            ProtocolEvent::AccessRuleUpdated { .. } => EventType::Access,
            
            ProtocolEvent::PermissionGranted { .. } |
            ProtocolEvent::PermissionDenied { .. } |
            ProtocolEvent::RelationshipChanged { .. } => EventType::Permission,
            
            ProtocolEvent::ProgramUpgraded { .. } |
            ProtocolEvent::EmergencyAction { .. } => EventType::System,
            
            ProtocolEvent::RegistryDeployed { .. } |
            ProtocolEvent::RegistryUpgraded { .. } |
            ProtocolEvent::ExternalAppRegisteredV2 { .. } |
            ProtocolEvent::ExternalAppExecutionReceiptAnchoredV2 { .. } |
            ProtocolEvent::ExternalAppManifestUpdatedV2 { .. } |
            ProtocolEvent::ExternalAppServerKeyRotatedV2 { .. } |
            ProtocolEvent::ExternalAppRegistryStatusChangedV2 { .. } |
            ProtocolEvent::ExternalAppRegistryAuthorityChangedV2 { .. } => EventType::Registry,

            ProtocolEvent::CircleCreated { .. } |
            ProtocolEvent::CircleMembershipChanged { .. } |
            ProtocolEvent::CircleFlagsUpdated { .. } |
            ProtocolEvent::CircleArchived { .. } |
            ProtocolEvent::CircleRestored { .. } => EventType::Circle,

            ProtocolEvent::KnowledgeSubmitted { .. } |
            ProtocolEvent::ContributorsUpdated { .. } |
            ProtocolEvent::ContributorProofBound { .. } |
            ProtocolEvent::ProofAttestorRegistered { .. } |
            ProtocolEvent::MembershipAttestorRegistered { .. } |
            ProtocolEvent::MembershipAttestorRevoked { .. } => EventType::Knowledge,
            
            ProtocolEvent::TokensEarned { .. } |
            ProtocolEvent::TokensSpent { .. } |
            ProtocolEvent::FollowAction { .. } |
            ProtocolEvent::SocialStatsUpdated { .. } => EventType::Custom("economic_social".to_string()),
        }
    }

    /// 获取事件相关用户
    pub fn get_event_user(event: &ProtocolEvent) -> Option<Pubkey> {
        match event {
            ProtocolEvent::IdentityRegistered { identity_id, .. } => Some(*identity_id),
            ProtocolEvent::HandleRegistered { identity_id, .. } => Some(*identity_id),
            ProtocolEvent::ProfileUpdated { identity_id, .. } => Some(*identity_id),
            ProtocolEvent::ContentCreated { author, .. } => Some(*author),
            ProtocolEvent::ContentInteraction { actor, .. } => Some(*actor),
            ProtocolEvent::ReputationUpdated { identity_id, .. } => Some(*identity_id),
            ProtocolEvent::VerificationAttributeAdded { identity_id, .. } => Some(*identity_id),
            ProtocolEvent::TokensEarned { identity_id, .. } => Some(*identity_id),
            ProtocolEvent::TokensSpent { identity_id, .. } => Some(*identity_id),
            ProtocolEvent::SocialStatsUpdated { identity_id, .. } => Some(*identity_id),
            ProtocolEvent::CircleMembershipChanged { actor, .. } => Some(*actor),
            ProtocolEvent::CircleArchived { actor, .. } => Some(*actor),
            ProtocolEvent::CircleRestored { actor, .. } => Some(*actor),
            ProtocolEvent::ContributorProofBound { bound_by, .. } => Some(*bound_by),
            ProtocolEvent::ProofAttestorRegistered { registered_by, .. } => Some(*registered_by),
            ProtocolEvent::MembershipAttestorRegistered { registered_by, .. } => Some(*registered_by),
            ProtocolEvent::MembershipAttestorRevoked { revoked_by, .. } => Some(*revoked_by),
            ProtocolEvent::ExternalAppRegisteredV2 { owner, .. } => Some(*owner),
            ProtocolEvent::ExternalAppRegistryAuthorityChangedV2 { admin, .. } => Some(*admin),
            _ => None,
        }
    }

    /// 压缩事件数据
    pub fn compress_event_data(events: &[ProtocolEvent]) -> Result<Vec<u8>> {
        // 简化实现：直接序列化
        events.try_to_vec()
            .map_err(|_| AlchemeError::SerializationError.into())
    }

    /// 解压事件数据
    pub fn decompress_event_data(compressed_data: &[u8]) -> Result<Vec<ProtocolEvent>> {
        // 简化实现：直接反序列化
        Vec::<ProtocolEvent>::try_from_slice(compressed_data)
            .map_err(|_| AlchemeError::DeserializationError.into())
    }

    /// 验证事件大小
    pub fn validate_event_size(event: &ProtocolEvent, max_size: u32) -> Result<()> {
        let serialized_size = event.try_to_vec()
            .map_err(|_| AlchemeError::SerializationError)?
            .len();
        
        require!(
            serialized_size <= max_size as usize,
            AlchemeError::EventDataTooLarge
        );
        
        Ok(())
    }

    /// 计算下一个批次ID
    pub fn calculate_next_batch_id(event_sequence: u64, batch_size: u32) -> u64 {
        event_sequence / batch_size as u64 + 1
    }

    /// 检查批次是否可以接收事件
    pub fn can_batch_accept_events(
        current_events_count: u32,
        batch_status: BatchStatus,
        max_events: usize,
    ) -> bool {
        batch_status == BatchStatus::Active && 
        current_events_count < max_events as u32
    }

    /// 检查是否需要归档
    pub fn needs_archiving(
        batch_created_at: i64,
        auto_archive_days: u32,
        archive_enabled: bool,
    ) -> bool {
        if !archive_enabled {
            return false;
        }
        
        let current_time = Clock::get().unwrap().unix_timestamp;
        let batch_age_days = (current_time - batch_created_at) / (24 * 3600);
        
        batch_age_days >= auto_archive_days as i64
    }
}

// ==================== Wrapper Accounts ====================
use std::ops::{Deref, DerefMut};

#[account]
pub struct EventEmitterAccount {
    pub inner: alcheme_shared::events::EventEmitter,
}

impl Deref for EventEmitterAccount {
    type Target = alcheme_shared::events::EventEmitter;
    fn deref(&self) -> &Self::Target {
        &self.inner
    }
}

impl DerefMut for EventEmitterAccount {
    fn deref_mut(&mut self) -> &mut Self::Target {
        &mut self.inner
    }
}

impl EventEmitterAccount {
    pub const SPACE: usize = alcheme_shared::events::EventEmitter::SPACE;
}

#[account]
pub struct EventBatchAccount {
    pub inner: alcheme_shared::events::EventBatch,
}

impl Deref for EventBatchAccount {
    type Target = alcheme_shared::events::EventBatch;
    fn deref(&self) -> &Self::Target {
        &self.inner
    }
}

impl DerefMut for EventBatchAccount {
    fn deref_mut(&mut self) -> &mut Self::Target {
        &mut self.inner
    }
}

impl EventBatchAccount {
    pub fn calculate_size(max_events: usize) -> usize {
        alcheme_shared::events::EventBatch::calculate_size(max_events)
    }
    
    /// 计算当前账户实际所需空间
    pub fn get_size(&self) -> usize {
        match self.inner.try_to_vec() {
            Ok(data) => 8 + data.len(), // 8 bytes discriminator
            Err(_) => {
                // 降级方案：保守估算
                8 + 8 + 8 + (4 + self.inner.events.len() * 600) + 1 + 48 + 1 + 4 + 1
            }
        }
    }

    fn serialized_event_size(event: &ProtocolEvent) -> Result<usize> {
        let serialized = event
            .try_to_vec()
            .map_err(|_| AlchemeError::SerializationError)?;
        Ok(serialized.len())
    }

    /// 计算添加新事件后所需空间（基于真实序列化大小）
    pub fn get_size_with_new_event(&self, event: &ProtocolEvent) -> Result<usize> {
        let event_size = Self::serialized_event_size(event)?;
        Ok(self.get_size().saturating_add(event_size))
    }

    /// 计算添加多个新事件后所需空间（基于真实序列化大小）
    pub fn get_size_with_new_events(&self, events: &[ProtocolEvent]) -> Result<usize> {
        let mut additional_size = 0usize;
        for event in events {
            let event_size = Self::serialized_event_size(event)?;
            additional_size = additional_size
                .checked_add(event_size)
                .ok_or(AlchemeError::EventDataTooLarge)?;
        }
        Ok(self.get_size().saturating_add(additional_size))
    }
    
    /// 动态扩展账户空间（如果需要）  
    /// 注意：此方法应在 Account<EventBatchAccount> 上调用
    pub fn realloc_if_needed<'info>(
        account: &mut Account<'info, EventBatchAccount>,
        required_space: usize,
        payer: &Signer<'info>,
        system_program: &Program<'info, System>,
    ) -> Result<()> {
        let account_info = account.to_account_info();
        let current_space = account_info.data_len();
        
        if required_space > current_space {
            let increase = required_space - current_space;
            
            // 检查单次扩展不超过10KB
            require!(
                increase <= 10240,
                AlchemeError::EventDataTooLarge
            );
            
            // Realloc账户 (使用resize而非deprecated的realloc)
            account_info.realloc(required_space, false)?;
            
            // 转账租金差额
            let rent = Rent::get()?;
            let new_minimum_balance = rent.minimum_balance(required_space);
            let current_balance = account_info.lamports();
            
            if new_minimum_balance > current_balance {
                let lamports_diff = new_minimum_balance - current_balance;
                anchor_lang::system_program::transfer(
                    CpiContext::new(
                        system_program.to_account_info(),
                        anchor_lang::system_program::Transfer {
                            from: payer.to_account_info(),
                            to: account_info.clone(),
                        },
                    ),
                    lamports_diff,
                )?;
            }
        }
        
        Ok(())
    }
}

#[account]
pub struct EventSubscriptionAccount {
    pub inner: alcheme_shared::events::EventSubscription,
}

impl Deref for EventSubscriptionAccount {
    type Target = alcheme_shared::events::EventSubscription;
    fn deref(&self) -> &Self::Target {
        &self.inner
    }
}

impl DerefMut for EventSubscriptionAccount {
    fn deref_mut(&mut self) -> &mut Self::Target {
        &mut self.inner
    }
}

impl EventSubscriptionAccount {
    pub const SPACE: usize = alcheme_shared::events::EventSubscription::SPACE;
}

#[cfg(test)]
mod tests {
    use super::*;

    fn draft_lifecycle_event(timestamp: i64) -> ProtocolEvent {
        ProtocolEvent::DraftLifecycleMilestoneV2 {
            draft_post_id: 42,
            action: DraftLifecycleMilestoneAction::EnteredCrystallization,
            actor: Pubkey::new_unique(),
            policy_profile_digest: [7u8; 32],
            timestamp,
        }
    }

    fn empty_batch_account() -> EventBatchAccount {
        EventBatchAccount {
            inner: alcheme_shared::events::EventBatch {
                batch_id: 1,
                created_at: 0,
                events: Vec::new(),
                archived: false,
                arweave_tx_id: None,
                bump: 1,
                events_count: 0,
                batch_status: BatchStatus::Active,
            },
        }
    }

    fn oversized_content_event() -> ProtocolEvent {
        ProtocolEvent::ContentModerated {
            content_id: Pubkey::new_unique(),
            moderator: Pubkey::new_unique(),
            action: ModerationAction::ContentRemoval,
            reason: "x".repeat(2200),
            timestamp: 1,
        }
    }

    fn external_app_registered_event(owner: Pubkey, timestamp: i64) -> ProtocolEvent {
        ProtocolEvent::ExternalAppRegisteredV2 {
            app_id_hash: [1u8; 32],
            owner,
            manifest_hash: [2u8; 32],
            server_key_hash: [3u8; 32],
            owner_assertion_hash: [4u8; 32],
            policy_state_digest: [5u8; 32],
            review_circle_id: 7,
            review_policy_digest: [6u8; 32],
            decision_digest: [8u8; 32],
            execution_intent_digest: [9u8; 32],
            timestamp,
        }
    }

    #[test]
    fn get_size_with_new_event_uses_actual_serialized_size() {
        let batch = empty_batch_account();
        let event = oversized_content_event();

        let required_space = batch
            .get_size_with_new_event(&event)
            .expect("size estimate should serialize event");

        let mut simulated = batch.inner.clone();
        simulated
            .add_event(event)
            .expect("simulated event append should succeed");
        let actual_space = 8 + simulated
            .try_to_vec()
            .expect("simulated batch should serialize")
            .len();

        assert!(
            required_space >= actual_space,
            "required_space={} actual_space={}",
            required_space,
            actual_space
        );
    }

    #[test]
    fn get_size_with_new_events_uses_actual_serialized_sizes() {
        let batch = empty_batch_account();
        let events = vec![
            oversized_content_event(),
            ProtocolEvent::IdentityRegistered {
                identity_id: Pubkey::new_unique(),
                handle: "handle_1".to_string(),
                verification_level: VerificationLevel::Basic,
                timestamp: 2,
                registry_id: Pubkey::new_unique(),
            },
        ];

        let required_space = batch
            .get_size_with_new_events(&events)
            .expect("size estimate should serialize events");

        let mut simulated = batch.inner.clone();
        for event in events {
            simulated
                .add_event(event)
                .expect("simulated event append should succeed");
        }
        let actual_space = 8 + simulated
            .try_to_vec()
            .expect("simulated batch should serialize")
            .len();

        assert!(
            required_space >= actual_space,
            "required_space={} actual_space={}",
            required_space,
            actual_space
        );
    }

    #[test]
    fn draft_lifecycle_events_use_timestamp_and_content_type() {
        let event = draft_lifecycle_event(123);

        assert_eq!(EventEmitterUtils::get_event_timestamp(&event), 123);
        assert_eq!(EventEmitterUtils::get_event_type(&event), EventType::Content);
    }

    #[test]
    fn external_app_events_use_registry_timestamp_type_and_owner() {
        let owner = Pubkey::new_unique();
        let event = external_app_registered_event(owner, 456);

        assert_eq!(EventEmitterUtils::get_event_timestamp(&event), 456);
        assert_eq!(EventEmitterUtils::get_event_type(&event), EventType::Registry);
        assert_eq!(EventEmitterUtils::get_event_user(&event), Some(owner));
    }
}
