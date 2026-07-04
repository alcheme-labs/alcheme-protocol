use anchor_lang::prelude::Pubkey;
use anchor_lang::solana_program::{
    account_info::AccountInfo, entrypoint::ProgramResult, system_program,
};
use anchor_lang::{AccountSerialize, InstructionData, ToAccountMetas};
use hosted_app_trust_root::{
    accounts as trust_accounts, instruction as trust_instructions,
    require_active_hosted_app_identity, require_active_release_commitment, require_nonzero_digest,
    AppTrustRootConfig, GovernanceExecutionProof, HostedAppCapabilityDenyCommitment,
    HostedAppCircleInstallationCommitment, HostedAppCredentialAnchorType,
    HostedAppCredentialDigestAnchor, HostedAppGovernanceExecutionRecord,
    HostedAppGovernanceReceiptTargetGuard, HostedAppIdentityRecord,
    HostedAppInstallationVisibility, HostedAppPolicyAnchorType, HostedAppPolicyDigestAnchor,
    HostedAppProductionStatus, HostedAppReleaseChannelCommitment, HostedAppReleaseCommitment,
    HostedAppReleaseKind, HostedAppSupportStatus, APP_TRUST_ROOT_CONFIG_SEED,
    HOSTED_APP_CAPABILITY_DENY_SEED, HOSTED_APP_CREDENTIAL_ANCHOR_SEED,
    HOSTED_APP_GOVERNANCE_EXECUTION_SEED, HOSTED_APP_GOVERNANCE_RECEIPT_TARGET_GUARD_SEED,
    HOSTED_APP_IDENTITY_SEED, HOSTED_APP_INSTALLATION_SEED, HOSTED_APP_POLICY_ANCHOR_SEED,
    HOSTED_APP_RELEASE_CHANNEL_SEED, HOSTED_APP_RELEASE_SEED, HOSTED_APP_TRUST_ROOT_VERSION,
    MISSING_ACCOUNT_STATE_DIGEST,
};
use solana_program_test::{processor, ProgramTest};
use solana_sdk::{
    account::Account,
    instruction::Instruction,
    signature::{Keypair, Signer},
    transaction::Transaction,
};

const NOW: i64 = 1_800_000_000;
const HASH_A: [u8; 32] = [7; 32];
const HASH_B: [u8; 32] = [8; 32];
const HASH_C: [u8; 32] = [9; 32];

#[test]
fn route_b_program_uses_hosted_app_only_seed_namespace() {
    let seeds = [
        APP_TRUST_ROOT_CONFIG_SEED,
        HOSTED_APP_IDENTITY_SEED,
        HOSTED_APP_RELEASE_SEED,
        HOSTED_APP_RELEASE_CHANNEL_SEED,
        HOSTED_APP_CAPABILITY_DENY_SEED,
        HOSTED_APP_CREDENTIAL_ANCHOR_SEED,
        HOSTED_APP_GOVERNANCE_EXECUTION_SEED,
        HOSTED_APP_GOVERNANCE_RECEIPT_TARGET_GUARD_SEED,
        HOSTED_APP_POLICY_ANCHOR_SEED,
        HOSTED_APP_INSTALLATION_SEED,
    ];

    for seed in seeds {
        let text = std::str::from_utf8(seed).expect("seed must be utf8");
        assert!(text.starts_with("hosted_app"));
        assert!(!text.contains("external_app"));
        assert!(seed.len() <= 32);
    }
}

#[test]
fn trust_root_config_has_explicit_storage_size() {
    assert!(AppTrustRootConfig::SPACE > 8);
}

#[test]
fn zero_digest_is_rejected() {
    assert!(require_nonzero_digest(&[0u8; 32]).is_err());
    assert!(require_nonzero_digest(&[7u8; 32]).is_ok());
}

