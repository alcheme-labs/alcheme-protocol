use anchor_lang::prelude::*;
use alcheme_shared::*;
use alcheme_cpi::{is_authorized_for_cpi_with_registry};
use crate::state::*;
use crate::validation::*;

// ==================== 注册表管理指令 ====================

/// 初始化身份注册表
#[derive(Accounts)]
#[instruction(registry_name: String, metadata_uri: String)]
pub struct InitializeIdentityRegistry<'info> {
    #[account(
        init,
        payer = admin,
        space = IdentityRegistryAccount::SPACE,
        seeds = [IDENTITY_REGISTRY_SEED, registry_name.as_bytes()],
        bump
    )]
    pub identity_registry: Box<Account<'info, IdentityRegistryAccount>>,
    
    #[account(mut)]
    pub admin: Signer<'info>,
    
    pub system_program: Program<'info, System>,
}

pub fn initialize_identity_registry(
    ctx: Context<InitializeIdentityRegistry>,
    registry_name: String,
    metadata_uri: String,
    settings: RegistrySettings,
) -> Result<()> {
    let identity_registry = &mut ctx.accounts.identity_registry;
    let bump = ctx.bumps.identity_registry;
    
    identity_registry.initialize(
        bump,
        ctx.accounts.admin.key(),
        registry_name.clone(),
        metadata_uri,
        settings,
    )?;
    
    msg!("身份注册表初始化成功: {}", registry_name);
    Ok(())
}

// ==================== 身份管理指令 ====================

/// 注册新身份
#[derive(Accounts)]
#[instruction(handle: String)]
pub struct RegisterIdentity<'info> {
    #[account(mut)]
    pub identity_registry: Box<Account<'info, IdentityRegistryAccount>>,
    
    #[account(
        init,
        payer = user,
        space = UserIdentityAccount::SPACE,
        seeds = [USER_IDENTITY_SEED, identity_registry.key().as_ref(), handle.as_bytes()],
        bump
    )]
    pub user_identity: Box<Account<'info, UserIdentityAccount>>,
    
    #[account(
        init,
        payer = user,
        space = HandleMappingAccount::SPACE,
        seeds = [HANDLE_MAPPING_SEED, handle.as_bytes()],
        bump
    )]
    pub handle_mapping: Box<Account<'info, HandleMappingAccount>>,
    
    #[account(mut)]
    pub user: Signer<'info>,
    
    pub system_program: Program<'info, System>,
    
    // Event emission accounts
    /// CHECK: Event Emitter program, validated by CPI helper
    pub event_program: AccountInfo<'info>,
    
    /// CHECK: Event Emitter account, validated by CPI helper
    #[account(mut)]
    pub event_emitter: AccountInfo<'info>,
    
    /// CHECK: Event Batch account, PDA validated by event emitter program
    #[account(mut)]
    pub event_batch: AccountInfo<'info>,
}

pub fn register_identity(
    ctx: Context<RegisterIdentity>,
    handle: String,
    privacy_settings: PrivacyConfig,
) -> Result<()> {
    // 验证用户名格式
    IdentityValidator::validate_handle(&handle)?;
    
    // 检查注册表状态
    require!(
        ctx.accounts.identity_registry.status == RegistryStatus::Active,
        AlchemeError::InvalidOperation
    );
    
    // 初始化用户身份
    let user_identity = &mut ctx.accounts.user_identity;
    user_identity.initialize(
        ctx.accounts.user.key(),
        handle.clone(),
        privacy_settings,
    )?;
    
    // 初始化用户名映射
    let handle_mapping = &mut ctx.accounts.handle_mapping;
    handle_mapping.initialize(
        handle.clone(),
        user_identity.key(),
        ctx.accounts.user.key(),
        true, // 第一个用户名总是主要用户名
    )?;
    
    // 更新注册表统计
    ctx.accounts.identity_registry.register_identity()?;
    ctx.accounts.identity_registry.register_handle()?;
    
    // 发射事件
    let event = ProtocolEvent::IdentityRegistered {
        registry_id: ctx.accounts.identity_registry.key(),
        identity_id: user_identity.key(),
        handle: handle.clone(),
        verification_level: user_identity.verification_level.clone(),
        timestamp: Clock::get()?.unix_timestamp,
    };
    
    alcheme_cpi::CpiHelper::emit_event_simple(
        &ctx.accounts.event_program,
        &mut ctx.accounts.event_emitter,
        &mut ctx.accounts.event_batch,
        &ctx.accounts.user.to_account_info(),
        &ctx.accounts.system_program.to_account_info(),
        &crate::ID,
        event,
    )?;
    
    msg!("身份注册成功: {} -> {}", handle, user_identity.key());
    Ok(())
}

