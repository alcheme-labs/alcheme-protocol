use anchor_lang::prelude::*;
use anchor_lang::solana_program::keccak::hashv;

use crate::validation::{
    require_nonzero_digest, require_optional_nonzero_digest, HostedAppTrustRootError,
};

pub const APP_TRUST_ROOT_CONFIG_SEED: &[u8] = b"hosted_app_trust_root";
pub const HOSTED_APP_IDENTITY_SEED: &[u8] = b"hosted_app_identity";
pub const HOSTED_APP_RELEASE_SEED: &[u8] = b"hosted_app_release";
pub const HOSTED_APP_RELEASE_CHANNEL_SEED: &[u8] = b"hosted_app_release_channel";
pub const HOSTED_APP_CAPABILITY_DENY_SEED: &[u8] = b"hosted_app_capability_deny";
pub const HOSTED_APP_CREDENTIAL_ANCHOR_SEED: &[u8] = b"hosted_app_credential_anchor";
pub const HOSTED_APP_GOVERNANCE_EXECUTION_SEED: &[u8] = b"hosted_app_governance_execution";
pub const HOSTED_APP_GOVERNANCE_RECEIPT_TARGET_GUARD_SEED: &[u8] =
    b"hosted_app_receipt_target_guard";
pub const HOSTED_APP_POLICY_ANCHOR_SEED: &[u8] = b"hosted_app_policy_anchor";
pub const HOSTED_APP_INSTALLATION_SEED: &[u8] = b"hosted_app_installation";
pub const HOSTED_APP_TRUST_ROOT_VERSION: u16 = 1;
pub const MISSING_ACCOUNT_STATE_DIGEST: [u8; 32] = [255; 32];

const DISCRIMINATOR: usize = 8;
const BUMP_SIZE: usize = 1;
const DIGEST_SIZE: usize = 32;
const ENUM_SIZE: usize = 1;
const I64_SIZE: usize = 8;
const OPTION_DIGEST_SIZE: usize = 1 + DIGEST_SIZE;
const OPTION_I64_SIZE: usize = 1 + I64_SIZE;
const OPTION_SIGNATURE_SIZE: usize = 1 + 64;
const PUBKEY_SIZE: usize = 32;
const U16_SIZE: usize = 2;
const U64_SIZE: usize = 8;

#[derive(AnchorSerialize, AnchorDeserialize, Clone, Copy, Debug, PartialEq, Eq)]
pub enum HostedAppProductionStatus {
    Active,
    Suspended,
    Revoked,
}

impl Default for HostedAppProductionStatus {
    fn default() -> Self {
        Self::Active
    }
}

#[derive(AnchorSerialize, AnchorDeserialize, Clone, Copy, Debug, PartialEq, Eq)]
pub enum HostedAppReleaseKind {
    Production,
    CandidateAnchor,
}

impl Default for HostedAppReleaseKind {
    fn default() -> Self {
        Self::CandidateAnchor
    }
}

#[derive(AnchorSerialize, AnchorDeserialize, Clone, Copy, Debug, PartialEq, Eq)]
pub enum HostedAppSupportStatus {
    Active,
    Superseded,
    Lts,
    Deprecated,
    Grace,
    Expired,
    Revoked,
    Suspended,
}

impl Default for HostedAppSupportStatus {
    fn default() -> Self {
        Self::Active
    }
}

#[derive(AnchorSerialize, AnchorDeserialize, Clone, Copy, Debug, PartialEq, Eq)]
pub enum HostedAppCredentialAnchorType {
    RuntimeAttestation,
    CredentialIssuer,
    CredentialIssuerChange,
    CredentialSchema,
    CredentialSchemaChange,
    VerifierPolicy,
    RevocationFeed,
    OfflineVerificationBundle,
    VerifiableCredential,
    GovernanceDecision,
    ExternalExecution,
    StorageGrant,
    ForkGrant,
    PaymentAuthorization,
    PublishGrant,
    PublishConfirmation,
    AuditExport,
}

impl Default for HostedAppCredentialAnchorType {
    fn default() -> Self {
        Self::RuntimeAttestation
    }
}

impl HostedAppCredentialAnchorType {
    pub fn requires_verifier_context(&self) -> bool {
        matches!(
            self,
            Self::RuntimeAttestation
                | Self::OfflineVerificationBundle
                | Self::VerifiableCredential
                | Self::GovernanceDecision
                | Self::ExternalExecution
                | Self::StorageGrant
                | Self::ForkGrant
                | Self::PaymentAuthorization
                | Self::PublishGrant
                | Self::PublishConfirmation
                | Self::AuditExport
        )
    }
}

