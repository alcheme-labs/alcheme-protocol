use anchor_lang::prelude::*;
use crate::types::*;
use crate::content::ContentAnchorRelation;

/// 事件发射器主账户
#[derive(AnchorSerialize, AnchorDeserialize, Clone, Debug)]
pub struct EventEmitter {
    pub bump: u8,
    pub admin: Pubkey,
    pub total_events: u64,
    pub event_sequence: u64,
    pub storage_config: EventStorageConfig,
    pub retention_policy: EventRetentionPolicy,
    pub subscription_count: u64,
    pub created_at: i64,
    pub last_updated: i64,
}

/// 事件批次账户
#[derive(AnchorSerialize, AnchorDeserialize, Clone, Debug)]
pub struct EventBatch {
    pub batch_id: u64,
    pub created_at: i64,
    pub events: Vec<ProtocolEvent>,
    pub archived: bool,
    pub arweave_tx_id: Option<String>,
    pub bump: u8,
    pub events_count: u32,
    pub batch_status: BatchStatus,
}

/// 事件订阅账户
#[derive(AnchorSerialize, AnchorDeserialize, Clone, Debug)]
pub struct EventSubscription {
    pub subscriber: Pubkey,
    pub event_types: Vec<EventType>,
    pub filters: EventFilters,
    pub delivery_config: DeliveryConfig,
    pub created_at: i64,
    pub last_delivered: i64,
    pub active: bool,
    pub bump: u8,
    pub delivery_stats: DeliveryStats,
}

/// 事件存储配置
#[derive(AnchorSerialize, AnchorDeserialize, Clone, Debug, PartialEq)]
pub struct EventStorageConfig {
    pub chain_storage_limit: u32,       // 链上存储的最大事件数
    pub archive_to_arweave: bool,       // 是否归档到 Arweave
    pub use_compression: bool,          // 是否压缩事件数据
    pub batch_size: u32,                // 批量处理大小
    pub auto_archive_after_days: u32,   // 自动归档天数
    pub max_event_size: u32,            // 单个事件最大大小
}

/// 事件保留策略
#[derive(AnchorSerialize, AnchorDeserialize, Clone, Debug, PartialEq)]
pub struct EventRetentionPolicy {
    pub chain_retention_days: u32,      // 链上保留天数
    pub archive_retention_days: u32,    // 归档保留天数
    pub auto_cleanup: bool,              // 自动清理
    pub priority_retention: Vec<PriorityRetention>, // 优先级保留策略
}

/// 优先级保留策略
#[derive(AnchorSerialize, AnchorDeserialize, Clone, Debug, PartialEq)]
pub struct PriorityRetention {
    pub event_type: EventType,
    pub retention_days: u32,
    pub priority: EventPriority,
}

/// 事件过滤器
#[derive(AnchorSerialize, AnchorDeserialize, Clone, Debug, PartialEq)]
pub struct EventFilters {
    pub source_programs: Option<Vec<Pubkey>>,    // 过滤特定程序的事件
    pub user_filter: Option<Pubkey>,             // 过滤特定用户的事件
    pub content_types: Option<Vec<ContentType>>, // 过滤特定内容类型
    pub time_range: Option<TimeRange>,           // 时间范围过滤
    pub event_priority: Option<EventPriority>,   // 事件优先级过滤
    pub custom_filters: Vec<CustomFilter>,       // 自定义过滤器
}

/// 时间范围
#[derive(AnchorSerialize, AnchorDeserialize, Clone, Debug, PartialEq)]
pub struct TimeRange {
    pub start_time: i64,
    pub end_time: i64,
}

/// 自定义过滤器
#[derive(AnchorSerialize, AnchorDeserialize, Clone, Debug, PartialEq)]
pub struct CustomFilter {
    pub field_name: String,
    pub operator: FilterOperator,
    pub value: String,
}

/// 过滤操作符
#[derive(AnchorSerialize, AnchorDeserialize, Clone, Debug, PartialEq)]
pub enum FilterOperator {
    Equals,
    NotEquals,
    Contains,
    NotContains,
    GreaterThan,
    LessThan,
    InRange,
}

