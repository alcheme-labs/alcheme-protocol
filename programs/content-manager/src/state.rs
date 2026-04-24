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

/// 内容更新协调器状态
#[derive(AnchorSerialize, AnchorDeserialize, Clone, Debug)]
pub struct ContentUpdateCoordinator {
    pub pending_updates: Vec<PendingUpdate>,
    pub batch_update_interval: u32,      // 批量更新间隔（秒）
    pub last_batch_update: i64,          // 最后批量更新时间
    pub update_queue_size: u32,          // 更新队列大小
}

/// 待处理更新
#[derive(AnchorSerialize, AnchorDeserialize, Clone, Debug)]
pub struct PendingUpdate {
    pub content_id: Pubkey,
    pub update_type: UpdateType,
    pub update_data: Vec<u8>,
    pub priority: UpdatePriority,
    pub created_at: i64,
}

/// 更新类型
#[derive(AnchorSerialize, AnchorDeserialize, Clone, Debug, PartialEq)]
pub enum UpdateType {
    InteractionCount,                    // 互动计数更新
    EngagementScore,                     // 参与度评分更新
    QualityScore,                        // 质量评分更新
    TrendingScore,                       // 趋势评分更新
    ViralityScore,                       // 病毒传播评分更新
}

/// 更新优先级
#[derive(AnchorSerialize, AnchorDeserialize, Clone, Debug, PartialEq)]
pub enum UpdatePriority {
    Low,
    Medium,
    High,
    Critical,
}

/// 内容搜索结果
#[derive(AnchorSerialize, AnchorDeserialize, Clone, Debug)]
pub struct ContentSearchResult {
    pub content_posts: Vec<alcheme_shared::content::ContentPost>,
    pub total_count: u64,
    pub page: u32,
    pub has_more: bool,
    pub search_time_ms: u64,
    pub relevance_scores: Vec<f64>,
}

/// 内容分析报告
#[derive(AnchorSerialize, AnchorDeserialize, Clone, Debug)]
pub struct ContentAnalyticsReport {
    pub report_id: String,
    pub generated_at: i64,
    pub time_range: TimeRange,
    pub total_content: u64,
    pub content_by_type: Vec<ContentTypeStats>,
    pub engagement_metrics: EngagementMetrics,
    pub quality_metrics: QualityMetrics,
    pub trending_topics: Vec<TrendingTopic>,
}

/// 按类型的内容统计
#[derive(AnchorSerialize, AnchorDeserialize, Clone, Debug)]
pub struct ContentTypeStats {
    pub content_type: ContentType,
    pub count: u64,
    pub total_interactions: u64,
    pub average_quality_score: f64,
    pub average_engagement_score: f64,
}

/// 参与度指标
#[derive(AnchorSerialize, AnchorDeserialize, Clone, Debug)]
pub struct EngagementMetrics {
    pub total_likes: u64,
    pub total_comments: u64,
    pub total_shares: u64,
    pub total_views: u64,
    pub average_engagement_rate: f64,
    pub peak_engagement_time: i64,
}

/// 质量指标
#[derive(AnchorSerialize, AnchorDeserialize, Clone, Debug)]
pub struct QualityMetrics {
    pub average_quality_score: f64,
    pub high_quality_content_count: u64,
    pub low_quality_content_count: u64,
    pub quality_distribution: Vec<QualityBucket>,
}

/// 质量分桶
#[derive(AnchorSerialize, AnchorDeserialize, Clone, Debug)]
pub struct QualityBucket {
    pub score_range: (f64, f64),
    pub content_count: u64,
    pub percentage: f64,
}

// ==================== 内容工具函数 ====================

/// 内容工具
pub struct ContentUtils;

impl ContentUtils {
    /// 生成内容预览
    pub fn generate_content_preview(content: &ContentData, max_length: usize) -> String {
        if content.text.len() <= max_length {
            content.text.clone()
        } else {
            let mut preview = content.text.chars().take(max_length - 3).collect::<String>();
            preview.push_str("...");
            preview
        }
    }

