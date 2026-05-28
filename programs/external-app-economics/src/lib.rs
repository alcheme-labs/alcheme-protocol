use anchor_lang::prelude::*;
use anchor_spl::token::{self, Mint, Token, TokenAccount, Transfer};

declare_id!("5YUcL1ysdx9busDkvMGjiXNbugFAAWPLby5hoe2hQHAJ");

pub const ECONOMICS_CONFIG_SEED: &[u8] = b"external_app_economics";
pub const OWNER_BOND_VAULT_SEED: &[u8] = b"external_app_v3_owner_bond_vault";
pub const CHALLENGE_CASE_SEED: &[u8] = b"external_app_v3_challenge_case";
pub const SETTLEMENT_RECEIPT_SEED: &[u8] = b"external_app_v3_settle_receipt";
pub const BOND_DISPOSITION_POLICY_SEED: &[u8] = b"external_app_v3_bond_policy";
pub const RISK_DISCLAIMER_RECEIPT_SEED: &[u8] = b"external_app_v3_risk_receipt";
pub const BOND_DISPOSITION_CASE_SEED: &[u8] = b"external_app_v3_bond_case";
pub const BOND_ROUTING_RECEIPT_SEED: &[u8] = b"external_app_v3_bond_route";
pub const BOND_EXPOSURE_STATE_SEED: &[u8] = b"external_app_v3_bond_exposure";
pub const ECONOMICS_VERSION: u16 = 1;
pub const RISK_SCOPE_EXTERNAL_APP_ENTRY: u8 = 0;
pub const RISK_SCOPE_CHALLENGE_BOND: u8 = 1;
pub const RISK_SCOPE_BOND_DISPOSITION: u8 = 2;
pub const RISK_SCOPE_DEVELOPER_REGISTRATION: u8 = 3;

#[program]
pub mod external_app_economics {
    use super::*;

    pub fn initialize_economics_config(
        ctx: Context<InitializeEconomicsConfig>,
        governance_authority: Pubkey,
        policy_epoch_digest: [u8; 32],
        withdrawal_lock_seconds: u32,
    ) -> Result<()> {
        require_nonzero_hash(&policy_epoch_digest)?;
        let now = Clock::get()?.unix_timestamp;
        let config = &mut ctx.accounts.config;
        config.bump = ctx.bumps.config;
        config.version = ECONOMICS_VERSION;
        config.admin = ctx.accounts.admin.key();
        config.governance_authority = governance_authority;
        config.policy_epoch_digest = policy_epoch_digest;
        config.asset_mint = Pubkey::default();
        config.asset_token_program = Pubkey::default();
        config.asset_status = AssetStatus::Disabled;
        config.withdrawal_lock_seconds = withdrawal_lock_seconds;
        config.paused_new_economic_exposure = true;
        config.created_at = now;
        config.updated_at = now;
        Ok(())
    }

    pub fn set_policy_epoch(
        ctx: Context<GovernanceConfigUpdate>,
        policy_epoch_digest: [u8; 32],
    ) -> Result<()> {
        require_governance_authority(&ctx.accounts.config, &ctx.accounts.governance_authority)?;
        require_nonzero_hash(&policy_epoch_digest)?;
        ctx.accounts.config.policy_epoch_digest = policy_epoch_digest;
        ctx.accounts.config.touch()?;
        Ok(())
    }

    pub fn set_asset_allowlist(
        ctx: Context<SetAssetAllowlist>,
        status: AssetStatus,
    ) -> Result<()> {
        require_governance_authority(&ctx.accounts.config, &ctx.accounts.governance_authority)?;
        ctx.accounts.config.asset_mint = ctx.accounts.asset_mint.key();
        ctx.accounts.config.asset_token_program = ctx.accounts.token_program.key();
        ctx.accounts.config.asset_status = status;
        ctx.accounts.config.touch()?;
        Ok(())
    }

    pub fn pause_new_economic_exposure(
        ctx: Context<GovernanceConfigUpdate>,
        paused: bool,
    ) -> Result<()> {
        require_governance_authority(&ctx.accounts.config, &ctx.accounts.governance_authority)?;
        ctx.accounts.config.paused_new_economic_exposure = paused;
        ctx.accounts.config.touch()?;
        Ok(())
    }

    pub fn open_owner_bond_vault(
        ctx: Context<OpenOwnerBondVault>,
        app_id_hash: [u8; 32],
    ) -> Result<()> {
        require_nonzero_hash(&app_id_hash)?;
        require_active_asset(&ctx.accounts.config)?;
        require_configured_asset(&ctx.accounts.config, &ctx.accounts.asset_mint.key())?;
        let now = Clock::get()?.unix_timestamp;
        let vault = &mut ctx.accounts.bond_vault;
        vault.bump = ctx.bumps.bond_vault;
        vault.version = ECONOMICS_VERSION;
        vault.app_id_hash = app_id_hash;
        vault.owner = ctx.accounts.owner.key();
        vault.mint = ctx.accounts.asset_mint.key();
        vault.vault_token_account = ctx.accounts.vault_token_account.key();
        vault.owner_bond_raw = 0;
        vault.withdrawal_requested_at = 0;
        vault.status = BondVaultStatus::Open;
        vault.created_at = now;
        vault.updated_at = now;
        Ok(())
    }

    pub fn deposit_owner_bond(
        ctx: Context<OwnerBondTransfer>,
        app_id_hash: [u8; 32],
        amount: u64,
    ) -> Result<()> {
        require_nonzero_hash(&app_id_hash)?;
        require_positive_amount(amount)?;
        require_active_asset(&ctx.accounts.config)?;
        require_new_exposure_open(&ctx.accounts.config)?;
        require_configured_asset(&ctx.accounts.config, &ctx.accounts.asset_mint.key())?;
        require_configured_token_program(&ctx.accounts.config, &ctx.accounts.token_program.key())?;
        require_keys_eq!(ctx.accounts.bond_vault.owner, ctx.accounts.owner.key(), EconomicsError::Unauthorized);
        require_keys_eq!(ctx.accounts.bond_vault.mint, ctx.accounts.asset_mint.key(), EconomicsError::AssetMismatch);
        require!(ctx.accounts.bond_vault.app_id_hash == app_id_hash, EconomicsError::AppMismatch);
        token::transfer(ctx.accounts.owner_to_vault_transfer_context(), amount)?;
        let vault = &mut ctx.accounts.bond_vault;
        vault.owner_bond_raw = vault
            .owner_bond_raw
            .checked_add(amount)
            .ok_or(EconomicsError::AmountOverflow)?;
        vault.withdrawal_requested_at = 0;
        vault.touch()?;
        Ok(())
    }

    pub fn request_owner_bond_withdrawal(
        ctx: Context<RequestOwnerBondWithdrawal>,
        app_id_hash: [u8; 32],
    ) -> Result<()> {
        require!(ctx.accounts.bond_vault.app_id_hash == app_id_hash, EconomicsError::AppMismatch);
        require_keys_eq!(ctx.accounts.bond_vault.owner, ctx.accounts.owner.key(), EconomicsError::Unauthorized);
        ctx.accounts.bond_vault.withdrawal_requested_at = Clock::get()?.unix_timestamp;
        ctx.accounts.bond_vault.status = BondVaultStatus::WithdrawalRequested;
        ctx.accounts.bond_vault.touch()?;
        Ok(())
    }

    pub fn execute_unlocked_owner_bond_withdrawal(
        ctx: Context<ExecuteOwnerBondWithdrawal>,
        app_id_hash: [u8; 32],
        amount: u64,
    ) -> Result<()> {
        require_positive_amount(amount)?;
        require!(ctx.accounts.bond_vault.app_id_hash == app_id_hash, EconomicsError::AppMismatch);
        require_keys_eq!(ctx.accounts.bond_vault.owner, ctx.accounts.owner.key(), EconomicsError::Unauthorized);
        require_configured_asset(&ctx.accounts.config, &ctx.accounts.asset_mint.key())?;
        require_configured_token_program(&ctx.accounts.config, &ctx.accounts.token_program.key())?;
        let requested_at = ctx.accounts.bond_vault.withdrawal_requested_at;
        require!(requested_at > 0, EconomicsError::WithdrawalNotRequested);
        let unlock_at = requested_at.saturating_add(ctx.accounts.config.withdrawal_lock_seconds as i64);
        require!(Clock::get()?.unix_timestamp >= unlock_at, EconomicsError::WithdrawalLocked);
        require!(ctx.accounts.bond_vault.owner_bond_raw >= amount, EconomicsError::InsufficientBond);
        initialize_or_validate_exposure_state(
            &mut ctx.accounts.exposure_state,
            ctx.bumps.exposure_state,
            app_id_hash,
            ctx.accounts.bond_vault.mint,
            ctx.accounts.config.policy_epoch_digest,
        )?;
        require_withdrawable_bond(&ctx.accounts.bond_vault, &ctx.accounts.exposure_state, amount)?;

        let app_id_hash_ref = ctx.accounts.bond_vault.app_id_hash.as_ref();
        let mint_ref = ctx.accounts.bond_vault.mint.as_ref();
        let seeds: &[&[u8]] = &[
            OWNER_BOND_VAULT_SEED,
            app_id_hash_ref,
            mint_ref,
            &[ctx.accounts.bond_vault.bump],
        ];
        token::transfer(ctx.accounts.vault_to_owner_transfer_context().with_signer(&[seeds]), amount)?;
        let vault = &mut ctx.accounts.bond_vault;
        vault.owner_bond_raw = vault.owner_bond_raw.saturating_sub(amount);
        if vault.owner_bond_raw == 0 {
            vault.withdrawal_requested_at = 0;
            vault.status = BondVaultStatus::Closed;
        } else {
            vault.status = BondVaultStatus::Open;
        }
        vault.touch()?;
        Ok(())
    }

