use anchor_lang::prelude::*;
use alcheme_shared::*;

// 从 shared 模块重新导出所有核心类型（避免重复定义）
pub use alcheme_shared::factory::{
    RegistryFactory, DeployedRegistry, FactoryConfig, 
    DeploymentTemplate, DeploymentRequirements, VersionManager,
    SupportedVersion, UpgradePath, UpgradeStep, UpgradeStepType,
    UpgradeRisk, DeprecationNotice, ImpactLevel,
    RegistryType, RegistryConfig, RegistryStatus, FeatureFlag,
    DeploymentInfo, DeploymentMethod, UpgradeRecord, UpgradeMethod,
    DeploymentRequest, DeploymentResult, DeploymentStats, TypeCount,
};

// 导入常量
use alcheme_shared::constants::{
    IDENTITY_REGISTRATION_FEE, CONTENT_CREATION_FEE,
};

/// 工厂管理工具
pub struct FactoryManager;

impl FactoryManager {
    /// 计算部署成本
    pub fn calculate_deployment_cost(
        registry_type: &RegistryType,
        config: &RegistryConfig,
        base_fee: u64,
    ) -> u64 {
        let mut cost = base_fee;
        
        // 基于注册表类型调整成本
        let type_multiplier = match registry_type {
            RegistryType::Identity => 1.0,      // 基础成本
            RegistryType::Content => 1.5,       // 内容管理器更复杂
            RegistryType::Access => 1.2,        // 权限控制中等复杂
            RegistryType::Event => 1.3,         // 事件系统中等复杂
            RegistryType::Circle => 1.4,        // 圈层管理中等复杂
            RegistryType::Messaging => 1.6,     // 消息管理较高复杂
            RegistryType::Custom(_) => 2.0,     // 自定义类型最高成本
        };
        
        cost = (cost as f64 * type_multiplier) as u64;
        
        // 基于预期用户数调整成本
        if config.max_entries > 10000 {
            cost = cost.saturating_add(base_fee / 2); // 大规模部署额外成本
        }
        
        // 基于功能标志调整成本
        let feature_cost = config.feature_flags.len() as u64 * (base_fee / 100);
        cost = cost.saturating_add(feature_cost);
        
        cost
    }

    /// 估算部署时间
    pub fn estimate_deployment_time(
        registry_type: &RegistryType,
        config: &RegistryConfig,
    ) -> u64 {
        let base_time = match registry_type {
            RegistryType::Identity => 180,       // 3分钟
            RegistryType::Content => 300,        // 5分钟
            RegistryType::Access => 240,         // 4分钟
            RegistryType::Event => 200,          // 3分20秒
            RegistryType::Circle => 270,         // 4分30秒
            RegistryType::Messaging => 320,      // 5分20秒
            RegistryType::Custom(_) => 600,      // 10分钟
        };
        
        // 基于配置复杂度调整时间
        let complexity_factor = 1.0 + (config.feature_flags.len() as f64 * 0.1);
        
        (base_time as f64 * complexity_factor) as u64
    }