#[derive(AnchorSerialize, AnchorDeserialize, Clone, Copy, Debug, PartialEq, Eq)]
pub enum HostedAppPolicyAnchorType {
    CapabilityChange,
    OperationPackChange,
    ScopeAuthorityLifecycle,
    ScopeAuthorityChange,
    DataReleaseProfile,
    AppScopeBinding,
}

impl Default for HostedAppPolicyAnchorType {
    fn default() -> Self {
        Self::CapabilityChange
    }
}

#[derive(AnchorSerialize, AnchorDeserialize, Clone, Copy, Debug, PartialEq, Eq)]
pub enum HostedAppInstallationVisibility {
    PrivateDigest,
    PublicCommitment,
}

impl Default for HostedAppInstallationVisibility {
    fn default() -> Self {
        Self::PrivateDigest
    }
}

#[account]
pub struct AppTrustRootConfig {
    pub bump: u8,
    pub version: u16,
    pub admin: Pubkey,
    pub governance_authority: Pubkey,
    pub emergency_authority: Pubkey,
    pub event_program: Pubkey,
    pub event_emitter: Pubkey,
    pub paused: bool,
    pub total_apps: u64,
    pub created_at: i64,
    pub updated_at: i64,
}

impl AppTrustRootConfig {
    pub const SPACE: usize = 8 +  // discriminator
        1 +  // bump
        2 +  // version
        32 + // admin
        32 + // governance_authority
        32 + // emergency_authority
        32 + // event_program
        32 + // event_emitter
        1 +  // paused
        8 +  // total_apps
        8 +  // created_at
        8; // updated_at

    pub fn initialize(
        &mut self,
        bump: u8,
        admin: Pubkey,
        governance_authority: Pubkey,
        emergency_authority: Pubkey,
        event_program: Pubkey,
        event_emitter: Pubkey,
    ) -> Result<()> {
        let now = Clock::get()?.unix_timestamp;
        self.bump = bump;
        self.version = HOSTED_APP_TRUST_ROOT_VERSION;
        self.admin = admin;
        self.governance_authority = governance_authority;
        self.emergency_authority = emergency_authority;
        self.event_program = event_program;
        self.event_emitter = event_emitter;
        self.paused = false;
        self.total_apps = 0;
        self.created_at = now;
        self.updated_at = now;
        Ok(())
    }

    pub fn touch(&mut self) -> Result<()> {
        self.updated_at = Clock::get()?.unix_timestamp;
        Ok(())
    }

    pub fn state_digest(&self) -> [u8; 32] {
        let paused = [self.paused as u8];
        hashv(&[
            &self.version.to_le_bytes(),
            self.admin.as_ref(),
            self.governance_authority.as_ref(),
            self.emergency_authority.as_ref(),
            self.event_program.as_ref(),
            self.event_emitter.as_ref(),
            &paused,
            &self.total_apps.to_le_bytes(),
        ])
        .0
    }
}

#[account]
#[derive(Default)]
pub struct HostedAppIdentityRecord {
    pub bump: u8,
    pub version: u16,
    pub app_id_hash: [u8; 32],
    pub owner: Pubkey,
    pub operator_authority: Pubkey,
    pub governance_authority_ref_hash: [u8; 32],
    pub server_key_hash: [u8; 32],
    pub manifest_hash: [u8; 32],
    pub capability_policy_digest: [u8; 32],
    pub production_status: HostedAppProductionStatus,
    pub latest_release_digest: [u8; 32],
    pub latest_deny_digest: [u8; 32],
    pub revoked_at: Option<i64>,
    pub created_at: i64,
    pub updated_at: i64,
}

impl HostedAppIdentityRecord {
    pub const SPACE: usize = DISCRIMINATOR
        + BUMP_SIZE
        + U16_SIZE
        + DIGEST_SIZE
        + PUBKEY_SIZE
        + PUBKEY_SIZE
        + DIGEST_SIZE
        + DIGEST_SIZE
        + DIGEST_SIZE
        + DIGEST_SIZE
        + ENUM_SIZE
        + DIGEST_SIZE
        + DIGEST_SIZE
        + OPTION_I64_SIZE
        + I64_SIZE
        + I64_SIZE;

