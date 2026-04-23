use anchor_lang::prelude::*;
use alcheme_shared::*;
use alcheme_cpi::{require_cpi_permission, is_authorized_for_cpi, CpiPermission};
use crate::state::*;
use crate::validation::*;

// 明确使用 factory 模块的类型，避免冲突
use alcheme_shared::factory::{RegistryType, RegistryConfig, RegistryStatus};

// ==================== 工厂管理指令 ====================

/// 初始化注册表工厂
#[derive(Accounts)]
pub struct InitializeRegistryFactory<'info> {
    #[account(
        init,
        payer = admin,
        space = RegistryFactoryAccount::SPACE,
        seeds = [REGISTRY_FACTORY_SEED],
        bump
    )]
    pub registry_factory: Account<'info, RegistryFactoryAccount>,
    
    #[account(mut)]
    pub admin: Signer<'info>,
    
    pub system_program: Program<'info, System>,
}

pub fn initialize_registry_factory(
    ctx: Context<InitializeRegistryFactory>,
    factory_config: FactoryConfig,
) -> Result<()> {
    let registry_factory = &mut ctx.accounts.registry_factory;
    let bump = ctx.bumps.registry_factory;
    
    registry_factory.initialize(bump, ctx.accounts.admin.key(), factory_config)?;
    
    msg!("注册表工厂初始化成功");
    Ok(())
}

/// 更新工厂配置
#[derive(Accounts)]
pub struct UpdateFactoryConfig<'info> {
    #[account(
        mut,
        constraint = admin.key() == registry_factory.inner.admin @ AlchemeError::Unauthorized
    )]
    pub registry_factory: Account<'info, RegistryFactoryAccount>,
    
    pub admin: Signer<'info>,
}

pub fn update_factory_config(
    ctx: Context<UpdateFactoryConfig>,
    new_config: FactoryConfig,
) -> Result<()> {
    let registry_factory = &mut ctx.accounts.registry_factory;
    
    // 验证新配置
    FactoryValidator::validate_factory_config(&new_config)?;
    
    registry_factory.factory_config = new_config;
    registry_factory.last_updated = Clock::get()?.unix_timestamp;
    
    msg!("工厂配置更新成功");
    Ok(())
}

// ==================== 模板管理指令 ====================

/// 创建部署模板
#[derive(Accounts)]
pub struct CreateDeploymentTemplate<'info> {
    #[account(
        mut,
        constraint = admin.key() == registry_factory.inner.admin @ AlchemeError::Unauthorized,
        realloc = registry_factory.get_size_with_new_template(),
        realloc::payer = admin,
        realloc::zero = false
    )]
    pub registry_factory: Account<'info, RegistryFactoryAccount>,
    
    #[account(mut)]
    pub admin: Signer<'info>,
    
    pub system_program: Program<'info, System>,
}

pub fn create_deployment_template(
    ctx: Context<CreateDeploymentTemplate>,
    template: DeploymentTemplate,
) -> Result<()> {
    let registry_factory = &mut ctx.accounts.registry_factory;
    
    // 验证模板
    FactoryValidator::validate_deployment_template(&template)?;
    
    // 添加模板
    registry_factory.add_deployment_template(template.clone())?;
    
    msg!("部署模板创建成功: {}", template.template_id);
    Ok(())
}

/// 更新部署模板
#[derive(Accounts)]
pub struct UpdateDeploymentTemplate<'info> {
    #[account(
        mut,
        constraint = admin.key() == registry_factory.inner.admin @ AlchemeError::Unauthorized
    )]
    pub registry_factory: Account<'info, RegistryFactoryAccount>,
    
    pub admin: Signer<'info>,
}

pub fn update_deployment_template(
    ctx: Context<UpdateDeploymentTemplate>,
    template_id: String,
    template: DeploymentTemplate,
) -> Result<()> {
    let registry_factory = &mut ctx.accounts.registry_factory;
    
    // 查找并更新模板
    let mut found = false;
    for existing_template in &mut registry_factory.deployment_templates {
        if existing_template.template_id == template_id {
            *existing_template = template;
            found = true;
            break;
        }
    }
    
    require!(found, AlchemeError::InvalidOperation);
    
    registry_factory.last_updated = Clock::get()?.unix_timestamp;
    
    msg!("部署模板更新成功: {}", template_id);
    Ok(())
}

