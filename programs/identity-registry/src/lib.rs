use anchor_lang::prelude::*;
use alcheme_shared::{
    types::*, errors::*, constants::*, utils::*, validation::*,
    events::*, access::*, content::*, factory::*
};

pub mod instructions;
pub mod state;
pub mod validation;

// Re-export for convenience
pub use instructions::*;
pub use state::*;
pub use validation::*;

// Program ID
declare_id!("75fXAp66PU3sgUcQCGJxdA4MKhFcyXXoGW8rhVk8zm4x");

/// Identity Registry Program - 身份注册表程序
#[program]
pub mod identity_registry {
    use super::*;

    // ==================== 注册表管理指令 ====================

    /// 初始化身份注册表
    pub fn initialize_identity_registry(
        ctx: Context<InitializeIdentityRegistry>,
        registry_name: String,
        metadata_uri: String,
        settings: RegistrySettings,
    ) -> Result<()> {
        instructions::initialize_identity_registry(ctx, registry_name, metadata_uri, settings)
    }

    // ==================== 身份管理指令 ====================

    /// 注册新身份
    pub fn register_identity(
        ctx: Context<RegisterIdentity>,
        handle: String,
        privacy_settings: PrivacyConfig,
    ) -> Result<()> {
        instructions::register_identity(ctx, handle, privacy_settings)
    }

    /// 更新身份信息
    pub fn update_identity(
        ctx: Context<UpdateIdentity>,
        updates: IdentityUpdates,
    ) -> Result<()> {
        instructions::update_identity(ctx, updates)
    }

    /// 添加验证属性
    pub fn add_verification_attribute(
        ctx: Context<AddVerificationAttribute>,
        attribute: VerifiedAttribute,
    ) -> Result<()> {
        instructions::add_verification_attribute(ctx, attribute)
    }

    /// 更新声誉分数
    pub fn update_reputation(
        ctx: Context<UpdateReputation>,
        reputation_delta: f64,
        trust_delta: f64,
        reason: String,
    ) -> Result<()> {
        instructions::update_reputation(ctx, reputation_delta, trust_delta, reason)
    }

    // ==================== 查询指令 (CPI 接口) ====================

    /// 验证身份 (CPI)
    pub fn verify_identity(
        ctx: Context<VerifyIdentity>,
        identity_id: Pubkey,
    ) -> Result<UserIdentity> {
        instructions::verify_identity(ctx, identity_id)
    }

    /// 获取用户声誉 (CPI)
    pub fn get_user_reputation(
        ctx: Context<GetUserReputation>,
        identity_id: Pubkey,
    ) -> Result<(f64, f64)> { // (reputation_score, trust_score)
        instructions::get_user_reputation(ctx, identity_id)
    }

    /// 检查用户名可用性 (CPI)
    pub fn check_handle_availability(
        ctx: Context<CheckHandleAvailability>,
        handle: String,
    ) -> Result<bool> {
        instructions::check_handle_availability(ctx, handle)
    }

    /// 获取身份信息 (CPI)
    pub fn get_identity_info(
        ctx: Context<GetIdentityInfo>,
        identity_id: Pubkey,
    ) -> Result<UserIdentity> {
        instructions::get_identity_info(ctx, identity_id)
    }

    // ==================== 社交统计指令 ====================

    /// 更新社交统计
    pub fn update_social_stats(
        ctx: Context<UpdateSocialStats>,
        follower_delta: i64,
        following_delta: i64,
    ) -> Result<()> {
        instructions::update_social_stats(ctx, follower_delta, following_delta)
    }

    /// 更新经济统计
    pub fn update_economic_stats(
        ctx: Context<UpdateEconomicStats>,
        tokens_earned_delta: u64,
        tokens_spent_delta: u64,
    ) -> Result<()> {
        instructions::update_economic_stats(ctx, tokens_earned_delta, tokens_spent_delta)
    }

    /// 更新内容创作统计
    pub fn update_content_stats(
        ctx: Context<UpdateContentStats>,
        content_created_delta: u64,
        interactions_delta: u64,
        quality_score_update: f64,
    ) -> Result<()> {
        instructions::update_content_stats(ctx, content_created_delta, interactions_delta, quality_score_update)
    }

    // ==================== Extension CPI 接口 ====================