/// 更新身份信息
#[derive(Accounts)]
pub struct UpdateIdentity<'info> {
    #[account(
        mut,
        constraint = user.key() == user_identity.identity_id @ AlchemeError::Unauthorized
    )]
    pub user_identity: Box<Account<'info, UserIdentityAccount>>,
    
    pub user: Signer<'info>,
    
    pub system_program: Program<'info, System>,
    
    // Event emission accounts
    /// CHECK: Event Emitter program
    pub event_program: AccountInfo<'info>,
    
    /// CHECK: Event Emitter account
    #[account(mut)]
    pub event_emitter: AccountInfo<'info>,
    
    /// CHECK: Event Batch account
    #[account(mut)]
    pub event_batch: AccountInfo<'info>,
}

pub fn update_identity(
    ctx: Context<UpdateIdentity>,
    updates: IdentityUpdates,
) -> Result<()> {
    let user_identity = &mut ctx.accounts.user_identity;
    let prepared = prepare_identity_profile_update(user_identity, &updates)?;

    realloc_identity_if_needed(
        user_identity.as_mut(),
        prepared.required_account_space,
        &ctx.accounts.user,
        &ctx.accounts.system_program,
    )?;
    user_identity.write_protocol_profile(&prepared.next_profile)?;

    // 更新最后活跃时间
    user_identity.update_last_active()?;

    if !prepared.updated_fields.is_empty() {
        let event = ProtocolEvent::ProfileUpdated {
            identity_id: user_identity.key(),
            update_type: prepared.update_type,
            updated_fields: prepared.updated_fields,
            timestamp: Clock::get()?.unix_timestamp,
        };

        alcheme_cpi::CpiHelper::emit_event_simple(
            &ctx.accounts.event_program,
            &mut ctx.accounts.event_emitter,
            &mut ctx.accounts.event_batch,
            &ctx.accounts.user.to_account_info(),
            &ctx.accounts.system_program.to_account_info(),
            &crate::ID,
            event,
        )?;
    }
    
    msg!("身份信息更新成功: {}", user_identity.key());
    Ok(())
}

fn realloc_identity_if_needed<'info>(
    user_identity: &mut Account<'info, UserIdentityAccount>,
    required_space: usize,
    payer: &Signer<'info>,
    system_program: &Program<'info, System>,
) -> Result<()> {
    let account_info = user_identity.to_account_info();
    let current_space = account_info.data_len();

    if required_space <= current_space {
        return Ok(());
    }

    let increase = required_space - current_space;
    require!(increase <= 10_240, AlchemeError::ProfileDataTooLarge);

    account_info.realloc(required_space, false)?;

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

    Ok(())
}

/// 添加验证属性
#[derive(Accounts)]
pub struct AddVerificationAttribute<'info> {
    #[account(mut)]
    pub user_identity: Box<Account<'info, UserIdentityAccount>>,
    
    pub verifier: Signer<'info>,
    
    pub system_program: Program<'info, System>,
    
    // Event emission accounts
    /// CHECK: Event Emitter program
    pub event_program: AccountInfo<'info>,
    
    /// CHECK: Event Emitter account
    #[account(mut)]
    pub event_emitter: AccountInfo<'info>,
    
    /// CHECK: Event Batch account
    #[account(mut)]
    pub event_batch: AccountInfo<'info>,
}