/// 删除部署模板
#[derive(Accounts)]
pub struct DeleteDeploymentTemplate<'info> {
    #[account(
        mut,
        constraint = admin.key() == registry_factory.inner.admin @ AlchemeError::Unauthorized,
        realloc = registry_factory.get_size_after_template_deletion(),
        realloc::payer = admin,
        realloc::zero = false
    )]
    pub registry_factory: Account<'info, RegistryFactoryAccount>,
    
    #[account(mut)]
    pub admin: Signer<'info>,
    
    pub system_program: Program<'info, System>,
}

pub fn delete_deployment_template(
    ctx: Context<DeleteDeploymentTemplate>,
    template_id: String,
) -> Result<()> {
    let registry_factory = &mut ctx.accounts.registry_factory;
    
    // 删除模板
    let initial_len = registry_factory.deployment_templates.len();
    registry_factory.deployment_templates.retain(|t| t.template_id != template_id);
    
    require!(
        registry_factory.deployment_templates.len() < initial_len,
        AlchemeError::InvalidOperation
    );
    
    registry_factory.last_updated = Clock::get()?.unix_timestamp;
    
    msg!("部署模板删除成功: {}", template_id);
    Ok(())
}

// ==================== 注册表部署指令 ====================

/// 部署身份注册表
#[derive(Accounts)]
#[instruction(registry_name: String)]
pub struct DeployIdentityRegistry<'info> {
    #[account(mut)]
    pub registry_factory: Account<'info, RegistryFactoryAccount>,
    
    #[account(
        init,
        payer = deployer,
        space = DeployedRegistryAccount::SPACE,
        seeds = [DEPLOYED_REGISTRY_SEED, registry_name.as_bytes()],
        bump
    )]
    pub deployed_registry: Account<'info, DeployedRegistryAccount>,
    
    #[account(mut)]
    pub deployer: Signer<'info>,
    
    /// CHECK: Identity Registry 程序，用于实际部署
    pub identity_program: AccountInfo<'info>,
    
    /// CHECK: Event Emitter 程序，用于发射部署事件
    pub event_program: AccountInfo<'info>,
    
    pub system_program: Program<'info, System>,
}

pub fn deploy_identity_registry(
    ctx: Context<DeployIdentityRegistry>,
    registry_name: String,
    config: RegistryConfig,
    template_id: Option<String>,
) -> Result<()> {
    let registry_factory = &mut ctx.accounts.registry_factory;
    let deployer = ctx.accounts.deployer.key();
    
    // 验证部署权限
    require!(
        registry_factory.validate_deployment_permission(&deployer, &RegistryType::Identity)?,
        AlchemeError::Unauthorized
    );
    
    // 验证配置
    FactoryValidator::validate_registry_config(&config, &RegistryType::Identity)?;
    
    // 计算部署成本
    let deployment_cost = registry_factory.factory_config.deployment_fee;
    
    // 创建部署信息
    let deployment_info = DeploymentInfo {
        deployment_method: if template_id.is_some() { 
            DeploymentMethod::Template 
        } else { 
            DeploymentMethod::Standard 
        },
        template_used: template_id,
        deployment_cost,
        estimated_users: 1000, // 默认估算
        geographic_regions: vec!["global".to_string()],
        compliance_certifications: vec![],
    };
    
    // 初始化已部署注册表记录
    let deployed_registry = &mut ctx.accounts.deployed_registry;
    let deployed_registry_bump = ctx.bumps.deployed_registry;
    
    deployed_registry.initialize(
        ctx.accounts.identity_program.key(),
        RegistryType::Identity,
        deployer,
        config,
        deployment_info,
        deployed_registry_bump,
    )?;
    
    // 更新工厂统计
    registry_factory.deploy_registry(RegistryType::Identity)?;
    
    // 发射部署事件 (通过 CPI 调用 Event Emitter)
    // 简化实现：在实际项目中会调用 event_emitter::cpi::emit_event
    
    msg!("身份注册表部署成功: {} by {}", registry_name, deployer);
    Ok(())
}

