use alcheme_shared::{CircleMemberRole, CircleMemberStatus};
use anchor_lang::{
    solana_program::{
        account_info::AccountInfo,
        entrypoint::ProgramResult,
        program_error::ProgramError,
        system_program,
    },
    AccountDeserialize,
    AccountSerialize,
    AnchorSerialize,
};
use circle_manager::{Circle, CircleMemberAccount, DecisionEngine, KnowledgeGovernance};
use solana_program_test::{processor, BanksClientError, ProgramTest};
use solana_sdk::{
    account::Account,
    ed25519_instruction,
    instruction::{AccountMeta, Instruction, InstructionError},
    sysvar::instructions as instructions_sysvar,
    pubkey::Pubkey,
    signature::{Keypair, Signer},
    transaction::{Transaction, TransactionError},
};
use std::str::FromStr;

const INVALID_OPERATION_ERROR_CODE: u32 = 12000;
const EVENT_EMITTER_PROGRAM_ID: &str = "uhPvVgDANHaUzUq2rYEVXJ9vGEBjWjNZ1E6gQJqdBUC";
const EVENT_EMITTER_SEQUENCE_OFFSET: usize = 8 + 1 + 32 + 8;
const EVENT_EMITTER_MIN_DATA_SIZE: usize = EVENT_EMITTER_SEQUENCE_OFFSET + 8;

#[tokio::test]
async fn update_circle_member_role_changes_role_without_deactivating_membership() {
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
    let member = Keypair::new();
    let event_emitter = Keypair::new();
    let event_batch = Keypair::new();

    program_test.add_account(authority.pubkey(), system_account(20_000_000_000));
    program_test.add_account(member.pubkey(), system_account(20_000_000_000));
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

    let circle_id = 7u8;
    let (circle_pda, circle_bump) =
        Pubkey::find_program_address(&[b"circle", &[circle_id]], &program_id);
    program_test.add_account(
        circle_pda,
        program_owned_account(serialize_anchor_account(&Circle {
            circle_id,
            name: "membership-authority".to_string(),
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
            bump: circle_bump,
            flags: 0,
        })),
    );

    let (circle_member_pda, circle_member_bump) = Pubkey::find_program_address(
        &[b"circle_member", circle_pda.as_ref(), member.pubkey().as_ref()],
        &program_id,
    );
    program_test.add_account(
        circle_member_pda,
        program_owned_account(serialize_anchor_account(&CircleMemberAccount {
            circle_id,
            member: member.pubkey(),
            status: CircleMemberStatus::Active,
            role: CircleMemberRole::Member,
            joined_at: 1_700_000_000,
            updated_at: 1_700_000_000,
            bump: circle_member_bump,
        })),
    );

    let context = program_test.start_with_context().await;
    let mut data = membership_instruction_discriminator("update_circle_member_role");
    data.extend(
        CircleMemberRole::Moderator
            .try_to_vec()
            .expect("role should serialize"),
    );
    let instruction = Instruction {
        program_id,
        accounts: vec![
            AccountMeta::new_readonly(circle_pda, false),
            AccountMeta::new(circle_member_pda, false),
            AccountMeta::new(authority.pubkey(), true),
            AccountMeta::new_readonly(member.pubkey(), false),
            AccountMeta::new_readonly(event_program, false),
            AccountMeta::new(event_emitter.pubkey(), false),
            AccountMeta::new(event_batch.pubkey(), false),
            AccountMeta::new_readonly(system_program::ID, false),
        ],
        data,
    };

    let tx = Transaction::new_signed_with_payer(
        &[instruction],
        Some(&context.payer.pubkey()),
        &[&context.payer, &authority],
        context.last_blockhash,
    );

    context
        .banks_client
        .process_transaction(tx)
        .await
        .expect("role change should succeed for curator authority");

    let updated_account = context
        .banks_client
        .get_account(circle_member_pda)
        .await
        .expect("account lookup should succeed")
        .expect("circle member should exist");
    let updated_member: CircleMemberAccount = deserialize_anchor_account(&updated_account.data);
    assert_eq!(updated_member.role, CircleMemberRole::Moderator);
    assert_eq!(updated_member.status, CircleMemberStatus::Active);
}

