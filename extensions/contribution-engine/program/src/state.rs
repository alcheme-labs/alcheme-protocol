use anchor_lang::prelude::*;

// ==================== 贡献角色 ====================

/// 贡献角色 — 对应 VFS §3.3 的四种角色
/// 同一 Crystal 所有角色权重之和 = 1.0
#[derive(AnchorSerialize, AnchorDeserialize, Clone, Debug, PartialEq)]
pub enum ContributionRole {
    /// 直接编写/修改了内容 — 默认权重 0.50
    Author,
    /// 发起导致结晶的讨论 — 默认权重 0.25
    Discussant,
    /// 验证了正确性 — 默认权重 0.20
    Reviewer,
    /// 旧晶体被新晶体引用 — 默认权重 0.05
    Cited,
}

impl ContributionRole {
    /// 获取角色的默认权重比例
    pub fn default_weight_ratio(&self) -> f64 {
        match self {
            ContributionRole::Author => 0.50,
            ContributionRole::Discussant => 0.25,
            ContributionRole::Reviewer => 0.20,
            ContributionRole::Cited => 0.05,
        }
    }
}

// ==================== 引用类型 ====================

/// 引用类型 — 对应 VFS §3.2
/// 影响 Authority PageRank 计算
#[derive(AnchorSerialize, AnchorDeserialize, Clone, Debug, PartialEq)]
pub enum ReferenceType {
    /// 硬依赖：直接使用内容 — 权重 1.0
    Import,
    /// 软引用：参考结论 — 权重 0.5
    Citation,
    /// 提及：链接到相关内容 — 权重 0.1
    Mention,
    /// Fork 来源：不参与贡献计算 — 权重 0.0
    ForkOrigin,
}

impl ReferenceType {
    /// 获取引用类型的权重
    pub fn weight(&self) -> f64 {
        match self {
            ReferenceType::Import => 1.0,
            ReferenceType::Citation => 0.5,
            ReferenceType::Mention => 0.1,
            ReferenceType::ForkOrigin => 0.0,
        }
    }
}

// ==================== 账户结构 ====================

/// 全局配置 — 引擎初始化时创建
/// PDA: [b"config"]
#[account]
pub struct ContributionConfig {
    pub bump: u8,
    /// 管理员（可更新配置、触发结算）
    pub admin: Pubkey,
    /// 每个 Crystal 最大贡献条目数
    pub max_entries_per_crystal: u16,
    /// 最小有效权重 (低于此值的贡献不记录)
    pub min_weight: f64,
    /// 角色默认权重配置 [author, discussant, reviewer, cited]
    pub role_weights: [f64; 4],
    /// 创建时间
    pub created_at: i64,
    /// 最后更新时间
    pub last_updated: i64,
    /// 已记录的账本总数
    pub total_ledgers: u64,
    /// 已记录的引用总数
    pub total_references: u64,
}

impl ContributionConfig {
    pub const SPACE: usize =
        8 +   // discriminator
        1 +   // bump
        32 +  // admin
        2 +   // max_entries_per_crystal
        8 +   // min_weight (f64)
        32 +  // role_weights (4 × f64)
        8 +   // created_at
        8 +   // last_updated
        8 +   // total_ledgers
        8;    // total_references

    /// 获取指定角色的配置权重
    pub fn get_role_weight(&self, role: &ContributionRole) -> f64 {
        match role {
            ContributionRole::Author => self.role_weights[0],
            ContributionRole::Discussant => self.role_weights[1],
            ContributionRole::Reviewer => self.role_weights[2],
            ContributionRole::Cited => self.role_weights[3],
        }
    }
}

/// 贡献账本 — 每个 Crystal 一个
/// PDA: [b"ledger", crystal_id]
#[account]
pub struct ContributionLedger {
    pub bump: u8,
    /// 对应的 Crystal 内容 ID
    pub crystal_id: Pubkey,
    /// 贡献者总数
    pub total_contributors: u16,
    /// 是否已关闭 (关闭后不可添加新贡献)
    pub closed: bool,
    /// 总权重校验 (应接近 1.0)
    pub total_weight: f64,
    /// 创建时间
    pub created_at: i64,
    /// 最后更新时间
    pub last_updated: i64,
    /// 是否已结算声誉
    pub reputation_settled: bool,
}

impl ContributionLedger {
    pub const SPACE: usize =
        8 +   // discriminator
        1 +   // bump
        32 +  // crystal_id
        2 +   // total_contributors
        1 +   // closed
        8 +   // total_weight
        8 +   // created_at
        8 +   // last_updated
        1;    // reputation_settled
}

/// 贡献条目 — 单条贡献记录
/// PDA: [b"entry", crystal_id, contributor]
#[account]
pub struct ContributionEntry {
    pub bump: u8,
    /// 对应的 Crystal ID
    pub crystal_id: Pubkey,
    /// 贡献者
    pub contributor: Pubkey,
    /// 贡献角色
    pub role: ContributionRole,
    /// 权重 (0.0 ~ 1.0 内的实际分配值)
    pub weight: f64,
    /// 记录时间
    pub recorded_at: i64,
}

impl ContributionEntry {
    pub const SPACE: usize =
        8 +   // discriminator
        1 +   // bump
        32 +  // crystal_id
        32 +  // contributor
        1 +   // role (enum, 1 byte)
        8 +   // weight
        8;    // recorded_at
}

/// 引用关系 — 内容间的引用
/// PDA: [b"ref", source_id, target_id]
#[account]
pub struct Reference {
    pub bump: u8,
    /// 引用发起方（新内容）
    pub source_id: Pubkey,
    /// 被引用方（旧内容）
    pub target_id: Pubkey,
    /// 引用类型
    pub ref_type: ReferenceType,
    /// 引用权重 (由 ref_type 决定)
    pub weight: f64,
    /// 创建者
    pub creator: Pubkey,
    /// 创建时间
    pub created_at: i64,
}

impl Reference {
    pub const SPACE: usize =
        8 +   // discriminator
        1 +   // bump
        32 +  // source_id
        32 +  // target_id
        1 +   // ref_type (enum, 1 byte)
        8 +   // weight  
        32 +  // creator
        8;    // created_at
}