    /// 通过扩展程序更新声誉（需要 ReputationWrite 权限）
    pub fn update_reputation_by_extension(
        ctx: Context<UpdateReputationByExtension>,
        reputation_delta: f64,
        trust_delta: f64,
        reason: String,
    ) -> Result<()> {
        instructions::update_reputation_by_extension(ctx, reputation_delta, trust_delta, reason)
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    fn sample_privacy_config() -> PrivacyConfig {
        PrivacyConfig {
            profile_visibility: AccessLevel::Public,
            content_visibility: AccessLevel::Public,
            social_graph_visibility: AccessLevel::Public,
            activity_visibility: AccessLevel::Public,
            economic_data_visibility: AccessLevel::Public,
            allow_direct_messages: true,
            allow_mentions: true,
            allow_content_indexing: true,
            data_retention_days: None,
        }
    }

    fn sample_identity() -> UserIdentity {
        UserIdentity {
            identity_id: Pubkey::new_unique(),
            primary_handle: "alchemist".to_string(),
            alternative_handles: Vec::new(),
            created_at: 1_700_000_000,
            last_active: 1_700_000_000,
            verification_level: VerificationLevel::None,
            verified_attributes: Vec::new(),
            verification_history: Vec::new(),
            follower_count: 0,
            following_count: 0,
            connection_strength: 0.0,
            social_rank: 0,
            content_created: 0,
            total_interactions: 0,
            content_quality_score: 0.0,
            reputation_score: 50.0,
            trust_score: 50.0,
            community_standing: CommunityStanding::NewMember,
            tokens_earned: 0,
            tokens_spent: 0,
            economic_activity_score: 0.0,
            last_economic_activity: 0,
            privacy_settings: sample_privacy_config(),
            notification_preferences: NotificationConfig::default(),
            display_preferences: DisplayConfig::default(),
            metadata_uri: String::new(),
            custom_attributes: Vec::new(),
            app_specific_data: Vec::new(),
        }
    }

    fn repeated(ch: char, len: usize) -> String {
        std::iter::repeat_n(ch, len).collect()
    }

    #[test]
    fn prepare_identity_profile_update_calculates_required_realloc_for_realistic_payload() {
        let identity = sample_identity();
        let updates = IdentityUpdates {
            display_name: Some(repeated('d', 128)),
            bio: Some(repeated('b', MAX_BIO_LENGTH)),
            avatar_uri: Some(format!("https://cdn.alcheme.test/{}.png", repeated('a', 220))),
            banner_uri: Some(format!("https://cdn.alcheme.test/{}.png", repeated('n', 220))),
            website: Some(format!("https://{}.example.com", repeated('w', 120))),
            location: Some(repeated('l', 128)),
            metadata_uri: Some(format!("ipfs://{}", repeated('m', 240))),
            custom_attributes: Some(vec![KeyValue {
                key: "theme".to_string(),
                value: "amber".to_string(),
            }]),
        };

        let prepared = prepare_identity_profile_update(&identity, &updates)
            .expect("realistic protocol profile payload should be measurable");

        let current_account_space = 8 + identity.try_to_vec().expect("serialize identity").len();
        assert!(
            prepared.required_account_space > current_account_space,
            "realistic profile payload should require realloc beyond the current identity account"
        );
        assert!(
            prepared.required_account_space - current_account_space <= 10_240,
            "single profile realloc should stay within Solana's per-realloc growth bound"
        );
        assert_eq!(
            prepared.updated_fields,
            vec![
                "display_name".to_string(),
                "bio".to_string(),
                "avatar_uri".to_string(),
                "banner_uri".to_string(),
                "website".to_string(),
                "location".to_string(),
                "metadata_uri".to_string(),
                "custom_attributes".to_string(),
            ]
        );
    }

    #[test]
    fn prepare_identity_profile_update_materializes_reserved_fields_and_preserves_generic_custom_attributes() {
        let mut identity = sample_identity();
        let updates = IdentityUpdates {
            display_name: Some("The Alchemist".to_string()),
            bio: Some("把分散观点炼成可回放的知识。".to_string()),
            avatar_uri: Some("https://cdn.alcheme.test/avatar.png".to_string()),
            banner_uri: Some("https://cdn.alcheme.test/banner.png".to_string()),
            website: Some("https://alcheme.test".to_string()),
            location: Some("Edmonton".to_string()),
            metadata_uri: Some("ipfs://profile-metadata".to_string()),
            custom_attributes: Some(vec![KeyValue {
                key: "theme".to_string(),
                value: "amber".to_string(),
            }]),
        };

        let prepared = prepare_identity_profile_update(&identity, &updates)
            .expect("profile update should prepare successfully");
        identity
            .write_protocol_profile(&prepared.next_profile)
            .expect("prepared profile should materialize on identity storage");

        let profile = identity.protocol_profile();
        assert_eq!(profile.display_name.as_deref(), Some("The Alchemist"));
        assert_eq!(profile.bio.as_deref(), Some("把分散观点炼成可回放的知识。"));
        assert_eq!(
            profile.avatar_uri.as_deref(),
            Some("https://cdn.alcheme.test/avatar.png")
        );
        assert_eq!(
            profile.banner_uri.as_deref(),
            Some("https://cdn.alcheme.test/banner.png")
        );
        assert_eq!(profile.website.as_deref(), Some("https://alcheme.test"));
        assert_eq!(profile.location.as_deref(), Some("Edmonton"));
        assert_eq!(profile.metadata_uri, "ipfs://profile-metadata".to_string());
        assert_eq!(
            profile.custom_attributes,
            vec![KeyValue {
                key: "theme".to_string(),
                value: "amber".to_string(),
            }]
        );
        assert!(
            identity.custom_attributes.len() > profile.custom_attributes.len(),
            "reserved protocol profile fields should live inside the stored custom_attributes vector"
        );
    }

    #[test]
    fn prepare_identity_profile_update_rejects_reserved_profile_keys_inside_custom_attributes() {
        let identity = sample_identity();
        let updates = IdentityUpdates {
            display_name: None,
            bio: None,
            avatar_uri: None,
            banner_uri: None,
            website: None,
            location: None,
            metadata_uri: None,
            custom_attributes: Some(vec![KeyValue {
                key: "__profile.display_name".to_string(),
                value: "shadow-truth".to_string(),
            }]),
        };

        let error = prepare_identity_profile_update(&identity, &updates)
            .expect_err("reserved protocol keys must not be accepted through generic custom_attributes");
        assert_eq!(error, AlchemeError::InvalidOperation.into());
    }
}
