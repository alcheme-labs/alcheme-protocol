use anchor_lang::prelude::*;
use alcheme_shared::*;

/// Content Manager 专用验证器
pub struct ContentValidator;

impl ContentValidator {
    fn validate_visible_to_requester(
        visibility_settings: &VisibilitySettings,
        requester: &Pubkey,
        content_author: &Pubkey,
    ) -> Result<()> {
        if requester == content_author {
            return Ok(());
        }

        match &visibility_settings.visibility_level {
            VisibilityLevel::Public => Ok(()),
            VisibilityLevel::Private => Err(AlchemeError::PermissionDenied.into()),
            VisibilityLevel::Followers
            | VisibilityLevel::Friends
            | VisibilityLevel::Community(_)
            | VisibilityLevel::Custom(_) => Err(AlchemeError::PermissionDenied.into()),
        }
    }

    pub fn validate_visible_to_requester_with_facts(
        visibility_settings: &VisibilitySettings,
        requester: &Pubkey,
        content_author: &Pubkey,
        has_follow_relationship: bool,
        has_circle_membership: bool,
    ) -> Result<()> {
        if requester == content_author {
            return Ok(());
        }

        match &visibility_settings.visibility_level {
            VisibilityLevel::Public => Ok(()),
            VisibilityLevel::Private => Err(AlchemeError::PermissionDenied.into()),
            VisibilityLevel::Followers => {
                require!(has_follow_relationship, AlchemeError::PermissionDenied);
                Ok(())
            }
            VisibilityLevel::Community(_) => {
                require!(has_circle_membership, AlchemeError::PermissionDenied);
                Ok(())
            }
            VisibilityLevel::Friends | VisibilityLevel::Custom(_) => {
                Err(AlchemeError::PermissionDenied.into())
            }
        }
    }

    /// 验证内容数据
    pub fn validate_content_data(
        content_data: &ContentData,
        content_type: &ContentType,
    ) -> Result<()> {
        // 验证内容长度
        require!(
            content_data.text.len() <= MAX_TEXT_LENGTH,
            AlchemeError::TextTooLong
        );
        
        // 验证媒体附件数量
        require!(
            content_data.media_attachments.len() <= MAX_MEDIA_ATTACHMENTS,
            AlchemeError::InvalidOperation
        );
        
        // 验证内容类型一致性
        match content_type {
            ContentType::Text => {
                require!(
                    content_data.media_attachments.is_empty(),
                    AlchemeError::InvalidContentType
                );
            },
            ContentType::Image | ContentType::Video | ContentType::Audio => {
                require!(
                    !content_data.media_attachments.is_empty(),
                    AlchemeError::MissingMediaAttachment
                );
            },
            _ => {}, // 其他类型的验证
        }
        
        // 验证媒体附件
        for attachment in &content_data.media_attachments {
            Self::validate_media_attachment(attachment)?;
        }
        
        Ok(())
    }

    /// 验证媒体附件
    pub fn validate_media_attachment(attachment: &MediaAttachment) -> Result<()> {
        // 验证URI格式
        ValidationUtils::validate_url(&attachment.uri)?;
        
        // 验证文件大小
        if let Some(file_size) = attachment.file_size {
            require!(
                file_size <= MAX_MEDIA_FILE_SIZE,
                AlchemeError::MediaAttachmentTooLarge
            );
        }
        
        // 验证媒体类型
        require!(
            !attachment.media_type.is_empty() && attachment.media_type.len() <= 64,
            AlchemeError::InvalidContentType
        );
        
        Ok(())
    }

    /// 验证内容元数据
    pub fn validate_content_metadata(metadata: &ContentMetadata) -> Result<()> {
        // 验证标题长度
        if let Some(title) = &metadata.title {
            ValidationUtils::validate_string_length(
                title,
                MAX_CONTENT_TITLE_LENGTH,
                AlchemeError::InvalidOperation,
            )?;
        }
        
        // 验证描述长度
        if let Some(description) = &metadata.description {
            ValidationUtils::validate_string_length(
                description,
                MAX_CONTENT_DESCRIPTION_LENGTH,
                AlchemeError::InvalidOperation,
            )?;
        }
        
        // 验证标签数量和长度
        require!(
            metadata.tags.len() <= MAX_TAGS_COUNT,
            AlchemeError::InvalidOperation
        );
        
        for tag in &metadata.tags {
            require!(
                !tag.is_empty() && tag.len() <= 32,
                AlchemeError::InvalidOperation
            );
        }
        
        // 验证过期时间
        if let Some(expires_at) = metadata.expires_at {
            ValidationUtils::validate_timestamp(expires_at)?;
            
            let current_time = Clock::get()?.unix_timestamp;
            require!(
                expires_at > current_time,
                AlchemeError::InvalidTimestamp
            );
        }
        
        Ok(())
    }

