use anchor_lang::prelude::*;
use alcheme_shared::*;

/// Access Controller 专用验证器
pub struct AccessValidator;

impl AccessValidator {
    /// 验证访问规则
    pub fn validate_access_rule(rule: &AccessRule) -> Result<()> {
        // 验证规则ID
        require!(
            !rule.rule_id.is_empty() && rule.rule_id.len() <= 64,
            AlchemeError::InvalidOperation
        );
        
        // 验证优先级
        require!(
            rule.priority <= 100,
            AlchemeError::InvalidOperation
        );
        
        // 验证过期时间
        if let Some(expires_at) = rule.expires_at {
            let current_time = Clock::get()?.unix_timestamp;
            require!(
                expires_at > current_time,
                AlchemeError::InvalidTimestamp
            );
        }
        
        // 验证条件
        if let Some(conditions) = &rule.conditions {
            Self::validate_conditions(conditions)?;
        }
        
        // 验证例外列表大小
        require!(
            rule.exceptions.len() <= MAX_ACCESS_RULES_PER_USER,
            AlchemeError::PermissionRuleConflict
        );
        
        Ok(())
    }

    /// 验证条件
    pub fn validate_conditions(conditions: &Conditions) -> Result<()> {
        // 验证声誉门槛
        if let Some(threshold) = conditions.reputation_threshold {
            ValidationUtils::validate_reputation_score(threshold)?;
        }
        
        // 验证时间窗口
        if let Some(time_window) = &conditions.time_restrictions {
            Self::validate_time_window(time_window)?;
        }
        
        // 验证地理限制
        if let Some(locations) = &conditions.location_restrictions {
            require!(
                locations.len() <= 50,
                AlchemeError::InvalidOperation
            );
        }
        
        // 验证设备限制
        if let Some(devices) = &conditions.device_restrictions {
            require!(
                devices.len() <= 20,
                AlchemeError::InvalidOperation
            );
        }
        
        // 验证自定义条件
        require!(
            conditions.custom_conditions.len() <= MAX_RULE_CONDITIONS,
            AlchemeError::PermissionRuleConflict
        );
        
        for custom_condition in &conditions.custom_conditions {
            Self::validate_custom_condition(custom_condition)?;
        }
        
        Ok(())
    }

    /// 验证时间窗口
    pub fn validate_time_window(time_window: &TimeWindow) -> Result<()> {
        // 验证时间范围
        require!(
            time_window.end_time > time_window.start_time,
            AlchemeError::InvalidTimestamp
        );
        
        // 验证星期限制
        if let Some(days) = &time_window.days_of_week {
            for day in days {
                require!(*day <= 6, AlchemeError::InvalidOperation);
            }
        }
        
        // 验证小时限制
        if let Some(hours) = &time_window.hours_of_day {
            for hour in hours {
                require!(*hour <= 23, AlchemeError::InvalidOperation);
            }
        }
        
        Ok(())
    }

    /// 验证自定义条件
    pub fn validate_custom_condition(condition: &CustomCondition) -> Result<()> {
        // 验证条件类型
        require!(
            !condition.condition_type.is_empty() && condition.condition_type.len() <= 64,
            AlchemeError::InvalidOperation
        );
        
        // 验证条件值
        require!(
            !condition.value.is_empty() && condition.value.len() <= 256,
            AlchemeError::InvalidOperation
        );
        
        // 验证描述长度
        if let Some(description) = &condition.description {
            require!(
                description.len() <= 256,
                AlchemeError::InvalidOperation
            );
        }
        
        Ok(())
    }