#[tokio::test]
async fn update_circle_member_role_rejects_non_owner_curator_authority() {
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
    let owner = Keypair::new();
    let member = Keypair::new();
    let event_emitter = Keypair::new();
    let event_batch = Keypair::new();

    program_test.add_account(authority.pubkey(), system_account(20_000_000_000));
    program_test.add_account(owner.pubkey(), system_account(20_000_000_000));
    program_test.add_account(member.pubkey(), system_account(20_000_000_000));
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

    let circle_id = 8u8;
    let (circle_pda, circle_bump) =
        Pubkey::find_program_address(&[b"circle", &[circle_id]], &program_id);
    program_test.add_account(
        circle_pda,
        program_owned_account(serialize_anchor_account(&Circle {
            circle_id,
            name: "membership-authority-reject".to_string(),
            level: 1,
            parent_circle: None,
            child_circles: vec![],
            curators: vec![owner.pubkey(), authority.pubkey()],
            knowledge_count: 0,
            knowledge_governance: default_governance(),
            decision_engine: DecisionEngine::AdminOnly {
                admin: owner.pubkey(),
            },
            created_at: 0,
            bump: circle_bump,
            flags: 0,
        })),
    );

    let (circle_member_pda, circle_member_bump) = Pubkey::find_program_address(
        &[b"circle_member", circle_pda.as_ref(), member.pubkey().as_ref()],
        &program_id,
    );
    program_test.add_account(
        circle_member_pda,
        program_owned_account(serialize_anchor_account(&CircleMemberAccount {
            circle_id,
            member: member.pubkey(),
            status: CircleMemberStatus::Active,
            role: CircleMemberRole::Member,
            joined_at: 1_700_000_000,
            updated_at: 1_700_000_000,
            bump: circle_member_bump,
        })),
    );

    let context = program_test.start_with_context().await;
    let mut data = membership_instruction_discriminator("update_circle_member_role");
    data.extend(
        CircleMemberRole::Moderator
            .try_to_vec()
            .expect("role should serialize"),
    );
    let instruction = Instruction {
        program_id,
        accounts: vec![
            AccountMeta::new_readonly(circle_pda, false),
            AccountMeta::new(circle_member_pda, false),
            AccountMeta::new(authority.pubkey(), true),
            AccountMeta::new_readonly(member.pubkey(), false),
            AccountMeta::new_readonly(event_program, false),
            AccountMeta::new(event_emitter.pubkey(), false),
            AccountMeta::new(event_batch.pubkey(), false),
            AccountMeta::new_readonly(system_program::ID, false),
        ],
        data,
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
        .expect_err("non-owner curator authority should be rejected");
    assert_invalid_operation(error);
}

#[tokio::test]
async fn update_circle_member_role_rejects_protected_target_role() {
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
    let member = Keypair::new();
    let event_emitter = Keypair::new();
    let event_batch = Keypair::new();

    program_test.add_account(authority.pubkey(), system_account(20_000_000_000));
    program_test.add_account(member.pubkey(), system_account(20_000_000_000));
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
            name: "membership-role-protected".to_string(),
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
            bump: circle_bump,
            flags: 0,
        })),
    );

    let (circle_member_pda, circle_member_bump) = Pubkey::find_program_address(
        &[b"circle_member", circle_pda.as_ref(), member.pubkey().as_ref()],
        &program_id,
    );
    program_test.add_account(
        circle_member_pda,
        program_owned_account(serialize_anchor_account(&CircleMemberAccount {
            circle_id,
            member: member.pubkey(),
            status: CircleMemberStatus::Active,
            role: CircleMemberRole::Admin,
            joined_at: 1_700_000_000,
            updated_at: 1_700_000_000,
            bump: circle_member_bump,
        })),
    );

    let context = program_test.start_with_context().await;
    let mut data = membership_instruction_discriminator("update_circle_member_role");
    data.extend(
        CircleMemberRole::Member
            .try_to_vec()
            .expect("role should serialize"),
    );
    let instruction = Instruction {
        program_id,
        accounts: vec![
            AccountMeta::new_readonly(circle_pda, false),
            AccountMeta::new(circle_member_pda, false),
            AccountMeta::new(authority.pubkey(), true),
            AccountMeta::new_readonly(member.pubkey(), false),
            AccountMeta::new_readonly(event_program, false),
            AccountMeta::new(event_emitter.pubkey(), false),
            AccountMeta::new(event_batch.pubkey(), false),
            AccountMeta::new_readonly(system_program::ID, false),
        ],
        data,
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
        .expect_err("protected admin target should be rejected");
    assert_invalid_operation(error);
}

