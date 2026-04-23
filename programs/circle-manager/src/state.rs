use anchor_lang::prelude::*;
use alcheme_shared::*;

/// 圈层管理器
#[account]
pub struct CircleManager {
    pub bump: u8,
    pub admin: Pubkey,
    pub created_at: i64,
    pub total_circles: u64,
    pub total_knowledge: u64,
    pub total_transfers: u64,
}

/// 圈层（专注知识治理）
#[account]
pub struct Circle {
    pub circle_id: u8,
    pub name: String,
    pub level: u8,
    pub parent_circle: Option<u8>,
    pub child_circles: Vec<u8>,
    pub curators: Vec<Pubkey>,              // 策展人（知识管理者）
    pub knowledge_count: u64,
    pub knowledge_governance: KnowledgeGovernance,  // 知识治理配置
    pub decision_engine: DecisionEngine,    // 决策引擎（AI/投票）
    pub created_at: i64,
    pub bump: u8,
    /// 通用位标志字段，用于存储可扩展的圈层属性
    /// ┌─────────┬─────────┬──────────────┬──────────────────┐
    /// │ bit 0   │ bit 1   │ bit 2-17     │ bit 18-63        │
    /// │ kind    │ mode    │ min_crystals │ reserved         │
    /// │ 0=main  │ 0=know  │ u16 (0-65535)│                  │
    /// │ 1=aux   │ 1=social│              │                  │
    /// └─────────┴─────────┴──────────────┴──────────────────┘
    pub flags: u64,
}

/// Fork 轻锚点 sidecar（避免把 live parent 依赖灌回 Circle 主账户）
#[account]
pub struct CircleForkAnchor {
    pub source_circle_id: u8,
    pub target_circle_id: u8,
    pub fork_declaration_digest: [u8; 32],
    pub created_at: i64,
    pub bump: u8,
}

#[account]
pub struct CircleMemberAccount {
    pub circle_id: u8,
    pub member: Pubkey,
    pub status: CircleMemberStatus,
    pub role: CircleMemberRole,
    pub joined_at: i64,
    pub updated_at: i64,
    pub bump: u8,
}

/// 知识条目
#[account]
pub struct Knowledge {
    pub knowledge_id: [u8; 32],
    pub circle_id: u8,
    pub ipfs_cid: String,
    /// SHA-256 hash of the crystallized IPFS content, for integrity verification.
    /// Computed client-side as sha256(ipfs_content) before submission.
    pub content_hash: [u8; 32],
    pub title: String,
    pub description: String,
    pub author: Pubkey,
    pub quality_score: f64,
    pub source_circle: Option<u8>,
    pub created_at: i64,
    pub view_count: u64,
    pub citation_count: u64,
    pub bump: u8,
    /// 通用位标志字段
    /// ┌──────────────┬──────────────────────────────────────┐
    /// │ bit 0-15     │ bit 16-63                            │
    /// │ version (u16)│ reserved                             │
    /// └──────────────┴──────────────────────────────────────┘
    pub flags: u64,
    /// Merkle root of contributors tree.
    /// Each leaf = hash(user_pubkey | role_u8 | weight_u16)
    pub contributors_root: [u8; 32],
    /// Total number of contributors (informational, not enforced by Merkle)
    pub contributors_count: u16,
}

/// 知识贡献证明绑定（Knowledge 1:1 sidecar）
#[account]
pub struct KnowledgeBinding {
    pub knowledge: Pubkey,
    pub source_anchor_id: [u8; 32],
    pub proof_package_hash: [u8; 32],
    pub contributors_root: [u8; 32],
    pub contributors_count: u16,
    pub binding_version: u16,
    pub generated_at: i64,
    pub bound_at: i64,
    pub bound_by: Pubkey,
    pub bump: u8,
}

/// 贡献证明签发者注册表（admin 管理）
#[account]
pub struct ProofAttestorRegistry {
    pub bump: u8,
    pub admin: Pubkey,
    pub attestors: Vec<Pubkey>,
    pub created_at: i64,
    pub last_updated: i64,
}

/// 成员准入签发者注册表（admin 管理）
#[account]
pub struct MembershipAttestorRegistry {
    pub bump: u8,
    pub admin: Pubkey,
    pub attestors: Vec<Pubkey>,
    pub created_at: i64,
    pub last_updated: i64,
}