    #[allow(clippy::too_many_arguments)]
    pub fn register(
        &mut self,
        bump: u8,
        app_id_hash: [u8; 32],
        owner: Pubkey,
        operator_authority: Pubkey,
        governance_authority_ref_hash: [u8; 32],
        server_key_hash: [u8; 32],
        manifest_hash: [u8; 32],
        capability_policy_digest: [u8; 32],
        now: i64,
    ) -> Result<()> {
        require_nonzero_digest(&app_id_hash)?;
        require_nonzero_digest(&owner.to_bytes())?;
        require_nonzero_digest(&operator_authority.to_bytes())?;
        require_nonzero_digest(&governance_authority_ref_hash)?;
        require_nonzero_digest(&server_key_hash)?;
        require_nonzero_digest(&manifest_hash)?;
        require_nonzero_digest(&capability_policy_digest)?;

        self.bump = bump;
        self.version = HOSTED_APP_TRUST_ROOT_VERSION;
        self.app_id_hash = app_id_hash;
        self.owner = owner;
        self.operator_authority = operator_authority;
        self.governance_authority_ref_hash = governance_authority_ref_hash;
        self.server_key_hash = server_key_hash;
        self.manifest_hash = manifest_hash;
        self.capability_policy_digest = capability_policy_digest;
        self.production_status = HostedAppProductionStatus::Active;
        self.latest_release_digest = [0; 32];
        self.latest_deny_digest = [0; 32];
        self.revoked_at = None;
        self.created_at = now;
        self.updated_at = now;
        Ok(())
    }

    pub fn set_status(
        &mut self,
        next_status: HostedAppProductionStatus,
        governance_decision_digest: [u8; 32],
        now: i64,
    ) -> Result<()> {
        require_nonzero_digest(&governance_decision_digest)?;
        require_valid_status_transition(self.production_status, next_status)?;

        self.production_status = next_status;
        if next_status == HostedAppProductionStatus::Revoked {
            self.revoked_at = Some(now);
        }
        self.updated_at = now;
        Ok(())
    }

    pub fn state_digest(&self) -> [u8; 32] {
        let status = [self.production_status as u8];
        let revoked_at = self.revoked_at.unwrap_or_default().to_le_bytes();
        hashv(&[
            &self.app_id_hash,
            self.owner.as_ref(),
            self.operator_authority.as_ref(),
            &self.governance_authority_ref_hash,
            &self.server_key_hash,
            &self.manifest_hash,
            &self.capability_policy_digest,
            &status,
            &self.latest_release_digest,
            &self.latest_deny_digest,
            &revoked_at,
        ])
        .0
    }
}

#[account]
#[derive(Default)]
pub struct HostedAppReleaseCommitment {
    pub bump: u8,
    pub version: u16,
    pub app_id_hash: [u8; 32],
    pub release_id_hash: [u8; 32],
    pub manifest_hash: [u8; 32],
    pub bundle_hash: [u8; 32],
    pub bundle_uri_hash: [u8; 32],
    pub release_payload_digest: [u8; 32],
    pub bundle_cid_hash: Option<[u8; 32]>,
    pub capability_set_digest: [u8; 32],
    pub developer_pubkey: Pubkey,
    pub developer_signature_digest: [u8; 32],
    pub release_kind: HostedAppReleaseKind,
    pub support_status: HostedAppSupportStatus,
    pub promotion_digest: [u8; 32],
    pub created_at: i64,
    pub updated_at: i64,
}

impl HostedAppReleaseCommitment {
    pub const SPACE: usize = DISCRIMINATOR
        + BUMP_SIZE
        + U16_SIZE
        + DIGEST_SIZE
        + DIGEST_SIZE
        + DIGEST_SIZE
        + DIGEST_SIZE
        + DIGEST_SIZE
        + DIGEST_SIZE
        + OPTION_DIGEST_SIZE
        + DIGEST_SIZE
        + PUBKEY_SIZE
        + DIGEST_SIZE
        + ENUM_SIZE
        + ENUM_SIZE
        + DIGEST_SIZE
        + I64_SIZE
        + I64_SIZE;

    #[allow(clippy::too_many_arguments)]
    pub fn anchor(
        &mut self,
        bump: u8,
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
        now: i64,
    ) -> Result<()> {
        require_nonzero_digest(&app_id_hash)?;
        require_nonzero_digest(&release_id_hash)?;
        require_nonzero_digest(&manifest_hash)?;
        require_nonzero_digest(&bundle_hash)?;
        require_nonzero_digest(&bundle_uri_hash)?;
        require_nonzero_digest(&release_payload_digest)?;
        require_optional_nonzero_digest(&bundle_cid_hash)?;
        require_nonzero_digest(&capability_set_digest)?;
        require_nonzero_digest(&developer_pubkey.to_bytes())?;
        require_nonzero_digest(&developer_signature_digest)?;
        require_nonzero_digest(&promotion_digest)?;

        self.bump = bump;
        self.version = HOSTED_APP_TRUST_ROOT_VERSION;
        self.app_id_hash = app_id_hash;
        self.release_id_hash = release_id_hash;
        self.manifest_hash = manifest_hash;
        self.bundle_hash = bundle_hash;
        self.bundle_uri_hash = bundle_uri_hash;
        self.release_payload_digest = release_payload_digest;
        self.bundle_cid_hash = bundle_cid_hash;
        self.capability_set_digest = capability_set_digest;
        self.developer_pubkey = developer_pubkey;
        self.developer_signature_digest = developer_signature_digest;
        self.release_kind = release_kind;
        self.support_status = support_status;
        self.promotion_digest = promotion_digest;
        self.created_at = now;
        self.updated_at = now;
        Ok(())
    }