    pub fn open_challenge_case(
        ctx: Context<OpenChallengeCase>,
        app_id_hash: [u8; 32],
        case_id: [u8; 32],
        evidence_hash: [u8; 32],
        challenge_type: u8,
    ) -> Result<()> {
        require_nonzero_hash(&app_id_hash)?;
        require_nonzero_hash(&case_id)?;
        require_nonzero_hash(&evidence_hash)?;
        require_active_asset(&ctx.accounts.config)?;
        require_new_exposure_open(&ctx.accounts.config)?;
        require_configured_asset(&ctx.accounts.config, &ctx.accounts.asset_mint.key())?;
        let now = Clock::get()?.unix_timestamp;
        let case = &mut ctx.accounts.challenge_case;
        case.bump = ctx.bumps.challenge_case;
        case.version = ECONOMICS_VERSION;
        case.app_id_hash = app_id_hash;
        case.case_id = case_id;
        case.challenger = ctx.accounts.challenger.key();
        case.mint = ctx.accounts.asset_mint.key();
        case.case_vault_token_account = ctx.accounts.case_vault_token_account.key();
        case.challenge_type = challenge_type;
        case.evidence_hash = evidence_hash;
        case.challenge_bond_raw = 0;
        case.response_digest = None;
        case.ruling_digest = None;
        case.appeal_window_ends_at = 0;
        case.status = ChallengeCaseStatus::Open;
        case.created_at = now;
        case.updated_at = now;
        Ok(())
    }

    pub fn deposit_challenge_bond(
        ctx: Context<ChallengeBondTransfer>,
        app_id_hash: [u8; 32],
        case_id: [u8; 32],
        amount: u64,
    ) -> Result<()> {
        require_positive_amount(amount)?;
        require_active_asset(&ctx.accounts.config)?;
        require_new_exposure_open(&ctx.accounts.config)?;
        require_configured_asset(&ctx.accounts.config, &ctx.accounts.asset_mint.key())?;
        require_configured_token_program(&ctx.accounts.config, &ctx.accounts.token_program.key())?;
        require!(ctx.accounts.challenge_case.app_id_hash == app_id_hash, EconomicsError::AppMismatch);
        require!(ctx.accounts.challenge_case.case_id == case_id, EconomicsError::CaseMismatch);
        require_keys_eq!(ctx.accounts.challenge_case.challenger, ctx.accounts.challenger.key(), EconomicsError::Unauthorized);
        token::transfer(ctx.accounts.challenger_to_case_transfer_context(), amount)?;
        let case = &mut ctx.accounts.challenge_case;
        case.challenge_bond_raw = case
            .challenge_bond_raw
            .checked_add(amount)
            .ok_or(EconomicsError::AmountOverflow)?;
        case.touch()?;
        Ok(())
    }

    pub fn record_challenge_response(
        ctx: Context<GovernanceChallengeUpdate>,
        app_id_hash: [u8; 32],
        case_id: [u8; 32],
        response_digest: [u8; 32],
    ) -> Result<()> {
        validate_case_update(&ctx.accounts.config, &ctx.accounts.challenge_case, &ctx.accounts.governance_authority, app_id_hash, case_id)?;
        require_nonzero_hash(&response_digest)?;
        ctx.accounts.challenge_case.response_digest = Some(response_digest);
        ctx.accounts.challenge_case.status = ChallengeCaseStatus::Responded;
        ctx.accounts.challenge_case.touch()?;
        Ok(())
    }

    pub fn record_appeal_window(
        ctx: Context<GovernanceChallengeUpdate>,
        app_id_hash: [u8; 32],
        case_id: [u8; 32],
        appeal_window_ends_at: i64,
    ) -> Result<()> {
        validate_case_update(&ctx.accounts.config, &ctx.accounts.challenge_case, &ctx.accounts.governance_authority, app_id_hash, case_id)?;
        require!(appeal_window_ends_at > Clock::get()?.unix_timestamp, EconomicsError::InvalidAppealWindow);
        ctx.accounts.challenge_case.appeal_window_ends_at = appeal_window_ends_at;
        ctx.accounts.challenge_case.status = ChallengeCaseStatus::AppealWindow;
        ctx.accounts.challenge_case.touch()?;
        Ok(())
    }

    pub fn settle_machine_verifiable_case(
        ctx: Context<GovernanceChallengeUpdate>,
        app_id_hash: [u8; 32],
        case_id: [u8; 32],
        ruling_digest: [u8; 32],
    ) -> Result<()> {
        validate_case_update(&ctx.accounts.config, &ctx.accounts.challenge_case, &ctx.accounts.governance_authority, app_id_hash, case_id)?;
        require_nonzero_hash(&ruling_digest)?;
        ctx.accounts.challenge_case.ruling_digest = Some(ruling_digest);
        ctx.accounts.challenge_case.status = ChallengeCaseStatus::Ruled;
        ctx.accounts.challenge_case.touch()?;
        Ok(())
    }

    pub fn anchor_governance_ruling(
        ctx: Context<GovernanceChallengeUpdate>,
        app_id_hash: [u8; 32],
        case_id: [u8; 32],
        ruling_digest: [u8; 32],
    ) -> Result<()> {
        settle_machine_verifiable_case(ctx, app_id_hash, case_id, ruling_digest)
    }

    pub fn execute_bond_settlement(
        ctx: Context<ExecuteBondSettlement>,
        app_id_hash: [u8; 32],
        case_id: [u8; 32],
        receipt_id: [u8; 32],
        amount: u64,
        receipt_digest: [u8; 32],
    ) -> Result<()> {
        validate_case_update(&ctx.accounts.config, &ctx.accounts.challenge_case, &ctx.accounts.governance_authority, app_id_hash, case_id)?;
        require_nonzero_hash(&receipt_id)?;
        require_nonzero_hash(&receipt_digest)?;
        require_positive_amount(amount)?;
        let now = Clock::get()?.unix_timestamp;
        require_configured_asset(&ctx.accounts.config, &ctx.accounts.challenge_case.mint)?;
        require_configured_token_program(&ctx.accounts.config, &ctx.accounts.token_program.key())?;
        validate_bond_settlement(&ctx.accounts.challenge_case, amount, now)?;

        let signer_seeds: &[&[u8]] = &[
            CHALLENGE_CASE_SEED,
            app_id_hash.as_ref(),
            case_id.as_ref(),
            &[ctx.accounts.challenge_case.bump],
        ];
        token::transfer(
            ctx.accounts
                .case_to_destination_transfer_context()
                .with_signer(&[signer_seeds]),
            amount,
        )?;

        let now = Clock::get()?.unix_timestamp;
        let receipt = &mut ctx.accounts.settlement_receipt;
        receipt.bump = ctx.bumps.settlement_receipt;
        receipt.version = ECONOMICS_VERSION;
        receipt.app_id_hash = app_id_hash;
        receipt.case_id = case_id;
        receipt.receipt_id = receipt_id;
        receipt.policy_epoch_digest = ctx.accounts.config.policy_epoch_digest;
        receipt.mint = ctx.accounts.challenge_case.mint;
        receipt.amount = amount;
        receipt.authority = ctx.accounts.governance_authority.key();
        receipt.source_token_account = ctx.accounts.case_vault_token_account.key();
        receipt.destination_token_account = ctx.accounts.settlement_destination_token_account.key();
        receipt.receipt_digest = receipt_digest;
        receipt.created_at = now;
        ctx.accounts.challenge_case.challenge_bond_raw = ctx
            .accounts
            .challenge_case
            .challenge_bond_raw
            .saturating_sub(amount);
        ctx.accounts.challenge_case.status = ChallengeCaseStatus::Settled;
        ctx.accounts.challenge_case.touch()?;
        Ok(())
    }

    pub fn set_bond_disposition_policy(
        ctx: Context<SetBondDispositionPolicy>,
        policy_id: [u8; 32],
        policy_digest: [u8; 32],
        max_case_amount: u64,
        paused: bool,
    ) -> Result<()> {
        require_governance_authority(&ctx.accounts.config, &ctx.accounts.governance_authority)?;
        require_nonzero_hash(&policy_id)?;
        require_nonzero_hash(&policy_digest)?;
        require_positive_amount(max_case_amount)?;
        let now = Clock::get()?.unix_timestamp;
        let policy = &mut ctx.accounts.policy;
        if policy.version == 0 {
            policy.bump = ctx.bumps.policy;
            policy.version = ECONOMICS_VERSION;
            policy.policy_id = policy_id;
            policy.created_at = now;
        } else {
            require!(policy.policy_id == policy_id, EconomicsError::PolicyMismatch);
        }
        policy.policy_epoch_digest = ctx.accounts.config.policy_epoch_digest;
        policy.governance_authority = ctx.accounts.governance_authority.key();
        policy.mint = ctx.accounts.config.asset_mint;
        policy.max_case_amount = max_case_amount;
        policy.paused = paused;
        policy.policy_digest = policy_digest;
        policy.updated_at = now;
        Ok(())
    }

    pub fn record_risk_disclaimer_acceptance(
        ctx: Context<RecordRiskDisclaimerAcceptance>,
        app_id_hash: [u8; 32],
        scope: u8,
        terms_digest: [u8; 32],
        acceptance_digest: [u8; 32],
    ) -> Result<()> {
        upsert_risk_disclaimer_receipt(
            &mut ctx.accounts.risk_disclaimer_receipt,
            ctx.bumps.risk_disclaimer_receipt,
            app_id_hash,
            ctx.accounts.actor.key(),
            scope,
            terms_digest,
            acceptance_digest,
            ctx.accounts.config.policy_epoch_digest,
            Clock::get()?.unix_timestamp,
        )
    }

