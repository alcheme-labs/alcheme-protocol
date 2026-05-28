use alcheme_shared::{CircleLifecycleStatus, CircleMemberRole, CircleMemberStatus};
use anchor_lang::{
    solana_program::{
        account_info::AccountInfo, entrypoint::ProgramResult, program_error::ProgramError,
        system_program,
    },
    AccountDeserialize, AccountSerialize, AnchorSerialize,
};
use circle_manager::{
    Circle, CircleManager, CircleMemberAccount, DecisionEngine, KnowledgeGovernance,
};
use solana_program_test::{processor, BanksClientError, ProgramTest};
use solana_sdk::{
    account::Account,
    instruction::{AccountMeta, Instruction, InstructionError},
    pubkey::Pubkey,
    signature::{Keypair, Signer},
    transaction::{Transaction, TransactionError},
};
use std::str::FromStr;

const INVALID_OPERATION_ERROR_CODE: u32 = 12000;
const CIRCLE_ARCHIVED_ERROR_CODE: u32 = 12014;
const EVENT_EMITTER_PROGRAM_ID: &str = "uhPvVgDANHaUzUq2rYEVXJ9vGEBjWjNZ1E6gQJqdBUC";
const EVENT_EMITTER_SEQUENCE_OFFSET: usize = 8 + 1 + 32 + 8;
const EVENT_EMITTER_MIN_DATA_SIZE: usize = EVENT_EMITTER_SEQUENCE_OFFSET + 8;

#[test]
fn legacy_circle_account_deserializes_with_active_lifecycle_default() {
    let current = Circle {
        circle_id: 42,
        name: "legacy-circle".to_string(),
        level: 1,
        parent_circle: None,
        child_circles: vec![],
        curators: vec![Pubkey::new_unique()],
        knowledge_count: 0,
        knowledge_governance: default_governance(),
        decision_engine: DecisionEngine::AdminOnly {
            admin: Pubkey::new_unique(),
        },
        created_at: 0,
        bump: 7,
        flags: 0,
        status: CircleLifecycleStatus::Active,
    };

    let mut data = vec![0u8; Circle::SPACE - 1];
    let serialized = serialize_anchor_account(&current);
    let legacy_len = serialized.len() - 1;
    data[..legacy_len].copy_from_slice(&serialized[..legacy_len]);

    let circle: Circle = deserialize_anchor_account(&data);
    assert_eq!(circle.circle_id, current.circle_id);
    assert_eq!(circle.status, CircleLifecycleStatus::Active);
    assert!(!circle.is_archived());
}

#[tokio::test]
async fn migrate_circle_lifecycle_expands_legacy_circle_account() {
    let program_id = circle_manager::id();
    let mut program_test = ProgramTest::new(
        "circle_manager",
        program_id,
        processor!(process_instruction),
    );

    let payer = Keypair::new();
    program_test.add_account(payer.pubkey(), system_account(20_000_000_000));

    let circle_id = 16u8;
    let (circle_pda, circle_bump) =
        Pubkey::find_program_address(&[b"circle", &[circle_id]], &program_id);
    let current = Circle {
        circle_id,
        name: "legacy-migration".to_string(),
        level: 1,
        parent_circle: None,
        child_circles: vec![],
        curators: vec![payer.pubkey()],
        knowledge_count: 0,
        knowledge_governance: default_governance(),
        decision_engine: DecisionEngine::AdminOnly {
            admin: payer.pubkey(),
        },
        created_at: 0,
        bump: circle_bump,
        flags: 0,
        status: CircleLifecycleStatus::Active,
    };
    let serialized = serialize_anchor_account(&current);
    let legacy_len = Circle::SPACE - 1;
    let mut legacy_data = vec![0u8; legacy_len];
    legacy_data[..serialized.len() - 1].copy_from_slice(&serialized[..serialized.len() - 1]);
    program_test.add_account(circle_pda, program_owned_account(legacy_data));

    let context = program_test.start_with_context().await;
    let mut instruction_data = instruction_discriminator("migrate_circle_lifecycle");
    instruction_data.push(circle_id);
    let tx = Transaction::new_signed_with_payer(
        &[Instruction {
            program_id,
            accounts: vec![
                AccountMeta::new(circle_pda, false),
                AccountMeta::new(payer.pubkey(), true),
                AccountMeta::new_readonly(system_program::ID, false),
            ],
            data: instruction_data,
        }],
        Some(&context.payer.pubkey()),
        &[&context.payer, &payer],
        context.last_blockhash,
    );

    context
        .banks_client
        .process_transaction(tx)
        .await
        .expect("migration should expand legacy circle account");

    let migrated_account = context
        .banks_client
        .get_account(circle_pda)
        .await
        .expect("circle lookup should succeed")
        .expect("circle should exist");
    assert_eq!(migrated_account.data.len(), Circle::SPACE);
    let migrated: Circle = deserialize_anchor_account(&migrated_account.data);
    assert_eq!(migrated.status, CircleLifecycleStatus::Active);
}

