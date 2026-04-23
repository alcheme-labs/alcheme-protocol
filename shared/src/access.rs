use anchor_lang::prelude::*;
use crate::types::*;

/// 访问控制器主账户
#[derive(AnchorSerialize, AnchorDeserialize, Clone, Debug)]
pub struct AccessController {
    // === 基础配置 ===
    pub bump: u8,
    pub admin: Pubkey,
    pub created_at: i64,
    pub last_updated: i64,
    
    // === 权限配置 ===
    pub default_permissions: DefaultPermissions,
    pub permission_templates: Vec<PermissionTemplate>,
    pub custom_permissions: Vec<CustomPermission>,
    
    // === 访问级别配置 ===
    pub access_level_configs: Vec<AccessLevelConfig>,
    pub relationship_mappings: Vec<RelationshipMapping>,
    
    // === 规则引擎配置 ===
    pub rule_sets: Vec<RuleSet>,
    pub policy_configs: Vec<PolicyConfig>,
    pub conditional_rules: Vec<ConditionalRule>,
    
    // === 审计配置 ===
    pub audit_enabled: bool,
    pub audit_settings: AuditSettings,
    pub retention_policy: RetentionPolicy,
    
    // === 统计信息 ===
    pub total_checks: u64,
    pub access_granted: u64,
    pub access_denied: u64,
    pub last_stats_update: i64,
    
    // === 扩展配置 ===
    pub metadata_uri: String,
    pub custom_settings: Vec<KeyValue>,
    pub version: u8,
    pub status: ControllerStatus,
}

/// 访问规则
#[derive(AnchorSerialize, AnchorDeserialize, Clone, Debug)]
pub struct AccessRule {
    pub rule_id: String,                 // 规则标识符
    pub permission: Permission,          // 权限类型
    pub access_level: AccessLevel,       // 访问级别
    pub conditions: Option<Conditions>,  // 附加条件
    pub exceptions: Vec<Pubkey>,         // 例外用户列表
    pub priority: u8,                    // 规则优先级
    pub enabled: bool,                   // 是否启用
    pub created_at: i64,                 // 创建时间
    pub expires_at: Option<i64>,         // 过期时间
}

/// 权限上下文
#[derive(AnchorSerialize, AnchorDeserialize, Clone, Debug)]
pub struct PermissionContext {
    pub requester: Pubkey,               // 请求者
    pub target: Pubkey,                  // 目标资源
    pub permission: Permission,          // 请求的权限
    pub resource_type: ResourceType,     // 资源类型
    pub timestamp: i64,                  // 请求时间
    pub source: String,                  // 请求来源
    pub additional_data: Vec<KeyValue>,  // 附加数据
}

/// 条件限制
#[derive(AnchorSerialize, AnchorDeserialize, Clone, Debug, PartialEq)]
pub struct Conditions {
    pub reputation_threshold: Option<f64>,      // 信誉门槛
    pub time_restrictions: Option<TimeWindow>,  // 时间限制
    pub location_restrictions: Option<Vec<String>>, // 地理限制
    pub device_restrictions: Option<Vec<String>>,   // 设备限制
    pub custom_conditions: Vec<CustomCondition>,    // 自定义条件
}

/// 时间窗口
#[derive(AnchorSerialize, AnchorDeserialize, Clone, Debug, PartialEq)]
pub struct TimeWindow {
    pub start_time: i64,                 // 开始时间
    pub end_time: i64,                   // 结束时间
    pub days_of_week: Option<Vec<u8>>,   // 星期限制 (0-6)
    pub hours_of_day: Option<Vec<u8>>,   // 小时限制 (0-23)
    pub timezone: Option<String>,        // 时区
}

/// 自定义条件
#[derive(AnchorSerialize, AnchorDeserialize, Clone, Debug, PartialEq)]
pub struct CustomCondition {
    pub condition_type: String,          // 条件类型
    pub operator: ConditionOperator,     // 操作符
    pub value: String,                   // 条件值
    pub description: Option<String>,     // 条件描述
}

/// 条件操作符
#[derive(AnchorSerialize, AnchorDeserialize, Clone, Debug, PartialEq)]
pub enum ConditionOperator {
    Equal,
    NotEqual,
    GreaterThan,
    LessThan,
    GreaterThanOrEqual,
    LessThanOrEqual,
    Contains,
    NotContains,
    InRange,
    NotInRange,
}

