use anchor_lang::prelude::*;
use anchor_lang::solana_program::instruction::{get_stack_height, TRANSACTION_LEVEL_STACK_HEIGHT};
use anchor_lang::solana_program::log::sol_log_data;
use alcheme_shared::*;
use alcheme_cpi::{require_cpi_permission, is_authorized_for_cpi, CpiPermission};
use crate::state::*;

fn log_protocol_event(event: &ProtocolEvent) -> Result<()> {
    let serialized = event
        .try_to_vec()
        .map_err(|_| error!(AlchemeError::SerializationError))?;
    sol_log_data(&[serialized.as_slice()]);
    Ok(())
}

// ==================== 事件发射器管理指令 ====================

/// 初始化事件发射器
#[derive(Accounts)]
pub struct InitializeEventEmitter<'info> {
    #[account(
        init,
        payer = admin,
        space = EventEmitterAccount::SPACE,
        seeds = [EVENT_EMITTER_SEED],
        bump
    )]
    pub event_emitter: Account<'info, EventEmitterAccount>,
    
    #[account(mut)]
    pub admin: Signer<'info>,
    
    pub system_program: Program<'info, System>,
}

pub fn initialize_event_emitter(
    ctx: Context<InitializeEventEmitter>,
    storage_config: EventStorageConfig,
    retention_policy: EventRetentionPolicy,
) -> Result<()> {
    let event_emitter = &mut ctx.accounts.event_emitter;
    let bump = ctx.bumps.event_emitter;
    
    event_emitter.initialize(
        bump,
        ctx.accounts.admin.key(),
        storage_config,
        retention_policy,
    )?;
    
    msg!("Event emitter initialized");
    Ok(())
}

/// 更新事件发射器配置
#[derive(Accounts)]
pub struct UpdateEventEmitterConfig<'info> {
    #[account(
        mut,
        constraint = admin.key() == event_emitter.admin @ AlchemeError::Unauthorized
    )]
    pub event_emitter: Account<'info, EventEmitterAccount>,
    
    pub admin: Signer<'info>,
}

pub fn update_event_emitter_config(
    ctx: Context<UpdateEventEmitterConfig>,
    new_storage_config: Option<EventStorageConfig>,
    new_retention_policy: Option<EventRetentionPolicy>,
) -> Result<()> {
    let event_emitter = &mut ctx.accounts.event_emitter;
    
    if let Some(storage_config) = new_storage_config {
        event_emitter.storage_config = storage_config;
    }
    
    if let Some(retention_policy) = new_retention_policy {
        event_emitter.retention_policy = retention_policy;
    }
    
    event_emitter.last_updated = Clock::get()?.unix_timestamp;
    
    msg!("Event emitter config updated");
    Ok(())
}

// ==================== 事件发射指令 ====================

/// 发射单个事件
#[derive(Accounts)]
pub struct EmitEvent<'info> {
    #[account(mut)]
    pub event_emitter: Account<'info, EventEmitterAccount>,
    
    #[account(
        init_if_needed,
        payer = payer,
        space = EventBatchAccount::calculate_size(1),
        seeds = [EVENT_BATCH_SEED, &event_emitter.event_sequence.to_le_bytes()],
        bump
    )]
    pub event_batch: Account<'info, EventBatchAccount>,
    
    #[account(mut)]
    pub payer: Signer<'info>,
    
    pub system_program: Program<'info, System>,
}