    pub fn open_bond_disposition_case(
        ctx: Context<OpenBondDispositionCase>,
        app_id_hash: [u8; 32],
        case_id: [u8; 32],
        policy_id: [u8; 32],
        evidence_hash: [u8; 32],
        requested_amount: u64,
    ) -> Result<()> {
        require_nonzero_hash(&app_id_hash)?;
        require_nonzero_hash(&case_id)?;
        require_nonzero_hash(&policy_id)?;
        require_nonzero_hash(&evidence_hash)?;
        require_positive_amount(requested_amount)?;
        require_active_asset(&ctx.accounts.config)?;
        require_bond_policy_active(&ctx.accounts.policy)?;
        require!(ctx.accounts.policy.policy_id == policy_id, EconomicsError::PolicyMismatch);
        require!(ctx.accounts.policy.mint == ctx.accounts.config.asset_mint, EconomicsError::AssetMismatch);
        require!(ctx.accounts.policy.mint == ctx.accounts.bond_vault.mint, EconomicsError::AssetMismatch);
        require!(ctx.accounts.bond_vault.app_id_hash == app_id_hash, EconomicsError::AppMismatch);
        require!(requested_amount <= ctx.accounts.policy.max_case_amount, EconomicsError::DispositionAmountExceedsPolicy);
        require_risk_disclaimer_scope(&ctx.accounts.risk_disclaimer_receipt, app_id_hash, ctx.accounts.initiator.key(), RISK_SCOPE_BOND_DISPOSITION)?;

        let now = Clock::get()?.unix_timestamp;
        let case = &mut ctx.accounts.disposition_case;
        case.bump = ctx.bumps.disposition_case;
        case.version = ECONOMICS_VERSION;
        case.app_id_hash = app_id_hash;
        case.case_id = case_id;
        case.policy_id = policy_id;
        case.owner_bond_vault = ctx.accounts.bond_vault.key();
        case.owner_vault_token_account = ctx.accounts.vault_token_account.key();
        case.initiator = ctx.accounts.initiator.key();
        case.mint = ctx.accounts.bond_vault.mint;
        case.evidence_hash = evidence_hash;
        case.ruling_digest = None;
        case.requested_amount = requested_amount;
        case.locked_amount = 0;
        case.routed_amount = 0;
        case.status = BondDispositionStatus::Unlocked;
        case.created_at = now;
        case.updated_at = now;
        Ok(())
    }

    pub fn record_bond_disposition_evidence(
        ctx: Context<GovernanceBondDispositionUpdate>,
        app_id_hash: [u8; 32],
        case_id: [u8; 32],
        evidence_hash: [u8; 32],
        ruling_digest: [u8; 32],
    ) -> Result<()> {
        validate_disposition_update(&ctx.accounts.config, &ctx.accounts.disposition_case, &ctx.accounts.governance_authority, app_id_hash, case_id)?;
        require_nonzero_hash(&evidence_hash)?;
        require_nonzero_hash(&ruling_digest)?;
        ctx.accounts.disposition_case.evidence_hash = evidence_hash;
        ctx.accounts.disposition_case.ruling_digest = Some(ruling_digest);
        ctx.accounts.disposition_case.touch()?;
        Ok(())
    }

    pub fn lock_bond_for_case(
        ctx: Context<LockBondForCase>,
        app_id_hash: [u8; 32],
        case_id: [u8; 32],
        amount: u64,
    ) -> Result<()> {
        validate_disposition_update(&ctx.accounts.config, &ctx.accounts.disposition_case, &ctx.accounts.governance_authority, app_id_hash, case_id)?;
        require_active_asset(&ctx.accounts.config)?;
        require_bond_policy_active(&ctx.accounts.policy)?;
        require!(ctx.accounts.policy.mint == ctx.accounts.config.asset_mint, EconomicsError::AssetMismatch);
        require!(ctx.accounts.bond_vault.mint == ctx.accounts.config.asset_mint, EconomicsError::AssetMismatch);
        if ctx.accounts.exposure_state.version == 0 {
            ctx.accounts.exposure_state.bump = ctx.bumps.exposure_state;
            ctx.accounts.exposure_state.version = ECONOMICS_VERSION;
            ctx.accounts.exposure_state.app_id_hash = app_id_hash;
            ctx.accounts.exposure_state.mint = ctx.accounts.bond_vault.mint;
            ctx.accounts.exposure_state.active_locked_amount = 0;
            ctx.accounts.exposure_state.total_routed_amount = 0;
            ctx.accounts.exposure_state.paused_new_bond_exposure = false;
            ctx.accounts.exposure_state.exposure_digest = ctx.accounts.config.policy_epoch_digest;
            ctx.accounts.exposure_state.updated_at = Clock::get()?.unix_timestamp;
        } else {
            require!(ctx.accounts.exposure_state.app_id_hash == app_id_hash, EconomicsError::AppMismatch);
            require!(ctx.accounts.exposure_state.mint == ctx.accounts.bond_vault.mint, EconomicsError::AssetMismatch);
        }
        require!(!ctx.accounts.exposure_state.paused_new_bond_exposure, EconomicsError::NewBondExposurePaused);
        require_positive_amount(amount)?;
        require!(ctx.accounts.disposition_case.status == BondDispositionStatus::Unlocked, EconomicsError::BondAlreadyLocked);
        require!(amount <= ctx.accounts.disposition_case.requested_amount, EconomicsError::DispositionAmountExceedsRequest);
        require!(amount <= ctx.accounts.policy.max_case_amount, EconomicsError::DispositionAmountExceedsPolicy);
        require!(ctx.accounts.bond_vault.key() == ctx.accounts.disposition_case.owner_bond_vault, EconomicsError::BondVaultMismatch);
        require!(ctx.accounts.bond_vault.owner_bond_raw >= amount, EconomicsError::InsufficientBond);
        let new_locked_total = ctx
            .accounts
            .exposure_state
            .active_locked_amount
            .checked_add(amount)
            .ok_or(EconomicsError::AmountOverflow)?;
        require!(new_locked_total <= ctx.accounts.bond_vault.owner_bond_raw, EconomicsError::InsufficientBond);
        ctx.accounts.disposition_case.locked_amount = amount;
        ctx.accounts.disposition_case.status = BondDispositionStatus::LockedForCase;
        ctx.accounts.disposition_case.touch()?;
        ctx.accounts.exposure_state.active_locked_amount = new_locked_total;
        ctx.accounts.exposure_state.touch()?;
        Ok(())
    }

    pub fn execute_bond_release(
        ctx: Context<ReleaseBondForCase>,
        app_id_hash: [u8; 32],
        case_id: [u8; 32],
    ) -> Result<()> {
        validate_disposition_update(&ctx.accounts.config, &ctx.accounts.disposition_case, &ctx.accounts.governance_authority, app_id_hash, case_id)?;
        require!(ctx.accounts.disposition_case.status == BondDispositionStatus::LockedForCase, EconomicsError::BondDispositionCaseNotLocked);
        require!(ctx.accounts.disposition_case.ruling_digest.is_some(), EconomicsError::DispositionRulingRequired);
        let amount = ctx.accounts.disposition_case.locked_amount;
        ctx.accounts.exposure_state.active_locked_amount = ctx.accounts.exposure_state.active_locked_amount.saturating_sub(amount);
        ctx.accounts.exposure_state.touch()?;
        ctx.accounts.disposition_case.locked_amount = 0;
        ctx.accounts.disposition_case.status = BondDispositionStatus::Released;
        ctx.accounts.disposition_case.touch()?;
        Ok(())
    }

    pub fn execute_bond_forfeiture(
        ctx: Context<ReleaseBondForCase>,
        app_id_hash: [u8; 32],
        case_id: [u8; 32],
    ) -> Result<()> {
        validate_disposition_update(&ctx.accounts.config, &ctx.accounts.disposition_case, &ctx.accounts.governance_authority, app_id_hash, case_id)?;
        require!(ctx.accounts.disposition_case.status == BondDispositionStatus::LockedForCase, EconomicsError::BondDispositionCaseNotLocked);
        require!(ctx.accounts.disposition_case.ruling_digest.is_some(), EconomicsError::DispositionRulingRequired);
        ctx.accounts.disposition_case.status = BondDispositionStatus::Forfeited;
        ctx.accounts.disposition_case.touch()?;
        Ok(())
    }

    pub fn route_forfeited_bond_by_policy(
        ctx: Context<RouteForfeitedBondByPolicy>,
        app_id_hash: [u8; 32],
        case_id: [u8; 32],
        receipt_id: [u8; 32],
        amount: u64,
        routing_digest: [u8; 32],
    ) -> Result<()> {
        validate_disposition_update(&ctx.accounts.config, &ctx.accounts.disposition_case, &ctx.accounts.governance_authority, app_id_hash, case_id)?;
        require_nonzero_hash(&receipt_id)?;
        require_nonzero_hash(&routing_digest)?;
        require_positive_amount(amount)?;
        require!(ctx.accounts.disposition_case.status == BondDispositionStatus::Forfeited, EconomicsError::BondDispositionCaseNotForfeited);
        require!(amount <= ctx.accounts.disposition_case.locked_amount, EconomicsError::SettlementExceedsCaseBond);
        require!(ctx.accounts.bond_vault.key() == ctx.accounts.disposition_case.owner_bond_vault, EconomicsError::BondVaultMismatch);
        require!(ctx.accounts.bond_vault.owner_bond_raw >= amount, EconomicsError::InsufficientBond);
        require_configured_asset(&ctx.accounts.config, &ctx.accounts.bond_vault.mint)?;
        require_configured_token_program(&ctx.accounts.config, &ctx.accounts.token_program.key())?;

        let app_id_hash_ref = ctx.accounts.bond_vault.app_id_hash.as_ref();
        let mint_ref = ctx.accounts.bond_vault.mint.as_ref();
        let seeds: &[&[u8]] = &[
            OWNER_BOND_VAULT_SEED,
            app_id_hash_ref,
            mint_ref,
            &[ctx.accounts.bond_vault.bump],
        ];
        token::transfer(
            ctx.accounts
                .bond_vault_to_route_context()
                .with_signer(&[seeds]),
            amount,
        )?;

        let now = Clock::get()?.unix_timestamp;
        let receipt = &mut ctx.accounts.routing_receipt;
        receipt.bump = ctx.bumps.routing_receipt;
        receipt.version = ECONOMICS_VERSION;
        receipt.app_id_hash = app_id_hash;
        receipt.case_id = case_id;
        receipt.receipt_id = receipt_id;
        receipt.policy_id = ctx.accounts.disposition_case.policy_id;
        receipt.amount = amount;
        receipt.source_token_account = ctx.accounts.vault_token_account.key();
        receipt.destination_token_account = ctx.accounts.route_destination_token_account.key();
        receipt.authority = ctx.accounts.governance_authority.key();
        receipt.routing_digest = routing_digest;
        receipt.created_at = now;

        ctx.accounts.bond_vault.owner_bond_raw = ctx.accounts.bond_vault.owner_bond_raw.saturating_sub(amount);
        ctx.accounts.bond_vault.touch()?;
        ctx.accounts.disposition_case.locked_amount = ctx.accounts.disposition_case.locked_amount.saturating_sub(amount);
        ctx.accounts.disposition_case.routed_amount = ctx.accounts.disposition_case.routed_amount.saturating_add(amount);
        if ctx.accounts.disposition_case.locked_amount == 0 {
            ctx.accounts.disposition_case.status = BondDispositionStatus::RoutedByPolicy;
        }
        ctx.accounts.disposition_case.touch()?;
        ctx.accounts.exposure_state.active_locked_amount = ctx.accounts.exposure_state.active_locked_amount.saturating_sub(amount);
        ctx.accounts.exposure_state.total_routed_amount = ctx.accounts.exposure_state.total_routed_amount.saturating_add(amount);
        ctx.accounts.exposure_state.touch()?;
        Ok(())
    }