/// 资源类型
#[derive(AnchorSerialize, AnchorDeserialize, Clone, Debug, PartialEq)]
pub enum ResourceType {
    UserProfile,
    Content,
    Community,
    Message,
    Analytics,
    Settings,
    System,
    Custom(String),
}

/// 默认权限配置
#[derive(AnchorSerialize, AnchorDeserialize, Clone, Debug)]
pub struct DefaultPermissions {
    pub new_user_permissions: Vec<Permission>,
    pub public_permissions: Vec<Permission>,
    pub follower_permissions: Vec<Permission>,
    pub friend_permissions: Vec<Permission>,
    pub community_permissions: Vec<Permission>,
}

/// 权限模板
#[derive(AnchorSerialize, AnchorDeserialize, Clone, Debug)]
pub struct PermissionTemplate {
    pub template_id: String,
    pub template_name: String,
    pub description: String,
    pub permissions: Vec<Permission>,
    pub access_levels: Vec<AccessLevel>,
    pub default_rules: Vec<AccessRule>,
    pub created_at: i64,
    pub created_by: Pubkey,
}

/// 自定义权限
#[derive(AnchorSerialize, AnchorDeserialize, Clone, Debug)]
pub struct CustomPermission {
    pub permission_id: String,
    pub permission_name: String,
    pub description: String,
    pub resource_types: Vec<ResourceType>,
    pub operations: Vec<String>,
    pub created_at: i64,
    pub created_by: Pubkey,
}

/// 访问级别配置
#[derive(AnchorSerialize, AnchorDeserialize, Clone, Debug)]
pub struct AccessLevelConfig {
    pub level: AccessLevel,
    pub description: String,
    pub default_permissions: Vec<Permission>,
    pub restrictions: Vec<AccessRestriction>,
    pub inheritance_rules: Vec<InheritanceRule>,
}

/// 访问限制
#[derive(AnchorSerialize, AnchorDeserialize, Clone, Debug)]
pub struct AccessRestriction {
    pub restriction_type: RestrictionType,
    pub value: String,
    pub enabled: bool,
}

/// 限制类型
#[derive(AnchorSerialize, AnchorDeserialize, Clone, Debug, PartialEq)]
pub enum RestrictionType {
    TimeWindow,
    Location,
    Device,
    Reputation,
    Age,
    Custom(String),
}

/// 继承规则
#[derive(AnchorSerialize, AnchorDeserialize, Clone, Debug)]
pub struct InheritanceRule {
    pub from_level: AccessLevel,
    pub to_level: AccessLevel,
    pub inherited_permissions: Vec<Permission>,
    pub conditions: Option<Conditions>,
}

/// 关系映射
#[derive(AnchorSerialize, AnchorDeserialize, Clone, Debug)]
pub struct RelationshipMapping {
    pub relationship_type: RelationshipType,
    pub access_level: AccessLevel,
    pub permissions: Vec<Permission>,
    pub auto_grant: bool,
    pub conditions: Option<Conditions>,
}

/// 最小关注关系事实
#[derive(AnchorSerialize, AnchorDeserialize, Clone, Debug)]
pub struct FollowRelationship {
    pub bump: u8,
    pub follower: Pubkey,
    pub followed: Pubkey,
    pub created_at: i64,
}

/// 规则集
#[derive(AnchorSerialize, AnchorDeserialize, Clone, Debug)]
pub struct RuleSet {
    pub rule_set_id: String,
    pub rule_set_name: String,
    pub rules: Vec<AccessRule>,
    pub enabled: bool,
    pub priority: u8,
    pub created_at: i64,
    pub updated_at: i64,
}

/// 策略配置
#[derive(AnchorSerialize, AnchorDeserialize, Clone, Debug)]
pub struct PolicyConfig {
    pub policy_id: String,
    pub policy_name: String,
    pub description: String,
    pub target_resources: Vec<ResourceType>,
    pub enforcement_level: EnforcementLevel,
    pub rules: Vec<PolicyRule>,
    pub exceptions: Vec<PolicyException>,
}