pub fn emit_event(
    ctx: Context<EmitEvent>,
    event: ProtocolEvent,
    _priority: EventPriority,
) -> Result<u64> {
    let event_emitter = &mut ctx.accounts.event_emitter;
    let event_batch = &mut ctx.accounts.event_batch;
    
    // 验证事件
    EventEmitterUtils::validate_event(&event)?;
    EventEmitterUtils::validate_event_size(&event, event_emitter.storage_config.max_event_size)?;
    
    // 如果批次未初始化，先初始化
    if event_batch.batch_id == 0 {
        let batch_id = EventEmitterUtils::calculate_next_batch_id(
            event_emitter.event_sequence,
            event_emitter.storage_config.batch_size,
        );
        let bump = ctx.bumps.event_batch;
        event_batch.initialize(batch_id, bump)?;
    }
    
    // 动态扩展账户空间
    let required_space = event_batch.get_size_with_new_event(&event)?;
    EventBatchAccount::realloc_if_needed(
        event_batch,
        required_space,
        &ctx.accounts.payer,
        &ctx.accounts.system_program,
    )?;
    
    // 检查批次是否可以接收事件
    require!(
        EventEmitterUtils::can_batch_accept_events(
            event_batch.events_count,
            event_batch.batch_status.clone(),
            MAX_EVENTS_PER_BATCH,
        ),
        AlchemeError::EventBatchFull
    );
    
    // 添加事件到批次
    event_batch.add_event(event.clone())?;
    
    // 更新事件发射器统计
    let event_sequence = event_emitter.emit_event(event)?;

    // 输出结构化日志，供 indexer 直接解析 ProtocolEvent
    let logged_event = event_batch
        .events
        .last()
        .cloned()
        .ok_or(AlchemeError::EventEmissionFailed)?;
    log_protocol_event(&logged_event)?;

    msg!("Event emitted: sequence {}, batch {}", event_sequence, event_batch.batch_id);
    Ok(event_sequence)
}

/// 批量发射事件
#[derive(Accounts)]
pub struct BatchEmitEvents<'info> {
    #[account(mut)]
    pub event_emitter: Account<'info, EventEmitterAccount>,
    
    #[account(
        init_if_needed,
        payer = payer,
        space = EventBatchAccount::calculate_size(1),
        seeds = [EVENT_BATCH_SEED, &event_emitter.event_sequence.to_le_bytes()],
        bump
    )]
    pub event_batch: Account<'info, EventBatchAccount>,
    
    #[account(mut)]
    pub payer: Signer<'info>,
    
    pub system_program: Program<'info, System>,
}

pub fn batch_emit_events(
    ctx: Context<BatchEmitEvents>,
    events: Vec<ProtocolEvent>,
    _priority: EventPriority,
) -> Result<Vec<u64>> {
    let event_emitter = &mut ctx.accounts.event_emitter;
    let event_batch = &mut ctx.accounts.event_batch;
    
    // 验证批次大小
    require!(
        events.len() <= MAX_BATCH_SIZE,
        AlchemeError::EventBatchFull
    );
    
    // 如果批次未初始化，先初始化
    if event_batch.batch_id == 0 {
        let batch_id = EventEmitterUtils::calculate_next_batch_id(
            event_emitter.event_sequence,
            event_emitter.storage_config.batch_size,
        );
        let bump = ctx.bumps.event_batch;
        event_batch.initialize(batch_id, bump)?;
    }
    
    // 动态扩展账户空间以容纳所有新事件
    let required_space = event_batch.get_size_with_new_events(&events)?;
    EventBatchAccount::realloc_if_needed(
        event_batch,
        required_space,
        &ctx.accounts.payer,
        &ctx.accounts.system_program,
    )?;
    
    let mut event_sequences = Vec::new();
    
    for event in events {
        // 验证每个事件
        EventEmitterUtils::validate_event(&event)?;
        EventEmitterUtils::validate_event_size(&event, event_emitter.storage_config.max_event_size)?;
        
        // 检查批次容量
        require!(
            EventEmitterUtils::can_batch_accept_events(
                event_batch.events_count,
                event_batch.batch_status.clone(),
                MAX_EVENTS_PER_BATCH,
            ),
            AlchemeError::EventBatchFull
        );
        
        // 添加事件
        event_batch.add_event(event.clone())?;
        let sequence = event_emitter.emit_event(event.clone())?;
        log_protocol_event(&event)?;
        event_sequences.push(sequence);
    }
    
    msg!("Batch event emission completed: {} events", event_sequences.len());
    Ok(event_sequences)
}

// ==================== 简化的 CPI 事件发射指令 ====================

/// 发射身份事件 (CPI)
#[derive(Accounts)]
pub struct EmitIdentityEvent<'info> {
    #[account(mut)]
    pub event_emitter: Account<'info, EventEmitterAccount>,
    
    #[account(
        init_if_needed,
        payer = payer,
        space = EventBatchAccount::calculate_size(1),
        seeds = [EVENT_BATCH_SEED, &event_emitter.event_sequence.to_le_bytes()],
        bump
    )]
    pub event_batch: Account<'info, EventBatchAccount>,
    
    /// CHECK: 调用程序验证
    pub caller_program: AccountInfo<'info>,
    
    #[account(mut)]
    pub payer: Signer<'info>,
    
    pub system_program: Program<'info, System>,
}

