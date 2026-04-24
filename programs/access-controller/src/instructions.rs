use anchor_lang::prelude::*;
use alcheme_shared::*;
use alcheme_cpi::{require_cpi_permission, is_authorized_for_cpi, CpiPermission, CpiHelper};
use crate::state::*;
use crate::validation::*;

// ==================== 访问控制器管理指令 ====================

/// 初始化访问控制器
#[derive(Accounts)]
pub struct InitializeAccessController<'info> {
    #[account(
        init,
        payer = admin,
        space = AccessControllerAccount::SPACE,
        seeds = [ACCESS_CONTROLLER_SEED],
        bump
    )]
    pub access_controller: Account<'info, AccessControllerAccount>,
    
    #[account(mut)]
    pub admin: Signer<'info>,
    
    pub system_program: Program<'info, System>,
}

pub fn initialize_access_controller(
    ctx: Context<InitializeAccessController>,
) -> Result<()> {
    let access_controller = &mut ctx.accounts.access_controller;
    let bump = ctx.bumps.access_controller;
    
    access_controller.initialize(bump, ctx.accounts.admin.key())?;
    
    msg!("Access controller initialized");
    Ok(())
}

/// 更新控制器配置
#[derive(Accounts)]
pub struct UpdateControllerConfig<'info> {
    #[account(
        mut,
        constraint = admin.key() == access_controller.admin @ AlchemeError::Unauthorized
    )]
    pub access_controller: Account<'info, AccessControllerAccount>,
    
    pub admin: Signer<'info>,
}

pub fn update_controller_config(
    ctx: Context<UpdateControllerConfig>,
    new_audit_settings: Option<AuditSettings>,
    new_retention_policy: Option<RetentionPolicy>,
) -> Result<()> {
    let access_controller = &mut ctx.accounts.access_controller;
    
    if let Some(audit_settings) = new_audit_settings {
        access_controller.audit_settings = audit_settings;
    }
    
    if let Some(retention_policy) = new_retention_policy {
        access_controller.retention_policy = retention_policy;
    }
    
    access_controller.last_updated = Clock::get()?.unix_timestamp;
    
    msg!("Access controller config updated");
    Ok(())
}

// ==================== 权限规则管理指令 ====================

/// 设置访问规则
#[derive(Accounts)]
pub struct SetAccessRules<'info> {
    #[account(mut)]
    pub access_controller: Account<'info, AccessControllerAccount>,
    
    pub user: Signer<'info>,
}

pub fn set_access_rules(
    ctx: Context<SetAccessRules>,
    user: Pubkey,
    permission: Permission,
    access_rule: AccessRule,
) -> Result<()> {
    let access_controller = &mut ctx.accounts.access_controller;
    process_set_access_rules(access_controller, user, permission, access_rule)
}

pub fn process_set_access_rules(
    access_controller: &mut AccessController,
    user: Pubkey,
    permission: Permission,
    access_rule: AccessRule,
) -> Result<()> {
    // 验证规则
    AccessValidator::validate_access_rule(&access_rule)?;
    
    // 查找现有规则集或创建新的
    let mut found = false;
    for rule_set in &mut access_controller.rule_sets {
        if rule_set.enabled {
            // 查找是否已存在相同权限的规则
            for existing_rule in &mut rule_set.rules {
                if existing_rule.permission == permission && existing_rule.rule_id == access_rule.rule_id {
                    *existing_rule = access_rule.clone();
                    found = true;
                    break;
                }
            }
            if found {
                break;
            }
        }
    }
    
    // 如果规则不存在，创建新的规则集或添加到现有规则集
    if !found {
        if let Some(rule_set) = access_controller.rule_sets.first_mut() {
            rule_set.rules.push(access_rule.clone());
        } else {
            // 创建新的规则集
            let new_rule_set = RuleSet {
                rule_set_id: format!("default_rules_{}", user),
                rule_set_name: "Default Rules".to_string(),
                rules: vec![access_rule.clone()],
                enabled: true,
                priority: 50,
                created_at: Clock::get()?.unix_timestamp,
                updated_at: Clock::get()?.unix_timestamp,
            };
            access_controller.rule_sets.push(new_rule_set);
        }
    }
    
    access_controller.last_updated = Clock::get()?.unix_timestamp;
    
    msg!("Access rule set: {} for {} -> {:?}",
         access_rule.rule_id, user, permission);
    Ok(())
}