    /// 提取内容标签
    pub fn extract_tags_from_content(content: &str) -> Vec<String> {
        let mut tags = Vec::new();
        
        // 简化的标签提取：查找 #hashtag 模式
        for word in content.split_whitespace() {
            if word.starts_with('#') && word.len() > 1 {
                let tag = word[1..].to_lowercase();
                if tag.len() <= 32 && !tags.contains(&tag) {
                    tags.push(tag);
                }
            }
        }
        
        tags.truncate(10); // 最多10个标签
        tags
    }

    /// 检测内容语言
    pub fn detect_content_language(content: &str) -> Option<String> {
        // 简化实现：基于字符检测
        if content.chars().any(|c| c as u32 > 0x4e00 && (c as u32) < 0x9fff) {
            Some("zh".to_string()) // 中文
        } else if content.chars().all(|c| c.is_ascii()) {
            Some("en".to_string()) // 英文
        } else {
            None // 未知语言
        }
    }

    /// 计算内容复杂度
    pub fn calculate_content_complexity(content_data: &ContentData) -> ContentComplexity {
        let mut score = 0.0;
        
        // 文本复杂度
        score += (content_data.text.len() as f64 / 1000.0).min(5.0);
        
        // 媒体复杂度
        score += content_data.media_attachments.len() as f64 * 2.0;
        
        // 特殊内容类型复杂度
        match content_data.content_type {
            ContentType::Video => score += 10.0,
            ContentType::Audio => score += 5.0,
            ContentType::Poll => score += 3.0,
            ContentType::Event => score += 4.0,
            ContentType::Live => score += 15.0,
            _ => {},
        }
        
        ContentComplexity {
            complexity_score: score,
            processing_time_estimate: (score * 100.0) as u64, // 毫秒
            storage_cost_multiplier: (score / 10.0).max(1.0),
        }
    }

    /// 验证内容关系链
    pub fn validate_content_relationship_chain(
        content_type: &ContentRelationshipType,
        chain_length: u8,
    ) -> Result<()> {
        let max_length = match content_type {
            ContentRelationshipType::Reply => 32,    // 最大回复深度
            ContentRelationshipType::Quote => 10,    // 最大引用链
            ContentRelationshipType::Thread => 50,   // 最大话题长度
        };
        
        require!(
            chain_length <= max_length,
            AlchemeError::InvalidOperation
        );
        
        Ok(())
    }
}

/// 内容复杂度
#[derive(AnchorSerialize, AnchorDeserialize, Clone, Debug)]
pub struct ContentComplexity {
    pub complexity_score: f64,
    pub processing_time_estimate: u64,   // 毫秒
    pub storage_cost_multiplier: f64,
}

/// 内容关系类型
#[derive(AnchorSerialize, AnchorDeserialize, Clone, Debug, PartialEq)]
pub enum ContentRelationshipType {
    Reply,
    Quote,
    Thread,
}

/// 内容哈希器
pub struct ContentHasher;

impl ContentHasher {
    /// 计算内容哈希
    pub fn calculate_content_hash(content_data: &ContentData) -> Result<[u8; 32]> {
        use solana_program::hash::{hash, hashv};
        
        // 收集所有需要哈希的数据
        let mut hash_data = Vec::new();
        hash_data.push(content_data.text.as_bytes());
        
        let content_type_bytes = content_data.content_type.discriminant().to_le_bytes();
        hash_data.push(&content_type_bytes);
        
        let created_at_bytes = content_data.created_at.to_le_bytes();
        hash_data.push(&created_at_bytes);
        
        hash_data.push(content_data.author.as_ref());
        
        // 添加媒体附件信息
        let mut media_bytes = Vec::new();
        for attachment in &content_data.media_attachments {
            hash_data.push(attachment.uri.as_bytes());
            if let Some(file_size) = attachment.file_size {
                let file_size_bytes = file_size.to_le_bytes();
                media_bytes.extend_from_slice(&file_size_bytes);
            }
        }
        if !media_bytes.is_empty() {
            hash_data.push(&media_bytes);
        }
        
        let hash_result = hashv(&hash_data);
        Ok(hash_result.to_bytes())
    }

