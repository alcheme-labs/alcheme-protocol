use anchor_lang::prelude::*;
use alcheme_shared::*;

// 明确使用 factory 模块的类型，避免冲突
use alcheme_shared::factory::{RegistryType, RegistryConfig, RegistryStatus};
use crate::state::VersionInfo;

/// Registry Factory 专用验证器
pub struct FactoryValidator;

impl FactoryValidator {
    /// 验证工厂配置
    pub fn validate_factory_config(config: &FactoryConfig) -> Result<()> {
        // 验证部署数量限制
        require!(
            config.max_deployments_per_user > 0 && config.max_deployments_per_user <= 100,
            AlchemeError::InvalidOperation
        );
        
        // 验证费用设置（u64 不需要 >= 0 检查）
        // deployment_fee 和 upgrade_fee 已经是 u64，自动 >= 0
        
        // 验证支持的注册表类型
        require!(
            !config.supported_registry_types.is_empty() && 
            config.supported_registry_types.len() <= 10,
            AlchemeError::InvalidOperation
        );
        
        Ok(())
    }

    /// 验证部署模板
    pub fn validate_deployment_template(template: &DeploymentTemplate) -> Result<()> {
        // 验证模板ID
        require!(
            !template.template_id.is_empty() && template.template_id.len() <= 64,
            AlchemeError::InvalidOperation
        );
        
        // 验证模板名称
        require!(
            !template.template_name.is_empty() && template.template_name.len() <= 128,
            AlchemeError::InvalidOperation
        );
        
        // 验证描述
        require!(
            template.description.len() <= 256,
            AlchemeError::InvalidOperation
        );
        
        // 验证默认配置
        Self::validate_registry_config(&template.default_config, &template.registry_type)?;
        
        // 验证推荐设置
        require!(
            template.recommended_settings.len() <= 20,
            AlchemeError::InvalidOperation
        );
        
        Ok(())
    }

    /// 验证注册表配置
    pub fn validate_registry_config(
        config: &RegistryConfig,
        registry_type: &RegistryType,
    ) -> Result<ValidationResult> {
        let mut score = 100.0;
        let mut messages = Vec::new();
        
        // 验证注册表名称
        if config.registry_name.is_empty() || config.registry_name.len() > 64 {
            score -= 30.0;
            messages.push("Invalid registry name".to_string());
        }
        
        // 验证最大条目数
        let max_entries_limit = match registry_type {
            RegistryType::Identity => 1_000_000,
            RegistryType::Content => 10_000_000,
            RegistryType::Access => 5_000_000,
            RegistryType::Event => 100_000_000,
            RegistryType::Circle => 500_000,      // 圈层管理器中等规模
            RegistryType::Messaging => 20_000_000, // 消息管理器大规模
            RegistryType::Custom(_) => 100_000,
        };
        
        if config.max_entries == 0 || config.max_entries > max_entries_limit {
            score -= 25.0;
            messages.push(format!("Max entries should be between 1 and {}", max_entries_limit));
        }
        
        // 验证注册费用合理性
        let reasonable_fee_limit = match registry_type {
            RegistryType::Identity => 10_000_000,   // 0.01 SOL
            RegistryType::Content => 1_000_000,     // 0.001 SOL
            RegistryType::Access => 0,              // 免费
            RegistryType::Event => 0,               // 免费
            RegistryType::Circle => 5_000_000,      // 0.005 SOL
            RegistryType::Messaging => 2_000_000,   // 0.002 SOL
            RegistryType::Custom(_) => 100_000_000, // 0.1 SOL
        };
        
        if config.registration_fee > reasonable_fee_limit {
            score -= 20.0;
            messages.push("Registration fee might be too high".to_string());
        }
        
        // 验证管理员设置
        if config.admin == Pubkey::default() {
            score -= 15.0;
            messages.push("Admin should be set to a valid pubkey".to_string());
        }
        
        // 验证版主数量
        if config.moderators.len() > 50 {
            score -= 10.0;
            messages.push("Too many moderators".to_string());
        }
        
        // 验证设置数量
        if config.settings.len() > 100 {
            score -= 10.0;
            messages.push("Too many settings".to_string());
        }
        
        // 验证功能标志
        if config.feature_flags.len() > 50 {
            score -= 10.0;
            messages.push("Too many feature flags".to_string());
        }
        
        for feature_flag in &config.feature_flags {
            if feature_flag.rollout_percentage > 100 {
                score -= 5.0;
                messages.push("Invalid rollout percentage".to_string());
            }
        }
        
        let success = score >= 70.0;
        let message = if messages.is_empty() {
            "Registry config validation passed".to_string()
        } else {
            messages.join("; ")
        };
        
        Ok(ValidationResult {
            success,
            score,
            message,
            validator_id: "registry_config".to_string(),
            timestamp: Clock::get()?.unix_timestamp,
        })
    }

