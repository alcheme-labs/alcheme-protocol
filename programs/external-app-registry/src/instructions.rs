use crate::state::*;
use crate::validation::*;
use alcheme_cpi::CpiHelper;
use alcheme_shared::{ExternalAppRegistryStatus, ProtocolEvent};
use anchor_lang::prelude::*;

#[derive(Accounts)]
pub struct InitializeRegistry<'info> {
    #[account(
        init,
        payer = admin,
        space = ExternalAppRegistryConfig::SPACE,
        seeds = [REGISTRY_CONFIG_SEED],
        bump
    )]
    pub registry_config: Account<'info, ExternalAppRegistryConfig>,

    #[account(mut)]
    pub admin: Signer<'info>,

    pub system_program: Program<'info, System>,
}

pub fn initialize_registry(
    ctx: Context<InitializeRegistry>,
    governance_authority: Pubkey,
    event_program: Pubkey,
    event_emitter: Pubkey,
) -> Result<()> {
    require_nonzero_hash(&event_program.to_bytes())?;
    require_nonzero_hash(&event_emitter.to_bytes())?;
    ctx.accounts.registry_config.initialize(
        ctx.bumps.registry_config,
        ctx.accounts.admin.key(),
        governance_authority,
        event_program,
        event_emitter,
    )
}

#[derive(Accounts)]
#[instruction(app_id_hash: [u8; 32])]
pub struct AnchorExternalAppRegistration<'info> {
    #[account(
        mut,
        seeds = [REGISTRY_CONFIG_SEED],
        bump = registry_config.bump
    )]
    pub registry_config: Account<'info, ExternalAppRegistryConfig>,

    #[account(
        init_if_needed,
        payer = governance_authority,
        space = ExternalAppRecord::SPACE,
        seeds = [EXTERNAL_APP_RECORD_SEED, app_id_hash.as_ref()],
        bump
    )]
    pub external_app_record: Account<'info, ExternalAppRecord>,

    #[account(mut)]
    pub governance_authority: Signer<'info>,

    /// CHECK: Event Emitter program, validated against registry config and CPI helper.
    pub event_program: AccountInfo<'info>,

    /// CHECK: Event Emitter state account, validated against registry config and CPI helper.
    #[account(mut)]
    pub event_emitter: AccountInfo<'info>,

    /// CHECK: Event Batch account, validated by Event Emitter CPI.
    #[account(mut)]
    pub event_batch: AccountInfo<'info>,

    pub system_program: Program<'info, System>,
}

#[allow(clippy::too_many_arguments)]
pub fn anchor_external_app_registration(
    ctx: Context<AnchorExternalAppRegistration>,
    app_id_hash: [u8; 32],
    owner: Pubkey,
    server_key_hash: [u8; 32],
    manifest_hash: [u8; 32],
    owner_assertion_hash: [u8; 32],
    policy_state_digest: [u8; 32],
    review_circle_id: u32,
    review_policy_digest: [u8; 32],
    decision_digest: [u8; 32],
    execution_intent_digest: [u8; 32],
    expires_at: i64,
) -> Result<()> {
    require_registration_inputs(
        &app_id_hash,
        &owner,
        &server_key_hash,
        &manifest_hash,
        &owner_assertion_hash,
        &policy_state_digest,
        &review_policy_digest,
        &decision_digest,
        &execution_intent_digest,
    )?;
    require_governance_authority(&ctx.accounts.registry_config, &ctx.accounts.governance_authority)?;
    require_registry_unpaused(&ctx.accounts.registry_config)?;
    validate_event_accounts(
        &ctx.accounts.registry_config,
        &ctx.accounts.event_program,
        &ctx.accounts.event_emitter,
    )?;

    let is_new = ctx.accounts.external_app_record.upsert_registration(
        ctx.bumps.external_app_record,
        app_id_hash,
        owner,
        server_key_hash,
        manifest_hash,
        owner_assertion_hash,
        policy_state_digest,
        review_circle_id,
        review_policy_digest,
        decision_digest,
        execution_intent_digest,
        expires_at,
    )?;
    if is_new {
        ctx.accounts.registry_config.total_apps =
            ctx.accounts.registry_config.total_apps.saturating_add(1);
    }
    ctx.accounts.registry_config.touch()?;

    emit_registry_event(
        &mut ctx.accounts.event_program,
        &mut ctx.accounts.event_emitter,
        &mut ctx.accounts.event_batch,
        &ctx.accounts.governance_authority.to_account_info(),
        &ctx.accounts.system_program.to_account_info(),
        ProtocolEvent::ExternalAppRegisteredV2 {
            app_id_hash,
            owner,
            manifest_hash,
            server_key_hash,
            owner_assertion_hash,
            policy_state_digest,
            review_circle_id,
            review_policy_digest,
            decision_digest,
            execution_intent_digest,
            timestamp: Clock::get()?.unix_timestamp,
        },
    )?;

    Ok(())
}