    /// 验证内容完整性
    pub fn verify_content_integrity(
        content_data: &ContentData,
        expected_hash: [u8; 32],
    ) -> Result<bool> {
        let calculated_hash = Self::calculate_content_hash(content_data)?;
        Ok(calculated_hash == expected_hash)
    }

    /// 计算内容指纹
    pub fn calculate_content_fingerprint(content: &str) -> u64 {
        use std::collections::hash_map::DefaultHasher;
        use std::hash::{Hash, Hasher};
        
        let mut hasher = DefaultHasher::new();
        content.hash(&mut hasher);
        hasher.finish()
    }
}

/// v2 最小锚点校验器
pub struct V2AnchorValidator;

impl V2AnchorValidator {
    pub const MAX_URI_REF_LEN: usize = 256;

    pub fn validate(uri_ref: &str, relation: &ContentAnchorRelation) -> Result<()> {
        ValidationUtils::validate_string_length(
            uri_ref,
            Self::MAX_URI_REF_LEN,
            AlchemeError::InvalidOperation,
        )?;
        relation.validate()?;
        Ok(())
    }
}

/// 线程管理器
pub struct ThreadManager;

impl ThreadManager {
    /// 验证线程深度
    pub fn validate_thread_depth(current_depth: u8, max_depth: u8) -> Result<()> {
        require!(
            current_depth < max_depth,
            AlchemeError::InvalidOperation
        );
        Ok(())
    }

    /// 计算线程统计
    pub fn calculate_thread_stats(thread_posts: &[alcheme_shared::content::ContentPost]) -> ThreadStats {
        let total_posts = thread_posts.len() as u64;
        let max_depth = thread_posts.iter().map(|p| p.thread_depth).max().unwrap_or(0);
        let total_interactions: u64 = 0; // 需要从统计账户计算
        
        ThreadStats {
            total_posts,
            max_depth,
            total_interactions,
            created_at: thread_posts.first().map(|p| p.created_at).unwrap_or(0),
            last_activity: thread_posts.iter().map(|p| p.last_updated).max().unwrap_or(0),
        }
    }

    /// 获取线程根帖子
    pub fn get_thread_root(content_post: &alcheme_shared::content::ContentPost) -> Pubkey {
        content_post.thread_root.unwrap_or(content_post.author_identity)
    }
}

/// 线程统计
#[derive(AnchorSerialize, AnchorDeserialize, Clone, Debug)]
pub struct ThreadStats {
    pub total_posts: u64,
    pub max_depth: u8,
    pub total_interactions: u64,
    pub created_at: i64,
    pub last_activity: i64,
}

/// 内容分析器
pub struct ContentAnalyzer;

impl ContentAnalyzer {
    /// 计算内容质量评分
    pub fn calculate_quality_score(
        content_post: &alcheme_shared::content::ContentPost,
        content_stats: &alcheme_shared::content::ContentStats,
    ) -> Result<f64> {
        let mut score = 50.0; // 基础分数
        
        // 基于内容长度的评分
        let length_score = match content_post.content_length {
            0..=50 => 0.8,      // 过短
            51..=200 => 1.0,    // 适中
            201..=1000 => 1.2,  // 较长
            1001..=5000 => 1.1, // 很长
            _ => 0.9,           // 过长
        };
        score *= length_score;
        
        // 基于互动比例的评分
        if content_stats.view_count > 0 {
            let engagement_rate = (content_stats.like_count + content_stats.comment_count) as f64 
                                 / content_stats.view_count as f64;
            score += engagement_rate * 30.0;
        }
        
        // 基于举报比例的扣分
        if content_stats.view_count > 0 {
            let report_rate = content_stats.report_count as f64 / content_stats.view_count as f64;
            score -= report_rate * 50.0;
        }
        
        // 基于标签数量的评分
        let tag_score = match content_post.tags.len() {
            0 => 0.9,           // 无标签
            1..=3 => 1.1,       // 适量标签
            4..=6 => 1.0,       // 较多标签
            _ => 0.8,           // 过多标签
        };
        score *= tag_score;
        
        Ok(score.max(0.0).min(100.0))
    }