    pub fn commitment_digest(&self) -> [u8; 32] {
        let release_kind = [self.release_kind as u8];
        let support_status = [self.support_status as u8];
        let bundle_cid_hash = optional_digest_bytes(&self.bundle_cid_hash);
        hashv(&[
            &self.app_id_hash,
            &self.release_id_hash,
            &self.manifest_hash,
            &self.bundle_hash,
            &self.bundle_uri_hash,
            &self.release_payload_digest,
            &bundle_cid_hash,
            &self.capability_set_digest,
            self.developer_pubkey.as_ref(),
            &self.developer_signature_digest,
            &release_kind,
            &support_status,
            &self.promotion_digest,
        ])
        .0
    }
}

#[account]
#[derive(Default)]
pub struct HostedAppReleaseChannelCommitment {
    pub bump: u8,
    pub version: u16,
    pub app_id_hash: [u8; 32],
    pub channel_id_hash: [u8; 32],
    pub current_release_id_hash: [u8; 32],
    pub previous_release_id_hash: Option<[u8; 32]>,
    pub channel_policy_digest: [u8; 32],
    pub movement_receipt_digest: [u8; 32],
    pub updated_by: Pubkey,
    pub updated_at: i64,
}

impl HostedAppReleaseChannelCommitment {
    pub const SPACE: usize = DISCRIMINATOR
        + BUMP_SIZE
        + U16_SIZE
        + DIGEST_SIZE
        + DIGEST_SIZE
        + DIGEST_SIZE
        + OPTION_DIGEST_SIZE
        + DIGEST_SIZE
        + DIGEST_SIZE
        + PUBKEY_SIZE
        + I64_SIZE;

    #[allow(clippy::too_many_arguments)]
    pub fn move_channel(
        &mut self,
        bump: u8,
        app_id_hash: [u8; 32],
        channel_id_hash: [u8; 32],
        current_release_id_hash: [u8; 32],
        previous_release_id_hash: Option<[u8; 32]>,
        channel_policy_digest: [u8; 32],
        movement_receipt_digest: [u8; 32],
        updated_by: Pubkey,
        now: i64,
    ) -> Result<()> {
        require_nonzero_digest(&app_id_hash)?;
        require_nonzero_digest(&channel_id_hash)?;
        require_nonzero_digest(&current_release_id_hash)?;
        require_optional_nonzero_digest(&previous_release_id_hash)?;
        require_nonzero_digest(&channel_policy_digest)?;
        require_nonzero_digest(&movement_receipt_digest)?;
        require_nonzero_digest(&updated_by.to_bytes())?;
        let channel_already_exists = self.app_id_hash != [0; 32];
        if channel_already_exists {
            require!(
                self.app_id_hash == app_id_hash && self.channel_id_hash == channel_id_hash,
                HostedAppTrustRootError::HostedAppReleaseChannelBindingMismatch
            );
            require!(
                previous_release_id_hash == Some(self.current_release_id_hash),
                HostedAppTrustRootError::HostedAppReleaseChannelPreviousMismatch
            );
        }

        self.bump = bump;
        self.version = HOSTED_APP_TRUST_ROOT_VERSION;
        self.app_id_hash = app_id_hash;
        self.channel_id_hash = channel_id_hash;
        self.current_release_id_hash = current_release_id_hash;
        self.previous_release_id_hash = previous_release_id_hash;
        self.channel_policy_digest = channel_policy_digest;
        self.movement_receipt_digest = movement_receipt_digest;
        self.updated_by = updated_by;
        self.updated_at = now;
        Ok(())
    }

    pub fn commitment_digest(&self) -> [u8; 32] {
        let previous = optional_digest_bytes(&self.previous_release_id_hash);
        hashv(&[
            &self.app_id_hash,
            &self.channel_id_hash,
            &self.current_release_id_hash,
            &previous,
            &self.channel_policy_digest,
            &self.movement_receipt_digest,
            self.updated_by.as_ref(),
        ])
        .0
    }
}