#[derive(Accounts)]
#[instruction(app_id_hash: [u8; 32])]
pub struct AnchorExecutionReceipt<'info> {
    #[account(
        mut,
        seeds = [REGISTRY_CONFIG_SEED],
        bump = registry_config.bump
    )]
    pub registry_config: Account<'info, ExternalAppRegistryConfig>,

    #[account(
        mut,
        seeds = [EXTERNAL_APP_RECORD_SEED, app_id_hash.as_ref()],
        bump = external_app_record.bump
    )]
    pub external_app_record: Account<'info, ExternalAppRecord>,

    #[account(mut)]
    pub governance_authority: Signer<'info>,

    /// CHECK: Event Emitter program, validated against registry config and CPI helper.
    pub event_program: AccountInfo<'info>,

    /// CHECK: Event Emitter state account, validated against registry config and CPI helper.
    #[account(mut)]
    pub event_emitter: AccountInfo<'info>,

    /// CHECK: Event Batch account, validated by Event Emitter CPI.
    #[account(mut)]
    pub event_batch: AccountInfo<'info>,

    pub system_program: Program<'info, System>,
}

pub fn anchor_execution_receipt(
    ctx: Context<AnchorExecutionReceipt>,
    app_id_hash: [u8; 32],
    execution_receipt_digest: [u8; 32],
) -> Result<()> {
    require_nonzero_hash(&app_id_hash)?;
    require_nonzero_hash(&execution_receipt_digest)?;
    require_governance_authority(&ctx.accounts.registry_config, &ctx.accounts.governance_authority)?;
    require_registry_unpaused(&ctx.accounts.registry_config)?;
    validate_record_app_id(&ctx.accounts.external_app_record, &app_id_hash)?;
    validate_event_accounts(
        &ctx.accounts.registry_config,
        &ctx.accounts.event_program,
        &ctx.accounts.event_emitter,
    )?;

    let decision_digest = ctx.accounts.external_app_record.decision_digest;
    let execution_intent_digest = ctx.accounts.external_app_record.execution_intent_digest;
    ctx.accounts.external_app_record.execution_receipt_digest = Some(execution_receipt_digest);
    ctx.accounts.external_app_record.touch()?;
    ctx.accounts.registry_config.touch()?;

    emit_registry_event(
        &mut ctx.accounts.event_program,
        &mut ctx.accounts.event_emitter,
        &mut ctx.accounts.event_batch,
        &ctx.accounts.governance_authority.to_account_info(),
        &ctx.accounts.system_program.to_account_info(),
        ProtocolEvent::ExternalAppExecutionReceiptAnchoredV2 {
            app_id_hash,
            decision_digest,
            execution_intent_digest,
            execution_receipt_digest,
            timestamp: Clock::get()?.unix_timestamp,
        },
    )?;

    Ok(())
}

