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
declare_id!("BNbDZu2djPT6rdqgsSEtyiCw4b8wteBNQDiyKS6GFxun");

/// Access Controller Program - 访问控制器程序
#[program]
pub mod access_controller {
    use super::*;

    // ==================== 访问控制器管理 ====================

    /// 初始化访问控制器
    pub fn initialize_access_controller(
        ctx: Context<InitializeAccessController>,
    ) -> Result<()> {
        instructions::initialize_access_controller(ctx)
    }

    /// 更新控制器配置
    pub fn update_controller_config(
        ctx: Context<UpdateControllerConfig>,
        new_audit_settings: Option<AuditSettings>,
        new_retention_policy: Option<RetentionPolicy>,
    ) -> Result<()> {
        instructions::update_controller_config(ctx, new_audit_settings, new_retention_policy)
    }

    // ==================== 权限规则管理 ====================

    /// 设置访问规则
    pub fn set_access_rules(
        ctx: Context<SetAccessRules>,
        user: Pubkey,
        permission: Permission,
        access_rule: AccessRule,
    ) -> Result<()> {
        instructions::set_access_rules(ctx, user, permission, access_rule)
    }

    /// 批量设置权限
    pub fn batch_set_permissions(
        ctx: Context<BatchSetPermissions>,
        user: Pubkey,
        rules: Vec<AccessRule>,
    ) -> Result<()> {
        instructions::batch_set_permissions(ctx, user, rules)
    }

    /// 删除访问规则
    pub fn remove_access_rule(
        ctx: Context<RemoveAccessRule>,
        user: Pubkey,
        rule_id: String,
    ) -> Result<()> {
        instructions::remove_access_rule(ctx, user, rule_id)
    }

    /// 更新规则状态
    pub fn update_rule_status(
        ctx: Context<UpdateRuleStatus>,
        user: Pubkey,
        rule_id: String,
        enabled: bool,
    ) -> Result<()> {
        instructions::update_rule_status(ctx, user, rule_id, enabled)
    }

    // ==================== 权限检查接口 (CPI) ====================

    /// 检查权限 (CPI)
    pub fn check_permission(
        ctx: Context<CheckPermission>,
        requester: Pubkey,
        target: Pubkey,
        permission: Permission,
        context: PermissionContext,
    ) -> Result<bool> {
        instructions::check_permission(ctx, requester, target, permission, context)
    }

    /// 批量检查权限 (CPI)
    pub fn batch_check_permissions(
        ctx: Context<BatchCheckPermissions>,
        requests: Vec<PermissionRequest>,
    ) -> Result<Vec<PermissionResult>> {
        instructions::batch_check_permissions(ctx, requests)
    }

    /// 获取用户权限 (CPI)
    pub fn get_user_permissions(
        ctx: Context<GetUserPermissions>,
        user: Pubkey,
        target: Pubkey,
    ) -> Result<Vec<Permission>> {
        instructions::get_user_permissions(ctx, user, target)
    }

    /// 验证访问令牌 (CPI)
    pub fn verify_access_token(
        ctx: Context<VerifyAccessToken>,
        token: AccessToken,
        permission: Permission,
    ) -> Result<bool> {
        instructions::verify_access_token(ctx, token, permission)
    }

    // ==================== 权限模板管理 ====================

    /// 创建权限模板
    pub fn create_permission_template(
        ctx: Context<CreatePermissionTemplate>,
        template: PermissionTemplate,
    ) -> Result<()> {
        instructions::create_permission_template(ctx, template)
    }

    /// 更新权限模板
    pub fn update_permission_template(
        ctx: Context<UpdatePermissionTemplate>,
        template_id: String,
        template: PermissionTemplate,
    ) -> Result<()> {
        instructions::update_permission_template(ctx, template_id, template)
    }

    /// 应用权限模板
    pub fn apply_permission_template(
        ctx: Context<ApplyPermissionTemplate>,
        user: Pubkey,
        template_id: String,
    ) -> Result<()> {
        instructions::apply_permission_template(ctx, user, template_id)
    }

    // ==================== 关系映射管理 ====================

    /// 管理关系映射
    pub fn manage_relationship_mapping(
        ctx: Context<ManageRelationshipMapping>,
        user1: Pubkey,
        user2: Pubkey,
        relationship_type: RelationshipType,
    ) -> Result<()> {
        instructions::manage_relationship_mapping(ctx, user1, user2, relationship_type)
    }

    /// 批量更新关系权限
    pub fn batch_update_relationship_permissions(
        ctx: Context<BatchUpdateRelationshipPermissions>,
        relationships: Vec<RelationshipUpdate>,
    ) -> Result<()> {
        instructions::batch_update_relationship_permissions(ctx, relationships)
    }

    /// 建立最小关注关系事实
    pub fn follow_user(
        ctx: Context<FollowUser>,
    ) -> Result<()> {
        instructions::follow_user(ctx)
    }

    /// 删除最小关注关系事实
    pub fn unfollow_user(
        ctx: Context<UnfollowUser>,
    ) -> Result<()> {
        instructions::unfollow_user(ctx)
    }

/// 关系更新结构体
#[derive(AnchorSerialize, AnchorDeserialize, Clone, Debug)]
pub struct RelationshipUpdate {
    pub user1: Pubkey,
    pub user2: Pubkey,
    pub relationship_type: RelationshipType,
}

    // ==================== 审计和监控 ====================

    /// 设置审计配置
    pub fn set_audit_config(
        ctx: Context<SetAuditConfig>,
        audit_enabled: bool,
        audit_settings: AuditSettings,
    ) -> Result<()> {
        instructions::set_audit_config(ctx, audit_enabled, audit_settings)
    }

    /// 获取访问统计
    pub fn get_access_stats(
        ctx: Context<GetAccessStats>,
        time_range: Option<TimeRange>,
    ) -> Result<AccessStats> {
        instructions::get_access_stats(ctx, time_range)
    }

    /// 获取审计日志
    pub fn get_audit_logs(
        ctx: Context<GetAuditLogs>,
        filters: AuditFilters,
        pagination: PaginationConfig,
    ) -> Result<Vec<AuditLog>> {
        instructions::get_audit_logs(ctx, filters, pagination)
    }
}
