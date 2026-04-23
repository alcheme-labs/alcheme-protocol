use anchor_lang::prelude::*;
use crate::state::*;

/// 查询贡献者在某 Crystal 中的贡献
/// 只读指令，返回贡献详情
pub fn query_contribution(
    ctx: Context<QueryContribution>,
) -> Result<ContributionDetail> {
    let entry = &ctx.accounts.entry;
    let ledger = &ctx.accounts.ledger;

    Ok(ContributionDetail {
        crystal_id: entry.crystal_id,
        contributor: entry.contributor,
        role: entry.role.clone(),
        weight: entry.weight,
        recorded_at: entry.recorded_at,
        ledger_closed: ledger.closed,
        total_contributors: ledger.total_contributors,
        total_weight: ledger.total_weight,
        reputation_settled: ledger.reputation_settled,
    })
}

/// 查询某 Crystal 的账本摘要
pub fn query_ledger_summary(
    ctx: Context<QueryLedgerSummary>,
) -> Result<LedgerSummary> {
    let ledger = &ctx.accounts.ledger;

    Ok(LedgerSummary {
        crystal_id: ledger.crystal_id,
        total_contributors: ledger.total_contributors,
        total_weight: ledger.total_weight,
        closed: ledger.closed,
        reputation_settled: ledger.reputation_settled,
        created_at: ledger.created_at,
        last_updated: ledger.last_updated,
    })
}

// ==================== 返回类型 ====================

#[derive(AnchorSerialize, AnchorDeserialize, Clone, Debug)]
pub struct ContributionDetail {
    pub crystal_id: Pubkey,
    pub contributor: Pubkey,
    pub role: ContributionRole,
    pub weight: f64,
    pub recorded_at: i64,
    pub ledger_closed: bool,
    pub total_contributors: u16,
    pub total_weight: f64,
    pub reputation_settled: bool,
}

#[derive(AnchorSerialize, AnchorDeserialize, Clone, Debug)]
pub struct LedgerSummary {
    pub crystal_id: Pubkey,
    pub total_contributors: u16,
    pub total_weight: f64,
    pub closed: bool,
    pub reputation_settled: bool,
    pub created_at: i64,
    pub last_updated: i64,
}

// ==================== Account Contexts ====================

#[derive(Accounts)]
pub struct QueryContribution<'info> {
    #[account(
        seeds = [b"ledger", ledger.crystal_id.as_ref()],
        bump = ledger.bump,
    )]
    pub ledger: Account<'info, ContributionLedger>,

    #[account(
        seeds = [b"entry", entry.crystal_id.as_ref(), entry.contributor.as_ref()],
        bump = entry.bump,
    )]
    pub entry: Account<'info, ContributionEntry>,
}

#[derive(Accounts)]
pub struct QueryLedgerSummary<'info> {
    #[account(
        seeds = [b"ledger", ledger.crystal_id.as_ref()],
        bump = ledger.bump,
    )]
    pub ledger: Account<'info, ContributionLedger>,
}
