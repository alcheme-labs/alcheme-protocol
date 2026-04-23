use anchor_lang::prelude::*;
use anchor_lang::solana_program::ed25519_program;
use anchor_lang::solana_program::sysvar::instructions as sysvar_instructions;
use alcheme_shared::*;
use alcheme_cpi::{is_authorized_for_cpi_with_registry, CpiHelper};
use crate::state::*;

const KNOWLEDGE_BINDING_SEED: &[u8] = b"knowledge_binding";
const PROOF_ATTESTOR_REGISTRY_SEED: &[u8] = b"proof_attestor_registry";
const MEMBERSHIP_ATTESTOR_REGISTRY_SEED: &[u8] = b"membership_attestor_registry";
const PROOF_BINDING_CANONICAL_DOMAIN: &[u8] = b"alcheme:proof_binding:v1";

// ==================== Initialize ====================

#[derive(Accounts)]
pub struct Initialize<'info> {
    #[account(
        init,
        payer = admin,
        space = CircleManager::SPACE,
        seeds = [b"circle_manager"],
        bump
    )]
    pub circle_manager: Account<'info, CircleManager>,
    
    #[account(mut)]
    pub admin: Signer<'info>,
    
    pub system_program: Program<'info, System>,
}

pub fn initialize(ctx: Context<Initialize>) -> Result<()> {
    let manager = &mut ctx.accounts.circle_manager;
    manager.initialize(ctx.bumps.circle_manager, ctx.accounts.admin.key())?;
    Ok(())
}

// ==================== Create Circle ====================

#[derive(Accounts)]
#[instruction(circle_id: u8)]
pub struct CreateCircle<'info> {
    #[account(
        init,
        payer = creator,
        space = Circle::SPACE,
        seeds = [b"circle", circle_id.to_le_bytes().as_ref()],
        bump
    )]
    pub circle: Account<'info, Circle>,
    
    #[account(mut)]
    pub circle_manager: Account<'info, CircleManager>,
    
    #[account(mut)]
    pub creator: Signer<'info>,

    /// CHECK: Event Emitter program
    pub event_program: AccountInfo<'info>,

    /// CHECK: Event Emitter account
    #[account(mut)]
    pub event_emitter: AccountInfo<'info>,

    /// CHECK: Event Batch account
    #[account(mut)]
    pub event_batch: AccountInfo<'info>,
    
    pub system_program: Program<'info, System>,
}

pub fn create_circle(
    ctx: Context<CreateCircle>,
    circle_id: u8,
    name: String,
    level: u8,
    parent_circle: Option<u8>,
    knowledge_governance: KnowledgeGovernance,
    decision_engine: DecisionEngine,
) -> Result<()> {
    let circle = &mut ctx.accounts.circle;
    let manager = &mut ctx.accounts.circle_manager;
    
    circle.initialize(
        circle_id,
        name,
        level,
        parent_circle,
        knowledge_governance,
        decision_engine,
        ctx.accounts.creator.key(),
        ctx.bumps.circle,
    )?;
    
    manager.total_circles += 1;

    let event = ProtocolEvent::CircleCreated {
        circle_id,
        name: circle.name.clone(),
        level,
        parent_circle,
        flags: circle.flags,
        creator: ctx.accounts.creator.key(),
        timestamp: Clock::get()?.unix_timestamp,
    };

    CpiHelper::emit_event_simple(
        &ctx.accounts.event_program,
        &mut ctx.accounts.event_emitter,
        &mut ctx.accounts.event_batch,
        &ctx.accounts.creator.to_account_info(),
        &ctx.accounts.system_program.to_account_info(),
        &crate::ID,
        event,
    )?;
    
    Ok(())
}

#[derive(Accounts)]
#[instruction(source_circle_id: u8, target_circle_id: u8)]
pub struct AnchorCircleFork<'info> {
    #[account(
        seeds = [b"circle", &[source_circle.circle_id]],
        bump = source_circle.bump,
    )]
    pub source_circle: Account<'info, Circle>,

    #[account(
        seeds = [b"circle", &[target_circle.circle_id]],
        bump = target_circle.bump,
    )]
    pub target_circle: Account<'info, Circle>,

    #[account(
        init,
        payer = authority,
        space = CircleForkAnchor::SPACE,
        seeds = [b"circle_fork_anchor".as_ref(), &[target_circle.circle_id]],
        bump
    )]
    pub fork_anchor: Account<'info, CircleForkAnchor>,

    #[account(mut)]
    pub authority: Signer<'info>,

    pub system_program: Program<'info, System>,
}

pub fn anchor_circle_fork(
    ctx: Context<AnchorCircleFork>,
    source_circle_id: u8,
    target_circle_id: u8,
    fork_declaration_digest: [u8; 32],
) -> Result<()> {
    require!(
        ctx.accounts.source_circle.circle_id == source_circle_id,
        AlchemeError::InvalidOperation
    );
    require!(
        ctx.accounts.target_circle.circle_id == target_circle_id,
        AlchemeError::InvalidOperation
    );
    require!(
        source_circle_id != target_circle_id,
        AlchemeError::InvalidOperation
    );
    require!(
        ctx.accounts.target_circle.is_curator(&ctx.accounts.authority.key()),
        AlchemeError::InvalidOperation
    );

    ctx.accounts.fork_anchor.initialize(
        source_circle_id,
        target_circle_id,
        fork_declaration_digest,
        ctx.bumps.fork_anchor,
    )?;

    Ok(())
}

// ==================== Add Curator ====================

#[derive(Accounts)]
pub struct AddCurator<'info> {
    #[account(mut)]
    pub circle: Account<'info, Circle>,
    
    /// CHECK: 权限通过AccessController验证
    pub access_controller: AccountInfo<'info>,
    
    pub authority: Signer<'info>,
}

pub fn add_curator(
    ctx: Context<AddCurator>,
    curator: Pubkey,
) -> Result<()> {
    let circle = &mut ctx.accounts.circle;
    
    // 只有现有策展人才能添加新策展人
    require!(
        circle.is_curator(&ctx.accounts.authority.key()),
        AlchemeError::InvalidOperation
    );
    
    circle.add_curator(curator)?;
    Ok(())
}

#[derive(Accounts)]
pub struct AddCircleMember<'info> {
    #[account(mut)]
    pub circle: Account<'info, Circle>,

    #[account(
        init,
        payer = authority,
        space = CircleMemberAccount::SPACE,
        seeds = [CIRCLE_MEMBER_SEED, circle.key().as_ref(), member.key().as_ref()],
        bump
    )]
    pub circle_member: Account<'info, CircleMemberAccount>,

    #[account(mut)]
    pub authority: Signer<'info>,

    /// CHECK: 目标成员钱包地址，仅用于成员事实 key
    pub member: UncheckedAccount<'info>,

    /// CHECK: Event Emitter program
    pub event_program: AccountInfo<'info>,

    /// CHECK: Event Emitter account
    #[account(mut)]
    pub event_emitter: AccountInfo<'info>,

    /// CHECK: Event Batch account
    #[account(mut)]
    pub event_batch: AccountInfo<'info>,

    pub system_program: Program<'info, System>,
}