    /// 验证内容更新
    pub fn validate_content_update(update: &ContentUpdate) -> Result<()> {
        // 验证预览长度
        if let Some(preview) = &update.content_preview {
            ValidationUtils::validate_string_length(
                preview,
                200,
                AlchemeError::InvalidOperation,
            )?;
        }
        
        // 验证标签
        if let Some(tags) = &update.tags {
            require!(
                tags.len() <= MAX_TAGS_COUNT,
                AlchemeError::InvalidOperation
            );
            
            for tag in tags {
                require!(
                    !tag.is_empty() && tag.len() <= 32,
                    AlchemeError::InvalidOperation
                );
            }
        }
        
        // 验证分类
        if let Some(categories) = &update.categories {
            require!(
                categories.len() <= 3,
                AlchemeError::InvalidOperation
            );
        }
        
        // 验证内容警告
        if let Some(warnings) = &update.content_warnings {
            require!(
                warnings.len() <= 5,
                AlchemeError::InvalidOperation
            );
        }
        
        Ok(())
    }

    /// 验证回复权限
    pub fn validate_reply_permission(
        visibility_settings: &VisibilitySettings,
        requester: &Pubkey,
        content_author: &Pubkey,
    ) -> Result<()> {
        Self::validate_visible_to_requester(visibility_settings, requester, content_author)?;

        match visibility_settings.reply_permission {
            ReplyPermission::Anyone => Ok(()),
            ReplyPermission::Followers => Err(AlchemeError::PermissionDenied.into()),
            ReplyPermission::Mentioned => Err(AlchemeError::PermissionDenied.into()),
            ReplyPermission::None => Err(AlchemeError::PermissionDenied.into()),
        }
    }

    pub fn validate_reply_permission_with_facts(
        visibility_settings: &VisibilitySettings,
        requester: &Pubkey,
        content_author: &Pubkey,
        has_follow_relationship: bool,
        has_circle_membership: bool,
    ) -> Result<()> {
        Self::validate_visible_to_requester_with_facts(
            visibility_settings,
            requester,
            content_author,
            has_follow_relationship,
            has_circle_membership,
        )?;

        match visibility_settings.reply_permission {
            ReplyPermission::Anyone => Ok(()),
            ReplyPermission::Followers => {
                require!(
                    requester == content_author || has_follow_relationship,
                    AlchemeError::PermissionDenied
                );
                Ok(())
            }
            ReplyPermission::Mentioned | ReplyPermission::None => {
                Err(AlchemeError::PermissionDenied.into())
            }
        }
    }

    /// 验证引用权限
    pub fn validate_quote_permission(
        visibility_settings: &VisibilitySettings,
        requester: &Pubkey,
        content_author: &Pubkey,
    ) -> Result<()> {
        Self::validate_visible_to_requester(visibility_settings, requester, content_author)?;

        match visibility_settings.quote_permission {
            QuotePermission::Anyone => Ok(()),
            QuotePermission::Followers => Err(AlchemeError::PermissionDenied.into()),
            QuotePermission::ExplicitApproval => Err(AlchemeError::PermissionDenied.into()),
            QuotePermission::None => Err(AlchemeError::PermissionDenied.into()),
        }
    }

    pub fn validate_quote_permission_with_facts(
        visibility_settings: &VisibilitySettings,
        requester: &Pubkey,
        content_author: &Pubkey,
        has_follow_relationship: bool,
        has_circle_membership: bool,
    ) -> Result<()> {
        Self::validate_visible_to_requester_with_facts(
            visibility_settings,
            requester,
            content_author,
            has_follow_relationship,
            has_circle_membership,
        )?;

        match visibility_settings.quote_permission {
            QuotePermission::Anyone => Ok(()),
            QuotePermission::Followers => {
                require!(
                    requester == content_author || has_follow_relationship,
                    AlchemeError::PermissionDenied
                );
                Ok(())
            }
            QuotePermission::ExplicitApproval | QuotePermission::None => {
                Err(AlchemeError::PermissionDenied.into())
            }
        }
    }