/// 批量设置权限
#[derive(Accounts)]
pub struct BatchSetPermissions<'info> {
    #[account(mut)]
    pub access_controller: Account<'info, AccessControllerAccount>,
    
    pub user: Signer<'info>,
}

pub fn batch_set_permissions(
    ctx: Context<BatchSetPermissions>,
    user: Pubkey,
    rules: Vec<AccessRule>,
) -> Result<()> {
    require!(
        rules.len() <= MAX_BATCH_SIZE,
        AlchemeError::BatchPermissionCheckFailed
    );
    
    let rules_len = rules.len();
    let access_controller = &mut ctx.accounts.access_controller;
    
    for rule in rules {
        // 复用单个规则设置逻辑
        process_set_access_rules(
            access_controller,
            user,
            rule.permission.clone(),
            rule,
        )?;
    }
    
    msg!("Batch permission set completed: {} rules", rules_len);
    Ok(())
}

/// 删除访问规则
#[derive(Accounts)]
pub struct RemoveAccessRule<'info> {
    #[account(mut)]
    pub access_controller: Account<'info, AccessControllerAccount>,
    
    pub user: Signer<'info>,
}

pub fn remove_access_rule(
    ctx: Context<RemoveAccessRule>,
    user: Pubkey,
    rule_id: String,
) -> Result<()> {
    let access_controller = &mut ctx.accounts.access_controller;
    
    let mut found = false;
    for rule_set in &mut access_controller.rule_sets {
        rule_set.rules.retain(|rule| {
            if rule.rule_id == rule_id {
                found = true;
                false // 移除此规则
            } else {
                true // 保留此规则
            }
        });
    }
    
    require!(found, AlchemeError::AccessRuleNotFound);
    
    access_controller.last_updated = Clock::get()?.unix_timestamp;
    
    msg!("Access rule removed: {} for {}", rule_id, user);
    Ok(())
}

/// 更新规则状态
#[derive(Accounts)]
pub struct UpdateRuleStatus<'info> {
    #[account(mut)]
    pub access_controller: Account<'info, AccessControllerAccount>,
    
    pub user: Signer<'info>,
}

pub fn update_rule_status(
    ctx: Context<UpdateRuleStatus>,
    user: Pubkey,
    rule_id: String,
    enabled: bool,
) -> Result<()> {
    let access_controller = &mut ctx.accounts.access_controller;
    
    let mut found = false;
    for rule_set in &mut access_controller.rule_sets {
        for rule in &mut rule_set.rules {
            if rule.rule_id == rule_id {
                rule.enabled = enabled;
                found = true;
                break;
            }
        }
        if found {
            break;
        }
    }
    
    require!(found, AlchemeError::AccessRuleNotFound);
    
    access_controller.last_updated = Clock::get()?.unix_timestamp;
    
    msg!("Rule status updated: {} -> {}", rule_id, enabled);
    Ok(())
}

// ==================== 权限检查接口 (CPI) ====================

/// 检查权限 (CPI)
#[derive(Accounts)]
pub struct CheckPermission<'info> {
    #[account(mut)]
    pub access_controller: Account<'info, AccessControllerAccount>,
    
    /// CHECK: 调用程序验证
    pub caller_program: AccountInfo<'info>,
}