/// 部署内容管理器
#[derive(Accounts)]
#[instruction(manager_name: String)]
pub struct DeployContentManager<'info> {
    #[account(mut)]
    pub registry_factory: Account<'info, RegistryFactoryAccount>,
    
    #[account(
        init,
        payer = deployer,
        space = DeployedRegistryAccount::SPACE,
        seeds = [DEPLOYED_REGISTRY_SEED, manager_name.as_bytes()],
        bump
    )]
    pub deployed_registry: Account<'info, DeployedRegistryAccount>,
    
    #[account(mut)]
    pub deployer: Signer<'info>,
    
    /// CHECK: Content Manager 程序
    pub content_program: AccountInfo<'info>,
    
    pub system_program: Program<'info, System>,
}

pub fn deploy_content_manager(
    ctx: Context<DeployContentManager>,
    manager_name: String,
    config: RegistryConfig,
    template_id: Option<String>,
) -> Result<()> {
    let registry_factory = &mut ctx.accounts.registry_factory;
    let deployer = ctx.accounts.deployer.key();
    
    // 验证部署权限
    require!(
        registry_factory.validate_deployment_permission(&deployer, &RegistryType::Content)?,
        AlchemeError::Unauthorized
    );
    
    // 验证配置
    FactoryValidator::validate_registry_config(&config, &RegistryType::Content)?;
    
    // 创建部署信息
    let deployment_info = DeploymentInfo {
        deployment_method: if template_id.is_some() { 
            DeploymentMethod::Template 
        } else { 
            DeploymentMethod::Standard 
        },
        template_used: template_id,
        deployment_cost: registry_factory.factory_config.deployment_fee,
        estimated_users: 5000, // 内容管理器估算更多用户
        geographic_regions: vec!["global".to_string()],
        compliance_certifications: vec!["content_policy".to_string()],
    };
    
    // 初始化已部署注册表记录
    let deployed_registry = &mut ctx.accounts.deployed_registry;
    let deployed_registry_bump = ctx.bumps.deployed_registry;
    
    deployed_registry.initialize(
        ctx.accounts.content_program.key(),
        RegistryType::Content,
        deployer,
        config,
        deployment_info,
        deployed_registry_bump,
    )?;
    
    // 更新工厂统计
    registry_factory.deploy_registry(RegistryType::Content)?;
    
    msg!("内容管理器部署成功: {} by {}", manager_name, deployer);
    Ok(())
}

/// 部署访问控制器
#[derive(Accounts)]
#[instruction(controller_name: String)]
pub struct DeployAccessController<'info> {
    #[account(mut)]
    pub registry_factory: Account<'info, RegistryFactoryAccount>,
    
    #[account(
        init,
        payer = deployer,
        space = DeployedRegistryAccount::SPACE,
        seeds = [DEPLOYED_REGISTRY_SEED, controller_name.as_bytes()],
        bump
    )]
    pub deployed_registry: Account<'info, DeployedRegistryAccount>,
    
    #[account(mut)]
    pub deployer: Signer<'info>,
    
    /// CHECK: Access Controller 程序
    pub access_program: AccountInfo<'info>,
    
    pub system_program: Program<'info, System>,
}

pub fn deploy_access_controller(
    ctx: Context<DeployAccessController>,
    controller_name: String,
    config: RegistryConfig,
    template_id: Option<String>,
) -> Result<()> {
    let registry_factory = &mut ctx.accounts.registry_factory;
    let deployer = ctx.accounts.deployer.key();
    
    // 验证部署权限
    require!(
        registry_factory.validate_deployment_permission(&deployer, &RegistryType::Access)?,
        AlchemeError::Unauthorized
    );
    
    // 验证配置
    FactoryValidator::validate_registry_config(&config, &RegistryType::Access)?;
    
    // 创建部署信息
    let deployment_info = DeploymentInfo {
        deployment_method: if template_id.is_some() { 
            DeploymentMethod::Template 
        } else { 
            DeploymentMethod::Standard 
        },
        template_used: template_id,
        deployment_cost: registry_factory.factory_config.deployment_fee,
        estimated_users: 2000,
        geographic_regions: vec!["global".to_string()],
        compliance_certifications: vec!["access_control_policy".to_string()],
    };
    
    // 初始化已部署注册表记录
    let deployed_registry = &mut ctx.accounts.deployed_registry;
    let deployed_registry_bump = ctx.bumps.deployed_registry;
    
    deployed_registry.initialize(
        ctx.accounts.access_program.key(),
        RegistryType::Access,
        deployer,
        config,
        deployment_info,
        deployed_registry_bump,
    )?;
    
    // 更新工厂统计
    registry_factory.deploy_registry(RegistryType::Access)?;
    
    msg!("访问控制器部署成功: {} by {}", controller_name, deployer);
    Ok(())
}

