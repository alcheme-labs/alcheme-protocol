use anchor_lang::prelude::*;

pub mod instructions;
pub mod state;
pub mod validation;

pub use instructions::*;
pub use state::*;
pub use validation::*;

declare_id!("FT4n9xkfEafYP2MSmqwur3xCeu361Vzrfpz8XNmaAG7J");

#[program]
pub mod external_app_registry {
    use super::*;

    pub fn initialize_registry(
        ctx: Context<InitializeRegistry>,
        governance_authority: Pubkey,
        event_program: Pubkey,
        event_emitter: Pubkey,
    ) -> Result<()> {
        instructions::initialize_registry(ctx, governance_authority, event_program, event_emitter)
    }

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
        instructions::anchor_external_app_registration(
            ctx,
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
        )
    }

    pub fn anchor_execution_receipt(
        ctx: Context<AnchorExecutionReceipt>,
        app_id_hash: [u8; 32],
        execution_receipt_digest: [u8; 32],
    ) -> Result<()> {
        instructions::anchor_execution_receipt(ctx, app_id_hash, execution_receipt_digest)
    }

    pub fn rotate_server_key(
        ctx: Context<UpdateExternalAppRegistryRecord>,
        app_id_hash: [u8; 32],
        server_key_hash: [u8; 32],
        decision_digest: [u8; 32],
        execution_intent_digest: [u8; 32],
    ) -> Result<()> {
        instructions::rotate_server_key(
            ctx,
            app_id_hash,
            server_key_hash,
            decision_digest,
            execution_intent_digest,
        )
    }

    pub fn update_manifest_hash(
        ctx: Context<UpdateExternalAppRegistryRecord>,
        app_id_hash: [u8; 32],
        manifest_hash: [u8; 32],
        policy_state_digest: [u8; 32],
        decision_digest: [u8; 32],
        execution_intent_digest: [u8; 32],
    ) -> Result<()> {
        instructions::update_manifest_hash(
            ctx,
            app_id_hash,
            manifest_hash,
            policy_state_digest,
            decision_digest,
            execution_intent_digest,
        )
    }

    pub fn set_registry_status(
        ctx: Context<UpdateExternalAppRegistryRecord>,
        app_id_hash: [u8; 32],
        registry_status: alcheme_shared::ExternalAppRegistryStatus,
        decision_digest: [u8; 32],
        execution_intent_digest: [u8; 32],
    ) -> Result<()> {
        instructions::set_registry_status(
            ctx,
            app_id_hash,
            registry_status,
            decision_digest,
            execution_intent_digest,
        )
    }

    pub fn set_governance_authority(
        ctx: Context<SetGovernanceAuthority>,
        governance_authority: Pubkey,
    ) -> Result<()> {
        instructions::set_governance_authority(ctx, governance_authority)
    }

    pub fn pause_registry(ctx: Context<PauseRegistry>, paused: bool) -> Result<()> {
        instructions::pause_registry(ctx, paused)
    }
}
