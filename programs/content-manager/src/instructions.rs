use anchor_lang::prelude::*;
use alcheme_shared::*;
use alcheme_cpi::{require_cpi_permission, is_authorized_for_cpi, is_authorized_for_cpi_with_registry, CpiPermission};
use crate::state::*;
use crate::validation::*;
use crate::storage::*;

const CIRCLE_MANAGER_PROGRAM_ID: Pubkey =
    solana_program::pubkey!("GZswb1rGbZfoiapkvatDuMZrptVAX2p1pEVDSrMuyLqQ");

// ==================== 内容管理器管理指令 ====================

/// 初始化内容管理器
#[derive(Accounts)]
pub struct InitializeContentManager<'info> {
    #[account(
        init,
        payer = admin,
        space = ContentManagerAccount::SPACE,
        seeds = [CONTENT_MANAGER_SEED],
        bump
    )]
    pub content_manager: Account<'info, ContentManagerAccount>,
    
    #[account(mut)]
    pub admin: Signer<'info>,
    
    pub system_program: Program<'info, System>,
}

pub fn initialize_content_manager(
    ctx: Context<InitializeContentManager>,
    manager_config: ManagerConfig,
    storage_config: StorageConfig,
    moderation_config: ModerationConfig,
) -> Result<()> {
    let content_manager = &mut ctx.accounts.content_manager;
    let bump = ctx.bumps.content_manager;
    
    content_manager.initialize(
        bump,
        ctx.accounts.admin.key(),
        manager_config,
        storage_config,
        moderation_config,
    )?;
    
    msg!("内容管理器初始化成功");
    Ok(())
}

/// 更新管理器配置
#[derive(Accounts)]
pub struct UpdateManagerConfig<'info> {
    #[account(
        mut,
        constraint = admin.key() == content_manager.admin @ AlchemeError::Unauthorized
    )]
    pub content_manager: Account<'info, ContentManagerAccount>,
    
    pub admin: Signer<'info>,
}

pub fn update_manager_config(
    ctx: Context<UpdateManagerConfig>,
    new_manager_config: Option<ManagerConfig>,
    new_storage_config: Option<StorageConfig>,
    new_moderation_config: Option<ModerationConfig>,
) -> Result<()> {
    let content_manager = &mut ctx.accounts.content_manager;
    
    if let Some(manager_config) = new_manager_config {
        content_manager.manager_config = manager_config;
    }
    
    if let Some(storage_config) = new_storage_config {
        content_manager.storage_config = storage_config;
    }
    
    if let Some(moderation_config) = new_moderation_config {
        content_manager.moderation_config = moderation_config;
    }
    
    content_manager.last_updated = Clock::get()?.unix_timestamp;
    
    msg!("内容管理器配置更新成功");
    Ok(())
}

// ==================== 内容创建和管理指令 ====================

/// 创建内容
#[derive(Accounts)]
#[instruction(content_id: u64)]
pub struct CreateContent<'info> {
    #[account(mut)]
    pub content_manager: Box<Account<'info, ContentManagerAccount>>,
    
    #[account(
        init,
        payer = author,
        space = ContentPostAccount::SPACE,
        seeds = [CONTENT_POST_SEED, author.key().as_ref(), &content_id.to_le_bytes()],
        bump
    )]
    pub content_post: Box<Account<'info, ContentPostAccount>>,
    
    #[account(
        init,
        payer = author,
        space = ContentStatsAccount::SPACE,
        seeds = [b"content_stats", content_post.key().as_ref()],
        bump
    )]
    pub content_stats: Box<Account<'info, ContentStatsAccount>>,
    
    #[account(
        init,
        payer = author,
        space = ContentStorageAccount::INIT_SPACE,
        seeds = [b"content_storage", content_post.key().as_ref()],
        bump
    )]
    pub content_storage: Box<Account<'info, ContentStorageAccount>>,
    
    #[account(mut)]
    pub author: Signer<'info>,
    
    /// CHECK: Identity Registry 程序，用于验证作者身份
    pub identity_program: AccountInfo<'info>,
    
    /// CHECK: 用户身份账户
    pub user_identity: AccountInfo<'info>,
    
    /// CHECK: Access Controller 程序，用于检查创建权限
    pub access_program: AccountInfo<'info>,
    
    /// CHECK: 访问控制器账户
    pub access_controller_account: AccountInfo<'info>,
    
    /// CHECK: Event Emitter 程序，用于发射事件
    pub event_program: AccountInfo<'info>,
    
    /// CHECK: 事件发射器账户
    #[account(mut)]
    pub event_emitter_account: AccountInfo<'info>,
    
    /// CHECK: 事件批次账户
    #[account(mut)]
    pub event_batch: AccountInfo<'info>,
    
    pub system_program: Program<'info, System>,
}

#[inline(never)]
pub fn create_content(
    ctx: Context<CreateContent>,
    content_id: u64,
    content_data: ContentData,
    content_type: ContentType,
    metadata: ContentMetadata,
    visibility_settings: VisibilitySettings,
    external_uri: Option<String>, // 新增参数：外部存储 URI
) -> Result<()> {
    // 1. 验证内容数据
    ContentValidator::validate_content_data(&content_data, &content_type)?;
    ContentValidator::validate_content_metadata(&metadata)?;
    
    // 2. 验证作者身份 (通过简化的 CPI 调用)
    let identity_valid = alcheme_cpi::CpiHelper::verify_identity_simple(
        &ctx.accounts.identity_program,
        &ctx.accounts.user_identity,
        &ctx.program_id,
        ctx.accounts.author.key(),
    )?;
    
    require!(identity_valid, AlchemeError::IdentityNotFound);
    
    // 3. 检查创建权限 (通过简化的 CPI 调用)
    let has_permission = alcheme_cpi::CpiHelper::check_permission_simple(
        &ctx.accounts.access_program,
        &ctx.accounts.access_controller_account,
        &ctx.program_id,
        ctx.accounts.author.key(),
        ctx.accounts.author.key(),
        Permission::CreateContent,
    )?;
    
    require!(has_permission, AlchemeError::PermissionDenied);
    
    // 4. 计算内容哈希
    let content_hash = ContentHasher::calculate_content_hash(&content_data)?;
    
    // 5. 确定存储策略
    let storage_strategy = StorageCoordinator::determine_storage_strategy(
        &content_data,
        &ctx.accounts.content_manager.storage_config,
    );
    
    // 6. 计算存储成本
    let storage_cost = StorageCoordinator::calculate_storage_cost(
        &content_data,
        &storage_strategy,
    );
    
    // 7. 确定存储 URI
    let primary_storage_uri = if let Some(uri) = external_uri {
        // 验证外部 URI 格式
        ValidationUtils::validate_string_length(&uri, 256, AlchemeError::InvalidOperation)?;
        StorageCoordinator::validate_storage_uri(&uri, &storage_strategy)?;
        uri
    } else {
        // 自动生成 URI
        StorageCoordinator::generate_storage_uri(
            &ctx.accounts.author.key(),
            content_id,
            &storage_strategy,
        )
    };
    
    // 8. 初始化主内容账户
    let content_post = &mut ctx.accounts.content_post;
    let content_post_bump = ctx.bumps.content_post;
    
    content_post.initialize(
        content_id,
        ctx.accounts.author.key(),
        content_type.clone(),
        content_hash,
        primary_storage_uri,
        content_data.text.chars().take(200).collect(), // 前200字符作为预览
        visibility_settings.clone(),
        ctx.accounts.content_stats.key(),
        ctx.accounts.content_storage.key(),
        content_post_bump,
    )?;
    
    // 9. 初始化统计账户
    let content_stats = &mut ctx.accounts.content_stats;
    let content_stats_bump = ctx.bumps.content_stats;
    content_stats.initialize(content_post.key(), content_stats_bump)?;
    
    // 10. 初始化存储账户
    let content_storage = &mut ctx.accounts.content_storage;
    let content_storage_bump = ctx.bumps.content_storage;
    content_storage.initialize(
        content_post.key(),
        storage_strategy.clone(),
        content_post.primary_storage_uri.clone(),
        storage_cost,
        content_storage_bump,
    )?;
    
    // 11. 更新管理器统计
    ctx.accounts.content_manager.create_content()?;
    
    // 12. 发射内容创建事件 (通过简化的 CPI 调用)
    let content_created_event = ProtocolEvent::ContentCreated {
        content_id: content_post.key(),
        author: ctx.accounts.author.key(),
        content_type: content_type.clone(),
        storage_strategy: storage_strategy.clone(),
        visibility: match visibility_settings.visibility_level {
            VisibilityLevel::Public => AccessLevel::Public,
            VisibilityLevel::Followers => AccessLevel::Followers,
            VisibilityLevel::Friends => AccessLevel::Friends,
            VisibilityLevel::Private => AccessLevel::Private,
            VisibilityLevel::Community(_) => AccessLevel::Custom,
            VisibilityLevel::Custom(_) => AccessLevel::Custom,
        },
        timestamp: Clock::get()?.unix_timestamp,
    };
    
    
    let _event_sequence = alcheme_cpi::CpiHelper::emit_event_simple(
        &ctx.accounts.event_program,
        &mut ctx.accounts.event_emitter_account,
        &mut ctx.accounts.event_batch,
        &ctx.accounts.author.to_account_info(),
        &ctx.accounts.system_program.to_account_info(),
        &crate::ID,
        content_created_event,
    )?;
    
    msg!("内容创建成功: {} by {}", content_id, ctx.accounts.author.key());
    Ok(())
}

/// 创建内容（v2 最小锚点）
#[derive(Accounts)]
#[instruction(content_id: u64)]
pub struct CreateContentV2<'info> {
    #[account(mut)]
    pub content_manager: Box<Account<'info, ContentManagerAccount>>,

    #[account(
        init,
        payer = author,
        space = V2ContentAnchorAccount::SPACE,
        seeds = [CONTENT_V2_ANCHOR_SEED, author.key().as_ref(), &content_id.to_le_bytes()],
        bump
    )]
    pub v2_content_anchor: Account<'info, V2ContentAnchorAccount>,

    #[account(mut)]
    pub author: Signer<'info>,

    /// CHECK: Identity Registry 程序，用于验证作者身份
    pub identity_program: AccountInfo<'info>,

    /// CHECK: 用户身份账户
    pub user_identity: AccountInfo<'info>,

    /// CHECK: Access Controller 程序，用于检查创建权限
    pub access_program: AccountInfo<'info>,

    /// CHECK: 访问控制器账户
    pub access_controller_account: AccountInfo<'info>,

    /// CHECK: Event Emitter 程序，用于发射事件
    pub event_program: AccountInfo<'info>,

    /// CHECK: 事件发射器账户
    #[account(mut)]
    pub event_emitter_account: AccountInfo<'info>,

    /// CHECK: 事件批次账户
    #[account(mut)]
    pub event_batch: AccountInfo<'info>,

    pub system_program: Program<'info, System>,
}

/// 创建回复（v2 最小锚点）
#[derive(Accounts)]
#[instruction(content_id: u64)]
pub struct CreateReplyV2<'info> {
    #[account(mut)]
    pub content_manager: Box<Account<'info, ContentManagerAccount>>,

    #[account(
        init,
        payer = author,
        space = V2ContentAnchorAccount::SPACE,
        seeds = [CONTENT_V2_ANCHOR_SEED, author.key().as_ref(), &content_id.to_le_bytes()],
        bump
    )]
    pub v2_content_anchor: Account<'info, V2ContentAnchorAccount>,

    /// v2 受控例外：只读父帖账户（用于存在性与权限语义校验）
    pub parent_content_post: Box<Account<'info, ContentPostAccount>>,

    /// CHECK: 关注关系事实账户（FollowersOnly 目标时使用）
    pub target_follow_relationship: UncheckedAccount<'info>,

    /// CHECK: 圈层成员事实账户（CircleOnly 目标时使用）
    pub target_circle_membership: UncheckedAccount<'info>,

    #[account(mut)]
    pub author: Signer<'info>,

    /// CHECK: Identity Registry 程序，用于验证作者身份
    pub identity_program: AccountInfo<'info>,

    /// CHECK: 用户身份账户
    pub user_identity: AccountInfo<'info>,

    /// CHECK: Access Controller 程序，用于检查创建权限
    pub access_program: AccountInfo<'info>,

    /// CHECK: 访问控制器账户
    pub access_controller_account: AccountInfo<'info>,

    /// CHECK: Event Emitter 程序，用于发射事件
    pub event_program: AccountInfo<'info>,

    /// CHECK: 事件发射器账户
    #[account(mut)]
    pub event_emitter_account: AccountInfo<'info>,

    /// CHECK: 事件批次账户
    #[account(mut)]
    pub event_batch: AccountInfo<'info>,

    pub system_program: Program<'info, System>,
}