/// 传递提案
#[account]
pub struct TransferProposal {
    pub proposal_id: u64,
    pub knowledge_id: [u8; 32],
    pub from_circle: u8,
    pub to_circles: Vec<u8>,
    pub transfer_type: TransferType,
    pub proposer: Pubkey,
    pub status: ProposalStatus,
    pub decision_engine: DecisionEngine,
    pub votes_for: u64,
    pub votes_against: u64,
    pub voters: Vec<Pubkey>,
    pub ai_evaluation: Option<AIEvaluation>,
    pub created_at: i64,
    pub deadline: Option<i64>,
    pub bump: u8,
}

/// 知识治理配置（专注知识管理）
#[derive(AnchorSerialize, AnchorDeserialize, Clone, Debug, PartialEq)]
pub struct KnowledgeGovernance {
    pub min_quality_score: f64,         // 最低质量分数
    pub min_curator_reputation: u64,    // 策展人最低声誉
    pub transfer_cooldown: i64,         // 传递冷却期（秒）
    pub max_transfers_per_day: u32,     // 每日最大传递数
    pub require_peer_review: bool,      // 是否需要同行评审
    pub peer_review_count: u8,          // 需要评审人数
    pub auto_quality_check: bool,       // 自动质量检查
}

/// 决策引擎
#[derive(AnchorSerialize, AnchorDeserialize, Clone, Debug, PartialEq)]
pub enum DecisionEngine {
    AdminOnly { admin: Pubkey },
    VotingGovernance { min_votes: u64, vote_duration: i64, quorum_percentage: u8 },
    DaoGovernance { dao_program: Pubkey, proposal_threshold: u64 },
    AIAssisted { ai_oracle: Pubkey, human_veto_threshold: u64, confidence_required: f64 },
    FullyAutonomous { ai_model_hash: [u8; 32], mcp_endpoint: String, fallback_to_dao: bool },
}

/// 传递类型
#[derive(AnchorSerialize, AnchorDeserialize, Clone, Debug, PartialEq)]
pub enum TransferType {
    Upward,
    Downward,
    Horizontal,
}

/// 提案状态
#[derive(AnchorSerialize, AnchorDeserialize, Clone, Debug, PartialEq)]
pub enum ProposalStatus {
    Pending,
    Approved,
    Rejected,
    AIProcessing,
    HumanReview,
    Executed,
}

/// AI评估
#[derive(AnchorSerialize, AnchorDeserialize, Clone, Debug, PartialEq)]
pub struct AIEvaluation {
    pub quality_score: f64,
    pub relevance_score: f64,
    pub novelty_score: f64,
    pub recommendation: AIRecommendation,
    pub confidence: f64,
    pub reasoning: String,
    pub model_version: String,
    pub timestamp: i64,
}

#[derive(AnchorSerialize, AnchorDeserialize, Clone, Debug, PartialEq)]
pub enum AIRecommendation {
    ApproveUpward,
    ApproveDownward,
    Reject,
    NeedHumanReview,
}


// 空间计算
impl CircleManager {
    pub const SPACE: usize = 8 + 1 + 32 + 8 + 8 + 8 + 8;
}

impl Circle {
    pub const SPACE: usize = 
        8 + 1 + 4 + 64 + 1 + 1 + 4 + 10 + 
        4 + 20 * 32 + 8 + 120 + 200 + 8 + 1
        + 8;  // flags
}

impl CircleMemberAccount {
    pub const SPACE: usize =
        8 +  // discriminator
        1 +  // circle_id
        32 + // member
        1 +  // status
        1 +  // role
        8 +  // joined_at
        8 +  // updated_at
        1;   // bump

    pub fn initialize(
        &mut self,
        circle_id: u8,
        member: Pubkey,
        role: CircleMemberRole,
        bump: u8,
    ) -> Result<()> {
        let now = Clock::get()?.unix_timestamp;
        self.circle_id = circle_id;
        self.member = member;
        self.status = CircleMemberStatus::Active;
        self.role = role;
        self.joined_at = now;
        self.updated_at = now;
        self.bump = bump;
        Ok(())
    }

    pub fn activate(&mut self) -> Result<()> {
        self.status = CircleMemberStatus::Active;
        self.updated_at = Clock::get()?.unix_timestamp;
        Ok(())
    }

    pub fn deactivate(&mut self) -> Result<()> {
        self.status = CircleMemberStatus::Inactive;
        self.updated_at = Clock::get()?.unix_timestamp;
        Ok(())
    }

