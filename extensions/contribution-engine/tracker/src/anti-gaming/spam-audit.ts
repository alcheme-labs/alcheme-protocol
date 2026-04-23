/**
 * Anti-Gaming: 刷量审计 (VFS §3.6)
 *
 * 检测单用户单周创建 > 50 条新引用的刷量行为。
 * 超过阈值 → 该用户的引用贡献暂停计入 authority 计算。
 */

import { ReferenceRecord, CrystalOwnerMap } from '../graph';
import { AntiGamingFlag, FlagType, AntiGamingThresholds, DEFAULT_THRESHOLDS } from './types';

/**
 * 检测刷量行为
 */
export function detectSpam(
    references: ReferenceRecord[],
    crystalOwners: CrystalOwnerMap,
    thresholds: AntiGamingThresholds = DEFAULT_THRESHOLDS,
): AntiGamingFlag[] {
    const flags: AntiGamingFlag[] = [];
    const windowMs = 7 * 24 * 60 * 60 * 1000; // 1 week
    const now = Date.now();

    // 按创建者统计窗口内引用数
    const refCountByUser = new Map<string, number>();

    for (const ref of references) {
        if (now - ref.createdAt * 1000 > windowMs) continue;

        const creator = ref.creator;
        if (!creator) continue;

        const count = (refCountByUser.get(creator) || 0) + 1;
        refCountByUser.set(creator, count);
    }

    for (const [userPubkey, count] of refCountByUser) {
        if (count > thresholds.spamMaxReferencesPerWeek) {
            flags.push({
                userPubkey,
                flagType: FlagType.SpamAudit,
                details: {
                    referenceCount: count,
                    threshold: thresholds.spamMaxReferencesPerWeek,
                    windowDays: 7,
                },
                severity: 'critical',
            });
        }
    }

    return flags;
}
