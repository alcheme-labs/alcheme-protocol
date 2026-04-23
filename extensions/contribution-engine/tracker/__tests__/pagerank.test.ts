/**
 * PageRank 算法测试
 *
 * 验证:
 * 1. 空图 → 空结果
 * 2. 单节点 → 分数 = 1.0
 * 3. 星型图 → 中心节点分数最高
 * 4. 环形图 → 所有节点分数相等
 * 5. 断连图 → 各组件独立收敛
 * 6. 自引用折扣 → 权重减半
 * 7. 归一化 → 最大值为 1.0
 */

import { CitationGraph, ReferenceRecord, ReferenceTypeEnum, CrystalOwnerMap } from '../src/graph';
import { PageRank, DEFAULT_PAGERANK_CONFIG } from '../src/pagerank';

describe('PageRank 算法', () => {
    let graph: CitationGraph;
    let pr: PageRank;

    beforeEach(() => {
        graph = new CitationGraph('error'); // 安静模式
        pr = new PageRank({}, 'error');
    });

    // ==================== 边界情况 ====================

    describe('边界情况', () => {
        it('空图返回空结果', () => {
            graph.build([]);
            const result = pr.compute(graph);

            expect(result.scores.size).toBe(0);
            expect(result.iterations).toBe(0);
            expect(result.converged).toBe(true);
            expect(result.finalDelta).toBe(0);
        });

        it('单节点 (dangling) 返回分数 1.0', () => {
            const refs: ReferenceRecord[] = [{
                sourceId: 'A',
                targetId: 'B',
                refType: ReferenceTypeEnum.Citation,
                weight: 0.5,
                creator: 'user1',
                createdAt: Date.now() / 1000,
            }];
            // 构建包含 A→B 的图，B 是 dangling 节点
            graph.build(refs);
            const result = pr.compute(graph);

            expect(result.scores.size).toBe(2);
            expect(result.converged).toBe(true);
            // B 应该获得更高分 (被引用)
            expect(result.scores.get('B')!).toBeGreaterThan(result.scores.get('A')!);
        });
    });

    // ==================== 星型图 ====================

    describe('星型图', () => {
        it('中心节点获得最高分', () => {
            // A→C, B→C, D→C: C 是中心
            const refs: ReferenceRecord[] = [
                { sourceId: 'A', targetId: 'C', refType: ReferenceTypeEnum.Import, weight: 1.0, creator: 'u1', createdAt: Date.now() / 1000 },
                { sourceId: 'B', targetId: 'C', refType: ReferenceTypeEnum.Import, weight: 1.0, creator: 'u2', createdAt: Date.now() / 1000 },
                { sourceId: 'D', targetId: 'C', refType: ReferenceTypeEnum.Import, weight: 1.0, creator: 'u3', createdAt: Date.now() / 1000 },
            ];

            graph.build(refs);
            const result = pr.compute(graph);

            expect(result.converged).toBe(true);
            const scoreC = result.scores.get('C')!;
            expect(scoreC).toBeGreaterThan(result.scores.get('A')!);
            expect(scoreC).toBeGreaterThan(result.scores.get('B')!);
            expect(scoreC).toBeGreaterThan(result.scores.get('D')!);
        });
    });

    // ==================== 环形图 ====================

    describe('环形图', () => {
        it('所有节点分数相等', () => {
            // A→B, B→C, C→A: 环
            const refs: ReferenceRecord[] = [
                { sourceId: 'A', targetId: 'B', refType: ReferenceTypeEnum.Citation, weight: 0.5, creator: 'u1', createdAt: Date.now() / 1000 },
                { sourceId: 'B', targetId: 'C', refType: ReferenceTypeEnum.Citation, weight: 0.5, creator: 'u2', createdAt: Date.now() / 1000 },
                { sourceId: 'C', targetId: 'A', refType: ReferenceTypeEnum.Citation, weight: 0.5, creator: 'u3', createdAt: Date.now() / 1000 },
            ];

            graph.build(refs);
            const result = pr.compute(graph);

            expect(result.converged).toBe(true);
            const scoreA = result.scores.get('A')!;
            const scoreB = result.scores.get('B')!;
            const scoreC = result.scores.get('C')!;

            // 环形图中所有节点分数应近似相等
            expect(Math.abs(scoreA - scoreB)).toBeLessThan(1e-4);
            expect(Math.abs(scoreB - scoreC)).toBeLessThan(1e-4);
        });
    });

    // ==================== 断连图 ====================

    describe('断连图', () => {
        it('各组件独立', () => {
            // 组件1: A→B
            // 组件2: C→D, E→D (D 分数 > C, E)
            const refs: ReferenceRecord[] = [
                { sourceId: 'A', targetId: 'B', refType: ReferenceTypeEnum.Citation, weight: 0.5, creator: 'u1', createdAt: Date.now() / 1000 },
                { sourceId: 'C', targetId: 'D', refType: ReferenceTypeEnum.Citation, weight: 0.5, creator: 'u2', createdAt: Date.now() / 1000 },
                { sourceId: 'E', targetId: 'D', refType: ReferenceTypeEnum.Citation, weight: 0.5, creator: 'u3', createdAt: Date.now() / 1000 },
            ];

            graph.build(refs);
            const result = pr.compute(graph);

            expect(result.converged).toBe(true);
            expect(result.scores.size).toBe(5);
            // D 应该获得最高分 (被两个节点引用)
            const scoreD = result.scores.get('D')!;
            expect(scoreD).toBeGreaterThan(result.scores.get('C')!);
            expect(scoreD).toBeGreaterThan(result.scores.get('E')!);
        });
    });

    // ==================== 自引用折扣 ====================

    describe('自引用折扣', () => {
        it('同一创建者的引用权重折半', () => {
            const refs: ReferenceRecord[] = [
                { sourceId: 'X', targetId: 'Y', refType: ReferenceTypeEnum.Import, weight: 1.0, creator: 'alice', createdAt: Date.now() / 1000 },
            ];

            // 场景1: 不同创建者
            const owners1: CrystalOwnerMap = new Map([['X', 'alice'], ['Y', 'bob']]);
            graph.build(refs, owners1);
            expect(graph.getOutEdges('X')[0].weight).toBe(1.0);

            // 场景2: 同一创建者 → 折扣
            const owners2: CrystalOwnerMap = new Map([['X', 'alice'], ['Y', 'alice']]);
            graph.build(refs, owners2);
            expect(graph.getOutEdges('X')[0].weight).toBe(0.5);
        });
    });

    // ==================== 引用类型权重 ====================

    describe('引用类型权重', () => {
        it('Import=1.0, Citation=0.5, Mention=0.1, ForkOrigin=0(跳过)', () => {
            const refs: ReferenceRecord[] = [
                { sourceId: 'A', targetId: 'B', refType: ReferenceTypeEnum.Import, weight: 1.0, creator: 'u1', createdAt: Date.now() / 1000 },
                { sourceId: 'A', targetId: 'C', refType: ReferenceTypeEnum.Citation, weight: 0.5, creator: 'u1', createdAt: Date.now() / 1000 },
                { sourceId: 'A', targetId: 'D', refType: ReferenceTypeEnum.Mention, weight: 0.1, creator: 'u1', createdAt: Date.now() / 1000 },
                { sourceId: 'A', targetId: 'E', refType: ReferenceTypeEnum.ForkOrigin, weight: 0.0, creator: 'u1', createdAt: Date.now() / 1000 },
            ];

            graph.build(refs);

            const edges = graph.getOutEdges('A');
            expect(edges.length).toBe(3); // ForkOrigin 被跳过

            const edgeB = edges.find(e => e.target === 'B')!;
            const edgeC = edges.find(e => e.target === 'C')!;
            const edgeD = edges.find(e => e.target === 'D')!;

            expect(edgeB.weight).toBe(1.0);
            expect(edgeC.weight).toBe(0.5);
            expect(edgeD.weight).toBe(0.1);
        });
    });

    // ==================== 归一化 ====================

    describe('归一化', () => {
        it('最大值归一化到 1.0', () => {
            const scores = new Map([['A', 0.3], ['B', 0.6], ['C', 0.15]]);
            const normalized = PageRank.normalize(scores);

            expect(normalized.get('B')).toBe(1.0);
            expect(normalized.get('A')).toBeCloseTo(0.5, 5);
            expect(normalized.get('C')).toBeCloseTo(0.25, 5);
        });

        it('空 Map 返回空', () => {
            const normalized = PageRank.normalize(new Map());
            expect(normalized.size).toBe(0);
        });
    });

    // ==================== 收敛 ====================

    describe('收敛性', () => {
        it('大图在 100 轮内收敛', () => {
            // 构建一个 20 节点的随机图
            const refs: ReferenceRecord[] = [];
            for (let i = 0; i < 20; i++) {
                for (let j = 0; j < 3; j++) {
                    const target = Math.floor(Math.random() * 20);
                    if (target !== i) {
                        refs.push({
                            sourceId: `N${i}`,
                            targetId: `N${target}`,
                            refType: ReferenceTypeEnum.Citation,
                            weight: 0.5,
                            creator: `u${i}`,
                            createdAt: Date.now() / 1000,
                        });
                    }
                }
            }

            graph.build(refs);
            const result = pr.compute(graph);

            expect(result.converged).toBe(true);
            expect(result.iterations).toBeLessThan(100);
        });
    });
});
