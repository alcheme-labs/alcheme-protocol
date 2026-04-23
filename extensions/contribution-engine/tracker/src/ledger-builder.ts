import { PublicKey } from '@solana/web3.js';
import { createLogger, format, transports, Logger } from 'winston';
import {
    ContributionSourceEvent,
    ContributionSourceEventType,
    ContributionRole,
    DEFAULT_ROLE_WEIGHTS,
    LedgerBuildResult,
    PendingContribution,
    PendingReference,
    ReferenceType,
    REFERENCE_WEIGHTS,
} from './types';

/**
 * LedgerBuilder — 贡献账本生成引擎
 *
 * 实现 VFS §3.3 的账本生成算法：
 * 1. 识别 AUTHOR — 谁编辑了草稿
 * 2. 识别 DISCUSSANT — 谁参与了讨论
 * 3. 识别 REVIEWER — 谁投了赞成票
 * 4. 识别 CITED — 引用了谁的旧 Crystal
 */
export class LedgerBuilder {
    private logger: Logger;
    private roleWeights: Record<ContributionRole, number>;

    constructor(
        roleWeights?: Partial<Record<ContributionRole, number>>,
        logLevel: string = 'info',
    ) {
        this.roleWeights = { ...DEFAULT_ROLE_WEIGHTS, ...roleWeights };
        this.logger = createLogger({
            level: logLevel,
            format: format.combine(
                format.timestamp(),
                format.printf(({ timestamp, level, message }) =>
                    `${timestamp} [LedgerBuilder] ${level}: ${message}`
                ),
            ),
            transports: [new transports.Console()],
        });
    }

    /**
     * 处理 Crystal 结晶事件，生成完整贡献账本
     *
     * @param event 扩展域事件 (当前由 CrystalFinalized 驱动)
     * @returns 可提交到链上的贡献条目列表
     */
    async buildLedger(event: ContributionSourceEvent): Promise<LedgerBuildResult | null> {
        if (event.type !== ContributionSourceEventType.CrystalFinalized) {
            this.logger.warn(`非 CrystalFinalized 事件，跳过`);
            return null;
        }

        const crystalId = new PublicKey(event.data['content_id'] as string);
        this.logger.info(`开始生成账本: crystal=${crystalId.toBase58()}`);

        const contributions: PendingContribution[] = [];
        const references: PendingReference[] = [];

        // Step 1: 识别 AUTHOR — 编辑了草稿的人
        const authors = await this.identifyAuthors(event);
        const authorTotal = authors.reduce((sum, a) => sum + a.editCount, 0);

        for (const author of authors) {
            const weight = this.roleWeights[ContributionRole.Author] * (author.editCount / authorTotal);
            contributions.push({
                crystalId,
                contributor: author.userId,
                role: ContributionRole.Author,
                weight,
            });
        }
        this.logger.info(`AUTHOR: ${authors.length} 人`);

        // Step 2: 识别 DISCUSSANT — 参与讨论的人 (排除 AUTHOR)
        const authorKeys = new Set(authors.map(a => a.userId.toBase58()));
        const discussants = await this.identifyDiscussants(event, authorKeys);
        const discussantTotal = discussants.reduce((sum, d) => sum + d.eventCount, 0);

        for (const discussant of discussants) {
            if (discussantTotal > 0) {
                const weight = this.roleWeights[ContributionRole.Discussant] * (discussant.eventCount / discussantTotal);
                contributions.push({
                    crystalId,
                    contributor: discussant.userId,
                    role: ContributionRole.Discussant,
                    weight,
                });
            }
        }
        this.logger.info(`DISCUSSANT: ${discussants.length} 人`);

        // Step 3: 识别 REVIEWER — 投票验证的人
        const reviewers = await this.identifyReviewers(event);

        for (const reviewer of reviewers) {
            const weight = this.roleWeights[ContributionRole.Reviewer] * (1 / reviewers.length);
            contributions.push({
                crystalId,
                contributor: reviewer.userId,
                role: ContributionRole.Reviewer,
                weight,
            });
        }
        this.logger.info(`REVIEWER: ${reviewers.length} 人`);

        // Step 4: 识别 CITED — 被当前 Crystal 引用的旧 Crystal 的作者
        const citedRefs = await this.identifyCitedReferences(event);
        const citedTotal = citedRefs.reduce((sum, r) => sum + REFERENCE_WEIGHTS[r.refType], 0);

        for (const ref of citedRefs) {
            references.push({
                sourceId: crystalId,
                targetId: ref.targetCrystalId,
                refType: ref.refType,
            });

            if (citedTotal > 0) {
                const weight = this.roleWeights[ContributionRole.Cited] * (REFERENCE_WEIGHTS[ref.refType] / citedTotal);
                contributions.push({
                    crystalId,
                    contributor: ref.originalAuthor,
                    role: ContributionRole.Cited,
                    weight,
                });
            }
        }
        this.logger.info(`CITED: ${citedRefs.length} 个引用`);

        // 计算总权重
        const totalWeight = contributions.reduce((sum, c) => sum + c.weight, 0);
        this.logger.info(
            `账本生成完成: crystal=${crystalId.toBase58()}, ` +
            `贡献者=${contributions.length}, 引用=${references.length}, 总权重=${totalWeight.toFixed(4)}`
        );

        return {
            crystalId,
            contributions,
            references,
            totalWeight,
        };
    }