pub fn emit_identity_event(
    ctx: Context<EmitIdentityEvent>,
    event: ProtocolEvent,
) -> Result<()> {
    // 验证调用者权限
    require_cpi_permission!(&ctx.accounts.caller_program.key(), CpiPermission::EventEmit);
    
    // 验证事件类型
    let event_type = EventEmitterUtils::get_event_type(&event);
    require!(
        matches!(event_type, EventType::Identity | EventType::Profile),
        AlchemeError::InvalidEventType
    );
    
    let event_emitter = &mut ctx.accounts.event_emitter;
    let event_batch = &mut ctx.accounts.event_batch;
    
    // 如果批次未初始化，先初始化
    if event_batch.batch_id == 0 {
        let batch_id = EventEmitterUtils::calculate_next_batch_id(
            event_emitter.event_sequence,
            event_emitter.storage_config.batch_size,
        );
        let bump = ctx.bumps.event_batch;
        event_batch.initialize(batch_id, bump)?;
    }
    
    // 动态扩展账户空间
    let required_space = event_batch.get_size_with_new_event(&event)?;
    EventBatchAccount::realloc_if_needed(
        event_batch,
        required_space,
        &ctx.accounts.payer,
        &ctx.accounts.system_program,
    )?;
    
    // 添加事件到批次
    event_batch.add_event(event.clone())?;
    event_emitter.emit_event(event)?;
    let logged_event = event_batch
        .events
        .last()
        .cloned()
        .ok_or(AlchemeError::EventEmissionFailed)?;
    log_protocol_event(&logged_event)?;
    
    msg!("Identity event emitted");
    Ok(())
}

/// 发射内容事件 (CPI)
#[derive(Accounts)]
pub struct EmitContentEvent<'info> {
    #[account(mut)]
    pub event_emitter: Account<'info, EventEmitterAccount>,
    
    #[account(
        init_if_needed,
        payer = payer,
        space = EventBatchAccount::calculate_size(1),
        seeds = [EVENT_BATCH_SEED, &event_emitter.event_sequence.to_le_bytes()],
        bump
    )]
    pub event_batch: Account<'info, EventBatchAccount>,
    
    /// CHECK: 调用程序验证
    pub caller_program: AccountInfo<'info>,
    
    #[account(mut)]
    pub payer: Signer<'info>,
    
    pub system_program: Program<'info, System>,
}

pub fn emit_content_event(
    ctx: Context<EmitContentEvent>,
    event: ProtocolEvent,
) -> Result<()> {
    // 验证调用者权限
    require_cpi_permission!(&ctx.accounts.caller_program.key(), CpiPermission::EventEmit);
    
    // 验证事件类型
    let event_type = EventEmitterUtils::get_event_type(&event);
    require!(
        matches!(event_type, EventType::Content | EventType::Interaction),
        AlchemeError::InvalidEventType
    );
    
    let event_emitter = &mut ctx.accounts.event_emitter;
    let event_batch = &mut ctx.accounts.event_batch;
    
    // 如果批次未初始化，先初始化
    if event_batch.batch_id == 0 {
        let batch_id = EventEmitterUtils::calculate_next_batch_id(
            event_emitter.event_sequence,
            event_emitter.storage_config.batch_size,
        );
        let bump = ctx.bumps.event_batch;
        event_batch.initialize(batch_id, bump)?;
    }
    
    // 动态扩展账户空间
    let required_space = event_batch.get_size_with_new_event(&event)?;
    EventBatchAccount::realloc_if_needed(
        event_batch,
        required_space,
        &ctx.accounts.payer,
        &ctx.accounts.system_program,
    )?;
    
    // 添加事件到批次
    event_batch.add_event(event.clone())?;
    event_emitter.emit_event(event)?;
    let logged_event = event_batch
        .events
        .last()
        .cloned()
        .ok_or(AlchemeError::EventEmissionFailed)?;
    log_protocol_event(&logged_event)?;
    
    msg!("Content event emitted");
    Ok(())
}