    /// 生成部署建议
    pub fn generate_deployment_recommendations(
        registry_type: &RegistryType,
        deployer_experience: DeployerExperience,
    ) -> Vec<DeploymentRecommendation> {
        let mut recommendations = Vec::new();
        
        match deployer_experience {
            DeployerExperience::Beginner => {
                recommendations.push(DeploymentRecommendation {
                    recommendation_type: RecommendationType::Template,
                    title: "使用预设模板".to_string(),
                    description: "建议使用标准模板进行部署，降低配置错误风险".to_string(),
                    priority: RecommendationPriority::High,
                });
                
                recommendations.push(DeploymentRecommendation {
                    recommendation_type: RecommendationType::Configuration,
                    title: "启用自动升级".to_string(),
                    description: "启用自动升级功能，确保注册表保持最新版本".to_string(),
                    priority: RecommendationPriority::Medium,
                });
            },
            DeployerExperience::Intermediate => {
                recommendations.push(DeploymentRecommendation {
                    recommendation_type: RecommendationType::Optimization,
                    title: "优化配置参数".to_string(),
                    description: "基于预期用户量优化注册表配置参数".to_string(),
                    priority: RecommendationPriority::Medium,
                });
            },
            DeployerExperience::Expert => {
                recommendations.push(DeploymentRecommendation {
                    recommendation_type: RecommendationType::CustomFeature,
                    title: "考虑自定义功能".to_string(),
                    description: "可以启用高级功能和自定义配置".to_string(),
                    priority: RecommendationPriority::Low,
                });
            },
        }
        
        // 基于注册表类型的特定建议
        match registry_type {
            RegistryType::Content => {
                recommendations.push(DeploymentRecommendation {
                    recommendation_type: RecommendationType::Integration,
                    title: "集成存储策略".to_string(),
                    description: "配置 Arweave 和 IPFS 存储策略以优化成本".to_string(),
                    priority: RecommendationPriority::High,
                });
            },
            RegistryType::Access => {
                recommendations.push(DeploymentRecommendation {
                    recommendation_type: RecommendationType::Security,
                    title: "配置审计日志".to_string(),
                    description: "启用详细的审计日志以满足合规要求".to_string(),
                    priority: RecommendationPriority::High,
                });
            },
            _ => {},
        }
        
        recommendations
    }

    /// 验证部署前置条件
    pub fn validate_deployment_prerequisites(
        deployer: &Pubkey,
        registry_type: &RegistryType,
        config: &RegistryConfig,
        factory_config: &FactoryConfig,
    ) -> Result<PrerequisiteCheckResult> {
        let mut checks = Vec::new();
        let mut all_passed = true;
        
        // 检查部署费用
        // 在实际实现中，这里需要检查部署者的 SOL 余额
        checks.push(PrerequisiteCheck {
            check_type: "deployment_fee".to_string(),
            passed: true, // 简化实现
            message: format!("部署费用: {} lamports", factory_config.deployment_fee),
        });
        
        // 检查注册表类型支持
        let type_supported = factory_config.supported_registry_types.contains(registry_type);
        if !type_supported {
            all_passed = false;
        }
        checks.push(PrerequisiteCheck {
            check_type: "registry_type_support".to_string(),
            passed: type_supported,
            message: if type_supported {
                "注册表类型受支持".to_string()
            } else {
                "注册表类型不受支持".to_string()
            },
        });
        
        // 检查配置有效性
        let config_valid = !config.registry_name.is_empty() && 
                          config.registry_name.len() <= 64 &&
                          config.max_entries > 0;
        if !config_valid {
            all_passed = false;
        }
        checks.push(PrerequisiteCheck {
            check_type: "config_validation".to_string(),
            passed: config_valid,
            message: if config_valid {
                "配置验证通过".to_string()
            } else {
                "配置验证失败".to_string()
            },
        });
        
        Ok(PrerequisiteCheckResult {
            all_checks_passed: all_passed,
            individual_checks: checks,
            estimated_deployment_time: FactoryManager::estimate_deployment_time(registry_type, config),
            estimated_cost: FactoryManager::calculate_deployment_cost(registry_type, config, factory_config.deployment_fee),
        })
    }
}

/// 部署者经验级别
#[derive(AnchorSerialize, AnchorDeserialize, Clone, Debug, PartialEq)]
pub enum DeployerExperience {
    Beginner,
    Intermediate,
    Expert,
}

/// 部署建议
#[derive(AnchorSerialize, AnchorDeserialize, Clone, Debug)]
pub struct DeploymentRecommendation {
    pub recommendation_type: RecommendationType,
    pub title: String,
    pub description: String,
    pub priority: RecommendationPriority,
}

/// 建议类型
#[derive(AnchorSerialize, AnchorDeserialize, Clone, Debug, PartialEq)]
pub enum RecommendationType {
    Template,
    Configuration,
    Optimization,
    Security,
    Integration,
    CustomFeature,
}