#[test]
fn registers_hosted_app_identity_with_route_b_fields() {
    let owner = Pubkey::new_unique();
    let operator = Pubkey::new_unique();
    let mut record = HostedAppIdentityRecord::default();

    record
        .register(
            251, HASH_A, owner, operator, HASH_B, HASH_C, [10; 32], [11; 32], NOW,
        )
        .expect("identity registration should pass");

    assert_eq!(record.bump, 251);
    assert_eq!(record.app_id_hash, HASH_A);
    assert_eq!(record.owner, owner);
    assert_eq!(record.operator_authority, operator);
    assert_eq!(record.production_status, HostedAppProductionStatus::Active);
    assert_eq!(record.latest_release_digest, [0; 32]);
}

#[test]
fn anchors_production_release_commitment() {
    let developer = Pubkey::new_unique();
    let mut commitment = HostedAppReleaseCommitment::default();

    commitment
        .anchor(
            7,
            HASH_A,
            HASH_B,
            HASH_C,
            [12; 32],
            [13; 32],
            [14; 32],
            None,
            [15; 32],
            developer,
            [16; 32],
            HostedAppReleaseKind::Production,
            HostedAppSupportStatus::Active,
            [17; 32],
            NOW,
        )
        .expect("release anchoring should pass");

    assert_eq!(commitment.app_id_hash, HASH_A);
    assert_eq!(commitment.release_id_hash, HASH_B);
    assert_eq!(commitment.release_kind, HostedAppReleaseKind::Production);
    assert_eq!(commitment.support_status, HostedAppSupportStatus::Active);
    assert_eq!(commitment.developer_pubkey, developer);
}

#[test]
fn moves_stable_channel_with_previous_and_current_release_hashes() {
    let mut channel = HostedAppReleaseChannelCommitment::default();

    channel
        .move_channel(
            4,
            HASH_A,
            HASH_B,
            HASH_C,
            Some([18; 32]),
            [19; 32],
            [20; 32],
            Pubkey::new_unique(),
            NOW,
        )
        .expect("channel movement should pass");

    assert_eq!(channel.current_release_id_hash, HASH_C);
    assert_eq!(channel.previous_release_id_hash, Some([18; 32]));
}

#[test]
fn first_channel_move_can_omit_previous_release_hash() {
    let mut channel = HostedAppReleaseChannelCommitment::default();

    channel
        .move_channel(
            4,
            HASH_A,
            HASH_B,
            HASH_C,
            None,
            [19; 32],
            [20; 32],
            Pubkey::new_unique(),
            NOW,
        )
        .expect("initial channel movement should pass without a previous release");

    assert_eq!(channel.current_release_id_hash, HASH_C);
    assert_eq!(channel.previous_release_id_hash, None);

    assert!(channel
        .move_channel(
            4,
            HASH_A,
            HASH_B,
            [21; 32],
            None,
            [19; 32],
            [22; 32],
            Pubkey::new_unique(),
            NOW + 1,
        )
        .is_err());
    assert!(channel
        .move_channel(
            4,
            HASH_A,
            HASH_B,
            [21; 32],
            Some([99; 32]),
            [19; 32],
            [22; 32],
            Pubkey::new_unique(),
            NOW + 1,
        )
        .is_err());

    channel
        .move_channel(
            4,
            HASH_A,
            HASH_B,
            [21; 32],
            Some(HASH_C),
            [19; 32],
            [22; 32],
            Pubkey::new_unique(),
            NOW + 1,
        )
        .expect("subsequent channel movement must bind previous current release");
    assert_eq!(channel.current_release_id_hash, [21; 32]);
    assert_eq!(channel.previous_release_id_hash, Some(HASH_C));
}

