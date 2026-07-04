use crate::state::*;
use crate::validation::*;
use anchor_lang::prelude::*;

#[derive(AnchorSerialize, AnchorDeserialize, Clone, Debug)]
pub struct GovernanceExecutionProof {
    pub receipt_digest: [u8; 32],
    pub operation_id_hash: [u8; 32],
    pub replay_domain_hash: [u8; 32],
    pub execution_nonce_hash: [u8; 32],
    pub execution_target_hash: [u8; 32],
    pub state_precondition_digest: [u8; 32],
    pub state_after_digest: [u8; 32],
    pub source_tx_signature: Option<[u8; 64]>,
}

#[event]
pub struct HostedAppTrustRootMutationEvent {
    pub receipt_digest: [u8; 32],
    pub operation_id_hash: [u8; 32],
    pub replay_domain_hash: [u8; 32],
    pub execution_nonce_hash: [u8; 32],
    pub execution_target_hash: [u8; 32],
    pub state_after_digest: [u8; 32],
    pub executed_by: Pubkey,
    pub executed_at: i64,
}

#[derive(Accounts)]
pub struct InitializeAppTrustRoot<'info> {
    #[account(
        init,
        payer = admin,
        space = AppTrustRootConfig::SPACE,
        seeds = [APP_TRUST_ROOT_CONFIG_SEED],
        bump
    )]
    pub app_trust_root_config: Account<'info, AppTrustRootConfig>,

    #[account(mut)]
    pub admin: Signer<'info>,

    pub system_program: Program<'info, System>,
}

pub fn initialize_app_trust_root(
    ctx: Context<InitializeAppTrustRoot>,
    governance_authority: Pubkey,
    emergency_authority: Pubkey,
    event_program: Pubkey,
    event_emitter: Pubkey,
) -> Result<()> {
    require_nonzero_digest(&governance_authority.to_bytes())?;
    require_nonzero_digest(&emergency_authority.to_bytes())?;
    require_nonzero_digest(&event_program.to_bytes())?;
    require_nonzero_digest(&event_emitter.to_bytes())?;

    ctx.accounts.app_trust_root_config.initialize(
        ctx.bumps.app_trust_root_config,
        ctx.accounts.admin.key(),
        governance_authority,
        emergency_authority,
        event_program,
        event_emitter,
    )
}

#[derive(Accounts)]
#[instruction(app_id_hash: [u8; 32], proof: GovernanceExecutionProof)]
pub struct RegisterHostedAppIdentity<'info> {
    #[account(
        mut,
        seeds = [APP_TRUST_ROOT_CONFIG_SEED],
        bump = app_trust_root_config.bump
    )]
    pub app_trust_root_config: Account<'info, AppTrustRootConfig>,

    #[account(
        init,
        payer = governance_authority,
        space = HostedAppIdentityRecord::SPACE,
        seeds = [HOSTED_APP_IDENTITY_SEED, app_id_hash.as_ref()],
        bump
    )]
    pub hosted_app_identity: Box<Account<'info, HostedAppIdentityRecord>>,

    #[account(
        init,
        payer = governance_authority,
        space = HostedAppGovernanceExecutionRecord::SPACE,
        seeds = [
            HOSTED_APP_GOVERNANCE_EXECUTION_SEED,
            proof.replay_domain_hash.as_ref(),
            proof.execution_nonce_hash.as_ref()
        ],
        bump
    )]
    pub governance_execution_record: Account<'info, HostedAppGovernanceExecutionRecord>,

    #[account(
        init,
        payer = governance_authority,
        space = HostedAppGovernanceReceiptTargetGuard::SPACE,
        seeds = [
            HOSTED_APP_GOVERNANCE_RECEIPT_TARGET_GUARD_SEED,
            proof.receipt_digest.as_ref(),
            proof.execution_target_hash.as_ref()
        ],
        bump
    )]
    pub governance_receipt_target_guard: Account<'info, HostedAppGovernanceReceiptTargetGuard>,

    #[account(mut)]
    pub governance_authority: Signer<'info>,

    /// CHECK: validated against AppTrustRootConfig event_program.
    pub event_program: AccountInfo<'info>,

    /// CHECK: validated against AppTrustRootConfig event_emitter.
    pub event_emitter: AccountInfo<'info>,

    pub system_program: Program<'info, System>,
}

#[allow(clippy::too_many_arguments)]
pub fn register_hosted_app_identity(
    ctx: Context<RegisterHostedAppIdentity>,
    app_id_hash: [u8; 32],
    owner: Pubkey,
    operator_authority: Pubkey,
    governance_authority_ref_hash: [u8; 32],
    server_key_hash: [u8; 32],
    manifest_hash: [u8; 32],
    capability_policy_digest: [u8; 32],
    proof: GovernanceExecutionProof,
) -> Result<()> {
    let now = Clock::get()?.unix_timestamp;
    require_governance_mutation(
        &ctx.accounts.app_trust_root_config,
        &ctx.accounts.governance_authority,
        &ctx.accounts.event_program,
        &ctx.accounts.event_emitter,
    )?;

    ctx.accounts.hosted_app_identity.register(
        ctx.bumps.hosted_app_identity,
        app_id_hash,
        owner,
        operator_authority,
        governance_authority_ref_hash,
        server_key_hash,
        manifest_hash,
        capability_policy_digest,
        now,
    )?;
    ctx.accounts.app_trust_root_config.total_apps = ctx
        .accounts
        .app_trust_root_config
        .total_apps
        .saturating_add(1);
    ctx.accounts.app_trust_root_config.touch()?;

    let governance_execution_record_key = ctx.accounts.governance_execution_record.key();
    consume_governance_execution(
        &mut ctx.accounts.governance_execution_record,
        ctx.bumps.governance_execution_record,
        &mut ctx.accounts.governance_receipt_target_guard,
        ctx.bumps.governance_receipt_target_guard,
        governance_execution_record_key,
        &proof,
        MISSING_ACCOUNT_STATE_DIGEST,
        ctx.accounts.hosted_app_identity.state_digest(),
        ctx.accounts.governance_authority.key(),
        now,
    )
}