pub fn add_circle_member(
    ctx: Context<AddCircleMember>,
    role: CircleMemberRole,
) -> Result<()> {
    let circle = &ctx.accounts.circle;
    require!(
        circle.is_curator(&ctx.accounts.authority.key()),
        AlchemeError::InvalidOperation
    );

    let circle_member = &mut ctx.accounts.circle_member;
    circle_member.initialize(
        circle.circle_id,
        ctx.accounts.member.key(),
        role.clone(),
        ctx.bumps.circle_member,
    )?;

    emit_circle_membership_event(
        &ctx.accounts.event_program,
        &mut ctx.accounts.event_emitter,
        &mut ctx.accounts.event_batch,
        &ctx.accounts.authority.to_account_info(),
        &ctx.accounts.system_program.to_account_info(),
        circle.circle_id,
        ctx.accounts.member.key(),
        role,
        circle_member.status.clone(),
        CircleMembershipAction::Added,
        ctx.accounts.authority.key(),
    )?;

    Ok(())
}

#[derive(Accounts)]
pub struct RemoveCircleMember<'info> {
    pub circle: Account<'info, Circle>,

    #[account(
        mut,
        seeds = [CIRCLE_MEMBER_SEED, circle.key().as_ref(), member.key().as_ref()],
        bump = circle_member.bump,
        constraint = circle_member.circle_id == circle.circle_id @ AlchemeError::InvalidOperation,
        constraint = circle_member.member == member.key() @ AlchemeError::InvalidOperation
    )]
    pub circle_member: Account<'info, CircleMemberAccount>,

    #[account(mut)]
    pub authority: Signer<'info>,

    /// CHECK: 目标成员钱包地址，仅用于成员事实 key
    pub member: UncheckedAccount<'info>,

    /// CHECK: Event Emitter program
    pub event_program: AccountInfo<'info>,

    /// CHECK: Event Emitter account
    #[account(mut)]
    pub event_emitter: AccountInfo<'info>,

    /// CHECK: Event Batch account
    #[account(mut)]
    pub event_batch: AccountInfo<'info>,

    pub system_program: Program<'info, System>,
}

fn require_circle_owner(circle: &Circle, authority: &Pubkey) -> Result<()> {
    require!(
        circle.curators.first().map(|owner| owner == authority).unwrap_or(false),
        AlchemeError::InvalidOperation
    );
    Ok(())
}

fn require_mutable_membership_target(circle_member: &CircleMemberAccount) -> Result<()> {
    require!(
        !matches!(circle_member.role, CircleMemberRole::Owner | CircleMemberRole::Admin),
        AlchemeError::InvalidOperation
    );
    Ok(())
}

fn require_active_membership_target(circle_member: &CircleMemberAccount) -> Result<()> {
    require!(
        matches!(circle_member.status, CircleMemberStatus::Active),
        AlchemeError::InvalidOperation
    );
    Ok(())
}

pub fn remove_circle_member(
    ctx: Context<RemoveCircleMember>,
) -> Result<()> {
    let circle = &ctx.accounts.circle;
    require_circle_owner(circle, &ctx.accounts.authority.key())?;

    let circle_member = &mut ctx.accounts.circle_member;
    require_active_membership_target(circle_member)?;
    require_mutable_membership_target(circle_member)?;
    circle_member.deactivate()?;

    emit_circle_membership_event(
        &ctx.accounts.event_program,
        &mut ctx.accounts.event_emitter,
        &mut ctx.accounts.event_batch,
        &ctx.accounts.authority.to_account_info(),
        &ctx.accounts.system_program.to_account_info(),
        circle.circle_id,
        ctx.accounts.member.key(),
        circle_member.role.clone(),
        circle_member.status.clone(),
        CircleMembershipAction::Removed,
        ctx.accounts.authority.key(),
    )?;

    Ok(())
}

#[derive(Accounts)]
pub struct UpdateCircleMemberRole<'info> {
    pub circle: Account<'info, Circle>,

    #[account(
        mut,
        seeds = [CIRCLE_MEMBER_SEED, circle.key().as_ref(), member.key().as_ref()],
        bump = circle_member.bump,
        constraint = circle_member.circle_id == circle.circle_id @ AlchemeError::InvalidOperation,
        constraint = circle_member.member == member.key() @ AlchemeError::InvalidOperation
    )]
    pub circle_member: Account<'info, CircleMemberAccount>,

    #[account(mut)]
    pub authority: Signer<'info>,

    /// CHECK: 目标成员钱包地址，仅用于成员事实 key
    pub member: UncheckedAccount<'info>,

    /// CHECK: Event Emitter program
    pub event_program: AccountInfo<'info>,

    /// CHECK: Event Emitter account
    #[account(mut)]
    pub event_emitter: AccountInfo<'info>,

    /// CHECK: Event Batch account
    #[account(mut)]
    pub event_batch: AccountInfo<'info>,

    pub system_program: Program<'info, System>,
}

pub fn update_circle_member_role(
    ctx: Context<UpdateCircleMemberRole>,
    role: CircleMemberRole,
) -> Result<()> {
    let circle = &ctx.accounts.circle;
    require_circle_owner(circle, &ctx.accounts.authority.key())?;
    require!(
        matches!(role, CircleMemberRole::Member | CircleMemberRole::Moderator),
        AlchemeError::InvalidOperation
    );

    let circle_member = &mut ctx.accounts.circle_member;
    require_active_membership_target(circle_member)?;
    require_mutable_membership_target(circle_member)?;
    circle_member.update_role(role.clone())?;

    emit_circle_membership_event(
        &ctx.accounts.event_program,
        &mut ctx.accounts.event_emitter,
        &mut ctx.accounts.event_batch,
        &ctx.accounts.authority.to_account_info(),
        &ctx.accounts.system_program.to_account_info(),
        circle.circle_id,
        ctx.accounts.member.key(),
        role,
        circle_member.status.clone(),
        CircleMembershipAction::RoleChanged,
        ctx.accounts.authority.key(),
    )?;

    Ok(())
}

const MEMBERSHIP_ADMISSION_CANONICAL_DOMAIN: &[u8] = b"alcheme:membership_admission:v1";

fn circle_member_role_index(role: &CircleMemberRole) -> [u8; 1] {
    [match role {
        CircleMemberRole::Owner => 0,
        CircleMemberRole::Admin => 1,
        CircleMemberRole::Moderator => 2,
        CircleMemberRole::Member => 3,
    }]
}

fn circle_membership_admission_kind_index(kind: &CircleMembershipAdmissionKind) -> [u8; 1] {
    [match kind {
        CircleMembershipAdmissionKind::Open => 0,
        CircleMembershipAdmissionKind::Invite => 1,
        CircleMembershipAdmissionKind::Approval => 2,
    }]
}

fn build_membership_admission_digest(admission: &CircleMembershipAdmission) -> [u8; 32] {
    use anchor_lang::solana_program::hash::hashv;

    hashv(&[
        MEMBERSHIP_ADMISSION_CANONICAL_DOMAIN,
        &[admission.circle_id],
        admission.member.as_ref(),
        &circle_member_role_index(&admission.role),
        &circle_membership_admission_kind_index(&admission.kind),
        &admission.artifact_id.to_le_bytes(),
        &admission.issued_at.to_le_bytes(),
        &admission.expires_at.to_le_bytes(),
    ])
    .to_bytes()
}

