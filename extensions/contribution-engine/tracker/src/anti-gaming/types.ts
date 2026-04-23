/**
 * Anti-Gaming 共享类型定义
 *
 * 单独提取以避免循环依赖 (index.ts ↔ 规则文件)
 */

export enum FlagType {
    SelfReference = 'self_reference',
    MutualCitation = 'mutual_citation',
    SpamAudit = 'spam_audit',
    GhostContribution = 'ghost_contribution',
}

export interface AntiGamingFlag {
    userPubkey: string;
    flagType: FlagType;
    details: Record<string, unknown>;
    severity: 'info' | 'warning' | 'critical';
}

export interface AntiGamingThresholds {
    /** 互引检测窗口 (天) */
    mutualCitationWindowDays: number;
    /** 互引最大次数 */
    mutualCitationMaxCount: number;
    /** 刷量审计: 每周最大引用数 */
    spamMaxReferencesPerWeek: number;
    /** 幽灵贡献: 最小有效权重 */
    ghostContributionMinWeight: number;
}

export const DEFAULT_THRESHOLDS: AntiGamingThresholds = {
    mutualCitationWindowDays: 7,
    mutualCitationMaxCount: 5,
    spamMaxReferencesPerWeek: 50,
    ghostContributionMinWeight: 0.01,
};