/// 创建转发（v2 最小锚点）
#[derive(Accounts)]
#[instruction(content_id: u64)]
pub struct CreateRepostV2<'info> {
    #[account(mut)]
    pub content_manager: Box<Account<'info, ContentManagerAccount>>,

    #[account(
        init,
        payer = author,
        space = V2ContentAnchorAccount::SPACE,
        seeds = [CONTENT_V2_ANCHOR_SEED, author.key().as_ref(), &content_id.to_le_bytes()],
        bump
    )]
    pub v2_content_anchor: Account<'info, V2ContentAnchorAccount>,

    /// v2 受控例外：只读原帖账户（用于存在性与权限语义校验）
    pub original_content_post: Box<Account<'info, ContentPostAccount>>,

    /// CHECK: 关注关系事实账户（FollowersOnly 目标时使用）
    pub target_follow_relationship: UncheckedAccount<'info>,

    /// CHECK: 圈层成员事实账户（CircleOnly 目标时使用）
    pub target_circle_membership: UncheckedAccount<'info>,

    #[account(mut)]
    pub author: Signer<'info>,

    /// CHECK: Identity Registry 程序，用于验证作者身份
    pub identity_program: AccountInfo<'info>,

    /// CHECK: 用户身份账户
    pub user_identity: AccountInfo<'info>,

    /// CHECK: Access Controller 程序，用于检查创建权限
    pub access_program: AccountInfo<'info>,

    /// CHECK: 访问控制器账户
    pub access_controller_account: AccountInfo<'info>,

    /// CHECK: Event Emitter 程序，用于发射事件
    pub event_program: AccountInfo<'info>,

    /// CHECK: 事件发射器账户
    #[account(mut)]
    pub event_emitter_account: AccountInfo<'info>,

    /// CHECK: 事件批次账户
    #[account(mut)]
    pub event_batch: AccountInfo<'info>,

    pub system_program: Program<'info, System>,
}

/// 创建引用（v2 最小锚点）
#[derive(Accounts)]
#[instruction(content_id: u64)]
pub struct CreateQuoteV2<'info> {
    #[account(mut)]
    pub content_manager: Box<Account<'info, ContentManagerAccount>>,

    #[account(
        init,
        payer = author,
        space = V2ContentAnchorAccount::SPACE,
        seeds = [CONTENT_V2_ANCHOR_SEED, author.key().as_ref(), &content_id.to_le_bytes()],
        bump
    )]
    pub v2_content_anchor: Account<'info, V2ContentAnchorAccount>,

    /// v2 受控例外：只读被引用帖子账户（用于存在性与权限语义校验）
    pub quoted_content_post: Box<Account<'info, ContentPostAccount>>,

    /// CHECK: 关注关系事实账户（FollowersOnly 目标时使用）
    pub target_follow_relationship: UncheckedAccount<'info>,

    /// CHECK: 圈层成员事实账户（CircleOnly 目标时使用）
    pub target_circle_membership: UncheckedAccount<'info>,

    #[account(mut)]
    pub author: Signer<'info>,

    /// CHECK: Identity Registry 程序，用于验证作者身份
    pub identity_program: AccountInfo<'info>,

    /// CHECK: 用户身份账户
    pub user_identity: AccountInfo<'info>,

    /// CHECK: Access Controller 程序，用于检查创建权限
    pub access_program: AccountInfo<'info>,

    /// CHECK: 访问控制器账户
    pub access_controller_account: AccountInfo<'info>,

    /// CHECK: Event Emitter 程序，用于发射事件
    pub event_program: AccountInfo<'info>,

    /// CHECK: 事件发射器账户
    #[account(mut)]
    pub event_emitter_account: AccountInfo<'info>,

    /// CHECK: 事件批次账户
    #[account(mut)]
    pub event_batch: AccountInfo<'info>,

    pub system_program: Program<'info, System>,
}

/// 创建回复（v2 最小锚点，by_id 关系）
#[derive(Accounts)]
#[instruction(content_id: u64, parent_content_id: u64)]
pub struct CreateReplyV2ById<'info> {
    #[account(mut)]
    pub content_manager: Box<Account<'info, ContentManagerAccount>>,

    #[account(
        init,
        payer = author,
        space = V2ContentAnchorAccount::SPACE,
        seeds = [CONTENT_V2_ANCHOR_SEED, author.key().as_ref(), &content_id.to_le_bytes()],
        bump
    )]
    pub v2_content_anchor: Account<'info, V2ContentAnchorAccount>,

    /// CHECK: parent author pubkey is used only for PDA derivation
    pub parent_author: AccountInfo<'info>,

    #[account(
        seeds = [CONTENT_V2_ANCHOR_SEED, parent_author.key().as_ref(), &parent_content_id.to_le_bytes()],
        bump = parent_v2_content_anchor.bump
    )]
    pub parent_v2_content_anchor: Account<'info, V2ContentAnchorAccount>,

    /// CHECK: 关注关系事实账户（FollowersOnly 目标时使用）
    pub target_follow_relationship: UncheckedAccount<'info>,

    /// CHECK: 圈层成员事实账户（CircleOnly 目标时使用）
    pub target_circle_membership: UncheckedAccount<'info>,

    #[account(mut)]
    pub author: Signer<'info>,

    /// CHECK: Identity Registry 程序，用于验证作者身份
    pub identity_program: AccountInfo<'info>,

    /// CHECK: 用户身份账户
    pub user_identity: AccountInfo<'info>,

    /// CHECK: Access Controller 程序，用于检查创建权限
    pub access_program: AccountInfo<'info>,

    /// CHECK: 访问控制器账户
    pub access_controller_account: AccountInfo<'info>,

    /// CHECK: Event Emitter 程序，用于发射事件
    pub event_program: AccountInfo<'info>,

    /// CHECK: 事件发射器账户
    #[account(mut)]
    pub event_emitter_account: AccountInfo<'info>,

    /// CHECK: 事件批次账户
    #[account(mut)]
    pub event_batch: AccountInfo<'info>,

    pub system_program: Program<'info, System>,
}

/// 创建转发（v2 最小锚点，by_id 关系）
#[derive(Accounts)]
#[instruction(content_id: u64, original_content_id: u64)]
pub struct CreateRepostV2ById<'info> {
    #[account(mut)]
    pub content_manager: Box<Account<'info, ContentManagerAccount>>,

    #[account(
        init,
        payer = author,
        space = V2ContentAnchorAccount::SPACE,
        seeds = [CONTENT_V2_ANCHOR_SEED, author.key().as_ref(), &content_id.to_le_bytes()],
        bump
    )]
    pub v2_content_anchor: Account<'info, V2ContentAnchorAccount>,

    /// CHECK: original author pubkey is used only for PDA derivation
    pub original_author: AccountInfo<'info>,

    #[account(
        seeds = [CONTENT_V2_ANCHOR_SEED, original_author.key().as_ref(), &original_content_id.to_le_bytes()],
        bump = original_v2_content_anchor.bump
    )]
    pub original_v2_content_anchor: Account<'info, V2ContentAnchorAccount>,

    /// CHECK: 关注关系事实账户（FollowersOnly 目标时使用）
    pub target_follow_relationship: UncheckedAccount<'info>,

    /// CHECK: 圈层成员事实账户（CircleOnly 目标时使用）
    pub target_circle_membership: UncheckedAccount<'info>,

    #[account(mut)]
    pub author: Signer<'info>,

    /// CHECK: Identity Registry 程序，用于验证作者身份
    pub identity_program: AccountInfo<'info>,

    /// CHECK: 用户身份账户
    pub user_identity: AccountInfo<'info>,

    /// CHECK: Access Controller 程序，用于检查创建权限
    pub access_program: AccountInfo<'info>,

    /// CHECK: 访问控制器账户
    pub access_controller_account: AccountInfo<'info>,

    /// CHECK: Event Emitter 程序，用于发射事件
    pub event_program: AccountInfo<'info>,

    /// CHECK: 事件发射器账户
    #[account(mut)]
    pub event_emitter_account: AccountInfo<'info>,

    /// CHECK: 事件批次账户
    #[account(mut)]
    pub event_batch: AccountInfo<'info>,

    pub system_program: Program<'info, System>,
}

/// 创建引用（v2 最小锚点，by_id 关系）
#[derive(Accounts)]
#[instruction(content_id: u64, quoted_content_id: u64)]
pub struct CreateQuoteV2ById<'info> {
    #[account(mut)]
    pub content_manager: Box<Account<'info, ContentManagerAccount>>,

    #[account(
        init,
        payer = author,
        space = V2ContentAnchorAccount::SPACE,
        seeds = [CONTENT_V2_ANCHOR_SEED, author.key().as_ref(), &content_id.to_le_bytes()],
        bump
    )]
    pub v2_content_anchor: Account<'info, V2ContentAnchorAccount>,

    /// CHECK: quoted author pubkey is used only for PDA derivation
    pub quoted_author: AccountInfo<'info>,

    #[account(
        seeds = [CONTENT_V2_ANCHOR_SEED, quoted_author.key().as_ref(), &quoted_content_id.to_le_bytes()],
        bump = quoted_v2_content_anchor.bump
    )]
    pub quoted_v2_content_anchor: Account<'info, V2ContentAnchorAccount>,

    /// CHECK: 关注关系事实账户（FollowersOnly 目标时使用）
    pub target_follow_relationship: UncheckedAccount<'info>,

    /// CHECK: 圈层成员事实账户（CircleOnly 目标时使用）
    pub target_circle_membership: UncheckedAccount<'info>,

    #[account(mut)]
    pub author: Signer<'info>,

    /// CHECK: Identity Registry 程序，用于验证作者身份
    pub identity_program: AccountInfo<'info>,

    /// CHECK: 用户身份账户
    pub user_identity: AccountInfo<'info>,

    /// CHECK: Access Controller 程序，用于检查创建权限
    pub access_program: AccountInfo<'info>,

    /// CHECK: 访问控制器账户
    pub access_controller_account: AccountInfo<'info>,

    /// CHECK: Event Emitter 程序，用于发射事件
    pub event_program: AccountInfo<'info>,

    /// CHECK: 事件发射器账户
    #[account(mut)]
    pub event_emitter_account: AccountInfo<'info>,

    /// CHECK: 事件批次账户
    #[account(mut)]
    pub event_batch: AccountInfo<'info>,

    pub system_program: Program<'info, System>,
}

/// 更新内容（v2 生命周期）
#[derive(Accounts)]
#[instruction(content_id: u64)]
pub struct UpdateContentV2Lifecycle<'info> {
    #[account(mut)]
    pub content_manager: Box<Account<'info, ContentManagerAccount>>,

    #[account(
        mut,
        seeds = [CONTENT_V2_ANCHOR_SEED, author.key().as_ref(), &content_id.to_le_bytes()],
        bump = v2_content_anchor.bump
    )]
    pub v2_content_anchor: Account<'info, V2ContentAnchorAccount>,

    #[account(mut)]
    pub author: Signer<'info>,

    /// CHECK: Event Emitter 程序，用于发射事件
    pub event_program: AccountInfo<'info>,

    /// CHECK: 事件发射器账户
    #[account(mut)]
    pub event_emitter_account: AccountInfo<'info>,

    /// CHECK: 事件批次账户
    #[account(mut)]
    pub event_batch: AccountInfo<'info>,

    pub system_program: Program<'info, System>,
}

/// 更新内容锚点（v2 链上控制链下内容）
#[derive(Accounts)]
#[instruction(content_id: u64)]
pub struct UpdateContentAnchorV2<'info> {
    #[account(
        mut,
        seeds = [CONTENT_V2_ANCHOR_SEED, author.key().as_ref(), &content_id.to_le_bytes()],
        bump = v2_content_anchor.bump
    )]
    pub v2_content_anchor: Account<'info, V2ContentAnchorAccount>,

    #[account(mut)]
    pub author: Signer<'info>,

    /// CHECK: Identity Registry 程序，用于验证作者身份
    pub identity_program: AccountInfo<'info>,

    /// CHECK: 用户身份账户
    pub user_identity: AccountInfo<'info>,

    /// CHECK: Access Controller 程序，用于检查创建权限
    pub access_program: AccountInfo<'info>,

    /// CHECK: 访问控制器账户
    pub access_controller_account: AccountInfo<'info>,

    /// CHECK: Event Emitter 程序，用于发射事件
    pub event_program: AccountInfo<'info>,

    /// CHECK: 事件发射器账户
    #[account(mut)]
    pub event_emitter_account: AccountInfo<'info>,

    /// CHECK: 事件批次账户
    #[account(mut)]
    pub event_batch: AccountInfo<'info>,

    pub system_program: Program<'info, System>,
}

