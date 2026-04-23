use anchor_lang::prelude::*;
use crate::types::*;
use crate::errors::AlchemeError;

/// 注册表工厂主账户
#[derive(AnchorSerialize, AnchorDeserialize, Clone, Debug)]
pub struct RegistryFactory {
    pub bump: u8,
    pub admin: Pubkey,
    pub created_at: i64,
    pub last_updated: i64,
    pub total_deployments: u64,
    pub active_registries: u64,
    pub factory_config: FactoryConfig,
    pub deployment_templates: Vec<DeploymentTemplate>,
    pub version_manager: VersionManager,
}

/// 已部署的注册表账户
#[derive(AnchorSerialize, AnchorDeserialize, Clone, Debug)]
pub struct DeployedRegistry {
    pub registry_id: Pubkey,
    pub registry_type: RegistryType,
    pub deployer: Pubkey,
    pub deployed_at: i64,
    pub current_version: String,
    pub config: RegistryConfig,
    pub deployment_info: DeploymentInfo,
    pub status: RegistryStatus,
    pub upgrade_history: Vec<UpgradeRecord>,
    pub bump: u8,
}

/// 工厂配置
#[derive(AnchorSerialize, AnchorDeserialize, Clone, Debug)]
pub struct FactoryConfig {
    pub max_deployments_per_user: u32,
    pub deployment_fee: u64,
    pub upgrade_fee: u64,
    pub require_approval: bool,
    pub auto_upgrade_enabled: bool,
    pub supported_registry_types: Vec<RegistryType>,
}

/// 部署模板
#[derive(AnchorSerialize, AnchorDeserialize, Clone, Debug)]
pub struct DeploymentTemplate {
    pub template_id: String,
    pub template_name: String,
    pub description: String,
    pub registry_type: RegistryType,
    pub default_config: RegistryConfig,
    pub recommended_settings: Vec<KeyValue>,
    pub minimum_requirements: DeploymentRequirements,
    pub created_at: i64,
    pub created_by: Pubkey,
}

/// 部署要求
#[derive(AnchorSerialize, AnchorDeserialize, Clone, Debug)]
pub struct DeploymentRequirements {
    pub minimum_sol_balance: u64,
    pub required_permissions: Vec<Permission>,
    pub technical_requirements: Vec<String>,
    pub compliance_requirements: Vec<String>,
}

/// 版本管理器
#[derive(AnchorSerialize, AnchorDeserialize, Clone, Debug)]
pub struct VersionManager {
    pub current_protocol_version: String,
    pub supported_versions: Vec<SupportedVersion>,
    pub upgrade_paths: Vec<UpgradePath>,
    pub deprecation_schedule: Vec<DeprecationNotice>,
}

/// 支持的版本
#[derive(AnchorSerialize, AnchorDeserialize, Clone, Debug)]
pub struct SupportedVersion {
    pub version: String,
    pub release_date: i64,
    pub end_of_support: Option<i64>,
    pub features: Vec<String>,
    pub breaking_changes: Vec<String>,
    pub migration_guide_uri: Option<String>,
}

/// 升级路径
#[derive(AnchorSerialize, AnchorDeserialize, Clone, Debug)]
pub struct UpgradePath {
    pub from_version: String,
    pub to_version: String,
    pub upgrade_steps: Vec<UpgradeStep>,
    pub estimated_time: u64,
    pub risk_level: UpgradeRisk,
    pub rollback_supported: bool,
}

/// 升级步骤
#[derive(AnchorSerialize, AnchorDeserialize, Clone, Debug)]
pub struct UpgradeStep {
    pub step_id: String,
    pub description: String,
    pub step_type: UpgradeStepType,
    pub required_permissions: Vec<Permission>,
    pub estimated_time: u64,
    pub validation_script: Option<String>,
}

/// 升级步骤类型
#[derive(AnchorSerialize, AnchorDeserialize, Clone, Debug, PartialEq)]
pub enum UpgradeStepType {
    DataMigration,
    ConfigUpdate,
    ProgramUpgrade,
    PermissionUpdate,
    Verification,
    Cleanup,
}