/// 投递配置
#[derive(AnchorSerialize, AnchorDeserialize, Clone, Debug, PartialEq)]
pub enum DeliveryConfig {
    Immediate,                               // 立即推送
    Batched { interval_seconds: u32 },      // 批量推送
    OnQuery,                                 // 查询时获取
    Webhook { url: String, auth_token: Option<String> }, // Webhook 推送
    Custom { config: Vec<KeyValue> },        // 自定义配置
}

/// 投递统计
#[derive(AnchorSerialize, AnchorDeserialize, Clone, Debug, PartialEq)]
pub struct DeliveryStats {
    pub total_delivered: u64,
    pub successful_deliveries: u64,
    pub failed_deliveries: u64,
    pub last_delivery_attempt: i64,
    pub average_delivery_time: f64,
}

/// 批次状态
#[derive(AnchorSerialize, AnchorDeserialize, Clone, Debug, PartialEq)]
pub enum BatchStatus {
    Active,      // 活跃，正在接收事件
    Full,        // 已满，等待处理
    Processing,  // 处理中
    Archived,    // 已归档
    Failed,      // 处理失败
}

/// 事件类型
#[derive(AnchorSerialize, AnchorDeserialize, Clone, Debug, PartialEq)]
pub enum EventType {
    // 身份相关
    Identity,
    Profile,
    Verification,
    Reputation,
    
    // 内容相关
    Content,
    Interaction,
    Messaging,    Moderation,

    // 圈层 & 知识
    Circle,
    Knowledge,
    
    // 权限相关
    Access,
    Permission,
    
    // 系统相关
    System,
    Registry,
    Upgrade,
    
    // 自定义
    Custom(String),
}

/// 事件优先级
#[derive(AnchorSerialize, AnchorDeserialize, Clone, Debug, PartialEq)]
pub enum EventPriority {
    Low,
    Normal,
    High,
    Critical,
    Emergency,
}

#[derive(AnchorSerialize, AnchorDeserialize, Clone, Debug, PartialEq)]
pub enum DraftLifecycleMilestoneAction {
    EnteredCrystallization,
    Archived,
    Restored,
}

/// 完整的协议事件定义
#[derive(AnchorSerialize, AnchorDeserialize, Clone, Debug)]
pub enum ProtocolEvent {
    // 身份相关事件
    IdentityRegistered {
        identity_id: Pubkey,
        handle: String,
        verification_level: VerificationLevel,
        timestamp: i64,
        registry_id: Pubkey,
    },
    HandleRegistered {
        handle: String,
        identity_id: Pubkey,
        is_primary: bool,
        timestamp: i64,
    },
    HandleTransferred {
        handle: String,
        from_owner: Pubkey,
        to_owner: Pubkey,
        transfer_reason: TransferReason,
        transfer_fee: u64,
        timestamp: i64,
    },
    ProfileUpdated {
        identity_id: Pubkey,
        updated_fields: Vec<String>,
        update_type: ProfileUpdateType,
        timestamp: i64,
    },
    VerificationAttributeAdded {
        identity_id: Pubkey,
        attribute_type: String,
        verifier: Pubkey,
        timestamp: i64,
    },
    ReputationUpdated {
        identity_id: Pubkey,
        old_reputation: f64,
        new_reputation: f64,
        reason: String,
        updated_by: Pubkey,
        timestamp: i64,
    },
    