#[test]
fn app_scoped_expansion_requires_active_identity_and_release() {
    let mut identity = HostedAppIdentityRecord::default();
    identity
        .register(
            1,
            HASH_A,
            Pubkey::new_unique(),
            Pubkey::new_unique(),
            HASH_B,
            HASH_C,
            [10; 32],
            [11; 32],
            NOW,
        )
        .expect("registration should pass");
    assert!(require_active_hosted_app_identity(&identity).is_ok());

    identity
        .set_status(HostedAppProductionStatus::Revoked, [21; 32], NOW + 1)
        .expect("revoke should pass");
    assert!(require_active_hosted_app_identity(&identity).is_err());

    let mut release = HostedAppReleaseCommitment::default();
    release
        .anchor(
            7,
            HASH_A,
            HASH_B,
            HASH_C,
            [12; 32],
            [13; 32],
            [14; 32],
            None,
            [15; 32],
            Pubkey::new_unique(),
            [16; 32],
            HostedAppReleaseKind::Production,
            HostedAppSupportStatus::Active,
            [17; 32],
            NOW,
        )
        .expect("release anchoring should pass");
    assert!(require_active_release_commitment(&release, HASH_A, HASH_B).is_ok());
    release.support_status = HostedAppSupportStatus::Revoked;
    assert!(require_active_release_commitment(&release, HASH_A, HASH_B).is_err());
}

#[test]
fn status_can_suspend_and_revoke_but_not_restore_from_revoked() {
    let mut identity = HostedAppIdentityRecord::default();
    identity
        .register(
            1,
            HASH_A,
            Pubkey::new_unique(),
            Pubkey::new_unique(),
            HASH_B,
            HASH_C,
            [10; 32],
            [11; 32],
            NOW,
        )
        .expect("registration should pass");

    identity
        .set_status(HostedAppProductionStatus::Suspended, [21; 32], NOW + 1)
        .expect("suspend should pass");
    identity
        .set_status(HostedAppProductionStatus::Revoked, [22; 32], NOW + 2)
        .expect("revoke should pass");

    assert!(identity
        .set_status(HostedAppProductionStatus::Active, [23; 32], NOW + 3)
        .is_err());
}

#[test]
fn anchors_deny_credential_policy_and_installation_digests() {
    let mut deny = HostedAppCapabilityDenyCommitment::default();
    deny.upsert(
        8,
        HASH_A,
        Some(HASH_B),
        HASH_C,
        [24; 32],
        [25; 32],
        [26; 32],
        NOW,
        Some(NOW + 60),
        [27; 32],
        NOW,
    )
    .expect("deny upsert should pass");
    assert_eq!(deny.capability_id_hash, HASH_C);

    let mut credential = HostedAppCredentialDigestAnchor::default();
    credential
        .anchor(
            9,
            HostedAppCredentialAnchorType::OfflineVerificationBundle,
            HASH_A,
            HASH_B,
            Some(HASH_C),
            Some([28; 32]),
            Some([29; 32]),
            Some(NOW + 60),
            NOW,
        )
        .expect("credential anchor should pass");
    assert_eq!(credential.digest, HASH_B);

    let mut policy = HostedAppPolicyDigestAnchor::default();
    policy
        .anchor(
            10,
            HostedAppPolicyAnchorType::ScopeAuthorityLifecycle,
            HASH_A,
            HASH_B,
            Some(HASH_C),
            Some([30; 32]),
            NOW,
            Some(NOW + 120),
            NOW,
        )
        .expect("policy anchor should pass");
    assert_eq!(policy.digest, HASH_B);

    let mut installation = HostedAppCircleInstallationCommitment::default();
    installation
        .anchor(
            11,
            HASH_A,
            HASH_B,
            Some(HASH_C),
            None,
            HASH_C,
            [32; 32],
            [33; 32],
            [34; 32],
            [37; 32],
            3,
            Some([35; 32]),
            [36; 32],
            HostedAppInstallationVisibility::PrivateDigest,
            NOW,
        )
        .expect("installation anchor should pass");
    assert_eq!(installation.policy_epoch, 3);

    assert!(installation
        .anchor(
            11,
            HASH_A,
            HASH_B,
            Some([31; 32]),
            None,
            HASH_C,
            [32; 32],
            [33; 32],
            [34; 32],
            [37; 32],
            3,
            Some([35; 32]),
            [36; 32],
            HostedAppInstallationVisibility::PrivateDigest,
            NOW,
        )
        .is_err());
    assert!(installation
        .anchor(
            11,
            HASH_A,
            HASH_B,
            Some(HASH_C),
            Some([38; 32]),
            HASH_C,
            [32; 32],
            [33; 32],
            [34; 32],
            [37; 32],
            3,
            Some([35; 32]),
            [36; 32],
            HostedAppInstallationVisibility::PrivateDigest,
            NOW,
        )
        .is_err());
}

