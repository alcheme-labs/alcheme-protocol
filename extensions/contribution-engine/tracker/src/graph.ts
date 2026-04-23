/**
 * Citation Graph Builder — 从链上 Reference 数据构建有向引用图
 *
 * 对应 VFS §3.2 + §3.4:
 * - Import = 1.0, Citation = 0.5, Mention = 0.1, ForkOrigin = 0.0
 * - 自引用边权重折扣 50%
 */

import { createLogger, format, transports, Logger } from 'winston';

// ==================== 类型定义 ====================

/** 链上 Reference 账户的 off-chain 表示 */
export interface ReferenceRecord {
    /** 引用发起方 Crystal ID (publickey base58) */
    sourceId: string;
    /** 被引用方 Crystal ID (publickey base58) */
    targetId: string;
    /** 引用类型 */
    refType: ReferenceTypeEnum;
    /** 链上原始权重 */
    weight: number;
    /** 创建者 pubkey (用于自引用检测) */
    creator: string;
    /** 创建时间 (unix timestamp) */
    createdAt: number;
}

export enum ReferenceTypeEnum {
    Import = 'Import',
    Citation = 'Citation',
    Mention = 'Mention',
    ForkOrigin = 'ForkOrigin',
}

/** 引用类型 → 权重映射 (VFS §3.2) */
export const REFERENCE_TYPE_WEIGHTS: Record<ReferenceTypeEnum, number> = {
    [ReferenceTypeEnum.Import]: 1.0,
    [ReferenceTypeEnum.Citation]: 0.5,
    [ReferenceTypeEnum.Mention]: 0.1,
    [ReferenceTypeEnum.ForkOrigin]: 0.0,
};

/** 自引用折扣因子 (VFS §3.4) */
export const SELF_REFERENCE_DISCOUNT = 0.5;

/** 有向图中的一条边 */
export interface Edge {
    /** 目标节点 (被引用 Crystal) */
    target: string;
    /** 边权重 (引用类型权重 × 自引用折扣) */
    weight: number;
}

/** 知晓 Crystal → 所有者(创建者) 的映射 */
export type CrystalOwnerMap = Map<string, string>;

// ==================== Graph Builder ====================

export class CitationGraph {
    /** 邻接表: sourceId → Edge[] */
    private adjacencyList: Map<string, Edge[]> = new Map();
    /** 所有节点集合 */
    private nodeSet: Set<string> = new Set();
    private logger: Logger;

    constructor(logLevel: string = 'info') {
        this.logger = createLogger({
            level: logLevel,
            format: format.combine(
                format.timestamp(),
                format.printf(({ timestamp, level, message }) =>
                    `${timestamp} [CitationGraph] ${level}: ${message}`
                ),
            ),
            transports: [new transports.Console()],
        });
    }

    /**
     * 从 Reference 记录构建引用图
     *
     * @param references - 链上 Reference 账户列表
     * @param crystalOwners - Crystal → 创建者 pubkey 映射 (用于检测自引用)
     */
    build(references: ReferenceRecord[], crystalOwners?: CrystalOwnerMap): void {
        this.adjacencyList.clear();
        this.nodeSet.clear();

        let selfRefCount = 0;

        for (const ref of references) {
            // 跳过 ForkOrigin (权重 0)
            if (ref.refType === ReferenceTypeEnum.ForkOrigin) continue;

            this.nodeSet.add(ref.sourceId);
            this.nodeSet.add(ref.targetId);

            let edgeWeight = REFERENCE_TYPE_WEIGHTS[ref.refType];

            // 自引用折扣: 当 source 和 target 由同一创建者拥有
            if (crystalOwners) {
                const sourceOwner = crystalOwners.get(ref.sourceId);
                const targetOwner = crystalOwners.get(ref.targetId);
                if (sourceOwner && targetOwner && sourceOwner === targetOwner) {
                    edgeWeight *= SELF_REFERENCE_DISCOUNT;
                    selfRefCount++;
                }
            }

            if (!this.adjacencyList.has(ref.sourceId)) {
                this.adjacencyList.set(ref.sourceId, []);
            }
            this.adjacencyList.get(ref.sourceId)!.push({
                target: ref.targetId,
                weight: edgeWeight,
            });
        }

        this.logger.info(
            `引用图构建完成: ${this.nodeSet.size} 个节点, ` +
            `${references.length} 条边, ${selfRefCount} 条自引用折扣`
        );
    }

    /** 获取所有节点 */
    getNodes(): string[] {
        return Array.from(this.nodeSet);
    }

    /** 获取节点数量 */
    getNodeCount(): number {
        return this.nodeSet.size;
    }

    /** 获取指定节点的出边 */
    getOutEdges(nodeId: string): Edge[] {
        return this.adjacencyList.get(nodeId) || [];
    }

    /** 获取指定节点的出度 */
    getOutDegree(nodeId: string): number {
        return this.getOutEdges(nodeId).length;
    }

    /** 获取指定节点出边的权重总和 */
    getOutWeightSum(nodeId: string): number {
        return this.getOutEdges(nodeId).reduce((sum, e) => sum + e.weight, 0);
    }

    /** 获取邻接表 (只读) */
    getAdjacencyList(): ReadonlyMap<string, Edge[]> {
        return this.adjacencyList;
    }

    /** 构建反向邻接表 (用于 PageRank 计算) */
    buildReverseAdjacencyList(): Map<string, { source: string; weight: number }[]> {
        const reverse = new Map<string, { source: string; weight: number }[]>();
        for (const node of this.nodeSet) {
            reverse.set(node, []);
        }
        for (const [source, edges] of this.adjacencyList) {
            for (const edge of edges) {
                reverse.get(edge.target)!.push({ source, weight: edge.weight });
            }
        }
        return reverse;
    }
}
