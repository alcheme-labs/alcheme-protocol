use anchor_lang::{AccountDeserialize, AccountSerialize, InstructionData, ToAccountMetas};
use anchor_lang::solana_program::{
    account_info::AccountInfo,
    entrypoint::ProgramResult,
    program_error::ProgramError,
    system_program,
    sysvar::instructions as instructions_sysvar,
};
use circle_manager::{
    accounts as circle_accounts,
    instruction as circle_instructions,
    Circle,
    CircleManager,
    DecisionEngine,
    Knowledge,
    KnowledgeBinding,
    KnowledgeGovernance,
    ProofAttestorRegistry,
};
use solana_program_test::{processor, BanksClientError, ProgramTest};
use solana_sdk::{
    account::Account,
    ed25519_instruction,
    hash::hashv,
    instruction::{Instruction, InstructionError},
    pubkey::Pubkey,
    signature::{Keypair, Signer},
    transaction::{Transaction, TransactionError},
};
use std::str::FromStr;

// AlchemeError runtime custom codes (Anchor adds +6000 offset).
const UNAUTHORIZED_ERROR_CODE: u32 = 12001;
const VALIDATION_FAILED_ERROR_CODE: u32 = 12300;
const EVENT_EMITTER_PROGRAM_ID: &str = "uhPvVgDANHaUzUq2rYEVXJ9vGEBjWjNZ1E6gQJqdBUC";
const EVENT_EMITTER_SEQUENCE_OFFSET: usize = 8 + 1 + 32 + 8;
const EVENT_EMITTER_MIN_DATA_SIZE: usize = EVENT_EMITTER_SEQUENCE_OFFSET + 8;

#[tokio::test]
async fn initialize_proof_attestor_registry_rejects_non_circle_manager_admin() {
    let program_id = circle_manager::id();
    let mut program_test = ProgramTest::new(
        "circle_manager",
        program_id,
        processor!(process_instruction),
    );

    let circle_manager_admin = Keypair::new();
    let attacker = Keypair::new();
    program_test.add_account(circle_manager_admin.pubkey(), system_account(20_000_000_000));
    program_test.add_account(attacker.pubkey(), system_account(20_000_000_000));

    let (circle_manager_pda, circle_manager_bump) =
        Pubkey::find_program_address(&[b"circle_manager"], &program_id);
    program_test.add_account(
        circle_manager_pda,
        program_owned_account(serialize_anchor_account(&CircleManager {
            bump: circle_manager_bump,
            admin: circle_manager_admin.pubkey(),
            created_at: 0,
            total_circles: 0,
            total_knowledge: 0,
            total_transfers: 0,
        })),
    );

    let (registry_pda, _) = Pubkey::find_program_address(&[b"proof_attestor_registry"], &program_id);
    let context = program_test.start_with_context().await;
    let instruction = Instruction {
        program_id,
        accounts: circle_accounts::InitializeProofAttestorRegistry {
            proof_attestor_registry: registry_pda,
            circle_manager: circle_manager_pda,
            admin: attacker.pubkey(),
            system_program: system_program::ID,
        }
        .to_account_metas(None),
        data: circle_instructions::InitializeProofAttestorRegistry {}.data(),
    };

    let tx = Transaction::new_signed_with_payer(
        &[instruction],
        Some(&context.payer.pubkey()),
        &[&context.payer, &attacker],
        context.last_blockhash,
    );

    let error = context
        .banks_client
        .process_transaction(tx)
        .await
        .expect_err("registry init should reject attacker that is not circle_manager.admin");
    assert_custom_code(error, UNAUTHORIZED_ERROR_CODE);
}