    pub fn update_role(&mut self, role: CircleMemberRole) -> Result<()> {
        self.role = role;
        self.updated_at = Clock::get()?.unix_timestamp;
        Ok(())
    }
}

impl CircleForkAnchor {
    pub const SPACE: usize =
        8 +  // discriminator
        1 +  // source_circle_id
        1 +  // target_circle_id
        32 + // fork_declaration_digest
        8 +  // created_at
        1;   // bump

    pub fn initialize(
        &mut self,
        source_circle_id: u8,
        target_circle_id: u8,
        fork_declaration_digest: [u8; 32],
        bump: u8,
    ) -> Result<()> {
        self.source_circle_id = source_circle_id;
        self.target_circle_id = target_circle_id;
        self.fork_declaration_digest = fork_declaration_digest;
        self.created_at = Clock::get()?.unix_timestamp;
        self.bump = bump;
        Ok(())
    }
}

impl Knowledge {
    pub const SPACE: usize = 
        8 + 32 + 1 + 4 + 256 + 4 + 128 + 4 + 256 + 32 +
        8 + 1 + 8 + 8 + 8 + 1
        + 32   // content_hash
        + 8    // flags
        + 32   // contributors_root
        + 2;   // contributors_count
}

impl KnowledgeBinding {
    pub const SPACE: usize =
        8 +  // discriminator
        32 + // knowledge
        32 + // source_anchor_id
        32 + // proof_package_hash
        32 + // contributors_root
        2 +  // contributors_count
        2 +  // binding_version
        8 +  // generated_at
        8 +  // bound_at
        32 + // bound_by
        1;   // bump

    pub fn initialize(
        &mut self,
        knowledge: Pubkey,
        source_anchor_id: [u8; 32],
        proof_package_hash: [u8; 32],
        contributors_root: [u8; 32],
        contributors_count: u16,
        binding_version: u16,
        generated_at: i64,
        bound_by: Pubkey,
        bump: u8,
    ) -> Result<()> {
        self.knowledge = knowledge;
        self.source_anchor_id = source_anchor_id;
        self.proof_package_hash = proof_package_hash;
        self.contributors_root = contributors_root;
        self.contributors_count = contributors_count;
        self.binding_version = binding_version;
        self.generated_at = generated_at;
        self.bound_at = Clock::get()?.unix_timestamp;
        self.bound_by = bound_by;
        self.bump = bump;
        Ok(())
    }
}

impl ProofAttestorRegistry {
    pub const MAX_ATTESTORS: usize = 32;
    pub const SPACE: usize =
        8 +  // discriminator
        1 +  // bump
        32 + // admin
        4 + (32 * Self::MAX_ATTESTORS) + // attestors vec
        8 +  // created_at
        8;   // last_updated

    pub fn initialize(&mut self, bump: u8, admin: Pubkey) -> Result<()> {
        let now = Clock::get()?.unix_timestamp;
        self.bump = bump;
        self.admin = admin;
        self.attestors = Vec::new();
        self.created_at = now;
        self.last_updated = now;
        Ok(())
    }

    pub fn register_attestor(&mut self, attestor: Pubkey) -> Result<()> {
        require!(
            !self.attestors.contains(&attestor),
            AlchemeError::InvalidOperation
        );
        require!(
            self.attestors.len() < Self::MAX_ATTESTORS,
            AlchemeError::InvalidOperation
        );
        self.attestors.push(attestor);
        self.last_updated = Clock::get()?.unix_timestamp;
        Ok(())
    }

    pub fn is_registered(&self, attestor: &Pubkey) -> bool {
        self.attestors.contains(attestor)
    }
}

impl MembershipAttestorRegistry {
    pub const MAX_ATTESTORS: usize = 32;
    pub const SPACE: usize =
        8 +  // discriminator
        1 +  // bump
        32 + // admin
        4 + (32 * Self::MAX_ATTESTORS) + // attestors vec
        8 +  // created_at
        8;   // last_updated

    pub fn initialize(&mut self, bump: u8, admin: Pubkey) -> Result<()> {
        let now = Clock::get()?.unix_timestamp;
        self.bump = bump;
        self.admin = admin;
        self.attestors = Vec::new();
        self.created_at = now;
        self.last_updated = now;
        Ok(())
    }