fn verify_ed25519_membership_admission(
    instructions_sysvar: &AccountInfo,
    issuer_key_id: Pubkey,
    expected_message: [u8; 32],
    issued_signature: [u8; 64],
) -> Result<()> {
    let current_index = sysvar_instructions::load_current_index_checked(instructions_sysvar)
        .map_err(|_| error!(AlchemeError::ValidationFailed))? as usize;
    require!(current_index > 0, AlchemeError::ValidationFailed);
    let verify_ix = sysvar_instructions::load_instruction_at_checked(current_index - 1, instructions_sysvar)
        .map_err(|_| error!(AlchemeError::ValidationFailed))?;
    require!(verify_ix.program_id == ed25519_program::id(), AlchemeError::ValidationFailed);

    let data = verify_ix.data;
    require!(data.len() >= 16, AlchemeError::ValidationFailed);
    require!(data[0] == 1, AlchemeError::ValidationFailed);

    let signature_offset = u16::from_le_bytes([data[2], data[3]]) as usize;
    let signature_ix_index = u16::from_le_bytes([data[4], data[5]]);
    let pubkey_offset = u16::from_le_bytes([data[6], data[7]]) as usize;
    let pubkey_ix_index = u16::from_le_bytes([data[8], data[9]]);
    let message_offset = u16::from_le_bytes([data[10], data[11]]) as usize;
    let message_size = u16::from_le_bytes([data[12], data[13]]) as usize;
    let message_ix_index = u16::from_le_bytes([data[14], data[15]]);

    require!(signature_ix_index == u16::MAX, AlchemeError::ValidationFailed);
    require!(pubkey_ix_index == u16::MAX, AlchemeError::ValidationFailed);
    require!(message_ix_index == u16::MAX, AlchemeError::ValidationFailed);
    require!(message_size == 32, AlchemeError::ValidationFailed);
    require!(signature_offset + 64 <= data.len(), AlchemeError::ValidationFailed);
    require!(pubkey_offset + 32 <= data.len(), AlchemeError::ValidationFailed);
    require!(message_offset + message_size <= data.len(), AlchemeError::ValidationFailed);

    let signature_slice = &data[signature_offset..signature_offset + 64];
    let pubkey_slice = &data[pubkey_offset..pubkey_offset + 32];
    let message_slice = &data[message_offset..message_offset + message_size];

    require!(signature_slice == issued_signature.as_ref(), AlchemeError::ValidationFailed);
    require!(pubkey_slice == issuer_key_id.as_ref(), AlchemeError::ValidationFailed);
    require!(message_slice == expected_message.as_ref(), AlchemeError::ValidationFailed);

    Ok(())
}

#[derive(Accounts)]
pub struct ClaimCircleMembership<'info> {
    #[account(
        seeds = [b"circle_manager"],
        bump = circle_manager.bump
    )]
    pub circle_manager: Account<'info, CircleManager>,

    pub circle: Account<'info, Circle>,

    #[account(
        init,
        payer = member,
        space = CircleMemberAccount::SPACE,
        seeds = [CIRCLE_MEMBER_SEED, circle.key().as_ref(), member.key().as_ref()],
        bump
    )]
    pub circle_member: Account<'info, CircleMemberAccount>,

    #[account(mut)]
    pub member: Signer<'info>,

    /// CHECK: Solana Instructions sysvar account for ed25519 verification.
    #[account(address = sysvar_instructions::ID)]
    pub instructions_sysvar: AccountInfo<'info>,

    /// CHECK: Event Emitter program
    pub event_program: AccountInfo<'info>,

    /// CHECK: Event Emitter account
    #[account(mut)]
    pub event_emitter: AccountInfo<'info>,

    /// CHECK: Event Batch account
    #[account(mut)]
    pub event_batch: AccountInfo<'info>,

    pub system_program: Program<'info, System>,
}

pub fn claim_circle_membership<'info>(
    ctx: Context<'_, '_, 'info, 'info, ClaimCircleMembership<'info>>,
    admission: CircleMembershipAdmission,
    issuer_key_id: Pubkey,
    issued_signature: [u8; 64],
) -> Result<()> {
    let issuer_authorized = if issuer_key_id == ctx.accounts.circle_manager.admin {
        true
    } else {
        let (registry_pda, _) =
            Pubkey::find_program_address(&[MEMBERSHIP_ATTESTOR_REGISTRY_SEED], &crate::ID);
        let registry_info = ctx
            .remaining_accounts
            .iter()
            .find(|account| account.key() == registry_pda);

        if let Some(registry_info) = registry_info {
            let registry = Account::<MembershipAttestorRegistry>::try_from(registry_info)?;
            require!(
                registry.admin == ctx.accounts.circle_manager.admin,
                AlchemeError::Unauthorized
            );
            registry.is_registered(&issuer_key_id)
        } else {
            false
        }
    };

    require!(
        issuer_authorized,
        AlchemeError::Unauthorized
    );
    require!(
        admission.circle_id == ctx.accounts.circle.circle_id,
        AlchemeError::InvalidOperation
    );
    require!(
        admission.member == ctx.accounts.member.key(),
        AlchemeError::InvalidOperation
    );
    require!(
        matches!(admission.role, CircleMemberRole::Member),
        AlchemeError::InvalidOperation
    );
    require!(
        admission.expires_at >= Clock::get()?.unix_timestamp,
        AlchemeError::ValidationFailed
    );

    verify_ed25519_membership_admission(
        &ctx.accounts.instructions_sysvar,
        issuer_key_id,
        build_membership_admission_digest(&admission),
        issued_signature,
    )?;

    let circle_member = &mut ctx.accounts.circle_member;
    circle_member.initialize(
        ctx.accounts.circle.circle_id,
        ctx.accounts.member.key(),
        admission.role.clone(),
        ctx.bumps.circle_member,
    )?;

    emit_circle_membership_event(
        &ctx.accounts.event_program,
        &mut ctx.accounts.event_emitter,
        &mut ctx.accounts.event_batch,
        &ctx.accounts.member.to_account_info(),
        &ctx.accounts.system_program.to_account_info(),
        ctx.accounts.circle.circle_id,
        ctx.accounts.member.key(),
        circle_member.role.clone(),
        circle_member.status.clone(),
        CircleMembershipAction::Joined,
        ctx.accounts.member.key(),
    )?;

    Ok(())
}

#[derive(Accounts)]
pub struct JoinCircle<'info> {
    pub circle: Account<'info, Circle>,

    #[account(
        mut,
        seeds = [CIRCLE_MEMBER_SEED, circle.key().as_ref(), member.key().as_ref()],
        bump = circle_member.bump,
        constraint = circle_member.circle_id == circle.circle_id @ AlchemeError::InvalidOperation,
        constraint = circle_member.member == member.key() @ AlchemeError::InvalidOperation
    )]
    pub circle_member: Account<'info, CircleMemberAccount>,

    #[account(mut)]
    pub member: Signer<'info>,

    /// CHECK: Event Emitter program
    pub event_program: AccountInfo<'info>,

    /// CHECK: Event Emitter account
    #[account(mut)]
    pub event_emitter: AccountInfo<'info>,

    /// CHECK: Event Batch account
    #[account(mut)]
    pub event_batch: AccountInfo<'info>,

    pub system_program: Program<'info, System>,
}

pub fn join_circle(
    ctx: Context<JoinCircle>,
) -> Result<()> {
    let circle_member = &mut ctx.accounts.circle_member;
    circle_member.activate()?;

    emit_circle_membership_event(
        &ctx.accounts.event_program,
        &mut ctx.accounts.event_emitter,
        &mut ctx.accounts.event_batch,
        &ctx.accounts.member.to_account_info(),
        &ctx.accounts.system_program.to_account_info(),
        ctx.accounts.circle.circle_id,
        ctx.accounts.member.key(),
        circle_member.role.clone(),
        circle_member.status.clone(),
        CircleMembershipAction::Joined,
        ctx.accounts.member.key(),
    )?;

    Ok(())
}