#[tokio::test]
async fn bind_and_update_rejects_unregistered_attestor() {
    let program_id = circle_manager::id();
    let mut program_test = ProgramTest::new(
        "circle_manager",
        program_id,
        processor!(process_instruction),
    );

    let authority = Keypair::new();
    let proof_attestor = Keypair::new();
    let event_program = Keypair::new();
    let event_emitter = Keypair::new();
    let event_batch = Keypair::new();

    program_test.add_account(authority.pubkey(), system_account(20_000_000_000));
    program_test.add_account(proof_attestor.pubkey(), system_account(20_000_000_000));
    program_test.add_account(event_program.pubkey(), system_account(1_000_000_000));
    program_test.add_account(event_emitter.pubkey(), system_account(1_000_000_000));
    program_test.add_account(event_batch.pubkey(), system_account(1_000_000_000));

    let circle_id = 7u8;
    let (circle_pda, circle_bump) =
        Pubkey::find_program_address(&[b"circle", &[circle_id]], &program_id);
    program_test.add_account(
        circle_pda,
        program_owned_account(serialize_anchor_account(&Circle {
            circle_id,
            name: "binding-circle".to_string(),
            level: 1,
            parent_circle: None,
            child_circles: vec![],
            curators: vec![authority.pubkey()],
            knowledge_count: 1,
            knowledge_governance: default_governance(),
            decision_engine: DecisionEngine::AdminOnly {
                admin: authority.pubkey(),
            },
            created_at: 0,
            bump: circle_bump,
            flags: 0,
        })),
    );

    let (knowledge_pda, knowledge_bump) = Pubkey::find_program_address(
        &[b"knowledge", circle_pda.as_ref(), &0u64.to_le_bytes()],
        &program_id,
    );
    program_test.add_account(
        knowledge_pda,
        program_owned_account(serialize_anchor_account(&Knowledge {
            knowledge_id: [0x41; 32],
            circle_id,
            ipfs_cid: "bafybeibinding".to_string(),
            content_hash: [0x12; 32],
            title: "binding knowledge".to_string(),
            description: "binding knowledge description".to_string(),
            author: authority.pubkey(),
            quality_score: 1.0,
            source_circle: None,
            created_at: 0,
            view_count: 0,
            citation_count: 0,
            bump: knowledge_bump,
            flags: 1,
            contributors_root: [0; 32],
            contributors_count: 0,
        })),
    );

    let (registry_pda, registry_bump) =
        Pubkey::find_program_address(&[b"proof_attestor_registry"], &program_id);
    program_test.add_account(
        registry_pda,
        program_owned_account(serialize_anchor_account(&ProofAttestorRegistry {
            bump: registry_bump,
            admin: authority.pubkey(),
            attestors: vec![],
            created_at: 0,
            last_updated: 0,
        })),
    );

    let (knowledge_binding_pda, _) =
        Pubkey::find_program_address(&[b"knowledge_binding", knowledge_pda.as_ref()], &program_id);

    let context = program_test.start_with_context().await;
    let instruction = Instruction {
        program_id,
        accounts: circle_accounts::BindAndUpdateContributors {
            knowledge: knowledge_pda,
            circle: circle_pda,
            knowledge_binding: knowledge_binding_pda,
            proof_attestor_registry: registry_pda,
            authority: authority.pubkey(),
            instructions_sysvar: instructions_sysvar::ID,
            event_program: event_program.pubkey(),
            event_emitter: event_emitter.pubkey(),
            event_batch: event_batch.pubkey(),
            system_program: system_program::ID,
        }
        .to_account_metas(None),
        data: circle_instructions::BindAndUpdateContributors {
            source_anchor_id: [0x10; 32],
            proof_package_hash: [0x20; 32],
            contributors_root: [0x30; 32],
            contributors_count: 2,
            binding_version: 1,
            generated_at: 1_762_366_800,
            issuer_key_id: proof_attestor.pubkey(),
            issued_signature: [0x40; 64],
        }
        .data(),
    };

    let tx = Transaction::new_signed_with_payer(
        &[instruction],
        Some(&context.payer.pubkey()),
        &[&context.payer, &authority],
        context.last_blockhash,
    );

    let error = context
        .banks_client
        .process_transaction(tx)
        .await
        .expect_err("bind_and_update should reject unregistered attestor");
    assert_custom_code(error, UNAUTHORIZED_ERROR_CODE);
}