    // 内容相关事件
    ContentCreated {
        content_id: Pubkey,
        author: Pubkey,
        content_type: ContentType,
        storage_strategy: StorageStrategy,
        visibility: AccessLevel,
        timestamp: i64,
    },
    ContentAnchoredV2 {
        content_id: u64,
        author: Pubkey,
        content_hash: [u8; 32],
        uri_ref: String,
        relation: ContentAnchorRelation,
        visibility: AccessLevel,
        audience_kind: V2AudienceKind,
        audience_ref: u8,
        status: ContentStatus,
        timestamp: i64,
    },
    ContentAnchorUpdatedV2 {
        content_id: u64,
        content_version: u32,
        content_hash: [u8; 32],
        uri_ref: String,
        author: Pubkey,
        audience_kind: V2AudienceKind,
        audience_ref: u8,
        timestamp: i64,
    },
    ContentUpdated {
        content_id: Pubkey,
        author: Pubkey,
        updated_fields: Vec<String>,
        timestamp: i64,
    },
    ContentInteraction {
        content_id: Pubkey,
        actor: Pubkey,
        interaction_type: InteractionType,
        metadata: Option<String>,
        timestamp: i64,
    },
    ContentModerated {
        content_id: Pubkey,
        moderator: Pubkey,
        action: ModerationAction,
        reason: String,
        timestamp: i64,
    },
    ContentStatusChanged {
        content_id: Pubkey,
        old_status: ContentStatus,
        new_status: ContentStatus,
        changed_by: Pubkey,
        timestamp: i64,
    },
    ContentStatusChangedV2 {
        content_id: u64,
        old_status: ContentStatus,
        new_status: ContentStatus,
        changed_by: Pubkey,
        audience_kind: V2AudienceKind,
        audience_ref: u8,
        timestamp: i64,
    },
    DraftLifecycleMilestoneV2 {
        draft_post_id: u64,
        action: DraftLifecycleMilestoneAction,
        actor: Pubkey,
        policy_profile_digest: [u8; 32],
        timestamp: i64,
    },
    
    // 圈层相关事件
    CircleCreated {
        circle_id: u8,
        name: String,
        level: u8,
        parent_circle: Option<u8>,
        flags: u64,
        creator: Pubkey,
        timestamp: i64,
    },
    CircleFlagsUpdated {
        circle_id: u8,
        old_flags: u64,
        new_flags: u64,
        updated_by: Pubkey,
        timestamp: i64,
    },
    CircleMembershipChanged {
        circle_id: u8,
        member: Pubkey,
        role: CircleMemberRole,
        status: CircleMemberStatus,
        action: CircleMembershipAction,
        actor: Pubkey,
        timestamp: i64,
    },

    // 知识相关事件
    KnowledgeSubmitted {
        knowledge_id: [u8; 32],
        circle_id: u8,
        author: Pubkey,
        content_hash: [u8; 32],
        title: String,
        flags: u64,
        timestamp: i64,
    },
    ContributorsUpdated {
        knowledge_id: [u8; 32],
        contributors_root: [u8; 32],
        contributors_count: u16,
        version: u16,
        updated_by: Pubkey,
        timestamp: i64,
    },
    ContributorProofBound {
        knowledge_id: [u8; 32],
        source_anchor_id: [u8; 32],
        proof_package_hash: [u8; 32],
        contributors_root: [u8; 32],
        contributors_count: u16,
        binding_version: u16,
        generated_at: i64,
        bound_by: Pubkey,
        bound_at: i64,
    },
    ProofAttestorRegistered {
        attestor: Pubkey,
        registered_by: Pubkey,
        timestamp: i64,
    },
    MembershipAttestorRegistered {
        attestor: Pubkey,
        registered_by: Pubkey,
        timestamp: i64,
    },
    MembershipAttestorRevoked {
        attestor: Pubkey,
        revoked_by: Pubkey,
        timestamp: i64,
    },
    
    // 消息相关事件
    ConversationCreated {
        conversation_id: Pubkey,
        conversation_type: ConversationType,
        creator: Pubkey,
        participants: Vec<Pubkey>,
        timestamp: i64,
    },
    MessageSent {
        message_id: Pubkey,
        conversation_id: Pubkey,
        sender: Pubkey,
        message_type: MessageType,
        reply_to: Option<Pubkey>,
        timestamp: i64,
    },
    MessageRead {
        message_id: Pubkey,
        reader: Pubkey,
        timestamp: i64,
    },
    MessageRecalled {
        message_id: Pubkey,
        sender: Pubkey,
        timestamp: i64,
    },
    PresenceUpdated {
        user_id: Pubkey,
        status: String,
        custom_status: Option<String>,
        timestamp: i64,
    },
    