#[tokio::test]
async fn circle_owner_can_archive_and_restore_with_event_emission() {
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

    let admin = Keypair::new();
    let owner = Keypair::new();
    let event_emitter = Keypair::new();
    let event_batch = Keypair::new();

    program_test.add_account(admin.pubkey(), system_account(20_000_000_000));
    program_test.add_account(owner.pubkey(), system_account(20_000_000_000));
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

    let circle_id = 17u8;
    let (circle_pda, circle_bump) =
        Pubkey::find_program_address(&[b"circle", &[circle_id]], &program_id);
    let (circle_manager_pda, manager_bump) =
        Pubkey::find_program_address(&[b"circle_manager"], &program_id);

    program_test.add_account(
        circle_manager_pda,
        program_owned_account(serialize_anchor_account(&CircleManager {
            bump: manager_bump,
            admin: admin.pubkey(),
            created_at: 0,
            total_circles: 1,
            total_knowledge: 0,
            total_transfers: 0,
        })),
    );
    program_test.add_account(
        circle_pda,
        program_owned_account(serialize_anchor_account(&Circle {
            circle_id,
            name: "owner-archive".to_string(),
            level: 1,
            parent_circle: None,
            child_circles: vec![],
            curators: vec![owner.pubkey()],
            knowledge_count: 0,
            knowledge_governance: default_governance(),
            decision_engine: DecisionEngine::AdminOnly {
                admin: owner.pubkey(),
            },
            created_at: 0,
            bump: circle_bump,
            flags: 0,
            status: CircleLifecycleStatus::Active,
        })),
    );

    let context = program_test.start_with_context().await;

    let archive_ix = Instruction {
        program_id,
        accounts: vec![
            AccountMeta::new_readonly(circle_manager_pda, false),
            AccountMeta::new(circle_pda, false),
            AccountMeta::new(owner.pubkey(), true),
            AccountMeta::new_readonly(event_program, false),
            AccountMeta::new(event_emitter.pubkey(), false),
            AccountMeta::new(event_batch.pubkey(), false),
            AccountMeta::new_readonly(system_program::ID, false),
        ],
        data: archive_instruction_data("demo cleanup".to_string()),
    };

    let archive_tx = Transaction::new_signed_with_payer(
        &[archive_ix],
        Some(&context.payer.pubkey()),
        &[&context.payer, &owner],
        context.last_blockhash,
    );
    context
        .banks_client
        .process_transaction(archive_tx)
        .await
        .expect("owner archive should succeed");

    let archived_circle_account = context
        .banks_client
        .get_account(circle_pda)
        .await
        .expect("circle lookup should succeed")
        .expect("circle should exist");
    let archived_circle: Circle = deserialize_anchor_account(&archived_circle_account.data);
    assert_eq!(archived_circle.status, CircleLifecycleStatus::Archived);

    let emitter_after_archive = context
        .banks_client
        .get_account(event_emitter.pubkey())
        .await
        .expect("event emitter lookup should succeed")
        .expect("event emitter should exist");
    assert_eq!(read_mock_event_sequence(&emitter_after_archive.data), 1);

    let restore_ix = Instruction {
        program_id,
        accounts: vec![
            AccountMeta::new_readonly(circle_manager_pda, false),
            AccountMeta::new(circle_pda, false),
            AccountMeta::new(owner.pubkey(), true),
            AccountMeta::new_readonly(event_program, false),
            AccountMeta::new(event_emitter.pubkey(), false),
            AccountMeta::new(event_batch.pubkey(), false),
            AccountMeta::new_readonly(system_program::ID, false),
        ],
        data: instruction_discriminator("restore_circle"),
    };

    let blockhash = context
        .banks_client
        .get_latest_blockhash()
        .await
        .expect("latest blockhash should be available");
    let restore_tx = Transaction::new_signed_with_payer(
        &[restore_ix],
        Some(&context.payer.pubkey()),
        &[&context.payer, &owner],
        blockhash,
    );
    context
        .banks_client
        .process_transaction(restore_tx)
        .await
        .expect("owner restore should succeed");

    let restored_circle_account = context
        .banks_client
        .get_account(circle_pda)
        .await
        .expect("circle lookup should succeed")
        .expect("circle should exist");
    let restored_circle: Circle = deserialize_anchor_account(&restored_circle_account.data);
    assert_eq!(restored_circle.status, CircleLifecycleStatus::Active);

    let emitter_after_restore = context
        .banks_client
        .get_account(event_emitter.pubkey())
        .await
        .expect("event emitter lookup should succeed")
        .expect("event emitter should exist");
    assert_eq!(read_mock_event_sequence(&emitter_after_restore.data), 2);
}