    pub fn update_bond_exposure_state(
        ctx: Context<UpdateBondExposureState>,
        app_id_hash: [u8; 32],
        exposure_digest: [u8; 32],
    ) -> Result<()> {
        require_governance_authority(&ctx.accounts.config, &ctx.accounts.governance_authority)?;
        require_nonzero_hash(&app_id_hash)?;
        require_nonzero_hash(&exposure_digest)?;
        let now = Clock::get()?.unix_timestamp;
        let state = &mut ctx.accounts.exposure_state;
        if state.version == 0 {
            state.bump = ctx.bumps.exposure_state;
            state.version = ECONOMICS_VERSION;
            state.app_id_hash = app_id_hash;
            state.mint = ctx.accounts.config.asset_mint;
            state.active_locked_amount = 0;
            state.total_routed_amount = 0;
            state.paused_new_bond_exposure = false;
        } else {
            require!(state.app_id_hash == app_id_hash, EconomicsError::AppMismatch);
            require!(state.mint == ctx.accounts.config.asset_mint, EconomicsError::AssetMismatch);
        }
        state.exposure_digest = exposure_digest;
        state.updated_at = now;
        Ok(())
    }

    pub fn pause_new_bond_exposure(
        ctx: Context<PauseBondExposureState>,
        app_id_hash: [u8; 32],
        paused: bool,
    ) -> Result<()> {
        require_governance_authority(&ctx.accounts.config, &ctx.accounts.governance_authority)?;
        require!(ctx.accounts.exposure_state.app_id_hash == app_id_hash, EconomicsError::AppMismatch);
        require!(ctx.accounts.exposure_state.mint == ctx.accounts.config.asset_mint, EconomicsError::AssetMismatch);
        ctx.accounts.exposure_state.paused_new_bond_exposure = paused;
        ctx.accounts.exposure_state.touch()?;
        Ok(())
    }
}

#[derive(Accounts)]
pub struct InitializeEconomicsConfig<'info> {
    #[account(init, payer = admin, space = ExternalAppEconomicsConfig::SPACE, seeds = [ECONOMICS_CONFIG_SEED], bump)]
    pub config: Account<'info, ExternalAppEconomicsConfig>,
    #[account(mut)]
    pub admin: Signer<'info>,
    pub system_program: Program<'info, System>,
}

#[derive(Accounts)]
pub struct GovernanceConfigUpdate<'info> {
    #[account(mut, seeds = [ECONOMICS_CONFIG_SEED], bump = config.bump)]
    pub config: Account<'info, ExternalAppEconomicsConfig>,
    pub governance_authority: Signer<'info>,
}

#[derive(Accounts)]
pub struct SetAssetAllowlist<'info> {
    #[account(mut, seeds = [ECONOMICS_CONFIG_SEED], bump = config.bump)]
    pub config: Account<'info, ExternalAppEconomicsConfig>,
    pub governance_authority: Signer<'info>,
    pub asset_mint: Account<'info, Mint>,
    pub token_program: Program<'info, Token>,
}

#[derive(Accounts)]
#[instruction(app_id_hash: [u8; 32])]
pub struct OpenOwnerBondVault<'info> {
    #[account(seeds = [ECONOMICS_CONFIG_SEED], bump = config.bump)]
    pub config: Account<'info, ExternalAppEconomicsConfig>,
    #[account(init, payer = owner, space = ExternalAppBondVault::SPACE, seeds = [OWNER_BOND_VAULT_SEED, app_id_hash.as_ref(), asset_mint.key().as_ref()], bump)]
    pub bond_vault: Account<'info, ExternalAppBondVault>,
    #[account(mut)]
    pub owner: Signer<'info>,
    pub asset_mint: Account<'info, Mint>,
    #[account(constraint = vault_token_account.mint == asset_mint.key(), constraint = vault_token_account.owner == bond_vault.key())]
    pub vault_token_account: Account<'info, TokenAccount>,
    pub system_program: Program<'info, System>,
}

#[derive(Accounts)]
#[instruction(app_id_hash: [u8; 32])]
pub struct OwnerBondTransfer<'info> {
    #[account(seeds = [ECONOMICS_CONFIG_SEED], bump = config.bump)]
    pub config: Account<'info, ExternalAppEconomicsConfig>,
    #[account(mut, seeds = [OWNER_BOND_VAULT_SEED, app_id_hash.as_ref(), asset_mint.key().as_ref()], bump = bond_vault.bump)]
    pub bond_vault: Account<'info, ExternalAppBondVault>,
    #[account(mut)]
    pub owner: Signer<'info>,
    pub asset_mint: Account<'info, Mint>,
    #[account(mut, constraint = owner_token_account.mint == asset_mint.key(), constraint = owner_token_account.owner == owner.key())]
    pub owner_token_account: Account<'info, TokenAccount>,
    #[account(mut, constraint = vault_token_account.mint == asset_mint.key(), constraint = vault_token_account.owner == bond_vault.key())]
    pub vault_token_account: Account<'info, TokenAccount>,
    pub token_program: Program<'info, Token>,
}

impl<'info> OwnerBondTransfer<'info> {
    fn owner_to_vault_transfer_context(&self) -> CpiContext<'_, '_, '_, 'info, Transfer<'info>> {
        CpiContext::new(
            self.token_program.to_account_info(),
            Transfer {
                from: self.owner_token_account.to_account_info(),
                to: self.vault_token_account.to_account_info(),
                authority: self.owner.to_account_info(),
            },
        )
    }
}

#[derive(Accounts)]
#[instruction(app_id_hash: [u8; 32])]
pub struct ExecuteOwnerBondWithdrawal<'info> {
    #[account(seeds = [ECONOMICS_CONFIG_SEED], bump = config.bump)]
    pub config: Account<'info, ExternalAppEconomicsConfig>,
    #[account(mut, seeds = [OWNER_BOND_VAULT_SEED, app_id_hash.as_ref(), asset_mint.key().as_ref()], bump = bond_vault.bump)]
    pub bond_vault: Account<'info, ExternalAppBondVault>,
    #[account(
        init_if_needed,
        payer = owner,
        space = ExternalAppBondExposureState::SPACE,
        seeds = [BOND_EXPOSURE_STATE_SEED, app_id_hash.as_ref(), asset_mint.key().as_ref()],
        bump
    )]
    pub exposure_state: Account<'info, ExternalAppBondExposureState>,
    #[account(mut)]
    pub owner: Signer<'info>,
    pub asset_mint: Account<'info, Mint>,
    #[account(mut, constraint = owner_token_account.mint == asset_mint.key(), constraint = owner_token_account.owner == owner.key())]
    pub owner_token_account: Account<'info, TokenAccount>,
    #[account(mut, constraint = vault_token_account.mint == asset_mint.key(), constraint = vault_token_account.owner == bond_vault.key())]
    pub vault_token_account: Account<'info, TokenAccount>,
    pub token_program: Program<'info, Token>,
    pub system_program: Program<'info, System>,
}

impl<'info> ExecuteOwnerBondWithdrawal<'info> {
    fn vault_to_owner_transfer_context(&self) -> CpiContext<'_, '_, '_, 'info, Transfer<'info>> {
        CpiContext::new(
            self.token_program.to_account_info(),
            Transfer {
                from: self.vault_token_account.to_account_info(),
                to: self.owner_token_account.to_account_info(),
                authority: self.bond_vault.to_account_info(),
            },
        )
    }
}

#[derive(Accounts)]
#[instruction(app_id_hash: [u8; 32])]
pub struct RequestOwnerBondWithdrawal<'info> {
    #[account(mut, seeds = [OWNER_BOND_VAULT_SEED, app_id_hash.as_ref(), bond_vault.mint.as_ref()], bump = bond_vault.bump)]
    pub bond_vault: Account<'info, ExternalAppBondVault>,
    pub owner: Signer<'info>,
}

#[derive(Accounts)]
#[instruction(app_id_hash: [u8; 32], case_id: [u8; 32])]
pub struct OpenChallengeCase<'info> {
    #[account(seeds = [ECONOMICS_CONFIG_SEED], bump = config.bump)]
    pub config: Account<'info, ExternalAppEconomicsConfig>,
    #[account(init, payer = challenger, space = ExternalAppChallengeCase::SPACE, seeds = [CHALLENGE_CASE_SEED, app_id_hash.as_ref(), case_id.as_ref()], bump)]
    pub challenge_case: Account<'info, ExternalAppChallengeCase>,
    #[account(mut)]
    pub challenger: Signer<'info>,
    pub asset_mint: Account<'info, Mint>,
    #[account(constraint = case_vault_token_account.mint == asset_mint.key(), constraint = case_vault_token_account.owner == challenge_case.key())]
    pub case_vault_token_account: Account<'info, TokenAccount>,
    pub system_program: Program<'info, System>,
}

