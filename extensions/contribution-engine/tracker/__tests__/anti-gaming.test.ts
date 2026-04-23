/**
 * Anti-Gaming Pipeline 测试
 *
 * 验证:
 * 1. 自引用检测 — 正确标记同一创建者的引用
 * 2. 互引检测 — 超过阈值 (>5 次/7天) 的互引被标记
 * 3. 刷量审计 — 超过 50 条/周的用户被标记为 critical
 * 4. 幽灵贡献过滤 — 权重 < 0.01 的贡献被过滤
 * 5. Pipeline 整合 — 全部规则按顺序执行
 */

import { ReferenceRecord, ReferenceTypeEnum, CrystalOwnerMap } from '../src/graph';
import { AntiGamingPipeline, FlagType } from '../src/anti-gaming';
import { ContributionRecord } from '../src/anti-gaming/ghost-contribution';
import { detectSelfReferences } from '../src/anti-gaming/self-reference';
import { detectMutualCitations } from '../src/anti-gaming/mutual-citation';
import { detectSpam } from '../src/anti-gaming/spam-audit';
import { filterGhostContributions } from '../src/anti-gaming/ghost-contribution';

const NOW_SEC = Math.floor(Date.now() / 1000);

function makeRef(
    source: string,
    target: string,
    creator: string,
    createdAt: number = NOW_SEC,
    refType: ReferenceTypeEnum = ReferenceTypeEnum.Citation,
): ReferenceRecord {
    return { sourceId: source, targetId: target, refType, weight: 0.5, creator, createdAt };
}