    /// 计算趋势评分
    pub fn calculate_trending_score(content_stats: &alcheme_shared::content::ContentStats) -> Result<f64> {
        let current_time = Clock::get()?.unix_timestamp;
        let content_age_hours = (current_time - content_stats.last_updated) / 3600;
        
        // 基础趋势评分基于互动速度
        let base_score = content_stats.interaction_velocity;
        
        // 时间衰减因子
        let time_decay = match content_age_hours {
            0..=1 => 1.0,       // 1小时内
            2..=6 => 0.8,       // 6小时内
            7..=24 => 0.6,      // 24小时内
            25..=72 => 0.4,     // 3天内
            _ => 0.2,           // 3天以上
        };
        
        // 最近互动加权
        let recent_interaction_weight = if content_stats.last_24h_interactions > content_stats.last_7d_interactions / 7 {
            1.5 // 最近互动活跃
        } else {
            1.0
        };
        
        let trending_score = base_score * time_decay * recent_interaction_weight;
        
        Ok(trending_score.max(0.0).min(100.0))
    }

    /// 计算病毒传播评分
    pub fn calculate_virality_score(content_stats: &alcheme_shared::content::ContentStats) -> Result<f64> {
        let total_interactions = content_stats.like_count + content_stats.comment_count + 
                               content_stats.repost_count + content_stats.share_count;
        
        if total_interactions == 0 {
            return Ok(0.0);
        }
        
        // 基于分享比例的病毒传播评分
        let share_ratio = (content_stats.share_count + content_stats.repost_count) as f64 
                         / total_interactions as f64;
        
        // 基于互动速度的病毒传播评分
        let velocity_factor = (content_stats.interaction_velocity / 10.0).min(1.0);
        
        // 基于增长趋势的病毒传播评分
        let growth_factor = if content_stats.last_24h_interactions > 0 {
            (content_stats.last_24h_interactions as f64 / content_stats.last_7d_interactions.max(1) as f64).min(2.0)
        } else {
            0.0
        };
        
        let virality_score = (share_ratio * 40.0) + (velocity_factor * 30.0) + (growth_factor * 30.0);
        
        Ok(virality_score.max(0.0).min(100.0))
    }
}

/// 内容推荐引擎
pub struct ContentRecommendationEngine;

impl ContentRecommendationEngine {
    /// 生成个性化推荐
    pub fn generate_personalized_recommendations(
        user_identity: &Pubkey,
        user_preferences: &UserPreferences,
        available_content: &[alcheme_shared::content::ContentPost],
        context: &RecommendationContext,
    ) -> Result<Vec<ContentRecommendation>> {
        let mut recommendations = Vec::new();
        
        for content in available_content.iter().take(context.max_results as usize) {
            let score = Self::calculate_recommendation_score(
                content,
                user_preferences,
                context,
            )?;
            
            if score > 0.3 { // 最低推荐阈值
                recommendations.push(ContentRecommendation {
                    content_id: content.author_identity,
                    recommendation_score: score,
                    recommendation_reason: Self::generate_recommendation_reason(content, score),
                    predicted_engagement: score * 0.8, // 预测参与度
                });
            }
        }
        
        // 按评分排序
        recommendations.sort_by(|a, b| b.recommendation_score.partial_cmp(&a.recommendation_score).unwrap());
        
        Ok(recommendations)
    }