#[derive(Accounts)]
#[instruction(app_id_hash: [u8; 32], case_id: [u8; 32])]
pub struct ChallengeBondTransfer<'info> {
    #[account(seeds = [ECONOMICS_CONFIG_SEED], bump = config.bump)]
    pub config: Account<'info, ExternalAppEconomicsConfig>,
    #[account(mut, seeds = [CHALLENGE_CASE_SEED, app_id_hash.as_ref(), case_id.as_ref()], bump = challenge_case.bump)]
    pub challenge_case: Account<'info, ExternalAppChallengeCase>,
    #[account(mut)]
    pub challenger: Signer<'info>,
    pub asset_mint: Account<'info, Mint>,
    #[account(mut, constraint = challenger_token_account.mint == asset_mint.key(), constraint = challenger_token_account.owner == challenger.key())]
    pub challenger_token_account: Account<'info, TokenAccount>,
    #[account(mut, constraint = case_vault_token_account.mint == asset_mint.key(), constraint = case_vault_token_account.owner == challenge_case.key())]
    pub case_vault_token_account: Account<'info, TokenAccount>,
    pub token_program: Program<'info, Token>,
}

impl<'info> ChallengeBondTransfer<'info> {
    fn challenger_to_case_transfer_context(&self) -> CpiContext<'_, '_, '_, 'info, Transfer<'info>> {
        CpiContext::new(
            self.token_program.to_account_info(),
            Transfer {
                from: self.challenger_token_account.to_account_info(),
                to: self.case_vault_token_account.to_account_info(),
                authority: self.challenger.to_account_info(),
            },
        )
    }
}

#[derive(Accounts)]
#[instruction(app_id_hash: [u8; 32], case_id: [u8; 32])]
pub struct GovernanceChallengeUpdate<'info> {
    #[account(seeds = [ECONOMICS_CONFIG_SEED], bump = config.bump)]
    pub config: Account<'info, ExternalAppEconomicsConfig>,
    #[account(mut, seeds = [CHALLENGE_CASE_SEED, app_id_hash.as_ref(), case_id.as_ref()], bump = challenge_case.bump)]
    pub challenge_case: Account<'info, ExternalAppChallengeCase>,
    pub governance_authority: Signer<'info>,
}

#[derive(Accounts)]
#[instruction(app_id_hash: [u8; 32], case_id: [u8; 32], receipt_id: [u8; 32])]
pub struct ExecuteBondSettlement<'info> {
    #[account(seeds = [ECONOMICS_CONFIG_SEED], bump = config.bump)]
    pub config: Account<'info, ExternalAppEconomicsConfig>,
    #[account(mut, seeds = [CHALLENGE_CASE_SEED, app_id_hash.as_ref(), case_id.as_ref()], bump = challenge_case.bump)]
    pub challenge_case: Account<'info, ExternalAppChallengeCase>,
    #[account(init, payer = governance_authority, space = ExternalAppSettlementReceipt::SPACE, seeds = [SETTLEMENT_RECEIPT_SEED, app_id_hash.as_ref(), case_id.as_ref(), receipt_id.as_ref()], bump)]
    pub settlement_receipt: Account<'info, ExternalAppSettlementReceipt>,
    #[account(mut)]
    pub governance_authority: Signer<'info>,
    #[account(mut, constraint = case_vault_token_account.key() == challenge_case.case_vault_token_account, constraint = case_vault_token_account.mint == challenge_case.mint, constraint = case_vault_token_account.owner == challenge_case.key())]
    pub case_vault_token_account: Account<'info, TokenAccount>,
    #[account(mut, constraint = settlement_destination_token_account.mint == challenge_case.mint)]
    pub settlement_destination_token_account: Account<'info, TokenAccount>,
    pub token_program: Program<'info, Token>,
    pub system_program: Program<'info, System>,
}

impl<'info> ExecuteBondSettlement<'info> {
    fn case_to_destination_transfer_context(&self) -> CpiContext<'_, '_, '_, 'info, Transfer<'info>> {
        CpiContext::new(
            self.token_program.to_account_info(),
            Transfer {
                from: self.case_vault_token_account.to_account_info(),
                to: self.settlement_destination_token_account.to_account_info(),
                authority: self.challenge_case.to_account_info(),
            },
        )
    }
}

#[derive(Accounts)]
#[instruction(policy_id: [u8; 32])]
pub struct SetBondDispositionPolicy<'info> {
    #[account(seeds = [ECONOMICS_CONFIG_SEED], bump = config.bump)]
    pub config: Account<'info, ExternalAppEconomicsConfig>,
    #[account(
        init_if_needed,
        payer = governance_authority,
        space = ExternalAppBondDispositionPolicy::SPACE,
        seeds = [BOND_DISPOSITION_POLICY_SEED, policy_id.as_ref()],
        bump
    )]
    pub policy: Account<'info, ExternalAppBondDispositionPolicy>,
    #[account(mut)]
    pub governance_authority: Signer<'info>,
    pub system_program: Program<'info, System>,
}

#[derive(Accounts)]
#[instruction(app_id_hash: [u8; 32], scope: u8)]
pub struct RecordRiskDisclaimerAcceptance<'info> {
    #[account(seeds = [ECONOMICS_CONFIG_SEED], bump = config.bump)]
    pub config: Account<'info, ExternalAppEconomicsConfig>,
    #[account(
        init_if_needed,
        payer = actor,
        space = ExternalAppRiskDisclaimerReceipt::SPACE,
        seeds = [RISK_DISCLAIMER_RECEIPT_SEED, app_id_hash.as_ref(), actor.key().as_ref(), &[scope]],
        bump
    )]
    pub risk_disclaimer_receipt: Account<'info, ExternalAppRiskDisclaimerReceipt>,
    #[account(mut)]
    pub actor: Signer<'info>,
    pub system_program: Program<'info, System>,
}

#[derive(Accounts)]
#[instruction(app_id_hash: [u8; 32], case_id: [u8; 32], policy_id: [u8; 32])]
pub struct OpenBondDispositionCase<'info> {
    #[account(seeds = [ECONOMICS_CONFIG_SEED], bump = config.bump)]
    pub config: Account<'info, ExternalAppEconomicsConfig>,
    #[account(seeds = [BOND_DISPOSITION_POLICY_SEED, policy_id.as_ref()], bump = policy.bump)]
    pub policy: Account<'info, ExternalAppBondDispositionPolicy>,
    #[account(seeds = [RISK_DISCLAIMER_RECEIPT_SEED, app_id_hash.as_ref(), initiator.key().as_ref(), &[RISK_SCOPE_BOND_DISPOSITION]], bump = risk_disclaimer_receipt.bump)]
    pub risk_disclaimer_receipt: Account<'info, ExternalAppRiskDisclaimerReceipt>,
    #[account(
        init,
        payer = initiator,
        space = ExternalAppBondDispositionCase::SPACE,
        seeds = [BOND_DISPOSITION_CASE_SEED, app_id_hash.as_ref(), case_id.as_ref()],
        bump
    )]
    pub disposition_case: Account<'info, ExternalAppBondDispositionCase>,
    #[account(seeds = [OWNER_BOND_VAULT_SEED, app_id_hash.as_ref(), bond_vault.mint.as_ref()], bump = bond_vault.bump)]
    pub bond_vault: Account<'info, ExternalAppBondVault>,
    #[account(constraint = vault_token_account.key() == bond_vault.vault_token_account, constraint = vault_token_account.owner == bond_vault.key(), constraint = vault_token_account.mint == bond_vault.mint)]
    pub vault_token_account: Account<'info, TokenAccount>,
    #[account(mut)]
    pub initiator: Signer<'info>,
    pub system_program: Program<'info, System>,
}

#[derive(Accounts)]
#[instruction(app_id_hash: [u8; 32], case_id: [u8; 32])]
pub struct GovernanceBondDispositionUpdate<'info> {
    #[account(seeds = [ECONOMICS_CONFIG_SEED], bump = config.bump)]
    pub config: Account<'info, ExternalAppEconomicsConfig>,
    #[account(mut, seeds = [BOND_DISPOSITION_CASE_SEED, app_id_hash.as_ref(), case_id.as_ref()], bump = disposition_case.bump)]
    pub disposition_case: Account<'info, ExternalAppBondDispositionCase>,
    pub governance_authority: Signer<'info>,
}

#[derive(Accounts)]
#[instruction(app_id_hash: [u8; 32], case_id: [u8; 32])]
pub struct LockBondForCase<'info> {
    #[account(seeds = [ECONOMICS_CONFIG_SEED], bump = config.bump)]
    pub config: Account<'info, ExternalAppEconomicsConfig>,
    #[account(seeds = [BOND_DISPOSITION_POLICY_SEED, disposition_case.policy_id.as_ref()], bump = policy.bump)]
    pub policy: Account<'info, ExternalAppBondDispositionPolicy>,
    #[account(mut, seeds = [BOND_DISPOSITION_CASE_SEED, app_id_hash.as_ref(), case_id.as_ref()], bump = disposition_case.bump)]
    pub disposition_case: Account<'info, ExternalAppBondDispositionCase>,
    #[account(seeds = [OWNER_BOND_VAULT_SEED, app_id_hash.as_ref(), bond_vault.mint.as_ref()], bump = bond_vault.bump)]
    pub bond_vault: Account<'info, ExternalAppBondVault>,
    #[account(
        init_if_needed,
        payer = governance_authority,
        space = ExternalAppBondExposureState::SPACE,
        seeds = [BOND_EXPOSURE_STATE_SEED, app_id_hash.as_ref(), bond_vault.mint.as_ref()],
        bump
    )]
    pub exposure_state: Account<'info, ExternalAppBondExposureState>,
    #[account(mut)]
    pub governance_authority: Signer<'info>,
    pub system_program: Program<'info, System>,
}