    // 权限相关事件
    AccessRuleCreated {
        user: Pubkey,
        rule_id: String,
        permission: Permission,
        access_level: AccessLevel,
        timestamp: i64,
    },
    AccessRuleUpdated {
        user: Pubkey,
        rule_id: String,
        permission: Permission,
        rule_change: AccessRuleChange,
        timestamp: i64,
    },
    PermissionGranted {
        granter: Pubkey,
        grantee: Pubkey,
        permission: Permission,
        scope: Option<Pubkey>,
        expires_at: Option<i64>,
        timestamp: i64,
    },
    PermissionDenied {
        requester: Pubkey,
        permission: Permission,
        target: Option<Pubkey>,
        reason: String,
        denial_code: u32,
        timestamp: i64,
    },
    RelationshipChanged {
        user1: Pubkey,
        user2: Pubkey,
        old_relationship: RelationshipType,
        new_relationship: RelationshipType,
        timestamp: i64,
    },
    
    // 系统事件
    ProgramUpgraded {
        program_id: Pubkey,
        old_version: String,
        new_version: String,
        upgrade_authority: Pubkey,
        upgrade_data: Vec<u8>,
        timestamp: i64,
    },
    RegistryDeployed {
        registry_id: Pubkey,
        registry_type: RegistryType,
        deployer: Pubkey,
        config: RegistryConfig,
        timestamp: i64,
    },
    RegistryUpgraded {
        registry_id: Pubkey,
        old_version: String,
        new_version: String,
        upgrade_data: Vec<u8>,
        timestamp: i64,
    },
    EmergencyAction {
        action_type: EmergencyActionType,
        triggered_by: Pubkey,
        affected_accounts: Vec<Pubkey>,
        reason: String,
        timestamp: i64,
    },
    
    // 经济相关事件
    TokensEarned {
        identity_id: Pubkey,
        amount: u64,
        source: EarningSource,
        transaction_id: String,
        timestamp: i64,
    },
    TokensSpent {
        identity_id: Pubkey,
        amount: u64,
        purpose: SpendingPurpose,
        transaction_id: String,
        timestamp: i64,
    },
    
    // 社交相关事件
    FollowAction {
        follower: Pubkey,
        followed: Pubkey,
        action: FollowActionType,
        timestamp: i64,
    },
    SocialStatsUpdated {
        identity_id: Pubkey,
        stat_type: SocialStatType,
        old_value: u64,
        new_value: u64,
        timestamp: i64,
    },
}

/// 档案更新类型
#[derive(AnchorSerialize, AnchorDeserialize, Clone, Debug, PartialEq)]
pub enum ProfileUpdateType {
    BasicInfo,
    PrivacySettings,
    NotificationPreferences,
    DisplayPreferences,
    CustomAttributes,
    AppSpecificData,
}

/// 审核动作
#[derive(AnchorSerialize, AnchorDeserialize, Clone, Debug, PartialEq)]
pub enum ModerationAction {
    Warning,
    ContentRemoval,
    AccountSuspension,
    AccountBan,
    ContentFlagging,
    ContentApproval,
}

// ContentStatus 已移动到 types.rs，避免重复定义

/// 访问规则变更
#[derive(AnchorSerialize, AnchorDeserialize, Clone, Debug, PartialEq)]
pub enum AccessRuleChange {
    Created,
    Updated,
    Deleted,
    Enabled,
    Disabled,
}

/// 紧急行动类型
#[derive(AnchorSerialize, AnchorDeserialize, Clone, Debug, PartialEq)]
pub enum EmergencyActionType {
    SystemPause,
    SystemResume,
    AccountFreeze,
    AccountUnfreeze,
    ContentTakedown,
    SecurityAlert,
    NetworkMaintenance,
}

/// 收入来源
#[derive(AnchorSerialize, AnchorDeserialize, Clone, Debug, PartialEq)]
pub enum EarningSource {
    ContentCreation,
    ContentInteraction,
    Referral,
    Staking,
    Validation,
    Moderation,
    Other(String),
}

/// 支出目的
#[derive(AnchorSerialize, AnchorDeserialize, Clone, Debug, PartialEq)]
pub enum SpendingPurpose {
    ContentCreation,
    ContentPromotion,
    FeatureUpgrade,
    Donation,
    Transfer,
    ServiceFee,
    Other(String),
}