#[test]
fn unsafe_governance_mutations_are_rejected() {
    let mut identity = HostedAppIdentityRecord::default();
    identity
        .register(
            1,
            HASH_A,
            Pubkey::new_unique(),
            Pubkey::new_unique(),
            HASH_B,
            HASH_C,
            [10; 32],
            [11; 32],
            NOW,
        )
        .expect("registration should pass");

    assert!(identity
        .set_status(HostedAppProductionStatus::Active, [0; 32], NOW + 1)
        .is_err());

    let mut execution = HostedAppGovernanceExecutionRecord::default();
    execution
        .consume(
            12,
            [38; 32],
            [39; 32],
            [40; 32],
            [41; 32],
            [42; 32],
            [43; 32],
            [44; 32],
            Pubkey::new_unique(),
            Some([45; 64]),
            NOW,
        )
        .expect("first governance execution consume should pass");
    assert!(execution
        .consume(
            12,
            [46; 32],
            [47; 32],
            [48; 32],
            [49; 32],
            [50; 32],
            [51; 32],
            [52; 32],
            Pubkey::new_unique(),
            None,
            NOW + 1,
        )
        .is_err());
}

#[test]
fn governance_receipt_target_guard_blocks_same_receipt_target_replay() {
    let execution_record = Pubkey::new_unique();
    let mut guard = HostedAppGovernanceReceiptTargetGuard::default();

    guard
        .consume(
            6,
            [46; 32],
            [47; 32],
            [48; 32],
            [49; 32],
            execution_record,
            NOW,
        )
        .expect("first receipt target consume should pass");
    assert_eq!(guard.receipt_digest, [46; 32]);
    assert_eq!(guard.execution_target_hash, [47; 32]);
    assert_eq!(guard.governance_execution_record, execution_record);

    assert!(guard
        .consume(
            6,
            [46; 32],
            [47; 32],
            [48; 32],
            [50; 32],
            Pubkey::new_unique(),
            NOW + 1,
        )
        .is_err());
}

#[test]
fn unsafe_anchor_inputs_are_rejected() {
    let mut release = HostedAppReleaseCommitment::default();
    assert!(release
        .anchor(
            7,
            HASH_A,
            HASH_B,
            HASH_C,
            [12; 32],
            [13; 32],
            [14; 32],
            None,
            [15; 32],
            Pubkey::new_unique(),
            [0; 32],
            HostedAppReleaseKind::Production,
            HostedAppSupportStatus::Active,
            [17; 32],
            NOW,
        )
        .is_err());

    let mut channel = HostedAppReleaseChannelCommitment::default();
    assert!(channel
        .move_channel(
            4,
            HASH_A,
            HASH_B,
            [0; 32],
            Some([18; 32]),
            [19; 32],
            [20; 32],
            Pubkey::new_unique(),
            NOW,
        )
        .is_err());
    assert!(channel
        .move_channel(
            4,
            HASH_A,
            HASH_B,
            HASH_C,
            None,
            [19; 32],
            [20; 32],
            Pubkey::new_unique(),
            NOW,
        )
        .is_ok());

    let mut credential = HostedAppCredentialDigestAnchor::default();
    assert!(credential
        .anchor(
            9,
            HostedAppCredentialAnchorType::RuntimeAttestation,
            HASH_A,
            HASH_B,
            None,
            Some([29; 32]),
            Some([30; 32]),
            Some(NOW + 60),
            NOW,
        )
        .is_err());
    assert!(credential
        .anchor(
            9,
            HostedAppCredentialAnchorType::OfflineVerificationBundle,
            HASH_A,
            HASH_B,
            None,
            Some([29; 32]),
            Some([30; 32]),
            Some(NOW + 60),
            NOW,
        )
        .is_err());
}