#[derive(Accounts)]
#[instruction(app_id_hash: [u8; 32], case_id: [u8; 32])]
pub struct ReleaseBondForCase<'info> {
    #[account(seeds = [ECONOMICS_CONFIG_SEED], bump = config.bump)]
    pub config: Account<'info, ExternalAppEconomicsConfig>,
    #[account(mut, seeds = [BOND_DISPOSITION_CASE_SEED, app_id_hash.as_ref(), case_id.as_ref()], bump = disposition_case.bump)]
    pub disposition_case: Account<'info, ExternalAppBondDispositionCase>,
    #[account(mut, seeds = [BOND_EXPOSURE_STATE_SEED, app_id_hash.as_ref(), disposition_case.mint.as_ref()], bump = exposure_state.bump)]
    pub exposure_state: Account<'info, ExternalAppBondExposureState>,
    pub governance_authority: Signer<'info>,
}

#[derive(Accounts)]
#[instruction(app_id_hash: [u8; 32], case_id: [u8; 32], receipt_id: [u8; 32])]
pub struct RouteForfeitedBondByPolicy<'info> {
    #[account(seeds = [ECONOMICS_CONFIG_SEED], bump = config.bump)]
    pub config: Account<'info, ExternalAppEconomicsConfig>,
    #[account(mut, seeds = [BOND_DISPOSITION_CASE_SEED, app_id_hash.as_ref(), case_id.as_ref()], bump = disposition_case.bump)]
    pub disposition_case: Account<'info, ExternalAppBondDispositionCase>,
    #[account(mut, seeds = [OWNER_BOND_VAULT_SEED, app_id_hash.as_ref(), bond_vault.mint.as_ref()], bump = bond_vault.bump)]
    pub bond_vault: Account<'info, ExternalAppBondVault>,
    #[account(mut, seeds = [BOND_EXPOSURE_STATE_SEED, app_id_hash.as_ref(), bond_vault.mint.as_ref()], bump = exposure_state.bump)]
    pub exposure_state: Account<'info, ExternalAppBondExposureState>,
    #[account(
        init,
        payer = governance_authority,
        space = ExternalAppBondRoutingReceipt::SPACE,
        seeds = [BOND_ROUTING_RECEIPT_SEED, app_id_hash.as_ref(), case_id.as_ref(), receipt_id.as_ref()],
        bump
    )]
    pub routing_receipt: Account<'info, ExternalAppBondRoutingReceipt>,
    #[account(mut)]
    pub governance_authority: Signer<'info>,
    #[account(mut, constraint = vault_token_account.key() == bond_vault.vault_token_account, constraint = vault_token_account.owner == bond_vault.key(), constraint = vault_token_account.mint == bond_vault.mint)]
    pub vault_token_account: Account<'info, TokenAccount>,
    #[account(mut, constraint = route_destination_token_account.mint == bond_vault.mint)]
    pub route_destination_token_account: Account<'info, TokenAccount>,
    pub token_program: Program<'info, Token>,
    pub system_program: Program<'info, System>,
}

impl<'info> RouteForfeitedBondByPolicy<'info> {
    fn bond_vault_to_route_context(&self) -> CpiContext<'_, '_, '_, 'info, Transfer<'info>> {
        CpiContext::new(
            self.token_program.to_account_info(),
            Transfer {
                from: self.vault_token_account.to_account_info(),
                to: self.route_destination_token_account.to_account_info(),
                authority: self.bond_vault.to_account_info(),
            },
        )
    }
}

#[derive(Accounts)]
#[instruction(app_id_hash: [u8; 32])]
pub struct UpdateBondExposureState<'info> {
    #[account(seeds = [ECONOMICS_CONFIG_SEED], bump = config.bump)]
    pub config: Account<'info, ExternalAppEconomicsConfig>,
    #[account(
        init_if_needed,
        payer = governance_authority,
        space = ExternalAppBondExposureState::SPACE,
        seeds = [BOND_EXPOSURE_STATE_SEED, app_id_hash.as_ref(), config.asset_mint.as_ref()],
        bump
    )]
    pub exposure_state: Account<'info, ExternalAppBondExposureState>,
    #[account(mut)]
    pub governance_authority: Signer<'info>,
    pub system_program: Program<'info, System>,
}

#[derive(Accounts)]
#[instruction(app_id_hash: [u8; 32])]
pub struct PauseBondExposureState<'info> {
    #[account(seeds = [ECONOMICS_CONFIG_SEED], bump = config.bump)]
    pub config: Account<'info, ExternalAppEconomicsConfig>,
    #[account(mut, seeds = [BOND_EXPOSURE_STATE_SEED, app_id_hash.as_ref(), config.asset_mint.as_ref()], bump = exposure_state.bump)]
    pub exposure_state: Account<'info, ExternalAppBondExposureState>,
    pub governance_authority: Signer<'info>,
}

#[account]
pub struct ExternalAppEconomicsConfig {
    pub bump: u8,
    pub version: u16,
    pub admin: Pubkey,
    pub governance_authority: Pubkey,
    pub policy_epoch_digest: [u8; 32],
    pub asset_mint: Pubkey,
    pub asset_token_program: Pubkey,
    pub asset_status: AssetStatus,
    pub withdrawal_lock_seconds: u32,
    pub paused_new_economic_exposure: bool,
    pub created_at: i64,
    pub updated_at: i64,
}

impl ExternalAppEconomicsConfig {
    pub const SPACE: usize = 8 + 1 + 2 + 32 + 32 + 32 + 32 + 32 + 1 + 4 + 1 + 8 + 8;

    pub fn touch(&mut self) -> Result<()> {
        self.updated_at = Clock::get()?.unix_timestamp;
        Ok(())
    }
}

#[account]
pub struct ExternalAppBondVault {
    pub bump: u8,
    pub version: u16,
    pub app_id_hash: [u8; 32],
    pub owner: Pubkey,
    pub mint: Pubkey,
    pub vault_token_account: Pubkey,
    pub owner_bond_raw: u64,
    pub withdrawal_requested_at: i64,
    pub status: BondVaultStatus,
    pub created_at: i64,
    pub updated_at: i64,
}

impl ExternalAppBondVault {
    pub const SPACE: usize = 8 + 1 + 2 + 32 + 32 + 32 + 32 + 8 + 8 + 1 + 8 + 8;

    pub fn touch(&mut self) -> Result<()> {
        self.updated_at = Clock::get()?.unix_timestamp;
        Ok(())
    }
}

#[account]
pub struct ExternalAppChallengeCase {
    pub bump: u8,
    pub version: u16,
    pub app_id_hash: [u8; 32],
    pub case_id: [u8; 32],
    pub challenger: Pubkey,
    pub mint: Pubkey,
    pub case_vault_token_account: Pubkey,
    pub challenge_type: u8,
    pub evidence_hash: [u8; 32],
    pub challenge_bond_raw: u64,
    pub response_digest: Option<[u8; 32]>,
    pub ruling_digest: Option<[u8; 32]>,
    pub appeal_window_ends_at: i64,
    pub status: ChallengeCaseStatus,
    pub created_at: i64,
    pub updated_at: i64,
}

impl ExternalAppChallengeCase {
    pub const SPACE: usize = 8 + 1 + 2 + 32 + 32 + 32 + 32 + 32 + 1 + 32 + 8 + (1 + 32) + (1 + 32) + 8 + 1 + 8 + 8;

    pub fn touch(&mut self) -> Result<()> {
        self.updated_at = Clock::get()?.unix_timestamp;
        Ok(())
    }
}

#[account]
pub struct ExternalAppSettlementReceipt {
    pub bump: u8,
    pub version: u16,
    pub app_id_hash: [u8; 32],
    pub case_id: [u8; 32],
    pub receipt_id: [u8; 32],
    pub policy_epoch_digest: [u8; 32],
    pub mint: Pubkey,
    pub amount: u64,
    pub authority: Pubkey,
    pub source_token_account: Pubkey,
    pub destination_token_account: Pubkey,
    pub receipt_digest: [u8; 32],
    pub created_at: i64,
}

impl ExternalAppSettlementReceipt {
    pub const SPACE: usize = 8 + 1 + 2 + 32 + 32 + 32 + 32 + 32 + 8 + 32 + 32 + 32 + 32 + 8;
}

#[account]
pub struct ExternalAppBondDispositionPolicy {
    pub bump: u8,
    pub version: u16,
    pub policy_id: [u8; 32],
    pub policy_epoch_digest: [u8; 32],
    pub governance_authority: Pubkey,
    pub mint: Pubkey,
    pub max_case_amount: u64,
    pub paused: bool,
    pub policy_digest: [u8; 32],
    pub created_at: i64,
    pub updated_at: i64,
}

impl ExternalAppBondDispositionPolicy {
    pub const SPACE: usize = 8 + 1 + 2 + 32 + 32 + 32 + 32 + 8 + 1 + 32 + 8 + 8;
}

#[account]
pub struct ExternalAppRiskDisclaimerReceipt {
    pub bump: u8,
    pub version: u16,
    pub app_id_hash: [u8; 32],
    pub actor: Pubkey,
    pub scope: u8,
    pub terms_digest: [u8; 32],
    pub acceptance_digest: [u8; 32],
    pub policy_epoch_digest: [u8; 32],
    pub created_at: i64,
}

impl ExternalAppRiskDisclaimerReceipt {
    pub const SPACE: usize = 8 + 1 + 2 + 32 + 32 + 1 + 32 + 32 + 32 + 8;
}

#[account]
pub struct ExternalAppBondDispositionCase {
    pub bump: u8,
    pub version: u16,
    pub app_id_hash: [u8; 32],
    pub case_id: [u8; 32],
    pub policy_id: [u8; 32],
    pub owner_bond_vault: Pubkey,
    pub owner_vault_token_account: Pubkey,
    pub initiator: Pubkey,
    pub mint: Pubkey,
    pub evidence_hash: [u8; 32],
    pub ruling_digest: Option<[u8; 32]>,
    pub requested_amount: u64,
    pub locked_amount: u64,
    pub routed_amount: u64,
    pub status: BondDispositionStatus,
    pub created_at: i64,
    pub updated_at: i64,
}

impl ExternalAppBondDispositionCase {
    pub const SPACE: usize = 8 + 1 + 2 + 32 + 32 + 32 + 32 + 32 + 32 + 32 + 32 + (1 + 32) + 8 + 8 + 8 + 1 + 8 + 8;

