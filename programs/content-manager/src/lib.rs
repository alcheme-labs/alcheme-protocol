use anchor_lang::prelude::*;
use alcheme_shared::{
    types::*, errors::*, constants::*, utils::*, validation::*,
    events::*, access::*, content::*, factory::*
};

pub mod instructions;
pub mod state;
pub mod validation;
pub mod storage;

// Re-export for convenience
pub use instructions::*;
pub use state::*;
pub use validation::*;
pub use storage::*;

// Program ID
declare_id!("FEut65PCemjUt7dRPe4GJhaj1u5czWndvgp7LCEbiV7y");

/// Content Manager Program - 内容管理器程序
#[program]
pub mod content_manager {
    use super::*;

    // ==================== 内容管理器管理 ====================

    /// 初始化内容管理器
    pub fn initialize_content_manager(
        ctx: Context<InitializeContentManager>,
        manager_config: ManagerConfig,
        storage_config: StorageConfig,
        moderation_config: ModerationConfig,
    ) -> Result<()> {
        instructions::initialize_content_manager(ctx, manager_config, storage_config, moderation_config)
    }

    /// 更新管理器配置
    pub fn update_manager_config(
        ctx: Context<UpdateManagerConfig>,
        new_manager_config: Option<ManagerConfig>,
        new_storage_config: Option<StorageConfig>,
        new_moderation_config: Option<ModerationConfig>,
    ) -> Result<()> {
        instructions::update_manager_config(ctx, new_manager_config, new_storage_config, new_moderation_config)
    }

    // ==================== 内容创建和管理 ====================

    /// 创建内容
    pub fn create_content(
        ctx: Context<CreateContent>,
        content_id: u64,
        content_data: ContentData,
        content_type: ContentType,
        metadata: ContentMetadata,
        visibility_settings: VisibilitySettings,
        external_uri: Option<String>,
    ) -> Result<()> {
        let _ = (
            ctx,
            content_id,
            content_data,
            content_type,
            metadata,
            visibility_settings,
            external_uri,
        );
        err!(AlchemeError::V1WritePathDisabled)
    }

    /// 创建内容（v2 最小锚点）
    pub fn create_content_v2(
        ctx: Context<CreateContentV2>,
        content_id: u64,
        content_hash: [u8; 32],
        uri_ref: String,
    ) -> Result<()> {
        instructions::create_content_v2(ctx, content_id, content_hash, uri_ref)
    }

    /// 创建内容（v2 最小锚点，显式 access/status）
    pub fn create_content_v2_with_access(
        ctx: Context<CreateContentV2>,
        content_id: u64,
        content_hash: [u8; 32],
        uri_ref: String,
        visibility: AccessLevel,
        status: ContentStatus,
    ) -> Result<()> {
        instructions::create_content_v2_with_access(
            ctx,
            content_id,
            content_hash,
            uri_ref,
            visibility,
            status,
        )
    }

    /// 创建内容（v2 最小锚点，显式 raw audience/status）
    pub fn create_content_v2_with_audience(
        ctx: Context<CreateContentV2>,
        content_id: u64,
        content_hash: [u8; 32],
        uri_ref: String,
        audience_kind: V2AudienceKind,
        audience_ref: u8,
        status: ContentStatus,
    ) -> Result<()> {
        instructions::create_content_v2_with_audience(
            ctx,
            content_id,
            content_hash,
            uri_ref,
            audience_kind,
            audience_ref,
            status,
        )
    }

    /// 发布内容（v2 生命周期）
    pub fn publish_content_v2(
        ctx: Context<UpdateContentV2Lifecycle>,
        content_id: u64,
    ) -> Result<()> {
        instructions::publish_content_v2(ctx, content_id)
    }

    /// 归档内容（v2 生命周期）
    pub fn archive_content_v2(
        ctx: Context<UpdateContentV2Lifecycle>,
        content_id: u64,
    ) -> Result<()> {
        instructions::archive_content_v2(ctx, content_id)
    }

