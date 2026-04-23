use anchor_lang::prelude::*;

/// 用户身份数据结构 - 完整实现
#[derive(AnchorSerialize, AnchorDeserialize, Clone, Debug)]
pub struct UserIdentity {
    // === 基础身份信息 ===
    pub identity_id: Pubkey,             // 唯一身份标识符
    pub primary_handle: String,          // 主要用户名
    pub alternative_handles: Vec<String>, // 备用用户名列表
    pub created_at: i64,                 // 创建时间戳
    pub last_active: i64,                // 最后活跃时间
    
    // === 身份验证状态 ===
    pub verification_level: VerificationLevel,
    pub verified_attributes: Vec<VerifiedAttribute>,
    pub verification_history: Vec<VerificationRecord>,
    
    // === 社交图谱数据 ===
    pub follower_count: u64,             // 关注者数量
    pub following_count: u64,            // 关注数量
    pub connection_strength: f64,        // 社交活跃度评分
    pub social_rank: u32,                // 社交影响力排名
    
    // === 内容创作统计 ===
    pub content_created: u64,            // 创建内容总数
    pub total_interactions: u64,         // 总互动次数
    pub content_quality_score: f64,      // 内容质量评分
    
    // === 信誉系统 ===
    pub reputation_score: f64,           // 综合信誉评分
    pub trust_score: f64,                // 信任度评分
    pub community_standing: CommunityStanding,
    
    // === 经济活动 ===
    pub tokens_earned: u64,              // 累计收入
    pub tokens_spent: u64,               // 累计支出
    pub economic_activity_score: f64,    // 经济活跃度
    pub last_economic_activity: i64,     // 最后经济活动时间
    
    // === 隐私与偏好 ===
    pub privacy_settings: PrivacyConfig,
    pub notification_preferences: NotificationConfig,
    pub display_preferences: DisplayConfig,
    
    // === 扩展数据 ===
    pub metadata_uri: String,            // 扩展元数据URI
    pub custom_attributes: Vec<KeyValue>, // 自定义属性
    pub app_specific_data: Vec<AppData>,  // 应用特定数据
}

/// 用户档案数据
#[derive(AnchorSerialize, AnchorDeserialize, Clone, Debug, PartialEq)]
pub struct ProfileData {
    pub display_name: String,
    pub bio: String,
    pub avatar_uri: String,
    pub banner_uri: String,
    pub website: Option<String>,
    pub location: Option<String>,
    pub custom_fields: Vec<KeyValue>,
}

/// 协议层公共档案快照
#[derive(AnchorSerialize, AnchorDeserialize, Clone, Debug, PartialEq, Default)]
pub struct ProtocolProfile {
    pub display_name: Option<String>,
    pub bio: Option<String>,
    pub avatar_uri: Option<String>,
    pub banner_uri: Option<String>,
    pub website: Option<String>,
    pub location: Option<String>,
    pub metadata_uri: String,
    pub custom_attributes: Vec<KeyValue>,
}

pub const RESERVED_PROFILE_DISPLAY_NAME_KEY: &str = "__profile.display_name";
pub const RESERVED_PROFILE_BIO_KEY: &str = "__profile.bio";
pub const RESERVED_PROFILE_AVATAR_URI_KEY: &str = "__profile.avatar_uri";
pub const RESERVED_PROFILE_BANNER_URI_KEY: &str = "__profile.banner_uri";
pub const RESERVED_PROFILE_WEBSITE_KEY: &str = "__profile.website";
pub const RESERVED_PROFILE_LOCATION_KEY: &str = "__profile.location";
pub const RESERVED_PROTOCOL_PROFILE_ATTRIBUTE_COUNT: usize = 6;

/// 键值对数据结构
#[derive(AnchorSerialize, AnchorDeserialize, Clone, Debug, PartialEq)]
pub struct KeyValue {
    pub key: String,
    pub value: String,
}

/// 验证等级
#[derive(AnchorSerialize, AnchorDeserialize, Clone, Debug, PartialEq)]
pub enum VerificationLevel {
    None,
    Basic,
    Verified,
    Premium,
}

/// 验证属性
#[derive(AnchorSerialize, AnchorDeserialize, Clone, Debug, PartialEq)]
pub struct VerifiedAttribute {
    pub attribute_type: String,
    pub attribute_value: String,
    pub verifier: Pubkey,
    pub verified_at: i64,
    pub expires_at: Option<i64>,
    pub verification_proof: String,
}

/// 验证记录
#[derive(AnchorSerialize, AnchorDeserialize, Clone, Debug, PartialEq)]
pub struct VerificationRecord {
    pub verification_id: String,
    pub verification_type: String,
    pub verifier: Pubkey,
    pub verified_at: i64,
    pub status: VerificationStatus,
    pub proof_uri: Option<String>,
    pub notes: Option<String>,
}

/// 验证状态
#[derive(AnchorSerialize, AnchorDeserialize, Clone, Debug, PartialEq)]
pub enum VerificationStatus {
    Pending,
    Approved,
    Rejected,
    Expired,
    Revoked,
}

/// 社区地位
#[derive(AnchorSerialize, AnchorDeserialize, Clone, Debug, PartialEq)]
pub enum CommunityStanding {
    NewMember,      // 新成员
    Regular,        // 普通成员
    Trusted,        // 可信成员
    Contributor,    // 贡献者
    Moderator,      // 版主
    Leader,         // 领导者
    Banned,         // 被封禁
    Suspended,      // 被暂停
}

/// 隐私配置
#[derive(AnchorSerialize, AnchorDeserialize, Clone, Debug, PartialEq)]
pub struct PrivacyConfig {
    pub profile_visibility: AccessLevel,
    pub content_visibility: AccessLevel,
    pub social_graph_visibility: AccessLevel,
    pub activity_visibility: AccessLevel,
    pub economic_data_visibility: AccessLevel,
    pub allow_direct_messages: bool,
    pub allow_mentions: bool,
    pub allow_content_indexing: bool,
    pub data_retention_days: Option<u32>,
}

/// 通知配置
#[derive(AnchorSerialize, AnchorDeserialize, Clone, Debug, PartialEq)]
pub struct NotificationConfig {
    pub email_notifications: bool,
    pub push_notifications: bool,
    pub in_app_notifications: bool,
    pub notification_types: Vec<NotificationType>,
    pub quiet_hours: Option<QuietHours>,
    pub frequency_limit: NotificationFrequency,
}

