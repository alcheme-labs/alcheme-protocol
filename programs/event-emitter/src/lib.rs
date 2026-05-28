use anchor_lang::prelude::*;
use alcheme_shared::{
    types::*, errors::*, constants::*, utils::*, validation::*,
    events::*, access::*, content::*, factory::*
};

pub mod instructions;
pub mod state;

// Re-export for convenience
pub use instructions::*;
pub use state::*;

// Program ID
declare_id!("uhPvVgDANHaUzUq2rYEVXJ9vGEBjWjNZ1E6gQJqdBUC");

/// Event Emitter Program - 全局事件系统
#[program]
pub mod event_emitter {
    use super::*;

    // ==================== 事件发射器管理 ====================

    /// 初始化事件发射器
    pub fn initialize_event_emitter(
        ctx: Context<InitializeEventEmitter>,
        storage_config: EventStorageConfig,
        retention_policy: EventRetentionPolicy,
    ) -> Result<()> {
        instructions::initialize_event_emitter(ctx, storage_config, retention_policy)
    }

    /// 更新事件发射器配置
    pub fn update_event_emitter_config(
        ctx: Context<UpdateEventEmitterConfig>,
        new_storage_config: Option<EventStorageConfig>,
        new_retention_policy: Option<EventRetentionPolicy>,
    ) -> Result<()> {
        instructions::update_event_emitter_config(ctx, new_storage_config, new_retention_policy)
    }

    // ==================== 事件发射指令 ====================

    /// 发射单个事件
    pub fn emit_event(
        ctx: Context<EmitEvent>,
        event: ProtocolEvent,
        priority: EventPriority,
    ) -> Result<u64> {
        instructions::emit_event(ctx, event, priority)
    }

    /// 批量发射事件
    pub fn batch_emit_events(
        ctx: Context<BatchEmitEvents>,
        events: Vec<ProtocolEvent>,
        priority: EventPriority,
    ) -> Result<Vec<u64>> {
        instructions::batch_emit_events(ctx, events, priority)
    }

    /// 发射身份事件 (CPI)
    pub fn emit_identity_event(
        ctx: Context<EmitIdentityEvent>,
        event: ProtocolEvent,
    ) -> Result<()> {
        instructions::emit_identity_event(ctx, event)
    }

    /// 发射内容事件 (CPI)
    pub fn emit_content_event(
        ctx: Context<EmitContentEvent>,
        event: ProtocolEvent,
    ) -> Result<()> {
        instructions::emit_content_event(ctx, event)
    }

    /// 发射内容锚点事件 (v2 轻量路径, CPI)
    pub fn emit_content_anchor_v2_light(
        ctx: Context<EmitContentAnchorV2Light>,
        event: ProtocolEvent,
    ) -> Result<u64> {
        instructions::emit_content_anchor_v2_light(ctx, event)
    }

    /// 发射权限事件 (CPI)
    pub fn emit_access_event(
        ctx: Context<EmitAccessEvent>,
        event: ProtocolEvent,
    ) -> Result<()> {
        instructions::emit_access_event(ctx, event)
    }

    // ==================== 事件查询指令 ====================

    /// 查询事件
    pub fn query_events(
        ctx: Context<QueryEvents>,
        filters: EventFilters,
        pagination: PaginationConfig,
    ) -> Result<Vec<ProtocolEvent>> {
        instructions::query_events(ctx, filters, pagination)
    }

    /// 获取事件统计
    pub fn get_event_stats(
        ctx: Context<GetEventStats>,
        time_range: Option<TimeRange>,
    ) -> Result<EventStats> {
        instructions::get_event_stats(ctx, time_range)
    }

    /// 获取用户事件历史
    pub fn get_user_event_history(
        ctx: Context<GetUserEventHistory>,
        user: Pubkey,
        event_types: Option<Vec<EventType>>,
        limit: u32,
    ) -> Result<Vec<ProtocolEvent>> {
        instructions::get_user_event_history(ctx, user, event_types, limit)
    }

    // ==================== 事件订阅管理 ====================

    /// 创建事件订阅
    pub fn subscribe_to_events(
        ctx: Context<SubscribeToEvents>,
        event_types: Vec<EventType>,
        filters: EventFilters,
        delivery_config: DeliveryConfig,
    ) -> Result<()> {
        instructions::subscribe_to_events(ctx, event_types, filters, delivery_config)
    }

    /// 更新事件订阅
    pub fn update_subscription(
        ctx: Context<UpdateSubscription>,
        new_event_types: Option<Vec<EventType>>,
        new_filters: Option<EventFilters>,
        new_delivery_config: Option<DeliveryConfig>,
    ) -> Result<()> {
        instructions::update_subscription(ctx, new_event_types, new_filters, new_delivery_config)
    }

    /// 取消事件订阅
    pub fn unsubscribe_from_events(
        ctx: Context<UnsubscribeFromEvents>,
    ) -> Result<()> {
        instructions::unsubscribe_from_events(ctx)
    }

    /// 暂停/恢复订阅
    pub fn toggle_subscription(
        ctx: Context<ToggleSubscription>,
        active: bool,
    ) -> Result<()> {
        instructions::toggle_subscription(ctx, active)
    }

    // ==================== 事件归档管理 ====================

    /// 归档事件批次
    pub fn archive_event_batch(
        ctx: Context<ArchiveEventBatch>,
        batch_id: u64,
        arweave_tx_id: String,
    ) -> Result<()> {
        instructions::archive_event_batch(ctx, batch_id, arweave_tx_id)
    }

    /// 清理过期事件
    pub fn cleanup_expired_events(
        ctx: Context<CleanupExpiredEvents>,
        cutoff_timestamp: i64,
    ) -> Result<u64> { // 返回清理的事件数量
        instructions::cleanup_expired_events(ctx, cutoff_timestamp)
    }

    /// 获取归档统计
    pub fn get_archive_stats(
        ctx: Context<GetArchiveStats>,
    ) -> Result<ArchiveStats> {
        instructions::get_archive_stats(ctx)
    }
}
