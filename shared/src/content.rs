use anchor_lang::prelude::*;
use crate::types::*;
use crate::errors::AlchemeError;
use crate::constants::*;
use crate::events::TimeRange;
use crate::access::TimeWindow;

/// 内容管理器主账户
#[derive(AnchorSerialize, AnchorDeserialize, Clone, Debug)]
pub struct ContentManager {
    pub bump: u8,
    pub admin: Pubkey,
    pub created_at: i64,
    pub last_updated: i64,
    pub total_content: u64,
    pub active_content: u64,
    pub manager_config: ManagerConfig,
    pub storage_config: StorageConfig,
    pub moderation_config: ModerationConfig,
}

/// 主内容账户 - 核心不变数据 (~1-2KB)
#[derive(AnchorSerialize, AnchorDeserialize, Clone, Debug)]
pub struct ContentPost {
    // === 基础标识 ===
    pub content_id: u64,                 // 内容唯一标识符
    pub author_identity: Pubkey,         // 作者身份
    pub created_at: i64,                 // 创建时间戳
    pub last_updated: i64,               // 最后更新时间
    pub content_version: u32,            // 内容版本号
    
    // === 核心内容 ===
    pub content_type: ContentType,       // 内容类型
    pub content_hash: [u8; 32],          // 内容哈希验证
    pub primary_storage_uri: String,     // 主要存储URI
    pub content_preview: String,         // 内容预览（前200字符）
    
    // === 关系信息 ===
    pub reply_to: Option<Pubkey>,        // 回复的帖子
    pub quote_post: Option<Pubkey>,      // 引用的帖子
    pub repost_of: Option<Pubkey>,       // 转发的帖子
    pub thread_root: Option<Pubkey>,     // 话题根帖子
    pub thread_depth: u8,                // 线程深度 (限制最大32层)
    
    // === 治理信息 ===
    pub moderation_status: ModerationStatus, // 审核状态
    pub content_warnings: Vec<String>,   // 内容警告 (限制最大5个)
    pub visibility_settings: VisibilitySettings, // 可见性设置
    
    // === 基础元数据 ===
    pub tags: Vec<String>,               // 标签 (限制最大10个)
    pub categories: Vec<String>,         // 分类 (限制最大3个)
    pub language: Option<String>,        // 语言
    pub content_length: u32,             // 内容长度
    
    // === 关联账户 ===
    pub stats_account: Pubkey,           // 统计账户地址
    pub storage_account: Pubkey,         // 存储账户地址
    
    // === PDA 信息 ===
    pub bump: u8,                        // PDA bump
    pub status: ContentStatus,           // 内容状态
}

/// 互动统计账户 - 频繁更新数据 (~512 bytes)
#[derive(AnchorSerialize, AnchorDeserialize, Clone, Debug)]
pub struct ContentStats {
    pub content_id: Pubkey,              // 关联的内容ID
    
    // === 实时统计 (高频更新) ===
    pub like_count: u64,                 // 点赞数
    pub comment_count: u64,              // 评论数
    pub repost_count: u64,               // 转发数
    pub view_count: u64,                 // 查看数
    pub share_count: u64,                // 分享数
    pub bookmark_count: u64,             // 收藏数
    pub report_count: u64,               // 举报数
    
    // === 批量更新统计 ===
    pub engagement_score: f64,           // 参与度评分 (每小时更新)
    pub quality_score: f64,              // 质量评分 (每日更新)
    pub trending_score: f64,             // 趋势评分 (每15分钟更新)
    pub virality_score: f64,             // 病毒传播评分
    
    // === 时间窗口统计 ===
    pub last_24h_interactions: u64,     // 24小时互动数
    pub last_7d_interactions: u64,      // 7天互动数
    pub peak_interaction_time: i64,     // 峰值互动时间
    pub interaction_velocity: f64,      // 互动速度
    
    // === 更新信息 ===
    pub last_updated: i64,              // 最后更新时间
    pub update_sequence: u64,            // 更新序号
    pub bump: u8,                        // PDA bump
}

/// 存储信息账户 - 存储策略数据 (~1KB)
#[derive(AnchorSerialize, AnchorDeserialize, Clone, Debug)]
pub struct ContentStorage {
    pub content_id: Pubkey,              // 关联的内容ID
    
    // === 存储策略 ===
    pub storage_strategy: StorageStrategy, // 存储策略
    pub primary_uri: String,             // 主要存储URI
    pub backup_uris: Vec<String>,        // 备份存储URI (最大3个)
    
    // === 存储成本和状态 ===
    pub storage_cost: u64,               // 存储成本
    pub retrieval_speed: StorageSpeed,   // 检索速度
    pub durability_score: f64,           // 持久性评分
    pub storage_status: StorageStatus,   // 存储状态
    
    // === 存储提供商信息 ===
    pub arweave_tx_id: Option<String>,   // Arweave 交易ID
    pub ipfs_hash: Option<String>,       // IPFS 哈希
    pub custom_storage_info: Vec<KeyValue>, // 自定义存储信息
    