pub fn check_permission(
    ctx: Context<CheckPermission>,
    requester: Pubkey,
    target: Pubkey,
    permission: Permission,
    context: PermissionContext,
) -> Result<bool> {
    // 验证调用者权限
    require_cpi_permission!(&ctx.accounts.caller_program.key(), CpiPermission::AccessCheck);
    
    let access_controller = &mut ctx.accounts.access_controller;
    
    // 执行权限检查
    let has_permission = access_controller.check_permission(
        &requester,
        &target,
        permission.clone(),
        &context,
    )?;
    
    // 记录审计日志（如果启用）
    if access_controller.audit_enabled {
        AccessAuditor::log_permission_check(
            &requester,
            &target,
            &permission,
            has_permission,
            &context,
        )?;
    }
    
    msg!("Permission check completed: {} -> {} = {}", requester, target, has_permission);
    Ok(has_permission)
}

/// 批量检查权限 (CPI)
#[derive(Accounts)]
pub struct BatchCheckPermissions<'info> {
    #[account(mut)]
    pub access_controller: Account<'info, AccessControllerAccount>,
    
    /// CHECK: 调用程序验证
    pub caller_program: AccountInfo<'info>,
}

pub fn batch_check_permissions(
    ctx: Context<BatchCheckPermissions>,
    requests: Vec<PermissionRequest>,
) -> Result<Vec<PermissionResult>> {
    // 验证调用者权限
    require_cpi_permission!(&ctx.accounts.caller_program.key(), CpiPermission::AccessCheck);
    
    require!(
        requests.len() <= MAX_BATCH_PERMISSION_CHECKS,
        AlchemeError::BatchPermissionCheckFailed
    );
    
    let access_controller = &mut ctx.accounts.access_controller;
    let mut results = Vec::new();
    
    for request in requests {
        let has_permission = access_controller.check_permission(
            &request.requester,
            &request.target,
            request.permission.clone(),
            &request.context,
        )?;
        
        let result = PermissionResult {
            request_id: request.request_id,
            granted: has_permission,
            reason: if has_permission { "Access granted".to_string() } else { "Access denied".to_string() },
            applicable_rules: vec![], // 简化实现
            checked_at: Clock::get()?.unix_timestamp,
            expires_at: None,
        };
        
        results.push(result);
    }
    
    msg!("Batch permission check completed: {} requests", results.len());
    Ok(results)
}

/// 获取用户权限 (CPI)
#[derive(Accounts)]
pub struct GetUserPermissions<'info> {
    pub access_controller: Account<'info, AccessControllerAccount>,
    
    /// CHECK: 调用程序验证
    pub caller_program: AccountInfo<'info>,
}

pub fn get_user_permissions(
    ctx: Context<GetUserPermissions>,
    user: Pubkey,
    target: Pubkey,
) -> Result<Vec<Permission>> {
    // 验证调用者权限
    require_cpi_permission!(&ctx.accounts.caller_program.key(), CpiPermission::AccessRuleRead);
    
    let access_controller = &ctx.accounts.access_controller;
    
    // 简化实现：返回默认权限
    let mut permissions = access_controller.default_permissions.public_permissions.clone();
    
    // 在实际实现中，这里需要：
    // 1. 查询用户的具体规则
    // 2. 评估关系映射
    // 3. 应用条件规则
    
    msg!("User permission query completed: {} permissions", permissions.len());
    Ok(permissions)
}

/// 验证访问令牌 (CPI)
#[derive(Accounts)]
pub struct VerifyAccessToken<'info> {
    pub access_controller: Account<'info, AccessControllerAccount>,
    
    /// CHECK: 调用程序验证
    pub caller_program: AccountInfo<'info>,
}

pub fn verify_access_token(
    ctx: Context<VerifyAccessToken>,
    token: AccessToken,
    permission: Permission,
) -> Result<bool> {
    // 验证调用者权限
    require_cpi_permission!(&ctx.accounts.caller_program.key(), CpiPermission::AccessCheck);
    
    // 检查令牌是否有效
    let current_time = Clock::get()?.unix_timestamp;
    
    // 检查令牌是否过期
    if token.expires_at < current_time {
        return Ok(false);
    }
    
    // 检查令牌是否被撤销
    if token.revoked {
        return Ok(false);
    }
    
    // 检查令牌是否包含所需权限
    let has_permission = token.permissions.contains(&permission);
    
    msg!("Access token verified: {} = {}", token.token_id, has_permission);
    Ok(has_permission)
}