#[tokio::test]
async fn bind_and_update_succeeds_with_registered_attestor_and_valid_signature() {
    let program_id = circle_manager::id();
    let event_program = Pubkey::from_str(EVENT_EMITTER_PROGRAM_ID)
        .expect("event emitter program id should be valid");
    let mut program_test = ProgramTest::new(
        "circle_manager",
        program_id,
        processor!(process_instruction),
    );
    program_test.add_program(
        "mock_event_emitter",
        event_program,
        processor!(process_mock_event_emitter_instruction),
    );

    let authority = Keypair::new();
    let proof_attestor = Keypair::new();
    let event_emitter = Keypair::new();
    let event_batch = Keypair::new();

    program_test.add_account(authority.pubkey(), system_account(20_000_000_000));
    program_test.add_account(proof_attestor.pubkey(), system_account(20_000_000_000));
    program_test.add_account(
        event_emitter.pubkey(),
        mock_event_emitter_account(event_program, 0),
    );
    program_test.add_account(
        event_batch.pubkey(),
        Account {
            lamports: 1_000_000_000,
            data: vec![0; 16],
            owner: event_program,
            executable: false,
            rent_epoch: 0,
        },
    );

    let circle_id = 10u8;
    let (circle_pda, circle_bump) =
        Pubkey::find_program_address(&[b"circle", &[circle_id]], &program_id);
    program_test.add_account(
        circle_pda,
        program_owned_account(serialize_anchor_account(&Circle {
            circle_id,
            name: "bind-update-success".to_string(),
            level: 1,
            parent_circle: None,
            child_circles: vec![],
            curators: vec![authority.pubkey()],
            knowledge_count: 1,
            knowledge_governance: default_governance(),
            decision_engine: DecisionEngine::AdminOnly {
                admin: authority.pubkey(),
            },
            created_at: 0,
            bump: circle_bump,
            flags: 0,
        })),
    );

    let (knowledge_pda, knowledge_bump) = Pubkey::find_program_address(
        &[b"knowledge", circle_pda.as_ref(), &0u64.to_le_bytes()],
        &program_id,
    );
    program_test.add_account(
        knowledge_pda,
        program_owned_account(serialize_anchor_account(&Knowledge {
            knowledge_id: [0x41; 32],
            circle_id,
            ipfs_cid: "bafybeibindupdatesuccess".to_string(),
            content_hash: [0x21; 32],
            title: "bind and update success".to_string(),
            description: "should bind and update contributors atomically".to_string(),
            author: authority.pubkey(),
            quality_score: 1.0,
            source_circle: None,
            created_at: 0,
            view_count: 0,
            citation_count: 0,
            bump: knowledge_bump,
            flags: 1, // version=1 before update
            contributors_root: [0; 32],
            contributors_count: 0,
        })),
    );

    let (registry_pda, registry_bump) =
        Pubkey::find_program_address(&[b"proof_attestor_registry"], &program_id);
    program_test.add_account(
        registry_pda,
        program_owned_account(serialize_anchor_account(&ProofAttestorRegistry {
            bump: registry_bump,
            admin: authority.pubkey(),
            attestors: vec![proof_attestor.pubkey()],
            created_at: 0,
            last_updated: 0,
        })),
    );

    let (knowledge_binding_pda, _) =
        Pubkey::find_program_address(&[b"knowledge_binding", knowledge_pda.as_ref()], &program_id);
    let source_anchor_id = [0x11; 32];
    let proof_package_hash = [0x22; 32];
    let contributors_root = [0x33; 32];
    let contributors_count = 5;
    let binding_version = 1;
    let generated_at = 1_762_366_800;
    let digest = build_binding_signature_digest(
        source_anchor_id,
        proof_package_hash,
        contributors_root,
        contributors_count,
        binding_version,
        generated_at,
    );
    let signed = *proof_attestor.sign_message(&digest).as_array();
    let verify_ix = ed25519_instruction::new_ed25519_instruction_with_signature(
        &digest,
        &signed,
        &proof_attestor.pubkey().to_bytes(),
    );

    let context = program_test.start_with_context().await;
    let instruction = Instruction {
        program_id,
        accounts: circle_accounts::BindAndUpdateContributors {
            knowledge: knowledge_pda,
            circle: circle_pda,
            knowledge_binding: knowledge_binding_pda,
            proof_attestor_registry: registry_pda,
            authority: authority.pubkey(),
            instructions_sysvar: instructions_sysvar::ID,
            event_program,
            event_emitter: event_emitter.pubkey(),
            event_batch: event_batch.pubkey(),
            system_program: system_program::ID,
        }
        .to_account_metas(None),
        data: circle_instructions::BindAndUpdateContributors {
            source_anchor_id,
            proof_package_hash,
            contributors_root,
            contributors_count,
            binding_version,
            generated_at,
            issuer_key_id: proof_attestor.pubkey(),
            issued_signature: signed,
        }
        .data(),
    };

    let tx = Transaction::new_signed_with_payer(
        &[verify_ix, instruction],
        Some(&context.payer.pubkey()),
        &[&context.payer, &authority],
        context.last_blockhash,
    );
    context
        .banks_client
        .process_transaction(tx)
        .await
        .expect("bind_and_update should succeed with valid attestor/signature");

    let knowledge_account = context
        .banks_client
        .get_account(knowledge_pda)
        .await
        .expect("knowledge account fetch should succeed")
        .expect("knowledge account should exist");
    let knowledge = deserialize_anchor_account::<Knowledge>(&knowledge_account.data);
    assert_eq!(knowledge.contributors_root, contributors_root);
    assert_eq!(knowledge.contributors_count, contributors_count);
    assert_eq!(knowledge.version(), 2, "version should bump once after update");

    let binding_account = context
        .banks_client
        .get_account(knowledge_binding_pda)
        .await
        .expect("knowledge binding account fetch should succeed")
        .expect("knowledge binding account should exist");
    let binding = deserialize_anchor_account::<KnowledgeBinding>(&binding_account.data);
    assert_eq!(binding.knowledge, knowledge_pda);
    assert_eq!(
        knowledge.knowledge_id,
        [0x41; 32],
        "knowledge account must continue exposing the frozen knowledge_id field",
    );
    assert_eq!(binding.source_anchor_id, source_anchor_id);
    assert_eq!(binding.proof_package_hash, proof_package_hash);
    assert_eq!(binding.contributors_root, contributors_root);
    assert_eq!(binding.contributors_count, contributors_count);
    assert_eq!(binding.binding_version, binding_version);
    assert_eq!(binding.generated_at, generated_at);
    assert_eq!(binding.bound_by, authority.pubkey());
    assert_eq!(
        binding.source_anchor_id,
        source_anchor_id,
        "source_anchor_id is the on-chain provenance path equivalent for the bound draft source",
    );
}