    // === 访问控制 ===
    pub access_permissions: Vec<StoragePermission>, // 存储访问权限
    pub encryption_enabled: bool,        // 是否加密
    pub encryption_key_ref: Option<String>, // 加密密钥引用
    
    // === Merkle Tree 优化信息 ===
    pub merkle_batch_id: Option<u64>,    // Merkle Tree 批次ID
    pub merkle_leaf_index: Option<u32>,  // 叶子节点索引
    pub merkle_proof: Option<Vec<[u8; 32]>>, // Merkle 证明路径
    
    // === 新增：存储提供者类型标记 (用于前端 UI 警告) ===
    pub storage_provider_type: StorageProviderType, // 区分去中心化/中心化/自建
    pub is_verified_provider: bool,      // 是否为已验证的存储提供商
    pub cdn_uri: Option<String>,         // CDN 加速 URI (混合策略)
    
    pub bump: u8,                        // PDA bump
}

/// 管理器配置
#[derive(AnchorSerialize, AnchorDeserialize, Clone, Debug)]
pub struct ManagerConfig {
    pub max_content_size: u32,           // 最大内容大小
    pub max_media_attachments: u8,       // 最大媒体附件数
    pub default_storage_strategy: StorageStrategy,
    pub auto_moderation_enabled: bool,
    pub thread_depth_limit: u8,
    pub quote_chain_limit: u8,
}

/// 存储配置
#[derive(AnchorSerialize, AnchorDeserialize, Clone, Debug)]
pub struct StorageConfig {
    pub text_threshold: u32,             // 文本链上存储阈值
    pub media_threshold: u64,            // 媒体文件链上存储阈值
    pub arweave_enabled: bool,           // 是否启用 Arweave
    pub ipfs_enabled: bool,              // 是否启用 IPFS
    pub compression_enabled: bool,       // 是否启用压缩
    pub backup_enabled: bool,            // 是否启用备份
}

/// 审核配置
#[derive(AnchorSerialize, AnchorDeserialize, Clone, Debug)]
pub struct ModerationConfig {
    pub auto_moderation: bool,           // 自动审核
    pub spam_detection: bool,            // 垃圾内容检测
    pub content_filtering: bool,         // 内容过滤
    pub community_moderation: bool,      // 社区审核
    pub appeal_process: bool,            // 申诉流程
}

/// 审核状态
#[derive(AnchorSerialize, AnchorDeserialize, Clone, Debug, PartialEq)]
pub enum ModerationStatus {
    Pending,                             // 待审核
    Approved,                            // 已批准
    Rejected,                            // 已拒绝
    Flagged,                             // 已标记
    UnderReview,                         // 审核中
    AutoApproved,                        // 自动批准
}

/// 存储状态
#[derive(AnchorSerialize, AnchorDeserialize, Clone, Debug, PartialEq)]
pub enum StorageStatus {
    Uploading,                           // 上传中
    Stored,                              // 已存储
    Failed,                              // 存储失败
    Migrating,                           // 迁移中
    Archived,                            // 已归档
}

/// 存储权限
#[derive(AnchorSerialize, AnchorDeserialize, Clone, Debug, PartialEq)]
pub enum StoragePermission {
    Read,                                // 读取权限
    Write,                               // 写入权限
    Delete,                              // 删除权限
    Share,                               // 分享权限
    Migrate,                             // 迁移权限
}

/// 可见性设置
#[derive(AnchorSerialize, AnchorDeserialize, Clone, Debug)]
pub struct VisibilitySettings {
    pub visibility_level: VisibilityLevel,
    pub quote_permission: QuotePermission,
    pub reply_permission: ReplyPermission,
    pub repost_permission: RepostPermission,
    pub comment_permission: CommentPermission,
}

/// 可见性级别
#[derive(AnchorSerialize, AnchorDeserialize, Clone, Debug, PartialEq)]
pub enum VisibilityLevel {
    Public,                              // 公开
    Followers,                           // 关注者可见
    Friends,                             // 好友可见
    Community(Pubkey),                   // 特定社区可见
    Custom(Vec<Pubkey>),                 // 自定义用户列表
    Private,                             // 私有
}

/// 引用权限
#[derive(AnchorSerialize, AnchorDeserialize, Clone, Debug, PartialEq)]
pub enum QuotePermission {
    Anyone,                              // 任何人都可以引用
    Followers,                           // 仅关注者可以引用
    ExplicitApproval,                    // 需要明确授权
    None,                                // 不允许引用
}

/// 回复权限
#[derive(AnchorSerialize, AnchorDeserialize, Clone, Debug, PartialEq)]
pub enum ReplyPermission {
    Anyone,                              // 任何人都可以回复
    Followers,                           // 仅关注者可以回复
    Mentioned,                           // 仅被提及的用户可以回复
    None,                                // 不允许回复
}