/// 升级风险
#[derive(AnchorSerialize, AnchorDeserialize, Clone, Debug, PartialEq)]
pub enum UpgradeRisk {
    Low,
    Medium,
    High,
    Critical,
}

/// 弃用通知
#[derive(AnchorSerialize, AnchorDeserialize, Clone, Debug)]
pub struct DeprecationNotice {
    pub version: String,
    pub deprecation_date: i64,
    pub end_of_life: i64,
    pub reason: String,
    pub migration_path: String,
    pub impact_level: ImpactLevel,
}

/// 影响级别
#[derive(AnchorSerialize, AnchorDeserialize, Clone, Debug, PartialEq)]
pub enum ImpactLevel {
    Minor,
    Major,
    Breaking,
    Critical,
}

/// 注册表类型
#[derive(AnchorSerialize, AnchorDeserialize, Clone, Debug, PartialEq, Eq, Hash)]
pub enum RegistryType {
    // 核心依赖层
    Identity,
    Access,
    Event,
    
    // 业务服务层
    Content,
    Circle,
    Messaging,
    
    Custom(String),
}

/// 注册表配置
#[derive(AnchorSerialize, AnchorDeserialize, Clone, Debug)]
pub struct RegistryConfig {
    pub registry_name: String,
    pub max_entries: u64,
    pub registration_fee: u64,
    pub admin: Pubkey,
    pub moderators: Vec<Pubkey>,
    pub settings: Vec<KeyValue>,
    pub feature_flags: Vec<FeatureFlag>,
}

/// 功能标志
#[derive(AnchorSerialize, AnchorDeserialize, Clone, Debug)]
pub struct FeatureFlag {
    pub feature_name: String,
    pub enabled: bool,
    pub rollout_percentage: u8,
    pub target_users: Option<Vec<Pubkey>>,
}

/// 部署信息
#[derive(AnchorSerialize, AnchorDeserialize, Clone, Debug)]
pub struct DeploymentInfo {
    pub deployment_method: DeploymentMethod,
    pub template_used: Option<String>,
    pub deployment_cost: u64,
    pub estimated_users: u32,
    pub geographic_regions: Vec<String>,
    pub compliance_certifications: Vec<String>,
}

/// 部署方法
#[derive(AnchorSerialize, AnchorDeserialize, Clone, Debug, PartialEq)]
pub enum DeploymentMethod {
    Standard,                            // 标准部署
    Template,                            // 基于模板
    Clone,                               // 克隆现有注册表
    Migration,                           // 从其他系统迁移
    Custom,                              // 自定义部署
}

/// 注册表状态
#[derive(AnchorSerialize, AnchorDeserialize, Clone, Debug, PartialEq)]
pub enum RegistryStatus {
    Deploying,                           // 部署中
    Active,                              // 活跃
    Paused,                              // 暂停
    Upgrading,                           // 升级中
    Deprecated,                          // 已弃用
    Failed,                              // 部署失败
}

/// 升级记录
#[derive(AnchorSerialize, AnchorDeserialize, Clone, Debug)]
pub struct UpgradeRecord {
    pub upgrade_id: String,
    pub from_version: String,
    pub to_version: String,
    pub upgraded_at: i64,
    pub upgraded_by: Pubkey,
    pub upgrade_method: UpgradeMethod,
    pub success: bool,
    pub error_details: Option<String>,
}

/// 升级方法
#[derive(AnchorSerialize, AnchorDeserialize, Clone, Debug, PartialEq)]
pub enum UpgradeMethod {
    Automatic,                           // 自动升级
    Manual,                              // 手动升级
    Scheduled,                           // 计划升级
    Emergency,                           // 紧急升级
}

