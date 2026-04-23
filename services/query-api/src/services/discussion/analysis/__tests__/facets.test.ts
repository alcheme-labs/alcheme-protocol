import { describe, expect, test } from '@jest/globals';

import { inferSemanticFacets } from '../facets';

describe('discussion semantic facets', () => {
    test('infers problem without over-labeling a reflective friction statement', () => {
        const facets = inferSemanticFacets({
            text: '我这两天有点焦虑，我们圈子里的讨论经常很热，但聊完就散了，最后没有明确结论，也没人知道下一步该做什么。',
        });

        expect(facets).toContain('emotion');
        expect(facets).toContain('problem');
        expect(facets).not.toContain('proposal');
        expect(facets).not.toContain('summary');
    });

    test('infers criteria from a structured list of trigger conditions', () => {
        const facets = inferSemanticFacets({
            text: '对，我会这么看：第一，要有来回讨论，不是单人刷屏；第二，要围绕同一个主题；第三，要出现可执行提案；第四，要能看出真实顾虑。',
        });

        expect(facets).toContain('criteria');
        expect(facets).not.toContain('emotion');
    });

    test('marks concrete draft-making suggestions as proposal as well as question', () => {
        expect(
            inferSemanticFacets({
                text: '我觉得这就对了。这样既不会压过人的判断，也能把讨论成果保存下来。那我们要不要就按这个思路，先产出一个草稿试试看？',
            }),
        ).toEqual(expect.arrayContaining(['question', 'proposal']));
    });

    test('does not treat conversational 觉得 as emotion by itself', () => {
        expect(
            inferSemanticFacets({
                text: '那你觉得最低条件应该是什么？是不是至少要有两个以上的人来回讨论？',
            }),
        ).toEqual(expect.arrayContaining(['question', 'proposal']));
        expect(
            inferSemanticFacets({
                text: '那你觉得最低条件应该是什么？是不是至少要有两个以上的人来回讨论？',
            }),
        ).not.toContain('emotion');
    });

    test('marks explicit emotional language as emotion', () => {
        expect(
            inferSemanticFacets({
                text: '我现在其实有点沮丧，但也有一点乐观，因为我们终于找到卡点了。',
            }),
        ).toEqual(expect.arrayContaining(['emotion', 'explanation']));
    });

    test('does not turn every sentence containing 问题 into a question facet', () => {
        expect(
            inferSemanticFacets({
                text: '我的观点是问题不在于大家没想法，而在于事实、解释和提案都混在一起了。',
            }),
        ).toEqual(expect.arrayContaining(['explanation']));
        expect(
            inferSemanticFacets({
                text: '我的观点是问题不在于大家没想法，而在于事实、解释和提案都混在一起了。',
            }),
        ).not.toContain('question');
    });
});
