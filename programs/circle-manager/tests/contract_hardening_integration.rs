use alcheme_cpi::{AuthorizedCaller, CpiPermission, ExtensionRegistry};
use alcheme_shared::CircleLifecycleStatus;
use anchor_lang::solana_program::{
    account_info::AccountInfo, entrypoint::ProgramResult, system_program,
};
use anchor_lang::{AccountSerialize, AnchorSerialize, InstructionData, ToAccountMetas};
use circle_manager::{
    accounts as circle_accounts, instruction as circle_instructions, Circle, CircleManager,
    DecisionEngine, Knowledge, KnowledgeBinding, KnowledgeGovernance,
};
use solana_program_test::{processor, BanksClientError, ProgramTest};
use solana_sdk::{
    account::Account,
    instruction::{Instruction, InstructionError},
    pubkey::Pubkey,
    signature::{Keypair, Signer},
    transaction::{Transaction, TransactionError},
};
use std::str::FromStr;

// AlchemeError::InvalidOperation is declared as 6000, and Anchor applies its
// custom-error offset at runtime, surfacing it as 12000.
const INVALID_OPERATION_ERROR_CODE: u32 = 12000;
const CIRCLE_ARCHIVED_ERROR_CODE: u32 = 12014;

#[test]
fn knowledge_binding_state_carries_the_frozen_minimum_anchor_contract() {
    let knowledge = Pubkey::new_unique();
    let authority = Pubkey::new_unique();
    let binding = KnowledgeBinding {
        knowledge,
        source_anchor_id: [0x11; 32],
        proof_package_hash: [0x22; 32],
        contributors_root: [0x33; 32],
        contributors_count: 4,
        binding_version: 2,
        generated_at: 1_762_366_800,
        bound_at: 1_762_366_900,
        bound_by: authority,
        bump: 9,
    };

    assert_eq!(binding.knowledge, knowledge);
    assert_eq!(
        binding.source_anchor_id, [0x11; 32],
        "source_anchor_id remains the on-chain provenance path equivalent",
    );
    assert_eq!(binding.proof_package_hash, [0x22; 32]);
    assert_eq!(binding.contributors_root, [0x33; 32]);
    assert_eq!(binding.contributors_count, 4);
    assert_eq!(binding.binding_version, 2);
    assert_eq!(binding.generated_at, 1_762_366_800);
    assert_eq!(binding.bound_at, 1_762_366_900);
    assert_eq!(binding.bound_by, authority);
    assert_eq!(binding.bump, 9);
}

#[tokio::test]
async fn submit_knowledge_rejects_non_curator_author() {
    let program_id = circle_manager::id();
    let mut program_test = ProgramTest::new(
        "circle_manager",
        program_id,
        processor!(process_instruction),
    );

    let author = Keypair::new();
    let event_program = Keypair::new();
    let event_emitter = Keypair::new();
    let event_batch = Keypair::new();

    program_test.add_account(author.pubkey(), system_account(10_000_000_000));
    program_test.add_account(event_program.pubkey(), system_account(1_000_000_000));
    program_test.add_account(event_emitter.pubkey(), system_account(1_000_000_000));
    program_test.add_account(event_batch.pubkey(), system_account(1_000_000_000));

    let (circle_manager_pda, manager_bump) =
        Pubkey::find_program_address(&[b"circle_manager"], &program_id);
    let circle_manager = CircleManager {
        bump: manager_bump,
        admin: Pubkey::new_unique(),
        created_at: 0,
        total_circles: 1,
        total_knowledge: 0,
        total_transfers: 0,
    };
    program_test.add_account(
        circle_manager_pda,
        program_owned_account(serialize_anchor_account(&circle_manager)),
    );

    let circle_id = 7u8;
    let (circle_pda, circle_bump) =
        Pubkey::find_program_address(&[b"circle", &[circle_id]], &program_id);
    let curator = Pubkey::new_unique();
    let circle = Circle {
        circle_id,
        name: "circle-seven".to_string(),
        level: 1,
        parent_circle: None,
        child_circles: vec![],
        curators: vec![curator],
        knowledge_count: 0,
        knowledge_governance: default_governance(),
        decision_engine: DecisionEngine::AdminOnly { admin: curator },
        created_at: 0,
        bump: circle_bump,
        flags: 0,
        status: CircleLifecycleStatus::Active,
    };
    program_test.add_account(
        circle_pda,
        program_owned_account(serialize_anchor_account(&circle)),
    );

    let (knowledge_pda, _) = Pubkey::find_program_address(
        &[b"knowledge", circle_pda.as_ref(), &0u64.to_le_bytes()],
        &program_id,
    );

    let context = program_test.start_with_context().await;
    let instruction = Instruction {
        program_id,
        accounts: circle_accounts::SubmitKnowledge {
            knowledge: knowledge_pda,
            circle: circle_pda,
            circle_manager: circle_manager_pda,
            author: author.pubkey(),
            event_program: event_program.pubkey(),
            event_emitter: event_emitter.pubkey(),
            event_batch: event_batch.pubkey(),
            system_program: system_program::ID,
        }
        .to_account_metas(None),
        data: circle_instructions::SubmitKnowledge {
            ipfs_cid: "bafybeigdyrztx6f6n4z5vqg2x".to_string(),
            content_hash: [0x11; 32],
            title: "Curator-only test".to_string(),
            description: "should fail for non curator".to_string(),
        }
        .data(),
    };

    let tx = Transaction::new_signed_with_payer(
        &[instruction],
        Some(&context.payer.pubkey()),
        &[&context.payer, &author],
        context.last_blockhash,
    );

    let error = context
        .banks_client
        .process_transaction(tx)
        .await
        .expect_err("submit_knowledge should reject non-curator author");
    assert_invalid_operation(error);
}