/// 部署事件发射器
#[derive(Accounts)]
#[instruction(emitter_name: String)]
pub struct DeployEventEmitter<'info> {
    #[account(mut)]
    pub registry_factory: Account<'info, RegistryFactoryAccount>,
    
    #[account(
        init,
        payer = deployer,
        space = DeployedRegistryAccount::SPACE,
        seeds = [DEPLOYED_REGISTRY_SEED, emitter_name.as_bytes()],
        bump
    )]
    pub deployed_registry: Account<'info, DeployedRegistryAccount>,
    
    #[account(mut)]
    pub deployer: Signer<'info>,
    
    /// CHECK: Event Emitter 程序
    pub event_program: AccountInfo<'info>,
    
    pub system_program: Program<'info, System>,
}

pub fn deploy_event_emitter(
    ctx: Context<DeployEventEmitter>,
    emitter_name: String,
    config: RegistryConfig,
    template_id: Option<String>,
) -> Result<()> {
    let registry_factory = &mut ctx.accounts.registry_factory;
    let deployer = ctx.accounts.deployer.key();
    
    // 验证部署权限
    require!(
        registry_factory.validate_deployment_permission(&deployer, &RegistryType::Event)?,
        AlchemeError::Unauthorized
    );
    
    // 验证配置
    FactoryValidator::validate_registry_config(&config, &RegistryType::Event)?;
    
    // 创建部署信息
    let deployment_info = DeploymentInfo {
        deployment_method: if template_id.is_some() { 
            DeploymentMethod::Template 
        } else { 
            DeploymentMethod::Standard 
        },
        template_used: template_id,
        deployment_cost: registry_factory.factory_config.deployment_fee,
        estimated_users: 10000, // 事件系统估算最多用户
        geographic_regions: vec!["global".to_string()],
        compliance_certifications: vec!["event_processing_policy".to_string()],
    };
    
    // 初始化已部署注册表记录
    let deployed_registry = &mut ctx.accounts.deployed_registry;
    let deployed_registry_bump = ctx.bumps.deployed_registry;
    
    deployed_registry.initialize(
        ctx.accounts.event_program.key(),
        RegistryType::Event,
        deployer,
        config,
        deployment_info,
        deployed_registry_bump,
    )?;
    
    // 更新工厂统计
    registry_factory.deploy_registry(RegistryType::Event)?;
    
    msg!("事件发射器部署成功: {} by {}", emitter_name, deployer);
    Ok(())
}

/// 部署圈层管理器
#[derive(Accounts)]
#[instruction(manager_name: String)]
pub struct DeployCircleManager<'info> {
    #[account(mut)]
    pub registry_factory: Account<'info, RegistryFactoryAccount>,
    
    #[account(
        init,
        payer = deployer,
        space = DeployedRegistryAccount::SPACE,
        seeds = [DEPLOYED_REGISTRY_SEED, manager_name.as_bytes()],
        bump
    )]
    pub deployed_registry: Account<'info, DeployedRegistryAccount>,
    
    #[account(mut)]
    pub deployer: Signer<'info>,
    
    /// CHECK: Circle Manager 程序
    pub circle_program: AccountInfo<'info>,
    
    pub system_program: Program<'info, System>,
}

pub fn deploy_circle_manager(
    ctx: Context<DeployCircleManager>,
    manager_name: String,
    config: RegistryConfig,
    template_id: Option<String>,
) -> Result<()> {
    let registry_factory = &mut ctx.accounts.registry_factory;
    let deployer = ctx.accounts.deployer.key();
    
    // 验证部署权限
    require!(
        registry_factory.validate_deployment_permission(&deployer, &RegistryType::Circle)?,
        AlchemeError::Unauthorized
    );
    
    // 验证配置
    FactoryValidator::validate_registry_config(&config, &RegistryType::Circle)?;
    
    // 创建部署信息
    let deployment_info = DeploymentInfo {
        deployment_method: if template_id.is_some() { 
            DeploymentMethod::Template 
        } else { 
            DeploymentMethod::Standard 
        },
        template_used: template_id,
        deployment_cost: registry_factory.factory_config.deployment_fee,
        estimated_users: 3000, // 圈层管理器估算用户数
        geographic_regions: vec!["global".to_string()],
        compliance_certifications: vec!["governance_policy".to_string()],
    };
    
    // 初始化已部署注册表记录
    let deployed_registry = &mut ctx.accounts.deployed_registry;
    let deployed_registry_bump = ctx.bumps.deployed_registry;
    
    deployed_registry.initialize(
        ctx.accounts.circle_program.key(),
        RegistryType::Circle,
        deployer,
        config,
        deployment_info,
        deployed_registry_bump,
    )?;
    
    // 更新工厂统计
    registry_factory.deploy_registry(RegistryType::Circle)?;
    
    msg!("圈层管理器部署成功: {} by {}", manager_name, deployer);
    Ok(())
}

