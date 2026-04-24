use alcheme_shared::CircleLifecycleStatus;
use anchor_lang::solana_program::{account_info::AccountInfo, entrypoint::ProgramResult};
use anchor_lang::system_program;
use anchor_lang::{AccountDeserialize, AccountSerialize, InstructionData, ToAccountMetas};
use circle_manager::{
    accounts as circle_accounts, instruction as circle_instructions, Circle, CircleForkAnchor,
    DecisionEngine, KnowledgeGovernance,
};
use solana_program_test::{processor, ProgramTest};
use solana_sdk::{
    account::Account,
    instruction::Instruction,
    pubkey::Pubkey,
    signature::{Keypair, Signer},
    transaction::Transaction,
};

#[test]
fn fork_anchor_state_carries_the_frozen_minimum_fields() {
    let anchor = CircleForkAnchor {
        source_circle_id: 7,
        target_circle_id: 71,
        fork_declaration_digest: [0x44; 32],
        created_at: 1_763_900_000,
        bump: 9,
    };

    assert_eq!(anchor.source_circle_id, 7);
    assert_eq!(anchor.target_circle_id, 71);
    assert_eq!(anchor.fork_declaration_digest, [0x44; 32]);
}

#[tokio::test]
async fn anchor_circle_fork_persists_sidecar_for_existing_target_circle() {
    let program_id = circle_manager::id();
    let mut program_test = ProgramTest::new(
        "circle_manager",
        program_id,
        processor!(process_instruction),
    );

    let authority = Keypair::new();
    program_test.add_account(authority.pubkey(), system_account(10_000_000_000));

    let source_circle_id = 7u8;
    let target_circle_id = 71u8;
    let (source_circle_pda, source_bump) =
        Pubkey::find_program_address(&[b"circle", &[source_circle_id]], &program_id);
    let (target_circle_pda, target_bump) =
        Pubkey::find_program_address(&[b"circle", &[target_circle_id]], &program_id);
    let (fork_anchor_pda, _fork_anchor_bump) =
        Pubkey::find_program_address(&[b"circle_fork_anchor", &[target_circle_id]], &program_id);

    program_test.add_account(
        source_circle_pda,
        program_owned_account(serialize_anchor_account(&Circle {
            circle_id: source_circle_id,
            name: "source-circle".to_string(),
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
            bump: source_bump,
            flags: 0,
            status: CircleLifecycleStatus::Active,
        })),
    );
    program_test.add_account(
        target_circle_pda,
        program_owned_account(serialize_anchor_account(&Circle {
            circle_id: target_circle_id,
            name: "forked-circle".to_string(),
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
            bump: target_bump,
            flags: 0,
            status: CircleLifecycleStatus::Active,
        })),
    );

    let context = program_test.start_with_context().await;
    let instruction = Instruction {
        program_id,
        accounts: circle_accounts::AnchorCircleFork {
            source_circle: source_circle_pda,
            target_circle: target_circle_pda,
            fork_anchor: fork_anchor_pda,
            authority: authority.pubkey(),
            system_program: system_program::ID,
        }
        .to_account_metas(None),
        data: circle_instructions::AnchorCircleFork {
            source_circle_id,
            target_circle_id,
            fork_declaration_digest: [0x44; 32],
        }
        .data(),
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
        .expect("anchor_circle_fork should succeed");

    let fork_anchor_account = context
        .banks_client
        .get_account(fork_anchor_pda)
        .await
        .expect("fork anchor account lookup should succeed")
        .expect("fork anchor account should exist");
    let anchor = deserialize_anchor_account::<CircleForkAnchor>(&fork_anchor_account.data);

    assert_eq!(anchor.source_circle_id, source_circle_id);
    assert_eq!(anchor.target_circle_id, target_circle_id);
    assert_eq!(anchor.fork_declaration_digest, [0x44; 32]);
}

fn process_instruction<'a, 'b, 'c, 'd>(
    program_id: &'a Pubkey,
    accounts: &'b [AccountInfo<'c>],
    instruction_data: &'d [u8],
) -> ProgramResult {
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
        max_transfers_per_day: 10,
        require_peer_review: false,
        peer_review_count: 0,
        auto_quality_check: false,
    }
}
