use anchor_lang::prelude::*;

pub mod instructions;
pub mod state;
pub mod validation;

pub use instructions::*;
pub use state::*;
pub use validation::*;

declare_id!("4eeDm2Qs6YSQMd5mj9KhtBuQdGUjpxbREfHGKbxnNzae");

#[program]
pub mod hosted_app_trust_root {
    use super::*;

    pub fn initialize_app_trust_root(
        ctx: Context<InitializeAppTrustRoot>,
        governance_authority: Pubkey,
        emergency_authority: Pubkey,
        event_program: Pubkey,
        event_emitter: Pubkey,
    ) -> Result<()> {
        instructions::initialize_app_trust_root(
            ctx,
            governance_authority,
            emergency_authority,
            event_program,
            event_emitter,
        )
    }

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
        instructions::register_hosted_app_identity(
            ctx,
            app_id_hash,
            owner,
            operator_authority,
            governance_authority_ref_hash,
            server_key_hash,
            manifest_hash,
            capability_policy_digest,
            proof,
        )
    }

    pub fn set_hosted_app_status(
        ctx: Context<SetHostedAppStatus>,
        app_id_hash: [u8; 32],
        next_status: HostedAppProductionStatus,
        emergency: bool,
        proof: GovernanceExecutionProof,
    ) -> Result<()> {
        instructions::set_hosted_app_status(ctx, app_id_hash, next_status, emergency, proof)
    }

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
        instructions::anchor_hosted_app_release(
            ctx,
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
            proof,
        )
    }

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
        instructions::move_hosted_app_release_channel(
            ctx,
            app_id_hash,
            channel_id_hash,
            current_release_id_hash,
            previous_release_id_hash,
            channel_policy_digest,
            movement_receipt_digest,
            proof,
        )
    }

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
        instructions::upsert_hosted_app_capability_deny(
            ctx,
            app_id_hash,
            release_id_hash,
            capability_id_hash,
            deny_scope_hash,
            authority_ref_hash,
            reason_code_hash,
            effective_at,
            expires_at,
            emergency,
            proof,
        )
    }

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
        instructions::anchor_hosted_app_credential_digest(
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
        instructions::anchor_hosted_app_policy_digest(
            ctx,
            anchor_type,
            object_ref_hash,
            digest,
            policy_version_hash,
            governance_decision_digest,
            effective_at,
            expires_at,
            proof,
        )
    }

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
        instructions::anchor_hosted_app_offline_bundle_digest(
            ctx,
            object_ref_hash,
            bundle_digest,
            issuer_key_set_digest,
            verifier_policy_digest,
            revocation_snapshot_digest,
            expires_at,
            proof,
        )
    }

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
        instructions::anchor_hosted_app_circle_installation_digest(
            ctx,
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
            proof,
        )
    }

    pub fn rotate_governance_authority(
        ctx: Context<RotateGovernanceAuthority>,
        next_governance_authority: Pubkey,
        proof: GovernanceExecutionProof,
    ) -> Result<()> {
        instructions::rotate_governance_authority(ctx, next_governance_authority, proof)
    }

    pub fn pause_app_trust_root(
        ctx: Context<PauseAppTrustRoot>,
        paused: bool,
        emergency: bool,
        proof: GovernanceExecutionProof,
    ) -> Result<()> {
        instructions::pause_app_trust_root(ctx, paused, emergency, proof)
    }
}