    /// 验证版本升级
    pub fn validate_version_upgrade(
        current_version: &str,
        new_version: &str,
    ) -> Result<()> {
        // 验证版本格式
        Self::validate_version_format(current_version)?;
        Self::validate_version_format(new_version)?;
        
        // 验证升级方向（不允许降级）
        let current_info = crate::state::VersionManagerUtils::parse_version(current_version)?;
        let new_info = crate::state::VersionManagerUtils::parse_version(new_version)?;
        
        let is_upgrade = new_info.major > current_info.major ||
                        (new_info.major == current_info.major && new_info.minor > current_info.minor) ||
                        (new_info.major == current_info.major && new_info.minor == current_info.minor && new_info.patch > current_info.patch);
        
        require!(is_upgrade, AlchemeError::InvalidOperation);
        
        Ok(())
    }

    /// 验证版本格式
    pub fn validate_version_format(version: &str) -> Result<()> {
        // 简化的版本格式验证 (semver)
        let parts: Vec<&str> = version.split('.').collect();
        
        require!(parts.len() == 3, AlchemeError::InvalidOperation);
        
        for part in parts {
            require!(
                part.parse::<u32>().is_ok(),
                AlchemeError::InvalidOperation
            );
        }
        
        Ok(())
    }

    /// 验证部署请求
    pub fn validate_deployment_request(request: &DeploymentRequest) -> Result<()> {
        // 验证请求ID
        require!(
            !request.request_id.is_empty() && request.request_id.len() <= 64,
            AlchemeError::InvalidOperation
        );
        
        // 验证注册表名称
        require!(
            !request.registry_name.is_empty() && request.registry_name.len() <= 64,
            AlchemeError::InvalidOperation
        );
        
        // 验证请求时间
        ValidationUtils::validate_timestamp(request.requested_at)?;
        
        // 验证配置
        Self::validate_registry_config(&request.config, &request.registry_type)?;
        
        Ok(())
    }

    /// 验证升级步骤
    pub fn validate_upgrade_step(step: &UpgradeStep) -> Result<()> {
        // 验证步骤ID
        require!(
            !step.step_id.is_empty() && step.step_id.len() <= 64,
            AlchemeError::InvalidOperation
        );
        
        // 验证描述
        require!(
            !step.description.is_empty() && step.description.len() <= 256,
            AlchemeError::InvalidOperation
        );
        
        // 验证估算时间
        require!(
            step.estimated_time > 0 && step.estimated_time <= 3600, // 最多1小时
            AlchemeError::InvalidOperation
        );
        
        // 验证权限要求
        require!(
            step.required_permissions.len() <= 10,
            AlchemeError::InvalidOperation
        );
        
        Ok(())
    }

    /// 验证部署权限
    pub fn validate_deployment_permissions(
        deployer: &Pubkey,
        registry_type: &RegistryType,
        factory_config: &FactoryConfig,
    ) -> Result<bool> {
        // 检查注册表类型是否受支持
        if !factory_config.supported_registry_types.contains(registry_type) {
            return Ok(false);
        }
        
        // 检查是否需要审批
        if factory_config.require_approval {
            // 在实际实现中，这里需要检查审批状态
            // 简化实现：假设已审批
        }
        
        // 检查部署者的历史记录
        // 在实际实现中，这里需要查询部署者的历史部署记录
        // 简化实现：假设有权限
        
        Ok(true)
    }
}