/// 关注动作类型
#[derive(AnchorSerialize, AnchorDeserialize, Clone, Debug, PartialEq)]
pub enum FollowActionType {
    Follow,
    Unfollow,
    Block,
    Unblock,
    Mute,
    Unmute,
}

#[derive(AnchorSerialize, AnchorDeserialize, Clone, Debug, PartialEq)]
pub enum CircleMemberRole {
    Owner,
    Admin,
    Moderator,
    Member,
}

#[derive(AnchorSerialize, AnchorDeserialize, Clone, Debug, PartialEq)]
pub enum CircleMemberStatus {
    Active,
    Inactive,
}

#[derive(AnchorSerialize, AnchorDeserialize, Clone, Debug, PartialEq)]
pub enum CircleMembershipAction {
    Joined,
    Left,
    Added,
    Removed,
    RoleChanged,
}

#[derive(AnchorSerialize, AnchorDeserialize, Clone, Debug, PartialEq)]
pub enum CircleMembershipAdmissionKind {
    Open,
    Invite,
    Approval,
}

#[derive(AnchorSerialize, AnchorDeserialize, Clone, Debug, PartialEq)]
pub struct CircleMembershipAdmission {
    pub circle_id: u8,
    pub member: Pubkey,
    pub role: CircleMemberRole,
    pub kind: CircleMembershipAdmissionKind,
    pub artifact_id: u64,
    pub issued_at: i64,
    pub expires_at: i64,
}

/// 社交统计类型
#[derive(AnchorSerialize, AnchorDeserialize, Clone, Debug, PartialEq)]
pub enum SocialStatType {
    FollowerCount,
    FollowingCount,
    ContentCount,
    InteractionCount,
    ReputationScore,
}

/// 注册表类型
#[derive(AnchorSerialize, AnchorDeserialize, Clone, Debug, PartialEq)]
pub enum RegistryType {
    Identity,
    Content,
    Access,
    Custom(String),
}

/// 注册表配置
#[derive(AnchorSerialize, AnchorDeserialize, Clone, Debug, PartialEq)]
pub struct RegistryConfig {
    pub max_entries: u64,
    pub registration_fee: u64,
    pub admin: Pubkey,
    pub settings: Vec<KeyValue>,
}

// ==================== Event Emitter 实现方法 ====================

impl EventEmitter {
    pub const SPACE: usize = 
        8 +  // discriminator
        1 +  // bump
        32 + // admin
        8 +  // total_events
        8 +  // event_sequence
        EventStorageConfig::SPACE +
        EventRetentionPolicy::SPACE +
        8 +  // subscription_count
        8 +  // created_at
        8;   // last_updated

    /// 初始化事件发射器
    pub fn initialize(
        &mut self,
        bump: u8,
        admin: Pubkey,
        storage_config: EventStorageConfig,
        retention_policy: EventRetentionPolicy,
    ) -> Result<()> {
        self.bump = bump;
        self.admin = admin;
        self.total_events = 0;
        self.event_sequence = 0;
        self.storage_config = storage_config;
        self.retention_policy = retention_policy;
        self.subscription_count = 0;
        self.created_at = Clock::get()?.unix_timestamp;
        self.last_updated = self.created_at;
        Ok(())
    }

    /// 发射事件
    pub fn emit_event(&mut self, event: ProtocolEvent) -> Result<u64> {
        self.total_events = self.total_events.saturating_add(1);
        self.event_sequence = self.event_sequence.saturating_add(1);
        self.last_updated = Clock::get()?.unix_timestamp;
        
        Ok(self.event_sequence)
    }

    /// 添加订阅
    pub fn add_subscription(&mut self) -> Result<()> {
        self.subscription_count = self.subscription_count.saturating_add(1);
        self.last_updated = Clock::get()?.unix_timestamp;
        Ok(())
    }

    /// 移除订阅
    pub fn remove_subscription(&mut self) -> Result<()> {
        self.subscription_count = self.subscription_count.saturating_sub(1);
        self.last_updated = Clock::get()?.unix_timestamp;
        Ok(())
    }
}

