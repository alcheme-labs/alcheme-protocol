use anchor_lang::prelude::*;
use alcheme_shared::*;

/// 分页配置
#[derive(AnchorSerialize, AnchorDeserialize, Clone, Debug)]
pub struct PaginationConfig {
    pub page: u32,
    pub limit: u32,
    pub sort_by: Option<String>,
    pub sort_order: SortOrder,
}

/// 排序顺序
#[derive(AnchorSerialize, AnchorDeserialize, Clone, Debug, PartialEq)]
pub enum SortOrder {
    Ascending,
    Descending,
}

/// 访问统计
#[derive(AnchorSerialize, AnchorDeserialize, Clone, Debug)]
pub struct AccessStats {
    pub total_checks: u64,
    pub access_granted: u64,
    pub access_denied: u64,
    pub success_rate: f64,
    pub active_rules: u64,
    pub active_templates: u64,
    pub relationship_mappings: u64,
    pub last_updated: i64,
}

/// 审计过滤器
#[derive(AnchorSerialize, AnchorDeserialize, Clone, Debug)]
pub struct AuditFilters {
    pub user_filter: Option<Pubkey>,
    pub permission_filter: Option<Permission>,
    pub result_filter: Option<bool>, // true for granted, false for denied
    pub time_range: Option<TimeRange>,
    pub resource_type_filter: Option<ResourceType>,
}

/// 审计日志
#[derive(AnchorSerialize, AnchorDeserialize, Clone, Debug)]
pub struct AuditLog {
    pub log_id: String,
    pub requester: Pubkey,
    pub target: Pubkey,
    pub permission: Permission,
    pub granted: bool,
    pub reason: String,
    pub timestamp: i64,
    pub context: PermissionContext,
    pub applicable_rules: Vec<String>,
}

/// 权限更新请求
#[derive(AnchorSerialize, AnchorDeserialize, Clone, Debug)]
pub struct PermissionUpdate {
    pub rule_id: String,
    pub permission: Option<Permission>,
    pub access_level: Option<AccessLevel>,
    pub conditions: Option<Conditions>,
    pub enabled: Option<bool>,
    pub expires_at: Option<i64>,
}

/// 批量权限操作结果
#[derive(AnchorSerialize, AnchorDeserialize, Clone, Debug)]
pub struct BatchPermissionResult {
    pub successful_operations: u32,
    pub failed_operations: u32,
    pub operation_details: Vec<OperationDetail>,
    pub total_processing_time_ms: u64,
}

/// 操作详情
#[derive(AnchorSerialize, AnchorDeserialize, Clone, Debug)]
pub struct OperationDetail {
    pub operation_id: String,
    pub success: bool,
    pub error_message: Option<String>,
    pub processing_time_ms: u64,
}

// ==================== 审计工具 ====================

/// 访问审计器
pub struct AccessAuditor;

impl AccessAuditor {
    /// 记录权限检查
    pub fn log_permission_check(
        requester: &Pubkey,
        target: &Pubkey,
        permission: &Permission,
        granted: bool,
        context: &PermissionContext,
    ) -> Result<()> {
        // 简化实现：仅记录到程序日志
        msg!("AUDIT: {} requested {} on {} -> {} at {}", 
             requester, 
             Self::permission_to_string(permission),
             target, 
             if granted { "GRANTED" } else { "DENIED" },
             context.timestamp);
        
        Ok(())
    }

    /// 记录权限变更
    pub fn log_permission_change(
        user: &Pubkey,
        rule_id: &str,
        old_rule: Option<&AccessRule>,
        new_rule: Option<&AccessRule>,
        changed_by: &Pubkey,
    ) -> Result<()> {
        let change_type = match (old_rule, new_rule) {
            (None, Some(_)) => "CREATED",
            (Some(_), None) => "DELETED",
            (Some(_), Some(_)) => "UPDATED",
            (None, None) => "NO_CHANGE",
        };
        
        msg!("AUDIT: Permission rule {} for {} by {} - {}", 
             rule_id, user, changed_by, change_type);
        
        Ok(())
    }

    /// 记录策略违规
    pub fn log_policy_violation(
        user: &Pubkey,
        policy_id: &str,
        violation_type: &str,
        severity: PolicySeverity,
    ) -> Result<()> {
        msg!("AUDIT: Policy violation {} by {} - {} (severity: {:?})", 
             policy_id, user, violation_type, severity);
        
        Ok(())
    }