#[derive(Accounts)]
#[instruction(app_id_hash: [u8; 32], proof: GovernanceExecutionProof)]
pub struct SetHostedAppStatus<'info> {
    #[account(
        mut,
        seeds = [APP_TRUST_ROOT_CONFIG_SEED],
        bump = app_trust_root_config.bump
    )]
    pub app_trust_root_config: Account<'info, AppTrustRootConfig>,

    #[account(
        mut,
        seeds = [HOSTED_APP_IDENTITY_SEED, app_id_hash.as_ref()],
        bump = hosted_app_identity.bump
    )]
    pub hosted_app_identity: Account<'info, HostedAppIdentityRecord>,

    #[account(
        init,
        payer = authority,
        space = HostedAppGovernanceExecutionRecord::SPACE,
        seeds = [
            HOSTED_APP_GOVERNANCE_EXECUTION_SEED,
            proof.replay_domain_hash.as_ref(),
            proof.execution_nonce_hash.as_ref()
        ],
        bump
    )]
    pub governance_execution_record: Account<'info, HostedAppGovernanceExecutionRecord>,

    #[account(
        init,
        payer = authority,
        space = HostedAppGovernanceReceiptTargetGuard::SPACE,
        seeds = [
            HOSTED_APP_GOVERNANCE_RECEIPT_TARGET_GUARD_SEED,
            proof.receipt_digest.as_ref(),
            proof.execution_target_hash.as_ref()
        ],
        bump
    )]
    pub governance_receipt_target_guard: Account<'info, HostedAppGovernanceReceiptTargetGuard>,

    #[account(mut)]
    pub authority: Signer<'info>,

    /// CHECK: validated against AppTrustRootConfig event_program.
    pub event_program: AccountInfo<'info>,

    /// CHECK: validated against AppTrustRootConfig event_emitter.
    pub event_emitter: AccountInfo<'info>,

    pub system_program: Program<'info, System>,
}

pub fn set_hosted_app_status(
    ctx: Context<SetHostedAppStatus>,
    _app_id_hash: [u8; 32],
    next_status: HostedAppProductionStatus,
    emergency: bool,
    proof: GovernanceExecutionProof,
) -> Result<()> {
    let now = Clock::get()?.unix_timestamp;
    require_authorized_mutation(
        &ctx.accounts.app_trust_root_config,
        &ctx.accounts.authority,
        emergency,
        &ctx.accounts.event_program,
        &ctx.accounts.event_emitter,
    )?;
    if emergency {
        require!(
            next_status != HostedAppProductionStatus::Active,
            HostedAppTrustRootError::EmergencyExpansionForbidden
        );
    }

    let precondition_digest = ctx.accounts.hosted_app_identity.state_digest();
    ctx.accounts
        .hosted_app_identity
        .set_status(next_status, proof.receipt_digest, now)?;
    let state_after_digest = ctx.accounts.hosted_app_identity.state_digest();
    ctx.accounts.app_trust_root_config.touch()?;

    let governance_execution_record_key = ctx.accounts.governance_execution_record.key();
    consume_governance_execution(
        &mut ctx.accounts.governance_execution_record,
        ctx.bumps.governance_execution_record,
        &mut ctx.accounts.governance_receipt_target_guard,
        ctx.bumps.governance_receipt_target_guard,
        governance_execution_record_key,
        &proof,
        precondition_digest,
        state_after_digest,
        ctx.accounts.authority.key(),
        now,
    )
}

#[derive(Accounts)]
#[instruction(app_id_hash: [u8; 32], release_id_hash: [u8; 32], proof: GovernanceExecutionProof)]
pub struct AnchorHostedAppRelease<'info> {
    #[account(
        mut,
        seeds = [APP_TRUST_ROOT_CONFIG_SEED],
        bump = app_trust_root_config.bump
    )]
    pub app_trust_root_config: Account<'info, AppTrustRootConfig>,

    #[account(
        mut,
        seeds = [HOSTED_APP_IDENTITY_SEED, app_id_hash.as_ref()],
        bump = hosted_app_identity.bump
    )]
    pub hosted_app_identity: Account<'info, HostedAppIdentityRecord>,

    #[account(
        init,
        payer = governance_authority,
        space = HostedAppReleaseCommitment::SPACE,
        seeds = [
            HOSTED_APP_RELEASE_SEED,
            app_id_hash.as_ref(),
            release_id_hash.as_ref()
        ],
        bump
    )]
    pub release_commitment: Box<Account<'info, HostedAppReleaseCommitment>>,

    #[account(
        init,
        payer = governance_authority,
        space = HostedAppGovernanceExecutionRecord::SPACE,
        seeds = [
            HOSTED_APP_GOVERNANCE_EXECUTION_SEED,
            proof.replay_domain_hash.as_ref(),
            proof.execution_nonce_hash.as_ref()
        ],
        bump
    )]
    pub governance_execution_record: Box<Account<'info, HostedAppGovernanceExecutionRecord>>,

    #[account(
        init,
        payer = governance_authority,
        space = HostedAppGovernanceReceiptTargetGuard::SPACE,
        seeds = [
            HOSTED_APP_GOVERNANCE_RECEIPT_TARGET_GUARD_SEED,
            proof.receipt_digest.as_ref(),
            proof.execution_target_hash.as_ref()
        ],
        bump
    )]
    pub governance_receipt_target_guard: Box<Account<'info, HostedAppGovernanceReceiptTargetGuard>>,

    #[account(mut)]
    pub governance_authority: Signer<'info>,

    /// CHECK: validated against AppTrustRootConfig event_program.
    pub event_program: AccountInfo<'info>,

    /// CHECK: validated against AppTrustRootConfig event_emitter.
    pub event_emitter: AccountInfo<'info>,

    pub system_program: Program<'info, System>,
}