describe('Anti-Gaming 反作弊', () => {
    // ==================== 自引用检测 ====================

    describe('自引用检测', () => {
        it('标记同一创建者的自引用', () => {
            const refs = [
                makeRef('crystalA', 'crystalB', 'alice'),
                makeRef('crystalC', 'crystalD', 'bob'),
            ];
            const owners: CrystalOwnerMap = new Map([
                ['crystalA', 'alice'],
                ['crystalB', 'alice'],  // 同一创建者
                ['crystalC', 'bob'],
                ['crystalD', 'carol'],  // 不同创建者
            ]);

            const flags = detectSelfReferences(refs, owners);

            expect(flags.length).toBe(1);
            expect(flags[0].userPubkey).toBe('alice');
            expect(flags[0].flagType).toBe(FlagType.SelfReference);
            expect(flags[0].severity).toBe('info');
        });

        it('无自引用时返回空', () => {
            const refs = [makeRef('A', 'B', 'alice')];
            const owners: CrystalOwnerMap = new Map([['A', 'alice'], ['B', 'bob']]);

            const flags = detectSelfReferences(refs, owners);
            expect(flags.length).toBe(0);
        });
    });

    // ==================== 互引检测 ====================

    describe('互引检测', () => {
        it('7天内 >5 次互引被标记为 warning', () => {
            // A→B 3次, B→A 3次 = 6次互引 > 阈值5
            const refs: ReferenceRecord[] = [];
            for (let i = 0; i < 3; i++) {
                refs.push(makeRef(`cA${i}`, `cB${i}`, 'alice'));
                refs.push(makeRef(`cB${i}`, `cA${i}`, 'bob'));
            }
            // crystal owner mapping: cA* 属于 alice, cB* 属于 bob
            const owners: CrystalOwnerMap = new Map();
            for (let i = 0; i < 3; i++) {
                owners.set(`cA${i}`, 'alice');
                owners.set(`cB${i}`, 'bob');
            }

            const flags = detectMutualCitations(refs, owners);

            // alice 和 bob 各被标记一次
            expect(flags.length).toBe(2);
            expect(flags.every(f => f.flagType === FlagType.MutualCitation)).toBe(true);
            expect(flags.every(f => f.severity === 'warning')).toBe(true);
        });

        it('≤5 次互引不被标记', () => {
            // 2 + 2 = 4 < 5
            const refs = [
                makeRef('cA0', 'cB0', 'alice'),
                makeRef('cA1', 'cB1', 'alice'),
                makeRef('cB0', 'cA0', 'bob'),
                makeRef('cB1', 'cA1', 'bob'),
            ];
            const owners: CrystalOwnerMap = new Map([
                ['cA0', 'alice'], ['cA1', 'alice'],
                ['cB0', 'bob'], ['cB1', 'bob'],
            ]);

            const flags = detectMutualCitations(refs, owners);
            expect(flags.length).toBe(0);
        });

        it('超出窗口期的引用不计入', () => {
            const oldTime = NOW_SEC - 8 * 24 * 60 * 60; // 8天前
            const refs: ReferenceRecord[] = [];
            for (let i = 0; i < 3; i++) {
                refs.push(makeRef(`cA${i}`, `cB${i}`, 'alice', oldTime));
                refs.push(makeRef(`cB${i}`, `cA${i}`, 'bob', oldTime));
            }
            const owners: CrystalOwnerMap = new Map();
            for (let i = 0; i < 3; i++) {
                owners.set(`cA${i}`, 'alice');
                owners.set(`cB${i}`, 'bob');
            }

            const flags = detectMutualCitations(refs, owners);
            expect(flags.length).toBe(0);
        });
    });

    // ==================== 刷量审计 ====================

    describe('刷量审计', () => {
        it('>50 条引用/周的用户被标记为 critical', () => {
            const refs: ReferenceRecord[] = [];
            for (let i = 0; i < 51; i++) {
                refs.push(makeRef(`source${i}`, `target${i}`, 'spammer'));
            }
            const owners: CrystalOwnerMap = new Map();

            const flags = detectSpam(refs, owners);

            expect(flags.length).toBe(1);
            expect(flags[0].userPubkey).toBe('spammer');
            expect(flags[0].flagType).toBe(FlagType.SpamAudit);
            expect(flags[0].severity).toBe('critical');
        });

        it('≤50 条不被标记', () => {
            const refs: ReferenceRecord[] = [];
            for (let i = 0; i < 50; i++) {
                refs.push(makeRef(`s${i}`, `t${i}`, 'normalUser'));
            }

            const flags = detectSpam(refs, new Map());
            expect(flags.length).toBe(0);
        });
    });

    // ==================== 幽灵贡献过滤 ====================

    describe('幽灵贡献过滤', () => {
        it('权重 < 0.01 的贡献被过滤', () => {
            const contributions: ContributionRecord[] = [
                { crystalId: 'c1', contributor: 'alice', role: 'Author', weight: 0.5 },
                { crystalId: 'c2', contributor: 'bob', role: 'Discussant', weight: 0.005 }, // 幽灵
                { crystalId: 'c3', contributor: 'carol', role: 'Reviewer', weight: 0.3 },
            ];

            const { flags, validContributions } = filterGhostContributions(contributions);

            expect(flags.length).toBe(1);
            expect(flags[0].userPubkey).toBe('bob');
            expect(flags[0].flagType).toBe(FlagType.GhostContribution);
            expect(validContributions.length).toBe(2);
            expect(validContributions.find(c => c.contributor === 'bob')).toBeUndefined();
        });

        it('所有贡献有效时无标记', () => {
            const contributions: ContributionRecord[] = [
                { crystalId: 'c1', contributor: 'alice', role: 'Author', weight: 0.5 },
            ];

            const { flags, validContributions } = filterGhostContributions(contributions);

            expect(flags.length).toBe(0);
            expect(validContributions.length).toBe(1);
        });
    });

    // ==================== Pipeline 整合 ====================

    describe('Pipeline 整合', () => {
        it('全部规则按顺序执行', () => {
            const pipeline = new AntiGamingPipeline({}, 'error');

            const refs: ReferenceRecord[] = [
                // 自引用 (alice 引用自己)
                makeRef('cAlice1', 'cAlice2', 'alice'),
            ];
            const owners: CrystalOwnerMap = new Map([
                ['cAlice1', 'alice'],
                ['cAlice2', 'alice'],
            ]);

            const contributions: ContributionRecord[] = [
                { crystalId: 'cAlice1', contributor: 'alice', role: 'Author', weight: 0.5 },
                { crystalId: 'cAlice2', contributor: 'alice', role: 'Discussant', weight: 0.001 }, // 幽灵
            ];

            const result = pipeline.run(refs, contributions, owners);

            // 检查有标记
            expect(result.flags.length).toBeGreaterThan(0);
            // 自引用标记
            expect(result.flags.some(f => f.flagType === FlagType.SelfReference)).toBe(true);
            // 幽灵贡献标记
            expect(result.flags.some(f => f.flagType === FlagType.GhostContribution)).toBe(true);
            // 有效贡献只有 1 个 (幽灵被过滤)
            expect(result.validContributions.length).toBe(1);
            // 无封锁 (自引用是 info 级别)
            expect(result.blockedUsers.size).toBe(0);
        });

        it('spam 用户被封锁', () => {
            const pipeline = new AntiGamingPipeline({
                spamMaxReferencesPerWeek: 3, // 低阈值方便测试
            }, 'error');

            const refs: ReferenceRecord[] = [];
            for (let i = 0; i < 4; i++) {
                refs.push(makeRef(`s${i}`, `t${i}`, 'spammer'));
            }

            const result = pipeline.run(refs, [], new Map());

            expect(result.blockedUsers.has('spammer')).toBe(true);
        });
    });
});