    /// 权限枚举转字符串
    fn permission_to_string(permission: &Permission) -> String {
        match permission {
            // 基础操作权限
            Permission::CreateContent => "CREATE_CONTENT".to_string(),
            Permission::EditContent => "EDIT_CONTENT".to_string(),
            Permission::DeleteContent => "DELETE_CONTENT".to_string(),
            Permission::ViewContent => "VIEW_CONTENT".to_string(),
            
            // 社交权限
            Permission::FollowUser => "FOLLOW_USER".to_string(),
            Permission::UnfollowUser => "UNFOLLOW_USER".to_string(),
            Permission::MessageUser => "MESSAGE_USER".to_string(),
            Permission::ViewProfile => "VIEW_PROFILE".to_string(),
            Permission::EditProfile => "EDIT_PROFILE".to_string(),
            Permission::ViewFollowers => "VIEW_FOLLOWERS".to_string(),
            Permission::ViewFollowing => "VIEW_FOLLOWING".to_string(),
            
            // 互动权限
            Permission::LikeContent => "LIKE_CONTENT".to_string(),
            Permission::CommentContent => "COMMENT_CONTENT".to_string(),
            Permission::ShareContent => "SHARE_CONTENT".to_string(),
            Permission::ReportContent => "REPORT_CONTENT".to_string(),
            Permission::InteractWithContent => "INTERACT_WITH_CONTENT".to_string(),
            
            // 社区权限
            Permission::JoinCommunity => "JOIN_COMMUNITY".to_string(),
            Permission::LeaveCommunity => "LEAVE_COMMUNITY".to_string(),
            Permission::CreateCommunity => "CREATE_COMMUNITY".to_string(),
            Permission::ModerateCommunity => "MODERATE_COMMUNITY".to_string(),
            Permission::InviteMembers => "INVITE_MEMBERS".to_string(),
            Permission::RemoveMembers => "REMOVE_MEMBERS".to_string(),
            
            // 系统权限
            Permission::ManageSettings => "MANAGE_SETTINGS".to_string(),
            Permission::AccessAnalytics => "ACCESS_ANALYTICS".to_string(),
            Permission::SystemAdmin => "SYSTEM_ADMIN".to_string(),
            Permission::VerifyIdentity => "VERIFY_IDENTITY".to_string(),
            
            // 传统权限
            Permission::Follow => "FOLLOW".to_string(),
            Permission::Message => "MESSAGE".to_string(),
            Permission::Comment => "COMMENT".to_string(),
            Permission::Share => "SHARE".to_string(),
            Permission::ModerateContent => "MODERATE_CONTENT".to_string(),
            Permission::ManageUsers => "MANAGE_USERS".to_string(),
            Permission::ConfigureSystem => "CONFIGURE_SYSTEM".to_string(),
            
            // 自定义权限
            Permission::Custom(name) => format!("CUSTOM_{}", name.to_uppercase()),
        }
    }
}

// ==================== 权限工具函数 ====================

/// 权限工具
pub struct PermissionUtils;

impl PermissionUtils {
    /// 检查权限兼容性
    pub fn are_permissions_compatible(perm1: &Permission, perm2: &Permission) -> bool {
        // 某些权限是互斥的
        match (perm1, perm2) {
            (Permission::ViewContent, Permission::DeleteContent) => false,
            (Permission::Follow, Permission::Follow) => false, // 重复权限
            _ => true,
        }
    }

    /// 获取权限依赖
    pub fn get_permission_dependencies(permission: &Permission) -> Vec<Permission> {
        match permission {
            Permission::EditContent => vec![Permission::ViewContent],
            Permission::DeleteContent => vec![Permission::ViewContent, Permission::EditContent],
            Permission::ModerateContent => vec![Permission::ViewContent],
            Permission::ManageUsers => vec![Permission::ViewProfile],
            _ => vec![],
        }
    }

    /// 检查权限层级
    pub fn get_permission_level(permission: &Permission) -> u8 {
        match permission {
            Permission::ViewProfile | Permission::ViewContent => 1,
            Permission::LikeContent | Permission::Comment | Permission::Share => 2,
            Permission::CreateContent | Permission::Follow | Permission::Message => 3,
            Permission::EditContent | Permission::DeleteContent => 4,
            Permission::ModerateContent | Permission::ManageUsers => 5,
            Permission::ConfigureSystem => 6,
            _ => 3, // 默认级别
        }
    }

    /// 验证权限升级路径
    pub fn validate_permission_upgrade(
        current_permissions: &[Permission],
        new_permission: &Permission,
    ) -> Result<bool> {
        let new_level = Self::get_permission_level(new_permission);
        let dependencies = Self::get_permission_dependencies(new_permission);
        
        // 检查是否满足依赖
        for dep in dependencies {
            if !current_permissions.contains(&dep) {
                return Ok(false);
            }
        }
        
        // 检查权限级别是否合理
        let max_current_level = current_permissions.iter()
            .map(Self::get_permission_level)
            .max()
            .unwrap_or(0);
        
        // 不允许跨级别太大的权限升级
        if new_level > max_current_level + 2 {
            return Ok(false);
        }
        
        Ok(true)
    }
}

// ==================== Wrapper Accounts ====================
use std::ops::{Deref, DerefMut};

#[account]
pub struct AccessControllerAccount {
    pub inner: alcheme_shared::access::AccessController,
}

impl Deref for AccessControllerAccount {
    type Target = alcheme_shared::access::AccessController;
    fn deref(&self) -> &Self::Target {
        &self.inner
    }
}

impl DerefMut for AccessControllerAccount {
    fn deref_mut(&mut self) -> &mut Self::Target {
        &mut self.inner
    }
}

impl AccessControllerAccount {
    pub const SPACE: usize = alcheme_shared::access::AccessController::SPACE;
}

#[account]
pub struct FollowRelationshipAccount {
    pub inner: alcheme_shared::access::FollowRelationship,
}

impl Deref for FollowRelationshipAccount {
    type Target = alcheme_shared::access::FollowRelationship;
    fn deref(&self) -> &Self::Target {
        &self.inner
    }
}

impl DerefMut for FollowRelationshipAccount {
    fn deref_mut(&mut self) -> &mut Self::Target {
        &mut self.inner
    }
}

impl FollowRelationshipAccount {
    pub const SPACE: usize = alcheme_shared::access::FollowRelationship::SPACE;
}