/// 执行级别
#[derive(AnchorSerialize, AnchorDeserialize, Clone, Debug, PartialEq)]
pub enum EnforcementLevel {
    Advisory,     // 建议性
    Warning,      // 警告
    Blocking,     // 阻止
    Strict,       // 严格
}

/// 策略规则
#[derive(AnchorSerialize, AnchorDeserialize, Clone, Debug)]
pub struct PolicyRule {
    pub rule_type: PolicyRuleType,
    pub conditions: Conditions,
    pub action: PolicyAction,
    pub severity: PolicySeverity,
}

/// 策略规则类型
#[derive(AnchorSerialize, AnchorDeserialize, Clone, Debug, PartialEq)]
pub enum PolicyRuleType {
    RateLimiting,
    ContentFiltering,
    BehaviorMonitoring,
    ComplianceCheck,
    Custom(String),
}

/// 策略动作
#[derive(AnchorSerialize, AnchorDeserialize, Clone, Debug, PartialEq)]
pub enum PolicyAction {
    Allow,
    Deny,
    Warn,
    Log,
    Throttle,
    Redirect,
}

/// 策略严重性
#[derive(AnchorSerialize, AnchorDeserialize, Clone, Debug, PartialEq)]
pub enum PolicySeverity {
    Low,
    Medium,
    High,
    Critical,
}

/// 策略例外
#[derive(AnchorSerialize, AnchorDeserialize, Clone, Debug)]
pub struct PolicyException {
    pub exception_type: ExceptionType,
    pub target: Pubkey,
    pub reason: String,
    pub expires_at: Option<i64>,
}

/// 例外类型
#[derive(AnchorSerialize, AnchorDeserialize, Clone, Debug, PartialEq)]
pub enum ExceptionType {
    UserException,
    ResourceException,
    TimeException,
    Custom(String),
}

/// 条件规则
#[derive(AnchorSerialize, AnchorDeserialize, Clone, Debug)]
pub struct ConditionalRule {
    pub rule_id: String,
    pub conditions: Conditions,
    pub then_permissions: Vec<Permission>,
    pub else_permissions: Vec<Permission>,
    pub evaluation_order: u8,
}

/// 审计设置
#[derive(AnchorSerialize, AnchorDeserialize, Clone, Debug)]
pub struct AuditSettings {
    pub log_all_checks: bool,
    pub log_denied_access: bool,
    pub log_permission_changes: bool,
    pub log_policy_violations: bool,
    pub detailed_logging: bool,
    pub retention_days: u32,
    pub export_format: AuditExportFormat,
}

/// 审计导出格式
#[derive(AnchorSerialize, AnchorDeserialize, Clone, Debug, PartialEq)]
pub enum AuditExportFormat {
    Json,
    Csv,
    Binary,
    Custom(String),
}

/// 保留策略
#[derive(AnchorSerialize, AnchorDeserialize, Clone, Debug)]
pub struct RetentionPolicy {
    pub audit_log_retention_days: u32,
    pub permission_history_retention_days: u32,
    pub auto_cleanup: bool,
    pub archive_to_external: bool,
    pub archive_endpoint: Option<String>,
}

/// 控制器状态
#[derive(AnchorSerialize, AnchorDeserialize, Clone, Debug, PartialEq)]
pub enum ControllerStatus {
    Active,
    Paused,
    Maintenance,
    Emergency,
    Upgrading,
}

/// 权限请求
#[derive(AnchorSerialize, AnchorDeserialize, Clone, Debug)]
pub struct PermissionRequest {
    pub requester: Pubkey,
    pub target: Pubkey,
    pub permission: Permission,
    pub context: PermissionContext,
    pub request_id: String,
}

/// 权限结果
#[derive(AnchorSerialize, AnchorDeserialize, Clone, Debug)]
pub struct PermissionResult {
    pub request_id: String,
    pub granted: bool,
    pub reason: String,
    pub applicable_rules: Vec<String>,
    pub checked_at: i64,
    pub expires_at: Option<i64>,
}

/// 访问令牌
#[derive(AnchorSerialize, AnchorDeserialize, Clone, Debug)]
pub struct AccessToken {
    pub token_id: String,
    pub issued_to: Pubkey,
    pub permissions: Vec<Permission>,
    pub scope: TokenScope,
    pub issued_at: i64,
    pub expires_at: i64,
    pub revoked: bool,
}

