use anchor_lang::prelude::*;
use crate::{types::*, errors::AlchemeError, constants::*};

/// 验证器特征定义
pub trait Validator {
    /// 执行验证
    fn validate(&self, context: &ValidationContext) -> Result<ValidationResult>;
    
    /// 获取验证器类型
    fn get_validator_type(&self) -> ValidatorType;
    
    /// 获取验证器权重
    fn get_weight(&self) -> u32;
    
    /// 检查是否启用
    fn is_enabled(&self) -> bool;
}

/// 验证结果
#[derive(AnchorSerialize, AnchorDeserialize, Clone, Debug, PartialEq)]
pub struct ValidationResult {
    pub success: bool,
    pub score: f64,
    pub message: String,
    pub validator_id: String,
    pub timestamp: i64,
}

/// 验证器类型
#[derive(AnchorSerialize, AnchorDeserialize, Clone, Debug, PartialEq)]
pub enum ValidatorType {
    Required,    // 必需验证器 - 必须通过
    Optional,    // 可选验证器 - 可以失败但会影响分数
    Scoring,     // 评分验证器 - 仅影响分数
    Monitoring,  // 监控验证器 - 仅记录，不影响结果
}

/// 验证器信息
#[derive(AnchorSerialize, AnchorDeserialize, Clone, Debug)]
pub struct ValidatorInfo {
    pub validator_id: String,
    pub validator_type: ValidatorType,
    pub weight: u32,
    pub enabled: bool,
    pub config: ValidatorConfig,
    pub created_at: i64,
    pub last_updated: i64,
}

/// 验证器配置
#[derive(AnchorSerialize, AnchorDeserialize, Clone, Debug)]
pub struct ValidatorConfig {
    pub timeout_seconds: u32,
    pub retry_attempts: u32,
    pub min_score_threshold: f64,
    pub custom_params: Vec<(String, String)>,
}

/// 验证协调器 - 分布式验证的核心协调逻辑
pub struct ValidationCoordinator;

impl ValidationCoordinator {
    /// 协调多个验证器执行验证
    pub fn coordinate_validation(
        validators: &[ValidatorInfo],
        context: &ValidationContext,
    ) -> Result<CoordinatedValidationResult> {
        let mut results = Vec::new();
        let mut total_score = 0.0;
        let mut total_weight = 0u32;
        let mut required_failed = false;

        // 按优先级排序验证器（Required > Optional > Scoring > Monitoring）
        let mut sorted_validators = validators.to_vec();
        sorted_validators.sort_by(|a, b| {
            Self::get_validator_priority(&a.validator_type)
                .cmp(&Self::get_validator_priority(&b.validator_type))
        });

        // 执行验证
        for validator_info in sorted_validators.iter() {
            if !validator_info.enabled {
                continue;
            }

            // 创建具体的验证器实例并执行
            let result = Self::execute_validator(validator_info, context)?;
            
            // 处理验证结果
            match validator_info.validator_type {
                ValidatorType::Required => {
                    if !result.success {
                        required_failed = true;
                        // 必需验证器失败，记录但继续执行其他验证器以收集完整信息
                    }
                    total_score += result.score * validator_info.weight as f64;
                    total_weight += validator_info.weight;
                }
                ValidatorType::Optional => {
                    // 可选验证器失败不会导致整体失败，但会影响分数
                    if result.success {
                        total_score += result.score * validator_info.weight as f64;
                    } else {
                        total_score += (result.score * 0.5) * validator_info.weight as f64; // 失败时减半分数
                    }
                    total_weight += validator_info.weight;
                }
                ValidatorType::Scoring => {
                    // 评分验证器只影响分数
                    total_score += result.score * validator_info.weight as f64;
                    total_weight += validator_info.weight;
                }
                ValidatorType::Monitoring => {
                    // 监控验证器不影响结果，仅记录
                }
            }

            results.push(result);
        }

        // 计算最终分数
        let final_score = if total_weight > 0 {
            total_score / total_weight as f64
        } else {
            0.0
        };

        // 确定最终结果
        let overall_success = !required_failed && final_score >= VALIDATION_PASS_THRESHOLD;

        Ok(CoordinatedValidationResult {
            success: overall_success,
            overall_score: final_score,
            individual_results: results,
            executed_at: Clock::get()?.unix_timestamp,
            context: context.clone(),
        })
    }