    /// 计算推荐评分
    fn calculate_recommendation_score(
        content: &alcheme_shared::content::ContentPost,
        user_preferences: &UserPreferences,
        context: &RecommendationContext,
    ) -> Result<f64> {
        let mut score = 0.0;
        
        // 内容类型偏好评分
        if user_preferences.preferred_content_types.contains(&content.content_type) {
            score += 0.3;
        }
        
        // 标签匹配评分
        let tag_matches = content.tags.iter()
            .filter(|tag| user_preferences.interested_tags.contains(tag))
            .count();
        score += (tag_matches as f64 / content.tags.len().max(1) as f64) * 0.2;
        
        // 新鲜度评分
        let current_time = Clock::get()?.unix_timestamp;
        let hours_since_creation = (current_time - content.created_at) / 3600;
        let freshness_score = match hours_since_creation {
            0..=6 => 1.0,
            7..=24 => 0.8,
            25..=72 => 0.6,
            _ => 0.4,
        };
        score += freshness_score * context.freshness_weight;
        
        // 质量评分权重
        // 这里需要从 ContentStats 获取质量评分，简化实现使用默认值
        score += 0.7 * context.quality_weight;
        
        Ok(score.max(0.0).min(1.0))
    }

    /// 生成推荐原因
    fn generate_recommendation_reason(content: &alcheme_shared::content::ContentPost, score: f64) -> String {
        if score > 0.8 {
            "High-quality content matching your interests".to_string()
        } else if score > 0.6 {
            "Recommended based on your preferences".to_string()
        } else if score > 0.4 {
            "Related content recommendation".to_string()
        } else {
            "Content you may be interested in".to_string()
        }
    }
}

/// 用户偏好
#[derive(AnchorSerialize, AnchorDeserialize, Clone, Debug)]
pub struct UserPreferences {
    pub preferred_content_types: Vec<ContentType>,
    pub interested_tags: Vec<String>,
    pub preferred_languages: Vec<String>,
    pub content_length_preference: ContentLengthPreference,
    pub interaction_history: Vec<InteractionHistory>,
}

/// 内容长度偏好
#[derive(AnchorSerialize, AnchorDeserialize, Clone, Debug, PartialEq)]
pub enum ContentLengthPreference {
    Short,      // 短内容 (< 200字符)
    Medium,     // 中等内容 (200-1000字符)
    Long,       // 长内容 (> 1000字符)
    Mixed,      // 混合
}

/// 互动历史
#[derive(AnchorSerialize, AnchorDeserialize, Clone, Debug)]
pub struct InteractionHistory {
    pub content_id: Pubkey,
    pub interaction_type: InteractionType,
    pub timestamp: i64,
    pub engagement_duration: Option<u32>, // 参与时长（秒）
}

/// 内容状态转换管理器
pub struct ContentStatusManager;

impl ContentStatusManager {
    /// 验证状态转换
    pub fn validate_status_transition(
        current_status: &ContentStatus,
        new_status: &ContentStatus,
    ) -> Result<()> {
        let valid_transition = match (current_status, new_status) {
            // 从草稿可以转换到任何状态
            (ContentStatus::Draft, _) => true,
            
            // 已发布可以转换到大部分状态
            (ContentStatus::Published, ContentStatus::Draft) => false, // 不能回到草稿
            (ContentStatus::Published, _) => true,
            
            // 已删除只能恢复到发布状态
            (ContentStatus::Deleted, ContentStatus::Published) => true,
            (ContentStatus::Deleted, _) => false,
            
            // 已归档可以恢复或删除
            (ContentStatus::Archived, ContentStatus::Published) => true,
            (ContentStatus::Archived, ContentStatus::Deleted) => true,
            (ContentStatus::Archived, _) => false,
            
            // 其他转换
            _ => false,
        };
        
        require!(valid_transition, AlchemeError::InvalidOperation);
        Ok(())
    }