/// 转发权限
#[derive(AnchorSerialize, AnchorDeserialize, Clone, Debug, PartialEq)]
pub enum RepostPermission {
    Anyone,                              // 任何人都可以转发
    Followers,                           // 仅关注者可以转发
    ExplicitApproval,                    // 需要明确授权
    None,                                // 不允许转发
}

/// 评论权限
#[derive(AnchorSerialize, AnchorDeserialize, Clone, Debug, PartialEq)]
pub enum CommentPermission {
    Anyone,                              // 任何人都可以评论
    Followers,                           // 仅关注者可以评论
    Friends,                             // 仅好友可以评论
    None,                                // 不允许评论
}

/// 变现信息
#[derive(AnchorSerialize, AnchorDeserialize, Clone, Debug)]
pub struct MonetizationInfo {
    pub monetization_type: MonetizationType,
    pub price: u64,                      // 价格 (lamports)
    pub revenue_split: RevenueSplit,     // 收益分配
    pub payment_token: Option<Pubkey>,   // 支付代币
    pub subscription_model: Option<SubscriptionModel>,
}

/// 变现类型
#[derive(AnchorSerialize, AnchorDeserialize, Clone, Debug, PartialEq)]
pub enum MonetizationType {
    Free,                                // 免费
    OneTime,                             // 一次性付费
    Subscription,                        // 订阅制
    PayPerView,                          // 按次付费
    Donation,                            // 打赏
    NFT,                                 // NFT 销售
}

/// 收益分配
#[derive(AnchorSerialize, AnchorDeserialize, Clone, Debug)]
pub struct RevenueSplit {
    pub creator_percentage: u8,          // 创作者分成 (0-100)
    pub platform_percentage: u8,        // 平台分成
    pub referrer_percentage: u8,         // 推荐者分成
    pub community_percentage: u8,        // 社区分成
}

/// 订阅模型
#[derive(AnchorSerialize, AnchorDeserialize, Clone, Debug)]
pub struct SubscriptionModel {
    pub subscription_type: SubscriptionType,
    pub billing_cycle: BillingCycle,
    pub trial_period_days: Option<u32>,
    pub auto_renewal: bool,
}

/// 订阅类型
#[derive(AnchorSerialize, AnchorDeserialize, Clone, Debug, PartialEq)]
pub enum SubscriptionType {
    Basic,
    Premium,
    VIP,
    Custom(String),
}

/// 计费周期
#[derive(AnchorSerialize, AnchorDeserialize, Clone, Debug, PartialEq)]
pub enum BillingCycle {
    Daily,
    Weekly,
    Monthly,
    Quarterly,
    Yearly,
}

/// 内容更新数据
#[derive(AnchorSerialize, AnchorDeserialize, Clone, Debug)]
pub struct ContentUpdate {
    pub content_preview: Option<String>,
    pub tags: Option<Vec<String>>,
    pub categories: Option<Vec<String>>,
    pub visibility_settings: Option<VisibilitySettings>,
    pub content_warnings: Option<Vec<String>>,
    pub monetization: Option<MonetizationInfo>,
}

/// 搜索查询
#[derive(AnchorSerialize, AnchorDeserialize, Clone, Debug)]
pub struct SearchQuery {
    pub query_text: String,
    pub content_types: Option<Vec<ContentType>>,
    pub author_filter: Option<Pubkey>,
    pub time_range: Option<TimeRange>,
    pub min_quality_score: Option<f64>,
    pub tags: Option<Vec<String>>,
}

/// 搜索过滤器
#[derive(AnchorSerialize, AnchorDeserialize, Clone, Debug)]
pub struct SearchFilters {
    pub visibility_levels: Vec<VisibilityLevel>,
    pub moderation_status: Vec<ModerationStatus>,
    pub has_media: Option<bool>,
    pub min_interactions: Option<u64>,
    pub max_interactions: Option<u64>,
}

/// 推荐上下文
#[derive(AnchorSerialize, AnchorDeserialize, Clone, Debug)]
pub struct RecommendationContext {
    pub user_identity: Pubkey,
    pub recommendation_type: RecommendationType,
    pub max_results: u32,
    pub diversity_factor: f64,           // 多样性因子 (0.0-1.0)
    pub freshness_weight: f64,           // 新鲜度权重
    pub quality_weight: f64,             // 质量权重
    pub social_weight: f64,              // 社交权重
}

/// 推荐类型
#[derive(AnchorSerialize, AnchorDeserialize, Clone, Debug, PartialEq)]
pub enum RecommendationType {
    ForYou,                              // 为你推荐
    Trending,                            // 趋势内容
    Following,                           // 关注的人
    Similar,                             // 相似内容
    Popular,                             // 热门内容
}