/// 通知类型
#[derive(AnchorSerialize, AnchorDeserialize, Clone, Debug, PartialEq)]
pub enum NotificationType {
    NewFollower,
    ContentLiked,
    ContentShared,
    ContentCommented,
    Mentioned,
    DirectMessage,
    SystemUpdate,
    SecurityAlert,
}

/// 安静时间
#[derive(AnchorSerialize, AnchorDeserialize, Clone, Debug, PartialEq)]
pub struct QuietHours {
    pub start_hour: u8,  // 0-23
    pub end_hour: u8,    // 0-23
    pub timezone: String,
}

/// 通知频率
#[derive(AnchorSerialize, AnchorDeserialize, Clone, Debug, PartialEq)]
pub enum NotificationFrequency {
    Immediate,
    Hourly,
    Daily,
    Weekly,
    Disabled,
}

/// 显示配置
#[derive(AnchorSerialize, AnchorDeserialize, Clone, Debug, PartialEq)]
pub struct DisplayConfig {
    pub theme: DisplayTheme,
    pub language: String,
    pub timezone: String,
    pub date_format: DateFormat,
    pub currency_display: CurrencyDisplay,
    pub content_filters: Vec<ContentFilter>,
    pub layout_preferences: LayoutPreferences,
}

/// 显示主题
#[derive(AnchorSerialize, AnchorDeserialize, Clone, Debug, PartialEq)]
pub enum DisplayTheme {
    Light,
    Dark,
    Auto,
    Custom(String),
}

/// 日期格式
#[derive(AnchorSerialize, AnchorDeserialize, Clone, Debug, PartialEq)]
pub enum DateFormat {
    ISO8601,
    US,
    EU,
    Custom(String),
}

/// 货币显示
#[derive(AnchorSerialize, AnchorDeserialize, Clone, Debug, PartialEq)]
pub struct CurrencyDisplay {
    pub primary_currency: String,
    pub show_usd_equivalent: bool,
    pub decimal_places: u8,
}

/// 内容过滤器
#[derive(AnchorSerialize, AnchorDeserialize, Clone, Debug, PartialEq)]
pub struct ContentFilter {
    pub filter_type: ContentFilterType,
    pub enabled: bool,
    pub severity: FilterSeverity,
}

/// 内容过滤类型
#[derive(AnchorSerialize, AnchorDeserialize, Clone, Debug, PartialEq)]
pub enum ContentFilterType {
    Adult,
    Violence,
    Profanity,
    Spam,
    Political,
    Religious,
    Custom(String),
}

/// 过滤严格度
#[derive(AnchorSerialize, AnchorDeserialize, Clone, Debug, PartialEq)]
pub enum FilterSeverity {
    Low,
    Medium,
    High,
    Strict,
}

/// 布局偏好
#[derive(AnchorSerialize, AnchorDeserialize, Clone, Debug, PartialEq)]
pub struct LayoutPreferences {
    pub feed_layout: FeedLayout,
    pub sidebar_enabled: bool,
    pub compact_mode: bool,
    pub auto_play_media: bool,
    pub show_previews: bool,
}

/// 信息流布局
#[derive(AnchorSerialize, AnchorDeserialize, Clone, Debug, PartialEq)]
pub enum FeedLayout {
    Timeline,
    Grid,
    List,
    Cards,
}

/// 应用特定数据
#[derive(AnchorSerialize, AnchorDeserialize, Clone, Debug, PartialEq)]
pub struct AppData {
    pub app_id: String,
    pub app_name: String,
    pub data_type: String,
    pub data: Vec<u8>,
    pub created_at: i64,
    pub updated_at: i64,
    pub permissions: Vec<AppPermission>,
}

/// 应用权限
#[derive(AnchorSerialize, AnchorDeserialize, Clone, Debug, PartialEq)]
pub enum AppPermission {
    ReadProfile,
    WriteProfile,
    ReadContent,
    WriteContent,
    ReadSocial,
    WriteSocial,
    ReadEconomic,
    WriteEconomic,
}

/// 内容数据结构
#[derive(AnchorSerialize, AnchorDeserialize, Clone, Debug)]
pub struct ContentData {
    pub content_id: u64,
    pub author: Pubkey,
    pub content_type: ContentType,
    pub text: String,
    pub media_attachments: Vec<MediaAttachment>,
    pub metadata: ContentMetadata,
    pub created_at: i64,
}

/// 内容类型
#[derive(AnchorSerialize, AnchorDeserialize, Clone, Debug, PartialEq)]
pub enum ContentType {
    Text,
    Image,
    Video,
    Audio,
    Document,
    Link,
    Poll,
    Event,
    Live,
}

impl ContentType {
    /// 获取类型判别符
    pub fn discriminant(&self) -> u8 {
        match self {
            ContentType::Text => 0,
            ContentType::Image => 1,
            ContentType::Video => 2,
            ContentType::Audio => 3,
            ContentType::Document => 4,
            ContentType::Link => 5,
            ContentType::Poll => 6,
            ContentType::Event => 7,
            ContentType::Live => 8,
        }
    }

    /// 是否为媒体类型
    pub fn is_media_type(&self) -> bool {
        matches!(self, 
            ContentType::Image | 
            ContentType::Video | 
            ContentType::Audio
        )
    }

    /// 是否为交互类型
    pub fn is_interactive_type(&self) -> bool {
        matches!(self, 
            ContentType::Poll | 
            ContentType::Event | 
            ContentType::Live
        )
    }

    /// 获取默认存储策略
    pub fn default_storage_strategy(&self) -> StorageStrategy {
        match self {
            ContentType::Text => StorageStrategy::OnChain,
            ContentType::Image | ContentType::Video | ContentType::Audio => StorageStrategy::Arweave,
            ContentType::Document => StorageStrategy::IPFS,
            ContentType::Live => StorageStrategy::IPFS, // 临时内容
            _ => StorageStrategy::Hybrid,
        }
    }
}

/// 媒体附件
#[derive(AnchorSerialize, AnchorDeserialize, Clone, Debug)]
pub struct MediaAttachment {
    pub media_type: String,
    pub uri: String,
    pub file_size: Option<u64>,
    pub dimensions: Option<Dimensions>,
    pub duration: Option<u32>,
}

/// 尺寸信息
#[derive(AnchorSerialize, AnchorDeserialize, Clone, Debug)]
pub struct Dimensions {
    pub width: u32,
    pub height: u32,
}