#[derive(Accounts)]
#[instruction(app_id_hash: [u8; 32])]
pub struct UpdateExternalAppRegistryRecord<'info> {
    #[account(
        mut,
        seeds = [REGISTRY_CONFIG_SEED],
        bump = registry_config.bump
    )]
    pub registry_config: Account<'info, ExternalAppRegistryConfig>,

    #[account(
        mut,
        seeds = [EXTERNAL_APP_RECORD_SEED, app_id_hash.as_ref()],
        bump = external_app_record.bump
    )]
    pub external_app_record: Account<'info, ExternalAppRecord>,

    #[account(mut)]
    pub governance_authority: Signer<'info>,

    /// CHECK: Event Emitter program, validated against registry config and CPI helper.
    pub event_program: AccountInfo<'info>,

    /// CHECK: Event Emitter state account, validated against registry config and CPI helper.
    #[account(mut)]
    pub event_emitter: AccountInfo<'info>,

    /// CHECK: Event Batch account, validated by Event Emitter CPI.
    #[account(mut)]
    pub event_batch: AccountInfo<'info>,

    pub system_program: Program<'info, System>,
}

pub fn rotate_server_key(
    ctx: Context<UpdateExternalAppRegistryRecord>,
    app_id_hash: [u8; 32],
    server_key_hash: [u8; 32],
    decision_digest: [u8; 32],
    execution_intent_digest: [u8; 32],
) -> Result<()> {
    require_update_context(
        &ctx.accounts.registry_config,
        &ctx.accounts.external_app_record,
        &ctx.accounts.governance_authority,
        &ctx.accounts.event_program,
        &ctx.accounts.event_emitter,
        &app_id_hash,
    )?;
    require_nonzero_hash(&server_key_hash)?;
    require_nonzero_hash(&decision_digest)?;
    require_nonzero_hash(&execution_intent_digest)?;

    ctx.accounts.external_app_record.server_key_hash = server_key_hash;
    ctx.accounts.external_app_record.decision_digest = decision_digest;
    ctx.accounts.external_app_record.execution_intent_digest = execution_intent_digest;
    ctx.accounts.external_app_record.execution_receipt_digest = None;
    ctx.accounts.external_app_record.touch()?;
    ctx.accounts.registry_config.touch()?;

    emit_registry_event(
        &mut ctx.accounts.event_program,
        &mut ctx.accounts.event_emitter,
        &mut ctx.accounts.event_batch,
        &ctx.accounts.governance_authority.to_account_info(),
        &ctx.accounts.system_program.to_account_info(),
        ProtocolEvent::ExternalAppServerKeyRotatedV2 {
            app_id_hash,
            server_key_hash,
            decision_digest,
            execution_intent_digest,
            timestamp: Clock::get()?.unix_timestamp,
        },
    )?;

    Ok(())
}

pub fn update_manifest_hash(
    ctx: Context<UpdateExternalAppRegistryRecord>,
    app_id_hash: [u8; 32],
    manifest_hash: [u8; 32],
    policy_state_digest: [u8; 32],
    decision_digest: [u8; 32],
    execution_intent_digest: [u8; 32],
) -> Result<()> {
    require_update_context(
        &ctx.accounts.registry_config,
        &ctx.accounts.external_app_record,
        &ctx.accounts.governance_authority,
        &ctx.accounts.event_program,
        &ctx.accounts.event_emitter,
        &app_id_hash,
    )?;
    require_nonzero_hash(&manifest_hash)?;
    require_nonzero_hash(&policy_state_digest)?;
    require_nonzero_hash(&decision_digest)?;
    require_nonzero_hash(&execution_intent_digest)?;

    ctx.accounts.external_app_record.manifest_hash = manifest_hash;
    ctx.accounts.external_app_record.policy_state_digest = policy_state_digest;
    ctx.accounts.external_app_record.decision_digest = decision_digest;
    ctx.accounts.external_app_record.execution_intent_digest = execution_intent_digest;
    ctx.accounts.external_app_record.execution_receipt_digest = None;
    ctx.accounts.external_app_record.touch()?;
    ctx.accounts.registry_config.touch()?;

    emit_registry_event(
        &mut ctx.accounts.event_program,
        &mut ctx.accounts.event_emitter,
        &mut ctx.accounts.event_batch,
        &ctx.accounts.governance_authority.to_account_info(),
        &ctx.accounts.system_program.to_account_info(),
        ProtocolEvent::ExternalAppManifestUpdatedV2 {
            app_id_hash,
            manifest_hash,
            policy_state_digest,
            decision_digest,
            execution_intent_digest,
            timestamp: Clock::get()?.unix_timestamp,
        },
    )?;

    Ok(())
}