    /// 恢复内容（v2 生命周期）
    pub fn restore_content_v2(
        ctx: Context<UpdateContentV2Lifecycle>,
        content_id: u64,
    ) -> Result<()> {
        instructions::restore_content_v2(ctx, content_id)
    }

    /// 锚定草稿进入结晶里程碑（v2 事件锚点）
    pub fn enter_draft_crystallization_v2(
        ctx: Context<AnchorDraftLifecycleV2>,
        draft_post_id: u64,
        policy_profile_digest: [u8; 32],
    ) -> Result<()> {
        instructions::enter_draft_crystallization_v2(ctx, draft_post_id, policy_profile_digest)
    }

    /// 锚定草稿生命周期归档里程碑（v2 事件锚点）
    pub fn archive_draft_lifecycle_v2(
        ctx: Context<AnchorDraftLifecycleV2>,
        draft_post_id: u64,
        policy_profile_digest: [u8; 32],
    ) -> Result<()> {
        instructions::archive_draft_lifecycle_v2(ctx, draft_post_id, policy_profile_digest)
    }

    /// 锚定草稿生命周期恢复里程碑（v2 事件锚点）
    pub fn restore_draft_lifecycle_v2(
        ctx: Context<AnchorDraftLifecycleV2>,
        draft_post_id: u64,
        policy_profile_digest: [u8; 32],
    ) -> Result<()> {
        instructions::restore_draft_lifecycle_v2(ctx, draft_post_id, policy_profile_digest)
    }

    /// 墓碑化内容（v2 生命周期）
    pub fn tombstone_content_v2(
        ctx: Context<UpdateContentV2Lifecycle>,
        content_id: u64,
    ) -> Result<()> {
        instructions::tombstone_content_v2(ctx, content_id)
    }

    /// 更新内容锚点（v2 链上控制链下内容）
    pub fn update_content_anchor_v2(
        ctx: Context<UpdateContentAnchorV2>,
        content_id: u64,
        content_hash: [u8; 32],
        uri_ref: String,
    ) -> Result<()> {
        instructions::update_content_anchor_v2(ctx, content_id, content_hash, uri_ref)
    }

    /// 更新内容
    pub fn update_content(
        ctx: Context<UpdateContent>,
        updates: ContentUpdate,
    ) -> Result<()> {
        instructions::update_content(ctx, updates)
    }

    /// 删除内容
    pub fn delete_content(
        ctx: Context<DeleteContent>,
        deletion_type: DeletionType,
    ) -> Result<()> {
        instructions::delete_content(ctx, deletion_type)
    }

    /// 创建回复
    pub fn create_reply(
        ctx: Context<CreateReply>,
        content_id: u64,
        parent_content: Pubkey,
        content_data: ContentData,
        metadata: ContentMetadata,
        external_uri: Option<String>,
    ) -> Result<()> {
        let _ = (ctx, content_id, parent_content, content_data, metadata, external_uri);
        err!(AlchemeError::V1WritePathDisabled)
    }

    /// 创建回复（v2 最小锚点）
    pub fn create_reply_v2(
        ctx: Context<CreateReplyV2>,
        content_id: u64,
        parent_content: Pubkey,
        content_hash: [u8; 32],
        uri_ref: String,
    ) -> Result<()> {
        instructions::create_reply_v2(ctx, content_id, parent_content, content_hash, uri_ref)
    }

    /// 创建回复（v2 最小锚点，by_id 关系）
    pub fn create_reply_v2_by_id(
        ctx: Context<CreateReplyV2ById>,
        content_id: u64,
        parent_content_id: u64,
        content_hash: [u8; 32],
        uri_ref: String,
    ) -> Result<()> {
        instructions::create_reply_v2_by_id(
            ctx,
            content_id,
            parent_content_id,
            content_hash,
            uri_ref,
        )
    }

