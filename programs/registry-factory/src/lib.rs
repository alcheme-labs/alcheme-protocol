use anchor_lang::prelude::*;
use alcheme_shared::AlchemeError;
use alcheme_shared::events::TimeRange;
use alcheme_shared::validation::ValidationResult;
use alcheme_shared::factory::*;

pub mod instructions;
pub mod state;
pub mod validation;

// Re-export for convenience
pub use instructions::*;
pub use state::*;
pub use validation::*;

// Program ID
declare_id!("AYrzTqFdxpiH3VhCBzLsJQtzFqjoSRKYUvk29d797AQC");

/// Registry Factory Program - 注册表工厂程序
#[program]
pub mod registry_factory {
    use super::*;

    // ==================== 工厂管理 ====================

    /// 初始化注册表工厂
    pub fn initialize_registry_factory(
        ctx: Context<InitializeRegistryFactory>,
        factory_config: FactoryConfig,
    ) -> Result<()> {
        instructions::initialize_registry_factory(ctx, factory_config)
    }

    /// 更新工厂配置
    pub fn update_factory_config(
        ctx: Context<UpdateFactoryConfig>,
        new_config: FactoryConfig,
    ) -> Result<()> {
        instructions::update_factory_config(ctx, new_config)
    }

    // ==================== 模板管理 ====================

    /// 创建部署模板
    pub fn create_deployment_template(
        ctx: Context<CreateDeploymentTemplate>,
        template: DeploymentTemplate,
    ) -> Result<()> {
        instructions::create_deployment_template(ctx, template)
    }

    /// 更新部署模板
    pub fn update_deployment_template(
        ctx: Context<UpdateDeploymentTemplate>,
        template_id: String,
        template: DeploymentTemplate,
    ) -> Result<()> {
        instructions::update_deployment_template(ctx, template_id, template)
    }

    /// 删除部署模板
    pub fn delete_deployment_template(
        ctx: Context<DeleteDeploymentTemplate>,
        template_id: String,
    ) -> Result<()> {
        instructions::delete_deployment_template(ctx, template_id)
    }

    // ==================== 注册表部署 ====================

    /// 部署身份注册表
    pub fn deploy_identity_registry(
        ctx: Context<DeployIdentityRegistry>,
        registry_name: String,
        config: RegistryConfig,
        template_id: Option<String>,
    ) -> Result<()> {
        instructions::deploy_identity_registry(ctx, registry_name, config, template_id)
    }

    /// 部署内容管理器
    pub fn deploy_content_manager(
        ctx: Context<DeployContentManager>,
        manager_name: String,
        config: RegistryConfig,
        template_id: Option<String>,
    ) -> Result<()> {
        instructions::deploy_content_manager(ctx, manager_name, config, template_id)
    }

    /// 部署访问控制器
    pub fn deploy_access_controller(
        ctx: Context<DeployAccessController>,
        controller_name: String,
        config: RegistryConfig,
        template_id: Option<String>,
    ) -> Result<()> {
        instructions::deploy_access_controller(ctx, controller_name, config, template_id)
    }

    /// 部署事件发射器
    pub fn deploy_event_emitter(
        ctx: Context<DeployEventEmitter>,
        emitter_name: String,
        config: RegistryConfig,
        template_id: Option<String>,
    ) -> Result<()> {
        instructions::deploy_event_emitter(ctx, emitter_name, config, template_id)
    }
    
    /// 部署圈层管理器
    pub fn deploy_circle_manager(
        ctx: Context<DeployCircleManager>,
        manager_name: String,
        config: RegistryConfig,
        template_id: Option<String>,
    ) -> Result<()> {
        instructions::deploy_circle_manager(ctx, manager_name, config, template_id)
    }
    
    /// 部署消息管理器
    pub fn deploy_messaging_manager(
        ctx: Context<DeployMessagingManager>,
        manager_name: String,
        config: RegistryConfig,
        template_id: Option<String>,
    ) -> Result<()> {
        instructions::deploy_messaging_manager(ctx, manager_name, config, template_id)
    }

    // ==================== 注册表管理 ====================