#[allow(clippy::too_many_arguments)]
pub fn anchor_hosted_app_release(
    ctx: Context<AnchorHostedAppRelease>,
    app_id_hash: [u8; 32],
    release_id_hash: [u8; 32],
    manifest_hash: [u8; 32],
    bundle_hash: [u8; 32],
    bundle_uri_hash: [u8; 32],
    release_payload_digest: [u8; 32],
    bundle_cid_hash: Option<[u8; 32]>,
    capability_set_digest: [u8; 32],
    developer_pubkey: Pubkey,
    developer_signature_digest: [u8; 32],
    release_kind: HostedAppReleaseKind,
    support_status: HostedAppSupportStatus,
    promotion_digest: [u8; 32],
    proof: GovernanceExecutionProof,
) -> Result<()> {
    let now = Clock::get()?.unix_timestamp;
    require_governance_mutation(
        &ctx.accounts.app_trust_root_config,
        &ctx.accounts.governance_authority,
        &ctx.accounts.event_program,
        &ctx.accounts.event_emitter,
    )?;
    require_active_hosted_app_identity(&ctx.accounts.hosted_app_identity)?;

    ctx.accounts.release_commitment.anchor(
        ctx.bumps.release_commitment,
        app_id_hash,
        release_id_hash,
        manifest_hash,
        bundle_hash,
        bundle_uri_hash,
        release_payload_digest,
        bundle_cid_hash,
        capability_set_digest,
        developer_pubkey,
        developer_signature_digest,
        release_kind,
        support_status,
        promotion_digest,
        now,
    )?;
    let commitment_digest = ctx.accounts.release_commitment.commitment_digest();
    ctx.accounts.hosted_app_identity.latest_release_digest = commitment_digest;
    ctx.accounts.hosted_app_identity.updated_at = now;
    ctx.accounts.app_trust_root_config.touch()?;

    let governance_execution_record_key = ctx.accounts.governance_execution_record.key();
    consume_governance_execution(
        &mut ctx.accounts.governance_execution_record,
        ctx.bumps.governance_execution_record,
        &mut ctx.accounts.governance_receipt_target_guard,
        ctx.bumps.governance_receipt_target_guard,
        governance_execution_record_key,
        &proof,
        MISSING_ACCOUNT_STATE_DIGEST,
        commitment_digest,
        ctx.accounts.governance_authority.key(),
        now,
    )
}

#[derive(Accounts)]
#[instruction(
    app_id_hash: [u8; 32],
    channel_id_hash: [u8; 32],
    current_release_id_hash: [u8; 32],
    proof: GovernanceExecutionProof
)]
pub struct MoveHostedAppReleaseChannel<'info> {
    #[account(
        mut,
        seeds = [APP_TRUST_ROOT_CONFIG_SEED],
        bump = app_trust_root_config.bump
    )]
    pub app_trust_root_config: Account<'info, AppTrustRootConfig>,

    #[account(
        seeds = [HOSTED_APP_IDENTITY_SEED, app_id_hash.as_ref()],
        bump = hosted_app_identity.bump
    )]
    pub hosted_app_identity: Box<Account<'info, HostedAppIdentityRecord>>,

    #[account(
        seeds = [
            HOSTED_APP_RELEASE_SEED,
            app_id_hash.as_ref(),
            current_release_id_hash.as_ref()
        ],
        bump = current_release_commitment.bump
    )]
    pub current_release_commitment: Box<Account<'info, HostedAppReleaseCommitment>>,

    #[account(
        init_if_needed,
        payer = governance_authority,
        space = HostedAppReleaseChannelCommitment::SPACE,
        seeds = [
            HOSTED_APP_RELEASE_CHANNEL_SEED,
            app_id_hash.as_ref(),
            channel_id_hash.as_ref()
        ],
        bump
    )]
    pub release_channel_commitment: Box<Account<'info, HostedAppReleaseChannelCommitment>>,

    #[account(
        init,
        payer = governance_authority,
        space = HostedAppGovernanceExecutionRecord::SPACE,
        seeds = [
            HOSTED_APP_GOVERNANCE_EXECUTION_SEED,
            proof.replay_domain_hash.as_ref(),
            proof.execution_nonce_hash.as_ref()
        ],
        bump
    )]
    pub governance_execution_record: Box<Account<'info, HostedAppGovernanceExecutionRecord>>,

    #[account(
        init,
        payer = governance_authority,
        space = HostedAppGovernanceReceiptTargetGuard::SPACE,
        seeds = [
            HOSTED_APP_GOVERNANCE_RECEIPT_TARGET_GUARD_SEED,
            proof.receipt_digest.as_ref(),
            proof.execution_target_hash.as_ref()
        ],
        bump
    )]
    pub governance_receipt_target_guard: Box<Account<'info, HostedAppGovernanceReceiptTargetGuard>>,

    #[account(mut)]
    pub governance_authority: Signer<'info>,

    /// CHECK: validated against AppTrustRootConfig event_program.
    pub event_program: AccountInfo<'info>,

    /// CHECK: validated against AppTrustRootConfig event_emitter.
    pub event_emitter: AccountInfo<'info>,

    pub system_program: Program<'info, System>,
}