    /// 创建引用
    pub fn create_quote(
        ctx: Context<CreateQuote>,
        content_id: u64,
        quoted_content: Pubkey,
        content_data: ContentData,
        metadata: ContentMetadata,
        external_uri: Option<String>,
    ) -> Result<()> {
        let _ = (ctx, content_id, quoted_content, content_data, metadata, external_uri);
        err!(AlchemeError::V1WritePathDisabled)
    }

    /// 创建引用（v2 最小锚点）
    pub fn create_quote_v2(
        ctx: Context<CreateQuoteV2>,
        content_id: u64,
        quoted_content: Pubkey,
        content_hash: [u8; 32],
        uri_ref: String,
    ) -> Result<()> {
        instructions::create_quote_v2(ctx, content_id, quoted_content, content_hash, uri_ref)
    }

    /// 创建引用（v2 最小锚点，by_id 关系）
    pub fn create_quote_v2_by_id(
        ctx: Context<CreateQuoteV2ById>,
        content_id: u64,
        quoted_content_id: u64,
        content_hash: [u8; 32],
        uri_ref: String,
    ) -> Result<()> {
        instructions::create_quote_v2_by_id(
            ctx,
            content_id,
            quoted_content_id,
            content_hash,
            uri_ref,
        )
    }

    /// 创建转发
    pub fn create_repost(
        ctx: Context<CreateRepost>,
        content_id: u64,
        original_content: Pubkey,
        additional_comment: Option<String>,
    ) -> Result<()> {
        let _ = (ctx, content_id, original_content, additional_comment);
        err!(AlchemeError::V1WritePathDisabled)
    }

    /// 创建转发（v2 最小锚点）
    pub fn create_repost_v2(
        ctx: Context<CreateRepostV2>,
        content_id: u64,
        original_content: Pubkey,
        content_hash: [u8; 32],
        uri_ref: String,
    ) -> Result<()> {
        instructions::create_repost_v2(ctx, content_id, original_content, content_hash, uri_ref)
    }

    /// 创建转发（v2 最小锚点，by_id 关系）
    pub fn create_repost_v2_by_id(
        ctx: Context<CreateRepostV2ById>,
        content_id: u64,
        original_content_id: u64,
        content_hash: [u8; 32],
        uri_ref: String,
    ) -> Result<()> {
        instructions::create_repost_v2_by_id(
            ctx,
            content_id,
            original_content_id,
            content_hash,
            uri_ref,
        )
    }

    // ==================== 互动统计管理 (Interaction Tracker) ====================

    /// 记录内容互动
    pub fn interact_with_content(
        ctx: Context<InteractWithContent>,
        interaction_type: InteractionType,
    ) -> Result<()> {
        instructions::interact_with_content(ctx, interaction_type)
    }

    /// 批量更新互动统计
    pub fn batch_update_interactions(
        ctx: Context<BatchUpdateInteractions>,
        interactions: Vec<ContentInteraction>,
    ) -> Result<()> {
        instructions::batch_update_interactions(ctx, interactions)
    }

/// 互动数据结构
#[derive(AnchorSerialize, AnchorDeserialize, Clone, Debug)]
pub struct ContentInteraction {
    pub content_id: Pubkey,
    pub interaction_type: InteractionType,
}

    /// 更新内容评分
    pub fn update_content_scores(
        ctx: Context<UpdateContentScores>,
        engagement_score: Option<f64>,
        quality_score: Option<f64>,
        trending_score: Option<f64>,
    ) -> Result<()> {
        instructions::update_content_scores(ctx, engagement_score, quality_score, trending_score)
    }

    // ==================== 内容状态管理 ====================

    /// 更新内容状态
    pub fn update_content_status(
        ctx: Context<UpdateContentStatus>,
        new_status: ContentStatus,
        reason: Option<String>,
    ) -> Result<()> {
        instructions::update_content_status(ctx, new_status, reason)
    }