pub fn add_verification_attribute(
    ctx: Context<AddVerificationAttribute>,
    attribute: VerifiedAttribute,
) -> Result<()> {
    // 验证验证器权限
    IdentityValidator::validate_verifier_authority(&ctx.accounts.verifier.key())?;
    
    let user_identity = &mut ctx.accounts.user_identity;
    user_identity.add_verified_attribute(attribute.clone())?;
    user_identity.update_last_active()?;
    
    // 发射事件
    let event = ProtocolEvent::VerificationAttributeAdded {
        identity_id: user_identity.key(),
        attribute_type: attribute.attribute_type.clone(),
        verifier: ctx.accounts.verifier.key(),
        timestamp: Clock::get()?.unix_timestamp,
    };
    
    alcheme_cpi::CpiHelper::emit_event_simple(
        &ctx.accounts.event_program,
        &mut ctx.accounts.event_emitter,
        &mut ctx.accounts.event_batch,
        &ctx.accounts.verifier.to_account_info(),
        &ctx.accounts.system_program.to_account_info(),
        &crate::ID,
        event,
    )?;
    
    msg!("验证属性添加成功: {} for {}", 
         attribute.attribute_type, user_identity.key());
    Ok(())
}

/// 更新声誉分数（仅限授权程序CPI调用）
#[derive(Accounts)]
pub struct UpdateReputation<'info> {
    #[account(mut)]
    pub user_identity: Box<Account<'info, UserIdentityAccount>>,
    
    #[account(mut)]
    pub identity_registry: Box<Account<'info, IdentityRegistryAccount>>,
    
    pub authority: Signer<'info>,
}

pub fn update_reputation(
    ctx: Context<UpdateReputation>,
    reputation_delta: f64,
    trust_delta: f64,
    reason: String,
) -> Result<()> {
    use alcheme_shared::{CONTENT_MANAGER_ID, ACCESS_CONTROLLER_ID};
    
    let caller = ctx.accounts.authority.key();
    let registry_admin = ctx.accounts.identity_registry.admin;
    
    // 权限检查：授权程序 OR 注册表管理员（用于测试）
    let is_authorized = 
        caller == CONTENT_MANAGER_ID ||
        caller == ACCESS_CONTROLLER_ID ||
        caller == registry_admin;
    
    require!(is_authorized, AlchemeError::Unauthorized);
    
    let user_identity = &mut ctx.accounts.user_identity;
    user_identity.update_reputation(reputation_delta, trust_delta)?;
    user_identity.update_last_active()?;
    
    msg!("声誉更新成功: {} (reason: {})", user_identity.key(), reason);
    Ok(())
}

// ==================== 简化的查询指令 ====================

/// 验证身份 (CPI)
#[derive(Accounts)]
pub struct VerifyIdentity<'info> {
    pub user_identity: Box<Account<'info, UserIdentityAccount>>,
}

pub fn verify_identity(
    ctx: Context<VerifyIdentity>,
    identity_id: Pubkey,
) -> Result<UserIdentity> {
    let user_identity = &ctx.accounts.user_identity;
    
    // 验证身份ID匹配
    require!(
        user_identity.identity_id == identity_id,
        AlchemeError::IdentityNotFound
    );
    
    // 返回身份的副本
    Ok(UserIdentity {
        identity_id: user_identity.identity_id,
        primary_handle: user_identity.primary_handle.clone(),
        alternative_handles: user_identity.alternative_handles.clone(),
        created_at: user_identity.created_at,
        last_active: user_identity.last_active,
        verification_level: user_identity.verification_level.clone(),
        verified_attributes: user_identity.verified_attributes.clone(),
        verification_history: user_identity.verification_history.clone(),
        follower_count: user_identity.follower_count,
        following_count: user_identity.following_count,
        connection_strength: user_identity.connection_strength,
        social_rank: user_identity.social_rank,
        content_created: user_identity.content_created,
        total_interactions: user_identity.total_interactions,
        content_quality_score: user_identity.content_quality_score,
        reputation_score: user_identity.reputation_score,
        trust_score: user_identity.trust_score,
        community_standing: user_identity.community_standing.clone(),
        tokens_earned: user_identity.tokens_earned,
        tokens_spent: user_identity.tokens_spent,
        economic_activity_score: user_identity.economic_activity_score,
        last_economic_activity: user_identity.last_economic_activity,
        privacy_settings: user_identity.privacy_settings.clone(),
        notification_preferences: user_identity.notification_preferences.clone(),
        display_preferences: user_identity.display_preferences.clone(),
        metadata_uri: user_identity.metadata_uri.clone(),
        custom_attributes: user_identity.custom_attributes.clone(),
        app_specific_data: user_identity.app_specific_data.clone(),
    })
}