#[allow(clippy::too_many_arguments)]
pub fn move_hosted_app_release_channel(
    ctx: Context<MoveHostedAppReleaseChannel>,
    app_id_hash: [u8; 32],
    channel_id_hash: [u8; 32],
    current_release_id_hash: [u8; 32],
    previous_release_id_hash: Option<[u8; 32]>,
    channel_policy_digest: [u8; 32],
    movement_receipt_digest: [u8; 32],
    proof: GovernanceExecutionProof,
) -> Result<()> {
    let now = Clock::get()?.unix_timestamp;
    require_governance_mutation(
        &ctx.accounts.app_trust_root_config,
        &ctx.accounts.governance_authority,
        &ctx.accounts.event_program,
        &ctx.accounts.event_emitter,
    )?;
    require_active_hosted_app_identity(&ctx.accounts.hosted_app_identity)?;
    require_active_release_commitment(
        &ctx.accounts.current_release_commitment,
        app_id_hash,
        current_release_id_hash,
    )?;

    let precondition_digest = if ctx.accounts.release_channel_commitment.app_id_hash == [0; 32] {
        MISSING_ACCOUNT_STATE_DIGEST
    } else {
        ctx.accounts.release_channel_commitment.commitment_digest()
    };
    ctx.accounts.release_channel_commitment.move_channel(
        ctx.bumps.release_channel_commitment,
        app_id_hash,
        channel_id_hash,
        current_release_id_hash,
        previous_release_id_hash,
        channel_policy_digest,
        movement_receipt_digest,
        ctx.accounts.governance_authority.key(),
        now,
    )?;
    let state_after_digest = ctx.accounts.release_channel_commitment.commitment_digest();
    ctx.accounts.app_trust_root_config.touch()?;

    let governance_execution_record_key = ctx.accounts.governance_execution_record.key();
    consume_governance_execution(
        &mut ctx.accounts.governance_execution_record,
        ctx.bumps.governance_execution_record,
        &mut ctx.accounts.governance_receipt_target_guard,
        ctx.bumps.governance_receipt_target_guard,
        governance_execution_record_key,
        &proof,
        precondition_digest,
        state_after_digest,
        ctx.accounts.governance_authority.key(),
        now,
    )
}

#[derive(Accounts)]
#[instruction(app_id_hash: [u8; 32], capability_id_hash: [u8; 32], proof: GovernanceExecutionProof)]
pub struct UpsertHostedAppCapabilityDeny<'info> {
    #[account(
        mut,
        seeds = [APP_TRUST_ROOT_CONFIG_SEED],
        bump = app_trust_root_config.bump
    )]
    pub app_trust_root_config: Account<'info, AppTrustRootConfig>,

    #[account(
        mut,
        seeds = [HOSTED_APP_IDENTITY_SEED, app_id_hash.as_ref()],
        bump = hosted_app_identity.bump
    )]
    pub hosted_app_identity: Account<'info, HostedAppIdentityRecord>,

    #[account(
        init_if_needed,
        payer = authority,
        space = HostedAppCapabilityDenyCommitment::SPACE,
        seeds = [
            HOSTED_APP_CAPABILITY_DENY_SEED,
            app_id_hash.as_ref(),
            capability_id_hash.as_ref()
        ],
        bump
    )]
    pub capability_deny_commitment: Account<'info, HostedAppCapabilityDenyCommitment>,

    #[account(
        init,
        payer = authority,
        space = HostedAppGovernanceExecutionRecord::SPACE,
        seeds = [
            HOSTED_APP_GOVERNANCE_EXECUTION_SEED,
            proof.replay_domain_hash.as_ref(),
            proof.execution_nonce_hash.as_ref()
        ],
        bump
    )]
    pub governance_execution_record: Account<'info, HostedAppGovernanceExecutionRecord>,

    #[account(
        init,
        payer = authority,
        space = HostedAppGovernanceReceiptTargetGuard::SPACE,
        seeds = [
            HOSTED_APP_GOVERNANCE_RECEIPT_TARGET_GUARD_SEED,
            proof.receipt_digest.as_ref(),
            proof.execution_target_hash.as_ref()
        ],
        bump
    )]
    pub governance_receipt_target_guard: Account<'info, HostedAppGovernanceReceiptTargetGuard>,

    #[account(mut)]
    pub authority: Signer<'info>,

    /// CHECK: validated against AppTrustRootConfig event_program.
    pub event_program: AccountInfo<'info>,

    /// CHECK: validated against AppTrustRootConfig event_emitter.
    pub event_emitter: AccountInfo<'info>,

    pub system_program: Program<'info, System>,
}

#[allow(clippy::too_many_arguments)]
pub fn upsert_hosted_app_capability_deny(
    ctx: Context<UpsertHostedAppCapabilityDeny>,
    app_id_hash: [u8; 32],
    release_id_hash: Option<[u8; 32]>,
    capability_id_hash: [u8; 32],
    deny_scope_hash: [u8; 32],
    authority_ref_hash: [u8; 32],
    reason_code_hash: [u8; 32],
    effective_at: i64,
    expires_at: Option<i64>,
    emergency: bool,
    proof: GovernanceExecutionProof,
) -> Result<()> {
    let now = Clock::get()?.unix_timestamp;
    require_authorized_mutation(
        &ctx.accounts.app_trust_root_config,
        &ctx.accounts.authority,
        emergency,
        &ctx.accounts.event_program,
        &ctx.accounts.event_emitter,
    )?;

    let deny_already_exists = ctx.accounts.capability_deny_commitment.app_id_hash != [0; 32];
    if emergency && deny_already_exists {
        return err!(HostedAppTrustRootError::EmergencyExpansionForbidden);
    }
    let precondition_digest = if !deny_already_exists {
        MISSING_ACCOUNT_STATE_DIGEST
    } else {
        ctx.accounts.capability_deny_commitment.commitment_digest()
    };
    ctx.accounts.capability_deny_commitment.upsert(
        ctx.bumps.capability_deny_commitment,
        app_id_hash,
        release_id_hash,
        capability_id_hash,
        deny_scope_hash,
        authority_ref_hash,
        reason_code_hash,
        effective_at,
        expires_at,
        proof.receipt_digest,
        now,
    )?;
    let deny_digest = ctx.accounts.capability_deny_commitment.commitment_digest();
    ctx.accounts.hosted_app_identity.latest_deny_digest = deny_digest;
    ctx.accounts.hosted_app_identity.updated_at = now;
    ctx.accounts.app_trust_root_config.touch()?;

    let governance_execution_record_key = ctx.accounts.governance_execution_record.key();
    consume_governance_execution(
        &mut ctx.accounts.governance_execution_record,
        ctx.bumps.governance_execution_record,
        &mut ctx.accounts.governance_receipt_target_guard,
        ctx.bumps.governance_receipt_target_guard,
        governance_execution_record_key,
        &proof,
        precondition_digest,
        deny_digest,
        ctx.accounts.authority.key(),
        now,
    )
}