/// 令牌范围
#[derive(AnchorSerialize, AnchorDeserialize, Clone, Debug)]
pub struct TokenScope {
    pub resource_types: Vec<ResourceType>,
    pub specific_resources: Vec<Pubkey>,
    pub limitations: Vec<TokenLimitation>,
}

/// 令牌限制
#[derive(AnchorSerialize, AnchorDeserialize, Clone, Debug)]
pub struct TokenLimitation {
    pub limitation_type: LimitationType,
    pub value: String,
    pub description: String,
}

/// 限制类型
#[derive(AnchorSerialize, AnchorDeserialize, Clone, Debug, PartialEq)]
pub enum LimitationType {
    RateLimit,
    TimeWindow,
    ResourceCount,
    Custom(String),
}

// ==================== 实现方法 ====================

impl AccessController {
    pub const SPACE: usize = 
        8 +   // discriminator
        1 +   // bump
        32 +  // admin
        8 +   // created_at
        8 +   // last_updated
        DefaultPermissions::SPACE +
        4 +   // permission_templates (空 Vec)
        4 +   // custom_permissions (空 Vec)
        4 +   // access_level_configs (空 Vec)
        4 +   // relationship_mappings (空 Vec，需要时动态重新分配)
        4 +   // rule_sets (空 Vec)
        4 +   // policy_configs (空 Vec)
        4 +   // conditional_rules (空 Vec)
        1 +   // audit_enabled
        AuditSettings::SPACE +
        RetentionPolicy::SPACE +
        8 +   // total_checks
        8 +   // access_granted
        8 +   // access_denied
        8 +   // last_stats_update
        4 + 256 + // metadata_uri
        4 +   // custom_settings (空 Vec)
        1 +   // version
        1;    // status

    /// 初始化访问控制器
    pub fn initialize(
        &mut self,
        bump: u8,
        admin: Pubkey,
    ) -> Result<()> {
        self.bump = bump;
        self.admin = admin;
        self.created_at = Clock::get()?.unix_timestamp;
        self.last_updated = self.created_at;
        
        // 初始化默认权限
        self.default_permissions = DefaultPermissions::default();
        self.permission_templates = Vec::new();
        self.custom_permissions = Vec::new();
        
        // 初始化访问级别配置
        self.access_level_configs = Vec::new();
        self.relationship_mappings = Vec::new();
        
        // 初始化规则引擎
        self.rule_sets = Vec::new();
        self.policy_configs = Vec::new();
        self.conditional_rules = Vec::new();
        
        // 初始化审计配置
        self.audit_enabled = true;
        self.audit_settings = AuditSettings::default();
        self.retention_policy = RetentionPolicy::default();
        
        // 初始化统计
        self.total_checks = 0;
        self.access_granted = 0;
        self.access_denied = 0;
        self.last_stats_update = self.created_at;
        
        // 初始化扩展配置
        self.metadata_uri = String::new();
        self.custom_settings = Vec::new();
        self.version = 1;
        self.status = ControllerStatus::Active;
        
        Ok(())
    }

    /// 检查权限
    pub fn check_permission(
        &mut self,
        requester: &Pubkey,
        target: &Pubkey,
        permission: Permission,
        context: &PermissionContext,
    ) -> Result<bool> {
        // 更新统计
        self.total_checks = self.total_checks.saturating_add(1);
        
        // 基础权限检查逻辑
        let has_permission = self.evaluate_permission(requester, target, &permission, context)?;
        
        // 更新统计
        if has_permission {
            self.access_granted = self.access_granted.saturating_add(1);
        } else {
            self.access_denied = self.access_denied.saturating_add(1);
        }
        
        self.last_stats_update = Clock::get()?.unix_timestamp;
        
        Ok(has_permission)
    }

    /// 评估权限（内部方法）
    fn evaluate_permission(
        &self,
        requester: &Pubkey,
        target: &Pubkey,
        permission: &Permission,
        context: &PermissionContext,
    ) -> Result<bool> {
        // 1. 检查是否是资源所有者
        if requester == target {
            return Ok(true);
        }
        
        // 2. 检查默认权限
        if self.default_permissions.public_permissions.contains(permission) {
            return Ok(true);
        }
        
        // 3. 检查规则集
        for rule_set in &self.rule_sets {
            if !rule_set.enabled {
                continue;
            }
            
            for rule in &rule_set.rules {
                if rule.permission == *permission && rule.enabled {
                    if self.evaluate_rule(rule, requester, target, context)? {
                        return Ok(true);
                    }
                }
            }
        }
        
        // 4. 检查关系映射
        // 这里需要通过 CPI 调用 Identity Registry 获取关系信息
        // 简化实现：默认拒绝
        
        Ok(false)
    }