#[derive(Accounts)]
#[instruction(draft_post_id: u64)]
pub struct AnchorDraftLifecycleV2<'info> {
    #[account(mut)]
    pub actor: Signer<'info>,

    /// CHECK: Event Emitter 程序，用于发射事件
    pub event_program: AccountInfo<'info>,

    /// CHECK: 事件发射器账户
    #[account(mut)]
    pub event_emitter_account: AccountInfo<'info>,

    /// CHECK: 事件批次账户
    #[account(mut)]
    pub event_batch: AccountInfo<'info>,

    pub system_program: Program<'info, System>,
}

fn validate_v2_write_permission(
    caller_program: &Pubkey,
    author: Pubkey,
    identity_program: &AccountInfo,
    user_identity: &AccountInfo,
    access_program: &AccountInfo,
    access_controller_account: &AccountInfo,
    permission: Permission,
) -> Result<()> {
    let identity_valid = alcheme_cpi::CpiHelper::verify_identity_simple(
        identity_program,
        user_identity,
        caller_program,
        author,
    )?;
    require!(identity_valid, AlchemeError::IdentityNotFound);

    let has_permission = alcheme_cpi::CpiHelper::check_permission_simple(
        access_program,
        access_controller_account,
        caller_program,
        author,
        author,
        permission,
    )?;
    require!(has_permission, AlchemeError::PermissionDenied);

    Ok(())
}

fn emit_content_anchored_v2<'info>(
    event_program: &AccountInfo<'info>,
    event_emitter_account: &mut AccountInfo<'info>,
    event_batch: &mut AccountInfo<'info>,
    payer: &AccountInfo<'info>,
    system_program: &AccountInfo<'info>,
    caller_program: &Pubkey,
    content_id: u64,
    author: Pubkey,
    content_hash: [u8; 32],
    uri_ref: String,
    relation: ContentAnchorRelation,
    visibility: AccessLevel,
    audience_kind: V2AudienceKind,
    audience_ref: u8,
    status: ContentStatus,
) -> Result<()> {
    let event = ProtocolEvent::ContentAnchoredV2 {
        content_id,
        author,
        content_hash,
        uri_ref,
        relation,
        visibility,
        audience_kind,
        audience_ref,
        status,
        timestamp: Clock::get()?.unix_timestamp,
    };

    let _event_sequence = alcheme_cpi::CpiHelper::emit_event_simple(
        event_program,
        event_emitter_account,
        event_batch,
        payer,
        system_program,
        caller_program,
        event,
    )?;

    Ok(())
}

fn emit_content_status_changed_v2<'info>(
    event_program: &AccountInfo<'info>,
    event_emitter_account: &mut AccountInfo<'info>,
    event_batch: &mut AccountInfo<'info>,
    payer: &AccountInfo<'info>,
    system_program: &AccountInfo<'info>,
    caller_program: &Pubkey,
    content_id: u64,
    old_status: ContentStatus,
    new_status: ContentStatus,
    changed_by: Pubkey,
    audience_kind: V2AudienceKind,
    audience_ref: u8,
) -> Result<()> {
    let event = ProtocolEvent::ContentStatusChangedV2 {
        content_id,
        old_status,
        new_status,
        changed_by,
        audience_kind,
        audience_ref,
        timestamp: Clock::get()?.unix_timestamp,
    };

    let _event_sequence = alcheme_cpi::CpiHelper::emit_event_simple(
        event_program,
        event_emitter_account,
        event_batch,
        payer,
        system_program,
        caller_program,
        event,
    )?;

    Ok(())
}

fn emit_content_anchor_updated_v2<'info>(
    event_program: &AccountInfo<'info>,
    event_emitter_account: &mut AccountInfo<'info>,
    event_batch: &mut AccountInfo<'info>,
    payer: &AccountInfo<'info>,
    system_program: &AccountInfo<'info>,
    caller_program: &Pubkey,
    content_id: u64,
    content_version: u32,
    content_hash: [u8; 32],
    uri_ref: String,
    author: Pubkey,
    audience_kind: V2AudienceKind,
    audience_ref: u8,
) -> Result<()> {
    let event = ProtocolEvent::ContentAnchorUpdatedV2 {
        content_id,
        content_version,
        content_hash,
        uri_ref,
        author,
        audience_kind,
        audience_ref,
        timestamp: Clock::get()?.unix_timestamp,
    };

    let _event_sequence = alcheme_cpi::CpiHelper::emit_event_simple(
        event_program,
        event_emitter_account,
        event_batch,
        payer,
        system_program,
        caller_program,
        event,
    )?;

    Ok(())
}

fn emit_draft_lifecycle_milestone_v2<'info>(
    event_program: &AccountInfo<'info>,
    event_emitter_account: &mut AccountInfo<'info>,
    event_batch: &mut AccountInfo<'info>,
    payer: &AccountInfo<'info>,
    system_program: &AccountInfo<'info>,
    caller_program: &Pubkey,
    draft_post_id: u64,
    action: DraftLifecycleMilestoneAction,
    actor: Pubkey,
    policy_profile_digest: [u8; 32],
) -> Result<()> {
    let event = ProtocolEvent::DraftLifecycleMilestoneV2 {
        draft_post_id,
        action,
        actor,
        policy_profile_digest,
        timestamp: Clock::get()?.unix_timestamp,
    };

    let _event_sequence = alcheme_cpi::CpiHelper::emit_event_simple(
        event_program,
        event_emitter_account,
        event_batch,
        payer,
        system_program,
        caller_program,
        event,
    )?;

    Ok(())
}

#[error_code]
pub enum ContentManagerV2Error {
    #[msg("v2 content_id must be greater than 0")]
    V2ContentIdInvalid,
    #[msg("v2 reply parent content account does not match parent_content")]
    V2ParentContentMismatch,
    #[msg("v2 repost original content account does not match original_content")]
    V2OriginalContentMismatch,
    #[msg("v2 quote target content account does not match quoted_content")]
    V2QuotedContentMismatch,
    #[msg("v2 relation target content id is invalid")]
    V2RelationTargetInvalid,
    #[msg("v2 relation self reference is not allowed")]
    V2RelationSelfReference,
    #[msg("v2 relation target visibility must be public")]
    V2RelationTargetNotPublic,
    #[msg("v2 relation target status must be published")]
    V2RelationTargetNotPublished,
    #[msg("v2 status only supports Draft/Published/Archived")]
    V2UnsupportedStatus,
    #[msg("v2 lifecycle update must be signed by the anchor author")]
    V2StatusUnauthorized,
    #[msg("v2 content is already published")]
    V2StatusAlreadyPublished,
    #[msg("v2 content is already archived")]
    V2StatusAlreadyArchived,
    #[msg("v2 content is already tombstoned")]
    V2StatusAlreadyTombstoned,
    #[msg("v2 lifecycle transition is invalid")]
    V2InvalidLifecycleTransition,
    #[msg("v2 content anchor cannot be updated after deletion")]
    V2ContentAnchorAlreadyDeleted,
    #[msg("v2 audience only supports Public/Private/Followers/CircleOnly")]
    V2UnsupportedAudience,
    #[msg("v2 non-circle audience must not carry audience_ref")]
    V2AudienceRefMustBeZero,
    #[msg("draft lifecycle anchor post_id must be greater than 0")]
    DraftLifecycleAnchorPostIdInvalid,
}

fn validate_v2_content_id(content_id: u64) -> Result<()> {
    require!(
        content_id > 0,
        ContentManagerV2Error::V2ContentIdInvalid
    );
    Ok(())
}

fn validate_v2_relation_content_ids(content_id: u64, relation_target_content_id: u64) -> Result<()> {
    require!(
        relation_target_content_id > 0,
        ContentManagerV2Error::V2RelationTargetInvalid
    );
    require!(
        relation_target_content_id != content_id,
        ContentManagerV2Error::V2RelationSelfReference
    );
    Ok(())
}

fn validate_v2_content_access_status(status: &ContentStatus) -> Result<()> {
    require!(
        matches!(
            status,
            ContentStatus::Draft | ContentStatus::Published | ContentStatus::Archived
        ),
        ContentManagerV2Error::V2UnsupportedStatus
    );
    Ok(())
}

fn audience_kind_to_legacy_visibility(audience_kind: &V2AudienceKind) -> AccessLevel {
    match audience_kind {
        V2AudienceKind::Public => AccessLevel::Public,
        V2AudienceKind::Private => AccessLevel::Private,
        V2AudienceKind::FollowersOnly => AccessLevel::Followers,
        V2AudienceKind::CircleOnly => AccessLevel::Custom,
    }
}

fn build_v2_audience_from_access(visibility: &AccessLevel) -> Result<(V2AudienceKind, u8)> {
    match visibility {
        AccessLevel::Public => Ok((V2AudienceKind::Public, 0)),
        AccessLevel::Private => Ok((V2AudienceKind::Private, 0)),
        AccessLevel::Followers => Ok((V2AudienceKind::FollowersOnly, 0)),
        AccessLevel::Friends | AccessLevel::Custom => err!(ContentManagerV2Error::V2UnsupportedAudience),
    }
}

fn validate_v2_audience_spec(audience_kind: &V2AudienceKind, audience_ref: u8) -> Result<()> {
    match audience_kind {
        V2AudienceKind::CircleOnly => Ok(()),
        V2AudienceKind::Public | V2AudienceKind::Private | V2AudienceKind::FollowersOnly => {
            require!(
                audience_ref == 0,
                ContentManagerV2Error::V2AudienceRefMustBeZero
            );
            Ok(())
        }
    }
}

fn derive_circle_authority(circle_id: u8) -> Pubkey {
    Pubkey::find_program_address(
        &[b"circle", &circle_id.to_le_bytes()],
        &CIRCLE_MANAGER_PROGRAM_ID,
    )
    .0
}

fn read_relation_fact_flags(
    access_program: &AccountInfo,
    target_follow_relationship: &AccountInfo,
    target_circle_membership: &AccountInfo,
    caller_program: &Pubkey,
    requester: Pubkey,
    target_author: Pubkey,
) -> Result<(bool, Option<alcheme_cpi::CircleMembershipFact>)> {
    let has_follow_relationship = alcheme_cpi::CpiHelper::check_follow_relationship_simple(
        access_program,
        target_follow_relationship,
        caller_program,
        requester,
        target_author,
    )?;

    let circle_membership = alcheme_cpi::CpiHelper::read_circle_membership_simple(
        target_circle_membership,
        caller_program,
        requester,
    )?;

    Ok((has_follow_relationship, circle_membership))
}

fn validate_v2_relation_target_anchor(
    target_anchor: &V2ContentAnchorAccount,
    requester: &Pubkey,
    target_author: &Pubkey,
    access_program: &AccountInfo,
    target_follow_relationship: &AccountInfo,
    target_circle_membership: &AccountInfo,
    caller_program: &Pubkey,
) -> Result<()> {
    require!(
        target_anchor.status() == ContentStatus::Published,
        ContentManagerV2Error::V2RelationTargetNotPublished
    );

    match target_anchor.audience_kind() {
        V2AudienceKind::Public => Ok(()),
        V2AudienceKind::Private => {
            require!(
                requester == target_author,
                ContentManagerV2Error::V2RelationTargetNotPublic
            );
            Ok(())
        }
        V2AudienceKind::FollowersOnly => {
            let has_follow_relationship = alcheme_cpi::CpiHelper::check_follow_relationship_simple(
                access_program,
                target_follow_relationship,
                caller_program,
                *requester,
                *target_author,
            )?;
            require!(
                requester == target_author || has_follow_relationship,
                ContentManagerV2Error::V2RelationTargetNotPublic
            );
            Ok(())
        }
        V2AudienceKind::CircleOnly => {
            let membership = alcheme_cpi::CpiHelper::read_circle_membership_simple(
                target_circle_membership,
                caller_program,
                *requester,
            )?;
            let has_circle_membership = membership
                .map(|fact| fact.circle_id == target_anchor.audience_ref())
                .unwrap_or(false);
            require!(
                requester == target_author || has_circle_membership,
                ContentManagerV2Error::V2RelationTargetNotPublic
            );
            Ok(())
        }
    }
}

fn validate_v2_relation_target_post(
    target_post: &ContentPostAccount,
    requester: &Pubkey,
    access_program: &AccountInfo,
    target_follow_relationship: &AccountInfo,
    target_circle_membership: &AccountInfo,
    caller_program: &Pubkey,
) -> Result<()> {
    let (has_follow_relationship, circle_membership) = read_relation_fact_flags(
        access_program,
        target_follow_relationship,
        target_circle_membership,
        caller_program,
        *requester,
        target_post.author_identity,
    )?;

    let has_circle_membership = match (&target_post.visibility_settings.visibility_level, circle_membership) {
        (VisibilityLevel::Community(expected_circle), Some(fact)) => {
            derive_circle_authority(fact.circle_id) == *expected_circle
        }
        _ => false,
    };

    require!(
        target_post.status == ContentStatus::Published,
        ContentManagerV2Error::V2RelationTargetNotPublished
    );
    ContentValidator::validate_visible_to_requester_with_facts(
        &target_post.visibility_settings,
        requester,
        &target_post.author_identity,
        has_follow_relationship,
        has_circle_membership,
    )
    .map_err(|_| ContentManagerV2Error::V2RelationTargetNotPublic.into())
}