    pub fn register_attestor(&mut self, attestor: Pubkey) -> Result<()> {
        require!(
            !self.attestors.contains(&attestor),
            AlchemeError::InvalidOperation
        );
        require!(
            self.attestors.len() < Self::MAX_ATTESTORS,
            AlchemeError::InvalidOperation
        );
        self.attestors.push(attestor);
        self.last_updated = Clock::get()?.unix_timestamp;
        Ok(())
    }

    pub fn revoke_attestor(&mut self, attestor: &Pubkey) -> Result<()> {
        let original_len = self.attestors.len();
        self.attestors.retain(|registered| registered != attestor);
        require!(
            self.attestors.len() != original_len,
            AlchemeError::InvalidOperation
        );
        self.last_updated = Clock::get()?.unix_timestamp;
        Ok(())
    }

    pub fn is_registered(&self, attestor: &Pubkey) -> bool {
        self.attestors.contains(attestor)
    }
}

impl TransferProposal {
    pub const SPACE: usize = 
        8 + 8 + 32 + 1 + 4 + 10 + 1 + 32 + 1 + 200 +
        8 + 8 + 4 + 100 * 32 + 400 + 8 + 9 + 1;
}

impl CircleManager {
    pub fn initialize(&mut self, bump: u8, admin: Pubkey) -> Result<()> {
        self.bump = bump;
        self.admin = admin;
        self.created_at = Clock::get()?.unix_timestamp;
        self.total_circles = 0;
        self.total_knowledge = 0;
        self.total_transfers = 0;
        Ok(())
    }
}

impl Circle {
    pub fn initialize(
        &mut self,
        circle_id: u8,
        name: String,
        level: u8,
        parent_circle: Option<u8>,
        knowledge_governance: KnowledgeGovernance,
        decision_engine: DecisionEngine,
        creator: Pubkey,
        bump: u8,
    ) -> Result<()> {
        self.circle_id = circle_id;
        self.name = name;
        self.level = level;
        self.parent_circle = parent_circle;
        self.child_circles = Vec::new();
        self.curators = vec![creator];
        self.knowledge_count = 0;
        self.knowledge_governance = knowledge_governance;
        self.decision_engine = decision_engine;
        self.created_at = Clock::get()?.unix_timestamp;
        self.bump = bump;
        self.flags = 0; // 默认: kind=main(0), mode=knowledge(0), min_crystals=0
        Ok(())
    }

    pub fn add_curator(&mut self, curator: Pubkey) -> Result<()> {
        require!(
            !self.curators.contains(&curator),
            AlchemeError::InvalidOperation
        );
        self.curators.push(curator);
        Ok(())
    }

    pub fn is_curator(&self, user: &Pubkey) -> bool {
        self.curators.contains(user)
    }
    
    pub fn can_curate_knowledge(&self, user: &Pubkey, user_reputation: u64) -> bool {
        self.is_curator(user) && user_reputation >= self.knowledge_governance.min_curator_reputation
    }

    // ==================== flags 位操作 helpers ====================

    /// kind: 0=main, 1=auxiliary
    pub fn kind(&self) -> u8 {
        (self.flags & 0x1) as u8
    }
    pub fn set_kind(&mut self, kind: u8) {
        self.flags = (self.flags & !0x1) | (kind as u64 & 0x1);
    }

    /// mode: 0=knowledge, 1=social
    pub fn mode(&self) -> u8 {
        ((self.flags >> 1) & 0x1) as u8
    }
    pub fn set_mode(&mut self, mode: u8) {
        self.flags = (self.flags & !(0x1 << 1)) | ((mode as u64 & 0x1) << 1);
    }

    /// min_crystals: bits 2-17 (u16, 0-65535)
    pub fn min_crystals(&self) -> u16 {
        ((self.flags >> 2) & 0xFFFF) as u16
    }
    pub fn set_min_crystals(&mut self, v: u16) {
        self.flags = (self.flags & !(0xFFFF << 2)) | ((v as u64) << 2);
    }
}