#[tokio::test]
async fn circle_manager_admin_can_archive_non_owned_circle() {
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

    let admin = Keypair::new();
    let owner = Keypair::new();
    let event_emitter = Keypair::new();
    let event_batch = Keypair::new();

    program_test.add_account(admin.pubkey(), system_account(20_000_000_000));
    program_test.add_account(owner.pubkey(), system_account(20_000_000_000));
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

    let circle_id = 18u8;
    let (circle_pda, circle_bump) =
        Pubkey::find_program_address(&[b"circle", &[circle_id]], &program_id);
    let (circle_manager_pda, manager_bump) =
        Pubkey::find_program_address(&[b"circle_manager"], &program_id);

    program_test.add_account(
        circle_manager_pda,
        program_owned_account(serialize_anchor_account(&CircleManager {
            bump: manager_bump,
            admin: admin.pubkey(),
            created_at: 0,
            total_circles: 1,
            total_knowledge: 0,
            total_transfers: 0,
        })),
    );
    program_test.add_account(
        circle_pda,
        program_owned_account(serialize_anchor_account(&Circle {
            circle_id,
            name: "admin-override".to_string(),
            level: 1,
            parent_circle: None,
            child_circles: vec![],
            curators: vec![owner.pubkey()],
            knowledge_count: 0,
            knowledge_governance: default_governance(),
            decision_engine: DecisionEngine::AdminOnly {
                admin: owner.pubkey(),
            },
            created_at: 0,
            bump: circle_bump,
            flags: 0,
            status: CircleLifecycleStatus::Active,
        })),
    );

    let context = program_test.start_with_context().await;
    let tx = Transaction::new_signed_with_payer(
        &[Instruction {
            program_id,
            accounts: vec![
                AccountMeta::new_readonly(circle_manager_pda, false),
                AccountMeta::new(circle_pda, false),
                AccountMeta::new(admin.pubkey(), true),
                AccountMeta::new_readonly(event_program, false),
                AccountMeta::new(event_emitter.pubkey(), false),
                AccountMeta::new(event_batch.pubkey(), false),
                AccountMeta::new_readonly(system_program::ID, false),
            ],
            data: archive_instruction_data("ops override".to_string()),
        }],
        Some(&context.payer.pubkey()),
        &[&context.payer, &admin],
        context.last_blockhash,
    );
    context
        .banks_client
        .process_transaction(tx)
        .await
        .expect("global admin should archive any circle");

    let archived_circle_account = context
        .banks_client
        .get_account(circle_pda)
        .await
        .expect("circle lookup should succeed")
        .expect("circle should exist");
    let archived_circle: Circle = deserialize_anchor_account(&archived_circle_account.data);
    assert_eq!(archived_circle.status, CircleLifecycleStatus::Archived);
}