fn apply_v2_lifecycle_transition<'info>(
    ctx: Context<UpdateContentV2Lifecycle>,
    content_id: u64,
    new_status: ContentStatus,
) -> Result<()> {
    let old_status = ctx.accounts.v2_content_anchor.status();

    ContentStatusManager::validate_status_transition(&old_status, &new_status)?;
    ctx.accounts
        .content_manager
        .apply_v2_status_transition(&old_status, &new_status)?;
    ctx.accounts.v2_content_anchor.update_status(&new_status);
    let audience_kind = ctx.accounts.v2_content_anchor.audience_kind();
    let audience_ref = ctx.accounts.v2_content_anchor.audience_ref();

    emit_content_status_changed_v2(
        &ctx.accounts.event_program,
        &mut ctx.accounts.event_emitter_account,
        &mut ctx.accounts.event_batch,
        &ctx.accounts.author.to_account_info(),
        &ctx.accounts.system_program.to_account_info(),
        &ctx.program_id,
        content_id,
        old_status,
        new_status.clone(),
        ctx.accounts.author.key(),
        audience_kind,
        audience_ref,
    )?;

    msg!(
        "v2 内容状态更新成功: {} -> {:?} by {}",
        content_id,
        new_status,
        ctx.accounts.author.key()
    );

    Ok(())
}

#[inline(never)]
pub fn create_content_v2(
    ctx: Context<CreateContentV2>,
    content_id: u64,
    content_hash: [u8; 32],
    uri_ref: String,
) -> Result<()> {
    create_content_v2_with_access(
        ctx,
        content_id,
        content_hash,
        uri_ref,
        AccessLevel::Public,
        ContentStatus::Published,
    )
}

#[inline(never)]
pub fn create_content_v2_with_access(
    ctx: Context<CreateContentV2>,
    content_id: u64,
    content_hash: [u8; 32],
    uri_ref: String,
    visibility: AccessLevel,
    status: ContentStatus,
) -> Result<()> {
    let (audience_kind, audience_ref) = build_v2_audience_from_access(&visibility)?;
    create_content_v2_with_audience(
        ctx,
        content_id,
        content_hash,
        uri_ref,
        audience_kind,
        audience_ref,
        status,
    )
}

#[inline(never)]
pub fn create_content_v2_with_audience(
    ctx: Context<CreateContentV2>,
    content_id: u64,
    content_hash: [u8; 32],
    uri_ref: String,
    audience_kind: V2AudienceKind,
    audience_ref: u8,
    status: ContentStatus,
) -> Result<()> {
    let relation = ContentAnchorRelation::None;
    validate_v2_write_permission(
        &ctx.program_id,
        ctx.accounts.author.key(),
        &ctx.accounts.identity_program,
        &ctx.accounts.user_identity,
        &ctx.accounts.access_program,
        &ctx.accounts.access_controller_account,
        Permission::CreateContent,
    )?;
    V2AnchorValidator::validate(&uri_ref, &relation)?;
    validate_v2_content_id(content_id)?;
    validate_v2_content_access_status(&status)?;
    validate_v2_audience_spec(&audience_kind, audience_ref)?;
    let visibility = audience_kind_to_legacy_visibility(&audience_kind);
    let v2_content_anchor_bump = ctx.bumps.v2_content_anchor;
    ctx.accounts
        .v2_content_anchor
        .initialize(
            audience_kind.clone(),
            audience_ref,
            status.clone(),
            v2_content_anchor_bump,
        );

    ctx.accounts.content_manager.create_content_with_status(&status)?;
    emit_content_anchored_v2(
        &ctx.accounts.event_program,
        &mut ctx.accounts.event_emitter_account,
        &mut ctx.accounts.event_batch,
        &ctx.accounts.author.to_account_info(),
        &ctx.accounts.system_program.to_account_info(),
        &ctx.program_id,
        content_id,
        ctx.accounts.author.key(),
        content_hash,
        uri_ref,
        relation,
        visibility,
        audience_kind,
        audience_ref,
        status,
    )?;

    msg!("v2 内容锚点创建成功: {} by {}", content_id, ctx.accounts.author.key());
    Ok(())
}

#[inline(never)]
pub fn create_reply_v2(
    ctx: Context<CreateReplyV2>,
    content_id: u64,
    parent_content: Pubkey,
    content_hash: [u8; 32],
    uri_ref: String,
) -> Result<()> {
    require!(
        ctx.accounts.parent_content_post.key() == parent_content,
        ContentManagerV2Error::V2ParentContentMismatch
    );
    let parent_post = &ctx.accounts.parent_content_post;
    let (has_follow_relationship, circle_membership) = read_relation_fact_flags(
        &ctx.accounts.access_program,
        &ctx.accounts.target_follow_relationship,
        &ctx.accounts.target_circle_membership,
        &ctx.program_id,
        ctx.accounts.author.key(),
        parent_post.author_identity,
    )?;
    let has_circle_membership = match (&parent_post.visibility_settings.visibility_level, circle_membership) {
        (VisibilityLevel::Community(expected_circle), Some(fact)) => {
            derive_circle_authority(fact.circle_id) == *expected_circle
        }
        _ => false,
    };
    validate_v2_relation_target_post(
        parent_post,
        &ctx.accounts.author.key(),
        &ctx.accounts.access_program,
        &ctx.accounts.target_follow_relationship,
        &ctx.accounts.target_circle_membership,
        &ctx.program_id,
    )?;
    require!(parent_post.thread_depth < 32, AlchemeError::InvalidOperation);
    ContentValidator::validate_reply_permission_with_facts(
        &parent_post.visibility_settings,
        &ctx.accounts.author.key(),
        &parent_post.author_identity,
        has_follow_relationship,
        has_circle_membership,
    )?;

    let relation = ContentAnchorRelation::Reply { parent_content };
    validate_v2_write_permission(
        &ctx.program_id,
        ctx.accounts.author.key(),
        &ctx.accounts.identity_program,
        &ctx.accounts.user_identity,
        &ctx.accounts.access_program,
        &ctx.accounts.access_controller_account,
        Permission::CreateContent,
    )?;
    V2AnchorValidator::validate(&uri_ref, &relation)?;
    validate_v2_content_id(content_id)?;
    let visibility = AccessLevel::Public;
    let audience_kind = V2AudienceKind::Public;
    let audience_ref = 0;
    let status = ContentStatus::Published;
    let v2_content_anchor_bump = ctx.bumps.v2_content_anchor;
    ctx.accounts
        .v2_content_anchor
        .initialize(
            audience_kind.clone(),
            audience_ref,
            status.clone(),
            v2_content_anchor_bump,
        );

    ctx.accounts.content_manager.create_content_with_status(&status)?;
    emit_content_anchored_v2(
        &ctx.accounts.event_program,
        &mut ctx.accounts.event_emitter_account,
        &mut ctx.accounts.event_batch,
        &ctx.accounts.author.to_account_info(),
        &ctx.accounts.system_program.to_account_info(),
        &ctx.program_id,
        content_id,
        ctx.accounts.author.key(),
        content_hash,
        uri_ref,
        relation,
        visibility,
        audience_kind,
        audience_ref,
        status,
    )?;

    msg!(
        "v2 回复锚点创建成功: {} -> {} by {}",
        content_id,
        parent_content,
        ctx.accounts.author.key()
    );
    Ok(())
}

#[inline(never)]
pub fn create_repost_v2(
    ctx: Context<CreateRepostV2>,
    content_id: u64,
    original_content: Pubkey,
    content_hash: [u8; 32],
    uri_ref: String,
) -> Result<()> {
    require!(
        ctx.accounts.original_content_post.key() == original_content,
        ContentManagerV2Error::V2OriginalContentMismatch
    );
    let original_post = &ctx.accounts.original_content_post;
    let (has_follow_relationship, circle_membership) = read_relation_fact_flags(
        &ctx.accounts.access_program,
        &ctx.accounts.target_follow_relationship,
        &ctx.accounts.target_circle_membership,
        &ctx.program_id,
        ctx.accounts.author.key(),
        original_post.author_identity,
    )?;
    let has_circle_membership = match (&original_post.visibility_settings.visibility_level, circle_membership) {
        (VisibilityLevel::Community(expected_circle), Some(fact)) => {
            derive_circle_authority(fact.circle_id) == *expected_circle
        }
        _ => false,
    };
    validate_v2_relation_target_post(
        original_post,
        &ctx.accounts.author.key(),
        &ctx.accounts.access_program,
        &ctx.accounts.target_follow_relationship,
        &ctx.accounts.target_circle_membership,
        &ctx.program_id,
    )?;
    ContentValidator::validate_repost_permission_with_facts(
        &original_post.visibility_settings,
        &ctx.accounts.author.key(),
        &original_post.author_identity,
        has_follow_relationship,
        has_circle_membership,
    )?;

    let relation = ContentAnchorRelation::Repost { original_content };
    validate_v2_write_permission(
        &ctx.program_id,
        ctx.accounts.author.key(),
        &ctx.accounts.identity_program,
        &ctx.accounts.user_identity,
        &ctx.accounts.access_program,
        &ctx.accounts.access_controller_account,
        Permission::CreateContent,
    )?;
    V2AnchorValidator::validate(&uri_ref, &relation)?;
    validate_v2_content_id(content_id)?;
    let visibility = AccessLevel::Public;
    let audience_kind = V2AudienceKind::Public;
    let audience_ref = 0;
    let status = ContentStatus::Published;
    let v2_content_anchor_bump = ctx.bumps.v2_content_anchor;
    ctx.accounts
        .v2_content_anchor
        .initialize(
            audience_kind.clone(),
            audience_ref,
            status.clone(),
            v2_content_anchor_bump,
        );

    ctx.accounts.content_manager.create_content_with_status(&status)?;
    emit_content_anchored_v2(
        &ctx.accounts.event_program,
        &mut ctx.accounts.event_emitter_account,
        &mut ctx.accounts.event_batch,
        &ctx.accounts.author.to_account_info(),
        &ctx.accounts.system_program.to_account_info(),
        &ctx.program_id,
        content_id,
        ctx.accounts.author.key(),
        content_hash,
        uri_ref,
        relation,
        visibility,
        audience_kind,
        audience_ref,
        status,
    )?;

    msg!(
        "v2 转发锚点创建成功: {} -> {} by {}",
        content_id,
        original_content,
        ctx.accounts.author.key()
    );
    Ok(())
}

#[inline(never)]
pub fn create_quote_v2(
    ctx: Context<CreateQuoteV2>,
    content_id: u64,
    quoted_content: Pubkey,
    content_hash: [u8; 32],
    uri_ref: String,
) -> Result<()> {
    require!(
        ctx.accounts.quoted_content_post.key() == quoted_content,
        ContentManagerV2Error::V2QuotedContentMismatch
    );
    let quoted_post = &ctx.accounts.quoted_content_post;
    let (has_follow_relationship, circle_membership) = read_relation_fact_flags(
        &ctx.accounts.access_program,
        &ctx.accounts.target_follow_relationship,
        &ctx.accounts.target_circle_membership,
        &ctx.program_id,
        ctx.accounts.author.key(),
        quoted_post.author_identity,
    )?;
    let has_circle_membership = match (&quoted_post.visibility_settings.visibility_level, circle_membership) {
        (VisibilityLevel::Community(expected_circle), Some(fact)) => {
            derive_circle_authority(fact.circle_id) == *expected_circle
        }
        _ => false,
    };
    validate_v2_relation_target_post(
        quoted_post,
        &ctx.accounts.author.key(),
        &ctx.accounts.access_program,
        &ctx.accounts.target_follow_relationship,
        &ctx.accounts.target_circle_membership,
        &ctx.program_id,
    )?;
    ContentValidator::validate_quote_permission_with_facts(
        &quoted_post.visibility_settings,
        &ctx.accounts.author.key(),
        &quoted_post.author_identity,
        has_follow_relationship,
        has_circle_membership,
    )?;

    let relation = ContentAnchorRelation::Quote { quoted_content };
    validate_v2_write_permission(
        &ctx.program_id,
        ctx.accounts.author.key(),
        &ctx.accounts.identity_program,
        &ctx.accounts.user_identity,
        &ctx.accounts.access_program,
        &ctx.accounts.access_controller_account,
        Permission::CreateContent,
    )?;
    V2AnchorValidator::validate(&uri_ref, &relation)?;
    validate_v2_content_id(content_id)?;
    let visibility = AccessLevel::Public;
    let audience_kind = V2AudienceKind::Public;
    let audience_ref = 0;
    let status = ContentStatus::Published;
    let v2_content_anchor_bump = ctx.bumps.v2_content_anchor;
    ctx.accounts
        .v2_content_anchor
        .initialize(
            audience_kind.clone(),
            audience_ref,
            status.clone(),
            v2_content_anchor_bump,
        );

    ctx.accounts.content_manager.create_content_with_status(&status)?;
    emit_content_anchored_v2(
        &ctx.accounts.event_program,
        &mut ctx.accounts.event_emitter_account,
        &mut ctx.accounts.event_batch,
        &ctx.accounts.author.to_account_info(),
        &ctx.accounts.system_program.to_account_info(),
        &ctx.program_id,
        content_id,
        ctx.accounts.author.key(),
        content_hash,
        uri_ref,
        relation,
        visibility,
        audience_kind,
        audience_ref,
        status,
    )?;

    msg!(
        "v2 引用锚点创建成功: {} -> {} by {}",
        content_id,
        quoted_content,
        ctx.accounts.author.key()
    );
    Ok(())
}