/// 建议优先级
#[derive(AnchorSerialize, AnchorDeserialize, Clone, Debug, PartialEq)]
pub enum RecommendationPriority {
    Low,
    Medium,
    High,
    Critical,
}

/// 前置条件检查结果
#[derive(AnchorSerialize, AnchorDeserialize, Clone, Debug)]
pub struct PrerequisiteCheckResult {
    pub all_checks_passed: bool,
    pub individual_checks: Vec<PrerequisiteCheck>,
    pub estimated_deployment_time: u64,
    pub estimated_cost: u64,
}

/// 前置条件检查
#[derive(AnchorSerialize, AnchorDeserialize, Clone, Debug)]
pub struct PrerequisiteCheck {
    pub check_type: String,
    pub passed: bool,
    pub message: String,
}

/// 版本管理工具
pub struct VersionManagerUtils;

impl VersionManagerUtils {
    /// 比较版本号
    pub fn compare_versions(version1: &str, version2: &str) -> VersionComparison {
        // 简化的版本比较实现
        match version1.cmp(version2) {
            std::cmp::Ordering::Less => VersionComparison::Older,
            std::cmp::Ordering::Equal => VersionComparison::Same,
            std::cmp::Ordering::Greater => VersionComparison::Newer,
        }
    }

    /// 解析版本号
    pub fn parse_version(version: &str) -> Result<VersionInfo> {
        // 简化的版本解析 (假设 semver 格式)
        let parts: Vec<&str> = version.split('.').collect();
        
        require!(parts.len() == 3, AlchemeError::InvalidOperation);
        
        let major: u32 = parts[0].parse().map_err(|_| AlchemeError::InvalidOperation)?;
        let minor: u32 = parts[1].parse().map_err(|_| AlchemeError::InvalidOperation)?;
        let patch: u32 = parts[2].parse().map_err(|_| AlchemeError::InvalidOperation)?;
        
        Ok(VersionInfo {
            major,
            minor,
            patch,
            pre_release: None,
            build_metadata: None,
        })
    }

    /// 验证升级路径
    pub fn validate_upgrade_path(
        from_version: &str,
        to_version: &str,
        available_paths: &[UpgradePath],
    ) -> Result<bool> {
        // 检查是否存在直接升级路径
        let direct_path = available_paths.iter()
            .any(|path| path.from_version == from_version && path.to_version == to_version);
        
        if direct_path {
            return Ok(true);
        }
        
        // 检查是否存在间接升级路径
        // 简化实现：仅检查直接路径
        Ok(false)
    }

    /// 生成升级计划
    pub fn generate_upgrade_plan(
        current_version: &str,
        target_version: &str,
        upgrade_paths: &[UpgradePath],
    ) -> Result<UpgradePlan> {
        // 查找升级路径
        let upgrade_path = upgrade_paths.iter()
            .find(|path| path.from_version == current_version && path.to_version == target_version)
            .ok_or(AlchemeError::InvalidOperation)?;
        
        Ok(UpgradePlan {
            from_version: current_version.to_string(),
            to_version: target_version.to_string(),
            upgrade_steps: upgrade_path.upgrade_steps.clone(),
            total_estimated_time: upgrade_path.estimated_time,
            risk_assessment: upgrade_path.risk_level.clone(),
            rollback_supported: upgrade_path.rollback_supported,
            prerequisites: Self::get_upgrade_prerequisites(upgrade_path),
        })
    }

    /// 获取升级前置条件
    fn get_upgrade_prerequisites(upgrade_path: &UpgradePath) -> Vec<String> {
        let mut prerequisites = vec![
            "备份当前配置".to_string(),
            "验证系统健康状态".to_string(),
        ];
        
        match upgrade_path.risk_level {
            UpgradeRisk::High | UpgradeRisk::Critical => {
                prerequisites.push("创建完整备份".to_string());
                prerequisites.push("准备回滚计划".to_string());
                prerequisites.push("通知相关用户".to_string());
            },
            UpgradeRisk::Medium => {
                prerequisites.push("测试升级流程".to_string());
            },
            UpgradeRisk::Low => {
                // 低风险升级无需额外前置条件
            },
        }
        
        prerequisites
    }
}