/// 获取用户声誉 (CPI)
#[derive(Accounts)]
pub struct GetUserReputation<'info> {
    pub user_identity: Box<Account<'info, UserIdentityAccount>>,
}

pub fn get_user_reputation(
    ctx: Context<GetUserReputation>,
    identity_id: Pubkey,
) -> Result<(f64, f64)> {
    let user_identity = &ctx.accounts.user_identity;
    
    // 验证身份ID匹配
    require!(
        user_identity.identity_id == identity_id,
        AlchemeError::IdentityNotFound
    );
    
    Ok((user_identity.reputation_score, user_identity.trust_score))
}

/// 检查用户名可用性 (CPI)
#[derive(Accounts)]
#[instruction(handle: String)]
pub struct CheckHandleAvailability<'info> {
    #[account(
        seeds = [HANDLE_MAPPING_SEED, handle.as_bytes()],
        bump
    )]
    pub handle_mapping: Option<Box<Account<'info, HandleMappingAccount>>>,
}

pub fn check_handle_availability(
    ctx: Context<CheckHandleAvailability>,
    handle: String,
) -> Result<bool> {
    // 验证用户名格式
    IdentityValidator::validate_handle(&handle)?;
    
    // 检查是否已存在
    match &ctx.accounts.handle_mapping {
        Some(mapping) => {
            // 检查是否过期的预留
            if mapping.is_reserved {
                if let Some(reservation) = &mapping.reservation_data {
                    let current_time = Clock::get()?.unix_timestamp;
                    let is_expired = current_time > reservation.reserved_at + reservation.reservation_period;
                    Ok(is_expired)
                } else {
                    Ok(false)
                }
            } else {
                Ok(false) // 已注册
            }
        }
        None => Ok(true), // 可用
    }
}

/// 获取身份信息 (CPI)
#[derive(Accounts)]
pub struct GetIdentityInfo<'info> {
    pub user_identity: Box<Account<'info, UserIdentityAccount>>,
}

pub fn get_identity_info(
    ctx: Context<GetIdentityInfo>,
    identity_id: Pubkey,
) -> Result<UserIdentity> {
    let user_identity = &ctx.accounts.user_identity;
    
    // 验证身份ID匹配
    require!(
        user_identity.identity_id == identity_id,
        AlchemeError::IdentityNotFound
    );
    
    // 返回身份信息副本
    Ok(UserIdentity {
        identity_id: user_identity.identity_id,
        primary_handle: user_identity.primary_handle.clone(),
        alternative_handles: user_identity.alternative_handles.clone(),
        created_at: user_identity.created_at,
        last_active: user_identity.last_active,
        verification_level: user_identity.verification_level.clone(),
        verified_attributes: user_identity.verified_attributes.clone(),
        verification_history: user_identity.verification_history.clone(),
        follower_count: user_identity.follower_count,
        following_count: user_identity.following_count,
        connection_strength: user_identity.connection_strength,
        social_rank: user_identity.social_rank,
        content_created: user_identity.content_created,
        total_interactions: user_identity.total_interactions,
        content_quality_score: user_identity.content_quality_score,
        reputation_score: user_identity.reputation_score,
        trust_score: user_identity.trust_score,
        community_standing: user_identity.community_standing.clone(),
        tokens_earned: user_identity.tokens_earned,
        tokens_spent: user_identity.tokens_spent,
        economic_activity_score: user_identity.economic_activity_score,
        last_economic_activity: user_identity.last_economic_activity,
        privacy_settings: user_identity.privacy_settings.clone(),
        notification_preferences: user_identity.notification_preferences.clone(),
        display_preferences: user_identity.display_preferences.clone(),
        metadata_uri: user_identity.metadata_uri.clone(),
        custom_attributes: user_identity.custom_attributes.clone(),
        app_specific_data: user_identity.app_specific_data.clone(),
    })
}