/// 内容推荐
#[derive(AnchorSerialize, AnchorDeserialize, Clone, Debug)]
pub struct ContentRecommendation {
    pub content_id: Pubkey,
    pub recommendation_score: f64,
    pub recommendation_reason: String,
    pub predicted_engagement: f64,
}

/// 趋势分析
#[derive(AnchorSerialize, AnchorDeserialize, Clone, Debug)]
pub struct TrendAnalysis {
    pub trending_topics: Vec<TrendingTopic>,
    pub content_velocity: f64,
    pub engagement_patterns: Vec<EngagementPattern>,
    pub peak_hours: Vec<u8>,
    pub analysis_period: TimeRange,
}

/// 趋势话题
#[derive(AnchorSerialize, AnchorDeserialize, Clone, Debug)]
pub struct TrendingTopic {
    pub topic: String,
    pub mention_count: u64,
    pub growth_rate: f64,
    pub sentiment_score: f64,
}

/// 参与模式
#[derive(AnchorSerialize, AnchorDeserialize, Clone, Debug)]
pub struct EngagementPattern {
    pub pattern_type: PatternType,
    pub frequency: f64,
    pub strength: f64,
    pub time_windows: Vec<TimeWindow>,
}

/// 模式类型
#[derive(AnchorSerialize, AnchorDeserialize, Clone, Debug, PartialEq)]
pub enum PatternType {
    DailyPeak,                           // 日常高峰
    WeeklyTrend,                         // 周趋势
    SeasonalPattern,                     // 季节性模式
    EventDriven,                         // 事件驱动
}

/// 删除类型
#[derive(AnchorSerialize, AnchorDeserialize, Clone, Debug, PartialEq)]
pub enum DeletionType {
    SoftDelete,                          // 软删除 (标记为删除)
    HardDelete,                          // 硬删除 (完全移除)
    Archive,                             // 归档
}

/// v2 最小锚点关系
#[derive(AnchorSerialize, AnchorDeserialize, Clone, Debug, PartialEq)]
pub enum ContentAnchorRelation {
    None,
    Reply { parent_content: Pubkey },
    Repost { original_content: Pubkey },
    Quote { quoted_content: Pubkey },
    ReplyById { parent_content_id: u64 },
    RepostById { original_content_id: u64 },
    QuoteById { quoted_content_id: u64 },
}

impl ContentAnchorRelation {
    pub fn validate(&self) -> Result<()> {
        match self {
            ContentAnchorRelation::None => Ok(()),
            ContentAnchorRelation::Reply { parent_content } => {
                require!(*parent_content != Pubkey::default(), AlchemeError::InvalidOperation);
                Ok(())
            }
            ContentAnchorRelation::Repost { original_content } => {
                require!(*original_content != Pubkey::default(), AlchemeError::InvalidOperation);
                Ok(())
            }
            ContentAnchorRelation::Quote { quoted_content } => {
                require!(*quoted_content != Pubkey::default(), AlchemeError::InvalidOperation);
                Ok(())
            }
            ContentAnchorRelation::ReplyById { parent_content_id } => {
                require!(*parent_content_id > 0, AlchemeError::InvalidOperation);
                Ok(())
            }
            ContentAnchorRelation::RepostById { original_content_id } => {
                require!(*original_content_id > 0, AlchemeError::InvalidOperation);
                Ok(())
            }
            ContentAnchorRelation::QuoteById { quoted_content_id } => {
                require!(*quoted_content_id > 0, AlchemeError::InvalidOperation);
                Ok(())
            }
        }
    }
}

// ==================== 实现方法 ====================

impl ContentManager {
    pub const SPACE: usize = 
        8 +  // discriminator
        1 +  // bump
        32 + // admin
        8 +  // created_at
        8 +  // last_updated
        8 +  // total_content
        8 +  // active_content
        ManagerConfig::SPACE +
        StorageConfig::SPACE +
        ModerationConfig::SPACE;

    /// 初始化内容管理器
    pub fn initialize(
        &mut self,
        bump: u8,
        admin: Pubkey,
        manager_config: ManagerConfig,
        storage_config: StorageConfig,
        moderation_config: ModerationConfig,
    ) -> Result<()> {
        self.bump = bump;
        self.admin = admin;
        self.created_at = Clock::get()?.unix_timestamp;
        self.last_updated = self.created_at;
        self.total_content = 0;
        self.active_content = 0;
        self.manager_config = manager_config;
        self.storage_config = storage_config;
        self.moderation_config = moderation_config;
        
        Ok(())
    }

    /// 创建新内容
    pub fn create_content(&mut self) -> Result<()> {
        self.create_content_with_status(&ContentStatus::Published)
    }

    /// 创建新内容（按状态修正活跃计数）
    pub fn create_content_with_status(&mut self, status: &ContentStatus) -> Result<()> {
        self.total_content = self.total_content.saturating_add(1);
        if matches!(status, ContentStatus::Published) {
            self.active_content = self.active_content.saturating_add(1);
        }
        self.last_updated = Clock::get()?.unix_timestamp;
        Ok(())
    }