#[account]
#[derive(Default)]
pub struct HostedAppCapabilityDenyCommitment {
    pub bump: u8,
    pub version: u16,
    pub app_id_hash: [u8; 32],
    pub release_id_hash: Option<[u8; 32]>,
    pub capability_id_hash: [u8; 32],
    pub deny_scope_hash: [u8; 32],
    pub authority_ref_hash: [u8; 32],
    pub reason_code_hash: [u8; 32],
    pub effective_at: i64,
    pub expires_at: Option<i64>,
    pub receipt_digest: [u8; 32],
    pub updated_at: i64,
}

impl HostedAppCapabilityDenyCommitment {
    pub const SPACE: usize = DISCRIMINATOR
        + BUMP_SIZE
        + U16_SIZE
        + DIGEST_SIZE
        + OPTION_DIGEST_SIZE
        + DIGEST_SIZE
        + DIGEST_SIZE
        + DIGEST_SIZE
        + DIGEST_SIZE
        + I64_SIZE
        + OPTION_I64_SIZE
        + DIGEST_SIZE
        + I64_SIZE;

    #[allow(clippy::too_many_arguments)]
    pub fn upsert(
        &mut self,
        bump: u8,
        app_id_hash: [u8; 32],
        release_id_hash: Option<[u8; 32]>,
        capability_id_hash: [u8; 32],
        deny_scope_hash: [u8; 32],
        authority_ref_hash: [u8; 32],
        reason_code_hash: [u8; 32],
        effective_at: i64,
        expires_at: Option<i64>,
        receipt_digest: [u8; 32],
        now: i64,
    ) -> Result<()> {
        require_nonzero_digest(&app_id_hash)?;
        require_optional_nonzero_digest(&release_id_hash)?;
        require_nonzero_digest(&capability_id_hash)?;
        require_nonzero_digest(&deny_scope_hash)?;
        require_nonzero_digest(&authority_ref_hash)?;
        require_nonzero_digest(&reason_code_hash)?;
        require_nonzero_digest(&receipt_digest)?;

        self.bump = bump;
        self.version = HOSTED_APP_TRUST_ROOT_VERSION;
        self.app_id_hash = app_id_hash;
        self.release_id_hash = release_id_hash;
        self.capability_id_hash = capability_id_hash;
        self.deny_scope_hash = deny_scope_hash;
        self.authority_ref_hash = authority_ref_hash;
        self.reason_code_hash = reason_code_hash;
        self.effective_at = effective_at;
        self.expires_at = expires_at;
        self.receipt_digest = receipt_digest;
        self.updated_at = now;
        Ok(())
    }

    pub fn commitment_digest(&self) -> [u8; 32] {
        let release = optional_digest_bytes(&self.release_id_hash);
        let expires_at = optional_i64_bytes(&self.expires_at);
        hashv(&[
            &self.app_id_hash,
            &release,
            &self.capability_id_hash,
            &self.deny_scope_hash,
            &self.authority_ref_hash,
            &self.reason_code_hash,
            &self.effective_at.to_le_bytes(),
            &expires_at,
            &self.receipt_digest,
        ])
        .0
    }
}

#[account]
#[derive(Default)]
pub struct HostedAppCredentialDigestAnchor {
    pub bump: u8,
    pub version: u16,
    pub anchor_type: HostedAppCredentialAnchorType,
    pub object_ref_hash: [u8; 32],
    pub digest: [u8; 32],
    pub schema_digest: Option<[u8; 32]>,
    pub verifier_policy_digest: Option<[u8; 32]>,
    pub revocation_feed_digest: Option<[u8; 32]>,
    pub expires_at: Option<i64>,
    pub created_at: i64,
}

impl HostedAppCredentialDigestAnchor {
    pub const SPACE: usize = DISCRIMINATOR
        + BUMP_SIZE
        + U16_SIZE
        + ENUM_SIZE
        + DIGEST_SIZE
        + DIGEST_SIZE
        + OPTION_DIGEST_SIZE
        + OPTION_DIGEST_SIZE
        + OPTION_DIGEST_SIZE
        + OPTION_I64_SIZE
        + I64_SIZE;

    #[allow(clippy::too_many_arguments)]
    pub fn anchor(
        &mut self,
        bump: u8,
        anchor_type: HostedAppCredentialAnchorType,
        object_ref_hash: [u8; 32],
        digest: [u8; 32],
        schema_digest: Option<[u8; 32]>,
        verifier_policy_digest: Option<[u8; 32]>,
        revocation_feed_digest: Option<[u8; 32]>,
        expires_at: Option<i64>,
        now: i64,
    ) -> Result<()> {
        require_nonzero_digest(&object_ref_hash)?;
        require_nonzero_digest(&digest)?;
        require_optional_nonzero_digest(&schema_digest)?;
        require_optional_nonzero_digest(&verifier_policy_digest)?;
        require_optional_nonzero_digest(&revocation_feed_digest)?;

        if anchor_type.requires_verifier_context() {
            require!(
                schema_digest.is_some()
                    && verifier_policy_digest.is_some()
                    && revocation_feed_digest.is_some(),
                HostedAppTrustRootError::MissingRequiredDigest
            );
        }

        self.bump = bump;
        self.version = HOSTED_APP_TRUST_ROOT_VERSION;
        self.anchor_type = anchor_type;
        self.object_ref_hash = object_ref_hash;
        self.digest = digest;
        self.schema_digest = schema_digest;
        self.verifier_policy_digest = verifier_policy_digest;
        self.revocation_feed_digest = revocation_feed_digest;
        self.expires_at = expires_at;
        self.created_at = now;
        Ok(())
    }