    /// 评估单个规则
    fn evaluate_rule(
        &self,
        rule: &AccessRule,
        requester: &Pubkey,
        target: &Pubkey,
        context: &PermissionContext,
    ) -> Result<bool> {
        // 检查是否在例外列表中
        if rule.exceptions.contains(requester) {
            return Ok(false);
        }
        
        // 检查规则是否过期
        if let Some(expires_at) = rule.expires_at {
            if Clock::get()?.unix_timestamp > expires_at {
                return Ok(false);
            }
        }
        
        // 检查访问级别
        let meets_access_level = self.check_access_level(&rule.access_level, requester, target)?;
        if !meets_access_level {
            return Ok(false);
        }
        
        // 检查附加条件
        if let Some(conditions) = &rule.conditions {
            return self.evaluate_conditions(conditions, requester, context);
        }
        
        Ok(true)
    }

    /// 检查访问级别
    fn check_access_level(
        &self,
        access_level: &AccessLevel,
        requester: &Pubkey,
        target: &Pubkey,
    ) -> Result<bool> {
        match access_level {
            AccessLevel::Public => Ok(true),
            AccessLevel::Private => Ok(requester == target),
            AccessLevel::Followers => self.check_relationship_access(RelationshipType::Follower, requester, target),
            AccessLevel::Friends => self.check_relationship_access(RelationshipType::Friend, requester, target),
            AccessLevel::Custom => self.check_custom_access(requester, target),
        }
    }

    fn check_relationship_access(
        &self,
        _relationship_type: RelationshipType,
        requester: &Pubkey,
        target: &Pubkey,
    ) -> Result<bool> {
        if requester == target {
            return Ok(true);
        }

        // 仅有 controller 配置不足以证明 requester 与 target 之间真实存在链上关系。
        // 在接入明确的关系事实源前，这里必须保守拒绝，避免把配置误当作授权。
        Ok(false)
    }

    fn check_custom_access(
        &self,
        requester: &Pubkey,
        target: &Pubkey,
    ) -> Result<bool> {
        if requester == target {
            return Ok(true);
        }

        // 自定义 audience 目前没有额外证明输入；规则存在并不等价于 requester 在名单中。
        Ok(false)
    }

    /// 评估条件
    fn evaluate_conditions(
        &self,
        conditions: &Conditions,
        requester: &Pubkey,
        context: &PermissionContext,
    ) -> Result<bool> {
        // 检查声誉门槛
        if let Some(threshold) = conditions.reputation_threshold {
            // 需要通过 CPI 获取用户声誉
            // 简化实现：假设满足条件
        }
        
        // 检查时间限制
        if let Some(time_window) = &conditions.time_restrictions {
            let current_time = Clock::get()?.unix_timestamp;
            if current_time < time_window.start_time || current_time > time_window.end_time {
                return Ok(false);
            }
        }
        
        // 检查自定义条件
        for custom_condition in &conditions.custom_conditions {
            if !self.evaluate_custom_condition(custom_condition, context)? {
                return Ok(false);
            }
        }
        
        Ok(true)
    }

    /// 评估自定义条件
    fn evaluate_custom_condition(
        &self,
        condition: &CustomCondition,
        context: &PermissionContext,
    ) -> Result<bool> {
        // 简化实现：根据条件类型进行基本检查
        match condition.condition_type.as_str() {
            "source_check" => {
                match condition.operator {
                    ConditionOperator::Equal => Ok(context.source == condition.value),
                    ConditionOperator::NotEqual => Ok(context.source != condition.value),
                    ConditionOperator::Contains => Ok(context.source.contains(&condition.value)),
                    _ => Ok(true),
                }
            },
            _ => Ok(true), // 未知条件类型默认通过
        }
    }

