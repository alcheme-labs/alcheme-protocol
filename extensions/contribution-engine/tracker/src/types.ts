import { PublicKey } from '@solana/web3.js';

// ==================== 贡献角色 (对应链上 ContributionRole) ====================

export enum ContributionRole {
    Author = 'Author',
    Discussant = 'Discussant',
    Reviewer = 'Reviewer',
    Cited = 'Cited',
}

/** VFS §3.3 — 角色默认权重 */
export const DEFAULT_ROLE_WEIGHTS: Record<ContributionRole, number> = {
    [ContributionRole.Author]: 0.50,
    [ContributionRole.Discussant]: 0.25,
    [ContributionRole.Reviewer]: 0.20,
    [ContributionRole.Cited]: 0.05,
};

// ==================== 引用类型 (对应链上 ReferenceType) ====================

export enum ReferenceType {
    Import = 'Import',
    Citation = 'Citation',
    Mention = 'Mention',
    ForkOrigin = 'ForkOrigin',
}

/** VFS §3.2 — 引用类型权重 */
export const REFERENCE_WEIGHTS: Record<ReferenceType, number> = {
    [ReferenceType.Import]: 1.0,
    [ReferenceType.Citation]: 0.5,
    [ReferenceType.Mention]: 0.1,
    [ReferenceType.ForkOrigin]: 0.0,
};

// ==================== 协议事件类型 ====================

/** 从 Event Emitter 监听的协议事件 */
export interface ProtocolEvent {
    type: ProtocolEventType;
    timestamp: number;
    slot: number;
    data: Record<string, unknown>;
}

export enum ProtocolEventType {
    /** 内容状态变更 (GHOST → ALLOY → CRYSTAL) */
    ContentStatusChanged = 'ContentStatusChanged',
    /** 新内容创建 */
    ContentCreated = 'ContentCreated',
    /** 知识提交到圈层 */
    KnowledgeSubmitted = 'KnowledgeSubmitted',
    /** 知识传递执行 */
    TransferProposalExecuted = 'TransferProposalExecuted',
}

// ==================== 扩展域事件 ====================

export enum ContributionSourceEventType {
    CrystalFinalized = 'CrystalFinalized',
}

export interface ContributionSourceEvent {
    type: ContributionSourceEventType;
    timestamp: number;
    slot: number;
    data: Record<string, unknown>;
}

// ==================== 贡献账本条目 ====================

/** 待提交到链上的贡献条目 */
export interface PendingContribution {
    crystalId: PublicKey;
    contributor: PublicKey;
    role: ContributionRole;
    weight: number;
}

/** 待提交到链上的引用关系 */
export interface PendingReference {
    sourceId: PublicKey;
    targetId: PublicKey;
    refType: ReferenceType;
}

/** 账本生成结果 */
export interface LedgerBuildResult {
    crystalId: PublicKey;
    contributions: PendingContribution[];
    references: PendingReference[];
    totalWeight: number;
}