    pub fn touch(&mut self) -> Result<()> {
        self.updated_at = Clock::get()?.unix_timestamp;
        Ok(())
    }
}

#[account]
pub struct ExternalAppBondRoutingReceipt {
    pub bump: u8,
    pub version: u16,
    pub app_id_hash: [u8; 32],
    pub case_id: [u8; 32],
    pub receipt_id: [u8; 32],
    pub policy_id: [u8; 32],
    pub amount: u64,
    pub source_token_account: Pubkey,
    pub destination_token_account: Pubkey,
    pub authority: Pubkey,
    pub routing_digest: [u8; 32],
    pub created_at: i64,
}

impl ExternalAppBondRoutingReceipt {
    pub const SPACE: usize = 8 + 1 + 2 + 32 + 32 + 32 + 32 + 8 + 32 + 32 + 32 + 32 + 8;
}

#[account]
pub struct ExternalAppBondExposureState {
    pub bump: u8,
    pub version: u16,
    pub app_id_hash: [u8; 32],
    pub mint: Pubkey,
    pub active_locked_amount: u64,
    pub total_routed_amount: u64,
    pub paused_new_bond_exposure: bool,
    pub exposure_digest: [u8; 32],
    pub updated_at: i64,
}

impl ExternalAppBondExposureState {
    pub const SPACE: usize = 8 + 1 + 2 + 32 + 32 + 8 + 8 + 1 + 32 + 8;

    pub fn touch(&mut self) -> Result<()> {
        self.updated_at = Clock::get()?.unix_timestamp;
        Ok(())
    }
}

#[derive(AnchorSerialize, AnchorDeserialize, Clone, Copy, PartialEq, Eq)]
pub enum AssetStatus {
    Disabled,
    TestOnly,
    Active,
    Paused,
    Retired,
}

#[derive(AnchorSerialize, AnchorDeserialize, Clone, Copy, PartialEq, Eq)]
pub enum BondVaultStatus {
    Open,
    WithdrawalRequested,
    Closed,
}

#[derive(AnchorSerialize, AnchorDeserialize, Clone, Copy, PartialEq, Eq)]
pub enum ChallengeCaseStatus {
    Open,
    Responded,
    AppealWindow,
    Ruled,
    Settled,
}

#[derive(AnchorSerialize, AnchorDeserialize, Clone, Copy, PartialEq, Eq)]
pub enum BondDispositionStatus {
    Unlocked,
    LockedForCase,
    Released,
    Forfeited,
    RoutedByPolicy,
    Paused,
}

#[error_code]
pub enum EconomicsError {
    #[msg("Unauthorized")]
    Unauthorized,
    #[msg("External app hash does not match")]
    AppMismatch,
    #[msg("Challenge case id does not match")]
    CaseMismatch,
    #[msg("Configured settlement asset is not active")]
    AssetNotActive,
    #[msg("Settlement asset mismatch")]
    AssetMismatch,
    #[msg("New economic exposure is paused")]
    NewExposurePaused,
    #[msg("Amount must be positive")]
    AmountMustBePositive,
    #[msg("Amount overflow")]
    AmountOverflow,
    #[msg("Insufficient bond")]
    InsufficientBond,
    #[msg("Withdrawal has not been requested")]
    WithdrawalNotRequested,
    #[msg("Withdrawal is still locked")]
    WithdrawalLocked,
    #[msg("Invalid appeal window")]
    InvalidAppealWindow,
    #[msg("Governance or machine-verifiable ruling is required")]
    RulingRequired,
    #[msg("Settlement cannot execute while appeal window is open")]
    SettlementAppealWindowOpen,
    #[msg("Settlement amount exceeds locked challenge bond")]
    SettlementExceedsCaseBond,
    #[msg("Digest must not be zero")]
    ZeroDigest,
    #[msg("Bond disposition policy does not match")]
    PolicyMismatch,
    #[msg("Bond disposition policy is paused")]
    BondDispositionPolicyPaused,
    #[msg("Bond disposition amount exceeds policy cap")]
    DispositionAmountExceedsPolicy,
    #[msg("Bond disposition amount exceeds requested amount")]
    DispositionAmountExceedsRequest,
    #[msg("Bond is already locked for this case")]
    BondAlreadyLocked,
    #[msg("Bond disposition case is not locked")]
    BondDispositionCaseNotLocked,
    #[msg("Bond disposition ruling is required")]
    DispositionRulingRequired,
    #[msg("Bond disposition case is not forfeited")]
    BondDispositionCaseNotForfeited,
    #[msg("Bond vault does not match disposition case")]
    BondVaultMismatch,
    #[msg("Invalid risk disclaimer scope")]
    InvalidRiskDisclaimerScope,
    #[msg("Risk disclaimer receipt does not match action")]
    RiskDisclaimerMismatch,
    #[msg("New bond exposure is paused")]
    NewBondExposurePaused,
}

fn require_governance_authority(
    config: &ExternalAppEconomicsConfig,
    authority: &Signer,
) -> Result<()> {
    require_keys_eq!(config.governance_authority, authority.key(), EconomicsError::Unauthorized);
    Ok(())
}

fn require_active_asset(config: &ExternalAppEconomicsConfig) -> Result<()> {
    require!(config.asset_status == AssetStatus::Active || config.asset_status == AssetStatus::TestOnly, EconomicsError::AssetNotActive);
    Ok(())
}

fn require_configured_asset(config: &ExternalAppEconomicsConfig, asset_mint: &Pubkey) -> Result<()> {
    require_keys_eq!(config.asset_mint, *asset_mint, EconomicsError::AssetMismatch);
    Ok(())
}

fn require_configured_token_program(config: &ExternalAppEconomicsConfig, token_program: &Pubkey) -> Result<()> {
    require_keys_eq!(config.asset_token_program, *token_program, EconomicsError::AssetMismatch);
    Ok(())
}

fn require_new_exposure_open(config: &ExternalAppEconomicsConfig) -> Result<()> {
    require!(!config.paused_new_economic_exposure, EconomicsError::NewExposurePaused);
    Ok(())
}

fn require_positive_amount(amount: u64) -> Result<()> {
    require!(amount > 0, EconomicsError::AmountMustBePositive);
    Ok(())
}

fn require_nonzero_hash(hash: &[u8; 32]) -> Result<()> {
    require!(hash.iter().any(|byte| *byte != 0), EconomicsError::ZeroDigest);
    Ok(())
}

fn require_valid_risk_scope(scope: u8) -> Result<()> {
    require!(
        scope == RISK_SCOPE_EXTERNAL_APP_ENTRY
            || scope == RISK_SCOPE_CHALLENGE_BOND
            || scope == RISK_SCOPE_BOND_DISPOSITION
            || scope == RISK_SCOPE_DEVELOPER_REGISTRATION,
        EconomicsError::InvalidRiskDisclaimerScope,
    );
    Ok(())
}

fn require_bond_policy_active(policy: &ExternalAppBondDispositionPolicy) -> Result<()> {
    require!(!policy.paused, EconomicsError::BondDispositionPolicyPaused);
    Ok(())
}

fn require_risk_disclaimer_scope(
    receipt: &ExternalAppRiskDisclaimerReceipt,
    app_id_hash: [u8; 32],
    actor: Pubkey,
    scope: u8,
) -> Result<()> {
    require_valid_risk_scope(scope)?;
    require!(receipt.app_id_hash == app_id_hash, EconomicsError::RiskDisclaimerMismatch);
    require_keys_eq!(receipt.actor, actor, EconomicsError::RiskDisclaimerMismatch);
    require!(receipt.scope == scope, EconomicsError::RiskDisclaimerMismatch);
    Ok(())
}

fn upsert_risk_disclaimer_receipt(
    receipt: &mut ExternalAppRiskDisclaimerReceipt,
    bump: u8,
    app_id_hash: [u8; 32],
    actor: Pubkey,
    scope: u8,
    terms_digest: [u8; 32],
    acceptance_digest: [u8; 32],
    policy_epoch_digest: [u8; 32],
    created_at: i64,
) -> Result<()> {
    require_nonzero_hash(&app_id_hash)?;
    require_valid_risk_scope(scope)?;
    require_nonzero_hash(&terms_digest)?;
    require_nonzero_hash(&acceptance_digest)?;
    receipt.bump = bump;
    receipt.version = ECONOMICS_VERSION;
    receipt.app_id_hash = app_id_hash;
    receipt.actor = actor;
    receipt.scope = scope;
    receipt.terms_digest = terms_digest;
    receipt.acceptance_digest = acceptance_digest;
    receipt.policy_epoch_digest = policy_epoch_digest;
    receipt.created_at = created_at;
    Ok(())
}

fn validate_case_update(
    config: &ExternalAppEconomicsConfig,
    challenge_case: &ExternalAppChallengeCase,
    governance_authority: &Signer,
    app_id_hash: [u8; 32],
    case_id: [u8; 32],
) -> Result<()> {
    require_governance_authority(config, governance_authority)?;
    require!(challenge_case.app_id_hash == app_id_hash, EconomicsError::AppMismatch);
    require!(challenge_case.case_id == case_id, EconomicsError::CaseMismatch);
    Ok(())
}

fn validate_disposition_update(
    config: &ExternalAppEconomicsConfig,
    disposition_case: &ExternalAppBondDispositionCase,
    governance_authority: &Signer,
    app_id_hash: [u8; 32],
    case_id: [u8; 32],
) -> Result<()> {
    require_governance_authority(config, governance_authority)?;
    require!(disposition_case.app_id_hash == app_id_hash, EconomicsError::AppMismatch);
    require!(disposition_case.case_id == case_id, EconomicsError::CaseMismatch);
    Ok(())
}