// ==================== 权限模板管理指令 ====================

/// 创建权限模板
#[derive(Accounts)]
#[instruction(template: PermissionTemplate)]
pub struct CreatePermissionTemplate<'info> {
    #[account(mut)]
    pub access_controller: Account<'info, AccessControllerAccount>,
    
    #[account(
        constraint = admin.key() == access_controller.admin @ AlchemeError::Unauthorized
    )]
    pub admin: Signer<'info>,
}

pub fn create_permission_template(
    ctx: Context<CreatePermissionTemplate>,
    template: PermissionTemplate,
) -> Result<()> {
    let access_controller = &mut ctx.accounts.access_controller;
    
    // 验证模板
    AccessValidator::validate_permission_template(&template)?;
    
    // 检查模板ID是否已存在
    for existing_template in &access_controller.permission_templates {
        require!(
            existing_template.template_id != template.template_id,
            AlchemeError::PermissionTemplateNotFound
        );
    }
    
    access_controller.permission_templates.push(template.clone());
    access_controller.last_updated = Clock::get()?.unix_timestamp;
    
    msg!("Permission template created: {}", template.template_id);
    Ok(())
}

/// 更新权限模板
#[derive(Accounts)]
pub struct UpdatePermissionTemplate<'info> {
    #[account(mut)]
    pub access_controller: Account<'info, AccessControllerAccount>,
    
    #[account(
        constraint = admin.key() == access_controller.admin @ AlchemeError::Unauthorized
    )]
    pub admin: Signer<'info>,
}

pub fn update_permission_template(
    ctx: Context<UpdatePermissionTemplate>,
    template_id: String,
    template: PermissionTemplate,
) -> Result<()> {
    let access_controller = &mut ctx.accounts.access_controller;
    
    // 查找并更新模板
    let mut found = false;
    for existing_template in &mut access_controller.permission_templates {
        if existing_template.template_id == template_id {
            *existing_template = template;
            found = true;
            break;
        }
    }
    
    require!(found, AlchemeError::PermissionTemplateNotFound);
    
    access_controller.last_updated = Clock::get()?.unix_timestamp;
    
    msg!("Permission template updated: {}", template_id);
    Ok(())
}

/// 应用权限模板
#[derive(Accounts)]
pub struct ApplyPermissionTemplate<'info> {
    #[account(mut)]
    pub access_controller: Account<'info, AccessControllerAccount>,
    
    pub user: Signer<'info>,
}

pub fn apply_permission_template(
    ctx: Context<ApplyPermissionTemplate>,
    user: Pubkey,
    template_id: String,
) -> Result<()> {
    let access_controller = &mut ctx.accounts.access_controller;
    
    // 查找模板
    let template = access_controller.permission_templates.iter()
        .find(|t| t.template_id == template_id)
        .ok_or(AlchemeError::PermissionTemplateNotFound)?;
    
    // 应用模板中的默认规则
    let default_rules = template.default_rules.clone();
    for rule in default_rules {
        // 这里应该调用 set_access_rules，但为了简化，直接添加到规则集
        if let Some(rule_set) = access_controller.rule_sets.first_mut() {
            rule_set.rules.push(rule);
        }
    }
    
    access_controller.last_updated = Clock::get()?.unix_timestamp;
    
    msg!("Permission template applied: {} for {}", template_id, user);
    Ok(())
}

// ==================== 关系映射管理指令 ====================

/// 管理关系映射
#[derive(Accounts)]
pub struct ManageRelationshipMapping<'info> {
    #[account(
        mut,
        seeds = [b"access_controller"],
        bump,
        realloc = access_controller.get_size_with_new_mapping(),
        realloc::payer = user,
        realloc::zero = false
    )]
    pub access_controller: Account<'info, AccessControllerAccount>,
    
    #[account(mut)]
    pub user: Signer<'info>,
    
    pub system_program: Program<'info, System>,
}