    /// 应用 v2 状态变更对统计的影响
    pub fn apply_v2_status_transition(
        &mut self,
        current_status: &ContentStatus,
        new_status: &ContentStatus,
    ) -> Result<()> {
        let was_active = matches!(current_status, ContentStatus::Published);
        let is_active = matches!(new_status, ContentStatus::Published);

        match (was_active, is_active) {
            (false, true) => {
                self.active_content = self.active_content.saturating_add(1);
            }
            (true, false) => {
                self.active_content = self.active_content.saturating_sub(1);
            }
            _ => {}
        }

        self.last_updated = Clock::get()?.unix_timestamp;
        Ok(())
    }

    /// 删除内容
    pub fn delete_content(&mut self, deletion_type: DeletionType) -> Result<()> {
        match deletion_type {
            DeletionType::SoftDelete | DeletionType::Archive => {
                // 软删除不减少总数，但减少活跃数
                self.active_content = self.active_content.saturating_sub(1);
            },
            DeletionType::HardDelete => {
                // 硬删除减少总数和活跃数
                self.total_content = self.total_content.saturating_sub(1);
                self.active_content = self.active_content.saturating_sub(1);
            },
        }
        self.last_updated = Clock::get()?.unix_timestamp;
        Ok(())
    }

}

impl ContentPost {
    pub const SPACE: usize = 
        8 +  // discriminator
        8 +  // content_id
        32 + // author_identity
        8 +  // created_at
        8 +  // last_updated
        4 +  // content_version
        1 +  // content_type
        32 + // content_hash
        4 + 256 + // primary_storage_uri
        4 + 200 + // content_preview
        33 + // reply_to (Option<Pubkey>)
        33 + // quote_post (Option<Pubkey>)
        33 + // repost_of (Option<Pubkey>)
        33 + // thread_root (Option<Pubkey>)
        1 +  // thread_depth
        1 +  // moderation_status
        4 + 5 * (4 + 64) + // content_warnings (最大5个)
        VisibilitySettings::SPACE +
        4 + 10 * (4 + 32) + // tags (最大10个)
        4 + 3 * (4 + 32) +  // categories (最大3个)
        4 + 10 + 1 + // language (Option<String>)
        4 +  // content_length
        32 + // stats_account
        32 + // storage_account
        1 +  // bump
        1;   // status

    /// 初始化内容帖子
    pub fn initialize(
        &mut self,
        content_id: u64,
        author_identity: Pubkey,
        content_type: ContentType,
        content_hash: [u8; 32],
        primary_storage_uri: String,
        content_preview: String,
        visibility_settings: VisibilitySettings,
        stats_account: Pubkey,
        storage_account: Pubkey,
        bump: u8,
    ) -> Result<()> {
        self.content_id = content_id;
        self.author_identity = author_identity;
        self.created_at = Clock::get()?.unix_timestamp;
        self.last_updated = self.created_at;
        self.content_version = 1;
        self.content_type = content_type;
        self.content_hash = content_hash;
        self.primary_storage_uri = primary_storage_uri;
        self.content_length = content_preview.len() as u32;
        self.content_preview = content_preview;
        
        // 初始化关系信息
        self.reply_to = None;
        self.quote_post = None;
        self.repost_of = None;
        self.thread_root = None;
        self.thread_depth = 0;
        
        // 初始化治理信息
        self.moderation_status = ModerationStatus::Pending;
        self.content_warnings = Vec::new();
        self.visibility_settings = visibility_settings;
        
        // 初始化元数据
        self.tags = Vec::new();
        self.categories = Vec::new();
        self.language = None;
        
        // 设置关联账户
        self.stats_account = stats_account;
        self.storage_account = storage_account;
        
        self.bump = bump;
        self.status = ContentStatus::Published;
        
        Ok(())
    }

    /// 更新内容
    pub fn update_content(&mut self, updates: ContentUpdate) -> Result<()> {
        if let Some(content_preview) = updates.content_preview {
            self.content_preview = content_preview;
            self.content_length = self.content_preview.len() as u32;
        }
        
        if let Some(tags) = updates.tags {
            require!(tags.len() <= 10, AlchemeError::InvalidOperation);
            self.tags = tags;
        }
        
        if let Some(categories) = updates.categories {
            require!(categories.len() <= 3, AlchemeError::InvalidOperation);
            self.categories = categories;
        }
        
        if let Some(visibility_settings) = updates.visibility_settings {
            self.visibility_settings = visibility_settings;
        }
        
        if let Some(content_warnings) = updates.content_warnings {
            require!(content_warnings.len() <= 5, AlchemeError::InvalidOperation);
            self.content_warnings = content_warnings;
        }
        
        self.content_version = self.content_version.saturating_add(1);
        self.last_updated = Clock::get()?.unix_timestamp;
        
        Ok(())
    }

