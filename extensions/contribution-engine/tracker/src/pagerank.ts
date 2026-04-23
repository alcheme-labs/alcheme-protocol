/**
 * PageRank 变体 — 计算 Crystal 的 Authority Score
 *
 * 对应 VFS §3.5:
 * - 阻尼系数 d = 0.85
 * - 收敛阈值 ε = 1e-6
 * - 最大迭代次数 100
 *
 * 使用加权 PageRank: 边权重影响 rank 传播。
 * authority_score(C) = (1-d)/N + d × Σ[referrer→C] (weight / outWeightSum(referrer)) × PR(referrer)
 */

import { CitationGraph } from './graph';
import { createLogger, format, transports, Logger } from 'winston';

// ==================== 配置 ====================

export interface PageRankConfig {
    /** 阻尼系数 (default 0.85) */
    dampingFactor: number;
    /** 收敛阈值 (default 1e-6) */
    convergenceThreshold: number;
    /** 最大迭代次数 (default 100) */
    maxIterations: number;
}

export const DEFAULT_PAGERANK_CONFIG: PageRankConfig = {
    dampingFactor: 0.85,
    convergenceThreshold: 1e-6,
    maxIterations: 100,
};

// ==================== 结果 ====================

export interface PageRankResult {
    /** Crystal ID → authority score */
    scores: Map<string, number>;
    /** 实际迭代次数 */
    iterations: number;
    /** 是否收敛 */
    converged: boolean;
    /** 最终 L1 差值 */
    finalDelta: number;
}

// ==================== 算法 ====================

export class PageRank {
    private config: PageRankConfig;
    private logger: Logger;

    constructor(
        config: Partial<PageRankConfig> = {},
        logLevel: string = 'info',
    ) {
        this.config = { ...DEFAULT_PAGERANK_CONFIG, ...config };
        this.logger = createLogger({
            level: logLevel,
            format: format.combine(
                format.timestamp(),
                format.printf(({ timestamp, level, message }) =>
                    `${timestamp} [PageRank] ${level}: ${message}`
                ),
            ),
            transports: [new transports.Console()],
        });
    }

    /**
     * 在给定引用图上运行 PageRank 算法
     */
    compute(graph: CitationGraph): PageRankResult {
        const nodes = graph.getNodes();
        const N = nodes.length;

        if (N === 0) {
            this.logger.warn('图为空，返回空结果');
            return {
                scores: new Map(),
                iterations: 0,
                converged: true,
                finalDelta: 0,
            };
        }

        const { dampingFactor: d, convergenceThreshold, maxIterations } = this.config;

        // 初始化: 每个节点等概率
        let scores = new Map<string, number>();
        const initialScore = 1.0 / N;
        for (const node of nodes) {
            scores.set(node, initialScore);
        }

        // 预计算反向邻接表 + 出权重总和
        const reverseAdj = graph.buildReverseAdjacencyList();
        const outWeightSums = new Map<string, number>();
        for (const node of nodes) {
            outWeightSums.set(node, graph.getOutWeightSum(node));
        }

        // 识别 dangling 节点 (无出边)
        const danglingNodes = nodes.filter(n => graph.getOutDegree(n) === 0);

        let iteration = 0;
        let delta = Infinity;

        while (iteration < maxIterations && delta > convergenceThreshold) {
            const newScores = new Map<string, number>();

            // Dangling rank: 所有无出边节点的 rank 之和
            let danglingSum = 0;
            for (const node of danglingNodes) {
                danglingSum += scores.get(node)!;
            }

            for (const node of nodes) {
                // 基础分: (1-d)/N + d × danglingSum/N
                let rank = (1 - d) / N + d * (danglingSum / N);

                // 入边贡献
                const inEdges = reverseAdj.get(node) || [];
                for (const { source, weight } of inEdges) {
                    const srcScore = scores.get(source)!;
                    const srcOutWeight = outWeightSums.get(source)!;
                    if (srcOutWeight > 0) {
                        rank += d * (weight / srcOutWeight) * srcScore;
                    }
                }

                newScores.set(node, rank);
            }

            // 计算 L1 范数差值
            delta = 0;
            for (const node of nodes) {
                delta += Math.abs(newScores.get(node)! - scores.get(node)!);
            }

            scores = newScores;
            iteration++;

            if (iteration % 10 === 0 || iteration === 1) {
                this.logger.debug(`迭代 ${iteration}: delta=${delta.toExponential(4)}`);
            }
        }

        const converged = delta <= convergenceThreshold;
        this.logger.info(
            `PageRank 完成: ${iteration} 次迭代, ` +
            `${converged ? '已收敛' : '未收敛'}, delta=${delta.toExponential(4)}`
        );

        return {
            scores,
            iterations: iteration,
            converged,
            finalDelta: delta,
        };
    }

    /**
     * 归一化分数到 [0, 1] 范围
     * 用于传递给 settle_reputation 的 authority_score 参数
     */
    static normalize(scores: Map<string, number>): Map<string, number> {
        if (scores.size === 0) return new Map();

        let maxScore = 0;
        for (const score of scores.values()) {
            if (score > maxScore) maxScore = score;
        }

        if (maxScore === 0) return new Map(scores);

        const normalized = new Map<string, number>();
        for (const [key, value] of scores) {
            normalized.set(key, value / maxScore);
        }
        return normalized;
    }
}