/// 发射内容锚点事件 (v2 轻量路径, CPI)
#[derive(Accounts)]
pub struct EmitContentAnchorV2Light<'info> {
    #[account(mut)]
    pub event_emitter: Account<'info, EventEmitterAccount>,
}

pub fn emit_content_anchor_v2_light(
    ctx: Context<EmitContentAnchorV2Light>,
    event: ProtocolEvent,
) -> Result<u64> {
    // 仅允许通过 CPI 调用，禁止外部交易直接调用轻量路径。
    require!(
        get_stack_height() > TRANSACTION_LEVEL_STACK_HEIGHT,
        AlchemeError::UnauthorizedCpiCall
    );

    require!(
        matches!(
            &event,
            ProtocolEvent::ContentAnchoredV2 { .. } | ProtocolEvent::ContentAnchorUpdatedV2 { .. }
        ),
        AlchemeError::InvalidEventType
    );

    let event_emitter = &mut ctx.accounts.event_emitter;
    EventEmitterUtils::validate_event(&event)?;
    EventEmitterUtils::validate_event_size(&event, event_emitter.storage_config.max_event_size)?;

    let event_sequence = event_emitter.emit_event(event.clone())?;
    log_protocol_event(&event)?;

    msg!("v2 content anchor event emitted: sequence {}", event_sequence);
    Ok(event_sequence)
}

/// 发射权限事件 (CPI)
#[derive(Accounts)]
pub struct EmitAccessEvent<'info> {
    #[account(mut)]
    pub event_emitter: Account<'info, EventEmitterAccount>,
    
    #[account(
        init_if_needed,
        payer = payer,
        space = EventBatchAccount::calculate_size(1),
        seeds = [EVENT_BATCH_SEED, &event_emitter.event_sequence.to_le_bytes()],
        bump
    )]
    pub event_batch: Account<'info, EventBatchAccount>,
    
    /// CHECK: 调用程序验证
    pub caller_program: AccountInfo<'info>,
    
    #[account(mut)]
    pub payer: Signer<'info>,
    
    pub system_program: Program<'info, System>,
}

pub fn emit_access_event(
    ctx: Context<EmitAccessEvent>,
    event: ProtocolEvent,
) -> Result<()> {
    // 验证调用者权限
    require_cpi_permission!(&ctx.accounts.caller_program.key(), CpiPermission::EventEmit);
    
    // 验证事件类型
    let event_type = EventEmitterUtils::get_event_type(&event);
    require!(
        matches!(event_type, EventType::Access | EventType::Permission),
        AlchemeError::InvalidEventType
    );
    
    let event_emitter = &mut ctx.accounts.event_emitter;
    let event_batch = &mut ctx.accounts.event_batch;
    
    // 如果批次未初始化，先初始化
    if event_batch.batch_id == 0 {
        let batch_id = EventEmitterUtils::calculate_next_batch_id(
            event_emitter.event_sequence,
            event_emitter.storage_config.batch_size,
        );
        let bump = ctx.bumps.event_batch;
        event_batch.initialize(batch_id, bump)?;
    }
    
    // 动态扩展账户空间
    let required_space = event_batch.get_size_with_new_event(&event)?;
    EventBatchAccount::realloc_if_needed(
        event_batch,
        required_space,
        &ctx.accounts.payer,
        &ctx.accounts.system_program,
    )?;
    
    // 添加事件到批次
    event_batch.add_event(event.clone())?;
    event_emitter.emit_event(event)?;
    let logged_event = event_batch
        .events
        .last()
        .cloned()
        .ok_or(AlchemeError::EventEmissionFailed)?;
    log_protocol_event(&logged_event)?;
    
    msg!("Permission event emitted");
    Ok(())
}

// ==================== 事件查询指令 ====================

/// 查询事件
#[derive(Accounts)]
pub struct QueryEvents<'info> {
    pub event_emitter: Account<'info, EventEmitterAccount>,
    
    /// CHECK: 查询可能涉及多个批次，这里简化处理
    pub event_batch: AccountInfo<'info>,
}

pub fn query_events(
    _ctx: Context<QueryEvents>,
    _filters: EventFilters,
    _pagination: PaginationConfig,
) -> Result<Vec<ProtocolEvent>> {
    // 简化实现：返回空结果
    // 在实际实现中，需要查询多个批次和归档数据
    
    let matching_events = Vec::new();
    
    msg!("Event query completed: found {} matching events", matching_events.len());
    Ok(matching_events)
}