    /// 设置为回复
    pub fn set_as_reply(&mut self, parent_content: Pubkey, thread_root: Option<Pubkey>, depth: u8) -> Result<()> {
        require!(depth <= 32, AlchemeError::InvalidOperation);
        
        self.reply_to = Some(parent_content);
        self.thread_root = thread_root.or(Some(parent_content));
        self.thread_depth = depth;
        self.last_updated = Clock::get()?.unix_timestamp;
        
        Ok(())
    }

    /// 设置为引用
    pub fn set_as_quote(&mut self, quoted_content: Pubkey) -> Result<()> {
        self.quote_post = Some(quoted_content);
        self.last_updated = Clock::get()?.unix_timestamp;
        Ok(())
    }

    /// 设置为转发
    pub fn set_as_repost(&mut self, original_content: Pubkey) -> Result<()> {
        self.repost_of = Some(original_content);
        self.last_updated = Clock::get()?.unix_timestamp;
        Ok(())
    }
}

impl ContentStats {
    pub const SPACE: usize = 
        8 +  // discriminator
        32 + // content_id
        8 +  // like_count
        8 +  // comment_count
        8 +  // repost_count
        8 +  // view_count
        8 +  // share_count
        8 +  // bookmark_count
        8 +  // report_count
        8 +  // engagement_score
        8 +  // quality_score
        8 +  // trending_score
        8 +  // virality_score
        8 +  // last_24h_interactions
        8 +  // last_7d_interactions
        8 +  // peak_interaction_time
        8 +  // interaction_velocity
        8 +  // last_updated
        8 +  // update_sequence
        1;   // bump

    /// 初始化统计
    pub fn initialize(&mut self, content_id: Pubkey, bump: u8) -> Result<()> {
        self.content_id = content_id;
        
        // 初始化所有计数器为0
        self.like_count = 0;
        self.comment_count = 0;
        self.repost_count = 0;
        self.view_count = 0;
        self.share_count = 0;
        self.bookmark_count = 0;
        self.report_count = 0;
        
        // 初始化评分
        self.engagement_score = 0.0;
        self.quality_score = 50.0; // 默认质量评分
        self.trending_score = 0.0;
        self.virality_score = 0.0;
        
        // 初始化时间窗口统计
        self.last_24h_interactions = 0;
        self.last_7d_interactions = 0;
        self.peak_interaction_time = 0;
        self.interaction_velocity = 0.0;
        
        // 初始化更新信息
        self.last_updated = Clock::get()?.unix_timestamp;
        self.update_sequence = 0;
        self.bump = bump;
        
        Ok(())
    }

    /// 更新互动统计
    pub fn update_interaction(&mut self, interaction_type: InteractionType) -> Result<()> {
        match interaction_type {
            InteractionType::Like => {
                self.like_count = self.like_count.saturating_add(1);
            },
            InteractionType::Comment => {
                self.comment_count = self.comment_count.saturating_add(1);
            },
            InteractionType::Share => {
                self.share_count = self.share_count.saturating_add(1);
                self.repost_count = self.repost_count.saturating_add(1);
            },
            InteractionType::View => {
                self.view_count = self.view_count.saturating_add(1);
            },
            InteractionType::Bookmark => {
                self.bookmark_count = self.bookmark_count.saturating_add(1);
            },
            InteractionType::Report => {
                self.report_count = self.report_count.saturating_add(1);
            },
            _ => {},
        }
        
        // 更新时间窗口统计
        self.update_time_window_stats()?;
        
        // 更新序号和时间
        self.update_sequence = self.update_sequence.saturating_add(1);
        self.last_updated = Clock::get()?.unix_timestamp;
        
        Ok(())
    }

    /// 更新时间窗口统计
    fn update_time_window_stats(&mut self) -> Result<()> {
        let current_time = Clock::get()?.unix_timestamp;
        
        // 计算总互动数
        let total_interactions = self.like_count + self.comment_count + 
                                self.repost_count + self.share_count + 
                                self.bookmark_count;
        
        // 更新24小时统计 (简化实现)
        self.last_24h_interactions = total_interactions;
        self.last_7d_interactions = total_interactions;
        
        // 更新互动速度 (互动数/小时)
        // 注意：ContentStats 没有 created_at 字段，需要从关联的 ContentPost 获取
        // 简化实现：使用 last_updated 作为创建时间的近似值
        if self.last_updated > 0 {
            let hours_since_creation = (current_time - self.last_updated) / 3600;
            if hours_since_creation > 0 {
                self.interaction_velocity = total_interactions as f64 / hours_since_creation as f64;
            }
        }
        
        Ok(())
    }

    /// 重新计算参与度评分
    pub fn recalculate_engagement_score(&mut self) -> Result<()> {
        let total_interactions = self.like_count + self.comment_count + 
                               self.repost_count + self.share_count;
        
        // 简化的参与度评分算法
        let base_score = (total_interactions as f64).log10().max(0.0);
        let velocity_bonus = self.interaction_velocity.min(10.0);
        let recency_factor = self.calculate_recency_factor()?;
        
        self.engagement_score = (base_score + velocity_bonus) * recency_factor;
        
        Ok(())
    }