#[tokio::test]
async fn revoked_identity_rejects_anchor_release_instruction() {
    let program_id = hosted_app_trust_root::id();
    let mut program_test = ProgramTest::new(
        "hosted_app_trust_root",
        program_id,
        processor!(process_instruction),
    );
    let governance_authority = Keypair::new();
    let event_program = Pubkey::new_unique();
    let event_emitter = Pubkey::new_unique();
    let app_id_hash = HASH_A;
    let release_id_hash = HASH_B;
    let proof = governance_proof(51);

    program_test.add_account(
        governance_authority.pubkey(),
        system_account(20_000_000_000),
    );
    program_test.add_account(event_program, system_account(1_000_000_000));
    program_test.add_account(event_emitter, system_account(1_000_000_000));
    program_test.add_account(
        config_pda(&program_id).0,
        program_owned_account(
            &program_id,
            serialize_anchor_account(&config_record(
                &program_id,
                governance_authority.pubkey(),
                event_program,
                event_emitter,
            )),
        ),
    );
    program_test.add_account(
        identity_pda(&program_id, app_id_hash).0,
        program_owned_account(
            &program_id,
            serialize_anchor_account(&identity_record(
                &program_id,
                app_id_hash,
                HostedAppProductionStatus::Revoked,
            )),
        ),
    );

    let (banks_client, payer, recent_blockhash) = program_test.start().await;
    let ix = Instruction {
        program_id,
        accounts: trust_accounts::AnchorHostedAppRelease {
            app_trust_root_config: config_pda(&program_id).0,
            hosted_app_identity: identity_pda(&program_id, app_id_hash).0,
            release_commitment: release_pda(&program_id, app_id_hash, release_id_hash).0,
            governance_execution_record: governance_execution_pda(&program_id, &proof).0,
            governance_receipt_target_guard: receipt_target_guard_pda(&program_id, &proof).0,
            governance_authority: governance_authority.pubkey(),
            event_program,
            event_emitter,
            system_program: system_program::ID,
        }
        .to_account_metas(None),
        data: trust_instructions::AnchorHostedAppRelease {
            app_id_hash,
            release_id_hash,
            manifest_hash: HASH_C,
            bundle_hash: [12; 32],
            bundle_uri_hash: [13; 32],
            release_payload_digest: [14; 32],
            bundle_cid_hash: None,
            capability_set_digest: [15; 32],
            developer_pubkey: Pubkey::new_unique(),
            developer_signature_digest: [16; 32],
            release_kind: HostedAppReleaseKind::Production,
            support_status: HostedAppSupportStatus::Active,
            promotion_digest: [17; 32],
            proof,
        }
        .data(),
    };
    let tx = Transaction::new_signed_with_payer(
        &[ix],
        Some(&payer.pubkey()),
        &[&payer, &governance_authority],
        recent_blockhash,
    );

    assert!(banks_client.process_transaction(tx).await.is_err());
}