pub fn set_registry_status(
    ctx: Context<UpdateExternalAppRegistryRecord>,
    app_id_hash: [u8; 32],
    registry_status: ExternalAppRegistryStatus,
    decision_digest: [u8; 32],
    execution_intent_digest: [u8; 32],
) -> Result<()> {
    require_update_context(
        &ctx.accounts.registry_config,
        &ctx.accounts.external_app_record,
        &ctx.accounts.governance_authority,
        &ctx.accounts.event_program,
        &ctx.accounts.event_emitter,
        &app_id_hash,
    )?;
    require_nonzero_hash(&decision_digest)?;
    require_nonzero_hash(&execution_intent_digest)?;
    require_valid_status_transition(
        ctx.accounts.external_app_record.registry_status,
        registry_status,
    )?;

    ctx.accounts.external_app_record.registry_status = registry_status;
    ctx.accounts.external_app_record.decision_digest = decision_digest;
    ctx.accounts.external_app_record.execution_intent_digest = execution_intent_digest;
    ctx.accounts.external_app_record.execution_receipt_digest = None;
    if registry_status == ExternalAppRegistryStatus::Revoked {
        ctx.accounts.external_app_record.revoked_at = Clock::get()?.unix_timestamp;
    }
    ctx.accounts.external_app_record.touch()?;
    ctx.accounts.registry_config.touch()?;

    emit_registry_event(
        &mut ctx.accounts.event_program,
        &mut ctx.accounts.event_emitter,
        &mut ctx.accounts.event_batch,
        &ctx.accounts.governance_authority.to_account_info(),
        &ctx.accounts.system_program.to_account_info(),
        ProtocolEvent::ExternalAppRegistryStatusChangedV2 {
            app_id_hash,
            status: registry_status,
            decision_digest,
            execution_intent_digest,
            timestamp: Clock::get()?.unix_timestamp,
        },
    )?;

    Ok(())
}

#[derive(Accounts)]
pub struct SetGovernanceAuthority<'info> {
    #[account(
        mut,
        seeds = [REGISTRY_CONFIG_SEED],
        bump = registry_config.bump
    )]
    pub registry_config: Account<'info, ExternalAppRegistryConfig>,

    pub admin: Signer<'info>,

    /// CHECK: Event Emitter program, validated against registry config and CPI helper.
    pub event_program: AccountInfo<'info>,

    /// CHECK: Event Emitter state account, validated against registry config and CPI helper.
    #[account(mut)]
    pub event_emitter: AccountInfo<'info>,

    /// CHECK: Event Batch account, validated by Event Emitter CPI.
    #[account(mut)]
    pub event_batch: AccountInfo<'info>,

    pub system_program: Program<'info, System>,
}

