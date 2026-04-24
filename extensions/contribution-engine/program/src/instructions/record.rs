use anchor_lang::prelude::*;
use crate::state::*;
use crate::errors::ContributionError;

/// 记录单条贡献
/// 由链下 tracker 调用，或由 admin 手动调用
pub fn record_contribution(
    ctx: Context<RecordContribution>,
    role: ContributionRole,
    weight: f64,
) -> Result<()> {
    let config = &ctx.accounts.config;
    let ledger = &mut ctx.accounts.ledger;
    let entry = &mut ctx.accounts.entry;
    let clock = Clock::get()?;

    // 验证账本未关闭
    require!(!ledger.closed, ContributionError::LedgerClosed);

    // 验证权重有效
    require!(
        weight >= config.min_weight && weight <= 1.0,
        ContributionError::InvalidWeight
    );

    // 验证贡献者数量限制
    require!(
        ledger.total_contributors < config.max_entries_per_crystal,
        ContributionError::MaxEntriesExceeded
    );

    // 写入贡献条目
    entry.bump = ctx.bumps.entry;
    entry.crystal_id = ledger.crystal_id;
    entry.contributor = ctx.accounts.contributor.key();
    entry.role = role;
    entry.weight = weight;
    entry.recorded_at = clock.unix_timestamp;

    // 更新账本统计
    ledger.total_contributors += 1;
    ledger.total_weight += weight;
    ledger.last_updated = clock.unix_timestamp;

    msg!(
        "Contribution recorded: crystal={}, contributor={}, role={:?}, weight={}",
        ledger.crystal_id,
        ctx.accounts.contributor.key(),
        entry.role,
        weight
    );
    Ok(())
}

/// 更新已有贡献的分数（仅 admin，用于重新计算）
pub fn update_contribution_score(
    ctx: Context<UpdateContributionScore>,
    new_weight: f64,
) -> Result<()> {
    let config = &ctx.accounts.config;
    let ledger = &mut ctx.accounts.ledger;
    let entry = &mut ctx.accounts.entry;

    // 验证权重有效
    require!(
        new_weight >= config.min_weight && new_weight <= 1.0,
        ContributionError::InvalidWeight
    );

    // 更新总权重
    ledger.total_weight = ledger.total_weight - entry.weight + new_weight;
    ledger.last_updated = Clock::get()?.unix_timestamp;

    // 更新条目
    entry.weight = new_weight;

    msg!(
        "Contribution score updated: contributor={}, new_weight={}",
        entry.contributor,
        new_weight
    );
    Ok(())
}

// ==================== Account Contexts ====================

#[derive(Accounts)]
pub struct RecordContribution<'info> {
    #[account(
        seeds = [b"config"],
        bump = config.bump,
    )]
    pub config: Account<'info, ContributionConfig>,

    #[account(
        mut,
        seeds = [b"ledger", ledger.crystal_id.as_ref()],
        bump = ledger.bump,
    )]
    pub ledger: Account<'info, ContributionLedger>,

    #[account(
        init,
        payer = authority,
        space = ContributionEntry::SPACE,
        seeds = [b"entry", ledger.crystal_id.as_ref(), contributor.key().as_ref()],
        bump,
    )]
    pub entry: Account<'info, ContributionEntry>,

    /// 贡献者 (不需要签名，由 authority 代为记录)
    /// CHECK: 只用作 PDA seed 和记录 contributor 字段
    pub contributor: UncheckedAccount<'info>,

    #[account(mut)]
    pub authority: Signer<'info>,

    pub system_program: Program<'info, System>,
}

#[derive(Accounts)]
pub struct UpdateContributionScore<'info> {
    #[account(
        seeds = [b"config"],
        bump = config.bump,
        has_one = admin @ ContributionError::Unauthorized,
    )]
    pub config: Account<'info, ContributionConfig>,

    #[account(
        mut,
        seeds = [b"ledger", ledger.crystal_id.as_ref()],
        bump = ledger.bump,
    )]
    pub ledger: Account<'info, ContributionLedger>,

    #[account(
        mut,
        seeds = [b"entry", entry.crystal_id.as_ref(), entry.contributor.as_ref()],
        bump = entry.bump,
    )]
    pub entry: Account<'info, ContributionEntry>,

    pub admin: Signer<'info>,
}
