use anchor_lang::prelude::*;
use crate::state::*;
use crate::errors::ContributionError;
use identity_registry::cpi::accounts::UpdateReputationByExtension;
use identity_registry::program::IdentityRegistry;

/// 结算声誉 — CPI 调用 identity-registry::update_reputation_by_extension
/// 对应 VFS §3.5: reputation_delta = weight × authority_score
///
/// trust_delta: MVP 阶段传 0.0（Trust 维度设计见 docs/TRUST_DIMENSION_DESIGN.md）
pub fn settle_reputation(
    ctx: Context<SettleReputation>,
    authority_score: f64,
) -> Result<()> {
    let ledger = &mut ctx.accounts.ledger;
    let entry = &ctx.accounts.entry;

    // 验证账本已关闭
    require!(ledger.closed, ContributionError::LedgerNotClosed);

    // 验证尚未结算
    require!(
        !ledger.reputation_settled,
        ContributionError::AlreadySettled
    );

    // 计算声誉增量: weight × authority_score
    let reputation_delta = entry.weight * authority_score;

    msg!(
        "声誉结算: contributor={}, role={:?}, weight={}, authority={}, delta={}",
        entry.contributor,
        entry.role,
        entry.weight,
        authority_score,
        reputation_delta
    );

    // CPI 调用 identity-registry::update_reputation_by_extension
    let cpi_accounts = UpdateReputationByExtension {
        user_identity: ctx.accounts.user_identity.to_account_info(),
        identity_registry: ctx.accounts.identity_registry.to_account_info(),
        caller_program: ctx.accounts.caller_program.to_account_info(),
        extension_registry: ctx.accounts.extension_registry.to_account_info(),
        authority: ctx.accounts.admin.to_account_info(),
    };
    let cpi_ctx = CpiContext::new(
        ctx.accounts.identity_registry_program.to_account_info(),
        cpi_accounts,
    );

    // MVP: trust_delta = 0.0 (Trust 维度 v2 再实现)
    let reason = format!(
        "contribution:{}:{}:{:?}",
        ledger.crystal_id, entry.contributor, entry.role
    );
    identity_registry::cpi::update_reputation_by_extension(
        cpi_ctx,
        reputation_delta,
        0.0_f64, // trust_delta — deferred to v2
        reason,
    )?;

    // 标记已结算
    ledger.reputation_settled = true;
    ledger.last_updated = Clock::get()?.unix_timestamp;

    msg!("声誉结算完成: crystal_id={}", ledger.crystal_id);
    Ok(())
}

// ==================== Account Contexts ====================

#[derive(Accounts)]
pub struct SettleReputation<'info> {
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
        seeds = [b"entry", entry.crystal_id.as_ref(), entry.contributor.as_ref()],
        bump = entry.bump,
    )]
    pub entry: Account<'info, ContributionEntry>,

    /// 贡献者的 UserIdentity 账户 (被更新声誉)
    /// CHECK: 由 identity-registry CPI 内部验证
    #[account(mut)]
    pub user_identity: AccountInfo<'info>,

    /// IdentityRegistry 全局状态
    /// CHECK: 由 identity-registry CPI 内部验证
    #[account(mut)]
    pub identity_registry: AccountInfo<'info>,

    /// 本程序的 Program ID 账户 (用于 CPI 权限检查)
    /// CHECK: 用于 ExtensionRegistry 权限验证，passed to identity-registry CPI
    pub caller_program: AccountInfo<'info>,

    /// ExtensionRegistry PDA (registry-factory 管理)
    /// CHECK: 由 identity-registry CPI 内部验证
    pub extension_registry: AccountInfo<'info>,

    /// identity-registry 程序
    pub identity_registry_program: Program<'info, IdentityRegistry>,

    pub admin: Signer<'info>,
}