// ==================== 社交统计指令 ====================

/// 更新社交统计
#[derive(Accounts)]
pub struct UpdateSocialStats<'info> {
    #[account(mut)]
    pub user_identity: Box<Account<'info, UserIdentityAccount>>,
    
    /// CHECK: 权限由调用程序验证
    pub caller_program: AccountInfo<'info>,
}

pub fn update_social_stats(
    ctx: Context<UpdateSocialStats>,
    follower_delta: i64,
    following_delta: i64,
) -> Result<()> {
    let user_identity = &mut ctx.accounts.user_identity;
    user_identity.update_social_stats(follower_delta, following_delta)?;
    user_identity.update_last_active()?;
    
    msg!("社交统计更新成功: {}", user_identity.key());
    Ok(())
}

/// 更新经济统计
#[derive(Accounts)]
pub struct UpdateEconomicStats<'info> {
    #[account(mut)]
    pub user_identity: Box<Account<'info, UserIdentityAccount>>,
    
    /// CHECK: 权限由调用程序验证
    pub caller_program: AccountInfo<'info>,
}

pub fn update_economic_stats(
    ctx: Context<UpdateEconomicStats>,
    tokens_earned_delta: u64,
    tokens_spent_delta: u64,
) -> Result<()> {
    let user_identity = &mut ctx.accounts.user_identity;
    user_identity.update_economic_stats(tokens_earned_delta, tokens_spent_delta)?;
    user_identity.update_last_active()?;
    
    msg!("经济统计更新成功: {}", user_identity.key());
    Ok(())
}

/// 更新内容创作统计
#[derive(Accounts)]
pub struct UpdateContentStats<'info> {
    #[account(mut)]
    pub user_identity: Box<Account<'info, UserIdentityAccount>>,
    
    /// CHECK: 权限由调用程序验证
    pub caller_program: AccountInfo<'info>,
}

pub fn update_content_stats(
    ctx: Context<UpdateContentStats>,
    content_created_delta: u64,
    interactions_delta: u64,
    quality_score_update: f64,
) -> Result<()> {
    let user_identity = &mut ctx.accounts.user_identity;
    user_identity.update_content_stats(content_created_delta, interactions_delta, quality_score_update)?;
    user_identity.update_last_active()?;
    
    msg!("内容统计更新成功: {}", user_identity.key());
    Ok(())
}

// ==================== Extension CPI 接口 ====================

/// 通过扩展程序更新声誉（需要 ExtensionRegistry 中的 ReputationWrite 权限）
#[derive(Accounts)]
pub struct UpdateReputationByExtension<'info> {
    #[account(mut)]
    pub user_identity: Box<Account<'info, UserIdentityAccount>>,

    #[account(mut)]
    pub identity_registry: Box<Account<'info, IdentityRegistryAccount>>,

    /// CHECK: 调用的扩展程序 ID，用于权限检查
    pub caller_program: AccountInfo<'info>,

    /// CHECK: ExtensionRegistry PDA，由 registry-factory 管理
    pub extension_registry: AccountInfo<'info>,

    pub authority: Signer<'info>,
}

pub fn update_reputation_by_extension(
    ctx: Context<UpdateReputationByExtension>,
    reputation_delta: f64,
    trust_delta: f64,
    reason: String,
) -> Result<()> {
    // 通过 ExtensionRegistry 验证调用者权限
    alcheme_cpi::require_cpi_permission_with_registry!(
        &ctx.accounts.caller_program.key(),
        alcheme_cpi::CpiPermission::ReputationWrite,
        Some(&ctx.accounts.extension_registry)
    );

    let user_identity = &mut ctx.accounts.user_identity;
    user_identity.update_reputation(reputation_delta, trust_delta)?;
    user_identity.update_last_active()?;

    msg!("Extension 声誉更新成功: {} (reason: {}, caller: {})",
         user_identity.key(), reason, ctx.accounts.caller_program.key());
    Ok(())
}