#[tokio::test]
async fn non_owner_curator_cannot_archive_circle() {
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

    let admin = Keypair::new();
    let owner = Keypair::new();
    let curator = Keypair::new();
    let event_emitter = Keypair::new();
    let event_batch = Keypair::new();

    program_test.add_account(admin.pubkey(), system_account(20_000_000_000));
    program_test.add_account(owner.pubkey(), system_account(20_000_000_000));
    program_test.add_account(curator.pubkey(), system_account(20_000_000_000));
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

    let circle_id = 19u8;
    let (circle_pda, circle_bump) =
        Pubkey::find_program_address(&[b"circle", &[circle_id]], &program_id);
    let (circle_manager_pda, manager_bump) =
        Pubkey::find_program_address(&[b"circle_manager"], &program_id);

    program_test.add_account(
        circle_manager_pda,
        program_owned_account(serialize_anchor_account(&CircleManager {
            bump: manager_bump,
            admin: admin.pubkey(),
            created_at: 0,
            total_circles: 1,
            total_knowledge: 0,
            total_transfers: 0,
        })),
    );
    program_test.add_account(
        circle_pda,
        program_owned_account(serialize_anchor_account(&Circle {
            circle_id,
            name: "curator-reject".to_string(),
            level: 1,
            parent_circle: None,
            child_circles: vec![],
            curators: vec![owner.pubkey(), curator.pubkey()],
            knowledge_count: 0,
            knowledge_governance: default_governance(),
            decision_engine: DecisionEngine::AdminOnly {
                admin: owner.pubkey(),
            },
            created_at: 0,
            bump: circle_bump,
            flags: 0,
            status: CircleLifecycleStatus::Active,
        })),
    );

    let context = program_test.start_with_context().await;
    let tx = Transaction::new_signed_with_payer(
        &[Instruction {
            program_id,
            accounts: vec![
                AccountMeta::new_readonly(circle_manager_pda, false),
                AccountMeta::new(circle_pda, false),
                AccountMeta::new(curator.pubkey(), true),
                AccountMeta::new_readonly(event_program, false),
                AccountMeta::new(event_emitter.pubkey(), false),
                AccountMeta::new(event_batch.pubkey(), false),
                AccountMeta::new_readonly(system_program::ID, false),
            ],
            data: archive_instruction_data("curator should fail".to_string()),
        }],
        Some(&context.payer.pubkey()),
        &[&context.payer, &curator],
        context.last_blockhash,
    );
    let error = context
        .banks_client
        .process_transaction(tx)
        .await
        .expect_err("non-owner curator must not archive circle");
    assert_invalid_operation(error);
}