    /// 添加规则集
    pub fn add_rule_set(&mut self, rule_set: RuleSet) -> Result<()> {
        self.rule_sets.push(rule_set);
        self.last_updated = Clock::get()?.unix_timestamp;
        Ok(())
    }

    /// 更新统计信息
    pub fn update_stats(&mut self, granted: bool) -> Result<()> {
        self.total_checks = self.total_checks.saturating_add(1);
        
        if granted {
            self.access_granted = self.access_granted.saturating_add(1);
        } else {
            self.access_denied = self.access_denied.saturating_add(1);
        }
        
        self.last_stats_update = Clock::get()?.unix_timestamp;
        Ok(())
    }
    
    /// 计算账户所需空间（用于动态 realloc）
    /// 使用实际序列化大小而不是最大预估值
    pub fn get_size(&self) -> usize {
        // 使用 borsh 序列化来计算实际大小
        match self.try_to_vec() {
            Ok(data) => 8 + data.len(), // 8 bytes discriminator + actual data
            Err(_) => {
                // 降级方案：使用保守估算
                8 + 1 + 32 + 8 + 8 + 
                DefaultPermissions::SPACE +
                (4 + self.permission_templates.len() * 100) +
                (4 + self.custom_permissions.len() * 100) +
                (4 + self.access_level_configs.len() * 100) +
                (4 + self.relationship_mappings.len() * 50) + // 实际每个约 20-50 字节
                (4 + self.rule_sets.len() * 200) +
                (4 + self.policy_configs.len() * 100) +
                (4 + self.conditional_rules.len() * 100) +
                1 + AuditSettings::SPACE + RetentionPolicy::SPACE +
                8 + 8 + 8 + 8 +
                (4 + 256) +
                (4 + self.custom_settings.len() * 100) +
                1 + 1
            }
        }
    }
    
    /// 计算添加一个新 RelationshipMapping 后的空间
    /// 使用实际需要的空间，而不是最大预估值
    pub fn get_size_with_new_mapping(&self) -> usize {
        // 一个典型的 RelationshipMapping 实际大小：
        // 1 (relationship_type) + 1 (access_level) + 
        // 4 + 2*1 (permissions vec with 2 items) + 
        // 1 (auto_grant) + 1 (conditions = None)
        // = 约 10 字节
        const TYPICAL_MAPPING_SIZE: usize = 20; // 保守估计 20 字节
        
        self.get_size() + TYPICAL_MAPPING_SIZE
    }
}

impl FollowRelationship {
    pub const SPACE: usize =
        8 +  // discriminator
        1 +  // bump
        32 + // follower
        32 + // followed
        8;   // created_at

    pub fn initialize(
        &mut self,
        bump: u8,
        follower: Pubkey,
        followed: Pubkey,
    ) -> Result<()> {
        self.bump = bump;
        self.follower = follower;
        self.followed = followed;
        self.created_at = Clock::get()?.unix_timestamp;
        Ok(())
    }
}

// ==================== 空间计算实现 ====================

impl DefaultPermissions {
    pub const SPACE: usize = 
        4 + 10 * 1 + // new_user_permissions
        4 + 10 * 1 + // public_permissions
        4 + 10 * 1 + // follower_permissions
        4 + 10 * 1 + // friend_permissions
        4 + 10 * 1;  // community_permissions
}

impl PermissionTemplate {
    pub const SPACE: usize = 
        4 + 64 +     // template_id
        4 + 128 +    // template_name
        4 + 256 +    // description
        4 + 20 * 1 + // permissions
        4 + 10 * 1 + // access_levels
        4 + 10 * AccessRule::SPACE + // default_rules
        8 +          // created_at
        32;          // created_by
}

impl CustomPermission {
    pub const SPACE: usize = 
        4 + 64 +     // permission_id
        4 + 128 +    // permission_name
        4 + 256 +    // description
        4 + 10 * 1 + // resource_types
        4 + 10 * (4 + 64) + // operations
        8 +          // created_at
        32;          // created_by
}

impl AccessLevelConfig {
    pub const SPACE: usize = 
        1 +          // level
        4 + 256 +    // description
        4 + 20 * 1 + // default_permissions
        4 + 10 * AccessRestriction::SPACE + // restrictions
        4 + 5 * InheritanceRule::SPACE;     // inheritance_rules
}

