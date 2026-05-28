use anchor_lang::prelude::*;

pub mod errors;
pub mod state;
pub mod instructions;

pub use instructions::*;
pub use state::*;
pub use errors::*;

declare_id!("2Nu27qEettMe6v1uqb1Gz2LB38pfEM8u4ioVKA8xkWd8");

#[program]
pub mod contribution_engine {
    use super::*;

    // ==================== 引擎管理 ====================

    /// 初始化 Contribution Engine 全局配置
    pub fn initialize_engine(
        ctx: Context<InitializeEngine>,
        max_entries_per_crystal: u16,
        min_weight: f64,
    ) -> Result<()> {
        instructions::initialize::initialize_engine(ctx, max_entries_per_crystal, min_weight)
    }

    /// 更新评分配置（仅 admin）
    pub fn update_config(
        ctx: Context<UpdateConfig>,
        max_entries_per_crystal: Option<u16>,
        min_weight: Option<f64>,
        role_weights: Option<[f64; 4]>,
    ) -> Result<()> {
        instructions::initialize::update_config(ctx, max_entries_per_crystal, min_weight, role_weights)
    }

    // ==================== 账本管理 ====================

    /// 创建贡献账本（每个 Crystal 一个）
    pub fn create_ledger(
        ctx: Context<CreateLedger>,
        crystal_id: Pubkey,
    ) -> Result<()> {
        instructions::ledger::create_ledger(ctx, crystal_id)
    }

    /// 关闭账本（贡献登记完成后）
    pub fn close_ledger(ctx: Context<CloseLedger>) -> Result<()> {
        instructions::ledger::close_ledger(ctx)
    }

    // ==================== 贡献记录 ====================

    /// 记录单条贡献
    pub fn record_contribution(
        ctx: Context<RecordContribution>,
        role: ContributionRole,
        weight: f64,
    ) -> Result<()> {
        instructions::record::record_contribution(ctx, role, weight)
    }

    /// 更新贡献分数（仅 admin）
    pub fn update_contribution_score(
        ctx: Context<UpdateContributionScore>,
        new_weight: f64,
    ) -> Result<()> {
        instructions::record::update_contribution_score(ctx, new_weight)
    }

    // ==================== 引用管理 ====================

    /// 添加内容引用关系
    pub fn add_reference(
        ctx: Context<AddReference>,
        ref_type: ReferenceType,
    ) -> Result<()> {
        instructions::reference::add_reference(ctx, ref_type)
    }

    // ==================== 声誉结算 ====================

    /// CPI 结算声誉 → identity-registry
    pub fn settle_reputation(
        ctx: Context<SettleReputation>,
        authority_score: f64,
    ) -> Result<()> {
        instructions::settle::settle_reputation(ctx, authority_score)
    }

    // ==================== 查询 ====================

    /// 查询贡献详情
    pub fn query_contribution(
        ctx: Context<QueryContribution>,
    ) -> Result<ContributionDetail> {
        instructions::query::query_contribution(ctx)
    }

    /// 查询账本摘要
    pub fn query_ledger_summary(
        ctx: Context<QueryLedgerSummary>,
    ) -> Result<LedgerSummary> {
        instructions::query::query_ledger_summary(ctx)
    }
}
