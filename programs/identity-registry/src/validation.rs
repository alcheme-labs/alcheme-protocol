use anchor_lang::prelude::*;
use alcheme_shared::*;
use crate::state::ProfileUpdates;

pub const MAX_PROFILE_DISPLAY_NAME_LENGTH: usize = 128;
pub const MAX_PROFILE_URI_LENGTH: usize = 256;
pub const MAX_PROFILE_LOCATION_LENGTH: usize = 128;
pub const MAX_PROFILE_METADATA_URI_LENGTH: usize = 256;

/// Identity Registry 专用验证器
pub struct IdentityValidator;

impl IdentityValidator {
    /// 验证用户名格式
    pub fn validate_handle(handle: &str) -> Result<()> {
        ValidationUtils::validate_handle(handle)
    }
    
    /// 验证身份配置
    pub fn validate_identity_config(
        handle: &str,
        _privacy_settings: &PrivacyConfig,
    ) -> Result<()> {
        // 验证用户名
        Self::validate_handle(handle)?;
        
        // 验证隐私设置
        Self::validate_privacy_config(_privacy_settings)?;
        
        Ok(())
    }
    
    /// 验证隐私配置
    pub fn validate_privacy_config(privacy_config: &PrivacyConfig) -> Result<()> {
        // 验证数据保留期限
        if let Some(retention_days) = privacy_config.data_retention_days {
            require!(
                retention_days >= 30 && retention_days <= 3650, // 30天到10年
                AlchemeError::InvalidOperation
            );
        }
        
        Ok(())
    }
    
    /// 验证验证器权限
    pub fn validate_verifier_authority(verifier: &Pubkey) -> Result<()> {
        // 这里应该检查验证器是否在授权列表中
        // 简化实现：检查是否是已知的验证器程序
        let authorized_verifiers = [
            ACCESS_CONTROLLER_ID,
            CONTENT_MANAGER_ID,
            EVENT_EMITTER_ID,
        ];
        
        require!(
            authorized_verifiers.contains(verifier),
            AlchemeError::ValidatorUnauthorized
        );
        
        Ok(())
    }
    
    /// 验证声誉权限
    pub fn validate_reputation_authority(authority: &Pubkey) -> Result<()> {
        // 检查是否有权限更新声誉
        let authorized_reputation_updaters = [
            CONTENT_MANAGER_ID,
            ACCESS_CONTROLLER_ID,
        ];
        
        require!(
            authorized_reputation_updaters.contains(authority),
            AlchemeError::Unauthorized
        );
        
        Ok(())
    }
    
    /// 检查是否是管理员
    pub fn is_admin(_authority: &Pubkey) -> bool {
        // 简化实现：硬编码管理员列表
        // 在实际实现中，应该从注册表配置中读取
        false // 暂时返回false，实际实现时需要查询注册表
    }

    pub fn validate_profile_display_name(display_name: &str) -> Result<()> {
        ValidationUtils::validate_string_length(
            display_name,
            MAX_PROFILE_DISPLAY_NAME_LENGTH,
            AlchemeError::InvalidOperation,
        )
    }

    pub fn validate_profile_location(location: &str) -> Result<()> {
        ValidationUtils::validate_string_length(
            location,
            MAX_PROFILE_LOCATION_LENGTH,
            AlchemeError::InvalidOperation,
        )
    }

    pub fn validate_profile_uri(uri: &str) -> Result<()> {
        ValidationUtils::validate_string_length(
            uri,
            MAX_PROFILE_URI_LENGTH,
            AlchemeError::InvalidOperation,
        )
    }

    pub fn validate_profile_metadata_uri(metadata_uri: &str) -> Result<()> {
        ValidationUtils::validate_string_length(
            metadata_uri,
            MAX_PROFILE_METADATA_URI_LENGTH,
            AlchemeError::InvalidOperation,
        )
    }

    pub fn validate_profile_attribute(attribute: &KeyValue) -> Result<()> {
        ValidationUtils::validate_string_length(
            &attribute.key,
            64,
            AlchemeError::InvalidOperation,
        )?;
        ValidationUtils::validate_string_length(
            &attribute.value,
            256,
            AlchemeError::InvalidOperation,
        )?;
        Ok(())
    }
}

/// Identity Registry 分布式验证实现
pub struct IdentityValidationModule;

impl IdentityValidationModule {
    /// 执行身份注册验证
    pub fn validate_identity_registration(
        handle: &str,
        privacy_settings: &PrivacyConfig,
    ) -> Result<ValidationResult> {
        // 创建验证上下文
        let context = ValidationContext {
            requester: Pubkey::default(), // 在实际实现中应该传入
            operation: OperationType::IdentityRegistration,
            target: None,
            timestamp: Clock::get()?.unix_timestamp,
            additional_data: handle.as_bytes().to_vec(),
        };
        
        // 获取身份验证器列表
        let validators = ValidationFactory::create_identity_validators();
        
        // 协调验证
        let result = ValidationCoordinator::coordinate_validation(&validators, &context)?;
        
        // 返回主要验证结果
        Ok(ValidationResult {
            success: result.success,
            score: result.overall_score,
            message: format!("Identity registration validation: {}", 
                           if result.success { "PASSED" } else { "FAILED" }),
            validator_id: "identity_registration".to_string(),
            timestamp: result.executed_at,
        })
    }
    
    /// 执行档案数据验证
    pub fn validate_profile_update(
        profile_updates: &ProfileUpdates,
    ) -> Result<ValidationResult> {
        let mut score = 100.0;
        let mut messages = Vec::new();
        
        // 验证各个字段
        if let Some(display_name) = &profile_updates.display_name {
            if IdentityValidator::validate_profile_display_name(display_name).is_err() {
                score -= 20.0;
                messages.push("Display name too long".to_string());
            }
        }

        if let Some(bio) = &profile_updates.bio {
            if bio.len() > MAX_BIO_LENGTH {
                score -= 30.0;
                messages.push("Bio too long".to_string());
            }
        }

        if let Some(avatar_uri) = &profile_updates.avatar_uri {
            if IdentityValidator::validate_profile_uri(avatar_uri).is_err() {
                score -= 15.0;
                messages.push("Avatar URI too long".to_string());
            }
        }

        if let Some(banner_uri) = &profile_updates.banner_uri {
            if IdentityValidator::validate_profile_uri(banner_uri).is_err() {
                score -= 15.0;
                messages.push("Banner URI too long".to_string());
            }
        }

        if let Some(website) = &profile_updates.website {
            if ValidationUtils::validate_url(website).is_err() {
                score -= 15.0;
                messages.push("Invalid website URL".to_string());
            }
        }

        if let Some(location) = &profile_updates.location {
            if IdentityValidator::validate_profile_location(location).is_err() {
                score -= 10.0;
                messages.push("Location too long".to_string());
            }
        }

        if let Some(custom_fields) = &profile_updates.custom_fields {
            for attribute in custom_fields {
                if IdentityValidator::validate_profile_attribute(attribute).is_err() {
                    score -= 10.0;
                    messages.push("Custom attribute too large".to_string());
                    break;
                }
            }
        }
        
        let success = score >= 70.0;
        let message = if messages.is_empty() {
            "Profile validation passed".to_string()
        } else {
            messages.join("; ")
        };
        
        Ok(ValidationResult {
            success,
            score,
            message,
            validator_id: "profile_update".to_string(),
            timestamp: Clock::get()?.unix_timestamp,
        })
    }
}