pub fn manage_relationship_mapping(
    ctx: Context<ManageRelationshipMapping>,
    user1: Pubkey,
    user2: Pubkey,
    relationship_type: RelationshipType,
) -> Result<()> {
    // Anchor 的 realloc 约束已自动处理空间扩展和租金支付
    let access_controller = &mut ctx.accounts.access_controller;
    process_manage_relationship_mapping(access_controller, user1, user2, relationship_type)
}

pub fn process_manage_relationship_mapping(
    access_controller: &mut AccessController,
    user1: Pubkey,
    user2: Pubkey,
    relationship_type: RelationshipType,
) -> Result<()> {
    // 检查是否已存在相同类型的关系映射
    let mut found_index = None;
    for (index, mapping) in access_controller.relationship_mappings.iter().enumerate() {
        if mapping.relationship_type == relationship_type {
            found_index = Some(index);
            break;
        }
    }
    
    let access_level = match relationship_type {
        RelationshipType::Friend => AccessLevel::Friends,
        RelationshipType::Follower => AccessLevel::Followers,
        RelationshipType::Following => AccessLevel::Followers,
        RelationshipType::Blocked => AccessLevel::Private,
        RelationshipType::Muted => AccessLevel::Private,
        RelationshipType::Moderator => AccessLevel::Public,
        RelationshipType::Admin => AccessLevel::Public,
        _ => AccessLevel::Public,
    };
    
    if let Some(index) = found_index {
        // 更新现有映射
        let mapping = &mut access_controller.relationship_mappings[index];
        mapping.access_level = access_level;
        mapping.permissions = vec![Permission::ViewProfile, Permission::ViewContent];
        mapping.auto_grant = true;
    } else {
        // 检查数量限制
        require!(
            access_controller.relationship_mappings.len() < MAX_RELATIONSHIP_MAPPINGS,
            AlchemeError::InvalidOperation
        );
        
        // 创建新的关系映射
        let new_mapping = RelationshipMapping {
            relationship_type: relationship_type.clone(),
            access_level,
            permissions: vec![Permission::ViewProfile, Permission::ViewContent],
            auto_grant: true,
            conditions: None,
        };
        
        access_controller.relationship_mappings.push(new_mapping);
    }
    
    access_controller.last_updated = Clock::get()?.unix_timestamp;
    
    msg!("Relationship mapping managed: {} <-> {} = {:?}",
         user1, user2, relationship_type);
    Ok(())
}

/// 批量更新关系权限
#[derive(Accounts)]
pub struct BatchUpdateRelationshipPermissions<'info> {
    #[account(
        mut,
        seeds = [b"access_controller"],
        bump,
        realloc = access_controller.get_size() + (MAX_BATCH_SIZE * 20), // 每个映射约 20 字节
        realloc::payer = admin,
        realloc::zero = false
    )]
    pub access_controller: Account<'info, AccessControllerAccount>,
    
    #[account(mut)]
    pub admin: Signer<'info>,
    
    pub system_program: Program<'info, System>,
}

pub fn batch_update_relationship_permissions(
    ctx: Context<BatchUpdateRelationshipPermissions>,
    relationships: Vec<crate::RelationshipUpdate>,
) -> Result<()> {
    require!(
        relationships.len() <= MAX_BATCH_SIZE,
        AlchemeError::BatchPermissionCheckFailed
    );
    
    // Anchor 的 realloc 约束已自动处理空间扩展和租金支付
    let access_controller = &mut ctx.accounts.access_controller;
    
    for update in relationships {
        process_manage_relationship_mapping(
            access_controller,
            update.user1,
            update.user2,
            update.relationship_type,
        )?;
    }
    
    msg!("Batch relationship permissions updated");
    Ok(())
}