    /// 获取状态描述
    pub fn get_status_description(status: &ContentStatus) -> &'static str {
        match status {
            ContentStatus::Draft => "Draft",
            ContentStatus::Published => "Published",
            ContentStatus::Archived => "Archived",
            ContentStatus::Deleted => "Deleted",
            ContentStatus::Moderated => "Moderated",
            ContentStatus::Suspended => "Suspended",
            ContentStatus::Flagged => "Flagged",
            ContentStatus::UnderReview => "Under review",
        }
    }
}

#[account]
pub struct V2ContentAnchorAccount {
    pub state_flags: u8,
    pub packed_control: u32,
    pub bump: u8,
}

impl V2ContentAnchorAccount {
    const AUDIENCE_KIND_MASK: u8 = 0b0000_0011;
    const STATUS_MASK: u8 = 0b0000_1100;
    const STATUS_SHIFT: u8 = 2;
    const CONTENT_VERSION_MASK: u32 = 0x00FF_FFFF;
    const AUDIENCE_REF_SHIFT: u32 = 24;
    pub const SPACE: usize = 8 + 1 + 4 + 1;

    fn encode_audience_kind(audience_kind: &V2AudienceKind) -> u8 {
        match audience_kind {
            V2AudienceKind::Public => 0,
            V2AudienceKind::Private => 1,
            V2AudienceKind::FollowersOnly => 2,
            V2AudienceKind::CircleOnly => 3,
        }
    }

    fn decode_audience_kind(encoded: u8) -> V2AudienceKind {
        match encoded {
            0 => V2AudienceKind::Public,
            1 => V2AudienceKind::Private,
            2 => V2AudienceKind::FollowersOnly,
            3 => V2AudienceKind::CircleOnly,
            _ => V2AudienceKind::Private,
        }
    }

    fn encode_status(status: &ContentStatus) -> u8 {
        match status {
            ContentStatus::Draft => 0,
            ContentStatus::Published => 1,
            ContentStatus::Archived => 2,
            ContentStatus::Deleted => 3,
            _ => 3,
        }
    }

    fn decode_status(encoded: u8) -> ContentStatus {
        match encoded {
            0 => ContentStatus::Draft,
            1 => ContentStatus::Published,
            2 => ContentStatus::Archived,
            3 => ContentStatus::Deleted,
            _ => ContentStatus::Deleted,
        }
    }

    fn set_audience_kind(&mut self, audience_kind: &V2AudienceKind) {
        self.state_flags = (self.state_flags & !Self::AUDIENCE_KIND_MASK)
            | Self::encode_audience_kind(audience_kind);
    }

    fn set_audience_ref(&mut self, audience_ref: u8) {
        self.packed_control = (self.packed_control & Self::CONTENT_VERSION_MASK)
            | ((audience_ref as u32) << Self::AUDIENCE_REF_SHIFT);
    }

    fn set_content_version(&mut self, content_version: u32) {
        let bounded_content_version = content_version.min(Self::CONTENT_VERSION_MASK);
        self.packed_control = (self.packed_control & !Self::CONTENT_VERSION_MASK)
            | bounded_content_version;
    }

    fn set_status(&mut self, status: &ContentStatus) {
        let encoded = Self::encode_status(status) << Self::STATUS_SHIFT;
        self.state_flags = (self.state_flags & !Self::STATUS_MASK) | encoded;
    }

    pub fn audience_kind(&self) -> V2AudienceKind {
        Self::decode_audience_kind(self.state_flags & Self::AUDIENCE_KIND_MASK)
    }

    pub fn audience_ref(&self) -> u8 {
        (self.packed_control >> Self::AUDIENCE_REF_SHIFT) as u8
    }

    pub fn content_version(&self) -> u32 {
        self.packed_control & Self::CONTENT_VERSION_MASK
    }