    /// 执行单个验证器
    fn execute_validator(
        validator_info: &ValidatorInfo,
        context: &ValidationContext,
    ) -> Result<ValidationResult> {
        // 根据验证器ID和操作类型创建具体的验证器实例
        let validator = Self::create_validator_instance(validator_info, context)?;
        
        // 执行验证，带超时控制
        let start_time = Clock::get()?.unix_timestamp;
        let result = validator.validate(context);
        let end_time = Clock::get()?.unix_timestamp;

        // 检查超时
        if (end_time - start_time) > validator_info.config.timeout_seconds as i64 {
            return Ok(ValidationResult {
                success: false,
                score: 0.0,
                message: "Validation timeout".to_string(),
                validator_id: validator_info.validator_id.clone(),
                timestamp: end_time,
            });
        }

        result
    }

    /// 创建验证器实例
    fn create_validator_instance(
        validator_info: &ValidatorInfo,
        context: &ValidationContext,
    ) -> Result<Box<dyn Validator>> {
        match (validator_info.validator_id.as_str(), &context.operation) {
            // 身份验证器
            ("handle_format", OperationType::IdentityRegistration) => {
                Ok(Box::new(HandleFormatValidator::new(validator_info)))
            }
            ("identity_uniqueness", OperationType::IdentityRegistration) => {
                Ok(Box::new(IdentityUniquenessValidator::new(validator_info)))
            }
            
            // 内容验证器
            ("content_format", OperationType::ContentCreation) => {
                Ok(Box::new(ContentFormatValidator::new(validator_info)))
            }
            ("content_policy", OperationType::ContentCreation) => {
                Ok(Box::new(ContentPolicyValidator::new(validator_info)))
            }
            
            // 权限验证器
            ("permission_rules", OperationType::PermissionCheck) => {
                Ok(Box::new(PermissionRulesValidator::new(validator_info)))
            }
            
            _ => Err(AlchemeError::ValidatorNotFound.into()),
        }
    }

    /// 获取验证器优先级
    fn get_validator_priority(validator_type: &ValidatorType) -> u8 {
        match validator_type {
            ValidatorType::Required => 0,
            ValidatorType::Optional => 1,
            ValidatorType::Scoring => 2,
            ValidatorType::Monitoring => 3,
        }
    }
}

/// 协调验证结果
#[derive(AnchorSerialize, AnchorDeserialize, Clone, Debug)]
pub struct CoordinatedValidationResult {
    pub success: bool,
    pub overall_score: f64,
    pub individual_results: Vec<ValidationResult>,
    pub executed_at: i64,
    pub context: ValidationContext,
}

// ==================== 具体验证器实现 ====================

/// 用户名格式验证器
pub struct HandleFormatValidator {
    info: ValidatorInfo,
}

impl HandleFormatValidator {
    pub fn new(info: &ValidatorInfo) -> Self {
        Self {
            info: info.clone(),
        }
    }
}

impl Validator for HandleFormatValidator {
    fn validate(&self, context: &ValidationContext) -> Result<ValidationResult> {
        // 从验证上下文中提取用户名
        let handle = String::from_utf8(context.additional_data.clone())
            .map_err(|_| AlchemeError::DeserializationError)?;

        // 执行用户名格式验证
        let validation_result = crate::utils::ValidationUtils::validate_handle(&handle);
        
        let (success, score, message) = match validation_result {
            Ok(_) => (true, 100.0, "Handle format is valid".to_string()),
            Err(e) => (false, 0.0, format!("Handle format invalid: {:?}", e)),
        };

        Ok(ValidationResult {
            success,
            score,
            message,
            validator_id: self.info.validator_id.clone(),
            timestamp: Clock::get()?.unix_timestamp,
        })
    }

    fn get_validator_type(&self) -> ValidatorType {
        self.info.validator_type.clone()
    }

    fn get_weight(&self) -> u32 {
        self.info.weight
    }