/// 内容元数据
#[derive(AnchorSerialize, AnchorDeserialize, Clone, Debug)]
pub struct ContentMetadata {
    pub title: Option<String>,
    pub description: Option<String>,
    pub tags: Vec<String>,
    pub language: Option<String>,
    pub content_warning: Option<String>,
    pub expires_at: Option<i64>,
}

/// 验证上下文
#[derive(AnchorSerialize, AnchorDeserialize, Clone, Debug)]
pub struct ValidationContext {
    pub requester: Pubkey,
    pub operation: OperationType,
    pub target: Option<Pubkey>,
    pub timestamp: i64,
    pub additional_data: Vec<u8>,
}

/// 操作类型
#[derive(AnchorSerialize, AnchorDeserialize, Clone, Debug, PartialEq)]
pub enum OperationType {
    IdentityRegistration,
    IdentityUpdate,
    ContentCreation,
    ContentUpdate,
    ContentInteraction,
    AccessRuleUpdate,
    PermissionCheck,
}

/// 权限类型
#[derive(AnchorSerialize, AnchorDeserialize, Clone, Debug, PartialEq)]
pub enum Permission {
    // === 基础操作权限 ===
    CreateContent,               // 创建内容
    EditContent,                 // 编辑内容
    DeleteContent,               // 删除内容
    ViewContent,                 // 查看内容
    
    // === 社交权限 ===
    FollowUser,                  // 关注用户
    UnfollowUser,                // 取消关注
    MessageUser,                 // 发送私信
    ViewProfile,                 // 查看个人资料
    EditProfile,                 // 编辑个人资料
    ViewFollowers,               // 查看关注者列表
    ViewFollowing,               // 查看关注列表
    
    // === 互动权限 ===
    LikeContent,                 // 点赞内容
    CommentContent,              // 评论内容
    ShareContent,                // 分享内容
    ReportContent,               // 举报内容
    InteractWithContent,         // 通用互动权限
    
    // === 社区权限 ===
    JoinCommunity,               // 加入社区
    LeaveCommunity,              // 离开社区
    CreateCommunity,             // 创建社区
    ModerateCommunity,           // 管理社区
    InviteMembers,               // 邀请成员
    RemoveMembers,               // 移除成员
    
    // === 系统权限 ===
    ManageSettings,              // 管理设置
    AccessAnalytics,             // 访问分析
    SystemAdmin,                 // 系统管理
    VerifyIdentity,              // 验证身份
    
    // === 传统权限 (保持兼容性) ===
    Follow,                      // 关注
    Message,                     // 消息
    Comment,                     // 评论
    Share,                       // 分享
    ModerateContent,             // 内容审核
    ManageUsers,                 // 用户管理
    ConfigureSystem,             // 系统配置
    
    // === 自定义权限 ===
    Custom(String),              // 自定义权限类型
}

/// 访问级别
#[derive(AnchorSerialize, AnchorDeserialize, Clone, Debug, PartialEq)]
pub enum AccessLevel {
    Public,
    Followers,
    Friends,
    Private,
    Custom,
}

/// 关系类型
#[derive(AnchorSerialize, AnchorDeserialize, Clone, Debug, PartialEq)]
pub enum RelationshipType {
    None,
    Follower,
    Following,
    Friend,
    Blocked,
    Muted,
    Moderator,
    Admin,
}

// ProtocolEvent 已移动到 events.rs 模块中，这里不再重复定义

/// 互动类型
#[derive(AnchorSerialize, AnchorDeserialize, Clone, Debug, PartialEq)]
pub enum InteractionType {
    Like,
    Dislike,
    Share,
    Comment,
    Bookmark,
    Report,
    View,
}

/// 存储策略
#[derive(AnchorSerialize, AnchorDeserialize, Clone, Debug, PartialEq)]
pub enum StorageStrategy {
    OnChain,
    Arweave,
    IPFS,
    Hybrid,
    Custom(String),
}

/// 存储信息
#[derive(AnchorSerialize, AnchorDeserialize, Clone, Debug)]
pub struct StorageInfo {
    pub strategy: StorageStrategy,
    pub primary_uri: String,
    pub backup_uris: Vec<String>,
    pub storage_cost: u64,
    pub retrieval_speed: StorageSpeed,
    pub durability: f64,
}

/// 存储速度
#[derive(AnchorSerialize, AnchorDeserialize, Clone, Debug, PartialEq)]
pub enum StorageSpeed {
    Instant,
    Fast,
    Medium,
    Slow,
}

/// 存储提供者类型 (用于前端 UI 标记和风险提示)
#[derive(AnchorSerialize, AnchorDeserialize, Clone, Debug, PartialEq)]
pub enum StorageProviderType {
    Decentralized, // Arweave, IPFS, OnChain - 去中心化存储
    Centralized,   // AWS, GCP, Cloudflare - 中心化云服务
    Personal,      // Self-hosted - 用户自建服务器
    Hybrid,        // 混合策略 (主存储 + CDN)
}

/// 内容状态
#[derive(AnchorSerialize, AnchorDeserialize, Clone, Debug, PartialEq)]
pub enum ContentStatus {
    Draft,                               // 草稿
    Published,                           // 已发布
    Archived,                            // 已归档
    Deleted,                             // 已删除
    Moderated,                           // 审核中
    Suspended,                           // 已暂停
    Flagged,                             // 已标记
    UnderReview,                         // 审核中
}

/// v2 内容受众类型（紧凑控制面）
#[derive(AnchorSerialize, AnchorDeserialize, Clone, Debug, PartialEq)]
pub enum V2AudienceKind {
    Public,
    Private,
    FollowersOnly,
    CircleOnly,
}

// ==================== 即时通讯数据结构 ====================

/// 会话类型
#[derive(AnchorSerialize, AnchorDeserialize, Clone, Debug, PartialEq)]
pub enum ConversationType {
    Direct,                              // 1对1
    Group,                               // 群聊
    Channel,                             // 频道（广播）
}

/// 会话元数据
#[derive(AnchorSerialize, AnchorDeserialize, Clone, Debug, PartialEq)]
pub struct ConversationMetadata {
    pub name: Option<String>,            // 群组名称
    pub description: Option<String>,
    pub avatar_uri: Option<String>,
    pub admin: Option<Pubkey>,           // 群管理员
    pub settings: ConversationSettings,
}