#[tokio::test]
async fn update_contributors_rejects_cross_circle_knowledge_mutation() {
    let program_id = circle_manager::id();
    let mut program_test = ProgramTest::new(
        "circle_manager",
        program_id,
        processor!(process_instruction),
    );

    let authority = Keypair::new();
    let event_program = Keypair::new();
    let event_emitter = Keypair::new();
    let event_batch = Keypair::new();

    program_test.add_account(authority.pubkey(), system_account(10_000_000_000));
    program_test.add_account(event_program.pubkey(), system_account(1_000_000_000));
    program_test.add_account(event_emitter.pubkey(), system_account(1_000_000_000));
    program_test.add_account(event_batch.pubkey(), system_account(1_000_000_000));

    let circle_one_id = 1u8;
    let circle_two_id = 2u8;
    let (circle_one_pda, circle_one_bump) =
        Pubkey::find_program_address(&[b"circle", &[circle_one_id]], &program_id);
    let (circle_two_pda, circle_two_bump) =
        Pubkey::find_program_address(&[b"circle", &[circle_two_id]], &program_id);

    let circle_one = Circle {
        circle_id: circle_one_id,
        name: "circle-one".to_string(),
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
        bump: circle_one_bump,
        flags: 0,
        status: CircleLifecycleStatus::Active,
    };
    program_test.add_account(
        circle_one_pda,
        program_owned_account(serialize_anchor_account(&circle_one)),
    );

    let circle_two = Circle {
        circle_id: circle_two_id,
        name: "circle-two".to_string(),
        level: 1,
        parent_circle: None,
        child_circles: vec![],
        curators: vec![authority.pubkey()],
        knowledge_count: 0,
        knowledge_governance: default_governance(),
        decision_engine: DecisionEngine::AdminOnly {
            admin: authority.pubkey(),
        },
        created_at: 0,
        bump: circle_two_bump,
        flags: 0,
        status: CircleLifecycleStatus::Active,
    };
    program_test.add_account(
        circle_two_pda,
        program_owned_account(serialize_anchor_account(&circle_two)),
    );

    let (knowledge_pda, knowledge_bump) = Pubkey::find_program_address(
        &[b"knowledge", circle_one_pda.as_ref(), &0u64.to_le_bytes()],
        &program_id,
    );
    let (knowledge_binding_pda, knowledge_binding_bump) =
        Pubkey::find_program_address(&[b"knowledge_binding", knowledge_pda.as_ref()], &program_id);
    let proof_package_hash = [0x45; 32];
    let contributors_root = [0x46; 32];
    let knowledge = Knowledge {
        knowledge_id: [0x22; 32],
        circle_id: circle_one_id,
        ipfs_cid: "bafybeihardeningtestknowledge".to_string(),
        content_hash: [0x33; 32],
        title: "Cross-circle guard".to_string(),
        description: "knowledge belongs to circle one".to_string(),
        author: authority.pubkey(),
        quality_score: 0.9,
        source_circle: None,
        created_at: 0,
        view_count: 0,
        citation_count: 0,
        bump: knowledge_bump,
        flags: 1,
        contributors_root: [0; 32],
        contributors_count: 0,
    };
    program_test.add_account(
        knowledge_pda,
        program_owned_account(serialize_anchor_account(&knowledge)),
    );
    program_test.add_account(
        knowledge_binding_pda,
        program_owned_account(serialize_anchor_account(&KnowledgeBinding {
            knowledge: knowledge_pda,
            source_anchor_id: [0x47; 32],
            proof_package_hash,
            contributors_root,
            contributors_count: 2,
            binding_version: 1,
            generated_at: 0,
            bound_at: 0,
            bound_by: authority.pubkey(),
            bump: knowledge_binding_bump,
        })),
    );

    let context = program_test.start_with_context().await;
    let instruction = Instruction {
        program_id,
        accounts: circle_accounts::UpdateContributors {
            knowledge: knowledge_pda,
            circle: circle_two_pda,
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
            contributors_count: 2,
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
        .expect_err("update_contributors should reject cross-circle mutation");
    assert_invalid_operation(error);
}

#[tokio::test]
async fn cpi_promote_knowledge_rejects_archived_circle() {
    let program_id = circle_manager::id();
    let mut program_test = ProgramTest::new(
        "circle_manager",
        program_id,
        processor!(process_instruction),
    );

    let authority = Keypair::new();
    let caller_program = Keypair::new();
    let extension_registry = Keypair::new();

    program_test.add_account(authority.pubkey(), system_account(10_000_000_000));
    program_test.add_account(caller_program.pubkey(), system_account(1_000_000_000));
    program_test.add_account(
        extension_registry.pubkey(),
        extension_registry_account(caller_program.pubkey()),
    );

    let circle_id = 3u8;
    let (circle_pda, circle_bump) =
        Pubkey::find_program_address(&[b"circle", &[circle_id]], &program_id);
    program_test.add_account(
        circle_pda,
        program_owned_account(serialize_anchor_account(&Circle {
            circle_id,
            name: "archived-cpi".to_string(),
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
            status: CircleLifecycleStatus::Archived,
        })),
    );

    let (knowledge_pda, knowledge_bump) = Pubkey::find_program_address(
        &[b"knowledge", circle_pda.as_ref(), &0u64.to_le_bytes()],
        &program_id,
    );
    program_test.add_account(
        knowledge_pda,
        program_owned_account(serialize_anchor_account(&Knowledge {
            knowledge_id: [0x88; 32],
            circle_id,
            ipfs_cid: "bafybeiarchivedcpi".to_string(),
            content_hash: [0x89; 32],
            title: "Archived CPI".to_string(),
            description: "archived circles reject extension promotion".to_string(),
            author: authority.pubkey(),
            quality_score: 0.5,
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

    let context = program_test.start_with_context().await;
    let instruction = Instruction {
        program_id,
        accounts: circle_accounts::CpiPromoteKnowledge {
            knowledge: knowledge_pda,
            circle: circle_pda,
            caller_program: caller_program.pubkey(),
            extension_registry: extension_registry.pubkey(),
            authority: authority.pubkey(),
        }
        .to_account_metas(None),
        data: circle_instructions::CpiPromoteKnowledge {
            quality_delta: 0.25,
            reason: "archived cpi".to_string(),
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
        .expect_err("archived circle should reject extension promotion");
    assert_custom_code(error, CIRCLE_ARCHIVED_ERROR_CODE);
}

#[tokio::test]
async fn cpi_promote_knowledge_rejects_cross_circle_knowledge_mutation() {
    let program_id = circle_manager::id();
    let mut program_test = ProgramTest::new(
        "circle_manager",
        program_id,
        processor!(process_instruction),
    );

    let authority = Keypair::new();
    let caller_program = Keypair::new();
    let extension_registry = Keypair::new();

    program_test.add_account(authority.pubkey(), system_account(10_000_000_000));
    program_test.add_account(caller_program.pubkey(), system_account(1_000_000_000));
    program_test.add_account(
        extension_registry.pubkey(),
        extension_registry_account(caller_program.pubkey()),
    );

    let circle_one_id = 1u8;
    let circle_two_id = 2u8;
    let (circle_one_pda, circle_one_bump) =
        Pubkey::find_program_address(&[b"circle", &[circle_one_id]], &program_id);
    let (circle_two_pda, circle_two_bump) =
        Pubkey::find_program_address(&[b"circle", &[circle_two_id]], &program_id);

    let circle_one = Circle {
        circle_id: circle_one_id,
        name: "circle-one".to_string(),
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
        bump: circle_one_bump,
        flags: 0,
        status: CircleLifecycleStatus::Active,
    };
    program_test.add_account(
        circle_one_pda,
        program_owned_account(serialize_anchor_account(&circle_one)),
    );

    let circle_two = Circle {
        circle_id: circle_two_id,
        name: "circle-two".to_string(),
        level: 1,
        parent_circle: None,
        child_circles: vec![],
        curators: vec![authority.pubkey()],
        knowledge_count: 0,
        knowledge_governance: default_governance(),
        decision_engine: DecisionEngine::AdminOnly {
            admin: authority.pubkey(),
        },
        created_at: 0,
        bump: circle_two_bump,
        flags: 0,
        status: CircleLifecycleStatus::Active,
    };
    program_test.add_account(
        circle_two_pda,
        program_owned_account(serialize_anchor_account(&circle_two)),
    );

    let (knowledge_pda, knowledge_bump) = Pubkey::find_program_address(
        &[b"knowledge", circle_one_pda.as_ref(), &0u64.to_le_bytes()],
        &program_id,
    );
    let knowledge = Knowledge {
        knowledge_id: [0x55; 32],
        circle_id: circle_one_id,
        ipfs_cid: "bafybeicpipromoteknowledge".to_string(),
        content_hash: [0x66; 32],
        title: "CPI cross-circle guard".to_string(),
        description: "knowledge belongs to circle one".to_string(),
        author: authority.pubkey(),
        quality_score: 0.5,
        source_circle: None,
        created_at: 0,
        view_count: 0,
        citation_count: 0,
        bump: knowledge_bump,
        flags: 1,
        contributors_root: [0; 32],
        contributors_count: 0,
    };
    program_test.add_account(
        knowledge_pda,
        program_owned_account(serialize_anchor_account(&knowledge)),
    );

    let context = program_test.start_with_context().await;
    let instruction = Instruction {
        program_id,
        accounts: circle_accounts::CpiPromoteKnowledge {
            knowledge: knowledge_pda,
            circle: circle_two_pda,
            caller_program: caller_program.pubkey(),
            extension_registry: extension_registry.pubkey(),
            authority: authority.pubkey(),
        }
        .to_account_metas(None),
        data: circle_instructions::CpiPromoteKnowledge {
            quality_delta: 0.25,
            reason: "cross-circle guard".to_string(),
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
        .expect_err("cpi_promote_knowledge should reject cross-circle mutation");
    assert_invalid_operation(error);
}

fn assert_invalid_operation(error: BanksClientError) {
    assert_custom_code(error, INVALID_OPERATION_ERROR_CODE);
}

fn assert_custom_code(error: BanksClientError, expected_code: u32) {
    match error {
        BanksClientError::TransactionError(TransactionError::InstructionError(
            _,
            InstructionError::Custom(code),
        )) => {
            assert_eq!(
                code, expected_code,
                "expected custom code {expected_code}, got {code}",
            );
        }
        other => panic!("expected custom error code {expected_code}, got {other:?}"),
    }
}

fn process_instruction<'a, 'b, 'c, 'd>(
    program_id: &'a Pubkey,
    accounts: &'b [AccountInfo<'c>],
    instruction_data: &'d [u8],
) -> ProgramResult {
    // ProgramTest passes account slice/entries from the same backing frame.
    // Anchor entry expects the slice lifetime to match AccountInfo lifetime.
    let unified_accounts: &'c [AccountInfo<'c>] = unsafe { std::mem::transmute(accounts) };
    circle_manager::entry(program_id, unified_accounts, instruction_data)
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

fn program_owned_account(data: Vec<u8>) -> Account {
    Account {
        lamports: 10_000_000_000,
        data,
        owner: circle_manager::id(),
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

fn extension_registry_account(caller_program: Pubkey) -> Account {
    let registry = ExtensionRegistry {
        bump: 0,
        admin: Pubkey::new_unique(),
        extensions: vec![AuthorizedCaller {
            program_id: caller_program,
            permissions: vec![CpiPermission::CircleExtend],
            enabled: true,
        }],
        max_extensions: ExtensionRegistry::MAX_EXTENSIONS as u8,
        created_at: 0,
        last_updated: 0,
    };

    let mut data = vec![0u8; 8];
    registry
        .serialize(&mut data)
        .expect("extension registry should serialize");

    Account {
        lamports: 10_000_000_000,
        data,
        owner: registry_factory_program_id(),
        executable: false,
        rent_epoch: 0,
    }
}

fn registry_factory_program_id() -> Pubkey {
    Pubkey::from_str("AYrzTqFdxpiH3VhCBzLsJQtzFqjoSRKYUvk29d797AQC")
        .expect("valid registry factory id")
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