/// 版本比较结果
#[derive(AnchorSerialize, AnchorDeserialize, Clone, Debug, PartialEq)]
pub enum VersionComparison {
    Older,
    Same,
    Newer,
}

/// 版本信息
#[derive(AnchorSerialize, AnchorDeserialize, Clone, Debug)]
pub struct VersionInfo {
    pub major: u32,
    pub minor: u32,
    pub patch: u32,
    pub pre_release: Option<String>,
    pub build_metadata: Option<String>,
}

/// 升级计划
#[derive(AnchorSerialize, AnchorDeserialize, Clone, Debug)]
pub struct UpgradePlan {
    pub from_version: String,
    pub to_version: String,
    pub upgrade_steps: Vec<UpgradeStep>,
    pub total_estimated_time: u64,
    pub risk_assessment: UpgradeRisk,
    pub rollback_supported: bool,
    pub prerequisites: Vec<String>,
}

/// 部署监控器
pub struct DeploymentMonitor;

impl DeploymentMonitor {
    /// 记录部署开始
    pub fn log_deployment_start(
        registry_type: &RegistryType,
        deployer: &Pubkey,
        registry_name: &str,
    ) {
        msg!("DEPLOYMENT_START: type={:?}, deployer={}, name={}, timestamp={}", 
             registry_type, deployer, registry_name, Clock::get().unwrap().unix_timestamp);
    }

    /// 记录部署完成
    pub fn log_deployment_complete(
        registry_id: &Pubkey,
        deployment_time: u64,
        success: bool,
    ) {
        msg!("DEPLOYMENT_COMPLETE: registry_id={}, duration={}s, success={}, timestamp={}", 
             registry_id, deployment_time, success, Clock::get().unwrap().unix_timestamp);
    }

    /// 记录升级开始
    pub fn log_upgrade_start(
        registry_id: &Pubkey,
        from_version: &str,
        to_version: &str,
    ) {
        msg!("UPGRADE_START: registry_id={}, from={}, to={}, timestamp={}", 
             registry_id, from_version, to_version, Clock::get().unwrap().unix_timestamp);
    }

    /// 记录升级完成
    pub fn log_upgrade_complete(
        registry_id: &Pubkey,
        upgrade_time: u64,
        success: bool,
        error_details: Option<&str>,
    ) {
        let error_msg = error_details.unwrap_or("none");
        msg!("UPGRADE_COMPLETE: registry_id={}, duration={}s, success={}, error={}, timestamp={}", 
             registry_id, upgrade_time, success, error_msg, Clock::get().unwrap().unix_timestamp);
    }
}

/// 注册表健康检查器
pub struct RegistryHealthChecker;

impl RegistryHealthChecker {
    /// 执行健康检查
    pub fn perform_health_check(
        deployed_registry: &DeployedRegistry,
    ) -> HealthCheckResult {
        let mut checks = Vec::new();
        let mut overall_health = HealthStatus::Healthy;
        
        // 检查注册表状态
        let status_healthy = matches!(
            deployed_registry.status, 
            RegistryStatus::Active | RegistryStatus::Upgrading
        );
        
        if !status_healthy {
            overall_health = HealthStatus::Warning;
        }
        
        checks.push(HealthCheck {
            check_name: "registry_status".to_string(),
            status: if status_healthy { 
                HealthStatus::Healthy 
            } else { 
                HealthStatus::Warning 
            },
            message: format!("注册表状态: {:?}", deployed_registry.status),
            last_checked: Clock::get().unwrap().unix_timestamp,
        });
        
        // 检查版本是否过期
        let current_time = Clock::get().unwrap().unix_timestamp;
        let deployment_age_days = (current_time - deployed_registry.deployed_at) / (24 * 3600);
        
        let version_check = if deployment_age_days > 180 { // 6个月以上
            overall_health = HealthStatus::Warning;
            HealthStatus::Warning
        } else {
            HealthStatus::Healthy
        };
        
        checks.push(HealthCheck {
            check_name: "version_freshness".to_string(),
            status: version_check,
            message: format!("部署时间: {} 天前", deployment_age_days),
            last_checked: current_time,
        });
        
        // 检查配置有效性
        let config_valid = !deployed_registry.config.registry_name.is_empty() &&
                          deployed_registry.config.max_entries > 0;
        
        if !config_valid {
            overall_health = HealthStatus::Critical;
        }
        
        checks.push(HealthCheck {
            check_name: "config_validity".to_string(),
            status: if config_valid { 
                HealthStatus::Healthy 
            } else { 
                HealthStatus::Critical 
            },
            message: if config_valid {
                "配置有效".to_string()
            } else {
                "配置无效".to_string()
            },
            last_checked: current_time,
        });
        
        HealthCheckResult {
            overall_health,
            individual_checks: checks,
            checked_at: current_time,
            next_check_recommended: current_time + (24 * 3600), // 24小时后
        }
    }