/// 会话设置
#[derive(AnchorSerialize, AnchorDeserialize, Clone, Debug, PartialEq)]
pub struct ConversationSettings {
    pub allow_new_members: bool,
    pub require_approval: bool,
    pub max_participants: u32,
    pub message_retention_days: Option<u32>,
}


/// 消息类型
#[derive(AnchorSerialize, AnchorDeserialize, Clone, Debug, PartialEq)]
pub enum MessageType {
    Text,
    Image,
    Video,
    Audio,
    File,
    Link,
    Payment,                             // 支付消息
    Contract,                            // 合约消息
    System,                              // 系统消息
}

/// 消息状态
#[derive(AnchorSerialize, AnchorDeserialize, Clone, Debug, PartialEq)]
pub enum MessageStatus {
    Sending,                             // 发送中
    Sent,                                // 已发送
    Delivered,                           // 已送达
    Read,                                // 已读
    Failed,                              // 发送失败
    Deleted,                             // 已删除
    Recalled,                            // 已撤回
}

/// 已读回执
#[derive(AnchorSerialize, AnchorDeserialize, Clone, Debug, PartialEq)]
pub struct ReadReceipt {
    pub reader: Pubkey,
    pub read_at: i64,
}


/// 消息批次状态
#[derive(AnchorSerialize, AnchorDeserialize, Clone, Debug, PartialEq)]
pub enum MessageBatchStatus {
    Collecting,                          // 收集中
    Sealed,                              // 已封存
    Verified,                            // 已验证
}

/// 在线状态
#[derive(AnchorSerialize, AnchorDeserialize, Clone, Debug, PartialEq)]
pub enum OnlineStatus {
    Online,
    Away,
    Busy,
    Offline,
    Invisible,
}

// ==================== Handle Manager 数据结构 ====================

/// 用户名映射 - Handle Manager 核心数据结构
#[derive(AnchorSerialize, AnchorDeserialize, Clone, Debug)]
pub struct HandleMapping {
    pub handle: String,
    pub identity_id: Pubkey,
    pub owner: Pubkey,
    pub created_at: i64,
    pub expires_at: Option<i64>,
    pub transfer_history: Vec<HandleTransfer>,
    pub is_primary: bool,
    pub is_reserved: bool,
    pub reservation_data: Option<ReservationData>,
}

/// 用户名转移记录
#[derive(AnchorSerialize, AnchorDeserialize, Clone, Debug, PartialEq)]
pub struct HandleTransfer {
    pub from_owner: Pubkey,
    pub to_owner: Pubkey,
    pub transferred_at: i64,
    pub transfer_fee: u64,
    pub transfer_reason: TransferReason,
}

/// 转移原因
#[derive(AnchorSerialize, AnchorDeserialize, Clone, Debug, PartialEq)]
pub enum TransferReason {
    Sale,
    Gift,
    Inheritance,
    Recovery,
    Administrative,
    Auction,
}

/// 保留数据
#[derive(AnchorSerialize, AnchorDeserialize, Clone, Debug, PartialEq)]
pub struct ReservationData {
    pub reserved_by: Pubkey,
    pub reserved_at: i64,
    pub reservation_fee: u64,
    pub reservation_period: i64,
    pub auto_release: bool,
}

/// 用户名状态
#[derive(AnchorSerialize, AnchorDeserialize, Clone, Debug, PartialEq)]
pub enum HandleStatus {
    Available,
    Reserved,
    Registered,
    Expired,
    Suspended,
    Banned,
}

// ==================== Profile Manager 数据结构 ====================

/// 身份注册表 - 主要管理结构
#[derive(AnchorSerialize, AnchorDeserialize, Clone, Debug)]
pub struct IdentityRegistry {
    pub bump: u8,
    pub admin: Pubkey,
    pub created_at: i64,
    pub last_updated: i64,
    pub total_identities: u64,
    pub active_identities: u64,
    pub total_handles_created: u64,
    pub registry_name: String,
    pub metadata_uri: String,
    pub settings: RegistrySettings,
    pub validation_config: ValidationConfig,
    pub fee_structure: FeeStructure,
    pub status: RegistryStatus,
    pub custom_settings: Vec<KeyValue>,
}

/// 注册表设置
#[derive(AnchorSerialize, AnchorDeserialize, Clone, Debug, PartialEq)]
pub struct RegistrySettings {
    pub allow_handle_transfers: bool,
    pub require_verification: bool,
    pub enable_reputation_system: bool,
    pub enable_social_features: bool,
    pub enable_economic_tracking: bool,
    pub max_handles_per_identity: u32,
    pub handle_reservation_period: i64,
    pub minimum_handle_length: u32,
    pub maximum_handle_length: u32,
}

/// 验证配置
#[derive(AnchorSerialize, AnchorDeserialize, Clone, Debug, PartialEq)]
pub struct ValidationConfig {
    pub required_validators: Vec<String>,
    pub optional_validators: Vec<String>,
    pub minimum_validation_score: f64,
    pub validation_timeout: i64,
    pub auto_approve_threshold: f64,
    pub require_manual_review: bool,
}

/// 费用结构
#[derive(AnchorSerialize, AnchorDeserialize, Clone, Debug, PartialEq)]
pub struct FeeStructure {
    pub registration_fee: u64,
    pub handle_transfer_fee: u64,
    pub verification_fee: u64,
    pub premium_features_fee: u64,
    pub fee_recipient: Pubkey,
    pub fee_distribution: FeeDistribution,
}

/// 费用分配
#[derive(AnchorSerialize, AnchorDeserialize, Clone, Debug, PartialEq)]
pub struct FeeDistribution {
    pub protocol_percentage: u8,
    pub registry_percentage: u8,
    pub validator_percentage: u8,
    pub community_percentage: u8,
}

/// 注册表状态
#[derive(AnchorSerialize, AnchorDeserialize, Clone, Debug, PartialEq)]
pub enum RegistryStatus {
    Active,
    Paused,
    Upgrading,
    Deprecated,
    Emergency,
}

/// 身份状态
#[derive(AnchorSerialize, AnchorDeserialize, Clone, Debug, PartialEq)]
pub enum IdentityStatus {
    Active,
    Inactive,
    Suspended,
    Banned,
    PendingVerification,
    UnderReview,
}

// ==================== 社交和经济数据结构 ====================