#[tokio::test]
async fn update_circle_member_role_rejects_inactive_target_membership() {
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
    let member = Keypair::new();
    let event_emitter = Keypair::new();
    let event_batch = Keypair::new();

    program_test.add_account(authority.pubkey(), system_account(20_000_000_000));
    program_test.add_account(member.pubkey(), system_account(20_000_000_000));
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

    let circle_id = 14u8;
    let (circle_pda, circle_bump) =
        Pubkey::find_program_address(&[b"circle", &[circle_id]], &program_id);
    program_test.add_account(
        circle_pda,
        program_owned_account(serialize_anchor_account(&Circle {
            circle_id,
            name: "membership-role-inactive".to_string(),
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
            bump: circle_bump,
            flags: 0,
        })),
    );

    let (circle_member_pda, circle_member_bump) = Pubkey::find_program_address(
        &[b"circle_member", circle_pda.as_ref(), member.pubkey().as_ref()],
        &program_id,
    );
    program_test.add_account(
        circle_member_pda,
        program_owned_account(serialize_anchor_account(&CircleMemberAccount {
            circle_id,
            member: member.pubkey(),
            status: CircleMemberStatus::Inactive,
            role: CircleMemberRole::Member,
            joined_at: 1_700_000_000,
            updated_at: 1_700_000_000,
            bump: circle_member_bump,
        })),
    );

    let context = program_test.start_with_context().await;
    let mut data = membership_instruction_discriminator("update_circle_member_role");
    data.extend(
        CircleMemberRole::Moderator
            .try_to_vec()
            .expect("role should serialize"),
    );
    let instruction = Instruction {
        program_id,
        accounts: vec![
            AccountMeta::new_readonly(circle_pda, false),
            AccountMeta::new(circle_member_pda, false),
            AccountMeta::new(authority.pubkey(), true),
            AccountMeta::new_readonly(member.pubkey(), false),
            AccountMeta::new_readonly(event_program, false),
            AccountMeta::new(event_emitter.pubkey(), false),
            AccountMeta::new(event_batch.pubkey(), false),
            AccountMeta::new_readonly(system_program::ID, false),
        ],
        data,
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
        .expect_err("inactive target membership should be rejected for role changes");
    assert_invalid_operation(error);
}

#[tokio::test]
async fn remove_circle_member_deactivates_member_with_owner_authority() {
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
    let member = Keypair::new();
    let event_emitter = Keypair::new();
    let event_batch = Keypair::new();

    program_test.add_account(authority.pubkey(), system_account(20_000_000_000));
    program_test.add_account(member.pubkey(), system_account(20_000_000_000));
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

    let circle_id = 11u8;
    let (circle_pda, circle_bump) =
        Pubkey::find_program_address(&[b"circle", &[circle_id]], &program_id);
    program_test.add_account(
        circle_pda,
        program_owned_account(serialize_anchor_account(&Circle {
            circle_id,
            name: "membership-remove".to_string(),
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
            bump: circle_bump,
            flags: 0,
        })),
    );

    let (circle_member_pda, circle_member_bump) = Pubkey::find_program_address(
        &[b"circle_member", circle_pda.as_ref(), member.pubkey().as_ref()],
        &program_id,
    );
    program_test.add_account(
        circle_member_pda,
        program_owned_account(serialize_anchor_account(&CircleMemberAccount {
            circle_id,
            member: member.pubkey(),
            status: CircleMemberStatus::Active,
            role: CircleMemberRole::Member,
            joined_at: 1_700_000_000,
            updated_at: 1_700_000_000,
            bump: circle_member_bump,
        })),
    );

    let context = program_test.start_with_context().await;
    let instruction = Instruction {
        program_id,
        accounts: vec![
            AccountMeta::new_readonly(circle_pda, false),
            AccountMeta::new(circle_member_pda, false),
            AccountMeta::new(authority.pubkey(), true),
            AccountMeta::new_readonly(member.pubkey(), false),
            AccountMeta::new_readonly(event_program, false),
            AccountMeta::new(event_emitter.pubkey(), false),
            AccountMeta::new(event_batch.pubkey(), false),
            AccountMeta::new_readonly(system_program::ID, false),
        ],
        data: membership_instruction_discriminator("remove_circle_member"),
    };

    let tx = Transaction::new_signed_with_payer(
        &[instruction],
        Some(&context.payer.pubkey()),
        &[&context.payer, &authority],
        context.last_blockhash,
    );

    context
        .banks_client
        .process_transaction(tx)
        .await
        .expect("owner authority should be able to deactivate removable members");

    let updated_account = context
        .banks_client
        .get_account(circle_member_pda)
        .await
        .expect("account lookup should succeed")
        .expect("circle member should exist");
    let updated_member: CircleMemberAccount = deserialize_anchor_account(&updated_account.data);
    assert_eq!(updated_member.status, CircleMemberStatus::Inactive);
    assert_eq!(updated_member.role, CircleMemberRole::Member);
}

#[tokio::test]
async fn remove_circle_member_rejects_protected_target_role() {
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
    let member = Keypair::new();
    let event_emitter = Keypair::new();
    let event_batch = Keypair::new();

    program_test.add_account(authority.pubkey(), system_account(20_000_000_000));
    program_test.add_account(member.pubkey(), system_account(20_000_000_000));
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

    let circle_id = 12u8;
    let (circle_pda, circle_bump) =
        Pubkey::find_program_address(&[b"circle", &[circle_id]], &program_id);
    program_test.add_account(
        circle_pda,
        program_owned_account(serialize_anchor_account(&Circle {
            circle_id,
            name: "membership-remove-protected".to_string(),
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
            bump: circle_bump,
            flags: 0,
        })),
    );

    let (circle_member_pda, circle_member_bump) = Pubkey::find_program_address(
        &[b"circle_member", circle_pda.as_ref(), member.pubkey().as_ref()],
        &program_id,
    );
    program_test.add_account(
        circle_member_pda,
        program_owned_account(serialize_anchor_account(&CircleMemberAccount {
            circle_id,
            member: member.pubkey(),
            status: CircleMemberStatus::Active,
            role: CircleMemberRole::Owner,
            joined_at: 1_700_000_000,
            updated_at: 1_700_000_000,
            bump: circle_member_bump,
        })),
    );

    let context = program_test.start_with_context().await;
    let instruction = Instruction {
        program_id,
        accounts: vec![
            AccountMeta::new_readonly(circle_pda, false),
            AccountMeta::new(circle_member_pda, false),
            AccountMeta::new(authority.pubkey(), true),
            AccountMeta::new_readonly(member.pubkey(), false),
            AccountMeta::new_readonly(event_program, false),
            AccountMeta::new(event_emitter.pubkey(), false),
            AccountMeta::new(event_batch.pubkey(), false),
            AccountMeta::new_readonly(system_program::ID, false),
        ],
        data: membership_instruction_discriminator("remove_circle_member"),
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
        .expect_err("protected owner target should be rejected");
    assert_invalid_operation(error);
}

#[tokio::test]
async fn remove_circle_member_rejects_inactive_target_membership() {
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
    let member = Keypair::new();
    let event_emitter = Keypair::new();
    let event_batch = Keypair::new();

    program_test.add_account(authority.pubkey(), system_account(20_000_000_000));
    program_test.add_account(member.pubkey(), system_account(20_000_000_000));
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

    let circle_id = 15u8;
    let (circle_pda, circle_bump) =
        Pubkey::find_program_address(&[b"circle", &[circle_id]], &program_id);
    program_test.add_account(
        circle_pda,
        program_owned_account(serialize_anchor_account(&Circle {
            circle_id,
            name: "membership-remove-inactive".to_string(),
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
            bump: circle_bump,
            flags: 0,
        })),
    );

    let (circle_member_pda, circle_member_bump) = Pubkey::find_program_address(
        &[b"circle_member", circle_pda.as_ref(), member.pubkey().as_ref()],
        &program_id,
    );
    program_test.add_account(
        circle_member_pda,
        program_owned_account(serialize_anchor_account(&CircleMemberAccount {
            circle_id,
            member: member.pubkey(),
            status: CircleMemberStatus::Inactive,
            role: CircleMemberRole::Member,
            joined_at: 1_700_000_000,
            updated_at: 1_700_000_000,
            bump: circle_member_bump,
        })),
    );

    let context = program_test.start_with_context().await;
    let instruction = Instruction {
        program_id,
        accounts: vec![
            AccountMeta::new_readonly(circle_pda, false),
            AccountMeta::new(circle_member_pda, false),
            AccountMeta::new(authority.pubkey(), true),
            AccountMeta::new_readonly(member.pubkey(), false),
            AccountMeta::new_readonly(event_program, false),
            AccountMeta::new(event_emitter.pubkey(), false),
            AccountMeta::new(event_batch.pubkey(), false),
            AccountMeta::new_readonly(system_program::ID, false),
        ],
        data: membership_instruction_discriminator("remove_circle_member"),
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
        .expect_err("inactive target membership should be rejected for removals");
    assert_invalid_operation(error);
}

#[tokio::test]
async fn claim_circle_membership_initializes_first_time_member_from_bridge_grant() {
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

    let member = Keypair::new();
    let bridge_admin = Keypair::new();
    let event_emitter = Keypair::new();
    let event_batch = Keypair::new();

    program_test.add_account(member.pubkey(), system_account(20_000_000_000));
    program_test.add_account(bridge_admin.pubkey(), system_account(20_000_000_000));
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

    let (circle_manager_pda, circle_manager_bump) =
        Pubkey::find_program_address(&[b"circle_manager"], &program_id);
    program_test.add_account(
        circle_manager_pda,
        program_owned_account(serialize_anchor_account(&circle_manager::CircleManager {
            bump: circle_manager_bump,
            admin: bridge_admin.pubkey(),
            created_at: 0,
            total_circles: 1,
            total_knowledge: 0,
            total_transfers: 0,
        })),
    );

    let circle_id = 9u8;
    let (circle_pda, circle_bump) =
        Pubkey::find_program_address(&[b"circle", &[circle_id]], &program_id);
    program_test.add_account(
        circle_pda,
        program_owned_account(serialize_anchor_account(&Circle {
            circle_id,
            name: "membership-claim".to_string(),
            level: 1,
            parent_circle: None,
            child_circles: vec![],
            curators: vec![bridge_admin.pubkey()],
            knowledge_count: 0,
            knowledge_governance: default_governance(),
            decision_engine: DecisionEngine::AdminOnly {
                admin: bridge_admin.pubkey(),
            },
            created_at: 0,
            bump: circle_bump,
            flags: 0,
        })),
    );

    let (circle_member_pda, _) = Pubkey::find_program_address(
        &[b"circle_member", circle_pda.as_ref(), member.pubkey().as_ref()],
        &program_id,
    );

    let admission = MembershipAdmissionFixture {
        circle_id,
        member: member.pubkey(),
        role: CircleMemberRole::Member,
        kind: 0,
        artifact_id: 0,
        issued_at: 1_700_000_000,
        expires_at: 1_800_000_000,
    };
    let admission_digest = build_membership_admission_digest(&admission);
    let signed = *bridge_admin.sign_message(&admission_digest).as_array();
    let verify_ix = ed25519_instruction::new_ed25519_instruction_with_signature(
        &admission_digest,
        &signed,
        &bridge_admin.pubkey().to_bytes(),
    );
    let mut instruction_data = membership_instruction_discriminator("claim_circle_membership");
    instruction_data.extend(serialize_membership_admission_fixture(&admission));
    instruction_data.extend(bridge_admin.pubkey().to_bytes());
    instruction_data.extend(signed);

    let instruction = Instruction {
        program_id,
        accounts: vec![
            AccountMeta::new_readonly(circle_manager_pda, false),
            AccountMeta::new_readonly(circle_pda, false),
            AccountMeta::new(circle_member_pda, false),
            AccountMeta::new(member.pubkey(), true),
            AccountMeta::new_readonly(instructions_sysvar::ID, false),
            AccountMeta::new_readonly(event_program, false),
            AccountMeta::new(event_emitter.pubkey(), false),
            AccountMeta::new(event_batch.pubkey(), false),
            AccountMeta::new_readonly(system_program::ID, false),
        ],
        data: instruction_data,
    };

    let context = program_test.start_with_context().await;
    let tx = Transaction::new_signed_with_payer(
        &[verify_ix, instruction],
        Some(&context.payer.pubkey()),
        &[&context.payer, &member],
        context.last_blockhash,
    );

    context
        .banks_client
        .process_transaction(tx)
        .await
        .expect("claim should initialize membership from a valid bridge grant");

    let updated_account = context
        .banks_client
        .get_account(circle_member_pda)
        .await
        .expect("account lookup should succeed")
        .expect("circle member should exist");
    let updated_member: CircleMemberAccount = deserialize_anchor_account(&updated_account.data);
    assert_eq!(updated_member.member, member.pubkey());
    assert_eq!(updated_member.role, CircleMemberRole::Member);
    assert_eq!(updated_member.status, CircleMemberStatus::Active);
}

fn membership_instruction_discriminator(name: &str) -> Vec<u8> {
    use anchor_lang::solana_program::hash::hash;

    hash(format!("global:{name}").as_bytes())
        .to_bytes()[..8]
        .to_vec()
}

fn assert_invalid_operation(error: BanksClientError) {
    match error {
        BanksClientError::TransactionError(TransactionError::InstructionError(
            _,
            InstructionError::Custom(code),
        )) => {
            assert_eq!(
                code, INVALID_OPERATION_ERROR_CODE,
                "expected InvalidOperation(12000 runtime code), got {code}",
            );
        }
        other => panic!("expected custom InvalidOperation error, got {other:?}"),
    }
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

struct MembershipAdmissionFixture {
    circle_id: u8,
    member: Pubkey,
    role: CircleMemberRole,
    kind: u8,
    artifact_id: u64,
    issued_at: i64,
    expires_at: i64,
}

fn serialize_membership_admission_fixture(input: &MembershipAdmissionFixture) -> Vec<u8> {
    let mut out = vec![input.circle_id];
    out.extend(input.member.to_bytes());
    out.push(circle_member_role_index(&input.role));
    out.push(input.kind);
    out.extend(input.artifact_id.to_le_bytes());
    out.extend(input.issued_at.to_le_bytes());
    out.extend(input.expires_at.to_le_bytes());
    out
}

fn build_membership_admission_digest(input: &MembershipAdmissionFixture) -> Vec<u8> {
    use anchor_lang::solana_program::hash::hashv;

    hashv(&[
        b"alcheme:membership_admission:v1",
        &[input.circle_id],
        input.member.as_ref(),
        &[circle_member_role_index(&input.role)],
        &[input.kind],
        &input.artifact_id.to_le_bytes(),
        &input.issued_at.to_le_bytes(),
        &input.expires_at.to_le_bytes(),
    ])
    .to_bytes()
    .to_vec()
}

fn circle_member_role_index(role: &CircleMemberRole) -> u8 {
    match role {
        CircleMemberRole::Owner => 0,
        CircleMemberRole::Admin => 1,
        CircleMemberRole::Moderator => 2,
        CircleMemberRole::Member => 3,
    }
}