    /// 验证转发权限
    pub fn validate_repost_permission(
        visibility_settings: &VisibilitySettings,
        requester: &Pubkey,
        content_author: &Pubkey,
    ) -> Result<()> {
        Self::validate_visible_to_requester(visibility_settings, requester, content_author)?;

        match visibility_settings.repost_permission {
            RepostPermission::Anyone => Ok(()),
            RepostPermission::Followers => Err(AlchemeError::PermissionDenied.into()),
            RepostPermission::ExplicitApproval => Err(AlchemeError::PermissionDenied.into()),
            RepostPermission::None => Err(AlchemeError::PermissionDenied.into()),
        }
    }

    pub fn validate_repost_permission_with_facts(
        visibility_settings: &VisibilitySettings,
        requester: &Pubkey,
        content_author: &Pubkey,
        has_follow_relationship: bool,
        has_circle_membership: bool,
    ) -> Result<()> {
        Self::validate_visible_to_requester_with_facts(
            visibility_settings,
            requester,
            content_author,
            has_follow_relationship,
            has_circle_membership,
        )?;

        match visibility_settings.repost_permission {
            RepostPermission::Anyone => Ok(()),
            RepostPermission::Followers => {
                require!(
                    requester == content_author || has_follow_relationship,
                    AlchemeError::PermissionDenied
                );
                Ok(())
            }
            RepostPermission::ExplicitApproval | RepostPermission::None => {
                Err(AlchemeError::PermissionDenied.into())
            }
        }
    }

    /// 验证互动类型
    pub fn validate_interaction_type(interaction_type: &InteractionType) -> Result<()> {
        // 基础验证：所有预定义的互动类型都是有效的
        match interaction_type {
            InteractionType::Like |
            InteractionType::Dislike |
            InteractionType::Share |
            InteractionType::Comment |
            InteractionType::Bookmark |
            InteractionType::Report |
            InteractionType::View => Ok(()),
        }
    }

    /// 验证可见性设置
    pub fn validate_visibility_settings(settings: &VisibilitySettings) -> Result<()> {
        // 验证可见性级别的一致性
        match &settings.visibility_level {
            VisibilityLevel::Custom(user_list) => {
                require!(
                    user_list.len() <= 100, // 自定义用户列表最多100个
                    AlchemeError::InvalidOperation
                );
            },
            _ => {}, // 其他级别无需额外验证
        }
        
        Ok(())
    }

    /// 验证变现信息
    pub fn validate_monetization_info(monetization: &MonetizationInfo) -> Result<()> {
        // 验证价格
        match monetization.monetization_type {
            MonetizationType::Free => {
                require!(
                    monetization.price == 0,
                    AlchemeError::InvalidOperation
                );
            },
            MonetizationType::OneTime | 
            MonetizationType::PayPerView => {
                require!(
                    monetization.price > 0,
                    AlchemeError::InvalidOperation
                );
            },
            _ => {},
        }
        
        // 验证收益分配比例
        let total_percentage = monetization.revenue_split.creator_percentage +
                              monetization.revenue_split.platform_percentage +
                              monetization.revenue_split.referrer_percentage +
                              monetization.revenue_split.community_percentage;
        
        require!(
            total_percentage == 100,
            AlchemeError::InvalidOperation
        );
        
        Ok(())
    }

    /// 验证存储策略
    pub fn validate_storage_strategy(strategy: &StorageStrategy) -> Result<()> {
        match strategy {
            StorageStrategy::OnChain |
            StorageStrategy::Arweave |
            StorageStrategy::IPFS |
            StorageStrategy::Hybrid => Ok(()),
            StorageStrategy::Custom(name) => {
                require!(
                    !name.is_empty() && name.len() <= 64,
                    AlchemeError::InvalidStorageStrategy
                );
                Ok(())
            },
        }
    }

    /// 验证状态转换
    pub fn validate_status_transition(
        current_status: &ContentStatus,
        new_status: &ContentStatus,
    ) -> Result<()> {
        crate::state::ContentStatusManager::validate_status_transition(current_status, new_status)
    }
}

/// Content Manager 分布式验证实现
pub struct ContentValidationModule;