pub fn set_governance_authority(
    ctx: Context<SetGovernanceAuthority>,
    governance_authority: Pubkey,
) -> Result<()> {
    require_keys_eq!(
        ctx.accounts.admin.key(),
        ctx.accounts.registry_config.admin,
        ExternalAppRegistryError::UnauthorizedGovernanceAuthority
    );
    require_nonzero_hash(&governance_authority.to_bytes())?;
    validate_event_accounts(
        &ctx.accounts.registry_config,
        &ctx.accounts.event_program,
        &ctx.accounts.event_emitter,
    )?;
    let old_governance_authority = ctx.accounts.registry_config.governance_authority;
    ctx.accounts.registry_config.governance_authority = governance_authority;
    ctx.accounts.registry_config.touch()?;

    emit_registry_event(
        &mut ctx.accounts.event_program,
        &mut ctx.accounts.event_emitter,
        &mut ctx.accounts.event_batch,
        &ctx.accounts.admin.to_account_info(),
        &ctx.accounts.system_program.to_account_info(),
        ProtocolEvent::ExternalAppRegistryAuthorityChangedV2 {
            admin: ctx.accounts.admin.key(),
            old_governance_authority,
            new_governance_authority: governance_authority,
            timestamp: Clock::get()?.unix_timestamp,
        },
    )?;

    Ok(())
}

#[derive(Accounts)]
pub struct PauseRegistry<'info> {
    #[account(
        mut,
        seeds = [REGISTRY_CONFIG_SEED],
        bump = registry_config.bump
    )]
    pub registry_config: Account<'info, ExternalAppRegistryConfig>,

    pub admin: Signer<'info>,
}

pub fn pause_registry(ctx: Context<PauseRegistry>, paused: bool) -> Result<()> {
    require_keys_eq!(
        ctx.accounts.admin.key(),
        ctx.accounts.registry_config.admin,
        ExternalAppRegistryError::UnauthorizedGovernanceAuthority
    );
    ctx.accounts.registry_config.paused = paused;
    ctx.accounts.registry_config.touch()
}

#[allow(clippy::too_many_arguments)]
fn require_registration_inputs(
    app_id_hash: &[u8; 32],
    owner: &Pubkey,
    server_key_hash: &[u8; 32],
    manifest_hash: &[u8; 32],
    owner_assertion_hash: &[u8; 32],
    policy_state_digest: &[u8; 32],
    review_policy_digest: &[u8; 32],
    decision_digest: &[u8; 32],
    execution_intent_digest: &[u8; 32],
) -> Result<()> {
    require_nonzero_hash(app_id_hash)?;
    require_nonzero_hash(&owner.to_bytes())?;
    require_nonzero_hash(server_key_hash)?;
    require_nonzero_hash(manifest_hash)?;
    require_nonzero_hash(owner_assertion_hash)?;
    require_nonzero_hash(policy_state_digest)?;
    require_nonzero_hash(review_policy_digest)?;
    require_nonzero_hash(decision_digest)?;
    require_nonzero_hash(execution_intent_digest)
}

fn require_update_context(
    registry_config: &ExternalAppRegistryConfig,
    external_app_record: &ExternalAppRecord,
    governance_authority: &Signer<'_>,
    event_program: &AccountInfo<'_>,
    event_emitter: &AccountInfo<'_>,
    app_id_hash: &[u8; 32],
) -> Result<()> {
    require_nonzero_hash(app_id_hash)?;
    require_governance_authority(registry_config, governance_authority)?;
    require_registry_unpaused(registry_config)?;
    validate_record_app_id(external_app_record, app_id_hash)?;
    validate_event_accounts(registry_config, event_program, event_emitter)
}

fn validate_record_app_id(
    external_app_record: &ExternalAppRecord,
    app_id_hash: &[u8; 32],
) -> Result<()> {
    require!(
        external_app_record.app_id_hash == *app_id_hash,
        ExternalAppRegistryError::InvalidDigest
    );
    Ok(())
}

fn emit_registry_event<'info>(
    event_program: &mut AccountInfo<'info>,
    event_emitter: &mut AccountInfo<'info>,
    event_batch: &mut AccountInfo<'info>,
    payer: &AccountInfo<'info>,
    system_program: &AccountInfo<'info>,
    event: ProtocolEvent,
) -> Result<u64> {
    CpiHelper::emit_event_simple(
        event_program,
        event_emitter,
        event_batch,
        payer,
        system_program,
        &crate::ID,
        event,
    )
}
