use anchor_lang::prelude::*;
use crate::state::*;
use crate::errors::ContributionError;

/// 初始化 Contribution Engine 全局配置
/// 只能调用一次，创建 ContributionConfig PDA
pub fn initialize_engine(
    ctx: Context<InitializeEngine>,
    max_entries_per_crystal: u16,
    min_weight: f64,
) -> Result<()> {
    let config = &mut ctx.accounts.config;
    let clock = Clock::get()?;

    config.bump = ctx.bumps.config;
    config.admin = ctx.accounts.admin.key();
    config.max_entries_per_crystal = max_entries_per_crystal;
    config.min_weight = min_weight;
    // 默认角色权重: [author=0.50, discussant=0.25, reviewer=0.20, cited=0.05]
    config.role_weights = [0.50, 0.25, 0.20, 0.05];
    config.created_at = clock.unix_timestamp;
    config.last_updated = clock.unix_timestamp;
    config.total_ledgers = 0;
    config.total_references = 0;

    msg!("Contribution Engine initialized");
    Ok(())
}

/// 更新评分配置（仅 admin）
pub fn update_config(
    ctx: Context<UpdateConfig>,
    max_entries_per_crystal: Option<u16>,
    min_weight: Option<f64>,
    role_weights: Option<[f64; 4]>,
) -> Result<()> {
    let config = &mut ctx.accounts.config;
    let clock = Clock::get()?;

    if let Some(max_entries) = max_entries_per_crystal {
        config.max_entries_per_crystal = max_entries;
    }

    if let Some(weight) = min_weight {
        require!(weight >= 0.0 && weight <= 1.0, ContributionError::InvalidConfig);
        config.min_weight = weight;
    }

    if let Some(weights) = role_weights {
        // 验证权重总和约等于 1.0
        let sum: f64 = weights.iter().sum();
        require!(
            (sum - 1.0).abs() < 0.001,
            ContributionError::WeightOverflow
        );
        config.role_weights = weights;
    }

    config.last_updated = clock.unix_timestamp;

    msg!("Contribution Engine config updated");
    Ok(())
}

// ==================== Account Contexts ====================

#[derive(Accounts)]
pub struct InitializeEngine<'info> {
    #[account(
        init,
        payer = admin,
        space = ContributionConfig::SPACE,
        seeds = [b"config"],
        bump,
    )]
    pub config: Account<'info, ContributionConfig>,

    #[account(mut)]
    pub admin: Signer<'info>,

    pub system_program: Program<'info, System>,
}

#[derive(Accounts)]
pub struct UpdateConfig<'info> {
    #[account(
        mut,
        seeds = [b"config"],
        bump = config.bump,
        has_one = admin @ ContributionError::Unauthorized,
    )]
    pub config: Account<'info, ContributionConfig>,

    pub admin: Signer<'info>,
}