    /// 生成健康报告
    pub fn generate_health_report(
        health_results: &[HealthCheckResult],
    ) -> HealthReport {
        let total_registries = health_results.len() as u64;
        
        let healthy_count = health_results.iter()
            .filter(|r| r.overall_health == HealthStatus::Healthy)
            .count() as u64;
        
        let warning_count = health_results.iter()
            .filter(|r| r.overall_health == HealthStatus::Warning)
            .count() as u64;
        
        let critical_count = health_results.iter()
            .filter(|r| r.overall_health == HealthStatus::Critical)
            .count() as u64;
        
        HealthReport {
            total_registries,
            healthy_registries: healthy_count,
            warning_registries: warning_count,
            critical_registries: critical_count,
            health_percentage: if total_registries > 0 {
                (healthy_count as f64 / total_registries as f64) * 100.0
            } else {
                0.0
            },
            report_generated_at: Clock::get().unwrap().unix_timestamp,
        }
    }
}

/// 健康检查结果
#[derive(AnchorSerialize, AnchorDeserialize, Clone, Debug)]
pub struct HealthCheckResult {
    pub overall_health: HealthStatus,
    pub individual_checks: Vec<HealthCheck>,
    pub checked_at: i64,
    pub next_check_recommended: i64,
}

/// 健康状态
#[derive(AnchorSerialize, AnchorDeserialize, Clone, Debug, PartialEq)]
pub enum HealthStatus {
    Healthy,
    Warning,
    Critical,
    Unknown,
}

/// 单项健康检查
#[derive(AnchorSerialize, AnchorDeserialize, Clone, Debug)]
pub struct HealthCheck {
    pub check_name: String,
    pub status: HealthStatus,
    pub message: String,
    pub last_checked: i64,
}

/// 健康报告
#[derive(AnchorSerialize, AnchorDeserialize, Clone, Debug)]
pub struct HealthReport {
    pub total_registries: u64,
    pub healthy_registries: u64,
    pub warning_registries: u64,
    pub critical_registries: u64,
    pub health_percentage: f64,
    pub report_generated_at: i64,
}

/// 部署分析器
pub struct DeploymentAnalyzer;