    /// 计算新鲜度因子
    fn calculate_recency_factor(&self) -> Result<f64> {
        let current_time = Clock::get()?.unix_timestamp;
        let hours_since_creation = (current_time - self.last_updated) / 3600;
        
        // 24小时内的内容有更高的新鲜度因子
        if hours_since_creation <= 24 {
            Ok(1.0)
        } else if hours_since_creation <= 168 { // 7天
            Ok(0.8)
        } else if hours_since_creation <= 720 { // 30天
            Ok(0.5)
        } else {
            Ok(0.2)
        }
    }
}

impl ContentStorage {
    pub const SPACE: usize = 
        8 +  // discriminator
        32 + // content_id
        1 +  // storage_strategy
        4 + 256 + // primary_uri
        4 + 3 * (4 + 256) + // backup_uris (最大3个)
        8 +  // storage_cost
        1 +  // retrieval_speed
        8 +  // durability_score
        1 +  // storage_status
        4 + 43 + 1 + // arweave_tx_id (Option<String>)
        4 + 46 + 1 + // ipfs_hash (Option<String>)
        4 + 10 * KeyValue::SPACE + // custom_storage_info
        4 + 5 * 1 + // access_permissions (最大5个)
        1 +  // encryption_enabled
        4 + 64 + 1 + // encryption_key_ref (Option<String>)
        9 +  // merkle_batch_id (Option<u64>)
        5 +  // merkle_leaf_index (Option<u32>)
        4 + 10 * 32 + 1 + // merkle_proof (Option<Vec<[u8; 32]>>)
        1 +  // storage_provider_type
        1 +  // is_verified_provider
        4 + 256 + 1 + // cdn_uri (Option<String>)
        1;   // bump

    /// 初始化账户空间（覆盖当前可写路径上限）
    pub const INIT_SPACE: usize =
        8 +  // discriminator
        32 + // content_id
        1 +  // storage_strategy
        4 + 256 + // primary_uri
        4 + 3 * (4 + 256) + // backup_uris (最大3个，每个256)
        8 +  // storage_cost
        1 +  // retrieval_speed
        8 +  // durability_score
        1 +  // storage_status
        1 +  // arweave_tx_id (None)
        1 +  // ipfs_hash (None)
        4 +  // custom_storage_info (empty Vec)
        4 + 1 + // access_permissions (1个枚举值)
        1 +  // encryption_enabled
        1 +  // encryption_key_ref (None)
        1 +  // merkle_batch_id (None)
        1 +  // merkle_leaf_index (None)
        1 +  // merkle_proof (None)
        1 +  // storage_provider_type
        1 +  // is_verified_provider
        4 + 256 + 1 + // cdn_uri (Option<String>, 最大256)
        1;   // bump

    /// 初始化存储信息
    pub fn initialize(
        &mut self,
        content_id: Pubkey,
        storage_strategy: StorageStrategy,
        primary_uri: String,
        storage_cost: u64,
        bump: u8,
    ) -> Result<()> {
        require!(primary_uri.len() <= 256, AlchemeError::InvalidOperation);

        let provider_type = match &storage_strategy {
            StorageStrategy::Hybrid => StorageProviderType::Hybrid,
            StorageStrategy::Custom(_) => StorageProviderType::Centralized,
            _ => StorageProviderType::Decentralized,
        };
        let is_verified_provider = matches!(&storage_strategy, StorageStrategy::OnChain);

        self.content_id = content_id;
        self.storage_strategy = storage_strategy;
        self.primary_uri = primary_uri;
        self.backup_uris = Vec::new();
        self.storage_cost = storage_cost;
        self.retrieval_speed = StorageSpeed::Medium;
        self.durability_score = 0.95; // 默认持久性评分
        self.storage_status = StorageStatus::Uploading;
        
        // 初始化存储提供商信息
        self.arweave_tx_id = None;
        self.ipfs_hash = None;
        self.custom_storage_info = Vec::new();
        
        // 初始化访问控制
        self.access_permissions = vec![StoragePermission::Read];
        self.encryption_enabled = false;
        self.encryption_key_ref = None;
        
        // 初始化 Merkle Tree 信息
        self.merkle_batch_id = None;
        self.merkle_leaf_index = None;
        self.merkle_proof = None;

        self.storage_provider_type = provider_type;
        self.is_verified_provider = is_verified_provider;
        self.cdn_uri = None;

        self.bump = bump;
        
        Ok(())
    }

    /// 更新存储状态
    pub fn update_storage_status(&mut self, status: StorageStatus) -> Result<()> {
        self.storage_status = status;
        Ok(())
    }