#[derive(Accounts)]
#[instruction(object_ref_hash: [u8; 32], digest: [u8; 32], proof: GovernanceExecutionProof)]
pub struct AnchorHostedAppCredentialDigest<'info> {
    #[account(
        mut,
        seeds = [APP_TRUST_ROOT_CONFIG_SEED],
        bump = app_trust_root_config.bump
    )]
    pub app_trust_root_config: Account<'info, AppTrustRootConfig>,

    #[account(
        init,
        payer = governance_authority,
        space = HostedAppCredentialDigestAnchor::SPACE,
        seeds = [
            HOSTED_APP_CREDENTIAL_ANCHOR_SEED,
            object_ref_hash.as_ref(),
            digest.as_ref()
        ],
        bump
    )]
    pub credential_digest_anchor: Account<'info, HostedAppCredentialDigestAnchor>,

    #[account(
        init,
        payer = governance_authority,
        space = HostedAppGovernanceExecutionRecord::SPACE,
        seeds = [
            HOSTED_APP_GOVERNANCE_EXECUTION_SEED,
            proof.replay_domain_hash.as_ref(),
            proof.execution_nonce_hash.as_ref()
        ],
        bump
    )]
    pub governance_execution_record: Account<'info, HostedAppGovernanceExecutionRecord>,

    #[account(
        init,
        payer = governance_authority,
        space = HostedAppGovernanceReceiptTargetGuard::SPACE,
        seeds = [
            HOSTED_APP_GOVERNANCE_RECEIPT_TARGET_GUARD_SEED,
            proof.receipt_digest.as_ref(),
            proof.execution_target_hash.as_ref()
        ],
        bump
    )]
    pub governance_receipt_target_guard: Account<'info, HostedAppGovernanceReceiptTargetGuard>,

    #[account(mut)]
    pub governance_authority: Signer<'info>,

    /// CHECK: validated against AppTrustRootConfig event_program.
    pub event_program: AccountInfo<'info>,

    /// CHECK: validated against AppTrustRootConfig event_emitter.
    pub event_emitter: AccountInfo<'info>,

    pub system_program: Program<'info, System>,
}

#[allow(clippy::too_many_arguments)]
pub fn anchor_hosted_app_credential_digest(
    ctx: Context<AnchorHostedAppCredentialDigest>,
    anchor_type: HostedAppCredentialAnchorType,
    object_ref_hash: [u8; 32],
    digest: [u8; 32],
    schema_digest: Option<[u8; 32]>,
    verifier_policy_digest: Option<[u8; 32]>,
    revocation_feed_digest: Option<[u8; 32]>,
    expires_at: Option<i64>,
    proof: GovernanceExecutionProof,
) -> Result<()> {
    anchor_credential_digest_inner(
        ctx,
        anchor_type,
        object_ref_hash,
        digest,
        schema_digest,
        verifier_policy_digest,
        revocation_feed_digest,
        expires_at,
        proof,
    )
}

#[allow(clippy::too_many_arguments)]
pub fn anchor_hosted_app_offline_bundle_digest(
    ctx: Context<AnchorHostedAppCredentialDigest>,
    object_ref_hash: [u8; 32],
    bundle_digest: [u8; 32],
    issuer_key_set_digest: [u8; 32],
    verifier_policy_digest: [u8; 32],
    revocation_snapshot_digest: [u8; 32],
    expires_at: i64,
    proof: GovernanceExecutionProof,
) -> Result<()> {
    anchor_credential_digest_inner(
        ctx,
        HostedAppCredentialAnchorType::OfflineVerificationBundle,
        object_ref_hash,
        bundle_digest,
        Some(issuer_key_set_digest),
        Some(verifier_policy_digest),
        Some(revocation_snapshot_digest),
        Some(expires_at),
        proof,
    )
}

#[derive(Accounts)]
#[instruction(object_ref_hash: [u8; 32], digest: [u8; 32], proof: GovernanceExecutionProof)]
pub struct AnchorHostedAppPolicyDigest<'info> {
    #[account(
        mut,
        seeds = [APP_TRUST_ROOT_CONFIG_SEED],
        bump = app_trust_root_config.bump
    )]
    pub app_trust_root_config: Account<'info, AppTrustRootConfig>,

    #[account(
        init,
        payer = governance_authority,
        space = HostedAppPolicyDigestAnchor::SPACE,
        seeds = [
            HOSTED_APP_POLICY_ANCHOR_SEED,
            object_ref_hash.as_ref(),
            digest.as_ref()
        ],
        bump
    )]
    pub policy_digest_anchor: Account<'info, HostedAppPolicyDigestAnchor>,

    #[account(
        init,
        payer = governance_authority,
        space = HostedAppGovernanceExecutionRecord::SPACE,
        seeds = [
            HOSTED_APP_GOVERNANCE_EXECUTION_SEED,
            proof.replay_domain_hash.as_ref(),
            proof.execution_nonce_hash.as_ref()
        ],
        bump
    )]
    pub governance_execution_record: Account<'info, HostedAppGovernanceExecutionRecord>,

    #[account(
        init,
        payer = governance_authority,
        space = HostedAppGovernanceReceiptTargetGuard::SPACE,
        seeds = [
            HOSTED_APP_GOVERNANCE_RECEIPT_TARGET_GUARD_SEED,
            proof.receipt_digest.as_ref(),
            proof.execution_target_hash.as_ref()
        ],
        bump
    )]
    pub governance_receipt_target_guard: Account<'info, HostedAppGovernanceReceiptTargetGuard>,

    #[account(mut)]
    pub governance_authority: Signer<'info>,

    /// CHECK: validated against AppTrustRootConfig event_program.
    pub event_program: AccountInfo<'info>,

    /// CHECK: validated against AppTrustRootConfig event_emitter.
    pub event_emitter: AccountInfo<'info>,

    pub system_program: Program<'info, System>,
}

