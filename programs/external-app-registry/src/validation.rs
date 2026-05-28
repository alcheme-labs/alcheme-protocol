use crate::state::ExternalAppRegistryConfig;
use alcheme_shared::ExternalAppRegistryStatus;
use anchor_lang::prelude::*;

#[error_code]
pub enum ExternalAppRegistryError {
    #[msg("invalid digest")]
    InvalidDigest,
    #[msg("registry is paused")]
    RegistryPaused,
    #[msg("unauthorized governance authority")]
    UnauthorizedGovernanceAuthority,
    #[msg("invalid registry status transition")]
    InvalidStatusTransition,
    #[msg("invalid event account")]
    InvalidEventAccount,
}

pub fn require_nonzero_hash(value: &[u8; 32]) -> Result<()> {
    require!(
        value.iter().any(|byte| *byte != 0),
        ExternalAppRegistryError::InvalidDigest
    );
    Ok(())
}

pub fn require_governance_authority(
    registry_config: &ExternalAppRegistryConfig,
    governance_authority: &Signer<'_>,
) -> Result<()> {
    require_keys_eq!(
        governance_authority.key(),
        registry_config.governance_authority,
        ExternalAppRegistryError::UnauthorizedGovernanceAuthority
    );
    Ok(())
}

pub fn require_registry_unpaused(registry_config: &ExternalAppRegistryConfig) -> Result<()> {
    require!(
        !registry_config.paused,
        ExternalAppRegistryError::RegistryPaused
    );
    Ok(())
}

pub fn require_valid_status_transition(
    current: ExternalAppRegistryStatus,
    next: ExternalAppRegistryStatus,
) -> Result<()> {
    require!(
        !(current == ExternalAppRegistryStatus::Revoked && next != ExternalAppRegistryStatus::Revoked),
        ExternalAppRegistryError::InvalidStatusTransition
    );
    Ok(())
}

pub fn validate_event_accounts(
    registry_config: &ExternalAppRegistryConfig,
    event_program: &AccountInfo,
    event_emitter: &AccountInfo,
) -> Result<()> {
    require_keys_eq!(
        *event_program.key,
        registry_config.event_program,
        ExternalAppRegistryError::InvalidEventAccount
    );
    require_keys_eq!(
        *event_emitter.key,
        registry_config.event_emitter,
        ExternalAppRegistryError::InvalidEventAccount
    );
    Ok(())
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn rejects_zero_hash_digest() {
        let result = require_nonzero_hash(&[0u8; 32]);

        assert!(result.is_err());
    }

    #[test]
    fn accepts_nonzero_hash_digest() {
        let result = require_nonzero_hash(&[1u8; 32]);

        assert!(result.is_ok());
    }

    #[test]
    fn revoked_status_cannot_move_back_to_active() {
        let result = require_valid_status_transition(
            ExternalAppRegistryStatus::Revoked,
            ExternalAppRegistryStatus::Active,
        );

        assert!(result.is_err());
    }
}