/// 部署请求
#[derive(AnchorSerialize, AnchorDeserialize, Clone, Debug)]
pub struct DeploymentRequest {
    pub request_id: String,
    pub registry_type: RegistryType,
    pub registry_name: String,
    pub deployer: Pubkey,
    pub config: RegistryConfig,
    pub template_id: Option<String>,
    pub requested_at: i64,
    pub approval_required: bool,
}

/// 部署结果
#[derive(AnchorSerialize, AnchorDeserialize, Clone, Debug)]
pub struct DeploymentResult {
    pub request_id: String,
    pub registry_id: Option<Pubkey>,
    pub success: bool,
    pub deployment_cost: u64,
    pub deployment_time: u64,
    pub error_details: Option<String>,
    pub next_steps: Vec<String>,
}

/// 部署统计
#[derive(AnchorSerialize, AnchorDeserialize, Clone, Debug)]
pub struct DeploymentStats {
    pub total_deployments: u64,
    pub successful_deployments: u64,
    pub failed_deployments: u64,
    pub deployments_by_type: Vec<TypeCount>,
    pub average_deployment_time: f64,
    pub total_users_served: u64,
}

/// 按类型计数
#[derive(AnchorSerialize, AnchorDeserialize, Clone, Debug)]
pub struct TypeCount {
    pub registry_type: RegistryType,
    pub count: u64,
    pub percentage: f64,
}

// ==================== 实现方法 ====================

impl RegistryFactory {
    pub const SPACE: usize = 
        8 +  // discriminator
        1 +  // bump
        32 + // admin
        8 +  // created_at
        8 +  // last_updated
        8 +  // total_deployments
        8 +  // active_registries
        FactoryConfig::SPACE +
        4 +  // deployment_templates (空 Vec)
        VersionManager::SPACE;

    /// 初始化注册表工厂
    pub fn initialize(
        &mut self,
        bump: u8,
        admin: Pubkey,
        factory_config: FactoryConfig,
    ) -> Result<()> {
        self.bump = bump;
        self.admin = admin;
        self.created_at = Clock::get()?.unix_timestamp;
        self.last_updated = self.created_at;
        self.total_deployments = 0;
        self.active_registries = 0;
        self.factory_config = factory_config;
        self.deployment_templates = Vec::new();
        self.version_manager = VersionManager::default();
        
        Ok(())
    }

    /// 部署注册表
    pub fn deploy_registry(&mut self, registry_type: RegistryType) -> Result<()> {
        self.total_deployments = self.total_deployments.saturating_add(1);
        self.active_registries = self.active_registries.saturating_add(1);
        self.last_updated = Clock::get()?.unix_timestamp;
        
        Ok(())
    }

    /// 停用注册表
    pub fn deactivate_registry(&mut self) -> Result<()> {
        self.active_registries = self.active_registries.saturating_sub(1);
        self.last_updated = Clock::get()?.unix_timestamp;
        
        Ok(())
    }

    /// 添加部署模板
    pub fn add_deployment_template(&mut self, template: DeploymentTemplate) -> Result<()> {
        // 检查模板是否已存在
        for existing_template in &self.deployment_templates {
            require!(
                existing_template.template_id != template.template_id,
                AlchemeError::InvalidOperation
            );
        }
        
        self.deployment_templates.push(template);
        self.last_updated = Clock::get()?.unix_timestamp;
        
        Ok(())
    }

    /// 验证部署权限
    pub fn validate_deployment_permission(
        &self,
        deployer: &Pubkey,
        registry_type: &RegistryType,
    ) -> Result<bool> {
        // 检查是否支持该注册表类型
        if !self.factory_config.supported_registry_types.contains(registry_type) {
            return Ok(false);
        }
        
        // 检查部署者权限（简化实现）
        // 在实际实现中，这里需要检查部署者的权限和配额
        Ok(true)
    }
}