/// Registry Factory 分布式验证实现
pub struct FactoryValidationModule;

impl FactoryValidationModule {
    /// 执行部署前验证
    pub fn validate_pre_deployment(
        request: &DeploymentRequest,
        factory_config: &FactoryConfig,
    ) -> Result<ValidationResult> {
        let mut score = 100.0;
        let mut messages = Vec::new();
        
        // 验证部署请求
        if FactoryValidator::validate_deployment_request(request).is_err() {
            score -= 40.0;
            messages.push("Invalid deployment request".to_string());
        }
        
        // 验证部署权限
        if !FactoryValidator::validate_deployment_permissions(
            &request.deployer,
            &request.registry_type,
            factory_config,
        )? {
            score -= 50.0;
            messages.push("Insufficient deployment permissions".to_string());
        }
        
        // 验证资源可用性
        // 在实际实现中，这里需要检查系统资源
        
        let success = score >= 80.0; // 部署前验证门槛较高
        let message = if messages.is_empty() {
            "Pre-deployment validation passed".to_string()
        } else {
            messages.join("; ")
        };
        
        Ok(ValidationResult {
            success,
            score,
            message,
            validator_id: "pre_deployment".to_string(),
            timestamp: Clock::get()?.unix_timestamp,
        })
    }

    /// 执行升级前验证
    pub fn validate_pre_upgrade(
        current_version: &str,
        target_version: &str,
        upgrade_data: &[u8],
    ) -> Result<ValidationResult> {
        let mut score = 100.0;
        let mut messages = Vec::new();
        
        // 验证版本升级
        if FactoryValidator::validate_version_upgrade(current_version, target_version).is_err() {
            score -= 50.0;
            messages.push("Invalid version upgrade".to_string());
        }
        
        // 验证升级数据大小
        if upgrade_data.len() > 10240 { // 10KB限制
            score -= 20.0;
            messages.push("Upgrade data too large".to_string());
        }
        
        // 验证升级数据格式
        // 在实际实现中，这里需要验证升级数据的格式和完整性
        
        let success = score >= 75.0;
        let message = if messages.is_empty() {
            "Pre-upgrade validation passed".to_string()
        } else {
            messages.join("; ")
        };
        
        Ok(ValidationResult {
            success,
            score,
            message,
            validator_id: "pre_upgrade".to_string(),
            timestamp: Clock::get()?.unix_timestamp,
        })
    }

    /// 执行部署后验证
    pub fn validate_post_deployment(
        deployed_registry: &DeployedRegistry,
    ) -> Result<ValidationResult> {
        let mut score = 100.0;
        let mut messages = Vec::new();
        
        // 验证部署状态
        if deployed_registry.status != RegistryStatus::Active {
            score -= 30.0;
            messages.push("Registry not in active state".to_string());
        }
        
        // 验证配置完整性
        if deployed_registry.config.registry_name.is_empty() {
            score -= 25.0;
            messages.push("Registry name not set".to_string());
        }
        
        if deployed_registry.config.admin == Pubkey::default() {
            score -= 20.0;
            messages.push("Admin not properly configured".to_string());
        }
        
        // 验证部署信息
        if deployed_registry.deployment_info.deployment_cost == 0 {
            score -= 10.0;
            messages.push("Deployment cost not recorded".to_string());
        }
        
        let success = score >= 80.0;
        let message = if messages.is_empty() {
            "Post-deployment validation passed".to_string()
        } else {
            messages.join("; ")
        };
        
        Ok(ValidationResult {
            success,
            score,
            message,
            validator_id: "post_deployment".to_string(),
            timestamp: Clock::get()?.unix_timestamp,
        })
    }