impl ContentValidationModule {
    /// 执行内容创建验证
    pub fn validate_content_creation(
        content_data: &ContentData,
        metadata: &ContentMetadata,
        author: &Pubkey,
    ) -> Result<ValidationResult> {
        // 创建验证上下文
        let context = ValidationContext {
            requester: *author,
            operation: OperationType::ContentCreation,
            target: None,
            timestamp: Clock::get()?.unix_timestamp,
            additional_data: content_data.text.as_bytes().to_vec(),
        };
        
        // 获取内容验证器列表
        let validators = ValidationFactory::create_content_validators();
        
        // 协调验证
        let result = ValidationCoordinator::coordinate_validation(&validators, &context)?;
        
        // 返回主要验证结果
        Ok(ValidationResult {
            success: result.success,
            score: result.overall_score,
            message: format!("Content creation validation: {}", 
                           if result.success { "PASSED" } else { "FAILED" }),
            validator_id: "content_creation".to_string(),
            timestamp: result.executed_at,
        })
    }

    /// 执行内容更新验证
    pub fn validate_content_update(
        update: &ContentUpdate,
        current_content: &ContentPost,
    ) -> Result<ValidationResult> {
        let mut score = 100.0;
        let mut messages = Vec::new();
        
        // 验证更新的合理性
        if let Some(tags) = &update.tags {
            if tags.len() > MAX_TAGS_COUNT {
                score -= 20.0;
                messages.push("Too many tags".to_string());
            }
        }
        
        if let Some(warnings) = &update.content_warnings {
            if warnings.len() > 5 {
                score -= 15.0;
                messages.push("Too many content warnings".to_string());
            }
        }
        
        // 检查更新频率（防止滥用）
        let current_time = Clock::get()?.unix_timestamp;
        let time_since_last_update = current_time - current_content.last_updated;
        if time_since_last_update < 60 { // 1分钟内不允许频繁更新
            score -= 30.0;
            messages.push("Too frequent updates".to_string());
        }
        
        let success = score >= 70.0;
        let message = if messages.is_empty() {
            "Content update validation passed".to_string()
        } else {
            messages.join("; ")
        };
        
        Ok(ValidationResult {
            success,
            score,
            message,
            validator_id: "content_update".to_string(),
            timestamp: Clock::get()?.unix_timestamp,
        })
    }

    /// 执行内容审核验证
    pub fn validate_content_moderation(
        content_post: &ContentPost,
        moderation_action: &ModerationAction,
        moderator: &Pubkey,
    ) -> Result<ValidationResult> {
        let mut score = 100.0;
        let mut messages = Vec::new();
        
        // 验证审核权限
        // 这里需要通过 CPI 检查审核员权限
        // 简化实现：假设有权限
        
        // 验证审核动作的合理性
        match moderation_action {
            ModerationAction::ContentRemoval => {
                if content_post.status == ContentStatus::Published {
                    score = 100.0; // 移除已发布内容是合理的
                } else {
                    score -= 20.0;
                    messages.push("Content not in publishable state".to_string());
                }
            },
            ModerationAction::AccountSuspension |
            ModerationAction::AccountBan => {
                // 这些是严重的审核动作，需要更高的权限
                score -= 10.0; // 需要额外验证
                messages.push("High-impact moderation action".to_string());
            },
            _ => {}, // 其他审核动作
        }
        
        let success = score >= 80.0; // 审核验证的门槛较高
        let message = if messages.is_empty() {
            "Content moderation validation passed".to_string()
        } else {
            messages.join("; ")
        };
        
        Ok(ValidationResult {
            success,
            score,
            message,
            validator_id: "content_moderation".to_string(),
            timestamp: Clock::get()?.unix_timestamp,
        })
    }

    /// 执行内容质量验证
    pub fn validate_content_quality(
        content_data: &ContentData,
        content_stats: Option<&ContentStats>,
    ) -> Result<ValidationResult> {
        let mut score = 100.0;
        let mut messages = Vec::new();
        
        // 基于内容长度的质量评分
        match content_data.text.len() {
            0..=10 => {
                score -= 40.0;
                messages.push("Content too short".to_string());
            },
            11..=50 => {
                score -= 20.0;
                messages.push("Content might be too short".to_string());
            },
            51..=2000 => {
                // 理想长度
            },
            _ => {
                score -= 10.0;
                messages.push("Content might be too long".to_string());
            },
        }
        
        // 检查是否包含垃圾内容特征
        if Self::contains_spam_patterns(&content_data.text) {
            score -= 50.0;
            messages.push("Potential spam content detected".to_string());
        }
        
        // 基于历史统计的质量评分
        if let Some(stats) = content_stats {
            if stats.report_count > 0 && stats.view_count > 0 {
                let report_rate = stats.report_count as f64 / stats.view_count as f64;
                if report_rate > 0.1 { // 超过10%的举报率
                    score -= 30.0;
                    messages.push("High report rate".to_string());
                }
            }
        }
        
        let success = score >= 60.0;
        let message = if messages.is_empty() {
            "Content quality validation passed".to_string()
        } else {
            messages.join("; ")
        };
        
        Ok(ValidationResult {
            success,
            score,
            message,
            validator_id: "content_quality".to_string(),
            timestamp: Clock::get()?.unix_timestamp,
        })
    }