#[derive(Accounts)]
pub struct FollowUser<'info> {
    #[account(
        mut,
        seeds = [ACCESS_CONTROLLER_SEED],
        bump
    )]
    pub access_controller: Account<'info, AccessControllerAccount>,

    #[account(
        init,
        payer = follower,
        space = FollowRelationshipAccount::SPACE,
        seeds = [FOLLOW_RELATIONSHIP_SEED, follower.key().as_ref(), followed.key().as_ref()],
        bump
    )]
    pub follow_relationship: Account<'info, FollowRelationshipAccount>,

    #[account(mut)]
    pub follower: Signer<'info>,

    /// CHECK: 目标用户钱包地址，仅记录为关系事实 key
    pub followed: UncheckedAccount<'info>,

    pub system_program: Program<'info, System>,

    /// CHECK: Event Emitter program, validated by CPI helper
    pub event_program: AccountInfo<'info>,

    /// CHECK: Event Emitter account, validated by CPI helper
    #[account(mut)]
    pub event_emitter: AccountInfo<'info>,

    /// CHECK: Event Batch account, PDA validated by event emitter program
    #[account(mut)]
    pub event_batch: AccountInfo<'info>,
}

pub fn follow_user(
    ctx: Context<FollowUser>,
) -> Result<()> {
    require!(
        ctx.accounts.access_controller.status == ControllerStatus::Active,
        AlchemeError::InvalidOperation
    );
    require!(
        ctx.accounts.follower.key() != ctx.accounts.followed.key(),
        AlchemeError::InvalidOperation
    );

    let follow_relationship = &mut ctx.accounts.follow_relationship;
    follow_relationship.initialize(
        ctx.bumps.follow_relationship,
        ctx.accounts.follower.key(),
        ctx.accounts.followed.key(),
    )?;

    ctx.accounts.access_controller.last_updated = Clock::get()?.unix_timestamp;

    emit_follow_action(
        &ctx.accounts.event_program,
        &mut ctx.accounts.event_emitter,
        &mut ctx.accounts.event_batch,
        &ctx.accounts.follower.to_account_info(),
        &ctx.accounts.system_program.to_account_info(),
        ctx.accounts.follower.key(),
        ctx.accounts.followed.key(),
        FollowActionType::Follow,
    )?;

    msg!(
        "follow fact created: {} -> {}",
        ctx.accounts.follower.key(),
        ctx.accounts.followed.key()
    );
    Ok(())
}

#[derive(Accounts)]
pub struct UnfollowUser<'info> {
    #[account(
        mut,
        seeds = [ACCESS_CONTROLLER_SEED],
        bump
    )]
    pub access_controller: Account<'info, AccessControllerAccount>,

    #[account(
        mut,
        close = follower,
        seeds = [FOLLOW_RELATIONSHIP_SEED, follower.key().as_ref(), followed.key().as_ref()],
        bump = follow_relationship.bump,
        constraint = follow_relationship.follower == follower.key() @ AlchemeError::Unauthorized,
        constraint = follow_relationship.followed == followed.key() @ AlchemeError::InvalidOperation
    )]
    pub follow_relationship: Account<'info, FollowRelationshipAccount>,

    #[account(mut)]
    pub follower: Signer<'info>,

    /// CHECK: 目标用户钱包地址，仅用于约束和事件
    pub followed: UncheckedAccount<'info>,

    pub system_program: Program<'info, System>,

    /// CHECK: Event Emitter program, validated by CPI helper
    pub event_program: AccountInfo<'info>,

    /// CHECK: Event Emitter account, validated by CPI helper
    #[account(mut)]
    pub event_emitter: AccountInfo<'info>,

    /// CHECK: Event Batch account, PDA validated by event emitter program
    #[account(mut)]
    pub event_batch: AccountInfo<'info>,
}