/// 部署消息管理器
#[derive(Accounts)]
#[instruction(manager_name: String)]
pub struct DeployMessagingManager<'info> {
    #[account(mut)]
    pub registry_factory: Account<'info, RegistryFactoryAccount>,
    
    #[account(
        init,
        payer = deployer,
        space = DeployedRegistryAccount::SPACE,
        seeds = [DEPLOYED_REGISTRY_SEED, manager_name.as_bytes()],
        bump
    )]
    pub deployed_registry: Account<'info, DeployedRegistryAccount>,
    
    #[account(mut)]
    pub deployer: Signer<'info>,
    
    /// CHECK: Messaging Manager 程序
    pub messaging_program: AccountInfo<'info>,
    
    pub system_program: Program<'info, System>,
}

pub fn deploy_messaging_manager(
    ctx: Context<DeployMessagingManager>,
    manager_name: String,
    config: RegistryConfig,
    template_id: Option<String>,
) -> Result<()> {
    let registry_factory = &mut ctx.accounts.registry_factory;
    let deployer = ctx.accounts.deployer.key();
    
    // 验证部署权限
    require!(
        registry_factory.validate_deployment_permission(&deployer, &RegistryType::Messaging)?,
        AlchemeError::Unauthorized
    );
    
    // 验证配置
    FactoryValidator::validate_registry_config(&config, &RegistryType::Messaging)?;
    
    // 创建部署信息
    let deployment_info = DeploymentInfo {
        deployment_method: if template_id.is_some() { 
            DeploymentMethod::Template 
        } else { 
            DeploymentMethod::Standard 
        },
        template_used: template_id,
        deployment_cost: registry_factory.factory_config.deployment_fee,
        estimated_users: 8000, // 消息管理器估算较多用户
        geographic_regions: vec!["global".to_string()],
        compliance_certifications: vec!["messaging_policy".to_string()],
    };
    
    // 初始化已部署注册表记录
    let deployed_registry = &mut ctx.accounts.deployed_registry;
    let deployed_registry_bump = ctx.bumps.deployed_registry;
    
    deployed_registry.initialize(
        ctx.accounts.messaging_program.key(),
        RegistryType::Messaging,
        deployer,
        config,
        deployment_info,
        deployed_registry_bump,
    )?;
    
    // 更新工厂统计
    registry_factory.deploy_registry(RegistryType::Messaging)?;
    
    msg!("消息管理器部署成功: {} by {}", manager_name, deployer);
    Ok(())
}

// ==================== 注册表管理指令 ====================

/// 升级注册表
#[derive(Accounts)]
pub struct UpgradeRegistry<'info> {
    #[account(mut)]
    pub registry_factory: Account<'info, RegistryFactoryAccount>,
    
    #[account(
        mut,
        constraint = deployer.key() == deployed_registry.deployer @ AlchemeError::Unauthorized
    )]
    pub deployed_registry: Account<'info, DeployedRegistryAccount>,
    
    pub deployer: Signer<'info>,
}

pub fn upgrade_registry(
    ctx: Context<UpgradeRegistry>,
    registry_id: Pubkey,
    new_version: String,
    upgrade_data: Vec<u8>,
) -> Result<()> {
    let deployed_registry = &mut ctx.accounts.deployed_registry;
    
    // 验证注册表ID
    require!(
        deployed_registry.registry_id == registry_id,
        AlchemeError::InvalidOperation
    );
    
    // 验证升级版本
    FactoryValidator::validate_version_upgrade(
        &deployed_registry.current_version,
        &new_version,
    )?;
    
    // 执行升级
    deployed_registry.upgrade_registry(
        new_version.clone(),
        ctx.accounts.deployer.key(),
        UpgradeMethod::Manual,
    )?;
    
    msg!("注册表升级成功: {} -> {}", registry_id, new_version);
    Ok(())
}