/// 获取事件统计
#[derive(Accounts)]
pub struct GetEventStats<'info> {
    pub event_emitter: Account<'info, EventEmitterAccount>,
}

pub fn get_event_stats(
    ctx: Context<GetEventStats>,
    _time_range: Option<TimeRange>,
) -> Result<EventStats> {
    let event_emitter = &ctx.accounts.event_emitter;
    
    // 简化实现：返回基本统计
    let stats = EventStats {
        total_events: event_emitter.total_events,
        events_by_type: vec![], // 需要遍历批次来计算
        events_by_priority: vec![], // 需要遍历批次来计算
        average_events_per_day: 0.0, // 需要历史数据计算
        peak_events_per_hour: 0,
        current_batch_count: 1, // 简化
        archived_batch_count: 0, // 需要查询归档数据
        storage_usage: StorageUsage {
            chain_storage_used: 0,
            chain_storage_limit: event_emitter.storage_config.chain_storage_limit as u64,
            archive_storage_used: 0,
            compression_ratio: 0.0,
        },
    };
    
    Ok(stats)
}

/// 获取用户事件历史
#[derive(Accounts)]
pub struct GetUserEventHistory<'info> {
    pub event_emitter: Account<'info, EventEmitterAccount>,
    
    /// CHECK: 查询特定用户的事件
    pub target_user: AccountInfo<'info>,
}

pub fn get_user_event_history(
    _ctx: Context<GetUserEventHistory>,
    _user: Pubkey,
    _event_types: Option<Vec<EventType>>,
    _limit: u32,
) -> Result<Vec<ProtocolEvent>> {
    // 简化实现：返回空结果
    let user_events = Vec::new();
    
    msg!("User event history query completed: {} events", user_events.len());
    Ok(user_events)
}

// ==================== 事件订阅管理指令 ====================

/// 创建事件订阅
#[derive(Accounts)]
pub struct SubscribeToEvents<'info> {
    #[account(mut)]
    pub event_emitter: Account<'info, EventEmitterAccount>,
    
    #[account(
        init,
        payer = subscriber,
        space = EventSubscriptionAccount::SPACE,
        seeds = [EVENT_SUBSCRIPTION_SEED, subscriber.key().as_ref()],
        bump
    )]
    pub event_subscription: Account<'info, EventSubscriptionAccount>,
    
    #[account(mut)]
    pub subscriber: Signer<'info>,
    
    pub system_program: Program<'info, System>,
}

pub fn subscribe_to_events(
    ctx: Context<SubscribeToEvents>,
    event_types: Vec<EventType>,
    filters: EventFilters,
    delivery_config: DeliveryConfig,
) -> Result<()> {
    let event_emitter = &mut ctx.accounts.event_emitter;
    let event_subscription = &mut ctx.accounts.event_subscription;
    
    // 验证订阅数量限制
    require!(
        event_emitter.subscription_count < MAX_SUBSCRIPTIONS_PER_USER as u64,
        AlchemeError::EventSubscriptionFailed
    );
    
    // 初始化订阅
    let bump = ctx.bumps.event_subscription;
    event_subscription.initialize(
        ctx.accounts.subscriber.key(),
        event_types,
        filters,
        delivery_config,
        bump,
    )?;
    
    // 更新发射器统计
    event_emitter.add_subscription()?;
    
    msg!("Event subscription created: {}", ctx.accounts.subscriber.key());
    Ok(())
}

/// 更新事件订阅
#[derive(Accounts)]
pub struct UpdateSubscription<'info> {
    #[account(
        mut,
        constraint = subscriber.key() == event_subscription.subscriber @ AlchemeError::Unauthorized
    )]
    pub event_subscription: Account<'info, EventSubscriptionAccount>,
    
    pub subscriber: Signer<'info>,
}

pub fn update_subscription(
    ctx: Context<UpdateSubscription>,
    new_event_types: Option<Vec<EventType>>,
    new_filters: Option<EventFilters>,
    new_delivery_config: Option<DeliveryConfig>,
) -> Result<()> {
    let event_subscription = &mut ctx.accounts.event_subscription;
    
    if let Some(event_types) = new_event_types {
        event_subscription.event_types = event_types;
    }
    
    if let Some(filters) = new_filters {
        event_subscription.filters = filters;
    }
    
    if let Some(delivery_config) = new_delivery_config {
        event_subscription.delivery_config = delivery_config;
    }
    
    msg!("Event subscription updated: {}", ctx.accounts.subscriber.key());
    Ok(())
}