    pub fn commitment_digest(&self) -> [u8; 32] {
        let anchor_type = [self.anchor_type as u8];
        let schema = optional_digest_bytes(&self.schema_digest);
        let verifier_policy = optional_digest_bytes(&self.verifier_policy_digest);
        let revocation_feed = optional_digest_bytes(&self.revocation_feed_digest);
        let expires_at = optional_i64_bytes(&self.expires_at);
        hashv(&[
            &anchor_type,
            &self.object_ref_hash,
            &self.digest,
            &schema,
            &verifier_policy,
            &revocation_feed,
            &expires_at,
        ])
        .0
    }
}

#[account]
#[derive(Default)]
pub struct HostedAppGovernanceExecutionRecord {
    pub bump: u8,
    pub version: u16,
    pub receipt_digest: [u8; 32],
    pub operation_id_hash: [u8; 32],
    pub replay_domain_hash: [u8; 32],
    pub execution_nonce_hash: [u8; 32],
    pub execution_target_hash: [u8; 32],
    pub state_precondition_digest: [u8; 32],
    pub state_after_digest: [u8; 32],
    pub executed_by: Pubkey,
    pub source_tx_signature: Option<[u8; 64]>,
    pub executed_at: i64,
}

impl HostedAppGovernanceExecutionRecord {
    pub const SPACE: usize = DISCRIMINATOR
        + BUMP_SIZE
        + U16_SIZE
        + DIGEST_SIZE
        + DIGEST_SIZE
        + DIGEST_SIZE
        + DIGEST_SIZE
        + DIGEST_SIZE
        + DIGEST_SIZE
        + DIGEST_SIZE
        + PUBKEY_SIZE
        + OPTION_SIGNATURE_SIZE
        + I64_SIZE;

    #[allow(clippy::too_many_arguments)]
    pub fn consume(
        &mut self,
        bump: u8,
        receipt_digest: [u8; 32],
        operation_id_hash: [u8; 32],
        replay_domain_hash: [u8; 32],
        execution_nonce_hash: [u8; 32],
        execution_target_hash: [u8; 32],
        state_precondition_digest: [u8; 32],
        state_after_digest: [u8; 32],
        executed_by: Pubkey,
        source_tx_signature: Option<[u8; 64]>,
        executed_at: i64,
    ) -> Result<()> {
        require!(
            self.receipt_digest == [0; 32],
            HostedAppTrustRootError::GovernanceExecutionAlreadyConsumed
        );
        require_nonzero_digest(&receipt_digest)?;
        require_nonzero_digest(&operation_id_hash)?;
        require_nonzero_digest(&replay_domain_hash)?;
        require_nonzero_digest(&execution_nonce_hash)?;
        require_nonzero_digest(&execution_target_hash)?;
        require_nonzero_digest(&state_precondition_digest)?;
        require_nonzero_digest(&state_after_digest)?;
        require_nonzero_digest(&executed_by.to_bytes())?;

        self.bump = bump;
        self.version = HOSTED_APP_TRUST_ROOT_VERSION;
        self.receipt_digest = receipt_digest;
        self.operation_id_hash = operation_id_hash;
        self.replay_domain_hash = replay_domain_hash;
        self.execution_nonce_hash = execution_nonce_hash;
        self.execution_target_hash = execution_target_hash;
        self.state_precondition_digest = state_precondition_digest;
        self.state_after_digest = state_after_digest;
        self.executed_by = executed_by;
        self.source_tx_signature = source_tx_signature;
        self.executed_at = executed_at;
        Ok(())
    }
}

#[account]
#[derive(Default)]
pub struct HostedAppGovernanceReceiptTargetGuard {
    pub bump: u8,
    pub version: u16,
    pub receipt_digest: [u8; 32],
    pub execution_target_hash: [u8; 32],
    pub replay_domain_hash: [u8; 32],
    pub execution_nonce_hash: [u8; 32],
    pub governance_execution_record: Pubkey,
    pub consumed_at: i64,
}