impl AccessRestriction {
    pub const SPACE: usize = 
        1 +       // restriction_type
        4 + 128 + // value
        1;        // enabled
}

impl InheritanceRule {
    pub const SPACE: usize = 
        1 +          // from_level
        1 +          // to_level
        4 + 10 * 1 + // inherited_permissions
        1 + Conditions::SPACE; // conditions (Option)
}

impl RelationshipMapping {
    pub const SPACE: usize = 
        1 +          // relationship_type
        1 +          // access_level
        4 + 10 * 1 + // permissions
        1 +          // auto_grant
        1 + Conditions::SPACE; // conditions (Option)
}

impl RuleSet {
    pub const SPACE: usize = 
        4 + 64 +     // rule_set_id
        4 + 128 +    // rule_set_name
        4 + 50 * AccessRule::SPACE + // rules
        1 +          // enabled
        1 +          // priority
        8 +          // created_at
        8;           // updated_at
}

impl PolicyConfig {
    pub const SPACE: usize = 
        4 + 64 +     // policy_id
        4 + 128 +    // policy_name
        4 + 256 +    // description
        4 + 10 * 1 + // target_resources
        1 +          // enforcement_level
        4 + 20 * PolicyRule::SPACE +     // rules
        4 + 10 * PolicyException::SPACE; // exceptions
}

impl PolicyRule {
    pub const SPACE: usize = 
        1 +          // rule_type
        Conditions::SPACE +
        1 +          // action
        1;           // severity
}

impl PolicyException {
    pub const SPACE: usize = 
        1 +       // exception_type
        32 +      // target
        4 + 256 + // reason
        9;        // expires_at (Option<i64>)
}

impl ConditionalRule {
    pub const SPACE: usize = 
        4 + 64 +     // rule_id
        Conditions::SPACE +
        4 + 20 * 1 + // then_permissions
        4 + 20 * 1 + // else_permissions
        1;           // evaluation_order
}

impl AuditSettings {
    pub const SPACE: usize = 
        1 +   // log_all_checks
        1 +   // log_denied_access
        1 +   // log_permission_changes
        1 +   // log_policy_violations
        1 +   // detailed_logging
        4 +   // retention_days
        1;    // export_format
}

impl RetentionPolicy {
    pub const SPACE: usize = 
        4 +       // audit_log_retention_days
        4 +       // permission_history_retention_days
        1 +       // auto_cleanup
        1 +       // archive_to_external
        4 + 256 + 1; // archive_endpoint (Option<String>)
}

impl Conditions {
    pub const SPACE: usize = 
        9 +       // reputation_threshold (Option<f64>)
        1 + TimeWindow::SPACE + // time_restrictions (Option)
        4 + 10 * (4 + 64) + 1 + // location_restrictions (Option<Vec<String>>)
        4 + 10 * (4 + 64) + 1 + // device_restrictions (Option<Vec<String>>)
        4 + 20 * CustomCondition::SPACE; // custom_conditions
}

impl TimeWindow {
    pub const SPACE: usize = 
        8 +       // start_time
        8 +       // end_time
        4 + 7 * 1 + 1 + // days_of_week (Option<Vec<u8>>)
        4 + 24 * 1 + 1 + // hours_of_day (Option<Vec<u8>>)
        4 + 32 + 1;     // timezone (Option<String>)
}

impl CustomCondition {
    pub const SPACE: usize = 
        4 + 64 +  // condition_type
        1 +       // operator
        4 + 256 + // value
        4 + 256 + 1; // description (Option<String>)
}

impl AccessRule {
    pub const SPACE: usize = 
        4 + 64 +  // rule_id
        1 +       // permission
        1 +       // access_level
        1 + Conditions::SPACE + // conditions (Option)
        4 + 20 * 32 + // exceptions
        1 +       // priority
        1 +       // enabled
        8 +       // created_at
        9;        // expires_at (Option<i64>)
}

// ==================== 默认实现 ====================