/// 社交统计
#[derive(AnchorSerialize, AnchorDeserialize, Clone, Debug, PartialEq)]
pub struct SocialStats {
    pub follower_count: u64,
    pub following_count: u64,
    pub mutual_follows: u64,
    pub connection_strength: f64,
    pub social_rank: u32,
    pub influence_score: f64,
    pub engagement_rate: f64,
    pub last_social_activity: i64,
}

/// 经济统计
#[derive(AnchorSerialize, AnchorDeserialize, Clone, Debug, PartialEq)]
pub struct EconomicStats {
    pub tokens_earned: u64,
    pub tokens_spent: u64,
    pub net_worth: i64,
    pub economic_activity_score: f64,
    pub transaction_count: u64,
    pub average_transaction_size: f64,
    pub last_economic_activity: i64,
    pub earning_categories: Vec<EarningCategory>,
}

/// 收入类别
#[derive(AnchorSerialize, AnchorDeserialize, Clone, Debug, PartialEq)]
pub struct EarningCategory {
    pub category: String,
    pub amount: u64,
    pub percentage: f64,
}

/// 内容创作统计
#[derive(AnchorSerialize, AnchorDeserialize, Clone, Debug, PartialEq)]
pub struct ContentCreationStats {
    pub content_created: u64,
    pub total_interactions: u64,
    pub content_quality_score: f64,
    pub popular_content_count: u64,
    pub viral_content_count: u64,
    pub content_categories: Vec<ContentCategoryStats>,
}

/// 内容类别统计
#[derive(AnchorSerialize, AnchorDeserialize, Clone, Debug, PartialEq)]
pub struct ContentCategoryStats {
    pub category: ContentType,
    pub count: u64,
    pub total_interactions: u64,
    pub average_quality_score: f64,
}

// ==================== 空间计算实现 ====================

impl VerifiedAttribute {
    pub const SPACE: usize = 
        4 + 64 + // attribute_type
        4 + 256 + // attribute_value
        32 + // verifier
        8 +  // verified_at
        9 +  // expires_at (Option<i64>)
        4 + 256; // verification_proof
}

impl VerificationRecord {
    pub const SPACE: usize = 
        4 + 64 + // verification_id
        4 + 64 + // verification_type
        32 + // verifier
        8 +  // verified_at
        1 +  // status
        4 + 256 + 1 + // proof_uri (Option<String>)
        4 + 256 + 1; // notes (Option<String>)
}

impl PrivacyConfig {
    pub const SPACE: usize = 
        1 +  // profile_visibility
        1 +  // content_visibility
        1 +  // social_graph_visibility
        1 +  // activity_visibility
        1 +  // economic_data_visibility
        1 +  // allow_direct_messages
        1 +  // allow_mentions
        1 +  // allow_content_indexing
        5;   // data_retention_days (Option<u32>)
}

impl NotificationConfig {
    pub const SPACE: usize = 
        1 +  // email_notifications
        1 +  // push_notifications
        1 +  // in_app_notifications
        4 + 8 * 1 + // notification_types (最多8种)
        1 + QuietHours::SPACE + // quiet_hours (Option)
        1;   // frequency_limit
}

impl QuietHours {
    pub const SPACE: usize = 
        1 +  // start_hour
        1 +  // end_hour
        4 + 32; // timezone
}

impl DisplayConfig {
    pub const SPACE: usize = 
        1 +  // theme
        4 + 10 + // language
        4 + 32 + // timezone
        1 +  // date_format
        CurrencyDisplay::SPACE +
        4 + 10 * ContentFilter::SPACE + // content_filters
        LayoutPreferences::SPACE;
}

impl CurrencyDisplay {
    pub const SPACE: usize = 
        4 + 10 + // primary_currency
        1 +  // show_usd_equivalent
        1;   // decimal_places
}

impl ContentFilter {
    pub const SPACE: usize = 
        1 +  // filter_type (enum + potential String)
        1 +  // enabled
        1;   // severity
}

impl LayoutPreferences {
    pub const SPACE: usize = 
        1 +  // feed_layout
        1 +  // sidebar_enabled
        1 +  // compact_mode
        1 +  // auto_play_media
        1;   // show_previews
}

impl AppData {
    pub const SPACE: usize = 
        4 + 64 + // app_id
        4 + 64 + // app_name
        4 + 32 + // data_type
        4 + 1024 + // data (最大1KB)
        8 +  // created_at
        8 +  // updated_at
        4 + 8 * 1; // permissions (最多8个)
}

impl KeyValue {
    pub const SPACE: usize = 
        4 + 64 + // key
        4 + 256; // value
}

impl HandleTransfer {
    pub const SPACE: usize = 
        32 + // from_owner
        32 + // to_owner
        8 +  // transferred_at
        8 +  // transfer_fee
        1;   // transfer_reason
}

impl ReservationData {
    pub const SPACE: usize = 
        32 + // reserved_by
        8 +  // reserved_at
        8 +  // reservation_fee
        8 +  // reservation_period
        1;   // auto_release
}

impl RegistrySettings {
    pub const SPACE: usize = 
        1 +  // allow_handle_transfers
        1 +  // require_verification
        1 +  // enable_reputation_system
        1 +  // enable_social_features
        1 +  // enable_economic_tracking
        4 +  // max_handles_per_identity
        8 +  // handle_reservation_period
        4 +  // minimum_handle_length
        4;   // maximum_handle_length
}

impl ValidationConfig {
    pub const SPACE: usize = 
        4 + 10 * (4 + 32) + // required_validators
        4 + 10 * (4 + 32) + // optional_validators
        8 +  // minimum_validation_score
        8 +  // validation_timeout
        8 +  // auto_approve_threshold
        1;   // require_manual_review
}

impl FeeStructure {
    pub const SPACE: usize = 
        8 +  // registration_fee
        8 +  // handle_transfer_fee
        8 +  // verification_fee
        8 +  // premium_features_fee
        32 + // fee_recipient
        FeeDistribution::SPACE;
}

impl FeeDistribution {
    pub const SPACE: usize = 
        1 +  // protocol_percentage
        1 +  // registry_percentage
        1 +  // validator_percentage
        1;   // community_percentage
}

// ==================== UserIdentity 方法实现 ====================

