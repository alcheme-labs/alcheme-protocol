/**
 * Anti-Gaming: 幽灵贡献过滤 (VFS §3.6)
 *
 * 过滤权重极低的贡献 (weight < 0.01)。
 * 这些通常是纯格式编辑、空白修改等无实质内容的贡献，
 * 不应计入 authority 计算。
 */

import { AntiGamingFlag, FlagType, AntiGamingThresholds, DEFAULT_THRESHOLDS } from './types';

/** 简化的贡献记录 (链下表示) */
export interface ContributionRecord {
    /** Crystal ID (base58) */
    crystalId: string;
    /** 贡献者 pubkey (base58) */
    contributor: string;
    /** 角色 */
    role: string;
    /** 权重 */
    weight: number;
}

/**
 * 检测幽灵贡献
 *
 * @returns 标记列表 + 过滤后的有效贡献列表
 */
export function filterGhostContributions(
    contributions: ContributionRecord[],
    thresholds: AntiGamingThresholds = DEFAULT_THRESHOLDS,
): { flags: AntiGamingFlag[]; validContributions: ContributionRecord[] } {
    const flags: AntiGamingFlag[] = [];
    const validContributions: ContributionRecord[] = [];

    for (const contribution of contributions) {
        if (contribution.weight < thresholds.ghostContributionMinWeight) {
            flags.push({
                userPubkey: contribution.contributor,
                flagType: FlagType.GhostContribution,
                details: {
                    crystalId: contribution.crystalId,
                    role: contribution.role,
                    weight: contribution.weight,
                    threshold: thresholds.ghostContributionMinWeight,
                },
                severity: 'info',
            });
        } else {
            validContributions.push(contribution);
        }
    }

    return { flags, validContributions };
}