impl DeploymentAnalyzer {
    /// 分析部署趋势
    pub fn analyze_deployment_trends(
        deployments: &[DeployedRegistry],
        time_window: u64,
    ) -> DeploymentTrendAnalysis {
        let current_time = Clock::get().unwrap().unix_timestamp;
        let cutoff_time = current_time - time_window as i64;
        
        let recent_deployments: Vec<_> = deployments.iter()
            .filter(|d| d.deployed_at >= cutoff_time)
            .collect();
        
        let total_recent = recent_deployments.len() as u64;
        
        // 按类型统计
        let mut type_counts = std::collections::HashMap::new();
        for deployment in &recent_deployments {
            *type_counts.entry(deployment.registry_type.clone()).or_insert(0u64) += 1;
        }
        
        let deployments_by_type: Vec<TypeCount> = type_counts.into_iter()
            .map(|(registry_type, count)| TypeCount {
                registry_type,
                count,
                percentage: if total_recent > 0 {
                    (count as f64 / total_recent as f64) * 100.0
                } else {
                    0.0
                },
            })
            .collect();
        
        // 计算部署速度
        let deployment_rate = if time_window > 0 {
            (total_recent as f64 / time_window as f64) * (24 * 3600) as f64 // 每天部署数
        } else {
            0.0
        };
        
        let most_popular_type = deployments_by_type.iter()
            .max_by(|a, b| a.count.cmp(&b.count))
            .map(|t| t.registry_type.clone());
        
        DeploymentTrendAnalysis {
            analysis_period: time_window,
            total_deployments: total_recent,
            deployment_rate_per_day: deployment_rate,
            deployments_by_type,
            most_popular_type,
            growth_trend: Self::calculate_growth_trend(&recent_deployments),
        }
    }

    /// 计算增长趋势
    fn calculate_growth_trend(deployments: &[&DeployedRegistry]) -> GrowthTrend {
        if deployments.len() < 2 {
            return GrowthTrend::Stable;
        }
        
        // 简化的趋势计算：比较前半段和后半段的部署数量
        let mid_point = deployments.len() / 2;
        let first_half_count = mid_point;
        let second_half_count = deployments.len() - mid_point;
        
        if second_half_count > first_half_count * 2 {
            GrowthTrend::Accelerating
        } else if second_half_count > first_half_count {
            GrowthTrend::Growing
        } else if second_half_count < first_half_count {
            GrowthTrend::Declining
        } else {
            GrowthTrend::Stable
        }
    }
}

/// 部署趋势分析
#[derive(AnchorSerialize, AnchorDeserialize, Clone, Debug)]
pub struct DeploymentTrendAnalysis {
    pub analysis_period: u64,
    pub total_deployments: u64,
    pub deployment_rate_per_day: f64,
    pub deployments_by_type: Vec<TypeCount>,
    pub most_popular_type: Option<RegistryType>,
    pub growth_trend: GrowthTrend,
}

/// 增长趋势
#[derive(AnchorSerialize, AnchorDeserialize, Clone, Debug, PartialEq)]
pub enum GrowthTrend {
    Accelerating,
    Growing,
    Stable,
    Declining,
}

/// 配置模板生成器
pub struct ConfigTemplateGenerator;