    fn is_enabled(&self) -> bool {
        self.info.enabled
    }
}

/// 身份唯一性验证器
pub struct IdentityUniquenessValidator {
    info: ValidatorInfo,
}

impl IdentityUniquenessValidator {
    pub fn new(info: &ValidatorInfo) -> Self {
        Self {
            info: info.clone(),
        }
    }
}

impl Validator for IdentityUniquenessValidator {
    fn validate(&self, _context: &ValidationContext) -> Result<ValidationResult> {
        // 这里应该检查身份的唯一性
        // 在实际实现中，需要查询现有的身份记录
        
        Ok(ValidationResult {
            success: true,
            score: 100.0,
            message: "Identity uniqueness validated".to_string(),
            validator_id: self.info.validator_id.clone(),
            timestamp: Clock::get()?.unix_timestamp,
        })
    }

    fn get_validator_type(&self) -> ValidatorType {
        self.info.validator_type.clone()
    }

    fn get_weight(&self) -> u32 {
        self.info.weight
    }

    fn is_enabled(&self) -> bool {
        self.info.enabled
    }
}

/// 内容格式验证器
pub struct ContentFormatValidator {
    info: ValidatorInfo,
}

impl ContentFormatValidator {
    pub fn new(info: &ValidatorInfo) -> Self {
        Self {
            info: info.clone(),
        }
    }
}

impl Validator for ContentFormatValidator {
    fn validate(&self, context: &ValidationContext) -> Result<ValidationResult> {
        // 从验证上下文中提取内容数据
        let content_data: ContentData = ContentData::try_from_slice(&context.additional_data)
            .map_err(|_| AlchemeError::DeserializationError)?;

        // 验证内容格式
        let mut score = 100.0;
        let mut messages = Vec::new();

        // 检查文本长度
        if content_data.text.len() > MAX_TEXT_LENGTH {
            score -= 50.0;
            messages.push("Text too long".to_string());
        }

        // 检查媒体附件
        if content_data.media_attachments.len() > MAX_MEDIA_ATTACHMENTS {
            score -= 30.0;
            messages.push("Too many media attachments".to_string());
        }

        let success = score >= self.info.config.min_score_threshold;
        let message = if messages.is_empty() {
            "Content format is valid".to_string()
        } else {
            messages.join("; ")
        };

        Ok(ValidationResult {
            success,
            score,
            message,
            validator_id: self.info.validator_id.clone(),
            timestamp: Clock::get()?.unix_timestamp,
        })
    }

    fn get_validator_type(&self) -> ValidatorType {
        self.info.validator_type.clone()
    }

    fn get_weight(&self) -> u32 {
        self.info.weight
    }

    fn is_enabled(&self) -> bool {
        self.info.enabled
    }
}

/// 内容政策验证器
pub struct ContentPolicyValidator {
    info: ValidatorInfo,
}

impl ContentPolicyValidator {
    pub fn new(info: &ValidatorInfo) -> Self {
        Self {
            info: info.clone(),
        }
    }
}

impl Validator for ContentPolicyValidator {
    fn validate(&self, context: &ValidationContext) -> Result<ValidationResult> {
        // 从验证上下文中提取内容数据
        let content_data: ContentData = ContentData::try_from_slice(&context.additional_data)
            .map_err(|_| AlchemeError::DeserializationError)?;

        // 简单的内容政策检查（实际实现中可能需要更复杂的逻辑）
        let mut score = 100.0;
        let mut messages = Vec::new();

        // 检查是否包含敏感词汇（简化版）
        let sensitive_words = ["spam", "scam", "fake"];
        let text_lower = content_data.text.to_lowercase();
        
        for word in sensitive_words.iter() {
            if text_lower.contains(word) {
                score -= 25.0;
                messages.push(format!("Contains potentially sensitive word: {}", word));
            }
        }

        let success = score >= self.info.config.min_score_threshold;
        let message = if messages.is_empty() {
            "Content policy check passed".to_string()
        } else {
            messages.join("; ")
        };

        Ok(ValidationResult {
            success,
            score,
            message,
            validator_id: self.info.validator_id.clone(),
            timestamp: Clock::get()?.unix_timestamp,
        })
    }