/// 暂停注册表
#[derive(Accounts)]
pub struct PauseRegistry<'info> {
    #[account(
        mut,
        constraint = deployer.key() == deployed_registry.deployer || 
                    deployer.key() == registry_factory.admin @ AlchemeError::Unauthorized
    )]
    pub deployed_registry: Account<'info, DeployedRegistryAccount>,
    
    pub registry_factory: Account<'info, RegistryFactoryAccount>,
    
    pub deployer: Signer<'info>,
}

pub fn pause_registry(
    ctx: Context<PauseRegistry>,
    registry_id: Pubkey,
    reason: String,
) -> Result<()> {
    let deployed_registry = &mut ctx.accounts.deployed_registry;
    
    // 验证注册表ID
    require!(
        deployed_registry.registry_id == registry_id,
        AlchemeError::InvalidOperation
    );
    
    // 验证当前状态
    require!(
        deployed_registry.status == RegistryStatus::Active,
        AlchemeError::InvalidOperation
    );
    
    deployed_registry.update_status(RegistryStatus::Paused)?;
    
    msg!("注册表暂停成功: {} (原因: {})", registry_id, reason);
    Ok(())
}

/// 恢复注册表
#[derive(Accounts)]
pub struct ResumeRegistry<'info> {
    #[account(
        mut,
        constraint = deployer.key() == deployed_registry.deployer || 
                    deployer.key() == registry_factory.admin @ AlchemeError::Unauthorized
    )]
    pub deployed_registry: Account<'info, DeployedRegistryAccount>,
    
    pub registry_factory: Account<'info, RegistryFactoryAccount>,
    
    pub deployer: Signer<'info>,
}

pub fn resume_registry(
    ctx: Context<ResumeRegistry>,
    registry_id: Pubkey,
) -> Result<()> {
    let deployed_registry = &mut ctx.accounts.deployed_registry;
    
    // 验证注册表ID
    require!(
        deployed_registry.registry_id == registry_id,
        AlchemeError::InvalidOperation
    );
    
    // 验证当前状态
    require!(
        deployed_registry.status == RegistryStatus::Paused,
        AlchemeError::InvalidOperation
    );
    
    deployed_registry.update_status(RegistryStatus::Active)?;
    
    msg!("注册表恢复成功: {}", registry_id);
    Ok(())
}

/// 弃用注册表
#[derive(Accounts)]
pub struct DeprecateRegistry<'info> {
    #[account(mut)]
    pub registry_factory: Account<'info, RegistryFactoryAccount>,
    
    #[account(
        mut,
        constraint = deployer.key() == deployed_registry.deployer || 
                    deployer.key() == registry_factory.admin @ AlchemeError::Unauthorized
    )]
    pub deployed_registry: Account<'info, DeployedRegistryAccount>,
    
    pub deployer: Signer<'info>,
}

pub fn deprecate_registry(
    ctx: Context<DeprecateRegistry>,
    registry_id: Pubkey,
    deprecation_reason: String,
    migration_path: String,
) -> Result<()> {
    let registry_factory = &mut ctx.accounts.registry_factory;
    let deployed_registry = &mut ctx.accounts.deployed_registry;
    
    // 验证注册表ID
    require!(
        deployed_registry.registry_id == registry_id,
        AlchemeError::InvalidOperation
    );
    
    deployed_registry.update_status(RegistryStatus::Deprecated)?;
    registry_factory.deactivate_registry()?;
    
    msg!("注册表弃用成功: {} (原因: {}, 迁移路径: {})", 
         registry_id, deprecation_reason, migration_path);
    Ok(())
}

// ==================== 查询接口 (CPI) ====================

/// 获取注册表信息 (CPI)
#[derive(Accounts)]
pub struct GetRegistryInfo<'info> {
    pub deployed_registry: Account<'info, DeployedRegistryAccount>,
    
    /// CHECK: 调用程序验证
    pub caller_program: AccountInfo<'info>,
}

