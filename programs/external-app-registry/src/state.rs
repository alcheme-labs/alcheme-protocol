use alcheme_shared::ExternalAppRegistryStatus;
use anchor_lang::prelude::*;

pub const REGISTRY_CONFIG_SEED: &[u8] = b"external_app_registry";
pub const EXTERNAL_APP_RECORD_SEED: &[u8] = b"external_app";
pub const REGISTRY_VERSION: u16 = 2;

#[account]
pub struct ExternalAppRegistryConfig {
    pub bump: u8,
    pub version: u16,
    pub admin: Pubkey,
    pub governance_authority: Pubkey,
    pub event_program: Pubkey,
    pub event_emitter: Pubkey,
    pub paused: bool,
    pub total_apps: u64,
    pub created_at: i64,
    pub updated_at: i64,
}

impl ExternalAppRegistryConfig {
    pub const SPACE: usize =
        8 +  // discriminator
        1 +  // bump
        2 +  // version
        32 + // admin
        32 + // governance_authority
        32 + // event_program
        32 + // event_emitter
        1 +  // paused
        8 +  // total_apps
        8 +  // created_at
        8;   // updated_at

    pub fn initialize(
        &mut self,
        bump: u8,
        admin: Pubkey,
        governance_authority: Pubkey,
        event_program: Pubkey,
        event_emitter: Pubkey,
    ) -> Result<()> {
        let now = Clock::get()?.unix_timestamp;
        self.bump = bump;
        self.version = REGISTRY_VERSION;
        self.admin = admin;
        self.governance_authority = governance_authority;
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
}

#[account]
pub struct ExternalAppRecord {
    pub bump: u8,
    pub version: u16,
    pub app_id_hash: [u8; 32],
    pub owner: Pubkey,
    pub server_key_hash: [u8; 32],
    pub manifest_hash: [u8; 32],
    pub owner_assertion_hash: [u8; 32],
    pub policy_state_digest: [u8; 32],
    pub review_circle_id: u32,
    pub review_policy_digest: [u8; 32],
    pub decision_digest: [u8; 32],
    pub execution_intent_digest: [u8; 32],
    pub execution_receipt_digest: Option<[u8; 32]>,
    pub registry_status: ExternalAppRegistryStatus,
    pub expires_at: i64,
    pub revoked_at: i64,
    pub created_at: i64,
    pub updated_at: i64,
}

impl ExternalAppRecord {
    pub const SPACE: usize =
        8 +      // discriminator
        1 +      // bump
        2 +      // version
        32 +     // app_id_hash
        32 +     // owner
        32 +     // server_key_hash
        32 +     // manifest_hash
        32 +     // owner_assertion_hash
        32 +     // policy_state_digest
        4 +      // review_circle_id
        32 +     // review_policy_digest
        32 +     // decision_digest
        32 +     // execution_intent_digest
        1 + 32 + // execution_receipt_digest option tag + value
        1 +      // registry_status
        8 +      // expires_at
        8 +      // revoked_at
        8 +      // created_at
        8;       // updated_at

    #[allow(clippy::too_many_arguments)]
    pub fn upsert_registration(
        &mut self,
        bump: u8,
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
    ) -> Result<bool> {
        let now = Clock::get()?.unix_timestamp;
        let is_new = self.version == 0;
        if is_new {
            self.created_at = now;
            self.bump = bump;
            self.app_id_hash = app_id_hash;
        }
        self.version = REGISTRY_VERSION;
        self.owner = owner;
        self.server_key_hash = server_key_hash;
        self.manifest_hash = manifest_hash;
        self.owner_assertion_hash = owner_assertion_hash;
        self.policy_state_digest = policy_state_digest;
        self.review_circle_id = review_circle_id;
        self.review_policy_digest = review_policy_digest;
        self.decision_digest = decision_digest;
        self.execution_intent_digest = execution_intent_digest;
        self.execution_receipt_digest = None;
        self.registry_status = ExternalAppRegistryStatus::Active;
        self.expires_at = expires_at;
        self.revoked_at = 0;
        self.updated_at = now;
        Ok(is_new)
    }

    pub fn touch(&mut self) -> Result<()> {
        self.updated_at = Clock::get()?.unix_timestamp;
        Ok(())
    }
}