pub fn unfollow_user(
    ctx: Context<UnfollowUser>,
) -> Result<()> {
    require!(
        ctx.accounts.access_controller.status == ControllerStatus::Active,
        AlchemeError::InvalidOperation
    );

    ctx.accounts.access_controller.last_updated = Clock::get()?.unix_timestamp;

    emit_follow_action(
        &ctx.accounts.event_program,
        &mut ctx.accounts.event_emitter,
        &mut ctx.accounts.event_batch,
        &ctx.accounts.follower.to_account_info(),
        &ctx.accounts.system_program.to_account_info(),
        ctx.accounts.follower.key(),
        ctx.accounts.followed.key(),
        FollowActionType::Unfollow,
    )?;

    msg!(
        "follow fact removed: {} -> {}",
        ctx.accounts.follower.key(),
        ctx.accounts.followed.key()
    );
    Ok(())
}

fn emit_follow_action<'info>(
    event_program: &AccountInfo<'info>,
    event_emitter: &mut AccountInfo<'info>,
    event_batch: &mut AccountInfo<'info>,
    authority: &AccountInfo<'info>,
    system_program: &AccountInfo<'info>,
    follower: Pubkey,
    followed: Pubkey,
    action: FollowActionType,
) -> Result<()> {
    let event = ProtocolEvent::FollowAction {
        follower,
        followed,
        action,
        timestamp: Clock::get()?.unix_timestamp,
    };

    CpiHelper::emit_event_simple(
        event_program,
        event_emitter,
        event_batch,
        authority,
        system_program,
        &crate::ID,
        event,
    )?;

    Ok(())
}

// ==================== 审计和监控指令 ====================

/// 设置审计配置
#[derive(Accounts)]
pub struct SetAuditConfig<'info> {
    #[account(
        mut,
        constraint = admin.key() == access_controller.admin @ AlchemeError::Unauthorized
    )]
    pub access_controller: Account<'info, AccessControllerAccount>,
    
    pub admin: Signer<'info>,
}

pub fn set_audit_config(
    ctx: Context<SetAuditConfig>,
    audit_enabled: bool,
    audit_settings: AuditSettings,
) -> Result<()> {
    let access_controller = &mut ctx.accounts.access_controller;
    
    access_controller.audit_enabled = audit_enabled;
    access_controller.audit_settings = audit_settings;
    access_controller.last_updated = Clock::get()?.unix_timestamp;
    
    msg!("Audit config updated: enabled = {}", audit_enabled);
    Ok(())
}

/// 获取访问统计
#[derive(Accounts)]
pub struct GetAccessStats<'info> {
    pub access_controller: Account<'info, AccessControllerAccount>,
}

pub fn get_access_stats(
    ctx: Context<GetAccessStats>,
    _time_range: Option<TimeRange>,
) -> Result<AccessStats> {
    let access_controller = &ctx.accounts.access_controller;
    
    let stats = AccessStats {
        total_checks: access_controller.total_checks,
        access_granted: access_controller.access_granted,
        access_denied: access_controller.access_denied,
        success_rate: if access_controller.total_checks > 0 {
            (access_controller.access_granted as f64 / access_controller.total_checks as f64) * 100.0
        } else {
            0.0
        },
        active_rules: access_controller.rule_sets.iter()
            .map(|rs| rs.rules.len() as u64)
            .sum(),
        active_templates: access_controller.permission_templates.len() as u64,
        relationship_mappings: access_controller.relationship_mappings.len() as u64,
        last_updated: access_controller.last_stats_update,
    };
    
    Ok(stats)
}

/// 获取审计日志
#[derive(Accounts)]
pub struct GetAuditLogs<'info> {
    pub access_controller: Account<'info, AccessControllerAccount>,
    
    #[account(
        constraint = admin.key() == access_controller.admin @ AlchemeError::Unauthorized
    )]
    pub admin: Signer<'info>,
}

pub fn get_audit_logs(
    _ctx: Context<GetAuditLogs>,
    _filters: AuditFilters,
    _pagination: PaginationConfig,
) -> Result<Vec<AuditLog>> {
    // 简化实现：返回空日志列表
    // 在实际实现中，需要查询审计日志存储
    
    let audit_logs = Vec::new();
    
    msg!("Audit log query completed: {} records", audit_logs.len());
    Ok(audit_logs)
}
