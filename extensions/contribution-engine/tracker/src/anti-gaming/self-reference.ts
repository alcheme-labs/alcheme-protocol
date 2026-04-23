/**
 * Anti-Gaming: 自引用折扣 (VFS §3.4)
 *
 * 当 Crystal 的 source 和 target 由同一用户创建时，
 * 引用权重折扣 50%。此规则已在 graph.ts 的图构建阶段应用，
 * 这里提供独立的检测和标记功能。
 */

import { ReferenceRecord, CrystalOwnerMap, SELF_REFERENCE_DISCOUNT } from '../graph';
import { AntiGamingFlag, FlagType } from './types';

/**
 * 检测自引用并返回标记
 */
export function detectSelfReferences(
    references: ReferenceRecord[],
    crystalOwners: CrystalOwnerMap,
): AntiGamingFlag[] {
    const flags: AntiGamingFlag[] = [];

    // 按创建者统计自引用次数
    const selfRefCountByUser = new Map<string, number>();

    for (const ref of references) {
        const sourceOwner = crystalOwners.get(ref.sourceId);
        const targetOwner = crystalOwners.get(ref.targetId);

        if (sourceOwner && targetOwner && sourceOwner === targetOwner) {
            const count = (selfRefCountByUser.get(sourceOwner) || 0) + 1;
            selfRefCountByUser.set(sourceOwner, count);
        }
    }

    // 标记自引用 (信息性标记，折扣已在图构建中应用)
    for (const [userPubkey, count] of selfRefCountByUser) {
        if (count > 0) {
            flags.push({
                userPubkey,
                flagType: FlagType.SelfReference,
                details: {
                    selfReferenceCount: count,
                    discountApplied: SELF_REFERENCE_DISCOUNT,
                },
                severity: 'info',
            });
        }
    }

    return flags;
}