pub fn get_registry_info(
    ctx: Context<GetRegistryInfo>,
    registry_id: Pubkey,
) -> Result<DeployedRegistry> {
    let deployed_registry = &ctx.accounts.deployed_registry;
    
    // 验证注册表ID
    require!(
        deployed_registry.registry_id == registry_id,
        AlchemeError::InvalidOperation
    );
    
    // 返回注册表信息副本
    Ok(DeployedRegistry {
        registry_id: deployed_registry.registry_id,
        registry_type: deployed_registry.registry_type.clone(),
        deployer: deployed_registry.deployer,
        deployed_at: deployed_registry.deployed_at,
        current_version: deployed_registry.current_version.clone(),
        config: deployed_registry.config.clone(),
        deployment_info: deployed_registry.deployment_info.clone(),
        status: deployed_registry.status.clone(),
        upgrade_history: deployed_registry.upgrade_history.clone(),
        bump: deployed_registry.bump,
    })
}

/// 验证注册表配置 (CPI)
#[derive(Accounts)]
pub struct ValidateRegistryConfig<'info> {
    pub registry_factory: Account<'info, RegistryFactoryAccount>,
    
    /// CHECK: 调用程序验证
    pub caller_program: AccountInfo<'info>,
}

pub fn validate_registry_config(
    ctx: Context<ValidateRegistryConfig>,
    config: RegistryConfig,
    registry_type: RegistryType,
) -> Result<ValidationResult> {
    // 验证调用者权限
    require_cpi_permission!(&ctx.accounts.caller_program.key(), CpiPermission::RegistryDeploy);
    
    // 执行配置验证
    FactoryValidator::validate_registry_config(&config, &registry_type)
}

/// 列出已部署的注册表 (CPI)
#[derive(Accounts)]
pub struct ListDeployedRegistries<'info> {
    pub registry_factory: Account<'info, RegistryFactoryAccount>,
    
    /// CHECK: 调用程序验证
    pub caller_program: AccountInfo<'info>,
}

pub fn list_deployed_registries(
    _ctx: Context<ListDeployedRegistries>,
    _deployer: Option<Pubkey>,
    _registry_type: Option<RegistryType>,
    _status_filter: Option<RegistryStatus>,
) -> Result<Vec<DeployedRegistry>> {
    // 简化实现：返回空列表
    // 在实际实现中，需要查询所有相关的已部署注册表账户
    
    let registries = Vec::new();
    
    msg!("注册表列表查询完成: {} 个注册表", registries.len());
    Ok(registries)
}

// ==================== 统计和监控指令 ====================

/// 获取部署统计
#[derive(Accounts)]
pub struct GetDeploymentStats<'info> {
    pub registry_factory: Account<'info, RegistryFactoryAccount>,
}

pub fn get_deployment_stats(
    ctx: Context<GetDeploymentStats>,
    _time_range: Option<TimeRange>,
) -> Result<DeploymentStats> {
    let registry_factory = &ctx.accounts.registry_factory;
    
    // 简化实现：返回基本统计
    let stats = DeploymentStats {
        total_deployments: registry_factory.total_deployments,
        successful_deployments: registry_factory.active_registries,
        failed_deployments: registry_factory.total_deployments - registry_factory.active_registries,
        deployments_by_type: vec![], // 需要遍历所有部署记录来计算
        average_deployment_time: 300.0, // 5分钟平均部署时间
        total_users_served: registry_factory.active_registries * 1000, // 估算
    };
    
    Ok(stats)
}

/// 获取版本信息
#[derive(Accounts)]
pub struct GetVersionInfo<'info> {
    pub registry_factory: Account<'info, RegistryFactoryAccount>,
}

pub fn get_version_info(
    ctx: Context<GetVersionInfo>,
) -> Result<VersionManager> {
    let registry_factory = &ctx.accounts.registry_factory;
    
    Ok(registry_factory.version_manager.clone())
}

/// 检查升级可用性
#[derive(Accounts)]
pub struct CheckUpgradeAvailability<'info> {
    pub registry_factory: Account<'info, RegistryFactoryAccount>,
    
    pub deployed_registry: Account<'info, DeployedRegistryAccount>,
}