    /// 升级注册表
    pub fn upgrade_registry(
        ctx: Context<UpgradeRegistry>,
        registry_id: Pubkey,
        new_version: String,
        upgrade_data: Vec<u8>,
    ) -> Result<()> {
        instructions::upgrade_registry(ctx, registry_id, new_version, upgrade_data)
    }

    /// 暂停注册表
    pub fn pause_registry(
        ctx: Context<PauseRegistry>,
        registry_id: Pubkey,
        reason: String,
    ) -> Result<()> {
        instructions::pause_registry(ctx, registry_id, reason)
    }

    /// 恢复注册表
    pub fn resume_registry(
        ctx: Context<ResumeRegistry>,
        registry_id: Pubkey,
    ) -> Result<()> {
        instructions::resume_registry(ctx, registry_id)
    }

    /// 弃用注册表
    pub fn deprecate_registry(
        ctx: Context<DeprecateRegistry>,
        registry_id: Pubkey,
        deprecation_reason: String,
        migration_path: String,
    ) -> Result<()> {
        instructions::deprecate_registry(ctx, registry_id, deprecation_reason, migration_path)
    }

    // ==================== 查询接口 (CPI) ====================

    /// 获取注册表信息 (CPI)
    pub fn get_registry_info(
        ctx: Context<GetRegistryInfo>,
        registry_id: Pubkey,
    ) -> Result<DeployedRegistry> {
        instructions::get_registry_info(ctx, registry_id)
    }

    /// 验证注册表配置 (CPI)
    pub fn validate_registry_config(
        ctx: Context<ValidateRegistryConfig>,
        config: RegistryConfig,
        registry_type: RegistryType,
    ) -> Result<ValidationResult> {
        instructions::validate_registry_config(ctx, config, registry_type)
    }

    /// 列出已部署的注册表 (CPI)
    pub fn list_deployed_registries(
        ctx: Context<ListDeployedRegistries>,
        deployer: Option<Pubkey>,
        registry_type: Option<RegistryType>,
        status_filter: Option<RegistryStatus>,
    ) -> Result<Vec<DeployedRegistry>> {
        instructions::list_deployed_registries(ctx, deployer, registry_type, status_filter)
    }

    // ==================== 统计和监控 ====================

    /// 获取部署统计
    pub fn get_deployment_stats(
        ctx: Context<GetDeploymentStats>,
        time_range: Option<TimeRange>,
    ) -> Result<DeploymentStats> {
        instructions::get_deployment_stats(ctx, time_range)
    }

    /// 获取版本信息
    pub fn get_version_info(
        ctx: Context<GetVersionInfo>,
    ) -> Result<VersionManager> {
        instructions::get_version_info(ctx)
    }

    /// 检查升级可用性
    pub fn check_upgrade_availability(
        ctx: Context<CheckUpgradeAvailability>,
        registry_id: Pubkey,
        current_version: String,
    ) -> Result<Vec<UpgradePath>> {
        instructions::check_upgrade_availability(ctx, registry_id, current_version)
    }

    // ==================== Extension Registry 管理 ====================

    /// 初始化扩展注册表
    pub fn initialize_extension_registry(
        ctx: Context<InitializeExtensionRegistry>,
        max_extensions: u8,
    ) -> Result<()> {
        instructions::initialize_extension_registry(ctx, max_extensions)
    }

    /// 注册扩展程序
    pub fn register_extension(
        ctx: Context<RegisterExtension>,
        program_id: Pubkey,
        permissions: Vec<alcheme_cpi::CpiPermission>,
    ) -> Result<()> {
        instructions::register_extension(ctx, program_id, permissions)
    }

    /// 移除扩展程序
    pub fn remove_extension(
        ctx: Context<RemoveExtension>,
        program_id: Pubkey,
    ) -> Result<()> {
        instructions::remove_extension(ctx, program_id)
    }

    /// 更新扩展程序权限
    pub fn update_extension_permissions(
        ctx: Context<UpdateExtensionPermissions>,
        program_id: Pubkey,
        new_permissions: Vec<alcheme_cpi::CpiPermission>,
    ) -> Result<()> {
        instructions::update_extension_permissions(ctx, program_id, new_permissions)
    }
}