#[tokio::test]
async fn archived_circle_rejects_join_but_allows_leave() {
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
    let event_emitter = Keypair::new();
    let event_batch = Keypair::new();
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

    let circle_id = 20u8;
    let (circle_pda, circle_bump) =
        Pubkey::find_program_address(&[b"circle", &[circle_id]], &program_id);
    program_test.add_account(
        circle_pda,
        program_owned_account(serialize_anchor_account(&Circle {
            circle_id,
            name: "archived-join".to_string(),
            level: 1,
            parent_circle: None,
            child_circles: vec![],
            curators: vec![Pubkey::new_unique()],
            knowledge_count: 0,
            knowledge_governance: default_governance(),
            decision_engine: DecisionEngine::AdminOnly {
                admin: Pubkey::new_unique(),
            },
            created_at: 0,
            bump: circle_bump,
            flags: 0,
            status: CircleLifecycleStatus::Archived,
        })),
    );

    let (join_member_pda, join_member_bump) = Pubkey::find_program_address(
        &[
            b"circle_member",
            circle_pda.as_ref(),
            member.pubkey().as_ref(),
        ],
        &program_id,
    );
    program_test.add_account(
        join_member_pda,
        program_owned_account(serialize_anchor_account(&CircleMemberAccount {
            circle_id,
            member: member.pubkey(),
            status: CircleMemberStatus::Inactive,
            role: CircleMemberRole::Member,
            joined_at: 1_700_000_000,
            updated_at: 1_700_000_000,
            bump: join_member_bump,
        })),
    );

    let leave_member = Keypair::new();
    let (leave_member_pda, leave_member_bump) = Pubkey::find_program_address(
        &[
            b"circle_member",
            circle_pda.as_ref(),
            leave_member.pubkey().as_ref(),
        ],
        &program_id,
    );
    program_test.add_account(leave_member.pubkey(), system_account(20_000_000_000));
    program_test.add_account(
        leave_member_pda,
        program_owned_account(serialize_anchor_account(&CircleMemberAccount {
            circle_id,
            member: leave_member.pubkey(),
            status: CircleMemberStatus::Active,
            role: CircleMemberRole::Member,
            joined_at: 1_700_000_000,
            updated_at: 1_700_000_000,
            bump: leave_member_bump,
        })),
    );

    let context = program_test.start_with_context().await;

    let join_tx = Transaction::new_signed_with_payer(
        &[Instruction {
            program_id,
            accounts: vec![
                AccountMeta::new_readonly(circle_pda, false),
                AccountMeta::new(join_member_pda, false),
                AccountMeta::new(member.pubkey(), true),
                AccountMeta::new_readonly(event_program, false),
                AccountMeta::new(event_emitter.pubkey(), false),
                AccountMeta::new(event_batch.pubkey(), false),
                AccountMeta::new_readonly(system_program::ID, false),
            ],
            data: instruction_discriminator("join_circle"),
        }],
        Some(&context.payer.pubkey()),
        &[&context.payer, &member],
        context.last_blockhash,
    );
    let join_error = context
        .banks_client
        .process_transaction(join_tx)
        .await
        .expect_err("archived circle must reject join");
    assert_circle_archived(join_error);

    let leave_blockhash = context
        .banks_client
        .get_latest_blockhash()
        .await
        .expect("latest blockhash should be available");
    let leave_tx = Transaction::new_signed_with_payer(
        &[Instruction {
            program_id,
            accounts: vec![
                AccountMeta::new_readonly(circle_pda, false),
                AccountMeta::new(leave_member_pda, false),
                AccountMeta::new(leave_member.pubkey(), true),
                AccountMeta::new_readonly(event_program, false),
                AccountMeta::new(event_emitter.pubkey(), false),
                AccountMeta::new(event_batch.pubkey(), false),
                AccountMeta::new_readonly(system_program::ID, false),
            ],
            data: instruction_discriminator("leave_circle"),
        }],
        Some(&context.payer.pubkey()),
        &[&context.payer, &leave_member],
        leave_blockhash,
    );
    context
        .banks_client
        .process_transaction(leave_tx)
        .await
        .expect("archived circle should still allow leave");

    let leave_member_account = context
        .banks_client
        .get_account(leave_member_pda)
        .await
        .expect("member lookup should succeed")
        .expect("member account should exist");
    let updated_member: CircleMemberAccount =
        deserialize_anchor_account(&leave_member_account.data);
    assert_eq!(updated_member.status, CircleMemberStatus::Inactive);
}

fn instruction_discriminator(name: &str) -> Vec<u8> {
    use anchor_lang::solana_program::hash::hash;

    hash(format!("global:{name}").as_bytes()).to_bytes()[..8].to_vec()
}

fn archive_instruction_data(reason: String) -> Vec<u8> {
    let mut data = instruction_discriminator("archive_circle");
    data.extend(
        reason
            .try_to_vec()
            .expect("archive reason should serialize"),
    );
    data
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

fn assert_circle_archived(error: BanksClientError) {
    match error {
        BanksClientError::TransactionError(TransactionError::InstructionError(
            _,
            InstructionError::Custom(code),
        )) => {
            assert_eq!(
                code, CIRCLE_ARCHIVED_ERROR_CODE,
                "expected CircleArchived(12014 runtime code), got {code}",
            );
        }
        other => panic!("expected custom CircleArchived error, got {other:?}"),
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
    let event_emitter = accounts.first().ok_or(ProgramError::NotEnoughAccountKeys)?;
    let mut data = event_emitter.try_borrow_mut_data()?;
    if data.len() < EVENT_EMITTER_MIN_DATA_SIZE {
        return Err(ProgramError::InvalidAccountData);
    }
    let mut sequence_bytes = [0u8; 8];
    sequence_bytes
        .copy_from_slice(&data[EVENT_EMITTER_SEQUENCE_OFFSET..EVENT_EMITTER_SEQUENCE_OFFSET + 8]);
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

fn read_mock_event_sequence(data: &[u8]) -> u64 {
    let mut sequence_bytes = [0u8; 8];
    sequence_bytes
        .copy_from_slice(&data[EVENT_EMITTER_SEQUENCE_OFFSET..EVENT_EMITTER_SEQUENCE_OFFSET + 8]);
    u64::from_le_bytes(sequence_bytes)
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