impl Knowledge {
    pub fn initialize(
        &mut self,
        knowledge_id: [u8; 32],
        circle_id: u8,
        ipfs_cid: String,
        content_hash: [u8; 32],
        title: String,
        description: String,
        author: Pubkey,
        bump: u8,
    ) -> Result<()> {
        self.knowledge_id = knowledge_id;
        self.circle_id = circle_id;
        self.ipfs_cid = ipfs_cid;
        self.content_hash = content_hash;
        self.title = title;
        self.description = description;
        self.author = author;
        self.quality_score = 0.5;
        self.source_circle = None;
        self.created_at = Clock::get()?.unix_timestamp;
        self.view_count = 0;
        self.citation_count = 0;
        self.bump = bump;
        self.flags = 1;  // version = 1 (初始版本)
        self.contributors_root = [0u8; 32];
        self.contributors_count = 0;
        Ok(())
    }

    // ==================== flags 位操作 helpers ====================

    /// version: bits 0-15 (u16)
    pub fn version(&self) -> u16 {
        (self.flags & 0xFFFF) as u16
    }
    pub fn set_version(&mut self, v: u16) {
        self.flags = (self.flags & !0xFFFF) | (v as u64);
    }
}

impl TransferProposal {
    pub fn initialize(
        &mut self,
        proposal_id: u64,
        knowledge_id: [u8; 32],
        from_circle: u8,
        to_circles: Vec<u8>,
        transfer_type: TransferType,
        proposer: Pubkey,
        decision_engine: DecisionEngine,
        bump: u8,
    ) -> Result<()> {
        self.proposal_id = proposal_id;
        self.knowledge_id = knowledge_id;
        self.from_circle = from_circle;
        self.to_circles = to_circles;
        self.transfer_type = transfer_type;
        self.proposer = proposer;
        self.decision_engine = decision_engine.clone();
        self.votes_for = 0;
        self.votes_against = 0;
        self.voters = Vec::new();
        self.ai_evaluation = None;
        self.created_at = Clock::get()?.unix_timestamp;
        
        self.status = match decision_engine {
            DecisionEngine::AIAssisted { .. } | DecisionEngine::FullyAutonomous { .. } => {
                ProposalStatus::AIProcessing
            },
            _ => ProposalStatus::Pending,
        };
        
        self.deadline = match decision_engine {
            DecisionEngine::VotingGovernance { vote_duration, .. } => {
                Some(self.created_at + vote_duration)
            },
            _ => None,
        };
        
        self.bump = bump;
        Ok(())
    }

    pub fn add_vote(&mut self, voter: Pubkey, vote_for: bool) -> Result<()> {
        require!(!self.voters.contains(&voter), AlchemeError::InvalidOperation);
        
        if vote_for {
            self.votes_for += 1;
        } else {
            self.votes_against += 1;
        }
        self.voters.push(voter);
        Ok(())
    }

    pub fn check_voting_result(&mut self) -> Result<()> {
        if let DecisionEngine::VotingGovernance { min_votes, quorum_percentage, .. } = &self.decision_engine {
            let total = self.votes_for + self.votes_against;
            if total >= *min_votes {
                let approval_rate = (self.votes_for * 100) / total;
                self.status = if approval_rate >= *quorum_percentage as u64 {
                    ProposalStatus::Approved
                } else {
                    ProposalStatus::Rejected
                };
            }
        }
        Ok(())
    }

    pub fn set_ai_evaluation(&mut self, evaluation: AIEvaluation) -> Result<()> {
        self.ai_evaluation = Some(evaluation.clone());
        
        self.status = match evaluation.recommendation {
            AIRecommendation::NeedHumanReview => ProposalStatus::HumanReview,
            AIRecommendation::ApproveUpward | AIRecommendation::ApproveDownward => {
                if evaluation.confidence >= 0.9 {
                    ProposalStatus::Approved
                } else {
                    ProposalStatus::HumanReview
                }
            },
            AIRecommendation::Reject => ProposalStatus::Rejected,
        };
        Ok(())
    }
}

impl Default for KnowledgeGovernance {
    fn default() -> Self {
        Self {
            min_quality_score: 0.7,
            min_curator_reputation: 60,
            transfer_cooldown: 24 * 3600,       // 24小时
            max_transfers_per_day: 10,
            require_peer_review: false,
            peer_review_count: 2,
            auto_quality_check: true,
        }
    }
}

impl KnowledgeGovernance {
    pub const SPACE: usize = 
        8 +  // min_quality_score
        8 +  // min_curator_reputation
        8 +  // transfer_cooldown
        4 +  // max_transfers_per_day
        1 +  // require_peer_review
        1 +  // peer_review_count
        1;   // auto_quality_check
}