#[tokio::test]
async fn bind_and_update_rejects_signature_digest_mismatch() {
    let program_id = circle_manager::id();
    let mut program_test = ProgramTest::new(
        "circle_manager",
        program_id,
        processor!(process_instruction),
    );

    let authority = Keypair::new();
    let proof_attestor = Keypair::new();
    let event_program = Keypair::new();
    let event_emitter = Keypair::new();
    let event_batch = Keypair::new();

    program_test.add_account(authority.pubkey(), system_account(20_000_000_000));
    program_test.add_account(proof_attestor.pubkey(), system_account(20_000_000_000));
    program_test.add_account(event_program.pubkey(), system_account(1_000_000_000));
    program_test.add_account(event_emitter.pubkey(), system_account(1_000_000_000));
    program_test.add_account(event_batch.pubkey(), system_account(1_000_000_000));

    let circle_id = 8u8;
    let (circle_pda, circle_bump) =
        Pubkey::find_program_address(&[b"circle", &[circle_id]], &program_id);
    program_test.add_account(
        circle_pda,
        program_owned_account(serialize_anchor_account(&Circle {
            circle_id,
            name: "sig-circle".to_string(),
            level: 1,
            parent_circle: None,
            child_circles: vec![],
            curators: vec![authority.pubkey()],
            knowledge_count: 1,
            knowledge_governance: default_governance(),
            decision_engine: DecisionEngine::AdminOnly {
                admin: authority.pubkey(),
            },
            created_at: 0,
            bump: circle_bump,
            flags: 0,
        })),
    );

    let (knowledge_pda, knowledge_bump) = Pubkey::find_program_address(
        &[b"knowledge", circle_pda.as_ref(), &0u64.to_le_bytes()],
        &program_id,
    );
    program_test.add_account(
        knowledge_pda,
        program_owned_account(serialize_anchor_account(&Knowledge {
            knowledge_id: [0x51; 32],
            circle_id,
            ipfs_cid: "bafybeisigmismatch".to_string(),
            content_hash: [0x13; 32],
            title: "sig mismatch".to_string(),
            description: "should reject signature mismatch".to_string(),
            author: authority.pubkey(),
            quality_score: 1.0,
            source_circle: None,
            created_at: 0,
            view_count: 0,
            citation_count: 0,
            bump: knowledge_bump,
            flags: 1,
            contributors_root: [0; 32],
            contributors_count: 0,
        })),
    );

    let (registry_pda, registry_bump) =
        Pubkey::find_program_address(&[b"proof_attestor_registry"], &program_id);
    program_test.add_account(
        registry_pda,
        program_owned_account(serialize_anchor_account(&ProofAttestorRegistry {
            bump: registry_bump,
            admin: authority.pubkey(),
            attestors: vec![proof_attestor.pubkey()],
            created_at: 0,
            last_updated: 0,
        })),
    );

    let (knowledge_binding_pda, _) =
        Pubkey::find_program_address(&[b"knowledge_binding", knowledge_pda.as_ref()], &program_id);
    let source_anchor_id = [0x14; 32];
    let proof_package_hash = [0x24; 32];
    let contributors_root = [0x34; 32];
    let contributors_count = 3;
    let binding_version = 1;
    let generated_at = 1_762_366_800;
    let digest = build_binding_signature_digest(
        source_anchor_id,
        proof_package_hash,
        contributors_root,
        contributors_count,
        binding_version,
        generated_at,
    );
    let signed = *proof_attestor.sign_message(&digest).as_array();
    let verify_ix = ed25519_instruction::new_ed25519_instruction_with_signature(
        &digest,
        &signed,
        &proof_attestor.pubkey().to_bytes(),
    );

    let context = program_test.start_with_context().await;
    let instruction = Instruction {
        program_id,
        accounts: circle_accounts::BindAndUpdateContributors {
            knowledge: knowledge_pda,
            circle: circle_pda,
            knowledge_binding: knowledge_binding_pda,
            proof_attestor_registry: registry_pda,
            authority: authority.pubkey(),
            instructions_sysvar: instructions_sysvar::ID,
            event_program: event_program.pubkey(),
            event_emitter: event_emitter.pubkey(),
            event_batch: event_batch.pubkey(),
            system_program: system_program::ID,
        }
        .to_account_metas(None),
        data: circle_instructions::BindAndUpdateContributors {
            source_anchor_id,
            proof_package_hash,
            contributors_root,
            contributors_count,
            binding_version,
            generated_at,
            issuer_key_id: proof_attestor.pubkey(),
            issued_signature: [0x99; 64], // intentionally wrong signature bytes
        }
        .data(),
    };

    let tx = Transaction::new_signed_with_payer(
        &[verify_ix, instruction],
        Some(&context.payer.pubkey()),
        &[&context.payer, &authority],
        context.last_blockhash,
    );

    let error = context
        .banks_client
        .process_transaction(tx)
        .await
        .expect_err("bind_and_update should reject signature digest mismatch");
    assert_custom_code(error, VALIDATION_FAILED_ERROR_CODE);
}