#[derive(Accounts)]
pub struct LeaveCircle<'info> {
    pub circle: Account<'info, Circle>,

    #[account(
        mut,
        seeds = [CIRCLE_MEMBER_SEED, circle.key().as_ref(), member.key().as_ref()],
        bump = circle_member.bump,
        constraint = circle_member.circle_id == circle.circle_id @ AlchemeError::InvalidOperation,
        constraint = circle_member.member == member.key() @ AlchemeError::InvalidOperation
    )]
    pub circle_member: Account<'info, CircleMemberAccount>,

    #[account(mut)]
    pub member: Signer<'info>,

    /// CHECK: Event Emitter program
    pub event_program: AccountInfo<'info>,

    /// CHECK: Event Emitter account
    #[account(mut)]
    pub event_emitter: AccountInfo<'info>,

    /// CHECK: Event Batch account
    #[account(mut)]
    pub event_batch: AccountInfo<'info>,

    pub system_program: Program<'info, System>,
}

pub fn leave_circle(
    ctx: Context<LeaveCircle>,
) -> Result<()> {
    let circle_member = &mut ctx.accounts.circle_member;
    circle_member.deactivate()?;

    emit_circle_membership_event(
        &ctx.accounts.event_program,
        &mut ctx.accounts.event_emitter,
        &mut ctx.accounts.event_batch,
        &ctx.accounts.member.to_account_info(),
        &ctx.accounts.system_program.to_account_info(),
        ctx.accounts.circle.circle_id,
        ctx.accounts.member.key(),
        circle_member.role.clone(),
        circle_member.status.clone(),
        CircleMembershipAction::Left,
        ctx.accounts.member.key(),
    )?;

    Ok(())
}

fn emit_circle_membership_event<'info>(
    event_program: &AccountInfo<'info>,
    event_emitter: &mut AccountInfo<'info>,
    event_batch: &mut AccountInfo<'info>,
    authority: &AccountInfo<'info>,
    system_program: &AccountInfo<'info>,
    circle_id: u8,
    member: Pubkey,
    role: CircleMemberRole,
    status: CircleMemberStatus,
    action: CircleMembershipAction,
    actor: Pubkey,
) -> Result<()> {
    CpiHelper::emit_event_simple(
        event_program,
        event_emitter,
        event_batch,
        authority,
        system_program,
        &crate::ID,
        ProtocolEvent::CircleMembershipChanged {
            circle_id,
            member,
            role,
            status,
            action,
            actor,
            timestamp: Clock::get()?.unix_timestamp,
        },
    )?;

    Ok(())
}

// ==================== Submit Knowledge ====================

#[derive(Accounts)]
pub struct SubmitKnowledge<'info> {
    #[account(
        init,
        payer = author,
        space = Knowledge::SPACE,
        seeds = [b"knowledge", circle.key().as_ref(), &circle.knowledge_count.to_le_bytes()],
        bump
    )]
    pub knowledge: Account<'info, Knowledge>,
    
    #[account(mut)]
    pub circle: Account<'info, Circle>,
    
    #[account(mut)]
    pub circle_manager: Account<'info, CircleManager>,
    
    #[account(mut)]
    pub author: Signer<'info>,

    /// CHECK: Event Emitter program
    pub event_program: AccountInfo<'info>,

    /// CHECK: Event Emitter account
    #[account(mut)]
    pub event_emitter: AccountInfo<'info>,

    /// CHECK: Event Batch account
    #[account(mut)]
    pub event_batch: AccountInfo<'info>,
    
    pub system_program: Program<'info, System>,
}

pub fn submit_knowledge(
    ctx: Context<SubmitKnowledge>,
    ipfs_cid: String,
    content_hash: [u8; 32],
    title: String,
    description: String,
) -> Result<()> {
    let knowledge = &mut ctx.accounts.knowledge;
    let circle = &mut ctx.accounts.circle;
    let manager = &mut ctx.accounts.circle_manager;
    
    // 合约硬约束：仅允许圈层策展人提交知识
    require!(
        circle.is_curator(&ctx.accounts.author.key()),
        AlchemeError::InvalidOperation
    );
    
    use anchor_lang::solana_program::hash::hash;
    let knowledge_id = hash(
        &[ipfs_cid.as_bytes(), &Clock::get()?.unix_timestamp.to_le_bytes()].concat()
    ).to_bytes();
    
    knowledge.initialize(
        knowledge_id,
        circle.circle_id,
        ipfs_cid,
        content_hash,
        title,
        description,
        ctx.accounts.author.key(),
        ctx.bumps.knowledge,
    )?;
    
    circle.knowledge_count += 1;
    manager.total_knowledge += 1;

    let event = ProtocolEvent::KnowledgeSubmitted {
        knowledge_id,
        circle_id: circle.circle_id,
        author: ctx.accounts.author.key(),
        content_hash,
        title: knowledge.title.clone(),
        flags: knowledge.flags,
        timestamp: Clock::get()?.unix_timestamp,
    };

    CpiHelper::emit_event_simple(
        &ctx.accounts.event_program,
        &mut ctx.accounts.event_emitter,
        &mut ctx.accounts.event_batch,
        &ctx.accounts.author.to_account_info(),
        &ctx.accounts.system_program.to_account_info(),
        &crate::ID,
        event,
    )?;
    
    Ok(())
}

// ==================== Propose Transfer ====================

#[derive(Accounts)]
pub struct ProposeTransfer<'info> {
    #[account(
        init,
        payer = proposer,
        space = TransferProposal::SPACE,
        seeds = [b"proposal", circle.key().as_ref(), &circle.knowledge_count.to_le_bytes()],
        bump
    )]
    pub proposal: Account<'info, TransferProposal>,
    
    #[account()]
    pub knowledge: Account<'info, Knowledge>,
    
    #[account(mut)]
    pub circle: Account<'info, Circle>,
    
    #[account(mut)]
    pub proposer: Signer<'info>,
    
    pub system_program: Program<'info, System>,
}

pub fn propose_transfer(
    ctx: Context<ProposeTransfer>,
    knowledge_id: [u8; 32],
    to_circles: Vec<u8>,
    transfer_type: TransferType,
) -> Result<()> {
    let proposal = &mut ctx.accounts.proposal;
    let circle = &ctx.accounts.circle;
    let knowledge = &ctx.accounts.knowledge;
    
    // 只有策展人可以提议传递
    require!(
        circle.is_curator(&ctx.accounts.proposer.key()),
        AlchemeError::InvalidOperation
    );
    
    // 检查知识质量是否达标
    require!(
        knowledge.quality_score >= circle.knowledge_governance.min_quality_score,
        AlchemeError::InvalidOperation
    );
    
    let proposal_id = Clock::get()?.unix_timestamp as u64;
    
    proposal.initialize(
        proposal_id,
        knowledge_id,
        circle.circle_id,
        to_circles,
        transfer_type,
        ctx.accounts.proposer.key(),
        circle.decision_engine.clone(),
        ctx.bumps.proposal,
    )?;
    
    Ok(())
}

// ==================== Vote ====================