impl EventBatch {
    pub const SPACE: usize = 
        8 +  // discriminator
        8 +  // batch_id
        8 +  // created_at
        4 + 50 * 512 + // events (最多50个事件，每个事件约512字节)
        1 +  // archived
        4 + 43 + 1 + // arweave_tx_id (Option<String>)
        1 +  // bump
        4 +  // events_count
        1;   // batch_status

    /// 计算动态大小
    pub fn calculate_size(max_events: usize) -> usize {
        8 +  // discriminator
        8 +  // batch_id
        8 +  // created_at
        4 + max_events * 512 +  // events (估算每个事件512字节)
        1 +  // archived
        4 + 43 + 1 + // arweave_tx_id
        1 +  // bump
        4 +  // events_count
        1    // batch_status
    }

    /// 初始化事件批次
    pub fn initialize(&mut self, batch_id: u64, bump: u8) -> Result<()> {
        self.batch_id = batch_id;
        self.created_at = Clock::get()?.unix_timestamp;
        self.events = Vec::new();
        self.archived = false;
        self.arweave_tx_id = None;
        self.bump = bump;
        self.events_count = 0;
        self.batch_status = BatchStatus::Active;
        Ok(())
    }

    /// 添加事件到批次
    pub fn add_event(&mut self, event: ProtocolEvent) -> Result<()> {
        require!(
            self.batch_status == BatchStatus::Active,
            crate::AlchemeError::InvalidOperation
        );
        
        require!(
            self.events.len() < crate::constants::MAX_EVENTS_PER_BATCH,
            crate::AlchemeError::EventBatchFull
        );
        
        self.events.push(event);
        self.events_count = self.events_count.saturating_add(1);
        
        // 检查是否达到批次大小限制
        if self.events.len() >= crate::constants::MAX_EVENTS_PER_BATCH {
            self.batch_status = BatchStatus::Full;
        }
        
        Ok(())
    }

    /// 标记为已归档
    pub fn mark_archived(&mut self, arweave_tx_id: String) -> Result<()> {
        self.archived = true;
        self.arweave_tx_id = Some(arweave_tx_id);
        self.batch_status = BatchStatus::Archived;
        Ok(())
    }
}

impl EventSubscription {
    pub const SPACE: usize = 
        8 +  // discriminator
        32 + // subscriber
        4 + 10 * 1 + // event_types (最多10种)
        EventFilters::SPACE +
        DeliveryConfig::SPACE +
        8 +  // created_at
        8 +  // last_delivered
        1 +  // active
        1 +  // bump
        DeliveryStats::SPACE;

    /// 初始化订阅
    pub fn initialize(
        &mut self,
        subscriber: Pubkey,
        event_types: Vec<EventType>,
        filters: EventFilters,
        delivery_config: DeliveryConfig,
        bump: u8,
    ) -> Result<()> {
        self.subscriber = subscriber;
        self.event_types = event_types;
        self.filters = filters;
        self.delivery_config = delivery_config;
        self.created_at = Clock::get()?.unix_timestamp;
        self.last_delivered = 0;
        self.active = true;
        self.bump = bump;
        self.delivery_stats = DeliveryStats {
            total_delivered: 0,
            successful_deliveries: 0,
            failed_deliveries: 0,
            last_delivery_attempt: 0,
            average_delivery_time: 0.0,
        };
        Ok(())
    }

    /// 检查事件是否匹配过滤器
    pub fn matches_event(&self, event: &ProtocolEvent) -> bool {
        // 检查事件类型
        let event_type = Self::get_event_type(event);
        if !self.event_types.contains(&event_type) {
            return false;
        }
        
        // 检查过滤器
        self.check_filters(event)
    }