#[tokio::test]
async fn update_contributors_rejects_authority_when_not_bound_by() {
    let program_id = circle_manager::id();
    let mut program_test = ProgramTest::new(
        "circle_manager",
        program_id,
        processor!(process_instruction),
    );

    let authority = Keypair::new();
    let bound_by = Pubkey::new_unique();
    let event_program = Keypair::new();
    let event_emitter = Keypair::new();
    let event_batch = Keypair::new();

    program_test.add_account(authority.pubkey(), system_account(20_000_000_000));
    program_test.add_account(event_program.pubkey(), system_account(1_000_000_000));
    program_test.add_account(event_emitter.pubkey(), system_account(1_000_000_000));
    program_test.add_account(event_batch.pubkey(), system_account(1_000_000_000));

    let circle_id = 9u8;
    let (circle_pda, circle_bump) =
        Pubkey::find_program_address(&[b"circle", &[circle_id]], &program_id);
    program_test.add_account(
        circle_pda,
        program_owned_account(serialize_anchor_account(&Circle {
            circle_id,
            name: "bound-by-circle".to_string(),
            level: 1,
            parent_circle: None,
            child_circles: vec![],
            curators: vec![authority.pubkey()],
            knowledge_count: 1,
            knowledge_governance: default_governance(),
            decision_engine: DecisionEngine::AdminOnly {
                admin: authority.pubkey(),
            },
            created_at: 0,
            bump: circle_bump,
            flags: 0,
        })),
    );

    let (knowledge_pda, knowledge_bump) = Pubkey::find_program_address(
        &[b"knowledge", circle_pda.as_ref(), &0u64.to_le_bytes()],
        &program_id,
    );
    program_test.add_account(
        knowledge_pda,
        program_owned_account(serialize_anchor_account(&Knowledge {
            knowledge_id: [0x61; 32],
            circle_id,
            ipfs_cid: "bafybeiboundby".to_string(),
            content_hash: [0x21; 32],
            title: "bound by mismatch".to_string(),
            description: "authority should equal bound_by".to_string(),
            author: authority.pubkey(),
            quality_score: 1.0,
            source_circle: None,
            created_at: 0,
            view_count: 0,
            citation_count: 0,
            bump: knowledge_bump,
            flags: 1,
            contributors_root: [0; 32],
            contributors_count: 0,
        })),
    );

    let (knowledge_binding_pda, binding_bump) =
        Pubkey::find_program_address(&[b"knowledge_binding", knowledge_pda.as_ref()], &program_id);
    let proof_package_hash = [0x72; 32];
    let contributors_root = [0x73; 32];
    program_test.add_account(
        knowledge_binding_pda,
        program_owned_account(serialize_anchor_account(&KnowledgeBinding {
            knowledge: knowledge_pda,
            source_anchor_id: [0x71; 32],
            proof_package_hash,
            contributors_root,
            contributors_count: 4,
            binding_version: 1,
            generated_at: 1_762_366_800,
            bound_at: 1_762_366_900,
            bound_by,
            bump: binding_bump,
        })),
    );

    let context = program_test.start_with_context().await;
    let instruction = Instruction {
        program_id,
        accounts: circle_accounts::UpdateContributors {
            knowledge: knowledge_pda,
            circle: circle_pda,
            knowledge_binding: knowledge_binding_pda,
            authority: authority.pubkey(),
            event_program: event_program.pubkey(),
            event_emitter: event_emitter.pubkey(),
            event_batch: event_batch.pubkey(),
            system_program: system_program::ID,
        }
        .to_account_metas(None),
        data: circle_instructions::UpdateContributors {
            proof_package_hash,
            contributors_root,
            contributors_count: 4,
        }
        .data(),
    };

    let tx = Transaction::new_signed_with_payer(
        &[instruction],
        Some(&context.payer.pubkey()),
        &[&context.payer, &authority],
        context.last_blockhash,
    );

    let error = context
        .banks_client
        .process_transaction(tx)
        .await
        .expect_err("update_contributors should reject non bound_by authority");
    assert_custom_code(error, UNAUTHORIZED_ERROR_CODE);
}