#[derive(Accounts)]
pub struct Vote<'info> {
    #[account(mut)]
    pub proposal: Account<'info, TransferProposal>,
    
    #[account()]
    pub circle: Account<'info, Circle>,
    
    pub voter: Signer<'info>,
}

pub fn vote(
    ctx: Context<Vote>,
    vote_for: bool,
) -> Result<()> {
    let proposal = &mut ctx.accounts.proposal;
    
    // 投票权限由AccessController管理（不在Circle内部）
    // 简化实现：假设调用前已验证
    
    proposal.add_vote(ctx.accounts.voter.key(), vote_for)?;
    proposal.check_voting_result()?;
    
    Ok(())
}

// ==================== Submit AI Evaluation ====================

#[derive(Accounts)]
pub struct SubmitAIEvaluation<'info> {
    #[account(mut)]
    pub proposal: Account<'info, TransferProposal>,
    
    #[account()]
    pub circle: Account<'info, Circle>,
    
    pub ai_oracle: Signer<'info>,
}

pub fn submit_ai_evaluation(
    ctx: Context<SubmitAIEvaluation>,
    evaluation: AIEvaluation,
) -> Result<()> {
    let proposal = &mut ctx.accounts.proposal;
    let circle = &ctx.accounts.circle;
    
    match &circle.decision_engine {
        DecisionEngine::AIAssisted { ai_oracle, confidence_required, .. } => {
            require!(
                ctx.accounts.ai_oracle.key() == *ai_oracle,
                AlchemeError::InvalidOperation
            );
            require!(
                evaluation.confidence >= *confidence_required,
                AlchemeError::InvalidOperation
            );
        },
        DecisionEngine::FullyAutonomous { .. } => {},
        _ => return Err(AlchemeError::InvalidOperation.into()),
    }
    
    proposal.set_ai_evaluation(evaluation)?;
    Ok(())
}

// ==================== Execute Transfer ====================

#[derive(Accounts)]
pub struct ExecuteTransfer<'info> {
    #[account(mut)]
    pub proposal: Account<'info, TransferProposal>,
    
    #[account()]
    pub from_circle: Account<'info, Circle>,
    
    #[account(
        init,
        payer = executor,
        space = Knowledge::SPACE,
        seeds = [b"knowledge", to_circle.key().as_ref(), &to_circle.knowledge_count.to_le_bytes()],
        bump
    )]
    pub transferred_knowledge: Account<'info, Knowledge>,
    
    #[account(mut)]
    pub to_circle: Account<'info, Circle>,
    
    #[account()]
    pub original_knowledge: Account<'info, Knowledge>,
    
    #[account(mut)]
    pub circle_manager: Account<'info, CircleManager>,
    
    #[account(mut)]
    pub executor: Signer<'info>,
    
    pub system_program: Program<'info, System>,
}

pub fn execute_transfer(ctx: Context<ExecuteTransfer>) -> Result<()> {
    let proposal = &mut ctx.accounts.proposal;
    let original = &ctx.accounts.original_knowledge;
    let transferred = &mut ctx.accounts.transferred_knowledge;
    let to_circle = &mut ctx.accounts.to_circle;
    let manager = &mut ctx.accounts.circle_manager;
    
    require!(
        proposal.status == ProposalStatus::Approved,
        AlchemeError::InvalidOperation
    );
    
    transferred.initialize(
        original.knowledge_id,
        to_circle.circle_id,
        original.ipfs_cid.clone(),
        original.content_hash,
        original.title.clone(),
        original.description.clone(),
        original.author,
        ctx.bumps.transferred_knowledge,
    )?;
    
    transferred.source_circle = Some(proposal.from_circle);
    transferred.quality_score = proposal.ai_evaluation
        .as_ref()
        .map(|e| e.quality_score)
        .unwrap_or(original.quality_score);
    
    to_circle.knowledge_count += 1;
    manager.total_transfers += 1;
    proposal.status = ProposalStatus::Executed;
    
    Ok(())
}

// ==================== Update Decision Engine ====================

#[derive(Accounts)]
pub struct UpdateDecisionEngine<'info> {
    #[account(mut)]
    pub circle: Account<'info, Circle>,
    
    pub authority: Signer<'info>,
}

pub fn update_decision_engine(
    ctx: Context<UpdateDecisionEngine>,
    new_engine: DecisionEngine,
) -> Result<()> {
    let circle = &mut ctx.accounts.circle;
    
    // 只有策展人可以更新决策引擎
    require!(
        circle.is_curator(&ctx.accounts.authority.key()),
        AlchemeError::InvalidOperation
    );
    
    circle.decision_engine = new_engine;
    Ok(())
}

// ==================== Update Circle Flags ====================

#[derive(Accounts)]
pub struct UpdateCircleFlags<'info> {
    #[account(mut)]
    pub circle: Account<'info, Circle>,
    
    #[account(mut)]
    pub authority: Signer<'info>,

    /// CHECK: Event Emitter program
    pub event_program: AccountInfo<'info>,

    /// CHECK: Event Emitter account
    #[account(mut)]
    pub event_emitter: AccountInfo<'info>,

    /// CHECK: Event Batch account
    #[account(mut)]
    pub event_batch: AccountInfo<'info>,

    pub system_program: Program<'info, System>,
}

/// 更新圈层 flags 位字段（kind/mode/min_crystals 等）
pub fn update_circle_flags(
    ctx: Context<UpdateCircleFlags>,
    flags: u64,
) -> Result<()> {
    let circle = &mut ctx.accounts.circle;
    let old_flags = circle.flags;
    
    // 只有策展人可以更新 flags
    require!(
        circle.is_curator(&ctx.accounts.authority.key()),
        AlchemeError::InvalidOperation
    );
    
    circle.flags = flags;

    let event = ProtocolEvent::CircleFlagsUpdated {
        circle_id: circle.circle_id,
        old_flags,
        new_flags: flags,
        updated_by: ctx.accounts.authority.key(),
        timestamp: Clock::get()?.unix_timestamp,
    };

    CpiHelper::emit_event_simple(
        &ctx.accounts.event_program,
        &mut ctx.accounts.event_emitter,
        &mut ctx.accounts.event_batch,
        &ctx.accounts.authority.to_account_info(),
        &ctx.accounts.system_program.to_account_info(),
        &crate::ID,
        event,
    )?;

    Ok(())
}

// ==================== Proof Attestor Registry ====================

#[derive(Accounts)]
pub struct InitializeProofAttestorRegistry<'info> {
    #[account(
        init,
        payer = admin,
        space = ProofAttestorRegistry::SPACE,
        seeds = [PROOF_ATTESTOR_REGISTRY_SEED],
        bump
    )]
    pub proof_attestor_registry: Account<'info, ProofAttestorRegistry>,

    #[account(
        seeds = [b"circle_manager"],
        bump = circle_manager.bump,
        constraint = circle_manager.admin == admin.key() @ AlchemeError::Unauthorized
    )]
    pub circle_manager: Account<'info, CircleManager>,

    #[account(mut)]
    pub admin: Signer<'info>,

    pub system_program: Program<'info, System>,
}

pub fn initialize_proof_attestor_registry(
    ctx: Context<InitializeProofAttestorRegistry>,
) -> Result<()> {
    ctx.accounts
        .proof_attestor_registry
        .initialize(ctx.bumps.proof_attestor_registry, ctx.accounts.admin.key())?;
    Ok(())
}