impl HostedAppGovernanceReceiptTargetGuard {
    pub const SPACE: usize = DISCRIMINATOR
        + BUMP_SIZE
        + U16_SIZE
        + DIGEST_SIZE
        + DIGEST_SIZE
        + DIGEST_SIZE
        + DIGEST_SIZE
        + PUBKEY_SIZE
        + I64_SIZE;

    pub fn consume(
        &mut self,
        bump: u8,
        receipt_digest: [u8; 32],
        execution_target_hash: [u8; 32],
        replay_domain_hash: [u8; 32],
        execution_nonce_hash: [u8; 32],
        governance_execution_record: Pubkey,
        consumed_at: i64,
    ) -> Result<()> {
        require!(
            self.receipt_digest == [0; 32],
            HostedAppTrustRootError::GovernanceExecutionAlreadyConsumed
        );
        require_nonzero_digest(&receipt_digest)?;
        require_nonzero_digest(&execution_target_hash)?;
        require_nonzero_digest(&replay_domain_hash)?;
        require_nonzero_digest(&execution_nonce_hash)?;
        require_nonzero_digest(&governance_execution_record.to_bytes())?;

        self.bump = bump;
        self.version = HOSTED_APP_TRUST_ROOT_VERSION;
        self.receipt_digest = receipt_digest;
        self.execution_target_hash = execution_target_hash;
        self.replay_domain_hash = replay_domain_hash;
        self.execution_nonce_hash = execution_nonce_hash;
        self.governance_execution_record = governance_execution_record;
        self.consumed_at = consumed_at;
        Ok(())
    }
}

#[account]
#[derive(Default)]
pub struct HostedAppPolicyDigestAnchor {
    pub bump: u8,
    pub version: u16,
    pub anchor_type: HostedAppPolicyAnchorType,
    pub object_ref_hash: [u8; 32],
    pub digest: [u8; 32],
    pub policy_version_hash: Option<[u8; 32]>,
    pub governance_decision_digest: Option<[u8; 32]>,
    pub effective_at: i64,
    pub expires_at: Option<i64>,
    pub created_at: i64,
}

impl HostedAppPolicyDigestAnchor {
    pub const SPACE: usize = DISCRIMINATOR
        + BUMP_SIZE
        + U16_SIZE
        + ENUM_SIZE
        + DIGEST_SIZE
        + DIGEST_SIZE
        + OPTION_DIGEST_SIZE
        + OPTION_DIGEST_SIZE
        + I64_SIZE
        + OPTION_I64_SIZE
        + I64_SIZE;

    #[allow(clippy::too_many_arguments)]
    pub fn anchor(
        &mut self,
        bump: u8,
        anchor_type: HostedAppPolicyAnchorType,
        object_ref_hash: [u8; 32],
        digest: [u8; 32],
        policy_version_hash: Option<[u8; 32]>,
        governance_decision_digest: Option<[u8; 32]>,
        effective_at: i64,
        expires_at: Option<i64>,
        now: i64,
    ) -> Result<()> {
        require_nonzero_digest(&object_ref_hash)?;
        require_nonzero_digest(&digest)?;
        require_optional_nonzero_digest(&policy_version_hash)?;
        require_optional_nonzero_digest(&governance_decision_digest)?;

        self.bump = bump;
        self.version = HOSTED_APP_TRUST_ROOT_VERSION;
        self.anchor_type = anchor_type;
        self.object_ref_hash = object_ref_hash;
        self.digest = digest;
        self.policy_version_hash = policy_version_hash;
        self.governance_decision_digest = governance_decision_digest;
        self.effective_at = effective_at;
        self.expires_at = expires_at;
        self.created_at = now;
        Ok(())
    }

    pub fn commitment_digest(&self) -> [u8; 32] {
        let anchor_type = [self.anchor_type as u8];
        let policy_version = optional_digest_bytes(&self.policy_version_hash);
        let governance_decision = optional_digest_bytes(&self.governance_decision_digest);
        let expires_at = optional_i64_bytes(&self.expires_at);
        hashv(&[
            &anchor_type,
            &self.object_ref_hash,
            &self.digest,
            &policy_version,
            &governance_decision,
            &self.effective_at.to_le_bytes(),
            &expires_at,
        ])
        .0
    }
}