impl ConfigTemplateGenerator {
    /// 生成标准配置模板
    pub fn generate_standard_template(registry_type: &RegistryType) -> DeploymentTemplate {
        let (template_name, description, default_config) = match registry_type {
            RegistryType::Identity => (
                "标准身份注册表".to_string(),
                "适用于大多数身份管理场景的标准配置".to_string(),
                RegistryConfig {
                    registry_name: "identity_registry".to_string(),
                    max_entries: 100000,
                    registration_fee: IDENTITY_REGISTRATION_FEE,
                    admin: Pubkey::default(),
                    moderators: vec![],
                    settings: vec![
                        KeyValue { key: "require_verification".to_string(), value: "false".to_string() },
                        KeyValue { key: "enable_social_features".to_string(), value: "true".to_string() },
                    ],
                    feature_flags: vec![
                        FeatureFlag {
                            feature_name: "reputation_system".to_string(),
                            enabled: true,
                            rollout_percentage: 100,
                            target_users: None,
                        },
                    ],
                },
            ),
            RegistryType::Content => (
                "标准内容管理器".to_string(),
                "支持多种内容类型的标准内容管理配置".to_string(),
                RegistryConfig {
                    registry_name: "content_manager".to_string(),
                    max_entries: 1000000,
                    registration_fee: CONTENT_CREATION_FEE,
                    admin: Pubkey::default(),
                    moderators: vec![],
                    settings: vec![
                        KeyValue { key: "auto_moderation".to_string(), value: "true".to_string() },
                        KeyValue { key: "max_content_size".to_string(), value: "10240".to_string() },
                    ],
                    feature_flags: vec![
                        FeatureFlag {
                            feature_name: "thread_support".to_string(),
                            enabled: true,
                            rollout_percentage: 100,
                            target_users: None,
                        },
                        FeatureFlag {
                            feature_name: "merkle_compression".to_string(),
                            enabled: false, // 预留给未来优化
                            rollout_percentage: 0,
                            target_users: None,
                        },
                    ],
                },
            ),
            RegistryType::Access => (
                "标准访问控制器".to_string(),
                "提供细粒度权限控制的标准配置".to_string(),
                RegistryConfig {
                    registry_name: "access_controller".to_string(),
                    max_entries: 500000,
                    registration_fee: 0, // 权限检查免费
                    admin: Pubkey::default(),
                    moderators: vec![],
                    settings: vec![
                        KeyValue { key: "audit_enabled".to_string(), value: "true".to_string() },
                        KeyValue { key: "batch_permissions".to_string(), value: "true".to_string() },
                    ],
                    feature_flags: vec![
                        FeatureFlag {
                            feature_name: "relationship_mapping".to_string(),
                            enabled: true,
                            rollout_percentage: 100,
                            target_users: None,
                        },
                    ],
                },
            ),
            RegistryType::Event => (
                "标准事件发射器".to_string(),
                "高性能事件处理的标准配置".to_string(),
                RegistryConfig {
                    registry_name: "event_emitter".to_string(),
                    max_entries: 10000000,
                    registration_fee: 0, // 事件发射免费
                    admin: Pubkey::default(),
                    moderators: vec![],
                    settings: vec![
                        KeyValue { key: "batch_size".to_string(), value: "50".to_string() },
                        KeyValue { key: "archive_enabled".to_string(), value: "true".to_string() },
                    ],
                    feature_flags: vec![
                        FeatureFlag {
                            feature_name: "event_compression".to_string(),
                            enabled: true,
                            rollout_percentage: 100,
                            target_users: None,
                        },
                    ],
                },
            ),
            RegistryType::Circle => (
                "标准圈层管理器".to_string(),
                "支持圈层治理和层级管理的标准配置".to_string(),
                RegistryConfig {
                    registry_name: "circle_manager".to_string(),
                    max_entries: 300000,
                    registration_fee: 5_000_000, // 0.005 SOL
                    admin: Pubkey::default(),
                    moderators: vec![],
                    settings: vec![
                        KeyValue { key: "max_hierarchy_depth".to_string(), value: "5".to_string() },
                        KeyValue { key: "enable_governance".to_string(), value: "true".to_string() },
                    ],
                    feature_flags: vec![
                        FeatureFlag {
                            feature_name: "hierarchical_permissions".to_string(),
                            enabled: true,
                            rollout_percentage: 100,
                            target_users: None,
                        },
                    ],
                },
            ),
            RegistryType::Messaging => (
                "标准消息管理器".to_string(),
                "支持私信和群组消息的标准配置".to_string(),
                RegistryConfig {
                    registry_name: "messaging_manager".to_string(),
                    max_entries: 5000000,
                    registration_fee: 2_000_000, // 0.002 SOL
                    admin: Pubkey::default(),
                    moderators: vec![],
                    settings: vec![
                        KeyValue { key: "max_message_size".to_string(), value: "4096".to_string() },
                        KeyValue { key: "enable_encryption".to_string(), value: "true".to_string() },
                    ],
                    feature_flags: vec![
                        FeatureFlag {
                            feature_name: "group_messaging".to_string(),
                            enabled: true,
                            rollout_percentage: 100,
                            target_users: None,
                        },
                        FeatureFlag {
                            feature_name: "message_compression".to_string(),
                            enabled: true,
                            rollout_percentage: 100,
                            target_users: None,
                        },
                    ],
                },
            ),
            RegistryType::Custom(name) => (
                format!("自定义注册表 - {}", name),
                "自定义配置的注册表模板".to_string(),
                RegistryConfig {
                    registry_name: format!("custom_{}", name),
                    max_entries: 50000,
                    registration_fee: 1000000, // 1 SOL
                    admin: Pubkey::default(),
                    moderators: vec![],
                    settings: vec![],
                    feature_flags: vec![],
                },
            ),
        };
        
        DeploymentTemplate {
            template_id: format!("standard_{:?}", registry_type).to_lowercase(),
            template_name,
            description,
            registry_type: registry_type.clone(),
            default_config,
            recommended_settings: vec![
                KeyValue { key: "monitoring_enabled".to_string(), value: "true".to_string() },
                KeyValue { key: "backup_enabled".to_string(), value: "true".to_string() },
            ],
            minimum_requirements: DeploymentRequirements::default(),
            created_at: Clock::get().unwrap().unix_timestamp,
            created_by: Pubkey::default(),
        }
    }
}

