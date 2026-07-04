use crate::state::{
    AppTrustRootConfig, HostedAppIdentityRecord, HostedAppProductionStatus,
    HostedAppReleaseCommitment, HostedAppSupportStatus,
};
use anchor_lang::prelude::*;

#[error_code]
pub enum HostedAppTrustRootError {
    #[msg("invalid digest")]
    InvalidDigest,
    #[msg("missing required digest")]
    MissingRequiredDigest,
    #[msg("trust root is paused")]
    TrustRootPaused,
    #[msg("unauthorized governance authority")]
    UnauthorizedGovernanceAuthority,
    #[msg("unauthorized emergency authority")]
    UnauthorizedEmergencyAuthority,
    #[msg("invalid event account")]
    InvalidEventAccount,
    #[msg("invalid hosted app status transition")]
    InvalidStatusTransition,
    #[msg("emergency authority cannot expand hosted app authority")]
    EmergencyExpansionForbidden,
    #[msg("state precondition digest mismatch")]
    StatePreconditionMismatch,
    #[msg("governance execution record already consumed")]
    GovernanceExecutionAlreadyConsumed,
    #[msg("hosted app identity is not active")]
    HostedAppIdentityNotActive,
    #[msg("hosted app release binding mismatch")]
    HostedAppReleaseBindingMismatch,
    #[msg("hosted app release is not serving")]
    HostedAppReleaseNotServing,
    #[msg("hosted app release channel binding mismatch")]
    HostedAppReleaseChannelBindingMismatch,
    #[msg("hosted app release channel previous release mismatch")]
    HostedAppReleaseChannelPreviousMismatch,
    #[msg("hosted app installation release binding mismatch")]
    HostedAppInstallationReleaseMismatch,
    #[msg("hosted app installation channel binding is not yet supported")]
    HostedAppInstallationChannelUnsupported,
}

pub fn require_nonzero_digest(value: &[u8; 32]) -> Result<()> {
    require!(
        value.iter().any(|byte| *byte != 0),
        HostedAppTrustRootError::InvalidDigest
    );
    Ok(())
}

pub fn require_optional_nonzero_digest(value: &Option<[u8; 32]>) -> Result<()> {
    if let Some(digest) = value {
        require_nonzero_digest(digest)?;
    }
    Ok(())
}

pub fn require_governance_authority(
    config: &AppTrustRootConfig,
    governance_authority: &Signer<'_>,
) -> Result<()> {
    require_keys_eq!(
        governance_authority.key(),
        config.governance_authority,
        HostedAppTrustRootError::UnauthorizedGovernanceAuthority
    );
    Ok(())
}

pub fn require_emergency_authority(
    config: &AppTrustRootConfig,
    emergency_authority: &Signer<'_>,
) -> Result<()> {
    require_keys_eq!(
        emergency_authority.key(),
        config.emergency_authority,
        HostedAppTrustRootError::UnauthorizedEmergencyAuthority
    );
    Ok(())
}

pub fn require_trust_root_unpaused(config: &AppTrustRootConfig) -> Result<()> {
    require!(!config.paused, HostedAppTrustRootError::TrustRootPaused);
    Ok(())
}

pub fn require_active_hosted_app_identity(identity: &HostedAppIdentityRecord) -> Result<()> {
    require!(
        identity.production_status == HostedAppProductionStatus::Active,
        HostedAppTrustRootError::HostedAppIdentityNotActive
    );
    Ok(())
}

pub fn require_active_release_commitment(
    release: &HostedAppReleaseCommitment,
    app_id_hash: [u8; 32],
    release_id_hash: [u8; 32],
) -> Result<()> {
    require!(
        release.app_id_hash == app_id_hash && release.release_id_hash == release_id_hash,
        HostedAppTrustRootError::HostedAppReleaseBindingMismatch
    );
    require!(
        matches!(
            release.support_status,
            HostedAppSupportStatus::Active
                | HostedAppSupportStatus::Lts
                | HostedAppSupportStatus::Grace
        ),
        HostedAppTrustRootError::HostedAppReleaseNotServing
    );
    Ok(())
}

pub fn validate_event_accounts(
    config: &AppTrustRootConfig,
    event_program: &AccountInfo,
    event_emitter: &AccountInfo,
) -> Result<()> {
    require_keys_eq!(
        *event_program.key,
        config.event_program,
        HostedAppTrustRootError::InvalidEventAccount
    );
    require_keys_eq!(
        *event_emitter.key,
        config.event_emitter,
        HostedAppTrustRootError::InvalidEventAccount
    );
    Ok(())
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn rejects_zero_digest() {
        let result = require_nonzero_digest(&[0u8; 32]);

        assert!(result.is_err());
    }

    #[test]
    fn accepts_nonzero_digest() {
        let result = require_nonzero_digest(&[1u8; 32]);

        assert!(result.is_ok());
    }
}
