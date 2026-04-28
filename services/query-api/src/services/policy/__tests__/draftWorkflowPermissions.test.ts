import { describe, expect, jest, test, afterEach } from '@jest/globals';

import * as membershipChecks from '../../membership/checks';
import * as profileService from '../profile';
import {
    localizeDraftWorkflowPermissionDecision,
    resolveDraftWorkflowPermission,
} from '../draftWorkflowPermissions';

const defaultPolicy = profileService.buildDefaultDraftWorkflowPolicy();

describe('draft workflow permissions i18n boundary', () => {
    afterEach(() => {
        jest.restoreAllMocks();
    });

    test('returns stable reason codes and English compatibility reason instead of Chinese UI text', async () => {
        jest.spyOn(profileService, 'resolveCirclePolicyProfile').mockResolvedValue({
            draftWorkflowPolicy: defaultPolicy,
        } as any);
        jest.spyOn(membershipChecks, 'getActiveCircleMembership').mockResolvedValue({
            role: 'Member',
            status: 'Active',
            identityLevel: 'Member',
        } as any);

        const prisma = {
            circle: {
                findUnique: jest.fn(async () => ({ creatorId: 99 })),
            },
        } as any;

        const decision = await resolveDraftWorkflowPermission(prisma, {
            circleId: 7,
            userId: 8,
            action: 'enter_crystallization',
        });

        expect(decision.allowed).toBe(false);
        expect(decision.reasonCode).toBe('role_required_enter_crystallization');
        expect(decision.reason).toBe('The current circle policy requires at least moderator to start crystallization.');
        expect(decision.reason).not.toMatch(/[\u3400-\u9fff]/);
        expect(localizeDraftWorkflowPermissionDecision(decision, 'zh')).toBe('当前圈层策略要求至少 主持人 才能发起结晶。');
    });

    test('inactive members use a localizable reason code', async () => {
        jest.spyOn(profileService, 'resolveCirclePolicyProfile').mockResolvedValue({
            draftWorkflowPolicy: defaultPolicy,
        } as any);
        jest.spyOn(membershipChecks, 'getActiveCircleMembership').mockResolvedValue(null as any);

        const prisma = {
            circle: {
                findUnique: jest.fn(async () => ({ creatorId: 99 })),
            },
        } as any;

        const decision = await resolveDraftWorkflowPermission(prisma, {
            circleId: 7,
            userId: 8,
            action: 'create_issue',
        });

        expect(decision.allowed).toBe(false);
        expect(decision.reasonCode).toBe('inactive_member');
        expect(decision.reason).toBe('Only active circle members can perform this action.');
        expect(localizeDraftWorkflowPermissionDecision(decision, 'zh')).toBe('只有活跃圈层成员才能执行这个动作。');
    });
});
