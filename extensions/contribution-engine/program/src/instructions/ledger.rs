use anchor_lang::prelude::*;
use crate::state::*;
use crate::errors::ContributionError;

/// 创建贡献账本 — 每个 Crystal 一个
/// 当 Crystal 结晶时，链下 tracker 调用此指令创建账本
pub fn create_ledger(
    ctx: Context<CreateLedger>,
    crystal_id: Pubkey,
) -> Result<()> {
    let config = &mut ctx.accounts.config;
    let ledger = &mut ctx.accounts.ledger;
    let clock = Clock::get()?;

    ledger.bump = ctx.bumps.ledger;
    ledger.crystal_id = crystal_id;
    ledger.total_contributors = 0;
    ledger.closed = false;
    ledger.total_weight = 0.0;
    ledger.created_at = clock.unix_timestamp;
    ledger.last_updated = clock.unix_timestamp;
    ledger.reputation_settled = false;

    config.total_ledgers += 1;

    msg!("Contribution ledger created: crystal_id={}", crystal_id);
    Ok(())
}

/// 关闭账本 — 贡献登记完成后关闭，不再接受新条目
pub fn close_ledger(
    ctx: Context<CloseLedger>,
) -> Result<()> {
    let ledger = &mut ctx.accounts.ledger;

    require!(!ledger.closed, ContributionError::LedgerClosed);

    ledger.closed = true;
    ledger.last_updated = Clock::get()?.unix_timestamp;

    msg!(
        "Contribution ledger closed: crystal_id={}, contributors={}, total_weight={}",
        ledger.crystal_id,
        ledger.total_contributors,
        ledger.total_weight
    );
    Ok(())
}

// ==================== Account Contexts ====================

#[derive(Accounts)]
#[instruction(crystal_id: Pubkey)]
pub struct CreateLedger<'info> {
    #[account(
        mut,
        seeds = [b"config"],
        bump = config.bump,
    )]
    pub config: Account<'info, ContributionConfig>,

    #[account(
        init,
        payer = authority,
        space = ContributionLedger::SPACE,
        seeds = [b"ledger", crystal_id.as_ref()],
        bump,
    )]
    pub ledger: Account<'info, ContributionLedger>,

    #[account(mut)]
    pub authority: Signer<'info>,

    pub system_program: Program<'info, System>,
}

#[derive(Accounts)]
pub struct CloseLedger<'info> {
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

    pub admin: Signer<'info>,
}