    /// 验证权限模板
    pub fn validate_permission_template(template: &PermissionTemplate) -> Result<()> {
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
        
        // 验证描述长度
        require!(
            template.description.len() <= 256,
            AlchemeError::InvalidOperation
        );
        
        // 验证权限数量
        require!(
            template.permissions.len() <= 50,
            AlchemeError::InvalidOperation
        );
        
        // 验证访问级别数量
        require!(
            template.access_levels.len() <= 10,
            AlchemeError::InvalidOperation
        );
        
        // 验证默认规则
        require!(
            template.default_rules.len() <= 20,
            AlchemeError::InvalidOperation
        );
        
        for rule in &template.default_rules {
            Self::validate_access_rule(rule)?;
        }
        
        Ok(())
    }

    /// 验证权限请求
    pub fn validate_permission_request(request: &PermissionRequest) -> Result<()> {
        // 验证请求ID
        require!(
            !request.request_id.is_empty() && request.request_id.len() <= 64,
            AlchemeError::InvalidOperation
        );
        
        // 验证权限上下文
        Self::validate_permission_context(&request.context)?;
        
        Ok(())
    }

    /// 验证权限上下文
    pub fn validate_permission_context(context: &PermissionContext) -> Result<()> {
        // 验证时间戳
        ValidationUtils::validate_timestamp(context.timestamp)?;
        
        // 验证来源
        require!(
            !context.source.is_empty() && context.source.len() <= 128,
            AlchemeError::InvalidOperation
        );
        
        // 验证附加数据
        require!(
            context.additional_data.len() <= 20,
            AlchemeError::InvalidOperation
        );
        
        Ok(())
    }

    /// 验证访问令牌
    pub fn validate_access_token(token: &AccessToken) -> Result<()> {
        // 验证令牌ID
        require!(
            !token.token_id.is_empty() && token.token_id.len() <= 64,
            AlchemeError::InvalidOperation
        );
        
        // 验证时间戳
        require!(
            token.expires_at > token.issued_at,
            AlchemeError::InvalidTimestamp
        );
        
        // 验证权限数量
        require!(
            token.permissions.len() <= 20,
            AlchemeError::InvalidOperation
        );
        
        // 验证令牌范围
        Self::validate_token_scope(&token.scope)?;
        
        Ok(())
    }

    /// 验证令牌范围
    pub fn validate_token_scope(scope: &TokenScope) -> Result<()> {
        // 验证资源类型数量
        require!(
            scope.resource_types.len() <= 10,
            AlchemeError::InvalidOperation
        );
        
        // 验证特定资源数量
        require!(
            scope.specific_resources.len() <= 100,
            AlchemeError::InvalidOperation
        );
        
        // 验证限制数量
        require!(
            scope.limitations.len() <= 10,
            AlchemeError::InvalidOperation
        );
        
        Ok(())
    }

    /// 验证关系类型
    pub fn validate_relationship_type(relationship_type: &RelationshipType) -> Result<()> {
        // 基础验证：所有预定义的关系类型都是有效的
        match relationship_type {
            RelationshipType::None |
            RelationshipType::Follower |
            RelationshipType::Following |
            RelationshipType::Friend |
            RelationshipType::Blocked |
            RelationshipType::Muted |
            RelationshipType::Moderator |
            RelationshipType::Admin => Ok(()),
        }
    }

    /// 验证批量操作大小
    pub fn validate_batch_size(size: usize, operation_type: &str) -> Result<()> {
        let max_size = match operation_type {
            "permission_check" => MAX_BATCH_PERMISSION_CHECKS,
            "rule_update" => MAX_ACCESS_RULES_PER_USER,
            "relationship_update" => 50, // 自定义限制
            _ => MAX_BATCH_SIZE,
        };
        
        require!(
            size <= max_size,
            AlchemeError::BatchPermissionCheckFailed
        );
        
        Ok(())
    }
}

/// Access Controller 分布式验证实现
pub struct AccessValidationModule;