impl DeployedRegistry {
    // CRITICAL: Use realistic initial size, not maximum theoretical size
    // This ensures we stay under the 10KB init limit
    // The account can be reallocated later if needed
    pub const SPACE: usize = 
        8 +  // discriminator
        32 + // registry_id
        1 +  // registry_type (enum discriminant)
        32 + // deployer
        8 +  // deployed_at
        4 + 16 + // current_version (String "1.0.0")
        // RegistryConfig - realistic initial values
        (4 + 64) + // registry_name
        8 +  // max_entries
        8 +  // registration_fee
        32 + // admin
        (4 + 2 * 32) + // moderators (2 initial)
        (4 + 5 * (4 + 32 + 4 + 64)) + // settings (5 initial KeyValues)
        (4 + 2 * (4 + 64 + 1 + 1 + 4 + 10 * 32 + 1)) + // feature_flags (2 initial)
        // DeploymentInfo - realistic initial values
        1 + // deployment_method
        (4 + 64 + 1) + // template_used (Option<String>)
        8 +  // deployment_cost
        4 +  // estimated_users
        (4 + 2 * (4 + 32)) + // geographic_regions (2 initial)
        (4 + 2 * (4 + 64)) + // compliance_certifications (2 initial)
        1 +  // status
        4 + // upgrade_history (empty Vec initially)
        1;   // bump


    /// 初始化已部署的注册表
    pub fn initialize(
        &mut self,
        registry_id: Pubkey,
        registry_type: RegistryType,
        deployer: Pubkey,
        config: RegistryConfig,
        deployment_info: DeploymentInfo,
        bump: u8,
    ) -> Result<()> {
        self.registry_id = registry_id;
        self.registry_type = registry_type;
        self.deployer = deployer;
        self.deployed_at = Clock::get()?.unix_timestamp;
        self.current_version = "1.0.0".to_string();
        self.config = config;
        self.deployment_info = deployment_info;
        self.status = RegistryStatus::Active; // Set to Active immediately
        self.upgrade_history = Vec::new();
        self.bump = bump;
        
        Ok(())
    }

    /// 升级注册表
    pub fn upgrade_registry(
        &mut self,
        new_version: String,
        upgraded_by: Pubkey,
        upgrade_method: UpgradeMethod,
    ) -> Result<()> {
        let upgrade_record = UpgradeRecord {
            upgrade_id: format!("upgrade_{}_{}", self.registry_id, Clock::get()?.unix_timestamp),
            from_version: self.current_version.clone(),
            to_version: new_version.clone(),
            upgraded_at: Clock::get()?.unix_timestamp,
            upgraded_by,
            upgrade_method,
            success: true,
            error_details: None,
        };
        
        self.upgrade_history.push(upgrade_record);
        self.current_version = new_version;
        self.status = RegistryStatus::Active;
        
        Ok(())
    }

    /// 更新状态
    pub fn update_status(&mut self, new_status: RegistryStatus) -> Result<()> {
        self.status = new_status;
        Ok(())
    }
}

// ==================== 空间计算实现 ====================

impl FactoryConfig {
    pub const SPACE: usize = 
        4 +  // max_deployments_per_user
        8 +  // deployment_fee
        8 +  // upgrade_fee
        1 +  // require_approval
        1 +  // auto_upgrade_enabled
        4 + 5 * 1; // supported_registry_types (最大5种)
}

impl DeploymentTemplate {
    pub const SPACE: usize = 
        4 + 64 + // template_id
        4 + 128 + // template_name
        4 + 256 + // description
        1 +  // registry_type
        RegistryConfig::SPACE +
        4 + 10 * KeyValue::SPACE + // recommended_settings
        DeploymentRequirements::SPACE +
        8 +  // created_at
        32;  // created_by
}

impl DeploymentRequirements {
    pub const SPACE: usize = 
        8 +  // minimum_sol_balance
        4 + 10 * 1 + // required_permissions
        4 + 5 * (4 + 64) + // technical_requirements
        4 + 5 * (4 + 64);  // compliance_requirements
}

