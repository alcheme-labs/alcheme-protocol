/**
 * Anti-Gaming: 互引检测 (VFS §3.6)
 *
 * 检测 7 天内两个用户之间互相引用 > 5 次的异常模式。
 * 触发条件: 用户 A 引用用户 B 的 Crystal 且用户 B 也引用用户 A 的 Crystal，
 * 7 天窗口内双向总次数 > 5。
 */

import { ReferenceRecord, CrystalOwnerMap } from '../graph';
import { AntiGamingFlag, FlagType, AntiGamingThresholds, DEFAULT_THRESHOLDS } from './types';

/** 互引对的 key 生成 (确保 A-B 和 B-A 映射到同一个 key) */
function pairKey(a: string, b: string): string {
    return a < b ? `${a}:${b}` : `${b}:${a}`;
}

/**
 * 检测互引异常
 */
export function detectMutualCitations(
    references: ReferenceRecord[],
    crystalOwners: CrystalOwnerMap,
    thresholds: AntiGamingThresholds = DEFAULT_THRESHOLDS,
): AntiGamingFlag[] {
    const flags: AntiGamingFlag[] = [];
    const windowMs = thresholds.mutualCitationWindowDays * 24 * 60 * 60 * 1000;
    const now = Date.now();

    // 按用户对统计互引次数
    // key: pairKey(userA, userB), value: { aToB: count, bToA: count }
    const pairCounts = new Map<string, { users: [string, string]; aToB: number; bToA: number }>();

    for (const ref of references) {
        // 只看窗口内的引用
        if (now - ref.createdAt * 1000 > windowMs) continue;

        const sourceOwner = crystalOwners.get(ref.sourceId);
        const targetOwner = crystalOwners.get(ref.targetId);

        if (!sourceOwner || !targetOwner) continue;
        if (sourceOwner === targetOwner) continue; // 自引用不算互引

        const key = pairKey(sourceOwner, targetOwner);
        if (!pairCounts.has(key)) {
            pairCounts.set(key, {
                users: sourceOwner < targetOwner
                    ? [sourceOwner, targetOwner]
                    : [targetOwner, sourceOwner],
                aToB: 0,
                bToA: 0,
            });
        }

        const pair = pairCounts.get(key)!;
        if (sourceOwner === pair.users[0]) {
            pair.aToB++;
        } else {
            pair.bToA++;
        }
    }

    // 检查阈值
    for (const [, pair] of pairCounts) {
        const total = pair.aToB + pair.bToA;
        // 只有双向都存在且总次数超过阈值才标记
        if (pair.aToB > 0 && pair.bToA > 0 && total > thresholds.mutualCitationMaxCount) {
            // 两个用户都标记
            for (const user of pair.users) {
                flags.push({
                    userPubkey: user,
                    flagType: FlagType.MutualCitation,
                    details: {
                        pairUser: pair.users.find(u => u !== user),
                        aToBCount: pair.aToB,
                        bToACount: pair.bToA,
                        totalCount: total,
                        windowDays: thresholds.mutualCitationWindowDays,
                    },
                    severity: 'warning',
                });
            }
        }
    }

    return flags;
}