impl AccessValidationModule {
    /// 执行权限规则验证
    pub fn validate_permission_rule_creation(
        rule: &AccessRule,
        user: &Pubkey,
    ) -> Result<ValidationResult> {
        let mut score = 100.0;
        let mut messages = Vec::new();
        
        // 验证规则复杂度
        if let Some(conditions) = &rule.conditions {
            let complexity_score = Self::calculate_rule_complexity(conditions);
            if complexity_score > 80.0 {
                score -= 20.0;
                messages.push("Rule complexity is high".to_string());
            }
        }
        
        // 验证权限级别合理性
        let permission_level = crate::state::PermissionUtils::get_permission_level(&rule.permission);
        if permission_level > 4 && rule.access_level == AccessLevel::Public {
            score -= 30.0;
            messages.push("High-level permission with public access".to_string());
        }
        
        // 验证例外列表大小
        if rule.exceptions.len() > 50 {
            score -= 15.0;
            messages.push("Too many exceptions".to_string());
        }
        
        let success = score >= 70.0;
        let message = if messages.is_empty() {
            "Permission rule validation passed".to_string()
        } else {
            messages.join("; ")
        };
        
        Ok(ValidationResult {
            success,
            score,
            message,
            validator_id: "permission_rule".to_string(),
            timestamp: Clock::get()?.unix_timestamp,
        })
    }

    /// 计算规则复杂度
    fn calculate_rule_complexity(conditions: &Conditions) -> f64 {
        let mut complexity = 0.0;
        
        if conditions.reputation_threshold.is_some() {
            complexity += 10.0;
        }
        
        if conditions.time_restrictions.is_some() {
            complexity += 15.0;
        }
        
        if let Some(locations) = &conditions.location_restrictions {
            complexity += locations.len() as f64 * 2.0;
        }
        
        if let Some(devices) = &conditions.device_restrictions {
            complexity += devices.len() as f64 * 3.0;
        }
        
        complexity += conditions.custom_conditions.len() as f64 * 5.0;
        
        complexity
    }

    /// 执行权限检查验证
    pub fn validate_permission_check(
        requester: &Pubkey,
        target: &Pubkey,
        permission: &Permission,
        context: &PermissionContext,
    ) -> Result<ValidationResult> {
        let mut score = 100.0;
        let mut messages = Vec::new();
        
        // 验证请求者和目标
        if requester == target {
            score = 100.0; // 自己访问自己的资源总是允许的
        } else {
            // 验证权限上下文
            if context.timestamp == 0 {
                score -= 20.0;
                messages.push("Invalid timestamp in context".to_string());
            }
            
            if context.source.is_empty() {
                score -= 10.0;
                messages.push("Missing source information".to_string());
            }
        }
        
        let success = score >= 70.0;
        let message = if messages.is_empty() {
            "Permission check validation passed".to_string()
        } else {
            messages.join("; ")
        };
        
        Ok(ValidationResult {
            success,
            score,
            message,
            validator_id: "permission_check".to_string(),
            timestamp: Clock::get()?.unix_timestamp,
        })
    }

    /// 执行策略合规性验证
    pub fn validate_policy_compliance(
        policy: &PolicyConfig,
        action: &PolicyAction,
    ) -> Result<ValidationResult> {
        let mut score = 100.0;
        let mut messages = Vec::new();
        
        // 检查策略执行级别
        match policy.enforcement_level {
            EnforcementLevel::Strict => {
                if *action == PolicyAction::Allow {
                    score -= 50.0;
                    messages.push("Strict policy should not allow by default".to_string());
                }
            },
            EnforcementLevel::Advisory => {
                if *action == PolicyAction::Deny {
                    score -= 20.0;
                    messages.push("Advisory policy should not deny access".to_string());
                }
            },
            _ => {},
        }
        
        let success = score >= 60.0; // 策略验证的门槛较低
        let message = if messages.is_empty() {
            "Policy compliance validation passed".to_string()
        } else {
            messages.join("; ")
        };
        
        Ok(ValidationResult {
            success,
            score,
            message,
            validator_id: "policy_compliance".to_string(),
            timestamp: Clock::get()?.unix_timestamp,
        })
    }
}