#[derive(Accounts)]
pub struct InitializeMembershipAttestorRegistry<'info> {
    #[account(
        init,
        payer = admin,
        space = MembershipAttestorRegistry::SPACE,
        seeds = [MEMBERSHIP_ATTESTOR_REGISTRY_SEED],
        bump
    )]
    pub membership_attestor_registry: Account<'info, MembershipAttestorRegistry>,

    #[account(
        seeds = [b"circle_manager"],
        bump = circle_manager.bump,
        constraint = circle_manager.admin == admin.key() @ AlchemeError::Unauthorized
    )]
    pub circle_manager: Account<'info, CircleManager>,

    #[account(mut)]
    pub admin: Signer<'info>,

    pub system_program: Program<'info, System>,
}

pub fn initialize_membership_attestor_registry(
    ctx: Context<InitializeMembershipAttestorRegistry>,
) -> Result<()> {
    ctx.accounts
        .membership_attestor_registry
        .initialize(ctx.bumps.membership_attestor_registry, ctx.accounts.admin.key())?;
    Ok(())
}

#[derive(Accounts)]
pub struct RegisterProofAttestor<'info> {
    #[account(
        mut,
        seeds = [PROOF_ATTESTOR_REGISTRY_SEED],
        bump = proof_attestor_registry.bump
    )]
    pub proof_attestor_registry: Account<'info, ProofAttestorRegistry>,

    #[account(mut)]
    pub admin: Signer<'info>,

    /// CHECK: Event Emitter program
    pub event_program: AccountInfo<'info>,

    /// CHECK: Event Emitter account
    #[account(mut)]
    pub event_emitter: AccountInfo<'info>,

    /// CHECK: Event Batch account
    #[account(mut)]
    pub event_batch: AccountInfo<'info>,

    pub system_program: Program<'info, System>,
}

pub fn register_proof_attestor(
    ctx: Context<RegisterProofAttestor>,
    attestor: Pubkey,
) -> Result<()> {
    let registry = &mut ctx.accounts.proof_attestor_registry;
    require!(
        registry.admin == ctx.accounts.admin.key(),
        AlchemeError::Unauthorized
    );
    registry.register_attestor(attestor)?;

    CpiHelper::emit_event_simple(
        &ctx.accounts.event_program,
        &mut ctx.accounts.event_emitter,
        &mut ctx.accounts.event_batch,
        &ctx.accounts.admin.to_account_info(),
        &ctx.accounts.system_program.to_account_info(),
        &crate::ID,
        ProtocolEvent::ProofAttestorRegistered {
            attestor,
            registered_by: ctx.accounts.admin.key(),
            timestamp: Clock::get()?.unix_timestamp,
        },
    )?;

    Ok(())
}

#[derive(Accounts)]
pub struct RegisterMembershipAttestor<'info> {
    #[account(
        mut,
        seeds = [MEMBERSHIP_ATTESTOR_REGISTRY_SEED],
        bump = membership_attestor_registry.bump
    )]
    pub membership_attestor_registry: Account<'info, MembershipAttestorRegistry>,

    #[account(mut)]
    pub admin: Signer<'info>,

    /// CHECK: Event Emitter program
    pub event_program: AccountInfo<'info>,

    /// CHECK: Event Emitter account
    #[account(mut)]
    pub event_emitter: AccountInfo<'info>,

    /// CHECK: Event Batch account
    #[account(mut)]
    pub event_batch: AccountInfo<'info>,

    pub system_program: Program<'info, System>,
}

pub fn register_membership_attestor(
    ctx: Context<RegisterMembershipAttestor>,
    attestor: Pubkey,
) -> Result<()> {
    let registry = &mut ctx.accounts.membership_attestor_registry;
    require!(
        registry.admin == ctx.accounts.admin.key(),
        AlchemeError::Unauthorized
    );
    registry.register_attestor(attestor)?;

    CpiHelper::emit_event_simple(
        &ctx.accounts.event_program,
        &mut ctx.accounts.event_emitter,
        &mut ctx.accounts.event_batch,
        &ctx.accounts.admin.to_account_info(),
        &ctx.accounts.system_program.to_account_info(),
        &crate::ID,
        ProtocolEvent::MembershipAttestorRegistered {
            attestor,
            registered_by: ctx.accounts.admin.key(),
            timestamp: Clock::get()?.unix_timestamp,
        },
    )?;
    Ok(())
}

#[derive(Accounts)]
pub struct RevokeMembershipAttestor<'info> {
    #[account(
        mut,
        seeds = [MEMBERSHIP_ATTESTOR_REGISTRY_SEED],
        bump = membership_attestor_registry.bump
    )]
    pub membership_attestor_registry: Account<'info, MembershipAttestorRegistry>,

    #[account(mut)]
    pub admin: Signer<'info>,

    /// CHECK: Event Emitter program
    pub event_program: AccountInfo<'info>,

    /// CHECK: Event Emitter account
    #[account(mut)]
    pub event_emitter: AccountInfo<'info>,

    /// CHECK: Event Batch account
    #[account(mut)]
    pub event_batch: AccountInfo<'info>,

    pub system_program: Program<'info, System>,
}

pub fn revoke_membership_attestor(
    ctx: Context<RevokeMembershipAttestor>,
    attestor: Pubkey,
) -> Result<()> {
    let registry = &mut ctx.accounts.membership_attestor_registry;
    require!(
        registry.admin == ctx.accounts.admin.key(),
        AlchemeError::Unauthorized
    );
    registry.revoke_attestor(&attestor)?;

    CpiHelper::emit_event_simple(
        &ctx.accounts.event_program,
        &mut ctx.accounts.event_emitter,
        &mut ctx.accounts.event_batch,
        &ctx.accounts.admin.to_account_info(),
        &ctx.accounts.system_program.to_account_info(),
        &crate::ID,
        ProtocolEvent::MembershipAttestorRevoked {
            attestor,
            revoked_by: ctx.accounts.admin.key(),
            timestamp: Clock::get()?.unix_timestamp,
        },
    )?;
    Ok(())
}

fn build_binding_signature_digest(
    source_anchor_id: [u8; 32],
    proof_package_hash: [u8; 32],
    contributors_root: [u8; 32],
    contributors_count: u16,
    binding_version: u16,
    generated_at: i64,
) -> [u8; 32] {
    anchor_lang::solana_program::hash::hashv(&[
        PROOF_BINDING_CANONICAL_DOMAIN,
        &proof_package_hash,
        &contributors_root,
        &contributors_count.to_le_bytes(),
        &source_anchor_id,
        &binding_version.to_le_bytes(),
        &generated_at.to_le_bytes(),
    ])
    .to_bytes()
}