    fn get_validator_type(&self) -> ValidatorType {
        self.info.validator_type.clone()
    }

    fn get_weight(&self) -> u32 {
        self.info.weight
    }

    fn is_enabled(&self) -> bool {
        self.info.enabled
    }
}

/// 权限规则验证器
pub struct PermissionRulesValidator {
    info: ValidatorInfo,
}

impl PermissionRulesValidator {
    pub fn new(info: &ValidatorInfo) -> Self {
        Self {
            info: info.clone(),
        }
    }
}

impl Validator for PermissionRulesValidator {
    fn validate(&self, _context: &ValidationContext) -> Result<ValidationResult> {
        // 这里应该实现具体的权限规则验证逻辑
        // 在实际实现中，需要查询用户的权限配置和规则
        
        let success = true; // 简化实现
        let score = 100.0;
        let message = "Permission rules validated".to_string();

        Ok(ValidationResult {
            success,
            score,
            message,
            validator_id: self.info.validator_id.clone(),
            timestamp: Clock::get()?.unix_timestamp,
        })
    }

    fn get_validator_type(&self) -> ValidatorType {
        self.info.validator_type.clone()
    }

    fn get_weight(&self) -> u32 {
        self.info.weight
    }

    fn is_enabled(&self) -> bool {
        self.info.enabled
    }
}

/// 验证工厂 - 用于创建和管理验证器
pub struct ValidationFactory;

impl ValidationFactory {
    /// 创建默认的身份验证器集合
    pub fn create_identity_validators() -> Vec<ValidatorInfo> {
        vec![
            ValidatorInfo {
                validator_id: "handle_format".to_string(),
                validator_type: ValidatorType::Required,
                weight: REQUIRED_VALIDATOR_WEIGHT,
                enabled: true,
                config: ValidatorConfig {
                    timeout_seconds: 30,
                    retry_attempts: 3,
                    min_score_threshold: 80.0,
                    custom_params: vec![],
                },
                created_at: 0, // 在实际使用时会被设置
                last_updated: 0,
            },
            ValidatorInfo {
                validator_id: "identity_uniqueness".to_string(),
                validator_type: ValidatorType::Required,
                weight: REQUIRED_VALIDATOR_WEIGHT,
                enabled: true,
                config: ValidatorConfig {
                    timeout_seconds: 60,
                    retry_attempts: 2,
                    min_score_threshold: 100.0,
                    custom_params: vec![],
                },
                created_at: 0,
                last_updated: 0,
            },
        ]
    }

    /// 创建默认的内容验证器集合
    pub fn create_content_validators() -> Vec<ValidatorInfo> {
        vec![
            ValidatorInfo {
                validator_id: "content_format".to_string(),
                validator_type: ValidatorType::Required,
                weight: REQUIRED_VALIDATOR_WEIGHT,
                enabled: true,
                config: ValidatorConfig {
                    timeout_seconds: 30,
                    retry_attempts: 3,
                    min_score_threshold: 70.0,
                    custom_params: vec![],
                },
                created_at: 0,
                last_updated: 0,
            },
            ValidatorInfo {
                validator_id: "content_policy".to_string(),
                validator_type: ValidatorType::Optional,
                weight: OPTIONAL_VALIDATOR_WEIGHT,
                enabled: true,
                config: ValidatorConfig {
                    timeout_seconds: 45,
                    retry_attempts: 2,
                    min_score_threshold: 60.0,
                    custom_params: vec![],
                },
                created_at: 0,
                last_updated: 0,
            },
        ]
    }

    /// 创建默认的权限验证器集合
    pub fn create_permission_validators() -> Vec<ValidatorInfo> {
        vec![
            ValidatorInfo {
                validator_id: "permission_rules".to_string(),
                validator_type: ValidatorType::Required,
                weight: REQUIRED_VALIDATOR_WEIGHT,
                enabled: true,
                config: ValidatorConfig {
                    timeout_seconds: 30,
                    retry_attempts: 3,
                    min_score_threshold: 100.0,
                    custom_params: vec![],
                },
                created_at: 0,
                last_updated: 0,
            },
        ]
    }
}
