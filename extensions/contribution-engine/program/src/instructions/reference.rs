use anchor_lang::prelude::*;
use crate::state::*;
use crate::errors::ContributionError;

/// 添加内容引用关系
/// 对应 VFS §3.2 — IMPORT/CITATION/MENTION/FORK_ORIGIN
pub fn add_reference(
    ctx: Context<AddReference>,
    ref_type: ReferenceType,
) -> Result<()> {
    let config = &mut ctx.accounts.config;
    let reference = &mut ctx.accounts.reference;
    let clock = Clock::get()?;

    let source_id = ctx.accounts.source_content.key();
    let target_id = ctx.accounts.target_content.key();

    // 不允许自引用
    require!(
        source_id != target_id,
        ContributionError::SelfReferenceNotAllowed
    );

    // 写入引用关系
    reference.bump = ctx.bumps.reference;
    reference.source_id = source_id;
    reference.target_id = target_id;
    reference.ref_type = ref_type.clone();
    reference.weight = ref_type.weight();
    reference.creator = ctx.accounts.authority.key();
    reference.created_at = clock.unix_timestamp;

    // 更新全局统计
    config.total_references += 1;

    msg!(
        "引用已添加: {} -> {} (type={:?}, weight={})",
        source_id,
        target_id,
        reference.ref_type,
        reference.weight
    );
    Ok(())
}

// ==================== Account Contexts ====================

#[derive(Accounts)]
pub struct AddReference<'info> {
    #[account(
        mut,
        seeds = [b"config"],
        bump = config.bump,
    )]
    pub config: Account<'info, ContributionConfig>,

    #[account(
        init,
        payer = authority,
        space = Reference::SPACE,
        seeds = [b"ref", source_content.key().as_ref(), target_content.key().as_ref()],
        bump,
    )]
    pub reference: Account<'info, Reference>,

    /// 引用发起方（新内容）
    /// CHECK: 内容 ID 用作 PDA seed
    pub source_content: UncheckedAccount<'info>,

    /// 被引用方（旧内容）
    /// CHECK: 内容 ID 用作 PDA seed
    pub target_content: UncheckedAccount<'info>,

    #[account(mut)]
    pub authority: Signer<'info>,

    pub system_program: Program<'info, System>,
}