    // ==================== 数据获取方法 (MVP: 从事件数据解析) ====================

    /**
     * 识别 AUTHOR
     * MVP: 从事件数据中提取编辑者信息
     * 生产环境: 查询链上 content-manager 的编辑历史
     */
    private async identifyAuthors(event: ContributionSourceEvent): Promise<AuthorInfo[]> {
        const authors = event.data['authors'] as Array<{ user_id: string; edit_count: number }> | undefined;
        if (!authors || authors.length === 0) {
            // 回退：使用内容创建者
            const creator = event.data['creator'] as string | undefined;
            if (creator) {
                return [{ userId: new PublicKey(creator), editCount: 1 }];
            }
            return [];
        }
        return authors.map(a => ({
            userId: new PublicKey(a.user_id),
            editCount: a.edit_count,
        }));
    }

    /**
     * 识别 DISCUSSANT
     * MVP: 从事件数据中提取讨论参与者
     * 生产环境: 查询链上 messaging-manager 的消息记录
     */
    private async identifyDiscussants(
        event: ContributionSourceEvent,
        excludeKeys: Set<string>,
    ): Promise<DiscussantInfo[]> {
        const discussants = event.data['discussants'] as Array<{ user_id: string; event_count: number }> | undefined;
        if (!discussants) return [];
        return discussants
            .filter(d => !excludeKeys.has(d.user_id))
            .map(d => ({
                userId: new PublicKey(d.user_id),
                eventCount: d.event_count,
            }));
    }

    /**
     * 识别 REVIEWER
     * MVP: 从事件数据中提取投票者
     * 生产环境: 查询链上 circle-manager 的验证投票
     */
    private async identifyReviewers(event: ContributionSourceEvent): Promise<ReviewerInfo[]> {
        const reviewers = event.data['reviewers'] as Array<{ user_id: string }> | undefined;
        if (!reviewers) return [];
        return reviewers.map(r => ({
            userId: new PublicKey(r.user_id),
        }));
    }

    /**
     * 识别被引用的 Crystal
     * MVP: 从事件数据中提取引用信息
     * 生产环境: 查询链上 contribution-engine 的 Reference 账户
     */
    private async identifyCitedReferences(event: ContributionSourceEvent): Promise<CitedReferenceInfo[]> {
        const refs = event.data['references'] as Array<{
            target_crystal_id: string;
            ref_type: string;
            original_author: string;
        }> | undefined;
        if (!refs) return [];
        return refs.map(r => ({
            targetCrystalId: new PublicKey(r.target_crystal_id),
            refType: r.ref_type as ReferenceType,
            originalAuthor: new PublicKey(r.original_author),
        }));
    }
}

// ==================== 内部类型 ====================

interface AuthorInfo {
    userId: PublicKey;
    editCount: number;
}

interface DiscussantInfo {
    userId: PublicKey;
    eventCount: number;
}

interface ReviewerInfo {
    userId: PublicKey;
}

interface CitedReferenceInfo {
    targetCrystalId: PublicKey;
    refType: ReferenceType;
    originalAuthor: PublicKey;
}