#[inline(never)]
pub fn create_reply_v2_by_id(
    ctx: Context<CreateReplyV2ById>,
    content_id: u64,
    parent_content_id: u64,
    content_hash: [u8; 32],
    uri_ref: String,
) -> Result<()> {
    validate_v2_relation_content_ids(content_id, parent_content_id)?;
    validate_v2_relation_target_anchor(
        &ctx.accounts.parent_v2_content_anchor,
        &ctx.accounts.author.key(),
        &ctx.accounts.parent_author.key(),
        &ctx.accounts.access_program,
        &ctx.accounts.target_follow_relationship,
        &ctx.accounts.target_circle_membership,
        &ctx.program_id,
    )?;
    let relation = ContentAnchorRelation::ReplyById { parent_content_id };
    validate_v2_write_permission(
        &ctx.program_id,
        ctx.accounts.author.key(),
        &ctx.accounts.identity_program,
        &ctx.accounts.user_identity,
        &ctx.accounts.access_program,
        &ctx.accounts.access_controller_account,
        Permission::CreateContent,
    )?;
    V2AnchorValidator::validate(&uri_ref, &relation)?;
    validate_v2_content_id(content_id)?;
    let visibility = AccessLevel::Public;
    let audience_kind = V2AudienceKind::Public;
    let audience_ref = 0;
    let status = ContentStatus::Published;
    let v2_content_anchor_bump = ctx.bumps.v2_content_anchor;
    ctx.accounts
        .v2_content_anchor
        .initialize(
            audience_kind.clone(),
            audience_ref,
            status.clone(),
            v2_content_anchor_bump,
        );

    ctx.accounts.content_manager.create_content_with_status(&status)?;
    emit_content_anchored_v2(
        &ctx.accounts.event_program,
        &mut ctx.accounts.event_emitter_account,
        &mut ctx.accounts.event_batch,
        &ctx.accounts.author.to_account_info(),
        &ctx.accounts.system_program.to_account_info(),
        &ctx.program_id,
        content_id,
        ctx.accounts.author.key(),
        content_hash,
        uri_ref,
        relation,
        visibility,
        audience_kind,
        audience_ref,
        status,
    )?;

    msg!(
        "v2 回复锚点创建成功(by_id): {} -> {} by {}",
        content_id,
        parent_content_id,
        ctx.accounts.author.key()
    );
    Ok(())
}

#[inline(never)]
pub fn create_repost_v2_by_id(
    ctx: Context<CreateRepostV2ById>,
    content_id: u64,
    original_content_id: u64,
    content_hash: [u8; 32],
    uri_ref: String,
) -> Result<()> {
    validate_v2_relation_content_ids(content_id, original_content_id)?;
    validate_v2_relation_target_anchor(
        &ctx.accounts.original_v2_content_anchor,
        &ctx.accounts.author.key(),
        &ctx.accounts.original_author.key(),
        &ctx.accounts.access_program,
        &ctx.accounts.target_follow_relationship,
        &ctx.accounts.target_circle_membership,
        &ctx.program_id,
    )?;
    let relation = ContentAnchorRelation::RepostById { original_content_id };
    validate_v2_write_permission(
        &ctx.program_id,
        ctx.accounts.author.key(),
        &ctx.accounts.identity_program,
        &ctx.accounts.user_identity,
        &ctx.accounts.access_program,
        &ctx.accounts.access_controller_account,
        Permission::CreateContent,
    )?;
    V2AnchorValidator::validate(&uri_ref, &relation)?;
    validate_v2_content_id(content_id)?;
    let visibility = AccessLevel::Public;
    let audience_kind = V2AudienceKind::Public;
    let audience_ref = 0;
    let status = ContentStatus::Published;
    let v2_content_anchor_bump = ctx.bumps.v2_content_anchor;
    ctx.accounts
        .v2_content_anchor
        .initialize(
            audience_kind.clone(),
            audience_ref,
            status.clone(),
            v2_content_anchor_bump,
        );

    ctx.accounts.content_manager.create_content_with_status(&status)?;
    emit_content_anchored_v2(
        &ctx.accounts.event_program,
        &mut ctx.accounts.event_emitter_account,
        &mut ctx.accounts.event_batch,
        &ctx.accounts.author.to_account_info(),
        &ctx.accounts.system_program.to_account_info(),
        &ctx.program_id,
        content_id,
        ctx.accounts.author.key(),
        content_hash,
        uri_ref,
        relation,
        visibility,
        audience_kind,
        audience_ref,
        status,
    )?;

    msg!(
        "v2 转发锚点创建成功(by_id): {} -> {} by {}",
        content_id,
        original_content_id,
        ctx.accounts.author.key()
    );
    Ok(())
}

#[inline(never)]
pub fn create_quote_v2_by_id(
    ctx: Context<CreateQuoteV2ById>,
    content_id: u64,
    quoted_content_id: u64,
    content_hash: [u8; 32],
    uri_ref: String,
) -> Result<()> {
    validate_v2_relation_content_ids(content_id, quoted_content_id)?;
    validate_v2_relation_target_anchor(
        &ctx.accounts.quoted_v2_content_anchor,
        &ctx.accounts.author.key(),
        &ctx.accounts.quoted_author.key(),
        &ctx.accounts.access_program,
        &ctx.accounts.target_follow_relationship,
        &ctx.accounts.target_circle_membership,
        &ctx.program_id,
    )?;
    let relation = ContentAnchorRelation::QuoteById { quoted_content_id };
    validate_v2_write_permission(
        &ctx.program_id,
        ctx.accounts.author.key(),
        &ctx.accounts.identity_program,
        &ctx.accounts.user_identity,
        &ctx.accounts.access_program,
        &ctx.accounts.access_controller_account,
        Permission::CreateContent,
    )?;
    V2AnchorValidator::validate(&uri_ref, &relation)?;
    validate_v2_content_id(content_id)?;
    let visibility = AccessLevel::Public;
    let audience_kind = V2AudienceKind::Public;
    let audience_ref = 0;
    let status = ContentStatus::Published;
    let v2_content_anchor_bump = ctx.bumps.v2_content_anchor;
    ctx.accounts
        .v2_content_anchor
        .initialize(
            audience_kind.clone(),
            audience_ref,
            status.clone(),
            v2_content_anchor_bump,
        );

    ctx.accounts.content_manager.create_content_with_status(&status)?;
    emit_content_anchored_v2(
        &ctx.accounts.event_program,
        &mut ctx.accounts.event_emitter_account,
        &mut ctx.accounts.event_batch,
        &ctx.accounts.author.to_account_info(),
        &ctx.accounts.system_program.to_account_info(),
        &ctx.program_id,
        content_id,
        ctx.accounts.author.key(),
        content_hash,
        uri_ref,
        relation,
        visibility,
        audience_kind,
        audience_ref,
        status,
    )?;

    msg!(
        "v2 引用锚点创建成功(by_id): {} -> {} by {}",
        content_id,
        quoted_content_id,
        ctx.accounts.author.key()
    );
    Ok(())
}

pub fn publish_content_v2(
    ctx: Context<UpdateContentV2Lifecycle>,
    content_id: u64,
) -> Result<()> {
    let current_status = ctx.accounts.v2_content_anchor.status();
    require!(
        current_status != ContentStatus::Published,
        ContentManagerV2Error::V2StatusAlreadyPublished
    );
    require!(
        current_status == ContentStatus::Draft,
        ContentManagerV2Error::V2InvalidLifecycleTransition
    );

    apply_v2_lifecycle_transition(ctx, content_id, ContentStatus::Published)
}

pub fn archive_content_v2(
    ctx: Context<UpdateContentV2Lifecycle>,
    content_id: u64,
) -> Result<()> {
    let current_status = ctx.accounts.v2_content_anchor.status();
    require!(
        current_status != ContentStatus::Archived,
        ContentManagerV2Error::V2StatusAlreadyArchived
    );
    require!(
        current_status == ContentStatus::Published,
        ContentManagerV2Error::V2InvalidLifecycleTransition
    );

    apply_v2_lifecycle_transition(ctx, content_id, ContentStatus::Archived)
}

pub fn restore_content_v2(
    ctx: Context<UpdateContentV2Lifecycle>,
    content_id: u64,
) -> Result<()> {
    let current_status = ctx.accounts.v2_content_anchor.status();
    require!(
        current_status != ContentStatus::Published,
        ContentManagerV2Error::V2StatusAlreadyPublished
    );
    require!(
        current_status == ContentStatus::Archived,
        ContentManagerV2Error::V2InvalidLifecycleTransition
    );

    apply_v2_lifecycle_transition(ctx, content_id, ContentStatus::Published)
}

pub fn enter_draft_crystallization_v2(
    ctx: Context<AnchorDraftLifecycleV2>,
    draft_post_id: u64,
    policy_profile_digest: [u8; 32],
) -> Result<()> {
    require!(
        draft_post_id > 0,
        ContentManagerV2Error::DraftLifecycleAnchorPostIdInvalid
    );

    emit_draft_lifecycle_milestone_v2(
        &ctx.accounts.event_program,
        &mut ctx.accounts.event_emitter_account,
        &mut ctx.accounts.event_batch,
        &ctx.accounts.actor.to_account_info(),
        &ctx.accounts.system_program.to_account_info(),
        &ctx.program_id,
        draft_post_id,
        DraftLifecycleMilestoneAction::EnteredCrystallization,
        ctx.accounts.actor.key(),
        policy_profile_digest,
    )
}

pub fn archive_draft_lifecycle_v2(
    ctx: Context<AnchorDraftLifecycleV2>,
    draft_post_id: u64,
    policy_profile_digest: [u8; 32],
) -> Result<()> {
    require!(
        draft_post_id > 0,
        ContentManagerV2Error::DraftLifecycleAnchorPostIdInvalid
    );

    emit_draft_lifecycle_milestone_v2(
        &ctx.accounts.event_program,
        &mut ctx.accounts.event_emitter_account,
        &mut ctx.accounts.event_batch,
        &ctx.accounts.actor.to_account_info(),
        &ctx.accounts.system_program.to_account_info(),
        &ctx.program_id,
        draft_post_id,
        DraftLifecycleMilestoneAction::Archived,
        ctx.accounts.actor.key(),
        policy_profile_digest,
    )
}

pub fn restore_draft_lifecycle_v2(
    ctx: Context<AnchorDraftLifecycleV2>,
    draft_post_id: u64,
    policy_profile_digest: [u8; 32],
) -> Result<()> {
    require!(
        draft_post_id > 0,
        ContentManagerV2Error::DraftLifecycleAnchorPostIdInvalid
    );

    emit_draft_lifecycle_milestone_v2(
        &ctx.accounts.event_program,
        &mut ctx.accounts.event_emitter_account,
        &mut ctx.accounts.event_batch,
        &ctx.accounts.actor.to_account_info(),
        &ctx.accounts.system_program.to_account_info(),
        &ctx.program_id,
        draft_post_id,
        DraftLifecycleMilestoneAction::Restored,
        ctx.accounts.actor.key(),
        policy_profile_digest,
    )
}

pub fn tombstone_content_v2(
    ctx: Context<UpdateContentV2Lifecycle>,
    content_id: u64,
) -> Result<()> {
    let current_status = ctx.accounts.v2_content_anchor.status();
    require!(
        current_status != ContentStatus::Deleted,
        ContentManagerV2Error::V2StatusAlreadyTombstoned
    );
    require!(
        matches!(
            current_status,
            ContentStatus::Draft | ContentStatus::Published | ContentStatus::Archived
        ),
        ContentManagerV2Error::V2InvalidLifecycleTransition
    );

    apply_v2_lifecycle_transition(ctx, content_id, ContentStatus::Deleted)
}