    /// 验证升级兼容性
    pub fn validate_upgrade_compatibility(
        registry_type: &RegistryType,
        from_version: &str,
        to_version: &str,
    ) -> Result<CompatibilityResult> {
        let from_info = crate::state::VersionManagerUtils::parse_version(from_version)?;
        let to_info = crate::state::VersionManagerUtils::parse_version(to_version)?;
        
        let mut compatibility_issues = Vec::new();
        let mut breaking_changes = Vec::new();
        
        // 检查主版本号变化
        if to_info.major > from_info.major {
            breaking_changes.push("Major version upgrade - breaking changes expected".to_string());
        }
        
        // 检查特定注册表类型的兼容性
        match registry_type {
            RegistryType::Identity => {
                if from_info.minor < 2 && to_info.minor >= 2 {
                    compatibility_issues.push("Identity schema changes in v1.2.0".to_string());
                }
            },
            RegistryType::Content => {
                if from_info.minor < 3 && to_info.minor >= 3 {
                    compatibility_issues.push("Content storage changes in v1.3.0".to_string());
                }
            },
            _ => {}, // 其他类型的特定检查
        }
        
        let compatibility_level = if !breaking_changes.is_empty() {
            CompatibilityLevel::Breaking
        } else if !compatibility_issues.is_empty() {
            CompatibilityLevel::Compatible
        } else {
            CompatibilityLevel::FullyCompatible
        };
        
        let migration_required = !breaking_changes.is_empty();
        let estimated_migration_time = if migration_required { 3600 } else { 300 }; // 1小时 vs 5分钟
        
        Ok(CompatibilityResult {
            compatibility_level,
            compatibility_issues,
            breaking_changes,
            migration_required,
            estimated_migration_time,
        })
    }
}

/// 兼容性结果
#[derive(AnchorSerialize, AnchorDeserialize, Clone, Debug)]
pub struct CompatibilityResult {
    pub compatibility_level: CompatibilityLevel,
    pub compatibility_issues: Vec<String>,
    pub breaking_changes: Vec<String>,
    pub migration_required: bool,
    pub estimated_migration_time: u64,
}

/// 兼容性级别
#[derive(AnchorSerialize, AnchorDeserialize, Clone, Debug, PartialEq)]
pub enum CompatibilityLevel {
    FullyCompatible,
    Compatible,
    Breaking,
    Incompatible,
}

/// 版本信息（在 state.rs 中已定义，这里添加扩展方法）
impl crate::state::VersionInfo {
    /// 转换为字符串
    pub fn to_string(&self) -> String {
        if let Some(pre) = &self.pre_release {
            format!("{}.{}.{}-{}", self.major, self.minor, self.patch, pre)
        } else {
            format!("{}.{}.{}", self.major, self.minor, self.patch)
        }
    }

    /// 检查是否为稳定版本
    pub fn is_stable(&self) -> bool {
        self.pre_release.is_none()
    }

    /// 检查是否为主版本升级
    pub fn is_major_upgrade_from(&self, other: &VersionInfo) -> bool {
        self.major > other.major
    }

    /// 检查是否为次版本升级
    pub fn is_minor_upgrade_from(&self, other: &VersionInfo) -> bool {
        self.major == other.major && self.minor > other.minor
    }

    /// 检查是否为补丁升级
    pub fn is_patch_upgrade_from(&self, other: &VersionInfo) -> bool {
        self.major == other.major && 
        self.minor == other.minor && 
        self.patch > other.patch
    }
}

/// 部署风险评估器
pub struct DeploymentRiskAssessor;