impl UserIdentity {
    /// 初始空间（空集合）
    pub const SPACE: usize = 
        8 +  // discriminator
        32 + // identity_id
        4 + 32 + // primary_handle (最大32字符)
        4 + // alternative_handles (空Vec)
        8 +  // created_at
        8 +  // last_active
        1 +  // verification_level
        4 + // verified_attributes (空Vec)
        4 + // verification_history (空Vec)
        8 +  // follower_count
        8 +  // following_count
        8 +  // connection_strength
        4 +  // social_rank
        8 +  // content_created
        8 +  // total_interactions
        8 +  // content_quality_score
        8 +  // reputation_score
        8 +  // trust_score
        1 +  // community_standing
        8 +  // tokens_earned
        8 +  // tokens_spent
        8 +  // economic_activity_score
        8 +  // last_economic_activity
        PrivacyConfig::SPACE +
        NotificationConfig::SPACE +
        DisplayConfig::SPACE +
        4 + // metadata_uri (空String)
        4 + // custom_attributes (空Vec)
        4; // app_specific_data (空Vec)

    /// 初始化新身份
    pub fn initialize(
        &mut self,
        identity_id: Pubkey,
        primary_handle: String,
        privacy_settings: PrivacyConfig,
    ) -> Result<()> {
        self.identity_id = identity_id;
        self.primary_handle = primary_handle;
        self.alternative_handles = Vec::new();
        self.created_at = Clock::get()?.unix_timestamp;
        self.last_active = self.created_at;
        
        // 初始化验证状态
        self.verification_level = VerificationLevel::None;
        self.verified_attributes = Vec::new();
        self.verification_history = Vec::new();
        
        // 初始化社交数据
        self.follower_count = 0;
        self.following_count = 0;
        self.connection_strength = 0.0;
        self.social_rank = 0;
        
        // 初始化内容统计
        self.content_created = 0;
        self.total_interactions = 0;
        self.content_quality_score = 0.0;
        
        // 初始化信誉系统
        self.reputation_score = crate::constants::DEFAULT_REPUTATION_SCORE;
        self.trust_score = crate::constants::DEFAULT_REPUTATION_SCORE;
        self.community_standing = CommunityStanding::NewMember;
        
        // 初始化经济活动
        self.tokens_earned = 0;
        self.tokens_spent = 0;
        self.economic_activity_score = 0.0;
        self.last_economic_activity = 0;
        
        // 设置配置
        self.privacy_settings = privacy_settings;
        self.notification_preferences = NotificationConfig {
            email_notifications: true,
            push_notifications: true,
            in_app_notifications: true,
            notification_types: vec![
                NotificationType::NewFollower,
                NotificationType::ContentLiked,
                NotificationType::Mentioned,
                NotificationType::DirectMessage,
                NotificationType::SecurityAlert,
            ],
            quiet_hours: None,
            frequency_limit: NotificationFrequency::Immediate,
        };
        self.display_preferences = DisplayConfig {
            theme: DisplayTheme::Auto,
            language: "en".to_string(),
            timezone: "UTC".to_string(),
            date_format: DateFormat::ISO8601,
            currency_display: CurrencyDisplay {
                primary_currency: "SOL".to_string(),
                show_usd_equivalent: true,
                decimal_places: 4,
            },
            content_filters: vec![
                ContentFilter {
                    filter_type: ContentFilterType::Spam,
                    enabled: true,
                    severity: FilterSeverity::High,
                },
            ],
            layout_preferences: LayoutPreferences {
                feed_layout: FeedLayout::Timeline,
                sidebar_enabled: true,
                compact_mode: false,
                auto_play_media: false,
                show_previews: true,
            },
        };
        
        // 初始化扩展数据
        self.metadata_uri = String::new();
        self.custom_attributes = Vec::new();
        self.app_specific_data = Vec::new();
        
        Ok(())
    }

    /// 更新最后活跃时间
    pub fn update_last_active(&mut self) -> Result<()> {
        self.last_active = Clock::get()?.unix_timestamp;
        Ok(())
    }

    pub fn protocol_profile(&self) -> ProtocolProfile {
        let mut profile = ProtocolProfile {
            metadata_uri: self.metadata_uri.clone(),
            custom_attributes: Vec::new(),
            ..ProtocolProfile::default()
        };

        for attribute in &self.custom_attributes {
            match attribute.key.as_str() {
                RESERVED_PROFILE_DISPLAY_NAME_KEY => {
                    profile.display_name = non_empty_profile_value(&attribute.value);
                }
                RESERVED_PROFILE_BIO_KEY => {
                    profile.bio = non_empty_profile_value(&attribute.value);
                }
                RESERVED_PROFILE_AVATAR_URI_KEY => {
                    profile.avatar_uri = non_empty_profile_value(&attribute.value);
                }
                RESERVED_PROFILE_BANNER_URI_KEY => {
                    profile.banner_uri = non_empty_profile_value(&attribute.value);
                }
                RESERVED_PROFILE_WEBSITE_KEY => {
                    profile.website = non_empty_profile_value(&attribute.value);
                }
                RESERVED_PROFILE_LOCATION_KEY => {
                    profile.location = non_empty_profile_value(&attribute.value);
                }
                _ => profile.custom_attributes.push(attribute.clone()),
            }
        }

        profile
    }

    pub fn write_protocol_profile(&mut self, profile: &ProtocolProfile) -> Result<()> {
        let mut stored_attributes = profile.custom_attributes.clone();
        append_reserved_profile_attribute(
            &mut stored_attributes,
            RESERVED_PROFILE_DISPLAY_NAME_KEY,
            profile.display_name.as_deref(),
        );
        append_reserved_profile_attribute(
            &mut stored_attributes,
            RESERVED_PROFILE_BIO_KEY,
            profile.bio.as_deref(),
        );
        append_reserved_profile_attribute(
            &mut stored_attributes,
            RESERVED_PROFILE_AVATAR_URI_KEY,
            profile.avatar_uri.as_deref(),
        );
        append_reserved_profile_attribute(
            &mut stored_attributes,
            RESERVED_PROFILE_BANNER_URI_KEY,
            profile.banner_uri.as_deref(),
        );
        append_reserved_profile_attribute(
            &mut stored_attributes,
            RESERVED_PROFILE_WEBSITE_KEY,
            profile.website.as_deref(),
        );
        append_reserved_profile_attribute(
            &mut stored_attributes,
            RESERVED_PROFILE_LOCATION_KEY,
            profile.location.as_deref(),
        );

        require!(
            stored_attributes.len()
                <= crate::constants::MAX_CUSTOM_FIELDS + RESERVED_PROTOCOL_PROFILE_ATTRIBUTE_COUNT,
            crate::AlchemeError::ProfileDataTooLarge
        );

        self.metadata_uri = profile.metadata_uri.clone();
        self.custom_attributes = stored_attributes;
        Ok(())
    }

