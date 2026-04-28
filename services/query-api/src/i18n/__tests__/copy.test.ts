import { describe, expect, test } from '@jest/globals';

import {
    localizeDraftWorkflowPermissionReason,
    localizeGovernanceRole,
    localizeQueryApiCopy,
    normalizeCopyLocale,
} from '../copy';

describe('query-api copy localization', () => {
    test('localizes fixed copy for English and Chinese', () => {
        expect(localizeQueryApiCopy('draft.crystallization.notReadyForExecution', 'en')).toContain('Start crystallization first');
        expect(localizeQueryApiCopy('draft.crystallization.notReadyForExecution', 'zh')).toBe('请先发起结晶，进入结晶阶段后再执行结晶。');
    });

    test('falls es/fr and unsupported locales back to English, not Chinese', () => {
        expect(localizeQueryApiCopy('knowledge.version.summary.noChanges', 'es')).toBe('No differences are visible within the currently readable range.');
        expect(localizeQueryApiCopy('knowledge.version.summary.noChanges', 'fr')).toBe('No differences are visible within the currently readable range.');
        expect(localizeQueryApiCopy('knowledge.version.summary.noChanges', 'de')).toBe('No differences are visible within the currently readable range.');
        expect(normalizeCopyLocale('de')).toBe('en');
    });

    test('interpolates parameters', () => {
        expect(localizeQueryApiCopy('knowledge.version.summary.changedFields', 'en', { count: 3 })).toBe('There are 3 readable version differences.');
        expect(localizeQueryApiCopy('knowledge.version.summary.changedFields', 'zh', { count: 3 })).toBe('当前可读到 3 处版本差异。');
    });

    test('localizes governance roles and permission reasons', () => {
        expect(localizeGovernanceRole('Moderator', 'en')).toBe('moderator');
        expect(localizeGovernanceRole('Moderator', 'zh')).toBe('主持人');
        expect(localizeDraftWorkflowPermissionReason({ reasonCode: 'role_required_enter_crystallization', minRole: 'Member' }, 'en'))
            .toBe('The current circle policy requires at least member to start crystallization.');
        expect(localizeDraftWorkflowPermissionReason({ reasonCode: 'role_required_enter_crystallization', minRole: 'Member' }, 'zh'))
            .toBe('当前圈层策略要求至少 成员 才能发起结晶。');
    });
});
