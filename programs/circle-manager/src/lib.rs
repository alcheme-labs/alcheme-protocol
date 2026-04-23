use anchor_lang::prelude::*;
use alcheme_shared::{
    types::*, errors::*, constants::*, utils::*, validation::*,
    events::*, access::*, content::*, factory::*
};

pub mod instructions;
pub mod state;

pub use instructions::*;
pub use state::*;

declare_id!("GZswb1rGbZfoiapkvatDuMZrptVAX2p1pEVDSrMuyLqQ");

#[program]
pub mod circle_manager {
    use super::*;

    /// 初始化圈层管理器
    pub fn initialize(ctx: Context<Initialize>) -> Result<()> {
        instructions::initialize(ctx)
    }

    /// 创建圈层
    pub fn create_circle(
        ctx: Context<CreateCircle>,
        circle_id: u8,
        name: String,
        level: u8,
        parent_circle: Option<u8>,
        knowledge_governance: KnowledgeGovernance,
        decision_engine: DecisionEngine,
    ) -> Result<()> {
        instructions::create_circle(ctx, circle_id, name, level, parent_circle, knowledge_governance, decision_engine)
    }

    pub fn anchor_circle_fork(
        ctx: Context<AnchorCircleFork>,
        source_circle_id: u8,
        target_circle_id: u8,
        fork_declaration_digest: [u8; 32],
    ) -> Result<()> {
        instructions::anchor_circle_fork(
            ctx,
            source_circle_id,
            target_circle_id,
            fork_declaration_digest,
        )
    }

    /// 添加策展人（通过AccessController验证）
    pub fn add_curator(
        ctx: Context<AddCurator>,
        curator: Pubkey,
    ) -> Result<()> {
        instructions::add_curator(ctx, curator)
    }

    pub fn join_circle(
        ctx: Context<JoinCircle>,
    ) -> Result<()> {
        instructions::join_circle(ctx)
    }

    pub fn leave_circle(
        ctx: Context<LeaveCircle>,
    ) -> Result<()> {
        instructions::leave_circle(ctx)
    }

    pub fn add_circle_member(
        ctx: Context<AddCircleMember>,
        role: CircleMemberRole,
    ) -> Result<()> {
        instructions::add_circle_member(ctx, role)
    }

    pub fn remove_circle_member(
        ctx: Context<RemoveCircleMember>,
    ) -> Result<()> {
        instructions::remove_circle_member(ctx)
    }

    pub fn update_circle_member_role(
        ctx: Context<UpdateCircleMemberRole>,
        role: CircleMemberRole,
    ) -> Result<()> {
        instructions::update_circle_member_role(ctx, role)
    }

    pub fn claim_circle_membership(
        ctx: Context<ClaimCircleMembership>,
        admission: CircleMembershipAdmission,
        issuer_key_id: Pubkey,
        issued_signature: [u8; 64],
    ) -> Result<()> {
        instructions::claim_circle_membership(ctx, admission, issuer_key_id, issued_signature)
    }

    /// 提交知识到圈层（curator-only）
    pub fn submit_knowledge(
        ctx: Context<SubmitKnowledge>,
        ipfs_cid: String,
        content_hash: [u8; 32],
        title: String,
        description: String,
    ) -> Result<()> {
        instructions::submit_knowledge(ctx, ipfs_cid, content_hash, title, description)
    }

    /// 提议知识传递
    pub fn propose_transfer(
        ctx: Context<ProposeTransfer>,
        knowledge_id: [u8; 32],
        to_circles: Vec<u8>,
        transfer_type: TransferType,
    ) -> Result<()> {
        instructions::propose_transfer(ctx, knowledge_id, to_circles, transfer_type)
    }

    /// 投票
    pub fn vote(
        ctx: Context<Vote>,
        vote_for: bool,
    ) -> Result<()> {
        instructions::vote(ctx, vote_for)
    }

    /// AI提交评估
    pub fn submit_ai_evaluation(
        ctx: Context<SubmitAIEvaluation>,
        evaluation: AIEvaluation,
    ) -> Result<()> {
        instructions::submit_ai_evaluation(ctx, evaluation)
    }

    /// 执行已批准的传递
    pub fn execute_transfer(
        ctx: Context<ExecuteTransfer>,
    ) -> Result<()> {
        instructions::execute_transfer(ctx)
    }

    /// 更新决策引擎
    pub fn update_decision_engine(
        ctx: Context<UpdateDecisionEngine>,
        new_engine: DecisionEngine,
    ) -> Result<()> {
        instructions::update_decision_engine(ctx, new_engine)
    }

    /// 更新圈层 flags 位字段（kind/mode/min_crystals 等）
    pub fn update_circle_flags(
        ctx: Context<UpdateCircleFlags>,
        flags: u64,
    ) -> Result<()> {
        instructions::update_circle_flags(ctx, flags)
    }

    /// 初始化贡献证明签发者注册表
    pub fn initialize_proof_attestor_registry(
        ctx: Context<InitializeProofAttestorRegistry>,
    ) -> Result<()> {
        instructions::initialize_proof_attestor_registry(ctx)
    }

    /// 注册贡献证明签发者（admin-only）
    pub fn register_proof_attestor(
        ctx: Context<RegisterProofAttestor>,
        attestor: Pubkey,
    ) -> Result<()> {
        instructions::register_proof_attestor(ctx, attestor)
    }

    /// 绑定贡献证明（创建 KnowledgeBinding PDA）
    pub fn bind_contributor_proof(
        ctx: Context<BindContributorProof>,
        source_anchor_id: [u8; 32],
        proof_package_hash: [u8; 32],
        contributors_root: [u8; 32],
        contributors_count: u16,
        binding_version: u16,
        generated_at: i64,
        issuer_key_id: Pubkey,
        issued_signature: [u8; 64],
    ) -> Result<()> {
        instructions::bind_contributor_proof(
            ctx,
            source_anchor_id,
            proof_package_hash,
            contributors_root,
            contributors_count,
            binding_version,
            generated_at,
            issuer_key_id,
            issued_signature,
        )
    }

    /// 严格主路径：原子执行 proof 绑定与 contributors 更新
    pub fn bind_and_update_contributors(
        ctx: Context<BindAndUpdateContributors>,
        source_anchor_id: [u8; 32],
        proof_package_hash: [u8; 32],
        contributors_root: [u8; 32],
        contributors_count: u16,
        binding_version: u16,
        generated_at: i64,
        issuer_key_id: Pubkey,
        issued_signature: [u8; 64],
    ) -> Result<()> {
        instructions::bind_and_update_contributors(
            ctx,
            source_anchor_id,
            proof_package_hash,
            contributors_root,
            contributors_count,
            binding_version,
            generated_at,
            issuer_key_id,
            issued_signature,
        )
    }

    /// 兼容路径：在已绑定前提下更新 contributors
    pub fn update_contributors(
        ctx: Context<UpdateContributors>,
        proof_package_hash: [u8; 32],
        contributors_root: [u8; 32],
        contributors_count: u16,
    ) -> Result<()> {
        instructions::update_contributors(
            ctx,
            proof_package_hash,
            contributors_root,
            contributors_count,
        )
    }

    // ==================== Extension CPI 接口 ====================

    /// 通过扩展程序提升知识评分（需要 CircleExtend 权限 + circle/knowledge 关系一致）
    pub fn cpi_promote_knowledge(
        ctx: Context<CpiPromoteKnowledge>,
        quality_delta: f64,
        reason: String,
    ) -> Result<()> {
        instructions::cpi_promote_knowledge(ctx, quality_delta, reason)
    }
}