pub fn check_upgrade_availability(
    ctx: Context<CheckUpgradeAvailability>,
    registry_id: Pubkey,
    current_version: String,
) -> Result<Vec<UpgradePath>> {
    let registry_factory = &ctx.accounts.registry_factory;
    let deployed_registry = &ctx.accounts.deployed_registry;
    
    // 验证注册表ID
    require!(
        deployed_registry.registry_id == registry_id,
        AlchemeError::InvalidOperation
    );
    
    // 查找可用的升级路径
    let available_upgrades: Vec<UpgradePath> = registry_factory.version_manager.upgrade_paths
        .iter()
        .filter(|path| path.from_version == current_version)
        .cloned()
        .collect();
    
    msg!("升级路径查询完成: {} 个可用升级", available_upgrades.len());
    Ok(available_upgrades)
}

// ==================== Extension Registry 管理指令 ====================

/// 初始化扩展注册表
#[derive(Accounts)]
pub struct InitializeExtensionRegistry<'info> {
    #[account(
        init,
        payer = admin,
        space = ExtensionRegistryAccount::SPACE,
        seeds = [b"extension_registry"],
        bump
    )]
    pub extension_registry: Account<'info, ExtensionRegistryAccount>,

    #[account(
        constraint = admin.key() == registry_factory.admin @ AlchemeError::Unauthorized
    )]
    pub registry_factory: Account<'info, RegistryFactoryAccount>,

    #[account(mut)]
    pub admin: Signer<'info>,

    pub system_program: Program<'info, System>,
}

pub fn initialize_extension_registry(
    ctx: Context<InitializeExtensionRegistry>,
    max_extensions: u8,
) -> Result<()> {
    let registry = &mut ctx.accounts.extension_registry;
    let bump = ctx.bumps.extension_registry;
    let now = Clock::get()?.unix_timestamp;

    registry.inner = alcheme_cpi::ExtensionRegistry {
        bump,
        admin: ctx.accounts.admin.key(),
        extensions: Vec::new(),
        max_extensions,
        created_at: now,
        last_updated: now,
    };

    msg!("扩展注册表初始化成功, max_extensions={}", max_extensions);
    Ok(())
}

/// 注册新的扩展程序
#[derive(Accounts)]
pub struct RegisterExtension<'info> {
    #[account(
        mut,
        seeds = [b"extension_registry"],
        bump = extension_registry.inner.bump,
    )]
    pub extension_registry: Account<'info, ExtensionRegistryAccount>,

    #[account(
        constraint = admin.key() == extension_registry.inner.admin @ AlchemeError::Unauthorized
    )]
    pub admin: Signer<'info>,
}

pub fn register_extension(
    ctx: Context<RegisterExtension>,
    program_id: Pubkey,
    permissions: Vec<alcheme_cpi::CpiPermission>,
) -> Result<()> {
    let registry = &mut ctx.accounts.extension_registry;
    registry.inner.register_extension(program_id, permissions)?;

    msg!("扩展程序注册成功: {}", program_id);
    Ok(())
}

/// 移除扩展程序
#[derive(Accounts)]
pub struct RemoveExtension<'info> {
    #[account(
        mut,
        seeds = [b"extension_registry"],
        bump = extension_registry.inner.bump,
    )]
    pub extension_registry: Account<'info, ExtensionRegistryAccount>,

    #[account(
        constraint = admin.key() == extension_registry.inner.admin @ AlchemeError::Unauthorized
    )]
    pub admin: Signer<'info>,
}

pub fn remove_extension(
    ctx: Context<RemoveExtension>,
    program_id: Pubkey,
) -> Result<()> {
    let registry = &mut ctx.accounts.extension_registry;
    registry.inner.remove_extension(&program_id)?;

    msg!("扩展程序移除成功: {}", program_id);
    Ok(())
}

/// 更新扩展程序权限
#[derive(Accounts)]
pub struct UpdateExtensionPermissions<'info> {
    #[account(
        mut,
        seeds = [b"extension_registry"],
        bump = extension_registry.inner.bump,
    )]
    pub extension_registry: Account<'info, ExtensionRegistryAccount>,

    #[account(
        constraint = admin.key() == extension_registry.inner.admin @ AlchemeError::Unauthorized
    )]
    pub admin: Signer<'info>,
}

pub fn update_extension_permissions(
    ctx: Context<UpdateExtensionPermissions>,
    program_id: Pubkey,
    new_permissions: Vec<alcheme_cpi::CpiPermission>,
) -> Result<()> {
    let registry = &mut ctx.accounts.extension_registry;
    registry.inner.update_extension_permissions(&program_id, new_permissions)?;

    msg!("扩展程序权限更新成功: {}", program_id);
    Ok(())
}