#[tokio::test]
async fn release_mismatch_rejects_installation_instruction() {
    let program_id = hosted_app_trust_root::id();
    let mut program_test = ProgramTest::new(
        "hosted_app_trust_root",
        program_id,
        processor!(process_instruction),
    );
    let governance_authority = Keypair::new();
    let event_program = Pubkey::new_unique();
    let event_emitter = Pubkey::new_unique();
    let app_id_hash = HASH_A;
    let current_release_id_hash = HASH_C;
    let circle_id_hash = HASH_B;
    let proof = governance_proof(61);

    program_test.add_account(
        governance_authority.pubkey(),
        system_account(20_000_000_000),
    );
    program_test.add_account(event_program, system_account(1_000_000_000));
    program_test.add_account(event_emitter, system_account(1_000_000_000));
    program_test.add_account(
        config_pda(&program_id).0,
        program_owned_account(
            &program_id,
            serialize_anchor_account(&config_record(
                &program_id,
                governance_authority.pubkey(),
                event_program,
                event_emitter,
            )),
        ),
    );
    program_test.add_account(
        identity_pda(&program_id, app_id_hash).0,
        program_owned_account(
            &program_id,
            serialize_anchor_account(&identity_record(
                &program_id,
                app_id_hash,
                HostedAppProductionStatus::Active,
            )),
        ),
    );
    program_test.add_account(
        release_pda(&program_id, app_id_hash, current_release_id_hash).0,
        program_owned_account(
            &program_id,
            serialize_anchor_account(&release_record(
                &program_id,
                app_id_hash,
                current_release_id_hash,
                HostedAppSupportStatus::Active,
            )),
        ),
    );

    let (banks_client, payer, recent_blockhash) = program_test.start().await;
    let ix = Instruction {
        program_id,
        accounts: trust_accounts::AnchorHostedAppCircleInstallationDigest {
            app_trust_root_config: config_pda(&program_id).0,
            hosted_app_identity: identity_pda(&program_id, app_id_hash).0,
            current_release_commitment: release_pda(
                &program_id,
                app_id_hash,
                current_release_id_hash,
            )
            .0,
            installation_commitment: installation_pda(&program_id, app_id_hash, circle_id_hash).0,
            governance_execution_record: governance_execution_pda(&program_id, &proof).0,
            governance_receipt_target_guard: receipt_target_guard_pda(&program_id, &proof).0,
            governance_authority: governance_authority.pubkey(),
            event_program,
            event_emitter,
            system_program: system_program::ID,
        }
        .to_account_metas(None),
        data: trust_instructions::AnchorHostedAppCircleInstallationDigest {
            app_id_hash,
            circle_id_hash,
            release_id_hash: Some([31; 32]),
            channel_id_hash: None,
            current_release_id_hash,
            manifest_hash: [32; 32],
            update_policy_hash: [33; 32],
            allowed_capabilities_digest: [34; 32],
            trust_state_hash: [35; 32],
            policy_epoch: 3,
            governance_receipt_digest: Some([36; 32]),
            installation_digest: [37; 32],
            visibility: HostedAppInstallationVisibility::PrivateDigest,
            proof,
        }
        .data(),
    };
    let tx = Transaction::new_signed_with_payer(
        &[ix],
        Some(&payer.pubkey()),
        &[&payer, &governance_authority],
        recent_blockhash,
    );

    assert!(banks_client.process_transaction(tx).await.is_err());
}

fn process_instruction<'a, 'b, 'c, 'd>(
    program_id: &'a Pubkey,
    accounts: &'b [AccountInfo<'c>],
    instruction_data: &'d [u8],
) -> ProgramResult {
    let unified_accounts: &'c [AccountInfo<'c>] = unsafe { std::mem::transmute(accounts) };
    hosted_app_trust_root::entry(program_id, unified_accounts, instruction_data)
}

fn serialize_anchor_account<T>(value: &T) -> Vec<u8>
where
    T: AccountSerialize,
{
    let mut data = Vec::new();
    value
        .try_serialize(&mut data)
        .expect("anchor account should serialize");
    data
}

fn program_owned_account(program_id: &Pubkey, data: Vec<u8>) -> Account {
    Account {
        lamports: 10_000_000_000,
        data,
        owner: *program_id,
        executable: false,
        rent_epoch: 0,
    }
}

fn system_account(lamports: u64) -> Account {
    Account {
        lamports,
        data: vec![],
        owner: system_program::ID,
        executable: false,
        rent_epoch: 0,
    }
}

fn config_record(
    program_id: &Pubkey,
    governance_authority: Pubkey,
    event_program: Pubkey,
    event_emitter: Pubkey,
) -> AppTrustRootConfig {
    AppTrustRootConfig {
        bump: config_pda(program_id).1,
        version: HOSTED_APP_TRUST_ROOT_VERSION,
        admin: Pubkey::new_unique(),
        governance_authority,
        emergency_authority: Pubkey::new_unique(),
        event_program,
        event_emitter,
        paused: false,
        total_apps: 1,
        created_at: NOW,
        updated_at: NOW,
    }
}