    /// 检测垃圾内容模式
    fn contains_spam_patterns(text: &str) -> bool {
        let spam_patterns = [
            "click here",
            "free money",
            "guaranteed",
            "limited time",
            "act now",
            "winner",
            "congratulations",
            "urgent",
        ];
        
        let text_lower = text.to_lowercase();
        
        // 检查垃圾关键词
        let spam_word_count = spam_patterns.iter()
            .filter(|pattern| text_lower.contains(*pattern))
            .count();
        
        // 检查重复字符
        let has_excessive_repeats = text.chars()
            .collect::<Vec<_>>()
            .windows(5)
            .any(|window| window.iter().all(|&c| c == window[0]));
        
        // 检查过多的大写字母
        let uppercase_ratio = text.chars().filter(|c| c.is_uppercase()).count() as f64 / text.len() as f64;
        
        spam_word_count >= 2 || has_excessive_repeats || uppercase_ratio > 0.5
    }

    /// 验证内容权限
    pub fn validate_content_permissions(
        content_post: &ContentPost,
        requester: &Pubkey,
        requested_action: &ContentAction,
    ) -> Result<bool> {
        // 作者总是有完全权限
        if requester == &content_post.author_identity {
            return Ok(true);
        }
        
        // 基于可见性设置检查权限
        match requested_action {
            ContentAction::View => {
                match content_post.visibility_settings.visibility_level {
                    VisibilityLevel::Public => Ok(true),
                    VisibilityLevel::Private => Ok(false),
                    _ => {
                        // 需要通过 CPI 检查具体权限
                        // 简化实现：假设有权限
                        Ok(true)
                    },
                }
            },
            ContentAction::Interact => {
                // 检查是否可以互动
                match content_post.status {
                    ContentStatus::Published => Ok(true),
                    ContentStatus::Archived => Ok(false), // 归档内容不能互动
                    ContentStatus::Deleted => Ok(false),  // 已删除内容不能互动
                    _ => Ok(false),
                }
            },
            ContentAction::Moderate => {
                // 需要检查审核权限
                // 简化实现：拒绝
                Ok(false)
            },
        }
    }
}

/// 内容动作类型
#[derive(AnchorSerialize, AnchorDeserialize, Clone, Debug, PartialEq)]
pub enum ContentAction {
    View,
    Interact,
    Moderate,
}

/// 内容政策验证器
pub struct ContentPolicyValidator;

impl ContentPolicyValidator {
    /// 验证内容是否符合社区政策
    pub fn validate_community_policy(
        content_data: &ContentData,
        community_guidelines: &CommunityGuidelines,
    ) -> Result<ValidationResult> {
        let mut score = 100.0;
        let mut messages = Vec::new();
        
        // 检查内容长度政策
        if let Some(max_length) = community_guidelines.max_content_length {
            if content_data.text.len() > max_length as usize {
                score -= 30.0;
                messages.push("Content exceeds community length limit".to_string());
            }
        }
        
        // 检查禁用词汇
        for banned_word in &community_guidelines.banned_words {
            if content_data.text.to_lowercase().contains(&banned_word.to_lowercase()) {
                score -= 25.0;
                messages.push(format!("Contains banned word: {}", banned_word));
            }
        }
        
        // 检查媒体政策
        if !community_guidelines.allow_media && !content_data.media_attachments.is_empty() {
            score -= 40.0;
            messages.push("Media not allowed in this community".to_string());
        }
        
        let success = score >= community_guidelines.minimum_score_threshold;
        let message = if messages.is_empty() {
            "Community policy validation passed".to_string()
        } else {
            messages.join("; ")
        };
        
        Ok(ValidationResult {
            success,
            score,
            message,
            validator_id: "community_policy".to_string(),
            timestamp: Clock::get()?.unix_timestamp,
        })
    }
}

/// 社区指导原则
#[derive(AnchorSerialize, AnchorDeserialize, Clone, Debug)]
pub struct CommunityGuidelines {
    pub max_content_length: Option<u32>,
    pub banned_words: Vec<String>,
    pub allow_media: bool,
    pub require_content_warnings: bool,
    pub minimum_score_threshold: f64,
    pub auto_moderation_enabled: bool,
}