// ==================== Wrapper Accounts ====================
use std::ops::{Deref, DerefMut};

#[account]
pub struct RegistryFactoryAccount {
    pub inner: RegistryFactory,
}

impl Deref for RegistryFactoryAccount {
    type Target = RegistryFactory;
    fn deref(&self) -> &Self::Target {
        &self.inner
    }
}

impl DerefMut for RegistryFactoryAccount {
    fn deref_mut(&mut self) -> &mut Self::Target {
        &mut self.inner
    }
}

impl RegistryFactoryAccount {
    pub const SPACE: usize = RegistryFactory::SPACE;
    
    /// Calculate current account size using actual serialization
    pub fn get_size(&self) -> usize {
        match self.inner.try_to_vec() {
            Ok(data) => 8 + data.len(), // 8 bytes discriminator
            Err(_) => {
                // Fallback: use minimal conservative estimate
                8 + 
                1 + // bump
                32 + // admin
                8 + // created_at
                8 + // last_updated
                8 + // total_deployments
                8 + // active_registries
                200 + // FactoryConfig (simplified)
                (4 + self.inner.deployment_templates.len() * 600) + // ~600 bytes per template (realistic)
                100 // VersionManager (simplified)
            }
        }
    }
    
    /// Calculate size needed when adding a new template
    /// Uses realistic template size to stay well under Solana's 10KB realloc limit
    pub fn get_size_with_new_template(&self) -> usize {
        // Conservative realistic estimate: 600 bytes per template
        // This is much less than the theoretical max, ensuring we stay under 10KB
        const REALISTIC_TEMPLATE_SIZE: usize = 600;
        self.get_size() + REALISTIC_TEMPLATE_SIZE
    }
    
    /// Calculate size after deleting a template
    pub fn get_size_after_template_deletion(&self) -> usize {
        // Don't shrink on delete to avoid realloc complexity
        self.get_size()
    }
}

#[account]
pub struct DeployedRegistryAccount {
    pub inner: DeployedRegistry,
}

impl Deref for DeployedRegistryAccount {
    type Target = DeployedRegistry;
    fn deref(&self) -> &Self::Target {
        &self.inner
    }
}

impl DerefMut for DeployedRegistryAccount {
    fn deref_mut(&mut self) -> &mut Self::Target {
        &mut self.inner
    }
}

impl DeployedRegistryAccount {
    pub const SPACE: usize = DeployedRegistry::SPACE;
}

// ==================== Extension Registry Account ====================

/// 链上扩展注册表账户 — 存储已授权的 Extension Program 列表
/// PDA seeds: [b"extension_registry"]
#[account]
pub struct ExtensionRegistryAccount {
    pub inner: alcheme_cpi::ExtensionRegistry,
}

impl Deref for ExtensionRegistryAccount {
    type Target = alcheme_cpi::ExtensionRegistry;
    fn deref(&self) -> &Self::Target {
        &self.inner
    }
}

impl DerefMut for ExtensionRegistryAccount {
    fn deref_mut(&mut self) -> &mut Self::Target {
        &mut self.inner
    }
}

impl ExtensionRegistryAccount {
    pub const SPACE: usize = alcheme_cpi::ExtensionRegistry::SPACE;
}