#[allow(clippy::too_many_arguments)]
pub fn anchor_hosted_app_policy_digest(
    ctx: Context<AnchorHostedAppPolicyDigest>,
    anchor_type: HostedAppPolicyAnchorType,
    object_ref_hash: [u8; 32],
    digest: [u8; 32],
    policy_version_hash: Option<[u8; 32]>,
    governance_decision_digest: Option<[u8; 32]>,
    effective_at: i64,
    expires_at: Option<i64>,
    proof: GovernanceExecutionProof,
) -> Result<()> {
    let now = Clock::get()?.unix_timestamp;
    require_governance_mutation(
        &ctx.accounts.app_trust_root_config,
        &ctx.accounts.governance_authority,
        &ctx.accounts.event_program,
        &ctx.accounts.event_emitter,
    )?;

    ctx.accounts.policy_digest_anchor.anchor(
        ctx.bumps.policy_digest_anchor,
        anchor_type,
        object_ref_hash,
        digest,
        policy_version_hash,
        governance_decision_digest,
        effective_at,
        expires_at,
        now,
    )?;
    let state_after_digest = ctx.accounts.policy_digest_anchor.commitment_digest();
    ctx.accounts.app_trust_root_config.touch()?;

    let governance_execution_record_key = ctx.accounts.governance_execution_record.key();
    consume_governance_execution(
        &mut ctx.accounts.governance_execution_record,
        ctx.bumps.governance_execution_record,
        &mut ctx.accounts.governance_receipt_target_guard,
        ctx.bumps.governance_receipt_target_guard,
        governance_execution_record_key,
        &proof,
        MISSING_ACCOUNT_STATE_DIGEST,
        state_after_digest,
        ctx.accounts.governance_authority.key(),
        now,
    )
}

#[derive(Accounts)]
#[instruction(
    app_id_hash: [u8; 32],
    circle_id_hash: [u8; 32],
    current_release_id_hash: [u8; 32],
    proof: GovernanceExecutionProof
)]
pub struct AnchorHostedAppCircleInstallationDigest<'info> {
    #[account(
        mut,
        seeds = [APP_TRUST_ROOT_CONFIG_SEED],
        bump = app_trust_root_config.bump
    )]
    pub app_trust_root_config: Account<'info, AppTrustRootConfig>,

    #[account(
        seeds = [HOSTED_APP_IDENTITY_SEED, app_id_hash.as_ref()],
        bump = hosted_app_identity.bump
    )]
    pub hosted_app_identity: Box<Account<'info, HostedAppIdentityRecord>>,

    #[account(
        seeds = [
            HOSTED_APP_RELEASE_SEED,
            app_id_hash.as_ref(),
            current_release_id_hash.as_ref()
        ],
        bump = current_release_commitment.bump
    )]
    pub current_release_commitment: Box<Account<'info, HostedAppReleaseCommitment>>,

    #[account(
        init,
        payer = governance_authority,
        space = HostedAppCircleInstallationCommitment::SPACE,
        seeds = [
            HOSTED_APP_INSTALLATION_SEED,
            app_id_hash.as_ref(),
            circle_id_hash.as_ref()
        ],
        bump
    )]
    pub installation_commitment: Box<Account<'info, HostedAppCircleInstallationCommitment>>,

    #[account(
        init,
        payer = governance_authority,
        space = HostedAppGovernanceExecutionRecord::SPACE,
        seeds = [
            HOSTED_APP_GOVERNANCE_EXECUTION_SEED,
            proof.replay_domain_hash.as_ref(),
            proof.execution_nonce_hash.as_ref()
        ],
        bump
    )]
    pub governance_execution_record: Box<Account<'info, HostedAppGovernanceExecutionRecord>>,

    #[account(
        init,
        payer = governance_authority,
        space = HostedAppGovernanceReceiptTargetGuard::SPACE,
        seeds = [
            HOSTED_APP_GOVERNANCE_RECEIPT_TARGET_GUARD_SEED,
            proof.receipt_digest.as_ref(),
            proof.execution_target_hash.as_ref()
        ],
        bump
    )]
    pub governance_receipt_target_guard: Box<Account<'info, HostedAppGovernanceReceiptTargetGuard>>,

    #[account(mut)]
    pub governance_authority: Signer<'info>,

    /// CHECK: validated against AppTrustRootConfig event_program.
    pub event_program: AccountInfo<'info>,

    /// CHECK: validated against AppTrustRootConfig event_emitter.
    pub event_emitter: AccountInfo<'info>,

    pub system_program: Program<'info, System>,
}