    pub fn protocol_profile_account_size(&self, profile: &ProtocolProfile) -> Result<usize> {
        let mut candidate = self.clone();
        candidate.write_protocol_profile(profile)?;
        let serialized = candidate
            .try_to_vec()
            .map_err(|_| crate::AlchemeError::SerializationError)?;
        Ok(8 + serialized.len())
    }

    /// 添加验证属性
    pub fn add_verified_attribute(&mut self, attribute: VerifiedAttribute) -> Result<()> {
        // 检查是否已存在相同类型的属性
        if let Some(existing_index) = self.verified_attributes.iter()
            .position(|attr| attr.attribute_type == attribute.attribute_type) {
            // 替换现有属性
            self.verified_attributes[existing_index] = attribute;
        } else {
            // 添加新属性
            self.verified_attributes.push(attribute);
        }
        Ok(())
    }

    /// 更新声誉分数
    pub fn update_reputation(&mut self, reputation_delta: f64, trust_delta: f64) -> Result<()> {
        // 安全地更新声誉分数
        let new_reputation = (self.reputation_score + reputation_delta)
            .max(crate::constants::MIN_REPUTATION_SCORE)
            .min(crate::constants::MAX_REPUTATION_SCORE);
        
        let new_trust = (self.trust_score + trust_delta)
            .max(crate::constants::MIN_REPUTATION_SCORE)
            .min(crate::constants::MAX_REPUTATION_SCORE);
        
        self.reputation_score = new_reputation;
        self.trust_score = new_trust;
        
        // 根据声誉分数更新社区地位
        self.update_community_standing()?;
        
        Ok(())
    }

    /// 更新社区地位
    pub fn update_community_standing(&mut self) -> Result<()> {
        self.community_standing = match self.reputation_score {
            score if score >= 90.0 => CommunityStanding::Leader,
            score if score >= 80.0 => CommunityStanding::Moderator,
            score if score >= 70.0 => CommunityStanding::Contributor,
            score if score >= 60.0 => CommunityStanding::Trusted,
            score if score >= 40.0 => CommunityStanding::Regular,
            score if score >= 20.0 => CommunityStanding::NewMember,
            score if score >= 10.0 => CommunityStanding::Suspended,
            _ => CommunityStanding::Banned,
        };
        Ok(())
    }

    /// 更新社交统计
    pub fn update_social_stats(&mut self, follower_delta: i64, following_delta: i64) -> Result<()> {
        // 安全地更新关注者数量
        if follower_delta >= 0 {
            self.follower_count = self.follower_count.saturating_add(follower_delta as u64);
        } else {
            self.follower_count = self.follower_count.saturating_sub((-follower_delta) as u64);
        }
        
        // 安全地更新关注数量
        if following_delta >= 0 {
            self.following_count = self.following_count.saturating_add(following_delta as u64);
        } else {
            self.following_count = self.following_count.saturating_sub((-following_delta) as u64);
        }
        
        // 重新计算连接强度
        self.recalculate_connection_strength()?;
        
        Ok(())
    }

    /// 重新计算连接强度
    pub fn recalculate_connection_strength(&mut self) -> Result<()> {
        let total_connections = self.follower_count + self.following_count;
        let mutual_factor = if self.follower_count > 0 && self.following_count > 0 {
            (self.follower_count.min(self.following_count) as f64 / 
             self.follower_count.max(self.following_count) as f64) * 0.5
        } else {
            0.0
        };
        
        self.connection_strength = (total_connections as f64).log10() + mutual_factor;
        Ok(())
    }

    /// 更新经济统计
    pub fn update_economic_stats(&mut self, earned_delta: u64, spent_delta: u64) -> Result<()> {
        self.tokens_earned = self.tokens_earned.saturating_add(earned_delta);
        self.tokens_spent = self.tokens_spent.saturating_add(spent_delta);
        
        // 更新经济活动分数
        let total_activity = self.tokens_earned + self.tokens_spent;
        self.economic_activity_score = (total_activity as f64).log10();
        
        self.last_economic_activity = Clock::get()?.unix_timestamp;
        Ok(())
    }

    /// 更新内容创作统计
    pub fn update_content_stats(
        &mut self, 
        content_delta: u64, 
        interactions_delta: u64, 
        quality_score: f64
    ) -> Result<()> {
        self.content_created = self.content_created.saturating_add(content_delta);
        self.total_interactions = self.total_interactions.saturating_add(interactions_delta);
        
        // 加权平均更新质量分数
        if self.content_created > 0 {
            let weight = 1.0 / self.content_created as f64;
            self.content_quality_score = 
                self.content_quality_score * (1.0 - weight) + quality_score * weight;
        } else {
            self.content_quality_score = quality_score;
        }
        
        Ok(())
    }
}

impl HandleMapping {
    pub const SPACE: usize = 
        8 +  // discriminator
        4 + 32 + // handle
        32 + // identity_id
        32 + // owner
        8 +  // created_at
        9 +  // expires_at (Option<i64>)
        4 + // transfer_history (空Vec)
        1 +  // is_primary
        1 +  // is_reserved
        1; // reservation_data (None)

    /// 初始化用户名映射
    pub fn initialize(
        &mut self,
        handle: String,
        identity_id: Pubkey,
        owner: Pubkey,
        is_primary: bool,
    ) -> Result<()> {
        self.handle = handle;
        self.identity_id = identity_id;
        self.owner = owner;
        self.created_at = Clock::get()?.unix_timestamp;
        self.expires_at = None;
        self.transfer_history = Vec::new();
        self.is_primary = is_primary;
        self.is_reserved = false;
        self.reservation_data = None;
        Ok(())
    }

    /// 转移用户名
    pub fn transfer_to(
        &mut self,
        new_owner: Pubkey,
        transfer_reason: TransferReason,
        transfer_fee: u64,
    ) -> Result<()> {
        let transfer_record = HandleTransfer {
            from_owner: self.owner,
            to_owner: new_owner,
            transferred_at: Clock::get()?.unix_timestamp,
            transfer_fee,
            transfer_reason,
        };
        
        self.transfer_history.push(transfer_record);
        self.owner = new_owner;
        
        Ok(())
    }