fn verify_ed25519_binding_proof(
    instructions_sysvar: &AccountInfo,
    issuer_key_id: Pubkey,
    expected_message: [u8; 32],
    issued_signature: [u8; 64],
) -> Result<()> {
    let current_index = sysvar_instructions::load_current_index_checked(instructions_sysvar)
        .map_err(|_| error!(AlchemeError::ValidationFailed))? as usize;
    require!(current_index > 0, AlchemeError::ValidationFailed);
    let verify_ix = sysvar_instructions::load_instruction_at_checked(current_index - 1, instructions_sysvar)
        .map_err(|_| error!(AlchemeError::ValidationFailed))?;
    require!(verify_ix.program_id == ed25519_program::id(), AlchemeError::ValidationFailed);

    let data = verify_ix.data;
    require!(data.len() >= 16, AlchemeError::ValidationFailed);
    require!(data[0] == 1, AlchemeError::ValidationFailed);

    let signature_offset = u16::from_le_bytes([data[2], data[3]]) as usize;
    let signature_ix_index = u16::from_le_bytes([data[4], data[5]]);
    let pubkey_offset = u16::from_le_bytes([data[6], data[7]]) as usize;
    let pubkey_ix_index = u16::from_le_bytes([data[8], data[9]]);
    let message_offset = u16::from_le_bytes([data[10], data[11]]) as usize;
    let message_size = u16::from_le_bytes([data[12], data[13]]) as usize;
    let message_ix_index = u16::from_le_bytes([data[14], data[15]]);

    require!(signature_ix_index == u16::MAX, AlchemeError::ValidationFailed);
    require!(pubkey_ix_index == u16::MAX, AlchemeError::ValidationFailed);
    require!(message_ix_index == u16::MAX, AlchemeError::ValidationFailed);
    require!(message_size == 32, AlchemeError::ValidationFailed);
    require!(signature_offset + 64 <= data.len(), AlchemeError::ValidationFailed);
    require!(pubkey_offset + 32 <= data.len(), AlchemeError::ValidationFailed);
    require!(message_offset + message_size <= data.len(), AlchemeError::ValidationFailed);

    let signature_slice = &data[signature_offset..signature_offset + 64];
    let pubkey_slice = &data[pubkey_offset..pubkey_offset + 32];
    let message_slice = &data[message_offset..message_offset + message_size];

    require!(
        signature_slice == issued_signature.as_ref(),
        AlchemeError::ValidationFailed
    );
    require!(
        pubkey_slice == issuer_key_id.as_ref(),
        AlchemeError::ValidationFailed
    );
    require!(
        message_slice == expected_message.as_ref(),
        AlchemeError::ValidationFailed
    );

    Ok(())
}

fn verify_binding_context(
    circle: &Circle,
    knowledge: &Knowledge,
    proof_attestor_registry: &ProofAttestorRegistry,
    instructions_sysvar: &AccountInfo,
    authority: Pubkey,
    issuer_key_id: Pubkey,
    source_anchor_id: [u8; 32],
    proof_package_hash: [u8; 32],
    contributors_root: [u8; 32],
    contributors_count: u16,
    binding_version: u16,
    generated_at: i64,
    issued_signature: [u8; 64],
) -> Result<()> {
    require!(
        circle.is_curator(&authority),
        AlchemeError::InvalidOperation
    );
    require!(
        knowledge.circle_id == circle.circle_id,
        AlchemeError::InvalidOperation
    );
    require!(
        proof_attestor_registry.is_registered(&issuer_key_id),
        AlchemeError::Unauthorized
    );
    let expected = build_binding_signature_digest(
        source_anchor_id,
        proof_package_hash,
        contributors_root,
        contributors_count,
        binding_version,
        generated_at,
    );
    verify_ed25519_binding_proof(instructions_sysvar, issuer_key_id, expected, issued_signature)?;
    Ok(())
}

// ==================== Bind Contributor Proof ====================

#[derive(Accounts)]
pub struct BindContributorProof<'info> {
    #[account(mut)]
    pub knowledge: Account<'info, Knowledge>,

    #[account()]
    pub circle: Account<'info, Circle>,

    #[account(
        init,
        payer = authority,
        space = KnowledgeBinding::SPACE,
        seeds = [KNOWLEDGE_BINDING_SEED, knowledge.key().as_ref()],
        bump
    )]
    pub knowledge_binding: Account<'info, KnowledgeBinding>,

    #[account(
        seeds = [PROOF_ATTESTOR_REGISTRY_SEED],
        bump = proof_attestor_registry.bump
    )]
    pub proof_attestor_registry: Account<'info, ProofAttestorRegistry>,

    #[account(mut)]
    pub authority: Signer<'info>,

    /// CHECK: Solana Instructions sysvar account for ed25519 verification.
    #[account(address = sysvar_instructions::ID)]
    pub instructions_sysvar: AccountInfo<'info>,

    /// CHECK: Event Emitter program
    pub event_program: AccountInfo<'info>,

    /// CHECK: Event Emitter account
    #[account(mut)]
    pub event_emitter: AccountInfo<'info>,

    /// CHECK: Event Batch account
    #[account(mut)]
    pub event_batch: AccountInfo<'info>,

    pub system_program: Program<'info, System>,
}

pub fn bind_contributor_proof(
    ctx: Context<BindContributorProof>,
    source_anchor_id: [u8; 32],
    proof_package_hash: [u8; 32],
    contributors_root: [u8; 32],
    contributors_count: u16,
    binding_version: u16,
    generated_at: i64,
    issuer_key_id: Pubkey,
    issued_signature: [u8; 64],
) -> Result<()> {
    verify_binding_context(
        &ctx.accounts.circle,
        &ctx.accounts.knowledge,
        &ctx.accounts.proof_attestor_registry,
        &ctx.accounts.instructions_sysvar,
        ctx.accounts.authority.key(),
        issuer_key_id,
        source_anchor_id,
        proof_package_hash,
        contributors_root,
        contributors_count,
        binding_version,
        generated_at,
        issued_signature,
    )?;

    let knowledge_binding = &mut ctx.accounts.knowledge_binding;
    knowledge_binding.initialize(
        ctx.accounts.knowledge.key(),
        source_anchor_id,
        proof_package_hash,
        contributors_root,
        contributors_count,
        binding_version,
        generated_at,
        ctx.accounts.authority.key(),
        ctx.bumps.knowledge_binding,
    )?;

    CpiHelper::emit_event_simple(
        &ctx.accounts.event_program,
        &mut ctx.accounts.event_emitter,
        &mut ctx.accounts.event_batch,
        &ctx.accounts.authority.to_account_info(),
        &ctx.accounts.system_program.to_account_info(),
        &crate::ID,
        ProtocolEvent::ContributorProofBound {
            knowledge_id: ctx.accounts.knowledge.knowledge_id,
            source_anchor_id,
            proof_package_hash,
            contributors_root,
            contributors_count,
            binding_version,
            generated_at,
            bound_by: ctx.accounts.authority.key(),
            bound_at: knowledge_binding.bound_at,
        },
    )?;

    Ok(())
}

#[derive(Accounts)]
pub struct BindAndUpdateContributors<'info> {
    #[account(mut)]
    pub knowledge: Account<'info, Knowledge>,

    #[account()]
    pub circle: Account<'info, Circle>,

    #[account(
        init,
        payer = authority,
        space = KnowledgeBinding::SPACE,
        seeds = [KNOWLEDGE_BINDING_SEED, knowledge.key().as_ref()],
        bump
    )]
    pub knowledge_binding: Account<'info, KnowledgeBinding>,

    #[account(
        seeds = [PROOF_ATTESTOR_REGISTRY_SEED],
        bump = proof_attestor_registry.bump
    )]
    pub proof_attestor_registry: Account<'info, ProofAttestorRegistry>,

    #[account(mut)]
    pub authority: Signer<'info>,

    /// CHECK: Solana Instructions sysvar account for ed25519 verification.
    #[account(address = sysvar_instructions::ID)]
    pub instructions_sysvar: AccountInfo<'info>,

    /// CHECK: Event Emitter program
    pub event_program: AccountInfo<'info>,

    /// CHECK: Event Emitter account
    #[account(mut)]
    pub event_emitter: AccountInfo<'info>,

    /// CHECK: Event Batch account
    #[account(mut)]
    pub event_batch: AccountInfo<'info>,

    pub system_program: Program<'info, System>,
}