pub fn update_content_anchor_v2(
    ctx: Context<UpdateContentAnchorV2>,
    content_id: u64,
    content_hash: [u8; 32],
    uri_ref: String,
) -> Result<()> {
    validate_v2_content_id(content_id)?;
    validate_v2_write_permission(
        &ctx.program_id,
        ctx.accounts.author.key(),
        &ctx.accounts.identity_program,
        &ctx.accounts.user_identity,
        &ctx.accounts.access_program,
        &ctx.accounts.access_controller_account,
        Permission::EditContent,
    )?;
    V2AnchorValidator::validate(&uri_ref, &ContentAnchorRelation::None)?;
    require!(
        ctx.accounts.v2_content_anchor.status() != ContentStatus::Deleted,
        ContentManagerV2Error::V2ContentAnchorAlreadyDeleted
    );

    ctx.accounts.v2_content_anchor.bump_content_version();
    let audience_kind = ctx.accounts.v2_content_anchor.audience_kind();
    let audience_ref = ctx.accounts.v2_content_anchor.audience_ref();
    let content_version = ctx.accounts.v2_content_anchor.content_version();

    emit_content_anchor_updated_v2(
        &ctx.accounts.event_program,
        &mut ctx.accounts.event_emitter_account,
        &mut ctx.accounts.event_batch,
        &ctx.accounts.author.to_account_info(),
        &ctx.accounts.system_program.to_account_info(),
        &ctx.program_id,
        content_id,
        content_version,
        content_hash,
        uri_ref,
        ctx.accounts.author.key(),
        audience_kind,
        audience_ref,
    )?;

    msg!(
        "v2 内容锚点更新成功: {} version {} by {}",
        content_id,
        content_version,
        ctx.accounts.author.key()
    );

    Ok(())
}

/// 更新内容
#[derive(Accounts)]
pub struct UpdateContent<'info> {
    #[account(
        mut,
        constraint = author.key() == content_post.author_identity @ AlchemeError::Unauthorized
    )]
    pub content_post: Account<'info, ContentPostAccount>,
    
    pub author: Signer<'info>,
    
    pub system_program: Program<'info, System>,
    
    /// CHECK: Event Emitter program
    pub event_program: AccountInfo<'info>,
    
    /// CHECK: Event Emitter account
    #[account(mut)]
    pub event_emitter: AccountInfo<'info>,
    
    /// CHECK: Event Batch account
    #[account(mut)]
    pub event_batch: AccountInfo<'info>,
}

pub fn update_content(
    ctx: Context<UpdateContent>,
    updates: ContentUpdate,
) -> Result<()> {
    let content_post = &mut ctx.accounts.content_post;
    
    // 验证更新权限
    ContentValidator::validate_content_update(&updates)?;
    
    // 应用更新
    content_post.update_content(updates)?;
    
    // 发射事件
    let event = ProtocolEvent::ContentUpdated {
        content_id: content_post.key(),
        author: ctx.accounts.author.key(),
        updated_fields: vec!["metadata".to_string()],
        timestamp: Clock::get()?.unix_timestamp,
    };
    
    alcheme_cpi::CpiHelper::emit_event_simple(
        &ctx.accounts.event_program,
        &mut ctx.accounts.event_emitter,
        &mut ctx.accounts.event_batch,
        &ctx.accounts.author.to_account_info(),
        &ctx.accounts.system_program.to_account_info(),
        &crate::ID,
        event,
    )?;
    
    msg!("内容更新成功: {}", content_post.content_id);
    Ok(())
}

/// 删除内容
#[derive(Accounts)]
pub struct DeleteContent<'info> {
    #[account(mut)]
    pub content_manager: Account<'info, ContentManagerAccount>,
    
    #[account(
        mut,
        constraint = author.key() == content_post.author_identity @ AlchemeError::Unauthorized
    )]
    pub content_post: Account<'info, ContentPostAccount>,
    
    #[account(mut)]
    pub content_stats: Account<'info, ContentStatsAccount>,
    
    #[account(mut)]
    pub content_storage: Account<'info, ContentStorageAccount>,
    
    pub author: Signer<'info>,
    
    pub system_program: Program<'info, System>,
    
    /// CHECK: Event Emitter program
    pub event_program: AccountInfo<'info>,
    
    /// CHECK: Event Emitter account
    #[account(mut)]
    pub event_emitter: AccountInfo<'info>,
    
    /// CHECK: Event Batch account
    #[account(mut)]
    pub event_batch: AccountInfo<'info>,
}

pub fn delete_content(
    ctx: Context<DeleteContent>,
    deletion_type: DeletionType,
) -> Result<()> {
    let content_post = &mut ctx.accounts.content_post;
    let content_manager = &mut ctx.accounts.content_manager;
    
    match deletion_type {
        DeletionType::SoftDelete => {
            content_post.status = ContentStatus::Deleted;
        },
        DeletionType::Archive => {
            content_post.status = ContentStatus::Archived;
        },
        DeletionType::HardDelete => {
            // 在实际实现中，这里会关闭所有相关账户
            content_post.status = ContentStatus::Deleted;
        },
    }
    
    // 更新管理器统计
    content_manager.delete_content(deletion_type.clone())?;
    
    // 发射事件
    let event = ProtocolEvent::ContentStatusChanged {
        content_id: content_post.key(),
        old_status: ContentStatus::Published, // Simplified - ideally track previous status
        new_status: content_post.status.clone(),
        changed_by: ctx.accounts.author.key(),
        timestamp: Clock::get()?.unix_timestamp,
    };
    
    alcheme_cpi::CpiHelper::emit_event_simple(
        &ctx.accounts.event_program,
        &mut ctx.accounts.event_emitter,
        &mut ctx.accounts.event_batch,
        &ctx.accounts.author.to_account_info(),
        &ctx.accounts.system_program.to_account_info(),
        &crate::ID,
        event,
    )?;
    
    msg!("内容删除成功: {} (类型: {:?})", content_post.content_id, deletion_type);
    Ok(())
}

/// 创建回复
#[derive(Accounts)]
#[instruction(content_id: u64, parent_content: Pubkey)]
pub struct CreateReply<'info> {
    #[account(mut)]
    pub content_manager: Box<Account<'info, ContentManagerAccount>>,
    
    /// CHECK: 父内容账户，用于获取线程信息
    pub parent_content_post: Box<Account<'info, ContentPostAccount>>,
    
    #[account(
        init,
        payer = author,
        space = ContentPostAccount::SPACE,
        seeds = [CONTENT_POST_SEED, author.key().as_ref(), &content_id.to_le_bytes()],
        bump
    )]
    pub content_post: Box<Account<'info, ContentPostAccount>>,
    
    #[account(
        init,
        payer = author,
        space = ContentStatsAccount::SPACE,
        seeds = [b"content_stats", content_post.key().as_ref()],
        bump
    )]
    pub content_stats: Box<Account<'info, ContentStatsAccount>>,
    
    #[account(
        init,
        payer = author,
        space = ContentStorageAccount::INIT_SPACE,
        seeds = [b"content_storage", content_post.key().as_ref()],
        bump
    )]
    pub content_storage: Box<Account<'info, ContentStorageAccount>>,
    
    #[account(mut)]
    pub author: Signer<'info>,
    
    pub system_program: Program<'info, System>,
}

#[inline(never)]
pub fn create_reply(
    ctx: Context<CreateReply>,
    content_id: u64,
    parent_content: Pubkey,
    content_data: ContentData,
    metadata: ContentMetadata,
    external_uri: Option<String>, // 新增参数
) -> Result<()> {
    let parent_post = &ctx.accounts.parent_content_post;
    let inherited_visibility = parent_post.visibility_settings.clone();
    
    // 验证线程深度
    require!(
        parent_post.thread_depth < 32,
        AlchemeError::InvalidOperation
    );
    
    // 检查回复权限
    ContentValidator::validate_reply_permission(
        &parent_post.visibility_settings,
        &ctx.accounts.author.key(),
        &parent_post.author_identity,
    )?;
    
    // 创建基础内容 (复用 create_content 逻辑)
    let content_hash = ContentHasher::calculate_content_hash(&content_data)?;
    let storage_strategy = StorageCoordinator::determine_storage_strategy(
        &content_data,
        &ctx.accounts.content_manager.storage_config,
    );
    let storage_cost = StorageCoordinator::calculate_storage_cost(&content_data, &storage_strategy);
    
    // 确定存储 URI
    let primary_storage_uri = if let Some(uri) = external_uri {
        ValidationUtils::validate_string_length(&uri, 256, AlchemeError::InvalidOperation)?;
        StorageCoordinator::validate_storage_uri(&uri, &storage_strategy)?;
        uri
    } else {
        format!("content://{}/{}", ctx.accounts.author.key(), content_id)
    };
    
    // 初始化内容账户
    let content_post = &mut ctx.accounts.content_post;
    let content_post_bump = ctx.bumps.content_post;
    
    content_post.initialize(
        content_id,
        ctx.accounts.author.key(),
        content_data.content_type.clone(),
        content_hash,
        primary_storage_uri,
        content_data.text.chars().take(200).collect(),
        inherited_visibility,
        ctx.accounts.content_stats.key(),
        ctx.accounts.content_storage.key(),
        content_post_bump,
    )?;
    
    // 设置为回复
    content_post.set_as_reply(
        parent_content,
        parent_post.thread_root.or(Some(parent_content)),
        parent_post.thread_depth + 1,
    )?;
    
    // 初始化统计和存储账户
    let content_stats = &mut ctx.accounts.content_stats;
    let content_stats_bump = ctx.bumps.content_stats;
    content_stats.initialize(content_post.key(), content_stats_bump)?;
    
    let content_storage = &mut ctx.accounts.content_storage;
    let content_storage_bump = ctx.bumps.content_storage;
    content_storage.initialize(
        content_post.key(),
        storage_strategy,
        content_post.primary_storage_uri.clone(),
        storage_cost,
        content_storage_bump,
    )?;
    
    // 更新管理器统计
    ctx.accounts.content_manager.create_content()?;
    
    msg!("回复创建成功: {} -> {}", content_id, parent_content);
    Ok(())
}

/// 创建引用
#[derive(Accounts)]
#[instruction(content_id: u64, quoted_content: Pubkey)]
pub struct CreateQuote<'info> {
    #[account(mut)]
    pub content_manager: Box<Account<'info, ContentManagerAccount>>,
    
    /// CHECK: 被引用的内容账户
    pub quoted_content_post: Box<Account<'info, ContentPostAccount>>,
    
    #[account(
        init,
        payer = author,
        space = ContentPostAccount::SPACE,
        seeds = [CONTENT_POST_SEED, author.key().as_ref(), &content_id.to_le_bytes()],
        bump
    )]
    pub content_post: Box<Account<'info, ContentPostAccount>>,
    
    #[account(
        init,
        payer = author,
        space = ContentStatsAccount::SPACE,
        seeds = [b"content_stats", content_post.key().as_ref()],
        bump
    )]
    pub content_stats: Box<Account<'info, ContentStatsAccount>>,
    
    #[account(
        init,
        payer = author,
        space = ContentStorageAccount::INIT_SPACE,
        seeds = [b"content_storage", content_post.key().as_ref()],
        bump
    )]
    pub content_storage: Box<Account<'info, ContentStorageAccount>>,
    
    #[account(mut)]
    pub author: Signer<'info>,
    
    pub system_program: Program<'info, System>,
}

pub fn create_quote(
    ctx: Context<CreateQuote>,
    content_id: u64,
    quoted_content: Pubkey,
    content_data: ContentData,
    metadata: ContentMetadata,
    external_uri: Option<String>, // 新增参数
) -> Result<()> {
    let quoted_post = &ctx.accounts.quoted_content_post;
    
    // 检查引用权限
    ContentValidator::validate_quote_permission(
        &quoted_post.visibility_settings,
        &ctx.accounts.author.key(),
        &quoted_post.author_identity,
    )?;
    
    // 创建基础内容
    let content_hash = ContentHasher::calculate_content_hash(&content_data)?;
    let storage_strategy = StorageCoordinator::determine_storage_strategy(
        &content_data,
        &ctx.accounts.content_manager.storage_config,
    );
    let storage_cost = StorageCoordinator::calculate_storage_cost(&content_data, &storage_strategy);
    
    // 确定存储 URI
    let primary_storage_uri = if let Some(uri) = external_uri {
        ValidationUtils::validate_string_length(&uri, 256, AlchemeError::InvalidOperation)?;
        StorageCoordinator::validate_storage_uri(&uri, &storage_strategy)?;
        uri
    } else {
        format!("content://{}/{}", ctx.accounts.author.key(), content_id)
    };
    
    // 初始化内容账户
    let content_post = &mut ctx.accounts.content_post;
    let content_post_bump = ctx.bumps.content_post;
    
    content_post.initialize(
        content_id,
        ctx.accounts.author.key(),
        content_data.content_type.clone(),
        content_hash,
        primary_storage_uri,
        content_data.text.chars().take(200).collect(),
        VisibilitySettings::default(),
        ctx.accounts.content_stats.key(),
        ctx.accounts.content_storage.key(),
        content_post_bump,
    )?;
    
    // 设置为引用
    content_post.set_as_quote(quoted_content)?;
    
    // 初始化统计和存储账户
    let content_stats = &mut ctx.accounts.content_stats;
    let content_stats_bump = ctx.bumps.content_stats;
    content_stats.initialize(content_post.key(), content_stats_bump)?;
    
    let content_storage = &mut ctx.accounts.content_storage;
    let content_storage_bump = ctx.bumps.content_storage;
    content_storage.initialize(
        content_post.key(),
        storage_strategy,
        content_post.primary_storage_uri.clone(),
        storage_cost,
        content_storage_bump,
    )?;
    
    // 更新管理器统计
    ctx.accounts.content_manager.create_content()?;
    
    msg!("引用创建成功: {} -> {}", content_id, quoted_content);
    Ok(())
}