    /// 获取事件类型
    fn get_event_type(event: &ProtocolEvent) -> EventType {
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
            
            ProtocolEvent::ContentModerated { .. } => EventType::Moderation,
            
            ProtocolEvent::AccessRuleCreated { .. } |
            ProtocolEvent::AccessRuleUpdated { .. } => EventType::Access,
            
            ProtocolEvent::PermissionGranted { .. } |
            ProtocolEvent::PermissionDenied { .. } |
            ProtocolEvent::RelationshipChanged { .. } => EventType::Permission,
            
            ProtocolEvent::ProgramUpgraded { .. } |
            ProtocolEvent::EmergencyAction { .. } => EventType::System,
            
            ProtocolEvent::RegistryDeployed { .. } |
            ProtocolEvent::RegistryUpgraded { .. } => EventType::Registry,

            ProtocolEvent::CircleCreated { .. } |
            ProtocolEvent::CircleFlagsUpdated { .. } |
            ProtocolEvent::CircleMembershipChanged { .. } => EventType::Circle,

            ProtocolEvent::KnowledgeSubmitted { .. } |
            ProtocolEvent::ContributorsUpdated { .. } => EventType::Knowledge,
            
            _ => EventType::Custom("unknown".to_string()),
        }
    }

    /// 检查过滤器
    fn check_filters(&self, event: &ProtocolEvent) -> bool {
        // 简化的过滤器检查实现
        // 在实际实现中，这里会有更复杂的过滤逻辑
        
        // 检查时间范围
        if let Some(time_range) = &self.filters.time_range {
            let event_time = Self::get_event_timestamp(event);
            if event_time < time_range.start_time || event_time > time_range.end_time {
                return false;
            }
        }
        
        // 检查用户过滤器
        if let Some(user_filter) = &self.filters.user_filter {
            let event_user = Self::get_event_user(event);
            if let Some(event_user) = event_user {
                if event_user != *user_filter {
                    return false;
                }
            }
        }
        
        true
    }

    /// 获取事件时间戳
    fn get_event_timestamp(event: &ProtocolEvent) -> i64 {
        match event {
            ProtocolEvent::IdentityRegistered { timestamp, .. } |
            ProtocolEvent::HandleRegistered { timestamp, .. } |
            ProtocolEvent::ProfileUpdated { timestamp, .. } |
            ProtocolEvent::ContentCreated { timestamp, .. } |
            ProtocolEvent::ContentAnchoredV2 { timestamp, .. } |
            ProtocolEvent::ContentAnchorUpdatedV2 { timestamp, .. } |
            ProtocolEvent::ContentStatusChangedV2 { timestamp, .. } |
            ProtocolEvent::DraftLifecycleMilestoneV2 { timestamp, .. } |
            ProtocolEvent::ContentInteraction { timestamp, .. } |
            ProtocolEvent::PermissionGranted { timestamp, .. } |
            ProtocolEvent::ProgramUpgraded { timestamp, .. } |
            ProtocolEvent::CircleCreated { timestamp, .. } |
            ProtocolEvent::CircleFlagsUpdated { timestamp, .. } |
            ProtocolEvent::CircleMembershipChanged { timestamp, .. } |
            ProtocolEvent::KnowledgeSubmitted { timestamp, .. } |
            ProtocolEvent::ContributorsUpdated { timestamp, .. } => *timestamp,
            _ => 0,
        }
    }

    /// 获取事件相关用户
    fn get_event_user(event: &ProtocolEvent) -> Option<Pubkey> {
        match event {
            ProtocolEvent::IdentityRegistered { identity_id, .. } => Some(*identity_id),
            ProtocolEvent::HandleRegistered { identity_id, .. } => Some(*identity_id),
            ProtocolEvent::ProfileUpdated { identity_id, .. } => Some(*identity_id),
            ProtocolEvent::ContentCreated { author, .. } => Some(*author),
            ProtocolEvent::ContentAnchoredV2 { author, .. } => Some(*author),
            ProtocolEvent::ContentAnchorUpdatedV2 { author, .. } => Some(*author),
            ProtocolEvent::ContentStatusChangedV2 { changed_by, .. } => Some(*changed_by),
            ProtocolEvent::DraftLifecycleMilestoneV2 { actor, .. } => Some(*actor),
            ProtocolEvent::ContentInteraction { actor, .. } => Some(*actor),
            ProtocolEvent::CircleCreated { creator, .. } => Some(*creator),
            ProtocolEvent::CircleFlagsUpdated { updated_by, .. } => Some(*updated_by),
            ProtocolEvent::CircleMembershipChanged { actor, .. } => Some(*actor),
            ProtocolEvent::KnowledgeSubmitted { author, .. } => Some(*author),
            ProtocolEvent::ContributorsUpdated { updated_by, .. } => Some(*updated_by),
            _ => None,
        }
    }

    /// 更新投递统计
    pub fn update_delivery_stats(&mut self, success: bool, delivery_time: f64) -> Result<()> {
        self.delivery_stats.total_delivered = self.delivery_stats.total_delivered.saturating_add(1);
        
        if success {
            self.delivery_stats.successful_deliveries = 
                self.delivery_stats.successful_deliveries.saturating_add(1);
        } else {
            self.delivery_stats.failed_deliveries = 
                self.delivery_stats.failed_deliveries.saturating_add(1);
        }
        
        self.delivery_stats.last_delivery_attempt = Clock::get()?.unix_timestamp;
        
        // 更新平均投递时间
        let total_deliveries = self.delivery_stats.total_delivered as f64;
        self.delivery_stats.average_delivery_time = 
            (self.delivery_stats.average_delivery_time * (total_deliveries - 1.0) + delivery_time) / total_deliveries;
        
        self.last_delivered = Clock::get()?.unix_timestamp;
        
        Ok(())
    }
}