fn assert_custom_code(error: BanksClientError, expected_code: u32) {
    match error {
        BanksClientError::TransactionError(TransactionError::InstructionError(
            _,
            InstructionError::Custom(code),
        )) => {
            assert_eq!(code, expected_code, "expected custom code {expected_code}, got {code}");
        }
        other => panic!("expected custom error code {expected_code}, got {other:?}"),
    }
}

fn build_binding_signature_digest(
    source_anchor_id: [u8; 32],
    proof_package_hash: [u8; 32],
    contributors_root: [u8; 32],
    contributors_count: u16,
    binding_version: u16,
    generated_at: i64,
) -> [u8; 32] {
    hashv(&[
        b"alcheme:proof_binding:v1",
        &proof_package_hash,
        &contributors_root,
        &contributors_count.to_le_bytes(),
        &source_anchor_id,
        &binding_version.to_le_bytes(),
        &generated_at.to_le_bytes(),
    ])
    .to_bytes()
}

fn process_instruction<'a, 'b, 'c, 'd>(
    program_id: &'a Pubkey,
    accounts: &'b [AccountInfo<'c>],
    instruction_data: &'d [u8],
) -> ProgramResult {
    let unified_accounts: &'c [AccountInfo<'c>] = unsafe { std::mem::transmute(accounts) };
    circle_manager::entry(program_id, unified_accounts, instruction_data)
}