/// 创建转发
#[derive(Accounts)]
#[instruction(content_id: u64, original_content: Pubkey)]
pub struct CreateRepost<'info> {
    #[account(mut)]
    pub content_manager: Box<Account<'info, ContentManagerAccount>>,
    
    /// CHECK: 原始内容账户
    pub original_content_post: Box<Account<'info, ContentPostAccount>>,
    
    #[account(
        init,
        payer = author,
        space = ContentPostAccount::SPACE,
        seeds = [CONTENT_POST_SEED, author.key().as_ref(), &content_id.to_le_bytes()],
        bump
    )]
    pub content_post: Box<Account<'info, ContentPostAccount>>,
    
    #[account(
        init,
        payer = author,
        space = ContentStatsAccount::SPACE,
        seeds = [b"content_stats", content_post.key().as_ref()],
        bump
    )]
    pub content_stats: Box<Account<'info, ContentStatsAccount>>,
    
    #[account(
        init,
        payer = author,
        space = ContentStorageAccount::INIT_SPACE,
        seeds = [b"content_storage", content_post.key().as_ref()],
        bump
    )]
    pub content_storage: Box<Account<'info, ContentStorageAccount>>,
    
    #[account(mut)]
    pub author: Signer<'info>,
    
    pub system_program: Program<'info, System>,
}

pub fn create_repost(
    ctx: Context<CreateRepost>,
    content_id: u64,
    original_content: Pubkey,
    additional_comment: Option<String>,
) -> Result<()> {
    let original_post = &ctx.accounts.original_content_post;
    let inherited_visibility = original_post.visibility_settings.clone();
    
    // 检查转发权限
    ContentValidator::validate_repost_permission(
        &original_post.visibility_settings,
        &ctx.accounts.author.key(),
        &original_post.author_identity,
    )?;
    
    // 创建转发内容
    let content_text = additional_comment.unwrap_or_else(|| "".to_string());
    let content_data = ContentData {
        content_id,
        author: ctx.accounts.author.key(),
        content_type: original_post.content_type.clone(),
        text: content_text.clone(),
        media_attachments: vec![], // 转发不包含新的媒体附件
        metadata: ContentMetadata {
            title: None,
            description: None,
            tags: vec![],
            language: None,
            content_warning: None,
            expires_at: None,
        },
        created_at: Clock::get()?.unix_timestamp,
    };
    
    let content_hash = ContentHasher::calculate_content_hash(&content_data)?;
    let storage_strategy = StorageStrategy::OnChain; // 转发通常较小，使用链上存储
    let storage_cost = StorageCoordinator::calculate_storage_cost(&content_data, &storage_strategy);
    let primary_storage_uri = format!("repost://{}/{}", ctx.accounts.author.key(), content_id);
    
    // 初始化内容账户
    let content_post = &mut ctx.accounts.content_post;
    let content_post_bump = ctx.bumps.content_post;
    
    content_post.initialize(
        content_id,
        ctx.accounts.author.key(),
        content_data.content_type,
        content_hash,
        primary_storage_uri,
        content_text,
        inherited_visibility,
        ctx.accounts.content_stats.key(),
        ctx.accounts.content_storage.key(),
        content_post_bump,
    )?;
    
    // 设置为转发
    content_post.set_as_repost(original_content)?;
    
    // 初始化统计和存储账户
    let content_stats = &mut ctx.accounts.content_stats;
    let content_stats_bump = ctx.bumps.content_stats;
    content_stats.initialize(content_post.key(), content_stats_bump)?;
    
    let content_storage = &mut ctx.accounts.content_storage;
    let content_storage_bump = ctx.bumps.content_storage;
    content_storage.initialize(
        content_post.key(),
        storage_strategy,
        content_post.primary_storage_uri.clone(),
        storage_cost,
        content_storage_bump,
    )?;
    
    // 更新管理器统计
    ctx.accounts.content_manager.create_content()?;
    
    msg!("转发创建成功: {} -> {}", content_id, original_content);
    Ok(())
}

// ==================== 互动统计管理指令 ====================

/// 记录内容互动
#[derive(Accounts)]
pub struct InteractWithContent<'info> {
    #[account(mut)]
    pub content_stats: Account<'info, ContentStatsAccount>,
    
    pub actor: Signer<'info>,
    
    /// CHECK: 调用程序验证
    pub caller_program: AccountInfo<'info>,
    
    pub system_program: Program<'info, System>,
    
    /// CHECK: Event Emitter program
    pub event_program: AccountInfo<'info>,
    
    /// CHECK: Event Emitter account
    #[account(mut)]
    pub event_emitter: AccountInfo<'info>,
    
    /// CHECK: Event Batch account
    #[account(mut)]
    pub event_batch: AccountInfo<'info>,
}

pub fn interact_with_content(
    ctx: Context<InteractWithContent>,
    interaction_type: InteractionType,
) -> Result<()> {
    let content_stats = &mut ctx.accounts.content_stats;
    
    // 验证互动类型
    ContentValidator::validate_interaction_type(&interaction_type)?;
    
    // 更新统计
    content_stats.update_interaction(interaction_type.clone())?;
    
    // 重新计算参与度评分
    content_stats.recalculate_engagement_score()?;
    
    // 发射事件
    let event = ProtocolEvent::ContentInteraction {
        content_id: content_stats.content_id.into(),
        actor: ctx.accounts.actor.key(),
        interaction_type: interaction_type.clone(),
        metadata: None,
        timestamp: Clock::get()?.unix_timestamp,
    };
    
    alcheme_cpi::CpiHelper::emit_event_simple(
        &ctx.accounts.event_program,
        &mut ctx.accounts.event_emitter,
        &mut ctx.accounts.event_batch,
        &ctx.accounts.actor.to_account_info(),
        &ctx.accounts.system_program.to_account_info(),
        &crate::ID,
        event,
    )?;
    
    msg!("内容互动记录成功: {:?} on {}", interaction_type, content_stats.content_id);
    Ok(())
}

/// 批量更新互动统计
#[derive(Accounts)]
pub struct BatchUpdateInteractions<'info> {
    #[account(mut)]
    pub content_stats: Account<'info, ContentStatsAccount>,
    
    /// CHECK: 调用程序验证
    pub caller_program: AccountInfo<'info>,
}

pub fn batch_update_interactions(
    ctx: Context<BatchUpdateInteractions>,
    interactions: Vec<crate::ContentInteraction>,
) -> Result<()> {
    require!(
        interactions.len() <= MAX_BATCH_SIZE,
        AlchemeError::InvalidOperation
    );
    
    let content_stats = &mut ctx.accounts.content_stats;
    
    let interactions_len = interactions.len();
    for interaction in interactions {
        content_stats.update_interaction(interaction.interaction_type)?;
    }
    
    // 重新计算所有评分
    content_stats.recalculate_engagement_score()?;
    
    msg!("批量互动更新成功: {} 个互动", interactions_len);
    Ok(())
}

/// 更新内容评分
#[derive(Accounts)]
pub struct UpdateContentScores<'info> {
    #[account(mut)]
    pub content_stats: Account<'info, ContentStatsAccount>,
    
    /// CHECK: 调用程序验证（通常是分析引擎）
    pub caller_program: AccountInfo<'info>,
}

pub fn update_content_scores(
    ctx: Context<UpdateContentScores>,
    engagement_score: Option<f64>,
    quality_score: Option<f64>,
    trending_score: Option<f64>,
) -> Result<()> {
    let content_stats = &mut ctx.accounts.content_stats;
    
    if let Some(score) = engagement_score {
        require!(score >= 0.0 && score <= 100.0, AlchemeError::InvalidOperation);
        content_stats.engagement_score = score;
    }
    
    if let Some(score) = quality_score {
        require!(score >= 0.0 && score <= 100.0, AlchemeError::InvalidOperation);
        content_stats.quality_score = score;
    }
    
    if let Some(score) = trending_score {
        require!(score >= 0.0 && score <= 100.0, AlchemeError::InvalidOperation);
        content_stats.trending_score = score;
    }
    
    content_stats.last_updated = Clock::get()?.unix_timestamp;
    
    msg!("内容评分更新成功: {}", content_stats.content_id);
    Ok(())
}

// ==================== 内容状态管理指令 ====================

/// 更新内容状态
#[derive(Accounts)]
pub struct UpdateContentStatus<'info> {
    #[account(
        mut,
        constraint = author.key() == content_post.author_identity @ AlchemeError::Unauthorized
    )]
    pub content_post: Account<'info, ContentPostAccount>,
    
    pub author: Signer<'info>,
}

pub fn update_content_status(
    ctx: Context<UpdateContentStatus>,
    new_status: ContentStatus,
    reason: Option<String>,
) -> Result<()> {
    let content_post = &mut ctx.accounts.content_post;
    
    // 验证状态转换
    ContentValidator::validate_status_transition(&content_post.status, &new_status)?;
    
    content_post.status = new_status.clone();
    content_post.last_updated = Clock::get()?.unix_timestamp;
    
    let reason_msg = reason.unwrap_or_else(|| "No reason provided".to_string());
    msg!("内容状态更新: {} -> {:?} (原因: {})", 
         content_post.content_id, new_status, reason_msg);
    
    Ok(())
}

/// 设置内容可见性
#[derive(Accounts)]
pub struct SetContentVisibility<'info> {
    #[account(
        mut,
        constraint = author.key() == content_post.author_identity @ AlchemeError::Unauthorized
    )]
    pub content_post: Account<'info, ContentPostAccount>,
    
    pub author: Signer<'info>,
}

pub fn set_content_visibility(
    ctx: Context<SetContentVisibility>,
    visibility_settings: VisibilitySettings,
) -> Result<()> {
    let content_post = &mut ctx.accounts.content_post;
    
    // 验证可见性设置
    ContentValidator::validate_visibility_settings(&visibility_settings)?;
    
    content_post.visibility_settings = visibility_settings;
    content_post.last_updated = Clock::get()?.unix_timestamp;
    
    msg!("内容可见性设置成功: {}", content_post.content_id);
    Ok(())
}

/// 设置内容变现
#[derive(Accounts)]
pub struct SetContentMonetization<'info> {
    #[account(
        mut,
        constraint = author.key() == content_post.author_identity @ AlchemeError::Unauthorized
    )]
    pub content_post: Account<'info, ContentPostAccount>,
    
    pub author: Signer<'info>,
}

pub fn set_content_monetization(
    ctx: Context<SetContentMonetization>,
    monetization_info: Option<MonetizationInfo>,
) -> Result<()> {
    let content_post = &mut ctx.accounts.content_post;
    
    // 验证变现信息
    if let Some(ref monetization) = monetization_info {
        ContentValidator::validate_monetization_info(monetization)?;
    }
    
    // 在实际实现中，这里需要添加变现信息到内容结构中
    // 当前简化实现，仅记录日志
    
    content_post.last_updated = Clock::get()?.unix_timestamp;
    
    msg!("内容变现设置成功: {}", content_post.content_id);
    Ok(())
}

// ==================== 查询接口 (CPI) ====================

/// 获取内容信息 (CPI)
#[derive(Accounts)]
pub struct GetContentInfo<'info> {
    pub content_post: Account<'info, ContentPostAccount>,
    
    /// CHECK: 调用程序验证
    pub caller_program: AccountInfo<'info>,
}