// ==================== 空间计算实现 ====================

impl EventStorageConfig {
    pub const SPACE: usize = 
        4 +  // chain_storage_limit
        1 +  // archive_to_arweave
        1 +  // use_compression
        4 +  // batch_size
        4 +  // auto_archive_after_days
        4;   // max_event_size
}

impl EventRetentionPolicy {
    pub const SPACE: usize = 
        4 +  // chain_retention_days
        4 +  // archive_retention_days
        1 +  // auto_cleanup
        4;   // priority_retention (空 Vec)
}

impl PriorityRetention {
    pub const SPACE: usize = 
        1 +  // event_type
        4 +  // retention_days
        1;   // priority
}

impl EventFilters {
    pub const SPACE: usize = 
        4 + 10 * 32 + 1 + // source_programs (Option<Vec<Pubkey>>)
        32 + 1 + // user_filter (Option<Pubkey>)
        4 + 10 * 1 + 1 + // content_types (Option<Vec<ContentType>>)
        TimeRange::SPACE + 1 + // time_range (Option<TimeRange>)
        1 + 1 + // event_priority (Option<EventPriority>)
        4 + 10 * CustomFilter::SPACE; // custom_filters
}

impl TimeRange {
    pub const SPACE: usize = 
        8 +  // start_time
        8;   // end_time
}

impl CustomFilter {
    pub const SPACE: usize = 
        4 + 64 + // field_name
        1 +  // operator
        4 + 256; // value
}

impl DeliveryConfig {
    pub const SPACE: usize = 
        1 +  // enum discriminant
        4 +  // largest variant data (interval_seconds or url)
        256; // max string length for webhook url
}

impl DeliveryStats {
    pub const SPACE: usize = 
        8 +  // total_delivered
        8 +  // successful_deliveries
        8 +  // failed_deliveries
        8 +  // last_delivery_attempt
        8;   // average_delivery_time
}

// ==================== 默认实现 ====================

impl Default for EventStorageConfig {
    fn default() -> Self {
        Self {
            chain_storage_limit: crate::constants::MAX_CHAIN_EVENTS as u32,
            archive_to_arweave: true,
            use_compression: true,
            batch_size: crate::constants::MAX_EVENTS_PER_BATCH as u32,
            auto_archive_after_days: crate::constants::CHAIN_EVENT_RETENTION_DAYS as u32,
            max_event_size: crate::constants::MAX_EVENT_DATA_SIZE as u32,
        }
    }
}

impl Default for EventRetentionPolicy {
    fn default() -> Self {
        Self {
            chain_retention_days: crate::constants::CHAIN_EVENT_RETENTION_DAYS as u32,
            archive_retention_days: 365, // 1年
            auto_cleanup: true,
            priority_retention: vec![], // 空初始化
        }
    }
}