    /// 设置内容可见性
    pub fn set_content_visibility(
        ctx: Context<SetContentVisibility>,
        visibility_settings: VisibilitySettings,
    ) -> Result<()> {
        instructions::set_content_visibility(ctx, visibility_settings)
    }

    /// 设置内容变现
    pub fn set_content_monetization(
        ctx: Context<SetContentMonetization>,
        monetization_info: Option<MonetizationInfo>,
    ) -> Result<()> {
        instructions::set_content_monetization(ctx, monetization_info)
    }

    // ==================== 存储管理 ====================

    /// 更新存储信息
    pub fn update_storage_info(
        ctx: Context<UpdateStorageInfo>,
        new_primary_uri: Option<String>,
        backup_uris: Option<Vec<String>>,
        storage_status: Option<StorageStatus>,
        cdn_uri: Option<String>,
    ) -> Result<()> {
        instructions::update_storage_info(ctx, new_primary_uri, backup_uris, storage_status, cdn_uri)
    }

    /// 迁移存储策略
    pub fn migrate_storage_strategy(
        ctx: Context<MigrateStorageStrategy>,
        new_strategy: StorageStrategy,
        new_primary_uri: String,
    ) -> Result<()> {
        instructions::migrate_storage_strategy(ctx, new_strategy, new_primary_uri)
    }

    // ==================== 查询接口 (CPI) ====================

    /// 获取内容信息 (CPI)
    pub fn get_content_info(
        ctx: Context<GetContentInfo>,
        content_id: Pubkey,
    ) -> Result<ContentPost> {
        instructions::get_content_info(ctx, content_id)
    }

    /// 验证内容所有权 (CPI)
    pub fn validate_content_ownership(
        ctx: Context<ValidateContentOwnership>,
        content_id: Pubkey,
        claimed_owner: Pubkey,
    ) -> Result<bool> {
        instructions::validate_content_ownership(ctx, content_id, claimed_owner)
    }

    /// 获取内容统计 (CPI)
    pub fn get_content_stats(
        ctx: Context<GetContentStats>,
        content_id: Pubkey,
    ) -> Result<ContentStats> {
        instructions::get_content_stats(ctx, content_id)
    }

    // ==================== 搜索和推荐 ====================

    /// 搜索内容
    pub fn search_content(
        ctx: Context<SearchContent>,
        query: SearchQuery,
        filters: SearchFilters,
        pagination: PaginationConfig,
    ) -> Result<Vec<ContentPost>> {
        instructions::search_content(ctx, query, filters, pagination)
    }

    /// 获取推荐内容
    pub fn get_recommended_content(
        ctx: Context<GetRecommendedContent>,
        user: Pubkey,
        recommendation_context: RecommendationContext,
    ) -> Result<Vec<ContentRecommendation>> {
        instructions::get_recommended_content(ctx, user, recommendation_context)
    }

    /// 获取趋势内容
    pub fn get_trending_content(
        ctx: Context<GetTrendingContent>,
        time_range: TimeRange,
        content_types: Option<Vec<ContentType>>,
        limit: u32,
    ) -> Result<Vec<ContentPost>> {
        instructions::get_trending_content(ctx, time_range, content_types, limit)
    }

    // ==================== Extension CPI 接口 ====================

    /// 通过扩展程序更新内容状态（需要 ContentStatusUpdate 权限）
    pub fn cpi_update_content_status(
        ctx: Context<CpiUpdateContentStatus>,
        new_status: ContentStatus,
        reason: Option<String>,
    ) -> Result<()> {
        instructions::cpi_update_content_status(ctx, new_status, reason)
    }

    /// 通过扩展程序添加内容引用（需要 ContributionRead 权限）
    pub fn cpi_add_content_reference(
        ctx: Context<CpiAddContentReference>,
        reference_type: String,
        reference_id: Pubkey,
    ) -> Result<()> {
        instructions::cpi_add_content_reference(ctx, reference_type, reference_id)
    }
}