    pub fn visibility(&self) -> AccessLevel {
        match self.audience_kind() {
            V2AudienceKind::Public => AccessLevel::Public,
            V2AudienceKind::Private => AccessLevel::Private,
            V2AudienceKind::FollowersOnly => AccessLevel::Followers,
            V2AudienceKind::CircleOnly => AccessLevel::Custom,
        }
    }

    pub fn status(&self) -> ContentStatus {
        Self::decode_status((self.state_flags & Self::STATUS_MASK) >> Self::STATUS_SHIFT)
    }

    pub fn initialize(
        &mut self,
        audience_kind: V2AudienceKind,
        audience_ref: u8,
        status: ContentStatus,
        bump: u8,
    ) {
        self.state_flags = 0;
        self.packed_control = 0;
        self.set_audience_kind(&audience_kind);
        self.set_audience_ref(audience_ref);
        self.set_status(&status);
        self.set_content_version(1);
        self.bump = bump;
    }

    pub fn set_status_and_audience(
        &mut self,
        status: &ContentStatus,
        audience_kind: &V2AudienceKind,
        audience_ref: u8,
    ) {
        self.set_status(status);
        self.set_audience_kind(audience_kind);
        self.set_audience_ref(audience_ref);
    }

    pub fn update_status(&mut self, status: &ContentStatus) {
        self.set_status(status);
    }

    pub fn bump_content_version(&mut self) {
        self.set_content_version(self.content_version().saturating_add(1));
    }
}

// ==================== Wrapper Accounts ====================
use std::ops::{Deref, DerefMut};

#[account]
pub struct ContentManagerAccount {
    pub inner: alcheme_shared::content::ContentManager,
}

impl Deref for ContentManagerAccount {
    type Target = alcheme_shared::content::ContentManager;
    fn deref(&self) -> &Self::Target {
        &self.inner
    }
}

impl DerefMut for ContentManagerAccount {
    fn deref_mut(&mut self) -> &mut Self::Target {
        &mut self.inner
    }
}

impl ContentManagerAccount {
    pub const SPACE: usize = alcheme_shared::content::ContentManager::SPACE;
}

#[account]
pub struct ContentPostAccount {
    pub inner: alcheme_shared::content::ContentPost,
}

impl Deref for ContentPostAccount {
    type Target = alcheme_shared::content::ContentPost;
    fn deref(&self) -> &Self::Target {
        &self.inner
    }
}

impl DerefMut for ContentPostAccount {
    fn deref_mut(&mut self) -> &mut Self::Target {
        &mut self.inner
    }
}

impl ContentPostAccount {
    pub const SPACE: usize = alcheme_shared::content::ContentPost::SPACE;
}

#[account]
pub struct ContentStatsAccount {
    pub inner: alcheme_shared::content::ContentStats,
}

impl Deref for ContentStatsAccount {
    type Target = alcheme_shared::content::ContentStats;
    fn deref(&self) -> &Self::Target {
        &self.inner
    }
}

impl DerefMut for ContentStatsAccount {
    fn deref_mut(&mut self) -> &mut Self::Target {
        &mut self.inner
    }
}

impl ContentStatsAccount {
    pub const SPACE: usize = alcheme_shared::content::ContentStats::SPACE;
}

#[account]
pub struct ContentStorageAccount {
    pub inner: alcheme_shared::content::ContentStorage,
}

impl Deref for ContentStorageAccount {
    type Target = alcheme_shared::content::ContentStorage;
    fn deref(&self) -> &Self::Target {
        &self.inner
    }
}

impl DerefMut for ContentStorageAccount {
    fn deref_mut(&mut self) -> &mut Self::Target {
        &mut self.inner
    }
}

impl ContentStorageAccount {
    pub const SPACE: usize = alcheme_shared::content::ContentStorage::SPACE;
    pub const INIT_SPACE: usize = alcheme_shared::content::ContentStorage::INIT_SPACE;
}