#[allow(clippy::too_many_arguments)]
pub fn anchor_hosted_app_circle_installation_digest(
    ctx: Context<AnchorHostedAppCircleInstallationDigest>,
    app_id_hash: [u8; 32],
    circle_id_hash: [u8; 32],
    release_id_hash: Option<[u8; 32]>,
    channel_id_hash: Option<[u8; 32]>,
    current_release_id_hash: [u8; 32],
    manifest_hash: [u8; 32],
    update_policy_hash: [u8; 32],
    allowed_capabilities_digest: [u8; 32],
    trust_state_hash: [u8; 32],
    policy_epoch: u64,
    governance_receipt_digest: Option<[u8; 32]>,
    installation_digest: [u8; 32],
    visibility: HostedAppInstallationVisibility,
    proof: GovernanceExecutionProof,
) -> Result<()> {
    let now = Clock::get()?.unix_timestamp;
    require_governance_mutation(
        &ctx.accounts.app_trust_root_config,
        &ctx.accounts.governance_authority,
        &ctx.accounts.event_program,
        &ctx.accounts.event_emitter,
    )?;
    require_active_hosted_app_identity(&ctx.accounts.hosted_app_identity)?;
    require_active_release_commitment(
        &ctx.accounts.current_release_commitment,
        app_id_hash,
        current_release_id_hash,
    )?;

    ctx.accounts.installation_commitment.anchor(
        ctx.bumps.installation_commitment,
        app_id_hash,
        circle_id_hash,
        release_id_hash,
        channel_id_hash,
        current_release_id_hash,
        manifest_hash,
        update_policy_hash,
        allowed_capabilities_digest,
        trust_state_hash,
        policy_epoch,
        governance_receipt_digest,
        installation_digest,
        visibility,
        now,
    )?;
    let state_after_digest = ctx.accounts.installation_commitment.commitment_digest();
    ctx.accounts.app_trust_root_config.touch()?;

    let governance_execution_record_key = ctx.accounts.governance_execution_record.key();
    consume_governance_execution(
        &mut ctx.accounts.governance_execution_record,
        ctx.bumps.governance_execution_record,
        &mut ctx.accounts.governance_receipt_target_guard,
        ctx.bumps.governance_receipt_target_guard,
        governance_execution_record_key,
        &proof,
        MISSING_ACCOUNT_STATE_DIGEST,
        state_after_digest,
        ctx.accounts.governance_authority.key(),
        now,
    )
}

#[derive(Accounts)]
#[instruction(proof: GovernanceExecutionProof)]
pub struct RotateGovernanceAuthority<'info> {
    #[account(
        mut,
        seeds = [APP_TRUST_ROOT_CONFIG_SEED],
        bump = app_trust_root_config.bump
    )]
    pub app_trust_root_config: Account<'info, AppTrustRootConfig>,

    #[account(
        init,
        payer = governance_authority,
        space = HostedAppGovernanceExecutionRecord::SPACE,
        seeds = [
            HOSTED_APP_GOVERNANCE_EXECUTION_SEED,
            proof.replay_domain_hash.as_ref(),
            proof.execution_nonce_hash.as_ref()
        ],
        bump
    )]
    pub governance_execution_record: Account<'info, HostedAppGovernanceExecutionRecord>,

    #[account(
        init,
        payer = governance_authority,
        space = HostedAppGovernanceReceiptTargetGuard::SPACE,
        seeds = [
            HOSTED_APP_GOVERNANCE_RECEIPT_TARGET_GUARD_SEED,
            proof.receipt_digest.as_ref(),
            proof.execution_target_hash.as_ref()
        ],
        bump
    )]
    pub governance_receipt_target_guard: Account<'info, HostedAppGovernanceReceiptTargetGuard>,

    #[account(mut)]
    pub governance_authority: Signer<'info>,

    /// CHECK: validated against AppTrustRootConfig event_program.
    pub event_program: AccountInfo<'info>,

    /// CHECK: validated against AppTrustRootConfig event_emitter.
    pub event_emitter: AccountInfo<'info>,

    pub system_program: Program<'info, System>,
}

pub fn rotate_governance_authority(
    ctx: Context<RotateGovernanceAuthority>,
    next_governance_authority: Pubkey,
    proof: GovernanceExecutionProof,
) -> Result<()> {
    let now = Clock::get()?.unix_timestamp;
    require_governance_mutation(
        &ctx.accounts.app_trust_root_config,
        &ctx.accounts.governance_authority,
        &ctx.accounts.event_program,
        &ctx.accounts.event_emitter,
    )?;
    require_nonzero_digest(&next_governance_authority.to_bytes())?;

    let precondition_digest = ctx.accounts.app_trust_root_config.state_digest();
    ctx.accounts.app_trust_root_config.governance_authority = next_governance_authority;
    ctx.accounts.app_trust_root_config.touch()?;
    let state_after_digest = ctx.accounts.app_trust_root_config.state_digest();

    let governance_execution_record_key = ctx.accounts.governance_execution_record.key();
    consume_governance_execution(
        &mut ctx.accounts.governance_execution_record,
        ctx.bumps.governance_execution_record,
        &mut ctx.accounts.governance_receipt_target_guard,
        ctx.bumps.governance_receipt_target_guard,
        governance_execution_record_key,
        &proof,
        precondition_digest,
        state_after_digest,
        ctx.accounts.governance_authority.key(),
        now,
    )
}

#[derive(Accounts)]
#[instruction(proof: GovernanceExecutionProof)]
pub struct PauseAppTrustRoot<'info> {
    #[account(
        mut,
        seeds = [APP_TRUST_ROOT_CONFIG_SEED],
        bump = app_trust_root_config.bump
    )]
    pub app_trust_root_config: Account<'info, AppTrustRootConfig>,

    #[account(
        init,
        payer = authority,
        space = HostedAppGovernanceExecutionRecord::SPACE,
        seeds = [
            HOSTED_APP_GOVERNANCE_EXECUTION_SEED,
            proof.replay_domain_hash.as_ref(),
            proof.execution_nonce_hash.as_ref()
        ],
        bump
    )]
    pub governance_execution_record: Account<'info, HostedAppGovernanceExecutionRecord>,

    #[account(
        init,
        payer = authority,
        space = HostedAppGovernanceReceiptTargetGuard::SPACE,
        seeds = [
            HOSTED_APP_GOVERNANCE_RECEIPT_TARGET_GUARD_SEED,
            proof.receipt_digest.as_ref(),
            proof.execution_target_hash.as_ref()
        ],
        bump
    )]
    pub governance_receipt_target_guard: Account<'info, HostedAppGovernanceReceiptTargetGuard>,

    #[account(mut)]
    pub authority: Signer<'info>,

    /// CHECK: validated against AppTrustRootConfig event_program.
    pub event_program: AccountInfo<'info>,

    /// CHECK: validated against AppTrustRootConfig event_emitter.
    pub event_emitter: AccountInfo<'info>,

    pub system_program: Program<'info, System>,
}