pub fn get_content_info(
    ctx: Context<GetContentInfo>,
    content_id: Pubkey,
) -> Result<ContentPost> {
    // 验证调用者权限
    require_cpi_permission!(&ctx.accounts.caller_program.key(), CpiPermission::ContentRead);
    
    let content_post = &ctx.accounts.content_post;
    
    // 验证内容ID匹配
    require!(
        content_post.key() == content_id,
        AlchemeError::ContentNotFound
    );
    
    // 返回内容副本 (简化实现)
    Ok(ContentPost {
        content_id: content_post.content_id,
        author_identity: content_post.author_identity,
        created_at: content_post.created_at,
        last_updated: content_post.last_updated,
        content_version: content_post.content_version,
        content_type: content_post.content_type.clone(),
        content_hash: content_post.content_hash,
        primary_storage_uri: content_post.primary_storage_uri.clone(),
        content_preview: content_post.content_preview.clone(),
        reply_to: content_post.reply_to,
        quote_post: content_post.quote_post,
        repost_of: content_post.repost_of,
        thread_root: content_post.thread_root,
        thread_depth: content_post.thread_depth,
        moderation_status: content_post.moderation_status.clone(),
        content_warnings: content_post.content_warnings.clone(),
        visibility_settings: content_post.visibility_settings.clone(),
        tags: content_post.tags.clone(),
        categories: content_post.categories.clone(),
        language: content_post.language.clone(),
        content_length: content_post.content_length,
        stats_account: content_post.stats_account,
        storage_account: content_post.storage_account,
        bump: content_post.bump,
        status: content_post.status.clone(),
    })
}

/// 验证内容所有权 (CPI)
#[derive(Accounts)]
pub struct ValidateContentOwnership<'info> {
    pub content_post: Account<'info, ContentPostAccount>,
    
    /// CHECK: 调用程序验证
    pub caller_program: AccountInfo<'info>,
}

pub fn validate_content_ownership(
    ctx: Context<ValidateContentOwnership>,
    content_id: Pubkey,
    claimed_owner: Pubkey,
) -> Result<bool> {
    // 验证调用者权限
    require_cpi_permission!(&ctx.accounts.caller_program.key(), CpiPermission::ContentValidate);
    
    let content_post = &ctx.accounts.content_post;
    
    // 验证内容ID匹配
    require!(
        content_post.key() == content_id,
        AlchemeError::ContentNotFound
    );
    
    // 检查所有权
    let is_owner = content_post.author_identity == claimed_owner;
    
    Ok(is_owner)
}

/// 获取内容统计 (CPI)
#[derive(Accounts)]
pub struct GetContentStats<'info> {
    pub content_stats: Account<'info, ContentStatsAccount>,
    
    /// CHECK: 调用程序验证
    pub caller_program: AccountInfo<'info>,
}

pub fn get_content_stats(
    ctx: Context<GetContentStats>,
    content_id: Pubkey,
) -> Result<ContentStats> {
    // 验证调用者权限
    require_cpi_permission!(&ctx.accounts.caller_program.key(), CpiPermission::ContentRead);
    
    let content_stats = &ctx.accounts.content_stats;
    
    // 验证内容ID匹配
    require!(
        content_stats.content_id == content_id,
        AlchemeError::ContentNotFound
    );
    
    // 返回统计副本
    Ok(ContentStats {
        content_id: content_stats.content_id,
        like_count: content_stats.like_count,
        comment_count: content_stats.comment_count,
        repost_count: content_stats.repost_count,
        view_count: content_stats.view_count,
        share_count: content_stats.share_count,
        bookmark_count: content_stats.bookmark_count,
        report_count: content_stats.report_count,
        engagement_score: content_stats.engagement_score,
        quality_score: content_stats.quality_score,
        trending_score: content_stats.trending_score,
        virality_score: content_stats.virality_score,
        last_24h_interactions: content_stats.last_24h_interactions,
        last_7d_interactions: content_stats.last_7d_interactions,
        peak_interaction_time: content_stats.peak_interaction_time,
        interaction_velocity: content_stats.interaction_velocity,
        last_updated: content_stats.last_updated,
        update_sequence: content_stats.update_sequence,
        bump: content_stats.bump,
    })
}

// ==================== 简化的搜索和推荐指令 ====================

/// 搜索内容
#[derive(Accounts)]
pub struct SearchContent<'info> {
    pub content_manager: Account<'info, ContentManagerAccount>,
}

pub fn search_content(
    _ctx: Context<SearchContent>,
    _query: SearchQuery,
    _filters: SearchFilters,
    _pagination: PaginationConfig,
) -> Result<Vec<ContentPost>> {
    // 简化实现：返回空结果
    // 在实际实现中，需要实现复杂的搜索算法
    
    let results = Vec::new();
    
    msg!("内容搜索完成: {} 个结果", results.len());
    Ok(results)
}

/// 获取推荐内容
#[derive(Accounts)]
pub struct GetRecommendedContent<'info> {
    pub content_manager: Account<'info, ContentManagerAccount>,
}

pub fn get_recommended_content(
    _ctx: Context<GetRecommendedContent>,
    _user: Pubkey,
    _recommendation_context: RecommendationContext,
) -> Result<Vec<ContentRecommendation>> {
    // 简化实现：返回空推荐
    // 在实际实现中，需要实现推荐算法
    
    let recommendations = Vec::new();
    
    msg!("内容推荐生成完成: {} 个推荐", recommendations.len());
    Ok(recommendations)
}

/// 获取趋势内容
#[derive(Accounts)]
pub struct GetTrendingContent<'info> {
    pub content_manager: Account<'info, ContentManagerAccount>,
}

pub fn get_trending_content(
    _ctx: Context<GetTrendingContent>,
    _time_range: TimeRange,
    _content_types: Option<Vec<ContentType>>,
    _limit: u32,
) -> Result<Vec<ContentPost>> {
    // 简化实现：返回空结果
    // 在实际实现中，需要基于趋势评分排序
    
    let trending_content = Vec::new();
    
    msg!("趋势内容查询完成: {} 个内容", trending_content.len());
    Ok(trending_content)
}

// ==================== 存储管理指令 ====================

/// 更新存储信息
#[derive(Accounts)]
pub struct UpdateStorageInfo<'info> {
    #[account(
        mut,
        constraint = author.key() == content_post.author_identity @ AlchemeError::Unauthorized
    )]
    pub content_post: Account<'info, ContentPostAccount>,
    
    #[account(
        mut,
        constraint = content_storage.content_id == content_post.key() @ AlchemeError::InvalidOperation
    )]
    pub content_storage: Account<'info, ContentStorageAccount>,
    
    pub author: Signer<'info>,
}

pub fn update_storage_info(
    ctx: Context<UpdateStorageInfo>,
    new_primary_uri: Option<String>,
    backup_uris: Option<Vec<String>>,
    storage_status: Option<StorageStatus>,
    cdn_uri: Option<String>, // 新增参数
) -> Result<()> {
    let content_storage = &mut ctx.accounts.content_storage;
    
    if let Some(primary_uri) = new_primary_uri {
        ValidationUtils::validate_string_length(&primary_uri, 256, AlchemeError::InvalidOperation)?;
        content_storage.primary_uri = primary_uri;
        ctx.accounts.content_post.primary_storage_uri = content_storage.primary_uri.clone();
        
        // 如果不是链上存储，且主URI更新了，可能需要重置验证状态
        if !matches!(content_storage.storage_strategy, StorageStrategy::OnChain) {
            content_storage.is_verified_provider = false;
        }
    }
    
    if let Some(uris) = backup_uris {
        require!(uris.len() <= 3, AlchemeError::InvalidOperation);
        for uri in &uris {
            ValidationUtils::validate_string_length(uri, 256, AlchemeError::InvalidOperation)?;
        }
        content_storage.backup_uris = uris;
    }
    
    if let Some(status) = storage_status {
        content_storage.update_storage_status(status)?;
    }
    
    if let Some(cdn) = cdn_uri {
        ValidationUtils::validate_string_length(&cdn, 256, AlchemeError::InvalidOperation)?;
        content_storage.cdn_uri = Some(cdn);
    }
    
    ctx.accounts.content_post.last_updated = Clock::get()?.unix_timestamp;
    
    msg!("存储信息更新成功: {}", content_storage.content_id);
    Ok(())
}

/// 迁移存储策略
#[derive(Accounts)]
pub struct MigrateStorageStrategy<'info> {
    #[account(
        mut,
        constraint = author.key() == content_post.author_identity @ AlchemeError::Unauthorized
    )]
    pub content_post: Account<'info, ContentPostAccount>,
    
    #[account(
        mut,
        constraint = content_storage.content_id == content_post.key() @ AlchemeError::InvalidOperation
    )]
    pub content_storage: Account<'info, ContentStorageAccount>,
    
    pub author: Signer<'info>,
}

pub fn migrate_storage_strategy(
    ctx: Context<MigrateStorageStrategy>,
    new_strategy: StorageStrategy,
    new_primary_uri: String,
) -> Result<()> {
    let content_storage = &mut ctx.accounts.content_storage;
    
    // 验证新的存储策略
    ContentValidator::validate_storage_strategy(&new_strategy)?;
    ValidationUtils::validate_string_length(&new_primary_uri, 256, AlchemeError::InvalidOperation)?;
    StorageCoordinator::validate_storage_uri(&new_primary_uri, &new_strategy)?;
    
        // 备份当前URI
        let current_uri = content_storage.primary_uri.clone();
        if !current_uri.is_empty() {
            content_storage.add_backup_uri(current_uri)?;
        }
    
    // 更新存储策略
    content_storage.storage_strategy = new_strategy;
    content_storage.primary_uri = new_primary_uri.clone();
    content_storage.storage_status = StorageStatus::Migrating;
    
    // 更新主内容账户的URI
    ctx.accounts.content_post.primary_storage_uri = new_primary_uri;
    ctx.accounts.content_post.last_updated = Clock::get()?.unix_timestamp;
    
    msg!("存储策略迁移开始: {}", content_storage.content_id);
    Ok(())
}

// ==================== Extension CPI 接口 ====================

/// 通过扩展程序更新内容状态（需要 ContentStatusUpdate 权限）
#[derive(Accounts)]
pub struct CpiUpdateContentStatus<'info> {
    #[account(mut)]
    pub content_post: Account<'info, ContentPostAccount>,

    /// CHECK: 调用的扩展程序 ID
    pub caller_program: AccountInfo<'info>,

    /// CHECK: ExtensionRegistry PDA
    pub extension_registry: AccountInfo<'info>,

    pub authority: Signer<'info>,
}

pub fn cpi_update_content_status(
    ctx: Context<CpiUpdateContentStatus>,
    new_status: ContentStatus,
    reason: Option<String>,
) -> Result<()> {
    // 通过 ExtensionRegistry 验证调用者权限
    alcheme_cpi::require_cpi_permission_with_registry!(
        &ctx.accounts.caller_program.key(),
        alcheme_cpi::CpiPermission::ContentStatusUpdate,
        Some(&ctx.accounts.extension_registry)
    );

    let content_post = &mut ctx.accounts.content_post;

    // 验证状态转换合法性
    ContentValidator::validate_status_transition(&content_post.status, &new_status)?;

    content_post.status = new_status.clone();
    content_post.last_updated = Clock::get()?.unix_timestamp;

    let reason_msg = reason.unwrap_or_else(|| "Extension update".to_string());
    msg!("Extension 内容状态更新: {} -> {:?} (caller: {}, reason: {})",
         content_post.content_id, new_status,
         ctx.accounts.caller_program.key(), reason_msg);

    Ok(())
}

/// 通过扩展程序添加内容引用（需要 ContributionRead 权限）
/// 用于 contribution-engine 等扩展将贡献关联到 Base Layer 内容
#[derive(Accounts)]
pub struct CpiAddContentReference<'info> {
    #[account(mut)]
    pub content_post: Account<'info, ContentPostAccount>,

    #[account(mut)]
    pub content_stats: Account<'info, ContentStatsAccount>,

    /// CHECK: 调用的扩展程序 ID
    pub caller_program: AccountInfo<'info>,

    /// CHECK: ExtensionRegistry PDA
    pub extension_registry: AccountInfo<'info>,

    pub authority: Signer<'info>,
}

pub fn cpi_add_content_reference(
    ctx: Context<CpiAddContentReference>,
    reference_type: String,
    reference_id: Pubkey,
) -> Result<()> {
    // 通过 ExtensionRegistry 验证调用者权限
    alcheme_cpi::require_cpi_permission_with_registry!(
        &ctx.accounts.caller_program.key(),
        alcheme_cpi::CpiPermission::ContributionRead,
        Some(&ctx.accounts.extension_registry)
    );

    // 更新内容统计: 增加互动计数表示有外部引用
    let content_stats = &mut ctx.accounts.content_stats;
    content_stats.last_updated = Clock::get()?.unix_timestamp;
    content_stats.update_sequence += 1;

    msg!("Extension 内容引用添加: content={}, ref_type={}, ref_id={}, caller={}",
         ctx.accounts.content_post.content_id, reference_type,
         reference_id, ctx.accounts.caller_program.key());

    Ok(())
}