fn identity_record(
    program_id: &Pubkey,
    app_id_hash: [u8; 32],
    status: HostedAppProductionStatus,
) -> HostedAppIdentityRecord {
    let (identity, bump) = identity_pda(program_id, app_id_hash);
    let mut record = HostedAppIdentityRecord::default();
    record
        .register(
            bump,
            app_id_hash,
            Pubkey::new_unique(),
            Pubkey::new_unique(),
            [40; 32],
            [41; 32],
            [42; 32],
            [43; 32],
            NOW,
        )
        .expect("identity record should be valid");
    record.production_status = status;
    if status == HostedAppProductionStatus::Revoked {
        record.revoked_at = Some(NOW + 1);
    }
    assert_ne!(identity, Pubkey::default());
    record
}

fn release_record(
    program_id: &Pubkey,
    app_id_hash: [u8; 32],
    release_id_hash: [u8; 32],
    support_status: HostedAppSupportStatus,
) -> HostedAppReleaseCommitment {
    let (_, bump) = release_pda(program_id, app_id_hash, release_id_hash);
    let mut record = HostedAppReleaseCommitment::default();
    record
        .anchor(
            bump,
            app_id_hash,
            release_id_hash,
            [44; 32],
            [45; 32],
            [46; 32],
            [47; 32],
            None,
            [48; 32],
            Pubkey::new_unique(),
            [49; 32],
            HostedAppReleaseKind::Production,
            support_status,
            [50; 32],
            NOW,
        )
        .expect("release record should be valid");
    record
}

fn governance_proof(seed: u8) -> GovernanceExecutionProof {
    GovernanceExecutionProof {
        receipt_digest: [seed; 32],
        operation_id_hash: [seed + 1; 32],
        replay_domain_hash: [seed + 2; 32],
        execution_nonce_hash: [seed + 3; 32],
        execution_target_hash: [seed + 4; 32],
        state_precondition_digest: MISSING_ACCOUNT_STATE_DIGEST,
        state_after_digest: [seed + 5; 32],
        source_tx_signature: None,
    }
}

fn config_pda(program_id: &Pubkey) -> (Pubkey, u8) {
    Pubkey::find_program_address(&[APP_TRUST_ROOT_CONFIG_SEED], program_id)
}

fn identity_pda(program_id: &Pubkey, app_id_hash: [u8; 32]) -> (Pubkey, u8) {
    Pubkey::find_program_address(
        &[HOSTED_APP_IDENTITY_SEED, app_id_hash.as_ref()],
        program_id,
    )
}

fn release_pda(
    program_id: &Pubkey,
    app_id_hash: [u8; 32],
    release_id_hash: [u8; 32],
) -> (Pubkey, u8) {
    Pubkey::find_program_address(
        &[
            HOSTED_APP_RELEASE_SEED,
            app_id_hash.as_ref(),
            release_id_hash.as_ref(),
        ],
        program_id,
    )
}

fn installation_pda(
    program_id: &Pubkey,
    app_id_hash: [u8; 32],
    circle_id_hash: [u8; 32],
) -> (Pubkey, u8) {
    Pubkey::find_program_address(
        &[
            HOSTED_APP_INSTALLATION_SEED,
            app_id_hash.as_ref(),
            circle_id_hash.as_ref(),
        ],
        program_id,
    )
}

fn governance_execution_pda(program_id: &Pubkey, proof: &GovernanceExecutionProof) -> (Pubkey, u8) {
    Pubkey::find_program_address(
        &[
            HOSTED_APP_GOVERNANCE_EXECUTION_SEED,
            proof.replay_domain_hash.as_ref(),
            proof.execution_nonce_hash.as_ref(),
        ],
        program_id,
    )
}

fn receipt_target_guard_pda(program_id: &Pubkey, proof: &GovernanceExecutionProof) -> (Pubkey, u8) {
    Pubkey::find_program_address(
        &[
            HOSTED_APP_GOVERNANCE_RECEIPT_TARGET_GUARD_SEED,
            proof.receipt_digest.as_ref(),
            proof.execution_target_hash.as_ref(),
        ],
        program_id,
    )
}
