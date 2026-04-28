import fs from 'node:fs';
import path from 'node:path';

const QUERY_API_SRC = path.resolve(__dirname, '..', '..');

const WATCHED_FILES = [
    'rest/storage.ts',
    'rest/discussion.ts',
    'rest/draftLifecycle.ts',
    'rest/revisionDirection.ts',
    'rest/crystals.ts',
    'graphql/resolvers.ts',
    'services/knowledgeVersionDiff.ts',
    'services/policy/draftWorkflowPermissions.ts',
    'services/ghostDraft/acceptance.ts',
    'services/circleSummary/generator.ts',
];

function isAllowedChineseLine(relativePath: string, line: string): boolean {
    const trimmed = line.trim();
    if (trimmed.startsWith('//') || trimmed.startsWith('*')) return true;

    if (relativePath === 'services/circleSummary/generator.ts') {
        return [
            /引用 .*草稿/,
            /正式总结快照正在生成/,
            /请输出 4 行中文纯文本/,
            /第 [1-4] 行/,
            /当前稳定输出数/,
            /当前未关闭问题单/,
            /主草稿/,
            /稳定输出/,
            /最近讨论/,
            /暂无/,
        ].some((pattern) => pattern.test(line));
    }

    return false;
}

describe('query-api i18n static guard', () => {
    test('watched route and service files do not contain naked user-facing Chinese copy', () => {
        const failures: string[] = [];

        for (const relativePath of WATCHED_FILES) {
            const absolutePath = path.join(QUERY_API_SRC, relativePath);
            const source = fs.readFileSync(absolutePath, 'utf8');
            source.split('\n').forEach((line, index) => {
                const codeWithoutLineComment = line.replace(/\/\/.*$/u, '');
                if (!/[\u3400-\u9fff]/u.test(codeWithoutLineComment)) return;
                if (isAllowedChineseLine(relativePath, line)) return;
                failures.push(`${relativePath}:${index + 1}: ${line.trim()}`);
            });
        }

        expect(failures).toEqual([]);
    });
});