fn initialize_or_validate_exposure_state(
    exposure_state: &mut ExternalAppBondExposureState,
    bump: u8,
    app_id_hash: [u8; 32],
    mint: Pubkey,
    exposure_digest: [u8; 32],
) -> Result<()> {
    if exposure_state.version == 0 {
        exposure_state.bump = bump;
        exposure_state.version = ECONOMICS_VERSION;
        exposure_state.app_id_hash = app_id_hash;
        exposure_state.mint = mint;
        exposure_state.active_locked_amount = 0;
        exposure_state.total_routed_amount = 0;
        exposure_state.paused_new_bond_exposure = false;
        exposure_state.exposure_digest = exposure_digest;
        exposure_state.updated_at = Clock::get()?.unix_timestamp;
    } else {
        require!(exposure_state.app_id_hash == app_id_hash, EconomicsError::AppMismatch);
        require!(exposure_state.mint == mint, EconomicsError::AssetMismatch);
    }
    Ok(())
}

fn require_withdrawable_bond(
    bond_vault: &ExternalAppBondVault,
    exposure_state: &ExternalAppBondExposureState,
    amount: u64,
) -> Result<()> {
    require!(exposure_state.app_id_hash == bond_vault.app_id_hash, EconomicsError::AppMismatch);
    require!(exposure_state.mint == bond_vault.mint, EconomicsError::AssetMismatch);
    let unlocked_amount = bond_vault
        .owner_bond_raw
        .checked_sub(exposure_state.active_locked_amount)
        .ok_or(EconomicsError::InsufficientBond)?;
    require!(unlocked_amount >= amount, EconomicsError::InsufficientBond);
    Ok(())
}

fn validate_bond_settlement(
    challenge_case: &ExternalAppChallengeCase,
    amount: u64,
    now: i64,
) -> Result<()> {
    require!(challenge_case.ruling_digest.is_some(), EconomicsError::RulingRequired);
    require!(
        challenge_case.appeal_window_ends_at == 0 || challenge_case.appeal_window_ends_at <= now,
        EconomicsError::SettlementAppealWindowOpen,
    );
    require!(
        challenge_case.challenge_bond_raw >= amount,
        EconomicsError::SettlementExceedsCaseBond,
    );
    Ok(())
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn rejects_zero_digest() {
        assert!(require_nonzero_hash(&[0; 32]).is_err());
        assert!(require_nonzero_hash(&[1; 32]).is_ok());
    }

    #[test]
    fn active_asset_allows_active_and_test_only() {
        let mut config = ExternalAppEconomicsConfig {
            bump: 1,
            version: ECONOMICS_VERSION,
            admin: Pubkey::new_unique(),
            governance_authority: Pubkey::new_unique(),
            policy_epoch_digest: [1; 32],
            asset_mint: Pubkey::new_unique(),
            asset_token_program: Pubkey::new_unique(),
            asset_status: AssetStatus::Disabled,
            withdrawal_lock_seconds: 0,
            paused_new_economic_exposure: false,
            created_at: 0,
            updated_at: 0,
        };
        assert!(require_active_asset(&config).is_err());
        config.asset_status = AssetStatus::TestOnly;
        assert!(require_active_asset(&config).is_ok());
        config.asset_status = AssetStatus::Active;
        assert!(require_active_asset(&config).is_ok());
    }

    #[test]
    fn configured_asset_guards_reject_wrong_mint_and_token_program() {
        let config = test_config();
        assert!(require_configured_asset(&config, &config.asset_mint).is_ok());
        assert!(require_configured_asset(&config, &Pubkey::new_unique()).is_err());
        assert!(require_configured_token_program(&config, &config.asset_token_program).is_ok());
        assert!(require_configured_token_program(&config, &Pubkey::new_unique()).is_err());
    }

    #[test]
    fn new_exposure_guard_blocks_paused_deposits() {
        let mut config = test_config();
        config.paused_new_economic_exposure = true;

        assert!(require_new_exposure_open(&config).is_err());

        config.paused_new_economic_exposure = false;
        assert!(require_new_exposure_open(&config).is_ok());
    }

    #[test]
    fn settlement_validation_requires_ruling_open_window_and_case_balance() {
        let mut case = test_challenge_case();
        let now = 1_000;

        assert!(validate_bond_settlement(&case, 1, now).is_err());

        case.ruling_digest = Some([9; 32]);
        case.appeal_window_ends_at = now + 60;
        assert!(validate_bond_settlement(&case, 1, now).is_err());

        case.appeal_window_ends_at = now - 1;
        assert!(validate_bond_settlement(&case, case.challenge_bond_raw + 1, now).is_err());
        assert!(validate_bond_settlement(&case, case.challenge_bond_raw, now).is_ok());
    }

    #[test]
    fn risk_disclaimer_receipt_must_match_actor_scope_and_app() {
        let actor = Pubkey::new_unique();
        let receipt = ExternalAppRiskDisclaimerReceipt {
            bump: 1,
            version: ECONOMICS_VERSION,
            app_id_hash: [4; 32],
            actor,
            scope: RISK_SCOPE_BOND_DISPOSITION,
            terms_digest: [5; 32],
            acceptance_digest: [6; 32],
            policy_epoch_digest: [1; 32],
            created_at: 0,
        };

        assert!(require_risk_disclaimer_scope(&receipt, [4; 32], actor, RISK_SCOPE_BOND_DISPOSITION).is_ok());
        assert!(require_risk_disclaimer_scope(&receipt, [7; 32], actor, RISK_SCOPE_BOND_DISPOSITION).is_err());
        assert!(require_risk_disclaimer_scope(&receipt, [4; 32], Pubkey::new_unique(), RISK_SCOPE_BOND_DISPOSITION).is_err());
        assert!(require_risk_disclaimer_scope(&receipt, [4; 32], actor, RISK_SCOPE_CHALLENGE_BOND).is_err());
    }

    #[test]
    fn developer_registration_is_a_valid_risk_scope() {
        assert!(require_valid_risk_scope(RISK_SCOPE_DEVELOPER_REGISTRATION).is_ok());
        assert!(require_valid_risk_scope(255).is_err());
    }

    #[test]
    fn risk_disclaimer_receipt_can_be_resigned_for_new_terms() {
        let actor = Pubkey::new_unique();
        let mut receipt = ExternalAppRiskDisclaimerReceipt {
            bump: 1,
            version: ECONOMICS_VERSION,
            app_id_hash: [4; 32],
            actor,
            scope: RISK_SCOPE_DEVELOPER_REGISTRATION,
            terms_digest: [5; 32],
            acceptance_digest: [6; 32],
            policy_epoch_digest: [7; 32],
            created_at: 10,
        };

        upsert_risk_disclaimer_receipt(
            &mut receipt,
            1,
            [4; 32],
            actor,
            RISK_SCOPE_DEVELOPER_REGISTRATION,
            [8; 32],
            [9; 32],
            [10; 32],
            20,
        )
        .unwrap();

        assert_eq!(receipt.terms_digest, [8; 32]);
        assert_eq!(receipt.acceptance_digest, [9; 32]);
        assert_eq!(receipt.policy_epoch_digest, [10; 32]);
        assert_eq!(receipt.created_at, 20);
    }

    #[test]
    fn owner_withdrawal_cannot_use_locked_bond_amount() {
        let mint = Pubkey::new_unique();
        let vault = ExternalAppBondVault {
            bump: 1,
            version: ECONOMICS_VERSION,
            app_id_hash: [1; 32],
            owner: Pubkey::new_unique(),
            mint,
            vault_token_account: Pubkey::new_unique(),
            owner_bond_raw: 100,
            withdrawal_requested_at: 1,
            status: BondVaultStatus::WithdrawalRequested,
            created_at: 0,
            updated_at: 0,
        };
        let mut exposure = ExternalAppBondExposureState {
            bump: 1,
            version: ECONOMICS_VERSION,
            app_id_hash: [1; 32],
            mint,
            active_locked_amount: 70,
            total_routed_amount: 0,
            paused_new_bond_exposure: false,
            exposure_digest: [2; 32],
            updated_at: 0,
        };

        assert!(require_withdrawable_bond(&vault, &exposure, 30).is_ok());
        assert!(require_withdrawable_bond(&vault, &exposure, 31).is_err());
        exposure.active_locked_amount = 101;
        assert!(require_withdrawable_bond(&vault, &exposure, 1).is_err());
    }

    #[test]
    fn bond_disposition_policy_pause_blocks_new_locks() {
        let mut policy = ExternalAppBondDispositionPolicy {
            bump: 1,
            version: ECONOMICS_VERSION,
            policy_id: [8; 32],
            policy_epoch_digest: [1; 32],
            governance_authority: Pubkey::new_unique(),
            mint: Pubkey::new_unique(),
            max_case_amount: 100,
            paused: false,
            policy_digest: [9; 32],
            created_at: 0,
            updated_at: 0,
        };

        assert!(require_bond_policy_active(&policy).is_ok());
        policy.paused = true;
        assert!(require_bond_policy_active(&policy).is_err());
    }

    fn test_config() -> ExternalAppEconomicsConfig {
        ExternalAppEconomicsConfig {
            bump: 1,
            version: ECONOMICS_VERSION,
            admin: Pubkey::new_unique(),
            governance_authority: Pubkey::new_unique(),
            policy_epoch_digest: [1; 32],
            asset_mint: Pubkey::new_unique(),
            asset_token_program: Pubkey::new_unique(),
            asset_status: AssetStatus::TestOnly,
            withdrawal_lock_seconds: 0,
            paused_new_economic_exposure: false,
            created_at: 0,
            updated_at: 0,
        }
    }

    fn test_challenge_case() -> ExternalAppChallengeCase {
        ExternalAppChallengeCase {
            bump: 1,
            version: ECONOMICS_VERSION,
            app_id_hash: [1; 32],
            case_id: [2; 32],
            challenger: Pubkey::new_unique(),
            mint: Pubkey::new_unique(),
            case_vault_token_account: Pubkey::new_unique(),
            challenge_type: 1,
            evidence_hash: [3; 32],
            challenge_bond_raw: 10,
            response_digest: None,
            ruling_digest: None,
            appeal_window_ends_at: 0,
            status: ChallengeCaseStatus::Open,
            created_at: 0,
            updated_at: 0,
        }
    }
}