pub fn bind_and_update_contributors(
    ctx: Context<BindAndUpdateContributors>,
    source_anchor_id: [u8; 32],
    proof_package_hash: [u8; 32],
    contributors_root: [u8; 32],
    contributors_count: u16,
    binding_version: u16,
    generated_at: i64,
    issuer_key_id: Pubkey,
    issued_signature: [u8; 64],
) -> Result<()> {
    verify_binding_context(
        &ctx.accounts.circle,
        &ctx.accounts.knowledge,
        &ctx.accounts.proof_attestor_registry,
        &ctx.accounts.instructions_sysvar,
        ctx.accounts.authority.key(),
        issuer_key_id,
        source_anchor_id,
        proof_package_hash,
        contributors_root,
        contributors_count,
        binding_version,
        generated_at,
        issued_signature,
    )?;

    let knowledge_binding = &mut ctx.accounts.knowledge_binding;
    knowledge_binding.initialize(
        ctx.accounts.knowledge.key(),
        source_anchor_id,
        proof_package_hash,
        contributors_root,
        contributors_count,
        binding_version,
        generated_at,
        ctx.accounts.authority.key(),
        ctx.bumps.knowledge_binding,
    )?;

    require!(
        ctx.accounts.authority.key() == knowledge_binding.bound_by,
        AlchemeError::Unauthorized
    );

    let knowledge = &mut ctx.accounts.knowledge;
    knowledge.contributors_root = contributors_root;
    knowledge.contributors_count = contributors_count;
    let version = knowledge.version() + 1;
    knowledge.set_version(version);

    CpiHelper::batch_emit_events_simple(
        &ctx.accounts.event_program,
        &mut ctx.accounts.event_emitter,
        &mut ctx.accounts.event_batch,
        &ctx.accounts.authority.to_account_info(),
        &ctx.accounts.system_program.to_account_info(),
        &crate::ID,
        vec![
            ProtocolEvent::ContributorProofBound {
                knowledge_id: knowledge.knowledge_id,
                source_anchor_id,
                proof_package_hash,
                contributors_root,
                contributors_count,
                binding_version,
                generated_at,
                bound_by: ctx.accounts.authority.key(),
                bound_at: knowledge_binding.bound_at,
            },
            ProtocolEvent::ContributorsUpdated {
                knowledge_id: knowledge.knowledge_id,
                contributors_root,
                contributors_count,
                version,
                updated_by: ctx.accounts.authority.key(),
                timestamp: Clock::get()?.unix_timestamp,
            },
        ],
    )?;

    Ok(())
}

// ==================== Update Contributors (Merkle Root) ====================

#[derive(Accounts)]
pub struct UpdateContributors<'info> {
    #[account(mut)]
    pub knowledge: Account<'info, Knowledge>,

    #[account()]
    pub circle: Account<'info, Circle>,

    #[account(
        seeds = [KNOWLEDGE_BINDING_SEED, knowledge.key().as_ref()],
        bump = knowledge_binding.bump,
        constraint = knowledge_binding.knowledge == knowledge.key() @ AlchemeError::InvalidOperation
    )]
    pub knowledge_binding: Account<'info, KnowledgeBinding>,

    #[account(mut)]
    pub authority: Signer<'info>,

    /// CHECK: Event Emitter program
    pub event_program: AccountInfo<'info>,

    /// CHECK: Event Emitter account
    #[account(mut)]
    pub event_emitter: AccountInfo<'info>,

    /// CHECK: Event Batch account
    #[account(mut)]
    pub event_batch: AccountInfo<'info>,

    pub system_program: Program<'info, System>,
}

/// 兼容路径：已绑定前提下更新贡献者 Root
pub fn update_contributors(
    ctx: Context<UpdateContributors>,
    proof_package_hash: [u8; 32],
    contributors_root: [u8; 32],
    contributors_count: u16,
) -> Result<()> {
    let circle = &ctx.accounts.circle;
    let knowledge = &mut ctx.accounts.knowledge;
    let knowledge_binding = &ctx.accounts.knowledge_binding;

    require!(
        knowledge.circle_id == circle.circle_id,
        AlchemeError::InvalidOperation
    );
    require!(
        knowledge_binding.bound_by == ctx.accounts.authority.key(),
        AlchemeError::Unauthorized
    );
    require!(
        proof_package_hash == knowledge_binding.proof_package_hash,
        AlchemeError::ValidationFailed
    );
    require!(
        contributors_root == knowledge_binding.contributors_root
            && contributors_count == knowledge_binding.contributors_count,
        AlchemeError::ValidationFailed
    );

    knowledge.contributors_root = contributors_root;
    knowledge.contributors_count = contributors_count;
    let version = knowledge.version() + 1;
    knowledge.set_version(version);

    CpiHelper::emit_event_simple(
        &ctx.accounts.event_program,
        &mut ctx.accounts.event_emitter,
        &mut ctx.accounts.event_batch,
        &ctx.accounts.authority.to_account_info(),
        &ctx.accounts.system_program.to_account_info(),
        &crate::ID,
        ProtocolEvent::ContributorsUpdated {
            knowledge_id: knowledge.knowledge_id,
            contributors_root,
            contributors_count,
            version,
            updated_by: ctx.accounts.authority.key(),
            timestamp: Clock::get()?.unix_timestamp,
        },
    )?;

    Ok(())
}

// ==================== Extension CPI 接口 ====================

/// 通过扩展程序提升知识评分（需要 CircleExtend 权限）
/// 用于 contribution-engine 等扩展根据贡献质量提升知识分数
#[derive(Accounts)]
pub struct CpiPromoteKnowledge<'info> {
    #[account(mut)]
    pub knowledge: Account<'info, Knowledge>,

    #[account()]
    pub circle: Account<'info, Circle>,

    /// CHECK: 调用的扩展程序 ID
    pub caller_program: AccountInfo<'info>,

    /// CHECK: ExtensionRegistry PDA
    pub extension_registry: AccountInfo<'info>,

    pub authority: Signer<'info>,
}

pub fn cpi_promote_knowledge(
    ctx: Context<CpiPromoteKnowledge>,
    quality_delta: f64,
    reason: String,
) -> Result<()> {
    // 通过 ExtensionRegistry 验证调用者权限
    alcheme_cpi::require_cpi_permission_with_registry!(
        &ctx.accounts.caller_program.key(),
        alcheme_cpi::CpiPermission::CircleExtend,
        Some(&ctx.accounts.extension_registry)
    );

    let circle = &ctx.accounts.circle;
    let knowledge = &mut ctx.accounts.knowledge;
    require!(
        knowledge.circle_id == circle.circle_id,
        AlchemeError::InvalidOperation
    );

    // 安全地更新质量分数（限制在 0.0 - 100.0 范围）
    let new_score = (knowledge.quality_score + quality_delta).clamp(0.0, 100.0);
    knowledge.quality_score = new_score;

    msg!("Extension 知识评分提升: knowledge={:?}, new_score={}, delta={}, caller={}, reason={}",
         knowledge.knowledge_id, new_score, quality_delta,
         ctx.accounts.caller_program.key(), reason);

    Ok(())
}