/// 取消事件订阅
#[derive(Accounts)]
pub struct UnsubscribeFromEvents<'info> {
    #[account(mut)]
    pub event_emitter: Account<'info, EventEmitterAccount>,
    
    #[account(
        mut,
        close = subscriber,
        constraint = subscriber.key() == event_subscription.subscriber @ AlchemeError::Unauthorized
    )]
    pub event_subscription: Account<'info, EventSubscriptionAccount>,
    
    #[account(mut)]
    pub subscriber: Signer<'info>,
}

pub fn unsubscribe_from_events(
    ctx: Context<UnsubscribeFromEvents>,
) -> Result<()> {
    let event_emitter = &mut ctx.accounts.event_emitter;
    
    // 更新发射器统计
    event_emitter.remove_subscription()?;
    
    msg!("Event subscription cancelled: {}", ctx.accounts.subscriber.key());
    Ok(())
}

/// 暂停/恢复订阅
#[derive(Accounts)]
pub struct ToggleSubscription<'info> {
    #[account(
        mut,
        constraint = subscriber.key() == event_subscription.subscriber @ AlchemeError::Unauthorized
    )]
    pub event_subscription: Account<'info, EventSubscriptionAccount>,
    
    pub subscriber: Signer<'info>,
}

pub fn toggle_subscription(
    ctx: Context<ToggleSubscription>,
    active: bool,
) -> Result<()> {
    let event_subscription = &mut ctx.accounts.event_subscription;
    event_subscription.active = active;
    
    msg!("Subscription status toggled: {} -> {}",
         ctx.accounts.subscriber.key(),
         if active { "active" } else { "paused" });
    Ok(())
}

// ==================== 事件归档管理指令 ====================

/// 归档事件批次
#[derive(Accounts)]
pub struct ArchiveEventBatch<'info> {
    #[account(
        mut,
        constraint = admin.key() == event_emitter.admin @ AlchemeError::Unauthorized
    )]
    pub event_emitter: Account<'info, EventEmitterAccount>,
    
    #[account(mut)]
    pub event_batch: Account<'info, EventBatchAccount>,
    
    pub admin: Signer<'info>,
}

pub fn archive_event_batch(
    ctx: Context<ArchiveEventBatch>,
    batch_id: u64,
    arweave_tx_id: String,
) -> Result<()> {
    let event_batch = &mut ctx.accounts.event_batch;
    
    // 验证批次ID
    require!(
        event_batch.batch_id == batch_id,
        AlchemeError::InvalidOperation
    );
    
    // 标记为已归档
    event_batch.mark_archived(arweave_tx_id)?;
    
    msg!("Event batch archived: batch {}", batch_id);
    Ok(())
}

/// 清理过期事件
#[derive(Accounts)]
pub struct CleanupExpiredEvents<'info> {
    #[account(
        mut,
        constraint = admin.key() == event_emitter.admin @ AlchemeError::Unauthorized
    )]
    pub event_emitter: Account<'info, EventEmitterAccount>,
    
    pub admin: Signer<'info>,
}

pub fn cleanup_expired_events(
    _ctx: Context<CleanupExpiredEvents>,
    _cutoff_timestamp: i64,
) -> Result<u64> {
    // 简化实现：返回0
    let cleaned_count = 0u64;
    
    msg!("Expired event cleanup completed: {} events cleaned", cleaned_count);
    Ok(cleaned_count)
}

/// 获取归档统计
#[derive(Accounts)]
pub struct GetArchiveStats<'info> {
    pub event_emitter: Account<'info, EventEmitterAccount>,
}

pub fn get_archive_stats(
    _ctx: Context<GetArchiveStats>,
) -> Result<ArchiveStats> {
    // 简化实现：返回基本统计
    let stats = ArchiveStats {
        total_archived_batches: 0,
        total_archived_events: 0,
        archive_storage_used: 0,
        successful_archives: 0,
        failed_archives: 0,
        average_archive_time: 0.0,
        last_archive_time: 0,
    };
    
    Ok(stats)
}
