/**
 * Anti-Gaming Pipeline — 汇总所有反作弊规则
 *
 * 提供统一的检测入口，从 types.ts 重导出类型定义。
 */

import { ReferenceRecord, CrystalOwnerMap } from '../graph';
import { detectSelfReferences } from './self-reference';
import { detectMutualCitations } from './mutual-citation';
import { detectSpam } from './spam-audit';
import { filterGhostContributions, ContributionRecord } from './ghost-contribution';
import { createLogger, format, transports, Logger } from 'winston';

// 从 types.ts 重导出，统一外部导入路径
export {
    FlagType,
    AntiGamingFlag,
    AntiGamingThresholds,
    DEFAULT_THRESHOLDS,
} from './types';
export { ContributionRecord } from './ghost-contribution';

import {
    AntiGamingFlag,
    AntiGamingThresholds,
    DEFAULT_THRESHOLDS,
} from './types';

// ==================== 结果 ====================

export interface AntiGamingResult {
    /** 所有标记 */
    flags: AntiGamingFlag[];
    /** 被标记为 spam 的用户 (其引用不计入 authority) */
    blockedUsers: Set<string>;
    /** 过滤后的有效贡献 */
    validContributions: ContributionRecord[];
}

// ==================== Pipeline ====================

export class AntiGamingPipeline {
    private thresholds: AntiGamingThresholds;
    private logger: Logger;

    constructor(
        thresholds: Partial<AntiGamingThresholds> = {},
        logLevel: string = 'info',
    ) {
        this.thresholds = { ...DEFAULT_THRESHOLDS, ...thresholds };
        this.logger = createLogger({
            level: logLevel,
            format: format.combine(
                format.timestamp(),
                format.printf(({ timestamp, level, message }) =>
                    `${timestamp} [AntiGaming] ${level}: ${message}`
                ),
            ),
            transports: [new transports.Console()],
        });
    }

    /**
     * 运行完整的反作弊检测 pipeline
     */
    run(
        references: ReferenceRecord[],
        contributions: ContributionRecord[],
        crystalOwners: CrystalOwnerMap,
    ): AntiGamingResult {
        const allFlags: AntiGamingFlag[] = [];

        // 1. 自引用检测 (信息性标记)
        const selfRefFlags = detectSelfReferences(references, crystalOwners);
        allFlags.push(...selfRefFlags);
        this.logger.info(`自引用: ${selfRefFlags.length} 个标记`);

        // 2. 互引检测
        const mutualFlags = detectMutualCitations(references, crystalOwners, this.thresholds);
        allFlags.push(...mutualFlags);
        this.logger.info(`互引: ${mutualFlags.length} 个标记`);

        // 3. 刷量审计
        const spamFlags = detectSpam(references, crystalOwners, this.thresholds);
        allFlags.push(...spamFlags);
        this.logger.info(`刷量: ${spamFlags.length} 个标记`);

        // 4. 幽灵贡献过滤
        const { flags: ghostFlags, validContributions } = filterGhostContributions(
            contributions,
            this.thresholds,
        );
        allFlags.push(...ghostFlags);
        this.logger.info(`幽灵贡献: ${ghostFlags.length} 个标记, 有效贡献: ${validContributions.length}/${contributions.length}`);

        // 汇总被封锁用户 (spam audit → critical)
        const blockedUsers = new Set<string>();
        for (const flag of allFlags) {
            if (flag.severity === 'critical') {
                blockedUsers.add(flag.userPubkey);
            }
        }

        if (blockedUsers.size > 0) {
            this.logger.warn(`封锁 ${blockedUsers.size} 个用户的引用贡献`);
        }

        this.logger.info(`反作弊 pipeline 完成: ${allFlags.length} 个标记, ${blockedUsers.size} 个封锁`);

        return {
            flags: allFlags,
            blockedUsers,
            validContributions,
        };
    }
}