impl VersionManager {
    pub const SPACE: usize = 
        4 + 16 + // current_protocol_version
        4 +      // supported_versions (空 Vec)
        4 +      // upgrade_paths (空 Vec)
        4;       // deprecation_schedule (空 Vec)
}

impl SupportedVersion {
    pub const SPACE: usize = 
        4 + 16 + // version
        8 +  // release_date
        9 +  // end_of_support (Option<i64>)
        4 + 10 * (4 + 32) + // features
        4 + 5 * (4 + 64) +  // breaking_changes
        4 + 256 + 1;        // migration_guide_uri (Option<String>)
}

impl UpgradePath {
    pub const SPACE: usize = 
        4 + 16 + // from_version
        4 + 16 + // to_version
        4 + 20 * UpgradeStep::SPACE + // upgrade_steps
        8 +  // estimated_time
        1 +  // risk_level
        1;   // rollback_supported
}

impl UpgradeStep {
    pub const SPACE: usize = 
        4 + 64 + // step_id
        4 + 256 + // description
        1 +  // step_type
        4 + 5 * 1 + // required_permissions
        8 +  // estimated_time
        4 + 256 + 1; // validation_script (Option<String>)
}

impl DeprecationNotice {
    pub const SPACE: usize = 
        4 + 16 + // version
        8 +  // deprecation_date
        8 +  // end_of_life
        4 + 256 + // reason
        4 + 128 + // migration_path
        1;   // impact_level
}

impl DeploymentInfo {
    pub const SPACE: usize = 
        1 +  // deployment_method
        4 + 64 + 1 + // template_used (Option<String>)
        8 +  // deployment_cost
        4 +  // estimated_users
        4 + 5 * (4 + 32) + // geographic_regions
        4 + 5 * (4 + 64);  // compliance_certifications
}

impl RegistryConfig {
    pub const SPACE: usize = 
        4 + 64 + // registry_name
        8 +  // max_entries
        8 +  // registration_fee
        32 + // admin
        4 + 10 * 32 + // moderators
        4 + 20 * KeyValue::SPACE + // settings
        4 + 10 * FeatureFlag::SPACE; // feature_flags
}

impl FeatureFlag {
    pub const SPACE: usize = 
        4 + 64 + // feature_name
        1 +  // enabled
        1 +  // rollout_percentage
        4 + 10 * 32 + 1; // target_users (Option<Vec<Pubkey>>)
}

impl UpgradeRecord {
    pub const SPACE: usize = 
        4 + 64 + // upgrade_id
        4 + 16 + // from_version
        4 + 16 + // to_version
        8 +  // upgraded_at
        32 + // upgraded_by
        1 +  // upgrade_method
        1 +  // success
        4 + 256 + 1; // error_details (Option<String>)
}

// ==================== 默认实现 ====================

impl Default for FactoryConfig {
    fn default() -> Self {
        Self {
            max_deployments_per_user: 10,
            deployment_fee: crate::constants::REGISTRY_DEPLOYMENT_FEE,
            upgrade_fee: crate::constants::REGISTRY_UPGRADE_FEE,
            require_approval: false,
            auto_upgrade_enabled: false,
            supported_registry_types: vec![
                // 核心依赖层
                RegistryType::Identity,
                RegistryType::Access,
                RegistryType::Event,
                
                // 业务服务层
                RegistryType::Content,
                RegistryType::Circle,
                RegistryType::Messaging,
            ],
        }
    }
}

impl Default for VersionManager {
    fn default() -> Self {
        Self {
            current_protocol_version: "1.0.0".to_string(),
            supported_versions: vec![],
            upgrade_paths: vec![],
            deprecation_schedule: vec![],
        }
    }
}

impl Default for DeploymentRequirements {
    fn default() -> Self {
        Self {
            minimum_sol_balance: 100_000_000, // 0.1 SOL
            required_permissions: vec![],
            technical_requirements: vec![
                "Solana RPC access".to_string(),
                "Anchor CLI installed".to_string(),
            ],
            compliance_requirements: vec![],
        }
    }
}