pub fn pause_app_trust_root(
    ctx: Context<PauseAppTrustRoot>,
    paused: bool,
    emergency: bool,
    proof: GovernanceExecutionProof,
) -> Result<()> {
    let now = Clock::get()?.unix_timestamp;
    require_authorized_mutation(
        &ctx.accounts.app_trust_root_config,
        &ctx.accounts.authority,
        emergency,
        &ctx.accounts.event_program,
        &ctx.accounts.event_emitter,
    )?;
    if emergency {
        require!(paused, HostedAppTrustRootError::EmergencyExpansionForbidden);
    }

    let precondition_digest = ctx.accounts.app_trust_root_config.state_digest();
    ctx.accounts.app_trust_root_config.paused = paused;
    ctx.accounts.app_trust_root_config.touch()?;
    let state_after_digest = ctx.accounts.app_trust_root_config.state_digest();

    let governance_execution_record_key = ctx.accounts.governance_execution_record.key();
    consume_governance_execution(
        &mut ctx.accounts.governance_execution_record,
        ctx.bumps.governance_execution_record,
        &mut ctx.accounts.governance_receipt_target_guard,
        ctx.bumps.governance_receipt_target_guard,
        governance_execution_record_key,
        &proof,
        precondition_digest,
        state_after_digest,
        ctx.accounts.authority.key(),
        now,
    )
}

#[allow(clippy::too_many_arguments)]
fn anchor_credential_digest_inner(
    ctx: Context<AnchorHostedAppCredentialDigest>,
    anchor_type: HostedAppCredentialAnchorType,
    object_ref_hash: [u8; 32],
    digest: [u8; 32],
    schema_digest: Option<[u8; 32]>,
    verifier_policy_digest: Option<[u8; 32]>,
    revocation_feed_digest: Option<[u8; 32]>,
    expires_at: Option<i64>,
    proof: GovernanceExecutionProof,
) -> Result<()> {
    let now = Clock::get()?.unix_timestamp;
    require_governance_mutation(
        &ctx.accounts.app_trust_root_config,
        &ctx.accounts.governance_authority,
        &ctx.accounts.event_program,
        &ctx.accounts.event_emitter,
    )?;

    ctx.accounts.credential_digest_anchor.anchor(
        ctx.bumps.credential_digest_anchor,
        anchor_type,
        object_ref_hash,
        digest,
        schema_digest,
        verifier_policy_digest,
        revocation_feed_digest,
        expires_at,
        now,
    )?;
    let state_after_digest = ctx.accounts.credential_digest_anchor.commitment_digest();
    ctx.accounts.app_trust_root_config.touch()?;

    let governance_execution_record_key = ctx.accounts.governance_execution_record.key();
    consume_governance_execution(
        &mut ctx.accounts.governance_execution_record,
        ctx.bumps.governance_execution_record,
        &mut ctx.accounts.governance_receipt_target_guard,
        ctx.bumps.governance_receipt_target_guard,
        governance_execution_record_key,
        &proof,
        MISSING_ACCOUNT_STATE_DIGEST,
        state_after_digest,
        ctx.accounts.governance_authority.key(),
        now,
    )
}

fn require_governance_mutation(
    config: &AppTrustRootConfig,
    governance_authority: &Signer<'_>,
    event_program: &AccountInfo<'_>,
    event_emitter: &AccountInfo<'_>,
) -> Result<()> {
    require_trust_root_unpaused(config)?;
    require_governance_authority(config, governance_authority)?;
    validate_event_accounts(config, event_program, event_emitter)
}

fn require_authorized_mutation(
    config: &AppTrustRootConfig,
    authority: &Signer<'_>,
    emergency: bool,
    event_program: &AccountInfo<'_>,
    event_emitter: &AccountInfo<'_>,
) -> Result<()> {
    if emergency {
        require_emergency_authority(config, authority)?;
    } else {
        require_governance_authority(config, authority)?;
    }
    validate_event_accounts(config, event_program, event_emitter)
}

fn consume_governance_execution(
    governance_execution_record: &mut Account<'_, HostedAppGovernanceExecutionRecord>,
    bump: u8,
    governance_receipt_target_guard: &mut Account<'_, HostedAppGovernanceReceiptTargetGuard>,
    receipt_target_guard_bump: u8,
    governance_execution_record_key: Pubkey,
    proof: &GovernanceExecutionProof,
    expected_state_precondition_digest: [u8; 32],
    expected_state_after_digest: [u8; 32],
    executed_by: Pubkey,
    now: i64,
) -> Result<()> {
    require!(
        proof.state_precondition_digest == expected_state_precondition_digest,
        HostedAppTrustRootError::StatePreconditionMismatch
    );
    require!(
        proof.state_after_digest == expected_state_after_digest,
        HostedAppTrustRootError::StatePreconditionMismatch
    );

    governance_execution_record.consume(
        bump,
        proof.receipt_digest,
        proof.operation_id_hash,
        proof.replay_domain_hash,
        proof.execution_nonce_hash,
        proof.execution_target_hash,
        proof.state_precondition_digest,
        proof.state_after_digest,
        executed_by,
        proof.source_tx_signature,
        now,
    )?;
    governance_receipt_target_guard.consume(
        receipt_target_guard_bump,
        proof.receipt_digest,
        proof.execution_target_hash,
        proof.replay_domain_hash,
        proof.execution_nonce_hash,
        governance_execution_record_key,
        now,
    )?;
    emit!(HostedAppTrustRootMutationEvent {
        receipt_digest: proof.receipt_digest,
        operation_id_hash: proof.operation_id_hash,
        replay_domain_hash: proof.replay_domain_hash,
        execution_nonce_hash: proof.execution_nonce_hash,
        execution_target_hash: proof.execution_target_hash,
        state_after_digest: proof.state_after_digest,
        executed_by,
        executed_at: now,
    });
    Ok(())
}