fn process_mock_event_emitter_instruction<'a, 'b, 'c, 'd>(
    _program_id: &'a Pubkey,
    accounts: &'b [AccountInfo<'c>],
    _instruction_data: &'d [u8],
) -> ProgramResult {
    let event_emitter = accounts
        .first()
        .ok_or(ProgramError::NotEnoughAccountKeys)?;
    let mut data = event_emitter.try_borrow_mut_data()?;
    if data.len() < EVENT_EMITTER_MIN_DATA_SIZE {
        return Err(ProgramError::InvalidAccountData);
    }
    let mut sequence_bytes = [0u8; 8];
    sequence_bytes.copy_from_slice(
        &data[EVENT_EMITTER_SEQUENCE_OFFSET..EVENT_EMITTER_SEQUENCE_OFFSET + 8],
    );
    let next_sequence = u64::from_le_bytes(sequence_bytes).saturating_add(1);
    data[EVENT_EMITTER_SEQUENCE_OFFSET..EVENT_EMITTER_SEQUENCE_OFFSET + 8]
        .copy_from_slice(&next_sequence.to_le_bytes());
    Ok(())
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

fn deserialize_anchor_account<T>(data: &[u8]) -> T
where
    T: AccountDeserialize,
{
    let mut slice: &[u8] = data;
    T::try_deserialize(&mut slice).expect("anchor account should deserialize")
}

fn program_owned_account(data: Vec<u8>) -> Account {
    Account {
        lamports: 10_000_000_000,
        data,
        owner: circle_manager::id(),
        executable: false,
        rent_epoch: 0,
    }
}

fn mock_event_emitter_account(owner: Pubkey, event_sequence: u64) -> Account {
    let mut data = vec![0u8; EVENT_EMITTER_MIN_DATA_SIZE];
    data[EVENT_EMITTER_SEQUENCE_OFFSET..EVENT_EMITTER_SEQUENCE_OFFSET + 8]
        .copy_from_slice(&event_sequence.to_le_bytes());
    Account {
        lamports: 1_000_000_000,
        data,
        owner,
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

fn default_governance() -> KnowledgeGovernance {
    KnowledgeGovernance {
        min_quality_score: 0.0,
        min_curator_reputation: 0,
        transfer_cooldown: 0,
        max_transfers_per_day: 1000,
        require_peer_review: false,
        peer_review_count: 0,
        auto_quality_check: false,
    }
}