#[account]
#[derive(Default)]
pub struct HostedAppCircleInstallationCommitment {
    pub bump: u8,
    pub version: u16,
    pub app_id_hash: [u8; 32],
    pub circle_id_hash: [u8; 32],
    pub release_id_hash: Option<[u8; 32]>,
    pub channel_id_hash: Option<[u8; 32]>,
    pub current_release_id_hash: [u8; 32],
    pub manifest_hash: [u8; 32],
    pub update_policy_hash: [u8; 32],
    pub allowed_capabilities_digest: [u8; 32],
    pub trust_state_hash: [u8; 32],
    pub policy_epoch: u64,
    pub governance_receipt_digest: Option<[u8; 32]>,
    pub installation_digest: [u8; 32],
    pub visibility: HostedAppInstallationVisibility,
    pub created_at: i64,
}

impl HostedAppCircleInstallationCommitment {
    pub const SPACE: usize = DISCRIMINATOR
        + BUMP_SIZE
        + U16_SIZE
        + DIGEST_SIZE
        + DIGEST_SIZE
        + OPTION_DIGEST_SIZE
        + OPTION_DIGEST_SIZE
        + DIGEST_SIZE
        + DIGEST_SIZE
        + DIGEST_SIZE
        + DIGEST_SIZE
        + DIGEST_SIZE
        + U64_SIZE
        + OPTION_DIGEST_SIZE
        + DIGEST_SIZE
        + ENUM_SIZE
        + I64_SIZE;

    #[allow(clippy::too_many_arguments)]
    pub fn anchor(
        &mut self,
        bump: u8,
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
        now: i64,
    ) -> Result<()> {
        require_nonzero_digest(&app_id_hash)?;
        require_nonzero_digest(&circle_id_hash)?;
        require_optional_nonzero_digest(&release_id_hash)?;
        require_optional_nonzero_digest(&channel_id_hash)?;
        require_nonzero_digest(&current_release_id_hash)?;
        require!(
            release_id_hash.is_none() || release_id_hash == Some(current_release_id_hash),
            HostedAppTrustRootError::HostedAppInstallationReleaseMismatch
        );
        require!(
            channel_id_hash.is_none(),
            HostedAppTrustRootError::HostedAppInstallationChannelUnsupported
        );
        require_nonzero_digest(&manifest_hash)?;
        require_nonzero_digest(&update_policy_hash)?;
        require_nonzero_digest(&allowed_capabilities_digest)?;
        require_nonzero_digest(&trust_state_hash)?;
        require_optional_nonzero_digest(&governance_receipt_digest)?;
        require_nonzero_digest(&installation_digest)?;

        self.bump = bump;
        self.version = HOSTED_APP_TRUST_ROOT_VERSION;
        self.app_id_hash = app_id_hash;
        self.circle_id_hash = circle_id_hash;
        self.release_id_hash = release_id_hash;
        self.channel_id_hash = channel_id_hash;
        self.current_release_id_hash = current_release_id_hash;
        self.manifest_hash = manifest_hash;
        self.update_policy_hash = update_policy_hash;
        self.allowed_capabilities_digest = allowed_capabilities_digest;
        self.trust_state_hash = trust_state_hash;
        self.policy_epoch = policy_epoch;
        self.governance_receipt_digest = governance_receipt_digest;
        self.installation_digest = installation_digest;
        self.visibility = visibility;
        self.created_at = now;
        Ok(())
    }

    pub fn commitment_digest(&self) -> [u8; 32] {
        let release = optional_digest_bytes(&self.release_id_hash);
        let channel = optional_digest_bytes(&self.channel_id_hash);
        let governance_receipt = optional_digest_bytes(&self.governance_receipt_digest);
        let visibility = [self.visibility as u8];
        hashv(&[
            &self.app_id_hash,
            &self.circle_id_hash,
            &release,
            &channel,
            &self.current_release_id_hash,
            &self.manifest_hash,
            &self.update_policy_hash,
            &self.allowed_capabilities_digest,
            &self.trust_state_hash,
            &self.policy_epoch.to_le_bytes(),
            &governance_receipt,
            &self.installation_digest,
            &visibility,
        ])
        .0
    }
}

fn require_valid_status_transition(
    current_status: HostedAppProductionStatus,
    next_status: HostedAppProductionStatus,
) -> Result<()> {
    require!(
        !(current_status == HostedAppProductionStatus::Revoked
            && next_status != HostedAppProductionStatus::Revoked),
        HostedAppTrustRootError::InvalidStatusTransition
    );
    Ok(())
}

fn optional_digest_bytes(value: &Option<[u8; 32]>) -> [u8; 33] {
    let mut output = [0u8; 33];
    if let Some(digest) = value {
        output[0] = 1;
        output[1..].copy_from_slice(digest);
    }
    output
}

fn optional_i64_bytes(value: &Option<i64>) -> [u8; 9] {
    let mut output = [0u8; 9];
    if let Some(inner) = value {
        output[0] = 1;
        output[1..].copy_from_slice(&inner.to_le_bytes());
    }
    output
}