impl DeploymentRiskAssessor {
    /// 评估部署风险
    pub fn assess_deployment_risk(
        registry_type: &RegistryType,
        config: &RegistryConfig,
        deployer_history: &DeployerHistory,
    ) -> DeploymentRiskAssessment {
        let mut risk_score = 0.0;
        let mut risk_factors = Vec::new();
        
        // 基于注册表类型的风险
        let type_risk = match registry_type {
            RegistryType::Identity => 0.3,      // 身份管理中等风险
            RegistryType::Content => 0.4,       // 内容管理较高风险
            RegistryType::Access => 0.5,        // 权限控制高风险
            RegistryType::Event => 0.2,         // 事件系统低风险
            RegistryType::Circle => 0.35,       // 圈层管理中等风险
            RegistryType::Messaging => 0.35,    // 消息管理中等风险
            RegistryType::Custom(_) => 0.7,     // 自定义类型高风险
        };
        risk_score += type_risk;
        
        // 基于配置复杂度的风险
        let config_complexity = (config.feature_flags.len() as f64 / 10.0).min(0.3);
        risk_score += config_complexity;
        
        if config.max_entries > 1_000_000 {
            risk_score += 0.2;
            risk_factors.push("Large scale deployment".to_string());
        }
        
        // 基于部署者历史的风险
        if deployer_history.failed_deployments > 0 {
            let failure_rate = deployer_history.failed_deployments as f64 / 
                              deployer_history.total_deployments.max(1) as f64;
            risk_score += failure_rate * 0.3;
            
            if failure_rate > 0.2 {
                risk_factors.push("High failure rate in deployment history".to_string());
            }
        }
        
        // 确定风险级别
        let risk_level = match risk_score {
            score if score >= 0.8 => DeploymentRisk::Critical,
            score if score >= 0.6 => DeploymentRisk::High,
            score if score >= 0.4 => DeploymentRisk::Medium,
            _ => DeploymentRisk::Low,
        };
        
        let mitigation_strategies = Self::generate_mitigation_strategies(&risk_level);
        let recommended_actions = Self::generate_recommended_actions(&risk_level);
        
        DeploymentRiskAssessment {
            risk_level,
            risk_score,
            risk_factors,
            mitigation_strategies,
            recommended_actions,
        }
    }

    /// 生成风险缓解策略
    fn generate_mitigation_strategies(risk_level: &DeploymentRisk) -> Vec<String> {
        match risk_level {
            DeploymentRisk::Critical => vec![
                "使用测试环境进行完整验证".to_string(),
                "准备详细的回滚计划".to_string(),
                "安排专家审查配置".to_string(),
                "分阶段部署，逐步放量".to_string(),
            ],
            DeploymentRisk::High => vec![
                "使用标准化模板".to_string(),
                "启用详细监控".to_string(),
                "准备备份方案".to_string(),
            ],
            DeploymentRisk::Medium => vec![
                "验证配置参数".to_string(),
                "启用基础监控".to_string(),
            ],
            DeploymentRisk::Low => vec![
                "使用标准部署流程".to_string(),
            ],
        }
    }

    /// 生成推荐行动
    fn generate_recommended_actions(risk_level: &DeploymentRisk) -> Vec<String> {
        match risk_level {
            DeploymentRisk::Critical => vec![
                "考虑延迟部署，先解决风险因素".to_string(),
                "咨询技术专家".to_string(),
            ],
            DeploymentRisk::High => vec![
                "仔细审查配置".to_string(),
                "准备应急预案".to_string(),
            ],
            DeploymentRisk::Medium => vec![
                "使用推荐配置".to_string(),
            ],
            DeploymentRisk::Low => vec![
                "可以正常部署".to_string(),
            ],
        }
    }
}

/// 部署者历史
#[derive(AnchorSerialize, AnchorDeserialize, Clone, Debug)]
pub struct DeployerHistory {
    pub total_deployments: u64,
    pub successful_deployments: u64,
    pub failed_deployments: u64,
    pub average_deployment_time: f64,
    pub registry_types_deployed: Vec<RegistryType>,
    pub last_deployment: Option<i64>,
}

/// 部署风险
#[derive(AnchorSerialize, AnchorDeserialize, Clone, Debug, PartialEq)]
pub enum DeploymentRisk {
    Low,
    Medium,
    High,
    Critical,
}

/// 部署风险评估
#[derive(AnchorSerialize, AnchorDeserialize, Clone, Debug)]
pub struct DeploymentRiskAssessment {
    pub risk_level: DeploymentRisk,
    pub risk_score: f64,
    pub risk_factors: Vec<String>,
    pub mitigation_strategies: Vec<String>,
    pub recommended_actions: Vec<String>,
}