    /// 设置预留状态
    pub fn set_reservation(
        &mut self,
        reservation_data: ReservationData,
    ) -> Result<()> {
        self.is_reserved = true;
        self.reservation_data = Some(reservation_data);
        Ok(())
    }

    /// 释放预留
    pub fn release_reservation(&mut self) -> Result<()> {
        self.is_reserved = false;
        self.reservation_data = None;
        Ok(())
    }
}

impl IdentityRegistry {
    pub const SPACE: usize = 
        8 +  // discriminator
        1 +  // bump
        32 + // admin
        8 +  // created_at
        8 +  // last_updated
        8 +  // total_identities
        8 +  // active_identities
        8 +  // total_handles_created
        4 + 64 + // registry_name
        4 + 256 + // metadata_uri
        RegistrySettings::SPACE +
        ValidationConfig::SPACE +
        FeeStructure::SPACE +
        1 +  // status
        4; // custom_settings (空Vec)

    /// 初始化注册表
    pub fn initialize(
        &mut self,
        bump: u8,
        admin: Pubkey,
        registry_name: String,
        metadata_uri: String,
        settings: RegistrySettings,
    ) -> Result<()> {
        self.bump = bump;
        self.admin = admin;
        self.created_at = Clock::get()?.unix_timestamp;
        self.last_updated = self.created_at;
        self.total_identities = 0;
        self.active_identities = 0;
        self.total_handles_created = 0;
        self.registry_name = registry_name;
        self.metadata_uri = metadata_uri;
        self.settings = settings;
        self.validation_config = ValidationConfig {
            required_validators: vec![
                "handle_format".to_string(),
                "identity_uniqueness".to_string(),
            ],
            optional_validators: vec![
                "profile_completeness".to_string(),
            ],
            minimum_validation_score: 70.0,
            validation_timeout: 60,
            auto_approve_threshold: 90.0,
            require_manual_review: false,
        };
        self.fee_structure = FeeStructure {
            registration_fee: crate::constants::IDENTITY_REGISTRATION_FEE,
            handle_transfer_fee: crate::constants::HANDLE_TRANSFER_FEE,
            verification_fee: crate::constants::VERIFICATION_FEE,
            premium_features_fee: 10_000_000, // 0.01 SOL
            fee_recipient: Pubkey::default(),
            fee_distribution: FeeDistribution {
                protocol_percentage: 50,
                registry_percentage: 30,
                validator_percentage: 15,
                community_percentage: 5,
            },
        };
        self.status = RegistryStatus::Active;
        self.custom_settings = Vec::new();
        
        Ok(())
    }

    /// 注册新身份
    pub fn register_identity(&mut self) -> Result<()> {
        self.total_identities = self.total_identities.saturating_add(1);
        self.active_identities = self.active_identities.saturating_add(1);
        self.last_updated = Clock::get()?.unix_timestamp;
        Ok(())
    }

    /// 注册新用户名
    pub fn register_handle(&mut self) -> Result<()> {
        self.total_handles_created = self.total_handles_created.saturating_add(1);
        self.last_updated = Clock::get()?.unix_timestamp;
        Ok(())
    }
}

// ==================== 默认实现 ====================

impl Default for NotificationConfig {
    fn default() -> Self {
        Self {
            email_notifications: true,
            push_notifications: true,
            in_app_notifications: true,
            notification_types: vec![
                NotificationType::NewFollower,
                NotificationType::ContentLiked,
                NotificationType::Mentioned,
                NotificationType::DirectMessage,
                NotificationType::SecurityAlert,
            ],
            quiet_hours: None,
            frequency_limit: NotificationFrequency::Immediate,
        }
    }
}

pub fn is_reserved_profile_attribute_key(key: &str) -> bool {
    matches!(
        key,
        RESERVED_PROFILE_DISPLAY_NAME_KEY
            | RESERVED_PROFILE_BIO_KEY
            | RESERVED_PROFILE_AVATAR_URI_KEY
            | RESERVED_PROFILE_BANNER_URI_KEY
            | RESERVED_PROFILE_WEBSITE_KEY
            | RESERVED_PROFILE_LOCATION_KEY
    )
}

fn append_reserved_profile_attribute(
    stored_attributes: &mut Vec<KeyValue>,
    key: &str,
    value: Option<&str>,
) {
    if let Some(value) = value.filter(|candidate| !candidate.is_empty()) {
        stored_attributes.push(KeyValue {
            key: key.to_string(),
            value: value.to_string(),
        });
    }
}

fn non_empty_profile_value(value: &str) -> Option<String> {
    let trimmed = value.trim();
    if trimmed.is_empty() {
        None
    } else {
        Some(trimmed.to_string())
    }
}

impl Default for DisplayConfig {
    fn default() -> Self {
        Self {
            theme: DisplayTheme::Auto,
            language: "en".to_string(),
            timezone: "UTC".to_string(),
            date_format: DateFormat::ISO8601,
            currency_display: CurrencyDisplay {
                primary_currency: "SOL".to_string(),
                show_usd_equivalent: true,
                decimal_places: 4,
            },
            content_filters: vec![
                ContentFilter {
                    filter_type: ContentFilterType::Spam,
                    enabled: true,
                    severity: FilterSeverity::High,
                },
            ],
            layout_preferences: LayoutPreferences {
                feed_layout: FeedLayout::Timeline,
                sidebar_enabled: true,
                compact_mode: false,
                auto_play_media: false,
                show_previews: true,
            },
        }
    }
}

impl Default for ValidationConfig {
    fn default() -> Self {
        Self {
            required_validators: vec![
                "handle_format".to_string(),
                "identity_uniqueness".to_string(),
            ],
            optional_validators: vec![
                "profile_completeness".to_string(),
            ],
            minimum_validation_score: 70.0,
            validation_timeout: 60,
            auto_approve_threshold: 90.0,
            require_manual_review: false,
        }
    }
}

impl Default for FeeStructure {
    fn default() -> Self {
        Self {
            registration_fee: crate::constants::IDENTITY_REGISTRATION_FEE,
            handle_transfer_fee: crate::constants::HANDLE_TRANSFER_FEE,
            verification_fee: crate::constants::VERIFICATION_FEE,
            premium_features_fee: 10_000_000, // 0.01 SOL
            fee_recipient: Pubkey::default(),
            fee_distribution: FeeDistribution {
                protocol_percentage: 50,
                registry_percentage: 30,
                validator_percentage: 15,
                community_percentage: 5,
            },
        }
    }
}