    /// 添加备份URI
    pub fn add_backup_uri(&mut self, backup_uri: String) -> Result<()> {
        require!(self.backup_uris.len() < 3, AlchemeError::InvalidOperation);
        require!(backup_uri.len() <= 256, AlchemeError::InvalidOperation);
        self.backup_uris.push(backup_uri);
        Ok(())
    }

    /// 设置 Merkle Tree 信息
    pub fn set_merkle_info(
        &mut self,
        batch_id: u64,
        leaf_index: u32,
        proof: Vec<[u8; 32]>,
    ) -> Result<()> {
        require!(proof.len() <= 10, AlchemeError::InvalidOperation);
        self.merkle_batch_id = Some(batch_id);
        self.merkle_leaf_index = Some(leaf_index);
        self.merkle_proof = Some(proof);
        Ok(())
    }
}

// ==================== 空间计算实现 ====================

impl ManagerConfig {
    pub const SPACE: usize = 
        4 +  // max_content_size
        1 +  // max_media_attachments
        1 +  // default_storage_strategy
        1 +  // auto_moderation_enabled
        1 +  // thread_depth_limit
        1;   // quote_chain_limit
}

impl StorageConfig {
    pub const SPACE: usize = 
        4 +  // text_threshold
        8 +  // media_threshold
        1 +  // arweave_enabled
        1 +  // ipfs_enabled
        1 +  // compression_enabled
        1;   // backup_enabled
}

impl ModerationConfig {
    pub const SPACE: usize = 
        1 +  // auto_moderation
        1 +  // spam_detection
        1 +  // content_filtering
        1 +  // community_moderation
        1;   // appeal_process
}

impl VisibilitySettings {
    pub const SPACE: usize = 
        1 +  // visibility_level
        1 +  // quote_permission
        1 +  // reply_permission
        1 +  // repost_permission
        1;   // comment_permission
}

// ==================== 默认实现 ====================

impl Default for ManagerConfig {
    fn default() -> Self {
        Self {
            max_content_size: MAX_CONTENT_SIZE as u32,
            max_media_attachments: MAX_MEDIA_ATTACHMENTS as u8,
            default_storage_strategy: StorageStrategy::Hybrid,
            auto_moderation_enabled: true,
            thread_depth_limit: 32,
            quote_chain_limit: 10,
        }
    }
}

impl Default for StorageConfig {
    fn default() -> Self {
        Self {
            text_threshold: ON_CHAIN_STORAGE_THRESHOLD as u32,
            media_threshold: ARWEAVE_STORAGE_THRESHOLD,
            arweave_enabled: true,
            ipfs_enabled: true,
            compression_enabled: true,
            backup_enabled: true,
        }
    }
}

impl Default for ModerationConfig {
    fn default() -> Self {
        Self {
            auto_moderation: true,
            spam_detection: true,
            content_filtering: true,
            community_moderation: false,
            appeal_process: true,
        }
    }
}

impl Default for VisibilitySettings {
    fn default() -> Self {
        Self {
            visibility_level: VisibilityLevel::Public,
            quote_permission: QuotePermission::Anyone,
            reply_permission: ReplyPermission::Anyone,
            repost_permission: RepostPermission::Anyone,
            comment_permission: CommentPermission::Anyone,
        }
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    fn storage_at_current_writable_limits() -> ContentStorage {
        ContentStorage {
            content_id: Pubkey::new_unique(),
            storage_strategy: StorageStrategy::IPFS,
            primary_uri: "p".repeat(256),
            backup_uris: vec!["b".repeat(256), "c".repeat(256), "d".repeat(256)],
            storage_cost: 42,
            retrieval_speed: StorageSpeed::Medium,
            durability_score: 0.95,
            storage_status: StorageStatus::Uploading,
            arweave_tx_id: None,
            ipfs_hash: None,
            custom_storage_info: Vec::new(),
            access_permissions: vec![StoragePermission::Read],
            encryption_enabled: false,
            encryption_key_ref: None,
            merkle_batch_id: None,
            merkle_leaf_index: None,
            merkle_proof: None,
            storage_provider_type: StorageProviderType::Decentralized,
            is_verified_provider: false,
            cdn_uri: Some("x".repeat(256)),
            bump: 255,
        }
    }

    #[test]
    fn content_storage_init_space_fits_current_writable_limits() {
        let storage = storage_at_current_writable_limits();
        let serialized = storage.try_to_vec().expect("content storage should serialize");
        let required_space = 8 + serialized.len();

        assert!(
            required_space <= ContentStorage::INIT_SPACE,
            "required_space={} exceeds init_space={}",
            required_space,
            ContentStorage::INIT_SPACE
        );
    }

    #[test]
    fn content_storage_init_space_is_smaller_than_full_space() {
        assert!(
            ContentStorage::INIT_SPACE < ContentStorage::SPACE,
            "init_space={} full_space={}",
            ContentStorage::INIT_SPACE,
            ContentStorage::SPACE
        );
    }
}