impl Default for DefaultPermissions {
    fn default() -> Self {
        Self {
            new_user_permissions: vec![
                Permission::ViewProfile,
                Permission::ViewContent,
                Permission::LikeContent,
            ],
            public_permissions: vec![
                Permission::ViewProfile,
                Permission::ViewContent,
            ],
            follower_permissions: vec![
                Permission::ViewProfile,
                Permission::ViewContent,
                Permission::LikeContent,
                Permission::CommentContent,
                Permission::ShareContent,
            ],
            friend_permissions: vec![
                Permission::ViewProfile,
                Permission::ViewContent,
                Permission::ViewFollowers,
                Permission::ViewFollowing,
                Permission::LikeContent,
                Permission::CommentContent,
                Permission::ShareContent,
                Permission::MessageUser,
            ],
            community_permissions: vec![
                Permission::ViewProfile,
                Permission::ViewContent,
                Permission::LikeContent,
                Permission::CommentContent,
            ],
        }
    }
}

impl Default for AuditSettings {
    fn default() -> Self {
        Self {
            log_all_checks: false,
            log_denied_access: true,
            log_permission_changes: true,
            log_policy_violations: true,
            detailed_logging: false,
            retention_days: crate::constants::AUDIT_LOG_RETENTION_DAYS as u32,
            export_format: AuditExportFormat::Json,
        }
    }
}

impl Default for RetentionPolicy {
    fn default() -> Self {
        Self {
            audit_log_retention_days: crate::constants::AUDIT_LOG_RETENTION_DAYS as u32,
            permission_history_retention_days: 180,
            auto_cleanup: true,
            archive_to_external: false,
            archive_endpoint: None,
        }
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    fn test_controller() -> AccessController {
        AccessController {
            bump: 0,
            admin: Pubkey::new_unique(),
            created_at: 0,
            last_updated: 0,
            default_permissions: DefaultPermissions {
                new_user_permissions: Vec::new(),
                public_permissions: Vec::new(),
                follower_permissions: Vec::new(),
                friend_permissions: Vec::new(),
                community_permissions: Vec::new(),
            },
            permission_templates: Vec::new(),
            custom_permissions: Vec::new(),
            access_level_configs: Vec::new(),
            relationship_mappings: vec![RelationshipMapping {
                relationship_type: RelationshipType::Follower,
                access_level: AccessLevel::Followers,
                permissions: vec![Permission::ViewContent],
                auto_grant: true,
                conditions: None,
            }],
            rule_sets: vec![RuleSet {
                rule_set_id: "followers-view".to_string(),
                rule_set_name: "followers-view".to_string(),
                rules: vec![
                    AccessRule {
                        rule_id: "followers-rule".to_string(),
                        permission: Permission::ViewContent,
                        access_level: AccessLevel::Followers,
                        conditions: None,
                        exceptions: Vec::new(),
                        priority: 1,
                        enabled: true,
                        created_at: 0,
                        expires_at: None,
                    },
                    AccessRule {
                        rule_id: "custom-rule".to_string(),
                        permission: Permission::ViewContent,
                        access_level: AccessLevel::Custom,
                        conditions: None,
                        exceptions: Vec::new(),
                        priority: 1,
                        enabled: true,
                        created_at: 0,
                        expires_at: None,
                    },
                ],
                enabled: true,
                priority: 1,
                created_at: 0,
                updated_at: 0,
            }],
            policy_configs: Vec::new(),
            conditional_rules: Vec::new(),
            audit_enabled: true,
            audit_settings: AuditSettings::default(),
            retention_policy: RetentionPolicy::default(),
            total_checks: 0,
            access_granted: 0,
            access_denied: 0,
            last_stats_update: 0,
            metadata_uri: String::new(),
            custom_settings: Vec::new(),
            version: 1,
            status: ControllerStatus::Active,
        }
    }

    #[test]
    fn relationship_access_requires_fact_proof_beyond_configuration() {
        let controller = test_controller();
        let requester = Pubkey::new_unique();
        let target = Pubkey::new_unique();

        let allowed = controller
            .check_relationship_access(RelationshipType::Follower, &requester, &target)
            .unwrap();

        assert!(
            !allowed,
            "controller configuration alone must not grant follower access without relationship proof"
        );
    }

    #[test]
    fn custom_access_requires_fact_proof_beyond_rule_presence() {
        let controller = test_controller();
        let requester = Pubkey::new_unique();
        let target = Pubkey::new_unique();

        let allowed = controller.check_custom_access(&requester, &target).unwrap();

        assert!(
            !allowed,
            "custom access rules must not grant access without explicit audience proof"
        );
    }
}
